import { isOutlandPokeId } from './outland.mjs';

/** Prefixos das variantes Outland — o resto do nome é a espécie base (Kanto/Johto). */
export const PREFIXOS_OUTLAND = [
  'Brave ',
  'Tribal ',
  'Ancient ',
  'War ',
  'Furious ',
  'Charged ',
  'Magnetic ',
  'Evil ',
  'Freezing ',
  'Psy ',
  'Heavy ',
  'Milch-',
  'Roll ',
  'Hard ',
  'Brute ',
  'Enraged ',
  'Dark ',
  'Trickmaster ',
  'Banshee ',
  'Taekwondo ',
  'Enigmatic ',
  'Magma ',
  'Toxic ',
];

/** Nome base → dex nacional. Quase todo doador é de Kanto/Johto; de #2051 em diante entram Sinnoh, Unova e Kalos. */
const DEX_POR_NOME = new Map([
  ['blastoise', 9],
  ['feraligatr', 160],
  ['meganium', 154],
  ['venusaur', 3],
  ['heracross', 214],
  ['scyther', 123],
  ['girafarig', 203],
  ['raichu', 26],
  ['ampharos', 181],
  ['electabuzz', 125],
  ['dragonair', 148],
  ['cloyster', 91],
  ['dewgong', 87],
  ['jynx', 124],
  ['piloswine', 221],
  ['miltank', 241],
  ['donphan', 232],
  ['sandslash', 28],
  ['golem', 76],
  ['rhydon', 112],
  ['charizard', 6],
  ['typhlosion', 157],
  ['nidoking', 34],
  ['nidoqueen', 31],
  ['crobat', 169],
  ['gengar', 94],
  ['misdreavus', 200],
  ['hitmonchan', 107],
  ['hitmonlee', 106],
  ['hitmontop', 237],
  ['arcanine', 59],
  ['magmar', 126],
  ['pupitar', 247],
  ['steelix', 208],
  ['wigglytuff', 40],
  ['xatu', 178],
  ['alakazam', 65],
  ['hypno', 97],
  ['gyarados', 130],
  ['mantine', 226],
  ['pinsir', 127],
  ['clefable', 36],
  ['granbull', 210],
  ['skarmory', 227],
  ['noctowl', 164],
  ['pidgeot', 18],
  ['marowak', 105],
  ['tyranitar', 248],
  ['aerodactyl', 142],
  ['scizor', 212],
  ['dragonite', 149],
  ['whimsicott', 547],
  ['magcargo', 219],
  ['toxicroak', 454],
  ['exeggutor', 103],
  ['mismagius', 429],
  ['aurorus', 699],
  ['scrafty', 560],
]);

/**
 * Dex nacional cujo sprite normal/shiny a variante Outland deve usar.
 * Ex.: Brave Blastoise (#2001) → Blastoise (#9).
 */
export function ehNomeVarianteOutland(nome = '') {
  const base = String(nome ?? '').trim();
  return PREFIXOS_OUTLAND.some((p) => base.startsWith(p));
}

export function dexSpriteBaseOutland(pokeId, nome = '') {
  if (!isOutlandPokeId(pokeId)) return null;
  let base = String(nome ?? '').trim();
  for (const p of PREFIXOS_OUTLAND) {
    if (base.startsWith(p)) {
      base = base.slice(p.length);
      break;
    }
  }
  return DEX_POR_NOME.get(base.toLowerCase()) ?? null;
}
