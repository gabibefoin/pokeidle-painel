// OS CAMPEONATOS no sim: o pacote da tela, a inscrição e o congelamento da chave no prazo.
//
// Tudo o que é regra (o calendário, o nível, as restrições, a ordem das seeds, a forma da chave)
// está em `shared/campeonato.mjs`; aqui é só onde essa regra encontra o banco e o jogador.
//
// ### Um campeonato virou um calendário
//
// Até a v1.136 havia UM campeonato, e este arquivo podia guardar a lista de inscritos numa
// variável de módulo. Agora há dois por mês, para sempre (Mundial no último dia, Amador no dia
// 15), e em qualquer instante existem até três vivos ao mesmo tempo: um jogando, um com
// inscrições abertas e um que ainda vai abrir. Por isso todo cache aqui é um `Map` POR ID, e
// toda função pública recebe o campeonato de que se está falando.
//
// A tela manda o id que ela está olhando; o servidor o reconstrói pelo calendário
// (`campeonatoPorId`) e recusa o que não sair dele. Nenhum id do cliente vira chave de consulta
// sem passar por ali — um `'2026-09-29'` (que não é dia de luta de ninguém) simplesmente não
// existe, e não há tabela arbitrária a consultar com ele.
//
// ### As listas ficam alguns segundos em memória
//
// A tela do campeonato lê quem está inscrito e em que seed, e a seed provisória custa uma janela
// sobre a tabela do ranqueado inteira. Segurar o resultado por `CACHE_MS` põe um teto de uma
// consulta dessas por intervalo por campeonato por processo, não importa quantos jogadores
// abram a aba. Quem se inscreve ou sai invalida a cópia do próprio processo e recebe a lista
// nova; os outros shards enxergam em até `CACHE_MS`, que numa lista de inscrição é invisível.
//
// ### As partidas
//
// Passado o prazo, `avancarCampeonatos` joga a chave em ONDAS (ver `shared/campeonato.mjs`): a
// cada `intervaloOndaMs`, toda partida com os dois lados conhecidos é simulada com a luta do
// ranqueado (`simularDuelo`), com as equipes congeladas às 23h da véspera — no fim do dia de
// análise, e não no fim das inscrições, que é um dia antes. A onda é reclamada no banco antes de
// ser jogada, então dois processos nunca jogam a mesma; e o resultado é gravado de forma
// idempotente, então um processo que morre no meio de uma onda só atrasa as partidas que
// faltaram para a onda seguinte.
//
// ### As fitas são apagadas quando a janela fecha
//
// `faxinarReplays` roda junto do despertador e apaga o `BYTEA` das edições cuja janela de
// exibição venceu (ver `replaysAbertos`). É o que impede o banco de acumular ~10 MB de vídeo por
// edição, todo mês, para sempre. A chave continua desenhável — some o replay, não o resultado.
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import * as cdb from '../campeonato-db.mjs';
import * as pvpdb from '../pvp-ranqueado-db.mjs';
import { publicar, CANAL_GLOBAL } from '../bus.mjs';
import { SERVIDOR } from '../protocol.mjs';
import { empacotarVisual } from './visual.mjs';
import { simularDuelo } from './pvp-ranqueado.mjs';
import { PVP_PARTIDAS_POSICIONAMENTO } from '../../shared/pvp-rank.mjs';
import {
  campeonatoAtivo,
  campeonatoPorId,
  campeonatosVivos,
  compararSeeds,
  equipeAberta,
  equipeDoCampeonatoVale,
  faseDoCampeonato,
  inscricoesAbertas,
  listaDeCampeonatos,
  montarChave,
  podeInscrever,
  podioDaChave,
  replaysAbertos,
  replaysAte,
  resolverChave,
  temRestricao,
} from '../../shared/campeonato.mjs';

const gzipar = promisify(gzip);
const desgzipar = promisify(gunzip);

const CACHE_MS = 10_000;

/** Os três caches, todos por id de campeonato. */
const listas = new Map(); // id → { em, itens, promessa }
let listaCache = { em: 0, valor: null }; // a lista da tela (ver `listaParaCliente`)
const chaves = new Map(); // id → { em, valor }
const placares = new Map(); // id → { em, valor }

export function esquecerLista(id) {
  if (id) listas.delete(id);
  else listas.clear();
  // A lista da tela carrega a CONTAGEM de inscritos de cada edição — uma inscrição a invalida
  // tanto quanto invalida a lista de inscritos daquela edição.
  listaCache = { em: 0, valor: null };
}

/** Tudo o que a onda muda: o andamento, os resultados e (no pódio) a lista. */
function esquecerAndamento(id) {
  chaves.delete(id);
  placares.delete(id);
}

/**
 * Os inscritos de um campeonato na ordem das seeds, cada um com `seed` preenchida.
 *
 * Depois do congelamento a seed é a gravada. Antes, é a posição na ordem de `compararSeeds` —
 * a mesma conta que o congelamento vai fazer, então a tela nunca promete uma seed que o
 * fechamento vai trocar por outro motivo que não uma partida de ranqueado.
 */
export async function inscritosOrdenados(c, agora = Date.now()) {
  const atual = listas.get(c.id);
  if (atual?.itens && agora - atual.em < CACHE_MS) return atual.itens;
  if (atual?.promessa) return atual.promessa;
  const promessa = cdb.listarInscritos(c.id, PVP_PARTIDAS_POSICIONAMENTO)
    .then((linhas) => {
      const congelados = linhas.filter((l) => l.seed != null).sort((a, b) => a.seed - b.seed);
      const soltos = linhas
        .filter((l) => l.seed == null)
        .map((l) => ({
          ...l,
          pontos: l.rank?.pontos ?? 0,
          vitorias: l.rank?.vitorias ?? 0,
        }))
        .sort(compararSeeds);
      // Quem ficou sem seed depois do congelamento (não deveria existir: o prazo trava a
      // entrada antes) vai para o fim, sem número — melhor aparecer do que sumir.
      const temCongelamento = congelados.length > 0;
      const itens = [
        ...congelados,
        ...soltos.map((l, i) => ({ ...l, seed: temCongelamento ? null : i + 1 })),
      ];
      if (listas.get(c.id)?.promessa === promessa) listas.set(c.id, { em: Date.now(), itens, promessa: null });
      return itens;
    })
    .catch((err) => {
      if (listas.get(c.id)?.promessa === promessa) listas.delete(c.id);
      throw err;
    });
  listas.set(c.id, { em: 0, itens: null, promessa });
  return promessa;
}

async function chaveDoCampeonato(c, agora = Date.now()) {
  // A chave gerada ainda ANDA (a onda, o pódio), então a cópia vale só `CACHE_MS` como o resto.
  const atual = chaves.get(c.id);
  if (atual && agora - atual.em < CACHE_MS) return atual.valor;
  const valor = await cdb.chaveGerada(c.id);
  chaves.set(c.id, { em: agora, valor });
  return valor;
}

/** Os resultados já decididos, com a mesma validade curta. Vazio enquanto não há chave. */
async function resultadosDoCampeonato(c, agora = Date.now()) {
  const atual = placares.get(c.id);
  if (atual && agora - atual.em < CACHE_MS) return atual.valor;
  const valor = await cdb.resultados(c.id);
  placares.set(c.id, { em: agora, valor });
  return valor;
}

/**
 * Os ids da equipe ESCOLHIDA para QUALQUER campeonato que ainda não acabou.
 *
 * É o que o Auto Selecionar da oferenda não pode pegar (ver `oferenda.protegidos` no sim). Com
 * dois campeonatos por mês, um jogador pode ter equipe escolhida em mais de um ao mesmo tempo —
 * o Mundial que vai lutar amanhã e o Amador do mês que vem. As duas são protegidas.
 *
 * A equipe do PvP Ranqueado, que luta por quem não escolheu, entra por outro caminho.
 *
 * A ficha pública do treinador NÃO usa isto: ela mostra só a equipe do PvP Ranqueado, e a de
 * campeonato nunca sai do servidor para outro jogador.
 */
export async function equipeDoCampeonatoValendo(playerId, agora = Date.now()) {
  const vivos = listaDeCampeonatos(agora, { passados: 1 })
    .filter((c) => equipeDoCampeonatoVale(agora, c));
  if (!vivos.length) return [];
  const listasDeIds = await Promise.all(
    vivos.map((c) => cdb.equipeEscolhida(c.id, playerId).catch(() => null)),
  );
  return [...new Set(listasDeIds.flat().filter((n) => Number.isFinite(n)))];
}

/** O card de um inscrito, como a tela desenha. Sem id de banco. */
function cardDoInscrito(l, meuId) {
  const rank = l.rank ? pvpdb.rankParaCliente(l.rank, l.posicao) : null;
  return {
    nick: l.nick,
    looktype: l.looktype,
    vs: empacotarVisual(l.visual),
    nivel: l.nivel,
    seed: l.seed,
    eu: l.playerId === Number(meuId) || undefined,
    rank: rank && {
      posicao: rank.posicao,
      tierId: rank.tierId,
      divisaoNum: rank.divisaoNum,
      pontos: rank.pontos,
      partidas: rank.partidas,
      vitorias: rank.vitorias,
      derrotas: rank.derrotas,
    },
  };
}

/**
 * O campeonato de um id do CLIENTE, ou o ativo quando o id não veio (ou não existe).
 *
 * Só aceita STRING, e de propósito. A tentação era aceitar também um objeto de campeonato — os
 * testes precisam injetar uma edição de mentira, com datas no passado — e isso seria um buraco
 * de verdade: `campeonato.equipe` leva `m.id` direto do socket, e um cliente que mandasse
 * `{"id":{"id":"qualquer-coisa","equipeAte":9e15,"restricoes":{}}}` escolheria a própria régua,
 * escreveria numa chave de tabela inventada e passaria por cima da proibição de shiny.
 *
 * Quem precisa de uma edição de mentira chama as funções `…Em(c, …)`, que recebem o objeto e
 * nunca são alcançadas por uma mensagem do cliente.
 */
export function resolverCampeonato(id, agora = Date.now()) {
  return (typeof id === 'string' && id ? campeonatoPorId(id) : null) ?? campeonatoAtivo(agora);
}

/** O objeto de regras que vai no pacote da tela. */
const regrasParaCliente = (c, agora) => ({
  id: c.id,
  tipo: c.tipo,
  numero: c.numero,
  dia: c.dia,
  ultimoDiaInscricao: c.ultimoDiaInscricao,
  diaEquipe: c.diaEquipe,
  horaEquipe: c.horaEquipe,
  inscricoesDe: c.inscricoesDe,
  inscricoesAte: c.inscricoesAte,
  // O prazo da equipe é o que a faixa da tela obedece no dia de análise — a fase sozinha diria
  // "chaveado" e esconderia a escolha justamente no dia em que ela importa.
  equipeAte: c.equipeAte,
  equipeAberta: equipeAberta(agora, c),
  fimEm: c.fimEm,
  lutasEm: c.lutasEm,
  intervaloOndaMs: c.intervaloOndaMs,
  nivelMin: c.nivelMin,
  premios: c.premios,
  restricoes: c.restricoes,
  logo: c.logo,
  fase: faseDoCampeonato(agora, c),
  // Até quando as fitas deste campeonato podem ser abertas, e se ainda podem AGORA. A tela usa
  // os dois: o segundo para decidir se desenha o botão de assistir, o primeiro para escrever
  // "replays disponíveis até dia X" enquanto eles existem.
  replaysAte: replaysAte(c),
  replaysAbertos: replaysAbertos(c, agora),
});

/**
 * A LISTA de campeonatos, com o resumo de cada um. É o que a tela desenha antes de o jogador
 * escolher qual abrir.
 *
 * Segurada em memória pelos mesmos `CACHE_MS` do resto: a lista vai em TODO `campeonato.info`
 * (é a primeira coisa que a aba desenha), e sem cache cada abertura de aba custaria um
 * `GROUP BY` sobre as inscrições mais uma contagem de fitas por edição. A chave do cache é o
 * minuto de "agora" — a lista muda de conteúdo quando uma edição vira de fase, e não a cada
 * segundo.
 */
export async function listaParaCliente(agora = Date.now()) {
  if (listaCache.valor && agora - listaCache.em < CACHE_MS) return listaCache.valor;
  const valor = await montarLista(agora);
  listaCache = { em: agora, valor };
  return valor;
}

async function montarLista(agora) {
  const lista = listaDeCampeonatos(agora);
  const resumos = await cdb.resumos(lista.map((c) => c.id)).catch(() => new Map());
  return lista.map((c) => {
    const r = resumos.get(c.id) ?? {};
    return {
      ...regrasParaCliente(c, agora),
      inscritos: r.inscritos ?? 0,
      participantes: r.participantes ?? null,
      concluidaEm: r.concluidaEm ?? null,
      onda: r.onda ?? 0,
      // Quantas fitas ainda existem no banco. Zero numa edição encerrada quer dizer que a
      // faxina já passou — e é o que faz a tela escrever "replays indisponíveis" em vez de
      // oferecer um botão que não abre nada.
      comFita: r.comFita ?? 0,
      podio: r.podio ?? null,
    };
  });
}

/** Tudo o que a tela de UM campeonato precisa, num pacote só. */
export async function infoCampeonato({ dbId, nivel }, idPedido = null, agora = Date.now()) {
  const c = resolverCampeonato(idPedido, agora);
  if (!c) return { lista: [], campeonato: null };
  // Passou algum dos dois prazos e o congelamento correspondente ainda não rodou — o
  // despertador do tick roda de minuto em minuto, mas a tela não pode abrir numa fase
  // "chaveado" sem chave, nem depois das 23h dizendo que a equipe ainda dá para trocar.
  if (agora >= c.inscricoesAte) {
    const ja = await chaveDoCampeonato(c, agora);
    if (!ja || (!equipeAberta(agora, c) && !ja.equipesEm)) await verificarCampeonato(c, agora);
  }
  const [lista, itens, gerada, time, escolhida] = await Promise.all([
    listaParaCliente(agora),
    inscritosOrdenados(c, agora),
    chaveDoCampeonato(c, agora),
    pvpdb.timeSalvo(dbId).catch(() => []),
    cdb.equipeEscolhida(c.id, dbId).catch(() => null),
  ]);
  const res = gerada ? await resultadosDoCampeonato(c, agora) : new Map();
  const meu = itens.find((l) => l.playerId === Number(dbId));
  const timePvp = Array.isArray(time) ? time : [];
  const fitasAbertas = replaysAbertos(c, agora);
  return {
    lista,
    campeonato: regrasParaCliente(c, agora),
    servidorAgora: agora,
    total: itens.length,
    inscritos: itens.map((l) => cardDoInscrito(l, dbId)),
    eu: {
      inscrito: !!meu,
      seed: meu?.seed ?? null,
      pode: podeInscrever({ nivel, inscrito: !!meu, agora }, c),
      timePvp: timePvp.length,
      // A equipe que VAI lutar: a escolhida para o campeonato ou, sem ela, a do PvP Ranqueado.
      // Os ids vão crus — a tela desenha pela coleção dela e avisa de quem já não está lá; quem
      // confere a posse (e a restrição) de verdade é o congelamento.
      equipe: meu && escolhida
        ? { ids: escolhida, fonte: 'campeonato' }
        : { ids: timePvp, fonte: timePvp.length ? 'pvp' : null },
      // Depois do fechamento vale a CONGELADA: zero aqui é um campeonato inteiro de W.O.
      timeCongelado: meu?.equipeN ?? null,
    },
    chave: gerada,
    // Os resultados, SEM as fitas (elas vão por pedido, uma de cada vez: `campeonato.fita`).
    // `temReplay` já considera a JANELA: uma edição cuja faxina passou volta tudo `false`, e a
    // tela não desenha botão que não abre nada.
    partidas: [...res.entries()].map(([id, r]) => ({
      id,
      a: r.a,
      b: r.b,
      vencedor: r.vencedor,
      perdedor: r.perdedor,
      estado: r.estado,
      onda: r.onda,
      placar: r.placar ?? null,
      temReplay: r.temReplay && fitasAbertas,
    })),
  };
}

/** Inscreve. Lança `Error` com a chave de texto (`camp.recusa.*`) quando recusa. */
export async function inscrever({ dbId, nivel }, idPedido = null, agora = Date.now()) {
  const c = resolverCampeonato(idPedido, agora);
  if (!c) throw new Error('camp.recusa.encerradas');
  const inscrito = await cdb.estaInscrito(c.id, dbId);
  const pode = podeInscrever({ nivel, inscrito, agora }, c);
  if (!pode.ok) throw new Error(`camp.recusa.${pode.motivo}`);
  await cdb.inscrever(c.id, dbId);
  esquecerLista(c.id);
  return c;
}

/**
 * Escolhe a equipe de um campeonato (até cinco, na ordem). Lista vazia volta a valer a do PvP.
 *
 * A regra é a da equipe de PvP (`pvpdb.conferirTime`: posse, fora do Mercado, sem repetição, no
 * teto) MAIS a restrição da edição — no Amador, nem shiny nem P5. Vale até `equipeAte` (23h da
 * véspera), e NÃO até o fim das inscrições: o dia de análise inteiro é para isto, ajustar o time
 * contra o adversário que a chave já mostra. Lança `Error` com a chave de texto (`camp.recusa.*`)
 * quando recusa; devolve os ids.
 */
export async function escolherEquipe({ dbId }, pokemonIds, idPedido = null, agora = Date.now()) {
  return escolherEquipeEm(resolverCampeonato(idPedido, agora), { dbId }, pokemonIds, agora);
}

/** A mesma escolha, com o campeonato já em mãos. É por aqui que o teste injeta uma edição sua. */
export async function escolherEquipeEm(c, { dbId }, pokemonIds, agora = Date.now()) {
  if (!c || !equipeAberta(agora, c)) throw new Error('camp.recusa.equipeCongelada');
  let ids;
  try {
    ids = await pvpdb.conferirTime(dbId, pokemonIds, { campeonato: c });
  } catch (err) {
    if (err instanceof pvpdb.ErroPvp) {
      // `restrito` traz a chave de texto pronta na mensagem (`camp.recusa.semShiny` etc.) — ela
      // sai de `porQueNaoPodeLutar`, que é a mesma função que a tela usa para esconder o card.
      if (err.codigo === 'restrito') throw new Error(err.message);
      throw new Error(err.codigo === 'cheio' ? 'camp.recusa.equipeCheia' : 'camp.recusa.equipeSumiu');
    }
    throw err;
  }
  const r = await cdb.escolherEquipe(c.id, dbId, ids);
  if (r === 'congelada') throw new Error('camp.recusa.equipeCongelada');
  if (r === 'fora') throw new Error('camp.recusa.naoInscrito');
  return { ids, campeonato: c };
}

/** Tira a inscrição. Lança `Error` com a chave de texto quando recusa. */
export async function cancelar({ dbId }, idPedido = null, agora = Date.now()) {
  const c = resolverCampeonato(idPedido, agora);
  if (!c || !inscricoesAbertas(agora, c)) throw new Error('camp.recusa.encerradas');
  const saiu = await cdb.cancelar(c.id, dbId);
  if (!saiu) throw new Error('camp.recusa.naoInscrito');
  esquecerLista(c.id);
  return c;
}

const congelando = new Map();
const congelandoEquipes = new Map();

/**
 * O despertador do fechamento de UM campeonato. São DOIS momentos:
 *
 *   `inscricoesAte` (00:00 da véspera da véspera) — congela as seeds e publica a chave;
 *   `equipeAte`     (23:00 da véspera)            — tira o retrato das equipes.
 *
 * Todo shard chama; o banco decide quem grava (ver `congelarChave` e `congelarEquipes`). Aqui
 * só se evita que o mesmo processo entre duas vezes no mesmo campeonato enquanto a primeira
 * chamada não voltou.
 *
 * O segundo depende do primeiro — sem seed não há quem fotografar —, e por isso ele espera a
 * chave existir em vez de correr em paralelo: no minuto em que os dois vencem juntos (um shard
 * que subiu depois das 23h, por exemplo), a chave sai primeiro e as equipes na chamada seguinte.
 */
export async function verificarCampeonato(c, agora = Date.now()) {
  if (!c || agora < c.inscricoesAte) return null;
  // Quem chega com o congelamento em andamento espera o mesmo, em vez de seguir sem chave.
  if (congelando.has(c.id)) return congelando.get(c.id);
  const gerada = await chaveDoCampeonato(c, agora);
  if (!gerada) {
    const p = cdb.congelarChave(c.id, PVP_PARTIDAS_POSICIONAMENTO)
      .then((r) => {
        chaves.delete(c.id);
        esquecerLista(c.id);
        if (r.gerou) console.log(`[campeonato] chave ${c.id} (${c.tipo}) gerada com ${r.participantes} inscritos`);
        return r;
      })
      .finally(() => { congelando.delete(c.id); });
    congelando.set(c.id, p);
    return p;
  }
  if (equipeAberta(agora, c) || gerada.equipesEm) return null;
  return congelarEquipesAgora(c);
}

/**
 * Tira o retrato das equipes de um campeonato, uma vez por processo de cada vez.
 *
 * Fica à parte porque tem DOIS chamadores: o despertador acima, às 23h, e a rede de segurança
 * de `avancar` — que não deixa a primeira onda rodar sem retrato, mesmo que nenhum shard tenha
 * estado de pé no minuto das 23h. Sem ela, um campeonato inteiro sairia W.O.
 */
function congelarEquipesAgora(c) {
  if (congelandoEquipes.has(c.id)) return congelandoEquipes.get(c.id);
  const p = cdb.congelarEquipes(c.id, c)
    .then((r) => {
      chaves.delete(c.id);
      esquecerLista(c.id);
      if (r.gerou) console.log(`[campeonato] equipes de ${c.id} congeladas: ${r.equipes}`);
      return r;
    })
    .finally(() => { congelandoEquipes.delete(c.id); });
  congelandoEquipes.set(c.id, p);
  return p;
}

/** O despertador de TODOS os campeonatos vivos. É o que o tick do mundo chama. */
export async function verificarCampeonatos(agora = Date.now()) {
  for (const c of campeonatosVivos(agora)) {
    await verificarCampeonato(c, agora).catch((err) =>
      console.error(`[campeonato] verificação de ${c.id} falhou:`, err.message));
  }
}

// ------------------------------------------------------------- faxina das fitas

let ultimaFaxina = 0;
/** De quanto em quanto tempo vale a pena procurar fita vencida. Uma hora é de sobra. */
const FAXINA_MS = 60 * 60_000;

/**
 * Apaga as fitas das edições cuja janela de exibição fechou.
 *
 * A janela vence uma vez por mês, então procurar de hora em hora já é generoso. A consulta só
 * toca em edições ENCERRADAS e cuja janela passou, e o `UPDATE` tem `replay IS NOT NULL` — na
 * esmagadora maioria das rodadas ele não encontra linha nenhuma.
 */
export async function faxinarReplays(agora = Date.now()) {
  if (agora - ultimaFaxina < FAXINA_MS) return 0;
  ultimaFaxina = agora;
  let apagadas = 0;
  for (const c of listaDeCampeonatos(agora, { passados: 24 })) {
    if (agora < c.fimEm || replaysAbertos(c, agora)) continue;
    const n = await cdb.apagarReplaysVencidos(c.id).catch((err) => {
      console.error(`[campeonato] faxina de ${c.id} falhou:`, err.message);
      return 0;
    });
    if (n) {
      apagadas += n;
      esquecerAndamento(c.id);
      console.log(`[campeonato] ${n} fita(s) de ${c.id} apagadas — a janela de replay fechou`);
    }
  }
  return apagadas;
}

// ------------------------------------------------------------------ as partidas

/** `W.O.`: quem tem equipe vence; sem equipe dos dois lados, passa a melhor seed. */
function porWo(base, semA, semB) {
  const venceA = semA === semB ? base.a < base.b : semB;
  return {
    ...base,
    vencedor: venceA ? base.a : base.b,
    perdedor: venceA ? base.b : base.a,
    estado: 'wo',
    motivo: 'wo',
  };
}

/** Joga UMA partida pronta. Devolve a linha de resultado, com a fita já comprimida. */
async function jogarPartida(x, lutadores, onda) {
  const base = { id: x.partida.id, a: x.a.seed, b: x.b.seed, onda };
  const A = lutadores.get(base.a);
  const B = lutadores.get(base.b);
  const semA = !A?.pokemons?.length;
  const semB = !B?.pokemons?.length;
  if (semA || semB) return porWo(base, semA, semB);

  const d = await simularDuelo(A, B);
  if (d.semTime) return porWo(base, d.semTime[0], d.semTime[1]);
  const abates = (lado) => d.placar?.find((p) => p.id === lado)?.abates ?? 0;
  const fita = JSON.stringify({ versao: d.versao, arena: d.arena, replay: d.replay });
  return {
    ...base,
    vencedor: d.venceuA ? base.a : base.b,
    perdedor: d.venceuA ? base.b : base.a,
    estado: 'jogada',
    motivo: d.motivo,
    duracaoMs: Math.round(d.duracaoMs ?? 0),
    placar: { a: abates(1), b: abates(2) },
    replay: await gzipar(Buffer.from(fita), { level: 6 }),
  };
}

const avancando = new Map();

/**
 * O relógio das partidas de UM campeonato: joga a próxima onda se ela já venceu.
 *
 * `c` é o campeonato — o teste passa um de mentira, com as datas no passado e um id próprio.
 *
 * @returns `{ onda, partidas, concluido }` quando jogou; `null` quando não havia o que jogar.
 */
export function avancarCampeonato(c, agora = Date.now()) {
  if (!c) return Promise.resolve(null);
  if (avancando.has(c.id)) return avancando.get(c.id);
  const p = avancar(agora, c).finally(() => { avancando.delete(c.id); });
  avancando.set(c.id, p);
  return p;
}

/** O relógio de TODOS os campeonatos que já podem estar lutando. É o que o tick chama. */
export async function avancarCampeonatos(agora = Date.now()) {
  const feitos = [];
  for (const c of campeonatosVivos(agora)) {
    if (agora < c.lutasEm) continue;
    const r = await avancarCampeonato(c, agora).catch((err) => {
      console.error(`[campeonato] onda de ${c.id} falhou:`, err.message);
      return null;
    });
    if (r) feitos.push({ id: c.id, ...r });
  }
  return feitos;
}

async function avancar(agora, c) {
  if (agora < c.lutasEm) return null;
  let gerada = await cdb.chaveGerada(c.id);
  if (!gerada) {
    await cdb.congelarChave(c.id, PVP_PARTIDAS_POSICIONAMENTO);
    gerada = await cdb.chaveGerada(c.id);
  }
  if (!gerada || gerada.concluidaEm) return null;
  if (gerada.proximaOndaEm && agora < gerada.proximaOndaEm) return null;
  // A REDE DE SEGURANÇA do retrato: chegou a hora de lutar e as equipes não congelaram (nenhum
  // shard de pé às 23h, um deploy no meio da janela...). Congela agora, antes de qualquer
  // partida — `lutadores` lê a coluna `equipe`, e vazia ela é W.O. para todo mundo.
  if (!gerada.equipesEm) {
    await cdb.congelarEquipes(c.id, c);
    gerada = await cdb.chaveGerada(c.id);
    if (!gerada) return null;
  }

  const estrutura = montarChave(gerada.participantes);
  // Menos de dois inscritos não é campeonato: com um, ele é o campeão; com nenhum, fecha vazio.
  if (!estrutura) {
    await cdb.concluir(c.id, { campeao: gerada.participantes === 1 ? 1 : null, vice: null, terceiro: null });
    anunciar(c, gerada.onda, true);
    return { onda: gerada.onda, partidas: 0, concluido: true };
  }

  const res = await cdb.resultados(c.id);
  const prontas = [...resolverChave(estrutura, res).values()].filter((x) => x.pronta);
  if (!prontas.length) {
    const podio = podioDaChave(estrutura, res);
    if (podio) {
      await cdb.concluir(c.id, podio);
      anunciar(c, gerada.onda, true);
      return { onda: gerada.onda, partidas: 0, concluido: true };
    }
    console.error(`[campeonato] ${c.id}: chave parada — nenhuma partida pronta e sem campeão`);
    return null;
  }

  // Reclama ANTES de jogar: quem perde a disputa não simula nada.
  const onda = await cdb.reclamarOnda(c.id, gerada.onda, agora, agora + c.intervaloOndaMs);
  if (onda == null) return null;

  const lutadores = await cdb.lutadores(c.id);
  const novos = [];
  for (const x of prontas) {
    try {
      novos.push(await jogarPartida(x, lutadores, onda));
    } catch (err) {
      // Uma partida que falha fica para a onda seguinte; as outras seguem.
      console.error(`[campeonato] partida ${x.partida.id} falhou:`, err.message);
    }
  }
  await cdb.gravarResultados(c.id, novos);

  const todos = new Map(res);
  for (const n of novos) todos.set(n.id, n);
  const podio = podioDaChave(estrutura, todos);
  if (podio) await cdb.concluir(c.id, podio);

  console.log(`[campeonato] ${c.id}: onda ${onda} — ${novos.length} partida(s)${podio ? ' — encerrado' : ''}`);
  anunciar(c, onda, !!podio);
  return { onda, partidas: novos.length, concluido: !!podio };
}

/**
 * Avisa as telas: a chave andou. Só quem está com a aba aberta pede o pacote de novo — o aviso
 * não carrega a chave, que é grande e só interessa a quem está olhando.
 */
function anunciar(c, onda, concluido) {
  // Um campeonato de teste (id fora do calendário, ver `tools/teste-campeonato-partidas.mjs`)
  // não avisa ninguém: as telas só mostram os de verdade.
  if (!campeonatoPorId(c.id)) return;
  esquecerAndamento(c.id);
  esquecerLista(c.id);
  publicar(CANAL_GLOBAL, { t: SERVIDOR.CAMPEONATO, andou: { id: c.id, onda, concluido } }).catch(() => {});
}

/**
 * A fita de uma partida, pronta para o player: `{ partida, a, b, vencedor, replay }`, ou `null`.
 * Os lados vêm com o nick — o título do player é "Seed 3 · fulano × Seed 6 · ciclano".
 *
 * A JANELA é conferida aqui, e não só na tela: a fita de uma edição antiga não sai do servidor
 * nem para quem montar a mensagem à mão. (Na prática ela já foi apagada — mas a faxina roda de
 * hora em hora, e a janela fecha na hora certa.)
 */
export async function fitaDoCampeonato(idCampeonato, idPartida, agora = Date.now()) {
  const c = resolverCampeonato(idCampeonato, agora);
  if (!c || !replaysAbertos(c, agora)) return null;
  const id = String(idPartida ?? '').slice(0, 12);
  if (!/^(V|P)\d{1,2}-\d{1,4}$|^GF$/.test(id)) return null;
  const f = await cdb.fitaDaPartida(c.id, id);
  if (!f) return null;
  const pacote = JSON.parse((await desgzipar(f.replay)).toString());
  const itens = await inscritosOrdenados(c, agora);
  const lado = (seed) => ({ seed, nick: itens.find((i) => i.seed === seed)?.nick ?? null });
  return {
    campeonato: c.id,
    partida: f.id,
    a: lado(f.a),
    b: lado(f.b),
    vencedor: f.vencedor,
    replay: pacote.replay,
  };
}

export { temRestricao };
