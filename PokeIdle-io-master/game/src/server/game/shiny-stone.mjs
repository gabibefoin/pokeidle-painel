/**
 * SHINY STONES — o caminho de evolução que só existe para shiny.
 *
 * ### O buraco que isto fecha
 *
 * Até aqui, `pokemon.evoluir` recusava shiny de saída ("shiny não evolui"). Não era desprezo
 * pelo shiny: era que a arte da EVOLUÇÃO shiny podia não existir, e evoluir um Abra shiny num
 * Kadabra de cor comum destruiria o item mais raro que o jogador tem. Com `looktypeShiny`
 * cobrindo o catálogo, a evolução passou a ser possível — e passou a precisar de um custo à
 * altura, senão o shiny nível 100 é só um pokémon comum com stats dobrados.
 *
 * ### O custo é uma pedra do TIPO PRIMÁRIO
 *
 * Shiny Abra (PSYCHIC) pede uma Psychic Shiny Stone. Shiny Bulbasaur é GRASS/POISON e pede a
 * de GRASS — o primário, sempre, exatamente como a evolução comum já faz com as pedras
 * normais (ver `pedraDeEvolucao` em `content.mjs`). Uma pedra por tipo, dezoito ao todo.
 *
 * ### E a pedra vem de fragmento, não de drop direto
 *
 * O Fragmento de Shiny Stone cai a 0,0005% na Outland — dez vezes mais raro que o Fragmento
 * de Chave — e dez deles viram UMA pedra, do tipo que o jogador escolher no Professor
 * Carvalho. É o mesmo desenho das peças do TM Researcher, e pela mesma razão: transformar
 * sorte bruta em escolha. Quem farmou dez fragmentos decide qual dos seus shinys evolui, em
 * vez de torcer para cair a pedra do tipo certo.
 *
 * Tanto a pedra pronta quanto o fragmento são negociáveis no Mercado da Comunidade.
 */

import {
  FRAGMENTO_SHINY_ID,
  SHINY_STONE_POR_TIPO,
  TIPO_POR_SHINY_STONE,
  TIPOS_POKEMON,
  CUSTO_FRAGMENTOS_SHINY_STONE,
} from './itens-nossos.mjs';
import { tipoDaPedraDeEvolucao } from '../../shared/evolucoes-ramificadas.mjs';

/** Chance por selvagem derrotado na Outland. 0,0005% — ~200 mil kills por fragmento. */
export const CHANCE_FRAGMENTO_SHINY = 0.000005;

/**
 * Sorteia o drop do Fragmento de Shiny Stone. Só na Outland, como o resto.
 *
 * `mult` é o degrau da Outland — a escada mora em `shared/outland-tiers.mjs`.
 */
export function rolarFragmentoShiny(bonusPct = 0, area = null, mult = 1) {
  if (area !== 'outland') return null;
  if (Math.random() >= CHANCE_FRAGMENTO_SHINY * (1 + bonusPct / 100) * mult) return null;
  return { itemId: FRAGMENTO_SHINY_ID, nome: 'Shiny Stone Fragment', qtd: 1 };
}

/**
 * A pedra que um shiny desta espécie precisa. `null` quando a espécie não evolui.
 *
 * O tipo é o PRIMÁRIO — é a mesma regra da evolução comum, e mantê-la igual evita que o
 * jogador tenha de aprender duas. Inclusive na parte nova: numa cadeia que abre, o primário é o
 * do DESTINO, então um Eevee shiny pede a Water Shiny Stone para virar Vaporeon e a Fire Shiny
 * Stone para virar Flareon.
 */
export function shinyStoneDeEvolucao(especie, destino = null) {
  if (!especie?.evolvesToId) return null;
  const tipo = tipoDaPedraDeEvolucao(especie, destino);
  const itemId = SHINY_STONE_POR_TIPO[tipo];
  if (!itemId) return null;
  return { itemId, tipo, nome: `${tipo.charAt(0)}${tipo.slice(1).toLowerCase()} Shiny Stone` };
}

/**
 * Gasta 10 fragmentos e devolve `{ itemId, tipo }` da pedra fabricada.
 *
 * `{ erro }` quando não dá — tipo inválido ou fragmentos de menos. Quem chama credita o item;
 * aqui só se cobra e se resolve qual pedra é, para o handler do sim ficar com uma leitura só.
 */
export function fabricarShinyStone(p, tipo) {
  const t = String(tipo ?? '').toUpperCase();
  if (!TIPOS_POKEMON.includes(t)) return { erro: 'tipo inválido' };

  const tem = Number(p.items?.[FRAGMENTO_SHINY_ID] ?? 0);
  if (tem < CUSTO_FRAGMENTOS_SHINY_STONE) {
    return { erro: `precisa de ${CUSTO_FRAGMENTOS_SHINY_STONE}× Shiny Stone Fragment (você tem ${tem})` };
  }

  p.items[FRAGMENTO_SHINY_ID] = tem - CUSTO_FRAGMENTOS_SHINY_STONE;
  if (!p.items[FRAGMENTO_SHINY_ID]) delete p.items[FRAGMENTO_SHINY_ID];

  const itemId = SHINY_STONE_POR_TIPO[t];
  p.items[itemId] = (p.items[itemId] ?? 0) + 1;
  return { itemId, tipo: t };
}

/** Config que vai no welcome, para a tela montar a aba sem adivinhar id nenhum. */
export function configShinyStone() {
  return {
    fragmentoId: FRAGMENTO_SHINY_ID,
    custo: CUSTO_FRAGMENTOS_SHINY_STONE,
    chanceDrop: CHANCE_FRAGMENTO_SHINY,
    pedras: TIPOS_POKEMON.map((t) => ({ tipo: t, itemId: SHINY_STONE_POR_TIPO[t] })),
  };
}

export { TIPO_POR_SHINY_STONE };
