// A busca de caminho do campo (`passoRumoA`) — a otimizada tem de devolver EXATAMENTE o que a de
// antes devolvia, e mais depressa.
//
//     node tools/teste-campo-passo.mjs
//
// A versão de antes está copiada aqui, linha por linha, como referência. As duas rodam sobre as
// GRADES REAIS das hunts, com as mesmas consultas sorteadas (semente fixa): destino livre,
// destino cercado pelos selvagens (o caso que custava 21% do sim em produção), quase cercado,
// sem ocupação (o treinador) e alcance 2 (a arena do boss na água). Qualquer diferença de
// resultado — `null` contra passo, ou passo para outra tile — é falha.
//
// No fim, um banco de tempo com a perseguição do jeito que o `moverCampo` faz: um herói, doze
// selvagens em volta, metade das vezes já cercado.
//
// E o estouro do contador de geração (rascunho da busca e grade de ocupação): passando de 2^31, a
// busca de antes devolvia `null` onde havia caminho e depois TRAVAVA num laço infinito. Roda num
// processo à parte, com prazo — se voltar a travar, o teste acusa em vez de pendurar.
import { spawnSync } from 'node:child_process';
import { grades } from '../src/server/content.mjs';
import { gradeDaHunt, passoRumoA } from '../src/server/game/campo.mjs';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

// ------------------------------------------------------------ a versão de antes, como estava

const TETO_BUSCA = 4000;
const VIZINHOS = [
  [0, -1, 1],
  [1, 0, 2],
  [0, 1, 3],
  [-1, 0, 4],
];
const andavel = (g, cx, cy) => cx >= 0 && cx < g.cols && cy >= 0 && cy < g.rows && g.grid[cy * g.cols + cx] === 1;
const chebyshev = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
function rascunhoLegado(g) {
  if (!g._lVeioDe) {
    const n = g.cols * g.rows;
    g._lVeioDe = new Int32Array(n);
    g._lGeracao = new Int32Array(n);
    g._lFila = new Int32Array(n);
    g._lContador = 0;
  }
  g._lContador++;
  return g;
}
function passoLegado(g, ox, oy, dx, dy, ocupadas, dist = 1) {
  if (chebyshev(ox, oy, dx, dy) <= dist) return null;
  rascunhoLegado(g);
  const { _lVeioDe: veioDe, _lGeracao: geracao, _lFila: fila, _lContador: gen, cols } = g;
  const inicio = oy * cols + ox;
  veioDe[inicio] = inicio;
  geracao[inicio] = gen;
  fila[0] = inicio;
  let cabeca = 0;
  let cauda = 1;
  while (cabeca < cauda && cabeca < TETO_BUSCA) {
    const atual = fila[cabeca++];
    const ax = atual % cols;
    const ay = (atual - ax) / cols;
    if (chebyshev(ax, ay, dx, dy) <= dist) {
      let no = atual;
      while (veioDe[no] !== inicio) no = veioDe[no];
      const px = no % cols;
      return { cx: px, cy: (no - px) / cols };
    }
    for (const [vx, vy] of VIZINHOS) {
      const nx = ax + vx;
      const ny = ay + vy;
      if (!andavel(g, nx, ny)) continue;
      const idx = ny * cols + nx;
      if (geracao[idx] === gen) continue;
      if (ocupadas?.has(idx) && !(nx === dx && ny === dy)) continue;
      geracao[idx] = gen;
      veioDe[idx] = atual;
      if (cauda < fila.length) fila[cauda++] = idx;
    }
  }
  return null;
}

// ------------------------------------------------------------------------ apoio

function prng(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = prng(20260914);
const sortear = (lista) => lista[Math.floor(rnd() * lista.length)];

function andaveis(g) {
  const out = [];
  for (let i = 0; i < g.cols * g.rows; i++) if (g.grid[i] === 1) out.push(i);
  return out;
}
const xy = (g, idx) => [idx % g.cols, Math.floor(idx / g.cols)];

/** Todas as tiles andáveis no quadrado de raio `r` em volta de (cx,cy), fora o centro. */
function emVolta(g, cx, cy, r) {
  const out = [];
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if ((x === cx && y === cy) || !andavel(g, x, y)) continue;
      out.push(y * g.cols + x);
    }
  }
  return out;
}

/** Uma origem andável a até `raio` tiles do destino (ou qualquer uma, se não achar). */
function origemPerto(g, lista, cx, cy, raio) {
  for (let t = 0; t < 30; t++) {
    const [x, y] = xy(g, sortear(lista));
    if (chebyshev(x, y, cx, cy) <= raio) return [x, y];
  }
  return xy(g, sortear(lista));
}

const mesmo = (a, b) => (a === null && b === null) || (!!a && !!b && a.cx === b.cx && a.cy === b.cy);

// ------------------------------------------------------------------ as grades

const slugs = Object.keys(grades).sort();
const carregadas = [];
for (const slug of slugs) {
  const g = gradeDaHunt(slug);
  if (!g?.grid || !g.cols || !g.rows) continue;
  const lista = andaveis(g);
  if (lista.length < 40) continue;
  carregadas.push({ slug, g, lista });
}

console.log('BUSCA DE CAMINHO DO CAMPO\n=========================');
console.log(`\n${carregadas.length} grades reais de hunt`);
ok(carregadas.length > 100, 'as grades das hunts carregaram');

// ------------------------------------------------------------- equivalência

const cenarios = {
  livre: 0, cercado: 0, quaseCercado: 0, semOcupacao: 0, alcance2: 0,
};
const diferencas = [];
let nulosNovo = 0;
for (const { slug, g, lista } of carregadas) {
  for (let q = 0; q < 60; q++) {
    const tipo = ['livre', 'cercado', 'quaseCercado', 'semOcupacao', 'alcance2'][q % 5];
    const [dx, dy] = xy(g, sortear(lista));
    const dist = tipo === 'alcance2' ? 2 : 1;
    let ocupadas = new Set();
    for (let i = Math.floor(rnd() * 17); i > 0; i--) ocupadas.add(sortear(lista));
    if (tipo === 'cercado' || tipo === 'quaseCercado') {
      const volta = emVolta(g, dx, dy, dist);
      for (const idx of volta) ocupadas.add(idx);
      if (tipo === 'quaseCercado' && volta.length) ocupadas.delete(sortear(volta));
      if (rnd() < 0.5) ocupadas.add(dy * g.cols + dx); // o destino também ocupado (o alvo é um selvagem)
    }
    if (tipo === 'semOcupacao') ocupadas = null;
    const [ox, oy] = rnd() < 0.7 ? origemPerto(g, lista, dx, dy, 16) : xy(g, sortear(lista));
    const antes = passoLegado(g, ox, oy, dx, dy, ocupadas, dist);
    const agora = passoRumoA(g, ox, oy, dx, dy, ocupadas, dist);
    cenarios[tipo]++;
    if (agora === null) nulosNovo++;
    if (!mesmo(antes, agora) && diferencas.length < 5) {
      diferencas.push(`${slug} ${tipo} (${ox},${oy})→(${dx},${dy}) antes ${JSON.stringify(antes)} agora ${JSON.stringify(agora)}`);
    }
    if (!mesmo(antes, agora)) diferencas.total = (diferencas.total ?? 0) + 1;
  }
}
const total = Object.values(cenarios).reduce((s, n) => s + n, 0);
console.log(`\n${total} consultas · ${Object.entries(cenarios).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
ok(!diferencas.total, `a busca nova devolve exatamente o mesmo passo que a antiga nas ${total} consultas`,
  diferencas.join(' | '));
ok(nulosNovo > 0 && nulosNovo < total, `os dois lados aparecem na amostra: ${nulosNovo} sem caminho, ${total - nulosNovo} com passo`);

// A borda do mapa: destino e origem encostados nas quatro bordas não saem da grade.
{
  const { g, lista } = carregadas[0];
  let bordas = 0;
  let iguais = 0;
  for (const idx of lista) {
    const [x, y] = xy(g, idx);
    if (x !== 0 && y !== 0 && x !== g.cols - 1 && y !== g.rows - 1) continue;
    bordas++;
    const [ox, oy] = xy(g, sortear(lista));
    if (mesmo(passoLegado(g, ox, oy, x, y, null, 1), passoRumoA(g, ox, oy, x, y, null, 1))) iguais++;
  }
  ok(iguais === bordas, `destinos na borda da grade: ${iguais}/${bordas} iguais`);
}

// ------------------------------------------------------- o estouro do contador

{
  const campo = new URL('../src/server/game/campo.mjs', import.meta.url).href;
  const conteudo = new URL('../src/server/content.mjs', import.meta.url).href;
  const codigo = `
    const { grades } = await import(${JSON.stringify(conteudo)});
    const { gradeDaHunt, passoRumoA } = await import(${JSON.stringify(campo)});
    let g = null, lista = null;
    for (const s of Object.keys(grades).sort()) {
      const gg = gradeDaHunt(s);
      if (!gg?.grid) continue;
      const l = [];
      for (let i = 0; i < gg.cols * gg.rows; i++) if (gg.grid[i] === 1) l.push(i);
      if (l.length > 1500) { g = gg; lista = l; break; }
    }
    const limpa = { cols: g.cols, rows: g.rows, grid: g.grid };
    let s = 99;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const xy = (i) => [i % g.cols, Math.floor(i / g.cols)];
    passoRumoA(g, ...xy(lista[0]), ...xy(lista[500]), new Set([lista[1]]), 1);
    g._contador = 2 ** 31 - 40;
    g._ocupacaoConjunto.gen = 2 ** 31 - 40;
    let diferentes = 0, comPasso = 0;
    for (let q = 0; q < 3000; q++) {
      const [ox, oy] = xy(lista[Math.floor(rnd() * lista.length)]);
      let [dx, dy] = xy(lista[Math.floor(rnd() * lista.length)]);
      if (Math.max(Math.abs(ox - dx), Math.abs(oy - dy)) > 20) [dx, dy] = [ox + 6, oy + 4];
      const oc = new Set();
      for (let i = 0; i < 12; i++) oc.add(lista[Math.floor(rnd() * lista.length)]);
      const a = passoRumoA(limpa, ox, oy, dx, dy, oc, 1);
      const b = passoRumoA(g, ox, oy, dx, dy, oc, 1);
      if (a) comPasso++;
      if (!((a === null && b === null) || (a && b && a.cx === b.cx && a.cy === b.cy))) diferentes++;
    }
    console.log('RESULTADO ' + JSON.stringify({ diferentes, comPasso, contador: g._contador, gen: g._ocupacaoConjunto.gen }));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', codigo], { encoding: 'utf8', timeout: 60_000 });
  const linha = (r.stdout ?? '').split('\n').find((l) => l.startsWith('RESULTADO '));
  const res = linha ? JSON.parse(linha.slice(10)) : null;
  console.log('\nestouro do contador de geração');
  ok(!r.error && res, 'com o contador passando de 2^31 a busca não trava', r.error?.message ?? r.stderr?.slice(-300));
  if (res) {
    ok(res.diferentes === 0 && res.comPasso > 1000, `3000 consultas atravessando o estouro: os mesmos passos de uma grade limpa (${res.comPasso} com passo)`,
      `${res.diferentes} diferentes`);
    // Começaram 40 abaixo do teto e fizeram até 3000 buscas: depois do estouro, sobra no máximo isso.
    ok(res.contador > 0 && res.contador < 3000 && res.gen > 0 && res.gen < 3000,
      `os dois contadores recomeçaram do zero no estouro (rascunho em ${res.contador}, ocupação em ${res.gen})`);
  }
}

// ------------------------------------------------------------------ o tempo

// Os MESMOS cenários para os dois lados: sorteados uma vez, antes de cronometrar.
const cenariosPerseguicao = [];
for (let rodada = 0; rodada < 40; rodada++) {
  for (const { g, lista } of carregadas.slice(0, 60)) {
    const [hx, hy] = xy(g, sortear(lista));
    const mobs = [];
    for (let i = 0; i < 12; i++) mobs.push(origemPerto(g, lista, hx, hy, 10));
    const ocupadas = new Set(mobs.map(([x, y]) => y * g.cols + x));
    if (rodada % 2 === 0) for (const idx of emVolta(g, hx, hy, 1)) ocupadas.add(idx);
    cenariosPerseguicao.push({ g, hx, hy, mobs, ocupadas });
  }
}
function perseguicoes(implementacao) {
  let passos = 0;
  const t0 = performance.now();
  for (const { g, hx, hy, mobs, ocupadas } of cenariosPerseguicao) {
    for (const [mx, my] of mobs) {
      if (implementacao(g, mx, my, hx, hy, ocupadas, 1)) passos++;
    }
  }
  return { ms: performance.now() - t0, passos };
}
perseguicoes(passoLegado);
perseguicoes(passoRumoA);
const velho = perseguicoes(passoLegado);
const novo = perseguicoes(passoRumoA);
console.log(`\nperseguição (60 hunts × 12 selvagens × 40 rodadas): antes ${velho.ms.toFixed(0)} ms · agora ${novo.ms.toFixed(0)} ms · ${(velho.ms / novo.ms).toFixed(1)}× mais rápido`);
ok(velho.passos === novo.passos, `a mesma quantidade de passos dados nos dois (${novo.passos})`);
ok(novo.ms < velho.ms, 'a nova é mais rápida na perseguição');

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
