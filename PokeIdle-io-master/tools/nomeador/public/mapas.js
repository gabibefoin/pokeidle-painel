/** Editor / auditoria de mapas de batalha por tipo primário. */
const $ = (s) => document.querySelector(s);

const FAIXAS = [
  { id: '3', rotulo: '3ª Hoenn', min: 252, max: 386 },
  { id: '4', rotulo: '4ª Sinnoh', min: 387, max: 493 },
  { id: '5', rotulo: '5ª Unova', min: 494, max: 649 },
  { id: '6', rotulo: '6ª Kalos', min: 650, max: 721 },
  { id: '7', rotulo: '7ª–9ª', min: 722, max: 1025 },
];

const ORDEM_TIPOS = [
  'NORMAL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'ICE', 'FIGHTING', 'POISON',
  'GROUND', 'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY',
];

const CORES_TIPO = {
  NORMAL: '#a8a878', FIRE: '#f08030', WATER: '#6890f0', GRASS: '#78c850',
  ELECTRIC: '#f8d030', ICE: '#98d8d8', FIGHTING: '#c03028', POISON: '#a040a0',
  GROUND: '#e0c068', FLYING: '#a890f0', PSYCHIC: '#f85888', BUG: '#a8b820',
  ROCK: '#b8a038', GHOST: '#705898', DRAGON: '#7038f8', DARK: '#705848',
  STEEL: '#b8b8d0', FAIRY: '#ee99ac',
};

const state = {
  hunts: [],
  huntsPorSlug: new Map(),
  especies: [],
  especiesPorDex: new Map(),
  porDex: {},
  pools: {},
  porFonte: new Map(),
  geracao: '3',
  tipo: null,
  sel: null,
};

let renderMapaFn = null;
const tileCache = new Map();
const thumbQueue = [];
let thumbBusy = 0;
const THUMB_MAX = 2;
let previewToken = 0;

const thumbObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      enfileirarThumb(e.target.dataset.slug, e.target);
      thumbObserver.unobserve(e.target);
    }
  },
  { rootMargin: '80px' },
);

async function carregarMapview() {
  if (renderMapaFn) return renderMapaFn;
  const mod = await import('/mapview.mjs');
  renderMapaFn = mod.renderMapa;
  return renderMapaFn;
}

function copiarCanvas(src, className = 'mp-thumb-canvas') {
  const copy = document.createElement('canvas');
  copy.width = src.width;
  copy.height = src.height;
  copy.className = className;
  copy.getContext('2d').drawImage(src, 0, 0);
  return copy;
}

async function renderTile(slug, escala = 0.18) {
  if (tileCache.has(slug)) return tileCache.get(slug);
  const renderMapa = await carregarMapview();
  const r = await renderMapa(slug, { escala });
  tileCache.set(slug, r.canvas);
  return r.canvas;
}

function montarThumbHost(slug) {
  const host = document.createElement('div');
  host.className = 'mp-thumb-host mp-thumb-loading';
  host.dataset.slug = slug;
  host.innerHTML = '<span class="mp-thumb-msg">…</span>';
  thumbObserver.observe(host);
  return host;
}

function enfileirarThumb(slug, host) {
  thumbQueue.push({ slug, host });
  processarThumbQueue();
}

async function processarThumbQueue() {
  if (thumbBusy >= THUMB_MAX || !thumbQueue.length) return;
  const job = thumbQueue.shift();
  thumbBusy++;
  try {
    const canvas = await renderTile(job.slug, 0.18);
    if (!job.host.isConnected) return;
    const img = copiarCanvas(canvas);
    job.host.replaceChildren(img);
    job.host.classList.remove('mp-thumb-loading');
  } catch (e) {
    if (job.host.isConnected) {
      job.host.classList.add('mp-thumb-erro');
      job.host.innerHTML = `<span class="mp-thumb-msg">${e.message || 'erro'}</span>`;
    }
  } finally {
    thumbBusy--;
    processarThumbQueue();
  }
}

async function mostrarPreviewGrande(h) {
  if (!h) {
    $('#preview-grande').hidden = true;
    return;
  }
  const token = ++previewToken;
  $('#preview-grande').hidden = false;
  $('#preview-nome').textContent = h.nome || h.slug;
  $('#preview-slug').textContent = `${h.slug} · ${h.tipo || '?'} · ${h.area}`;
  $('#preview-status').textContent = 'carregando tiles…';

  let canvas = $('#preview-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'preview-canvas';
    $('#preview-grande').prepend(canvas);
  }
  canvas.className = 'mp-thumb-loading';

  try {
    const src = await renderTile(h.slug, 0.35);
    if (token !== previewToken) return;
    const full = copiarCanvas(src);
    full.id = 'preview-canvas';
    canvas.replaceWith(full);
    const assign = state.porFonte.get(h.slug) ?? [];
    $('#preview-status').textContent = assign.length
      ? `${assign.length} pokémon neste mapa`
      : 'nenhum pokémon sorteado aqui';
  } catch (e) {
    if (token !== previewToken) return;
    $('#preview-status').textContent = e.message || 'erro ao renderizar';
  }
}

function montarPorFonte() {
  state.porFonte = new Map();
  for (const [dexStr, slug] of Object.entries(state.porDex)) {
    const dex = Number(dexStr);
    const esp = state.especiesPorDex.get(dex);
    if (!esp) continue;
    const lista = state.porFonte.get(slug) ?? [];
    lista.push(esp);
    state.porFonte.set(slug, lista);
  }
  for (const lista of state.porFonte.values()) {
    lista.sort((a, b) => a.dex - b.dex || a.nome.localeCompare(b.nome));
  }
}

async function carregar() {
  const data = await fetch('/api/mapas').then((r) => r.json());
  state.hunts = data.hunts ?? [];
  state.huntsPorSlug = new Map(state.hunts.map((h) => [h.slug, h]));
  state.especies = data.especies ?? [];
  state.especiesPorDex = new Map(state.especies.map((e) => [e.dex, e]));
  state.porDex = { ...(data.porDex ?? {}) };
  state.pools = data.pools ?? {};
  montarPorFonte();
  montarGeracoes();
  montarTipos();
  renderLista();
  renderMapas();
  renderStats();
}

function montarGeracoes() {
  const pai = $('#geracoes');
  pai.innerHTML = '';
  for (const f of FAIXAS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${f.id === state.geracao ? ' on' : ''}`;
    b.textContent = f.rotulo;
    b.onclick = () => {
      state.geracao = f.id;
      montarGeracoes();
      renderLista();
      renderStats();
      renderMapas();
    };
    pai.append(b);
  }
  $('#q').oninput = () => renderLista();
}

function montarTipos() {
  const pai = $('#tipos');
  pai.innerHTML = '';
  const tipos = ORDEM_TIPOS.filter((t) => (state.pools[t]?.length ?? 0) > 0);
  for (const t of tipos) {
    const n = state.pools[t].length;
    const assign = state.especies.filter((e) => e.type1 === t && mapaDeDex(e.dex)).length;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip mp-tipo${state.tipo === t ? ' on' : ''}`;
    b.style.setProperty('--tipo-cor', CORES_TIPO[t] ?? '#888');
    b.innerHTML = `${t}<span class="n">${n} mapas · ${assign} sorteados</span>`;
    b.onclick = () => {
      state.tipo = state.tipo === t ? null : t;
      montarTipos();
      renderLista();
      renderMapas();
      if (state.tipo) {
        $('#hint').textContent = `Pool ${state.tipo} — ${n} mapas de batalha (Kanto/Johto/Outland).`;
      } else {
        $('#hint').textContent = 'Clique num tipo primário para ver a pool de mapas sorteados.';
      }
    };
    pai.append(b);
  }
  $('#q-hunt').oninput = () => renderMapas();
  $('#btn-padrao').onclick = () => {
    if (!state.sel) return;
    delete state.porDex[String(state.sel.dex)];
    montarPorFonte();
    montarTipos();
    renderLista();
    renderMapas();
    renderStats();
    $('#save-msg').textContent = `${state.sel.nome} → padrão (${state.sel.fontePadrao}) (não salvo)`;
  };
}

function faixaAtual() {
  return FAIXAS.find((f) => f.id === state.geracao);
}

function mapaDeDex(dex) {
  return state.porDex[String(dex)] ?? null;
}

function especiesVisiveis() {
  const faixa = faixaAtual();
  const q = ($('#q').value || '').toLowerCase();
  return state.especies.filter((e) => {
    if (e.dex < faixa.min || e.dex > faixa.max) return false;
    if (state.tipo && e.type1 !== state.tipo) return false;
    if (!q) return true;
    return e.nome.toLowerCase().includes(q) || String(e.dex).includes(q);
  });
}

function huntsVisiveis() {
  if (!state.tipo) return [];
  const pool = new Set(state.pools[state.tipo] ?? []);
  const q = ($('#q-hunt').value || '').toLowerCase();
  return state.hunts.filter((h) => {
    if (!pool.has(h.slug)) return false;
    if (!q) return true;
    return h.slug.includes(q) || (h.nome || '').toLowerCase().includes(q);
  });
}

function renderStats() {
  const faixa = faixaAtual();
  const vis = state.especies.filter((e) => {
    if (e.dex < faixa.min || e.dex > faixa.max) return false;
    if (state.tipo && e.type1 !== state.tipo) return false;
    return true;
  });
  const com = vis.filter((e) => mapaDeDex(e.dex)).length;
  const rotulo = state.tipo ? `${state.tipo} · ${faixa.rotulo}` : faixa.rotulo;
  $('#stats').textContent = `${com}/${vis.length} sorteados · ${rotulo}`;
}

function rotuloFonte(e) {
  return mapaDeDex(e.dex) || (e.fontePadrao ? `~${e.fontePadrao}` : '—');
}

function renderLista() {
  const host = $('#lista');
  host.innerHTML = '';
  if (!state.tipo) {
    host.innerHTML = '<p class="mp-lista-vazia">Selecione um tipo acima para filtrar a lista.</p>';
    return;
  }
  for (const e of especiesVisiveis()) {
    const fonte = mapaDeDex(e.dex);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `mp-item${state.sel?.dex === e.dex ? ' on' : ''}${fonte ? '' : ' sem-mapa'}`;
    btn.innerHTML = `
      <span class="mp-item-nome">#${String(e.dex).padStart(3, '0')} ${e.nome}</span>
      <span class="mp-item-map">${rotuloFonte(e)}</span>`;
    btn.onclick = () => {
      state.sel = e;
      renderLista();
      renderMapas();
      const atual = fonte || e.fontePadrao;
      $('#hint').textContent = `${e.nome} (${e.type1}) → ${atual ?? 'padrão'}. Clique num mapa para trocar.`;
      $('#btn-padrao').hidden = false;
      const h = state.huntsPorSlug.get(atual);
      if (h) mostrarPreviewGrande(h);
    };
    host.appendChild(btn);
  }
}

function renderMapas() {
  const grid = $('#grid-mapas');
  grid.innerHTML = '';
  const resumo = $('#pool-resumo');

  if (!state.tipo) {
    resumo.textContent = '';
    grid.innerHTML = '<p class="mp-grid-vazia">Escolha um tipo primário para ver os mapas da pool e quem foi sorteado em cada um.</p>';
    return;
  }

  const hunts = huntsVisiveis();
  const mapaSel = state.sel ? mapaDeDex(state.sel.dex) : null;
  const faixa = faixaAtual();
  const totalAssign = hunts.reduce((n, h) => n + (state.porFonte.get(h.slug)?.length ?? 0), 0);
  resumo.textContent = `${state.tipo}: ${hunts.length} mapas na pool · ${totalAssign} atribuições neste tipo (geração atual)`;

  for (const h of hunts) {
    const assign = state.porFonte.get(h.slug) ?? [];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `mp-card${mapaSel === h.slug ? ' on' : ''}`;

    const thumb = montarThumbHost(h.slug);

    const lbl = document.createElement('span');
    lbl.className = 'mp-card-nome';
    lbl.textContent = h.nome || h.slug;

    const sub = document.createElement('span');
    sub.className = 'mp-card-slug';
    sub.textContent = h.slug;

    const assignEl = document.createElement('span');
    assignEl.className = 'mp-card-assign';
    if (assign.length) {
      const vis = assign.filter((e) => e.dex >= faixa.min && e.dex <= faixa.max);
      assignEl.textContent = vis.slice(0, 6).map((e) => e.nome).join(', ');
      const rest = vis.length - 6;
      if (rest > 0) assignEl.textContent += ` +${rest}`;
    } else {
      assignEl.textContent = '— ninguém sorteado';
      assignEl.classList.add('vazio');
    }

    card.append(thumb, lbl, sub, assignEl);
    card.onmouseenter = () => mostrarPreviewGrande(h);
    card.onclick = () => {
      mostrarPreviewGrande(h);
      if (!state.sel) {
        $('#save-msg').textContent = 'selecione um pokémon à esquerda para reatribuir';
        return;
      }
      if (state.sel.type1 !== state.tipo) {
        $('#save-msg').textContent = `${state.sel.nome} é ${state.sel.type1}, não ${state.tipo}`;
        return;
      }
      state.porDex[String(state.sel.dex)] = h.slug;
      montarPorFonte();
      montarTipos();
      renderLista();
      renderMapas();
      renderStats();
      $('#save-msg').textContent = `${state.sel.nome} → ${h.slug} (não salvo)`;
    };
    grid.appendChild(card);
  }
}

async function salvar() {
  const r = await fetch('/api/mapas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ porDex: state.porDex }),
  }).then((x) => x.json());
  if (r.erro) {
    $('#save-msg').textContent = r.erro;
    return;
  }
  $('#save-msg').textContent = `salvo · ${r.atualizados ?? 0} mapas · ${r.marcadores ?? 0} marcadores atualizados`;
}

$('#btn-salvar').onclick = salvar;
carregar();
