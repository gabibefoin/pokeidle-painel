// A ESCADA DO PvP RANQUEADO — o que cliente e servidor precisam enxergar igual.
//
// Um número só governa tudo: os **pontos de ranking** (PR). Tier, divisão, barra de
// progresso, janela de busca e ganho por partida são todos derivados dele. É por isso que
// este arquivo é pura aritmética, sem banco e sem rede: o cliente desenha "Ouro II · 1.340
// PR · faltam 60 para Ouro I" na hora, sem uma ida ao servidor, e o servidor decide o
// resultado da partida com as MESMAS funções. Um cliente adulterado não tem o que inventar
// — ele não calcula nada que valha.
//
// ### Por que um número contínuo, e não um balde por divisão
//
// League of Legends guarda tier + divisão + LP, e paga o preço disso em regras de promoção
// (séries, LP que "sobra", proteção de rebaixamento). O balde existe lá porque o MMR interno
// é OUTRO número, escondido, e a divisão é só a vitrine. Aqui os dois são a mesma coisa:
// o que emparelha é o que aparece na tela. Isso tira uma classe inteira de bugs ("subi de
// divisão mas continuo pegando gente do rank de baixo") e deixa a barra de progresso ser o
// que ela parece ser.
//
// A única regra de balde que sobrou é o ESCUDO de tier (`PVP_ESCUDO_TIER`), porque cair de
// Ouro para Prata na primeira derrota depois de promover é a sensação ruim que a proteção de
// rebaixamento do LoL existe para evitar.

/**
 * PR de quem nunca jogou: ZERO. Todo mundo começa no pé da escada e sobe.
 *
 * Já foi 700 (o meio do Ouro), e a razão de ter mudado é de produto, não de matemática:
 * **a escada inteira é a progressão**, e ela tem de ser subida. Começar no meio dava metade
 * do caminho de graça e transformava o Bronze num lugar por onde ninguém passa — só cai.
 *
 * A troca tem uma consequência que vale entender, porque é ela que faz a escada funcionar:
 * com todo mundo no piso, o Elo **deixa de ser soma zero**. Quem perde estando em zero não
 * tem o que perder, e o ponto que o vencedor leva é criado ali. É essa torneira que espalha a
 * população para cima ao longo dos meses — e é por isso que Mestre e Challenger passaram a ser
 * por VAGA (`vagas`, logo abaixo) em vez de por número: contra inflação, um teto de posição é
 * a única defesa que não envelhece.
 */
export const PVP_PONTOS_INICIAIS = 0;

/**
 * Teto do PR enquanto o jogador está no posicionamento: o topo do BRONZE.
 *
 * O pedido é literal — "começar no Bronze I", "o máximo que o cara pode chegar é Bronze III",
 * "pode pegar um Bronze 3 se tiver 4/0". Ou seja: a estreia acontece dentro do Bronze inteiro.
 * Quem vai bem sobe pelas três divisões dele e no fim do posicionamento encontra gente de
 * Bronze III; quem vai mal fica no I. O que não pode é a estreia cuspir alguém no meio da
 * tabela.
 *
 * O número é derivado, e não escrito à mão: é o último PR do Bronze. Mexer nos tiers move o
 * teto junto, que é o certo — o teto É "o topo do Bronze", não "299".
 */
export const PVP_TETO_POSICIONAMENTO = 299;

/** Piso absoluto. Ninguém fica com PR negativo — a tabela ficaria feia e a conta, sem sentido. */
export const PVP_PONTOS_MIN = 0;

/** Largura de uma divisão, em PR. O mesmo número em toda a escada: a barra mede sempre igual. */
export const PVP_PONTOS_POR_DIVISAO = 100;

/**
 * Os sete tiers, de baixo para cima. `de` é o PR em que o tier começa.
 *
 * Bronze → Diamante têm três divisões de 100 PR (300 por tier) e são decididos pelo NÚMERO.
 *
 * Mestre e Challenger não são. Os dois começam no mesmo PR (`PVP_PR_ELITE`) e o que separa um
 * do outro — e os dois de quem só tem os pontos — é a **posição na tabela**: as 20 primeiras
 * são Challenger, da 21ª à 50ª é Mestre, e quem passa dos pontos mas não alcança vaga fica em
 * Diamante I, esperando. É o desenho do LoL, e ele existe por um motivo que a escada de baixo
 * não tem: número infla, posição não. Daqui a um ano o PR necessário para ser bom terá subido;
 * "estar entre os 20 melhores do servidor" quer dizer a mesma coisa para sempre.
 *
 * ### Por que a escada inteira mede 1.800 PR, e não 3.500
 *
 * A largura não é gosto: ela é lida pela fórmula do Elo, onde 400 pontos valem 10 para 1.
 * Uma escada de 3.500 diria que o Challenger vence o Bronze 562 MILHÕES de vezes em cada
 * derrota — um número que não descreve jogador nenhum, e que na prática deixaria toda a
 * população espremida nos dois tiers do meio, com Diamante e acima inalcançáveis.
 *
 * Com 1.800, cada degrau significa alguma coisa: uma DIVISÃO (100 PR) é 64% de chance, um
 * TIER (300 PR) é 85%, e a distância do pé ao topo é a de um placar de xadrez real — que é
 * exatamente o espalhamento que jogadores de verdade produzem. Isso foi medido, e não
 * chutado: `tools/teste-pvp-rank.mjs` simula uma população com força conhecida e falha se a
 * escada não a reproduzir.
 */
export const PVP_TIERS = [
  { id: 'bronze', divisoes: 3, de: 0 },
  { id: 'prata', divisoes: 3, de: 300 },
  { id: 'ouro', divisoes: 3, de: 600 },
  { id: 'platina', divisoes: 3, de: 900 },
  { id: 'diamante', divisoes: 3, de: 1200 },
  // Os dois de cima dividem a MESMA porta de entrada em pontos; quem passa por ela é
  // ordenado, e a posição decide. `vagas` é o teto de gente em cada um.
  { id: 'mestre', divisoes: 1, de: 1500, vagas: 50 },
  { id: 'challenger', divisoes: 1, de: 1500, vagas: 20 },
];

/** O PR que abre a porta da elite. Daqui para cima, quem manda é a posição na tabela. */
export const PVP_PR_ELITE = 1500;

/** Vagas de Challenger — as 20 primeiras posições da tabela. */
export const PVP_VAGAS_CHALLENGER = 20;

/** Vagas de Mestre — da 21ª à 50ª posição. */
export const PVP_VAGAS_MESTRE = 50;

/** O emblema de cada tier. Os sete `.webp` recortados da arte, com o fundo removido. */
export const iconeDoRank = (tierId) => `/img/ranks/${tierId}.webp`;

/**
 * Nível de TREINADOR para entrar na fila.
 *
 * O mesmo piso dos GINÁSIOS (`GINASIO_NIVEL_MIN`), e o paralelo é proposital: os dois são
 * conteúdo de fim de jogo, disputado contra outros jogadores, em que a equipe montada importa
 * mais do que o bicho que está em campo. A arena antiga pedia 80, e 80 é cedo demais para uma
 * escada de ranking — um treinador desse nível ainda está aprendendo o que é uma equipe, e o
 * que ele encontraria na fila é gente com o time fechado há meses.
 */
export const PVP_NIVEL_MIN = 150;

/** Pokémon por equipe de PvP. A equipe é fechada ANTES da fila e não muda durante a partida. */
export const PVP_TIME_MAX = 5;

/** Mínimo para entrar na fila. Menos de cinco é permitido — e é desvantagem, avisada na tela. */
export const PVP_TIME_MIN = 1;

/**
 * Partidas de posicionamento. Enquanto elas correm o rank não aparece — nem para o dono, nem
 * na tabela — e o PR é grampeado em `PVP_TETO_POSICIONAMENTO`.
 *
 * São o mesmo mecanismo das 10 partidas do LoL, com o número cortado pela metade porque a
 * população daqui é ordens de grandeza menor: dez partidas de posicionamento numa fila de
 * cinco pessoas seriam meia hora antes de o jogador ver o próprio emblema pela primeira vez.
 *
 * Elas já moveram o DOBRO de pontos, e não movem mais: aquilo servia para achar o lugar de
 * quem começava no meio da escada. Começando do chão não há lugar a achar — há caminho a
 * andar, e ele começa no Bronze III para todo mundo.
 */
export const PVP_PARTIDAS_POSICIONAMENTO = 5;

/** Derrotas de graça no piso de um tier recém-conquistado — ver `aplicarDelta`. */
export const PVP_ESCUDO_TIER = 1;

/**
 * Quanto a DERROTA cobra, em fração do que a vitória paga. `0.7` = perde-se 70% do que se
 * ganharia.
 *
 * ### Por que a escada não é de soma zero
 *
 * Esta é a peça que faz "começar no Bronze III e subir até Challenger" ser possível, e ela
 * não é gosto: é aritmética, e foi medida antes de ser escrita.
 *
 * Elo puro é soma zero — o que um leva é o que o outro deixa —, então a MÉDIA da população
 * fica para sempre onde ela nasceu. Com todo mundo nascendo no chão, a simulação de 200
 * jogadores × 300 partidas termina com o melhor deles em 578 PR: Ouro III. Diamante, Mestre e
 * Challenger não são "difíceis" nesse desenho, são **inalcançáveis** — não existe força que
 * chegue lá, porque não há de onde os pontos virem.
 *
 * Com o atrito, cada partida injeta um pouco: quem ganha metade das partidas sobe devagar,
 * quem ganha menos de ~41% desce. A escada vira o que o pedido descreve — uma progressão
 * longa — sem deixar de ordenar por mérito: quem ganha mais sobe mais rápido e está sempre à
 * frente de quem ganha menos.
 *
 * ### O preço, dito por extenso
 *
 * O número INFLA com o tempo. Daqui a um ano, 1.200 PR não vai querer dizer o que quer dizer
 * hoje. Isso é aceitável por uma razão só, e é a mesma que motivou o teto por vaga: **Mestre e
 * Challenger não são números, são posições** (`PVP_VAGAS_MESTRE`/`PVP_VAGAS_CHALLENGER`).
 * Inflem os pontos quanto inflarem, o topo continua sendo cinquenta e vinte pessoas.
 *
 * Para os tiers de baixo o remédio é o de sempre nos jogos que fazem isto: temporada. Zerar a
 * tabela de tempos em tempos e devolver todo mundo ao pé da escada — que é, aliás, o momento
 * em que a escada volta a medir o que mede hoje.
 */
export const PVP_ATRITO_DERROTA = 0.7;

/**
 * Espera obrigatória entre o fim de uma partida e a fila seguinte.
 *
 * Mora aqui, e não só no servidor, porque o BOTÃO precisa dela: sem o número em mãos, a tela
 * teria de perguntar ao servidor a cada segundo quando a espera vence. Quem RECUSA continua
 * sendo o servidor (`entrarNaFila`) — isto é o rótulo dizendo a verdade, não a trava.
 */
export const PVP_ENTRE_PARTIDAS_MS = 20_000;

// ------------------------------------------------------------ a TEMPORADA
//
// ### Por que a escada zera toda semana
//
// O Elo aqui não é soma zero (ver `PVP_ATRITO_DERROTA`): com todo mundo partindo de zero, o
// ponto que o vencedor leva de quem está no piso é CRIADO ali. Essa torneira espalha a
// população para cima com o tempo, e o número infla. Mestre e Challenger não sofrem com isso
// porque são POSIÇÃO, não número — mas os cinco tiers de baixo sofrem, e sem zerar eles viram
// um lugar por onde ninguém passa, só sobe.
//
// A temporada é o remédio de sempre, e o próprio `zerarEscadaUmaVez` já apontava para cá: a
// escada volta a medir o que mede hoje, e a semana passada vira prêmio em vez de número morto.
//
// Foi mensal até 18/09/2026 (virada no dia 1º, 00:00 UTC). Passou a SEMANAL, segunda-feira às
// 00:00 de Brasília: o topo volta a ser disputado toda semana, e o prêmio, menor, vem mais vezes.
//
// ### O preço, dito por extenso
//
// Reset TOTAL (a decisão de produto): todo mundo volta a 0 PR e ao posicionamento. O começo de
// cada semana não tem Mestre nem Challenger, porque ninguém teve tempo de chegar aos 1.500 — e
// quem entra no sábado não alcança o topo. É o custo de a escada voltar a valer o que vale, e
// ele é assumido.

/**
 * Horas sem partida que fazem Mestre/Challenger CAÍREM para o Diamante. Era uma semana; com a
 * temporada semanal, um dia parado já é tempo demais para segurar uma das vinte vagas de quem
 * está jogando.
 *
 * A queda é de PONTOS, e não só de emblema (ver `pontosAposDecaimento`). Até 18/09/2026 os
 * pontos ficavam e só a vaga saía — e o inativo seguia listado lá no alto, "Diamante III" com
 * 1.978 PR em 16º, acima dos Challengers de verdade. Quem sumiu desce para o topo do Diamante,
 * e para voltar à elite precisa passar de novo pelos 1.500.
 */
export const PVP_DECAIMENTO_HORAS = 24;
export const PVP_DECAIMENTO_MS = PVP_DECAIMENTO_HORAS * 60 * 60_000;

/** O PR em que o Diamante começa (Diamante I). Derivado dos tiers, e não um 1200 solto. */
export const PVP_PR_DIAMANTE = PVP_TIERS.find((x) => x.id === 'diamante').de;

/**
 * Os pontos de quem acabou de cair da elite por inatividade: **um acima do primeiro Diamante**.
 *
 * `topoDiamante` é o maior PR abaixo de `PVP_PR_ELITE` na tabela — o primeiro Diamante. Quem
 * cai fica logo acima dele: é o novo topo do Diamante, e passa a ser ultrapassado por qualquer
 * um que ainda tenha pontos de elite.
 *
 * Os dois limites existem porque "um acima" sozinho pode mentir:
 *
 *   · TETO em `PVP_PR_ELITE - 1` (Diamante III, 1.499). Se o primeiro Diamante já está no 1.499,
 *     "um acima" seria 1.500 — pontos de elite de novo, e a queda não teria acontecido. Aí os
 *     dois empatam no teto, e o desempate da tabela (vitórias) decide.
 *   · PISO em `PVP_PR_DIAMANTE` (Diamante I). Numa tabela sem Diamante nenhum, o "primeiro" é um
 *     Platina — e cair para a Platina é mais do que o pedido, que é cair PARA O DIAMANTE.
 *
 * `degrau` é para quando vários caem na MESMA passada: o de menos pontos leva `degrau` 1, o
 * seguinte 2, e assim por diante. Sem isso todos empatariam no mesmo número e a ordem entre eles
 * — quem tinha mais pontos antes de sumir — iria embora.
 */
export function pontosAposDecaimento(topoDiamante, degrau = 1) {
  const base = Math.max(PVP_PR_DIAMANTE - 1, Math.floor(Number(topoDiamante) || 0));
  const passo = Math.max(1, Math.floor(Number(degrau) || 1));
  return Math.min(PVP_PR_ELITE - 1, base + passo);
}

/**
 * O instante (ms, relógio do servidor) em que a elite deste jogador cai, ou `null`.
 *
 * É o timer da tela. Só existe para quem está com a vaga — Challenger ou Mestre —, porque é só
 * a eles que a regra se aplica. Toda partida ranqueada carimba `ultimaEm` de novo, e o relógio
 * volta às 24 horas.
 */
export function decaiEm(ultimaEm, tierId) {
  if (tierId !== 'challenger' && tierId !== 'mestre') return null;
  if (ultimaEm == null) return null;
  const t = ultimaEm instanceof Date ? ultimaEm.getTime() : Number(new Date(ultimaEm));
  return Number.isFinite(t) ? t + PVP_DECAIMENTO_MS : null;
}

/**
 * O prêmio de cada faixa na virada da semana, por POSIÇÃO na tabela final.
 *
 * As faixas seguem a escada, e não um número solto: `ate: 3` é o pódio do Challenger, `ate: 20`
 * é o resto dele (`PVP_VAGAS_CHALLENGER`) e `ate: 50` é o Mestre (`PVP_VAGAS_MESTRE`). Cada
 * jogador recebe UM pacote — a busca para na primeira faixa que o cobre.
 *
 * `horas` é a duração de cada boost, EM HORAS (eram dias até a temporada virar semanal — o
 * registro do prêmio guarda a unidade junto, ver `pvp_premios.unidade`). As chaves são as de
 * `TIPOS_BOOST` em `server/game/loja.mjs` (`shiny` é o Shiny Secret Lure e `captura` é o Capture
 * Boost; os ids de produto deles divergem, as chaves não). O prêmio NÃO consome a cota diária de
 * boost: cota é freio de compra, e isto não é compra.
 */
export const PVP_PREMIOS = [
  { ate: 3, faixa: 'podio', horas: { shiny: 48, captura: 48 } },
  { ate: PVP_VAGAS_CHALLENGER, faixa: 'challenger', horas: { shiny: 18, captura: 18 } },
  { ate: PVP_VAGAS_MESTRE, faixa: 'mestre', horas: { xp: 18, pokexp: 18 } },
];

/** O prêmio desta posição, ou `null` se ela não premia. Posição 0/ausente nunca premia. */
export function premioDaPosicao(posicao) {
  const pos = Math.floor(Number(posicao) || 0);
  if (pos < 1) return null;
  return PVP_PREMIOS.find((f) => pos <= f.ate) ?? null;
}

/**
 * Quanto Brasília está ATRÁS do UTC. A virada é segunda-feira, 00:00 de Brasília = 03:00 UTC.
 *
 * Fixo, e não `America/Sao_Paulo` pelo Intl: o Brasil não tem horário de verão desde 2019, e um
 * deslocamento escrito aqui dá a mesma resposta no servidor, na tela e no teste — sem depender da
 * base de fusos do Node nem da do navegador de cada jogador. Se o horário de verão voltar, é
 * aqui que se mexe (o `CAMPEONATO` também escreve as datas dele em UTC−3).
 */
export const PVP_FUSO_VIRADA_MS = 3 * 60 * 60_000;

const SEMANA_MS = 7 * 24 * 60 * 60_000;

/** A chave semanal: a segunda-feira em que a temporada começa, "AAAA-MM-DD". A mensal era "AAAA-MM". */
export const TEMPORADA_SEMANAL_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A competência de um instante, como "2026-09-14" — a SEGUNDA-FEIRA (em Brasília) que abriu a
 * semana em que ele cai.
 *
 * Instante absoluto, e não o fuso do processo: a virada tem de acontecer no mesmo instante para
 * todo mundo, e um servidor que suba com `TZ` diferente não pode virar a semana duas vezes nem
 * pular uma. O relógio de Brasília é obtido deslocando o instante, e lido com `getUTC*`.
 */
export function temporadaDe(agora) {
  const brasilia = new Date(Number(agora) - PVP_FUSO_VIRADA_MS);
  const desdeSegunda = (brasilia.getUTCDay() + 6) % 7; // segunda = 0 … domingo = 6
  return new Date(Date.UTC(
    brasilia.getUTCFullYear(), brasilia.getUTCMonth(), brasilia.getUTCDate() - desdeSegunda,
  )).toISOString().slice(0, 10);
}

/** O instante (ms UTC) em que a temporada começa: a segunda-feira dela, 00:00 em Brasília. */
export const inicioDaTemporada = (competencia) =>
  Date.parse(`${competencia}T00:00:00Z`) + PVP_FUSO_VIRADA_MS;

/** O instante em que ela ACABA — e a próxima começa. É o relógio da tela ("fecha em …"). */
export const fimDaTemporada = (competencia) => inicioDaTemporada(competencia) + SEMANA_MS;

/** A temporada ANTERIOR a esta — é dela que sai a premiação na virada. */
export function temporadaAnterior(competencia) {
  return new Date(Date.parse(`${competencia}T00:00:00Z`) - SEMANA_MS).toISOString().slice(0, 10);
}

/**
 * O jogador está inativo para efeito de VAGA?
 *
 * Quem tira os PONTOS é a passada do servidor (`aplicarDecaimento`, a cada poucos segundos). Isto
 * cobre o intervalo até ela rodar — e um shard da arena fora do ar: o emblema cai na hora certa
 * mesmo que o número ainda não tenha descido. `ultimaEm` nulo (nunca jogou) não é inatividade —
 * é posicionamento, e quem posiciona já não disputa vaga.
 */
export function vagaDecaiu(ultimaEm, agora = Date.now()) {
  if (ultimaEm == null) return false;
  const t = ultimaEm instanceof Date ? ultimaEm.getTime() : Number(new Date(ultimaEm));
  if (!Number.isFinite(t)) return false;
  return agora - t >= PVP_DECAIMENTO_MS;
}

// ------------------------------------------------------------------ o rank

const NUM_DIVISAO = ['I', 'II', 'III'];

/** Índice do tier que contém este PR. Sempre existe: o último é aberto. */
function idxDoTier(pontos) {
  let i = 0;
  for (let k = 0; k < PVP_TIERS.length; k++) if (pontos >= PVP_TIERS[k].de) i = k;
  return i;
}

/**
 * O rank a partir do PR SOZINHO — sem olhar posição nenhuma.
 *
 * É o que serve para descrever FAIXAS ("buscando entre Ouro II e Platina III"), onde posição
 * não faz sentido. Para o rank de um jogador de verdade use `rankComVaga`, que aplica o teto de
 * vagas do topo: aqui, qualquer PR acima de `PVP_PR_ELITE` sai como Mestre, que é o nome da
 * porta de entrada da elite.
 *
 * ### A divisão conta PARA CIMA: I é a entrada, III é o topo
 *
 * "Bronze I" é onde todo mundo começa e "Bronze III" é o degrau antes da Prata. É o inverso do
 * League of Legends, e é de propósito: a numeração aqui SOBE junto com o jogador, que é como a
 * pessoa lê um número sem ninguém explicar. No LoL a ordem invertida é herança de um sistema em
 * que se subia de "divisão 5" para "divisão 1"; aqui não há essa herança para carregar.
 *
 * `progresso` é 0..1 DENTRO da divisão atual, e é a barrinha. Na elite não há faixa seguinte,
 * então ele vem como `null`: uma barra sem fim é uma barra que mente.
 */
export function rankDePontos(pontosBruto) {
  const pontos = Math.max(PVP_PONTOS_MIN, Math.round(Number(pontosBruto) || 0));
  const idx = idxDoTier(pontos);
  const tier = PVP_TIERS[idx];

  if (tier.divisoes === 1) {
    return {
      pontos,
      tierId: 'mestre',
      tierIdx: PVP_TIERS.findIndex((x) => x.id === 'mestre'),
      divisao: 0,
      divisaoNum: '',
      rotulo: 'mestre',
      de: PVP_PR_ELITE,
      ate: Infinity,
      aberto: true,
      naFaixa: pontos - PVP_PR_ELITE,
      larguraFaixa: null,
      progresso: null,
      icone: iconeDoRank('mestre'),
    };
  }

  const dentro = Math.min(
    tier.divisoes - 1,
    Math.floor((pontos - tier.de) / PVP_PONTOS_POR_DIVISAO),
  );
  const de = tier.de + dentro * PVP_PONTOS_POR_DIVISAO;
  // `dentro` 0 é a divisão de ENTRADA do tier, e ela é a I. O número sobe com o jogador.
  const divisao = dentro + 1;
  return {
    pontos,
    tierId: tier.id,
    tierIdx: idx,
    divisao,
    divisaoNum: NUM_DIVISAO[divisao - 1] ?? String(divisao),
    rotulo: `${tier.id} ${NUM_DIVISAO[divisao - 1] ?? divisao}`,
    de,
    ate: de + PVP_PONTOS_POR_DIVISAO,
    aberto: false,
    naFaixa: pontos - de,
    larguraFaixa: PVP_PONTOS_POR_DIVISAO,
    progresso: (pontos - de) / PVP_PONTOS_POR_DIVISAO,
    icone: iconeDoRank(tier.id),
  };
}

/**
 * O rank de um JOGADOR — o PR mais a posição dele na tabela.
 *
 * Abaixo de `PVP_PR_ELITE` a posição é irrelevante e isto é `rankDePontos`. Acima dela, quem
 * decide é a fila de espera:
 *
 *   1º ao 20º ....... Challenger
 *   21º ao 50º ...... Mestre
 *   51º em diante ... Diamante III (o topo do Diamante), com `aguardandoVaga` ligado
 *
 * O terceiro caso é o que dá sentido aos dois primeiros. Sem ele, "Mestre" seria só um número
 * que todo mundo alcança com tempo; com ele, entrar exige que alguém saia — e a tela pode
 * dizer exatamente isso ("Diamante III · 62º, faltam 12 posições para o Mestre") em vez de
 * mostrar um emblema que mente.
 *
 * `posicao` 0 ou `null` = sem posição conhecida (ainda no posicionamento, ou fora da tabela).
 * Nesse caso não há vaga a conceder, e o resultado é o mesmo do 51º em diante.
 *
 * ### A vaga tem DUAS formas de escapar
 *
 * Ser ULTRAPASSADO é a primeira, e ela é automática: o rank sai da posição, que é recalculada
 * a cada leitura. Quem entra no 20º empurra o antigo 20º para o Mestre sem que nada precise
 * rodar.
 *
 * PARAR DE JOGAR é a segunda (`inativo`, de `vagaDecaiu`). Sem ela, as cinquenta vagas seriam
 * tomadas por quem chegou primeiro e saiu do jogo — e a escada, que existe para dizer quem
 * está no topo AGORA, viraria um museu. Aqui o inativo perde só o emblema; os pontos descem
 * logo depois, na passada do servidor (`pontosAposDecaimento`), e é aí que ele sai do alto da
 * tabela.
 */
export function rankComVaga(pontosBruto, posicao, { inativo = false } = {}) {
  const base = rankDePontos(pontosBruto);
  if (base.pontos < PVP_PR_ELITE) return base;

  const pos = inativo ? 0 : Number(posicao) || 0;
  if (pos > 0 && pos <= PVP_VAGAS_CHALLENGER) {
    return { ...base, tierId: 'challenger', rotulo: 'challenger', icone: iconeDoRank('challenger'), posicao: pos };
  }
  if (pos > 0 && pos <= PVP_VAGAS_MESTRE) {
    return { ...base, posicao: pos };
  }

  // Tem os pontos e não tem a vaga: fica no topo do Diamante, com a barra cheia e o motivo
  // dito por extenso. `pontos` continua sendo o de verdade — o que ele não tem é o emblema.
  const diamante = PVP_TIERS.find((x) => x.id === 'diamante');
  const topo = diamante.divisoes;
  const deTopo = diamante.de + (topo - 1) * PVP_PONTOS_POR_DIVISAO;
  return {
    ...base,
    tierId: 'diamante',
    tierIdx: PVP_TIERS.findIndex((x) => x.id === 'diamante'),
    divisao: topo,
    divisaoNum: NUM_DIVISAO[topo - 1],
    rotulo: `diamante ${NUM_DIVISAO[topo - 1]}`,
    de: deTopo,
    ate: PVP_PR_ELITE,
    aberto: false,
    naFaixa: PVP_PONTOS_POR_DIVISAO,
    larguraFaixa: PVP_PONTOS_POR_DIVISAO,
    progresso: 1,
    icone: iconeDoRank('diamante'),
    posicao: pos || null,
    aguardandoVaga: true,
    // Por que a vaga não veio. A tela precisa dizer coisas diferentes: "faltam 12 posições"
    // quando é fila, e "volte a jogar para recuperar" quando é decaimento — no segundo caso
    // não há posição a mostrar, porque o inativo saiu da contagem da elite.
    vagaDecaiu: !!inativo,
    faltamPosicoes: pos > 0 ? Math.max(1, pos - PVP_VAGAS_MESTRE) : null,
  };
}

/** Ainda posicionando? Enquanto for, o rank não vale para tabela nem para vitrine. */
export const emPosicionamento = (partidas) =>
  (Number(partidas) || 0) < PVP_PARTIDAS_POSICIONAMENTO;

// ------------------------------------------------------------------- o Elo

/**
 * Fator K por tier — quanto uma partida move o PR.
 *
 * Cai conforme se sobe, e é de propósito: embaixo o placar precisa CONVERGIR rápido (o
 * jogador novo tem de achar o próprio lugar em poucas partidas), em cima ele precisa ser
 * ESTÁVEL (uma noite de sorte não pode virar Challenger). É a mesma curva de ganho de LP do
 * LoL, escrita de forma explícita em vez de escondida num MMR paralelo.
 */
const K_POR_TIER = {
  bronze: 32, prata: 32, ouro: 26, platina: 26, diamante: 22, mestre: 18, challenger: 18,
};

export const kDoTier = (tierId) => K_POR_TIER[tierId] ?? 32;

/**
 * A expectativa de vitória de `a` contra `b` — a fórmula de Elo, sem tempero.
 *
 * 400 pontos de diferença = 10 para 1. Como uma divisão são 100 PR, um tier inteiro de
 * vantagem (300) já é ~85% de expectativa: bater quem está três divisões abaixo quase não
 * paga, e perder para ele custa caro. É exatamente o comportamento pedido.
 */
export const expectativa = (pontosA, pontosB) => 1 / (1 + 10 ** ((pontosB - pontosA) / 400));

/**
 * Quanto a partida move os dois lados.
 *
 * ### O K é o do jogador MAIS ESTÁVEL dos dois
 *
 * `Math.min(Ka, Kb)`. Sem isso, um Challenger emparelhado com um Prata (o que só acontece
 * depois de horas de fila) veria o Prata mover 32 e ele mover 18 — a mesma partida valendo
 * duas coisas diferentes, dependendo de para quem se pergunta. Com o mínimo, os dois se movem
 * pela mesma régua.
 *
 * ### A derrota custa MENOS do que a vitória paga
 *
 * `PVP_ATRITO_DERROTA` — ver o comentário lá em cima. É o que permite a escada subir a partir
 * do chão; sem ele, Diamante para cima não existiria para ninguém.
 *
 * ### O que `peso` faz hoje
 *
 * `peso` (0..1) entra multiplicando os DOIS lados, e hoje ele só tem dois valores: 1 na partida
 * normal e 0 quando os dois vêm da MESMA CASA (mesmo endereço).
 *
 * Já houve um terceiro caso — a revanche pagava metade, depois um quarto, e do quinto encontro
 * em diante nada. Foi RETIRADO: escrito contra duas contas combinadas, numa população pequena
 * ele acertava o alvo errado, porque o topo da tabela se reencontra por não haver mais ninguém
 * na faixa e passava a jogar de graça. O conluio continua contido pela mesma casa, pela espera
 * de `REVANCHE_MS` e pelo próprio Elo, que encolhe o ganho de quem só vence o mesmo oponente.
 *
 * @param a `{ pontos, partidas }` do lado A
 * @param b idem, lado B
 * @param venceuA `true` se A ganhou
 * @param peso 1 na partida normal, 0 quando os dois vêm da mesma casa
 * @returns `{ deltaA, deltaB }` — já arredondados e com movimento mínimo de 1
 */
export function deltaDaPartida(a, b, venceuA, peso = 1) {
  const pa = Math.max(PVP_PONTOS_MIN, Number(a.pontos) || 0);
  const pb = Math.max(PVP_PONTOS_MIN, Number(b.pontos) || 0);
  const kBase = Math.min(kDoTier(rankDePontos(pa).tierId), kDoTier(rankDePontos(pb).tierId));
  const ka = kBase * peso;
  const kb = kBase * peso;

  const ea = expectativa(pa, pb);
  const sa = venceuA ? 1 : 0;

  // O mínimo de 1 existe para que NENHUMA partida termine em "não aconteceu nada". Sem ele,
  // um Challenger que vence um Prata move 0,3 → arredonda para zero, e a tela mostra uma
  // vitória que não valeu ponto nenhum. Um ponto é pouco e é honesto.
  //
  // `peso === 0` é a ÚNICA exceção, e hoje ela quer dizer uma coisa só: os dois vêm da MESMA
  // CASA. Deixar o mínimo valer ali daria a duas contas do mesmo dono 1 PR por partida para
  // sempre — pouco por vez, mas uma torneira aberta.
  const zerado = peso <= 0;
  const passo = (k, s, e) => {
    if (zerado) return 0;
    // A derrota paga menos do que a vitória — é o atrito, e é ele que faz a escada subir.
    const bruto = k * (s - e) * (s > e ? 1 : PVP_ATRITO_DERROTA);
    if (bruto === 0) return s > e ? 1 : -1;
    const arred = Math.round(bruto);
    if (arred !== 0) return arred;
    return bruto > 0 ? 1 : -1;
  };

  return {
    deltaA: passo(ka, sa, ea),
    deltaB: passo(kb, 1 - sa, 1 - ea),
  };
}

/**
 * Aplica o delta com o piso e o ESCUDO DE TIER.
 *
 * O escudo é a proteção de rebaixamento: quem acabou de promover para um tier novo tem
 * `PVP_ESCUDO_TIER` derrotas que param no piso do tier em vez de derrubá-lo. Sem isso,
 * promover para Ouro e voltar para Prata na partida seguinte é a experiência que faz o
 * jogador desistir da fila — e é exatamente o que a série de promoção do LoL evita.
 *
 * O escudo NÃO é um presente permanente: gasta-se, e só volta a existir quando o jogador
 * conquistar um tier acima do maior que já teve (`tierTopo`). Assim ele protege a conquista
 * NOVA, e não vira um colchão eterno no mesmo degrau.
 *
 * @param linha `{ pontos, escudo, tierTopo, partidas }`
 * @param delta o movimento cru vindo de `deltaDaPartida`
 * @returns `{ pontos, escudo, tierTopo, deltaAplicado, escudoUsou, promoveu, rebaixou }`
 */
export function aplicarDelta(linha, delta) {
  const antes = Math.max(PVP_PONTOS_MIN, Math.round(Number(linha.pontos) || 0));
  // O teto do posicionamento vale para a partida que ESTÁ sendo aplicada — por isso a
  // comparação usa `partidas` como ela está ANTES de somar 1. Na quinta e última partida de
  // posicionamento o teto ainda vale; da sexta em diante o caminho abre.
  //
  // `Number.isFinite` primeiro, e não só `emPosicionamento`: sem o campo, `Number(undefined)`
  // é NaN e `NaN < 5` é falso — mas a leitura ingênua ("0 partidas, logo está posicionando")
  // é a que um chamador distraído faria, e o custo dela seria grampear o PR de um veterano em
  // 99 sem dizer nada. Faltando o campo, o certo é NÃO capar: a linha do banco sempre o tem
  // (`NOT NULL DEFAULT 0`), então só chega aqui sem ele quem o esqueceu.
  const noPosicionamento = Number.isFinite(Number(linha.partidas))
    && emPosicionamento(linha.partidas);
  const tierAntes = idxDoTier(antes);
  let escudo = Math.max(0, Math.floor(Number(linha.escudo) || 0));
  // `|| 0` e não `??`: `Number(undefined)` é NaN, e `??` NÃO pega NaN. O escudo nunca seria
  // concedido (toda comparação com NaN é falsa) e o NaN acabaria numa coluna INT do Postgres,
  // derrubando a transação que grava a partida inteira.
  let tierTopo = Math.max(0, Math.floor(Number(linha.tierTopo) || 0));

  let depois = Math.max(PVP_PONTOS_MIN, antes + Math.round(delta));
  // O teto do posicionamento impede SUBIR além dele — nunca faz descer. O `Math.max(teto,
  // antes)` é o que garante isso, e ele não é teórico: sem essa metade, um jogador que já
  // estivesse acima do teto (linha vinda de uma versão anterior da escada, por exemplo) via
  // uma VITÓRIA virar "-601 PR · você caiu de tier" na tela. Um teto que puxa para baixo não é
  // um teto, é uma punição — e uma punição por ter ganhado.
  if (noPosicionamento) depois = Math.min(depois, Math.max(PVP_TETO_POSICIONAMENTO, antes));
  let escudoUsou = false;

  if (delta < 0 && idxDoTier(depois) < tierAntes && escudo > 0) {
    depois = PVP_TIERS[tierAntes].de;
    escudo -= 1;
    escudoUsou = true;
  }

  const tierDepois = idxDoTier(depois);
  const promoveu = tierDepois > tierAntes;
  const rebaixou = tierDepois < tierAntes;

  // Escudo novo só ao pisar num tier INÉDITO — ver o comentário acima.
  if (promoveu && tierDepois > tierTopo) {
    tierTopo = tierDepois;
    escudo = PVP_ESCUDO_TIER;
  }

  return {
    pontos: depois,
    escudo,
    tierTopo,
    deltaAplicado: depois - antes,
    escudoUsou,
    promoveu,
    rebaixou,
  };
}

// ------------------------------------------------------- a janela de busca

/**
 * Como a busca AFROUXA com o tempo de espera: `[msDeEspera, janelaEmPR]`.
 *
 * A janela é a diferença de PR que os dois lados aceitam. Ela começa apertada (25 PR é um
 * quarto de divisão: o encontro é entre iguais de verdade) e abre DEVAGAR.
 *
 * ### Devagar quanto, e por quê
 *
 * Seis horas para aceitar qualquer um. Uma divisão (100 PR) leva cinco minutos; um tier
 * inteiro (300 PR) leva mais de meia hora; a escada toda, o dia de trabalho.
 *
 * A primeira versão abria em sete minutos, e estava errada pelo motivo mais simples: a janela
 * é a única coisa que define o que "rank" quer dizer. Se em quatro minutos um Bronze III pode
 * encontrar um Challenger, então o emblema não separa ninguém de ninguém — ele vira enfeite, e
 * a escada inteira vira sorteio. Preferir a fila vazia à partida errada é o que faz o número
 * significar alguma coisa.
 *
 * O preço é honesto e conhecido: com pouca gente online, a fila demora. É exatamente para isso
 * que existe a fila automática (VIP) — ela transforma a espera longa em algo que se liga e se
 * esquece, em vez de uma tela para ficar olhando.
 *
 * O pareamento é o segundo mecanismo, e ele age mesmo quando a janela já abriu: quem casa é
 * sempre o par de PR MAIS PRÓXIMO da fila inteira (ver `emparelhar` em
 * `game/pvp-ranqueado.mjs`). Dois Challengers na fila se acham antes de qualquer um deles
 * olhar para baixo. A janela só decide o que é ACEITÁVEL quando não há nada melhor.
 */
const MIN = 60_000;
const HORA = 60 * MIN;

export const PVP_DEGRAUS_JANELA = [
  [0, 25],
  [2 * MIN, 50],
  [5 * MIN, 100],
  [15 * MIN, 150],
  [30 * MIN, 250],
  [1 * HORA, 400],
  [2 * HORA, 600],
  [4 * HORA, 1000],
  [6 * HORA, Infinity],
];

/** A janela aceita por quem está esperando há `esperaMs`, interpolada entre os degraus. */
export function janelaDeBusca(esperaMs) {
  const t = Math.max(0, Number(esperaMs) || 0);
  const d = PVP_DEGRAUS_JANELA;
  if (t >= d[d.length - 1][0]) return Infinity;
  for (let i = d.length - 2; i >= 0; i--) {
    if (t < d[i][0]) continue;
    const [t0, j0] = d[i];
    const [t1, j1] = d[i + 1];
    if (!Number.isFinite(j1)) return j0;
    return j0 + ((j1 - j0) * (t - t0)) / (t1 - t0);
  }
  return d[0][1];
}

/**
 * Os dois se aceitam?
 *
 * A janela que vale é a do MENOS paciente (`Math.min`). Quem acabou de entrar na fila não
 * pode ser arrastado para uma partida desequilibrada só porque o outro lado já esperou dez
 * minutos — a espera dele é dele, não uma licença sobre o adversário.
 */
export function aceitamSeMutuamente(a, b, agora) {
  const janela = Math.min(janelaDeBusca(agora - a.desde), janelaDeBusca(agora - b.desde));
  return Math.abs(a.pontos - b.pontos) <= janela;
}
