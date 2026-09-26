/**
 * REDUZIR O NÍVEL — a saída de quem empurrou XP no pokémon e passou do próprio treinador.
 *
 * O jogo só deixa levar a campo um pokémon até `FOLGA_NIVEL_POKEMON` níveis acima do treinador
 * (`shared/pokemon-nivel-treinador.mjs`). Quem gasta o boost de XP no BICHO em vez de na conta
 * chega ao ponto em que o melhor pokémon da coleção fica inutilizável, e a única saída era
 * subir milhões de XP de treinador com um pokémon nível 1. A folga de 5 níveis não resolvia:
 * ela dá margem para o desencontro pequeno, não para um que já nasceu grande.
 *
 * A ficha abre uma caixa com um CAMPO: o jogador digita o nível em que quer deixar o pokémon e
 * ele cai direto para lá. Antes era um nível por clique, com confirmação a cada um — e quem
 * comprou no Mercado um Venusaur nv 499 com o treinador no 188 teria de confirmar trezentas
 * vezes. O campo já nasce com o maior nível que cabe no treinador (`nivelSugeridoReducao`).
 *
 * O piso é o **"Nível ao capturar"** da espécie — a mesma linha que a ficha dela já mostra. É o
 * piso natural: abaixo dele aquele pokémon nem sairia de uma pokébola.
 *
 * O piso é o nível ao capturar, e NÃO o degrau da hunt, porque de Outland para cima os dois
 * deixam de ser o mesmo número: o teto de captura (`shared/teto-captura.mjs`) corta em 20/40/100
 * o que sai da bola, e um Tropius de hunt 600 entra na equipe no nível 100. Usar o degrau da
 * hunt daria a ele um piso de 600 — um piso acima de qualquer Tropius que exista, o que é o
 * mesmo que não ter botão. Em Kanto e Johto os dois números coincidem (o teto só morde acima
 * de 100), e é por isso que o Charizard continua parando no 80.
 *
 * ### O número vem do cliente — e o servidor não confia nele
 *
 * A mensagem `pokemon.reduzirNivel` leva `{ pokemonId, nivelAlvo }`, e `nivelAlvo` é justamente
 * o campo que um cliente adulterado vai trocar: `-40`, `999999`, `"500"`, `1e400`, `150.5`. A
 * regra inteira é `validarNivelAlvo`, e o SERVIDOR a roda com os números DELE:
 *
 *   · `nivelAlvo` tem de ser `number` de verdade e inteiro seguro. String, array, `null`,
 *     booleano, fração, `Infinity` — RECUSADOS, nunca convertidos com `Number()`;
 *   · tem de estar em `[piso, nível de agora − 1]`, com o nível de agora e o piso tirados do
 *     servidor (`pk.level`, `pisoDeReducaoDaEspecie`), nunca da mensagem;
 *   · fora da faixa é RECUSADO, e não arrastado para a borda: um `-40` não vira "baixa até o
 *     piso", vira aviso e nada muda. Arredondar esconderia o pedido adulterado atrás de uma
 *     operação que parece legítima;
 *   · e o resultado ainda passa por um `Math.min(atual − 1, …)` — se a checagem de cima um
 *     dia for mexida errado, o nível novo continua sem conseguir passar do de agora.
 *
 * A mensagem só consegue ESCOLHER um nível dentro de uma faixa que o servidor calculou, e a
 * faixa inteira fica abaixo do nível atual. Não existe valor que faça o pokémon subir.
 *
 * Sem `nivelAlvo` (uma aba aberta antes do campo existir), cai `PASSO_REDUCAO_NIVEL` — o botão
 * de antes. Ver o handler em `server/sim.mjs`.
 */

import { nivelDeCaptura, TETO_CAPTURA_MAX } from './teto-captura.mjs';
import { FOLGA_NIVEL_POKEMON } from './pokemon-nivel-treinador.mjs';

/** Quantos níveis caem quando a mensagem NÃO traz `nivelAlvo` — a aba de antes do campo. */
export const PASSO_REDUCAO_NIVEL = 1;

/**
 * O piso da espécie: o "Nível ao capturar" dela, nunca menor que 1.
 *
 * `nivelHunt` é o degrau em que ela aparece no mapa — o MENOR entre as hunts que a têm, que é
 * o mesmo número que a ficha da espécie usa. Quem não o tiver em mão passa `null` e cai no
 * `huntLevel` do catálogo, que é a mesma coisa em todas as espécies menos dezoito.
 */
export function pisoReducaoNivel(esp, nivelHunt = null) {
  const ref = Math.floor(Number(nivelHunt ?? esp?.huntLevel) || 0);
  const teto = Math.floor(Number(esp?.tetoCaptura) || TETO_CAPTURA_MAX);
  return Math.max(1, nivelDeCaptura(Math.max(1, ref), teto));
}

const nivelSaneado = (n) => Math.max(1, Math.floor(Number(n) || 1));

/**
 * Os níveis que dá para escolher: do piso até UM abaixo do nível de agora.
 *
 * `null` quando não há o que reduzir — no piso, ou ABAIXO dele (um Charmander nv 5, cujo nível
 * ao capturar é 20): ali "descer até o piso" seria subir, e a faixa simplesmente não existe.
 * `nivel` e `piso` aqui são sempre os do servidor; do cliente só vem o alvo.
 */
export function faixaReducaoNivel(nivel, piso) {
  const atual = nivelSaneado(nivel);
  const chao = nivelSaneado(piso);
  if (atual <= chao) return null;
  return { min: chao, max: atual - 1 };
}

/** Dá para reduzir? Só quando o nível de agora está acima do piso. */
export function podeReduzirNivel(nivel, piso) {
  return faixaReducaoNivel(nivel, piso) !== null;
}

/**
 * O nível com que o campo já nasce: o MAIOR que o treinador consegue levar a campo
 * (treinador + folga), preso à faixa. É a resposta de quase todo mundo que abre a caixa — o
 * pokémon volta a ser usável perdendo o mínimo de XP possível.
 */
export function nivelSugeridoReducao(nivel, piso, nvTreinador) {
  const faixa = faixaReducaoNivel(nivel, piso);
  if (!faixa) return null;
  const cabe = Math.floor(Number(nvTreinador) || 0) + FOLGA_NIVEL_POKEMON;
  return Math.min(faixa.max, Math.max(faixa.min, cabe));
}

/**
 * O PORTEIRO do nível pedido. O servidor roda esta função antes de mexer em qualquer coisa, e
 * a caixa da ficha roda a mesma para travar o botão — mas quem decide é o servidor.
 *
 * Devolve `{ ok: true, novo }` ou `{ ok: false, motivo, min?, max? }`:
 *   · `noPiso`      — não há faixa (já no piso ou abaixo dele);
 *   · `invalido`    — `alvo` não é um `number` inteiro seguro;
 *   · `foraDaFaixa` — é inteiro, mas não está em `[min, max]`.
 */
export function validarNivelAlvo(nivel, piso, alvo) {
  const faixa = faixaReducaoNivel(nivel, piso);
  if (!faixa) return { ok: false, motivo: 'noPiso' };
  // `typeof` primeiro, e sem `Number()`: `Number("500")`, `Number([500])` e `Number(true)`
  // viram número, e um porteiro que converte antes de olhar deixa todos eles entrarem.
  if (typeof alvo !== 'number' || !Number.isSafeInteger(alvo)) {
    return { ok: false, motivo: 'invalido', ...faixa };
  }
  if (alvo < faixa.min || alvo > faixa.max) return { ok: false, motivo: 'foraDaFaixa', ...faixa };
  // Redundante com a linha de cima — de propósito. É a última trava: o nível novo não passa de
  // `atual − 1` nem desce do piso, qualquer que seja a conta que chegou até aqui.
  return { ok: true, novo: Math.min(faixa.max, Math.max(faixa.min, alvo)) };
}
