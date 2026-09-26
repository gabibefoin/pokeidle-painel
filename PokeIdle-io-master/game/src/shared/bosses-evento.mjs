/**
 * Bosses de EVENTO — os lendários e míticos que a Pokédex já anuncia como boss, mas que ainda
 * não têm arena.
 *
 * Eles não aparecem em hunt nenhuma (confira: nenhum dos dex abaixo está num spawn jogável),
 * e mesmo assim a ficha deles mostrava tabela de captura, chance por pokébola, drops, shiny e
 * "onde encontrar" — números corretos para uma jogada que o jogo não permite fazer. Era a
 * pior espécie de mentira da Pokédex: a que dá um alvo e um plano para algo inalcançável.
 *
 * A saída é dizer a verdade: são bosses, vão chegar em eventos específicos, e até lá a ficha
 * não promete captura nem loot. Quando um deles ganhar arena de verdade, ele entra em
 * `bosses.mjs` (via {@link lendariosComSprite}) e sai daqui — o catálogo de boss real tem
 * precedência na ficha, então o dia da virada é só apagar a linha desta lista.
 *
 * @see game/src/server/game/bosses.mjs — os bosses que JÁ têm arena
 */

/** Dex dos bosses ainda-por-vir. Kanto e Johto inteiras; Hoenn+ só quem não virou arena. */
export const BOSS_EVENTO_DEX = new Set([
  // 1ª Kanto — aves lendárias, Mewtwo e Mew
  144, 145, 146, 150, 151,
  // 2ª Johto — feras, torres e Celebi
  243, 244, 245, 249, 250, 251,
  // 3ª Hoenn — o mítico que sobrou fora das arenas
  385,
  // 4ª Sinnoh — os míticos do mar e o do pesadelo
  489, 490, 491,
  // 5ª Unova — os míticos. O #648 fica de reserva: `meloetta_aria` está em `SLUGS_OMITIDOS`,
  // então hoje não existe espécie nem entrada de Pokédex para ele — no dia em que existir,
  // ela já nasce com o selo certo.
  494, 648, 649,
]);

/**
 * É um boss de evento?
 *
 * Recebe o número de DEX (não o pokeId): o clone de Orre do Jirachi é o pokeId 13385 e o
 * mesmo #385, e os dois têm de responder igual.
 */
export function ehBossEventoDex(dex) {
  return BOSS_EVENTO_DEX.has(Number(dex));
}
