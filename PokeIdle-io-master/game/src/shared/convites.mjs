// CONVITES DO DISCORD — a escada de marcos e o que cada um paga.
//
// Mora em `shared/` porque três processos precisam da MESMA tabela: o bot do Discord (que conta
// quem entrou e decide quando gerar um código), o servidor do jogo (que entrega os prêmios no
// `/resgatar`) e a tela (que mostra a escada para o jogador saber o que vem depois). Uma cópia
// da tabela no bot seria um código prometendo 90 dias de VIP que o jogo não entrega.
//
// ### O desenho, em quatro frases
//
// O jogador convida gente para o NOSSO Discord com um link de convite dele. O bot vê o membro
// entrar, descobre por qual link foi e credita o criador do link. Ao cruzar um marco (1, 5, 10,
// 20, 50, 100, 500 convidados), o bot gera um CÓDIGO único e manda no privado. O jogador digita
// `/resgatar <codigo>` no chat do jogo e recebe os prêmios.
//
// ### Por que o código, e não entrega direta
//
// O bot conhece o Discord da pessoa; o jogo conhece a conta. Ligar os dois exigiria que todo
// mundo tivesse entrado por login do Discord — e metade entrou por Google ou e-mail. O código no
// privado é a ponte: quem recebeu prova que é o dono daquele Discord ao digitá-lo, e o jogo não
// precisa saber nada sobre Discord. O preço é que o código é transferível (dá para passar
// adiante), e isso é aceito de propósito — ver `convites-db.mjs`.
//
// ### A régua contra conta-fantasma
//
// Um convidado só vale ponto se a CONTA DE DISCORD dele tiver mais de um ano (ver
// `IDADE_MINIMA_MS`). É a única coisa que o Discord entrega de graça e que uma fazenda de contas
// não consegue falsificar: a data de criação está cravada no próprio id (ver `criadoEmDoSnowflake`)
// e não há como fabricar um id antigo. Quem monta vinte contas hoje à noite para pegar os 5
// diamantes do primeiro marco vê o bot registrar as vinte entradas e não contar nenhuma.

/** Quanto tempo de vida a conta de Discord do convidado precisa ter para valer um ponto. */
export const IDADE_MINIMA_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * A época do Discord: 01/01/2015 em ms. Todo id (snowflake) do Discord carrega o instante da
 * criação nos 42 bits altos, contados a partir daqui.
 */
export const EPOCA_DISCORD = 1_420_070_400_000;

/**
 * Quando a conta (ou o servidor, ou a mensagem) de um id do Discord foi criada, em ms.
 *
 * Os 22 bits baixos do snowflake são o número de sequência e o id do worker; o resto é o
 * timestamp. `null` quando o id não é um inteiro decimal — é o que um campo vindo da API
 * malformado devolveria, e contar um ponto por causa dele seria contar um convidado sem idade.
 */
export function criadoEmDoSnowflake(id) {
  const s = String(id ?? '').trim();
  if (!/^\d{1,25}$/.test(s)) return null;
  return Number((BigInt(s) >> 22n) + BigInt(EPOCA_DISCORD));
}

/** O convidado é velho o bastante para valer um ponto? */
export function contaVelhaOBastante(discordId, agora = Date.now()) {
  const criado = criadoEmDoSnowflake(discordId);
  if (criado == null) return false;
  return agora - criado >= IDADE_MINIMA_MS;
}

// ------------------------------------------------------------------ o código
//
// O alfabeto é o mesmo de `game/afiliados.mjs` (`CODIGO_OK`): maiúsculas e números SEM os
// ambíguos — nada de I, O, 0 e 1 juntos. O código chega por mensagem privada e sai daí digitado
// à mão no chat do jogo; um `O` que o jogador lê como zero é um ticket de suporte.

export const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODIGO_LEN = 10;
export const CODIGO_OK = /^[A-HJ-NP-Z2-9]{10}$/;

/** Normaliza o que o jogador digitou: maiúsculas, sem espaço nem hífen. */
export const normalizarCodigo = (bruto) =>
  String(bruto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODIGO_LEN);

// ------------------------------------------------------------------ os prêmios
//
// O mesmo vocabulário do Passe de Batalha (`shared/passe-batalha.mjs`), com um tipo a mais:
//
//   { tipo: 'diamante', qtd }        diamante de BRINDE — não enche a cota de venda no Mercado
//   { tipo: 'bola', id, qtd }        1 Poké · 2 Great · 3 Super · 4 Ultra · 5 Beast
//   { tipo: 'boost', boost, horas }  xp · pokexp · loot · captura · shiny
//   { tipo: 'vip', dias }            dias de VIP de assinatura
//   { tipo: 'vipPermanente' }        VIP que não expira (ver `VIP_PERMANENTE_ATE`)
//
// O diamante de convite é BRINDE, e é a mesma régua do voto no TopIdle e do pódio de guild: ele
// existe para ser gasto na Loja, não para virar gema. Por isso `MOTIVO.CONVITE` fica FORA de
// `MOTIVOS_QUE_ENCHEM_A_COTA` em `game/diamantes.mjs` — se entrasse, convidar amigo viraria uma
// torneira de dinheiro sacável e a cota do servidor deixaria de ser limitada pelo que entrou de
// verdade. É exatamente o "não comercializável" do pedido.

export const BOLA_BEAST = 5;

/** Todos os cinco boosts da Loja — é o que "1 mês de boosts" quer dizer no marco de 500. */
export const TODOS_OS_BOOSTS = Object.freeze(['xp', 'pokexp', 'loot', 'captura', 'shiny']);

const diamante = (qtd) => ({ tipo: 'diamante', qtd });
const beast = (qtd) => ({ tipo: 'bola', id: BOLA_BEAST, qtd });
const boost = (b, horas) => ({ tipo: 'boost', boost: b, horas });
const vip = (dias) => ({ tipo: 'vip', dias });
const vipPermanente = () => ({ tipo: 'vipPermanente' });

/**
 * "VIP para sempre" sem inventar coluna nova.
 *
 * O VIP do jogo é um instante (`players.vip_ate`), e todo lugar que pergunta se ele está ativo
 * faz `agora < vipAte`. Um marco de 500 convidados que virasse uma coluna `vip_permanente`
 * booleana obrigaria a caçar essas comparações uma por uma — na Loja, no Passe, na ficha, no
 * painel, no documento do MED — e a primeira que ficasse para trás seria um VIP permanente que
 * não vale em algum canto. Um instante absurdamente longe resolve com zero linhas novas.
 *
 * 01/01/2999. O ano tem de caber num `TIMESTAMPTZ` do Postgres (cabe até 294276) e num
 * `Number` de ms (cabe), e a tela reconhece o valor para escrever "permanente" em vez de uma
 * data de ficção científica (ver `VIP_PERMANENTE_LIMIAR`).
 */
export const VIP_PERMANENTE_ATE = Date.UTC(2999, 0, 1);

/**
 * A partir de quando um `vipAte` é lido como permanente. Qualquer coisa além de 100 anos à
 * frente só pode ter vindo daqui — o teto do Passe é 90 dias e o da Loja, um ano.
 */
export const VIP_PERMANENTE_LIMIAR = Date.UTC(2126, 0, 1);

export const vipEhPermanente = (vipAte) => Number(vipAte ?? 0) >= VIP_PERMANENTE_LIMIAR;

/**
 * A ESCADA. Cada degrau é pago UMA VEZ, e os degraus não se substituem: quem chega a 20
 * convidados já recebeu os de 1, 5 e 10 pelo caminho.
 *
 * `amigos` é o total ACUMULADO de convidados que valem ponto. O último degrau é "500 ou mais" —
 * daí em diante não há mais marco, e é de propósito: acima disso o prêmio já é permanente e
 * qualquer degrau novo seria emissão sem teto.
 */
export const MARCOS = Object.freeze([
  { amigos: 1, premios: Object.freeze([diamante(5)]) },
  { amigos: 5, premios: Object.freeze([diamante(10)]) },
  { amigos: 10, premios: Object.freeze([boost('shiny', 3)]) },
  { amigos: 20, premios: Object.freeze([boost('captura', 6), boost('shiny', 6)]) },
  { amigos: 50, premios: Object.freeze([boost('shiny', 72), boost('captura', 72)]) },
  {
    amigos: 100,
    premios: Object.freeze([
      vip(90), beast(5000),
      boost('shiny', 168), boost('captura', 168), boost('xp', 168), boost('pokexp', 168),
    ]),
  },
  {
    amigos: 500,
    premios: Object.freeze([
      vipPermanente(), beast(10_000),
      ...TODOS_OS_BOOSTS.map((b) => boost(b, 720)),
    ]),
  },
].map(Object.freeze));

/** Os números dos marcos, do menor para o maior. */
export const MARCOS_N = Object.freeze(MARCOS.map((m) => m.amigos));

/** O marco de um número exato, ou `undefined`. */
export const marcoDe = (n) => MARCOS.find((m) => m.amigos === Number(n));

/**
 * Os marcos que `total` convidados já cruzaram — é o que o bot compara com os códigos que já
 * gerou para descobrir o que falta gerar.
 */
export const marcosAlcancados = (total) => MARCOS.filter((m) => Number(total) >= m.amigos);

/** O próximo marco depois de `total`, ou `null` quando já passou do último. */
export const proximoMarco = (total) => MARCOS.find((m) => Number(total) < m.amigos) ?? null;
