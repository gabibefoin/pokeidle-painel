// O REGISTRO DE P5 (potência máxima) do servidor — espelha `shinys-db.mjs`.
//
// A Pokédex tem uma vitrine global de shinys; esta é a de quem já rolou potência 5 na captura.
// O anúncio no Mercado, quando existir, entra como coluna extra — igual ao shiny.
import { pool } from './db.mjs';
import { POTENCIA_MAX } from '../shared/nota-pokemon.mjs';
import { listarRegistro, POR_PAGINA } from './registro-db.mjs';

export { POR_PAGINA };

export async function migrar() {
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_pp_p5 ON player_pokemon(species_id, id DESC)
     WHERE potencia = ${POTENCIA_MAX}`,
  );
}

export async function listarP5({
  speciesIds = null,
  soAVenda = false,
  ordem = 'recentes',
  pagina = 0,
} = {}) {
  return listarRegistro({
    condicoes: [`pp.potencia = ${POTENCIA_MAX}`],
    speciesIds,
    soAVenda,
    ordem,
    pagina,
  });
}
