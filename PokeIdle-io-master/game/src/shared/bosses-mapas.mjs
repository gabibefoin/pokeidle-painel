/**
 * Mapa de arena por boss — mesma pool por tipo que hunts Hoenn+ (`mapas-pools.json`).
 * RNG estável por dex (sal diferente das hunts normais).
 */
import { readFileSync } from 'node:fs';
import { fontePorTipo } from './spawns-filtro.mjs';

const SEED = 20260813;
const SAL_FONTE = 31;

export function rngDex(dex, salt = 0) {
  let s = ((dex * 7919 + salt * 104729 + SEED * 9973) >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function escolherFonteBoss(dex, tipo, pools) {
  const lista = pools?.[tipo];
  if (lista?.length) {
    const rand = rngDex(dex, SAL_FONTE);
    return lista[Math.floor(rand() * lista.length)];
  }
  return fontePorTipo(tipo);
}

export function carregarPoolsBoss() {
  const raw = readFileSync(new URL('../server/dados/mapas-pools.json', import.meta.url), 'utf8');
  return JSON.parse(raw).pools ?? {};
}

const VIZ = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function livre(grade, x, y) {
  if (!grade?.grid?.length) return false;
  if (y < 0 || y >= grade.grid.length) return false;
  if (x < 0 || x >= grade.grid[0].length) return false;
  return grade.grid[y][x] === '1';
}

/**
 * Herói e boss a 1 tile (Chebyshev) — entra já em alcance de combate.
 */
export function parCombateNaGrade(gradeFonte) {
  const pontos = gradeFonte.pontos ?? [];

  for (const p of pontos) {
    const [px, py] = p;
    for (const [dx, dy] of VIZ) {
      const hx = px + dx;
      const hy = py + dy;
      if (livre(gradeFonte, hx, hy)) return { inicio: [hx, hy], boss: [px, py] };
    }
  }

  const [ix, iy] = gradeFonte.inicio ?? [0, 0];
  for (const [dx, dy] of VIZ) {
    const bx = ix + dx;
    const by = iy + dy;
    if (livre(gradeFonte, bx, by)) return { inicio: [ix, iy], boss: [bx, by] };
  }

  if (pontos[0]) return { inicio: gradeFonte.inicio, boss: [pontos[0][0], pontos[0][1]] };
  return { inicio: gradeFonte.inicio, boss: gradeFonte.inicio };
}
