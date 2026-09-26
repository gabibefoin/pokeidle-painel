/**
 * Varredura dos drops de Sinnoh, Unova, Kalos e Alola contra a regra lida de Kanto/Johto.
 *
 * A regra, medida nas 251 espécies de referência: **o que um pokémon solta é do tipo dele**, e
 * a pedra de evolução de um tipo cai de bicho daquele tipo e de mais ninguém. Uns 20% dos itens
 * escapam para tipos vizinhos (um GRASS/POISON solta Venom Stone), e é essa a margem contra a
 * qual as regiões novas são medidas — não zero.
 *
 * Três perguntas, nesta ordem de gravidade:
 *
 *   1. Alguém evolui sem soltar a pedra que a evolução dele cobra? Cada hunt tem UMA espécie,
 *      então isso é uma evolução que a hunt não entrega.
 *   2. Alguém solta pedra de tipo que não é dele? Foi a denúncia que abriu a varredura — um
 *      Combee BUG/FLYING soltando Rock e Metal Stone.
 *   3. A região INTEIRA tem de onde tirar cada pedra que ela pede?
 *
 *   node game/tools/auditoria-drops-regioes.mjs
 */
import { especies, huntsJogaveis, TIPO_DO_ITEM, itensPorNome } from '../src/server/content.mjs';
import { dexDe } from '../src/shared/escala-hunt-level.mjs';
import { isOutlandPokeId } from '../src/shared/outland.mjs';
import { tipoDaPedraDeEvolucao, EVOLUCOES_RAMIFICADAS } from '../src/shared/evolucoes-ramificadas.mjs';
import { PEDRA_POR_TIPO, PEDRAS, TIPOS_DA_PEDRA } from '../src/shared/pedras-evolucao.mjs';

const REGS = [['Sinnoh', 387, 493], ['Unova', 494, 649], ['Kalos', 650, 721], ['Alola', 722, 809]];
const regDoDex = (d) => REGS.find(([, a, b]) => d >= a && d <= b)?.[0] ?? null;

const tipoDoItem = (nome) => {
  if (PEDRAS.has(nome)) return TIPOS_DA_PEDRA(nome)[0] ?? null;
  const it = itensPorNome.get(String(nome).toLowerCase());
  return it ? (TIPO_DO_ITEM.get(it.id) ?? null) : null;
};
/** A pedra pertence a algum dos tipos do bicho? A Darkness Stone serve DARK e GHOST. */
const pedraDoBicho = (nome, tipos) => TIPOS_DA_PEDRA(nome).some((t) => tipos.has(t));

/**
 * As pedras que a evolução desta espécie cobra — todas, quando a cadeia abre em mais de um
 * destino. O `?? PEDRA_POR_TIPO.NORMAL` repete o fallback do `pedraDeEvolucao` (content.mjs),
 * que é onde caem as três espécies em que o espelho escreveu o nome da forma no lugar do tipo:
 * Burmy "PLANT", Basculin "RED-STRIPED", Pumpkaboo "AVERAGE".
 */
function pedrasQueEvoluem(c) {
  if (!(c.evolvesToId > 0)) return [];
  const destinos = EVOLUCOES_RAMIFICADAS[c.pokeId]?.map((r) => especies.get(r.para)).filter(Boolean) ?? [null];
  return [...new Set(destinos.map((d) => PEDRA_POR_TIPO[tipoDaPedraDeEvolucao(c, d) ?? c.type1] ?? PEDRA_POR_TIPO.NORMAL))];
}

/** Aderência ao tipo numa faixa de dex — a mesma conta em Kanto/Johto e nas regiões novas. */
function aderencia(min, max) {
  let total = 0;
  let dentro = 0;
  for (const c of especies.values()) {
    if (c.pokeId >= 1000) continue;
    const dex = dexDe(c.pokeId);
    if (dex < min || dex > max) continue;
    const tipos = new Set([c.type1, c.type2].filter(Boolean));
    for (const l of c.loot ?? []) {
      if (!l.chance) continue;
      const ti = tipoDoItem(l.name);
      if (!ti) continue;
      total++;
      if (PEDRAS.has(l.name) ? pedraDoBicho(l.name, tipos) : tipos.has(ti)) dentro++;
    }
  }
  return { total, dentro, pct: total ? (100 * dentro) / total : 0 };
}

console.log('1) ADERÊNCIA AO TIPO — fração dos itens dropados que é do tipo do bicho');
const ref = aderencia(1, 251);
console.log(`   Kanto/Johto (referência): ${ref.pct.toFixed(1)}%  (${ref.dentro}/${ref.total})`);
for (const [nome, a, b] of REGS) {
  const r = aderencia(a, b);
  console.log(`   ${nome.padEnd(8)}                 ${r.pct.toFixed(1)}%  (${r.dentro}/${r.total})`);
}

const semPedra = [];
const pedraAlheia = [];
for (const c of especies.values()) {
  if (c.pokeId >= 1000) continue;
  const dex = dexDe(c.pokeId);
  const reg = regDoDex(dex);
  if (!reg) continue;
  const tipos = new Set([c.type1, c.type2].filter(Boolean));
  const ativos = (c.loot ?? []).filter((l) => l.chance > 0);
  const precisa = pedrasQueEvoluem(c);
  const faltando = precisa.filter((p) => !ativos.some((l) => l.name === p));
  if (faltando.length) {
    semPedra.push(`   [${reg}] #${dex} ${c.name.padEnd(26)} ${[...tipos].join('/').padEnd(16)} falta ${faltando.join(', ')}`);
  }
  const erradas = ativos.filter((l) => PEDRAS.has(l.name) && !pedraDoBicho(l.name, tipos) && !precisa.includes(l.name));
  if (erradas.length) {
    pedraAlheia.push(`   [${reg}] #${dex} ${c.name.padEnd(26)} ${[...tipos].join('/').padEnd(16)} solta ${erradas.map((l) => l.name).join(', ')}`);
  }
}
console.log(`\n2a) EVOLUEM SEM SOLTAR A PRÓPRIA PEDRA (${semPedra.length}):`);
console.log(semPedra.join('\n') || '   nenhuma');
console.log(`\n2b) SOLTAM PEDRA DE TIPO ALHEIO (${pedraAlheia.length}):`);
console.log(pedraAlheia.join('\n') || '   nenhuma');

// 3) cada região tem de onde tirar cada pedra que ela pede?
console.log('\n3) PEDRAS PEDIDAS × PEDRAS DISPONÍVEIS, por região');
const huntsPorReg = new Map(REGS.map(([n]) => [n, []]));
for (const h of huntsJogaveis) {
  for (const e of h.especies ?? []) {
    if (isOutlandPokeId(e.pokeId)) continue;
    const reg = regDoDex(dexDe(e.pokeId));
    if (reg) huntsPorReg.get(reg).push(especies.get(e.pokeId));
  }
}
for (const [nome] of REGS) {
  const daRegiao = huntsPorReg.get(nome).filter(Boolean);
  const pedidas = new Set();
  for (const c of daRegiao) for (const p of pedrasQueEvoluem(c)) pedidas.add(p);
  const soltas = new Set();
  for (const c of daRegiao) for (const l of c.loot ?? []) if (l.chance > 0 && PEDRAS.has(l.name)) soltas.add(l.name);
  const faltam = [...pedidas].filter((p) => !soltas.has(p));
  console.log(`   ${nome.padEnd(8)} pede ${String(pedidas.size).padStart(2)} pedras · a região solta ${String(soltas.size).padStart(2)} · sem fonte local: ${faltam.length ? faltam.join(', ') : 'nenhuma'}`);
}
