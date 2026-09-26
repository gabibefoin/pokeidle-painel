import { limpar } from './dex.mjs';
import { spriteLabDeSlug, carregarCatalogo, montarPokedex } from './pokedex-catalog.mjs';

export {
  LENDARIO_DEX,
  LENDARIOS_DEX,
  MITICO_DEX,
  SLUGS_OMITIDOS,
  NOMES_OMITIDOS,
  FONTE_POR_TIPO,
  fontePorTipo,
} from '../../game/src/shared/spawns-filtro.mjs';

import {
  LENDARIO_DEX,
  NOMES_OMITIDOS,
} from '../../game/src/shared/spawns-filtro.mjs';

export function lendariosNaFaixa(min, max) {
  const { geracoes } = carregarCatalogo();
  const nomePorDex = new Map();
  for (const g of geracoes) {
    for (const e of g.entradas) {
      const hit = nomePorDex.get(e.dex);
      if (!hit || e.slug.length < hit.slug.length) nomePorDex.set(e.dex, { nome: e.nome, slug: e.slug });
    }
  }
  const lista = [];
  for (const dex of LENDARIO_DEX) {
    if (dex < min || dex > max) continue;
    lista.push({ dex, nome: nomePorDex.get(dex)?.nome ?? `#${dex}` });
  }
  lista.sort((a, b) => a.dex - b.dex);
  return lista;
}

export function contarLendarios(min, max) {
  return lendariosNaFaixa(min, max).length;
}

export function resumoLendarios(min, max) {
  const lista = lendariosNaFaixa(min, max);
  return { total: lista.length, nomes: lista.map((e) => e.nome) };
}

/**
 * Dex com sprite publicado no jogo: patch em creatures-sprites-lab.json
 * ou variante Orre (13xxx) com looktype no merge.
 */
export function allowlistSpawnSprites(merge, patches = []) {
  const lookPorId = new Map(patches.map((p) => [p.pokeId, p.looktype]));
  const patchDex = new Set(patches.map((p) => p.pokeId));
  const orreDex = new Set();
  for (const c of merge) {
    if (c.pokeId < 13000 || c.pokeId >= 14000) continue;
    const dex = c.pokeId % 1000;
    const lt = lookPorId.get(c.pokeId) ?? c.looktype ?? 1;
    if (lt > 1) orreDex.add(dex);
  }
  return { patchDex, orreDex };
}

/** Só entra se o lab tem o par nomeado E o jogo já usa esse looktype (patch ou Orre). */
export function especieSpawnavel({ dex, nome, outfits, patchDex, orreDex }) {
  if (LENDARIO_DEX.has(dex)) return false;
  if (!outfits || !nome || !patchDex || !orreDex) return false;
  if (!spriteLabDeSlug(outfits, limpar(nome))) return false;
  return patchDex.has(dex) || orreDex.has(dex);
}

/**
 * Mesmo critério do Pokédex / spawns.html: `ent.normal` (lab ou manifest do espelho).
 * Usar isto em auditorias — NÃO `especieSpawnavel`, que exige patch publicado no jogo.
 */
export function dexComSpritePokedex(outfits) {
  const dexOk = new Set();
  if (!outfits) return dexOk;
  const pokedex = montarPokedex(outfits);
  for (const g of pokedex.geracoes) {
    for (const ent of g.entradas) {
      if (ent.normal) dexOk.add(ent.dex);
    }
  }
  return dexOk;
}

export function marcadorTemSprite(m, outfits, dexOk) {
  if (LENDARIO_DEX.has(m.dex)) return false;
  if (NOMES_OMITIDOS.has(m.nome)) return false;
  return dexOk.has(m.dex);
}
