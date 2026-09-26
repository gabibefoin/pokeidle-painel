// Teste da VENDA DE DIAMANTES no Mercado da Comunidade. Precisa do Postgres no ar
// (`npm run infra`): o ponto do sistema é ser transacional, e testar isso sem banco testaria
// outra coisa.
//
// O que este arquivo existe para provar, em ordem de importância:
//
//   1. a COTA é respeitada — só o diamante de COMPRA e de AFILIADO pode ser vendido; o de
//      voto, de prêmio de guild e de ajuste da administração não sai do lugar;
//   2. o ESCROW é atômico — anunciar tira do saldo na mesma transação que cria o anúncio, e
//      um anúncio que estoura não deixa diamante preso nem saldo mordido;
//   3. o diamante NÃO NASCE nem SOME — carteira + escrow é constante em qualquer venda, e o
//      ledger de mercado do vendedor e o do comprador são as duas pontas da MESMA
//      transferência (-100 de um lado, +100 do outro);
//   4. quem COMPRA diamante de outro jogador não pode revendê-lo (senão a cota do servidor
//      deixaria de ser limitada pelo que entrou de verdade);
//   5. as quatro devoluções (cancelar, expirar, preço inválido em gema e em Coins) devolvem —
//      um anúncio fechado sem devolução é confisco.
//
//   node tools/teste-mercado-diamantes.mjs
import { pool } from '../src/server/db.mjs';
import * as db from '../src/server/db.mjs';
import * as ddb from '../src/server/diamantes-db.mjs';
import * as mdb from '../src/server/market-db.mjs';
import {
  MOTIVO,
  MOTIVOS_DE_TRANSFERENCIA,
  MOTIVOS_QUE_ENCHEM_A_COTA,
  MOTIVOS_QUE_EMITEM,
} from '../src/server/game/diamantes.mjs';

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

await db.aguardarBanco();
await db.migrar();
await mdb.migrar();
await ddb.migrar();

const marca = Date.now() % 1000000;
const criar = async (nick) => {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, gold) VALUES ($1, 100000000) RETURNING id`, [nick]);
  return Number(rows[0].id);
};
const vendedorId = await criar(`dmvend${marca}`);
const compradorId = await criar(`dmcomp${marca}`);
const terceiroId = await criar(`dmter${marca}`);
const todos = [vendedorId, compradorId, terceiroId];

/**
 * Credita diamante direto no ledger, com o motivo pedido.
 *
 * O caminho de produção de cada motivo é outro (webhook, comissão, voto…), e reproduzi-los
 * aqui traria quatro integrações para dentro de um teste de mercado. O que este arquivo tem de
 * exercitar é a REGRA DA COTA, e ela só olha o motivo gravado na linha — que é exatamente o
 * que esta função controla.
 */
const creditar = (playerId, qtd, motivo) =>
  pool.connect().then(async (cli) => {
    try {
      await cli.query('BEGIN');
      await ddb.movimentarNaTransacao(cli, playerId, qtd, motivo, 'teste', null);
      await cli.query('COMMIT');
    } catch (e) {
      await cli.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      cli.release();
    }
  });

const saldo = async (id) => Number((await pool.query(`SELECT diamonds FROM players WHERE id=$1`, [id])).rows[0].diamonds);
const cota = (id) => ddb.cotaDeVendaDoJogador(id);
/** Anúncio novo fica 2 min em retenção; os testes que não são de retenção liberam antes. */
const liberar = (id) =>
  pool.query(`UPDATE market_anuncios SET compravel_em = now() - interval '1 second' WHERE id = $1`, [id]);
/** A trava de reanúncio olha `fechado_em`; envelhecê-la deixa o próximo anúncio passar. */
const envelhecerFechados = (id) =>
  pool.query(`UPDATE market_anuncios SET fechado_em = now() - interval '2 hours' WHERE vendedor_id = $1`, [id]);

const anunciar = (qtd, preco = 1000, moeda = 'gold', quem = vendedorId) =>
  mdb.criarAnuncio({
    vendedorId: quem, vendedor: `v${quem}`, tipo: 'diamante', qtd,
    ficha: { nome: 'Diamantes', diamante: true }, preco, moeda, dias: null,
  });

/** A soma dos três motivos de mercado no ledger deste jogador. Fora de anúncio aberto: zero. */
const somaDeMercado = async (id) => {
  const { rows } = await pool.query(
    `SELECT coalesce(sum(delta),0)::bigint AS v FROM diamante_ledger
      WHERE player_id = $1 AND motivo = ANY($2::text[])`,
    [id, [...MOTIVOS_DE_TRANSFERENCIA]],
  );
  return Number(rows[0].v);
};

/** A soma de `players.diamonds` destes jogadores. Não é o total do sistema — ver abaixo. */
const naCarteira = async () => {
  const { rows } = await pool.query(
    `SELECT coalesce(sum(diamonds),0)::bigint AS v FROM players WHERE id = ANY($1::bigint[])`, [todos]);
  return Number(rows[0].v);
};

/** O que está preso em anúncios de diamante ABERTOS destes jogadores. */
const emEscrow = async () => {
  const { rows } = await pool.query(
    `SELECT coalesce(sum(qtd),0)::bigint AS v FROM market_anuncios
      WHERE tipo = 'diamante' AND estado = 'aberto' AND vendedor_id = ANY($1::bigint[])`, [todos]);
  return Number(rows[0].v);
};

/**
 * O TOTAL DE VERDADE: carteira + escrow.
 *
 * `players.diamonds` sozinho não serve de invariante enquanto há anúncio aberto, e não por
 * bug: o escrow tira do saldo de propósito (é o que impede vender e gastar na Loja o mesmo
 * diamante). Enquanto o anúncio está de pé, aquelas unidades não estão na carteira de ninguém
 * — estão na linha do anúncio, que é a outra metade da conta.
 *
 * A soma das duas é o que não pode mudar em venda nenhuma: é ela que diz que o Mercado
 * TRANSFERE em vez de emitir.
 */
const totalDoServidor = async () => (await naCarteira()) + (await emEscrow());

console.log('MERCADO — DIAMANTES\n===================');

try {
  // --------------------------------------------------------------- os conjuntos

  secao('As regras, antes de qualquer banco');
  {
    ok(MOTIVOS_QUE_ENCHEM_A_COTA.has(MOTIVO.COMPRA), 'compra paga enche a cota');
    ok(MOTIVOS_QUE_ENCHEM_A_COTA.has(MOTIVO.AFILIADO), 'comissão de indicação enche a cota');
    ok(!MOTIVOS_QUE_ENCHEM_A_COTA.has(MOTIVO.VOTO), 'voto no TopIdle NÃO enche');
    ok(!MOTIVOS_QUE_ENCHEM_A_COTA.has(MOTIVO.GUILD_GLOBAL), 'pódio de guild NÃO enche');
    ok(!MOTIVOS_QUE_ENCHEM_A_COTA.has(MOTIVO.AJUSTE_ADMIN), 'ajuste da administração NÃO enche');
    ok(!MOTIVOS_QUE_ENCHEM_A_COTA.has(MOTIVO.CAIXA_BETA), 'a Caixa de Fundador NÃO enche');
    ok(!MOTIVOS_QUE_ENCHEM_A_COTA.has(MOTIVO.MERCADO_COMPRA),
      'diamante COMPRADO de outro jogador NÃO enche (não pode ser revendido)');

    // Nenhum dos três de mercado pode contar como EMISSÃO: eles transferem, e contá-los como
    // receita faria o faturamento deixar de bater com o provedor de pagamento.
    for (const m of MOTIVOS_DE_TRANSFERENCIA) {
      ok(!MOTIVOS_QUE_EMITEM.has(m), `${m} não é emissão`);
    }
  }

  // --------------------------------------------------------------- a cota

  secao('A cota: só o que foi comprado');
  {
    await creditar(vendedorId, 500, MOTIVO.COMPRA);
    await creditar(vendedorId, 100, MOTIVO.AFILIADO);
    await creditar(vendedorId, 300, MOTIVO.VOTO);
    await creditar(vendedorId, 200, MOTIVO.AJUSTE_ADMIN);

    const c = await cota(vendedorId);
    ok(c.saldo === 1100, 'o saldo soma tudo', `${c.saldo}`);
    ok(c.vendavel === 600, 'mas só 600 são vendáveis (500 de compra + 100 de indicação)', `${c.vendavel}`);
    ok(c.deCompra === 500 && c.deAfiliado === 100, 'e a tela sabe de onde veio cada parcela');
    ok(c.emAnuncios === 0, 'nada em anúncio ainda');
  }

  secao('O caso do relato: gastar na Loja não libera cota para o brinde');
  {
    // O ledger do jogador que achou o buraco em produção, na ordem em que aconteceu. A conta
    // por SOMA dava cota 60 (as duas compras da vida) e deixava ele anunciar os 2 de voto.
    const alizu = await criar(`dmaliz${marca}`);
    await creditar(alizu, 10, MOTIVO.COMPRA);
    await ddb.gastarNaLoja({ playerId: alizu, diamantes: 10, produtoId: 'vip30', nome: 'VIP' });
    await creditar(alizu, 1, MOTIVO.VOTO);
    await creditar(alizu, 50, MOTIVO.COMPRA);
    await ddb.gastarNaLoja({ playerId: alizu, diamantes: 50, produtoId: 'xpshareheld', nome: 'Exp' });
    await creditar(alizu, 1, MOTIVO.VOTO);

    const c = await cota(alizu);
    ok(c.saldo === 2, 'ele fica com 2 diamantes na carteira', `${c.saldo}`);
    ok(c.deCompra === 60, 'e comprou 60 na vida inteira', `${c.deCompra}`);

    // A conta por SOMA daria `min(saldo 2, cota 60) = 2` — os DOIS vendáveis, incluindo o de
    // voto. A cronológica sabe que o gasto de 50 comeu o voto de então (brinde primeiro) e 49
    // comprados, deixando 1 comprado + 1 voto novo. Só o comprado sai.
    const porSoma = Math.min(c.saldo, c.deCompra + c.deAfiliado);
    ok(porSoma === 2, 'a conta antiga liberaria os dois', `${porSoma}`);
    ok(c.vendavel === 1, 'a cronológica libera só 1 — o comprado que sobrou', `${c.vendavel}`);
    ok(c.brindes === 1, 'e diz que o outro é brinde', `${c.brindes}`);

    const bom = await anunciar(1, 1000, 'gold', alizu);
    ok(bom?.id != null, 'anunciar o comprado funciona');
    await mdb.cancelarAnuncio({ id: bom.id, vendedorId: alizu });

    await envelhecerFechados(alizu);
    const erro = await pega(() => anunciar(2, 1000, 'gold', alizu));
    ok(erro != null, 'mas anunciar os DOIS (arrastando o de voto) é recusado', 'PASSOU SEM ERRO');
    todos.push(alizu);
  }

  secao('Gastar na Loja come o BRINDE primeiro');
  {
    // A outra metade da regra: quem tem comprado E brinde e gasta na Loja não pode perder a
    // cota do comprado — senão o brinde puniria quem o recebeu.
    const misto = await criar(`dmmist${marca}`);
    await creditar(misto, 10, MOTIVO.COMPRA);
    await creditar(misto, 5, MOTIVO.VOTO);
    await ddb.gastarNaLoja({ playerId: misto, diamantes: 5, produtoId: 'teste', nome: 't' });

    const c = await cota(misto);
    ok(c.saldo === 10, 'sobraram 10 no saldo', `${c.saldo}`);
    ok(c.vendavel === 10, 'e os 10 comprados continuam vendáveis — o gasto comeu o voto',
      `${c.vendavel}`);
    todos.push(misto);
  }

  secao('A cota nunca passa do SALDO');
  {
    // Gastar na Loja derruba o saldo abaixo da cota. O `min` é o que impede vender o que já
    // não existe — e, do outro lado, gastar consome primeiro o brinde do ponto de vista da
    // conta, que é a leitura boa para o jogador.
    await ddb.gastarNaLoja({ playerId: vendedorId, diamantes: 900, produtoId: 'teste', nome: 'teste' });
    const c = await cota(vendedorId);
    ok(c.saldo === 200, 'sobraram 200 no saldo', `${c.saldo}`);
    ok(c.vendavel === 200, 'e só 200 são vendáveis, mesmo com cota de 600', `${c.vendavel}`);

    // Devolve o gasto para os testes seguintes trabalharem com números redondos.
    await creditar(vendedorId, 900, MOTIVO.COMPRA);
  }

  // --------------------------------------------------------------- o escrow

  secao('Anunciar tira do saldo, na mesma transação');
  {
    const antes = await saldo(vendedorId);
    const cAntes = await cota(vendedorId);
    const a = await anunciar(400);
    ok(a.tipo === 'diamante' && a.qtd === 400, 'o anúncio nasce com a quantidade certa');
    ok(a.saldoDiamantes === antes - 400, 'e devolve o saldo já debitado, para o sim atualizar a tela',
      `${a.saldoDiamantes} vs ${antes - 400}`);
    ok(await saldo(vendedorId) === antes - 400, 'o saldo no banco caiu 400');

    const c = await cota(vendedorId);
    ok(c.emAnuncios === 400, 'a tela mostra 400 presos em anúncio', `${c.emAnuncios}`);
    ok(c.vendavel === cAntes.vendavel - 400, 'e a cota caiu na mesma medida', `${c.vendavel}`);

    // Um anúncio aberto por vez: o segundo esbarra na trava, como no item.
    const erro = await pega(() => anunciar(10));
    ok(erro === 'market.travaDiamanteAberto', 'o segundo anúncio de diamante é recusado', String(erro));

    await mdb.cancelarAnuncio({ id: a.id, vendedorId });
    ok(await saldo(vendedorId) === antes, 'cancelar devolve os 400 ao saldo', `${await saldo(vendedorId)}`);
    ok(await somaDeMercado(vendedorId) === 0, 'e o ledger de mercado volta a somar zero');
    const cDepois = await cota(vendedorId);
    ok(cDepois.vendavel === cAntes.vendavel, 'a cota volta ao que era', `${cDepois.vendavel}`);
  }

  secao('Pedir mais do que a cota é recusado, sem mexer em nada');
  {
    await envelhecerFechados(vendedorId);
    const antes = await saldo(vendedorId);
    const c = await cota(vendedorId);
    const erro = await pega(() => anunciar(c.vendavel + 1));
    ok(String(erro).includes('market.diamanteSemCota') || String(erro).includes('diamanteSemCota'),
      'o anúncio acima da cota estoura', String(erro));
    ok(await saldo(vendedorId) === antes, 'e o saldo não foi tocado', `${await saldo(vendedorId)}`);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM market_anuncios WHERE vendedor_id = $1 AND estado = 'aberto'`,
      [vendedorId],
    );
    ok(rows[0].n === 0, 'nenhum anúncio ficou de pé');
  }

  secao('Brinde não vira mercadoria');
  {
    // Um jogador só com diamante de voto e de administração: saldo alto, cota zero.
    await creditar(terceiroId, 5000, MOTIVO.VOTO);
    await creditar(terceiroId, 5000, MOTIVO.GUILD_GLOBAL);
    const c = await cota(terceiroId);
    ok(c.saldo === 10000, 'ele tem 10.000 no bolso', `${c.saldo}`);
    ok(c.vendavel === 0, 'e não pode vender nenhum', `${c.vendavel}`);

    const erro = await pega(() => anunciar(1, 1000, 'gold', terceiroId));
    ok(erro != null, 'anunciar um só já é recusado', String(erro));
    ok(await saldo(terceiroId) === 10000, 'e o saldo dele fica intacto');
  }

  // --------------------------------------------------------------- a venda

  secao('A venda: o diamante troca de dono e não nasce nem some');
  {
    await envelhecerFechados(vendedorId);
    const totalAntes = await totalDoServidor();
    const vAntes = await saldo(vendedorId);
    const cAntes = await saldo(compradorId);

    const a = await anunciar(300, 1000, 'gold');
    await liberar(a.id);
    const r = await mdb.comprarAnuncio({
      id: a.id, compradorId, comprador: 'comp', qtd: 100, preco: 1000, moeda: 'gold',
    });

    ok(r.sobra === 200, 'a compra parcial deixa 200 no anúncio', `${r.sobra}`);
    ok(r.diamantesDoComprador === cAntes + 100,
      'e devolve o saldo do comprador já creditado', `${r.diamantesDoComprador}`);
    ok(await saldo(compradorId) === cAntes + 100, 'o comprador levou 100');
    ok(await saldo(vendedorId) === vAntes - 300, 'os 300 do vendedor continuam fora da carteira dele');
    ok(await emEscrow() === 200, 'e 200 seguem presos no anúncio', `${await emEscrow()}`);
    ok(await totalDoServidor() === totalAntes,
      'carteira + escrow não mudou — o Mercado transfere, não emite',
      `${await totalDoServidor()} vs ${totalAntes}`);

    // O que sobrou no anúncio volta ao cancelar: é o resto do escrow, não os 300 originais.
    await mdb.cancelarAnuncio({ id: a.id, vendedorId });
    ok(await saldo(vendedorId) === vAntes - 100, 'cancelar devolve só os 200 que sobraram',
      `${await saldo(vendedorId)} vs ${vAntes - 100}`);
    ok(await emEscrow() === 0, 'e não sobra nada em escrow');
    ok(await naCarteira() === totalAntes,
      'com tudo fechado, a carteira sozinha volta ao total de antes', `${await naCarteira()} vs ${totalAntes}`);

    // O que o ledger de mercado do vendedor guarda daqui em diante: os 100 que ele VENDEU de
    // fato. Não volta a zero, e não deve — aquele diamante mudou de dono para sempre.
    ok(await somaDeMercado(vendedorId) === -100,
      'o ledger de mercado do vendedor fica em -100 (o que saiu de verdade)', `${await somaDeMercado(vendedorId)}`);
    ok(await somaDeMercado(compradorId) === 100, 'e o do comprador em +100 — a outra ponta da mesma transferência');
  }

  secao('Quem COMPROU diamante no Mercado não pode revendê-lo');
  {
    const c = await cota(compradorId);
    ok(c.saldo === 100, 'o comprador tem os 100 que levou', `${c.saldo}`);
    ok(c.vendavel === 0, 'e a cota dele continua zero — MERCADO_COMPRA não conta', `${c.vendavel}`);
    const erro = await pega(() => anunciar(100, 1000, 'gold', compradorId));
    ok(erro != null, 'revender é recusado', String(erro));
  }

  // --------------------------------------------------------------- devoluções

  secao('Expirar devolve');
  {
    await envelhecerFechados(vendedorId);
    const antes = await saldo(vendedorId);
    const mktAntes = await somaDeMercado(vendedorId);
    const a = await anunciar(50);
    // A expiração olha `expira_em`; anúncio de diamante nasce sem prazo (como o item), então
    // o teste carimba um vencido para exercitar o caminho.
    await pool.query(`UPDATE market_anuncios SET expira_em = now() - interval '1 hour' WHERE id = $1`, [a.id]);
    const fechados = await mdb.expirarAnuncios();
    ok(fechados.some((x) => x.id === a.id), 'a varredura fechou o anúncio');
    ok(await saldo(vendedorId) === antes, 'e devolveu os 50', `${await saldo(vendedorId)}`);
    // Volta ao que era ANTES deste ciclo, e não a zero: a venda parcial mais atrás deixou -100
    // gravados no ledger dele para sempre, que é exatamente o que ela significa.
    ok(await somaDeMercado(vendedorId) === mktAntes,
      'e o ledger de mercado volta ao que era antes deste anúncio', `${await somaDeMercado(vendedorId)} vs ${mktAntes}`);
    // O diamante voltou pelo ledger, dentro da transação. A caixa postal só diz ao sim do dono
    // que atualize a tela — recolher não pode creditar de novo.
    const entregue = (await mdb.recolherDevolucoes(vendedorId)).filter((x) => x.id === a.id);
    ok(entregue.length === 1 && entregue[0].tipo === 'diamante', 'a caixa postal avisa o dono uma vez');
    ok(await saldo(vendedorId) === antes, 'e recolher não devolve os 50 de novo', `${await saldo(vendedorId)}`);
    ok((await mdb.recolherDevolucoes(vendedorId)).every((x) => x.id !== a.id), 'nem na segunda vez');
  }

  secao('A varredura de preço inválido devolve');
  {
    await envelhecerFechados(vendedorId);
    const antes = await saldo(vendedorId);
    const mktAntes = await somaDeMercado(vendedorId);
    const a = await anunciar(70, mdb.PRECO_MIN_GOLD, 'gold');
    // Rebaixa o preço por baixo (a criação não deixaria) para o estado que a varredura de boot
    // existe para limpar.
    await pool.query(`UPDATE market_anuncios SET preco = 1 WHERE id = $1`, [a.id]);
    await mdb.devolverAnunciosPrecoGoldInvalido();
    ok(await saldo(vendedorId) === antes, 'o diamante voltou', `${await saldo(vendedorId)}`);
    ok(await somaDeMercado(vendedorId) === mktAntes,
      'e o ledger de mercado voltou ao que era', `${await somaDeMercado(vendedorId)} vs ${mktAntes}`);
    ok(await emEscrow() === 0, 'sem nada preso em anúncio');
  }

  secao('O cache de `players.diamonds` bate com o ledger');
  {
    // A auditoria global: qualquer caminho que tenha mexido em `diamonds` sem passar por
    // `movimentar` apareceria aqui. É a rede que pega um escrow escrito na mão.
    const divergentes = await ddb.conferirSaldo(50);
    const meus = divergentes.filter((d) => todos.includes(d.id));
    ok(meus.length === 0, 'nenhum dos jogadores deste teste diverge', JSON.stringify(meus));
  }
} finally {
  await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [todos]);
}

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
await pool.end();
process.exit(falhas ? 1 : 0);
