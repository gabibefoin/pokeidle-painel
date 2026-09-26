// Comissões de afiliados — regras de negócio e limites econômicos.
//
// 10% dos diamantes comprados pelo indicado e 5% das gemas (ORBs) depositadas. São custo de
// marketing: saem do lucro da operação, não do bolso do comprador. A comissão só nasce quando
// há pagamento real confirmado.
//
// ### A de GEMA emite passivo sem lastro — e é ela que limita o spread
//
// Os 5% em gema não são um repasse: são gema NOVA, criada sem USDT entrando junto (por isso
// `MOTIVO.AFILIADO` está em `MOTIVOS_QUE_EMITEM`, em `orbs.mjs`). Um depósito de US$ 10 cria
// 1.000 ORBs de lastro e 1.050 de passivo.
//
// Quem paga é o spread do saque, e a conta tem um piso:
//
//     PRECO_SAQUE × (1 + PCT_ORB_COMISSAO) < PRECO_COMPRA
//
// Hoje: 0,009 × 1,05 = 0,00945 < 0,01 ✓ — o caixa fecha com 5,5% de folga no pior caso.
// O ponto de ruína é spread de 4,76%. Subir esta porcentagem OU baixar o spread sem refazer
// essa conta fura o caixa.
//
// A de DIAMANTE não tem esse problema: diamante não é resgatável em dinheiro, então emitir
// 10% a mais não cria passivo nenhum — só dilui uma moeda que o projeto imprime de qualquer
// jeito.
import { PRECO_COMPRA, PRECO_SAQUE } from './orbs.mjs';

/** Fração dos diamantes comprados que o indicador recebe, quando não há taxa própria. */
export const PCT_DIA_COMISSAO = 0.10;

/** Fração das gemas depositadas que o indicador recebe, quando não há taxa própria. */
export const PCT_ORB_COMISSAO = 0.05;

/** Código de convite: letras maiúsculas e números, sem caracteres ambíguos. */
export const CODIGO_OK = /^[A-HJ-NP-Z2-9]{6,8}$/;

// ------------------------------------------------------ referral especial
//
// O "Referral Especial" é o mesmo programa com quatro coisas destravadas por conta, no painel:
// a taxa de cada moeda, um bônus em diamante sobre o depósito de gema, um link personalizado
// (`?ref=matta`) e o selo que o jogador vê como **Influenciador Oficial** (a coluna se chama
// `streamer_oficial` porque é para streamer que o acordo existe; o nome de vitrine é outro, e
// os dois convivem de propósito). Existe para parceria com streamer relevante — quem traz
// jogador em volume negocia a fatia, e a régua não é lucro por indicado: é não dar prejuízo.
//
// ### A taxa de GEMA não é negociável até onde se queira: ela tem um teto aritmético
//
// A conta do topo deste arquivo, resolvida para a taxa em vez de para o spread:
//
//     PRECO_SAQUE × (1 + T) ≤ PRECO_COMPRA     ⟺     T ≤ PRECO_COMPRA/PRECO_SAQUE − 1
//
// Com 0,01 e 0,009 isso dá **11,11%**, e é o ponto em que o caixa empata.
//
// A leitura que torna isso concreto é acompanhar UM depósito de US$ 10 (= 1.000 gemas), que é a
// forma como a decisão de fato se apresenta:
//
//     taxa      o padrinho leva        o jogador saca     SOBRA PARA O PROJETO
//      5%       50 gemas = US$ 0,45      US$ 9,00            US$ 0,55
//     10%      100 gemas = US$ 0,90      US$ 9,00            US$ 0,10
//     11,11%   111 gemas = US$ 1,00      US$ 9,00            US$ 0,00   ← empate
//     15%      150 gemas = US$ 1,35      US$ 9,00          − US$ 0,35
//
// **Aquele US$ 1 de diferença entre US$ 10 que entram e US$ 9 que saem é o ÚNICO dinheiro que
// existe nesta operação**, e a comissão sai inteira de lá. A 5% ela come 45% dele; a 10%, 90%.
//
// Daí a armadilha de linguagem que quase passou batido: dar ao padrinho "10% dos US$ 10", ou
// seja US$ 1,00 em dinheiro, NÃO é uma taxa de 10% — são US$ 1,00 ÷ 0,009 = 111 gemas, que são
// 11,11% do depósito. A gema é vendida a US$ 0,01 e recomprada a US$ 0,009, então dar 10% do
// DINHEIRO custa 11,11% das GEMAS, e cai exatamente em cima do ponto de empate.
//
// **Acima de 11,11% não é "margem menor": é arbitragem lucrativa.** Depositar US$ 100 passa a
// devolver US$ 103,50 em saque, com a diferença saindo da tesouraria em USDT. Não depende de
// fraude nem de multi-conta — vale para o indicado honesto que deposita, desiste e saca. E é
// repetível sem limite: a comissão incide em TODO depósito, não só no primeiro.
//
// ### E o empate ainda não é o limite de verdade, por causa do custo de rede
//
// A tabela acima ignora que o primeiro saque de cada jogador paga o aluguel da conta de token
// na Solana — US$ 0,31 a 0,51, uma vez por jogador (ver `chain.mjs` e o cabeçalho de
// `orbs.mjs`). Esse custo é FIXO, então ele não escala com a taxa: ele decide um TAMANHO DE
// DEPÓSITO abaixo do qual o indicado dá prejuízo mesmo com a taxa dentro do teto.
//
//     taxa     margem do depósito     indicado só compensa acima de
//      5%           5,50%                    US$ 7,27
//      10%          1,00%                    US$ 40,00
//
// É `depositoDeEquilibrio`, e o painel mostra o número ao lado do campo. **Não é um limite**: a
// decisão de produto é que esse custo de rede sai da receita de DIAMANTE (BRL), comprada por
// fora, e não da tesouraria de gema — é o preço de ter o parceiro divulgando, e é aceito de
// olho aberto. O número fica na tela como informação, não como bloqueio.
//
// O que continua sendo regra dura é a tesouraria de GEMA nunca ficar negativa. É ela que tem
// passivo sacável, e é ela que o teto de 10% protege.
//
// **O argumento de que "15% é o que ele gastaria no mercado mesmo" confunde dois números.**
// A taxa do Mercado (`TAXA_ORB`, 15%) QUEIMA gema que já existe — só acontece se a gema girar
// entre jogadores, e devolve passivo ao projeto. A comissão CRIA gema que não existia, e
// acontece sempre. Uma não paga a outra: para 15% empatar, ~22% de todo o passivo daquele
// depósito precisaria passar pelo Mercado antes de alguém sacar. É premissa de comportamento,
// e o caminho que quebra o caixa — depositar e sacar — é justamente o que não tem giro nenhum.
//
// ### O diamante não tem teto de solvência — e é por ele que a fatia grande deve crescer
//
// Diamante não saca e não vira USDT: 10% ou 30% é a mesma emissão de uma moeda que o projeto
// imprime. O custo é venda deslocada, não caixa. Por isso o teto dele é só limite de estrago
// contra erro de digitação.
//
// É daí que sai `TAXA_DIA_EXTRA`: o jeito de prometer "15% do depósito" a um streamer sem
// furar o caixa é pagar 5% em gema (dentro do limite) e os 10 pontos restantes em DIAMANTE,
// convertidos por `GEMAS_POR_DIAMANTE`. O parceiro recebe o valor combinado; a tesouraria
// continua retendo os mesmos US$ 5,50 por US$ 100 de hoje.

/**
 * Onde a comissão de gema empata o caixa: `PRECO_COMPRA/PRECO_SAQUE − 1` = 11,11%.
 *
 * Derivado, e não escrito à mão, porque ele TEM de acompanhar o spread: mudar `PRECO_SAQUE`
 * sem mexer aqui é exatamente o furo que o cabeçalho do `orbs.mjs` avisa. O servidor RECUSA
 * qualquer taxa acima disto — ver a nota sobre arbitragem, acima.
 */
export const TETO_ORB_RUINA = PRECO_COMPRA / PRECO_SAQUE - 1;

/**
 * O teto que o painel de fato aplica: **10%**, e o servidor recusa acima disto.
 *
 * Não é `TETO_ORB_RUINA`. É uma decisão de produto, tomada com a conta na mão: encostar no
 * empate deixaria o projeto com US$ 0,001 por US$ 10 depositados, que não paga nem o gás do
 * saque, e qualquer erro de arredondamento futuro cairia do lado errado. 10% é redondo,
 * explicável a um parceiro, e guarda os US$ 0,10 de folga por US$ 10.
 *
 * Fica abaixo de `TETO_ORB_RUINA` por construção — a asserção vive em `tools/teste-afiliados.mjs`.
 * Se algum dia o spread do saque diminuir a ponto de a ruína cair abaixo de 10%, é a ruína que
 * manda: quem valida usa o MENOR dos dois (`tetoDaGema`).
 */
export const TETO_ORB_MAX = 0.10;

/** O teto efetivo: o de produto, ou o aritmético, o que for menor. Nunca deixa passar da ruína. */
export const tetoDaGema = () => Math.min(TETO_ORB_MAX, TETO_ORB_RUINA);

/**
 * Quanto do depósito o caixa exige guardar para uma taxa passar sem confirmação.
 *
 * 3 pontos percentuais. Não é a margem de hoje (5,5%) porque isso proibiria qualquer negociação
 * com streamer; não é zero porque encostar no teto deixa o caixa com centavos que não cobrem
 * nem a taxa de rede do saque.
 */
export const MARGEM_MINIMA_CAIXA = 0.03;

/**
 * Custo do PRIMEIRO saque de cada jogador, em USDT.
 *
 * O aluguel da conta de token na Solana: 0,00203928 SOL, cobrado uma única vez por jogador
 * (`chain.mjs` cria a conta com `Idempotent`). O comentário de `orbs.mjs` cota o intervalo em
 * US$ 0,31 a 0,51 conforme o preço do SOL; 0,40 é o meio dele, e é uma estimativa declarada, não
 * uma medição — serve para ordem de grandeza no painel, não para contabilidade.
 *
 * É FIXO, e é por isso que ele importa aqui: não escala com a taxa nem com o depósito, então
 * decide um tamanho mínimo de depósito abaixo do qual o indicado não se paga. Por decisão de
 * produto ele é bancado pela receita de diamante, fora da tesouraria de gema — o número existe
 * para dimensionar a parceria, não para reprovar taxa.
 */
export const CUSTO_REDE_PRIMEIRO_SAQUE = 0.40;

/**
 * A partir de quanto, em USDT depositados por um indicado, ele passa a render ao projeto.
 *
 * Margem do depósito × valor = custo fixo de rede. Abaixo disso o indicado custa dinheiro mesmo
 * com a taxa dentro do teto. Devolve `Infinity` quando a margem é zero ou negativa — ali não
 * existe depósito grande o bastante.
 */
export function depositoDeEquilibrio(taxa) {
  const margem = margemDoDeposito(taxa);
  return margem > 0 ? CUSTO_REDE_PRIMEIRO_SAQUE / margem : Infinity;
}

/** A taxa de gema que ainda deixa `MARGEM_MINIMA_CAIXA` no caixa. Acima daqui, o painel avisa. */
export const TETO_ORB_SEGURO = (PRECO_COMPRA * (1 - MARGEM_MINIMA_CAIXA)) / PRECO_SAQUE - 1;

/** Teto duro da taxa de diamante. Não protege caixa — protege contra digitar 150 em vez de 15. */
export const TETO_DIA_MAX = 0.50;

/** Acima daqui a taxa de diamante pede confirmação: não fura caixa, mas afunda o preço médio. */
export const TETO_DIA_SEGURO = 0.25;

/** Teto do bônus em diamante sobre depósito de gema. Mesma moeda, mesma lógica de estrago. */
export const TETO_DIA_EXTRA_MAX = 0.50;

/**
 * Quantas gemas de valor um diamante paga, no bônus `taxa_dia_extra`.
 *
 * 7, e sai de uma conta: 7 × US$ 0,009 (o que a gema vale SACANDO, que é o que ela custa ao
 * caixa) = US$ 0,063 ≈ R$ 0,365 a 5,8 BRL/USDT — logo abaixo dos R$ 0,38 do diamante mais
 * barato da tabela (`diamantes.mjs`). Ou seja: o parceiro recebe em diamante um valor de
 * vitrine ligeiramente MAIOR do que a gema que deixou de receber, e mesmo assim o projeto sai
 * ganhando, porque diamante não é passivo em USDT.
 *
 * Usa `PRECO_SAQUE` e não `PRECO_COMPRA` de propósito: a conta que interessa é o custo para a
 * tesouraria, não o preço de tabela.
 */
export const GEMAS_POR_DIAMANTE = 7;

/**
 * Quanto sobra no caixa, como fração do depósito, com uma taxa de gema de `taxa`.
 *
 * Positivo = o depósito deixa margem. Negativo = cada dólar depositado por um indicado daquele
 * padrinho custa dinheiro. É a mesma conta da tabela acima, e o painel a usa para mostrar o
 * número ao lado do campo — quem escolhe a taxa vê o efeito dela antes de salvar.
 */
export const margemDoDeposito = (taxa) => 1 - (1 + Number(taxa || 0)) * (PRECO_SAQUE / PRECO_COMPRA);

/**
 * Slug do link personalizado: `pokeidle.io/app?ref=matta`.
 *
 * Charset PROPOSITALMENTE diferente do `CODIGO_OK`: aquele é gerado por nós e evita ambiguidade
 * visual (sem I, O, 0, 1); este é escolhido por uma pessoa e precisa aceitar o nome dela —
 * "pokeidle" tem I e O. Começa e termina em alfanumérico para não existir slug `-matta-`, que
 * num link fica ilegível.
 *
 * A colisão com um código gerado NÃO é evitada pelo formato (um slug de 7 letras pode cair
 * dentro do `CODIGO_OK`): quem garante é o índice único sobre as duas colunas, em
 * `afiliados-db.mjs`. Formato é conveniência; unicidade é o banco.
 *
 * `CODIGO_OK` continua exigindo 6 a 8 caracteres e NÃO foi afrouxado para caber "matta": o
 * piso de 6 é o que torna caro adivinhar um código gerado por força bruta (32⁶ = 1 bilhão).
 * Slug curto é seguro porque é escolhido, não sorteado — não há o que adivinhar.
 */
export const SLUG_OK = /^[a-z0-9][a-z0-9_-]{1,18}[a-z0-9]$/;

/**
 * Slugs que não podem ser de ninguém.
 *
 * O link é `/?ref=SLUG` e não `/SLUG`, então nenhum destes disputa rota de verdade hoje — a
 * lista é contra o dia em que disputar, e contra o slug que se faz passar pelo projeto
 * ("admin", "suporte", "oficial") na hora de convencer alguém a clicar.
 */
export const SLUGS_RESERVADOS = new Set([
  'admin', 'administrador', 'afiliado', 'affiliate', 'ajuda', 'api', 'app', 'auth',
  'conta', 'discord', 'equipe', 'help', 'loja', 'login', 'mod', 'moderador',
  'oficial', 'official', 'pokeidle', 'root', 'staff', 'suporte', 'support',
  'terms', 'termos', 'www',
]);

export class ErroAfiliado extends Error {
  constructor(chave) {
    super(chave);
    this.chave = chave;
  }
}

/**
 * Normaliza e valida um slug. `null` para vazio (que significa "sem link personalizado"), a
 * string canônica em minúscula, ou estoura com a chave de erro.
 */
export function normalizarSlug(valor) {
  const s = String(valor ?? '').trim().toLowerCase();
  if (!s) return null;
  if (!SLUG_OK.test(s) || s.includes('--')) throw new ErroAfiliado('afiliados.slugInvalido');
  if (SLUGS_RESERVADOS.has(s)) throw new ErroAfiliado('afiliados.slugReservado');
  return s;
}

/**
 * Um `?ref=` que sequer merece consulta ao banco — código gerado OU slug de streamer.
 *
 * Existe porque as duas pontas do cliente (`landing.js` e `app.js`) e as três entradas do
 * servidor (visita, cadastro, aplicação manual) precisam concordar sobre o que aceitar. Se o
 * cliente descartar "matta" antes de mandar, a indicação do streamer some sem erro nenhum — que
 * era exatamente o que acontecia com o `CODIGO_OK` sozinho, porque ele exige 6 a 8 caracteres
 * e "matta" tem 5.
 */
export function refOk(valor) {
  const s = String(valor ?? '').trim();
  if (!s) return false;
  return CODIGO_OK.test(s.toUpperCase()) || SLUG_OK.test(s.toLowerCase());
}

/**
 * Valida uma taxa vinda do painel, em FRAÇÃO (0,15 e não 15).
 *
 * `confirmado` é o segundo clique do painel: ele libera a faixa entre o teto seguro e o duro,
 * nunca o teto duro em si. A separação é o desenho inteiro — o que só custa margem é decisão
 * do dono; o que inverte o sinal do caixa não é decisão de ninguém.
 */
export function validarTaxa(valor, { tetoSeguro, tetoDuro, confirmado = false, moeda }) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) throw new ErroAfiliado('afiliados.taxaInvalida');
  // 4 casas: é o que a coluna NUMERIC(6,4) guarda, e o painel só manda pontos percentuais
  // inteiros ou com uma casa — arredondar aqui evita gravar 0,14999999999999999.
  const taxa = Math.round(n * 1e4) / 1e4;
  if (taxa > tetoDuro) {
    throw new ErroAfiliado(moeda === 'gema' ? 'afiliados.taxaGemaAcimaDoTeto' : 'afiliados.taxaAcimaDoTeto');
  }
  if (taxa > tetoSeguro && !confirmado) throw new ErroAfiliado('afiliados.taxaPedeConfirmacao');
  return taxa;
}

/** Quantos diamantes o bônus `taxa_dia_extra` paga sobre um depósito de `gemas`. */
export const diamantesDoBonus = (gemas, taxa) =>
  Math.floor((Number(gemas || 0) * Number(taxa || 0)) / GEMAS_POR_DIAMANTE);
