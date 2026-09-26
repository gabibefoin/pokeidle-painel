/**
 * POKÉIDLE HUB — MOTOR DE SPRITES ANIMADOS EM PIXEL ART
 * Renderiza e anima outfits oficiais dos asset packs do jogo em canvas pixelated.
 */

let outfitsIndex = null;
const manifestCache = new Map();
const imageCache = new Map();

export async function carregarIndiceOutfits() {
  if (outfitsIndex) return outfitsIndex;
  try {
    const res = await fetch('assets/asset-packs/outfits-index.json');
    const data = await res.json();
    outfitsIndex = data.outfits || {};
    return outfitsIndex;
  } catch (e) {
    console.warn('Falha ao carregar outfits-index.json:', e);
    return {};
  }
}

function carregarImagem(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn('Falha ao carregar imagem:', url);
      resolve(null);
    };
    img.src = url;
  });
  imageCache.set(url, p);
  return p;
}

export async function carregarOutfitManifest(looktype) {
  if (manifestCache.has(looktype)) return manifestCache.get(looktype);
  const idx = await carregarIndiceOutfits();
  const entry = idx[String(looktype)];
  if (!entry || !entry.manifest) return null;

  const manifestUrl = entry.manifest.startsWith('/') ? 'assets' + entry.manifest.replace('/assets-packs', '/asset-packs') : 'assets/' + entry.manifest;
  
  const p = (async () => {
    try {
      const res = await fetch(manifestUrl);
      const manifest = await res.json();
      const cat = Object.values(manifest.categories)[0];
      if (!cat) return null;

      const imagens = await Promise.all(cat.pages.map(pg => {
        const imgUrl = pg.image.startsWith('/') 
          ? 'assets' + pg.image.replace('/assets-packs', '/asset-packs') 
          : 'assets/' + pg.image;
        return carregarImagem(imgUrl);
      }));

      const byDir = {};
      for (const [chave, asset] of Object.entries(manifest.assets)) {
        const stem = chave.split('/').pop().replace(/\.png$/, '');
        if (stem.endsWith('_template')) continue;
        const n = stem.split('_').map(Number); // [frame, layer, ?, dir]
        const f = asset.frames[0];
        if (!f) continue;
        const rect = { pagina: f.page ?? 0, x: f.x, y: f.y, w: f.w, h: f.h };
        const dir = n[3] || 3;
        const frameIdx = (n[0] || 1) - 1;
        (byDir[dir] ??= [])[frameIdx] = rect;
      }

      for (const d of Object.keys(byDir)) {
        byDir[d] = byDir[d].filter(Boolean);
      }

      return {
        byDir,
        imagens,
        entry
      };
    } catch (e) {
      console.warn(`Erro ao carregar manifest looktype ${looktype}:`, e);
      return null;
    }
  })();

  manifestCache.set(looktype, p);
  return p;
}

/**
 * Cria um elemento canvas com o sprite pixel-art animado
 * @param {number} looktype ID do looktype
 * @param {number} caixa Tamanho em px (ex: 96)
 * @param {number} dir Direção (1=Norte, 2=Leste, 3=Sul/Frente, 4=Oeste)
 * @param {string} fallbackUrl URL de fallback se falhar
 */
function getSpriteDirectionColumn(img, dir = 3) {
  const tile = img.height || 32;
  const totalCols = Math.floor(img.width / tile);
  if (totalCols <= 1) return 0;

  const tempCv = document.createElement('canvas');
  tempCv.width = img.width;
  tempCv.height = 1;
  const tempCtx = tempCv.getContext('2d');
  tempCtx.drawImage(img, 0, 0);
  const imgData = tempCtx.getImageData(0, 0, img.width, 1).data;

  let activeCols = 0;
  for (let c = 0; c < totalCols; c++) {
    const pxIdx = (c * tile + Math.floor(tile / 2)) * 4 + 3;
    if (imgData[pxIdx] > 0) {
      activeCols++;
    } else {
      break;
    }
  }

  if (activeCols < 4) return 0;

  const framesPerDir = Math.floor(activeCols / 4);
  const dirIdx = (dir === 3) ? 2 : (dir === 1 ? 0 : (dir === 2 ? 1 : 3));
  const startCol = dirIdx * framesPerDir;
  return startCol;
}

export function criarCanvasSprite(looktype, caixa = 96, dir = 3, fallbackUrl = null) {
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 32;
  cv.style.width = `${caixa}px`;
  cv.style.height = `${caixa}px`;
  cv.style.imageRendering = 'pixelated';
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  carregarOutfitManifest(looktype).then(sprite => {
    if (!sprite || !sprite.byDir[dir] || !sprite.byDir[dir].length) {
      // Fallback para sprite estático ou spritesheet legado
      if (fallbackUrl) {
        carregarImagem(fallbackUrl).then(img => {
          if (!img) return;
          ctx.clearRect(0, 0, cv.width, cv.height);
          const tile = img.height || 32;
          if (img.width >= 4 * tile) {
            const col = getSpriteDirectionColumn(img, dir);
            ctx.drawImage(img, col * tile, 0, tile, tile, 0, 0, cv.width, cv.height);
          } else {
            ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, cv.width, cv.height);
          }
        });
      }
      return;
    }

    const quadros = sprite.byDir[dir] || sprite.byDir[3] || Object.values(sprite.byDir)[0] || [];
    if (!quadros.length) return;

    cv.width = quadros[0].w;
    cv.height = quadros[0].h;

    let i = 0;
    const pintar = () => {
      const q = quadros[i++ % quadros.length];
      const img = sprite.imagens[q.pagina];
      if (!img) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, q.x, q.y, q.w, q.h, 0, 0, cv.width, cv.height);
    };

    pintar();

    if (quadros.length > 1) {
      const timer = setInterval(() => {
        if (!cv.isConnected) {
          clearInterval(timer);
          return;
        }
        pintar();
      }, 220);
    }
  });

  return cv;
}
