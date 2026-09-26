#!/usr/bin/env node
/** Lista (ou simula) anúncios abertos em ORB abaixo do preço mínimo. */
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { migrar as migrarDb } from '../src/server/db.mjs';
import { migrar as migrarMkt, PRECO_MIN_ORB, devolverAnunciosPrecoOrbInvalido } from '../src/server/market-db.mjs';

await migrarDb();
await migrarMkt();

const dry = process.argv.includes('--dry-run');

const { rows } = await pool.query(
  `SELECT a.id, a.vendedor, a.tipo, a.preco, a.qtd, a.ficha->>'nome' AS nome
     FROM market_anuncios a
    WHERE a.estado = 'aberto' AND a.moeda = 'orb' AND a.preco < $1
    ORDER BY a.preco, a.id`,
  [PRECO_MIN_ORB],
);

console.log(`Preço mínimo em Gemas: ${PRECO_MIN_ORB}\n`);
if (!rows.length) {
  console.log('Nenhum anúncio aberto abaixo do mínimo.');
  await pool.end();
  process.exit(0);
}

console.log(`${rows.length} anúncio(s) aberto(s) inválido(s):\n`);
for (const r of rows) {
  console.log(
    `#${r.id} · ${r.vendedor} · ${r.tipo} · ${r.qtd}× ${r.nome ?? '?'} · ${r.preco} Gema/un.`,
  );
}

if (dry) {
  console.log('\n(dry-run — nada alterado. Rode sem --dry-run para cancelar e devolver.)');
} else {
  const devolvidos = await devolverAnunciosPrecoOrbInvalido();
  console.log(`\nCancelados e devolvidos: ${devolvidos.length}`);
}

await pool.end();
