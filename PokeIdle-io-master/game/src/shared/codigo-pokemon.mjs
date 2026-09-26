/** Código público de um pokémon individual — o id da linha em `player_pokemon`. */
export function codigoPokemon(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `#${n}`;
}

/** Nome com código na frente — `#4821 Charmander`. Sem id, devolve só o nome. */
export function rotuloPokemon(nome, id) {
  const cod = codigoPokemon(id);
  const n = String(nome ?? '—');
  return cod ? `${cod} ${n}` : n;
}
