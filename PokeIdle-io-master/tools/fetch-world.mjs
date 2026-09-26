// Espelha o mundo do jogo: marcadores de hunt, spawns, NPCs de cidade, o atlas de
// tiles (map-items) e, opcionalmente, os mapas em si.
//
// Tudo isto responde sem autenticação:
//   /api/game/map-markers               347 marcadores: slug, nome, pixel no mapa-múndi, área, range
//   /api/game/hunt-config?slug=<hunt>   coordenadas exatas de cada spawn, com pokeId
//   /api/game/city-npcs?slug=<cidade>   NPCs (nurse, market, shop, depot, fishing…)
//   /game/maps/<slug>.json              os tiles daquele mapa  [x, y, z, chãoId, [[itemId],…]]
//   /game/asset-packs/version.json      → índice → manifest → 30 páginas .webp de tiles
//   /game/{collision,draworder,offsets}.json   colisão, ordem de desenho, deslocamentos
//
//   node tools/fetch-world.mjs                 tudo menos os mapas (~35 MB)
//   node tools/fetch-world.mjs --maps          + os 347 mapas de tiles (~330 MB)
//   node tools/fetch-world.mjs --maps=cerulean,pikachu
//   node tools/fetch-world.mjs --force
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ORIGIN, PACK, OUT, stats, save, grab, pool, fetchJson, packRel, packUrl, resumo } from './lib.mjs';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const mapsArg = argv.find((a) => a === '--maps' || a.startsWith('--maps='));
const MAPS = mapsArg === '--maps' ? 'all' : mapsArg?.split('=')[1]?.split(',').filter(Boolean);

const t0 = Date.now();
console.log(`Espelhando o mundo de ${ORIGIN} → ${OUT}\n`);

// --------------------------------------------------- 1. marcadores e spawns

console.log('[1/5] marcadores de hunt');
const markers = await fetchJson(`${ORIGIN}/api/game/map-markers`);
await save('world/map-markers.json', Buffer.from(JSON.stringify(markers, null, 1)));
stats.baixados++;

const slugs = [...new Set(markers.hunts.map((h) => h.slug))];
const porArea = markers.hunts.reduce((a, h) => ((a[h.area] = (a[h.area] || 0) + 1), a), {});
console.log(`      ${slugs.length} slugs · mapa-múndi ${markers.map.w}×${markers.map.h} ·`, porArea);

console.log('[2/5] spawns por hunt (hunt-config)');
const huntConfigs = {};
await pool(
  slugs,
  async (slug) => {
    huntConfigs[slug] = await fetchJson(`${ORIGIN}/api/game/hunt-config?slug=${encodeURIComponent(slug)}`);
  },
  'spawns ',
);
await save('world/hunt-configs.json', Buffer.from(JSON.stringify(huntConfigs)));
stats.baixados++;

const comSpawn = Object.values(huntConfigs).filter((h) => h.spawns?.length).length;
console.log(`      ${comSpawn}/${slugs.length} hunts com spawn`);

// Catálogo de shiny: as espécies que têm forma shiny, com o tier (E→S) que define a
// raridade do encontro e a contagem global de quantos existem no mundo.
const allPokes = await fetchJson(`${ORIGIN}/api/game/all-pokes`);
await save('world/all-pokes.json', Buffer.from(JSON.stringify(allPokes, null, 1)));
stats.baixados++;
console.log(`      catálogo shiny: ${allPokes.total} espécies com forma shiny`);

console.log('[3/5] NPCs de cidade');
const cityNpcs = {};
await pool(
  slugs,
  async (slug) => {
    const npcs = await fetchJson(`${ORIGIN}/api/game/city-npcs?slug=${encodeURIComponent(slug)}`);
    if (Array.isArray(npcs) && npcs.length) cityNpcs[slug] = npcs;
  },
  'npcs   ',
);
await save('world/city-npcs.json', Buffer.from(JSON.stringify(cityNpcs, null, 1)));
stats.baixados++;
console.log(`      ${Object.keys(cityNpcs).length} locais com NPC`);

// --------------------------------------------- 2. tabelas de render + atlas

console.log('[4/5] tabelas de render, imagens do mapa-múndi e atlas de tiles');

for (const f of ['collision', 'draworder', 'offsets', 'bossCatalog']) {
  await grab(`${ORIGIN}/game/${f}.json`, `world/${f}.json`, FORCE);
}
await grab(`${ORIGIN}/game/corpses/corpses.json`, 'world/corpses.json', FORCE);

// As páginas de corpses vêm como URLs completas dentro do próprio JSON.
const corpses = JSON.parse(await readFile(join(OUT, 'world/corpses.json'), 'utf8'));
await pool(
  corpses.pages ?? [],
  (p) => grab(p.startsWith('http') ? p : ORIGIN + p, 'world/corpses/' + p.split('/').pop(), FORCE),
  'corpses',
);

for (const img of [
  '1kantoe2johto.png', '3hoenn.png', '4sinnoh.png', '5unova.png',
  '7kalos.png', '8alola.png', 'outland.png', 'marker-atlas.png', 'marker-atlas.json',
]) {
  try {
    await grab(`${ORIGIN}/assets/maps/${img}`, `site/assets/maps/${img}`, FORCE);
  } catch (err) {
    stats.falhas.push({ item: `/assets/maps/${img}`, erro: err.message });
  }
}

// Atlas de tiles: version.json → index → manifest de categoria → páginas .webp
const version = await fetchJson(`${ORIGIN}${PACK}/version.json`);
await save('asset-packs/version.json', Buffer.from(JSON.stringify(version)));
stats.baixados++;

const index = await fetchJson(packUrl(version.index));
await save(packRel(version.index), Buffer.from(JSON.stringify(index)));
stats.baixados++;

const cat = Object.values(index.categories)[0];
const manifest = await fetchJson(packUrl(cat.manifest));
await save(packRel(cat.manifest), Buffer.from(JSON.stringify(manifest)));
stats.baixados++;

const pages = Object.values(manifest.categories)[0].pages;
console.log(`      atlas map-items: ${Object.keys(manifest.assets).length} assets em ${pages.length} páginas`);
await pool(pages, (p) => grab(packUrl(p.image), packRel(p.image), FORCE), 'tiles  ');

// ------------------------------------------------------------- 3. os mapas

if (!MAPS) {
  console.log('[5/5] mapas de tiles: pulado (rode com --maps para baixar ~330 MB)');
} else {
  const alvos = MAPS === 'all' ? slugs : MAPS;
  console.log(`[5/5] mapas de tiles (${alvos.length}) — isto é o grosso do download`);
  await pool(alvos, (s) => grab(`${ORIGIN}/game/maps/${s}.json`, `world/maps/${s}.json`, FORCE), 'mapas  ', 6);
}

await save(
  'world/summary.json',
  Buffer.from(
    JSON.stringify(
      {
        origem: ORIGIN,
        baixadoEm: new Date().toISOString(),
        marcadores: markers.hunts.length,
        slugs: slugs.length,
        huntsComSpawn: comSpawn,
        locaisComNpc: Object.keys(cityNpcs).length,
        mapas: MAPS ? (MAPS === 'all' ? slugs.length : MAPS.length) : 0,
        tilesAssets: Object.keys(manifest.assets).length,
        falhas: stats.falhas,
      },
      null,
      2,
    ),
  ),
);

resumo(t0);
console.log('Agora: node tools/build-indexes.mjs');
