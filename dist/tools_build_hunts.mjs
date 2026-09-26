import fs from 'node:fs';
import path from 'node:path';

const root = '/Users/gabilemos/Documents/Pokeidle/PokeidleHub';
const pokeMaster = path.join(root, 'PokeIdle-io-master');

const huntsList = [];

// 1. Spawns editor (Hoenn, Sinnoh, Unova, Kalos, Alola)
const spawnsEditor = JSON.parse(fs.readFileSync(path.join(pokeMaster, 'game/src/server/dados/spawns-editor.json'), 'utf8'));
for (const [regiaoKey, regObj] of Object.entries(spawnsEditor.regioes)) {
  for (const m of regObj.marcadores || []) {
    huntsList.push({
      slug: m.slug,
      name: m.slug.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      region: regObj.rotulo || regiaoKey,
      level: m.nivel || 1,
      pokeId: m.pokeId,
      gateLevel: regObj.nivelGate || 1,
      pixel: m.pixel || [0, 0]
    });
  }
}

// 2. Kanto, Johto, Sinnoh, Outland
const extras = [
  { file: 'hunts-kanto-novos.json', region: 'Kanto', gate: 1 },
  { file: 'hunts-johto-novos.json', region: 'Johto', gate: 100 },
  { file: 'hunts-sinnoh.json', region: 'Sinnoh', gate: 1750 },
  { file: 'hunts-outland-novos.json', region: 'Outland', gate: 150 }
];

for (const e of extras) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(pokeMaster, 'game/src/server/dados', e.file), 'utf8'));
    for (const h of data.hunts || []) {
      huntsList.push({
        slug: h.slug,
        name: h.nome || h.slug.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        region: e.region,
        level: h.nivel || 1,
        pokeId: h.pokeId,
        gateLevel: e.gate,
        tipo: h.tipo || 'NORMAL',
        pixel: h.pixel || [0, 0]
      });
    }
  } catch (err) {}
}

// Ordenar por nível
huntsList.sort((a, b) => a.level - b.level);

const outputPath = path.join(root, 'portal/data/hunts_portal.json');
fs.writeFileSync(outputPath, JSON.stringify(huntsList, null, 2), 'utf8');
console.log(`Sucesso! ${huntsList.length} hunts extraídas em: ${outputPath}`);
