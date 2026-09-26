/**
 * Audita spawns-editor + hunts-sinnoh: duplicatas por dex/região e espécies sem sprite.
 * Critério de sprite = Pokédex (pokedex.html), não patch publicado no jogo.
 *
 *   node tools/auditar-spawns-regionais.mjs           dry-run (padrão)
 *   node tools/auditar-spawns-regionais.mjs --apply   grava alterações
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LENDARIO_DEX,
  dexComSpritePokedex,
  marcadorTemSprite,
} from './nomeador/spawns-filtro.mjs';
import { labIndex } from './caminhos.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DADOS = join(RAIZ, 'game/src/server/dados');
const SPAWNS = join(DADOS, 'spawns-editor.json');
const HUNTS_SINNOH = join(DADOS, 'hunts-sinnoh.json');
const MAPAS = join(DADOS, 'mapas-editor.json');
const LAB_INDEX = labIndex();

const REGIOES = ['hoenn', 'sinnoh', 'unova', 'kalos', 'alola'];
const apply = process.argv.includes('--apply');

const spawns = JSON.parse(readFileSync(SPAWNS, 'utf8'));
const huntsSinnoh = JSON.parse(readFileSync(HUNTS_SINNOH, 'utf8'));
const mapas = JSON.parse(readFileSync(MAPAS, 'utf8'));

let outfits = {};
try {
  outfits = JSON.parse(readFileSync(LAB_INDEX, 'utf8')).outfits ?? {};
} catch {
  console.warn('lab-index.json indisponível — nenhuma espécie passará no critério do Pokédex');
}

const dexOk = dexComSpritePokedex(outfits);
const removidos = { spawns: [], sinnoh: [] };

for (const regId of REGIOES) {
  const reg = spawns.regioes?.[regId];
  if (!reg) continue;
  const vistos = new Map();
  const limpos = [];
  for (const m of reg.marcadores ?? []) {
    let motivo = null;
    if (!marcadorTemSprite(m, outfits, dexOk)) motivo = 'sem sprite (pokedex)';
    else if (vistos.has(m.dex)) motivo = `dup dex (já tem ${vistos.get(m.dex)})`;
    if (motivo) {
      removidos.spawns.push({ regiao: regId, ...m, motivo });
      if (apply) delete mapas.porDex?.[String(m.dex)];
      continue;
    }
    vistos.set(m.dex, m.slug);
    limpos.push(m);
  }
  if (apply) reg.marcadores = limpos;
}

const dexNoEditor = new Set();
for (const regId of REGIOES) {
  for (const m of spawns.regioes?.[regId]?.marcadores ?? []) dexNoEditor.add(m.dex);
}

const huntsFiltradas = (huntsSinnoh.hunts ?? []).filter((h) => {
  const dex = h.pokeId < 1000 ? h.pokeId : h.pokeId % 1000;
  const fake = { dex, nome: h.nome };
  let motivo = null;
  if (dexNoEditor.has(dex)) motivo = 'dup spawns-editor';
  else if (!marcadorTemSprite(fake, outfits, dexOk)) motivo = 'sem sprite (pokedex)';
  if (motivo) {
    removidos.sinnoh.push({ ...h, motivo });
    return false;
  }
  return true;
});

console.log(`\n=== Auditar spawns regionais${apply ? '' : ' (dry-run — use --apply para gravar)'} ===\n`);
console.log(`Sprites no Pokédex: ${dexOk.size} dex\n`);
for (const regId of REGIOES) {
  const n = apply
    ? spawns.regioes?.[regId]?.marcadores?.length ?? 0
    : (spawns.regioes?.[regId]?.marcadores?.length ?? 0) - removidos.spawns.filter((x) => x.regiao === regId).length;
  const r = removidos.spawns.filter((x) => x.regiao === regId);
  console.log(`${regId}: ${n} marcadores${r.length ? ` (${r.length} seriam removidos)` : ''}`);
  for (const x of r) console.log(`  - #${x.dex} ${x.nome}: ${x.motivo}`);
}
const nSinnoh = apply ? huntsFiltradas.length : (huntsSinnoh.hunts?.length ?? 0) - removidos.sinnoh.length;
console.log(`\nhunts-sinnoh: ${nSinnoh} hunts${removidos.sinnoh.length ? ` (${removidos.sinnoh.length} seriam removidos)` : ''}`);
for (const x of removidos.sinnoh) console.log(`  - ${x.nome}: ${x.motivo}`);

if (apply) {
  huntsSinnoh.hunts = huntsFiltradas;
  writeFileSync(SPAWNS, JSON.stringify(spawns, null, 2), 'utf8');
  writeFileSync(HUNTS_SINNOH, JSON.stringify(huntsSinnoh, null, 2), 'utf8');
  writeFileSync(MAPAS, JSON.stringify(mapas, null, 2), 'utf8');
  console.log('\nGravado spawns-editor, hunts-sinnoh, mapas-editor');
} else if (removidos.spawns.length || removidos.sinnoh.length) {
  console.log('\nNada gravado. Rode com --apply se o dry-run estiver correto.');
}
