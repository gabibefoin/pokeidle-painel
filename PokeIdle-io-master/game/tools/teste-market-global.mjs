// Teste do Mercado Global (anúncios entre jogadores). Precisa do Postgres no ar
// (`npm run infra`) — o ponto do sistema é ser transacional, e testar isso sem banco
// testaria outra coisa. O `teste-market.mjs`, ao lado, é o do mercado do NPC.
//
// O que este arquivo existe para provar, em ordem de importância:
//
//   1. o ESCROW segura de verdade — anunciar tira da mão, e o mesmo pokémon não pode ir
//      para dois anúncios (o caso dos dois cliques / duas abas);
//   2. a compra é ATÔMICA — ou o comprador recebe e o vendedor tem pagamento na caixa
//      postal, ou nada aconteceu;
//   3. o pagamento é recolhido UMA VEZ só, mesmo com duas chamadas concorrentes;
//   4. a comissão de 15% em ORB sai do vendedor, não do comprador.
//
//   node tools/teste-market-global.mjs
import { pool } from '../src/server/db.mjs';
import * as db from '../src/server/db.mjs';
import * as odb from '../src/server/orbs-db.mjs';
import * as mdb from '../src/server/market-db.mjs';
import { TAXA_ORB, TAXA_GOLD, liquidoDoVendedor, MAX_ANUNCIOS } from '../src/server/market-db.mjs';
import { itens, itemAnunciavelMercado, IDS_MERCADO_PERMITIDOS } from '../src/server/content.mjs';
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
const pega = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

/** Anúncios novos ficam 2 min em retenção; libera compra nos testes que não são de retenção. */
const liberarCompra = (id) =>
  pool.query(`UPDATE market_anuncios SET compravel_em = now() - interval '1 second' WHERE id = $1`, [id]);
const comprarLiberado = async (opts) => {
  await liberarCompra(opts.id);
  return mdb.comprarAnuncio(opts);
};
/** Edição só é permitida fora da retenção; nos testes de golpe liberamos antes de cada edit. */
const editarLiberado = async (opts) => {
  await liberarCompra(opts.id);
  return mdb.editarAnuncio(opts);
};

await db.aguardarBanco();
await db.migrar();
await odb.migrar();
await mdb.migrar();

const marca = Date.now() % 1000000;
const criar = async (nick) => {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, gold) VALUES ($1, 1000000) RETURNING id`, [nick]);
  return Number(rows[0].id);
};
const vendedorId = await criar(`mkvend${marca}`);
const compradorId = await criar(`mkcomp${marca}`);
const outroId = await criar(`mkout${marca}`);

const novoPokemon = async (donoId) => {
  const { rows } = await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, ivs, hp, power)
     VALUES ($1, 6, 87, '{"hp":30}'::jsonb, 100, 5000) RETURNING id`, [donoId]);
  return Number(rows[0].id);
};
const orbsDe = async (id) => Number((await pool.query(`SELECT orbs FROM players WHERE id=$1`, [id])).rows[0].orbs);
const darOrbs = (id, n) => pool.query(`UPDATE players SET orbs = orbs + $2 WHERE id = $1`, [id, n]);

// ------------------------------------------------------------------ taxa
secao('Comissão');
ok(TAXA_ORB === 0.15, 'ORB cobra 15%');
ok(TAXA_GOLD === 0.10, 'Coins cobra 10%');
ok(liquidoDoVendedor(1000, 'gold') === 900, 'Coins: 1000 vira 900 para o vendedor');
ok(liquidoDoVendedor(1000, 'orb') === 850, 'ORB: 1000 vira 850 para o vendedor');

// ---------------------------------------------------------------- escrow
secao('Escrow do pokémon');
const pokeId = await novoPokemon(vendedorId);
const anuncioPk = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'pokemon', pokemonId: pokeId, qtd: 1,
  ficha: { nome: 'Charizard', level: 87 }, preco: 5000, moeda: 'gold',
});
const escrow = (await pool.query(`SELECT anuncio_id, slot FROM player_pokemon WHERE id=$1`, [pokeId])).rows[0];
ok(Number(escrow.anuncio_id) === anuncioPk.id, 'anunciar carimba o anuncio_id no pokémon');
ok(escrow.slot === null, 'e o tira do time');

// É isto que impede vender no NPC um pokémon que já está na vitrine.
const carregado = await db.carregarOuCriarJogador(`mkvend${marca}`);
ok(!carregado.pokemons.some((k) => Number(k.id) === pokeId), 'o sim não carrega mais o pokémon anunciado');

const erroDuplo = await pega(() => mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'pokemon', pokemonId: pokeId, qtd: 1,
  ficha: {}, preco: 999, moeda: 'gold',
}));
ok(!!erroDuplo, 'o MESMO pokémon não entra em dois anúncios', erroDuplo ? '' : 'passou!');
ok((await mdb.meusAnuncios(vendedorId)).length === 1, 'e a tentativa falha inteira, sem anúncio órfão');

// --------------------------------------------------------------- cancelar
secao('Cancelar');
const cancelado = await mdb.cancelarAnuncio({ id: anuncioPk.id, vendedorId });
ok(cancelado.tipo === 'pokemon', 'cancelar devolve o que era');
const solto = (await pool.query(`SELECT anuncio_id FROM player_pokemon WHERE id=$1`, [pokeId])).rows[0];
ok(solto.anuncio_id === null, 'e solta o escrow do pokémon');
ok(!!(await pega(() => mdb.cancelarAnuncio({ id: anuncioPk.id, vendedorId }))),
  'cancelar duas vezes não devolve duas vezes');

// -------------------------------------------------------- starter travado
secao('Starter travado');
const pkStarter = await novoPokemon(vendedorId);
await pool.query(`UPDATE player_pokemon SET starter = true WHERE id = $1`, [pkStarter]);
ok(
  !!(await pega(() =>
    mdb.criarAnuncio({
      vendedorId,
      vendedor: 'vend',
      tipo: 'pokemon',
      pokemonId: pkStarter,
      qtd: 1,
      ficha: { nome: 'Bulbasaur', level: 5 },
      preco: 1000,
      moeda: 'gold',
    }),
  )),
  'starter não pode ser anunciado',
);

// ---------------------------------------------------------- compra em ouro
secao('Compra em Coins');
const pk2 = await novoPokemon(vendedorId);
const a2 = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'pokemon', pokemonId: pk2, qtd: 1,
  ficha: { nome: 'Charizard', level: 87 }, preco: 50000, moeda: 'gold',
});
const compra = await comprarLiberado({ id: a2.id, compradorId, comprador: 'comp', preco: 50000, moeda: 'gold' });
ok(compra.total === 50000, 'total = preço × quantidade');
ok(compra.liquido === 45000, 'em Coins o vendedor recebe 90% (10% de comissão)');

const dono = (await pool.query(`SELECT player_id, anuncio_id FROM player_pokemon WHERE id=$1`, [pk2])).rows[0];
ok(Number(dono.player_id) === compradorId, 'o pokémon troca de dono');
ok(dono.anuncio_id === null, 'e sai do escrow');
ok(!!(await pega(() => comprarLiberado({ id: a2.id, compradorId, comprador: 'comp', preco: 50000, moeda: 'gold' }))),
  'anúncio vendido não vende de novo');

const pk3 = await novoPokemon(vendedorId);
const a3 = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'pokemon', pokemonId: pk3, qtd: 1,
  ficha: {}, preco: 10, moeda: 'gold',
});
ok(!!(await pega(() => comprarLiberado({ id: a3.id, compradorId: vendedorId, comprador: 'vend', preco: 10, moeda: 'gold' }))),
  'ninguém compra o próprio anúncio');
await mdb.cancelarAnuncio({ id: a3.id, vendedorId });

// ------------------------------------------------------------ caixa postal
secao('Caixa postal');
const pag1 = await mdb.recolherPagamentos(vendedorId);
ok(pag1.gold === 45000, 'o vendedor recebe os 45.000 líquidos em Coins', `veio ${pag1.gold}`);
ok(pag1.recibos.length === 1, 'com um recibo descrevendo a venda');
const pag2 = await mdb.recolherPagamentos(vendedorId);
ok(pag2.gold === 0 && !pag2.recibos.length, 'recolher de novo não paga em dobro');

// -------------------------------------------------------- compra PARCIAL
//
// O anúncio de item é ESTOQUE, não pacote fechado: quem anuncia 100 pedras não está pedindo
// que alguém leve as 100. Cada compra tira uma fatia e o anúncio segue na vitrine com o resto.
secao('Compra parcial');

const lote = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'item', itemId: 142, qtd: 10,
  ficha: { nome: 'Water Stone' }, preco: 200, moeda: 'gold',
});

const fatia = await comprarLiberado({ id: lote.id, compradorId, comprador: 'comp', qtd: 3, preco: 200, moeda: 'gold' });
ok(fatia.total === 600, 'cobra preço × PEDIDO, não o lote inteiro', `veio ${fatia.total}`);
ok(fatia.anuncio.qtd === 3, 'o sim entrega as 3 unidades pedidas');
ok(fatia.sobra === 7, 'e sobram 7 no anúncio');

const depois = await mdb.anuncioPorId(lote.id);
ok(depois.estado === 'aberto', 'o anúncio continua ABERTO com o resto');
ok(depois.qtd === 7, 'e com a quantidade baixada', `veio ${depois.qtd}`);
ok(depois.comprador === null, 'sem carimbar comprador — o lote ainda é de todos');

ok((await pega(() => comprarLiberado({ id: lote.id, compradorId, comprador: 'comp', qtd: 8, preco: 200, moeda: 'gold' })))
  ?.includes('só restam 7'), 'pedir mais do que resta é erro, e o erro diz quanto sobrou');
ok((await mdb.anuncioPorId(lote.id)).qtd === 7, 'e a recusa não mexeu no estoque');

ok(!!(await pega(() => comprarLiberado({ id: lote.id, compradorId, comprador: 'comp', qtd: 0, preco: 200, moeda: 'gold' }))),
  'quantidade zero é recusada');

// A última fatia fecha o anúncio e é aí que o comprador fica registrado.
const ultima = await comprarLiberado({ id: lote.id, compradorId, comprador: 'comp', qtd: 7, preco: 200, moeda: 'gold' });
ok(ultima.sobra === 0, 'levar o resto zera o estoque');
const fechado = await mdb.anuncioPorId(lote.id);
ok(fechado.estado === 'vendido', 'e fecha o anúncio');
ok(fechado.comprador === 'comp', 'aí sim com o comprador que fechou');

// Duas compras parciais = dois recibos, um por compra. É o extrato do vendedor.
const recibos = (await pool.query(
  `SELECT descricao, valor FROM market_pagamentos WHERE anuncio_id = $1 ORDER BY id`, [lote.id])).rows;
ok(recibos.length === 2, 'cada fatia deixa o seu recibo na caixa postal');
ok(recibos[0].descricao === '3× Water Stone' && recibos[1].descricao === '7× Water Stone',
  'e o recibo descreve o que saiu em cada uma', JSON.stringify(recibos.map((r) => r.descricao)));
ok(Number(recibos[0].valor) + Number(recibos[1].valor) === 1800, 'somando o lote inteiro: 10 × 200, líquido 90%');

// -------------------------------------------- pilha de item e trava do reanúncio
//
// Mesmo item, mesmo preço, mesma moeda → uma linha só. Item não paga pensão da feira, então
// não há motivo para duplicar anúncio só porque o vendedor publicou em dias diferentes.
//
// E preço DIFERENTE não abre linha nenhuma: é um anúncio por item (ver `REANUNCIO_MS`). Era
// por essa fresta que uma fazenda de contas anunciava a mesma pedra a 50.000, 49.999, 49.998
// e enchia a vitrine sozinha.
secao('Pilha de item (mesmo preço) e trava do reanúncio');

const pilha1 = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'item', itemId: 70000, qtd: 9,
  ficha: { nome: 'Bronze Boss Token' }, preco: 4, moeda: 'orb',
});
const pilha2 = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'item', itemId: 70000, qtd: 2,
  ficha: { nome: 'Bronze Boss Token' }, preco: 4, moeda: 'orb',
});
ok(pilha2.id === pilha1.id, 'reanunciar no mesmo preço reutiliza a linha', `${pilha1.id} vs ${pilha2.id}`);
ok(pilha2.qtd === 11, 'e soma o estoque', `veio ${pilha2.qtd}`);

const travaPreco = await pega(() => mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'item', itemId: 70000, qtd: 1,
  ficha: { nome: 'Bronze Boss Token' }, preco: 5, moeda: 'orb',
}));
ok(travaPreco === 'market.travaItemAberto', 'preço diferente NÃO abre outra linha', `veio: ${travaPreco}`);
// Trocar de moeda escapava do empilhamento pelo mesmo buraco, e é a mesma escada.
const travaMoeda = await pega(() => mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'item', itemId: 70000, qtd: 1,
  ficha: { nome: 'Bronze Boss Token' }, preco: 4, moeda: 'gold',
}));
ok(travaMoeda === 'market.travaItemAberto', 'outra moeda também não', `veio: ${travaMoeda}`);
ok((await mdb.meusAnuncios(vendedorId)).filter((a) => a.itemId === 70000).length === 1,
  'fica UMA linha aberta do item');

await mdb.cancelarAnuncio({ id: pilha1.id, vendedorId });

// Saiu da vitrine agora: a espera de 30 minutos vale mesmo com a bolsa cheia de pedras.
const travaEspera = await pega(() => mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'item', itemId: 70000, qtd: 1,
  ficha: { nome: 'Bronze Boss Token' }, preco: 5, moeda: 'orb',
}));
ok(travaEspera === 'market.travaItemEspera', 'e logo depois de sair ainda recusa', `veio: ${travaEspera}`);

// Pokémon é peça única: `qtd` não tem como ser fatiado, mesmo pedindo.
const pkU = await novoPokemon(vendedorId);
const aU = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'pokemon', pokemonId: pkU, qtd: 1,
  ficha: { nome: 'Charizard', level: 87 }, preco: 100, moeda: 'gold',
});
const compraU = await comprarLiberado({ id: aU.id, compradorId, comprador: 'comp', qtd: 5, preco: 100, moeda: 'gold' });
ok(compraU.total === 100 && compraU.anuncio.qtd === 1, 'pokémon ignora a quantidade pedida e vai como 1');
ok((await mdb.anuncioPorId(aU.id)).estado === 'vendido', 'e o anúncio fecha');

// ------------------------------------------------------------ compra em ORB
secao('Compra em ORB');
await darOrbs(compradorId, 10000);
const orbsCompAntes = await orbsDe(compradorId);
const orbsVendAntes = await orbsDe(vendedorId);

// Item PRÓPRIO para este caso: o 142 acabou de ser vendido aqui em cima e a trava do
// reanúncio (ver `REANUNCIO_MS`) recusaria — o que se quer medir agora é a compra em ORB.
const a4 = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'item', itemId: 143, qtd: 2,
  ficha: { nome: 'Fire Stone' }, preco: 500, moeda: 'orb',
});
const compraOrb = await comprarLiberado({ id: a4.id, compradorId, comprador: 'comp', preco: 500, moeda: 'orb' });
ok(compraOrb.total === 1000, 'o comprador paga preço × qtd = 1000');
ok(compraOrb.liquido === 850, 'e o vendedor tem 850 a receber (15% de comissão)');
ok((await orbsDe(compradorId)) === orbsCompAntes - 1000, 'as ORBs saem do comprador na hora');
ok((await orbsDe(vendedorId)) === orbsVendAntes, 'e NÃO entram no vendedor antes de recolhidas');

const pagOrb = await mdb.recolherPagamentos(vendedorId);
ok(pagOrb.orbs === 850, 'recolher credita os 850 líquidos', `veio ${pagOrb.orbs}`);
ok((await orbsDe(vendedorId)) === orbsVendAntes + 850, 'e o saldo bate');

const { rows: soma } = await pool.query(
  `SELECT COALESCE(SUM(delta),0)::bigint AS s FROM orb_ledger WHERE player_id = $1`, [vendedorId]);
ok(Number(soma[0].s) === (await orbsDe(vendedorId)), 'ledger do vendedor bate com o saldo');

const a5 = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'item', itemId: 144, qtd: 1,
  ficha: { nome: 'Thunder Stone' }, preco: 99999999, moeda: 'orb',
});
ok(!!(await pega(() => comprarLiberado({ id: a5.id, compradorId, comprador: 'comp', preco: 99999999, moeda: 'orb' }))),
  'sem ORB suficiente a compra é recusada');
ok((await mdb.anuncioPorId(a5.id)).estado === 'aberto', 'e o anúncio continua aberto (rollback completo)');

// ------------------------------------------------- o golpe da troca de preço
//
// O ataque, em quatro passos:
//
//   1. o vendedor anuncia um pokémon por 2 Coins (mínimo com taxa);
//   2. o comprador vê "2" na vitrine e clica em comprar;
//   3. antes de a mensagem chegar, o vendedor edita o anúncio para 20.000;
//   4. sem trava, a transação lia o preço ATUAL e debitava as 20.000.
//
// O `FOR UPDATE` nunca protegeu contra isto: ele serializa as escritas, mas a edição acontece
// inteirinha ANTES da compra chegar — não há corrida, só um preço diferente do mostrado. A
// defesa é o preço COMBINADO viajar com a compra.
secao('Golpe da troca de preço (time-of-check / time-of-use)');

const pkG = await novoPokemon(vendedorId);
const aG = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'pokemon', pokemonId: pkG, qtd: 1,
  ficha: { nome: 'Charizard', level: 87 }, preco: 2, moeda: 'gold',
});

// O comprador viu 2. O vendedor sobe para 20.000 antes de a compra chegar (fora da retenção).
await editarLiberado({ id: aG.id, vendedorId, preco: 20000, moeda: 'gold' });
const golpe = await pega(() =>
  comprarLiberado({ id: aG.id, compradorId, comprador: 'comp', preco: 2, moeda: 'gold' }));
ok(golpe?.includes('subiu'), 'preço que SOBE depois do clique é recusado', `veio: ${golpe}`);
ok((await mdb.anuncioPorId(aG.id)).estado === 'aberto', 'e o anúncio continua aberto (nada foi cobrado)');

// A mesma armadilha pela MOEDA: 2 Coins viram 2 gemas (mínimo válido), que valem muito mais.
await editarLiberado({ id: aG.id, vendedorId, preco: mdb.PRECO_MIN_ORB, moeda: 'orb' });
const trocaMoeda = await pega(() =>
  comprarLiberado({ id: aG.id, compradorId, comprador: 'comp', preco: 2, moeda: 'gold' }));
ok(trocaMoeda?.includes('moeda'), 'trocar a MOEDA depois do clique também é recusado', `veio: ${trocaMoeda}`);

// Cliente velho, que não manda preço nenhum: fecha por baixo.
await editarLiberado({ id: aG.id, vendedorId, preco: 2, moeda: 'gold' });
const semPreco = await pega(() =>
  comprarLiberado({ id: aG.id, compradorId, comprador: 'comp' }));
ok(!!semPreco, 'compra sem preço declarado é recusada (cliente antigo)', `veio: ${semPreco}`);

// Preço que CAI é aceito, e cobra o novo: o comprador topou pagar até aquilo, e pagar menos
// não pode prejudicá-lo. Recusar aqui seria uma falha inventada.
await editarLiberado({ id: aG.id, vendedorId, preco: 30, moeda: 'gold' });
const baixou = await comprarLiberado({
  id: aG.id, compradorId, comprador: 'comp', preco: 100, moeda: 'gold',
});
ok(baixou.total === 30, 'preço que CAI é aceito e cobra o novo, mais barato', `veio ${baixou.total}`);

// Esvazia a caixa postal do vendedor: a venda acima deixou 30 de ouro lá, e o teste de
// concorrência logo abaixo confere um VALOR exato do que foi recolhido.
await mdb.recolherPagamentos(vendedorId);

// ------------------------------------------------------------- concorrência
secao('Dois compradores no mesmo anúncio');
const pk6 = await novoPokemon(vendedorId);
const a6 = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'pokemon', pokemonId: pk6, qtd: 1,
  ficha: { nome: 'Charizard', level: 87 }, preco: 2, moeda: 'gold',
});
const corrida = await Promise.allSettled([
  comprarLiberado({ id: a6.id, compradorId, comprador: 'comp', preco: 2, moeda: 'gold' }),
  comprarLiberado({ id: a6.id, compradorId: outroId, comprador: 'outro', preco: 2, moeda: 'gold' }),
]);
ok(corrida.filter((r) => r.status === 'fulfilled').length === 1,
  'exatamente UM dos dois leva', `venceram ${corrida.filter((r) => r.status === 'fulfilled').length}`);

const dobro = await Promise.all([mdb.recolherPagamentos(vendedorId), mdb.recolherPagamentos(vendedorId)]);
ok(dobro[0].gold + dobro[1].gold === 1, 'recolher concorrente soma 1, não 2',
  `veio ${dobro[0].gold} + ${dobro[1].gold}`);

// -------------------------------------------------------------- vitrine
secao('Vitrine');
// O lote de Water Stone da compra parcial já saiu inteiro: a busca precisa de um aberto dela,
// e não de um que por acaso exista no banco de quem roda. Vendido pelo `outro`, porque o
// vendedor está na trava de reanúncio desta pedra desde aquela venda.
const aberto = await mdb.criarAnuncio({
  vendedorId: outroId, vendedor: 'out', tipo: 'item', itemId: 142, qtd: 1,
  ficha: { nome: 'Water Stone' }, preco: 300, moeda: 'gold',
});
const vitrine = await mdb.listar({ busca: 'Water Stone' });
ok(vitrine.linhas.some((l) => l.id === aberto.id), 'a busca acha o que está aberto');
ok(vitrine.linhas.every((l) => (l.ficha.nome ?? '').includes('Water')), 'e filtra pelo nome da ficha');
ok(vitrine.linhas.every((l) => l.estado === 'aberto'), 'só traz anúncios abertos');
ok(!vitrine.linhas.some((l) => l.id === lote.id), 'e não traz o lote que já foi vendido');
ok((await mdb.listar({ tipo: 'pokemon' })).linhas.every((l) => l.tipo === 'pokemon'), 'filtro por tipo funciona');
ok((await mdb.meusAnuncios(vendedorId)).length < MAX_ANUNCIOS, `abaixo do teto de ${MAX_ANUNCIOS}`);
await mdb.cancelarAnuncio({ id: aberto.id, vendedorId: outroId });

// ------------------------------------------------------ filtros e ordenação
//
// Três anúncios de pokémon montados de propósito para que cada ordenação tenha um vencedor
// DIFERENTE — se as cinco devolvessem a mesma linha no topo, o teste passaria com o `ORDER BY`
// quebrado. O `caro` é o mais caro e o mais recente; o `forte` é o de maior nível e potência;
// o `barato` é o mais barato.
secao('Filtros e ordenação');

const anunciarPk = async (ficha, preco) => {
  const id = await novoPokemon(outroId);
  return mdb.criarAnuncio({
    vendedorId: outroId, vendedor: 'out', tipo: 'pokemon', pokemonId: id, qtd: 1,
    ficha, preco, moeda: 'gold',
  });
};
// speciesId 6 = Charizard (FIRE/FLYING), 9 = Blastoise (WATER).
const aBarato = await anunciarPk({ nome: `Zorb${marca}`, level: 10, speciesId: 6, potencia: 1, ivTotal: 30, quality: 0.9, nota: 2.5 }, 10);
const aForte = await anunciarPk({ nome: `Zorb${marca}`, level: 99, speciesId: 9, potencia: 5, shiny: true, ivTotal: 150, quality: 1.5, nota: 4.6 }, 500);
const aCaro = await anunciarPk({ nome: `Zorb${marca}`, level: 50, speciesId: 6, potencia: 3, ivTotal: 100, quality: 1.2, nota: 3.9 }, 9000);

const soMeus = { tipo: 'pokemon', busca: `Zorb${marca}` };
const topo = async (ordem) => (await mdb.listar({ ...soMeus, ordem })).linhas[0]?.id;

ok(await topo('recentes') === aCaro.id, 'ordem "recentes" traz o último publicado');
ok(await topo('baratos') === aBarato.id, 'ordem "menor preço" traz o de 10');
ok(await topo('caros') === aCaro.id, 'ordem "maior preço" traz o de 9.000');
ok(await topo('nivel') === aForte.id, 'ordem "maior nível" traz o nível 99');
ok(await topo('potencia') === aForte.id, 'ordem "maior poder" traz a potência 5');
ok(await topo('inventada') === aCaro.id, 'ordem desconhecida cai em "recentes" em vez de estourar');

const shinys = await mdb.listar({ ...soMeus, soShiny: true });
ok(shinys.linhas.length === 1 && shinys.linhas[0].id === aForte.id, 'o filtro "só shiny" traz só o shiny');

const p5s = await mdb.listar({ ...soMeus, soP5: true });
ok(p5s.linhas.length === 1 && p5s.linhas[0].id === aForte.id, 'o filtro "só P5" traz só potência 5');

const iv80 = await mdb.listar({ ...soMeus, ivMin: 80 });
ok(iv80.linhas.length === 2 && iv80.linhas.every((l) => (l.ficha.ivTotal ?? 0) >= 80),
  'IV mínimo 80 exclui o fraco');

const pot3 = await mdb.listar({ ...soMeus, potenciaMin: 3 });
ok(pot3.linhas.length === 2 && pot3.linhas.every((l) => (l.ficha.potencia ?? 0) >= 3),
  'potência mínima 3 traz P3 e P5');

const nv50 = await mdb.listar({ ...soMeus, nivelMin: 50 });
ok(nv50.linhas.length === 2 && nv50.linhas.every((l) => (l.ficha.level ?? 0) >= 50),
  'nível mínimo 50 exclui o de level 10');

const qual14 = await mdb.listar({ ...soMeus, qualidadeMin: 1.4 });
ok(qual14.linhas.length === 1 && qual14.linhas[0].id === aForte.id,
  'qualidade mínima 1,4 traz só o melhor');

// A VÍRGULA do teclado em português. `Number('1,4')` é NaN, e um NaN aqui não dá erro: cai no
// ramo de "sem filtro" e devolve a vitrine inteira — o pior defeito possível num filtro, que é
// o de não filtrar em silêncio. A tela já manda ponto; isto é a rede embaixo.
ok(mdb.parseQualidadeMinFiltro('1,4') === 1.4, 'a qualidade aceita vírgula, não só ponto');
const qualVirgula = await mdb.listar({ ...soMeus, qualidadeMin: '1,4' });
ok(qualVirgula.linhas.length === 1 && qualVirgula.linhas[0].id === aForte.id,
  'qualidade mínima "1,4" recorta igual a 1.4');

// Fora da faixa não é "sem filtro": abaixo do mínimo da espécie o filtro não existe, e acima
// do máximo ele encosta no teto em vez de zerar a vitrine.
ok(mdb.parseIvMinFiltro('999') === 192 && mdb.parseIvMinFiltro('5') === null,
  'IV fora da faixa: 999 vira 192 e 5 vira "sem filtro"');
ok(mdb.parsePotenciaMinFiltro('9') === 5 && mdb.parsePotenciaMinFiltro('0') === null,
  'potência fora da faixa: 9 vira 5 e 0 vira "sem filtro"');

// As FAIXAS: piso e teto juntos. "Nota de 3,8 a 4,1" é o pedido que as trouxe.
const ids = (r) => r.linhas.map((l) => l.id).sort();
const nota3841 = await mdb.listar({ ...soMeus, notaMin: '3,8', notaMax: '4,1' });
ok(nota3841.total === 1 && nota3841.linhas[0].id === aCaro.id, 'nota de 3,8 a 4,1 traz só o de 3,9');
const notaAoContrario = await mdb.listar({ ...soMeus, notaMin: '4,1', notaMax: '3,8' });
ok(notaAoContrario.total === 1 && notaAoContrario.linhas[0].id === aCaro.id,
  'a faixa digitada ao contrário é a mesma faixa, não uma vitrine vazia');
const notaAte4 = await mdb.listar({ ...soMeus, notaMax: 4 });
ok(JSON.stringify(ids(notaAte4)) === JSON.stringify([aBarato.id, aCaro.id].sort()), 'só o teto da nota: até 4 exclui o de 4,6');
const ivAte120 = await mdb.listar({ ...soMeus, ivMax: 120 });
ok(ivAte120.total === 2 && ivAte120.linhas.every((l) => l.ficha.ivTotal <= 120), 'IV até 120 exclui o de 150');
const ivFaixa = await mdb.listar({ ...soMeus, ivMin: 50, ivMax: 120 });
ok(ivFaixa.total === 1 && ivFaixa.linhas[0].id === aCaro.id, 'IV de 50 a 120 traz só o de 100');
const potFaixa = await mdb.listar({ ...soMeus, potenciaMin: 2, potenciaMax: 4 });
ok(potFaixa.total === 1 && potFaixa.linhas[0].id === aCaro.id, 'potência de P2 a P4 traz só o P3');
const nvAte50 = await mdb.listar({ ...soMeus, nivelMax: 50 });
ok(nvAte50.total === 2 && nvAte50.linhas.every((l) => l.ficha.level <= 50), 'nível até 50 inclui o próprio 50');
const qualFaixa = await mdb.listar({ ...soMeus, qualidadeMin: '1,2', qualidadeMax: '1,2' });
ok(qualFaixa.total === 1 && qualFaixa.linhas[0].id === aCaro.id, 'qualidade de 1,2 a 1,2 inclui as duas pontas');
ok(mdb.parseNotaFiltro('4,1') === 4.1 && mdb.parseNotaFiltro('99') === 10 && mdb.parseNotaFiltro('-1') === null
  && mdb.parseNotaFiltro('abc') === null, 'nota: vírgula, 99 vira 10, negativo e texto viram "sem filtro"');

// O filtro de tipo vira lista de ids no sim (`especiesDoTipo`), então aqui entra pronta.
const fogo = await mdb.listar({ ...soMeus, speciesIds: [6] });
ok(fogo.linhas.length === 2, 'filtro por espécie traz os dois Charizard');
ok(fogo.linhas.every((l) => l.ficha.speciesId === 6), 'e nenhum Blastoise');

// Lista VAZIA é "não casa com nada", e não "sem filtro" — é o que impede a vitrine inteira de
// aparecer quando o jogador cruza dois filtros que não têm interseção.
const nada = await mdb.listar({ ...soMeus, speciesIds: [] });
ok(nada.linhas.length === 0 && nada.total === 0, 'filtro vazio devolve zero, não a vitrine toda');

for (const a of [aBarato, aForte, aCaro]) await mdb.cancelarAnuncio({ id: a.id, vendedorId: outroId });

// ---------------------------------------------- retenção anti multi-conta
secao('Retenção anti multi-conta (2 min)');

ok(mdb.COOLDOWN_COMPRA_MS === 2 * 60 * 1000, 'cooldown padrão = 2 minutos');

const pkRet = await novoPokemon(vendedorId);
const aRet = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'pokemon', pokemonId: pkRet, qtd: 1,
  ficha: { nome: 'Eevee', level: 20 }, preco: 500, moeda: 'gold',
});
ok(aRet.compravelEm && aRet.compravelEm > Date.now(), 'anúncio novo traz compravelEm no futuro');
const bloqRet = await pega(() => mdb.comprarAnuncio({
  id: aRet.id, compradorId, comprador: 'comp', preco: 500, moeda: 'gold',
}));
ok(bloqRet?.includes('retenção'), 'compra bloqueada durante retenção', `veio: ${bloqRet}`);
ok((await mdb.anuncioPorId(aRet.id)).estado === 'aberto', 'anúncio continua aberto e visível na vitrine');

const cancelRet = await mdb.cancelarAnuncio({ id: aRet.id, vendedorId });
ok(cancelRet.estado === 'cancelado', 'vendedor pode cancelar durante a retenção');

const pilhaRet1 = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'item', itemId: 90001, qtd: 1,
  ficha: { nome: 'Ret Test' }, preco: 77, moeda: 'gold',
});
const compravelOriginal = pilhaRet1.compravelEm;
const pilhaRet2 = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'item', itemId: 90001, qtd: 2,
  ficha: { nome: 'Ret Test' }, preco: 77, moeda: 'gold',
});
ok(pilhaRet2.id === pilhaRet1.id, 'empilhar no mesmo preço reutiliza a linha');
// Desde 15/09/2026 somar na pilha REINICIA a retenção — senão anunciar 1,
// esperar liberar e somar 100 deixava as 100 compráveis na hora. Nunca encurta.
ok(pilhaRet2.compravelEm >= compravelOriginal, 'empilhar reinicia a retenção (nunca encurta)');

const pkRet2 = await novoPokemon(vendedorId);
const aRetEdit = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'pokemon', pokemonId: pkRet2, qtd: 1,
  ficha: { nome: 'Pikachu', level: 30 }, preco: 100, moeda: 'orb',
});
const bloqEditDurante = await pega(() => mdb.editarAnuncio({
  id: aRetEdit.id, vendedorId, preco: 50, moeda: 'orb',
}));
ok(bloqEditDurante?.includes('retenção'), 'editar bloqueado durante retenção inicial', `veio: ${bloqEditDurante}`);

await liberarCompra(aRetEdit.id);
const editPos = await mdb.editarAnuncio({ id: aRetEdit.id, vendedorId, preco: 50, moeda: 'orb' });
ok(editPos.compravelEm && editPos.compravelEm > Date.now(), 'editar reinicia a retenção de compra');
const bloqPosEdit = await pega(() => mdb.comprarAnuncio({
  id: aRetEdit.id, compradorId, comprador: 'comp', preco: 50, moeda: 'orb',
}));
ok(bloqPosEdit?.includes('retenção'), 'compra bloqueada de novo após editar', `veio: ${bloqPosEdit}`);

await liberarCompra(pilhaRet2.id);
const posRet = await comprarLiberado({
  id: pilhaRet2.id, compradorId, comprador: 'comp', qtd: 1, preco: 77, moeda: 'gold',
});
ok(posRet.anuncio.qtd === 1 && posRet.sobra === 2, 'após expirar a retenção a compra parcial funciona');
await mdb.cancelarAnuncio({ id: pilhaRet2.id, vendedorId });
await mdb.cancelarAnuncio({ id: aRetEdit.id, vendedorId });

// TOCTOU: comprador viu anúncio liberado; vendedor edita (reinicia retenção) antes da compra
// chegar — a trava real é `compravel_em` relida com `now()` dentro do `FOR UPDATE`.
secao('TOCTOU retenção × edição × compra');

const pkT = await novoPokemon(vendedorId);
const aT = await mdb.criarAnuncio({
  vendedorId, vendedor: 'vend', tipo: 'pokemon', pokemonId: pkT, qtd: 1,
  ficha: { nome: 'Mewtwo', level: 70 }, preco: 100, moeda: 'gold',
});
await liberarCompra(aT.id);
await mdb.editarAnuncio({ id: aT.id, vendedorId, preco: 50, moeda: 'gold' });
const toctouRet = await pega(() => mdb.comprarAnuncio({
  id: aT.id, compradorId, comprador: 'comp', preco: 100, moeda: 'gold',
}));
ok(toctouRet?.includes('retenção'), 'editar entre clique e compra bloqueia a compra', `veio: ${toctouRet}`);
ok((await mdb.anuncioPorId(aT.id)).estado === 'aberto', 'e o anúncio continua aberto (nada foi cobrado)');

await liberarCompra(aT.id);
const toctouPreco = await mdb.comprarAnuncio({
  id: aT.id, compradorId, comprador: 'comp', preco: 100, moeda: 'gold',
});
ok(toctouPreco.total === 50, 'depois da retenção cobra o preço atual, mais barato', `veio ${toctouPreco.total}`);

// ------------------------------------------------- devolução dos legados
//
// A virada da pensão da feira: pokémon anunciado ANTES dela volta ao Depot do dono. O que
// este bloco existe para garantir é a SEGUNDA metade — que a devolução não encoste em
// anúncio novo. Rodando em todo boot, um critério frouxo aqui esvaziaria a feira toda vez
// que a VPS reiniciasse.
secao('Devolução dos pokémon sem pensão (anúncios legados)');
{
  const pkLegado = await novoPokemon(vendedorId);
  const aLegado = await mdb.criarAnuncio({
    vendedorId, vendedor: 'vend', tipo: 'pokemon', pokemonId: pkLegado, qtd: 1,
    ficha: { nome: 'Snorlax', level: 70 }, preco: 9000, moeda: 'gold',
    // `dias` omitido = como o `criarAnuncio` era chamado antes da v1.18.0
  });
  const legadoNoBanco = (await pool.query(
    `SELECT dias, expira_em FROM market_anuncios WHERE id=$1`, [aLegado.id])).rows[0];
  ok(legadoNoBanco.dias === null && legadoNoBanco.expira_em === null,
     'anúncio sem dias grava dias e expira_em nulos (é o legado)');

  const pkNovo = await novoPokemon(vendedorId);
  const aNovo = await mdb.criarAnuncio({
    vendedorId, vendedor: 'vend', tipo: 'pokemon', pokemonId: pkNovo, qtd: 1,
    ficha: { nome: 'Dragonite', level: 80 }, preco: 9000, moeda: 'gold', dias: 7,
  });

  const item = await mdb.criarAnuncio({
    vendedorId, vendedor: 'vend', tipo: 'item', itemId: 2273, qtd: 3,
    ficha: { nome: 'Fire Stone' }, preco: 100, moeda: 'gold',
  });

  const devolvidos = await mdb.devolverPokemonSemPensao();
  const meus = devolvidos.filter((d) => d.vendedorId === vendedorId);
  ok(meus.length === 1 && meus[0].id === aLegado.id,
     'devolve só o anúncio legado', JSON.stringify(meus.map((d) => d.id)));
  ok(meus[0].nome === 'Snorlax', 'e informa qual pokémon era, para o log');

  const solto = (await pool.query(
    `SELECT anuncio_id, slot FROM player_pokemon WHERE id=$1`, [pkLegado])).rows[0];
  ok(solto.anuncio_id === null, 'o escrow do pokémon é solto');
  // Sem slot = Depot. Voltar direto para a equipe empurraria para fora quem está lutando.
  ok(solto.slot === null, 'e ele cai no DEPOT, não na equipe');

  const estadoLegado = (await pool.query(
    `SELECT estado FROM market_anuncios WHERE id=$1`, [aLegado.id])).rows[0];
  ok(estadoLegado.estado === 'cancelado', 'o anúncio legado fica cancelado');

  const estadoNovo = (await pool.query(
    `SELECT estado FROM market_anuncios WHERE id=$1`, [aNovo.id])).rows[0];
  ok(estadoNovo.estado === 'aberto', 'o anúncio COM pensão continua aberto');
  const novoIntacto = (await pool.query(
    `SELECT anuncio_id FROM player_pokemon WHERE id=$1`, [pkNovo])).rows[0];
  ok(Number(novoIntacto.anuncio_id) === aNovo.id, 'e o pokémon dele segue em escrow');

  const estadoItem = (await pool.query(
    `SELECT estado FROM market_anuncios WHERE id=$1`, [item.id])).rows[0];
  ok(estadoItem.estado === 'aberto', 'anúncio de ITEM não é tocado (item não paga pensão)');

  // Rodar de novo é inofensivo: é o que permite deixar isto em todo boot sem flag de migração.
  const segunda = await mdb.devolverPokemonSemPensao();
  ok(!segunda.some((d) => d.vendedorId === vendedorId),
     'a segunda passagem não acha mais nada (idempotente)');

  await mdb.cancelarAnuncio({ id: aNovo.id, vendedorId });
  await mdb.cancelarAnuncio({ id: item.id, vendedorId });
}

secao('Band Aid vs Beast Ball (id 5)');
{
  const bandAid = itens.get(5);
  ok(bandAid?.name === 'Band Aid', 'id 5 no catálogo é Band Aid');
  ok(!itemAnunciavelMercado(bandAid), 'Band Aid não pode ser anunciado');
  ok(IDS_MERCADO_PERMITIDOS.has(BEAST_BALL.id), 'Beast Ball continua na lista permitida');
  ok(!itens.has(59248), 'slug duplicado band-aid (59248) saiu do catálogo');
}

await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [[vendedorId, compradorId, outroId]]);

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
await pool.end();
process.exit(falhas ? 1 : 0);
