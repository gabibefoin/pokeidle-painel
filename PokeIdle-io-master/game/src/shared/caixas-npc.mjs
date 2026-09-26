// AS CAIXAS DO MARKET — o ralo de Coins do servidor.
//
// Duas caixas, compradas no NPC, que trocam uma montanha de Coins por sorte. O ouro entra e NÃO
// volta: nenhum prêmio é Coin, diamante ou gema. Isso é o ponto — em 17/09/2026 o topo do servidor
// tinha 3 bilhões de Coins parados e o segundo 900 milhões, dinheiro sem destino. A caixa é o
// destino.
//
// ### UM prêmio por caixa
//
// Cada abertura sorteia UMA coisa, e todas as coisas dividem os mesmos 100%. É o que deixa a
// abertura legível ("o que eu tirei?") e a tabela honesta: a porcentagem ao lado de cada prêmio é
// a chance DELE sair, sem letra miúda. Quem quer abrir várias escolhe a quantidade no contador do
// card — são N caixas, cada uma com o seu sorteio.
//
// ### Por que as regras moram aqui
//
// A tela precisa delas para MOSTRAR o conteúdo antes do clique (caixa que esconde porcentagem é
// outro tipo de produto, e não é o que este jogo quer ser) e o servidor precisa delas para
// sortear. Uma cópia só, importada dos dois lados — como `shared/campeonato.mjs`. O sorteio de
// verdade só roda no servidor: aqui está a FUNÇÃO, e quem a chama com o `Math.random` do processo
// é `server/game/caixas-npc.mjs`.
//
// ### Como as chances foram calculadas
//
// Cada item raro tem um preço em ABATES no jogo de hoje. Com o ouro por abate da Outland
// (nível 150 → 730 Coins), tudo entra na mesma régua:
//
//   Bronze Boss Token                  1 em 2.000 abates      ≈ 1,5 milhão de Coins de farm
//   Fragmento (chave/shiny/bicicleta)  1 em 200.000 abates    ≈ 146 milhões cada
//   TM Disk Piece / AoE                token + 0,5% no boss   ≈ 290 milhões cada
//
// As chances da CAIXA FREE saem dessas contas com desconto para a casa: abrir caixa é mais caro
// que farmar, e tem de ser — ela vende TEMPO e sorte, não um atalho mais barato. Um fragmento sai
// a cada ~3,75 bilhões de Coins na Free, e o valor esperado de uma abertura fica abaixo do preço
// nas duas caixas (Free ~16%, VIP ~58%, na régua de farm de `teste-caixas-npc.mjs`). Essa
// diferença é a queima.
//
// ### O que o diamante compra
//
// Não compra item: compra SORTE. A Caixa Diamante VIP dobra a chance de tudo que é raro e
// lendário, e o que sobra para os comuns encolhe na mesma medida. Ela exige VIP ativo — é um
// benefício de assinante, não uma segunda moeda de entrada.

// Os ids dos prêmios, copiados dos donos deles no servidor (`game/bosses.mjs`,
// `game/itens-nossos.mjs`, `game/tm.mjs`, `game/loja.mjs`). A cópia existe porque a TELA importa
// este arquivo e não alcança `src/server/` — e `teste-caixas-npc.mjs` compara os sete com as
// constantes originais, para a divergência quebrar o teste em vez de virar caixa com item errado.
export const BEAST_BALL_ID = 5;
export const BOSS_TOKEN_ID = 70000;
export const FRAG_CHAVE_ID = 70011;
export const FRAG_SHINY_ID = 70012;
export const FRAG_BICICLETA_ID = 70013;

/**
 * As duas caixas.
 *
 * `mult` multiplica a chance de TUDO que é raro e lendário; os comuns ficam com o que sobrar — por
 * isso não existe uma segunda tabela, só um número.
 *
 * A Free custa 3.000.000 de Coins. A VIP custa MENOS ouro — 1.500.000 — e mais 2 diamantes, e só
 * abre para quem tem VIP ativo: é um benefício de assinante, e é isso que justifica a sorte
 * dobrada pela metade do ouro. (18/09/2026: eram 5.000.000 as duas, e a VIP levava 5 diamantes.)
 *
 * `plate` é só o NOME do ícone (as plates do pokesprite, em `/img/caixas/`): a tela monta o
 * caminho. Uma para cada, para as duas se distinguirem de relance na grade.
 */
export const CAIXAS = [
  { id: 'free', coins: 3_000_000, diamantes: 0, mult: 1, vip: false, plate: 'iron' },
  { id: 'vip', coins: 1_500_000, diamantes: 2, mult: 2, vip: true, plate: 'splash' },
];

/**
 * A caixa de um id, ou `null`.
 *
 * `typeof id === 'string'` antes de comparar, e não `String(id)`: com a conversão, um pacote com
 * `caixaId: ["free"]` virava a string `"free"` e era aceito. Não dava privilégio nenhum (a caixa
 * é a mesma), mas é a forma errada de conferir tipo — e a forma errada é o que um dia deixa
 * passar o `{ toString }` que importa. Aqui o id é uma string da lista, ou não é nada.
 */
export const caixaPorId = (id) => (typeof id === 'string' ? CAIXAS.find((c) => c.id === id) ?? null : null);

/**
 * Quantas caixas cabem num clique.
 *
 * O contador é o mesmo dos outros cards do Market (− 1 + Máx), e cada unidade é uma CAIXA: N
 * caixas são N sorteios independentes e N vezes o preço. É assim que quem tem bilhões queima
 * depressa, sem que a caixa precise prometer "chance maior" por pagar mais.
 *
 * 9999 é o MESMO teto do `shop.buy` e do `maxCompraPorOuro` — o número que o jogo inteiro usa
 * para "o máximo de uma vez". Quem manda de verdade é o bolso: o "Máx" do card enche com o que
 * o ouro (e, na VIP, o diamante) paga, e com milhões por caixa o topo do servidor esbarra nos
 * próprios Coins muito antes de chegar aqui (9999 VIP são 15 bilhões e 19.998 diamantes).
 */
export const QTD_MAX = 9999;
export const limitarQtdCaixa = (n) => Math.max(1, Math.min(QTD_MAX, Math.round(Number(n)) || 1));

/** As três raridades. A tela pinta cada uma de um jeito, e a abertura comemora as duas de cima. */
export const TIER_COMUM = 'comum';
export const TIER_RARO = 'raro';
export const TIER_LENDARIO = 'lendario';

/**
 * A TABELA. Uma só, e cada linha com a sua chance.
 *
 * Lendário e raro têm `chance` FIXA (multiplicada pelo `mult` da caixa). Os comuns têm `peso`:
 * dividem entre si o que sobrar dos 100%. É por isso que dobrar a sorte da VIP não precisa de uma
 * segunda tabela — o que cresce em cima encolhe embaixo, sozinho.
 *
 * As quantidades dos comuns são generosas de propósito: sai UM prêmio por caixa, e "10 Poké Balls"
 * por três milhões de Coins seria piada. Ainda assim o valor esperado dos comuns fica em ~2% do
 * preço da Free; quem segura a caixa de pé é a fatia rara — e é essa diferença que queima o ouro.
 *
 * A Beast Ball é RARA, e não comum, porque ela não se compra com Coin em lugar nenhum do jogo:
 * sai da loja de diamante. Vinte e cinco delas é o prêmio grande de quem não tirou lendário.
 */
export const PREMIOS = [
  // ---- lendário: o que abre porta. As peças de TM saíram da caixa (elas são prêmio de boss, e
  // vender peça em caixa esvaziava o motivo de lutar contra ele); o Bronze Boss Token entrou no
  // lugar, porque o que ele dá é justamente a ENTRADA nessa luta.
  { tipo: 'item', id: BOSS_TOKEN_ID, qtd: 1, tier: TIER_LENDARIO, chance: 0.04 },
  { tipo: 'item', id: FRAG_CHAVE_ID, qtd: 1, tier: TIER_LENDARIO, chance: 0.0008 },
  { tipo: 'item', id: FRAG_SHINY_ID, qtd: 1, tier: TIER_LENDARIO, chance: 0.0008 },
  { tipo: 'item', id: FRAG_BICICLETA_ID, qtd: 1, tier: TIER_LENDARIO, chance: 0.0008 },
  // ---- raro
  { tipo: 'bola', id: BEAST_BALL_ID, qtd: 25, tier: TIER_RARO, chance: 0.06 },
  // ---- comum: dividem o resto por peso
  { tipo: 'bola', id: 1, qtd: 5000, tier: TIER_COMUM, peso: 26 }, // Poké Ball
  { tipo: 'bola', id: 2, qtd: 2500, tier: TIER_COMUM, peso: 20 }, // Great Ball
  { tipo: 'bola', id: 3, qtd: 1200, tier: TIER_COMUM, peso: 16 }, // Super Ball
  { tipo: 'bola', id: 4, qtd: 700, tier: TIER_COMUM, peso: 12 }, // Ultra Ball
  { tipo: 'item', id: 205, qtd: 200, tier: TIER_COMUM, peso: 12 }, // Revive
  { tipo: 'item', id: 206, qtd: 30, tier: TIER_COMUM, peso: 6 }, // Max Revive
  { tipo: 'item', id: 203, qtd: 200, tier: TIER_COMUM, peso: 5 }, // Hyper Potion
  { tipo: 'item', id: 204, qtd: 100, tier: TIER_COMUM, peso: 2 }, // Ultimate Potion
  { tipo: 'item', id: 70070, qtd: 40, tier: TIER_COMUM, peso: 1 }, // Golden Potion
];

const ehSorte = (p) => p.tier === TIER_RARO || p.tier === TIER_LENDARIO;

/** Quanto a caixa reserva para raro + lendário. O teto de 90% é só para os comuns nunca sumirem. */
const fatiaDeSorte = (mult) => Math.min(0.9, PREMIOS.filter(ehSorte).reduce((s, p) => s + p.chance * mult, 0));

/**
 * A tabela de UMA caixa, com a chance de cada linha já resolvida. Soma exatamente 1.
 *
 * É esta função que a tela usa para desenhar o "Ver Conteúdo" e a mesma que o sorteio percorre —
 * as duas pontas leem a mesma lista, na mesma ordem. Se um dia divergirem, divergem juntas.
 */
export function conteudoDaCaixa(caixaId) {
  const caixa = caixaPorId(caixaId);
  if (!caixa) return [];
  const sorte = PREMIOS.filter(ehSorte);
  const comuns = PREMIOS.filter((p) => !ehSorte(p));
  const bruto = sorte.reduce((s, p) => s + p.chance * caixa.mult, 0);
  const somaSorte = fatiaDeSorte(caixa.mult);
  const corte = bruto > 0 ? somaSorte / bruto : 1; // só morde se o teto de 90% tiver pegado
  const pesoTotal = comuns.reduce((s, p) => s + p.peso, 0) || 1;
  const sobra = 1 - somaSorte;
  return [
    ...sorte.map((p) => ({ ...p, chance: p.chance * caixa.mult * corte })),
    ...comuns.map((p) => ({ ...p, chance: sobra * (p.peso / pesoTotal) })),
  ];
}

/** O custo de abrir `qtd` caixas: cada uma cobra o preço dela, em Coins e em diamante. */
export function custoDaCaixa(caixaId, qtd = 1) {
  const caixa = caixaPorId(caixaId);
  if (!caixa) return null;
  const n = limitarQtdCaixa(qtd);
  return { coins: caixa.coins * n, diamantes: caixa.diamantes * n, qtd: n };
}

/**
 * ABRE UMA caixa: devolve UM prêmio, `{ tipo, id, qtd, tier }`.
 *
 * Nunca Coin, nunca diamante, nunca gema. `sorteio` é injetado para o teste poder fixar a sorte;
 * em produção é o `Math.random` do sim.
 */
export function abrirCaixa(caixaId, sorteio = Math.random) {
  const tabela = conteudoDaCaixa(caixaId);
  if (!tabela.length) return null;
  let n = sorteio();
  for (const premio of tabela) {
    n -= premio.chance;
    if (n < 0) return { tipo: premio.tipo, id: premio.id, qtd: premio.qtd, tier: premio.tier };
  }
  // Sobra de arredondamento (a soma é 1 com erro de ponto flutuante): cai no último comum, que é
  // o resultado mais provável de qualquer jeito.
  const ultimo = tabela.at(-1);
  return { tipo: ultimo.tipo, id: ultimo.id, qtd: ultimo.qtd, tier: ultimo.tier };
}

/** Abre `qtd` caixas de uma vez — uma lista de prêmios, um por caixa, na ordem em que saíram. */
export function abrirCaixas(caixaId, qtd = 1, sorteio = Math.random) {
  const n = limitarQtdCaixa(qtd);
  const saida = [];
  for (let i = 0; i < n; i++) {
    const premio = abrirCaixa(caixaId, sorteio);
    if (premio) saida.push(premio);
  }
  return saida;
}

/**
 * JUNTA os prêmios repetidos: `{ tipo, id, qtd (somado), tier, vezes }`.
 *
 * Abrir mil caixas dá mil prêmios, e mil linhas não é uma tela — é uma lista telefônica. Pior:
 * seriam mil objetos no pacote de resposta, por uma informação que cabe em dezesseis (a tabela
 * tem dezesseis linhas, e é o máximo de coisas DIFERENTES que podem sair).
 *
 * `vezes` é quantas caixas deram aquilo, e é o que a tela mostra ao lado ("saiu 12×"). Com uma
 * caixa só, `vezes` é 1 e a lista é idêntica à de antes — o agrupamento não aparece.
 *
 * A ordem é a de quem viu primeiro, que é a da tabela: lendário, raro, comum.
 */
export function agruparPremios(premios) {
  const por = new Map();
  for (const p of premios ?? []) {
    const chave = `${p.tipo}:${p.id}`;
    const junto = por.get(chave);
    if (junto) {
      junto.qtd += p.qtd;
      junto.vezes += 1;
    } else {
      por.set(chave, { tipo: p.tipo, id: p.id, qtd: p.qtd, tier: p.tier, vezes: 1 });
    }
  }
  return [...por.values()];
}

/** A raridade mais alta de uma lista de prêmios — é ela que manda na comemoração da tela. */
export function melhorTier(premios) {
  if (premios?.some((p) => p.tier === TIER_LENDARIO)) return TIER_LENDARIO;
  if (premios?.some((p) => p.tier === TIER_RARO)) return TIER_RARO;
  return TIER_COMUM;
}
