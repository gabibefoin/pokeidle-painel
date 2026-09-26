/**
 * Uso local: node tools/dar-casa-local.mjs <nick> [raridade]
 * raridade: comum | incomum | rara | mitica | lendaria (padrão: comum)
 *
 * Se o jogador estiver online, desconecta antes de gravar — senão o flush do sim
 * (write-behind a cada ~5 s) sobrescreve o item e a casa some no F5.
 */
import { pool } from '../src/server/db.mjs';
import { conectarBus, desconectarJogador, gatewayDoJogador } from '../src/server/bus.mjs';
import { CASA_POR_RARIDADE } from '../src/server/game/itens-nossos.mjs';
import { RARIDADES_CASA } from '../src/shared/casas.mjs';

const nick = process.argv[2];
const raridade = (process.argv[3] ?? 'comum').toLowerCase();
const itemId = CASA_POR_RARIDADE[raridade];

if (!nick) {
  console.error('Uso: node tools/dar-casa-local.mjs <nick> [raridade]');
  console.error(`Raridades: ${RARIDADES_CASA.map((r) => r.id).join(', ')}`);
  process.exit(1);
}
if (!itemId) {
  console.error('Raridade inválida. Use:', RARIDADES_CASA.map((r) => r.id).join(', '));
  process.exit(1);
}

const { rows } = await pool.query(
  'SELECT id, nick FROM players WHERE lower(nick) = lower($1)',
  [nick],
);
if (!rows.length) {
  console.error(`Jogador "${nick}" não encontrado.`);
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
            to_jsonb(COALESCE((items->>$2)::int, 0) + 1)
          ),
          last_seen = now()
    WHERE id = $1
  RETURNING items->>$2 AS qtd`,
  [playerId, String(itemId)],
);

console.log(`✓ ${canon} (id ${playerId}) recebeu Casa ${raridade} (item ${itemId}). Total na bolsa: ${upd[0].qtd}.`);
if (online) console.log('  Reconecte no jogo (F5).');
else console.log('  Recarregue a página (F5) se estiver online.');
await pool.end();
