/**
 * A curva de cooldown dos golpes — poder do golpe ⇒ segundos de recarga.
 *
 * Antes disso o cooldown era herdado do espelho, golpe a golpe, e não tinha relação nenhuma
 * com o dano: dava para achar um golpe de 12 de poder recarregando em 60s ao lado de um de
 * 300 recarregando em 10s. A planilha "Novos Cooldowns PokeIdle" trocou isso por DUAS retas, e
 * a "Buff Cooldowns" baixou as duas; é esta última que as funções reproduzem (as 43 linhas
 * batem no décimo):
 *
 *   poder  15 →  10,0s ┐ primeira reta: cada ponto de poder custa 20/85 s
 *   poder 100 →  30,0s ┘ (é o trecho onde vive quase todo o catálogo)
 *   poder 100 →  30,0s ┐ segunda reta, bem mais rasa: 30/500 s por ponto
 *   poder 600 →  60,0s ┘ (senão o golpe de assinatura recarregaria em 3 minutos)
 *
 * O buff manteve as duas pontas que já eram boas — poder 15 em 10s e a inclinação acima de
 * 100 — e desceu o joelho de 40s para 30s, o que puxa tudo de 16 a 600 junto.
 *
 * O joelho em 100 é de propósito: até ali o cooldown paga o dano quase na proporção, e daí
 * para cima o golpe caro fica progressivamente mais barato — é o que mantém o ultimate de
 * 600 valendo a pena em vez de virar enfeite.
 */

/**
 * Piso de poder do catálogo.
 *
 * Havia golpes com poder 0, 1, 9 — restos do gerador antigo, que na prática não faziam dano
 * nenhum e nas últimas evoluções eram até descartados por `limparGolpesQuebrados`. Todos
 * sobem para 15, o começo da curva.
 */
export const PODER_MINIMO = 15;

/** Onde uma reta vira a outra. */
const PODER_JOELHO = 100;

/** Cooldown do golpe de assinatura (poder 600) — a ponta da segunda reta. */
export const COOLDOWN_600_MS = 60_000;

/**
 * Cooldown do golpe de MEGA — o mesmo poder 600, na METADE do tempo.
 *
 * É a única coisa no catálogo que sai da curva de propósito, e é o que a mega ENTREGA: ela
 * não ganha um terceiro golpe só para ter mais uma linha na ficha, ganha o golpe que dispara
 * duas vezes no tempo em que os outros dois disparam uma. Quem pagou dez fragmentos de boss
 * está comprando ritmo, não variedade.
 *
 * Fora da curva, ele precisa de uma trava para não ser "consertado" de volta: o golpe carrega
 * `cdFixo: true` e `fixarCooldownGolpe600` pula quem tem essa marca. Ver `shared/megas.mjs`.
 */
export const COOLDOWN_MEGA_MS = 30_000;

/** O poder que a curva enxerga: nunca abaixo do piso. */
export function poderNormalizado(power) {
  const p = Number(power);
  return Number.isFinite(p) && p > PODER_MINIMO ? p : PODER_MINIMO;
}

/**
 * Cooldown em ms para um golpe daquele poder, arredondado ao décimo de segundo — a mesma
 * precisão da planilha, para a ficha do golpe ("15,9s") não mentir sobre o valor real.
 */
export function cooldownDoPoder(power) {
  const p = poderNormalizado(power);
  const seg = p <= PODER_JOELHO
    ? 10 + ((p - PODER_MINIMO) * 20) / (PODER_JOELHO - PODER_MINIMO)
    : 30 + ((p - PODER_JOELHO) * 30) / (600 - PODER_JOELHO);
  return Math.round(seg * 10) * 100;
}

/**
 * Põe um golpe na curva: sobe o poder até o piso e recalcula o cooldown.
 * Devolve true se mexeu — os scripts de catálogo usam isso para contar o que mudou.
 */
export function aplicarCurvaNoGolpe(a) {
  if (!a) return false;
  const poder = poderNormalizado(a.power);
  const cd = cooldownDoPoder(poder);
  if (a.power === poder && a.cooldownMs === cd) return false;
  a.power = poder;
  a.cooldownMs = cd;
  return true;
}
