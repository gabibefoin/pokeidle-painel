// Modo Pop-up — o jogo roda numa janelinha que fica SEMPRE em primeiro plano, para
// acompanhar o idle com o resto da tela livre para outra coisa.
//
// Três caminhos:
//
//   · Chrome/Edge (desktop) → Document Picture-in-Picture: janela do SO com HTML completo.
//   · Android (Chrome) → espelho do `#cena` num `<video>` que entra no PiP DO SISTEMA: a
//     bolinha flutuante que fica por cima do WhatsApp, do Discord, da tela inicial. É o mesmo
//     recurso do YouTube ao apertar Home, e é o único caminho que sai do navegador — o
//     Document PiP não existe no Android.
//   · Firefox/Safari/iOS sem PiP → cartão `position: fixed` arrastável, só dentro do jogo.
//
// ### O PiP do Android, e por que ele não abria
//
// `requestPictureInPicture()` recusa um `<video>` que ainda não carregou metadados, e um
// espelho de `captureStream` nasce sempre assim: o `srcObject` acabou de ser posto e o
// primeiro quadro só chega no quadro seguinte. O pedido saía ~1 ms depois de trocar o
// `srcObject`, a promessa era recusada e o `catch` engolia o erro — do lado de fora parecia
// que o botão não fazia nada. Agora o espelho é preparado UMA vez e o pedido espera o
// primeiro quadro (`primeiroQuadro`), que chega em dezenas de milissegundos e cabe com folga
// nos 5 s de ativação transitória que o Chrome dá a partir do toque.
//
// A outra metade: com a aba escondida atrás de outro aplicativo o navegador PARA o
// `requestAnimationFrame`, e a bolha congelaria na última imagem. Enquanto ela está aberta um
// relógio chama `campo.quadro()` na mão — o navegador limita esse relógio a ~1×/s numa aba
// escondida, então a cena anda devagar lá fora, mas ANDA: o ouro, o XP e a hunt continuam
// visíveis, que é para isso que se abre a janelinha.
//
// ### Move, não copia
//
// Nada aqui espelha nem redesenha a cena. Ao abrir, o `<canvas id="cena">` DE VERDADE é
// realocado para dentro da janelinha — o loop de render do próprio jogo (`Campo.loop`)
// continua desenhando nele, agora numa janela que o navegador mantém viva mesmo com a aba do
// jogo escondida. É o mesmo princípio do `mobile.mjs` ("mover, nunca copiar"), e é o que o
// jogo de referência faz. Sem loop paralelo, sem `drawImage` de espelho, sem lag que cresce.
//
// No lugar da cena, a página do jogo mostra um recado ("rodando na janelinha Pocket"). Ao
// fechar, o canvas volta para o `#palco` e o `redimensionar()` do campo reacerta o tamanho.
//
// O único trabalho recorrente daqui é repintar ~10 nós de texto (XP, ouro/h, contadores) —
// no snapshot do servidor e num tique de 1 s para o relógio de sessão andar sozinho.
//
// O visual é o de sempre (DESIGN.md): tábua de madeira, vão escuro, número em rosa, Tahoma
// bold com contorno. No PiP, que nasce num documento em branco, os tokens de `:root` e o
// night-mode viajam junto no bloco de estilo; na página já existem no `estilo.css`.

import { t } from './i18n.mjs';
import { ritmoDaSessao } from './hunt-analyser.mjs';

const num = (n) => (Number(n) || 0).toLocaleString('pt-BR');

/** Onde o cartão da página guarda a posição que o jogador arrastou. */
const CHAVE_POS = 'popup-pos';

let ST = null; // referência ao `estado` do app.js (objeto estável; só `estado.eu` troca)
let modo = null; // 'pip' | 'pagina' | null
let janelaPip = null; // Window do Document PiP, quando é esse o caminho
let cartao = null; // o elemento raiz (.pp-card), esteja ele no PiP ou na página
let refs = null; // atalhos para os nós de texto que mudam de valor
let cenaWrapEl = null; // a caixa da janelinha onde o `#cena` de verdade fica hospedado
let relogioId = 0; // setInterval do relógio de sessão
let observadorPip = null; // handler de `resize` da janela do PiP
let videoPipEl = null; // espelho `<video>` pro PiP nativo do Android
let streamPip = null; // MediaStream do canvas (`captureStream`)
let streamCena = null; // de qual canvas o stream saiu (ele troca de nó ao entrar/sair do PiP)
let emPipSistema = false; // bubble do SO (Android) está aberto
let aoVisibilidadePip = null;
let tiqueId = 0; // relógio que desenha a cena com a aba escondida

const ehCelular = () =>
  document.documentElement.classList.contains('mobile') ||
  (typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches);

const temPip = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window;

/** PiP de `<video>` — Android Chrome; iOS limitado. */
const temVideoPip = () =>
  typeof document !== 'undefined'
  && document.pictureInPictureEnabled
  && typeof HTMLVideoElement !== 'undefined'
  && 'requestPictureInPicture' in HTMLVideoElement.prototype;

// --------------------------------------------------------------------- API

/** Liga o botão `#hunt-popup`. Idempotente — chamada uma vez, no boot do jogo. */
export function montarPopup(estado) {
  if (ST) return;
  ST = estado;
  const btn = document.getElementById('hunt-popup');
  if (!btn) return;
  btn.addEventListener('click', () => (modo ? fechar() : abrir()));
  // Fechar junto com o jogo — exceto quando o PiP de vídeo do Android mantém a aba viva.
  window.addEventListener('pagehide', () => {
    if (!modo) return;
    if (emPipSistema || document.pictureInPictureElement === videoPipEl) return;
    fechar();
  });
}

/** O pop-up está aberto? */
export function popupAberto() {
  return !!modo;
}

/**
 * Fecha a janelinha de fora — o Modo Economia usa.
 *
 * As duas coisas não convivem: a janelinha É a cena, movida de lugar, e o Modo Economia
 * desliga a cena. Ligar um com o outro aberto deixaria um canvas parado flutuando por cima
 * do jogo, sem nem o botão de fechar (ele mora no palco, que o modo esconde).
 */
export function fecharPopup() {
  fechar();
}

/**
 * Sincroniza o estado do botão e, se a janelinha estiver aberta, repinta os números na hora
 * do snapshot do servidor (para a barra de XP reagir logo a um level-up).
 */
export function atualizarPopup() {
  const btn = document.getElementById('hunt-popup');
  if (btn) btn.classList.toggle('aberto', !!modo);
  if (modo && refs) pintar();
}

// ------------------------------------------------------------------ abrir

async function abrir() {
  if (modo) return;
  if (temPip() && !ehCelular()) {
    try {
      await abrirPip();
      return;
    } catch {
      // Permissão negada, gesto perdido, recurso ocupado — cai no cartão da página.
    }
  }
  if (ehCelular() && temVideoPip()) {
    await abrirMobilePip();
    return;
  }
  abrirNaPagina();
}

/**
 * Android: o jogo vira uma BOLHA do sistema, e a página fica como está.
 *
 * Nada de cartão nem de mudar a cena de lugar aqui — de propósito. O cartão da página tem
 * 232 px de largura, e mover o `#cena` para dentro dele encolheria o canvas ANTES de o
 * espelho ser capturado: a bolha nasceria com a resolução do cartão, borrada. Deixando o
 * canvas onde está, a janelinha mostra a batalha no tamanho em que ela é desenhada, e ao
 * voltar para o navegador o jogador encontra o jogo exatamente como deixou.
 *
 * Se o navegador recusar o PiP, aí sim o cartão flutuante entra como plano B.
 */
async function abrirMobilePip() {
  injetarCss(document, false); // o espelho tem estilo próprio (`.pp-pip-mirror`)
  prepararVideoPip();
  ligarStreamCanvas(true);
  modo = 'sistema';
  ligarVisibilidadePip();
  ligarTiqueQuadro();
  atualizarPopup();
  if (await entrarVideoPip()) return;

  limparVideoPip();
  modo = null;
  abrirNaPagina();
}

function prepararVideoPip() {
  if (videoPipEl) return;
  videoPipEl = document.createElement('video');
  videoPipEl.className = 'pp-pip-mirror';
  videoPipEl.muted = true;
  videoPipEl.autoplay = true;
  videoPipEl.playsInline = true;
  videoPipEl.setAttribute('playsinline', '');
  videoPipEl.disablePictureInPicture = false;
  videoPipEl.addEventListener('leavepictureinpicture', aoSairVideoPip);
  document.body.appendChild(videoPipEl);
}

/**
 * Aponta o espelho para o canvas da cena. IDEMPOTENTE: enquanto a faixa de vídeo estiver viva
 * e vier do mesmo canvas, não faz nada.
 *
 * Isso não é economia — é o que faz o PiP abrir. Trocar o `srcObject` zera o `readyState` do
 * `<video>`, e um pedido de PiP logo depois é recusado por falta de metadados. Como o
 * `ajustarCena` chama esta função a cada mudança de tamanho, sem a guarda o espelho renascia
 * bem debaixo do pedido.
 */
function ligarStreamCanvas(forcar = false) {
  const cena = canvasDaCena();
  if (!cena || !videoPipEl) return;
  const vivo = !!streamPip?.getVideoTracks().some((tr) => tr.readyState === 'live');
  if (!forcar && vivo && streamCena === cena && videoPipEl.srcObject === streamPip) return;
  if (streamPip) {
    for (const tr of streamPip.getTracks()) tr.stop();
    streamPip = null;
  }
  streamPip = cena.captureStream(24);
  streamCena = cena;
  videoPipEl.width = cena.width || 320;
  videoPipEl.height = cena.height || 200;
  videoPipEl.srcObject = streamPip;
  videoPipEl.play().catch(() => {});
  // Um quadro na mão, agora: o `captureStream` só produz imagem quando ALGUÉM DESENHA no
  // canvas, e um espelho sem imagem é recusado pelo `requestPictureInPicture`. Em jogo o laço
  // de render resolveria isso no quadro seguinte — mas "o quadro seguinte" é justamente o que
  // não dá tempo de esperar dentro do toque que abriu a janelinha.
  try {
    ST?.campo?.quadro?.(performance.now());
  } catch {
    /* cena ainda montando */
  }
}

/**
 * Espera o espelho ter QUADRO — sem isso o `requestPictureInPicture` é recusado com
 * "Metadata for the video element are not loaded yet", que é exatamente o que impedia a bolha
 * de abrir. O limite é curto porque a espera acontece dentro do gesto do jogador: se em 1,2 s
 * não veio quadro nenhum, é melhor cair no cartão da página do que travar o botão.
 */
function primeiroQuadro(limite = 1200) {
  const v = videoPipEl;
  if (!v) return Promise.reject(new Error('sem espelho'));
  if (v.readyState >= 1 && v.videoWidth > 0) return Promise.resolve();
  return new Promise((ok, erro) => {
    const limpar = () => {
      v.removeEventListener('loadedmetadata', pronto);
      v.removeEventListener('loadeddata', pronto);
      clearTimeout(id);
    };
    const pronto = () => {
      limpar();
      ok();
    };
    const id = setTimeout(() => {
      limpar();
      if (v.videoWidth > 0) ok();
      else erro(new Error('o espelho não produziu quadro'));
    }, limite);
    v.addEventListener('loadedmetadata', pronto);
    v.addEventListener('loadeddata', pronto);
  });
}

async function entrarVideoPip() {
  if (!videoPipEl || !temVideoPip() || !modo) return false;
  if (document.pictureInPictureElement === videoPipEl) return true;
  ligarStreamCanvas();
  try {
    await primeiroQuadro();
    await videoPipEl.requestPictureInPicture();
    emPipSistema = true;
    cartao?.classList.add('pp-em-pip-sistema');
    return true;
  } catch {
    return false;
  }
}

function aoSairVideoPip() {
  emPipSistema = false;
  cartao?.classList.remove('pp-em-pip-sistema');
  // No Android não há cartão nenhum por baixo: fechar a bolha é fechar o Modo Pop-up.
  if (modo === 'sistema') fechar();
}

/**
 * O relógio que mantém a cena andando com a aba escondida.
 *
 * Com o jogo em segundo plano o `requestAnimationFrame` para, e o espelho — que só recebe
 * quadro quando alguém desenha no canvas — congelaria. Chamamos `campo.quadro()` na mão (e
 * não `campo.loop()`, que agendaria um `rAF` por tique e multiplicaria o laço na volta). O
 * navegador limita o relógio de aba escondida a ~1×/s: é pouco para uma animação, e é tudo o
 * que se precisa para ver a hunt viva num quadrado de 3 cm.
 */
function ligarTiqueQuadro() {
  if (tiqueId) return;
  tiqueId = setInterval(() => {
    if (!emPipSistema) return;
    if (document.visibilityState === 'visible') return; // com a aba à vista, o rAF dá conta
    try {
      ST?.campo?.quadro?.(performance.now());
    } catch {
      /* cena ainda montando */
    }
  }, 200);
}

function desligarTiqueQuadro() {
  if (!tiqueId) return;
  clearInterval(tiqueId);
  tiqueId = 0;
}

function ligarVisibilidadePip() {
  if (aoVisibilidadePip) return;
  aoVisibilidadePip = () => {
    if (!modo || !ehCelular() || !temVideoPip()) return;
    if (document.visibilityState === 'hidden') entrarVideoPip();
  };
  document.addEventListener('visibilitychange', aoVisibilidadePip);
}

function desligarVisibilidadePip() {
  if (!aoVisibilidadePip) return;
  document.removeEventListener('visibilitychange', aoVisibilidadePip);
  aoVisibilidadePip = null;
}

function limparVideoPip() {
  desligarVisibilidadePip();
  desligarTiqueQuadro();
  if (document.pictureInPictureElement === videoPipEl) {
    document.exitPictureInPicture?.().catch(() => {});
  }
  aoSairVideoPip();
  if (streamPip) {
    for (const tr of streamPip.getTracks()) tr.stop();
    streamPip = null;
  }
  streamCena = null;
  if (videoPipEl) {
    videoPipEl.srcObject = null;
    videoPipEl.remove();
    videoPipEl = null;
  }
}

async function abrirPip() {
  const larg = 340;
  const alt = 470; // cabe a cena + as duas barras de XP + a grade de 9 contadores (3 linhas)
  janelaPip = await window.documentPictureInPicture.requestWindow({ width: larg, height: alt });
  const doc = janelaPip.document;
  doc.documentElement.lang = document.documentElement.lang || 'pt-BR';
  doc.title = 'Pokéidle Pocket';
  injetarCss(doc, true);
  sincronizarNight();
  doc.body.className = 'pp-body';
  cartao = construir(doc, false);
  cartao.classList.add('pp-pip');
  doc.body.appendChild(cartao);
  moverCena();
  // A janela do PiP pode ser redimensionada pelo jogador — a cena tem de reacertar o buffer.
  observadorPip = () => ajustarCena();
  janelaPip.addEventListener('resize', observadorPip);
  // O PiP some por vários caminhos (X da janela, "voltar à guia", fechar o jogo). `pagehide`
  // cobre todos — é o gancho de limpeza.
  janelaPip.addEventListener('pagehide', fechar, { once: true });
  modo = 'pip';
  iniciarRelogio(janelaPip);
  atualizarPopup();
}

function abrirNaPagina() {
  injetarCss(document, false);
  cartao = construir(document, true);
  cartao.classList.add('pp-flutuante');
  document.body.appendChild(cartao);
  restaurarPosicao();
  ligarArrasto();
  window.addEventListener('resize', aoRedimensionarJanela);
  moverCena();
  modo = 'pagina';
  iniciarRelogio(window);
  atualizarPopup();
}

// ------------------------------------------------------------------ fechar

function fechar() {
  if (!modo && !janelaPip) return;
  const eraPip = modo === 'pip';
  // `modo` cai ANTES da limpeza: sair do PiP dispara `leavepictureinpicture`, que chamaria
  // este mesmo `fechar` de volta enquanto ele ainda estivesse valendo 'sistema'.
  modo = null;
  limparVideoPip();
  if (relogioId) {
    (janelaPip || window).clearInterval?.(relogioId);
    relogioId = 0;
  }
  window.removeEventListener('resize', aoRedimensionarJanela);
  if (janelaPip && observadorPip) {
    janelaPip.removeEventListener('resize', observadorPip);
    observadorPip = null;
  }
  devolverCena(); // tira o #cena da janelinha e recoloca no #palco ANTES de destruir o cartão
  cartao?.remove();
  cartao = null;
  refs = null;
  cenaWrapEl = null;
  if (eraPip && janelaPip) {
    try {
      janelaPip.close();
    } catch {
      /* já estava fechando */
    }
  }
  janelaPip = null;
  const btn = document.getElementById('hunt-popup');
  btn?.classList.remove('aberto');
}

// ---------------------------------------------------- mover / devolver a cena

/** Reacerta o buffer do canvas do jogo ao tamanho que ele tem AGORA (na janelinha ou no palco). */
function ajustarCena() {
  try {
    ST?.campo?.redimensionar();
  } catch {
    /* campo ainda não montado */
  }
  if (ehCelular() && videoPipEl && modo) ligarStreamCanvas();
}

/**
 * O canvas do jogo. Vem do `Campo` (não de `getElementById`) porque, enquanto está na
 * janelinha do PiP, ele não mora mais no documento da página — `document.getElementById`
 * devolveria `null` mesmo com o elemento vivo.
 */
const canvasDaCena = () => ST?.campo?.cv || document.getElementById('cena');

/**
 * Tira o `<canvas id="cena">` do `#palco` e o pendura na janelinha. O `#palco` ganha a classe
 * `pocket` (o CSS esconde os HUDs soltos dele) e recebe o recado de "o jogo está na janelinha".
 */
function moverCena() {
  const cena = canvasDaCena();
  const palco = document.getElementById('palco');
  if (!cena || !palco || !cenaWrapEl) return;

  palco.classList.add('pocket');
  if (!palco.querySelector('.pp-ausente')) {
    const aviso = document.createElement('div');
    aviso.className = 'pp-ausente';
    const h = document.createElement('b');
    h.textContent = t('popup.noPocketTitulo');
    const p = document.createElement('span');
    p.textContent = t('popup.noPocketDica');
    aviso.append(h, p);
    palco.appendChild(aviso);
  }

  cenaWrapEl.appendChild(cena); // adota entre documentos no PiP, reparenta na página — os dois valem
  ajustarCena();
  requestAnimationFrame(() => requestAnimationFrame(ajustarCena));
}

/**
 * Desfaz o `moverCena`: canvas de volta ao `#palco` como primeira camada, recado fora.
 *
 * Roda também do `pagehide` da janela do PiP — a última brecha de script antes de o
 * documento dela ser descartado. Tirar o canvas de lá AGORA é o que impede de o jogo perder
 * a cena de vez quando o jogador fecha a janelinha pelo X do sistema.
 */
function devolverCena() {
  const palco = document.getElementById('palco');
  const cena = canvasDaCena();
  if (palco && cena) palco.insertBefore(cena, palco.firstChild); // camada base, sob os HUDs
  palco?.classList.remove('pocket');
  palco?.querySelector('.pp-ausente')?.remove();
  ajustarCena(); // já reacerta ao tamanho do palco; o rAF cobre a aba escondida (rAF atrasado)
  requestAnimationFrame(ajustarCena);
}

// ------------------------------------------------------------------ DOM

function construir(doc, naPagina) {
  const el = (tag, cls, pai) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (pai) pai.appendChild(n);
    return n;
  };

  const card = el('div', 'pp-card');

  const topo = el('div', 'pp-top', card);
  const logo = el('span', 'pp-logo', topo);
  logo.textContent = 'Pokéidle Pocket';
  if (naPagina) topo.title = t('popup.arraste');
  const x = el('button', 'pp-x', topo);
  x.type = 'button';
  x.textContent = '✕';
  x.title = t('popup.fechar');
  x.addEventListener('click', fechar);

  // A caixa fica VAZIA aqui — o `#cena` de verdade é movido para dentro por `moverCena`.
  cenaWrapEl = el('div', 'pp-cena-wrap', card);

  const stats = el('div', 'pp-stats', card);

  const linhaXp = (chave, rotulo) => {
    const linha = el('div', 'pp-xp', stats);
    linha.dataset.k = chave;
    const lab = el('span', 'pp-lab', linha);
    lab.textContent = rotulo;
    const val = el('span', 'pp-val', linha);
    const prog = el('div', 'pp-prog', linha);
    const fill = el('i', null, prog);
    return { val, fill };
  };

  const pkxp = linhaXp('pkxp', t('popup.xpPokemon'));
  const trxp = linhaXp('trxp', t('popup.xpTreinador'));

  const grid = el('div', 'pp-grid', stats);
  const celula = (chave, rotulo) => {
    const c = el('div', 'pp-cell', grid);
    c.dataset.k = chave;
    const i = el('i', null, c);
    i.textContent = rotulo;
    const b = el('b', null, c);
    b.textContent = '—';
    return b;
  };

  refs = {
    pkxpVal: pkxp.val,
    pkxpFill: pkxp.fill,
    trxpVal: trxp.val,
    trxpFill: trxp.fill,
    xpTreinadorH: celula('xptrh', t('popup.xpTreinadorHora')),
    xpPokemonH: celula('xppkh', t('popup.xpPokemonHora')),
    ouroH: celula('ouroh', t('popup.ouroHora')),
    abatesH: celula('abatesh', t('popup.abatesHora')),
    capturasH: celula('capturash', t('popup.capturasHora')),
    tempo: celula('tempo', t('popup.sessao')),
    capturas: celula('capturas', t('popup.capturas')),
    shinysVistos: celula('shvistos', t('popup.shinysVistos')),
    shinysCapt: celula('shcapt', t('popup.shinysCapt')),
  };

  return card;
}

// ------------------------------------------------------------------ relógio

/** Um tique de 1 s só para o tempo de sessão andar entre snapshots. Sem canvas, sem rAF. */
function iniciarRelogio(w) {
  relogioId = w.setInterval(() => {
    if (modo && refs) pintar();
  }, 1000);
}

// ------------------------------------------------------------------ pintar

function faixaXp(dentro, faixa) {
  const p = Math.max(0, Math.min(100, (dentro / Math.max(1, faixa)) * 100));
  return `${p.toFixed(0)}%`;
}

function tempoSessaoCurto(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function pintar() {
  sincronizarNight();
  const e = ST?.eu;
  if (!e || !refs) return;

  // Pokémon ativo
  const p = (e.pokemons || []).find((x) => x.id === e.activeId);
  if (p) {
    const dentro = (p.xp ?? 0) - (p.xpNivel ?? 0);
    const faixa = Math.max(1, (p.xpProximo ?? 1) - (p.xpNivel ?? 0));
    refs.pkxpFill.style.width = faixaXp(dentro, faixa);
    refs.pkxpVal.textContent = `${t('painel.nivelCurto')} ${p.level ?? 0} · ${faixaXp(dentro, faixa)}`;
  } else {
    refs.pkxpFill.style.width = '0%';
    refs.pkxpVal.textContent = '—';
  }

  // Treinador
  const dentroT = (e.xp ?? 0) - (e.xpNivel ?? 0);
  const faixaT = Math.max(1, (e.xpProximo ?? 1) - (e.xpNivel ?? 0));
  refs.trxpFill.style.width = faixaXp(dentroT, faixaT);
  refs.trxpVal.textContent = `${t('painel.nivelCurto')} ${e.level ?? 0} · ${faixaXp(dentroT, faixaT)}`;

  // Contadores da sessão — a mesma fonte da prancheta (`estado.sessao`, alimentada por
  // `registrarSessao`). Ouro, abates, XP e capturas viram RITMO; a conta mora em
  // `ritmoDaSessao` porque o Hunt Analyser mostra os mesmos números. O resto é contagem crua.
  // XP treinador e XP pokémon vão em células separadas, cada uma = XP da prancheta ÷ horas:
  // somadas numa só, o jogador lia o dobro e não batia com nenhuma das duas barras.
  const sess = ST?.sessao;
  const ritmo = ritmoDaSessao(sess);
  if (sess && ritmo) {
    refs.xpTreinadorH.textContent = num(ritmo.xpTreinadorH);
    refs.xpPokemonH.textContent = num(ritmo.xpPokemonH);
    refs.ouroH.textContent = num(ritmo.ouroH);
    refs.abatesH.textContent = num(ritmo.abatesH);
    refs.capturasH.textContent = num(ritmo.capturasH);
    refs.tempo.textContent = tempoSessaoCurto(Date.now() - sess.inicio);
    refs.capturas.textContent = num(sess.capturas || 0);
    refs.shinysVistos.textContent = num(sess.shiniesVistos || 0);
    refs.shinysCapt.textContent = num(sess.shinies || 0);
  }
}

// ------------------------------------------------------------------ night mode

function sincronizarNight() {
  if (modo !== 'pip' || !janelaPip) return;
  const escuro = document.documentElement.classList.contains('night-mode');
  janelaPip.document.documentElement.classList.toggle('night-mode', escuro);
}

// ------------------------------------------------- arrasto (cartão da página)

function aoRedimensionarJanela() {
  manterNaTela();
  ajustarCena();
}

function ligarArrasto() {
  const topo = cartao?.querySelector('.pp-top');
  if (!topo) return;
  let ativo = false;
  let dx = 0;
  let dy = 0;

  const descer = (ev) => {
    if (ev.target.closest('.pp-x')) return;
    ativo = true;
    const r = cartao.getBoundingClientRect();
    dx = ev.clientX - r.left;
    dy = ev.clientY - r.top;
    cartao.style.left = `${r.left}px`;
    cartao.style.top = `${r.top}px`;
    cartao.style.right = 'auto';
    cartao.style.bottom = 'auto';
    topo.setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  };
  const mover = (ev) => {
    if (!ativo) return;
    const larg = cartao.offsetWidth;
    const alt = cartao.offsetHeight;
    const x = Math.max(0, Math.min(window.innerWidth - larg, ev.clientX - dx));
    const y = Math.max(0, Math.min(window.innerHeight - alt, ev.clientY - dy));
    cartao.style.left = `${x}px`;
    cartao.style.top = `${y}px`;
  };
  const subir = (ev) => {
    if (!ativo) return;
    ativo = false;
    topo.releasePointerCapture?.(ev.pointerId);
    try {
      localStorage.setItem(
        CHAVE_POS,
        JSON.stringify({ x: parseFloat(cartao.style.left) || 0, y: parseFloat(cartao.style.top) || 0 }),
      );
    } catch {
      /* navegação privada / cota */
    }
  };

  topo.addEventListener('pointerdown', descer);
  topo.addEventListener('pointermove', mover);
  topo.addEventListener('pointerup', subir);
  topo.addEventListener('pointercancel', subir);
}

function restaurarPosicao() {
  let pos = null;
  try {
    pos = JSON.parse(localStorage.getItem(CHAVE_POS) || 'null');
  } catch {
    pos = null;
  }
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
  requestAnimationFrame(() => {
    if (!cartao) return;
    const larg = cartao.offsetWidth;
    const alt = cartao.offsetHeight;
    const x = Math.max(0, Math.min(window.innerWidth - larg, pos.x));
    const y = Math.max(0, Math.min(window.innerHeight - alt, pos.y));
    cartao.style.left = `${x}px`;
    cartao.style.top = `${y}px`;
    cartao.style.right = 'auto';
    cartao.style.bottom = 'auto';
  });
}

function manterNaTela() {
  if (!cartao || cartao.style.left === '') return;
  const larg = cartao.offsetWidth;
  const alt = cartao.offsetHeight;
  const x = Math.max(0, Math.min(window.innerWidth - larg, parseFloat(cartao.style.left) || 0));
  const y = Math.max(0, Math.min(window.innerHeight - alt, parseFloat(cartao.style.top) || 0));
  cartao.style.left = `${x}px`;
  cartao.style.top = `${y}px`;
}

// ------------------------------------------------------------------ CSS

let cssNaPagina = false;

function injetarCss(doc, standalone) {
  if (doc === document) {
    if (cssNaPagina) return;
    cssNaPagina = true;
  } else if (doc.getElementById('pp-css')) {
    return;
  }
  const style = doc.createElement('style');
  style.id = 'pp-css';
  style.textContent = (standalone ? TOKENS : '') + CSS;
  doc.head.appendChild(style);
}

// Só os tokens que o pop-up usa — a janela do PiP nasce sem o `estilo.css`. Valores idênticos
// aos de `:root` / `html.night-mode` em `estilo.css`; se lá mudar, muda aqui também.
const TOKENS = `
:root{
  --mad-linha:#480e1e; --mad-luz:#f1d3b7; --mad-luz2:#e7a86d; --mad:#bd6951;
  --mad-esc:#914850; --mad-quente:#df824c; --mad-base:#722c3f;
  --rx-luz:#ffdef0; --rx-esc:#8d49b8; --rx:#ba5ad1; --rx-clr:#e77ad2; --rx-rosa:#ffa7d7;
  --vao:#33202b; --vao2:#462b39;
  --sobre-mad:#fff6ef; --sobre-mad-dim:#f5cdb9; --vao-dim:#c9a9b4;
}
html.night-mode{
  --mad-linha:#2a0a12; --mad-luz:#6a5048; --mad-luz2:#8a5840; --mad:#5a3038;
  --mad-esc:#3a1820; --mad-quente:#6a3828; --mad-base:#401820;
  --rx-luz:#c8a0c8; --rx-esc:#5a2878; --rx:#7a4098; --rx-clr:#9a58a8; --rx-rosa:#c878a8;
  --vao:#181018; --vao2:#221420;
  --sobre-mad:#e8d8cc; --sobre-mad-dim:#b89898; --vao-dim:#988088;
}
.pp-body{ margin:0; height:100vh; overflow:hidden; background:var(--mad); }
`;

const CSS = `
.pp-card{
  box-sizing:border-box;
  display:flex; flex-direction:column; gap:9px;
  width:100%; height:100%;
  padding:9px;
  font-family:Tahoma,Verdana,"Segoe UI",sans-serif; font-weight:700;
  color:var(--sobre-mad);
  background:linear-gradient(180deg,
    var(--mad-esc) 0 10px, var(--mad) 10px calc(100% - 14px),
    var(--mad-quente) calc(100% - 14px) calc(100% - 7px), var(--mad) calc(100% - 7px) 100%);
  border-radius:8px;
  box-shadow:
    inset 0 0 0 2px var(--mad-linha),
    inset 0 0 0 4px var(--mad-luz),
    inset 0 0 0 6px var(--mad);
  overflow:hidden;
}
.pp-card *{ box-sizing:border-box; }
.pp-flutuante{
  position:fixed; z-index:9990;
  width:340px; height:auto;
  right:16px; top:90px; bottom:auto;
  contain:layout;
  box-shadow:
    inset 0 0 0 2px var(--mad-linha),
    inset 0 0 0 4px var(--mad-luz),
    inset 0 0 0 6px var(--mad),
    0 4px 0 var(--mad-base),
    0 10px 34px #000a;
}

.pp-top{ display:flex; align-items:center; gap:8px; flex:none; height:22px; }
.pp-flutuante .pp-top{ cursor:grab; touch-action:none; }
.pp-flutuante .pp-top:active{ cursor:grabbing; }
.pp-logo{
  flex:1 1 auto; min-width:0;
  font-size:12px; letter-spacing:.4px; color:#fff; text-transform:uppercase;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  text-shadow:-1px -1px 0 var(--mad-base),1px -1px 0 var(--mad-base),-1px 1px 0 var(--mad-base),1px 1px 0 var(--mad-base);
}
.pp-x{
  flex:none; width:20px; height:20px; padding:0;
  display:grid; place-items:center;
  border:0; border-radius:5px; cursor:pointer;
  font-family:inherit; font-weight:700; font-size:11px; line-height:1; color:#fff;
  background:linear-gradient(180deg,
    var(--rx-luz) 0 3px, var(--rx-esc) 3px 7px, var(--rx) 7px calc(100% - 6px),
    var(--rx-clr) calc(100% - 6px) 100%);
  box-shadow:inset 0 0 0 2px var(--mad-linha), inset 0 0 0 3px var(--mad-luz2), 0 2px 0 var(--mad-base);
  text-shadow:-1px -1px 0 var(--rx-esc),1px -1px 0 var(--rx-esc),-1px 1px 0 var(--rx-esc),1px 1px 0 var(--rx-esc);
  transition:filter .1s, transform .06s;
}
.pp-x:hover{ filter:brightness(1.12); }
.pp-x:active{ transform:translateY(1px); }

.pp-cena-wrap{
  flex:1 1 auto; min-height:0;
  border-radius:6px; overflow:hidden;
  background:var(--vao);
  box-shadow:inset 0 0 0 2px var(--mad-linha), 0 1px 0 var(--mad-luz2);
  contain:layout;
}
/* Altura concreta no cartao da pagina (que tem height:auto); no PiP a caixa e flex e ocupa o
   que sobra da janela. Piso de 200 px: abaixo disso o redimensionar() do campo trava no
   minimo dele e a cena esticaria. */
.pp-flutuante .pp-cena-wrap{ flex:none; height:210px; }
/* O canvas DE VERDADE do jogo, agora hospedado aqui. O Campo.redimensionar() casa o buffer
   com este tamanho; object-fit contain cobre o residuo do piso de 200 px sem distorcer. */
.pp-cena-wrap > canvas{
  display:block; width:100%; height:100%;
  object-fit:contain;
  image-rendering:pixelated;
}

.pp-stats{ flex:none; display:flex; flex-direction:column; gap:7px; }
.pp-xp{ display:grid; grid-template-columns:1fr auto; align-items:baseline; gap:2px 8px; }
.pp-xp .pp-lab{ font-size:10px; color:var(--sobre-mad-dim); }
.pp-xp .pp-val{ font-size:10px; color:var(--rx-rosa); white-space:nowrap; }
.pp-prog{
  grid-column:1 / -1;
  position:relative; height:9px; border-radius:4px; overflow:hidden;
  background:var(--vao2);
  box-shadow:inset 0 0 0 2px var(--mad-linha);
}
.pp-prog > i{
  display:block; height:100%; width:0;
  background:linear-gradient(90deg,#4a8ab8,#6fc0f0);
  transition:width .3s;
}
.pp-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
.pp-cell{
  display:flex; flex-direction:column; align-items:center; gap:2px;
  padding:5px 3px; border-radius:5px;
  background:var(--vao);
  box-shadow:inset 0 0 0 2px var(--mad-linha), 0 1px 0 var(--mad-luz2);
}
.pp-cell i{ font-style:normal; font-size:9px; color:var(--vao-dim); white-space:nowrap; }
.pp-cell b{
  font-size:12px; color:var(--rx-rosa);
  text-shadow:-1px -1px 0 var(--rx-esc),1px 1px 0 var(--rx-esc);
}

/* Cartão da PÁGINA no celular: mais estreito, sem a segunda barra de XP. A janela do PiP
   (.pp-pip) não entra aqui — mostra tudo, mesmo estreita. */
@media (max-width:720px){
  .pp-flutuante{ width:232px; right:8px; top:auto; bottom:84px; padding:7px; gap:7px; }
  .pp-flutuante .pp-xp[data-k="trxp"]{ display:none; }
  .pp-flutuante .pp-grid{ grid-template-columns:repeat(2,1fr); }
  .pp-flutuante .pp-logo{ font-size:11px; }
  /* 1,6:1 casa com o piso 320x200 do redimensionar() — cena so reduzida, nunca distorcida. */
  .pp-flutuante .pp-cena-wrap{ height:136px; }
}

/* Espelho do PiP nativo do Android. Ele fica NA TELA, num pontinho de 2 px atras de tudo, e
   nao jogado para fora da janela com opacidade zero: um video que o navegador considera
   nao-renderizado pode ser pausado sozinho, e video pausado nao entra em Picture-in-Picture. */
.pp-pip-mirror{
  position:fixed; right:0; bottom:0; z-index:-1;
  width:2px; height:2px; opacity:.01; pointer-events:none;
}
/* Bubble do SO aberto: esconde o cartão in-page (volta ao sair do PiP). */
.pp-flutuante.pp-em-pip-sistema{ visibility:hidden; pointer-events:none; opacity:0; }
`;
