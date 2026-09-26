// Renderizador dos mapas de tiles, portado da lógica do cliente deles (PixiJS → canvas 2D).
//
// Um mapa é uma lista de tiles [x, y, z, chãoId, [[itemId], …]]. Cada id vira um sprite no
// atlas map-items. O posicionamento segue o placeSprite() do cliente:
//
//   x = 32*tx - (largura - 32) - disp[0]
//   y = 32*ty - (altura  - 32) - disp[1] - elevaçãoAcumulada
//
// onde disp vem de offsets.json (deslocamento do item) e a elevação acumula item a item na
// mesma tile. Andares são desenhados de maxZ para minZ, cada um deslocado em (z-groundZ)*32,
// e as tiles ordenadas por z desc, y asc, x asc — pintor clássico.
//
// Diferença conhecida em relação ao cliente: não reproduzo as sub-ordens de draworder.json
// (top/bottom/toppers/borders) dentro de uma mesma tile, uso a ordem do próprio array.

const DATA = 'data';
const PACK = `${DATA}/asset-packs`;
const localize = (p) => p.replace(/^\/assets-packs/, PACK);

// Itens que o cliente nunca desenha (marcadores invisíveis, bordas de edição).
const OCULTOS = new Set([7124, 1510, 8274, 46638, 46639, 46620, 46621, 1511, 1024]);

let packPromise = null;
let tabelasPromise = null;
const pageCache = new Map();

const loadImage = (src) =>
  new Promise((ok, err) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => err(new Error(`falhou: ${src}`));
    img.src = src;
  });

/** Manifest do atlas de tiles (10.338 assets em 30 páginas). */
export function carregarPack() {
  return (packPromise ??= (async () => {
    const version = await fetch(`${PACK}/version.json`).then((r) => r.json());
    const index = await fetch(localize(version.index)).then((r) => r.json());
    const cat = Object.values(index.categories)[0];
    const manifest = await fetch(localize(cat.manifest)).then((r) => r.json());
    const pages = Object.values(manifest.categories)[0].pages.map((p) => localize(p.image));
    return { assets: manifest.assets, pages };
  })());
}

/** offsets.json (disp/elev), collision.json e draworder.json (ordem dentro da tile). */
export function carregarTabelas() {
  return (tabelasPromise ??= (async () => {
    const [offsets, collision, draworder] = await Promise.all([
      fetch(`${DATA}/world/offsets.json`).then((r) => r.json()),
      fetch(`${DATA}/world/collision.json`).then((r) => r.json()),
      fetch(`${DATA}/world/draworder.json`).then((r) => r.json()).catch(() => ({})),
    ]);
    return {
      disp: offsets.disp ?? {},
      elev: offsets.elev ?? {},
      blocking: new Set(collision.blocking ?? []),
      top: new Set(draworder.top ?? []),
      bottom: new Set(draworder.bottom ?? []),
      borda: new Set(draworder.borders ?? []),
    };
  })());
}

function ensurePage(pages, i) {
  if (!pageCache.has(i)) pageCache.set(i, loadImage(pages[i]));
  return pageCache.get(i);
}

// Sprites com patternX/patternY variam conforme a coordenada no mundo — é assim que um
// mesmo id de grama rende texturas diferentes lado a lado.
function frameIndexFor(a, px, py, center) {
  if (!a.patternX && !a.patternY) return 0;
  const pX = a.patternX || 1;
  const pY = a.patternY || 1;
  const animLen = a.animLen || 1;
  const cx = center[0] + Math.round(px / 32);
  const cy = center[1] + Math.round(py / 32);
  const idx = ((((cy % pY) + pY) % pY) * pX + (((cx % pX) + pX) % pX)) * animLen;
  return idx < a.frames.length ? idx : 0;
}

/**
 * Desenha um mapa inteiro num canvas.
 * @param {object} [opts]
 * @param {number} [opts.escala]
 * @param {function} [opts.onProgress]
 * @param {number[]} [opts.regiao]
 * @param {'rua'|'completo'|'corte'|'interior'} [opts.visao]
 * @param {{x:number,y:number}} [opts.visaoEm]
 * @param {number} [opts.primeiroVisivelFixo] força o andar visível (escadas no lab)
 */
export async function renderMapa(slug, { escala, onProgress, regiao, visao = 'completo', visaoEm = null, primeiroVisivelFixo = null } = {}) {
  const [{ assets, pages }, tabelas, mapa] = await Promise.all([
    carregarPack(),
    carregarTabelas(),
    fetch(`${DATA}/world/maps/${slug}.json`).then((r) => {
      if (!r.ok) throw new Error(`mapa "${slug}" não baixado (rode: node tools/fetch-world.mjs --maps)`);
      return r.json();
    }),
  ]);

  const meta = mapa._meta ?? {};
  const groundZ = meta.groundZ ?? meta.range?.[4] ?? 7;
  const center = meta.center ?? [0, 0];
  let tiles = mapa.tiles ?? [];

  if (regiao) {
    const [rx0, ry0, rx1, ry1] = regiao;
    const pad = 5;
    tiles = tiles.filter(
      (t) => t[0] >= rx0 - pad && t[0] <= rx1 + pad && t[1] >= ry0 - pad && t[1] <= ry1 + pad,
    );
    if (!tiles.length) throw new Error('região sem tiles — alargue a caixa');
  }

  // Limites em "tile de tela", já com o deslocamento de andar aplicado.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tiles) {
    const sx = t[0] + (t[2] - groundZ);
    const sy = t[1] + (t[2] - groundZ);
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  if (!Number.isFinite(minX)) throw new Error('mapa sem tiles');

  // Margem à esquerda/topo porque sprites altos (árvores, paredes) sobem para fora da tile.
  const MARGEM = 96;
  const larguraNat = (maxX - minX + 1) * 32 + MARGEM;
  const alturaNat = (maxY - minY + 1) * 32 + MARGEM;

  // Mapas grandes viram canvas de 30+ megapixels; cai para 0,5× automaticamente.
  const s = escala ?? (larguraNat * alturaNat > 12e6 ? 0.5 : 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(larguraNat * s);
  canvas.height = Math.ceil(alturaNat * s);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = s < 1; // suaviza só quando está reduzindo
  ctx.setTransform(s, 0, 0, s, 0, 0);

  const origemX = minX * 32 - MARGEM;
  const origemY = minY * 32 - MARGEM;

  // Cobertura de andares — mesma ideia do `primeiroAndarVisivel` em mapa.mjs.
  let minZ = groundZ;
  const cobre = new Set();
  for (const t of mapa.tiles ?? []) {
    if (t[2] < minZ) minZ = t[2];
    if (t[2] < groundZ && t[3]) cobre.add(`${t[0]},${t[1]},${t[2]}`);
  }
  const refTx = visaoEm?.x ?? center[0] ?? 0;
  const refTy = visaoEm?.y ?? center[1] ?? 0;
  let primeiroVisivel = minZ;
  if (primeiroVisivelFixo != null && Number.isFinite(primeiroVisivelFixo)) {
    primeiroVisivel = primeiroVisivelFixo;
  } else if (visao === 'corte' || visao === 'interior') {
    for (let z = groundZ - 1; z >= minZ; z--) {
      const n = groundZ - z;
      if (cobre.has(`${refTx + n},${refTy + n},${z}`)) {
        primeiroVisivel = z + 1;
        break;
      }
    }
  }
  const tileVisivel = (z) => {
    if (visao === 'completo') return true;
    if (visao === 'rua') return z <= groundZ;
    if (visao === 'corte') return z >= primeiroVisivel;
    if (visao === 'interior') return z <= groundZ && z >= primeiroVisivel;
    return true;
  };

  // Carrega só as páginas do atlas que este mapa usa.
  const idsUsados = new Set();
  for (const t of tiles) {
    if (t[3]) idsUsados.add(t[3]);
    for (const it of t[4]) idsUsados.add(it[0]);
  }
  const paginas = new Set();
  for (const id of idsUsados) {
    const a = assets[String(id)];
    if (a) for (const f of a.frames) paginas.add(f.page);
  }
  onProgress?.(`carregando ${paginas.size} páginas do atlas…`);
  const imgs = new Map();
  await Promise.all([...paginas].map(async (i) => imgs.set(i, await ensurePage(pages, i))));

  // Pintor: z decrescente (andares de baixo primeiro), depois y, depois x.
  const ordenadas = tiles.slice().sort((a, b) => b[2] - a[2] || a[1] - b[1] || a[0] - b[0]);

  let desenhados = 0;
  let faltando = 0;

  const desenhar = (id, px, py, elev) => {
    if (OCULTOS.has(id)) return 0;
    const a = assets[String(id)];
    if (!a) {
      faltando++;
      return 0;
    }
    const f = a.frames[frameIndexFor(a, px, py, center)];
    const img = imgs.get(f.page);
    if (!img) return 0;
    const d = tabelas.disp[id];
    const x = px - (a.width - 32) - (d ? d[0] : 0) - origemX;
    const y = py - (a.height - 32) - (d ? d[1] : 0) - elev - origemY;
    ctx.drawImage(img, f.x, f.y, f.w, f.h, x, y, f.w, f.h);
    desenhados++;
    return tabelas.elev[id] ?? 0;
  };

  /** Mesma sub-ordem do cliente (chão → bordas → bottom → meio → top). */
  const desenharTile = (t) => {
    const off = (t[2] - groundZ) * 32;
    const px = 32 * t[0] + off;
    const py = 32 * t[1] + off;
    let elev = 0;
    const tab = tabelas;
    const por = (id) => { elev = Math.min(32, elev + desenhar(id, px, py, elev)); };
    const ehTop = (id) => tab.top.has(id);
    const ehBottom = (id) => tab.bottom.has(id) && !ehTop(id);
    const ehChao = (id) => assets[String(id)]?.isGround === true;
    const ehBorda = (id) => tab.borda.has(id) && !ehTop(id) && !ehChao(id);
    const bottomPuro = (id) => ehBottom(id) && !ehBorda(id) && !ehChao(id);
    const meio = (id) => !ehTop(id) && !ehBottom(id);
    const alto = (id) => tab.blocking.has(id) || (tab.elev[id] ?? 0) > 0;
    const invertidos = t[4].length > 1 ? [...t[4]].reverse() : t[4];

    if (t[3]) por(t[3]);
    for (const it of t[4]) if (ehBottom(it[0]) && ehChao(it[0])) por(it[0]);
    for (const it of invertidos) if (ehBorda(it[0])) por(it[0]);
    for (const it of t[4]) if (bottomPuro(it[0])) por(it[0]);
    for (const it of t[4]) if (meio(it[0]) && alto(it[0])) por(it[0]);
    for (const it of t[4]) if (meio(it[0]) && !alto(it[0])) por(it[0]);
    for (const it of invertidos) if (ehTop(it[0])) por(it[0]);
  };

  let ultimoAviso = 0;
  for (let i = 0; i < ordenadas.length; i++) {
    const t = ordenadas[i];
    if (!tileVisivel(t[2])) continue;
    desenharTile(t);

    if (onProgress && i - ultimoAviso > 8000) {
      ultimoAviso = i;
      onProgress(`desenhando ${Math.round((i / ordenadas.length) * 100)}%…`);
      await new Promise((r) => setTimeout(r, 0)); // devolve o frame pro browser
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const tileParaPixel = (tx, ty) => {
    const px = 32 * tx - origemX + 16;
    const py = 32 * ty - origemY + 16;
    return [px * s, py * s];
  };
  const pixelParaTile = (cx, cy) => {
    const px = cx / s + origemX - 16;
    const py = cy / s + origemY - 16;
    return [Math.floor(px / 32), Math.floor(py / 32)];
  };
  return {
    canvas,
    meta,
    escala: s,
    desenhados,
    faltando,
    tiles: tiles.length,
    origemX,
    origemY,
    tileParaPixel,
    pixelParaTile,
    // converte coordenada de tile do jogo → pixel no canvas (para plotar spawns/NPCs)
    paraPixel: (tx, ty) => tileParaPixel(tx, ty),
  };
}
