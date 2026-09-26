/**
 * Catálogo visual dos efeitos de golpe do PokeIdle.
 *
 * Abas: efeitos do jogo, biblioteca Trampar (~1400 PNGs) e atribuição TM Elemental.
 */
const $ = (s) => document.querySelector(s);

const state = {
  dados: null,
  trampar: null,
  tramparCarregando: null,
  tab: 'jogo',
  cat: 'all',
  q: '',
  qTrampar: '',
  qTm: '',
  anim: true,
  pagTrampar: 0,
  tmLocal: {},
  timingPreview: {},
  porPaginaTrampar: 72,
};

const clampMs = (ms) => Math.max(10, Math.min(500, Math.round(Number(ms) || 60)));

function chaveTiming(fx, tab) {
  return `${tab}:${fx.id}`;
}

function msDoPreview(fx, tab) {
  return state.timingPreview[chaveTiming(fx, tab)] ?? fx.frameMs ?? 60;
}

function fxComTiming(fx, tab) {
  const frameMs = clampMs(msDoPreview(fx, tab));
  return { ...fx, frameMs, duracaoMs: (fx.frames ?? 0) * frameMs };
}

function htmlTiming(ms, totalS) {
  return `
    <div class="mv-timing">
      <span class="mv-timing-label">ms/q</span>
      <button type="button" class="mv-timing-btn" data-d="-10" title="mais rápido">−</button>
      <input type="number" class="mv-timing-ms" min="10" max="500" step="5" value="${ms}">
      <button type="button" class="mv-timing-btn" data-d="10" title="mais lento">+</button>
      <span class="mv-timing-total">${totalS.toFixed(2)} s</span>
    </div>`;
}

function ligarTiming(corpo, rec, fxBase, tab, onMs) {
  const metaEl = corpo.querySelector('.mv-meta-linha');
  const aplicarMs = (ms) => {
    const frameMs = clampMs(ms);
    state.timingPreview[chaveTiming(fxBase, tab)] = frameMs;
    rec.fx = { ...rec.fx, frameMs, duracaoMs: (fxBase.frames ?? 0) * frameMs };
    rec.idx = -1;
    const inp = corpo.querySelector('.mv-timing-ms');
    const tot = corpo.querySelector('.mv-timing-total');
    if (inp) inp.value = frameMs;
    if (tot) tot.textContent = `${rec.fx.duracaoMs / 1000} s`;
    if (metaEl) {
      metaEl.textContent = `${fxBase.frameW}×${fxBase.frameH} · ${fxBase.frames} quadros · ${frameMs} ms/q`;
    }
    onMs?.(frameMs);
  };

  corpo.querySelectorAll('.mv-timing-btn').forEach((btn) => {
    btn.onclick = () => aplicarMs(Number(corpo.querySelector('.mv-timing-ms').value) + Number(btn.dataset.d));
  });
  const inp = corpo.querySelector('.mv-timing-ms');
  inp.onchange = () => aplicarMs(inp.value);
  inp.onkeydown = (ev) => { if (ev.key === 'Enter') aplicarMs(inp.value); };
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

const cacheImg = new Map();
function carregarImg(src) {
  if (cacheImg.has(src)) return cacheImg.get(src);
  const p = new Promise((ok, err) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => err(new Error(src));
    img.src = src;
  });
  cacheImg.set(src, p);
  return p;
}

function urlFx(fx, tab) {
  if (tab === 'trampar' || fx.categoria === 'trampar') return `/trampar/${fx.file}`;
  return `/assets/effects/moves/${fx.file}`;
}

const live = new Set();

function desenharFrame(rec, idx) {
  const { img, fx, canvas, ctx } = rec;
  const { frameW, frameH } = fx;
  const cols = fx.cols ?? 1;
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  if (canvas.width !== frameW || canvas.height !== frameH) {
    canvas.width = frameW;
    canvas.height = frameH;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, frameW, frameH);
  ctx.drawImage(img, col * frameW, row * frameH, frameW, frameH, 0, 0, frameW, frameH);

  const escala = Math.min(1.6, 140 / Math.max(frameW, frameH));
  canvas.style.width = `${Math.round(frameW * escala)}px`;
  canvas.style.height = `${Math.round(frameH * escala)}px`;
}

function tick(now) {
  for (const rec of live) {
    if (!rec.img || !state.anim) continue;
    const idx = Math.floor(now / rec.fx.frameMs) % rec.fx.frames;
    if (rec.idx === idx) continue;
    rec.idx = idx;
    desenharFrame(rec, idx);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

const observer = new IntersectionObserver((rows) => {
  for (const row of rows) {
    const rec = row.target._rec;
    if (!rec) continue;
    if (row.isIntersecting) live.add(rec);
    else live.delete(rec);
  }
}, { rootMargin: '120px' });

async function montarCard(fxBase, tab = 'jogo') {
  const fx = fxComTiming(fxBase, tab);
  const card = document.createElement('article');
  card.className = 'mv-card';
  card.dataset.cat = fx.categoria;

  const stage = document.createElement('div');
  stage.className = 'mv-stage';
  const canvas = document.createElement('canvas');
  stage.appendChild(canvas);

  const corpo = document.createElement('div');
  corpo.className = 'mv-corpo';
  corpo.innerHTML = `
    <div class="mv-nome">${esc(fxBase.id)}</div>
    <span class="mv-tag ${esc(fxBase.categoria)}">${esc(fxBase.categoria)}</span>
    <div class="mv-meta">
      <code>${esc(fxBase.file)}</code><br>
      <span class="mv-meta-linha">${fxBase.frameW}×${fxBase.frameH} · ${fxBase.frames} quadros · ${fx.frameMs} ms/q${(fxBase.cols ?? 1) > 1 ? ` · grade ${fxBase.cols}×${fxBase.rows ?? '?'}` : ''}</span>
    </div>
    ${htmlTiming(fx.frameMs, fx.duracaoMs / 1000)}
    ${fxBase.ataques?.length
      ? `<div class="mv-ataques" title="${esc(fxBase.ataques.join(', '))}"><b>${fxBase.ataques.length}</b> golpes usam este tipo</div>`
      : ''}`;

  card.append(stage, corpo);

  const rec = {
    fx,
    canvas,
    ctx: canvas.getContext('2d'),
    img: null,
    idx: -1,
  };
  card._rec = rec;
  observer.observe(card);
  ligarTiming(corpo, rec, fxBase, tab);

  try {
    rec.img = await carregarImg(urlFx(fxBase, tab));
    desenharFrame(rec, 0);
  } catch {
    stage.innerHTML = `<span class="mv-erro">PNG ausente<br><code>${esc(fxBase.file)}</code></span>`;
  }

  return card;
}

function filtradosJogo() {
  const q = norm(state.q);
  return (state.dados?.efeitos ?? []).filter((e) => {
    if (state.cat !== 'all' && e.categoria !== state.cat) return false;
    if (!q) return true;
    const blob = norm([e.id, e.file, ...(e.ataques ?? [])].join(' '));
    return blob.includes(q);
  });
}

function filtradosTrampar() {
  const q = norm(state.qTrampar);
  return (state.trampar?.efeitos ?? []).filter((e) => {
    if (!q) return true;
    return norm([e.id, e.file].join(' ')).includes(q);
  });
}

function tramparPorId() {
  return Object.fromEntries((state.trampar?.efeitos ?? []).map((e) => [e.id, e]));
}

function jogoTmPorId() {
  return Object.fromEntries((state.dados?.tmElemental?.efeitosJogoTm ?? state.dados?.efeitos ?? [])
    .filter((e) => e.categoria === 'golpe' || e.categoria === 'fx')
    .map((e) => [e.id, { ...e, source: 'jogo' }]));
}

function parseChave(val) {
  const s = String(val ?? '');
  const i = s.indexOf(':');
  if (i < 0) return { source: 'trampar', id: s.trim() };
  return { source: s.slice(0, i), id: s.slice(i + 1).trim() };
}

function chaveEfeito(source, id) {
  if (!id) return '';
  return `${source === 'jogo' ? 'jogo' : 'trampar'}:${id}`;
}

function normalizarSlot(raw) {
  if (!raw || typeof raw !== 'object') {
    const s = String(raw ?? '').trim();
    if (s.includes(':')) {
      const p = parseChave(s);
      return { source: p.source, id: p.id, frameMs: 60 };
    }
    return { source: 'trampar', id: s, frameMs: 60 };
  }
  let source = raw.source === 'jogo' ? 'jogo' : 'trampar';
  let id = raw.id ?? raw.chave ?? '';
  if (id != null && typeof id === 'object') id = id.id ?? id.chave ?? '';
  id = String(id ?? '').trim();
  if (id.includes(':') && !raw.source) {
    const p = parseChave(id);
    source = p.source;
    id = p.id;
  }
  if (id === '[object Object]') id = '';
  return {
    source,
    id,
    frameMs: clampMs(raw.frameMs ?? 60),
  };
}

function payloadTmSave() {
  const atribuicoes = {};
  for (const [tipo, slot] of Object.entries(state.tmLocal ?? {})) {
    const sel = document.querySelector(`.mv-tm-select[data-tipo="${tipo}"]`);
    if (sel?.value) {
      const p = parseChave(sel.value);
      atribuicoes[tipo] = {
        source: p.source,
        id: p.id,
        frameMs: clampMs(tmSlot(tipo).frameMs ?? 60),
      };
      continue;
    }
    const s = normalizarSlot(slot);
    if (!s.id) continue;
    atribuicoes[tipo] = s;
  }
  return atribuicoes;
}

function chaveDeSlot(slot) {
  const s = normalizarSlot(slot);
  return chaveEfeito(s.source, s.id);
}

function efeitoPorChave(chave) {
  const { source, id } = parseChave(chave);
  if (!id) return null;
  if (source === 'jogo') return jogoTmPorId()[id] ?? null;
  return tramparPorId()[id] ?? null;
}

function opcoesSelect(filtro = '') {
  const q = norm(filtro);
  const trampar = state.trampar?.efeitos ?? [];
  const jogo = (state.dados?.tmElemental?.efeitosJogoTm ?? state.dados?.efeitos ?? [])
    .filter((e) => e.categoria === 'golpe' || e.categoria === 'fx');
  let html = '<option value="">— nenhum —</option>';

  const addGroup = (label, lista, source) => {
    const opts = [];
    for (const e of lista) {
      const val = chaveEfeito(source, e.id);
      const text = `${e.id} · ${e.file} (${e.frames}q)`;
      if (q && !norm(text).includes(q)) continue;
      opts.push(`<option value="${esc(val)}">${esc(text)}</option>`);
    }
    if (opts.length) html += `<optgroup label="${esc(label)}">${opts.join('')}</optgroup>`;
  };

  addGroup('Biblioteca Trampar', trampar, 'trampar');
  addGroup('Golpes nomeados', jogo.filter((e) => e.categoria === 'golpe'), 'jogo');
  addGroup('FX genéricos', jogo.filter((e) => e.categoria === 'fx'), 'jogo');
  return html;
}

function tmSlot(tipo) {
  if (!state.tmLocal[tipo] || typeof state.tmLocal[tipo] === 'string') {
    state.tmLocal[tipo] = normalizarSlot({ source: 'trampar', id: state.tmLocal[tipo] || '', frameMs: 60 });
  } else {
    state.tmLocal[tipo] = normalizarSlot(state.tmLocal[tipo]);
  }
  return state.tmLocal[tipo];
}

async function montarCardTm(tipo) {
  const card = document.createElement('article');
  card.className = 'mv-card tm';
  card.dataset.tipo = tipo;

  const stage = document.createElement('div');
  stage.className = 'mv-stage';
  const canvas = document.createElement('canvas');
  stage.appendChild(canvas);

  const slot = tmSlot(tipo);
  const corpo = document.createElement('div');
  corpo.className = 'mv-corpo';
  corpo.innerHTML = `
    <div class="mv-nome">TM ${esc(tipo)}</div>
    <div class="mv-tm-sub">2800 power · 60s CD · área 3×3</div>
    <select class="mv-tm-select" data-tipo="${esc(tipo)}">${opcoesSelect(state.qTm)}</select>
    ${htmlTiming(slot.frameMs ?? 60, 0)}
    <div class="mv-meta tm-meta"></div>`;

  card.append(stage, corpo);

  const sel = corpo.querySelector('.mv-tm-select');
  const meta = corpo.querySelector('.tm-meta');
  const rec = {
    fx: null,
    canvas,
    ctx: canvas.getContext('2d'),
    img: null,
    idx: -1,
    stage,
    meta,
  };
  card._rec = rec;
  observer.observe(card);

  const atualizarMeta = (fx, frameMs) => {
    meta.textContent = fx
      ? `${fx.frameW}×${fx.frameH} · ${fx.frames} quadros · ${frameMs} ms/q · ${fx.file}`
      : 'sem efeito — usa o tipo normal no combate';
    const tot = corpo.querySelector('.mv-timing-total');
    if (tot && fx) tot.textContent = `${((fx.frames ?? 0) * frameMs / 1000).toFixed(2)} s`;
  };

  const aplicar = async (chave, frameMsOverride) => {
    const s = tmSlot(tipo);
    const { source, id } = parseChave(chave);
    s.source = source;
    s.id = id;
    const fxBase = efeitoPorChave(chave);
    const frameMs = clampMs(frameMsOverride ?? s.frameMs ?? 60);
    s.frameMs = frameMs;

    if (!fxBase) {
      rec.fx = null;
      rec.img = null;
      atualizarMeta(null, frameMs);
      stage.innerHTML = '';
      stage.appendChild(canvas);
      rec.ctx.clearRect(0, 0, canvas.width, canvas.height);
      corpo.querySelector('.mv-timing-ms').value = frameMs;
      return;
    }

    rec.fx = { ...fxBase, frameMs, duracaoMs: (fxBase.frames ?? 0) * frameMs };
    rec.idx = -1;
    atualizarMeta(fxBase, frameMs);
    corpo.querySelector('.mv-timing-ms').value = frameMs;

    stage.innerHTML = '';
    stage.appendChild(canvas);
    const tab = source === 'jogo' ? 'jogo' : 'trampar';
    try {
      rec.img = await carregarImg(urlFx(fxBase, tab));
      desenharFrame(rec, 0);
    } catch {
      stage.innerHTML = `<span class="mv-erro">PNG ausente<br><code>${esc(fxBase.file)}</code></span>`;
    }
  };

  const aplicarMs = (ms) => {
    const inp = corpo.querySelector('.mv-timing-ms');
    const frameMs = clampMs(ms);
    inp.value = frameMs;
    void aplicar(chaveDeSlot(tmSlot(tipo)), frameMs);
  };
  corpo.querySelectorAll('.mv-timing-btn').forEach((btn) => {
    btn.onclick = () => aplicarMs(Number(corpo.querySelector('.mv-timing-ms').value) + Number(btn.dataset.d));
  });
  const inpMs = corpo.querySelector('.mv-timing-ms');
  inpMs.onchange = () => aplicarMs(inpMs.value);
  inpMs.onkeydown = (ev) => { if (ev.key === 'Enter') aplicarMs(inpMs.value); };

  const salvo = state.dados?.tmElemental?.salvos?.[tipo];
  const att = state.dados?.tmElemental?.atribuicoes?.[tipo];
  const inicial = chaveDeSlot(slot)
    || chaveEfeito(salvo?.source ?? att?.source ?? 'trampar', salvo?.id ?? att?.id ?? '');
  const msInicial = salvo?.frameMs ?? att?.frameMs ?? slot.frameMs ?? 60;
  sel.value = inicial;
  await aplicar(inicial, msInicial);

  sel.onchange = () => aplicar(sel.value, tmSlot(tipo).frameMs);
  return card;
}

async function renderJogo() {
  const lista = filtradosJogo();
  const grid = $('#grid');
  const vazio = $('#vazio');
  live.clear();
  observer.disconnect();
  grid.innerHTML = '';

  vazio.classList.toggle('hidden', lista.length > 0);
  grid.classList.toggle('hidden', !lista.length);

  for (const fx of lista) grid.appendChild(await montarCard(fx, 'jogo'));
}

async function garantirTrampar() {
  if (state.trampar?.efeitos?.length) return state.trampar;
  if (state.tramparCarregando) return state.tramparCarregando;

  state.tramparCarregando = (async () => {
    const embutido = state.dados?.trampar;
    if (embutido?.efeitos?.length) {
      state.trampar = embutido;
      return state.trampar;
    }
    const r = await fetch('/api/moves/trampar');
    state.trampar = await r.json();
    if (state.dados) state.dados.trampar = state.trampar;
    return state.trampar;
  })();

  try {
    return await state.tramparCarregando;
  } finally {
    state.tramparCarregando = null;
  }
}

async function renderTrampar() {
  const grid = $('#grid-trampar');
  const vazio = $('#vazio-trampar');
  grid.classList.remove('hidden');
  grid.innerHTML = '<div class="empty">carregando biblioteca Trampar…</div>';
  vazio.classList.add('hidden');

  let tr;
  try {
    tr = await garantirTrampar();
  } catch (err) {
    grid.innerHTML = '';
    vazio.classList.remove('hidden');
    vazio.textContent = `Erro ao carregar Trampar: ${err.message || err}`;
    return;
  }

  if (tr.ausente) {
    grid.innerHTML = '';
    vazio.classList.remove('hidden');
    vazio.textContent = `Pasta não encontrada: ${tr.pasta}`;
    return;
  }

  const lista = filtradosTrampar();
  const total = lista.length;
  const paginas = Math.max(1, Math.ceil(total / state.porPaginaTrampar));
  if (state.pagTrampar >= paginas) state.pagTrampar = paginas - 1;
  if (state.pagTrampar < 0) state.pagTrampar = 0;

  const ini = state.pagTrampar * state.porPaginaTrampar;
  const fatia = lista.slice(ini, ini + state.porPaginaTrampar);

  live.clear();
  observer.disconnect();
  grid.innerHTML = '';

  vazio.classList.toggle('hidden', total > 0);
  grid.classList.toggle('hidden', !total);

  for (const fx of fatia) grid.appendChild(await montarCard(fx, 'trampar'));

  const pag = $('#pag-trampar');
  pag.innerHTML = total
    ? `<button type="button" id="prev-tr" ${state.pagTrampar <= 0 ? 'disabled' : ''}>←</button>
       <span>${state.pagTrampar + 1} / ${paginas} · ${total} efeitos</span>
       <button type="button" id="next-tr" ${state.pagTrampar >= paginas - 1 ? 'disabled' : ''}>→</button>`
    : '';
  pag.querySelector('#prev-tr')?.addEventListener('click', () => {
    state.pagTrampar--;
    renderTrampar();
  });
  pag.querySelector('#next-tr')?.addEventListener('click', () => {
    state.pagTrampar++;
    renderTrampar();
  });
}

async function renderTm() {
  const grid = $('#grid-tm');
  live.clear();
  observer.disconnect();
  grid.innerHTML = '';

  for (const tipo of state.dados?.tiposElementais ?? []) {
    grid.appendChild(await montarCardTm(tipo));
  }
}

function atualizarSelectsTm() {
  for (const sel of document.querySelectorAll('.mv-tm-select')) {
    const val = sel.value;
    sel.innerHTML = opcoesSelect(state.qTm);
    if (val) sel.value = val;
  }
}

function mostrarTab(tab) {
  state.tab = tab;
  for (const btn of $('#tabs').children) btn.classList.toggle('on', btn.dataset.tab === tab);
  $('#toolbar-jogo').classList.toggle('hidden', tab !== 'jogo');
  $('#toolbar-trampar').classList.toggle('hidden', tab !== 'trampar');
  $('#toolbar-tm').classList.toggle('hidden', tab !== 'tm');
  $('#grid').classList.toggle('hidden', tab !== 'jogo');
  $('#grid-trampar').classList.toggle('hidden', tab !== 'trampar');
  $('#grid-tm').classList.toggle('hidden', tab !== 'tm');
  $('#vazio').classList.add('hidden');
  $('#vazio-trampar').classList.add('hidden');

  if (tab === 'jogo') renderJogo();
  else if (tab === 'trampar') void renderTrampar();
  else void renderTmComTrampar();
}

async function renderTmComTrampar() {
  await garantirTrampar().catch(() => null);
  await renderTm();
}

async function carregar() {
  const r = await fetch('/api/moves');
  state.dados = await r.json();
  state.trampar = state.dados.trampar?.efeitos?.length ? state.dados.trampar : null;
  const s = state.dados.resumo;
  const tr = state.dados.trampar;
  const tm = state.dados.tmElemental;
  state.tmLocal = Object.fromEntries(
    (state.dados.tiposElementais ?? []).map((t) => {
      const salvo = tm?.salvos?.[t];
      const att = tm?.atribuicoes?.[t];
      return [t, normalizarSlot({
        source: salvo?.source ?? att?.source ?? 'trampar',
        id: salvo?.id ?? att?.id ?? '',
        frameMs: salvo?.frameMs ?? att?.frameMs ?? 60,
      })];
    }),
  );

  $('#counts').innerHTML =
    `<b>${s.total}</b> jogo · <b>${tr?.total ?? '…'}</b> Trampar · ` +
    `<b>${Object.keys(tm?.atribuicoes ?? {}).length}</b>/18 TM · ` +
    `<b>${s.ataquesDistintos}</b> ataques`;

  if (tr?.ausente) {
    $('#status-tm').textContent = `Biblioteca ausente: ${tr.pasta}`;
    $('#status-tm').className = 'mv-status err';
  }

  mostrarTab(state.tab);
}

$('#tabs').onclick = (ev) => {
  const btn = ev.target.closest('[data-tab]');
  if (!btn) return;
  mostrarTab(btn.dataset.tab);
};

$('#categorias').onclick = (ev) => {
  const btn = ev.target.closest('[data-cat]');
  if (!btn) return;
  state.cat = btn.dataset.cat;
  for (const c of $('#categorias').children) c.classList.toggle('on', c === btn);
  renderJogo();
};

$('#q').oninput = (ev) => {
  state.q = ev.target.value.trim();
  renderJogo();
};

$('#q-trampar').oninput = (ev) => {
  state.qTrampar = ev.target.value.trim();
  state.pagTrampar = 0;
  renderTrampar();
};

$('#q-tm').oninput = (ev) => {
  state.qTm = ev.target.value.trim();
  atualizarSelectsTm();
};

$('#anim').onchange = $('#anim-trampar').onchange = (ev) => {
  state.anim = ev.target.checked;
  if (state.anim) {
    for (const rec of live) {
      if (rec.img) desenharFrame(rec, Math.floor(performance.now() / rec.fx.frameMs) % rec.fx.frames);
    }
  }
};

$('#salvar-tm').onclick = async () => {
  const status = $('#status-tm');
  status.textContent = 'salvando…';
  status.className = 'mv-status';
  try {
    if ((state.dados?.tmSaveApi ?? 0) < 2) {
      status.textContent = 'Nomeador desatualizado — rode: npm run nomeador:stop && npm run nomeador';
      status.className = 'mv-status err';
      return;
    }
    const atribuicoes = payloadTmSave();
    if (!Object.keys(atribuicoes).length) {
      status.textContent = 'escolha pelo menos um efeito antes de salvar';
      status.className = 'mv-status err';
      return;
    }
    const r = await fetch('/api/moves/tm-elemental', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ atribuicoes }),
    });
    const j = await r.json();
    if (j.erro) {
      status.textContent = j.erro;
      status.className = 'mv-status err';
      return;
    }
    status.textContent = j.msg || 'salvo';
    status.className = 'mv-status ok';
    await carregar();
  } catch (err) {
    status.textContent = String(err.message || err);
    status.className = 'mv-status err';
  }
};

carregar().catch((err) => {
  $('#counts').textContent = 'erro ao carregar';
  $('#vazio').classList.remove('hidden');
  $('#vazio').textContent = String(err.message || err);
});
