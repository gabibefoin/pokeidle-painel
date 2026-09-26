// Persistência das ORBs. É a única parte do jogo que fala com o banco de forma SÍNCRONA.
//
// ### Por que aqui não vale o write-behind
//
// Todo o resto do jogo grava em lote a cada 5 s e aceita perder 5 segundos num crash — para
// XP e loot isso é irrelevante. Aqui NÃO É: 5 segundos de perda são dinheiro real
// desaparecendo ou aparecendo. Cada movimento de ORB é uma transação que ou fecha inteira ou
// não acontece, e o jogador espera a resposta.
//
// ### O ledger é a verdade, `players.orbs` é cache
//
// Todo movimento insere uma linha em `orb_ledger` e atualiza `players.orbs` **na mesma
// transação**. A tabela nunca é atualizada nem apagada — só cresce. Isso dá três coisas:
// auditoria (somar a tabela tem de bater com a carteira on-chain), reconstrução (o saldo de
// qualquer jogador sai de um `SUM`) e detecção (divergência entre soma e cache é sinal de bug,
// e `conferirSaldo` existe para procurá-la).
//
// ### Idempotência
//
// Depósito é identificado pelo HASH DA TRANSAÇÃO, com `UNIQUE`. O watcher da blockchain pode
// reprocessar o mesmo bloco quantas vezes quiser — na segunda o `INSERT` viola a constraint,
// o crédito não acontece e ninguém recebe ORB em dobro.
import { pool } from './db.mjs';
import { MOTIVO, MOTIVOS_QUE_EMITEM, SAQUE, novoIdSaque, arredondar6 } from './game/orbs.mjs';
import { MAX_PAGINA_GLOBAL } from './market-db.mjs';

export async function migrar() {
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS orbs BIGINT NOT NULL DEFAULT 0`);

  // Toda movimentação de ORB, uma linha. Append-only: nada de UPDATE nem DELETE aqui.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orb_ledger (
      id          BIGSERIAL PRIMARY KEY,
      player_id   BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      delta       BIGINT NOT NULL,          -- + entrou, − saiu (nunca 0)
      saldo_apos  BIGINT NOT NULL,          -- o saldo DEPOIS deste movimento
      motivo      TEXT   NOT NULL,
      ref         TEXT,                     -- id do saque, hash do depósito, id do anúncio…
      nota        TEXT,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ledger_player ON orb_ledger(player_id, id DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ledger_motivo ON orb_ledger(motivo)`);

  // Depósitos vistos na blockchain. O hash é UNIQUE — é ele que torna o crédito idempotente.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orb_depositos (
      id          BIGSERIAL PRIMARY KEY,
      player_id   BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      rede        TEXT   NOT NULL,
      tx_hash     TEXT   NOT NULL,
      de_endereco TEXT,
      usdt        NUMERIC(20,6) NOT NULL,
      orbs        BIGINT NOT NULL,
      referencia  TEXT,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (rede, tx_hash)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orb_dep_global ON orb_depositos(criado_em DESC, id DESC)`);

  // Saques. `tx_hash` é gravado ANTES do broadcast (ver `marcarEnviando`) — sem isso, um
  // processo que morre no meio do envio perde a única pista de que a transação existiu.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orb_saques (
      id            TEXT PRIMARY KEY,
      player_id     BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      orbs          BIGINT NOT NULL,
      usdt          NUMERIC(20,6) NOT NULL,
      rede          TEXT   NOT NULL,
      endereco      TEXT   NOT NULL,
      status        TEXT   NOT NULL,
      tx_hash       TEXT,
      erro          TEXT,
      tentativas    INT    NOT NULL DEFAULT 0,
      tentado_em    BIGINT NOT NULL DEFAULT 0,   -- ms; base do delay de reenvio
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
      concluido_em  TIMESTAMPTZ
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_saques_player ON orb_saques(player_id, criado_em DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_saques_global ON orb_saques(criado_em DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_saques_status ON orb_saques(status)`);
  await pool.query(`ALTER TABLE orb_saques ADD COLUMN IF NOT EXISTS aprovado_por TEXT`);
  await pool.query(`ALTER TABLE orb_saques ADD COLUMN IF NOT EXISTS aprovado_em TIMESTAMPTZ`);

  // Endereço de depósito por jogador (referência do memo). Um por jogador, estável.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orb_referencias (
      player_id   BIGINT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      referencia  TEXT NOT NULL UNIQUE,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

/**
 * Move ORBs de um jogador, dentro de uma transação já aberta.
 *
 * Não é exportada: mover ORB sem transação é justamente o erro que este arquivo existe para
 * impedir. Quem precisa mover usa as funções públicas abaixo, que abrem a transação.
 *
 * O `UPDATE ... RETURNING orbs` faz o trabalho pesado: ele trava a linha do jogador e devolve
 * o saldo novo em uma ida ao banco. A checagem `>= 0` fica no `WHERE` — se o saldo não der,
 * nenhuma linha volta e a transação inteira é abortada, em vez de o saldo virar negativo.
 */
async function movimentar(cli, playerId, delta, motivo, ref = null, nota = null) {
  if (!Number.isInteger(delta) || delta === 0) throw new Error('delta de ORB tem de ser inteiro e não-zero');

  const { rows } = await cli.query(
    `UPDATE players SET orbs = orbs + $2
      WHERE id = $1 AND orbs + $2 >= 0
      RETURNING orbs`,
    [playerId, delta],
  );
  if (!rows.length) throw new Error('saldo de Gemas insuficiente');

  const saldo = Number(rows[0].orbs);
  await cli.query(
    `INSERT INTO orb_ledger (player_id, delta, saldo_apos, motivo, ref, nota)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [playerId, delta, saldo, motivo, ref, nota],
  );
  return saldo;
}

/**
 * O mesmo `movimentar`, para quem já tem uma transação aberta e precisa mover gema DENTRO
 * dela — igual ao gêmeo de `diamantes-db.mjs`, e pela mesma razão.
 *
 * A regra do arquivo continua de pé (mover a moeda fora de uma transação é o erro que ele
 * existe para impedir), e é por isso que o `cli` é obrigatório: quem chama tem de estar num
 * `BEGIN`, e a assinatura diz isso.
 *
 * Nasceu para a faxina de multi-conta do painel, em que BANIR a conta fraca e devolver a gema
 * dela para a conta principal têm de acontecer juntos ou não acontecer — em duas transações,
 * um processo que caísse no meio deixaria uma conta banida com a gema presa lá dentro.
 */
export { movimentar as movimentarNaTransacao };

/** Roda `fn` numa transação, com COMMIT/ROLLBACK garantidos. */
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

export const saldoDe = async (playerId) => {
  const { rows } = await pool.query(`SELECT orbs FROM players WHERE id = $1`, [playerId]);
  return Number(rows[0]?.orbs ?? 0);
};

// ------------------------------------------------------------------ depósito

/**
 * Credita um depósito visto na blockchain.
 *
 * IDEMPOTENTE pelo par (rede, tx_hash). O watcher pode reprocessar o mesmo bloco à vontade:
 * na segunda vez o `ON CONFLICT DO NOTHING` não insere nada, `rowCount` é 0, e o crédito é
 * pulado. Sem isso, uma reorg ou um restart do watcher pagariam o jogador duas vezes.
 *
 * @returns {{creditado:boolean, saldo?:number}}
 */
export function creditarDeposito({ playerId, rede, txHash, deEndereco, usdt, orbs, referencia }) {
  return comTransacao(async (cli) => {
    const ins = await cli.query(
      `INSERT INTO orb_depositos (player_id, rede, tx_hash, de_endereco, usdt, orbs, referencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (rede, tx_hash) DO NOTHING`,
      [playerId, rede, txHash, deEndereco ?? null, arredondar6(usdt), orbs, referencia ?? null],
    );
    // Já processado numa passagem anterior: não credita de novo.
    if (!ins.rowCount) return { creditado: false };

    const saldo = await movimentar(cli, playerId, orbs, MOTIVO.COMPRA, txHash, `${usdt} USDT via ${rede}`);
    return { creditado: true, saldo };
  });
}

// -------------------------------------------------------------------- saque

/**
 * Cria o pedido de saque e DEBITA as ORBs na mesma transação.
 *
 * Debitar agora, e não na hora do envio, é o que fecha a janela de saque duplo: dois pedidos
 * do mesmo saldo não podem existir, porque o segundo encontra o saldo já reduzido.
 */
export function pedirSaque({ playerId, orbs, usdt, rede, endereco }) {
  const id = novoIdSaque();
  return comTransacao(async (cli) => {
    const saldo = await movimentar(cli, playerId, -orbs, MOTIVO.SAQUE, id, `${usdt} USDT para ${endereco}`);
    await cli.query(
      `INSERT INTO orb_saques (id, player_id, orbs, usdt, rede, endereco, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, playerId, orbs, arredondar6(usdt), rede, endereco, SAQUE.AGUARDANDO],
    );
    return { id, saldo };
  });
}

export async function saquePorId(id) {
  const { rows } = await pool.query(`SELECT * FROM orb_saques WHERE id = $1`, [id]);
  return rows[0] ? deLinha(rows[0]) : null;
}

export async function saquesDoJogador(playerId, limite = 20) {
  const { rows } = await pool.query(
    `SELECT * FROM orb_saques WHERE player_id = $1 ORDER BY criado_em DESC LIMIT $2`,
    [playerId, limite],
  );
  return rows.map(deLinha);
}

/** Saques que o worker precisa processar: os novos e os que já podem ser retentados. */
export async function saquesParaProcessar(agora, delayMs, limite = 20) {
  const { rows } = await pool.query(
    `SELECT * FROM orb_saques
      WHERE status = $1
         OR (status = $2 AND tentado_em + $3 <= $4)
      ORDER BY criado_em
      LIMIT $5`,
    [SAQUE.PENDENTE, SAQUE.FALHOU, delayMs, agora, limite],
  );
  return rows.map(deLinha);
}

/** Saques já broadcastados — o worker fecha quando a tx confirma on-chain. */
export async function saquesEnviando(limite = 100) {
  const { rows } = await pool.query(
    `SELECT * FROM orb_saques
      WHERE status = $1 AND tx_hash IS NOT NULL
      ORDER BY tentado_em
      LIMIT $2`,
    [SAQUE.ENVIANDO, limite],
  );
  return rows.map(deLinha);
}

const deLinha = (r) => ({
  id: r.id,
  playerId: Number(r.player_id),
  orbs: Number(r.orbs),
  usdt: Number(r.usdt),
  rede: r.rede,
  endereco: r.endereco,
  status: r.status,
  txHash: r.tx_hash,
  erro: r.erro,
  tentativas: r.tentativas,
  tentadoEm: Number(r.tentado_em),
  criadoEm: r.criado_em,
  concluidoEm: r.concluido_em,
});

/**
 * Marca o saque como ENVIANDO e grava o hash **antes** do broadcast.
 *
 * Esta ordem é a peça central da segurança contra pagamento em dobro. Se o processo morrer
 * entre esta escrita e a resposta da rede, o hash está no banco e a próxima passagem
 * consegue perguntar à blockchain se aquela transação caiu. Gravar o hash DEPOIS do envio
 * deixaria um buraco em que o dinheiro saiu e não há registro de para onde.
 *
 * A transição só vale saindo de PENDENTE ou FALHOU: um saque já em ENVIANDO pode estar no
 * ar neste instante, e mexer nele é exatamente o que não pode acontecer.
 */
export async function marcarEnviando(id, txHash, agora) {
  const { rowCount } = await pool.query(
    `UPDATE orb_saques
        SET status = $2, tx_hash = $3, tentativas = tentativas + 1, tentado_em = $4, erro = NULL
      WHERE id = $1 AND status IN ($5, $6)`,
    [id, SAQUE.ENVIANDO, txHash, agora, SAQUE.PENDENTE, SAQUE.FALHOU],
  );
  return rowCount > 0;
}

export async function marcarConfirmado(id, txHash) {
  const { rowCount } = await pool.query(
    `UPDATE orb_saques SET status = $2, tx_hash = COALESCE($3, tx_hash), concluido_em = now(), erro = NULL
      WHERE id = $1 AND status <> $2`,
    [id, SAQUE.CONFIRMADO, txHash ?? null],
  );
  return rowCount > 0;
}

export async function marcarFalhou(id, erro, agora) {
  await pool.query(
    `UPDATE orb_saques SET status = $2, erro = $3, tentado_em = $4 WHERE id = $1`,
    [id, SAQUE.FALHOU, String(erro).slice(0, 500), agora],
  );
}

/**
 * Cancela um saque e DEVOLVE as ORBs.
 *
 * Só de `AGUARDANDO`, `PENDENTE` ou `FALHOU`, e a transição de status acontece na mesma transação do
 * crédito: sem isso, dois cancelamentos simultâneos creditariam o jogador duas vezes.
 */
export function cancelarSaque(id, nota = 'cancelado') {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `UPDATE orb_saques SET status = $2, concluido_em = now()
        WHERE id = $1 AND status IN ($3, $4, $5)
        RETURNING player_id, orbs`,
      [id, SAQUE.CANCELADO, SAQUE.AGUARDANDO, SAQUE.PENDENTE, SAQUE.FALHOU],
    );
    if (!rows.length) return { ok: false };
    const saldo = await movimentar(
      cli,
      Number(rows[0].player_id),
      Number(rows[0].orbs),
      MOTIVO.SAQUE_ESTORNO,
      id,
      nota,
    );
    return { ok: true, saldo, playerId: Number(rows[0].player_id) };
  });
}

// ---------------------------------------------------------------- loja VIP

/**
 * Debita a compra de um produto da loja.
 *
 * A trava contra saldo negativo é o `WHERE orbs + delta >= 0` dentro de `movimentar`: dois
 * cliques no mesmo produto, ou duas abas comprando ao mesmo tempo, e o segundo encontra a
 * linha já reduzida e falha. Uma checagem em JavaScript antes do UPDATE não fecha essa
 * janela — a checagem e a escrita têm de ser a mesma operação.
 *
 * Isto QUEIMA ORB (o total em circulação cai), e é de propósito: gastar na loja é o outro
 * caminho de saída da moeda além do saque, e ele reduz o passivo em USDT do projeto.
 */
export function gastarNaLoja({ playerId, orbs, produtoId, nome }) {
  return comTransacao(async (cli) => {
    const saldo = await movimentar(cli, playerId, -orbs, MOTIVO.LOJA, produtoId, nome ?? null);
    return { saldo };
  });
}

/** Devolve o que foi gasto — usado quando o efeito falha DEPOIS do débito. */
export function estornarCompra({ playerId, orbs, produtoId, nota }) {
  return comTransacao(async (cli) => {
    const saldo = await movimentar(cli, playerId, orbs, MOTIVO.LOJA_ESTORNO, produtoId, nota ?? null);
    return { saldo };
  });
}

// ------------------------------------------------------------- transferência

/**
 * Move ORBs de um jogador para outro (venda no Community Market).
 *
 * Uma transação, duas linhas de ledger. NÃO emite nem queima: a soma dos dois deltas é zero,
 * que é o invariante que mantém o caixa solvente.
 */
export function transferir({ deId, paraId, orbs, ref, nota }) {
  if (deId === paraId) throw new Error('origem e destino iguais');
  return comTransacao(async (cli) => {
    // Sempre na mesma ordem de id: dois pares transferindo entre si ao mesmo tempo em ordens
    // opostas travariam um ao outro (deadlock clássico de duas linhas).
    const [primeiro, segundo] = deId < paraId ? [deId, paraId] : [paraId, deId];
    const deltas = { [deId]: -orbs, [paraId]: orbs };
    const motivos = { [deId]: MOTIVO.MARKET_COMPRA, [paraId]: MOTIVO.MARKET_VENDA };
    const saldos = {};
    for (const id of [primeiro, segundo]) {
      saldos[id] = await movimentar(cli, id, deltas[id], motivos[id], ref, nota);
    }
    return { saldoDe: saldos[deId], saldoPara: saldos[paraId] };
  });
}

// ------------------------------------------------------------- extrato

export async function extratoDoJogador(playerId, limite = 30) {
  const { rows } = await pool.query(
    `SELECT delta, saldo_apos, motivo, ref, nota, criado_em
       FROM orb_ledger WHERE player_id = $1 ORDER BY id DESC LIMIT $2`,
    [playerId, limite],
  );
  return rows.map((r) => ({
    delta: Number(r.delta),
    saldo: Number(r.saldo_apos),
    motivo: r.motivo,
    ref: r.ref,
    nota: r.nota,
    em: r.criado_em,
  }));
}

// ------------------------------------------------------------ transparência

/**
 * Os números do caixa, direto do ledger.
 *
 * `orbsEmCirculacao` sai do SUM da tabela e não do SUM de `players.orbs` de propósito: se os
 * dois divergirem, é sinal de que algum caminho mexeu no cache sem passar por aqui, e é isso
 * que `conferirSaldo` procura.
 */
export async function numerosDoCaixa() {
  const dep = await pool.query(`SELECT COALESCE(SUM(usdt),0) AS v, COALESCE(SUM(orbs),0) AS o FROM orb_depositos`);
  // Confirmado + enviando com hash: o USDT já saiu da tesouraria mesmo que o worker
  // ainda não tenha marcado `confirmado` (bug antigo: `conferirEnviados` não rodava).
  const saq = await pool.query(
    `SELECT COALESCE(SUM(usdt),0) AS v FROM orb_saques
      WHERE status = $1 OR (status = $2 AND tx_hash IS NOT NULL)`,
    [SAQUE.CONFIRMADO, SAQUE.ENVIANDO],
  );
  const circ = await pool.query(`SELECT COALESCE(SUM(delta),0) AS v FROM orb_ledger`);

  return {
    compradoUsdt: Number(dep.rows[0].v),
    orbsComprados: Number(dep.rows[0].o),
    sacadoUsdt: Number(saq.rows[0].v),
    orbsEmCirculacao: Number(circ.rows[0].v),
  };
}

/** USDT que saiu da tesouraria para carteiras de lucro (admin). Só colheitas confirmadas on-chain. */
export async function colheitasConfirmadasUsdt() {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(usdt), 0) AS v
         FROM admin_colheitas
        WHERE assinatura IS NOT NULL AND erro IS NULL`,
    );
    return Number(rows[0].v);
  } catch {
    return 0;
  }
}

/**
 * Auditoria: o cache bate com o ledger?
 *
 * Devolve os jogadores em que `players.orbs` diverge do `SUM(orb_ledger.delta)`. Em operação
 * normal a lista é vazia. Qualquer linha aqui é bug — algum caminho mexeu no saldo sem
 * passar pelo ledger — e é melhor descobrir por uma checagem periódica do que por um jogador
 * reclamando.
 */
export async function conferirSaldo(limite = 50) {
  const { rows } = await pool.query(
    `SELECT p.id, p.nick, p.orbs AS cache, COALESCE(l.soma, 0) AS ledger
       FROM players p
       LEFT JOIN (SELECT player_id, SUM(delta) AS soma FROM orb_ledger GROUP BY player_id) l
              ON l.player_id = p.id
      WHERE p.orbs <> COALESCE(l.soma, 0)
      LIMIT $1`,
    [limite],
  );
  return rows.map((r) => ({ id: Number(r.id), nick: r.nick, cache: Number(r.cache), ledger: Number(r.ledger) }));
}

// ----------------------------------------------------------- referência

/** A referência de depósito do jogador — estável, criada na primeira vez que ele pede. */
export async function referenciaDe(playerId, gerar) {
  const { rows } = await pool.query(`SELECT referencia FROM orb_referencias WHERE player_id = $1`, [playerId]);
  if (rows.length) return rows[0].referencia;

  // Corrida de dois logins simultâneos: o segundo cai no DO NOTHING e relê.
  const ref = gerar();
  await pool.query(
    `INSERT INTO orb_referencias (player_id, referencia) VALUES ($1,$2)
     ON CONFLICT (player_id) DO NOTHING`,
    [playerId, ref],
  );
  const { rows: r2 } = await pool.query(`SELECT referencia FROM orb_referencias WHERE player_id = $1`, [playerId]);
  return r2[0].referencia;
}

/** Acha o jogador dono de uma referência de depósito (usado pelo watcher). */
export async function jogadorPorReferencia(referencia) {
  const { rows } = await pool.query(`SELECT player_id FROM orb_referencias WHERE referencia = $1`, [referencia]);
  return rows.length ? Number(rows[0].player_id) : null;
}

/** Emissão total, para o teste de invariante. */
export async function totaisPorMotivo() {
  const { rows } = await pool.query(`SELECT motivo, SUM(delta) AS v FROM orb_ledger GROUP BY motivo`);
  const out = {};
  for (const r of rows) out[r.motivo] = Number(r.v);
  return out;
}

export { MOTIVOS_QUE_EMITEM };

// ----------------------------------------------------------- admin / painel

const deLinhaAdmin = (r) => ({
  ...deLinha(r),
  nick: r.nick,
  aprovadoPor: r.aprovado_por ?? null,
  aprovadoEm: r.aprovado_em ?? null,
});

/** Fila de saques aguardando aprovação manual (beta). */
export async function listarSaquesAguardandoAprovacao({ limite = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const { rows } = await pool.query(
    `SELECT s.*, p.nick
       FROM orb_saques s
       JOIN players p ON p.id = s.player_id
      WHERE s.status = $1
      ORDER BY s.criado_em
      LIMIT $2 OFFSET $3`,
    [SAQUE.AGUARDANDO, lim, off],
  );
  const { rows: tot } = await pool.query(
    `SELECT count(*)::int AS n FROM orb_saques WHERE status = $1`,
    [SAQUE.AGUARDANDO],
  );
  return { total: tot[0]?.n ?? 0, offset: off, limite: lim, saques: rows.map(deLinhaAdmin) };
}

/** Admin aprova — libera o worker a processar. */
export async function aprovarSaque(id, porEmail) {
  const { rowCount } = await pool.query(
    `UPDATE orb_saques
        SET status = $2, aprovado_por = $3, aprovado_em = now()
      WHERE id = $1 AND status = $4`,
    [id, SAQUE.PENDENTE, porEmail, SAQUE.AGUARDANDO],
  );
  return rowCount > 0;
}

/** Histórico paginado de depósitos de gemas (admin). */
export async function listarDepositosAdmin({ nick = '', limite = 40, offset = 0 } = {}) {
  const busca = String(nick ?? '').trim();
  const lim = Math.min(Math.max(Number(limite) || 40, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const where = busca ? `WHERE lower(p.nick) LIKE '%' || lower($1) || '%'` : '';
  const params = busca ? [busca, lim, off] : [lim, off];
  const limOff = busca ? '$2' : '$1';
  const offOff = busca ? '$3' : '$2';

  const { rows } = await pool.query(
    `SELECT d.id, p.nick, d.rede, d.tx_hash, d.de_endereco, d.usdt, d.orbs, d.referencia, d.criado_em
       FROM orb_depositos d
       JOIN players p ON p.id = d.player_id
       ${where}
       ORDER BY d.criado_em DESC
       LIMIT ${limOff} OFFSET ${offOff}`,
    params,
  );
  const { rows: tot } = await pool.query(
    `SELECT count(*)::int AS n
       FROM orb_depositos d
       JOIN players p ON p.id = d.player_id
       ${where}`,
    busca ? [busca] : [],
  );
  return {
    total: tot[0]?.n ?? 0,
    offset: off,
    limite: lim,
    nick: busca,
    depositos: rows.map((r) => ({
      id: Number(r.id),
      nick: r.nick,
      rede: r.rede,
      txHash: r.tx_hash,
      de: r.de_endereco,
      usdt: Number(r.usdt),
      orbs: Number(r.orbs),
      referencia: r.referencia,
      em: r.criado_em,
    })),
  };
}

/** Histórico paginado de saques de gemas (admin). */
export async function listarSaquesAdmin({ nick = '', limite = 40, offset = 0 } = {}) {
  const busca = String(nick ?? '').trim();
  const lim = Math.min(Math.max(Number(limite) || 40, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const where = busca ? `WHERE lower(p.nick) LIKE '%' || lower($1) || '%'` : '';
  const params = busca ? [busca, lim, off] : [lim, off];
  const limOff = busca ? '$2' : '$1';
  const offOff = busca ? '$3' : '$2';

  const { rows } = await pool.query(
    `SELECT s.*, p.nick
       FROM orb_saques s
       JOIN players p ON p.id = s.player_id
       ${where}
       ORDER BY s.criado_em DESC
       LIMIT ${limOff} OFFSET ${offOff}`,
    params,
  );
  const { rows: tot } = await pool.query(
    `SELECT count(*)::int AS n
       FROM orb_saques s
       JOIN players p ON p.id = s.player_id
       ${where}`,
    busca ? [busca] : [],
  );
  return {
    total: tot[0]?.n ?? 0,
    offset: off,
    limite: lim,
    nick: busca,
    saques: rows.map(deLinhaAdmin),
  };
}

/**
 * Depósitos ou saques globais para a Tabela de preços — mesma paginação que `historicoGlobal`.
 *
 * Sem `count(*)`: pede uma linha a mais e devolve `temMais`. Saques cancelados ficam de fora.
 */
export async function historicoOrbsGlobal({ pagina = 0, porPagina = 30, tipo } = {}) {
  const pag = Math.max(0, Math.min(MAX_PAGINA_GLOBAL, Math.floor(Number(pagina) || 0)));
  const tam = Math.max(1, Math.min(60, Math.floor(Number(porPagina) || 30)));

  if (tipo === 'deposito') {
    const { rows } = await pool.query(
      `SELECT d.id, d.orbs, d.usdt, d.rede, d.criado_em, p.nick
         FROM orb_depositos d
         JOIN players p ON p.id = d.player_id
        ORDER BY d.criado_em DESC, d.id DESC
        LIMIT $1 OFFSET $2`,
      [tam + 1, pag * tam],
    );
    const temMais = rows.length > tam && pag < MAX_PAGINA_GLOBAL;
    return {
      pagina: pag,
      porPagina: tam,
      temMais,
      linhas: rows.slice(0, tam).map((r) => ({
        id: Number(r.id),
        tipo: 'deposito',
        moeda: 'orb',
        bruto: Number(r.orbs),
        usdt: Number(r.usdt),
        rede: r.rede,
        jogador: r.nick,
        vendedor: null,
        comprador: r.nick,
        em: r.criado_em?.getTime?.() ?? null,
        ficha: null,
      })),
    };
  }

  if (tipo === 'saque') {
    const { rows } = await pool.query(
      `SELECT s.id, s.orbs, s.usdt, s.rede, s.status, s.criado_em, p.nick
         FROM orb_saques s
         JOIN players p ON p.id = s.player_id
        WHERE s.status <> $3
        ORDER BY s.criado_em DESC
        LIMIT $1 OFFSET $2`,
      [tam + 1, pag * tam, SAQUE.CANCELADO],
    );
    const temMais = rows.length > tam && pag < MAX_PAGINA_GLOBAL;
    return {
      pagina: pag,
      porPagina: tam,
      temMais,
      linhas: rows.slice(0, tam).map((r) => ({
        id: r.id,
        tipo: 'saque',
        moeda: 'orb',
        bruto: Number(r.orbs),
        usdt: Number(r.usdt),
        rede: r.rede,
        status: r.status,
        jogador: r.nick,
        vendedor: r.nick,
        comprador: null,
        em: r.criado_em?.getTime?.() ?? null,
        ficha: null,
      })),
    };
  }

  throw new Error('tipo inválido para historicoOrbsGlobal');
}
