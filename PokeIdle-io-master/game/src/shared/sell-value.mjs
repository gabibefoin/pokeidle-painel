// Valor de venda ao NPC — compartilhado entre servidor (content/sim) e cliente (pokédex/market).
//
// O espelho traz `priceNpc` absurdo em algumas espécies raras (Aerodactyl = 6,5 bi) sem
// `sellValue`. Quem caía no fallback `sellValue ?? priceNpc` virava impressora de ouro.

export const NIVEL_ANCORA = 150;
export const OURO_ANCORA = 12000;
export const XP_ANCORA = 0.6 * NIVEL_ANCORA ** 2; // 13.500

/**
 * O XP de um abate pelo nível do mob — UMA curva, para o jogo inteiro.
 *
 * Até 150 é a lei do espelho, exata: `⌊0,6·n²⌋ + 8` (nv 1 = 8, nv 40 = 968, nv 150 = 13.508).
 * A conta é inteira (`6·n²/10`) para o `floor` não tropeçar no 0,6 binário. Acima de 150 o
 * expoente cai para 1,25, ancorado em 13.500 — ver o comentário em content.mjs.
 */
export const xpDoNivel = (n) =>
  n <= NIVEL_ANCORA
    ? Math.floor((6 * n * n) / 10) + 8
    : Math.round(XP_ANCORA * (n / NIVEL_ANCORA) ** 1.25);

/** Ouro base por huntLevel — mesma curva de content.mjs. */
export const ouroDoNivel = (n) => Math.round(OURO_ANCORA * (n / NIVEL_ANCORA) ** 0.6);

/** Acima disto, `priceNpc` do espelho é lixo de importação — não usar na venda. */
export const TETO_PRICE_NPC_VENDA = 500_000;

/**
 * A CURVA DO OURO POR ABATE — uma só, para o jogo inteiro.
 *
 * Antes eram duas emendadas: `especie.experience` (= `0,6·n²`) em Kanto/Johto e
 * `12.000·(n/150)^0,6` em Hoenn+. Juntas iam de 8 coins no nível 1 a 787.928 no 160.300 —
 * amplitude de 98.491×, que com preço de loja parado é poder de compra multiplicado por 98 mil.
 *
 * A curva nova é uma lei de potência ancorada em DOIS pontos de produto:
 *
 *   nível 1     →     36 coins     (o começo, que antes pagava 8 e era escravidão literal)
 *   nível 5.000 →  6.000 coins
 *
 * O expoente NÃO é escolhido: ele cai desses dois números (`ln(6000/36) / ln(5000)` = 0,6007) e
 * está aqui derivado de propósito. Mexer na curva é mexer nas duas âncoras, que são as coisas
 * que alguém consegue de fato ter opinião sobre — "quanto o nível 1 paga" e "quanto o nível
 * 5.000 paga" —, e nunca num expoente solto que ninguém sabe ler.
 *
 * Por coincidência boa, 0,6007 é praticamente o 0,6 que `ouroDoNivel` já usava: a forma da
 * curva de Hoenn+ estava certa; o que estava errado era a altura dela e o degrau que a emendava
 * na de Kanto.
 */
export const OURO_KILL_NIVEL_1 = 36;
export const OURO_KILL_ANCORA_NIVEL = 5_000;
export const OURO_KILL_ANCORA = 6_000;

/** Sai das duas âncoras acima — ver o comentário. */
export const EXPOENTE_OURO_KILL =
  Math.log(OURO_KILL_ANCORA / OURO_KILL_NIVEL_1) / Math.log(OURO_KILL_ANCORA_NIVEL);

/**
 * O nível de hunt em que o ouro por abate para de crescer.
 *
 * Do 25.000 para cima todo abate paga o mesmo, e quem cresce é o DROP — ver
 * `shared/economia-drop.mjs`, que é onde o desenho inteiro está explicado.
 */
export const NIVEL_TETO_OURO = 25_000;

/** O ouro por abate no nível do teto. */
export const TETO_OURO_KILL = Math.round(OURO_KILL_NIVEL_1 * NIVEL_TETO_OURO ** EXPOENTE_OURO_KILL);

/** O ouro que um abate paga num nível, com o teto aplicado. */
export const ouroPorKillDoNivel = (n) =>
  Math.min(
    TETO_OURO_KILL,
    Math.max(1, Math.round(OURO_KILL_NIVEL_1 * Math.max(1, Number(n) || 1) ** EXPOENTE_OURO_KILL)),
  );

/**
 * Teto do valor-base que o NPC paga por um POKÉMON.
 *
 * Sem ele o conserto do ouro por abate não vale nada: `sellValueBaseDe` seguia `ouroDoNivel`, e
 * no nível 160.300 isso é 787.928 de base — com `autoBallSemParar` ligado, vender capturados
 * viraria a impressora que a kill deixou de ser. É a "nova impressora" que a ECONOMIA.md §6
 * já apontava.
 *
 * Seis vezes o teto da kill: depois dos multiplicadores de `precoVendaPokemon` (nível ÷ 50 e
 * qualidade), um capturado no teto de captura sai por volta de 10 abates. Um pokémon vale um
 * punhado de kills — não uma hora delas. A relação é com o TETO, então ela se reajusta sozinha
 * se as âncoras da curva mudarem.
 */
export const TETO_SELL_POKEMON = 6 * TETO_OURO_KILL;

/** Valor econômico confiável da espécie (venda NPC, raridade de captura). */
export function valorEconomicoDe(esp) {
  if (!esp) return OURO_ANCORA;
  const hl = Math.max(1, esp.huntLevel ?? 1);
  const sell = esp.sellValue ?? 0;
  const npc = esp.priceNpc ?? 0;
  if (sell > 0 && sell <= TETO_PRICE_NPC_VENDA) return sell;
  if (sell > TETO_PRICE_NPC_VENDA) return ouroDoNivel(hl);
  if (npc > 0 && npc <= TETO_PRICE_NPC_VENDA) return npc;
  return ouroDoNivel(hl);
}

/**
 * Hoenn+ (huntLevel > 150): XP e ouro base seguem a curva ancorada, não o placeholder
 * 3000 do creatures-novos.json. O servidor fazia isto em content.mjs; o cliente precisa
 * da mesma regra para o label do Market bater com a venda real.
 */
export function aplicarEconomiaRegiaoAlta(esp) {
  if (!esp || (esp.huntLevel ?? 0) <= NIVEL_ANCORA) return;
  esp.experience = xpDoNivel(esp.huntLevel);
  const ouro = ouroDoNivel(esp.huntLevel);
  esp.sellValue = ouro;
  esp.priceNpc = ouro;
}

/**
 * Quanto o NPC paga por um pokémon desta espécie (nível 1, qualidade 1).
 *
 * O teto entra AQUI, e não em `valorEconomicoDe`: aquele também serve de régua de RARIDADE na
 * captura (`precoDeRaridade`, no sim), e achatá-lo faria as espécies do topo virarem todas
 * igualmente comuns. O que precisava de teto é o preço de venda, e é só ele que leva.
 */
export function sellValueBaseDe(esp) {
  if (!esp) return Math.min(OURO_ANCORA, TETO_SELL_POKEMON);
  // Acima de 150 a curva do nível manda, mas nunca ACIMA do valor da espécie: é assim que o
  // pré-evolução rebaixado por `alinharValorDaCadeia` (Budew, Chingling, os clones de Hoenn) vende
  // pelo que vale, e não pelo degrau da hunt em que mora. Para todo o resto os dois são o mesmo
  // número — `aplicarEconomiaRegiaoAlta` grava a curva em `sellValue`.
  const valor = valorEconomicoDe(esp);
  const base = (esp.huntLevel ?? 0) > NIVEL_ANCORA ? Math.min(ouroDoNivel(esp.huntLevel), valor) : valor;
  return Math.min(base, TETO_SELL_POKEMON);
}

/** Preenche `sellValue` e corrige `priceNpc` absurdo do espelho. */
export function normalizarSellValue(esp) {
  aplicarEconomiaRegiaoAlta(esp);
  const base = valorEconomicoDe(esp);
  esp.sellValue = base;
  if ((esp.priceNpc ?? 0) > TETO_PRICE_NPC_VENDA) esp.priceNpc = base;
  return base;
}

/** Mesma conta do `precoDoPokemon` — nível e qualidade escalam; shiny ×10. */
export function precoVendaPokemon(esp, pk) {
  const base = sellValueBaseDe(esp);
  const valor = base * (1 + (pk.level ?? 1) / 50) * (pk.quality ?? 1) * (pk.shiny ? 10 : 1);
  return Math.max(1, Math.floor(valor));
}
