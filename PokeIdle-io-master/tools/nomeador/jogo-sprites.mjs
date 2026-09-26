// Looktypes e manifests do PokeIdle.io — fallback quando o lab-index não tem o par nomeado.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { limpar, carregarDex } from './dex.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const GAME = join(AQUI, '../../public/data');
const CAT_DIR = join(GAME, 'asset-packs/categories');

let cache = null;

/** pokemondb slug → slugs do nomeador / dex-nacional. */
const FORM_ALIASES = {
  castform_sunny_form: ['castform_fire', 'castform'],
  castform_rainy_form: ['castform_water', 'castform'],
  castform_snowy_form: ['castform_ice', 'castform'],
  burmy_plant_cloak: ['burmy_plant', 'burmy'],
  burmy_sandy_cloak: ['burmy_sandy', 'burmy'],
  burmy_trash_cloak: ['burmy_trash', 'burmy'],
  wormadam_plant_cloak: ['wormadam_plant', 'wormadam'],
  wormadam_sandy_cloak: ['wormadam_sandy', 'wormadam'],
  wormadam_trash_cloak: ['wormadam_trash', 'wormadam'],
  shellos_west_sea: ['shellos_west', 'shellos'],
  shellos_east_sea: ['shellos_east', 'shellos'],
  gastrodon_west_sea: ['gastrodon_west', 'gastrodon'],
  gastrodon_east_sea: ['gastrodon_east', 'gastrodon'],
  deoxys_normal_forme: ['deoxys'],
  deoxys_attack_forme: ['deoxys'],
  deoxys_defense_forme: ['deoxys'],
  deoxys_speed_forme: ['deoxys'],
  rotom_heat_rotom: ['rotom'],
  rotom_wash_rotom: ['rotom'],
  rotom_frost_rotom: ['rotom'],
  rotom_fan_rotom: ['rotom'],
  rotom_mow_rotom: ['rotom'],
  nidoran_f: ['nidoran_female'],
  nidoran_m: ['nidoran_male'],
};

function manifestDeLooktype(lt) {
  if (!lt || !existsSync(CAT_DIR)) return null;
  const prefix = `outfits-male-${lt}-`;
  const arq = readdirSync(CAT_DIR).find((n) => n.startsWith(prefix));
  return arq ? `/assets-packs/categories/${arq}` : null;
}

function carregarJogo() {
  if (cache) return cache;

  const { creatures } = JSON.parse(readFileSync(join(GAME, 'creatures.json'), 'utf-8'));
  const formulas = JSON.parse(readFileSync(join(GAME, 'index/formulas.json'), 'utf-8'));
  const shinyPorDex = new Map((formulas.shinyCatalogo ?? []).map((s) => [s.dexId, s]));

  const porSlug = new Map();
  for (const c of creatures) {
    const slug = limpar(c.name);
    const shiny = shinyPorDex.get(c.pokeId);
    porSlug.set(slug, {
      pokeId: c.pokeId,
      nome: c.name,
      normalLt: c.looktype,
      shinyLt: shiny?.looktype ?? null,
      normalManifest: manifestDeLooktype(c.looktype),
      shinyManifest: shiny?.looktype ? manifestDeLooktype(shiny.looktype) : null,
    });
  }

  cache = { porSlug, shinyPorDex };
  return cache;
}

/** Todos os slugs a tentar ao casar com o lab-index (ordem: exato → aliases → mesmo dex). */
export function slugsBusca(slug, dex = carregarDex()) {
  const set = new Set([slug]);
  for (const a of FORM_ALIASES[slug] ?? []) set.add(a);

  const num = dex[slug];
  if (num) {
    for (const [k, v] of Object.entries(dex)) {
      if (v === num) set.add(k);
    }
  }

  return [...set];
}

/** Resolve slug do catálogo para entrada do jogo (creatures.json). */
export function jogoDeSlug(slug) {
  const { porSlug } = carregarJogo();
  const dex = carregarDex();

  for (const s of slugsBusca(slug)) {
    const hit = porSlug.get(s);
    if (hit) return hit;
  }

  const num = dex[slug];
  if (num) {
    for (const hit of porSlug.values()) {
      if (hit.pokeId === num) return hit;
    }
  }
  return null;
}

export function entradaJogo(slug, shiny = false) {
  const j = jogoDeSlug(slug);
  if (!j) return null;
  const lt = shiny ? j.shinyLt : j.normalLt;
  const manifest = shiny ? j.shinyManifest : j.normalManifest;
  if (!lt || !manifest) return null;
  return {
    id: `jogo-${shiny ? 's' : 'n'}-${lt}`,
    name: slug,
    manifest,
    kind: shiny ? 'shiny' : 'pokemon',
    fonte: 'jogo',
    looktype: lt,
  };
}
