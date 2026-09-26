// `xpTotalParaNivel` lembrada por nível devolve exatamente o que a fórmula devolve.
//
//     node tools/teste-xp-nivel.mjs
import { xpTotalParaNivel, nivelPeloXp } from '../src/server/content.mjs';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

const formula = (L) => (L <= 1 ? 0 : Math.round((50 / 3) * (L ** 3 - 6 * L ** 2 + 17 * L - 12)));

console.log('XP POR NÍVEL LEMBRADO\n=====================');
const valores = [];
for (let L = -20; L <= 12000; L++) valores.push(L);
valores.push(0.5, 1.5, 99.99, 8191, 8192, 8193, -0, Number.MAX_SAFE_INTEGER, NaN, Infinity);
let diferentes = 0;
let exemplo = '';
for (const rodada of [1, 2]) { // a segunda rodada lê o que a primeira lembrou
  for (const L of valores) {
    const a = xpTotalParaNivel(L);
    const b = formula(L);
    if (!Object.is(a, b) && !(Number.isNaN(a) && Number.isNaN(b))) {
      diferentes++;
      if (!exemplo) exemplo = `rodada ${rodada}, L=${L}: ${a} ≠ ${b}`;
    }
  }
}
ok(diferentes === 0, `${valores.length * 2} consultas (inclusive negativos, frações, fora da faixa, NaN): idênticas à fórmula`, exemplo);

let nivelDiferente = 0;
for (let xp = 0; xp < 5e9; xp += 7919 * 1301) {
  let L = 1;
  while (formula(L + 1) <= xp) L++;
  if (nivelPeloXp(xp) !== L) nivelDiferente++;
}
ok(nivelDiferente === 0, 'nivelPeloXp continua achando o mesmo nível');

const t0 = performance.now();
let soma = 0;
for (let i = 0; i < 2e6; i++) soma += formula(1 + (i % 300));
const msFormula = performance.now() - t0;
const t1 = performance.now();
for (let i = 0; i < 2e6; i++) soma -= xpTotalParaNivel(1 + (i % 300));
const msMemo = performance.now() - t1;
console.log(`  2 milhões de consultas: fórmula ${msFormula.toFixed(0)} ms · lembrada ${msMemo.toFixed(0)} ms`);
ok(soma === 0, 'a soma das duas bate');

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
