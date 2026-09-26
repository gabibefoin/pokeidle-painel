// Os clones de ORRE (#13xxx) usam os golpes da espécie NACIONAL.
//
// ### O que estava errado
//
// Um clone de Orre é a mesma espécie com outra raridade: mesmo nome, mesmo sprite (o looktype é
// herdado em `herdar-looktype-orre.mjs`), mesmos tipos, mesmos stats de combate. O que o
// diferencia é o `orreTier`/`orreXpMul` — quanto ele rende —, e nada mais que o jogador veja.
//
// Só que os golpes nunca foram herdados. A dex nacional passou por três camadas de curadoria
// (os `auditOverrides` do pokemondb, as planilhas de `golpes-planilhas.mjs` e a injeção dos
// golpes de 600) e os clones ficaram parados nos golpes crus do espelho. O resultado é um
// Shedinja #13292 com Tackle e Quick Attack — NORMAL, num BUG/GHOST — todos com 56 de poder e
// 19,6s de cooldown, enquanto o #292 tem a escada curada de 25 a 140.
//
// Para o jogador os dois são "Shedinja": mesmo nome na ficha, mesmo sprite, mesma entrada na
// Pokédex. Ele não tem como saber que pegou o clone, e a ficha do bicho dele contradiz a
// Pokédex — que é a fonte da verdade. Era o caso reportado no Discord, num Shedinja shiny.
//
// Eram 130 dos 132 clones divergindo, e não uma espécie solta.
//
// ### Onde isto roda
//
// Ao lado de `herdarBaseOutland`, e pelo mesmo motivo: DEPOIS dos overrides de auditoria e das
// planilhas, para o clone pegar a lista já corrigida; e ANTES de `injetarGolpesEspeciais`, que
// depois roda em cada espécie por conta própria e dá a cada uma os seus dois golpes de 600. Como
// as planilhas já entregam os 600 de quem passou por elas, a injeção não acrescenta um terceiro
// nem no nacional nem no clone.
//
// ### O que este arquivo NÃO faz
//
// Não toca em stat, tipo, loot, evolução, looktype, nome nem nos campos de Orre (`orreTier`,
// `orreXpMul`, `captureBase`) — é só a lista de golpes. O `baseHp` de 59 clones também diverge
// do nacional, e isso ficou de fora de propósito: mexer no HP muda combate, e a pergunta era
// sobre os golpes.
//
// A faixa 14xxx (Mega Blastoise, Mega Alakazam, Castform Fire…) também fica de fora: aquelas
// têm NOME PRÓPRIO e entrada própria na Pokédex, então os golpes delas são a verdade delas.
// O problema aqui é especificamente o clone que se passa pelo original.

/** Começo e fim (exclusivo) da faixa de Orre. */
const ORRE_MIN = 13000;
const ORRE_MAX = 14000;

/** O `pokeId` nacional de um clone de Orre, ou `null` se não for um. */
export const nacionalDeOrre = (pokeId) =>
  (pokeId >= ORRE_MIN && pokeId < ORRE_MAX ? pokeId - ORRE_MIN : null);

/**
 * Copia para cada clone de Orre a lista de golpes da espécie nacional dele.
 *
 * @param {Array} lista todas as espécies do catálogo
 */
export function herdarGolpesOrre(lista) {
  const porId = new Map(lista.map((c) => [c.pokeId, c]));
  for (const esp of lista) {
    const baseId = nacionalDeOrre(esp?.pokeId ?? -1);
    if (baseId == null) continue;
    const base = porId.get(baseId);
    // Cópia rasa de cada golpe, e não a mesma referência de array: `injetarGolpesEspeciais`
    // roda depois e dá um `push` na lista de cada espécie. Compartilhando o array, o golpe de
    // 600 injetado no clone apareceria duplicado no nacional.
    if (Array.isArray(base?.attacks)) esp.attacks = base.attacks.map((a) => ({ ...a }));
  }
}
