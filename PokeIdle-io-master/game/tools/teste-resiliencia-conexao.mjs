/**
 * Teste da rede de baixo das conexões: um soluço do Postgres ou do Redis NÃO derruba o processo.
 *
 * Parece um detalhe de log e não é. `Pool` do `pg` e cliente do `ioredis` são EventEmitter, e a
 * regra do Node é dura: um EventEmitter que emite `'error'` sem NENHUM ouvinte **lança** e o
 * processo morre. Sem os listeners, qualquer queda momentânea do banco ou do barramento levava
 * junto um shard inteiro — com centenas de jogadores dentro — em vez de reconectar e seguir.
 *
 * Aconteceu em produção no deploy de 04/09: recriar o container do Postgres matou os três
 * serviços na hora, com `Unhandled 'error' event: terminating connection due to administrator
 * command`. Naquele dia foi inofensivo (eles seriam reiniciados na linha seguinte do deploy),
 * mas a mesma linha derrubaria o jogo num OOM do banco às três da tarde.
 *
 * O teste EMITE o erro de verdade em cada cliente. Se algum listener sumir num refactor, este
 * arquivo não falha com uma mensagem bonita: ele morre do mesmo jeito que a produção morreria —
 * que é exatamente a demonstração que se quer.
 *
 * Não precisa de Postgres nem de Redis no ar: `pg.Pool` só conecta na primeira query e os
 * clientes do bus nascem com `lazyConnect`.
 *
 *   node tools/teste-resiliencia-conexao.mjs
 */
import { pool } from '../src/server/db.mjs';
import { pub, sub, ligarLogDeErro } from '../src/server/bus.mjs';
import { EventEmitter } from 'node:events';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

console.log('Resiliência de conexão\n======================');

secao('Todo cliente tem ouvinte de erro');
ok(pool.listenerCount('error') >= 1, 'o pool do Postgres escuta `error`', `${pool.listenerCount('error')}`);
ok(pub.listenerCount('error') >= 1, 'o publicador do Redis escuta `error`', `${pub.listenerCount('error')}`);
ok(sub.listenerCount('error') >= 1, 'o assinante do Redis escuta `error`', `${sub.listenerCount('error')}`);

secao('Emitir o erro de verdade não mata o processo');
// É o erro EXATO que a produção viu quando o container do Postgres foi recriado.
pool.emit('error', new Error('terminating connection due to administrator command'));
ok(true, 'queda de conexão ociosa do Postgres: sobreviveu');

pub.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:6380'));
sub.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:6380'));
ok(true, 'Redis fora do ar nos dois clientes: sobreviveu');

secao('A enxurrada de um Redis caído é estrangulada');
//
// Redis fora do ar emite um erro por tentativa de reconexão, várias por segundo. Sem
// estrangular, o journal do incidente vira uma parede de linhas iguais e esconde o resto.
//
// Emissor próprio e janela de 50 ms para o teste ser DETERMINÍSTICO: com os 30 s de produção,
// a rajada inteira cairia depois da primeira linha e a asserção do `+N` passaria por vacuidade
// — que é pior do que não testar, porque parece coberto.
const emissor = new EventEmitter();
ligarLogDeErro(emissor, 'teste', 50);

const linhas = [];
const erroReal = console.error;
console.error = (...a) => linhas.push(a.join(' '));
for (let i = 0; i < 500; i++) emissor.emit('error', new Error('connect ECONNREFUSED'));
console.error = erroReal;

ok(linhas.length === 1, `500 erros de uma vez viraram ${linhas.length} linha(s)`, `${linhas.length}`);
ok(
  !!linhas[0] && !/iguais/.test(linhas[0]),
  'a primeira sai na hora, sem contador (não havia nada engolido antes)',
  linhas[0] ?? '(nenhuma)',
);

// Passada a janela, a próxima linha PRESTA CONTAS do que foi engolido no meio.
await new Promise((r) => { setTimeout(r, 80); });
linhas.length = 0;
console.error = (...a) => linhas.push(a.join(' '));
emissor.emit('error', new Error('connect ECONNREFUSED'));
console.error = erroReal;

ok(linhas.length === 1 && /\+499 iguais/.test(linhas[0]), 'e a seguinte diz "+499 iguais"', linhas[0] ?? '(nenhuma)');

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
// `pool.end()` e os clientes do bus segurariam o processo aberto; nada aqui chegou a conectar.
process.exit(falhas ? 1 : 0);
