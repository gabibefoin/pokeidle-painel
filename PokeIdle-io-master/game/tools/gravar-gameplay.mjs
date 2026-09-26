// Grava um VÍDEO da gameplay — o material da landing page e dos criativos em movimento.
//
//   node tools/gravar-gameplay.mjs <saida.webm> [nick] [larg] [alt]
//   node tools/gravar-gameplay.mjs ../divulgacao/gameplay.webm fasi 1280 800
//
// Precisa do servidor local no ar (`npm start`, com `docker compose up -d`).
//
// ---------------------------------------------------------------------------- como funciona
//
// Não existe ffmpeg nesta máquina, e não é preciso: quem codifica é o próprio Chrome. São
// DUAS abas, e a separação é o ponto principal deste arquivo:
//
//     aba do JOGO  ──(CDP Page.startScreencast: JPEG por quadro)──▶  Node
//                                                                     │
//     aba GRAVADORA ◀──(Runtime.evaluate: __push(b64))────────────────┘
//         canvas ──▶ captureStream(30) ──▶ MediaRecorder ──▶ WebM/VP9
//
// ### Por que NÃO `getDisplayMedia`
//
// A primeira versão usava `getDisplayMedia()` com `--auto-select-desktop-capture-source=Entire
// screen`, que é o caminho curto e funciona. Só que "Entire screen" num Chrome headless **é o
// monitor de verdade da máquina** — a gravação saiu com a área de trabalho do dono, com o jogo
// que ele tinha aberto na hora. Passou nos testes (o arquivo existia, tinha 39 s e abria) e
// só foi pega ao olhar os quadros.
//
// `Page.startScreencast` não tem esse risco: ele fotografa o alvo do depurador e mais nada.
// Uma ferramenta de gravação não pode ter um modo de falha em que ela filma o que não devia,
// então este arquivo troca simplicidade por essa garantia — de propósito, e não volte atrás.
//
// ### As armadilhas do caminho de duas abas
//
//   · **Backpressure é obrigatório.** Cada quadro só chega depois do `screencastFrameAck` do
//     anterior. Sem o ack o fluxo simplesmente para no segundo quadro.
//   · **JPEG, não PNG.** PNG a 1280×800 dá ~700 KB por quadro; a 25 fps são 17 MB/s pelo
//     WebSocket do CDP, e o Node vira gargalo. `quality: 92` segura o artefato em pixel art.
//   · **`captureStream(30)` amostra o canvas sozinho**, em tempo real. É o que faz a duração
//     do vídeo bater com a da gravação sem eu ter de acertar compasso na mão.
//
// ------------------------------------------------------------------------------- o roteiro
//
// `ROTEIRO` é a gameplay em si: uma lista de cenas, com o que clicar e quanto tempo ficar.
// Fica separada porque é a única parte que muda quando o jogo ganha tela nova — e porque
// vídeo de divulgação é edição, não sorte: sem roteiro a gravação vira dois minutos de um
// Charizard andando.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { sessaoDe, fecharBanco } from './sessao-local.mjs';

const [saida, nick = 'fasi', LARG = 1280, ALT = 800] = process.argv.slice(2);
if (!saida) {
  console.error('uso: node tools/gravar-gameplay.mjs <saida.webm> [nick] [larg] [alt]');
  process.exit(1);
}
const L = Number(LARG); const A = Number(ALT);
const URL_JOGO = (process.env.HTTP_URL ?? 'http://localhost:8080') + '/app';

/**
 * As cenas. `ms` é quanto a cena FICA no ar; `faz` é o que acontece ao entrar nela.
 *
 * A ordem não é a do menu — é a da venda. Abre na luta (o produto), passa pelo mundo (o
 * tamanho), pela coleção (o colecionável), pelo mercado (a economia), pelo PvP e pelo ranking
 * (a gente), e volta para a luta, que é onde o vídeo emenda quando entra em loop na landing
 * page.
 *
 * Mínimo de 3,5 s por cena: abaixo disso o olho não termina de ler uma tela cheia de
 * interface e o corte fica com cara de erro de gravação.
 */
const ROTEIROS = {
  /** O tour completo — o vídeo de "ver gameplay", de YouTube e de anúncio em vídeo. */
  tour: [
  { nome: 'hunt',      ms: 6000, faz: null },
  { nome: 'mapa',      ms: 4500, faz: 'modal:mapa' },
  { nome: 'pokedex',   ms: 4000, faz: 'modal:pokedex' },
  { nome: 'market',    ms: 3500, faz: 'modal:market' },
  { nome: 'mercado',   ms: 4500, faz: 'modal:community' },
  { nome: 'pvp',       ms: 4000, faz: 'modal:pvp' },
  { nome: 'ranking',   ms: 4000, faz: 'modal:ranking' },
  { nome: 'bosses',    ms: 3500, faz: 'modal:bosses' },
  { nome: 'volta',     ms: 5500, faz: 'fechar' },
  ],

  /**
   * O LAÇO do topo da landing page: só a caça, curto e leve o bastante para tocar sozinho no
   * celular. Um vídeo de 12 MB em `autoplay` custa o pacote de dados de quem chegou pelo
   * anúncio, e a página pinta antes de ele existir — quem decide em dois segundos já rolou.
   *
   * Sem modal nenhum de propósito: o laço tem de emendar o fim no começo sem costura, e uma
   * tela que abre e fecha denuncia o corte.
   */
  loop: [
    { nome: 'caca', ms: 13000, faz: null },
  ],
};

const ROTEIRO = ROTEIROS[process.env.ROTEIRO ?? 'tour'] ?? ROTEIROS.tour;

// A Casa saiu do roteiro: o botão abre, mas a conta da gravação não tem casa e a tela responde
// "Você não possui uma casa!". Cena de anúncio não pode ser um aviso de erro. Para pôr a Casa
// de volta, dê uma primeiro (`node tools/dar-casa.mjs <nick> lendaria`).

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const sessao = await sessaoDe(nick);
await fecharBanco();
console.log(`gravando com a conta "${sessao.nick}"  ${L}x${A}`);

const perfil = await mkdtemp(join(tmpdir(), 'grav-'));
const porta = 9500 + Math.floor(Math.random() * 400);
const proc = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--hide-scrollbars', '--mute-audio',
  '--force-device-scale-factor=1', '--allow-file-access-from-files',
  `--window-size=${L},${A}`,
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Uma conexão CDP por aba. */
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

async function abrir(url) {
  const r = await fetch(`http://127.0.0.1:${porta}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return r.json();
}

// A primeira aba (about:blank) vira a GRAVADORA; a do jogo é criada depois.
let alvoInicial;
for (let i = 0; i < 80 && !alvoInicial; i++) {
  try {
    alvoInicial = (await fetch(`http://127.0.0.1:${porta}/json/list`).then((r) => r.json()))
      .find((a) => a.type === 'page' && a.webSocketDebuggerUrl);
  } catch {}
  if (!alvoInicial) await dormir(250);
}
if (!alvoInicial) throw new Error('Chrome não abriu a porta de debug');

// ------------------------------------------------------------------ aba gravadora
const rec = await conectar(alvoInicial);
await rec.cmd('Runtime.enable');
await rec.cmd('Page.enable');
await rec.cmd('Page.navigate', { url: 'about:blank' });
await dormir(400);
await rec.js(`
  window.__g = { chunks: [], fila: 0, desenhados: 0 };
  const c = document.createElement('canvas');
  c.width = ${L}; c.height = ${A};
  document.body.appendChild(c);
  const ctx = c.getContext('2d', { alpha: false });
  ctx.fillStyle = '#1a1020'; ctx.fillRect(0, 0, c.width, c.height);

  /* Um quadro do screencast. \`createImageBitmap\` decodifica fora da thread principal, o que
     importa: com \`new Image()\` + onload a decodificação disputa com o próprio desenho e o
     canvas passa a engasgar acima de ~15 fps. */
  window.__push = async (b64) => {
    window.__g.fila++;
    try {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([u8], { type: 'image/jpeg' }));
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      window.__g.desenhados++;
    } finally { window.__g.fila--; }
  };

  /* \`captureStream(30)\` amostra o canvas sozinho, pelo relógio de verdade — é o que faz a
     duração do arquivo bater com a da gravação sem acertar compasso na mão. */
  const stream = c.captureStream(30);
  const r = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp9',
    /* 3 Mbps: acima disso o arquivo passa de 15 MB e a landing page demora a pintar; abaixo,
       o xadrez do fundo (área grande de cor chapada que muda a cada passo do boneco) começa
       a formar bloco. Pixel art perdoa pouco compressão. */
    videoBitsPerSecond: ${Number(process.env.BITRATE ?? 3_000_000)},
  });
  r.ondataavailable = (e) => { if (e.data.size) window.__g.chunks.push(e.data); };
  window.__g.rec = r;
  true;
`);

// ---------------------------------------------------------------------- aba do jogo
const alvoJogo = await abrir('about:blank');
const jogo = await conectar(alvoJogo);
await jogo.cmd('Runtime.enable');
await jogo.cmd('Page.enable');
// Viewport CRAVADA: o `--window-size` do Chrome conta a moldura da janela junto, e sem isto o
// vídeo sairia alguns pixels menor que o pedido.
await jogo.cmd('Emulation.setDeviceMetricsOverride', {
  width: L, height: A, deviceScaleFactor: 1, mobile: false,
});
// A sessão é semeada ANTES de a página existir: o cliente lê o `localStorage` no boot, e
// injetar depois obrigaria a um reload no meio da gravação.
await jogo.cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))});
                 localStorage.setItem('cfg-som', '0'); } catch (_) {}`,
});
// `?hunt=` cai DIRETO na área de caça. Sem ele todo login começa na praça do Centro Pokémon
// (é regra do jogo, ver ARQUITETURA.md) — e o vídeo abria com o herói parado numa praça, que é
// justamente a única tela do jogo onde não acontece combate. O produto é a luta; ela tem de
// estar no primeiro segundo.
const hunt = process.env.HUNT ? `?hunt=${encodeURIComponent(process.env.HUNT)}` : '';
await jogo.cmd('Page.navigate', { url: URL_JOGO + hunt });

// O boot do jogo é longo (atlas de sprites, mapas, walkgrids). 15 s com folga; se a barra
// ainda estiver na tela, o vídeo abre com um carregamento.
process.stdout.write('  carregando o jogo');
for (let i = 0; i < 15; i++) { await dormir(1000); process.stdout.write('.'); }
process.stdout.write('\n');
await jogo.js(`document.getElementById('discord-popup-fechar')?.click()`).catch(() => {});
await dormir(500);

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

// ------------------------------------------------------------------------- gravação
let recebidos = 0;
jogo.ao((m) => {
  if (m.method !== 'Page.screencastFrame') return;
  recebidos++;
  // O ack PRIMEIRO: sem ele o Chrome não manda o quadro seguinte e o fluxo morre no segundo.
  jogo.cmd('Page.screencastFrameAck', { sessionId: m.params.sessionId });
  // Sem `await`: o desenho acontece na aba gravadora e não deve segurar o próximo quadro.
  rec.js(`window.__push(${JSON.stringify(m.params.data)})`, false).catch(() => {});
});

await rec.js(`window.__g.rec.start(1000); true;`);
await jogo.cmd('Page.startScreencast', {
  format: 'jpeg', quality: 92, maxWidth: L, maxHeight: A, everyNthFrame: 1,
});
await dormir(600);

const clicar = (sel) => jogo.js(`(document.querySelector(${JSON.stringify(sel)})?.click(), true)`);

const t0 = Date.now();
for (const cena of ROTEIRO) {
  if (cena.faz?.startsWith('modal:')) {
    await clicar(`.menu-topo button[data-modal="${cena.faz.slice(6)}"]`);
  } else if (cena.faz === 'fechar') {
    await clicar('#modal-fechar');
  }
  await dormir(cena.ms);
  console.log(`  · ${cena.nome.padEnd(8)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

await jogo.cmd('Page.stopScreencast');
// Um respiro para a fila de desenho esvaziar antes de fechar o arquivo — senão o último
// segundo sai congelado no quadro anterior.
await dormir(800);

// `requestData()` antes do `stop()`: sem isso o vídeo termina até 1 s antes do que se gravou
// (o intervalo do `start(1000)` fica pendurado).
const b64 = await rec.js(`
  new Promise((ok) => {
    const g = window.__g;
    g.rec.onstop = async () => {
      const buf = await new Blob(g.chunks, { type: 'video/webm' }).arrayBuffer();
      const b = new Uint8Array(buf);
      let s = '';
      // Em pedaços: um \`String.fromCharCode(...b)\` com milhões de argumentos estoura a pilha.
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
console.log(`    ${L}x${A} · ${seg.toFixed(1)}s · ${(buf.length / 1048576).toFixed(2)} MB`);
console.log(`    ${recebidos} quadros recebidos, ${desenhados} desenhados (${(desenhados / seg).toFixed(1)} fps)`);

rec.ws.close(); jogo.ws.close(); proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(0);
