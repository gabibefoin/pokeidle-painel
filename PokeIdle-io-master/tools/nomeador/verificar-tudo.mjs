#!/usr/bin/env node
/** Índice + Pokédex Lab (baseline). Falha se qualquer um regredir. */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../..');

const passos = [
  ['nomeador:verificar', join(AQUI, 'verificar-indice.mjs')],
  ['pokedex-lab', join(AQUI, 'verificar-pokedex-lab.mjs')],
];

let falhou = false;
for (const [nome, script] of passos) {
  console.log(`\n→ ${nome}`);
  const r = spawnSync(process.execPath, [script], {
    cwd: RAIZ,
    env: process.env,
    stdio: 'inherit',
  });
  if (r.status !== 0) falhou = true;
}

process.exit(falhou ? 1 : 0);
