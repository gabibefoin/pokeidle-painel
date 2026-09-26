// A TEMPORADA DO PvP RANQUEADO — a virada da semana, o prêmio e o reset.
//
// Toda segunda-feira, 00:00 de Brasília (03:00 UTC), a escada zera. Antes de zerar, a tabela
// final vira prêmio: as três primeiras posições levam 48 horas de Shiny Secret Lure e de Capture
// Boost, o resto do Challenger (4º ao 20º) leva 18 horas dos mesmos dois, e o Mestre (21º ao
// 50º) leva 18 horas de XP de treinador e de XP de pokémon. As faixas moram em `PVP_PREMIOS`,
// no shared, porque a TELA precisa delas para mostrar o que está em jogo antes de a semana
// acabar. Foi mensal (dia 1º, em dias de boost) até 18/09/2026.
//
// ### Por que zerar
//
// Está escrito por extenso em `shared/pvp-rank.mjs`, na seção da temporada, e o resumo é:
// o Elo daqui não é soma zero, então o número infla. Mestre e Challenger não sofrem (são
// posição, não número), mas os cinco tiers de baixo viram um lugar por onde ninguém passa.
// Zerar devolve à escada o significado que ela tem hoje.
//
// ### Quem roda isto
//
// UM processo, o mesmo `config.arenaShardId` que casa a fila e apura os ginásios. Dois shards
// virando a semana em paralelo pagariam o prêmio duas vezes — e é por isso que a trava não está
// aqui e sim no banco: `virarTemporada` lê a marca da competência com `FOR UPDATE` dentro da
// própria transação que premia e zera. Mesmo que dois processos entrem, o segundo encontra a
// marca e desiste. Este arquivo só decide QUANDO perguntar.
//
// ### O prêmio não é entregue aqui
//
// A virada acontece com quase todo mundo offline, e o estado do jogador vive em memória com
// write-behind — escrever no banco por baixo de quem está online seria perder o prêmio no
// flush seguinte. Então a virada só REGISTRA (tabela `pvp_premios`), e a entrega é um caminho
// separado (`entregarPremiosPvp`), pendurado no login e numa varredura de quem já está dentro.
// É o mesmo desenho do pagamento do Mercado e dos coins de amigo.
//
// ### A queda por inatividade também mora aqui
//
// `verificarDecaimentoPvp`: um dia sem partida com pontos de elite derruba o jogador para o topo
// do Diamante. É o outro relógio da escada, e roda no mesmo processo que o da semana.
import { config } from '../config.mjs';
import * as pvpdb from '../pvp-ranqueado-db.mjs';
import { temporadaDe, temporadaAnterior } from '../../shared/pvp-rank.mjs';
import { concederBoost } from './loja.mjs';

const HORA_MS = 60 * 60_000;
const DIA_MS = 24 * HORA_MS;

/** A competência já checada nesta subida — evita uma ida ao banco por tick. */
let ultimaChecada = null;

/**
 * A semana virou? Se virou, premia e zera a temporada que acabou.
 *
 * O throttle é o mesmo dos outros despertadores do tick (um minuto): a virada não é show ao
 * vivo, e um minuto de atraso para perceber que a semana mudou é invisível para o jogador.
 */
export async function verificarTemporadaPvp(agora) {
  if (config.shardId !== config.arenaShardId) return null;

  const atual = temporadaDe(agora);
  if (ultimaChecada === atual) return null;
  ultimaChecada = atual;

  const fechar = temporadaAnterior(atual);
  try {
    // AMBIENTE SEM HISTÓRICO NÃO VIRA NADA — só registra onde a contagem começa.
    //
    // Sem esta guarda, a pergunta "a temporada anterior já foi apurada?" tem resposta NÃO num
    // banco que nunca viu uma virada, para qualquer temporada — e a primeira subida fecha a
    // anterior sozinha: premia com a tabela de hoje e zera a escada, no meio da temporada, por
    // causa de um deploy. Foi o que aconteceu ao subir a v1.65.0 em 11/09/2026 (fechou "2026-08",
    // que nunca foi jogado). Passou sem estrago porque o modo ainda não estava no ar e a tabela
    // estava vazia; com jogadores dentro, teria apagado a temporada corrente sem pagar ninguém.
    //
    // Na troca de mensal para semanal a guarda vale de novo, e é por isso que só marca SEMANAL
    // conta como histórico (ver `existeTemporadaApurada`): a subida do código novo semeia a
    // semana anterior, e a tabela acumulada até aqui é paga na primeira segunda-feira.
    if (!(await pvpdb.existeTemporadaApurada())) {
      const semeou = await pvpdb.sementeDaTemporada(fechar);
      if (semeou) {
        console.log(
          `[pvp] primeira subida deste ambiente: ${fechar} marcada como semente `
          + '(nada premiado, nada zerado). A primeira virada de verdade é a próxima segunda-feira, 00:00 BRT.',
        );
      }
      return { virou: false, semeado: true, premiados: 0, zerados: 0 };
    }

    const r = await pvpdb.virarTemporada(fechar);
    if (r.virou) {
      console.log(
        `[pvp] temporada ${fechar} encerrada: ${r.premiados} premiado(s), `
        + `${r.zerados} rank(s) de volta ao pé da escada`,
      );
    }
    return r;
  } catch (err) {
    // A competência volta a ser checável: sem isto, um erro de banco na virada faria a semana
    // inteira passar sem prêmio e sem reset, porque `ultimaChecada` já estaria marcada.
    ultimaChecada = null;
    throw err;
  }
}

/** Uma passada do decaimento em andamento — segura a reentrada se o banco estiver lento. */
let decaindo = false;

/**
 * Quem passou um dia sem jogar com pontos de elite cai para o topo do Diamante.
 *
 * O mesmo processo da virada (`config.arenaShardId`) e, como nela, a trava de verdade é o banco
 * (`aplicarDecaimento` trava as linhas). A passada é curta — uma leitura pelo índice de pontos,
 * que na elite são poucas linhas — e roda de poucos em poucos segundos porque a TELA mostra um
 * relógio até a queda: o número tem de descer quando ele chega a zero, e não um minuto depois.
 *
 * Devolve quem caiu; avisar o shard de cada um fica com quem chama (o sim), que é quem fala
 * com o barramento.
 */
export async function verificarDecaimentoPvp() {
  if (config.shardId !== config.arenaShardId) return [];
  if (decaindo) return [];
  decaindo = true;
  try {
    const caidos = await pvpdb.aplicarDecaimento();
    if (caidos.length) {
      console.log(
        `[pvp] ${caidos.length} caíram para o Diamante por inatividade: `
        + caidos.map((c) => `${c.nick} ${c.antes}→${c.pontos}`).join(', '),
      );
    }
    return caidos;
  } finally {
    decaindo = false;
  }
}

/**
 * Entrega os prêmios pendentes de UM jogador, aplicando os boosts na memória dele.
 *
 * Devolve a lista do que foi entregue para quem chama avisar a tela. Lista vazia é o caso
 * comum e não custa nada — a consulta é por índice parcial (`entregue_em IS NULL`).
 *
 * A reivindicação e a aplicação acontecem em ordens diferentes de propósito: o banco marca
 * PRIMEIRO (`recolherPremios` faz `UPDATE … RETURNING`, atômico) e só então os boosts entram
 * na memória. Se o processo morrer no meio, perde-se um prêmio; a ordem inversa pagaria o
 * mesmo prêmio duas vezes em toda reconexão que falhasse depois de aplicar. Entre perder um
 * boost de 18 horas e imprimir boost infinito, a escolha não é difícil.
 */
export async function entregarPremiosPvp(p, agora = Date.now()) {
  if (!p?.dbId) return [];
  const premios = await pvpdb.recolherPremios(p.dbId);
  if (!premios.length) return [];

  for (const premio of premios) {
    // A unidade vem GRAVADA no prêmio: 'horas' desde a temporada semanal, 'dias' no que sobrou
    // da mensal. Ler tudo como horas daria sete horas a quem ganhou sete dias.
    const unidadeMs = premio.unidade === 'horas' ? HORA_MS : DIA_MS;
    for (const [chave, qtd] of Object.entries(premio.boosts ?? {})) {
      concederBoost(p, chave, Number(qtd) * unidadeMs, agora);
    }
  }
  return premios;
}

// ------------------------------------------------------------------ testes
export function _testeResetarCache() {
  ultimaChecada = null;
}
