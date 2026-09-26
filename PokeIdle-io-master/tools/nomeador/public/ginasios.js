/** Lab de ginásios — marca a arena do desafio ao líder (recorte + 2 spawns). */
import { carregarOutfit, desenharHero, dirDeMovimento } from './casas-hero.mjs';

const $ = (s) => document.querySelector(s);

const state = {
  doc: null,
  modo: 'box',
  mapa: 'cerulean',
  regiao: [-48, -34, 38, 22],
  render: null,
  pan: { x: 40, y: 40 },
  zoom: 1,
  arraste: null,
  panDrag: null,
  previewCache: null,
  mostrarCentro: true,
  visao: 'rua',
  visaoEm: null,
  walkPreview: null,
  jogo: null,
};

const REF_CENTRO = { box: [-40, -28, 29, 17], inicio: { x: -3, y: -6 } };
const COR_ARENA = '#ffa726';

async function api(rota, corpo) {
  const r = await fetch(rota, {
    method: corpo ? 'POST' : 'GET',
    headers: corpo ? { 'content-type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.erro ?? (r.status === 404 ? 'servidor desatualizado — reinicie npm run nomeador' : 'falhou');
    throw new Error(msg);
  }
  return j;
}

function arena() {
  return state.doc?.arena ?? {};
}

function normalizarBox(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [a, b, c, d] = box.map(Number);
  if (![a, b, c, d].every(Number.isFinite)) return null;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

function fmtBox(box) {
  const b = normalizarBox(box);
  return b ? `[${b.join(', ')}]` : '—';
}

function normalizarPassagensPorAndar(passagens, groundZ = 7) {
  if (!passagens) return { [String(groundZ)]: { abrir: [], fechar: [] } };
  const chaves = Object.keys(passagens).filter((k) => /^\d+$/.test(k));
  if (chaves.length) {
    const out = {};
    for (const k of chaves) {
      out[k] = { abrir: [...(passagens[k]?.abrir ?? [])], fechar: [...(passagens[k]?.fechar ?? [])] };
    }
    if (!out[String(groundZ)]) out[String(groundZ)] = { abrir: [], fechar: [] };
    return out;
  }
  if (Array.isArray(passagens.abrir) || Array.isArray(passagens.fechar)) {
    return { [String(groundZ)]: { abrir: [...(passagens.abrir ?? [])], fechar: [...(passagens.fechar ?? [])] } };
  }
  return { [String(groundZ)]: { abrir: [], fechar: [] } };
}

function groundZArena() {
  return state.walkPreview?.groundZ ?? 7;
}

function camadaPassagens() {
  const a = arena();
  const gz = groundZArena();
  a.passagens = normalizarPassagensPorAndar(a.passagens, gz);
  const k = String(gz);
  if (!a.passagens[k]) a.passagens[k] = { abrir: [], fechar: [] };
  return a.passagens[k];
}

function idxPassagem(lista, x, y) {
  return lista.findIndex((p) => p[0] === x && p[1] === y);
}

function togglePassagemCelula(lx, ly, gradeBase) {
  const p = camadaPassagens();
  const natural = gradeBase?.[ly]?.[lx] === 1;
  const iA = idxPassagem(p.abrir, lx, ly);
  const iF = idxPassagem(p.fechar, lx, ly);
  if (!natural) {
    if (iA >= 0) p.abrir.splice(iA, 1);
    else {
      if (iF >= 0) p.fechar.splice(iF, 1);
      p.abrir.push([lx, ly]);
    }
  } else if (iF >= 0) p.fechar.splice(iF, 1);
  else {
    if (iA >= 0) p.abrir.splice(iA, 1);
    p.fechar.push([lx, ly]);
  }
}

function invalidarPreview() {
  state.previewCache = null;
}

async function carregarMapa() {
  $('#mapa-status').textContent = 'carregando tiles…';
  const mod = await import('/mapview.mjs');
  state.render = await mod.renderMapa(state.mapa, {
    escala: 1,
    regiao: state.regiao,
    visao: state.visao,
    visaoEm: state.visaoEm,
    onProgress: (msg) => { $('#mapa-status').textContent = msg; },
  });
  const base = $('#mapa');
  const over = $('#overlay');
  base.width = state.render.canvas.width;
  base.height = state.render.canvas.height;
  over.width = base.width;
  over.height = base.height;
  base.getContext('2d').drawImage(state.render.canvas, 0, 0);
  $('#mapa-status').textContent =
    `${state.mapa} · ${state.render.tiles} tiles · ${base.width}×${base.height}px`;
  aplicarTransform();
  desenharOverlay();
}

function aplicarTransform() {
  for (const c of [$('#mapa'), $('#overlay')]) {
    c.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  }
}

function canvasCoords(ev) {
  const vp = $('#viewport').getBoundingClientRect();
  const cx = (ev.clientX - vp.left - state.pan.x) / state.zoom;
  const cy = (ev.clientY - vp.top - state.pan.y) / state.zoom;
  return [cx, cy];
}

function tileDoClique(ev) {
  if (!state.render) return null;
  const [cx, cy] = canvasCoords(ev);
  const [tx, ty] = state.render.pixelParaTile(cx, cy);
  return { x: tx, y: ty };
}

function retanguloTiles(box) {
  const b = normalizarBox(box);
  if (!b || !state.render) return null;
  const [minTx, minTy, maxTx, maxTy] = b;
  const [x0, y0] = state.render.tileParaPixel(minTx, minTy);
  const [x1, y1] = state.render.tileParaPixel(maxTx + 1, maxTy + 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function desenharBox(ctx, box, cor, tracejado = false, alpha = 0.2) {
  const r = retanguloTiles(box);
  if (!r) return;
  ctx.save();
  ctx.strokeStyle = cor;
  ctx.fillStyle = cor;
  ctx.globalAlpha = alpha;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.globalAlpha = 1;
  ctx.lineWidth = tracejado ? 2 : 3;
  if (tracejado) ctx.setLineDash([6, 4]);
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  ctx.restore();
}

function desenharPonto(ctx, p, cor, rotulo) {
  if (!p || !state.render) return;
  const [x, y] = state.render.tileParaPixel(p.x, p.y);
  ctx.save();
  ctx.fillStyle = cor;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = 'bold 12px system-ui';
  ctx.fillStyle = '#fff';
  ctx.fillText(rotulo, x + 9, y + 4);
  ctx.restore();
}

function pintarChao(ctx, preview) {
  const chao = preview?.alcancado ?? preview?.grade;
  if (!chao || !state.render) return;
  const [minTx, minTy] = preview.box;
  ctx.save();
  for (let y = 0; y < preview.rows; y++) {
    for (let x = 0; x < preview.cols; x++) {
      if (chao[y]?.[x] !== 1) continue;
      const [x0, y0] = state.render.tileParaPixel(minTx + x, minTy + y);
      const [x1, y1] = state.render.tileParaPixel(minTx + x + 1, minTy + y + 1);
      ctx.fillStyle = 'rgba(80, 220, 120, 0.30)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  ctx.restore();
}

function desenharOverlay() {
  const ctx = $('#overlay').getContext('2d');
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const a = arena();

  if (state.mostrarCentro) {
    desenharBox(ctx, REF_CENTRO.box, '#7fd4ff', true);
    desenharPonto(ctx, REF_CENTRO.inicio, '#7fd4ff', 'C');
  }

  if (a.box) desenharBox(ctx, a.box, COR_ARENA, false);
  if (a.desafiante) desenharPonto(ctx, a.desafiante, '#66bb6a', 'A');
  if (a.lider) desenharPonto(ctx, a.lider, '#ef5350', 'B');

  if (state.arraste?.box) desenharBox(ctx, state.arraste.box, COR_ARENA, false, 0.35);

  if (state.modo === 'passagem' && state.walkPreview) pintarChao(ctx, state.walkPreview);
}

async function previewArena(opts = {}) {
  const a = arena();
  const box = normalizarBox(a.box);
  if (!box) return null;
  const chave = JSON.stringify({ mapa: a.mapa, box, desafiante: a.desafiante, passagens: a.passagens });
  if (!opts.forcar && state.previewCache?.chave === chave) return state.previewCache.dados;
  const dados = await api('/api/ginasios/preview', {
    mapa: a.mapa ?? state.mapa,
    box,
    desafiante: a.desafiante,
    passagens: a.passagens ?? {},
    incluirGrade: opts.grade === true || state.modo === 'passagem',
  });
  state.previewCache = { chave, dados };
  return dados;
}

async function atualizarWalkPreview() {
  const box = normalizarBox(arena().box);
  if (!box) {
    state.walkPreview = null;
    desenharOverlay();
    return;
  }
  try {
    state.walkPreview = await previewArena({ grade: true });
    desenharOverlay();
  } catch (e) {
    state.walkPreview = null;
    $('#hint').textContent = e.message;
  }
}

async function montarPainel() {
  const a = arena();
  const el = $('#painel');
  let meta = 'caixa: <b>—</b><br>arraste no mapa para marcar a arena';
  if (a.box) {
    try {
      const p = await previewArena();
      meta =
        `slug: <b>ginasio-duelo</b><br>` +
        `caixa: <b>${fmtBox(a.box)}</b> · ${p?.cols}×${p?.rows} tiles<br>` +
        `andável: <b>${p?.conectados ?? 0}</b> conectado(s)<br>` +
        `desafiante (A): <b>${a.desafiante ? `(${a.desafiante.x}, ${a.desafiante.y})` : '—'}</b><br>` +
        `líder (B): <b>${a.lider ? `(${a.lider.x}, ${a.lider.y})` : '—'}</b>` +
        `${!a.desafiante || !a.lider ? '<br><span class="avisos">marque os dois spawns</span>' : ''}`;
    } catch (e) {
      meta = `<span class="avisos">${e.message}</span>`;
    }
  }
  el.innerHTML = `<div class="cs-tier ativo" style="border-color:${COR_ARENA}">
    <h3><i style="background:${COR_ARENA}"></i>Arena do duelo</h3>
    <div class="meta">${meta}</div>
    <p class="meta" style="margin-top:10px">Salve e clique <b>publicar no jogo</b> (gera <code>ginasio-duelo</code> no walkgrids). Reinicie o servidor do jogo.</p>
  </div>`;
}

function aplicarBox(box) {
  const b = normalizarBox(box);
  if (!b) return;
  const a = arena();
  a.mapa = state.mapa;
  a.box = b;
  a.passagens = normalizarPassagensPorAndar(a.passagens, 7);
  invalidarPreview();
  montarPainel();
  desenharOverlay();
  agendarSalvar();
}

function aplicarPonto(tile, campo) {
  const a = arena();
  a[campo] = { x: tile.x, y: tile.y };
  a.mapa = state.mapa;
  invalidarPreview();
  montarPainel();
  desenharOverlay();
  agendarSalvar();
}

let salvarTimer = null;
function agendarSalvar() {
  clearTimeout(salvarTimer);
  salvarTimer = setTimeout(() => salvarDoc('salvo automaticamente'), 600);
}

async function salvarDoc(msg) {
  await api('/api/ginasios', { arena: arena(), mapaPadrao: state.mapa, regiaoLab: state.regiao });
  $('#save-msg').textContent = msg ?? 'salvo';
  setTimeout(() => { $('#save-msg').textContent = ''; }, 2500);
}

function ligarMapa() {
  const vp = $('#viewport');
  vp.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const f = ev.deltaY > 0 ? 0.9 : 1.1;
    state.zoom = Math.min(4, Math.max(0.35, state.zoom * f));
    aplicarTransform();
  }, { passive: false });

  vp.addEventListener('mousedown', (ev) => {
    if (ev.button === 1 || ev.button === 2 || ev.altKey) {
      state.panDrag = { x: ev.clientX, y: ev.clientY, px: state.pan.x, py: state.pan.y };
      vp.classList.add('pan', 'drag');
      return;
    }
    const tile = tileDoClique(ev);
    if (!tile) return;

    if (state.modo === 'desafiante') return aplicarPonto(tile, 'desafiante');
    if (state.modo === 'lider') return aplicarPonto(tile, 'lider');
    if (state.modo === 'passagem') {
      const box = normalizarBox(arena().box);
      if (!box) return;
      const lx = tile.x - box[0];
      const ly = tile.y - box[1];
      if (lx < 0 || ly < 0 || lx > box[2] - box[0] || ly > box[3] - box[1]) return;
      if (!state.walkPreview?.gradeBase) return;
      togglePassagemCelula(lx, ly, state.walkPreview.gradeBase);
      invalidarPreview();
      atualizarWalkPreview();
      montarPainel();
      agendarSalvar();
      return;
    }
    if (state.visao === 'corte' && ev.shiftKey) {
      state.visaoEm = tile;
      carregarMapa().then(() => desenharOverlay());
      return;
    }
    state.arraste = { tile0: tile, box: [tile.x, tile.y, tile.x, tile.y] };
    desenharOverlay();
  });

  window.addEventListener('mousemove', (ev) => {
    if (state.panDrag) {
      state.pan.x = state.panDrag.px + (ev.clientX - state.panDrag.x);
      state.pan.y = state.panDrag.py + (ev.clientY - state.panDrag.y);
      aplicarTransform();
      return;
    }
    if (!state.arraste) return;
    const tile = tileDoClique(ev);
    if (!tile) return;
    state.arraste.box = [state.arraste.tile0.x, state.arraste.tile0.y, tile.x, tile.y];
    desenharOverlay();
  });

  window.addEventListener('mouseup', () => {
    if (state.panDrag) {
      state.panDrag = null;
      vp.classList.remove('pan', 'drag');
    }
    if (state.arraste) {
      aplicarBox(state.arraste.box);
      state.arraste = null;
    }
  });

  vp.addEventListener('contextmenu', (ev) => ev.preventDefault());
}

function ligarModos() {
  $('#visoes').onclick = async (ev) => {
    const btn = ev.target.closest('[data-visao]');
    if (!btn) return;
    state.visao = btn.dataset.visao;
    for (const b of $('#visoes').querySelectorAll('button')) b.classList.toggle('on', b === btn);
    await carregarMapa();
    desenharOverlay();
  };

  $('#modos').onclick = async (ev) => {
    const btn = ev.target.closest('[data-modo]');
    if (!btn) return;
    state.modo = btn.dataset.modo;
    for (const b of $('#modos').querySelectorAll('button')) b.classList.toggle('on', b === btn);
    const hints = {
      box: 'Arraste no mapa para marcar a caixa da arena.',
      desafiante: 'Clique onde nasce quem DESAFIA (lado A — verde).',
      lider: 'Clique onde nasce o LÍDER (lado B — vermelho).',
      passagem: 'Clique nas tiles para abrir/fechar passagens (interior de prédio).',
    };
    $('#hint').textContent = hints[state.modo] ?? '';
    if (state.modo === 'passagem') await atualizarWalkPreview();
    else desenharOverlay();
  };

  $('#mostrar-centro').onchange = () => {
    state.mostrarCentro = $('#mostrar-centro').checked;
    desenharOverlay();
  };

  $('#btn-salvar').onclick = () => salvarDoc('salvo ✓').catch((e) => alert(e.message));
  $('#btn-publicar').onclick = () => publicarNoJogo().catch((e) => alert(e.message));
}

async function publicarNoJogo() {
  const msg = $('#save-msg');
  msg.textContent = 'salvando…';
  await salvarDoc('salvo');
  msg.textContent = 'gerando walkgrid…';
  const r = await api('/api/ginasios/publicar-walkgrids', {});
  msg.textContent = r.ok ? 'publicado ✓ — reinicie npm start no jogo' : (r.erro ?? 'falhou');
  setTimeout(() => { if ($('#save-msg').textContent.includes('publicado')) $('#save-msg').textContent = ''; }, 6000);
}

const TECLAS_MOV = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], W: [0, -1], s: [0, 1], S: [0, 1], a: [-1, 0], A: [-1, 0], d: [1, 0], D: [1, 0],
};

function aplicarPassagensNaGrade(gradeBase, passagensCamada) {
  if (!gradeBase?.length) return gradeBase;
  const grade = gradeBase.map((row) => [...row]);
  for (const [x, y] of passagensCamada?.abrir ?? []) {
    if (y >= 0 && y < grade.length && x >= 0 && x < grade[0].length) grade[y][x] = 1;
  }
  for (const [x, y] of passagensCamada?.fechar ?? []) {
    if (y >= 0 && y < grade.length && x >= 0 && x < grade[0].length) grade[y][x] = 0;
  }
  return grade;
}

function sincronizarGradeJogo(jogo) {
  if (!jogo.gradeBase) return;
  jogo.grade = aplicarPassagensNaGrade(jogo.gradeBase, camadaPassagens());
}

function escalaJogo(cols, rows) {
  const vp = $('#jogo-viewport');
  const alvoW = Math.max(320, vp.clientWidth - 40);
  const alvoH = Math.max(240, vp.clientHeight - 40);
  const natW = cols * 32 + 96;
  const natH = rows * 32 + 96;
  return Math.min(3, Math.max(1.5, Math.min(alvoW / natW, alvoH / natH)));
}

function tileLivre(jogo, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= jogo.cols || ty >= jogo.rows) return false;
  return jogo.alcancado?.[ty]?.[tx] === 1;
}

function mapaTileDoJogador(jogo) {
  const [minTx, minTy] = jogo.box;
  return { x: minTx + jogo.player.tx, y: minTy + jogo.player.ty };
}

function centralizarCameraJogo(jogo) {
  const vp = $('#jogo-viewport');
  const { x: mtx, y: mty } = mapaTileDoJogador(jogo);
  const [px, py] = jogo.render.tileParaPixel(mtx, mty);
  const panX = vp.clientWidth / 2 - px;
  const panY = vp.clientHeight / 2 - py;
  jogo.panX = panX;
  jogo.panY = panY;
  for (const id of ['jogo-mapa', 'jogo-debug', 'jogo-hero']) {
    $(`#${id}`).style.transform = `translate(${panX}px, ${panY}px)`;
  }
}

function tileLocalDoCliqueJogo(ev) {
  const jogo = state.jogo;
  if (!jogo?.render) return null;
  const vp = $('#jogo-viewport').getBoundingClientRect();
  const cx = ev.clientX - vp.left - (jogo.panX ?? 0);
  const cy = ev.clientY - vp.top - (jogo.panY ?? 0);
  const [mtx, mty] = jogo.render.pixelParaTile(cx, cy);
  const [minTx, minTy, maxTx, maxTy] = jogo.box;
  const lx = mtx - minTx;
  const ly = mty - minTy;
  if (lx < 0 || ly < 0 || lx > maxTx - minTx || ly > maxTy - minTy) return null;
  return { lx, ly, mtx, mty };
}

function corPassagemTile(livre, base, abrir, fechar, chave) {
  if (fechar.has(chave)) return 'rgba(180, 80, 255, 0.38)';
  if (abrir.has(chave) && livre) return 'rgba(80, 255, 120, 0.42)';
  if (abrir.has(chave) && !livre) return 'rgba(255, 180, 60, 0.55)';
  if (!livre) return 'rgba(255, 60, 60, 0.45)';
  return null;
}

function pintarChaoAlcancado(ctx, render, minTx, minTy, alcancado, cols, rows) {
  if (!alcancado || !render) return;
  ctx.save();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (alcancado[y]?.[x] !== 1) continue;
      const [x0, y0] = render.tileParaPixel(minTx + x, minTy + y);
      const [x1, y1] = render.tileParaPixel(minTx + x + 1, minTy + y + 1);
      ctx.fillStyle = 'rgba(80, 220, 120, 0.30)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = 'rgba(80, 220, 120, 0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    }
  }
  ctx.restore();
}

function desenharSpawnsNoCtx(ctx, render, a) {
  const draw = (p, cor, rotulo) => {
    if (!p || !render) return;
    const [x, y] = render.tileParaPixel(p.x, p.y);
    ctx.save();
    ctx.fillStyle = cor;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 12px system-ui';
    ctx.fillStyle = '#fff';
    ctx.fillText(rotulo, x + 9, y + 4);
    ctx.restore();
  };
  draw(a.desafiante, '#66bb6a', 'A');
  draw(a.lider, '#ef5350', 'B');
}

function desenharDebugJogo(jogo) {
  const ctx = $('#jogo-debug').getContext('2d');
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!jogo.render) return;
  const [minTx, minTy] = jogo.box;
  const a = arena();

  if (jogo.modoSpawn && jogo.alcancado) {
    pintarChaoAlcancado(ctx, jogo.render, minTx, minTy, jogo.alcancado, jogo.cols, jogo.rows);
    desenharSpawnsNoCtx(ctx, jogo.render, a);
    return;
  }

  if (jogo.modoPassagens) {
    const p = camadaPassagens();
    const abrir = new Set((p.abrir ?? []).map(([x, y]) => `${x},${y}`));
    const fechar = new Set((p.fechar ?? []).map(([x, y]) => `${x},${y}`));
    for (let y = 0; y < jogo.rows; y++) {
      for (let x = 0; x < jogo.cols; x++) {
        const livre = jogo.grade[y][x] === 1;
        const base = jogo.gradeBase?.[y]?.[x] === 1;
        const chave = `${x},${y}`;
        const cor = corPassagemTile(livre, base, abrir, fechar, chave);
        if (!cor) continue;
        const [x0, y0] = jogo.render.tileParaPixel(minTx + x, minTy + y);
        const [x1, y1] = jogo.render.tileParaPixel(minTx + x + 1, minTy + y + 1);
        ctx.fillStyle = cor;
        ctx.fillRect(x0 - 16, y0 - 16, x1 - x0, y1 - y0);
      }
    }
    desenharSpawnsNoCtx(ctx, jogo.render, a);
  }
}

async function recarregarGradeJogo(jogo) {
  const preview = await api('/api/ginasios/preview', {
    mapa: jogo.mapaSlug,
    box: jogo.box,
    desafiante: arena().desafiante,
    passagens: arena().passagens ?? {},
    incluirGrade: true,
  });
  if (!jogo.ativo || preview.erro) return;
  jogo.grade = preview.grade;
  jogo.gradeBase = preview.gradeBase;
  jogo.alcancado = preview.alcancado;
  jogo.groundZ = preview.groundZ ?? 7;
  jogo.andaveis = preview.andaveis ?? 0;
  jogo.conectados = preview.conectados ?? 0;
  sincronizarGradeJogo(jogo);
  desenharDebugJogo(jogo);
  desenharHeroJogo(jogo);
  invalidarPreview();
  montarPainel();
}

async function alternarPassagemJogo(local) {
  const jogo = state.jogo;
  if (!jogo?.gradeBase) return;
  togglePassagemCelula(local.lx, local.ly, jogo.gradeBase);
  sincronizarGradeJogo(jogo);
  desenharDebugJogo(jogo);
  await recarregarGradeJogo(jogo);
  agendarSalvar();
}

function chaoLivreNoJogo(jogo, lx, ly) {
  return jogo?.alcancado?.[ly]?.[lx] === 1;
}

async function marcarSpawnJogo(campo, local) {
  const jogo = state.jogo;
  if (!jogo?.alcancado) return;
  if (!chaoLivreNoJogo(jogo, local.lx, local.ly)) {
    $('#jogo-pos').textContent = 'aí é parede — clique no chão verde';
    return;
  }
  aplicarPonto({ x: local.mtx, y: local.mty }, campo);
  await recarregarGradeJogo(jogo);
  clearTimeout(salvarTimer);
  await salvarDoc('salvo automaticamente');
}

function atualizarOverlayJogo() {
  const jogo = state.jogo;
  if (!jogo) return;
  const dbg = $('#jogo-debug');
  dbg.classList.toggle('editavel', !!jogo.modoPassagens || !!jogo.modoSpawn);
  dbg.classList.toggle('bonecos', !!jogo.modoSpawn);
  $('#jogo-viewport').style.cursor = jogo.modoSpawn ? 'crosshair' : jogo.modoPassagens ? 'cell' : '';
}

function definirModoPassagensJogo(ativo) {
  const jogo = state.jogo;
  if (!jogo) return;
  if (ativo) jogo.modoSpawn = null;
  jogo.modoPassagens = ativo;
  $('#jogo-passagens').classList.toggle('on', ativo);
  $('#jogo-spawn-a')?.classList.remove('on');
  $('#jogo-spawn-b')?.classList.remove('on');
  atualizarOverlayJogo();
  desenharDebugJogo(jogo);
}

function definirModoSpawnJogo(campo) {
  const jogo = state.jogo;
  if (!jogo) return;
  const ativo = jogo.modoSpawn === campo ? null : campo;
  jogo.modoSpawn = ativo;
  jogo.modoPassagens = false;
  $('#jogo-passagens')?.classList.remove('on');
  $('#jogo-spawn-a').classList.toggle('on', ativo === 'desafiante');
  $('#jogo-spawn-b').classList.toggle('on', ativo === 'lider');
  atualizarOverlayJogo();
  desenharDebugJogo(jogo);
}

function desenharHeroJogo(jogo) {
  const ctx = $('#jogo-hero').getContext('2d');
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const { x: mtx, y: mty } = mapaTileDoJogador(jogo);
  const [px, py] = jogo.render.tileParaPixel(mtx, mty);
  const escala = jogo.render.escala ?? 1;
  const fase = jogo.heroPassoMs
    ? Math.min(1, (performance.now() - jogo.heroPassoEm) / jogo.heroPassoMs)
    : 0;
  const ok = jogo.heroSprite && desenharHero(ctx, jogo.heroSprite, px, py, {
    dir: jogo.heroDir ?? 3,
    andando: jogo.heroAndando,
    fase,
    escala,
  });
  if (!ok) {
    ctx.save();
    ctx.fillStyle = '#ff5252';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py - 4, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  const a = arena();
  let pos = `tile (${mtx}, ${mty}) · conectados ${jogo.conectados}`;
  if (jogo.modoSpawn === 'desafiante') pos += ' · clique para spawn A';
  else if (jogo.modoSpawn === 'lider') pos += ' · clique para spawn B';
  else pos += ` · A ${a.desafiante ? '✓' : '—'} · B ${a.lider ? '✓' : '—'}`;
  $('#jogo-pos').textContent = pos;
}

async function renderizarMapaJogo(jogo, visaoEm) {
  const alvo = visaoEm ?? mapaTileDoJogador(jogo);
  jogo.renderToken = (jogo.renderToken ?? 0) + 1;
  const token = jogo.renderToken;
  const render = await jogo.renderMod.renderMapa(jogo.mapaSlug, {
    escala: jogo.escala,
    regiao: jogo.box,
    visao: 'interior',
    visaoEm: alvo,
    primeiroVisivelFixo: jogo.groundZ ?? 7,
  });
  if (!jogo.ativo || token !== jogo.renderToken) return;
  jogo.render = render;
  jogo.visaoEm = { ...alvo };
  for (const id of ['jogo-mapa', 'jogo-debug', 'jogo-hero']) {
    const c = $(`#${id}`);
    c.width = render.canvas.width;
    c.height = render.canvas.height;
  }
  $('#jogo-mapa').getContext('2d').drawImage(render.canvas, 0, 0);
  desenharDebugJogo(jogo);
  centralizarCameraJogo(jogo);
  desenharHeroJogo(jogo);
}

function solicitarRenderMapaJogo(jogo) {
  const alvo = mapaTileDoJogador(jogo);
  if (jogo.visaoEm?.x === alvo.x && jogo.visaoEm?.y === alvo.y) return;
  jogo.renderPendente = { ...alvo };
  if (jogo.renderizando) return;
  jogo.renderizando = true;
  (async () => {
    while (jogo.ativo && jogo.renderPendente) {
      const p = jogo.renderPendente;
      jogo.renderPendente = null;
      await renderizarMapaJogo(jogo, p);
    }
    jogo.renderizando = false;
  })();
}

function tickJogo() {
  const jogo = state.jogo;
  if (!jogo?.ativo) return;
  const agora = performance.now();
  let moveu = false;
  if (agora - jogo.ultimoPasso >= 120) {
    for (const [tecla, [dx, dy]] of Object.entries(TECLAS_MOV)) {
      if (!jogo.teclas.has(tecla)) continue;
      const nx = jogo.player.tx + dx;
      const ny = jogo.player.ty + dy;
      if (tileLivre(jogo, nx, ny)) {
        jogo.player.tx = nx;
        jogo.player.ty = ny;
        jogo.heroDir = dirDeMovimento(dx, dy, jogo.heroDir ?? 3);
        jogo.heroPassoEm = agora;
        moveu = true;
        solicitarRenderMapaJogo(jogo);
      }
      jogo.ultimoPasso = agora;
      break;
    }
  }
  jogo.heroAndando = moveu || (
    jogo.teclas.size > 0 && agora - (jogo.heroPassoEm ?? 0) < (jogo.heroPassoMs ?? 280)
  );
  centralizarCameraJogo(jogo);
  desenharHeroJogo(jogo);
  jogo.raf = requestAnimationFrame(tickJogo);
}

let saindoJogo = false;

async function pararJogo() {
  if (saindoJogo) return;
  const jogo = state.jogo;
  if (!jogo) return;
  saindoJogo = true;
  try {
    jogo.ativo = false;
    if (jogo.raf) cancelAnimationFrame(jogo.raf);
    definirModoPassagensJogo(false);
    state.jogo = null;
    $('#cs-jogo').classList.add('hidden');
    $('#cs-jogo').setAttribute('aria-hidden', 'true');
    await salvarDoc('salvo ao sair');
    invalidarPreview();
    await montarPainel();
    if (state.modo === 'passagem') await atualizarWalkPreview();
    else desenharOverlay();
  } catch { /* msg no #save-msg */ }
  finally {
    saindoJogo = false;
  }
}

async function entrarArena() {
  if (state.jogo?.ativo) return;
  const a = arena();
  const box = normalizarBox(a.box);
  if (!box) {
    alert('Marque a caixa da arena no mapa antes de entrar.');
    return;
  }

  const btn = $('#btn-entrar');
  btn.disabled = true;
  $('#cs-jogo').classList.remove('hidden');
  $('#cs-jogo').setAttribute('aria-hidden', 'false');
  $('#jogo-titulo').textContent = `ginasio-duelo · ${a.mapa ?? state.mapa}`;
  $('#jogo-pos').textContent = 'calculando walkgrid…';

  try {
    const preview = await api('/api/ginasios/preview', {
      mapa: a.mapa ?? state.mapa,
      box,
      desafiante: a.desafiante,
      passagens: a.passagens ?? {},
      incluirGrade: true,
    });
    if (preview.erro) throw new Error(preview.erro);
    if (!preview.grade?.length) throw new Error('walkgrid vazio — marque a caixa de novo');
    a.passagens = preview.passagens ?? normalizarPassagensPorAndar(a.passagens, preview.groundZ);

    const escala = escalaJogo(preview.cols, preview.rows);
    $('#jogo-pos').textContent = 'carregando personagem…';
    const [heroSprite, mod] = await Promise.all([
      carregarOutfit(159),
      import('/mapview.mjs'),
    ]);

    const [minTx, minTy] = box;
    const inicio = a.desafiante ?? { x: minTx + Math.floor(preview.cols / 2), y: minTy + Math.floor(preview.rows / 2) };
    const jogo = {
      ativo: true,
      mapaSlug: a.mapa ?? state.mapa,
      escala,
      renderMod: mod,
      render: null,
      visaoEm: null,
      renderToken: 0,
      renderizando: false,
      renderPendente: null,
      heroSprite,
      heroDir: 3,
      heroAndando: false,
      heroPassoEm: 0,
      heroPassoMs: 280,
      grade: preview.grade,
      gradeBase: preview.gradeBase,
      groundZ: preview.groundZ ?? 7,
      modoPassagens: false,
      modoSpawn: null,
      alcancado: preview.alcancado,
      cols: preview.cols,
      rows: preview.rows,
      box,
      andaveis: preview.andaveis ?? 0,
      conectados: preview.conectados ?? 0,
      player: { tx: inicio.x - minTx, ty: inicio.y - minTy },
      teclas: new Set(),
      ultimoPasso: 0,
      raf: null,
    };
    state.jogo = jogo;
    sincronizarGradeJogo(jogo);
    await renderizarMapaJogo(jogo, inicio);
    $('#jogo-viewport').focus();
    jogo.raf = requestAnimationFrame(tickJogo);
  } catch (e) {
    pararJogo();
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}

function ligarJogo() {
  $('#btn-entrar').onclick = () => entrarArena();
  $('#jogo-sair').onclick = () => pararJogo();
  $('#jogo-passagens').onclick = () => {
    if (!state.jogo?.ativo) return;
    definirModoPassagensJogo(!state.jogo.modoPassagens);
  };
  $('#jogo-spawn-a').onclick = () => {
    if (!state.jogo?.ativo) return;
    definirModoSpawnJogo('desafiante');
  };
  $('#jogo-spawn-b').onclick = () => {
    if (!state.jogo?.ativo) return;
    definirModoSpawnJogo('lider');
  };

  $('#jogo-debug').addEventListener('click', (ev) => {
    const jogo = state.jogo;
    if (!jogo?.ativo) return;
    if (!jogo.modoPassagens && !jogo.modoSpawn) return;
    ev.stopPropagation();
    const local = tileLocalDoCliqueJogo(ev);
    if (!local) return;
    if (jogo.modoSpawn === 'desafiante') marcarSpawnJogo('desafiante', local);
    else if (jogo.modoSpawn === 'lider') marcarSpawnJogo('lider', local);
    else alternarPassagemJogo(local);
  });

  window.addEventListener('keydown', (ev) => {
    if (!state.jogo?.ativo) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (state.jogo.modoPassagens) {
        definirModoPassagensJogo(false);
        return;
      }
      if (state.jogo.modoSpawn) {
        definirModoSpawnJogo(null);
        return;
      }
      pararJogo();
      return;
    }
    if (TECLAS_MOV[ev.key]) {
      ev.preventDefault();
      state.jogo.teclas.add(ev.key);
    }
  });

  window.addEventListener('keyup', (ev) => {
    state.jogo?.teclas.delete(ev.key);
  });

  window.addEventListener('blur', () => {
    state.jogo?.teclas.clear();
  });
}

async function iniciar() {
  const dados = await api('/api/ginasios');
  state.doc = dados;
  state.mapa = dados.mapaPadrao ?? 'cerulean';
  state.regiao = dados.regiaoLab ?? [-48, -34, 38, 22];
  if (dados.referencia?.centro) Object.assign(REF_CENTRO, dados.referencia.centro);
  arena().passagens = normalizarPassagensPorAndar(arena().passagens, 7);

  const sel = $('#mapa-sel');
  sel.innerHTML = (dados.mapasCidades ?? ['cerulean']).map(
    (m) => `<option value="${m}"${m === state.mapa ? ' selected' : ''}>${m}</option>`,
  ).join('');
  sel.onchange = async () => {
    state.mapa = sel.value;
    arena().mapa = state.mapa;
    await carregarMapa();
    await montarPainel();
  };

  ligarMapa();
  ligarModos();
  ligarJogo();
  await carregarMapa();
  await montarPainel();
}

iniciar().catch((e) => {
  $('#mapa-status').textContent = e.message;
  alert(e.message);
});
