import { isOutlandPokeId } from './outland.mjs';
import { dexSpriteBaseOutland } from './outland-sprite-dex.mjs';

/** Variantes Outland (#2001+) herdam looktype da espécie base equivalente. */
export function herdarLooktypeOutland(lista) {
  const porId = new Map(lista.map((c) => [c.pokeId, c]));
  for (const esp of lista) {
    if (!isOutlandPokeId(esp.pokeId)) continue;
    const baseDex = dexSpriteBaseOutland(esp.pokeId, esp.name);
    if (!baseDex) continue;
    const base = porId.get(baseDex);
    if (base?.looktype > 1) esp.looktype = base.looktype;
  }
}
