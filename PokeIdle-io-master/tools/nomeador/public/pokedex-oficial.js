// Pokédex OFICIAL — só PNGs do backup local (###_slug.png).
import { normalizarBusca } from './busca.mjs';

const $ = (s) => document.querySelector(s);
const CAIXA = { w: 88, h: 88 };

const state = {
  geracoes: [],
  backupRaiz: '',
  dir: 3,
  zoom: 4,
  animate: true,
  q: '',
  geracao: 'all',
  soIncompletos: false,
};

const PREFS = ['dir', 'zoom', 'animate', 'geracao', 'soIncompletos'];
function carregarPrefs() {
  try { Object.assign(state, JSON.parse(localStorage.pokedexOficial || '{}')); } catch { /* ignora */ }
}
const salvarPrefs = () =>
  localStorage.setItem('pokedexOficial', JSON.stringify(Object.fromEntries(PREFS.map((k) => [k, state[k]]))));

const cacheImg = new Map();

function loadSheet(url) {
  if (cacheImg.has(url)) return cacheImg.get(url);
  const p = new Promise((ok, err) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => err(new Error(url));
    img.src = `${url}?t=${Date.now()}`;
  });
  cacheImg.set(url, p);
  return p;
}

function geometriaSheet(img) {
  const fw = Math.max(8, Math.floor(img.width / 4));
  const fh = fw;
  const nFrames = Math.max(1, Math.floor(img.height / fh));
  return { fw, fh, nFrames };
}

const live = new Set();

const observer = new IntersectionObserver((rows) => {
  for (const row of rows) {
    const rec = row.target._rec;
    if (!rec) continue;
    if (!row.isIntersecting) { live.delete(rec); continue; }
    live.add(rec);
    if (rec.img || rec.loading || !rec.entry?.url) continue;
    rec.loading = true;
    loadSheet(rec.entry.url).then(
      (img) => { rec.img = img; rec.dirty = true; },
      () => { rec.el.classList.add('vazio'); rec.el.innerHTML = '<span class="q">!</span>'; },
    );
  }
}, { rootMargin: '300px' });

function escala(fw, fh) {
  const cabe = Math.min(CAIXA.w / fw, CAIXA.h / fh);
  return cabe >= 1 ? Math.min(state.zoom, Math.floor(cabe)) : cabe;
}

function tick(now) {
  for (const rec of live) {
    if (!rec.img) continue;
    const { fw, fh, nFrames } = geometriaSheet(rec.img);
    const dir = state.dir;
    const frame = state.animate && nFrames > 1
      ? Math.floor((now / 150) % nFrames)
      : 0;
    if (!rec.dirty && rec.frame === frame && rec.dir === dir && rec.zoom === state.zoom) continue;

    const cv = rec.canvas;
    if (cv.width !== fw || cv.height !== fh) { cv.width = fw; cv.height = fh; }
    const s = escala(fw, fh);
    cv.style.width = `${fw * s}px`;
    cv.style.height = `${fh * s}px`;
    const ctx = rec.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, fw, fh);
    ctx.drawImage(
      rec.img,
      (dir - 1) * fw,
      frame * fh,
      fw,
      fh,
      0,
      0,
      fw,
      fh,
    );
    rec.frame = frame;
    rec.dir = dir;
    rec.zoom = state.zoom;
    rec.dirty = false;
  }
  requestAnimationFrame(tick);
}

function montarSlot(entry, rotulo, shiny) {
  const slot = document.createElement('div');
  slot.className = `dex-slot oficial${shiny ? ' shiny' : ''}`;

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

  const fn = document.createElement('span');
  fn.className = 'arquivo';
  fn.textContent = entry.arquivo;
  fn.title = entry.arquivo;
  slot.append(fn);

  const cv = document.createElement('canvas');
  slot.append(cv);
  const rec = {
    el: slot,
    canvas: cv,
    ctx: cv.getContext('2d'),
    entry,
    img: null,
    loading: false,
    dirty: true,
    frame: -1,
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
  card.className = `dex-card oficial${ok ? ' ok' : parcial ? ' parcial' : ' faltando'}`;
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

function cardVisivel(card) {
  const bloco = card.closest('.gen-bloco');
  if (state.geracao !== 'all' && bloco?.dataset.gen !== state.geracao) return false;
  const q = normalizarBusca(state.q);
  if (q && !(card.dataset.q || '').includes(q)) return false;
  if (state.soIncompletos && card.dataset.temNormal === '1' && card.dataset.temShiny === '1') return false;
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
    `<b>${nC}</b> pares · <b>${nN}</b> normal · <b>${nS}</b> shiny · ${total} entradas no backup`;
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
  cacheImg.clear();
  live.clear();

  for (const g of state.geracoes) {
    const bloco = document.createElement('section');
    bloco.className = 'gen-bloco';
    bloco.dataset.gen = g.id;
    bloco.id = `gen-${g.id}`;

    const cab = document.createElement('header');
    cab.className = 'sec-ger';
    const pasta = g.pasta ? `<span class="pasta-backup" title="${g.pasta}">backup</span>` : '';
    cab.innerHTML = `
      <h2>${g.rotulo} ${pasta}<span>${g.regiao} · #${String(g.min).padStart(3, '0')}–#${String(g.max).padStart(3, '0')}</span></h2>
      <div class="cov">
        <b>${g.stats.completos}</b> pares · ${g.stats.comNormal} normal · ${g.stats.comShiny} shiny · ${g.total} arquivos
      </div>
    `;
    bloco.append(cab);

    const grid = document.createElement('div');
    grid.className = 'dex-grid';
    if (!g.entradas.length) {
      grid.innerHTML = '<p class="pdx-vazio-gen">pasta vazia — adicione PNGs <code>###_slug.png</code></p>';
    } else {
      for (const e of g.entradas) grid.append(montarCard(e));
    }
    bloco.append(grid);
    root.append(bloco);
  }

  pintarContagens();
  pintarGeracoes();
  aplicarFiltros();
}

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

async function carregarDados() {
  const data = await fetch('/api/pokedex-oficial').then((r) => r.json());
  if (data.erro) throw new Error(data.erro);
  state.geracoes = data.geracoes;
  state.backupRaiz = data.backupRaiz;
  return data;
}

async function init() {
  carregarPrefs();
  syncUi();
  await carregarDados();
  render();
  requestAnimationFrame(tick);

  const msg = $('#save-msg');
  if (state.backupRaiz) {
    msg.textContent = state.backupRaiz.replace(/\\/g, '/').split('/').slice(-2).join('/');
  }

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

  $('#btn-atualizar')?.addEventListener('click', async () => {
    const btn = $('#btn-atualizar');
    btn.disabled = true;
    msg.classList.remove('erro');
    msg.textContent = 'lendo pastas…';
    try {
      cacheImg.clear();
      await carregarDados();
      render();
      msg.textContent = 'atualizado';
    } catch (e) {
      msg.textContent = String(e.message || e);
      msg.classList.add('erro');
    } finally {
      btn.disabled = false;
    }
  });

  $('#btn-publicar')?.addEventListener('click', async () => {
    const btn = $('#btn-publicar');
    if (!confirm(
      'Publicar a partir do Desktop/Pokedex Backup?\n\n'
      + '1. importar backup → Sprites\n'
      + '2. build (PNG → WEBP)\n'
      + '3. asset-packs + looktypes + marker-atlas\n\n'
      + 'Formas alternativas (_form) são ignoradas.\n'
      + 'Pode levar alguns minutos.',
    )) return;

    btn.disabled = true;
    msg.classList.remove('erro');
    msg.textContent = 'publicando… backup → build → sync → atlas';

    try {
      const r = await fetch('/api/pokedex-oficial/publicar', { method: 'POST' }).then((x) => x.json());
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
