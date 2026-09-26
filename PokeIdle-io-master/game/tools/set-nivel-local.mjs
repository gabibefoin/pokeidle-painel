#!/usr/bin/env node
/**
 * Ajuste local de nível/XP — dev only.
 * Uso: node tools/set-nivel-local.mjs <nick> <nivel>
 */
import { pool } from '../src/server/db.mjs';
import { enviarParaSim, desconectarJogador } from '../src/server/bus.mjs';
import { xpTotalParaNivel, nivelPeloXp } from '../src/server/content.mjs';

const nick = process.argv[2];
const nivel = Math.floor(Number(process.argv[3]));
if (!nick || !Number.isFinite(nivel) || nivel < 1) {
  console.error('Uso: node tools/set-nivel-local.mjs <nick> <nivel>');
  process.exit(1);
}

const xp = xpTotalParaNivel(nivel);
const chave = nick.toLowerCase();

const { rows } = await pool.query(
  `SELECT id, nick, level, xp FROM players WHERE lower(nick) = lower($1)`,
  [nick],
);
if (!rows[0]) {
  console.error(`Jogador "${nick}" não encontrado.`);
  process.exit(1);
}

// Tira da memória do sim para o flush não reverter o banco.
enviarParaSim(chave, { t: 'admin.ban', playerId: chave });
await desconectarJogador(chave, { k: 'aviso', msg: 'Sessão reiniciada (ajuste de nível local).' });

await pool.query(`UPDATE players SET level = $2, xp = $3, last_seen = now() WHERE id = $1`, [
  rows[0].id,
  nivel,
  String(xp),
]);

console.log(
  `${rows[0].nick}: nv ${rows[0].level} → ${nivel} (xp ${xp}, check nv ${nivelPeloXp(Number(xp))})`,
);
console.log('Relogue no jogo para carregar o nível novo.');
await pool.end();
process.exit(0);
