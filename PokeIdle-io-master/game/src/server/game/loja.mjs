// LOJA VIP — o que os diamantes compram.
//
// ### Procedência
//
// O catálogo é transcrição do `GET /api/game/diamonds` do jogo original (61 produtos, lidos
// em 03/08/2026 e espelhados em `public/data/site/api/diamonds-shop.json`): categorias,
// preços em diamante, durações e a descrição de cada efeito são os deles. Nada aqui foi
// estimado — quando um número não estava na resposta, o produto ficou de fora em vez de ser
// inventado.
//
// ### O que NÃO foi trazido, e por quê
//
//   · **Ditto / Shiny Ditto** — o valor deles é a TRANSFORMAÇÃO (copiar a espécie de outro
//     pokémon por 12 h, com −25% de dano e defesa). Sem esse sistema, vender o Ditto seria
//     vender um pokémon nível 1 caro; ele volta quando a transformação existir.
//   · **Game Pass Premium** e **Tentativas da Tower** — destravam conteúdo que este jogo não
//     tem (a trilha do passe e a Tower). Um botão que cobra e não faz nada é pior que
//     ausência.
//
// Tudo o mais entrou, incluindo os 35 boosts (5 tipos × 7 durações) e as outfits — todas as
// premium da loja deles existem no espelho de sprites, conferidas looktype a looktype.
//
// ### A "Idle Ball" virou BEAST BALL
//
// Mesma ideia da loja de diamantes deles, mas a eficiência aqui é **2× a Ultra Ball** (não 5×
// a Poké): ela custa dinheiro real e precisa valer o preço. O `catchRate` dela é calculado em
// `content.mjs` a partir da Ultra do espelho — ver `BEAST_VS_ULTRA`.
//
// ### A moeda é DIAMANTE, e a GEMA não entra aqui
//
// Os PREÇOS são os deles, número por número, e a unidade também: diamante. Houve uma versão
// intermediária em que esta loja cobrava em GEMA (a moeda com lastro em USDT, ver `orbs.mjs`)
// para não ter duas moedas pagas — e o argumento não se sustentou, porque as duas não têm a
// mesma natureza. Gema é passivo do projeto: ela volta em USDT quando o jogador saca. Cobrar um
// boost de XP em gema significava abater dívida em vez de faturar.
//
// Hoje a divisão é por QUEM está do outro lado da compra: diamante compra do JOGO (aqui), gema
// compra de OUTRO JOGADOR (Mercado da Comunidade). Ver `game/diamantes.mjs`.
//
// ### Ícones e descrições
//
// `icone` e `descricao` são os campos `icon`/`description` do JSON deles, literais. Os
// arquivos de imagem estão espelhados em `site/assets/loja/` por `tools/fetch-shop-icons.mjs`
// — 6 vieram do site (os de boost) e o resto do pokesprite, porque só aqueles seis estão
// publicados num caminho acessível.
//
// ### E por que cada produto também leva um `i18n`
//
// `nome` e `descricao` são escritos aqui, em PORTUGUÊS, e este arquivo roda no servidor — que
// não tem como saber o idioma da aba de quem está olhando. O resultado era uma Loja em
// português dentro de um jogo em inglês ou espanhol.
//
// A saída é o campo `i18n: { nome?, desc?, params? }`: a CHAVE da frase (o dicionário mora em
// `client/i18n.mjs`) e os números que entram nela. O texto pronto continua indo junto e vira
// **fallback** — produto sem chave, ou chave que ainda não existe no dicionário, aparece em
// português como antes, em vez de sumir da vitrine ou mostrar `loja.d.algumaCoisa` na tela.
//
// Ao acrescentar produto aqui, acrescente a chave nos três idiomas. Um parâmetro cujo nome
// termina em `Chave` é ele próprio uma chave, e o cliente o traduz antes de encaixar na frase
// — é o que permite montar as 35 combinações de boost × duração com duas frases por idioma.

import { corpoPadrao } from './visual.mjs';
import {
  produtosDeCaixa, podeVestirOutfitDeCaixa, podeComprarNaLoja, vendaAberta,
} from './caixas.mjs';
import { LOOKTYPES_CAIXA_BETA } from '../../shared/caixas-beta.mjs';
import { ESCAPE_ROPE_ID, XP_SHARE_HELD_ID } from './itens-nossos.mjs';
import { multGuildFarm } from './guild.mjs';
import { multEventoXpTreinador, multEventoXpPokemon, bonusEventoFarmPct } from './eventos.mjs';

/** Quanto a Beast Ball vale contra a Ultra Ball do espelho (catchRate 4). */
export const BEAST_VS_ULTRA = 2;

/** Multiplicador de captura da Beast Ball — o valor final é `Ultra × BEAST_VS_ULTRA` em content.mjs. */
export const BEAST_BALL = {
  id: 5,
  nome: 'Beast Ball',
  catchRate: 4 * BEAST_VS_ULTRA,
  // Não é comprável com ouro: só com diamante, nos pacotes lá embaixo. É isso que a mantém
  // valendo alguma coisa — a Ultra Ball, a 130 de ouro, já resolve o dia a dia.
  compravel: false,
  icone: '/img/ball-beast.png',
};

/** Duração dos boosts, em ms, pelo sufixo do id deles (`boost_xp_2h`, `boost_loot_7d`…). */
const H = 3600_000;
// `rotulo` é o que vai entre parênteses no nome do produto ("XP Boost (2h)"); `texto` é o
// que entra na frase da descrição ("por 2 horas"), do jeito que o original escreve.
export const DURACOES = [
  { sufixo: '', ms: H, rotulo: '1h', texto: '1 hora' },
  { sufixo: '_2h', ms: 2 * H, rotulo: '2h', texto: '2 horas' },
  { sufixo: '_3h', ms: 3 * H, rotulo: '3h', texto: '3 horas' },
  { sufixo: '_6h', ms: 6 * H, rotulo: '6h', texto: '6 horas' },
  { sufixo: '_12h', ms: 12 * H, rotulo: '12h', texto: '12 horas' },
  { sufixo: '_24h', ms: 24 * H, rotulo: '24h', texto: '24 horas' },
  { sufixo: '_7d', ms: 7 * 24 * H, rotulo: '7d', texto: '7 dias' },
];

/**
 * Preço do pacote de 7 dias — continua a curva de desconto depois do 24h.
 *
 * Comprar 7× o pacote de 24h (58→406) não dá incentivo nenhum. O espelho antigo (555)
 * piorava a hora; o linear (406) congelava o desconto. Aqui o 7d fica ~14% abaixo de
 * 24h×7, no mesmo espírito dos degraus 3h→6h→12h→24h: Shiny/Loot/Capture → 350,
 * XP/Pokémon → 175 (proporcional ao tier de 29 vs 58).
 */
const PRECO_7D_REF_24H = 58;
const PRECO_7D_REF = 350;

export function precoBoost7d(preco24h) {
  return Math.round((preco24h * PRECO_7D_REF) / PRECO_7D_REF_24H);
}

/** Os seis primeiros preços vêm do espelho; o 7d fecha a curva em cima do 24h. */
function precosBoost(seis) {
  const p = [...seis];
  p.push(precoBoost7d(p[5]));
  return p;
}

/**
 * Os cinco tipos de boost, com os preços REAIS deles por duração (1h–24h).
 *
 * `chave` é como o boost fica guardado no jogador; `mult` é o que ele multiplica. Repare que
 * XP e loot custam menos que captura e shiny na tabela deles — a coluna de preços é
 * literal, não uma fórmula nossa, exceto o 7d (ver `precoBoost7d`).
 *
 * `idBase` existe porque os dois nomes divergem em UM caso: internamente a chave é `captura`
 * (o resto do código é em português), mas o id do produto é `boost_capture`, que é o deles.
 * Manter o id igual ao da fonte é o que deixa `teste-loja.mjs` conferir preço a preço contra
 * o espelho — com um id nosso, os sete preços daquele tipo passariam sem ser verificados,
 * que foi exatamente o que aconteceu antes deste campo existir.
 */
export const TIPOS_BOOST = {
  xp: {
    chave: 'xp',
    nome: 'XP Boost',
    icone: 'exp.png',
    mult: 1.5,
    descricao: '+50% de XP do TREINADOR',
    descChave: 'loja.efeito.xp',
    precos: precosBoost([3, 6, 8, 12, 20, 29]),
  },
  pokexp: {
    chave: 'pokexp',
    nome: 'XP Boost Pokémon',
    icone: 'boost.png',
    mult: 1.5,
    descricao: '+50% de XP do POKÉMON',
    descChave: 'loja.efeito.pokexp',
    precos: precosBoost([3, 6, 8, 12, 20, 29]),
  },
  loot: {
    chave: 'loot',
    nome: 'Loot Boost',
    icone: 'loot.png',
    mult: 1.4,
    descricao: '+40% de chance de loot',
    descChave: 'loja.efeito.loot',
    precos: precosBoost([6, 12, 15, 24, 40, 58]),
  },
  captura: {
    chave: 'captura',
    idBase: 'capture', // o id deles
    nome: 'Capture Boost',
    icone: 'catch.png',
    mult: 2,
    descricao: 'DOBRA a chance de captura',
    descChave: 'loja.efeito.captura',
    precos: precosBoost([6, 12, 15, 24, 40, 58]),
  },
  shiny: {
    chave: 'shiny',
    idBase: 'shinycharm', // o id deles
    nome: 'Shiny Secret Lure',
    icone: 'shinysecretlure.png',
    mult: 2,
    descricao: 'Dobra a chance do pokémon capturado ser shiny',
    descChave: 'loja.efeito.shiny',
    precos: precosBoost([6, 12, 15, 24, 40, 58]),
  },
};

// Não existe mais cota diária de boost. O jogo original limitava a 5×/dia por tipo, e a regra
// saiu em 18/09/2026: o diamante é do jogador, e quem quiser emendar uma semana de Loot Boost
// num dia só compra. O que continua valendo é o "não acumula" — o multiplicador é um só, e
// comprar de novo estende o prazo a partir do fim atual (ver `ligarBoost`).

// ------------------------------------------------------------------ pacotes
//
// Dois ou três boosts vendidos JUNTOS, por menos que a soma das partes.
//
// ### O que um pacote resolve que sete cards de boost não resolviam
//
// Os 35 boosts são vendidos um a um, e é assim que eles têm de ser: cada jogador quer uma
// duração diferente. Só que as combinações que de fato acontecem são poucas e conhecidas —
// quem vai caçar shiny liga Capture e Shiny Lure juntos, sempre; quem vai farmar liga os dois
// XP e o Loot, sempre. Quatro cliques em quatro cards, quatro confirmações, quatro débitos.
//
// O pacote é o mesmo produto com UMA decisão em vez de três, e o desconto é o que paga a
// escolha do jogador de comprar tudo de uma vez em vez de ir pingando.
//
// ### O desconto é uma REGRA, não um número
//
// `DESCONTO_PACOTE` é a única coisa escrita à mão; o preço sai de `precoDoPacote`, que soma os
// preços REAIS dos boosts que vão dentro. Um pacote com preço decorado é um pacote que fica
// mais caro que a soma no primeiro reajuste da tabela de boosts — e aí o "economize" do card
// vira mentira. `tools/teste-loja.mjs` confere que todo pacote continua abaixo da soma.
//
// ### Por que o de 7 dias desconta mais
//
// Dois eixos de desconto, e eles se acumulam: o pacote (juntar os boosts) e a duração (o 7d de
// cada boost já é ~14% abaixo de 24h×7 — ver `precoBoost7d`). O card mostra os dois, porque a
// comparação que o jogador faz de verdade é "isto contra sete noites soltas", e é aí que o
// número fica grande.

/** Quanto o pacote desconta sobre a soma dos boosts que ele carrega. */
export const DESCONTO_PACOTE = 0.14;

/** O índice de uma duração em `DURACOES` (e, portanto, na lista de preços de cada boost). */
const iDuracao = (sufixo) => DURACOES.findIndex((d) => d.sufixo === sufixo);

/** Quanto custariam, avulsos, os boosts de um pacote naquela duração. */
export const somaAvulsaDoPacote = (chaves, sufixo) =>
  chaves.reduce((s, c) => s + TIPOS_BOOST[c].precos[iDuracao(sufixo)], 0);

/**
 * O preço do pacote: a soma dos avulsos com o desconto, arredondada para a DEZENA MAIS PRÓXIMA.
 *
 * A dezena é de produto, não de conta: "100 💎" e "600 💎" se leem de relance e se comparam com
 * o saldo sem esforço; "99,76" e "602" leem como preço de supermercado.
 *
 * `round` e não `floor`: com os 14% de hoje os dois kits de 1 dia dão 99,76 e os de 7 dias dão
 * 602 — arredondando para baixo, o de 1 dia cairia para 90 (22% de desconto, mais do que a
 * régua promete) e o de 7 dias para 600. Ou seja, o `floor` fazia UM dos quatro pacotes
 * descontar quase o dobro dos outros, por acidente de arredondamento.
 *
 * O `min` contra a soma é a trava que sobra: seja qual for a régua, um pacote nunca pode custar
 * MAIS que comprar os boosts avulsos. É a invariante que `tools/teste-loja.mjs` confere.
 */
export function precoDoPacote(chaves, sufixo) {
  const soma = somaAvulsaDoPacote(chaves, sufixo);
  return Math.max(1, Math.min(soma - 1, Math.round((soma * (1 - DESCONTO_PACOTE)) / 10) * 10));
}

/**
 * Os pacotes, na ordem em que a vitrine os mostra.
 *
 * `chaves` são chaves de `TIPOS_BOOST` — é delas que saem preço, duração, ícone e descrição de
 * cada item de dentro. `destaque` é o card em promoção maior (o de 7 dias), e a tela usa para
 * decidir a moldura; `icone` é o do boost mais representativo do kit.
 */
export const PACOTES_BOOST = [
  {
    id: 'pacote_shiny_hunter', nome: 'Pacote Shiny Hunter',
    chaves: ['captura', 'shiny'], icone: 'shinysecretlure.png',
  },
  {
    id: 'pacote_farmer', nome: 'Pacote Farmer',
    chaves: ['xp', 'pokexp', 'loot'], icone: 'exp.png',
  },
];

/** As duas durações em que cada pacote é vendido: um dia e uma semana. */
export const DURACOES_PACOTE = ['_24h', '_7d'];

/** VIP: +50% nos dois XPs, auto-catch e a outfit Trainer VIP. */
export const VIP_MULT_XP = 1.5;

/**
 * Bless: quanto do XP normal a morte cobra.
 *
 * `1` é sem bênção nenhuma. Os três valores são os deles: "perde só 8%", "só 3%", "NÃO
 * perde". Como a nossa perda base é 10% do XP do nível, a fração aqui é sobre ESSA perda —
 * `plus` deixa a morte custando 8% em vez de 10%, que é exatamente o que a descrição diz.
 *
 * Vale por UMA morte e some depois.
 */
export const BLESS = {
  blessplus: { id: 'blessplus', nome: 'Bless Plus', pctMorte: 0.08, preco: 1 },
  blessultra: { id: 'blessultra', nome: 'Bless Ultra', pctMorte: 0.03, preco: 2 },
  blessmax: { id: 'blessmax', nome: 'Bless Max', pctMorte: 0, preco: 3 },
};

/**
 * Outfits beta — grátis na loja enquanto `BETA_OUTFITS_ABERTAS` estiver ligada.
 * Depois do reset, defina `BETA_OUTFITS_ABERTAS=0` no .env: novos jogadores não compram;
 * quem já resgatou continua equipando.
 */
export const BETA_OUTFITS_ABERTAS = process.env.BETA_OUTFITS_ABERTAS !== '0';

const OUTFITS_BETA = [
  { looktype: 41260, nome: 'Beta Outfit 1' },
  { looktype: 40469, nome: 'Beta Outfit 2' },
  { looktype: 41868, nome: 'Beta Outfit 3' },
  { looktype: 41261, nome: 'Beta Outfit 4' },
];

/**
 * Os quatro looktypes de beta, para quem precisa reconhecê-los sem o catálogo montado.
 *
 * Quem usa é o `tools/reset-beta.mjs`: o reset esvazia `owned_outfits` e estas quatro são das
 * poucas que ficam, justamente porque a promessa da vitrine é "quem já resgatou continua
 * equipando" — a lista tinha de sair daqui, e não copiada para lá.
 */
export const LOOKTYPES_OUTFIT_BETA = new Set(OUTFITS_BETA.map((o) => o.looktype));

/** Outfits compráveis com diamante (30 💎 cada). */
const OUTFITS = [
  { looktype: 20003, nome: 'Snorlax Cosplay' },
  { looktype: 20002, nome: 'Greninja Cosplay' },
  { looktype: 20007, nome: 'Duskull Cosplay' },
  { looktype: 20013, nome: 'Slowpoke Cosplay' },
  { looktype: 20016, nome: 'Goodra Cosplay' },
  { looktype: 20014, nome: 'Slowpoke Cosplay II' },
  { looktype: 20018, nome: 'Eevee Cosplay' },
  { looktype: 20020, nome: 'Bug Catcher Outfit' },
  { looktype: 20019, nome: 'Bug Catcher Outfit II' },
  { looktype: 20021, nome: 'Lorekeeper' },
];

/** Outfits exclusivas de VIP — equipáveis enquanto a assinatura estiver ativa. */
export const OUTFITS_VIP = [
  { looktype: 20028, nome: 'Gamer VIP Outfit' },
  { looktype: 20029, nome: 'Gamer VIP Outfit II' },
];

export const LOOKTYPES_OUTFIT_VIP = new Set(OUTFITS_VIP.map((o) => o.looktype));

const PRECO_OUTFIT = 30;

// ------------------------------------------------------------------ catálogo

/** Onde o cliente acha as imagens espelhadas (ver `tools/fetch-shop-icons.mjs`). */
const ICONE = (arquivo) => `site/assets/loja/${arquivo}`;

/**
 * Como a VITRINE arruma os produtos — que não é como o jogo original os agrupa.
 *
 * `cat` continua sendo a categoria DELES (mercado / boosts / outfits), e é por ela que o
 * `teste-loja.mjs` confere preço a preço contra o espelho. Mas "mercado" junta pokébola, VIP,
 * troca de nome e bênção no mesmo balcão: onze produtos que não têm nada a ver um com o
 * outro, numa grade só, e quem procura o VIP passa por três pacotes de bola antes.
 *
 * `grupo` é a nossa arrumação, e é a que a tela usa no menu lateral. Os dois campos convivem
 * de propósito — trocar `cat` desligaria a conferência contra a fonte.
 */
export const GRUPOS = {
  /**
   * UTILITÁRIOS — os consumíveis: pokébolas e Escape Rope.
   *
   * Já foi "Pokébolas", e o nome deixou de descrever a prateleira quando a corda chegou.
   * O que une os produtos é a natureza: acabam ao usar, e comprar de novo é o normal. Isso os
   * separa de VIP (assinatura), Boosts (tempo), Personagem (permanente) e Outfits (cosmético).
   */
  UTIL: 'utilitarios',
  VIP: 'vip',
  BOOSTS: 'boosts',
  PERSONAGEM: 'personagem',
  OUTFITS: 'outfits',
  /**
   * CAIXAS — as duas Caixas de Fundador do beta.
   *
   * Seção própria, e não dentro de Outfits, porque o que se compra aqui não é uma roupa: é uma
   * peça NUMERADA e limitada, que se pode revender fechada no Mercado da Comunidade e cujo
   * conteúdo (outfit + tag + diamantes) só sai ao abrir. Misturá-la com as outfits de 30 💎
   * faria as duas parecerem a mesma compra. Ver `shared/caixas-beta.mjs`.
   */
  CAIXAS: 'caixas',
  /**
   * PACOTES — dois ou três boosts vendidos juntos, mais barato que a soma.
   *
   * Seção própria, e não dentro de Boosts, por uma razão de leitura: a prateleira de Boosts
   * são 35 cards do mesmo desenho, distinguidos por duração e preço, e um pacote no meio
   * deles seria só mais um retângulo. O que se compra aqui é outra decisão — não "qual boost",
   * e sim "o kit da noite de caça" —, e ela precisa da vitrine para si.
   *
   * O preço NUNCA é escrito à mão: sai de `precoDoPacote`, sobre os mesmos `TIPOS_BOOST` que
   * a seção de Boosts vende. É isso que impede o pacote de ficar mais CARO que a soma depois
   * de um reajuste — o desconto é uma porcentagem, não um número decorado.
   */
  PACOTES: 'pacotes',
};

/**
 * Monta a lista inteira. Feito uma vez no boot; o resultado é imutável.
 *
 * `descricao` é o texto DELES, copiado do `description` de cada produto. Onde a nossa
 * mecânica diverge (a Idle Ball virou Beast Ball, o diamante virou ORB), a frase foi ajustada
 * só na palavra que mudou — o resto é literal.
 */
function montarCatalogo() {
  const p = [];

  // ------------------------------------------------------------- mercado
  p.push(
    {
      id: 'beast100', cat: 'mercado', grupo: GRUPOS.UTIL, nome: 'Beast Ball ×100', preco: 2, icone: ICONE('idleball.png'),
      descricao: '100 Beast Balls — 2× a chance da Ultra Ball.',
      i18n: { desc: 'loja.d.beast', params: { n: 100 } },
      efeito: { tipo: 'bolas', qtd: 100 },
    },
    {
      id: 'beast300', cat: 'mercado', grupo: GRUPOS.UTIL, nome: 'Beast Ball ×300', preco: 5, icone: ICONE('idleball.png'),
      descricao: '300 Beast Balls — 2× a chance da Ultra Ball.',
      i18n: { desc: 'loja.d.beast', params: { n: 300 } },
      efeito: { tipo: 'bolas', qtd: 300 },
    },
    {
      id: 'beast600', cat: 'mercado', grupo: GRUPOS.UTIL, nome: 'Beast Ball ×600', preco: 10, icone: ICONE('idleball.png'),
      descricao: '600 Beast Balls — 2× a chance da Ultra Ball.',
      i18n: { desc: 'loja.d.beast', params: { n: 600 } },
      efeito: { tipo: 'bolas', qtd: 600 },
    },
    {
      id: 'supplypack', cat: 'mercado', grupo: GRUPOS.UTIL, nome: 'Pacote de Suprimentos', preco: 5, icone: ICONE('supplypack.png'),
      descricao: '1000 Beast Balls. Comprável 1× por semana.',
      i18n: { nome: 'loja.n.supplypack', desc: 'loja.d.supplypack' },
      efeito: { tipo: 'bolas', qtd: 1000 },
      limiteDias: 7,
    },
    {
      id: 'vip30', cat: 'mercado', grupo: GRUPOS.VIP, nome: '30 Dias de VIP', preco: 10, icone: ICONE('vip.png'),
      descricao: '30 dias de VIP: +50% XP (personagem e Pokémon), Auto-Catch e outfit exclusiva na aba Outfits.',
      i18n: { nome: 'loja.n.vip', desc: 'loja.d.vip', params: { dias: 30 } },
      efeito: { tipo: 'vip', dias: 30 },
    },
    {
      id: 'vip60', cat: 'mercado', grupo: GRUPOS.VIP, nome: '60 Dias de VIP', preco: 17, icone: ICONE('vip.png'),
      descricao: '60 dias de VIP: +50% XP (personagem e Pokémon), Auto-Catch e outfit exclusiva na aba Outfits.',
      i18n: { nome: 'loja.n.vip', desc: 'loja.d.vip', params: { dias: 60 } },
      efeito: { tipo: 'vip', dias: 60 },
    },
    {
      id: 'vip90', cat: 'mercado', grupo: GRUPOS.VIP, nome: '90 Dias de VIP', preco: 25, icone: ICONE('vip.png'),
      descricao: '90 dias de VIP: +50% XP (personagem e Pokémon), Auto-Catch e outfit exclusiva na aba Outfits.',
      i18n: { nome: 'loja.n.vip', desc: 'loja.d.vip', params: { dias: 90 } },
      efeito: { tipo: 'vip', dias: 90 },
    },
    {
      id: 'name', cat: 'mercado', grupo: GRUPOS.PERSONAGEM, nome: 'Troca de Nome', preco: 6, icone: ICONE('name.png'),
      descricao: 'Muda o nome do seu personagem.',
      i18n: { nome: 'loja.n.trocaNome', desc: 'loja.d.trocaNome' },
      efeito: { tipo: 'nome' }, pedeTexto: true,
    },
  );
  // ------------------------------------------------- utilidades (itens nossos)
  //
  // O produto que a Loja vende e que NÃO vem do catálogo do jogo original. Ícone com caminho
  // absoluto porque é arte nossa (ver `itens-nossos.mjs`). O Fragmento de Chave só cai na Outland.
  p.push(
    {
      id: 'escaperope', cat: 'mercado', grupo: GRUPOS.UTIL, nome: 'Escape Rope', preco: 1,
      icone: '/img/itens/escape-rope.png',
      descricao: 'Sai da hunt direto para o Centro Pokémon, na hora, sem a espera de 3 s. '
        + 'Consome 1 ao usar.',
      i18n: { desc: 'loja.d.escaperope' },
      efeito: { tipo: 'item', itemId: ESCAPE_ROPE_ID, qtd: 1 },
    },
  );
  p.push({
    id: 'xpshareheld', cat: 'mercado', grupo: GRUPOS.UTIL, nome: 'Exp. Share', preco: 50,
    icone: '/img/itens/exp-share.png',
    descricao: 'Item held: repassa 5% do XP que o seu pokémon de batalha ganha em cada abate '
      + 'para UM pokémon da equipe ou do depot. NÃO é negociável — fica na sua conta. '
      + 'Para vender o pokémon, remova o item antes (Bolsa → Itens raros → Exp. Share).',
    i18n: { desc: 'loja.d.xpshareheld' },
    efeito: { tipo: 'item', itemId: XP_SHARE_HELD_ID, qtd: 1 },
  });

  const ICONE_BLESS = { blessplus: 'blessp.png', blessultra: 'blessu.png', blessmax: 'blessm.png' };
  const DESC_BLESS = {
    blessplus: 'Ao desmaiar você perde só 8% de XP. Vale por 1 morte.',
    blessultra: 'Ao desmaiar você perde só 3% de XP. Vale por 1 morte.',
    blessmax: 'Ao desmaiar você NÃO perde XP. Vale por 1 morte.',
  };
  // As bênçãos são de PERSONAGEM: o que elas mexem é no que a sua morte custa, e é ao lado
  // da troca de nome que alguém as procura — não no meio dos pacotes de bola.
  for (const b of Object.values(BLESS)) {
    p.push({
      id: b.id, cat: 'mercado', grupo: GRUPOS.PERSONAGEM, nome: b.nome, preco: b.preco,
      icone: ICONE(ICONE_BLESS[b.id]), descricao: DESC_BLESS[b.id],
      i18n: { desc: `loja.d.${b.id}` },
      efeito: { tipo: 'bless', bless: b.id },
    });
  }

  // -------------------------------------------------------------- boosts
  for (const t of Object.values(TIPOS_BOOST)) {
    DURACOES.forEach((d, i) => {
      p.push({
        id: `boost_${t.idBase ?? t.chave}${d.sufixo}`,
        cat: 'boosts',
        grupo: GRUPOS.BOOSTS,
        // A CHAVE do tipo, para a vitrine poder filtrar "só XP Boost" sem ter de decompor o
        // id — que nos dois casos de alias (`capture`, `shinycharm`) daria o nome errado.
        boost: t.chave,
        nome: `${t.nome} (${d.rotulo})`,
        preco: t.precos[i],
        icone: ICONE(t.icone),
        descricao: `${t.descricao} por ${d.texto}. Não acumula: comprar de novo estende o prazo.`,
        // O nome do boost já é o mesmo nos três idiomas ("XP Boost"), então só a descrição
        // leva chave. `efeitoChave` e `tempoChave` são resolvidos ANTES de entrar na frase —
        // ver a convenção do sufixo `Chave` em `textoDaLoja`, no cliente.
        i18n: {
          desc: 'loja.d.boost',
          params: { efeitoChave: t.descChave, tempoChave: `loja.dur.${d.rotulo}` },
        },
        efeito: { tipo: 'boost', boost: t.chave, ms: d.ms },
      });
    });
  }

  // ------------------------------------------------------------- pacotes
  //
  // Depois dos boosts de propósito: um pacote é a soma de alguns deles, e a leitura do arquivo
  // fica na mesma ordem da conta. `preco`, `economia` e a lista do que vem dentro saem todos
  // dos mesmos `TIPOS_BOOST` que o laço acima acabou de percorrer — nenhum número é digitado.
  for (const pac of PACOTES_BOOST) {
    for (const sufixo of DURACOES_PACOTE) {
      const d = DURACOES[iDuracao(sufixo)];
      const avulso = somaAvulsaDoPacote(pac.chaves, sufixo);
      const preco = precoDoPacote(pac.chaves, sufixo);
      const itens = pac.chaves.map((c) => ({
        boost: c,
        nome: `${TIPOS_BOOST[c].nome} (${d.rotulo})`,
        icone: ICONE(TIPOS_BOOST[c].icone),
        descricao: TIPOS_BOOST[c].descricao,
        descChave: TIPOS_BOOST[c].descChave,
        preco: TIPOS_BOOST[c].precos[iDuracao(sufixo)],
        ms: d.ms,
      }));
      // A segunda comparação, e ela só existe no pacote de 7 dias: "sete noites soltas". É o
      // número grande — soma o desconto do pacote com o do 7d de cada boost (`precoBoost7d`) —
      // e é a comparação que o jogador de fato faz antes de decidir a semana inteira.
      const avulso1d = somaAvulsaDoPacote(pac.chaves, '_24h');
      const seteDe1d = sufixo === '_7d' ? avulso1d * 7 : null;
      p.push({
        id: `${pac.id}${sufixo}`,
        cat: 'pacotes',
        grupo: GRUPOS.PACOTES,
        nome: `${pac.nome} (${d.rotulo})`,
        preco,
        icone: ICONE(pac.icone),
        descricao: `${itens.map((x) => x.nome).join(' + ')}, por ${d.texto}. `
          + `Avulsos sairiam por ${avulso} 💎. Não acumula: comprar de novo estende o prazo.`,
        // `itens` entra como texto pronto: são nomes de produto ("Capture Boost (24h)"), que
        // não mudam de idioma. O que muda — a duração e a frase em volta — vai por chave.
        i18n: {
          nome: `loja.n.${pac.id}`,
          desc: 'loja.d.pacote',
          params: {
            dur: d.rotulo,
            itens: itens.map((x) => x.nome).join(' + '),
            tempoChave: `loja.dur.${d.rotulo}`,
            avulso,
          },
        },
        // O que a vitrine precisa para desenhar o card de promoção sem refazer conta nenhuma.
        pacote: {
          itens: itens.map(({ boost, nome, icone, descricao, descChave }) => ({
            boost, nome, icone, descricao, descChave,
          })),
          avulso,
          economia: avulso - preco,
          economiaPct: Math.round((1 - preco / avulso) * 100),
          // `null` no de 1 dia: comparar "um dia" com "sete dias soltos" não faz sentido.
          avulsoSemana: seteDe1d,
          economiaSemana: seteDe1d ? seteDe1d - preco : null,
          economiaSemanaPct: seteDe1d ? Math.round((1 - preco / seteDe1d) * 100) : null,
          duracao: d.rotulo,
          duracaoMs: d.ms,
        },
        efeito: { tipo: 'pacote', itens: itens.map((x) => ({ boost: x.boost, ms: x.ms })) },
      });
    }
  }

  // ------------------------------------------------------------- outfits
  for (const o of OUTFITS) {
    p.push({
      id: `outfit_${o.looktype}`,
      cat: 'outfits',
      grupo: GRUPOS.OUTFITS,
      nome: o.nome,
      preco: PRECO_OUTFIT,
      descricao: 'Outfit exclusiva. Ao comprar você a desbloqueia e já equipa; troque quando quiser.',
      i18n: { desc: 'loja.d.outfit' },
      efeito: { tipo: 'outfit', looktype: o.looktype },
    });
  }
  for (const o of OUTFITS_VIP) {
    p.push({
      id: `outfit_vip_${o.looktype}`,
      cat: 'outfits',
      grupo: GRUPOS.OUTFITS,
      nome: o.nome,
      preco: 0,
      looktype: o.looktype,
      vipExclusive: true,
      descricao: 'Exclusiva de VIP. Equipe enquanto sua assinatura estiver ativa.',
      i18n: { desc: 'loja.d.outfitVip' },
    });
  }
  for (const o of OUTFITS_BETA) {
    p.push({
      id: `outfit_beta_${o.looktype}`,
      cat: 'outfits',
      grupo: GRUPOS.OUTFITS,
      nome: o.nome,
      preco: 0,
      looktype: o.looktype,
      betaExclusive: true,
      descricao: 'Outfit exclusiva da fase beta. Resgate grátis enquanto estiver disponível na loja.',
      i18n: { desc: 'loja.d.outfitBeta' },
      efeito: { tipo: 'outfit', looktype: o.looktype },
    });
  }

  // ------------------------------------------------------------- caixas
  // Sem `efeito`: o que uma caixa faz não é mudar o jogador, é criar uma linha nova com número
  // irrepetível. Quem trata é o `loja.comprar` no sim, pelo desvio de `caixaPorProduto`.
  p.push(...produtosDeCaixa());

  return p;
}

export const PRODUTOS = montarCatalogo();
export const produtoPorId = new Map(PRODUTOS.map((x) => [x.id, x]));

// ------------------------------------------------------------------ estado

/** Multiplicador de um boost agora — 1 quando não está ativo. */
export function multBoost(p, chave, agora) {
  const ate = p.boosts?.[chave] ?? 0;
  if (agora >= ate) return 1;
  return TIPOS_BOOST[chave]?.mult ?? 1;
}

export const vipAtivo = (p, agora) => agora < (p.vipAte ?? 0);

/** Pode vestir este looktype agora? (padrão do gênero, outfit comprada ou outfit VIP com VIP ativo.) */
export function podeEquiparLooktype(p, looktype, agora) {
  if (looktype === corpoPadrao(p.gender)) return true;
  if (LOOKTYPES_OUTFIT_VIP.has(looktype)) return vipAtivo(p, agora);
  // Outfit de Caixa de Fundador não vale pelo `ownedOutfits`: vale por ter ABERTO a caixa,
  // que é o que a tabela `caixas_beta` guarda. A lista em memória é conveniência de tela, e
  // um `loja.equipar` forjado não deve vestir a roupa só porque a lista foi contaminada.
  if (LOOKTYPES_CAIXA_BETA.has(looktype)) return podeVestirOutfitDeCaixa(p, looktype);
  return (p.ownedOutfits ?? []).includes(looktype);
}

/** Se o VIP expirou com outfit VIP equipada, volta ao visual padrão do gênero. */
export function reverterOutfitVipExpirado(p, agora) {
  if (!LOOKTYPES_OUTFIT_VIP.has(p.looktype)) return false;
  if (vipAtivo(p, agora)) return false;
  p.looktype = corpoPadrao(p.gender);
  return true;
}

/**
 * Multiplicador de XP do TREINADOR: boost e VIP se multiplicam.
 *
 * Os dois juntos dão 2,25× e não 2×. É de propósito — são compras separadas, e somar os
 * bônus faria o segundo valer menos que o primeiro justamente para quem gastou mais.
 *
 * O EVENTO entra pelo mesmo caminho e pela mesma razão: ele não substitui o que o jogador
 * comprou, ele multiplica em cima. Quem pagou o boost continua rendendo mais que o vizinho
 * durante o evento — que é o mínimo que se deve a quem pagou.
 */
export const multXpTreinador = (p, agora) =>
  multBoost(p, 'xp', agora) *
  (vipAtivo(p, agora) ? VIP_MULT_XP : 1) *
  multGuildFarm(p) *
  multEventoXpTreinador(agora);

export const multXpPokemon = (p, agora) =>
  multBoost(p, 'pokexp', agora) *
  (vipAtivo(p, agora) ? VIP_MULT_XP : 1) *
  multGuildFarm(p) *
  multEventoXpPokemon(agora);

export const multCaptura = (p, agora) => multBoost(p, 'captura', agora);
export const multShiny = (p, agora) => multBoost(p, 'shiny', agora);

/**
 * O loot soma o boost da loja (+40%) com o bônus de ranking de guild e o do evento.
 *
 * "Farm" neste jogo É esta conta: ela manda na chance de cada drop e na do Boss Token da
 * Outland. O buff de FARM do evento entra como mais uma parcela, do mesmo jeito que o bônus
 * de guild — somando, e não multiplicando, porque as três respondem à mesma pergunta
 * ("quanto a mais nesta kill?") e multiplicá-las faria 3 × +25% virar +95%.
 *
 * O bônus por POSIÇÃO no PvP era a quarta parcela e saiu: a temporada mensal passou a premiar
 * o topo em BOOST, e pagar também um bônus permanente de farm era pagar duas vezes pela mesma
 * colocação. Com ele fora, o PvP deixa de mexer no rendimento da hunt por qualquer caminho.
 */
export const bonusLootPct = (p, agora) =>
  (multBoost(p, 'loot', agora) - 1) * 100 +
  (Number(p.guildBonusPct) || 0) +
  bonusEventoFarmPct(agora);

/**
 * A fração de XP que a morte cobra, considerando a bênção.
 *
 * Consome a bênção: ela vale por UMA morte. Quem chamar isto está, por definição, morrendo.
 */
export function consumirBless(p) {
  const b = BLESS[p.bless];
  p.bless = null;
  if (!b) return null;
  return b.pctMorte;
}

// ------------------------------------------------------------------ compra
//
// A compra é DUAS funções, e a separação não é estética: o diamante foi pago com dinheiro de
// verdade, então o débito precisa passar pelo ledger transacional em vez de ser um `-=` numa
// variável. A ordem correta é validar → DEBITAR (transação) → aplicar o efeito. Se o efeito
// e o débito estivessem juntos aqui, ou se debitaria antes de saber se dá certo, ou se
// aplicaria o efeito antes de saber se o jogador podia pagar.
//
// É o mesmo desenho de `validarSaque` / `pedirSaque` em `orbs.mjs`.

/**
 * Confere se a compra PODE acontecer. Não muda nada.
 *
 * TODA a regra mora aqui — saldo, limite diário, limite semanal, outfit repetida, nome
 * válido. O cliente só desenha; um `loja.comprar` na mão passa exatamente por isto.
 *
 * @returns {{ok:true, produto, nomePedido?}|{ok:false, erro:string}}
 */
export function validarCompra(p, id, agora, extra = {}) {
  const prod = produtoPorId.get(String(id));
  if (!prod) return { ok: false, erro: 'produto inexistente' };
  if (prod.vipExclusive) {
    return { ok: false, erro: 'outfit exclusiva de VIP — assine o VIP para equipar' };
  }
  if (prod.betaExclusive && !BETA_OUTFITS_ABERTAS) {
    return { ok: false, erro: 'esta outfit beta não está mais disponível' };
  }
  // A caixa tem HORA para abrir. A vitrine já mostra a contagem em vez do preço, mas a trava
  // tem de estar aqui: o cliente é do jogador, e um `loja.comprar` na mão levaria a `#01`
  // antes de todo mundo.
  //
  // Os dois LIMITES (estoque de 50/100 e uma por conta) também são conferidos no banco, dentro
  // da transação que numera — ver `comprarCaixa`. O que se faz aqui é a pré-checagem barata do
  // limite por conta, que a memória já sabe responder: sem ela o segundo clique passaria pela
  // cobrança para só então tomar o "não" e pedir estorno.
  if (prod.caixaBeta) {
    if (!vendaAberta(agora)) return { ok: false, erro: 'caixas.aindaNaoAbriu' };
    if (!podeComprarNaLoja(p, prod.caixaBeta)) return { ok: false, erro: 'caixas.jaComprou' };
  }
  // O saldo aqui é o CACHE (`p.diamonds`), então serve de pré-checagem barata: a palavra final
  // é do `WHERE diamonds + delta >= 0` da transação, que é quem impede saldo negativo numa
  // corrida de dois cliques.
  if ((p.diamonds ?? 0) < prod.preco) return { ok: false, erro: 'diamantes insuficientes' };

  // Boost e pacote de boost não têm mais cota diária — ver o comentário logo depois de `TIPOS_BOOST`.
  if (prod.limiteDias) {
    const ultima = p.comprasCooldown?.[prod.id] ?? 0;
    if (agora < ultima) {
      const h = Math.ceil((ultima - agora) / 3600_000);
      return { ok: false, erro: `só uma vez a cada ${prod.limiteDias} dias (faltam ~${h}h)` };
    }
  }

  const ef = prod.efeito ?? {};
  if (ef.tipo === 'outfit' && (p.ownedOutfits ?? []).includes(ef.looktype)) {
    return { ok: false, erro: 'você já tem esta outfit' };
  }
  if (ef.tipo === 'nome') {
    const novo = String(extra.nome ?? '').trim();
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(novo)) {
      return { ok: false, erro: 'nome inválido (3-16: letras, números ou _)' };
    }
    if (novo.toLowerCase() === String(p.nick ?? '').toLowerCase()) {
      return { ok: false, erro: 'escolha um nome diferente do atual' };
    }
    // Disponibilidade no banco é conferida no sim antes de cobrar — aqui só formato e repetição.
    return { ok: true, produto: prod, nomePedido: novo };
  }
  return { ok: true, produto: prod };
}

/**
 * Aplica o efeito de um produto JÁ PAGO.
 *
 * Só deve ser chamada depois de `validarCompra` ter passado E de o débito ter fechado no
 * ledger. Não confere saldo nem limite de novo — se chamada fora dessa ordem, entrega o
 * produto de graça.
 */
/**
 * Liga UM boost: estende a validade.
 *
 * Saiu de dentro do `case 'boost'` quando o pacote chegou — o card avulso e o pacote têm de
 * ligar do mesmo jeito. "Não acumula": estende a partir do fim atual, nunca reinicia.
 */
function ligarBoost(p, chave, ms, agora) {
  p.boosts ??= {};
  p.boosts[chave] = Math.max(p.boosts[chave] ?? 0, agora) + ms;
}

/**
 * Concede um boost SEM ser compra: prêmio, evento, reparação da staff, o Passe de Batalha.
 *
 * Estende do mesmo jeito que `ligarBoost`, mas confere a chave e a duração, porque quem chama
 * não passou por `validarCompra`.
 */
export function concederBoost(p, chave, ms, agora) {
  if (!TIPOS_BOOST[chave] || !(ms > 0)) return false;
  p.boosts ??= {};
  p.boosts[chave] = Math.max(p.boosts[chave] ?? 0, agora) + ms;
  return true;
}

export function aplicarEfeito(p, prod, agora, extra = {}) {
  const ef = prod.efeito;

  switch (ef.tipo) {
    case 'bolas':
      p.balls[BEAST_BALL.id] = (p.balls[BEAST_BALL.id] ?? 0) + ef.qtd;
      break;

    case 'vip':
      // Renovar ESTENDE em vez de reiniciar: comprar 30 dias faltando 10 dá 40, não 30.
      p.vipAte = Math.max(p.vipAte ?? 0, agora) + ef.dias * 24 * 3600_000;
      break;

    case 'boost': {
      ligarBoost(p, ef.boost, ef.ms, agora);
      break;
    }

    // O pacote é exatamente N boosts, ligados um a um pela MESMA função do card avulso. Nada
    // de regra própria: o "não acumula" tem de valer igual, senão o pacote vira a forma barata
    // de furá-lo.
    case 'pacote':
      for (const item of ef.itens ?? []) ligarBoost(p, item.boost, item.ms, agora);
      break;

    case 'bless':
      p.bless = ef.bless;
      break;

    case 'item':
      p.items[ef.itemId] = (p.items[ef.itemId] ?? 0) + (ef.qtd ?? 1);
      break;

    case 'genero':
      p.gender = p.gender === 'female' ? 'male' : 'female';
      // O visual volta ao padrão do gênero novo — é o que o aviso deles diz. Cai no PRIMEIRO
      // corpo da lista: manter o índice escolhido no onboarding daria um corpo alternativo que
      // a pessoa nunca viu, e o aviso promete justamente "volta ao padrão".
      p.looktype = corpoPadrao(p.gender);
      break;

    case 'outfit':
      (p.ownedOutfits ??= []).push(ef.looktype);
      p.looktype = ef.looktype; // "desbloqueia e já equipa"
      break;

    case 'nome':
      break; // aplicado por quem chamou, que tem o banco à mão
  }

  if (prod.limiteDias) {
    (p.comprasCooldown ??= {})[prod.id] = agora + prod.limiteDias * 24 * 3600_000;
  }

  return { produto: prod, efeito: ef, nomePedido: extra.nome };
}

/** O catálogo como o cliente precisa dele: sem os internos do efeito. */
export const catalogoParaCliente = () =>
  PRODUTOS.map((x) => ({
    id: x.id,
    cat: x.cat,
    // A arrumação da vitrine (ver `GRUPOS`) e, nos boosts, o tipo — os dois filtros do menu
    // lateral da Loja. Vêm do servidor para a tela não ter de adivinhar pelo id.
    grupo: x.grupo ?? x.cat,
    boost: x.boost ?? null,
    nome: x.nome,
    preco: x.preco,
    descricao: x.descricao ?? null,
    // A chave de tradução da vitrine (e os parâmetros dela). O `descricao` acima continua indo
    // junto e é o FALLBACK: produto sem chave, ou chave que ainda não existe no dicionário,
    // aparece em português como antes em vez de sumir da tela.
    i18n: x.i18n ?? null,
    icone: x.icone ?? null,
    pedeTexto: !!x.pedeTexto,
    // O cliente precisa saber o que é outfit para desenhar o boneco em vez de um ícone.
    looktype: x.looktype ?? (x.efeito?.tipo === 'outfit' ? x.efeito.looktype : null),
    vipExclusive: !!x.vipExclusive,
    betaExclusive: !!x.betaExclusive,
    // As Caixas de Fundador. `caixaBeta` é o TIPO ('fundador' | 'cofundador') e é o que faz a
    // vitrine trocar o card comum pelo card de caixa — com o baú, a lista do que vem dentro,
    // o contador de restantes e (antes do lançamento) a contagem regressiva.
    caixaBeta: x.caixaBeta ?? null,
    looktypeCaixa: x.looktypeCaixa ?? null,
    diamantesCaixa: x.diamantesCaixa ?? null,
    limiteCaixa: x.limiteCaixa ?? null,
    corCaixa: x.corCaixa ?? null,
    tagCaixa: x.tagCaixa ?? null,
    // "Só uma vez a cada N dias" (o Pacote de Suprimentos). A tela mostra o selo.
    limiteDias: x.limiteDias ?? null,
    // O kit de boosts: o que vem dentro e quanto se economiza. Vem PRONTO do servidor porque
    // o preço avulso de cada boost é dele — a tela refazendo a conta seria uma segunda tabela
    // de preços no cliente, que diverge no primeiro reajuste e mente sobre o desconto.
    pacote: x.pacote ?? null,
  }));
