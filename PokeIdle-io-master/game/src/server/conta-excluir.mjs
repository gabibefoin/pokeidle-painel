// Exclusão permanente de conta — compartilhado entre admin e auto-serviço do jogador.
import { pool } from './db.mjs';
import { enviarParaSim, desconectarJogador } from './bus.mjs';
import { SERVIDOR } from './protocol.mjs';

/** Apaga login, personagem e dados ligados ao nick. Irreversível. */
export async function executarExclusaoConta(conta) {
  const { rows: pj } = await pool.query(
    `SELECT id FROM players WHERE lower(nick) = lower($1)`,
    [conta.nick],
  );
  const playerId = pj[0]?.id ?? null;
  const nickCanon = conta.nick;
  const chave = nickCanon.toLowerCase();

  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    await cli.query(`DELETE FROM affiliate_referrals WHERE referrer_account_id = $1`, [conta.id]);
    if (playerId) {
      await cli.query(
        `DELETE FROM guild_invites WHERE player_id = $1 OR convidado_por = $1`,
        [playerId],
      );
      await cli.query(`DELETE FROM guilds WHERE owner_id = $1`, [playerId]);
      await cli.query(`DELETE FROM players WHERE id = $1`, [playerId]);
    }
    await cli.query(`DELETE FROM chat_cargos WHERE lower(nick) = lower($1)`, [nickCanon]);
    await cli.query(`DELETE FROM accounts WHERE id = $1`, [conta.id]);
    await cli.query('COMMIT');
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }

  enviarParaSim(chave, { t: 'admin.ban', playerId: chave });
  await desconectarJogador(chave, {
    t: SERVIDOR.ERRO,
    chave: 'auth.contaExcluida',
    msg: 'Conta excluída.',
  });

  return { ok: true, nick: nickCanon, email: conta.email ?? null, apagada: true };
}
