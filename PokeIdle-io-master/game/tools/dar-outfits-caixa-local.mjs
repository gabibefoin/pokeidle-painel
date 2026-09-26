/**
 * Uso local: node tools/dar-outfits-caixa-local.mjs <nick> [fundador|cofundador|ambos]
 *
 * Marca caixas como ABERTAS para o jogador — outfit no armário e tag no chat, sem cobrar
 * diamante nem passar pela Loja. Consome um número da série global (como uma compra real).
 *
 * Se o jogador estiver online, desconecta antes de gravar — senão o flush do sim sobrescreve.
 */
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { migrar } from '../src/server/caixas-db.mjs';
import { conectarBus, desconectarJogador, gatewayDoJogador } from '../src/server/bus.mjs';
import { sincronizarOutfitsDeCaixa } from '../src/server/game/caixas.mjs';
import { TIPOS_CAIXA, caixaPorTipo, textoTag } from '../src/shared/caixas-beta.mjs';

const nick = process.argv[2];
const alvo = (process.argv[3] ?? 'ambos').toLowerCase();

const tipos = alvo === 'ambos'
  ? TIPOS_CAIXA
  : alvo === 'fundador' || alvo === 'cofundador'
    ? [alvo]
    : null;

if (!nick || !tipos) {
  console.error('Uso: node tools/dar-outfits-caixa-local.mjs <nick> [fundador|cofundador|ambos]');
  process.exit(1);
}

await migrar();

const { rows } = await pool.query(
  'SELECT id, nick, owned_outfits FROM players WHERE lower(nick) = lower($1)',
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
  console.log(`${canon} está online — desconectando para gravar sem o flush sobrescrever…`);
  await desconectarJogador(chave, { k: 'aviso', msg: 'Reconecte — outfits de caixa atualizados.' });
  await new Promise((r) => setTimeout(r, 3500));
}

const concedidas = [];

for (const tipo of tipos) {
  const def = caixaPorTipo(tipo);
  if (!def) continue;

  const { rows: ja } = await pool.query(
    `SELECT 1 FROM caixas_beta
      WHERE aberta_por = $1 AND tipo = $2 AND aberta_em IS NOT NULL
      LIMIT 1`,
    [playerId, tipo],
  );
  if (ja.length) {
    console.log(`  · ${tipo}: já tinha tag aberta — pulando`);
    continue;
  }

  const { rows: cont } = await pool.query(
    `SELECT COALESCE(max(serie), 0)::int AS ultima, count(*)::int AS n
       FROM caixas_beta WHERE tipo = $1`,
    [tipo],
  );
  const vendidas = Number(cont[0].n);
  if (vendidas >= def.limite) {
    console.error(`  ✗ ${tipo}: esgotada no servidor (${def.limite}/${def.limite})`);
    continue;
  }

  const serie = Number(cont[0].ultima) + 1;
  await pool.query(
    `INSERT INTO caixas_beta
       (tipo, serie, dono_id, comprador_id, comprador, aberta_em, aberta_por, aberta_nick)
     VALUES ($1, $2, $3, $3, $4, now(), $3, $4)`,
    [tipo, serie, playerId, canon],
  );
  concedidas.push(textoTag(tipo, serie));
}

if (!concedidas.length) {
  console.log('Nada novo concedido.');
  await pool.end();
  process.exit(0);
}

const { rows: tagRows } = await pool.query(
  `SELECT tipo, serie FROM caixas_beta
    WHERE aberta_por = $1 AND aberta_em IS NOT NULL
    ORDER BY tipo, serie`,
  [playerId],
);
const tagsCliente = tagRows.map((r) => ({ tipo: r.tipo, serie: Number(r.serie) }));

const owned = Array.isArray(rows[0].owned_outfits) ? [...rows[0].owned_outfits] : [];
const p = { ownedOutfits: owned };
sincronizarOutfitsDeCaixa(p, tagsCliente);

await pool.query(
  'UPDATE players SET owned_outfits = $2::jsonb, last_seen = now() WHERE id = $1',
  [playerId, JSON.stringify(p.ownedOutfits)],
);

console.log(`✓ ${canon} (id ${playerId}) — tags: ${concedidas.join(', ')}`);
if (online) console.log('  Reconecte no jogo (F5).');
else console.log('  Recarregue a página (F5) se estiver online.');
await pool.end();
