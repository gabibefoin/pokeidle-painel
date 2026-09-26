#!/usr/bin/env node
/** Relatório de dispersão de spawns por hunt. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT } from './lib.mjs';
import { metricasSpawns, carregarMapa } from './hunt-walkable.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const huntConfigs = JSON.parse(readFileSync(join(OUT, 'world/hunt-configs.json'), 'utf8'));
const walkgrids = existsSync(join(OUT, 'world/walkgrids.json'))
  ? JSON.parse(readFileSync(join(OUT, 'world/walkgrids.json'), 'utf8'))
  : { hunts: {} };
const overrides = existsSync(join(AQUI, '../game/src/server/dados/hunt-spawns-overrides.json'))
  ? JSON.parse(readFileSync(join(AQUI, '../game/src/server/dados/hunt-spawns-overrides.json'), 'utf8')).hunts ?? {}
  : {};

const linhas = [];

for (const [slug, cfg] of Object.entries(huntConfigs)) {
  const spawns = overrides[slug]?.spawns ?? cfg.spawns ?? [];
  if (!spawns.length || slug.includes('boss') || slug === 'pesca') continue;

  const mapa = carregarMapa(slug);
  const box = mapa?._meta?.walk;
  if (!box) continue;

  const mapS = Math.min(box[2] - box[0] + 1, box[3] - box[1] + 1);
  const m = metricasSpawns(spawns);
  const h = walkgrids.hunts?.[slug];
  const wpts = (h?.pontos ?? []).filter((p) => !p[3]);
  const uniq = new Set(wpts.map((p) => `${p[0]},${p[1]}`)).size;
  const dup = wpts.length > 0 && uniq < wpts.length;
  const coverage = m.spread / mapS;
  const flag = dup || m.minDist < 4 || (coverage < 0.2 && m.spread < 12);

  linhas.push({
    slug,
    count: m.count,
    minDist: +m.minDist.toFixed(2),
    spread: +m.spread.toFixed(2),
    coverage: +coverage.toFixed(3),
    dup,
    override: !!overrides[slug],
    flag,
  });
}

linhas.sort((a, b) => a.minDist - b.minDist || a.coverage - b.coverage);
const flagged = linhas.filter((l) => l.flag);

console.log(`Hunts: ${linhas.length} · sinalizadas: ${flagged.length} · overrides: ${linhas.filter((l) => l.override).length}`);
console.log('\nPiores 20:');
for (const l of flagged.slice(0, 20)) {
  console.log(
    `  ${l.slug.padEnd(22)} min=${String(l.minDist).padStart(5)} spread=${String(l.spread).padStart(5)} cov=${l.coverage}${l.dup ? ' DUP' : ''}${l.override ? ' *' : ''}`,
  );
}

const out = join(AQUI, 'nomeador/auditoria-spawns.json');
writeFileSync(out, JSON.stringify({ linhas, flagged: flagged.length }, null, 2));
console.log(`\nRelatório: ${out}`);
