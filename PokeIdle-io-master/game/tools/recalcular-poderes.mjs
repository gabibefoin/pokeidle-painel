// Regrava `power` de todos os pokémon — útil depois de mudar a fórmula do ranking.
//
//   node game/tools/recalcular-poderes.mjs
import { pool, gravarPoderes } from '../src/server/db.mjs';
import { poderDePokemon } from '../src/shared/nota-pokemon.mjs';

let total = 0;
let lastId = 0;
for (;;) {
  const { rows } = await pool.query(
    `SELECT id, species_id, level, quality, ivs, shiny, potencia FROM player_pokemon
      WHERE id > $1 ORDER BY id LIMIT 500`,
    [lastId],
  );
  if (!rows.length) break;
  await gravarPoderes(rows.map((r) => {
    const ivs = typeof r.ivs === 'string' ? JSON.parse(r.ivs) : r.ivs;
    return {
      id: r.id,
      power: poderDePokemon({
        ivs: ivs ?? {},
        quality: Number(r.quality) || 1,
        potencia: Number(r.potencia) || 1,
        shiny: r.shiny,
        level: r.level,
      }),
    };
  }));
  lastId = rows.at(-1).id;
  total += rows.length;
  process.stdout.write(`\r  ${total} pokémon…`);
}
console.log(`\nPronto — ${total} pokémon com poder recalculado.`);

await pool.end();
