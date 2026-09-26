#!/usr/bin/env node
// Diagnóstico de comissões de indicação — compara affiliate_comissao vs ledger e saldo.
import { pool } from '../src/server/db.mjs';
import { migrar } from '../src/server/afiliados-db.mjs';
import { auditoriaDe } from '../src/server/afiliados-db.mjs';
import * as ddb from '../src/server/diamantes-db.mjs';
import * as odb from '../src/server/orbs-db.mjs';

const nick = process.argv[2];
if (!nick) {
  console.error('Uso: node tools/verificar-afiliado.mjs <nick>');
  process.exit(1);
}

await migrar();

const { rows } = await pool.query(
  `SELECT p.id, p.nick, p.diamonds, p.orbs, a.id AS account_id
     FROM players p
     LEFT JOIN accounts a ON lower(a.nick) = lower(p.nick)
    WHERE lower(p.nick) = lower($1)`,
  [nick],
);
if (!rows[0]) {
  console.error(`Jogador "${nick}" não encontrado.`);
  process.exit(1);
}

const p = rows[0];
const playerId = Number(p.id);
const audit = await auditoriaDe(playerId);
const divergDia = await ddb.conferirSaldo(500);
const divergOrb = await odb.conferirSaldo(500);
const meuDia = divergDia.find((r) => r.id === playerId);
const meuOrb = divergOrb.find((r) => r.id === playerId);

console.log(JSON.stringify({
  nick: p.nick,
  playerId,
  accountId: p.account_id ? Number(p.account_id) : null,
  saldo: { diamantes: Number(p.diamonds), gemas: Number(p.orbs) },
  audit,
  divergenciaLedger: {
    diamantes: meuDia ?? null,
    gemas: meuOrb ?? null,
  },
}, null, 2));

if (audit.semCreditoNoLedger.length) {
  console.error(`\n⚠ ${audit.semCreditoNoLedger.length} comissão(ões) SEM crédito no ledger.`);
  if (audit.entregueSemLedger.length) {
    console.error(`  ${audit.entregueSemLedger.length} marcada(s) entregue=true — perda real, use reparar-afiliado.mjs`);
  }
  if (audit.pendenteSemLedger.length) {
    console.error(`  ${audit.pendenteSemLedger.length} pendente(s) legítima(s) — Recolher deveria pagar`);
  }
  process.exit(2);
}

if (audit.fantasmaPendente.length) {
  console.warn(`\nℹ ${audit.fantasmaPendente.length} fantasma(s): entregue=false mas já creditado no ledger (pré v1.29.7).`);
}

await pool.end();
