/**
 * Preenche `attacks` dos pokémon em creatures-novos.json — hoje só 2 golpes por tipo.
 *
 * Meta (média do espelho gen 1–3):
 *   1ª fase → 8 · 2ª fase → 10 · 3ª fase / lendário → 12
 *
 *   node tools/aplicar-ataques-novos.mjs
 *   node tools/aplicar-ataques-novos.mjs --dry
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LENDARIO_DEX } from '../tools/nomeador/spawns-filtro.mjs';
import { injetarGolpesEspeciais } from '../game/src/shared/golpes-especiais.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRE_BASE = join(RAIZ, 'public/data/creatures.json');
const CRE_NOVOS = join(RAIZ, 'game/src/server/dados/creatures-novos.json');

const dry = process.argv.includes('--dry');

const META_POR_FASE = [8, 10, 12];
const LEARN = {
  8: [1, 1, 1, 1, 4, 16, 16, 16],
  10: [1, 1, 1, 1, 1, 4, 6, 10, 16, 16],
  12: [1, 1, 1, 1, 1, 1, 4, 10, 16, 16, 26, 40],
};

const dexDe = (id) => (id < 1000 ? id : id % 1000);

/** RNG determinístico por dex — mesma espécie, mesmos golpes. */
function rng(dex, salt = 0) {
  let s = (dex * 7919 + salt * 104729) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const BASICOS = new Set([
  'Tackle', 'Quick Attack', 'Scratch', 'Tail Whip', 'Leer', 'Growl', 'Water Gun',
  'Ember', 'Vine Whip', 'Thunder Shock', 'Powder Snow', 'Peck', 'Absorb', 'Pound',
  'Bubble', 'Rock Throw', 'Confusion', 'Poison Sting', 'Bug Bite', 'Bite', 'Headbutt',
]);

/** Pools de golpes por tipo — prioriza gen 1–3 e espécies que têm o tipo. */
function montarPools(base) {
  const porTipo = new Map();
  const add = (a, peso) => {
    const t = a.type;
    if (!t) return;
    const pow = a.power ?? 0;
    if (pow < 50 && !BASICOS.has(a.name)) return;
    if (/squishy|selfdestruction|epicenter/i.test(a.name) && !BASICOS.has(a.name)) return;
    const bag = porTipo.get(t) ?? new Map();
    const hit = bag.get(a.name);
    if (!hit || peso > hit.peso) bag.set(a.name, { atk: a, peso });
    porTipo.set(t, bag);
  };

  for (const c of base) {
    const dex = dexDe(c.pokeId);
    const n = (c.attacks ?? []).length;
    if (n < 4) continue;
    let peso = dex <= 151 ? 3 : dex <= 251 ? 2 : dex <= 386 ? 2 : dex <= 649 ? 1 : 0;
    if (!peso) continue;
    const tiposEsp = [c.type1, c.type2].filter(Boolean);
    for (const a of c.attacks) {
      if (!tiposEsp.includes(a.type)) continue;
      add(a, peso + (a.type === c.type1 ? 1 : 0));
    }
  }

  // fallback universal
  const padrao = [
    { name: 'Tackle', power: 56, type: 'NORMAL', category: 'PHYSICAL', cooldownMs: 10000 },
    { name: 'Quick Attack', power: 56, type: 'NORMAL', category: 'PHYSICAL', cooldownMs: 10000 },
    { name: 'Headbutt', power: 70, type: 'NORMAL', category: 'PHYSICAL', cooldownMs: 12000 },
    { name: 'Hyper Beam', power: 150, type: 'NORMAL', category: 'SPECIAL', cooldownMs: 30000 },
    { name: 'Swift', power: 60, type: 'NORMAL', category: 'SPECIAL', cooldownMs: 15000 },
  ];
  for (const a of padrao) {
    const bag = porTipo.get('NORMAL') ?? new Map();
    if (!bag.has(a.name)) bag.set(a.name, { atk: a, peso: 1 });
    porTipo.set('NORMAL', bag);
  }

  const saida = new Map();
  for (const [tipo, bag] of porTipo) {
    saida.set(
      tipo,
      [...bag.values()].sort((a, b) => b.peso - a.peso).map((x) => ({ ...x.atk })),
    );
  }
  return saida;
}

/** Grafo evolutivo por dex (creatures-novos + espelho). */
function grafoEvo(lista) {
  const evoPara = new Map();
  for (const c of lista) {
    if (!c.evolvesToId) continue;
    evoPara.set(dexDe(c.pokeId), dexDe(c.evolvesToId));
  }
  return evoPara;
}

function profundidade(dex, evoPara, memo = new Map()) {
  if (memo.has(dex)) return memo.get(dex);
  let d = 0;
  for (const [de, para] of evoPara) {
    if (para === dex) d = Math.max(d, profundidade(de, evoPara, memo) + 1);
  }
  memo.set(dex, d);
  return d;
}

function metaGolpes(c, evoPara) {
  const dex = dexDe(c.pokeId);
  const prof = profundidade(dex, evoPara);
  if (c.rarity === 'LEGENDARY' || c.rarity === 'MYTHIC' || LENDARIO_DEX.has(dex)) return 12;
  return META_POR_FASE[Math.min(prof, META_POR_FASE.length - 1)];
}

function escolherGolpes(c, pools, qtd) {
  const rand = rng(dexDe(c.pokeId), c.name.length);
  const usados = new Set();
  const out = [];

  const ordenar = (lista) => {
    const dano = lista.filter((a) => (a.power ?? 0) >= 45);
    const util = lista.filter((a) => (a.power ?? 0) < 45);
    return [...shuffle(dano, rand), ...shuffle(util, rand)];
  };

  const puxar = (tipo, max) => {
    const lista = ordenar(pools.get(tipo) ?? pools.get('NORMAL') ?? []);
    let nTipo = 0;
    for (const a of lista) {
      if (out.length >= qtd) break;
      if (max != null && nTipo >= max) break;
      if (usados.has(a.name)) continue;
      usados.add(a.name);
      out.push({ ...a });
      nTipo++;
    }
  };

  // Básicos sempre presentes (como Caterpie / Rattata na gen 1)
  for (const nome of ['Tackle', 'Quick Attack']) {
    if (out.length >= qtd) break;
    const norm = (pools.get('NORMAL') ?? []).find((a) => a.name === nome);
    if (norm && !usados.has(nome)) {
      usados.add(nome);
      out.push({ ...norm });
    }
  }

  const n1 = Math.max(3, Math.ceil(qtd * 0.55));
  puxar(c.type1, n1);
  if (c.type2) puxar(c.type2, Math.max(2, Math.ceil(qtd * 0.35)));
  if (c.type1 !== 'NORMAL' && out.length < qtd) puxar('NORMAL', 2);

  // Completa até a meta — espelha cadeias longas da gen 1
  let tentativas = 0;
  while (out.length < qtd && tentativas++ < 4) {
    puxar(c.type1);
    if (c.type2) puxar(c.type2);
    if (c.type1 !== 'NORMAL') puxar('NORMAL');
  }

  const lv = LEARN[qtd] ?? LEARN[8].concat(Array(qtd - 8).fill(26));
  return out.slice(0, qtd).map((a, i) => ({
    name: a.name,
    power: a.power,
    type: a.type,
    category: a.category ?? 'PHYSICAL',
    cooldownMs: a.cooldownMs ?? 10000,
    learnLevel: lv[i] ?? 16,
  }));
}

const base = JSON.parse(readFileSync(CRE_BASE, 'utf8')).creatures;
const novos = JSON.parse(readFileSync(CRE_NOVOS, 'utf8'));
const pools = montarPools(base);
const evoPara = grafoEvo([...base, ...novos.creatures]);

let alterados = 0;
const hist = {};

for (const c of novos.creatures) {
  const qtd = metaGolpes(c, evoPara);
  c.attacks = escolherGolpes(c, pools, qtd);
  injetarGolpesEspeciais(c);
  alterados++;
  hist[qtd] = (hist[qtd] ?? 0) + 1;
}

console.log(`Alterados: ${alterados}/${novos.creatures.length}`);
console.log('Distribuição:', hist);

const amostra = novos.creatures.filter((c) => c.name === 'Kyogre' || c.name === 'Zigzagoon' || c.name === 'Linoone');
for (const c of amostra.slice(0, 4)) {
  console.log(`  ${c.name} (${c.type1}${c.type2 ? '/' + c.type2 : ''}): ${c.attacks.length} golpes → ${c.attacks.map((a) => a.name).join(', ')}`);
}

if (!dry) {
  writeFileSync(CRE_NOVOS, JSON.stringify(novos, null, 2) + '\n', 'utf8');
  console.log('Gravado em', CRE_NOVOS);
} else {
  console.log('(dry-run — arquivo não gravado)');
}
