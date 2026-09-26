/**
 * Monta pools de mapas de batalha por tipo primário (Kanto + Johto + Outland)
 * e sorteia `fonte` para os pokémon do spawns-editor (Hoenn em diante).
 *
 *   node tools/sortear-mapas-por-tipo.mjs           aplica (RNG estável por dex)
 *   node tools/sortear-mapas-por-tipo.mjs --dry      só mostra o plano
 *   node tools/sortear-mapas-por-tipo.mjs --seed=42  ressorteia com outra semente
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontePorTipo } from './nomeador/spawns-filtro.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKERS = join(RAIZ, 'public/data/world/map-markers.json');
const WALKGRIDS = join(RAIZ, 'public/data/world/walkgrids.json');
const CREATURES = join(RAIZ, 'public/data/creatures.json');
const SPAWNS_EDITOR = join(RAIZ, 'game/src/server/dados/spawns-editor.json');
const MAPAS_EDITOR = join(RAIZ, 'game/src/server/dados/mapas-editor.json');
const MAPAS_POOLS = join(RAIZ, 'game/src/server/dados/mapas-pools.json');

const REGIOES_ALVO = ['hoenn', 'sinnoh', 'unova', 'kalos', 'alola'];
const AREAS_POOL = new Set(['kanto', 'outland']);
const CIDADES = new Set(['cerulean', 'pewter', 'viridian', 'cassino']);

const PREFIXOS = [
  'brave', 'furious', 'ancient', 'enraged', 'evil', 'freezing', 'heavy', 'milch',
  'roll', 'hard', 'brute', 'dark', 'trickmaster', 'banshee', 'enigmatic', 'charged',
  'magnetic', 'psy', 'tribal', 'war', 'taekwondo',
];

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const seedArg = argv.find((a) => a.startsWith('--seed='));
const SEED = seedArg ? Number(seedArg.split('=')[1]) : 20260813;

function rngDex(dex, salt = 0) {
  let s = ((dex * 7919 + salt * 104729 + SEED * 9973) >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function stripSlug(slug) {
  let s = slug;
  for (const p of PREFIXOS) {
    if (s.startsWith(`${p}_`)) s = s.slice(p.length + 1);
  }
  return s;
}

function normNome(n) {
  return n.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function montarPools() {
  const markers = JSON.parse(readFileSync(MARKERS, 'utf8'));
  const walk = JSON.parse(readFileSync(WALKGRIDS, 'utf8')).hunts;
  const cre = JSON.parse(readFileSync(CREATURES, 'utf8')).creatures;
  const byLook = new Map(cre.map((c) => [c.looktype, c]));
  const byNome = new Map(cre.map((c) => [normNome(c.name), c]));

  const tipoPorSlug = {};
  const pools = {};

  for (const h of markers.hunts ?? []) {
    if (!AREAS_POOL.has(h.area)) continue;
    if (!walk[h.slug]?.grid?.length) continue;
    if (CIDADES.has(h.slug)) continue;

    let c = byLook.get(h.looktype);
    if (!c) c = byNome.get(stripSlug(h.slug).replace(/_/g, ''));
    const tipo = c?.type1;
    if (!tipo) {
      console.warn(`[pool] tipo desconhecido: ${h.slug}`);
      continue;
    }

    tipoPorSlug[h.slug] = tipo;
    (pools[tipo] ??= []).push(h.slug);
  }

  for (const t of Object.keys(pools)) pools[t].sort((a, b) => a.localeCompare(b));
  return { pools, tipoPorSlug };
}

function escolherFonte(dex, tipo, pools) {
  const lista = pools[tipo];
  if (lista?.length) {
    const rand = rngDex(dex, 17);
    return lista[Math.floor(rand() * lista.length)];
  }
  return fontePorTipo(tipo);
}

function main() {
  const { pools, tipoPorSlug } = montarPools();
  const spawns = JSON.parse(readFileSync(SPAWNS_EDITOR, 'utf8'));
  const porDex = {};
  const log = [];

  for (const regId of REGIOES_ALVO) {
    const reg = spawns.regioes?.[regId];
    if (!reg) continue;
    for (const m of reg.marcadores ?? []) {
      const tipo = m.tipo || 'NORMAL';
      const fonte = escolherFonte(m.dex, tipo, pools);
      porDex[String(m.dex)] = fonte;
      m.fonte = fonte;
      log.push({
        regiao: regId,
        dex: m.dex,
        nome: m.nome,
        tipo,
        fonte,
        pool: pools[tipo]?.length ?? 0,
      });
    }
  }

  const resumoPool = Object.fromEntries(
    Object.entries(pools)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, arr]) => [t, { total: arr.length, exemplos: arr.slice(0, 5) }]),
  );

  console.log(`\nPools (Kanto + Outland) · seed ${SEED}`);
  for (const [t, info] of Object.entries(resumoPool)) {
    console.log(`  ${t.padEnd(10)} ${String(info.total).padStart(3)} mapas · ex.: ${info.exemplos.join(', ')}`);
  }
  console.log(`\nSorteados: ${log.length} marcadores (${REGIOES_ALVO.join(', ')})`);

  if (dry) {
    console.log('\n--dry · primeiros 12:');
    for (const row of log.slice(0, 12)) {
      console.log(`  #${row.dex} ${row.nome} (${row.tipo}) → ${row.fonte} [pool ${row.pool}]`);
    }
    return;
  }

  writeFileSync(
    MAPAS_POOLS,
    JSON.stringify({ seed: SEED, areas: [...AREAS_POOL], pools, tipoPorSlug }, null, 2),
    'utf8',
  );
  writeFileSync(
    MAPAS_EDITOR,
    JSON.stringify({
      _leia: 'Mapa de batalha (fonte de tiles) por dex — sorteado por tools/sortear-mapas-por-tipo.mjs ou editado em mapas.html. Valor = slug da hunt espelho (ex.: abra). Posição regional continua no spawns-editor.json.',
      porDex,
    }, null, 2),
    'utf8',
  );
  writeFileSync(SPAWNS_EDITOR, JSON.stringify(spawns, null, 2), 'utf8');

  console.log(`\nGravado:`);
  console.log(`  ${MAPAS_POOLS}`);
  console.log(`  ${MAPAS_EDITOR}`);
  console.log(`  ${SPAWNS_EDITOR}`);
}

main();
