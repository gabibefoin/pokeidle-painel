/**
 * Escreve o corpo da tabela `NIVEIS_POR_ONDE_O_ALVO_APARECE` em stdout.
 *
 * Dois recortes, a MESMA regra (`evolveLevel` = nível da hunt mais baixa do alvo):
 *
 *   1. Alvo em Sinnoh–Alola (dex 387–809) — a varredura das quatro regiões novas.
 *   2. Bebês: base de geração POSTERIOR à do alvo. Mime Jr. é de Sinnoh e o Mr. Mime é de
 *      Kanto, então a hunt do bebê (1.000) fica MUITO acima da hunt do alvo (80). O número
 *      certo continua sendo o do alvo: 80. Na prática o bebê já nasce acima do degrau e a
 *      evolução é livre — que é o comportamento certo, e o que o `evolveLevel: 40` herdado do
 *      espelho já fazia por acidente. O que muda é a ficha parar de anunciar um número que não
 *      corresponde a hunt nenhuma.
 *
 *   node game/tools/gerar-tabela-niveis.mjs
 */
import { especies, huntsJogaveis } from '../src/server/content.mjs';
import { dexDe } from '../src/shared/escala-hunt-level.mjs';
import { isOutlandPokeId } from '../src/shared/outland.mjs';
import { EVOLUCOES_RAMIFICADAS } from '../src/shared/evolucoes-ramificadas.mjs';

const DEX_MIN = 387, DEX_MAX = 809;

/** Faixas de geração, para o recorte dos bebês. */
const GERACOES = [
  [1, 151, 1], [152, 251, 2], [252, 386, 3], [387, 493, 4], [494, 649, 5],
  [650, 721, 6], [722, 809, 7], [810, 905, 8], [906, 1025, 9],
];
const geracao = (dex) => GERACOES.find(([a, b]) => dex >= a && dex <= b)?.[2] ?? null;
/** Elos cujo alvo NÃO mora em Sinnoh–Alola e que a tabela já carregava — ficam como estão. */
const PRESERVAR = { 113: 1_125, 137: 1_125, 349: 1_125, 375: 1_250, 803: 7_500 };

const nivelPorDex = new Map();
for (const h of huntsJogaveis) for (const e of h.especies ?? []) {
  if (isOutlandPokeId(e.pokeId)) continue;
  const d = dexDe(e.pokeId);
  nivelPorDex.set(d, Math.min(nivelPorDex.get(d) ?? Infinity, h.nivel));
}

const reg = (d) => (d <= 493 ? 'Sinnoh' : d <= 649 ? 'Unova' : d <= 721 ? 'Kalos' : 'Alola');
const entradas = [];
for (const [id, nivel] of Object.entries(PRESERVAR)) {
  const c = especies.get(Number(id));
  entradas.push({ id: Number(id), nivel, nome: c?.name ?? '?', alvo: especies.get(c?.evolvesToId)?.name ?? '?', grupo: 'z-preservado', atual: c?.evolveLevel });
}
for (const c of especies.values()) {
  if (isOutlandPokeId(c.pokeId) || !c.evolvesToId || c.evolvesToId <= 0) continue;
  if (EVOLUCOES_RAMIFICADAS[c.pokeId]) continue;
  const alvoDex = dexDe(c.evolvesToId);
  const baseDex = dexDe(c.pokeId);
  const naFaixa = alvoDex >= DEX_MIN && alvoDex <= DEX_MAX;
  const ehBebe = (geracao(baseDex) ?? 0) > (geracao(alvoDex) ?? 0);
  if (!naFaixa && !ehBebe) continue;
  const nivel = nivelPorDex.get(alvoDex);
  if (!nivel) continue;
  entradas.push({
    id: c.pokeId, nivel, nome: c.name, alvo: especies.get(c.evolvesToId)?.name ?? '?',
    grupo: naFaixa ? reg(alvoDex) : 'y-bebe', atual: c.evolveLevel, alvoDex,
  });
}

const ORDEM = ['Sinnoh', 'Unova', 'Kalos', 'Alola', 'y-bebe', 'z-preservado'];
const TITULO = {
  Sinnoh: 'Alvo em SINNOH (dex 387–493)',
  Unova: 'Alvo em UNOVA (dex 494–649)',
  Kalos: 'Alvo em KALOS (dex 650–721)',
  Alola: 'Alvo em ALOLA (dex 722–809)',
  'y-bebe': 'BEBÊS — base de geração posterior ao alvo, então a hunt dele fica abaixo da do bebê',
  'z-preservado': 'Alvo FORA de Sinnoh–Alola — os cinco que a tabela já trazia, intactos',
};
const mil = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '_');
const linhas = [];
for (const g of ORDEM) {
  const doGrupo = entradas.filter((e) => e.grupo === g).sort((a, b) => a.id - b.id);
  if (!doGrupo.length) continue;
  const wId = Math.max(...doGrupo.map((e) => String(e.id).length));
  const wNv = Math.max(...doGrupo.map((e) => mil(e.nivel).length));
  const wNome = Math.max(...doGrupo.map((e) => e.nome.length));
  linhas.push(`  // --- ${TITULO[g]}`);
  for (const e of doGrupo) {
    const nota = e.atual === e.nivel ? '' : `  (era ${e.atual || '—'})`;
    linhas.push(`  ${String(e.id).padStart(wId)}: ${mil(e.nivel).padStart(wNv)}, // ${e.nome.padEnd(wNome)} → ${e.alvo}${nota}`);
  }
}
console.log(linhas.join('\n'));
console.error(`entradas: ${entradas.length}`);
