/** Editor de spawns por região — clique no mapa para marcar pixel da hunt. */
const $ = (s) => document.querySelector(s);

const FAIXAS = [
  { id: '3', rotulo: '3ª Hoenn', min: 252, max: 386 },
  { id: '4', rotulo: '4ª Sinnoh', min: 387, max: 493 },
  { id: '5', rotulo: '5ª Unova', min: 494, max: 649 },
  { id: '6', rotulo: '6ª Kalos', min: 650, max: 721 },
  { id: '7', rotulo: '7ª Alola', min: 722, max: 809 },
  { id: '8', rotulo: '8ª Galar', min: 810, max: 905 },
  { id: '9', rotulo: '9ª Paldea', min: 906, max: 1025 },
];

const state = {
  dados: null,
  mapas: [],
  regiao: 'hoenn',
  geracao: '3',
  especies: [],
  pokedex: [],
  lendariosPorGeracao: {},
  sel: null,
  selMarc: null,
  zoom: 1,
  pan: { x: 40, y: 40 },
  panning: false,
  panStart: null,
};

async function carregar() {
  const [sp, esp, fontes, mapasResp, pdx] = await Promise.all([
    fetch('/api/spawns').then((r) => r.json()),
    fetch('/api/spawns/especies').then((r) => r.json()),
    fetch('/api/spawns/fontes').then((r) => r.json()),
    fetch('/api/spawns/mapas').then((r) => (r.ok ? r.json() : { mapas: [] })),
    fetch('/api/pokedex').then((r) => r.json()),
  ]);
  state.dados = sp;
  state.especies = esp.especies ?? esp.species ?? [];
  state.lendariosPorGeracao = esp.lendariosPorGeracao ?? {};
  state.pokedex = pdx.geracoes ?? [];
  state.mapas = mapasResp.mapas?.length
    ? mapasResp.mapas
    : [...new Set(Object.values(sp.regioes ?? {}).map((r) => r.img).filter(Boolean))];
  montarMapas();
  const sel = $('#fonte');
  for (const f of fontes.fontes ?? []) {
    const o = document.createElement('option');
    o.value = f.slug;
    o.textContent = `${f.slug} (${f.area})`;
    sel.append(o);
  }
  montarRegioes();
  montarGeracoes();
  trocarRegiao(state.regiao);
  renderContagens();
}

function montarMapas() {
  const sel = $('#mapa-select');
  sel.innerHTML = '';
  if (!state.mapas.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '— nenhum mapa em public/data/site/assets/maps/ —';
    sel.append(o);
    return;
  }
  for (const nome of state.mapas) {
    const o = document.createElement('option');
    o.value = nome;
    o.textContent = nome.replace(/\.png$/i, '');
    sel.append(o);
  }
}

function montarRegioes() {
  const pai = $('#regioes');
  pai.innerHTML = '';
  for (const [id, reg] of Object.entries(state.dados.regioes)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${id === state.regiao ? ' on' : ''}`;
    b.textContent = reg.rotulo;
    b.onclick = () => { state.regiao = id; montarRegioes(); trocarRegiao(id); };
    pai.append(b);
  }
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
      renderEspecies();
      renderContagens();
    };
    pai.append(b);
  }
}

function regAtual() {
  return state.dados.regioes[state.regiao];
}

function marcadorPorDex(dex) {
  return (regAtual().marcadores ?? []).find((m) => m.dex === dex) ?? null;
}

function removerMarcador(m) {
  const reg = regAtual();
  reg.marcadores = (reg.marcadores ?? []).filter((x) => x !== m);
  if (state.selMarc === m) state.selMarc = null;
  if (state.sel?.dex === m.dex) state.sel = null;
  atualizarUi();
  $('#save-msg').textContent = `removido · ${m.nome}`;
}

function imgAtual() {
  const img = $('#img');
  return {
    w: img.naturalWidth || img.width || 1,
    h: img.naturalHeight || img.height || 1,
  };
}

function trocarRegiao(id) {
  const reg = state.dados.regioes[id];
  const sel = $('#mapa-select');
  if (reg.img && [...sel.options].some((o) => o.value === reg.img)) {
    sel.value = reg.img;
  } else if (reg.img) {
    const o = document.createElement('option');
    o.value = reg.img;
    o.textContent = `${reg.img.replace(/\.png$/i, '')} (custom)`;
    sel.append(o);
    sel.value = reg.img;
  }
  $('#nivel').value = reg.nivelGate ?? 1000;
  carregarImagem(reg.img);
  atualizarUi();
}

function carregarImagem(nome) {
  const img = $('#img');
  img.onload = () => { state.zoom = 1; state.pan = { x: 40, y: 40 }; aplicarTransform(); desenharPins(); };
  img.onerror = () => { img.alt = `mapa ${nome} não encontrado — coloque em public/data/site/assets/maps/`; };
  img.src = `/jogo/site/assets/maps/${nome}?v=${Date.now()}`;
}

function faixaAtual() {
  return FAIXAS.find((f) => f.id === state.geracao);
}

function contagemTotalGeracao() {
  const g = state.pokedex.find((x) => x.id === state.geracao);
  if (g?.stats?.comNormal != null) return g.stats.comNormal;
  const faixa = faixaAtual();
  if (!faixa) return 0;
  return state.especies.filter((e) => e.dex >= faixa.min && e.dex <= faixa.max).length;
}

function contagemMarcadosGeracao() {
  const faixa = faixaAtual();
  if (!faixa) return 0;
  return (regAtual().marcadores ?? []).filter(
    (m) => m.dex >= faixa.min && m.dex <= faixa.max,
  ).length;
}

function contagemLendariosGeracao() {
  const hit = state.lendariosPorGeracao[state.geracao];
  if (hit && typeof hit === 'object') return hit;
  return { total: Number(hit) || 0, nomes: [] };
}

function renderContagens() {
  const totalEl = $('#sp-total');
  const marcEl = $('#sp-marcados');
  const lendEl = $('#sp-lendarios');
  if (!totalEl || !marcEl) return;
  totalEl.textContent = contagemTotalGeracao();
  marcEl.textContent = contagemMarcadosGeracao();
  if (lendEl) {
    const { total, nomes } = contagemLendariosGeracao();
    const lista = nomes?.length ? ` (${nomes.join(', ')})` : '';
    lendEl.textContent = `${total}${lista}`;
  }
}

function especiesVisiveis() {
  const faixa = faixaAtual();
  const q = ($('#q').value || '').toLowerCase();
  return state.especies.filter((e) => {
    if (faixa && (e.dex < faixa.min || e.dex > faixa.max)) return false;
    if (q && !e.nome.toLowerCase().includes(q) && !String(e.dex).includes(q)) return false;
    return true;
  });
}

function renderEspecies() {
  const pai = $('#especies');
  pai.innerHTML = '';
  const lista = especiesVisiveis();
  if (!lista.length) {
    pai.innerHTML = '<p class="sp-vazio">Nenhuma espécie nesta geração — confira o filtro ou recarregue a página.</p>';
    return;
  }
  for (const e of lista) {
    const marc = marcadorPorDex(e.dex);
    const d = document.createElement('div');
    const cls = [
      'sp-especie',
      state.sel?.dex === e.dex || state.selMarc?.dex === e.dex ? 'on' : '',
      marc ? 'ok' : '',
    ].filter(Boolean).join(' ');
    d.className = cls;
    const coords = marc ? `<span class="coords">${marc.pixel[0]},${marc.pixel[1]}</span>` : '';
    const btn = marc ? '<button type="button" title="remover">×</button>' : '';
    d.innerHTML = `<span class="dex">#${String(e.dex).padStart(3, '0')}</span><span class="nome">${e.nome}</span><span class="nv">Nv ${e.huntLevel ?? '?'}</span><span class="tipos">${e.type2 ? `${e.type1}/${e.type2}` : e.type1}</span>${coords}${btn}`;
    d.onclick = (ev) => {
      if (ev.target.tagName === 'BUTTON') return;
      state.sel = e;
      state.selMarc = marc;
      if (e.huntLevel) $('#nivel').value = e.huntLevel;
      renderEspecies();
      desenharPins();
    };
    const rm = d.querySelector('button');
    if (rm) {
      rm.onclick = (ev) => {
        ev.stopPropagation();
        removerMarcador(marc);
      };
    }
    pai.append(d);
  }
}

function atualizarUi() {
  desenharPins();
  renderEspecies();
  renderBalanceTipos();
  renderContagens();
}

function renderBalanceTipos() {
  let el = $('#sp-balance');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sp-balance';
    el.className = 'sp-balance';
    $('#especies').after(el);
  }
  const reg = regAtual();
  const porNivel = new Map();
  for (const m of reg.marcadores ?? []) {
    const bag = porNivel.get(m.nivel) ?? {};
    bag[m.tipo] = (bag[m.tipo] ?? 0) + 1;
    porNivel.set(m.nivel, bag);
  }
  if (!porNivel.size) {
    el.innerHTML = '<p class="sp-hint">Balanceamento por nível aparece aqui conforme você posiciona marcadores.</p>';
    return;
  }
  const linhas = [...porNivel.entries()].sort((a, b) => a[0] - b[0]).map(([nv, tipos]) => {
    const resumo = Object.entries(tipos).sort((a, b) => b[1] - a[1]).map(([t, q]) => `${t}:${q}`).join(' · ');
    return `<div class="sp-bal-linha"><b>Nv ${nv}</b> ${resumo}</div>`;
  });
  el.innerHTML = `<h3>Tipos por nível (mapa)</h3>${linhas.join('')}`;
}

function desenharPins() {
  const pins = $('#pins');
  pins.innerHTML = '';
  const reg = regAtual();
  for (const m of reg.marcadores ?? []) {
    const p = document.createElement('div');
    p.className = `sp-pin${state.selMarc === m ? ' sel' : ''}`;
    p.style.left = `${m.pixel[0]}px`;
    p.style.top = `${m.pixel[1]}px`;
    p.title = m.nome;
    p.onclick = (ev) => {
      ev.stopPropagation();
      state.selMarc = m;
      state.sel = state.especies.find((e) => e.dex === m.dex) ?? state.sel;
      atualizarUi();
    };
    pins.append(p);
  }
}

function aplicarTransform() {
  $('#mapa').style.transform = `translate(${state.pan.x}px,${state.pan.y}px) scale(${state.zoom})`;
}

/** Converte clique na tela para pixel [x,y] na imagem do mapa (independente de zoom/pan). */
function pixelDoClique(ev) {
  const rect = $('#mapa').getBoundingClientRect();
  const { w, h } = imgAtual();
  const x = ((ev.clientX - rect.left) / rect.width) * w;
  const y = ((ev.clientY - rect.top) / rect.height) * h;
  return [Math.max(0, Math.min(w, Math.round(x))), Math.max(0, Math.min(h, Math.round(y)))];
}

function limiarRemocaoPx() {
  const rect = $('#mapa').getBoundingClientRect();
  const { w } = imgAtual();
  const escala = rect.width / w;
  return Math.max(12, 28 / escala);
}

function slugDe(nome, reg) {
  return `${nome.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}_${reg}`;
}

function nivelDaEspecie(e) {
  return e.huntLevel ?? null;
}

function adicionarMarcador(pixel) {
  if (!state.sel) {
    $('#save-msg').textContent = 'escolha um pokémon na lista';
    return;
  }
  const reg = regAtual();
  const fonte = $('#fonte').value || null;
  const nivel = nivelDaEspecie(state.sel) ?? (+$('#nivel').value || reg.nivelGate);
  const existente = (reg.marcadores ?? []).find((m) => m.dex === state.sel.dex);
  const marc = existente ?? {
    slug: slugDe(state.sel.nome, state.regiao),
    nome: state.sel.nome,
    dex: state.sel.dex,
    pokeId: (state.regiao === 'hoenn' && state.sel.pokeIdOrre) ? state.sel.pokeIdOrre : state.sel.pokeId,
    pixel,
    tipo: state.sel.type1,
    nivel,
    fonte,
  };
  marc.pixel = pixel;
  marc.nivel = nivel;
  marc.fonte = fonte;
  if (!existente) {
    reg.marcadores = reg.marcadores ?? [];
    reg.marcadores.push(marc);
  }
  state.selMarc = marc;
  atualizarUi();
  $('#save-msg').textContent = `${marc.nome} → ${pixel.join(',')}`;
}

function removerPerto(pixel) {
  const reg = regAtual();
  const lista = reg.marcadores ?? [];
  if (!lista.length) {
    $('#save-msg').textContent = 'nenhum marcador nesta região';
    return;
  }
  const limiar = limiarRemocaoPx();
  let melhor = null;
  let dist = Infinity;
  for (const m of lista) {
    const d = Math.hypot(m.pixel[0] - pixel[0], m.pixel[1] - pixel[1]);
    if (d < dist) { dist = d; melhor = m; }
  }
  if (melhor && dist <= limiar) {
    removerMarcador(melhor);
  } else {
    $('#save-msg').textContent = 'nenhum marcador perto — aproxime o clique';
  }
}

async function salvar() {
  const reg = regAtual();
  reg.img = $('#mapa-select').value.trim() || reg.img;
  reg.nivelGate = +$('#nivel').value || reg.nivelGate;
  const r = await fetch('/api/spawns', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ regiao: state.regiao, regiaoData: reg }),
  }).then((x) => x.json());
  if (r.erro) {
    $('#save-msg').textContent = r.erro;
    return;
  }
  $('#save-msg').textContent = `salvo · ${r.marcadores} marcadores`;
}

function iniciarPan(ev) {
  state.panning = true;
  state.panStart = { x: ev.clientX - state.pan.x, y: ev.clientY - state.pan.y };
  $('#wrap').classList.add('panning');
}

function onMapaMouseDown(ev) {
  if (ev.button !== 0) return;
  if (ev.shiftKey) {
    ev.preventDefault();
    iniciarPan(ev);
    return;
  }
  if (ev.altKey) {
    ev.preventDefault();
    removerPerto(pixelDoClique(ev));
    return;
  }
  if (!state.sel) {
    iniciarPan(ev);
    return;
  }
  ev.preventDefault();
  adicionarMarcador(pixelDoClique(ev));
}

function atualizarModoPan(ev) {
  $('#wrap').classList.toggle('shift-pan', !!ev.shiftKey);
}

$('#wrap').addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const f = ev.deltaY > 0 ? 0.9 : 1.1;
  state.zoom = Math.min(4, Math.max(0.2, state.zoom * f));
  aplicarTransform();
}, { passive: false });

$('#mapa').addEventListener('mousedown', onMapaMouseDown);

window.addEventListener('mousemove', (ev) => {
  if (!state.panning || !state.panStart) return;
  state.pan.x = ev.clientX - state.panStart.x;
  state.pan.y = ev.clientY - state.panStart.y;
  aplicarTransform();
});

window.addEventListener('mouseup', () => {
  state.panning = false;
  state.panStart = null;
  $('#wrap').classList.remove('panning');
});

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Shift') atualizarModoPan(ev);
});
window.addEventListener('keyup', (ev) => {
  if (ev.key === 'Shift') {
    $('#wrap').classList.remove('shift-pan');
    if (state.panning) {
      state.panning = false;
      state.panStart = null;
      $('#wrap').classList.remove('panning');
    }
  }
});

$('#q').addEventListener('input', () => renderEspecies());
$('#mapa-select').addEventListener('change', () => {
  const nome = $('#mapa-select').value;
  if (!nome) return;
  regAtual().img = nome;
  carregarImagem(nome);
});
$('#btn-salvar').onclick = () => salvar();

carregar().catch((e) => { $('#save-msg').textContent = String(e); });
