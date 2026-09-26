/**
 * Concede as 4 Beta Outfits (looktypes da loja beta) para um jogador.
 *
 *   node tools/dar-outfits-beta-local.mjs <nick>
 *
 * Tira o jogador da memória do sim (`admin.ban`) antes de gravar — senão a reconexão
 * automática (~1,5 s) ou o flush periódico (~5 s) sobrescreve o `owned_outfits`.
 */
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { conectarBus, desconectarJogador, enviarParaSim } from '../src/server/bus.mjs';
import { LOOKTYPES_OUTFIT_BETA } from '../src/server/game/loja.mjs';

const nick = process.argv[2];

if (!nick) {
  console.error('Uso: node tools/dar-outfits-beta-local.mjs <nick>');
  process.exit(1);
}

const betaOutfits = [...LOOKTYPES_OUTFIT_BETA].sort((a, b) => a - b);
const chave = nick.toLowerCase();

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

await conectarBus();

// Igual set-nivel-local: expulsa da memória do sim SEM flush do estado velho.
enviarParaSim(chave, { t: 'admin.ban', playerId: chave });
await desconectarJogador(chave, { k: 'aviso', msg: 'Reconecte — Beta Outfits atualizadas.' });
await new Promise((r) => setTimeout(r, 600));

const { rows: atual } = await pool.query(
  'SELECT owned_outfits FROM players WHERE id = $1',
  [playerId],
);
const owned = Array.isArray(atual[0]?.owned_outfits)
  ? atual[0].owned_outfits.map(Number).filter(Number.isFinite)
  : [];
const antes = new Set(owned);
for (const lt of betaOutfits) owned.push(lt);
const depois = [...new Set(owned)].sort((a, b) => a - b);
const novas = betaOutfits.filter((lt) => !antes.has(lt));

const { rows: ok } = await pool.query(
  'UPDATE players SET owned_outfits = $2::jsonb, last_seen = now() WHERE id = $1 RETURNING owned_outfits',
  [playerId, JSON.stringify(depois)],
);

console.log(`✓ ${canon} (id ${playerId})`);
console.log(`  Beta Outfits: ${betaOutfits.join(', ')}`);
if (novas.length) console.log(`  Novas: ${novas.join(', ')}`);
else console.log('  (já tinha todas)');
console.log(`  Gravado no banco: ${JSON.stringify(ok[0]?.owned_outfits ?? depois)}`);
console.log('  Relogue no jogo (F5) para ver no Armário / Loja → Outfits.');
await pool.end();
