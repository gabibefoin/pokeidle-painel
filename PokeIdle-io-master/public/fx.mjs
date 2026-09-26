// Player das folhas de efeito. Cada folha é uma tira VERTICAL: o quadro i fica em
// (0, i*frameH, frameW, frameH) — igual ao Rectangle(0, s*frameH, frameW, frameH) do cliente.
//
// Só anima o que está visível na tela (IntersectionObserver), senão 80+ canvas rodando
// ao mesmo tempo derrubam o frame rate.

const vivos = new Set();
const imgCache = new Map();

const carregar = (src) => {
  if (!imgCache.has(src)) {
    imgCache.set(
      src,
      new Promise((ok, err) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => err(new Error(src));
        i.src = src;
      }),
    );
  }
  return imgCache.get(src);
};

const observer = new IntersectionObserver(
  (rows) => {
    for (const row of rows) {
      const rec = row.target._fx;
      if (!rec) continue;
      if (row.isIntersecting) {
        vivos.add(rec);
        if (!rec.img && !rec.carregando) {
          rec.carregando = true;
          carregar(rec.url).then((img) => (rec.img = img)).catch(() => {});
        }
      } else {
        vivos.delete(rec);
      }
    }
  },
  { rootMargin: '200px' },
);

let rodando = false;
function tick(now) {
  for (const rec of vivos) {
    if (!rec.img) continue;
    const i = Math.floor((now / rec.frameMs) % rec.frames);
    if (i === rec.i) continue;
    rec.i = i;
    const ctx = rec.ctx;
    ctx.clearRect(0, 0, rec.frameW, rec.frameH);
    ctx.drawImage(rec.img, 0, i * rec.frameH, rec.frameW, rec.frameH, 0, 0, rec.frameW, rec.frameH);
  }
  requestAnimationFrame(tick);
}

/**
 * Canvas que reproduz a folha em loop, encaixado numa caixa de `caixa` px.
 * @param {{url:string, frameW:number, frameH:number, frames:number, frameMs:number, scale?:number}} fx
 */
export function fxCanvas(fx, caixa = 96) {
  const cv = document.createElement('canvas');
  cv.width = fx.frameW;
  cv.height = fx.frameH;

  const escala = Math.min(caixa / fx.frameW, caixa / fx.frameH);
  cv.style.width = `${Math.round(fx.frameW * escala)}px`;
  cv.style.height = `${Math.round(fx.frameH * escala)}px`;

  cv._fx = {
    url: fx.url,
    ctx: cv.getContext('2d'),
    frameW: fx.frameW,
    frameH: fx.frameH,
    frames: Math.max(1, fx.frames),
    frameMs: Math.max(16, fx.frameMs || 60),
    i: -1,
    img: null,
  };
  cv._fx.ctx.imageSmoothingEnabled = false;

  observer.observe(cv);
  if (!rodando) {
    rodando = true;
    requestAnimationFrame(tick);
  }
  return cv;
}

/** Solta os canvas de um container que vai ser destruído. */
export function fxLimpar(container) {
  for (const cv of container.querySelectorAll('canvas')) {
    if (cv._fx) {
      observer.unobserve(cv);
      vivos.delete(cv._fx);
    }
  }
}
