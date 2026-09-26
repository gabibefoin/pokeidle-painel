// Persistência do Vote & Ganhe: um evento de voto por linha, crédito idempotente.
//
// ### A idempotência é do BANCO
//
// O TopIdle reenvia o webhook até receber 200, e a recuperação pela API (`GET /api/v1/votes`)
// entrega os mesmos eventos de novo se o cursor não tiver avançado. Os dois caminhos passam
// por `registrarVoto`, e quem decide se aquilo já foi processado é a PRIMARY KEY de
// `topidle_votos`: o segundo `INSERT` do mesmo `event_id` não encontra espaço, `rowCount` volta
// zero, e nada é creditado. Conferir antes em JavaScript não fecharia a janela entre dois
// gateways processando o mesmo evento no mesmo instante.
//
// ### Nenhum voto é jogado fora
//
// Voto sem dono, além do teto, de conta demais — todos entram, com `conta = false` e o motivo
// gravado ao lado. Continuam ocupando o `event_id` (que é o que impede o reprocessamento) e
// ficam de prova: sem eles, "esse cara está com vinte contas votando nele" seria uma suspeita
// sem nenhum lugar onde conferir.
import { createHmac, randomBytes } from 'node:crypto';
import { pool } from './db.mjs';
import { MOTIVO } from './game/diamantes.mjs';
import {
  DIAMANTES_POR_PAR, MAX_VOTANTES_POR_JOGADOR, RECARGA_MS,
  VOTOS_POR_DIAMANTE, diaUtc, proximoVotoEm,
} from './game/topidle.mjs';

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS topidle_votos (
      event_id       TEXT PRIMARY KEY,           -- a chave DELES; é ela que impede o duplo crédito
      player_id      BIGINT REFERENCES players(id) ON DELETE CASCADE,
      identificador  TEXT,                       -- o nick que veio no evento
      email          TEXT,                       -- o e-mail Google, quando veio
      votante_hash   TEXT,                       -- QUEM votou, do lado do TopIdle (ver abaixo)
      dia            DATE   NOT NULL,            -- recorte UTC do teto diário
      conta          BOOLEAN NOT NULL DEFAULT false, -- entrou na soma que fecha o diamante?
      proximo_em     TIMESTAMPTZ,                -- só nos que contaram: quando o próximo pode contar
      qtd            BIGINT NOT NULL DEFAULT 0,  -- > 0 só no voto que FECHOU o par
      motivo_zero    TEXT,                       -- por que não contou (NULL = contou)
      entregue       BOOLEAN NOT NULL DEFAULT false,
      votado_em      TIMESTAMPTZ NOT NULL,
      criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // Bancos que já subiram a versão que pagava por voto: as colunas entram sem tocar nas linhas
  // antigas, e `conta` nasce refletindo o que aquelas linhas já eram (pagou = contou).
  await pool.query(`ALTER TABLE topidle_votos ADD COLUMN IF NOT EXISTS votante_hash TEXT`);
  await pool.query(`ALTER TABLE topidle_votos ADD COLUMN IF NOT EXISTS conta BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`UPDATE topidle_votos SET conta = true WHERE qtd > 0 AND conta = false`);
  // A recarga por jogador. Bancos que já tinham votos contados ganham a data a partir do
  // próprio `votado_em` — assim quem votou ontem já entra sob a regra nova, sem carência.
  await pool.query(`ALTER TABLE topidle_votos ADD COLUMN IF NOT EXISTS proximo_em TIMESTAMPTZ`);
  await pool.query(
    `UPDATE topidle_votos SET proximo_em = votado_em + ($1::bigint * INTERVAL '1 millisecond')
      WHERE conta AND proximo_em IS NULL`,
    [RECARGA_MS],
  );
  // O índice da pergunta que toda chegada de voto faz: "qual a maior recarga deste jogador?"
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_topidle_recarga ON topidle_votos(player_id, proximo_em DESC)
      WHERE conta`,
  );

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_topidle_dia ON topidle_votos(player_id, dia)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_topidle_conta ON topidle_votos(player_id) WHERE conta`);
  // A caixa postal. Parcial pelo mesmo motivo da dos diamantes: a varredura só pergunta pelos
  // não entregues, e essa é a minoria eterna da tabela.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_topidle_caixa ON topidle_votos(player_id)
     WHERE qtd > 0 AND entregue = false`);

  // O VÍNCULO: uma conta do TopIdle pertence a um jogador, e só a ele, para sempre.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS topidle_votantes (
      votante_hash  TEXT PRIMARY KEY,
      player_id     BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      votos         BIGINT NOT NULL DEFAULT 0,
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_topidle_votante_player ON topidle_votantes(player_id)`);

  // Estado de uma linha só: o cursor da recuperação e o sal do hash do votante.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS topidle_cursor (
      id      INT PRIMARY KEY,
      cursor  TEXT,
      em      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`ALTER TABLE topidle_cursor ADD COLUMN IF NOT EXISTS sal TEXT`);
  await pool.query(`INSERT INTO topidle_cursor (id, cursor) VALUES (1, '0') ON CONFLICT (id) DO NOTHING`);
  // O sal nasce UMA vez e fica no banco, não no ambiente. Se ele viesse de `AUTH_SEGREDO`,
  // girar aquele segredo (coisa que se faz por outros motivos) apagaria em silêncio todos os
  // vínculos de votante — a defesa contra multi-conta sumiria sem ninguém perceber.
  await pool.query(
    `UPDATE topidle_cursor SET sal = $1 WHERE id = 1 AND (sal IS NULL OR sal = '')`,
    [randomBytes(32).toString('hex')],
  );
}

/**
 * O identificador do votante, hasheado.
 *
 * Guardar e-mail de terceiro em claro num banco de jogo não se justifica: o que a regra precisa
 * é comparar "é a mesma conta de antes?", e para isso o hash basta. O sal sai do banco (ver a
 * migração) e é o que impede que alguém com a tabela na mão descubra os e-mails testando
 * endereços conhecidos contra um SHA-256 pelado.
 */
async function hashVotante(cli, votante) {
  if (!votante) return null;
  const { rows } = await cli.query(`SELECT sal FROM topidle_cursor WHERE id = 1`);
  const sal = rows[0]?.sal ?? '';
  return createHmac('sha256', sal).update(String(votante)).digest('hex');
}

async function comTransacao(fn) {
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    const r = await fn(cli);
    await cli.query('COMMIT');
    return r;
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}

/**
 * De quem é este voto.
 *
 * Primeiro pelo nick, que é o que o nosso link de voto preenche. Só depois pelo e-mail Google,
 * e aí exigindo que a conta daqui SEJA uma conta Google com aquele e-mail — casar por e-mail
 * uma conta local que por acaso cadastrou o mesmo endereço entregaria o diamante ao dono
 * errado do jeito mais silencioso possível.
 */
async function donoDoVoto(cli, { identificador, email }) {
  if (identificador) {
    const { rows } = await cli.query(
      `SELECT id FROM players WHERE lower(nick) = lower($1)`,
      [identificador],
    );
    if (rows[0]) return Number(rows[0].id);
  }
  if (email) {
    const { rows } = await cli.query(
      `SELECT p.id FROM accounts a
         JOIN players p ON lower(p.nick) = lower(a.nick)
        WHERE a.provedor = 'google' AND lower(a.email) = lower($1)`,
      [email],
    );
    if (rows[0]) return Number(rows[0].id);
  }
  return null;
}

/**
 * O vínculo conta-do-TopIdle ↔ jogador, decidido na primeira vez que cada lado aparece.
 *
 * Devolve `null` quando pode contar, ou o motivo pelo qual não pode. Roda dentro da transação
 * e depois do `FOR UPDATE` no jogador — sem isso, dez votos chegando juntos de dez contas
 * novas leriam todos "ainda tenho zero votantes" e passariam juntos.
 */
async function conferirVotante(cli, playerId, votanteHash) {
  if (!votanteHash) return null; // sem identidade no evento: só o teto diário protege

  const { rows: ja } = await cli.query(
    `SELECT player_id FROM topidle_votantes WHERE votante_hash = $1`,
    [votanteHash],
  );
  if (ja[0]) {
    // Conta conhecida: só vale para o jogador em que ela votou da primeira vez. É o que
    // impede vender voto — e também impede encher a cota diária de um rival.
    return Number(ja[0].player_id) === playerId ? null : 'votante_de_outro';
  }

  const { rows: quantos } = await cli.query(
    `SELECT count(*)::int AS n FROM topidle_votantes WHERE player_id = $1`,
    [playerId],
  );
  if (quantos[0].n >= MAX_VOTANTES_POR_JOGADOR) return 'muitos_votantes';

  await cli.query(
    `INSERT INTO topidle_votantes (votante_hash, player_id) VALUES ($1,$2)
     ON CONFLICT (votante_hash) DO NOTHING`,
    [votanteHash, playerId],
  );
  return null;
}

/** Move o diamante e grava o ledger, dentro da transação já aberta. */
async function creditar(cli, playerId, qtd, ref, nota) {
  const { rows } = await cli.query(
    `UPDATE players SET diamonds = diamonds + $2 WHERE id = $1 RETURNING diamonds`,
    [playerId, qtd],
  );
  if (!rows.length) throw new Error('jogador sumiu no meio do crédito do voto');
  const saldo = Number(rows[0].diamonds);
  await cli.query(
    `INSERT INTO diamante_ledger (player_id, delta, saldo_apos, motivo, ref, nota)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [playerId, qtd, saldo, MOTIVO.VOTO, ref, nota],
  );
  return saldo;
}

/**
 * Processa UM evento de voto. Seguro de chamar quantas vezes for.
 *
 * Devolve `{ novo, contou, creditado, qtd, playerId, motivoZero, contados }`. `novo: false`
 * quer dizer que este `event_id` já tinha passado por aqui — o caso normal do reenvio, e nada
 * aconteceu. `contou` sem `creditado` é o primeiro voto do par: correto e esperado.
 */
export function registrarVoto({ eventId, identificador, email, votante, votadoEm }) {
  return comTransacao(async (cli) => {
    const playerId = await donoDoVoto(cli, { identificador, email });

    // A trava por jogador. Sem ela, dois eventos chegando juntos leem a mesma recarga e ambos
    // passam — que é EXATAMENTE o caso reproduzido em produção: duas contas do TopIdle votando
    // no mesmo nick com segundos de diferença. É este `FOR UPDATE` que os põe em fila.
    if (playerId) await cli.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);

    const votanteHash = await hashVotante(cli, votante);
    const dia = diaUtc(votadoEm?.getTime?.() ?? Date.now());

    let conta = false;
    let motivoZero = 'sem_dono';
    let proximoEm = null;

    if (playerId) {
      motivoZero = await conferirVotante(cli, playerId, votanteHash);
      if (!motivoZero) {
        // A RECARGA. `proximo_em` foi gravado pelo último voto que contou; enquanto o voto que
        // chega for anterior a essa data, ele entra gravado e não soma.
        //
        // A comparação é com `votado_em` do próprio evento, e não com `now()`: o que a regra
        // pergunta é se os DOIS VOTOS estão a 24 h um do outro, e é isso que continua valendo
        // quando um evento chega atrasado pela recuperação da API, horas depois de acontecer.
        const { rows } = await cli.query(
          `SELECT max(proximo_em) AS ate FROM topidle_votos WHERE player_id = $1 AND conta`,
          [playerId],
        );
        const ate = rows[0].ate;
        if (ate && votadoEm < ate) motivoZero = 'recarga';
        else {
          conta = true;
          proximoEm = proximoVotoEm(votadoEm);
        }
      }
    }
    // Marcado, mas ainda conta: sem identidade no evento não dá para aplicar o vínculo, e
    // recusar todo mundo por isso deixaria o Vote & Ganhe sem pagar ninguém.
    if (conta && !votanteHash) motivoZero = 'sem_votante';

    const ins = await cli.query(
      `INSERT INTO topidle_votos
         (event_id, player_id, identificador, email, votante_hash, dia, conta, proximo_em,
          motivo_zero, votado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, playerId, identificador || null, email || null, votanteHash,
        dia, conta, proximoEm, motivoZero, votadoEm],
    );
    if (!ins.rowCount) return { novo: false, contou: false, creditado: false, qtd: 0, playerId };

    if (!conta) return { novo: true, contou: false, creditado: false, qtd: 0, playerId, motivoZero };


    await cli.query(
      `UPDATE topidle_votantes SET votos = votos + 1 WHERE votante_hash = $1`,
      [votanteHash],
    );

    // O par. A soma é de TODO o histórico, não do dia: um voto hoje e outro amanhã fecham o
    // diamante — quem vota uma vez por dia não fica preso num par que nunca completa.
    const { rows: soma } = await cli.query(
      `SELECT count(*)::int AS n FROM topidle_votos WHERE player_id = $1 AND conta`,
      [playerId],
    );
    const contados = soma[0].n;
    // `motivoZero` viaja junto mesmo quando o voto CONTOU: é como o `sem_votante` chega a
    // quem chama, e é ele que faz o log gritar que o vínculo de conta está cego.
    if (contados % VOTOS_POR_DIAMANTE !== 0) {
      return { novo: true, contou: true, creditado: false, qtd: 0, playerId, motivoZero, contados };
    }

    await cli.query(`UPDATE topidle_votos SET qtd = $2 WHERE event_id = $1`, [eventId, DIAMANTES_POR_PAR]);
    await creditar(
      cli, playerId, DIAMANTES_POR_PAR, eventId,
      `${VOTOS_POR_DIAMANTE} votos TopIdle · ${identificador || email}`,
    );
    return {
      novo: true, contou: true, creditado: true,
      qtd: DIAMANTES_POR_PAR, playerId, motivoZero, contados,
    };
  });
}

// ------------------------------------------------------------------ caixa postal

/** Quais destes jogadores têm voto creditado que a sessão em memória ainda não sabe. */
export async function jogadoresComVotoPendente(playerIds) {
  if (!playerIds.length) return new Set();
  const { rows } = await pool.query(
    `SELECT DISTINCT player_id FROM topidle_votos
      WHERE qtd > 0 AND entregue = false AND player_id = ANY($1::bigint[])`,
    [playerIds],
  );
  return new Set(rows.map((r) => Number(r.player_id)));
}

/**
 * Marca os créditos como entregues e devolve o saldo para a sessão em memória copiar.
 *
 * Aqui NÃO se soma nada: o crédito já aconteceu na transação de `registrarVoto`. O que falta é
 * o `sim` dono do jogador saber — somar de novo pagaria o voto duas vezes.
 */
export async function recolherVotos(playerId) {
  const { rows } = await pool.query(
    `UPDATE topidle_votos SET entregue = true
      WHERE player_id = $1 AND qtd > 0 AND entregue = false
      RETURNING qtd`,
    [playerId],
  );
  if (!rows.length) return { votos: 0, qtd: 0 };
  const { rows: saldo } = await pool.query(`SELECT diamonds FROM players WHERE id = $1`, [playerId]);
  return {
    votos: rows.length,
    qtd: rows.reduce((s, r) => s + Number(r.qtd), 0),
    diamonds: Number(saldo[0]?.diamonds ?? 0),
  };
}

// ----------------------------------------------------------------- painel

/** O que a tela do Vote & Ganhe mostra. */
export async function painelDe(playerId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM topidle_votos
         WHERE player_id = $1 AND conta)                                    AS contados,
       (SELECT count(*)::int FROM topidle_votos WHERE player_id = $1)       AS votos,
       (SELECT coalesce(sum(qtd),0)::bigint FROM topidle_votos
         WHERE player_id = $1)                                              AS diamantes,
       (SELECT max(votado_em) FROM topidle_votos
         WHERE player_id = $1 AND conta)                                    AS ultimo,
       (SELECT max(proximo_em) FROM topidle_votos
         WHERE player_id = $1 AND conta)                                    AS libera_em`,
    [playerId],
  );
  const r = rows[0] ?? {};
  const contados = r.contados ?? 0;
  // A espera sai da MESMA data que o servidor cobra na chegada do voto. Antes ela era
  // recalculada aqui a partir do último voto, e bastava as duas contas divergirem por um
  // detalhe para a tela liberar o botão numa hora em que o servidor ainda recusaria.
  const liberaMs = r.libera_em ? new Date(r.libera_em).getTime() : 0;
  return {
    votos: r.votos ?? 0,
    contados,
    diamantes: Number(r.diamantes ?? 0),
    votosPorDiamante: VOTOS_POR_DIAMANTE,
    porPar: DIAMANTES_POR_PAR,
    // Quanto falta para o próximo diamante. É o número que a barra da tela desenha.
    noPar: contados % VOTOS_POR_DIAMANTE,
    ultimoVotoEm: r.ultimo ? new Date(r.ultimo).getTime() : null,
    liberaEm: liberaMs || null,
    esperaMs: liberaMs ? Math.max(0, liberaMs - Date.now()) : 0,
    recargaMs: RECARGA_MS,
  };
}

// -------------------------------------------------------------- auditoria

/**
 * Os jogadores com mais contas do TopIdle votando neles do que o limite permite.
 *
 * Em operação normal a lista é curta ou vazia. Uma linha aqui não é prova de fraude — pode ser
 * gente da mesma casa — mas é o primeiro lugar a olhar quando o ranking do TopIdle parecer
 * estranho, e é a única visão que existe do assunto.
 */
export async function suspeitosDeMultiConta(limite = 50) {
  const { rows } = await pool.query(
    `SELECT p.nick,
            count(DISTINCT v.votante_hash)::int AS votantes,
            count(*)::int                       AS recusados
       FROM topidle_votos v
       JOIN players p ON p.id = v.player_id
      WHERE v.motivo_zero IN ('muitos_votantes', 'votante_de_outro')
      GROUP BY p.nick
      ORDER BY recusados DESC
      LIMIT $1`,
    [limite],
  );
  return rows.map((r) => ({ nick: r.nick, votantes: r.votantes, recusados: r.recusados }));
}

// ----------------------------------------------------------------- cursor

export async function lerCursor() {
  const { rows } = await pool.query(`SELECT cursor FROM topidle_cursor WHERE id = 1`);
  return rows[0]?.cursor ?? '0';
}

export async function gravarCursor(cursor) {
  await pool.query(
    `INSERT INTO topidle_cursor (id, cursor, em) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET cursor = EXCLUDED.cursor, em = now()`,
    [String(cursor)],
  );
}
