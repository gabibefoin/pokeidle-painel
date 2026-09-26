/** Lab de casas — marca caixas walkáveis nos mapas de cidade (Cerulean). */
import { carregarOutfit, desenharHero, dirDeMovimento } from './casas-hero.mjs';

const $ = (s) => document.querySelector(s);

const state = {
  doc: null,
  tierMeta: [],
  tierAtivo: 'comum',
  modo: 'box',
  mapa: 'cerulean',
  regiao: [-48, -34, 38, 22],
  render: null,
  pan: { x: 40, y: 40 },
  zoom: 1,
  arraste: null,
  panDrag: null,
  previewCache: {},
  mostrarCentro: true,
  visao: 'rua',
  visaoEm: null,
  jogo: null,
  walkPreview: null,
  andarPassagem: null,
};

const REF_CENTRO = { box: [-40, -28, 29, 17], inicio: { x: -3, y: -6 } };

async function api(rota, corpo) {
  const r = await fetch(rota, {
    method: corpo ? 'POST' : 'GET',
    headers: corpo ? { 'content-type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro ?? 'falhou');
  return j;
}

function normalizarBox(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [a, b, c, d] = box.map(Number);
  if (![a, b, c, d].every(Number.isFinite)) return null;
  return [
    Math.min(a, c),
    Math.min(b, d),
    Math.max(a, c),
    Math.max(b, d),
  ];
}

function tierAtual() {
  return state.doc?.tiers?.[state.tierAtivo] ?? {};
}

function metaDoTier(id) {
  return state.tierMeta.find((t) => t.id === id) ?? { cor: '#888' };
}

function fmtBox(box) {
  const b = normalizarBox(box);
  return b ? `[${b.join(', ')}]` : '—';
}

function normalizarPassagensPorAndar(passagens, groundZ = 7) {
  if (!passagens) return { [String(groundZ)]: { abrir: [], fechar: [] } };

  const chavesAndar = Object.keys(passagens).filter((k) => /^\d+$/.test(k));

  if (chavesAndar.length > 0) {
    const out = {};
    for (const k of chavesAndar) {
      const v = passagens[k];
      out[k] = {
        abrir: [...(v?.abrir ?? [])],
        fechar: [...(v?.fechar ?? [])],
      };
    }
    if (!out[String(groundZ)]) out[String(groundZ)] = { abrir: [], fechar: [] };
    return out;
  }

  if (Array.isArray(passagens.abrir) || Array.isArray(passagens.fechar)) {
    return {
      [String(groundZ)]: {
        abrir: [...(passagens.abrir ?? [])],
        fechar: [...(passagens.fechar ?? [])],
      },
    };
  }

  return { [String(groundZ)]: { abrir: [], fechar: [] } };
}

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
  const tier = state.doc?.tiers?.[jogo.tierId];
  if (!tier || !jogo.gradeBase) return;
  const p = camadaPassagens(tier, jogo.andar ?? jogo.groundZ ?? 7, jogo.groundZ);
  jogo.grade = aplicarPassagensNaGrade(jogo.gradeBase, p);
}

function groundZTier(tier) {
  return tier?._groundZ ?? state.walkPreview?.groundZ ?? 7;
}

function camadaPassagens(tier, andar, groundZ = groundZTier(tier)) {
  tier.passagens = normalizarPassagensPorAndar(tier.passagens, groundZ);
  const k = String(andar);
  if (!tier.passagens[k]) tier.passagens[k] = { abrir: [], fechar: [] };
  return tier.passagens[k];
}

function togglePassagemCelula(tier, lx, ly, gradeBase, andar) {
  const gz = groundZTier(tier);
  const p = camadaPassagens(tier, andar, gz);
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

function idxPassagem(lista, x, y) {
  return lista.findIndex((p) => p[0] === x && p[1] === y);
}

function andarPassagemAtivo(tier) {
  const gz = groundZTier(tier);
  const andares = state.walkPreview?.andares ?? [gz, gz - 1].filter((z, i, a) => a.indexOf(z) === i);
  if (state.andarPassagem != null && andares.includes(state.andarPassagem)) {
    return state.andarPassagem;
  }
  return gz;
}

function montarSeletorAndares(tier) {
  const pai = $('#andares-passagem');
  const andares = state.walkPreview?.andares ?? [groundZTier(tier)];
  const ativo = andarPassagemAtivo(tier);
  state.andarPassagem = ativo;
  if (andares.length <= 1) {
    pai.hidden = true;
    pai.innerHTML = '';
    return;
  }
  pai.hidden = false;
  pai.innerHTML = andares.map((z) => {
    const rot = rotuloAndar(groundZTier(tier), z);
    return `<button type="button" data-andar="${z}" class="${z === ativo ? 'on' : ''}">${rot}</button>`;
  }).join('');
}

function resumoPassagens(tier) {
  const gz = groundZTier(tier);
  const todas = normalizarPassagensPorAndar(tier.passagens, gz);
  return Object.entries(todas)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([z, p]) => {
      const rot = rotuloAndar(gz, Number(z));
      const n = (p.abrir?.length ?? 0) + (p.fechar?.length ?? 0);
      return n ? `${rot}: ${p.abrir?.length ?? 0}+/${p.fechar?.length ?? 0}−` : null;
    })
    .filter(Boolean)
    .join(' · ') || '—';
}

function tileLocalNaBox(tile, box) {
  const b = normalizarBox(box);
  if (!b || !tile) return null;
  const [minTx, minTy, maxTx, maxTy] = b;
  const lx = tile.x - minTx;
  const ly = tile.y - minTy;
  if (lx < 0 || ly < 0 || lx > maxTx - minTx || ly > maxTy - minTy) return null;
  return { lx, ly, minTx, minTy };
}

function invalidarPreview(id = state.tierAtivo) {
  delete state.previewCache[id];
}

function ensureEscadas(tier) {
  if (!tier.escadas) tier.escadas = { subir: [], descer: [] };
  if (!Array.isArray(tier.escadas.subir)) tier.escadas.subir = [];
  if (!Array.isArray(tier.escadas.descer)) tier.escadas.descer = [];
  return tier.escadas;
}

function toggleEscadaCelula(tier, lx, ly, tipo) {
  const e = ensureEscadas(tier);
  const outro = tipo === 'subir' ? 'descer' : 'subir';
  const i = idxPassagem(e[tipo], lx, ly);
  const j = idxPassagem(e[outro], lx, ly);
  if (j >= 0) e[outro].splice(j, 1);
  if (i >= 0) e[tipo].splice(i, 1);
  else e[tipo].push([lx, ly]);
}

function temEscada(tier, tipo, lx, ly) {
  return idxPassagem(tier?.escadas?.[tipo] ?? [], lx, ly) >= 0;
}

// ------------------------------------------------------------------ bonecos
//
// Onde ficam os bonecos de treino da ACADEMIA, em coordenada local à caixa (a mesma
// convenção das passagens e das escadas).
//
// A ORDEM importa: o jogo usa os N primeiros da lista, e N é quantos bonecos aquela raridade
// tem — hoje 1 em quatro delas e 2 na Lendária. Por isso o overlay numera cada um.
//
// O teto é POR TIER e vem do servidor (`tierMeta`, que lê `shared/casas.mjs`), não de um 5
// escrito aqui: marcar um boneco que o jogo nunca vai levantar é trabalho jogado fora, e
// descobrir isso só depois de rodar o build e entrar na casa é caro demais para um lab.
//
// Quando o campo NÃO vem (`tierMeta` ainda não chegou, ou o servidor do lab é anterior a ele)
// o teto é Infinity, e isso é deliberado: o teto aqui é um AVISO — quem corta a lista de
// verdade é o jogo, no `abrirCasa` — e os dois erros possíveis não custam o mesmo. Chutar
// alto deixa marcar um alvo a mais, que o jogo ignora; chutar baixo recusa em silêncio o 2º
// boneco de uma Lendária legítima, e o usuário fica clicando num mapa que não responde.

const maxBonecos = (tierId) =>
  state.tierMeta.find((t) => t.id === tierId)?.bonecos ?? Infinity;

/** O teto para MOSTRAR. "?" enquanto o `tierMeta` não chegou — nunca um número inventado. */
const tetoTexto = (tierId) => {
  const n = maxBonecos(tierId);
  return Number.isFinite(n) ? String(n) : '?';
};

function ensureBonecos(tier) {
  if (!Array.isArray(tier.bonecos)) tier.bonecos = [];
  return tier.bonecos;
}

function toggleBonecoCelula(tier, tierId, lx, ly) {
  const arr = ensureBonecos(tier);
  const i = idxPassagem(arr, lx, ly);
  if (i >= 0) return arr.splice(i, 1);
  if (arr.length >= maxBonecos(tierId)) return null; // o teto é o da raridade
  arr.push([lx, ly]);
  return null;
}

async function alternarBonecoEditor(tile) {
  const tier = tierAtual();
  const box = normalizarBox(tier?.box);
  const local = tileLocalNaBox(tile, box);
  if (!local) return;

  const jaTem = idxPassagem(ensureBonecos(tier), local.lx, local.ly) >= 0;
  // TIRAR sempre pode; PÔR só em chão andável.
  //
  // O `build-walkgrids` grava o boneco com `fixo: true`, ou seja, sem encaixe na tile livre
  // mais próxima — ele fica exatamente onde foi marcado. Um boneco dentro da parede vira um
  // sprite atravessado no cenário com um pokémon parado do lado de fora tentando alcançá-lo,
  // e isso só apareceria depois de rodar o build e entrar no jogo. Recusar aqui é o único
  // lugar em que o erro ainda é barato.
  if (!jaTem && !chaoLivreNaPrevia(local.lx, local.ly)) {
    $('#hint').innerHTML = '<b>Aí é parede.</b> Ponha o boneco no chão pintado de verde — '
      + 'é onde o pokémon consegue chegar.';
    return;
  }
  const teto = maxBonecos(state.tierAtivo);
  if (!jaTem && (tier.bonecos?.length ?? 0) >= teto) {
    $('#hint').innerHTML = `<b>Já são ${teto} boneco(s)</b>, que é o teto desta raridade. `
      + 'Clique num deles para tirar antes de pôr outro.';
    return;
  }

  toggleBonecoCelula(tier, state.tierAtivo, local.lx, local.ly);
  invalidarPreview(state.tierAtivo);
  desenharOverlay();
  await montarTiers();
  clearTimeout(salvarAutoTimer);
  await salvarDocCasas('salvo automaticamente');
}

/**
 * Alvos numerados — a mesma ordem em que o jogo levanta os bonecos da casa.
 *
 * Do `usa`-ésimo em diante o alvo sai APAGADO e riscado: são pontos que ficam gravados no
 * editor e que o jogo ignora (ele corta a lista no que a raridade usa). Sem essa distinção,
 * uma casa com quatro alvos idênticos na tela e um boneco só lá dentro é indistinguível de
 * um bug — e é justamente o estado em que a mudança da escada de raridades deixou as plantas
 * antigas.
 */
function desenharBonecosNoCtx(ctx, render, minTx, minTy, bonecos, usa = Infinity) {
  if (!render || !Array.isArray(bonecos)) return;
  bonecos.forEach(([lx, ly], i) => {
    const [x, y] = render.tileParaPixel(minTx + lx, minTy + ly);
    const sobra = i >= usa;
    ctx.save();
    ctx.globalAlpha = sobra ? 0.45 : 1;
    ctx.fillStyle = sobra ? '#6b6b6b' : '#b98a4d';
    ctx.strokeStyle = sobra ? '#c62828' : '#2a1a0c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y - 4, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (sobra) {
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 11);
      ctx.lineTo(x + 7, y + 3);
      ctx.stroke();
    } else {
      ctx.font = 'bold 11px system-ui';
      ctx.fillStyle = '#1a1008';
      ctx.fillText(String(i + 1), x - 3, y);
    }
    ctx.restore();
  });
}

function desenharBonecos(ctx, tier) {
  const box = normalizarBox(tier?.box);
  if (!box || !state.render) return;
  desenharBonecosNoCtx(ctx, state.render, box[0], box[1], tier.bonecos, maxBonecos(state.tierAtivo));
}

function rotuloAndar(groundZ, andar) {
  if (andar >= groundZ) return 'térreo';
  const n = groundZ - andar;
  return n === 1 ? '1º andar' : `${n}º andar`;
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

function desenharOverlay() {
  const ctx = $('#overlay').getContext('2d');
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (state.mostrarCentro) {
    desenharBox(ctx, REF_CENTRO.box, '#7fd4ff', true);
    desenharPonto(ctx, REF_CENTRO.inicio, '#7fd4ff', 'C');
  }

  for (const t of state.tierMeta) {
    const tier = state.doc?.tiers?.[t.id];
    if (!tier?.box) continue;
    const ativo = t.id === state.tierAtivo;
    desenharBox(ctx, tier.box, t.cor, !ativo);
    if (tier.inicio) desenharPonto(ctx, tier.inicio, t.cor, 'S');
    if (tier.porta) desenharPonto(ctx, tier.porta, t.cor, 'P');
    if (t.id === state.tierAtivo || state.modo.startsWith('escada')) {
      desenharEscadas(ctx, tier, t.cor);
    }
    if (ativo || state.modo === 'boneco') desenharBonecos(ctx, tier);
  }

  if (state.arraste?.box) {
    desenharBox(ctx, state.arraste.box, metaDoTier(state.tierAtivo).cor, false, 0.35);
  }

  if (state.modo === 'passagem' && state.walkPreview) {
    const tier = tierAtual();
    // O chão verde por baixo das cores de passagem é o que o jogo grava (alcancado).
    desenharChaoDaCasa(ctx, state.walkPreview);
    desenharWalkgrid(ctx, state.walkPreview, camadaPassagens(tier, andarPassagemAtivo(tier)));
  }
  // No modo BONECO a pintura é outra, porque a pergunta é outra.
  //
  // Em `passagem` o que importa são as CORREÇÕES (o que foi aberto, o que foi fechado, o que
  // ainda bloqueia) — por isso lá o chão normal fica sem cor. Aqui a pergunta é "onde é chão?",
  // e a resposta precisa ser a coisa mais visível da tela: de cima, com o telhado de Cerulean
  // no caminho, o interior da casa é invisível e marcar boneco vira chute.
  if (state.modo === 'boneco' && state.walkPreview) desenharChaoDaCasa(ctx, state.walkPreview);
}

/**
 * O chão andável da casa, pintado de verde por cima do mapa.
 *
 * É o "ver por dentro" do editor: vem do mesmo `/api/casas/preview` que o build usa, já com as
 * passagens aplicadas, então o que aparece verde aqui é EXATAMENTE onde o pokémon vai poder
 * andar no jogo.
 *
 * Usa `alcancado`, e não `grade`: aquela é a máscara do que está LIGADO ao spawn, que é o que
 * o `build-walkgrids` guarda. `grade` inclui pedaço solto (telhado, cômodo atrás de parede,
 * calçada do vizinho que entrou na caixa) — na casa Mítica são 226 tiles contra 77, ou seja,
 * dois terços do verde seriam convite para marcar boneco onde o jogo não tem chão.
 */
function desenharChaoDaCasa(ctx, preview) {
  const chao = preview?.alcancado ?? preview?.grade;
  if (!chao || !state.render) return;
  pintarChaoAlcancado(ctx, state.render, preview.box[0], preview.box[1], chao, preview.cols, preview.rows);
}

/**
 * O pokémon consegue CHEGAR nesta tile? É o que decide se dá para pôr boneco nela.
 *
 * Mesma máscara que o verde pinta (ver `desenharChaoDaCasa`) — o que está na tela e o que o
 * clique aceita têm de ser a mesma coisa, senão o editor recusa um tile que ele mesmo pintou.
 */
function chaoLivreNaPrevia(lx, ly) {
  const g = state.walkPreview?.alcancado ?? state.walkPreview?.grade;
  return !!g && g[ly]?.[lx] === 1;
}

function chaoLivreNoJogo(jogo, lx, ly) {
  return jogo?.alcancado?.[ly]?.[lx] === 1;
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

function corPassagemTile(livre, base, abrir, fechar, chave) {
  if (fechar.has(chave)) return 'rgba(180, 80, 255, 0.38)';
  if (abrir.has(chave) && livre) return 'rgba(80, 255, 120, 0.42)';
  if (abrir.has(chave) && !livre) return 'rgba(255, 180, 60, 0.55)';
  if (!livre) return 'rgba(255, 60, 60, 0.45)';
  return null;
}

function desenharWalkgrid(ctx, preview, passagensCamada) {
  if (!preview?.grade || !state.render) return;
  const box = preview.box;
  const [minTx, minTy] = box;
  const p = passagensCamada ?? { abrir: [], fechar: [] };
  const abrir = new Set((p.abrir ?? []).map(([x, y]) => `${x},${y}`));
  const fechar = new Set((p.fechar ?? []).map(([x, y]) => `${x},${y}`));

  for (let y = 0; y < preview.rows; y++) {
    for (let x = 0; x < preview.cols; x++) {
      const livre = preview.grade[y][x] === 1;
      const base = preview.gradeBase?.[y]?.[x] === 1;
      const chave = `${x},${y}`;
      const cor = corPassagemTile(livre, base, abrir, fechar, chave);
      if (!cor) continue;
      const [x0, y0] = state.render.tileParaPixel(minTx + x, minTy + y);
      const [x1, y1] = state.render.tileParaPixel(minTx + x + 1, minTy + y + 1);
      ctx.fillStyle = cor;
      ctx.fillRect(x0 - 16, y0 - 16, x1 - x0, y1 - y0);
    }
  }
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
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = 'bold 11px system-ui';
  ctx.fillStyle = '#fff';
  ctx.fillText(rotulo, x + 8, y + 4);
  ctx.restore();
}

function desenharEscadas(ctx, tier, cor) {
  const box = normalizarBox(tier?.box);
  if (!box || !state.render || !tier.escadas) return;
  const [minTx, minTy] = box;
  const marcar = (lista, rotulo, fill) => {
    for (const [lx, ly] of lista ?? []) {
      const [x, y] = state.render.tileParaPixel(minTx + lx, minTy + ly);
      ctx.save();
      ctx.fillStyle = fill;
      ctx.strokeStyle = cor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y - 4, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = 'bold 10px system-ui';
      ctx.fillStyle = '#111';
      ctx.fillText(rotulo, x - 4, y);
      ctx.restore();
    }
  };
  marcar(tier.escadas.subir, '↑', '#ffe082');
  marcar(tier.escadas.descer, '↓', '#80deea');
}

async function previewTier(id, opts) {
  const tier = state.doc?.tiers?.[id];
  const box = normalizarBox(tier?.box);
  if (!box) {
    delete state.previewCache[id];
    return null;
  }
  const chave = JSON.stringify({
    mapa: tier.mapa,
    box,
    inicio: tier.inicio,
    passagens: tier.passagens ?? {},
    escadas: tier.escadas ?? {},
    andar: opts?.andar ?? andarPassagemAtivo(tier),
  });
  if (state.previewCache[id]?.chave === chave) return state.previewCache[id].dados;
  const dados = await api('/api/casas/preview', {
    mapa: tier.mapa ?? state.mapa,
    box,
    inicio: tier.inicio,
    passagens: tier.passagens ?? {},
    escadas: tier.escadas ?? {},
    andar: opts?.andar ?? andarPassagemAtivo(tier),
    incluirGrade: opts?.grade === true || state.modo === 'passagem' || state.modo === 'boneco',
  });
  state.previewCache[id] = { chave, dados };
  if (dados.groundZ) tier._groundZ = dados.groundZ;
  return dados;
}

async function atualizarWalkPreviewEditor() {
  const tier = tierAtual();
  const box = normalizarBox(tier?.box);
  if (!box) {
    state.walkPreview = null;
    desenharOverlay();
    return;
  }
  try {
    // No modo BONECO a prévia é sempre do TÉRREO, e o seletor de andar some.
    //
    // O jogo só instancia o andar do chão da casa (`game/campo.mjs` é de um andar só — ver a
    // nota em `build-walkgrids.mjs`), então deixar escolher o 1º andar aqui ofereceria marcar
    // bonecos num lugar que o build ignora em silêncio. O 2º andar continua editável em
    // `passagens`, onde ele de fato guarda dado para quando a escada existir.
    const soTerreo = state.modo === 'boneco';
    const andar = soTerreo ? groundZTier(tier) : andarPassagemAtivo(tier);
    state.walkPreview = await previewTier(state.tierAtivo, { grade: true, andar });
    if (soTerreo) {
      $('#andares-passagem').hidden = true;
      state.andarPassagem = null;
    } else {
      montarSeletorAndares(tierAtual());
    }
    desenharOverlay();
  } catch (e) {
    state.walkPreview = null;
    $('#hint').textContent = e.message;
  }
}

async function alternarEscadaEditor(tile, tipo) {
  const tier = tierAtual();
  const box = normalizarBox(tier?.box);
  const local = tileLocalNaBox(tile, box);
  if (!local) return;
  toggleEscadaCelula(tier, local.lx, local.ly, tipo);
  invalidarPreview(state.tierAtivo);
  desenharOverlay();
  await montarTiers();
  clearTimeout(salvarAutoTimer);
  await salvarDocCasas('salvo automaticamente');
}

async function alternarPassagemEditor(tile) {
  const tier = tierAtual();
  const box = normalizarBox(tier?.box);
  const local = tileLocalNaBox(tile, box);
  if (!local || !state.walkPreview?.gradeBase) return;
  const andar = andarPassagemAtivo(tier);
  togglePassagemCelula(tier, local.lx, local.ly, state.walkPreview.gradeBase, andar);
  invalidarPreview(state.tierAtivo);
  await Promise.all([atualizarWalkPreviewEditor(), montarTiers()]);
  agendarSalvarAuto();
}

async function montarTiers() {
  const pai = $('#tiers');
  pai.innerHTML = '';
  for (const t of state.tierMeta) {
    const tier = state.doc.tiers[t.id] ?? {};
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `cs-tier${t.id === state.tierAtivo ? ' ativo' : ''}`;
    el.dataset.id = t.id;
    el.innerHTML = `<h3><i style="background:${t.cor}"></i>${tier.rotulo ?? t.rotulo}</h3>
      <div class="meta" data-meta="${t.id}">calculando…</div>`;
    el.onclick = () => {
      state.tierAtivo = t.id;
      montarTiers();
      // Trocar de casa com a prévia de chão na tela precisa recarregá-la: sem isto, o verde
      // continuaria desenhando o interior da casa ANTERIOR sobre a caixa da nova.
      if (state.modo === 'passagem' || state.modo === 'boneco') atualizarWalkPreviewEditor();
      else desenharOverlay();
    };
    pai.appendChild(el);
  }

  await Promise.all(state.tierMeta.map(async (t) => {
    const tier = state.doc.tiers[t.id] ?? {};
    const meta = $(`[data-meta="${t.id}"]`);
    if (!meta) return;
    if (!tier.box) {
      meta.innerHTML = 'caixa: <b>—</b><br>defina arrastando no mapa';
      return;
    }
    try {
      const p = await previewTier(t.id);
      const avisos = (p?.avisos ?? []).map((a) => `<div class="avisos">${a}</div>`).join('');
      meta.innerHTML =
        `caixa: <b>${fmtBox(tier.box)}</b> · ${p?.cols}×${p?.rows} tiles<br>` +
        `andável: <b>${p?.conectados ?? 0}</b> conectado(s) · total ${p?.andaveis ?? 0}<br>` +
        `passagens: <b>${resumoPassagens(tier)}</b><br>` +
        `escadas: <b>${tier.escadas?.subir?.length ?? 0}</b> subir · <b>${tier.escadas?.descer?.length ?? 0}</b> descer<br>` +
        // Quantos bonecos ESTA casa precisa vem da tabela de raridades do jogo. O aviso é o
        // que evita descobrir só depois do build que a casa tem 2 bonecos no papel e 1
        // marcado no mapa.
        `bonecos: <b>${tier.bonecos?.length ?? 0}</b>/${tetoTexto(t.id)} marcados` +
        `${avisoBonecos(tier, t.id)}<br>` +
        `spawn: <b>${tier.inicio ? `(${tier.inicio.x}, ${tier.inicio.y})` : 'auto'}</b>` +
        `${tier.porta ? ` · porta (${tier.porta.x}, ${tier.porta.y})` : ''}` +
        avisos;
    } catch (e) {
      meta.innerHTML = `<span class="avisos">${e.message}</span>`;
    }
  }));
}

/** "— marque N" / "— tire N (o jogo ignora)" / nada, quando a conta bate ou é desconhecida. */
function avisoBonecos(tier, tierId) {
  const n = tier?.bonecos?.length ?? 0;
  const usa = maxBonecos(tierId);
  if (!Number.isFinite(usa)) return '';
  if (n < usa) return ` <span class="avisos">— marque ${usa}</span>`;
  if (n > usa) return ` <span class="avisos">— tire ${n - usa}: o jogo usa só os ${usa} primeiros</span>`;
  return '';
}

function aplicarBoxAoTier(box) {
  const b = normalizarBox(box);
  if (!b) return;
  const t = tierAtual();
  t.mapa = state.mapa;
  t.box = b;
  t.passagens = normalizarPassagensPorAndar(t.passagens, groundZTier(t));
  t.escadas = t.escadas ?? { subir: [], descer: [] };
  invalidarPreview(state.tierAtivo);
  montarTiers();
  desenharOverlay();
  agendarSalvarAuto();
}

function aplicarPontoAoTier(p, campo) {
  const t = tierAtual();
  t[campo] = { x: p.x, y: p.y };
  t.mapa = state.mapa;
  invalidarPreview(state.tierAtivo);
  montarTiers();
  desenharOverlay();
  agendarSalvarAuto();
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

    if (state.modo === 'inicio') {
      aplicarPontoAoTier(tile, 'inicio');
      return;
    }
    if (state.modo === 'porta') {
      aplicarPontoAoTier(tile, 'porta');
      return;
    }
    if (state.modo === 'passagem') {
      alternarPassagemEditor(tile);
      return;
    }
    if (state.modo === 'escada-subir') {
      alternarEscadaEditor(tile, 'subir');
      return;
    }
    if (state.modo === 'escada-descer') {
      alternarEscadaEditor(tile, 'descer');
      return;
    }
    if (state.modo === 'boneco') {
      alternarBonecoEditor(tile);
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
    state.arraste.box = [
      state.arraste.tile0.x,
      state.arraste.tile0.y,
      tile.x,
      tile.y,
    ];
    desenharOverlay();
  });

  window.addEventListener('mouseup', () => {
    if (state.panDrag) {
      state.panDrag = null;
      vp.classList.remove('pan', 'drag');
    }
    if (state.arraste) {
      aplicarBoxAoTier(state.arraste.box);
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
    for (const b of $('#visoes').querySelectorAll('button')) {
      b.classList.toggle('on', b === btn);
    }
    const hints = {
      rua: 'Visão rua — telhados escondidos. Arraste para marcar a caixa do tier ativo.',
      corte: 'Visão corte — <b>Shift+clique</b> numa calçada para esconder telhados daquele ponto.',
      completo: 'Todas as camadas — telhados visíveis (difícil marcar casas).',
    };
    $('#hint').innerHTML = hints[state.visao] ?? '';
    await carregarMapa();
    desenharOverlay();
  };

  $('#modos').onclick = async (ev) => {
    const btn = ev.target.closest('[data-modo]');
    if (!btn) return;
    state.modo = btn.dataset.modo;
    for (const b of $('#modos').querySelectorAll('button')) {
      b.classList.toggle('on', b === btn);
    }
    const hints = {
      box: state.visao === 'corte'
        ? 'Arraste a caixa · <b>Shift+clique</b> move o ponto de corte (some telhado local).'
        : 'Arraste no mapa para marcar a caixa do tier ativo.',
      inicio: 'Clique no mapa para marcar onde o jogador nasce dentro da casa.',
      porta: 'Clique no mapa para marcar a porta (warp futuro).',
      passagem: 'Passagens do <b>andar selecionado</b> acima · vermelho abre · verde fecha · roxo bloqueia.',
      'escada-subir': 'Clique nos degraus onde o jogador <b>sobe</b> (marca ↑). No jogo, ao pisar, vê o andar de cima.',
      'escada-descer': 'Clique nos degraus onde o jogador <b>desce</b> (marca ↓). Volta ao térreo.',
      boneco: 'O <b>chão andável</b> da casa está pintado de verde — é o interior, visto por '
        + 'baixo do telhado. Clique nele para pôr/tirar um <b>boneco</b> (máx. 5). '
        + 'A <b>ordem</b> importa: a Comum usa só o nº1, a Incomum o 1 e o 2, e assim por diante — '
        + 'marque os 5 em toda casa e espalhe pelos cantos.',
    };
    $('#hint').innerHTML = hints[state.modo] ?? '';

    // Entrar no modo BONECO tira o telhado sozinho.
    //
    // Marcar boneco é a única tarefa do editor que acontece INTEIRAMENTE dentro da casa, e na
    // visão "completo" o telhado cobre justamente o cômodo que se quer mirar. A visão "rua"
    // já existe e resolve; pedir ao usuário que lembre de trocar antes é transformar uma
    // preferência em pré-requisito. As outras visões (rua, corte) ficam como estão — as duas
    // já mostram o interior.
    if (state.modo === 'boneco' && state.visao === 'completo') {
      state.visao = 'rua';
      for (const b of $('#visoes').querySelectorAll('button')) {
        b.classList.toggle('on', b.dataset.visao === 'rua');
      }
      await carregarMapa();
    }

    // A prévia da grade vale para os DOIS modos que trabalham dentro da casa. No de bonecos
    // ela não é enfeite: mesmo sem telhado, chão e parede se parecem de cima — e um boneco em
    // cima de parede fica inalcançável.
    if (state.modo === 'passagem' || state.modo === 'boneco') await atualizarWalkPreviewEditor();
    else {
      state.walkPreview = null;
      state.andarPassagem = null;
      $('#andares-passagem').hidden = true;
      desenharOverlay();
    }
  };

  $('#andares-passagem').onclick = async (ev) => {
    const btn = ev.target.closest('[data-andar]');
    if (!btn) return;
    state.andarPassagem = Number(btn.dataset.andar);
    invalidarPreview(state.tierAtivo);
    await atualizarWalkPreviewEditor();
  };

  $('#mostrar-centro').onchange = (ev) => {
    state.mostrarCentro = ev.target.checked;
    desenharOverlay();
  };
}

async function salvarDocCasas(textoOk = 'salvo em game/src/server/dados/casas-editor.json') {
  const msg = $('#save-msg');
  msg.textContent = 'salvando…';
  try {
    await api('/api/casas', {
      mapaPadrao: state.mapa,
      regiaoLab: state.regiao,
      tiers: state.doc.tiers,
    });
    msg.textContent = textoOk;
  } catch (e) {
    msg.textContent = e.message;
    throw e;
  }
}

let salvarAutoTimer = null;

function agendarSalvarAuto() {
  clearTimeout(salvarAutoTimer);
  salvarAutoTimer = setTimeout(() => {
    salvarDocCasas('salvo automaticamente').catch(() => {});
  }, 500);
}

function payloadSalvarCasas() {
  return JSON.stringify({
    mapaPadrao: state.mapa,
    regiaoLab: state.regiao,
    tiers: state.doc.tiers,
  });
}

function salvarAntesDeSair() {
  if (!state.doc?.tiers) return;
  clearTimeout(salvarAutoTimer);
  const corpo = payloadSalvarCasas();
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/casas', new Blob([corpo], { type: 'application/json' }));
    return;
  }
  fetch('/api/casas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: corpo,
    keepalive: true,
  }).catch(() => {});
}

async function ligarSalvar() {
  $('#btn-salvar').onclick = () => salvarDocCasas();
}

const TECLAS_MOV = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  W: [0, -1],
  s: [0, 1],
  S: [0, 1],
  a: [-1, 0],
  A: [-1, 0],
  d: [1, 0],
  D: [1, 0],
};

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
  return { lx, ly };
}

function desenharDebugJogo(jogo) {
  const ctx = $('#jogo-debug').getContext('2d');
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!jogo.render) return;
  const [minTx, minTy] = jogo.box;
  const tier = state.doc?.tiers?.[jogo.tierId];

  if (jogo.modoBonecos && jogo.alcancado) {
    pintarChaoAlcancado(ctx, jogo.render, minTx, minTy, jogo.alcancado, jogo.cols, jogo.rows);
    if (tier) desenharBonecosNoCtx(ctx, jogo.render, minTx, minTy, tier.bonecos, maxBonecos(jogo.tierId));
    return;
  }

  if (!jogo.modoPassagens) return;

  const p = tier ? camadaPassagens(tier, jogo.andar ?? jogo.groundZ ?? 7, jogo.groundZ) : { abrir: [], fechar: [] };
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
}

async function recarregarGradeJogo(jogo) {
  const tier = state.doc?.tiers?.[jogo.tierId];
  const andar = jogo.andar ?? jogo.groundZ ?? 7;
    const preview = await api('/api/casas/preview', {
      mapa: jogo.mapaSlug,
      box: jogo.box,
      inicio: tier?.inicio,
      passagens: tier?.passagens ?? {},
      escadas: tier?.escadas ?? {},
      andar,
      incluirGrade: true,
    });
  if (!jogo.ativo || preview.erro) return;
  jogo.grade = preview.grade;
  jogo.gradeBase = preview.gradeBase;
  jogo.alcancado = preview.alcancado;
  jogo.andar = preview.andar ?? andar;
  sincronizarGradeJogo(jogo);
  jogo.andaveis = preview.andaveis ?? 0;
  jogo.conectados = preview.conectados ?? 0;
  desenharDebugJogo(jogo);
  desenharHeroJogo(jogo);
  invalidarPreview(jogo.tierId);
  montarTiers();
}

async function alternarPassagemJogo(local) {
  const jogo = state.jogo;
  if (!jogo?.gradeBase) return;
  const tier = state.doc?.tiers?.[jogo.tierId];
  if (!tier) return;
  togglePassagemCelula(tier, local.lx, local.ly, jogo.gradeBase, jogo.andar ?? jogo.groundZ ?? 7);
  sincronizarGradeJogo(jogo);
  desenharDebugJogo(jogo);
  await recarregarGradeJogo(jogo);
  agendarSalvarAuto();
}

async function alternarBonecoJogo(local) {
  const jogo = state.jogo;
  if (!jogo?.alcancado) return;
  const tier = state.doc?.tiers?.[jogo.tierId];
  if (!tier) return;

  if ((jogo.andar ?? jogo.groundZ) !== jogo.groundZ) {
    $('#jogo-pos').textContent = 'bonecos só no térreo — desça antes de marcar';
    return;
  }

  const arr = ensureBonecos(tier);
  const jaTem = idxPassagem(arr, local.lx, local.ly) >= 0;
  if (!jaTem && !chaoLivreNoJogo(jogo, local.lx, local.ly)) {
    $('#jogo-pos').textContent = 'aí é parede — clique no chão verde';
    return;
  }
  const teto = maxBonecos(jogo.tierId);
  if (!jaTem && arr.length >= teto) {
    $('#jogo-pos').textContent = `já são ${teto} boneco(s) — clique num alvo para tirar`;
    return;
  }

  toggleBonecoCelula(tier, jogo.tierId, local.lx, local.ly);
  desenharDebugJogo(jogo);
  desenharHeroJogo(jogo);
  invalidarPreview(jogo.tierId);
  montarTiers();
  clearTimeout(salvarAutoTimer);
  await salvarDocCasas('salvo automaticamente');
}

function atualizarOverlayJogo() {
  const jogo = state.jogo;
  if (!jogo) return;
  const dbg = $('#jogo-debug');
  dbg.classList.toggle('editavel', !!jogo.modoPassagens);
  dbg.classList.toggle('bonecos', !!jogo.modoBonecos);
  $('#jogo-viewport').style.cursor = jogo.modoBonecos ? 'crosshair' : jogo.modoPassagens ? 'cell' : '';
}

function definirModoPassagensJogo(ativo) {
  const jogo = state.jogo;
  if (!jogo) return;
  if (ativo) jogo.modoBonecos = false;
  jogo.modoPassagens = ativo;
  const btn = $('#jogo-passagens');
  btn.classList.toggle('on', ativo);
  const rot = rotuloAndar(jogo.groundZ ?? 7, jogo.andar ?? jogo.groundZ ?? 7);
  btn.textContent = ativo ? `passagens · ${rot}` : 'passagens';
  $('#jogo-bonecos')?.classList.remove('on');
  atualizarOverlayJogo();
  desenharDebugJogo(jogo);
}

function definirModoBonecosJogo(ativo) {
  const jogo = state.jogo;
  if (!jogo) return;
  if (ativo) jogo.modoPassagens = false;
  jogo.modoBonecos = ativo;
  const btn = $('#jogo-bonecos');
  btn.classList.toggle('on', ativo);
  const n = state.doc?.tiers?.[jogo.tierId]?.bonecos?.length ?? 0;
  btn.textContent = ativo ? `bonecos 🎯 · ${n}/${tetoTexto(jogo.tierId)}` : 'bonecos 🎯';
  $('#jogo-passagens')?.classList.remove('on');
  atualizarOverlayJogo();
  desenharDebugJogo(jogo);
  if (ativo && (jogo.andar ?? jogo.groundZ) !== jogo.groundZ) {
    jogo.andar = jogo.groundZ;
    recarregarGradeJogo(jogo).then(() => solicitarRenderMapaJogo(jogo));
  }
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
  const tier = state.doc?.tiers?.[jogo.tierId];
  const nb = tier?.bonecos?.length ?? 0;
  let pos = `tile (${mtx}, ${mty}) · ${rotuloAndar(jogo.groundZ ?? 7, jogo.andar ?? jogo.groundZ ?? 7)} · conectados ${jogo.conectados}`;
  if (jogo.modoBonecos) pos += ` · bonecos ${nb}/${tetoTexto(jogo.tierId)}`;
  else pos += ` · andáveis ${jogo.andaveis}`;
  $('#jogo-pos').textContent = pos;
  if (jogo.modoBonecos) {
    const btn = $('#jogo-bonecos');
    if (btn?.classList.contains('on')) btn.textContent = `bonecos 🎯 · ${nb}/${tetoTexto(jogo.tierId)}`;
  }
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
    primeiroVisivelFixo: jogo.andar ?? jogo.groundZ ?? 7,
  });
  if (!jogo.ativo || token !== jogo.renderToken) return;

  jogo.render = render;
  jogo.visaoEm = { ...alvo };
  jogo.visaoAndar = jogo.andar ?? jogo.groundZ ?? 7;

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
  const andar = jogo.andar ?? jogo.groundZ ?? 7;
  if (jogo.visaoEm?.x === alvo.x && jogo.visaoEm?.y === alvo.y && jogo.visaoAndar === andar) return;
  jogo.renderPendente = { ...alvo, andar };
  if (jogo.renderizando) return;
  jogo.renderizando = true;
  (async () => {
    while (jogo.ativo && jogo.renderPendente) {
      const p = jogo.renderPendente;
      jogo.renderPendente = null;
      if (p.andar != null) jogo.andar = p.andar;
      await renderizarMapaJogo(jogo, p);
    }
    jogo.renderizando = false;
  })();
}

function aplicarEscadaJogo(jogo, lx, ly) {
  const tier = state.doc?.tiers?.[jogo.tierId];
  if (!tier) return false;
  const gz = jogo.groundZ ?? 7;
  let mudou = false;
  if (temEscada(tier, 'subir', lx, ly) && jogo.andar >= gz) {
    jogo.andar = gz - 1;
    mudou = true;
  } else if (temEscada(tier, 'descer', lx, ly) && jogo.andar < gz) {
    jogo.andar = gz;
    mudou = true;
  }
  if (mudou) {
    recarregarGradeJogo(jogo).then(() => solicitarRenderMapaJogo(jogo));
  }
  return mudou;
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
        aplicarEscadaJogo(jogo, nx, ny);
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
  const tierId = jogo.tierId;
  try {
    jogo.ativo = false;
    if (jogo.raf) cancelAnimationFrame(jogo.raf);
    definirModoPassagensJogo(false);
    state.jogo = null;
    $('#cs-jogo').classList.add('hidden');
    $('#cs-jogo').setAttribute('aria-hidden', 'true');
    await salvarDocCasas('salvo ao sair');
    invalidarPreview(tierId);
    await montarTiers();
    if (state.modo === 'passagem') await atualizarWalkPreviewEditor();
    else desenharOverlay();
  } catch {
    /* msg de erro já está no #save-msg */
  } finally {
    saindoJogo = false;
  }
}

async function entrarCasa(tierId = state.tierAtivo) {
  if (state.jogo?.ativo) return;
  const tier = state.doc?.tiers?.[tierId];
  const box = normalizarBox(tier?.box);
  if (!box) {
    alert('Marque a caixa da casa no mapa antes de entrar.');
    return;
  }

  const btn = $('#btn-entrar');
  btn.disabled = true;
  $('#cs-jogo').classList.remove('hidden');
  $('#cs-jogo').setAttribute('aria-hidden', 'false');
  $('#jogo-titulo').textContent = `${tier.rotulo ?? metaDoTier(tierId).rotulo ?? tierId} · ${state.mapa}`;
  $('#jogo-pos').textContent = 'calculando walkgrid…';

  try {
    const preview = await api('/api/casas/preview', {
      mapa: tier.mapa ?? state.mapa,
      box,
      inicio: tier.inicio,
      passagens: tier.passagens ?? {},
      escadas: tier.escadas ?? {},
      incluirGrade: true,
    });
    if (preview.erro) throw new Error(preview.erro);
    if (!preview.grade?.length) throw new Error('walkgrid vazio — marque a caixa de novo');
    tier.passagens = preview.passagens ?? normalizarPassagensPorAndar(tier.passagens, preview.groundZ);
    tier._groundZ = preview.groundZ ?? 7;

    const escala = escalaJogo(preview.cols, preview.rows);
    $('#jogo-pos').textContent = 'carregando personagem…';
    const [heroSprite, mod] = await Promise.all([
      carregarOutfit(159),
      import('/mapview.mjs'),
    ]);
    if (!heroSprite) $('#jogo-pos').textContent = 'sprite indisponível — usando marcador';

    const [minTx, minTy] = box;
    const inicio = preview.inicio ?? { x: minTx, y: minTy };
    const jogo = {
      ativo: true,
      tierId,
      mapaSlug: tier.mapa ?? state.mapa,
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
      andares: preview.andares ?? [preview.groundZ ?? 7],
      groundZ: preview.groundZ ?? 7,
      andar: preview.groundZ ?? 7,
      modoPassagens: false,
      modoBonecos: false,
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
  $('#btn-entrar').onclick = () => entrarCasa(state.tierAtivo);
  $('#jogo-sair').onclick = () => pararJogo();
  $('#jogo-passagens').onclick = () => {
    if (!state.jogo?.ativo) return;
    definirModoPassagensJogo(!state.jogo.modoPassagens);
  };
  $('#jogo-bonecos').onclick = () => {
    if (!state.jogo?.ativo) return;
    definirModoBonecosJogo(!state.jogo.modoBonecos);
  };

  $('#jogo-debug').addEventListener('click', (ev) => {
    const jogo = state.jogo;
    if (!jogo?.ativo) return;
    if (!jogo.modoPassagens && !jogo.modoBonecos) return;
    ev.stopPropagation();
    const local = tileLocalDoCliqueJogo(ev);
    if (!local) return;
    if (jogo.modoBonecos) alternarBonecoJogo(local);
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
      if (state.jogo.modoBonecos) {
        definirModoBonecosJogo(false);
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
  const dados = await api('/api/casas');
  state.doc = dados;
  state.tierMeta = dados.tierMeta ?? [];
  for (const t of Object.values(state.doc.tiers ?? {})) {
    t.passagens = normalizarPassagensPorAndar(t.passagens, 7);
    ensureEscadas(t);
    ensureBonecos(t);
  }
  state.mapa = dados.mapaPadrao ?? 'cerulean';
  state.regiao = dados.regiaoLab ?? [-48, -34, 38, 22];
  if (dados.referencia?.centro) Object.assign(REF_CENTRO, dados.referencia.centro);

  const sel = $('#mapa-sel');
  sel.innerHTML = (dados.mapasCidades ?? ['cerulean']).map(
    (m) => `<option value="${m}"${m === state.mapa ? ' selected' : ''}>${m}</option>`,
  ).join('');
  sel.onchange = async () => {
    state.mapa = sel.value;
    await carregarMapa();
    montarTiers();
  };

  ligarMapa();
  ligarModos();
  ligarSalvar();
  ligarJogo();
  window.addEventListener('beforeunload', salvarAntesDeSair);
  await carregarMapa();
  await montarTiers();
}

iniciar().catch((e) => {
  $('#mapa-status').textContent = e.message;
  alert(e.message);
});
