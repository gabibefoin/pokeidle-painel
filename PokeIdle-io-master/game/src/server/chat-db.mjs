// Histórico dos chats públicos (Mundo e Guild) — fan-out continua no Redis; aqui só grava o
// que já passou para quem reconectar ou abrir a conversa da guild na lista de amigos.
//
// Retenção curta no Mundo (30 min) e igual à DM na Guild (7 dias). O DELETE roda no shard 0,
// como as DMs — uma consulta por hora, índice por tempo, volume baixo.
import { pool } from './db.mjs';

const RETENCAO_MUNDO = '30 minutes';
const RETENCAO_GUILD = '7 days';
const LIMITE_HISTORICO = 200;

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_publico_mensagens (
      id         UUID PRIMARY KEY,
      canal      TEXT NOT NULL CHECK (canal IN ('mundo', 'guild')),
      guild_id   BIGINT,
      de_nick    TEXT NOT NULL,
      texto      TEXT NOT NULL DEFAULT '',
      idioma     TEXT NOT NULL DEFAULT 'pt',
      cargo      TEXT,
      nivel      INT,
      ts         BIGINT NOT NULL,
      extra      JSONB NOT NULL DEFAULT '{}',
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (canal <> 'guild' OR guild_id IS NOT NULL),
      CHECK (canal <> 'mundo' OR guild_id IS NULL)
    )`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_publico_guild
      ON chat_publico_mensagens(guild_id, criado_em DESC)
      WHERE canal = 'guild'`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_publico_mundo
      ON chat_publico_mensagens(criado_em DESC)
      WHERE canal = 'mundo'`);
}

const chavesExtra = new Set([
  'fundador', 'pkShare', 'pvpEntrada', 'shinyCaptura', 'dropLendario', 'conviteResgate',
  'nickDestaque', 'guildId',
  // A TAG vai para o histórico junto com a fala. É um retrato, como o `cargo` e o `fundador`
  // ao lado: recarregar a página e ver as linhas de ontem sem tag pareceria perda de dado, e
  // reescrevê-las com a tag de HOJE mentiria sobre quem a pessoa era quando falou.
  'guildTag', 'guildTagCor',
]);

function extrairExtra(msg) {
  const extra = {};
  for (const k of chavesExtra) {
    if (msg[k] != null) extra[k] = msg[k];
  }
  return extra;
}

/** Reconstrói o pacote que o cliente já entende como `SERVIDOR.CHAT`. */
function linhaDe(row) {
  const extra = row.extra && typeof row.extra === 'object' ? row.extra : {};
  return {
    id: row.id,
    canal: row.canal,
    idioma: row.idioma,
    de: row.de_nick,
    texto: row.texto ?? '',
    ts: Number(row.ts),
    cargo: row.cargo ?? undefined,
    nivel: row.nivel ?? undefined,
    guildId: row.guild_id ?? extra.guildId ?? undefined,
    ...extra,
  };
}

/** Grava uma mensagem já publicada no fan-out. Falha silenciosa — o chat ao vivo não espera. */
export async function gravar(msg) {
  const id = String(msg.id ?? '').trim();
  const canal = msg.canal === 'guild' ? 'guild' : 'mundo';
  if (!id) return;
  const guildId = canal === 'guild' ? Number(msg.guildId) || null : null;
  if (canal === 'guild' && !guildId) return;
  await pool.query(
    `INSERT INTO chat_publico_mensagens
       (id, canal, guild_id, de_nick, texto, idioma, cargo, nivel, ts, extra)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      canal,
      guildId,
      String(msg.de ?? '').slice(0, 64) || '?',
      String(msg.texto ?? '').slice(0, 500),
      String(msg.idioma ?? 'pt').slice(0, 8),
      msg.cargo ?? null,
      msg.nivel == null ? null : Math.floor(Number(msg.nivel)),
      Math.floor(Number(msg.ts) || Date.now()),
      JSON.stringify(extrairExtra(msg)),
    ],
  );
}

export async function apagar(id) {
  const chave = String(id ?? '').trim();
  if (!chave) return 0;
  const { rowCount } = await pool.query(
    `DELETE FROM chat_publico_mensagens WHERE id = $1`,
    [chave],
  );
  return rowCount;
}

export async function historicoMundo(limite = LIMITE_HISTORICO) {
  const { rows } = await pool.query(
    `SELECT id, canal, guild_id, de_nick, texto, idioma, cargo, nivel, ts, extra
       FROM chat_publico_mensagens
      WHERE canal = 'mundo'
        AND criado_em > now() - interval '${RETENCAO_MUNDO}'
      ORDER BY criado_em DESC, id DESC
      LIMIT $1`,
    [Math.min(500, Math.max(1, limite))],
  );
  return rows.map(linhaDe).reverse();
}

export async function historicoGuild(guildId, limite = LIMITE_HISTORICO) {
  const gid = Number(guildId);
  if (!gid) return [];
  const { rows } = await pool.query(
    `SELECT id, canal, guild_id, de_nick, texto, idioma, cargo, nivel, ts, extra
       FROM chat_publico_mensagens
      WHERE canal = 'guild' AND guild_id = $1
        AND criado_em > now() - interval '${RETENCAO_GUILD}'
      ORDER BY criado_em DESC, id DESC
      LIMIT $2`,
    [gid, Math.min(500, Math.max(1, limite))],
  );
  return rows.map(linhaDe).reverse();
}

export async function limparAntigas() {
  const [mundo, guild] = await Promise.all([
    pool.query(
      `DELETE FROM chat_publico_mensagens
        WHERE canal = 'mundo' AND criado_em < now() - interval '${RETENCAO_MUNDO}'`,
    ),
    pool.query(
      `DELETE FROM chat_publico_mensagens
        WHERE canal = 'guild' AND criado_em < now() - interval '${RETENCAO_GUILD}'`,
    ),
  ]);
  return (mundo.rowCount ?? 0) + (guild.rowCount ?? 0);
}
