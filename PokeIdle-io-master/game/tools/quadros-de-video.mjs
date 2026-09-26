// Tira quadros de um vídeo — o jeito de CONFERIR uma gravação sem ffmpeg na máquina.
//
//   node tools/quadros-de-video.mjs <video.webm> <pasta-saida> [quantos] [larguraDoQuadro]
//
// Abre o arquivo num Chrome headless, busca N instantes igualmente espaçados, desenha cada um
// num canvas e salva o PNG. Serve para revisar a gravação antes de publicar, e para tirar o
// PÔSTER da landing page (o quadro que aparece enquanto o vídeo ainda não pintou).
//
// A busca é `currentTime = t` + espera pelo evento `seeked`: sem esperar o evento, o
// `drawImage` copia o quadro ANTERIOR e a folha inteira sai deslocada de uma cena.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';

const [video, pasta, quantos = 12, larguraQ = 640] = process.argv.slice(2);
if (!video || !pasta) {
  console.error('uso: node tools/quadros-de-video.mjs <video.webm> <pasta> [quantos] [largura]');
  process.exit(1);
}
await mkdir(pasta, { recursive: true });

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
const perfil = await mkdtemp(join(tmpdir(), 'quadros-'));
const porta = 9900 + Math.floor(Math.random() * 90);
const proc = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--hide-scrollbars', '--mute-audio',
  '--allow-file-access-from-files', '--window-size=800,600',
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, 'about:blank',
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
const ws = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });
let id = 0; const pend = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const cmd = (metodo, params = {}) => new Promise((ok) => {
  const meu = ++id; pend.set(meu, ok);
  ws.send(JSON.stringify({ id: meu, method: metodo, params }));
});
const js = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
};

await cmd('Runtime.enable');

const url = `file:///${resolve(video).replace(/\\/g, '/')}`;
// A página precisa nascer com origem `file://`, e não `about:blank`: origem opaca faz o
// `<video src="file:///…">` ser barrado antes de começar a baixar, e o sintoma é um `onerror`
// seco, sem mensagem nenhuma. Navegar para a PASTA do vídeo dá a origem certa.
await cmd('Page.navigate', { url: url.replace(/[^/]+$/, '') });
await dormir(500);
// `duration` vem `Infinity` num WebM de `MediaRecorder`: o arquivo é gravado em fluxo e não
// leva o campo Duration no cabeçalho. A saída padrão é pedir uma busca para um instante
// absurdo — o navegador então varre o arquivo, descobre o fim e conserta a `duration`.
const meta = await js(`
  new Promise((ok, err) => {
    const v = document.createElement('video');
    v.src = ${JSON.stringify(url)};
    v.muted = true;
    v.onerror = () => err(new Error('não carregou o vídeo'));
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        return ok({ dur: v.duration, w: v.videoWidth, h: v.videoHeight });
      }
      v.currentTime = 1e6;
      v.ontimeupdate = () => {
        if (!Number.isFinite(v.duration)) return;
        v.ontimeupdate = null;
        v.currentTime = 0;
        ok({ dur: v.duration, w: v.videoWidth, h: v.videoHeight });
      };
    };
    document.body.appendChild(v);
    window.__v = v;
  })
`);
console.log(`vídeo: ${meta.w}x${meta.h}  ${meta.dur.toFixed(1)} s`);

const n = Number(quantos);

/* TOCA o vídeo do começo ao fim e fotografa na passagem, em vez de buscar instante a instante.
   Um WebM saído do `MediaRecorder` é gravado em fluxo e **não tem índice de busca** (nem Cues,
   nem duração no cabeçalho). O `currentTime = t` funciona no começo do arquivo e, passado
   algum ponto, entrega quadro PRETO — foi exatamente assim que uma gravação boa pareceu ter
   morrido aos 18 s. Tocando linearmente o decodificador nunca perde o fio.

   O preço é esperar a duração do vídeo (40 s), o que é barato perto de julgar errado. */
await js(`
  window.__tiros = [];
  (() => {
    const v = window.__v;
    const alvos = ${JSON.stringify(Array.from({ length: n }, (_, i) => meta.dur * ((i + 0.5) / n)))};
    let prox = 0;
    const esc = ${Number(larguraQ)} / v.videoWidth;
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * esc); c.height = Math.round(v.videoHeight * esc);
    const ctx = c.getContext('2d');
    v.addEventListener('timeupdate', () => {
      while (prox < alvos.length && v.currentTime >= alvos[prox]) {
        ctx.drawImage(v, 0, 0, c.width, c.height);
        window.__tiros.push({ t: v.currentTime, png: c.toDataURL('image/png').split(',')[1] });
        prox++;
      }
    });
    v.currentTime = 0;
    v.play();
  })();
  true;
`);

// `timeupdate` dispara a cada ~250 ms; esperar a duração + folga cobre o arquivo inteiro.
for (let i = 0; i < Math.ceil(meta.dur) + 6; i++) {
  await dormir(1000);
  const feitos = await js('window.__tiros.length');
  if (feitos >= n) break;
}

const tiros = await js('window.__tiros.map((x) => ({ t: x.t, png: x.png }))');
for (const [i, tiro] of tiros.entries()) {
  const nome = join(pasta, `q${String(i).padStart(2, '0')}-${tiro.t.toFixed(1)}s.png`);
  await writeFile(nome, Buffer.from(tiro.png, 'base64'));
  console.log(`  ${nome}`);
}

ws.close(); proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(0);
