// Regrava `ficha.nota` dos anúncios de pokémon — depois de mudar a fórmula (ex.: shiny 25%).
//
//   node game/tools/recalcular-notas-anuncios.mjs
//   node game/tools/recalcular-notas-anuncios.mjs --todos   # inclui cancelados/vendidos
import { pool } from '../src/server/db.mjs';
import { recalcularNotasAnuncios } from '../src/server/market-db.mjs';

const todos = process.argv.includes('--todos');
const { total, atualizados } = await recalcularNotasAnuncios({ soAbertos: !todos });
console.log(`Pronto — ${atualizados} de ${total} anúncio(s) de pokémon com nota realinhada.`);
await pool.end();
