/**
 * As dezoito pedras de evolução, e o tipo elemental de cada uma.
 *
 * O mapa vivia só dentro do `content.mjs` (`NOME_PEDRA_POR_TIPO`), onde a evolução o lê para
 * cobrar a pedra certa. Ele saiu para cá porque quem GERA os drops precisa da mesma tabela: um
 * gerador que adivinhasse o tipo da pedra pelo nome erraria justo as duas que mais importam —
 * a Sun Stone, que casa com "sun" e viraria FIRE quando ela é a pedra do NORMAL, e a Heart
 * Stone, que sem palavra-chave nenhuma cairia no NORMAL quando ela é a do FAIRY. As duas pontas
 * lendo o mesmo objeto é o que garante que a pedra que a hunt solta é a pedra que a evolução
 * cobra.
 *
 * `TIPO_DO_ITEM`, do `content.mjs`, continua servindo para o RESTO do catálogo: ele deriva o
 * tipo pelo tipo dominante de quem dropa, o que funciona bem em item de loot comum e mal em
 * pedra. Aqui é escrito à mão porque pedra é regra de jogo, não estatística.
 */

/** tipo elemental → nome da pedra que a evolução dele cobra. DARK e GHOST dividem a mesma. */
export const PEDRA_POR_TIPO = {
  NORMAL: 'Sun Stone',
  FIRE: 'Fire Stone',
  WATER: 'Water Stone',
  GRASS: 'Leaf Stone',
  ELECTRIC: 'Thunder Stone',
  ICE: 'Ice Stone',
  FIGHTING: 'Punch Stone',
  POISON: 'Venom Stone',
  GROUND: 'Earth Stone',
  FLYING: 'Feather Stone',
  PSYCHIC: 'Enigma Stone',
  BUG: 'Cocoon Stone',
  ROCK: 'Rock Stone',
  GHOST: 'Darkness Stone',
  DRAGON: 'Ancient Stone',
  DARK: 'Darkness Stone',
  STEEL: 'Metal Stone',
  FAIRY: 'Heart Stone',
};

/**
 * Todo nome de pedra do catálogo — o conjunto que o filtro de drops vigia.
 *
 * Além das dezoito da evolução entra a **Crystal Stone**, que não evolui nada mas é pedra na
 * ficha e no Mercado. Deixá-la de fora faria o gerador tratá-la como item de loot qualquer e
 * espalhá-la por tipo alheio, que é exatamente o que se está consertando. (A Moon Stone saiu do
 * jogo — ver `ITENS_MORTOS` em `venda-npc-item.mjs`.)
 */
export const PEDRAS = new Set([...Object.values(PEDRA_POR_TIPO), 'Crystal Stone']);

/** Tipos aos quais uma pedra pertence. A Darkness Stone serve DARK e GHOST; as outras, um só. */
export function TIPOS_DA_PEDRA(nome) {
  if (nome === 'Darkness Stone') return ['DARK', 'GHOST'];
  if (nome === 'Crystal Stone') return ['ICE'];
  const achado = Object.entries(PEDRA_POR_TIPO).find(([, n]) => n === nome);
  return achado ? [achado[0]] : [];
}
