#!/usr/bin/env node
// Credita Fragmentos de Chave na bolsa — uso dev/admin.
//   node tools/dar-fragmento-chave.mjs fasi
//   node tools/dar-fragmento-chave.mjs fasi 10
import { pool } from '../src/server/db.mjs';
import { conectarBus, desconectarJogador, gatewayDoJogador } from '../src/server/bus.mjs';
import { FRAGMENTO_CHAVE_ID } from '../src/server/game/itens-nossos.mjs';

const args = process.argv.slice(2);
const nick = args[0];
const qtd = Math.max(1, Math.floor(Number(args[1] ?? 10)));

if (!nick) {
  console.error('uso: node tools/dar-fragmento-chave.mjs <nick> [qtd]');
  process.exit(1);
}

const { rows } = await pool.query(
  `SELECT id, nick FROM players WHERE lower(nick) = lower($1)`,
  [nick],
);
if (!rows[0]) {
  console.error('jogador', nick, 'não encontrado');
  process.exit(1);
}

const playerId = Number(rows[0].id);
const canon = rows[0].nick;
const chave = canon.toLowerCase();
const itemKey = String(FRAGMENTO_CHAVE_ID);

await conectarBus();
const online = await gatewayDoJogador(chave);
if (online) {
  console.log(`${canon} está online — desconectando para gravar sem o flush sobrescrever…`);
  await desconectarJogador(chave, { k: 'aviso', msg: 'Reconecte — você recebeu fragmentos de chave.' });
  await new Promise((r) => setTimeout(r, 3500));
}

const { rows: upd } = await pool.query(
  `UPDATE players
      SET items = jsonb_set(
            COALESCE(items, '{}'::jsonb),
            ARRAY[$2::text],
            to_jsonb(COALESCE((items->>$2)::int, 0) + $3::int)
          ),
          frag_chave_total = COALESCE(frag_chave_total, 0) + $3::int,
          last_seen = now()
    WHERE id = $1
  RETURNING items->>$2 AS qtd, frag_chave_total`,
  [playerId, itemKey, qtd],
);

console.log(`${canon}: +${qtd} Fragmento(s) de Chave → bolsa ${upd[0].qtd} · total vitalício ${upd[0].frag_chave_total}`);
await pool.end();
