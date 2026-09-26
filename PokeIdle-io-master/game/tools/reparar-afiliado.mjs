#!/usr/bin/env node
// Repara comissões de afiliado sem crédito no ledger (suporte/admin).
import { pool } from '../src/server/db.mjs';
import { migrar, repararComissoes } from '../src/server/afiliados-db.mjs';
import { auditoriaDe } from '../src/server/afiliados-db.mjs';

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const nick = args.find((a) => !a.startsWith('--'));

if (!nick) {
  console.error('Uso: node tools/reparar-afiliado.mjs <nick> [--aplicar]');
  console.error('  Sem --aplicar: só mostra o que seria creditado.');
  process.exit(1);
}

await migrar();

const { rows } = await pool.query(
  `SELECT id, nick FROM players WHERE lower(nick) = lower($1)`,
  [nick],
);
if (!rows[0]) {
  console.error(`Jogador "${nick}" não encontrado.`);
  process.exit(1);
}

const playerId = Number(rows[0].id);
const antes = await auditoriaDe(playerId);
console.log(JSON.stringify({ nick: rows[0].nick, playerId, antes }, null, 2));

if (!antes.semCreditoNoLedger.length) {
  console.log('\nNada a reparar — todas as comissões têm ledger ou não existem.');
  await pool.end();
  process.exit(0);
}

const r = await repararComissoes(playerId, { dryRun: !aplicar });
console.log('\n' + JSON.stringify(r, null, 2));

if (!aplicar) {
  console.error('\nDry-run. Rode com --aplicar para creditar de verdade.');
  process.exit(2);
}

await pool.end();
