#!/usr/bin/env node
// Credita Fragmentos de Shiny Stone na bolsa — uso dev/admin.
//   node tools/dar-fragmento-shiny.mjs fasi
//   node tools/dar-fragmento-shiny.mjs fasi 400
import { pool } from '../src/server/db.mjs';
import { conectarBus, desconectarJogador, gatewayDoJogador } from '../src/server/bus.mjs';
import { FRAGMENTO_SHINY_ID } from '../src/server/game/itens-nossos.mjs';

const args = process.argv.slice(2);
const nick = args[0];
const qtd = Math.max(1, Math.floor(Number(args[1] ?? 10)));

if (!nick) {
  console.error('uso: node tools/dar-fragmento-shiny.mjs <nick> [qtd]');
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
const itemKey = String(FRAGMENTO_SHINY_ID);

await conectarBus();
const online = await gatewayDoJogador(chave);
if (online) {
  console.log(`${canon} está online — desconectando para gravar sem o flush sobrescrever…`);
  await desconectarJogador(chave, { k: 'aviso', msg: 'Reconecte — você recebeu fragmentos de Shiny Stone.' });
  await new Promise((r) => setTimeout(r, 3500));
}

const { rows: upd } = await pool.query(
  `UPDATE players
      SET items = jsonb_set(
            COALESCE(items, '{}'::jsonb),
            ARRAY[$2::text],
            to_jsonb(COALESCE((items->>$2)::int, 0) + $3::int)
          ),
          last_seen = now()
    WHERE id = $1
  RETURNING items->>$2 AS qtd`,
  [playerId, itemKey, qtd],
);

console.log(`${canon}: +${qtd} Fragmento(s) de Shiny Stone → bolsa ${upd[0].qtd}`);
await pool.end();
