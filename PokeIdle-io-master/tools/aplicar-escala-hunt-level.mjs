#!/usr/bin/env node
/**
 * Recalcula huntLevel de gen 3–9 pela escada evolutiva e atualiza:
 *   - game/src/server/dados/creatures-novos.json
 *   - game/src/server/dados/spawns-editor.json (marcadores existentes)
 *   - game/src/server/dados/hunts-sinnoh.json
 *
 * ATENÇÃO ao `evolveLevel` que ele grava: `aplicarEscalaHuntLevel` escreve nele o `huntLevel`
 * do próximo estágio (Zigzagoon → 650), e esse número NÃO é o que o jogo cobra desde o teto de
 * captura. No boot, as duas pontas rodam `aplicarTetoDeCaptura` por cima e Outland+ passa a
 * pedir o teto do destino (20/40/100 — ver `shared/teto-captura.mjs`). O que fica no JSON é
 * insumo do gerador, não a regra: quem quiser saber o degrau de verdade lê a Pokédex do jogo
 * ou roda `npm run auditar:teto` dentro de `game/`.
 *
 *   node tools/aplicar-escala-hunt-level.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { herdarLooktypeOrre } from '../game/src/shared/herdar-looktype-orre.mjs';
import { herdarLooktypeOutland } from '../game/src/shared/herdar-looktype-outland.mjs';
import {
  aplicarEscalaHuntLevel,
  dexDe,
  relatorioTiposPorNivel,
  huntLevelDoDex,
  montarCadeias,
} from '../game/src/shared/escala-hunt-level.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DADOS = join(RAIZ, 'game/src/server/dados');
const CREATURES_NOVOS = join(DADOS, 'creatures-novos.json');
const SPAWNS_EDITOR = join(DADOS, 'spawns-editor.json');
const HUNTS_SINNOH = join(DADOS, 'hunts-sinnoh.json');
const CREATURES_BASE = join(RAIZ, 'public/data/creatures.json');
const SPRITES_LAB = join(DADOS, 'creatures-sprites-lab.json');

const creaturesNovos = JSON.parse(readFileSync(CREATURES_NOVOS, 'utf8'));
const lista = creaturesNovos.creatures ?? [];
const base = JSON.parse(readFileSync(CREATURES_BASE, 'utf8')).creatures ?? [];
const patches = JSON.parse(readFileSync(SPRITES_LAB, 'utf8')).patches ?? [];
const merge = [...base, ...lista];
for (const p of patches) {
  const c = merge.find((x) => x.pokeId === p.pokeId);
  if (c && p.looktype) c.looktype = p.looktype;
}
herdarLooktypeOrre(merge);
herdarLooktypeOutland(merge);

const { porDexNivel, cadeias } = aplicarEscalaHuntLevel(lista, undefined, merge);

writeFileSync(CREATURES_NOVOS, JSON.stringify(creaturesNovos, null, 2), 'utf8');

// spawns-editor — só atualiza nivel dos marcadores já posicionados
const spawns = JSON.parse(readFileSync(SPAWNS_EDITOR, 'utf8'));
let marcAtualizados = 0;
for (const reg of Object.values(spawns.regioes ?? {})) {
  for (const m of reg.marcadores ?? []) {
    const n = porDexNivel.get(m.dex) ?? porDexNivel.get(dexDe(m.pokeId));
    if (n && m.nivel !== n) {
      m.nivel = n;
      marcAtualizados++;
    }
  }
}
writeFileSync(SPAWNS_EDITOR, JSON.stringify(spawns, null, 2), 'utf8');

// hunts-sinnoh — espécies de qualquer geração na escada de Sinnoh (gate 1000)
const sinnoh = JSON.parse(readFileSync(HUNTS_SINNOH, 'utf8'));
let sinnohAtualizados = 0;
for (const h of sinnoh.hunts ?? []) {
  const dex = dexDe(h.pokeId);
  const n = huntLevelDoDex(dex, cadeias, undefined, 1000, 5000);
  if (n && h.nivel !== n) {
    h.nivel = n;
    sinnohAtualizados++;
  }
}
writeFileSync(HUNTS_SINNOH, JSON.stringify(sinnoh, null, 2), 'utf8');

console.log(`creatures-novos: ${porDexNivel.size} dex com huntLevel`);
console.log(`spawns-editor: ${marcAtualizados} marcadores atualizados`);
console.log(`hunts-sinnoh: ${sinnohAtualizados} hunts atualizadas`);

console.log('\nHoenn — tipos por nível (meta para balancear marcadores no mapa):');
const hoenn = relatorioTiposPorNivel(
  new Map([...porDexNivel].filter(([d]) => d >= 252 && d <= 386)),
  cadeias,
);
for (const [nivel, tipos] of hoenn) {
  const resumo = Object.entries(tipos).sort((a, b) => b[1] - a[1]).map(([t, q]) => `${t}:${q}`).join(' ');
  console.log(`  Nv ${nivel} → ${resumo}`);
}

console.log('\nAmostra Hoenn:');
for (const nome of ['Treecko', 'Grovyle', 'Sceptile', 'Sharpedo', 'Magikarp', 'Gyarados']) {
  const c = lista.find((x) => x.name === nome && x.pokeId < 1000);
  if (c) console.log(`  ${nome}: Nv ${c.huntLevel}${c.evolveLevel ? ` (evolui Nv ${c.evolveLevel})` : ''}`);
}
