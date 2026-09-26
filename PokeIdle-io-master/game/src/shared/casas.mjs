/**
 * As cinco raridades de Casa — a tabela que servidor e cliente leem.
 *
 * ### O que uma casa É, do ponto de vista do jogo
 *
 * Uma PEÇA NUMERADA: uma linha na tabela `casas` (ver `server/casas-db.mjs`), com dono e um
 * número que o servidor inteiro compartilha — a primeira casa que alguém tirou é a #000001, a
 * seguinte a #000002. Foi item na bolsa até o dia em que o número passou a importar: numa
 * quantidade (`items[70040] = 3`) não há como dizer QUAL das três é a #000007, e é o número que
 * o Mercado vende e que o registro do servidor mostra. O desenho é o da Caixa de Fundador, que
 * já era peça numerada negociável: escrow pela linha (`anuncio_id`), troca de dono na mesma
 * transação da compra.
 *
 * ### O que a raridade compra é a FATIA do XP Share
 *
 * A casa não treina mais sozinha. O boneco virou um POSTO: o jogador registra ali um pokémon
 * da EQUIPE, e esse pokémon passa a receber uma fatia do XP que o pokémon de batalha ganha na
 * hunt de verdade. `xpShare` é essa fatia — 25% na Comum, 40% na Incomum, 75% na Rara, 100% na
 * Mítica, 100% na Lendária (a única com DOIS postos).
 *
 * Duas versões ficaram para trás, e as duas pelo mesmo motivo. A primeira era uma escada de
 * BONECOS (1 na Comum … 5 na Lendária): boneco a mais só valia para quem tinha pokémon de
 * sobra parado no Depot, então a casa boa premiava o tamanho da coleção. A segunda foi o
 * treino contra o boneco, com um fator de 25% a 100% do XP de uma hunt do nível do pokémon —
 * e ela era um farm que não exigia atenção nenhuma, rodando em paralelo com a hunt.
 *
 * O XP Share resolve os dois: ele só rende enquanto o jogador está CAÇANDO de verdade, o
 * ganho sai do que ele já está fazendo (não é uma segunda fonte), e o pokémon precisa estar na
 * equipe — cinco lugares, não cinquenta.
 *
 * ### TODAS as casas valem ao mesmo tempo
 *
 * Cada casa tem os seus postos, e o jogador escala um pokémon diferente em cada um. A única
 * trava é o pokémon: o mesmo bicho não ocupa dois postos, nem na mesma casa nem em casas
 * diferentes — senão duas Míticas dariam 200% do XP ao mesmo registrado. O teto de quem recebe
 * continua sendo a EQUIPE (cinco lugares, e o de batalha não recebe), então juntar casas amplia
 * a escolha sem abrir uma segunda fonte de XP.
 *
 * Anunciar uma casa no Mercado solta os pokémon dos postos DELA, e cancelar o anúncio não os
 * devolve: a casa volta vazia e o jogador escala de novo.
 *
 * ### Os pesos do sorteio
 *
 * São os do dono do jogo, e somam 100,005 de propósito — a Lendária é 1 em 20.000 e o número
 * redondo importa mais que a soma fechar. `sortearRaridadeCasa` normaliza pelo total, então
 * qualquer ajuste aqui continua funcionando sem ninguém ter de recalcular as outras quatro.
 */

/**
 * Ordem CRESCENTE de raridade — várias contas dependem disso (ver `melhorCasa`).
 *
 * `rotulo` é o nome em português, o que a tela mostra quando o jogo está em pt (as outras duas
 * línguas saem do i18n, pela chave `casa.rar.<id>`). `en` é o nome do ITEM no catálogo, que é
 * inteiro em inglês como todo o resto de `items.json` — ver `itens-nossos.mjs`.
 *
 * `xpShare` é o número de balanceamento do XP Share; `bonecos`, quantos postos a casa tem — e
 * portanto quantos pokémon da equipe recebem a fatia ao mesmo tempo. A escada tem de ser
 * crescente nos DOIS campos, senão `melhorCasa` deixa de significar "a melhor".
 */
export const RARIDADES_CASA = [
  { id: 'comum', rotulo: 'Comum', en: 'Common', bonecos: 1, xpShare: 0.25, peso: 74.5 },
  { id: 'incomum', rotulo: 'Incomum', en: 'Uncommon', bonecos: 1, xpShare: 0.4, peso: 20 },
  { id: 'rara', rotulo: 'Rara', en: 'Rare', bonecos: 1, xpShare: 0.75, peso: 5 },
  { id: 'mitica', rotulo: 'Mítica', en: 'Mythic', bonecos: 1, xpShare: 1, peso: 0.5 },
  { id: 'lendaria', rotulo: 'Lendária', en: 'Legendary', bonecos: 2, xpShare: 1, peso: 0.005 },
];

export const raridadeCasaPorId = new Map(RARIDADES_CASA.map((r) => [r.id, r]));

/** Quantos dígitos o número da casa ocupa na tela: `#000001`. */
export const DIGITOS_NUMERO_CASA = 6;

/**
 * O número de uma casa como a tela o escreve — `#000042`.
 *
 * Com zeros à esquerda e largura fixa de propósito: numa lista de casas os números se alinham
 * pela direita sem CSS nenhum, e `#000042` diz de relance "a 42ª do servidor" de um jeito que
 * `#42` não diz. Passando de 999.999 a largura simplesmente cresce — não corta.
 */
export const numeroDaCasa = (id) => `#${String(Math.max(0, Math.floor(Number(id) || 0))).padStart(DIGITOS_NUMERO_CASA, '0')}`;

/**
 * Quantas casas valem AO MESMO TEMPO — as "em uso".
 *
 * Ter casa não tem teto: o Fragmento de Chave cai à vontade, e cada sorteio é uma casa a mais na
 * conta. O teto é de USO. Sem ele, quem juntasse vinte Míticas escalaria a equipe inteira a 100%
 * sem escolha nenhuma; com ele a pergunta volta a existir — quais cinco eu deixo valendo? As
 * guardadas continuam sendo do jogador (vendem, entram em uso depois), só não repartem XP.
 */
export const MAX_CASAS_EM_USO = 5;

/** Índice na escada (0 = Comum). `-1` quando o id não existe. */
export const nivelDaRaridade = (id) => RARIDADES_CASA.findIndex((r) => r.id === id);

/** Quantos postos de XP Share a casa oferece. Casa nenhuma = 0 (sem XP Share). */
export const bonecosDaRaridade = (id) => raridadeCasaPorId.get(id)?.bonecos ?? 0;

/**
 * A fatia do XP do pokémon de batalha que o registrado no posto recebe. Casa nenhuma = 0.
 *
 * O zero não é um detalhe: é ele que faz `creditarXpShare` sair sem creditar nada para quem
 * vendeu a casa ou nunca teve uma, sem precisar de um `if` a mais em quem chama.
 */
export const xpShareDaRaridade = (id) => raridadeCasaPorId.get(id)?.xpShare ?? 0;

/**
 * Sorteia a raridade de UMA casa, pelos pesos acima.
 *
 * `aleatorio` entra por parâmetro para o teste conseguir fixar o resultado — sortear com
 * `Math.random()` direto tornaria "confirmar que a Lendária sai 1 em 20.000" um teste
 * estatístico de milhões de rodadas em vez de uma asserção.
 */
export function sortearRaridadeCasa(aleatorio = Math.random) {
  const total = RARIDADES_CASA.reduce((s, r) => s + r.peso, 0);
  let n = aleatorio() * total;
  for (const r of RARIDADES_CASA) {
    if (n < r.peso) return r.id;
    n -= r.peso;
  }
  // Só se chegar aqui por erro de ponto flutuante no último degrau.
  return RARIDADES_CASA[0].id;
}

/**
 * A melhor casa de um inventário — a que manda no XP Share.
 *
 * `itensPorRaridade` é `{ comum: 2, rara: 1 }`; devolve o id da mais rara com quantidade > 0,
 * ou `null` para quem ainda não tem casa nenhuma.
 */
export function melhorCasa(itensPorRaridade) {
  for (let i = RARIDADES_CASA.length - 1; i >= 0; i--) {
    const r = RARIDADES_CASA[i];
    if ((itensPorRaridade?.[r.id] ?? 0) > 0) return r.id;
  }
  return null;
}
