/** "fire feather" → "Fire Feather"; nomes que já têm maiúscula ficam como estão. */
export function tituloInglesItem(nome) {
  if (!nome || nome !== nome.toLowerCase()) return nome;
  return nome.replace(/(?:^|[\s-])\w/g, (c) => c.toUpperCase());
}
