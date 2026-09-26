// Variantes Outland (#2001+) herdam sprite de Kanto/Johto — ex.: Brave Blastoise usa Blastoise.
//
//   node game/tools/teste-outland-sprites.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { herdarLooktypeOutland } from '../src/shared/herdar-looktype-outland.mjs';
import { dexSpriteBaseOutland } from '../src/shared/outland-sprite-dex.mjs';
import { isOutlandPokeId } from '../src/shared/outland.mjs';
import { especies } from '../src/server/content.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../..');
const patches = JSON.parse(
  readFileSync(join(RAIZ, 'game/src/server/dados/creatures-sprites-lab.json'), 'utf8'),
).patches ?? [];

let ok = 0;
let fail = 0;
const erros = [];

for (const [pokeId, esp] of especies) {
  if (!isOutlandPokeId(pokeId)) continue;
  const baseDex = dexSpriteBaseOutland(pokeId, esp.name);
  const base = especies.get(baseDex);
  if (!baseDex || !base) {
    fail++;
    erros.push(`${pokeId} ${esp.name}: base dex ${baseDex} ausente`);
    continue;
  }
  if (esp.looktype !== base.looktype) {
    fail++;
    erros.push(`${esp.name}: looktype ${esp.looktype} ≠ ${base.name} (${base.looktype})`);
    continue;
  }
  ok++;
}

// Patches JSON também apontam pro looktype certo (60000+dex nacional).
for (const p of patches) {
  if (!isOutlandPokeId(p.pokeId)) continue;
  const baseDex = dexSpriteBaseOutland(p.pokeId, p.name);
  const esperado = 60000 + baseDex;
  if (p.looktype !== esperado) {
    fail++;
    erros.push(`patch ${p.name}: ${p.looktype} ≠ ${esperado}`);
  }
}

// herdarLooktypeOutland funciona isolado (cliente carrega patches + herda).
const lista = [...especies.values()].map((c) => ({ ...c }));
for (const p of patches) {
  const c = lista.find((x) => x.pokeId === p.pokeId);
  if (c && p.looktype) c.looktype = p.looktype;
}
herdarLooktypeOutland(lista);
for (const esp of lista) {
  if (!isOutlandPokeId(esp.pokeId)) continue;
  const baseDex = dexSpriteBaseOutland(esp.pokeId, esp.name);
  const base = lista.find((x) => x.pokeId === baseDex);
  if (esp.looktype !== base?.looktype) {
    fail++;
    erros.push(`herdar ${esp.name}: ${esp.looktype} ≠ ${base?.looktype}`);
  }
}

// Exemplo pedido pelo jogador.
const braveBlastoise = especies.get(2001);
const blastoise = especies.get(9);
if (braveBlastoise?.looktype !== blastoise?.looktype) {
  fail++;
  erros.push('Brave Blastoise não usa sprite de Blastoise');
} else {
  ok++;
}

console.log(`OUTLAND SPRITES — ${ok} ok · ${fail} falha(s)\n`);
for (const e of erros) console.log(`  ✗ ${e}`);
process.exitCode = fail ? 1 : 0;
