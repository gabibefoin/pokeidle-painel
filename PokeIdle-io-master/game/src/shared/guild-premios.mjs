// As recompensas da guild — num arquivo só, porque DOIS lados leem os mesmos números.
//
// O servidor paga (`server/game/guild.mjs` recalcula o bônus diário depois de cada guerra,
// `server/game/guild-global.mjs` paga o diamante do mês) e a tela MOSTRA (a folha 🏆 do
// PvP Guild). Com o número escrito nos dois lados, o primeiro ajuste de balanceamento deixaria
// a folha prometendo o que o servidor não paga.

/**
 * Bônus % de XP de treinador, XP de pokémon e loot por posição no ranking DIÁRIO de GP.
 * Só guilds com GP > 0 — e vale até a guerra seguinte, que zera o GP e refaz o ranking.
 */
export const BONUS_RANKING_GP = { 1: 10, 2: 5, 3: 3, resto: 1 };

/** Diamante por MEMBRO da guild, por posição no pódio do ranking GLOBAL, no fechamento do mês. */
export const PREMIOS_GLOBAL = { 1: 100, 2: 50, 3: 10 };
