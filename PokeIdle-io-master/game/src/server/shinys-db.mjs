// O REGISTRO DE SHINYS do servidor: quem já capturou o quê, e o que está à venda.
//
// É a única lista do jogo que atravessa jogadores sem passar pelo Mercado — a pergunta que
// ela responde ("existe um Gyarados shiny neste servidor? de quem?") não tem nada a ver com
// anúncio, e a maior parte das linhas nunca esteve à venda.
//
// ### Por que não mora em market-db.mjs
//
// Lá dentro tudo é anúncio: escrow, caixa postal, comissão. Aqui a fonte é `player_pokemon`
// e o anúncio é só uma COLUNA A MAIS na linha — o `LEFT JOIN` que diz se dá para comprar
// aquele bicho agora. Invertida a origem, inverte o módulo.
//
// ### O índice parcial
//
// Shiny é raro por definição (menos de 1 em mil capturas), então um índice sobre
// `player_pokemon(shiny)` seria quase todo lixo. O índice PARCIAL indexa só as linhas
// `WHERE shiny`, e por isso cabe em memória mesmo com milhões de pokémon na tabela — a
// consulta abaixo lê o índice, não a tabela.
import { pool } from './db.mjs';
import { listarRegistro, POR_PAGINA } from './registro-db.mjs';

export { POR_PAGINA };

export async function migrar() {
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_pp_shiny ON player_pokemon(species_id, id DESC) WHERE shiny`,
  );
}

/**
 * A lista de shinys do servidor.
 *
 * `speciesIds` já vem RESOLVIDO pelo sim (a busca por nome e o filtro de tipo são respondidos
 * pelo catálogo, que mora na memória do processo) — é a mesma decisão do `market.listar`, e
 * pela mesma razão: aqui o SQL só sabe de números, e um `= ANY(...)` usa índice enquanto um
 * `ILIKE` sobre nome exigiria uma tabela de espécies que este banco não tem.
 */
export async function listarShinys({
  speciesIds = null,
  soAVenda = false,
  ordem = 'recentes',
  pagina = 0,
} = {}) {
  const r = await listarRegistro({
    condicoes: ['pp.shiny'],
    speciesIds,
    soAVenda,
    ordem,
    pagina,
  });
  return {
    ...r,
    linhas: r.linhas.map((l) => ({ ...l, shiny: true })),
  };
}
