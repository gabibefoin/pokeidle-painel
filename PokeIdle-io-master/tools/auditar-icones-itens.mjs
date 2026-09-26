#!/usr/bin/env node
/** Lista itens com `_loot_placeholder`, URL morta ou ícone ausente no espelho. */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { itens } from '../game/src/server/content.mjs';
import { caminhoIconeRel } from '../game/src/shared/icone-item.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(RAIZ, 'public', 'data');

const iconsJson = existsSync(join(ASSETS, 'items-icons.json'))
  ? JSON.parse(readFileSync(join(ASSETS, 'items-icons.json'), 'utf8'))
  : {};

const existe = (rel) => {
  if (!rel) return false;
  const p = rel.startsWith('/') ? join(RAIZ, 'game/src/client', rel.slice(1)) : join(ASSETS, rel);
  return existsSync(p);
};

const placeholder = [];
const urlMorta = [];
const semArte = [];

for (const i of itens.values()) {
  const icon = i.icon ?? '';
  if (icon.includes('_loot_placeholder')) placeholder.push(i);
  else if (/^https?:\/\//i.test(icon)) urlMorta.push(i);
  else {
    const rel = iconsJson[i.id] ?? caminhoIconeRel(icon);
    if (!rel || !existe(rel)) semArte.push({ ...i, rel: rel ?? '(sem caminho)' });
  }
}

console.log('=== _loot_placeholder.png (' + placeholder.length + ') ===');
for (const i of placeholder) console.log(`  ${i.id}\t${i.name}`);

console.log('\n=== URL externa morta (' + urlMorta.length + ') ===');
for (const i of urlMorta) console.log(`  ${i.id}\t${i.name}\t${i.icon}`);

console.log('\n=== Sem arquivo de ícone local (' + semArte.length + ') ===');
for (const i of semArte) console.log(`  ${i.id}\t${i.name}\t${i.rel}`);
