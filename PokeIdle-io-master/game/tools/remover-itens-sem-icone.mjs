/**
 * Remove os 8 itens importados sem PNG e tira o loot de quem os dropava.
 *
 *   node tools/remover-itens-sem-icone.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = join(raiz, 'public/data');

const REMOVER = [
  "Eevee Valentine's Card",
  "Flareon Valentine's Card",
  'Gardestrike Essence',
  "Jolteon Valentine's Card",
  'Pizza',
  'Psychic Ear',
  'Talon',
  "Vaporeon Valentine's Card",
];

const norm = (s) => String(s).toLowerCase();
const removerNorm = new Set(REMOVER.map(norm));

function limparLoot(lista, rotulo) {
  let removidos = 0;
  const quem = [];
  for (const c of lista) {
    if (!c.loot?.length) continue;
    const antes = c.loot.length;
    c.loot = c.loot.filter((l) => {
      if (removerNorm.has(norm(l.name))) {
        quem.push({ poke: c.name, drop: l.name });
        return false;
      }
      return true;
    });
    removidos += antes - c.loot.length;
  }
  console.log(`${rotulo}: ${removidos} entradas de loot removidas`);
  for (const q of quem) console.log(`  · ${q.poke} → ${q.drop}`);
  return removidos;
}

const itemsPath = join(dataDir, 'items.json');
const iconsPath = join(dataDir, 'items-icons.json');
const creaturesPath = join(dataDir, 'creatures.json');
const novosPath = join(raiz, 'game/src/server/dados/creatures-novos.json');

const itemsJson = JSON.parse(readFileSync(itemsPath, 'utf8'));
const removidos = itemsJson.items.filter((i) => removerNorm.has(norm(i.name)));
const ids = new Set(removidos.map((i) => i.id));

console.log('Itens removidos do catálogo:');
for (const i of removidos) console.log(`  ${i.id}  ${i.name}`);

itemsJson.items = itemsJson.items.filter((i) => !ids.has(i.id));

const icons = JSON.parse(readFileSync(iconsPath, 'utf8'));
for (const id of ids) delete icons[id];

const creaturesJson = JSON.parse(readFileSync(creaturesPath, 'utf8'));
limparLoot(creaturesJson.creatures, 'creatures.json');

const novosJson = JSON.parse(readFileSync(novosPath, 'utf8'));
limparLoot(novosJson.creatures, 'creatures-novos.json');

writeFileSync(itemsPath, `${JSON.stringify(itemsJson, null, 1)}\n`);
writeFileSync(iconsPath, `${JSON.stringify(icons, null, 1)}\n`);
writeFileSync(creaturesPath, `${JSON.stringify(creaturesJson, null, 1)}\n`);
writeFileSync(novosPath, `${JSON.stringify(novosJson, null, 1)}\n`);

console.log('\nGravado.');
