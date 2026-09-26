#!/usr/bin/env node
// Lista treinadores com mais de 5 pokémon na equipe (slot preenchido).
// Uso: node tools/auditar-equipes.mjs
//      node tools/auditar-equipes.mjs --corrigir   (aplica a mesma correção do boot)

import { pool, corrigirEquipesExcedentes } from '../src/server/db.mjs';

const corrigir = process.argv.includes('--corrigir');

const { rows } = await pool.query(
  `SELECT p.id, p.nick, COUNT(*)::int AS na_equipe,
          array_agg(pp.id ORDER BY pp.slot ASC, pp.id ASC) AS pokemon_ids,
          array_agg(pp.slot ORDER BY pp.slot ASC, pp.id ASC) AS slots
     FROM players p
     JOIN player_pokemon pp ON pp.player_id = p.id
    WHERE pp.slot IS NOT NULL AND pp.anuncio_id IS NULL
    GROUP BY p.id, p.nick
   HAVING COUNT(*) > 5
    ORDER BY COUNT(*) DESC, p.nick`,
);

if (!rows.length) {
  console.log('Nenhum treinador com mais de 5 pokémon na equipe.');
} else {
  console.log(`${rows.length} treinador(es) com equipe acima do limite:\n`);
  for (const r of rows) {
    console.log(`  ${r.nick} (id ${r.id}) — ${r.na_equipe} na equipe · slots ${r.slots.join(', ')}`);
  }
}

if (corrigir && rows.length) {
  const r = await corrigirEquipesExcedentes();
  console.log(`\nCorrigido: ${r.movidos} pokémon(s) → Depot em ${r.jogadores.length} jogador(es).`);
}

await pool.end();
