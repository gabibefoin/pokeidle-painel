#!/usr/bin/env node
/**
 * Analisa e espalha spawns agrupados demais.
 *
 *   node tools/espalhar-spawns.mjs              # gera hunt-spawns-overrides.json
 *   node tools/espalhar-spawns.mjs --dry-run    # só relatório
 *   node tools/espalhar-spawns.mjs gastly aerodactyl
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT } from './lib.mjs';
import {
  tilesAndaveis,
  metricasSpawns,
  espalharPontos,
  carregarMapa,
} from './hunt-walkable.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const OVERRIDES = join(RAIZ, 'game/src/server/dados/hunt-spawns-overrides.json');
const WALKGRIDS = join(OUT, 'world/walkgrids.json');

const DRY = process.argv.includes('--dry-run');
const pedidos = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const huntConfigs = JSON.parse(readFileSync(join(OUT, 'world/hunt-configs.json'), 'utf8'));
const walkgrids = existsSync(WALKGRIDS)
  ? JSON.parse(readFileSync(WALKGRIDS, 'utf8'))
  : { hunts: {} };

function deveCorrigir(slug, cfg) {
  if (pedidos.length) return pedidos.includes(slug);
  if (['pesca', 'centro'].includes(slug) || slug.includes('boss')) return false;

  const h = walkgrids.hunts?.[slug];
  const wpts = (h?.pontos ?? []).filter((p) => !p[3]);
  if (wpts.length) {
    const uniq = new Set(wpts.map((p) => `${p[0]},${p[1]}`)).size;
    if (uniq < wpts.length) return true;
  }

  const mapa = carregarMapa(slug);
  if (!mapa?._meta?.walk || !cfg?.spawns?.length) return false;
  const box = mapa._meta.walk;
  const mapS = Math.min(box[2] - box[0] + 1, box[3] - box[1] + 1);
  const m = metricasSpawns(cfg.spawns);
  const coverage = m.spread / mapS;

  if (slug === 'aerodactyl') return true;
  if (coverage < 0.2 && m.spread < 12) return true;
  return false;
}

function reespalhar(slug, cfg) {
  const mapa = carregarMapa(slug);
  const box = mapa?._meta?.walk;
  if (!mapa || !box || !cfg?.spawns?.length) return null;

  const { tiles, inicio } = tilesAndaveis(mapa, box, cfg.start ?? null);
  if (tiles.length < cfg.spawns.length) return null;

  const pokeId = cfg.spawns[0].pokeId;
  const antes = metricasSpawns(cfg.spawns);
  const mapS = Math.min(box[2] - box[0] + 1, box[3] - box[1] + 1);
  const compacta = tiles.length < 100 && antes.spread / mapS < 0.22;
  const n = compacta
    ? Math.min(tiles.length, Math.max(cfg.spawns.length * 2, 10))
    : cfg.spawns.length;
  const pontos = espalharPontos(tiles, n, inicio);
  const spawns = pontos.map(({ x, y }) => ({ pokeId, x, y }));
  const depois = metricasSpawns(spawns);

  const melhorou = depois.minDist > antes.minDist + 0.05
    || depois.spread > antes.spread * 1.05
    || (compacta && spawns.length > cfg.spawns.length);
  if (!melhorou && !pedidos.includes(slug) && !(antes.spread < 8)) return null;

  return { spawns, antes, depois, andaveis: tiles.length };
}

const overrides = {};
const relatorio = [];

for (const [slug, cfg] of Object.entries(huntConfigs)) {
  if (!deveCorrigir(slug, cfg)) continue;
  const r = reespalhar(slug, cfg);
  if (!r) {
    relatorio.push({ slug, status: 'pulado' });
    continue;
  }
  overrides[slug] = {
    spawns: r.spawns,
    _antes: {
      minDist: +r.antes.minDist.toFixed(2),
      spread: +r.antes.spread.toFixed(2),
    },
    _depois: {
      minDist: +r.depois.minDist.toFixed(2),
      spread: +r.depois.spread.toFixed(2),
    },
  };
  relatorio.push({
    slug,
    status: 'ok',
    n: `${cfg.spawns.length} → ${r.spawns.length}`,
    min: `${r.antes.minDist.toFixed(1)} → ${r.depois.minDist.toFixed(1)}`,
    spread: `${r.antes.spread.toFixed(1)} → ${r.depois.spread.toFixed(1)}`,
    andaveis: r.andaveis,
  });
}

relatorio.sort((a, b) => (a.slug ?? '').localeCompare(b.slug ?? ''));

console.log(`Hunts analisadas para correção: ${relatorio.length}`);
for (const r of relatorio.filter((x) => x.status === 'ok')) {
  console.log(`  ✓ ${r.slug.padEnd(22)} min ${r.min}  spread ${r.spread}`);
}
const pulados = relatorio.filter((x) => x.status === 'pulado').length;
if (pulados) console.log(`  (${pulados} puladas — mapa/spawns insuficientes)`);

if (!DRY) {
  writeFileSync(
    OVERRIDES,
    `${JSON.stringify({
      _leia: 'Spawns reespalhados à mão pelo tools/espalhar-spawns.mjs. Sobrescreve hunt-configs no build.',
      gerado: new Date().toISOString(),
      hunts: overrides,
    }, null, 2)}\n`,
  );
  console.log(`\nGravado: ${OVERRIDES} (${Object.keys(overrides).length} hunts)`);
  console.log('Próximo: npm run walkgrids && npm run indexes');
} else {
  console.log('\n(dry-run — nada gravado)');
}
