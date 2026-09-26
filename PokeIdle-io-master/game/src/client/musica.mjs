// Player de trilhas Hoenn — Sound Mode nas configurações.
import { t } from './i18n.mjs';

const CHAVE_FAIXA = 'cfg-som-faixa';
const CHAVE_REPEAT = 'cfg-som-repeat';
const CHAVE_POS = 'cfg-som-pos';
const CHAVE_VOLUME = 'cfg-som-volume';
const CHAVE_MINIMIZADO = 'cfg-som-min';
const VOLUME_PADRAO = 0.75;

const FAIXAS = [
  {
    id: 'littleroot',
    titulo: 'musica.littleroot',
    audio: 'img/musica/littleroot-town.m4a',
    capa: 'img/musica/littleroot-town.png',
  },
  {
    id: 'oldale',
    titulo: 'musica.oldale',
    audio: 'img/musica/oldale-town.m4a',
    capa: 'img/musica/oldale-town.png',
  },
  {
    id: 'dewford',
    titulo: 'musica.dewford',
    audio: 'img/musica/dewford-town.m4a',
    capa: 'img/musica/dewford-town.jfif',
  },
  {
    id: 'verdanturf',
    titulo: 'musica.verdanturf',
    audio: 'img/musica/verdanturf-town.m4a',
    capa: 'img/musica/verdanturf-town.jfif',
  },
  {
    id: 'fallabor',
    titulo: 'musica.fallabor',
    audio: 'img/musica/fallabor-town.m4a',
    capa: 'img/musica/fallabor-town.png',
  },
];

const $ = (s) => document.querySelector(s);

let montado = false;
let idx = 0;
let repeat = false;
let tocando = false;
let ativo = false;
let arrastando = false;
let arrasteOffX = 0;
let arrasteOffY = 0;
let arrasteMoveu = false;
let arrasteStartX = 0;
let arrasteStartY = 0;
let minimizado = false;

function lerNum(chave, padrao) {
  try {
    const v = Number(localStorage.getItem(chave));
    return Number.isFinite(v) ? v : padrao;
  } catch {
    return padrao;
  }
}

function salvarFaixa() {
  try { localStorage.setItem(CHAVE_FAIXA, String(idx)); } catch { /* quota */ }
}

function salvarRepeat() {
  try { localStorage.setItem(CHAVE_REPEAT, repeat ? '1' : '0'); } catch { /* quota */ }
}

function salvarMinimizado() {
  try { localStorage.setItem(CHAVE_MINIMIZADO, minimizado ? '1' : '0'); } catch { /* quota */ }
}

function lerMinimizado() {
  try { return localStorage.getItem(CHAVE_MINIMIZADO) === '1'; } catch { return false; }
}

function setMinimizado(valor) {
  minimizado = !!valor;
  const player = $('#musica-player');
  const chip = $('#musica-chip');
  if (!player) return;
  player.classList.toggle('minimizado', minimizado);
  if (chip) chip.hidden = !minimizado;
  salvarMinimizado();
}

function alternarMinimizado() {
  setMinimizado(!minimizado);
}

function expandir() {
  if (minimizado) setMinimizado(false);
}

function salvarPos() {
  const el = $('#musica-player');
  if (!el) return;
  try {
    localStorage.setItem(CHAVE_POS, JSON.stringify({
      left: el.style.left || null,
      top: el.style.top || null,
    }));
  } catch { /* quota */ }
}

function lerVolume() {
  try {
    const raw = localStorage.getItem(CHAVE_VOLUME);
    if (raw == null) return VOLUME_PADRAO;
    const v = Number(raw);
    if (!Number.isFinite(v)) return VOLUME_PADRAO;
    return Math.min(1, Math.max(0, v));
  } catch {
    return VOLUME_PADRAO;
  }
}

function salvarVolume(v) {
  try { localStorage.setItem(CHAVE_VOLUME, String(v)); } catch { /* quota */ }
}

function aplicarVolume(valor) {
  const a = audio();
  const vol = $('#musica-vol');
  const n = Math.min(1, Math.max(0, Number(valor)));
  if (a) a.volume = n;
  if (vol) vol.value = String(Math.round(n * 100));
  salvarVolume(n);
}

function restaurarPos() {
  const el = $('#musica-player');
  if (!el) return;
  try {
    const raw = localStorage.getItem(CHAVE_POS);
    if (!raw) return;
    const pos = JSON.parse(raw);
    if (pos.left) {
      el.style.left = pos.left;
      el.style.top = pos.top;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
  } catch { /* pos inválida */ }
}

function fmt(seg) {
  if (!Number.isFinite(seg) || seg < 0) return '0:00';
  const m = Math.floor(seg / 60);
  const s = Math.floor(seg % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function faixaAtual() {
  return FAIXAS[idx] ?? FAIXAS[0];
}

function audio() {
  return $('#musica-audio');
}

function atualizarUi() {
  const f = faixaAtual();
  const capa = $('#musica-capa');
  const capaChip = $('#musica-capa-chip');
  const titulo = $('#musica-titulo');
  const btnPlay = $('#musica-play');
  const btnRepeat = $('#musica-repeat');
  const player = $('#musica-player');
  const rotulo = t(f.titulo);
  if (capa) {
    capa.src = f.capa;
    capa.alt = rotulo;
  }
  if (capaChip) {
    capaChip.src = f.capa;
    capaChip.alt = rotulo;
  }
  if (titulo) titulo.textContent = rotulo;
  if (player) player.classList.toggle('tocando', tocando);
  if (btnPlay) {
    btnPlay.dataset.estado = tocando ? 'pause' : 'play';
    btnPlay.setAttribute('aria-label', t(tocando ? 'musica.pausar' : 'musica.tocar'));
    btnPlay.setAttribute('title', t(tocando ? 'musica.pausar' : 'musica.tocar'));
  }
  if (btnRepeat) {
    btnRepeat.classList.toggle('on', repeat);
    btnRepeat.setAttribute('aria-pressed', repeat ? 'true' : 'false');
    btnRepeat.setAttribute('title', t(repeat ? 'musica.repetirOn' : 'musica.repetir'));
  }
}

let editandoSeek = false;

function segundosDoSeek() {
  const v = Number($('#musica-seek')?.value);
  return Number.isFinite(v) ? v : 0;
}

function previewSeek() {
  editandoSeek = true;
  const seg = segundosDoSeek();
  const marca = $('#musica-atual');
  if (marca) marca.textContent = fmt(seg);
}

function commitarSeek() {
  const a = audio();
  const seek = $('#musica-seek');
  const marca = $('#musica-atual');
  if (!a || !seek) return;

  let seg = segundosDoSeek();
  const dur = a.duration;
  if (Number.isFinite(dur) && dur > 0) {
    seg = Math.min(Math.max(0, seg), dur);
    seek.value = seg.toFixed(1);
  }
  if (marca) marca.textContent = fmt(seg);
  editandoSeek = false;

  const pular = () => { a.currentTime = seg; };
  if (a.readyState >= 1) pular();
  else a.addEventListener('loadedmetadata', pular, { once: true });
}

function atualizarSeek() {
  const a = audio();
  const seek = $('#musica-seek');
  const atual = $('#musica-atual');
  const total = $('#musica-total');
  if (!a || !seek) return;
  const dur = a.duration;
  if (Number.isFinite(dur) && dur > 0) {
    const maxStr = dur.toFixed(1);
    if (seek.max !== maxStr) seek.max = maxStr;
    if (total) total.textContent = fmt(dur);
  } else if (total) {
    total.textContent = '0:00';
  }
  if (editandoSeek || a.seeking) return;
  if (Number.isFinite(dur) && dur > 0) {
    seek.value = a.currentTime.toFixed(1);
  }
  if (atual) atual.textContent = fmt(a.currentTime);
}

function carregarFaixa(novoIdx, autoplay = false) {
  idx = ((novoIdx % FAIXAS.length) + FAIXAS.length) % FAIXAS.length;
  salvarFaixa();
  const f = faixaAtual();
  const a = audio();
  if (!a) return;
  a.src = f.audio;
  a.preload = 'auto';
  editandoSeek = false;
  a.load();
  atualizarUi();
  atualizarSeek();
  if (autoplay && ativo) {
    a.play().then(() => {
      tocando = true;
      atualizarUi();
    }).catch(() => {
      tocando = false;
      atualizarUi();
    });
  }
}

function tocar() {
  const a = audio();
  if (!a) return;
  a.play().then(() => {
    tocando = true;
    atualizarUi();
  }).catch(() => {
    tocando = false;
    atualizarUi();
  });
}

function pausar() {
  const a = audio();
  if (!a) return;
  a.pause();
  tocando = false;
  atualizarUi();
}

function alternarPlay() {
  if (tocando) pausar();
  else tocar();
}

function faixaAnterior() {
  const a = audio();
  if (a && a.currentTime > 3) {
    a.currentTime = 0;
    atualizarSeek();
    return;
  }
  carregarFaixa(idx - 1, true);
}

function faixaProxima() {
  carregarFaixa(idx + 1, true);
}

function alternarRepeat() {
  repeat = !repeat;
  salvarRepeat();
  atualizarUi();
}

function aoTerminar() {
  if (repeat) {
    const a = audio();
    if (!a) return;
    a.currentTime = 0;
    tocar();
    return;
  }
  faixaProxima();
}

function ligarArraste() {
  const player = $('#musica-player');
  const alca = $('#musica-alca');
  const chip = $('#musica-chip');
  if (!player) return;

  const comecarArraste = (alvo, ev) => {
    if (ev.button !== 0) return;
    arrastando = true;
    arrasteMoveu = false;
    arrasteStartX = ev.clientX;
    arrasteStartY = ev.clientY;
    const r = player.getBoundingClientRect();
    arrasteOffX = ev.clientX - r.left;
    arrasteOffY = ev.clientY - r.top;
    player.classList.add('arrastando');
    alvo.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  };

  const moverArraste = (ev) => {
    if (!arrastando) return;
    if (!arrasteMoveu) {
      const dx = ev.clientX - arrasteStartX;
      const dy = ev.clientY - arrasteStartY;
      if (dx * dx + dy * dy < 16) return;
      arrasteMoveu = true;
    }
    const margem = 8;
    const w = player.offsetWidth;
    const h = player.offsetHeight;
    const left = Math.min(Math.max(margem, ev.clientX - arrasteOffX), window.innerWidth - w - margem);
    const top = Math.min(Math.max(margem, ev.clientY - arrasteOffY), window.innerHeight - h - margem);
    player.style.left = `${left}px`;
    player.style.top = `${top}px`;
    player.style.right = 'auto';
    player.style.bottom = 'auto';
  };

  const soltarArraste = (ev) => {
    if (!arrastando) return;
    arrastando = false;
    player.classList.remove('arrastando');
    salvarPos();
    if (ev?.target === chip && !arrasteMoveu) expandir();
  };

  for (const alvo of [alca, chip].filter(Boolean)) {
    alvo.addEventListener('pointerdown', (ev) => comecarArraste(alvo, ev));
    alvo.addEventListener('pointermove', moverArraste);
    alvo.addEventListener('pointerup', soltarArraste);
    alvo.addEventListener('pointercancel', soltarArraste);
  }
}

function ligarControles() {
  $('#musica-min')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    alternarMinimizado();
  });
  $('#musica-play')?.addEventListener('click', alternarPlay);
  $('#musica-prev')?.addEventListener('click', faixaAnterior);
  $('#musica-next')?.addEventListener('click', faixaProxima);
  $('#musica-repeat')?.addEventListener('click', alternarRepeat);

  const seek = $('#musica-seek');
  seek?.addEventListener('input', previewSeek);
  seek?.addEventListener('change', commitarSeek);

  const vol = $('#musica-vol');
  vol?.addEventListener('input', () => {
    aplicarVolume(Number(vol.value) / 100);
  });

  const a = audio();
  a?.addEventListener('timeupdate', atualizarSeek);
  a?.addEventListener('loadedmetadata', atualizarSeek);
  a?.addEventListener('seeked', atualizarSeek);
  a?.addEventListener('ended', aoTerminar);
  a?.addEventListener('play', () => {
    tocando = true;
    atualizarUi();
  });
  a?.addEventListener('pause', () => {
    if (a.seeking || editandoSeek) return;
    tocando = false;
    atualizarUi();
  });
}

/** Monta listeners uma vez — o HTML já está no index. */
export function montarPlayerMusica() {
  if (montado) return;
  montado = true;
  idx = Math.min(Math.max(0, lerNum(CHAVE_FAIXA, 0)), FAIXAS.length - 1);
  repeat = localStorage.getItem(CHAVE_REPEAT) === '1';
  restaurarPos();
  setMinimizado(lerMinimizado());
  aplicarVolume(lerVolume());
  ligarArraste();
  ligarControles();
  carregarFaixa(idx, false);
}

/** Liga ou desliga o painel e a reprodução (Sound Mode). */
export function sincronizarSom(ligado, { autoplay = true } = {}) {
  montarPlayerMusica();
  ativo = ligado;
  const player = $('#musica-player');
  if (!player) return;
  player.classList.toggle('hidden', !ligado);
  player.setAttribute('aria-hidden', ligado ? 'false' : 'true');
  if (ligado) {
    atualizarUi();
    if (autoplay) tocar();
    else pausar();
  } else {
    pausar();
  }
}

/** Atualiza rótulos quando o idioma muda. */
export function retraduzirPlayerMusica() {
  if (!montado) return;
  atualizarUi();
  atualizarSeek();
  const min = $('#musica-min');
  const chip = $('#musica-chip');
  min?.setAttribute('title', t('musica.minimizar'));
  chip?.setAttribute('title', t('musica.expandir'));
}
