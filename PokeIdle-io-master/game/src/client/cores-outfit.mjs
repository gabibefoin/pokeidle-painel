// Colorização de outfit, do jeito do Tibia — e do jeito que o Sprite Lab já sabia que dava.
//
// ### A peça que faltava
//
// Todo outfit humano do pack vem com uma máscara `_template` ao lado de cada quadro no atlas.
// O visualizador (`public/viewer.js`) já a lê e já anuncia "colorizável: sim (tem máscara
// _template)" — só que nunca a usou para nada, e o `sprites.mjs` do jogo a DESCARTAVA
// (`if (stem.endsWith('_template')) continue`). Este arquivo é o que estava faltando.
//
// ### Como a máscara funciona
//
// A máscara tem exatamente as quatro cores mágicas do Tibia, e cada uma marca uma REGIÃO do
// desenho (conferido pixel a pixel nos looktypes 159 e 160):
//
//     amarelo (255,255,0) → cabeça e cabelo
//     vermelho (255,0,0)  → tronco (a camisa)
//     verde (0,255,0)     → pernas (a calça)
//     azul (0,0,255)      → pés (os sapatos)
//
// O sprite base pinta essas áreas em tons claros e dessaturados. Colorir é MULTIPLICAR o
// pixel base pela cor escolhida:
//
//     saída = base × cor / 255
//
// Multiplicar (em vez de trocar a cor) é o que preserva o sombreado do desenho original: os
// vincos da roupa continuam escuros, o brilho continua claro, e só a matiz muda. Trocar o
// pixel pela cor chapada apagaria o volume e deixaria a roupa parecendo um adesivo.
//
// Pixel fora das quatro cores (o contorno, a pele do rosto, a pokébola na mão) fica INTACTO —
// é por isso que dá para trocar a camisa sem repintar a pessoa.

/**
 * A paleta de 133 cores do Tibia.
 *
 * Não é uma lista escolhida a dedo: é uma fórmula (19 matizes × 7 combinações de saturação e
 * brilho), e é a MESMA que o cliente original usa. Isso importa por dois motivos — as cores
 * caem sempre em tons que funcionam sobre o sombreado do sprite, e um outfit montado aqui
 * pode ser descrito pelos mesmos quatro números que o jogo de origem usaria.
 *
 * A coluna 0 de cada faixa é a escala de cinza (saturação zero), que é o que dá branco, preto
 * e os cinzas — sem ela não haveria roupa branca.
 */
function gerarPaleta() {
  const PASSOS_H = 19;
  const VALORES_SI = 7;
  // saturação e brilho de cada uma das 7 faixas
  const FAIXAS = [
    [0.25, 1.0], [0.25, 0.75], [0.5, 0.75], [0.667, 0.75],
    [1.0, 1.0], [1.0, 0.75], [1.0, 0.5],
  ];

  const hsiParaRgb = (h, s, i) => {
    if (i === 0) return [0, 0, 0];
    if (s === 0) {
      const v = Math.round(i * 255);
      return [v, v, v];
    }
    let r = 0;
    let g = 0;
    let b = 0;
    const baixo = i * (1 - s);
    if (h < 1 / 6) { r = i; b = baixo; g = b + (i - b) * 6 * h; }
    else if (h < 2 / 6) { g = i; b = baixo; r = g - (i - b) * (6 * h - 1); }
    else if (h < 3 / 6) { g = i; r = baixo; b = r + (i - r) * (6 * h - 2); }
    else if (h < 4 / 6) { b = i; r = baixo; g = b - (i - r) * (6 * h - 3); }
    else if (h < 5 / 6) { b = i; g = baixo; r = g + (i - g) * (6 * h - 4); }
    else { r = i; g = baixo; b = r - (r - g) * (6 * h - 5); }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  };

  const cores = [];
  for (let c = 0; c < PASSOS_H * VALORES_SI; c++) {
    if (c % PASSOS_H === 0) {
      // A coluna dos cinzas: do branco (c=0) ao quase-preto, um degrau por faixa.
      cores.push(hsiParaRgb(0, 0, 1 - c / PASSOS_H / VALORES_SI));
      continue;
    }
    const [s, i] = FAIXAS[Math.floor(c / PASSOS_H)];
    cores.push(hsiParaRgb(((c % PASSOS_H) * 1) / 18, s, i));
  }
  return cores;
}

/** `[r, g, b]` por índice. 133 posições. */
export const PALETA = gerarPaleta();

export const hexDaCor = (i) => {
  const [r, g, b] = PALETA[i] ?? PALETA[0];
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

/**
 * As quatro regiões, na ordem em que viajam no pacote e aparecem no editor.
 *
 * `chave` é o nome usado no `visual` do jogador; `i18n` é a chave do rótulo na tela.
 */
export const REGIOES = [
  { chave: 'cabeca', i18n: 'ob.peca.cabeca' },
  { chave: 'corpo', i18n: 'ob.peca.corpo' },
  { chave: 'pernas', i18n: 'ob.peca.pernas' },
  { chave: 'pes', i18n: 'ob.peca.pes' },
];

/** O visual com que o editor abre. São índices da paleta de 133. */
export const VISUAL_PADRAO = { cabeca: 78, corpo: 69, pernas: 114, pes: 114 };

/**
 * Peneira um visual vindo do banco, da rede ou do `localStorage`.
 *
 * Aceita as DUAS formas em que ele circula: o objeto `{cabeca, corpo, pernas, pes}` (banco e
 * editor) e o array `[cabeca, corpo, pernas, pes]` (o campo `vs` do pacote). Aceitar só o
 * objeto fazia todo pacote de campo cair silenciosamente nas cores padrão — o array não tem
 * as chaves, então as quatro leituras davam `undefined` e o `??` devolvia o padrão.
 */
export function normalizarVisual(v) {
  const lido = Array.isArray(v)
    ? Object.fromEntries(REGIOES.map((r, i) => [r.chave, v[i]]))
    : v;
  const saida = {};
  for (const { chave } of REGIOES) {
    const n = Number(lido?.[chave]);
    saida[chave] = Number.isInteger(n) && n >= 0 && n < PALETA.length ? n : VISUAL_PADRAO[chave];
  }
  return saida;
}

/** `[cabeca, corpo, pernas, pes]` — o que vai no campo `vs` do pacote de campo. */
export const empacotarVisual = (visual) => {
  const v = normalizarVisual(visual);
  return REGIOES.map((r) => v[r.chave]);
};

// ------------------------------------------------------------- a colorização

/**
 * Pinta UM quadro: lê o retângulo do sprite base e o da máscara, e multiplica.
 *
 * Os dois retângulos vêm do mesmo atlas e têm o mesmo tamanho — o empacotador guarda a
 * máscara na célula ao lado do quadro que ela descreve.
 */
function pintarQuadro(ctxDestino, dx, dy, imagem, quadro, mascara, cores) {
  const w = quadro.w;
  const h = quadro.h;

  // Um canvas de rascunho por quadro seria lento no meio da lista; um só, reaproveitado,
  // resolve — a colorização acontece uma vez por visual e fica em cache.
  const rascunho = pintarQuadro.rascunho ??= document.createElement('canvas');
  const cx = rascunho.getContext('2d', { willReadFrequently: true });
  if (rascunho.width < w * 2 || rascunho.height < h) {
    rascunho.width = Math.max(rascunho.width, w * 2);
    rascunho.height = Math.max(rascunho.height, h);
  }
  cx.clearRect(0, 0, rascunho.width, rascunho.height);
  cx.imageSmoothingEnabled = false;
  cx.drawImage(imagem, quadro.x, quadro.y, w, h, 0, 0, w, h);
  cx.drawImage(imagem, mascara.x, mascara.y, w, h, w, 0, w, h);

  const base = cx.getImageData(0, 0, w, h);
  const masc = cx.getImageData(w, 0, w, h);
  const b = base.data;
  const m = masc.data;

  for (let i = 0; i < b.length; i += 4) {
    if (b[i + 3] === 0 || m[i + 3] === 0) continue;
    // A máscara é chapada nas quatro cores puras, mas o `.webp` pode ter deixado um pixel de
    // borda a meio caminho: compara-se por MAIORIA de canal, não por igualdade exata.
    const alto = 128;
    const r = m[i] >= alto;
    const g = m[i + 1] >= alto;
    const az = m[i + 2] >= alto;
    let cor = null;
    if (r && g) cor = cores[0];        // amarelo → cabeça
    else if (r) cor = cores[1];        // vermelho → tronco
    else if (g) cor = cores[2];        // verde → pernas
    else if (az) cor = cores[3];       // azul → pés
    if (!cor) continue;

    b[i] = (b[i] * cor[0]) / 255;
    b[i + 1] = (b[i + 1] * cor[1]) / 255;
    b[i + 2] = (b[i + 2] * cor[2]) / 255;
  }

  cx.putImageData(base, 0, 0);
  ctxDestino.drawImage(rascunho, 0, 0, w, h, dx, dy, w, h);
}

const cache = new Map();

/**
 * Um sprite colorizado, na MESMA forma que `carregarOutfit` devolve.
 *
 * O atlas novo é montado uma vez por (looktype, cores) e fica no cache: quem desenha continua
 * fazendo `drawImage` de um retângulo, sem custo por quadro. Sem o cache, cada tick do campo
 * repintaria 12 quadros pixel a pixel para cada treinador na tela.
 *
 * Devolve o sprite ORIGINAL quando não há máscara (todo pokémon) ou quando não há cores a
 * aplicar — colorizar sem máscara não teria o que pintar.
 */
export function colorizar(sprite, visual, chaveCache) {
  if (!sprite) return sprite;
  const temMascara = Object.values(sprite.byDir).some((qs) => qs.some((q) => q.mascara));
  if (!temMascara || !visual) return sprite;

  const v = normalizarVisual(visual);
  const chave = `${chaveCache}|${empacotarVisual(v).join(',')}`;
  if (cache.has(chave)) return cache.get(chave);

  const cores = REGIOES.map((r) => PALETA[v[r.chave]]);
  const dirs = Object.keys(sprite.byDir).map(Number).sort();
  const colunas = Math.max(...dirs.map((d) => sprite.byDir[d].length));
  const w = sprite.frameW;
  const h = sprite.frameH;

  const atlas = document.createElement('canvas');
  atlas.width = w * colunas;
  atlas.height = h * dirs.length;
  const ctx = atlas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const byDir = {};
  dirs.forEach((d, linha) => {
    byDir[d] = sprite.byDir[d].map((q, i) => {
      const dx = i * w;
      const dy = linha * h;
      const img = sprite.imagens[q.pagina];
      if (img && q.mascara) pintarQuadro(ctx, dx, dy, img, q, q.mascara, cores);
      // Quadro sem máscara própria entra como está: melhor um quadro sem cor do que um buraco.
      else if (img) ctx.drawImage(img, q.x, q.y, q.w, q.h, dx, dy, q.w, q.h);
      return { pagina: 0, x: dx, y: dy, w: q.w, h: q.h };
    });
  });

  const saida = { ...sprite, byDir, imagens: [atlas] };
  cache.set(chave, saida);
  return saida;
}
