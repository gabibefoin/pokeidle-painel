/** Variantes Orre (13xxx) herdam looktype da espécie nacional — espelho antigo ficava desatualizado. */
export function herdarLooktypeOrre(lista) {
  const porId = new Map(lista.map((c) => [c.pokeId, c]));
  for (const esp of lista) {
    if (esp.pokeId < 13000 || esp.pokeId >= 14000) continue;
    const base = porId.get(esp.pokeId - 13000);
    if (base?.looktype > 1) esp.looktype = base.looktype;
  }
}
