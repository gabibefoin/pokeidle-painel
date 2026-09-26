/** Quantos níveis acima do treinador um pokémon ainda pode entrar em campo. */
export const FOLGA_NIVEL_POKEMON = 5;

/** Nível mínimo do treinador para usar um pokémon de `nvPokemon` (starter ignora). */
export function nivelMinimoTreinador(nvPokemon) {
  return Math.max(1, Math.floor(Number(nvPokemon) || 1) - FOLGA_NIVEL_POKEMON);
}

/** Treinador pode usar o pokémon? Starter sempre; demais até `nvTreinador + folga`. */
export function podeUsarPokemon(nvTreinador, pk) {
  if (!pk) return false;
  if (pk.starter) return true;
  return (pk.level ?? 0) <= (nvTreinador ?? 0) + FOLGA_NIVEL_POKEMON;
}
