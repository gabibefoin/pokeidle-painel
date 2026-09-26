/**
 * Ajustes NOSSOS de preço por cima do espelho de `public/data/items.json`.
 *
 * ### Por que aqui, e não editando o items.json
 *
 * A mesma razão de `game/itens-nossos.mjs` e do `AJUSTE_HUNT_LEVEL`: `public/data/` é espelho
 * regenerável e está no `.gitignore`. Um preço corrigido lá funciona na máquina de quem
 * editou e some no primeiro `npm run fetch` — inclusive em produção, onde o espelho é baixado
 * do zero, e sem deixar rastro de que o ajuste existia.
 *
 * ### Por que em `shared/`
 *
 * O catálogo tem DUAS entradas e as duas leem o espelho: o servidor mescla em `content.mjs`
 * (é ele quem cobra) e o cliente baixa `/assets/items.json` direto no carregamento (é ele quem
 * escreve o preço no card do Market). Um ajuste em só um dos lados vira card mentindo sobre o
 * que o servidor vai cobrar, então os dois passam por esta mesma função.
 */

/** Max Revive — id do espelho. */
export const MAX_REVIVE_ID = 206;

/**
 * itemId do espelho → `npcPrice` que vale de verdade.
 *
 * O Max Revive devolve 100% do HP: é o efeito mais forte do jogo e o único que apaga por
 * inteiro o custo de ter caído. A 2.500 ele era só o dobro do Revive comum (que devolve
 * metade), e por isso não havia razão para comprar o comum. A 5.000 a escolha volta a existir.
 */
export const AJUSTE_NPC_PRICE = new Map([
  [MAX_REVIVE_ID, 5000],
]);

/** O item com o preço ajustado — o MESMO objeto quando não há ajuste para ele. */
export function ajustarPrecoEspelho(item) {
  const preco = AJUSTE_NPC_PRICE.get(item?.id);
  return preco == null || item.npcPrice === preco ? item : { ...item, npcPrice: preco };
}
