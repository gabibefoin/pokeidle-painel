// TM Disks — peças de boss, troca no TM Researcher e golpes permanentes no pokémon.

import { itens, TIPOS_POKEMON } from '../content.mjs';

import { chebyshev } from './campo.mjs';

import {

  TM_ELEMENTAL_RAIO,

  TM_ELEMENTAL_POWER,

  TM_ELEMENTAL_CD_MS,

  golpeTmElemental,

} from '../../shared/tm-elemental.mjs';



export const PIECE_ELEMENTAL = 59194;

export const PIECE_AOE = 40530;

export const DISK_AOE = 40575;



export const CUSTO_PECAS_ELEMENTAL = 10;

export const CUSTO_PECAS_AOE = 10;



/** AoE disk: todos os golpes acertam área 12×12 (centro no herói). */

export const TM_AOE_RAIO = 5; // max(|dx|,|dy|) ≤ 5 → 11 tiles; perto do 12×12 do original

/** TM elemental: golpe especial 3×3 (centro no alvo). A definição mora em `shared/` porque o
 *  medidor das arenas e o painel de golpes do cliente precisam do MESMO golpe — ver o cabeçalho
 *  de `shared/tm-elemental.mjs`. Reexportado aqui para não quebrar quem já importa daqui. */

export { TM_ELEMENTAL_RAIO, TM_ELEMENTAL_POWER, TM_ELEMENTAL_CD_MS, golpeTmElemental };



/** itemId do disco elemental por tipo (ex.: FIRE → 59201). */

export const DISCO_POR_TIPO = {};

for (const t of TIPOS_POKEMON) {

  const label = t === 'NORMAL'

    ? 'Normal-Type TM Disk'

    : `${t.charAt(0)}${t.slice(1).toLowerCase()}-Type TM Disk`;

  const item = [...itens.values()].find((i) => i.name === label);

  if (item) DISCO_POR_TIPO[t] = item.id;

}



export const TIPOS_COM_DISCO = TIPOS_POKEMON.filter((t) => DISCO_POR_TIPO[t]);



export function discoElementalPorItemId(itemId) {

  const id = Number(itemId);

  for (const t of TIPOS_POKEMON) {

    if (DISCO_POR_TIPO[t] === id) return t;

  }

  return null;

}



export function ehDiscoTm(item) {

  if (!item) return null;

  if (item.id === DISK_AOE) return 'aoe';

  if (discoElementalPorItemId(item.id)) return 'elemental';

  return null;

}



/** Elemental TM só no tipo primário/secundário do pokémon. */

export function tipoTmPermitido(tipo, pk) {

  if (!tipo || !pk) return false;

  return (pk.tipos ?? []).includes(tipo);

}







/** Raio Chebyshev do golpe: 0 = single-target. */

export function raioDoGolpe(golpe, pk) {

  if (golpe?.tmElemental) return TM_ELEMENTAL_RAIO;

  if (pk?.tmAoe) return TM_AOE_RAIO;

  return 0;

}



/** Mobs atingidos por um golpe (single, 3×3 no alvo ou 12×12 no herói). */

export function alvosDoGolpe(campo, primario, golpe, pk) {

  const raio = raioDoGolpe(golpe, pk);

  if (raio <= 0) return primario && !primario.morto ? [primario] : [];



  const h = campo.heroi;

  const cx = golpe?.tmElemental ? primario.cx : h.cx;

  const cy = golpe?.tmElemental ? primario.cy : h.cy;

  const alvos = [];

  for (const m of campo.mobs.values()) {

    if (m.morto) continue;

    if (chebyshev(m.cx, m.cy, cx, cy) <= raio) alvos.push(m);

  }

  if (!alvos.length && primario && !primario.morto) alvos.push(primario);

  return alvos;

}



export function configTmResearcher() {

  return {

    custoElemental: CUSTO_PECAS_ELEMENTAL,

    custoAoe: CUSTO_PECAS_AOE,

    pieceElemental: PIECE_ELEMENTAL,

    pieceAoe: PIECE_AOE,

    diskAoe: DISK_AOE,

    discos: TIPOS_COM_DISCO.map((t) => ({ tipo: t, itemId: DISCO_POR_TIPO[t] })),

  };

}

