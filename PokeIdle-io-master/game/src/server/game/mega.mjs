/**
 * MEGA EVOLUÇÃO — o fragmento que cai no boss, a bancada que o transforma em pedra e a troca.
 *
 * ### O caminho inteiro, em uma linha
 *
 * boss → **Fragmento de Mega Stone** → 10 deles no Professor Carvalho viram a **Mega Stone** da
 * espécie que o jogador escolher → a pedra megaevolui UM pokémon daquela espécie, para sempre.
 *
 * E, em paralelo, a mesma escada em shiny: **Fragmento de Mega Shiny Stone** (metade da chance
 * no boss) → **Shiny Mega Stone** → megaevolui um pokémon SHINY.
 *
 * ### Por que fragmento genérico + escolha, e não a pedra caindo pronta
 *
 * É o desenho que o TM Researcher já tinha e que a Shiny Stone copiou, pela mesma razão: são 32
 * megas. Se a pedra caísse pronta, o jogador que farmou 200 bosses teria 2 Cameruptites e
 * nenhuma Gengarite, e a sorte decidiria qual bicho ele pode megaevoluir. Com o fragmento
 * genérico, a sorte decide QUANDO e o jogador decide O QUE — que é o que transforma o farm de
 * boss num plano em vez de uma roleta.
 *
 * ### Por que as duas famílias, comum e shiny
 *
 * Pela mesma razão que existe uma Shiny Stone ao lado da pedra de evolução comum (ver
 * `shiny-stone.mjs`): a arte da mega SHINY é outro sprite, e quem tem um shiny não pode
 * megaevoluí-lo com a pedra comum e descobrir que perdeu a cor. A pedra comum recusa shiny e a
 * shiny recusa comum — as duas travas são explícitas em `megaEvoluir`.
 *
 * ### A mega é PERMANENTE e TRANCA o pokémon
 *
 * Nos jogos oficiais a mega dura uma batalha. Aqui ela é uma troca de espécie como a evolução —
 * `pk.speciesId` vira o #3xxx — e por dois motivos: o PokéIdle é idle, ninguém aperta um botão
 * no começo de cada luta; e o custo (10 fragmentos de boss) é de coisa permanente, não de
 * consumível. Em troca, megaevoluir TRANCA o pokémon na venda, como o refino faz: um bicho com
 * 10 fragmentos de boss dentro não some num clique de "vender o depot inteiro".
 */

import { megaDaEspecie, megaPokeId, megaTemShiny, MEGA_POR_DEX } from '../../shared/megas.mjs';
import {
  chanceFragmentoMegaDoPar,
  chanceFragmentoMegaShinyDoPar,
} from '../../shared/bosses-lendarios.mjs';
import {
  FRAGMENTO_MEGA_ID,
  FRAGMENTO_MEGA_SHINY_ID,
  MEGA_STONE_POR_DEX,
  MEGA_SHINY_STONE_POR_DEX,
  MEGA_POR_ITEM,
  CUSTO_FRAGMENTOS_MEGA,
  CUSTO_FRAGMENTOS_MEGA_SHINY,
} from './itens-nossos.mjs';

export {
  FRAGMENTO_MEGA_ID,
  FRAGMENTO_MEGA_SHINY_ID,
  MEGA_STONE_POR_DEX,
  MEGA_SHINY_STONE_POR_DEX,
  MEGA_POR_ITEM,
};

export const NOME_FRAGMENTO_MEGA = 'Mega Stone Fragment';
export const NOME_FRAGMENTO_MEGA_SHINY = 'Mega Shiny Stone Fragment';

/** As duas linhas de drop que todo boss ganha, no formato de `BOSSES[].drops`. */
export function dropsMegaDoPar(par) {
  return [
    {
      itemId: FRAGMENTO_MEGA_ID,
      nome: NOME_FRAGMENTO_MEGA,
      chance: chanceFragmentoMegaDoPar(par),
    },
    {
      itemId: FRAGMENTO_MEGA_SHINY_ID,
      nome: NOME_FRAGMENTO_MEGA_SHINY,
      chance: chanceFragmentoMegaShinyDoPar(par),
    },
  ];
}

/** A pedra que megaevolui esta espécie, ou `null`. `shiny` escolhe entre as duas famílias. */
export function megaStoneDeEvolucao(pokeId, shiny = false) {
  const meta = megaDaEspecie(pokeId);
  if (!meta) return null;
  if (shiny && !megaTemShiny(meta)) return null;
  const itemId = shiny ? MEGA_SHINY_STONE_POR_DEX[meta.dex] : MEGA_STONE_POR_DEX[meta.dex];
  if (!itemId) return null;
  return {
    itemId,
    dex: meta.dex,
    shiny,
    nome: shiny ? `Shiny ${meta.pedra}` : meta.pedra,
    megaPokeId: megaPokeId(meta.dex),
    megaNome: meta.nome,
  };
}

/**
 * Gasta 10 fragmentos e devolve `{ itemId, dex, shiny }` da pedra fabricada.
 *
 * `{ erro }` quando não dá — dex fora da lista, mega sem forma shiny ou fragmentos de menos.
 * Quem chama credita o item; aqui só se cobra e se resolve qual pedra é, para o handler do sim
 * ficar com uma leitura só (o mesmo contrato de `fabricarShinyStone`).
 */
export function fabricarMegaStone(p, dex, shiny = false) {
  const d = Number(dex);
  const meta = MEGA_POR_DEX.get(d);
  if (!meta) return { erro: 'essa espécie não tem mega' };
  if (shiny && !megaTemShiny(meta)) {
    return { erro: `${meta.nome} ainda não tem forma shiny` };
  }

  const fragId = shiny ? FRAGMENTO_MEGA_SHINY_ID : FRAGMENTO_MEGA_ID;
  const custo = shiny ? CUSTO_FRAGMENTOS_MEGA_SHINY : CUSTO_FRAGMENTOS_MEGA;
  const nomeFrag = shiny ? NOME_FRAGMENTO_MEGA_SHINY : NOME_FRAGMENTO_MEGA;

  const tem = Number(p.items?.[fragId] ?? 0);
  if (tem < custo) return { erro: `precisa de ${custo}× ${nomeFrag} (você tem ${tem})` };

  p.items[fragId] = tem - custo;
  if (!p.items[fragId]) delete p.items[fragId];

  const itemId = shiny ? MEGA_SHINY_STONE_POR_DEX[d] : MEGA_STONE_POR_DEX[d];
  p.items[itemId] = (p.items[itemId] ?? 0) + 1;
  return { itemId, dex: d, shiny, nome: shiny ? `Shiny ${meta.pedra}` : meta.pedra };
}

/**
 * Config que vai no welcome, para a tela montar a bancada sem adivinhar id nenhum.
 *
 * `chanceBase` é a do PRIMEIRO par de bosses (nv 300). A tela multiplica pelo par escolhido,
 * como já faz com a peça de TM — mandar as 40 linhas da escada seria repetir no welcome o que
 * o modal de Bosses já desenha.
 */
export function configMega() {
  return {
    fragmentoId: FRAGMENTO_MEGA_ID,
    fragmentoShinyId: FRAGMENTO_MEGA_SHINY_ID,
    custo: CUSTO_FRAGMENTOS_MEGA,
    custoShiny: CUSTO_FRAGMENTOS_MEGA_SHINY,
    chanceBase: chanceFragmentoMegaDoPar(0),
    chanceBaseShiny: chanceFragmentoMegaShinyDoPar(0),
    pedras: [...MEGA_POR_DEX.values()].map((m) => ({
      dex: m.dex,
      nome: m.nome,
      pedra: m.pedra,
      megaPokeId: megaPokeId(m.dex),
      itemId: MEGA_STONE_POR_DEX[m.dex],
      itemShinyId: MEGA_SHINY_STONE_POR_DEX[m.dex] ?? null,
    })),
  };
}
