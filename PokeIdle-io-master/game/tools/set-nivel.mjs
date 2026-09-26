#!/usr/bin/env node
// Uso dev: node tools/set-nivel.mjs fasi 100000
import { pool } from '../src/server/db.mjs';
import { xpTotalParaNivel } from '../src/server/content.mjs';

const nick = process.argv[2] ?? 'fasi';
const level = Number(process.argv[3] ?? 100000);
if (!Number.isFinite(level) || level < 1) {
  console.error('nível inválido');
  process.exit(1);
}

const xp = xpTotalParaNivel(level);
const { rows } = await pool.query(
  'SELECT id, nick, level FROM players WHERE lower(nick)=lower($1)',
  [nick],
);
if (!rows[0]) {
  console.error('jogador', nick, 'não encontrado');
  process.exit(1);
}

await pool.query('UPDATE players SET level=$1, xp=$2 WHERE id=$3', [level, xp, rows[0].id]);
console.log(`OK: ${rows[0].nick} Nv ${rows[0].level} → ${level} (xp=${xp})`);
console.log('Reconecte no jogo para ver as áreas liberadas.');
await pool.end();
