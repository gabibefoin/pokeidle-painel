// Captura uma aba do PAINEL de admin, ja logado — irmao do `tela.mjs`, mas para `/admin`.
//
//   node tools/tela-admin.mjs <saida.png> [#secao]
//   node tools/tela-admin.mjs convites.png '#convites'
//
// `NICK` escolhe a conta (padrao `fasi`), e ela precisa estar em `ADMIN_EMAILS` — sem isso o
// painel responde 404 e a captura sai numa pagina vazia, que e' o proprio jeito de o portao
// funcionar (ver `sessaoAdmin`, em `admin-rotas.mjs`).
//
// A altura e' 1400 e a captura passa do viewport (`captureBeyondViewport`): as abas do painel
// sao tabelas longas, e cortar na dobra esconderia justamente a linha que se foi conferir.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { sessaoDe, fecharBanco } from './sessao-local.mjs';

const [saida, secao = ''] = process.argv.slice(2);
const NICK = process.env.NICK || 'fasi';
const LARG = 1500;
const ALT = 1400;

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge nao encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'adm-'));
const porta = 9700 + Math.floor(Math.random() * 200);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`,
  `--window-size=${LARG},${ALT}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let pagina;
for (let i = 0; i < 60 && !pagina; i++) {
  try {
    pagina = (await fetch(`http://127.0.0.1:${porta}/json/list`).then((r) => r.json()))
      .find((a) => a.type === 'page' && a.webSocketDebuggerUrl);
  } catch {}
  if (!pagina) await dormir(250);
}
if (!pagina) throw new Error('Chrome nao abriu a porta de debug');

const ws = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });
let id = 0;
const pend = new Map();
const erros = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    erros.push((d.exception?.description ?? d.text ?? 'erro').split(String.fromCharCode(10)).slice(0, 3).join(' <- ').slice(0, 300));
  }
});
const cmd = (metodo, params = {}) => new Promise((ok) => {
  const meu = ++id; pend.set(meu, ok);
  ws.send(JSON.stringify({ id: meu, method: metodo, params }));
});
const js = async (expr) =>
  (await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

await cmd('Runtime.enable');
await cmd('Page.enable');
await cmd('Emulation.setDeviceMetricsOverride', {
  width: LARG, height: ALT, deviceScaleFactor: 1, mobile: false,
});

const sessao = await sessaoDe(NICK).finally(fecharBanco);
await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))}); } catch (_) {}`,
});
await cmd('Page.navigate', { url: `http://localhost:8080/admin${secao}` });
await dormir(6000);

const { data } = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
await writeFile(saida, Buffer.from(data, 'base64'));
if (erros.length) console.log(`erros no console: ${erros.slice(0, 3).join(' | ')}`);
console.log(`ok: ${saida}`);

ws.close();
proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(0);
