// Persistência dos CONVITES DO DISCORD: quem entrou por quem, e os códigos dos marcos.
//
// Duas tabelas, dois donos:
//
//   `convite_membros`  quem entrou no Discord e por qual link. Quem escreve é o BOT
//                      (`src/bot/`), e ninguém mais. O jogo só lê.
//   `convite_codigos`  os códigos gerados nos marcos. O bot INSERE, o jogo RESGATA.
//
// ### O código é transferível — de propósito, e com uma trava
//
// O código chega no privado do Discord e vale em QUALQUER conta do jogo (foi a decisão de
// produto: exigir login por Discord deixaria de fora todo mundo que entrou por Google ou
// e-mail). Ou seja: quem recebe pode passar adiante, e isso é aceito.
//
// O que NÃO é aceito é o mesmo código valer duas vezes. Um código é de uso único, e a garantia
// não está em JavaScript nenhum: está no `WHERE resgatado_em IS NULL` do `UPDATE` que carimba o
// resgate, dentro da transação que credita o diamante.
//
// ### Por que esse `WHERE` fecha a corrida, e um `SELECT` antes não fecharia
//
// Duas conexões chegando no mesmo milissegundo com o mesmo código, em READ COMMITTED:
//
//   T1  UPDATE … WHERE codigo='X' AND resgatado_em IS NULL   → pega o lock da linha, casa, 1 row
//   T2  UPDATE … (mesma linha)                               → BLOQUEIA no lock de T1
//   T1  COMMIT
//   T2  desbloqueia, RE-AVALIA o WHERE contra a versão nova  → resgatado_em já preenchido → 0 rows
//
// A re-avaliação do predicado depois do desbloqueio (`EvalPlanQual`, no Postgres) é o que faz o
// segundo enxergar o carimbo do primeiro. Um `SELECT … ; if (!resgatado) UPDATE …` não tem esse
// degrau: os dois SELECTs leem "livre" antes de qualquer UPDATE, e os dois creditam.
//
// A mesma linha guarda `player_id`, então o extrato do ledger e esta tabela contam a mesma
// história sobre quem levou o prêmio. `tools/teste-convites.mjs` dispara N resgates simultâneos
// do mesmo código, em contas diferentes, e exige exatamente UM sucesso e UM crédito no ledger.
//
// ### A entrega em dois tempos
//
// O diamante é creditado DENTRO da transação do resgate (é ledger, e o `flushJogadores` não
// escreve `diamonds`). O resto do prêmio — bola, boost, VIP — mora nas colunas do jogador, que
// são gravadas pelo write-behind do sim. Entre uma coisa e outra existe uma janela: um processo
// que morresse ali deixaria o código gasto e as 5.000 Beast Balls perdidas.
//
// Por isso o carimbo é DOIS: `resgatado_em` (o código foi gasto, ninguém mais usa) e
// `entregue_em` (o prêmio de jogo entrou na conta e foi gravado). Um resgate com o primeiro e
// sem o segundo é reentregue no próximo login — ver `pendentesDoJogador`.
import { pool } from './db.mjs';
import { movimentarNaTransacao } from './diamantes-db.mjs';
import { MOTIVO } from './game/diamantes.mjs';
import {
  ALFABETO_CODIGO, CODIGO_LEN, CODIGO_OK, marcoDe, normalizarCodigo,
} from '../shared/convites.mjs';
import { randomInt } from 'node:crypto';

export async function migrar() {
  // Quem entrou no NOSSO servidor de Discord, e por qual link.
  //
  // `padrinho_id` é NULL quando o bot não conseguiu atribuir (link de vanity, convite apagado
  // entre a entrada e a releitura, dois links usados no mesmo instante). Registrar a entrada
  // sem padrinho é melhor do que não registrar: o canal mostra que a pessoa entrou e o
  // histórico não fica com buraco.
  //
  // `vale_ponto` é decidido na ENTRADA e congelado: é a régua da idade da conta de Discord
  // (`contaVelhaOBastante`), e uma conta que hoje não vale não pode passar a valer amanhã só
  // porque envelheceu — senão uma fazenda criada hoje vira pontos daqui a um ano.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS convite_membros (
      discord_id     TEXT PRIMARY KEY,
      padrinho_id    TEXT,
      convite_codigo TEXT,
      nome           TEXT,
      conta_criada_em TIMESTAMPTZ,
      vale_ponto     BOOLEAN NOT NULL DEFAULT false,
      entrou_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
      saiu_em        TIMESTAMPTZ
    )`);
  // A contagem de um padrinho é uma varredura por `padrinho_id`; sem o índice ela é a tabela
  // inteira a cada membro que entra.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_convite_padrinho ON convite_membros(padrinho_id)
      WHERE padrinho_id IS NOT NULL`,
  );

  // Os códigos dos marcos. `UNIQUE (discord_id, marco)` é o que impede o bot de gerar dois
  // códigos do mesmo degrau — e ele é conferido no BANCO porque o bot pode reiniciar no meio
  // de uma rajada de entradas e reprocessar a mesma contagem.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS convite_codigos (
      codigo       TEXT PRIMARY KEY,
      discord_id   TEXT NOT NULL,
      marco        INT  NOT NULL,
      convidados   INT  NOT NULL DEFAULT 0,
      criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
      enviado_em   TIMESTAMPTZ,
      player_id    BIGINT REFERENCES players(id) ON DELETE SET NULL,
      resgatado_em TIMESTAMPTZ,
      entregue_em  TIMESTAMPTZ,
      UNIQUE (discord_id, marco)
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_convite_codigos_pendentes
       ON convite_codigos(player_id)
      WHERE resgatado_em IS NOT NULL AND entregue_em IS NULL`,
  );
}

// ------------------------------------------------------------------ o bot escreve

/**
 * Registra (ou atualiza) um membro que entrou. Idempotente por `discord_id`.
 *
 * ### O padrinho é da PRIMEIRA entrada, e só dela
 *
 * `discord_id` é PRIMARY KEY, então uma conta do Discord é UMA linha para sempre e a contagem é
 * `count(*)` de linhas: entrar e sair vinte vezes pelo mesmo link vale um convidado, e nunca
 * vinte. Isso o `ON CONFLICT` já dava de graça.
 *
 * O que ele NÃO dava era o caso do padrinho VAZIO. A primeira versão fazia
 * `COALESCE(padrinho_atual, novo)`, e aí quem tinha entrado pelo link geral do servidor (vanity,
 * sem dono) podia sair e voltar por um link de alguém e virar ponto dele. Num servidor que já
 * tem milhares de membros, isso é um mutirão de "sai e volta pelo meu link" e o programa inteiro
 * vira farm.
 *
 * Agora o `DO UPDATE` **não toca em `padrinho_id`**: preenchido, fica; vazio, fica vazio para
 * sempre. O preço é que quem entrou sem atribuição e foi genuinamente reindicado depois nunca
 * conta — e esse é o lado certo de errar numa regra que existe para impedir farm.
 *
 * A outra metade da trava é `semearMembros`, logo abaixo: quem já estava no servidor antes do
 * bot não tem linha nenhuma, e sem ela um sai-e-volta viraria um INSERT novinho, com padrinho.
 */
export async function registrarMembro({
  discordId, padrinhoId = null, conviteCodigo = null, nome = null,
  contaCriadaEm = null, valePonto = false,
}) {
  const { rows } = await pool.query(
    `INSERT INTO convite_membros
       (discord_id, padrinho_id, convite_codigo, nome, conta_criada_em, vale_ponto)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (discord_id) DO UPDATE
       SET convite_codigo = COALESCE(convite_membros.convite_codigo, EXCLUDED.convite_codigo),
           nome           = COALESCE(EXCLUDED.nome, convite_membros.nome),
           saiu_em        = NULL
     RETURNING padrinho_id, vale_ponto, (xmax = 0) AS novo`,
    [
      String(discordId), padrinhoId ? String(padrinhoId) : null,
      conviteCodigo ? String(conviteCodigo) : null, nome ? String(nome).slice(0, 80) : null,
      contaCriadaEm ? new Date(contaCriadaEm) : null, !!valePonto,
    ],
  );
  const r = rows[0];
  return { padrinhoId: r.padrinho_id, valePonto: r.vale_ponto, novo: r.novo };
}

/**
 * Registra, SEM padrinho, todo mundo que já está no servidor.
 *
 * O bot só vê quem entra DEPOIS de ele subir. Quem já estava lá não tem linha — e sem linha, um
 * sai-e-volta pelo link de alguém vira um INSERT novinho em folha, com padrinho. Numa base que
 * já existe, isso é o mutirão descrito em `registrarMembro`, e nenhuma trava do `ON CONFLICT`
 * alcança, porque não há conflito nenhum.
 *
 * Semear resolve: todo membro atual ganha uma linha com `padrinho_id` NULL, e a partir daí
 * qualquer reentrada dele é um UPDATE, que por regra não preenche padrinho.
 *
 * `ON CONFLICT DO NOTHING`, então rodar a cada boot é seguro: quem já tem linha (inclusive quem
 * já foi creditado a alguém) não é tocado. E rodar sempre é melhor do que rodar uma vez — pega
 * quem entrou enquanto o bot estava fora do ar, que é gente cuja atribuição se perdeu de
 * qualquer jeito.
 *
 * `membros`: `[{ discordId, nome, entrouEm, contaCriadaEm, valePonto }]`.
 * @returns quantas linhas NASCERAM (as que já existiam não contam)
 */
export async function semearMembros(membros) {
  const lista = (membros ?? []).filter((m) => m?.discordId);
  if (!lista.length) return 0;
  const { rowCount } = await pool.query(
    `INSERT INTO convite_membros
       (discord_id, padrinho_id, nome, conta_criada_em, vale_ponto, entrou_em)
     SELECT v.discord_id, NULL, v.nome, v.criada, v.vale, COALESCE(v.entrou, now())
       FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::boolean[], $5::timestamptz[])
            AS v(discord_id, nome, criada, vale, entrou)
     ON CONFLICT (discord_id) DO NOTHING`,
    [
      lista.map((m) => String(m.discordId)),
      lista.map((m) => (m.nome ? String(m.nome).slice(0, 80) : null)),
      lista.map((m) => (m.contaCriadaEm ? new Date(m.contaCriadaEm) : null)),
      lista.map((m) => !!m.valePonto),
      lista.map((m) => (m.entrouEm ? new Date(m.entrouEm) : null)),
    ],
  );
  return rowCount;
}

/** Marca que alguém saiu do servidor. O ponto dele para de contar (ver `contarConvidados`). */
export async function registrarSaida(discordId) {
  await pool.query(
    `UPDATE convite_membros SET saiu_em = now() WHERE discord_id = $1 AND saiu_em IS NULL`,
    [String(discordId)],
  );
}

/**
 * Quantos convidados VALENDO um padrinho tem: conta velha o bastante e ainda no servidor.
 *
 * Quem saiu não conta. É o que impede o "entra, conta o ponto, sai, entra de novo" — e também
 * o que faz o número do canal ser o número real de gente que o jogador trouxe e ficou.
 */
export async function contarConvidados(padrinhoId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM convite_membros
      WHERE padrinho_id = $1 AND vale_ponto AND saiu_em IS NULL`,
    [String(padrinhoId)],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * A contagem de convidados válidos de TODOS os padrinhos de uma vez.
 *
 * Serve à varredura de marcos atrasados do boot (ver `varrerMarcosAtrasados`): sem ela, cada
 * padrinho custaria uma consulta, e a lista cresce com o programa.
 *
 * @returns `[{ padrinhoId, convidados }]`, só quem tem pelo menos um
 */
export async function contagemDeTodos() {
  const { rows } = await pool.query(
    `SELECT padrinho_id, count(*)::int AS n
       FROM convite_membros
      WHERE padrinho_id IS NOT NULL AND vale_ponto AND saiu_em IS NULL
      GROUP BY padrinho_id
      ORDER BY n DESC`,
  );
  return rows.map((r) => ({ padrinhoId: r.padrinho_id, convidados: Number(r.n) }));
}

/** Os marcos que este padrinho já tem código. */
export async function marcosJaGerados(padrinhoId) {
  const { rows } = await pool.query(
    `SELECT marco FROM convite_codigos WHERE discord_id = $1`,
    [String(padrinhoId)],
  );
  return new Set(rows.map((r) => Number(r.marco)));
}

/** Um código novo, sorteado com CSPRNG. Sem `Math.random`: ele é um ticket com valor. */
export function sortearCodigo() {
  let s = '';
  for (let i = 0; i < CODIGO_LEN; i++) s += ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)];
  return s;
}

/**
 * Gera o código de um marco. Devolve `{ codigo, novo }` — `novo: false` quando o marco já tinha
 * código (e devolve o que já existia, para o bot reenviar no privado sem duplicar prêmio).
 *
 * A colisão de `codigo` é tratada por retentativa: 32^10 é grande o bastante para ela nunca
 * acontecer, e "nunca acontecer" não é o mesmo que "não precisa de caminho".
 */
export async function gerarCodigo(padrinhoId, marco, convidados = 0) {
  if (!marcoDe(marco)) throw new Error(`marco desconhecido: ${marco}`);
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const codigo = sortearCodigo();
    const { rows } = await pool.query(
      `INSERT INTO convite_codigos (codigo, discord_id, marco, convidados)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (discord_id, marco) DO NOTHING
       RETURNING codigo`,
      [codigo, String(padrinhoId), Number(marco), Math.max(0, Number(convidados) || 0)],
    );
    if (rows.length) return { codigo: rows[0].codigo, novo: true };
    // Ou o marco já tinha código, ou o `codigo` sorteado colidiu. Só o primeiro caso devolve linha.
    const ja = await pool.query(
      `SELECT codigo FROM convite_codigos WHERE discord_id = $1 AND marco = $2`,
      [String(padrinhoId), Number(marco)],
    );
    if (ja.rows.length) return { codigo: ja.rows[0].codigo, novo: false };
  }
  throw new Error('não foi possível sortear um código livre');
}

/**
 * O que UMA pessoa precisa ver quando clica em "Pegar meu código": os códigos dela que ainda
 * não foram resgatados, e quantos convidados válidos ela tem.
 *
 * Os já resgatados ficam de fora de propósito — mostrá-los seria oferecer de novo um código que
 * não serve mais, e a pessoa tentaria digitar.
 *
 * @returns `{ convidados, abertos: [{ codigo, marco }], resgatados }`
 */
export async function painelDoPadrinho(discordId) {
  const id = String(discordId);
  const { rows: [c] } = await pool.query(
    `SELECT count(*)::int AS n FROM convite_membros
      WHERE padrinho_id = $1 AND vale_ponto AND saiu_em IS NULL`,
    [id],
  );
  const { rows } = await pool.query(
    `SELECT codigo, marco, resgatado_em FROM convite_codigos
      WHERE discord_id = $1 ORDER BY marco`,
    [id],
  );
  return {
    convidados: Number(c?.n ?? 0),
    abertos: rows.filter((r) => !r.resgatado_em).map((r) => ({ codigo: r.codigo, marco: Number(r.marco) })),
    resgatados: rows.filter((r) => r.resgatado_em).length,
  };
}

/** Carimba que o privado saiu — para o bot reenviar o que ficou pelo caminho. */
export async function marcarEnviado(codigo) {
  await pool.query(
    `UPDATE convite_codigos SET enviado_em = now() WHERE codigo = $1 AND enviado_em IS NULL`,
    [String(codigo)],
  );
}

/** Códigos gerados e ainda não enviados no privado. O bot tenta de novo a cada varredura. */
export async function codigosPorEnviar(limite = 50) {
  const { rows } = await pool.query(
    `SELECT codigo, discord_id, marco, convidados FROM convite_codigos
      WHERE enviado_em IS NULL ORDER BY criado_em LIMIT $1`,
    [Math.max(1, Math.min(500, Number(limite) || 50))],
  );
  return rows.map((r) => ({
    codigo: r.codigo, discordId: r.discord_id, marco: Number(r.marco), convidados: Number(r.convidados),
  }));
}

// ------------------------------------------------------------------ o jogo resgata

/** O que `resgatar` pode devolver de errado. */
export class ErroConvite extends Error {
  constructor(chave) {
    super(chave);
    this.chave = chave;
  }
}

/**
 * RESGATA um código, numa transação só: carimba a linha e credita o diamante do marco.
 *
 * Devolve `{ marco, premios, saldoDiamantes }`. Lança `ErroConvite` com `'convite.invalido'`
 * (código não existe ou está malformado) ou `'convite.usado'` (alguém chegou antes).
 *
 * Note que `invalido` e `usado` são mensagens DIFERENTES de propósito. A alternativa — devolver
 * "inválido" nos dois casos — esconderia do jogador legítimo que o código dele já foi gasto, que
 * é justamente a informação que ele precisa para abrir um ticket. Não há o que proteger aqui:
 * quem tem o código na mão já sabe que ele existe, e quem não tem não descobre nada com isso
 * (dez caracteres em 32 letras é 2^50 — não se varre por tentativa).
 */
export async function resgatar({ codigo: bruto, playerId }) {
  const codigo = normalizarCodigo(bruto);
  if (!CODIGO_OK.test(codigo)) throw new ErroConvite('convite.invalido');
  const cli = await pool.connect();
  let aberta = false;
  try {
    await cli.query('BEGIN');
    aberta = true;
    // ESTE `WHERE` é a trava contra o resgate duplo. Ver o cabeçalho do arquivo.
    const { rows } = await cli.query(
      `UPDATE convite_codigos
          SET player_id = $2, resgatado_em = now()
        WHERE codigo = $1 AND resgatado_em IS NULL
        RETURNING marco, discord_id`,
      [codigo, Number(playerId)],
    );
    if (!rows.length) {
      // Nada mudou — desfaz e descobre por quê, fora da transação que não escreveu nada.
      await cli.query('ROLLBACK');
      aberta = false;
      const existe = await pool.query(`SELECT 1 FROM convite_codigos WHERE codigo = $1`, [codigo]);
      throw new ErroConvite(existe.rows.length ? 'convite.usado' : 'convite.invalido');
    }
    const marco = marcoDe(rows[0].marco);
    if (!marco) {
      // Um marco que saiu da tabela depois de o código ter sido gerado. Devolve o código para a
      // prateleira em vez de gastar um ticket por uma escada que mudou embaixo do jogador.
      await cli.query('ROLLBACK');
      aberta = false;
      throw new ErroConvite('convite.invalido');
    }
    const emDiamante = marco.premios
      .filter((p) => p.tipo === 'diamante')
      .reduce((s, p) => s + p.qtd, 0);
    let saldoDiamantes = null;
    if (emDiamante > 0) {
      saldoDiamantes = await movimentarNaTransacao(
        cli, Number(playerId), emDiamante, MOTIVO.CONVITE, codigo,
        `marco de ${marco.amigos} convidado(s) no Discord`,
      );
    }
    await cli.query('COMMIT');
    aberta = false;
    return { codigo, marco: marco.amigos, premios: marco.premios, saldoDiamantes };
  } catch (err) {
    if (aberta) await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}

/**
 * Os resgates deste jogador que ainda não tiveram a parte de JOGO entregue.
 *
 * Normalmente vazio: a entrega acontece no mesmo segundo do resgate. Enche quando o processo cai
 * entre o `COMMIT` do resgate e o flush do jogador — e é o login seguinte que esvazia.
 */
export async function pendentesDoJogador(playerId) {
  const { rows } = await pool.query(
    `SELECT codigo, marco FROM convite_codigos
      WHERE player_id = $1 AND resgatado_em IS NOT NULL AND entregue_em IS NULL
      ORDER BY resgatado_em`,
    [Number(playerId)],
  );
  return rows.map((r) => ({ codigo: r.codigo, marco: Number(r.marco) }));
}

/** Carimba que o prêmio de jogo entrou na conta e foi gravado. */
export async function marcarEntregue(codigo) {
  await pool.query(
    `UPDATE convite_codigos SET entregue_em = now()
      WHERE codigo = $1 AND resgatado_em IS NOT NULL AND entregue_em IS NULL`,
    [String(codigo)],
  );
}

/** O que a aba do jogo mostra sobre o histórico de resgates de uma conta. */
export async function resgatesDoJogador(playerId, limite = 20) {
  const { rows } = await pool.query(
    `SELECT codigo, marco, resgatado_em FROM convite_codigos
      WHERE player_id = $1 AND resgatado_em IS NOT NULL
      ORDER BY resgatado_em DESC LIMIT $2`,
    [Number(playerId), Math.max(1, Math.min(100, Number(limite) || 20))],
  );
  return rows.map((r) => ({
    codigo: r.codigo, marco: Number(r.marco), em: new Date(r.resgatado_em).getTime(),
  }));
}
