// ABUSO DO MERCADO — o cliente é do jogador, e aqui ele mente.
//
// Todo teste ao lado deste exercita o caminho HONESTO. Este exercita o caminho de quem
// interceptou o WebSocket e trocou os números antes de mandar: negativo, zero, fracionário,
// `NaN`, `Infinity`, `2^53`, moeda inventada, quantidade maior que o estoque, cancelar duas
// vezes, comprar o próprio anúncio.
//
// ### A pergunta que ele responde
//
// Não é "a mensagem foi recusada?" — é **"o dinheiro do servidor mudou?"**. Uma recusa que
// deixa meio efeito aplicado é pior que nenhuma recusa, porque não aparece no log de ninguém.
// Por isso cada bloco tira uma FOTO das três somas antes e depois:
//
//     ouro    = Σ players.gold
//     gema    = Σ players.orbs
//     diamante = Σ players.diamonds + Σ qtd dos anúncios de diamante abertos (o escrow)
//
// e exige que elas voltem iguais. É a mesma régua da auditoria de produção, aplicada a um
// punhado de contas de mentira.
//
// ### Por que ele bate no BANCO e não no sim
//
// As funções de `market-db.mjs` são a última fronteira antes do dinheiro: se um caminho novo
// no sim esquecer uma validação, é aqui que o estrago aconteceria. Testar por cima do sim
// mediria a validação do sim; testar aqui mede a do banco, que é a que sobra quando a de cima
// falha. As duas existem de propósito — ver `conferirNumerosDoAnuncio`.
//
//   node tools/teste-mercado-abuso.mjs
import { pool } from '../src/server/db.mjs';
import * as db from '../src/server/db.mjs';
import * as ddb from '../src/server/diamantes-db.mjs';
import * as mdb from '../src/server/market-db.mjs';
import { MOTIVO } from '../src/server/game/diamantes.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

/** Roda `fn` e devolve a mensagem de erro, ou `null` se ela NÃO estourou. */
const pega = async (fn) => { try { await fn(); return null; } catch (e) { return e.message || 'erro sem mensagem'; } };

await db.aguardarBanco();
await db.migrar();
await mdb.migrar();
await ddb.migrar();

const marca = Date.now() % 1000000;
const criarJogador = async (nick, gold = 1_000_000) => {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, gold, orbs) VALUES ($1, $2, 5000) RETURNING id`, [nick, gold]);
  return Number(rows[0].id);
};
const vendedorId = await criarJogador(`abvend${marca}`);
const compradorId = await criarJogador(`abcomp${marca}`);
const todos = [vendedorId, compradorId];

const creditarDiamante = (playerId, qtd, motivo = MOTIVO.COMPRA) =>
  pool.connect().then(async (cli) => {
    try {
      await cli.query('BEGIN');
      await ddb.movimentarNaTransacao(cli, playerId, qtd, motivo, 'abuso', null);
      await cli.query('COMMIT');
    } catch (e) { await cli.query('ROLLBACK').catch(() => {}); throw e; } finally { cli.release(); }
  });

const um = async (sql, args = []) => Number((await pool.query(sql, args)).rows[0].v);

/** A FOTO: as três somas do dinheiro destas contas, incluindo o que está preso em escrow. */
async function foto() {
  return {
    ouro: await um(`SELECT coalesce(sum(gold),0)::bigint v FROM players WHERE id = ANY($1::bigint[])`, [todos]),
    gema: await um(`SELECT coalesce(sum(orbs),0)::bigint v FROM players WHERE id = ANY($1::bigint[])`, [todos]),
    diamante:
      (await um(`SELECT coalesce(sum(diamonds),0)::bigint v FROM players WHERE id = ANY($1::bigint[])`, [todos]))
      + (await um(
        `SELECT coalesce(sum(qtd),0)::bigint v FROM market_anuncios
          WHERE tipo='diamante' AND estado='aberto' AND vendedor_id = ANY($1::bigint[])`, [todos])),
  };
}

const iguais = (a, b) => a.ouro === b.ouro && a.gema === b.gema && a.diamante === b.diamante;
const mostrar = (a, b) => `ouro ${a.ouro}→${b.ouro} · gema ${a.gema}→${b.gema} · dia ${a.diamante}→${b.diamante}`;

/** Quantos anúncios abertos destas contas existem agora — nenhum abuso pode criar um. */
const abertos = () => um(
  `SELECT count(*)::int v FROM market_anuncios WHERE estado='aberto' AND vendedor_id = ANY($1::bigint[])`, [todos]);

const anunciarDiamante = (qtd, preco = 1000, moeda = 'gold', quem = vendedorId) =>
  mdb.criarAnuncio({
    vendedorId: quem, vendedor: `v${quem}`, tipo: 'diamante', qtd,
    ficha: { nome: 'Diamantes', diamante: true }, preco, moeda, dias: null,
  });

const liberar = (id) =>
  pool.query(`UPDATE market_anuncios SET compravel_em = now() - interval '1 second' WHERE id = $1`, [id]);
const envelhecer = () =>
  pool.query(`UPDATE market_anuncios SET fechado_em = now() - interval '2 hours' WHERE vendedor_id = ANY($1::bigint[])`, [todos]);

console.log('MERCADO — ABUSO\n===============');

try {
  await creditarDiamante(vendedorId, 1000);

  // ------------------------------------------------- números forjados no anúncio

  secao('Anunciar com número forjado');
  {
    const antes = await foto();
    const nAntes = await abertos();

    // Cada entrada é um pacote que um cliente adulterado poderia mandar. Nenhum pode gravar
    // linha, e nenhum pode mexer no dinheiro.
    const forjados = [
      ['qtd negativa', { qtd: -50, preco: 1000 }],
      ['qtd zero', { qtd: 0, preco: 1000 }],
      ['qtd fracionária', { qtd: 2.7, preco: 1000 }],
      ['qtd NaN', { qtd: Number.NaN, preco: 1000 }],
      ['qtd Infinity', { qtd: Number.POSITIVE_INFINITY, preco: 1000 }],
      ['qtd acima de 2^53', { qtd: 2 ** 53 + 2, preco: 1000 }],
      ['preço negativo', { qtd: 10, preco: -1000 }],
      ['preço zero', { qtd: 10, preco: 0 }],
      ['preço fracionário', { qtd: 10, preco: 12.5 }],
      ['preço NaN', { qtd: 10, preco: Number.NaN }],
      ['preço Infinity', { qtd: 10, preco: Number.POSITIVE_INFINITY }],
      ['preço acima de 2^53', { qtd: 10, preco: 2 ** 53 + 2 }],
      ['moeda inventada', { qtd: 10, preco: 1000, moeda: 'xyz' }],
      ['moeda vazia', { qtd: 10, preco: 1000, moeda: '' }],
    ];

    for (const [nome, { qtd, preco, moeda }] of forjados) {
      const erro = await pega(() => anunciarDiamante(qtd, preco, moeda ?? 'gold'));
      ok(erro != null, `${nome} é recusada`, 'PASSOU SEM ERRO');
    }

    const depois = await foto();
    ok(iguais(antes, depois), 'nenhum forjado mexeu no dinheiro', mostrar(antes, depois));
    ok(await abertos() === nAntes, 'e nenhum deles gravou anúncio');
  }

  // A mesma bateria no ITEM e no POKÉMON: o guarda é do anúncio, não do diamante.
  secao('O guarda vale para item e pokémon também');
  {
    const antes = await foto();
    const negItem = await pega(() => mdb.criarAnuncio({
      vendedorId, vendedor: 'v', tipo: 'item', itemId: 100, qtd: -5,
      ficha: { nome: 'x' }, preco: 1000, moeda: 'gold', dias: null,
    }));
    ok(negItem != null, 'item com qtd negativa é recusado', 'PASSOU SEM ERRO');

    const negPk = await pega(() => mdb.criarAnuncio({
      vendedorId, vendedor: 'v', tipo: 'pokemon', pokemonId: 1, qtd: 1,
      ficha: { nome: 'x' }, preco: -9999, moeda: 'gold', dias: 1,
    }));
    ok(negPk != null, 'pokémon com preço negativo é recusado', 'PASSOU SEM ERRO');

    const depois = await foto();
    ok(iguais(antes, depois), 'e o dinheiro não se moveu', mostrar(antes, depois));
  }

  // ------------------------------------------------------------ editar forjado

  secao('Editar com número forjado');
  {
    await envelhecer();
    const a = await anunciarDiamante(100, 1000, 'gold');
    await liberar(a.id);
    const antes = await foto();

    for (const [nome, preco, moeda] of [
      ['preço negativo', -500, 'gold'],
      ['preço zero', 0, 'gold'],
      ['preço fracionário', 3.3, 'gold'],
      ['preço NaN', Number.NaN, 'gold'],
      ['moeda inventada com preço negativo', -500, 'xyz'],
    ]) {
      const erro = await pega(() => mdb.editarAnuncio({ id: a.id, vendedorId, preco, moeda }));
      ok(erro != null, `editar com ${nome} é recusado`, 'PASSOU SEM ERRO');
    }

    const { rows } = await pool.query(`SELECT preco, moeda FROM market_anuncios WHERE id=$1`, [a.id]);
    ok(Number(rows[0].preco) === 1000 && rows[0].moeda === 'gold',
      'o anúncio ficou com o preço e a moeda originais', `${rows[0].preco} ${rows[0].moeda}`);
    ok(iguais(antes, await foto()), 'e o dinheiro não se moveu');

    await mdb.cancelarAnuncio({ id: a.id, vendedorId });
  }

  // ------------------------------------------------------------ comprar forjado

  secao('Comprar com número forjado');
  {
    await envelhecer();
    const a = await anunciarDiamante(100, 1000, 'gold');
    await liberar(a.id);
    const antes = await foto();

    const comprar = (extra) => mdb.comprarAnuncio({
      id: a.id, compradorId, comprador: 'c', qtd: 1, preco: 1000, moeda: 'gold', ...extra,
    });

    for (const [nome, extra] of [
      ['qtd negativa', { qtd: -10 }],
      ['qtd zero', { qtd: 0 }],
      ['qtd acima do estoque', { qtd: 101 }],
      ['qtd NaN', { qtd: Number.NaN }],
      ['preço combinado negativo', { preco: -1000 }],
      ['preço combinado abaixo do anunciado', { preco: 999 }],
      ['moeda trocada', { moeda: 'orb' }],
    ]) {
      const erro = await pega(() => comprar(extra));
      ok(erro != null, `comprar com ${nome} é recusado`, 'PASSOU SEM ERRO');
    }

    const erroProprio = await pega(() => mdb.comprarAnuncio({
      id: a.id, compradorId: vendedorId, comprador: 'v', qtd: 1, preco: 1000, moeda: 'gold',
    }));
    ok(erroProprio != null, 'comprar o PRÓPRIO anúncio é recusado', 'PASSOU SEM ERRO');

    const depois = await foto();
    ok(iguais(antes, depois), 'nenhuma compra forjada mexeu no dinheiro', mostrar(antes, depois));

    const { rows } = await pool.query(`SELECT qtd, estado FROM market_anuncios WHERE id=$1`, [a.id]);
    ok(Number(rows[0].qtd) === 100 && rows[0].estado === 'aberto',
      'e o estoque do anúncio ficou intacto', `${rows[0].qtd} ${rows[0].estado}`);

    await mdb.cancelarAnuncio({ id: a.id, vendedorId });
  }

  // --------------------------------------------------------- cancelar duas vezes

  secao('Cancelar duas vezes não devolve duas vezes');
  {
    await envelhecer();
    const a = await anunciarDiamante(200, 1000, 'gold');
    const comEscrow = await foto();

    await mdb.cancelarAnuncio({ id: a.id, vendedorId });
    const depoisDoPrimeiro = await foto();

    // O segundo tem de estourar — o `WHERE estado = 'aberto'` do UPDATE é a trava.
    const erro = await pega(() => mdb.cancelarAnuncio({ id: a.id, vendedorId }));
    ok(erro != null, 'o segundo cancelamento é recusado', 'PASSOU SEM ERRO');
    ok(iguais(depoisDoPrimeiro, await foto()), 'e não devolveu diamante de novo');
    ok(iguais(comEscrow, depoisDoPrimeiro), 'a devolução única fecha a conta', mostrar(comEscrow, depoisDoPrimeiro));

    // Cancelar anúncio de OUTRO jogador também não pode.
    await envelhecer();
    const b = await anunciarDiamante(50, 1000, 'gold');
    const erroOutro = await pega(() => mdb.cancelarAnuncio({ id: b.id, vendedorId: compradorId }));
    ok(erroOutro != null, 'cancelar o anúncio de outro jogador é recusado', 'PASSOU SEM ERRO');
    await mdb.cancelarAnuncio({ id: b.id, vendedorId });
  }

  // ------------------------------------------------------------------ a cota

  secao('A cota não se fura por arredondamento nem por repetição');
  {
    await envelhecer();
    const cota = await ddb.cotaDeVendaDoJogador(vendedorId);
    const antes = await foto();

    for (const [nome, qtd] of [
      ['um a mais que a cota', cota.vendavel + 1],
      ['o dobro da cota', cota.vendavel * 2],
      ['a cota + 0,5 (fracionário)', cota.vendavel + 0.5],
    ]) {
      const erro = await pega(() => anunciarDiamante(qtd, 1000, 'gold'));
      ok(erro != null, `anunciar ${nome} é recusado`, 'PASSOU SEM ERRO');
    }
    ok(iguais(antes, await foto()), 'e o dinheiro não se moveu');

    // Agora o caminho honesto até o talo, e a repetição em cima dele.
    await envelhecer();
    const a = await anunciarDiamante(cota.vendavel, 1000, 'gold');
    ok(await ddb.cotaDeVendaDoJogador(vendedorId).then((c) => c.vendavel) === 0,
      'com tudo anunciado, a cota vai a zero');
    await envelhecer();
    const erroRepete = await pega(() => anunciarDiamante(1, 1000, 'gold'));
    ok(erroRepete != null, 'e nem mais um diamante entra', 'PASSOU SEM ERRO');
    await mdb.cancelarAnuncio({ id: a.id, vendedorId });
  }

  // ------------------------------------------- a compra HONESTA continua fechando

  secao('A compra honesta fecha a conta (o controle do teste)');
  {
    await envelhecer();
    const antes = await foto();
    const a = await anunciarDiamante(100, 1000, 'gold');
    await liberar(a.id);

    // O ouro do comprador é debitado pelo SIM, em memória, e não por `comprarAnuncio` — então
    // aqui a soma de ouro não muda, e o que se confere é o DIAMANTE trocando de dono.
    const r = await mdb.comprarAnuncio({
      id: a.id, compradorId, comprador: 'c', qtd: 40, preco: 1000, moeda: 'gold',
    });
    ok(r.sobra === 60, 'a compra parcial baixa o estoque', `${r.sobra}`);

    const depois = await foto();
    ok(antes.diamante === depois.diamante,
      'carteira + escrow do diamante não mudou — só trocou de dono',
      `${antes.diamante} → ${depois.diamante}`);

    await mdb.cancelarAnuncio({ id: a.id, vendedorId });
    ok((await foto()).diamante === antes.diamante, 'e o cancelamento do resto fecha igual');
  }

  // ------------------------------------------------ o whitelist da ordenação

  secao('A ordenação não aceita chave do protótipo');
  {
    // `CRITERIOS` e `ORDENS` são objetos literais, então herdam de `Object.prototype`: um
    // `CRITERIOS['constructor']` devolve uma FUNÇÃO, que é truthy. Com `if (CRITERIOS[k])` no
    // lugar de `Object.hasOwn`, essas chaves passavam pelo whitelist e a função ia parar,
    // stringificada, dentro do ORDER BY. Hoje isso só daria erro de sintaxe (o texto vem do
    // protótipo, não do atacante), mas um whitelist que não filtra é meia injeção.
    const doProto = ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty'];

    ok(mdb.criteriosValidos(doProto).length === 0,
      'nenhuma chave herdada entra na lista de critérios',
      JSON.stringify(mdb.criteriosValidos(doProto)));
    ok(mdb.criteriosValidos(['iv', 'constructor', 'nota']).join(',') === 'iv,nota',
      'e as boas continuam passando, sem a intrusa');

    for (const k of doProto) {
      const r = mdb.normalizarOrdenacao({ ordem: k, criterios: [] });
      ok(r.ordem === 'recentes' && r.criterios.length === 0,
        `ordem "${k}" cai no padrão em vez de virar SQL`, JSON.stringify(r));
    }

    // E o teste que fecha de verdade: a consulta roda sem estourar. Se uma chave herdada
    // escapasse, o Postgres devolveria erro de sintaxe aqui.
    const erro = await pega(() => mdb.listar({
      tipo: 'pokemon', ordem: 'constructor', criterios: doProto, pagina: 0,
    }));
    ok(erro === null, 'a vitrine responde normalmente a um pedido forjado', String(erro));
  }

  // ------------------------------------------------------- a auditoria do ledger

  secao('O ledger fecha com o cache');
  {
    const divergentes = (await ddb.conferirSaldo(200)).filter((d) => todos.includes(d.id));
    ok(divergentes.length === 0,
      'nenhuma das contas deste teste diverge entre `players.diamonds` e o ledger',
      JSON.stringify(divergentes));
  }
} finally {
  await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [todos]);
}

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
await pool.end();
process.exit(falhas ? 1 : 0);
