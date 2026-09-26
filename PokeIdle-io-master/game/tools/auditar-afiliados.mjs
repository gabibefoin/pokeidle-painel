#!/usr/bin/env node
// Varre indicadores com comissão registrada mas sem crédito no ledger.
import { pool } from '../src/server/db.mjs';
import { migrar, listarDivergenciasAfiliado, auditoriaDe } from '../src/server/afiliados-db.mjs';

const limite = Number(process.argv[2] ?? 100);
await migrar();

const lista = await listarDivergenciasAfiliado({ limite });
console.log(`Indicadores com divergência (até ${limite}): ${lista.length}\n`);

for (const { playerId, nick } of lista) {
  const audit = await auditoriaDe(playerId);
  const perdidas = audit.entregueSemLedger.reduce((s, r) => s + r.qtd, 0);
  const pendentes = audit.pendenteSemLedger.reduce((s, r) => s + r.qtd, 0);
  console.log(
    `${nick} (#${playerId}): ${audit.semCreditoNoLedger.length} sem ledger` +
    ` — entregue=${perdidas} pendente=${pendentes}` +
    (audit.fantasmaPendente.length ? ` fantasma=${audit.fantasmaPendente.length}` : ''),
  );
}

await pool.end();
