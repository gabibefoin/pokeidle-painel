/**
 * As CAIXAS DE FUNDADOR — o produto da fase beta que é, ao mesmo tempo, item e memória.
 *
 * ### O que uma caixa é
 *
 * Uma caixa é uma PEÇA NUMERADA. Comprar a primeira Caixa de Fundador dá a caixa `#01`, a
 * segunda dá a `#02`, e não existe outra `#01` — nem agora nem nunca. A numeração é a
 * mercadoria: é ela que diferencia duas caixas idênticas no Mercado da Comunidade, e é ela
 * que vira a tag `[Fundador#01]` no chat de quem abrir.
 *
 * Por isso a caixa **não empilha**. No resto do jogo, item é quantidade (`p.items[id] = 12`);
 * aqui cada unidade é uma linha em `caixas_beta` com série própria, como um pokémon. Somar
 * duas caixas numa pilha de "2× Caixa de Fundador" apagaria justamente o que se vende.
 *
 * ### Fechada é mercadoria; aberta é identidade
 *
 * Enquanto está FECHADA, a caixa é transferível: anuncia-se no Mercado, muda de dono, e o
 * número vai junto. Ao ABRIR, os três prêmios saem dela e se prendem à conta — a outfit vai
 * para o armário, a tag se cola ao nick, os diamantes caem no saldo — e a caixa se esvazia
 * para sempre. Não há como reempacotar, e é isso que o aviso de abertura promete.
 *
 * ### Os limites são o produto
 *
 * 50 Caixas de Fundador e 100 de CoFundador, no total, para o servidor inteiro. Passado o
 * limite a loja não vende mais nenhuma — quem quiser terá de comprar de um jogador. O teto é
 * conferido no BANCO, dentro da transação da compra (ver `caixas-db.mjs`), e não neste
 * arquivo: um contador em memória não sobrevive a dois processos de simulação.
 *
 * ### E há um segundo limite: UMA POR JOGADOR, na Loja
 *
 * Cada conta compra no máximo uma Caixa de Fundador e uma de CoFundador. Sem isso, as 50
 * primeiras seriam de quem tem mais diamante e não de quem chegou primeiro — uma conta só
 * levaria a `#01` até a `#10`, e o produto (ser UM dos cinquenta) deixaria de existir.
 *
 * A trava vale só para o BALCÃO. No Mercado da Comunidade não há teto nenhum: ali quem vende é
 * outro jogador, o número já saiu, e colecionar caixas é exatamente o mercado secundário que
 * elas existem para ter. Quem conta é `comprador_id` — a coluna que registra quem comprou na
 * Loja e nunca muda, mesmo que a caixa troque de mão dez vezes depois.
 */

/**
 * Quando a venda ABRE: 7 de setembro de 2026, meia-noite de Brasília (UTC−3).
 *
 * A vitrine mostra as caixas ANTES disso, com o conteúdo à mostra e uma contagem regressiva
 * no lugar do preço. É de propósito: a caixa é peça numerada e limitada, e quem só descobre
 * que ela existe no instante em que ela entra à venda não tem tempo de decidir se quer a
 * `#01`. Mostrar antes é dar esse tempo.
 *
 * O carimbo é ABSOLUTO (UTC) e não "meia-noite local": a data é a do lançamento do jogo, a
 * mesma para o jogador de São Paulo e o de Lisboa, e uma virada por fuso faria a `#01` sair
 * horas antes para quem tem o relógio mais a leste.
 *
 * O servidor pode adiar (ou antecipar) por `CAIXAS_BETA_ABREM` no `.env` — ver
 * `game/caixas.mjs`. Quem decide é sempre ele: a tela só desenha a contagem.
 */
export const CAIXAS_ABREM_EM = Date.UTC(2026, 8, 7, 3, 0, 0);

/**
 * Quantas de CADA tipo uma conta pode comprar na Loja. Uma. Ver a nota "UMA POR JOGADOR".
 *
 * É constante e não configuração: mudá-la depois de a primeira caixa sair reescreveria a
 * promessa feita a quem comprou.
 */
export const COMPRAS_POR_JOGADOR = 1;

/** Looktype das duas outfits. Faixa 909xx = arte NOSSA, fora do atlas (ver `sprites.mjs`). */
export const LOOKTYPE_FUNDADOR = 90930;
export const LOOKTYPE_COFUNDADOR = 90931;

/** itemId das duas caixas. Faixa 70000+ = item nosso (ver `game/itens-nossos.mjs`). */
export const CAIXA_FUNDADOR_ID = 70060;
export const CAIXA_COFUNDADOR_ID = 70061;

/**
 * As duas caixas.
 *
 * `digitos` é o zero à esquerda da série, e ele vem do LIMITE: 50 unidades pedem dois dígitos
 * (`#01`…`#50`), 100 pedem três (`#001`…`#100`). É o que mantém a tag com a mesma largura da
 * primeira à última e o que o pedido descreve ("Fundador#01", "CoFundador#001").
 *
 * `cor` é a cor da tag no chat e do ferro do baú. As duas foram escolhidas CONTRA as que já
 * existem: o verde do Fundador é mais claro que o `--ch-moderador` (#4dff88) e o roxo do
 * CoFundador é mais escuro que o `--ch-streamer` (#b47dff) — senão, num chat que já tem cinco
 * cargos coloridos, a tag nova seria lida como uma das velhas.
 */
export const CAIXAS_BETA = {
  fundador: {
    tipo: 'fundador',
    itemId: CAIXA_FUNDADOR_ID,
    produtoId: 'caixa_fundador',
    looktype: LOOKTYPE_FUNDADOR,
    /** Nome em inglês, como todo o catálogo de itens (ver `itens-nossos.mjs`). */
    nome: 'Founder Box',
    nomeOutfit: 'Founder Outfit',
    /** O prefixo da tag, esse SEM tradução: é um título, não um rótulo de interface. */
    tag: 'Fundador',
    cor: '#9dffc2',
    preco: 150,
    diamantes: 150,
    limite: 50,
    digitos: 2,
    arquivoFonte: 'fundador',
  },
  cofundador: {
    tipo: 'cofundador',
    itemId: CAIXA_COFUNDADOR_ID,
    produtoId: 'caixa_cofundador',
    looktype: LOOKTYPE_COFUNDADOR,
    nome: 'Co-Founder Box',
    nomeOutfit: 'Co-Founder Outfit',
    tag: 'CoFundador',
    cor: '#8e4ae8',
    preco: 100,
    diamantes: 100,
    limite: 100,
    digitos: 3,
    arquivoFonte: 'cofundador',
  },
};

/**
 * A ordem em que as duas aparecem — e a ordem de PRECEDÊNCIA da tag.
 *
 * Quem abrir uma de cada usa a de Fundador: ela é a mais rara (50 contra 100) e a mais cara.
 * Ver `melhorTag`.
 */
export const TIPOS_CAIXA = ['fundador', 'cofundador'];

export const LISTA_CAIXAS = TIPOS_CAIXA.map((t) => CAIXAS_BETA[t]);

const POR_ITEM = new Map(LISTA_CAIXAS.map((c) => [c.itemId, c]));
const POR_LOOKTYPE = new Map(LISTA_CAIXAS.map((c) => [c.looktype, c]));
const POR_PRODUTO = new Map(LISTA_CAIXAS.map((c) => [c.produtoId, c]));

export const caixaPorTipo = (tipo) => CAIXAS_BETA[String(tipo)] ?? null;
export const caixaPorLooktype = (lt) => POR_LOOKTYPE.get(Number(lt)) ?? null;
export const caixaPorProduto = (id) => POR_PRODUTO.get(String(id)) ?? null;

export const ehItemCaixaBeta = (id) => POR_ITEM.has(Number(id));

/** Os looktypes das outfits de caixa — o que `podeEquiparLooktype` precisa reconhecer. */
export const LOOKTYPES_CAIXA_BETA = new Set(POR_LOOKTYPE.keys());

/** "#01", "#007" — a série com os zeros do tipo. */
export function rotuloSerie(tipo, serie) {
  const c = caixaPorTipo(tipo);
  const n = Math.max(0, Math.floor(Number(serie)) || 0);
  return `#${String(n).padStart(c?.digitos ?? 2, '0')}`;
}

/** "[#01]" — só o número, sem o prefixo Fundador/CoFundador (a cor diz o tipo). */
export function textoTag(tipo, serie) {
  return rotuloSerie(tipo, serie);
}

/** "Founder Box #01" — o nome de exibição de UMA caixa, com o número. */
export function nomeDaCaixa(tipo, serie) {
  const c = caixaPorTipo(tipo);
  if (!c) return '';
  return `${c.nome} ${rotuloSerie(tipo, serie)}`;
}

/**
 * De uma lista de tags abertas, a que vale.
 *
 * Fundador ganha de CoFundador; dentro do mesmo tipo, a série MENOR ganha — quem chegou
 * primeiro tem o número que vale mais, e é esse que a pessoa quer mostrar.
 */
export function melhorTag(tags) {
  let melhor = null;
  for (const tag of tags ?? []) {
    if (!caixaPorTipo(tag?.tipo)) continue;
    if (!melhor) { melhor = tag; continue; }
    const a = TIPOS_CAIXA.indexOf(tag.tipo);
    const b = TIPOS_CAIXA.indexOf(melhor.tipo);
    if (a < b || (a === b && Number(tag.serie) < Number(melhor.serie))) melhor = tag;
  }
  return melhor ?? null;
}

/**
 * A tag que o chat mostra — a do que a pessoa está VESTINDO.
 *
 * Quem abriu as duas caixas escolhe qual identidade exibir trocando de roupa no Armário: com a
 * skin de CoFundador no corpo, o chat diz `[CoFundador#001]`; trocou para a de Fundador, o chat
 * acompanha. É a leitura natural — a tag e a roupa são a MESMA coisa dita de dois jeitos, e
 * vê-las discordando ("veste CoFundador, assina Fundador") é o tipo de detalhe que parece bug.
 *
 * Vestindo qualquer outra coisa (um cosplay, o visual padrão), vale `melhorTag`: a tag é
 * conquista, não fantasia, e não some porque a pessoa quis usar outra roupa naquele dia.
 *
 * Dentro do tipo escolhido continua ganhando a série MENOR — quem juntou a `#03` e a `#17` no
 * Mercado mostra a `#03`.
 */
export function tagDoLooktype(tags, looktype) {
  const def = caixaPorLooktype(looktype);
  if (!def) return melhorTag(tags);
  const doTipo = (tags ?? []).filter((t) => t?.tipo === def.tipo);
  return doTipo.length ? melhorTag(doTipo) : melhorTag(tags);
}
