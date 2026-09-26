/**
 * AS CINCO OUTLANDS.
 *
 * Mesmo mapa, mesmos selvagens, mesmo nível 150 nos bichos. O que muda entre elas é uma coisa
 * só: o quanto os três drops raros da área caem — Bronze Boss Token, Fragmento de Chave e
 * Fragmento de Shiny Stone. O degrau é escolhido no Mapa, e a escada é a tabela ali embaixo —
 * o único lugar do código que sabe quantos degraus existem e quanto cada um multiplica.
 *
 * ### Por que não são cinco áreas de verdade
 *
 * Duplicar as 47 hunts da Outland uma vez por degrau resolveria a trava de nível de graça
 * (`areaLiberada` já compara `p.level >= hunt.nivel`) — e pagaria por isso em toda tela que
 * lista hunt: a Pokédex diria "onde achar: Brave Blastoise" uma vez por degrau, o mapa teria a
 * mesma pilha de marcadores no mesmo pixel e o `welcome` carregaria centenas de hunts
 * fantasma. E o custo cresceria a cada Outland nova. Como o CONTEÚDO é idêntico, o degrau é
 * uma ESCOLHA do jogador, não um lugar novo: mora em `players.outland_tier`, do mesmo jeito
 * que `boss_points` guarda os pontos de boss.
 *
 * ### A trava de nível
 *
 * Quem manda é o servidor, em dois pontos, e de propósito: `outland.tier` recusa a troca de
 * quem não tem nível, e o sorteio do drop passa o tier por {@link tierOutlandValido} de novo,
 * na hora da kill. O segundo é o que fecha a porta de um `outland_tier` velho no banco valer
 * mais do que o nível de hoje — nível não cai, mas a regra pode mudar, e o multiplicador é
 * economia: ele não pode depender de a linha do banco estar em dia.
 *
 * ### Mexer aqui é mexer no jogo inteiro
 *
 * Esta tabela é a ÚNICA fonte: o servidor sorteia por ela, publica-a no `welcome`, e o
 * seletor do Mapa, a ficha da área, a Pokédex e a Pokepédia desenham o que vier dela. Um
 * degrau novo (ou um multiplicador rebalanceado) entra aqui e mais nada precisa saber —
 * inclusive as contas fracionárias, que é por que `mult` não é inteiro.
 */

/** Nível 150 é o degrau da Outland no mapa — a 1 não pede nada além dele. */
export const OUTLAND_TIERS = [
  { tier: 1, rotulo: 'Outland 1', nivel: 150, mult: 1 },
  { tier: 2, rotulo: 'Outland 2', nivel: 500, mult: 1.25 },
  { tier: 3, rotulo: 'Outland 3', nivel: 1000, mult: 1.5 },
  { tier: 4, rotulo: 'Outland 4', nivel: 2000, mult: 2 },
  { tier: 5, rotulo: 'Outland 5', nivel: 4000, mult: 3 },
  { tier: 6, rotulo: 'Outland 6', nivel: 8000, mult: 4 },
  { tier: 7, rotulo: 'Outland 7', nivel: 16000, mult: 6 },
  { tier: 8, rotulo: 'Outland 8', nivel: 25000, mult: 8 },
];

export const OUTLAND_TIER_PADRAO = 1;

/** A ficha de um tier. Número fora da escada (0, 99, `null`, texto) cai na Outland 1. */
export function outlandTier(tier) {
  const n = Number(tier);
  return OUTLAND_TIERS.find((x) => x.tier === n) ?? OUTLAND_TIERS[0];
}

/** Nível de treinador que a Outland `tier` exige. */
export const nivelOutlandTier = (tier) => outlandTier(tier).nivel;

/** O que multiplica a chance dos três drops raros da área. Fracionário nos degraus de baixo. */
export const multOutlandTier = (tier) => outlandTier(tier).mult;

export const rotuloOutlandTier = (tier) => outlandTier(tier).rotulo;

/** O nível abre esta Outland? */
export const outlandTierLiberado = (tier, level) => Number(level) >= nivelOutlandTier(tier);

/**
 * O tier que ESTE nível pode usar de fato — cai para o melhor liberado.
 *
 * Nunca devolve `null`: a Outland 1 pede o mesmo nível 150 do mapa, então quem chega à área
 * já tem a 1 liberada, e quem ainda não chegou não sorteia drop nenhum lá (o `area !==
 * 'outland'` do sorteio corta antes).
 */
export function tierOutlandValido(tier, level) {
  const alvo = outlandTier(tier);
  if (outlandTierLiberado(alvo.tier, level)) return alvo.tier;
  for (let i = OUTLAND_TIERS.length - 1; i >= 0; i--) {
    if (outlandTierLiberado(OUTLAND_TIERS[i].tier, level)) return OUTLAND_TIERS[i].tier;
  }
  return OUTLAND_TIER_PADRAO;
}

/** O que vai no `welcome`: a escada inteira, para a tela não repetir os números à mão. */
export const catalogoOutlandTiers = () => OUTLAND_TIERS.map((x) => ({ ...x }));
