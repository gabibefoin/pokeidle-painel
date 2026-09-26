// Barramento entre gateways e workers de simulação, em cima do Redis.
//
// Três fluxos:
//   comando   gateway → sim:<shard>     (o shard é derivado do playerId)
//   saída     sim     → gw:<gatewayId>  (volta exatamente para o gateway que tem o socket)
//   chat      qualquer → chat            (todos os gateways assinam e espalham)
//
// O caminho é o mesmo com 1 ou com 20 processos. Em ROLE=all as mensagens ainda passam pelo
// Redis — de propósito: o código exercitado em dev é o mesmo que roda em produção.
import Redis from 'ioredis';
import { config, shardDoJogador } from './config.mjs';
import { SERVIDOR } from './protocol.mjs';
import { ehPacoteCru, paraCabeNoCru, criarSaidaEmLote } from './saida-crua.mjs';

const opts = { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: true };

export const pub = new Redis(config.redisUrl, opts);
export const sub = new Redis(config.redisUrl, opts);

/**
 * O Redis pode cair, e isso NÃO pode derrubar o jogo — mesma armadilha do pool do Postgres.
 *
 * Cliente do `ioredis` é EventEmitter, e EventEmitter que emite `'error'` sem ouvinte **lança**.
 * A reconexão automática do `ioredis` não salva de nada se o processo morre no primeiro erro:
 * ela existe justamente para atravessar a queda, e só funciona se alguém estiver escutando.
 *
 * O log é ESTRANGULADO de propósito. Redis fora do ar emite um erro por tentativa de reconexão,
 * várias por segundo; despejar tudo no journal esconde o resto do que aconteceu naquele minuto
 * e é o tipo de ruído que faz um incidente parecer maior do que é. Uma linha a cada 30 s, com a
 * contagem do que foi engolido, diz a mesma coisa e cabe na tela.
 *
 * `janelaMs` é parâmetro só para o teste conseguir provar as duas metades — a primeira linha
 * que sai na hora e o `+N iguais` da seguinte — sem esperar meio minuto. Em produção ninguém
 * passa o argumento.
 */
export function ligarLogDeErro(cliente, nome, janelaMs = 30_000) {
  let ultimo = 0;
  let engolidos = 0;
  cliente.on('error', (err) => {
    engolidos++;
    const agora = Date.now();
    if (agora - ultimo < janelaMs) return;
    const repetidos = engolidos - 1;
    ultimo = agora;
    engolidos = 0;
    console.error(
      `[bus] ${nome}: ${err.message}`
      + (repetidos > 0 ? ` (+${repetidos} iguais nos últimos ${Math.round(janelaMs / 1000)} s)` : ''),
    );
  });
}
ligarLogDeErro(pub, 'publicador');
ligarLogDeErro(sub, 'assinante');

const handlers = new Map(); // canal -> Set<fn>

export async function conectarBus() {
  await Promise.all([pub.connect(), sub.connect()]);
  sub.on('message', (canal, raw) => {
    // Pacote cru (sim → gateway, ver `saida-crua.mjs`): vai direto para quem sabe recortá-lo, sem o
    // JSON.parse que ele existe para evitar.
    if (ehPacoteCru(raw)) {
      const fnCru = handlersCru.get(canal);
      if (!fnCru) return;
      try {
        fnCru(raw);
      } catch (err) {
        console.error(`[bus] handler cru de ${canal} falhou:`, err.message);
      }
      return;
    }
    const fns = handlers.get(canal);
    if (!fns?.size) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    for (const fn of fns) {
      try {
        fn(msg);
      } catch (err) {
        console.error(`[bus] handler de ${canal} falhou:`, err.message);
      }
    }
  });
}

export async function assinar(canal, fn) {
  if (!handlers.has(canal)) {
    handlers.set(canal, new Set());
    await sub.subscribe(canal);
  }
  handlers.get(canal).add(fn);
}

export const publicar = (canal, msg) => pub.publish(canal, JSON.stringify(msg));

const handlersCru = new Map(); // canal -> fn(raw)

/**
 * Assina um canal que recebe PACOTES CRUS (`saida-crua.mjs`). O JSON que chegar no mesmo canal
 * continua indo para quem chamou `assinar` — os dois convivem.
 */
export async function assinarCru(canal, fn) {
  handlersCru.set(canal, fn);
  if (!handlers.has(canal)) {
    handlers.set(canal, new Set());
    await sub.subscribe(canal);
  }
}

// ------------------------------------------------------- saída para os gateways

/**
 * Interruptor de emergência do pacote cru. `SAIDA_CRUA=0` volta a publicar um JSON por jogador,
 * como antes — o gateway entende os dois formatos o tempo todo, então basta um restart do sim.
 */
const SAIDA_CRUA = process.env.SAIDA_CRUA !== '0';

// `canalDe` e `agendar` como funções: `canalGateway` só é definido mais abaixo neste arquivo.
const saidaEmLote = criarSaidaEmLote({
  publicar: (canal, pacote) => pub.publish(canal, pacote),
  agendar: (fn) => setImmediate(fn),
  canalDe: (gatewayId) => canalGateway(gatewayId),
  tipoWelcome: SERVIDOR.WELCOME,
});

/**
 * Manda mensagens a UM jogador pelo gateway dele — em lote.
 *
 * Os registros se acumulam por gateway e saem em pacotes de até `LIMITE_PACOTE` no fim da volta do
 * laço (`setImmediate`): o tick de um shard, que eram centenas de publishes, vira alguns por gateway.
 * A ordem é a de chamada — dentro do registro de um jogador e entre os registros —, a mesma que os
 * publishes separados tinham no socket do Redis. Ver `criarSaidaEmLote`.
 */
export function enviarAoGateway(gatewayId, para, msgs) {
  if (!SAIDA_CRUA || !paraCabeNoCru(para)) {
    publicar(canalGateway(gatewayId), msgs.length === 1 ? { para, msg: msgs[0] } : { para, msgs });
    return;
  }
  saidaEmLote.enviar(gatewayId, para, msgs);
}

// ------------------------------------------------------------------- rotas

export const canalSim = (shard) => `sim:${shard}`;
export const canalGateway = (gatewayId) => `gw:${gatewayId}`;
export const CANAL_CHAT = 'chat';
/** O painel mexeu na whitelist de IPs; todo gateway derruba o cache dela na hora. */
export const CANAL_WHITELIST = 'origens:whitelist';
/**
 * O painel baniu (ou desbaniu) um IP: todo gateway derruba o cache dos banidos e, no ban,
 * fecha na hora os sockets que saem por aquela rede. `{ ipBucket, banido }`.
 */
export const CANAL_IP_BANIDO = 'origens:ip-banido';
/** Avisos globais na tela de todos os jogadores conectados (ex.: captura de shiny). */
export const CANAL_GLOBAL = 'global';
/**
 * O buff de EVENTO que o painel admin liga para o mundo inteiro.
 *
 * Canal próprio, e não `global`: aquele é fan-out do GATEWAY para os sockets, e este é o
 * contrário — quem precisa ouvir é todo SIM, para trocar o multiplicador em memória. Cada um
 * avisa depois os jogadores dele pelo snapshot normal.
 */
export const CANAL_EVENTO = 'evento';
/** Acréscimos manuais na contagem online — todo gateway recarrega o cache ao ouvir. */
export const CANAL_ONLINE_EXTRA = 'online-extra';
/**
 * Guild apagada pela moderação. Todo SIM precisa ouvir, não só o dono do shard.
 *
 * Os membros de uma guild estão espalhados pelos shards (o shard é do JOGADOR, a guild não é
 * de ninguém), então avisar só um deixaria metade da guild com o painel de uma guild que não
 * existe mais — e com o bônus dela ainda somando no farm até a próxima reconexão.
 */
export const CANAL_GUILD = 'guild';

/** Manda um comando de jogador para o worker que é dono dele. */
export const enviarParaSim = (playerId, msg) => publicar(canalSim(shardDoJogador(playerId)), msg);

/** Presença: quantos jogadores online no cluster inteiro. */
export const PRESENCA = 'presenca';
export const marcarOnline = (playerId, gatewayId) => pub.hset(PRESENCA, String(playerId), gatewayId);
export const marcarOffline = (playerId) => pub.hdel(PRESENCA, String(playerId));
export const contarOnline = () => pub.hlen(PRESENCA);

// ------------------------------------------- quantas contas de uma REDE estão on-line

/**
 * Quem está on-line AGORA por saída de rede — um hash por IP, campo por nick.
 *
 * ### Por que no Redis, e não num `Map` do processo
 *
 * O gateway escala horizontalmente: quatro abas do mesmo jogador podem cair em quatro
 * processos diferentes, e um contador local veria 1 em cada um. O estado tem de ser do
 * CLUSTER, como a presença logo acima — e é por isso que ele mora aqui.
 *
 * ### O campo é o NICK, não o socket
 *
 * Duas abas da mesma conta são UMA conta on-line, e têm de continuar entrando: o F5 é o caso
 * comum (o socket novo chega antes de o antigo fechar) e recusá-lo seria um bug que aparece
 * para todo mundo, não só para quem tem várias contas. Com o nick como campo, o `HSET` da
 * segunda aba é idempotente e o `HLEN` não se mexe.
 *
 * ### O valor é o gatewayId
 *
 * É o que deixa `limparOnlineDoGateway` varrer o que um processo morto deixou para trás, do
 * mesmo jeito que `limparPresencaDoGateway` faz com a presença. Sem isso, um gateway que cai
 * com quatro jogadores dentro deixa a rede deles trancada até o TTL vencer.
 */
export const chaveOnlineIp = (ipBucket) => `iponline:${ipBucket}`;

/**
 * Uma rede pode ficar sem uso por muito tempo, e uma chave órfã (processo morto de forma
 * violenta, antes de qualquer limpeza) não pode trancar a rede para sempre. Doze horas é mais
 * que qualquer sessão real e menos que "para sempre" — e é renovado a cada entrada.
 */
const TTL_ONLINE_IP = 12 * 3600;

/**
 * Tenta pôr esta conta no balde da rede, atomicamente.
 *
 * ### Por que Lua, e não HLEN seguido de HSET
 *
 * Ler e escrever em duas idas ao Redis abre a janela clássica: dois sockets novos leem 3,
 * os dois se acham o quarto, e a rede fica com 5. Com o jogador do outro lado abrindo quatro
 * navegadores ao mesmo tempo, essa corrida não é teórica — é o uso normal da feature. O
 * script roda inteiro dentro do Redis, então ou o quarto entra e o quinto vê 4, ou o
 * contrário; nunca os dois entram.
 *
 * @returns {{pode:boolean, contagem:number}} `contagem` é quantos estão na rede DEPOIS
 *   (quando entrou) ou o que barrou a entrada (quando não entrou).
 */
const LUA_ENTRAR = `
local nick, gw, limite, ttl = ARGV[1], ARGV[2], tonumber(ARGV[3]), tonumber(ARGV[4])
-- Já estava na rede: é outra aba da MESMA conta, e ela nunca é barrada.
if redis.call('HEXISTS', KEYS[1], nick) == 1 then
  redis.call('HSET', KEYS[1], nick, gw)
  redis.call('EXPIRE', KEYS[1], ttl)
  return {1, redis.call('HLEN', KEYS[1])}
end
local n = redis.call('HLEN', KEYS[1])
-- limite <= 0 e "sem teto" (IP na whitelist, ou regra desligada), mas a conta entra no balde
-- do mesmo jeito. Contar sempre e o que mantem honesta a coluna "on-line agora" do painel:
-- o IP na whitelist e justamente aquele em que o moderador precisa ver o numero real.
-- (Sem crase e sem acento aqui dentro: isto e Lua morando numa template string de JS.)
if limite > 0 and n >= limite then return {0, n} end
redis.call('HSET', KEYS[1], nick, gw)
redis.call('EXPIRE', KEYS[1], ttl)
return {1, n + 1}
`;

/**
 * `limite` é o teto; `0` (ou negativo) quer dizer SEM teto — e mesmo assim a conta é contada.
 *
 * Separar "contar" de "barrar" é o que deixa o painel mostrar quantas contas uma rede isenta
 * tem jogando agora. Pular o registro para quem está na whitelist seria cegar exatamente a
 * medida que decide se aquela isenção continua fazendo sentido.
 */
export async function entrarNaRede({ ipBucket, playerId, gatewayId, limite }) {
  const chave = String(ipBucket ?? '').trim();
  // Sem IP legível não há balde nenhum, e passa. Mesma regra do teto de cadastro, e pela mesma
  // razão: recusar um jogador por uma falha NOSSA de leitura é perda pura.
  if (!chave) return { pode: true, contagem: 0 };
  try {
    const [pode, contagem] = await pub.eval(
      LUA_ENTRAR, 1, chaveOnlineIp(chave),
      String(playerId), String(gatewayId), String(Number(limite) || 0), String(TTL_ONLINE_IP),
    );
    return { pode: Number(pode) === 1, contagem: Number(contagem) };
  } catch (err) {
    console.error('[rede] não deu para contar quem está on-line:', err.message);
    return { pode: true, contagem: 0 };
  }
}

/** Tira a conta do balde da rede — no `close` do socket. */
export async function sairDaRede(ipBucket, playerId) {
  const chave = String(ipBucket ?? '').trim();
  if (!chave) return;
  try {
    await pub.hdel(chaveOnlineIp(chave), String(playerId));
  } catch {
    // O TTL da chave é a rede de segurança: pior caso, a vaga volta sozinha em 12 h.
  }
}

/** Quem está on-line nesta rede agora — o painel usa para mostrar a foto do momento. */
export async function quemEstaNaRede(ipBucket) {
  const chave = String(ipBucket ?? '').trim();
  if (!chave) return [];
  try {
    return Object.keys(await pub.hgetall(chaveOnlineIp(chave)));
  } catch {
    return [];
  }
}

/**
 * Quais gateways estão VIVOS — o registro que torna a faxina dos baldes possível.
 *
 * ### Por que isto precisou existir
 *
 * `limparPresencaDoGateway` é chamada no boot com o id do processo que está subindo, e o
 * `gatewayId` é um UUID novo a cada boot (ver o topo de `gateway.mjs`). Ou seja: no boot ela
 * procura entradas de um id que nunca existiu antes, e não casa nada. Para a presença isso
 * custa uma contagem de on-line inflada até alguém reparar.
 *
 * Para os baldes de rede o preço é MUITO maior: um gateway que morre com quatro jogadores de
 * uma casa dentro deixa as quatro vagas ocupadas por sockets que não existem — e aquela
 * família fica trancada fora do jogo até o TTL de 12 h vencer, sem nada a fazer a respeito.
 * Um limite anti-abuso que tranca jogador honesto por doze horas depois de um deploy ruim é
 * pior do que não ter limite nenhum.
 *
 * Então cada gateway carimba que está vivo a cada `INTERVALO_VIVO`, e quem não carimba há mais
 * de `LIMITE_VIVO` é dado como morto. Não é um consenso, e não precisa ser: errar para o lado
 * de "achei que estava morto" solta vagas a mais por alguns minutos, e o re-carimbo de
 * `reafirmarOnline` conserta sozinho no ciclo seguinte.
 */
const GW_VIVOS = 'gwvivos';
export const INTERVALO_VIVO = 20_000;
const LIMITE_VIVO = 90_000;

export const marcarGatewayVivo = (gatewayId) => pub.hset(GW_VIVOS, gatewayId, Date.now());
export const esquecerGateway = (gatewayId) => pub.hdel(GW_VIVOS, gatewayId);

/** Os gateways que carimbaram faz pouco. De quebra, poda os que não carimbam mais. */
export async function gatewaysVivos() {
  const todos = await pub.hgetall(GW_VIVOS);
  const agora = Date.now();
  const vivos = new Set();
  const mortos = [];
  for (const [id, ts] of Object.entries(todos)) {
    if (agora - Number(ts) < LIMITE_VIVO) vivos.add(id);
    else mortos.push(id);
  }
  if (mortos.length) await pub.hdel(GW_VIVOS, ...mortos);
  return vivos;
}

/** Percorre os baldes de rede chamando `fn(chave, dentro)`. */
async function varrerBaldes(fn) {
  let cursor = '0';
  do {
    const [proximo, chaves] = await pub.scan(cursor, 'MATCH', 'iponline:*', 'COUNT', 200);
    cursor = proximo;
    for (const chave of chaves) await fn(chave, await pub.hgetall(chave));
  } while (cursor !== '0');
}

/**
 * Tira dos baldes tudo o que pertence a gateway que não existe mais.
 *
 * O `SCAN` é preferido ao `KEYS` porque isto roda num Redis que está servindo o jogo: `KEYS`
 * trava o servidor inteiro enquanto varre, e uma faxina de rotina não pode congelar o jogo.
 */
export async function limparOnlineOrfao() {
  const vivos = await gatewaysVivos();
  let limpos = 0;
  await varrerBaldes(async (chave, dentro) => {
    const orfaos = Object.entries(dentro).filter(([, gw]) => !vivos.has(gw)).map(([pid]) => pid);
    if (!orfaos.length) return;
    await pub.hdel(chave, ...orfaos);
    limpos += orfaos.length;
  });
  return limpos;
}

/**
 * Re-carimba as vagas que ESTE gateway realmente tem abertas.
 *
 * É o contrapeso de `limparOnlineOrfao`: se uma pausa longa (GC, máquina afogada, Redis lento)
 * fizer este processo parecer morto e as vagas dele forem varridas, o jogador continua jogando
 * — e sem isto a rede dele passaria a aceitar sessões a mais, em silêncio, para sempre. Com o
 * re-carimbo, o buraco dura no máximo um ciclo.
 */
export async function reafirmarOnline(gatewayId, pares) {
  if (!pares.length) return 0;
  const cano = pub.pipeline();
  for (const [ipBucket, playerId] of pares) {
    cano.hset(chaveOnlineIp(ipBucket), String(playerId), gatewayId);
    cano.expire(chaveOnlineIp(ipBucket), TTL_ONLINE_IP);
  }
  await cano.exec();
  return pares.length;
}

/**
 * Varre o que UM gateway específico deixou para trás.
 *
 * Continua exportada para o desligamento limpo (o processo tira as próprias vagas antes de
 * sair, em vez de esperar a faxina notar) e para o teste, que precisa simular um gateway morto
 * sem esperar os 90 s do heartbeat.
 */
export async function limparOnlineDoGateway(gatewayId) {
  let limpos = 0;
  await varrerBaldes(async (chave, dentro) => {
    const mortos = Object.entries(dentro).filter(([, gw]) => gw === gatewayId).map(([pid]) => pid);
    if (!mortos.length) return;
    await pub.hdel(chave, ...mortos);
    limpos += mortos.length;
  });
  return limpos;
}

/**
 * Em qual gateway está um jogador agora (`null` se off-line).
 *
 * É o que deixa o SUSSURRO ser ponto a ponto em vez de fan-out. O chat comum publica em
 * `CANAL_CHAT` e TODO gateway recebe TODA mensagem — o certo, porque toda mensagem interessa
 * a todo mundo. Um sussurro interessa a duas pessoas: com o gateway do destinatário em mãos,
 * o publish vai para um canal só e nenhum outro processo é acordado.
 */
export async function gatewayDoJogador(playerId) {
  const chave = String(playerId ?? '').toLowerCase();
  if (!chave) return null;
  try {
    return (await pub.hget(PRESENCA, chave)) ?? null;
  } catch {
    return null;
  }
}

/** Derruba o socket do jogador no gateway que o tem — usado pelo painel admin. */
export async function desconectarJogador(playerId, msg) {
  const chave = String(playerId ?? '').toLowerCase();
  if (!chave) return false;
  let gw;
  try {
    gw = await pub.hget(PRESENCA, chave);
  } catch {
    return false;
  }
  if (!gw) return false;
  publicar(canalGateway(gw), { para: chave, msg, kick: true });
  return true;
}

/**
 * Trava de posse do shard. Dois processos com o mesmo SHARD_ID assinariam o mesmo canal e
 * processariam os MESMOS jogadores em paralelo — cada comando executaria duas vezes e o
 * jogador receberia tudo duplicado. A trava faz o segundo processo recusar-se a subir.
 *
 * TTL curto + renovação: se o dono morrer, a trava expira sozinha e outro assume.
 */
export async function tomarPosseDoShard(shardId, instanceId, ttlMs = 15000) {
  const chave = `posse:sim:${shardId}`;
  const ok = await pub.set(chave, instanceId, 'PX', ttlMs, 'NX');
  if (!ok) {
    const dono = await pub.get(chave);
    return { ok: false, dono };
  }
  // renova enquanto estiver vivo
  const timer = setInterval(() => {
    pub.set(chave, instanceId, 'PX', ttlMs, 'XX').catch(() => {});
  }, ttlMs / 3);
  timer.unref?.();
  return { ok: true, liberar: () => pub.del(chave).catch(() => {}) };
}

/** Solta todas as travas de shard. Usado pelo `npm stop`, que mata os processos à força. */
export async function liberarTodasAsPosses() {
  const chaves = await pub.keys('posse:sim:*');
  if (chaves.length) await pub.del(...chaves);
  return chaves.length;
}

/**
 * Ocupação das Arenas PvP, para quem pergunta de um shard que NÃO é o dono delas.
 *
 * As arenas vivem inteiras no processo `config.arenaShardId` (ver o cabeçalho de
 * `game/pvp.mjs`) — um jogador perguntando "quem está lá dentro" de outro shard não tem
 * `vivas` em memória para responder. O dono publica aqui a cada segundo (mesmo ritmo de
 * `metricas`); o TTL de 5 s é só para não deixar um valor fantasma se aquele processo cair.
 */
export const publicarOcupacaoArenas = (dados) =>
  pub.set('arenaOcupacao', JSON.stringify(dados), 'EX', 5).catch(() => {});

export async function ocupacaoArenasCluster() {
  try {
    const raw = await pub.get('arenaOcupacao');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Métricas de todos os shards de simulação, para o /saude montar a visão do cluster. */
export async function metricasDoCluster() {
  const bruto = await pub.hgetall('metricas');
  const fora = {};
  for (const [shard, json] of Object.entries(bruto)) {
    try {
      const m = JSON.parse(json);
      // ignora shard que parou de reportar há mais de 10s (processo caiu)
      if (Date.now() - (m.ts ?? 0) < 10000) fora[shard] = m;
    } catch {}
  }
  return fora;
}

/** Limpa a presença deste gateway ao subir/cair (evita fantasmas após um crash). */
export async function limparPresencaDoGateway(gatewayId) {
  const todos = await pub.hgetall(PRESENCA);
  const mortos = Object.entries(todos)
    .filter(([, gw]) => gw === gatewayId)
    .map(([pid]) => pid);
  if (mortos.length) await pub.hdel(PRESENCA, ...mortos);
  return mortos.length;
}

// ------------------------------------------------------------------- mute do chat

const CHAT_MUTE_PREFIX = 'chat:mute:';
const CHAT_MUTES_ATIVOS = 'chat:mutes:ativos';

const chaveMuteNick = (nick) => `${CHAT_MUTE_PREFIX}${String(nick ?? '').toLowerCase()}`;

/** Lê o registro bruto do Redis — aceita o formato antigo (só timestamp). */
function parseMuteBruto(raw) {
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try {
      const o = JSON.parse(raw);
      if (Number(o.ate) > 0) return o;
    } catch { /* formato novo inválido */ }
    return null;
  }
  const ate = Number(raw);
  if (!Number.isFinite(ate) || ate <= 0) return null;
  return { ate, nick: null, porNick: null, porCargo: null, minutos: null, criadoEm: null };
}

async function lerMuteRegistro(nick) {
  const chave = String(nick ?? '').toLowerCase();
  if (!chave) return null;
  try {
    const raw = await pub.get(chaveMuteNick(chave));
    const o = parseMuteBruto(raw);
    if (!o || o.ate <= Date.now()) return null;
    return { ...o, nick: o.nick ?? chave, chave };
  } catch {
    return null;
  }
}

/** Timestamp (ms) até quando o nick está mutado, ou `0`. */
export async function muteChatAte(nick) {
  const reg = await lerMuteRegistro(nick);
  return reg?.ate ?? 0;
}

/**
 * Aplica (ou estende) mute de chat. Devolve o timestamp de expiração.
 * Se já estiver mutado, soma a partir do fim atual — não encurta punição.
 *
 * `meta`: { nick, porNick, porCargo, minutos } — gravado para o painel admin.
 */
export async function aplicarMuteChat(nick, segundos, meta = {}) {
  const chave = String(nick ?? '').toLowerCase();
  const dur = Number(segundos);
  if (!chave || !Number.isFinite(dur) || dur <= 0) return 0;
  const prev = await lerMuteRegistro(chave);
  const base = Math.max(prev?.ate ?? 0, Date.now());
  const ate = base + dur * 1000;
  const ttlSeg = Math.ceil((ate - Date.now()) / 1000);
  if (ttlSeg <= 0) return 0;

  const registro = {
    nick: String(meta.nick ?? nick).trim() || chave,
    ate,
    porNick: meta.porNick ?? null,
    porCargo: meta.porCargo ?? null,
    minutos: Number(meta.minutos) > 0 ? Number(meta.minutos) : Math.round(dur / 60),
    criadoEm: prev?.criadoEm ?? Date.now(),
  };
  await pub.set(chaveMuteNick(chave), JSON.stringify(registro), 'EX', ttlSeg);
  await pub.sadd(CHAT_MUTES_ATIVOS, chave);
  return ate;
}

/** Lista mutes ainda vigentes (para o painel admin). */
export async function listarMutesChat() {
  let chaves = [];
  try {
    chaves = await pub.smembers(CHAT_MUTES_ATIVOS);
  } catch {
    return [];
  }
  const agora = Date.now();
  const lista = [];
  for (const chave of chaves) {
    let raw;
    try {
      raw = await pub.get(chaveMuteNick(chave));
    } catch {
      continue;
    }
    const o = parseMuteBruto(raw);
    if (!o || o.ate <= agora) {
      await pub.srem(CHAT_MUTES_ATIVOS, chave).catch(() => {});
      if (raw) await pub.del(chaveMuteNick(chave)).catch(() => {});
      continue;
    }
    lista.push({
      nick: o.nick ?? chave,
      ate: o.ate,
      restanteMs: o.ate - agora,
      minutos: o.minutos ?? null,
      porNick: o.porNick ?? null,
      porCargo: o.porCargo ?? null,
      criadoEm: o.criadoEm ?? null,
    });
  }
  lista.sort((a, b) => (b.criadoEm ?? 0) - (a.criadoEm ?? 0));
  return lista;
}

/** Revoga mute antes da hora. Devolve `{ ok, nick }`. */
export async function revogarMuteChat(nick) {
  const chave = String(nick ?? '').toLowerCase();
  if (!chave) return { ok: false, nick: '' };
  const prev = await lerMuteRegistro(chave);
  await pub.del(chaveMuteNick(chave)).catch(() => {});
  await pub.srem(CHAT_MUTES_ATIVOS, chave).catch(() => {});
  return { ok: !!prev, nick: prev?.nick ?? nick };
}
