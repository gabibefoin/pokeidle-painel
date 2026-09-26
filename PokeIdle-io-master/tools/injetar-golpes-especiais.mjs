#!/usr/bin/env node
/**
 * Injeta golpes de assinatura (600) nas últimas evoluções Hoenn+.
 *
 *   node tools/injetar-golpes-especiais.mjs
 *   node tools/injetar-golpes-especiais.mjs --dry
 *
 * Altera:
 *   - public/data/creatures.json (Hoenn no espelho — ex.: Blaziken, Sceptile)
 *   - game/src/server/dados/creatures-novos.json (Sinnoh em diante)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dexDe,
  elegivelParaGolpeEspecial,
  injetarGolpesEspeciais,
  temGolpe600DoTipo,
} from '../game/src/shared/golpes-especiais.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRE_BASE = join(RAIZ, 'public/data/creatures.json');
const CRE_NOVOS = join(RAIZ, 'game/src/server/dados/creatures-novos.json');
const dry = process.argv.includes('--dry');

function processarArquivo(caminho, rotulo) {
  if (!existsSync(caminho)) {
    console.warn(`[golpes] ${rotulo}: arquivo não encontrado (${caminho})`);
    return { alterados: 0, aindaFaltando: 0 };
  }

  const doc = JSON.parse(readFileSync(caminho, 'utf8'));
  let alterados = 0;
  let aindaFaltando = 0;

  for (const c of doc.creatures) {
    if (injetarGolpesEspeciais(c)) alterados++;
    if (!elegivelParaGolpeEspecial(c)) continue;
    const tipos = [...new Set([c.type1, c.type2].filter(Boolean))];
    const ok = tipos.every((t) => temGolpe600DoTipo(c.attacks, t));
    if (!ok) aindaFaltando++;
  }

  if (!dry) {
    writeFileSync(caminho, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  }

  console.log(`[golpes] ${rotulo}: ${alterados} espécies alteradas, ${aindaFaltando} ainda sem 600 completo`);
  return { alterados, aindaFaltando };
}

const base = processarArquivo(CRE_BASE, 'creatures.json (espelho)');
const novos = processarArquivo(CRE_NOVOS, 'creatures-novos.json');

if (dry) {
  console.log('(dry-run — nada gravado)');
} else {
  console.log('\nPróximo passo em produção:');
  console.log('  1. git push (creatures-novos.json vai no deploy normal)');
  console.log('  2. scp public/data/creatures.json para a VPS (ver game/HOSPEDAGEM.md / infra/deploy-public-data.ps1)');
}

// Amostra rápida
const amostra = ['Blaziken', 'Sceptile', 'Swampert', 'Metagross', 'Torterra', 'Garchomp', 'Greninja'];
const all = [
  ...(existsSync(CRE_BASE) ? JSON.parse(readFileSync(CRE_BASE, 'utf8')).creatures : []),
  ...(existsSync(CRE_NOVOS) ? JSON.parse(readFileSync(CRE_NOVOS, 'utf8')).creatures : []),
];
for (const nome of amostra) {
  const c = all.find((x) => x.name === nome);
  if (!c) continue;
  const sig = (c.attacks ?? []).filter((a) => a.power >= 600).map((a) => `${a.name}/${a.type}`).join(', ');
  console.log(`  ${nome}: ${sig || '(sem 600)'}`);
}

process.exit(base.aindaFaltando + novos.aindaFaltando > 0 ? 1 : 0);
