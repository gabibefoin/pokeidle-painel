// Documentos para MED — a COLETA (somente leitura) e o REGISTRO de cada emissão.
//
// ### Somente leitura, por construção
//
// Nenhuma função daqui escreve em tabela do jogo. As únicas escritas são nas duas tabelas deste
// arquivo — o registro das emissões e o log de quem consultou o quê —, e as duas são
// append-only (a única exceção é carimbar o hash do PDF na primeira vez que ele é gerado, sem
// nunca sobrescrever um já gravado).
//
// ### Uma conta por vez, e poucas consultas
//
// Toda consulta é filtrada pelo jogador e anda num índice que já existe: `idx_players_nick_min`,
// `idx_acc_nick_min`, `idx_dia_pag_player`, `idx_dia_ledger_player`, `idx_origem_par` (conta_id
// é a coluna líder) e `idx_gameplay_player`. As duas de "cobertura" (desde quando cada log
// existe) leem UMA linha pela chave primária. Nada varre o histórico de todos os jogadores.
//
// A busca pelo identificador da transação (E2E/txid) é a única que não parte do jogador, e é
// para ela que os dois índices parciais do `migrar()` existem.
//
// ### Por que o registro não tem FK para `players`
//
// Mesma razão de `conta_origens`: um `ON DELETE CASCADE` faria "apagar a conta" apagar também a
// prova de que um documento sobre ela foi emitido, por quem e com qual hash.
import { pool } from './db.mjs';
import { decifrar } from './cofre.mjs';

const FUSO = 'America/Sao_Paulo';

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS med_documentos (
      id             BIGINT PRIMARY KEY,
      codigo         TEXT NOT NULL UNIQUE,          -- MED-2026-000001
      player_id      BIGINT NOT NULL,
      conta_id       BIGINT,
      nick           TEXT NOT NULL,
      por_email      TEXT NOT NULL,
      emitido_em     TIMESTAMPTZ NOT NULL,
      -- SHA-256 do conteúdo integral do documento (ver \`med-documento.mjs\`).
      hash_conteudo  TEXT NOT NULL,
      -- SHA-256 do ARQUIVO PDF, carimbado na primeira geração. É o que permite a quem recebeu o
      -- PDF conferir, depois, que o arquivo em mãos é o mesmo que saiu daqui.
      hash_pdf       TEXT,
      -- O que o administrador INFORMOU sobre a solicitação (protocolo, valor, instituição…).
      contexto       JSONB NOT NULL DEFAULT '{}'::jsonb,
      -- Observação interna. Nunca é impressa no documento.
      observacao     TEXT,
      contagens      JSONB NOT NULL DEFAULT '{}'::jsonb
    )`);
  await pool.query(`CREATE SEQUENCE IF NOT EXISTS med_documentos_seq`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_med_doc_player ON med_documentos(player_id, emitido_em DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_med_doc_em ON med_documentos(emitido_em DESC)`);

  // Quem viu dado pessoal de quem, e quando. Consulta conta tanto quanto emissão: a tela de
  // busca já mostra CPF e e-mail.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS med_documentos_log (
      id         BIGSERIAL PRIMARY KEY,
      acao       TEXT NOT NULL,        -- consulta | emissao | pdf | verificacao
      codigo     TEXT,
      player_id  BIGINT,
      nick       TEXT,
      por_email  TEXT NOT NULL,
      detalhe    TEXT,
      em         TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_med_log_em ON med_documentos_log(em DESC)`);

  // A solicitação de MED chega do banco com o EndToEndId, não com o nick. Sem estes índices a
  // busca por ele seria uma varredura da tabela de pagamentos.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dia_pag_comprovante ON diamante_pagamentos(comprovante)
     WHERE comprovante IS NOT NULL`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dia_pag_provedor_ref ON diamante_pagamentos(provedor_ref)
     WHERE provedor_ref IS NOT NULL`);
}

const iso = (d) => (d ? new Date(d).toISOString() : null);
const n = (v) => (v == null ? null : Number(v));

// ------------------------------------------------------------------- busca

/**
 * O jogador por nick ou pelo identificador de uma transação dele.
 *
 * `transacao` casa com o EndToEndId (`comprovante`), com a nossa referência (que é o txid da
 * Efí) ou com o id do provedor (sessão do Stripe). Tentado como veio, em maiúsculas e em
 * minúsculas — o E2E costuma chegar em maiúsculas e a referência é hex minúsculo.
 */
export async function localizarJogador({ nick, transacao } = {}) {
  const t = String(transacao ?? '').trim();
  const pedido = String(nick ?? '').trim();
  if (!pedido && !t) throw new Error('informe o nickname ou o identificador da transação');

  if (pedido) {
    const { rows } = await pool.query(`SELECT id, nick FROM players WHERE lower(nick) = lower($1)`, [pedido]);
    if (!rows[0]) throw new Error(`jogador "${pedido}" não encontrado`);
    return { playerId: Number(rows[0].id), nick: rows[0].nick, por: 'nick' };
  }

  if (t.length > 128) throw new Error('identificador longo demais');
  const variantes = [...new Set([t, t.toUpperCase(), t.toLowerCase()])];
  const { rows } = await pool.query(
    `SELECT DISTINCT dp.player_id, p.nick
       FROM diamante_pagamentos dp
       JOIN players p ON p.id = dp.player_id
      WHERE dp.comprovante = ANY($1::text[])
         OR dp.referencia = ANY($1::text[])
         OR dp.provedor_ref = ANY($1::text[])`,
    [variantes],
  );
  if (!rows.length) throw new Error('nenhum pagamento com esse identificador');
  if (rows.length > 1) throw new Error('o identificador corresponde a mais de uma conta — busque pelo nickname');
  return { playerId: Number(rows[0].player_id), nick: rows[0].nick, por: 'transacao' };
}

// ------------------------------------------------------------------- coleta

/**
 * Tudo o que o sistema guarda sobre a conta e que entra no documento. Datas em ISO (UTC).
 *
 * Os campos pessoais saem exatamente como gravados — o CPF decifrado, o nome como o provedor de
 * pagamento devolveu. Quem monta o documento decide o rótulo (e a FONTE) de cada um.
 */
export async function coletarDados(playerId) {
  const id = Number(playerId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('jogador inválido');

  const { rows: base } = await pool.query(
    `SELECT p.id, p.nick, p.created_at, p.last_seen, p.diamonds, p.level, p.vip_ate, p.boosts,
            a.id AS conta_id, a.email, a.provedor, a.email_ok, a.criado_em AS conta_criada,
            a.ultimo_login,
            b.motivo AS ban_motivo, b.criado_em AS ban_em, b.soft AS ban_soft
       FROM players p
       LEFT JOIN accounts a ON lower(a.nick) = lower(p.nick)
       LEFT JOIN account_bans b ON b.account_id = a.id
      WHERE p.id = $1`,
    [id],
  );
  const j = base[0];
  if (!j) throw new Error('jogador não encontrado');
  const contaId = j.conta_id != null ? Number(j.conta_id) : null;

  const [pagamentos, ledger, origens, atividade, desdeOrigens, desdeJogo] = await Promise.all([
    pool.query(
      `SELECT referencia, qtd, centavos, metodo, provedor, provedor_ref, status, comprovante,
              aceite_em, entregue, criado_em, pago_em, tomador_cpf, tomador_nome, tomador_email
         FROM diamante_pagamentos
        WHERE player_id = $1
        ORDER BY criado_em, referencia`,
      [id],
    ),
    pool.query(
      `SELECT id, delta, saldo_apos, motivo, ref, nota, criado_em
         FROM diamante_ledger
        WHERE player_id = $1
        ORDER BY id`,
      [id],
    ),
    contaId
      ? pool.query(
          `SELECT ip, dispositivo, evento, vezes, primeiro_em, ultimo_em
             FROM conta_origens
            WHERE conta_id = $1
            ORDER BY primeiro_em
            LIMIT 200`,
          [contaId],
        )
      : { rows: [] },
    pool.query(
      `SELECT to_char(criado_em AT TIME ZONE '${FUSO}', 'YYYY-MM-DD') AS dia,
              categoria, acao, count(*)::int AS n,
              min(criado_em) AS primeiro, max(criado_em) AS ultimo
         FROM player_gameplay_log
        WHERE player_id = $1
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3`,
      [id],
    ),
    pool.query(`SELECT primeiro_em FROM conta_origens ORDER BY id LIMIT 1`),
    pool.query(`SELECT criado_em FROM player_gameplay_log ORDER BY id LIMIT 1`),
  ]);

  return {
    jogador: {
      id,
      nick: j.nick,
      criadoEm: iso(j.created_at),
      ultimaAtividade: iso(j.last_seen),
      diamantes: n(j.diamonds),
      nivel: n(j.level),
      vipAte: n(j.vip_ate) || null,
      boosts: j.boosts ?? {},
    },
    conta: contaId
      ? {
          id: contaId,
          email: j.email ?? null,
          provedor: j.provedor ?? null,
          emailConfirmado: !!j.email_ok,
          criadaEm: iso(j.conta_criada),
          ultimoLogin: iso(j.ultimo_login),
          ban: j.ban_em ? { motivo: j.ban_motivo ?? null, em: iso(j.ban_em), soft: !!j.ban_soft } : null,
        }
      : null,
    pagamentos: pagamentos.rows.map((r) => ({
      referencia: r.referencia,
      qtd: n(r.qtd),
      centavos: n(r.centavos),
      metodo: r.metodo,
      provedor: r.provedor,
      provedorRef: r.provedor_ref ?? null,
      status: r.status,
      comprovante: r.comprovante ?? null,
      aceiteEm: iso(r.aceite_em),
      entregue: !!r.entregue,
      criadoEm: iso(r.criado_em),
      pagoEm: iso(r.pago_em),
      // `decifrar` devolve texto puro como veio (linhas antigas) e `null` se a chave faltar.
      cpf: r.tomador_cpf ? decifrar(r.tomador_cpf) : null,
      cpfIlegivel: !!r.tomador_cpf && !decifrar(r.tomador_cpf),
      nomePagador: r.tomador_nome ?? null,
      emailInformado: r.tomador_email ?? null,
    })),
    ledger: ledger.rows.map((r) => ({
      id: Number(r.id),
      delta: Number(r.delta),
      saldoApos: Number(r.saldo_apos),
      motivo: r.motivo,
      ref: r.ref ?? null,
      nota: r.nota ?? null,
      em: iso(r.criado_em),
    })),
    origens: origens.rows.map((r) => ({
      ip: r.ip ?? null,
      dispositivo: r.dispositivo || null,
      evento: r.evento,
      vezes: n(r.vezes),
      primeiroEm: iso(r.primeiro_em),
      ultimoEm: iso(r.ultimo_em),
    })),
    atividade: atividade.rows.map((r) => ({
      dia: r.dia,
      categoria: r.categoria,
      acao: r.acao,
      n: r.n,
      primeiro: iso(r.primeiro),
      ultimo: iso(r.ultimo),
    })),
    cobertura: {
      origensDesde: iso(desdeOrigens.rows[0]?.primeiro_em),
      atividadeDesde: iso(desdeJogo.rows[0]?.criado_em),
    },
  };
}

// ------------------------------------------------------------------- registro

/** Reserva o número do próximo documento. O código carrega o ano da emissão. */
export async function reservarCodigo(emitidoEm) {
  const { rows } = await pool.query(`SELECT nextval('med_documentos_seq')::bigint AS id`);
  const id = Number(rows[0].id);
  const ano = new Date(new Date(emitidoEm).getTime() - 3 * 3600_000).getUTCFullYear();
  return { id, codigo: `MED-${ano}-${String(id).padStart(6, '0')}` };
}

export async function registrarEmissao({
  id, codigo, playerId, contaId, nick, porEmail, emitidoEm, hashConteudo, contexto, observacao, contagens,
}) {
  await pool.query(
    `INSERT INTO med_documentos
       (id, codigo, player_id, conta_id, nick, por_email, emitido_em, hash_conteudo,
        contexto, observacao, contagens)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, codigo, playerId, contaId ?? null, nick, porEmail, emitidoEm, hashConteudo,
      JSON.stringify(contexto ?? {}), observacao || null, JSON.stringify(contagens ?? {})],
  );
}

const deEmissao = (r) => ({
  id: Number(r.id),
  codigo: r.codigo,
  playerId: Number(r.player_id),
  contaId: r.conta_id != null ? Number(r.conta_id) : null,
  nick: r.nick,
  porEmail: r.por_email,
  emitidoEm: iso(r.emitido_em),
  hashConteudo: r.hash_conteudo,
  hashPdf: r.hash_pdf ?? null,
  contexto: r.contexto ?? {},
  observacao: r.observacao ?? null,
  contagens: r.contagens ?? {},
});

export async function emissaoPorCodigo(codigo) {
  const c = String(codigo ?? '').trim().toUpperCase();
  if (!/^MED-\d{4}-\d{6,}$/.test(c)) return null;
  const { rows } = await pool.query(`SELECT * FROM med_documentos WHERE codigo = $1`, [c]);
  return rows[0] ? deEmissao(rows[0]) : null;
}

/** Carimba o hash do arquivo na PRIMEIRA geração. Um hash já gravado nunca é trocado. */
export async function carimbarHashPdf(codigo, hashPdf) {
  const { rows } = await pool.query(
    `UPDATE med_documentos SET hash_pdf = COALESCE(hash_pdf, $2)
      WHERE codigo = $1
      RETURNING hash_pdf`,
    [codigo, hashPdf],
  );
  return rows[0]?.hash_pdf ?? null;
}

export async function listarEmissoes(limite = 30) {
  const lim = Math.min(Math.max(Number(limite) || 30, 1), 200);
  const { rows } = await pool.query(
    `SELECT * FROM med_documentos ORDER BY emitido_em DESC, id DESC LIMIT $1`,
    [lim],
  );
  // A observação interna fica fora da listagem: ela aparece só ao abrir aquele documento.
  return rows.map((r) => {
    const e = deEmissao(r);
    delete e.observacao;
    return e;
  });
}

/**
 * Uma linha no log de acesso. AGUARDADA de propósito: se o registro de quem viu o dado não
 * puder ser gravado, o dado não sai — auditoria que falha em silêncio não é auditoria.
 */
export async function registrarAcesso({ acao, codigo = null, playerId = null, nick = null, porEmail, detalhe = null }) {
  await pool.query(
    `INSERT INTO med_documentos_log (acao, codigo, player_id, nick, por_email, detalhe)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [acao, codigo, playerId, nick, porEmail, detalhe ? String(detalhe).slice(0, 500) : null],
  );
}

export async function listarAcessos(limite = 40) {
  const lim = Math.min(Math.max(Number(limite) || 40, 1), 200);
  const { rows } = await pool.query(
    `SELECT acao, codigo, player_id, nick, por_email, detalhe, em
       FROM med_documentos_log ORDER BY id DESC LIMIT $1`,
    [lim],
  );
  return rows.map((r) => ({
    acao: r.acao,
    codigo: r.codigo,
    playerId: r.player_id != null ? Number(r.player_id) : null,
    nick: r.nick,
    porEmail: r.por_email,
    detalhe: r.detalhe,
    em: iso(r.em),
  }));
}
