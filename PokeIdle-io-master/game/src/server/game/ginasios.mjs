// OS GINÁSIOS — o pódio, o título e o desafio.
//
// Dezoito ginásios, um por tipo elemental, disputados pelos próprios jogadores. Cada um
// registra um time de até cinco pokémon DAQUELE tipo e o pódio é ordenado pela soma da força
// dos cinco, medida com o nível travado em 150. O título (+25% de dano na hunt daquele tipo)
// só muda quando alguém VENCE o líder no desafio ou quando o titular abandona o ginásio —
// ter ⚔ maior no pódio sozinho não rouba a coroa. O bônus NÃO vale no duelo do ginásio,
// na Arena PvP nem na Guerra de Guilds.
//
// ### Três relógios diferentes
//
// O sistema parece um só, mas tem três ritmos, e misturá-los seria caro:
//
//   pódio      calculado na LEITURA, quando alguém abre a tela. É o número honesto ("força
//              atual"), custa uma consulta e sai com 30 s de cache — abrir a tela duas vezes
//              seguidas não vale duas varreduras.
//   líderes    apurados a cada minuto por UM shard (`config.arenaShardId`) e gravados em 18
//              linhas. Todo shard relê essas linhas no mesmo intervalo para um mapa em
//              memória. É esse mapa que o tick de combate consulta.
//   desafio    sob demanda: venceu o líder → toma o título; cooldown de 24 h por ginásio.
//
// ### Por que o +25% não é lido do banco no golpe
//
// `multDoGolpe` é chamada em todo ataque de toda hunt do servidor. Uma consulta ali, mesmo
// com índice, mataria o tick. O mapa em memória custa um `Map.get` e pode estar até um
// minuto atrasado — o que, num título que muda quando alguém sobe um pokémon de nível, é
// exatamente o tipo de atraso que ninguém percebe.
import { config } from '../config.mjs';
import { especies, calcularStats, hpDeCombate, multDeNascenca, looktypeShiny } from '../content.mjs';
import { empacotarVisual } from './visual.mjs';
import { simularGuerra, VERSAO_REPLAY, arenaDeDuelo } from './guild-pvp-sim.mjs';
import * as gindb from '../ginasios-db.mjs';
import { notaDePokemon } from '../../shared/nota-pokemon.mjs';
import { normalizarRefino, totalDoRefino } from '../../shared/refino-stats.mjs';
import {
  GINASIO_DESAFIO_COOLDOWN_MS,
  GINASIO_NIVEL_MIN,
  GINASIO_TIME_MAX,
  TIPOS_GINASIO,
  multBuffGinasio,
  nivelNoGinasio,
  poderNoGinasio,
  tipoDeGinasio,
} from '../../shared/ginasios.mjs';

/** De quanto em quanto tempo os líderes são reapurados (e relidos pelos outros shards). */
const APURACAO_MS = 60_000;

/** Cache do pódio de um ginásio. Abrir a tela em sequência não repete a varredura. */
const CACHE_RANKING_MS = 30_000;

/** `tipo -> { playerId, nick, poder, desde }`. O mapa que o tick de combate consulta. */
let lideresPorTipo = new Map();
/** `playerId -> Set(tipos)`, o mesmo mapa pelo outro lado — é este que o golpe usa. */
let tiposPorLider = new Map();
let ultimaApuracao = 0;
let apurando = false;

const rankingCache = new Map(); // tipo -> { em, linhas }

/** O titular do ginásio fica em 1º no pódio mesmo que outro time tenha ⚔ maior no ranking bruto. */
function rankingComLiderNoTopo(linhas, liderPlayerId) {
  if (!liderPlayerId || linhas.length <= 1) return linhas;
  const i = linhas.findIndex((l) => Number(l.playerId) === Number(liderPlayerId));
  if (i <= 0) return linhas;
  const out = [...linhas];
  out.unshift(out.splice(i, 1)[0]);
  return out;
}

// ------------------------------------------------------------------ o título

/** Os tipos que este jogador lidera AGORA. Vazio para quase todo mundo. */
export const tiposLiderados = (playerId) => tiposPorLider.get(Number(playerId)) ?? null;

/**
 * O multiplicador de dano deste pokémon, dado o dono. `1` quando não há título — que é o
 * caso da esmagadora maioria dos golpes do servidor, e por isso a função sai barata.
 */
export function multDoGolpe(playerId, tiposDoPokemon) {
  const meus = tiposPorLider.get(Number(playerId));
  return meus ? multBuffGinasio(tiposDoPokemon, meus) : 1;
}

function indexarLideres(linhas) {
  lideresPorTipo = new Map(linhas.map((l) => [l.tipo, l]));
  const porLider = new Map();
  for (const l of linhas) {
    if (!l.playerId) continue;
    const set = porLider.get(l.playerId) ?? new Set();
    set.add(l.tipo);
    porLider.set(l.playerId, set);
  }
  tiposPorLider = porLider;
}

/**
 * O despertador do tick.
 *
 * Quem APURA é um shard só — a apuração lê os times do servidor inteiro e escreve as 18
 * linhas, e oito processos fazendo isso ao mesmo tempo seria a mesma conta oito vezes para o
 * mesmo resultado. Os outros só releem. O shard das arenas foi escolhido por já ser o
 * "processo com tarefas de mundo" do cluster (ver `config.arenaShardId`).
 */
export function verificarGinasios(t) {
  if (apurando || t - ultimaApuracao < APURACAO_MS) return Promise.resolve();
  ultimaApuracao = t;
  apurando = true;
  const trabalho = config.shardId === config.arenaShardId ? apurarLideres() : recarregarLideres();
  return trabalho.finally(() => {
    apurando = false;
  });
}

/** Relê as 18 linhas do banco para o mapa em memória. Todo shard faz isto. */
export async function recarregarLideres() {
  indexarLideres(await gindb.lideres());
}

/** Recalcula o pódio dos 18, grava os líderes e reindexa. Só o shard dono. */
export async function apurarLideres() {
  const porTipo = await gindb.todosOsTimes();
  await gindb.gravarLideres(porTipo);
  await recarregarLideres();
  // O pódio mudou: o cache de leitura do minuto anterior já não vale.
  rankingCache.clear();
  return porTipo;
}

/**
 * Reapura AGORA, fora do relógio de um minuto.
 *
 * Chamada quando alguém salva um time: sem isto, quem acabou de tomar o ginásio de FIRE
 * abriria a tela e veria o líder antigo por até um minuto — e o pior, veria o próprio time
 * em 1º no pódio (que é calculado na leitura) enquanto o selo de líder ainda dizia outra
 * coisa. Duas verdades na mesma tela é pior que um minuto de atraso nas duas.
 */
export async function apurarAgora() {
  ultimaApuracao = Date.now();
  if (config.shardId === config.arenaShardId) return apurarLideres();
  rankingCache.clear();
  return recarregarLideres();
}

// ------------------------------------------------------------------ a tela

/** O pódio de um ginásio, com cache curto. */
export async function rankingGinasio(tipoBruto) {
  const tipo = tipoDeGinasio(tipoBruto);
  if (!tipo) return [];
  const cache = rankingCache.get(tipo);
  const t = Date.now();
  if (cache && t - cache.em < CACHE_RANKING_MS) return cache.linhas;
  const linhas = await gindb.rankingDoGinasio(tipo);
  rankingCache.set(tipo, { em: t, linhas });
  return linhas;
}

/** Um pokémon do time de ginásio, empacotado para cards e ficha pública (como guild.detalhe). */
function pkGinasioParaCliente(pk, donoNick) {
  const esp = pk.esp;
  const nivelGin = nivelNoGinasio(pk.level);
  const refino = normalizarRefino(pk.refino);
  const stats = calcularStats(
    esp, pk.ivs, nivelGin, pk.quality, multDeNascenca(pk.potencia, pk.shiny), refino,
  );
  const fichaNasc = { ivs: pk.ivs, quality: pk.quality, potencia: pk.potencia, shiny: pk.shiny, refino };
  return {
    id: pk.id,
    speciesId: pk.speciesId,
    nome: pk.nome,
    looktype: pk.looktype,
    lookShiny: pk.shiny ? looktypeShiny(pk.speciesId) : null,
    tipos: pk.tipos,
    level: pk.level,
    levelGinasio: nivelGin,
    quality: pk.quality,
    potencia: pk.potencia,
    ivs: pk.ivs,
    refino,
    refinoTotal: totalDoRefino(refino),
    shiny: pk.shiny,
    tmElemental: pk.tmElemental ?? null,
    stats,
    maxHp: hpDeCombate(stats.hp),
    hp: hpDeCombate(stats.hp),
    poder: poderNoGinasio(pk, esp),
    nota: notaDePokemon({ ...fichaNasc, ivs: pk.ivs }, esp),
    dono: donoNick,
  };
}

/** Uma linha do pódio, enxuta, do jeito que a tela desenha. */
const linhaParaCliente = (l, pos) => ({
  pos,
  playerId: l.playerId,
  nick: l.nick,
  poder: l.poder,
  // O boneco de cada colocado — o pódio desenha treinador, como o do Ranking.
  looktype: l.looktype ?? 159,
  vs: empacotarVisual(l.visual),
  nivelTreinador: l.nivelTreinador,
  pokemons: l.pokemons.map((pk) => pkGinasioParaCliente(pk, l.nick)),
});

/**
 * A tela de abertura: os 18 ginásios com o líder de cada um e o que EU tenho em cada.
 *
 * Vai tudo num pacote só porque a tela mostra os 18 de uma vez — dezoito idas ao servidor
 * para desenhar uma grade seria uma tela que demora a existir.
 */
export async function infoGinasios(playerId, nivelTreinador) {
  const meus = await gindb.timesDoJogador(playerId);
  return {
    nivelMin: GINASIO_NIVEL_MIN,
    // `null` = SEM TETO. O campo fica no pacote em vez de sumir para que o contrato diga a
    // coisa por extenso: não é "esqueceram de mandar", é "não há cap".
    //
    // Uma aba aberta desde ANTES do deploy continua desenhando o teto de 150 (o `?? 150` dela
    // engole tanto `null` quanto o campo ausente — não há valor que conserte um cliente velho
    // sem sujar o novo). É a janela de sempre, e quem a fecha é a barra de "versão nova,
    // recarregue"; o dado do pódio, que é o que importa, já vem sem teto para os dois.
    capNivel: null,
    timeMax: GINASIO_TIME_MAX,
    podeRegistrar: (nivelTreinador ?? 0) >= GINASIO_NIVEL_MIN,
    ginasios: TIPOS_GINASIO.map((tipo) => {
      const lider = lideresPorTipo.get(tipo) ?? null;
      const meu = meus[tipo] ?? null;
      return {
        tipo,
        lider: lider?.playerId
          ? {
            playerId: lider.playerId,
            nick: lider.nick,
            poder: lider.poder,
            desde: lider.desde,
            // O boneco do líder, empacotado como em toda tela que desenha treinador.
            looktype: lider.looktype ?? 159,
            vs: empacotarVisual(lider.visual),
          }
          : null,
        souLider: !!lider?.playerId && Number(lider.playerId) === Number(playerId),
        meuTime: meu ? { poder: meu.poder, pokemonIds: meu.pokemonIds } : null,
      };
    }),
  };
}

/** O pódio inteiro de um ginásio, para o painel do ginásio aberto. */
export async function painelDoGinasio(playerId, tipoBruto) {
  const tipo = tipoDeGinasio(tipoBruto);
  if (!tipo) return null;
  const linhasBrutas = await rankingGinasio(tipo);
  const lider = lideresPorTipo.get(tipo) ?? null;
  const linhas = rankingComLiderNoTopo(linhasBrutas, lider?.playerId);
  const minha = linhas.findIndex((l) => Number(l.playerId) === Number(playerId));
  return {
    tipo,
    ranking: linhas.slice(0, 50).map((l, i) => linhaParaCliente(l, i + 1)),
    total: linhas.length,
    minhaPos: minha >= 0 ? minha + 1 : null,
    meuTime: minha >= 0 ? linhaParaCliente(linhas[minha], minha + 1) : null,
    liderDesde: lider?.playerId ? lider.desde : null,
    faltaParaOTopo: minha > 0 ? Math.max(0, linhas[0].poder - linhas[minha].poder) : 0,
    desafioCooldownMs: await gindb.msAteProximoDesafio(playerId, tipo),
  };
}

// ------------------------------------------------------------------ o desafio

/**
 * O pokémon do time, pronto para a simulação — no NÍVEL DELE, inteiro.
 *
 * Já foi o tratamento da Arena Ancestral (`statsDeCombateArena` em `game/pvp.mjs`), com os
 * stats recalculados no nível do teto. Teto duro não existe mais em lugar nenhum: o duelo usa
 * `nivelNoGinasio`, que mede o nível inteiro até 150 e comprimido daí para cima (ver o
 * cabeçalho de `shared/ginasios.mjs`). Qualidade, potência e refino entram por inteiro.
 *
 * É a MESMA função que o pódio usa, e isso não é coincidência: o número que a tela mostra e a
 * luta que o botão "Desafiar o líder" roda precisam ser medidos pela mesma régua, senão o
 * desafio contradiz o ranking que o motivou.
 */
function paraCombate(pk) {
  const esp = pk.esp ?? especies.get(pk.speciesId);
  if (!esp) return null;
  const nivel = nivelNoGinasio(pk.level);
  const stats = calcularStats(esp, pk.ivs, nivel, pk.quality, multDeNascenca(pk.potencia, pk.shiny), pk.refino);
  return {
    id: pk.id,
    speciesId: esp.pokeId,
    nome: esp.name,
    looktype: esp.looktype,
    lookShiny: pk.shiny ? looktypeShiny(esp.pokeId) : null,
    tipos: [esp.type1, esp.type2].filter(Boolean),
    level: nivel,
    shiny: !!pk.shiny,
    stats,
    maxHp: hpDeCombate(stats.hp),
    tmElemental: pk.tmElemental ?? null,
  };
}

/** Um time de ginásio vira uma "guild" de um membro só, que é o que `simularGuerra` come. */
function ladoDaBatalha(time, idx) {
  const equipe = time.pokemons.map(paraCombate).filter(Boolean);
  if (!equipe.length) return null;
  return {
    id: idx,
    nome: time.nick,
    brasao: null,
    membros: [{
      playerId: time.playerId,
      nick: time.nick,
      looktype: time.looktype,
      visual: empacotarVisual(time.visual),
      equipe,
    }],
  };
}

/**
 * Desafio ao líder — quem vence toma o título (e o +25%) na hora.
 *
 * O pódio bruto ainda ordena por ⚔, mas o 1º lugar oficial é o titular até alguém vencê-lo
 * aqui ou ele abandonar o time. Cooldown de 24 h vale só para aquele ginásio.
 */
export async function desafiarLider(playerId, tipoBruto) {
  const tipo = tipoDeGinasio(tipoBruto);
  if (!tipo) throw new gindb.ErroGinasio('tipo', 'Ginásio desconhecido.');

  const espera = await gindb.msAteProximoDesafio(playerId, tipo);
  if (espera > 0) {
    const horas = Math.ceil(espera / 3_600_000);
    throw new gindb.ErroGinasio(
      'espera',
      horas >= 2
        ? `Aguarde cerca de ${horas} h para desafiar este ginásio de novo.`
        : `Aguarde ${Math.ceil(espera / 60_000)} min para desafiar este ginásio de novo.`,
    );
  }

  const linhas = rankingComLiderNoTopo(
    await rankingGinasio(tipo),
    lideresPorTipo.get(tipo)?.playerId,
  );
  const lider = linhas[0] ?? null;
  if (!lider?.playerId) throw new gindb.ErroGinasio('vazio', 'Este ginásio ainda não tem líder.');
  if (Number(lider.playerId) === Number(playerId)) {
    throw new gindb.ErroGinasio('euMesmo', 'Você já é o líder deste ginásio.');
  }
  const meu = linhas.find((l) => Number(l.playerId) === Number(playerId)) ?? null;
  if (!meu) throw new gindb.ErroGinasio('semTime', 'Registre um time neste ginásio para desafiar.');

  const ladoA = ladoDaBatalha(meu, 1);
  const ladoB = ladoDaBatalha(lider, 2);
  if (!ladoA || !ladoB) throw new gindb.ErroGinasio('semTime', 'Um dos times não tem lutador de pé.');

  const arena = arenaDeDuelo();
  const r = await simularGuerra([ladoA, ladoB], {
    aoRespirar: () => new Promise((ok) => setImmediate(ok)),
    arenaSlug: arena.slug,
    ordemFixa: true,
    gradeInteira: arena.gradeInteira,
  });

  const venci = r.vencedorId === ladoA.id;
  let tomouLideranca = false;
  if (venci) {
    await gindb.transferirLiderancaPorDesafio(tipo, playerId, meu.poder);
    await recarregarLideres();
    rankingCache.delete(tipo);
    tomouLideranca = true;
  }
  await gindb.registrarCooldownDesafio(playerId, tipo);

  return {
    tipo,
    versao: VERSAO_REPLAY,
    arena: arena.slug,
    venci,
    tomouLideranca,
    desafioCooldownMs: GINASIO_DESAFIO_COOLDOWN_MS,
    motivo: r.motivo,
    duracaoMs: r.duracaoMs,
    desafiante: { nick: meu.nick, poder: meu.poder },
    lider: { nick: lider.nick, poder: lider.poder },
    placar: r.placar,
    replay: r.replay,
  };
}

/** @deprecated o cooldown vive no Postgres — mantido para não quebrar quem importa. */
export function esquecerDesafio(_playerId) {}
