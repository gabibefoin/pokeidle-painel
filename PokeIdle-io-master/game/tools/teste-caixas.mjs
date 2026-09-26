// Ensaio das CAIXAS DE FUNDADOR contra o Postgres local.
//
//     npm run test:caixas
//
// O que ele cobre é exatamente o que não dá para conferir lendo o código: a numeração sob
// corrida, os dois tetos (o do mundo e o de uma por conta), a abertura junto do crédito no
// ledger, e as três passagens da caixa pelo Mercado (escrow, cancelamento e troca de dono).
// Tudo o mais das caixas é regra pura e mora em `shared/caixas-beta.mjs` — a parte pura que
// vale um teste (a tag que segue a roupa) fecha o arquivo, sem banco.
//
// ### Por que ele mexe no banco de verdade
//
// Porque o que se está testando É o banco: `pg_advisory_xact_lock` por tipo, `UNIQUE (tipo,
// serie)`, `FOR UPDATE` na abertura e o `WHERE aberta_em IS NULL` que impede abrir duas vezes.
// Um dublê de banco testaria o dublê.
//
// Roda em quatro jogadores próprios (`__cxteste*`) e apaga tudo o que criou no fim — inclusive
// as linhas de `caixas_beta`, para o teto não ser consumido a cada execução.
import { pool } from '../src/server/db.mjs';
import * as cxdb from '../src/server/caixas-db.mjs';
import * as mdb from '../src/server/market-db.mjs';
import * as ddb from '../src/server/diamantes-db.mjs';
import {
  CAIXAS_BETA, LOOKTYPE_FUNDADOR, LOOKTYPE_COFUNDADOR,
  rotuloSerie, tagDoLooktype,
} from '../src/shared/caixas-beta.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, msg) => {
  testes++;
  if (!cond) falhas++;
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
};
const secao = (s) => console.log(`\n${s}`);

const NICKS = ['__cxtestea', '__cxtesteb', '__cxtestec', '__cxtested'];

async function jogadorDeTeste(nick) {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, xp, gold, hunt_slug)
     VALUES ($1, 1, 0, 0, 'route-1')
     ON CONFLICT (nick) DO UPDATE SET level = 1
     RETURNING id`,
    [nick],
  );
  return Number(rows[0].id);
}

async function limpar(ids) {
  await pool.query(`DELETE FROM market_anuncios WHERE vendedor_id = ANY($1::bigint[])`, [ids]);
  await pool.query(`DELETE FROM caixas_beta WHERE comprador = ANY($1::text[])`, [NICKS]);
  await pool.query(`DELETE FROM diamante_ledger WHERE player_id = ANY($1::bigint[])`, [ids]);
}

/** Compra que devolve a MENSAGEM de erro em vez de estourar — o teste quer ler a recusa. */
const recusa = (fn) => fn.then(() => null, (e) => e.message);

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.log(`Postgres indisponível (${err.message}) — suba com \`npm run infra\`.`);
  process.exit(1);
}

await cxdb.migrar();
await mdb.migrar();
await ddb.migrar();

const [a, b, c, d] = await Promise.all(NICKS.map(jogadorDeTeste));
const ids = [a, b, c, d];
await limpar(ids);
await pool.query(`UPDATE players SET diamonds = 0 WHERE id = ANY($1::bigint[])`, [ids]);

const comprar = (playerId, nick, tipo) => cxdb.comprarCaixa({ playerId, nick, tipo });

secao('Numeração');
const base = await cxdb.vendidas();
const c1 = await comprar(a, NICKS[0], 'fundador');
const c2 = await comprar(b, NICKS[1], 'fundador');
ok(c2.serie === c1.serie + 1, `a segunda vem logo depois da primeira (#${c1.serie} → #${c2.serie})`);
ok(c1.nome.includes(rotuloSerie('fundador', c1.serie)), `o nome traz o número com os zeros (${c1.nome})`);
const depois = await cxdb.vendidas();
ok(depois.fundador === base.fundador + 2, 'o contador de vendidas subiu 2');

const p1 = await comprar(a, NICKS[0], 'cofundador');
const p2 = await comprar(b, NICKS[1], 'cofundador');
ok(p1.serie !== p2.serie, 'os dois tipos numeram em séries separadas');

secao('Corrida — duas compras ao mesmo tempo');
// É o caso que o `pg_advisory_xact_lock` existe para resolver: sem ele as duas transações
// leem o mesmo `MAX(serie)` e uma delas estoura no UNIQUE (ou, pior, o número se repete).
const [r1, r2] = await Promise.all([
  comprar(c, NICKS[2], 'cofundador'),
  comprar(d, NICKS[3], 'cofundador'),
]);
ok(r1.serie !== r2.serie, `compras simultâneas não dividem o número (#${r1.serie} / #${r2.serie})`);

secao('Uma por jogador — a trava do balcão');
ok(await recusa(comprar(a, NICKS[0], 'fundador')) === 'caixas.jaComprou',
  'a segunda Caixa de Fundador da mesma conta é recusada');
ok(await recusa(comprar(a, NICKS[0], 'cofundador')) === 'caixas.jaComprou',
  'e a segunda de CoFundador também');
const compras = await cxdb.comprasDoJogador(a);
ok(compras.fundador === 1 && compras.cofundador === 1,
  'o contador por conta vê uma de cada');
// A trava é por TIPO, não uma caixa no total: quem levou a de Fundador ainda leva a de
// CoFundador. É o que `b` acabou de fazer lá em cima, e vale a pena deixar dito.
ok((await cxdb.comprasDoJogador(b)).fundador === 1, 'e a de um tipo não trava a do outro');
// Dois cliques SIMULTÂNEOS do mesmo jogador: o lock por tipo serializa, e o segundo lê o
// primeiro já gravado. Sem essa serialização, os dois passariam.
const dobro = await Promise.all([
  recusa(comprar(c, NICKS[2], 'fundador')),
  recusa(comprar(c, NICKS[2], 'fundador')),
]);
ok(dobro.filter((x) => x === null).length === 1 && dobro.includes('caixas.jaComprou'),
  'dois cliques ao mesmo tempo: só UM passa');

secao('Bolsa');
ok((await cxdb.caixasDoJogador(a)).length === 2, 'as duas caixas de A estão na bolsa dele');
ok((await cxdb.caixasDoJogador(b)).length === 2, 'e as duas de B na dele');

secao('Abrir');
const saldoAntes = Number(
  (await pool.query('SELECT diamonds FROM players WHERE id = $1', [a])).rows[0].diamonds,
);
const r = await cxdb.abrirCaixa({ id: c1.id, playerId: a, nick: NICKS[0] });
ok(r.diamantes === CAIXAS_BETA.fundador.diamantes, `devolveu ${r.diamantes} diamantes`);
ok(r.saldo === saldoAntes + r.diamantes, 'e o saldo subiu exatamente isso');
const ledger = await pool.query(
  `SELECT motivo, delta FROM diamante_ledger WHERE player_id = $1 ORDER BY id DESC LIMIT 1`, [a],
);
ok(
  ledger.rows[0]?.motivo === 'caixa_beta' && Number(ledger.rows[0].delta) === r.diamantes,
  'o ledger registrou a emissão com o motivo certo',
);
ok((await cxdb.tagsDoJogador(a)).some((t) => t.serie === c1.serie), 'a tag ficou com quem abriu');
ok((await cxdb.caixasDoJogador(a)).length === 1, 'e a caixa saiu da bolsa');
// Abrir NÃO devolve a vaga do balcão: a caixa foi comprada, e é isso que a trava conta.
ok(await recusa(comprar(a, NICKS[0], 'fundador')) === 'caixas.jaComprou',
  'abrir a sua não libera comprar outra na Loja');

ok(await recusa(cxdb.abrirCaixa({ id: c1.id, playerId: a, nick: NICKS[0] })) === 'caixas.jaAberta',
  'abrir de novo é recusado');
ok(await recusa(cxdb.abrirCaixa({ id: c2.id, playerId: a, nick: NICKS[0] })) === 'caixas.naoSua',
  'abrir a caixa dos outros é recusado');

secao('Mercado — escrow, cancelar e vender');
const anunciar = (vendedorId, vendedor, caixa, tipo) => mdb.criarAnuncio({
  vendedorId, vendedor, tipo: 'item',
  itemId: CAIXAS_BETA[tipo].itemId, qtd: 1, caixaId: caixa.id,
  ficha: {
    nome: CAIXAS_BETA[tipo].nome, caixaId: caixa.id, caixaTipo: tipo, serie: caixa.serie,
  },
  preco: 5000, moeda: 'gold', dias: null,
});
/** A retenção anti multi-conta (2 min) sai do caminho: aqui o que se testa é a entrega. */
const destravar = (id) => pool.query(
  `UPDATE market_anuncios SET compravel_em = now() - interval '1 minute' WHERE id = $1`, [id],
);

const anuncioP2 = await anunciar(b, NICKS[1], p2, 'cofundador');
ok((await cxdb.caixasDoJogador(b)).length === 1, 'anunciar tira a caixa da bolsa (escrow)');
ok(await recusa(cxdb.abrirCaixa({ id: p2.id, playerId: b, nick: NICKS[1] })) === 'caixas.emAnuncio',
  'e não dá para abrir uma caixa anunciada');

await destravar(anuncioP2.id);
const compra = await mdb.comprarAnuncio({
  id: anuncioP2.id, compradorId: a, comprador: NICKS[0], qtd: 1, preco: 5000, moeda: 'gold',
});
ok(compra.anuncio.ficha.caixaId === p2.id, 'a compra entrega a caixa anunciada');
ok((await cxdb.caixasDoJogador(a)).some((x) => x.id === p2.id), 'ela aparece na bolsa do comprador');
ok(!(await cxdb.caixasDoJogador(b)).some((x) => x.id === p2.id), 'e sai da do vendedor');
const recibo = await pool.query(
  `SELECT descricao FROM market_pagamentos WHERE anuncio_id = $1`, [anuncioP2.id],
);
ok(
  (recibo.rows[0]?.descricao ?? '').includes(rotuloSerie('cofundador', p2.serie)),
  `o recibo do vendedor traz o número (${recibo.rows[0]?.descricao})`,
);
// O Mercado é livre: `a` agora tem DUAS caixas de CoFundador. O que ele não pode é comprar a
// segunda no BALCÃO — e vender/comprar por fora não mexe nesse contador.
ok((await cxdb.comprasDoJogador(a)).cofundador === 1,
  'comprar no Mercado não conta para o teto da Loja');
ok(await recusa(comprar(a, NICKS[0], 'cofundador')) === 'caixas.jaComprou',
  'e continua não podendo comprar outra na Loja');
ok((await cxdb.comprasDoJogador(b)).cofundador === 1,
  'vender a sua também não devolve a vaga do vendedor');
ok(await recusa(comprar(b, NICKS[1], 'cofundador')) === 'caixas.jaComprou',
  'quem vendeu a sua não compra outra no balcão');

// Duas caixas do MESMO tipo, mesmo vendedor e mesmo preço: item comum empilharia numa linha
// só (ver `criarAnuncio`), e é justamente o que a caixa não pode fazer — a pilha apagaria o
// número, que é a mercadoria. Só dá para chegar aqui pelo Mercado, e é o que acabou de acontecer.
const an1 = await anunciar(a, NICKS[0], p1, 'cofundador');
const an2 = await anunciar(a, NICKS[0], p2, 'cofundador');
ok(an1.id !== an2.id && an2.qtd === 1, 'duas caixas iguais NÃO empilham num anúncio');

const cancelado = await mdb.cancelarAnuncio({ id: an2.id, vendedorId: a });
ok(cancelado.ficha.caixaId === p2.id, 'cancelar devolve a caixa certa');
ok((await cxdb.caixasDoJogador(a)).some((x) => x.id === p2.id), 'e ela volta para a bolsa');

secao('Teto do mundo');
const atual = await cxdb.vendidas();
await pool.query(
  `INSERT INTO caixas_beta (tipo, serie, dono_id, comprador_id, comprador)
   SELECT 'fundador', s, $1, $1, $2 FROM generate_series($3::int, $4::int) s`,
  [d, NICKS[3], atual.fundador + 1, CAIXAS_BETA.fundador.limite],
);
// `d` ainda não tinha comprado Fundador, então o que o barra aqui é o teto do MUNDO — e é
// isso que este caso precisa separar do "já comprou".
ok(await recusa(comprar(d, NICKS[3], 'fundador')) === 'esgotada',
  `passado o limite de ${CAIXAS_BETA.fundador.limite}, a Loja recusa`);

secao('A tag segue a roupa (sem banco)');
const tags = [{ tipo: 'fundador', serie: 7 }, { tipo: 'cofundador', serie: 3 }];
ok(tagDoLooktype(tags, LOOKTYPE_COFUNDADOR)?.tipo === 'cofundador',
  'vestindo a skin de CoFundador, a tag é a de CoFundador');
ok(tagDoLooktype(tags, LOOKTYPE_FUNDADOR)?.tipo === 'fundador',
  'trocou para a de Fundador, a tag acompanha');
ok(tagDoLooktype(tags, 159)?.tipo === 'fundador',
  'com qualquer outra roupa vale a melhor (Fundador ganha de CoFundador)');
ok(tagDoLooktype([{ tipo: 'cofundador', serie: 3 }], LOOKTYPE_FUNDADOR)?.tipo === 'cofundador',
  'vestir uma skin de que não se tem a tag não apaga a tag que se tem');
ok(tagDoLooktype([{ tipo: 'fundador', serie: 9 }, { tipo: 'fundador', serie: 4 }],
  LOOKTYPE_FUNDADOR)?.serie === 4, 'dentro do tipo, ganha a série menor');
ok(tagDoLooktype([], LOOKTYPE_FUNDADOR) === null, 'sem caixa aberta, sem tag');

await limpar(ids);
await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [ids]);

console.log('\n==============================================');
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
await pool.end();
process.exit(falhas ? 1 : 0);
