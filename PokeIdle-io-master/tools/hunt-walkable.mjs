/** Tiles andáveis conectadas ao início — mesma regra do build-walkgrids.mjs. */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { OUT } from './lib.mjs';

const collision = JSON.parse(readFileSync(join(OUT, 'world/collision.json'), 'utf8'));
const bloqueantes = new Set(collision.blocking ?? []);

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * @returns {{ tiles: {x:number,y:number}[], inicio: {x:number,y:number}|null, box: number[] }}
 */
export function tilesAndaveis(mapa, caixa, start = null) {
  const meta = mapa._meta ?? {};
  const groundZ = meta.groundZ ?? meta.range?.[4] ?? 7;
  const [minTx, minTy, maxTx, maxTy] = caixa;
  const cols = maxTx - minTx + 1;
  const rows = maxTy - minTy + 1;

  const grade = Array.from({ length: rows }, () => new Uint8Array(cols));
  for (const t of mapa.tiles) {
    if (t[2] !== groundZ) continue;
    const cx = t[0] - minTx;
    const cy = t[1] - minTy;
    if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
    const travado = bloqueantes.has(t[3]) || t[4].some((it) => bloqueantes.has(it[0]));
    grade[cy][cx] = travado ? 0 : 1;
  }

  const dentro = (x, y) => x >= 0 && x < cols && y >= 0 && y < rows;
  const livre = (x, y) => dentro(x, y) && grade[y][x] === 1;

  const encaixar = (x, y, raio = 8) => {
    if (livre(x, y)) return { x, y };
    for (let r = 1; r <= raio; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (livre(x + dx, y + dy)) return { x: x + dx, y: y + dy };
        }
      }
    }
    return null;
  };

  const inicioBruto = start ? { x: start.x - minTx, y: start.y - minTy } : null;
  let inicio = inicioBruto ? encaixar(inicioBruto.x, inicioBruto.y) : null;
  if (!inicio) {
    let melhor = null;
    let melhorD = Infinity;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (grade[y][x] !== 1) continue;
        const d = (x - cols / 2) ** 2 + (y - rows / 2) ** 2;
        if (d < melhorD) {
          melhorD = d;
          melhor = { x, y };
        }
      }
    }
    inicio = melhor;
  }

  const tiles = [];
  if (inicio) {
    const alcancado = Array.from({ length: rows }, () => new Uint8Array(cols));
    const fila = [inicio.x, inicio.y];
    alcancado[inicio.y][inicio.x] = 1;
    for (let i = 0; i < fila.length; i += 2) {
      const x = fila[i];
      const y = fila[i + 1];
      tiles.push({ x: x + minTx, y: y + minTy });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (livre(nx, ny) && !alcancado[ny][nx]) {
          alcancado[ny][nx] = 1;
          fila.push(nx, ny);
        }
      }
    }
  }

  return {
    tiles,
    inicio: inicio ? { x: inicio.x + minTx, y: inicio.y + minTy } : null,
    box: caixa,
  };
}

export function metricasSpawns(spawns) {
  const pts = spawns.map((s) => ({ x: s.x, y: s.y }));
  if (pts.length < 2) {
    return { count: pts.length, minDist: pts.length ? Infinity : 0, spread: 0 };
  }
  let minDist = Infinity;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = dist(pts[i], pts[j]);
      minDist = Math.min(minDist, d);
      sum += d;
      n++;
    }
  }
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const spread = Math.sqrt(pts.reduce((s, p) => s + (p.x - cx) ** 2 + (p.y - cy) ** 2, 0) / pts.length);
  return { count: pts.length, minDist, avgDist: sum / n, spread };
}

/** Farthest-point sampling — maximiza distância mínima entre spawns. */
export function espalharPontos(tiles, n, preferido = null) {
  if (!tiles.length || n <= 0) return [];
  if (tiles.length <= n) return [...tiles];

  const key = (t) => `${t.x},${t.y}`;
  const set = new Map(tiles.map((t) => [key(t), t]));
  const lista = [...set.values()];
  const escolhidos = [];

  if (n === 1) {
    return [preferido && set.has(key(preferido)) ? preferido : lista[0]];
  }

  // Começa pelo par mais distante — evita cluster no início da hunt.
  let a = lista[0];
  let b = lista[1];
  let parMax = dist(a, b);
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      const d = dist(lista[i], lista[j]);
      if (d > parMax) {
        parMax = d;
        a = lista[i];
        b = lista[j];
      }
    }
  }
  escolhidos.push(a, b);

  while (escolhidos.length < n) {
    let melhor = null;
    let melhorMin = -1;
    for (const t of lista) {
      if (escolhidos.some((c) => c.x === t.x && c.y === t.y)) continue;
      const md = Math.min(...escolhidos.map((c) => dist(c, t)));
      if (md > melhorMin) {
        melhorMin = md;
        melhor = t;
      }
    }
    if (!melhor) break;
    escolhidos.push(melhor);
  }

  return escolhidos;
}

export function carregarMapa(slug) {
  const path = join(OUT, 'world/maps', `${slug}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}
