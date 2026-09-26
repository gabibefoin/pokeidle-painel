// A retenção de 2 minutos do Mercado da Comunidade, direto no banco — sem servidor.
//
//     node tools/teste-retencao-mercado.mjs
//
// O que este teste protege:
//   · todo anúncio nasce retido por `COOLDOWN_COMPRA_MS` (2 min), medido no relógio do banco;
//   · comprar dentro da retenção é recusado na transação (não só na tela);
//   · editar o preço reinicia a retenção;
//   · SOMAR quantidade na pilha de um anúncio já liberado reinicia a retenção — senão anunciar 1,
//     esperar e somar 100 deixava as 100 compráveis na hora;
//   · cancelar continua valendo durante a retenção, e o anúncio sai uma vez só.
import { pool } from '../src/server/db.mjs';
import * as mdb from '../src/server/market-db.mjs';
import { itens, categoriaMercado } from '../src/server/content.mjs';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};
const esperadaS = () => mdb.COOLDOWN_COMPRA_MS / 1000;
const SUF = Date.now().toString(36).slice(-6);
const ITEM = [...itens.values()].find((i) => categoriaMercado(i) === 'stone');
const PRECO = Math.max(mdb.PRECO_MIN_GOLD, 500);
const jogadores = [];

async function novoJogador(sufixo) {
  const nick = `ret${SUF}${sufixo}`;
  const { rows } = await pool.query(`INSERT INTO players (nick, level, gold) VALUES ($1, 60, 1000000) RETURNING id`, [nick]);
  jogadores.push(Number(rows[0].id));
  return { id: Number(rows[0].id), nick };
}
const retencaoRestanteS = async (id) => Number((await pool.query(
  `SELECT extract(epoch FROM (compravel_em - now())) AS s FROM market_anuncios WHERE id = $1`, [id],
)).rows[0].s);
const liberar = (id) => pool.query(`UPDATE market_anuncios SET compravel_em = now() - interval '1 second' WHERE id = $1`, [id]);
const erroDe = (promessa) => promessa.then(() => null, (e) => e.message);
const ficha = { nome: ITEM?.name ?? 'Pedra' };

console.log('RETENÇÃO DO MERCADO\n===================');
try {
  await mdb.migrar();
  ok(mdb.COOLDOWN_COMPRA_MS === 2 * 60_000 && !!ITEM, 'retenção configurada em 2 min e item comum de mercado disponível');
  const vendedor = await novoJogador('v');
  const comprador = await novoJogador('c');

  console.log('\nNascimento e compra');
  const a = await mdb.criarAnuncio({
    vendedorId: vendedor.id, vendedor: vendedor.nick, tipo: 'item', itemId: ITEM.id, qtd: 2, ficha, preco: PRECO, moeda: 'gold',
  });
  const r0 = await retencaoRestanteS(a.id);
  ok(Math.abs(r0 - esperadaS()) < 5, 'o anúncio nasce retido por 2 min no relógio do banco', `${r0.toFixed(0)} s`);
  ok(a.compravelEm - a.criadoEm >= esperadaS() * 1000 - 5000, 'e o cliente recebe `compravelEm` com a mesma retenção à frente');
  const e1 = await erroDe(mdb.comprarAnuncio({ id: a.id, compradorId: comprador.id, comprador: comprador.nick, qtd: 1, preco: PRECO, moeda: 'gold' }));
  ok(/retenção/.test(e1 ?? ''), 'comprar dentro da retenção é recusado na transação', e1);

  console.log('\nPilha');
  await liberar(a.id);
  ok((await retencaoRestanteS(a.id)) < 0, 'anúncio liberado (forçado no banco)');
  const somado = await mdb.criarAnuncio({
    vendedorId: vendedor.id, vendedor: vendedor.nick, tipo: 'item', itemId: ITEM.id, qtd: 100, ficha, preco: PRECO, moeda: 'gold',
  });
  ok(somado.id === a.id && somado.qtd === 102, 'mesmo item e preço soma na pilha (102)', `${somado.id}/${somado.qtd}`);
  const r1 = await retencaoRestanteS(a.id);
  ok(Math.abs(r1 - esperadaS()) < 5, 'somar na pilha liberada REINICIA a retenção', `${r1.toFixed(0)} s`);
  const e2 = await erroDe(mdb.comprarAnuncio({ id: a.id, compradorId: comprador.id, comprador: comprador.nick, qtd: 100, preco: PRECO, moeda: 'gold' }));
  ok(/retenção/.test(e2 ?? ''), 'e as 100 unidades novas não podem ser compradas na hora', e2);

  console.log('\nEdição e compra depois de liberar');
  await liberar(a.id);
  await mdb.editarAnuncio({ id: a.id, vendedorId: vendedor.id, preco: PRECO + 1, moeda: 'gold' });
  const r2 = await retencaoRestanteS(a.id);
  ok(Math.abs(r2 - esperadaS()) < 5, 'editar o preço reinicia a retenção', `${r2.toFixed(0)} s`);
  await liberar(a.id);
  const compra = await mdb.comprarAnuncio({ id: a.id, compradorId: comprador.id, comprador: comprador.nick, qtd: 2, preco: PRECO + 1, moeda: 'gold' });
  ok(compra.anuncio.qtd === 2 && compra.sobra === 100, 'depois de liberar, a compra acontece normalmente', JSON.stringify({ q: compra.anuncio.qtd, s: compra.sobra }));

  console.log('\nCancelamento durante a retenção');
  const b = await mdb.criarAnuncio({
    vendedorId: comprador.id, vendedor: comprador.nick, tipo: 'item', itemId: ITEM.id, qtd: 3, ficha, preco: PRECO, moeda: 'gold',
  });
  const [c1, c2] = await Promise.all([
    erroDe(mdb.cancelarAnuncio({ id: b.id, vendedorId: comprador.id })),
    erroDe(mdb.cancelarAnuncio({ id: b.id, vendedorId: comprador.id })),
  ]);
  ok([c1, c2].filter((e) => e === null).length === 1, 'dois cancelamentos simultâneos: só um vale', `${c1} / ${c2}`);
  const e3 = await erroDe(mdb.cancelarAnuncio({ id: a.id, vendedorId: comprador.id }));
  ok(!!e3, 'cancelar o anúncio de outra pessoa é recusado', e3);
} catch (err) {
  falhas++;
  console.log(`  ✗ o teste estourou: ${err.message}`);
} finally {
  if (jogadores.length) {
    await pool.query(`DELETE FROM market_pagamentos WHERE vendedor_id = ANY($1::bigint[]) OR comprador_id = ANY($1::bigint[])`, [jogadores]).catch(() => {});
    await pool.query(`DELETE FROM market_anuncios WHERE vendedor_id = ANY($1::bigint[])`, [jogadores]).catch(() => {});
    await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [jogadores]).catch(() => {});
  }
  await pool.end();
}
console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
