// Teste do AUTO LOCK N+ — sem banco e sem Redis.
//
// A nota do cadeado automático passou a ser escolhida pelo jogador e chega do cliente
// (`shop.autoLockNota9 { ativo, nota }`). Este teste protege:
//   · `notaAutoLockValida` só aceita `number` de verdade entre 0 e 10, arredondado às 3 casas
//     do N= — texto, array, booleano, NaN, Infinity e fora da escala viram `null`;
//   · o handler do servidor entrega `m.nota` CRUA ao validador (sem `Number()` no caminho) e
//     recusa ANTES de gravar;
//   · a carga do jsonb passa pelo mesmo validador e cai no padrão;
//   · a regra de trava lê a nota DO JOGADOR, e não mais a constante fixa.
//
//   node tools/teste-auto-lock-nota.mjs
import { readFileSync } from 'node:fs';
import { AUTO_LOCK_NOTA_MIN, notaAutoLockValida } from '../src/shared/nota-pokemon.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

console.log('AUTO LOCK N+ — a nota escolhida pelo jogador\n============================================');

secao('Notas válidas passam, com 3 casas');
for (const [v, esperado] of [[0, 0], [1, 1], [2, 2], [3.2, 3.2], [3.5, 3.5], [5, 5], [10, 10], [3.2144, 3.214], [3.2146, 3.215]]) {
  ok(notaAutoLockValida(v) === esperado, `${v} → ${esperado}`, String(notaAutoLockValida(v)));
}
ok(AUTO_LOCK_NOTA_MIN === 3.5 && notaAutoLockValida(AUTO_LOCK_NOTA_MIN) === 3.5, 'o padrão (3,5) é uma nota válida');

secao('Lixo vira null — nunca é convertido');
for (const [v, nome] of [
  [-0.1, '−0,1'], [-40, '−40'], [10.001, '10,001'], [11, '11'], [1e9, '1e9'],
  [Number.NaN, 'NaN'], [Number.POSITIVE_INFINITY, 'Infinity'], [Number.NEGATIVE_INFINITY, '−Infinity'],
  ['3.2', 'string "3.2"'], ['3,2', 'string "3,2"'], ['', 'string vazia'], [[3.2], 'array [3.2]'],
  [{ valueOf: () => 3.2 }, 'objeto com valueOf'], [null, 'null'], [undefined, 'undefined'], [true, 'true'],
]) {
  ok(notaAutoLockValida(v) === null, `${nome} → null`, String(notaAutoLockValida(v)));
}
for (const bruto of ['{"nota":-5}', '{"nota":"3.2"}', '{"nota":1e400}', '{"nota":[3]}', '{"nota":null}']) {
  ok(notaAutoLockValida(JSON.parse(bruto).nota) === null, `mensagem crua ${bruto} → recusada`);
}

secao('O servidor usa o validador nos dois caminhos');
{
  const fonte = readFileSync(new URL('../src/server/sim.mjs', import.meta.url), 'utf8');
  const ini = fonte.indexOf("'shop.autoLockNota9':");
  const handler = ini >= 0 ? fonte.slice(ini, fonte.indexOf('\n  },', ini)) : '';
  ok(handler.length > 0, 'achei o handler shop.autoLockNota9');
  ok(/notaAutoLockValida\(m\.nota\)/.test(handler), 'o handler passa m.nota pelo validador');
  ok(!/Number\(\s*m\??\.nota/.test(handler) && !/parse(Float|Int)\(\s*m\??\.nota/.test(handler), 'nenhum Number()/parseFloat() em m.nota antes do validador');
  ok(handler.indexOf('nota == null') >= 0 && handler.indexOf('nota == null') < handler.indexOf('autoLockNotaMin = nota'), 'a recusa vem ANTES de gravar a nota');
  ok(/autoLockNotaMin: notaAutoLockValida\(jogador\.automation\?\.autoLockNotaMin\) \?\? AUTO_LOCK_NOTA_MIN/.test(fonte), 'a carga do banco passa pelo validador e cai no padrão');
  const regra = fonte.slice(fonte.indexOf('function pokemonPassaAutoLockNota'), fonte.indexOf('function travarTodosNota9'));
  ok(/notaAutoLockDe\(p\)/.test(regra) && !/AUTO_LOCK_NOTA_MIN/.test(regra), 'a regra de trava lê a nota do jogador, não a constante');
}

console.log(`\n${testes - falhas}/${testes} ok`);
if (falhas) {
  console.log(`${falhas} falha(s)`);
  process.exit(1);
}
