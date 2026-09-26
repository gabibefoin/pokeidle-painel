#!/usr/bin/env node
/** Lista shinys novos no lab vs baseline e conflitos de id duplicado. */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarPokedex, spritesDeSlug } from './pokedex-catalog.mjs';
import { especieDe } from './dex.mjs';
import { labIndex } from '../caminhos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const INDICE = labIndex();
const BASELINE = join(AQUI, 'pokedex-lab-baseline.json');

const lab = JSON.parse(readFileSync(INDICE, 'utf-8')).outfits;
const dex = montarPokedex(lab);
const base = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf-8'))
  : { entradas: {} };

console.log('=== Shinys lab com id mais novo que o baseline ===');
const mudou = [];
for (const g of dex.geracoes) {
  for (const e of g.entradas) {
    const cur = e.shiny;
    const ant = base.entradas[e.slug]?.shiny;
    if (!cur || (cur.fonte !== 'lab' && cur.fonte !== 'lab-alias')) continue;
    if (!ant || ant.id !== cur.id) {
      mudou.push({
        dex: e.dex,
        slug: e.slug,
        id: cur.id,
        name: cur.name,
        antes: ant?.id ?? '—',
      });
    }
  }
}
console.log(mudou.length ? mudou.map((x) => `#${x.dex} ${x.slug} ${x.name} #${x.id} (era ${x.antes})`).join('\n') : '(nenhum)');

console.log('\n=== Espécies com 2+ shinys no lab (usa id mais alto na Pokédex) ===');
const byEsp = new Map();
for (const e of Object.values(lab)) {
  if (!e.nomeado || e.kind !== 'shiny') continue;
  const slug = especieDe(e.name.replace(/^shiny_/, '').replace(/_shiny$/, ''));
  if (!slug) continue;
  if (!byEsp.has(slug)) byEsp.set(slug, []);
  byEsp.get(slug).push(e);
}
for (const [slug, arr] of [...byEsp.entries()].filter(([, a]) => a.length > 1)) {
  const pick = spritesDeSlug(lab, slug).shiny;
  console.log(`${slug}: ${arr.map((a) => `#${a.id} ${a.name}`).join(' | ')} → #${pick?.id}`);
}
