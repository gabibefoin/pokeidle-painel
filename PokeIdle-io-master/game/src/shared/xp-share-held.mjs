/** Held item Exp. Share — repassa 5% do XP de batalha para quem segura. */
export const XP_SHARE_HELD_ID = 70050;

/** Fatia do XP do pokémon de batalha repassada a quem segura o item. */
export const XP_SHARE_HELD_PCT = 0.05;

/**
 * A Exp. Share NÃO é negociável. Ela nasce na Loja por 50 💎 e morre na conta que a comprou.
 *
 * Não é decisão de economia — é de auditoria. Este é o único objeto do jogo cuja unidade mora
 * em duas tabelas (`players.items` na bolsa, `player_pokemon.held_item_id` equipada), e é
 * justamente aí que ele duplica: qualquer caminho que grave as duas metades em momentos
 * diferentes põe a unidade de volta na bolsa com o pokémon ainda segurando. Enquanto a origem
 * disso não estiver fechada, o que mantém o estrago controlável é a conta fechar POR JOGADOR:
 *
 *     bolsa + equipadas  ==  quantas ele comprou   (`players.xp_share_total`)
 *
 * Com o Mercado aberto, uma unidade duplicada some dentro do fluxo da comunidade — ela vira
 * ouro de um, item de outro, e não há mais como dizer qual das duas era a falsa sem desfazer
 * negócio de gente inocente. Fechado, cada conta se explica sozinha e a correção é local.
 */
export const XP_SHARE_HELD_NEGOCIAVEL = false;

/**
 * Espera mínima entre um equipar/remover e o próximo, no mesmo jogador.
 *
 * Não é regra de jogo — é freio. Equipar e desequipar é um par que mexe em DUAS tabelas, e as
 * duas só ficam de acordo no flush. Deixar o botão livre é convidar o jogador a martelar
 * exatamente essa fresta.
 *
 * Já foi 5 s, alinhado com `FLUSH_MS`, na conta de que "passado o cooldown, o que está no banco
 * já é o que está na memória". A conta estava errada: o flush não é instantâneo. Medido em
 * produção, a transação de um ciclo fica ~1 s aberta com ~250 jogadores no lote (e o `pg_stat_
 * activity` a pegou em 483 ms no meio), ou seja, ~20% do tempo existe um flush em voo — e uma
 * troca que cai dentro dele é gravada pela metade. 60 s tira o clique da vizinhança do ciclo
 * inteiro, com folga para o lote crescer, e não cobra nada de quem usa o item como ele é usado
 * de verdade: escolhe um pokémon e deixa lá por dias.
 */
export const XP_SHARE_HELD_COOLDOWN_MS = 60_000;

export const ehXpShareHeldItem = (id) => Number(id) === XP_SHARE_HELD_ID;

/**
 * Quantas unidades tirar, e de onde, quando um jogador tem mais do que comprou.
 *
 * Mora aqui — e não no sim nem na ferramenta — porque os dois cortam, e duas cópias da regra
 * divergindo daria correções diferentes para o mesmo jogador dependendo de quem chegou antes.
 *
 * Tira da BOLSA primeiro: a unidade parada não está fazendo nada, enquanto a equipada está
 * repassando XP para um pokémon que o dono escolheu. Só depois disso mexe em quem segura, e aí
 * pelo pokémon de MENOR nível — se o corte precisar errar um alvo, que erre o mais barato.
 *
 * `equipados` vem ordenável (`{ id, level }`) e volta na ordem em que deve ser desequipado.
 */
export function planoDeCorteXpShare({ bolsa = 0, equipados = [], direito = 0 }) {
  const total = Math.max(0, Number(bolsa) || 0) + equipados.length;
  const excedente = total - Math.max(0, Number(direito) || 0);
  if (excedente <= 0) return { excedente: 0, daBolsa: 0, desequipar: [] };

  const daBolsa = Math.min(Math.max(0, Number(bolsa) || 0), excedente);
  const desequipar = [...equipados]
    .sort((a, b) => (a.level - b.level) || (a.id < b.id ? -1 : 1))
    .slice(0, excedente - daBolsa);

  return { excedente, daBolsa, desequipar };
}
