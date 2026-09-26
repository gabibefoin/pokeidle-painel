
const SEM_CACHE = { cache: 'no-cache' }; // ver a nota em app.js

// Prepara o mapa de tiles de uma hunt para ser desenhado ao vivo, com a câmera andando.
//
// O sprite-lab renderiza mapa inteiro num canvas gigante (public/mapview.mjs). Aqui é outro
// problema: a câmera segue o herói, e os pokémon precisam passar ATRÁS das árvores. Então o
// mapa vira duas coisas:
//
//   · `chao`  — um canvas único, pintado uma vez, com os andares de baixo e a banda de chão
//               do andar da hunt. Nada disso pode cobrir um pokémon, então pode ser um blit só.
//   · `ops`   — a banda de itens (árvores, pedras, paredes) e os andares de cima, cada sprite
//               com a sua profundidade. Estes o campo intercala com os pokémon a cada quadro.
//
// A profundidade é a do cliente deles: `ez(x,y) = (x+y)*4096 + 4x`, com a banda de itens
// somando 8e6 e cada andar somando 1e9 (era um container por andar, empilhado em ordem).
// A ordem de desenho DENTRO de uma tile também é a deles (chão → bordas → bottom → resto →
// top), que é o que faz a beirada de grama e a sombra da árvore caírem no lugar certo.

const PACK = '/assets/asset-packs';
const localize = (p) => p.replace(/^\/assets-packs/, PACK);

// Itens que o cliente nunca desenha (marcadores invisíveis, bordas de edição).
const OCULTOS = new Set([7124, 1510, 8274, 46638, 46639, 46620, 46621, 1511, 1024]);

/** Chave de profundidade de uma tile. Idêntica à do bundle deles. */
export const ez = (x, y) => (x + y) * 4096 + 4 * x;

/** Acima disto é banda de item: intercala com os pokémon em vez de ir para o `chao`. */
export const BANDA_ITEM = 8e6;
export const POR_ANDAR = 1e9;

/** Quantas tiles de cenário além da área andável entram no canvas (a câmera mostra ~12). */
const MARGEM_TILES = 12;
/** Folga em px para sprites altos (árvore de 96px sobe para fora da tile dela). */
const FOLGA = 128;
/** Teto do canvas de chão; acima disto a margem encolhe em vez de estourar a memória. */
const MAX_PIXELS = 14e6;

let packPromise = null;
let tabelasPromise = null;
const cachePagina = new Map();
const cacheMapa = new Map();

const carregarImagem = (src) =>
  new Promise((ok, err) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => err(new Error(`falhou: ${src}`));
    img.src = src;
  });

/** Manifest do atlas de tiles (10.338 assets em 30 páginas .webp). */
function carregarPack() {
  return (packPromise ??= (async () => {
    const version = await fetch(`${PACK}/version.json`).then((r) => r.json());
    const index = await fetch(localize(version.index)).then((r) => r.json());
    const cat = Object.values(index.categories)[0];
    const manifest = await fetch(localize(cat.manifest)).then((r) => r.json());
    const pages = Object.values(manifest.categories)[0].pages.map((p) => localize(p.image));
    return { assets: manifest.assets, pages };
  })());
}

/** offsets.json (deslocamento/elevação), collision.json e draworder.json. */
function carregarTabelas() {
  return (tabelasPromise ??= (async () => {
    const [offsets, collision, draworder] = await Promise.all([
      fetch('/assets/world/offsets.json', SEM_CACHE).then((r) => r.json()),
      fetch('/assets/world/collision.json', SEM_CACHE).then((r) => r.json()),
      fetch('/assets/world/draworder.json', SEM_CACHE).then((r) => r.json()),
    ]);
    return {
      disp: offsets.disp ?? {},
      elev: offsets.elev ?? {},
      bloqueia: new Set(collision.blocking ?? []),
      top: new Set(draworder.top ?? []),
      bottom: new Set(draworder.bottom ?? []),
      borda: new Set(draworder.borders ?? []),
    };
  })());
}

const paginaImg = (pages, i) => {
  if (!cachePagina.has(i)) cachePagina.set(i, carregarImagem(pages[i]));
  return cachePagina.get(i);
};

// Sprites com patternX/patternY variam conforme a coordenada no mundo — é o que faz uma
// mesma grama render texturas diferentes lado a lado.
function quadroDe(a, px, py, centro) {
  if (!a.patternX && !a.patternY) return 0;
  const pX = a.patternX || 1;
  const pY = a.patternY || 1;
  const animLen = a.animLen || 1;
  const cx = centro[0] + Math.round(px / 32);
  const cy = centro[1] + Math.round(py / 32);
  const idx = ((((cy % pY) + pY) % pY) * pX + (((cx % pX) + pX) % pX)) * animLen;
  return idx < a.frames.length ? idx : 0;
}

/**
 * Monta o mapa da hunt.
 *
 * @param slug  hunt
 * @param caixa {minTx, minTy, cols, rows, groundZ} — a área andável que o servidor mandou
 * @returns {{chao, ox, oy, ops, limites}}  `ox/oy` = px de mundo do canto do canvas de chão
 */
/**
 * Larga os mapas e as páginas de tile que estão em memória.
 *
 * Só o MODO ECONOMIA chama. Cada mapa montado é um canvas de dezenas de MB (ver o comentário
 * no fim de `prepararMapa`), e as páginas do tileset são as imagens grandes que o alimentam —
 * as duas coisas existem para desenhar a cena, e mais nada no jogo lê estes caches. Com a cena
 * desligada, é a maior mordida de memória que dá para devolver ao navegador.
 *
 * Não custa download na volta: o `prepararMapa` refaz o canvas a partir dos arquivos, que o
 * navegador já tem no cache de HTTP. O que se paga é a remontagem, e ela já acontece de
 * qualquer jeito a cada troca de área.
 */
export function soltarMapas() {
  cacheMapa.clear();
  cachePagina.clear();
}

export async function prepararMapa(slug, caixa, onProgress) {
  const chave = `${slug}:${caixa.minTx},${caixa.minTy},${caixa.cols},${caixa.rows}`;
  if (cacheMapa.has(chave)) return cacheMapa.get(chave);

  const p = (async () => {
    onProgress?.('carregando o mapa…');
    const [{ assets, pages }, tab, mapa] = await Promise.all([
      carregarPack(),
      carregarTabelas(),
      fetch(`/assets/world/maps/${slug}.json`).then((r) => {
        if (!r.ok) throw new Error(`mapa "${slug}" não está no espelho`);
        return r.json();
      }),
    ]);

    const meta = mapa._meta ?? {};
    const centro = meta.center ?? [0, 0];
    const groundZ = caixa.groundZ ?? meta.groundZ ?? 7;

    // Recorte: a área andável mais uma faixa de cenário em volta.
    let margem = MARGEM_TILES;
    const dims = (m) => ({
      larg: (caixa.cols + 2 * m) * 32 + 2 * FOLGA,
      alt: (caixa.rows + 2 * m) * 32 + 2 * FOLGA,
    });
    while (margem > 2 && dims(margem).larg * dims(margem).alt > MAX_PIXELS) margem -= 2;

    const x0 = caixa.minTx - margem;
    const y0 = caixa.minTy - margem;
    const x1 = caixa.minTx + caixa.cols - 1 + margem;
    const y1 = caixa.minTy + caixa.rows - 1 + margem;
    const { larg, alt } = dims(margem);
    const ox = x0 * 32 - FOLGA;
    const oy = y0 * 32 - FOLGA;

    const tiles = (mapa.tiles ?? []).filter((t) => t[0] >= x0 && t[0] <= x1 && t[1] >= y0 && t[1] <= y1);

    // Índice de COBERTURA: quais tiles de andar de cima têm chão próprio.
    //
    // Sem isto, numa caverna, num telhado ou dentro da pirâmide do Abra o andar de cima é
    // desenhado por último e some com o mapa inteiro. O cliente deles resolve escondendo os
    // andares acima do jogador quando algum deles o cobre — é o `computeFirstVisibleFloor`.
    // Varre o mapa todo (não só o recorte) porque a checagem olha para (tx+n, ty+n).
    let minZ = groundZ;
    const cobre = new Set();
    for (const t of mapa.tiles ?? []) {
      if (t[2] < minZ) minZ = t[2];
      if (t[2] < groundZ && t[3]) cobre.add(`${t[0]},${t[1]},${t[2]}`);
    }

    // Só as páginas do atlas que este recorte usa.
    const usados = new Set();
    for (const t of tiles) {
      if (t[3]) usados.add(t[3]);
      for (const it of t[4]) usados.add(it[0]);
    }
    const paginas = new Set();
    for (const id of usados) {
      const a = assets[String(id)];
      if (a) for (const f of a.frames) paginas.add(f.page);
    }
    onProgress?.(`${paginas.size} páginas do atlas…`);
    const imgs = new Map();
    await Promise.all([...paginas].map(async (i) => imgs.set(i, await paginaImg(pages, i))));

    // ---------------------------------------------------- lista de sprites
    //
    // Uma passada só: cada sprite vira uma op com a sua profundidade. Depois a lista é
    // ordenada e cortada em duas — o que fica abaixo dos pokémon vai para o canvas de chão.
    const ops = [];

    const colocar = (id, px, py, elevAcum, prof, z) => {
      const a = assets[String(id)];
      if (!a) return 0; // 1.116 ids não existem no atlas; o cliente deles também pula
      const f = a.frames[quadroDe(a, px, py, centro)];
      const d = tab.disp[id];
      ops.push({
        prof,
        z,
        pagina: f.page,
        sx: f.x,
        sy: f.y,
        w: f.w,
        h: f.h,
        x: px - (a.width - 32) - (d ? d[0] : 0),
        y: py - (a.height - 32) - (d ? d[1] : 0) - elevAcum,
      });
      return tab.elev[id] ?? 0;
    };

    // Porte fiel do buildTile deles: banda (chão/item), sub-ordem e elevação acumulada.
    const montarTile = (t) => {
      const off = (t[2] - groundZ) * 32;
      const px = 32 * t[0] + off;
      const py = 32 * t[1] + off;
      const base = ez(t[0], t[1]) + (groundZ - t[2]) * POR_ANDAR;

      let elev = 0;
      let ultima = base - 1;

      const por = (id) => {
        if (OCULTOS.has(id)) return;
        const a = assets[String(id)];
        const chao = a?.isGround === true;
        const banda = chao || (tab.borda.has(id) && !tab.top.has(id)) ? 'g' : 'i';
        const sub = chao ? -1 : tab.top.has(id) ? 0.6 : tab.bottom.has(id) ? 0 : 0.3;
        const prof = Math.max(base + sub + (banda === 'g' ? 0 : BANDA_ITEM), ultima + 0.001);
        ultima = prof;
        elev = Math.min(32, elev + colocar(id, px, py, elev, prof, t[2]));
      };

      const ehTop = (id) => tab.top.has(id);
      const ehBottom = (id) => tab.bottom.has(id) && !ehTop(id);
      const ehChao = (id) => assets[String(id)]?.isGround === true;
      const ehBorda = (id) => tab.borda.has(id) && !ehTop(id) && !ehChao(id);
      const bottomPuro = (id) => ehBottom(id) && !ehBorda(id) && !ehChao(id);
      const meio = (id) => !ehTop(id) && !ehBottom(id);
      const alto = (id) => tab.bloqueia.has(id) || (tab.elev[id] ?? 0) > 0;
      const invertidos = t[4].length > 1 ? [...t[4]].reverse() : t[4];

      if (t[3]) por(t[3]);
      for (const it of t[4]) if (ehBottom(it[0]) && ehChao(it[0])) por(it[0]);
      for (const it of invertidos) if (ehBorda(it[0])) por(it[0]);
      for (const it of t[4]) if (bottomPuro(it[0])) por(it[0]);
      for (const it of t[4]) if (meio(it[0]) && alto(it[0])) por(it[0]);
      for (const it of t[4]) if (meio(it[0]) && !alto(it[0])) por(it[0]);
      for (const it of invertidos) if (ehTop(it[0])) por(it[0]);
    };

    onProgress?.('montando o cenário…');
    for (const t of tiles) montarTile(t);
    ops.sort((a, b) => a.prof - b.prof);

    // ------------------------------------------------------- assar o chão
    const chao = document.createElement('canvas');
    chao.width = larg;
    chao.height = alt;
    const ctx = chao.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Tudo que tem profundidade abaixo da banda de itens do andar da hunt é cenário de fundo:
    // andares de baixo inteiros e a banda de chão daqui. Vira um blit só por quadro.
    let corte = 0;
    while (corte < ops.length && ops[corte].prof < BANDA_ITEM) corte++;
    for (let i = 0; i < corte; i++) {
      const o = ops[i];
      const img = imgs.get(o.pagina);
      if (img) ctx.drawImage(img, o.sx, o.sy, o.w, o.h, o.x - ox, o.y - oy, o.w, o.h);
    }

    const dinamicas = ops.slice(corte);
    for (const o of dinamicas) o.img = imgs.get(o.pagina);

    return {
      slug,
      chao,
      ox,
      oy,
      larg,
      alt,
      groundZ,
      minZ,
      ops: dinamicas.filter((o) => o.img),
      // limites da câmera, em px de mundo
      limites: { x0: x0 * 32, y0: y0 * 32, x1: (x1 + 1) * 32, y1: (y1 + 1) * 32 },

      /**
       * Andar mais alto que ainda deve ser desenhado com o herói em (tx, ty).
       *
       * Idêntico ao `computeFirstVisibleFloor` deles: sobe andar a andar a partir do de cima;
       * o primeiro que tiver chão em (tx+n, ty+n) está cobrindo o herói, e a partir dali
       * (inclusive) tudo some. Sem cobertura nenhuma, desenha até o topo.
       */
      primeiroAndarVisivel(tx, ty) {
        for (let z = groundZ - 1; z >= minZ; z--) {
          const n = groundZ - z;
          if (cobre.has(`${tx + n},${ty + n},${z}`)) return z + 1;
        }
        return minZ;
      },
    };
  })();

  cacheMapa.set(chave, p);
  // um mapa que falhou não fica envenenando o cache
  p.catch(() => cacheMapa.delete(chave));
  // só guardamos dois mapas: cada um tem um canvas de dezenas de MB
  if (cacheMapa.size > 2) cacheMapa.delete(cacheMapa.keys().next().value);
  return p;
}
