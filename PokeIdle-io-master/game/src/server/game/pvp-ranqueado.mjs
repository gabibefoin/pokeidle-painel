// PvP RANQUEADO — a fila, o pareamento e a partida.
//
// ### A decisão que sustenta tudo: a partida é ATÔMICA
//
// Não existe "durante a partida". No instante em que o matchmaking casa dois jogadores, a
// luta inteira é simulada aqui (a mesma `simularGuerra` do duelo de ginásio), os pontos são
// gravados em transação e só ENTÃO o resultado viaja para os dois. O que o jogador vê depois
// — o mapinha, os cinco pokémon se batendo, o "+18" no fim — é a reprodução de um fato que já
// aconteceu.
//
// Isso apaga de uma vez a classe inteira de trapaça que uma arena ao vivo tem de combater:
//
//   · fechar a aba no golpe fatal não devolve nada — os pontos já mudaram;
//   · puxar o cabo de rede não trava o oponente — ele recebe a vitória do mesmo jeito;
//   · cancelar a fila no milissegundo do pareamento não desfaz a partida — o par é
//     RECLAMADO num comando atômico no Redis, e quem cancela depois disso cancela nada;
//   · lag, pacote perdido e relógio adiantado não influenciam a luta — nada do cliente entra
//     na simulação, nem sequer o instante em que ele apertou o botão.
//
// A arena ao vivo antiga (`pvp.mjs`) precisava de duas travas de tempo, uma punição de
// abandono e um balé de migração entre shards para chegar perto disso. Aqui nada disso é
// necessário, e é a razão de o arquivo ser tão pequeno para o que faz.
//
// ### Onde cada peça roda
//
//   fila         Redis (`pvp:fila`, um hash). É global: o shard do jogador escreve, o
//                matchmaking lê. Quem entra deixa um carimbo de vida que o próprio shard
//                renova a cada tick — entrada sem batida vira lixo em 25 s.
//   pareamento   UM processo (`config.arenaShardId`, que já é o "processo de tarefas de
//                mundo" do cluster). Dois pareadores casariam o mesmo jogador duas vezes.
//   pontos       Postgres, em `pvp_rank`, FORA do write-behind — ver `pvp-ranqueado-db.mjs`.
//   entrega      direto ao gateway do jogador (`gatewayDoJogador`), sem passar pelo sim dono.
//                O sim não guarda nada de ranqueado em memória, então não há o que sincronizar.
import { createHash } from 'node:crypto';
import { config } from '../config.mjs';
import { pub, publicar, canalSim, canalGateway, gatewayDoJogador } from '../bus.mjs';
import { shardDoJogador } from '../config.mjs';
import { pool } from '../db.mjs';
import { especies, calcularStats, hpDeCombate, multDeNascenca, looktypeShiny } from '../content.mjs';
import { empacotarVisual } from './visual.mjs';
import { nivelNoGinasio } from '../../shared/ginasios.mjs';
import { simularGuerra, VERSAO_REPLAY, arenaDeDuelo } from './guild-pvp-sim.mjs';
import { fichaDaPartida } from './pvp-analise.mjs';
import * as pvpdb from '../pvp-ranqueado-db.mjs';
import {
  PVP_ENTRE_PARTIDAS_MS,
  PVP_NIVEL_MIN,
  PVP_PARTIDAS_POSICIONAMENTO,
  PVP_TIME_MIN,
  aceitamSeMutuamente,
  aplicarDelta,
  deltaDaPartida,
  janelaDeBusca,
} from '../../shared/pvp-rank.mjs';

// ------------------------------------------------------------------ constantes

/** O hash da fila. Campo = chave do jogador (nick em minúsculas), valor = a entrada em JSON. */
const CHAVE_FILA = 'pvp:fila';

/**
 * Sem batida de vida por este tempo, a entrada é lixo e o pareador a descarta.
 *
 * O shard dono do jogador bate o ponto a cada `FILA_BATIDA_MS`. 25 s é folga de sobra para um
 * tick perdido e curto o bastante para que um processo de simulação que MORREU não deixe
 * fantasmas casáveis na fila por minutos.
 */
export const FILA_TTL_MS = 25_000;

/** De quanto em quanto tempo o shard dono renova a entrada de quem está na fila dele. */
export const FILA_BATIDA_MS = 6_000;

/** Intervalo entre duas passadas do pareador. */
export const PASSO_MATCHMAKING_MS = 2_000;

/**
 * Espera obrigatória entre o fim de uma partida e a entrada na fila seguinte.
 *
 * Não é balanceamento, é freio de abuso: sem ela, um par de contas que conseguisse se
 * encontrar rodaria centenas de partidas por hora. Com ela, mesmo o cenário perfeito para o
 * trapaceiro rende poucas dezenas — e o Elo já encolhe o ganho de quem só vence o mesmo
 * bem antes disso.
 *
 * O número mora em `shared/pvp-rank.mjs` porque o botão da fila também precisa dele para
 * contar os segundos sem perguntar ao servidor. Reexportado aqui para quem já o importava.
 */
export { PVP_ENTRE_PARTIDAS_MS as ENTRE_PARTIDAS_MS } from '../../shared/pvp-rank.mjs';

/**
 * Janela em que o MESMO par não se reencontra, de jeito nenhum.
 *
 * Dez minutos é um meio-termo assumido. Numa fila de milhares seria baixo demais; aqui, com a
 * população inteira cabendo numa sala, um bloqueio de uma hora deixaria três jogadores
 * online sem ninguém para enfrentar depois de três partidas — e uma fila que não casa é pior
 * do que uma revanche. O que segura o abuso de verdade não é este relógio, é o peso: reencontrar
 * o mesmo oponente rende metade, depois um quarto, e do quinto encontro em diante, nada.
 */
export const REVANCHE_MS = 10 * 60_000;

/**
 * Partidas casadas numa passada, e o teto acompanha o tamanho da fila.
 *
 * Seis fixas bastavam para a fila de hoje e viravam gargalo numa cheia: com 600 esperando,
 * seis pares a cada 2 s dão 180 partidas por minuto, e a fila anda mais devagar do que
 * enche. O teto de 32 é a conta do custo — uma partida é ~0,5 ms de CPU (2,1 ms no pior
 * caso medido), então 32 delas são ~70 ms a cada 2.000 ms: 3,5% de um núcleo, no pior caso,
 * num processo que também roda as hunts de um shard.
 */
const paresPorPasso = (naFila) => Math.min(32, Math.max(6, Math.ceil(naFila / 25)));

// ------------------------------------------------------------------- chaves

const chaveCooldown = (key) => `pvp:cd:${key}`;
/** A chave de um PAR, sempre na mesma ordem — senão `a|b` e `b|a` seriam dois bloqueios. */
const chaveDoPar = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Os oponentes recentes de UM jogador, num sorted set com o instante do encontro como nota.
 *
 * ### Por que não é uma chave por PAR
 *
 * Era, e não escalava. O pareador precisa saber, a cada passada, quais pares estão
 * bloqueados — e com a chave por par isso significa perguntar por TODOS os pares da fila:
 * N·(N−1)/2 chaves num `MGET` só. Com 200 na fila são 19.900 chaves (10 ms de Redis a cada
 * 2 s); com 500 são 124.750 e o `mget(...chaves)` estoura a pilha do Node.
 *
 * E o modo de falha era o pior possível: o `catch` devolvia conjunto vazio, ou seja, o
 * bloqueio de revanche se DESLIGARIA sozinho, em silêncio, exatamente no dia em que a fila
 * ficasse cheia — que é quando ele mais importa.
 *
 * Por jogador, a leitura é uma consulta por pessoa na fila (N, não N²), tudo num pipeline só.
 * A nota é o carimbo de tempo, então a janela de revanche é um `ZRANGEBYSCORE` e a limpeza do
 * que venceu é um `ZREMRANGEBYSCORE` — sem TTL por membro, que sorted set não tem.
 */
const chaveRivais = (key) => `pvp:rivais:${key}`;

/** Endereços de loopback — ver `resumoDeIp`. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);
let avisouLoopback = false;

/**
 * O IP vira um resumo de 16 hexadecimais antes de entrar na fila.
 *
 * ### Por que um resumo, e não o endereço
 *
 * A fila precisa saber se dois candidatos vêm da mesma casa; ela não precisa saber de ONDE.
 * Guardar o endereço em claro num hash do Redis lido por todo processo de simulação seria
 * espalhar dado pessoal por um lugar que não tem nada a ver com isso. O resumo compara igual.
 *
 * ### Por que loopback devolve `null`
 *
 * `127.0.0.1` não identifica ninguém: em desenvolvimento é TODO MUNDO (o que travaria a fila
 * inteira numa máquina só, e impediria qualquer teste de ponta a ponta), e em produção é o
 * sintoma de um proxy mal configurado — nesse caso o servidor inteiro viraria "uma casa só" e
 * ninguém jamais encontraria partida. Falhar para o lado de PERMITIR é o certo aqui: uma
 * proteção anti-multiconta que derruba a fila de todo mundo é pior do que a ausência dela.
 *
 * O aviso sai UMA vez por processo, porque é um sintoma de infraestrutura e não um evento —
 * uma linha por jogador que entra na fila afogaria o log sem dizer nada de novo.
 */
export const resumoDeIp = (ip) => {
  const s = String(ip ?? '').trim();
  if (!s) return null;
  if (LOOPBACK.has(s)) {
    if (!avisouLoopback && config.shardId === config.arenaShardId) {
      avisouLoopback = true;
      console.warn(
        '[pvp] IP de loopback na fila — o bloqueio de contas da mesma casa está DESLIGADO. '
        + 'Normal em desenvolvimento; em produção, confira o X-Forwarded-For do proxy.',
      );
    }
    return null;
  }
  return createHash('sha256').update(`pvp:${s}`).digest('hex').slice(0, 16);
};

/**
 * Apaga a memória de encontros e revanches do Redis.
 *
 * Só é chamada quando a escada é zerada de verdade (ver `zerarEscadaUmaVez`). Sem ela, o
 * reset fica pela metade: a tabela volta ao zero mas o par que se enfrentou ontem continua
 * marcado, e a primeira partida da escada nova já sai valendo metade dos pontos "por
 * revanche" — um desconto por um encontro que, para o placar que existe agora, nunca houve.
 *
 * `KEYS` é varredura, e aqui isso é aceitável de propósito: roda no boot, uma vez na vida do
 * banco, com o jogo ainda subindo. Num caminho quente seria `SCAN`.
 */
export async function limparMemoriaDeEncontros() {
  try {
    const chaves = [...(await pub.keys('pvp:enc:*')), ...(await pub.keys('pvp:rev:*'))];
    if (chaves.length) await pub.del(...chaves);
    return chaves.length;
  } catch (err) {
    console.error('[pvp] limpeza dos encontros falhou:', err.message);
    return 0;
  }
}

// ------------------------------------------------------------------ ganchos

let ganchos = {
  /** Sobe um aviso na tela de um jogador deste processo (quando ele é local). */
  aviso: () => {},
};
export const ligarGanchosRanqueado = (g) => (ganchos = { ...ganchos, ...g });

/**
 * Empurra um pacote para um jogador online em QUALQUER gateway do cluster.
 *
 * O mesmo caminho ponto a ponto do sussurro: a presença diz onde está o socket e o publish
 * vai só para aquele canal. Não passa pelo sim dono do jogador de propósito — não há estado
 * de ranqueado na memória de sim nenhum para sincronizar.
 */
async function entregar(key, msg) {
  const gw = await gatewayDoJogador(key);
  if (!gw) return false;
  publicar(canalGateway(gw), { para: key, msg });
  return true;
}

/**
 * Avisa o shard DONO do jogador que o rank dele mudou.
 *
 * O snapshot de estado carrega o rank para a ficha do treinador (o emblema e o PR aparecem
 * fora da aba de PvP), e esse campo é um cache lido no login. Quem escreve `pvp_rank` é este
 * processo, que quase nunca é o dono — sem este aviso, o emblema da ficha ficaria congelado
 * na foto do login até o jogador reconectar.
 *
 * Uma publicação por lado por partida. É barato porque o pacote não leva o rank: leva só
 * "releia" — mandar o valor abriria a porta para o shard dono gravar um número mais velho do
 * que o do banco se dois avisos chegassem fora de ordem.
 *
 * `decaiu` vem da queda por inatividade (`verificarDecaimentoPvp`): o dono relê do mesmo jeito,
 * mas avisa a tela e NÃO religa a fila automática — ninguém jogou partida nenhuma.
 */
export const avisarRankMudou = (key, { decaiu = null } = {}) =>
  publicar(canalSim(shardDoJogador(key)), {
    t: 'pvp.rank.mudou', playerId: key, ...(decaiu ? { decaiu } : {}),
  });

// -------------------------------------------------------------------- a fila

const lerEntrada = (raw) => {
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
};

/** A entrada de um jogador na fila, ou `null`. */
export async function entradaDaFila(key) {
  try {
    const raw = await pub.hget(CHAVE_FILA, key);
    return raw ? lerEntrada(raw) : null;
  } catch {
    return null;
  }
}

/** Quantos estão na fila agora (com fantasmas incluídos — é um número de tela). */
export async function tamanhoDaFila() {
  try {
    return (await pub.hlen(CHAVE_FILA)) ?? 0;
  } catch {
    return 0;
  }
}

/** Quanto falta, em ms, da espera entre partidas. `0` = liberado. */
export async function msDeCooldown(key) {
  try {
    const ttl = await pub.pttl(chaveCooldown(key));
    return ttl > 0 ? ttl : 0;
  } catch {
    return 0;
  }
}

/**
 * Coloca o jogador na fila.
 *
 * Chamada pelo shard DONO dele, que é quem tem o nível, o gateway e o IP em memória. Tudo o
 * que entra na entrada é do servidor: o cliente não manda um único campo desta estrutura.
 *
 * @returns `{ ok:true, entrada }` | `{ ok:false, motivo, msg }`
 */
export async function entrarNaFila({ key, nick, dbId, nivel, gatewayId, ip }, agora = Date.now()) {
  if (!key || !dbId) return { ok: false, motivo: 'sessao', msg: 'Sessão inválida.' };
  if ((nivel ?? 0) < PVP_NIVEL_MIN) {
    return {
      ok: false,
      motivo: 'nivel',
      msg: `O PvP ranqueado é a partir do nível ${PVP_NIVEL_MIN} (seu nv ${nivel ?? 0}).`,
    };
  }

  const espera = await msDeCooldown(key);
  if (espera > 0) {
    return {
      ok: false,
      motivo: 'cooldown',
      msg: `Aguarde ${Math.ceil(espera / 1000)}s para entrar na fila de novo.`,
      restaMs: espera,
    };
  }

  // A equipe é conferida contra o BANCO, e não contra o que o cliente diz ter escolhido: quem
  // entra na fila com a equipe vazia entraria numa partida que perde sozinha.
  const time = await pvpdb.timeSalvo(dbId);
  if (time.length < PVP_TIME_MIN) {
    return { ok: false, motivo: 'time', msg: 'Monte sua equipe de PvP antes de entrar na fila.' };
  }

  const linha = await pvpdb.rankDe(dbId);
  const entrada = {
    key,
    nick,
    dbId: Number(dbId),
    pontos: linha?.pontos ?? 0,
    partidas: linha?.partidas ?? 0,
    desde: agora,
    visto: agora,
    gatewayId: gatewayId ?? null,
    ip: resumoDeIp(ip),
  };

  // `HSET` sobrescreve: entrar duas vezes é entrar uma vez, com o relógio de espera
  // reiniciado. Reiniciar é o comportamento certo — quem saiu e voltou abriu mão da espera
  // que já tinha, e sem isso um jogador ficaria alternando fila/cancelar para acumular uma
  // janela larga sem nunca ficar exposto a uma partida.
  await pub.hset(CHAVE_FILA, key, JSON.stringify(entrada));
  return { ok: true, entrada };
}

/** Tira o jogador da fila. `true` se ele realmente estava lá. */
export async function sairDaFila(key) {
  if (!key) return false;
  try {
    return (await pub.hdel(CHAVE_FILA, key)) > 0;
  } catch {
    return false;
  }
}

/**
 * Renova o carimbo de vida das entradas deste shard.
 *
 * O sim chama com as chaves dos jogadores DELE que estão na fila. Uma escrita por lote, não
 * uma por jogador: com a fila cheia isso seria uma rajada de comandos a cada seis segundos
 * para não mudar nada além de um número.
 */
export async function baterPonto(chaves, agora = Date.now()) {
  if (!chaves?.length) return 0;
  let n = 0;
  try {
    const brutos = await pub.hmget(CHAVE_FILA, ...chaves);
    const escritas = [];
    for (let i = 0; i < chaves.length; i++) {
      const e = brutos[i] ? lerEntrada(brutos[i]) : null;
      if (!e) continue;
      e.visto = agora;
      escritas.push(chaves[i], JSON.stringify(e));
      n++;
    }
    if (escritas.length) await pub.hset(CHAVE_FILA, ...escritas);
  } catch { /* Redis fora do ar: a entrada expira e o jogador reentra. Não derruba o tick. */ }
  return n;
}

// ------------------------------------------------------------- o pareamento

/**
 * Reivindica os dois lados num comando só — a trava que faz o cancelamento ser honesto.
 *
 * O cancelamento (`pvp.fila.sair`) e o pareamento correm em processos diferentes, e sem
 * atomicidade existe uma janela em que os dois "ganham": o pareador leu a fila e vai simular,
 * o jogador cancelou e a tela dele já diz "fora da fila" — e aí chega o resultado de uma
 * partida que, para ele, nunca começou.
 *
 * O script decide isso de um lado só: ou os DOIS campos ainda existem e somem juntos, ou nada
 * acontece e o par é descartado. Quem cancelou antes cancelou de verdade; quem cancelou
 * depois cancelou uma fila em que já não estava.
 */
const LUA_RECLAMAR_PAR = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 and redis.call('HEXISTS', KEYS[1], ARGV[2]) == 1 then
  redis.call('HDEL', KEYS[1], ARGV[1], ARGV[2])
  return 1
end
return 0`;

async function reclamarPar(a, b) {
  try {
    const r = await pub.eval(LUA_RECLAMAR_PAR, 1, CHAVE_FILA, a, b);
    return Number(r) === 1;
  } catch (err) {
    console.error('[pvp] reivindicação do par falhou:', err.message);
    return false;
  }
}

/** Recoloca na fila quem foi reclamado mas não chegou a lutar, preservando a espera original. */
async function devolverAFila(entrada) {
  if (!entrada) return;
  try {
    await pub.hset(CHAVE_FILA, entrada.key, JSON.stringify(entrada));
  } catch { /* perdeu o lugar na fila; a tela ainda mostra "na fila" e ele reentra sozinho */ }
}

/**
 * Os dois podem se enfrentar?
 *
 * As três recusas, em ordem de quanto pesam:
 *
 *   `revanche`  o par se enfrentou nos últimos `REVANCHE_MS`.
 *   `janela`    a diferença de pontos é maior do que a paciência do MENOS paciente dos dois.
 *
 * ### E a mesma casa?
 *
 * Duas contas do mesmo IP NÃO são recusadas aqui — são despriorizadas em `emparelhar` (só
 * casam quando não há mais ninguém) e a partida delas vale **zero ponto** (ver `pesoDoPar`).
 *
 * A primeira versão as barrava de vez, e estava errada por duas pontas. A prática: o dono do
 * jogo não conseguia testar o próprio PvP com duas contas, e irmãos, república e lan house
 * simplesmente nunca se encontrariam — sem nenhum aviso, só uma fila que não anda. E a
 * teoria: o que se quer impedir não é o ENCONTRO, é o LUCRO. Zerar o ganho impede o lucro
 * direto, e impede melhor: um bloqueio se contorna com um celular na rede móvel, um peso
 * zero não.
 *
 * @returns `null` quando podem, ou o código da recusa
 */
function porqueNaoPodem(a, b, agora, rivais, semRevanche) {
  if (a.key === b.key) return 'euMesmo';
  // Os DOIS sentidos. `registrarEncontro` escreve nos dois, então normalmente basta um — mas
  // "normalmente" não serve aqui: um pipeline do Redis pode falhar pela metade, e a ordem da
  // fila muda a cada passada (é por tempo de espera). Com a checagem num sentido só, o par
  // escaparia do bloqueio assim que a ordem invertesse.
  // `semRevanche` é chave de desenvolvimento e não existe em produção (ver `config.mjs`).
  // Ela pula só a ESPERA de 10 min; o peso de revanche continua valendo e a partida seguinte
  // entre os mesmos dois rende metade, depois um quarto, e do quinto encontro em diante nada.
  if (!semRevanche
      && (rivais.get(a.key)?.has(b.key) || rivais.get(b.key)?.has(a.key))) return 'revanche';
  if (!aceitamSeMutuamente(a, b, agora)) return 'janela';
  return null;
}

/** Os dois vêm da mesma casa? (`null` de um dos lados = endereço desconhecido, não conta.) */
export const mesmaCasa = (a, b) => !!(a?.ip && b?.ip && a.ip === b.ip);

/**
 * Emparelha a fila inteira: quem espera há mais tempo escolhe primeiro, e escolhe o mais
 * PRÓXIMO em pontos que o aceite.
 *
 * ### Por que esta ordem, e não "o par mais próximo do mundo primeiro"
 *
 * As duas produzem partidas parecidas quando a fila é pequena, e divergem no caso que
 * importa: um jogador de rank extremo (o único Challenger online) contra uma fila cheia de
 * Ouro. Casando os pares globalmente mais próximos primeiro, todos os Ouro se resolvem entre
 * si e o Challenger fica para o fim — de novo, e de novo, e de novo. Dando a vez a quem
 * esperou mais, ele escolhe assim que a janela dele abre o suficiente.
 *
 * ### E por que "o mais próximo que me aceite" é o que segura a qualidade
 *
 * A janela diz o que é ACEITÁVEL; ela não escolhe. Um Challenger que esperou dez minutos tem
 * janela infinita, mas se houver outro Challenger na fila é com ele que a partida sai — a
 * busca é pelo menor `|Δpontos|`, não pelo primeiro que couber. É isso que deixa a janela
 * abrir rápido (uma necessidade, com esta população) sem que as partidas fiquem ruins.
 */
export function emparelhar(entradas, agora, rivais = new Map(), { semRevanche } = {}) {
  // O padrão vem do ambiente, mas é PARÂMETRO de propósito: sem isso, um `.env` de
  // desenvolvimento com `PVP_SEM_REVANCHE=1` desligaria em silêncio os testes que guardam o
  // bloqueio — foi exatamente o que aconteceu quando a chave nasceu lendo `config` direto
  // aqui dentro. Teste que depende do `.env` de quem o roda não guarda nada.
  const pularRevanche = semRevanche ?? config.pvpSemRevanche;
  const fila = [...entradas].sort((x, y) => x.desde - y.desde);
  const teto = paresPorPasso(fila.length);
  const usados = new Set();
  const pares = [];

  for (const a of fila) {
    if (usados.has(a.key) || pares.length >= teto) continue;
    let melhor = null;
    let melhorDist = Infinity;
    // A mesma casa entra numa lista à parte: só é usada quando NÃO sobrou mais ninguém.
    // Assim o par legítimo sempre ganha do par doméstico, e a fila não trava quando as duas
    // únicas pessoas online moram juntas.
    let melhorCasa = null;
    let melhorCasaDist = Infinity;
    for (const b of fila) {
      if (b.key === a.key || usados.has(b.key)) continue;
      if (porqueNaoPodem(a, b, agora, rivais, pularRevanche)) continue;
      const d = Math.abs(a.pontos - b.pontos);
      // Empate de distância decide por quem espera há mais tempo — `fila` já está nessa
      // ordem, então o `<` estrito basta: o primeiro encontrado é o mais antigo.
      if (mesmaCasa(a, b)) {
        if (d < melhorCasaDist) {
          melhorCasaDist = d;
          melhorCasa = b;
        }
      } else if (d < melhorDist) {
        melhorDist = d;
        melhor = b;
      }
    }
    const par = melhor ?? melhorCasa;
    if (!par) continue;
    usados.add(a.key);
    usados.add(par.key);
    pares.push([a, par]);
  }
  return pares;
}

// ------------------------------------------------------------------ a partida

/**
 * Um pokémon da coleção, pronto para o simulador: stats no nível de arena dele e HP cheio.
 *
 * O nível passa por `nivelNoGinasio` — o ranqueado usa a MESMA régua do pódio dos 18 ginásios
 * (inteiro até 150, raiz daí para cima; ver o cabeçalho de `shared/ginasios.mjs`). Antes aqui
 * era o nível cru, e este era o único dos três palcos competitivos que não passava por régua
 * nenhuma: com stat linear no nível, um nv 10.000 entrava valendo 66× um nv 150 e o
 * nascimento — IV, qualidade, potência, shiny — parava de decidir a partida.
 */
function paraCombate(pk) {
  const esp = pk.esp ?? especies.get(pk.speciesId);
  if (!esp) return null;
  const nivel = nivelNoGinasio(pk.level);
  const stats = calcularStats(
    esp, pk.ivs, nivel, pk.quality, multDeNascenca(pk.potencia, pk.shiny), pk.refino,
  );
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

/**
 * Um jogador vira um "lado" da simulação — uma guild de um membro só.
 *
 * `simularGuerra` fala em guilds porque nasceu para a Guerra de Guilds. Com exatamente duas
 * de um membro cada, ela usa os pontos de nascimento fixos do recorte (`gin-a`/`gin-b`) e a
 * ordem da lista, que é o duelo — o mesmo caminho que o desafio de ginásio já percorre.
 */
function montarLado(entrada, pokemons, perfil, idx) {
  const equipe = pokemons.map(paraCombate).filter(Boolean);
  if (!equipe.length) return null;
  return {
    id: idx,
    nome: entrada.nick,
    brasao: null,
    membros: [{
      playerId: entrada.dbId,
      nick: entrada.nick,
      looktype: perfil?.looktype ?? 159,
      visual: empacotarVisual(perfil?.visual),
      equipe,
    }],
  };
}

/**
 * Marca que este par se enfrentou — é o que alimenta a espera de `REVANCHE_MS`.
 *
 * Já contava também QUANTAS vezes o par se encontrou em 24 h, para o peso de revanche. O peso
 * saiu (ver `rodarPartida`), e o contador foi junto: chave no Redis que ninguém lê é lixo que
 * envelhece em silêncio.
 */
async function registrarEncontro(a, b, agora = Date.now()) {
  try {
    // O bloqueio de revanche, nos DOIS sentidos: cada um entra na lista do outro. O TTL da
    // chave é folgado (o dobro da janela) porque quem expira membro é a faxina por nota em
    // `rivaisRecentes`; isto aqui só evita que a lista de um jogador que sumiu fique no
    // Redis para sempre.
    await pub.pipeline()
      .zadd(chaveRivais(a), agora, b)
      .zadd(chaveRivais(b), agora, a)
      .pexpire(chaveRivais(a), REVANCHE_MS * 2)
      .pexpire(chaveRivais(b), REVANCHE_MS * 2)
      .exec();
  } catch { /* o Redis fora do ar não pode impedir a partida de ser gravada */ }
}

/**
 * Quem cada um da fila enfrentou dentro da janela de revanche.
 *
 * Uma consulta por pessoa, num pipeline só — e não uma por PAR (ver `chaveRivais`). O
 * `ZREMRANGEBYSCORE` na mesma passada é a faxina: sem ele o sorted set de um jogador antigo
 * cresceria para sempre, guardando adversários de meses atrás que a janela já não bloqueia.
 *
 * @returns `Map<key, Set<key>>` — os rivais recentes de cada um. Vazio se o Redis falhar, e
 *          isso é uma escolha: a alternativa seria não parear ninguém. O bloqueio é uma
 *          proteção contra repetição, não contra fraude — quem de fato mata o conluio é o
 *          MESMA CASA, que é lida no momento da partida e não depende disto.
 */
async function rivaisRecentes(entradas, agora) {
  const mapa = new Map();
  if (!entradas.length) return mapa;
  const limite = agora - REVANCHE_MS;
  try {
    const p = pub.pipeline();
    for (const e of entradas) {
      p.zremrangebyscore(chaveRivais(e.key), '-inf', `(${limite}`);
      p.zrange(chaveRivais(e.key), 0, -1);
    }
    const res = await p.exec();
    for (let i = 0; i < entradas.length; i++) {
      // Duas respostas por jogador (a faxina e a leitura); a que interessa é a segunda.
      const [erro, lista] = res[i * 2 + 1] ?? [];
      mapa.set(entradas[i].key, new Set(erro ? [] : lista ?? []));
    }
  } catch (err) {
    console.error('[pvp] leitura dos rivais recentes falhou:', err.message);
  }
  return mapa;
}

/** A luta em si, entre dois lados já montados — a mesma arena e as mesmas regras sempre. */
async function duelar(ladoA, ladoB) {
  const arena = arenaDeDuelo();
  const r = await simularGuerra([ladoA, ladoB], {
    // Devolve o event loop ao tick do jogo a cada 40 passos — a simulação de uma partida
    // inteira não pode segurar o processo que também está rodando as hunts de um shard.
    aoRespirar: () => new Promise((ok) => setImmediate(ok)),
    arenaSlug: arena.slug,
    gradeInteira: arena.gradeInteira,
    ordemFixa: true,
  });
  return { arena, r };
}

/**
 * O DUELO do ranqueado, sem fila e sem pontos — é a luta que o Campeonato usa.
 *
 * Lá quem escolhe o par é a chave, e o resultado não mexe em PR; o que precisa ser igual é a
 * batalha: a mesma conversão de pokémon (`paraCombate`, com a régua de nível dos ginásios), a
 * mesma arena e o mesmo simulador. Uma segunda montagem aqui seria um campeonato jogado com
 * regras que o jogador nunca treinou.
 *
 * `a` e `b`: `{ dbId, nick, looktype, visual, pokemons }` — `pokemons` no formato de
 * `pvpdb.equipesDaPartida` (a espécie é refeita pelo `speciesId` se não vier junto).
 *
 * @returns `{ semTime: [bool, bool] }` quando um dos lados não tem lutador; senão
 *          `{ venceuA, replay, motivo, duracaoMs, placar, versao, arena }`.
 */
export async function simularDuelo(a, b) {
  const ladoA = montarLado(a, a.pokemons ?? [], a, 1);
  const ladoB = montarLado(b, b.pokemons ?? [], b, 2);
  if (!ladoA || !ladoB) return { semTime: [!ladoA, !ladoB] };
  const { arena, r } = await duelar(ladoA, ladoB);
  return {
    venceuA: r.vencedorId === ladoA.id,
    replay: r.replay,
    motivo: r.motivo,
    duracaoMs: r.duracaoMs,
    placar: r.placar,
    versao: VERSAO_REPLAY,
    arena: arena.slug,
  };
}

/**
 * Roda UMA partida entre dois jogadores já reivindicados da fila.
 *
 * A ordem é a que importa: simula → calcula → GRAVA → entrega. Se o processo morrer no meio,
 * o pior caso é uma partida que não aconteceu para ninguém (as duas entradas já saíram da
 * fila e os dois reentram); nunca uma em que só um lado recebeu os pontos.
 *
 * @returns `{ ok:true, partida }` | `{ ok:false, motivo, devolver }`
 */
export async function rodarPartida(a, b) {
  const [equipes, ranks, perfis] = await Promise.all([
    pvpdb.equipesDaPartida([a.dbId, b.dbId]),
    pvpdb.ranksDe([a.dbId, b.dbId]),
    perfisDe([a.dbId, b.dbId]),
  ]);

  const ladoA = montarLado(a, equipes.get(a.dbId) ?? [], perfis.get(a.dbId), 1);
  const ladoB = montarLado(b, equipes.get(b.dbId) ?? [], perfis.get(b.dbId), 2);

  // Um lado sem lutador é quem vendeu (ou anunciou) a equipe inteira enquanto esperava. NÃO é
  // derrota: o oponente volta para a fila com a espera que já tinha, e quem ficou sem time
  // leva um aviso. Tratar como derrota abriria a porta oposta — bastaria anunciar a equipe no
  // Mercado para escolher a hora de perder.
  if (!ladoA || !ladoB) {
    return {
      ok: false,
      motivo: 'semTime',
      semTime: [!ladoA ? a : null, !ladoB ? b : null].filter(Boolean),
      devolver: [ladoA ? a : null, ladoB ? b : null].filter(Boolean),
    };
  }

  const { arena, r } = await duelar(ladoA, ladoB);

  const venceuA = r.vencedorId === ladoA.id;
  const linhaA = ranks.get(a.dbId);
  const linhaB = ranks.get(b.dbId);
  // Não deveria acontecer (`ranksDe` cria a linha que faltar), mas se acontecer os DOIS
  // voltam para a fila com a espera que tinham. Devolver a lista vazia seria tirá-los da
  // fila em silêncio: a tela deles continuaria dizendo "procurando" para sempre, contra
  // uma fila em que já não estão.
  if (!linhaA || !linhaB) return { ok: false, motivo: 'semRank', devolver: [a, b] };

  // A ÚNICA regra que zera uma partida é a mesma casa: dois jogadores do mesmo endereço podem
  // se enfrentar (a fila não trava e o dono do jogo consegue testar), mas não movem ponto —
  // impede o LUCRO sem impedir o encontro.
  //
  // O peso de revanche (1ª vez inteiro, 2ª metade, do 5º encontro em diante ZERO) FOI RETIRADO.
  // Ele foi escrito contra duas contas combinadas, e numa população deste tamanho pegava o
  // alvo errado: o topo da tabela se reencontra o tempo todo por não haver mais ninguém na
  // faixa, e passava a jogar de graça — relatado com quatro vitórias seguidas valendo +0.
  //
  // O que segura o conluio sem esse efeito colateral: a mesma casa zera, a espera de
  // `REVANCHE_MS` limita o par a poucas partidas por hora, e o próprio Elo se defende — quem
  // só ganha do mesmo oponente vê a expectativa subir para perto de 1, e o ganho encolhe para
  // 1 PR sozinho. Farmar uma conta amiga rende menos do que jogar a fila.
  const peso = mesmaCasa(a, b) ? 0 : 1;
  const { deltaA, deltaB } = deltaDaPartida(linhaA, linhaB, venceuA, peso);

  const apA = aplicarDelta(linhaA, deltaA);
  const apB = aplicarDelta(linhaB, deltaB);

  const registroA = {
    playerId: a.dbId, nick: a.nick, antes: linhaA.pontos, depois: apA.pontos,
    delta: apA.deltaAplicado, escudo: apA.escudo, tierTopo: apA.tierTopo, venceu: venceuA,
  };
  const registroB = {
    playerId: b.dbId, nick: b.nick, antes: linhaB.pontos, depois: apB.pontos,
    delta: apB.deltaAplicado, escudo: apB.escudo, tierTopo: apB.tierTopo, venceu: !venceuA,
  };

  // A FICHA, tirada da fita ANTES de ela ser descartada — ver `pvp-analise.mjs`. É a única
  // janela em que isto pode ser feito: daqui a três linhas o `r.replay` viaja para os dois
  // jogadores e nunca mais existe em lugar nenhum.
  //
  // Dentro de um `try` porque um relatório é enfeite e uma partida não é: se a análise
  // estourar (fita com uma forma que ela não esperava), a partida é gravada sem ficha e a vida
  // segue. O contrário — perder o resultado de uma partida já jogada por causa da tela de
  // estatísticas — seria trocar o que importa pelo que não importa.
  let detalhe = null;
  try {
    detalhe = fichaDaPartida(r.replay, { nickA: a.nick, nickB: b.nick });
  } catch (err) {
    console.error('[pvp] ficha da partida falhou:', err.message);
  }

  const gravada = await pvpdb.gravarPartida(registroA, registroB, {
    motivo: r.motivo, duracaoMs: r.duracaoMs, peso, detalhe,
  });

  // A POSIÇÃO nova, lida DEPOIS de gravar. É ela que decide se o jogador é Challenger,
  // Mestre ou "tem os pontos e espera vaga" (ver `rankComVaga`) — sem ela, o cartão de
  // resultado desenharia Diamante I para quem acabou de entrar no top 20. Duas consultas por
  // partida, e partida é coisa rara.
  const [posA, posB] = await Promise.all([
    pvpdb.posicaoNaLadder(a.dbId, PVP_PARTIDAS_POSICIONAMENTO).catch(() => null),
    pvpdb.posicaoNaLadder(b.dbId, PVP_PARTIDAS_POSICIONAMENTO).catch(() => null),
  ]);

  await registrarEncontro(a.key, b.key);
  await Promise.all([
    pub.set(chaveCooldown(a.key), '1', 'PX', PVP_ENTRE_PARTIDAS_MS).catch(() => {}),
    pub.set(chaveCooldown(b.key), '1', 'PX', PVP_ENTRE_PARTIDAS_MS).catch(() => {}),
  ]);

  return {
    ok: true,
    partida: {
      id: gravada.id,
      versao: VERSAO_REPLAY,
      arena: arena.slug,
      replay: r.replay,
      motivo: r.motivo,
      duracaoMs: r.duracaoMs,
      placar: r.placar,
      peso,
      mesmaCasa: mesmaCasa(a, b),
      ladoA: { ...registroA, entrada: a, aplicado: apA, posicao: posA, partidas: linhaA.partidas + 1 },
      ladoB: { ...registroB, entrada: b, aplicado: apB, posicao: posB, partidas: linhaB.partidas + 1 },
    },
  };
}

/** Nick, boneco e cores dos dois lados — o replay desenha os treinadores de verdade. */
async function perfisDe(ids) {
  const { rows } = await pool.query(
    `SELECT id, nick, looktype, visual, level FROM players WHERE id = ANY($1::bigint[])`,
    [ids.map(Number)],
  );
  return new Map(rows.map((r) => [Number(r.id), r]));
}

/**
 * O pacote que cada lado recebe: a fita, quem era o outro, e o que aconteceu com os pontos.
 *
 * O `delta` vai junto do replay, e não depois: o cliente só o REVELA quando a fita termina
 * (ver `pintarReplay` no app.js), mas segurá-lo no servidor significaria uma segunda viagem
 * que pode não chegar — e aí o jogador assistiria à própria vitória sem nunca ver o número.
 */
function pacoteDaPartida(partida, euLadoA) {
  const eu = euLadoA ? partida.ladoA : partida.ladoB;
  const ele = euLadoA ? partida.ladoB : partida.ladoA;
  return {
    id: partida.id,
    versao: partida.versao,
    replay: partida.replay,
    motivo: partida.motivo,
    duracaoMs: partida.duracaoMs,
    venci: eu.venceu,
    delta: eu.delta,
    antes: eu.antes,
    pontos: eu.depois,
    posicao: eu.posicao ?? null,
    partidas: eu.partidas,
    mesmaCasa: !!partida.mesmaCasa,
    escudoUsou: eu.aplicado.escudoUsou,
    promoveu: eu.aplicado.promoveu,
    rebaixou: eu.aplicado.rebaixou,
    peso: partida.peso,
    oponente: { nick: ele.nick, pontos: ele.antes },
    // O lado do replay em que EU estou — o player pinta a minha coluna em destaque.
    meuLado: euLadoA ? 1 : 2,
  };
}

// ---------------------------------------------------------------- a passada

let rodando = false;
let ultimaPassada = 0;
let ultimaExplicacao = 0;

/** De quanto em quanto tempo o pareador explica uma fila parada. */
const EXPLICAR_A_CADA_MS = 60_000;

/**
 * Por que ninguém casou nesta passada.
 *
 * Só existe para ser lido no log quando alguém pergunta "por que minhas duas contas não se
 * encontram?". Sem ela, a resposta exige instrumentar o servidor no meio do problema;
 * com ela, está escrito.
 */
function explicarFilaParada(vivas, agora, rivais) {
  if (agora - ultimaExplicacao < EXPLICAR_A_CADA_MS) return;
  ultimaExplicacao = agora;
  // AMOSTRA, e não a fila inteira: contar o motivo de todo par é O(N²), e numa fila de mil
  // pessoas isso seria meio milhão de comparações para escrever uma linha de log. Vinte
  // entradas dizem a mesma coisa.
  const amostra = vivas.slice(0, 20);
  const motivos = new Map();
  for (let i = 0; i < amostra.length; i++) {
    for (let j = i + 1; j < amostra.length; j++) {
      // O log de diagnóstico segue a mesma regra do pareador — senão ele culparia a revanche
      // por uma fila parada num ambiente onde a revanche está desligada.
      const m = porqueNaoPodem(amostra[i], amostra[j], agora, rivais, config.pvpSemRevanche) ?? 'podiam';
      motivos.set(m, (motivos.get(m) ?? 0) + 1);
    }
  }
  const detalhe = amostra
    .slice(0, 8)
    .map((e) => `${e.key}(${e.pontos}pr, ${Math.round((agora - e.desde) / 1000)}s, janela ${Math.round(janelaDeBusca(agora - e.desde))})`)
    .join(' · ');
  console.log(
    `[pvp] ${vivas.length} na fila, nenhum par — ${[...motivos].map(([k, n]) => `${k}:${n}`).join(' ')} | ${detalhe}`,
  );
}

/** Só o dono das tarefas de mundo pareia. Ver o cabeçalho. */
export const souOPareador = () => config.shardId === config.arenaShardId;

/**
 * Uma passada do pareador: lê a fila, casa o que dá, roda as partidas.
 *
 * `rodando` segura a reentrada porque uma passada com seis partidas leva bem mais que os dois
 * segundos do relógio — e duas passadas simultâneas leriam a mesma fila e tentariam reclamar
 * os mesmos pares (o script Lua as protegeria, mas seria trabalho jogado fora).
 */
export async function rodarMatchmaking(agora = Date.now()) {
  if (!souOPareador()) return null;
  if (rodando || agora - ultimaPassada < PASSO_MATCHMAKING_MS) return null;
  ultimaPassada = agora;
  rodando = true;
  try {
    return await umaPassada(agora);
  } catch (err) {
    console.error('[pvp] matchmaking falhou:', err.message);
    return null;
  } finally {
    rodando = false;
  }
}

async function umaPassada(agora) {
  let bruto;
  try {
    bruto = await pub.hgetall(CHAVE_FILA);
  } catch {
    return null;
  }
  const chaves = Object.keys(bruto ?? {});
  if (chaves.length < 2) return { fila: chaves.length, pares: 0 };

  const vivas = [];
  const mortas = [];
  for (const k of chaves) {
    const e = lerEntrada(bruto[k]);
    // Entrada sem batida de vida é de um jogador que caiu (ou de um processo de simulação
    // que morreu). Sai da fila em vez de virar um oponente que não existe.
    if (!e || agora - (e.visto ?? 0) > FILA_TTL_MS) mortas.push(k);
    else vivas.push(e);
  }
  if (mortas.length) await pub.hdel(CHAVE_FILA, ...mortas).catch(() => {});
  if (vivas.length < 2) return { fila: vivas.length, pares: 0 };

  const rivais = await rivaisRecentes(vivas, agora);
  const pares = emparelhar(vivas, agora, rivais);

  // Fila com gente e nenhum par: diz POR QUÊ, uma vez por minuto. É a diferença entre "as
  // duas contas não se acham e não sei por quê" e uma linha de log dizendo que a janela
  // ainda está em 25 PR e a diferença entre elas é 340.
  if (!pares.length && vivas.length >= 2) explicarFilaParada(vivas, agora, rivais);

  let feitas = 0;
  for (const [a, b] of pares) {
    if (!(await reclamarPar(a.key, b.key))) continue;
    try {
      const r = await rodarPartida(a, b);
      if (!r.ok) {
        for (const e of r.devolver ?? []) await devolverAFila(e);
        for (const e of r.semTime ?? []) {
          entregar(e.key, {
            t: 'pvp',
            filaRecusa: { motivo: 'time', msg: 'Sua equipe de PvP ficou vazia — monte outra.' },
          }).catch(() => {});
        }
        continue;
      }
      feitas++;
      avisarRankMudou(a.key);
      avisarRankMudou(b.key);
      await Promise.all([
        entregar(a.key, { t: 'pvp', partida: pacoteDaPartida(r.partida, true) }),
        entregar(b.key, { t: 'pvp', partida: pacoteDaPartida(r.partida, false) }),
      ]);
    } catch (err) {
      console.error(`[pvp] partida ${a.key} × ${b.key} falhou:`, err.message);
      // A partida não aconteceu: os dois voltam para a fila com a espera que tinham. Sem
      // isto, um erro na simulação tiraria os dois da fila em silêncio e a tela deles ficaria
      // "procurando" para sempre.
      await devolverAFila(a);
      await devolverAFila(b);
    }
  }
  return { fila: vivas.length, pares: feitas };
}

// ------------------------------------------------------------------- a tela

/**
 * Tudo o que a aba do PvP ranqueado precisa, num pacote só.
 *
 * Vai junto porque a tela mostra tudo de uma vez: rank, equipe, tabela e histórico. Quatro
 * idas ao servidor para desenhar uma aba seria uma aba que aparece aos pedaços.
 */
export async function infoRanqueado(dbId, key) {
  const [linha, time, hist, top, total, fila, entrada, cooldown, naoVistas] = await Promise.all([
    pvpdb.rankDe(dbId),
    pvpdb.timeSalvo(dbId),
    pvpdb.historico(dbId, 12),
    pvpdb.ladder(100, PVP_PARTIDAS_POSICIONAMENTO), // a Tabela da aba PvP mostra o top 100
    pvpdb.totalClassificados(PVP_PARTIDAS_POSICIONAMENTO),
    tamanhoDaFila(),
    entradaDaFila(key),
    msDeCooldown(key),
    pvpdb.partidasNaoVistas(dbId, 5),
  ]);

  const posicao = linha && linha.partidas >= PVP_PARTIDAS_POSICIONAMENTO
    ? await pvpdb.posicaoNaLadder(dbId, PVP_PARTIDAS_POSICIONAMENTO)
    : null;

  return {
    // A POSIÇÃO entra aqui, e o esquecimento disso é visível: sem ela `rankComVaga` não tem
    // como saber de vaga nenhuma, e um Challenger via o próprio cartão dizer "Diamante I,
    // aguardando vaga" enquanto a tabela ao lado — que passa a posição — o mostrava em 1º.
    rank: pvpdb.rankParaCliente(linha, posicao, { comPrazo: true }),
    posicao,
    totalClassificados: total,
    time,
    historico: hist,
    // Cada linha da tabela já sabe a própria posição (`ladder` a devolve), e é ela que decide
    // o emblema: as 20 primeiras são Challenger, até a 50ª é Mestre.
    ladder: top.map((l, i) => ({ pos: i + 1, ...pvpdb.rankParaCliente(l, l.posicao ?? i + 1) })),
    fila: {
      na: !!entrada,
      desde: entrada?.desde ?? 0,
      tamanho: fila,
      // A janela é recalculada no CLIENTE a cada quadro (é o que faz a tela dizer "buscando
      // em Ouro II–Platina I" enquanto o relógio corre). Este valor é só o ponto de partida.
      janela: entrada ? janelaDeBusca(Date.now() - entrada.desde) : null,
      cooldownMs: cooldown,
    },
    naoVistas,
    regras: {
      nivelMin: PVP_NIVEL_MIN,
      posicionamento: PVP_PARTIDAS_POSICIONAMENTO,
      entrePartidasMs: PVP_ENTRE_PARTIDAS_MS,
      revancheMs: REVANCHE_MS,
    },
  };
}

// ------------------------------------------------------------------ testes
//
// Exposta para `tools/teste-pvp-rank.mjs` conferir a normalização do par pelas funções DE
// VERDADE — um teste que reimplementasse a regra testaria a própria cópia, e é justamente
// aqui que uma cópia divergindo silenciosamente deixaria de bloquear uma revanche.

export const _testeChaveDoPar = chaveDoPar;
