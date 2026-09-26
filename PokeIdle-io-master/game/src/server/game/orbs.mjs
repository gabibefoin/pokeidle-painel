// ORBs — a moeda que entra com dinheiro de verdade e sai com dinheiro de verdade.
//
// ### O modelo: custodial, e o ledger é a fonte de verdade
//
// Nada disto é on-chain. Não há NFT, não há contrato, não há token nosso. Existem só duas
// pontes com a blockchain, nas bordas:
//
//     USDT do jogador  ──depósito──▶  CARTEIRA DO PROJETO  ──saque──▶  USDT do jogador
//                                            │
//                                     (saldo de ORBs vive
//                                      no Postgres, aqui)
//
// Entre as duas pontas, ORB é uma linha de banco. Comprar pokémon, vender no market, trocar
// por ouro — tudo isso é `UPDATE` numa transação, sem taxa de rede e sem esperar bloco.
//
// ### A regra que mantém o caixa solvente
//
// **ORB só nasce de compra.** Nunca de drop, quest, boss ou qualquer coisa que o jogo dê de
// graça. É o que sustenta a conta inteira: todo ORB que alguém saca a `PRECO_SAQUE` foi
// comprado por alguém a `PRECO_COMPRA`, que é mais caro. Se o jogo emitisse ORB, cada
// unidade emitida viraria um passivo em USDT sem lastro nenhum e o caixa fura sozinho.
//
// Transferência entre jogadores (venda no market) é permitida à vontade: ela MOVE ORB, não
// cria. `registrar()` recusa qualquer movimento sem um par de origem/destino declarado.
//
// ### O spread
//
// Compra a `PRECO_COMPRA`, recompra a `PRECO_SAQUE`. A margem é `1 − saque/compra`, hoje 10%.
// Não é taxa por transação: é a diferença entre as duas pontas, e é dela que saem servidor,
// desenvolvimento e a taxa de rede do saque.
//
// ### Contabilidade: append-only
//
// `players.orbs` é um CACHE. A verdade é `orb_ledger`, uma linha por movimento, que nunca é
// atualizada nem apagada. Todo `UPDATE` do saldo acontece na mesma transação que insere a
// linha — é o que permite auditar o caixa somando a tabela e comparando com a carteira, e é
// o que dá para reconstruir o saldo de qualquer jogador se algo der errado.
import { randomUUID } from 'node:crypto';

// ------------------------------------------------------------------- preços

/**
 * Preço de COMPRA de uma ORB, em USDT. O jogador paga isto.
 *
 * Em USDT (6 casas na maioria das redes), então 0,01 é exatamente 10.000 unidades mínimas —
 * sem dízima e sem arredondamento traiçoeiro na conversão.
 */
export const PRECO_COMPRA = 0.01;

/**
 * Preço de RECOMPRA. O jogador recebe isto ao sacar. 10% abaixo da compra.
 *
 * ### Por que o saque é MENOR que a comissão do mercado (10% contra 15%)
 *
 * Os dois números fazem trabalhos diferentes e igualá-los era acidente, não projeto.
 *
 * A comissão do mercado é um RALO de gema: existe contra inflação, é paga dentro do jogo e
 * 15% é a régua que a Steam já ensinou a todo mundo. O spread do saque é outra coisa — é o
 * pedágio para SAIR, e é nele que o jogador decide se o projeto é confiável ou é armadilha.
 *
 * O custo real de rede não justifica nenhum dos dois: na Solana um saque custa 0,000005 SOL
 * de taxa base, mais 0,00203928 SOL de aluguel APENAS na primeira vez de cada jogador (a
 * conta de token é criada com `Idempotent`, ver `chain.mjs`). No saque mínimo de 1.000 ORBs,
 * 10% rende US$ 1,00 contra US$ 0,31–0,51 de custo no pior caso — cobre 2 a 3 vezes já na
 * estreia, e mais de mil vezes nos saques seguintes. O que o spread financia é servidor e
 * desenvolvimento, que são custo fixo, e não gás.
 *
 * O que ainda justifica 10% e não menos: sem atrito, o jogo vira trilho de transferência de
 * dinheiro, e o caixa em USDT sangra sem contrapartida.
 *
 * As duas taxas se MULTIPLICAM para quem vende gema e depois saca. Em 30/30 sobravam 49% do
 * valor; em 15/10 sobram 76,5%.
 *
 * 0,009 e não 0,00900…: em USDT de 6 casas isso é 9.000 unidades mínimas, exato, sem dízima
 * na conversão — a mesma razão de a compra ser 0,01.
 */
export const PRECO_SAQUE = 0.009;

/** A margem, derivada — publicada na tela para o jogador saber exatamente o spread. */
export const SPREAD = 1 - PRECO_SAQUE / PRECO_COMPRA;

/**
 * Saque mínimo.
 *
 * Existe por causa da TAXA DE REDE: o primeiro saque de cada jogador carrega o aluguel da
 * conta de token (0,00203928 SOL, ver `chain.mjs`), e sacar 10 ORBs — 9 centavos — custaria
 * mais caro do que vale. 1.000 ORBs são US$ 9,00.
 */
export const SAQUE_MINIMO_ORBS = 1000;

/** Teto por saque. Não é limite de riqueza — é limite de estrago num acidente. */
export const SAQUE_MAXIMO_ORBS = 1_000_000;

// -------------------------------------------------------------- estados

/**
 * O ciclo de vida de um saque.
 *
 * ```
 *   AGUARDANDO ──(admin aprova)──▶ PENDENTE ──▶ ENVIANDO ──▶ CONFIRMADO
 *        │                            │            │
 *        │                            │            └──▶ FALHOU ──(1h + …)──▶ ENVIANDO
 *        └──▶ CANCELADO (devolve)      └──▶ CANCELADO (devolve)
 * ```
 *
 * `PENDENTE` já tem as ORBs debitadas. Debitar só na hora do envio abriria a janela clássica:
 * dois saques do mesmo saldo aprovados antes de qualquer um dos dois sair.
 */
export const SAQUE = {
  AGUARDANDO: 'aguardando_aprovacao',
  PENDENTE: 'pendente',
  ENVIANDO: 'enviando',
  CONFIRMADO: 'confirmado',
  FALHOU: 'falhou',
  CANCELADO: 'cancelado',
};

/**
 * Quanto se espera antes de PODER reenviar um saque que falhou.
 *
 * Uma hora, e é o número mais importante deste arquivo.
 *
 * O risco real não é o saque falhar — é ele ter dado CERTO e a gente não ter visto. Broadcast
 * que dá timeout, RPC que responde erro depois de aceitar, nó fora de sincronia: em todos
 * esses casos a transação pode estar na blockchain enquanto o nosso banco acha que falhou.
 * Reenviar em cima disso paga o jogador DUAS VEZES, e não há como desfazer.
 *
 * Uma hora é folga suficiente para qualquer transação pendente ou cair ou ser descartada
 * definitivamente pela rede. E o tempo sozinho não basta: `podeReenviar` também exige uma
 * reconferência on-chain do hash antigo antes de liberar (ver `orbsServico.reenviar`).
 */
export const REENVIO_DELAY_MS = 60 * 60_000;

/** Confirmações on-chain para considerar um depósito ou saque definitivo. */
export const CONFIRMACOES = 12;

// --------------------------------------------------------------- conversões

/** ORBs → USDT que o jogador recebe num saque. */
export const orbsParaUsdt = (orbs) => arredondar6(orbs * PRECO_SAQUE);

/** USDT → ORBs que o depósito credita. Trunca: nunca credita fração de ORB a mais. */
export const usdtParaOrbs = (usdt) => Math.floor(usdt / PRECO_COMPRA);

/** USDT tem 6 casas na maioria das redes. Arredondar antes evita poeira de ponto flutuante. */
export const arredondar6 = (v) => Math.round(v * 1e6) / 1e6;

// ------------------------------------------------------------------ motivos

/** Por que uma ORB se moveu. Vai gravado no ledger e aparece no extrato do jogador. */
export const MOTIVO = {
  COMPRA: 'compra', // entrou por depósito de USDT — a ÚNICA emissão
  SAQUE: 'saque', // saiu para a carteira do jogador
  SAQUE_ESTORNO: 'saque_estorno', // saque cancelado/falho devolvido
  MARKET_VENDA: 'market_venda', // recebeu de outro jogador
  MARKET_COMPRA: 'market_compra', // pagou outro jogador
  LOJA: 'loja', // gastou na loja VIP (boost, VIP, outfit…)
  LOJA_ESTORNO: 'loja_estorno', // compra desfeita porque o efeito falhou
  AFILIADO: 'afiliado', // comissão de indicação (só após depósito real do indicado)
  AJUSTE_ADMIN: 'ajuste_admin', // correção manual, sempre com nota
};

/**
 * Motivos que EMITEM ORB (aumentam o total em circulação).
 *
 * São DOIS, e a diferença entre eles é a coisa mais importante deste arquivo:
 *
 * · `COMPRA` nasce COM LASTRO. Entrou US$ 1 de USDT no caixa, nasceram 100 ORBs. Passivo e
 *   ativo crescem juntos e o caixa não sente.
 *
 * · `AFILIADO` nasce SEM LASTRO. São 5% (`PCT_ORB_COMISSAO`) do depósito do indicado, pagos
 *   ao padrinho em gema nova, sem um centavo de USDT entrando junto. Um depósito de US$ 10
 *   cria 1.000 ORBs de lastro e 1.050 de passivo. É intencional: é custo de marketing, e
 *   quem paga é o spread.
 *
 * **O limite, então, não é "zero emissão sem lastro" — é o spread cobrir a emissão extra.**
 * Com 5% de comissão, o caixa só fecha enquanto:
 *
 *     PRECO_SAQUE × (1 + PCT_ORB_COMISSAO) < PRECO_COMPRA
 *     0,009 × 1,05 = 0,00945  <  0,01        ✓  (ponto de ruína: 0,0095238)
 *
 * Em 10% de spread sobram 5,5% do depósito indicado no pior caso — o do jogador que deposita
 * e saca sem nunca negociar. Quem usa a gema para o que ela existe deixa muito mais, porque a
 * comissão do mercado queima 15% a cada troca (ver `MOTIVOS_QUE_QUEIMAM`).
 *
 * Mexer em `PRECO_SAQUE` ou em `PCT_ORB_COMISSAO` sem refazer essa conta fura o caixa.
 */
export const MOTIVOS_QUE_EMITEM = new Set([MOTIVO.COMPRA, MOTIVO.AFILIADO]);

/**
 * Motivos que QUEIMAM ORB (diminuem o total em circulação).
 *
 * `SAQUE` é o único que queima de verdade hoje — e queima os dois lados: sai o ORB do
 * passivo e sai o USDT do caixa.
 *
 * `LOJA` está na lista mas **não acontece com gema**. A Loja VIP cobra em DIAMANTE (ver
 * `game/loja.mjs`); houve uma versão em que ela cobrava em gema, e o caminho de débito em
 * `orbs-db.mjs` sobrou de lá. Fica na lista porque é barato e porque, se a loja algum dia
 * voltar a aceitar gema, a contabilidade já está certa — mas ninguém deve contar com esse
 * ralo ao dimensionar o spread, porque ele não escoa nada.
 *
 * ### O ralo que existe de verdade e NÃO está nesta lista
 *
 * A comissão do Mercado da Comunidade (`TAXA_ORB`, 15%) queima gema sem passar por motivo
 * nenhum: o comprador é debitado do valor CHEIO (`MARKET_COMPRA`) e o vendedor é creditado
 * do LÍQUIDO (`MARKET_VENDA`). A diferença não vai para ninguém — some. Somar o ledger
 * mostra isso como saldo negativo entre os dois motivos, e é a única saída de gema que NÃO
 * leva USDT junto.
 *
 * É por isso que ela é o que sustenta o caixa: cada troca de gema entre jogadores devolve
 * 15% de passivo ao projeto de graça. Gema parada não rende nada; gema girando, sim.
 */
export const MOTIVOS_QUE_QUEIMAM = new Set([MOTIVO.SAQUE, MOTIVO.LOJA]);

// ------------------------------------------------------------- validação

/**
 * Endereços aceitos por rede.
 *
 * A validação de formato é a primeira barreira contra o erro mais caro que existe aqui:
 * mandar USDT para um endereço malformado ou de outra rede. **Não há como desfazer.** Por
 * isso o formato é conferido no servidor (não só na tela) e o aviso de confirmação repete o
 * endereço inteiro para o jogador reler.
 *
 * Redes suportadas — as três mais baratas para USDT:
 *   · `solana`  — SPL USDT. Taxa ~US$ 0,0005. Endereço base58 de 32 a 44 caracteres.
 *   · `bsc`     — BEP-20. Taxa ~US$ 0,10. Endereço EVM.
 *   · `polygon` — ERC-20 na Polygon. Taxa ~US$ 0,01. Endereço EVM.
 */
export const REDES = {
  solana: {
    id: 'solana',
    nome: 'Solana (SPL)',
    regex: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    explorer: (a) => `https://solscan.io/account/${a}`,
    explorerTx: (h) => `https://solscan.io/tx/${h}`,
  },
  bsc: {
    id: 'bsc',
    nome: 'BNB Smart Chain (BEP-20)',
    regex: /^0x[a-fA-F0-9]{40}$/,
    explorer: (a) => `https://bscscan.com/address/${a}`,
    explorerTx: (h) => `https://bscscan.com/tx/${h}`,
  },
  polygon: {
    id: 'polygon',
    nome: 'Polygon (ERC-20)',
    regex: /^0x[a-fA-F0-9]{40}$/,
    explorer: (a) => `https://polygonscan.com/address/${a}`,
    explorerTx: (h) => `https://polygonscan.com/tx/${h}`,
  },
};

export const enderecoValido = (rede, endereco) =>
  !!REDES[rede]?.regex.test(String(endereco ?? '').trim());

// ------------------------------------------------------- pedido de saque

/**
 * Valida um pedido de saque ANTES de tocar em qualquer saldo.
 *
 * Só valida — quem debita e grava é `orbsServico.pedirSaque`, numa transação. Separar as
 * duas coisas é o que deixa a regra testável sem banco.
 *
 * @returns {{ok:true, orbs, usdt, endereco, rede}|{ok:false, erro:string}}
 */
export function validarSaque({ orbs, rede, endereco, saldo }) {
  const n = Math.floor(Number(orbs));
  if (!Number.isFinite(n) || n <= 0) return { ok: false, erro: 'quantidade inválida' };
  if (n < SAQUE_MINIMO_ORBS) return { ok: false, erro: `saque mínimo: ${SAQUE_MINIMO_ORBS} Gemas` };
  if (n > SAQUE_MAXIMO_ORBS) return { ok: false, erro: `saque máximo: ${SAQUE_MAXIMO_ORBS} Gemas` };
  if (n > saldo) return { ok: false, erro: 'saldo de Gemas insuficiente' };
  if (!REDES[rede]) return { ok: false, erro: 'rede não suportada' };

  const end = String(endereco ?? '').trim();
  if (!enderecoValido(rede, end)) return { ok: false, erro: `endereço inválido para ${REDES[rede].nome}` };

  return { ok: true, orbs: n, usdt: orbsParaUsdt(n), endereco: end, rede };
}

/**
 * Este saque pode ser reenviado agora?
 *
 * Duas condições, e as duas são obrigatórias:
 *   1. está em `FALHOU` (nunca reenviar algo em `ENVIANDO` — pode estar no ar);
 *   2. já se passou `REENVIO_DELAY_MS` desde a tentativa.
 *
 * A terceira condição — o hash antigo não ter caído na blockchain — não dá para checar aqui,
 * porque exige rede. Ela mora em `orbsServico.reenviar`, e é lá que o pagamento em dobro é
 * de fato impedido.
 */
export function podeReenviar(saque, agora) {
  if (saque.status !== SAQUE.FALHOU) return { ok: false, erro: 'este saque não está em falha' };
  const liberaEm = (saque.tentadoEm ?? 0) + REENVIO_DELAY_MS;
  if (agora < liberaEm) {
    const min = Math.ceil((liberaEm - agora) / 60_000);
    return { ok: false, erro: `reenvio libera em ~${min} min`, liberaEm };
  }
  return { ok: true };
}

/** Id de saque: opaco, gerado por nós, e é o que o jogador cita num suporte. */
export const novoIdSaque = () => randomUUID();

/**
 * Referência de depósito.
 *
 * Como TODOS os depósitos caem na mesma carteira do projeto, o que amarra um pagamento ao
 * jogador certo é este código — ele vai no memo (Solana) ou é conferido pelo endereço de
 * origem já cadastrado (EVM). Curto o bastante para digitar e único o bastante para não
 * colidir.
 */
export const novaReferencia = () => randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();

// ------------------------------------------------------------ transparência

/**
 * O painel público do caixa.
 *
 * Depósitos creditam ORB quando o USDT chega no endereço do jogador; a varredura junta na
 * tesouraria pública depois. Por isso:
 *   arrecadado = SUM(orb_depositos)
 *   em caixa    = saldo on-chain da tesouraria
 *   aguardando  = arrecadado − sacado − colheitas − em caixa
 */
export function resumoDoCaixa({
  compradoUsdt,
  sacadoUsdt,
  orbsEmCirculacao,
  naCarteira = null,
  colheitasUsdt = 0,
}) {
  const arrecadado = arredondar6(compradoUsdt);
  const sacado = arredondar6(sacadoUsdt);
  const colheitas = arredondar6(colheitasUsdt);
  const contabil = arredondar6(compradoUsdt - sacadoUsdt);

  let emCaixa;
  let aguardandoRecolhaUsdt;
  if (naCarteira != null && Number.isFinite(naCarteira)) {
    emCaixa = arredondar6(naCarteira);
    aguardandoRecolhaUsdt = Math.max(0, arredondar6(arrecadado - sacado - colheitas - emCaixa));
  } else {
    emCaixa = contabil;
    aguardandoRecolhaUsdt = 0;
  }

  return {
    arrecadadoUsdt: arrecadado,
    sacadoUsdt: sacado,
    emCaixaUsdt: emCaixa,
    aguardandoRecolhaUsdt,
    colheitasUsdt: colheitas,
    orbsEmCirculacao,
    // O que o projeto DEVE se todo mundo sacasse tudo agora. É o número honesto para medir
    // solvência, e é ele que precisa ficar abaixo do caixa.
    passivoUsdt: arredondar6(orbsEmCirculacao * PRECO_SAQUE),
    precoCompra: PRECO_COMPRA,
    precoSaque: PRECO_SAQUE,
    spreadPct: Math.round(SPREAD * 100),
  };
}
