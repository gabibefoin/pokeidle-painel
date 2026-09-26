import { isOutlandPokeId } from './outland.mjs';
import { dexSpriteBaseOutland } from './outland-sprite-dex.mjs';

const CAMPOS_STAT = ['baseHp', 'baseAtk', 'baseDef', 'baseSpAtk', 'baseSpDef', 'baseSpeed'];

/**
 * Variantes Outland (#2001+) herdam stats base e moves da espécie base equivalente.
 * "Brave Blastoise" → Blastoise (#9); "Milch-Miltank" → Miltank. Usa o mesmo mapa nome→dex
 * de {@link dexSpriteBaseOutland}, que já resolve o sprite.
 *
 * Roda no boot DEPOIS dos ajustes de auditoria na dex nacional, então a variante pega os
 * valores já corrigidos. Não toca em tipo, loot, evolução, looktype nem nome.
 */
export function herdarBaseOutland(lista) {
  const porId = new Map(lista.map((c) => [c.pokeId, c]));
  for (const esp of lista) {
    if (!isOutlandPokeId(esp.pokeId)) continue;
    const baseDex = dexSpriteBaseOutland(esp.pokeId, esp.name);
    if (baseDex == null) continue;
    const base = porId.get(baseDex);
    if (!base) continue;
    for (const k of CAMPOS_STAT) {
      if (typeof base[k] === 'number') esp[k] = base[k];
    }
    if (Array.isArray(base.attacks)) esp.attacks = base.attacks.map((a) => ({ ...a }));
  }
}
