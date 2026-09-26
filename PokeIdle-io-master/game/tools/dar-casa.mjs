#!/usr/bin/env node
// Credita uma Casa na bolsa de um jogador — uso dev/admin.
//   node tools/dar-casa.mjs fodedor lendaria
//   node tools/dar-casa.mjs fasi comum
import { pool } from '../src/server/db.mjs';
import { conectarBus, desconectarJogador, gatewayDoJogador } from '../src/server/bus.mjs';
import { CASA_POR_RARIDADE } from '../src/server/game/itens-nossos.mjs';
import { RARIDADES_CASA } from '../src/shared/casas.mjs';

const args = process.argv.slice(2);
const nick = args[0];
const raridade = args[1] ?? 'lendaria';
const qtd = Math.max(1, Math.floor(Number(args[2] ?? 1)));

if (!nick) {
  console.error('uso: node tools/dar-casa.mjs <nick> [raridade] [qtd]');
  console.error(`raridades: ${RARIDADES_CASA.map((r) => r.id).join(', ')}`);
  process.exit(1);
}

const itemId = CASA_POR_RARIDADE[raridade];
if (!itemId) {
  console.error('raridade inválida:', raridade);
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

await conectarBus();
const online = await gatewayDoJogador(chave);
if (online) {
  console.log(`${canon} está online — desconectando para gravar a casa sem o flush sobrescrever…`);
  await desconectarJogador(chave, { k: 'aviso', msg: 'Reconecte — você recebeu uma casa.' });
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
  [playerId, String(itemId), qtd],
);

console.log(`OK: +${qtd} Casa ${raridade} (item ${itemId}) → ${canon} (total: ${upd[0].qtd})`);
if (online) console.log('Peça para reconectar no jogo.');
await pool.end();
process.exit(0);
