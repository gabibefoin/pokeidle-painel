// DIAMANTES — a moeda que entra com dinheiro de verdade e NÃO volta.
//
// ### Duas moedas pagas, e por que agora são duas
//
// Houve uma versão em que a Loja cobrava em ORB, com o argumento de que duas moedas pagas
// dividiriam a mesma carteira em dois bolsos. O argumento estava errado por um detalhe que só
// aparece do lado do caixa: **as duas moedas não têm a mesma natureza contábil.**
//
//   GEMA (ex-ORB)  tem lastro em USDT e VOLTA — o jogador saca quando quiser. Cada gema em
//                  circulação é passivo do projeto. Por isso ela vive num ledger auditável,
//                  só nasce de depósito, e o spread de 30% é o que paga a operação.
//
//   DIAMANTE       é consumo. Entra por PIX ou cartão, é gasto na Loja e acaba ali. Não saca,
//                  não transfere entre jogadores, não vira USDT. É receita, não passivo.
//
// Misturar as duas obrigava a Loja a queimar passivo em USDT para vender um boost de XP — ou
// seja, a cada compra na Loja o projeto abatia dívida em vez de faturar. Separando, cada moeda
// faz o que sabe: GEMA move valor ENTRE JOGADORES (Mercado da Comunidade), DIAMANTE compra do
// JOGO (Loja).
//
// ### Por que diamante também tem ledger
//
// Ele não tem lastro, mas tem NOTA FISCAL: alguém pagou R$ por ele. As três razões do ledger de
// ORB valem igual — auditoria (a soma tem de bater com o que o provedor de pagamento diz que
// recebemos), reconstrução (o saldo sai de um `SUM`) e detecção de bug. E há uma quarta, que é
// só daqui: o crédito chega por WEBHOOK, num processo que não é o dono do jogador em memória.
// Ver `diamantes-db.mjs` para o desenho da entrega.
import { randomUUID } from 'node:crypto';

// ------------------------------------------------------------------- preços

/**
 * Preço do diamante por FAIXA DE QUANTIDADE, em centavos de real.
 *
 * A tabela é a definida pelo produto:
 *
 *     1 – 99      R$ 0,44
 *     100 – 149   R$ 0,42
 *     150 – 199   R$ 0,40
 *     200 +       R$ 0,38
 *
 * Em ordem DECRESCENTE de corte — `precoUnitario` devolve a primeira faixa que couber, então
 * inverter a ordem faria a de 100 engolir as de cima e o desconto maior nunca sairia.
 */
export const FAIXAS = [
  { minimo: 200, centavos: 38 },
  { minimo: 150, centavos: 40 },
  { minimo: 100, centavos: 42 },
  { minimo: 1, centavos: 44 },
];

/** O preço cheio da faixa em que aquela quantidade cai. */
export const precoUnitario = (qtd) => FAIXAS.find((f) => qtd >= f.minimo)?.centavos ?? FAIXAS.at(-1).centavos;

/** O preço da menor quantidade — o que a vitrine mostra como "a partir de". */
export const CENTAVOS_POR_DIAMANTE = FAIXAS.at(-1).centavos;

/**
 * Compra mínima, em centavos.
 *
 * R$ 1,00 é o piso dos dois provedores com folga (o mínimo do Stripe em BRL é R$ 0,50) e
 * ainda deixa a primeira faixa da tabela utilizável: 3 diamantes já passam.
 */
export const MINIMO_CENTAVOS = 100;

/** Quantos diamantes é preciso comprar para alcançar o mínimo em reais. */
export const QTD_MINIMA = Math.ceil(MINIMO_CENTAVOS / CENTAVOS_POR_DIAMANTE);

/** Teto por compra. Não é limite de riqueza — é limite de estrago num acidente. */
export const QTD_MAXIMA = 100_000;

export class ErroDiamantes extends Error {
  constructor(chave) {
    super(chave);
    this.chave = chave;
  }
}

/**
 * Preço total de N diamantes, em centavos.
 *
 * Estoura em vez de devolver 0 para quantidade inválida: este número vira cobrança, e um preço
 * "0" que passa silenciosamente é um produto de graça.
 *
 * ### O degrau, e por que ele não existe aqui
 *
 * Faixa por volume tem um efeito colateral conhecido: na véspera do corte, comprar MENOS custa
 * MAIS. Nesta tabela ele é grande — 99 diamantes a R$ 0,44 dão R$ 43,56, e 100 a R$ 0,42 dão
 * R$ 42,00. Quem digitasse 99 pagaria mais caro por menos diamante.
 *
 * O `Math.min` contra os cortes acima resolve: o preço de qualquer quantidade é o menor entre
 * o dela e o de comprar até o próximo corte. Na prática, quem pede 99 paga os R$ 42,00 dos 100
 * e leva 99 — some o degrau sem tirar nada de quem compra em cima do corte.
 */
export function precoEmCentavos(qtd) {
  if (!Number.isInteger(qtd) || qtd < 1 || qtd > QTD_MAXIMA) {
    throw new ErroDiamantes('diamantes.qtdInvalida');
  }
  const cheio = (n) => Math.round(n * precoUnitario(n));
  const total = FAIXAS
    .filter((f) => f.minimo > qtd)
    .reduce((menor, f) => Math.min(menor, cheio(f.minimo)), cheio(qtd));
  if (total < MINIMO_CENTAVOS) throw new ErroDiamantes('diamantes.minimo');
  return total;
}

/** Centavos efetivos por diamante numa faixa — o "de R$ 0,05 por R$ 0,04" da vitrine. */
export const centavosPorDiamante = (qtd) => Math.round((precoEmCentavos(qtd) / qtd) * 100) / 100;

/**
 * Os pacotes que a tela mostra.
 *
 * As quantidades são os CORTES da tabela (e um valor abaixo do primeiro): é neles que o preço
 * por diamante cai, então são exatamente as compras que valem a pena mostrar. Um card de 300
 * não diria nada que o de 200 já não diga — mesmos R$ 0,38 por unidade.
 *
 * `desconto` é o abatimento contra a primeira faixa, que é o que o jogador compara.
 */
export const PACOTES = [50, 100, 150, 200, 500].map((qtd) => ({
  qtd,
  centavos: precoEmCentavos(qtd),
  centavosUnidade: centavosPorDiamante(qtd),
  desconto: Math.round((1 - centavosPorDiamante(qtd) / FAIXAS.at(-1).centavos) * 100),
}));

// ------------------------------------------------------------------ motivos

/** Por que um diamante se moveu. Vai gravado no ledger e aparece no extrato. */
export const MOTIVO = {
  COMPRA: 'compra', // entrou por PIX ou cartão — a ÚNICA emissão
  LOJA: 'loja', // gastou na Loja (boost, VIP, outfit, bolas…)
  LOJA_ESTORNO: 'loja_estorno', // compra desfeita porque o efeito falhou
  AFILIADO: 'afiliado', // comissão de indicação (só após compra real do indicado)
  VOTO: 'voto', // voto confirmado no TopIdle — recarga por jogador em `game/topidle.mjs`
  GUILD_GLOBAL: 'guild_global', // pódio do ranking Global de guilds, pago no fechamento do mês
  CAIXA_BETA: 'caixa_beta', // a devolução guardada dentro de uma Caixa de Fundador aberta
  AJUSTE_ADMIN: 'ajuste_admin', // correção manual, sempre com nota
  // O ressarcimento de quem investiu na PESCA, paga uma vez quando o modo saiu do jogo:
  // 1 💎 por NÍVEL de pesca. Brinde, não compra — fica fora de `MOTIVOS_QUE_ENCHEM_A_COTA`
  // pelo mesmo motivo do voto: ninguém pagou dinheiro por ele, então não se revende.
  PESCA_RESSARCIMENTO: 'pesca_ressarcimento',
  // Marco de CONVITES do Discord (`/resgatar`, ver `shared/convites.mjs`). Brinde de aquisição,
  // como o voto: fica fora de `MOTIVOS_QUE_ENCHEM_A_COTA` — é o "não comercializável" da escada.
  CONVITE: 'convite',
  // Os três do MERCADO DA COMUNIDADE. Ver `MOTIVOS_DE_TRANSFERENCIA`, logo abaixo.
  MERCADO_ESCROW: 'mercado_escrow', // saiu da mão do vendedor e ficou preso num anúncio
  MERCADO_DEVOLUCAO: 'mercado_devolucao', // o anúncio foi cancelado; voltou para o vendedor
  MERCADO_COMPRA: 'mercado_compra', // chegou à mão do comprador
};

/**
 * Motivos que TRANSFEREM diamante entre jogadores, sem emitir nem queimar.
 *
 * A régua de `MOTIVOS_QUE_EMITEM` é "diamante que nasce fora de um pagamento confirmado é
 * produto entregue de graça". Estes três não nascem: cada `MERCADO_ESCROW` (negativo) é
 * fechado por exatamente um `MERCADO_DEVOLUCAO` ou um `MERCADO_COMPRA` do mesmo tamanho, na
 * MESMA transação em que o anúncio muda de estado. A soma dos três no ledger é sempre zero
 * fora de um anúncio aberto — e o que estiver em aberto é o total em escrow, que
 * `market_anuncios` também sabe dizer. `tools/teste-mercado-diamantes.mjs` confere as duas.
 *
 * Por isso eles ficam FORA de `MOTIVOS_QUE_EMITEM`: entrar lá faria a auditoria contar como
 * receita um diamante que só trocou de dono, e o faturamento deixaria de bater.
 *
 * ### E por que só o diamante COMPRADO pode ser vendido
 *
 * O que se vende no Mercado é um diamante que alguém pagou em dinheiro de verdade (ou ganhou
 * como comissão de uma compra real de outra pessoa — o mesmo lastro). Os brindes (`VOTO`,
 * `GUILD_GLOBAL`, `AJUSTE_ADMIN`) NÃO entram: eles existem para o jogador usar na Loja, e
 * deixá-los virar gema ou Coin transformaria um prêmio de retenção numa torneira de economia
 * — votar viraria farm. A cota mora em `saldoVendavelDeDiamantes`, em `diamantes-db.mjs`.
 *
 * `MERCADO_COMPRA` também fica de fora da cota, e é a mesma régua vista do outro lado: quem
 * COMPROU diamante de outro jogador não pagou por ele em dinheiro nenhum nosso. Se ele pudesse
 * revender, a cota do servidor deixaria de ser limitada pelo que entrou de verdade.
 */
export const MOTIVOS_DE_TRANSFERENCIA = new Set([
  MOTIVO.MERCADO_ESCROW, MOTIVO.MERCADO_DEVOLUCAO, MOTIVO.MERCADO_COMPRA,
]);

/**
 * As ENTRADAS que enchem o balde do diamante vendável: compra em dinheiro e comissão de
 * indicação (que só existe depois de uma compra real de outra pessoa — mesmo lastro).
 *
 * Isto é só o lado das entradas. A cota em si NÃO é uma soma destes motivos: ela é calculada
 * percorrendo o ledger na ORDEM, com um balde de comprado e um de brinde, porque somar ignora
 * que gastar na Loja tira do saldo. Ver `saldoVendavelDeDiamantes`, em `diamantes-db.mjs` —
 * o cabeçalho de lá conta o buraco que a soma tinha.
 *
 * Tudo o que NÃO está aqui cai no balde do brinde, e brinde não se vende: voto no TopIdle,
 * pódio do ranking Global de guilds, Caixa de Fundador, ajuste da administração e o diamante
 * COMPRADO DE OUTRO JOGADOR no Mercado (`MERCADO_COMPRA`) — este último porque quem o recebeu
 * não pagou dinheiro nenhum por ele, e revender fecharia um ciclo sem lastro.
 */
export const MOTIVOS_QUE_ENCHEM_A_COTA = new Set([MOTIVO.COMPRA, MOTIVO.AFILIADO]);

/**
 * Motivos que EMITEM diamante.
 *
 * A régua continua sendo: diamante que nasce fora de um pagamento confirmado é produto
 * entregue de graça, e cada item desta lista precisa de uma razão de negócio escrita.
 *
 * - `COMPRA` — a emissão de verdade, lastreada em dinheiro que entrou.
 * - `AFILIADO` — comissão, e só depois de uma compra real do indicado; o lastro é o mesmo.
 * - `VOTO` — brinde de aquisição. Subir no ranking do TopIdle depende de ter jogador votando, e
 *   é de lá que vem jogador novo. A emissão é limitada por dois lados, os dois conferidos no
 *   banco dentro da transação que credita: a RECARGA por jogador (`RECARGA_MS`, 24 h entre dois
 *   votos que contam, gravada em `topidle_votos.proximo_em`) e quantos votos fecham um diamante
 *   (`VOTOS_POR_DIAMANTE`) — hoje isso dá **um diamante a cada dois dias por jogador**. Há ainda
 *   o vínculo de conta (`MAX_VOTANTES_POR_JOGADOR`), inerte enquanto o TopIdle não mandar
 *   identidade do votante.
 * - `GUILD_GLOBAL` — brinde de retenção/competição, não de aquisição: o pódio do ranking Global
 *   de guilds (`game/guild-global.mjs`) leva diamante uma vez por mês, para dar motivo de
 *   competir sem depender de pagamento. O teto aqui não é uma recarga por jogador — é
 *   ESTRUTURAL: no máximo 3 guilds pagam (TOP1/2/3), no máximo `MAX_TIME_GUILD` (10) ESCALADOS
 *   por guild — a guild pode ter mil membros, mas quem recebe é o time que foi à guerra
 *   (`playerIdsEscalados`) —, valores fixos (`PREMIOS_GLOBAL` em guild-global.mjs, 100/50/10), o
 *   que limita a emissão a ~1.600 diamantes/mês no pior caso — e só sai pódio de guild com `gp_global > 0`
 *   (mesma régua de "com 0 GP ninguém recebe prêmio" que já vale para o bônus de % do diário).
 *
 * - `CAIXA_BETA` — a devolução que vem DENTRO de uma Caixa de Fundador (ver
 *   `shared/caixas-beta.mjs`). É a emissão mais bem lastreada da lista, e por um motivo que não
 *   se repete em nenhuma outra: **cada diamante devolvido foi queimado antes**. A caixa custa
 *   exatamente o que devolve (150 no Fundador, 100 no CoFundador), e comprá-la passa por
 *   `MOTIVO.LOJA`, que queima. Abrir só desfaz a queima daquela unidade — o saldo do servidor
 *   volta ao que era, e o que o jogador comprou de fato foi a outfit e a tag numerada.
 *
 *   O teto é ESTRUTURAL e o menor de todos: 50 × 150 + 100 × 100 = 17.500 diamantes, uma vez
 *   na vida do jogo, porque não existem outras caixas para vender. E ele é conferido no BANCO
 *   — uma caixa aberta duas vezes é impossível pelo `WHERE aberta_em IS NULL` da transação de
 *   abertura (ver `caixas-db.mjs`), que é a mesma que credita.
 *
 * - `CONVITE` — brinde de aquisição, irmão do `VOTO`: os dois primeiros marcos da escada de
 *   convites do Discord (5 💎 com 1 convidado, 10 💎 com 5). É a emissão mais barata da lista e
 *   a mais bem travada por FORA do jogo: cada ponto exige uma conta de Discord com mais de um
 *   ano de idade entrando no servidor por um link daquele jogador, e a data de criação está
 *   cravada no id do Discord — não há como fabricar. Teto por jogador: 15 diamantes na vida,
 *   porque só os dois primeiros degraus pagam em diamante e cada código é de uso único
 *   (`convite_codigos`, com `resgatado_em IS NULL` no WHERE que credita). Daí para cima a
 *   escada paga em boost, bola e VIP, que não passam por aqui.
 *
 * Brinde PONTUAL (evento, compensação) continua não entrando aqui: o caminho é
 * `AJUSTE_ADMIN` com nota, que aparece no extrato do jogador e na auditoria.
 */
export const MOTIVOS_QUE_EMITEM = new Set([
  MOTIVO.COMPRA, MOTIVO.AFILIADO, MOTIVO.VOTO, MOTIVO.GUILD_GLOBAL, MOTIVO.CAIXA_BETA,
  MOTIVO.CONVITE,
]);

/** Motivos que QUEIMAM diamante. Gastar na Loja tira a unidade de circulação para sempre. */
export const MOTIVOS_QUE_QUEIMAM = new Set([MOTIVO.LOJA]);

// -------------------------------------------------------------- pagamento

/**
 * O ciclo de vida de um pagamento.
 *
 * ```
 *   PENDENTE ──(webhook ou reconciliação)──▶ PAGO ──▶ (crédito na caixa postal)
 *      │
 *      └──▶ EXPIRADO (ninguém pagou; nada acontece)
 * ```
 *
 * `PAGO` e "creditado" são estados SEPARADOS de propósito: entre confirmar o pagamento e somar
 * o saldo do jogador existe uma troca de processo (ver `diamantes-db.mjs`), e um único estado
 * não saberia dizer se a falha foi antes ou depois do dinheiro entrar.
 */
export const PAGAMENTO = {
  PENDENTE: 'pendente',
  PAGO: 'pago',
  EXPIRADO: 'expirado',
};

/** Os dois caminhos de pagamento. `pix` é Efí; `cartao` é Stripe Checkout. */
export const METODOS = ['pix', 'cartao'];

/**
 * Quanto tempo um pagamento pendente continua valendo.
 *
 * Depois disso a reconciliação para de perguntar ao provedor por ele. Não é um cancelamento:
 * se o webhook chegar atrasado, o crédito ainda acontece — o carimbo só existe para a varredura
 * periódica não crescer sem fim.
 */
export const VALIDADE_MS = 24 * 3600_000;

/**
 * Referência do pagamento: o que amarra a nossa linha ao registro do provedor.
 *
 * UUID sem hífen — 32 caracteres alfanuméricos. Ao Stripe o formato é indiferente, mas a Efí usa
 * esta mesma referência como `txid` da cobrança Pix (`PUT /v2/cob/:txid`), que exige entre 26 e
 * 35 caracteres só de letras e números. Tirar os hífens é o que faz UM formato servir aos dois.
 */
export const novaReferencia = () => randomUUID().replace(/-/g, '');

/** "R$ 12,50" a partir de centavos — usado na descrição que vai para o provedor. */
export const emReais = (centavos) => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;

/**
 * Valida CPF (11 dígitos + os dois dígitos verificadores). Devolve só os dígitos, ou lança.
 *
 * O CPF é coletado no checkout do **PIX** (só nele) porque a nota fiscal precisa identificar o
 * tomador e nem o Stripe nem a Efí devolvem o CPF em claro (a Efí manda mascarado, o Stripe
 * não manda). No cartão não é pedido — o pagador costuma ser estrangeiro, sem CPF. Nome e
 * e-mail vêm de outras fontes (provedor e conta). O painel de admin ("Emissão de Notas")
 * exporta essas compras por mês para importar na contabilidade.
 */
export function cpfValido(entrada) {
  const cpf = String(entrada ?? '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    throw new ErroDiamantes('diamantes.cpfInvalido');
  }
  const dv = (base) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  if (dv(cpf.slice(0, 9)) !== Number(cpf[9]) || dv(cpf.slice(0, 10)) !== Number(cpf[10])) {
    throw new ErroDiamantes('diamantes.cpfInvalido');
  }
  return cpf;
}

/**
 * O que a tela precisa saber para desenhar a compra.
 *
 * `pixAtivo`/`cartaoAtivo` são separados porque as duas integrações são independentes: dá para
 * subir com só uma configurada, e a tela tem de esconder o botão da outra em vez de oferecer um
 * caminho que vai dar 503.
 */
export const painelDeCompra = ({ pixAtivo, cartaoAtivo }) => ({
  ativo: pixAtivo || cartaoAtivo,
  pixAtivo,
  cartaoAtivo,
  pacotes: PACOTES,
  minimoCentavos: MINIMO_CENTAVOS,
  qtdMinima: QTD_MINIMA,
  qtdMaxima: QTD_MAXIMA,
  centavosUnidade: CENTAVOS_POR_DIAMANTE,
  faixas: FAIXAS,
});
