#!/usr/bin/env node
/**
 * Reescreve o loot de Sinnoh → Alola em `creatures-novos.json` seguindo a regra de Kanto/Johto.
 *
 * ### A regra, medida nas 251 espécies de referência
 *
 * O que um pokémon solta é do TIPO dele. A pedra de evolução de um tipo cai de bicho daquele
 * tipo e de mais ninguém: Fire Stone 100% de FIRE, Water Stone 100% de WATER, Leaf 100% de
 * GRASS, Cocoon 100% de BUG, e o mesmo em Thunder, Ice, Punch, Venom, Earth, Feather, Rock e
 * Metal. Cada tipo ainda tem um item ASSINATURA que cai de todos os seus: Water Gem em 46/46
 * de WATER, Bug Gosme em 22/22 de BUG, Screw em 15/15 de ELECTRIC, Essence of Fire em 20/20
 * de FIRE. O resto da lista é sobra temática do próprio tipo, e uns 20% escapam para tipos
 * vizinhos — um GRASS/POISON solta Venom Stone, um ROCK solta Earth Ball.
 *
 * ### O que estava errado
 *
 * A versão anterior deste script montava a pool do tipo e depois **sorteava 3–5 itens dela ao
 * acaso**. A pool de BUG carrega Rock Stone, Metal Stone e Feather Stone (que em Kanto caem de
 * um Scyther, de um Forretress, de um Ledyba — bichos BUG/algo), e o sorteio entregava esses
 * três a um Combee sem lhe dar a Cocoon Stone. Resultado denunciado por jogador: um BUG/FLYING
 * dropando ROCK e STEEL, e sem a pedra de que ele PRECISA para virar Vespiquen.
 *
 * ### O que este faz
 *
 *   1. Monta a pool de cada tipo a partir de Kanto/Johto, guardando a frequência (n/N) e a
 *      chance média de cada item — a textura da região de referência, não uma lista chapada.
 *   2. Para cada espécie, sorteia da pool do tipo PRIMÁRIO unida à do SECUNDÁRIO, com peso na
 *      frequência: item que cai de todo mundo continua caindo de todo mundo.
 *   3. **Corta toda PEDRA de tipo que a espécie não tem.** É o filtro que faltava, e é onde
 *      Rock/Metal Stone saem do Combee — um BUG/POISON continua podendo soltar Venom Stone,
 *      porque POISON é dele.
 *   4. Garante o item assinatura do tipo primário (freq ≥ 0,9 na referência).
 *   5. Garante a PRÓPRIA pedra de evolução em quem evolui. Aqui a regra se afasta de Kanto de
 *      propósito: 37% das espécies de lá não soltam a pedra delas, mas **cada hunt tem uma
 *      espécie só** — quem farma Combee só vê drop de Combee, e sem a Cocoon Stone ali a
 *      evolução dele não existe sem passar pelo Mercado. A pedra segue `tipoDaPedraDeEvolucao`,
 *      então o Starly pede Feather Stone e não Sun Stone.
 *
 * O sorteio é determinístico por `pokeId`: o mesmo bicho gera sempre o mesmo loot, e rodar duas
 * vezes não mexe em nada.
 *
 *   node tools/povoar-loot-regioes.mjs --refazer
 *   node tools/povoar-loot-regioes.mjs --refazer --dry-run
 *   node tools/povoar-loot-regioes.mjs --de 252 --ate 386 --refazer   (Hoenn, se um dia quiser)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dexDe } from '../game/src/shared/escala-hunt-level.mjs';
import { tipoDaPedraDeEvolucao, EVOLUCOES_RAMIFICADAS } from '../game/src/shared/evolucoes-ramificadas.mjs';
import { TIPO_DO_ITEM, itensPorNome } from '../game/src/server/content.mjs';
import { PEDRA_POR_TIPO, PEDRAS, TIPOS_DA_PEDRA } from '../game/src/shared/pedras-evolucao.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CREATURES_BASE = join(RAIZ, 'public/data/creatures.json');
const CREATURES_NOVOS = join(RAIZ, 'game/src/server/dados/creatures-novos.json');

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : padrao;
};
const DEX_MIN = arg('--de', 387);   // Sinnoh
const DEX_MAX = arg('--ate', 809);  // Alola
const LOOT_MIN = 3;
const LOOT_MAX = 5;
const dryRun = process.argv.includes('--dry-run');
const refazer = process.argv.includes('--refazer');

const tipoDoItem = (nome) => {
  if (PEDRAS.has(nome)) return TIPOS_DA_PEDRA(nome)[0] ?? null;
  const it = itensPorNome.get(String(nome).toLowerCase());
  return it ? (TIPO_DO_ITEM.get(it.id) ?? null) : null;
};

const { creatures: base } = JSON.parse(readFileSync(CREATURES_BASE, 'utf8'));
const doc = JSON.parse(readFileSync(CREATURES_NOVOS, 'utf8'));
/** pokeId → espécie, base e novos juntos: `tipoDaPedraDeEvolucao` precisa do DESTINO. */
const porId = new Map([...base, ...doc.creatures].map((c) => [c.pokeId, c]));

/** PRNG determinístico — o mesmo pokeId sempre gera o mesmo loot. */
function rng(pokeId) {
  let s = (pokeId * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const intEntre = (r, min, max) => min + Math.floor(r() * (max - min + 1));

/**
 * Pools por type1 a partir dos drops de Kanto e Johto, com a frequência de cada item.
 * `freq` = em que fração das espécies daquele tipo o item cai. É o peso do sorteio.
 */
function montarPools() {
  const bruto = {};
  const quantos = {};
  for (const c of base) {
    const dex = dexDe(c.pokeId);
    if (dex > 251 || c.pokeId >= 1000 || !c.type1) continue;
    quantos[c.type1] = (quantos[c.type1] ?? 0) + 1;
    bruto[c.type1] ??= new Map();
    for (const e of c.loot ?? []) {
      if (!e.chance || !itensPorNome.has(String(e.name).toLowerCase())) continue;
      const cur = bruto[c.type1].get(e.name) ?? { name: e.name, n: 0, chances: [], mins: [], maxs: [] };
      cur.n++;
      cur.chances.push(e.chance);
      cur.mins.push(e.minCount ?? 1);
      cur.maxs.push(e.maxCount ?? 1);
      bruto[c.type1].set(e.name, cur);
    }
  }
  const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const pools = {};
  for (const [tipo, mapa] of Object.entries(bruto)) {
    pools[tipo] = [...mapa.values()].map((p) => ({
      name: p.name,
      freq: p.n / quantos[tipo],
      chance: Math.round(media(p.chances)),
      minCount: Math.max(1, Math.round(media(p.mins))),
      maxCount: Math.max(1, Math.round(media(p.maxs))),
      tipoItem: tipoDoItem(p.name),
    })).sort((a, b) => b.freq - a.freq || a.name.localeCompare(b.name));
  }
  return pools;
}

/** Tipo cuja pool usar — `type1`, com desvios para os dados tortos do espelho (Burmy é "PLANT"). */
function tipoParaPool(c, pools) {
  if (pools[c.type1]?.length) return c.type1;
  if (c.type2 && pools[c.type2]?.length) return c.type2;
  const freq = {};
  for (const a of c.attacks ?? []) if (pools[a.type]?.length) freq[a.type] = (freq[a.type] ?? 0) + 1;
  const porAtaque = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0];
  return porAtaque ?? (pools.NORMAL?.length ? 'NORMAL' : Object.keys(pools)[0]);
}

/** A chance de referência de uma pedra em Kanto/Johto — para a que é forçada e não está na pool. */
function chanceDaPedra(nome, pools) {
  const vistas = Object.values(pools).flat().filter((p) => p.name === nome);
  if (!vistas.length) return 400;
  return Math.round(vistas.reduce((s, p) => s + p.chance, 0) / vistas.length);
}

function gerarLoot(c, pools) {
  const tipoPool = tipoParaPool(c, pools);
  const tipoSec = c.type2 && pools[c.type2] && c.type2 !== tipoPool ? c.type2 : null;
  const meus = new Set([tipoPool, tipoSec].filter(Boolean));

  // 3) as pedras permitidas: só as dos tipos que a espécie TEM, mais a(s) que ela precisa.
  //
  // `?? PEDRA_POR_TIPO.NORMAL` repete o fallback do `pedraDeEvolucao` (content.mjs), e não é
  // teoria: o espelho escreveu o NOME DA FORMA no lugar do tipo em três espécies — Burmy é
  // "PLANT/CLOAK", Basculin é "RED-STRIPED/FORM", Pumpkaboo é "AVERAGE/SIZE". O servidor cobra
  // Sun Stone dos três, porque é onde o fallback dele cai; sem repetir a conta aqui, a hunt
  // deles não soltaria a pedra que a evolução deles pede.
  //
  // Cadeia que abre em mais de um destino precisa das pedras de TODOS: um Burmy que só solta
  // Sun Stone tem o Wormadam e não tem o Mothim, que pede Cocoon Stone.
  const pedrasProprias = new Set();
  if (c.evolvesToId > 0) {
    const destinos = EVOLUCOES_RAMIFICADAS[c.pokeId]?.map((r) => porId.get(r.para)).filter(Boolean) ?? [null];
    for (const destino of destinos) {
      const tipo = tipoDaPedraDeEvolucao(c, destino) ?? tipoPool;
      pedrasProprias.add(PEDRA_POR_TIPO[tipo] ?? PEDRA_POR_TIPO.NORMAL);
    }
  }
  const pedraOk = (nome) =>
    pedrasProprias.has(nome) || TIPOS_DA_PEDRA(nome).some((t) => meus.has(t));

  // candidatos: pool do primário ∪ pool do secundário, ficando com a maior frequência
  const cand = new Map();
  for (const t of meus) {
    for (const p of pools[t] ?? []) {
      if (PEDRAS.has(p.name) && !pedraOk(p.name)) continue;
      const at = cand.get(p.name);
      if (!at || p.freq > at.freq) cand.set(p.name, p);
    }
  }
  if (!cand.size) return null;

  const r = rng(c.pokeId);
  const alvo = Math.min(cand.size, intEntre(r, LOOT_MIN, LOOT_MAX));
  const escolhidos = new Map();

  // 4) assinatura do tipo primário — o que cai de 90%+ da referência cai daqui também.
  //
  // No máximo DUAS, e nunca uma pedra. STEEL tem duas espécies de referência e DRAGON tem
  // três, então "cai de 90%+" ali significa "cai das duas", e passar a lista inteira adiante
  // daria loot idêntico a todo pokémon de aço da região. A pedra fica de fora deste passo
  // porque ela tem o passo 5, que é onde se decide de propósito quem a solta.
  const assinatura = [...cand.values()].filter((p) => p.freq >= 0.9 && !PEDRAS.has(p.name)).slice(0, 2);
  for (const p of assinatura) escolhidos.set(p.name, p);

  // 5) a(s) própria(s) pedra(s), para quem evolui
  for (const pedra of pedrasProprias) {
    if (escolhidos.has(pedra)) continue;
    escolhidos.set(pedra, cand.get(pedra) ?? {
      name: pedra,
      freq: 0.5,
      chance: chanceDaPedra(pedra, pools),
      minCount: 1,
      maxCount: 1,
    });
  }

  // 2) o resto, sorteado com peso na frequência.
  //
  // Item de tipo alheio entra com peso reduzido. Ele não é banido — em Kanto um ROCK solta
  // Earth Ball e um WATER solta Snow Skis, e essa margem é 19% do que cai lá —, mas é CAUDA da
  // pool, não corpo dela. Sorteando 3–5 itens de uma pool de trinta sem esse freio, a cauda
  // entrava com a mesma força do miolo e a aderência das regiões novas ficava dez pontos
  // abaixo da referência.
  const PESO_FORA_DO_TIPO = 0.4;
  const peso = (p) => {
    const doTipo = PEDRAS.has(p.name)
      ? TIPOS_DA_PEDRA(p.name).some((t) => meus.has(t))
      : (!p.tipoItem || meus.has(p.tipoItem));
    return p.freq * (doTipo ? 1 : PESO_FORA_DO_TIPO);
  };
  const resto = [...cand.values()].filter((p) => !escolhidos.has(p.name));
  while (escolhidos.size < alvo && resto.length) {
    const total = resto.reduce((s, p) => s + peso(p), 0);
    let sorteio = r() * total;
    let i = 0;
    for (; i < resto.length - 1; i++) {
      sorteio -= peso(resto[i]);
      if (sorteio <= 0) break;
    }
    escolhidos.set(resto[i].name, resto[i]);
    resto.splice(i, 1);
  }

  const ordenado = [...escolhidos.values()]
    .sort((a, b) => (b.freq ?? 0) - (a.freq ?? 0) || a.name.localeCompare(b.name));
  return ordenado.map(({ name, chance, minCount = 1, maxCount = 1 }) => ({
    name,
    chance,
    minCount,
    maxCount: Math.max(minCount, maxCount),
  }));
}

const pools = montarPools();
console.log('Pools por type1 (Kanto/Johto) — itens · assinatura · pedra do tipo:');
for (const [t, p] of Object.entries(pools).sort()) {
  const assinatura = p.filter((x) => x.freq >= 0.9).map((x) => x.name).join(', ') || '—';
  const pedra = p.find((x) => x.name === PEDRA_POR_TIPO[t]);
  console.log(
    `  ${t.padEnd(9)} ${String(p.length).padStart(3)} itens · ${assinatura} · `
    + `${PEDRA_POR_TIPO[t] ?? '—'} ${pedra ? `(${(pedra.freq * 100).toFixed(0)}%)` : '(ausente)'}`,
  );
}

let refeitos = 0;
let pulados = 0;
let jaTinham = 0;
const mudancas = [];
for (const c of doc.creatures) {
  const dex = dexDe(c.pokeId);
  if (dex < DEX_MIN || dex > DEX_MAX || c.pokeId >= 1000) continue;
  const tinha = (c.loot ?? []).filter((l) => l.chance > 0);
  if (tinha.length && !refazer) {
    jaTinham++;
    continue;
  }
  const loot = gerarLoot(c, pools);
  if (!loot) {
    pulados++;
    console.warn(`  ⚠ sem pool para ${c.name} (${c.type1}${c.type2 ? `/${c.type2}` : ''})`);
    continue;
  }
  const antes = tinha.map((l) => l.name);
  const depois = loot.filter((l) => l.chance > 0).map((l) => l.name);
  if (antes.join('|') !== depois.join('|')) {
    mudancas.push({ dex, nome: c.name, tipos: [c.type1, c.type2].filter(Boolean).join('/'), antes, depois });
  }
  c.loot = loot;
  refeitos++;
}

console.log(`\nDex ${DEX_MIN}–${DEX_MAX}: ${refeitos} espécies com loot reescrito · ${jaTinham} intocadas · ${pulados} sem pool`);
console.log(`Listas que de fato mudaram: ${mudancas.length}`);
for (const m of mudancas.slice(0, 15)) {
  console.log(`  #${m.dex} ${m.nome} (${m.tipos})`);
  console.log(`      antes:  ${m.antes.join(', ')}`);
  console.log(`      depois: ${m.depois.join(', ')}`);
}

if (!dryRun) {
  writeFileSync(CREATURES_NOVOS, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`\nGravado: ${CREATURES_NOVOS}`);
} else {
  console.log('\n(dry-run — arquivo não alterado)');
}
