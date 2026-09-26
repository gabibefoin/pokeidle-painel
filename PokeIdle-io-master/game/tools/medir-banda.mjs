// Quanto um jogador baixa: HTTP no primeiro acesso, HTTP ao entrar numa hunt, e WebSocket por
// minuto parado caçando.
//
//   node tools/medir-banda.mjs [url] [segundosDeHunt]
//
// Existe para responder a pergunta de HOSPEDAGEM com número em vez de palpite. Egress é o
// custo que morde num jogo de WebSocket, e ele tem duas fontes que se pagam de jeitos
// completamente diferentes:
//
//   · ASSET (sprites, mapas, catálogos) — grande, imutável e igual para todo mundo. É o que
//     um CDN resolve por centavos, e é o que fica CARO se sair do mesmo processo que roda o
//     jogo.
//   · SOCKET (o estado do jogo) — pequeno por pacote, mas por jogador e por segundo. Esse não
//     tem CDN que resolva; ou o pacote encolhe, ou a conta cresce linear com o número de
//     jogadores online.
//
// Medir os dois separados é o que permite decidir onde vale mexer.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';

const ORIGEM = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
const URL_BASE = `${ORIGEM}/app`;
const SEG_HUNT = Number(process.argv[3] ?? 60);
const NICK = `bw${Date.now() % 100000}`;
/** Uma hunt de nível 1, que um treinador recém-criado consegue entrar. */
const HUNT = 'caterpie';

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'bw-'));
const porta = 9200 + Math.floor(Math.random() * 90);
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

const ws = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });

let id = 0;
const pendentes = new Map();

// ---- contadores
//
// `encodedDataLength` é o que passou no fio (já comprimido pelo gzip do servidor), que é
// exatamente o que a hospedagem cobra. O tamanho do recurso descomprimido seria um número
// bonito e errado.
let fase = 'fria';
const http = { fria: new Map(), hunt: new Map(), quente: new Map() };
const socket = { fria: 0, hunt: 0, quente: 0, quadros: 0 };
const urlPorRequest = new Map();

const somar = (mapa, url, bytes) => mapa.set(url, (mapa.get(url) ?? 0) + bytes);

const eventos = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pendentes.has(m.id)) { pendentes.get(m.id)(m.result); pendentes.delete(m.id); }
  if (m.method) eventos.set(m.method, (eventos.get(m.method) ?? 0) + 1);

  if (m.method === 'Network.requestWillBeSent') {
    urlPorRequest.set(m.params.requestId, m.params.request.url);
  }
  if (m.method === 'Network.loadingFinished') {
    const url = urlPorRequest.get(m.params.requestId);
    if (url) somar(http[fase], url, m.params.encodedDataLength ?? 0);
  }
  // Os dois sentidos do socket. O que a hospedagem cobra é o que SAI (frameReceived, do ponto
  // de vista do navegador), mas o que entra também conta na conta de rede da máquina.
  if (m.method === 'Network.webSocketFrameReceived' || m.method === 'Network.webSocketFrameSent') {
    socket[fase] += m.params.response?.payloadData?.length ?? 0;
    if (m.method === 'Network.webSocketFrameReceived') socket.quadros++;
  }
});

const cmd = (method, params = {}) =>
  new Promise((ok) => { const meu = ++id; pendentes.set(meu, ok); ws.send(JSON.stringify({ id: meu, method, params })); });
const js = async (e) =>
  (await cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;

await cmd('Network.enable');
await cmd('Runtime.enable');
await cmd('Page.enable');
// Cache desligado: o que interessa é o custo do PRIMEIRO acesso, que é o que a hospedagem
// paga por visitante novo. Com cache quente, a medida daria quase zero e não diria nada.
await cmd('Network.setCacheDisabled', { cacheDisabled: true });

console.log(`medindo ${URL_BASE} como ${NICK} · ${SEG_HUNT}s de hunt\n`);

await cmd('Page.navigate', { url: `${URL_BASE}?nick=${NICK}&starter=4` });
await dormir(14000);

// ------------------------------------------------------------------ a hunt
//
// Entrar numa hunt baixa o mapa daquela área. A entrada é pelo `?hunt=` (o mesmo atalho de URL
// dos testes) e não por clique no mapa-múndi: clicar depende do marcador certo estar plantado e
// visível, e uma medição que às vezes não entra em hunt nenhuma não mede nada.
fase = 'hunt';
await cmd('Page.navigate', { url: `${URL_BASE}?nick=${NICK}&hunt=${HUNT}` });
await dormir(SEG_HUNT * 1000);

// --------------------------------------------------------- a segunda visita
//
// Aqui o cache VOLTA a valer. É o número que decide a conta de banda de verdade: um jogador
// não é um visitante único por dia, ele abre o jogo várias vezes. Se a segunda visita custa o
// mesmo que a primeira, a conta é o número de SESSÕES; se custa quase nada, é o de pessoas.
fase = 'quente';
await cmd('Network.setCacheDisabled', { cacheDisabled: false });
await cmd('Page.navigate', { url: `${URL_BASE}?nick=${NICK}&hunt=${HUNT}` });
await dormir(16000);

// ------------------------------------------------------------------ saída

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

const total = (mapa) => [...mapa.values()].reduce((s, v) => s + v, 0);

/** As N URLs mais pesadas de uma fase — é onde vale mexer. */
function maiores(mapa, n = 6) {
  return [...mapa.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([url, bytes]) => `      ${kb(bytes).padStart(10)}  ${url.replace(URL_BASE.replace(/\/$/, ''), '')}`)
    .join('\n');
}

const frio = total(http.fria);
const naHunt = total(http.hunt);
const quente = total(http.quente);

console.log('═'.repeat(72));
console.log('1ª VISITA (cache frio) — o que custa um jogador NOVO');
console.log(`   HTTP ......... ${mb(frio).padStart(10)}   em ${http.fria.size} pedidos`);
console.log(maiores(http.fria));
console.log('');
console.log(`ENTRAR NA HUNT "${HUNT}" + ${SEG_HUNT}s`);
console.log(`   HTTP ......... ${mb(naHunt).padStart(10)}   em ${http.hunt.size} pedidos`);
console.log(maiores(http.hunt, 3));
console.log(`   WebSocket .... ${kb(socket.hunt).padStart(10)}   em ${socket.quadros} quadros`);
console.log('');
console.log('2ª VISITA (cache quente) — o que custa o MESMO jogador voltando');
console.log(`   HTTP ......... ${mb(quente).padStart(10)}   em ${http.quente.size} pedidos`);
console.log(maiores(http.quente, 3));
console.log('');

const wsPorHora = (socket.hunt / SEG_HUNT) * 3600;
console.log('RESUMO POR JOGADOR');
console.log(`   1ª sessão .... ${mb(frio + naHunt).padStart(10)}`);
console.log(`   2ª sessão .... ${mb(quente).padStart(10)}   ← é este que multiplica por sessão`);
console.log(`   socket ....... ${mb(wsPorHora).padStart(10)} / hora caçando`);
console.log('═'.repeat(72));

proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(0);
