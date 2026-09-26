#!/usr/bin/env node
// Credita TM Disk Piece e/ou AoE TM Disk Piece — uso dev/local.
//   node tools/dar-tm-piece-local.mjs fasi123 10
//   node tools/dar-tm-piece-local.mjs fasi123 10 elemental
//   node tools/dar-tm-piece-local.mjs fasi123 10 aoe
//   node tools/dar-tm-piece-local.mjs fasi123 10 ambos
//
// Online: credita na memória do sim (`admin.items`) — aparece na hora, sem F5.
// Offline: grava direto no Postgres.
//
// IMPORTANTE: reinicie o `npm start` depois de puxar alterações no sim.mjs que
// adicionam o handler `admin.items`.
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { conectarBus, gatewayDoJogador, enviarParaSim } from '../src/server/bus.mjs';
import { PIECE_ELEMENTAL, PIECE_AOE } from '../src/server/game/tm.mjs';
import { itens } from '../src/server/content.mjs';

const nick = process.argv[2];
const qtd = Math.max(1, Math.floor(Number(process.argv[3] ?? 1)));
const alvo = (process.argv[4] ?? 'ambos').toLowerCase();

const pecas = alvo === 'elemental'
  ? [{ id: PIECE_ELEMENTAL, rotulo: 'TM Disk Piece' }]
  : alvo === 'aoe'
    ? [{ id: PIECE_AOE, rotulo: 'AoE TM Disk Piece' }]
    : alvo === 'ambos'
      ? [
          { id: PIECE_ELEMENTAL, rotulo: 'TM Disk Piece' },
          { id: PIECE_AOE, rotulo: 'AoE TM Disk Piece' },
        ]
      : null;

if (!nick || !pecas) {
  console.error('Uso: node tools/dar-tm-piece-local.mjs <nick> [qtd] [elemental|aoe|ambos]');
  process.exit(1);
}

const { rows } = await pool.query(
  'SELECT id, nick FROM players WHERE lower(nick) = lower($1)',
  [nick],
);
if (!rows[0]) {
  console.error(`Jogador "${nick}" não encontrado.`);
  process.exit(1);
}

const playerId = Number(rows[0].id);
const canon = rows[0].nick;
const chave = canon.toLowerCase();
const payload = Object.fromEntries(pecas.map((p) => [p.id, qtd]));

await conectarBus();
const online = await gatewayDoJogador(chave);

if (online) {
  console.log(`${canon} está online — creditando na memória do sim…`);
  enviarParaSim(chave, { t: 'admin.items', playerId: chave, items: payload });
  await new Promise((r) => setTimeout(r, 800));
  for (const p of pecas) {
    const nome = itens.get(p.id)?.name ?? p.rotulo;
    console.log(`  ✓ +${qtd} ${nome}`);
  }
  console.log('Deve aparecer na bolsa e no Professor Carvalho na hora.');
  console.log('Se não aparecer, reinicie o `npm start` (handler admin.items) e rode de novo.');
} else {
  for (const p of pecas) {
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
      [playerId, String(p.id), qtd],
    );
    const nome = itens.get(p.id)?.name ?? p.rotulo;
    console.log(`${canon}: +${qtd} ${nome} → bolsa ${upd[0].qtd}`);
  }
  console.log('Recarregue a página (F5) se estiver online.');
}

await pool.end();
