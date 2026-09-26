// Slugs legados do espelho → nome canônico em items.json.
//
// O espelho às vezes traz o mesmo item duas vezes: um id “bonito” (Band Aid, id 5) e um slug
// minúsculo com hífen (band-aid, id 59248). O loot de algumas espécies ainda aponta pro slug.

/** Nome no loot ou slug → nome canônico do catálogo. */
export const ALIAS_NOME_ITEM = new Map([
  ['band-aid', 'Band Aid'],
  // Drop da linha Togepi no espelho — distinto das Shiny Stones de evolução (Fire Shiny Stone…).
  ['shiny stone', 'Crystal Stone'],
]);

/** Ids duplicados do espelho — o catálogo usa o canônico, estes somem no boot. */
export const IDS_ITEM_DUPLICADO = new Set([59248]);

export function resolverNomeItem(nome) {
  return ALIAS_NOME_ITEM.get(String(nome).toLowerCase()) ?? nome;
}
