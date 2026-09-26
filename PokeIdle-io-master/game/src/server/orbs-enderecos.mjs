// Um endereço de depósito por jogador.
//
// Substitui o memo. O jogador vê um endereço que é só dele e manda USDT de onde quiser —
// Phantom, Binance, da carteira de um amigo. Quem recebeu já diz de quem é, então não
// existe campo de texto para errar. Ver o cabeçalho de `derivacao.mjs`.
//
// ### O índice é o próprio id do jogador
//
// Nada de contador à parte. `player_id` já é único e monotônico, então usá-lo como índice
// de derivação dá unicidade de graça e elimina a corrida de "dois jogadores pegando o
// próximo índice ao mesmo tempo". Também torna a tabela DESCARTÁVEL: com a seed mestra e o
// id, o endereço se recalcula do zero. Perder esta tabela não perde dinheiro.
//
// ### Por que existe uma janela de observação
//
// Varrer todos os endereços a cada 30 s não escala: com dez mil jogadores são dez mil
// chamadas de RPC por passagem, e provedor cobra por isso. Mas ninguém deposita sem abrir
// a tela de depósito antes — então abrir a tela ARMA o endereço por algumas horas, e o
// watcher só olha os armados. O conjunto real fica na casa das dezenas.
//
// Quem depositar fora da janela não perde nada: o dinheiro está no endereço dele, e a
// próxima vez que abrir a tela rearma e a varredura acha. Só demora mais.
import { pool } from './db.mjs';
import { enderecoDoJogador, lerSeedMestra } from './derivacao.mjs';

/** Quanto tempo um endereço fica sendo observado depois de o jogador abrir a tela. */
export const JANELA_MS = 6 * 3600_000;

/**
 * Teto do índice de derivação.
 *
 * Derivação endurecida usa 31 bits. Um `player_id` acima disso geraria um índice truncado
 * — dois jogadores no mesmo endereço, que é o pior defeito possível aqui. Preferimos
 * recusar e gritar.
 */
const INDICE_MAX = 0x7fffffff;

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orb_enderecos (
      player_id    BIGINT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      indice       BIGINT NOT NULL UNIQUE,
      endereco     TEXT   NOT NULL UNIQUE,
      -- Até quando o watcher observa este endereço. Ver a nota sobre a janela, no topo.
      observar_ate TIMESTAMPTZ,
      -- Cursor da varredura, por endereço: a última assinatura já processada.
      ultima_assinatura TEXT,
      criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_orb_end_observados ON orb_enderecos(observar_ate)
      WHERE observar_ate IS NOT NULL`,
  );
}

let seedCache = null;
const seed = () => (seedCache ??= lerSeedMestra(process.env.ORB_SEED_DEPOSITOS));

/** O endereço está configurado? A tela precisa saber para não prometer o que não existe. */
export const temSeed = () => !!String(process.env.ORB_SEED_DEPOSITOS ?? '').trim();

/**
 * O endereço de depósito do jogador, criando o registro na primeira vez.
 *
 * `armar` liga a janela de observação — é o que a tela de depósito passa. Consultas
 * internas (auditoria, suporte) chamam sem armar, para não sujar a fila do watcher.
 */
export async function enderecoDe(playerId, { armar = false } = {}) {
  const indice = Number(playerId);
  if (!Number.isInteger(indice) || indice < 0 || indice > INDICE_MAX) {
    throw new Error(`player_id ${playerId} fora da faixa de derivação`);
  }
  const endereco = enderecoDoJogador(seed(), indice);

  // `ON CONFLICT` cobre o registro que já existe e a corrida de dois logins. O endereço é
  // recalculado toda vez em vez de lido do banco: a seed é a verdade, a linha é cache.
  await pool.query(
    `INSERT INTO orb_enderecos (player_id, indice, endereco, observar_ate)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (player_id) DO UPDATE
       SET observar_ate = CASE WHEN $4 IS NULL THEN orb_enderecos.observar_ate ELSE $4 END`,
    [playerId, indice, endereco, armar ? new Date(Date.now() + JANELA_MS) : null],
  );
  return endereco;
}

/** Os endereços que o watcher deve olhar agora, com o cursor de cada um. */
export async function armados(limite = 200) {
  const { rows } = await pool.query(
    `SELECT player_id, endereco, ultima_assinatura FROM orb_enderecos
      WHERE observar_ate IS NOT NULL AND observar_ate > now()
      ORDER BY observar_ate DESC LIMIT $1`,
    [limite],
  );
  return rows.map((r) => ({
    playerId: Number(r.player_id),
    endereco: r.endereco,
    cursor: r.ultima_assinatura,
  }));
}

export const gravarCursor = (endereco, assinatura) =>
  pool.query(`UPDATE orb_enderecos SET ultima_assinatura = $2 WHERE endereco = $1`, [endereco, assinatura]);

/** De quem é este endereço. É o que substitui `jogadorPorReferencia`. */
export async function jogadorPorEndereco(endereco) {
  const { rows } = await pool.query(`SELECT player_id FROM orb_enderecos WHERE endereco = $1`, [endereco]);
  return rows.length ? Number(rows[0].player_id) : null;
}

/**
 * Endereços de quem já tem depósito no ledger — a varredura olha só estes.
 *
 * Endereço vazio (só abriu a tela) não entra: eram centenas de chamadas RPC por dia,
 * estouravam o rate limit do provedor gratuito, e a varredura recolhia zero. Quem de
 * fato mandou USDT está em `orb_depositos`.
 *
 * `desde` restringe a depósitos a partir daquela data (ex.: janela do dia no cron).
 * Sem `desde`, inclui todo o histórico — use na primeira passagem ou com `--todos`.
 */
export async function comDepositoNoLedger({ limite = 500, desde = null } = {}) {
  const { rows } = await pool.query(
    `SELECT e.player_id, e.indice, e.endereco
       FROM orb_enderecos e
      WHERE EXISTS (
        SELECT 1 FROM orb_depositos d
         WHERE d.player_id = e.player_id
           AND d.usdt > 0
           AND ($2::timestamptz IS NULL OR d.criado_em >= $2)
      )
      ORDER BY e.player_id
      LIMIT $1`,
    [limite, desde],
  );
  return rows.map((r) => ({ playerId: Number(r.player_id), indice: Number(r.indice), endereco: r.endereco }));
}

/**
 * Todos os endereços já entregues a alguém — legado; a varredura diária não usa mais.
 */
export async function todos(limite = 5000) {
  const { rows } = await pool.query(
    `SELECT player_id, indice, endereco FROM orb_enderecos ORDER BY player_id LIMIT $1`,
    [limite],
  );
  return rows.map((r) => ({ playerId: Number(r.player_id), indice: Number(r.indice), endereco: r.endereco }));
}
