// O movimento do campo otimizado (`moverCampo` + `limparCorpos` + `deltaCampo`) é, tick a tick, o
// MESMO do original.
//
//     node tools/teste-campo-mover.mjs
//
// As versões de antes estão copiadas aqui, com a busca de caminho original junto. As duas rodam lado
// a lado em hunts reais: o mesmo campo inicial (clonado), a MESMA sequência de `Math.random` (uma
// cópia do gerador para cada lado), o mesmo relógio (`Date.now` congelado no instante do tick) e os
// mesmos eventos de jogo sorteados por fora (o alvo morre, outro vira alvo, o herói para de caçar,
// a bicicleta muda a velocidade). A cada tick confere: o `encostado` devolvido, o pacote de campo que
// iria ao cliente e o estado inteiro — herói, treinador e cada selvagem. Qualquer diferença é falha.
import { grades } from '../src/server/content.mjs';
import {
  criarCampo, porMobEmCampo, moverCampo, limparCorpos, deltaCampo, darPasso, parado, direcaoDe, andavel,
  chebyshev, serializarMob, serializarHeroi, DIST_COMBATE, MS_PASSO_HEROI, MS_PASSO_MOB, MS_PASSO_TREINADOR,
  CORPO_MS,
} from '../src/server/game/campo.mjs';
import { passoComBicicleta } from '../src/shared/bicicletas.mjs';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

// ------------------------------------------------------------ as versões de antes

const RAIO_VAGUEIO = 5;
const PAUSA_MOB = [700, 2600];
const RAIO_PERSEGUICAO = 12;
const RAIO_DESISTIR = 18;
const TETO_BUSCA = 4000;
const MAX_CORPOS = 24;
const VIZINHOS = [[0, -1, 1], [1, 0, 2], [0, 1, 3], [-1, 0, 4]];

function passoLegado(g, ox, oy, dx, dy, ocupadas, dist = DIST_COMBATE) {
  if (chebyshev(ox, oy, dx, dy) <= dist) return null;
  if (!g._lVeioDe) {
    const n = g.cols * g.rows;
    g._lVeioDe = new Int32Array(n);
    g._lGeracao = new Int32Array(n);
    g._lFila = new Int32Array(n);
    g._lContador = 0;
  }
  const gen = ++g._lContador;
  const { _lVeioDe: veioDe, _lGeracao: geracao, _lFila: fila, cols } = g;
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

function ocupacaoLegado(campo) {
  const s = new Set();
  for (const m of campo.mobs.values()) if (!m.morto) s.add(m.cy * campo.g.cols + m.cx);
  return s;
}

function moverLegado(campo, agora) {
  const g = campo.g;
  const h = campo.heroi;
  const ocupadas = ocupacaoLegado(campo);
  const celula = (cx, cy) => cy * g.cols + cx;
  const dist = campo.distCombate ?? DIST_COMBATE;
  if (h.andando && parado(h, agora)) {
    h.andando = false;
    h.deCx = h.cx;
    h.deCy = h.cy;
    campo.heroiMudou = true;
  }
  const alvo = campo.alvo != null ? campo.mobs.get(campo.alvo) : null;
  const alvoValido = alvo && !alvo.morto ? alvo : null;
  if (!alvoValido) campo.alvo = null;
  let encostado = false;
  if (alvoValido) {
    encostado = chebyshev(h.cx, h.cy, alvoValido.cx, alvoValido.cy) <= dist && !h.andando;
    if (!h.andando && !encostado) {
      const passo = passoLegado(g, h.cx, h.cy, alvoValido.cx, alvoValido.cy, ocupadas, dist);
      if (passo) {
        darPasso(h, passo.cx, passo.cy, agora, passoComBicicleta(MS_PASSO_HEROI, campo.velocidade));
        campo.heroiMudou = true;
      } else {
        const d = direcaoDe(alvoValido.cx - h.cx, alvoValido.cy - h.cy);
        if (d !== h.dir) {
          h.dir = d;
          campo.heroiMudou = true;
        }
      }
    }
    if (encostado) {
      const d = direcaoDe(alvoValido.cx - h.cx, alvoValido.cy - h.cy);
      if (d !== h.dir) {
        h.dir = d;
        campo.heroiMudou = true;
      }
    }
  }
  const tr = campo.treinador;
  if (tr) {
    if (tr.andando && parado(tr, agora)) {
      tr.andando = false;
      tr.deCx = tr.cx;
      tr.deCy = tr.cy;
      campo.treinadorMudou = true;
    }
    if (!tr.andando && chebyshev(tr.cx, tr.cy, h.cx, h.cy) > DIST_COMBATE) {
      const passo = passoLegado(g, tr.cx, tr.cy, h.cx, h.cy, null);
      if (passo) {
        darPasso(tr, passo.cx, passo.cy, agora, passoComBicicleta(MS_PASSO_TREINADOR, campo.velocidade));
        campo.treinadorMudou = true;
      }
    } else if (!tr.andando) {
      const d = direcaoDe(h.cx - tr.cx, h.cy - tr.cy);
      if (d !== tr.dir) {
        tr.dir = d;
        campo.treinadorMudou = true;
      }
    }
  }
  for (const m of campo.mobs.values()) {
    if (m.morto) continue;
    if (m.fixo) {
      const d = direcaoDe(h.cx - m.cx, h.cy - m.cy);
      if (d !== m.dir) {
        m.dir = d;
        campo.mudou.add(m.slot);
      }
      continue;
    }
    if (m.andando && parado(m, agora)) {
      m.andando = false;
      m.deCx = m.cx;
      m.deCy = m.cy;
      m.proxPasso = agora + PAUSA_MOB[0] + Math.random() * (PAUSA_MOB[1] - PAUSA_MOB[0]);
      campo.mudou.add(m.slot);
    }
    if (m.andando) continue;
    const distM = chebyshev(m.cx, m.cy, h.cx, h.cy);
    const raioPerseg = campo.raioPersegucao ?? RAIO_PERSEGUICAO;
    const raioDesist = campo.raioDesistir ?? RAIO_DESISTIR;
    if (!alvoValido || distM > raioDesist) m.irritado = false;
    else if (distM <= raioPerseg) m.irritado = true;
    const perseguindo = !!alvoValido && m.irritado;
    if (!perseguindo && agora < m.proxPasso) continue;
    if (perseguindo) {
      if (chebyshev(m.cx, m.cy, h.cx, h.cy) <= DIST_COMBATE) {
        const d = direcaoDe(h.cx - m.cx, h.cy - m.cy);
        if (d !== m.dir) {
          m.dir = d;
          campo.mudou.add(m.slot);
        }
        m.proxPasso = agora + 400;
        continue;
      }
      const passo = passoLegado(g, m.cx, m.cy, h.cx, h.cy, ocupadas);
      if (passo) {
        ocupadas.delete(celula(m.cx, m.cy));
        ocupadas.add(celula(passo.cx, passo.cy));
        darPasso(m, passo.cx, passo.cy, agora, MS_PASSO_MOB);
        campo.mudou.add(m.slot);
        continue;
      }
    }
    const opcoes = [];
    for (const [dx, dy] of VIZINHOS) {
      const nx = m.cx + dx;
      const ny = m.cy + dy;
      if (!andavel(g, nx, ny)) continue;
      if (ocupadas.has(celula(nx, ny))) continue;
      if (chebyshev(nx, ny, m.ancora[0], m.ancora[1]) > RAIO_VAGUEIO) continue;
      opcoes.push(nx, ny);
    }
    if (!opcoes.length) {
      m.proxPasso = agora + 900;
      continue;
    }
    const k = 2 * Math.floor((Math.random() * opcoes.length) / 2);
    ocupadas.delete(celula(m.cx, m.cy));
    ocupadas.add(celula(opcoes[k], opcoes[k + 1]));
    darPasso(m, opcoes[k], opcoes[k + 1], agora, MS_PASSO_MOB);
    campo.mudou.add(m.slot);
  }
  return encostado;
}

function limparLegado(campo, agora) {
  const corpos = [];
  for (const m of campo.mobs.values()) {
    if (!m.morto) continue;
    if (agora - (m.mortoEm ?? agora) >= CORPO_MS) {
      campo.mobs.delete(m.slot);
      campo.mudou.add(m.slot);
    } else corpos.push(m);
  }
  if (corpos.length <= MAX_CORPOS) return;
  corpos.sort((a, b) => a.mortoEm - b.mortoEm);
  for (const m of corpos.slice(0, corpos.length - MAX_CORPOS)) {
    campo.mobs.delete(m.slot);
    campo.mudou.add(m.slot);
  }
}

function deltaLegado(campo, agora) {
  if (!campo.mudou.size && !campo.heroiMudou && !campo.treinadorMudou) return null;
  const d = { seq: ++campo.seq, ts: agora, alvo: campo.alvo };
  if (campo.heroiMudou) d.heroi = serializarHeroi(campo.heroi);
  if (campo.treinadorMudou && campo.treinador) {
    d.treinador = serializarHeroi(campo.treinador);
    campo.treinadorMudou = false;
  }
  if (campo.mudou.size) {
    d.mobs = [...campo.mudou].map((slot) => campo.mobs.get(slot)).filter(Boolean).map(serializarMob);
    d.fora = [...campo.mudou].filter((slot) => !campo.mobs.has(slot));
    if (!d.fora.length) delete d.fora;
  }
  campo.mudou.clear();
  campo.heroiMudou = false;
  return d;
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

const aleatorioOriginal = Math.random;
const agoraOriginal = Date.now;

/** O estado observável do campo, sem a grade (compartilhada) e sem os rascunhos da busca. */
function retrato(campo) {
  return JSON.stringify({
    seq: campo.seq, alvo: campo.alvo, heroiMudou: campo.heroiMudou, treinadorMudou: campo.treinadorMudou,
    heroi: campo.heroi, treinador: campo.treinador, mudou: [...campo.mudou],
    mobs: [...campo.mobs.entries()],
  });
}

function clonarCampo(campo) {
  const { g, ...resto } = campo;
  const copia = structuredClone(resto);
  copia.g = g;
  return copia;
}

/** Um selvagem qualquer — o movimento só lê posição, estado e os campos do pacote. */
const dadosMob = (i) => ({ hp: 50, maxHp: 50, nome: `mob${i}`, level: 5, looktype: 100 + i, shiny: i % 11 === 0 });

// --------------------------------------------------------------- a comparação

console.log('MOVIMENTO DO CAMPO — otimizado × original\n=========================================');

const slugs = Object.keys(grades).sort().filter((_, i) => i % 7 === 0).slice(0, 110);
let campos = 0;
let ticks = 0;
let diferencas = 0;
let primeira = '';
let passosDados = 0;
let corposLimpos = 0;

const cronometro = { legado: 0, novo: 0 };
for (const [n, slug] of slugs.entries()) {
  const rEventos = prng(1000 + n);
  const t0 = 1_800_000_000_000;
  Math.random = prng(5000 + n);
  const base = criarCampo(slug, t0);
  if (!base) continue;
  base.g.pontos.slice(0, 16).forEach((ponto, i) => porMobEmCampo(base, dadosMob(i), ponto, t0));
  Math.random = aleatorioOriginal;
  if (!base.mobs.size) continue;
  campos++;

  const lados = [
    { nome: 'legado', campo: clonarCampo(base), rng: prng(9000 + n), mover: moverLegado, limpar: limparLegado, delta: deltaLegado },
    { nome: 'novo', campo: clonarCampo(base), rng: prng(9000 + n), mover: moverCampo, limpar: limparCorpos, delta: deltaCampo },
  ];

  let t = t0;
  for (let tick = 0; tick < 480; tick++) {
    t += 250;
    // Eventos de jogo sorteados FORA do Math.random dos lados, iguais para os dois.
    const vivos = [...lados[0].campo.mobs.values()].filter((m) => !m.morto).map((m) => m.slot);
    const ev = rEventos();
    const escolhido = vivos.length ? vivos[Math.floor(rEventos() * vivos.length)] : null;
    const velocidade = [1, 1, 1.15, 1.5, 2][Math.floor(rEventos() * 5)];
    const resultados = [];
    for (const lado of lados) {
      const c = lado.campo;
      if (tick % 40 === 0) c.velocidade = velocidade;
      if (ev < 0.04 && c.alvo != null && c.mobs.get(c.alvo) && !c.mobs.get(c.alvo).morto) {
        const m = c.mobs.get(c.alvo); // o alvo morreu: vira corpo
        m.morto = true;
        m.mortoEm = t;
        c.mudou.add(m.slot);
      } else if (ev < 0.10 && escolhido != null) {
        c.alvo = escolhido; // o herói escolhe outro alvo
      } else if (ev < 0.12) {
        c.alvo = null; // parou de caçar (desmaio, centro)
      }
      Math.random = lado.rng;
      Date.now = () => t;
      const inicio = performance.now();
      const encostado = lado.mover(c, t);
      lado.limpar(c, t);
      const pacote = lado.delta(c, t);
      cronometro[lado.nome] += performance.now() - inicio;
      Math.random = aleatorioOriginal;
      Date.now = agoraOriginal;
      resultados.push({ encostado, pacote: JSON.stringify(pacote), estado: retrato(c) });
    }
    ticks++;
    const [a, b] = resultados;
    if (a.encostado !== b.encostado || a.pacote !== b.pacote || a.estado !== b.estado) {
      diferencas++;
      if (!primeira) {
        const onde = a.encostado !== b.encostado ? 'encostado' : a.pacote !== b.pacote ? 'pacote' : 'estado';
        primeira = `${slug} tick ${tick}: ${onde} diferente\n     antes ${onde === 'pacote' ? a.pacote : a.estado}\n     agora ${onde === 'pacote' ? b.pacote : b.estado}`.slice(0, 900);
      }
    }
    if (a.pacote.includes('"mobs"')) passosDados++;
    if (a.pacote.includes('"fora"')) corposLimpos++;
  }
}
Math.random = aleatorioOriginal;
Date.now = agoraOriginal;

console.log(`\n${campos} campos de hunt reais · ${ticks} ticks comparados`);
ok(campos > 50, 'os campos de hunt montaram');
ok(diferencas === 0, 'encostado, pacote de campo e estado inteiro idênticos em todo tick', primeira);
ok(passosDados > 1000 && corposLimpos > 10, `a amostra exercita o movimento (${passosDados} pacotes com selvagens) e a limpeza de corpos (${corposLimpos} com "fora")`);
console.log(`\ntempo de movimento + corpos + pacote: original ${cronometro.legado.toFixed(0)} ms · otimizado ${cronometro.novo.toFixed(0)} ms · ${(cronometro.legado / cronometro.novo).toFixed(1)}×`);
ok(cronometro.novo < cronometro.legado, 'o otimizado gasta menos');

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
