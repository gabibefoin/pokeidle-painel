// Pokédex — visão por geração: normal + shiny lado a lado, ? se faltar.
import { normalizarBusca } from './busca.mjs';

const localizeLab = (p) => p.replace(/^\/assets-packs/, '/lab');
const localizeJogo = (p) => p.replace(/^\/assets-packs/, '/jogo/asset-packs');

function localizeEntry(entry, path) {
  if (!path) return path;
  const jogo = entry?.fonte === 'jogo' || String(entry?.id ?? '').startsWith('jogo-');
  return jogo ? localizeJogo(path) : localizeLab(path);
}
const $ = (s) => document.querySelector(s);

const CAIXA = { w: 88, h: 88 };

const state = {
  geracoes: [],
  dir: 3,
  zoom: 4,
  animate: true,
  q: '',
  geracao: 'all',
  soIncompletos: false,
};

const PREFS = ['dir', 'zoom', 'animate', 'geracao', 'soIncompletos'];
function carregarPrefs() {
  try { Object.assign(state, JSON.parse(localStorage.pokedex || '{}')); } catch { /* ignora */ }
}
const salvarPrefs = () =>
  localStorage.setItem('pokedex', JSON.stringify(Object.fromEntries(PREFS.map((k) => [k, state[k]]))));

// ------------------------------------------------------------- sprites

const cacheSprite = new Map();

function loadImage(src) {
  return new Promise((ok, err) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => err(new Error(`falhou: ${src}`));
    img.src = src;
  });
}

function loadSprite(entry) {
  if (!entry?.manifest) return Promise.resolve(null);
  if (cacheSprite.has(entry.id)) return cacheSprite.get(entry.id);

  const p = (async () => {
    const manifest = await fetch(localizeEntry(entry, entry.manifest)).then((r) => r.json());
    const cat = Object.values(manifest.categories)[0];
    const images = await Promise.all(cat.pages.map((pg) => loadImage(localizeEntry(entry, pg.image))));

    const byDir = {};
    for (const [key, asset] of Object.entries(manifest.assets)) {
      const [frame, , , dir] = key.split('/').pop().replace(/\.png$/, '').split('_').map(Number);
      const f = asset.frames[0];
      if (!f) continue;
      ((byDir[dir] ??= [])[frame - 1] = { page: f.page ?? 0, x: f.x, y: f.y, w: f.w, h: f.h, dur: f.durationMs || 150 });
    }
    for (const d of Object.keys(byDir)) byDir[d] = byDir[d].filter(Boolean);
    return { images, byDir };
  })();

  cacheSprite.set(entry.id, p);
  return p;
}

const framesFor = (sprite, dir) =>
  sprite.byDir[dir]?.length ? sprite.byDir[dir] : sprite.byDir[3] || Object.values(sprite.byDir)[0] || [];

function frameIndexAt(frames, t) {
  const total = frames.reduce((s, f) => s + f.dur, 0);
  let m = t % total;
  for (let i = 0; i < frames.length; i++) {
    if (m < frames[i].dur) return i;
    m -= frames[i].dur;
  }
  return 0;
}

function escala(f) {
  const cabe = Math.min(CAIXA.w / f.w, CAIXA.h / f.h);
  return cabe >= 1 ? Math.min(state.zoom, Math.floor(cabe)) : cabe;
}

const live = new Set();

const observer = new IntersectionObserver((rows) => {
  for (const row of rows) {
    const rec = row.target._rec;
    if (!rec) continue;
    if (!row.isIntersecting) { live.delete(rec); continue; }
    live.add(rec);
    if (rec.sprite || rec.loading || !rec.entry?.manifest) continue;
    rec.loading = true;
    loadSprite(rec.entry).then(
      (s) => { rec.sprite = s; rec.dirty = true; },
      () => { rec.el.classList.add('vazio'); rec.el.innerHTML = '<span class="q">!</span>'; },
    );
  }
}, { rootMargin: '300px' });

function tick(now) {
  for (const rec of live) {
    if (!rec.sprite) continue;
    const frames = framesFor(rec.sprite, state.dir);
    if (!frames.length) continue;

    const idx = state.animate && frames.length > 1 ? frameIndexAt(frames, now) : 0;
    if (!rec.dirty && rec.idx === idx && rec.dir === state.dir && rec.zoom === state.zoom) continue;

    const f = frames[idx];
    const cv = rec.canvas;
    if (cv.width !== f.w || cv.height !== f.h) { cv.width = f.w; cv.height = f.h; }
    const s = escala(f);
    cv.style.width = `${f.w * s}px`;
    cv.style.height = `${f.h * s}px`;
    const ctx = rec.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, f.w, f.h);
    ctx.drawImage(rec.sprite.images[f.page], f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);

    rec.idx = idx;
    rec.dir = state.dir;
    rec.zoom = state.zoom;
    rec.dirty = false;
  }
  requestAnimationFrame(tick);
}

function montarSlot(entry, rotulo, shiny) {
  const slot = document.createElement('div');
  slot.className = `dex-slot${shiny ? ' shiny' : ''}`;

  const lab = document.createElement('span');
  lab.className = 'rotulo';
  lab.textContent = rotulo;
  slot.append(lab);

  if (!entry) {
    slot.classList.add('vazio');
    slot.innerHTML = '<span class="q">?</span>';
    slot.prepend(lab);
    return slot;
  }

  if (entry.fonte === 'jogo') slot.classList.add('fonte-jogo');
  if (entry.fonte === 'lab-alias') slot.classList.add('fonte-alias');
  if (entry.fonte === 'lab') slot.classList.add('fonte-lab');
  const cv = document.createElement('canvas');
  slot.append(cv);
  const rec = {
    el: slot,
    canvas: cv,
    ctx: cv.getContext('2d'),
    entry,
    sprite: null,
    loading: false,
    dirty: true,
    idx: -1,
    dir: state.dir,
    zoom: state.zoom,
  };
  slot._rec = rec;
  observer.observe(slot);
  return slot;
}

function montarCard(e) {
  const card = document.createElement('article');
  const ok = e.normal && e.shiny;
  const parcial = (e.normal || e.shiny) && !ok;
  card.className = `dex-card${ok ? ' ok' : parcial ? ' parcial' : ' faltando'}`;
  if (e.normal?.fonte === 'jogo' || e.shiny?.fonte === 'jogo') card.classList.add('tem-jogo');
  if (e.normal?.fonte === 'lab-alias' || e.shiny?.fonte === 'lab-alias') card.classList.add('tem-alias');
  card.dataset.temNormal = e.normal ? '1' : '0';
  card.dataset.temShiny = e.shiny ? '1' : '0';
  card.dataset.q = normalizarBusca(`${e.nome} ${e.slug} #${String(e.dex).padStart(4, '0')}`);

  const head = document.createElement('div');
  head.className = 'dex-head';
  head.innerHTML = `
    <span class="num">#${String(e.dex).padStart(3, '0')}</span>
    <span class="nome">${e.nome}</span>
    <span class="slug">${e.slug}</span>
  `;
  card.append(head);

  const par = document.createElement('div');
  par.className = 'dex-par';
  par.append(montarSlot(e.normal, 'normal', false));
  par.append(montarSlot(e.shiny, 'shiny', true));
  card.append(par);

  return card;
}

// -------------------------------------------------------------- filtros

function cardVisivel(card) {
  const bloco = card.closest('.gen-bloco');
  if (state.geracao !== 'all' && bloco?.dataset.gen !== state.geracao) return false;
  const q = normalizarBusca(state.q);
  if (q && !(card.dataset.q || '').includes(q)) return false;
  if (state.soIncompletos) {
    if (card.dataset.temNormal === '1' && card.dataset.temShiny === '1') return false;
  }
  return true;
}

function aplicarFiltros() {
  let visiveis = 0;
  for (const bloco of document.querySelectorAll('.gen-bloco')) {
    let n = 0;
    for (const card of bloco.querySelectorAll('.dex-card')) {
      const show = cardVisivel(card);
      card.style.display = show ? '' : 'none';
      if (show) n++;
    }
    bloco.classList.toggle('hidden', n === 0);
    visiveis += n;
  }
  $('#vazio').classList.toggle('hidden', visiveis > 0);
}

// -------------------------------------------------------------- render

function pintarContagens() {
  let nN = 0;
  let nS = 0;
  let nC = 0;
  let total = 0;
  for (const g of state.geracoes) {
    total += g.total;
    nN += g.stats.comNormal;
    nS += g.stats.comShiny;
    nC += g.stats.completos;
  }
  $('#counts').innerHTML =
    `<b>${nC}</b> pares completos · <b>${nN}</b> normal · <b>${nS}</b> shiny · ${total} formas`;
}

function pintarGeracoes() {
  const el = $('#geracoes');
  el.innerHTML = [
    `<button class="chip${state.geracao === 'all' ? ' on' : ''}" data-g="all">todas</button>`,
    ...state.geracoes.map((g) =>
      `<button class="chip${state.geracao === g.id ? ' on' : ''}" data-g="${g.id}">${g.rotulo}<span class="n">${g.stats.completos}/${g.total}</span></button>`,
    ),
  ].join('');

  el.onclick = (ev) => {
    const b = ev.target.closest('[data-g]');
    if (!b) return;
    state.geracao = b.dataset.g;
    salvarPrefs();
    pintarGeracoes();
    aplicarFiltros();
  };
}

function render() {
  const root = $('#conteudo');
  root.innerHTML = '';

  for (const g of state.geracoes) {
    const bloco = document.createElement('section');
    bloco.className = 'gen-bloco';
    bloco.dataset.gen = g.id;
    bloco.id = `gen-${g.id}`;

    const cab = document.createElement('header');
    cab.className = 'sec-ger';
    cab.innerHTML = `
      <h2>${g.rotulo} <span>${g.regiao} · #${String(g.min).padStart(3, '0')}–#${String(g.max).padStart(3, '0')}</span></h2>
      <div class="cov">
        <b>${g.stats.completos}</b> pares · ${g.stats.comNormal} normal · ${g.stats.comShiny} shiny · ${g.total} formas
      </div>
    `;
    bloco.append(cab);

    const grid = document.createElement('div');
    grid.className = 'dex-grid';
    for (const e of g.entradas) grid.append(montarCard(e));
    bloco.append(grid);
    root.append(bloco);
  }

  pintarContagens();
  pintarGeracoes();
  aplicarFiltros();
}

// -------------------------------------------------------------- UI

function syncUi() {
  $('#zoom').value = state.zoom;
  $('#zoomv').textContent = `${state.zoom}×`;
  $('#anim').checked = state.animate;
  $('#btn-incompletos')?.classList.toggle('on', state.soIncompletos);
  for (const b of $('#dirs').querySelectorAll('button')) {
    b.classList.toggle('on', Number(b.dataset.dir) === state.dir);
  }
}

function marcarDirty() {
  for (const rec of live) rec.dirty = true;
}

async function init() {
  carregarPrefs();
  syncUi();

  const data = await fetch('/api/pokedex').then((r) => r.json());
  state.geracoes = data.geracoes;
  render();
  requestAnimationFrame(tick);

  $('#q').value = state.q;
  $('#q').addEventListener('input', (ev) => {
    state.q = ev.target.value;
    aplicarFiltros();
  });

  $('#dirs').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-dir]');
    if (!b) return;
    state.dir = Number(b.dataset.dir);
    salvarPrefs();
    syncUi();
    marcarDirty();
  });

  $('#zoom').addEventListener('input', (ev) => {
    state.zoom = Number(ev.target.value);
    salvarPrefs();
    syncUi();
    marcarDirty();
  });

  $('#anim').addEventListener('change', (ev) => {
    state.animate = ev.target.checked;
    salvarPrefs();
    marcarDirty();
  });

  $('#btn-incompletos')?.addEventListener('click', () => {
    state.soIncompletos = !state.soIncompletos;
    salvarPrefs();
    syncUi();
    aplicarFiltros();
  });

  $('#btn-backup')?.addEventListener('click', async () => {
    const btn = $('#btn-backup');
    const msg = $('#save-msg');
    const gerLabel = state.geracao === 'all'
      ? 'todas as gerações'
      : (state.geracoes.find((g) => g.id === state.geracao)?.rotulo ?? state.geracao);
    if (!confirm(
      'Copiar PNGs do lab para o backup?\n\n'
      + `Destino: Desktop/Pokedex Backup/Geração N\n`
      + `Escopo: ${gerLabel}\n\n`
      + 'Nome: ###_slug.png e ###_slug_shiny.png',
    )) return;

    btn.disabled = true;
    msg.classList.remove('erro');
    msg.textContent = 'copiando PNGs para o backup…';

    try {
      const r = await fetch('/api/pokedex/backup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ geracao: state.geracao }),
      }).then((x) => x.json());
      if (r.erro) {
        msg.textContent = r.erro;
        msg.classList.add('erro');
        return;
      }
      msg.textContent = r.msg || `${r.copiados} PNGs copiados`;
      if (r.erros?.length) {
        msg.textContent += `\n${r.erros.length} avisos (ver console)`;
        console.warn('backup pokedex', r.erros);
      }
    } catch (e) {
      msg.textContent = String(e.message || e);
      msg.classList.add('erro');
    } finally {
      btn.disabled = false;
    }
  });

  $('#btn-publicar')?.addEventListener('click', async () => {
    const btn = $('#btn-publicar');
    const msg = $('#save-msg');
    if (!confirm(
      'Publicar sprites no jogo local?\n\n'
      + 'Fonte: Desktop/Pokedex Backup\n'
      + '1. importar backup → Sprites\n'
      + '2. build → asset-packs → sync → marker-atlas\n\n'
      + 'Pode levar alguns minutos.',
    )) return;

    btn.disabled = true;
    msg.classList.remove('erro');
    msg.textContent = 'publicando… build → asset-packs → sync → atlas';

    try {
      const r = await fetch('/api/pokedex/publicar', { method: 'POST' }).then((x) => x.json());
      if (r.erro) {
        const base = r.passo ? `${r.erro} (${r.passo})` : r.erro;
        msg.textContent = r.detalhe ? `${base}\n${r.detalhe}` : base;
        msg.classList.add('erro');
        return;
      }
      msg.textContent = r.msg || 'pronto — reinicie npm start no jogo';
    } catch (e) {
      msg.textContent = String(e.message || e);
      msg.classList.add('erro');
    } finally {
      btn.disabled = false;
    }
  });
}

init().catch((e) => {
  $('#conteudo').innerHTML = `<p class="empty">erro: ${e.message}</p>`;
});
