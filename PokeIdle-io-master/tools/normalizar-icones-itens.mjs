// Ícones do espelho idleworld vêm num canvas 32×32 com o desenho minúsculo no centro
// (Band Aid ~10×10). Com `object-fit: contain` eles somem perto de itens já recortados.
// Este script amplia só o que precisa e recentraliza num quadrado padrão.
//
//   node tools/normalizar-icones-itens.mjs [--force]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodificar, codificar, recortarTransparente } from './png.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ITENS = join(RAIZ, 'public/data/site/assets/items');
const FORCE = process.argv.includes('--force');
const TAMANHO = 32;
/** Quanto do quadrado o desenho deve ocupar — calibrado nos loot icons bons (Pot of Lava, etc.). */
const META = 0.84;
/** Abaixo disto o ícone parece “ponto” perto dos demais. */
const LIMIAR = 0.72;
/** Sprites com vários desenhos no mesmo PNG (Band Aid, Essence of Fire…) — não mexer. */
const PULAR = new Set(['band_aid.png', 'essence_of_fire.png']);

function escalaVizinha(rgba, w, h, nw, nh) {
  const out = Buffer.alloc(nw * nh * 4);
  const sx = w / nw;
  const sy = h / nh;
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const ox = Math.min(w - 1, Math.floor(x * sx));
      const oy = Math.min(h - 1, Math.floor(y * sy));
      rgba.copy(out, (y * nw + x) * 4, (oy * w + ox) * 4, (oy * w + ox) * 4 + 4);
    }
  }
  return out;
}

function bboxDoCore(rgba, w, h) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  let opacos = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] <= 16) continue;
      opacos++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const canvas = w * h;
  const ratio = Math.max(bw, bh) / Math.max(w, h);
  const preenchimento = Math.sqrt((bw * bh) / canvas);
  const metrica = Math.min(ratio, preenchimento);
  return { bw, bh, ratio, metrica, opacos };
}

function normalizar(buf) {
  const orig = decodificar(buf);
  const recorte = recortarTransparente(buf);
  const core = recorte ? decodificar(recorte.buf) : orig;
  const box = bboxDoCore(core.rgba, core.largura, core.altura);
  if (!box) return null;
  const canvasMax = Math.max(orig.largura, orig.altura);
  const coreMax = Math.max(core.largura, core.altura);
  const ratioCanvas = coreMax / canvasMax;
  const metrica = Math.min(ratioCanvas, box.metrica);
  if (metrica >= LIMIAR) return null;

  const alvo = Math.round(TAMANHO * META);
  const fator = alvo / coreMax;
  const nw = Math.max(1, Math.round(core.largura * fator));
  const nh = Math.max(1, Math.round(core.altura * fator));
  const ampliado = escalaVizinha(core.rgba, core.largura, core.altura, nw, nh);

  const saida = Buffer.alloc(TAMANHO * TAMANHO * 4);
  const ox = Math.floor((TAMANHO - nw) / 2);
  const oy = Math.floor((TAMANHO - nh) / 2);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      ampliado.copy(saida, ((oy + y) * TAMANHO + ox + x) * 4, (y * nw + x) * 4, (y * nw + x) * 4 + 4);
    }
  }
  return { buf: codificar(TAMANHO, TAMANHO, saida), ratio: metrica, antes: `${orig.largura}×${orig.altura}`, core: `${core.largura}×${core.altura}` };
}

let ok = 0;
function walk(dir) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.png$/i.test(nome)) continue;
    if (PULAR.has(nome)) continue;
    const buf = readFileSync(p);
    const r = normalizar(buf);
    if (!r) continue;
    writeFileSync(p, r.buf);
    console.log(`${p.replace(ITENS + '\\', '').replace(ITENS + '/', '')}: ${r.antes} (${r.core}) → ${TAMANHO}×${TAMANHO}  ratio ${r.ratio.toFixed(2)}`);
    ok++;
  }
}

walk(ITENS);
console.log(`\n${ok} ícone(s) normalizado(s).`);
