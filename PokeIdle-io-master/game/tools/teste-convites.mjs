// Teste dos CONVITES DO DISCORD — a escada, a atribuição do bot e, sobretudo, a CORRIDA.
//
// O que ele protege:
//
//   · **a régua de um ano**: a data de criação sai do id do Discord e uma conta nova não conta;
//   · **a atribuição**: o convite cujo `uses` subiu é o creditado; dois que sobem juntos não
//     creditam ninguém; um link de uso único que some da lista ainda é atribuído;
//   · **o marco**: os degraus são pagos uma vez, e reprocessar a mesma contagem não gera um
//     segundo código do mesmo degrau;
//   · **O RESGATE ÚNICO, SOB CORRIDA**: 24 conexões disparam `/resgatar` do MESMO código, em
//     contas diferentes, no mesmo instante. Exatamente uma pode ganhar, e o ledger de diamante
//     tem de ter exatamente uma linha — se duas passassem, o código seria uma impressora;
//   · **o formato**: código de outro tamanho, com letra ambígua, com espaço, minúsculo, vazio,
//     com aspas, com `%` — nenhum deles pode achar linha nenhuma;
//   · **a reentrega**: um resgate carimbado e sem entrega volta na varredura, uma vez só.
//
// Precisa de Postgres (o do `docker compose up -d`). Limpa tudo o que criou, mesmo quando falha.
//
//   node tools/teste-convites.mjs
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import * as convdb from '../src/server/convites-db.mjs';
import { acharConviteUsado, gerarCodigosDosMarcos } from '../src/bot/convites.mjs';
import {
  CODIGO_OK, IDADE_MINIMA_MS, MARCOS, contaVelhaOBastante, criadoEmDoSnowflake,
  marcosAlcancados, normalizarCodigo, proximoMarco, vipEhPermanente, VIP_PERMANENTE_ATE,
} from '../src/shared/convites.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};

const secao = (t) => console.log(`
${t}`);

const MARCA = `teste-convite-${Date.now()}`;
const DISC = (n) => `${MARCA}-${n}`;
const criados = { players: [], discord: [] };

/** Um snowflake do Discord com a data de criação que se quiser. */
const snowflakeDe = (ms) => String((BigInt(Math.floor(ms) - 1_420_070_400_000) << 22n) | 7n);

async function limpar() {
  await pool.query(`DELETE FROM convite_codigos WHERE discord_id LIKE $1`, [`${MARCA}%`]);
  await pool.query(`DELETE FROM convite_membros WHERE discord_id LIKE $1 OR padrinho_id LIKE $1`, [`${MARCA}%`]);
  if (criados.players.length) {
    await pool.query(`DELETE FROM diamante_ledger WHERE player_id = ANY($1::bigint[])`, [criados.players]);
    await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [criados.players]);
  }
}

/** Uma conta descartável só para o resgate. O nick leva a marca para a faxina achar. */
async function criarJogador(sufixo) {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, gold, diamonds) VALUES ($1, 1, 0, 0) RETURNING id`,
    [`${MARCA}-${sufixo}`.slice(0, 40)],
  );
  const id = Number(rows[0].id);
  criados.players.push(id);
  return id;
}

// A trava de operacao do bot (`DISCORD_BOT_SO_CONTAR`) faria `gerarCodigosDosMarcos` devolver
// vazio, e metade deste teste existe para exercitar justamente a geracao. Aqui ela sai: o teste
// prova o CONTRATO, nao a configuracao de uma janela de deploy.
if (process.env.DISCORD_BOT_SO_CONTAR) {
  console.log('(DISCORD_BOT_SO_CONTAR ignorado: este teste exercita a geracao de codigo)');
  delete process.env.DISCORD_BOT_SO_CONTAR;
}

try {
  await convdb.migrar();
  await limpar();

  // ---------------------------------------------------------------- a escada
  console.log('\nA escada e o formato do código');
  ok(MARCOS.map((m) => m.amigos).join() === '1,5,10,20,50,100,500', 'os sete degraus, na ordem');
  ok(marcosAlcancados(0).length === 0, 'zero convidados não cruza degrau nenhum');
  ok(marcosAlcancados(1).length === 1, 'um convidado cruza só o primeiro');
  ok(marcosAlcancados(49).length === 4, '49 convidados param no degrau de 20');
  ok(marcosAlcancados(99_999).length === MARCOS.length, 'muito acima de 500 não cria degrau novo');
  ok(proximoMarco(3)?.amigos === 5, 'o próximo depois de 3 é o 5');
  ok(proximoMarco(500) === null, 'não há próximo depois do último');
  ok(
    MARCOS.at(-1).premios.some((p) => p.tipo === 'vipPermanente'),
    'o último degrau dá VIP permanente',
  );
  ok(vipEhPermanente(VIP_PERMANENTE_ATE), 'o instante do VIP permanente é reconhecido');
  ok(!vipEhPermanente(Date.now() + 365 * 86400_000), 'um ano de VIP não é lido como permanente');

  // ------------------------------------------------------- a régua de um ano
  console.log('\nA régua da idade da conta de Discord');
  const agora = Date.now();
  const velho = snowflakeDe(agora - IDADE_MINIMA_MS - 86400_000);
  const novinho = snowflakeDe(agora - 30 * 86400_000);
  const naLinha = snowflakeDe(agora - IDADE_MINIMA_MS + 60_000);
  ok(contaVelhaOBastante(velho, agora), 'conta de 1 ano e 1 dia vale ponto');
  ok(!contaVelhaOBastante(novinho, agora), 'conta de 30 dias não vale ponto');
  ok(!contaVelhaOBastante(naLinha, agora), 'conta de 1 ano menos um minuto não vale ponto');
  ok(!contaVelhaOBastante('não-é-id', agora), 'id malformado não vale ponto');
  ok(!contaVelhaOBastante('', agora), 'id vazio não vale ponto');
  ok(!contaVelhaOBastante(null, agora), 'id nulo não vale ponto');
  ok(
    Math.abs(criadoEmDoSnowflake(velho) - (agora - IDADE_MINIMA_MS - 86400_000)) < 2,
    'a data sai do snowflake com precisão de ms',
  );

  // -------------------------------------------------------- a atribuição do bot
  console.log('\nA atribuição do convite usado');
  const mapa = (o) => new Map(Object.entries(o));
  const antes = mapa({
    aaa: { usos: 3, maxUsos: 0, donoId: 'p1' },
    bbb: { usos: 7, maxUsos: 0, donoId: 'p2' },
    ccc: { usos: 0, maxUsos: 1, donoId: 'p3' },
  });
  ok(
    acharConviteUsado(antes, mapa({
      aaa: { usos: 4, maxUsos: 0, donoId: 'p1' },
      bbb: { usos: 7, maxUsos: 0, donoId: 'p2' },
      ccc: { usos: 0, maxUsos: 1, donoId: 'p3' },
    }))?.donoId === 'p1',
    'o convite cujo contador subiu é o creditado',
  );
  ok(
    acharConviteUsado(antes, mapa({
      aaa: { usos: 4, maxUsos: 0, donoId: 'p1' },
      bbb: { usos: 8, maxUsos: 0, donoId: 'p2' },
      ccc: { usos: 0, maxUsos: 1, donoId: 'p3' },
    })) === null,
    'dois contadores subindo juntos não creditam ninguém',
  );
  ok(
    acharConviteUsado(antes, mapa({
      aaa: { usos: 3, maxUsos: 0, donoId: 'p1' },
      bbb: { usos: 7, maxUsos: 0, donoId: 'p2' },
    }))?.donoId === 'p3',
    'link de uso único que some da lista é atribuído ao dono dele',
  );
  ok(
    acharConviteUsado(antes, mapa({
      aaa: { usos: 3, maxUsos: 0, donoId: 'p1' },
      bbb: { usos: 7, maxUsos: 0, donoId: 'p2' },
      ccc: { usos: 0, maxUsos: 1, donoId: 'p3' },
      ddd: { usos: 0, maxUsos: 0, donoId: 'p4' },
    })) === null,
    'convite NOVO com zero usos não é confundido com uso',
  );
  ok(
    acharConviteUsado(antes, antes) === null,
    'lista igual (entrada por vanity) não credita ninguém',
  );

  // ---------------------------------------------------- a contagem e os marcos
  console.log('\nA contagem de convidados e a geração de códigos');
  const padrinho = DISC('padrinho');
  criados.discord.push(padrinho);
  // Cinco convidados velhos (valem) e três novinhos (não valem).
  for (let i = 0; i < 5; i++) {
    await convdb.registrarMembro({
      discordId: `${DISC('v')}${i}`, padrinhoId: padrinho, valePonto: true,
      contaCriadaEm: agora - IDADE_MINIMA_MS - 86400_000,
    });
  }
  for (let i = 0; i < 3; i++) {
    await convdb.registrarMembro({
      discordId: `${DISC('n')}${i}`, padrinhoId: padrinho, valePonto: false,
      contaCriadaEm: agora - 86400_000,
    });
  }
  ok(await convdb.contarConvidados(padrinho) === 5, 'só os convidados de conta velha contam');

  await convdb.registrarSaida(`${DISC('v')}0`);
  ok(await convdb.contarConvidados(padrinho) === 4, 'quem sai do servidor para de contar');

  // Reentrada NÃO troca o padrinho — é a trava contra passear o ponto entre contas.
  const outro = DISC('outro-padrinho');
  const re = await convdb.registrarMembro({
    discordId: `${DISC('v')}1`, padrinhoId: outro, valePonto: true,
  });
  ok(re.padrinhoId === padrinho, 'reentrada por outro link mantém o padrinho original');

  // Os códigos. O bot é chamado com `token` e `canalLogId` nulos: sem eles ele gera e registra
  // sem tentar falar com o Discord (o privado falha, é logado e o código continua guardado).
  const gerados = await gerarCodigosDosMarcos({
    token: null, canalLogId: null, padrinhoId: padrinho, convidados: 12,
  });
  ok(gerados.length === 3, 'com 12 convidados nascem os códigos de 1, 5 e 10', `saiu ${gerados.length}`);
  ok(gerados.every((g) => CODIGO_OK.test(g.codigo)), 'todo código tem o formato esperado');
  ok(new Set(gerados.map((g) => g.codigo)).size === 3, 'os três códigos são diferentes');

  const denovo = await gerarCodigosDosMarcos({
    token: null, canalLogId: null, padrinhoId: padrinho, convidados: 12,
  });
  ok(denovo.length === 0, 'reprocessar a mesma contagem não gera código novo');

  const maisUm = await gerarCodigosDosMarcos({
    token: null, canalLogId: null, padrinhoId: padrinho, convidados: 20,
  });
  ok(maisUm.length === 1 && maisUm[0].marco === 20, 'cruzar o degrau seguinte gera só ele');

  // -------------------------------------------- a mesma pessoa entrando e saindo
  //
  // O ataque óbvio de qualquer programa de convite: UMA pessoa entra pelo meu link, sai, entra,
  // sai — e o meu número sobe a cada volta. Aqui ele não existe, e a razão é estrutural:
  // `discord_id` é PRIMARY KEY, então uma conta do Discord é UMA linha, para sempre, e a
  // contagem é `count(*)` de linhas. Reentrar faz um UPDATE, nunca um INSERT.
  //
  // Esta seção prova isso no banco, e prova junto as duas travas que andam com ele: o padrinho
  // da primeira vez é o padrinho para sempre, e o ciclo não faz nascer código novo.
  secao('A MESMA PESSOA entrando e saindo (o ataque do vaivém)');
  {
    const pad = DISC('vaivem-padrinho');
    const ladrao = DISC('vaivem-ladrao');
    const velha = agora - IDADE_MINIMA_MS - 86400_000;

    // Vinte voltas de entra-e-sai pelo MESMO link.
    for (let i = 0; i < 20; i++) {
      await convdb.registrarMembro({
        discordId: ladrao, padrinhoId: pad, valePonto: true, contaCriadaEm: velha,
      });
      await convdb.registrarSaida(ladrao);
    }
    await convdb.registrarMembro({
      discordId: ladrao, padrinhoId: pad, valePonto: true, contaCriadaEm: velha,
    });
    ok(await convdb.contarConvidados(pad) === 1,
      '20 idas e voltas pelo mesmo link valem UM convidado', String(await convdb.contarConvidados(pad)));

    const { rows: linhas } = await pool.query(
      `SELECT count(*)::int AS n FROM convite_membros WHERE discord_id = $1`, [ladrao],
    );
    ok(linhas[0].n === 1, 'e a conta do Discord tem UMA linha na tabela, não vinte');

    // Dentro do ciclo, enquanto está fora, ele não conta.
    await convdb.registrarSaida(ladrao);
    ok(await convdb.contarConvidados(pad) === 0, 'saindo, o ponto some na hora');
    await convdb.registrarMembro({ discordId: ladrao, padrinhoId: pad, valePonto: true });
    ok(await convdb.contarConvidados(pad) === 1, 'e volta a UM ao reentrar — nunca a dois');

    // O ciclo não pode fazer nascer código novo do marco que já foi pago.
    const antes = await gerarCodigosDosMarcos({
      token: null, canalLogId: null, padrinhoId: pad, convidados: 1,
    });
    ok(antes.length === 1, 'o marco de 1 gera o código dele uma vez');
    await convdb.registrarSaida(ladrao);
    await convdb.registrarMembro({ discordId: ladrao, padrinhoId: pad, valePonto: true });
    const depois = await gerarCodigosDosMarcos({
      token: null, canalLogId: null, padrinhoId: pad, convidados: 1,
    });
    ok(depois.length === 0, 'e o vaivém depois disso não faz nascer um segundo código');
  }

  // ------------------------------------------------ trocar de padrinho no vaivém
  //
  // A outra metade do mesmo ataque: eu entro pelo link do A, saio, e entro pelo link do B — e
  // agora sou ponto do B também (ou em vez do A). Duas pessoas cobrando o mesmo convidado.
  //
  // E o caso que a versão de estreia deixou passar: quem entra pelo link GERAL (vanity, sem
  // padrinho) e depois sai e reentra pelo link de alguém. O `COALESCE` preenchia o padrinho
  // vazio, e a base inteira de um servidor que já existe podia ser "reindicada" num mutirão de
  // sair-e-voltar. Padrinho é da PRIMEIRA vez, e vazio na primeira vez é vazio para sempre.
  secao('Trocar de padrinho no vaivém');
  {
    const a = DISC('padA');
    const b = DISC('padB');
    const pessoa = DISC('pessoa-troca');
    const velha = agora - IDADE_MINIMA_MS - 86400_000;

    await convdb.registrarMembro({ discordId: pessoa, padrinhoId: a, valePonto: true, contaCriadaEm: velha });
    await convdb.registrarSaida(pessoa);
    const r = await convdb.registrarMembro({ discordId: pessoa, padrinhoId: b, valePonto: true, contaCriadaEm: velha });
    ok(r.padrinhoId === a, 'reentrar pelo link de outro NÃO troca o padrinho');
    ok(await convdb.contarConvidados(a) === 1, 'o primeiro continua com o ponto');
    ok(await convdb.contarConvidados(b) === 0, 'e o segundo não ganha nada');

    // Entrou SEM padrinho (vanity, ou já estava no servidor antes do bot).
    const antigo = DISC('ja-estava-aqui');
    await convdb.registrarMembro({ discordId: antigo, padrinhoId: null, valePonto: true, contaCriadaEm: velha });
    await convdb.registrarSaida(antigo);
    const r2 = await convdb.registrarMembro({ discordId: antigo, padrinhoId: b, valePonto: true, contaCriadaEm: velha });
    ok(r2.padrinhoId === null, 'quem entrou SEM padrinho não ganha um ao reentrar por um link');
    ok(await convdb.contarConvidados(b) === 0,
      'um mutirão de sair-e-voltar não vira pontos para ninguém', String(await convdb.contarConvidados(b)));
  }

  // ------------------------------------------------------ o formato, no resgate
  console.log('\nO que o resgate recusa antes de ir ao banco');
  const jogador = await criarJogador('a');
  const lixo = [
    '', '   ', 'abc', 'AAAAAAAAA', 'AAAAAAAAAAA', 'AAAAAAAAAI', 'AAAAAAAAA0',
    "' OR 1=1 --", '%', '________', 'aaaaaaaaaa'.toUpperCase().replace('A', 'O'),
  ];
  let recusados = 0;
  for (const bruto of lixo) {
    try {
      await convdb.resgatar({ codigo: bruto, playerId: jogador });
    } catch (err) {
      if (err instanceof convdb.ErroConvite) recusados++;
    }
  }
  ok(recusados === lixo.length, 'todo código malformado é recusado', `${recusados}/${lixo.length}`);
  ok(normalizarCodigo(' k7m2-qx 4p9z ') === 'K7M2QX4P9Z', 'espaço, hífen e minúscula são normalizados');

  // ----------------------------------------------------------------- A CORRIDA
  //
  // O teste que importa. 24 conexões, 24 contas diferentes, o MESMO código, disparadas de uma
  // vez com `Promise.all` — sem `await` entre elas, para que as transações de fato se cruzem
  // dentro do Postgres.
  console.log('\nA CORRIDA: 24 contas resgatando o mesmo código ao mesmo tempo');
  const doCorrida = gerados.find((g) => g.marco === 1); // o marco que paga 5 💎
  const corredores = [];
  for (let i = 0; i < 24; i++) corredores.push(await criarJogador(`c${i}`));

  const resultados = await Promise.all(corredores.map((pid) =>
    convdb.resgatar({ codigo: doCorrida.codigo, playerId: pid })
      .then((r) => ({ pid, ok: true, r }))
      .catch((err) => ({ pid, ok: false, chave: err.chave ?? err.message })),
  ));
  const vencedores = resultados.filter((r) => r.ok);
  ok(vencedores.length === 1, 'exatamente UM resgate passa', `passaram ${vencedores.length}`);
  ok(
    resultados.filter((r) => !r.ok).every((r) => r.chave === 'convite.usado'),
    'todos os outros recebem "já foi resgatado"',
  );

  const { rows: linhasLedger } = await pool.query(
    `SELECT player_id, delta FROM diamante_ledger WHERE motivo = 'convite' AND ref = $1`,
    [doCorrida.codigo],
  );
  ok(linhasLedger.length === 1, 'o ledger tem UMA linha de crédito', `tem ${linhasLedger.length}`);
  ok(Number(linhasLedger[0]?.delta) === 5, 'e ela credita os 5 diamantes do marco');
  ok(
    Number(linhasLedger[0]?.player_id) === vencedores[0]?.pid,
    'o crédito foi para a conta que ganhou a corrida',
  );

  const { rows: saldos } = await pool.query(
    `SELECT id, diamonds FROM players WHERE id = ANY($1::bigint[]) AND diamonds > 0`,
    [corredores],
  );
  ok(saldos.length === 1 && Number(saldos[0].diamonds) === 5,
    'só uma conta ficou com saldo, e com 5', `${saldos.length} conta(s) com saldo`);

  const { rows: carimbo } = await pool.query(
    `SELECT player_id, resgatado_em, entregue_em FROM convite_codigos WHERE codigo = $1`,
    [doCorrida.codigo],
  );
  ok(carimbo[0]?.resgatado_em != null, 'o código ficou carimbado como resgatado');
  ok(Number(carimbo[0]?.player_id) === vencedores[0]?.pid, 'com a conta do vencedor na linha');

  // Uma 25ª tentativa depois da poeira baixar continua recusada.
  const tardio = await convdb.resgatar({ codigo: doCorrida.codigo, playerId: jogador })
    .then(() => 'passou')
    .catch((err) => err.chave);
  ok(tardio === 'convite.usado', 'uma tentativa tardia também é recusada');

  // -------------------------------------------------------------- a reentrega
  console.log('\nA rede de segurança da entrega');
  ok(carimbo[0]?.entregue_em == null, 'o resgate nasce SEM carimbo de entrega');
  const pendentes = await convdb.pendentesDoJogador(vencedores[0].pid);
  ok(pendentes.length === 1 && pendentes[0].codigo === doCorrida.codigo,
    'e aparece na lista de pendentes do vencedor');
  await convdb.marcarEntregue(doCorrida.codigo);
  ok((await convdb.pendentesDoJogador(vencedores[0].pid)).length === 0,
    'depois de entregue, some da lista');
  await convdb.marcarEntregue(doCorrida.codigo);
  ok((await convdb.pendentesDoJogador(vencedores[0].pid)).length === 0,
    'marcar entregue duas vezes não reabre nada');

  // -------------------------------------- o código de um marco não paga o outro
  console.log('\nO código carrega o marco dele, e não outro');
  const do10 = gerados.find((g) => g.marco === 10);
  const r10 = await convdb.resgatar({ codigo: do10.codigo, playerId: jogador });
  ok(r10.marco === 10, 'o código do degrau de 10 resgata o degrau de 10');
  ok(r10.premios.every((p) => p.tipo !== 'diamante'), 'e o degrau de 10 não paga diamante');
  const { rows: semLedger } = await pool.query(
    `SELECT 1 FROM diamante_ledger WHERE ref = $1`, [do10.codigo],
  );
  ok(semLedger.length === 0, 'um marco sem diamante não escreve no ledger');
} finally {
  await limpar().catch((err) => console.error('faxina falhou:', err.message));
  await pool.end();
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} passaram`);
process.exit(falhas ? 1 : 0);
