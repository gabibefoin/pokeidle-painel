// Igual ao tools/shot.mjs do jogo, mas com a viewport CRAVADA no tamanho pedido.
//
// O `--window-size` do Chrome conta a moldura da janela junto, então 1600×900 ali sai como
// 1584×749 de página — inútil quando o alvo é uma arte de tamanho exato. `setDeviceMetrics
// Override` fixa a viewport, e `captureBeyondViewport` garante a captura inteira.
//
//   node render.mjs <url> <arquivo.png> [larg] [alt] [escala] [seg] [fundo]
//
// `fundo` só aceita `transparente`, e é opt-in porque o Chrome pinta branco por baixo de
// qualquer página por padrão — um PNG com alfa não sai sozinho só por a página não ter
// `background`. Serve para a logo (`divulgacao/logo.html`), que é ícone e precisa dos cantos
// vazados; os pôsteres continuam opacos sem passar nada.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';

const [url, saida, larg = 1600, alt = 900, escala = 1, espera = 2.5, fundo = ''] = process.argv.slice(2);

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'cdp-'));
const porta = 9222 + Math.floor(Math.random() * 500);
// A janela precisa nascer JÁ do tamanho do alvo. Com a janela padrão (800×600) e a viewport
// forçada em 1600 por CDP, o Chrome encaixa uma na outra e a captura sai com ~1,5% de escala
// — o quadro passava de 1548 para 1571 px e a última figura era cortada pela borda.
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--allow-file-access-from-files',
  `--window-size=${larg},${alt}`,
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function alvo() {
  for (let i = 0; i < 60; i++) {
    try {
      const abas = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
      const p = abas.find((a) => a.type === 'page');
      if (p?.webSocketDebuggerUrl) return p;
    } catch {}
    await dormir(250);
  }
  throw new Error('Chrome não abriu a porta de debug');
}

const pagina = await alvo();
const ws = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });

let id = 0;
const pendentes = new Map();
const erros = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pendentes.has(m.id)) { pendentes.get(m.id)(m.result); pendentes.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    erros.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    erros.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});
const cmd = (method, params = {}) => new Promise((ok) => {
  const meu = ++id; pendentes.set(meu, ok);
  ws.send(JSON.stringify({ id: meu, method, params }));
});

await cmd('Runtime.enable');
await cmd('Page.enable');
await cmd('Emulation.setDeviceMetricsOverride', {
  width: Number(larg), height: Number(alt), deviceScaleFactor: Number(escala), mobile: false,
});
// Alfa de verdade no PNG. Vai ANTES do `navigate` porque o override é da página, e a que
// ainda não carregou não o herdaria.
if (fundo === 'transparente') {
  await cmd('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
}
await cmd('Page.navigate', { url });
await dormir(Number(espera) * 1000);

// `clip.scale` fica em 1: quem amplia é o `deviceScaleFactor` lá em cima. Passar a escala
// nos dois multiplica duas vezes — 2× virava 6400×3600 em vez de 3200×1800.
const { data } = await cmd('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width: Number(larg), height: Number(alt), scale: 1 },
});
await writeFile(saida, Buffer.from(data, 'base64'));

if (erros.length) {
  console.log(`erros no console (${erros.length}):`);
  for (const e of erros.slice(0, 5)) console.log('  ·', String(e).split('\n')[0]);
}
console.log(`ok: ${saida}  ${larg}x${alt} @${escala}x`);

ws.close();
proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(0);
