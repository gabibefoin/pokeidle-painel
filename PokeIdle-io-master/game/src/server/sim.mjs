// Worker de simulação: dono autoritativo de um subconjunto dos jogadores (shard).
//
// Cada jogador é uma máquina de estado independente — não há interação mecânica entre eles
// (é idle, cada um tem seus próprios selvagens). Isso é o que torna o sharding trivial:
// `shardDoJogador(id)` decide o dono e ninguém precisa coordenar nada.
//
// O tick roda a cada TICK_MS e nunca toca o banco. Estado sujo vai para o writer em lote.
import { config, shardDoJogador } from './config.mjs';
import { randomUUID } from 'node:crypto';
import {
  assinar, canalSim, canalGateway, publicar, enviarAoGateway, pub, tomarPosseDoShard, CANAL_GLOBAL, CANAL_CHAT, CANAL_EVENTO,
  CANAL_GUILD,
  publicarOcupacaoArenas, ocupacaoArenasCluster, gatewayDoJogador, PRESENCA,
} from './bus.mjs';
import { lembrarDaTela, igualATela } from './tela-igual.mjs';
import { SERVIDOR, CANAIS_CHAT, IDIOMAS_CHAT, CHAT_NIVEL_MIN } from './protocol.mjs';
import * as db from './db.mjs';
import { assinarSessao, contaPorNick, nickDisponivel } from './auth.mjs';
import { renomearCargoChat, CARGOS_MOD_CHAT, CARGOS_CMD_CHAT } from './admin.mjs';
import { precoVendaPokemon, valorEconomicoDe, TETO_PRICE_NPC_VENDA } from '../shared/sell-value.mjs';
import { itemVendavelAoNpc } from '../shared/venda-npc-item.mjs';
import { DISCORD_POP_CAMPANHA, discordPopDeveMostrar } from '../shared/discord-pop.mjs';
import { AVISO_VERSAO, avisoDeveMostrar } from '../shared/aviso-jogo.mjs';
import { ouroPorDerrotaHunt, xpPorDerrota } from '../shared/recompensa-hunt.mjs';
import { dexDe } from '../shared/escala-hunt-level.mjs';
import { chavePokedex, normalizarEntradasPokedex, migrarChavesPokedexLegado } from '../shared/pokedex.mjs';
import { isOutlandPokeId } from '../shared/outland.mjs';
import {
  catalogoOutlandTiers,
  multOutlandTier,
  nivelOutlandTier,
  outlandTier as fichaOutlandTier,
  rotuloOutlandTier,
  tierOutlandValido,
  OUTLAND_TIER_PADRAO,
} from '../shared/outland-tiers.mjs';
import { destinosDeEvolucao } from '../shared/evolucoes-ramificadas.mjs';
import { podeUsarPokemon as podeUsarPokemonPorNivel, nivelMinimoTreinador } from '../shared/pokemon-nivel-treinador.mjs';
import { validarNivelAlvo, PASSO_REDUCAO_NIVEL } from '../shared/reduzir-nivel.mjs';
import {
  notaDePokemon,
  notaMercadoDoPokemon,
  poderDePokemon,
  POTENCIA_MAX,
  PODER_FORMULA_VERSAO,
  NOTA_FORMULA_VERSAO,
  MERCADO_POKEMON_MIN,
  AUTO_LOCK_NOTA_MIN,
  notaAutoLockValida,
  motivoNaoAnunciavel,
  pokemonAnunciavel,
  atendeNotaMercado,
} from '../shared/nota-pokemon.mjs';

export { MERCADO_POKEMON_MIN, AUTO_LOCK_NOTA_MIN, motivoNaoAnunciavel, pokemonAnunciavel };
import {
  STATS_REFINAVEIS,
  REFINO_CUSTO_BASE,
  REFINO_EXPOENTE,
  REFINO_TETO_TECNICO,
  REFINO_PASSO,
  normalizarRefino,
  totalDoRefino,
  temRefino,
  custoDoRefino,
  investidoNoRefino,
} from '../shared/refino-stats.mjs';
import {
  consumirPedrasRefino,
  formatarConsumoPedras,
  rotuloPedrasRefino,
  saldoPedrasRefino,
} from '../shared/refino-pedras.mjs';
import { rotuloPokemon } from '../shared/codigo-pokemon.mjs';
import { temSpriteJogo } from '../shared/sprite-jogo.mjs';
import {
  especies,
  itens,
  itensPorNome,
  bolaPorId,
  bolas,
  huntJogavelPorSlug,
  huntsJogaveis,
  centroPokemon,
  catalogoShiny,
  catalogoShinyOutland,
  OUTLAND_DEX,
  xpTotalParaNivel,
  nivelPeloXp,
  nivelDeCapturaDe,
  pisoDeReducaoDaEspecie,
  calcularStats,
  hpDeCombate,
  rolarQualidade,
  rolarIVs,
  rolarIVsShiny,
  rolarStarter,
  rolarPotencia,
  multDeNascenca,
  looktypeShiny,
  itensDoTipo,
  itensDaCategoria,
  ITENS_MERCADO,
  IDS_MERCADO_PERMITIDOS,
  itemAnunciavelMercado,
  CATEGORIAS_MERCADO,
  CATALOGO_MERCADO,
  especiesDoTipo,
  TIPO_DO_ITEM,
  POTENCIAS,
  MULT_SHINY_STATS,
  pedraDeEvolucao,
  pedraDeRefino,
  pedrasDeRefino,
  PEDRA_EVOLUCAO_POR_TIPO,
  MULT_HP_SELVAGEM,
  MULT_DANO_SELVAGEM,
  AMPLIACAO_HUNT,
  tabelaTipos,
  grades,
} from './content.mjs';
import { registrarArenasBosses } from './game/bosses-arenas.mjs';
import { calcularDano, melhorGolpe, melhorGolpeJogador, sortearSelvagem, nivelSelvagem, rolarLoot, cooldownComSpeed, ivSpeedDe } from './game/combate.mjs';
import {
  BOSSES,
  bossesCatalogo,
  bossPorKey,
  montarBoss,
  penalidadeDeEquipe,
  rolarDropsDeBoss,
  rolarBossTokenSelvagem,
  BOSS_EQUIPE_IDEAL,
  BOSS_TOKEN_ID,
  CHANCE_BOSS_TOKEN_SELVAGEM,
} from './game/bosses.mjs';
import {
  PIECE_ELEMENTAL,
  PIECE_AOE,
  DISK_AOE,
  DISCO_POR_TIPO,
  CUSTO_PECAS_ELEMENTAL,
  CUSTO_PECAS_AOE,
  discoElementalPorItemId,
  ehDiscoTm,
  tipoTmPermitido,
  alvosDoGolpe,
  configTmResearcher,
} from './game/tm.mjs';
import {
  criarCampo,
  moverCampo,
  porMobEmCampo,
  algumMobVivo,
  alvoMaisProximo,
  escolherAlvoHunt,
  distanciaDoHeroi,
  snapshotCampo,
  deltaCampo,
  limparCorpos,
  removerMob,
  DIST_COMBATE,
  MAX_MOBS,
  MS_ONDA,
} from './game/campo.mjs';
import * as odb from './orbs-db.mjs';
import * as ddb from './diamantes-db.mjs';
import * as adb from './afiliados-db.mjs';
import * as tdb from './topidle-db.mjs';
import * as mdb from './market-db.mjs';
import * as sdb from './shinys-db.mjs';
import * as p5db from './p5-db.mjs';
import * as edb from './eventos-db.mjs';
import { definirEvento, eventoParaCliente } from './game/eventos.mjs';
import { somarGoldAuditado, subtrairGold, registrarAcaoJogador, registrarCoinGrande } from './audit-db.mjs';
import * as enderecosOrb from './orbs-enderecos.mjs';
import {
  PRECO_COMPRA,
  PRECO_SAQUE,
  SPREAD,
  SAQUE_MINIMO_ORBS,
  REDES,
  MOTIVO,
  validarSaque,
  orbsParaUsdt,
  usdtParaOrbs,
  resumoDoCaixa,
  novaReferencia,
  REENVIO_DELAY_MS,
  arredondar6,
} from './game/orbs.mjs';
import {
  catalogoParaCliente,
  validarCompra,
  aplicarEfeito,
  multXpTreinador,
  multXpPokemon,
  multCaptura,
  multShiny,
  bonusLootPct,
  vipAtivo,
  consumirBless,
  BEAST_BALL,
  TIPOS_BOOST,
  LOOKTYPES_OUTFIT_VIP,
  BETA_OUTFITS_ABERTAS,
  podeEquiparLooktype,
  reverterOutfitVipExpirado,
} from './game/loja.mjs';
import { descartar as descartarDaBolsa, ErroDescarte } from './game/bolsa-descarte.mjs';
import * as cxdb from './caixas-db.mjs';
import {
  caixasParaCliente,
  sincronizarOutfitsDeCaixa,
  tagDoLooktype,
  vendaAberta,
  CAIXAS_ABREM,
} from './game/caixas.mjs';
import { caixaPorProduto, caixaPorTipo, nomeDaCaixa, textoTag } from '../shared/caixas-beta.mjs';
import { normalizarVisual, empacotarVisual, corpoPadrao } from './game/visual.mjs';
import {
  entrarNoCentro,
  sairDoCentro,
  andarNoCentro,
  atualizarPokemon as atualizarPokemonDoCentro,
  atualizarAparencia as atualizarAparenciaNoCentro,
  tickCentro,
  snapshotDoCentro,
  salaDe,
  membroDe as membroDoCentro,
  quantosNoCentro,
  TICK_MS as TICK_CENTRO_MS,
  CAPACIDADE_SALA,
  atualizarVelocidade as atualizarVelocidadeNoCentro,
} from './game/centro.mjs';
import {
  ARENAS,
  ligarGanchos,
  entrarNaArena as entrarNaArenaPvp,
  sairDaArena as sairDaArenaPvp,
  penalizarAbandono,
  trocarPokemonNaArena,
  podeSairDaArena,
  msParaSair,
  tickArenas,
  snapshotArena,
  ocupacaoDasArenas,
  arenaDe,
  membroDe,
  placarDaArena,
  ELO_INICIAL,
  PVP_SAIDA_MS,
  PVP_COOLDOWN_MS,
  PVP_XP_PERDIDO,
  PVP_NIVEL_MIN,
  PVP_FICHA_ID,
  PVP_ENTRADA_GOLD,
  arenaPorId,
} from './game/pvp.mjs';
import { aplicarPerdaDeXpTreinador } from './game/morte-xp.mjs';
import { MAX_CASAS_EM_USO } from '../shared/casas.mjs';
import { CUSTO_CRIAR_GUILD, MAX_TIME_GUILD, ESCUDOS, EMBLEMAS, HORA_PVP_GUILD_UTC, nomeGuildValido } from './game/guild.mjs';
import {
  CHANCE_FRAGMENTO_CHAVE,
  PRECO_CASA_DIAMANTE,
  darFragmentosDeChave,
  rolarFragmentoChave,
  fabricarCasaComFragmentos,
  raridadeCasaValida,
  ordenarCasas,
  casasAtivas,
  casaAtivaPorId,
  casaNaMaoPorId,
  fixarCasasEmUso,
  usarCasa,
  normalizarXpShare,
  xpShareParaGravar,
  mexeuNoXpShare,
  postosDaCasa,
  postoDoPokemon,
  registrarNoPosto,
  soltarPostosDaCasa,
  limparXpShare,
  aplicarXpShareLegado,
  recebedoresXpShare,
  casasNaBolsa,
} from './game/casas.mjs';
import * as casasDb from './casas-db.mjs';
import {
  rolarFragmentoShiny,
  shinyStoneDeEvolucao,
  fabricarShinyStone,
  configShinyStone,
} from './game/shiny-stone.mjs';
import {
  FRAGMENTO_MEGA_ID,
  FRAGMENTO_MEGA_SHINY_ID,
  fabricarMegaStone,
  megaStoneDeEvolucao,
  configMega,
} from './game/mega.mjs';
import { megaDaEspecie, megaTemShiny, megaPorPokeId } from '../shared/megas.mjs';
import {
  OFERENDA_CASAS, validarOferenda, girarOferenda, montarLoteDaOferenda,
} from './game/oferenda.mjs';
import { SHINY_STONE_POR_TIPO as SHINY_STONE_OFERENDA } from './game/itens-nossos.mjs';
import { RARIDADES_CASA, bonecosDaRaridade, xpShareDaRaridade, numeroDaCasa } from '../shared/casas.mjs';
import { RARIDADES_BICICLETA, raridadeBicicletaValida, numeroDaBicicleta } from '../shared/bicicletas.mjs';
import {
  CHANCE_FRAGMENTO_BICICLETA,
  bicicletasDoJogador,
  bicicletaEquipada,
  bicicletaNaMaoPorId,
  ordenarBicicletas,
  equipadaGravada,
  resolverEquipadaLegada,
  bicicletasNaBolsa,
  fatorPassoBicicleta,
  rolarFragmentoBicicleta,
  fabricarBicicletaComFragmentos,
  equiparBicicleta,
  INTERVALO_TROCA_BICICLETA_MS,
} from './game/bicicletas.mjs';
import * as bicicletasDb from './bicicletas-db.mjs';
import {
  FRAGMENTO_BICICLETA_ID,
  CUSTO_FRAGMENTOS_BICICLETA,
  BICICLETA_POR_RARIDADE,
  ehItemBicicleta,
} from './game/itens-nossos.mjs';
import {
  abrirCasa,
  tickCasa,
  andarNaCasa,
  sincronizarTreinos,
  snapshotDaCasa,
  casaDisponivel,
  atualizarAparencia as atualizarAparenciaNaCasa,
} from './game/casa-sala.mjs';
import {
  ITENS_NOSSOS,
  ESCAPE_ROPE_ID,
  FRAGMENTO_CHAVE_ID,
  FRAGMENTO_SHINY_ID,
  XP_SHARE_HELD_ID,
  CUSTO_FRAGMENTOS_CASA,
  CUSTO_FRAGMENTOS_SHINY_STONE,
  CASA_POR_RARIDADE,
  ehItemCasa,
} from './game/itens-nossos.mjs';
import {
  XP_SHARE_HELD_PCT, XP_SHARE_HELD_COOLDOWN_MS, ehXpShareHeldItem, planoDeCorteXpShare,
} from '../shared/xp-share-held.mjs';
import * as gdb from './guild-db.mjs';
import { registrarCompraMercado, registrarArremessoManual } from './telemetria-bot.mjs';
import { planoDaCompra } from './sorteio-mercado.mjs';
import * as amigosDb from './amigos-db.mjs';
import * as pvpAmistoso from './game/pvp-amistoso.mjs';
import * as passeBatalha from './game/passe-batalha.mjs';
import { normalizarPasse } from './game/passe-batalha.mjs';
import * as chatDb from './chat-db.mjs';
import { chatContemNft } from '../shared/chat-filtro.mjs';
import {
  ligarGanchosG,
  verificarEventoGuild,
  infoGuildWar,
  replayGuildWar,
  analiseGuildWar,
} from './game/guild-pvp.mjs';
import { ligarGanchosGlobal, verificarTemporadaGuild } from './game/guild-global.mjs';
import { entregarPremiosPvp, verificarDecaimentoPvp, verificarTemporadaPvp } from './game/pvp-temporada.mjs';
import {
  apurarAgora,
  desafiarLider,
  esquecerDesafio,
  infoGinasios,
  multDoGolpe,
  painelDoGinasio,
  recarregarLideres,
  tiposLiderados,
  verificarGinasios,
} from './game/ginasios.mjs';
import * as gindb from './ginasios-db.mjs';
import { ErroTreino, devolverVez, lutaDeTreino, reivindicarVez } from './game/treino.mjs';
import { ErroCaixa, comprarCaixa } from './game/caixas-npc.mjs';
import * as pvpdb from './pvp-ranqueado-db.mjs';
import * as trackerDb from './tracker-db.mjs';
import * as convdb from './convites-db.mjs';
import {
  ErroConvite,
  confirmarEntrega as confirmarEntregaDeConvite,
  entregarPendentes as entregarConvitesPendentes,
  resgatarCodigo as resgatarCodigoDeConvite,
} from './game/convites.mjs';
import * as campdb from './campeonato-db.mjs';
import {
  avancarCampeonatos,
  cancelar as cancelarInscricaoCampeonato,
  equipeDoCampeonatoValendo,
  escolherEquipe as escolherEquipeDoCampeonato,
  faxinarReplays,
  fitaDoCampeonato,
  infoCampeonato,
  inscrever as inscreverNoCampeonato,
  verificarCampeonatos,
} from './game/campeonato.mjs';
import { PVP_ENTRE_PARTIDAS_MS, PVP_PARTIDAS_POSICIONAMENTO } from '../shared/pvp-rank.mjs';
import {
  FILA_BATIDA_MS,
  avisarRankMudou,
  baterPonto as baterPontoNaFila,
  entrarNaFila,
  infoRanqueado,
  limparMemoriaDeEncontros,
  tamanhoDaFila,
  rodarMatchmaking,
  sairDaFila,
  souOPareador,
} from './game/pvp-ranqueado.mjs';
import { GINASIO_NIVEL_MIN } from '../shared/ginasios.mjs';

/**
 * Jogadores vivos neste worker, indexados pela CHAVE DE ROTEAMENTO (o nick em minúsculas).
 * O id numérico do Postgres vive em `p.dbId` e só aparece na persistência — se as duas
 * chaves se misturarem, o roteamento de volta para o socket quebra silenciosamente.
 */
const jogadores = new Map();

/**
 * Jogadores que ESTE shard tirou da própria memória e mandou para a Arena PvP, `key -> shard
 * de destino`. Enquanto durar a visita, TODA mensagem para esse jogador (inclusive `entrar` de
 * uma reconexão e `sair` de uma desconexão) é encaminhada para lá em vez de processada aqui —
 * ver o topo do handler de `canalSim`. Some quando ele volta (`pvp.retornouDoRemoto`) ou quando
 * o shard de destino avisa que ele já saiu de vez (`pvp.limparEmigrado`).
 */
const jogadoresEmigrados = new Map();

/**
 * Quem saiu da Arena PvP (de verdade, ainda visitante de outro shard) e precisa ser devolvido
 * — ou desalistado, se foi desconexão — mas só depois que o tick atual terminar.
 *
 * `sairDaArena` (em `pvp.mjs`) pode ser chamado no MEIO de outra função que ainda vai usar o
 * jogador depois — `abater()` chama `irParaOCentro` logo em seguida, o comando `pvp.sair`
 * idem. Arrancar o jogador de `jogadores` ali no meio deixaria essa continuação escrevendo
 * num objeto órfão. Por isso só se ANOTA a intenção aqui (`ganchos.aposSairDaArena`); quem
 * de fato remove e publica é `drenarRetornosDaArena`, chamado no fim de `tick()` — a essa
 * altura toda a lógica síncrona do tick já rodou, e mexer no jogador é seguro.
 */
const filaRetornoArena = new Map();
let ultimoCheckGuild = 0;
let ultimoCheckGuildGlobal = 0;
let ultimoCheckPvpTemporada = 0;
let ultimoCheckPvpDecaimento = 0;
let ultimoCheckCampeonato = 0;
let ultimaOndaCampeonato = 0;
let ultimoRoloTracker = 0;
/** Trava de reentrada do rolo do Tracker: uma passada lenta não pode disparar a seguinte. */
let roloTrackerRodando = false;

// ---------------------------------------------------------------- constantes
//
// Estes três blocos são DESIGN NOSSO (o jogo original resolve tudo no servidor e nunca
// expõe os números). Ficam juntos e nomeados para serem fáceis de balancear.

const CD_BOLA_MS = 1200; // intervalo mínimo entre dois arremessos
// Intervalo mínimo entre dois golpes do mesmo lutador. Os cooldowns por golpe são os reais
// (2s a 60s); isto só evita despejar cinco golpes no mesmo tick quando vários liberam juntos.
const CD_GLOBAL_JOGADOR = 900;
const CD_GLOBAL_SELVAGEM = 1400;

/**
 * Segundos sem trocar dano numa hunt para poder subir ao Centro Pokémon.
 *
 * É a mesma ideia dos 10 s da arena PvP, com um número muito menor porque o que está em jogo
 * é menor: contra selvagem ninguém perde ELO nem XP, e o único abuso possível é sumir da luta
 * no frame em que o golpe fatal ia sair. Três segundos matam essa saída sem transformar a ida
 * ao Centro numa espera chata — na prática é um golpe de intervalo.
 */
const CENTRO_SAIDA_MS = 3000;

/**
 * Carência depois que o socket cai FORA da Arena PvP: por quanto tempo o jogador continua
 * na memória do sim, com a hunt guardada e a equipe INTACTA, esperando uma reconexão.
 *
 * ### Por que existe
 *
 * O jogo é idle: a proposta é deixar rodando o dia inteiro. Só que toda queda de WebSocket
 * — aba de segundo plano congelada pelo Chrome, notebook que dormiu, NAT que trocou de
 * porta, deploy do sim — chegava aqui como `sair` e, sem carência, disparava
 * `punirAbandonoDaLuta`: a equipe INTEIRA ia a zero (sem consumir Revive, porque o HP é
 * zerado na mão) e o treinador acordava no Centro com −10% de XP. Quem deixava o navegador
 * aberto e saía para trabalhar voltava com o time no chão "do nada".
 *
 * Essa regra faz sentido na Arena PvP — lá existe um oponente do outro lado ganhando a
 * briga, e fechar a aba não pode ser a fuga barata. Numa hunt solo não há ninguém a
 * proteger: a única coisa que a punição fazia era castigar problema de rede.
 *
 * ### Como funciona
 *
 * `sair` fora do PvP não remove nem pune: só marca `p.desconectadoEm`. O jogador congela
 * (o tick para de simular e de enviar, mas ele SEGUE em memória). Uma reconexão dentro da
 * janela cai no caminho transparente de `entrar` ("só reaponta o gateway") e o jogador nem
 * percebe o soluço. Passada a janela sem volta, `finalizarDesconexao` grava e remove — a
 * hunt fica em `huntSlug` e a equipe fica como estava, viva. É uma suspensão, não um
 * nocaute: o próximo login entra no Centro como "visita" (sem cobrança de XP) e a
 * automação de voltar à hunt cura e recoloca o jogador.
 */
const GRACA_DESCONEXAO_MS = 90_000;

/**
 * A espera entre duas trocas de AVATAR (o botão da ficha do treinador).
 *
 * O visual do onboarding vale uma vez e trancava para sempre; a troca posterior existe para
 * quem se arrependeu da cor, não para quem quer um boneco diferente por hora. Um dia inteiro
 * é o que mantém o personagem RECONHECÍVEL na praça do Centro e no chat — se o vizinho
 * pudesse virar outra pessoa a cada dois minutos, o boneco deixaria de identificar alguém.
 *
 * A tela avisa da espera ANTES de confirmar, e o carimbo (`visual_trocado_em`) vai ao banco
 * na hora, fora do write-behind.
 */
const VISUAL_TROCA_MS = 24 * 60 * 60 * 1000;

/**
 * Quanto o sim espera, no Centro, antes de repetir o boss no modo automático.
 *
 * Não é enfeite: é o tempo de a tela mostrar o resultado da luta (o "você venceu", os drops)
 * e de a enfermeira curar. Sem a pausa, o jogador só veria o mapa da arena piscar.
 */
const BOSS_AUTO_ESPERA_MS = 4000;

/**
 * A que altura da vida a automação de +HP dispara.
 *
 * De 10% a 100%, de 10 em 10 — o jogador escolhe no slider. O padrão é 30%, o meio-termo
 * mais próximo do 35% fixo que existia antes de a opção existir.
 */
const LIMIAR_HP_MIN = 0.1;
const LIMIAR_HP_MAX = 1;
const LIMIAR_HP_PADRAO = 0.3;

const limiarValido = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return LIMIAR_HP_PADRAO;
  const pct = Math.round(n * 100);
  if (pct < LIMIAR_HP_MIN * 100 || pct > LIMIAR_HP_MAX * 100) return LIMIAR_HP_PADRAO;
  return Math.round(pct / 10) * 10 / 100;
};

/**
 * Preferência de bolas vinda de fora: só id de bola que EXISTE, sem repetição.
 *
 * O `map(Number)` que estava aqui aceitava o que mandassem — um `NaN` vindo de string, um id
 * inventado, ou uma lista de cem mil entradas. E esta não é uma lista qualquer: `temBolaAuto`
 * e o arremesso a varrem DUAS vezes por tick, e ela mora no `automation`, que o write-behind
 * grava INTEIRO a cada flush. Um cliente adulterado comprava assim CPU e bytes de graça, e o
 * estrago ficava no banco — voltava sozinho no login seguinte.
 *
 * Casar com o catálogo resolve os três de uma vez: são cinco bolas, então o teto vem junto.
 *
 * Fora de um array continua `[1]`, e não `[]`: lista VAZIA quer dizer "qualquer bola" para
 * `preferidasBolaAuto` logo abaixo, então devolver `[]` aqui promoveria um cliente quebrado à
 * melhor bola que ele tivesse, em vez de deixá-lo no padrão de conta nova.
 */
const IDS_DE_BOLA = new Set(bolas.map((b) => b.id));

const idsDeBola = (lista) =>
  Array.isArray(lista)
    ? [...new Set(lista.map(Number).filter((n) => IDS_DE_BOLA.has(n)))]
    : [1];

/** Preferência de bolas da automação — mesma ordem do tick de auto-ball. */
const preferidasBolaAuto = (auto) =>
  auto.ballIds?.length ? auto.ballIds : [BEAST_BALL.id, 4, 3, 2, 1];

const temBolaAuto = (p) => preferidasBolaAuto(p.automation).some((id) => (p.balls[id] ?? 0) > 0);

/** Algum modo de lançar bola automático ligado (inclui o `autoBall` legado). */
const autoBallLigado = (auto) =>
  !!(auto.autoBallAteCapturar || auto.autoBallSemParar || auto.autoBall);

/**
 * Os dois interruptores de bola são excludentes. O `autoBall` antigo vira "sem parar", que era
 * o comportamento de não parar na primeira captura.
 */
function modosBallAuto(m) {
  let ate = !!m.autoBallAteCapturar;
  let sem = !!m.autoBallSemParar;
  const temNovos = m.autoBallAteCapturar !== undefined || m.autoBallSemParar !== undefined;
  if (!temNovos && m.autoBall !== undefined) {
    sem = !!m.autoBall;
    ate = false;
  }
  if (ate) sem = false;
  if (sem) ate = false;
  return { autoBallAteCapturar: ate, autoBallSemParar: sem };
}

/** Desliga os modos de bola quando acabou o estoque das escolhidas. */
function desligarAutoBallSeEsgotou(p) {
  if (temBolaAuto(p)) return;
  if (!p.automation.autoBallAteCapturar && !p.automation.autoBallSemParar) return;
  p.automation.autoBallAteCapturar = false;
  p.automation.autoBallSemParar = false;
  marcarSujo(p);
}

/** Lista de ids de item vinda do cliente: só números, sem repetição, no máximo 12. */
const idsDeItem = (lista) =>
  Array.isArray(lista)
    ? [...new Set(lista.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 12)
    : [];

/** Os três starters que o treinador escolhe no primeiro login. */
const STARTERS = [1, 4, 7]; // Bulbasaur, Charmander, Squirtle

/** Tamanho da equipe. Quem for capturado com a equipe cheia cai direto no depot. */
const MAX_EQUIPE = 5;

/** Append-only de gameplay para a auditoria admin (ver `audit-db.mjs`). */
function auditar(p, categoria, acao, detalhe, ref = null) {
  registrarAcaoJogador({ playerId: p.dbId, nick: p.nick, categoria, acao, detalhe, ref });
}

/**
 * Um sinal de automação (ver `telemetria-bot.mjs`): uma linha `suspeita` na auditoria do jogador e
 * uma no log. Não muda nada no jogo — o que fazer com isso é decisão da moderação.
 */
function sinalizarSuspeita(p, sinal) {
  if (!sinal) return;
  auditar(p, 'suspeita', sinal.acao, sinal.detalhe);
  console.warn(`[suspeita] ${p.nick} · ${sinal.acao} · ${sinal.detalhe}`);
}

/**
 * Manda ao jogador o aviso que veio dentro de um erro do mercado.
 *
 * A maioria dos erros de `market-db` é frase pronta em português e chega assim na tela. Os
 * novos são CHAVE de i18n com buracos (`market.travaItemEspera` tem os minutos que faltam), e
 * é o `params` que o cliente usa para preencher — sem ele o jogador leria "{min}".
 */
function avisoDeErro(p, err) {
  evento(p, { k: 'aviso', msg: err.message, params: err.params ?? null });
}

function auditarMarketAnunciado(p, a, descricao, preco, moeda, taxa) {
  auditar(
    p,
    'market',
    'anunciado',
    `${descricao} · ${preco.toLocaleString('pt-BR')} ${moeda}${taxa ? ` · taxa ${taxa.toLocaleString('pt-BR')}` : ''}`,
    a?.id != null ? `anuncio:${a.id}` : null,
  );
}

function auditarMarketCancelado(p, a, id) {
  const destino = a.tipo === 'pokemon' ? 'depot' : a.ficha?.bola ? 'bolsa (bolas)' : 'bolsa';
  auditar(
    p,
    'market',
    'cancelado',
    `${a.ficha?.nome ?? 'anúncio'} (${a.tipo}) → ${destino}`,
    `anuncio:${id}`,
  );
}

/** Quanto do `npcPrice`/`sellValue` o NPC paga na venda. */
const FATOR_VENDA = 1;

/** Chance de shiny por captura bem-sucedida — igual para todas as espécies com forma shiny. */
const CHANCE_SHINY = 1 / 24000;

/**
 * BANCADA DE TESTE DO SHINY — uma espécie, um mapa, chance absurda.
 *
 * O shiny real rola só na captura (1/24.000), o que torna o caminho inteiro (captura → arte
 * brilhante → sprite em campo) impossível de conferir à mão. Aqui a hunt do Oddish — que só
 * spawna Oddish e é nível 1 — vira uma bancada: metade das capturas sai shiny, e só ali.
 * Nenhuma outra hunt e nenhuma outra espécie mudam de chance.
 *
 * `SHINY_TESTE=0` no ambiente desliga sem mexer no código. **Tirar daqui antes de abrir ao
 * público**: 50% numa hunt de nível 1 é uma fábrica de shiny, e o Oddish do Mercado deixaria
 * de valer o que vale.
 */
const SHINY_TESTE = process.env.SHINY_TESTE === '0'
  ? null
  : { hunt: 'oddish', pokeId: 43, chance: 0.5 };

/**
 * Sorteia shiny na captura bem-sucedida.
 *
 * O Shiny Secret Lure (`multShiny`, chave `shiny` nos boosts) dobra a chance — 1/12.000 em
 * vez de 1/24.000 — no mesmo instante em que rolam qualidade, IV e potência.
 */
function rolarShinyCaptura(p, especie) {
  const hunt = p?.huntSlug ? huntJogavelPorSlug.get(p.huntSlug) : null;
  const ltShiny = looktypeShiny(especie.pokeId);
  if (!ltShiny) return false;
  // Outland: variantes de boss — shiny só nas hunts de temporada, não na área endgame.
  if (hunt?.area === 'outland') return false;
  const multS = multShiny(p, agora());
  const naBancada = SHINY_TESTE
    && especie.pokeId === SHINY_TESTE.pokeId
    && p?.huntSlug === SHINY_TESTE.hunt;
  if (naBancada) return Math.random() < SHINY_TESTE.chance;
  return Math.random() < CHANCE_SHINY * multS;
}

/**
 * Chance de captura por arremesso.
 *
 * A raridade sai do `priceNpc` da espécie, mas em escala LOG: os preços vão de 80 a 6,5
 * bilhões, então qualquer divisor linear faz tudo acima de raro virar 0%.
 *
 *   raridade = log10(max(100, priceNpc)) − 1          → 1,00 (Pidgey) a 8,81
 *   fator    = 1 + raridade³ / CAPTURA_RARIDADE_DIV
 *   chance   = BASE_CAPTURA × (catchRate / fator) × (1,4 − hpFrac),  limitado ao piso e ao teto
 *
 * ### O balanceamento, e por que ele mudou duas vezes
 *
 * A base já foi **0,6** — um Pidgey saía a ~58% por arremesso, e com a auto-ball ligada
 * capturava em duas bolas. Caiu para **0,15**, e ainda assim ficou fácil demais: um Bulbasaur
 * dava 17% com a Beast Ball num corpo caído, ou seja, seis derrotas por captura para uma
 * espécie que devia ser conquista.
 *
 * Hoje o alvo é explícito, medido com a MELHOR bola (Beast, 2× Ultra) num corpo no chão:
 *
 *   · a espécie mais fácil do catálogo (raridade 1: Pidgey, Caterpie, Rattata)  →  ~8%
 *   · a espécie MEDIANA (raridade 3,04)                                         →  ~3%
 *   · daí para cima cai rápido, até o piso
 *
 * Dois botões chegam nesse par, e são os dois desta seção. `BASE_CAPTURA` reescala tudo de
 * uma vez; `CAPTURA_RARIDADE_DIV` decide a DISTÂNCIA entre o fácil e o raro — quanto maior,
 * mais plana a curva. O divisor era 3 e a razão fácil:mediano dava 4,5×; com 17 ela fecha em
 * 2,5×, que é o que os dois alvos acima pedem. Foi ele que mudou o joelho da curva: as
 * espécies caras ficaram bem mais difíceis do que a queda geral sozinha faria.
 *
 * Lembre que é **uma tentativa por corpo** (ver `arremessarBola`): a chance por arremesso é a
 * chance por ENCONTRO. 2% são 50 derrotas, não 50 bolas no mesmo bicho.
 */
const BASE_CAPTURA = 0.0075;

/** O quanto a raridade pesa. Maior = curva mais plana entre o comum e o raro. */
const CAPTURA_RARIDADE_DIV = 17;

/**
 * Piso e teto da chance por arremesso. Publicados no `welcome` junto com a base.
 *
 * O PISO é uma misericórdia: sem ele as espécies do topo da tabela de preço ficariam em
 * frações de por mil e seriam inalcançáveis na prática. O TETO agora vale de verdade — a
 * chance mais alta que a fórmula produz é ~5%, e é o Capture Boost (que dobra) que encosta
 * nele.
 */
const CAPTURA_PISO = 0.003;
const CAPTURA_TETO = 0.1;

/**
 * O preço que decide a raridade de quem NÃO TEM preço.
 *
 * `priceNpc = 0` no catálogo não quer dizer "de graça" — quer dizer **não está à venda**, e é
 * assim que estão marcadas as 13 espécies sem preço: os onze lendários (Articuno, Zapdos,
 * Moltres, Mewtwo, Mew, Raikou, Entei, Suicune, Lugia, Ho-oh, Celebi), o Ditto e o Unown.
 *
 * Como a raridade sai do preço, o `max(100, 0)` da fórmula as jogava na faixa MAIS FÁCIL da
 * tabela — e com o rebalanceamento isso ficou gritante: a Pokédex passaria a anunciar o
 * Mewtwo empatado com o Pidgey como a captura mais provável do jogo.
 *
 * Sem preço, a leitura certa é a oposta: elas valem o máximo do catálogo. Nenhuma das 13 tem
 * spawn em hunt nenhuma hoje, então isto não muda uma partida — muda o que a ficha promete a
 * quem for ler antes de sair procurando.
 */
const PRECO_MAIS_RARO = Math.max(
  100,
  ...[...especies.values()].map((e) => valorEconomicoDe(e)),
);
const precoDeRaridade = (especie) => (especie ? valorEconomicoDe(especie) : PRECO_MAIS_RARO);

function chanceCaptura(especie, bola, hpFrac) {
  if (bola.catchRate >= 255) return 1;
  const raridade = Math.log10(Math.max(100, precoDeRaridade(especie))) - 1;
  const fator = 1 + raridade ** 3 / CAPTURA_RARIDADE_DIV;
  return Math.max(CAPTURA_PISO, Math.min(CAPTURA_TETO, BASE_CAPTURA * (bola.catchRate / fator) * (1.4 - hpFrac)));
}

// ------------------------------------------------------------------ helpers

const agora = () => Date.now();

/**
 * Um instante gravado na conta (a última troca de casa ou de bicicleta), conferido na carga: só
 * número de verdade, positivo e que não esteja no futuro. Lixo no jsonb vira 0 — "nunca trocou".
 */
const instanteGravado = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= agora() ? v : 0);

/** "4min 05s", "32s" — o que falta de um intervalo, para o aviso da tela. */
function tempoDeEspera(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}min ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/**
 * Serializa compras/vendas que debitam ouro em memória — evita TOCTOU com duas abas abertas.
 *
 * `fn` TEM de devolver a promessa do que ela faz. Um corpo em bloco que só dispara um
 * `(async () => {…})()` sem `return` devolve `undefined`, a fila resolve na hora e a
 * serialização vira enfeite: a operação seguinte entra enquanto a anterior ainda está no
 * `await` do banco, que é exatamente a corrida que esta fila existe para fechar.
 */
const filasEconomia = new Map();

function enfileirarEconomia(p, fn) {
  const id = p.key;
  const anterior = filasEconomia.get(id) ?? Promise.resolve();
  const proximo = anterior
    .then(() => Promise.resolve(fn(p)))
    .catch((err) => {
      console.error('[sim] economia:', err.message);
    });
  filasEconomia.set(id, proximo);
  proximo.finally(() => {
    if (filasEconomia.get(id) === proximo) filasEconomia.delete(id);
  });
}

function montarPokemon(row) {
  const esp = especies.get(row.species_id ?? row.speciesId);
  const ivs = typeof row.ivs === 'string' ? JSON.parse(row.ivs) : row.ivs;
  const nivel = row.level;
  // `|| 1`, e não `??`: uma linha ainda não alcançada pelo backfill vem com 0, que não é uma
  // potência válida e daria multiplicador 1 por acidente em vez de por regra.
  const potencia = Number(row.potencia) || 1;
  // O "+N" comprado com pedras entra nos stats de combate, no ⚔ e na nota N= (bases + refino).
  const refino = normalizarRefino(row.bonus_base ?? row.refino);
  const stats = calcularStats(esp, ivs, nivel, row.quality, multDeNascenca(potencia, row.shiny), refino);
  const maxHp = hpDeCombate(stats.hp);
  const fichaNasc = { ivs, quality: row.quality, potencia, shiny: row.shiny };
  return {
    id: Number(row.id),
    speciesId: esp.pokeId,
    nome: esp.name,
    looktype: esp.looktype,
    // A arte da forma shiny, quando a espécie tem uma. Fica SEPARADA do `looktype` de
    // propósito: o atlas de retratos do mapa é indexado pelo looktype comum e não conhece as
    // formas shiny, então quem desenha escolhe qual dos dois usa.
    lookShiny: row.shiny ? looktypeShiny(esp.pokeId) : null,
    tipos: [esp.type1, esp.type2].filter(Boolean),
    level: nivel,
    xp: Number(row.xp),
    quality: row.quality,
    potencia,
    ivs,
    shiny: row.shiny,
    slot: row.slot,
    refino,
    refinoTotal: totalDoRefino(refino),
    stats,
    maxHp,
    // `??`, não `||`: um pokémon gravado com 0 de HP está DESMAIADO, e `0 || maxHp` o
    // levantava de vida cheia no login seguinte. Era um revive de graça a cada relog — e,
    // agora que fechar a aba no meio da luta derruba o time, seria a saída para não pagar nada.
    hp: Math.min(row.hp ?? maxHp, maxHp),
    poder: poderDePokemon({ ...fichaNasc, refino, level: nivel }, esp),
    nota: notaDePokemon({ ...fichaNasc, refino, ivs }, esp),
    tmElemental: row.tm_elemental ?? row.tmElemental ?? null,
    tmAoe: !!(row.tm_aoe ?? row.tmAoe),
    heldItemId: row.held_item_id != null ? Number(row.held_item_id) : null,
    starter: !!(row.starter),
    caughtAt: row.caught_at ? new Date(row.caught_at).getTime() : null,
  };
}

function recalcular(pk) {
  const esp = especies.get(pk.speciesId);
  pk.refino = normalizarRefino(pk.refino);
  pk.refinoTotal = totalDoRefino(pk.refino);
  pk.stats = calcularStats(esp, pk.ivs, pk.level, pk.quality, multDeNascenca(pk.potencia, pk.shiny), pk.refino);
  pk.maxHp = hpDeCombate(pk.stats.hp);
  pk.poder = poderDePokemon(pk, esp);
  pk.nota = notaDePokemon(pk, esp);
  if (pk.hp > pk.maxHp) pk.hp = pk.maxHp;
}

function empacotarFichaResposta(pk, dono) {
  return {
    id: pk.id,
    speciesId: pk.speciesId,
    nome: pk.nome,
    looktype: pk.looktype,
    lookShiny: pk.lookShiny,
    tipos: pk.tipos,
    level: pk.level,
    xp: pk.xp,
    quality: pk.quality,
    potencia: pk.potencia,
    ivs: pk.ivs,
    refino: pk.refino ?? null,
    refinoTotal: pk.refinoTotal ?? totalDoRefino(pk.refino),
    stats: pk.stats,
    maxHp: pk.maxHp,
    hp: pk.hp,
    shiny: pk.shiny,
    poder: pk.poder,
    nota: pk.nota ?? notaDePokemon(pk),
    tmElemental: pk.tmElemental,
    tmAoe: pk.tmAoe,
    heldItemId: pk.heldItemId ?? null,
    caughtAt: pk.caughtAt ?? null,
    dono,
  };
}

const ativo = (p) => p.pokemons.get(p.activeId) ?? null;

/** Treinador pode usar pokémon até 5 níveis acima — starter ignora a regra. */
const podeUsarPokemon = (p, pk) => podeUsarPokemonPorNivel(p.level, pk);

const msgPokemonRecusaNivel = (pk, p) =>
  `${pk.nome} é nv ${pk.level} — você precisa ser pelo menos nv ${nivelMinimoTreinador(pk.level)} para usá-lo (seu nv ${p.level})`;

const primeiroDaEquipeUtilizavel = (p, extra = () => true) =>
  [...p.pokemons.values()].find((k) => k.slot != null && podeUsarPokemon(p, k) && extra(k));

const escolherAtivoUtilizavel = (p) => {
  const atual = p.activeId ? p.pokemons.get(p.activeId) : null;
  if (atual && podeUsarPokemon(p, atual)) return atual.id;
  return primeiroDaEquipeUtilizavel(p)?.id ?? null;
};

/** Coloca um pokémon da equipe em campo — o mesmo efeito de `team.active`. */
function ativarPokemon(p, pk) {
  if (!pk || pk.slot == null) return false;
  if (!podeUsarPokemon(p, pk)) {
    evento(p, { k: 'aviso', msg: msgPokemonRecusaNivel(pk, p) });
    return false;
  }
  if (pk.id === p.activeId) return true;
  const t = agora();
  if (p.pvp) {
    const r = trocarPokemonNaArena(p, pk, t);
    if (!r.ok) {
      if (r.msg) evento(p, { k: 'aviso', msg: r.msg });
      return false;
    }
  }
  p.activeId = pk.id;
  p.proxAtaqueJogador = t + 300;
  // Na praça é o pokémon de batalha que anda atrás do dono; na hunt é quem a cena segue.
  if (!p.pvp) atualizarPokemonDoCentro(p, pk, t);
  marcarSujo(p);
  return true;
}

// ------------------------------------------------------------------ VITRINE
//
// Quantos pokémon cabem na vitrine da Ficha do Treinador. Seis, e não os cinco da equipe: a
// vitrine não é a escalação — é o que o jogador ESCOLHE mostrar, e pode ser o shiny que ele
// nunca leva para a hunt. Seis é o tamanho de time da série, e fecha a grade em 3×2 no
// celular e numa fileira só no desktop.
//
// Precisa bater com `MAX_VITRINE` no cliente (app.js), do mesmo jeito que `MAX_EQUIPE`. Quem
// manda é este arquivo: o cliente só desenha, e o servidor corta o que passar disso.
const MAX_VITRINE = 6;

/** Ids da vitrine, saneados: números positivos, sem repetição, no máximo `MAX_VITRINE`. */
function normalizarIdsVitrine(cru) {
  let bruto = cru;
  if (typeof cru === 'string') {
    try {
      bruto = JSON.parse(cru || '[]');
    } catch {
      return [];
    }
  }
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set();
  const ids = [];
  for (const v of bruto) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || vistos.has(n)) continue;
    vistos.add(n);
    ids.push(n);
    if (ids.length >= MAX_VITRINE) break;
  }
  return ids;
}

/**
 * A vitrine que o jogador tem AGORA — só os ids que ainda são dele.
 *
 * A limpeza é na LEITURA, e não na venda: um pokémon sai da conta por seis caminhos (venda ao
 * NPC, anúncio no Mercado, evolução, release…) e caçar todos eles para mexer numa lista de
 * seis ids seria seis lugares para esquecer um. Aqui o id órfão simplesmente não existe.
 */
function vitrineDoJogador(p) {
  return (p.vitrine ?? []).filter((id) => p.pokemons.has(id));
}

// ------------------------------------------------------------------ XP SHARE
//
// O que a Casa faz. Quatro regras mandam em tudo aqui, e todas foram escolhas explícitas:
//
//   1. **Não cria XP, reparte.** O registrado leva uma FATIA do que o pokémon de batalha
//      acabou de ganhar — 25% na Casa Comum, 100% na Mítica/Lendária. Sem hunt rodando não há nada
//      para repartir, e é isso que impede a casa de virar farm de jogo fechado.
//   2. **Só a EQUIPE.** O pokémon tem de estar num dos cinco lugares. Deixar o Depot entrar
//      transformaria a casa num acelerador de coleção — quem tem duzentos bichos parados
//      escolheria o melhor deles sem nunca pô-lo em campo.
//   3. **O de batalha não recebe.** Ele já leva o XP inteiro; somar a fatia por cima seria um
//      bônus de XP disfarçado, e a escolha ("qual dos outros quatro eu quero subir?") sumiria.
//   4. **Sobrevive ao logout.** Isto é uma ESCALAÇÃO, não um farm — o mesmo tipo de ajuste que
//      a automação — e obrigar a refazê-la a cada login seria atrito puro. Mora na coluna
//      `players.xp_share`, e o que ela guarda é só a lista de ids de cada casa.
//   5. **Um pokémon, um posto.** Todas as casas repartem ao mesmo tempo, cada uma com a sua
//      fatia; o mesmo bicho em duas casas somaria as fatias, e é a única brecha que a multiplicação
//      de casas abre. A trava mora em `xpshare.escolher` (e, por segurança, em `limparXpShare`).

/**
 * Os postos da casa em que o jogador ESTÁ, no MENOR pacote possível — é o que os botões em cima
 * dos bonecos desenham. Fora de casa, `null`: os postos de TODAS as casas viajam em `casa.lista`.
 *
 * Só `pokemonId` por posto — nome, looktype, nível e shiny NÃO vão aqui, mesmo a tela
 * precisando deles: o snapshot sai até 2×/s por jogador, e `estado.eu.pokemons` chega no mesmo
 * pacote, onde um lookup por id resolve tudo de graça.
 *
 * `pct` fica porque é a única coisa aqui que o cliente não deriva sozinho sem repetir a tabela
 * de raridades, e é um número curto.
 */
function xpShareParaCliente(p) {
  const casa = p.casa ? casaAtivaPorId(p, p.casa.casaId) : null;
  if (!casa) return null;
  const slots = postosDaCasa(p, casa).map((id, s) => {
    const pk = id ? p.pokemons.get(id) : null;
    return { s, id: pk && pk.slot != null ? pk.id : null };
  });
  return { casaId: casa.id, slots, pct: xpShareDaRaridade(casa.raridade) };
}

/** Os registrados da casa ABERTA, no formato que `casa-sala.mjs` desenha ao lado dos bonecos. */
function registradosParaSala(p) {
  const casa = p.casa ? casaAtivaPorId(p, p.casa.casaId) : null;
  if (!casa) return [];
  // O rótulo que a cena pendura no boneco: a fatia, em pontos percentuais.
  const pctShare = Math.round(xpShareDaRaridade(casa.raridade) * 100);
  const out = [];
  postosDaCasa(p, casa).forEach((id, slot) => {
    const pk = id ? p.pokemons.get(id) : null;
    if (!pk || pk.slot == null) return;
    out.push({
      slot,
      pokemonId: pk.id,
      nome: pk.nome,
      looktype: pk.looktype,
      lookShiny: pk.lookShiny ?? null,
      level: pk.level,
      shiny: !!pk.shiny,
      pctShare,
    });
  });
  return out;
}

/**
 * Esvazia os postos de UMA casa — o que o anúncio no Mercado faz. Devolve os postos como
 * estavam (`[pokemonId|null, …]`), para o estorno de um anúncio que falhou poder repô-los.
 */
function pararXpShareDaCasa(p, casa) {
  const antes = postosDaCasa(p, casa);
  if (!soltarPostosDaCasa(p, casa.id).length) return antes;
  if (p.casa?.casaId === casa.id) sincronizarTreinos(p.casa, [], agora());
  marcarSujo(p);
  return antes;
}

/**
 * Tira dos postos quem não pode mais estar neles.
 *
 * Um id vira inválido por caminhos que não passam por aqui: o pokémon foi para o Depot, foi
 * vendido, foi anunciado no Mercado (some da memória, ver `market.criar`), ou a casa foi
 * anunciada ou vendida. Em vez de pendurar um gancho em cada um desses lugares, a validade é
 * conferida no ponto onde ela IMPORTA: na hora de creditar e na hora de montar o pacote. Devolve
 * `true` quando limpou algo, para quem chama marcar sujo. A regra inteira mora em `limparXpShare`.
 */
function limparXpShareInvalido(p) {
  return limparXpShare(p, (id) => {
    const pk = p.pokemons.get(id);
    return !!pk && pk.slot != null;
  });
}

/**
 * Credita a fatia do XP Share. Chamada de dentro de `ganharXp`, uma vez por abate.
 *
 * `xpDoAtivo` já vem com os multiplicadores aplicados (VIP, boost, guild, evento): a promessa
 * é "uma fatia do que o seu pokémon ganhou", e ela tem de bater com o número que o jogador
 * acabou de ver subir na barra do outro. Aplicar os multiplicadores de novo aqui os elevaria
 * ao quadrado no registrado.
 *
 * O piso de 1 XP existe para a Casa Comum em hunt de nível baixo, onde 25% ainda pode arredondar
 * — um posto ocupado que credita nada faria a casa parecer quebrada. Ele NÃO vale para quem
 * não tem casa: sem raridade o fator é 0 e a função sai antes.
 */
function creditarXpShare(p, ativoPk, xpDoAtivo) {
  if (xpDoAtivo <= 0) return;
  // A lista vem pronta do cache (`recebedoresXpShare`): o abate custa o número de REGISTRADOS —
  // no máximo a equipe —, e não o número de casas que o jogador juntou.
  const lista = recebedoresXpShare(p);
  if (!lista.length) return;
  let sujo = false;

  for (const r of lista) {
    const pk = p.pokemons.get(r.pkId);
    // Saiu da equipe (Depot, venda, vitrine): o posto se esvazia sozinho aqui.
    if (!pk || pk.slot == null) {
      const ids = p.xpShare?.porCasa?.[r.casaId];
      if (ids) ids[r.slot] = null;
      sujo = true;
      continue;
    }
    // O de batalha já levou o XP inteiro — ver a regra 3 no topo da seção.
    if (ativoPk && pk.id === ativoPk.id) continue;

    const ganho = Math.max(1, Math.round(xpDoAtivo * r.fator));
    const antes = pk.level;
    pk.xp += ganho;
    const nv = nivelPeloXp(pk.xp);
    if (nv !== antes) {
      pk.level = nv;
      recalcular(pk);
      pk.hp = pk.maxHp;
      evento(p, { k: 'levelup', quem: 'pokemon', id: pk.id, level: nv });
      if (p.casa?.casaId === r.casaId) sincronizarTreinos(p.casa, registradosParaSala(p), agora());
    }
    evento(p, { k: 'xpshare', casaId: r.casaId, slot: r.slot, id: pk.id, xp: ganho, pct: Math.round(r.fator * 100) });
    marcarSujo(p, pk);
  }

  if (sujo) {
    mexeuNoXpShare(p);
    marcarSujo(p);
  }
}

/** Registrado num posto de XP Share de QUALQUER casa. */
function pokemonNoPostoCasa(p, pkId) {
  return postoDoPokemon(p, pkId) != null;
}

/**
 * Confere, NO LOGIN, que o jogador não tem mais Exp. Share do que comprou — e corta o excedente.
 *
 * Por que no login, e não numa varredura periódica: a duplicação da Exp. Share nasce de as duas
 * metades dela (`players.items` e `player_pokemon.held_item_id`) serem gravadas em momentos
 * diferentes, e ela só VIRA duas unidades quando alguém relê as duas do banco — ou seja, num
 * carregamento. Este é literalmente o instante em que a cópia passa a existir. Conferir aqui
 * pega a falha no primeiro momento em que ela é observável, antes de o jogador ver o item.
 *
 * E é de graça. As duas pontas já estão na mão: `p.items` acabou de ser lido da linha e
 * `p.pokemons` acabou de ser montado. O direito veio na MESMA linha (`xp_share_total`). Zero
 * consulta a mais, uma passada pelos pokémon do jogador, uma vez por login. Uma varredura de
 * 15 em 15 minutos custaria um seq scan de `player_pokemon` (126 MB, ~7.000 buffers medidos em
 * produção) 96 vezes por dia para achar, quase sempre, nada — e ainda assim só depois de o
 * jogador já ter visto o item duplicado.
 *
 * Só corta para BAIXO. Ter menos do que comprou é o outro lado da mesma falha (o item sumiu) e
 * devolver sozinho seria criar item por conta própria — isso fica para a ferramenta e para o
 * olho humano (`tools/auditar-exp-share.mjs`).
 */
function conferirXpShareHeld(p) {
  const bolsa = Number(p.items?.[XP_SHARE_HELD_ID] ?? 0);
  const equipados = [];
  for (const pk of p.pokemons.values()) {
    if (ehXpShareHeldItem(pk.heldItemId)) equipados.push({ id: pk.id, level: pk.level, nome: pk.nome });
  }

  const direito = Number(p.xpShareTotal) || 0;
  const plano = planoDeCorteXpShare({ bolsa, equipados, direito });
  if (!plano.excedente) return; // o caminho de praticamente todo login

  // `direito = 0` com item na mão quer dizer UMA de duas coisas, e elas pedem tratamentos
  // opostos: ou o jogador duplicou sem nunca ter comprado, ou a coluna não foi preenchida para
  // ele (backfill que não alcançou a conta, restore pela metade). Zero é "não sei", não é "não
  // comprou" — e apagar item pago por causa de um "não sei" é o erro que não tem volta. Fica
  // registrado e vai para o olho humano em `tools/auditar-exp-share.mjs`, que cruza a coluna
  // com o ledger antes de deixar cortar.
  if (direito <= 0) {
    console.warn(`[xpshare] ${p.nick}: ${bolsa + equipados.length} unidade(s) com xp_share_total=0 — NÃO cortado, confira à mão`);
    auditar(
      p, 'item', 'xpshare_suspeita',
      `Exp. Share sem direito registrado: ${bolsa + equipados.length} unidade(s), xp_share_total = 0. `
      + 'Nada foi removido — conferir contra o ledger da Loja.',
      `item:${XP_SHARE_HELD_ID}`,
    );
    return;
  }

  const feito = [];
  if (plano.daBolsa > 0) {
    const sobra = bolsa - plano.daBolsa;
    if (sobra > 0) p.items[XP_SHARE_HELD_ID] = sobra;
    else delete p.items[XP_SHARE_HELD_ID];
    feito.push(`${plano.daBolsa} da bolsa`);
  }
  for (const alvo of plano.desequipar) {
    const pk = p.pokemons.get(alvo.id);
    if (!pk) continue;
    pk.heldItemId = null;
    marcarSujo(p, pk);
  }
  if (plano.desequipar.length) {
    feito.push(`${plano.desequipar.length} de ${plano.desequipar.map((k) => `${k.nome} Nv ${k.level}`).join(', ')}`);
  }
  marcarSujo(p);

  auditar(
    p, 'item', 'xpshare_dup',
    `Exp. Share além do comprado: tinha ${bolsa + equipados.length}, direito a ${direito}. `
    + `Removida(s) ${plano.excedente} — ${feito.join(' + ')}.`,
    `item:${XP_SHARE_HELD_ID}`,
  );
  console.warn(`[xpshare] ${p.nick}: ${bolsa + equipados.length} unidades para ${direito} comprada(s) — cortadas ${plano.excedente}`);
  evento(p, { k: 'aviso', msg: 'xpshareheld.duplicataRemovida' });
}

/** XP Share held: 5% do XP de batalha para cada pokémon que segura o item (equipe ou depot). */
function creditarHeldXpShare(p, ativoPk, xpDoAtivo) {
  if (xpDoAtivo <= 0) return;
  const ganho = Math.round(xpDoAtivo * XP_SHARE_HELD_PCT);
  if (ganho <= 0) return;
  const pct = Math.round(XP_SHARE_HELD_PCT * 100);
  for (const pk of p.pokemons.values()) {
    if (!ehXpShareHeldItem(pk.heldItemId)) continue;
    if (ativoPk && pk.id === ativoPk.id) continue;
    const antes = pk.level;
    pk.xp += ganho;
    const nv = nivelPeloXp(pk.xp);
    if (nv !== antes) {
      pk.level = nv;
      recalcular(pk);
      pk.hp = pk.maxHp;
      evento(p, { k: 'levelup', quem: 'pokemon', id: pk.id, level: nv });
      if (p.casa) sincronizarTreinos(p.casa, registradosParaSala(p), agora());
    }
    evento(p, { k: 'xpshareheld', id: pk.id, xp: ganho, pct });
    marcarSujo(p, pk);
  }
}

/**
 * Um pokémon como a tela o vê.
 *
 * Saiu de dentro do `snapshot` para poder ser serializado UM A UM: é assim que o delta de
 * estado descobre quais mudaram sem ter de comparar o array inteiro (ver `estadoParaEnviar`).
 * O formato é exatamente o de antes — o cliente não sabe que isto virou função.
 */
function pokemonParaCliente(k) {
  return {
    id: k.id,
    speciesId: k.speciesId,
    nome: k.nome,
    looktype: k.looktype,
    lookShiny: k.lookShiny,
    tipos: k.tipos,
    level: k.level,
    xp: k.xp,
    xpNivel: xpTotalParaNivel(k.level),
    xpProximo: xpTotalParaNivel(k.level + 1),
    quality: k.quality,
    potencia: k.potencia,
    shiny: k.shiny,
    slot: k.slot,
    hp: k.hp,
    maxHp: k.maxHp,
    poder: k.poder,
    nota: k.nota,
    stats: k.stats,
    ivs: k.ivs,
    refino: k.refino ?? null,
    refinoTotal: k.refinoTotal ?? 0,
    tmElemental: k.tmElemental ?? null,
    tmAoe: !!k.tmAoe,
    heldItemId: k.heldItemId ?? null,
    starter: !!k.starter,
    caughtAt: k.caughtAt ?? null,
    // O piso do botão "Reduzir o nível" da ficha — o "Nível ao capturar" da espécie. Vai do
    // SERVIDOR e não é calculado na tela: o cliente monta o catálogo dele por conta própria
    // (`carregarCatalogoEspecies`) e não aplica o degrau das hunts legadas, então o `huntLevel`
    // dos sete bichos de `hunts-sinnoh.json` (Blissey, Ditto, Porygon…) diverge do daqui.
    pisoNivel: pisoDeReducaoDaEspecie(especies.get(k.speciesId)),
  };
}

/**
 * O estado do jogador para a tela.
 *
 * `comPokemons: false` devolve tudo MENOS o array de pokémon — é o que o delta usa, porque a
 * coleção é 99,4% do pacote e viaja por outro caminho. Com o padrão `true` o retorno é
 * idêntico ao de sempre (o `welcome` e a reconexão continuam levando o quadro inteiro).
 */
function snapshot(p, { comPokemons = true } = {}) {
  const t = agora();
  if (reverterOutfitVipExpirado(p, t)) marcarSujo(p);
  // Postos com id morto (foi ao Depot, foi vendido, foi para a vitrine, ou a casa encolheu)
  // se esvaziam aqui. Fica no snapshot porque é o ÚNICO caminho por onde todo jogador passa
  // regularmente — e porque a tela precisa ver o posto vazio na mesma leva do resto.
  if (limparXpShareInvalido(p)) marcarSujo(p);
  return {
    id: p.dbId,
    nick: p.nick,
    level: p.level,
    xp: p.xp,
    xpNivel: xpTotalParaNivel(p.level),
    xpProximo: xpTotalParaNivel(p.level + 1),
    gold: p.gold,
    diamonds: p.diamonds,
    // Total comprado (PIX/cartão pago) — vai no snapshot para o modal beta abrir sem round-trip.
    diamantesComprados: p.diamantesComprados ?? 0,
    orbs: p.orbs,
    huntSlug: p.huntSlug,
    // Qual Outland está escolhida. A tela precisa dela até FORA da Outland: é o que
    // deixa o seletor do Mapa marcado ao abrir, sem uma ida ao servidor só para perguntar.
    outlandTier: p.outlandTier ?? OUTLAND_TIER_PADRAO,
    tutorialVisto: p.tutorialVisto,
    discordPopCampanha: p.discordPopCampanha ?? 0,
    avisoVisto: p.avisoVisto ?? 0,
    noCentro: p.noCentro,
    // por que ele está no Centro: morte (time no chão), visita (veio a pé) ou curado
    centroMotivo: p.centroMotivo ?? null,
    // A praça: qual SALA, das que se abrem quando há gente demais para uma só. Vai para a tela
    // porque dois amigos em salas diferentes não se veem, e sem o número isso parece bug. O
    // "quantos estão aqui" o cliente conta sozinho, pelos bonecos da cena — assim o número
    // anda em tempo real em vez de esperar o snapshot seguinte.
    centro: p.centro ? { sala: salaDe(p)?.id ?? 0, capacidade: CAPACIDADE_SALA } : null,
    // Quando o botão "Ir para o Centro Pokémon" volta a funcionar numa hunt. Vai o CARIMBO, e
    // não os segundos que faltam: a tela conta sozinha a 60 fps com um pacote só, do mesmo
    // jeito que o botão de sair da arena PvP.
    centroLivreEm: centroLivreInstantaneoNaHunt(p) ? t : p.emCombateAte + CENTRO_SAIDA_MS,
    ondaSeq: p.campo?.ondaSeq ?? 0,
    combateOndaSeq: p.combateOndaSeq ?? 0,
    // ------------------------------------------------------------------ Casa
    // O que a tela precisa para desenhar o modal da Casa. Vai no snapshot (e não numa rota)
    // porque muda com o inventário: anunciar a casa no Mercado tem de tirar os postos dela da
    // tela na mesma hora em que o anúncio aconteceu.
    casa: {
      // Todas as casas, a mais rara primeiro. `id` é o NÚMERO no servidor; `postos` são os ids
      // dos pokémon em cada boneco (vazio na anunciada, que está em escrow). `null` enquanto as
      // casas não chegaram do banco — o meio segundo do login.
      //
      // O custo cresce com o número de casas (~70 bytes cada), e é a única parte da Casa que
      // cresce: quem junta 50 casas manda ~3,5 kB a mais no quadro cheio, e o delta só o reenvia
      // quando algo nele muda.
      lista: p.casas
        ? (() => {
          const emUso = new Set(casasAtivas(p).map((c) => c.id));
          return ordenarCasas(p.casas).map((c) => ({
            id: c.id,
            rar: c.raridade,
            anunciada: c.anunciada,
            // Em uso = reparte XP. A guardada continua na mão, só sem posto valendo.
            emUso: emUso.has(c.id),
            criadaEm: c.criadaEm,
            postos: emUso.has(c.id) ? postosDaCasa(p, c) : [],
          }));
        })()
        : null,
      // O teto de casas em uso — a tela escreve "3/5" e trava o "Pôr em uso" na quinta.
      maxEmUso: MAX_CASAS_EM_USO,
      // o número da casa em que ele está agora (null = em nenhuma)
      dentro: p.casa?.casaId ?? null,
    },
    // Quem está registrado nos postos, e a fatia da casa. Ver a seção XP SHARE.
    xpShare: xpShareParaCliente(p),
    // A BICICLETA: quantas de cada raridade estão na bolsa e qual está EQUIPADA (a única que
    // vale). No snapshot pelo mesmo motivo da casa — anunciar a equipada no Mercado tem de
    // tirar o selo "Equipada" da bolsa na mesma hora.
    bicicleta: {
      tenho: bicicletasDoJogador(p),
      // Uma por bicicleta, com o NÚMERO — a mais rara primeiro. `null` enquanto não chegaram do banco.
      lista: p.bicicletas
        ? ordenarBicicletas(p.bicicletas).map((b) => ({ id: b.id, rar: b.raridade, anunciada: b.anunciada }))
        : null,
      // O número da equipada e a raridade dela (é a raridade que dá a velocidade). `null` = a pé.
      equipada: bicicletaEquipada(p)?.id ?? null,
      equipadaRar: bicicletaEquipada(p)?.raridade ?? null,
      trocaLiberaEm: p.automation.bicicletaTrocadaEm ? p.automation.bicicletaTrocadaEm + INTERVALO_TROCA_BICICLETA_MS : 0,
      intervaloTrocaMs: INTERVALO_TROCA_BICICLETA_MS,
    },
    activeId: p.activeId,
    compartilharPkAte: p.compartilharPkAte ?? 0,
    // Arena: qual boss está sendo enfrentado e com que penalidade. `pontos` é a pontuação
    // acumulada, que é o que alimenta o placar de Boss Points.
    boss: {
      pontos: p.bossPoints,
      // Quantas vezes cada boss já foi derrotado por esta conta (`{ key: n }`). A aba Bosses
      // mostra "Vezes derrotado" ao lado de cada um. Fonte: `automation.bossKills`.
      vitorias: p.automation?.bossKills ?? {},
      arena: p.boss && { key: p.boss.key, slot: p.boss.slot, penalidade: p.boss.penalidade },
      // Repetição automática: o interruptor da aba Bosses. `auto` é a vontade do jogador e
      // `autoKey` é o boss que ela persegue — sem a chave, voltar do Centro não saberia em
      // qual arena entrar de novo (`p.boss` já foi zerado quando a luta acabou).
      auto: !!p.automation?.bossAuto,
      autoKey: p.automation?.bossAutoKey ?? null,
    },
    // O RANK do PvP, para a ficha do treinador — o emblema e o PR aparecem lá fora da aba de
    // PvP, do mesmo jeito que os títulos de ginásio logo abaixo.
    //
    // É um CACHE de `pvp_rank`, lido uma vez no login: aquela tabela é escrita pelo processo
    // do pareamento, que pode ser outro shard, então o dono do jogador nunca a tem em dia
    // sozinho. Quem avisa é `pvp.rank.mudou`, publicado pelo pareador no fim de cada partida
    // (ver `avisarRankMudou` em `game/pvp-ranqueado.mjs`) — e é por isso que este campo pode
    // ser um cache sem mentir: ele é invalidado pelo único evento que o muda.
    // `comPrazo`: o `decaiEm` vai junto, e é o relógio "cai para o Diamante em …" da ficha.
    pvp: pvpdb.rankParaCliente(p.pvpRank, p.pvpPosicao, { comPrazo: true }),
    // Os TÍTULOS DE GINÁSIO deste jogador: os tipos cujo ginásio ele lidera agora. Vai no
    // snapshot (e não numa rota) porque a tela usa isso longe da aba Ginásio — o selo no card
    // do pokémon e o "+25%" na ficha precisam existir mesmo para quem nunca abriu a aba. É
    // uma lista de até 18 strings curtas, e na esmagadora maioria das contas está vazia.
    // ORDENADA: o delta compara chave por chave em TEXTO, e a ordem de um `Set` é a ordem em
    // que o banco devolveu as linhas — que pode variar entre duas apurações. Sem o `sort`, o
    // mesmo conjunto de títulos viraria um campo "mudado" de vez em quando, à toa.
    ginasios: [...(tiposLiderados(p.dbId) ?? [])].sort(),
    // O PASSE DE BATALHA cru (degrau, último resgate, prazo do VIP). A tela calcula o resto com
    // as MESMAS funções do servidor (`shared/passe-batalha.mjs`), então basta o dado — e ele só
    // muda num resgate ou numa compra, que é quando o delta o manda de novo.
    passe: p.passe ?? null,
    // Loja: o que está ativo AGORA. Vão os carimbos de expiração (e não "faltam X minutos")
    // para a tela poder animar a contagem sozinha.
    loja: {
      vipAte: p.vipAte,
      vip: vipAtivo(p, agora()),
      boosts: p.boosts,
      // Quando cada produto de compra limitada libera de novo (hoje só o Pacote de
      // Suprimentos, 1×/semana). Vai o CARIMBO, como os boosts: a vitrine conta sozinha e
      // mostra a espera no próprio card, em vez de o jogador descobrir clicando.
      comprasCooldown: p.comprasCooldown ?? {},
      bless: p.bless,
      gender: p.gender,
      looktype: p.looktype,
      ownedOutfits: p.ownedOutfits,
      betaOutfitsAbertas: BETA_OUTFITS_ABERTAS,
      visual: p.visual,
      visualOk: p.visualOk,
      // Quando o botão "Mudar avatar" volta a valer. Carimbo, como os boosts: a ficha conta
      // sozinha e mostra a espera antes de o jogador montar o boneco à toa.
      visualTrocaLivreEm: (p.visualTrocadoEm ?? 0) + VISUAL_TROCA_MS,
      perfilStatsPublico: p.perfilStatsPublico !== false,
    },
    // As Caixas de Fundador: as fechadas na bolsa, as tags conquistadas, quantas já saíram de
    // cada tipo e o carimbo em que a venda abre. `abremEm` é ABSOLUTO — a tela conta sozinha,
    // do mesmo jeito que faz com os boosts, em vez de o servidor mandar "faltam X".
    caixas: caixasParaCliente(p, vendidasCaixas),
    // O buff que o painel admin ligou para o mundo inteiro, ou `null`. É a MESMA informação
    // para todos os jogadores, mas viaja no snapshot de cada um: o pacote já ia sair, e assim
    // quem acabou de entrar recebe o evento junto do primeiro estado, sem rota extra.
    evento: eventoParaCliente(t),
    // Carimbo do servidor no instante deste snapshot — a tela alinha o relógio local (faixa
    // de evento, saída do Centro) sem depender do horário do PC do jogador.
    servidorAgora: t,
    automation: p.automation,
    // A VITRINE da Ficha do Treinador: os ids que o jogador escolheu exibir, na ordem em que
    // ele os colocou. Vazia = ele nunca montou uma, e a tela cai na equipe atual.
    vitrine: vitrineDoJogador(p),
    guild: p.guild
      ? {
          id: p.guild.id,
          nome: p.guild.nome,
          brasao: p.guild.brasao,
          gp: p.guild.gp,
          ownerId: p.guild.ownerId,
          // O NICK do dono, e nao so o id: a faixa do painel o mostra na linha de baixo. Ele ja
          // vinha no pacote de `guild.*` (que manda o objeto inteiro) e sumia no primeiro delta
          // de estado — a tela perdia o nome do lider sozinha, meio segundo depois de abrir.
          ownerNick: p.guild.ownerNick ?? null,
          // A TAG e a cor dela: o gateway as lê daqui para carimbar cada linha do chat.
          tag: p.guild.tag ?? null,
          tagCor: p.guild.tagCor ?? null,
          tagEditadaEm: p.guild.tagEditadaEm ?? null,
          isOwner: p.guild.isOwner,
          isSubdono: !!p.guild.isSubdono,
          bonusPct: Number(p.guild.bonusPct) || 0,
          bonusRank: Number(p.guild.bonusRank) || 0,
          brasaoEditadoEm: p.guild.brasaoEditadoEm ?? null,
          criadoEm: p.guild.criadoEm ?? null,
          pvpAutoRegistro: !!p.guild.pvpAutoRegistro,
          // Contagens, e não a lista: este objeto viaja no delta de estado e a guild não tem
          // mais teto de tamanho (ver `guildDoJogador`). Os membros de verdade vêm por clique,
          // em `guild.detalhe` (a ficha) ou `guild.escalacao` (o editor do dono).
          membros: Number(p.guild.membros) || 0,
          escalados: Number(p.guild.escalados) || 0,
          escalado: !!p.guild.escalado,
        }
      : null,
    guildConvites: p.guildConvites ?? [],
    guildBonusPct: Number(p.guildBonusPct) || 0,
    guildBonusRank: Number(p.guildBonusRank) || 0,
    items: p.items,
    balls: p.balls,
    pokedex: p.pokedex,
    ...(comPokemons
      ? { pokemons: [...p.pokemons.values()].map(pokemonParaCliente) }
      : null),
    // o selvagem em combate agora (o resto do campo vai pelas mensagens `campo`)
    selvagem: p.selvagem && {
      slot: p.selvagem.slot,
      speciesId: p.selvagem.speciesId,
      nome: p.selvagem.nome,
      looktype: p.selvagem.looktype,
      tipos: p.selvagem.tipos,
      level: p.selvagem.level,
      hp: p.selvagem.hp,
      maxHp: p.selvagem.maxHp,
    },
  };
}

/**
 * Uma mensagem para um jogador.
 *
 * O corte do campo mora AQUI, e não em cada um dos oito lugares que mandam `campo.init`: no
 * Modo Economia o cliente desligou a cena, e cena desligada não tem o que fazer com posição de
 * ninguém. Ver `CLIENTE.ECONOMIA` no protocolo.
 */
const enviar = (p, msg) => {
  if (p.semCampo && (msg.t === SERVIDOR.CAMPO || msg.t === SERVIDOR.CAMPO_INIT)) return;
  enviarAoGateway(p.gatewayId, p.key, [msg]);
};

/**
 * Reenvia a CENA inteira — a praça, a casa, a Arena PvP ou a hunt/arena de boss, o que estiver
 * valendo. É o `campo.init` da entrada, mandado de novo.
 *
 * Existe porque sair do Modo Economia é a única hora em que o cliente tem o socket vivo e a
 * cena vazia ao mesmo tempo. O delta seguinte não a remontaria: ele só traz quem começou um
 * passo novo, então um selvagem parado ficaria invisível até resolver andar.
 */
function reenviarCena(p) {
  const membro = membroDoCentro(p);
  if (membro) return enviar(p, { t: SERVIDOR.CAMPO_INIT, ...snapshotDoCentro(membro.sala, membro) });
  if (p.casa) return enviar(p, { t: SERVIDOR.CAMPO_INIT, ...snapshotDaCasa(p.casa) });
  const arena = arenaDe(p);
  const naArena = arena && membroDe(p);
  if (naArena) return enviar(p, { t: SERVIDOR.CAMPO_INIT, ...snapshotArena(arena, naArena) });
  if (p.campo) enviar(p, { t: SERVIDOR.CAMPO_INIT, ...snapshotCampo(p.campo) });
}

// ---------------------------------------------------------------- estado em delta
//
// O PACOTE DE ESTADO ERA O JOGO INTEIRO, DUAS VEZES POR SEGUNDO.
//
// `snapshot(p)` monta o quadro completo do jogador — inclusive a coleção de pokémon, que num
// jogador de um mês passa de 200 bichos e, medida em produção, dá 99,4% do pacote. Ele saía a
// cada `marcarSujo`, e `marcarSujo` acontece a cada golpe que o selvagem acerta: um dano de 40
// de HP custava 168 kB de rede. Com ~500 jogadores isso era 45 MB/s de egress — 2,7 TB por dia
// — para reenviar, sem parar, 964 pokémon que não mudaram nada.
//
// A saída é a mesma que `deltaCampo` já usa para o mapa: manda só o que mudou. O que este
// bloco NÃO faz, de propósito:
//
//   · não muda o formato de um pokémon (nenhum campo saiu, nenhum nome encurtou);
//   · não muda quando o estado é enviado (a bandeira e a trava de 500 ms são as de antes);
//   · não move regra nenhuma para o cliente.
//
// O cliente remonta o quadro inteiro antes de qualquer tela olhar para ele (`mesclarEstado`
// em `app.js`), então `estado.eu` continua sendo exatamente o objeto de sempre. É por isso
// que nenhuma das ~44 telas que leem `pokemons` precisou ser tocada.
//
// COMO A CORREÇÃO É GARANTIDA. O delta não confia na lista de sujos (`pokemonsSujos` existe
// para o banco, é limpa pelo flush a cada 5 s e nem todo caminho que mexe num pokémon a
// alimenta). Ele COMPARA: serializa cada pokémon e confronta com o texto que foi enviado da
// última vez. Custa o mesmo `JSON.stringify` que já se pagava antes — só que agora o resultado
// serve para decidir o que NÃO mandar, e o Redis e o gateway deixam de carregar o resto.

/** JSON de um valor, com um sentinela para `undefined` (que `JSON.stringify` devolve cru). */
const textoDe = (v) => JSON.stringify(v) ?? '<undefined>';

/**
 * De quanto em quanto tempo o quadro COMPLETO é reenviado mesmo sem necessidade.
 *
 * É rede de segurança, não é o mecanismo. O delta parte de uma crença — "isto o cliente já
 * tem" — e uma crença errada não se conserta sozinha: se um pacote se perder entre o sim e o
 * navegador (Redis engasgando, um `ws.send` que falha com o socket ainda aberto), aquele
 * campo fica velho na tela ATÉ O JOGADOR RELOGAR. Não é um risco grande; é um risco
 * permanente, e é o tipo que não aparece em teste e sim num relato de "meu ouro está errado".
 *
 * Cinco minutos porque o custo é irrisório perto do que se economizou: no jogador médio o
 * quadro cheio comprimido dá ~11 kB, ou ~37 B/s amortizados, contra os 93 kB/s de antes. O
 * jitter espalha os reenvios — sem ele, todo mundo que entrou junto num pico de divulgação
 * ressincronizaria no mesmo segundo, cinco minutos depois, para sempre.
 * O intervalo é regulável (`SINCRONIA_CHEIA_MS` no ambiente) por dois motivos: é o botão para
 * apertar caso algum dia apareça uma fonte de divergência que valha reenviar mais vezes, e é
 * o que deixa `tools/teste-estado-delta.mjs` exercitar o reenvio de verdade em vez de esperar
 * cinco minutos — um caminho que só roda a cada cinco minutos é um caminho que nunca é testado.
 */
const SINCRONIA_CHEIA_MS = Number(process.env.SINCRONIA_CHEIA_MS) || 5 * 60_000;
/** Espalhamento, 20% do intervalo — acompanha sozinho quando o intervalo muda. */
const SINCRONIA_CHEIA_JITTER_MS = Math.round(SINCRONIA_CHEIA_MS * 0.2);

/**
 * Interruptor de emergência do estado em delta.
 *
 * `ESTADO_DELTA=0` faz todo pacote sair COMPLETO, que é o comportamento anterior a esta
 * mudança. Existe porque o delta é uma troca de protocolo que atinge 100% dos jogadores ao
 * mesmo tempo: se algo aparecer em produção que nenhum teste pegou, a correção é uma variável
 * de ambiente e um restart — não um deploy de reversão às três da manhã, com o risco de levar
 * junto tudo o que entrou depois.
 *
 * O cliente não precisa saber: um pacote completo já vai marcado com `cheio`, e é assim que a
 * remontagem do outro lado o trata desde o primeiro dia (ver `shared/estado-delta.mjs`).
 * Serve também para medir o antes e o depois na mesma máquina — `tools/medir-estado.mjs`.
 */
const DELTA_LIGADO = process.env.ESTADO_DELTA !== '0';

/**
 * Esquece o que já foi mandado para a tela deste jogador.
 *
 * O próximo pacote sai COMPLETO. Chamado quando o cliente perde o fio da meada: `welcome`
 * (login e reconexão) e qualquer ponto em que o quadro inteiro é reenviado de propósito.
 */
function zerarBaselineDeTela(p) {
  p.telaCampos = null;
  p.telaPokemons = null;
  p.telaDex = null;
}

/**
 * O que precisa ir para a tela agora — completo na primeira vez, só o delta depois.
 *
 * Devolve `null` quando não há absolutamente nada a dizer. Na prática isso quase não acontece
 * (`servidorAgora` muda a cada pacote), mas a checagem é o que impede um pacote vazio de
 * atravessar o Redis por nada.
 */
function estadoParaEnviar(p) {
  // O pacote CHEIO leva tudo, inclusive a coleção — é o único caminho por onde o array
  // completo passa, e é a base sobre a qual o cliente aplica todos os deltas seguintes. Sai na
  // primeira vez da sessão e, depois, de tempos em tempos como seguro contra pacote perdido.
  const t = agora();
  if (!DELTA_LIGADO || !p.aceitaDelta || !p.telaCampos || !p.telaPokemons || !p.telaDex
      || t >= (p.proximaTelaCheia ?? 0)) {
    const cheio = snapshot(p);
    p.telaCampos = new Map();
    for (const [chave, valor] of Object.entries(cheio)) {
      if (chave !== 'pokemons' && chave !== 'pokedex') p.telaCampos.set(chave, textoDe(valor));
    }
    // A coleção e a Pokédex são lembradas como CÓPIA RASA, não como texto: comparar campo a campo
    // no próximo envio sai muito mais barato que serializar cada pokémon. Ver `tela-igual.mjs`.
    p.telaPokemons = new Map();
    for (const k of p.pokemons.values()) {
      p.telaPokemons.set(k.id, lembrarDaTela(pokemonParaCliente(k)));
    }
    p.telaDex = new Map();
    for (const [chave, entrada] of Object.entries(p.pokedex ?? {})) {
      p.telaDex.set(chave, lembrarDaTela(entrada));
    }
    p.proximaTelaCheia =
      t + SINCRONIA_CHEIA_MS + Math.floor(Math.random() * SINCRONIA_CHEIA_JITTER_MS);
    return { cheio: true, ...cheio };
  }

  const saida = {};
  let temAlgo = false;

  // ---- campos do topo (gold, xp, loja, guild, casa, boss, pvp, caixas, …)
  //
  // São ~2,7 kB no total, então comparar por texto é barato. Sai a chave inteira quando algo
  // dentro dela mudou: `loja` é um objeto só, e mandar `loja` inteiro (292 B) é mais simples e
  // mais seguro do que um delta dentro do delta.
  const base = snapshot(p, { comPokemons: false });
  for (const [chave, valor] of Object.entries(base)) {
    if (chave === 'pokedex') continue; // tem delta próprio, logo abaixo
    const texto = textoDe(valor);
    if (p.telaCampos.get(chave) === texto) continue;
    p.telaCampos.set(chave, texto);
    saida[chave] = valor;
    temAlgo = true;
  }
  // Chave que sumiu do snapshot: vira `null` explícito para o cliente poder apagá-la. Não
  // acontece hoje (o formato do snapshot é fixo), mas sem isto um campo removido no futuro
  // ficaria congelado na tela para sempre — o pior tipo de bug, porque só aparece depois.
  for (const chave of p.telaCampos.keys()) {
    if (chave in base) continue;
    p.telaCampos.delete(chave);
    saida[chave] = null;
    temAlgo = true;
  }

  // ---- a coleção
  const mudados = [];
  for (const k of p.pokemons.values()) {
    const o = pokemonParaCliente(k);
    if (igualATela(p.telaPokemons.get(k.id), o)) continue;
    p.telaPokemons.set(k.id, lembrarDaTela(o));
    mudados.push(o);
  }
  // Depois do laço, todo pokémon de agora tem lembrança — e `p.pokemons` é chaveado pelo `id`, então
  // são tantos ids quanto entradas. Só sobra lembrança se algum pokémon SAIU, e só então vale varrer.
  // Antes a varredura (e o `Set` que ela pedia) rodava a todo envio para quase nunca achar nada.
  const fora = [];
  if (p.telaPokemons.size > p.pokemons.size) {
    const vistos = new Set();
    for (const k of p.pokemons.values()) vistos.add(k.id);
    for (const id of p.telaPokemons.keys()) if (!vistos.has(id)) fora.push(id);
    for (const id of fora) p.telaPokemons.delete(id);
  }

  // ---- a Pokédex
  //
  // Mesmo remédio da coleção, e pelo mesmo motivo. Ela é um mapa espécie → `{k, c}`, e um
  // abate mexe em UMA entrada — mas o mapa inteiro ia junto a cada pacote. Com a coleção já
  // fora do caminho, era o que sobrava de maior no delta: 2,9 kB dos 3,5 kB de um jogador
  // com 140 espécies vistas, e crescendo com a Pokédex — a mesma armadilha de novo, só que
  // paga por quem joga há mais tempo.
  const dexMud = {};
  let temDex = false;
  const dexAtual = p.pokedex ?? {};
  const chavesDex = Object.keys(dexAtual);
  for (const chave of chavesDex) {
    if (igualATela(p.telaDex.get(chave), dexAtual[chave])) continue;
    p.telaDex.set(chave, lembrarDaTela(dexAtual[chave]));
    dexMud[chave] = dexAtual[chave];
    temDex = true;
  }
  // A mesma conta da coleção: toda espécie de agora já tem lembrança, então só sobra alguma se saiu.
  const dexFora = [];
  if (p.telaDex.size > chavesDex.length) {
    for (const chave of p.telaDex.keys()) if (!(chave in dexAtual)) dexFora.push(chave);
    for (const chave of dexFora) p.telaDex.delete(chave);
  }
  if (temDex) {
    saida.dexMud = dexMud;
    temAlgo = true;
  }
  if (dexFora.length) {
    saida.dexFora = dexFora;
    temAlgo = true;
  }

  if (mudados.length) {
    saida.pkMud = mudados;
    temAlgo = true;
  }
  if (fora.length) {
    saida.pkFora = fora;
    temAlgo = true;
  }

  return temAlgo ? saida : null;
}

/**
 * Manda o estado para a tela do jogador. Substitui os ~40 lugares que faziam
 * `enviar(p, { t: SERVIDOR.ESTADO, estado: snapshot(p) })` à mão.
 *
 * Passar por aqui é o que mantém o baseline honesto: um `snapshot` cru enviado por fora
 * deixaria o cliente com dados que o servidor não sabe que já mandou.
 */
function enviarEstado(p) {
  if (!p.welcomeEnviado) return;
  const estado = estadoParaEnviar(p);
  if (estado) enviar(p, { t: SERVIDOR.ESTADO, estado });
}

/**
 * O `welcome`: estado do jogador mais os catálogos que a tela precisa e que nunca mudam.
 *
 * É UMA função porque sai de dois lugares — login novo e reconexão — e as duas cópias já
 * divergiram uma vez, com um catálogo entrando só na da reconexão: quem criava a conta
 * abria a tela sem ele.
 */
function enviarWelcome(p) {
  // O welcome é o marco zero da tela: o cliente monta `estado.eu` do nada a partir daqui, e
  // qualquer coisa que o servidor achasse já ter mandado ficaria faltando para sempre. Vale
  // tanto no login quanto na reconexão dentro da carência, em que o jogador continuou na
  // memória do sim mas o navegador do outro lado pode ser uma aba recém-aberta.
  zerarBaselineDeTela(p);
  enviar(p, {
    t: SERVIDOR.WELCOME,
    admin: !!p.admin,
    chatMod: !!p.admin || CARGOS_MOD_CHAT.includes(p.chatCargo),
    // Separado do `chatMod`: o helper apaga mensagem e usa o menu de mute, mas não digita
    // `/mute` (ver CARGOS_CMD_CHAT). Sem esta bandeira o cliente esconderia o comando de
    // todo mundo ou de ninguém — e o servidor recusaria depois, com o texto já no chat.
    chatCmd: !!p.admin || CARGOS_CMD_CHAT.includes(p.chatCargo),
    // `estadoParaEnviar` logo depois de zerar devolve o quadro COMPLETO e já deixa o baseline
    // semeado com ele. Chamar `snapshot(p)` direto aqui daria o mesmo pacote, mas o servidor
    // sairia achando que não mandou nada — e o primeiro delta seria um segundo quadro inteiro.
    estado: estadoParaEnviar(p),
    hunts: huntsJogaveis,
    catalogoBolas: bolas,
    starters: ofertaDeStarter(p),
    // Itens avulsos que o Market vende, com o preço que o SERVIDOR cobra — a tela só mostra.
    itensCompraveis: [...ITENS_COMPRAVEIS].map(([itemId, preco]) => ({
      itemId,
      preco,
      nome: itens.get(itemId)?.name ?? `item ${itemId}`,
    })),
    // A tabela da potência, para a tela mostrar "+25%" e a chance sem repetir os números —
    // quem sorteia é o servidor, e duas cópias da mesma tabela divergem no primeiro ajuste.
    potencias: POTENCIAS,
    // pokeId → looktype da forma SHINY, as 64 que existem. A tela precisa disto para desenhar
    // o Charizard preto no lugar do laranja quando o bicho é shiny — e para saber que os
    // outros 379 não têm forma própria.
    shinyLooks: Object.fromEntries([...catalogoShiny].map(([id, s]) => [id, s.looktype])),
    shinyLooksOutland: Object.fromEntries([...catalogoShinyOutland].map(([id, s]) => [id, s.looktype])),
    // Uma chance só — quem tem forma shiny no catálogo sorteia na captura bem-sucedida.
    chanceShiny: CHANCE_SHINY,
    outlandDex: OUTLAND_DEX,
    // As constantes da fórmula de captura. A FÓRMULA é espelhada na tela (ver `chanceCaptura`
    // no app.js); os NÚMEROS vêm daqui, para balancear em um lugar só.
    captura: {
      base: BASE_CAPTURA,
      piso: CAPTURA_PISO,
      teto: CAPTURA_TETO,
      raridadeDiv: CAPTURA_RARIDADE_DIV,
      // O preço que vale para quem não tem preço — ver `PRECO_MAIS_RARO`. Vai junto para a
      // tela não precisar varrer o catálogo inteiro só para achar o mesmo número.
      precoSemPreco: PRECO_MAIS_RARO,
    },
    // O ×3 do shiny nos stats e o tamanho da equipe — a Pokepédia publica os dois.
    multShinyStats: MULT_SHINY_STATS,
    maxEquipe: MAX_EQUIPE,
    // A tabela 18×18 de efetividade. Vai inteira (uns 2 kB) porque a Pokepédia desenha o
    // quadro de forças e fraquezas, e recortá-la por espécie exigiria uma ida ao servidor a
    // cada ficha aberta para mostrar um número que não muda nunca.
    tabelaTipos,
    ampliacaoHunt: AMPLIACAO_HUNT,
    multHpSelvagem: MULT_HP_SELVAGEM,
    multDanoSelvagem: MULT_DANO_SELVAGEM,
    // Drop na Outland — publicado para a Pokédex e a Pokepédia não hardcodarem o número.
    chanceBossToken: CHANCE_BOSS_TOKEN_SELVAGEM,
    /**
     * A ESCADA DAS OUTLANDS: `[{ tier, rotulo, nivel, mult }]`.
     *
     * Vai no welcome pelo mesmo motivo do `chanceBossToken` logo acima: o seletor do Mapa, a
     * ficha da área e a Pokepédia mostram "×1,5" e "Nv 4.000", e três cópias do mesmo número
     * divergem no primeiro rebalanceamento. Vai a escada INTEIRA, e não só o degrau do
     * jogador, porque o seletor precisa listar também as que ele ainda não abriu — é assim
     * que ele descobre que existe um ×3 esperando no nível 4.000. Ver `shared/outland-tiers.mjs`.
     */
    outlandTiers: catalogoOutlandTiers(),
    /**
     * As regras da CASA e do XP SHARE, num pacote só.
     *
     * Vai inteiro no welcome pela razão de sempre neste arquivo: a Pokepédia publica um
     * capítulo sobre isto, e um manual com número escrito à mão mente calado no dia em que
     * alguém balanceia o `xpShare` de uma raridade. Aqui os dois leem a MESMA fonte.
     */
    casas: {
      // As cinco raridades, com a fatia de XP Share que cada uma dá, quantos postos tem e a
      // chance no sorteio. A tela mostra a tabela ANTES de o jogador gastar os fragmentos — é
      // o mínimo que se deve a quem paga por um sorteio.
      raridades: RARIDADES_CASA.map((r) => ({
        id: r.id, rotulo: r.rotulo, bonecos: r.bonecos, xpShare: r.xpShare, peso: r.peso,
      })),
      precoDiamante: PRECO_CASA_DIAMANTE,
      // Quantas casas valem ao mesmo tempo — a Pokepédia escreve o número daqui.
      maxEmUso: MAX_CASAS_EM_USO,
      fragmento: {
        itemId: FRAGMENTO_CHAVE_ID,
        custo: CUSTO_FRAGMENTOS_CASA,
        chanceDrop: CHANCE_FRAGMENTO_CHAVE,
      },
    },
    // As cinco BICICLETAS, com a velocidade e a chance de cada uma. A aba "Fabricar Bicicleta"
    // desenha a tabela ANTES de o jogador gastar os fragmentos, como a da Casa.
    bicicletas: {
      raridades: RARIDADES_BICICLETA.map((r) => ({
        id: r.id, rotulo: r.rotulo, velocidade: r.velocidade, peso: r.peso,
      })),
      fragmento: {
        itemId: FRAGMENTO_BICICLETA_ID,
        custo: CUSTO_FRAGMENTOS_BICICLETA,
        chanceDrop: CHANCE_FRAGMENTO_BICICLETA,
      },
    },
    /** Fragmento → 18 pedras. A aba "Fabricar Shiny Stone" do Professor Carvalho. */
    shinyStone: configShinyStone(),
    mega: configMega(),
    /**
     * OFERENDA — quantas casas a roleta tem. Um número só, e ele vem daqui pela razão de sempre:
     * a tela escreve "3 de 5" e calcula a chance de sair pedra (`oferecidos / casas`). Uma
     * constante copiada no cliente viraria mentira no dia em que o número mudasse — e ele já
     * mudou, de dez para cinco —, e a mentira apareceria justamente na frase que promete a
     * probabilidade.
     */
    oferenda: { casas: OFERENDA_CASAS },
    // As regras de dinheiro, num lugar só. A Pokepédia tem um capítulo de TAXAS e ele não
    // pode ter número escrito à mão: o spread e a comissão do mercado mudam o que o jogador
    // recebe de verdade, e uma tabela desatualizada ali é pior que nenhuma.
    economia: {
      orbCompraUsdt: PRECO_COMPRA,
      orbSaqueUsdt: PRECO_SAQUE,
      spreadPct: Math.round(SPREAD * 100),
      saqueMinimo: SAQUE_MINIMO_ORBS,
      taxaMercadoOrbPct: Math.round(mdb.TAXA_ORB * 100),
      taxaMercadoGoldPct: Math.round(mdb.TAXA_GOLD * 100),
      // A pensão da feira entra no quadro geral de TAXAS da Pokepédia, ao lado da comissão.
      // Só pokémon paga (ver `TAXA_DIARIA`), e o capítulo do mercado explica o porquê.
      taxaDiariaMercado: mdb.TAXA_DIARIA,
      maxAnuncios: mdb.MAX_ANUNCIOS,
      xpPerdidoPct: Math.round(PVP_XP_PERDIDO * 100),
      // A rede CONFIGURADA, e só ela — não a lista do que `REDES` sabe validar.
      //
      // O `orbs.mjs` conhece o formato de endereço de três redes, mas a carteira do projeto
      // está numa só e é ela que recebe depósito e assina saque. Publicar as três num manual
      // faria alguém mandar USDT por BSC para um endereço Solana, e esse dinheiro não volta.
      // É a mesma razão de a tela de depósito não ter seletor de rede.
      rede: REDES[config.carteiraRede]?.nome ?? config.carteiraRede,
    },
    // itemId → tipo elemental, derivado no boot (ver `TIPO_DO_ITEM`). Vai inteiro porque a
    // tela usa em dois lugares: o selo no card e o filtro da bolsa na hora de anunciar.
    itensTipos: Object.fromEntries(TIPO_DO_ITEM),
    // Os itens que são NOSSOS (ver `game/itens-nossos.mjs`).
    //
    // O cliente monta o catálogo dele baixando `/assets/items.json` direto — o espelho, que
    // por definição não conhece nenhum item nosso. Sem esta lista a bolsa desenharia a Escape
    // Rope como "#70010" com o ícone genérico de saco, e o Mercado não saberia o nome de uma
    // Casa. Vai no welcome (e não num arquivo à parte) porque é conteúdo fixo: ~25 linhas,
    // uma vez por sessão, do mesmo jeito que `catalogoBolas` e `pedrasEvolucao`.
    itensNossos: ITENS_NOSSOS,
    pedrasEvolucao: PEDRA_EVOLUCAO_POR_TIPO,
    // REFINO — a tabela de custo do "+1". Vai do servidor porque é ELE quem cobra: a tela
    // desenha "500 Fire Stone" a partir daqui, e um número escrito à mão no cliente viraria
    // mentira no primeiro ajuste de balanceamento (ver `shared/refino-stats.mjs`).
    refino: {
      stats: STATS_REFINAVEIS,
      custoBase: REFINO_CUSTO_BASE,
      expoente: REFINO_EXPOENTE,
      tetoTecnico: REFINO_TETO_TECNICO,
      passo: REFINO_PASSO,
    },
    // O que a vitrine da comunidade desenha e o que ela aceita. Vai inteiro no welcome
    // porque a tela mostra TODA pedra do jogo, inclusive as que ninguém está vendendo —
    // sem o catálogo ela só conseguiria listar o que já tem anúncio.
    mercado: {
      catalogo: CATALOGO_MERCADO,
      categorias: CATEGORIAS_MERCADO,
      pokemonMin: MERCADO_POKEMON_MIN,
      // Aluguel da vitrine. A tela precisa dos três para montar o modal de dias e mostrar
      // o total antes de o jogador confirmar — quem cobra continua sendo o servidor.
      taxaDiaria: mdb.TAXA_DIARIA,
      diasMin: mdb.DIAS_MIN,
      diasMax: mdb.DIAS_MAX,
      precoMinOrb: mdb.PRECO_MIN_ORB,
      precoMinGold: mdb.PRECO_MIN_GOLD,
      taxaOrbPct: Math.round(mdb.TAXA_ORB * 100),
      taxaGoldPct: Math.round(mdb.TAXA_GOLD * 100),
      cooldownCompraMs: mdb.COOLDOWN_COMPRA_MS,
      cooldownCompraMin: mdb.COOLDOWN_COMPRA_MIN,
      // A espera entre dois anúncios do mesmo item (ver `REANUNCIO_MS`). Desce para a tela
      // poder AVISAR antes, no passo de escolher o item — descobrir a regra só na recusa é
      // descobrir depois de já ter escolhido preço e quantidade.
      reanuncioMin: mdb.REANUNCIO_MIN,
    },
    // Galeria de bosses (arte + nível + drops) e as fichas dos que dão para desafiar. A
    // galeria tem 87 e só as que aparecem em `bossesJogaveis` têm arena, entrada e drops.
    // O catálogo da loja de diamantes. Estático, vai uma vez só.
    lojaProdutos: catalogoParaCliente(),
    xpShareHeld: { enabled: true, itemId: XP_SHARE_HELD_ID, pct: Math.round(XP_SHARE_HELD_PCT * 100) },
    // Os cinco TIPOS de boost, indexados pela chave com que ficam gravados no jogador.
    //
    // Isto não é redundante com `lojaProdutos`: lá o id é o do jogo original
    // (`boost_shinycharm`, `boost_capture`) e aqui a chave é a nossa (`shiny`, `captura`).
    // O HUD de "o que está ativo agora" lê `p.boosts`, que é indexado pela CHAVE — sem este
    // mapa ele teria de adivinhar o id do produto, e nos dois casos em que os nomes divergem
    // acabava mostrando a chave crua ("shiny") no lugar do nome ("Shiny Secret Lure").
    tiposBoost: Object.values(TIPOS_BOOST).map((t) => ({
      chave: t.chave,
      nome: t.nome,
      icone: `site/assets/loja/${t.icone}`,
      mult: t.mult,
      descricao: t.descricao,
      // O HUD de boosts ativos e o card do pacote mostram esta descrição como `title`. Sem a
      // chave, os dois ficariam em português mesmo com o jogo em inglês ou espanhol.
      descChave: t.descChave ?? null,
    })),
    guildCusto: CUSTO_CRIAR_GUILD,
    guildMaxTime: MAX_TIME_GUILD,
    guildEscudos: [...ESCUDOS],
    guildEmblemas: [...EMBLEMAS],
    bossesCatalogo,
    bossesJogaveis: Object.values(BOSSES).map((b) => ({
      key: b.key,
      nome: b.nome,
      level: b.level,
      teamLevel: b.teamLevel,
      minNivelTreinador: b.minNivelTreinador,
      type1: b.type1,
      type2: b.type2 ?? null,
      chanceTm: b.chanceTm,
      parTm: b.parTm,
      equipeIdeal: BOSS_EQUIPE_IDEAL,
      entrada: b.entrada,
      drops: b.drops.map((d) => ({
        itemId: d.itemId,
        nome: d.nome,
        chance: d.chance ?? null,
        qtd: d.pesos ? [Math.min(...d.pesos.map(([q]) => q)), Math.max(...d.pesos.map(([q]) => q))] : null,
      })),
    })),
    tmResearcher: configTmResearcher(),
  });

  // A lista de amigos NÃO entra no snapshot (seria kB repetidos a cada 0,5 s com dados que só
  // mudam por ação). Vai neste pacote à parte, logo após o welcome, e depois só nas respostas
  // de `SERVIDOR.AMIGOS` quando algo muda. É o que alimenta o badge do botão da HUD.
  enviar(p, { t: SERVIDOR.AMIGOS, lista: p.amigos ?? [], pedidos: p.amigosPedidos ?? [] });

  // O PORTÃO abre AQUI, e não no começo da função: se a montagem do pacote estourasse no meio,
  // abri-lo antes deixaria o jogador recebendo delta sem nunca ter recebido o quadro inteiro —
  // exatamente o estado que este campo existe para impedir. Ver `p.welcomeEnviado`.
  p.welcomeEnviado = true;
}

/**
 * A área só abre com o nível do treinador em dia.
 *
 * Isto PRECISA morar no servidor: a tela cinzenta do marcador é só desenho, e um cliente
 * mandando `hunt.select` na mão entrava em qualquer lugar. O nível da área é o maior
 * `huntLevel` entre as espécies que aparecem lá — o mesmo número que o marcador mostra.
 */
const areaLiberada = (p, hunt) => p.level >= hunt.nivel;

/**
 * Entre ondas (campo vazio) ou logo após um respawn, antes do primeiro golpe da onda nova,
 * o botão de subir ao Centro libera na hora — quem limpou a hunt não fica preso no gap do spawn.
 */
function centroLivreInstantaneoNaHunt(p) {
  if (!p.huntSlug || p.noCentro || p.boss || p.pvp) return false;
  const campo = p.campo;
  if (!campo) return false;
  if (!algumMobVivo(campo)) return true;
  return (p.combateOndaSeq ?? 0) < (campo.ondaSeq ?? 0);
}

/** Trava de 3 s após dano na hunt (ou boss) — mesma regra do Centro Pokémon. */
function msgBloqueioCombateCurto(p, t) {
  if (centroLivreInstantaneoNaHunt(p)) return null;
  const falta = p.emCombateAte + CENTRO_SAIDA_MS - t;
  if (falta > 0) {
    return `em combate — espere ${(falta / 1000).toFixed(1)}s sem tomar nem dar dano`;
  }
  return null;
}

/** Mesma trava do Centro Pokémon: em combate na hunt (3 s) ou na arena PvP (10 s / ainda dentro). */
function msgBloqueioTrocaDeHunt(p, t) {
  if (p.pvp) {
    if (!podeSairDaArena(p, t)) {
      const s = Math.ceil(msParaSair(p, t) / 1000);
      return `em combate — espere ${s}s sem tomar nem dar dano`;
    }
    return 'saia da arena PvP antes de trocar de área';
  }
  return msgBloqueioCombateCurto(p, t);
}

/** Boss só entra do Centro Pokémon, fora de combate (3 s na hunt, 10 s no PvP). */
function msgBloqueioEntradaBoss(p, t) {
  if (p.pvp) {
    if (!podeSairDaArena(p, t)) {
      const s = Math.ceil(msParaSair(p, t) / 1000);
      return `em combate — espere ${s}s sem tomar nem dar dano`;
    }
    return 'saia da arena PvP antes de desafiar um boss';
  }
  if (!p.noCentro) {
    const trava = msgBloqueioCombateCurto(p, t);
    if (trava) return trava;
    return 'vá ao Centro Pokémon antes de desafiar um boss';
  }
  return msgBloqueioCombateCurto(p, t);
}

/**
 * Monta o campo daquela hunt e manda o estado inicial. Sem grade andável não há hunt: o
 * herói não teria por onde caminhar até os selvagens.
 */
function entrarNaHunt(p, slug) {
  const hunt = huntJogavelPorSlug.get(slug);
  if (!hunt || !areaLiberada(p, hunt)) return false;
  // A outfit vem do JOGADOR: quem comprou uma cosplay na loja (ou trocou de gênero) anda com
  // ela na hunt. A arena do boss troca por conta própria, como já fazia.
  const campo = criarCampo(slug, agora(), {
    looktypeTreinador: p.looktype,
    visualTreinador: empacotarVisual(p.visual),
  });
  if (!campo) return false;
  p.automation.desistiuHunt = false;
  p.huntSlug = slug;
  // Escolher uma área no Mapa é o que TIRA o jogador do Centro — curar não tira mais.
  deixarOCentro(p);
  p.campo = campo;
  p.selvagem = null;
  campo.ondaEm = agora() + 300;
  enviar(p, { t: SERVIDOR.CAMPO_INIT, ...snapshotCampo(campo) });
  return true;
}

/** A equipe que conta para a penalidade do boss: quem está em slot, não o depot inteiro. */
const equipeDe = (p) => [...p.pokemons.values()].filter((k) => k.slot != null);

/**
 * O golpe do boss: o de maior power entre os que saíram do cooldown.
 *
 * Sem lista de golpes da espécie e sem ataque básico — se tudo está carregando, o boss passa
 * a vez. É o que dá o ritmo da luta: janelas de respiro entre os golpes pesados.
 */
function golpeDeBoss(s, t) {
  let melhor = null;
  for (const g of s.golpes ?? []) {
    if ((s.cdGolpes[g.name] ?? 0) > t) continue;
    if (!melhor || g.power > melhor.power) melhor = g;
  }
  return melhor;
}

/**
 * Entra na arena de um boss.
 *
 * A taxa de entrada é cobrada AQUI, e só depois de tudo o mais dar certo — cobrar antes e
 * falhar na montagem da arena queimaria o token do jogador por um erro nosso.
 */
function entrarNaArena(p, boss) {
  const campo = criarCampo(boss.arena, agora(), {
    distCombate: boss.distCombate,
    looktypeTreinador: p.looktype,
    visualTreinador: empacotarVisual(p.visual),
    usarRaioHunt: false,
  });
  if (!campo) return false;

  const mob = porMobEmCampo(campo, montarBoss(boss), campo.g.pontos[0], agora());
  if (!mob) return false;

  // cobra a entrada
  const t = boss.entrada;
  p.items[t.itemId] = (p.items[t.itemId] ?? 0) - t.qtd;
  if (!p.items[t.itemId]) delete p.items[t.itemId];

  p.boss = { key: boss.key, slot: mob.slot, penalidade: penalidadeDeEquipe(equipeDe(p), boss.teamLevel) };
  deixarOCentro(p);
  p.campo = campo;
  p.selvagem = null;
  p.cdGolpes = {};
  campo.alvo = mob.slot;
  campo.heroiMudou = true;
  // sem onda: a arena tem um boss e acabou
  campo.ondaEm = Infinity;

  enviar(p, { t: SERVIDOR.CAMPO_INIT, ...snapshotCampo(campo) });
  marcarSujo(p);
  return true;
}

/**
 * Marca a hora da PRÓXIMA entrada automática na arena. Chamado quando uma luta de boss acaba.
 *
 * Só agenda — quem entra é `tentarBossAutomatico`, no tick. A separação existe porque no
 * instante em que a luta termina o jogador ainda não chegou ao Centro (nem foi curado), e
 * entrar aqui devolveria o time no chão para dentro da arena seguinte.
 */
function msAteEntradaBossLivre(p, t) {
  const faltaCombate = p.emCombateAte + CENTRO_SAIDA_MS - t;
  return Math.max(BOSS_AUTO_ESPERA_MS, faltaCombate > 0 ? faltaCombate + 200 : 0);
}

function reagendarBossAuto(p, t, ms) {
  p.bossAutoEm = t + Math.max(200, ms);
}

function agendarBossAuto(p) {
  if (!p.automation?.bossAuto) return;
  if (!p.automation.bossAutoKey) return;
  const t = agora();
  p.bossAutoEm = t + msAteEntradaBossLivre(p, t);
}

/**
 * A volta para a arena, no modo automático: cura o time e entra de novo.
 *
 * Roda no Centro e só no Centro — é lá que o jogador cai ao fim de toda luta de boss, e é a
 * cura da enfermeira que torna a repetição possível. As mesmas travas do `boss.entrar` valem
 * aqui (token, nível, time de pé), porque este caminho gasta os mesmos recursos; a diferença
 * é que falhar DESLIGA o interruptor em vez de só reclamar, senão o jogador voltaria depois de
 * horas para encontrar o mesmo aviso repetido mil vezes no log.
 */
function tentarBossAutomatico(p, t) {
  if (!p.bossAutoEm || t < p.bossAutoEm) return;
  if (!p.automation?.bossAuto) return void (p.bossAutoEm = 0);
  if (p.boss || p.pvp) return reagendarBossAuto(p, t, 400);
  // Fora do Centro não há enfermeira: quem saiu para uma hunt no meio da série decidiu parar.
  if (!p.noCentro) return void (p.bossAutoEm = 0);
  const travaBoss = msgBloqueioEntradaBoss(p, t);
  if (travaBoss) {
    const faltaCombate = p.emCombateAte + CENTRO_SAIDA_MS - t;
    return reagendarBossAuto(p, t, faltaCombate > 0 ? faltaCombate + 200 : 500);
  }

  const desligar = (msg) => {
    p.bossAutoEm = 0;
    p.automation.bossAuto = false;
    marcarSujo(p);
    evento(p, { k: 'bossAuto', ativo: false, key: p.automation.bossAutoKey ?? null });
    evento(p, { k: 'aviso', msg });
    enviarEstado(p);
  };

  const boss = bossPorKey(p.automation.bossAutoKey ?? '');
  if (!boss) return desligar('a repetição automática parou: boss não encontrado');
  const entrada = boss.entrada;
  if ((p.items[entrada.itemId] ?? 0) < entrada.qtd) {
    return desligar(`acabaram os ${entrada.nome} — repetição automática desligada`);
  }
  if (p.level < boss.minNivelTreinador) {
    return desligar(`nível insuficiente para ${boss.nome} — repetição automática desligada`);
  }

  // A cura é a razão de a volta passar pelo Centro. É a mesma da enfermeira (`centro.curar`),
  // e não um `hp = maxHp` solto: o pokémon caído precisa se levantar na cena também.
  let curados = 0;
  for (const pk of p.pokemons.values()) {
    if (pk.hp >= pk.maxHp) continue;
    pk.hp = pk.maxHp;
    curados++;
    marcarSujo(p, pk);
  }
  if (curados) {
    p.cdGolpes = {};
    p.centroMotivo = 'curado';
    atualizarPokemonDoCentro(p, ativo(p), t);
    evento(p, { k: 'curado' });
  }

  if (!equipeDe(p).some((k) => k.hp > 0)) {
    return desligar('sem pokémon na equipe — repetição automática desligada');
  }
  const pkAtivo = ativo(p);
  if (pkAtivo && !podeUsarPokemon(p, pkAtivo)) {
    return desligar(msgPokemonRecusaNivel(pkAtivo, p));
  }

  p.bossAutoEm = 0;
  if (!entrarNaArena(p, boss)) {
    return desligar(`a arena de ${boss.nome} não está disponível neste servidor`);
  }
  evento(p, { k: 'bossEntrou', key: boss.key, nome: boss.nome, penalidade: p.boss.penalidade, auto: true });
}

/** Abandona a arena de boss e vai para o Centro Pokémon (a hunt fica guardada em huntSlug). */
function sairDaArena(p) {
  if (!p.boss) return;
  p.boss = null;
  p.campo = null;
  p.selvagem = null;
  irParaOCentro(p, 'visita');
}

/**
 * Time nocauteado: manda o treinador para o Centro Pokémon.
 *
 * Antes o jogador que ficava sem revive simplesmente travava — o pokémon desmaiado em campo
 * e nada acontecendo, sem nem uma tela dizendo o que fazer. Agora a hunt é suspensa (a hunt
 * escolhida fica guardada em `p.huntSlug`) e o treinador aparece na PRAÇA de Cerulean, em
 * frente ao Centro Pokémon — uma área compartilhada, com os outros jogadores andando por lá.
 */
function nocautearEquipe(p) {
  for (const pk of p.pokemons.values()) {
    if (pk.slot == null || pk.hp <= 0) continue;
    pk.hp = 0;
    marcarSujo(p, pk);
  }
}

function irParaOCentro(p, motivo = 'morte', { cena = true, autoVoltarHunt = true, xpJaCobrado = false } = {}) {
  if (!centroPokemon || p.noCentro) return false;
  cancelarVoltarHuntAutomatico(p);
  // Quem cai aqui vindo de casa (ou por `centro.ir` com a hunt ainda salva) precisa fechar a
  // instância — senão `centro.andar` continua mandando passos para a sala fantasma.
  if (p.casa) {
    p.casa = null;
    casasAbertas.delete(p);
  }
  p.noCentro = true;
  // POR QUE o jogador está aqui. 'morte' = o time caiu; 'visita' = ele veio a pé, pelo botão
  // do palco ou saindo da arena PvP. A tela usa isto para não anunciar um nocaute que não
  // aconteceu — era o que a caixa da enfermeira fazia ao sair do PvP com o time inteiro de pé.
  p.centroMotivo = motivo;
  p.campo = null;
  p.selvagem = null;
  // Desmaiar numa arena tira o jogador dela: a enfermeira devolve para a HUNT, e voltar ao
  // boss é uma decisão nova.
  p.boss = null;
  // Desmaiar dentro da arena PvP também tira o jogador dela — e carimba o cooldown de 5
  // minutos. Sem isto a enfermeira devolveria o treinador curado para dentro da arena, o que
  // transformaria a morte em um respawn de graça no meio da briga.
  if (p.pvp) sairDaArenaPvp(p, 'morreu', agora());
  // A caixa de curar aparece por `noCentro` no snapshot, então SEM isto o cliente nunca
  // ficava sabendo que chegou aqui: a cena virava o Centro (vai por CAMPO_INIT, à parte)
  // mas o botão não vinha, e só aparecia quando outra coisa qualquer sujava o jogador.
  //
  // Era intermitente porque dependia do intervalo de 500 ms entre snapshots: se o golpe
  // que derrubou o time coubesse no mesmo intervalo, a bandeira ainda estava de pé e o
  // envio seguinte carregava `noCentro`; se o snapshot tivesse acabado de sair, não.
  marcarSujo(p);
  const nocaute = motivo === 'morte' || motivo === 'desistencia';
  if (nocaute && !xpJaCobrado) {
    const xpPerdido = aplicarPerdaDeXpTreinador(p, consumirBless);
    p.automation.morteXpCobrada = true;
    if (xpPerdido > 0) evento(p, { k: 'xpPerdido', qtd: xpPerdido });
    marcarSujo(p);
  }
  // O motivo vai NA MENSAGEM em vez de a tela ler `centroMotivo`: o evento chega antes do
  // snapshot de estado, então naquele instante a tela ainda acha que o jogador está na hunt.
  evento(p, { k: 'centro', motivo });
  // E a Joy recebe o treinador na porta, com a fala que combina com o porquê de ele estar ali.
  evento(p, { k: 'joy', fala: nocaute ? 'nocaute' : 'ola' });

  const r = entrarNoCentro(p, ativo(p), agora());
  if (!r) {
    // A grade da praça não existe neste servidor (walkgrids sem a área "centro"). Sem cena
    // não dá para andar, mas o jogador PRECISA continuar podendo curar — `noCentro` fica de
    // pé e o botão da enfermeira aparece por cima do que estava na tela.
    evento(p, { k: 'aviso', msg: 'a praça do Centro Pokémon não está disponível neste servidor' });
    return false;
  }
  // `cena: false` é para o LOGIN, e por uma questão de ordem: lá o `welcome` ainda não saiu, e
  // um `campo.init` que chega antes dele encontra a tela sem cena montada e se perde. Quem
  // pediu manda a cena depois — ver `entrar`.
  if (cena) enviar(p, { t: SERVIDOR.CAMPO_INIT, ...snapshotDoCentro(r.sala, r.membro) });
  if (motivo === 'morte' && autoVoltarHunt && !p.automation?.desistiuHunt) agendarVoltarHuntAutomatico(p);
  return true;
}

/**
 * Sai da praça. É o par de `irParaOCentro` e roda em TODA saída — escolher hunt,
 * entrar numa arena, cair a conexão.
 *
 * Existe como função por um motivo prático: `p.noCentro = false` aparece em cinco lugares, e
 * bastava um deles esquecer de tirar o boneco da sala para o jogador virar uma estátua parada
 * na praça, visível para todo mundo, enquanto caça do outro lado do mundo.
 */
function deixarOCentro(p) {
  cancelarVoltarHuntAutomatico(p);
  sairDoCentro(p);
  p.noCentro = false;
  p.centroMotivo = null;
  // A CASA sai pela mesma porta, e é o único lugar em que isso é feito.
  //
  // Ela não é a praça, mas tem exatamente o mesmo problema: é uma cena andável que o jogador
  // abandona por quatro caminhos diferentes (escolher hunt, entrar numa arena, cair
  // a conexão, ser levado para o Centro por nocaute). Um deles esquecendo de fechar a casa
  // deixaria a instância viva em `casasAbertas` — um tick a cada 100 ms desenhando uma sala
  // que ninguém está vendo, para sempre.
  //
  // O XP SHARE não para aqui: `p.xpShare` é outra coisa e continua valendo com o jogador na
  // hunt — a casa é a JANELA para os postos, não o interruptor deles.
  if (p.casa) {
    p.casa = null;
    casasAbertas.delete(p);
  }
}

/**
 * Cura o time inteiro no Centro — a mesma lógica de `centro.curar`, sem mandar embora.
 */
function curarEquipeNoCentro(p) {
  let curados = 0;
  for (const pk of p.pokemons.values()) {
    if (pk.hp >= pk.maxHp) continue;
    pk.hp = pk.maxHp;
    curados++;
    marcarSujo(p, pk);
  }
  if (!curados) return false;
  p.cdGolpes = {};
  p.centroMotivo = 'curado';
  p.automation.morteXpCobrada = false;
  atualizarPokemonDoCentro(p, ativo(p), agora());
  marcarSujo(p);
  evento(p, { k: 'curado' });
  return true;
}

/** Pausa no Centro antes de curar e voltar à hunt — tempo para o jogador ver o nocaute. */
const AUTO_VOLTAR_HUNT_MS = 3000;

function cancelarVoltarHuntAutomatico(p) {
  p.voltarHuntEm = 0;
}

/**
 * Tem com que se sustentar lá fora? Qualquer poção ou revive na bolsa serve.
 *
 * É a TRAVA da volta automática, e não um detalhe de conforto. Sem ela, quem deixa o jogo
 * farmando de madrugada e acaba os itens entra num laço fechado: morre na hunt, a enfermeira
 * cura, a automação devolve o treinador para a MESMA hunt que acabou de matá-lo, e cada volta
 * cobra a perda de XP do nocaute (`aplicarPerdaDeXpTreinador`). Em algumas horas o treinador
 * desce de nível até ficar ABAIXO do mínimo dos próprios pokémon — e aí não há mais nem com
 * que capturar outro, porque `podeUsarPokemon` recusa o time inteiro. Parar a automação é o
 * único desfecho que não deixa a conta pior do que estava.
 *
 * Repara-se na bolsa INTEIRA, e não só nos itens marcados em `reviveIds`/`potionIds`: a
 * pergunta aqui é "sobrou alguma coisa para se curar?", não "a automação vai gastar esta".
 */
function temCuraNaBolsa(p) {
  for (const categoria of ['revive', 'heal']) {
    for (const id of ordemPadraoAutomacao(categoria)) {
      if ((p.items?.[id] ?? 0) > 0) return true;
    }
  }
  return false;
}

function agendarVoltarHuntAutomatico(p) {
  if (!p.automation?.autoVoltarHunt) return;
  if (p.automation?.desistiuHunt) return;
  if (!p.huntSlug || !p.noCentro) return;
  if (!temCuraNaBolsa(p)) {
    // A automação continua LIGADA na tela: o jogador não desligou nada, só ficou sem item.
    // Comprar uma poção e voltar à hunt na mão já basta para a próxima morte reagendar.
    evento(p, { k: 'autoHuntSemItens' });
    return;
  }
  p.voltarHuntEm = agora() + AUTO_VOLTAR_HUNT_MS;
}

/** Automação: cura no Centro e reentra na hunt salva. */
function executarVoltarHuntAutomatico(p) {
  cancelarVoltarHuntAutomatico(p);
  if (!p.automation?.autoVoltarHunt) return false;
  if (p.automation?.desistiuHunt) return false;
  if (!p.huntSlug || !p.noCentro) return false;
  // De novo, e não só no agendamento: entre o nocaute e o disparo cabem 3 s de Market, e
  // vender a última poção nessa janela não pode escapar da trava.
  if (!temCuraNaBolsa(p)) {
    evento(p, { k: 'autoHuntSemItens' });
    return false;
  }
  curarEquipeNoCentro(p);
  if (!entrarNaHunt(p, p.huntSlug)) return false;
  const h = huntJogavelPorSlug.get(p.huntSlug);
  evento(p, { k: 'hunt', slug: p.huntSlug, nome: h?.nome ?? p.huntSlug });
  return true;
}

/**
 * Reflete uma troca de outfit, cor ou nick no boneco — esteja ele onde estiver.
 *
 * As duas cenas em que o jogador aparece como TREINADOR guardam uma cópia da aparência dele
 * (é o que evita reconsultar o jogador a cada quadro), então trocar de roupa precisa avisar
 * as duas. Chamar só a da praça deixava quem comprasse uma cosplay dentro de casa com a roupa
 * velha até sair e voltar.
 */
function refletirAparencia(p) {
  atualizarAparenciaNoCentro(p);
  if (p.casa) atualizarAparenciaNaCasa(p.casa, p);
}

function evento(p, ev) {
  p.eventos.push(ev);
}

/** Grava mensagem de chat público no Postgres — fire-and-forget. */
function persistirChatPublico(msg) {
  chatDb.gravar(msg).catch((err) => console.error('[chat-db] gravar:', err.message));
}

/** Aviso no chat — jogador entrou numa arena PvP. */
function anunciarEntradaArenaPvp(p, arenaId) {
  if (!arenaPorId.has(arenaId)) return;
  const ts = Date.now();
  for (const canal of CANAIS_CHAT) {
    for (const idioma of IDIOMAS_CHAT) {
      const payload = {
        id: randomUUID(),
        canal,
        idioma,
        de: '⚔ PvP',
        ts,
        cargo: 'anuncio',
        pvpEntrada: arenaId,
        nickDestaque: p.nick,
        nivel: null,
      };
      publicar(CANAL_CHAT, payload);
      persistirChatPublico(payload);
    }
  }
}

/** Aviso na tela de todos os jogadores online — captura de shiny. */
function anunciarShinyCapturado(p, pk) {
  if (!pk?.shiny) return;
  const esp = especies.get(pk.speciesId);
  publicar(CANAL_GLOBAL, {
    t: SERVIDOR.SHINY_CAPTURA,
    nick: p.nick,
    looktype: p.looktype,
    vs: empacotarVisual(p.visual),
    pokemon: {
      nome: pk.nome,
      speciesId: pk.speciesId,
      level: pk.level,
      looktype: looktypeShiny(pk.speciesId) ?? esp?.looktype ?? pk.looktype,
    },
  });

  const ts = Date.now();
  for (const canal of CANAIS_CHAT) {
    for (const idioma of IDIOMAS_CHAT) {
      const payload = {
        id: randomUUID(),
        canal,
        idioma,
        de: '✨ Shiny',
        ts,
        cargo: 'shiny',
        nivel: null,
        shinyCaptura: { nick: p.nick, pokemonId: pk.id, nome: pk.nome },
      };
      publicar(CANAL_CHAT, payload);
      persistirChatPublico(payload);
    }
  }
}

/**
 * Aviso no CHAT MUNDO — alguém tirou uma Casa ou Bicicleta Lendária no Professor Carvalho.
 *
 * Só no chat, e não na tela de todo mundo como o shiny: a Lendária é rara, mas o sorteio é um
 * clique numa bancada, e o dourado na conversa basta sem interromper quem está jogando. Uma
 * linha por idioma, como o shiny — cada tela mostra a do seu e monta a frase
 * (`chat.dropLendario`). Aqui vai só o fato: quem, e se foi casa ou bicicleta.
 */
function anunciarDropLendario(p, tipo) {
  if (tipo !== 'casa' && tipo !== 'bicicleta') return;
  const ts = Date.now();
  for (const idioma of IDIOMAS_CHAT) {
    const payload = {
      id: randomUUID(),
      canal: 'mundo',
      idioma,
      de: '👑 Drop',
      ts,
      cargo: 'anuncio',
      nivel: null,
      dropLendario: { nick: p.nick, tipo },
    };
    publicar(CANAL_CHAT, payload);
    persistirChatPublico(payload);
  }
}

/**
 * Aviso no CHAT MUNDO — alguém resgatou um marco do Convide & Ganhe.
 *
 * Só no chat, como o drop Lendário, e pelo mesmo motivo: é uma boa notícia de outra pessoa, e
 * interromper a tela de quem está caçando custa caro demais para isso. Aqui a linha tem um
 * trabalho a mais que as outras — ela é a ÚNICA propaganda do programa dentro do jogo. Quem
 * nunca ouviu falar descobre que existe vendo alguém ganhar.
 *
 * Vai só o FATO (quem, e qual marco); a frase e o nome do prêmio são montados na tela, no idioma
 * de cada um, a partir da MESMA tabela de marcos que o servidor usou para pagar. Mandar o texto
 * pronto daqui obrigaria o servidor a saber o idioma de cada leitor — e faria a frase desandar
 * da escada no primeiro ajuste de prêmio.
 */
function anunciarConviteResgatado(p, marco) {
  if (!marco) return;
  const ts = Date.now();
  for (const idioma of IDIOMAS_CHAT) {
    const payload = {
      id: randomUUID(),
      canal: 'mundo',
      idioma,
      de: '🎟️ Convite',
      ts,
      cargo: 'anuncio',
      nivel: null,
      conviteResgate: { nick: p.nick, marco },
    };
    publicar(CANAL_CHAT, payload);
    persistirChatPublico(payload);
  }
}

/**
 * Marca que o jogador mudou. São DUAS bandeiras de propósito:
 *
 *   `sujo`         falta gravar no Postgres — quem limpa é o write-behind
 *   `aSincronizar` falta mandar para a tela  — quem limpa é o tick, ao enviar
 *
 * Já foi uma só, e dava um bug traiçoeiro: o flush do banco (a cada FLUSH_MS) limpava a
 * bandeira antes de o tick mandar o estado, e a ação simplesmente não aparecia para o
 * jogador. Comprar, vender ou mexer na equipe no instante errado não surtia efeito na tela
 * até a próxima mudança qualquer.
 *
 * As duas querem dizer "falta CAPTURAR", não "falta terminar de gravar/enviar" — quem as
 * limpa faz isso no instante em que tira a fotografia, não depois do await. É por isso que
 * marcar durante um flush em andamento não se perde: a marca cai no conjunto novo. Ver o
 * cabeçalho de `flush()`.
 */
/**
 * Uma lista de ids gravada no jsonb, saneada: só inteiro positivo, sem repetir, no teto.
 * `vazio` é o que volta quando o campo não é lista — `null` quando "nunca escolheu" quer dizer
 * outra coisa que "escolheu nada".
 */
function idsGravados(v, teto, vazio) {
  if (!Array.isArray(v)) return vazio;
  const out = [];
  for (const x of v) {
    const n = Number(x);
    if (Number.isSafeInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    if (out.length >= teto) break;
  }
  return out;
}

/** Quanto tempo um favorito vendido ou retirado continua na aba antes de a leitura podá-lo. */
const FAVORITO_FECHADO_MS = 3 * 24 * 60 * 60_000;

function marcarSujo(p, pk) {
  p.sujo = true;
  p.aSincronizar = true;
  if (pk) p.pokemonsSujos.add(pk.id);
}

// -------------------------------------------------------------- entrar/sair

/**
 * A guild do jogador e o bônus que ela lhe dá.
 *
 * ### O bônus é do TIME, não da lista de membros
 *
 * `guildBonusPct` sai zerado para quem está na guild mas fora da escalação. A guild não tem mais
 * teto de gente (ver `MAX_TIME_GUILD` em `game/guild.mjs`), e sem este corte o bônus de XP e loot
 * do 1º lugar viraria a compra mais barata do jogo: bastaria uma guild campeã aceitar mil
 * convites para mil pessoas farmarem +10% sem nunca terem entrado numa guerra. Quem luta leva —
 * é a mesma régua do diamante do fechamento mensal (`playerIdsEscalados`).
 *
 * `bonusPct` dentro de `p.guild` continua sendo o da GUILD, porque é isso que a tela mostra no
 * painel ("a sua guild está em 1º"). Quem decide o que entra na conta do jogador é
 * `p.guildBonusPct`, e só ele.
 */
async function carregarGuild(p) {
  p.guild = await gdb.guildDoJogador(p.dbId);
  if (p.guild) {
    p.guild.bonusPct = Number(p.guild.bonusPct) || 0;
    p.guild.bonusRank = await gdb.posicaoRankingGp(p.guild.id);
  }
  p.guildBonusPct = p.guild?.escalado ? Number(p.guild.bonusPct) || 0 : 0;
  p.guildBonusRank = Number(p.guild?.bonusRank) || 0;
  p.guildConvites = p.guild ? [] : await gdb.convitesPendentes(p.dbId);
}

/**
 * A POSIÇÃO do jogador na tabela do PvP — e só ela.
 *
 * Já foi `carregarRankingBonus`, e carregava também um bônus de XP e farm por faixa de posição
 * (+5% no topo 1, +1% até o 500º). O bônus saiu: com a temporada mensal premiando em boost, um
 * bônus permanente de farm preso à posição fazia o PvP pagar duas vezes pela mesma coisa — e
 * era a única corda que amarrava a arena ao rendimento da HUNT.
 *
 * A posição continua porque ela não é vitrine: é o que CONCEDE a vaga de Mestre e Challenger
 * (ver `rankComVaga`). Sem ela o emblema da elite não existe.
 */
async function carregarPosicaoPvp(p) {
  p.pvpPosicao = await db.posicaoRankingElo(p.dbId, PVP_PARTIDAS_POSICIONAMENTO);
}

function refrescarPosicaoPvp(p) {
  carregarPosicaoPvp(p)
    .then(() => {
      p.aSincronizar = true;
    })
    .catch(() => {});
}

async function avisarConvitesOnline(dbId) {
  for (const jog of jogadores.values()) {
    if (jog.dbId === dbId) {
      await carregarGuild(jog);
      jog.aSincronizar = true;
      enviar(jog, { t: SERVIDOR.GUILD, convites: jog.guildConvites });
      if (jog.guildConvites.length) evento(jog, { k: 'guildConviteRecebido' });
    }
  }
}

/**
 * Quem pode MEXER na guild pela tela: o dono e o sub-dono.
 *
 * A trava de verdade é do banco (`mandoNaGuild` em `guild-db.mjs`) — esta aqui existe para a
 * recusa sair na hora, sem uma ida ao Postgres para dizer não a um clique que a própria tela
 * já devia ter escondido. As três ações que continuam sendo só do dono (apagar, transferir,
 * nomear sub-dono) checam `isOwner` direto.
 */
const podeGerirGuild = (p) => !!(p.guild?.isOwner || p.guild?.isSubdono);

async function recarregarGuildOnline(guildId) {
  for (const jog of jogadores.values()) {
    if (jog.guild?.id === guildId || !jog.guild) {
      await carregarGuild(jog);
      jog.aSincronizar = true;
    }
  }
}

// -------------------------------------------------------------- lista de amigos

/** Recarrega a lista de amigos e os pedidos pendentes do jogador (do banco). */
async function carregarAmigos(p) {
  if (!p.dbId) return;
  p.amigos = await amigosDb.listaDeAmigos(p.dbId);
  p.amigosPedidos = await amigosDb.pedidosPendentes(p.dbId);
  await marcarAmigosOnline(p.amigos);
}

/**
 * Carimba `.online` em cada amigo com UMA consulta de presença (`hmget`) para a lista toda —
 * a mesma tabela `presenca` do Redis que o `/saude` e o sussurro usam.
 */
async function marcarAmigosOnline(lista) {
  if (!lista?.length) return;
  try {
    const nicks = lista.map((a) => String(a.nick).toLowerCase());
    const gws = await pub.hmget(PRESENCA, ...nicks);
    lista.forEach((a, i) => {
      a.online = !!gws[i];
    });
  } catch {
    // sem presença, a lista sai sem o pontinho verde — não é motivo para falhar a carga
  }
}

/**
 * Nível 10 para adicionar amigo, mandar DM e transferir coins — a mesma trava do chat
 * (`CHAT_NIVEL_MIN`), contra bot de conta nova mirando novato. Avisa e devolve `true` se
 * estiver travado.
 */
function amigoTravadoPorNivel(p) {
  if (p.admin || (p.level ?? 0) >= CHAT_NIVEL_MIN) return false;
  evento(p, { k: 'aviso', msg: 'amigos.nivelMinimo' });
  return true;
}

/** Traduz um erro do `amigos-db` para uma chave i18n; erro inesperado vira genérico. */
const msgErroAmigo = (err) =>
  err instanceof amigosDb.ErroAmigo ? err.message : 'amigos.erroGenerico';

/**
 * Um id de banco vindo do CLIENTE: aceita só inteiro positivo dentro do range seguro. Barra
 * `NaN`, `Infinity`, negativo, fração, notação científica gigante e string com lixo — tudo
 * que faria o Postgres cuspir erro de range ou uma consulta abrir onde não devia.
 */
const idClienteValido = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER;
};

/** Jogador em memória neste shard pelo id do banco, ou `undefined`. */
const jogadorPorDbId = (dbId) => {
  for (const j of jogadores.values()) if (j.dbId === dbId) return j;
  return undefined;
};

/**
 * Empurra uma mensagem para um jogador online em QUALQUER shard, sem ida ao worker dono dele
 * — o mesmo caminho ponto a ponto do sussurro (`gateway.mjs`): a presença diz em que gateway
 * o socket está e o publish vai só para aquele canal. `null` se ele estiver offline.
 */
async function entregarAoOnline(nick, msg) {
  const chave = String(nick ?? '').toLowerCase();
  if (!chave) return false;
  const gw = await gatewayDoJogador(chave);
  if (!gw) return false;
  publicar(canalGateway(gw), { para: chave, msg });
  return true;
}

/**
 * Avisa o shard dono de `alvoNick` que o grafo de amizade dele mudou. Aquele shard, se tiver
 * o jogador em memória, recarrega a lista e empurra pela rota normal (mais um toast). É o
 * gêmeo de `avisarConvitesOnline` para quem pode estar noutro shard.
 */
function avisarAmigoSync(alvoNick, aviso = null, extra = {}) {
  const chave = String(alvoNick ?? '').toLowerCase();
  if (!chave) return;
  publicar(canalSim(shardDoJogador(chave)), { t: 'amigos.sync', alvoNick: chave, aviso, ...extra });
}

// -------------------------------------------------------------- PvP amistoso

/** O texto da linha da conversa de um convite: o id, quem e o estado. É JSON, lido pela bolha. */
const textoDoConvite = (convite, estado, extra = {}) => JSON.stringify({
  cid: convite.id,
  de: convite.deNick,
  para: convite.paraNick,
  expiraEm: convite.expiraEm,
  estado,
  ...extra,
});

/** O que a tela do amistoso precisa saber de MIM: a espera e o convite que mandei. */
async function estadoAmistoso(p) {
  const [esperaMs, saida] = await Promise.all([
    pvpAmistoso.msDeEspera(p.key),
    pvpAmistoso.conviteDeSaida(p.key),
  ]);
  return {
    esperaAte: esperaMs > 0 ? agora() + esperaMs : 0,
    saida: saida ? { id: saida.id, para: saida.paraNick, expiraEm: saida.expiraEm } : null,
  };
}

/**
 * Fecha a bolha do convite na conversa (aceito, recusado, cancelado, falhou) e avisa os dois.
 * A linha no banco é reescrita — é o que faz o estado sobreviver a um F5.
 */
async function fecharConviteNaConversa(convite, estado, extra = {}) {
  if (!convite?.dmId || !convite.deNick || !convite.paraNick) return;
  const texto = textoDoConvite(convite, estado, extra);
  try {
    await amigosDb.atualizarConviteDM(convite.dmId, texto);
  } catch (err) {
    console.error('[pvp-amistoso] atualizar a conversa falhou:', err.message);
    return;
  }
  const linha = { id: convite.dmId, texto };
  entregarAoOnline(convite.deNick, { t: SERVIDOR.AMIGOS, dmAtualizada: linha }).catch(() => {});
  entregarAoOnline(convite.paraNick, { t: SERVIDOR.AMIGOS, dmAtualizada: linha }).catch(() => {});
}

/**
 * A linha da conversa de um convite JÁ CONSUMIDO, achada pelo id dentro do texto. Só é usada
 * quando a luta falha depois do consumo (sem equipe), e só entre as conversas deste jogador.
 */
async function conviteDaConversa(p, cid) {
  try {
    const { rows } = await db.pool.query(
      `SELECT id, texto FROM dm_mensagens
        WHERE tipo = 3 AND para_id = $1 AND criado_em > now() - interval '1 hour'
          AND texto LIKE $2
        ORDER BY id DESC LIMIT 1`,
      [p.dbId, `%"cid":"${cid}"%`],
    );
    if (!rows[0]) return {};
    const o = JSON.parse(rows[0].texto);
    return { dmId: Number(rows[0].id), deNick: o.de, paraNick: o.para, expiraEm: o.expiraEm };
  } catch {
    return {};
  }
}

async function entrar({ playerId, nick, gatewayId, admin, chatCargo = null, delta = false, ip = null }) {
  let p = jogadores.get(playerId);
  if (p) {
    // O IP é relido a cada conexão pelo mesmo motivo do gateway e do cargo: quem manda é o
    // socket de AGORA. Sem isto, trocar de rede no meio de uma sessão longa deixaria a fila
    // do PvP comparando o endereço de horas atrás.
    p.ip = ip ?? p.ip ?? null;
    // reconexão: só reaponta o gateway, o estado continua vivo
    //
    // Se o jogador estava em CARÊNCIA (o socket tinha caído fora do PvP), esta é a volta
    // que a janela esperava: limpa o carimbo e ele retoma de onde parou, sem ter perdido
    // equipe nem XP. Ver `GRACA_DESCONEXAO_MS`.
    p.desconectadoEm = 0;
    p.gatewayId = gatewayId;
    // Relido a cada conexão: o jogador pode ter voltado com o cliente atualizado (ou com um
    // ainda em cache), e quem manda é sempre o socket de AGORA.
    p.aceitaDelta = !!delta;
    p.admin = !!admin;
    p.chatCargo = chatCargo || null;
    // FECHA O PORTÃO até o welcome desta conexão sair. O socket é novo, e com ele o mesclador
    // de estado do cliente nasce VAZIO: um delta que chegasse antes do welcome seria fundido
    // no nada e produziria um `estado.eu` sem metade dos campos. Ver `p.welcomeEnviado`.
    p.welcomeEnviado = false;
    // As releituras saem ao mesmo tempo, como no login novo (ver o comentário mais abaixo, em
    // `entrar`) — e, como lá, casas e depois bicicletas continuam em fila no mesmo ramo.
    await Promise.all([
      carregarGuild(p),
      carregarAmigos(p).catch((err) => console.error('[amigos] sync na reconexão:', err.message)),
      carregarPosicaoPvp(p),
      // O rank do PvP é do banco, não da memória — reconectar tem de relê-lo, senão a ficha do
      // treinador mostraria o emblema de antes das partidas jogadas noutra aba.
      pvpdb.rankDe(p.dbId).then(
        (rank) => {
          p.pvpRank = rank;
        },
        () => {
          p.pvpRank = p.pvpRank ?? null;
        },
      ),
      // Diamantes/gemas vivem no ledger — reconectar não relê o banco sozinho; sem isto a
      // comissão de indicação aparece na aba mas o HUD fica com o cache velho até a varredura.
      sincronizarMoedasPagas(p).catch((err) => console.error('[moedas] sync na reconexão:', err.message)),
      carregarDiamantesComprados(p).catch((err) => console.error('[beta] diamantes comprados na reconexão:', err.message)),
      // As caixas também vivem fora do flush (tabela própria): sem esta releitura, uma compra
      // feita noutra aba não apareceria na bolsa até o próximo login.
      carregarCaixas(p).catch((err) => console.error('[caixas] sync na reconexão:', err.message)),
      (async () => {
        // As casas, pelo mesmo motivo: uma vendida no Mercado enquanto a aba estava fechada.
        await carregarCasas(p).catch((err) => console.error('[casas] sync na reconexão:', err.message));
        await carregarBicicletas(p).catch((err) => console.error('[bicicletas] sync na reconexão:', err.message));
        // Devolução cujo aviso não chegou: o F5 é onde o jogador vai procurar o pokémon. Sem
        // `await` — ela passa pela fila de economia, e o welcome não espera por ela.
        entregarDevolucoes(p);
      })(),
    ]);
    enviarWelcome(p);
    // o campo não é reconstruído: o cliente novo recebe o que já está em andamento
    const membro = membroDoCentro(p);
    if (membro) {
      // O boneco continua na sala em que estava, na tile em que parou — a aba nova só recebe a
      // praça inteira de novo. Mas a tecla que ele segurava morreu junto com o socket antigo:
      // sem zerar, o treinador voltaria andando sozinho para sempre.
      andarNoCentro(p, 0);
      enviar(p, { t: SERVIDOR.CAMPO_INIT, ...snapshotDoCentro(membro.sala, membro) });
    } else if (p.campo) {
      enviar(p, { t: SERVIDOR.CAMPO_INIT, ...snapshotCampo(p.campo) });
    }
    return;
  }

  // A sessão anterior pode estar gravando ainda (F5 rápido). Ler antes dela terminar
  // traria o estado de segundos atrás — e a sessão nova gravaria esse estado velho depois.
  await flushPendente.get(playerId)?.catch(() => {});

  const { jogador, pokemons, anunciados } = await db.carregarOuCriarJogador(nick);
  p = {
    key: playerId, // chave de roteamento (nick minúsculo)
    dbId: Number(jogador.id),
    nick: jogador.nick,
    gatewayId,
    admin: !!admin,
    chatCargo: chatCargo || null,
    // Só a fila do PvP ranqueado o usa, e só para comparar com o de outro candidato — nunca
    // é gravado, nunca sai deste processo em claro (ver `resumoDeIp`).
    ip: ip ?? null,
    /**
     * O jogador já recebeu o `welcome` desta conexão?
     *
     * Enquanto for `false`, NENHUM pacote de estado sai — nem pelo tick, nem por handler.
     *
     * Existe por uma corrida real, que aparecia como `Cannot read properties of undefined` na
     * tela do jogador: `jogadores.set` acontece bem ANTES de `enviarWelcome`, e entre os dois
     * há meia dúzia de idas ao banco (guild, amigos, rank, caixas, moedas pagas). Nessa janela
     * o tick já enxerga o jogador, e qualquer coisa que marque sujo ali — um pagamento do
     * Mercado entregue no login, por exemplo — despachava um DELTA para um cliente cujo
     * mesclador ainda estava vazio. O resultado era um `estado.eu` pela metade, e a primeira
     * função de desenho que topasse com um campo ausente derrubava a tela.
     */
    welcomeEnviado: false,
    /**
     * MODO ECONOMIA: este cliente pediu para NÃO receber o campo (`cliente.economia`).
     *
     * Mora no jogador e não no socket porque o jogador sobrevive à carência de reconexão — e
     * porque é o `enviar` que o lê. Toda aba reanuncia a própria escolha logo depois do
     * `welcome`, então uma aba nova nunca herda o silêncio da anterior.
     */
    semCampo: false,
    level: jogador.level,
    xp: Number(jogador.xp),
    gold: Number(jogador.gold),
    diamonds: Number(jogador.diamonds ?? 0),
    // ORB é a moeda com lastro em USDT. Ao contrário do resto do estado, ela NÃO passa pelo
    // write-behind: quem manda é o ledger em `orbs-db.mjs`, e isto aqui é só o cache da tela.
    orbs: Number(jogador.orbs ?? 0),
    // ORB é a moeda com lastro em USDT. Ao contrário do resto do estado, ela NÃO passa pelo
    // write-behind: quem manda é o ledger em orbs-db.mjs, e isto aqui é só o cache da tela.
    orbs: Number(jogador.orbs ?? 0),
    huntSlug: jogador.hunt_slug,
    /**
     * Em qual Outland ele caça. Passa por `tierOutlandValido` na LEITURA porque a
     * linha do banco pode estar à frente do nível de hoje — um rebalanceamento que suba o
     * degrau da Outland 5 tem de valer para quem já a tinha escolhida, e a conta do drop não
     * pode depender de alguém lembrar de rodar um UPDATE. Ver `shared/outland-tiers.mjs`.
     */
    outlandTier: tierOutlandValido(jogador.outland_tier ?? OUTLAND_TIER_PADRAO, jogador.level),
    // "Ainda precisa escolher o inicial", ligada em massa pelo reset do fim do beta. Não passa
    // pelo flush: quem a apaga é `db.limparResetStarter`, no instante em que o starter nasce.
    resetStarter: !!jogador.reset_starter,
    activeId: jogador.active_poke ? Number(jogador.active_poke) : null,
    items: jogador.items ?? {},
    balls: jogador.balls ?? { 1: 100 },
    // Os padrões cobrem o que ainda não está gravado: uma conta criada antes de `reviveIds`,
    // `potionIds` e `hpLimiar` existirem entra com lista vazia ("qualquer item") e o limiar
    // do meio, que é o comportamento que ela já tinha.
    automation: {
      autoBallAteCapturar: false, autoBallSemParar: false, ballIds: [1],
      // LIGADAS de nascença, com os itens já marcados (`idsPadraoDeCuidado`). Cuidar do próprio
      // pokémon não é uma estratégia que o jogo oferece — é o piso para a hunt não parar, e
      // deixá-lo desligado era cobrar de quem acabou de chegar a descoberta de um painel que ele
      // ainda nem sabe que existe. Quem não quiser desliga; o contrário custava horas de hunt
      // parada antes de alguém perceber.
      autoRevive: true, reviveIds: idsPadraoDeCuidado('revive'),
      autoPotion: true, potionIds: idsPadraoDeCuidado('heal'),
      hpLimiar: LIMIAR_HP_PADRAO,
      lootTravado: [],
      pokemonTravado: [],
      autoVendaLoot: false,
      autoVendaLootAvisoVisto: false,
      pvpAutoFila: false,
      autoLockShiny: true,
      autoLockNota9: false,
      autoLockNotaMin: AUTO_LOCK_NOTA_MIN,
      // O NÚMERO da bicicleta equipada (null = a pé). Ver `game/bicicletas.mjs`.
      bicicletaEquipada: null,
      // A raridade da casa que era EQUIPADA antes das casas numeradas. Não manda em mais nada:
      // só diz em que casa pôr a escalação antiga do XP Share (ver `aplicarXpShareLegado`).
      casaEquipada: null,
      // Quando foi a última troca de bicicleta (0 = nunca). Espera 5 min.
      bicicletaTrocadaEm: 0,
      // As casas EM USO (números), no máximo `MAX_CASAS_EM_USO`. `null` = nunca escolheu: vale a
      // escolha padrão, e o primeiro carregamento das casas a grava. Ver `game/casas.mjs`.
      casasEmUso: null,
      // Os anúncios que o jogador marcou com a estrela no Mercado da Comunidade.
      mercadoFavoritos: [],
      autoLockP5: false,
      // Pelo mesmo motivo — e com a trava de sempre: a volta só acontece se houver cura na
      // bolsa (`temCuraNaBolsa`), então ligar isto por padrão não cria o laço de morrer, voltar
      // e perder XP sem parar.
      autoVoltarHunt: true,
      desistiuHunt: false,
      morteXpCobrada: false,
      pokedexOutlandV2: false,
      bossKills: {},
      ...(jogador.automation ?? {}),
      // O que vem do BANCO passa pelo mesmo filtro do que vem do cliente. Validar só na
      // escrita deixaria de pé a preferência de bolas que já está gravada — ela voltaria
      // inteira no login e seguiria custando as duas varreduras por tick, para sempre. Aqui
      // ela é limpa na carga e o flush seguinte grava a versão sã por cima.
      ballIds: idsDeBola(jogador.automation?.ballIds),
      // A nota do Auto Lock pelo mesmo filtro: um valor torto no jsonb (texto, fora de 0–10)
      // volta ao padrão, em vez de trancar a coleção inteira ou não trancar nada.
      autoLockNotaMin: notaAutoLockValida(jogador.automation?.autoLockNotaMin) ?? AUTO_LOCK_NOTA_MIN,
      // A bicicleta equipada, pelo mesmo filtro: o número — ou, de antes da numeração, a raridade, que
      // `resolverEquipadaLegada` troca pelo número quando as bicicletas chegam. O resto volta a `null`.
      bicicletaEquipada: equipadaGravada(jogador.automation?.bicicletaEquipada),
      // A casa que era equipada, pelo mesmo filtro — só `aplicarXpShareLegado` a lê.
      casaEquipada: raridadeCasaValida(jogador.automation?.casaEquipada),
      bicicletaTrocadaEm: instanteGravado(jogador.automation?.bicicletaTrocadaEm),
      // As duas listas de ids pelo mesmo filtro. Se a casa ainda é da conta quem confere é
      // `fixarCasasEmUso`, na hora em que as casas chegam do banco.
      casasEmUso: idsGravados(jogador.automation?.casasEmUso, MAX_CASAS_EM_USO, null),
      mercadoFavoritos: idsGravados(jogador.automation?.mercadoFavoritos, mdb.MAX_FAVORITOS, []),
    },
    pokedex: (() => {
      let raw = jogador.pokedex ?? {};
      if (!jogador.automation?.pokedexOutlandV2) {
        raw = migrarChavesPokedexLegado(raw);
      }
      return normalizarEntradasPokedex(raw);
    })(),
    pokemons: new Map(),
    escolhendoStarter: false, // trava enquanto o insert do starter escolhido não volta
    noCentro: false, // no Centro Pokémon (por morte ou por visita)
    centroMotivo: null,
    voltarHuntEm: 0,
    // Carimbo (ms) de quando o socket caiu fora do PvP, 0 = conectado. Enquanto != 0 o
    // jogador está congelado esperando reconexão — ver `GRACA_DESCONEXAO_MS` e `sair`.
    desconectadoEm: 0,
    // A sala da praça em que ele está, e os slots do boneco e do pokémon lá dentro. Como a
    // arena PvP, isto NÃO é gravado: quem cai da conexão volta para a hunt de sempre.
    centro: null,
    // Boss: os pontos são gravados; ESTAR numa arena, não. Quem cai da conexão no meio da
    // luta volta para a hunt — a arena é uma ida, não um lugar onde se mora.
    bossPoints: jogador.boss_points ?? 0,
    boss: null,
    // PvP: ELO e placar são gravados; ESTAR numa arena, não — quem cai da conexão dentro da
    // arena volta para a hunt. O cooldown TAMBÉM é gravado, senão bastaria um F5 para zerar
    // os 5 minutos e voltar na hora para segurar alguém em combate.
    elo: jogador.elo ?? ELO_INICIAL,
    pvpAbates: jogador.pvp_abates ?? 0,
    pvpMortes: jogador.pvp_mortes ?? 0,
    pvpCooldownAte: Number(jogador.pvp_cooldown_ate ?? 0),
    compartilharPkAte: 0,
    pvp: null,
    // ---- Loja VIP ----
    // Boosts, VIP e bênção são carimbos de tempo (ou um id), então cabem no jsonb sem
    // tabela própria. O relógio é o do servidor: um cliente adiantado não estica boost.
    vipAte: Number(jogador.vip_ate ?? 0),
    boosts: jogador.boosts ?? {}, // { xp: ateMs, pokexp: …, loot: …, captura: …, shiny: … }
    boostsHoje: jogador.boosts_hoje ?? {}, // { xp: { dia: '2026-08-03', n: 3 } }
    bless: jogador.bless ?? null,
    comprasCooldown: jogador.compras_cooldown ?? {},
    passe: normalizarPasse(jogador.passe),
    gender: jogador.gender ?? 'male',
    looktype: jogador.looktype ?? 159,
    ownedOutfits: jogador.owned_outfits ?? [],
    // O boneco: as seis cores escolhidas no onboarding e a trava que fecha a customização
    // depois dele. Quem já jogava antes desta versão entra com `visual_ok` false e passa uma
    // vez pelo editor — é o mesmo caminho de quem chega agora, e ninguém fica sem escolher.
    visual: normalizarVisual(jogador.visual),
    visualOk: !!jogador.visual_ok,
    // A última troca de avatar. Vem do banco (e não da memória) porque a trava de 24 h tem de
    // valer entre sessões — é justamente quem fechou o jogo que ela precisa alcançar.
    visualTrocadoEm: Number(jogador.visual_trocado_em ?? 0),
    perfilStatsPublico: jogador.perfil_stats_publico !== false,
    /** Os pokémon escolhidos para a vitrine da ficha (`[pokemonId, …]`). Ver `MAX_VITRINE`. */
    vitrine: normalizarIdsVitrine(jogador.vitrine),
    tutorialVisto: !!jogador.tutorial_visto,
    discordPopCampanha: Number(jogador.discord_pop_campanha ?? (jogador.discord_pop_dispensado ? 1 : 0)),
    /** Último AVISO DE MUDANÇA fechado — ver `shared/aviso-jogo.mjs`. */
    avisoVisto: Number(jogador.aviso_visto ?? 0),
    // Fragmentos de Chave que esta CONTA já obteve na vida (drop + loja). Só cresce; é número
    // histórico e NÃO trava nada — Fragmento de Chave não tem teto por conta (ver `db.mjs`).
    fragChaveTotal: Number(jogador.frag_chave_total ?? 0),
    /**
     * Quantas Exp. Share esta conta COMPROU na Loja — o direito dela, contra o qual a bolsa e
     * os `held_item_id` são conferidos logo abaixo (`conferirXpShareHeld`). Só a Loja soma;
     * nada subtrai, porque o item não vende ao NPC, não se destrói e não muda de dono.
     */
    xpShareTotal: Number(jogador.xp_share_total ?? 0),
    /**
     * Os postos de XP SHARE: `{ porCasa: { [número da casa]: [pokemonId | null, ...] } }`, um
     * posto por boneco de cada casa. `legado` é a lista da época da casa equipada, guardada até
     * as casas chegarem do banco e ela ir para a casa certa (ver `aplicarXpShareLegado`).
     *
     * SOBREVIVE ao logout (coluna `players.xp_share`), e isso não reabre a porta do farm
     * off-line: sem hunt rodando não há XP para repartir. O que a coluna guarda é uma
     * ESCALAÇÃO — o mesmo tipo de ajuste que a automação —, e refazê-la a cada login seria
     * atrito puro. Ids que já não valem são limpos na leitura (ver `limparXpShareInvalido`).
     */
    xpShare: normalizarXpShare(jogador.xp_share),
    /**
     * As casas do jogador (`[{ id, raridade, anunciada, criadaEm, criador }]`), ou `null` até
     * `carregarCasas` trazê-las do banco. `null` não é `[]`: ver `limparXpShare`.
     */
    casas: null,
    /** A virada anotou casas convertidas desta conta, e este login ainda não conferiu a bolsa. */
    casasLegadoPendente: Object.keys(jogador.casas_legado ?? {}).length > 0,
    // O mesmo aviso, para as bicicletas numeradas — ver `bicicletas-db.mjs`.
    bicicletasLegadoPendente: Object.keys(jogador.bicicletas_legado ?? {}).length > 0,
    /** A sala da casa em que o jogador está DENTRO agora (com o `casaId` dela), ou null. */
    casa: null,
    campo: null, // área andável + quem anda nela (montado ao entrar numa hunt)
    // Quando a repetição automática de boss entra na próxima arena (0 = nada agendado). Só
    // memória de propósito: a VONTADE está em `automation.bossAuto`, que sobrevive ao logout;
    // um agendamento pendente de um processo que caiu não deve ressuscitar sozinho.
    bossAutoEm: 0,
    selvagem: null, // o mob ENCOSTADO no herói agora — uma referência para dentro do campo
    proxAtaqueJogador: 0,
    proxAtaqueSelvagem: 0,
    // Carimbo do último DANO trocado numa hunt (dado ou recebido). É o que trava o botão de
    // subir ao Centro por 3 s — e o que define "estar em combate" fora da arena PvP.
    emCombateAte: 0,
    // Última onda em que houve dano. Enquanto `combateOndaSeq < campo.ondaSeq`, a saída fica
    // livre mesmo com selvagens vivos — evita ficar preso no respawn sem ter entrado em luta.
    combateOndaSeq: 0,
    proxBola: 0,
    cdGolpes: {}, // cooldown por golpe do pokémon ativo
    eventos: [],
    sujo: false,
    aSincronizar: false,
    pokemonsSujos: new Set(),
    ultimoEstadoEnviado: 0,
    // Baseline do estado que já chegou na TELA deste jogador — o que permite mandar só o
    // delta. Nasce vazio, então o primeiro pacote da sessão sai completo. Ver
    // `estadoParaEnviar`; para esquecer tudo e remandar o quadro, `zerarBaselineDeTela`.
    // Se ESTE cliente sabe remontar o estado em delta (ver o `hello` em `app.js`). Um
    // cliente que não anunciou continua recebendo o quadro inteiro, como antes.
    aceitaDelta: !!delta,
    telaCampos: null,
    telaPokemons: null,
    telaDex: null,
    // Quando o próximo quadro CHEIO sai por segurança — ver `SINCRONIA_CHEIA_MS`.
    proximaTelaCheia: 0,
  };

  for (const row of pokemons) {
    const pk = montarPokemon(row);
    p.pokemons.set(pk.id, pk);
  }
  limparPokedexFantasmaUnova(p);
  sincronizarPokedexDoTime(p);
  if (limparColecao(p, anunciados)) marcarSujo(p);
  if (!jogador.automation?.pokedexOutlandV2) {
    p.automation.pokedexOutlandV2 = true;
    marcarSujo(p);
  }
  if (p.automation.autoLockShiny && [...p.pokemons.values()].some((k) => k.shiny)) {
    travarTodosShinys(p);
    marcarSujo(p);
  }
  if (p.automation.autoLockNota9) {
    travarTodosNota9(p);
    marcarSujo(p);
  }
  if (p.automation.autoLockP5) {
    travarTodosP5(p);
    marcarSujo(p);
  }
  if (!p.activeId || !p.pokemons.has(p.activeId) || !podeUsarPokemon(p, p.pokemons.get(p.activeId))) {
    p.activeId = escolherAtivoUtilizavel(p);
  }

  conferirXpShareHeld(p);

  const legadoBandAid = Number(p.items?.[59248] ?? 0);
  if (legadoBandAid) {
    p.items[BEAST_BALL.id] = (p.items[BEAST_BALL.id] ?? 0) + legadoBandAid;
    delete p.items[59248];
    marcarSujo(p);
  }

  jogadores.set(p.key, p);
  // As cargas de fora do flush saem TODAS AO MESMO TEMPO.
  //
  // Nenhuma lê o que a outra escreve — guild, amigos, PvP, caixas, casas e moedas mexem cada uma nos
  // seus campos —, e em fila eram ~15 idas ao banco uma atrás da outra. Um login sozinho mal sente
  // (~1 ms cada), mas numa LEVA de logins (deploy, queda de uma operadora) cada ida em sequência é
  // mais uma espera na fila do pool: com 150 entrando juntos, o welcome passava de 1,2 s.
  //
  // O que tem ordem continua em fila, dentro do mesmo ramo: as BICICLETAS depois das CASAS (as duas
  // mexem na bolsa, e a das bicicletas relê a velocidade na praça, que a das casas pode mudar); e
  // pagamentos, coins e prêmio só depois das duas, porque `entregarPagamentos` confere as casas e
  // bicicletas anunciadas.
  //
  // Guild e posição do PvP seguem sem `.catch`, como antes: se uma delas falhar, o login para sem
  // welcome. A diferença é que as cargas já em andamento terminam em segundo plano.
  await Promise.all([
    carregarGuild(p),
    carregarAmigos(p).catch((err) => console.error('[amigos] carga no login:', err.message)),
    carregarPosicaoPvp(p),
    // O rank do PvP: uma leitura por login. A linha nasce aqui para quem nunca jogou ranqueado,
    // o que faz `pvp_rank` ter sempre a linha pronta quando o pareador for escrevê-la.
    pvpdb.rankDe(p.dbId).then(
      (rank) => {
        p.pvpRank = rank;
      },
      (err) => {
        console.error('[pvp] rank do login falhou:', err.message);
        p.pvpRank = null;
      },
    ),
    // As Caixas de Fundador (bolsa + tags) e a reconciliação do armário. Antes do `welcome`:
    // é ele que leva a outfit e a tag para a tela.
    carregarCaixas(p).catch((err) => console.error('[caixas] carga no login:', err.message)),
    (async () => {
      // As CASAS numeradas e a escalação do XP Share. Antes do `welcome`, pelo motivo das caixas: o
      // primeiro quadro da tela já sai com a lista.
      await carregarCasas(p).catch((err) => console.error('[casas] carga no login:', err.message));
      // As BICICLETAS numeradas, pelo mesmo motivo — e antes do primeiro passo, que lê a equipada.
      await carregarBicicletas(p).catch((err) => console.error('[bicicletas] carga no login:', err.message));
      // O que foi vendido enquanto ele estava fora. Tem de ser DEPOIS do `jogadores.set` —
      // `entregarPagamentos` mexe no jogador em memória e marca sujo.
      entregarPagamentos(p).catch((err) => console.error('[market] pagamentos no login:', err.message));
      // O que voltou de anúncio fechado pelo servidor enquanto ele estava fora — o item, e o aviso.
      entregarDevolucoes(p);
      // Coins que amigos mandaram enquanto ele estava fora (ou noutro shard).
      entregarCoinsDeAmigos(p).catch((err) => console.error('[amigos] coins no login:', err.message));
      // O prêmio da temporada de PvP que virou enquanto ele estava fora.
      entregarPremiosDaTemporada(p).catch((err) => console.error('[pvp] prêmio no login:', err.message));
    })(),
    // Compras, comissões de indicação e votos do TopIdle — tudo que credita fora do flush.
    sincronizarMoedasPagas(p).catch((err) => console.error('[moedas] sync no login:', err.message)),
    carregarDiamantesComprados(p).catch((err) => console.error('[beta] diamantes comprados no login:', err.message)),
  ]);

  // Todo login começa na praça do Centro Pokémon, nunca na hunt em que o jogador parou.
  //
  // São duas razões, e a segunda é a que manda. A primeira é de jogo: o Centro é o lugar de
  // encontro, e passar por ele é o que faz a praça ter gente. A segunda é a que fecha a regra
  // de `punirAbandonoDaLuta` — se o login devolvesse o jogador para dentro da luta, fechar a
  // aba continuaria valendo a pena: ele voltaria exatamente onde estava, sem custo nenhum.
  //
  // A hunt escolhida NÃO é esquecida: `p.huntSlug` continua gravado, o Mapa mostra qual é, e
  // um clique volta para lá. O que se perde é o tempo da volta — que é justamente o preço.
  //
  // A ORDEM aqui importa: o jogador é POSTO no Centro antes do `welcome` (senão o primeiro
  // snapshot diria que ele está numa hunt, e a tela abriria no HUD errado por um quarto de
  // segundo), mas a CENA só vai depois — o cliente monta o campo ao receber o `welcome`, e um
  // `campo.init` antes disso cairia no vazio.
  const equipe = [...p.pokemons.values()].filter((k) => k.slot != null);
  const timeNoChao = equipe.length > 0 && equipe.every((k) => k.hp <= 0);
  const noCentro = irParaOCentro(p, timeNoChao ? 'morte' : 'visita', {
    cena: false,
    xpJaCobrado: !!p.automation?.morteXpCobrada,
  });

  enviarWelcome(p);

  if (p.automation?.autoVoltarHunt && p.huntSlug && p.noCentro && !p.automation?.desistiuHunt) {
    agendarVoltarHuntAutomatico(p);
  }

  const membro = noCentro && membroDoCentro(p);
  if (membro) enviar(p, { t: SERVIDOR.CAMPO_INIT, ...snapshotDoCentro(membro.sala, membro) });
  else if (p.huntSlug && !entrarNaHunt(p, p.huntSlug)) p.huntSlug = null;
}

/**
 * Os starters, ou `null` se este treinador já tem pokémon.
 *
 * Antes o servidor sorteava um dos três e pronto. Agora quem escolhe é o jogador, então o
 * treinador nasce SEM pokémon e fica esperando o `starter.pick` — é por isso que o `welcome`
 * precisa dizer que a escolha está pendente.
 */
function ofertaDeStarter(p) {
  // `resetStarter` fura a regra do "tem pokémon, então já escolheu". Depois do reset do fim do
  // beta quem guardou um shiny no Depot TEM pokémon e mesmo assim nunca escolheu inicial
  // NESTE mundo — sem esta linha, justamente quem mais jogou o beta entraria no lançamento sem
  // starter, sem kit inicial e sem ninguém em campo. Ver `tools/reset-beta.mjs`.
  if (p.pokemons.size && !p.resetStarter) return null;
  return STARTERS.map((id) => {
    const e = especies.get(id);
    return { speciesId: id, nome: e.name, looktype: e.looktype, tipos: [e.type1, e.type2].filter(Boolean) };
  });
}

/** Cria o starter escolhido e o kit inicial (o original dá 100 poções e 100 bolas). */
async function darStarter(p, speciesId) {
  const pk = await criarPokemon(p, speciesId, 5, xpTotalParaNivel(5), false, true);
  // O starter nasce na equipe, mas só entra em campo de verdade com o mesmo caminho de
  // `team.active` — senão a praça fica sem pet atrás do dono e a hunt começa sem herói.
  ativarPokemon(p, pk);

  /**
   * O item mais barato de uma categoria **entre os que têm preço**.
   *
   * O `> 0` não é zelo: sem ele o vencedor era a **Medicine** (`npcPrice: 0`), e todo treinador
   * novo saía com 100 dela em vez das 100 Small Potion que o comentário acima promete. Pior:
   * Medicine não está à venda em lugar nenhum — preço zero é o que marca isso no catálogo, e é
   * o mesmo motivo pelo qual o Market não a vende (ver `shop.buy`) —, então o kit inicial era
   * um item que, gasto, não dava para repor.
   *
   * É a mesma armadilha do `priceNpc = 0` das espécies (ver `PRECO_MAIS_RARO`): no catálogo,
   * preço zero quer dizer "não está à venda", nunca "de graça".
   */
  const maisBarato = (cat) =>
    [...itens.values()]
      .filter((i) => i.category === cat && (i.npcPrice ?? 0) > 0)
      .sort((a, b) => a.npcPrice - b.npcPrice)[0];
  const pocao = maisBarato('heal');
  const revive = maisBarato('revive');
  if (pocao) p.items[pocao.id] = 100;
  if (revive) p.items[revive.id] = 20;

  // A bandeira do reset cai AQUI, com o starter já inserido — e direto no banco, fora do
  // write-behind. Se caísse antes, um erro no INSERT deixaria o jogador sem inicial e sem
  // direito a pedir outro.
  if (p.resetStarter) {
    p.resetStarter = false;
    db.limparResetStarter(p.dbId).catch((err) =>
      console.error('[sim] falha ao baixar reset_starter:', err.message));
  }

  marcarSujo(p);
  evento(p, { k: 'starter', nome: pk.nome, level: pk.level });
  enviarEstado(p);
}

async function criarPokemon(p, speciesId, nivel, xp, shiny = false, ehStarter = false) {
  const esp = especies.get(speciesId);
  // O starter tem piso de qualidade e de IV (`rolarStarter`); capturado usa o roll livre.
  const rolagem = ehStarter ? rolarStarter() : null;
  const quality = rolagem ? rolagem.quality : rolarQualidade();
  const ivs = rolagem ? rolagem.ivs : shiny ? rolarIVsShiny() : rolarIVs();
  // A roleta de potência gira AQUI, uma vez, e o resultado acompanha o pokémon para sempre.
  // O starter fica de fora: ele já tem piso de qualidade e de IV (`rolarStarter`) justamente
  // para nascer jogável, e sortear uma potência 1 no primeiro pokémon de alguém é começar o
  // jogo devendo. Ele nasce em 2, um degrau acima do comum e longe do topo.
  const potencia = ehStarter ? 2 : rolarPotencia();
  const stats = calcularStats(esp, ivs, nivel, quality, multDeNascenca(potencia, shiny));
  const maxHp = hpDeCombate(stats.hp);
  // Primeiro buraco nos slots 0..4 — mas só se a equipe ainda não tiver cinco. Sem contar o
  // tamanho, um pokémon legado no slot 5 deixava o 4 “livre” e a captura virava o sexto bicho.
  let slot = null;
  if (equipeDe(p).length < MAX_EQUIPE) {
    const slotsUsados = new Set(
      [...p.pokemons.values()].map((k) => k.slot).filter((s) => s != null && s < MAX_EQUIPE),
    );
    for (let i = 0; i < MAX_EQUIPE; i++) {
      if (!slotsUsados.has(i)) {
        slot = i;
        break;
      }
    }
  }

  const row = await db.inserirPokemon(p.dbId, {
    speciesId, level: nivel, xp, quality, ivs, hp: maxHp, shiny, slot, potencia,
    power: poderDePokemon({
      ivs, quality, potencia, shiny, level: nivel,
      bases: {
        hp: esp.baseHp, atk: esp.baseAtk, def: esp.baseDef,
        spAtk: esp.baseSpAtk, spDef: esp.baseSpDef, speed: esp.baseSpeed,
      },
    }),
    starter: ehStarter,
  });
  const pk = montarPokemon({
    id: row.id, species_id: speciesId, level: nivel, xp, quality, ivs, hp: maxHp, shiny, slot, potencia,
    starter: ehStarter, caught_at: row.caught_at,
  });
  p.pokemons.set(pk.id, pk);
  aplicarAutoLockPokemon(p, pk);
  return pk;
}

/**
 * Fechar a aba fora do Centro Pokémon custa o mesmo que morrer.
 *
 * ### O problema
 *
 * Todo custo do jogo é cobrado na derrota: o time cai, o treinador sobe ao Centro e perde o
 * tempo da volta; na arena, perde ELO e XP por cima. Enquanto sair do ar fosse de graça,
 * fechar a aba era a jogada matematicamente correta em toda luta perdida — e o oponente que
 * estava ganhando ficava sem nada. É o mesmo buraco que o cooldown de 5 minutos já tapava pela
 * metade (impedia a volta imediata, mas não devolvia o resultado da briga).
 *
 * ### A regra
 *
 * Sumir do ar em QUALQUER lugar que não seja a praça do Centro conta como morrer ali:
 *
 *   · o time inteiro vai ao chão, e o treinador acorda no Centro precisando da enfermeira;
 *   · na arena PvP, ainda por cima o ELO cai contra a média da sala e o XP é cobrado, igual
 *     a uma morte de verdade (`penalizarAbandono`).
 *
 * O Centro é o único lugar seguro para fechar o jogo — e é para lá que todo login volta, o que
 * fecha o ciclo: quem sai direito não perde nada, quem foge de uma luta perde o que perderia
 * se tivesse ficado.
 *
 * Vale também para a queda de conexão, e isso é deliberado: não há como distinguir um cabo
 * arrancado de um Alt+F4 no frame do golpe fatal, e a regra que depende de adivinhar intenção
 * é a que não vale nada.
 */
function punirAbandonoDaLuta(p) {
  const t = agora();
  if (p.pvp) {
    penalizarAbandono(p, t);
    sairDaArenaPvp(p, 'desconectou', t);
  } else if (p.noCentro || !p.campo) {
    // Na praça, ou em lugar nenhum (escolhendo a área no Mapa): sair é de graça.
    return;
  }

  for (const pk of p.pokemons.values()) {
    if (pk.slot == null || pk.hp <= 0) continue;
    pk.hp = 0;
    marcarSujo(p, pk);
  }
  p.campo = null;
  p.selvagem = null;
  p.boss = null;
  marcarSujo(p);
}

/**
 * Tira `p` da memória DESTE processo e grava AGORA, não no próximo ciclo do write-behind.
 *
 * Se ficasse só na fila, um F5 rápido (ou uma migração de arena) faria a próxima leitura
 * acontecer antes da gravação — o jogador voltaria com o estado de segundos atrás e, pior, a
 * sessão nova depois gravaria esse estado velho por cima. Dava para perder compras inteiras.
 *
 * A promessa fica guardada para quem for recarregar este jogador NESTE processo (aqui ou de
 * volta de outro shard) poder esperar por ela — é o mesmo `flushPendente` que o `entrar()` já
 * consulta. Ela também é DEVOLVIDA para quem chamou: `flushPendente` é memória local, então uma
 * migração de arena (que recarrega em OUTRO processo, sem acesso a este Map) precisa do próprio
 * valor de retorno para saber a hora certa de publicar o pedido de carregar em outro shard —
 * publicar antes disto terminar arriscaria o outro lado ler o Postgres antes da gravação.
 *
 * Fechou a aba estando na praça: o boneco sai na hora. Um treinador parado que não é mais
 * ninguém é pior aqui do que em qualquer outro lugar do jogo — a praça existe justamente para
 * as pessoas se verem, e uma estátua eterna vira mobília.
 *
 * Os postos de XP Share NÃO se desfazem aqui: eles estão no banco e o jogador espera
 * encontrá-los como deixou. O que morre é a INSTÂNCIA da casa — a sala desenhada, que não faz
 * sentido sem alguém dentro. `deixarOCentro` já fecha a casa se ele tiver fechado a aba lá
 * dentro; a linha abaixo é a rede de baixo para quem saiu de qualquer outro lugar.
 */
function removerJogadorLocal(p) {
  const playerId = p.key;
  if (p.centro) deixarOCentro(p);
  p.casa = null;
  casasAbertas.delete(p);
  // A espera entre dois desafios de ginásio é memória viva — sai junto com o jogador para o
  // mapa não crescer com quem já foi embora.
  esquecerDesafio(p.dbId);
  jogadores.delete(playerId);
  // O que está na FILA DE ECONOMIA termina antes da gravação. Um giro da oferenda (ou uma venda)
  // parado no `await` do banco credita a pedra DEPOIS — num `p` que já saiu daqui —, e sem esta
  // espera o crédito ficava fora do último flush: os pokémon apagados, a pedra perdida. O teto
  // de 10 s é a rede para uma fila presa: gravar atrasado é melhor que não gravar.
  //
  // `flushPendente` recebe a promessa JÁ AGORA, então o `entrar` de uma reconexão (e o shard da
  // arena, ver `migrarParaArenaRemota`) espera por tudo isto antes de ler o banco.
  const fila = filasEconomia.get(playerId);
  const antes = fila
    ? Promise.race([fila, new Promise((ok) => setTimeout(ok, 10_000).unref?.())])
    : Promise.resolve();
  const gravando = antes
    .then(() => {
      filaFlush.add(p);
      return flush();
    })
    .finally(() => {
      if (flushPendente.get(playerId) === gravando) flushPendente.delete(playerId);
    });
  flushPendente.set(playerId, gravando);
  return gravando;
}

function sair({ playerId }) {
  const p = jogadores.get(playerId);
  if (!p) return;

  // Perder o socket é sair da FILA do ranqueado, mesmo dentro da carência de reconexão. Não é
  // punição — não há o que punir, porque a partida é atômica e ninguém escapa dela fechando a
  // aba. É honestidade de tela: sem isto, uma queda de dez segundos deixaria a entrada viva, o
  // pareador casaria o jogador ausente e ele voltaria com uma derrota que nunca viu acontecer.
  // Reentrar na fila custa um clique.
  naFilaPvp.delete(playerId);
  filaAutoPendente.delete(playerId);
  p.pvpAutoFilaEm = 0;
  sairDaFila(playerId).catch(() => {});

  // Arena PvP NÃO tem carência: sumir do ar no meio da briga é derrota na hora. Há um
  // oponente do outro lado, e sem isto fechar a aba viraria a rota de fuga de toda luta
  // perdida — é o buraco que `punirAbandonoDaLuta`/`penalizarAbandono` tapam.
  if (p.pvp) {
    punirAbandonoDaLuta(p);
    // A promessa desta gravação NÃO se perde: `removerJogadorLocal` a deixa em `flushPendente`,
    // e é lá que `publicarLimpezaDoEmigrado` a encontra para só avisar o shard de casa depois
    // que ela cair. Se um visitante da arena saiu por aqui, `punirAbandonoDaLuta` acima já o
    // pôs em `filaRetornoArena` — a ordem entre as duas coisas importa.
    removerJogadorLocal(p);
    return;
  }

  // Fora do PvP: nada de nocaute e nada de tirar da memória agora. O jogador entra em
  // CARÊNCIA — continua aqui, congelado, com a equipe intacta e a hunt guardada. Uma
  // reconexão dentro de `GRACA_DESCONEXAO_MS` é transparente (ver `entrar`); passada a
  // janela, `finalizarDesconexao` (no `tickDoCentro`) grava e remove sem punir.
  if (!p.desconectadoEm) p.desconectadoEm = agora();
}

/**
 * A carência de reconexão venceu: o jogador não voltou. Suspende como uma ida voluntária ao
 * Centro — a equipe fica COMO ESTÁ (viva, com o HP que tinha) e a hunt continua em
 * `huntSlug` — e então grava e tira da memória. Sem nocaute e sem cobrança de XP: cair a
 * internet não é desmaiar.
 */
function finalizarDesconexao(p) {
  p.desconectadoEm = 0;
  removerJogadorLocal(p);
}

/**
 * Solta a CHAVE DE ROTEAMENTO depois de uma troca de nome — grava, tira da memória e derruba
 * o socket para o cliente reconectar com o nome novo.
 *
 * ### O estrago que isto conserta (visto em produção em 20/09/2026)
 *
 * A chave de roteamento do jogo é o nick em minúsculas: é ela que indexa `jogadores` aqui, o
 * mapa `sockets` do gateway, a presença no Redis e — pelo `shardDoJogador` — qual processo é
 * dono do jogador. A troca de nome mudava `players`, `accounts`, o cargo do chat e o token,
 * mas NÃO mudava `p.key`: o personagem continuava vivo na memória sob o nick ANTIGO.
 *
 * Como o nick antigo volta a ficar livre no mesmo instante, quem o comprasse em seguida
 * entrava e o `entrar` achava aquele objeto vivo sob a chave — e tratava como reconexão.
 * O jogador logava com o e-mail certo, da conta certa, e caía DENTRO do personagem do outro,
 * com depot, ouro e Mercado na mão. Foi exatamente o que aconteceu com `_MG_`/`_MG_1`: 23
 * segundos entre as duas trocas, e o principal passou uma hora jogando no personagem do alt.
 *
 * ### Por que derrubar a sessão em vez de re-indexar
 *
 * Re-indexar aqui resolveria o mapa deste processo e deixaria o resto torto: a chave nova
 * pode cair em OUTRO shard (`_mg_` → 5, `_mg_1` → 6), e aí o dono do jogador passa a ser um
 * processo que não tem o objeto. Além de `jogadores`, a chave ainda indexa `camposPvp`,
 * `naFilaPvp`, `filaAutoPendente`, `flushPendente`, `filasEconomia` e a presença no Redis.
 * Reconectar é o caminho que o jogo já sabe fazer certo, é o mesmo de um F5, e recalcula
 * tudo isso de uma vez — inclusive o shard.
 *
 * A ordem importa e é o que garante que nada se perde:
 *  1. os eventos da compra (o toast e o token novo) saem ANTES — o tick não vai mais ver
 *     este jogador para despachá-los;
 *  2. o flush termina ANTES do socket cair, então o `hello` seguinte lê do banco um estado
 *     que já inclui os segundos finais (o `flushPendente` que protege o F5 é memória DESTE
 *     processo, e o shard novo não teria como esperar por ele);
 *  3. só então o gateway derruba o socket, pelo MESMO canal do Redis por onde os eventos
 *     acabaram de sair — mesma conexão, ordem garantida.
 *
 * O `kick` fecha com 4000, que o cliente trata como queda comum e reconecta sozinho em ~1 s
 * (4001 e 4003 são os únicos códigos que ele lê como "não volte"). Mesmo que o token novo se
 * perca no caminho, o `hello` roteia por `accounts.nick`, não pelo nick do token.
 */
async function reabrirSessaoComNomeNovo(p) {
  const chaveAntiga = p.key;
  const { gatewayId } = p;
  try {
    if (p.eventos.length) {
      enviar(p, { t: SERVIDOR.BATALHA, ev: p.eventos });
      p.eventos = [];
    }
    await removerJogadorLocal(p);
  } catch (err) {
    console.error('[loja] troca de nome: soltar a chave antiga falhou:', err.message);
  }
  // O `kick` sai mesmo se o flush acima falhou: deixar a sessão pendurada na chave velha é o
  // próprio buraco que esta função existe para fechar, e ele é pior que perder um flush.
  publicar(canalGateway(gatewayId), { para: chaveAntiga, kick: true });
}

/**
 * A reabertura roda FORA da fila de economia, e isso não é detalhe.
 *
 * `removerJogadorLocal` espera `filasEconomia` drenar antes de gravar — é o que faz uma venda
 * parada num `await` do banco entrar no último flush. A compra da troca de nome roda DENTRO
 * dessa mesma fila, então chamá-la ali seria esperar por si mesma: destravaria só no teto de
 * 10 s do `Promise.race`, com a compra pendurada até lá. O `setImmediate` devolve o controle,
 * a fila esvazia no `finally` do `enfileirarEconomia` e aí sim a sessão se solta.
 */
function agendarReaberturaComNomeNovo(p) {
  setImmediate(() => {
    reabrirSessaoComNomeNovo(p).catch((err) =>
      console.error('[loja] troca de nome: reabrir a sessão falhou:', err.message));
  });
}

// -------------------------------------------------------- Arena PvP multi-shard

/**
 * Manda um jogador LOCAL para o shard dono das Arenas PvP — grava, some daqui, pede para lá
 * carregar. Só é chamada quando este processo NÃO é `config.arenaShardId`; ver `'pvp.entrar'`.
 */
function migrarParaArenaRemota(p, arenaId) {
  const { key, nick, gatewayId, admin, chatCargo } = p;
  jogadoresEmigrados.set(key, config.arenaShardId);
  // Só publica DEPOIS do flush terminar — `flushPendente` é memória local deste processo, o
  // shard da arena não tem como esperar por ela, então quem tem de esperar é quem publica.
  removerJogadorLocal(p).then(() => {
    publicar(canalSim(config.arenaShardId), {
      t: 'pvp.entrarRemoto', playerId: key, nick, gatewayId, admin, chatCargo, arenaId,
      homeShard: config.shardId,
    });
  });
}

/**
 * Devolve um jogador visitante para o shard de origem — flush imediato e recarrega ele lá,
 * pelo mesmo caminho de uma reconexão (`entrar`). Só chamar de dentro de `drenarRetornosDaArena`
 * (ver o comentário de `filaRetornoArena`): nunca no meio de uma função que ainda vai mexer em
 * `p` depois, e nunca para quem desconectou de verdade — aí `sair()` já cuidou da limpeza
 * local, e recarregar na casa ressuscitaria uma sessão sem socket nenhum atrás dela.
 */
function migrarDeVoltaParaCasa(p) {
  const homeShard = p.pvpHomeShard;
  const { key, nick, gatewayId, admin, chatCargo } = p;
  // Mesma razão do `.then()` em `migrarParaArenaRemota`: o resultado da arena (ELO, XP,
  // fichas) só existe de verdade depois que ESTE flush terminar — publicar antes arriscaria a
  // casa reler o Postgres de antes da briga.
  removerJogadorLocal(p).then(() => {
    publicar(canalSim(homeShard), { t: 'pvp.retornouDoRemoto', playerId: key, nick, gatewayId, admin, chatCargo });
  });
}

/** Recusou a entrada: avisa e, se veio de outro shard, agenda a volta — ver `filaRetornoArena`. */
function falharEntradaNaArena(p, msg) {
  evento(p, { k: 'aviso', msg });
  if (p.pvpHomeShard !== config.shardId) filaRetornoArena.set(p.key, { p, motivo: 'entradaFalhou' });
}

/**
 * Preparação final de entrada — deduz a Ficha e efetivamente entra. Chamada em DOIS lugares:
 * direto pelo comando `pvp.entrar` quando a arena já é local, e pelo handler de
 * `pvp.entrarRemoto` depois de recarregar um visitante vindo de outro shard. Dali para baixo
 * não existe mais diferença entre "sempre esteve aqui" e "acabou de chegar" — é por isso que
 * TODA a validação de verdade (nível, time de pé, lotação, cooldown) mora dentro de
 * `entrarNaArenaPvp`, e não neste arquivo: ela vale igual nos dois caminhos.
 *
 * `homeShard`: de onde o jogador veio, só quando é migração. Ausente = a arena já era o shard
 * dele — não há para onde devolvê-lo se algo falhar.
 */
function efetivarEntradaNaArena(p, arenaId, homeShard = null) {
  p.pvpHomeShard = homeShard ?? config.shardId;

  const pk = ativo(p);
  if (pk && !podeUsarPokemon(p, pk)) return falharEntradaNaArena(p, msgPokemonRecusaNivel(pk, p));
  if ((p.items[PVP_FICHA_ID] ?? 0) < 1) {
    return falharEntradaNaArena(
      p,
      `Você precisa de 1 Ficha PvP para entrar (você tem ${p.items[PVP_FICHA_ID] ?? 0})`,
    );
  }

  const r = entrarNaArenaPvp(p, arenaId, agora());
  if (!r.ok) return falharEntradaNaArena(p, r.msg);

  const restante = (p.items[PVP_FICHA_ID] ?? 0) - 1;
  if (restante > 0) p.items[PVP_FICHA_ID] = restante;
  else delete p.items[PVP_FICHA_ID];
  marcarSujo(p);
  evento(p, { k: 'aviso', msg: 'Ficha PvP usada (−1)' });

  // Dá para ir do Centro direto para a arena — e é o caminho comum, porque é lá que o time é
  // curado. Sair da praça é obrigatório antes do `campo.init` da arena: senão o boneco ficaria
  // plantado no meio do Centro, visível para todo mundo, enquanto o dono briga.
  if (p.centro) deixarOCentro(p);

  enviar(p, { t: SERVIDOR.CAMPO_INIT, ...snapshotArena(r.arena, r.membro) });
  anunciarEntradaArenaPvp(p, r.arena.id);
  evento(p, { k: 'pvpEntrou', arena: r.arena.nome, dentro: r.arena.membros.size });
}

/**
 * Avisa o shard de casa que um visitante da Arena foi embora de vez — DEPOIS que a gravação
 * dele terminou.
 *
 * O "depois" é a correção, e ela custou uma duplicação de Exp. Share em produção. O comentário
 * que estava aqui dizia que `sair()` "já removeu e gravou" o jogador; ele só tinha COMEÇADO a
 * gravar — `sair()` chama `removerJogadorLocal(p)` e descarta a promessa. Publicar antes de o
 * flush cair fazia o shard de casa apagar `jogadoresEmigrados` e, na reconexão seguinte, reler
 * o Postgres de ANTES da briga. E ele não tem como esperar sozinho: o `await flushPendente.get()`
 * do `entrar()` consulta um Map LOCAL, e a gravação pendente está noutro processo. O shard de
 * casa então regravava aquele retrato velho por cima de `players` — enquanto o `held_item_id`
 * do pokémon, coluna que ele não tinha marcado como suja, continuava com o valor novo. A
 * unidade voltava para a bolsa com o pokémon ainda segurando: um virava dois.
 *
 * Quem tem de esperar é quem publica — exatamente o que `migrarParaArenaRemota` e
 * `migrarDeVoltaParaCasa` já faziam com o `.then()` deles. Este era o único dos três caminhos
 * de saída da arena que publicava às cegas.
 *
 * `flushPendente` já não ter a chave significa que a gravação terminou: aí publica na hora.
 */
function publicarLimpezaDoEmigrado(p) {
  const avisar = () => publicar(canalSim(p.pvpHomeShard), { t: 'pvp.limparEmigrado', playerId: p.key });
  const gravando = flushPendente.get(p.key);
  if (gravando) gravando.finally(avisar);
  else avisar();
}

/**
 * Drena `filaRetornoArena` — chamado no fim de todo `tick()`. Ver o comentário da fila para o
 * porquê de não migrar na hora.
 */
function drenarRetornosDaArena() {
  if (!filaRetornoArena.size) return;
  const pendentes = [...filaRetornoArena.values()];
  filaRetornoArena.clear();
  for (const { p, motivo } of pendentes) {
    if (motivo === 'desconectou') {
      publicarLimpezaDoEmigrado(p);
      continue;
    }
    // Saída viva: só migra se `p` ainda for o jogador que está aqui agora — uma desconexão
    // entre o agendamento e o dreno já teria cuidado dele pelo caminho acima.
    if (jogadores.get(p.key) === p) migrarDeVoltaParaCasa(p);
  }
}

// ------------------------------------------------------------------ comandos

/**
 * Recusa um pedido de ginásio: o motivo em aviso E o pacote que FECHA o pedido.
 *
 * São as duas metades da mesma resposta. O aviso é o que o jogador lê; o `GINASIO` é o que
 * desarma o relógio de espera da tela (ver `pedirAoServidorGinasio` no cliente). Mandar só o
 * aviso deixaria a tela achando que a resposta ainda vem, e ela acabaria trocando o motivo
 * de verdade por um "não deu para carregar" genérico.
 */
function recusarGinasio(p, msg) {
  evento(p, { k: 'aviso', msg });
  enviar(p, { t: SERVIDOR.GINASIO, recusado: true });
}

const comandos = {
  /**
   * Fecha o onboarding do personagem: gênero e as seis cores, de uma vez.
   *
   * Vale UMA vez. Depois disso `visualOk` tranca, e mudar de aparência passa a custar uma skin
   * na loja — que é o que dá valor à skin. A trava é aqui e não na tela: o editor some do
   * cliente, mas `visual.set` continuaria aberto para quem mandar a mensagem na mão.
   *
   * O looktype volta ao padrão do gênero de propósito. No onboarding ninguém tem outfit
   * comprada, mas quem trocou de gênero na loja e caiu aqui não pode continuar vestindo o
   * boneco do gênero antigo. E ele NÃO vem do cliente: aceitar um looktype do pedido seria
   * um jeito de vestir de graça qualquer outfit que a Loja vende.
   */
  'visual.set': (p, m) => {
    if (p.visualOk) return evento(p, { k: 'aviso', msg: 'seu visual já está definido' });
    p.gender = m.genero === 'female' ? 'female' : 'male';
    p.visual = normalizarVisual(m.visual);
    p.looktype = corpoPadrao(p.gender);
    p.visualOk = true;
    refletirAparencia(p);
    marcarSujo(p);
    enviarEstado(p);
  },

  /**
   * Troca o avatar DEPOIS do onboarding — uma vez a cada 24 horas.
   *
   * A trava mora aqui, e o carimbo vai ao banco na hora (`registrarTrocaDeVisual`): a tela
   * mostra a espera, mas quem a cobra é isto. Sem a escrita imediata, trocar e fechar o jogo
   * antes do flush devolveria uma troca de graça.
   *
   * O LOOKTYPE só volta ao padrão do gênero quando o jogador está vestindo um padrão. Quem
   * comprou uma outfit continua com ela — a skin foi paga, e trocar a cor do cabelo não é
   * motivo para tirá-la. (Se ela for do gênero antigo, o `podeEquiparLooktype` do login
   * seguinte já resolve, porque outfit comprada não depende de gênero.)
   */
  'visual.trocar': (p, m) => {
    if (!p.visualOk) return evento(p, { k: 'aviso', msg: 'termine a criação do personagem primeiro' });
    const t = agora();
    const livreEm = (p.visualTrocadoEm ?? 0) + VISUAL_TROCA_MS;
    if (t < livreEm) {
      const horas = Math.ceil((livreEm - t) / 3_600_000);
      return evento(p, { k: 'aviso', msg: `você já trocou de avatar hoje — faltam ${horas}h` });
    }
    const generoNovo = m.genero === 'female' ? 'female' : 'male';
    const vestindoPadrao = p.looktype === corpoPadrao(p.gender);
    p.gender = generoNovo;
    p.visual = normalizarVisual(m.visual);
    if (vestindoPadrao) p.looktype = corpoPadrao(generoNovo);
    p.visualTrocadoEm = t;
    refletirAparencia(p);
    marcarSujo(p);
    // O carimbo é o único campo que não passa pelo write-behind — ver `db.registrarTrocaDeVisual`.
    db.registrarTrocaDeVisual(p.dbId, t).catch((err) =>
      console.error('[sim] carimbo da troca de avatar falhou:', err.message),
    );
    evento(p, { k: 'avatarTrocado' });
    enviarEstado(p);
  },

  /** Marca o tour das abas do topo como visto — só vale uma vez por treinador. */
  'tutorial.concluir': (p) => {
    if (p.tutorialVisto) return;
    p.tutorialVisto = true;
    marcarSujo(p);
    enviarEstado(p);
  },

  /** Pop-up do Discord — "já estou na comunidade": grava a campanha atual dispensada. */
  'discordPop.dispensar': (p, m) => {
    const campanha = Number(m?.campanha ?? DISCORD_POP_CAMPANHA);
    if (campanha !== DISCORD_POP_CAMPANHA) return;
    if (!discordPopDeveMostrar(p.discordPopCampanha)) return;
    p.discordPopCampanha = campanha;
    marcarSujo(p);
    enviarEstado(p);
  },

  /**
   * Fechou o AVISO DE MUDANÇA. Carimba a versão lida para ele não voltar no próximo login.
   *
   * A checagem `versao !== AVISO_VERSAO` não é paranoia de segurança — é o cliente velho: uma
   * aba aberta desde antes do deploy manda o número ANTIGO, e aceitá-lo carimbaria como lido
   * um aviso que aquela pessoa nunca viu.
   */
  'aviso.dispensar': (p, m) => {
    const versao = Number(m?.versao ?? AVISO_VERSAO);
    if (versao !== AVISO_VERSAO) return;
    if (!avisoDeveMostrar(p.avisoVisto)) return;
    p.avisoVisto = versao;
    marcarSujo(p);
    enviarEstado(p);
  },

  'starter.pick': (p, m) => {
    // Mesma folga do `ofertaDeStarter`: com `resetStarter` ligado o Depot cheio de shinys não
    // conta como "já tem". A bandeira é derrubada no banco quando o starter nasce, e é ela —
    // não a contagem de pokémon — que impede um segundo inicial.
    if ((p.pokemons.size && !p.resetStarter) || p.escolhendoStarter) return;
    // O starter é o ÚLTIMO passo do onboarding: primeiro o personagem, depois o pokémon.
    // Sem esta linha, um cliente que pulasse o editor entraria no jogo com o boneco padrão e
    // sem nunca ter escolhido nada.
    if (!p.visualOk) return;
    const speciesId = Number(m.speciesId);
    if (!STARTERS.includes(speciesId)) return;
    p.escolhendoStarter = true; // trava contra clique duplo enquanto o insert não volta
    darStarter(p, speciesId)
      .catch((err) => {
        console.error('[sim] falha ao criar o starter:', err.message);
        evento(p, { k: 'aviso', msg: 'não deu para criar o starter — tente de novo' });
      })
      .finally(() => {
        p.escolhendoStarter = false;
      });
  },

  /**
   * A enfermeira cura o time — e o jogador FICA no Centro.
   *
   * Antes isto devolvia o treinador direto para a hunt em que ele tinha caído. Estava errado
   * por dois motivos: teleporta sem pedir licença (quem morreu numa hunt dura provavelmente
   * quer ir para outra) e tira do jogador o único momento de parada do jogo. Agora curar é só
   * curar; sair do Centro é escolher uma área no Mapa, que é uma decisão à parte.
   */
  'centro.curar': (p) => {
    if (!p.noCentro) return;
    if (!curarEquipeNoCentro(p)) return evento(p, { k: 'joy', fala: 'jaCurado' });
    evento(p, { k: 'joy', fala: 'curou' });
  },

  /**
   * A tecla que o jogador está segurando na praça (WASD / setas).
   *
   * Não anda ninguém aqui: só anota a direção, e quem move é o tick da praça. Mandar o comando
   * dez vezes por segundo não faz o boneco andar mais rápido — é o que impede um cliente
   * adulterado de virar velocista.
   */
  // Dentro de casa é o MESMO comando: para o jogador, andar é andar, e a casa é uma área
  // andável como a praça. Trocar de mensagem obrigaria o cliente a saber onde está antes de
  // repassar uma tecla — e ele já sabe menos que o servidor sobre isso.
  'centro.andar': (p, m) => {
    const dir = Number(m.dir) || 0;
    if (p.casa) return andarNaCasa(p.casa, dir);
    andarNoCentro(p, dir);
  },

  // ---------------------------------------------------------------- Casa
  /**
   * Entra na casa. Instância PRIVADA — ver `game/casa-sala.mjs`.
   *
   * Só do Centro Pokémon, e por uma razão de mundo: a casa fica em Cerulean, e sair de uma
   * hunt na Outland direto para a sala de estar não é uma porta, é um teleporte. Quem está
   * caçando usa o botão do Centro (ou uma Escape Rope) primeiro.
   */
  'casa.entrar': (p, m) => {
    // Entra na casa PEDIDA, pelo número. Sem número (cliente em cache, de antes das casas
    // numeradas) vai para a melhor que ele tem — era o que o botão antigo fazia.
    const casa = m?.casaId != null
      ? casaAtivaPorId(p, m.casaId)
      : ordenarCasas(casasAtivas(p))[0] ?? null;
    if (!casa) {
      // Guardada não abre: dentro dela não há posto valendo, e a sala só existe para escalar.
      if (m?.casaId != null && casaNaMaoPorId(p, m.casaId)) return evento(p, { k: 'aviso', msg: 'casa.guardadaEntrar' });
      return evento(p, { k: 'aviso', msg: (p.casas ?? []).length ? 'casa.naoDisponivel' : 'casa.naoPossui' });
    }
    if (p.casa?.casaId === casa.id) return;
    // De dentro de OUTRA casa troca de sala direto: as casas ficam na mesma rua de Cerulean, e
    // obrigar a passar pela praça entre uma e outra seria só um clique a mais.
    if (!p.casa && !p.noCentro) return evento(p, { k: 'aviso', msg: 'casa.soDoCentro' });
    if (!casaDisponivel(casa.raridade)) {
      // A grade não foi gerada (`npm run walkgrids` no sprite-lab). Dizer isso é melhor que um
      // botão que não faz nada — é o mesmo tratamento que a praça já recebe.
      return evento(p, { k: 'aviso', msg: 'esta casa ainda não está disponível neste servidor' });
    }

    const t = agora();
    if (p.casa) {
      casasAbertas.delete(p);
      p.casa = null;
    } else {
      sairDoCentro(p);
      p.noCentro = false;
    }
    const sala = abrirCasa(p, casa.raridade, [], t);
    if (!sala) {
      // Falhou depois de sair da praça: devolve para lá, senão o jogador fica em lugar nenhum.
      irParaOCentro(p, 'visita');
      return evento(p, { k: 'aviso', msg: 'não deu para abrir a casa' });
    }
    // O número vai na sala ANTES dos registrados: é por ele que `registradosParaSala` sabe de
    // qual casa desenhar os pokémon.
    sala.casaId = casa.id;
    p.casa = sala;
    sincronizarTreinos(sala, registradosParaSala(p), t);
    casasAbertas.add(p);
    enviar(p, { t: SERVIDOR.CAMPO_INIT, ...snapshotDaCasa(p.casa) });
    marcarSujo(p);
  },

  /** Sai de casa e volta ao Centro Pokémon. O XP Share CONTINUA — ver `creditarXpShare`. */
  'casa.sair': (p) => {
    if (!p.casa) return;
    p.casa = null;
    casasAbertas.delete(p);
    irParaOCentro(p, 'visita');
    marcarSujo(p);
  },

  /**
   * Registra (ou solta) um pokémon da EQUIPE num posto de XP Share de UMA casa.
   *
   * `{ casaId, slot, pokemonId }` — `pokemonId: null` esvazia o posto. Sem `casaId` (cliente em
   * cache) vale a casa em que o jogador está. Quatro recusas, e cada uma fecha um buraco:
   *
   *   · **casa que não é dele, que está no Mercado ou que está GUARDADA** — o número vem do cliente;
   *   · **fora da equipe** — o Depot não entra (ver a regra 2 da seção XP SHARE). Anunciar no
   *     Mercado APAGA o pokémon da memória (a linha fica no banco com `anuncio_id`, ver
   *     `market.criar`), então o `get` abaixo já cobre o escrow de quebra;
   *   · **já registrado noutro posto** — de qualquer casa, e a mensagem diz qual: o mesmo bicho
   *     em duas casas somaria as fatias (regra 5);
   *   · **segurando Exp. Share** — os dois XP Share não se somam no mesmo pokémon.
   *
   * O pokémon de BATALHA pode ser registrado sem erro, de propósito: ele só não recebe
   * enquanto estiver lutando (ver `creditarXpShare`), e trocar o ativo é um clique — recusar
   * aqui obrigaria o jogador a desfazer e refazer o registro a cada troca de time.
   *
   * Não exige estar DENTRO da casa: o modal da Casa escala qualquer uma delas, e é o que torna
   * dez casas administráveis sem dez viagens.
   */
  'xpshare.escolher': (p, m) => {
    const casa = casaAtivaPorId(p, m.casaId ?? p.casa?.casaId);
    if (!casa) {
      const guardada = casaNaMaoPorId(p, m.casaId ?? p.casa?.casaId);
      return evento(p, { k: 'aviso', msg: guardada ? 'casa.guardadaEscalar' : 'casa.naoDisponivel' });
    }

    const slot = Math.floor(Number(m.slot));
    if (!Number.isInteger(slot) || slot < 0 || slot >= bonecosDaRaridade(casa.raridade)) return;

    const pedido = m.pokemonId == null ? null : Number(m.pokemonId);
    if (pedido != null) {
      const pk = p.pokemons.get(pedido);
      if (!pk) return evento(p, { k: 'aviso', msg: 'esse pokémon não está mais com você' });
      if (pk.slot == null) {
        return evento(p, { k: 'aviso', msg: 'só pokémon da EQUIPE recebem XP Share' });
      }
      const outro = postoDoPokemon(p, pedido, { casaId: casa.id, slot });
      if (outro) {
        return evento(p, { k: 'aviso', msg: 'casa.jaEmOutroPosto', params: { numero: numeroDaCasa(outro.casaId) } });
      }
      if (ehXpShareHeldItem(pk.heldItemId)) {
        return evento(p, { k: 'aviso', msg: 'xpshareheld.travaCasa' });
      }
    }

    registrarNoPosto(p, casa, slot, pedido);
    if (p.casa?.casaId === casa.id) sincronizarTreinos(p.casa, registradosParaSala(p), agora());
    marcarSujo(p);
  },

  /** O nome antigo do comando acima. Vale para um cliente em cache que ainda não recarregou. */
  'academia.treinar': (p, m) => comandos['xpshare.escolher'](p, m),

  /**
   * Põe uma casa EM USO, ou a guarda. `{ casaId, usar }`.
   *
   * Até `MAX_CASAS_EM_USO` casas repartem XP ao mesmo tempo; ter mais não tem teto. Guardar solta
   * os pokémon dos postos daquela casa (a regra mora em `usarCasa`), e não vale para a casa em que
   * o jogador está — sair dela antes é o mesmo pedido que o anúncio faz.
   */
  'casa.usar': (p, m) => {
    if (!p.casas) return;
    const casaId = Number(m?.casaId);
    const usar = !!m?.usar;
    if (!usar && p.casa?.casaId === casaId) return evento(p, { k: 'aviso', msg: 'casa.saiaParaGuardar' });
    const r = usarCasa(p, casaId, usar);
    if (!r.ok) {
      return evento(p, {
        k: 'aviso', msg: r.erro, params: r.erro === 'casa.limiteEmUso' ? { n: MAX_CASAS_EM_USO } : undefined,
      });
    }
    if (r.soltos.length) {
      evento(p, {
        k: 'aviso', msg: r.soltos.length === 1 ? 'casa.soltoAoGuardar' : 'casa.soltosAoGuardar', params: { n: r.soltos.length },
      });
    }
    marcarSujo(p);
    enviarEstado(p);
  },

  /** Equipa Exp. Share (held) num pokémon — consome 1 da bolsa. */
  'xpshareheld.equipar': (p, m) => {
    if (agora() < (p.xpShareHeldAte ?? 0)) {
      return evento(p, { k: 'aviso', msg: 'xpshareheld.cooldown' });
    }
    const pk = p.pokemons.get(Number(m.pokemonId));
    if (!pk) return evento(p, { k: 'aviso', msg: 'xpshareheld.pokemonSumiu' });
    if (ehXpShareHeldItem(pk.heldItemId)) {
      return evento(p, { k: 'aviso', msg: 'xpshareheld.jaTem' });
    }
    if ((p.items[XP_SHARE_HELD_ID] ?? 0) < 1) {
      return evento(p, { k: 'aviso', msg: 'xpshareheld.semItem' });
    }
    if (pokemonNoPostoCasa(p, pk.id)) {
      return evento(p, { k: 'aviso', msg: 'xpshareheld.travaHeldCasa' });
    }
    p.items[XP_SHARE_HELD_ID] -= 1;
    if (!p.items[XP_SHARE_HELD_ID]) delete p.items[XP_SHARE_HELD_ID];
    pk.heldItemId = XP_SHARE_HELD_ID;
    // O relógio só anda quando a troca ACONTECE: um pedido recusado (sem item, pokémon no
    // posto) não pode empurrar a espera para frente, senão errar o clique vira castigo.
    p.xpShareHeldAte = agora() + XP_SHARE_HELD_COOLDOWN_MS;
    marcarSujo(p, pk);
    evento(p, { k: 'xpshareheldEquipado', pokemonId: pk.id, nome: pk.nome });
    enviarEstado(p);
  },

  /** Remove Exp. Share (held) e devolve 1 unidade à bolsa. */
  'xpshareheld.remover': (p, m) => {
    // Mesmo relógio do `equipar`, de propósito: o par equipar→remover é o que mexe nas duas
    // tabelas, então a espera tem de valer para os dois lados ou não vale para nenhum.
    if (agora() < (p.xpShareHeldAte ?? 0)) {
      return evento(p, { k: 'aviso', msg: 'xpshareheld.cooldown' });
    }
    const pk = p.pokemons.get(Number(m.pokemonId));
    if (!pk || !ehXpShareHeldItem(pk.heldItemId)) {
      return evento(p, { k: 'aviso', msg: 'xpshareheld.naoEquipado' });
    }
    pk.heldItemId = null;
    p.items[XP_SHARE_HELD_ID] = (p.items[XP_SHARE_HELD_ID] ?? 0) + 1;
    p.xpShareHeldAte = agora() + XP_SHARE_HELD_COOLDOWN_MS;
    marcarSujo(p, pk);
    evento(p, { k: 'xpshareheldRemovido', pokemonId: pk.id, nome: pk.nome });
    enviarEstado(p);
  },

  /**
   * Professor Carvalho: 10 Fragmentos de Chave → 1 Casa sorteada, com NÚMERO do servidor.
   *
   * O número nasce no banco (`casas-db.criarCasa`), então esta é a única fabricação assíncrona do
   * balcão. A ordem é a de toda compra: cobra em memória → grava → aplica. Se a gravação falhar,
   * os fragmentos voltam e o sorteio não aconteceu para ninguém. A casa nova já vale: não há mais
   * casa equipada, e ela chega com os postos vazios, esperando escalação.
   */
  'casa.fabricar': (p) => {
    enfileirarEconomia(p, async () => {
      const fragAntes = p.items[FRAGMENTO_CHAVE_ID] ?? 0;
      const raridade = fabricarCasaComFragmentos(p);
      if (!raridade) {
        const tem = p.items[FRAGMENTO_CHAVE_ID] ?? 0;
        return evento(p, {
          k: 'aviso',
          msg: `precisa de ${CUSTO_FRAGMENTOS_CASA}× Fragmento de Chave (você tem ${tem})`,
        });
      }
      const fragDepois = p.items[FRAGMENTO_CHAVE_ID] ?? 0;
      marcarSujo(p);

      let casa;
      try {
        casa = await casasDb.criarCasa({ donoId: p.dbId, nick: p.nick, raridade });
      } catch (err) {
        p.items[FRAGMENTO_CHAVE_ID] = (p.items[FRAGMENTO_CHAVE_ID] ?? 0) + CUSTO_FRAGMENTOS_CASA;
        marcarSujo(p);
        console.error('[casas] fabricar falhou:', err.message);
        return evento(p, { k: 'aviso', msg: 'casa.fabricarFalhou' });
      }
      p.casas = [...(p.casas ?? []), casa];
      mexeuNoXpShare(p);
      // Entra em uso sozinha se houver vaga; com as cinco ocupadas, chega guardada.
      const emUso = usarCasa(p, casa.id, true).ok;

      auditar(
        p,
        'fragmento',
        'chave_gasto',
        `${CUSTO_FRAGMENTOS_CASA}× Fragmento de Chave (${fragAntes}→${fragDepois}) · sorteio de casa`,
      );
      // O formato "obteve casa <raridade>" é o que a numeração retroativa lê (`raridadeDoLog`).
      auditar(
        p,
        'casa',
        'nova',
        `obteve casa ${raridade} ${numeroDaCasa(casa.id)} · shard ${config.shardId}`,
        `casa:${casa.id}`,
      );
      evento(p, { k: 'casaFabricada', raridade, casaId: casa.id, emUso, maxEmUso: MAX_CASAS_EM_USO });
      if (raridade === 'lendaria') anunciarDropLendario(p, 'casa');
      enviarEstado(p);
    });
  },

  /**
   * Professor Carvalho: 10 Fragmentos de Bicicleta → 1 Bicicleta sorteada, A MAIS na bolsa.
   *
   * Diferente da Casa, não há "só com a bolsa vazia": o jogador pode juntar quantas quiser e
   * escolhe qual equipar (`bicicleta.equipar`). Os avisos vão como CHAVE de i18n (com
   * `params`), para a tela traduzir. Ver `game/bicicletas.mjs`.
   */
  'bicicleta.fabricar': (p) => {
    enfileirarEconomia(p, async () => {
      const fragAntes = p.items[FRAGMENTO_BICICLETA_ID] ?? 0;
      const raridade = fabricarBicicletaComFragmentos(p);
      if (!raridade) {
        return evento(p, {
          k: 'aviso',
          msg: 'bicicleta.faltamFragmentos',
          params: { n: CUSTO_FRAGMENTOS_BICICLETA, tem: fragAntes },
        });
      }
      const fragDepois = p.items[FRAGMENTO_BICICLETA_ID] ?? 0;
      marcarSujo(p);

      // O NÚMERO nasce no banco (`bicicletas-db.criarBicicleta`), como o da Casa: se a gravação
      // falhar, os fragmentos voltam e o sorteio não aconteceu para ninguém.
      let bici;
      try {
        bici = await bicicletasDb.criarBicicleta({ donoId: p.dbId, nick: p.nick, raridade });
      } catch (err) {
        p.items[FRAGMENTO_BICICLETA_ID] = (p.items[FRAGMENTO_BICICLETA_ID] ?? 0) + CUSTO_FRAGMENTOS_BICICLETA;
        marcarSujo(p);
        console.error('[bicicletas] fabricar falhou:', err.message);
        return evento(p, { k: 'aviso', msg: 'bicicleta.fabricarFalhou' });
      }
      p.bicicletas = [...(p.bicicletas ?? []), bici];
      auditar(
        p,
        'fragmento',
        'bicicleta_gasto',
        `${CUSTO_FRAGMENTOS_BICICLETA}× Fragmento de Bicicleta (${fragAntes}→${fragDepois}) · sorteio de bicicleta`,
      );
      // O formato "obteve bicicleta <raridade>" é o que a numeração retroativa lê (`raridadeDoLog`).
      auditar(
        p,
        'bicicleta',
        'nova',
        `obteve bicicleta ${raridade} ${numeroDaBicicleta(bici.id)} · shard ${config.shardId}`,
        `bicicleta:${bici.id}`,
      );
      evento(p, { k: 'bicicletaFabricada', raridade, bicicletaId: bici.id, itemId: BICICLETA_POR_RARIDADE[raridade] });
      if (raridade === 'lendaria') anunciarDropLendario(p, 'bicicleta');
      enviarEstado(p);
    });
  },

  /**
   * Equipa UMA bicicleta — pelo NÚMERO — ou nenhuma, com `bicicletaId: null`.
   *
   * Só a equipada vale e as porcentagens não somam. O número vem do cliente e passa por
   * `equiparBicicleta`, que só aceita bicicleta NA MÃO do jogador: a anunciada no Mercado, a dos
   * outros e o número inventado são recusados. Cliente em cache, de antes da numeração, manda a
   * RARIDADE — vale a bicicleta de menor número daquela raridade na mão.
   */
  'bicicleta.equipar': (p, m) => {
    if (!p.bicicletas) return;
    const antes = bicicletaEquipada(p)?.id ?? null;
    let pedida = m.bicicletaId;
    if (pedida === undefined) {
      const rar = raridadeBicicletaValida(m.raridade);
      pedida = rar
        ? (ordenarBicicletas(p.bicicletas.filter((b) => !b.anunciada && b.raridade === rar))[0]?.id ?? 0)
        : null;
    }
    // Pedir a que já está equipada (ou "a pé" já a pé) não muda nada, nem gasta o intervalo. A
    // tela nunca pede isso; repetir a mensagem forjada não pode render um estado inteiro.
    if (pedida === antes) return;
    // Uma troca a cada `INTERVALO_TROCA_BICICLETA_MS` — equipar outra ou guardar a equipada.
    const espera = (p.automation.bicicletaTrocadaEm ?? 0) + INTERVALO_TROCA_BICICLETA_MS - agora();
    if (espera > 0) {
      return evento(p, { k: 'aviso', msg: 'bicicleta.trocaEspera', params: { tempo: tempoDeEspera(espera) } });
    }
    const r = equiparBicicleta(p, pedida);
    if (!r.ok) return evento(p, { k: 'aviso', msg: r.erro });
    if (r.bicicletaId === antes) return;
    p.automation.bicicletaTrocadaEm = agora();
    marcarSujo(p);
    // Na praça de Cerulean a bicicleta também vale: o ritmo novo entra já no próximo passo.
    atualizarVelocidadeNoCentro(p);
    evento(p, { k: 'bicicletaEquipada', bicicletaId: r.bicicletaId, raridade: r.raridade });
    enviarEstado(p);
  },

  /**
   * Relê as casas do banco. A tela pede ao ABRIR o modal da Casa.
   *
   * Quase tudo que muda uma casa já passa pelo sim (fabricar, anunciar, cancelar, comprar), mas a
   * VENDA não: quem compra é outro jogador, talvez noutro shard, e a casa vendida do vendedor
   * continuaria "no Mercado" na memória dele até o próximo login. Abrir o modal é o momento em
   * que a lista importa. Uma leitura a cada 3 s no máximo — o modal reabre à vontade sem virar
   * uma consulta por clique.
   */
  'casa.sincronizar': (p) => {
    const t = agora();
    if (t < (p.casasLidasEm ?? 0) + 3_000) return;
    p.casasLidasEm = t;
    // As bicicletas vão junto: a venda de uma também acontece noutro jogador, e o modal da Casa é
    // onde mora o Registro de Bikes.
    //
    // Pela FILA da economia: anunciar marca a peça como "no Mercado" na memória ANTES de gravar o
    // anúncio (é o que tira a velocidade e o XP Share na hora). Uma releitura correndo por fora
    // leria o banco antes do COMMIT e devolveria a peça à mão enquanto o anúncio ainda grava.
    enfileirarEconomia(p, () => Promise.all([carregarCasas(p), carregarBicicletas(p)])
      .then(() => enviarEstado(p))
      .catch((err) => console.error('[casas] sincronizar:', err.message)));
  },

  /**
   * O REGISTRO do servidor: as casas mais novas primeiro, filtrável por raridade.
   *
   * `{ raridade?, pagina? }`. `minha` marca as linhas do próprio jogador, que a tela destaca —
   * vai calculado daqui porque o cliente não conhece o próprio `dbId`.
   */
  'casas.listar': (p, m) => {
    const t = agora();
    if (t < (p.casasListadasEm ?? 0) + 250) return;
    p.casasListadasEm = t;
    casasDb
      .registro({ raridade: m.raridade ?? null, pagina: m.pagina })
      .then((r) => enviar(p, {
        t: SERVIDOR.CASAS_LISTA,
        ...r,
        linhas: r.linhas.map(({ donoId, criadorId, ...l }) => ({
          ...l,
          minha: donoId === p.dbId,
          tirouEle: criadorId === p.dbId,
        })),
      }))
      .catch((err) => console.error('[casas] registro:', err.message));
  },

  /** O REGISTRO DE BIKES — o espelho de `casas.listar`, na aba ao lado, no modal da Casa. */
  'bicicletas.listar': (p, m) => {
    const t = agora();
    if (t < (p.bicicletasListadasEm ?? 0) + 250) return;
    p.bicicletasListadasEm = t;
    bicicletasDb
      .registro({ raridade: m.raridade ?? null, pagina: m.pagina })
      .then((r) => enviar(p, {
        t: SERVIDOR.BICICLETAS_LISTA,
        ...r,
        linhas: r.linhas.map(({ donoId, criadorId, ...l }) => ({
          ...l,
          minha: donoId === p.dbId,
          tirouEle: criadorId === p.dbId,
        })),
      }))
      .catch((err) => console.error('[bicicletas] registro:', err.message));
  },

  /** Professor Carvalho: 10 Fragmentos de Shiny Stone → 1 pedra do tipo escolhido. */
  'shinyStone.fabricar': (p, m) => {
    enfileirarEconomia(p, () => {
      const fragAntes = p.items[FRAGMENTO_SHINY_ID] ?? 0;
      const r = fabricarShinyStone(p, m.tipo);
      if (r.erro) return evento(p, { k: 'aviso', msg: r.erro });
      marcarSujo(p);
      const fragDepois = p.items[FRAGMENTO_SHINY_ID] ?? 0;
      auditar(
        p,
        'fragmento',
        'shiny_gasto',
        `${CUSTO_FRAGMENTOS_SHINY_STONE}× Fragmento Shiny Stone (${fragAntes}→${fragDepois}) → ${r.tipo} Shiny Stone`,
        r.itemId != null ? `item:${r.itemId}` : null,
      );
      evento(p, { k: 'shinyStoneFabricada', tipo: r.tipo, itemId: r.itemId });
    });
  },

  /**
   * Professor Carvalho: 10 Fragmentos de Mega Stone → a Mega Stone da espécie escolhida.
   *
   * `shiny: true` usa a outra família inteira — o Fragmento de Mega SHINY Stone e a pedra
   * shiny. Quem decide qual cobrar é ESTE campo e não o pokémon, porque na bancada ainda não
   * há pokémon nenhum: o jogador está comprando a pedra, e ele é quem sabe se vai gastá-la
   * num shiny. Escolher errado não perde nada — a pedra é negociável no Mercado.
   *
   * Dentro de `enfileirarEconomia` pela mesma razão das outras bancadas: duas abas apertando
   * "Fabricar" no mesmo instante gastariam os mesmos dez fragmentos duas vezes.
   */
  'mega.fabricar': (p, m) => {
    enfileirarEconomia(p, () => {
      const shiny = m.shiny === true;
      const fragId = shiny ? FRAGMENTO_MEGA_SHINY_ID : FRAGMENTO_MEGA_ID;
      const antes = p.items[fragId] ?? 0;
      const r = fabricarMegaStone(p, m.dex, shiny);
      if (r.erro) return evento(p, { k: 'aviso', msg: r.erro });
      marcarSujo(p);
      auditar(
        p,
        'fragmento',
        shiny ? 'mega_shiny_gasto' : 'mega_gasto',
        `${antes - (p.items[fragId] ?? 0)}× Fragmento ${shiny ? 'Mega Shiny Stone' : 'Mega Stone'} (${antes}→${p.items[fragId] ?? 0}) → ${r.nome}`,
        r.itemId != null ? `item:${r.itemId}` : null,
      );
      evento(p, { k: 'megaStoneFabricada', dex: r.dex, shiny: r.shiny, itemId: r.itemId, nome: r.nome });
    });
  },

  /**
   * Usar um item da bolsa. Hoje só a ESCAPE ROPE.
   *
   * O `item.use` existia no protocolo desde o começo e nunca tinha sido implementado; a corda
   * é o primeiro item que de fato se USA (o resto se equipa, se aplica num pokémon ou se
   * gasta ao evoluir), então ela estreia a rota em vez de ganhar uma própria.
   */
  'item.use': (p, m) => {
    const itemId = Number(m.itemId);
    if (itemId !== ESCAPE_ROPE_ID) return;

    // As três recusas, na ordem em que fazem sentido para quem clicou.
    if (p.noCentro || p.casa) return evento(p, { k: 'aviso', msg: 'você já está no Centro Pokémon' });
    // Na arena a saída tem regra própria (10 s fora de combate). Uma corda que furasse isso
    // seria a rota de fuga de qualquer briga perdida — e o PvP inteiro deixaria de ter risco.
    if (p.pvp) return evento(p, { k: 'aviso', msg: 'a Escape Rope não funciona na arena PvP' });
    if ((p.items[ESCAPE_ROPE_ID] ?? 0) < 1) return evento(p, { k: 'aviso', msg: 'Sem Escape Rope' });

    p.items[ESCAPE_ROPE_ID] -= 1;
    if (!p.items[ESCAPE_ROPE_ID]) delete p.items[ESCAPE_ROPE_ID];
    // O PONTO da corda: não passa por `msgBloqueioCombateCurto`. Os 3 s existem para impedir
    // sumir da luta no frame do golpe fatal; a corda é o produto que compra exatamente essa
    // saída, e é por isso que ela custa diamante e some ao usar.
    irParaOCentro(p, 'visita');
    marcarSujo(p);
    evento(p, { k: 'escapeRope', restam: p.items[ESCAPE_ROPE_ID] ?? 0 });
  },

  /**
   * Vai ao Centro Pokémon por vontade própria, de dentro de uma hunt.
   *
   * Não é a mesma coisa que desmaiar: `motivo: 'visita'` é o que faz a tela dizer "descanse"
   * em vez de "seu time está nocauteado". A hunt fica guardada em `p.huntSlug`, como sempre.
   */
  'centro.ir': (p) => {
    if (p.noCentro) return;
    // Dentro da arena PvP a saída tem regra própria (10 s fora de combate) e passa por
    // `pvp.sair` — deixar este atalho furar aquilo seria a rota de fuga de qualquer briga.
    if (p.pvp) return evento(p, { k: 'aviso', msg: 'use o botão da arena para sair do PvP' });
    // Em combate contra selvagem, a mesma ideia com 3 s. A trava é conferida AQUI, não só no
    // botão: o botão desabilitado é aviso, não regra — um cliente adulterado mandando
    // `centro.ir` na mão sumiria do meio da luta.
    const travaCentro = msgBloqueioCombateCurto(p, agora());
    if (travaCentro) return evento(p, { k: 'aviso', msg: travaCentro });
    irParaOCentro(p, 'visita');
  },

  /**
   * Desistência voluntária da hunt: nocautea o time, cobra 10% do XP do nível e manda ao
   * Centro — mas NÃO dispara "Voltar à hunt ao morrer", porque foi escolha, não derrota real.
   */
  'centro.desistir': (p) => {
    if (p.noCentro) return;
    if (p.pvp) return evento(p, { k: 'aviso', msg: 'use o botão da arena para sair do PvP' });
    if (p.boss) {
      return evento(p, { k: 'aviso', msg: 'só dá para desistir durante uma hunt' });
    }
    if (!p.huntSlug || !p.campo) {
      return evento(p, { k: 'aviso', msg: 'só dá para desistir durante uma hunt' });
    }
    nocautearEquipe(p);
    p.automation.desistiuHunt = true;
    marcarSujo(p);
    evento(p, { k: 'morte', quem: 'treinador' });
    irParaOCentro(p, 'desistencia', { autoVoltarHunt: false });
  },

  /** TM Researcher — troca peças por discos (consumidas na hora). */
  'tm.trocar': (p, m) => {
    if (!p.noCentro) return evento(p, { k: 'aviso', msg: 'fale com o TM Researcher no Centro Pokémon' });
    const modo = String(m.modo ?? '');
    if (modo === 'aoe') {
      const qtd = CUSTO_PECAS_AOE;
      if ((p.items[PIECE_AOE] ?? 0) < qtd) {
        return evento(p, { k: 'aviso', msg: `precisa de ${qtd}× AoE TM Disk Piece` });
      }
      p.items[PIECE_AOE] -= qtd;
      if (!p.items[PIECE_AOE]) delete p.items[PIECE_AOE];
      p.items[DISK_AOE] = (p.items[DISK_AOE] ?? 0) + 1;
      marcarSujo(p);
      return evento(p, { k: 'tmTrocado', modo: 'aoe', itemId: DISK_AOE, qtd: 1, pecas: qtd });
    }
    if (modo === 'elemental') {
      const tipo = String(m.tipo ?? '').toUpperCase();
      const diskId = DISCO_POR_TIPO[tipo];
      if (!diskId) return evento(p, { k: 'aviso', msg: 'tipo de disco inválido' });
      const qtd = CUSTO_PECAS_ELEMENTAL;
      if ((p.items[PIECE_ELEMENTAL] ?? 0) < qtd) {
        return evento(p, { k: 'aviso', msg: `precisa de ${qtd}× TM Disk Piece` });
      }
      p.items[PIECE_ELEMENTAL] -= qtd;
      if (!p.items[PIECE_ELEMENTAL]) delete p.items[PIECE_ELEMENTAL];
      p.items[diskId] = (p.items[diskId] ?? 0) + 1;
      marcarSujo(p);
      return evento(p, { k: 'tmTrocado', modo: 'elemental', tipo, itemId: diskId, qtd: 1, pecas: qtd });
    }
    evento(p, { k: 'aviso', msg: 'modo de troca inválido' });
  },

  /** Aplica um TM Disk no pokémon (disco consumido). */
  'tm.aplicar': (p, m) => {
    const itemId = Number(m.itemId);
    const item = itens.get(itemId);
    const pk = p.pokemons.get(Number(m.pokemonId));
    if (!pk) return evento(p, { k: 'aviso', msg: 'pokémon não encontrado' });
    if ((p.items[itemId] ?? 0) < 1) return evento(p, { k: 'aviso', msg: 'você não tem esse disco' });
    const kind = ehDiscoTm(item);
    if (!kind) return evento(p, { k: 'aviso', msg: 'isso não é um TM Disk' });
    if (kind === 'aoe') {
      if (pk.tmAoe) return evento(p, { k: 'aviso', msg: `${pk.nome} já tem TM AoE` });
      pk.tmAoe = true;
    } else {
      const tipo = discoElementalPorItemId(itemId);
      if (!tipoTmPermitido(tipo, pk)) {
        const tipos = (pk.tipos ?? []).join(' ou ');
        return evento(p, { k: 'aviso', msg: `${pk.nome} só aceita TM elemental ${tipos}` });
      }
      pk.tmElemental = tipo;
    }
    p.items[itemId] -= 1;
    if (!p.items[itemId]) delete p.items[itemId];
    marcarSujo(p, pk);
    evento(p, { k: 'tmAplicado', pokemonId: pk.id, nome: pk.nome, itemId, kind });
  },

  /** Desafia um boss: valida a entrada e teleporta para a arena. */
  'boss.entrar': (p, m) => {
    const travaBoss = msgBloqueioEntradaBoss(p, agora());
    if (travaBoss) return evento(p, { k: 'aviso', msg: travaBoss });
    const boss = bossPorKey(String(m.key ?? ''));
    if (!boss) return evento(p, { k: 'aviso', msg: 'esse boss ainda não está liberado' });
    if (p.boss) return evento(p, { k: 'aviso', msg: 'você já está numa arena' });

    const t = boss.entrada;
    if ((p.items[t.itemId] ?? 0) < t.qtd) {
      return evento(p, { k: 'aviso', msg: `precisa de ${t.qtd}× ${t.nome} para desafiar ${boss.nome}` });
    }
    if (p.level < boss.minNivelTreinador) {
      return evento(p, {
        k: 'aviso',
        msg: `precisa ser pelo menos nv ${boss.minNivelTreinador} para desafiar ${boss.nome} (seu nv ${p.level})`,
      });
    }
    if (!equipeDe(p).some((k) => k.hp > 0)) {
      return evento(p, { k: 'aviso', msg: 'sua equipe está nocauteada' });
    }
    const pkBoss = ativo(p);
    if (pkBoss && !podeUsarPokemon(p, pkBoss)) {
      return evento(p, { k: 'aviso', msg: msgPokemonRecusaNivel(pkBoss, p) });
    }
    if (!entrarNaArena(p, boss)) {
      return evento(p, { k: 'aviso', msg: `a arena de ${boss.nome} não está disponível neste servidor` });
    }
    // O boss desafiado à mão vira o alvo da repetição automática. Assim ligar o interruptor
    // no meio de uma luta continua a série que já estava acontecendo, em vez de escolher
    // sozinho outro boss da lista.
    if (p.automation.bossAutoKey !== boss.key) {
      p.automation.bossAutoKey = boss.key;
      marcarSujo(p);
    }
    evento(p, { k: 'bossEntrou', key: boss.key, nome: boss.nome, penalidade: p.boss.penalidade });
  },

  /**
   * Liga/desliga a repetição automática do boss.
   *
   * O que ela faz: ao fim de cada luta (ganhando ou perdendo) o jogador cai no Centro, a
   * enfermeira cura o time e o sim entra de novo na MESMA arena, gastando outro token. Roda
   * enquanto houver token — e desliga sozinha quando o último acaba, com um aviso.
   *
   * A vontade mora em `automation` (que já é gravado no flush), e não numa variável de
   * memória: quem liga isso vai dormir com o jogo aberto, e uma queda de conexão no meio da
   * madrugada não pode desligar em silêncio.
   */
  'boss.auto': (p, m) => {
    const ativar = !!m.ativo;
    const key = String(m.key ?? '') || p.boss?.key || p.automation.bossAutoKey || '';
    if (ativar) {
      const boss = bossPorKey(key);
      if (!boss) return evento(p, { k: 'aviso', msg: 'escolha um boss antes de ligar a repetição' });
      if (p.level < boss.minNivelTreinador) {
        return evento(p, {
          k: 'aviso',
          msg: `precisa ser pelo menos nv ${boss.minNivelTreinador} para desafiar ${boss.nome} (seu nv ${p.level})`,
        });
      }
      p.automation.bossAutoKey = boss.key;
    }
    p.automation.bossAuto = ativar;
    // Ligou parado no Centro (o caso normal: acabou de curar depois de uma luta): a próxima
    // entrada é agendada aqui, senão nada aconteceria até a luta seguinte — que não existe.
    const t = agora();
    p.bossAutoEm = ativar && !p.boss ? t + msAteEntradaBossLivre(p, t) : 0;
    marcarSujo(p);
    evento(p, { k: 'bossAuto', ativo: ativar, key: p.automation.bossAutoKey ?? null });
    enviarEstado(p);
  },

  /** Abandona a arena. O token da entrada NÃO volta — é o custo de ter tentado. */
  'boss.sair': (p) => {
    if (!p.boss) return;
    // Desistir é decisão explícita, e ela vale para a série inteira: sem isto o automático
    // arrastaria o jogador de volta para dentro da arena que ele acabou de abandonar.
    if (p.automation.bossAuto) {
      p.automation.bossAuto = false;
      p.bossAutoEm = 0;
      evento(p, { k: 'bossAuto', ativo: false, key: p.automation.bossAutoKey ?? null });
    }
    evento(p, { k: 'bossSaiu' });
    sairDaArena(p);
  },

  // ------------------------------------------------------------------ ORBs
  //
  // Diferente de todo o resto do sim, ESTES comandos vão ao banco de forma síncrona. É de
  // propósito: o write-behind aceita perder 5 segundos num crash, o que para XP é irrelevante
  // e para dinheiro real é inaceitável.

  /** Saldo, preços, endereço de depósito, extrato, saques e o painel público do caixa. */
  'orbs.painel': (p) => {
    responderPainelDeOrbs(p).catch((err) => {
      console.error('[orbs] painel falhou:', err.message);
      evento(p, { k: 'aviso', msg: 'não deu para ler a carteira agora' });
    });
  },

  /**
   * Pede um saque em USDT.
   *
   * O débito e o registro acontecem numa transação só (`odb.pedirSaque`); o ENVIO é do
   * worker, não daqui — o tick não pode esperar a blockchain. Por isso a resposta é "pedido
   * registrado", e não "dinheiro enviado".
   */
  'orbs.sacar': (p, m) => {
    (async () => {
      const saldo = await odb.saldoDe(p.dbId);
      const v = validarSaque({
        orbs: m.orbs,
        rede: String(m.rede ?? ''),
        endereco: m.endereco,
        saldo,
      });
      if (!v.ok) return evento(p, { k: 'aviso', msg: v.erro });

      const r = await odb.pedirSaque({
        playerId: p.dbId,
        orbs: v.orbs,
        usdt: v.usdt,
        rede: v.rede,
        endereco: v.endereco,
      });
      p.orbs = r.saldo;
      marcarSujo(p);
      evento(p, { k: 'orbsSaque', id: r.id, orbs: v.orbs, usdt: v.usdt, saldo: r.saldo });
      await responderPainelDeOrbs(p);
    })().catch((err) => {
      console.error('[orbs] saque falhou:', err.message);
      evento(p, { k: 'aviso', msg: 'não deu para registrar o saque — tente de novo' });
    });
  },

  /** Cancela um saque que ainda não saiu e devolve as ORBs. */
  'orbs.cancelar': (p, m) => {
    (async () => {
      const s = await odb.saquePorId(String(m.id ?? ''));
      // O dono é conferido AQUI: sem isto, um id vazado cancelaria o saque de outro jogador.
      if (!s || s.playerId !== p.dbId) return evento(p, { k: 'aviso', msg: 'saque não encontrado' });
      const r = await odb.cancelarSaque(s.id, 'cancelado pelo jogador');
      if (!r.ok) return evento(p, { k: 'aviso', msg: 'este saque não pode mais ser cancelado' });
      p.orbs = r.saldo;
      marcarSujo(p);
      evento(p, { k: 'orbsEstorno', orbs: s.orbs, saldo: r.saldo });
      await responderPainelDeOrbs(p);
    })().catch((err) => console.error('[orbs] cancelamento falhou:', err.message));
  },

  // ------------------------------------------------------------- loja VIP

  /**
   * Compra um produto da loja de diamantes.
   *
   * `comprarNaLoja` faz TODA a validação e já aplica o efeito no jogador em memória. O que
   * sobra aqui são os dois efeitos que precisam sair da memória: a troca de nome (que bate
   * no UNIQUE do Postgres) e o aviso na tela.
   */
  'loja.comprar': (p, m) => {
    enfileirarEconomia(p, () => {
      return (async () => {
      const t = agora();
      const v = validarCompra(p, String(m.id ?? ''), t, { nome: m.nome });
      if (!v.ok) return evento(p, { k: 'aviso', msg: v.erro });

      if (v.nomePedido) {
        // A troca de nome derruba a sessão de propósito (ver `reabrirSessaoComNomeNovo`), e
        // derrubar no meio de uma partida do PvP seria abandono — com punição, e cobrado de
        // quem acabou de pagar os 6 diamantes. Na fila e na arena remota é pior ainda: a entrada na
        // fila e o registro de emigrado são indexados pela chave antiga, que some aqui.
        // Recusar ANTES do débito é o que faz a recusa não custar nada.
        if (p.pvp || naFilaPvp.has(p.key) || jogadoresEmigrados.has(p.key)) {
          return evento(p, { k: 'aviso', msg: 'termine a partida (ou saia da fila do PvP) antes de trocar de nome' });
        }
        const conta = await contaPorNick(p.nick);
        if (!(await nickDisponivel(
          v.nomePedido,
          conta ? Number(conta.id) : null,
          p.dbId,
        ))) {
          return evento(p, { k: 'aviso', msg: 'esse nome já está em uso' });
        }
      }

      // DEBITA PRIMEIRO, e numa transação. O diamante foi pago com dinheiro de verdade: a
      // ordem "aplica o efeito e depois cobra" entregaria o produto de graça se o débito
      // falhasse, e a checagem de saldo em memória não fecha a corrida de dois cliques.
      // Produtos grátis (preco 0) não passam pelo ledger — `movimentar` rejeita delta zero.
      // Só outfits beta podem ser resgatadas sem débito; o preço NUNCA vem do cliente.
      if (v.produto.preco > 0) {
        let saldo;
        try {
          ({ saldo } = await ddb.gastarNaLoja({
            playerId: p.dbId,
            diamantes: v.produto.preco,
            produtoId: v.produto.id,
            nome: v.produto.nome,
          }));
        } catch {
          return evento(p, { k: 'aviso', msg: 'diamantes insuficientes' });
        }
        p.diamonds = saldo;
      } else if (!v.produto.betaExclusive) {
        return evento(p, { k: 'aviso', msg: 'produto inválido' });
      }

      // ---------------------------------------------------------- caixas
      //
      // A caixa não tem `efeito`: o que ela faz é criar uma LINHA numerada em `caixas_beta`,
      // e o número só existe depois de o banco decidir qual é. Por isso ela desvia aqui,
      // depois do débito — a mesma ordem de todo o resto (valida → debita → aplica).
      //
      // O estorno tem de existir porque este é o único produto que pode falhar DEPOIS de pago
      // por uma razão legítima: a última unidade pode ter saído entre a validação e a
      // transação. Mesmo caminho da troca de nome, logo abaixo.
      const defCaixa = caixaPorProduto(v.produto.id);
      if (defCaixa) {
        try {
          const caixa = await cxdb.comprarCaixa({ playerId: p.dbId, nick: p.nick, tipo: defCaixa.tipo });
          await atualizarVendidasCaixas();
          await carregarCaixas(p);
          marcarSujo(p);
          auditar(
            p, 'caixa', 'comprada',
            `${nomeDaCaixa(caixa.tipo, caixa.serie)} · ${v.produto.preco} 💎 · restam ${caixa.restam}`,
            `caixa:${caixa.id}`,
          );
          evento(p, {
            k: 'caixaComprada',
            id: caixa.id, tipo: caixa.tipo, serie: caixa.serie, nome: caixa.nome,
          });
        } catch (err) {
          const e = await ddb.estornarCompra({
            playerId: p.dbId,
            diamantes: v.produto.preco,
            produtoId: v.produto.id,
            nota: err.message,
          });
          p.diamonds = e.saldo;
          marcarSujo(p);
          await atualizarVendidasCaixas();
          // A caixa recusa por três motivos, e os três já vêm como CHAVE de tradução (menos o
          // 'esgotada', que é o vocabulário interno de `comprarCaixa`). Qualquer outra coisa é
          // falha de verdade e vira a mensagem genérica — não se mostra `err.message` cru ao
          // jogador, que seria SQL ou erro de rede em português técnico.
          const chaves = { esgotada: 'caixas.esgotada', 'caixas.jaComprou': 'caixas.jaComprou' };
          evento(p, { k: 'aviso', msg: chaves[err.message] ?? 'caixas.falhouCompra' });
        }
        return;
      }

      const r = aplicarEfeito(p, v.produto, t, { nome: v.nomePedido });
      marcarSujo(p);

      // A Exp. Share é a única compra que também move um CONTADOR de direito. É ele que a
      // conferência do login usa para saber quantas o jogador pode ter (`conferirXpShareHeld`),
      // e ele mora na mesma linha da bolsa — as duas vão juntas no mesmo flush, então não há
      // instante em que o item exista sem o direito que o justifica.
      if (r.efeito.tipo === 'item' && ehXpShareHeldItem(r.efeito.itemId)) {
        p.xpShareTotal = (Number(p.xpShareTotal) || 0) + (r.efeito.qtd ?? 1);
      }

      // Compra que muda a APARÊNCIA precisa refletir no boneco da praça na hora. Sem isto,
      // quem comprava uma outfit (ou trocava de gênero) estando no Centro continuava com a
      // roupa velha para todo mundo até sair e voltar — e o Centro é justamente o lugar onde
      // as pessoas se veem, ou seja, onde a roupa nova é o ponto.
      if (r.efeito.tipo === 'outfit' || r.efeito.tipo === 'genero') refletirAparencia(p);

      if (r.efeito.tipo === 'nome') {
        // A troca de nick é a única compra que pode falhar DEPOIS de paga — o nome pode ter
        // sido tomado entre a validação e o UPDATE. Aí os diamantes voltam: cobrar do jogador
        // uma corrida do banco seria cobrar por um erro que não é dele.
        try {
          const conta = await contaPorNick(p.nick);
          await db.renomearJogador(p.dbId, v.nomePedido, conta ? Number(conta.id) : null);
          await renomearCargoChat(p.nick, v.nomePedido);
          p.nick = v.nomePedido;
          refletirAparencia(p);
          marcarSujo(p);
          const token = conta
            ? await assinarSessao({
              nick: v.nomePedido,
              contaId: Number(conta.id),
              provedor: conta.provedor ?? 'local',
            })
            : null;
          evento(p, { k: 'lojaCompra', id: v.produto.id, nome: v.produto.nome });
          evento(p, { k: 'nomeTrocado', nick: v.nomePedido, token });
          // O nick novo já está no banco, mas a SESSÃO ainda roteia pelo antigo — e o antigo
          // acabou de ficar livre para outra pessoa comprar. Soltar a chave é o que impede
          // que ela caia dentro deste personagem. Ver `reabrirSessaoComNomeNovo`.
          agendarReaberturaComNomeNovo(p);
        } catch {
          const e = await ddb.estornarCompra({
            playerId: p.dbId,
            diamantes: v.produto.preco,
            produtoId: v.produto.id,
            nota: 'nome já em uso',
          });
          p.diamonds = e.saldo;
          marcarSujo(p);
          evento(p, { k: 'aviso', msg: 'esse nome já está em uso — os diamantes voltaram' });
        }
        return;
      }

      evento(p, { k: 'lojaCompra', id: v.produto.id, nome: v.produto.nome, efeito: r.efeito.tipo });
      })().catch((err) => {
        console.error('[loja] compra falhou:', err.message);
        evento(p, { k: 'aviso', msg: 'não deu para concluir a compra — tente de novo' });
      });
    });
  },

  // ------------------------------------------------------------ Convites do Discord
  //
  // O `/resgatar <codigo>` do chat. Quem gera o código é o bot (`src/bot/`) quando o jogador
  // cruza um marco de convidados, e ele chega no privado do Discord — ver `shared/convites.mjs`.
  //
  // Passa por `enfileirarEconomia` como toda entrega de prêmio: o resgate mexe em diamante, bola,
  // boost e VIP do mesmo jogador, e duas mensagens intercaladas no meio dos `await` misturariam
  // as duas entregas. O que impede o MESMO CÓDIGO de ser resgatado duas vezes não é esta fila
  // (ela é por jogador, e dois jogadores diferentes não se enfileiram juntos): é o
  // `WHERE resgatado_em IS NULL` da transação, no banco. Ver `convites-db.mjs`.

  'convite.resgatar': (p, m) => {
    enfileirarEconomia(p, async () => {
      if (!p.dbId) return;
      // Anti-força-bruta: 3 s entre duas tentativas. Um código é 10 caracteres em 32 letras
      // (2^50), então varrer é impossível de qualquer jeito — o que isto barra é o script que
      // martela a mesma conexão e enche o log de auditoria.
      const t = agora();
      if (t - (p.ultimoResgateConvite ?? 0) < 3000) {
        return evento(p, { k: 'aviso', msg: 'convite.espera' });
      }
      p.ultimoResgateConvite = t;
      let r;
      try {
        r = await resgatarCodigoDeConvite(p, m?.codigo, t);
      } catch (err) {
        if (err instanceof ErroConvite) return enviar(p, { t: SERVIDOR.CONVITE, recusa: err.chave });
        console.error('[convite] resgate falhou:', err.message);
        return evento(p, { k: 'aviso', msg: 'convite.falhou' });
      }
      marcarSujo(p);
      filaFlush.add(p);
      // O prêmio é gravado ANTES de o código ser carimbado como entregue: se o flush falhar, a
      // linha fica sem `entregue_em` e o próximo login reentrega (ver `entregarPendentes`).
      try {
        await flush();
        await confirmarEntregaDeConvite(r.codigo);
      } catch (err) {
        console.error('[convite] flush do resgate falhou:', err.message);
      }
      enviarEstado(p);
      auditar(p, 'convite', 'resgate', `marco de ${r.marco} convidado(s) · ${r.codigo}`);
      enviar(p, { t: SERVIDOR.CONVITE, marco: r.marco, premios: r.premios });
      // O chat inteiro fica sabendo. Só no resgate de verdade: a REENTREGA
      // (`reentregarConvites`) é a mesma conquista chegando duas vezes, e anunciá-la de novo
      // seria festejar um marco que ninguém cruzou hoje.
      anunciarConviteResgatado(p, r.marco);
    });
  },

  // ------------------------------------------------------------ Passe de Batalha
  //
  // A trilha de 30 dias de login. O estado mora em `p.passe` e vai no flush com os prêmios —
  // ver o cabeçalho de `game/passe-batalha.mjs`. O pacote do cliente não carrega campo nenhum:
  // o degrau, o dia e o que se ganha são do servidor.

  /** Resgata o dia (grátis + VIP, se valendo) ou o VIP de hoje de quem comprou depois. */
  'passe.resgatar': (p) => {
    enfileirarEconomia(p, async () => {
      let r;
      try {
        r = passeBatalha.resgatar(p, agora());
      } catch (err) {
        if (err instanceof passeBatalha.ErroPasse) return evento(p, { k: 'aviso', msg: err.chave, params: err.params });
        throw err;
      }
      marcarSujo(p);
      enviarEstado(p);
      auditar(p, 'passe', 'resgate', `dia ${r.degrau}${r.premios.some((x) => x.trilha === 'vip') ? ' + VIP' : ''}`);
      enviar(p, { t: SERVIDOR.PASSE, resgate: r });
    });
  },

  /**
   * Compra o Passe VIP. Debita PRIMEIRO, no ledger (a mesma `gastarNaLoja` de toda compra de
   * diamante), e só então liga o prazo — e força o flush deste jogador na hora: um passe pago não
   * espera o ciclo de 5 s.
   */
  'passe.comprarVip': (p) => {
    enfileirarEconomia(p, async () => {
      const t = agora();
      try {
        passeBatalha.podeComprarVip(p, t);
      } catch (err) {
        if (err instanceof passeBatalha.ErroPasse) return evento(p, { k: 'aviso', msg: err.chave, params: err.params });
        throw err;
      }
      let saldo;
      try {
        ({ saldo } = await ddb.gastarNaLoja({
          playerId: p.dbId,
          diamantes: passeBatalha.PASSE_VIP_PRECO,
          produtoId: 'passe_vip',
          nome: 'Passe de Batalha VIP (30 dias)',
        }));
      } catch {
        return evento(p, { k: 'aviso', msg: 'passe.semDiamantes', params: { n: passeBatalha.PASSE_VIP_PRECO } });
      }
      p.diamonds = saldo;
      const vipAte = passeBatalha.ativarVip(p, t);
      marcarSujo(p);
      filaFlush.add(p);
      flush().catch((err) => console.error('[passe] flush da compra falhou:', err.message));
      enviarEstado(p);
      auditar(p, 'passe', 'vip', `${passeBatalha.PASSE_VIP_PRECO} 💎 · vale até ${new Date(vipAte).toISOString()}`);
      enviar(p, { t: SERVIDOR.PASSE, vipComprado: { vipAte } });
    });
  },

  /** Recolhe comissões de indicação pendentes na carteira (botão da aba Indique & Ganhe). */
  'afiliado.recolher': (p) => {
    enfileirarEconomia(p, () => {
      return (async () => {
        try {
          const r = await entregarComissoesAfiliado(p);
          if (!r) return evento(p, { k: 'aviso', msg: 'afiliados.nadaPendente' });
          const creditados = r.recolhido ?? r.itens;
          const diamantes = creditados.filter((i) => i.tipo === 'diamante').reduce((s, i) => s + i.qtd, 0);
          const gemas = creditados.filter((i) => i.tipo === 'gema').reduce((s, i) => s + i.qtd, 0);
          evento(p, { k: 'afiliadoRecolhido', diamantes, gemas });
        } catch (err) {
          console.error('[afiliados] recolher:', err.message);
          evento(p, { k: 'aviso', msg: 'afiliados.falhou' });
        }
      })();
    });
  },

  /** Equipa uma outfit já comprada, exclusiva de VIP (com assinatura ativa) ou o visual padrão do gênero. */
  'loja.equipar': (p, m) => {
    const lt = Number(m.looktype);
    const t = agora();
    if (!podeEquiparLooktype(p, lt, t)) {
      if (LOOKTYPES_OUTFIT_VIP.has(lt) && !vipAtivo(p, t)) {
        return evento(p, { k: 'aviso', msg: 'essa outfit é exclusiva de VIP' });
      }
      return evento(p, { k: 'aviso', msg: 'você não tem essa outfit' });
    }
    p.looktype = lt;
    refletirAparencia(p);
    marcarSujo(p);
    evento(p, { k: 'outfitTrocada', looktype: lt });
  },

  /**
   * ABRE uma Caixa de Fundador — o passo sem volta.
   *
   * Os três prêmios saem de uma vez: a outfit vai para o armário, a tag se cola ao nick e os
   * diamantes caem no saldo. Depois disso a caixa não é mais mercadoria.
   *
   * Quase tudo acontece dentro de UMA transação em `abrirCaixa` (carimbo + ledger), e o resto
   * é releitura: `carregarCaixas` reconcilia a bolsa, as tags e o `ownedOutfits`. A ordem é
   * essa de propósito — a transação é a verdade, a memória é o espelho dela.
   *
   * Passa pela FILA da economia (`enfileirarEconomia`) como toda operação que mexe em moeda
   * paga: dois cliques rápidos no botão Abrir viram fila em vez de corrida.
   */
  'caixa.abrir': (p, m) => {
    enfileirarEconomia(p, async () => {
      const id = Number(m.id);
      if (!Number.isFinite(id) || id <= 0) return evento(p, { k: 'aviso', msg: 'caixas.semCaixa' });
      try {
        const r = await cxdb.abrirCaixa({ id, playerId: p.dbId, nick: p.nick });
        p.diamonds = r.saldo;
        await carregarCaixas(p);
        marcarSujo(p);
        const def = caixaPorTipo(r.caixa.tipo);
        auditar(
          p, 'caixa', 'aberta',
          `${r.caixa.nome} · +${r.diamantes} 💎 · tag ${textoTag(r.caixa.tipo, r.caixa.serie)}`,
          `caixa:${r.caixa.id}`,
        );
        evento(p, {
          k: 'caixaAberta',
          tipo: r.caixa.tipo,
          serie: r.caixa.serie,
          nome: r.caixa.nome,
          tag: textoTag(r.caixa.tipo, r.caixa.serie),
          looktype: def?.looktype ?? null,
          diamantes: r.diamantes,
        });
      } catch (err) {
        evento(p, { k: 'aviso', msg: err.message });
      }
    });
  },

  // ------------------------------------------------------------------- PvP
  //
  // O PvP individual é RANQUEADO e a partida é atômica: o pareamento simula a luta inteira,
  // grava os pontos e só então entrega o resultado aos dois lados. Nada aqui decide combate —
  // estes handlers só põem e tiram da fila, gravam a equipe e leem a tela. Quem luta é
  // `game/pvp-ranqueado.mjs`, no processo do pareador.
  //
  // Nenhum deles mexe em `p` além de ler nível e IP: o rank vive em `pvp_rank`, fora do
  // write-behind. É isso que deixa o resultado chegar de outro shard sem sincronização.

  /** A aba inteira: rank, equipe, tabela, histórico e o estado da fila. */
  'pvp.info': async (p) => {
    if (!p.dbId) return;
    try {
      enviar(p, { t: SERVIDOR.PVP, ...(await infoRanqueado(p.dbId, p.key)) });
    } catch (err) {
      console.error('[sim] pvp.info falhou:', err.message);
      evento(p, { k: 'aviso', msg: 'Não deu para abrir o PvP agora.' });
    }
  },

  /**
   * Grava a equipe de PvP (até cinco, na ordem escolhida).
   *
   * A posse de cada pokémon é reconferida contra o banco em `pvpdb.salvarTime` — o seletor da
   * tela é conveniência. Salvar com a fila em andamento é permitido de propósito: a equipe que
   * luta é lida no INSTANTE do pareamento, então trocar durante a espera muda a próxima
   * partida e não desfaz nenhuma que já aconteceu.
   */
  'pvp.time.salvar': async (p, m) => {
    if (!p.dbId) return;
    try {
      const salvo = await pvpdb.salvarTime(p.dbId, m?.pokemonIds);
      enviar(p, { t: SERVIDOR.PVP, timeSalvo: salvo.pokemonIds });
    } catch (err) {
      const msg = err instanceof pvpdb.ErroPvp ? err.message : 'Não deu para salvar a equipe.';
      if (!(err instanceof pvpdb.ErroPvp)) console.error('[sim] pvp.time.salvar:', err.message);
      enviar(p, { t: SERVIDOR.PVP, recusa: { motivo: err?.codigo ?? 'erro', msg } });
    }
  },

  /**
   * Entra na fila.
   *
   * Tudo o que vai para a entrada da fila sai DAQUI (nível, gateway, IP) e nada do pacote do
   * cliente — que não tem campo nenhum. Um cliente adulterado mandando `pvp.fila.entrar` mil
   * vezes só reinicia a própria espera, e ainda esbarra no balde de mensagens do gateway.
   */
  'pvp.fila.entrar': async (p) => {
    if (!p.dbId) return;
    try {
      const r = await entrarNaFila({
        key: p.key, nick: p.nick, dbId: p.dbId, nivel: p.level, gatewayId: p.gatewayId, ip: p.ip,
      }, agora());
      if (!r.ok) return enviar(p, { t: SERVIDOR.PVP, filaRecusa: r });
      naFilaPvp.add(p.key);
      // O TAMANHO vai junto, e é lido DEPOIS de entrar: o número que a tela tinha veio do
      // `pvp.info` de antes do clique, e sem isto o jogador que abre a fila sozinho lê "0 na
      // fila agora" — com ele mesmo dentro.
      enviar(p, {
        t: SERVIDOR.PVP,
        fila: { na: true, desde: r.entrada.desde, tamanho: await tamanhoDaFila(), cooldownMs: 0 },
      });
    } catch (err) {
      console.error('[sim] pvp.fila.entrar falhou:', err.message);
      enviar(p, { t: SERVIDOR.PVP, filaRecusa: { motivo: 'erro', msg: 'A fila está fora do ar.' } });
    }
  },

  /**
   * Sai da fila.
   *
   * A resposta diz se ele REALMENTE saiu. Quando o pareador já reivindicou o par (ver
   * `reclamarPar`), `sairDaFila` devolve `false` e a tela continua esperando — o resultado da
   * partida está a caminho. Mentir aqui ("saiu!") faria o replay chegar depois numa tela que
   * já disse ao jogador que ele estava fora.
   */
  'pvp.fila.sair': async (p) => {
    // Cancelar na mão desliga a reentrada agendada. Sem isto, sair da fila devolveria o
    // jogador a ela vinte segundos depois — o oposto do que o botão diz que faz.
    filaAutoPendente.delete(p.key);
    p.pvpAutoFilaEm = 0;
    naFilaPvp.delete(p.key);
    const saiu = await sairDaFila(p.key).catch(() => false);
    enviar(p, { t: SERVIDOR.PVP, fila: { na: !saiu, desde: 0, tamanho: await tamanhoDaFila() } });
  },

  /** O jogador assistiu ao replay: a partida deixa de esperar na caixa postal. */
  'pvp.partida.vista': async (p, m) => {
    if (!p.dbId || !idClienteValido(m?.id)) return;
    await pvpdb.marcarVista(p.dbId, Number(m.id)).catch(() => {});
  },

  // ---------------------------------------------------------------- guild

  'guild.info': async (p) => {
    await carregarGuild(p);
    const pvp = await infoGuildWar(p);
    const pvpEquipe = p.guild ? await gdb.equipeGuerraSalva(p.dbId) : null;
    enviar(p, { t: SERVIDOR.GUILD, guild: p.guild, pvp, pvpEquipe });
  },

  /**
   * O custo sai do ouro EM MEMÓRIA, que é o número de verdade de quem está online — o do banco
   * só alcança a memória no flush. Antes o banco cobrava do número velho e o sim copiava o
   * resultado de volta para `p.gold`: gastar ouro e criar a guild antes do flush devolvia o
   * gasto. Na fila de economia, para não intercalar com outra cobrança do mesmo jogador.
   */
  'guild.criar': (p, m) => {
    enfileirarEconomia(p, async () => {
      if (p.guild) return evento(p, { k: 'aviso', msg: 'Você já está em uma guild.' });
      if (!nomeGuildValido(m.nome)) {
        return evento(p, { k: 'aviso', msg: 'Nome inválido (3–16 letras, números, espaço, - ou _).' });
      }
      const cobrado = subtrairGold(p, CUSTO_CRIAR_GUILD);
      if (cobrado < CUSTO_CRIAR_GUILD) {
        p.gold += cobrado;
        return evento(p, { k: 'aviso', msg: `Precisa de ${CUSTO_CRIAR_GUILD.toLocaleString('pt-BR')} coins.` });
      }
      marcarSujo(p);
      try {
        await gdb.criarGuild(p.dbId, m.nome, m.brasao, {
          cobrarOuro: false,
          // A TAG escolhida na tela de criar. Vazia = as três primeiras letras do nome; uma
          // RESERVADA faz `criarGuild` recusar, e o ouro volta pelo mesmo `catch` do nome.
          tag: m.tag,
          tagCor: m.tagCor,
        });
      } catch (err) {
        p.gold += cobrado;
        marcarSujo(p);
        return evento(p, { k: 'aviso', msg: err.message });
      }
      try {
        await carregarGuild(p);
        evento(p, { k: 'guildCriada', nome: p.guild.nome });
        enviar(p, { t: SERVIDOR.GUILD, guild: p.guild });
      } catch (err) {
        evento(p, { k: 'aviso', msg: err.message });
      }
    });
  },

  /**
   * A TAG da guild: até três letras ao lado do nick, na cor escolhida.
   *
   * `recarregarGuildOnline` no fim, e não só `carregarGuild(p)`: a tag viaja no carimbo de cada
   * linha do chat (`ws.guildTag`, ver `lerCargo` no gateway), e esse carimbo só se atualiza
   * quando o delta de estado do MEMBRO passa por ele. Sem recarregar a guild inteira, os outros
   * nove continuariam falando com a tag velha até o próximo login.
   */
  'guild.tag': async (p, m) => {
    if (!podeGerirGuild(p)) return evento(p, { k: 'aviso', msg: 'guild.tagSoDono' });
    try {
      const r = await gdb.atualizarTagGuild(p.dbId, m?.tag, m?.tagCor);
      const guildId = p.guild.id;
      await recarregarGuildOnline(guildId);
      evento(p, { k: 'aviso', msg: r.semMudanca ? 'guild.tagIgual' : 'guild.tagSalva' });
      enviar(p, { t: SERVIDOR.GUILD, guild: p.guild });
    } catch (err) {
      // `horas` viaja junto: é o que preenche o "{horas}" de `guild.tagEspera`, como no brasão.
      const ev = { k: 'aviso', msg: err.message };
      if (err.horas != null) ev.horas = err.horas;
      evento(p, ev);
    }
  },

  'guild.editarBrasao': async (p, m) => {
    if (!podeGerirGuild(p)) return evento(p, { k: 'aviso', msg: 'guild.semMando' });
    try {
      await gdb.atualizarBrasao(p.dbId, m.brasao);
      await carregarGuild(p);
      await recarregarGuildOnline(p.guild.id);
      evento(p, { k: 'aviso', msg: 'guild.brasaoSalvo' });
      enviar(p, { t: SERVIDOR.GUILD, guild: p.guild });
    } catch (err) {
      const ev = { k: 'aviso', msg: err.message };
      if (err.horas != null) ev.horas = err.horas;
      evento(p, ev);
    }
  },

  'guild.convidar': async (p, m) => {
    if (!podeGerirGuild(p)) return evento(p, { k: 'aviso', msg: 'guild.semMando' });
    try {
      const r = await gdb.convidarMembro(p.dbId, m.nick);
      evento(p, { k: 'guildConviteEnviado', nick: r.nick });
      await avisarConvitesOnline(r.alvoId);
    } catch (err) {
      evento(p, { k: 'aviso', msg: err.message });
    }
  },

  'guild.aceitar': async (p, m) => {
    if (p.guild) return evento(p, { k: 'aviso', msg: 'Você já está em uma guild.' });
    try {
      const r = await gdb.aceitarConvite(p.dbId, m.inviteId);
      await carregarGuild(p);
      marcarSujo(p);
      await recarregarGuildOnline(r.guildId);
      evento(p, { k: 'guildEntrou', nome: p.guild.nome });
      enviar(p, { t: SERVIDOR.GUILD, guild: p.guild, convites: [] });
    } catch (err) {
      evento(p, { k: 'aviso', msg: err.message });
    }
  },

  'guild.recusar': async (p, m) => {
    try {
      await gdb.recusarConvite(p.dbId, m.inviteId);
      p.guildConvites = await gdb.convitesPendentes(p.dbId);
      enviar(p, { t: SERVIDOR.GUILD, convites: p.guildConvites });
    } catch (err) {
      evento(p, { k: 'aviso', msg: err.message });
    }
  },

  'guild.sair': async (p) => {
    if (!p.guild) return evento(p, { k: 'aviso', msg: 'Você não está em uma guild.' });
    if (p.guild.isOwner) return evento(p, { k: 'aviso', msg: 'O dono não pode sair — apague a guild.' });
    try {
      const guildId = p.guild.id;
      await gdb.sairDaGuild(p.dbId);
      p.guild = null;
      p.guildBonusPct = 0;
      p.guildBonusRank = 0;
      p.guildConvites = [];
      marcarSujo(p);
      await recarregarGuildOnline(guildId);
      evento(p, { k: 'guildSaiu' });
      enviar(p, { t: SERVIDOR.GUILD, guild: null, convites: [] });
    } catch (err) {
      evento(p, { k: 'aviso', msg: err.message });
    }
  },

  'guild.expulsar': async (p, m) => {
    if (!podeGerirGuild(p)) return evento(p, { k: 'aviso', msg: 'guild.semMando' });
    try {
      const alvoId = Number(m.alvoId);
      if (!Number.isFinite(alvoId)) return evento(p, { k: 'aviso', msg: 'Membro inválido.' });
      const r = await gdb.expulsarMembro(p.dbId, alvoId);
      await carregarGuild(p);
      for (const jog of jogadores.values()) {
        if (jog.dbId === r.playerId) {
          await carregarGuild(jog);
          jog.aSincronizar = true;
          enviar(jog, { t: SERVIDOR.GUILD, guild: null, convites: jog.guildConvites });
        }
      }
      evento(p, { k: 'guildExpulsou', playerId: r.playerId });
      enviar(p, { t: SERVIDOR.GUILD, guild: p.guild });
    } catch (err) {
      evento(p, { k: 'aviso', msg: err.message });
    }
  },

  /**
   * Nomeia (ou tira) um sub-dono. Só o DONO — quem controla a permissão controla a guild.
   *
   * Recarrega a guild de todo mundo que está online: o promovido precisa ver os botões
   * aparecerem sem recarregar a página, e o resto da guild precisa ver o selo dele na lista.
   */
  'guild.subdono': async (p, m) => {
    if (!p.guild?.isOwner) return evento(p, { k: 'aviso', msg: 'guild.soDono' });
    try {
      const guildId = p.guild.id;
      const r = await gdb.definirSubdono(p.dbId, m?.alvoId, !!m?.ligado);
      await recarregarGuildOnline(guildId);
      evento(p, { k: 'aviso', msg: r.subdono ? 'guild.subdonoOk' : 'guild.subdonoFora', nick: r.nick });
      enviar(p, { t: SERVIDOR.GUILD, guild: p.guild });
      // O promovido ouve de quem o promoveu — e já com o painel atualizado pelo recarregar.
      for (const jog of jogadores.values()) {
        if (jog.dbId !== r.playerId) continue;
        evento(jog, { k: 'aviso', msg: r.subdono ? 'guild.virouSubdono' : 'guild.deixouSubdono' });
        enviar(jog, { t: SERVIDOR.GUILD, guild: jog.guild });
      }
    } catch (err) {
      evento(p, { k: 'aviso', msg: err.message });
    }
  },

  'guild.transferirLider': async (p, m) => {
    if (!p.guild?.isOwner) return evento(p, { k: 'aviso', msg: 'Somente o dono pode transferir a liderança.' });
    try {
      const alvoId = Number(m.alvoId);
      if (!Number.isFinite(alvoId)) return evento(p, { k: 'aviso', msg: 'Membro inválido.' });
      const r = await gdb.transferirLideranca(p.dbId, alvoId);
      await recarregarGuildOnline(r.guildId);
      for (const jog of jogadores.values()) {
        if (jog.guild?.id === r.guildId) {
          jog.aSincronizar = true;
          enviar(jog, { t: SERVIDOR.GUILD, guild: jog.guild });
        }
      }
      evento(p, { k: 'guildLiderTransferido', nick: r.nick });
    } catch (err) {
      evento(p, { k: 'aviso', msg: err.message });
    }
  },

  'guild.apagar': async (p) => {
    if (!p.guild?.isOwner) return evento(p, { k: 'aviso', msg: 'Somente o dono pode apagar a guild.' });
    try {
      const guildId = p.guild.id;
      await gdb.apagarGuild(p.dbId);
      await recarregarGuildOnline(guildId);
      p.guild = null;
      p.guildBonusPct = 0;
      p.guildBonusRank = 0;
      marcarSujo(p);
      evento(p, { k: 'guildApagada' });
      enviar(p, { t: SERVIDOR.GUILD, guild: null });
    } catch (err) {
      evento(p, { k: 'aviso', msg: err.message });
    }
  },

  'guild.ranking': async (p) => {
    const linhas = await gdb.rankingGuild(50);
    enviar(p, { t: SERVIDOR.GUILD, ranking: linhas });
  },

  /**
   * A lista para o editor de escalação — quem está na guild e quem está no time.
   *
   * Leitura de MEMBRO, e não só do dono: quem não escala ainda precisa saber se está no time
   * (é o que decide se ele leva o bônus do dia e o diamante do mês). O que o servidor recusa
   * mais abaixo é a GRAVAÇÃO.
   */
  'guild.escalacao': async (p) => {
    if (!p.guild) return evento(p, { k: 'aviso', msg: 'Você não está em uma guild.' });
    try {
      const membros = await gdb.membrosParaEscalacao(p.guild.id);
      enviar(p, {
        t: SERVIDOR.GUILD,
        escalacao: { guildId: p.guild.id, max: MAX_TIME_GUILD, membros },
      });
    } catch (err) {
      console.error('[sim] guild.escalacao falhou:', err.message);
      evento(p, { k: 'aviso', msg: 'Não deu para carregar a escalação agora.' });
    }
  },

  /**
   * O dono grava o time da guild. Os escalados são os únicos que vão à guerra e, por
   * consequência, os únicos que levam o bônus diário e o prêmio do mês — por isso a resposta
   * recarrega a guild de TODO membro online, e não só a de quem clicou.
   */
  'guild.escalacao.salvar': async (p, m) => {
    if (!podeGerirGuild(p)) return evento(p, { k: 'aviso', msg: 'guild.semMando' });
    try {
      const guildId = p.guild.id;
      await gdb.definirEscalacao(p.dbId, m?.playerIds);
      await recarregarGuildOnline(guildId);
      const membros = await gdb.membrosParaEscalacao(guildId);
      evento(p, { k: 'guildEscalacaoSalva' });
      enviar(p, {
        t: SERVIDOR.GUILD,
        guild: p.guild,
        escalacao: { guildId, max: MAX_TIME_GUILD, membros },
      });
    } catch (err) {
      evento(p, { k: 'aviso', msg: err.message });
    }
  },

  /**
   * A ficha pública de uma guild do ranking: os membros e a equipe de guerra de cada um.
   *
   * É leitura pública de propósito — não pede ser membro. O ranking já expõe nome, dono e GP
   * de toda guild, e a pergunta que ele deixava sem resposta ("essa aí em primeiro é forte ou
   * só numerosa?") é justamente a que decide entrar numa guild ou desafiá-la. Esconder isso
   * não protegeria ninguém: quem quisesse saber abria o perfil dos membros um a um.
   *
   * As equipes passam por `montarPokemon` + `empacotarFichaResposta`, os mesmos dois do placar
   * de poder e do chat — a ficha que abre daqui é a MESMA de todo o resto do jogo.
   */
  'guild.detalhe': async (p, m) => {
    const guildId = Number(m?.guildId);
    if (!Number.isFinite(guildId) || guildId <= 0) return;
    try {
      const d = await gdb.detalheDaGuild(guildId);
      if (!d) return evento(p, { k: 'aviso', msg: 'Essa guild não existe mais.' });
      const onlineIds = new Set(
        [...jogadores.values()].filter((j) => j.dbId).map((j) => j.dbId),
      );
      enviar(p, {
        t: SERVIDOR.GUILD,
        detalhe: {
          ...d,
          membros: d.membros.map(({ linhasEquipe, ...membro }) => ({
            ...membro,
            online: onlineIds.has(membro.playerId),
            equipe: linhasEquipe
              .map((linha) => {
                // Espécie fora do catálogo (conteúdo removido) devolve `undefined` em
                // `montarPokemon` e derrubaria a ficha inteira da guild por causa de um bicho.
                try {
                  return empacotarFichaResposta(montarPokemon(linha), membro.nick);
                } catch {
                  return null;
                }
              })
              .filter(Boolean),
          })),
        },
      });
    } catch (err) {
      console.error('[sim] guild.detalhe falhou:', err.message);
      evento(p, { k: 'aviso', msg: 'Não deu para carregar essa guild agora.' });
    }
  },

  'guild.pvp.info': async (p) => {
    const pvp = await infoGuildWar(p);
    enviar(p, { t: SERVIDOR.GUILD, pvp });
  },

  'guild.pvp.registrar': async (p) => {
    if (!podeGerirGuild(p)) return evento(p, { k: 'aviso', msg: 'guild.semMando' });
    try {
      await gdb.registrarGuildPvp(p.guild.id, p.dbId, gdb.dataEventoGuild());
      p.guild.pvpAutoRegistro = true;
      const pvp = await infoGuildWar(p);
      evento(p, { k: 'guildRegistrada' });
      enviar(p, { t: SERVIDOR.GUILD, guild: p.guild, pvp });
    } catch (err) {
      evento(p, { k: 'aviso', msg: err.message });
    }
  },

  'guild.pvp.equipe.salvar': async (p, m) => {
    if (!p.guild) return evento(p, { k: 'aviso', msg: 'Você não está em uma guild.' });
    try {
      const pvpEquipe = await gdb.salvarEquipeGuerra(p.dbId, m.pokemonIds, MAX_EQUIPE);
      evento(p, { k: 'guildEquipeSalva' });
      enviar(p, { t: SERVIDOR.GUILD, pvpEquipe });
    } catch (err) {
      evento(p, { k: 'aviso', msg: err.message });
    }
  },

  /**
   * A gravação da guerra, para o botão "assistir ao replay".
   *
   * Vai num pacote só e por PEDIDO — é o único conteúdo do jogo que passa de algumas dezenas
   * de KB, e mandá-lo junto do painel faria todo mundo que abre o PvP pagar por um vídeo que
   * só alguns querem ver.
   */
  'guild.pvp.replay': async (p, m) => {
    const dia = typeof m?.dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.dia) ? m.dia : null;
    try {
      const r = await replayGuildWar(dia);
      if (!r) return evento(p, { k: 'aviso', msg: 'Nenhuma guerra gravada ainda.' });
      enviar(p, { t: SERVIDOR.GUILD, replay: r });
    } catch (err) {
      console.error('[sim] replay de guild falhou:', err.message);
      evento(p, { k: 'aviso', msg: 'Não deu para carregar o replay agora.' });
    }
  },

  /**
   * A ANÁLISE da guerra: dano, abates e pokémon de cada jogador, tirados da fita. Leitura
   * pública, como o replay — qualquer um assiste a qualquer guerra. O `dia` passa pela mesma
   * peneira do replay antes de chegar ao SQL, e o cálculo tem cache por dia (`analiseGuildWar`).
   */
  'guild.pvp.analise': async (p, m) => {
    const dia = typeof m?.dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.dia) ? m.dia : null;
    try {
      const analise = await analiseGuildWar(dia);
      enviar(p, { t: SERVIDOR.GUILD, analise: analise ?? { vazia: true } });
    } catch (err) {
      console.error('[sim] análise de guild falhou:', err.message);
      evento(p, { k: 'aviso', msg: 'guild.analiseFalhou' });
    }
  },

  // ------------------------------------------------------------------ Ginásios
  //
  // TODO pedido de ginásio responde com um pacote `GINASIO`, inclusive quando dá errado — daí
  // o `recusarGinasio` abaixo. A tela arma um relógio ao pedir e o desarma ao receber; se a
  // recusa saísse só como `aviso`, o relógio continuaria correndo e a tela mostraria um
  // "não deu para carregar" doze segundos depois de o jogador já ter lido o motivo real.

  /** A grade dos 18: quem lidera cada um e o que EU tenho registrado em cada. */
  'ginasio.info': async (p) => {
    try {
      enviar(p, { t: SERVIDOR.GINASIO, info: await infoGinasios(p.dbId, p.level) });
    } catch (err) {
      console.error('[sim] ginasio.info falhou:', err.message);
      recusarGinasio(p, 'Não deu para abrir os ginásios agora.');
    }
  },

  /** Um ginásio aberto: o pódio, a minha posição e o meu time. */
  'ginasio.painel': async (p, m) => {
    try {
      const painel = await painelDoGinasio(p.dbId, m?.tipo);
      if (!painel) return recusarGinasio(p, 'Ginásio desconhecido.');
      enviar(p, { t: SERVIDOR.GINASIO, painel });
    } catch (err) {
      console.error('[sim] ginasio.painel falhou:', err.message);
      recusarGinasio(p, 'Não deu para abrir o ginásio agora.');
    }
  },

  /**
   * Registra (ou esvazia) o time de um ginásio.
   *
   * O nível de treinador é conferido AQUI e não só no botão: o editor do cliente some para
   * quem não chegou ao 150, mas um cliente adulterado manda a mensagem do mesmo jeito.
   */
  'ginasio.salvar': async (p, m) => {
    if ((p.level ?? 0) < GINASIO_NIVEL_MIN) {
      return recusarGinasio(p, `Ginásios são a partir do nível ${GINASIO_NIVEL_MIN} de treinador.`);
    }
    try {
      const salvo = await gindb.salvarTime(p.dbId, m?.tipo, m?.pokemonIds);
      // O pódio muda no instante em que o time muda — reapura antes de responder para a tela
      // não desenhar o líder velho ao lado do time novo. Ver `apurarAgora`.
      await apurarAgora().catch((err) => console.error('[sim] apurar ginásios falhou:', err.message));
      // Quem avisa é a TELA (`gin.salvoOk`), com o nome do ginásio no texto — um `evento`
      // daqui viraria um segundo aviso dizendo a mesma coisa com menos informação.
      enviar(p, { t: SERVIDOR.GINASIO, salvo, painel: await painelDoGinasio(p.dbId, salvo.tipo) });
      marcarSujo(p);
    } catch (err) {
      recusarGinasio(p, err.message);
    }
  },

  /** A luta amistosa contra o líder — só para ver o tamanho da diferença. */
  'ginasio.desafiar': async (p, m) => {
    try {
      enviar(p, { t: SERVIDOR.GINASIO, desafio: await desafiarLider(p.dbId, m?.tipo) });
    } catch (err) {
      if (!(err instanceof gindb.ErroGinasio)) {
        console.error('[sim] desafio de ginásio falhou:', err.message);
      }
      recusarGinasio(p, err instanceof gindb.ErroGinasio ? err.message : 'Não deu para simular o desafio agora.');
    }
  },

  // -------------------------------------------------------- Área de Treinamento
  //
  // A bancada de testes: dois lados montados na mão lutam pelas regras do Ranqueado, e o jogador
  // assiste. Note o que NÃO existe aqui: nenhum `marcarSujo`, nenhuma escrita, nenhuma chamada de
  // recompensa. A única coisa que sobe é a fita. Ver `game/treino.mjs`.
  'treino.lutar': (p, m) => {
    (async () => {
      if (!p.dbId) return;
      // A vez é reivindicada ANTES de montar qualquer coisa: é o que impede que dois pedidos
      // colados (duas abas, um script) rodem duas simulações do mesmo jogador ao mesmo tempo.
      const vez = await reivindicarVez(p.dbId);
      if (!vez.ok) {
        return enviar(p, { t: SERVIDOR.TREINO, recusa: { chave: 'treino.recusa.espera', restaMs: vez.restaMs } });
      }
      try {
        enviar(p, { t: SERVIDOR.TREINO, resultado: await lutaDeTreino(p, m) });
      } catch (err) {
        // A luta não aconteceu: devolve a vez em vez de cobrar cinco minutos por um clique num
        // pokémon que já não estava lá.
        await devolverVez(p.dbId);
        if (!(err instanceof ErroTreino)) console.error('[treino] batalha falhou:', err.message);
        enviar(p, {
          t: SERVIDOR.TREINO,
          recusa: { chave: err instanceof ErroTreino ? err.message : 'treino.recusa.erro' },
        });
      }
    })().catch((err) => console.error('[treino] falhou:', err.message));
  },

  // ------------------------------------------------------------ lista de amigos
  //
  // Toda a lógica mora aqui (coesa com a guild). A DM ao vivo é repassada ponto a ponto,
  // como o sussurro (`entregarAoOnline`); a persistência de 7 dias e a caixa postal de
  // coins vivem em `amigos-db.mjs`. Nível 10 nas duas pontas para tudo — a trava do chat.

  /** Lista de amigos + pedidos recebidos + ids para quem já mandei pedido. */
  'amigos.info': async (p) => {
    if (!p.dbId) return;
    await carregarAmigos(p);
    const enviados = await amigosDb.pedidosEnviados(p.dbId).catch(() => []);
    enviar(p, { t: SERVIDOR.AMIGOS, lista: p.amigos, pedidos: p.amigosPedidos, enviados, pvpa: await estadoAmistoso(p) });
  },

  // ------------------------------------------------------------ PvP amistoso
  //
  // O desafio entre dois amigos pela conversa: convite de 5 min, luta pelas regras do Ranqueado,
  // espera de 5 min para os DOIS. As travas atômicas moram em `game/pvp-amistoso.mjs`; aqui
  // ficam a amizade, a presença e a linha da conversa (DM do tipo 3).

  /** Desafia um amigo. O convite vira uma linha da conversa com Aceitar / Recusar. */
  'amigo.pvp.convidar': async (p, m) => {
    if (amigoTravadoPorNivel(p)) return;
    if (!p.dbId || !idClienteValido(m?.amigoId)) return;
    const agoraMs = agora();
    // A mesma folga da DM: cada convite é uma linha no banco e um aviso do outro lado.
    if (agoraMs - (p.ultimoConvitePvp ?? 0) < 5000) return evento(p, { k: 'aviso', msg: 'amigos.pvpa.devagar' });
    p.ultimoConvitePvp = agoraMs;
    const amigoId = Number(m.amigoId);
    if (!(await amigosDb.saoAmigos(p.dbId, amigoId))) return evento(p, { k: 'aviso', msg: 'amigos.naoEncontrado' });
    const alvo = await amigosDb.dadosBasicos(amigoId);
    if (!alvo || alvo.id === p.dbId) return;
    // Convite para quem está offline só expiraria sozinho: ele não tem como aceitar em 5 min.
    if (!(await gatewayDoJogador(String(alvo.nick).toLowerCase()))) {
      return evento(p, { k: 'aviso', msg: 'amigos.pvpa.offline', params: { nick: alvo.nick } });
    }
    let convite;
    try {
      convite = await pvpAmistoso.criarConvite(
        { key: p.key, dbId: p.dbId, nick: p.nick },
        { key: String(alvo.nick).toLowerCase(), dbId: alvo.id, nick: alvo.nick },
        agoraMs,
      );
    } catch (err) {
      if (err instanceof pvpAmistoso.ErroAmistoso) return evento(p, { k: 'aviso', msg: err.chave, params: err.params });
      console.error('[pvp-amistoso] convite falhou:', err.message);
      return evento(p, { k: 'aviso', msg: 'amigos.erroGenerico' });
    }
    const texto = textoDoConvite(convite, 'pendente');
    try {
      const r = await amigosDb.gravarDM(p.dbId, amigoId, texto, { tipo: 3 });
      convite = await pvpAmistoso.anotarLinhaDaConversa(convite, r.id);
      const linha = { id: r.id, de: p.nick, deId: p.dbId, para: alvo.nick, texto, tipo: 3, ts: r.ts };
      enviar(p, { t: SERVIDOR.AMIGOS, dm: linha, pvpa: await estadoAmistoso(p) });
      entregarAoOnline(alvo.nick, { t: SERVIDOR.AMIGOS, dm: linha }).catch(() => {});
    } catch (err) {
      // Sem a linha da conversa não há onde aceitar: o convite é desfeito em vez de ficar órfão.
      console.error('[pvp-amistoso] linha do convite falhou:', err.message);
      await pvpAmistoso.cancelarConvite(convite.id, p.key).catch(() => {});
      evento(p, { k: 'aviso', msg: 'amigos.erroGenerico' });
    }
  },

  /** Aceita (luta na hora) ou recusa. Só o convidado alcança o convite — ver `LUA_CONSUMIR`. */
  'amigo.pvp.responder': async (p, m) => {
    if (!p.dbId || !pvpAmistoso.idConviteValido(m?.conviteId)) return;
    const eu = { key: p.key, dbId: p.dbId, nick: p.nick };
    if (m.aceitar !== true) {
      const convite = await pvpAmistoso.recusarConvite(m.conviteId, p.key).catch(() => null);
      if (!convite) return evento(p, { k: 'aviso', msg: 'amigos.pvpa.sumiu' });
      await fecharConviteNaConversa(convite, 'recusado');
      entregarAoOnline(convite.deNick, { t: SERVIDOR.AMIGOS, pvpa: { recusou: p.nick } }).catch(() => {});
      return;
    }
    // A amizade é conferida de novo na hora de aceitar: quem desfez a amizade depois do convite
    // não luta por ele. O convite é recusado em nome do convidado, e a bolha diz isso.
    const previa = await pvpAmistoso.lerConvite(m.conviteId);
    if (previa && previa.paraKey === p.key && !(await amigosDb.saoAmigos(p.dbId, previa.deId))) {
      const desfeito = await pvpAmistoso.recusarConvite(m.conviteId, p.key).catch(() => null);
      if (desfeito) await fecharConviteNaConversa(desfeito, 'cancelado');
      return evento(p, { k: 'aviso', msg: 'amigos.naoEncontrado' });
    }
    let r;
    try {
      r = await pvpAmistoso.aceitarConvite(m.conviteId, eu, agora());
    } catch (err) {
      if (err instanceof pvpAmistoso.ErroAmistoso) {
        // A luta não aconteceu DEPOIS de o convite ser consumido (equipe vazia, ou o desafiante
        // entrou em espera no mesmo instante): a bolha tem de dizer isso — senão ela ficaria com
        // Aceitar/Recusar até o prazo acabar. Recusa de ANTES do consumo (eu ainda espero) deixa
        // o convite vivo, e a bolha continua valendo.
        if (err.chave !== 'amigos.pvpa.sumiu' && !(await pvpAmistoso.conviteExiste(m.conviteId))) {
          await fecharConviteNaConversa({ id: m.conviteId, ...(await conviteDaConversa(p, m.conviteId)) }, 'falhou');
        }
        return evento(p, { k: 'aviso', msg: err.chave, params: err.params });
      }
      console.error('[pvp-amistoso] luta falhou:', err.message);
      return evento(p, { k: 'aviso', msg: 'amigos.erroGenerico' });
    }
    const { convite, partida } = r;
    await fecharConviteNaConversa(convite, 'aceito', { venc: partida.vencedor });
    const ateEm = agora() + pvpAmistoso.ESPERA_MS;
    // Os dois recebem a fita pelo mesmo caminho (o gateway de cada um), cada um do seu lado.
    entregarAoOnline(convite.paraNick, {
      t: SERVIDOR.AMIGOS, pvpAmistoso: pvpAmistoso.pacoteParaLado(partida, false), pvpa: { esperaAte: ateEm, saida: null },
    }).catch(() => {});
    entregarAoOnline(convite.deNick, {
      t: SERVIDOR.AMIGOS, pvpAmistoso: pvpAmistoso.pacoteParaLado(partida, true), pvpa: { esperaAte: ateEm, saida: null },
    }).catch(() => {});
    auditar(p, 'pvp', 'amistoso', `${convite.deNick} × ${convite.paraNick} — venceu ${partida.vencedor}`, `pvpa:${convite.id}`);
  },

  /** Quem desafiou desiste do convite enquanto ele ainda está pendente. */
  'amigo.pvp.cancelar': async (p, m) => {
    if (!p.dbId || !pvpAmistoso.idConviteValido(m?.conviteId)) return;
    const convite = await pvpAmistoso.cancelarConvite(m.conviteId, p.key).catch(() => null);
    if (!convite) return evento(p, { k: 'aviso', msg: 'amigos.pvpa.sumiu' });
    await fecharConviteNaConversa(convite, 'cancelado');
    enviar(p, { t: SERVIDOR.AMIGOS, pvpa: await estadoAmistoso(p) });
  },

  /** A fita de uma luta amistosa, para o "Assistir" da conversa (guardada por 30 min). */
  'amigo.pvp.fita': async (p, m) => {
    if (!p.dbId || !pvpAmistoso.idConviteValido(m?.conviteId)) return;
    const partida = await pvpAmistoso.fitaDaLuta(m.conviteId, p.key);
    if (!partida) return evento(p, { k: 'aviso', msg: 'amigos.pvpa.fitaExpirou' });
    const souDesafiante = String(partida.de).toLowerCase() === p.key;
    enviar(p, { t: SERVIDOR.AMIGOS, pvpAmistoso: { ...pvpAmistoso.pacoteParaLado(partida, souDesafiante), reprise: true } });
  },

  /** Pede amizade pelo nick. Se já havia pedido inverso, a amizade é selada na hora. */
  'amigo.pedir': async (p, m) => {
    if (amigoTravadoPorNivel(p)) return;
    if (!p.dbId) return;
    // Nick tem no máximo 16 chars (ver `nickValido`); corta em 32 antes de ir ao banco.
    const nick = String(m?.nick ?? '').slice(0, 32).trim();
    if (!nick) return evento(p, { k: 'aviso', msg: 'amigos.naoEncontrado' });
    try {
      const r = await amigosDb.criarPedido(p.dbId, nick);
      await carregarAmigos(p);
      if (r.jaAmigos) {
        enviar(p, { t: SERVIDOR.AMIGOS, lista: p.amigos, pedidos: p.amigosPedidos });
        evento(p, { k: 'amigoAceito', nick: r.paraNick });
        avisarAmigoSync(r.paraNick, { k: 'amigoAceito', nick: p.nick });
      } else {
        const enviados = await amigosDb.pedidosEnviados(p.dbId).catch(() => []);
        enviar(p, { t: SERVIDOR.AMIGOS, enviados });
        evento(p, { k: 'amigoPedidoEnviado', nick: r.paraNick });
        avisarAmigoSync(r.paraNick, { k: 'amigoPedidoRecebido', nick: p.nick });
      }
    } catch (err) {
      evento(p, { k: 'aviso', msg: msgErroAmigo(err) });
    }
  },

  'amigo.aceitar': async (p, m) => {
    if (amigoTravadoPorNivel(p)) return;
    if (!p.dbId || !idClienteValido(m?.pedidoId)) return;
    try {
      const r = await amigosDb.aceitarPedido(p.dbId, Number(m.pedidoId));
      await carregarAmigos(p);
      enviar(p, { t: SERVIDOR.AMIGOS, lista: p.amigos, pedidos: p.amigosPedidos });
      evento(p, { k: 'amigoAceito', nick: r.amigoNick });
      avisarAmigoSync(r.amigoNick, { k: 'amigoAceito', nick: p.nick });
    } catch (err) {
      evento(p, { k: 'aviso', msg: msgErroAmigo(err) });
    }
  },

  'amigo.recusar': async (p, m) => {
    if (!p.dbId || !idClienteValido(m?.pedidoId)) return;
    try {
      await amigosDb.recusarPedido(p.dbId, Number(m.pedidoId));
    } catch (err) {
      // pedido que já sumiu não é erro que valha um toast — só recarrega a lista
      if (!(err instanceof amigosDb.ErroAmigo)) console.error('[amigos] recusar:', err.message);
    }
    await carregarAmigos(p);
    enviar(p, { t: SERVIDOR.AMIGOS, pedidos: p.amigosPedidos });
  },

  'amigo.remover': async (p, m) => {
    if (!p.dbId || !idClienteValido(m?.amigoId)) return;
    try {
      const r = await amigosDb.removerAmigo(p.dbId, Number(m.amigoId));
      await carregarAmigos(p);
      enviar(p, { t: SERVIDOR.AMIGOS, lista: p.amigos });
      evento(p, { k: 'amigoRemovido', nick: r.amigoNick ?? '' });
      if (r.amigoNick) avisarAmigoSync(r.amigoNick);
    } catch (err) {
      evento(p, { k: 'aviso', msg: msgErroAmigo(err) });
    }
  },

  /** Carrega o histórico de uma conversa (7 dias) e marca as recebidas como lidas. */
  'amigo.dm.abrir': async (p, m) => {
    if (!p.dbId || !idClienteValido(m?.amigoId)) return;
    const amigoId = Number(m.amigoId);
    if (!(await amigosDb.saoAmigos(p.dbId, amigoId))) {
      return evento(p, { k: 'aviso', msg: 'amigos.naoEncontrado' });
    }
    const mensagens = await amigosDb.historicoDM(p.dbId, amigoId);
    await amigosDb.marcarLidas(p.dbId, amigoId);
    await carregarAmigos(p);
    enviar(p, { t: SERVIDOR.AMIGOS, conversa: { amigoId, mensagens }, lista: p.amigos });
  },

  /**
   * Só marca como lidas — sem recarregar o histórico. É o que o cliente chama quando uma DM
   * nova chega COM a conversa já aberta: reenviar as 200 linhas a cada mensagem faria a
   * thread piscar e o scroll pular no meio da leitura.
   */
  'amigo.dm.ler': async (p, m) => {
    if (!p.dbId || !idClienteValido(m?.amigoId)) return;
    const amigoId = Number(m.amigoId);
    if (!(await amigosDb.saoAmigos(p.dbId, amigoId))) return;
    await amigosDb.marcarLidas(p.dbId, amigoId);
    await carregarAmigos(p);
    enviar(p, { t: SERVIDOR.AMIGOS, lista: p.amigos });
  },

  'amigo.dm.enviar': async (p, m) => {
    if (amigoTravadoPorNivel(p)) return;
    if (!p.dbId || !idClienteValido(m?.amigoId)) return;
    const amigoId = Number(m.amigoId);
    const agoraMs = agora();
    // 5 s entre DMs — a DM é persistida (7 dias) e entregue cross-shard, então segura mais
    // que o sussurro (1 s, efêmero). Vale como anti-flood mesmo com o balde de 20 msg/s do socket.
    if (agoraMs - (p.ultimoDM ?? 0) < 5000) return evento(p, { k: 'aviso', msg: 'amigos.dmEspera' });
    if (!(await amigosDb.saoAmigos(p.dbId, amigoId))) {
      return evento(p, { k: 'aviso', msg: 'amigos.naoEncontrado' });
    }
    const alvo = await amigosDb.dadosBasicos(amigoId);
    if (!alvo) return;

    const pokemonId = m.pokemonId != null && m.pokemonId !== '' ? Number(m.pokemonId) : null;
    if (pokemonId) {
      const pk = p.pokemons.get(pokemonId);
      if (!pk) return evento(p, { k: 'aviso', msg: 'esse pokémon não está mais com você' });
      const payload = JSON.stringify({
        nick: p.nick,
        pokemonId: pk.id,
        nome: pk.nome,
        level: pk.level,
        shiny: !!pk.shiny,
        potencia: pk.potencia,
        speciesId: pk.speciesId,
        looktype: pk.looktype,
        // Os números da fileira P·IV·Q·N que a bolha da conversa desenha. Sem eles o anexo
        // dizia nome e nível e mais nada — dá para saber QUAL pokémon é, não QUANTO ele vale,
        // que é o motivo de se mandar um pokémon para um amigo olhar. A nota o cliente calcula
        // sozinho a partir daqui com a espécie (`speciesId`) em mãos.
        quality: pk.quality,
        ivTotal: ivTotalDe(pk),
        refinoTotal: pk.refinoTotal ?? 0,
      });
      p.ultimoDM = agoraMs;
      const r = await amigosDb.gravarDM(p.dbId, amigoId, payload, { tipo: 2 });
      const linha = { id: r.id, de: p.nick, deId: p.dbId, para: alvo.nick, texto: payload, tipo: 2, ts: r.ts };
      enviar(p, { t: SERVIDOR.AMIGOS, dm: linha });
      entregarAoOnline(alvo.nick, { t: SERVIDOR.AMIGOS, dm: linha }).catch(() => {});
      return;
    }

    const texto = String(m?.texto ?? '').slice(0, amigosDb.DM_MAX_LEN).trim();
    if (!texto) return;
    if (chatContemNft(texto)) return evento(p, { k: 'aviso', msg: 'chat.nftBloqueado' });
    p.ultimoDM = agoraMs;
    const r = await amigosDb.gravarDM(p.dbId, amigoId, texto);
    const linha = { id: r.id, de: p.nick, deId: p.dbId, para: alvo.nick, texto, ts: r.ts };
    enviar(p, { t: SERVIDOR.AMIGOS, dm: linha }); // eco para o remetente
    entregarAoOnline(alvo.nick, { t: SERVIDOR.AMIGOS, dm: linha }).catch(() => {});
  },

  /**
   * Envia coins a um amigo. Taxa de 15% QUEIMADA — o líquido é `valor - ceil(valor*0,15)`,
   * que é exatamente `floor(valor*0,85)`; a taxa não é creditada a NINGUÉM.
   *
   * A ordem é: validar TUDO (sem mexer em nada), depois cobrar em memória com
   * `subtrairGold` (que faz clamp em 0 — é a defesa de verdade), e só então creditar/enfileirar
   * o líquido. Sem crédito antes de a cobrança fechar; um valor negativo/NaN/gigante é barrado
   * antes de qualquer débito (foi o buraco que existiu no Mercado). Nada é somado com valor
   * negativo — `somarGoldAuditado` descarta `<= 0` e a cobrança usa `subtrairGold`.
   */
  'amigo.coins': async (p, m) => {
    if (amigoTravadoPorNivel(p)) return;
    if (!p.dbId || !idClienteValido(m?.amigoId)) return;
    const amigoId = Number(m.amigoId);

    // 5 s entre envios de coins. Cada envio grava linha de auditoria + nota persistida na
    // conversa (e às vezes uma linha de caixa postal) — anti-flood mesmo com o balde de
    // 20 msg/s do socket. Igual à trava da DM.
    const agoraMs = agora();
    if (agoraMs - (p.ultimoCoinAmigo ?? 0) < 5000) {
      return evento(p, { k: 'aviso', msg: 'amigos.coinsEspera' });
    }

    // `valor` do cliente: só inteiro seguro e positivo passa. `Number('-1000')`, `'1e30'`,
    // `NaN`, `Infinity`, `1000.5`, `[]`, `{}` — todos caem aqui.
    const valor = Number(m?.valor);
    if (
      !Number.isSafeInteger(valor) ||
      valor < amigosDb.MIN_COINS_AMIGO
    ) {
      return evento(p, { k: 'aviso', msg: 'amigos.coinsMin' });
    }
    if (Math.floor(p.gold ?? 0) < valor) return evento(p, { k: 'aviso', msg: 'amigos.semSaldo' });

    if (!(await amigosDb.saoAmigos(p.dbId, amigoId))) {
      return evento(p, { k: 'aviso', msg: 'amigos.naoEncontrado' });
    }
    const alvo = await amigosDb.dadosBasicos(amigoId);
    if (!alvo || alvo.id === p.dbId) return; // alvo sumiu, ou (impossível pelo CHECK) é ele mesmo
    if (!p.admin && (alvo.level ?? 0) < CHAT_NIVEL_MIN) {
      return evento(p, { k: 'aviso', msg: 'amigos.nivelMinimoAlvo' });
    }

    const taxa = Math.ceil(valor * amigosDb.TAXA_COINS_AMIGO);
    const liquido = valor - taxa; // == floor(valor * 0,85), sempre > 0 pois valor >= 1000

    // Cobra. O clamp em 0 do `subtrairGold` é o que impede débito acima do saldo mesmo se
    // duas mensagens deste jogador se intercalarem no await acima.
    const saiu = subtrairGold(p, valor);
    if (saiu < valor) {
      if (saiu > 0) {
        somarGoldAuditado(p, saiu, 'amigo_estorno', 'saldo mudou — transferência desfeita', null, { sempre: true });
      }
      return evento(p, { k: 'aviso', msg: 'amigos.semSaldo' });
    }
    // Débito fechou — a partir daqui houve transferência de verdade, então arma o cooldown.
    p.ultimoCoinAmigo = agoraMs;

    const online = jogadorPorDbId(amigoId);
    if (online) {
      somarGoldAuditado(online, liquido, 'amigo_recebeu', `de ${p.nick}`, null, { sempre: true });
      marcarSujo(online);
      evento(online, { k: 'amigoCoinsRecebeu', nick: p.nick, valor: liquido });
      enviarEstado(online);
    } else {
      // Enfileira ANTES de considerar a cobrança final: se o banco falhar aqui, devolve o
      // valor inteiro ao remetente em vez de sumir com o dinheiro dele.
      try {
        await amigosDb.enfileirarCoins(amigoId, p.nick, liquido);
      } catch (err) {
        console.error('[amigos] enfileirar coins falhou:', err.message);
        somarGoldAuditado(p, valor, 'amigo_estorno', 'fila indisponível — envio desfeito', null, { sempre: true });
        marcarSujo(p);
        enviarEstado(p);
        return evento(p, { k: 'aviso', msg: 'amigos.erroGenerico' });
      }
      // Online noutro shard: cutuca aquele shard para recolher agora (senão a varredura de
      // 1 min mostraria o saldo bem depois). O `entregarCoinsDeAmigos` de lá emite o toast.
      avisarAmigoSync(alvo.nick, null, { coletarCoins: true });
    }

    marcarSujo(p);
    registrarCoinGrande({
      playerId: p.dbId, nick: p.nick, valor: -valor, saldoApos: p.gold,
      origem: 'amigo_enviou', detalhe: `-> ${alvo.nick} (liq. ${liquido}, taxa ${taxa})`, sempre: true,
    });

    // Linha de auditoria DENTRO da conversa (persistida, 7 dias, não conta como não lida). O
    // cliente formata "enviou X coins (taxa Y, recebeu Z)" a partir do bruto — taxa e líquido
    // são determinísticos. Falha aqui não desfaz a transferência: só o log é que fica sem a linha.
    try {
      const nota = await amigosDb.gravarDM(p.dbId, amigoId, '', { tipo: 1, valor });
      const notaLinha = { id: nota.id, de: p.nick, deId: p.dbId, para: alvo.nick, ts: nota.ts, tipo: 1, valor };
      enviar(p, { t: SERVIDOR.AMIGOS, dm: notaLinha });
      entregarAoOnline(alvo.nick, { t: SERVIDOR.AMIGOS, dm: notaLinha }).catch(() => {});
    } catch (err) {
      console.error('[amigos] nota de coins na conversa falhou:', err.message);
    }

    evento(p, { k: 'amigoCoinsEnviou', nick: alvo.nick, valor, liquido });
    enviarEstado(p);
  },

  /** Placar do mundo. A resposta é assíncrona (vai ao banco), então não devolve nada aqui. */
  'ranking.pedir': (p, m) => {
    responderRanking(p, String(m.aba ?? 'nivel'), m.bossKey).catch((err) =>
      console.error('[sim] ranking falhou:', err.message),
    );
  },

  /** Cartão de perfil de um treinador, aberto ao clicar num nome do ranking. */
  'ranking.perfil': (p, m) => {
    const nick = String(m.nick ?? '').slice(0, 16);
    if (!nick) return;
    db.perfilDoTreinador(nick, MAX_VITRINE)
      // `async` por causa da equipe de PvP, que é uma segunda ida ao banco lá embaixo. O
      // `.catch` do fim da cadeia continua valendo para ela.
      .then(async (perfil) => {
        if (!perfil) return evento(p, { k: 'aviso', msg: `treinador "${nick}" não encontrado` });
        perfil.xpNivel = xpTotalParaNivel(perfil.level);
        perfil.xpProximo = xpTotalParaNivel(perfil.level + 1);
        perfil.vip = vipAtivo({ vipAte: perfil.vipAte }, agora());
        // A vitrine do cartão: as linhas cruas viram ficha aqui, com o MESMO empacotamento da
        // ficha do ranking — é a mesma ficha que o clique num card vai abrir.
        perfil.vitrine = (perfil.vitrineLinhas ?? [])
          .map((linha) => empacotarFichaResposta(montarPokemon(linha), perfil.nick));
        delete perfil.vitrineLinhas;
        // A EQUIPE DE PVP, no mesmo empacotamento da vitrine.
        //
        // A vitrine responde "o que este jogador coleciona"; ela é escolha de exibição e quase
        // nunca é quem luta — o shiny raro fica guardado justamente por ser raro. Quem quer
        // entender o PvP precisa da outra pergunta: COM O QUE ele ganha. São os dois blocos, e
        // não um no lugar do outro.
        //
        // Falha de leitura não derruba a ficha: sem equipe salva (ou com o `pvp_time` fora do
        // ar) a seção simplesmente não aparece, e o resto do perfil abre igual.
        //
        // É SÓ a do PvP Ranqueado, e sempre, inscrito no campeonato ou não. A equipe escolhida
        // para o campeonato não aparece na ficha de ninguém: quem quer lutar lá com uma equipe
        // que os outros não viram escolhe uma em "Selecionar minha Equipe".
        //
        // O RANK vem junto, de `pvp_rank` e com a mesma posição que o login do dono usa
        // (`posicaoRankingElo`): é ela que decide Mestre e Challenger, e a ficha que os outros
        // veem não pode dar um emblema diferente do que o próprio jogador vê na dele. Falhou a
        // leitura, a ficha abre com "Não classificado" em vez de não abrir.
        [perfil.pvpTime, perfil.pvpRank] = await Promise.all([
          pvpdb.timePublicoLinhas(perfil.id)
            .then((linhas) => linhas.map((l) => empacotarFichaResposta(montarPokemon(l), perfil.nick)))
            .catch(() => []),
          Promise.all([
            pvpdb.rankPublicoDe(perfil.id),
            db.posicaoRankingElo(perfil.id, PVP_PARTIDAS_POSICIONAMENTO),
          ])
            .then(([linha, posicao]) => pvpdb.rankParaCliente(linha, posicao))
            .catch(() => null),
        ]);
        // A TAG DE FUNDADOR/COFUNDADOR. Saiu do chat (poluía toda linha, para sempre) e passou
        // a morar aqui, do lado do nick — que é onde a pergunta "quem é esse jogador?" se faz.
        // `tagDoLooktype` é a MESMA regra do chat de antes: vale a caixa da roupa que ele está
        // vestindo e, fora dela, a melhor que ele tem. Falha de leitura não derruba a ficha.
        perfil.fundador = await cxdb.tagsDoJogador(perfil.id)
          .then((tags) => tagDoLooktype(tags, perfil.looktype))
          .catch(() => null);
        // A GUILD do treinador, só para a tag e o nome no cabeçalho da ficha. Uma consulta por
        // clique numa ficha — e falhar não derruba nada: a ficha abre sem a tag.
        const guildDele = await gdb.guildDoJogador(perfil.id).catch(() => null);
        perfil.guildTag = guildDele?.tag ?? null;
        perfil.guildTagCor = guildDele?.tagCor ?? null;
        perfil.guildNome = guildDele?.nome ?? null;
        // Id de banco não vai para a tela — ele só existia para a consulta acima.
        delete perfil.id;
        enviar(p, { t: SERVIDOR.PERFIL, perfil });
      })
      .catch((err) => console.error('[sim] perfil falhou:', err.message));
  },

  // ---------------------------------------------------------------- Campeonato
  //
  // A aba inteira num pacote (`campeonato.info`) e as duas ações. O nível e o prazo são
  // conferidos AQUI: o botão da tela some para quem não pode, mas o pacote chega do mesmo jeito
  // de um cliente adulterado. A resposta de uma ação já traz a lista nova, para a tela não ter
  // de pedir de novo.
  'campeonato.info': async (p, m) => {
    if (!p.dbId) return;
    try {
      enviar(p, {
        t: SERVIDOR.CAMPEONATO,
        ...(await infoCampeonato({ dbId: p.dbId, nivel: p.level }, m?.id, agora())),
      });
    } catch (err) {
      console.error('[sim] campeonato.info falhou:', err.message);
      enviar(p, { t: SERVIDOR.CAMPEONATO, recusa: 'camp.recusa.falhou' });
    }
  },

  // A fita de UMA partida da chave. Vai por pedido, como a da Guerra de Guilds: são dezenas de
  // KB, e a lista de partidas não pode carregar todas.
  'campeonato.fita': async (p, m) => {
    try {
      const fita = await fitaDoCampeonato(m?.id, m?.partida, agora());
      enviar(p, fita ? { t: SERVIDOR.CAMPEONATO, fita } : { t: SERVIDOR.CAMPEONATO, recusa: 'camp.recusa.semFita' });
    } catch (err) {
      console.error('[sim] campeonato.fita falhou:', err.message);
      enviar(p, { t: SERVIDOR.CAMPEONATO, recusa: 'camp.recusa.falhou' });
    }
  },

  'campeonato.inscrever': async (p, m) => {
    if (!p.dbId) return;
    try {
      const c = await inscreverNoCampeonato({ dbId: p.dbId, nivel: p.level }, m?.id, agora());
      auditar(p, 'campeonato', 'inscricao', `inscreveu-se no campeonato ${c.tipo} de ${c.dia} (nível ${p.level})`);
      enviar(p, {
        t: SERVIDOR.CAMPEONATO,
        acao: 'inscreveu',
        ...(await infoCampeonato({ dbId: p.dbId, nivel: p.level }, c.id, agora())),
      });
    } catch (err) {
      const chave = String(err.message).startsWith('camp.') ? err.message : 'camp.recusa.falhou';
      if (chave === 'camp.recusa.falhou') console.error('[sim] campeonato.inscrever falhou:', err.message);
      enviar(p, { t: SERVIDOR.CAMPEONATO, recusa: chave });
    }
  },

  /**
   * A equipe do campeonato: `{ pokemonIds }`, até cinco, na ordem. `[]` volta a valer a do PvP.
   * As regras moram em `game/campeonato.mjs` → `escolherEquipe`.
   */
  'campeonato.equipe': async (p, m) => {
    if (!p.dbId) return;
    try {
      const { ids, campeonato: c } = await escolherEquipeDoCampeonato({ dbId: p.dbId }, m?.pokemonIds, m?.id, agora());
      auditar(
        p, 'campeonato', 'equipe',
        ids.length
          ? `equipe do campeonato ${c.tipo} de ${c.dia}: ${ids.map((id) => {
            const pk = p.pokemons.get(id);
            return pk ? `${pk.shiny ? 'SHINY ' : ''}${pk.nome} Nv ${pk.level}` : `#${id}`;
          }).join(', ')}`
          : 'equipe do campeonato: volta a valer a do PvP',
      );
      enviar(p, {
        t: SERVIDOR.CAMPEONATO,
        acao: ids.length ? 'equipe' : 'equipePvp',
        ...(await infoCampeonato({ dbId: p.dbId, nivel: p.level }, c.id, agora())),
      });
    } catch (err) {
      const chave = String(err.message).startsWith('camp.') ? err.message : 'camp.recusa.falhou';
      if (chave === 'camp.recusa.falhou') console.error('[sim] campeonato.equipe falhou:', err.message);
      enviar(p, { t: SERVIDOR.CAMPEONATO, recusa: chave });
    }
  },

  'campeonato.cancelar': async (p, m) => {
    if (!p.dbId) return;
    try {
      const c = await cancelarInscricaoCampeonato({ dbId: p.dbId }, m?.id, agora());
      auditar(p, 'campeonato', 'cancelamento', `saiu do campeonato ${c.tipo} de ${c.dia}`);
      enviar(p, {
        t: SERVIDOR.CAMPEONATO,
        acao: 'cancelou',
        ...(await infoCampeonato({ dbId: p.dbId, nivel: p.level }, c.id, agora())),
      });
    } catch (err) {
      const chave = String(err.message).startsWith('camp.') ? err.message : 'camp.recusa.falhou';
      if (chave === 'camp.recusa.falhou') console.error('[sim] campeonato.cancelar falhou:', err.message);
      enviar(p, { t: SERVIDOR.CAMPEONATO, recusa: chave });
    }
  },

  /** Exibir ou ocultar shinies/P5 na ficha pública do treinador. */
  'perfil.statsPublico': async (p, m) => {
    if (!p.dbId) return;
    const pub = m?.publico !== false;
    p.perfilStatsPublico = pub;
    await db.atualizarPerfilStatsPublico(p.dbId, pub);
    enviarEstado(p);
  },

  /**
   * Monta a VITRINE da ficha: os pokémon que o jogador escolheu exibir.
   *
   * A lista chega inteira, e não em "põe este / tira aquele": a vitrine tem ORDEM, e ordem
   * editada por operação avulsa precisaria de um índice em cada mensagem para não embaralhar
   * quando dois cliques se cruzam. Seis ids num pacote resolvem isso sem estado nenhum.
   *
   * O que vale é só o que é DELE: ids repetidos, de outro dono ou já vendidos caem fora aqui,
   * então nada do que o cliente mandar vira um pokémon alheio na ficha.
   */
  'perfil.vitrine': (p, m) => {
    if (!p.dbId) return;
    const pedidos = normalizarIdsVitrine(m?.ids);
    p.vitrine = pedidos.filter((id) => p.pokemons.has(id));
    marcarSujo(p);
    enviarEstado(p);
  },

  /** Ficha do pokémon do placar de poder (qualidade, potência, stats…). */
  'ranking.pokemon': (p, m) => {
    const nick = String(m.nick ?? '').slice(0, 16);
    const speciesId = Number(m.speciesId);
    const level = Number(m.level);
    const power = Number(m.power);
    if (!nick || !speciesId || !level || !power) return;
    db.pokemonFichaRanking(nick, speciesId, level, power)
      .then((row) => {
        if (!row) return evento(p, { k: 'aviso', msg: 'pokémon não encontrado no placar' });
        const pk = montarPokemon(row);
        enviar(p, {
          t: SERVIDOR.RANKING_FICHA,
          pokemon: empacotarFichaResposta(pk, nick),
        });
      })
      .catch((err) => console.error('[sim] ranking.pokemon falhou:', err.message));
  },

  /** Compartilha um pokémon seu no chat (cooldown global de 2 min). Sem `pokemonId`, usa o ativo. */
  'chat.compartilhar': (p, m) => {
    const agora = Date.now();
    if (p.level < CHAT_NIVEL_MIN) {
      return evento(p, { k: 'aviso', msg: `Nível ${CHAT_NIVEL_MIN} para usar o chat.` });
    }
    if (agora < (p.compartilharPkAte ?? 0)) {
      return evento(p, { k: 'aviso', msg: 'Aguarde antes de compartilhar de novo.' });
    }
    const pedidoId = m.pokemonId == null || m.pokemonId === undefined ? null : Number(m.pokemonId);
    const pk = pedidoId != null && Number.isFinite(pedidoId)
      ? p.pokemons.get(pedidoId)
      : ativo(p);
    if (!pk) {
      return evento(p, {
        k: 'aviso',
        msg: pedidoId != null ? 'esse pokémon não está mais com você' : 'nenhum pokémon em campo',
      });
    }
    const canal = CANAIS_CHAT.includes(m.canal) ? m.canal : 'mundo';
    if (canal === 'guild' && !p.guild) {
      return evento(p, { k: 'aviso', msg: 'Entre numa guild para usar este chat.' });
    }
    const idioma = IDIOMAS_CHAT.includes(m.idioma) ? m.idioma : 'pt';
    p.compartilharPkAte = agora + 120_000;
    const payload = {
      id: randomUUID(),
      canal,
      idioma,
      de: p.nick,
      ts: agora,
      cargo: 'compartilhar',
      nivel: p.level,
      guildId: canal === 'guild' ? p.guild?.id : undefined,
      pkShare: { nick: p.nick, pokemonId: pk.id, nome: pk.nome },
    };
    publicar(CANAL_CHAT, payload);
    persistirChatPublico(payload);
    enviarEstado(p);
  },

  /** Abre a ficha de um pokémon compartilhado no chat. */
  'chat.verPokemon': (p, m) => {
    const nick = String(m.nick ?? '').slice(0, 16);
    const pokemonId = Number(m.pokemonId);
    if (!nick || !pokemonId) return;
    const local = p.nick.toLowerCase() === nick.toLowerCase() ? p.pokemons.get(pokemonId) : null;
    if (local) {
      return enviar(p, {
        t: SERVIDOR.RANKING_FICHA,
        pokemon: { ...empacotarFichaResposta(local, p.nick) },
      });
    }
    db.pokemonFichaPorNickEId(nick, pokemonId)
      .then((row) => {
        if (!row) return evento(p, { k: 'aviso', msg: 'pokémon não encontrado' });
        const pk = montarPokemon(row);
        enviar(p, { t: SERVIDOR.RANKING_FICHA, pokemon: empacotarFichaResposta(pk, nick) });
      })
      .catch((err) => console.error('[sim] chat.verPokemon falhou:', err.message));
  },

  /**
   * MODO ECONOMIA — o cliente avisa que desligou (ou religou) a cena.
   *
   * É a única preferência de TELA que o servidor precisa saber, e por um motivo bem concreto:
   * o campo é a maior fatia da banda de quem está caçando, e desenhar é a única coisa que se
   * faz com ele. Ligado, o sim para de serializar e de mandar; desligado, a cena inteira volta
   * num `campo.init`, porque o delta seguinte só traria quem se mexeu.
   *
   * Não mexe em NADA do jogo: a hunt continua, o combate continua, os eventos de batalha
   * (`batalha`) continuam chegando — é deles que sai a prancheta que o modo mostra na tela.
   */
  'cliente.economia': (p, m) => {
    const ativo = !!m.ativo;
    if (!!p.semCampo === ativo) return;
    p.semCampo = ativo;
    if (!ativo) reenviarCena(p);
  },

  'hunt.select': (p, m) => {
    const trava = msgBloqueioTrocaDeHunt(p, agora());
    if (trava) return evento(p, { k: 'aviso', msg: trava });
    const h = huntJogavelPorSlug.get(m.slug);
    if (!h) return evento(p, { k: 'aviso', msg: `"${m.slug}" não é uma área caçável` });
    if (!areaLiberada(p, h)) {
      return evento(p, { k: 'aviso', msg: `${h.nome} pede nível ${h.nivel} — você está no ${p.level}` });
    }
    if (!entrarNaHunt(p, h.slug)) {
      return evento(p, { k: 'aviso', msg: `"${m.slug}" não tem área andável mapeada` });
    }
    marcarSujo(p);
    evento(p, { k: 'hunt', slug: h.slug, nome: h.nome });
  },

  /**
   * Troca de Outland: 1, 2 ou 3.
   *
   * NÃO é uma troca de área — o mapa, os selvagens e o nível 150 deles são os mesmos, e por
   * isso não passa pela trava de 3 s do `hunt.select`: ninguém está saindo de lugar nenhum.
   * O que muda é o multiplicador dos três drops raros da área.
   *
   * A trava de nível é aqui, e é a primeira das duas — a segunda mora no sorteio do drop
   * (ver `derrotarSelvagem`), porque o multiplicador é economia e não pode confiar em o
   * banco estar em dia. Ver `shared/outland-tiers.mjs`.
   */
  'outland.tier': (p, m) => {
    const alvo = Number(m.tier);
    const ficha = fichaOutlandTier(alvo);
    if (ficha.tier !== alvo) {
      return evento(p, { k: 'aviso', msg: `"${m.tier}" não é uma Outland` });
    }
    if (p.level < ficha.nivel) {
      return evento(p, {
        k: 'aviso',
        msg: `${ficha.rotulo} pede nível ${nivelOutlandTier(ficha.tier)} — você está no ${p.level}`,
      });
    }
    if (p.outlandTier === ficha.tier) return;
    p.outlandTier = ficha.tier;
    marcarSujo(p);
    evento(p, { k: 'outlandTier', tier: ficha.tier, nome: rotuloOutlandTier(ficha.tier) });
  },

  'team.active': (p, m) => {
    ativarPokemon(p, p.pokemons.get(Number(m.pokemonId)));
  },

  'team.move': (p, m) => {
    const pk = p.pokemons.get(Number(m.pokemonId));
    if (!pk) return evento(p, { k: 'aviso', msg: 'esse pokémon não está mais com você' });
    const destino = m.slot === null || m.slot === undefined ? null : Number(m.slot);

    if (!p.noCentro && (destino == null || pk.slot == null)) {
      return evento(p, { k: 'aviso', msg: 'acesse o Depot no Centro Pokémon de Cerulean' });
    }

    if (p.pvp && (destino == null || pk.slot == null)) {
      return evento(p, { k: 'aviso', msg: 'não dá para mudar a equipe durante o PvP' });
    }

    if (destino != null) {
      if (destino < 0 || destino >= MAX_EQUIPE) return;
      if (pk.slot == null) {
        if (equipeDe(p).length >= MAX_EQUIPE) {
          return evento(p, { k: 'aviso', msg: 'a equipe já está cheia' });
        }
        // vindo do depot: só entra se o slot estiver livre — senão o ocupante iria para o
        // depot sem o jogador ter pedido
        const ocupado = [...p.pokemons.values()].some((k) => k.slot === destino);
        if (ocupado) return evento(p, { k: 'aviso', msg: 'esse lugar da equipe está ocupado' });
      } else {
        const ocupante = [...p.pokemons.values()].find((k) => k.slot === destino);
        if (ocupante) {
          ocupante.slot = pk.slot; // troca de lugar entre dois da equipe
          marcarSujo(p, ocupante);
        }
      }
    } else if (pk.id === p.activeId) {
      // O ativo pode ir para o depot, desde que sobre alguém para lutar no lugar dele.
      const substituto = primeiroDaEquipeUtilizavel(p, (k) => k.id !== pk.id);
      if (!substituto) {
        return evento(p, {
          k: 'aviso',
          msg: 'nenhum pokémon da equipe pode lutar pelo seu nível',
        });
      }
      p.activeId = substituto.id;
      p.proxAtaqueJogador = agora() + 300;
    }

    pk.slot = destino;
    // Mandar o ativo para o depot troca quem está em campo — e, na praça, quem está andando
    // atrás do dono. `team.active` faz o mesmo pelo caminho normal.
    atualizarPokemonDoCentro(p, ativo(p), agora());
    marcarSujo(p, pk);
  },

  'auto.set': (p, m) => {
    // O Auto-Catch é BENEFÍCIO DE VIP e a trava mora aqui, não na tela: o cadeado do
    // interruptor é aviso, e um `auto.set` na mão ligaria a automação de graça. Quem não é
    // assinante recebe o aviso e a caixa volta desmarcada no próximo snapshot.
    let { autoBallAteCapturar, autoBallSemParar } = modosBallAuto(m);
    if ((autoBallAteCapturar || autoBallSemParar) && !vipAtivo(p, agora())) {
      autoBallAteCapturar = false;
      autoBallSemParar = false;
      evento(p, { k: 'aviso', msg: 'Lançar pokébola é um recurso VIP' });
    }
    // Espalha o que já existe ANTES de sobrescrever só os campos desta tela — senão
    // `bossKills` (contador vitalício de vitórias por boss) e `desistiuHunt` somem no flush
    // seguinte, e o F5 traz tudo zerado de volta.
    // FILA AUTOMÁTICA do PvP — benefício de VIP, e a trava mora aqui pelo mesmo motivo do
    // Auto-Catch logo acima: o cadeado da tela é aviso, e um `auto.set` na mão ligaria a
    // automação de graça.
    let pvpAutoFila = !!m.pvpAutoFila;
    if (pvpAutoFila && !vipAtivo(p, agora())) {
      pvpAutoFila = false;
      evento(p, { k: 'aviso', msg: 'pvp.autoFilaVip' });
    }
    // Desligou: cancela a reentrada que estava agendada, senão ela ainda dispararia uma vez.
    if (!pvpAutoFila) p.pvpAutoFilaEm = 0;
    p.automation = {
      ...p.automation,
      pvpAutoFila,
      autoBallAteCapturar,
      autoBallSemParar,
      ballIds: idsDeBola(m.ballIds),
      autoRevive: !!m.autoRevive,
      // Quais REVIVES e quais POÇÕES usar, na ordem em que o jogador escolheu. Lista vazia
      // significa "qualquer um", que é o comportamento de antes desta opção existir — e é o
      // que toda conta criada até aqui tem gravado.
      reviveIds: idsDeItem(m.reviveIds),
      autoPotion: !!m.autoPotion,
      potionIds: idsDeItem(m.potionIds),
      hpLimiar: limiarValido(m.hpLimiar),
      autoVoltarHunt: !!m.autoVoltarHunt,
    };
    if (!p.automation.autoVoltarHunt) cancelarVoltarHuntAutomatico(p);
    marcarSujo(p);
  },

  /** Liga/desliga a venda automática de loot da hunt (itens destrancados, vendáveis ao NPC). */
  'shop.autoVendaLoot': (p, m) => {
    const ligando = !!m.ativo;
    p.automation.autoVendaLoot = ligando;
    if (m.avisoVisto) p.automation.autoVendaLootAvisoVisto = true;
    // Ao ligar, vende na hora o loot que já está na bolsa — trancados ficam de fora.
    if (ligando) venderTodoLootLivre(p, { silencioso: true });
    marcarSujo(p);
  },

  /** Shiny capturado nasce trancado na venda do Market (cadeado), se a opção estiver ligada. */
  'shop.autoLockShiny': (p, m) => {
    const ligando = !!m.ativo;
    p.automation.autoLockShiny = ligando;
    if (ligando) travarTodosShinys(p);
    marcarSujo(p);
  },

  /**
   * Auto Lock N+: tranca na venda do Market todo pokémon com nota ≥ a nota que o JOGADOR
   * escolheu (`autoLockNotaMin`; quem nunca mexeu fica no `AUTO_LOCK_NOTA_MIN`).
   *
   * `{ ativo, nota? }`. A `nota` vai CRUA para `notaAutoLockValida`: só número de 0 a 10 passa,
   * e o resto é recusado sem mudar nada — nem a nota, nem o interruptor. Ligado, a varredura
   * roda na hora com a nota nova.
   *
   * O cadeado automático só TRANCA. Subir a nota não destranca ninguém: o jogo não guarda se
   * um cadeado foi posto por esta regra ou pela mão do jogador, e destrancar um pokémon que
   * ele trancou de propósito é abrir caminho para vendê-lo no "vender todo" sem querer.
   */
  'shop.autoLockNota9': (p, m) => {
    if (m.nota !== undefined) {
      const nota = notaAutoLockValida(m.nota);
      if (nota == null) return evento(p, { k: 'aviso', msg: 'mk.autoLockNotaInvalida' });
      p.automation.autoLockNotaMin = nota;
    }
    const ligando = !!m.ativo;
    p.automation.autoLockNota9 = ligando;
    if (ligando) travarTodosNota9(p);
    marcarSujo(p);
  },

  /** Potência V (P5) trancada na venda do Market ao capturar ou ao ligar a opção. */
  'shop.autoLockP5': (p, m) => {
    const ligando = !!m.ativo;
    p.automation.autoLockP5 = ligando;
    if (ligando) travarTodosP5(p);
    marcarSujo(p);
  },

  'ball.throw': (p, m) => {
    const slot = m.slot == null ? null : Number(m.slot);
    const mortoEm = slot == null ? null : (p.campo?.mobs.get(slot)?.mortoEm ?? null);
    const antes = p.proxBola;
    arremessarBola(p, Number(m.ballId), slot);
    // Só o arremesso ACEITO entra na conta (o cooldown andou) — clique recusado não diz nada.
    if (p.proxBola !== antes) sinalizarSuspeita(p, registrarArremessoManual(p, { t: agora(), mortoEm }));
  },

  // ------------------------------------------------------------------ market
  //
  // Preço é SEMPRE recalculado aqui a partir do catálogo — a quantidade vem do cliente,
  // o valor não. Um cliente adulterado só consegue pedir "compre N", nunca "por X ouro".

  'shop.buy': (p, m) => {
    enfileirarEconomia(p, () => {
      const qtd = limitarQtd(m.qty);
      if (m.kind === 'ball') {
        const b = bolaPorId.get(Number(m.id));
        if (!b || !b.compravel) return;
        const custo = b.priceGold * qtd;
        if (p.gold < custo) return evento(p, { k: 'aviso', msg: 'Ouro insuficiente' });
        p.gold -= custo;
        p.balls[b.id] = (p.balls[b.id] ?? 0) + qtd;
        marcarSujo(p);
        auditar(
          p,
          'npc',
          'compra',
          `${b.nome} ×${qtd} · −${custo.toLocaleString('pt-BR')} coins · gold ${Math.floor(p.gold ?? 0).toLocaleString('pt-BR')}`,
          `ball:${b.id}`,
        );
        evento(p, { k: 'compra', nome: b.nome, qtd, gasto: custo });
        return;
      }
      if (m.kind === 'item') {
        const item = itens.get(Number(m.id));
        if (!item) return;
        const unit = ITENS_COMPRAVEIS.get(item.id) ?? (COMPRAVEIS.has(item.category) ? item.npcPrice : 0);
        if (!(unit > 0)) return;
        const custo = unit * qtd;
        if (p.gold < custo) return evento(p, { k: 'aviso', msg: 'Ouro insuficiente' });
        p.gold -= custo;
        p.items[item.id] = (p.items[item.id] ?? 0) + qtd;
        marcarSujo(p);
        auditar(
          p,
          'npc',
          'compra',
          `${item.name} ×${qtd} · −${custo.toLocaleString('pt-BR')} coins · gold ${Math.floor(p.gold ?? 0).toLocaleString('pt-BR')}`,
          `item:${item.id}`,
        );
        evento(p, { k: 'compra', nome: item.name, qtd, gasto: custo });
      }
    });
  },

  /**
   * A CAIXA DO MARKET — o ralo de Coins.
   *
   * O ouro sai e não volta em forma nenhuma: a caixa devolve bola, item e nada mais (ver
   * `shared/caixas-npc.mjs`). Na fila de economia, como toda compra: dois cliques em duas abas
   * viram duas compras em sequência, e não duas leituras do mesmo saldo.
   */
  'caixa.npc.abrir': (p, m) => {
    enfileirarEconomia(p, () => (async () => {
      if (!p.dbId) return;
      try {
        const r = await comprarCaixa(p, m, {
          debitarOuro: (coins) => {
            const cobrado = subtrairGold(p, coins);
            marcarSujo(p);
            return cobrado;
          },
          // O estorno quando a caixa NÃO abre (o saldo mudou no meio, o ledger de diamante
          // recusou). Audita sempre, mesmo abaixo do limiar: crédito que se repete em laço só
          // aparece assim — é a mesma regra do estorno da taxa de anúncio.
          devolverOuro: (coins) => {
            somarGoldAuditado(p, coins, 'caixa_estorno', 'caixa não abriu', null, { sempre: true });
            marcarSujo(p);
          },
          auditar: (detalhe, ref) => auditar(p, 'npc', 'caixa', detalhe, ref),
        });
        marcarSujo(p);
        enviar(p, { t: SERVIDOR.CAIXA_NPC, aberta: r });
      } catch (err) {
        if (!(err instanceof ErroCaixa)) console.error('[caixa] abrir falhou:', err.message);
        enviar(p, {
          t: SERVIDOR.CAIXA_NPC,
          recusa: { chave: err instanceof ErroCaixa ? err.message : 'caixa.recusa.erro' },
        });
      }
    })());
  },

  'shop.sellItem': (p, m) => {
    const item = itens.get(Number(m.id));
    if (!item) return;
    if (itemLootTravado(p, item.id)) {
      return evento(p, { k: 'aviso', msg: 'este item está trancado — destrave o cadeado para vender' });
    }
    const tem = p.items[item.id] ?? 0;
    const qtd = Math.min(limitarQtd(m.qty), tem);
    if (!qtd) return evento(p, { k: 'aviso', msg: 'Você não tem esse item' });

    const ganho = precoDeVenda(item) * qtd;
    if (!ganho) return evento(p, { k: 'aviso', msg: `${item.name} não tem valor de venda` });

    p.items[item.id] = tem - qtd;
    if (!p.items[item.id]) {
      delete p.items[item.id];
      destravarLoot(p, item.id);
    }
    somarGoldAuditado(p, ganho, 'npc_item', `${item.name} ×${qtd}`);
    marcarSujo(p);
    const depois = p.items[item.id] ?? 0;
    auditar(
      p,
      'npc',
      'venda_item',
      `${item.name} ×${qtd} · +${ganho.toLocaleString('pt-BR')} coins (${tem}→${depois}) · gold ${Math.floor(p.gold ?? 0).toLocaleString('pt-BR')}`,
      `item:${item.id}`,
    );
    evento(p, { k: 'venda', nome: item.name, qtd, ganho });
  },

  /**
   * A LIXEIRA da bolsa: joga fora o que o jogador escolher da aba Treinador.
   *
   * Na fila de economia como qualquer coisa que mexe em item: dois toques colados em duas abas
   * não podem ler o mesmo saldo. A regra inteira (o que pode ir, e quanto) mora em
   * `game/bolsa-descarte.mjs`, que é onde o teste de ataque a alcança.
   */
  'bolsa.descartar': (p, m) => {
    enfileirarEconomia(p, () => {
      try {
        const r = descartarDaBolsa(p, m, {
          auditar: (detalhe, ref) => auditar(p, 'bolsa', 'descarte', detalhe, ref),
        });
        marcarSujo(p);
        evento(p, { k: 'descarte', nome: r.nome, qtd: r.qtd });
      } catch (err) {
        if (!(err instanceof ErroDescarte)) console.error('[bolsa] descarte falhou:', err.message);
        evento(p, {
          k: 'aviso',
          msg: err instanceof ErroDescarte ? err.message : 'bolsa.descarte.recusa.erro',
        });
      }
    });
  },

  'shop.sellAllItems': (p) => {
    if (!venderTodoLootLivre(p)) evento(p, { k: 'aviso', msg: 'nada para vender' });
    else marcarSujo(p);
  },

  'shop.lockLoot': (p, m) => {
    const id = Number(m.id);
    if (!id || !itens.has(id)) return;
    alternarLootTravado(p, id);
    marcarSujo(p);
  },

  /**
   * COLEÇÃO — `{ pokemonId, para: 'colecao' | 'depot' }`. O destino é explícito, e não um
   * "alternar": dois cliques rápidos (ou duas abas) pedem a mesma coisa duas vezes, e a segunda
   * vira nada em vez de desfazer a primeira. Regras em `moverNaColecao`.
   */
  'colecao.mover': (p, m) => {
    enfileirarEconomia(p, () => moverNaColecao(p, m.pokemonId, m.para));
  },

  /**
   * O cadeado antigo, que era um "alternar". Fica para a aba aberta antes do deploy: passa pela
   * mesma regra e pela mesma espera, decidindo o destino pelo estado de AGORA, na fila.
   */
  'shop.lockPokemon': (p, m) => {
    enfileirarEconomia(p, () => {
      const id = Number(m.id);
      if (!p.pokemons.has(id)) return;
      moverNaColecao(p, id, naColecao(p, id) ? 'depot' : 'colecao');
    });
  },

  'shop.sellPokemon': (p, m) => {
    enfileirarEconomia(p, async () => {
      const pk = p.pokemons.get(Number(m.pokemonId));
      if (!pk) return evento(p, { k: 'aviso', msg: 'esse pokémon não está mais com você' });
      if (naColecao(p, pk.id)) {
        return evento(p, { k: 'aviso', msg: 'colecao.travaVenda' });
      }
      if (ehXpShareHeldItem(pk.heldItemId)) {
        return evento(p, { k: 'aviso', msg: 'xpshareheld.travaVenda' });
      }
      if (pk.id === p.activeId) return evento(p, { k: 'aviso', msg: 'não dá para vender quem está lutando' });
      if (pk.slot != null) return evento(p, { k: 'aviso', msg: 'mk.somenteDepot' });
      if (p.pokemons.size <= 1) return evento(p, { k: 'aviso', msg: 'esse é o seu último pokémon' });

      const ganho = precoDoPokemon(pk);
      destravarPokemon(p, pk.id);
      try {
        await removerPokemons(p, [pk]);
      } catch (err) {
        console.error('[sim] venda NPC falhou ao apagar pokémon:', err.message);
        return evento(p, { k: 'aviso', msg: 'não deu para concluir a venda — tente de novo' });
      }
      somarGoldAuditado(
        p,
        ganho,
        'npc_pokemon',
        `${pk.nome} Nv ${pk.level}${pk.shiny ? ' shiny' : ''}`,
      );
      marcarSujo(p);
      evento(p, { k: 'venda', nome: `${pk.nome} Nv ${pk.level}`, qtd: 1, ganho });
    });
  },

  /**
   * OFERENDA — até cinco pokémon do depot viram UMA pedra de evolução, sorteada numa roleta.
   *
   * As regras e os furos que a validação fecha estão em `game/oferenda.mjs`; a matemática da
   * roleta, em `shared/oferenda.mjs`. Aqui é a ordem das coisas, que é o que não pode errar:
   *
   *   1. valida (posse, travas, dedup) — sem tocar em nada;
   *   2. sorteia no servidor, com `randomInt`;
   *   3. **apaga os pokémon no banco e espera o `await`**;
   *   4. só então credita a pedra e avisa a tela.
   *
   * Trocar 3 e 4 de lugar daria a pedra a quem perdesse a conexão do Postgres no meio — e os
   * pokémon continuariam vivos na próxima leitura. Dentro de `enfileirarEconomia` porque o giro
   * disputa `p.items` e a coleção com a venda ao NPC e com o Mercado: duas abas girando a mesma
   * roleta ao mesmo tempo é a corrida que a fila existe para fechar.
   */
  'oferenda.girar': (p, m) => {
    enfileirarEconomia(p, async () => {
      // Os postos das Casas LIMPOS antes de conferir: quem foi para o Depot já não está em posto
      // nenhum, mas a limpeza (`limparXpShareInvalido`) só rodaria no próximo pacote.
      if (limparXpShareInvalido(p)) marcarSujo(p);
      const v = validarOferenda(p, m.pokemonIds, {
        // As DUAS prateleiras: a comum e a das Shiny Stones. Quem escolhe entre elas é o
        // `shiny` de cada pokémon, dentro de `montarRoleta` — ver o cabeçalho de lá.
        pedras: { normal: PEDRA_EVOLUCAO_POR_TIPO, shiny: SHINY_STONE_OFERENDA },
        emPosto: (id) => pokemonNoPostoCasa(p, id),
      });
      if (v.erro) return evento(p, { k: 'aviso', msg: v.erro });

      const { roleta, pokemons } = v;
      const giro = girarOferenda(roleta);
      if (giro.indice < 0) return evento(p, { k: 'aviso', msg: 'oferenda.erroSorteio' });

      try {
        await removerPokemons(p, pokemons);
      } catch (err) {
        console.error('[sim] oferenda falhou ao apagar pokémon:', err.message);
        return evento(p, { k: 'aviso', msg: 'oferenda.erroFalhou' });
      }

      // O CADEADO do Mercado NPC não barra a oferenda (ver `validarOferenda`), mas a lista dele
      // é por ID — e id de linha apagada ficaria ali para sempre, engordando o `automation` a
      // cada giro. Depois do `DELETE`, e não antes: se o banco recusar, o trancado continua
      // trancado.
      for (const pk of pokemons) destravarPokemon(p, pk.id);

      const fatia = giro.fatia;
      if (giro.ganhou) p.items[fatia.itemId] = (p.items[fatia.itemId] ?? 0) + 1;
      marcarSujo(p);
      auditar(
        p,
        'oferenda',
        giro.ganhou ? (giro.fatia.shiny ? 'pedra_shiny' : 'pedra') : 'vazio',
        `${pokemons.length}× pokémon (${pokemons.map((k) => `${k.shiny ? 'SHINY ' : ''}${k.nome} Nv ${k.level}`).join(', ')}) · ${giro.auditoria}`,
        giro.ganhou ? `item:${fatia.itemId}` : null,
      );
      // A roleta INTEIRA volta com o resultado: é ela que a tela desenha e anima até o índice.
      // Mandar só a pedra faria a animação ter de confiar na roleta que o cliente montou por
      // conta própria — e um snapshot atrasado (um pokémon vendido noutra aba) pararia a agulha
      // numa fatia que não é a que o servidor sorteou.
      evento(p, {
        k: 'oferenda',
        casas: OFERENDA_CASAS,
        oferecidos: pokemons.length,
        fatias: roleta.fatias.map((f) => ({
          vazio: !!f.vazio,
          shiny: !!f.shiny,
          itemId: f.itemId,
          nome: f.nome,
          tipos: f.tipos,
          peso: f.peso,
        })),
        total: roleta.total,
        indice: giro.indice,
        itemId: giro.ganhou ? fatia.itemId : null,
        pedra: giro.ganhou ? fatia.nome : null,
        pedraShiny: giro.ganhou ? !!fatia.shiny : false,
        tipos: giro.ganhou ? fatia.tipos : [],
      });
    });
  },

  /**
   * Os ids que o AUTO SELECIONAR da oferenda nunca pega e que só o banco conhece: a equipe do
   * PvP Ranqueado e, enquanto o campeonato não acabou, a equipe escolhida para ele. A tela pede
   * na hora do clique, e não ao abrir a aba: o pedido só custa quando o botão é usado, e a equipe
   * trocada noutra aba já vale.
   *
   * Só leitura, e só do próprio jogador. Nada aqui muda o que o giro aceita: `oferenda.girar`
   * continua sendo quem decide. Falhou a leitura, a resposta leva `protegidos: null`, e a tela
   * não escolhe nada, porque na dúvida não se põe um titular na roda.
   */
  'oferenda.protegidos': async (p) => {
    if (!p.dbId) return;
    try {
      const [pvp, camp] = await Promise.all([
        pvpdb.timeSalvo(p.dbId),
        equipeDoCampeonatoValendo(p.dbId, agora()),
      ]);
      enviar(p, { t: SERVIDOR.OFERENDA, protegidos: [...new Set([...pvp, ...camp])] });
    } catch (err) {
      console.error('[sim] oferenda.protegidos falhou:', err.message);
      enviar(p, { t: SERVIDOR.OFERENDA, protegidos: null });
    }
  },

  /**
   * OFERENDAR TUDO DO DEPOT — o lote, de cinco em cinco, num clique.
   *
   * O cliente não manda id nenhum, e isso é a peça de segurança central: quem escolhe é este
   * handler, com a lista que ele mesmo tem em memória mais as travas que só o banco conhece.
   * Um `pokemonIds` vindo da tela seria uma lista de "apague estes" assinada pelo jogador — e a
   * tela não sabe da equipe do PvP nem da do campeonato.
   *
   * A ordem das quatro etapas é a mesma de `oferenda.girar`, pela mesma razão, só que uma vez
   * para o lote inteiro:
   *
   *   1. escolhe e valida TODOS os grupos, sem mexer em nada;
   *   2. gira todos (sorteio puro, sem escrita);
   *   3. **apaga os pokémon no banco e espera o `await`** — de uma vez só;
   *   4. só então credita as pedras e avisa a tela.
   *
   * Um `DELETE` que falhe no meio não pode ter creditado nada, e é por isso que o crédito é o
   * último passo do lote e não de cada giro.
   *
   * Nada daqui é a Coleção: ela é excluída na hora de montar os candidatos, junto com equipe,
   * ativo, posto de Casa e Exp. Share. Por consequência, nenhum id do lote está no cadeado —
   * é por isso que, ao contrário de `oferenda.girar`, não há `destravarPokemon` aqui.
   */
  'oferenda.tudo': (p) => {
    enfileirarEconomia(p, async () => {
      if (!p.dbId) return;
      // Os postos das Casas LIMPOS antes de conferir, como no giro de um: quem foi para o Depot
      // já não está em posto nenhum, mas a limpeza só rodaria no próximo pacote.
      if (limparXpShareInvalido(p)) marcarSujo(p);

      // As duas equipes que só o banco conhece. Falhou a leitura, o lote NÃO acontece: seguir
      // sem elas é apagar o titular do PvP de quem clicou num botão de limpar sobra.
      let protegidos;
      try {
        const [pvp, camp] = await Promise.all([
          pvpdb.timeSalvo(p.dbId),
          equipeDoCampeonatoValendo(p.dbId, agora()),
        ]);
        protegidos = [...new Set([...pvp, ...camp])];
      } catch (err) {
        console.error('[sim] oferenda.tudo: protegidos falharam:', err.message);
        return evento(p, { k: 'aviso', msg: 'oferenda.erroFalhou' });
      }

      // O mesmo filtro do "vender o depot inteiro" (`shop.sellAllPokemons`), mais o posto de
      // Casa — que lá não é conferido porque a venda unitária já barra antes.
      const colecao = conjuntoColecao(p);
      const candidatos = [...p.pokemons.values()].filter(
        (k) => k.slot == null && k.id !== p.activeId && !colecao.has(k.id)
          && !ehXpShareHeldItem(k.heldItemId) && !pokemonNoPostoCasa(p, k.id),
      );

      const pedras = { normal: PEDRA_EVOLUCAO_POR_TIPO, shiny: SHINY_STONE_OFERENDA };
      const { grupos, restantes } = montarLoteDaOferenda(candidatos, {
        nota: (k) => k.nota ?? notaDePokemon(k, especies.get(k.speciesId)),
        notaMax: notaAutoLockValida(p.automation?.autoLockNotaMin) ?? AUTO_LOCK_NOTA_MIN,
        protegidos,
        totalNaConta: p.pokemons.size,
      });
      if (!grupos.length) return evento(p, { k: 'aviso', msg: 'oferenda.loteVazio' });

      // Valida grupo a grupo com a MESMA função do giro de um: se alguma trava mudou entre a
      // prévia da tela e agora, o lote inteiro para antes de apagar qualquer linha.
      const giros = [];
      const todos = [];
      for (const grupo of grupos) {
        const v = validarOferenda(p, grupo.map((k) => k.id), {
          pedras,
          emPosto: (id) => pokemonNoPostoCasa(p, id),
        });
        if (v.erro) return evento(p, { k: 'aviso', msg: v.erro });
        const giro = girarOferenda(v.roleta);
        if (giro.indice < 0) return evento(p, { k: 'aviso', msg: 'oferenda.erroSorteio' });
        giros.push({ giro, pokemons: v.pokemons });
        todos.push(...v.pokemons);
      }

      try {
        await removerPokemons(p, todos);
      } catch (err) {
        console.error('[sim] oferenda em lote falhou ao apagar pokémon:', err.message);
        return evento(p, { k: 'aviso', msg: 'oferenda.erroFalhou' });
      }

      // Daqui para baixo os pokémon já não existem: o crédito não pode mais falhar por nada.
      const ganhas = new Map();
      let vazios = 0;
      for (const { giro } of giros) {
        if (!giro.ganhou) { vazios++; continue; }
        const f = giro.fatia;
        p.items[f.itemId] = (p.items[f.itemId] ?? 0) + 1;
        const atual = ganhas.get(f.itemId)
          ?? { itemId: f.itemId, nome: f.nome, shiny: !!f.shiny, tipos: f.tipos, qtd: 0 };
        atual.qtd++;
        ganhas.set(f.itemId, atual);
      }
      marcarSujo(p);

      // UMA linha de auditoria para o lote. A lista de nomes de duzentos pokémon não caberia, e
      // o que a moderação precisa saber é o tamanho e o que saiu — a linha do giro de um
      // continua existindo para quem oferenda à mão.
      const pedrasLista = [...ganhas.values()]
        .map((x) => `${x.qtd}× ${x.nome}`).join(', ') || 'nada';
      auditar(
        p,
        'oferenda',
        'lote',
        `${giros.length} giro(s) · ${todos.length}× pokémon · ${pedrasLista} · ${vazios} vazio(s)`,
        null,
      );

      evento(p, {
        k: 'oferendaLote',
        giros: giros.length,
        oferecidos: todos.length,
        vazios,
        restantes,
        pedras: [...ganhas.values()].sort((a, b) => b.qtd - a.qtd),
      });
    });
  },

  // ------------------------------------------------------- Mercado Global
  //
  // Anúncio entre jogadores. A divisão de trabalho é sempre a mesma e vem do write-behind:
  // o que mora na MEMÓRIA do sim (ouro e `items`) é mexido aqui; o que mora no BANCO
  // (anúncio, pokémon, ledger de ORB) vai por `market-db.mjs`. Ver o cabeçalho de lá.

  /**
   * A vitrine, com os filtros da tela.
   *
   * O filtro de TIPO chega como "FIRE" e sai daqui como uma LISTA DE IDS. É de propósito: o
   * anúncio guarda `species_id`/`item_id`, e quem sabe o tipo de cada um é o catálogo, que
   * mora na memória deste processo. Resolver aqui deixa o SQL com um `= ANY(...)` que usa
   * índice, e — o que mais importa — faz o filtro valer também para os anúncios ANTIGOS,
   * abertos antes de a ficha passar a carregar o tipo.
   */
  'market.listar': (p, m) => {
    const tipo = String(m.tipo ?? '');
    const elemento = String(m.elemento ?? '').toUpperCase();
    const categoria = String(m.categoria ?? '');

    let speciesIds = null;
    let itemIds = null;
    if (elemento) {
      if (tipo === 'pokemon') speciesIds = especiesDoTipo(elemento);
      else if (tipo === 'item') itemIds = itensDoTipo(elemento);
    }
    // Categoria e elemento se acumulam: "stone" + "FIRE" tem de dar Fire Stone, e não a união
    // das duas listas. Como os dois viram o mesmo `item_id = ANY(...)`, a interseção é feita
    // aqui, antes de descer.
    if (tipo === 'item' && categoria) {
      const daCategoria = itensDaCategoria(categoria);
      itemIds = itemIds ? itemIds.filter((id) => daCategoria.includes(id)) : daCategoria;
    }

    mdb
      .listar({
        tipo,
        moeda: String(m.moeda ?? ''),
        busca: String(m.busca ?? '').slice(0, 40),
        ordem: String(m.ordem ?? ''),
        // Os critérios de pokémon, combináveis e NA ORDEM em que o jogador os ligou. Descem
        // crus: quem valida (chave conhecida, sem repetição, no teto) é `criteriosValidos`, do
        // lado do banco, que é onde a lista vira SQL. Preso à aba de pokémon como as faixas
        // abaixo — item não tem IV nem nota, e mandar o filtro na aba errada devolveria a
        // lista ordenada por colunas que não existem naquela ficha.
        criterios: tipo === 'pokemon' && Array.isArray(m.criterios) ? m.criterios.slice(0, 12) : [],
        soShiny: !!m.soShiny,
        // Preso à aba de pokémon como as faixas abaixo: um item não tem potência, e um
        // cliente que deixasse o P5 ligado ao trocar de aba receberia a lista de itens vazia.
        soP5: tipo === 'pokemon' && !!m.soP5,
        soTmElemental: tipo === 'pokemon' && !!m.soTmElemental,
        soTmAoe: tipo === 'pokemon' && !!m.soTmAoe,
        // "Omitir Pokémon de Outland" — preso à aba de pokémon como os de cima.
        semOutland: tipo === 'pokemon' && !!m.semOutland,
        // As faixas — piso e teto de nível, potência, IV, qualidade e nota. Descem cruas, como os
        // critérios: quem lê o número e o põe no limite é `listar`.
        ...(tipo === 'pokemon' ? Object.fromEntries(mdb.CAMPOS_FAIXA.map((k) => [k, m[k]])) : {}),
        speciesIds,
        itemIds,
        pagina: Math.max(0, Math.min(200, Number(m.pagina) || 0)),
      })
      .then((r) => enviar(p, { t: SERVIDOR.MARKET, aba: 'vitrine', ...r }))
      .catch((err) => console.error('[market] listar:', err.message));
  },

  /**
   * O resumo da vitrine de itens: para cada pedra/TM/ficha, quantos anúncios existem e por
   * quanto sai a unidade mais barata em cada moeda. O CATÁLOGO em si a tela já tem (veio no
   * welcome), então aqui só desce o que muda.
   */
  'market.itens': (p, m) => {
    const elemento = String(m?.elemento ?? '').toUpperCase();
    const categoria = String(m?.categoria ?? '');

    let itemIds = [...IDS_MERCADO_PERMITIDOS];
    if (elemento) {
      const doTipo = itensDoTipo(elemento);
      itemIds = itemIds.filter((id) => doTipo.includes(id));
    }
    if (categoria) {
      const daCategoria = itensDaCategoria(categoria);
      itemIds = itemIds.filter((id) => daCategoria.includes(id));
    }

    mdb
      .resumoItens(itemIds)
      .then((resumo) => enviar(p, { t: SERVIDOR.MARKET, aba: 'itens', resumo }))
      .catch((err) => console.error('[market] itens:', err.message));
  },

  /** Os anúncios de UM item numa moeda — a lista de vendedores do painel. */
  'market.item': (p, m) => {
    const itemId = Number(m.itemId);
    if (!IDS_MERCADO_PERMITIDOS.has(itemId)) return;
    const moeda = m.moeda === 'orb' ? 'orb' : 'gold';
    mdb
      .anunciosDoItem(itemId, moeda)
      .then((linhas) => enviar(p, { t: SERVIDOR.MARKET, aba: 'item', itemId, moeda, linhas }))
      .catch((err) => console.error('[market] item:', err.message));
  },

  'market.meus': (p) => {
    mdb
      .meusAnuncios(p.dbId)
      .then((linhas) => enviar(p, { t: SERVIDOR.MARKET, aba: 'meus', linhas }))
      .catch((err) => console.error('[market] meus:', err.message));
  },

  /**
   * A estrela no card de um anúncio: guarda (`ativo`) ou tira dos FAVORITOS. `{ id, ativo }`.
   *
   * A lista mora em `automation.mercadoFavoritos` e vai no flush com o resto da conta, então a
   * estrela vale no celular e no PC. Não consulta o banco: favoritar um id que não existe só
   * guarda um número, que a leitura dos favoritos poda na primeira vez.
   */
  'market.favoritar': (p, m) => {
    const id = Number(m?.id);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    if (!Array.isArray(p.automation.mercadoFavoritos)) p.automation.mercadoFavoritos = [];
    const lista = p.automation.mercadoFavoritos;
    const i = lista.indexOf(id);
    if (!m.ativo) {
      if (i < 0) return;
      lista.splice(i, 1);
      marcarSujo(p);
      return;
    }
    if (i >= 0) return;
    if (lista.length >= mdb.MAX_FAVORITOS) {
      return evento(p, { k: 'aviso', msg: 'cm.favLimite', params: { n: mdb.MAX_FAVORITOS } });
    }
    lista.push(id);
    marcarSujo(p);
  },

  /**
   * A aba FAVORITOS: os anúncios da estrela, em qualquer estado.
   *
   * O vendido e o retirado continuam aparecendo — é assim que o jogador descobre que o pokémon que
   * ele namorava saiu —, mas só por `FAVORITO_FECHADO_MS`. Depois disso a própria leitura os poda
   * da lista, junto com id que o banco não conhece. O último favoritado vem primeiro.
   */
  'market.favoritos': (p) => {
    const pedidos = [...(p.automation.mercadoFavoritos ?? [])];
    if (!pedidos.length) return enviar(p, { t: SERVIDOR.MARKET, aba: 'favoritos', linhas: [] });
    mdb
      .anunciosPorIds(pedidos)
      .then((linhas) => {
        const limite = Date.now() - FAVORITO_FECHADO_MS;
        const vivos = linhas.filter((a) => a.estado === 'aberto' || (a.fechadoEm ?? 0) > limite);
        const ficam = new Set(vivos.map((a) => a.id));
        // Poda só o que foi LIDO: um favorito marcado durante a consulta não pode sumir por ela.
        const lista = p.automation.mercadoFavoritos ?? [];
        const podada = lista.filter((id) => ficam.has(id) || !pedidos.includes(id));
        if (podada.length !== lista.length) {
          p.automation.mercadoFavoritos = podada;
          marcarSujo(p);
        }
        const ordem = new Map(pedidos.map((id, i) => [id, i]));
        vivos.sort((a, b) => (ordem.get(b.id) ?? 0) - (ordem.get(a.id) ?? 0));
        enviar(p, { t: SERVIDOR.MARKET, aba: 'favoritos', linhas: vivos });
      })
      .catch((err) => console.error('[market] favoritos:', err.message));
  },

  /**
   * Quantos diamantes deste jogador podem ir para o Mercado — a cota, e de onde ela veio.
   *
   * Comando PRÓPRIO, e não um campo do snapshot: a conta é um `SUM` sobre o ledger e o
   * snapshot sai duas vezes por segundo para todo mundo on-line. Uma consulta por clique em
   * "Diamantes" na tela de anunciar custa nada; a mesma consulta 120 vezes por minuto por
   * jogador custaria o banco.
   *
   * O número que a tela mostra é uma SUGESTÃO, como todo filtro do cliente: quem decide é
   * `criarAnuncio`, que relê a cota dentro da transação com o lock do vendedor na mão.
   */
  'market.diamantes.cota': (p) => {
    ddb
      .cotaDeVendaDoJogador(p.dbId)
      .then((cota) => enviar(p, { t: SERVIDOR.MARKET, aba: 'diamantesCota', cota }))
      .catch((err) => console.error('[market] cota de diamantes:', err.message));
  },

  /**
   * O registro de SHINYS do servidor — quem capturou o quê, e o que está à venda.
   *
   * Os dois filtros viram uma lista de ids de espécie AQUI, pelo mesmo motivo do
   * `market.listar`: o catálogo (nome e tipo de cada espécie) mora na memória deste processo,
   * e o banco só guarda `species_id`. A busca por nome casa por prefixo/trecho, sem acento e
   * sem caixa, porque é o que alguém digitando "chariz" espera encontrar.
   *
   * Filtro que não casa com espécie nenhuma manda uma lista VAZIA (e não `null`) — a diferença
   * entre "sem filtro" e "filtro impossível" é o que evita a vitrine inteira aparecer quando o
   * jogador digita um nome que não existe.
   */
  'shiny.listar': (p, m) => {
    const busca = String(m.busca ?? '').trim().slice(0, 32).toLowerCase();
    const elemento = String(m.tipo ?? '').toUpperCase();

    let speciesIds = null;
    if (elemento) speciesIds = especiesDoTipo(elemento);
    if (busca) {
      const porNome = [...especies.values()]
        .filter((c) => String(c.name ?? '').toLowerCase().includes(busca))
        .map((c) => c.pokeId);
      speciesIds = speciesIds ? speciesIds.filter((id) => porNome.includes(id)) : porNome;
    }

    sdb
      .listarShinys({
        speciesIds,
        soAVenda: !!m.soAVenda,
        ordem: String(m.ordem ?? 'recentes'),
        pagina: Math.max(0, Math.min(200, Number(m.pagina) || 0)),
      })
      .then((r) =>
        enviar(p, {
          t: SERVIDOR.SHINY_LISTA,
          ...r,
          // O nome e o sprite não estão no banco: saem do catálogo, aqui, no caminho de volta.
          // É o mesmo desenho da ficha do Mercado — o cliente não deve ter de adivinhar qual
          // looktype é a forma shiny de uma espécie.
          linhas: r.linhas.map((l) => {
            const esp = especies.get(l.speciesId);
            return {
              ...l,
              nome: esp?.name ?? `#${l.speciesId}`,
              looktype: looktypeShiny(l.speciesId) ?? esp?.looktype ?? 1,
              tipos: [esp?.type1, esp?.type2].filter(Boolean),
              // Os stats de verdade, calculados aqui: sem eles a ficha abriria com "o anúncio
              // não traz os stats", que é justamente o que se quer ver antes de pagar por um
              // shiny. A conta é a mesma do combate — espécie, IV, nível e qualidade.
              stats: esp ? calcularStats(esp, l.ivs, l.level, l.quality, 1, l.refino) : null,
              ivTotal: Object.values(l.ivs ?? {}).reduce((s, v) => s + (Number(v) || 0), 0),
              shiny: true,
              meu: l.donoId === p.dbId,
            };
          }),
        }),
      )
      .catch((err) => console.error('[shiny] listar:', err.message));
  },

  'p5.listar': (p, m) => {
    const busca = String(m.busca ?? '').trim().slice(0, 32).toLowerCase();
    const elemento = String(m.tipo ?? '').toUpperCase();

    let speciesIds = null;
    if (elemento) speciesIds = especiesDoTipo(elemento);
    if (busca) {
      const porNome = [...especies.values()]
        .filter((c) => String(c.name ?? '').toLowerCase().includes(busca))
        .map((c) => c.pokeId);
      speciesIds = speciesIds ? speciesIds.filter((id) => porNome.includes(id)) : porNome;
    }

    p5db
      .listarP5({
        speciesIds,
        soAVenda: !!m.soAVenda,
        ordem: String(m.ordem ?? 'recentes'),
        pagina: Math.max(0, Math.min(200, Number(m.pagina) || 0)),
      })
      .then((r) =>
        enviar(p, {
          t: SERVIDOR.P5_LISTA,
          ...r,
          linhas: r.linhas.map((l) => {
            const esp = especies.get(l.speciesId);
            const lt = l.shiny ? (looktypeShiny(l.speciesId) ?? esp?.looktype ?? 1) : (esp?.looktype ?? 1);
            return {
              ...l,
              nome: esp?.name ?? `#${l.speciesId}`,
              looktype: lt,
              tipos: [esp?.type1, esp?.type2].filter(Boolean),
              stats: esp ? calcularStats(esp, l.ivs, l.level, l.quality, multDeNascenca(l.potencia, l.shiny), l.refino) : null,
              ivTotal: Object.values(l.ivs ?? {}).reduce((s, v) => s + (Number(v) || 0), 0),
              meu: l.donoId === p.dbId,
            };
          }),
        }),
      )
      .catch((err) => console.error('[p5] listar:', err.message));
  },

  'market.historico': (p, m) => {
    mdb
      .historicoVendas(p.dbId, { pagina: Math.max(0, Math.min(500, Number(m.pagina) || 0)) })
      .then((r) => enviar(p, { t: SERVIDOR.MARKET, aba: 'historico', ...r }))
      .catch((err) => console.error('[market] historico:', err.message));
  },

  'market.historicoCompras': (p, m) => {
    mdb
      .historicoCompras(p.dbId, { pagina: Math.max(0, Math.min(500, Number(m.pagina) || 0)) })
      .then((r) => enviar(p, { t: SERVIDOR.MARKET, aba: 'historicoCompras', ...r }))
      .catch((err) => console.error('[market] historicoCompras:', err.message));
  },

  /**
   * A tabela de preços pública — as vendas mais recentes do servidor inteiro.
   *
   * Não leva `dbId` nenhum: é a MESMA resposta para todo mundo, de propósito. O Mercado da
   * Comunidade não tinha referência de preço para pokémon (item tem o `npcPaga`), e sem ela
   * quem anuncia chuta — para cima, e o anúncio apodrece na vitrine, ou para baixo, e o bicho
   * sai por um décimo do que valia.
   *
   * O teto de página e a ausência de `count(*)` estão explicados em `historicoGlobal`.
   */
  'market.historicoGlobal': (p, m) => {
    const pagina = Number(m.pagina) || 0;
    const tipo = m.tipo;
    if (tipo === 'deposito' || tipo === 'saque') {
      odb
        .historicoOrbsGlobal({ pagina, tipo })
        .then((r) => enviar(p, { t: SERVIDOR.MARKET, aba: 'historicoGlobal', ...r }))
        .catch((err) => console.error('[market] historicoOrbsGlobal:', err.message));
      return;
    }
    const soTipo = tipo === 'pokemon' || tipo === 'item' || tipo === 'diamante' ? tipo : null;
    mdb
      // Moeda e item descem crus: quem os valida é `historicoGlobal`, onde viram SQL.
      .historicoGlobal({ pagina, tipo: soTipo, moeda: m.moeda, itemId: m.itemId })
      .then((r) => enviar(p, { t: SERVIDOR.MARKET, aba: 'historicoGlobal', ...r }))
      .catch((err) => console.error('[market] historicoGlobal:', err.message));
  },

  /**
   * Abre um anúncio. O escrow acontece ANTES de gravar: tira da memória, grava, e devolve
   * se a gravação falhar. A ordem inversa (gravar e depois tirar) publicaria um anúncio de
   * algo que o jogador ainda tem na mão.
   */
  'market.criar': (p, m) => {
    enfileirarEconomia(p, () => {
      return (async () => {
      const moeda = m.moeda === 'orb' ? 'orb' : 'gold';
      const preco = Math.floor(Number(m.preco));
      if (!Number.isFinite(preco) || preco < 1) {
        return evento(p, { k: 'aviso', msg: 'preço inválido' });
      }
      if (moeda === 'orb' && preco < mdb.PRECO_MIN_ORB) {
        return evento(p, { k: 'aviso', msg: mdb.msgPrecoMinOrb() });
      }
      if (moeda === 'gold' && preco < mdb.PRECO_MIN_GOLD) {
        return evento(p, { k: 'aviso', msg: mdb.msgPrecoMinGold() });
      }

      // ---------------------------------------------------------- DIAMANTES
      //
      // Sai ANTES de tudo o mais porque não se parece com nenhum dos outros dois: não tem
      // pensão da feira (não é um bicho vivo entregue aos tratadores), não sai do `items` em
      // memória (não mora lá) e o escrow acontece dentro da transação do banco, junto com a
      // criação do anúncio — ver `criarAnuncio`.
      //
      // Por isso aqui não há nada a reservar nem a estornar: ou a transação fecha inteira, ou
      // nada aconteceu. É o tipo de anúncio mais simples do arquivo, e é assim justamente
      // porque o diamante ficou fora do write-behind.
      if (m.tipo === 'diamante') {
        const qtd = Math.floor(Number(m.qtd));
        if (!Number.isFinite(qtd) || qtd < 1) {
          return evento(p, { k: 'aviso', msg: 'market.diamanteQtdInvalida' });
        }
        try {
          const a = await mdb.criarAnuncio({
            vendedorId: p.dbId, vendedor: p.nick, tipo: 'diamante',
            qtd,
            // A ficha do diamante é o mínimo que a vitrine precisa desenhar. `nome` entra
            // porque a BUSCA da vitrine casa contra `ficha->>'nome'`: sem ele, digitar
            // "diamante" na caixa de busca devolveria vazio.
            ficha: { nome: 'Diamantes', diamante: true },
            preco, moeda, dias: null,
          });
          // O saldo veio pronto da transação que debitou — o cache da tela anda junto sem uma
          // segunda consulta.
          if (a.saldoDiamantes != null) p.diamonds = a.saldoDiamantes;
          marcarSujo(p);
          const desc = `${qtd}× 💎`;
          evento(p, { k: 'marketCriado', descricao: desc, preco, moeda, dias: null, taxa: 0 });
          auditarMarketAnunciado(p, a, desc, preco, moeda, 0);
          enviar(p, { t: SERVIDOR.MARKET, aba: 'criado', anuncio: a });
        } catch (err) {
          avisoDeErro(p, err);
        }
        return;
      }

      // A pensão da feira (ver `TAXA_DIARIA`) — só POKÉMON paga. Item fica na prateleira e
      // prateleira não come: anúncio de item não tem prazo nem custo, e `dias = null` grava
      // `expira_em` NULL.
      //
      // Aqui só se CONFERE o saldo; a cobrança sai junto de cada `criarAnuncio`. Cobrar já
      // neste ponto obrigaria a estornar em doze pontos de saída diferentes (starter, último
      // pokémon, fora da faixa…), e basta esquecer um para o jogador pagar por um anúncio que
      // não existe. Cobrar colado à publicação deixa dois caminhos: deu certo, ficou pago;
      // estourou, `estornarTaxa` desfaz.
      const ehPokemon = m.tipo === 'pokemon';
      const dias = ehPokemon ? mdb.limitarDias(m.dias) : null;
      const taxa = dias == null ? 0 : mdb.custoDoAnuncio(dias);
      if (taxa && (p.gold ?? 0) < taxa) {
        return evento(p, {
          k: 'aviso',
          msg: `a feira cobra ${taxa.toLocaleString('pt-BR')} Coins para cuidar do seu pokémon por ${dias} dia(s) e você tem ${Math.floor(p.gold ?? 0).toLocaleString('pt-BR')}`,
        });
      }
      // `cobrado` guarda o que SAIU de fato: estornar um valor diferente do cobrado é a
      // outra metade do buraco que esta dupla já teve. O estorno audita SEMPRE (`sempre`),
      // mesmo abaixo do limiar — um crédito que se repete em loop só é visível assim.
      let cobrado = 0;
      const cobrarTaxa = () => {
        if (!taxa) return;
        cobrado = subtrairGold(p, taxa);
        marcarSujo(p);
      };
      const estornarTaxa = () => {
        if (!cobrado) return;
        somarGoldAuditado(p, cobrado, 'market_taxa_estorno', 'anúncio não publicado', null, {
          sempre: true,
        });
        cobrado = 0;
        marcarSujo(p);
      };

      if (m.tipo === 'pokemon') {
        const pk = p.pokemons.get(Number(m.pokemonId));
        if (!pk) return evento(p, { k: 'aviso', msg: 'esse pokémon não está mais com você' });
        if (pk.id === p.activeId) return evento(p, { k: 'aviso', msg: 'não dá para anunciar quem está lutando' });
        if (pk.starter) {
          return evento(p, { k: 'aviso', msg: 'o pokémon inicial não pode ser anunciado no mercado' });
        }
        if (ehXpShareHeldItem(pk.heldItemId)) {
          return evento(p, { k: 'aviso', msg: 'xpshareheld.travaVenda' });
        }
        if (p.pokemons.size <= 1) return evento(p, { k: 'aviso', msg: 'esse é o seu último pokémon' });

        // A tela já esconde quem não passa, mas a checagem tem de estar AQUI: o cliente é
        // do jogador e um pacote forjado publicaria o nível 3 que a curadoria existe para
        // manter fora. Ver `motivoNaoAnunciavel`.
        const barrado = motivoNaoAnunciavel(pk, especies);
        if (barrado) {
          const m = MERCADO_POKEMON_MIN;
          const notaAtual = notaMercadoDoPokemon(pk, especies);
          const porque = {
            nivel: `nível ${m.level}+ (o seu tem ${pk.level})`,
            nota: `nota ${m.nota}+ na calculadora (a sua é ${notaAtual == null ? '—' : notaAtual.toFixed(3)})`,
            sumiu: 'esse pokémon não está mais com você',
          }[barrado];
          return evento(p, { k: 'aviso', msg: `o mercado pede ${porque}` });
        }

        // Sai da memória mas NÃO do banco: a linha continua em `player_pokemon`, agora com
        // `anuncio_id`. É ela que o comprador vai receber inteira — nível, IV, shiny e tudo.
        //
        // Tirar da memória PRIMEIRO é de propósito: a partir daqui nenhum comando alcança
        // `pk`, então o que se grava logo abaixo é um estado que ninguém mais move.
        p.pokemons.delete(pk.id);
        p.pokemonsSujos?.delete(pk.id);
        marcarSujo(p);

        // E o que estava pendente vai para o banco AGORA, antes de a linha virar escrow.
        //
        // Sem isto, o `delete` acima descartava a gravação pendente em silêncio — o flush
        // procura o pokémon em `p.pokemons` e simplesmente pula quem não está mais lá. Quem
        // desequipasse uma Exp. Share e anunciasse o mesmo pokémon dentro da janela de flush
        // (~5 s) via a bolsa receber a unidade de volta E a linha ir para o escrow ainda
        // segurando o item: um virava DOIS. Refino e TM aplicados na mesma janela caíam no
        // outro lado da mesma moeda — as pedras saíam da bolsa e o "+N" não existia.
        try {
          await db.gravarPokemon(pk);
        } catch (err) {
          console.error('[market] não deu para gravar o pokémon antes do escrow:', err.message);
          p.pokemons.set(pk.id, pk);
          marcarSujo(p, pk);
          return evento(p, { k: 'aviso', msg: 'não deu para publicar o anúncio — tente de novo' });
        }

        // O retrato congelado do bicho. `tipos`, `potencia` e `lookShiny` entram aqui porque
        // a vitrine ordena e filtra por eles sem abrir `player_pokemon` — e porque o comprador
        // precisa ver o que está levando antes de pagar.
        //
        // `xp`, `stats`, `maxHp` e `ivs` entram para a FICHA DETALHADA que a vitrine abre ao
        // clicar no anúncio. Vão como snapshot, e não derivados na tela, porque derivar exigiria
        // uma segunda cópia de `calcularStats` no cliente — e duas cópias divergem no primeiro
        // ajuste de balanceamento, justamente na tela em que alguém decide gastar gema.
        // Anúncio aberto antes desta versão não tem os quatro, e a ficha esconde a seção.
        const ficha = {
          id: pk.id,
          nome: pk.nome, level: pk.level, shiny: !!pk.shiny, speciesId: pk.speciesId,
          looktype: pk.looktype, lookShiny: pk.lookShiny ?? null,
          tipos: pk.tipos, quality: pk.quality, poder: pk.poder, potencia: pk.potencia,
          ivTotal: Object.values(pk.ivs ?? {}).reduce((s, v) => s + v, 0),
          nota: pk.nota ?? notaMercadoDoPokemon(pk, especies),
          xp: pk.xp, ivs: pk.ivs, stats: pk.stats, maxHp: pk.maxHp,
          // O "+N" comprado em pedras. Vai congelado como o resto: quem paga por um Dragonite
          // +12 está pagando pelo refino tanto quanto pelo IV, e a vitrine precisa dizer isso
          // ANTES do clique — os `stats` acima já vêm com ele somado, mas sem esta linha não
          // haveria como o comprador saber que parte do número veio daí.
          refino: pk.refino ?? null,
          refinoTotal: pk.refinoTotal ?? 0,
          tmElemental: pk.tmElemental ?? null,
          tmAoe: !!pk.tmAoe,
          caughtAt: pk.caughtAt ?? null,
        };
        cobrarTaxa();
        try {
          const a = await mdb.criarAnuncio({
            vendedorId: p.dbId, vendedor: p.nick, tipo: 'pokemon',
            pokemonId: pk.id, qtd: 1, ficha, preco, moeda, dias,
          });
          evento(p, { k: 'marketCriado', descricao: `${pk.nome} Nv ${pk.level}`, preco, moeda, dias, taxa });
          auditarMarketAnunciado(p, a, `${rotuloPokemon(pk.nome, pk.id)} Nv ${pk.level}${pk.shiny ? ' ★' : ''}`, preco, moeda, taxa);
          enviar(p, { t: SERVIDOR.MARKET, aba: 'criado', anuncio: a });
        } catch (err) {
          p.pokemons.set(pk.id, pk); // devolve à memória; o banco nunca chegou a mudar
          // Com o `pk`, e não só `p`: ele saiu do conjunto de sujos lá em cima, e voltar sem
          // reentrar deixaria o próximo flush pulando este pokémon de novo.
          marcarSujo(p, pk);
          estornarTaxa();
          avisoDeErro(p, err);
        }
        return;
      }

      // CASA. Como a caixa logo abaixo: `tipo: 'item'` para a vitrine agrupar pela raridade, e o
      // escrow é da LINHA numerada. O que ela tem de próprio são os POSTOS: os pokémon da casa
      // saem do XP Share no ato do anúncio (é a regra), e só voltam se o anúncio NÃO sair —
      // cancelar depois devolve a casa vazia.
      if (m.casaId != null) {
        // Na mão, e não só em uso: a guardada também se vende.
        const casa = casaNaMaoPorId(p, m.casaId);
        if (!casa) return evento(p, { k: 'aviso', msg: 'casa.naoDisponivel' });
        if (p.casa?.casaId === casa.id) return evento(p, { k: 'aviso', msg: 'casa.saiaParaAnunciar' });
        const itemId = CASA_POR_RARIDADE[casa.raridade];
        const item = itens.get(itemId);
        if (!item || !itemAnunciavelMercado(item)) return evento(p, { k: 'aviso', msg: 'casa.naoDisponivel' });

        const postosAntes = pararXpShareDaCasa(p, casa);
        const soltos = postosAntes.filter((id) => id != null).length;
        // Trava na memória já: entrar nela ou escalá-la durante o await não pode acontecer.
        casa.anunciada = true;
        mexeuNoXpShare(p);
        const desc = `${item.name} ${numeroDaCasa(casa.id)}`;
        try {
          const a = await mdb.criarAnuncio({
            vendedorId: p.dbId, vendedor: p.nick, tipo: 'item',
            itemId, qtd: 1, casaId: casa.id,
            // `numero` e `casaRaridade` são o que a vitrine desenha sem consultar nada: o número
            // no lugar da quantidade e a cor da raridade na plaquinha.
            ficha: {
              nome: item.name, icone: item.icon ?? null, categoria: 'casa',
              casaId: casa.id, numero: casa.id, casaRaridade: casa.raridade, npc: 0,
            },
            preco, moeda, dias: null,
          });
          await carregarCasas(p);
          marcarSujo(p);
          evento(p, { k: 'marketCriado', descricao: desc, preco, moeda, dias: null, taxa: 0, soltosCasa: soltos });
          auditarMarketAnunciado(p, a, `${desc}${soltos ? ` · ${soltos} pokémon fora do XP Share` : ''}`, preco, moeda, 0);
          enviar(p, { t: SERVIDOR.MARKET, aba: 'criado', anuncio: a });
        } catch (err) {
          casa.anunciada = false;
          // O anúncio não saiu: a casa continua dele, e os pokémon voltam aos postos — menos quem
          // foi escalado noutro posto no meio do caminho.
          postosAntes.forEach((id, slot) => {
            if (id != null && !postoDoPokemon(p, id)) registrarNoPosto(p, casa, slot, id);
          });
          await carregarCasas(p).catch(() => {});
          marcarSujo(p);
          avisoDeErro(p, err);
        }
        return;
      }

      // CAIXA DE FUNDADOR. Vai como `tipo: 'item'` (é assim que a vitrine agrupa os anúncios
      // sob "Founder Box"), mas o escrow é o do pokémon: quem sai da mão é a LINHA numerada,
      // e é ela que ganha `anuncio_id`. Por isso não há nada a descontar em memória aqui — e
      // por isso também não há o que estornar no `catch`, só a releitura da bolsa.
      // BICICLETA. O desenho da casa: `tipo: 'item'` para a vitrine agrupar pela raridade, e o escrow
      // é da LINHA numerada. Ela sai da mão (`anunciada`) ANTES do await: anunciar a equipada derruba a
      // velocidade na hora, e nem equipar nem anunciar de novo durante a gravação é possível.
      if (m.bicicletaId != null) {
        const bici = bicicletaNaMaoPorId(p, m.bicicletaId);
        if (!bici) return evento(p, { k: 'aviso', msg: 'bicicleta.naoDisponivel' });
        const itemId = BICICLETA_POR_RARIDADE[bici.raridade];
        const item = itens.get(itemId);
        if (!item || !itemAnunciavelMercado(item)) return evento(p, { k: 'aviso', msg: 'bicicleta.naoDisponivel' });

        bici.anunciada = true;
        atualizarVelocidadeNoCentro(p);
        const desc = `${item.name} ${numeroDaBicicleta(bici.id)}`;
        try {
          const a = await mdb.criarAnuncio({
            vendedorId: p.dbId, vendedor: p.nick, tipo: 'item',
            itemId, qtd: 1, bicicletaId: bici.id,
            ficha: {
              nome: item.name, icone: item.icon ?? null, categoria: 'bicicleta',
              bicicletaId: bici.id, numero: bici.id, bicicletaRaridade: bici.raridade, npc: 0,
            },
            preco, moeda, dias: null,
          });
          await carregarBicicletas(p);
          marcarSujo(p);
          evento(p, { k: 'marketCriado', descricao: desc, preco, moeda, dias: null, taxa: 0 });
          auditarMarketAnunciado(p, a, desc, preco, moeda, 0);
          enviar(p, { t: SERVIDOR.MARKET, aba: 'criado', anuncio: a });
        } catch (err) {
          bici.anunciada = false;
          await carregarBicicletas(p).catch(() => {});
          marcarSujo(p);
          avisoDeErro(p, err);
        }
        return;
      }

      if (m.caixaId) {
        const caixaId = Number(m.caixaId);
        const minha = (p.caixas ?? []).find((c) => c.id === caixaId);
        if (!minha) return evento(p, { k: 'aviso', msg: 'caixas.semCaixa' });
        const def = caixaPorTipo(minha.tipo);
        if (!def) return evento(p, { k: 'aviso', msg: 'caixas.semCaixa' });

        try {
          const a = await mdb.criarAnuncio({
            vendedorId: p.dbId, vendedor: p.nick, tipo: 'item',
            itemId: def.itemId, qtd: 1, caixaId,
            ficha: {
              nome: def.nome, icone: `/img/itens/caixa-${def.tipo}.png`, categoria: 'caixa',
              // O que faz esta linha ser a `#01` e não a `#02`. A vitrine lê daqui: sem
              // `serie` o comprador veria dois anúncios idênticos de coisas diferentes.
              caixaId, caixaTipo: def.tipo, serie: minha.serie,
              tipo: null, npc: 0,
            },
            preco, moeda, dias: null,
          });
          await carregarCaixas(p);
          marcarSujo(p);
          const desc = nomeDaCaixa(def.tipo, minha.serie);
          evento(p, { k: 'marketCriado', descricao: desc, preco, moeda, dias: null, taxa: 0 });
          auditarMarketAnunciado(p, a, desc, preco, moeda, 0);
          enviar(p, { t: SERVIDOR.MARKET, aba: 'criado', anuncio: a });
        } catch (err) {
          await carregarCaixas(p);
          avisoDeErro(p, err);
        }
        return;
      }

      // Beast Ball mora em `p.balls`, não em `p.items`. O id 5 colide com Band Aid — só entra
      // aqui com `m.bola`, nunca por itemId sozinho.
      if (m.bola) {
        const tem = p.balls[BEAST_BALL.id] ?? 0;
        const qtd = Math.min(limitarQtd(m.qtd), tem);
        if (!qtd) return evento(p, { k: 'aviso', msg: 'você não tem Beast Ball' });

        p.balls[BEAST_BALL.id] = tem - qtd;
        if (!p.balls[BEAST_BALL.id]) delete p.balls[BEAST_BALL.id];
        marcarSujo(p);

        cobrarTaxa();
        try {
          const a = await mdb.criarAnuncio({
            vendedorId: p.dbId, vendedor: p.nick, tipo: 'item',
            itemId: BEAST_BALL.id, qtd,
            ficha: { nome: BEAST_BALL.nome, icone: BEAST_BALL.icone, bola: true, ballId: BEAST_BALL.id },
            preco, moeda, dias,
          });
          evento(p, { k: 'marketCriado', descricao: `${qtd}× ${BEAST_BALL.nome}`, preco, moeda, dias, taxa });
          auditarMarketAnunciado(p, a, `${qtd}× ${BEAST_BALL.nome}`, preco, moeda, taxa);
          enviar(p, { t: SERVIDOR.MARKET, aba: 'criado', anuncio: a });
        } catch (err) {
          p.balls[BEAST_BALL.id] = (p.balls[BEAST_BALL.id] ?? 0) + qtd;
          marcarSujo(p);
          estornarTaxa();
          avisoDeErro(p, err);
        }
        return;
      }

      const item = itens.get(Number(m.itemId));
      if (!item) return evento(p, { k: 'aviso', msg: 'item desconhecido' });
      // Casa é peça numerada e não mora em `items`: anuncia-se pelo número (`m.casaId`, acima).
      // Um item de casa aqui é cliente em cache.
      if (ehItemCasa(item.id)) return evento(p, { k: 'aviso', msg: 'casa.anuncieNumero' });
      // A bicicleta também: nunca como quantidade — seria uma cópia fora do escrow da linha numerada.
      if (ehItemBicicleta(item.id)) return evento(p, { k: 'aviso', msg: 'bicicleta.anuncieNumero' });
      // A Exp. Share é intransferível e tem aviso PRÓPRIO. `itemAnunciavelMercado` já a recusa
      // (ela saiu de `ITENS_MERCADO`), mas cairia no "não pode ser anunciado" genérico — e
      // quem tenta é justamente quem viu o item na vitrine semana passada e quer saber por quê.
      if (ehXpShareHeldItem(item.id)) {
        return evento(p, { k: 'aviso', msg: 'xpshareheld.travaMercado' });
      }
      const tem = p.items[item.id] ?? 0;
      const qtd = Math.min(limitarQtd(m.qtd), tem);
      if (!qtd) return evento(p, { k: 'aviso', msg: 'você não tem esse item' });
      if (!itemAnunciavelMercado(item)) return evento(p, { k: 'aviso', msg: `${item.name} não pode ser anunciado` });

      p.items[item.id] = tem - qtd;
      if (!p.items[item.id]) delete p.items[item.id];
      marcarSujo(p);

      cobrarTaxa();
      try {
        const a = await mdb.criarAnuncio({
          vendedorId: p.dbId, vendedor: p.nick, tipo: 'item',
          itemId: item.id, qtd,
          ficha: {
            nome: item.name, icone: item.icon ?? null, categoria: item.category ?? null,
            tipo: TIPO_DO_ITEM.get(item.id) ?? null, npc: precoDeVenda(item),
          },
          preco, moeda, dias,
        });
        evento(p, { k: 'marketCriado', descricao: `${qtd}× ${item.name}`, preco, moeda, dias, taxa });
        auditarMarketAnunciado(p, a, `${qtd}× ${item.name}`, preco, moeda, taxa);
        enviar(p, { t: SERVIDOR.MARKET, aba: 'criado', anuncio: a });
      } catch (err) {
        p.items[item.id] = (p.items[item.id] ?? 0) + qtd;
        marcarSujo(p);
        estornarTaxa();
        avisoDeErro(p, err);
      }
    })().catch((err) => {
      console.error('[market] criar falhou:', err.message);
      evento(p, { k: 'aviso', msg: 'não deu para publicar o anúncio' });
    });
    });
  },

  'market.editar': (p, m) => {
    const preco = Math.floor(Number(m.preco));
    if (!Number.isFinite(preco) || preco < 1) return evento(p, { k: 'aviso', msg: 'preço inválido' });
    const moeda = m.moeda === 'orb' ? 'orb' : 'gold';
    if (moeda === 'orb' && preco < mdb.PRECO_MIN_ORB) {
      return evento(p, { k: 'aviso', msg: mdb.msgPrecoMinOrb() });
    }
    if (moeda === 'gold' && preco < mdb.PRECO_MIN_GOLD) {
      return evento(p, { k: 'aviso', msg: mdb.msgPrecoMinGold() });
    }
    (async () => {
      const id = idDeAnuncio(m.id);
      const previa = id ? await mdb.anuncioPorId(id) : null;
      if (!previa || previa.estado !== 'aberto') return evento(p, { k: 'aviso', msg: 'esse anúncio já saiu' });
      if (previa.vendedorId !== p.dbId) return evento(p, { k: 'aviso', msg: 'esse anúncio não é seu' });
      if (previa.compravelEm && Date.now() < previa.compravelEm) {
        return evento(p, { k: 'aviso', msg: 'market.retencaoEditar' });
      }
      await mdb.editarAnuncio({ id, vendedorId: p.dbId, preco, moeda });
      comandos['market.meus'](p);
    })().catch((err) => evento(p, { k: 'aviso', msg: err.message }));
  },

  /** Cancela e devolve. Item volta ao inventário; pokémon volta ao depot. */
  'market.cancelar': (p, m) => {
    (async () => {
      const id = idDeAnuncio(m.id);
      if (!id) return evento(p, { k: 'aviso', msg: 'anúncio não está aberto' });
      const a = await mdb.cancelarAnuncio({ id, vendedorId: p.dbId });
      if (a.tipo === 'diamante') {
        // O ledger já devolveu dentro da transação (ver `devolverDiamantesDeAnuncios`); o que
        // falta é o cache da sessão. Vem por consulta, e não somando `a.qtd` em cima do que
        // está em memória: se a compra parcial mexeu no saldo entre uma coisa e outra, somar
        // levaria o número errado para a tela — e o saldo verdadeiro é o do banco.
        p.diamonds = await ddb.saldoDe(p.dbId);
        marcarSujo(p);
      } else if (a.tipo === 'item') {
        if (a.ficha?.caixaId) {
          // A caixa já voltou à mão do dono no banco (o escrow foi solto na transação do
          // cancelamento). Aqui só se relê a bolsa — somar em `items` criaria um fantasma.
          await carregarCaixas(p);
          marcarSujo(p);
        } else if (a.ficha?.bicicletaId) {
          // A bicicleta voltou à mão do dono no banco — se era a equipada, volta equipada.
          await carregarBicicletas(p);
          marcarSujo(p);
        } else if (a.ficha?.casaId) {
          // A casa voltou à mão do dono no banco, e VAZIA: os postos saíram no anúncio, e cancelar
          // não os devolve (o jogador escala de novo). Aqui só se relê a lista.
          await carregarCasas(p);
          marcarSujo(p);
        } else if (a.ficha?.bola) {
          const bid = a.ficha.ballId ?? a.itemId;
          p.balls[bid] = (p.balls[bid] ?? 0) + a.qtd;
          marcarSujo(p);
        } else {
          p.items[a.itemId] = (p.items[a.itemId] ?? 0) + a.qtd;
          marcarSujo(p);
        }
      } else {
        // O pokémon já voltou a ser dele no banco; falta trazer para a memória desta sessão.
        await recarregarPokemon(p, a.pokemonId);
      }
      evento(p, { k: 'marketCancelado', descricao: a.ficha?.nome ?? '' });
      auditarMarketCancelado(p, a, id);
      comandos['market.meus'](p);
    })().catch((err) => evento(p, { k: 'aviso', msg: err.message }));
  },

  /**
   * Compra.
   *
   * O ouro do comprador sai da MEMÓRIA antes da transação — ele está online por definição
   * (acabou de clicar) e é o flush dele que grava. Se a transação estourar, volta. As ORBs
   * são o contrário: quem debita é o ledger, dentro da transação, porque têm lastro.
   */
  // `interno` só existe quando o próprio sim chama (a volta do sorteio): o barramento entrega
  // `fn(p, msg)` com DOIS argumentos, então o cliente não tem como mandar o terceiro.
  'market.comprar': (p, m, interno = null) => {
    enfileirarEconomia(p, async () => {
      const chegouEm = interno?.chegouEm ?? Date.now();
      const id = idDeAnuncio(m.id);
      let cobrado = 0;
      let compraFeita = false;
      let trancadoNaCompra = false;

      // Lê o anúncio só para saber quanto debitar de OURO antes da transação. Quem decide
      // de verdade é o `FOR UPDATE` lá dentro — esta leitura é otimista e pode estar velha,
      // e é por isso que existe o estorno no `catch`.
      const previa = id ? await mdb.anuncioPorId(id) : null;
      if (!previa || previa.estado !== 'aberto') {
        const perdeu = interno?.doSorteio && previa?.estado === 'vendido';
        return evento(p, { k: 'aviso', msg: perdeu ? 'market.sorteioPerdeu' : 'esse anúncio já saiu' });
      }
      if (previa.vendedorId === p.dbId) return evento(p, { k: 'aviso', msg: 'esse anúncio é seu' });
      if (previa.compravelEm && Date.now() < previa.compravelEm) {
        return evento(p, { k: 'aviso', msg: 'market.retencao' });
      }

      // ---- o sorteio da liberação (ver `sorteio-mercado.mjs`)
      //
      // Pedido que chega nos primeiros 3 s depois de o anúncio liberar não compra na hora: tenta num
      // instante sorteado entre 3 e 4 s. Pedir no primeiro milissegundo não dá vantagem sobre pedir
      // no segundo 2 — e essa vantagem era a de um bot. Um bilhete por jogador por anúncio: repetir o
      // pedido não compra mais chances. Nada disso vem do cliente: o horário é o do servidor, e a
      // volta do sorteio chega pelo terceiro argumento, que a mensagem do socket não alcança.
      if (!interno?.sorteado) {
        const plano = planoDaCompra(previa.compravelEm, Date.now());
        if (plano.esperaMs > 0) {
          p.sorteiosMercado ??= new Set();
          if (p.sorteiosMercado.has(id)) return;
          p.sorteiosMercado.add(id);
          // Pedido colado na liberação, várias vezes na hora: só registra (ver `telemetria-bot.mjs`).
          if (plano.tipo === 'sorteio') {
            sinalizarSuspeita(p, registrarCompraMercado(p, { compravelEm: previa.compravelEm, t: chegouEm }));
          }
          evento(p, { k: 'aviso', msg: plano.tipo === 'sorteio' ? 'market.sorteio' : 'market.sorteioEspera' });
          setTimeout(() => {
            p.sorteiosMercado?.delete(id);
            if (jogadores.get(p.key) !== p) return;
            comandos['market.comprar'](p, m, { chegouEm, sorteado: true, doSorteio: plano.tipo === 'sorteio' });
          }, plano.esperaMs);
          return;
        }
      }
      // Compra parcial: o jogador escolhe quantas unidades leva do lote. Sem `qtd` (cliente
      // antigo, ou pokémon) leva tudo, que é o comportamento de sempre.
      const pedido = previa.tipo === 'pokemon'
        ? 1
        : Math.max(1, Math.min(previa.qtd, Math.floor(Number(m.qtd)) || previa.qtd));

      // O PREÇO COMBINADO é o que o comprador viu na tela, não o que a prévia leu agora. Ele
      // desce até a transação e é lá que vira trava (ver `comprarAnuncio`): sem um preço vindo
      // do CLIENTE, o vendedor podia subir o valor entre o clique e a chegada da mensagem e a
      // compra saía pelo preço novo. Cliente velho não manda `preco`, e aí a transação recusa
      // e pede um F5 — fechar por baixo é o certo aqui.
      const precoVisto = Number(m.preco);
      const moedaVista = m.moeda ?? previa.moeda;

      // O preço vem do CLIENTE de propósito (é ele que trava o time-of-check/time-of-use lá
      // embaixo), e por isso NÃO pode ser tratado como número de confiança aqui em cima.
      // `comprarAnuncio` já recusa negativo, mas a recusa chega tarde: o débito otimista
      // abaixo acontece ANTES da transação, e `p.gold -= (-100000)` credita. O estorno do
      // `catch` não desfazia porque `somarGoldAuditado` descarta valor <= 0 — o ganho ficava
      // de pé, e sem linha de auditoria. A mesma checagem da transação tem de existir aqui.
      if (!Number.isFinite(precoVisto) || precoVisto < 0) {
        return evento(p, { k: 'aviso', msg: 'recarregue a página para comprar (versão antiga do jogo)' });
      }

      const total = precoVisto * pedido;
      if (moedaVista === 'gold') {
        if (p.gold < total) return evento(p, { k: 'aviso', msg: 'Ouro insuficiente' });
        cobrado = subtrairGold(p, total);
        marcarSujo(p);
      }

      try {
        const r = await mdb.comprarAnuncio({
          id, compradorId: p.dbId, comprador: p.nick, qtd: pedido,
          preco: precoVisto, moeda: moedaVista,
        });
        compraFeita = true;
        // A transação garante que o preço não SUBIU, mas ele pode ter CAÍDO — e nesse caso ela
        // cobra o novo, mais barato. A diferença volta para o bolso do comprador aqui. Subir
        // não chega neste ponto: `comprarAnuncio` estoura e o `catch` estorna tudo.
        if (cobrado && r.total !== cobrado) {
          somarGoldAuditado(p, cobrado - r.total, 'market_desconto', `anúncio ${id}`);
          cobrado = r.total;
        }
        if (r.anuncio.tipo === 'diamante') {
          // O crédito já aconteceu no ledger, dentro da transação — aqui só se atualiza o
          // cache com o saldo que ela devolveu. Somar de novo pagaria duas vezes.
          if (r.diamantesDoComprador != null) p.diamonds = r.diamantesDoComprador;
        } else if (r.anuncio.tipo === 'item') {
          if (r.anuncio.ficha?.caixaId) {
            // A caixa já mudou de dono dentro da transação, com o número junto. O que falta é
            // trazer a bolsa desta sessão para o mesmo estado do banco.
            await carregarCaixas(p);
          } else if (r.anuncio.ficha?.bicicletaId) {
            // A bicicleta mudou de dono na transação, com o número. Chega desequipada.
            await carregarBicicletas(p);
          } else if (r.anuncio.ficha?.casaId) {
            // A casa também: mudou de dono na transação, com o número. Chega sem posto nenhum.
            await carregarCasas(p);
          } else if (r.anuncio.ficha?.bola) {
            const bid = r.anuncio.ficha.ballId ?? r.anuncio.itemId;
            p.balls[bid] = (p.balls[bid] ?? 0) + r.anuncio.qtd;
          } else {
            p.items[r.anuncio.itemId] = (p.items[r.anuncio.itemId] ?? 0) + r.anuncio.qtd;
          }
        } else {
          // Todo pokémon COMPRADO chega trancado na venda — sem olhar nota, shiny ou potência.
          // Quem pagou por ele no Mercado não o quer indo embora num "vender o depot inteiro"
          // dois cliques depois. O cadeado continua ali para quem quiser mesmo revendê-lo ao NPC.
          const pk = await recarregarPokemon(p, r.anuncio.pokemonId);
          if (pk) {
            travarPokemon(p, pk.id);
            trancadoNaCompra = true;
          }
        }
        if (r.anuncio.moeda === 'orb') p.orbs = await odb.saldoDe(p.dbId);
        marcarSujo(p);
        evento(p, {
          k: 'marketComprado',
          descricao: r.anuncio.tipo === 'pokemon'
            ? `${r.anuncio.ficha?.nome} Nv ${r.anuncio.ficha?.level}`
            : r.anuncio.tipo === 'diamante'
              ? `${r.anuncio.qtd}× 💎`
              // Caixa: o número É o produto, e "1× Founder Box" não diz qual saiu.
              : r.anuncio.ficha?.caixaId
                ? nomeDaCaixa(r.anuncio.ficha.caixaTipo, r.anuncio.ficha.serie)
                : r.anuncio.ficha?.bicicletaId
                  ? `${r.anuncio.ficha?.nome} ${numeroDaBicicleta(r.anuncio.ficha.bicicletaId)}`
                : r.anuncio.ficha?.casaId
                  ? `${r.anuncio.ficha?.nome} ${numeroDaCasa(r.anuncio.ficha.casaId)}`
                  : `${r.anuncio.qtd}× ${r.anuncio.ficha?.nome}`,
          total: r.total,
          moeda: r.anuncio.moeda,
          // Quanto sobrou do lote, para a tela saber se o anúncio continua na vitrine.
          sobra: r.sobra,
          // O pokémon entrou trancado na venda — o aviso da compra diz isso.
          trancado: trancadoNaCompra,
        });
        const descCompra =
          r.anuncio.tipo === 'pokemon'
            ? `${r.anuncio.ficha?.nome} Nv ${r.anuncio.ficha?.level}${r.anuncio.ficha?.shiny ? ' ★' : ''}`
            : r.anuncio.tipo === 'diamante'
              ? `${r.anuncio.qtd} diamante(s)`
              : r.anuncio.ficha?.caixaId
                ? nomeDaCaixa(r.anuncio.ficha.caixaTipo, r.anuncio.ficha.serie)
                : r.anuncio.ficha?.bicicletaId
                  ? `${r.anuncio.ficha?.nome} ${numeroDaBicicleta(r.anuncio.ficha.bicicletaId)}`
                : r.anuncio.ficha?.casaId
                  ? `${r.anuncio.ficha?.nome} ${numeroDaCasa(r.anuncio.ficha.casaId)}`
                  : `${r.anuncio.qtd}× ${r.anuncio.ficha?.nome}`;
        auditar(
          p,
          'market',
          'comprado',
          `${descCompra} · pagou ${r.total.toLocaleString('pt-BR')} ${r.anuncio.moeda}${r.anuncio.vendedor ? ` · vendedor ${r.anuncio.vendedor}` : ''}${r.anuncio.moeda === 'gold' ? ` · gold ${Math.floor(p.gold ?? 0).toLocaleString('pt-BR')}` : ''}`,
          `anuncio:${id}`,
        );
        // A vitrine NÃO é reenviada daqui. Este `m` é a mensagem de compra e não carrega os
        // filtros da tela, então listar com ele devolvia a vitrine inteira e desfazia o
        // "pokémon de fogo" que o jogador tinha escolhido. Quem repede é o cliente, no evento
        // acima, com os filtros dele em mãos.
      } catch (err) {
        // Só estorna se a transação NÃO commitou — senão o vendedor já tem pagamento na caixa
        // postal e devolver ao comprador duplicaria ouro no servidor inteiro.
        if (cobrado && !compraFeita) {
          somarGoldAuditado(p, cobrado, 'market_estorno', `anúncio ${id} · ${err.message}`);
          marcarSujo(p);
        } else if (compraFeita) {
          console.error(`[market] compra ${id} commitou mas a entrega falhou:`, err.message);
        }
        // Perdeu o sorteio dentro da transação: o instante sorteado de outro jogador fechou o
        // anúncio entre a prévia e o `FOR UPDATE`. "só restam N" segue como está — sobrou estoque,
        // e o jogador precisa do número para pedir de novo.
        const perdeu = interno?.doSorteio && /já saiu/.test(err.message);
        evento(p, { k: 'aviso', msg: perdeu ? 'market.sorteioPerdeu' : err.message });
      }
    });
  },

  /**
   * Evoluir um pokémon: nível mínimo + uma pedra do tipo primário da espécie.
   *
   * O SHINY também evolui, desde a Shiny Stone existir — só que com a pedra shiny daquele
   * tipo, que custa 10 fragmentos da Outland. Ver `game/shiny-stone.mjs`.
   */
  'pokemon.evoluir': (p, m) => {
    enfileirarEconomia(p, () => {
      const pk = p.pokemons.get(Number(m.pokemonId));
      if (!pk) return evento(p, { k: 'aviso', msg: 'esse pokémon não está mais com você' });

      const esp = especies.get(pk.speciesId);
      if (isOutlandPokeId(pk.speciesId)) {
        return evento(p, { k: 'aviso', msg: 'variantes de Outland não evoluem' });
      }
      /**
       * QUAL evolução — a cadeia pode abrir em mais de uma (`evolucoes-ramificadas.mjs`).
       *
       * `alvoId` vem da tela de escolha. Sem ele, vale o primeiro destino, que é o que o
       * `evolvesToId` do catálogo sempre apontou: cliente velho continua evoluindo o que
       * evoluía. O que NÃO se aceita é um `alvoId` de fora da lista — senão a mensagem vira um
       * "vire qualquer espécie" com uma pedra de 1 item.
       */
      const destinos = destinosDeEvolucao(esp, (id) => especies.get(id));
      if (!destinos.length) return evento(p, { k: 'aviso', msg: 'esse pokémon não evolui' });

      const escolha = m.alvoId != null
        ? destinos.find((d) => d.pokeId === Number(m.alvoId))
        : destinos[0];
      if (!escolha) return evento(p, { k: 'aviso', msg: 'essa evolução não é desta espécie' });

      /**
       * Destino sem arte não evolui, e isto é uma TRAVA, não um detalhe de tela.
       *
       * `looktype: 1` é o placeholder do Sprite Lab: não está no índice de outfits e não
       * desenha nada. Sem esta linha, evoluir um Chespin gastava a Leaf Stone e devolvia um
       * Quilladin invisível — 95 elos do catálogo apontam para um alvo assim hoje, e nenhum
       * deles tem volta.
       */
      if (!escolha.temArte) {
        return evento(p, { k: 'aviso', msg: `${escolha.especie.name} ainda não tem sprite no jogo` });
      }
      if (pk.level < (escolha.nivel || 999)) {
        return evento(p, { k: 'aviso', msg: `precisa estar no nível ${escolha.nivel}` });
      }

      const novaEsp = escolha.especie;

      /**
       * SHINY evolui com SHINY STONE; comum, com a pedra comum.
       *
       * Antes disto o shiny simplesmente não evoluía ("shiny não evolui"), e a razão era boa:
       * sem a forma shiny da evolução no catálogo, o jogador trocaria o item mais raro que tem
       * por um pokémon de cor comum. A trava abaixo é o que substitui aquela recusa geral —
       * confere que a arte EXISTE antes de aceitar a troca. Sem ela, evoluir um shiny cuja
       * evolução não tem forma shiny seria destruir o shiny, e não há como desfazer.
       */
      if (pk.shiny && !looktypeShiny(novaEsp.pokeId)) {
        return evento(p, { k: 'aviso', msg: `${novaEsp.name} ainda não tem forma shiny — a evolução destruiria o seu` });
      }

      // A pedra segue o DESTINO nas cadeias que abrem: Water Stone para Vaporeon, Fire Stone
      // para Flareon. Fora delas, `escolha.especie` não muda a conta.
      const pedra = pk.shiny
        ? shinyStoneDeEvolucao(esp, escolha.especie)
        : pedraDeEvolucao(esp, escolha.especie);
      if (!pedra) return evento(p, { k: 'aviso', msg: 'pedra de evolução indisponível' });

      const tem = p.items[pedra.itemId] ?? 0;
      if (tem < 1) return evento(p, { k: 'aviso', msg: `precisa de 1× ${pedra.nome}` });

      p.items[pedra.itemId] = tem - 1;
      if (!p.items[pedra.itemId]) delete p.items[pedra.itemId];

      const nomeAntigo = pk.nome;
      pk.speciesId = novaEsp.pokeId;
      pk.nome = novaEsp.name;
      pk.looktype = novaEsp.looktype;
      pk.lookShiny = pk.shiny ? looktypeShiny(novaEsp.pokeId) : null;
      pk.tipos = [novaEsp.type1, novaEsp.type2].filter(Boolean);
      recalcular(pk);
      pk.hp = pk.maxHp;

      registrarCapturaDex(p, novaEsp.pokeId);

      marcarSujo(p, pk);
      if (pk.shiny) {
        auditar(
          p,
          'evolucao',
          'shiny_stone',
          `${rotuloPokemon(nomeAntigo, pk.id)} → ${pk.nome} · gastou 1× ${pedra.nome} (${tem}→${p.items[pedra.itemId] ?? 0})`,
          `pk:${pk.id}`,
        );
      }
      evento(p, {
        k: 'evolucao',
        id: pk.id,
        de: nomeAntigo,
        nome: pk.nome,
        pedra: pedra.nome,
        level: pk.level,
      });
    });
  },

  /**
   * MEGA EVOLUIR: gasta a Mega Stone da espécie e troca o pokémon pela mega (#3xxx).
   *
   * É a irmã de `pokemon.evoluir` e repete as travas dela na mesma ordem, porque os riscos são
   * os mesmos — uma troca de espécie sem volta, paga com um item caro:
   *
   *   1. o pokémon ainda é do jogador (a fila de economia deixa a aba antiga chegar tarde);
   *   2. a espécie TEM mega (`megaDaEspecie` recusa Outland e recusa a própria mega, então
   *      megaevoluir duas vezes não existe);
   *   3. quem é SHINY precisa da pedra shiny, e quem não é precisa da comum. As duas travas
   *      são explícitas: sem a primeira, um shiny viraria uma mega de cor comum e o item mais
   *      raro da conta estaria destruído; sem a segunda, a pedra shiny (que custa o dobro do
   *      tempo de boss) seria gasta à toa num bicho comum;
   *   4. a mega tem arte — `temSpriteJogo`, a mesma trava que a evolução usa. Hoje as 35 têm,
   *      mas uma entrada nova em `shared/megas.mjs` sem o PNG publicado cairia aqui em vez de
   *      entregar um pokémon invisível.
   *
   * NÃO há pedido de nível: a mega não é um degrau da cadeia, é uma troca de forma. O custo é
   * o boss, e o boss já pede nível 300 para entrar.
   *
   * TRANCA o pokémon no fim, como o refino faz: um bicho com dez fragmentos de boss dentro não
   * pode sumir num clique de "vender o depot inteiro". Destravar continua a um clique.
   */
  'pokemon.mega': (p, m) => {
    enfileirarEconomia(p, () => {
      const pk = p.pokemons.get(Number(m.pokemonId));
      if (!pk) return evento(p, { k: 'aviso', msg: 'esse pokémon não está mais com você' });

      const meta = megaDaEspecie(pk.speciesId);
      if (!meta) {
        return evento(p, { k: 'aviso', msg: `${pk.nome} não tem Mega Evolução` });
      }
      if (pk.shiny && !megaTemShiny(meta)) {
        return evento(p, { k: 'aviso', msg: `${meta.nome} ainda não tem forma shiny — a mega destruiria o seu` });
      }

      const pedra = megaStoneDeEvolucao(pk.speciesId, !!pk.shiny);
      if (!pedra) return evento(p, { k: 'aviso', msg: 'pedra de mega indisponível' });

      const novaEsp = especies.get(pedra.megaPokeId);
      if (!novaEsp || !temSpriteJogo(novaEsp)) {
        return evento(p, { k: 'aviso', msg: `${meta.nome} ainda não tem sprite no jogo` });
      }

      const tem = p.items[pedra.itemId] ?? 0;
      if (tem < 1) return evento(p, { k: 'aviso', msg: `precisa de 1× ${pedra.nome}` });

      p.items[pedra.itemId] = tem - 1;
      if (!p.items[pedra.itemId]) delete p.items[pedra.itemId];

      const nomeAntigo = pk.nome;
      pk.speciesId = novaEsp.pokeId;
      pk.nome = novaEsp.name;
      pk.looktype = novaEsp.looktype;
      pk.lookShiny = pk.shiny ? looktypeShiny(novaEsp.pokeId) : null;
      pk.tipos = [novaEsp.type1, novaEsp.type2].filter(Boolean);
      recalcular(pk);
      pk.hp = pk.maxHp;

      registrarCapturaDex(p, novaEsp.pokeId);
      travarPokemon(p, pk.id);

      marcarSujo(p, pk);
      auditar(
        p,
        'evolucao',
        pedra.shiny ? 'mega_shiny' : 'mega',
        `${rotuloPokemon(nomeAntigo, pk.id)} → ${pk.nome} · gastou 1× ${pedra.nome} (${tem}→${p.items[pedra.itemId] ?? 0})`,
        `pk:${pk.id}`,
      );
      evento(p, {
        k: 'mega',
        id: pk.id,
        de: nomeAntigo,
        nome: pk.nome,
        pedra: pedra.nome,
        shiny: !!pk.shiny,
        level: pk.level,
      });
    });
  },

  /**
   * REFINAR um stat-base: `+1` permanente pago em pedras de evolução.
   *
   * O contrato inteiro está em `shared/refino-stats.mjs`; aqui só se cobra e se grava. Três
   * decisões que valem a pena repetir onde o dinheiro sai:
   *
   *   · o custo é POR STAT (`custoDoRefino(nível daquele stat)`), não por pokémon — quem
   *     empilhou quatro degraus em HP continua pagando 500 no primeiro de ATK. É o que
   *     transforma o sistema numa ESCOLHA em vez de numa barra que se enche;
   *   · a pedra vem dos tipos elementares do bicho (`pedrasDeRefino`) — dual-type aceita
   *     qualquer uma ou uma mistura dos saldos;
   *   · refinar TRANCA o pokémon na venda. Um bicho com 30 mil pedras dentro não pode sumir
   *     num clique de "vender o depot inteiro" — e destravar continua a um clique de distância
   *     para quem realmente quiser vendê-lo.
   *
   * Entra na fila de economia como qualquer compra: duas abas abertas apertando "+" ao mesmo
   * tempo cobrariam a mesma pedra duas vezes sem ela.
   */
  'pokemon.refinar': (p, m) => {
    enfileirarEconomia(p, () => {
      const pk = p.pokemons.get(Number(m.pokemonId));
      if (!pk) return evento(p, { k: 'aviso', msg: 'esse pokémon não está mais com você' });

      const stat = String(m.stat ?? '');
      if (!STATS_REFINAVEIS.includes(stat)) {
        return evento(p, { k: 'aviso', msg: 'esse stat não aceita refino' });
      }

      const esp = especies.get(pk.speciesId);
      if (!esp) return evento(p, { k: 'aviso', msg: 'espécie desconhecida' });

      const refino = normalizarRefino(pk.refino);
      const nivel = refino[stat];
      // Não há teto de JOGO — a cúbica é que segura o ritmo. Este `if` é a guarda de
      // aritmética de `REFINO_TETO_TECNICO`, e chegar nela custaria mais pedras do que o jogo
      // inteiro já dropou. Ver o cabeçalho de `shared/refino-stats.mjs`.
      if (nivel >= REFINO_TETO_TECNICO) {
        return evento(p, { k: 'aviso', msg: `${pk.nome} não pode subir mais esse stat` });
      }

      const pedras = pedrasDeRefino(esp);
      if (!pedras.length) return evento(p, { k: 'aviso', msg: 'pedra de refino indisponível' });

      const custo = custoDoRefino(nivel);
      const tem = saldoPedrasRefino(p.items, pedras);
      if (tem < custo) {
        const rotulo = rotuloPedrasRefino(pedras);
        return evento(p, {
          k: 'aviso',
          msg: `precisa de ${custo} pedras (${rotulo}) — você tem ${tem}`,
        });
      }

      const consumido = consumirPedrasRefino(p.items, pedras, custo);
      if (!consumido) {
        return evento(p, { k: 'aviso', msg: 'saldo de pedras insuficiente' });
      }
      const gastoTxt = formatarConsumoPedras(consumido);
      const pedra = pedras[0];

      refino[stat] = nivel + 1;
      pk.refino = refino;
      recalcular(pk);
      travarPokemon(p, pk.id);

      marcarSujo(p, pk);
      evento(p, {
        k: 'refino',
        id: pk.id,
        nome: pk.nome,
        stat,
        nivel: refino[stat],
        total: pk.refinoTotal,
        investido: investidoNoRefino(refino),
        pedra: pedra.nome,
        pedras: consumido,
        custo,
      });
      auditar(
        p,
        'refino',
        'degrau',
        `${rotuloPokemon(pk.nome, pk.id)} · ${stat} +${refino[stat]} · ${gastoTxt} (${tem}→${saldoPedrasRefino(p.items, pedras)})`,
        `pk:${pk.id}`,
      );
    });
  },

  /**
   * REDUZIR O NÍVEL: leva o pokémon ao nível que o jogador digitou, com piso no "Nível ao
   * capturar" da espécie.
   *
   * A regra e o porquê estão em `shared/reduzir-nivel.mjs`. O que importa AQUI é de onde sai
   * cada número da conta, porque este é um comando que MEXE NO NÍVEL a pedido do cliente — e
   * agora com um número que o cliente escreve:
   *
   *   · o nível de partida é `pk.level`, o que o servidor tem em mão — nunca o que a mensagem
   *     diz que ele é;
   *   · o piso é o "Nível ao capturar" da espécie, montado pelo catálogo do SERVIDOR
   *     (`pisoDeReducaoDaEspecie`: degrau da hunt cortado pelo teto de captura);
   *   · `m.nivelAlvo` vai CRU para `validarNivelAlvo`, sem `Number()` no caminho: só passa um
   *     `number` inteiro entre o piso e `pk.level − 1`. Negativo, zero, acima do nível atual,
   *     fração, string, array — tudo vira aviso, e NADA muda. Não há arredondamento para a
   *     borda, que transformaria um `-40` adulterado numa redução até o piso;
   *   · e o porteiro fecha com um `Math.min(atual − 1, …)`.
   *
   * Sem `nivelAlvo` na mensagem é uma aba aberta antes do campo existir: cai um nível, como o
   * botão de antes, pelo MESMO porteiro.
   *
   * O XP vai para o PISO do nível novo (`xpTotalParaNivel`), e não para um ponto abaixo do
   * limiar: parar a um XP da fronteira devolveria o pokémon ao nível de antes no primeiro
   * abate, e o jogador continuaria travado — só que agora sem o XP também. E nunca para CIMA:
   * ver o `Math.min` na linha que grava.
   */
  'pokemon.reduzirNivel': (p, m) => {
    enfileirarEconomia(p, () => {
      const pk = p.pokemons.get(Number(m.pokemonId));
      if (!pk) return evento(p, { k: 'aviso', msg: 'esse pokémon não está mais com você' });

      const esp = especies.get(pk.speciesId);
      if (!esp) return evento(p, { k: 'aviso', msg: 'espécie desconhecida' });

      const piso = pisoDeReducaoDaEspecie(esp);
      const atual = Math.max(1, Math.floor(Number(pk.level) || 1));
      const alvo = m?.nivelAlvo === undefined ? atual - PASSO_REDUCAO_NIVEL : m.nivelAlvo;
      const pedido = validarNivelAlvo(atual, piso, alvo);
      if (!pedido.ok) {
        return evento(p, {
          k: 'aviso',
          msg: pedido.motivo === 'noPiso'
            ? `${pk.nome} já está no nível de captura da espécie (nv ${piso}) — não dá para baixar mais`
            : `nível inválido — escolha um nível entre ${pedido.min} e ${pedido.max} para ${pk.nome}`,
        });
      }
      const novo = pedido.novo;

      const xpAntes = Math.max(0, Number(pk.xp) || 0);
      pk.level = novo;
      // O `Math.min` é o que garante que esta operação NUNCA some XP. Em jogo normal ele não
      // muda nada — `ganharXp` mantém `level === nivelPeloXp(xp)`, então o piso do nível de
      // baixo é sempre menor que o XP de agora. Ele existe para o par que chega desencontrado
      // por outro caminho (uma linha importada, um acerto manual no banco): ali, sem ele, o
      // jogador descobriria que perder um nível PAGA XP.
      pk.xp = Math.min(xpAntes, xpTotalParaNivel(novo));
      // `recalcular` refaz stats, poder e nota, e corta o HP para o `maxHp` novo. NÃO cura: um
      // pokémon caído continua caído, e ninguém usa este botão como poção no meio da luta.
      recalcular(pk);
      // A sala da casa mostra o nível de quem está no XP Share — o mesmo motivo do level-up.
      if (p.casa) sincronizarTreinos(p.casa, registradosParaSala(p), agora());

      marcarSujo(p, pk);
      const xpPerdido = Math.max(0, xpAntes - pk.xp);
      evento(p, {
        k: 'nivelReduzido',
        id: pk.id,
        nome: pk.nome,
        de: atual,
        para: novo,
        piso,
        xpPerdido,
      });
      // Auditado como o refino: mexe em nível e XP, não tem volta, e é o primeiro lugar onde
      // se olha quando alguém abrir chamado dizendo que perdeu níveis sem ter pedido.
      auditar(
        p,
        'pokemon',
        'nivel_reduzido',
        `${rotuloPokemon(pk.nome, pk.id)} · nv ${atual}→${novo} (piso ${piso}) · −${xpPerdido} xp`,
        `pk:${pk.id}`,
      );
    });
  },

  /** Vende o depot inteiro. A equipe nunca entra — quem está no time é escolha do jogador. */
  'shop.sellAllPokemons': (p) => {
    enfileirarEconomia(p, async () => {
      // Quem segura Exp. Share fica FORA do lote, pela mesma razão da venda unitária
      // (`shop.sellPokemon`): o item custa 50 💎 e some junto com a linha, sem aviso e sem
      // volta. A trava existia só lá, e o botão "vender o depot inteiro" passava por cima
      // dela — bastava ter deixado o item num pokémon do depot.
      // A Coleção num `Set`: um depot de mil pokémon com mil na Coleção eram um milhão de
      // comparações com a lista crua.
      const colecao = conjuntoColecao(p);
      const lote = [...p.pokemons.values()].filter(
        (k) => k.slot == null && k.id !== p.activeId && !colecao.has(k.id)
          && !ehXpShareHeldItem(k.heldItemId),
      );
      if (!lote.length) return evento(p, { k: 'aviso', msg: 'o depot está vazio' });

      const ganho = lote.reduce((s, k) => s + precoDoPokemon(k), 0);
      for (const k of lote) destravarPokemon(p, k.id);
      try {
        await removerPokemons(p, lote);
      } catch (err) {
        console.error('[sim] venda em lote falhou ao apagar pokémon:', err.message);
        for (const k of lote) await recarregarPokemon(p, k.id);
        return evento(p, { k: 'aviso', msg: 'não deu para concluir a venda — tente de novo' });
      }
      somarGoldAuditado(p, ganho, 'npc_lote', `${lote.length} pokémon do depot`);
      marcarSujo(p);
      evento(p, { k: 'venda', nome: `${lote.length} pokémon do depot`, qtd: lote.length, ganho });
    });
  },
};

// ---------------------------------------------------------------------- market

/** Categorias que o Market vende — o resto do catálogo é drop e só pode ser vendido. */
const COMPRAVEIS = new Set(['heal', 'revive']);

/**
 * Itens avulsos fora das categorias `COMPRAVEIS`. Hoje, NENHUM.
 *
 * A Ficha PvP morava aqui a 1.000.000 de ouro: era a entrada da Arena PvP ao vivo. Com o PvP
 * individual virando ranqueado e GRATUITO, ela deixou de ter uso — e um item à venda por um
 * milhão que não serve para nada é pior do que um item que sumiu da loja. Quem tem fichas
 * guardadas continua com elas na bolsa (não são apagadas); elas só não são mais vendidas.
 *
 * O Bronze Boss Token nunca esteve aqui — cai raro na hunt (ver `rolarBossTokenSelvagem`).
 */
const ITENS_COMPRAVEIS = new Map();

const limitarQtd = (n) => Math.max(1, Math.min(9999, Math.floor(Number(n)) || 1));

/**
 * Id de anúncio vindo do cliente: inteiro seguro e positivo, ou `null`. Sem isto `NaN`, `1e308`
 * e `0.5` iam direto para o `WHERE id = $1` e voltavam ao jogador como o texto do erro do
 * Postgres (`invalid input syntax for type bigint`).
 */
const idDeAnuncio = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** Cadeado da venda de loot — persiste no jsonb `automation`, junto das auto-poções. */
function idsLootTravado(p) {
  if (!Array.isArray(p.automation.lootTravado)) p.automation.lootTravado = [];
  return p.automation.lootTravado;
}
function idsPokemonTravado(p) {
  if (!Array.isArray(p.automation.pokemonTravado)) p.automation.pokemonTravado = [];
  return p.automation.pokemonTravado;
}
const itemLootTravado = (p, itemId) => idsLootTravado(p).includes(Number(itemId));
const pokemonVendaTravado = (p, pkId) => idsPokemonTravado(p).includes(Number(pkId));
function alternarLootTravado(p, itemId) {
  const id = Number(itemId);
  const arr = idsLootTravado(p);
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(id);
}
function travarPokemon(p, pkId) {
  const id = Number(pkId);
  const arr = idsPokemonTravado(p);
  if (!arr.includes(id)) arr.push(id);
}
/** Tranca na venda todo shiny que o jogador já tem (equipe + depot). */
function travarTodosShinys(p) {
  for (const pk of p.pokemons.values()) {
    if (pk.shiny) travarPokemon(p, pk.id);
  }
}

/** A nota do Auto Lock deste jogador: a que ele escolheu, ou o padrão. */
const notaAutoLockDe = (p) => notaAutoLockValida(p.automation?.autoLockNotaMin) ?? AUTO_LOCK_NOTA_MIN;

/** Passa no Auto Lock N+? Nota ≥ a escolhida pelo jogador. */
function pokemonPassaAutoLockNota(p, pk) {
  const nota = pk.nota ?? notaDePokemon(pk, especies.get(pk.speciesId));
  return nota != null && nota >= notaAutoLockDe(p);
}

/** Tranca na venda todo pokémon com nota ≥ a escolhida pelo jogador (equipe + depot). */
function travarTodosNota9(p) {
  for (const pk of p.pokemons.values()) {
    if (pokemonPassaAutoLockNota(p, pk)) travarPokemon(p, pk.id);
  }
}

function pokemonPassaAutoLockP5(pk) {
  return Number(pk.potencia) === POTENCIA_MAX;
}

/** Tranca na venda todo pokémon com potência V (equipe + depot). */
function travarTodosP5(p) {
  for (const pk of p.pokemons.values()) {
    if (pokemonPassaAutoLockP5(pk)) travarPokemon(p, pk.id);
  }
}

/** Auto-lock na venda (shiny, nota N+, P5) — captura, compra no Mercado da Comunidade, etc. */
function aplicarAutoLockPokemon(p, pk) {
  if (!pk) return;
  if (pk.shiny && p.automation?.autoLockShiny) travarPokemon(p, pk.id);
  if (p.automation?.autoLockNota9 && pokemonPassaAutoLockNota(p, pk)) travarPokemon(p, pk.id);
  if (p.automation?.autoLockP5 && pokemonPassaAutoLockP5(pk)) travarPokemon(p, pk.id);
}
function destravarLoot(p, itemId) {
  const arr = idsLootTravado(p);
  const i = arr.indexOf(Number(itemId));
  if (i >= 0) arr.splice(i, 1);
}
function destravarPokemon(p, pkId) {
  const arr = idsPokemonTravado(p);
  const i = arr.indexOf(Number(pkId));
  if (i >= 0) arr.splice(i, 1);
}

// ------------------------------------------------------------------ a Coleção
//
// A COLEÇÃO é o antigo cadeado de venda, com outro nome e outra cara: a mesma lista de ids em
// `automation.pokemonTravado`, e a mesma regra — pokémon da Coleção não entra na venda ao NPC,
// nem na unitária nem no "vender o depot inteiro". Na tela ele sai da aba de venda e vai para
// a aba Coleção do Depot; nos seletores (Oferenda, Mercado, equipes) ele continua, com a ★.
//
// ### Por que "mover" não tem como duplicar pokémon
//
// Depot e Coleção não são dois lugares: são uma MARCA sobre a mesma linha de `player_pokemon`.
// Mover não copia, não apaga e não troca o pokémon de tabela — só põe ou tira um id de uma
// lista. Não existe um instante em que o bicho esteja nos dois lados, porque não existem dois
// lados. O que a espera abaixo segura é outra coisa: o clique em laço (cada troca grava o
// `automation` no próximo flush) e a disputa com a venda, que também passa pela fila de
// economia do jogador.

/** Espera entre duas mudanças do MESMO pokémon entre Depot e Coleção. */
const COLECAO_COOLDOWN_MS = 3000;

const naColecao = pokemonVendaTravado;

/** Os ids da Coleção num `Set` — para os laços que perguntam por centenas de pokémon. */
const conjuntoColecao = (p) => new Set(idsPokemonTravado(p));

/**
 * Tira da Coleção os ids que não são mais do jogador. Devolve `true` quando mudou algo.
 *
 * Pokémon vendido ao NPC ou oferendado já sai da lista na hora; o que sobrava eram os vendidos
 * no Mercado (a linha muda de dono) e o lixo de antes da validação. Os ANUNCIADOS ficam: não
 * estão na memória, mas voltam para a mão se o anúncio for cancelado. `anunciados === null` é
 * a leitura que falhou — aí não se limpa nada, para não tirar da Coleção quem está à venda.
 */
function limparColecao(p, anunciados) {
  if (!Array.isArray(anunciados)) return false;
  const antes = idsPokemonTravado(p);
  const valem = new Set(anunciados);
  const limpa = [...new Set(antes.map(Number))].filter(
    (id) => Number.isSafeInteger(id) && id > 0 && (p.pokemons.has(id) || valem.has(id)),
  );
  // Compara item a item, e não só o tamanho: um id gravado como texto ("42") vira número aqui,
  // e `includes(42)` não o acharia na lista velha.
  if (limpa.length === antes.length && limpa.every((v, i) => v === antes[i])) return false;
  p.automation.pokemonTravado = limpa;
  return true;
}

/**
 * Põe (`para: 'colecao'`) ou tira (`para: 'depot'`) um pokémon da Coleção.
 *
 * Roda DENTRO da fila de economia (ver os comandos): uma venda ou uma oferenda pendente termina
 * antes, e o pokémon que ela levou já não está em `p.pokemons` quando esta conferência roda.
 *
 * Toda resposta leva o estado REAL daquele pokémon (`k: 'colecao'`), inclusive a recusa: a tela
 * muda o card antes da resposta chegar, e é esta resposta que a corrige quando o servidor diz
 * não. Sem ela, a lista só voltaria ao certo na próxima sincronia completa, minutos depois.
 */
function moverNaColecao(p, pokemonId, para, t = agora()) {
  // Só número ou texto de número: `Number([42])` é 42, e um array não é um id.
  const tipoOk = typeof pokemonId === 'number' || typeof pokemonId === 'string';
  const id = tipoOk ? Number(pokemonId) : Number.NaN;
  const destino = para === 'colecao' ? true : para === 'depot' ? false : null;
  if (!Number.isSafeInteger(id) || id <= 0 || destino == null) {
    return evento(p, { k: 'aviso', msg: 'colecao.pedidoInvalido' });
  }
  const pk = p.pokemons.get(id);
  if (!pk) {
    evento(p, { k: 'colecao', id, naColecao: false, recusado: true });
    return evento(p, { k: 'aviso', msg: 'colecao.naoTem' });
  }
  const atual = naColecao(p, id);
  // Já está onde foi pedido: nada muda e a espera não conta. É o duplo clique, ou a aba antiga.
  if (atual === destino) return evento(p, { k: 'colecao', id, naColecao: atual });

  if (!p.colecaoMovidoEm) p.colecaoMovidoEm = new Map();
  const falta = (p.colecaoMovidoEm.get(id) ?? 0) + COLECAO_COOLDOWN_MS - t;
  if (falta > 0) {
    evento(p, { k: 'colecao', id, naColecao: atual, recusado: true });
    return evento(p, { k: 'aviso', msg: 'colecao.espere', params: { s: Math.ceil(falta / 1000) } });
  }
  // O mapa de esperas só guarda o que ainda vale: sem isto ele cresceria com cada pokémon que o
  // jogador já moveu na sessão.
  for (const [k, em] of p.colecaoMovidoEm) if (t - em >= COLECAO_COOLDOWN_MS) p.colecaoMovidoEm.delete(k);
  p.colecaoMovidoEm.set(id, t);

  if (destino) travarPokemon(p, id);
  else destravarPokemon(p, id);
  marcarSujo(p);
  auditar(
    p,
    'colecao',
    destino ? 'entrou' : 'saiu',
    `${pk.shiny ? 'SHINY ' : ''}${pk.nome} Nv ${pk.level}${pk.slot != null ? ' (equipe)' : ''}`,
    `pk:${pk.id}`,
  );
  evento(p, { k: 'colecao', id, naColecao: destino });
}

/**
 * O que o NPC paga por um item, sobre o `npcPrice`. Zero = não compra.
 *
 * Consumível que ele mesmo vende fica de fora: comprar e revender pelo mesmo preço seria
 * inócuo, e por qualquer preço diferente viraria moedinha infinita.
 */
const precoDeVenda = (item) =>
  !itemVendavelAoNpc(item, {
    bossTokenId: BOSS_TOKEN_ID,
    pvpFichaId: PVP_FICHA_ID,
    categoriasCompraveis: COMPRAVEIS,
    itensCompraveisIds: ITENS_COMPRAVEIS,
  })
    ? 0
    : Math.floor((item.npcPrice ?? 0) * FATOR_VENDA);

/** Vende todo loot vendável ao NPC, exceto itens trancados. Retorna o ouro ganho (0 = nada vendido). */
function venderTodoLootLivre(p, { silencioso = false } = {}) {
  let ganho = 0;
  let tipos = 0;
  for (const [id, q] of Object.entries(p.items)) {
    const itemId = Number(id);
    if (itemId === BOSS_TOKEN_ID || itemId === PVP_FICHA_ID || itemLootTravado(p, itemId)) continue;
    const item = itens.get(itemId);
    const preco = item && precoDeVenda(item);
    if (!preco || !q) continue;
    ganho += preco * q;
    tipos++;
    delete p.items[id];
    destravarLoot(p, itemId);
  }
  if (!tipos) return 0;
  somarGoldAuditado(p, ganho, 'npc_lote', `${tipos} tipos de item ao NPC`);
  auditar(
    p,
    'npc',
    'venda_lote',
    `${tipos} tipos · +${ganho.toLocaleString('pt-BR')} coins · gold ${Math.floor(p.gold ?? 0).toLocaleString('pt-BR')}`,
  );
  evento(p, { k: 'venda', nome: `${tipos} tipos de item`, qtd: tipos, ganho });
  return ganho;
}

/** Vende na hora um drop da hunt, se a auto-venda estiver ligada e o item não estiver trancado. */
function autoVenderDrop(p, item, qtd) {
  if (!p.automation?.autoVendaLoot || !item || qtd <= 0) return null;
  if (itemLootTravado(p, item.id)) return null;
  const unit = precoDeVenda(item);
  if (!unit) return null;
  const ganho = unit * qtd;
  return { ganho, qtd };
}

function precoDoPokemon(pk) {
  const esp = especies.get(pk.speciesId);
  return precoVendaPokemon(esp, pk);
}

/** Tira os pokémon da memória e agenda o DELETE — o tick nunca espera o banco. */
/**
 * Entrega ao vendedor o que a caixa postal do mercado tiver para ele.
 *
 * O ouro é somado na MEMÓRIA e marcado sujo — é o flush dele que grava, e é justamente por
 * isso que a compra não creditou nada direto no banco (o flush passaria por cima). As ORBs
 * já foram creditadas com ledger dentro da transação; aqui só se atualiza o cache da tela.
 */
async function entregarPagamentos(p) {
  const r = await mdb.recolherPagamentos(p.dbId);
  if (!r.recibos.length) return;

  if (r.gold) {
    const det = r.recibos.map((rec) => rec.descricao).join('; ').slice(0, 480);
    somarGoldAuditado(p, r.gold, 'market_comunidade', det || `${r.recibos.length} venda(s)`);
  }
  if (r.saldoOrbs != null) p.orbs = r.saldoOrbs;
  marcarSujo(p);

  // Um evento por venda: o jogador que voltou depois de um dia precisa ver o que saiu, e
  // não só um saldo maior sem explicação.
  for (const rec of r.recibos) {
    evento(p, { k: 'marketVendido', descricao: rec.descricao, valor: rec.valor, bruto: rec.bruto, moeda: rec.moeda });
  }
  // A casa vendida sai da lista do vendedor aqui: a troca de dono aconteceu na transação do
  // COMPRADOR, e a memória deste sim ainda a mostraria "no Mercado". Só relê quem tem casa
  // anunciada — os outros recibos não mexem em casa nenhuma.
  if ((p.casas ?? []).some((c) => c.anunciada)) {
    await carregarCasas(p).catch((err) => console.error('[casas] venda:', err.message));
  }
  // A bicicleta vendida, idem.
  if ((p.bicicletas ?? []).some((b) => b.anunciada)) {
    await carregarBicicletas(p).catch((err) => console.error('[bicicletas] venda:', err.message));
  }
}

/**
 * Entrega os coins que amigos mandaram para este jogador enquanto ele estava fora (ou
 * noutro shard). Mesma mecânica de `entregarPagamentos`: o valor já é o LÍQUIDO, é somado na
 * MEMÓRIA e marcado sujo — o flush é que grava.
 */
async function entregarCoinsDeAmigos(p) {
  if (!p.dbId) return;
  const r = await amigosDb.recolherCoins(p.dbId);
  if (!r.recibos.length) return;
  somarGoldAuditado(p, r.total, 'amigo_recebeu', `${r.recibos.length} transferência(s) de amigo`, null, { sempre: true });
  marcarSujo(p);
  for (const rec of r.recibos) {
    evento(p, { k: 'amigoCoinsRecebeu', nick: rec.deNick, valor: rec.valor });
  }
}

/**
 * O prêmio da temporada que o jogador ganhou enquanto estava fora.
 *
 * Os boosts entram na memória dele, não no banco: `p.boosts` desce pelo write-behind como
 * qualquer outro campo, e `marcarSujo` é o que garante que desça. A reivindicação já foi
 * atômica lá no banco (ver `entregarPremiosPvp`), então esta função nunca paga duas vezes,
 * mesmo se for chamada pelo login e pela varredura no mesmo segundo.
 */
async function entregarPremiosDaTemporada(p) {
  const premios = await entregarPremiosPvp(p, agora());
  if (!premios.length) return;
  marcarSujo(p);
  for (const premio of premios) {
    evento(p, {
      k: 'pvpPremio',
      temporada: premio.temporada,
      posicao: premio.posicao,
      faixa: premio.faixa,
      boosts: premio.boosts,
      unidade: premio.unidade, // 'horas' desde a temporada semanal; 'dias' no que sobrou da mensal
    });
  }
}

/**
 * Varredura da caixa postal para quem JÁ está online.
 *
 * Uma query por minuto para o shard inteiro, e não uma por jogador: pergunta de uma vez
 * quais dos jogadores conectados têm pagamento pendente e só então recolhe os desses. Com
 * mil pessoas dentro, é a diferença entre 1 e 1000 consultas por minuto.
 */
const VARREDURA_MERCADO_MS = 60_000;
let proximaVarreduraMercado = 0;

async function varrerPagamentos(t) {
  if (t < proximaVarreduraMercado) return;
  proximaVarreduraMercado = t + VARREDURA_MERCADO_MS;

  await varrerExpirados();

  const online = [...jogadores.values()].filter((p) => p.dbId);
  if (!online.length) return;

  const comPendencia = await mdb.vendedoresComPagamento(online.map((p) => p.dbId));
  for (const p of online) {
    if (comPendencia.has(p.dbId)) await entregarPagamentos(p);
  }

  // A rede de segurança do aviso de `varrerExpirados`: devolução que ficou para trás. Sem
  // `await`: cada uma espera a fila de economia do SEU jogador, e uma fila lenta não pode
  // segurar a varredura dos outros.
  const comDevolucao = await mdb.vendedoresComDevolucao(online.map((p) => p.dbId));
  for (const p of online) {
    if (comDevolucao.has(p.dbId)) entregarDevolucoes(p);
  }

  // Mesma varredura, para a caixa postal de coins de amigo: uma consulta para o shard todo.
  const comCoins = await amigosDb.destinatariosComCoins(online.map((p) => p.dbId));
  for (const p of online) {
    if (comCoins.has(p.dbId)) {
      await entregarCoinsDeAmigos(p).catch((err) => console.error('[amigos] varredura coins:', err.message));
    }
  }

  // E a da temporada de PvP. Ela é a razão de esta varredura importar para o prêmio: a virada
  // acontece às 00:00 UTC, num shard só, e quem está jogando naquele minuto não passa por
  // login nenhum. Sem esta passada o premiado só receberia no próximo login — que pode ser
  // dias depois, com o boost de três dias já tendo valido menos do que devia.
  const comPremio = await pvpdb.comPremioPendente(online.map((p) => p.dbId));
  for (const p of online) {
    if (comPremio.has(p.dbId)) {
      await entregarPremiosDaTemporada(p).catch((err) => console.error('[pvp] varredura de prêmio:', err.message));
    }
  }
}

/**
 * Anúncios cujo aluguel acabou: fecha, e avisa o sim de cada dono para ele entregar.
 *
 * Quem chega primeiro nesta varredura fecha os vencidos do servidor INTEIRO, e com dez sims o
 * dono quase sempre está noutro. Era aqui que o pokémon sumia: este processo só devolvia à
 * memória quem estava NELE, e o dono de outro shard ficava sem o bicho até o próximo login —
 * um F5 não resolvia, porque a reconexão dentro da carência reaproveita a memória. O item era
 * pior: ia para o banco por baixo de um jogador carregado noutro sim, e o flush dele apagava.
 *
 * Agora a entrega é sempre de quem tem o dono em memória (`entregarDevolucoes`). O aviso pelo
 * barramento é só para ela sair na hora; se ele se perder (sim reiniciando, nick trocado), a
 * varredura de cada sim e o login entregam do mesmo jeito.
 */
async function varrerExpirados() {
  const fechados = await mdb.expirarAnuncios();
  if (!fechados.length) return;
  console.log(`[market] ${fechados.length} anúncio(s) expirados`);
  avisarDonosDeDevolucao(fechados);
}

/**
 * Pede ao sim de cada dono que entregue agora o que um fechamento do servidor devolveu.
 *
 * Vai também para o próprio shard: o barramento traz de volta, e o caminho é um só. A chave é o
 * nick do anúncio — se ele mudou de nome desde então, o aviso cai no vazio e a varredura por id
 * (`varrerPagamentos`) entrega no minuto seguinte.
 */
function avisarDonosDeDevolucao(lista) {
  const donos = new Set(lista.map((a) => a.vendedor?.toLowerCase()).filter(Boolean));
  for (const chave of donos) {
    publicar(canalSim(shardDoJogador(chave)), { t: 'market.devolver', playerId: chave });
  }
}

/**
 * Entrega ao dono o que voltou dos anúncios que o servidor fechou — vencidos, ou devolvidos por
 * regra no boot (ver `mdb.recolherDevolucoes`).
 *
 * O pokémon, as peças numeradas e o diamante já estão com ele no banco — falta a memória desta
 * sessão. O ITEM entra só aqui, na memória, e é o flush dele que grava.
 *
 * Roda na FILA DE ECONOMIA do jogador. É ela que `removerJogadorLocal` espera antes da última
 * gravação: se a carência vencer (ou ele for para a Arena) com a entrega no meio, o flush final
 * sai depois dela, e o item não fica num objeto que ninguém mais grava. Devolve a promessa do
 * fim da entrega; os erros ficam no log da fila.
 */
function entregarDevolucoes(p) {
  return new Promise((pronto) => {
    enfileirarEconomia(p, () => entregarDevolucoesAgora(p).finally(pronto));
  });
}

async function entregarDevolucoesAgora(p) {
  // Já saiu da memória deste sim quando a vez chegou: nada é recolhido, e a devolução continua
  // na caixa postal para o próximo login.
  if (jogadores.get(p.key) !== p) return;
  const lista = await mdb.recolherDevolucoes(p.dbId);
  if (!lista.length) return;

  // Primeiro o que só existe na memória — sem nenhum `await` entre recolher e creditar.
  const reler = new Set();
  const pokemons = [];
  for (const a of lista) {
    if (a.caixaId) reler.add(carregarCaixas);
    else if (a.casaId) reler.add(carregarCasas); // volta vazia para a lista do dono
    else if (a.bicicletaId) reler.add(carregarBicicletas); // se era a equipada, volta equipada
    else if (a.tipo === 'diamante') reler.add('diamantes');
    else if (a.tipo === 'pokemon') {
      if (a.pokemonId != null) pokemons.push(a);
    } else if (a.ballId != null) {
      p.balls[a.ballId] = (p.balls[a.ballId] ?? 0) + a.qtd;
    } else if (a.itemId != null) {
      p.items[a.itemId] = (p.items[a.itemId] ?? 0) + a.qtd;
    }
    const descricao = a.tipo === 'pokemon'
      ? `${a.nome || `#${a.pokemonId}`}${a.level ? ` Nv ${a.level}` : ''}`
      : `${a.qtd > 1 ? `${a.qtd}× ` : ''}${a.nome || `#${a.itemId}`}`;
    // Vencido é "o prazo acabou"; o resto foi o servidor fechando por regra (curadoria, preço).
    // E o que voltou para a Coleção tem aviso próprio: o jogador precisa saber ONDE o pokémon
    // foi parar, senão vai procurá-lo na aba de venda do Depot e não vai achar.
    const k = a.estado === 'expirado' ? 'marketExpirou'
      : a.paraColecao ? 'marketDevolvidoColecao'
      : 'marketDevolvido';
    evento(p, { k, descricao, qtd: a.qtd, tipo: a.tipo });
  }
  marcarSujo(p);

  // Depois o que é relido do banco. O pokémon: `recarregarPokemon` só traz a linha que está fora
  // do escrow, então um que o dono já anunciou de novo não volta. E quem já está em memória (veio
  // no login) não é trocado — soltaria as referências do campo e da equipe.
  for (const a of pokemons) {
    if (p.pokemons.has(a.pokemonId)) continue;
    await recarregarPokemon(p, a.pokemonId).catch((err) =>
      console.error(`[market] anúncio ${a.id} fechado, mas o pokémon não recarregou:`, err.message));
  }
  // A COLEÇÃO, depois do recarregamento: o pokémon que o servidor tirou da vitrine por não
  // passar mais na faixa mínima entra guardado, fora da venda ao NPC (ver o porquê em
  // `devolverPokemonAbaixoDoMinimo`). Aqui e não no laço de cima porque `travarPokemon` só
  // grava um id, e um id de pokémon que ainda não voltou à memória seria varrido pelo
  // `limparColecao` do próximo login. É idempotente: reentregar não duplica nada.
  for (const a of pokemons) {
    if (a.paraColecao && p.pokemons.has(a.pokemonId)) travarPokemon(p, a.pokemonId);
  }
  // Na ordem de `entrar`: as bicicletas depois das casas.
  for (const carregar of [carregarCaixas, carregarCasas, carregarBicicletas]) {
    if (reler.has(carregar)) await carregar(p).catch((err) => console.error('[market] devolução:', err.message));
  }
  // O saldo verdadeiro do diamante é o do ledger — aqui só o cache da tela.
  if (reler.has('diamantes')) p.diamonds = await ddb.saldoDe(p.dbId).catch(() => p.diamonds);
  marcarSujo(p);
}

/**
 * Entrega os DIAMANTES que o webhook de pagamento já creditou no ledger.
 *
 * Note que aqui não se soma nada: o gateway que recebeu o webhook já fez o crédito dentro de
 * uma transação (ver `diamantes-db.mjs`). O que falta é a sessão em memória saber — somar de
 * novo aqui pagaria o jogador duas vezes pela mesma compra.
 */
/** Diamantes, gemas e votos do TopIdle — moedas do ledger, fora do write-behind. */
async function sincronizarMoedasPagas(p) {
  if (!p.dbId) return;
  await entregarDiamantes(p);
  await entregarVotos(p);
  await reentregarConvites(p);
}

/**
 * A rede de segurança do `/resgatar`: reentrega o prêmio de um código que foi carimbado como
 * gasto e cujo flush não chegou a acontecer (processo morto na janela de milissegundos entre os
 * dois). Quase sempre não faz nada — é uma consulta num índice parcial que costuma estar vazio.
 */
async function reentregarConvites(p) {
  const feitos = await entregarConvitesPendentes(p, agora()).catch((err) => {
    console.error('[convite] reentrega falhou:', err.message);
    return [];
  });
  if (!feitos.length) return;
  marcarSujo(p);
  filaFlush.add(p);
  await flush().catch((err) => console.error('[convite] flush da reentrega falhou:', err.message));
  for (const f of feitos) {
    await confirmarEntregaDeConvite(f.codigo).catch(() => {});
    auditar(p, 'convite', 'reentrega', `marco de ${f.marco} convidado(s) · ${f.codigo}`);
    enviar(p, { t: SERVIDOR.CONVITE, marco: f.marco, premios: f.premios });
  }
}

async function entregarDiamantes(p) {
  const r = await ddb.recolherCreditos(p.dbId);
  if (!r.recibos.length) return;

  p.diamonds = r.saldo;
  p.diamantesComprados = await ddb.totalCompradoDoJogador(p.dbId);
  marcarSujo(p);
  for (const rec of r.recibos) {
    evento(p, { k: 'diamantesCreditados', qtd: rec.qtd, centavos: rec.centavos, metodo: rec.metodo });
  }
}

/** Soma de diamantes comprados (pagamentos confirmados) — uma consulta por login/reconexão. */
async function carregarDiamantesComprados(p) {
  if (!p.dbId) return;
  p.diamantesComprados = await ddb.totalCompradoDoJogador(p.dbId);
}

/** Credita comissões de indicação pendentes — só quando o jogador clica em Recolher. */
async function entregarComissoesAfiliado(p) {
  const r = await adb.recolherEntregas(p.dbId);
  if (!r.itens.length) return null;

  p.diamonds = r.diamonds;
  p.orbs = r.orbs;
  marcarSujo(p);
  return r;
}

// ------------------------------------------------------- Caixas de Fundador
//
// As caixas moram numa tabela própria (ver `caixas-db.mjs`) e não no `items` do jogador,
// porque cada uma tem número irrepetível. O que a sessão guarda em memória são duas listas
// pequenas, relidas a cada movimento:
//
//   `p.caixas`           as FECHADAS que estão na mão dele — a bolsa
//   `p.caixaTags`        as ABERTAS — as tags do chat e o direito às outfits
//   `p.caixasCompradas`  quantas de cada tipo ele já levou NO BALCÃO — a trava de 1 por conta
//
// Não há cache esperto nem invalidação por evento: são três consultas por índice, com no
// máximo 150 linhas no jogo inteiro, e recarregar as três depois de comprar, abrir, anunciar,
// cancelar ou comprar no Mercado é mais barato do que qualquer coisa que possa divergir.

/** Quantas de cada tipo já saíram da Loja. Cache do processo, refrescado a cada compra. */
let vendidasCaixas = null;

async function atualizarVendidasCaixas() {
  vendidasCaixas = await cxdb.vendidas().catch(() => vendidasCaixas);
  return vendidasCaixas;
}

/**
 * Relê as caixas do jogador e reconcilia o armário.
 *
 * A reconciliação (`sincronizarOutfitsDeCaixa`) roda TODA vez, e não só no login: é ela que
 * garante que a outfit exista em `ownedOutfits` mesmo que o processo tenha caído entre a
 * transação de abertura e o flush seguinte. Custa uma varredura de dois elementos.
 */
async function carregarCaixas(p) {
  if (!p.dbId) return;
  const [minhas, tags, compradas] = await Promise.all([
    cxdb.caixasDoJogador(p.dbId),
    cxdb.tagsDoJogador(p.dbId),
    cxdb.comprasDoJogador(p.dbId),
  ]);
  p.caixas = minhas;
  p.caixaTags = tags;
  p.caixasCompradas = compradas;
  if (sincronizarOutfitsDeCaixa(p, tags)) marcarSujo(p);
  // A tag do chat vive no SOCKET do gateway, e ele a lê de carona no snapshot (ver `lerCargo`
  // lá): basta o estado seguinte sair com ela, sem rota nem consulta extra.
}

/**
 * Relê as casas do jogador e deixa o XP Share coerente com elas.
 *
 * Três trabalhos, nesta ordem:
 *
 *   1. casa-item que ainda estiver na bolsa vira casa numerada (`converterCasasDaBolsa` — o que
 *      a virada já converteu desta conta só sai da bolsa, ver o cabeçalho de `casas-db.mjs`);
 *   2. a lista vem do banco, com as que estão no Mercado marcadas `anunciada`;
 *   3. a escalação antiga vai para a casa em que estava, os postos de casa que não é mais dele
 *      caem, e a sala aberta de uma casa vendida fecha.
 *
 * Tabela própria e fora do flush, como as caixas: por isso relê em vez de somar.
 */
async function carregarCasas(p) {
  if (!p.dbId) return;
  const naBolsa = casasNaBolsa(p.items);
  if (naBolsa.length) {
    // Tira da memória ANTES do await: um flush no meio gravaria a bolsa com as casas-item de
    // volta. Se a transação estourar, elas voltam para a memória e o próximo login tenta de novo.
    const bolsa = {};
    for (const b of naBolsa) {
      bolsa[b.raridade] = b.qtd;
      delete p.items[b.itemId];
    }
    marcarSujo(p);
    try {
      const r = await casasDb.converterCasasDaBolsa({ playerId: p.dbId, nick: p.nick, bolsa });
      p.casasLegadoPendente = false;
      auditar(
        p,
        'casa',
        'numerada',
        `casa-item na bolsa → ${r.criadas.length} numerada(s)`
          + `${r.criadas.length ? ` (${r.criadas.map((c) => `${c.raridade} ${numeroDaCasa(c.id)}`).join(', ')})` : ''}`
          + `${r.descartadas ? ` · ${r.descartadas} já convertida(s) na virada` : ''}`,
      );
    } catch (err) {
      for (const b of naBolsa) p.items[b.itemId] = (p.items[b.itemId] ?? 0) + b.qtd;
      marcarSujo(p);
      throw err;
    }
  } else if (p.casasLegadoPendente) {
    p.casasLegadoPendente = false;
    await casasDb.consumirLegado(p.dbId).catch((err) => console.error('[casas] legado:', err.message));
  }

  // As casas que já estavam na MÃO antes desta leitura. `null` no primeiro carregamento da sessão.
  const naMaoAntes = p.casas ? new Set(p.casas.filter((c) => !c.anunciada).map((c) => c.id)) : null;
  p.casas = await casasDb.casasDoJogador(p.dbId);
  mexeuNoXpShare(p);
  if (aplicarXpShareLegado(p, p.automation?.casaEquipada)) marcarSujo(p);
  // Casa que CHEGOU à mão nesta sessão (comprada no Mercado, de volta de um anúncio cancelado)
  // entra em uso sozinha se houver vaga — como a fabricada. No login não: ali manda a escolha
  // gravada, e só quem nunca escolheu cai na escolha padrão.
  if (naMaoAntes) {
    for (const c of p.casas) {
      if (!c.anunciada && !naMaoAntes.has(c.id)) usarCasa(p, c.id, true);
    }
  }
  if (fixarCasasEmUso(p)) marcarSujo(p);
  if (p.casa && !casaAtivaPorId(p, p.casa.casaId)) {
    casasAbertas.delete(p);
    p.casa = null;
    irParaOCentro(p, 'visita');
  }
  if (limparXpShareInvalido(p)) marcarSujo(p);
}

/**
 * Relê as BICICLETAS numeradas do banco para a memória — o espelho de `carregarCasas`.
 *
 * Bicicleta-item que ainda estiver na bolsa (dada pelo painel, ou regravada por um processo antigo
 * na janela do deploy) vira bicicleta numerada, descontado o que a virada já converteu. A equipada
 * de antes da numeração (uma RARIDADE) vira o número de uma bicicleta daquela raridade.
 *
 * Termina reaplicando o passo na praça: anunciar, vender ou receber de volta a EQUIPADA muda a
 * velocidade de quem está em Cerulean na mesma hora — na hunt, o tick já lê a equipada a cada passo.
 */
async function carregarBicicletas(p) {
  if (!p.dbId) return;
  const naBolsa = bicicletasNaBolsa(p.items);
  if (naBolsa.length) {
    // Tira da memória ANTES do await: um flush no meio gravaria a bolsa com as bicicletas-item de
    // volta. Se a transação estourar, elas voltam e o próximo carregamento tenta de novo.
    const bolsa = {};
    for (const b of naBolsa) {
      bolsa[b.raridade] = b.qtd;
      delete p.items[b.itemId];
    }
    marcarSujo(p);
    try {
      const r = await bicicletasDb.converterBicicletasDaBolsa({ playerId: p.dbId, nick: p.nick, bolsa });
      p.bicicletasLegadoPendente = false;
      auditar(
        p,
        'bicicleta',
        'numerada',
        `bicicleta-item na bolsa → ${r.criadas.length} numerada(s)`
          + `${r.criadas.length ? ` (${r.criadas.map((b) => `${b.raridade} ${numeroDaBicicleta(b.id)}`).join(', ')})` : ''}`
          + `${r.descartadas ? ` · ${r.descartadas} já convertida(s) na virada` : ''}`,
      );
    } catch (err) {
      for (const b of naBolsa) p.items[b.itemId] = (p.items[b.itemId] ?? 0) + b.qtd;
      marcarSujo(p);
      throw err;
    }
  } else if (p.bicicletasLegadoPendente) {
    p.bicicletasLegadoPendente = false;
    await bicicletasDb.consumirLegado(p.dbId).catch((err) => console.error('[bicicletas] legado:', err.message));
  }

  p.bicicletas = await bicicletasDb.bicicletasDoJogador(p.dbId);
  if (resolverEquipadaLegada(p)) marcarSujo(p);
  atualizarVelocidadeNoCentro(p);
}

/**
 * Entrega os diamantes do voto no TopIdle que o webhook já creditou.
 *
 * Mesma natureza da entrega de compra: o gateway que recebeu o webhook já somou dentro de uma
 * transação (ver `topidle-db.mjs`) — aqui só se copia o saldo para a sessão em memória.
 */
async function entregarVotos(p) {
  const r = await tdb.recolherVotos(p.dbId);
  if (!r.votos) return;

  p.diamonds = r.diamonds;
  marcarSujo(p);
  evento(p, { k: 'votoCreditado', qtd: r.qtd, votos: r.votos });
}

/**
 * Varredura da caixa postal dos diamantes.
 *
 * Mais rápida que a do mercado (15 s contra 60 s) porque o jogador está ESPERANDO: ele acabou
 * de pagar no cartão e voltou para a aba do jogo olhando o contador. Um minuto de tela parada
 * depois de um pagamento aprovado é o que faz alguém abrir ticket achando que perdeu o
 * dinheiro. A consulta continua sendo uma só para o shard inteiro.
 */
const VARREDURA_DIAMANTES_MS = 15_000;
let proximaVarreduraDiamantes = 0;

async function varrerDiamantes(t) {
  if (t < proximaVarreduraDiamantes) return;
  proximaVarreduraDiamantes = t + VARREDURA_DIAMANTES_MS;
  const online = [...jogadores.values()].filter((p) => p.dbId);
  if (!online.length) return;

  const ids = online.map((p) => p.dbId);
  const comCredito = await ddb.jogadoresComCredito(ids);
  const comVoto = await tdb.jogadoresComVotoPendente(ids);
  if (!comCredito.size && !comVoto.size) return;
  for (const p of online) {
    if (comCredito.has(p.dbId)) await entregarDiamantes(p);
    if (comVoto.has(p.dbId)) await entregarVotos(p);
  }
}

/**
 * Traz de volta à memória um pokémon que estava no escrow do mercado.
 *
 * O banco já mudou (cancelar devolveu ao dono, comprar trocou o dono); o que falta é a
 * sessão em memória saber disso. Uma linha só, pelo id — recarregar o jogador inteiro
 * jogaria fora combate, campo e cooldowns por causa de um pokémon.
 */
async function recarregarPokemon(p, pokemonId) {
  if (!pokemonId) return null;
  const row = await db.pokemonPorId(pokemonId, p.dbId);
  if (!row) return null;
  const pk = montarPokemon(row);
  p.pokemons.set(pk.id, pk);
  // Pokémon REFINADO entra trancado na venda. Quem compra um `+12` no Mercado está levando
  // dezenas de milhares de pedras num bicho só, e o botão "vender o depot inteiro" fica a
  // dois cliques de distância na tela seguinte. É a mesma trava que `pokemon.refinar` põe em
  // quem refina — o cadeado continua ali para quem realmente quiser vendê-lo.
  if (temRefino(pk.refino)) travarPokemon(p, pk.id);
  aplicarAutoLockPokemon(p, pk);
  if (!p.activeId || !podeUsarPokemon(p, p.pokemons.get(p.activeId))) {
    const id = escolherAtivoUtilizavel(p);
    if (id) p.activeId = id;
  }
  // Esta função é o ÚNICO outro lugar em que uma linha de `player_pokemon` volta do banco para
  // a memória de um jogador já conectado — o mesmo tipo de releitura que, no login, é onde uma
  // Exp. Share partida ao meio vira duas. Hoje o escrow do Mercado exige `held_item_id IS NULL`,
  // então a linha não deveria voltar segurando nada; a conferência aqui custa uma passada pelos
  // pokémon do jogador e existe justamente para o caso de "não deveria" não bastar.
  conferirXpShareHeld(p);
  marcarSujo(p);
  return pk;
}

/**
 * O que pode ir para a vitrine.
 *
 * Antes era "tudo que o NPC compra", e isso deixava entrar os ~214 drops de pokémon: a
 * vitrine virava um paiol de Bug Wing a mil moedas em que ninguém achava o que procurava.
 * Hoje a lista é fechada e mora em `content.mjs` — pedra que evolui, disco de TM e ficha
 * de boss. Ver `ITENS_MERCADO` lá para o porquê de cada família.
 */
const anunciavel = itemAnunciavelMercado;

export const ivTotalDe = (pk) => Object.values(pk?.ivs ?? {}).reduce((s, v) => s + v, 0);

/**
 * Apaga um lote de pokémon do jogador: some da MEMÓRIA primeiro, e só então do banco.
 *
 * A ordem é a do escrow do Mercado (`market.criar`). Com o banco primeiro, os pokémon seguiam
 * alcançáveis durante o `await` por todo comando que não passa pela fila de economia — um
 * `team.move` seguido de `team.active` nessa janela deixava o jogador com um ativo que não
 * existia mais. Se o banco recusar, eles voltam como estavam, com as gravações pendentes.
 *
 * Quem o banco não tem mais como deste jogador (`err.fora`: vendido, anunciado ou apagado por
 * outro caminho) NÃO volta: a memória é que estava errada. Ver `db.removerPokemons`.
 */
async function removerPokemons(p, lote) {
  const pendentes = new Set(lote.filter((k) => p.pokemonsSujos?.has(k.id)).map((k) => k.id));
  for (const pk of lote) {
    p.pokemons.delete(pk.id);
    p.pokemonsSujos?.delete(pk.id);
  }
  try {
    await db.removerPokemons(lote.map((k) => k.id), p.dbId);
  } catch (err) {
    const fora = new Set(err.fora ?? []);
    for (const pk of lote) {
      if (fora.has(pk.id)) continue;
      p.pokemons.set(pk.id, pk);
      if (pendentes.has(pk.id)) p.pokemonsSujos?.add(pk.id);
    }
    // A tela também tem de largá-los: sem uma sincronização, o card do que saiu continuaria na
    // folha da Oferenda (e do Depot) até o próximo motivo qualquer para mandar o estado.
    if (fora.size) marcarSujo(p);
    throw err;
  }
}

// -------------------------------------------------------------------- combate

/** Ficha de um selvagem: espécie, nível, stats, HP. Ainda sem posição no campo. */
/**
 * Ficha de um selvagem. `p` só entra por causa do Shiny Secret Lure — a chance de brilho é
 * sorteada no NASCIMENTO do mob, então o boost tem de estar em mãos aqui e não na captura.
 */
function normalizarPokedex(pokedex) {
  return normalizarEntradasPokedex(pokedex);
}

/** Só entra na dex nacional (#xxx). Outland (10xxx) fica de fora — ver chavePokedex. */
function registrarCapturaDex(p, speciesId) {
  const chaveDex = chavePokedex(speciesId);
  if (chaveDex == null) return;
  const dex = (p.pokedex[chaveDex] ??= { k: 0, c: 0 });
  dex.c++;
}

/** Quem já tem a espécie no time conta como capturado — corrige evoluções antes deste fix. */
function sincronizarPokedexDoTime(p) {
  for (const pk of p.pokemons.values()) {
    const chave = chavePokedex(pk.speciesId);
    if (chave == null) continue;
    const dex = (p.pokedex[chave] ??= { k: 0, c: 0 });
    if (!dex.c) dex.c = 1;
  }
}

/**
 * Kills na Outland gravavam em #494–649 via `pokeId % 1000` (legado 10504 → Patrat).
 * Quem ainda não liberou Unova (nv 5000) não podia ter progresso legítimo nessa faixa — zera e
 * re-sincroniza só capturas reais do depot/time.
 */
function limparPokedexFantasmaUnova(p) {
  if (p.level >= 5000) return;
  let mudou = false;
  for (let d = 494; d <= 649; d++) {
    if (p.pokedex[d]) {
      delete p.pokedex[d];
      mudou = true;
    }
  }
  if (mudou) marcarSujo(p);
}

function montarSelvagem(especie, nivel, p = null) {
  const hunt = p?.huntSlug ? huntJogavelPorSlug.get(p.huntSlug) : null;
  // Shiny não rola no spawn — só na captura (`rolarShinyCaptura`), para macros não filtrarem
  // pelo brilho antes de gastar bola.
  const ivs = rolarIVs();
  const stats = calcularStats(especie, ivs, nivel, 1);
  // O ×5 entra ANTES do piso de hpDeCombate. Depois do piso, um selvagem nível 1 ficaria com
  // 24×5 = 120 HP — mais tanque que o starter nível 5, porque em nível baixo (nível/100) zera
  // os stats e só o piso sobra.
  const maxHp = hpDeCombate(stats.hp * MULT_HP_SELVAGEM);

  const xp = xpPorDerrota(hunt, nivel, especie);

  return {
    speciesId: especie.pokeId,
    nome: especie.name,
    looktype: especie.looktype,
    tipos: [especie.type1, especie.type2].filter(Boolean),
    level: nivel,
    stats,
    ivs,
    hp: maxHp,
    maxHp,
    xp,
    cdGolpes: {},
  };
}

/**
 * Enche o campo de selvagens — uma ONDA inteira, não um por vez.
 *
 * Cada ponto de spawn da hunt (`hunt-config`) vira um selvagem ancorado ali, da espécie que
 * o próprio ponto declara. É por isso que a Route do Bulbasaur tem Bulbasaur nos lugares
 * certos em vez de um sorteio homogêneo; quando o ponto traz um pokeId que não conhecemos,
 * cai no sorteio ponderado de sempre.
 */
function povoarOnda(p) {
  const hunt = huntJogavelPorSlug.get(p.huntSlug);
  const campo = p.campo;
  if (!hunt || !campo) return;

  campo.ondaSeq = (campo.ondaSeq ?? 0) + 1;

  // Os corpos da onda anterior FICAM: é neles que o jogador arremessa a bola pelo painel
  // do palco. Quem tira do mapa é `limparCorpos`, quando passa o tempo de chão.
  campo.alvo = null;
  p.selvagem = null;

  // embaralha para a onda não sair sempre na mesma ordem quando há mais pontos que o teto
  const pontos = campo.g.pontos.slice();
  for (let i = pontos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pontos[i], pontos[j]] = [pontos[j], pontos[i]];
  }

  for (const ponto of pontos.slice(0, MAX_MOBS)) {
    const especie = especies.get(ponto[2]) ?? sortearSelvagem(hunt).especie;
    if (!especie) continue;
    const nv = hunt.nivel ?? nivelSelvagem(especie);
    const mob = porMobEmCampo(campo, montarSelvagem(especie, nv, p), ponto, agora());
    if (!mob) continue;
    evento(p, {
      k: 'spawn',
      slot: mob.slot,
      speciesId: mob.speciesId,
      nome: mob.nome,
      looktype: mob.looktype,
      level: mob.level,
      hp: mob.maxHp,
      maxHp: mob.maxHp,
      tipos: mob.tipos,
    });
  }
}

/** Tira o selvagem de campo (morto ou capturado) e agenda a próxima onda se acabou. */
/** Derruba o selvagem. Ele vira CORPO e fica no chão — quem apaga é `limparCorpos`. */
function baixarMob(p, mob) {
  const campo = p.campo;
  mob.morto = true;
  mob.mortoEm = agora();
  mob.hp = 0;
  campo.mudou.add(mob.slot);
  if (campo.alvo === mob.slot) {
    campo.alvo = null;
    campo.heroiMudou = true;
  }
  if (p.selvagem === mob) p.selvagem = null;
  // O `!algumMobVivo` faz a onda seguinte só começar a contar quando o último selvagem da
  // atual cai.
  if (!algumMobVivo(campo)) campo.ondaEm = agora() + MS_ONDA;
}

/**
 * Distribui XP para o treinador e para o pokémon.
 *
 * Os DOIS multiplicadores são aplicados aqui e separadamente: a loja vende "XP Boost" e "XP
 * Boost Pokémon" como produtos distintos, e o VIP dá +50% nos dois. Quem tiver só um dos
 * boosts vê o treinador subir mais rápido que o pokémon (ou o contrário), que é exatamente
 * o que o produto promete.
 */
function calcularXpGanho(p, pk, quantidade, t = agora()) {
  return {
    treinador: Math.round(quantidade * multXpTreinador(p, t)),
    pokemon: pk ? Math.round(quantidade * multXpPokemon(p, t)) : 0,
  };
}

function ganharXp(p, pk, quantidade) {
  const t = agora();
  const ganho = calcularXpGanho(p, pk, quantidade, t);
  p.xp += ganho.treinador;
  const nivelNovo = nivelPeloXp(p.xp);
  if (nivelNovo !== p.level) {
    p.level = nivelNovo;
    evento(p, { k: 'levelup', quem: 'treinador', level: nivelNovo });
  }
  if (pk) {
    pk.xp += ganho.pokemon;
    const nv = nivelPeloXp(pk.xp);
    if (nv !== pk.level) {
      pk.level = nv;
      recalcular(pk);
      pk.hp = pk.maxHp;
      evento(p, { k: 'levelup', quem: 'pokemon', id: pk.id, level: nv });
    }
    marcarSujo(p, pk);
  }
  // O XP SHARE da Casa. Depois do ativo e com o número DELE: a fatia é sobre o que o pokémon
  // de batalha acabou de ganhar, multiplicadores já aplicados. Sai de graça para quem não tem
  // casa (fator 0) ou não registrou ninguém.
  creditarXpShare(p, pk, ganho.pokemon);
  creditarHeldXpShare(p, pk, ganho.pokemon);
  marcarSujo(p);
}

/**
 * Boss no chão: paga a tabela de drops dele, dá o ponto de boss e devolve o jogador à hunt.
 *
 * Diferente do selvagem, o boss não vira corpo capturável — não há pokébola que pegue um
 * Giant Cruel, e o prêmio dele é a tabela de drops.
 */
function derrotarBoss(p) {
  const s = p.selvagem;
  const boss = bossPorKey(p.boss.key);
  const pk = ativo(p);
  const t = agora();
  const ganho = calcularXpGanho(p, pk, s.xp, t);

  ganharXp(p, pk, s.xp);

  const drops = rolarDropsDeBoss(boss);
  let ouro = 0;
  for (const d of drops) {
    const antes = p.items[d.itemId] ?? 0;
    p.items[d.itemId] = antes + d.qtd;
    ouro += (itens.get(d.itemId)?.npcPrice ?? 0) * d.qtd;
    const item = itens.get(d.itemId);
    if (item && (item.category === 'tm' || /TM Disk Piece/i.test(item.name ?? ''))) {
      auditar(
        p,
        'tm',
        'boss_drop',
        `${d.qtd}× ${d.nome} · ${boss.nome} (${antes}→${p.items[d.itemId]})`,
        `boss:${boss.key}`,
      );
    }
  }
  p.bossPoints += boss.pontos;
  // Contador vitalício por boss — mora no `automation` (que já é gravado no flush, ao lado de
  // `bossAutoKey`) para não precisar de coluna nova. Alimenta o "Vezes derrotado" da aba Bosses.
  p.automation.bossKills = { ...(p.automation.bossKills ?? {}) };
  p.automation.bossKills[boss.key] = (p.automation.bossKills[boss.key] ?? 0) + 1;

  evento(p, {
    k: 'bossMorto',
    key: boss.key,
    nome: boss.nome,
    xp: s.xp,
    xpTreinador: ganho.treinador,
    xpPokemon: ganho.pokemon,
    lootBoost: bonusLootPct(p, t) > 0,
    pontos: boss.pontos,
    drops: drops.map((d) => ({ itemId: d.itemId, nome: d.nome, qtd: d.qtd })),
    valor: ouro,
    auto: !!p.automation?.bossAuto,
  });
  marcarSujo(p);
  p.boss = null;
  p.campo = null;
  p.selvagem = null;
  irParaOCentro(p, 'vitoria');
  // Venceu com a repetição ligada: a enfermeira cura e o sim entra de novo daqui a instantes.
  agendarBossAuto(p);
}

function derrotarSelvagem(p) {
  const s = p.selvagem;
  const pk = ativo(p);
  const especie = especies.get(s.speciesId);
  const t = agora();
  const ganho = calcularXpGanho(p, pk, s.xp, t);

  ganharXp(p, pk, s.xp);

  const chaveDex = chavePokedex(s.speciesId);
  if (chaveDex != null) {
    const dex = (p.pokedex[chaveDex] ??= { k: 0, c: 0 });
    dex.k++;
  }

  // O Loot Boost entra como bônus percentual — é o parâmetro que `rolarLoot` já esperava.
  const drops = rolarLoot(especie, bonusLootPct(p, t));
  const hunt = p.huntSlug ? huntJogavelPorSlug.get(p.huntSlug) : null;
  // O degrau da Outland, aplicado aos três drops raros da área. Sai de `p.outlandTier`
  // MAS passa por `tierOutlandValido` de novo aqui — é a segunda tranca da escada, e a única
  // que fica no caminho do drop. Ver `shared/outland-tiers.mjs`.
  const multOutland = multOutlandTier(tierOutlandValido(p.outlandTier, p.level));
  const token = rolarBossTokenSelvagem(bonusLootPct(p, t), hunt?.area, multOutland);
  if (token) drops.push(token);
  // Os dois fragmentos da Outland. Entram na MESMA lista de drops do resto para herdarem tudo
  // o que ela já resolve: a linha no log de batalha, o card de loot e a contagem da sessão.
  //
  // O de chave passa o jogador inteiro porque credita o contador vitalício da conta.
  const fragChave = rolarFragmentoChave(p, bonusLootPct(p, t), hunt?.area, multOutland);
  if (fragChave) drops.push(fragChave);
  const fragShiny = rolarFragmentoShiny(bonusLootPct(p, t), hunt?.area, multOutland);
  if (fragShiny) drops.push(fragShiny);
  // O de bicicleta, com a mesma conta dos outros dois (degrau da Outland × Loot Boost).
  const fragBicicleta = rolarFragmentoBicicleta(bonusLootPct(p, t), hunt?.area, multOutland);
  if (fragBicicleta) drops.push(fragBicicleta);
  let ouroVendaAuto = 0;
  const vendaAuto = [];
  for (const d of drops) {
    const item = d.itemId ? itens.get(d.itemId) : itensPorNome.get(d.nome.toLowerCase());
    if (!item) continue;
    // O Fragmento de Chave NÃO entra pelo `+=` genérico: ele sobe o contador vitalício da conta.
    if (item.id === FRAGMENTO_CHAVE_ID) {
      const antes = p.items[FRAGMENTO_CHAVE_ID] ?? 0;
      darFragmentosDeChave(p, d.qtd);
      auditar(
        p,
        'fragmento',
        'chave_drop',
        `+${d.qtd} Fragmento de Chave (${antes}→${p.items[FRAGMENTO_CHAVE_ID] ?? 0}) · ${s.nome}${hunt?.slug ? ` · ${hunt.slug}` : ''}`,
      );
      continue;
    }
    // Fora do `+=` genérico pela auditoria, e para nunca passar pela venda automática de loot.
    if (item.id === FRAGMENTO_BICICLETA_ID) {
      const antes = p.items[FRAGMENTO_BICICLETA_ID] ?? 0;
      p.items[item.id] = antes + d.qtd;
      auditar(
        p,
        'fragmento',
        'bicicleta_drop',
        `+${d.qtd} Fragmento de Bicicleta (${antes}→${p.items[FRAGMENTO_BICICLETA_ID]}) · ${s.nome}${hunt?.slug ? ` · ${hunt.slug}` : ''}`,
      );
      continue;
    }
    if (item.id === FRAGMENTO_SHINY_ID) {
      const antes = p.items[FRAGMENTO_SHINY_ID] ?? 0;
      p.items[item.id] = antes + d.qtd;
      auditar(
        p,
        'fragmento',
        'shiny_drop',
        `+${d.qtd} Fragmento Shiny Stone (${antes}→${p.items[FRAGMENTO_SHINY_ID]}) · ${s.nome}${hunt?.slug ? ` · ${hunt.slug}` : ''}`,
      );
      continue;
    }
    const vendido = autoVenderDrop(p, item, d.qtd);
    if (vendido) {
      ouroVendaAuto += vendido.ganho;
      vendaAuto.push({ nome: item.name, qtd: vendido.qtd, ganho: vendido.ganho });
      continue;
    }
    p.items[item.id] = (p.items[item.id] ?? 0) + d.qtd;
  }
  const ouro = ouroPorDerrotaHunt(hunt, s.level, especie);
  const ouroHunt = ouro + ouroVendaAuto;
  if (ouroHunt > 0) {
    somarGoldAuditado(
      p,
      ouroHunt,
      'hunt',
      `${s.nome}${ouroVendaAuto ? ` · kill ${ouro} + auto-venda ${ouroVendaAuto}` : ''}`,
    );
  }

  evento(p, {
    k: 'morte',
    quem: 'selvagem',
    slot: s.slot,
    nome: s.nome,
    xp: s.xp,
    xpTreinador: ganho.treinador,
    xpPokemon: ganho.pokemon,
    lootBoost: bonusLootPct(p, t) > 0,
    ouro,
    drops,
    ...(ouroVendaAuto ? { ouroVendaAuto, vendaAuto } : {}),
  });
  baixarMob(p, s);
  marcarSujo(p);
}

/**
 * Arremessa uma bola num CORPO no chão (`slot` obrigatório). A captura manual e a auto-ball
 * usam o painel de caídos ou passam o slot do mob derrotado — não há arremesso em quem ainda
 * está lutando.
 */
function arremessarBola(p, ballId, slot = null) {
  if (slot == null) {
    return evento(p, { k: 'aviso', msg: 'só dá para arremessar bola em um pokémon derrotado' });
  }
  const s = p.campo?.mobs.get(slot);
  // O alvo pode ter saído de cena entre o clique e a chegada da mensagem — o corpo expirou,
  // ou o time desmaiou e o campo virou o Centro Pokémon. Avisa em vez de engolir: um clique
  // que não faz nada e não explica é o pior tipo de bug para quem está jogando.
  if (!s) return evento(p, { k: 'aviso', msg: 'esse pokémon não está mais no chão' });
  if (!s.morto) return evento(p, { k: 'aviso', msg: 'esse pokémon ainda está em pé' });
  if (agora() < p.proxBola) return;
  const bola = bolaPorId.get(ballId);
  if (!bola) return;
  if ((p.balls[ballId] ?? 0) <= 0) return evento(p, { k: 'aviso', msg: `Sem ${bola.nome}` });

  p.balls[ballId]--;
  p.proxBola = agora() + CD_BOLA_MS;
  marcarSujo(p);

  const especie = especies.get(s.speciesId);
  // Shiny rola no arremesso — antes de saber se a bola fechou — para contar "vistos" sem
  // revelar no mapa. Só depois da tentativa o cliente sabe se era shiny (capturou ou escapou).
  const shiny = rolarShinyCaptura(p, especie);
  /**
   * O CONTADOR DE SHINY DA POKÉDEX — `sv` (vistos) e `sc` (capturados), por espécie.
   *
   * O brilho é sorteado AQUI, no arremesso, e não no spawn (ver `rolarShinyCaptura`): este é
   * o único instante em que "apareceu um shiny desta espécie" existe. Se a bola falha, o
   * corpo some e não sobra nada de onde deduzir depois — por isso `sv` sobe agora, antes de
   * saber se fechou, e `sc` só na captura. É a mesma conta que o Hunt Analyser faz na
   * sessão, só que por espécie e guardada para sempre.
   *
   * `sv >= sc` sempre, e é o que dá sentido ao par na ficha: de X que brilharam nesta hunt,
   * você segurou Y. Por isso a evolução com Shiny Stone NÃO entra aqui (ela registra captura
   * em `registrarCapturaDex`, sem encontro nenhum) — somaria em `sc` sem par em `sv`.
   */
  const chaveDex = chavePokedex(s.speciesId);
  if (shiny && chaveDex != null) {
    const dex = (p.pokedex[chaveDex] ??= { k: 0, c: 0 });
    dex.sv = (dex.sv ?? 0) + 1;
  }
  // O Capture Boost DOBRA a chance, e o teto de 75% da fórmula continua valendo por cima —
  // senão um boost numa espécie comum viraria captura garantida.
  const chance = Math.min(CAPTURA_TETO, chanceCaptura(especie, bola, s.hp / s.maxHp) * multCaptura(p, agora()));
  const sucesso = Math.random() < chance;

  evento(p, { k: 'bola', ballId, slot: s.slot, sucesso, chance: +chance.toFixed(3), shiny });

  if (!sucesso) {
    // Falhou: o corpo some. É UMA tentativa por pokémon derrotado — deixar o corpo no
    // chão transformava a captura em "despeje bolas até sair", e o custo por captura
    // deixava de existir. Um selvagem VIVO continua em campo, porque ele ainda está
    // lutando; quem sai de cena é só quem já estava caído.
    if (s.morto) {
      removerMob(p.campo, s);
      evento(p, { k: 'fugiu', nome: s.nome, level: s.level, shiny });
    }
    desligarAutoBallSeEsgotou(p);
    return;
  }

  if (p.automation.autoBallAteCapturar) {
    p.automation.autoBallAteCapturar = false;
    marcarSujo(p);
  }

  if (chaveDex != null) {
    const dex = (p.pokedex[chaveDex] ??= { k: 0, c: 0 });
    dex.c++;
    if (shiny) dex.sc = (dex.sc ?? 0) + 1;
  }
  removerMob(p.campo, s);
  if (p.selvagem === s) p.selvagem = null;
  if (!algumMobVivo(p.campo)) p.campo.ondaEm = agora() + MS_ONDA;

  /**
   * O TETO. O selvagem lutou como nível 2.000; o capturado nasce no degrau da espécie.
   *
   * O XP desce JUNTO, e essa é a metade que não dá para esquecer: `nivelPeloXp` é quem manda
   * no nível a partir do primeiro ganho de XP, então gravar `level: 100` com o XP de 2.000
   * devolveria o nível 2.000 no primeiro mob derrubado — o teto duraria um golpe.
   *
   * Até o nível 100 nada muda (ver `nivelDeCaptura`): Kanto inteira continua
   * entregando o bicho no nível em que ele estava no chão.
   */
  const nivelCap = nivelDeCapturaDe(especie, s.level);

  criarPokemon(p, especie.pokeId, nivelCap, xpTotalParaNivel(nivelCap), shiny)
    .then((pk) => {
      if (pk.shiny) anunciarShinyCapturado(p, pk);
      // Só shiny e P5 vão para a auditoria, e isso é uma DECISÃO de volume, não um esquecimento.
      // Auditar toda captura chegou a entrar aqui para servir de fonte de data ao `caught_at` —
      // mas a data nasce sozinha no `DEFAULT now()` da coluna e nunca precisou do log. O preço
      // seria alto: `player_gameplay_log` tem ~40 mil linhas da vida INTEIRA do jogo, e o mundo
      // cria dezenas de milhares de pokémon por dia. A tabela dobraria de tamanho todo dia, com
      // um INSERT a mais no caminho quente da captura, para registrar o evento mais banal que
      // existe. O que a auditoria procura é o achado raro: esse continua aqui.
      if (pk.shiny || Number(pk.potencia) === POTENCIA_MAX) {
        const acao =
          pk.shiny && Number(pk.potencia) === POTENCIA_MAX
            ? 'shiny_p5'
            : pk.shiny
              ? 'shiny'
              : 'p5';
        const tags = [
          pk.shiny ? '★ shiny' : null,
          Number(pk.potencia) === POTENCIA_MAX ? 'P5' : null,
          pk.slot == null ? '→ depot' : null,
        ]
          .filter(Boolean)
          .join(' · ');
        auditar(
          p,
          'captura',
          acao,
          `${rotuloPokemon(pk.nome, pk.id)} Nv ${pk.level}${tags ? ` · ${tags}` : ''}${p.huntSlug ? ` · ${p.huntSlug}` : ''}`,
          `pk:${pk.id}`,
        );
      }
      evento(p, {
        k: 'capturado',
        pokemon: { id: pk.id, nome: pk.nome, level: pk.level, shiny: pk.shiny, quality: pk.quality },
        // O nível que ele TINHA no chão, quando o teto cortou. Vai para o cliente escrever
        // "veio no nível 100 (era 2.000)" — sem isso a captura parece um bug de nível.
        ...(nivelCap < s.level ? { levelSelvagem: s.level } : {}),
        paraDepot: pk.slot == null,
      });
      marcarSujo(p, pk);
    })
    .catch((err) => console.error('[sim] falha ao criar pokémon capturado:', err.message));
  desligarAutoBallSeEsgotou(p);
}

/**
 * A ordem "regra padrão" de gasto por categoria: da MAIS CARA para a mais barata. `npcPrice`
 * é o valor de revenda e anda junto com a raridade da poção/revive; o efeito
 * (`healPct` / `healAmount` / `revivePct`) desempata. Memoizada — o catálogo não muda em
 * runtime, e o cálculo preguiçoso evita depender da ordem de avaliação dos módulos no boot.
 *
 * `healPct` vem antes de `healAmount` no desempate porque cura por porcentagem não envelhece:
 * os 50% da Golden Potion valem mais que os 3.000 fixos da Ultimate em qualquer pokémon com
 * mais de 15.000 de HP máximo, e é dessa faixa para cima que a poção existe.
 */
const _ordemPadraoAuto = new Map();
const ordemPadraoAutomacao = (categoria) => {
  if (!_ordemPadraoAuto.has(categoria)) {
    _ordemPadraoAuto.set(
      categoria,
      [...itens.values()]
        .filter((i) => i.category === categoria)
        .sort((a, b) =>
          (b.npcPrice ?? 0) - (a.npcPrice ?? 0)
          || (b.healPct ?? 0) - (a.healPct ?? 0)
          || (b.healAmount ?? 0) - (a.healAmount ?? 0)
          || (b.revivePct ?? 0) - (a.revivePct ?? 0))
        .map((i) => i.id),
    );
  }
  return _ordemPadraoAuto.get(categoria);
};

/**
 * O que uma conta NOVA já nasce com marcado em "Usar Revive" e "Usar Poções" — do mais barato
 * para o mais caro.
 *
 * ### Por que marcar TODAS, e não só a Small Potion
 *
 * Lista vazia já significa "qualquer item" (ver `itemDaAutomacao`), então o jogo funcionaria sem
 * marcar nada. Marcar existe por duas razões, e as duas importam para quem está começando:
 *
 *   1. **a tela conta o que está ligado.** Com os interruptores acesos e nenhum chip marcado, o
 *      painel parece meio configurado — e a primeira coisa que alguém faz é desconfiar dele.
 *   2. **a ordem de gasto inverte.** A regra de lista vazia gasta do MAIS CARO para o mais
 *      barato, que é o contrário do que se quer: o jogador de nível 8 queimaria a Golden Potion
 *      que caiu de um boss antes das Small que ele compra a 50 de ouro.
 *
 * E todas, e não uma: a automação PARA quando acaba tudo o que está marcado (isso é de
 * propósito — ela não gasta o que o jogador não pediu). Marcar só a Small Potion seria prometer
 * auto-cura e desligá-la em silêncio no dia em que a Small acabasse e a Great sobrasse na bolsa.
 *
 * Só o que o NPC vende (`npcPrice > 0`), que é o mesmo corte dos chips da tela: um id fora dessa
 * lista viraria uma escolha que o jogador vê marcada e não tem como desmarcar.
 */
const _idsPadraoCuidado = new Map();
function idsPadraoDeCuidado(categoria) {
  if (!_idsPadraoCuidado.has(categoria)) {
    _idsPadraoCuidado.set(
      categoria,
      [...ordemPadraoAutomacao(categoria)]
        .filter((id) => (itens.get(id)?.npcPrice ?? 0) > 0)
        .reverse(),
    );
  }
  return [..._idsPadraoCuidado.get(categoria)];
}

/**
 * O próximo item de uma categoria que a automação pode gastar.
 *
 * `preferidos` é a lista que o jogador marcou na tela, NA ORDEM em que ele marcou — é o que
 * deixa alguém dizer "gasta as Small Potion primeiro e só depois as Hyper". Enquanto sobrar
 * QUALQUER item marcado, a automação fica DENTRO da escolha do jogador: esvaziou tudo que ele
 * marcou, ela para (`return null`) em vez de sacar algo que ele não pediu.
 *
 * Lista vazia = "nunca configurou": aí entra a regra padrão — da mais cara para a mais barata
 * (`ordemPadraoAutomacao`), no lugar da antiga varredura em ordem arbitrária do inventário,
 * que queimava a Hyper Potion ou a Small ao sabor da ordem das chaves do objeto.
 *
 * Um id preferido que não está mais na bolsa é pulado em silêncio: o jogador escolheu uma
 * ordem, não uma exigência, e travar a cura porque a poção favorita acabou é o pior resultado
 * possível.
 */
function itemDaAutomacao(p, categoria, preferidos) {
  for (const id of preferidos ?? []) {
    if ((p.items[id] ?? 0) > 0 && itens.get(id)?.category === categoria) return itens.get(id);
  }
  if (preferidos?.length) return null;
  for (const id of ordemPadraoAutomacao(categoria)) {
    if ((p.items[id] ?? 0) > 0) return itens.get(id);
  }
  return null;
}

function usarRevive(p, pk) {
  const item = itemDaAutomacao(p, 'revive', p.automation.reviveIds);
  if (!item) return false;
  p.items[item.id]--;
  if (!p.items[item.id]) delete p.items[item.id];
  pk.hp = Math.max(1, Math.round(pk.maxHp * (item.revivePct ?? 0.5)));
  marcarSujo(p, pk);
  evento(p, { k: 'revive', id: pk.id, itemId: item.id, hp: pk.hp });
  return true;
}

function usarPocao(p, pk) {
  const item = itemDaAutomacao(p, 'heal', p.automation.potionIds);
  if (!item) return false;
  p.items[item.id]--;
  if (!p.items[item.id]) delete p.items[item.id];
  // `healPct` primeiro: a Golden Potion cura por PORCENTAGEM do HP máximo e não declara
  // `healAmount` nenhum — as cinco do espelho fazem o contrário. O 0,4 do fim continua sendo
  // a rede para um item de categoria `heal` que chegue ao catálogo sem efeito declarado.
  const cura = item.healPct != null
    ? Math.max(1, Math.round(pk.maxHp * item.healPct))
    : item.healAmount ?? Math.round(pk.maxHp * 0.4);
  pk.hp = Math.min(pk.maxHp, pk.hp + cura);
  marcarSujo(p, pk);
  evento(p, { k: 'cura', id: pk.id, itemId: item.id, hp: pk.hp });
  return true;
}

/** Usa potions em sequência enquanto a vida ficar abaixo do limiar configurado. */
const MAX_POCOES_AUTO_POR_TICK = 20;

function tentarAutoPocao(p, pk) {
  if (!p.automation.autoPotion || !pk || pk.hp <= 0) return;
  const limiar = limiarValido(p.automation.hpLimiar);
  let usadas = 0;
  while (pk.hp / pk.maxHp < limiar && usadas < MAX_POCOES_AUTO_POR_TICK) {
    if (!usarPocao(p, pk)) break;
    usadas++;
  }
}

function processar(p, t) {
  // O XP SHARE não tem tick.
  //
  // A Academia tinha: ela rendia sozinha, a cada 4 s, estivesse o jogador onde estivesse. O
  // XP Share não é uma segunda fonte — ele reparte o abate, então mora dentro de `ganharXp` e
  // acontece exatamente quando acontece um kill. Um `if` a menos por jogador por tick.

  // A repetição do boss é a única coisa que acontece com o jogador PARADO no Centro, então
  // ela vem antes da porta abaixo (que devolve todo mundo que está lá).
  if (p.bossAutoEm) tentarBossAutomatico(p, t);
  if (p.noCentro || !p.campo || (!p.huntSlug && !p.boss)) return;
  const campo = p.campo;
  let pk = ativo(p);
  if (pk && !podeUsarPokemon(p, pk)) {
    const alt = primeiroDaEquipeUtilizavel(p);
    if (alt) {
      ativarPokemon(p, alt);
      pk = alt;
    } else {
      pk = null;
    }
  }

  // pokémon desmaiado: tenta revive, e se não der, tenta trocar por outro do time de pé
  if (pk && pk.hp <= 0) {
    if (p.automation.autoRevive && usarRevive(p, pk)) {
      tentarAutoPocao(p, pk);
    } else {
      const suplente = primeiroDaEquipeUtilizavel(p, (k) => k.hp > 0);
      if (suplente) {
        p.activeId = suplente.id;
        pk = suplente;
        p.proxAtaqueJogador = t + 400;
        marcarSujo(p);
        evento(p, { k: 'troca', id: suplente.id, nome: suplente.nome });
      } else if (p.boss) {
        // Perdeu a luta: sai da arena antes de ir para o Centro, senão o jogador voltaria
        // curado direto para dentro dela, de graça e sem pagar outro token.
        evento(p, { k: 'bossPerdeu', nome: bossPorKey(p.boss.key)?.nome ?? p.boss.key });
        p.boss = null;
        irParaOCentro(p);
        // Perder também conta como "acabou a luta": com a repetição ligada, o time é curado
        // no Centro e a próxima tentativa começa — é para isso que ela serve.
        agendarBossAuto(p);
        return true;
      } else {
        // time inteiro no chão e sem revive: só a enfermeira resolve
        return irParaOCentro(p);
      }
    }
  }
  const podeCacar = pk && pk.hp > 0;

  // corpos que passaram do tempo de chão saem do mapa
  limparCorpos(campo, t);

  // A auto-ball arremessa nos CORPOS, não em quem ainda está lutando.
  //
  // Antes ela só disparava com o selvagem VIVO abaixo de 45% de HP — uma janela que um
  // golpe forte atravessa inteira, então na prática quase nunca acontecia. E mesmo quando
  // acontecia mirava o alvo pior: vivo tem `hpFrac > 0` e a chance cai.
  //
  // Aqui não precisa de trava contra repetir: a tentativa tira o corpo do mapa de um jeito
  // ou de outro, e `proxBola` segura o ritmo.
  // O Auto-Catch é do VIP: a caixa é o interruptor, a assinatura é a licença. Conferir as
  // duas AQUI (e não só no `auto.set`) é o que faz o benefício parar sozinho quando o VIP
  // vence, sem precisar de um varredor de assinaturas expiradas.
  if (autoBallLigado(p.automation) && vipAtivo(p, t) && t >= p.proxBola) {
    const preferidas = preferidasBolaAuto(p.automation);
    const bola = preferidas.find((id) => (p.balls[id] ?? 0) > 0);
    if (bola) {
      const corpo = [...campo.mobs.values()].find((m) => m.morto);
      if (corpo) arremessarBola(p, bola, corpo.slot);
    }
  }

  // onda nova quando o campo esvaziou
  if (!algumMobVivo(campo)) {
    if (t >= campo.ondaEm) povoarOnda(p);
  } else if (podeCacar) {
    const emHunt = p.huntSlug && !p.boss;
    let alvo = null;

    if (emHunt) {
      // Sempre o mais próximo; empate mantém o alvo atual (histerese anti flip-flop).
      alvo = escolherAlvoHunt(campo);
    } else {
      // Boss: reescolhe enquanto ainda não encostou; encostado trava até morrer.
      const atual = campo.alvo != null ? campo.mobs.get(campo.alvo) : null;
      if (!atual || atual.morto || distanciaDoHeroi(campo, atual) > (campo.distCombate ?? DIST_COMBATE)) {
        alvo = alvoMaisProximo(campo);
      }
    }

    if (alvo && alvo.slot !== campo.alvo) {
      campo.alvo = alvo.slot;
      campo.heroiMudou = true;
      p.proxAtaqueSelvagem = t + 1200; // o selvagem não abre a briga no primeiro frame
    }
  }
  if (!podeCacar && campo.alvo != null) {
    campo.alvo = null;
    campo.heroiMudou = true;
  }

  // A BICICLETA encurta o passo do pokémon e do treinador — só na hunt. A arena do boss usa
  // este mesmo campo e lá ela não vale (ver `shared/bicicletas.mjs`). Lida da bolsa a cada
  // tick: vender a bicicleta no Mercado derruba a velocidade já no passo seguinte.
  campo.velocidade = p.huntSlug && !p.boss ? fatorPassoBicicleta(p) : 1;

  // move todo mundo; `encostado` diz se o herói já alcançou o alvo
  const encostado = moverCampo(campo, t);
  const alvo = campo.alvo != null ? campo.mobs.get(campo.alvo) : null;

  // Só há troca de golpes com o herói ENCOSTADO no alvo. É isso que amarra a animação ao
  // combate: nada de dano voando de um lado a outro do mapa.
  p.selvagem = encostado && alvo && !alvo.morto ? alvo : null;
  if (!p.selvagem || !podeCacar) return;

  const s = p.selvagem;

  // ataque do jogador
  if (t >= p.proxAtaqueJogador) {
    const golpe = melhorGolpeJogador(especies.get(pk.speciesId), pk, pk.level, pk.stats, s.tipos, p.cdGolpes, t, s.stats);
    if (golpe) {
      p.cdGolpes[golpe.name] = t + cooldownComSpeed(golpe.cooldownMs, ivSpeedDe(pk));
      const atk = golpe.category === 'SPECIAL' ? pk.stats.spAtk : pk.stats.atk;
      const alvos = p.boss ? [s] : alvosDoGolpe(campo, s, golpe, pk);
      const mortos = [];
      for (const alvo of alvos) {
        const def = golpe.category === 'SPECIAL' ? alvo.stats.spDef : alvo.stats.def;
        const r = calcularDano({
          nivelAtacante: pk.level,
          power: golpe.power,
          atk,
          def,
          tipoGolpe: golpe.type,
          tiposAtacante: pk.tipos,
          tiposDefensor: alvo.tipos,
          ehSelvagem: false,
        });
        // +25% do LÍDER DE GINÁSIO: se o dono tem o título do tipo deste pokémon, ele bate
        // mais forte em toda a hunt. `multDoGolpe` é um `Map.get` sobre o pódio já apurado —
        // ver por que ele não pode ser uma consulta em `game/ginasios.mjs`.
        r.dano = Math.round(r.dano * multDoGolpe(p.dbId, pk.tipos));
        alvo.hp = Math.max(0, alvo.hp - r.dano);
        campo.mudou.add(alvo.slot);
        evento(p, {
          k: 'ataque',
          por: 'jogador',
          slot: alvo.slot,
          golpe: golpe.name,
          tipo: golpe.type,
          dano: r.dano,
          ef: r.efetividade,
          stab: r.stab,
          hpAlvo: alvo.hp,
          aoe: alvos.length > 1,
        });
        if (alvo.hp <= 0) mortos.push(alvo);
      }
      p.proxAtaqueJogador = t + cooldownComSpeed(CD_GLOBAL_JOGADOR, ivSpeedDe(pk));
      p.emCombateAte = t;
      p.combateOndaSeq = p.campo?.ondaSeq ?? 0;
      if (mortos.length) {
        const primMorto = mortos.some((m) => m.slot === s.slot);
        for (const mob of mortos) {
          p.selvagem = mob;
          if (p.boss) return derrotarBoss(p);
          derrotarSelvagem(p);
        }
        if (primMorto) return;
      }
    }
  }

  // ataque do selvagem (ou do boss)
  if (t >= p.proxAtaqueSelvagem) {
    // O boss não usa a lista de golpes da espécie: ele tem os próprios, com power e cooldown
    // da ficha. `golpeDeBoss` escolhe o mais forte que já saiu do cooldown.
    const golpe = p.boss
      ? golpeDeBoss(s, t)
      : melhorGolpe(especies.get(s.speciesId), s.level, s.stats, pk.tipos, s.cdGolpes, t, pk.stats, true);
    if (golpe) {
      s.cdGolpes[golpe.name] = t + cooldownComSpeed(golpe.cooldownMs, ivSpeedDe(s));
      const atk = golpe.category === 'SPECIAL' ? s.stats.spAtk : s.stats.atk;
      const def = golpe.category === 'SPECIAL' ? pk.stats.spDef : pk.stats.def;
      const r = calcularDano({
        nivelAtacante: s.level,
        power: golpe.power,
        atk,
        def,
        tipoGolpe: golpe.type,
        tiposAtacante: s.tipos,
        tiposDefensor: pk.tipos,
        // O ×1,8 é o multiplicador de dano do SELVAGEM DE HUNT. O boss não leva: os golpes
        // dele já vêm com power de boss (280 a 800, contra os 56–72 de um golpe normal), e
        // aplicar os dois é contar a mesma escalada duas vezes.
        ehSelvagem: !p.boss,
      });
      // A PENALIDADE DE EQUIPE entra aqui, e só aqui: ela multiplica o que o boss bate, não
      // o que ele aguenta. Equipe de seis no nível do boss dá mult 1; sozinho e fraco, 700.
      if (p.boss) r.dano = Math.round(r.dano * p.boss.penalidade.mult);
      pk.hp = Math.max(0, pk.hp - r.dano);
      p.proxAtaqueSelvagem = t + cooldownComSpeed(CD_GLOBAL_SELVAGEM, ivSpeedDe(s));
      p.emCombateAte = t; // dano RECEBIDO também prende: fugir apanhando é o caso que importa
      p.combateOndaSeq = p.campo?.ondaSeq ?? 0;
      marcarSujo(p, pk);
      evento(p, {
        k: 'ataque',
        por: 'selvagem',
        slot: s.slot,
        golpe: golpe.name,
        tipo: golpe.type,
        dano: r.dano,
        ef: r.efetividade,
        hpAlvo: pk.hp,
      });

      if (pk.hp <= 0) {
        evento(p, { k: 'morte', quem: 'jogador', id: pk.id });
      }
    }
  }

  tentarAutoPocao(p, pk);
}

// -------------------------------------------------------------------- ranking
//
// Placar do MUNDO, não do shard: sai do Postgres, não da memória. Cada aba é uma consulta
// pronta em `db.mjs`, e o resultado fica em cache por alguns segundos — sem isso, um modal
// aberto em vinte clientes viraria vinte varreduras por segundo na tabela de jogadores.

const ABAS_RANKING = {
  nivel: db.rankingNivel,
  poder: db.rankingPoder,
  capturas: db.rankingCapturas,
  coins: db.rankingCoins,
  elo: db.rankingElo,
  guild: gdb.rankingGuild, // Diário — zera toda guerra, dá bônus de XP/farm
  guildGlobal: gdb.rankingGuildGlobal, // Global — só zera no fechamento do mês, paga em diamante
};

/**
 * Backfill do `power` dos pokémon que já existiam antes da coluna.
 *
 * O poder é derivável (espécie + IVs + nível + qualidade), mas as bases da espécie vivem no
 * JSON do espelho — o Postgres não tem como calcular sozinho. Roda uma vez no boot, em lotes,
 * e nas subidas seguintes não acha nada e sai na hora. Sem isto, todo pokémon anterior a esta
 * versão ficaria fora do ranking de Pokémon Forte para sempre.
 */
/**
 * O poder de uma LINHA CRUA do banco, para os backfills de boot.
 *
 * Tudo aqui é defensivo porque a entrada é o histórico inteiro da tabela, não um pokémon
 * recém-montado: há linhas antigas com `quality` nulo e com `ivs` incompleto (um `{"hp":30}`
 * sem os outros cinco), e nelas a conta produz NaN. `Math.max(1, NaN)` é NaN, então nem o piso
 * salvava — o INSERT ia com NaN e o Postgres derrubava o boot inteiro com
 * "invalid input syntax for type integer".
 *
 * Devolver 1 no lugar é o mesmo caminho que a espécie desconhecida já tomava: tira a linha do
 * `WHERE power = 0` e impede o laço de girar para sempre sobre as mesmas linhas.
 */
const poderDaLinha = (r) => {
  const esp = especies.get(r.species_id);
  if (!esp) return 1;
  try {
    const ivs = typeof r.ivs === 'string' ? JSON.parse(r.ivs) : r.ivs;
    const refino = normalizarRefino(r.bonus_base ?? r.refino);
    return poderDePokemon({
      ivs: ivs ?? {},
      quality: Number(r.quality) || 1,
      potencia: Number(r.potencia) || 1,
      shiny: r.shiny,
      level: r.level,
      refino,
    }, esp);
  } catch {
    return 1;
  }
};

async function preencherPoderes() {
  let total = 0;
  for (;;) {
    const linhas = await db.pokemonsSemPoder(500);
    if (!linhas.length) break;
    await db.gravarPoderes(linhas.map((r) => ({ id: r.id, power: poderDaLinha(r) })));
    total += linhas.length;
  }
  if (total) console.log(`[sim] poder preenchido em ${total} pokémon antigos`);
}

/**
 * Quando `PODER_FORMULA_VERSAO` sobe, regrava o ⚔ de TODOS os pokémon — não só `power = 0`.
 *
 * Sem isto, quem já tinha `power` da fórmula antiga (soma de stats × qualidade) ficaria no
 * placar errado até subir de nível de novo. Roda uma vez por versão, em lotes, e grava a
 * versão em `game_meta` para não repetir a cada restart.
 */
async function recalcularPoderesSeFormulaMudou() {
  const gravada = Number(await db.lerMeta('poder_formula_v')) || 0;
  if (gravada >= PODER_FORMULA_VERSAO) return;
  let total = 0;
  let lastId = 0;
  for (;;) {
    const linhas = await db.pokemonsParaRecalcularPoder(500, lastId);
    if (!linhas.length) break;
    await db.gravarPoderes(linhas.map((r) => ({ id: r.id, power: poderDaLinha(r) })));
    lastId = linhas.at(-1).id;
    total += linhas.length;
  }
  await db.gravarMeta('poder_formula_v', PODER_FORMULA_VERSAO);
  if (total) console.log(`[sim] poder recalculado (fórmula v${PODER_FORMULA_VERSAO}) em ${total} pokémon`);
}

/** Quando `NOTA_FORMULA_VERSAO` sobe, realinha `ficha.nota` dos anúncios abertos no Mercado. */
async function recalcularNotasSeFormulaMudou() {
  const gravada = Number(await db.lerMeta('nota_formula_v')) || 0;
  if (gravada >= NOTA_FORMULA_VERSAO) return;
  const { total, atualizados } = await mdb.recalcularNotasAnuncios({ soAbertos: true });
  await db.gravarMeta('nota_formula_v', NOTA_FORMULA_VERSAO);
  if (atualizados) {
    console.log(`[sim] nota recalculada (fórmula v${NOTA_FORMULA_VERSAO}) em ${atualizados}/${total} anúncio(s)`);
  }
}

/**
 * Backfill da POTÊNCIA: gira a roleta para quem foi capturado antes de ela existir.
 *
 * Podia ser mais simples — dar 1 a todo mundo e pronto — mas isso condenaria cada pokémon
 * anterior a esta versão ao degrau mais fraco, para sempre, sem nunca ter tido a chance que
 * qualquer captura nova tem. Rolar de verdade é a mesma justiça que o jogo dá a quem chegou
 * depois, e é barato: uma vez, em lotes, e nas subidas seguintes não acha nada.
 *
 * O `power` é regravado no mesmo passo porque a potência mexe nos stats — deixar para o
 * `preencherPoderes` não funcionaria, já que ele só procura linhas com `power = 0`.
 */
async function preencherPotencias() {
  let total = 0;
  for (;;) {
    const linhas = await db.pokemonsSemPotencia(500);
    if (!linhas.length) break;
    const atualizados = await db.gravarPotencias(
      linhas.map((r) => ({ id: r.id, potencia: rolarPotencia() })),
    );
    await db.gravarPoderes(atualizados.map((r) => ({ id: r.id, power: poderDaLinha(r) })));
    total += linhas.length;
  }
  if (total) console.log(`[sim] potência sorteada para ${total} pokémon antigos`);
}

/** Quanto um placar fica válido. É um ranking idle — ninguém sente 10 s de atraso. */
const RANKING_CACHE_MS = 10000;

const cacheRanking = new Map(); // aba → { em, linhas }

async function responderRanking(p, aba, bossKeyBruto) {
  let chaveCache = aba;
  let consulta = ABAS_RANKING[aba];
  let bossKey = null;

  if (aba === 'bosses') {
    bossKey = String(bossKeyBruto ?? '').trim();
    if (!bossPorKey(bossKey)) return;
    chaveCache = `bosses:${bossKey}`;
    consulta = () => db.rankingBossKills(bossKey, 50);
  } else if (!consulta) {
    return;
  }

  const guardado = cacheRanking.get(chaveCache);
  let linhas = guardado && agora() - guardado.em < RANKING_CACHE_MS ? guardado.linhas : null;
  if (!linhas) {
    linhas = await consulta(50);
    linhas.forEach((l, i) => {
      // A colocação é a posição na consulta — quem ordena é o `ORDER BY`, então numerar aqui
      // é o suficiente e evita mandar a mesma conta para o cliente fazer de novo.
      l.rank = i + 1;
      // O ranking de poder vem com `speciesId`; o nome e o looktype saem do catálogo aqui,
      // para o cliente não precisar cruzar nada.
      if (aba === 'poder') {
        const e = especies.get(l.speciesId);
        l.nome = e?.name ?? `#${l.speciesId}`;
        l.looktype = e?.looktype ?? 0;
        l.lookShiny = l.shiny ? looktypeShiny(l.speciesId) : null;
      }
      if (aba === 'guild' || aba === 'guildGlobal') {
        l.nick = l.nome;
        l.valor = l.gp;
      }
    });
    cacheRanking.set(chaveCache, { em: agora(), linhas });
  }
  enviar(p, { t: SERVIDOR.RANKING, aba, linhas, ...(bossKey ? { bossKey } : {}) });
}

// --------------------------------------------------------------------- ORBs

/**
 * Monta e envia o painel da carteira.
 *
 * Vai tudo de uma vez — saldo, extrato, saques e os números públicos do caixa — porque a tela
 * mostra as quatro coisas juntas e pedir uma por vez daria quatro idas ao banco por abertura
 * de modal.
 *
 * O painel do CAIXA é público de propósito: o compromisso é que qualquer jogador veja quanto
 * o projeto arrecadou, quanto já pagou de volta e quanto deve se todos sacassem hoje.
 */
async function saldoOnChainCarteiraProjeto() {
  if (!config.carteiraProjeto) return null;
  try {
    const { criarChain } = await import('./chain.mjs');
    const chain = criarChain();
    if (chain.simulada) return null;
    return await chain.saldoUsdt(config.carteiraProjeto);
  } catch (err) {
    console.error('[orbs] saldo on-chain da tesouraria:', err.message);
    return null;
  }
}

async function responderPainelDeOrbs(p) {
  const [saldo, extrato, saques, caixa, referencia, naCarteira, colheitasUsdt, taxasMercadoGemas] = await Promise.all([
    odb.saldoDe(p.dbId),
    odb.extratoDoJogador(p.dbId),
    odb.saquesDoJogador(p.dbId),
    odb.numerosDoCaixa(),
    odb.referenciaDe(p.dbId, novaReferencia),
    saldoOnChainCarteiraProjeto(),
    odb.colheitasConfirmadasUsdt(),
    mdb.totaisTaxasMercadoGemas(),
  ]);
  p.orbs = saldo;

  // O endereço PRÓPRIO do jogador, quando a seed de depósitos está configurada. Abrir esta
  // tela é o que ARMA o endereço para o watcher — ninguém deposita sem passar por aqui, e
  // é isso que mantém a varredura em dezenas de endereços em vez de milhares.
  let meuEndereco = null;
  if (enderecosOrb.temSeed()) {
    meuEndereco = await enderecosOrb
      .enderecoDe(p.dbId, { armar: true })
      .catch((err) => {
        console.error('[orbs] não deu para derivar o endereço:', err.message);
        return null;
      });
  }

  enviar(p, {
    t: SERVIDOR.ORBS,
    saldo,
    extrato,
    saques,
    referencia,
    // Para onde o jogador manda o USDT. Vem do ambiente: em dev fica vazio e a tela avisa
    // que o depósito ainda não está configurado, em vez de mostrar um endereço inventado.
    deposito: {
      // `meu` é o endereço exclusivo do jogador; quando existe, é ELE que a tela mostra e
      // o memo deixa de ser necessário. `endereco` (a carteira única) fica como caminho
      // antigo, para quando a seed não está configurada.
      meu: meuEndereco,
      endereco: config.carteiraProjeto,
      redes: Object.values(REDES).map((r) => ({ id: r.id, nome: r.nome })),
    },
    precos: {
      compra: PRECO_COMPRA,
      saque: PRECO_SAQUE,
      spreadPct: Math.round(SPREAD * 100),
      minimo: SAQUE_MINIMO_ORBS,
      reenvioMs: REENVIO_DELAY_MS,
    },
    caixa: (() => {
      const resumo = resumoDoCaixa({ ...caixa, naCarteira, colheitasUsdt });
      const taxasMercadoUsdt = arredondar6(taxasMercadoGemas * PRECO_COMPRA);
      return {
        ...resumo,
        emCaixaUsdt: Math.max(0, arredondar6(resumo.emCaixaUsdt - taxasMercadoUsdt)),
        taxasMercadoUsdt,
        taxasMercadoPct: Math.round(mdb.TAXA_ORB * 100),
        carteira: config.carteiraProjeto,
        explorer: config.carteiraProjeto ? REDES[config.carteiraRede]?.explorer(config.carteiraProjeto) : null,
      };
    })(),
  });
}

// ---------------------------------------------------------------- write-behind

const filaFlush = new Set();

/** Gravações de saída em andamento, por jogador — o `entrar` espera a sua antes de ler. */
const flushPendente = new Map();

/**
 * Despeja no Postgres tudo que mudou desde o ciclo anterior.
 *
 * ### O instante da CAPTURA é a regra deste arquivo
 *
 * Daqui até o `await db.flushJogadores` não existe um único `await`, e isso é proposital: o
 * `lote.map` abaixo é a fotografia do jogador, tirada de uma vez só. `items`, `automation`,
 * `pokedex` já viravam texto aqui; os POKÉMON não — iam como referência viva e eram lidos lá
 * na frente, dentro da transação. Como a transação leva ~1 s com 250 jogadores no lote, as duas
 * metades da Exp. Share (a bolsa, em `players.items`, e o `held_item_id` do pokémon) saíam de
 * instantes separados por essa janela inteira: equipar dentro dela gravava "a bolsa ainda tem"
 * junto com "o pokémon já segura", e um virava dois no login seguinte. `congelarPokemon`
 * (`db.mjs`) fecha isso — agora o pokémon vira lista de parâmetros nesta mesma fotografia.
 *
 * ### As bandeiras marcam o que falta CAPTURAR, não o que falta gravar
 *
 * O `sujo` era limpo DEPOIS do await, e junto com ele morria em silêncio tudo que tinha mudado
 * durante a gravação — inclusive o `pokemonsSujos.clear()`, que apagava marcações de pokémon
 * que a transação nunca chegou a ver. Agora a limpeza acontece no instante da captura: o
 * conjunto de sujos é TROCADO por um vazio, então qualquer `marcarSujo` que chegue durante a
 * gravação cai no conjunto novo e sobrevive para o ciclo seguinte. Se a transação falhar, as
 * marcas voltam para onde estavam e nada se perde.
 */
async function gravarSujos() {
  const lote = [];
  for (const p of jogadores.values()) if (p.sujo) lote.push(p);
  for (const p of filaFlush) lote.push(p);
  filaFlush.clear();
  if (!lote.length) return;

  // O que foi capturado de cada jogador — guardado para poder DEVOLVER as marcas se a
  // transação falhar. Sem isto, um deadlock (já aconteceu em produção) descartaria em
  // silêncio as mudanças do ciclo.
  const capturado = lote.map((p) => {
    const sujosAntes = p.pokemonsSujos;
    p.pokemonsSujos = new Set();
    p.sujo = false;
    return { p, sujosAntes };
  });

  const payload = capturado.map(({ p, sujosAntes }) => ({
    id: p.dbId,
    level: p.level,
    xp: p.xp,
    gold: p.gold,
    diamonds: p.diamonds,
    huntSlug: p.huntSlug,
    outlandTier: p.outlandTier ?? OUTLAND_TIER_PADRAO,
    noCentro: p.noCentro,
    // por que ele está no Centro: morte (time no chão), visita (veio a pé) ou curado
    centroMotivo: p.centroMotivo ?? null,
    activeId: p.activeId,
    bossPoints: p.bossPoints,
    elo: p.elo,
    pvpAbates: p.pvpAbates,
    pvpMortes: p.pvpMortes,
    pvpCooldownAte: p.pvpCooldownAte,
    vipAte: p.vipAte,
    bless: p.bless,
    gender: p.gender,
    looktype: p.looktype,
    visual: JSON.stringify(p.visual),
    visualOk: p.visualOk,
    tutorialVisto: p.tutorialVisto,
    discordPopCampanha: p.discordPopCampanha ?? 0,
    avisoVisto: p.avisoVisto ?? 0,
    boosts: JSON.stringify(p.boosts),
    boostsHoje: JSON.stringify(p.boostsHoje),
    comprasCooldown: JSON.stringify(p.comprasCooldown),
    passe: JSON.stringify(normalizarPasse(p.passe)),
    ownedOutfits: JSON.stringify(p.ownedOutfits),
    items: JSON.stringify(p.items),
    balls: JSON.stringify(p.balls),
    automation: JSON.stringify(p.automation),
    pokedex: JSON.stringify(normalizarPokedex(p.pokedex)),
    // A ESCALAÇÃO de XP Share (`[pokemonId|null, …]`, um por posto da casa) e o contador
    // vitalício de Fragmentos de Chave. Os dois moram em coluna própria (`xp_share`,
    // `frag_chave_total`) e o `flushJogadores` os lê daqui — sem estas duas linhas eles eram
    // gravados vazios/zerados a cada ciclo, e o jogador reencontrava os postos apagados no F5.
    xpShare: JSON.stringify(xpShareParaGravar(p)),
    // A vitrine da ficha, pelo mesmo caminho do `xp_share` e pelo mesmo motivo: é escolha do
    // jogador, e escolha que some no F5 não é escolha.
    vitrine: JSON.stringify(p.vitrine ?? []),
    fragChaveTotal: Number(p.fragChaveTotal) || 0,
    // O direito de Exp. Share. Vai no MESMO UPDATE que `items`, e é isso que faz a conta
    // fechar: a compra soma o item e o direito na mesma transação, então nunca existe um
    // flush em que o jogador tenha a unidade sem ter o número que a autoriza.
    xpShareTotal: Number(p.xpShareTotal) || 0,
    // Congelados JÁ AQUI, no mesmo instante que `items` — é a correção da fresta. `filter`
    // antes do congelamento porque um pokémon que saiu da memória no meio (escrow do Mercado,
    // venda) não tem mais o que gravar; quem o tirou de lá já persistiu o pendente dele por
    // fora (`db.gravarPokemon`).
    pokemonsSujos: [...sujosAntes]
      .map((id) => p.pokemons.get(id))
      .filter(Boolean)
      .map((k) => db.congelarPokemon(k)),
  }));

  try {
    await db.flushJogadores(payload);
  } catch (err) {
    // Devolve o que foi capturado: as marcas voltam ao conjunto ATUAL (que já pode ter
    // recebido mudanças durante a tentativa), então o ciclo seguinte grava as duas coisas.
    for (const { p, sujosAntes } of capturado) {
      p.sujo = true;
      for (const id of sujosAntes) p.pokemonsSujos.add(id);
    }
    console.error('[sim] flush falhou (tentará de novo no próximo ciclo):', err.message);
  }
}

/**
 * UM flush por vez — quem chama durante um que está gravando espera por ele e pelo seguinte.
 *
 * O `setInterval` de `FLUSH_MS` dispara a cada 5 s tenha o anterior terminado ou não. Quando a
 * gravação passava de 5 s, dois flushes corriam juntos atualizando as MESMAS linhas, e o segundo
 * ficava esperando as travas do primeiro — cada ciclo mais lento que o anterior. Foi isso que, no
 * SIGTERM de 14/09/2026, deixou o flush final dos dois sims (~700 jogadores cada) passar dos 30 s
 * até o systemd matar os processos no meio.
 *
 * Aqui, um pedido durante uma gravação vira UM ciclo seguinte (vários pedidos se juntam nele), e
 * a promessa devolvida só resolve quando esse ciclo termina. É o que mantém o contrato de quem
 * espera a gravação de um jogador específico: `removerJogadorLocal` põe o jogador em `filaFlush`
 * e aguarda — se já havia um flush no meio, o jogador entra no seguinte, e a espera cobre os dois.
 */
let flushEmCurso = null;
let flushSeguinte = null;
function flush() {
  if (!flushEmCurso) {
    flushEmCurso = gravarSujos().finally(() => {
      flushEmCurso = null;
    });
    return flushEmCurso;
  }
  // `.catch` antes do `.then`: um ciclo que estourou não pode deixar o seguinte preso para sempre.
  flushSeguinte ??= flushEmCurso.catch(() => {}).then(() => {
    flushSeguinte = null;
    return flush();
  });
  return flushSeguinte;
}

// --------------------------------------------------------------------- loop

let ultimoTick = 0;
// `noCentro` é quanta gente está na praça do Centro Pokémon. Vai junto das outras porque é a
// única área compartilhada onde a população é o próprio custo (cada passo de um entra no
// pacote de todos), então é o número que explica um pico de banda sem explicação no tick.
export const metricas = { jogadores: 0, tickMs: 0, eventosPorSeg: 0, noCentro: 0 };
let eventosNoSegundo = 0;

/**
 * O tick da PRAÇA do Centro Pokémon — separado, e mais rápido que o do jogo.
 *
 * O tick de 250 ms é o certo para um idle, em que o pokémon anda sozinho e ninguém repara.
 * Aqui o jogador dirige o próprio boneco com o teclado, e 250 ms de espera entre a tecla e o
 * primeiro passo é a diferença entre "responde" e "escorrega". Ver `game/centro.mjs`.
 *
 * Os pacotes daqui não entram no lote do tick principal: quem está na praça não tem combate
 * nem selvagem para juntar na mesma mensagem, então não há o que economizar.
 */
function tickDoCentro() {
  const t = agora();
  let pacotes;
  try {
    pacotes = tickCentro(t);
  } catch (err) {
    return console.error('[sim] tick da praça do Centro falhou:', err.message);
  }
  for (const [key, d] of pacotes) {
    const p = jogadores.get(key);
    if (p) enviar(p, { t: SERVIDOR.CAMPO, ...d });
  }

  // As CASAS andam no mesmo relógio da praça, e pela mesma razão: quem está dentro dirige o
  // próprio boneco com o teclado, e 250 ms entre a tecla e o passo é o que faz um boneco
  // parecer pesado. A varredura é só sobre quem ESTÁ numa casa — `casasAbertas` é um conjunto
  // à parte justamente para este laço não percorrer o servidor inteiro 10× por segundo.
  for (const p of casasAbertas) {
    if (!p.casa) {
      casasAbertas.delete(p);
      continue;
    }
    if (p.desconectadoEm) continue; // congelado na carência de reconexão
    try {
      const d = tickCasa(p.casa, t);
      if (d) enviar(p, { t: SERVIDOR.CAMPO, ...d });
    } catch (err) {
      console.error('[sim] tick da casa falhou:', err.message);
    }
  }

  for (const p of jogadores.values()) {
    if (p.desconectadoEm) continue; // congelado: a automação retoma na reconexão
    if (!p.voltarHuntEm || t < p.voltarHuntEm) continue;
    executarVoltarHuntAutomatico(p);
  }

  // Quedas de conexão que passaram da carência sem reconexão: agora sim grava e remove.
  // Coletado antes de mexer para não deletar de `jogadores` no meio da iteração.
  let expirados = null;
  for (const p of jogadores.values()) {
    if (p.desconectadoEm && t - p.desconectadoEm >= GRACA_DESCONEXAO_MS) {
      (expirados ??= []).push(p);
    }
  }
  if (expirados) for (const p of expirados) finalizarDesconexao(p);
}

/**
 * Quem está DENTRO de uma casa agora.
 *
 * Conjunto próprio, e não um `for` sobre `jogadores` com um `if (p.casa)`: o tick da praça
 * roda 10× por segundo, e varrer 2.000 jogadores para achar os três que estão em casa
 * custaria 20 mil comparações por segundo para não fazer nada. Aqui o laço tem exatamente o
 * tamanho da população que ele precisa mover.
 */
const casasAbertas = new Set();

/**
 * As chaves dos jogadores DESTE shard que estão na fila do PvP ranqueado.
 *
 * Mesma razão de `casasAbertas`: o batimento de vida da fila roda a cada seis segundos e
 * varrer dois mil jogadores para achar os três que estão esperando custaria caro para não
 * fazer nada. Aqui o laço tem o tamanho da fila, não o da população.
 *
 * É um cache, não a verdade — a fila mora no Redis. Uma chave que sobre aqui (o jogador saiu
 * pelo botão noutra aba, por exemplo) só faz o batimento não encontrar a entrada e desistir.
 */
const naFilaPvp = new Set();
let ultimaBatidaFila = 0;

/** Chaves com reentrada automática agendada. Ver `reentrarNaFilaAuto`. */
const filaAutoPendente = new Set();

/**
 * Põe de volta na fila quem tem a fila automática ligada.
 *
 * Uma recusa por ESPERA é normal e não desliga nada — só reagenda, porque a única coisa que
 * mudou é que ainda faltavam alguns segundos. Qualquer outra recusa (equipe vazia, nível,
 * banco fora do ar) DESLIGA a automação e avisa: repetir uma tentativa que já falhou a cada
 * vinte segundos viraria um toast por minuto, para sempre, sem consertar nada.
 */
function reentrarNaFilaAuto(p) {
  entrarNaFila(
    { key: p.key, nick: p.nick, dbId: p.dbId, nivel: p.level, gatewayId: p.gatewayId, ip: p.ip },
    agora(),
  )
    .then(async (r) => {
      if (r.ok) {
        naFilaPvp.add(p.key);
        enviar(p, {
          t: SERVIDOR.PVP,
          fila: { na: true, desde: r.entrada.desde, tamanho: await tamanhoDaFila(), cooldownMs: 0 },
          filaAuto: true,
        });
        return;
      }
      if (r.motivo === 'cooldown') {
        p.pvpAutoFilaEm = agora() + Math.max(1000, r.restaMs ?? 1000);
        filaAutoPendente.add(p.key);
        return;
      }
      p.automation.pvpAutoFila = false;
      marcarSujo(p);
      enviar(p, { t: SERVIDOR.PVP, filaRecusa: r, filaAutoDesligada: true });
    })
    .catch((err) => console.error('[sim] reentrada automática na fila falhou:', err.message));
}

function tick() {
  const t0 = performance.now();
  const t = agora();

  // As ARENAS PvP andam ANTES dos jogadores, e uma vez cada — não uma vez por participante.
  // O campo lá é compartilhado, então quem simula é a arena; `processar` pula quem está
  // dentro. O retorno é o pacote de campo já pronto por participante, que entra no mesmo
  // lote do resto (batalha + estado) lá embaixo.
  let camposPvp;
  try {
    camposPvp = tickArenas(t, jogadores);
  } catch (err) {
    console.error('[sim] tick das arenas PvP falhou:', err.message);
    camposPvp = new Map();
  }

  // A Guerra de Guilds não tem tick: ela roda de uma vez só, no processo que reivindicar o
  // dia, e o resultado sai gravado. Aqui é só o despertador.
  if (t - ultimoCheckGuild > (new Date(t).getUTCHours() === HORA_PVP_GUILD_UTC ? 15_000 : 60_000)) {
    ultimoCheckGuild = t;
    verificarEventoGuild(t).catch((err) =>
      console.error('[sim] evento guild falhou:', err.message),
    );
  }

  // O fechamento da Temporada Global não tem hora fixa (não é show ao vivo, só paga e zera) —
  // um minuto de atraso pra perceber que o mês virou é invisível, então usa o mesmo throttle
  // grosso do resto dos despertadores do tick.
  if (t - ultimoCheckGuildGlobal > 60_000) {
    ultimoCheckGuildGlobal = t;
    verificarTemporadaGuild(t).catch((err) =>
      console.error('[sim] temporada global de guild falhou:', err.message),
    );
  }

  // A TEMPORADA DO PvP: toda segunda-feira, 00:00 de Brasília, a tabela vira prêmio e a escada
  // zera. Mesmo throttle grosso do fechamento de guild, e pela mesma razão — não é show ao vivo,
  // e um minuto para perceber que a semana mudou é invisível. Quem trava contra dois shards
  // virando a mesma semana é o BANCO (ver `virarTemporada`), não este `if`.
  if (t - ultimoCheckPvpTemporada > 60_000) {
    ultimoCheckPvpTemporada = t;
    verificarTemporadaPvp(t).catch((err) =>
      console.error('[sim] virada da temporada de PvP falhou:', err.message),
    );
  }

  // A QUEDA POR INATIVIDADE: um dia sem ranqueada com pontos de elite derruba para o topo do
  // Diamante. Throttle curto, ao contrário da virada, porque aqui a tela mostra um relógio até a
  // queda — e o número tem de descer quando ele zera. A consulta é barata (a elite é o começo do
  // índice de pontos), e só o processo da arena a faz.
  if (souOPareador() && t - ultimoCheckPvpDecaimento > 15_000) {
    ultimoCheckPvpDecaimento = t;
    verificarDecaimentoPvp()
      .then((caidos) => {
        for (const c of caidos) {
          avisarRankMudou(String(c.nick).toLowerCase(), { decaiu: { antes: c.antes, pontos: c.pontos } });
        }
      })
      .catch((err) => console.error('[sim] decaimento do PvP falhou:', err.message));
  }

  // O ROLO DO TRACKER: as partidas novas viram soma nas tabelas de agregado que a página
  // `/tracker` lê (ver `tracker-db.mjs`). Um processo só, o mesmo do pareamento — dois rolos
  // andando sobre o mesmo cursor somariam a mesma partida duas vezes.
  //
  // Meio minuto entre passadas, e não a cada tick: o Tracker é uma tela de análise, não um
  // placar ao vivo, e a própria margem do rolo já é de um minuto. A trava de reentrada existe
  // porque a passada é I/O puro — um banco lento não pode deixar duas empilhadas.
  if (souOPareador() && !roloTrackerRodando && t - ultimoRoloTracker > 30_000) {
    ultimoRoloTracker = t;
    roloTrackerRodando = true;
    trackerDb
      .rolar({ especies })
      .catch((err) => console.error('[tracker] rolo falhou:', err.message))
      .finally(() => { roloTrackerRodando = false; });
  }

  // OS CAMPEONATOS: passou o prazo das inscrições de algum, as seeds dele congelam e a chave
  // passa a existir. `verificarCampeonatos` percorre os que estão vivos AGORA — com Mundial e
  // Amador todo mês, são até três ao mesmo tempo (um jogando, um inscrevendo, um por abrir).
  //
  // Mesmo throttle grosso da temporada — um minuto de atraso no fechamento não aparece para
  // ninguém, e quem grava de fato é um shard só (o banco decide, ver `congelarChave`).
  if (t - ultimoCheckCampeonato > 60_000) {
    ultimoCheckCampeonato = t;
    verificarCampeonatos(t).catch((err) =>
      console.error('[sim] congelamento da chave do campeonato falhou:', err.message),
    );
    // A faxina das fitas vencidas pega carona no mesmo minuto, e ela mesma se segura por uma
    // hora (`FAXINA_MS`) — a janela de replay vence uma vez por mês.
    faxinarReplays(t).catch((err) =>
      console.error('[sim] faxina das fitas do campeonato falhou:', err.message),
    );
  }
  // As PARTIDAS dos campeonatos: de dez em dez segundos o processo de tarefas de mundo pergunta
  // se a próxima onda já venceu — em cada campeonato que já esteja lutando. Um processo só simula
  // (é o mesmo do pareamento do ranqueado), e a onda ainda é reclamada no banco: dois processos
  // nunca jogam a mesma.
  if (config.shardId === config.arenaShardId && t - ultimaOndaCampeonato > 10_000) {
    ultimaOndaCampeonato = t;
    avancarCampeonatos(t).catch((err) =>
      console.error('[sim] onda do campeonato falhou:', err.message),
    );
  }

  // Os GINÁSIOS: um shard reapura o pódio dos 18 e grava os líderes, os outros só releem as
  // 18 linhas. O próprio `verificarGinasios` segura o intervalo e a reentrada.
  verificarGinasios(t).catch((err) =>
    console.error('[sim] apuração dos ginásios falhou:', err.message),
  );

  // FILA DO PvP RANQUEADO — duas tarefas que todo shard tem, e uma que é de um só.
  //
  // O batimento é de TODO shard: a entrada na fila é do jogador, e quem sabe que ele ainda
  // está no ar é o processo que tem o socket dele. Sem isso, um shard que morresse deixaria
  // os jogadores dele casáveis na fila por minutos — e o oponente receberia o replay de uma
  // partida contra alguém que não está mais lá.
  if (naFilaPvp.size && t - ultimaBatidaFila > FILA_BATIDA_MS) {
    ultimaBatidaFila = t;
    baterPontoNaFila([...naFilaPvp], t).catch((err) =>
      console.error('[sim] batimento da fila PvP falhou:', err.message),
    );
  }
  // FILA AUTOMÁTICA: quem tem a opção ligada volta para a fila sozinho depois de cada
  // partida. O laço é sobre `filaAutoPendente`, e não sobre `jogadores`, pelo mesmo motivo
  // de `naFilaPvp` — ele tem o tamanho de quem está esperando, não o da população.
  if (filaAutoPendente.size) {
    for (const key of [...filaAutoPendente]) {
      const alvo = jogadores.get(key);
      if (!alvo || !alvo.pvpAutoFilaEm || alvo.desconectadoEm) {
        filaAutoPendente.delete(key);
        continue;
      }
      if (t < alvo.pvpAutoFilaEm) continue;
      filaAutoPendente.delete(key);
      alvo.pvpAutoFilaEm = 0;
      reentrarNaFilaAuto(alvo);
    }
  }

  // O PAREAMENTO é de um shard só (`souOPareador`): dois processos lendo a mesma fila
  // casariam o mesmo jogador duas vezes. O próprio `rodarMatchmaking` segura o intervalo e a
  // reentrada, então chamar a cada tick é de graça nos outros.
  rodarMatchmaking(t).catch((err) =>
    console.error('[sim] matchmaking do PvP falhou:', err.message),
  );

  for (const p of jogadores.values()) {
    // Em carência de reconexão: continua na memória (para a volta ser transparente), mas
    // não há socket para receber nada. Não simula, não serializa, não publica — só não
    // deixa os eventos acumularem. Ver `GRACA_DESCONEXAO_MS`.
    if (p.desconectadoEm) {
      if (p.eventos.length) p.eventos = [];
      continue;
    }

    try {
      processar(p, t);
    } catch (err) {
      console.error(`[sim] tick do jogador ${p.id} falhou:`, err.message);
    }

    // Um jogador em combate tem três coisas a dizer no mesmo tick — golpes, posições e
    // estado. Vão num registro só, e os registros de todos os jogadores de um mesmo gateway
    // saem num publish só no fim da volta (`enviarAoGateway`, ver `saida-crua.mjs`).
    const lote = [];
    if (p.eventos.length) {
      lote.push({ t: SERVIDOR.BATALHA, ev: p.eventos });
      eventosNoSegundo += p.eventos.length;
      p.eventos = [];
    }
    // Delta do campo: quem começou um passo novo, mudou de HP ou saiu. Numa hunt parada
    // (ninguém andando) isto não manda nada. Na arena o delta veio pronto do `tickArenas`.
    //
    // No Modo Economia nem se calcula: a serialização é o custo, e o destino é o lixo. O que
    // ficou por dizer sai inteiro no `campo.init` que `reenviarCena` manda ao desligar o modo.
    if (!p.semCampo) {
      const dPvp = camposPvp.get(p.key);
      if (dPvp) lote.push({ t: SERVIDOR.CAMPO, ...dPvp });
      else if (p.campo) {
        const d = deltaCampo(p.campo, t);
        if (d) lote.push({ t: SERVIDOR.CAMPO, ...d });
      }
    }
    // estado no máximo 2×/s, e só quando algo mudou. A bandeira é a de TELA
    // (`aSincronizar`), não a do banco — o flush limpa aquela e engoliria o envio.
    //
    // O QUE vai mudou (delta em vez do quadro inteiro, ver `estadoParaEnviar`); QUANDO vai é
    // exatamente o mesmo de antes. A bandeira é limpa mesmo quando o delta sai vazio: ela diz
    // "alguém pediu sincronia", e a resposta honesta a um pedido cujo conteúdo não mudou é não
    // mandar nada — deixá-la ligada faria o tick recalcular o delta 4×/s para sempre.
    if (p.welcomeEnviado && p.aSincronizar && t - p.ultimoEstadoEnviado > 500) {
      p.ultimoEstadoEnviado = t;
      p.aSincronizar = false;
      const estado = estadoParaEnviar(p);
      if (estado) lote.push({ t: SERVIDOR.ESTADO, estado });
    }
    if (lote.length) enviarAoGateway(p.gatewayId, p.key, lote);
  }

  // Caixas postais: fora do laço acima e sem `await` no caminho do tick — são uma consulta
  // por minuto (mercado) e uma a cada 15 s (diamantes), e o tick não espera banco por princípio.
  varrerPagamentos(t).catch((err) => console.error('[market] varredura:', err.message));
  varrerDiamantes(t).catch((err) => console.error('[diamantes] varredura:', err.message));

  metricas.jogadores = jogadores.size;
  metricas.noCentro = quantosNoCentro();
  metricas.tickMs = +(performance.now() - t0).toFixed(2);
  ultimoTick = t;

  // Sempre por último: a essa altura toda a lógica síncrona do tick (arenas, jogadores,
  // eventos) já rodou, então é seguro tirar da memória quem saiu da Arena PvP migrado.
  drenarRetornosDaArena();
}

export async function iniciarSim() {
  const posse = await tomarPosseDoShard(config.shardId, config.instanceId);
  if (!posse.ok) {
    console.error(
      `[sim] shard ${config.shardId} JÁ TEM DONO (${posse.dono}). ` +
        `Dois processos no mesmo shard processariam os mesmos jogadores em duplicidade. Encerrando.\n` +
        `        (se o processo anterior foi morto à força, a trava expira em 15s — ou rode: npm stop)`,
    );
    process.exit(1);
  }
  liberarPosse = posse.liberar;

  registrarArenasBosses(grades);

  await db.aguardarBanco();
  // Daqui até os recálculos de poder, um sim por vez no cluster — ver `db.travarMigracoes`. Não há
  // `finally`: se algo estourar no meio, o processo morre e o Postgres solta a trava com a conexão.
  const soltarMigracoes = await db.travarMigracoes(`sim ${config.shardId}`);
  await db.migrar();
  // A virada do auto-cuidado: revive, poção e volta à hunt LIGADOS em quem já joga, uma vez só.
  // Conta nova já nasce assim (ver `carregarJogador`); esta linha alcança as que não nasceram.
  // As listas saem do catálogo, e não escritas à mão — item novo de cura entra no padrão sozinho.
  await db.ligarAutoCuidadoDeTodos({
    potionIds: idsPadraoDeCuidado('heal'),
    reviveIds: idsPadraoDeCuidado('revive'),
  });
  // O ledger de ORBs tem tabelas próprias (movimentos, depósitos, saques). Migra junto para
  // que um banco que já existia ganhe as tabelas sem passo manual.
  await odb.migrar();
  // As Caixas de Fundador. ANTES do mercado de propósito: as varreduras de devolução logo
  // abaixo soltam o escrow de caixa (`soltarCaixasDeAnuncios`), e elas não podem ser as
  // primeiras a tocar numa tabela que ainda não existe.
  await cxdb.migrar();
  await atualizarVendidasCaixas();
  console.log(
    `[caixas] venda ${vendaAberta() ? 'ABERTA' : `abre em ${new Date(CAIXAS_ABREM).toISOString()}`}`,
  );
  // Mercado Global: anúncios, caixa postal e a coluna de escrow em `player_pokemon`.
  await mdb.migrar();
  // As CASAS numeradas. Depois do mercado (a virada mexe em `market_anuncios`) e ANTES das
  // varreduras de devolução logo abaixo: elas soltam o escrow de casa, e um anúncio de casa ainda
  // no formato de quantidade voltaria como item em vez de casa.
  await casasDb.migrar();
  // As BICICLETAS numeradas, pelo mesmo motivo e na mesma posição: a virada mexe em anúncios, e as
  // varreduras logo abaixo soltam o escrow de bicicleta.
  await bicicletasDb.migrar();
  await recalcularNotasSeFormulaMudou();
  // As DEVOLUÇÕES DE BOOT: anúncios que uma regra nova não aceita mais voltam aos donos.
  //
  // "Ninguém está conectado ainda" só vale para ESTE processo — com o restart um sim de cada vez,
  // os outros nove estão cheios. Por isso nenhuma delas escreve na bolsa: fecham o anúncio com a
  // devolução pendente (`fecharParaDevolucao`), e o sim de cada dono entrega na memória
  // (`avisarDonosDeDevolucao` agora, a varredura ou o login depois).
  //
  // A vitrine deixou de aceitar drop de pokémon (ver `ITENS_MERCADO`): o que agora é proibido
  // é cancelado com o item de volta ao dono.
  await mdb
    .devolverAnunciosProibidos([...IDS_MERCADO_PERMITIDOS])
    .then((lista) => {
      if (!lista.length) return;
      avisarDonosDeDevolucao(lista);
      const unidades = lista.reduce((s, a) => s + a.qtd, 0);
      console.log(`[market] ${lista.length} anúncio(s) fora da curadoria cancelados · ` +
        `${unidades} item(ns) devolvidos aos donos`);
    })
    .catch((err) => console.error('[market] devolução dos anúncios proibidos falhou:', err.message));
  // E o outro lado da mesma virada de regra: pokémon anunciado ANTES da pensão da feira volta
  // ao Depot do dono. Quem quiser vender reanuncia pagando a diária, como todo anúncio novo.
  // O critério (`dias IS NULL`) só casa com anúncio legado, então isto pode rodar em todo boot.
  await mdb
    .devolverPokemonSemPensao()
    .then((lista) => {
      if (!lista.length) return;
      avisarDonosDeDevolucao(lista);
      const donos = new Set(lista.map((a) => a.vendedorId)).size;
      console.log(`[market] ${lista.length} pokémon anunciado(s) sem pensão devolvido(s) ` +
        `ao Depot de ${donos} jogador(es)`);
    })
    .catch((err) => console.error('[market] devolução dos pokémon sem pensão falhou:', err.message));
  // Anúncios de pokémon abaixo da faixa mínima (nível + nota recalculada) voltam ao dono, e
  // entram na COLEÇÃO dele — fora da venda ao NPC, porque quem desfez o anúncio foi o servidor.
  await mdb
    .devolverPokemonAbaixoDoMinimo()
    .then((lista) => {
      if (!lista.length) return;
      avisarDonosDeDevolucao(lista);
      const donos = new Set(lista.map((a) => a.vendedorId)).size;
      console.log(`[market] ${lista.length} pokémon abaixo do mínimo da vitrine devolvido(s) ` +
        `à Coleção de ${donos} jogador(es)`);
    })
    .catch((err) => console.error('[market] devolução pokémon abaixo do mínimo falhou:', err.message));
  // Anúncios em ORB abaixo do mínimo (ex.: 1 Gema → vendedor receberia 0 após taxa).
  await mdb
    .devolverAnunciosPrecoOrbInvalido()
    .then((lista) => {
      if (!lista.length) return;
      avisarDonosDeDevolucao(lista);
      const itens = lista.filter((a) => a.tipo === 'item').length;
      const pokes = lista.filter((a) => a.tipo === 'pokemon').length;
      console.log(
        `[market] ${lista.length} anúncio(s) abaixo do mínimo em Gemas cancelados · ` +
          `${itens} item(ns) · ${pokes} pokémon(s) devolvidos`,
      );
    })
    .catch((err) => console.error('[market] devolução preço ORB inválido falhou:', err.message));
  // Anúncios em Coins abaixo do mínimo (ex.: 1 Coin → vendedor receberia 0 após taxa).
  await mdb
    .devolverAnunciosPrecoGoldInvalido()
    .then((lista) => {
      if (!lista.length) return;
      avisarDonosDeDevolucao(lista);
      const itens = lista.filter((a) => a.tipo === 'item').length;
      const pokes = lista.filter((a) => a.tipo === 'pokemon').length;
      console.log(
        `[market] ${lista.length} anúncio(s) abaixo do mínimo em Coins cancelados · ` +
          `${itens} item(ns) · ${pokes} pokémon(s) devolvidos`,
      );
    })
    .catch((err) => console.error('[market] devolução preço Coins inválido falhou:', err.message));
  // O índice parcial do registro de shinys (a lista da Pokédex).
  await sdb.migrar();
  await p5db.migrar();
  // Eventos globais: a tabela e o que ainda estiver valendo. Ler AQUI, no boot, é o que faz
  // um restart no meio de um evento de 6 horas voltar com o buff de pé — o Redis carrega o
  // aviso da mudança, mas quem guarda é o banco.
  await edb.migrar();
  await edb
    .eventoVigente()
    .then((ev) => {
      if (definirEvento(ev)) {
        console.log(`[evento] buff ativo até ${new Date(ev.terminaEm).toLocaleString('pt-BR')} ` +
          `(treinador +${ev.xpTreinadorPct}% · pokémon +${ev.xpPokemonPct}% · farm +${ev.farmPct}%)`);
      }
    })
    .catch((err) => console.error('[evento] leitura no boot falhou:', err.message));
  // Endereços de depósito por jogador. Migra no SIM (e não só no watcher) porque é a tela
  // de depósito que cria a linha — e ela abre em qualquer processo, com ou sem watcher.
  await enderecosOrb.migrar();
  // Afiliados migra no gateway TAMBÉM, mas precisa migrar aqui: quem chama `comissaoOrb` é o
  // watcher de depósito, e ele é hospedado por ESTE processo. Num `ROLE=all` o sim sobe antes
  // do gateway, e num deploy o gateway reinicia primeiro — nas duas janelas o watcher leria
  // `taxa_gema` numa tabela que ainda não a tem. É o mesmo motivo de `eventos-db` e
  // `online-extra-db` migrarem em dois lugares; os ALTER são idempotentes.
  await adb.migrar();
  await gdb.migrar();
  await amigosDb.migrar();
  await chatDb.migrar();
  await gindb.migrar();
  await campdb.migrar();
  // Os convites do Discord. O BOT (`src/bot/`) escreve nestas tabelas; o jogo só resgata — mas
  // a migração roda aqui porque num servidor sem bot configurado o `/resgatar` ainda tem de
  // responder "código inválido" em vez de estourar numa tabela que não existe.
  await convdb.migrar();
  // PvP ranqueado: a linha de rank, a equipe salva e o histórico. Fora do write-behind — ver
  // o cabeçalho de `pvp-ranqueado-db.mjs`.
  //
  // Quando a escada é zerada (mudança de fórmula, uma vez na vida do banco), a memória de
  // encontros do Redis vai junto: metade do reset mora lá.
  const { escadaZerada } = await pvpdb.migrar();
  if (escadaZerada) {
    const n = await limparMemoriaDeEncontros();
    if (n) console.log(`[pvp] ${n} marca(s) de encontro/revanche apagadas junto com a escada`);
  }
  // Os agregados do Tracker. DEPOIS do PvP porque duas delas apontam para `players` e a leitura
  // do rolo é sobre `pvp_partidas` — migrar antes funcionaria, mas deixaria a ordem mentindo
  // sobre a dependência.
  await trackerDb.migrar();
  // Os títulos de ginásio entram em memória ANTES do primeiro tick: sem isto, o primeiro
  // minuto do processo tiraria o +25% de quem o tem — e o jogador veria o próprio dano cair
  // sozinho depois de um restart.
  await recarregarLideres().catch((err) =>
    console.error('[sim] leitura dos líderes de ginásio falhou:', err.message),
  );
  const { migrar: migrarAudit } = await import('./audit-db.mjs');
  await migrarAudit();
  await gdb.atualizarBonusRanking();
  // A ordem importa: a potência muda os stats, e é ela quem regrava o `power` de quem passou
  // pela roleta. O `preencherPoderes` depois só pega o que sobrou com `power = 0`.
  await preencherPotencias();
  await preencherPoderes();
  await recalcularPoderesSeFormulaMudou();
  await soltarMigracoes();

  // A arena PvP precisa mexer no estado do jogador (XP, ELO, ida ao Centro) sem importar
  // sim.mjs de volta — os ganchos são a única direção do import.
  ligarGanchos({
    evento,
    enviar,
    marcarSujo,
    ativo,
    irParaOCentro,
    consumirBless,
    podeUsarPokemon,
    atualizarPosicaoPvp: refrescarPosicaoPvp,
    // Único ponto de saída da arena — é daqui que se sabe se o jogador veio migrado de outro
    // shard e precisa voltar. Ver o comentário de `filaRetornoArena`.
    aposSairDaArena: (p, motivo) => {
      if (p.pvpHomeShard == null || p.pvpHomeShard === config.shardId) return;
      filaRetornoArena.set(p.key, { p, motivo });
    },
  });
  // A Guerra de Guilds só precisa falar com quem está online DEPOIS de terminar: avisar o
  // resultado e recarregar o bônus de ranking, que acabou de mudar para todas as guilds.
  ligarGanchosG({
    evento,
    jogadores,
    recarregarGuild: (p) =>
      carregarGuild(p)
        .then(() => {
          p.aSincronizar = true;
          enviar(p, { t: SERVIDOR.GUILD, guild: p.guild });
        })
        .catch(() => {}),
  });
  // O fechamento da Temporada Global só precisa achar quem está online para atualizar o cache
  // de diamante da tela — o crédito de verdade já foi escrito no banco antes disto rodar.
  ligarGanchosGlobal({ evento, jogadores });

  await assinar(canalSim(config.shardId), async (msg) => {
    try {
      // Jogador em visita na Arena PvP de outro shard: TODA mensagem dele — login, logout,
      // clique — vai para lá, porque é quem tem ele em memória agora. As duas mensagens que
      // fecham essa migração tratam da migração em si e por isso não entram neste desvio.
      if (msg.t !== 'pvp.retornouDoRemoto' && msg.t !== 'pvp.limparEmigrado') {
        const destino = jogadoresEmigrados.get(msg.playerId);
        if (destino != null) return publicar(canalSim(destino), msg);
      }

      // ------------------------------------------------ pacote que veio do JOGADOR
      //
      // O gateway repassa o que o cliente mandou com `doCliente: true` carimbado depois do
      // spread. Esse pacote só alcança `comandos` — nada do que vem abaixo. `entrar` (com `nick`
      // e `admin`), `admin.*`, a migração da Arena PvP e `amigos.sync` são mensagens do
      // SERVIDOR: aceitá-las do socket dava ouro e itens a quem mandasse o pacote na mão, e
      // `admin.ban` seguido de `entrar` com o nick de outra pessoa entregava a conta dela.
      // `Object.hasOwn` para que `__proto__`/`constructor` não virem "comando".
      if (msg.doCliente === true) {
        const p = jogadores.get(msg.playerId);
        if (!p) return;
        // O gateway só encaminha comando se o socket está vivo. Se o sim ficou congelado na
        // carência (`sair` atrasado, queda fantasma) mas o cliente ainda manda clique, retoma.
        if (p.desconectadoEm) p.desconectadoEm = 0;
        const fn = Object.hasOwn(comandos, msg.t) ? comandos[msg.t] : null;
        if (typeof fn === 'function') fn(p, msg);
        return;
      }

      if (msg.t === 'entrar') return await entrar(msg);
      if (msg.t === 'sair') return sair(msg);

      // ---------------------------------------------------- migração da Arena PvP
      //
      // Chegou de outro shard querendo entrar: carrega do zero (mesmo caminho de um login) e,
      // na sequência, tenta de fato entrar — se a arena tiver lotado nesse meio-tempo,
      // `efetivarEntradaNaArena` já cuida de mandar de volta.
      // O rank mudou noutro processo (o pareador do PvP). Relê a linha e marca a tela suja —
      // o emblema da ficha do treinador acompanha a partida que acabou de acontecer.
      if (msg.t === 'pvp.rank.mudou') {
        const alvo = jogadores.get(msg.playerId);
        if (alvo?.dbId) {
          pvpdb.rankDe(alvo.dbId)
            .then((linha) => {
              if (!linha || jogadores.get(msg.playerId) !== alvo) return;
              alvo.pvpRank = linha;
              marcarSujo(alvo);
              // QUEDA POR INATIVIDADE: não houve partida, então nada de fila automática. A tela
              // é avisada direto porque ela não relê o rank do snapshot (ver `aoReceberPvp` no
              // app.js) — sem o pacote, o cartão seguiria dizendo Challenger com o relógio em zero.
              if (msg.decaiu) {
                carregarPosicaoPvp(alvo)
                  .catch(() => {})
                  .then(() => {
                    if (jogadores.get(msg.playerId) !== alvo) return;
                    alvo.aSincronizar = true;
                    enviar(alvo, {
                      t: SERVIDOR.PVP,
                      rank: pvpdb.rankParaCliente(linha, alvo.pvpPosicao, { comPrazo: true }),
                      decaiu: { antes: Number(msg.decaiu.antes) || 0, pontos: Number(msg.decaiu.pontos) || 0 },
                    });
                  });
                return;
              }
              // FILA AUTOMÁTICA: a partida acabou, então a próxima entra sozinha assim que a
              // espera obrigatória passar. O carimbo (e não um `setTimeout`) porque o tick já
              // varre isto, e um timer pendurado sobreviveria a um logout.
              if (alvo.automation?.pvpAutoFila && vipAtivo(alvo, agora())) {
                alvo.pvpAutoFilaEm = agora() + PVP_ENTRE_PARTIDAS_MS + 1500;
                filaAutoPendente.add(alvo.key);
              }
              // A posição na tabela também pode ter mudado, e com ela a VAGA de Mestre ou
              // Challenger — sem isto, entrar no top 20 numa partida só valeria no próximo
              // login, e o emblema ficaria mentindo até lá.
              refrescarPosicaoPvp(alvo);
            })
            .catch((err) => console.error('[pvp] releitura do rank falhou:', err.message));
        }
        return;
      }

      if (msg.t === 'pvp.entrarRemoto') {
        await entrar(msg);
        const p = jogadores.get(msg.playerId);
        if (p) efetivarEntradaNaArena(p, msg.arenaId, msg.homeShard);
        return;
      }

      // Voltou de uma visita (saiu, morreu, ou a entrada lá falhou): recarrega do Postgres —
      // o mesmo caminho de uma reconexão — e retoma a simulação normal aqui.
      if (msg.t === 'pvp.retornouDoRemoto') {
        jogadoresEmigrados.delete(msg.playerId);
        return await entrar(msg);
      }

      // O shard da arena avisa que um visitante desconectou de lá (ele já cuidou da própria
      // limpeza) — aqui só se apaga o rastro, para não encaminhar mensagem para quem já saiu.
      if (msg.t === 'pvp.limparEmigrado') {
        jogadoresEmigrados.delete(msg.playerId);
        return;
      }

      if (msg.t === 'admin.ban') {
        const alvo = jogadores.get(msg.playerId);
        if (alvo) {
          punirAbandonoDaLuta(alvo);
          if (alvo.centro) deixarOCentro(alvo);
          filaFlush.delete(alvo);
          flushPendente.delete(msg.playerId);
          jogadores.delete(msg.playerId);
        }
        return;
      }

      // Um sim (este ou outro) fechou um anúncio deste jogador — vencido, ou devolvido no boot.
      // Antes do bloco genérico lá embaixo, que tira da carência quem recebe mensagem: isto não é
      // o jogador voltando.
      if (msg.t === 'market.devolver') {
        const alvo = jogadores.get(msg.playerId);
        if (alvo?.dbId) entregarDevolucoes(alvo);
        return;
      }

      // O shard dono de um amigo avisa que o grafo dele mudou (pedido recebido/aceito,
      // amizade desfeita). Se ele está aqui em memória, recarrega a lista e empurra — mais
      // um toast opcional. É o gêmeo cross-shard de `avisarConvitesOnline`.
      if (msg.t === 'amigos.sync') {
        for (const j of jogadores.values()) {
          if (j.nick?.toLowerCase() !== msg.alvoNick) continue;
          if (msg.coletarCoins) {
            await entregarCoinsDeAmigos(j).catch((err) =>
              console.error('[amigos] coleta cross-shard:', err.message));
          }
          await carregarAmigos(j);
          j.aSincronizar = true;
          enviar(j, { t: SERVIDOR.AMIGOS, lista: j.amigos, pedidos: j.amigosPedidos });
          if (msg.aviso?.k) evento(j, msg.aviso);
        }
        return;
      }
      const p = jogadores.get(msg.playerId);
      if (!p) return;
      // O gateway só encaminha comando se o socket está vivo. Se o sim ficou congelado na
      // carência (`sair` atrasado, queda fantasma) mas o cliente ainda manda clique, retoma.
      if (p.desconectadoEm && msg.t !== 'entrar' && msg.t !== 'sair') {
        p.desconectadoEm = 0;
      }
      if (msg.t === 'admin.diamantes') {
        p.diamonds = msg.saldo;
        marcarSujo(p);
        evento(p, { k: 'diamantesCreditados', qtd: msg.qtd, centavos: 0, metodo: 'admin' });
        return;
      }
      // A gema chegou por fora do jogo (hoje: a faxina de multi-conta do painel). Só troca o
      // cache e reenvia o estado — sem toast, ao contrário do diamante: quem recebe é a conta
      // principal de quem tomou o ban, e anunciar "você ganhou gemas" numa tela que não pediu
      // nada seria a mensagem errada. O número novo aparece na carteira, que é o que importa.
      if (msg.t === 'admin.gemas') {
        p.orbs = Number(msg.saldo);
        marcarSujo(p);
        enviarEstado(p);
        return;
      }
      if (msg.t === 'admin.gold') {
        p.gold = Number(msg.gold);
        marcarSujo(p);
        enviarEstado(p);
        return;
      }
      if (msg.t === 'admin.items') {
        for (const [id, qtd] of Object.entries(msg.items ?? {})) {
          const itemId = Number(id);
          const n = Math.floor(Number(qtd));
          if (!itemId || !n) continue;
          const novo = (p.items[itemId] ?? 0) + n;
          if (novo <= 0) delete p.items[itemId];
          else p.items[itemId] = novo;
        }
        marcarSujo(p);
        // Casa dada pelo painel chega como item; `carregarCasas` a numera na hora, em vez de ela
        // esperar na bolsa até o próximo login.
        if (casasNaBolsa(p.items).length) {
          carregarCasas(p)
            .then(() => enviarEstado(p))
            .catch((err) => console.error('[casas] admin.items:', err.message));
        }
        // A bicicleta dada pelo painel (ou pelo `dar-itens`) também chega como item e é numerada já.
        if (bicicletasNaBolsa(p.items).length) {
          carregarBicicletas(p)
            .then(() => enviarEstado(p))
            .catch((err) => console.error('[bicicletas] admin.items:', err.message));
        }
        enviarEstado(p);
        return;
      }
      const fn = comandos[msg.t];
      if (fn) fn(p, msg);
    } catch (err) {
      console.error('[sim] comando falhou:', err.message);
    }
  });

  // O buff de evento, ligado (ou cortado) pelo painel admin. Chega em TODO sim — o buff é do
  // mundo, não de um shard —, e o único trabalho aqui é trocar a cópia em memória e marcar
  // todo mundo para sincronizar: a faixa piscando na tela sai no snapshot seguinte, meio
  // segundo depois, pelo caminho que já existia.
  await assinar(CANAL_EVENTO, (msg) => {
    const ev = definirEvento(msg?.evento ?? null);
    console.log(ev
      ? `[evento] buff ligado: treinador +${ev.xpTreinadorPct}% · pokémon +${ev.xpPokemonPct}% · ` +
        `farm +${ev.farmPct}% por ${ev.minutos} min`
      : '[evento] buff encerrado');
    for (const p of jogadores.values()) {
      p.aSincronizar = true;
      evento(p, { k: 'evento', evento: eventoParaCliente() });
    }
  });

  // Guild apagada pela moderação. Chega em TODO sim porque os membros estão espalhados pelos
  // shards; cada um trata só os seus. Sem isto, quem estivesse online continuaria com o painel
  // da guild aberto e com o bônus dela somando no farm até reconectar.
  await assinar(CANAL_GUILD, async (msg) => {
    const guildId = Number(msg?.apagada) || 0;
    if (!guildId) return;
    let afetados = 0;
    for (const p of jogadores.values()) {
      if (p.guild?.id !== guildId) continue;
      afetados++;
      p.guild = null;
      p.guildBonusPct = 0;
      p.guildBonusRank = 0;
      marcarSujo(p);
      enviar(p, { t: SERVIDOR.GUILD, guild: null });
      evento(p, { k: 'guildApagada' });
    }
    if (afetados) console.log(`[guild] guild #${guildId} apagada pela moderação — ${afetados} membro(s) online avisados`);
  });

  // O worker de SAQUE. Fica atrás de uma trava de posse porque dois processos assinando o
  // mesmo saque é a forma mais fácil que existe de pagar duas vezes — a mesma razão da trava
  // de shard, com consequência bem pior.
  if (config.orbsWorker) {
    const { criarChain } = await import('./chain.mjs');
    const { iniciarWorker } = await import('./orbs-worker.mjs');
    const { iniciarWatcher } = await import('./orbs-watcher.mjs');

    // Configuração de blockchain incompleta NÃO derruba o jogo. Só a ponte de dinheiro
    // fica desligada, e com um aviso que dá para ver de longe: um mint faltando não é
    // motivo para tirar todo mundo do ar. O contrário — subir calado na rede simulada
    // achando que está na de verdade — seria bem pior.
    let chain = null;
    try {
      chain = criarChain();
    } catch (err) {
      console.error(
        `\n[orbs] ================================================================\n` +
          `[orbs] PONTE DE DINHEIRO DESLIGADA: ${err.message}\n` +
          `[orbs] Depósito e saque não funcionam até isto ser resolvido.\n` +
          `[orbs] O resto do jogo sobe normalmente.\n` +
          `[orbs] ================================================================\n`,
      );
    }
    if (chain) {
      workerDeSaque = iniciarWorker(chain, {
        tomarPosse: () => tomarPosseDoShard('orbs-worker', config.instanceId),
      });
      await workerDeSaque.iniciar();

      // O watcher de DEPÓSITO, a ponte oposta. Vem junto do worker de propósito: os dois
      // precisam da mesma configuração de rede, e ter depósito ligado sem saque (ou o
      // contrário) é meio caminho para um caixa que não fecha. Ele sozinho não assina nada,
      // então subir os dois no mesmo processo não aumenta a exposição da chave.
      watcherDeDeposito = iniciarWatcher(chain, {
        tomarPosse: () => tomarPosseDoShard('orbs-watcher', config.instanceId),
      });
      await watcherDeDeposito.iniciar();
    }
  }

  setInterval(tick, config.tickMs);
  setInterval(tickDoCentro, TICK_CENTRO_MS);
  setInterval(flush, config.flushMs);

  // "Restam N de 50" das Caixas de Fundador. O contador é atualizado na hora quando a compra
  // acontece NESTE processo — mas num cluster a caixa pode ter saído noutro shard, e aí este
  // aqui continuaria anunciando uma vaga que não existe mais. Uma consulta de duas linhas por
  // minuto resolve; a compra em si nunca depende deste número (quem decide é a transação que
  // numera, em `comprarCaixa`), então o pior caso é a vitrine estar até 60 s atrasada.
  setInterval(() => {
    atualizarVendidasCaixas().catch((err) => console.error('[caixas] contagem:', err.message));
  }, 60_000).unref();

  // Retenção das DMs: 7 dias. Só o shard 0 roda o DELETE (é o mesmo para o cluster todo) —
  // uma vez no boot e depois de hora em hora.
  if (config.shardId === 0) {
    const limparDMs = () =>
      amigosDb
        .limparMensagensAntigas()
        .then((n) => n && console.log(`[amigos] ${n} DM(s) além dos 7 dias apagadas`))
        .catch((err) => console.error('[amigos] limpeza de DMs falhou:', err.message));
    const limparChats = () =>
      chatDb
        .limparAntigas()
        .then((n) => n && console.log(`[chat-db] ${n} mensagem(ns) públicas além do prazo apagadas`))
        .catch((err) => console.error('[chat-db] limpeza falhou:', err.message));
    // Histórico do PvP ranqueado: 30 dias. Mesma janela e mesmo dono das duas acima — o
    // resumo de uma partida é pequeno, mas uma tabela append-only sem faxina cresce para
    // sempre, e ninguém consulta a derrota de dois meses atrás.
    const limparPartidasPvp = () =>
      pvpdb
        .limparPartidasAntigas()
        .then((n) => n && console.log(`[pvp] ${n} partida(s) além dos ${pvpdb.RETENCAO_PARTIDAS_DIAS} dias apagadas`))
        .catch((err) => console.error('[pvp] limpeza do histórico falhou:', err.message));
    limparDMs();
    limparChats();
    limparPartidasPvp();
    setInterval(limparDMs, 3_600_000).unref();
    setInterval(limparChats, 3_600_000).unref();
    setInterval(limparPartidasPvp, 3_600_000).unref();
  }
  setInterval(() => {
    metricas.eventosPorSeg = eventosNoSegundo;
    eventosNoSegundo = 0;
    // publica a métrica deste shard para qualquer gateway conseguir montar a visão do cluster
    pub.hset('metricas', String(config.shardId), JSON.stringify({ ...metricas, ts: Date.now() })).catch(() => {});
    // Só o dono das arenas tem `vivas` de verdade em memória — é ele que publica a ocupação
    // para os outros shards responderem `pvp.info` sem ter a menor ideia de quem está lá dentro.
    if (config.shardId === config.arenaShardId) publicarOcupacaoArenas(ocupacaoDasArenas());
  }, 1000);

  console.log(`[sim] shard ${config.shardId}/${config.shardCount} pronto (tick ${config.tickMs}ms)`);
}

let liberarPosse = null;

/**
 * O boot estourou: solta a trava do shard antes de o processo morrer.
 *
 * Sem isto, o systemd reinicia o sim três segundos depois e ele encontra a PRÓPRIA trava de pé —
 * "JÁ TEM DONO" — até ela expirar (15 s). Foi o que manteve o sim 4 e o sim 6 fora por ~17 s no
 * deploy de 16/09/2026. Só quem chama é o `index.mjs`, e só antes de o shard começar a rodar.
 */
export async function abortarBootDoSim() {
  await liberarPosse?.();
}
let workerDeSaque = null;
let watcherDeDeposito = null;

/**
 * Saída limpa: despeja todo mundo no banco e solta a trava do shard.
 *
 * Escuta os DOIS sinais. `SIGINT` é o Ctrl+C do desenvolvimento; **`SIGTERM` é o que o systemd
 * manda** num `systemctl restart` — ou seja, é o sinal de todo deploy em produção. Enquanto só
 * o SIGINT estava aqui, cada atualização matava o processo sem flush: até `FLUSH_MS` (5 s) de
 * progresso perdido para TODOS os jogadores online, e a trava de posse presa no Redis até o TTL
 * vencer, atrasando a subida do processo novo.
 *
 * `parando` protege contra sinal repetido: o systemd manda SIGTERM e, se o processo demorar,
 * manda de novo — reentrar aqui no meio do flush duplicaria a escrita.
 */
let parando = false;
async function sairLimpo(sinal) {
  if (parando) return;
  parando = true;
  console.log(`\n[sim] ${sinal}: flush final de ${jogadores.size} jogador(es)…`);
  for (const p of jogadores.values()) filaFlush.add(p);
  await flush().catch((err) => console.error('[sim] flush final falhou:', err.message));
  // Quem saiu há pouco tem a gravação numa promessa à parte, que pode estar esperando a fila de
  // economia (ver `removerJogadorLocal`) — e o processo não pode morrer antes dela.
  await Promise.allSettled([...flushPendente.values()]);
  await workerDeSaque?.parar().catch(() => {});
  await watcherDeDeposito?.parar().catch(() => {});
  // solta a trava para o próximo processo subir na hora, sem esperar o TTL
  await liberarPosse?.();
  console.log('[sim] saída limpa');
  process.exit(0);
}

process.on('SIGINT', () => sairLimpo('SIGINT'));
process.on('SIGTERM', () => sairLimpo('SIGTERM'));
