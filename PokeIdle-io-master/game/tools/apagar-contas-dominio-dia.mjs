#!/usr/bin/env node
/**
 * Apaga contas de um domínio criadas num dia (uso admin, irreversível).
 *
 *   node tools/apagar-contas-dominio-dia.mjs 2026-08-18 emalupe.com --dry-run
 *   node tools/apagar-contas-dominio-dia.mjs 2026-08-18 emalupe.com
 *
 * O dia é interpretado em America/Sao_Paulo (horário de Brasília).
 */
import pg from 'pg';
import { config } from '../src/server/config.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dryRun = process.argv.includes('--dry-run');
const dia = args[0] ?? '2026-08-18';
const dominio = (args[1] ?? 'emalupe.com').toLowerCase().replace(/^@/, '');

const pool = new pg.Pool({ connectionString: config.databaseUrl });

const { rows } = await pool.query(
  `SELECT id, nick, email, criado_em, provedor
     FROM accounts
    WHERE lower(email) LIKE $1
      AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = $2::date
    ORDER BY criado_em`,
  [`%@${dominio}`, dia],
);

console.log(`Contas @${dominio} em ${dia} (Brasília): ${rows.length}`);
for (const c of rows) {
  console.log(`  #${c.id}  ${c.nick}  ${c.email}  ${c.criado_em.toISOString()}  ${c.provedor}`);
}

if (dryRun || !rows.length) {
  await pool.end();
  process.exit(0);
}

/** Mesma limpeza de `executarExclusaoConta`, sem depender de Redis/sim online. */
async function apagarContaDb(conta) {
  const { rows: pj } = await pool.query(
    `SELECT id FROM players WHERE lower(nick) = lower($1)`,
    [conta.nick],
  );
  const playerId = pj[0]?.id ?? null;
  const nickCanon = conta.nick;

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
}

let ok = 0;
for (const c of rows) {
  try {
    await apagarContaDb(c);
    console.log(`  apagada: ${c.nick} (${c.email})`);
    ok++;
  } catch (err) {
    console.error(`  falhou ${c.nick}:`, err.message);
  }
}

console.log(`Pronto: ${ok}/${rows.length} apagadas.`);
await pool.end();
