/**
 * O VALOR DA ESPÉCIE — onde ela aparece e em que ponto da cadeia evolutiva ela está.
 *
 * O valor não é só o preço de venda ao NPC: é também a régua de RARIDADE da captura
 * (`precoDeRaridade` no sim, `chanceDeCaptura` no cliente). Duas passagens, nesta ordem, por cima
 * do que `normalizarSellValue` assentou:
 *
 *   1. `elevarAoNivelDaHunt` — espécie com valor de Kanto (nível ≤ 150) que só aparece em hunt
 *      acima disso passa a valer pelo menos a curva dessa hunt;
 *   2. `alinharValorDaCadeia` — quem ainda vai evoluir vale menos que a evolução.
 *
 * ### Por que a hunt vem primeiro
 *
 * O espelho trouxe Vespiquen, Lopunny, Lucario e Aegislash com o nível e o preço de Kanto (100,
 * 18.000), mas eles só aparecem nas hunts de Sinnoh e Kalos (2.000 a 16.000). As pré-evoluções
 * vieram do catálogo novo já na curva certa — Combee 37.456, Honedge 149.117 — e a cadeia parecia
 * invertida. Com a cadeia rodando sozinha (v1.90.2) quem descia era o pré-evolução: um Combee
 * nível 40 chegou a vender por 770, menos que um abate da própria hunt. O erro era o valor da
 * evolução, e é ele que sobe aqui.
 *
 * Vale a hunt MAIS BAIXA em que a espécie aparece (`nivelDeHuntDaEspecie`): quem também mora numa
 * hunt de Kanto fica com o valor de lá, senão bastava capturar barato e vender caro. E só SOBE —
 * quem já vale a curva da hunt ou mais não é tocado.
 *
 * ### A cadeia
 *
 * Só mexe em quem continua invertido — vale o MESMO ou mais que o próximo estágio — e põe o valor
 * dele na proporção típica do catálogo (`RAZAO_DO_DEGRAU`). Roda do fim da cadeia para o começo,
 * então um estágio do meio que desceu arrasta a base junto. O que sobra invertido depois da hunt:
 * preço do espelho em espécie de Kanto/Johto que ganhou evolução em outra geração (Misdreavus,
 * Electabuzz, Magmar, Dusclops), os clones `13xxx` de Hoenn em hunt 470–550 que evoluem para a
 * linha nacional (hunt 40–80) e bases em hunt acima da evolução (Budew, Azurill, Chingling).
 *
 * Mora em `shared/` porque as duas pontas precisam do mesmo número: o servidor cobra a captura e
 * paga a venda, a Pokédex e o Mercado mostram as duas. O servidor chama `assentarValorDasEspecies`
 * no boot, depois de montar as hunts; o cliente chama no fim de `carregarCatalogoEspecies` e de
 * novo quando as hunts chegam no `welcome`.
 */
import { NIVEL_ANCORA, ouroDoNivel, valorEconomicoDe } from './sell-value.mjs';
import { temArteJogavel } from './evolucoes-ramificadas.mjs';

/**
 * Quanto cada estágio vale em relação ao PRÓXIMO, por comprimento de cadeia. Índice = estágio
 * (0 = base).
 *
 * É a MEDIANA do catálogo: a razão pré-evolução ÷ evolução de todos os pares que já estavam em
 * ordem (177 em cadeia de 2; 92 bases e 102 meios em cadeia de 3), medida em 15/09/2026 com esta
 * passagem desligada. A primeira versão copiava uma família só — Exeggcute 200 → Exeggutor
 * 10.000, razão de 2% —, e o Exeggcute está entre os 5% mais extremos do jogo.
 */
export const RAZAO_DO_DEGRAU = {
  2: [0.517],
  3: [0.462, 0.444],
};

/** A razão de um estágio — cadeia mais longa que a tabela usa a de 3. */
export function razaoDoDegrau({ estagio, elos }) {
  const tabela = RAZAO_DO_DEGRAU[Math.min(Math.max(elos, 2), 3)];
  return tabela[Math.min(estagio, tabela.length - 1)];
}

/**
 * Sobe ao valor da hunt quem tem nível de Kanto no catálogo mas só aparece acima dele.
 *
 * @param lista        as espécies
 * @param nivelDeHunt  `pokeId → nível da hunt mais baixa em que a espécie aparece`, ou `null`
 * @returns quantas espécies subiram
 */
export function elevarAoNivelDaHunt(lista, nivelDeHunt) {
  let subiu = 0;
  for (const c of lista) {
    if ((c.huntLevel ?? 0) > NIVEL_ANCORA) continue;
    const nivel = nivelDeHunt(c.pokeId);
    if (nivel == null || nivel <= NIVEL_ANCORA) continue;
    const valor = ouroDoNivel(nivel);
    if (valorEconomicoDe(c) >= valor) continue;
    c.sellValue = valor;
    c.priceNpc = valor;
    subiu++;
  }
  return subiu;
}

/**
 * Rebaixa o valor de todo pré-evolução que vale o mesmo ou mais que a evolução dele.
 *
 * @param lista     as espécies (sem os fantasmas do espelho)
 * @param estagios  o mapa de `montarEstagiosEvolutivos` — o que `aplicarTetoDeCaptura` devolve
 * @returns quantas espécies mudaram de valor
 */
export function alinharValorDaCadeia(lista, estagios) {
  const especies = [...lista];
  const porId = new Map(especies.map((c) => [c.pokeId, c]));

  // Os clones `13xxx` de Hoenn apontam para a linha nacional e ninguém evolui PARA eles: pelo mapa,
  // o Grovyle clone é base de uma cadeia de 2 e levaria a razão errada, com outro valor que o
  // Grovyle nacional. Para o valor, vale o estágio da ESPÉCIE — o do mesmo nome com a cadeia mais longa.
  const porNome = new Map();
  for (const c of especies) {
    const info = estagios.get(c.pokeId);
    if (!info) continue;
    const atual = porNome.get(c.name);
    if (!atual || info.elos > atual.elos) porNome.set(c.name, info);
  }

  // Alvo sem sprite não conta: o jogo recusa a evolução (`temArteJogavel`), então a cadeia não
  // existe na partida. Sem esta trava o Gimmighoul descia na Pokédex e não no servidor — o
  // Gholdengo tem nível de hunt diferente nas duas pontas. Quando a sprite chegar, entra sozinho.
  const pre = especies
    .map((c) => ({ c, info: porNome.get(c.name), alvo: c.evolvesToId ? porId.get(c.evolvesToId) : null }))
    .filter((x) => x.info && x.alvo && temArteJogavel(x.alvo))
    .sort((a, b) => b.info.estagio - a.info.estagio);

  let mudou = 0;
  for (const { c, info, alvo } of pre) {
    const valorAlvo = valorEconomicoDe(alvo);
    if (valorEconomicoDe(c) < valorAlvo) continue;
    const valor = Math.max(1, Math.round(valorAlvo * razaoDoDegrau(info)));
    c.sellValue = valor;
    c.priceNpc = valor;
    mudou++;
  }
  return mudou;
}

/** O valor que `normalizarSellValue` deixou em cada espécie, guardado na primeira passada. */
const VALOR_DE_PARTIDA = new WeakMap();

/**
 * As duas passagens, e idempotente: cada chamada parte do valor que `normalizarSellValue` deixou,
 * não do resultado da chamada anterior. É o que deixa o cliente chamar de novo quando as hunts
 * chegam (e a cada reconexão) — sem isso o Combee rebaixado antes do `welcome` não voltaria
 * quando o Vespiquen subisse.
 *
 * @param lista        as espécies (sem os fantasmas do espelho)
 * @param estagios     o mapa de `montarEstagiosEvolutivos`
 * @param nivelDeHunt  `pokeId → nível` ou `null`; enquanto não há hunts, só a cadeia roda
 * @returns quantas espécies a cadeia rebaixou
 */
export function assentarValorDasEspecies(lista, estagios, nivelDeHunt = () => null) {
  const especies = [...lista];
  for (const c of especies) {
    const partida = VALOR_DE_PARTIDA.get(c);
    if (partida) {
      c.sellValue = partida.sellValue;
      c.priceNpc = partida.priceNpc;
    } else {
      VALOR_DE_PARTIDA.set(c, { sellValue: c.sellValue, priceNpc: c.priceNpc });
    }
  }
  elevarAoNivelDaHunt(especies, nivelDeHunt);
  return alinharValorDaCadeia(especies, estagios);
}
