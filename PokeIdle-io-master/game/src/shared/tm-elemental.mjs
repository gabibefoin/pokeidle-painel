// O golpe que o TM Disk elemental concede — a definição, num lugar só.
//
// ### Por que este arquivo existe
//
// O mesmo golpe era descrito em três lugares: `server/game/tm.mjs` (o de verdade, o que a
// batalha usa), um par de constantes `_UI` em `client/app.js` (para o painel de golpes do
// palco) e, faltando, o medidor de força das arenas — que por isso media um pokémon SEM a TM
// e mandava para uma luta em que ela existe.
//
// O estrago disso apareceu no ginásio de ROCK: dois Tyranitar shiny quase iguais, o do
// desafiante com TM ROCK. O pódio dava 176.069 contra 275.316 a favor do titular, e a luta
// terminava 20 a 0 para o desafiante — power 2.800 contra 600, no mesmo cooldown. Um número
// que diz uma coisa e uma batalha que diz outra é pior do que não ter número.
//
// Mora em `shared/` porque os três lados precisam da MESMA definição: o servidor para lutar,
// o cliente para desenhar e o medidor (que roda nos dois) para pontuar. Mudar o power aqui
// muda os três de uma vez, que é exatamente o que faltava.

/** Dano do golpe do TM elemental. É alto de propósito: é o prêmio de 10 peças de boss. */
export const TM_ELEMENTAL_POWER = 2800;

/** Cooldown do golpe do TM elemental, antes do desconto de IV de Speed. */
export const TM_ELEMENTAL_CD_MS = 60_000;

/** Raio do golpe (3×3 com centro no alvo) — usado só pelo combate do servidor. */
export const TM_ELEMENTAL_RAIO = 1;

/**
 * O golpe permanente concedido pelo TM elemental, no formato de um golpe de espécie.
 *
 * `tipo` é sempre um dos tipos do próprio pokémon (ver `tipoTmPermitido`), então ele SEMPRE
 * ganha STAB — o que ajuda a explicar por que ele domina a escolha da IA.
 */
export const golpeTmElemental = (tipo) => ({
  name: `TM ${tipo}`,
  power: TM_ELEMENTAL_POWER,
  type: tipo,
  category: 'SPECIAL',
  cooldownMs: TM_ELEMENTAL_CD_MS,
  tmElemental: true,
});
