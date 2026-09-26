// Reduz e recomprime uma arte grande para o tamanho em que ela é REALMENTE mostrada.
//
//   node tools/otimizar-arte.mjs <entrada> <saida.jpg> [largura] [qualidade]
//
// Existe porque a arte chega do ilustrador em 2880 px e 7 MB, e o quadro do portal tem 520 px
// de largura: sem passar por aqui, todo jogador baixa 7 MB para ver uma imagem de meio mega —
// e a barra de carregamento, que ESPERA essa imagem, fica parada por causa disso.
//
// O redimensionamento é feito pelo Chrome (o mesmo que os testes de tela já usam) porque não
// há decodificador de imagem no Node e não vale puxar `sharp` — uma dependência nativa de
// 30 MB para uma conversão que acontece uma vez por arte nova.
import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';

const [entrada, saida, larguraArg = '1600', qualidadeArg = '0.86'] = process.argv.slice(2);
if (!entrada || !saida) {
  console.error('uso: node tools/otimizar-arte.mjs <entrada> <saida.jpg> [largura] [qualidade]');
  process.exit(1);
}
const LARGURA = Number(larguraArg);
const QUALIDADE = Number(qualidadeArg);

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const bytes = await readFile(entrada);
const dataUrl = `data:${MIME[extname(entrada).toLowerCase()] ?? 'image/png'};base64,${bytes.toString('base64')}`;

const perfil = await mkdtemp(join(tmpdir(), 'arte-'));
const porta = 9400 + Math.floor(Math.random() * 300);
const proc = spawn(
  chrome,
  ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${porta}`,
   `--user-data-dir=${perfil}`, 'about:blank'],
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

const ws = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });
let id = 0;
const pendentes = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pendentes.has(m.id)) { pendentes.get(m.id)(m); pendentes.delete(m.id); }
});
const cmd = (method, params = {}) =>
  new Promise((ok) => { const meu = ++id; pendentes.set(meu, ok); ws.send(JSON.stringify({ id: meu, method, params })); });

// A imagem entra como data: URL para não depender de servidor nenhum rodando.
const resposta = await cmd('Runtime.evaluate', {
  awaitPromise: true,
  returnByValue: true,
  expression: `(async () => {
    const img = await new Promise((ok, err) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => err(new Error('não decodificou'));
      i.src = ${JSON.stringify(dataUrl)};
    });
    const larg = Math.min(${LARGURA}, img.naturalWidth);
    const alt = Math.round(img.naturalHeight * (larg / img.naturalWidth));
    const cv = document.createElement('canvas');
    cv.width = larg; cv.height = alt;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, larg, alt);
    return JSON.stringify({
      larg, alt, de: [img.naturalWidth, img.naturalHeight],
      dados: cv.toDataURL('image/jpeg', ${QUALIDADE}).split(',')[1],
    });
  })()`,
});

proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});

if (resposta.result?.exceptionDetails) throw new Error(resposta.result.exceptionDetails.text);
const r = JSON.parse(resposta.result.result.value);
const buf = Buffer.from(r.dados, 'base64');
await writeFile(saida, buf);

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(
  `${entrada} ${r.de[0]}×${r.de[1]} ${kb(bytes.length)}  →  ${saida} ${r.larg}×${r.alt} ${kb(buf.length)}`,
);
process.exit(0);
