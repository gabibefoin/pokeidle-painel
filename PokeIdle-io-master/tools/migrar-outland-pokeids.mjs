#!/usr/bin/env node
/**
 * Migração Outland: pokeId espelho 10501+ → #2001+ (normalizado).
 *
 *   node tools/migrar-outland-pokeids.mjs           dry-run
 *   node tools/migrar-outland-pokeids.mjs --apply   grava JSONs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  remapOutlandPokeId,
  isOutlandPokeIdLegado,
  OUTLAND_DEX_BASE,
  aplicarRemapOutlandLista,
} from '../game/src/shared/outland.mjs';
import { ehNomeVarianteOutland } from '../game/src/shared/outland-sprite-dex.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');

const CREATURES = join(RAIZ, 'public/data/creatures.json');
const SHINYS = join(RAIZ, 'game/src/server/dados/shiny-catalogo-novos.json');
const SPRITES_LAB = join(RAIZ, 'game/src/server/dados/creatures-sprites-lab.json');
const BASELINE = join(RAIZ, 'tools/nomeador/pokedex-lab-baseline.json');

function carregar(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function gravar(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

const rel = { creatures: 0, spritesLab: 0, shinysOutland: 0, shinysUnova: 0 };

// --- creatures.json (espelho) ---
if (existsSync(CREATURES)) {
  const data = carregar(CREATURES);
  const antes = data.creatures.filter((c) => isOutlandPokeIdLegado(c.pokeId)).length;
  aplicarRemapOutlandLista(data.creatures);
  rel.creatures = antes;
  if (apply) gravar(CREATURES, data);
  console.log(`creatures.json: ${antes} espécies Outland remapeadas`);
} else {
  console.log('creatures.json: ausente (runtime remap no boot cobre)');
}

// --- creatures-sprites-lab.json ---
if (existsSync(SPRITES_LAB)) {
  const data = carregar(SPRITES_LAB);
  for (const p of data.patches ?? []) {
    const ant = p.pokeId;
    p.pokeId = remapOutlandPokeId(p.pokeId);
    if (p.pokeId !== ant) rel.spritesLab++;
  }
  if (apply) gravar(SPRITES_LAB, data);
  console.log(`creatures-sprites-lab.json: ${rel.spritesLab} patches remapeados`);
}

// --- shiny-catalogo-novos.json ---
const shiny = carregar(SHINYS);
const baseline = existsSync(BASELINE) ? carregar(BASELINE).entradas : {};
const dexJa = new Set(shiny.entries.filter((e) => e.dexId != null && !ehNomeVarianteOutland(e.name)).map((e) => e.dexId));

for (const e of shiny.entries) {
  if (e.dexId >= 501 && e.dexId <= 547 && ehNomeVarianteOutland(e.name)) {
    const pokeId = OUTLAND_DEX_BASE + (e.dexId - 501);
    e.pokeId = pokeId;
    delete e.dexId;
    rel.shinysOutland++;
  }
}

// Nacional Unova 501–547 com sprite no baseline, ausente do catálogo
for (const ent of Object.values(baseline)) {
  if (ent.dex < 501 || ent.dex > 547 || !ent.shiny?.id) continue;
  if (dexJa.has(ent.dex)) continue;
  shiny.entries.push({
    dexId: ent.dex,
    name: ent.nome ?? ent.slug,
    looktype: 70000 + ent.dex,
    tier: 'C',
    count: 3,
  });
  dexJa.add(ent.dex);
  rel.shinysUnova++;
}

shiny.entries.sort((a, b) => {
  const ka = a.pokeId ?? a.dexId ?? 0;
  const kb = b.pokeId ?? b.dexId ?? 0;
  return ka - kb;
});

if (apply) gravar(SHINYS, shiny);
console.log(`shiny-catalogo-novos.json: ${rel.shinysOutland} Outland → pokeId, ${rel.shinysUnova} Unova nacional adicionados`);

console.log(apply ? '\n✓ Gravado.' : '\n(dry-run — use --apply para gravar)');
