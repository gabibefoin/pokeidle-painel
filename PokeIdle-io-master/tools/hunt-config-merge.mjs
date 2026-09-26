/** Mescla hunt-configs do espelho com overrides locais (game/src/server/dados). */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const OVERRIDES_PATH = join(RAIZ, 'game/src/server/dados/hunt-spawns-overrides.json');

let cache = null;

function carregarOverrides() {
  if (cache) return cache;
  try {
    if (!existsSync(OVERRIDES_PATH)) {
      cache = {};
      return cache;
    }
    cache = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8')).hunts ?? {};
  } catch {
    cache = {};
  }
  return cache;
}

export function huntConfigEfetivo(huntConfigs, slug) {
  const base = huntConfigs[slug] ?? {};
  const o = carregarOverrides()[slug];
  if (!o?.spawns?.length) return base;
  return { ...base, spawns: o.spawns };
}

export function mesclarHuntConfigs(huntConfigs) {
  const overrides = carregarOverrides();
  const saida = { ...huntConfigs };
  for (const [slug, o] of Object.entries(overrides)) {
    if (!o?.spawns?.length) continue;
    saida[slug] = { ...(huntConfigs[slug] ?? {}), spawns: o.spawns };
  }
  return saida;
}
