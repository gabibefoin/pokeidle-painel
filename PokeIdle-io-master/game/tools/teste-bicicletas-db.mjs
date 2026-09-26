// Ensaio das BICICLETAS NUMERADAS contra o Postgres local — o espelho de `teste-casas-db.mjs`.
//
//     node tools/teste-bicicletas-db.mjs
//
// O que só o banco responde: o número nascendo do `BIGSERIAL` sob corrida, o escrow da bicicleta no
// Mercado (anunciar, recusar a segunda vez e a dos outros, cancelar, vender com o número no recibo,
// comprador não compra o próprio anúncio), a devolução por varredura sem virar quantidade, o Registro
// de Bikes, a bicicleta-item que reaparece na bolsa depois da virada e o anúncio antigo de quantidade.
//
// Roda em dois jogadores próprios (`__biketeste*`) e apaga no fim as bicicletas e os anúncios deles.
import { pool } from '../src/server/db.mjs';
import * as mdb from '../src/server/market-db.mjs';
import * as bicicletasDb from '../src/server/bicicletas-db.mjs';
import { numeroDaBicicleta } from '../src/shared/bicicletas.mjs';
import { BICICLETA_POR_RARIDADE } from '../src/server/game/itens-nossos.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, msg) => {
  testes++;
  if (!cond) falhas++;
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
};
const secao = (s) => console.log(`\n${s}`);
const recusa = (p) => p.then(() => null, (e) => e.message);

const NICKS = ['__biketestea', '__biketesteb'];

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
  await pool.query(`DELETE FROM market_pagamentos WHERE vendedor_id = ANY($1::bigint[]) OR comprador_id = ANY($1::bigint[])`, [ids]);
  await pool.query(`DELETE FROM market_anuncios WHERE vendedor_id = ANY($1::bigint[])`, [ids]);
  await pool.query(`DELETE FROM bicicletas WHERE dono_id = ANY($1::bigint[]) OR criador_id = ANY($1::bigint[])`, [ids]);
  await pool.query(`UPDATE players SET items = '{}'::jsonb, bicicletas_legado = '{}'::jsonb WHERE id = ANY($1::bigint[])`, [ids]);
}

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.log(`Postgres indisponível (${err.message}) — suba com \`npm run infra\`.`);
  process.exit(1);
}

await mdb.migrar();
await bicicletasDb.migrar();

const [a, b] = await Promise.all(NICKS.map(jogadorDeTeste));
const ids = [a, b];
await limpar(ids);

const anunciar = (vendedorId, vendedor, bici, preco = 5000) => mdb.criarAnuncio({
  vendedorId, vendedor, tipo: 'item',
  itemId: BICICLETA_POR_RARIDADE[bici.raridade], qtd: 1, bicicletaId: bici.id,
  ficha: { nome: 'Bicycle', categoria: 'bicicleta', bicicletaId: bici.id, numero: bici.id, bicicletaRaridade: bici.raridade, npc: 0 },
  preco, moeda: 'gold', dias: null,
});
/** A retenção anti multi-conta sai do caminho: aqui o que se testa é a entrega. */
const destravar = (id) => pool.query(`UPDATE market_anuncios SET compravel_em = now() - interval '1 minute' WHERE id = $1`, [id]);
const itensDe = async (id) => (await pool.query('SELECT items FROM players WHERE id = $1', [id])).rows[0].items ?? {};

console.log('BICICLETAS NUMERADAS — banco\n============================');

secao('A virada');
{
  const { rows } = await pool.query(`SELECT valor FROM game_meta WHERE chave = 'bicicletas_numeradas_v1'`);
  ok(rows.length === 1, `a numeração das bicicletas antigas rodou e ficou marcada (${rows[0]?.valor ?? '—'})`);
  ok((await bicicletasDb.numerarBicicletasLegadas()).feito === false, 'rodar de novo não numera nada: é uma vez só');
}

secao('Numeração');
const b1 = await bicicletasDb.criarBicicleta({ donoId: a, nick: NICKS[0], raridade: 'comum' });
const b2 = await bicicletasDb.criarBicicleta({ donoId: b, nick: NICKS[1], raridade: 'lendaria' });
ok(b2.id > b1.id, `a segunda bicicleta vem depois da primeira (${numeroDaBicicleta(b1.id)} → ${numeroDaBicicleta(b2.id)})`);
ok(numeroDaBicicleta(42) === '#000042', 'o número tem a largura da casa: #000042');
ok(b1.raridade === 'comum' && b1.anunciada === false && b1.criador === NICKS[0], 'nasce com a raridade, na mão do dono, com o criador');
for (const torta of ['lendaria ', 'LENDARIA', '__proto__', '', null]) {
  ok(await recusa(bicicletasDb.criarBicicleta({ donoId: a, nick: NICKS[0], raridade: torta })) === 'bicicleta.invalida',
    `raridade adulterada ${JSON.stringify(torta)} não vira bicicleta`);
}

secao('Corrida — vinte bicicletas ao mesmo tempo');
const corrida = await Promise.all(Array.from({ length: 20 }, () => bicicletasDb.criarBicicleta({ donoId: a, nick: NICKS[0], raridade: 'rara' })));
ok(new Set(corrida.map((x) => x.id)).size === 20, 'vinte fabricações simultâneas, vinte números diferentes');
ok((await bicicletasDb.bicicletasDoJogador(a)).length === 21, 'as 21 bicicletas de A estão na lista dele');

secao('Mercado — escrow, cancelar e vender');
const an1 = await anunciar(a, NICKS[0], b1);
ok((await bicicletasDb.bicicletaPorId(b1.id)).anuncioId === an1.id, 'anunciar prende a bicicleta ao anúncio (escrow pela linha)');
ok((await bicicletasDb.bicicletasDoJogador(a)).find((x) => x.id === b1.id)?.anunciada === true, 'e ela aparece como "no Mercado" na lista do dono');
ok(await recusa(anunciar(a, NICKS[0], b1)) === 'bicicleta.naoDisponivel', 'a mesma bicicleta não entra em dois anúncios');
ok(await recusa(anunciar(b, NICKS[1], b1)) === 'bicicleta.naoDisponivel', 'ninguém anuncia a bicicleta dos outros');
{
  // Dois cliques ao mesmo tempo: só um anúncio pode prender a linha.
  const alvo = corrida[1];
  const duplo = await Promise.allSettled([anunciar(a, NICKS[0], alvo), anunciar(a, NICKS[0], alvo)]);
  ok(duplo.filter((r) => r.status === 'fulfilled').length === 1, 'dois anúncios simultâneos da mesma bicicleta: só um passa');
  const aberto = duplo.find((r) => r.status === 'fulfilled')?.value;
  if (aberto) await mdb.cancelarAnuncio({ id: aberto.id, vendedorId: a });
}

const outra = corrida[0];
const an2 = await anunciar(a, NICKS[0], outra);
ok(an2.id !== an1.id && an2.qtd === 1, 'duas Raras do mesmo vendedor, mesmo preço, NÃO empilham — o número é a mercadoria');
const cancelado = await mdb.cancelarAnuncio({ id: an2.id, vendedorId: a });
ok(cancelado.ficha.bicicletaId === outra.id && (await bicicletasDb.bicicletaPorId(outra.id)).anuncioId === null, 'cancelar devolve a bicicleta certa à mão do dono');
ok(!(String(BICICLETA_POR_RARIDADE.rara) in await itensDe(a)), 'e não soma nada em items — a bicicleta não vira quantidade');

await destravar(an1.id);
ok(await recusa(mdb.comprarAnuncio({ id: an1.id, compradorId: a, comprador: NICKS[0], qtd: 1, preco: 5000, moeda: 'gold' }))
  === 'não dá para comprar o próprio anúncio', 'o vendedor não compra o próprio anúncio');
ok(await recusa(mdb.comprarAnuncio({ id: an1.id, compradorId: b, comprador: NICKS[1], qtd: 1, preco: 1, moeda: 'gold' })) != null,
  'comprar por um preço menor do que o anunciado é recusado (a trava de preço vale para a bicicleta)');
const compra = await mdb.comprarAnuncio({ id: an1.id, compradorId: b, comprador: NICKS[1], qtd: 1, preco: 5000, moeda: 'gold' });
ok(compra.anuncio.ficha.bicicletaId === b1.id, 'a compra entrega a bicicleta anunciada');
const vendida = await bicicletasDb.bicicletaPorId(b1.id);
ok(vendida.donoId === b && vendida.anuncioId === null, 'ela muda de dono na transação e sai do escrow');
ok(vendida.criador === NICKS[0], 'quem tirou continua sendo o criador — o registro não esquece');
const recibo = await pool.query(`SELECT descricao FROM market_pagamentos WHERE anuncio_id = $1`, [an1.id]);
ok((recibo.rows[0]?.descricao ?? '').includes(numeroDaBicicleta(b1.id)), `o recibo do vendedor traz o número (${recibo.rows[0]?.descricao})`);
ok(await recusa(anunciar(a, NICKS[0], b1)) === 'bicicleta.naoDisponivel', 'quem vendeu não anuncia de novo');
ok(await recusa(mdb.comprarAnuncio({ id: an1.id, compradorId: b, comprador: NICKS[1], qtd: 1, preco: 5000, moeda: 'gold' })) === 'esse anúncio já saiu',
  'comprar de novo o mesmo anúncio é recusado — não há segunda entrega');

secao('Devolução por varredura');
const an3 = await anunciar(b, NICKS[1], b2);
await pool.query(`UPDATE market_anuncios SET preco = 1 WHERE id = $1`, [an3.id]);
const devolvidos = await mdb.devolverAnunciosPrecoGoldInvalido();
const meu = devolvidos.find((x) => x.id === an3.id);
ok(meu?.bicicletaId === b2.id, 'a varredura de preço inválido devolve o anúncio com o número da bicicleta');
ok((await bicicletasDb.bicicletaPorId(b2.id)).anuncioId === null, 'e solta o escrow');
ok(!(String(BICICLETA_POR_RARIDADE.lendaria) in await itensDe(b)), 'sem somar a bicicleta como item na bolsa');
{
  const an4 = await anunciar(b, NICKS[1], b2);
  await pool.query(`UPDATE market_anuncios SET expira_em = now() - interval '1 minute' WHERE id = $1`, [an4.id]);
  const expirados = await mdb.expirarAnuncios();
  const exp = expirados.find((x) => x.id === an4.id);
  ok(!exp || exp.bicicletaId === b2.id, 'a expiração (quando o anúncio tem prazo) também devolve pelo número');
  if (exp) ok((await bicicletasDb.bicicletaPorId(b2.id)).anuncioId === null, 'e solta o escrow');
  else await mdb.cancelarAnuncio({ id: an4.id, vendedorId: b });
}

secao('Registro de Bikes');
const an5 = await anunciar(b, NICKS[1], b2, 9000);
const reg = await bicicletasDb.registro({});
ok(reg.linhas[0].id >= corrida.at(-1).id, 'as mais novas primeiro');
ok(reg.contagem.total >= 22 && reg.contagem.lendaria >= 1, `a contagem vem por raridade (total ${reg.contagem.total}, lendárias ${reg.contagem.lendaria})`);
const soLendarias = await bicicletasDb.registro({ raridade: 'lendaria' });
ok(soLendarias.linhas.length > 0 && soLendarias.linhas.every((l) => l.raridade === 'lendaria'), 'o filtro de raridade só traz a raridade');
ok(soLendarias.total === reg.contagem.lendaria, 'e o total do filtro é a contagem daquela raridade');
const linhaB2 = soLendarias.linhas.find((l) => l.id === b2.id);
ok(linhaB2?.anuncio?.id === an5.id && linhaB2.anuncio.preco === 9000, 'a bicicleta à venda aparece com o preço do anúncio');
ok(linhaB2?.dono === NICKS[1] && linhaB2?.criador === NICKS[1], 'com o dono e quem tirou');
const lixo = await bicicletasDb.registro({ raridade: "' OR 1=1 --", pagina: -5 });
ok(lixo.raridade === null && lixo.pagina === 0, 'filtro com SQL e página negativa viram "todas, página 1"');
await mdb.cancelarAnuncio({ id: an5.id, vendedorId: b });

secao('Bicicleta-item que reaparece na bolsa depois da virada');
await pool.query(
  `UPDATE players SET items = jsonb_build_object($2::text, 3), bicicletas_legado = '{"comum":2}'::jsonb WHERE id = $1`,
  [a, String(BICICLETA_POR_RARIDADE.comum)],
);
const antes = (await bicicletasDb.bicicletasDoJogador(a)).length;
const conv = await bicicletasDb.converterBicicletasDaBolsa({ playerId: a, nick: NICKS[0], bolsa: { comum: 3 } });
ok(conv.criadas.length === 1 && conv.descartadas === 2, 'três na bolsa, duas já convertidas na virada: só UMA vira bicicleta nova');
ok((await bicicletasDb.bicicletasDoJogador(a)).length === antes + 1, 'e a lista cresce em uma');
const depois = (await pool.query('SELECT items, bicicletas_legado FROM players WHERE id = $1', [a])).rows[0];
ok(!(String(BICICLETA_POR_RARIDADE.comum) in depois.items) && JSON.stringify(depois.bicicletas_legado) === '{}',
  'a bicicleta-item sai da bolsa e a anotação da virada é consumida, na mesma transação');
const conv2 = await bicicletasDb.converterBicicletasDaBolsa({ playerId: a, nick: NICKS[0], bolsa: { comum: 1 } });
ok(conv2.criadas.length === 1 && conv2.descartadas === 0, 'consumida a anotação, uma bicicleta-item nova (do painel) vira bicicleta inteira');

secao('Anúncio de bicicleta ainda no formato de quantidade');
const { rows: velho } = await pool.query(
  `INSERT INTO market_anuncios (vendedor_id, vendedor, tipo, item_id, qtd, ficha, preco, moeda, estado)
   VALUES ($1, $2, 'item', $3, 2, '{"nome":"Rare Bicycle"}'::jsonb, 7000, 'gold', 'aberto') RETURNING id`,
  [a, NICKS[0], BICICLETA_POR_RARIDADE.mitica],
);
const miticasAntes = (await bicicletasDb.bicicletasDoJogador(a)).filter((x) => x.raridade === 'mitica').length;
const r = await bicicletasDb.numerarAnunciosAntigos();
const anuncioVelho = (await pool.query('SELECT qtd, ficha FROM market_anuncios WHERE id = $1', [velho[0].id])).rows[0];
ok(r.bicicletas >= 2, 'o lote de duas vira duas bicicletas numeradas');
ok(Number(anuncioVelho.qtd) === 1 && Number(anuncioVelho.ficha.bicicletaId) > 0, 'o anúncio continua de pé, agora por UMA bicicleta, com o número na ficha');
const miticasDepois = await bicicletasDb.bicicletasDoJogador(a);
ok(miticasDepois.filter((x) => x.raridade === 'mitica').length === miticasAntes + 2
  && miticasDepois.filter((x) => x.raridade === 'mitica' && x.anunciada).length === 1,
'uma fica no anúncio e a outra volta para a mão do vendedor');
ok((await bicicletasDb.numerarAnunciosAntigos()).bicicletas === 0, 'no boot seguinte não sobra anúncio antigo para numerar');

await limpar(ids);
await pool.end();
console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
