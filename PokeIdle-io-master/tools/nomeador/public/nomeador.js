// Nomeador — grade de sprites com o nome editável embaixo de cada um.
//
// O desenho é o mesmo do viewer.js do Sprite Lab: cada sprite é um atlas .webp
// mais um manifest que nomeia os quadros como {frame}_{layer}_{addon}_{direção}.png
// e guarda o retângulo de cada um dentro do atlas. Desenhar = recortar o retângulo
// com smoothing desligado. Aqui só muda o que vai embaixo: um input que, ao dar
// Enter, renomeia o PNG de origem no disco.

import { normalizarBusca } from './busca.mjs';

const localize = (p) => p.replace(/^\/assets-packs/, '/lab');
const $ = (s) => document.querySelector(s);
const PAGINA = 240; // cartas por lote — 6750 inputs de uma vez trava o Chrome

const pastaGen = (id) => `${id}GEN`;
const ehPastaGen = (p) => /^\dGEN$/.test(p || '');

const state = {
  entries: [],
  lista: [],
  vistos: 0,
  dir: 3,
  zoom: 4,
  animate: true,
  pular: true,
  q: '',
  filtro: 'pendente',
  pasta: 'all',
  geracao: 'all',
  faixas: [],
  dex: {},
  statsGer: {},
  sil: {},        // id → [bloco, posição no bloco, tamanho do bloco]
  silMeta: null,
  desfazer: [],
  indiceGerado: '',
};

// Direção, zoom e filtro sobrevivem ao F5 — a sessão de nomear é longa e refazer
// a configuração toda vez cansa. O `#filtro` na URL ganha do que estiver salvo.
const PREFS = ['dir', 'zoom', 'animate', 'pular', 'filtro', 'pasta', 'geracao'];
function carregarPrefs() {
  try { Object.assign(state, JSON.parse(localStorage.nomeador || '{}')); } catch { /* ignora */ }
  const h = location.hash.slice(1);
  if (['pendente', 'nomeado', 'np', 'all', 'erro'].includes(h)) state.filtro = h;
}
const salvarPrefs = () =>
  localStorage.setItem('nomeador', JSON.stringify(Object.fromEntries(PREFS.map((k) => [k, state[k]]))));

// ------------------------------------------------------------- carregamento

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
  if (cacheSprite.has(entry.id)) return cacheSprite.get(entry.id);

  const p = (async () => {
    const manifest = await fetch(localize(entry.manifest)).then((r) => r.json());
    const cat = Object.values(manifest.categories)[0];
    const images = await Promise.all(cat.pages.map((pg) => loadImage(localize(pg.image))));

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

// Os quadros vão de 32×32 a 256×480, então o zoom é um TETO, não um fator fixo:
// cada sprite cresce até o maior múltiplo inteiro que ainda cabe no palco (inteiro
// para não borrar o pixel art). Só o que não cabe nem em 1× encolhe por fração.
const CAIXA = { w: 132, h: 132 };
function escala(f) {
  const cabe = Math.min(CAIXA.w / f.w, CAIXA.h / f.h);
  return cabe >= 1 ? Math.min(state.zoom, Math.floor(cabe)) : cabe;
}

// -------------------------------------------------------------- animação

const live = new Set();

const observer = new IntersectionObserver((rows) => {
  for (const row of rows) {
    const rec = row.target._rec;
    if (!rec) continue;
    if (!row.isIntersecting) { live.delete(rec); continue; }
    live.add(rec);
    if (rec.sprite || rec.loading || !rec.entry.manifest) continue;
    rec.loading = true;
    loadSprite(rec.entry).then(
      (s) => { rec.sprite = s; rec.dirty = true; },
      () => { rec.el.querySelector('.stage').innerHTML = '<span class="meta">erro</span>'; },
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

// ----------------------------------------------------------------- cartas

const base = (arq) => arq.split('/').pop().replace(/\.png$/i, '');

const NAO_ESPECIE = /^(trainer|trainer_vip|chansey_enfermeira|anuncio-shinys|anuncio-pvp|tyranitar_mascara)$/;

function especieDe(nome) {
  if (!nome) return null;
  let n = nome;
  if (n.startsWith('shiny_')) n = n.slice(6);
  else if (n.endsWith('_shiny')) n = n.slice(0, -6);
  n = n.replace(/_revisar(_\d+)?/g, '');
  n = n.replace(/_east_sea$/g, '_east').replace(/_west_sea$/g, '_west');
  n = n.replace(/_montaria(_\d+)?$/g, '').replace(/_montaria/g, '');
  n = n.replace(/_\d+$/g, '');
  if (n === 'farfetch') n = 'farfetchd';
  if (!n || NAO_ESPECIE.test(n)) return null;
  return n;
}

function geracaoDe(dexNum) {
  if (!dexNum) return null;
  for (const f of state.faixas) if (dexNum >= f.min && dexNum <= f.max) return f.id;
  return null;
}

function dexDeNome(nome) {
  const esp = especieDe(nome);
  return esp ? state.dex[esp] ?? null : null;
}

/** Geração da entrada: null se não for espécie nomeada (fila, NP sem nome…). */
function geracaoDeEntrada(e) {
  if (e.kind === 'vazio') return null;
  if (e.kind === 'np' && !e.nomeado) return null;
  if (!e.nomeado && e.kind !== 'np') return null;
  return geracaoDe(dexDeNome(e.name)) ?? 'sem';
}

function ehShinyNome(nome) {
  if (!nome) return false;
  return nome.startsWith('shiny_') || nome.endsWith('_shiny');
}

/** 0 = forma normal, 1 = shiny — normal sempre imediatamente antes do par shiny. */
function prioridadeShiny(e) {
  if (e.kind === 'shiny' || ehShinyNome(e.name)) return 1;
  return 0;
}

function compararDex(a, b) {
  const da = dexDeNome(a.name) ?? 9999;
  const db = dexDeNome(b.name) ?? 9999;
  if (da !== db) return da - db;

  const espA = especieDe(a.name);
  const espB = especieDe(b.name);
  if (espA && espB && espA === espB) {
    const pa = prioridadeShiny(a);
    const pb = prioridadeShiny(b);
    if (pa !== pb) return pa - pb;
  }

  return (a.name || '').localeCompare(b.name || '', 'pt', { numeric: true });
}

/** Ordem manual só dentro do mesmo par (mesma espécie + mesma faixa normal/shiny). */
function compararLista(a, b) {
  const espA = especieDe(a.name);
  const espB = especieDe(b.name);
  const mesmoPar = espA && espB && espA === espB && prioridadeShiny(a) === prioridadeShiny(b);
  if (mesmoPar) {
    const oa = a.ordem ?? null;
    const ob = b.ordem ?? null;
    if (oa != null && ob != null && oa !== ob) return oa - ob;
    if (oa != null && ob == null) return -1;
    if (oa == null && ob != null) return 1;
  }
  return compararDex(a, b);
}

const modoAgrupado = () =>
  state.filtro === 'nomeado' && state.geracao === 'all' && !state.q && state.pasta === 'all';

const visaoTotal = () =>
  state.filtro === 'all' && state.geracao === 'all' && state.pasta === 'all';

/** Busca por nome na visão total → expande para todo o bloco de silhueta (silhuetas.py). */
const buscaPorSilhueta = () =>
  visaoTotal() && !!state.q && !!state.silMeta?.grupos;

let gruposBusca = null;

function bateTexto(e, q) {
  const qn = normalizarBusca(q);
  if (!qn) return true;
  const arq = normalizarBusca(e.arquivo || '');
  const nome = normalizarBusca(e.name || '');
  const orig = normalizarBusca(e.origem || '');
  if (arq.includes(qn) || nome.includes(qn) || orig.includes(qn)) return true;
  if (String(e.id) === qn) return true;
  const esp = especieDe(e.name);
  if (esp && (esp.includes(qn) || qn.includes(esp))) return true;
  const dex = dexDeNome(e.name);
  if (dex != null) {
    const num = String(dex);
    const qNum = qn.replace(/^#/, '');
    if (num === qNum) return true;
    if (num.padStart(3, '0').includes(qNum)) return true;
  }
  return false;
}

function atualizarGruposBusca() {
  gruposBusca = null;
  if (!buscaPorSilhueta()) return;
  const q = state.q.toLowerCase();
  const grupos = new Set();
  for (const e of state.entries) {
    if (!bateTexto(e, q)) continue;
    const sil = state.sil[e.id];
    if (sil) grupos.add(sil[0]);
  }
  if (grupos.size) gruposBusca = grupos;
}

// Ordem por bloco de silhueta (silhuetas.py): sprite parecida colada na parecida, em vez
// da ordem por dex. Vale em duas telas — na aba não-pokémon, onde a dex não diz nada
// porque quase nada tem nome, e na visão TOTAL (todos + todas + todas as pastas), que é
// onde dá para varrer o acervo inteiro atrás de sprite repetida ou trocada.
// Com busca ativa na mesma visão, o texto acha a âncora e o bloco traz os parecidos.
// Ver `.sil` no CSS para a faixa que separa os blocos.
const agrupaSilhueta = () =>
  !!state.silMeta?.grupos && (
    state.filtro === 'np' ||
    (visaoTotal() && !state.q) ||
    buscaPorSilhueta()
  );

function compararSilhueta(a, b) {
  const sa = state.sil[a.id];
  const sb = state.sil[b.id];
  if (!sa || !sb) return sa ? -1 : sb ? 1 : compararDex(a, b);  // sem assinatura vai pro fim
  return sa[0] - sb[0] || sa[1] - sb[1];
}

/** Lista plana ou agrupada onde a ordem manual faz sentido. */
const ordenavel = () =>
  ehPastaGen(state.pasta) ||
  (state.filtro === 'nomeado' && state.pasta === 'all' && !state.q) ||
  (state.filtro === 'pendente' && state.pasta === 'all' && !state.q);

// Sprite que ainda espera um nome: exclui o que já foi nomeado, o que foi mandado
// para NP/ e os vazios. É esta a conta que a barra de progresso persegue.
const naFila = (e) => !e.nomeado && e.kind !== 'np' && e.kind !== 'vazio';

function parNormalDe(e) {
  const esp = especieDe(e.name);
  if (!esp || prioridadeShiny(e) === 0) return null;
  return state.entries.find((x) =>
    x.id !== e.id &&
    x.nomeado &&
    x.kind !== 'np' &&
    prioridadeShiny(x) === 0 &&
    especieDe(x.name) === esp,
  ) ?? null;
}

function pintar(rec) {
  const e = rec.entry;
  const fora = e.kind === 'np';
  rec.el.classList.toggle('nomeado', !!e.nomeado);
  rec.el.classList.toggle('fora', fora);
  rec.input.value = e.name || '';
  rec.input.placeholder = base(e.arquivo);
  rec.badge.className = `badge ${e.erro ? 'erro' : e.kind}`;
  rec.badge.textContent = e.erro ? 'sem atlas' : e.kind;
  const num = dexDeNome(e.name);
  const sil = state.sil[e.id];
  const emBloco = agrupaSilhueta() && sil && sil[2] > 1;
  rec.el.classList.toggle('sil', !!emBloco);
  rec.el.classList.toggle('sil-alt', !!emBloco && sil[0] % 2 === 1);
  rec.el.classList.toggle('sil-inicio', !!emBloco && sil[1] === 0);
  rec.arq.textContent = emBloco
    ? `⧉${sil[2]} · ${base(e.arquivo)}`
    : [
      num ? `#${String(num).padStart(3, '0')}` : null,
      `id ${e.id}`,
      e.origem ? e.origem.replace(/\.png$/i, '') : null,
      base(e.arquivo),
    ].filter(Boolean).join(' · ');
  const par = parNormalDe(e);
  const parNaLista = par && state.lista.some((x) => x.id === par.id);
  const shinySolo = prioridadeShiny(e) === 1 && !parNaLista;
  rec.el.classList.toggle('sem-par', shinySolo);
  rec.arq.title = emBloco
    ? `${e.arquivo}\nbloco ${sil[0]} · ${sil[1] + 1} de ${sil[2]} silhuetas parecidas`
    : shinySolo
      ? par
        ? `${e.arquivo}\n${especieDe(e.name)} normal em ${par.pasta || 'raiz'} (${base(par.arquivo)}) — outra pasta ou filtro`
        : `${e.arquivo}\nnenhum ${especieDe(e.name)} normal nomeado — busque na fila pendente`
      : e.arquivo;
  if (rec.btnRemover) {
    rec.btnRemover.textContent = fora ? '↩' : '×';
    rec.btnRemover.title = fora ? 'voltar para a fila' : 'fora da fila → NP/';
  }
  if (rec.genSel) {
    const pasta = e.pasta || '';
    rec.genSel.value = ehPastaGen(pasta) ? pasta : '';
    const sug = geracaoDeEntrada(e);
    rec.genSel.classList.toggle('sugerida', !!sug && pastaGen(sug) !== pasta);
  }
  rec.el.classList.toggle('ordenavel', ordenavel());
  rec.el.draggable = ordenavel();
}

function opcoesGenSelect() {
  return state.faixas.map((f) => `<option value="${pastaGen(f.id)}">${f.rotulo}</option>`).join('');
}

function carta(entry) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <button type="button" class="btn-reveal" title="Reveal in Explorer">📁</button>
    <button type="button" class="btn-remover" title="fora da fila">×</button>
    <div class="stage"></div>
    <input class="nome" list="sugestoes" spellcheck="false" autocomplete="off">
    <select class="gen-mover" title="mover para pasta da geração">
      <option value="">mover p/ gen…</option>
    </select>
    <div class="meta"><span class="badge"></span><span class="arq"></span></div>`;

  const stage = el.querySelector('.stage');
  const rec = {
    entry, el, input: el.querySelector('.nome'),
    badge: el.querySelector('.badge'), arq: el.querySelector('.arq'),
    btnReveal: el.querySelector('.btn-reveal'),
    btnRemover: el.querySelector('.btn-remover'),
    genSel: el.querySelector('.gen-mover'),
    idx: -1, dir: -1, zoom: -1, dirty: true,
  };

  rec.genSel.innerHTML = `<option value="">mover p/ gen…</option>${opcoesGenSelect()}`;
  for (const evNome of ['mousedown', 'click']) {
    rec.genSel.addEventListener(evNome, (ev) => ev.stopPropagation());
  }
  rec.genSel.addEventListener('change', () => moverParaGen(rec));
  rec.btnReveal.addEventListener('click', (ev) => {
    ev.stopPropagation();
    revelarNoExplorer(rec);
  });
  rec.btnRemover.addEventListener('click', (ev) => {
    ev.stopPropagation();
    alternar(rec);
  });
  rec.input.addEventListener('mousedown', (ev) => ev.stopPropagation());

  if (entry.manifest) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    cv.draggable = false;
    stage.append(cv);
    rec.canvas = cv;
    rec.ctx = cv.getContext('2d');
  } else {
    // os poucos PNGs que não têm grade de 4 colunas: mostra o arquivo cru
    const img = new Image();
    img.draggable = false;
    img.src = `/png/${entry.arquivo}`;
    img.style.maxHeight = '84px';
    stage.append(img);
  }

  el._rec = rec;
  el.dataset.id = entry.id;
  pintar(rec);
  observer.observe(el);

  rec.input.addEventListener('focus', () => el.classList.add('focado'));
  rec.input.addEventListener('blur', () => el.classList.remove('focado'));
  rec.input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); pintar(rec); rec.input.blur(); return; }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    if (ev.shiftKey) { alternar(rec); return; }
    salvar(rec, rec.input.value).then((ok) => { if (ok && state.pular) proximo(rec); });
  });

  return rec;
}

let arrastando = null;

function ligarArrastar(rec, container) {
  if (rec.el._dragLigado) return;
  rec.el._dragLigado = true;

  rec.el.addEventListener('dragstart', (ev) => {
    if (!ordenavel()) { ev.preventDefault(); return; }
    if (ev.target.closest('input, select, .btn-reveal, .btn-remover')) { ev.preventDefault(); return; }
    arrastando = rec;
    rec.el.classList.add('arrastando');
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', String(rec.entry.id));
  });

  rec.el.addEventListener('dragend', () => {
    rec.el.classList.remove('arrastando');
    arrastando = null;
    container.querySelectorAll('.soltar-aqui').forEach((n) => n.classList.remove('soltar-aqui'));
  });

  rec.el.addEventListener('dragover', (ev) => {
    if (!arrastando || arrastando === rec || !ordenavel()) return;
    ev.preventDefault();
    rec.el.classList.add('soltar-aqui');
  });
  rec.el.addEventListener('dragleave', () => rec.el.classList.remove('soltar-aqui'));
  rec.el.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    rec.el.classList.remove('soltar-aqui');
    if (!arrastando || arrastando === rec) return;
    container.insertBefore(arrastando.el, rec.el);
    await persistirOrdem(container);
  });
}

function idsDoContainer(container) {
  return [...container.querySelectorAll('.card')].map((el) => el._rec?.entry.id).filter(Boolean);
}

async function persistirOrdem(container) {
  const ids = idsDoContainer(container);
  if (ids.length < 2) return;
  const pasta = container.dataset.pasta || (ehPastaGen(state.pasta) ? state.pasta : '');
  const ger = container.dataset.ger || null;
  const r = await pedir('/api/ordem', { pasta: pasta || null, ger, ids });
  if (!r) return;
  for (const e of r.entradas || []) {
    const alvo = state.entries.find((x) => x.id === e.id);
    if (alvo) Object.assign(alvo, e);
  }
  toast('ordem salva');
}

function ligarContainerArrastar(container) {
  if (!ordenavel()) return;
  for (const el of container.querySelectorAll('.card')) {
    if (el._rec) ligarArrastar(el._rec, container);
  }
}

async function moverParaGen(rec) {
  const para = rec.genSel.value;
  if (!para || para === (rec.entry.pasta || '')) return;
  const antes = rec.entry.pasta || '';
  const r = await pedir('/api/mover', { id: rec.entry.id, para });
  if (!r) { pintar(rec); return; }
  Object.assign(rec.entry, r.entrada);
  empilhar({ tipo: 'mover', id: rec.entry.id, pasta: antes, rec });
  pintar(rec);
  contar();
  atualizarChipsPastas();
  const rotulo = state.faixas.find((f) => pastaGen(f.id) === para)?.rotulo ?? para;
  toast(`→ ${rotulo} (${para}/)`);
}

function atualizarChipsPastas() {
  const pastas = [...new Set(state.entries.map((e) => e.pasta || ''))].sort((a, b) => {
    const ga = a.match(/^(\d)GEN$/)?.[1];
    const gb = b.match(/^(\d)GEN$/)?.[1];
    if (ga && gb) return ga - gb;
    if (ga) return -1;
    if (gb) return 1;
    return a.localeCompare(b);
  });
  chip($('#pastas'), [['all', 'todas as pastas'], ...pastas.map((p) => [p, p || 'raiz'])],
    state.pasta, (v) => { state.pasta = v; });
  for (const c of $('#pastas').children) c.querySelector('.n').remove();
}

// Próxima carta que ainda está na fila; renderiza mais um lote se acabar.
const proximo = (rec) => proximoDe(rec.el.nextElementSibling);

function proximoDe(el) {
  while (el) {
    if (el._rec && naFila(el._rec.entry)) { foco(el._rec); return; }
    el = el.nextElementSibling;
  }
  if (state.vistos < state.lista.length) {
    const ultima = $('#grid').lastElementChild;
    renderLote();
    proximoDe(ultima?.nextElementSibling ?? $('#grid').firstElementChild);
  }
}

function foco(rec) {
  rec.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  rec.input.focus();
  rec.input.select();
}

// ------------------------------------------------------- salvar / descartar

async function pedir(rota, corpo) {
  let r;
  try {
    r = await fetch(rota, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }).then((x) => x.json());
  } catch (e) {
    toast(`sem resposta do servidor: ${e.message}`, true);
    return null;
  }
  if (r.erro) { toast(r.erro, true); return null; }
  if (['/api/nome', '/api/mover', '/api/ordem'].includes(rota)) {
    fetch('/api/indice').then((x) => x.json()).then((ind) => {
      if (ind?.gerado) state.indiceGerado = ind.gerado;
    }).catch(() => {});
  }
  return r;
}

function aplicar(rec, entrada) {
  const alvo = state.entries.find((e) => e.id === entrada.id) ?? rec.entry;
  Object.assign(alvo, entrada);
  rec.entry = alvo;
  pintar(rec);
  rec.el.classList.remove('salvo');
  void rec.el.offsetWidth;
  rec.el.classList.add('salvo');
  contar();
}

/** Carta visível pelo id estável — depois de re-render o rec antigo fica solto no DOM. */
function recPorId(id) {
  return document.querySelector(`.card[data-id="${id}"]`)?._rec ?? null;
}

async function aplicarIndice(indice) {
  state.indiceGerado = indice.gerado || '';
  state.entries = Object.values(indice.outfits);
  const ger = await fetch('/api/geracoes').then((r) => r.json());
  state.faixas = ger.faixas;
  state.dex = ger.dex;
  state.statsGer = ger.stats;
}

/** Sincroniza se lab-index.json mudou no disco (ex.: nomeador:build com servidor aberto). */
async function sincronizarIndice(forcar) {
  const indice = await fetch('/api/indice').then((r) => r.json());
  if (!forcar && indice.gerado === state.indiceGerado) return false;

  const focoId = document.activeElement?.closest('.card')?.dataset?.id;
  const scrollY = window.scrollY;
  await aplicarIndice(indice);
  render();
  window.scrollTo(0, scrollY);
  if (focoId) recPorId(focoId)?.input?.focus();
  return true;
}

function empilhar(passo) {
  state.desfazer.push(passo);
  $('#desfazer').disabled = false;
}

async function salvar(rec, valor, silencioso) {
  const id = rec.entry.id;
  if (await sincronizarIndice()) {
    toast('índice rebuildado — cartas realinhadas');
    rec = recPorId(id) ?? rec;
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) {
      toast('sprite sumiu do filtro após sync — recarregue a página', true);
      return false;
    }
    rec.entry = entry;
  }

  const antes = rec.entry.name;
  if (valor.trim() === (antes || '')) return true;

  const r = await pedir('/api/nome', { id: rec.entry.id, nome: valor });
  if (!r) return false;
  aplicar(rec, r.entrada);

  if (!silencioso) {
    empilhar({ tipo: 'nome', id: rec.entry.id, nome: antes });
    const nome = base(rec.entry.arquivo);
    toast(valor.trim() && nome !== valor.trim() ? `salvo como ${nome} (o nome já existia)` : `${nome}.png`);
  }
  return true;
}

// Um clique na carta a manda para `NP/` (ou traz de volta, se já estiver lá) e ela SAI
// da grade na hora, com a seguinte ocupando o lugar. A rede de segurança não é a carta
// continuar à vista, é o desfazer: ele devolve o arquivo e reencaixa a carta na posição
// exata de onde saiu.
async function alternar(rec) {
  const id = rec.entry.id;
  if (await sincronizarIndice()) {
    toast('índice rebuildado — cartas realinhadas');
    rec = recPorId(id) ?? rec;
  }
  const e = rec.entry;
  const paraNp = e.kind !== 'np';
  const antes = e.pasta || '';
  const onde = { pai: rec.el.parentNode, depois: rec.el.nextElementSibling };
  const tinhaFoco = document.activeElement === rec.input;

  const r = await pedir('/api/mover', { id: e.id, para: paraNp ? 'NP' : (rec.voltarPara ?? '') });
  if (!r) return;
  if (paraNp) rec.voltarPara = antes;
  Object.assign(e, r.entrada);
  empilhar({ tipo: 'mover', id: e.id, pasta: antes, rec, ...onde });
  sumirOuPintar(rec);
  contar();
  toast(paraNp ? `fora da fila → NP/${base(e.arquivo)}.png` : `de volta à fila → ${e.arquivo}`);
  atualizarChipsPastas();
  // veio de Shift+Enter: quem estava no teclado continua no teclado
  if (tinhaFoco && state.pular) proximoDe(onde.depois);
}

async function revelarNoExplorer(rec) {
  const r = await pedir('/api/reveal', { id: rec.entry.id });
  if (!r) return;
  if (r.aviso) toast(r.aviso, true);
  else toast(r.caminho?.replace(/\\/g, '/') ?? 'aberto no Explorer');
}

function recomputarStatsGer() {
  const stats = { sem: { sprites: 0, especies: new Set() } };
  for (const f of state.faixas) stats[f.id] = { sprites: 0, especies: new Set() };
  for (const e of state.entries) {
    if (!e.nomeado || e.kind === 'np' || e.kind === 'vazio') continue;
    const g = geracaoDeEntrada(e) ?? 'sem';
    stats[g].sprites++;
    const esp = especieDe(e.name);
    if (esp) stats[g].especies.add(esp);
  }
  state.statsGer = Object.fromEntries(
    Object.entries(stats).map(([k, v]) => [k, { sprites: v.sprites, especies: v.especies.size }]),
  );
}

/** Depois de mudar uma entrada: tira a carta se ela não pertence mais ao filtro. */
function sumirOuPintar(rec) {
  if (modoAgrupado()) { render(); return; }
  if (casa(rec.entry)) { pintar(rec); return; }
  live.delete(rec);
  observer.unobserve(rec.el);
  rec.el.remove();
  // a grade não pode secar embaixo do clique: repõe quando fica curta
  if ($('#grid').childElementCount < PAGINA / 2 && state.vistos < state.lista.length) renderLote();
}

function reinserir(rec, passo) {
  if (rec.el.isConnected) return;
  const pai = passo.pai?.isConnected ? passo.pai : $('#grid');
  pai.insertBefore(rec.el, passo.depois?.isConnected ? passo.depois : null);
  observer.observe(rec.el);
  rec.dirty = true;
}

async function desfazer() {
  const passo = state.desfazer.pop();
  $('#desfazer').disabled = !state.desfazer.length;
  if (!passo) return;

  const r = passo.tipo === 'mover'
    ? await pedir('/api/mover', { id: passo.id, para: passo.pasta })
    : await pedir('/api/nome', { id: passo.id, nome: passo.nome || '' });
  if (!r) return;

  const rec = passo.rec ?? [...document.querySelectorAll('.card')]
    .find((el) => el._rec?.entry.id === passo.id)?._rec;
  if (rec) {
    Object.assign(rec.entry, r.entrada);
    reinserir(rec, passo);
    aplicar(rec, r.entrada);
  }
  contar();
  toast(`desfeito → ${r.entrada.arquivo}`);
}

// ---------------------------------------------------------------- filtros

const casa = (e) => {
  const buscando = !!state.q.trim();
  if (!buscando) {
    if (state.filtro === 'pendente' && !naFila(e)) return false;
    if (state.filtro === 'nomeado' && !e.nomeado) return false;
    if (state.filtro === 'np' && e.kind !== 'np') return false;
    if (state.filtro === 'erro' && !e.erro) return false;
  } else if (state.filtro === 'erro' && !e.erro) {
    return false;
  }
  if (!buscando) {
    if (state.pasta !== 'all' && (e.pasta || '') !== state.pasta) return false;
    if (state.geracao !== 'all') {
      const g = geracaoDeEntrada(e);
      if (g === null) return false;
      if (state.geracao === 'sem' ? g !== 'sem' : g !== state.geracao) return false;
    }
    return true;
  }
  const q = state.q;
  if (buscaPorSilhueta() && gruposBusca) {
    const sil = state.sil[e.id];
    if (sil && gruposBusca.has(sil[0])) return true;
  }
  return bateTexto(e, q);
};

function renderLote() {
  const grid = $('#grid');
  if (state.vistos === 0) {
    delete grid.dataset.pasta;
    delete grid.dataset.fila;
    delete grid.dataset.ger;
    if (ehPastaGen(state.pasta)) grid.dataset.pasta = state.pasta;
    else if (state.filtro === 'pendente' && state.pasta === 'all' && !state.q) grid.dataset.fila = 'pendente';
    else if (state.filtro === 'nomeado' && state.pasta === 'all' && !state.q && state.geracao !== 'all') {
      grid.dataset.ger = state.geracao;
    }
  }
  const frag = document.createDocumentFragment();
  const fim = Math.min(state.vistos + PAGINA, state.lista.length);
  for (let i = state.vistos; i < fim; i++) frag.append(carta(state.lista[i]).el);
  grid.append(frag);
  state.vistos = fim;
  if (ordenavel()) ligarContainerArrastar(grid);

  const faltam = state.lista.length - state.vistos;
  $('#mais').classList.toggle('hidden', !faltam);
  $('#btn-mais').textContent = `mostrar mais ${Math.min(PAGINA, faltam)} (faltam ${faltam})`;
}

function renderAgrupado() {
  const grid = $('#grid');
  grid.innerHTML = '';
  delete grid.dataset.pasta;
  state.lista = state.entries.filter(casa).sort(compararLista);
  state.vistos = state.lista.length;
  $('#mais').classList.add('hidden');

  const porGer = Object.fromEntries(state.faixas.map((f) => [f.id, []]));
  porGer.sem = [];
  for (const e of state.lista) {
    const g = geracaoDeEntrada(e) ?? 'sem';
    (porGer[g] ?? porGer.sem).push(e);
  }
  for (const arr of Object.values(porGer)) arr.sort(compararLista);

  const blocos = [
    ...state.faixas.map((f) => ({ faixa: f, id: f.id })),
    { faixa: { rotulo: 'Sem geração', regiao: 'NPC / montaria / desconhecido' }, id: 'sem' },
  ];

  for (const { faixa, id } of blocos) {
    const grupo = porGer[id] || [];
    if (!grupo.length) continue;
    const especies = new Set(grupo.map((e) => especieDe(e.name)).filter(Boolean));
    const pct = faixa.total
      ? Math.round((especies.size / faixa.total) * 100)
      : null;

    const sec = document.createElement('div');
    sec.className = 'sec-ger';
    sec.innerHTML = `
      <h2>${faixa.rotulo}${faixa.regiao ? ` <span>${faixa.regiao}</span>` : ''}</h2>
      <p class="cov">${grupo.length} sprite${grupo.length === 1 ? '' : 's'} ·
        <b>${especies.size}</b> espécie${especies.size === 1 ? '' : 's'}${pct != null ? ` · ${pct}% da geração` : ''}</p>`;
    grid.append(sec);

    const wrap = document.createElement('div');
    wrap.className = 'grid-sec';
    if (id !== 'sem') wrap.dataset.ger = id;
    for (const e of grupo) wrap.append(carta(e).el);
    grid.append(wrap);
    if (id !== 'sem') ligarContainerArrastar(wrap);
  }

  $('#vazio').classList.toggle('hidden', state.lista.length > 0);
}

function render() {
  atualizarGruposBusca();
  live.clear();
  cacheSprite.clear();
  $('#grid').innerHTML = '';
  state.lista = state.entries.filter(casa);
  state.vistos = 0;
  $('#vazio').classList.toggle('hidden', state.lista.length > 0);

  if (modoAgrupado()) {
    renderAgrupado();
    return;
  }

  state.lista.sort(agrupaSilhueta() ? compararSilhueta : ordenavel() ? compararLista : compararDex);
  renderLote();
}

function contar() {
  recomputarStatsGer();
  const n = state.entries.length;
  const conta = {
    all: n,
    nomeado: state.entries.filter((e) => e.nomeado).length,
    pendente: state.entries.filter(naFila).length,
    np: state.entries.filter((e) => e.kind === 'np').length,
    erro: state.entries.filter((e) => e.erro).length,
  };
  // resolver = nomear OU tirar da fila; o X também faz a barra andar
  const fora = n - conta.nomeado - conta.pendente;
  $('#counts').innerHTML = `<b>${conta.nomeado}</b> nomeados · ${fora} fora · ${conta.pendente} na fila`;
  $('#barra').style.width = `${((n - conta.pendente) / n) * 100}%`;

  for (const c of document.querySelectorAll('#filtros .chip')) {
    c.querySelector('.n').textContent = conta[c.dataset.filtro] ?? '';
  }

  for (const c of document.querySelectorAll('#geracoes .chip')) {
    const id = c.dataset.geracao;
    if (id === 'all') {
      c.querySelector('.n').textContent = state.statsGer
        ? Object.values(state.statsGer).reduce((s, v) => s + v.sprites, 0)
        : '';
      continue;
    }
    const st = state.statsGer?.[id];
    c.querySelector('.n').textContent = st ? `${st.especies} esp · ${st.sprites} spr` : '0';
    const faixa = state.faixas.find((f) => f.id === id);
    c.classList.toggle('cheia', faixa && st && st.especies >= faixa.total);
  }
}

// ------------------------------------------------------------------ toast

let tt;
function toast(msg, ruim) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast${ruim ? ' ruim' : ''}`;
  el.hidden = false;
  clearTimeout(tt);
  tt = setTimeout(() => { el.hidden = true; }, ruim ? 4000 : 1600);
}

// ------------------------------------------------------------------ start

const chip = (pai, dados, ativo, aoClicar, attr = 'filtro') => {
  pai.innerHTML = '';
  for (const [valor, rotulo] of dados) {
    const b = document.createElement('button');
    b.className = `chip${valor === ativo ? ' on' : ''}`;
    b.dataset[attr] = valor;
    b.innerHTML = `${rotulo}<span class="n"></span>`;
    b.onclick = () => {
      for (const o of pai.children) o.classList.toggle('on', o === b);
      aoClicar(valor);
      salvarPrefs();
      render();
    };
    pai.append(b);
  }
};

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

(async () => {
  carregarPrefs();

  const indice = await fetch('/api/indice').then((r) => r.json());
  await aplicarIndice(indice);

  const sil = await fetch('/api/silhuetas').then((r) => r.json()).catch(() => null);
  if (sil && !sil.ausente) { state.sil = sil.porId; state.silMeta = sil; }

  const nomes = await fetch('/api/nomes').then((r) => r.json());
  $('#sugestoes').innerHTML = nomes.map((n) => `<option value="${n}">`).join('');

  chip($('#filtros'), [['pendente', 'na fila'], ['nomeado', 'nomeados'], ['np', 'não-pokémon'],
    ['all', 'todos'], ['erro', 'sem atlas']], state.filtro, (v) => { state.filtro = v; });

  chip($('#geracoes'), [
    ['all', 'todas'],
    ...state.faixas.map((f) => [f.id, f.rotulo]),
    ['sem', 'sem gen'],
  ], state.geracao, (v) => { state.geracao = v; }, 'geracao');

  atualizarChipsPastas();

  $('#zoom').value = state.zoom;
  $('#zoomv').textContent = `${state.zoom}×`;
  $('#anim').checked = state.animate;
  $('#pular').checked = state.pular;
  for (const o of $('#dirs').children) o.classList.toggle('on', +o.dataset.dir === state.dir);

  const redesenhar = () => { for (const r of live) r.dirty = true; salvarPrefs(); };
  $('#q').oninput = debounce((e) => { state.q = e.target.value.trim(); render(); }, 200);
  $('#zoom').oninput = (e) => {
    state.zoom = +e.target.value;
    $('#zoomv').textContent = `${state.zoom}×`;
    redesenhar();
  };
  $('#anim').onchange = (e) => { state.animate = e.target.checked; redesenhar(); };
  $('#pular').onchange = (e) => { state.pular = e.target.checked; salvarPrefs(); };
  $('#dirs').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const o of $('#dirs').children) o.classList.toggle('on', o === b);
    state.dir = +b.dataset.dir;
    redesenhar();
  };
  $('#btn-mais').onclick = () => renderLote();
  $('#desfazer').onclick = desfazer;

  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); desfazer(); }
  });

  // rolar até o fim carrega o lote seguinte sozinho
  new IntersectionObserver((rows) => {
    if (rows[0].isIntersecting && state.vistos < state.lista.length) renderLote();
  }, { rootMargin: '600px' }).observe($('#mais'));

  // Realinha sozinho se lab-index.json mudou no disco (build, script de recuperação…)
  setInterval(async () => {
    const ind = await fetch('/api/indice').then((r) => r.json()).catch(() => null);
    if (!ind?.gerado || ind.gerado === state.indiceGerado) return;
    if (document.activeElement?.closest('.card')?.input) return;
    await sincronizarIndice(true);
  }, 20000);

  render();
  contar();
  requestAnimationFrame(tick);
})();
