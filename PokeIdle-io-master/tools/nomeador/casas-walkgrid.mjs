/** Prévia de walkgrid para o lab de casas — mesma regra do `build-walkgrids.mjs`. */

export async function carregarBloqueantes(jogoDir) {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const collision = JSON.parse(await readFile(join(jogoDir, 'world/collision.json'), 'utf8'));
  return new Set(collision.blocking ?? []);
}

/** @typedef {{ abrir?: number[][], fechar?: number[][] }} PassagensCamada */

const okPar = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

export function normalizarPassagensCamada(passagens) {
  return {
    abrir: (passagens?.abrir ?? []).filter(okPar).map(([x, y]) => [x | 0, y | 0]),
    fechar: (passagens?.fechar ?? []).filter(okPar).map(([x, y]) => [x | 0, y | 0]),
  };
}

/** Converte formato antigo (flat) → { "7": {…}, "6": {…} } por andar Z. */
export function normalizarPassagensPorAndar(passagens, groundZ = 7) {
  if (!passagens) return { [String(groundZ)]: { abrir: [], fechar: [] } };

  const chavesAndar = Object.keys(passagens).filter((k) => /^\d+$/.test(k));

  if (chavesAndar.length > 0) {
    const out = {};
    for (const k of chavesAndar) {
      out[k] = normalizarPassagensCamada(passagens[k]);
    }
    if (!out[String(groundZ)]) out[String(groundZ)] = { abrir: [], fechar: [] };
    return out;
  }

  if (Array.isArray(passagens.abrir) || Array.isArray(passagens.fechar)) {
    return { [String(groundZ)]: normalizarPassagensCamada(passagens) };
  }

  return { [String(groundZ)]: { abrir: [], fechar: [] } };
}

export function passagensDoAndar(passagensPorAndar, andar, groundZ = 7) {
  const todas = normalizarPassagensPorAndar(passagensPorAndar, groundZ);
  return todas[String(andar)] ?? { abrir: [], fechar: [] };
}

export function normalizarEscadas(escadas) {
  return {
    subir: (escadas?.subir ?? []).filter(okPar).map(([x, y]) => [x | 0, y | 0]),
    descer: (escadas?.descer ?? []).filter(okPar).map(([x, y]) => [x | 0, y | 0]),
  };
}

/** Spawn do editor — objeto `{x,y}` ou par `[x,y]` em tile de mapa. */
export function normalizarInicioMapa(inicio) {
  if (inicio == null) return null;
  if (Array.isArray(inicio) && inicio.length >= 2) return { x: inicio[0] | 0, y: inicio[1] | 0 };
  if (Number.isFinite(inicio.x) && Number.isFinite(inicio.y)) return { x: inicio.x | 0, y: inicio.y | 0 };
  return null;
}

/**
 * Onde a inundação começa para recortar a grade andável.
 *
 * No térreo vale `inicio` do editor, ou o centro da caixa. Nos andares de cima a área pode
 * ser alcançável só pela escada — usar só o centro cortaria cômodos inteiros. Por isso
 * devolve TODOS os tiles de escada (↑ e ↓) como sementes, e a inundação faz a união.
 */
export function seedsMapaDoAndar(caixa, inicio, escadas, groundZ, andar) {
  const [minTx, minTy] = caixa.map(Number);
  const vistos = new Set();
  const out = [];
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const k = `${x | 0},${y | 0}`;
    if (vistos.has(k)) return;
    vistos.add(k);
    out.push({ x: x | 0, y: y | 0 });
  };
  const ini = normalizarInicioMapa(inicio);
  if (ini) add(ini.x, ini.y);
  if (andar < groundZ) {
    const esc = normalizarEscadas(escadas);
    for (const [lx, ly] of [...esc.subir, ...esc.descer]) add(minTx + lx, minTy + ly);
  }
  return out;
}

/** @deprecated Preferir `seedsMapaDoAndar` — mantido para chamadas legadas. */
export function spawnMapaDoAndar(caixa, inicio, escadas, groundZ, andar) {
  const seeds = seedsMapaDoAndar(caixa, inicio, escadas, groundZ, andar);
  return seeds[0] ?? null;
}

/** Andares Z com chão dentro da caixa (maior Z = térreo do mapa). */
export function andaresNaCaixa(mapa, caixa) {
  const [minTx, minTy, maxTx, maxTy] = caixa.map(Number);
  const zs = new Set();
  for (const t of mapa.tiles ?? []) {
    if (t[0] < minTx || t[0] > maxTx || t[1] < minTy || t[1] > maxTy) continue;
    if (t[3]) zs.add(t[2]);
  }
  return [...zs].sort((a, b) => b - a);
}

function montarGradeBase(mapa, bloqueantes, minTx, minTy, cols, rows, z) {
  const grade = Array.from({ length: rows }, () => new Uint8Array(cols));
  for (const t of mapa.tiles ?? []) {
    if (t[2] !== z) continue;
    const cx = t[0] - minTx;
    const cy = t[1] - minTy;
    if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
    const travado = bloqueantes.has(t[3]) || t[4].some((it) => bloqueantes.has(it[0]));
    grade[cy][cx] = travado ? 0 : 1;
  }
  return grade;
}

export function aplicarPassagens(gradeBase, passagens) {
  const p = normalizarPassagensCamada(passagens);
  const grade = gradeBase.map((row) => new Uint8Array(row));
  for (const [x, y] of p.abrir) {
    if (y >= 0 && y < grade.length && x >= 0 && x < grade[0].length) grade[y][x] = 1;
  }
  for (const [x, y] of p.fechar) {
    if (y >= 0 && y < grade.length && x >= 0 && x < grade[0].length) grade[y][x] = 0;
  }
  return grade;
}

function analisarGrade(grade, cols, rows, seedsMapa, minTx, minTy, rotuloAndar) {
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

  let andaveis = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) if (grade[y][x]) andaveis++;
  }

  const sementes = Array.isArray(seedsMapa) ? seedsMapa : (seedsMapa ? [seedsMapa] : []);
  const locais = [];
  for (const s of sementes) {
    const bruto = { x: s.x - minTx, y: s.y - minTy };
    const enc = encaixar(bruto.x, bruto.y);
    if (enc) locais.push({ bruto, enc });
  }

  let inicioLocal = locais[0]?.enc ?? null;
  if (!inicioLocal) {
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
    inicioLocal = melhor;
  }

  let conectados = 0;
  const alcancado = Array.from({ length: rows }, () => new Uint8Array(cols));
  const inunda = (origem) => {
    if (!origem) return;
    const fila = [origem];
    alcancado[origem.y][origem.x] = 1;
    while (fila.length) {
      const { x, y } = fila.pop();
      conectados++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!livre(nx, ny) || alcancado[ny][nx]) continue;
        alcancado[ny][nx] = 1;
        fila.push({ x: nx, y: ny });
      }
    }
  };

  if (locais.length) {
    for (const { enc } of locais) {
      if (!alcancado[enc.y][enc.x]) inunda(enc);
    }
  } else if (inicioLocal) {
    inunda(inicioLocal);
  }

  conectados = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) if (alcancado[y][x]) conectados++;
  }

  const inicioBruto = locais[0]?.bruto ?? null;
  const inicioMapa = inicioLocal
    ? { x: inicioLocal.x + minTx, y: inicioLocal.y + minTy }
    : null;

  const avisos = [];
  if (andaveis === 0) avisos.push(`nenhum tile andável no andar z${rotuloAndar}`);
  else if (conectados < andaveis) {
    avisos.push(`${andaveis - conectados} tile(s) andável(is) desconectado(s) do spawn (z${rotuloAndar})`);
  }
  if (inicioBruto && inicioLocal
    && (inicioLocal.x !== inicioBruto.x || inicioLocal.y !== inicioBruto.y)) {
    avisos.push('spawn ajustado para tile livre mais próxima');
  }

  return { andaveis, conectados, inicio: inicioMapa, avisos, alcancado };
}

/**
 * @param {object} mapa
 * @param {Set<number>} bloqueantes
 * @param {number[]} caixa
 * @param {{x:number,y:number}|null} start
 * @param {object|null} passagensPorAndar mapa z → { abrir, fechar }
 * @param {number|null} andar Z do walkgrid (padrão groundZ)
 * @param {object|null} escadas `{ subir, descer }` — tiles locais à caixa
 */
export function analisarArea(mapa, bloqueantes, caixa, start = null, passagensPorAndar = null, andar = null, escadas = null) {
  if (!caixa || caixa.length !== 4) return { erro: 'caixa inválida — precisa de 4 números' };

  const meta = mapa._meta ?? {};
  const groundZ = meta.groundZ ?? meta.range?.[4] ?? 7;
  const z = andar ?? groundZ;
  const [minTx, minTy, maxTx, maxTy] = caixa.map(Number);
  if (![minTx, minTy, maxTx, maxTy].every(Number.isFinite)) return { erro: 'caixa com NaN' };
  if (maxTx < minTx || maxTy < minTy) return { erro: 'maxTx/maxTy menores que o mínimo' };

  const cols = maxTx - minTx + 1;
  const rows = maxTy - minTy + 1;
  if (cols > 200 || rows > 200) return { erro: 'caixa grande demais (máx 200×200 tiles)' };

  const andares = andaresNaCaixa(mapa, caixa);
  const passNorm = normalizarPassagensPorAndar(passagensPorAndar, groundZ);
  const passCamada = passNorm[String(z)] ?? { abrir: [], fechar: [] };

  const gradeBase = montarGradeBase(mapa, bloqueantes, minTx, minTy, cols, rows, z);
  const grade = aplicarPassagens(gradeBase, passCamada);
  // `alcancado` fica de fora do resumo: é uma matriz do tamanho da caixa, e o resumo é pedido
  // a cada repintura da lista de tiers (cinco por vez). Quem precisa dela pede a versão com
  // grade — ver `analisarAreaComGrade`.
  const seeds = seedsMapaDoAndar(caixa, start, escadas, groundZ, z);
  const { alcancado, ...stats } = analisarGrade(grade, cols, rows, seeds, minTx, minTy, z);

  return {
    groundZ,
    andar: z,
    andares,
    cols,
    rows,
    box: [minTx, minTy, maxTx, maxTy],
    passagens: passNorm,
    ...stats,
  };
}

export function analisarAreaComGrade(mapa, bloqueantes, caixa, start = null, passagensPorAndar = null, andar = null, escadas = null) {
  const r = analisarArea(mapa, bloqueantes, caixa, start, passagensPorAndar, andar, escadas);
  if (r.erro) return r;

  const [minTx, minTy] = r.box;
  const z = r.andar;
  const cols = r.cols;
  const rows = r.rows;
  const passCamada = passagensDoAndar(passagensPorAndar, z, r.groundZ);
  const gradeBase = montarGradeBase(mapa, bloqueantes, minTx, minTy, cols, rows, z);
  const grade = aplicarPassagens(gradeBase, passCamada);
  // Refaz a inundação para ter a máscara — `analisarArea` a descarta de propósito (ver lá).
  const seeds = seedsMapaDoAndar(caixa, start, escadas, r.groundZ, z);
  const { alcancado } = analisarGrade(grade, cols, rows, seeds, minTx, minTy, z);

  return {
    ...r,
    grade: grade.map((row) => [...row]),
    gradeBase: gradeBase.map((row) => [...row]),
    /**
     * O que o JOGO vai usar: só o pedaço ligado ao spawn.
     *
     * `grade` responde "esta tile é chão?"; `alcancado`, "o pokémon consegue CHEGAR nela?". As
     * duas divergem bastante (na casa Mítica, 226 contra 77), e é a segunda que o
     * `build-walkgrids` grava. O editor de bonecos pinta esta.
     */
    alcancado: alcancado.map((row) => [...row]),
  };
}
