// Teste dos DIAMANTES. Precisa do Postgres no ar (`npm run infra`) — o ponto do sistema é ser
// transacional, e testar isso sem banco testaria outra coisa.
//
// O que este arquivo existe para pegar, em ordem de quanto custa errar:
//
//   1. CRÉDITO EM DOBRO — o provedor reenvia o webhook até receber 200, e a reconciliação
//      pergunta pelo mesmo pagamento em paralelo. Se os dois creditarem, o jogador ganha o
//      pacote duas vezes por um pagamento só.
//   2. PAGAMENTO PARCIAL virando pacote inteiro.
//   3. SALDO NEGATIVO na Loja — dois cliques no mesmo produto com saldo para um.
//   4. CACHE DIVERGENTE do ledger, que é o sintoma de alguém ter voltado a gravar
//      `players.diamonds` pelo `flushJogadores`.
//
//   node tools/teste-diamantes.mjs
import { pool } from '../src/server/db.mjs';
import * as ddb from '../src/server/diamantes-db.mjs';
import {
  CENTAVOS_POR_DIAMANTE,
  MINIMO_CENTAVOS,
  QTD_MINIMA,
  FAIXAS,
  PACOTES,
  PAGAMENTO,
  MOTIVO,
  MOTIVOS_QUE_EMITEM,
  ErroDiamantes,
  precoEmCentavos,
  precoUnitario,
  centavosPorDiamante,
  novaReferencia,
  emReais,
} from '../src/server/game/diamantes.mjs';
import { LISTA_CAIXAS } from '../src/shared/caixas-beta.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const estourou = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

console.log('DIAMANTES — compra e Loja\n=========================');

// --------------------------------------------------------------- aritmética

secao('Preço');
{
  // A tabela do produto, faixa a faixa.
  ok(precoUnitario(1) === 44, '1 a 99 diamantes saem a R$ 0,44');
  ok(precoUnitario(99) === 44, 'e 99 ainda está na primeira faixa');
  ok(precoUnitario(100) === 42, 'de 100 a 149, R$ 0,42');
  ok(precoUnitario(149) === 42, 'e 149 ainda');
  ok(precoUnitario(150) === 40, 'de 150 a 199, R$ 0,40');
  ok(precoUnitario(199) === 40, 'e 199 ainda');
  ok(precoUnitario(200) === 38, 'de 200 em diante, R$ 0,38');
  ok(precoUnitario(99999) === 38, 'e não há faixa mais barata que essa');

  ok(precoEmCentavos(50) === 2200, '50 diamantes custam R$ 22,00', emReais(precoEmCentavos(50)));
  ok(precoEmCentavos(100) === 4200, '100 custam R$ 42,00');
  ok(precoEmCentavos(150) === 6000, '150 custam R$ 60,00');
  ok(precoEmCentavos(200) === 7600, '200 custam R$ 76,00');

  // O DEGRAU: sem o teto contra o corte seguinte, 99 sairiam por R$ 43,56 — mais caro que os
  // 100. É o caso que o `Math.min` de `precoEmCentavos` existe para matar.
  ok(precoEmCentavos(99) === precoEmCentavos(100), '99 não custam mais que 100');
  ok(precoEmCentavos(149) === precoEmCentavos(150), 'nem 149 mais que 150');
  ok(precoEmCentavos(199) === precoEmCentavos(200), 'nem 199 mais que 200');

  // Comprar mais NUNCA pode sair mais barato no total — é o que impede o jogador de pagar
  // menos comprando mais e o caixa de perder dinheiro numa faixa mal colocada.
  let monotonico = true;
  for (let q = QTD_MINIMA; q < 3000; q++) {
    if (precoEmCentavos(q + 1) < precoEmCentavos(q)) monotonico = false;
  }
  ok(monotonico, 'o preço total NUNCA cai ao comprar mais um diamante');

  // As faixas têm de estar em ordem decrescente de corte: invertidas, a de 100 engoliria as
  // de cima e o preço de R$ 0,38 nunca sairia.
  const ordenadas = FAIXAS.every((f, i) => i === 0 || FAIXAS[i - 1].minimo > f.minimo);
  ok(ordenadas, 'as faixas estão em ordem decrescente de corte');
  const maisBarataNoFim = FAIXAS.every((f, i) => i === 0 || FAIXAS[i - 1].centavos <= f.centavos);
  ok(maisBarataNoFim, 'e quanto maior a faixa, menor o preço unitário');
}

secao('Limites');
{
  ok(CENTAVOS_POR_DIAMANTE === 44, 'a vitrine anuncia "a partir de" R$ 0,44');
  ok(QTD_MINIMA === 3, 'o mínimo de R$ 1,00 são 3 diamantes');
  ok(precoEmCentavos(QTD_MINIMA) >= MINIMO_CENTAVOS, 'e ele alcança o mínimo');

  const recusa = (q) => {
    try {
      precoEmCentavos(q);
      return false;
    } catch (e) {
      return e instanceof ErroDiamantes;
    }
  };
  ok(recusa(2), 'abaixo do mínimo é RECUSADO (não vira preço 0)');
  ok(recusa(0), 'zero é recusado');
  ok(recusa(-100), 'negativo é recusado');
  ok(recusa(10.5), 'fracionário é recusado');
  ok(recusa(1e9), 'e um número absurdo também');

  ok(PACOTES.every((p) => p.centavos === precoEmCentavos(p.qtd)),
     'todo pacote da vitrine tem o preço da tabela');
  ok(PACOTES.every((p) => p.qtd >= QTD_MINIMA), 'e nenhum pacote está abaixo do mínimo');
}

secao('Emissão');
{
  // A mesma invariante de `teste-orbs`: acrescentar um motivo emissor faz este teste falhar de
  // propósito. Não é para impedir a mudança — é para obrigar quem a fizer a passar por aqui e
  // escrever a razão de negócio dela, como está no cabeçalho de `MOTIVOS_QUE_EMITEM`.
  ok(MOTIVOS_QUE_EMITEM.size === 5, 'existem cinco motivos que emitem diamante');
  ok(MOTIVOS_QUE_EMITEM.has(MOTIVO.COMPRA), 'compra paga emite');
  ok(MOTIVOS_QUE_EMITEM.has(MOTIVO.AFILIADO), 'comissão de afiliado emite (só após compra real)');
  // O único brinde de AQUISIÇÃO da lista, e o que o segura é o teto diário do voto — sem ele,
  // esta linha não deveria existir. Ver o cabeçalho de `game/topidle.mjs`.
  ok(MOTIVOS_QUE_EMITEM.has(MOTIVO.VOTO), 'voto no TopIdle emite (com teto diário)');
  // O brinde de RETENÇÃO: pódio mensal do ranking Global de guilds. O que segura é estrutural
  // (no máximo 3 guilds × MAX_TIME_GUILD escalados, valores fixos) — a guild pode ter mil
  // membros, mas quem recebe é o TIME que foi à guerra. Ver `game/guild-global.mjs`.
  ok(MOTIVOS_QUE_EMITEM.has(MOTIVO.GUILD_GLOBAL), 'pódio do ranking Global de guilds emite (teto estrutural)');
  // A devolução de dentro da Caixa de Fundador. É a emissão mais bem lastreada da lista: cada
  // diamante devolvido foi QUEIMADO antes, na compra da própria caixa (`MOTIVO.LOJA`), e o
  // teto é o menor de todos — 50×150 + 100×100 = 17.500, uma vez na vida do jogo, porque não
  // existem outras caixas para vender. Ver `shared/caixas-beta.mjs`.
  ok(MOTIVOS_QUE_EMITEM.has(MOTIVO.CAIXA_BETA), 'a devolução da Caixa de Fundador emite (teto estrutural, já queimado)');
  ok(
    LISTA_CAIXAS.reduce((s, c) => s + c.limite * c.diamantes, 0) === 17_500,
    'e o teto total da emissão por caixa é 17.500 diamantes',
  );
}

// ------------------------------------------------------------------- banco

secao('Banco (Postgres)');
let temBanco = true;
try {
  await pool.query('SELECT 1');
} catch (err) {
  temBanco = false;
  console.log(`  · Postgres indisponível (${err.message}) — pulando a parte transacional`);
  console.log('    suba com: npm run infra');
}

if (temBanco) {
  const { migrar } = await import('../src/server/db.mjs');
  await migrar();
  await ddb.migrar();

  const nick = `dia${Math.floor(Math.random() * 1e6)}`;
  const { rows } = await pool.query(`INSERT INTO players (nick) VALUES ($1) RETURNING id`, [nick]);
  const id = Number(rows[0].id);
  const limpar = () => pool.query(`DELETE FROM players WHERE id = $1`, [id]);

  const pendente = async (qtd) => {
    const referencia = novaReferencia();
    await ddb.registrarPendente({
      referencia, playerId: id, nick, qtd,
      centavos: precoEmCentavos(qtd), metodo: 'pix', provedor: 'efi', provedorRef: null,
    });
    return referencia;
  };

  try {
    // ------------------------------------------------------------ compra
    secao('Pagamento e crédito');
    ok((await ddb.saldoDe(id)) === 0, 'o jogador começa sem diamante nenhum');

    const r1 = await pendente(300);
    const p1 = await ddb.pagamentoPorReferencia(r1);
    ok(p1.status === PAGAMENTO.PENDENTE, 'o pedido nasce pendente');
    ok((await ddb.saldoDe(id)) === 0, 'e pendente NÃO credita nada');

    const c1 = await ddb.confirmarPagamento({
      referencia: r1, centavosRecebidos: precoEmCentavos(300), comprovante: 'prova_1',
    });
    ok(c1.creditado && c1.saldo === 300, 'o pagamento confirmado credita 300', `${c1.saldo}`);
    ok((await ddb.pagamentoPorReferencia(r1)).status === PAGAMENTO.PAGO, 'e a linha vira "pago"');

    // ------------------------------------------------- o teste que mais importa
    secao('Idempotência (webhook repetido)');
    const c2 = await ddb.confirmarPagamento({
      referencia: r1, centavosRecebidos: precoEmCentavos(300), comprovante: 'prova_1',
    });
    ok(!c2.creditado, 'confirmar DE NOVO não credita');
    ok((await ddb.saldoDe(id)) === 300, 'e o saldo continua 300', `${await ddb.saldoDe(id)}`);

    // Webhook e reconciliação chegando ao mesmo tempo, de verdade (em paralelo).
    const r2 = await pendente(100);
    const juntos = await Promise.all([
      ddb.confirmarPagamento({ referencia: r2, centavosRecebidos: precoEmCentavos(100), comprovante: 'a' }),
      ddb.confirmarPagamento({ referencia: r2, centavosRecebidos: precoEmCentavos(100), comprovante: 'b' }),
      ddb.confirmarPagamento({ referencia: r2, centavosRecebidos: precoEmCentavos(100), comprovante: 'c' }),
    ]);
    ok(juntos.filter((x) => x.creditado).length === 1, 'três confirmações SIMULTÂNEAS creditam uma só vez');
    ok((await ddb.saldoDe(id)) === 400, 'o saldo subiu só um pacote', `${await ddb.saldoDe(id)}`);

    secao('Pagamento parcial');
    const r3 = await pendente(1000);
    ok(await estourou(() => ddb.confirmarPagamento({
      referencia: r3, centavosRecebidos: 100, comprovante: 'pouco',
    })), 'pagar menos que a cobrança estoura');
    ok((await ddb.saldoDe(id)) === 400, 'e não credita nada');
    ok((await ddb.pagamentoPorReferencia(r3)).status === PAGAMENTO.PENDENTE,
       'a linha VOLTA a pendente — um pagamento correto depois ainda funciona');

    const c3 = await ddb.confirmarPagamento({ referencia: r3, centavosRecebidos: precoEmCentavos(1000), comprovante: 'ok' });
    ok(c3.creditado && (await ddb.saldoDe(id)) === 1400, 'e aí sim credita', `${await ddb.saldoDe(id)}`);
    // Pagar A MAIS entrega o pacote: o dinheiro já entrou, recusar seria ficar com ele.
    const r4 = await pendente(100);
    const c4 = await ddb.confirmarPagamento({ referencia: r4, centavosRecebidos: precoEmCentavos(100) + 400, comprovante: 'sobra' });
    ok(c4.creditado, 'pagar A MAIS entrega o pacote assim mesmo');

    // ------------------------------------------------------- caixa postal
    secao('Caixa postal');
    const comCredito = await ddb.jogadoresComCredito([id]);
    ok(comCredito.has(id), 'o jogador aparece com crédito para recolher');

    const saldoAntes = await ddb.saldoDe(id);
    const rec = await ddb.recolherCreditos(id);
    ok(rec.recibos.length === 4, 'recolhe os quatro recibos', `${rec.recibos.length}`);
    // O recolhimento NÃO soma: o crédito já aconteceu no `confirmarPagamento`. Somar aqui
    // pagaria o jogador duas vezes — é o mesmo erro que a caixa postal do Mercado evita.
    ok(rec.saldo === saldoAntes, 'e NÃO soma nada — só marca como entregue', `${rec.saldo} vs ${saldoAntes}`);

    ok(!(await ddb.jogadoresComCredito([id])).has(id), 'depois de recolhido ele sai da caixa');
    ok((await ddb.recolherCreditos(id)).recibos.length === 0, 'e recolher de novo não traz nada');

    // ------------------------------------------------------------- loja
    secao('Loja');
    const saldo = await ddb.saldoDe(id);
    const g = await ddb.gastarNaLoja({ playerId: id, diamantes: 30, produtoId: 'outfit_20003', nome: 'Greninja' });
    ok(g.saldo === saldo - 30, 'a compra debita', `${g.saldo}`);

    ok(await estourou(() => ddb.gastarNaLoja({
      playerId: id, diamantes: saldo * 10, produtoId: 'caro', nome: 'caro',
    })), 'gastar mais do que tem estoura');
    ok((await ddb.saldoDe(id)) === saldo - 30, 'e não deixa o saldo negativo');

    // Dois cliques no mesmo produto com saldo para UM. A trava é o `WHERE ... >= 0` dentro da
    // transação: uma checagem em JavaScript antes do UPDATE não fecha esta janela.
    const sobra = await ddb.saldoDe(id);
    const dois = await Promise.allSettled([
      ddb.gastarNaLoja({ playerId: id, diamantes: sobra, produtoId: 'x', nome: 'x' }),
      ddb.gastarNaLoja({ playerId: id, diamantes: sobra, produtoId: 'x', nome: 'x' }),
    ]);
    ok(dois.filter((d) => d.status === 'fulfilled').length === 1, 'dois cliques simultâneos: só UM passa');
    ok((await ddb.saldoDe(id)) === 0, 'e o saldo para exatamente em zero', `${await ddb.saldoDe(id)}`);

    const e = await ddb.estornarCompra({ playerId: id, diamantes: 30, produtoId: 'x', nota: 'teste' });
    ok(e.saldo === 30, 'o estorno devolve', `${e.saldo}`);

    // -------------------------------------------------------- auditoria
    secao('Auditoria');
    ok((await ddb.conferirSaldo()).length === 0, 'nenhum saldo divergente entre cache e ledger');

    const extrato = await ddb.extratoDoJogador(id);
    ok(extrato.length > 0, 'o extrato tem linhas', `${extrato.length}`);
    ok(extrato[0].motivo === MOTIVO.LOJA_ESTORNO, 'e a mais recente é o estorno');

    // As conferências abaixo são POR JOGADOR, não pelos totais globais. Um banco de
    // desenvolvimento tem lixo de sessões anteriores, e um teste que soma a tabela inteira
    // passa a falhar por causa de dados que não são dele — foi o que aconteceu com
    // `teste-orbs.mjs`, que só passa em banco limpo.
    const meuLedger = await pool.query(
      `SELECT motivo, SUM(delta)::int AS v FROM diamante_ledger WHERE player_id = $1 GROUP BY motivo`,
      [id],
    );
    const porMotivo = Object.fromEntries(meuLedger.rows.map((r) => [r.motivo, r.v]));
    ok(porMotivo[MOTIVO.COMPRA] === 1500, 'a emissão dele bate com o que pagou (300+100+1000+100)',
       `${porMotivo[MOTIVO.COMPRA]}`);

    const meusPag = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(centavos),0)::int AS v
         FROM diamante_pagamentos WHERE player_id = $1 AND status = $2`,
      [id, PAGAMENTO.PAGO],
    );
    // O parcial recusado não entra; o pago A MAIS entra pelo valor COBRADO, não pelo recebido.
    ok(meusPag.rows[0].n === 4, 'quatro pagamentos confirmados', `${meusPag.rows[0].n}`);
    const cobrado = precoEmCentavos(300) + precoEmCentavos(100) * 2 + precoEmCentavos(1000);
    ok(meusPag.rows[0].v === cobrado,
       'o faturamento soma o valor COBRADO de cada um', `${meusPag.rows[0].v} vs ${cobrado}`);

    // As funções GLOBAIS de auditoria continuam sendo exercitadas — só não se afere o número,
    // que depende do banco. O que importa aqui é que elas respondem e incluem este jogador.
    const totais = await ddb.totaisPorMotivo();
    ok(totais[MOTIVO.COMPRA] >= 1500, 'o total global inclui a emissão deste jogador');
    const fat = await ddb.faturamentoCentavos();
    ok(fat.pagamentos >= 4 && fat.centavos >= cobrado, 'e o faturamento global também');
  } finally {
    await limpar();
    await pool.end();
  }
}

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
