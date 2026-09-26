// Grava o VÍDEO VERTICAL de divulgação — 1080×1920, o formato de Reels/TikTok/Shorts.
//
//   node tools/gravar-reels.mjs <saida.mp4> [nick]
//   node tools/gravar-reels.mjs ../divulgacao/reels-lancamento.mp4 SrErva
//
// Precisa do servidor local no ar (`npm start`, com `docker compose up -d`).
//
// ---------------------------------------------------------------------------- o que é isto
//
// O irmão vertical do `gravar-gameplay.mjs`. Aquele faz o laço de 16:9 da landing page: uma
// aba, um enquadramento, sem história. Este faz o MATERIAL BRUTO de um anúncio — uma lista de
// TAKES na ordem de um roteiro, para o editor cortar por cima. Por isso ele tem coisas que o
// outro não precisa ter:
//
//   · **duas abas de origem**, e o vídeo troca de uma para a outra no meio (a do navegador
//     abrindo o site, e a do jogo já carregado);
//   · **cromo de navegador desenhado na tela de composição** — a barra de endereço com
//     `pokeidle.io` sendo digitado. Ela NÃO é injetada na página: é pintada no canvas, acima
//     do quadro, e por isso não mexe no layout do jogo nem sobrevive por engano até o fim;
//   · **toque visível** (o anel que cresce onde o dedo encostou), também pintado no canvas —
//     num Chrome sem dedo, o clique não deixa marca nenhuma, e "dedo tocando a tela" era um
//     dos takes pedidos;
//   · **celular → PC na MESMA aba**: em vez de uma segunda conta (duas sessões do mesmo nick
//     se derrubam — ver o `sockets.set` do `gateway.mjs`), o que muda é o viewport. O
//     `mobile.mjs` escuta as media queries e se desmonta sozinho, então a mesma partida, a
//     mesma conta e o mesmo segundo aparecem nas duas montagens. É o match cut de graça.
//
// ------------------------------------------------------------------------- como o vídeo sai
//
//     aba do JOGO  ──┐
//                    ├──(CDP Page.startScreencast: JPEG por quadro)──▶ Node
//     aba do SITE  ──┘                                                  │
//                                                                       ▼
//                     aba COMPOSITORA: canvas 1080×1920 ◀── __push(tag, b64)
//                        │  · cromo do navegador
//                        │  · anéis de toque
//                        │  · punch-in
//                        ▼
//                   captureStream(30) ──▶ MediaRecorder ──▶ MP4/H.264 (ou WebM/VP9)
//
// **Uma origem por vez.** Um quadro de 1080×1920 em JPEG dá ~250 KB; a 25 fps já são 6 MB/s
// pelo WebSocket do CDP, e o dobro disso trava o Node. Quem troca de origem é o
// `trocarFonte`, que liga o screencast novo, espera um quadro chegar e só então desliga o
// velho — sem essa folga o corte cai num quadro preto.
//
// **O enquadramento sai da PROPORÇÃO do quadro, não de um modo.** Quadro em pé preenche os
// 1080×1920; quadro deitado (a fase de PC) entra centrado, com tarja em cima e embaixo. É o
// que faz a virada celular→PC acontecer sem um único quadro torto: o viewport muda, a
// proporção muda junto, e a composição acompanha no mesmo quadro.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { sessaoDe, fecharBanco } from './sessao-local.mjs';

const [saidaArg, nick = 'SrErva'] = process.argv.slice(2);
if (!saidaArg) {
  console.error('uso: node tools/gravar-reels.mjs <saida.mp4> [nick]');
  process.exit(1);
}

const BASE = process.env.HTTP_URL ?? 'http://localhost:8080';
/**
 * A aba do GANCHO entra pelo IP, e não por `localhost`.
 *
 * As duas abas vivem no mesmo perfil do Chrome, e `localStorage` é por ORIGEM. Com as duas em
 * `localhost:8080`, a sessão semeada para a aba do jogo aparecia também para a landing — que
 * tem uma regra de "quem já joga não vê a página de venda" (`landing.js`) e reenviava para
 * `/app` sozinha. Aí eram DUAS sessões do mesmo nick, o `gateway.mjs` derrubava a primeira, e
 * a aba do jogo passava o vídeo inteiro escrevendo "sessão aberta em outra aba".
 *
 * `127.0.0.1` é outra origem para o navegador e o mesmo servidor para o jogo: a landing entra
 * limpa, o CTA leva ao `/app` sem sessão — que é justamente a tela de carregamento que o
 * roteiro pede — e a aba do jogo nunca fica sabendo.
 */
const BASE_SITE = BASE.replace('localhost', '127.0.0.1');

/** O quadro final. 9:16 — o que Reels, TikTok e Shorts pedem. */
const L = 1080;
const A = 1920;

/** O celular: 432×768 CSS a 2,5× dá exatamente 1080×1920 de superfície. Nada de reescala. */
const FONE = { larg: 432, alt: 768, dpr: 2.5 };
/** A aba do site fica mais curta: os 105 px que sobram em cima são o cromo do navegador. */
const CROMO = 105;
const SITE = { larg: 432, alt: (A - CROMO) / 2.5, dpr: 2.5 }; // 726 → 1080×1815
/** O PC. 1366×768 desce para 1080×607 no screencast e entra centrado na tarja. */
const PC = { larg: 1366, alt: 768, dpr: 1 };

const UA_FONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_PC =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

/** A hunt em que o vídeo abre, e para onde ele volta no fim. */
const HUNT_INICIAL = process.env.HUNT ?? 'monferno_sinnoh';
/** A área escolhida no mapa, no take "dedo tocando a tela para escolher a área". */
const REGIAO_ALVO = process.env.REGIAO ?? 'sinnoh';
const HUNT_ALVO = process.env.HUNT_ALVO ?? 'glaceon_sinnoh';

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const sessao = await sessaoDe(nick);
await fecharBanco();
console.log(`gravando com a conta "${sessao.nick}"  ${L}x${A}`);

const perfil = await mkdtemp(join(tmpdir(), 'reels-'));
const porta = 9400 + Math.floor(Math.random() * 90);
const proc = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--hide-scrollbars', '--mute-audio',
  '--force-device-scale-factor=1', '--allow-file-access-from-files',
  // Sem estes três, o Chrome trata a aba que não está à frente como plano de fundo e estrangula
  // os temporizadores dela. A compositora É uma aba de plano de fundo, e um `setInterval` de
  // 30 Hz estrangulado para 1 Hz deixaria o cromo do navegador digitando um caractere por
  // segundo enquanto o resto do vídeo corre normal.
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required',
  `--window-size=${PC.larg},${PC.alt}`,
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

// ------------------------------------------------------------------------- encanamento CDP

async function conectar(alvo) {
  const ws = new WebSocket(alvo.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
  await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });
  let id = 0;
  const pend = new Map();
  const ouvintes = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method) for (const f of ouvintes) f(m);
  });
  const cmd = (metodo, params = {}) => new Promise((ok) => {
    const meu = ++id; pend.set(meu, ok);
    ws.send(JSON.stringify({ id: meu, method: metodo, params }));
  });
  const js = async (expr, esperar = true) => {
    const r = await cmd('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: esperar,
    });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description ?? 'erro no script');
    }
    return r.result?.result?.value;
  };
  return { ws, cmd, js, ao: (f) => ouvintes.push(f) };
}

async function novaAba(url) {
  const r = await fetch(`http://127.0.0.1:${porta}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return r.json();
}

let alvoInicial;
for (let i = 0; i < 80 && !alvoInicial; i++) {
  try {
    alvoInicial = (await fetch(`http://127.0.0.1:${porta}/json/list`).then((r) => r.json()))
      .find((a) => a.type === 'page' && a.webSocketDebuggerUrl);
  } catch { /* o Chrome ainda não subiu a porta */ }
  if (!alvoInicial) await dormir(250);
}
if (!alvoInicial) throw new Error('Chrome não abriu a porta de debug');

// ------------------------------------------------------------------- a aba compositora
//
// Tudo o que não é o jogo mora aqui: o cromo do navegador, os anéis de toque e o punch-in. É
// de propósito — nada disso toca o DOM do jogo, então nenhum take pode sair com um resto de
// enfeite grudado na tela.
const rec = await conectar(alvoInicial);
await rec.cmd('Runtime.enable');
await rec.cmd('Page.enable');
await rec.cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
await rec.cmd('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
await rec.cmd('Page.navigate', { url: 'about:blank' });
await dormir(400);

const MIMES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
];

await rec.js(`
window.__g = { chunks: [], desenhados: 0, mime: '' };
const c = document.createElement('canvas');
c.width = ${L}; c.height = ${A};
document.body.style.margin = '0';
document.body.appendChild(c);
const ctx = c.getContext('2d', { alpha: false });

/* O último quadro de CADA origem. Guardado (e não desenhado na hora) porque o desenho corre
   num laço próprio: o cromo do navegador precisa animar mesmo quando a página parada não
   manda quadro nenhum. */
const ultimo = { jogo: null, site: null };
window.__fonte = 'site';
window.__bar = { mostrar: false, texto: '', carregando: -1 };
window.__toques = [];
window.__zoom = { f: 1, x: ${L / 2}, y: ${A / 2}, de: 1, ate: 1, t0: 0, ms: 0, ax: ${L / 2}, ay: ${A / 2} };

window.__push = async (tag, b64) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([u8], { type: 'image/jpeg' }));
  const velho = ultimo[tag];
  ultimo[tag] = bmp;
  velho?.close();
};

window.__toque = (x, y) => { window.__toques.push({ x, y, t0: performance.now() }); };
window.__zoomPara = (f, x, y, ms) => {
  const z = window.__zoom;
  z.de = z.f; z.ate = f; z.t0 = performance.now(); z.ms = ms || 1;
  if (x != null) { z.ax = x; z.ay = y; }
};

const suave = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/* ---- o cromo do navegador ----------------------------------------------------------- */
function barraDoNavegador(agora) {
  const b = window.__bar;
  ctx.fillStyle = '#1c1820';
  ctx.fillRect(0, 0, ${L}, ${CROMO});

  /* faixa de status: relógio à esquerda, sinal/wi-fi/bateria à direita */
  ctx.fillStyle = '#f2eef6';
  ctx.font = '600 24px "Segoe UI", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('21:18', 44, 24);
  ctx.textAlign = 'right';
  for (let i = 0; i < 4; i++) {
    const h = 6 + i * 5;
    ctx.fillRect(900 + i * 11, 30 - h, 7, h);
  }
  ctx.beginPath(); ctx.arc(968, 30, 13, Math.PI * 1.15, Math.PI * 1.85); ctx.lineWidth = 4;
  ctx.strokeStyle = '#f2eef6'; ctx.stroke();
  ctx.fillRect(968 - 3, 22, 6, 6);
  ctx.strokeStyle = '#f2eef6'; ctx.lineWidth = 2.5;
  ctx.strokeRect(1000, 13, 34, 18); ctx.fillRect(1036, 18, 4, 8);
  ctx.fillRect(1003, 16, 24, 12);

  /* a pílula do endereço */
  const y0 = 50; const h0 = 44;
  ctx.fillStyle = '#332c3c';
  ctx.beginPath(); ctx.roundRect(28, y0, ${L} - 56, h0, 22); ctx.fill();

  /* lupa */
  ctx.strokeStyle = '#a89bb4'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.arc(64, y0 + 21, 9, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(71, y0 + 28); ctx.lineTo(78, y0 + 35); ctx.stroke();

  ctx.textAlign = 'left';
  ctx.font = '500 26px "Segoe UI", Arial, sans-serif';
  if (b.texto) {
    ctx.fillStyle = '#f4f0f8';
    ctx.fillText(b.texto, 96, y0 + 22);
    if (b.carregando < 0 && Math.floor(agora / 500) % 2 === 0) {
      const w = ctx.measureText(b.texto).width;
      ctx.fillRect(99 + w, y0 + 10, 3, 24);
    }
  } else {
    ctx.fillStyle = '#8b7f97';
    ctx.fillText('Pesquisar ou digitar endereço', 96, y0 + 22);
  }

  /* × / recarregar, na ponta direita da pílula */
  ctx.strokeStyle = '#a89bb4'; ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(1000, y0 + 14); ctx.lineTo(1018, y0 + 32);
  ctx.moveTo(1018, y0 + 14); ctx.lineTo(1000, y0 + 32);
  ctx.stroke();

  /* a linha de carregamento: o sinal de que a página está vindo */
  if (b.carregando >= 0) {
    ctx.fillStyle = '#3c3446';
    ctx.fillRect(0, ${CROMO} - 5, ${L}, 5);
    ctx.fillStyle = '#7b5cd6';
    ctx.fillRect(0, ${CROMO} - 5, ${L} * Math.min(1, b.carregando), 5);
  }
}

/* ---- os anéis de toque --------------------------------------------------------------- */

/* O Node manda o toque em coordenadas do quadro SEM zoom — é o que ele sabe medir, porque o
   que ele mede é a caixa do elemento na página. Quando há punch-in, o desenho por baixo foi
   recortado e ampliado, e o anel tem de andar junto: senão ele cai num canto qualquer da
   tela, longe do botão que acabou de responder. A janela do último desenho fica guardada
   justamente para refazer essa conta. */
function pontoNaTela(t) {
  const j = window.__janela;
  if (!j || j.f <= 1.001) return { x: t.x, y: t.y, e: 1 };
  const sxp = (t.x / ${L}) * j.bw;
  const syp = ((t.y - j.dy0) / j.dh0) * j.bh;
  return {
    x: (sxp - j.sx) * (j.dw / j.sw) + j.dx,
    y: (syp - j.sy) * (j.dh / j.sh) + j.dy,
    e: j.f,
  };
}

function toques(agora) {
  window.__toques = window.__toques.filter((t) => agora - t.t0 < 760);
  for (const t of window.__toques) {
    const p = (agora - t.t0) / 760;
    const a = 1 - p;
    const q = pontoNaTela(t);
    ctx.beginPath();
    ctx.arc(q.x, q.y, (34 + p * 92) * q.e, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,' + (a * 0.85).toFixed(3) + ')';
    ctx.lineWidth = 7 * q.e;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(q.x, q.y, 46 * q.e, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,' + (a * 0.30).toFixed(3) + ')';
    ctx.fill();
  }
}

/* ---- o quadro ------------------------------------------------------------------------ */
function desenhar() {
  const agora = performance.now();
  const z = window.__zoom;
  if (z.ms) {
    const p = Math.min(1, (agora - z.t0) / z.ms);
    z.f = z.de + (z.ate - z.de) * suave(p);
    if (p >= 1) z.ms = 0;
  }

  const bmp = ultimo[window.__fonte];
  ctx.fillStyle = '#0e0a14';
  ctx.fillRect(0, 0, ${L}, ${A});

  if (bmp) {
    /* A PROPORÇÃO decide o enquadramento, e não um modo que eu tenha de trocar na hora certa:
       quadro em pé preenche a tela, quadro deitado (o PC) entra centrado com tarja. É o que
       faz a virada celular→PC não ter um único quadro esticado no meio. */
    const deitado = bmp.width >= bmp.height;
    let dx = 0; let dy = window.__bar.mostrar ? ${CROMO} : 0;
    let dw = ${L}; let dh = ${A} - dy;
    if (deitado) {
      dw = ${L}; dh = Math.round(${L} * bmp.height / bmp.width);
      dx = 0; dy = Math.round((${A} - dh) / 2);
    }
    /* o punch-in recorta a ORIGEM, e não a saída: assim o zoom não come as bordas do quadro */
    let sx = 0; let sy = 0; let sw = bmp.width; let sh = bmp.height;
    if (z.f > 1.001) {
      sw = bmp.width / z.f; sh = bmp.height / z.f;
      sx = (z.ax / ${L}) * bmp.width - sw / 2;
      sy = ((z.ay - dy) / dh) * bmp.height - sh / 2;
      sx = Math.max(0, Math.min(bmp.width - sw, sx));
      sy = Math.max(0, Math.min(bmp.height - sh, sy));
    }
    window.__janela = {
      f: z.f, sx, sy, sw, sh, dx, dy, dw, dh,
      bw: bmp.width, bh: bmp.height,
      dy0: deitado ? dy : (window.__bar.mostrar ? ${CROMO} : 0),
      dh0: deitado ? dh : ${A} - (window.__bar.mostrar ? ${CROMO} : 0),
    };
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh);
    window.__g.desenhados++;
  }

  if (window.__bar.mostrar) barraDoNavegador(agora);
  toques(agora);
}

/* Dois relógios de propósito: o rAF é o que dá o compasso de verdade, e o setInterval é a
   rede de segurança para o caso de a aba de plano de fundo perder o rAF mesmo com as flags. */
const laco = () => { desenhar(); requestAnimationFrame(laco); };
requestAnimationFrame(laco);
setInterval(desenhar, 33);

const mimes = ${JSON.stringify(MIMES)};
const mime = mimes.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
window.__g.mime = mime;
const stream = c.captureStream(30);
const r = new MediaRecorder(stream, {
  mimeType: mime,
  /* 9 Mbps num quadro de 1080×1920: isto é MASTER de edição, não arquivo de landing page. O
     editor vai reenquadrar, dar zoom e reexportar por cima — o que se perde aqui volta como
     bloco na entrega final dele. */
  videoBitsPerSecond: ${Number(process.env.BITRATE ?? 9_000_000)},
});
r.ondataavailable = (e) => { if (e.data.size) window.__g.chunks.push(e.data); };
window.__g.rec = r;
mime;
`);

const mime = await rec.js('window.__g.mime');
if (!mime) throw new Error('nenhum codec de vídeo disponível no MediaRecorder');
const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
const saida = saidaArg.replace(/\.(mp4|webm)$/i, '') + '.' + ext;
console.log(`codec: ${mime}`);

// ------------------------------------------------------------------------- as abas de origem

/** Liga o toque de verdade numa aba: viewport do aparelho, `pointer: coarse` e o UA. */
async function virarCelular(aba, m) {
  await aba.cmd('Emulation.setDeviceMetricsOverride', {
    width: m.larg, height: m.alt, deviceScaleFactor: m.dpr, mobile: true,
    screenWidth: m.larg, screenHeight: m.alt,
  });
  await aba.cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await aba.cmd('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  await aba.cmd('Emulation.setUserAgentOverride', { userAgent: UA_FONE, platform: 'iPhone' });
}

/** O mesmo em sentido contrário: é isto que faz o `mobile.mjs` se desmontar sozinho. */
async function virarPc(aba) {
  await aba.cmd('Emulation.setTouchEmulationEnabled', { enabled: false });
  await aba.cmd('Emulation.setEmitTouchEventsForMouse', { enabled: false });
  await aba.cmd('Emulation.setUserAgentOverride', { userAgent: UA_PC, platform: 'Win32' });
  await aba.cmd('Emulation.setDeviceMetricsOverride', {
    width: PC.larg, height: PC.alt, deviceScaleFactor: PC.dpr, mobile: false,
    screenWidth: PC.larg, screenHeight: PC.alt,
  });
}

// ---- aba do JOGO
const jogo = await conectar(await novaAba('about:blank'));
await jogo.cmd('Runtime.enable');
await jogo.cmd('Page.enable');
await jogo.cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
await virarCelular(jogo, FONE);
// A sessão é semeada ANTES de a página existir: o cliente lê o `localStorage` no boot, e
// injetar depois obrigaria a um reload no meio da gravação.
await jogo.cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))});
                 localStorage.setItem('cfg-som', '0'); } catch (_) {}`,
});
await jogo.cmd('Page.navigate', { url: `${BASE}/app?hunt=${encodeURIComponent(HUNT_INICIAL)}` });

process.stdout.write('  carregando o jogo');
for (let i = 0; i < 16; i++) { await dormir(1000); process.stdout.write('.'); }
process.stdout.write('\n');

// Os dois pop-ups do primeiro login. O do Discord só aparece DEPOIS que as Novidades fecham,
// então não adianta tentar os dois uma vez só — a rodada é em laço.
await jogo.js(`(async () => {
  const s = (m) => new Promise((r) => setTimeout(r, m));
  for (let i = 0; i < 10; i++) {
    document.getElementById('aviso-jogo-ok')?.click();
    document.getElementById('discord-popup-fechar')?.click();
    await s(350);
  }
  return true;
})()`).catch(() => {});

const entrou = await jogo.js(`(() => {
  const p = document.getElementById('portal');
  return !p || p.classList.contains('hidden') || getComputedStyle(p).display === 'none';
})()`);
if (!entrou) {
  console.error('\n[ERRO] o jogo não passou da tela de entrada — a gravação seria só o portal.');
  console.error('       confira se o servidor está no ar e se AUTH_SEGREDO do .env é o mesmo.');
  proc.kill(); await rm(perfil, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
}

/**
 * Leva o treinador ao CENTRO POKÉMON antes de a gravação começar.
 *
 * É o que torna possível a troca de área do roteiro. Trocar de hunt pede 3 s sem dano trocado
 * (`msgBloqueioCombateCurto`, no `sim.mjs`) e, numa área cheia — com um pokémon de AoE batendo
 * em oito selvagens ao mesmo tempo —, essa janela quase não abre: numa das gravações foram 250
 * tentativas em 17 s, todas recusadas, e o take inteiro correu com a ficha da área presa na
 * tela. No Centro não há combate, a trava fica zerada e o "Caçar aqui" passa de primeira.
 *
 * E o Centro é, de quebra, a abertura que o roteiro pedia: o treinador parado na praça com o
 * shiny atrás, ANTES de escolher para onde ir — em vez de o vídeo começar no meio de uma luta
 * que ninguém viu começar.
 *
 * Subir ao Centro esbarra na MESMA trava. A diferença é que aqui é fora de câmera: dá para
 * insistir meio minuto sem que apareça no arquivo.
 */
async function irAoCentro() {
  process.stdout.write('  subindo ao Centro Pokémon');
  const r = await jogo.js(`(async () => {
    const s = (m) => new Promise((r) => setTimeout(r, m));
    let n = 0;
    for (let i = 0; i < 700; i++) {
      const hs = document.getElementById('hunt-saida');
      if (!hs || hs.classList.contains('hidden')) return n;
      const av = document.getElementById('toast');
      const escondido = av ? av.classList.contains('hidden') : true;
      document.getElementById('ir-centro')?.click();
      n++;
      if (av && escondido && !av.classList.contains('hidden')) av.classList.add('hidden');
      await s(70);
    }
    return -1;
  })()`);
  process.stdout.write(r < 0 ? ' — NÃO SUBIU\n' : ` (${r} tentativas)\n`);
  // "você é o único por aqui" é a contagem de gente na praça (`#centro-quantos`). Num servidor
  // de desenvolvimento ela diz a verdade de UMA máquina, e não a do jogo — e um anúncio com
  // "você é o único por aqui" na tela diz o contrário do que o jogo é. Ela sai da cena; o
  // número de verdade continua aparecendo na gaveta da Equipe.
  await jogo.js(`(() => {
    const e = document.createElement('style');
    e.textContent = '#centro-quantos { display: none !important; }';
    document.head.appendChild(e);
    return true;
  })()`).catch(() => {});
  return r >= 0;
}
await irAoCentro();

/**
 * AQUECIMENTO: abre e fecha, antes de gravar, cada tela que o roteiro visita.
 *
 * Na PRIMEIRA abertura o Mapa busca `map-markers.json`, o atlas de retratos e o PNG da região
 * — e a primeira gravação saiu com o mapa-múndi cheio de bolas pretas, porque os retratos
 * chegaram três segundos depois do take. A vitrine e a bolsa têm o mesmo atraso, menor.
 *
 * O aquecimento termina desfazendo o que mexeu (volta para Kanto, volta para a aba Treinador,
 * fecha a gaveta): o vídeo precisa MOSTRAR essas trocas acontecendo.
 */
async function aquecerTelas() {
  const clique = async (sel, ms = 500) => {
    await jogo.js(`(document.querySelector(${JSON.stringify(sel)})?.click(), true)`).catch(() => {});
    await dormir(ms);
  };
  /** Abre a gaveta do Menu sem o risco de FECHÁ-LA: o botão da aba acesa alterna. */
  const abrirMenu = async () => {
    await jogo.js(`(() => {
      const b = document.querySelector('#m-nav button[data-aba="menu"]');
      const aberta = !!document.querySelector('#m-gaveta.aberta');
      if (!aberta || !b?.classList.contains('on')) b?.click();
      return true;
    })()`).catch(() => {});
    await dormir(500);
  };

  process.stdout.write('  aquecendo as telas');

  // ---- o atlas de sprites da ÁREA do roteiro
  //
  // Entrar numa área pela primeira vez baixa o atlas dela, e enquanto isso a cena é uma tela
  // preta com "7 páginas do atlas…" no meio. Essa espera caía em cima do take "a hunt começa",
  // que é justamente o take da virada. Uma visita aqui, com volta ao Centro, deixa tudo em
  // cache — e a troca, no vídeo, é instantânea.
  await abrirMenu();
  await clique('.menu-topo button[data-modal="mapa"]', 1200);
  await clique(`.mapa-area[data-regiao="${REGIAO_ALVO}"]`, 2600);
  await jogo.js(`(() => {
    const m = document.querySelector('.marcador[data-slug="${HUNT_ALVO}"]');
    m?.scrollIntoView({ block: 'center', inline: 'center' });
    m?.click();
    return !!m;
  })()`).catch(() => {});
  await dormir(900);
  await clique('.ha-cacar', 8000);
  process.stdout.write('.');
  await irAoCentro();

  // ---- as telas do roteiro, na ordem em que o vídeo as visita
  await abrirMenu();
  await clique('.menu-topo button[data-modal="mapa"]', 1400);
  await clique('.mapa-area[data-regiao="kanto"]', 2200);
  await clique('#modal-fechar', 500);
  process.stdout.write('.');
  await clique('.menu-topo button[data-modal="community"]', 2800);
  await clique('#modal-fechar', 500);
  await clique('#m-nav button[data-aba="bolsa"]', 1200);
  await clique('.bolsa-aba[data-aba="raros"]', 1200);
  await clique('.bolsa-aba[data-aba="treinador"]', 800);
  await clique('#modal-fechar', 500);
  process.stdout.write('.');
  // a gaveta fica aberta depois de uma tela subir: o botão da aba ACESA é quem a fecha
  await jogo.js(`(() => {
    if (!document.querySelector('#m-gaveta.aberta')) return false;
    document.querySelector('#m-nav .m-nav-btn.on')?.click();
    return true;
  })()`).catch(() => {});
  await dormir(600);
  process.stdout.write('\n');
}
await aquecerTelas();

// ---- aba do SITE (o gancho: navegador abrindo pokeidle.io)
const site = await conectar(await novaAba('about:blank'));
await site.cmd('Runtime.enable');
await site.cmd('Page.enable');
await site.cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
await virarCelular(site, SITE);
// Uma passada pela landing ANTES de gravar, só para encher o cache. Sem isto o take do gancho
// mostraria a página nascendo em pedaços — o que é verdade, mas é a verdade de um cache frio,
// e não a que o jogador vê quando chega pelo anúncio.
await site.cmd('Page.navigate', { url: `${BASE_SITE}/` });
await dormir(4000);
await site.cmd('Page.navigate', { url: 'about:blank' });
await dormir(600);
await site.js(`document.body.style.background = '#ffffff'; true;`).catch(() => {});

// ------------------------------------------------------------------------- roteamento de quadros

let recebidos = 0;
function ligarFluxo(aba, tag) {
  aba.ao((m) => {
    if (m.method !== 'Page.screencastFrame') return;
    recebidos++;
    // O ack PRIMEIRO: sem ele o Chrome não manda o quadro seguinte e o fluxo morre no segundo.
    aba.cmd('Page.screencastFrameAck', { sessionId: m.params.sessionId });
    rec.js(`window.__push('${tag}', ${JSON.stringify(m.params.data)})`, false).catch(() => {});
  });
}
ligarFluxo(jogo, 'jogo');
ligarFluxo(site, 'site');

const OPCOES_CAST = { format: 'jpeg', quality: 84, maxWidth: L, maxHeight: A, everyNthFrame: 1 };
let fonteAtual = null;

/**
 * Troca a origem do vídeo.
 *
 * Liga o screencast novo ANTES de desligar o velho e dá uma folga para o primeiro quadro
 * chegar: uma origem sem quadro nenhum é um retângulo preto, e o corte sairia com um piscão.
 */
async function trocarFonte(tag) {
  if (fonteAtual === tag) return;
  const nova = tag === 'jogo' ? jogo : site;
  const velha = fonteAtual === 'jogo' ? jogo : fonteAtual === 'site' ? site : null;
  await nova.cmd('Page.startScreencast', OPCOES_CAST);
  await dormir(420);
  await rec.js(`window.__fonte = '${tag}'; true;`);
  if (velha) await velha.cmd('Page.stopScreencast');
  fonteAtual = tag;
}

// ------------------------------------------------------------------------------ o dedo

/** Onde, no quadro final, cai um ponto da página. */
function paraCanvas(x, y, comCromo) {
  return { x: Math.round(x * FONE.dpr), y: Math.round(y * FONE.dpr + (comCromo ? CROMO : 0)) };
}

const bar = (o) => rec.js(`Object.assign(window.__bar, ${JSON.stringify(o)}); true;`);
const zoom = (f, x = L / 2, y = A / 2, ms = 700) => rec.js(`window.__zoomPara(${f}, ${x}, ${y}, ${ms}); true;`);
const semZoom = (ms = 500) => rec.js(`window.__zoomPara(1, null, null, ${ms}); true;`);

/**
 * Toca num elemento: traz para a vista, pinta o anel onde ele está e só então clica.
 *
 * O anel vem ANTES do clique de propósito — é a ordem de um dedo de verdade, e é o que faz o
 * take "dedo tocando a tela" ler como toque, e não como tela que muda sozinha.
 */
async function tocar(aba, sel, { cromo = false, espera = 260, rolar = true } = {}) {
  const r = await aba.js(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    ${rolar ? `el.scrollIntoView({ block: 'center', inline: 'center' });` : ''}
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, ok: b.width > 0 };
  })()`);
  if (!r) { console.log(`    (sem alvo: ${sel})`); return false; }
  if (rolar) await dormir(240);
  const r2 = await aba.js(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  })()`);
  const p = paraCanvas((r2 ?? r).x, (r2 ?? r).y, cromo);
  await rec.js(`window.__toque(${p.x}, ${p.y}); true;`);
  await dormir(espera);
  await aba.js(`(document.querySelector(${JSON.stringify(sel)})?.click(), true)`);
  return true;
}

/** Um anel sem clique — quando o dedo só aponta (o take do "close no dedo"). */
async function apontar(aba, sel, { cromo = false, rolar = false } = {}) {
  if (rolar) {
    await aba.js(`(document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'center' }), true)`);
    await dormir(260);
  }
  const r = await aba.js(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  })()`);
  if (!r) return null;
  const p = paraCanvas(r.x, r.y, cromo);
  await rec.js(`window.__toque(${p.x}, ${p.y}); true;`);
  return p;
}

/**
 * "Caçar aqui", com a trava de combate no caminho.
 *
 * Trocar de área pede 3 s sem dano trocado — a mesma regra do Centro Pokémon
 * (`restaCombateHuntMs`, no app.js). Com o pokémon batendo sozinho, esse instante é o vão
 * entre um mob que morreu e o próximo que nasce, e ele não dá para marcar no relógio: o
 * primeiro toque é quase sempre recusado.
 *
 * Então o dedo toca UMA vez, como tocaria o de um jogador, e daí o botão é insistido em
 * silêncio. Cada recusa escreve o aviso no `#toast`; escondê-lo no MESMO tique em que ele
 * nasce faz com que ele nunca chegue a pintar um quadro — o vídeo mostra a área trocando, e
 * não o jogo dizendo "não".
 */
async function cacarAqui() {
  await apontar(jogo, '.ha-cacar', { rolar: true });
  await dormir(300);
  // A insistência corre DENTRO da página, e não daqui: a janela livre dura menos de um
  // segundo, e um laço de ida e volta pelo CDP a cada tentativa é lento o bastante para
  // passar por cima dela (foi o que aconteceu — trinta tentativas, trinta recusas).
  const r = await jogo.js(`(async () => {
    const s = (m) => new Promise((r) => setTimeout(r, m));
    let tentativas = 0;
    for (let i = 0; i < 60; i++) {
      const ha = document.getElementById('hunt-analyser');
      if (!ha || ha.classList.contains('hidden')) return tentativas;
      const av = document.getElementById('toast');
      const escondido = av ? av.classList.contains('hidden') : true;
      document.querySelector('.ha-cacar')?.click();
      tentativas++;
      if (av && escondido && !av.classList.contains('hidden')) av.classList.add('hidden');
      await s(70);
    }
    return -1;
  })()`);
  if (r < 0) {
    // A janela livre é curta e pode simplesmente não aparecer em seis segundos de área
    // cheia. Quando não aparece, a ficha e o mapa fecham do mesmo jeito: o take vira
    // "abriu o mapa, leu a área e voltou para a luta", que continua sendo um take — melhor
    // do que o resto do vídeo correr com um modal preso na tela.
    console.log('    [aviso] a trava de combate não abriu: a ÁREA NÃO TROCOU (rode de novo)');
    await jogo.js(`(document.getElementById('ha-fechar')?.click(), true)`).catch(() => {});
    await dormir(250);
    await jogo.js(`(document.getElementById('modal-fechar')?.click(), true)`).catch(() => {});
    return false;
  }
  if (r > 1) console.log(`    (a área trocou na ${r}ª insistência)`);
  return true;
}

/**
 * Fecha a gaveta do rodape.
 *
 * Ela NAO fecha sozinha quando um modal sobe -- e de proposito no jogo ("a gaveta do Menu
 * fica aberta quando uma tela sobe", em `mobile.mjs`), para a navegacao nao ficar picotada.
 * Num video isso e outra coisa: o modal fecha e a cena reaparece espremida no terco de cima,
 * com a grade do menu ocupando o resto. Quem fecha e o botao da aba ACESA, que alterna.
 */
const fecharGaveta = () => jogo.js(`(() => {
  if (!document.querySelector('#m-gaveta.aberta')) return false;
  document.querySelector('#m-nav .m-nav-btn.on')?.click();
  return true;
})()`).catch(() => false);

/** Fecha o que estiver aberto por cima da cena. */
const fecharTudo = () => jogo.js(`(() => {
  document.getElementById('modal-fechar')?.click();
  document.querySelector('#m-gaveta.aberta') && document.querySelector('.m-nav-btn.on')?.click();
  return true;
})()`).catch(() => {});

// ------------------------------------------------------------------------------ o roteiro
//
// Cada take é uma entrada aqui, com o tempo que ele FICA no ar. Os blocos são os do briefing —
// gancho, gameplay, progressão, economia, celular+PC e fecho — e os nomes saem no terminal com
// o carimbo de tempo, que é o que vira o mapa de cortes entregue junto do arquivo.

const marcas = [];
let t0 = 0;
async function take(bloco, nome, ms, faz) {
  const inicio = (Date.now() - t0) / 1000;
  if (faz) await faz();
  const gasto = (Date.now() - t0) / 1000 - inicio;
  const resta = ms / 1000 - gasto;
  if (resta > 0) await dormir(resta * 1000);
  const fim = (Date.now() - t0) / 1000;
  marcas.push({ bloco, nome, inicio, fim });
  console.log(`  ${bloco.padEnd(11)} ${nome.padEnd(30)} ${inicio.toFixed(1)}s → ${fim.toFixed(1)}s`);
}

await trocarFonte('site');
await bar({ mostrar: true, texto: '', carregando: -1 });
await dormir(300);

await rec.js(`window.__g.rec.start(1000); true;`);
t0 = Date.now();

// ---------------------------------------------------------------- GANCHO
await take('GANCHO', 'aba nova, barra vazia', 600);

await take('GANCHO', 'digitando pokeidle.io', 1300, async () => {
  const url = 'pokeidle.io';
  for (let i = 1; i <= url.length; i++) {
    await bar({ texto: url.slice(0, i) });
    await dormir(85);
  }
});

await take('GANCHO', 'entrando no site', 700, async () => {
  await bar({ carregando: 0.08 });
  await site.cmd('Page.navigate', { url: `${BASE_SITE}/` });
  for (let i = 1; i <= 6; i++) { await bar({ carregando: i / 6 }); await dormir(70); }
  await bar({ carregando: -1 });
});

await take('GANCHO', 'landing + toque em JOGAR', 1400, async () => {
  await dormir(450);
  await tocar(site, '.cta-grande', { cromo: true, rolar: false, espera: 420 });
});

await take('GANCHO', 'o jogo carregando', 900, async () => {
  await bar({ carregando: 0.2 });
  for (let i = 2; i <= 9; i++) { await bar({ carregando: i / 10 }); await dormir(95); }
});

// ---------------------------------------------------------------- GAMEPLAY NO CELULAR
await take('GAMEPLAY', 'o treinador na praça (corte)', 1400, async () => {
  await trocarFonte('jogo');
  await bar({ mostrar: false });
});

await take('GAMEPLAY', 'Menu → Mapa', 1400, async () => {
  await tocar(jogo, '#m-nav button[data-aba="menu"]', { rolar: false });
  await dormir(420);
  await tocar(jogo, '.menu-topo button[data-modal="mapa"]');
});

await take('GAMEPLAY', `mapa-múndi · aba ${REGIAO_ALVO}`, 1000, async () => {
  await tocar(jogo, `.mapa-area[data-regiao="${REGIAO_ALVO}"]`);
});

await take('GAMEPLAY', `dedo escolhe a área (${HUNT_ALVO})`, 1400, async () => {
  await dormir(420);
  await zoom(1.28, L / 2, A / 2, 900);
  await tocar(jogo, `.marcador[data-slug="${HUNT_ALVO}"]`, { espera: 380 });
});

await take('GAMEPLAY', 'ficha da área + Caçar', 1400, async () => {
  // Abre o quadro ANTES de tocar. A ficha da área ocupa a tela inteira no celular e o
  // "Caçar aqui" mora no rodapé dela: com o punch-in do take anterior ainda de pé, o dedo
  // apertava um botão que ficava fora do enquadramento.
  await semZoom(420);
  await dormir(480);
  await cacarAqui();
});

await take('GAMEPLAY', 'a hunt começa', 1400, async () => {
  // A gaveta do Menu ficou aberta desde o toque em "Mapa": descê-la é o que revela a área
  // nova inteira, e a descida em si já é o movimento que abre o bloco de progressão.
  await fecharGaveta();
});

// ---------------------------------------------------------------- PROGRESSÃO / FARM
await take('PROGRESSAO', 'batalha rolando sozinha', 1600);

await take('PROGRESSAO', 'barra de XP subindo', 1500, async () => {
  // O assunto do take é a FAIXA DO TOPO: nível, ouro, diamante e a barra de XP andando.
  // Fechar nela é o que separa este take do anterior, que é a mesma tela inteira.
  await zoom(1.55, L / 2, 150, 750);
});

await take('PROGRESSAO', 'loot e pokémon obtidos', 1400, async () => {
  await zoom(1.3, L / 2, A - 560, 800);
});

await take('PROGRESSAO', 'abre o inventário', 1300, async () => {
  await semZoom(450);
  await dormir(380);
  await tocar(jogo, '#m-nav button[data-aba="bolsa"]', { rolar: false });
});

// ---------------------------------------------------------------- ECONOMIA
await take('ECONOMIA', 'bolsa · Itens Raros', 1200, async () => {
  await dormir(380);
  await tocar(jogo, '.bolsa-aba[data-aba="raros"]');
});

await take('ECONOMIA', 'seleciona um item', 1100, async () => {
  await dormir(320);
  await apontar(jogo, '.bolsa-grade .bolsa-card:nth-child(2), .bolsa-grade .bolsa-card');
  await zoom(1.25, L / 2, A / 2, 700);
});

await take('ECONOMIA', 'entra no Community Market', 1400, async () => {
  // Fecha na GRADE DO MENU, e não na tela inteira: entre a Bolsa descer e a vitrine subir, a
  // cena leva um tique para voltar a pintar, e nesse tique ela é um retângulo preto. Com o
  // quadro na grade, o preto fica de fora — e o take passa a ser o que ele de fato é: o dedo
  // escolhendo RMT numa lista de dez telas.
  await zoom(1.42, L / 2, A * 0.70, 380);
  await fecharTudo();
  await dormir(200);
  await tocar(jogo, '#m-nav button[data-aba="menu"]', { rolar: false, espera: 200 });
  await dormir(340);
  await tocar(jogo, '.menu-topo button[data-modal="community"]');
  await semZoom(360);
});

await take('ECONOMIA', 'vitrine · anúncios de verdade', 1500, async () => {
  await dormir(800);
  await jogo.js(`(() => { const l = document.getElementById('cm-lista'); if (l) l.scrollTop = 0; return true; })()`);
  await apontar(jogo, '#cm-lista .cm-card.shiny, #cm-lista .cm-card');
});

await take('ECONOMIA', 'toca em anunciar', 1200, async () => {
  await tocar(jogo, '#cm-anunciar', { rolar: false, espera: 380 });
});

// ---------------------------------------------------------------- CELULAR + PC
await take('CEL+PC', 'volta para a cena (celular)', 1100, async () => {
  await fecharTudo();
  await dormir(300);
  await fecharTudo();
});

await take('CEL+PC', 'MESMA conta, no PC', 2400, async () => {
  await virarPc(jogo);
});

await take('CEL+PC', 'e de volta ao celular', 1000, async () => {
  await virarCelular(jogo, FONE);
});

// ---------------------------------------------------------------- FECHO
await take('FINAL', 'o shiny em campo', 1500, async () => {
  await dormir(280);
  await tocar(jogo, '#m-nav button[data-aba="equipe"]', { rolar: false });
});

await take('FINAL', 'batalha bonita (zoom na cena)', 2100, async () => {
  // O mesmo botão da aba ativa FECHA a gaveta (`alternarAba`, no mobile.mjs) — é o caminho
  // de volta à cena cheia sem passar por outra tela.
  await tocar(jogo, '#m-nav button[data-aba="equipe"]', { rolar: false });
  // O zoom da CENA só anda quando `campo.podeAproximar` — num viewport de telefone ele já
  // nasce no teto, e o clique não movia nada. Quem aproxima aqui é a composição, e ela começa
  // junto com o take: uma rampa que só termina depois do corte não aparece no vídeo.
  await jogo.js(`document.getElementById('cena-zoom-mais')?.click()`).catch(() => {});
  await zoom(1.45, L / 2, A * 0.40, 900);
});

await take('FINAL', 'o mapa do mundo', 1900, async () => {
  await semZoom(420);
  await jogo.js(`document.getElementById('cena-zoom-menos')?.click()`).catch(() => {});
  await tocar(jogo, '#m-nav button[data-aba="menu"]', { rolar: false });
  await dormir(450);
  await tocar(jogo, '.menu-topo button[data-modal="mapa"]');
  await dormir(600);
  // Kanto para fechar: é o mapa com mais marcador à vista, e o retrato de cada área é o
  // pokémon que mora nela — uma parede de bichos conhecidos, que é o que o fecho pede.
  await tocar(jogo, '.mapa-area[data-regiao="kanto"]');
  await dormir(500);
  await zoom(1.14, L / 2, A / 2, 1100);
});

// ------------------------------------------------------------------------- fecha o arquivo
await jogo.cmd('Page.stopScreencast').catch(() => {});
await site.cmd('Page.stopScreencast').catch(() => {});
// Um respiro para a fila de desenho esvaziar antes de fechar o arquivo — senão o último
// segundo sai congelado no quadro anterior.
await dormir(700);

// `requestData()` antes do `stop()`: sem isso o vídeo termina até 1 s antes do que se gravou
// (o intervalo do `start(1000)` fica pendurado).
const b64 = await rec.js(`
  new Promise((ok) => {
    const g = window.__g;
    g.rec.onstop = async () => {
      const buf = await new Blob(g.chunks).arrayBuffer();
      const b = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      ok(btoa(s));
    };
    g.rec.requestData();
    g.rec.stop();
  })
`);
const desenhados = await rec.js('window.__g.desenhados');
const buf = Buffer.from(b64, 'base64');
await writeFile(saida, buf);

const seg = (Date.now() - t0) / 1000;
console.log(`\nok: ${saida}`);
console.log(`    ${L}x${A} · ${seg.toFixed(1)}s · ${(buf.length / 1048576).toFixed(2)} MB · ${mime}`);
console.log(`    ${recebidos} quadros recebidos, ${desenhados} desenhos (${(desenhados / seg).toFixed(1)}/s)`);

// O mapa de cortes, no formato que o editor lê: bloco, take e os segundos de entrada e saída.
console.log('\nMAPA DE CORTES');
for (const m of marcas) {
  console.log(`  ${m.inicio.toFixed(1).padStart(5)}s  ${m.bloco.padEnd(11)} ${m.nome}`);
}
await writeFile(saida.replace(/\.(mp4|webm)$/i, '-cortes.json'), JSON.stringify(marcas, null, 2));

// A conta volta para a hunt em que estava: uma ferramenta de gravação não pode deixar a conta
// do dono caçando noutro lugar por causa de um take.
//
// Pela URL, e não pelo mapa: `?hunt=` manda o `hunt.select` no boot (ver `app.js`), e no boot
// ninguém está em combate — é o único caminho que não depende da trava de 3 s abrir.
try {
  await jogo.cmd('Page.navigate', { url: `${BASE}/app?hunt=${encodeURIComponent(HUNT_INICIAL)}` });
  await dormir(20000);
  const onde = await jogo.js(`document.querySelector('.hunt-plaqueta, .cena-hunt')?.textContent?.trim() ?? ''`);
  console.log(`\n    hunt devolvida para ${HUNT_INICIAL}${onde ? ` (${onde.slice(0, 40)})` : ''}`);
} catch {
  console.log(`\n    [aviso] não deu para devolver a hunt: a conta ficou em ${HUNT_ALVO}`);
}

rec.ws.close(); jogo.ws.close(); site.ws.close(); proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(0);
