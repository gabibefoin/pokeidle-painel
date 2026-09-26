/**
 * Varredura: `evolveLevel` × o nível da hunt onde o ALVO de fato aparece.
 *
 * A régua é a mesma que `NIVEIS_POR_ONDE_O_ALVO_APARECE` (shared/evolucoes-cruzadas.mjs) segue
 * e que a ficha da espécie mostra em `corpoDaEspecie`: o MENOR nível entre as hunts em que o
 * alvo aparece. Se os dois discordam, a Pokédex promete um degrau que o jogo não cobra — foi o
 * caso do Tirtouga, que dizia "vira Carracosta no Nv 6.950" com o Carracosta numa hunt de 1.125.
 *
 * Confere as três tabelas que escrevem `evolveLevel`, porque as três precisam contar a mesma
 * história: a de níveis, a das cadeias que abrem em mais de um destino e a dos elos entre
 * gerações.
 *
 * O recorte tem duas metades, iguais às da tabela: alvo em Sinnoh–Alola, e os BEBÊS — base de
 * geração posterior à do alvo (Mime Jr. de Sinnoh virando um Mr. Mime de Kanto), em que a hunt
 * do alvo fica ABAIXO da hunt da base e o degrau deixa de ser trava.
 *
 *   node game/tools/auditoria-evolucao-hunt.mjs
 */
import { especies, huntsJogaveis } from '../src/server/content.mjs';
import { dexDe } from '../src/shared/escala-hunt-level.mjs';
import { isOutlandPokeId } from '../src/shared/outland.mjs';
import { EVOLUCOES_RAMIFICADAS } from '../src/shared/evolucoes-ramificadas.mjs';
import { EVOLUCOES_ENTRE_GERACOES } from '../src/shared/evolucoes-cruzadas.mjs';

const REGS = [['Sinnoh', 387, 493], ['Unova', 494, 649], ['Kalos', 650, 721], ['Alola', 722, 809]];
const regDoDex = (d) => REGS.find(([, a, b]) => d >= a && d <= b)?.[0] ?? null;

const GERACOES = [
  [1, 151, 1], [152, 251, 2], [252, 386, 3], [387, 493, 4], [494, 649, 5],
  [650, 721, 6], [722, 809, 7], [810, 905, 8], [906, 1025, 9],
];
const geracao = (dex) => GERACOES.find(([a, b]) => dex >= a && dex <= b)?.[2] ?? null;

/** dex → nível da hunt mais baixa em que ele aparece, e a lista inteira para o relatório. */
const nivelPorDex = new Map();
const huntsPorDex = new Map();
for (const h of huntsJogaveis) {
  for (const e of h.especies ?? []) {
    if (isOutlandPokeId(e.pokeId)) continue;
    const d = dexDe(e.pokeId);
    nivelPorDex.set(d, Math.min(nivelPorDex.get(d) ?? Infinity, h.nivel));
    if (!huntsPorDex.has(d)) huntsPorDex.set(d, []);
    huntsPorDex.get(d).push(`${h.slug}=${h.nivel}`);
  }
}

const divergentes = [];
const semHunt = [];
let conferidos = 0;
for (const c of [...especies.values()].sort((a, b) => a.pokeId - b.pokeId)) {
  if (isOutlandPokeId(c.pokeId) || !c.evolvesToId || c.evolvesToId <= 0) continue;
  const alvoDex = dexDe(c.evolvesToId);
  const ehBebe = (geracao(dexDe(c.pokeId)) ?? 0) > (geracao(alvoDex) ?? 0);
  if (!regDoDex(alvoDex) && !ehBebe) continue;
  const alvo = especies.get(c.evolvesToId);
  const ideal = nivelPorDex.get(alvoDex) ?? null;
  const linha = {
    pokeId: c.pokeId, nome: c.name, atual: c.evolveLevel ?? 0,
    alvoDex, alvoNome: alvo?.name ?? `#${c.evolvesToId}`, ideal,
    bebe: ehBebe,
    onde: EVOLUCOES_RAMIFICADAS[c.pokeId] ? 'EVOLUCOES_RAMIFICADAS'
      : EVOLUCOES_ENTRE_GERACOES[c.pokeId] ? 'EVOLUCOES_ENTRE_GERACOES'
        : 'NIVEIS_POR_ONDE_O_ALVO_APARECE',
  };
  if (ideal === null) semHunt.push(linha);
  else {
    conferidos++;
    if (linha.atual !== ideal) divergentes.push(linha);
  }
}

console.log(`elos conferidos (Sinnoh–Alola + bebês): ${conferidos} · divergentes: ${divergentes.length}`);
for (const l of divergentes) {
  console.log(`   #${l.pokeId} ${l.nome} → ${l.alvoNome}: pede ${l.atual}, hunt do alvo ${l.ideal}  [${l.onde}]${l.bebe ? ' (bebê)' : ''}`);
}

const bebes = [...especies.values()].filter((c) => !isOutlandPokeId(c.pokeId) && c.evolvesToId > 0
  && (geracao(dexDe(c.pokeId)) ?? 0) > (geracao(dexDe(c.evolvesToId)) ?? 0));
console.log(`
bebês — base de geração posterior ao alvo (${bebes.length}):`);
for (const c of bebes.sort((a, b) => a.pokeId - b.pokeId)) {
  const alvoDex = dexDe(c.evolvesToId);
  const meu = nivelPorDex.get(dexDe(c.pokeId));
  console.log(`   #${c.pokeId} ${c.name} (hunt ${meu ?? '—'}) → ${especies.get(c.evolvesToId)?.name} `
    + `(hunt ${nivelPorDex.get(alvoDex) ?? '—'}) · pede ${c.evolveLevel}`
    + `${meu && c.evolveLevel <= meu ? ' · evolui de saída' : ' · precisa subir'}`);
}

console.log(`\nalvo sem hunt jogável — caem no huntLevel da espécie (${semHunt.length}):`);
for (const l of semHunt) console.log(`   #${l.pokeId} ${l.nome} → ${l.alvoNome} (pede ${l.atual})`);

const duplas = [...huntsPorDex].filter(([, hs]) => new Set(hs.map((x) => x.split('=')[1])).size > 1);
console.log(`\nespécies em hunts de níveis diferentes — é delas que sai o "menor" da regra (${duplas.length}):`);
for (const [d, hs] of duplas.sort((a, b) => a[0] - b[0])) {
  console.log(`   #${d} ${especies.get(d)?.name ?? '?'}: ${hs.join('  ')}`);
}
