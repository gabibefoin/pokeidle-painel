#!/usr/bin/env node
/**
 * Cruza hunts regionais × looktypeShiny do jogo × Pokédex lab.
 *
 *   node tools/auditar-shinys-regionais.mjs
 *   node tools/auditar-shinys-regionais.mjs --json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarPokedex } from './nomeador/pokedex-catalog.mjs';
import { labIndex } from './caminhos.mjs';
import { huntsJogaveis, looktypeShiny } from '../game/src/server/content.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');

let dexShinySprite = new Map();
try {
  const lab = JSON.parse(readFileSync(labIndex(), 'utf8'));
  const pokedex = montarPokedex(lab.outfits);
  for (const g of pokedex.geracoes) {
    for (const e of g.entradas) {
      if (e.shiny?.id) dexShinySprite.set(e.dex, e);
    }
  }
} catch {
  const baseline = JSON.parse(readFileSync(join(RAIZ, 'tools/nomeador/pokedex-lab-baseline.json'), 'utf8'));
  for (const e of Object.values(baseline.entradas ?? {})) {
    if (e.shiny?.id) dexShinySprite.set(e.dex, e);
  }
}

const REGIOES = ['kanto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'outland'];
const dexOf = (id) => (id >= 13000 ? id - 13000 : id);

const porRegiao = {};
const gaps = [];

for (const h of huntsJogaveis) {
  const reg = h.area === 'outland' ? 'outland' : (h.regiao || 'kanto');
  if (!porRegiao[reg]) porRegiao[reg] = { total: 0, comShiny: 0, gapLab: [] };
  const pokeId = h.especies[0]?.pokeId;
  if (!pokeId) continue;
  const dex = dexOf(pokeId);
  porRegiao[reg].total++;
  if (looktypeShiny(pokeId)) {
    porRegiao[reg].comShiny++;
  } else {
    const lab = dexShinySprite.get(dex);
    if (lab) {
      porRegiao[reg].gapLab.push({ dex, slug: h.slug, nome: h.especies[0]?.name });
      gaps.push({ reg, dex, slug: h.slug, nome: h.especies[0]?.name });
    }
  }
}

const relatorio = {
  geradoEm: new Date().toISOString(),
  regioes: Object.fromEntries(
    Object.entries(porRegiao).map(([reg, d]) => [
      reg,
      {
        total: d.total,
        comShinyPossivel: d.comShiny,
        pct: d.total ? Math.round((100 * d.comShiny) / d.total) : 0,
        spriteLabSemCatalogo: d.gapLab,
      },
    ]),
  ),
  gapsTotal: gaps.length,
  gaps,
};

const outPath = join(RAIZ, 'tools/auditoria-shinys-regionais.json');
writeFileSync(outPath, JSON.stringify(relatorio, null, 2));

if (asJson) {
  console.log(JSON.stringify(relatorio, null, 2));
} else {
  console.log('=== Shinys regionais × looktypeShiny (pós-migração Outland) ===\n');
  for (const reg of REGIOES) {
    const r = relatorio.regioes[reg];
    if (!r) continue;
    console.log(`${reg}: ${r.comShinyPossivel}/${r.total} (${r.pct}%) — gaps lab: ${r.spriteLabSemCatalogo.length}`);
    if (r.spriteLabSemCatalogo.length) {
      for (const x of r.spriteLabSemCatalogo.slice(0, 5)) {
        console.log(`  ⚠ #${x.dex} ${x.nome ?? x.slug}`);
      }
    }
  }
  console.log(`\nGaps totais (lab tem sprite, jogo não): ${gaps.length}`);
  console.log(`Relatório: ${outPath}`);
}
