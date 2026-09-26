#!/usr/bin/env node
/** Lista entradas do baseline cujo id no lab-index não bate mais com a espécie. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LENDARIO_DEX } from '../../game/src/shared/spawns-filtro.mjs';
import { labIndex } from '../caminhos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(join(AQUI, 'pokedex-lab-baseline.json'), 'utf8')).entradas;
const LAB = labIndex();
const lab = JSON.parse(readFileSync(LAB, 'utf8')).outfits;

function especieDe(name) {
  return String(name || '')
    .replace(/^shiny_/, '')
    .replace(/_shiny$/, '')
    .replace(/_\d+$/, '');
}

function casa(e, slug, shiny) {
  if (!e?.name) return false;
  if (shiny) return e.name === `shiny_${slug}` || e.name === `${slug}_shiny`;
  return e.name === slug || especieDe(e.name) === slug;
}

const mismatches = [];
for (const [slug, meta] of Object.entries(baseline)) {
  for (const slot of ['normal', 'shiny']) {
    const m = meta[slot];
    if (!m?.id) continue;
    const e = lab[String(m.id)];
    if (!e) {
      mismatches.push({ slug, dex: meta.dex, slot, id: m.id, issue: 'missing', baselineName: m.name });
      continue;
    }
    if (!casa(e, slug, slot === 'shiny')) {
      mismatches.push({
        slug,
        dex: meta.dex,
        slot,
        id: m.id,
        baselineName: m.name,
        labName: e.name,
        arquivo: e.arquivo,
        chave: e.chave,
        baselineChave: m.chave,
        lendario: LENDARIO_DEX.has(meta.dex),
      });
    }
  }
}

console.log(`Total desalinhados: ${mismatches.length}`);
const boss = mismatches.filter((m) => m.lendario);
console.log(`Lendários (bosses): ${boss.length}`);
for (const m of boss) console.log(JSON.stringify(m));
