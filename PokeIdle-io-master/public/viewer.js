// Visualizador dos looktypes espelhados por tools/fetch-poke-assets.mjs.
//
// Cada outfit é um atlas .webp + um manifest JSON. O manifest nomeia cada quadro como
// {frame}_{layer}_{addon}_{direction}.png e guarda o retângulo dele dentro do atlas —
// então desenhar um sprite é recortar esse retângulo com smoothing desligado.

import { zipStore } from './zip.mjs';
import { renderMapa as renderTiles } from './mapview.mjs';
import { fxCanvas, fxLimpar } from './fx.mjs';

const DATA = 'data';
const PACK = `${DATA}/asset-packs`;
const localize = (p) => p.replace(/^\/assets-packs/, PACK);

const DIR_LABEL = { 1: 'N', 2: 'L', 3: 'S', 4: 'O' };
const DIR_NAME = { 1: 'norte', 2: 'leste', 3: 'sul', 4: 'oeste' };
const $ = (sel) => document.querySelector(sel);

// Cada área do mundo tem sua própria imagem, e os pixels dos marcadores são relativos a ela.
const MAPA_DA_AREA = {
  kanto: '1kantoe2johto.png',
  orre: '3hoenn.png',
  outland: 'outland.png',
};

const state = {
  entries: [],
  creaturesByLooktype: new Map(),
  creaturesByPokeId: new Map(),
  items: [],
  icons: {},
  spawns: null, // index/spawns-index.json
  loot: null, // index/loot-index.json
  dir: 3,
  zoom: 2,
  animate: true,
  kind: 'all',
  q: '',
  icat: 'all',
  iq: '',
  izoom: 2,
  area: 'kanto',
  qm: '',
  mlabels: false,
  qs: '',
  sfilter: 'all',
  ql: '',
  lcat: 'all',
  lsort: 'nome',
  moves: null, // index/moves-index.json
  balls: null, // effects/catch/index.json
  qe: '',
  fxmode: 'ataques',
  fxtype: 'all',
  formulas: null, // index/formulas.json
  fmode: 'xp',
  fhunt: false,
};

// ------------------------------------------------------------- carregamento

const spriteCache = new Map();

function loadImage(src) {
  return new Promise((ok, err) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => err(new Error(`falhou: ${src}`));
    img.src = src;
  });
}

function loadOutfit(entry) {
  if (spriteCache.has(entry.id)) return spriteCache.get(entry.id);

  const p = (async () => {
    const manifest = await fetch(localize(entry.manifest)).then((r) => r.json());
    const cat = Object.values(manifest.categories)[0];
    const images = await Promise.all(cat.pages.map((pg) => loadImage(localize(pg.image))));

    const byDir = {};
    const templates = {};
    let frameW = 32;
    let frameH = 32;

    for (const [key, asset] of Object.entries(manifest.assets)) {
      const stem = key.split('/').pop().replace(/\.png$/, '');
      const isTemplate = stem.endsWith('_template');
      const nums = (isTemplate ? stem.slice(0, -'_template'.length) : stem).split('_').map(Number);
      const frame = nums[0];
      const dir = nums[3];
      const f = asset.frames[0];
      if (!f) continue;

      frameW = asset.width;
      frameH = asset.height;

      const rect = { page: f.page ?? 0, x: f.x, y: f.y, w: f.w, h: f.h, dur: f.durationMs || 150 };
      if (isTemplate) templates[`${dir}:${frame}`] = rect;
      else ((byDir[dir] ??= [])[frame - 1] = rect);
    }

    for (const dir of Object.keys(byDir)) {
      byDir[dir] = byDir[dir].filter(Boolean);
      byDir[dir].forEach((r, i) => (r.template = templates[`${dir}:${i + 1}`]));
    }

    return { entry, images, byDir, frameW, frameH };
  })();

  spriteCache.set(entry.id, p);
  return p;
}

const framesFor = (sprite, dir) =>
  sprite.byDir[dir]?.length ? sprite.byDir[dir] : sprite.byDir[3] || Object.values(sprite.byDir)[0] || [];

function drawFrame(ctx, sprite, f) {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, f.w, f.h);
  ctx.drawImage(sprite.images[f.page], f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
}

// Índice do quadro em função do tempo, respeitando a duração individual de cada um.
function frameIndexAt(frames, t) {
  const total = frames.reduce((s, f) => s + f.dur, 0);
  let m = t % total;
  for (let i = 0; i < frames.length; i++) {
    if (m < frames[i].dur) return i;
    m -= frames[i].dur;
  }
  return 0;
}

// ------------------------------------------------------------- grade/animação

const live = new Set();

const observer = new IntersectionObserver(
  (rows) => {
    for (const row of rows) {
      const rec = row.target._rec;
      if (!rec) continue;
      if (row.isIntersecting) {
        live.add(rec);
        if (!rec.sprite && !rec.loading) {
          rec.loading = true;
          loadOutfit(rec.entry).then(
            (s) => { rec.sprite = s; rec.dirty = true; },
            () => { rec.el.querySelector('.stage').innerHTML = '<span class="meta">erro</span>'; },
          );
        }
      } else {
        live.delete(rec);
      }
    }
  },
  { rootMargin: '250px' },
);

function tick(now) {
  for (const rec of live) {
    if (!rec.sprite) continue;
    const frames = framesFor(rec.sprite, state.dir);
    if (!frames.length) continue;

    const idx = state.animate && frames.length > 1 ? frameIndexAt(frames, now) : 0;
    if (!rec.dirty && rec.idx === idx && rec.dir === state.dir && rec.zoom === state.zoom) continue;

    const f = frames[idx];
    const cv = rec.canvas;
    if (cv.width !== f.w || cv.height !== f.h) {
      cv.width = f.w;
      cv.height = f.h;
    }
    cv.style.width = `${f.w * state.zoom}px`;
    cv.style.height = `${f.h * state.zoom}px`;
    drawFrame(rec.ctx, rec.sprite, f);

    rec.idx = idx;
    rec.dir = state.dir;
    rec.zoom = state.zoom;
    rec.dirty = false;
  }
  requestAnimationFrame(tick);
}

function cardFor(entry) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <div class="stage"><canvas width="32" height="32"></canvas></div>
    <div class="name" title="${entry.name}">${entry.name}</div>
    <div class="meta"><span class="badge ${entry.kind}">${entry.kind}</span><span>#${entry.id}</span></div>`;

  const canvas = el.querySelector('canvas');
  const rec = { entry, el, canvas, ctx: canvas.getContext('2d'), idx: -1, dir: -1, zoom: -1, dirty: true };
  el._rec = rec;
  el.addEventListener('click', () => {
    history.replaceState(null, '', `#o=${entry.id}`);
    openDrawer(entry);
  });
  observer.observe(el);
  return el;
}

function renderOutfits() {
  const q = state.q.toLowerCase();
  const list = state.entries.filter(
    (e) =>
      (state.kind === 'all' || e.kind === state.kind) &&
      (!q || e.name.toLowerCase().includes(q) || String(e.id).includes(q)),
  );

  live.clear();
  observer.disconnect();
  const grid = $('#grid');
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const e of list) frag.appendChild(cardFor(e));
  grid.appendChild(frag);

  $('#empty').classList.toggle('hidden', list.length > 0 || $('#grid').classList.contains('hidden'));
  state.filtered = list;
  updateCounts();
}

function updateCounts() {
  const aba = document.querySelector('.tab.on')?.dataset.tab ?? 'outfits';
  const texto = {
    outfits: () => `<b>${state.filtered?.length ?? 0}</b> de ${state.entries.length} outfits`,
    items: () => `<b>${state.ifiltered?.length ?? 0}</b> de ${state.items.length} itens`,
    mapa: () => `<b>${state.mfiltered?.length ?? 0}</b> marcadores em ${state.area}`,
    spawns: () => `<b>${state.sfiltered?.length ?? 0}</b> de ${state.creaturesByPokeId.size} pokémon`,
    loot: () => `<b>${state.lfiltered?.length ?? 0}</b> de ${Object.keys(state.loot?.porItem ?? {}).length} itens`,
    efeitos: () => `<b>${state.efiltered ?? 0}</b> ${state.fxmode}`,
    formulas: () => 'fórmulas do bundle',
  };
  $('#counts').innerHTML = texto[aba]();
}

// ------------------------------------------------------------------ drawer

async function openDrawer(entry) {
  const body = $('#drawer-body');
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  body.innerHTML = '<p class="sub">carregando…</p>';

  const sprite = await loadOutfit(entry);
  const creature = state.creaturesByLooktype.get(entry.id);
  const dirs = Object.keys(sprite.byDir).map(Number).sort();

  body.innerHTML = `
    <h2>${entry.name}</h2>
    <div class="sub">looktype <b>${entry.id}</b> · ${entry.kind} · ${entry.gender}</div>
    <div class="sheet" id="sheet"></div>
    <h3>geometria</h3>
    <dl class="kv">
      <dt>quadro</dt><dd>${sprite.frameW}×${sprite.frameH} px (${entry.width}×${entry.height} tiles)</dd>
      <dt>direções</dt><dd>${dirs.map((d) => DIR_NAME[d] ?? d).join(', ')}</dd>
      <dt>frames/direção</dt><dd>${entry.frames}</dd>
      <dt>colorizável</dt><dd>${entry.colorizable ? 'sim (tem máscara _template)' : 'não'}</dd>
    </dl>
    ${creature ? creatureBlock(creature) : ''}
    <h3>arquivos de origem</h3>
    <div class="paths">
      <div>manifest · <code>${localize(entry.manifest)}</code></div>
      <div>atlas · <code>${localize(Object.values(spriteManifestPages(sprite))[0])}</code></div>
    </div>
    <div class="row">
      <button class="ghost" id="dl-sheet">baixar folha PNG</button>
      <button class="ghost" id="dl-frames">baixar frames (.zip)</button>
    </div>`;

  const sheet = $('#sheet');
  for (const d of dirs) {
    const row = document.createElement('div');
    row.className = 'sheet-row';
    row.innerHTML = `<div class="lbl">${DIR_LABEL[d] ?? d}</div><div class="sheet-frames"></div>`;
    const box = row.querySelector('.sheet-frames');
    for (const f of sprite.byDir[d]) {
      const cell = document.createElement('div');
      const cv = document.createElement('canvas');
      cv.width = f.w;
      cv.height = f.h;
      cv.style.width = `${f.w * 2}px`;
      cv.style.height = `${f.h * 2}px`;
      drawFrame(cv.getContext('2d'), sprite, f);
      cell.appendChild(cv);
      box.appendChild(cell);
    }
    sheet.appendChild(row);
  }

  $('#dl-sheet').onclick = () => downloadSheet(entry, sprite);
  $('#dl-frames').onclick = () => exportZip([entry], `${entry.id}-${slug(entry.name)}`);
}

const spriteManifestPages = (sprite) => sprite.images.map((i) => new URL(i.src).pathname.replace(/^\//, ''));

function creatureBlock(c) {
  const stat = (label, v) => `<div class="stat"><span>${label}</span><b>${v}</b></div>`;
  return `
    <h3>ficha (creatures.json)</h3>
    <dl class="kv">
      <dt>pokéId</dt><dd>#${c.pokeId}</dd>
      <dt>raridade</dt><dd>${c.rarity ?? '—'}</dd>
      <dt>nível de caça</dt><dd>${c.huntLevel ?? '—'}</dd>
      <dt>experiência</dt><dd>${c.experience ?? '—'}</dd>
    </dl>
    <div class="types">${[c.type1, c.type2].filter(Boolean).map((t) => `<span class="type">${t}</span>`).join('')}</div>
    <h3>base stats</h3>
    <div class="stats">
      ${stat('hp', c.baseHp)}${stat('atk', c.baseAtk)}${stat('def', c.baseDef)}
      ${stat('sp.atk', c.baseSpAtk)}${stat('sp.def', c.baseSpDef)}${stat('speed', c.baseSpeed)}
    </div>`;
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
  if (location.hash.startsWith('#o=')) history.replaceState(null, '', location.pathname);
}

// Rotas: #items/#mapa/#spawns/#loot trocam de aba; #o=25 abre a ficha do looktype 25;
// #h=pikachu abre a hunt; #i=Bone abre o item.
function aplicarHash() {
  const h = location.hash;
  const aba = h.slice(1);
  if (ABAS[aba]) return selecionarAba(aba);

  const mo = h.match(/^#o=(\d+)$/);
  if (mo) {
    const entry = state.entries.find((e) => e.id === +mo[1]);
    if (entry) openDrawer(entry);
    return;
  }
  const mh = h.match(/^#h=(.+)$/);
  if (mh) {
    selecionarAba('mapa');
    abrirHunt(decodeURIComponent(mh[1]));
    return;
  }
  const mi = h.match(/^#i=(.+)$/);
  if (mi) {
    selecionarAba('loot');
    abrirItem(decodeURIComponent(mi[1]));
    return;
  }
  const mfo = h.match(/^#f=(xp|tipos|qualidade|captura|zerar)$/);
  if (mfo) {
    state.fmode = mfo[1];
    for (const c of $('#fmodes').querySelectorAll('.chip')) c.classList.toggle('on', c.dataset.value === mfo[1]);
    selecionarAba('formulas');
    history.replaceState(null, '', h);
    return;
  }
  const mf = h.match(/^#fx=(ataques|folhas|bolas)$/);
  if (mf) {
    state.fxmode = mf[1];
    for (const c of $('#fxmodes').querySelectorAll('.chip')) c.classList.toggle('on', c.dataset.value === mf[1]);
    $('#fxtypes').classList.toggle('hidden', mf[1] !== 'ataques');
    selecionarAba('efeitos');
    history.replaceState(null, '', h); // selecionarAba reescreveu para #efeitos
  }
}

// ------------------------------------------------------------- exportações

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Folha: uma linha por direção, uma coluna por frame.
function downloadSheet(entry, sprite) {
  const dirs = Object.keys(sprite.byDir).map(Number).sort();
  const cols = Math.max(...dirs.map((d) => sprite.byDir[d].length));
  const cv = document.createElement('canvas');
  cv.width = sprite.frameW * cols;
  cv.height = sprite.frameH * dirs.length;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  dirs.forEach((d, row) => {
    sprite.byDir[d].forEach((f, col) => {
      ctx.drawImage(sprite.images[f.page], f.x, f.y, f.w, f.h, col * sprite.frameW, row * sprite.frameH, f.w, f.h);
    });
  });

  cv.toBlob((b) => downloadBlob(b, `${entry.id}-${slug(entry.name)}-sheet.png`));
}

const canvasToBytes = (cv) =>
  new Promise((ok) => cv.toBlob((b) => b.arrayBuffer().then((a) => ok(new Uint8Array(a))), 'image/png'));

async function exportZip(entries, nome) {
  const btn = $('#export-zip');
  btn.disabled = true;
  try {
    await empacotar(entries, nome);
  } catch (err) {
    toast(`falhou ao exportar: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function empacotar(entries, nome) {
  const files = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    toast(`empacotando ${i + 1}/${entries.length} — ${entry.name}`, 0);
    let sprite;
    try {
      sprite = await loadOutfit(entry);
    } catch {
      continue;
    }
    const dir = `${entry.kind}/${entry.id}-${slug(entry.name)}`;
    for (const d of Object.keys(sprite.byDir)) {
      const frames = sprite.byDir[d];
      for (let n = 0; n < frames.length; n++) {
        const f = frames[n];
        const cv = document.createElement('canvas');
        cv.width = f.w;
        cv.height = f.h;
        drawFrame(cv.getContext('2d'), sprite, f);
        files.push({ name: `${dir}/dir${d}_frame${n + 1}.png`, data: await canvasToBytes(cv) });
      }
    }
  }

  toast('gerando o .zip…', 0);
  downloadBlob(zipStore(files), `${nome}.zip`);
  toast(`${files.length} PNGs exportados`);
}

let toastTimer;
function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (el.hidden = true), ms);
}

// -------------------------------------------------------------------- itens

function renderItems() {
  const q = state.iq.toLowerCase();
  const list = state.items.filter(
    (it) => (state.icat === 'all' || it.category === state.icat) && (!q || it.name.toLowerCase().includes(q)),
  );

  const grid = $('#igrid');
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const it of list) {
    const rel = state.icons[it.id];
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="stage">${
        rel
          ? `<img src="${DATA}/${rel}" alt="${it.name}" loading="lazy" style="width:${32 * state.izoom}px">`
          : '<span class="meta">sem ícone</span>'
      }</div>
      <div class="name" title="${it.name}">${it.name}</div>
      <div class="meta"><span class="badge">${it.category}</span>${it.rare ? '<span class="badge shiny">raro</span>' : ''}</div>`;
    el.title = `#${it.id} · ${it.name}\n${it.npcPrice ? `npc: ${it.npcPrice}` : ''}\n${rel ?? ''}`;
    frag.appendChild(el);
  }
  grid.appendChild(frag);

  // 4 ícones do catálogo apontam para URLs que já morreram na origem (pokexguides).
  for (const im of grid.querySelectorAll('img')) {
    im.onerror = () => { im.outerHTML = '<span class="meta">ícone 404 na origem</span>'; };
  }

  state.ifiltered = list;
  $('#empty').classList.toggle('hidden', list.length > 0 || $('#igrid').classList.contains('hidden'));
  updateCounts();
}

// ------------------------------------------------------- sprite de apoio

// Canvas estático (frame 0, virado pro sul) para usar em listas fora da aba Outfits.
// `caixa` limita o lado maior em px — sem isso um Onix 96×96 quebra o alinhamento da grade.
function spriteEstatico(looktype, zoom = 2, caixa = null) {
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 32;
  cv.style.width = `${32 * zoom}px`;
  cv.style.height = `${32 * zoom}px`;

  const entry = state.entries.find((e) => e.id === looktype);
  if (!entry) return cv;

  loadOutfit(entry).then((sprite) => {
    const f = framesFor(sprite, 3)[0];
    if (!f) return;
    const escala = caixa ? Math.min(caixa / f.w, caixa / f.h, zoom) : zoom;
    cv.width = f.w;
    cv.height = f.h;
    cv.style.width = `${f.w * escala}px`;
    cv.style.height = `${f.h * escala}px`;
    drawFrame(cv.getContext('2d'), sprite, f);
  }).catch(() => {});

  return cv;
}

// chance é percentual × 1000 (confere com a pokepedia deles: 71498 → 71%)
const pctDrop = (chance) => {
  const p = chance / 1000;
  if (p >= 1) return `${p.toFixed(1)}%`;
  if (p >= 0.01) return `${p.toFixed(2)}%`;
  return p ? `${p.toFixed(4)}%` : '—';
};

const num = (n) => (n == null ? '—' : n.toLocaleString('pt-BR'));

// -------------------------------------------------------------- mapa-múndi

function renderMapaMundi() {
  const host = $('#mapa');
  const hunts = Object.values(state.spawns.porHunt).filter((h) => h.area === state.area);
  const q = state.qm.toLowerCase();

  host.innerHTML = `
    <div class="maplegend">
      <span><i style="background:#ffd166"></i>cidade / sem spawn</span>
      <span><i style="background:#ff6b6b"></i>boss</span>
      <span><i style="background:#4fc3f7"></i>hunt</span>
      <span>${hunts.length} marcadores em ${state.area}</span>
    </div>
    <div class="mapstage"><img src="${DATA}/site/assets/maps/${MAPA_DA_AREA[state.area]}" alt="mapa de ${state.area}"></div>`;

  const stage = host.querySelector('.mapstage');
  const img = stage.querySelector('img');

  const plotar = () => {
    // pixel do marcador é relativo ao tamanho natural da imagem daquela área
    const escala = img.clientWidth / img.naturalWidth;
    for (const h of hunts) {
      if (!h.pixel) continue;
      const casa = !q || h.nome.toLowerCase().includes(q) || h.slug.includes(q);

      const b = document.createElement('button');
      const tipo = h.totalSpawns === 0 ? 'city' : /^(brave|ancient|furious|enraged|brute|dark|evil|freezing|psy|heavy|milch|roll|hard|banshee|trickmaster|charged|magnetic|enigmatic|tribal|war|taekwondo)_/.test(h.slug) ? 'boss' : '';
      b.className = `marker ${tipo}${casa ? '' : ' dim'}`;
      b.style.left = `${h.pixel[0] * escala}px`;
      b.style.top = `${h.pixel[1] * escala}px`;
      b.title = `${h.nome} — ${h.totalSpawns} spawns`;
      b.onclick = () => abrirHunt(h.slug);
      stage.appendChild(b);

      if (state.mlabels && casa) {
        const l = document.createElement('span');
        l.className = 'marker-lbl';
        l.style.left = `${h.pixel[0] * escala}px`;
        l.style.top = `${h.pixel[1] * escala}px`;
        l.textContent = h.nome;
        stage.appendChild(l);
      }
    }
  };

  if (img.complete) plotar();
  else img.onload = plotar;

  state.mfiltered = hunts.filter((h) => !q || h.nome.toLowerCase().includes(q) || h.slug.includes(q));
  updateCounts();
}

async function abrirHunt(slug) {
  const h = state.spawns.porHunt[slug];
  if (!h) return;
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  const body = $('#drawer-body');

  const npcs = h.npcs.length
    ? `<h3>NPCs</h3><div class="chips">${h.npcs.map((n) => `<span class="chip">${n.kind} <span class="n">${n.x},${n.y}</span></span>`).join('')}</div>`
    : '';

  body.innerHTML = `
    <h2>${h.nome}</h2>
    <div class="sub">hunt <code>${h.slug}</code> · ${h.area}${h.nivel ? ` · nível ${h.nivel}` : ''}</div>
    <dl class="kv">
      <dt>pontos de spawn</dt><dd>${num(h.totalSpawns)}</dd>
      <dt>espécies</dt><dd>${h.pokemon.length || '—'}</dd>
      <dt>entrada</dt><dd>${h.start ? `${h.start.x}, ${h.start.y}` : '—'}</dd>
      <dt>região no mundo</dt><dd>${h.range ? `x ${h.range[0]}–${h.range[2]}, y ${h.range[1]}–${h.range[3]}, z ${h.range[4]}` : '—'}</dd>
    </dl>
    ${npcs}
    <h3>quem aparece aqui</h3>
    <div class="droplist" id="hunt-mons"></div>
    <h3>mapa de tiles</h3>
    <div class="row">
      <button class="ghost" id="btn-render">renderizar mapa</button>
      <label class="check"><input type="checkbox" id="chk-pins" checked> marcar spawns</label>
    </div>
    <div id="map-out"></div>`;

  const mons = $('#hunt-mons');
  if (!h.pokemon.length) mons.innerHTML = '<div class="sub">nenhum spawn cadastrado (cidade ou área de serviço)</div>';
  for (const p of h.pokemon) {
    const c = state.creaturesByPokeId.get(p.pokeId);
    const row = document.createElement('div');
    row.className = 'droprow';
    row.innerHTML = `<span></span><span class="pct">${p.pontos} pts</span><span class="qt">${c?.huntLevel ? `lv ${c.huntLevel}` : ''}</span>`;
    const nome = document.createElement('span');
    nome.style.cssText = 'display:flex;align-items:center;gap:7px';
    if (c) nome.appendChild(spriteEstatico(c.looktype, 1, 28));
    nome.append(p.nome);
    row.replaceChild(nome, row.firstElementChild);
    mons.appendChild(row);
  }

  $('#btn-render').onclick = () => desenharMapa(slug, h);
}

async function desenharMapa(slug, hunt) {
  const out = $('#map-out');
  const btn = $('#btn-render');
  btn.disabled = true;
  out.innerHTML = '<p class="sub" id="map-prog">carregando…</p>';
  const prog = $('#map-prog');

  try {
    const r = await renderTiles(slug, { onProgress: (m) => (prog.textContent = m) });
    out.innerHTML = `
      <div class="sub">${num(r.tiles)} tiles · ${num(r.desenhados)} sprites${r.faltando ? ` · ${r.faltando} ids sem asset` : ''} · render ${r.escala}× · ${r.canvas.width}×${r.canvas.height}px</div>
      <div class="row"><button class="ghost" id="map-png">baixar PNG do mapa</button></div>
      <div class="maprender"><div class="mapinner"></div></div>`;

    $('#map-png').onclick = () => {
      toast('gerando PNG…', 0);
      r.canvas.toBlob((b) => {
        downloadBlob(b, `mapa-${slug}.png`);
        toast(`${r.canvas.width}×${r.canvas.height} exportado`);
      });
    };

    const inner = out.querySelector('.mapinner');
    inner.appendChild(r.canvas);

    if ($('#chk-pins').checked) {
      for (const s of hunt.spawns) {
        const [x, y] = r.paraPixel(s.x, s.y);
        const pin = document.createElement('span');
        pin.className = 'spawnpin';
        pin.style.left = `${x}px`;
        pin.style.top = `${y}px`;
        pin.title = state.creaturesByPokeId.get(s.pokeId)?.name ?? `#${s.pokeId}`;
        inner.appendChild(pin);
      }
    }

    // começa a vista centrada na entrada da hunt
    const box = out.querySelector('.maprender');
    const [cx, cy] = r.paraPixel(hunt.start?.x ?? 0, hunt.start?.y ?? 0);
    box.scrollLeft = cx - box.clientWidth / 2;
    box.scrollTop = cy - box.clientHeight / 2;
  } catch (err) {
    out.innerHTML = `<p class="sub">falhou: ${err.message}</p>`;
  } finally {
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------ spawns

function renderSpawns() {
  const q = state.qs.toLowerCase();
  const lista = [...state.creaturesByPokeId.values()]
    .filter((c) => {
      const locs = state.spawns.porPokemon[c.pokeId] ?? [];
      if (state.sfilter === 'sem' && locs.length) return false;
      if (state.sfilter === 'com' && !locs.length) return false;
      return !q || c.name.toLowerCase().includes(q);
    })
    .sort((a, b) => a.pokeId - b.pokeId);

  const grid = $('#sgrid');
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const c of lista) {
    const locs = state.spawns.porPokemon[c.pokeId] ?? [];
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="sp-head">
        <div class="sp-slot"></div>
        <div>
          <div class="sp-name">${c.name}</div>
          <div class="sp-sub">#${c.pokeId} · ${[c.type1, c.type2].filter(Boolean).join('/')}${c.huntLevel ? ` · lv ${c.huntLevel}` : ''}</div>
        </div>
      </div>
      <div class="sp-locs">${
        locs.length
          ? locs.map((l) => `<span class="loc">${l.nome} <b>${l.pontos}</b></span>`).join('')
          : '<span class="loc none">sem hunt (pesca, evolução ou troca)</span>'
      }</div>`;
    el.querySelector('.sp-slot').replaceWith(spriteEstatico(c.looktype, 1.5, 44));
    el.onclick = () => locs[0] && abrirHunt(locs[0].slug);
    frag.appendChild(el);
  }

  grid.appendChild(frag);
  state.sfiltered = lista;
  $('#empty').classList.toggle('hidden', lista.length > 0 || $('#sgrid').classList.contains('hidden'));
  updateCounts();
}

// -------------------------------------------------------------------- loot

function renderLoot() {
  const q = state.ql.toLowerCase();
  let lista = Object.values(state.loot.porItem).filter(
    (i) => (state.lcat === 'all' || i.categoria === state.lcat) && (!q || i.nome.toLowerCase().includes(q)),
  );

  const melhorChance = (i) => Math.max(0, ...i.dropadoPor.map((d) => d.chance));
  const ord = {
    nome: (a, b) => a.nome.localeCompare(b.nome),
    preco: (a, b) => (b.npcPrice ?? -1) - (a.npcPrice ?? -1),
    drops: (a, b) => b.dropadoPor.length - a.dropadoPor.length,
    chance: (a, b) => melhorChance(b) - melhorChance(a),
  };
  lista.sort(ord[state.lsort]);

  const grid = $('#lgrid');
  grid.innerHTML = `
    <div class="lootrow head">
      <span></span><span>item</span><span class="li-num">preço npc</span>
      <span class="li-num">nº que dropa</span><span>quem dropa (melhores chances)</span>
    </div>`;

  const frag = document.createDocumentFragment();
  for (const i of lista) {
    const rel = i.itemId != null ? state.icons[i.itemId] : null;
    const row = document.createElement('div');
    row.className = 'lootrow';
    row.innerHTML = `
      ${rel ? `<img src="${DATA}/${rel}" alt="" loading="lazy">` : '<span></span>'}
      <div><div class="li-name">${i.nome}</div><div class="li-cat">${i.categoria ?? '—'}${i.raro ? ' · raro' : ''}</div></div>
      <div class="li-num"><b>${num(i.npcPrice)}</b></div>
      <div class="li-num"><b>${i.dropadoPor.length}</b></div>
      <div class="li-who">${
        i.dropadoPor.slice(0, 4).map((d) => `${d.nome} ${pctDrop(d.chance)}`).join(' · ') || 'ninguém (loja / quest)'
      }</div>`;
    row.onclick = () => abrirItem(i.nome);
    frag.appendChild(row);
  }
  grid.appendChild(frag);

  for (const im of grid.querySelectorAll('img')) im.onerror = () => im.remove();

  state.lfiltered = lista;
  $('#empty').classList.toggle('hidden', lista.length > 0 || $('#lgrid').classList.contains('hidden'));
  updateCounts();
}

function abrirItem(nome) {
  const i = state.loot.porItem[nome];
  if (!i) return;
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  const rel = i.itemId != null ? state.icons[i.itemId] : null;

  $('#drawer-body').innerHTML = `
    <h2 style="display:flex;align-items:center;gap:10px">
      ${rel ? `<img src="${DATA}/${rel}" style="image-rendering:pixelated;max-height:38px">` : ''}${i.nome}
    </h2>
    <div class="sub">${i.categoria ?? 'sem categoria'}${i.raro ? ' · raro' : ''}${i.itemId != null ? ` · id ${i.itemId}` : ''}</div>
    <dl class="kv">
      <dt>preço no NPC</dt><dd>${num(i.npcPrice)}</dd>
      <dt>dropado por</dt><dd>${i.dropadoPor.length} pokémon</dd>
      <dt>ícone</dt><dd><code>${i.icone ?? '—'}</code></dd>
    </dl>
    ${
      i.dropadoPor.length
        ? `<h3>quem dropa</h3><div class="droplist">${i.dropadoPor
            .map(
              (d) => `<div class="droprow"><span>${d.nome}</span>
                <span class="pct">${pctDrop(d.chance)}</span>
                <span class="qt">${d.min === d.max ? d.min : `${d.min}–${d.max}`}×</span></div>`,
            )
            .join('')}</div>`
        : '<h3>quem dropa</h3><div class="sub">ninguém — vem de loja, quest ou evento</div>'
    }`;
}

// ------------------------------------------------------------------ efeitos

const fxUrl = (file) => `${DATA}/effects/moves/${file}`;

// O efeito visual de um golpe vem do servidor no evento de batalha (campo `fx`); offline o
// que dá para amarrar é o TIPO do ataque, que é o fallback do próprio cliente.
function fxDoAtaque(a) {
  const chave = a.efeitoTipo;
  if (!chave) return null;
  const e = state.moves.efeitos[chave];
  return e && { ...e, url: fxUrl(e.file), chave };
}

function cardEfeito(chave, e) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `<div class="stage"></div>
    <div class="name" title="${chave}">${chave.replace(/_/g, ' ').toLowerCase()}</div>
    <div class="fx-meta">${e.frameW}×${e.frameH} · ${e.frames} quadros<br>${e.frameMs}ms/quadro${e.scale !== 1 ? ` · escala ${e.scale}` : ''}</div>`;
  el.querySelector('.stage').appendChild(fxCanvas({ ...e, url: fxUrl(e.file) }, 100));
  el.onclick = () => abrirEfeito(chave, e);
  return el;
}

function renderEfeitos() {
  const grid = $('#egrid');
  fxLimpar(grid);
  grid.innerHTML = '';
  const q = state.qe.toLowerCase();
  const frag = document.createDocumentFragment();
  let n = 0;

  if (state.fxmode === 'folhas') {
    for (const [chave, e] of Object.entries(state.moves.efeitos)) {
      if (q && !chave.toLowerCase().includes(q)) continue;
      frag.appendChild(cardEfeito(chave, e));
      n++;
    }
  } else if (state.fxmode === 'bolas') {
    for (const [id, b] of Object.entries(state.balls)) {
      for (const modo of ['catch', 'broke']) {
        if (!b[modo]) continue;
        const rotulo = `${b.nome} · ${modo === 'catch' ? 'captura' : 'quebra'}`;
        if (q && !rotulo.toLowerCase().includes(q)) continue;
        const el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = `<div class="stage"></div>
          <div class="name">${rotulo}</div>
          <div class="fx-meta">${b.frameW}×${b.frameH} · ${b[modo].frames} quadros<br>75ms/quadro · bola ${id}</div>`;
        el.querySelector('.stage').appendChild(
          fxCanvas(
            { url: `${DATA}/effects/catch/${b[modo].file}`, frameW: b.frameW, frameH: b.frameH, frames: b[modo].frames, frameMs: 75 },
            100,
          ),
        );
        frag.appendChild(el);
        n++;
      }
    }
  } else {
    const ataques = Object.values(state.moves.porAtaque)
      .filter((a) => (state.fxtype === 'all' || a.tipo === state.fxtype) && (!q || a.nome.toLowerCase().includes(q)))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    for (const a of ataques) {
      const fx = fxDoAtaque(a);
      const el = document.createElement('div');
      el.className = 'card atk';
      el.innerHTML = `
        <div class="stage"></div>
        <div class="atk-head">
          <span class="atk-name" title="${a.nome}">${a.nome}</span>
          <span class="fx-type">${a.tipo}</span>
        </div>
        <div class="atk-nums">
          <span>pwr <b>${a.powerMin === a.powerMax ? a.powerMin : `${a.powerMin}–${a.powerMax}`}</b></span>
          <span>cd <b>${(a.cooldownMs / 1000).toFixed(0)}s</b></span>
          <span><b>${a.aprendidoPor.length}</b> mons</span>
        </div>`;
      const stage = el.querySelector('.stage');
      if (fx) stage.appendChild(fxCanvas(fx, 96));
      else stage.innerHTML = '<span class="meta">sem folha</span>';
      el.onclick = () => abrirAtaque(a.nome);
      frag.appendChild(el);
      n++;
    }
  }

  grid.appendChild(frag);
  state.efiltered = n;
  $('#empty').classList.toggle('hidden', n > 0 || $('#egrid').classList.contains('hidden'));
  updateCounts();
}

function abrirEfeito(chave, e) {
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  const usadoPor = Object.values(state.moves.porAtaque).filter((a) => a.efeitoTipo === chave);

  $('#drawer-body').innerHTML = `
    <h2>${chave.replace(/_/g, ' ').toLowerCase()}</h2>
    <div class="sub">folha de efeito · <code>${e.file}</code></div>
    <div id="fx-big"></div>
    <dl class="kv">
      <dt>quadro</dt><dd>${e.frameW}×${e.frameH} px</dd>
      <dt>quadros</dt><dd>${e.frames} (tira vertical de ${e.frameH * e.frames}px)</dd>
      <dt>duração</dt><dd>${e.frameMs}ms/quadro · ${((e.frames * e.frameMs) / 1000).toFixed(2)}s no total</dd>
      <dt>escala</dt><dd>${e.scale ?? 1}×</dd>
      <dt>offset</dt><dd>${(e.offset ?? [0, 0]).join(', ')} tiles</dd>
      ${e.under ? '<dt>camada</dt><dd>desenhado abaixo dos personagens</dd>' : ''}
      <dt>origem</dt><dd><code>/assets/effects/moves/${e.file}</code></dd>
    </dl>
    <div class="row"><button class="ghost" id="fx-dl">baixar quadros (.zip)</button></div>
    ${usadoPor.length ? `<h3>ataques desse tipo (${usadoPor.length})</h3><div class="paths">${usadoPor.map((a) => a.nome).join(' · ')}</div>` : ''}`;

  $('#fx-big').appendChild(fxCanvas({ ...e, url: fxUrl(e.file) }, 190));
  $('#fx-dl').onclick = () => exportarQuadrosFx(chave, { ...e, url: fxUrl(e.file) });
}

// Fatia a tira vertical em PNGs soltos — o que o pessoal costuma querer para montar GIF.
async function exportarQuadrosFx(chave, fx) {
  toast('fatiando quadros…', 0);
  try {
    const img = await new Promise((ok, err) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => err(new Error('não carregou a folha'));
      i.src = fx.url;
    });

    const arquivos = [];
    for (let n = 0; n < fx.frames; n++) {
      const cv = document.createElement('canvas');
      cv.width = fx.frameW;
      cv.height = fx.frameH;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, n * fx.frameH, fx.frameW, fx.frameH, 0, 0, fx.frameW, fx.frameH);
      arquivos.push({
        name: `${slug(chave)}/${String(n + 1).padStart(3, '0')}.png`,
        data: await canvasToBytes(cv),
      });
    }

    downloadBlob(zipStore(arquivos), `fx-${slug(chave)}.zip`);
    toast(`${arquivos.length} quadros exportados`);
  } catch (err) {
    toast(`falhou: ${err.message}`);
  }
}

function abrirAtaque(nome) {
  const a = state.moves.porAtaque[nome];
  if (!a) return;
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  const fx = fxDoAtaque(a);

  $('#drawer-body').innerHTML = `
    <h2>${a.nome}</h2>
    <div class="sub">${a.tipo} · ${a.categoria}${a.tm ? ` · TM ${a.tm}` : ''}</div>
    <div id="fx-big"></div>
    <dl class="kv">
      <dt>power</dt><dd>${a.powerMin === a.powerMax ? a.powerMin : `${a.powerMin} – ${a.powerMax} (varia por espécie)`}</dd>
      <dt>cooldown</dt><dd>${(a.cooldownMs / 1000).toFixed(1)}s</dd>
      <dt>aprendido por</dt><dd>${a.aprendidoPor.length} pokémon</dd>
      <dt>efeito visual</dt><dd>${fx ? `folha do tipo <code>${fx.chave}</code>` : 'sem folha para este tipo'}</dd>
    </dl>
    <h3>quem aprende</h3>
    <div class="droplist">${a.aprendidoPor
      .map(
        (p) => `<div class="droprow"><span>${p.nome}</span>
          <span class="pct">${p.learnLevel != null ? `lv ${p.learnLevel}` : '—'}</span>
          <span class="qt">pwr ${p.power}</span></div>`,
      )
      .join('')}</div>`;

  if (fx) $('#fx-big').appendChild(fxCanvas(fx, 190));
}

// ----------------------------------------------------------------- fórmulas

const xpTotal = (L) => (L <= 1 ? 0 : Math.round((50 / 3) * (L ** 3 - 6 * L ** 2 + 17 * L - 12)));
const nivelDoXp = (xp) => {
  let L = 1;
  while (xpTotal(L + 1) <= xp && L < 5000) L++;
  return L;
};

const classeEf = (v) =>
  v === 0 ? 'x0' : v < 0.5 ? 'xlow' : v < 1 ? 'xmid' : v === 1 ? 'x1' : v <= 2.5 ? 'xhi' : 'xmax';
const fmtEf = (v) => (v === 1 ? '·' : v === 0 ? '0' : `${+v.toFixed(2)}`);

function renderFormulas() {
  const f = state.formulas;
  const host = $('#fgrid');
  const modo = state.fmode;

  if (modo === 'xp') {
    host.innerHTML = `
      <h2>XP e níveis</h2>
      <p>A curva cúbica do jogo. O próprio texto de ajuda deles cita a fórmula literalmente.
         O mesmo XP de um kill vai para o treinador <b>e</b> para o pokémon ativo — dois níveis independentes.</p>
      <div class="formula">${f.xp.formula}</div>
      <div class="aviso"><b>Não existe nível máximo.</b> A ajuda do jogo é explícita:
        "the level is infinite (the curve just gets more expensive)". Qualquer meta de
        "level max" é inalcançável por construção.</div>
      <h3>calculadora</h3>
      <div class="calc">
        <label>nível <input type="number" id="c-nivel" value="100" min="1" max="2000"></label>
        <div class="out">XP total: <b id="c-xp">—</b></div>
        <div class="out">custo do nível: <b id="c-custo">—</b></div>
        <div class="out">kills a 19.508 xp: <b id="c-kills">—</b></div>
      </div>
      <h3>a curva</h3>
      <table>
        <thead><tr><th>nível</th><th>XP total</th><th>custo do nível</th></tr></thead>
        <tbody>${f.xp.amostra
          .filter((a) => a.nivel > 1)
          .map((a) => `<tr><td>${a.nivel}</td><td>${num(a.xpTotal)}</td><td>${num(a.custoDoNivel)}</td></tr>`)
          .join('')}</tbody>
      </table>
      <h3>xp por kill no catálogo</h3>
      <p>mínimo <b>${num(f.xp.porKill.min)}</b> · mediana <b>${num(f.xp.porKill.mediana)}</b> ·
         máximo <b>${num(f.xp.porKill.max)}</b> (hunts de nível 470–550)</p>`;

    const recalc = () => {
      const L = Math.max(1, Math.min(2000, +$('#c-nivel').value || 1));
      $('#c-xp').textContent = num(xpTotal(L));
      $('#c-custo').textContent = num(xpTotal(L) - xpTotal(L - 1));
      $('#c-kills').textContent = num(Math.ceil(xpTotal(L) / f.xp.porKill.max));
    };
    $('#c-nivel').oninput = recalc;
    recalc();
  } else if (modo === 'tipos') {
    const t = f.tipos.lista;
    const hunt = state.fhunt;
    host.innerHTML = `
      <h2>Tabela de tipos</h2>
      <p>Linha = tipo do ataque, coluna = tipo do defensor. Contra dois tipos, os dois valores
         se multiplicam. Este jogo amplifica a vantagem em +50% nos dois sentidos dentro da hunt.</p>
      <div class="formula">efetivo = base &gt; 1 ? 1 + (base − 1) × 1.5 : base &lt; 1 ? base / 1.5 : base</div>
      <div class="calc">
        <label class="check"><input type="checkbox" id="c-hunt" ${hunt ? 'checked' : ''}> mostrar valores amplificados da hunt</label>
      </div>
      <div class="tchart-wrap"><table class="tchart">
        <thead><tr><th class="rowh">atk \\ def</th>${t.map((x) => `<th>${x.slice(0, 3)}</th>`).join('')}</tr></thead>
        <tbody>${t
          .map(
            (a) =>
              `<tr><th class="rowh">${a}</th>${t
                .map((d) => {
                  const v = f.tipos.matriz[a][d][hunt ? 'hunt' : 'normal'];
                  return `<td class="${classeEf(v)}" title="${a} → ${d}: ×${v}">${fmtEf(v)}</td>`;
                })
                .join('')}</tr>`,
          )
          .join('')}</tbody>
      </table></div>
      <h3>outros modificadores de combate</h3>
      <table><tbody>
        <tr><td>HP do selvagem na hunt</td><td>×${f.combate.wildHp.valor}</td></tr>
        <tr><td>dano do selvagem</td><td>×${f.combate.wildDano.valor}</td></tr>
        <tr><td>bônus de clã (rank 5)</td><td>+30% ATK/SpATK/DEF/SpDEF</td></tr>
      </tbody></table>`;
    $('#c-hunt').onchange = (e) => { state.fhunt = e.target.checked; renderFormulas(); };
  } else if (modo === 'qualidade') {
    host.innerHTML = `
      <h2>Stats, IV e Qualidade</h2>
      <div class="formula">${f.stats.stat}\n${f.stats.power}</div>
      <p>O expoente muda por stat: <b>hp</b> e <b>speed</b> usam 0,95; os outros quatro usam 0,8.
         A qualidade entra duas vezes (dentro de cada stat e de novo no Power) — por isso pesa
         mais que o IV.</p>
      <h3>bandas de qualidade no roll de captura</h3>
      <table>
        <thead><tr><th>faixa</th><th>chance</th><th>rótulo</th></tr></thead>
        <tbody>${f.qualidade.bandas
          .map((b) => {
            const rot = f.qualidade.rotulos.find((r) => b.min >= r.min)?.label ?? '—';
            return `<tr><td>${b.min === b.max ? `exatamente ${b.min.toFixed(3)}` : `${b.min} – ${b.max}`}</td><td>${b.chance}%</td><td>${rot}</td></tr>`;
          })
          .join('')}</tbody>
      </table>
      <div class="aviso">O intervalo <b>1,6–1,7 é um buraco intencional</b> — ninguém nasce nele.
        Mítica (2,0+), Anciã (3,0+) e Divina (4,0+) não saem de captura selvagem, que tem teto 1,8.</div>
      <h3>crescimento (IV)</h3>
      <p><b>${f.crescimento.min} a ${f.crescimento.max}</b> por stat, ${f.crescimento.porStat} stats,
         fixos na captura — evoluir não rerola. Shiny: ${f.crescimento.shiny}.</p>`;
  } else if (modo === 'captura') {
    host.innerHTML = `
      <h2>Captura</h2>
      <p>Há <b>dois mecanismos diferentes</b>, e a ajuda do jogo é explícita sobre isso: o
         medidor de investimento das capturas normais <b>não vale para shiny</b>.</p>

      <h3>pokébolas</h3>
      <p>O <code>catchRate</code> é a "eficiência de captura ×N" que o jogo mostra. O cliente
         trata <b>≥ 255 como captura garantida</b>.</p>
      <table>
        <thead><tr><th>bola</th><th>catchRate</th><th>preço (ouro)</th><th>ouro por ponto</th><th>comprável</th></tr></thead>
        <tbody>${f.bolas
          .map(
            (b) =>
              `<tr><td>${b.nome}</td><td>${b.catchRate === 255 ? '255 (garantida)' : `×${b.catchRate}`}</td>
               <td>${b.priceGold ? num(b.priceGold) : '—'}</td>
               <td>${b.priceGold ? (b.priceGold / b.catchRate).toFixed(1) : '—'}</td>
               <td>${b.compravel ? 'sim' : 'não'}</td></tr>`,
          )
          .join('')}</tbody>
      </table>
      <p>A coluna "ouro por ponto" mostra que a Poké Ball é a mais eficiente por ouro (5,0) e
         a Idle Ball a menos (80,0) — as bolas caras compram <b>menos arremessos</b>, não
         mais eficiência por moeda.</p>

      <h3>shiny</h3>
      <div class="formula">chance = min(1, shinyBase × catchRate_da_bola)</div>
      <p>${f.captura.shiny}</p>

      <h3>captura normal</h3>
      <p>${f.captura.normal}</p>
      <div class="aviso">O limiar do medidor é server-side. O que dá para observar é o painel
        <code>/api/game/used-balls</code>, que acompanha por espécie: tentativas, bolas usadas
        por tipo e ouro gasto, contra o <code>price</code> da espécie.</div>

      <h3>modificadores</h3>
      <table><tbody>
        <tr><td>Capture Boost</td><td>dobra a chance por arremesso</td></tr>
        <tr><td>Pokédex (100 kills da espécie)</td><td>dá um captureBonus por espécie</td></tr>
        <tr><td>catchChance da hunt</td><td>valor próprio por hunt, no hunt-config</td></tr>
      </tbody></table>`;
  } else {
    const m = f.marcos;
    const ritmos = [3, 5, 10];
    const horas = (kills, seg) => (kills * seg) / 3600;
    host.innerHTML = `
      <h2>Quanto tempo para "zerar"</h2>
      <div class="aviso"><b>"Level max em todos" não existe.</b> A curva é infinita e sem cap.
        O que é finito é a coleção.</div>
      <h3>marcos finitos</h3>
      <table>
        <thead><tr><th>marco</th><th>custo</th></tr></thead>
        <tbody>
          <tr><td>capturar todas as espécies</td><td>${m.capturarTodos.alvo} espécies (${m.capturarTodos.semHunt} sem hunt selvagem)</td></tr>
          <tr><td>pokédex completa (+25% XP cada)</td><td>${num(m.pokedexCompleta.total)} kills</td></tr>
          <tr><td>todos os ${m.todosShinyCards.especies} Shiny Cards</td><td>${num(m.todosShinyCards.total)} kills</td></tr>
          <tr><td>1 Streak Point</td><td>1.000 kills</td></tr>
        </tbody>
      </table>
      <p>O gargalo são os <b>${num(m.todosShinyCards.total)} kills</b> dos Shiny Cards — 21× tudo o mais somado.
         E é 1 card por espécie: cada tentativa de captura shiny falhada consome o card.</p>
      <h3>convertendo em tempo</h3>
      <p>A fórmula de dano é server-side, então a taxa de kills não é derivável dos dados
         públicos. A conta abaixo é em função do ritmo, contínuo e sem pausa.</p>
      <table>
        <thead><tr><th>ritmo</th><th>pokédex (${num(m.pokedexCompleta.total)})</th><th>todos os cards (${num(m.todosShinyCards.total)})</th></tr></thead>
        <tbody>${ritmos
          .map(
            (s) =>
              `<tr><td>1 kill / ${s}s</td><td>${horas(m.pokedexCompleta.total, s).toFixed(0)} h</td>
               <td><b>${(horas(m.todosShinyCards.total, s) / 24).toFixed(0)} dias</b></td></tr>`,
          )
          .join('')}</tbody>
      </table>
      <h3>o que não deu para extrair</h3>
      <ul class="paths">${f.naoDisponivel.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  }

  state.ffiltered = modo;
  $('#empty').classList.add('hidden');
  updateCounts();
}

// -------------------------------------------------------------------- boot

function chips(host, opções, ativo, onPick) {
  host.innerHTML = '';
  for (const { value, label, n } of opções) {
    const b = document.createElement('button');
    b.className = 'chip' + (value === ativo ? ' on' : '');
    b.dataset.value = value;
    b.innerHTML = `${label}${n != null ? `<span class="n">${n}</span>` : ''}`;
    b.onclick = () => {
      host.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
      onPick(value);
    };
    host.appendChild(b);
  }
}

function tally(list, key) {
  const m = new Map();
  for (const x of list) m.set(x[key], (m.get(x[key]) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

async function boot() {
  const [index, creatures, items, icons, spawns, loot, moves, balls, formulas] = await Promise.all([
    fetch(`${PACK}/outfits-index.json`).then((r) => r.json()),
    fetch(`${DATA}/creatures.json`).then((r) => r.json()),
    fetch(`${DATA}/items.json`).then((r) => r.json()),
    fetch(`${DATA}/items-icons.json`).then((r) => r.json()),
    fetch(`${DATA}/index/spawns-index.json`).then((r) => r.json()),
    fetch(`${DATA}/index/loot-index.json`).then((r) => r.json()),
    fetch(`${DATA}/index/moves-index.json`).then((r) => r.json()),
    fetch(`${DATA}/effects/catch/index.json`).then((r) => r.json()),
    fetch(`${DATA}/index/formulas.json`).then((r) => r.json()),
  ]);

  state.entries = Object.values(index.outfits).sort((a, b) => a.id - b.id);
  state.items = items.items;
  state.icons = icons;
  state.spawns = spawns;
  state.loot = loot;
  state.moves = moves;
  state.balls = balls;
  state.formulas = formulas;
  for (const c of creatures.creatures) {
    state.creaturesByLooktype.set(c.looktype, c);
    state.creaturesByPokeId.set(c.pokeId, c);
  }

  const hunts = Object.values(spawns.porHunt);
  chips(
    $('#areas'),
    Object.keys(MAPA_DA_AREA).map((a) => ({ value: a, label: a, n: hunts.filter((h) => h.area === a).length })),
    'kanto',
    (v) => { state.area = v; renderMapaMundi(); },
  );

  const comLocal = [...state.creaturesByPokeId.keys()].filter((id) => spawns.porPokemon[id]).length;
  chips(
    $('#spawnfilters'),
    [
      { value: 'all', label: 'todos', n: state.creaturesByPokeId.size },
      { value: 'com', label: 'com hunt', n: comLocal },
      { value: 'sem', label: 'sem hunt', n: state.creaturesByPokeId.size - comLocal },
    ],
    'all',
    (v) => { state.sfilter = v; renderSpawns(); },
  );

  const itensLoot = Object.values(loot.porItem);
  chips(
    $('#lootcats'),
    [
      { value: 'all', label: 'todos', n: itensLoot.length },
      ...tally(itensLoot.filter((i) => i.categoria), 'categoria').map(([k, n]) => ({ value: k, label: k, n })),
    ],
    'all',
    (v) => { state.lcat = v; renderLoot(); },
  );

  const ataques = Object.values(moves.porAtaque);
  chips(
    $('#fxmodes'),
    [
      { value: 'ataques', label: 'ataques', n: ataques.length },
      { value: 'folhas', label: 'folhas fx', n: Object.keys(moves.efeitos).length },
      { value: 'bolas', label: 'pokébolas', n: Object.keys(balls).length },
    ],
    'ataques',
    (v) => {
      state.fxmode = v;
      $('#fxtypes').classList.toggle('hidden', v !== 'ataques');
      renderEfeitos();
    },
  );

  chips(
    $('#fxtypes'),
    [{ value: 'all', label: 'todos os tipos' }, ...tally(ataques, 'tipo').map(([k, n]) => ({ value: k, label: k.toLowerCase(), n }))],
    'all',
    (v) => { state.fxtype = v; renderEfeitos(); },
  );

  chips(
    $('#fmodes'),
    [
      { value: 'xp', label: 'curva de XP' },
      { value: 'tipos', label: 'tabela de tipos' },
      { value: 'qualidade', label: 'stats, IV e qualidade' },
      { value: 'captura', label: 'captura e pokébolas' },
      { value: 'zerar', label: 'quanto tempo para zerar' },
    ],
    'xp',
    (v) => { state.fmode = v; renderFormulas(); },
  );

  chips(
    $('#kinds'),
    [{ value: 'all', label: 'todos', n: state.entries.length }, ...tally(state.entries, 'kind').map(([k, n]) => ({ value: k, label: k, n }))],
    'all',
    (v) => { state.kind = v; renderOutfits(); },
  );

  chips(
    $('#cats'),
    [{ value: 'all', label: 'todos', n: state.items.length }, ...tally(state.items, 'category').map(([k, n]) => ({ value: k, label: k, n }))],
    'all',
    (v) => { state.icat = v; renderItems(); },
  );

  renderOutfits();
  renderItems();
  requestAnimationFrame(tick);
  aplicarHash();
}

// eventos
$('#q').oninput = (e) => { state.q = e.target.value; renderOutfits(); };
$('#qi').oninput = (e) => { state.iq = e.target.value; renderItems(); };
$('#zoom').oninput = (e) => { state.zoom = +e.target.value; $('#zoomv').textContent = `${state.zoom}×`; };
$('#izoom').oninput = (e) => { state.izoom = +e.target.value; $('#izoomv').textContent = `${state.izoom}×`; renderItems(); };
$('#anim').onchange = (e) => { state.animate = e.target.checked; for (const r of live) r.dirty = true; };
$('#qm').oninput = (e) => { state.qm = e.target.value; renderMapaMundi(); };
$('#mlabels').onchange = (e) => { state.mlabels = e.target.checked; renderMapaMundi(); };
$('#qs').oninput = (e) => { state.qs = e.target.value; renderSpawns(); };
$('#ql').oninput = (e) => { state.ql = e.target.value; renderLoot(); };
$('#lootsort').onchange = (e) => { state.lsort = e.target.value; renderLoot(); };
$('#qe').oninput = (e) => { state.qe = e.target.value; renderEfeitos(); };
window.onresize = () => { if (!$('#mapa').classList.contains('hidden')) renderMapaMundi(); };
$('#drawer-close').onclick = closeDrawer;
$('#scrim').onclick = closeDrawer;
// Chaves, não `&&`: num handler DOM0, devolver `false` equivale a preventDefault().
// A forma curta `e.key === 'Escape' && closeDrawer()` devolvia `false` em toda tecla
// que não fosse Esc — e aí nada era digitável na página, nem o Ctrl+F abria.
document.onkeydown = (e) => { if (e.key === 'Escape') closeDrawer(); };

$('#dirs').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $('#dirs').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
  b.classList.add('on');
  state.dir = +b.dataset.dir;
};

$('#export-zip').onclick = () => {
  const list = state.filtered ?? [];
  const nome = state.kind === 'all' ? 'looktypes' : `looktypes-${state.kind}`;
  if (list.length > 60 && !confirm(`Exportar ${list.length} outfits (~${list.length * 12} PNGs)? Pode demorar e consumir bastante memória.`)) return;
  exportZip(list, nome);
};

const ABAS = {
  outfits: { secao: '#grid', barra: '#tb-outfits', render: renderOutfits },
  items: { secao: '#igrid', barra: '#tb-items', render: renderItems },
  mapa: { secao: '#mapa', barra: '#tb-mapa', render: renderMapaMundi },
  spawns: { secao: '#sgrid', barra: '#tb-spawns', render: renderSpawns },
  loot: { secao: '#lgrid', barra: '#tb-loot', render: renderLoot },
  efeitos: { secao: '#egrid', barra: '#tb-efeitos', render: renderEfeitos },
  formulas: { secao: '#fgrid', barra: '#tb-formulas', render: renderFormulas },
};

function selecionarAba(tab) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
  for (const [nome, cfg] of Object.entries(ABAS)) {
    $(cfg.secao).classList.toggle('hidden', nome !== tab);
    $(cfg.barra).classList.toggle('hidden', nome !== tab);
  }
  history.replaceState(null, '', tab === 'outfits' ? location.pathname : `#${tab}`);
  ABAS[tab].render();
}

document.querySelector('.tabs').onclick = (e) => {
  const b = e.target.closest('.tab');
  if (b) selecionarAba(b.dataset.tab);
};

boot().catch((err) => {
  document.body.innerHTML = `<div class="empty">Falha ao carregar os dados.<br><code>${err.message}</code><br><br>Rodou <code>npm run fetch</code>?</div>`;
});
