// Carrega os sprites de looktype do espelho (servidos em /assets pelo gateway).
//
// Formato: um manifest por outfit + um atlas .webp. Cada quadro se chama
// {frame}_{layer}_{addon}_{direction}.png e o manifest guarda o retângulo dele no atlas.
// Direções: 1=norte 2=leste 3=sul 4=oeste.

import { colorizar } from './cores-outfit.mjs';
import { LOOKTYPE_FUNDADOR, LOOKTYPE_COFUNDADOR } from '../shared/caixas-beta.mjs';

const SEM_CACHE = { cache: 'no-cache' }; // ver a nota em app.js


const PACK = '/assets/asset-packs';
const localize = (p) => p.replace(/^\/assets-packs/, PACK);

let indicePromise = null;
const cacheOutfit = new Map();
const cacheImg = new Map();

export function carregarIndice() {
  return (indicePromise ??= fetch(`${PACK}/outfits-index.json`)
    .then((r) => r.json())
    .then((j) => j.outfits));
}

const carregarImagem = (src) => {
  if (!cacheImg.has(src)) {
    cacheImg.set(
      src,
      new Promise((ok, err) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => err(new Error(src));
        i.src = src;
      }),
    );
  }
  return cacheImg.get(src);
};

/**
 * @param looktype  o outfit pedido
 * @param visual    `[cabeca, corpo, pernas, pes]` — índices da paleta, só para quem tem máscara
 * @returns {Promise<{byDir, frameW, frameH, imagens}|null>}
 */
export function carregarOutfit(looktype, visual) {
  // O sprite CRU é carregado (e cacheado) uma vez só; a colorização é uma camada em cima dele,
  // com cache próprio por combinação de cores. Assim dois jogadores com o mesmo outfit e
  // roupas diferentes dividem o download do atlas e só não dividem o atlas pintado.
  const cru = carregarOutfitCru(looktype);
  if (!visual) return cru;
  return cru.then((s) => colorizar(s, visual, looktype));
}

// -------------------------------------------------- sprites NOSSOS (fora do atlas)
//
// O atlas (`stonegy-asset-packs-v1`) mora em `public/data/asset-packs/`, que é o espelho
// regenerável e está no `.gitignore`: um sprite NOSSO posto lá funcionaria na máquina de quem
// o gerou e sumiria no primeiro `npm run fetch`, inclusive em produção. É a mesma razão que
// manda os ícones dos itens nossos para `src/client/img/` (ver `itens-nossos.mjs`).
//
// Em vez de um caminho de desenho paralelo, monta-se aqui a MESMA estrutura que
// `carregarOutfitCru` devolve — `{ byDir, frameW, frameH, imagens }` — a partir do PNG cru.
// Assim `quadrosDe`, `desenharQuadro`, `spriteAnimado` e o renderizador do campo funcionam
// sem saber que estes sprites são diferentes dos outros 2.139.
//
// Os PNGs seguem a convenção do pack, conferida quadro a quadro no nomeador: 4 COLUNAS
// (direção − 1) por N LINHAS (frame − 1). O número de linhas é lido da altura do arquivo — o
// boneco tem 3 (anda), o Professor tem 1 (fica parado atrás do balcão).
//
// O LADO do quadro não é fixo em 32: as outfits das Caixas de Fundador vêm em células de
// 64×64, que é o mesmo formato das outfits premium do atlas ("Premium/VIP usam 64×64 com
// padding extra", logo abaixo). Cada folha declara o seu `tile`.

/** O boneco do posto de XP Share. */
export const LOOKTYPE_BONECO = 90920;

/**
 * O Professor Carvalho.
 *
 * Era o outfit `Trainer` feminino (160) pintado de preto, o que dava uma segunda "menina" na
 * praça ao lado da Enfermeira Joy. Agora é arte própria, e por isso sai do atlas — mesmo
 * caminho do boneco.
 */
export const LOOKTYPE_PROFESSOR = 90921;

const TILE = 32;

/** looktype → PNG nosso. Quem entrar aqui é resolvido sem passar pelo atlas. */
const FOLHAS_PROPRIAS = {
  [LOOKTYPE_BONECO]: { png: '/img/boneco.png', nome: 'Boneco' },
  [LOOKTYPE_PROFESSOR]: { png: '/img/professor-carvalho.png', nome: 'Professor Carvalho' },
  // As duas outfits das Caixas de Fundador. Células de 64×64 (ver a nota do bloco acima), e
  // arte NOSSA — geradas/copiadas por `tools/gerar-caixas-beta.mjs`.
  [LOOKTYPE_FUNDADOR]: { png: '/img/outfit-fundador.png', nome: 'Founder Outfit', tile: 64 },
  [LOOKTYPE_COFUNDADOR]: { png: '/img/outfit-cofundador.png', nome: 'Co-Founder Outfit', tile: 64 },
};

async function carregarFolhaPropria(looktype) {
  const def = FOLHAS_PROPRIAS[looktype];
  if (!def) return null;
  const img = await carregarImagem(def.png);
  if (!img) return null;
  const tile = def.tile ?? TILE;
  const linhas = Math.max(1, Math.round(img.height / tile));
  const byDir = {};
  for (let d = 1; d <= 4; d++) {
    byDir[d] = Array.from({ length: linhas }, (_, f) => ({
      pagina: 0,
      x: (d - 1) * tile,
      y: f * tile,
      w: tile,
      h: tile,
    }));
  }
  return {
    byDir,
    frameW: tile,
    frameH: tile,
    imagens: [img],
    nome: def.nome,
    // Sem máscara `_template`: a cor já está desenhada, como na Enfermeira Joy.
    colorizavel: false,
  };
}

function carregarOutfitCru(looktype) {
  if (cacheOutfit.has(looktype)) return cacheOutfit.get(looktype);

  if (FOLHAS_PROPRIAS[looktype]) {
    const pp = carregarFolhaPropria(looktype).catch(() => null);
    // Falha não fica no cache, pela mesma razão do caminho normal (ver a nota lá embaixo).
    pp.then((s) => {
      if (!s && cacheOutfit.get(looktype) === pp) cacheOutfit.delete(looktype);
    });
    cacheOutfit.set(looktype, pp);
    return pp;
  }

  const p = (async () => {
    const idx = await carregarIndice();
    const entry = idx[String(looktype)];
    if (!entry) return null;

    const manifest = await fetch(localize(entry.manifest)).then((r) => r.json());
    const cat = Object.values(manifest.categories)[0];
    const imagens = await Promise.all(cat.pages.map((pg) => carregarImagem(localize(pg.image))));

    const byDir = {};
    // As máscaras `_template` andam JUNTO dos quadros no atlas — uma célula por quadro. Antes
    // elas eram descartadas aqui; agora são guardadas e é delas que sai a cor da roupa
    // (ver `cores-outfit.mjs`). O `viewer.js` do Sprite Lab lê do mesmo jeito.
    const mascaras = {};
    let frameW = 32;
    let frameH = 32;

    for (const [chave, asset] of Object.entries(manifest.assets)) {
      const stem = chave.split('/').pop().replace(/\.png$/, '');
      const ehMascara = stem.endsWith('_template');
      const n = (ehMascara ? stem.slice(0, -'_template'.length) : stem).split('_').map(Number);
      const f = asset.frames[0];
      if (!f) continue;
      frameW = asset.width;
      frameH = asset.height;
      const rect = { pagina: f.page ?? 0, x: f.x, y: f.y, w: f.w, h: f.h };
      if (ehMascara) mascaras[`${n[3]}:${n[0]}`] = rect;
      else ((byDir[n[3]] ??= [])[n[0] - 1] = rect);
    }
    for (const d of Object.keys(byDir)) {
      byDir[d] = byDir[d].filter(Boolean);
      byDir[d].forEach((q, i) => { q.mascara = mascaras[`${d}:${i + 1}`]; });
    }

    return { byDir, frameW, frameH, imagens, nome: entry.name, colorizavel: !!entry.colorizable };
  })().catch(() => null);

  // Falha NÃO fica no cache.
  //
  // Um `fetch` que caiu (rede oscilando, aba em segundo plano, servidor reiniciando no meio
  // de um deploy) devolvia `null`, e esse `null` ficava guardado para sempre: aquele looktype
  // virava invisível pelo resto da sessão, porque `desenharCriatura` sai calado quando não há
  // sprite. Na prática, um Oddish que não carregou uma vez some da hunt inteira — com placa e
  // barra de HP no lugar, atacando, mas sem desenho nenhum. Descartando o resultado ruim, a
  // próxima entidade daquele looktype tenta de novo.
  p.then((s) => {
    if (!s && cacheOutfit.get(looktype) === p) cacheOutfit.delete(looktype);
  });

  cacheOutfit.set(looktype, p);
  return p;
}

export const quadrosDe = (sprite, dir) =>
  sprite.byDir[dir]?.length ? sprite.byDir[dir] : sprite.byDir[3] ?? Object.values(sprite.byDir)[0] ?? [];

/** Desenha um quadro com o "pé" do sprite no ponto (x, y). */
export function desenharQuadro(ctx, sprite, quadro, x, y, escala = 1) {
  if (!quadro) return;
  const img = sprite.imagens[quadro.pagina];
  if (!img) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    img,
    quadro.x, quadro.y, quadro.w, quadro.h,
    Math.round(x - (quadro.w * escala) / 2),
    Math.round(y - quadro.h * escala),
    Math.round(quadro.w * escala),
    Math.round(quadro.h * escala),
  );
}

/** Célula do treinador padrão (looktypes 159/160). Premium/VIP usam 64×64 com padding extra. */

const cacheBoundsQuadro = new Map();

/** Retângulo visível (sem alpha) dentro do quadro — premium/VIP têm célula 64×64 com padding. */
function boundsVisivel(img, q) {
  const key = `${q.pagina}:${q.x}:${q.y}:${q.w}:${q.h}`;
  if (cacheBoundsQuadro.has(key)) return cacheBoundsQuadro.get(key);

  const cv = document.createElement('canvas');
  cv.width = q.w;
  cv.height = q.h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, q.x, q.y, q.w, q.h, 0, 0, q.w, q.h);
  const { data } = cx.getImageData(0, 0, q.w, q.h);

  let minX = q.w;
  let minY = q.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < q.h; y++) {
    for (let x = 0; x < q.w; x++) {
      if (data[(y * q.w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  const b =
    maxX < minX
      ? { sx: 0, sy: 0, sw: q.w, sh: q.h }
      : { sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
  cacheBoundsQuadro.set(key, b);
  return b;
}

/** Desenha o boneco centrado na caixa, pé no chão — ignora padding transparente da célula. */
function desenharTreinadorRanking(ctx, img, q, caixa) {
  const b = boundsVisivel(img, q);
  const escala = Math.min(caixa / b.sw, caixa / b.sh);
  const drawW = b.sw * escala;
  const drawH = b.sh * escala;
  ctx.drawImage(
    img,
    q.x + b.sx, q.y + b.sy, b.sw, b.sh,
    Math.round((caixa - drawW) / 2),
    Math.round(caixa - drawH),
    Math.round(drawW),
    Math.round(drawH),
  );
}

function escalaAnimada(caixa, w, h) {
  return Math.min(caixa / w, caixa / h);
}

/**
 * Retângulo visível da ANIMAÇÃO inteira — a união dos quadros, em pixels da célula.
 *
 * Medir quadro a quadro daria uma escala por quadro, e o bicho pulsaria de tamanho a cada
 * 220 ms. Medida uma vez sobre a união, a escala é a mesma para todos os quadros: o que muda
 * entre eles volta a ser movimento, e não zoom.
 */
function boundsDaAnimacao(sprite, quadros) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const q of quadros) {
    const img = sprite.imagens[q.pagina];
    if (!img) continue;
    const b = boundsVisivel(img, q);
    if (b.sx < x1) x1 = b.sx;
    if (b.sy < y1) y1 = b.sy;
    if (b.sx + b.sw > x2) x2 = b.sx + b.sw;
    if (b.sy + b.sh > y2) y2 = b.sy + b.sh;
  }
  // Nenhuma página do atlas carregou: cai na célula inteira, que é o comportamento de antes.
  if (!Number.isFinite(x1)) return { sx: 0, sy: 0, sw: quadros[0].w, sh: quadros[0].h };
  return { sx: x1, sy: y1, sw: x2 - x1, sh: y2 - y1 };
}

/**
 * Canvas solto que fica animando um looktype — usado nas listas dos painéis.
 * `caixa` limita o lado maior em px (um Onix 96×96 quebraria o alinhamento).
 *
 * `treinador` — ranking: encaixa o conteúdo visível na caixa, centrado com pé no chão.
 *
 * `encaixar` — ignora o padding transparente da célula e faz o BICHO ocupar a caixa. Sem
 * isto, `caixa` limita a CÉLULA, e células têm tamanhos diferentes: o Charmander mora numa de
 * 64×32 e o Bulbasaur numa de 32×32, então lado a lado na escolha do inicial o Charmander
 * saía com metade da altura dos outros dois. Aqui a medida é a união dos quadros da animação,
 * medida uma vez (ver `boundsDaAnimacao`), então o bicho não pulsa entre um quadro e outro.
 *
 * `aoFalhar` é chamado quando o looktype não existe no índice ou o atlas não carrega. Sem
 * ele o canvas ficava no lugar, vazio e do tamanho certo: um buraco que parecia bug de layout
 * em vez de sprite faltando. Quem chama decide o que pôr no lugar (em geral o retrato do
 * atlas de marcadores, que cobre outros looktypes).
 */
export function spriteAnimado(
  looktype,
  caixa = 32,
  dir = 3,
  aoFalhar = null,
  visual = null,
  { treinador = false, encaixar = false } = {},
) {
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 32;
  cv.style.width = `${caixa}px`;
  cv.style.height = `${caixa}px`;
  // Sprite de 32×32 numa caixa de 44 é ampliado, e sem isto o navegador interpola: o pixel
  // art fica borrado (o "sprite zoado"). `pixelated` mantém a borda dura em qualquer escala.
  cv.style.imageRendering = 'pixelated';
  const ctx = cv.getContext('2d');

  carregarOutfit(looktype, visual).then((sprite) => {
    const quadros = sprite ? quadrosDe(sprite, dir) : [];
    if (!quadros.length) {
      const troca = aoFalhar?.();
      if (troca && cv.isConnected) cv.replaceWith(troca);
      return;
    }

    let i = 0;
    let pintar;

    if (treinador) {
      cv.width = caixa;
      cv.height = caixa;
      cv.style.width = `${caixa}px`;
      cv.style.height = `${caixa}px`;
      pintar = () => {
        const q = quadros[i++ % quadros.length];
        const img = sprite.imagens[q.pagina];
        if (!img) return;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, caixa, caixa);
        desenharTreinadorRanking(ctx, img, q, caixa);
      };
    } else {
      // A janela recortada de cada quadro: a célula inteira no modo normal, só o retângulo com
      // pixel no modo `encaixar`. O resto do laço é o mesmo nos dois — muda só o que se olha.
      const jan = encaixar
        ? boundsDaAnimacao(sprite, quadros)
        : { sx: 0, sy: 0, sw: quadros[0].w, sh: quadros[0].h };
      cv.width = jan.sw;
      cv.height = jan.sh;
      const escala = escalaAnimada(caixa, jan.sw, jan.sh);
      cv.style.width = `${Math.round(jan.sw * escala)}px`;
      cv.style.height = `${Math.round(jan.sh * escala)}px`;
      pintar = () => {
        const q = quadros[i++ % quadros.length];
        const img = sprite.imagens[q.pagina];
        if (!img) return; // página do atlas que não carregou: melhor vazio que exceção no laço
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, q.x + jan.sx, q.y + jan.sy, jan.sw, jan.sh, 0, 0, jan.sw, jan.sh);
      };
    }
    // O primeiro quadro é pintado SEM checar `isConnected`: quem chama monta a árvore inteira
    // antes de pendurá-la no documento, e o canvas ainda solto perdia o desenho de estreia —
    // ficava em branco até o segundo quadro, e para sempre nos sprites de um quadro só.
    pintar();
    if (quadros.length > 1) {
      const timer = setInterval(() => {
        if (!cv.isConnected) return clearInterval(timer); // saiu da tela: para o laço
        pintar();
      }, 220);
    }
  });

  return cv;
}

// --------------------------------------------------------------- efeitos fx

let fxPromise = null;
export const carregarEfeitos = () =>
  (fxPromise ??= fetch('/assets/index/moves-index.json', SEM_CACHE)
    .then((r) => r.json())
    .then((j) => j.efeitos));

/** Folha de efeito do tipo do golpe (tira vertical: quadro i em (0, i*frameH)). */
export async function efeitoDoTipo(tipo) {
  const efeitos = await carregarEfeitos();
  const e = efeitos[String(tipo).toUpperCase()];
  if (!e) return null;
  const img = await carregarImagem(`/assets/effects/moves/${e.file}`).catch(() => null);
  return img && { img, ...e };
}

let tmFxPromise = null;
export const carregarEfeitosTm = () =>
  (tmFxPromise ??= fetch('/assets/effects/tm-elemental/index.json', SEM_CACHE)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({})));

/** Efeito visual exclusivo do TM Elemental (2800 power). Fallback: folha do tipo normal. */
export async function efeitoTmElemental(tipo) {
  const efeitos = await carregarEfeitosTm();
  const e = efeitos[String(tipo).toUpperCase()];
  if (!e) return efeitoDoTipo(tipo);
  const img = await carregarImagem(`/assets/effects/tm-elemental/${e.file}`).catch(() => null);
  if (!img) return efeitoDoTipo(tipo);
  return { img, ...e };
}

// ------------------------------------------------------------ pokébola
//
// As folhas são as ORIGINAIS, espelhadas por tools/fetch-effects.mjs. São de dois tipos:
//
//   throw/<bola>.png   grade 3×3 de 32×32 indexada por DIREÇÃO (não por quadro): cada
//                      célula é a bola com o rastro apontando para onde ela voa
//   <bola>_catch.png   tira vertical de 64×96 — abre num clarão, chacoalha no chão,
//                      solta faíscas verdes e some pálida (60 quadros)
//   <bola>_broke.png   igual até o quadro 39, mas aí estoura numa baforada branca e
//                      acaba: é o pokémon escapando (44 quadros)
//
// Os nomes de arquivo são os da origem, salvo a Super Ball (id 3) e a Beast Ball (id 5),
// que usam folhas versionadas em `src/client/effects/`.
//
// O id 3 é `superball` nos arquivos; o id 5 é `idleball` (Beast Ball).

const ARQUIVO_BOLA = { 1: 'pokeball', 2: 'greatball', 3: 'superball', 4: 'ultraball', 5: 'idleball' };

/** Folhas NOSSAS — servidas em `/effects/catch/` a partir de `src/client/effects/`. */
const BASE_BOLA = {
  superball: '/effects/catch',
  idleball: '/effects/catch',
};

export const QUADRO_BOLA_W = 64;
export const QUADRO_BOLA_H = 96;
/** Ritmo das folhas de captura. As de move ficam entre 33 e 180 ms; 45 casa com o original. */
export const MS_QUADRO_BOLA = 45;

const cacheBola = new Map();

/** Carrega as folhas de uma pokébola (arremesso, captura e quebra). */
export function folhasDaBola(ballId) {
  const nome = ARQUIVO_BOLA[ballId] ?? ARQUIVO_BOLA[1];
  if (cacheBola.has(nome)) return cacheBola.get(nome);

  const base = BASE_BOLA[nome] ?? '/assets/effects/catch';
  const nada = () => null;
  const fallbackArremesso =
    nome === 'idleball' || nome === 'superball'
      ? nada
      : () => carregarImagem(`${base}/throw/pokeball.png`).catch(nada);
  const promessa = Promise.all([
    carregarImagem(`${base}/throw/${nome}.png`).catch(fallbackArremesso),
    carregarImagem(`${base}/${nome}_catch.png`).catch(nada),
    carregarImagem(`${base}/${nome}_broke.png`).catch(nada),
  ]).then(([arremesso, captura, quebra]) => ({
    arremesso,
    captura,
    quebra,
    // a folha tem 60 espaços, mas a de quebra só usa os 44 primeiros — o resto é vazio
    quadrosCaptura: captura ? Math.round(captura.height / QUADRO_BOLA_H) : 0,
    quadrosQuebra: quebra ? 44 : 0,
  }));

  cacheBola.set(nome, promessa);
  return promessa;
}
