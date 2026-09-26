// Lista de amigos: grafo de amizade, pedidos pendentes, mensagens diretas (DM) e a caixa
// postal de coins para quem está offline ou noutro shard.
//
// A estrutura espelha `guild-db.mjs` (migração idempotente no boot, `comTransacao`, uma
// classe de erro com código). Três decisões que valem registrar:
//
//   · **Amizade é um par ordenado** (`a_id < b_id`, PRIMARY KEY nos dois) — uma linha por
//     amizade, sem "A é amigo de B" e "B é amigo de A" separados para dessincronizar.
//   · **DM tem retenção de 7 dias.** Nada de arquivar: `limparMensagensAntigas` apaga o que
//     passou do prazo, e as consultas de histórico já filtram por `criado_em` para não
//     mostrarem uma janela maior que a garantida enquanto o DELETE não roda.
//   · **Coins para amigo offline vão para uma caixa postal** (`amigo_coin_mailbox`), pelo
//     mesmo motivo do Mercado: creditar `players.gold` direto no banco seria desfeito pelo
//     `flushJogadores` do sim dono do destinatário. O valor guardado já é o LÍQUIDO (sem os
//     15%). Ver `recolherCoins` / `destinatariosComCoins`, gêmeos de `market-db.mjs`.
import { pool } from './db.mjs';

/** Teto de amigos por treinador e de pedidos pendentes recebidos. */
export const MAX_AMIGOS = 100;
export const MAX_PEDIDOS = 50;
/** Taxa cobrada na transferência de coins entre amigos — os 15% são QUEIMADOS (sink). */
export const TAXA_COINS_AMIGO = 0.15;
/** Menor transferência permitida: abaixo disso a taxa vira poeira de arredondamento. */
export const MIN_COINS_AMIGO = 1000;
/** Janela de persistência das DMs, em texto de `interval` do Postgres. */
const RETENCAO_DM = '7 days';
/** Teto de caracteres de uma DM (o sussurro é 200; a DM guarda, então damos mais). */
export const DM_MAX_LEN = 500;

export class ErroAmigo extends Error {
  constructor(codigo, msg) {
    super(msg);
    this.codigo = codigo;
  }
}

export async function migrar() {
  // Uma linha por amizade. `a_id < b_id` é invariante — garantido por quem insere
  // (`aceitarPedido`) e pelo CHECK, para uma corrida nunca gravar o par ao contrário.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS amizades (
      a_id      BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      b_id      BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (a_id, b_id),
      CHECK (a_id < b_id)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_amizades_b ON amizades(b_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS amizade_pedidos (
      id        BIGSERIAL PRIMARY KEY,
      de_id     BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      para_id   BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (de_id, para_id),
      CHECK (de_id <> para_id)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_amizade_pedidos_para ON amizade_pedidos(para_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dm_mensagens (
      id        BIGSERIAL PRIMARY KEY,
      de_id     BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      para_id   BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      texto     TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      lido_em   TIMESTAMPTZ
    )`);
  // `tipo`: 0 = mensagem de texto, 1 = nota de transferência de coins (linha de auditoria na
  // própria conversa). `valor` é o BRUTO enviado — o cliente recalcula taxa e líquido, que
  // são determinísticos. A nota NÃO conta como "não lida" (ver `listaDeAmigos`).
  await pool.query(`ALTER TABLE dm_mensagens ADD COLUMN IF NOT EXISTS tipo SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE dm_mensagens ADD COLUMN IF NOT EXISTS valor BIGINT`);
  // Histórico de uma conversa: os dois sentidos entram na mesma busca (ver `historicoDM`),
  // então o índice cobre `(de_id, para_id, criado_em)` e a consulta faz OR do par trocado.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_dm_conversa ON dm_mensagens(de_id, para_id, criado_em)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_dm_nao_lidas ON dm_mensagens(para_id) WHERE lido_em IS NULL`,
  );

  // Caixa postal de coins. `valor` é o LÍQUIDO (já sem os 15%). Só o destinatário recolhe,
  // e só quando o sim dono dele o tem em memória — igual a `market_pagamentos`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS amigo_coin_mailbox (
      id           BIGSERIAL PRIMARY KEY,
      para_id      BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      de_nick      TEXT NOT NULL,
      valor        BIGINT NOT NULL,
      criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
      recolhido_em TIMESTAMPTZ
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_amigo_coin_pendente ON amigo_coin_mailbox(para_id) WHERE recolhido_em IS NULL`,
  );
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

/** Ordena um par de ids para a forma canônica `(menor, maior)` de `amizades`. */
const parOrdenado = (x, y) =>
  Number(x) < Number(y) ? [Number(x), Number(y)] : [Number(y), Number(x)];

/** Dados de tela de um treinador pelo id — nick, nível e aparência para a linha da lista. */
export async function dadosBasicos(playerId) {
  const { rows } = await pool.query(
    `SELECT id, nick, level, looktype, visual FROM players WHERE id = $1`,
    [Number(playerId)],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    nick: r.nick,
    level: Number(r.level) || 1,
    looktype: Number(r.looktype) || 0,
    visual: typeof r.visual === 'string' ? JSON.parse(r.visual) : r.visual ?? {},
  };
}

/**
 * A lista de amigos de um jogador, com a contagem de DMs não lidas de cada um (só as dos
 * últimos 7 dias — a janela que o histórico garante).
 */
export async function listaDeAmigos(playerId) {
  const id = Number(playerId);
  const { rows } = await pool.query(
    `SELECT p.id, p.nick, p.level, p.looktype, p.visual,
            (SELECT count(*) FROM dm_mensagens d
              WHERE d.para_id = $1 AND d.de_id = p.id AND d.lido_em IS NULL AND d.tipo IN (0, 3)
                AND d.criado_em > now() - interval '${RETENCAO_DM}') AS nao_lidas
       FROM amizades a
       JOIN players p ON p.id = CASE WHEN a.a_id = $1 THEN a.b_id ELSE a.a_id END
      WHERE a.a_id = $1 OR a.b_id = $1
      ORDER BY lower(p.nick)`,
    [id],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    nick: r.nick,
    level: Number(r.level) || 1,
    looktype: Number(r.looktype) || 0,
    visual: typeof r.visual === 'string' ? JSON.parse(r.visual) : r.visual ?? {},
    naoLidas: Number(r.nao_lidas) || 0,
  }));
}

/** Pedidos de amizade que este jogador RECEBEU e ainda não respondeu. */
export async function pedidosPendentes(playerId) {
  const { rows } = await pool.query(
    `SELECT ap.id, ap.de_id, p.nick AS de_nick, p.level AS de_level, p.looktype AS de_looktype, ap.criado_em
       FROM amizade_pedidos ap
       JOIN players p ON p.id = ap.de_id
      WHERE ap.para_id = $1
      ORDER BY ap.criado_em DESC`,
    [Number(playerId)],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    deId: Number(r.de_id),
    deNick: r.de_nick,
    deLevel: Number(r.de_level) || 1,
    deLooktype: Number(r.de_looktype) || 0,
    criadoEm: r.criado_em,
  }));
}

/** Nicks para os quais este jogador MANDOU pedido — a tela mostra "aguardando". */
export async function pedidosEnviados(playerId) {
  const { rows } = await pool.query(
    `SELECT p.nick
       FROM amizade_pedidos ap JOIN players p ON p.id = ap.para_id
      WHERE ap.de_id = $1
      ORDER BY ap.criado_em DESC`,
    [Number(playerId)],
  );
  return rows.map((r) => r.nick);
}

export async function saoAmigos(aId, bId) {
  const [x, y] = parOrdenado(aId, bId);
  const { rowCount } = await pool.query(`SELECT 1 FROM amizades WHERE a_id = $1 AND b_id = $2`, [
    x,
    y,
  ]);
  return rowCount > 0;
}

async function checarTeto(q, playerId) {
  const { rows } = await q.query(
    `SELECT count(*)::int AS n FROM amizades WHERE a_id = $1 OR b_id = $1`,
    [Number(playerId)],
  );
  if (rows[0].n >= MAX_AMIGOS) throw new ErroAmigo('listaCheia', 'amigos.listaCheia');
}

/**
 * Cria um pedido de amizade de `deId` para o dono de `paraNick`.
 *
 * Se já existir o pedido INVERSO (o alvo já tinha pedido este jogador), isso não vira um
 * segundo pedido: a amizade é selada na hora e `jaAmigos` volta `true`.
 */
export async function criarPedido(deId, paraNick) {
  const de = Number(deId);
  return comTransacao(async (q) => {
    const { rows: alvo } = await q.query(
      `SELECT id, nick FROM players WHERE lower(nick) = lower($1)`,
      [String(paraNick ?? '').trim()],
    );
    if (!alvo.length) throw new ErroAmigo('naoEncontrado', 'amigos.naoEncontrado');
    const paraId = Number(alvo[0].id);
    if (paraId === de) throw new ErroAmigo('euMesmo', 'amigos.euMesmo');

    const [x, y] = parOrdenado(de, paraId);
    const { rows: ja } = await q.query(`SELECT 1 FROM amizades WHERE a_id = $1 AND b_id = $2`, [
      x,
      y,
    ]);
    if (ja.length) throw new ErroAmigo('jaSaoAmigos', 'amigos.jaSaoAmigos');

    // Pedido inverso pendente → sela a amizade agora.
    const { rows: inverso } = await q.query(
      `DELETE FROM amizade_pedidos WHERE de_id = $1 AND para_id = $2 RETURNING id`,
      [paraId, de],
    );
    if (inverso.length) {
      await q.query(`DELETE FROM amizade_pedidos WHERE de_id = $1 AND para_id = $2`, [de, paraId]);
      await checarTeto(q, de);
      await checarTeto(q, paraId);
      await q.query(`INSERT INTO amizades (a_id, b_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
        x,
        y,
      ]);
      return { paraId, paraNick: alvo[0].nick, jaAmigos: true };
    }

    const { rows: pend } = await q.query(
      `SELECT 1 FROM amizade_pedidos WHERE de_id = $1 AND para_id = $2`,
      [de, paraId],
    );
    if (pend.length) throw new ErroAmigo('pedidoDuplicado', 'amigos.pedidoDuplicado');

    await checarTeto(q, de);
    const { rows: nRecebidos } = await q.query(
      `SELECT count(*)::int AS n FROM amizade_pedidos WHERE para_id = $1`,
      [paraId],
    );
    if (nRecebidos[0].n >= MAX_PEDIDOS) throw new ErroAmigo('listaCheia', 'amigos.listaCheiaAlvo');

    await q.query(`INSERT INTO amizade_pedidos (de_id, para_id) VALUES ($1, $2)`, [de, paraId]);
    return { paraId, paraNick: alvo[0].nick, jaAmigos: false };
  });
}

export async function aceitarPedido(playerId, pedidoId) {
  const eu = Number(playerId);
  return comTransacao(async (q) => {
    const { rows: pRows } = await q.query(
      `SELECT ap.de_id, p.nick AS de_nick
         FROM amizade_pedidos ap JOIN players p ON p.id = ap.de_id
        WHERE ap.id = $1 AND ap.para_id = $2`,
      [Number(pedidoId), eu],
    );
    if (!pRows.length) throw new ErroAmigo('naoEncontrado', 'amigos.pedidoSumiu');
    const amigoId = Number(pRows[0].de_id);

    await checarTeto(q, eu);
    await checarTeto(q, amigoId);

    const [x, y] = parOrdenado(eu, amigoId);
    await q.query(`INSERT INTO amizades (a_id, b_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
      x,
      y,
    ]);
    // Apaga o pedido aceito E qualquer pedido no sentido inverso.
    await q.query(
      `DELETE FROM amizade_pedidos
        WHERE (de_id = $1 AND para_id = $2) OR (de_id = $2 AND para_id = $1)`,
      [eu, amigoId],
    );
    return { amigoId, amigoNick: pRows[0].de_nick };
  });
}

export async function recusarPedido(playerId, pedidoId) {
  const { rows } = await pool.query(
    `DELETE FROM amizade_pedidos WHERE id = $1 AND para_id = $2 RETURNING de_id`,
    [Number(pedidoId), Number(playerId)],
  );
  if (!rows.length) throw new ErroAmigo('naoEncontrado', 'amigos.pedidoSumiu');
  return { amigoId: Number(rows[0].de_id) };
}

/**
 * Desfaz a amizade. O histórico de DM NÃO é apagado — fica sob a retenção de 7 dias, e
 * re-adicionar o amigo reencontra a conversa onde parou.
 */
export async function removerAmigo(playerId, amigoId) {
  const [x, y] = parOrdenado(playerId, amigoId);
  const { rows } = await pool.query(
    `DELETE FROM amizades WHERE a_id = $1 AND b_id = $2 RETURNING a_id`,
    [x, y],
  );
  if (!rows.length) throw new ErroAmigo('naoEncontrado', 'amigos.naoEncontrado');
  const amigo = await dadosBasicos(amigoId);
  return { amigoNick: amigo?.nick ?? null };
}

/** Histórico de uma conversa: os dois sentidos, últimos `limite`, só dos últimos 7 dias. */
export async function historicoDM(aId, bId, limite = 200) {
  const a = Number(aId);
  const b = Number(bId);
  const { rows } = await pool.query(
    `SELECT id, de_id, para_id, texto, tipo, valor, criado_em
       FROM dm_mensagens
      WHERE ((de_id = $1 AND para_id = $2) OR (de_id = $2 AND para_id = $1))
        AND criado_em > now() - interval '${RETENCAO_DM}'
      ORDER BY criado_em DESC, id DESC
      LIMIT $3`,
    [a, b, Math.min(500, Math.max(1, limite))],
  );
  return rows
    .map((r) => ({
      id: Number(r.id),
      // `mine` = esta mensagem foi ENVIADA por quem está pedindo o histórico (o primeiro id).
      mine: Number(r.de_id) === a,
      texto: r.texto,
      tipo: Number(r.tipo) || 0,
      valor: r.valor == null ? null : Number(r.valor),
      ts: new Date(r.criado_em).getTime(),
    }))
    .reverse(); // cronológico para a tela
}

/**
 * Grava uma linha da conversa. `opts.tipo` 1 = nota de transferência de coins (`opts.valor`
 * é o BRUTO); qualquer outro valor = mensagem de texto normal.
 */
export async function gravarDM(deId, paraId, texto, { tipo = 0, valor = null } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO dm_mensagens (de_id, para_id, texto, tipo, valor) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, criado_em`,
    [
      Number(deId),
      Number(paraId),
      String(texto ?? '').slice(0, DM_MAX_LEN),
      Number(tipo) || 0,
      valor == null ? null : Math.floor(Number(valor)),
    ],
  );
  return { id: Number(rows[0].id), ts: new Date(rows[0].criado_em).getTime() };
}

/**
 * Reescreve a linha de um CONVITE de PvP amistoso (tipo 3) — é o que faz a bolha da conversa
 * passar de "pendente" para "aceito, Fulano venceu" (ou recusado, cancelado) e continuar assim
 * depois de recarregar a página. O `tipo = 3` no WHERE é a trava: nada além de um convite pode
 * ser reescrito por aqui.
 */
export async function atualizarConviteDM(dmId, texto) {
  await pool.query(
    `UPDATE dm_mensagens SET texto = $2 WHERE id = $1 AND tipo = 3`,
    [Number(dmId), String(texto ?? '').slice(0, DM_MAX_LEN)],
  );
}

/** Marca como lidas todas as DMs que `euId` recebeu de `amigoId`. */
export async function marcarLidas(euId, amigoId) {
  await pool.query(
    `UPDATE dm_mensagens SET lido_em = now()
      WHERE para_id = $1 AND de_id = $2 AND lido_em IS NULL`,
    [Number(euId), Number(amigoId)],
  );
}

export async function limparMensagensAntigas() {
  const { rowCount } = await pool.query(
    `DELETE FROM dm_mensagens WHERE criado_em < now() - interval '${RETENCAO_DM}'`,
  );
  return rowCount;
}

// ------------------------------------------------------------- caixa postal de coins

/** Enfileira coins (JÁ LÍQUIDOS) para um amigo que não está em memória neste shard. */
export async function enfileirarCoins(paraId, deNick, valorLiquido) {
  await pool.query(
    `INSERT INTO amigo_coin_mailbox (para_id, de_nick, valor) VALUES ($1, $2, $3)`,
    [Number(paraId), String(deNick).slice(0, 32), Math.floor(valorLiquido)],
  );
}

/**
 * Recolhe (numa transação, marcando antes de devolver) tudo que a caixa postal tem para
 * este jogador. Espelho de `market-db.recolherPagamentos`: se o processo morrer no meio, o
 * COMMIT não aconteceu e o pagamento continua pendente para a próxima.
 */
export function recolherCoins(playerId) {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `UPDATE amigo_coin_mailbox SET recolhido_em = now()
        WHERE id IN (
          SELECT id FROM amigo_coin_mailbox
           WHERE para_id = $1 AND recolhido_em IS NULL
           ORDER BY id FOR UPDATE SKIP LOCKED
        )
        RETURNING de_nick, valor`,
      [Number(playerId)],
    );
    const total = rows.reduce((s, r) => s + Number(r.valor), 0);
    return {
      total,
      recibos: rows.map((r) => ({ deNick: r.de_nick, valor: Number(r.valor) })),
    };
  });
}

/** Quais destes ids têm coins esperando — uma consulta para o shard inteiro. */
export async function destinatariosComCoins(ids) {
  if (!ids?.length) return new Set();
  const { rows } = await pool.query(
    `SELECT DISTINCT para_id FROM amigo_coin_mailbox
      WHERE recolhido_em IS NULL AND para_id = ANY($1::bigint[])`,
    [ids],
  );
  return new Set(rows.map((r) => Number(r.para_id)));
}
