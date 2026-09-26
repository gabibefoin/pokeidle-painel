#!/usr/bin/env node
/** Audita caixa ORB: ledger vs on-chain vs endereços dos jogadores. */
import { pool } from '../src/server/db.mjs';
import { migrar as migrarDb } from '../src/server/db.mjs';
import { migrar as migrarOdb } from '../src/server/orbs-db.mjs';
import { numerosDoCaixa, colheitasConfirmadasUsdt } from '../src/server/orbs-db.mjs';
import * as enderecos from '../src/server/orbs-enderecos.mjs';
import { criarChain } from '../src/server/chain.mjs';
import { resumoDoCaixa } from '../src/server/game/orbs.mjs';

await migrarDb();
await migrarOdb();

const caixa = await numerosDoCaixa();
const colheitas = await colheitasConfirmadasUsdt();

let naCarteira = null;
let chain = null;
try {
  chain = criarChain();
  if (!chain.simulada && process.env.CARTEIRA_PROJETO) {
    naCarteira = await chain.saldoUsdt(process.env.CARTEIRA_PROJETO);
  }
} catch (err) {
  console.warn('RPC:', err.message);
}

const resumo = resumoDoCaixa({ ...caixa, naCarteira, colheitasUsdt: colheitas });
console.log('\n=== Ledger ===');
console.log('Depositos (SUM orb_depositos):', caixa.compradoUsdt.toFixed(6));
console.log('Sacado confirmado:', caixa.sacadoUsdt.toFixed(6));
console.log('Contabil (dep - saq):', (caixa.compradoUsdt - caixa.sacadoUsdt).toFixed(6));
console.log('Colheitas admin:', colheitas.toFixed(6));

console.log('\n=== On-chain ===');
console.log('Carteira projeto:', naCarteira?.toFixed(6) ?? '—');

console.log('\n=== Painel publico (atual) ===');
console.log('Arrecadado:', resumo.arrecadadoUsdt);
console.log('Sacado:', resumo.sacadoUsdt);
console.log('Em caixa:', resumo.emCaixaUsdt);

if (chain && !chain.simulada) {
  const lista = await enderecos.comDepositoNoLedger({ limite: 500 });
  let pendente = 0;
  let comSaldo = 0;
  for (const e of lista) {
    const s = await chain.saldoUsdt(e.endereco);
    if (s > 0) {
      comSaldo++;
      pendente += s;
      if (s >= 0.01) console.log(`  jogador ${e.playerId}: ${s.toFixed(6)} USDT @ ${e.endereco.slice(0, 8)}…`);
    }
  }
  console.log('\n=== Enderecos de deposito (jogadores) ===');
  console.log('Enderecos olhados:', lista.length);
  console.log('Com saldo > 0:', comSaldo);
  console.log('Total pendente varredura:', pendente.toFixed(6));
  console.log('\n=== Fechamento ===');
  const fechamento = (naCarteira ?? 0) + pendente + caixa.sacadoUsdt + colheitas;
  console.log('caixa + pendente + sacado + colheitas =', fechamento.toFixed(6));
  console.log('vs depositos ledger:', caixa.compradoUsdt.toFixed(6));
  console.log('diferenca:', (caixa.compradoUsdt - fechamento).toFixed(6));
}

await pool.end();
