// Teste das ORBs. Precisa do Postgres no ar (`npm run infra`) — o ponto do sistema é ser
// transacional, e testar isso sem banco testaria outra coisa.
//
// A blockchain é a SIMULADA (`redeSimulada`), que sabe forçar o pior caso: broadcast
// respondendo erro numa transação que caiu do mesmo jeito. É esse cenário que separa
// "reenviar" de "pagar duas vezes", e é o principal motivo deste arquivo existir.
//
//   node tools/teste-orbs.mjs
import { pool } from '../src/server/db.mjs';
import * as odb from '../src/server/orbs-db.mjs';
import { redeSimulada } from '../src/server/chain.mjs';
import { processarSaque, conferirEnviados } from '../src/server/orbs-worker.mjs';
import {
  PRECO_COMPRA,
  PRECO_SAQUE,
  SPREAD,
  SAQUE,
  SAQUE_MINIMO_ORBS,
  REENVIO_DELAY_MS,
  MOTIVO,
  MOTIVOS_QUE_EMITEM,
  validarSaque,
  podeReenviar,
  orbsParaUsdt,
  usdtParaOrbs,
  enderecoValido,
  resumoDoCaixa,
  novaReferencia,
} from '../src/server/game/orbs.mjs';
import {
  PCT_ORB_COMISSAO, TETO_ORB_MAX, TETO_ORB_RUINA, TETO_ORB_SEGURO, margemDoDeposito, tetoDaGema,
} from '../src/server/game/afiliados.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const ENDERECO_SOL = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const ENDERECO_EVM = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

console.log('ORBs — economia e saque\n=======================');

// ------------------------------------------------------------- aritmética

secao('Preços e conversão');
{
  // Os DOIS preços são fixados à mão de propósito: são a decisão de economia, e um teste que
  // os derivasse do próprio código não testaria nada. Rebalanceou? Estas duas linhas mudam, e
  // as de baixo acompanham sozinhas — elas saem daqui, não de números repetidos à mão.
  //
  // 0,009 e não 0,007: o spread foi de 30% para 10% quando as taxas de gema e de saque
  // passaram a se multiplicar (ver o cabeçalho de `game/orbs.mjs`). Em 30/30 sobravam 49% do
  // valor para quem vende gema e depois saca; em 15/10 sobram 76,5%.
  ok(PRECO_COMPRA === 0.01, 'compra a US$ 0,01 por ORB');
  ok(PRECO_SAQUE === 0.009, 'recompra a US$ 0,009 por ORB');

  const spreadEsperado = 1 - PRECO_SAQUE / PRECO_COMPRA;
  ok(Math.abs(SPREAD - spreadEsperado) < 1e-9 && Math.abs(SPREAD - 0.1) < 1e-9,
    'o spread é exatamente 10%', `${(SPREAD * 100).toFixed(4)}%`);

  ok(usdtParaOrbs(10) === 1000, 'US$ 10 compram 1.000 ORBs');
  ok(Math.abs(orbsParaUsdt(1000) - 1000 * PRECO_SAQUE) < 1e-9,
    `e 1.000 ORBs sacam US$ ${(1000 * PRECO_SAQUE).toFixed(2)}`, `${orbsParaUsdt(1000)}`);
  ok(usdtParaOrbs(9.999) === 999, 'a compra TRUNCA (nunca credita ORB a mais)');

  // O invariante do caixa: sacar tudo que foi comprado devolve menos do que entrou.
  const entrou = 1000 * PRECO_COMPRA;
  const sai = orbsParaUsdt(1000);
  const margem = 1000 * (PRECO_COMPRA - PRECO_SAQUE);
  ok(sai < entrou, 'sacar tudo devolve MENOS do que entrou — o caixa não fura');
  ok(Math.abs(entrou - sai - margem) < 1e-9,
    `a margem de US$ 10 é US$ ${margem.toFixed(2)}`, `${(entrou - sai).toFixed(2)}`);

  // O invariante que a comissão de afiliado pode furar, e que até aqui só existia como
  // COMENTÁRIO em dois arquivos: trocar PCT_ORB_COMISSAO de 0,05 para 0,15 passava verde na
  // suíte inteira e o erro só apareceria no caixa, semanas depois, quando os saques chegassem.
  //
  // A comissão em gema é emissão SEM lastro. Se `saque × (1 + taxa)` passar de `compra`, cada
  // dólar depositado devolve mais de um dólar em saque — e não é margem menor, é arbitragem.
  ok(PRECO_SAQUE * (1 + PCT_ORB_COMISSAO) < PRECO_COMPRA,
    `a comissão padrão de ${(PCT_ORB_COMISSAO * 100).toFixed(0)}% em gema cabe no spread`,
    `${(PRECO_SAQUE * (1 + PCT_ORB_COMISSAO)).toFixed(6)} vs ${PRECO_COMPRA}`);
  ok(TETO_ORB_RUINA <= PRECO_COMPRA / PRECO_SAQUE - 1 + 1e-12,
    `o teto do painel (${(TETO_ORB_RUINA * 100).toFixed(4)}%) é o ponto de empate, não um número escolhido`);
  ok(TETO_ORB_SEGURO < TETO_ORB_RUINA,
    'e o teto sem aviso fica abaixo do de ruína');
  ok(tetoDaGema() <= TETO_ORB_RUINA && tetoDaGema() === Math.min(TETO_ORB_MAX, TETO_ORB_RUINA),
    `o teto que o painel aplica (${(tetoDaGema() * 100).toFixed(0)}%) nunca passa do empate`);
  ok(margemDoDeposito(tetoDaGema()) > 0,
    'e no teto do painel ainda sobra dinheiro no caixa',
    `${(margemDoDeposito(tetoDaGema()) * 100).toFixed(2)}%`);
  ok(Math.abs(margemDoDeposito(PCT_ORB_COMISSAO) - 0.055) < 1e-9,
    'no padrão sobram 5,5% de cada depósito', `${(margemDoDeposito(PCT_ORB_COMISSAO) * 100).toFixed(4)}%`);
  ok(margemDoDeposito(TETO_ORB_RUINA) < 1e-9 && margemDoDeposito(TETO_ORB_RUINA) > -1e-9,
    'no ponto de ruína a margem é exatamente zero');
}

secao('Endereços');
{
  ok(enderecoValido('solana', ENDERECO_SOL), 'aceita endereço Solana');
  ok(enderecoValido('bsc', ENDERECO_EVM), 'aceita endereço EVM');
  ok(!enderecoValido('solana', ENDERECO_EVM), 'RECUSA endereço EVM na Solana');
  ok(!enderecoValido('bsc', ENDERECO_SOL), 'e endereço Solana numa EVM');
  ok(!enderecoValido('solana', ''), 'recusa vazio');
  ok(!enderecoValido('solana', '0O0lI'), 'recusa base58 inválido (0, O, l, I não existem)');
  ok(!enderecoValido('rede_inexistente', ENDERECO_SOL), 'recusa rede desconhecida');
}

secao('Validação do saque');
{
  const base = { rede: 'solana', endereco: ENDERECO_SOL, saldo: 100000 };
  ok(validarSaque({ ...base, orbs: 5000 }).ok, 'saque normal passa');
  ok(!validarSaque({ ...base, orbs: 0 }).ok, 'zero é recusado');
  ok(!validarSaque({ ...base, orbs: -100 }).ok, 'negativo é recusado');
  ok(!validarSaque({ ...base, orbs: SAQUE_MINIMO_ORBS - 1 }).ok, 'abaixo do mínimo é recusado');
  ok(!validarSaque({ ...base, orbs: 200000 }).ok, 'acima do saldo é recusado');
  ok(!validarSaque({ ...base, orbs: 5000, endereco: 'xxx' }).ok, 'endereço inválido é recusado');

  const r = validarSaque({ ...base, orbs: 5000 });
  const usdtDe5k = 5000 * PRECO_SAQUE;
  ok(Math.abs(r.usdt - usdtDe5k) < 1e-9,
    `5.000 ORBs = US$ ${usdtDe5k.toFixed(2)}`, `${r.usdt}`);
}

secao('Regra do reenvio (sem rede)');
{
  const t = Date.now();
  ok(!podeReenviar({ status: SAQUE.ENVIANDO, tentadoEm: t - 2 * REENVIO_DELAY_MS }, t).ok,
     'NUNCA reenvia algo em ENVIANDO — pode estar no ar');
  ok(!podeReenviar({ status: SAQUE.CONFIRMADO, tentadoEm: 0 }, t).ok, 'nem algo já confirmado');
  ok(!podeReenviar({ status: SAQUE.FALHOU, tentadoEm: t - 60_000 }, t).ok, 'falhou há 1 min: ainda não');
  ok(!podeReenviar({ status: SAQUE.FALHOU, tentadoEm: t - 59 * 60_000 }, t).ok, 'falhou há 59 min: ainda não');
  ok(podeReenviar({ status: SAQUE.FALHOU, tentadoEm: t - REENVIO_DELAY_MS - 1 }, t).ok, 'passada 1h: libera');
  ok(REENVIO_DELAY_MS === 3600_000, 'o delay é de exatamente 1 hora');
}

secao('Invariante da emissão');
{
  ok(MOTIVOS_QUE_EMITEM.size === 2, 'existem dois motivos que emitem ORB');
  ok(MOTIVOS_QUE_EMITEM.has(MOTIVO.COMPRA), 'depósito USDT emite');
  ok(MOTIVOS_QUE_EMITEM.has(MOTIVO.AFILIADO), 'comissão de afiliado emite (só após depósito real)');
  ok(!MOTIVOS_QUE_EMITEM.has(MOTIVO.MARKET_VENDA), 'venda no market NÃO emite (só transfere)');
}

secao('Painel do caixa');
{
  const r = resumoDoCaixa({ compradoUsdt: 1000, sacadoUsdt: 210, orbsEmCirculacao: 70000 });
  ok(r.emCaixaUsdt === 790, 'sem RPC: em caixa = ledger − sacado', `${r.emCaixaUsdt}`);
  ok(r.arrecadadoUsdt === 1000, 'arrecadado = SUM depósitos', `${r.arrecadadoUsdt}`);

  const on = resumoDoCaixa({
    compradoUsdt: 143.694719,
    sacadoUsdt: 0,
    orbsEmCirculacao: 70000,
    naCarteira: 124.231097,
    colheitasUsdt: 0,
  });
  ok(on.emCaixaUsdt === 124.231097, 'on-chain: em caixa = tesouraria', `${on.emCaixaUsdt}`);
  ok(on.arrecadadoUsdt === 143.694719, 'arrecadado = histórico de depósitos', `${on.arrecadadoUsdt}`);
  ok(
    Math.abs(on.aguardandoRecolhaUsdt - 19.463622) < 0.001,
    'aguardando = arrecadado − em caixa',
    `${on.aguardandoRecolhaUsdt}`,
  );

  // 70.000 ORBs em circulação (o `orbsEmCirculacao` do resumo acima) ao preço de recompra.
  const passivoEsperado = 70000 * PRECO_SAQUE;
  ok(Math.abs(r.passivoUsdt - passivoEsperado) < 1e-9,
    'o passivo é tudo que sairia se todos sacassem', `${r.passivoUsdt}`);
  ok(r.passivoUsdt < r.emCaixaUsdt, 'e ele fica ABAIXO do caixa — o projeto é solvente');
  ok(r.spreadPct === Math.round(SPREAD * 100), `o painel publica o spread de ${Math.round(SPREAD * 100)}%`);
}

// ------------------------------------------------------------------ banco

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
  await odb.migrar();

  const nick = `orb${Math.floor(Math.random() * 1e6)}`;
  const { rows } = await pool.query(`INSERT INTO players (nick) VALUES ($1) RETURNING id`, [nick]);
  const id = Number(rows[0].id);
  const nick2 = `orb${Math.floor(Math.random() * 1e6)}b`;
  const { rows: r2 } = await pool.query(`INSERT INTO players (nick) VALUES ($1) RETURNING id`, [nick2]);
  const id2 = Number(r2[0].id);

  const limpar = async () => {
    await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [[id, id2]]);
  };

  try {
    // -------------------------------------------------------- depósito
    secao('Depósito');
    const hash = 'hash_teste_' + Math.random().toString(36).slice(2);
    const d1 = await odb.creditarDeposito({
      playerId: id, rede: 'solana', txHash: hash, usdt: 10, orbs: 1000, referencia: 'REF1',
    });
    ok(d1.creditado && d1.saldo === 1000, 'o depósito credita 1.000 ORBs', `${d1.saldo}`);

    // O teste que mais importa neste bloco: reprocessar o MESMO hash não credita de novo.
    const d2 = await odb.creditarDeposito({
      playerId: id, rede: 'solana', txHash: hash, usdt: 10, orbs: 1000, referencia: 'REF1',
    });
    ok(!d2.creditado, 'reprocessar o mesmo hash NÃO credita de novo (idempotente)');
    ok((await odb.saldoDe(id)) === 1000, 'e o saldo continua 1.000', `${await odb.saldoDe(id)}`);

    // --------------------------------------------------------- ledger
    secao('Ledger');
    const ext = await odb.extratoDoJogador(id);
    ok(ext.length === 1, 'o extrato tem uma linha');
    ok(ext[0].delta === 1000 && ext[0].motivo === MOTIVO.COMPRA, 'com o motivo certo');
    ok(ext[0].saldo === 1000, 'e o saldo depois do movimento');
    ok((await odb.conferirSaldo()).length === 0, 'cache e ledger batem');

    // --------------------------------------------------- transferência
    secao('Transferência entre jogadores');
    await odb.transferir({ deId: id, paraId: id2, orbs: 300, ref: 'anuncio1', nota: 'venda de Pikachu' });
    ok((await odb.saldoDe(id)) === 700, 'o vendedor perde 300', `${await odb.saldoDe(id)}`);
    ok((await odb.saldoDe(id2)) === 300, 'o comprador recebe 300', `${await odb.saldoDe(id2)}`);

    const tot = await odb.totaisPorMotivo();
    const emitido = Object.entries(tot)
      .filter(([m]) => MOTIVOS_QUE_EMITEM.has(m))
      .reduce((s, [, v]) => s + v, 0);
    ok(emitido === 1000, 'só a COMPRA emitiu ORB — a transferência não criou nada', `${emitido}`);
    ok((await odb.conferirSaldo()).length === 0, 'e cache e ledger continuam batendo');

    await pool.query(`SELECT 1`);
    let deu = false;
    try {
      await odb.transferir({ deId: id2, paraId: id, orbs: 999999 });
    } catch {
      deu = true;
    }
    ok(deu, 'transferir mais do que se tem estoura');
    ok((await odb.saldoDe(id2)) === 300, 'e a transação inteira volta atrás', `${await odb.saldoDe(id2)}`);

    // ----------------------------------------------------------- saque
    secao('Saque — caminho feliz');
    const chain = redeSimulada('solana');
    const v = validarSaque({ orbs: 700, rede: 'solana', endereco: ENDERECO_SOL, saldo: 700 });
    // (700 está abaixo do mínimo de produção; aqui o que se testa é a mecânica, não a regra)
    const ped = await odb.pedirSaque({ playerId: id, orbs: 700, usdt: orbsParaUsdt(700), rede: 'solana', endereco: ENDERECO_SOL });
    ok(ped.saldo === 0, 'as ORBs saem do saldo NA HORA do pedido', `${ped.saldo}`);
    void v;

    let s = await odb.saquePorId(ped.id);
    ok(s.status === SAQUE.AGUARDANDO, 'o saque nasce aguardando aprovação');
    ok(await odb.aprovarSaque(ped.id, 'test@test.com'), 'admin aprova');
    s = await odb.saquePorId(ped.id);
    ok(s.status === SAQUE.PENDENTE, 'após aprovar fica PENDENTE');

    const des = await processarSaque(chain, s, Date.now());
    ok(des === 'confirmado', 'o worker envia e confirma', des);
    s = await odb.saquePorId(ped.id);
    ok(s.status === SAQUE.CONFIRMADO, 'o status fecha em CONFIRMADO');
    ok(!!s.txHash, 'com o hash da transação gravado');

    // ------------------------------------------------ o caso perigoso
    secao('Saque — falha no broadcast, transação CAIU mesmo assim');
    await odb.creditarDeposito({
      playerId: id, rede: 'solana', txHash: 'hash2_' + Math.random(), usdt: 20, orbs: 2000, referencia: 'REF2',
    });
    const p2 = await odb.pedirSaque({ playerId: id, orbs: 2000, usdt: orbsParaUsdt(2000), rede: 'solana', endereco: ENDERECO_SOL });
    ok(await odb.aprovarSaque(p2.id, 'test@test.com'), 'admin aprova p2');

    // O pior cenário que existe aqui: o envio responde ERRO, mas a rede aceitou.
    chain.ctrl.proximoFalha = { caiuMesmoAssim: true };
    const d = await processarSaque(chain, await odb.saquePorId(p2.id), Date.now());
    ok(d === 'falhou', 'o broadcast falha e o saque vai para FALHOU', d);

    s = await odb.saquePorId(p2.id);
    ok(s.status === SAQUE.FALHOU, 'status FALHOU');
    ok(!!s.txHash, 'MAS o hash foi gravado mesmo na falha — é o que permite reconferir');

    // Reenviar antes de 1h tem de ser recusado.
    const cedo = await processarSaque(chain, s, Date.now());
    ok(cedo === 'adiado', 'reenviar antes de 1h é ADIADO', cedo);
    s = await odb.saquePorId(p2.id);
    ok(s.status === SAQUE.FALHOU, 'e o status não muda');

    // Passada 1h, a reconferência descobre que a transação CAIU — e nada é reenviado.
    const depois = Date.now() + REENVIO_DELAY_MS + 1000;
    const r = await processarSaque(chain, s, depois);
    ok(r === 'confirmado', 'passada 1h, a reconferência acha a transação e CONFIRMA', r);
    s = await odb.saquePorId(p2.id);
    ok(s.status === SAQUE.CONFIRMADO, 'o saque vira CONFIRMADO sem reenviar');
    ok(s.tentativas === 1, 'e NÃO houve segundo envio — ninguém foi pago duas vezes', `${s.tentativas} tentativa(s)`);

    // -------------------------------------- falha de verdade → reenvio
    secao('Saque — falha real, reenvio depois de 1h');
    await odb.creditarDeposito({
      playerId: id, rede: 'solana', txHash: 'hash3_' + Math.random(), usdt: 30, orbs: 3000, referencia: 'REF3',
    });
    const p3 = await odb.pedirSaque({ playerId: id, orbs: 3000, usdt: orbsParaUsdt(3000), rede: 'solana', endereco: ENDERECO_SOL });
    ok(await odb.aprovarSaque(p3.id, 'test@test.com'), 'admin aprova p3');

    chain.ctrl.proximoFalha = { caiuMesmoAssim: false }; // falhou de verdade
    await processarSaque(chain, await odb.saquePorId(p3.id), Date.now());
    s = await odb.saquePorId(p3.id);
    ok(s.status === SAQUE.FALHOU, 'falha real deixa em FALHOU');

    const r3 = await processarSaque(chain, s, Date.now() + REENVIO_DELAY_MS + 1000);
    ok(r3 === 'confirmado', 'passada 1h, o reenvio acontece e confirma', r3);
    s = await odb.saquePorId(p3.id);
    ok(s.tentativas === 2, 'desta vez houve um SEGUNDO envio', `${s.tentativas}`);
    ok(s.status === SAQUE.CONFIRMADO, 'e o saque fecha');

    // ------------------------------------------------------- estorno
    secao('Cancelamento devolve as ORBs');
    await odb.creditarDeposito({
      playerId: id, rede: 'solana', txHash: 'hash4_' + Math.random(), usdt: 5, orbs: 500, referencia: 'REF4',
    });
    const antes = await odb.saldoDe(id);
    const p4 = await odb.pedirSaque({ playerId: id, orbs: 500, usdt: orbsParaUsdt(500), rede: 'solana', endereco: ENDERECO_SOL });
    ok((await odb.saldoDe(id)) === antes - 500, 'o pedido debita');
    const c = await odb.cancelarSaque(p4.id);
    ok(c.ok && c.saldo === antes, 'o cancelamento devolve', `${c.saldo} vs ${antes}`);

    const c2 = await odb.cancelarSaque(p4.id);
    ok(!c2.ok, 'cancelar duas vezes NÃO credita de novo');
    ok((await odb.saldoDe(id)) === antes, 'e o saldo fica igual', `${await odb.saldoDe(id)}`);

    // ------------------------------------------------------ auditoria
    secao('Auditoria');
    ok((await odb.conferirSaldo()).length === 0, 'nenhum saldo divergente entre cache e ledger');

    const ref = await odb.referenciaDe(id, novaReferencia);
    ok(!!ref && ref.length === 12, 'o jogador ganha uma referência de depósito', ref);
    ok((await odb.referenciaDe(id, novaReferencia)) === ref, 'e ela é ESTÁVEL entre chamadas');
    ok((await odb.jogadorPorReferencia(ref)) === id, 'a referência acha o jogador de volta');

    const caixa = await odb.numerosDoCaixa();
    ok(caixa.compradoUsdt === 65, 'o caixa soma os depósitos (10+20+30+5)', `${caixa.compradoUsdt}`);
    ok(caixa.orbsEmCirculacao === (await odb.saldoDe(id)) + (await odb.saldoDe(id2)),
       'circulação = soma dos saldos', `${caixa.orbsEmCirculacao}`);
  } finally {
    await limpar();
    await pool.end();
  }
}

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
