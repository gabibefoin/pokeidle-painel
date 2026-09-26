// Screenshot com espera REAL, via Chrome DevTools Protocol.
//
// O `--virtual-time-budget` do Chrome headless adianta os timers e fecha a página antes de um
// WebSocket completar o handshake — inútil para testar um jogo em tempo real. Aqui abrimos o
// Chrome com a porta de debug, navegamos, esperamos em tempo de parede e capturamos.
//
//   node tools/shot.mjs <url> <arquivo.png> [segundosDeEspera] [largura] [altura]
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';

const [url, saida, espera = 6, larg = 1500, alt = 950] = process.argv.slice(2);
if (!url || !saida) {
  console.error('uso: node tools/shot.mjs <url> <arquivo.png> [seg] [larg] [alt]');
  process.exit(1);
}

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'cdp-'));
const porta = 9222 + Math.floor(Math.random() * 500);

const proc = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${porta}`,
    `--user-data-dir=${perfil}`,
    `--window-size=${larg},${alt}`,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function alvo() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/json/list`);
      const abas = await r.json();
      const p = abas.find((a) => a.type === 'page');
      if (p?.webSocketDebuggerUrl) return p;
    } catch {}
    await dormir(250);
  }
  throw new Error('Chrome não abriu a porta de debug');
}

const pagina = await alvo();
const ws = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((ok, err) => {
  ws.once('open', ok);
  ws.once('error', err);
});

let id = 0;
const pendentes = new Map();
const erros = [];

ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pendentes.has(m.id)) {
    pendentes.get(m.id)(m.result);
    pendentes.delete(m.id);
  }
  // captura erros de console para o teste não passar em silêncio
  if (m.method === 'Runtime.exceptionThrown') {
    erros.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    erros.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});

const cmd = (method, params = {}) =>
  new Promise((ok) => {
    const meu = ++id;
    pendentes.set(meu, ok);
    ws.send(JSON.stringify({ id: meu, method, params }));
  });

await cmd('Runtime.enable');
await cmd('Page.enable');
await cmd('Page.navigate', { url });
await dormir(Number(espera) * 1000);

const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
await writeFile(saida, Buffer.from(data, 'base64'));

if (erros.length) {
  console.log(`erros no console (${erros.length}):`);
  for (const e of erros.slice(0, 5)) console.log('  ·', String(e).split('\n')[0]);
}
console.log(`ok: ${saida}`);

ws.close();
proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(0);
