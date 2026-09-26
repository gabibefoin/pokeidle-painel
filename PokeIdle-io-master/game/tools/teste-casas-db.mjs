// Ensaio das CASAS NUMERADAS contra o Postgres local.
//
//     npm run test:casas-db
//
// O que ele cobre é o que só o banco responde: o número nascendo do `BIGSERIAL` sob corrida, o
// escrow da casa no Mercado (anunciar, recusar a segunda vez, cancelar, vender com o número no
// recibo), a devolução por varredura sem virar quantidade, o registro do servidor com a contagem
// por raridade, a casa-item que reaparece na bolsa depois da virada e o anúncio de casa ainda no
// formato de quantidade. As regras puras moram em `teste-casas.mjs`.
//
// Roda em dois jogadores próprios (`__casateste*`) e apaga no fim as casas e os anúncios deles. O
// número das casas apagadas não volta — é assim também em produção: o número conta casas abertas.
import { pool } from '../src/server/db.mjs';
import * as mdb from '../src/server/market-db.mjs';
import * as casasDb from '../src/server/casas-db.mjs';
import { numeroDaCasa } from '../src/shared/casas.mjs';
import { CASA_POR_RARIDADE } from '../src/server/game/itens-nossos.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, msg) => {
  testes++;
  if (!cond) falhas++;
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
};
const secao = (s) => console.log(`\n${s}`);
const recusa = (p) => p.then(() => null, (e) => e.message);

const NICKS = ['__casatestea', '__casatesteb'];

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
  await pool.query(`DELETE FROM casas WHERE dono_id = ANY($1::bigint[]) OR criador_id = ANY($1::bigint[])`, [ids]);
  await pool.query(`UPDATE players SET items = '{}'::jsonb, casas_legado = '{}'::jsonb WHERE id = ANY($1::bigint[])`, [ids]);
}

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.log(`Postgres indisponível (${err.message}) — suba com \`npm run infra\`.`);
  process.exit(1);
}

await mdb.migrar();
await casasDb.migrar();

const [a, b] = await Promise.all(NICKS.map(jogadorDeTeste));
const ids = [a, b];
await limpar(ids);

const anunciar = (vendedorId, vendedor, casa, preco = 5000) => mdb.criarAnuncio({
  vendedorId, vendedor, tipo: 'item',
  itemId: CASA_POR_RARIDADE[casa.raridade], qtd: 1, casaId: casa.id,
  ficha: { nome: 'House', categoria: 'casa', casaId: casa.id, numero: casa.id, casaRaridade: casa.raridade, npc: 0 },
  preco, moeda: 'gold', dias: null,
});
/** A retenção anti multi-conta sai do caminho: aqui o que se testa é a entrega. */
const destravar = (id) => pool.query(`UPDATE market_anuncios SET compravel_em = now() - interval '1 minute' WHERE id = $1`, [id]);

secao('A virada');
{
  const { rows } = await pool.query(`SELECT valor FROM game_meta WHERE chave = 'casas_numeradas_v1'`);
  ok(rows.length === 1, `a numeração das casas antigas rodou e ficou marcada (${rows[0]?.valor ?? '—'})`);
  const segunda = await casasDb.numerarCasasLegadas();
  ok(segunda.feito === false, 'rodar de novo não numera nada: é uma vez só');
}

secao('Numeração');
const c1 = await casasDb.criarCasa({ donoId: a, nick: NICKS[0], raridade: 'comum' });
const c2 = await casasDb.criarCasa({ donoId: b, nick: NICKS[1], raridade: 'lendaria' });
ok(c2.id > c1.id, `a segunda casa vem depois da primeira (${numeroDaCasa(c1.id)} → ${numeroDaCasa(c2.id)})`);
ok(c1.raridade === 'comum' && c1.anunciada === false && c1.criador === NICKS[0], 'nasce com a raridade, na mão do dono, com o criador');
ok(await recusa(casasDb.criarCasa({ donoId: a, nick: NICKS[0], raridade: 'lendaria ' })) === 'casa.invalida', 'raridade adulterada não vira casa');

secao('Corrida — vinte casas ao mesmo tempo');
const corrida = await Promise.all(Array.from({ length: 20 }, () => casasDb.criarCasa({ donoId: a, nick: NICKS[0], raridade: 'comum' })));
ok(new Set(corrida.map((c) => c.id)).size === 20, 'vinte fabricações simultâneas, vinte números diferentes');
ok((await casasDb.casasDoJogador(a)).length === 21, 'as 21 casas de A estão na lista dele');

secao('Mercado — escrow, cancelar e vender');
const an1 = await anunciar(a, NICKS[0], c1);
ok((await casasDb.casaPorId(c1.id)).anuncioId === an1.id, 'anunciar prende a casa ao anúncio (escrow pela linha)');
ok((await casasDb.casasDoJogador(a)).find((c) => c.id === c1.id)?.anunciada === true, 'e ela aparece como "no Mercado" na lista do dono');
ok(await recusa(anunciar(a, NICKS[0], c1)) === 'casa.naoDisponivel', 'a mesma casa não entra em dois anúncios');
ok(await recusa(anunciar(b, NICKS[1], c1)) === 'casa.naoDisponivel', 'ninguém anuncia a casa dos outros');

const outra = corrida[0];
const an2 = await anunciar(a, NICKS[0], outra);
ok(an2.id !== an1.id && an2.qtd === 1, 'duas Comuns do mesmo vendedor, mesmo preço, NÃO empilham — o número é a mercadoria');
const cancelado = await mdb.cancelarAnuncio({ id: an2.id, vendedorId: a });
ok(cancelado.ficha.casaId === outra.id && (await casasDb.casaPorId(outra.id)).anuncioId === null, 'cancelar devolve a casa certa à mão do dono');
ok(!(String(CASA_POR_RARIDADE.comum) in ((await pool.query('SELECT items FROM players WHERE id = $1', [a])).rows[0].items ?? {})),
  'e não soma nada em items — a casa não vira quantidade');

await destravar(an1.id);
const compra = await mdb.comprarAnuncio({ id: an1.id, compradorId: b, comprador: NICKS[1], qtd: 1, preco: 5000, moeda: 'gold' });
ok(compra.anuncio.ficha.casaId === c1.id, 'a compra entrega a casa anunciada');
const vendida = await casasDb.casaPorId(c1.id);
ok(vendida.donoId === b && vendida.anuncioId === null, 'ela muda de dono na transação e sai do escrow');
ok(vendida.criador === NICKS[0], 'quem tirou continua sendo o criador — o registro não esquece');
const recibo = await pool.query(`SELECT descricao FROM market_pagamentos WHERE anuncio_id = $1`, [an1.id]);
ok((recibo.rows[0]?.descricao ?? '').includes(numeroDaCasa(c1.id)), `o recibo do vendedor traz o número (${recibo.rows[0]?.descricao})`);
ok(await recusa(anunciar(a, NICKS[0], c1)) === 'casa.naoDisponivel', 'quem vendeu não anuncia de novo');

secao('Devolução por varredura');
const an3 = await anunciar(b, NICKS[1], c2);
await pool.query(`UPDATE market_anuncios SET preco = 1 WHERE id = $1`, [an3.id]);
const devolvidos = await mdb.devolverAnunciosPrecoGoldInvalido();
const meu = devolvidos.find((x) => x.id === an3.id);
ok(meu?.casaId === c2.id, 'a varredura de preço inválido devolve o anúncio com o número da casa');
ok((await casasDb.casaPorId(c2.id)).anuncioId === null, 'e solta o escrow');
ok(!(String(CASA_POR_RARIDADE.lendaria) in ((await pool.query('SELECT items FROM players WHERE id = $1', [b])).rows[0].items ?? {})),
  'sem somar a casa como item na bolsa');

secao('Registro do servidor');
const an4 = await anunciar(b, NICKS[1], c2, 9000);
const reg = await casasDb.registro({});
ok(reg.linhas[0].id >= corrida.at(-1).id, 'as mais novas primeiro');
ok(reg.contagem.total >= 22 && reg.contagem.lendaria >= 1, `a contagem vem por raridade (total ${reg.contagem.total}, lendárias ${reg.contagem.lendaria})`);
const soLendarias = await casasDb.registro({ raridade: 'lendaria' });
ok(soLendarias.linhas.length > 0 && soLendarias.linhas.every((l) => l.raridade === 'lendaria'), 'o filtro de raridade só traz a raridade');
ok(soLendarias.total === reg.contagem.lendaria, 'e o total do filtro é a contagem daquela raridade');
const linhaC2 = soLendarias.linhas.find((l) => l.id === c2.id);
ok(linhaC2?.anuncio?.id === an4.id && linhaC2.anuncio.preco === 9000, 'a casa à venda aparece com o preço do anúncio');
ok(linhaC2?.dono === NICKS[1] && linhaC2?.criador === NICKS[1], 'com o dono e quem tirou');
const lixo = await casasDb.registro({ raridade: '__proto__', pagina: -5 });
ok(lixo.raridade === null && lixo.pagina === 0, 'filtro e página adulterados viram "todas, página 1"');

secao('Casa-item que reaparece na bolsa depois da virada');
await pool.query(
  `UPDATE players SET items = jsonb_build_object($2::text, 3), casas_legado = '{"comum":2}'::jsonb WHERE id = $1`,
  [a, String(CASA_POR_RARIDADE.comum)],
);
const antes = (await casasDb.casasDoJogador(a)).length;
const conv = await casasDb.converterCasasDaBolsa({ playerId: a, nick: NICKS[0], bolsa: { comum: 3 } });
ok(conv.criadas.length === 1 && conv.descartadas === 2, 'três na bolsa, duas já convertidas na virada: só UMA vira casa nova');
ok((await casasDb.casasDoJogador(a)).length === antes + 1, 'e a lista cresce em uma');
const depois = (await pool.query('SELECT items, casas_legado FROM players WHERE id = $1', [a])).rows[0];
ok(!(String(CASA_POR_RARIDADE.comum) in depois.items) && JSON.stringify(depois.casas_legado) === '{}',
  'a casa-item sai da bolsa e a anotação da virada é consumida, na mesma transação');
const conv2 = await casasDb.converterCasasDaBolsa({ playerId: a, nick: NICKS[0], bolsa: { comum: 1 } });
ok(conv2.criadas.length === 1 && conv2.descartadas === 0, 'consumida a anotação, uma casa-item nova (do painel, por exemplo) vira casa inteira');

secao('Anúncio de casa ainda no formato de quantidade');
const { rows: velho } = await pool.query(
  `INSERT INTO market_anuncios (vendedor_id, vendedor, tipo, item_id, qtd, ficha, preco, moeda, estado)
   VALUES ($1, $2, 'item', $3, 2, '{"nome":"Rare House"}'::jsonb, 7000, 'gold', 'aberto') RETURNING id`,
  [a, NICKS[0], CASA_POR_RARIDADE.rara],
);
const rarasAntes = (await casasDb.casasDoJogador(a)).filter((c) => c.raridade === 'rara').length;
const r = await casasDb.numerarAnunciosAntigos();
const anuncioVelho = (await pool.query('SELECT qtd, ficha FROM market_anuncios WHERE id = $1', [velho[0].id])).rows[0];
ok(r.casas >= 2, 'o lote de duas vira duas casas numeradas');
ok(Number(anuncioVelho.qtd) === 1 && Number(anuncioVelho.ficha.casaId) > 0, 'o anúncio continua de pé, agora por UMA casa, com o número na ficha');
const rarasDepois = await casasDb.casasDoJogador(a);
ok(rarasDepois.filter((c) => c.raridade === 'rara').length === rarasAntes + 2
  && rarasDepois.filter((c) => c.raridade === 'rara' && c.anunciada).length === 1,
'uma fica no anúncio e a outra volta para a mão do vendedor');
ok((await casasDb.numerarAnunciosAntigos()).casas === 0, 'no boot seguinte não sobra anúncio antigo para numerar');

await limpar(ids);
await pool.end();
console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
