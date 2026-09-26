// Abre o jogo de verdade e anota TODA imagem que não carregou.
//
//   node tools/varredura-imagens.mjs [url]          # padrão: produção
//
// ### Por que este existe, se já há o `teste-assets.mjs`
//
// Aquele lê o CÓDIGO atrás de caminho literal, e por isso é cego para tudo que só existe em
// tempo de execução: caminho montado por concatenação, ícone que vem de um índice JSON baixado,
// arte escolhida por id de item. Três bugs de imagem em produção passaram por ele.
//
// Este aqui não lê código nenhum: ele **usa o jogo** e escuta a rede. Se o navegador pediu e
// não veio, entra na lista — não importa como aquela URL foi construída.
//
// ### E por que apontar para PRODUÇÃO por padrão
//
// É a diferença que gerou os bugs: `public/data` é o espelho regenerável do pack de terceiro,
// e arquivo posto lá à mão existe só na máquina de quem o pôs. Contra o `localhost` a varredura
// passa limpa e mente; contra o servidor ela diz a verdade.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';

const BASE = (process.argv[2] ?? 'https://pokeidle.io').replace(/\/$/, '');
const NICK = `vi${Date.now() % 100000}`;

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'vi-'));
const porta = 9450 + Math.floor(Math.random() * 200);
const proc = spawn(
  chrome,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
   `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, '--window-size=1500,950', 'about:blank'],
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

const ws = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });

let id = 0;
const pendentes = new Map();
const urlPorPedido = new Map();
/** url → como falhou. `Map` para não listar o mesmo arquivo dez vezes. */
const mortas = new Map();
let pedidos = 0;

ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pendentes.has(m.id)) { pendentes.get(m.id)(m.result); pendentes.delete(m.id); }

  if (m.method === 'Network.requestWillBeSent') {
    urlPorPedido.set(m.params.requestId, m.params.request.url);
    pedidos++;
  }
  // Duas formas de falhar, e as duas contam: o servidor respondeu 4xx/5xx, ou a conexão nem
  // completou (DNS, TLS, bloqueio). Só a primeira apareceria num `curl` de checagem.
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
    mortas.set(m.params.response.url, `HTTP ${m.params.response.status}`);
  }
  if (m.method === 'Network.loadingFailed') {
    const url = urlPorPedido.get(m.params.requestId);
    if (url && !/websocket/i.test(m.params.type ?? '')) {
      mortas.set(url, m.params.errorText ?? 'falhou');
    }
  }
});

const cmd = (method, params = {}) =>
  new Promise((ok) => { const meu = ++id; pendentes.set(meu, ok); ws.send(JSON.stringify({ id: meu, method, params })); });
const js = async (e) =>
  (await cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;

await cmd('Network.enable');
await cmd('Runtime.enable');
await cmd('Page.enable');

console.log(`VARREDURA DE IMAGENS — ${BASE}\n${'='.repeat(52)}`);
console.log(`entrando como ${NICK}…`);

await cmd('Page.navigate', { url: `${BASE}/?nick=${NICK}&starter=4` });
await dormir(20000);

// Abre cada tela do menu. É onde mora a maior parte dos ícones — a Loja sozinha tem 18, e
// nenhum deles aparece antes de alguém clicar em "Shop".
const MODAIS = ['pokedex', 'mapa', 'campeonato', 'market', 'ranking', 'bosses', 'pvp', 'community', 'shop', 'pokepedia'];
for (const nome of MODAIS) {
  const abriu = await js(`(() => {
    const b = document.querySelector('.menu-topo button[data-modal="${nome}"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  process.stdout.write(abriu ? `  ${nome}` : `  ${nome}(?)`);
  await dormir(2600);
  await js(`document.getElementById('modal-fechar')?.click()`);
  await dormir(400);
}
console.log('\n');

// A ficha do treinador e a bolsa, que desenham item e retrato.
await js(`document.getElementById('tr-retrato')?.click()`);
await dormir(2000);
await js(`document.getElementById('perfil-fechar')?.click()`);
await js(`document.querySelector('[data-gaveta="inventario"]')?.click()`);
await dormir(1500);

// --------------------------------------------------------------- relatório

// `favicon.ico` é ruído conhecido: o navegador pede sozinho e o jogo declara os três PNG.
const IGNORAR = [/\/favicon\.ico$/];
const lista = [...mortas.entries()].filter(([u]) => !IGNORAR.some((re) => re.test(u)));

console.log('='.repeat(52));
console.log(`${pedidos} pedidos · ${lista.length} falharam\n`);

for (const [url, motivo] of lista.sort()) {
  console.log(`  ${motivo.padEnd(12)} ${url.replace(BASE, '')}`);
}

console.log(`\n${'='.repeat(52)}`);
console.log(lista.length ? `${lista.length} ARQUIVO(S) FALTANDO` : 'nenhuma imagem quebrada');

proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exitCode = lista.length ? 1 : 0;
