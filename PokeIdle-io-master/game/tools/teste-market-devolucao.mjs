// Teste da DEVOLUÇÃO do Mercado: o anúncio que o SERVIDOR fecha (vencido, curadoria, preço
// abaixo do mínimo, legado sem pensão) volta ao dono exatamente UMA vez — nem some, nem duplica.
//
// Só banco (precisa do Postgres: `npm run infra`). O caminho com dois sims — dono noutro shard,
// F5, login, restart — está em `teste-market-devolucao-shards.mjs`.
//
// O que este arquivo prova:
//
//   1. fechar um anúncio pelo servidor solta o que mora no banco (pokémon, peça numerada) e deixa
//      o ITEM na caixa postal, sem escrever em `players.items`/`balls` — escrita ali seria
//      apagada pelo flush de quem está on-line noutro sim (o item sumia), ou somada de novo;
//   2. a caixa postal entrega uma vez só, mesmo com várias chamadas ao mesmo tempo;
//   3. duas varreduras ao mesmo tempo (dois sims) fecham cada anúncio uma vez;
//   4. vencimento contra compra e contra cancelamento, no mesmo instante: um desfecho só;
//   5. anúncio fechado antes desta versão não é entregue de novo.
//
//   node tools/teste-market-devolucao.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/server/db.mjs';
import * as db from '../src/server/db.mjs';
import * as odb from '../src/server/orbs-db.mjs';
import * as mdb from '../src/server/market-db.mjs';
import { IDS_MERCADO_PERMITIDOS, especies } from '../src/server/content.mjs';
import { MERCADO_POKEMON_MIN, notaMercadoDoPokemon } from '../src/shared/nota-pokemon.mjs';
import { BEAST_BALL } from '../src/server/game/loja.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);
const erroDe = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

await db.aguardarBanco();
await db.migrar();
await odb.migrar();
await mdb.migrar();

const marca = Date.now() % 1000000;
const PEDRA = 2; // Ancient Stone — está na curadoria
const PEDRA2 = 23; // Cocoon Stone — também
const PROIBIDO = 1; // Air Tank — fora da curadoria
if (!IDS_MERCADO_PERMITIDOS.has(PEDRA) || !IDS_MERCADO_PERMITIDOS.has(PEDRA2) || IDS_MERCADO_PERMITIDOS.has(PROIBIDO)) {
  throw new Error('a curadoria mudou: escolha outros ids para PEDRA e PROIBIDO');
}

const criarJogador = async (nick) => {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, gold, items, balls) VALUES ($1, 1000000, $2::jsonb, $3::jsonb) RETURNING id`,
    [nick, JSON.stringify({ [PEDRA]: 10, [PROIBIDO]: 10 }), JSON.stringify({ [BEAST_BALL.id]: 10 })],
  );
  return Number(rows[0].id);
};
const vend = await criarJogador(`mdvend${marca}`);
const comp = await criarJogador(`mdcomp${marca}`);
const NICK_VEND = `mdvend${marca}`;

const novoPokemon = async (dono) => Number((await pool.query(
  `INSERT INTO player_pokemon (player_id, species_id, level, ivs, hp, power, shiny)
   VALUES ($1, 6, 87, '{"hp":30}'::jsonb, 100, 5000, true) RETURNING id`, [dono])).rows[0].id);

// Shiny na ficha: é o que mantém o anúncio longe de `devolverPokemonAbaixoDoMinimo`, que olha a
// vitrine inteira — só o anúncio da seção dela deve cair ali.
const anunciarPk = async (pk, extra = {}) => mdb.criarAnuncio({
  vendedorId: vend, vendedor: NICK_VEND, tipo: 'pokemon', pokemonId: pk, qtd: 1,
  ficha: { nome: 'Charizard', level: 87, shiny: true }, preco: 5000, moeda: 'gold', dias: 1, ...extra,
});
// A trava de reanúncio (30 min entre um anúncio de item e o próximo) não é o assunto daqui:
// os fechados do vendedor são empurrados para o passado antes de cada anúncio de item.
const envelhecer = () => pool.query(
  `UPDATE market_anuncios SET fechado_em = now() - interval '2 hours' WHERE vendedor_id = $1 AND estado <> 'aberto'`, [vend]);
const anunciarItem = async (itemId, qtd, extra = {}) => (await envelhecer(), mdb.criarAnuncio({
  vendedorId: vend, vendedor: NICK_VEND, tipo: 'item', itemId, qtd,
  ficha: { nome: `item ${itemId}` }, preco: 5000, moeda: 'gold', ...extra,
}));
const anunciarBola = async (qtd, extra = {}) => (await envelhecer(), mdb.criarAnuncio({
  vendedorId: vend, vendedor: NICK_VEND, tipo: 'item', itemId: BEAST_BALL.id, qtd,
  ficha: { nome: BEAST_BALL.nome, bola: true, ballId: BEAST_BALL.id }, preco: 5000, moeda: 'gold', ...extra,
}));
const vencer = (ids) => pool.query(
  `UPDATE market_anuncios SET expira_em = now() - interval '1 second' WHERE id = ANY($1::bigint[])`, [ids]);
const liberar = (ids) => pool.query(
  `UPDATE market_anuncios SET compravel_em = now() - interval '1 second' WHERE id = ANY($1::bigint[])`, [ids]);
const linha = async (id) => (await pool.query(
  `SELECT estado, devolucao_pendente FROM market_anuncios WHERE id = $1`, [id])).rows[0];
const pokemon = async (id) => (await pool.query(
  `SELECT player_id, anuncio_id, slot FROM player_pokemon WHERE id = $1`, [id])).rows[0];
const bolsa = async (id) => (await pool.query(`SELECT items, balls FROM players WHERE id = $1`, [id])).rows[0];
const meus = (lista) => lista.filter((a) => a.vendedorId === vend);
const ids = (lista) => lista.map((a) => a.id).sort((x, y) => x - y);
const pendentes = async () => (await pool.query(
  `SELECT count(*)::int AS n FROM market_anuncios WHERE vendedor_id = $1 AND devolucao_pendente`, [vend])).rows[0].n;

// A bolsa no banco NUNCA muda por causa de uma devolução do servidor: quem soma é a memória do
// sim, e é o flush dele que grava. Conferido em todas as seções contra esta foto.
const bolsaInicial = await bolsa(vend);
const bolsaIntacta = async () => JSON.stringify(await bolsa(vend)) === JSON.stringify(bolsaInicial);

// ------------------------------------------------------------ pokémon vencido
secao('Pokémon vencido');
{
  const pk = await novoPokemon(vend);
  const a = await anunciarPk(pk);
  ok(Number((await pokemon(pk)).anuncio_id) === a.id, 'anunciado: o pokémon está em escrow');
  ok(!(await mdb.vendedoresComDevolucao([vend])).has(vend), 'anúncio aberto não é devolução pendente');

  await vencer([a.id]);
  const fechados = meus(await mdb.expirarAnuncios());
  ok(fechados.length === 1 && fechados[0].id === a.id, 'a varredura fecha o vencido', JSON.stringify(ids(fechados)));
  const l = await linha(a.id);
  ok(l.estado === 'expirado' && l.devolucao_pendente === true, 'fica expirado e com a devolução pendente', JSON.stringify(l));
  const p = await pokemon(pk);
  ok(Number(p.player_id) === vend && p.anuncio_id === null, 'o pokémon é do dono e saiu do escrow', JSON.stringify(p));
  ok(p.slot === null, 'e está no Depot, não na equipe');
  const { rows: copias } = await pool.query(`SELECT count(*)::int AS n FROM player_pokemon WHERE id = $1`, [pk]);
  ok(copias[0].n === 1, 'uma linha só do pokémon — a devolução não cria cópia');

  ok(meus(await mdb.expirarAnuncios()).length === 0, 'a segunda varredura não acha nada (não fecha duas vezes)');
  ok((await erroDe(() => mdb.cancelarAnuncio({ id: a.id, vendedorId: vend }))) === 'anúncio não está aberto',
    'cancelar o vencido é recusado — não há segunda devolução');
  await liberar([a.id]);
  ok((await erroDe(() => mdb.comprarAnuncio({ id: a.id, compradorId: comp, comprador: 'comp', preco: 5000, moeda: 'gold' }))) != null,
    'comprar o vencido é recusado');
  ok(Number((await pokemon(pk)).player_id) === vend, 'e o pokémon continua com o dono');
  ok((await erroDe(() => mdb.editarAnuncio({ id: a.id, vendedorId: vend, preco: 9000, moeda: 'gold' }))) != null,
    'editar o vencido é recusado');

  ok((await mdb.vendedoresComDevolucao([vend, comp])).has(vend), 'o dono aparece na consulta do shard');
  ok(!(await mdb.vendedoresComDevolucao([vend, comp])).has(comp), 'e só ele');

  const entregue = await mdb.recolherDevolucoes(vend);
  ok(entregue.length === 1 && entregue[0].id === a.id, 'a caixa postal entrega o anúncio', JSON.stringify(ids(entregue)));
  ok(entregue[0]?.tipo === 'pokemon' && entregue[0]?.pokemonId === pk, 'com o id do pokémon para o sim recarregar');
  ok(entregue[0]?.estado === 'expirado', 'e o motivo (vencido), para o aviso certo');
  ok(entregue[0]?.nome === 'Charizard' && entregue[0]?.level === 87, 'e o nome e o nível, para o aviso');
  ok((await mdb.recolherDevolucoes(vend)).length === 0, 'recolher de novo não entrega nada');
  ok(!(await mdb.vendedoresComDevolucao([vend])).has(vend), 'e o dono sai da consulta');
  ok(await bolsaIntacta(), 'a bolsa no banco não foi tocada');
}

// ------------------------------------------------------ item e bola vencidos
secao('Item e Beast Ball vencidos (anúncio com prazo)');
{
  const pedra = await anunciarItem(PEDRA, 5, { dias: 1 });
  const bola = await anunciarBola(4, { dias: 1 });
  await vencer([pedra.id, bola.id]);
  const fechados = meus(await mdb.expirarAnuncios());
  ok(ids(fechados).join() === [pedra.id, bola.id].sort((x, y) => x - y).join(), 'os dois fecham');
  ok(await bolsaIntacta(), 'NADA é somado na bolsa do banco — quem soma é a memória do dono');

  const entregue = await mdb.recolherDevolucoes(vend);
  const ePedra = entregue.find((x) => x.id === pedra.id);
  const eBola = entregue.find((x) => x.id === bola.id);
  ok(entregue.length === 2, 'a caixa postal entrega os dois');
  ok(ePedra?.itemId === PEDRA && ePedra?.qtd === 5 && ePedra?.ballId === null, 'a pedra volta como 5 unidades do item', JSON.stringify(ePedra));
  ok(eBola?.ballId === BEAST_BALL.id && eBola?.qtd === 4, 'a Beast Ball volta para as bolas, não para os itens', JSON.stringify(eBola));
  ok(!ePedra?.caixaId && !ePedra?.casaId && !ePedra?.bicicletaId, 'e não é peça numerada');
  ok((await mdb.recolherDevolucoes(vend)).length === 0, 'recolher de novo não entrega nada');
}

// ------------------------------------------------------ concorrência: recolher
secao('Recolher ao mesmo tempo (varredura + login + aviso) entrega uma vez');
{
  const lote = [];
  for (let i = 0; i < 3; i++) lote.push(await anunciarPk(await novoPokemon(vend)));
  lote.push(await anunciarItem(PEDRA, 2, { dias: 1 }));
  await vencer(lote.map((a) => a.id));
  await mdb.expirarAnuncios();
  const corridas = await Promise.all(Array.from({ length: 8 }, () => mdb.recolherDevolucoes(vend)));
  const todas = corridas.flat();
  ok(todas.length === 4, `oito chamadas juntas entregam 4 linhas no total, não mais`, `veio ${todas.length}`);
  ok(new Set(todas.map((a) => a.id)).size === 4, 'e nenhuma linha em duas chamadas');
  ok(await pendentes() === 0, 'nada fica pendente');
}

// -------------------------------------------------- concorrência: dois sims
secao('Duas varreduras ao mesmo tempo (vários sims) fecham cada anúncio uma vez');
{
  const lote = [];
  for (let i = 0; i < 4; i++) lote.push(await anunciarPk(await novoPokemon(vend)));
  lote.push(await anunciarItem(PEDRA, 3, { dias: 1 }));
  await vencer(lote.map((a) => a.id));
  const varreduras = await Promise.all(Array.from({ length: 4 }, () => mdb.expirarAnuncios()));
  const fechados = varreduras.flatMap(meus);
  ok(fechados.length === 5, 'quatro varreduras juntas fecham os 5, somando todas', `veio ${fechados.length}`);
  ok(new Set(fechados.map((a) => a.id)).size === 5, 'e nenhum anúncio em duas varreduras');
  const entregue = await mdb.recolherDevolucoes(vend);
  ok(entregue.length === 5, 'a caixa postal tem 5 entregas, uma por anúncio', `veio ${entregue.length}`);
  ok(entregue.filter((a) => a.itemId === PEDRA).reduce((s, a) => s + a.qtd, 0) === 3, 'e as pedras somam 3, não 6');
  ok(await bolsaIntacta(), 'a bolsa no banco não foi tocada');
}

// ------------------------------------------------ vencimento × compra
secao('Vencimento e compra no mesmo instante: um desfecho só');
{
  const desfechos = { vendido: 0, expirado: 0 };
  for (let i = 0; i < 15; i++) {
    const pk = await novoPokemon(vend);
    const a = await anunciarPk(pk);
    await vencer([a.id]);
    await liberar([a.id]);
    await Promise.allSettled([
      mdb.comprarAnuncio({ id: a.id, compradorId: comp, comprador: 'comp', preco: 5000, moeda: 'gold' }),
      mdb.expirarAnuncios(),
    ]);
    const l = await linha(a.id);
    const p = await pokemon(pk);
    const pagos = (await pool.query(`SELECT count(*)::int AS n FROM market_pagamentos WHERE anuncio_id = $1`, [a.id])).rows[0].n;
    desfechos[l.estado] = (desfechos[l.estado] ?? 0) + 1;
    if (l.estado === 'vendido') {
      ok(Number(p.player_id) === comp && p.anuncio_id === null && !l.devolucao_pendente && pagos === 1,
        `#${i + 1} vendido: o comprador leva, o vendedor recebe, nada volta`, JSON.stringify({ p, l, pagos }));
    } else {
      ok(l.estado === 'expirado' && Number(p.player_id) === vend && p.anuncio_id === null && l.devolucao_pendente && pagos === 0,
        `#${i + 1} vencido: volta ao dono, ninguém paga`, JSON.stringify({ p, l, pagos }));
    }
  }
  console.log(`    (desfechos: ${desfechos.vendido} vendidos, ${desfechos.expirado} vencidos)`);
  const entregue = await mdb.recolherDevolucoes(vend);
  ok(entregue.length === desfechos.expirado, 'a caixa postal tem exatamente os vencidos', `${entregue.length} vs ${desfechos.expirado}`);
  ok(entregue.every((a) => a.estado === 'expirado'), 'e nenhum vendido');
}

// ------------------------------------------- vencimento × cancelamento
secao('Vencimento e cancelamento no mesmo instante: uma devolução só');
{
  let viaCaixa = 0;
  for (let i = 0; i < 15; i++) {
    const pk = await novoPokemon(vend);
    const a = await anunciarPk(pk);
    await vencer([a.id]);
    const [cancel] = await Promise.allSettled([
      mdb.cancelarAnuncio({ id: a.id, vendedorId: vend }),
      mdb.expirarAnuncios(),
    ]);
    const l = await linha(a.id);
    const p = await pokemon(pk);
    const cancelou = cancel.status === 'fulfilled';
    // Cancelou: o sim devolve na hora (pela resposta do cancelamento) e a caixa postal fica vazia.
    // Venceu: o cancelamento é recusado, e a entrega é só da caixa postal.
    const certo = cancelou
      ? l.estado === 'cancelado' && !l.devolucao_pendente
      : l.estado === 'expirado' && l.devolucao_pendente && /não está aberto/.test(cancel.reason?.message ?? '');
    if (!cancelou) viaCaixa++;
    ok(certo && Number(p.player_id) === vend && p.anuncio_id === null,
      `#${i + 1} ${cancelou ? 'cancelou' : 'venceu'}: um caminho de devolução só`, JSON.stringify({ l, p, cancel: cancel.status }));
  }
  const entregue = await mdb.recolherDevolucoes(vend);
  ok(entregue.length === viaCaixa, 'a caixa postal tem só os que venceram', `${entregue.length} vs ${viaCaixa}`);
}

// --------------------------------------------------- linhas de antes
secao('Anúncio fechado antes desta versão não é entregue de novo');
{
  const velho = await anunciarPk(await novoPokemon(vend));
  // Como a versão anterior deixava: fechado, pokémon solto, e a entrega já feita por ela.
  await pool.query(`UPDATE market_anuncios SET estado = 'expirado', fechado_em = now() WHERE id = $1`, [velho.id]);
  await pool.query(`UPDATE player_pokemon SET anuncio_id = NULL WHERE anuncio_id = $1`, [velho.id]);
  const cancelado = await anunciarItem(PEDRA, 1);
  await mdb.cancelarAnuncio({ id: cancelado.id, vendedorId: vend });
  ok(!(await linha(velho.id)).devolucao_pendente, 'a coluna nova nasce desligada nas linhas antigas');
  ok((await mdb.recolherDevolucoes(vend)).length === 0, 'nem o vencido antigo nem o cancelado pelo dono voltam pela caixa postal');
}

// ---------------------------------------------------- devoluções de boot
secao('Devoluções de boot: a mesma caixa postal, sem escrever na bolsa');
{
  // Curadoria: item que saiu da lista.
  const proibido = await anunciarItem(PROIBIDO, 6);
  const permitido = await anunciarItem(PEDRA, 1);
  const curadoria = meus(await mdb.devolverAnunciosProibidos([...IDS_MERCADO_PERMITIDOS]));
  ok(ids(curadoria).join() === String(proibido.id), 'curadoria: fecha só o item proibido', JSON.stringify(ids(curadoria)));
  ok((await linha(permitido.id)).estado === 'aberto', 'curadoria: o permitido continua aberto');

  // Preço abaixo do mínimo, em Coins: pokémon e Beast Ball.
  const pkBarato = await novoPokemon(vend);
  const aPkBarato = await anunciarPk(pkBarato);
  const aBolaBarata = await anunciarBola(3);
  await pool.query(`UPDATE market_anuncios SET preco = 1 WHERE id = ANY($1::bigint[])`, [[aPkBarato.id, aBolaBarata.id]]);
  const gold = meus(await mdb.devolverAnunciosPrecoGoldInvalido());
  ok(ids(gold).join() === [aPkBarato.id, aBolaBarata.id].sort((x, y) => x - y).join(), 'preço em Coins: fecha os dois');
  ok((await pokemon(pkBarato)).anuncio_id === null, 'preço em Coins: o pokémon sai do escrow');

  // Preço abaixo do mínimo, em Gemas.
  const aOrb = await anunciarItem(PEDRA2, 2, { preco: 50, moeda: 'orb' });
  await pool.query(`UPDATE market_anuncios SET preco = 1 WHERE id = $1`, [aOrb.id]);
  const orb = meus(await mdb.devolverAnunciosPrecoOrbInvalido());
  ok(ids(orb).join() === String(aOrb.id), 'preço em Gemas: fecha o anúncio', JSON.stringify(ids(orb)));

  // Legado sem pensão.
  const pkLegado = await novoPokemon(vend);
  const aLegado = await anunciarPk(pkLegado, { dias: null });
  const legado = meus(await mdb.devolverPokemonSemPensao());
  ok(ids(legado).join() === String(aLegado.id), 'sem pensão: fecha o legado');

  // Abaixo da faixa mínima da vitrine.
  const pkFraco = await novoPokemon(vend);
  const aFraco = await anunciarPk(pkFraco, { ficha: { nome: 'Rattata', level: 3 } });
  const fraco = meus(await mdb.devolverPokemonAbaixoDoMinimo());
  ok(ids(fraco).join() === String(aFraco.id), 'abaixo do mínimo: fecha só o fraco', JSON.stringify(ids(fraco)));
  ok((await pokemon(pkFraco)).anuncio_id === null && (await pokemon(pkLegado)).anuncio_id === null,
    'os dois pokémon saem do escrow');

  ok(await bolsaIntacta(), 'NENHUMA das cinco escreveu na bolsa do banco');

  const esperados = [proibido.id, aPkBarato.id, aBolaBarata.id, aOrb.id, aLegado.id, aFraco.id].sort((x, y) => x - y);
  for (const id of esperados) {
    const l = await linha(id);
    ok(l.estado === 'cancelado' && l.devolucao_pendente, `#${id}: cancelado e com a devolução pendente`, JSON.stringify(l));
  }

  // Rodar tudo de novo (o boot do próximo sim) não acha nada.
  const segunda = [
    ...meus(await mdb.devolverAnunciosProibidos([...IDS_MERCADO_PERMITIDOS])),
    ...meus(await mdb.devolverAnunciosPrecoGoldInvalido()),
    ...meus(await mdb.devolverAnunciosPrecoOrbInvalido()),
    ...meus(await mdb.devolverPokemonSemPensao()),
    ...meus(await mdb.devolverPokemonAbaixoDoMinimo()),
  ];
  ok(segunda.length === 0, 'o boot seguinte não fecha nada de novo', JSON.stringify(ids(segunda)));

  const entregue = await mdb.recolherDevolucoes(vend);
  ok(ids(entregue).join() === esperados.join(), 'a caixa postal entrega os seis, uma vez cada', JSON.stringify(ids(entregue)));
  ok(entregue.every((a) => a.estado === 'cancelado'), 'com o motivo "cancelado" (o aviso diz que foi o sistema)');
  const porId = new Map(entregue.map((a) => [a.id, a]));
  ok(porId.get(proibido.id)?.itemId === PROIBIDO && porId.get(proibido.id)?.qtd === 6, 'o item proibido volta com as 6 unidades');
  ok(porId.get(aBolaBarata.id)?.ballId === BEAST_BALL.id && porId.get(aBolaBarata.id)?.qtd === 3, 'a Beast Ball volta para as bolas');
  ok(porId.get(aOrb.id)?.itemId === PEDRA2 && porId.get(aOrb.id)?.qtd === 2, 'o item em Gemas volta com as 2 unidades');
  ok([aPkBarato, aLegado, aFraco].every((a) => porId.get(a.id)?.pokemonId === a.pokemonId),
    'os pokémon voltam pelo id certo');
  // O DESTINO viaja com a linha. Só o barrado pela faixa mínima vai para a Coleção: as outras
  // devoluções devolvem ao Depot, que é de onde o pokémon saiu.
  ok(porId.get(aFraco.id)?.paraColecao === true, 'o barrado pela faixa mínima volta marcado para a Coleção');
  ok([aPkBarato, aLegado].every((a) => porId.get(a.id)?.paraColecao !== true),
    'e as outras devoluções de pokémon continuam indo para o Depot');
  ok((await mdb.recolherDevolucoes(vend)).length === 0, 'e recolher de novo não entrega nada');

  await mdb.cancelarAnuncio({ id: permitido.id, vendedorId: vend });
}

// ------------------------------------------------- a nota mínima da vitrine
//
// O corte que mudou em 21/09/2026: 3,0 voltou a ser 3,5. Provar isso pelo NÍVEL (como a seção
// de boot acima faz) não bastaria — o piso de nível nunca mudou, e um teste que só olha para
// ele passaria igual se a nota fosse 3,0 de novo.
secao('Nota mínima: quem fica abaixo volta para a COLEÇÃO, não para o Depot');
{
  ok(MERCADO_POKEMON_MIN.nota === 3.5, `o piso da vitrine é 3,5 (é ${MERCADO_POKEMON_MIN.nota})`);

  // A cobaia: Bulbasaur nível 60, IV 124, qualidade 500, potência II e sem shiny — 3,086 na
  // calculadora. Passava no piso antigo e não passa no novo, que é exatamente a população que
  // esta devolução existe para tirar da vitrine.
  //
  // Quem julga é a FICHA do anúncio, e não a linha de `player_pokemon`: é ela que a vitrine
  // mostra e é dela que `devolverPokemonAbaixoDoMinimo` recalcula a nota. Por isso a linha do
  // pokémon pode ser a de sempre.
  const ficha = { nome: 'Bulbasaur', speciesId: 1, level: 60, iv: 124, qualidade: 500, potencia: 2, shiny: false };
  const nota = notaMercadoDoPokemon(ficha, especies);
  ok(nota >= 3.0 && nota < 3.5, 'a cobaia cai na faixa que mudou (3,0 ≤ nota < 3,5)', String(nota));

  const pk = await novoPokemon(vend);
  const a = await anunciarPk(pk, { ficha });
  const barrados = meus(await mdb.devolverPokemonAbaixoDoMinimo());
  ok(ids(barrados).join() === String(a.id), 'o boot fecha o anúncio', JSON.stringify(ids(barrados)));
  ok(barrados[0]?.motivo === 'nota', 'pelo motivo NOTA, e não pelo nível', String(barrados[0]?.motivo));
  ok((await pokemon(pk)).anuncio_id === null, 'e o pokémon sai do escrow');

  const entregue = await mdb.recolherDevolucoes(vend);
  ok(ids(entregue).join() === String(a.id), 'a caixa postal entrega um só', JSON.stringify(ids(entregue)));
  ok(entregue[0]?.paraColecao === true, 'marcado para a COLEÇÃO — é o que o sim lê para guardá-lo');
  ok(await bolsaIntacta(), 'e nada foi escrito na bolsa do banco');
}

// ------------------------------------------------------------ o lado do sim
//
// O que depende de ordem dentro do sim — e que um teste com processo de verdade não consegue
// cronometrar — é conferido no fonte, como os outros testes de regra do repositório fazem.
secao('No sim: a entrega não perde item nem traz pokémon em dobro');
{
  const sim = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/server/sim.mjs'), 'utf8')
    .replace(/\r\n/g, '\n');
  const trecho = (inicio, fim) => {
    const i = sim.indexOf(inicio);
    if (i < 0) return '';
    const j = sim.indexOf(fim, i + inicio.length);
    return sim.slice(i, j < 0 ? undefined : j);
  };
  const entregar = trecho('function entregarDevolucoes(p) {', '\n}\n');
  const agora = trecho('async function entregarDevolucoesAgora(p) {', '\n}\n');
  const remover = trecho('function removerJogadorLocal(p) {', '\n}\n');
  ok(/enfileirarEconomia\(p, \(\) => entregarDevolucoesAgora\(p\)/.test(entregar),
    'a entrega roda na fila de economia do jogador');
  ok(/const fila = filasEconomia\.get\(playerId\);[\s\S]*filaFlush\.add\(p\);/.test(remover),
    'e a última gravação de quem sai espera essa fila (o item entregue no meio da saída é gravado)');
  ok(agora.indexOf('if (jogadores.get(p.key) !== p) return;') >= 0 &&
    agora.indexOf('if (jogadores.get(p.key) !== p) return;') < agora.indexOf('mdb.recolherDevolucoes('),
  'quem já saiu da memória não recolhe nada — a devolução fica para o próximo login');
  const creditos = agora
    .slice(agora.indexOf('mdb.recolherDevolucoes('), agora.indexOf('p.items[a.itemId] ='))
    .replace(/\/\/[^\n]*/g, '');
  ok(creditos.length > 0 && !/\bawait\b/.test(creditos.slice(creditos.indexOf(';') + 1)),
    'entre recolher e creditar o item não há nenhum await', creditos);
  ok(/if \(p\.pokemons\.has\(a\.pokemonId\)\) continue;\s*\n\s*await recarregarPokemon\(p, a\.pokemonId\)/.test(agora),
    'pokémon que já está na memória não é recarregado (não vira dois objetos)');
  ok(/if \(a\.paraColecao && p\.pokemons\.has\(a\.pokemonId\)\) travarPokemon\(p, a\.pokemonId\);/.test(agora),
    'o que voltou por não passar na faixa mínima entra na Coleção');
  ok(agora.indexOf('await recarregarPokemon(p, a.pokemonId)') < agora.indexOf('travarPokemon(p, a.pokemonId)'),
    'e só DEPOIS do recarregamento — um id sem pokémon na memória seria varrido pelo limparColecao do próximo login');
  ok(/a\.paraColecao \? 'marketDevolvidoColecao'/.test(agora),
    'o aviso da tela diz que ele foi parar na Coleção');
  const recarregar = trecho('async function recarregarPokemon(p, pokemonId) {', '\n}\n');
  ok(/db\.pokemonPorId\(pokemonId, p\.dbId\)/.test(recarregar), 'o recarregamento lê a linha do DONO pelo id');
  const porId = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/server/db.mjs'), 'utf8');
  ok(/SELECT \* FROM player_pokemon WHERE id = \$1 AND player_id = \$2 AND anuncio_id IS NULL/.test(porId),
    'e só a que está FORA do escrow — o pokémon anunciado de novo não volta');
  const aviso = trecho("if (msg.t === 'market.devolver') {", '\n      }\n');
  ok(aviso.includes('entregarDevolucoes(alvo)') && sim.indexOf("if (msg.t === 'market.devolver')") < sim.indexOf("if (msg.t === 'admin.diamantes')"),
    'o aviso do barramento entra antes do bloco que tira o jogador da carência');
  ok(/if \(msg\.doCliente === true\) \{[\s\S]*?return;\s*\n\s*\}/.test(sim) &&
    sim.indexOf('if (msg.doCliente === true)') < sim.indexOf("if (msg.t === 'market.devolver')"),
  'e o cliente não o alcança (o pacote do socket para no bloco de comandos)');
  ok(!/'market\.devolver'\s*:/.test(sim), 'nem existe um comando de cliente com esse nome');
}

ok(await pendentes() === 0, 'no fim, nada pendente para o vendedor');
ok(await bolsaIntacta(), 'e a bolsa dele no banco é a mesma do começo');

await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [[vend, comp]]);

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
await pool.end();
process.exit(falhas ? 1 : 0);
