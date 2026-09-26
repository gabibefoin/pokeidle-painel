// Persistência do programa de indicação: códigos, vínculos e comissões idempotentes.
import { randomBytes } from 'node:crypto';
import { pool } from './db.mjs';
import { URL_PUBLICA } from './auth.mjs';
import { MOTIVO as MOTIVO_DIA } from './game/diamantes.mjs';
import { MOTIVO as MOTIVO_ORB } from './game/orbs.mjs';
import {
  ErroAfiliado, GEMAS_POR_DIAMANTE, PCT_DIA_COMISSAO, PCT_ORB_COMISSAO,
  diamantesDoBonus, refOk,
} from './game/afiliados.mjs';

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS affiliate_codes (
      account_id  BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      code        TEXT NOT NULL UNIQUE,
      visitas     INT NOT NULL DEFAULT 0,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- Referral Especial (ver game/afiliados.mjs). As três taxas são ANULÁVEIS de propósito:
      -- NULL = "usa a constante do código", que continua sendo a fonte de verdade do padrão.
      -- Um DEFAULT 0 significaria comissão ZERO para todo afiliado que já existe, em silêncio,
      -- e um NOT NULL sem default derrubaria o INSERT de obterOuCriarCodigo — que lista só
      -- (account_id, code) — e com ele a geração de código de convite do jogo inteiro.
      slug             TEXT,
      taxa_gema        NUMERIC(6,4),
      taxa_diamante    NUMERIC(6,4),
      taxa_dia_extra   NUMERIC(6,4),
      streamer_oficial BOOLEAN NOT NULL DEFAULT false,
      definido_por     TEXT,
      definido_em      TIMESTAMPTZ
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_aff_code ON affiliate_codes(lower(code))`);
  // Os ALTER repetem a forma EXATA do CREATE acima. Divergir entre os dois é o bug que o
  // comentário de `db.mjs` conta: banco novo nasce diferente de banco migrado, para sempre.
  await pool.query(`ALTER TABLE affiliate_codes ADD COLUMN IF NOT EXISTS slug             TEXT`);
  await pool.query(`ALTER TABLE affiliate_codes ADD COLUMN IF NOT EXISTS taxa_gema        NUMERIC(6,4)`);
  await pool.query(`ALTER TABLE affiliate_codes ADD COLUMN IF NOT EXISTS taxa_diamante    NUMERIC(6,4)`);
  await pool.query(`ALTER TABLE affiliate_codes ADD COLUMN IF NOT EXISTS taxa_dia_extra   NUMERIC(6,4)`);
  await pool.query(`ALTER TABLE affiliate_codes ADD COLUMN IF NOT EXISTS streamer_oficial BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE affiliate_codes ADD COLUMN IF NOT EXISTS definido_por     TEXT`);
  await pool.query(`ALTER TABLE affiliate_codes ADD COLUMN IF NOT EXISTS definido_em      TIMESTAMPTZ`);
  // UNIQUE sobre `lower(slug)`, e não sobre `slug`: a busca do `?ref=` é case-insensitive ponta
  // a ponta, então unicidade case-sensitive deixaria "Matta" e "matta" coexistirem apontando
  // para donos diferentes — e quem clicasse no link cairia num ou no outro conforme a caixa.
  // (O UNIQUE de `code` tem essa assimetria por legado; o slug nasce sem ela.)
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_aff_slug ON affiliate_codes(lower(slug)) WHERE slug IS NOT NULL`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS affiliate_referrals (
      referred_account_id  BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      referrer_account_id  BIGINT NOT NULL REFERENCES accounts(id),
      code                 TEXT NOT NULL,
      criado_em            TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_aff_ref_referrer ON affiliate_referrals(referrer_account_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS affiliate_comissao (
      id                  BIGSERIAL PRIMARY KEY,
      referrer_player_id  BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      referred_player_id  BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      tipo                TEXT NOT NULL,
      source_ref          TEXT NOT NULL,
      qtd                 BIGINT NOT NULL,
      entregue            BOOLEAN NOT NULL DEFAULT false,
      criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- A taxa e a base CONGELADAS no momento em que a comissão nasceu. Sem elas, mudar a taxa
      -- de um streamer reescreveria a história: a auditoria mostraria 15% sobre uma comissão
      -- que foi paga a 5%, e a conversa com o parceiro sobre "quanto me devem" fica insolúvel.
      -- qtd continua sendo o que se paga; estas duas são só memória de como se chegou nele.
      pct                 NUMERIC(6,4),
      base_qtd            BIGINT,
      UNIQUE (tipo, source_ref)
    )`);
  await pool.query(`ALTER TABLE affiliate_comissao ADD COLUMN IF NOT EXISTS pct      NUMERIC(6,4)`);
  await pool.query(`ALTER TABLE affiliate_comissao ADD COLUMN IF NOT EXISTS base_qtd BIGINT`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_aff_com_entrega ON affiliate_comissao(referrer_player_id)
     WHERE entregue = false`);
  // O índice acima é PARCIAL em `entregue = false`, mas as consultas quentes (recolher, painel,
  // passivo) definem "pendente" pela AUSÊNCIA de linha no ledger e nunca citam `entregue` — o
  // planner não o usa e varre a tabela. Este aqui é o que elas de fato pedem.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_aff_com_referrer ON affiliate_comissao(referrer_player_id, tipo)`,
  );
}

/** Pendente = comissão registrada ainda sem crédito no ledger (independe de `entregue`). */
const SQL_DIA_SEM_LEDGER = `
  ac.tipo = 'diamante' AND NOT EXISTS (
    SELECT 1 FROM diamante_ledger dl
     WHERE dl.player_id = ac.referrer_player_id
       AND dl.motivo = '${MOTIVO_DIA.AFILIADO}'
       AND dl.ref = ac.source_ref
  )`;

const SQL_GEMA_SEM_LEDGER = `
  ac.tipo = 'gema' AND NOT EXISTS (
    SELECT 1 FROM orb_ledger ol
     WHERE ol.player_id = ac.referrer_player_id
       AND ol.motivo = '${MOTIVO_ORB.AFILIADO}'
       AND ol.ref = ac.source_ref
  )`;

const SQL_QUALQUER_SEM_LEDGER = `(${SQL_DIA_SEM_LEDGER} OR ${SQL_GEMA_SEM_LEDGER})`;

/**
 * O `?ref=` como ele viaja: sem espaços e em minúscula.
 *
 * Minúscula, e não MAIÚSCULA como era: o código gerado é comparado por `lower()` no banco desde
 * sempre, então a caixa nunca importou para ele — mas o slug de streamer É minúsculo, e passar
 * "matta" por `toUpperCase()` antes de bater a regex do slug o destruía.
 */
function normalizarRef(ref) {
  return String(ref ?? '').trim().toLowerCase();
}

/**
 * Acha o dono de um `?ref=` — código gerado OU slug de streamer, indistintamente.
 *
 * Devolve sempre o `code` CANÔNICO da linha, nunca o que a pessoa digitou: é ele que vai
 * gravado em `affiliate_referrals.code`, e é o que mantém o histórico legível se o streamer
 * trocar de slug depois.
 */
async function donoDaRef(q, ref) {
  const r = normalizarRef(ref);
  if (!refOk(r)) return null;
  const { rows } = await q.query(
    `SELECT account_id, code FROM affiliate_codes
      WHERE lower(code) = $1 OR lower(slug) = $1
      LIMIT 1`,
    [r],
  );
  return rows[0] ? { accountId: Number(rows[0].account_id), code: rows[0].code } : null;
}

/**
 * As taxas daquele indicador, já resolvidas contra o padrão do código.
 *
 * `coalesce` e não `??` em JS: a coluna é anulável justamente para que NULL signifique "usa a
 * constante", e resolver isso no SQL mantém a regra num lugar só.
 */
async function taxasDe(q, accountId) {
  const { rows } = await q.query(
    `SELECT coalesce(taxa_gema, $2)::float8      AS gema,
            coalesce(taxa_diamante, $3)::float8  AS diamante,
            coalesce(taxa_dia_extra, 0)::float8  AS dia_extra
       FROM affiliate_codes WHERE account_id = $1`,
    [accountId, PCT_ORB_COMISSAO, PCT_DIA_COMISSAO],
  );
  return {
    gema: Number(rows[0]?.gema ?? PCT_ORB_COMISSAO),
    diamante: Number(rows[0]?.diamante ?? PCT_DIA_COMISSAO),
    diaExtra: Number(rows[0]?.dia_extra ?? 0),
  };
}

function novoCodigo() {
  const bytes = randomBytes(7);
  let s = '';
  for (let i = 0; i < 7; i++) s += ALFABETO[bytes[i] % ALFABETO.length];
  return s;
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

async function movimentarDiamante(cli, playerId, delta, ref, nota) {
  const { rows } = await cli.query(
    `UPDATE players SET diamonds = diamonds + $2
      WHERE id = $1 AND diamonds + $2 >= 0
      RETURNING diamonds`,
    [playerId, delta],
  );
  if (!rows.length) throw new Error('falha ao creditar diamante de afiliado');
  const saldo = Number(rows[0].diamonds);
  await cli.query(
    `INSERT INTO diamante_ledger (player_id, delta, saldo_apos, motivo, ref, nota)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [playerId, delta, saldo, MOTIVO_DIA.AFILIADO, ref, nota],
  );
  return saldo;
}

async function movimentarOrb(cli, playerId, delta, ref, nota) {
  const { rows } = await cli.query(
    `UPDATE players SET orbs = orbs + $2
      WHERE id = $1 AND orbs + $2 >= 0
      RETURNING orbs`,
    [playerId, delta],
  );
  if (!rows.length) throw new Error('falha ao creditar gema de afiliado');
  const saldo = Number(rows[0].orbs);
  await cli.query(
    `INSERT INTO orb_ledger (player_id, delta, saldo_apos, motivo, ref, nota)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [playerId, delta, saldo, MOTIVO_ORB.AFILIADO, ref, nota],
  );
  return saldo;
}

async function playerIdDeConta(q, accountId) {
  const { rows } = await q.query(
    `SELECT p.id FROM accounts a
      JOIN players p ON lower(p.nick) = lower(a.nick)
     WHERE a.id = $1`,
    [accountId],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function accountIdDePlayer(q, playerId) {
  const { rows } = await q.query(
    `SELECT a.id FROM players p
      JOIN accounts a ON lower(a.nick) = lower(p.nick)
     WHERE p.id = $1`,
    [playerId],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function referralDeConta(accountId) {
  const { rows } = await pool.query(
    `SELECT referrer_account_id, code FROM affiliate_referrals WHERE referred_account_id = $1`,
    [accountId],
  );
  return rows[0] ?? null;
}

async function jaComprouDiamantes(playerId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM diamante_pagamentos WHERE player_id = $1 AND status = 'pago' LIMIT 1`,
    [playerId],
  );
  return !!rows.length;
}

/** Garante um código único para a conta. */
export async function obterOuCriarCodigo(accountId) {
  const { rows } = await pool.query(`SELECT code FROM affiliate_codes WHERE account_id = $1`, [accountId]);
  if (rows[0]) return rows[0].code;

  for (let i = 0; i < 12; i++) {
    const code = novoCodigo();
    try {
      // O `WHERE NOT EXISTS` fecha a única ambiguidade que o UNIQUE de `code` não pega: um
      // código sorteado sair igual ao SLUG de outra pessoa. São colunas diferentes, e `?ref=`
      // resolve pelas duas — o `LIMIT 1` decidiria por ordem de tabela, que muda com um VACUUM,
      // e a indicação iria para um dos dois ao acaso. É improvável (34 bilhões de combinações),
      // mas é barato de impedir e caro de descobrir depois.
      const ins = await pool.query(
        `INSERT INTO affiliate_codes (account_id, code)
         SELECT $1, $2
          WHERE NOT EXISTS (SELECT 1 FROM affiliate_codes WHERE lower(slug) = lower($2))
         RETURNING code`,
        [accountId, code],
      );
      if (!ins.rowCount) continue;
      return ins.rows[0].code;
    } catch (err) {
      if (err.code !== '23505') throw err;
    }
  }
  throw new Error('não foi possível gerar código de afiliado');
}

/** Conta uma visita ao link (?ref=). Falha silenciosa se o código não existir. */
export async function registrarVisita(code) {
  const c = normalizarRef(code);
  if (!refOk(c)) return false;
  const { rowCount } = await pool.query(
    `UPDATE affiliate_codes SET visitas = visitas + 1
      WHERE lower(code) = $1 OR lower(slug) = $1`,
    [c],
  );
  return rowCount > 0;
}

/**
 * Vincula uma conta recém-criada (ou sem vínculo) a um indicador.
 * Ignora códigos inválidos no cadastro — só a aplicação manual devolve erro.
 */
export async function tentarAtribuirReferencia(referredAccountId, code, { exigir = false } = {}) {
  const c = normalizarRef(code);
  if (!c) return { atribuido: false };
  if (!refOk(c)) {
    if (exigir) throw new ErroAfiliado('afiliados.codigoInvalido');
    return { atribuido: false };
  }

  const dono = await donoDaRef(pool, c);
  if (!dono) {
    if (exigir) throw new ErroAfiliado('afiliados.codigoInvalido');
    return { atribuido: false };
  }
  const referrerAccountId = dono.accountId;
  if (referrerAccountId === referredAccountId) {
    if (exigir) throw new ErroAfiliado('afiliados.proprioCodigo');
    return { atribuido: false };
  }

  const ja = await referralDeConta(referredAccountId);
  if (ja) {
    if (exigir) throw new ErroAfiliado('afiliados.jaIndicado');
    return { atribuido: false };
  }

  try {
    await pool.query(
      `INSERT INTO affiliate_referrals (referred_account_id, referrer_account_id, code)
       VALUES ($1, $2, $3)`,
      // O código CANÔNICO da linha, e não `c`: quem entrou por `?ref=matta` fica gravado com o
      // código de convite do streamer. Assim o histórico continua legível se ele trocar de slug,
      // e `painelDe` consegue dizer "você entrou pelo código X" para qualquer um dos dois links.
      [referredAccountId, referrerAccountId, dono.code],
    );
    return { atribuido: true };
  } catch (err) {
    if (err.code === '23505') {
      if (exigir) throw new ErroAfiliado('afiliados.jaIndicado');
      return { atribuido: false };
    }
    throw err;
  }
}

/** Aplicação manual do código — só antes da 1ª compra de diamantes. */
export async function aplicarCodigo(referredAccountId, code) {
  const playerId = await playerIdDeConta(pool, referredAccountId);
  if (playerId && await jaComprouDiamantes(playerId)) {
    throw new ErroAfiliado('afiliados.jaComprou');
  }
  return tentarAtribuirReferencia(referredAccountId, code, { exigir: true });
}

/** Painel do indicador para a tela. */
export async function painelDe(accountId) {
  const code = await obterOuCriarCodigo(accountId);

  // As taxas viajam para o cliente porque o texto do modal ("ganhe 10% e 5%") era literal nos
  // três idiomas e passou a ser {pctDia}/{pctOrb}. Com taxa por indicador, um número cravado na
  // tradução vira promessa falsa para todo streamer especial — e dessincroniza em silêncio.
  const { rows: cfg } = await pool.query(
    `SELECT slug, streamer_oficial,
            coalesce(taxa_gema, $2)::float8     AS taxa_gema,
            coalesce(taxa_diamante, $3)::float8 AS taxa_diamante,
            coalesce(taxa_dia_extra, 0)::float8 AS taxa_dia_extra
       FROM affiliate_codes WHERE account_id = $1`,
    [accountId, PCT_ORB_COMISSAO, PCT_DIA_COMISSAO],
  );
  const especial = cfg[0] ?? {};
  // O slug manda no link quando existe: é ele que o streamer divulga, e é ele que precisa
  // aparecer no botão de copiar. O código continua valendo e continua sendo mostrado.
  const link = `${URL_PUBLICA}/?ref=${especial.slug || code}`;

  const [{ rows: stats }, ref, playerRow] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT count(*)::int FROM affiliate_referrals WHERE referrer_account_id = $1) AS indicados,
         (SELECT visitas FROM affiliate_codes WHERE account_id = $1) AS visitas,
         (SELECT coalesce(sum(qtd),0)::bigint FROM affiliate_comissao ac
            JOIN accounts a ON a.id = $1
            JOIN players p ON lower(p.nick) = lower(a.nick)
           WHERE ac.referrer_player_id = p.id AND ac.tipo = 'diamante') AS ganhos_dia,
         (SELECT coalesce(sum(qtd),0)::bigint FROM affiliate_comissao ac
            JOIN accounts a ON a.id = $1
            JOIN players p ON lower(p.nick) = lower(a.nick)
           WHERE ac.referrer_player_id = p.id AND ac.tipo = 'gema') AS ganhos_gema,
         (SELECT coalesce(sum(qtd),0)::bigint FROM affiliate_comissao ac
            JOIN accounts a ON a.id = $1
            JOIN players p ON lower(p.nick) = lower(a.nick)
           WHERE ac.referrer_player_id = p.id AND ${SQL_DIA_SEM_LEDGER}) AS pendente_dia,
         (SELECT coalesce(sum(qtd),0)::bigint FROM affiliate_comissao ac
            JOIN accounts a ON a.id = $1
            JOIN players p ON lower(p.nick) = lower(a.nick)
           WHERE ac.referrer_player_id = p.id AND ${SQL_GEMA_SEM_LEDGER}) AS pendente_gema`,
      [accountId],
    ),
    referralDeConta(accountId),
    pool.query(`SELECT p.id FROM accounts a JOIN players p ON lower(p.nick) = lower(a.nick) WHERE a.id = $1`, [accountId]),
  ]);

  const playerId = playerRow.rows[0] ? Number(playerRow.rows[0].id) : null;
  const podeAplicar = !ref && playerId != null && !(await jaComprouDiamantes(playerId));

  return {
    code,
    link,
    slug: especial.slug ?? null,
    streamerOficial: !!especial.streamer_oficial,
    taxaGema: Number(especial.taxa_gema ?? PCT_ORB_COMISSAO),
    taxaDiamante: Number(especial.taxa_diamante ?? PCT_DIA_COMISSAO),
    taxaDiaExtra: Number(especial.taxa_dia_extra ?? 0),
    gemasPorDiamante: GEMAS_POR_DIAMANTE,
    indicados: stats[0]?.indicados ?? 0,
    visitas: stats[0]?.visitas ?? 0,
    ganhosDiamantes: Number(stats[0]?.ganhos_dia ?? 0),
    ganhosGemas: Number(stats[0]?.ganhos_gema ?? 0),
    pendenteDiamantes: Number(stats[0]?.pendente_dia ?? 0),
    pendenteGemas: Number(stats[0]?.pendente_gema ?? 0),
    indicadoPor: ref?.code ?? null,
    podeAplicar,
    podeRecolher: Number(stats[0]?.pendente_dia ?? 0) > 0 || Number(stats[0]?.pendente_gema ?? 0) > 0,
  };
}

/**
 * A comissão em diamante da compra de diamantes — idempotente pela referência do pagamento.
 *
 * A taxa é a do INDICADOR (`taxa_diamante`, ou `PCT_DIA_COMISSAO` quando ele não tem uma), e
 * por isso a multiplicação só acontece DEPOIS de saber quem ele é. A ordem importa: calcular
 * antes, como era, aplicaria a taxa global a todo mundo e gravaria o resultado como se fosse a
 * especial — o streamer receberia 10% e a linha diria 20%.
 */
export async function comissaoDiamante(referredPlayerId, qtdComprada, sourceRef) {
  const base = Math.floor(Number(qtdComprada) || 0);
  if (base <= 0) return { creditado: false };

  return comTransacao(async (cli) => {
    const ref = await (async () => {
      const accountId = await accountIdDePlayer(cli, referredPlayerId);
      if (!accountId) return null;
      const { rows } = await cli.query(
        `SELECT referrer_account_id FROM affiliate_referrals WHERE referred_account_id = $1`,
        [accountId],
      );
      return rows[0] ?? null;
    })();
    if (!ref) return { creditado: false };

    const referrerAccountId = Number(ref.referrer_account_id);
    const referrerPlayerId = await playerIdDeConta(cli, referrerAccountId);
    if (!referrerPlayerId) return { creditado: false };

    const taxas = await taxasDe(cli, referrerAccountId);
    const qtd = Math.floor(base * taxas.diamante);
    if (qtd <= 0) return { creditado: false };

    const ins = await cli.query(
      `INSERT INTO affiliate_comissao
         (referrer_player_id, referred_player_id, tipo, source_ref, qtd, pct, base_qtd)
       VALUES ($1,$2,'diamante',$3,$4,$5,$6)
       ON CONFLICT (tipo, source_ref) DO NOTHING
       RETURNING id`,
      [referrerPlayerId, referredPlayerId, sourceRef, qtd, taxas.diamante, base],
    );
    if (!ins.rowCount) return { creditado: false };

    // Só registra a comissão — o indicador recolhe manualmente na aba Indique & Ganhe.
    return { creditado: true, qtd, referrerPlayerId, pct: taxas.diamante };
  });
}

/**
 * A comissão do depósito de gemas — idempotente pelo par rede:hash.
 *
 * Sai daqui até DUAS linhas, e elas fazem coisas diferentes:
 *
 *   · `gema`     — `taxa_gema` do depósito, paga em gema. É emissão SEM LASTRO, e é ela que o
 *                  teto de solvência limita (ver `game/afiliados.mjs`).
 *   · `diamante` — `taxa_dia_extra` do MESMO depósito, paga em diamante a
 *                  `GEMAS_POR_DIAMANTE`. É como um streamer recebe mais do que o teto da gema
 *                  permite sem que a tesouraria em USDT sinta: diamante não é resgatável.
 *
 * A segunda linha usa `source_ref` prefixado com `extra:` porque a chave de idempotência é
 * `(tipo, source_ref)` e `tipo` já é 'diamante' na comissão de COMPRA de diamantes. Sem o
 * prefixo, um depósito de gema e uma compra de diamantes que casassem de referência se
 * anulariam em silêncio.
 */
export async function comissaoOrb(referredPlayerId, qtdDepositada, sourceRef) {
  const base = Math.floor(Number(qtdDepositada) || 0);
  if (base <= 0) return { creditado: false };

  return comTransacao(async (cli) => {
    const accountId = await accountIdDePlayer(cli, referredPlayerId);
    if (!accountId) return { creditado: false };
    const { rows } = await cli.query(
      `SELECT referrer_account_id FROM affiliate_referrals WHERE referred_account_id = $1`,
      [accountId],
    );
    if (!rows[0]) return { creditado: false };

    const referrerAccountId = Number(rows[0].referrer_account_id);
    const referrerPlayerId = await playerIdDeConta(cli, referrerAccountId);
    if (!referrerPlayerId) return { creditado: false };

    const taxas = await taxasDe(cli, referrerAccountId);
    const qtd = Math.floor(base * taxas.gema);
    const extra = diamantesDoBonus(base, taxas.diaExtra);

    let creditado = false;
    if (qtd > 0) {
      const ins = await cli.query(
        `INSERT INTO affiliate_comissao
           (referrer_player_id, referred_player_id, tipo, source_ref, qtd, pct, base_qtd)
         VALUES ($1,$2,'gema',$3,$4,$5,$6)
         ON CONFLICT (tipo, source_ref) DO NOTHING
         RETURNING id`,
        [referrerPlayerId, referredPlayerId, sourceRef, qtd, taxas.gema, base],
      );
      creditado = !!ins.rowCount;
    }

    if (extra > 0) {
      const insExtra = await cli.query(
        `INSERT INTO affiliate_comissao
           (referrer_player_id, referred_player_id, tipo, source_ref, qtd, pct, base_qtd)
         VALUES ($1,$2,'diamante',$3,$4,$5,$6)
         ON CONFLICT (tipo, source_ref) DO NOTHING
         RETURNING id`,
        [referrerPlayerId, referredPlayerId, `extra:${sourceRef}`, extra, taxas.diaExtra, base],
      );
      creditado = creditado || !!insExtra.rowCount;
    }

    if (!creditado) return { creditado: false };

    // Só registra a comissão — o indicador recolhe manualmente na aba Indique & Ganhe.
    return { creditado: true, qtd, extra, referrerPlayerId, pct: taxas.gema };
  });
}

export async function jogadoresComEntregaPendente(playerIds) {
  if (!playerIds.length) return new Set();
  const { rows } = await pool.query(
    `SELECT DISTINCT referrer_player_id FROM affiliate_comissao ac
      WHERE ac.referrer_player_id = ANY($1::bigint[])
        AND (${SQL_QUALQUER_SEM_LEDGER})`,
    [playerIds],
  );
  return new Set(rows.map((r) => Number(r.referrer_player_id)));
}

/**
 * Credita na carteira tudo que estiver pendente em `affiliate_comissao`.
 *
 * Só roda quando o jogador clica em "Recolher" — a comissão nasce registrada, não paga.
 * Idempotente: se o ledger já tiver a linha (legado de crédito automático), só marca entregue.
 */
export async function recolherEntregas(playerId) {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `SELECT id, tipo, qtd, source_ref, pct FROM affiliate_comissao ac
        WHERE ac.referrer_player_id = $1 AND (${SQL_QUALQUER_SEM_LEDGER})
        FOR UPDATE`,
      [playerId],
    );
    if (!rows.length) return { itens: [], recolhido: [], diamonds: 0, orbs: 0 };

    const recolhido = [];
    for (const row of rows) {
      const qtd = Number(row.qtd);
      const ref = row.source_ref;
      // A nota sai da taxa CONGELADA na linha, não de uma constante: com taxa por indicador, o
      // "5% indicação" cravado na string mentiria no extrato de todo streamer especial — e
      // mentiria também no histórico depois de qualquer renegociação. `pct` é nulo nas linhas
      // anteriores a esta versão; ali o texto genérico é o honesto.
      const nota = row.pct != null
        ? `${(Number(row.pct) * 100).toFixed(Number(row.pct) * 100 % 1 ? 1 : 0)}% indicação · ${ref}`
        : `indicação · ${ref}`;
      if (row.tipo === 'diamante') {
        await movimentarDiamante(cli, playerId, qtd, ref, nota);
        recolhido.push({ tipo: 'diamante', qtd });
      } else if (row.tipo === 'gema') {
        await movimentarOrb(cli, playerId, qtd, ref, nota);
        recolhido.push({ tipo: 'gema', qtd });
      }
    }

    const ids = rows.map((r) => Number(r.id));
    await cli.query(
      `UPDATE affiliate_comissao SET entregue = true
        WHERE id = ANY($1::bigint[])`,
      [ids],
    );

    const [{ rows: dia }, { rows: orb }] = await Promise.all([
      cli.query(`SELECT diamonds FROM players WHERE id = $1`, [playerId]),
      cli.query(`SELECT orbs FROM players WHERE id = $1`, [playerId]),
    ]);

    return {
      itens: rows.map((r) => ({ tipo: r.tipo, qtd: Number(r.qtd) })),
      recolhido,
      diamonds: Number(dia[0]?.diamonds ?? 0),
      orbs: Number(orb[0]?.orbs ?? 0),
    };
  });
}

/** Diagnóstico: comissões registradas vs créditos no ledger. */
export async function auditoriaDe(playerId) {
  const [{ rows: com }, { rows: dia }, { rows: orb }] = await Promise.all([
    pool.query(
      `SELECT id, tipo, qtd, source_ref, entregue, criado_em
         FROM affiliate_comissao
        WHERE referrer_player_id = $1
        ORDER BY id`,
      [playerId],
    ),
    pool.query(`SELECT diamonds FROM players WHERE id = $1`, [playerId]),
    pool.query(`SELECT orbs FROM players WHERE id = $1`, [playerId]),
  ]);

  const pendentes = [];
  for (const row of com) {
    const ref = row.source_ref;
    const motivo = row.tipo === 'gema' ? MOTIVO_ORB.AFILIADO : MOTIVO_DIA.AFILIADO;
    const tabela = row.tipo === 'gema' ? 'orb_ledger' : 'diamante_ledger';
    const { rows: led } = await pool.query(
      `SELECT 1 FROM ${tabela} WHERE player_id = $1 AND motivo = $2 AND ref = $3 LIMIT 1`,
      [playerId, motivo, ref],
    );
    if (!led.length) {
      pendentes.push({
        id: Number(row.id),
        tipo: row.tipo,
        qtd: Number(row.qtd),
        ref,
        entregue: row.entregue,
      });
    }
  }

  const entregueSemLedger = pendentes.filter((r) => r.entregue);
  const pendenteSemLedger = pendentes.filter((r) => !r.entregue);
  const fantasmaPendente = com.filter((row) => {
    if (row.entregue) return false;
    const motivo = row.tipo === 'gema' ? MOTIVO_ORB.AFILIADO : MOTIVO_DIA.AFILIADO;
    return !pendentes.some((p) => p.id === Number(row.id));
  }).map((row) => ({
    id: Number(row.id),
    tipo: row.tipo,
    qtd: Number(row.qtd),
    ref: row.source_ref,
  }));

  return {
    comissoes: com.map((r) => ({
      id: Number(r.id),
      tipo: r.tipo,
      qtd: Number(r.qtd),
      ref: r.source_ref,
      entregue: r.entregue,
    })),
    ganhosDiamantes: com.filter((r) => r.tipo === 'diamante').reduce((s, r) => s + Number(r.qtd), 0),
    ganhosGemas: com.filter((r) => r.tipo === 'gema').reduce((s, r) => s + Number(r.qtd), 0),
    saldoDiamantes: Number(dia[0]?.diamonds ?? 0),
    saldoGemas: Number(orb[0]?.orbs ?? 0),
    semCreditoNoLedger: pendentes,
    entregueSemLedger,
    pendenteSemLedger,
    fantasmaPendente,
  };
}

/** Lista indicadores com comissão registrada mas sem linha correspondente no ledger. */
export async function listarDivergenciasAfiliado({ limite = 200 } = {}) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ac.referrer_player_id AS player_id, p.nick
       FROM affiliate_comissao ac
       JOIN players p ON p.id = ac.referrer_player_id
      WHERE (
        (ac.tipo = 'diamante' AND NOT EXISTS (
          SELECT 1 FROM diamante_ledger dl
           WHERE dl.player_id = ac.referrer_player_id
             AND dl.motivo = $1
             AND dl.ref = ac.source_ref
        ))
        OR
        (ac.tipo = 'gema' AND NOT EXISTS (
          SELECT 1 FROM orb_ledger ol
           WHERE ol.player_id = ac.referrer_player_id
             AND ol.motivo = $2
             AND ol.ref = ac.source_ref
        ))
      )
      ORDER BY p.nick
      LIMIT $3`,
    [MOTIVO_DIA.AFILIADO, MOTIVO_ORB.AFILIADO, limite],
  );
  return rows.map((r) => ({ playerId: Number(r.player_id), nick: r.nick }));
}

/**
 * Credita comissões que ficaram marcadas como entregues (ou pendentes) sem ledger.
 * Só para suporte/admin — corrige perda real, não mexe em quem já foi pago.
 */
export async function repararComissoes(playerId, { dryRun = true } = {}) {
  const audit = await auditoriaDe(playerId);
  const alvo = audit.semCreditoNoLedger;
  if (!alvo.length) return { reparado: [], dryRun };

  if (dryRun) return { reparado: alvo, dryRun: true };

  return comTransacao(async (cli) => {
    const reparado = [];
    for (const row of alvo) {
      const ref = row.ref;
      const qtd = Number(row.qtd);
      if (row.tipo === 'diamante') {
        await movimentarDiamante(cli, playerId, qtd, ref, `reparo indicação · ${ref}`);
      } else {
        await movimentarOrb(cli, playerId, qtd, ref, `reparo indicação · ${ref}`);
      }
      reparado.push(row);
    }
    await cli.query(
      `UPDATE affiliate_comissao SET entregue = true
        WHERE referrer_player_id = $1 AND entregue = false`,
      [playerId],
    );
    const [{ rows: dia }, { rows: orb }] = await Promise.all([
      cli.query(`SELECT diamonds FROM players WHERE id = $1`, [playerId]),
      cli.query(`SELECT orbs FROM players WHERE id = $1`, [playerId]),
    ]);
    return {
      reparado,
      dryRun: false,
      diamonds: Number(dia[0]?.diamonds ?? 0),
      orbs: Number(orb[0]?.orbs ?? 0),
    };
  });
}

/** Gemas de comissão ainda não recolhidas — passivo futuro da tesouraria. */
export async function totalGemasComissaoPendentes() {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(qtd), 0)::bigint AS v
       FROM affiliate_comissao ac
      WHERE ${SQL_GEMA_SEM_LEDGER}`,
  );
  return Number(rows[0]?.v ?? 0);
}

// ------------------------------------------------------ referral especial
//
// A parte do painel de admin. Tudo mora nas colunas de `affiliate_codes` (1:1 com a conta), e
// não numa tabela nova: o dado é um por conta, nasce e morre com ela, e uma tabela à parte só
// acrescentaria um JOIN no caminho quente da comissão.

/** A conta de um nick de jogo, já com código de convite garantido. */
async function contaDoNick(nick) {
  const pedido = String(nick ?? '').trim();
  if (!pedido) throw new ErroAfiliado('afiliados.nickObrigatorio');
  const { rows } = await pool.query(
    `SELECT a.id, a.nick FROM accounts a WHERE lower(a.nick) = lower($1)`,
    [pedido],
  );
  if (!rows[0]) throw new ErroAfiliado('afiliados.nickNaoEncontrado');
  const accountId = Number(rows[0].id);
  // Garante a linha em `affiliate_codes` antes do UPDATE: um streamer que nunca abriu a aba
  // Indique & Ganhe ainda não tem código, e sem isto o painel salvaria em zero linhas e diria
  // que deu certo.
  await obterOuCriarCodigo(accountId);
  return { accountId, nick: rows[0].nick };
}

/**
 * Grava (ou atualiza) o acordo especial de um indicador.
 *
 * As taxas chegam já validadas contra os tetos por `game/afiliados.mjs` — aqui só se resolve o
 * nick, se confere a colisão de slug e se grava. `null` em qualquer taxa significa "volta ao
 * padrão do código", e é assim que se desfaz um acordo sem apagar o histórico dele.
 */
export async function definirEspecial({
  nick, slug = null, taxaGema = null, taxaDiamante = null, taxaDiaExtra = null,
  streamerOficial = false, porEmail,
}) {
  const conta = await contaDoNick(nick);

  // Slug colidindo com o CÓDIGO de outra pessoa é o caso que o índice único de `slug` sozinho
  // não pega: são colunas diferentes. Sem esta checagem, `?ref=` resolveria pelos dois e o
  // `LIMIT 1` decidiria por ordem de tabela — a indicação iria para quem o Postgres devolvesse
  // primeiro, o que muda com um VACUUM.
  if (slug) {
    const { rows: colide } = await pool.query(
      `SELECT account_id FROM affiliate_codes
        WHERE (lower(code) = $1 OR lower(slug) = $1) AND account_id <> $2
        LIMIT 1`,
      [slug, conta.accountId],
    );
    if (colide[0]) throw new ErroAfiliado('afiliados.slugEmUso');
  }

  const { rows } = await pool.query(
    `UPDATE affiliate_codes
        SET slug = $2, taxa_gema = $3, taxa_diamante = $4, taxa_dia_extra = $5,
            streamer_oficial = $6, definido_por = $7, definido_em = now()
      WHERE account_id = $1
      RETURNING code, slug, streamer_oficial`,
    [
      conta.accountId, slug, taxaGema, taxaDiamante, taxaDiaExtra,
      !!streamerOficial, String(porEmail ?? '').toLowerCase(),
    ],
  );

  return {
    nick: conta.nick,
    code: rows[0]?.code ?? null,
    slug: rows[0]?.slug ?? null,
    streamerOficial: !!rows[0]?.streamer_oficial,
    taxaGema, taxaDiamante, taxaDiaExtra,
  };
}

/** Desfaz o acordo: volta o indicador ao padrão do código, mantendo código, visitas e histórico. */
export async function removerEspecial(nick) {
  const conta = await contaDoNick(nick);
  await pool.query(
    `UPDATE affiliate_codes
        SET slug = NULL, taxa_gema = NULL, taxa_diamante = NULL, taxa_dia_extra = NULL,
            streamer_oficial = false, definido_por = $2, definido_em = now()
      WHERE account_id = $1`,
    [conta.accountId, String(nick ?? '').toLowerCase()],
  );
  return { nick: conta.nick };
}

/**
 * Os acordos que existem hoje, com o que cada um já custou.
 *
 * "Já custou" sai de `affiliate_comissao`, que é o registro do que NASCEU — não do que foi
 * recolhido. É o número certo para a decisão: a comissão registrada é dívida do projeto assim
 * que existe, mesmo que o streamer nunca clique em Recolher.
 */
export async function listarEspeciais() {
  const { rows } = await pool.query(
    `SELECT ac.account_id, a.nick, ac.code, ac.slug, ac.visitas,
            ac.taxa_gema::float8      AS taxa_gema,
            ac.taxa_diamante::float8  AS taxa_diamante,
            ac.taxa_dia_extra::float8 AS taxa_dia_extra,
            ac.streamer_oficial, ac.definido_por, ac.definido_em,
            (SELECT count(*)::int FROM affiliate_referrals ar
              WHERE ar.referrer_account_id = ac.account_id) AS indicados,
            coalesce((SELECT sum(c.qtd) FROM affiliate_comissao c
                       JOIN players p ON p.id = c.referrer_player_id
                      WHERE lower(p.nick) = lower(a.nick) AND c.tipo = 'gema'), 0)::bigint AS pago_gema,
            coalesce((SELECT sum(c.qtd) FROM affiliate_comissao c
                       JOIN players p ON p.id = c.referrer_player_id
                      WHERE lower(p.nick) = lower(a.nick) AND c.tipo = 'diamante'), 0)::bigint AS pago_dia
       FROM affiliate_codes ac
       JOIN accounts a ON a.id = ac.account_id
      WHERE ac.slug IS NOT NULL OR ac.taxa_gema IS NOT NULL OR ac.taxa_diamante IS NOT NULL
         OR ac.taxa_dia_extra IS NOT NULL OR ac.streamer_oficial
      ORDER BY ac.streamer_oficial DESC, a.nick`,
  );
  return rows.map((r) => ({
    nick: r.nick,
    code: r.code,
    slug: r.slug,
    visitas: Number(r.visitas),
    indicados: Number(r.indicados),
    taxaGema: r.taxa_gema == null ? null : Number(r.taxa_gema),
    taxaDiamante: r.taxa_diamante == null ? null : Number(r.taxa_diamante),
    taxaDiaExtra: r.taxa_dia_extra == null ? null : Number(r.taxa_dia_extra),
    streamerOficial: !!r.streamer_oficial,
    definidoPor: r.definido_por,
    definidoEm: r.definido_em,
    pagoGema: Number(r.pago_gema),
    pagoDiamante: Number(r.pago_dia),
  }));
}

/** O selo de Streamer Oficial de um nick de jogo — para o chat e a ficha. */
export async function streamerOficialPorNick(nick) {
  if (!nick) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM affiliate_codes ac
       JOIN accounts a ON a.id = ac.account_id
      WHERE lower(a.nick) = lower($1) AND ac.streamer_oficial
      LIMIT 1`,
    [nick],
  );
  return !!rows.length;
}
