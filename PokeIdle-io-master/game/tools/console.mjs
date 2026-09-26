// O console do navegador, na linha de comando.
//
//   node tools/console.mjs [url] [segundos]
//
// Existe porque erro de módulo ES é SILENCIOSO na tela: um import quebrado deixa o jogo em
// branco, `tools/tela.mjs` tira um print azul vazio e não há onde ler o motivo. O `index.html`
// joga o que consegue no `#login-erro`, mas isso não pega falha de rede nem exceção de dentro
// de um módulo que nem chegou a ser avaliado.
//
// Mostra exceção, `console.*` e erro de carregamento de recurso, na ordem em que aconteceram.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';

const URL_ALVO = process.argv[2] ?? 'http://localhost:8080/app';
const SEGUNDOS = Number(process.argv[3] ?? 6);

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'console-'));
const porta = 9850 + Math.floor(Math.random() * 140);
const proc = spawn(
  chrome,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
   `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, '--window-size=1500,900', 'about:blank'],
  { stdio: 'ignore', windowsHide: true },
);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let pagina;
for (let i = 0; i < 60 && !pagina; i++) {
  try {
    const abas = await fetch(`http://127.0.0.1:${porta}/json/list`).then((r) => r.json());
    pagina = abas.find((a) => a.type === 'page' && a.webSocketDebuggerUrl);
  } catch {}
  if (!pagina) await dormir(250);
}
if (!pagina) throw new Error('Chrome não abriu a porta de debug');

const ws = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });

let id = 0;
const pendentes = new Map();
const linhas = [];
const corta = (s, n = 400) => (s?.length > n ? `${s.slice(0, n)}…` : s ?? '');

ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pendentes.has(m.id)) { pendentes.get(m.id)(m.result); pendentes.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    // `description` traz a pilha; quando não vem (erro de sintaxe de módulo), sobra o texto.
    linhas.push(`✗ ${corta(d.exception?.description ?? d.text, 700)}`);
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
    linhas.push(`${m.params.type === 'error' ? '✗' : '·'} ${corta(txt)}`);
  }
  // Falha de REDE (404 de um módulo, por exemplo) não passa por `Runtime`; vem por aqui.
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    linhas.push(`✗ ${corta(m.params.entry.text)} ${m.params.entry.url ?? ''}`);
  }
});
const cmd = (method, params = {}) =>
  new Promise((ok) => { const meu = ++id; pendentes.set(meu, ok); ws.send(JSON.stringify({ id: meu, method, params })); });

await cmd('Runtime.enable');
await cmd('Log.enable');
await cmd('Page.enable');
await cmd('Page.navigate', { url: URL_ALVO });
await dormir(SEGUNDOS * 1000);

console.log(linhas.length ? linhas.join('\n') : '(console limpo)');

proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(linhas.some((l) => l.startsWith('✗')) ? 1 : 0);
