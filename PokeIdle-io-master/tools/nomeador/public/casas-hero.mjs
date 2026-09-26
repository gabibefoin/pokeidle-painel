/** Sprite do treinador no lab Casas — atlas em `/data/asset-packs` (mesmo do mapview). */

const PACK = '/data/asset-packs';
const localize = (p) => p.replace(/^\/assets-packs/, PACK);

let indicePromise = null;
const cacheOutfit = new Map();
const cacheImg = new Map();

const carregarImagem = (src) => {
  if (!cacheImg.has(src)) {
    cacheImg.set(
      src,
      new Promise((ok, err) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => err(new Error(src));
        img.src = src;
      }),
    );
  }
  return cacheImg.get(src);
};

export function quadrosDe(sprite, dir) {
  return sprite.byDir[dir]?.length
    ? sprite.byDir[dir]
    : sprite.byDir[3] ?? Object.values(sprite.byDir)[0] ?? [];
}

/** Treinador masculino padrão do jogo. */
export function carregarOutfit(looktype = 159) {
  if (cacheOutfit.has(looktype)) return cacheOutfit.get(looktype);

  const p = (async () => {
    const idx = await (indicePromise ??= fetch(`${PACK}/outfits-index.json`)
      .then((r) => r.json())
      .then((j) => j.outfits));
    const entry = idx[String(looktype)];
    if (!entry) return null;

    const manifest = await fetch(localize(entry.manifest)).then((r) => r.json());
    const cat = Object.values(manifest.categories)[0];
    const imagens = await Promise.all(cat.pages.map((pg) => carregarImagem(localize(pg.image))));

    const byDir = {};
    for (const [chave, asset] of Object.entries(manifest.assets)) {
      const stem = chave.split('/').pop().replace(/\.png$/, '');
      if (stem.endsWith('_template')) continue;
      const n = stem.split('_').map(Number);
      const f = asset.frames[0];
      if (!f) continue;
      ((byDir[n[3]] ??= [])[n[0] - 1] = {
        pagina: f.page ?? 0,
        x: f.x,
        y: f.y,
        w: asset.width,
        h: asset.height,
      });
    }
    for (const d of Object.keys(byDir)) byDir[d] = byDir[d].filter(Boolean);

    return { byDir, imagens };
  })().catch(() => null);

  cacheOutfit.set(looktype, p);
  return p;
}

export function dirDeMovimento(dx, dy, atual = 3) {
  if (dy < 0) return 1;
  if (dy > 0) return 3;
  if (dx < 0) return 4;
  if (dx > 0) return 2;
  return atual;
}

/** Desenha o treinador com o pé no centro da tile (cx, cy), como no cliente. */
export function desenharHero(ctx, sprite, cx, cy, { dir = 3, andando = false, fase = 0, escala = 1 } = {}) {
  const quadros = quadrosDe(sprite, dir);
  if (!quadros.length) return false;

  let idx = 0;
  if (andando && quadros.length > 1) {
    const ciclo = quadros.length - 1;
    idx = 1 + Math.min(ciclo - 1, Math.floor(fase * ciclo));
  }
  const q = quadros[idx];
  const img = sprite.imagens[q.pagina];
  if (!img) return false;

  const s = escala;
  const peY = cy + 11.52 * s;
  const x = Math.round(cx - (q.w * s) / 2);
  const y = Math.round(peY - q.h * s);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 8 * s, Math.min(14 * s, (q.w * s) / 2.6), 4.5 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.drawImage(img, q.x, q.y, q.w, q.h, x, y, q.w * s, q.h * s);
  ctx.restore();
  return true;
}
