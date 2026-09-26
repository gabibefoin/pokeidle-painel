import { dexDe } from './escala-hunt-level.mjs';
import {
  isOutlandPokeId,
  isOutlandPokeIdLegado,
  remapOutlandPokeId,
  dexChaveOutland,
  OUTLAND_DEX_BASE,
  montarOutlandDexLegado48,
} from './outland.mjs';

/** Último # dex do mapa antigo (48 slots — #2001 era Blastoise 10001 fantasma). */
const OUTLAND_DEX_MAX_LEGADO = OUTLAND_DEX_BASE + 47;

/** Mapa pokeId→#2001… — preenchido no boot (identidade após migração). */
let outlandDex = null;
/** Só para migrar saves do mapa de 48 slots. */
let outlandDexLegado48 = null;

export function setOutlandDexMap(mapa) {
  outlandDex = mapa ?? null;
}

export function setOutlandDexLegado48(mapa) {
  outlandDexLegado48 = mapa ?? null;
}

/**
 * Reescreve chaves Outland #2001… quando o mapa tinha 48 entradas (Blastoise fantasma em #2001).
 * Converte cada slot antigo → pokeId → slot novo via {@link outlandDex}.
 */
export function migrarChavesPokedexLegado(pokedex) {
  const src = pokedex ?? {};
  if (!outlandDexLegado48 || !outlandDex?.pokeToDex) return src;

  let temOutland = false;
  for (const k of Object.keys(src)) {
    const n = Number(k);
    if (n >= OUTLAND_DEX_BASE && n <= OUTLAND_DEX_MAX_LEGADO) {
      temOutland = true;
      break;
    }
  }
  if (!temOutland) return src;

  const out = { ...src };
  for (let dex = OUTLAND_DEX_BASE; dex <= OUTLAND_DEX_MAX_LEGADO; dex++) {
    const v = src[dex];
    if (!v) continue;
    delete out[dex];
    const pokeId = outlandDexLegado48[dex];
    if (!pokeId || pokeId < OUTLAND_DEX_BASE) continue;
    const novo = dexChaveOutland(remapOutlandPokeId(pokeId));
    if (novo == null) continue;
    out[novo] = somarEntrada(out[novo], v);
  }
  return out;
}

/**
 * Funde duas entradas da Pokédex.
 *
 * `k`/`c` são derrotas e capturas; `sv`/`sc` contam os SHINY (vistos no arremesso e
 * capturados). Os dois de shiny só entram no objeto quando são maiores que zero: com 443
 * espécies e um shiny a cada 24.000 capturas, gravar `sv: 0, sc: 0` em cada linha inflaria
 * o JSONB e o delta da Pokédex para todo mundo, em troca de nada. Ausente lê-se zero.
 */
function somarEntrada(base, v) {
  const out = base ?? { k: 0, c: 0 };
  out.k += Number(v?.k ?? 0);
  out.c += Number(v?.c ?? 0);
  const sv = out.sv ?? 0;
  const sc = out.sc ?? 0;
  const somaSv = sv + Number(v?.sv ?? 0);
  const somaSc = sc + Number(v?.sc ?? 0);
  if (somaSv > 0) out.sv = somaSv;
  if (somaSc > 0) out.sc = somaSc;
  return out;
}

/** Converte uma chave crua do save em número de dex guardado. */
function resolverChaveSalva(id) {
  if (id >= OUTLAND_DEX_BASE && id <= OUTLAND_DEX_MAX_LEGADO) return id;
  if (isOutlandPokeIdLegado(id)) return remapOutlandPokeId(id);
  if (isOutlandPokeId(id)) return dexChaveOutland(id);
  return dexDe(id);
}

/**
 * Chave guardada na Pokédex — número nacional (#252…) ou Outland (#2001…).
 *
 * Hoenn+ continua como antes: pokeId interno 13xxx no combate, `dexDe(13252)` → 252.
 */
export function chavePokedex(pokeId) {
  const id = Number(pokeId);
  if (!Number.isFinite(id) || id < 1) return null;
  if (isOutlandPokeIdLegado(id)) return remapOutlandPokeId(id);
  if (isOutlandPokeId(id)) return dexChaveOutland(id);
  return dexDe(id);
}

/** Normaliza entradas do JSONB — funde chaves duplicadas (pokeId vs #dex). */
export function normalizarEntradasPokedex(pokedex) {
  const out = {};
  for (const [k, v] of Object.entries(pokedex ?? {})) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    const chave = resolverChaveSalva(id);
    if (chave == null) continue;
    out[chave] = somarEntrada(out[chave], v);
  }
  return out;
}
