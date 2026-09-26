// Gateway WebSocket: I/O puro, sem regra de jogo.
//
// Guarda o socket, traduz mensagem ↔ barramento e faz o fan-out do chat. É stateless em
// relação ao jogo, então dá para subir N réplicas atrás de um load balancer sem coordenação:
// quem tem o socket se identifica em `gw:<id>` e o worker responde nesse canal.
import { createServer } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';
import { config } from './config.mjs';
import {
  CLIENTE, SERVIDOR, CANAIS_CHAT, IDIOMAS_CHAT, CHAT_NIVEL_MIN, codificar, decodificar,
} from './protocol.mjs';
import { chatContemNft } from '../shared/chat-filtro.mjs';
import {
  assinar,
  canalGateway,
  CANAL_CHAT,
  CANAL_GLOBAL,
  publicar,
  enviarParaSim,
  marcarOnline,
  marcarOffline,
  contarOnline,
  gatewayDoJogador,
  limparPresencaDoGateway,
  entrarNaRede,
  sairDaRede,
  limparOnlineOrfao,
  marcarGatewayVivo,
  reafirmarOnline,
  INTERVALO_VIVO,
  CANAL_WHITELIST,
  CANAL_IP_BANIDO,
  metricasDoCluster,
  muteChatAte,
  aplicarMuteChat,
  revogarMuteChat,
  CANAL_ONLINE_EXTRA,
  assinarCru,
} from './bus.mjs';
import { carregar as carregarOnlineExtra, definirExtras, onlineExibido } from './online-extra.mjs';
import { lerPacoteCru } from './saida-crua.mjs';
import { metricas } from './sim.mjs';
import { rotasDeAuth } from './auth-rotas.mjs';
import { rotasDeAdmin } from './admin-rotas.mjs';
import { ipCliente, bucketDeIp } from './ip-cliente.mjs';
import { ipBanido, esquecerBanidos, registrarBloqueioDeIp } from './origens-db.mjs';
import { criarLimites, CHAT_COOLDOWN_MS } from './limites-ws.mjs';
import { rotasDeDiamantes, reconciliarPendentes } from './diamantes-rotas.mjs';
import { migrar as migrarDiamantes } from './diamantes-db.mjs';
import { rotasDeAfiliados } from './afiliados-rotas.mjs';
import { rotasDoTracker } from './tracker-rotas.mjs';
import { migrar as migrarAfiliados } from './afiliados-db.mjs';
import { rotasDeTopIdle, recuperarVotos, votoAtivo, JOGO_ID } from './topidle-rotas.mjs';
import { migrar as migrarTopIdle } from './topidle-db.mjs';
import { pagamentosAtivos, pixAtivo, cartaoAtivo } from './pagamentos.mjs';
import {
  migrar as migrarAuth, provedoresAtivos, lerSessao, contaPorId, valeRenovar, renovarSessao,
  URL_PUBLICA,
} from './auth.mjs';
import {
  migrar as migrarAdmin,
  ehAdminNoJogo,
  ehAdminPorNick,
  cargoPorNick,
  banDaConta,
  dispararAgendaDeEventos,
  CARGOS_MOD_CHAT,
  CARGOS_CMD_CHAT,
} from './admin.mjs';
import * as chatDb from './chat-db.mjs';
import { pool, travarMigracoes } from './db.mjs';
import { cabecalhosBase, csp, ehHttps, injetarNonce, nonceNovo } from './seguranca.mjs';
import { exigirChaveEmProducao } from './cofre.mjs';

const gatewayId = `gw-${randomUUID().slice(0, 8)}`;

/**
 * Freio do carimbo de origem: uma gravação por conta a cada 10 minutos, neste processo.
 *
 * O `hello` acontece a cada F5, a cada reconexão de wi-fi e a cada volta do celular do segundo
 * plano — e o `ON CONFLICT` do `registrarOrigem` transforma tudo isso em UPDATE na mesma linha.
 * Uma linha só, mas uma escrita por evento: uma aba em laço de reconexão (ou alguém abrindo
 * sockets de propósito com uma sessão válida) viraria gravação em rajada no Postgres por nada,
 * já que o dado é o mesmo.
 *
 * Dez minutos porque a pergunta que a tabela responde é "de onde esta conta entra", não "que
 * horas". Em memória e por processo: perder o freio num restart custa um UPDATE a mais.
 */
const CARIMBO_INTERVALO_MS = 600_000;
const carimboRecente = new Map();
function podeCarimbarOrigem(contaId) {
  const agoraMs = Date.now();
  const visto = carimboRecente.get(contaId);
  if (visto && agoraMs - visto < CARIMBO_INTERVALO_MS) return false;
  carimboRecente.set(contaId, agoraMs);
  return true;
}
// O balde não pode virar vazamento: a cada meia hora sai quem não aparece há dois intervalos.
setInterval(() => {
  const limite = Date.now() - CARIMBO_INTERVALO_MS * 2;
  for (const [id, quando] of carimboRecente) if (quando < limite) carimboRecente.delete(id);
}, 1_800_000).unref();

/** Grava no Postgres sem bloquear o fan-out — falha silenciosa. */
function persistirChat(msg) {
  if (msg.op === 'del' || !CANAIS_CHAT.includes(msg.canal)) return;
  chatDb.gravar(msg).catch((err) => console.error('[chat-db] gravar:', err.message));
}

/** Catálogo nosso — versionado no git, não no espelho gitignorado de public/data/. */
const dadosDir = resolve(config.raiz, 'src/server/dados');
const ASSETS_DADOS = {
  '/creatures-novos.json': join(dadosDir, 'creatures-novos.json'),
  '/creatures-outland-novos.json': join(dadosDir, 'creatures-outland-novos.json'),
  '/creatures-sprites-lab.json': join(dadosDir, 'creatures-sprites-lab.json'),
  '/creatures-audit-overrides.json': join(dadosDir, 'creatures-audit-overrides.json'),
};

/** Id único por mensagem de chat — o delete referencia isto, não o texto. */
const proximoIdChat = () => randomUUID();
const clientDir = resolve(config.raiz, 'src/client');
const sharedDir = resolve(config.raiz, 'src/shared');

/** Versão do jogo, do package.json. Uma fonte só — o rodapé do cliente lê daqui. */
const VERSAO = JSON.parse(readFileSync(resolve(config.raiz, 'package.json'), 'utf8')).version;

/** Acima disto, loga hello→welcome — é o tempo que o jogador fica na arte depois da barra 100%. */
const HELLO_LENTO_MS = 3000;

/** socket por playerId — só os que estão neste processo. */
const sockets = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  // A landing page abre com um laço de gameplay. Sem estes dois o vídeo sai como
  // `application/octet-stream` e o `<video>` recusa a tocar, sem erro visível no console.
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

// ------------------------------------------------------------------ compressão
//
// O maior custo de banda do jogo é TEXTO: os mapas são JSON de tile, e tile é número pequeno
// repetido — o material que o gzip mais gosta. Medido no espelho:
//
//     cerulean.json   2.473 kB → 389 kB   (−84%)   ← baixado em TODO login (é a praça)
//     mapa de hunt      604 kB →  95 kB   (−84%)   ← baixado a cada troca de área
//     creatures.json    981 kB →  72 kB   (−93%)
//
// Sem isto, a primeira carga de um jogador são ~5,5 MB e cada troca de hunt são ~600 kB. Numa
// conexão fraca, é a diferença entre trocar de área em 4 s e em meio segundo.
//
// Imagem NÃO entra: `.png`, `.jpg` e `.webp` já são formatos comprimidos, e passá-los pelo gzip
// gasta CPU para às vezes CRESCER o arquivo.
const COMPRIMIVEL = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);

/** Abaixo disto o cabeçalho do gzip come o ganho. */
const MINIMO_GZIP = 1024;

/**
 * Cache do que já foi comprimido, em memória.
 *
 * Os assets são imutáveis em produção, então cada arquivo é comprimido UMA vez na primeira vez
 * que alguém pede e fica pronto para todos os outros — comprimir 2,5 MB a cada login gastaria
 * CPU do tick para produzir sempre o mesmo byte.
 *
 * O teto existe porque o espelho tem 348 mapas: comprimidos dão ~33 MB no total, cabe folgado,
 * mas um teto explícito evita que um espelho maior no futuro coma a RAM da máquina em silêncio.
 * Quando estoura, some o mais antigo (o `Map` do JS itera na ordem de inserção).
 */
const TETO_CACHE_GZIP = 128 * 1024 * 1024;
const cacheGzip = new Map();
let bytesNoCacheGzip = 0;

const gzipar = promisify(gzip);

async function comprimido(arquivo, info) {
  // A chave leva mtime e tamanho: trocar o espelho por um `npm run fetch` invalida sozinho,
  // sem precisar reiniciar o servidor.
  const chave = `${arquivo}|${info.mtimeMs}|${info.size}`;
  const pronto = cacheGzip.get(chave);
  if (pronto) return pronto;

  const cru = await readFile(arquivo);
  const gz = await gzipar(cru, { level: 6 });
  // Nível 6 e não 9: em JSON de mapa a diferença entre os dois é ~2% de tamanho por ~3× de CPU.

  // Comprimir e ficar MAIOR acontece em arquivo já denso; nesse caso guarda-se o cru.
  const saida = gz.length < cru.length ? gz : null;
  if (saida) {
    while (bytesNoCacheGzip + saida.length > TETO_CACHE_GZIP && cacheGzip.size) {
      const [velha, buf] = cacheGzip.entries().next().value;
      cacheGzip.delete(velha);
      bytesNoCacheGzip -= buf.length;
    }
    cacheGzip.set(chave, saida);
    bytesNoCacheGzip += saida.length;
  }
  return saida;
}

// ------------------------------------------------------------------- cache
//
// Duas políticas, e a diferença entre elas é se o NOME do arquivo identifica o conteúdo.
//
// O empacotador de assets põe um hash no nome (`outfits-male-159-6827f9854c07.json`), então
// aquele nome nunca vai apontar para outro conteúdo: dá para mandar o navegador guardar por um
// ano e nunca mais perguntar. Já `creatures.json` e os mapas têm nome fixo — marcar um ano
// neles deixaria o jogador com dado velho DEPOIS de um `npm run fetch`, e sem como forçar a
// atualização. Esses levam prazo curto mais ETag: passado o prazo o navegador pergunta, e se
// nada mudou a resposta é um 304 de ~200 bytes em vez do arquivo inteiro.
const TEM_HASH = /-[0-9a-f]{8,}\.[a-z0-9]+$|\.[0-9a-f]{8,}\.[a-z0-9]+$/i;

/**
 * Índice: arquivo que diz ONDE os outros estão. `items-icons.json` mapeia item → caminho do
 * ícone; `items.json` e `creatures.json` são os catálogos que o resto pendura em cima.
 *
 * Estes não podem ter prazo NENHUM, e o motivo é diferente do de estar velho. Um sprite velho
 * ainda desenha — é arte defasada, e ninguém morre. Um índice velho aponta para arquivo que
 * não existe mais, e o resultado é 172 itens sem imagem para quem já tinha visitado o site,
 * enquanto um navegador limpo vê tudo certo. O bug fica invisível para quem testa e permanente
 * para quem joga, até o prazo vencer.
 *
 * `no-cache` não quer dizer "não guarde": quer dizer "pergunte antes de usar". Com o ETag
 * logo abaixo, a pergunta custa um 304 de ~200 bytes quando nada mudou. Pagar isso por um
 * punhado de índices é barato perto de servir um mapa que mente.
 */
const EH_INDICE = /\.json$/i;

/**
 * O CARIMBO DE VERSÃO no `.js` e no `.css` que as páginas carregam.
 *
 * O problema que isto resolve: o Cloudflare na frente CACHEIA por extensão, e o
 * "Browser Cache TTL" do painel REESCREVE o `Cache-Control` que sai daqui. Medido na
 * produção:
 *
 *   /app          → no-store        · cf-cache-status: DYNAMIC     (intacto)
 *   /i18n.mjs     → no-cache        · cf-cache-status: DYNAMIC     (intacto)
 *   /app.js       → max-age=14400   · cf-cache-status: REVALIDATED (reescrito!)
 *   /estilo.css   → max-age=14400   · cf-cache-status: REVALIDATED (reescrito!)
 *
 * Ou seja: o `no-cache` daqui vira quatro horas em que o navegador nem PERGUNTA — e o
 * jogador fica com o `app.js` (961 KB) e o `estilo.css` (418 KB) da versão anterior depois
 * de um deploy. É exatamente o "dá um Shift+F5" que a gente pedia no chat.
 *
 * A correção não depende de configuração de terceiro: com `?v=1.59.10` no fim, o endereço
 * MUDA a cada versão, e endereço novo não tem entrada velha em cache nenhum — nem no
 * navegador, nem no Cloudflare, nem num proxy corporativo no meio do caminho. O ajuste no
 * painel do Cloudflare ("Browser Cache TTL: Respect Existing Headers") continua valendo a
 * pena, mas passa a ser otimização, não conserto: se alguém virar a chave de volta, o jogo
 * não quebra.
 *
 * Só `.js` e `.css`, de propósito. Os `.mjs` passam intactos pelo Cloudflare e já revalidam
 * a cada carga — não estão velhos, então carimbá-los seria mexer no que funciona. E o
 * carimbo do `app.js` NÃO se propaga para os `import './i18n.mjs'` lá dentro (query não é
 * herdada na resolução de módulo), o que é justamente por que eles precisam continuar como
 * estão.
 *
 * Roda uma vez por arquivo, no cache de páginas — não a cada requisição.
 *
 * INVARIANTE: quem invalida o cache é o `version` do `package.json`, lido uma vez no boot.
 * Um deploy que mexe em `app.js` ou `estilo.css` e NÃO sobe a versão devolve o mesmo endereço
 * de antes — e o jogador volta a precisar do Shift+F5. O repositório já sobe a versão a cada
 * commit de feature; o que mudou é que agora isso é load-bearing, e não só etiqueta.
 *
 * Não uso o mtime do arquivo como selo (que dispensaria a disciplina da versão) porque o
 * carimbo é calculado quando a PÁGINA entra no cache, e a chave desse cache é o mtime da
 * página: mexer só no `app.js` não expiraria o `index.html`, e o selo continuaria o antigo.
 * Sairia um buraco pior do que o que se está fechando. A versão não tem esse problema — ela é
 * lida no boot, e deploy reinicia o processo.
 */
const REF_VERSIONAVEL = /(\s(?:src|href)=")((?!https?:|\/\/|data:)[^"?#]+\.(?:js|css))(")/gi;
const carimbarVersao = (html) => html.replace(REF_VERSIONAVEL, `$1$2?v=${VERSAO}$3`);

const politicaDeCache = (caminho, ehAsset, versaoPedida) => {
  // Pedido carimbado com a versão DE AGORA: o endereço identifica o conteúdo, então vale
  // guardar de verdade. É o que devolve a economia que o `no-cache` custava — entre dois
  // deploys, ninguém rebaixa 1,4 MB de novo a cada carga.
  //
  // A conferência contra a `VERSAO` não é frescura: um `?v=` antigo (aba velha, link colado)
  // NÃO identifica o que está no disco hoje, e prometer um ano de validade para ele seria
  // fixar conteúdo novo num endereço velho. Nesse caso cai na regra de sempre.
  if (!ehAsset && versaoPedida && versaoPedida === VERSAO) {
    return 'public, max-age=604800';
  }
  // O vídeo da landing page tem 4 MB e muda a cada meses, não a cada deploy. Com o `no-cache`
  // do cliente ele revalidava a cada visita: 304 é barato, mas a ida e volta antes do primeiro
  // frame não é — e é justamente a primeira dobra da página que paga a conta.
  if (caminho.startsWith('/midia/')) return 'public, max-age=604800';
  if (!ehAsset) return 'no-cache'; // o cliente do jogo muda a cada deploy
  // Nome com hash já identifica o conteúdo: mesmo sendo `.json`, aquele nome nunca aponta
  // para outra coisa, então não há mapa velho possível.
  if (TEM_HASH.test(caminho)) return 'public, max-age=31536000, immutable';
  if (EH_INDICE.test(caminho)) return 'no-cache';
  return 'public, max-age=3600';
};

/** ETag barato: tamanho e mtime bastam para saber que o arquivo é o mesmo. */
const etagDe = (info) => `W/"${info.size.toString(16)}-${Math.round(info.mtimeMs).toString(16)}"`;

// ------------------------------------------------------------ /treinadores
//
// A meta de 100 mil treinadores da landing: quantas CONTAS existem (`accounts`). É o número de
// verdade — o `online` do `/saude` soma o acréscimo do painel admin, e usar aquele aqui seria
// vender número inflado como real. Um minuto de cache em memória, porque a landing recebe o
// tráfego dos anúncios e um `count(*)` por visita seria o banco pagando pelo pico da campanha.
// O limite por IP é o mesmo do `/saude`, e várias visitas no mesmo instante esperam UMA consulta.
const TREINADORES_CACHE_MS = 60_000;
const META_TREINADORES = 100_000;
const treinadoresCache = { corpo: null, ate: 0, promessa: null };

async function responderTreinadores(req, res) {
  if (!permitirSaude(ipDoRequest(req))) {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
    return res.end(JSON.stringify({ ok: false, erro: 'muitas requisições — tente de novo em 1 s' }));
  }
  if (!treinadoresCache.corpo || Date.now() >= treinadoresCache.ate) {
    treinadoresCache.promessa ??= pool
      .query('SELECT count(*)::int AS n FROM accounts')
      .then(({ rows }) => JSON.stringify({ ok: true, total: rows[0].n, meta: META_TREINADORES }))
      .finally(() => { treinadoresCache.promessa = null; });
    try {
      treinadoresCache.corpo = await treinadoresCache.promessa;
      treinadoresCache.ate = Date.now() + TREINADORES_CACHE_MS;
    } catch (err) {
      console.error('[gateway] /treinadores falhou:', err.message);
      // Banco fora: se já houve um número, ele serve (um minuto velho não mente). Sem nenhum, a
      // landing recebe o erro e simplesmente não mostra a meta.
      if (!treinadoresCache.corpo) {
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false }));
      }
    }
  }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' });
  return res.end(treinadoresCache.corpo);
}

// ------------------------------------------------------------------ /saude
//
// Health check público — deploy, monitoramento e curiosos. Sem proteção vira martelo fácil
// no Redis (contarOnline + metricasDoCluster a cada hit). Cache de 2 s + teto por IP.
const SAUDE_CACHE_MS = 2000;
const SAUDE_MAX_POR_SEG = 10;
const saudePorIp = new Map();
let saudeCache = { corpo: null, ate: 0, promessa: null };

// O IP que limita o `/saude`. A regra de confiança mora em `ip-cliente.mjs`.
//
// Aqui ela vale dobrado por causa do `ipLocal` logo abaixo, que ISENTA o loopback do limite —
// é o que deixa o `deploy.sh` bater no `/saude` à vontade. Lendo o PRIMEIRO elemento do
// `X-Forwarded-For`, como era antes, bastava mandar `X-Forwarded-For: 127.0.0.1` para se
// declarar local e ficar sem limite nenhum. O último elemento é o que o Caddy acrescentou, e
// nesse ninguém de fora escreve.
const ipDoRequest = (req) => ipCliente(req);

/**
 * Limites por CONTA (ver `limites-ws.mjs`). Moram fora do socket para sobreviver à reconexão —
 * fechar e reabrir a conexão em laço não enche o balde de novo.
 */
const limitesWs = criarLimites();
setInterval(() => limitesWs.faxina(), 60_000).unref();

/** Recusa por limite: um aviso por segundo no socket e uma linha de log por conta por minuto. */
function recusarPorLimite(ws, chave, t) {
  if (t - (ws.recusadoEm ?? 0) >= 1000) {
    ws.recusadoEm = t;
    try { ws.send(codificar({ t: SERVIDOR.ERRO, msg: 'Devagar aí — muitas mensagens.' })); } catch {}
  }
  const relato = chave ? limitesWs.relatoDeRecusas(chave, t) : null;
  if (relato) console.warn(`[limite] ${ws.nick ?? chave} recusado: ${relato}`);
}

const ipLocal = (ip) =>
  ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

function permitirSaude(ip) {
  if (ipLocal(ip)) return true;
  const t = Date.now();
  let b = saudePorIp.get(ip);
  if (!b || t >= b.resetAt) {
    b = { count: 0, resetAt: t + 1000 };
    saudePorIp.set(ip, b);
  }
  b.count++;
  return b.count <= SAUDE_MAX_POR_SEG;
}

async function montarSaude() {
  const [onlineReal, porShard] = await Promise.all([
    contarOnline().catch(() => -1),
    metricasDoCluster().catch(() => ({})),
  ]);
  const online = onlineExibido(onlineReal);
  const extra =
    onlineReal >= 0 && online >= 0 ? Math.max(0, online - onlineReal) : 0;
  const porShardPub = extra > 0 ? inflarJogadoresPorShard(porShard, extra) : porShard;
  const shards = Object.values(porShardPub);
  return JSON.stringify({
    ok: true,
    versao: VERSAO,
    gatewayId,
    socketsLocais: sockets.size,
    online,
    shards: shards.length,
    jogadores: shards.reduce((s, m) => s + (m.jogadores ?? 0), 0),
    noCentro: shards.reduce((s, m) => s + (m.noCentro ?? 0), 0),
    tickMs: shards.length ? Math.max(...shards.map((m) => m.tickMs ?? 0)) : metricas.tickMs,
    eventosPorSeg: shards.reduce((s, m) => s + (m.eventosPorSeg ?? 0), 0),
    porShard: porShardPub,
  });
}

/** Soma o acréscimo admin no primeiro shard — evita `online` ≠ `jogadores` no `/saude` público. */
function inflarJogadoresPorShard(porShard, extra) {
  const copia = { ...porShard };
  const chaves = Object.keys(copia);
  if (!chaves.length) {
    copia['0'] = { jogadores: extra, noCentro: 0, tickMs: 0, eventosPorSeg: 0 };
    return copia;
  }
  const alvo = chaves[0];
  const m = copia[alvo] ?? {};
  copia[alvo] = { ...m, jogadores: (m.jogadores ?? 0) + extra };
  return copia;
}

async function responderSaude(req, res) {
  const ip = ipDoRequest(req);
  if (!permitirSaude(ip)) {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
    return res.end(JSON.stringify({ ok: false, erro: 'muitas requisições — tente de novo em 1 s' }));
  }

  const t = Date.now();
  if (saudeCache.corpo && t < saudeCache.ate) {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': `public, max-age=${Math.ceil((saudeCache.ate - t) / 1000)}`,
    });
    return res.end(saudeCache.corpo);
  }

  if (!saudeCache.promessa) {
    saudeCache.promessa = montarSaude().finally(() => {
      saudeCache.promessa = null;
    });
  }
  const corpo = await saudeCache.promessa;
  saudeCache.corpo = corpo;
  saudeCache.ate = Date.now() + SAUDE_CACHE_MS;

  res.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': `public, max-age=${Math.ceil(SAUDE_CACHE_MS / 1000)}`,
  });
  return res.end(corpo);
}

// Serve o cliente e, em /assets/*, o espelho de sprites/mapas do sprite-lab.
/** Faixa `Range: bytes=` para seek de áudio/vídeo no navegador. */
function faixaBytes(rangeHeader, tamanho) {
  if (!rangeHeader?.startsWith('bytes=')) return null;
  const [ini, fim] = rangeHeader.slice(6).split('-');
  let start = ini ? parseInt(ini, 10) : 0;
  let end = fim ? parseInt(fim, 10) : tamanho - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= tamanho) return null;
  end = Math.min(end, tamanho - 1);
  return { start, end };
}

/**
 * As quatro páginas do site, em memória, para não reler o disco a cada carga.
 *
 * A chave leva mtime e tamanho, igual à do cache de gzip: editar o `index.html` com o servidor
 * de pé continua aparecendo no próximo F5, sem reiniciar nada.
 */
const cachePaginas = new Map();

/**
 * O host do endereço público configurado — a segunda fonte do `connect-src` do socket.
 *
 * Lido uma vez: `URL_PUBLICA` não muda sem reiniciar o processo. Ver `origensDoSocket`, em
 * `seguranca.mjs`, para por que não basta o `Host` da requisição.
 */
const HOST_PUBLICO = (() => {
  try { return new URL(URL_PUBLICA).host; } catch { return ''; }
})();

/**
 * Serve uma página HTML com a CSP daquela resposta.
 *
 * ### Por que uma página não pode ser cacheada nem responder 304
 *
 * O nonce está em DOIS lugares que precisam bater: no cabeçalho `Content-Security-Policy` e em
 * cada `<script>` do corpo. Um 304 manda o cabeçalho novo e faz o navegador reaproveitar o
 * corpo guardado — que tem o nonce ANTIGO. O resultado seria uma página em que nenhum script
 * roda, intermitente e só para quem já tinha visitado o site. Por isso `no-store`.
 *
 * O custo é pequeno e já era quase todo pago: o HTML era `no-cache`, ou seja, cada carga já ia
 * ao servidor perguntar. A diferença é mandar ~77 kB em vez de um 304, e o Caddy comprime isso
 * na saída (`encode zstd gzip`) — por isso não gzipamos aqui: comprimir com nonce novo a cada
 * resposta seria jogar fora o cache de compressão e gastar CPU para o proxy refazer o trabalho.
 */
async function servirPagina(req, res, arquivo, info) {
  const chave = `${arquivo}|${info.mtimeMs}|${info.size}`;
  let cru = cachePaginas.get(chave);
  if (cru === undefined) {
    cru = carimbarVersao(await readFile(arquivo, 'utf8'));
    cachePaginas.clear(); // são 4 arquivos; trocar tudo é mais barato que envelhecer entrada
    cachePaginas.set(chave, cru);
  }

  const nonce = nonceNovo();
  const html = injetarNonce(cru, nonce);
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': csp(nonce, {
      https: ehHttps(req),
      hosts: [HOST_PUBLICO, req.headers.host],
    }),
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(html),
  });
  res.end(html);
}

// ------------------------------------------------------------------ IP banido
//
// O ban de IP do painel (`origens-db.mjs`) barra TUDO que chega por aquela rede: o site, o
// cadastro, o login e o socket. As exceções são poucas e cada uma tem motivo:
//
//   · o PAINEL (`/admin` e o que a página dele carrega) — um moderador que cai no próprio ban
//     precisa conseguir desfazê-lo. O painel já recusa banir o IP de quem clica, e isto é a
//     segunda trava; quem não é admin não faz nada lá dentro de qualquer jeito;
//   · os WEBHOOKS de pagamento — quem chama é o servidor do provedor, e barrar um deles por um
//     IP digitado errado seria perder a confirmação de uma compra paga;
//   · o `/saude` — é o monitor, não um jogador.
const ISENTOS_DO_BAN_DE_IP = new Set([
  '/admin', '/admin.html', '/admin.mjs', '/admin.css', '/estilo.css', '/terms.css',
  '/img/favicon-32.png', '/saude',
]);
// O caminho chega DECODIFICADO, e o servidor de arquivos ainda o normaliza depois. Sem a primeira
// linha, `/admin%2f..%2findex.html` passaria aqui como rota do painel e sairia lá embaixo como o
// `index.html` do jogo. Caminho com `..` ou `\` nunca é isento — nenhuma rota legítima tem um.
const isentoDoBanDeIp = (caminho) =>
  !caminho.includes('..') && !caminho.includes('\\')
  && (ISENTOS_DO_BAN_DE_IP.has(caminho) || caminho.startsWith('/admin/') || caminho.startsWith('/webhooks/'));

/**
 * A página de quem está banido. Sem script e sem nada de fora — a CSP dela é `default-src 'none'`.
 * Diz o que aconteceu e onde pedir revisão: numa rede compartilhada (CGNAT, escola), quem cai
 * aqui pode não ter nada a ver com o abuso, e precisa saber a quem recorrer.
 */
const PAGINA_IP_BANIDO = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PokeIdle — acesso bloqueado</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1b1420;color:#f3e6d8;font:15px/1.5 Tahoma,Verdana,sans-serif}
main{max-width:520px;margin:16px;padding:24px 28px;background:#2b2030;border:3px solid #8a5a3c;border-radius:10px}
h1{margin:0 0 12px;font-size:20px;color:#ffb3a0}p{margin:0 0 10px}small{color:#b9a79a}a{color:#ffd166}
</style></head><body><main>
<h1>Acesso bloqueado</h1>
<p>Esta rede foi <b>banida</b> do PokeIdle por abuso (criação de contas em massa). Não é possível criar conta, entrar nem jogar a partir dela.</p>
<p>Se você acha que é um engano — internet compartilhada, escola, operadora móvel —, fale com o suporte no <a href="https://discord.gg/pokeidle">Discord</a>.</p>
<p><small>This network has been banned from PokeIdle for abuse. If you think this is a mistake, contact support on Discord. · Esta red fue baneada de PokeIdle por abuso. Si crees que es un error, habla con el soporte en Discord.</small></p>
</main></body></html>`;

/** A resposta de quem está banido: a página para o navegador, JSON (com a chave traduzível) para o resto. */
function responderIpBanido(req, res, bucket) {
  registrarBloqueioDeIp(bucket);
  const querPagina = req.method === 'GET' && String(req.headers.accept ?? '').includes('text/html');
  if (querPagina) {
    res.writeHead(403, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(PAGINA_IP_BANIDO),
    });
    return res.end(PAGINA_IP_BANIDO);
  }
  res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  return res.end(JSON.stringify({ erro: 'login.ipBanido' }));
}

/**
 * Fecha o socket de uma rede banida, dizendo por quê. O 4003 é o que faz o cliente NÃO tentar
 * de novo (ver `ws.onclose` no app.js) — sem ele, cada aba aberta viraria uma reconexão em laço.
 */
function fecharPorIpBanido(ws, bucket) {
  if (ws.fechadoPorIp) return;
  ws.fechadoPorIp = true;
  registrarBloqueioDeIp(bucket);
  try {
    ws.send(codificar({ t: SERVIDOR.ERRO, chave: 'auth.ipBanido', msg: 'Esta rede foi banida do jogo.' }));
  } catch {}
  try { ws.close(4003, 'ip-banido'); } catch {}
}

async function servirEstatico(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let caminho = decodeURIComponent(url.pathname);

  // IP banido: antes de QUALQUER rota — cadastro, login, página, arquivo. A consulta é à lista
  // em memória (`ipsBanidos`), então o custo por requisição é uma busca num Map.
  if (!isentoDoBanDeIp(caminho)) {
    const bucket = bucketDeIp(ipCliente(req));
    if (bucket && await ipBanido(bucket)) return responderIpBanido(req, res, bucket);
  }

  // Contas (senha, Google, Discord) vivem em `/auth/*`. Vêm antes do estático porque são
  // rotas de verdade, não arquivos — e porque um POST não pode cair no `stat`.
  if (caminho.startsWith('/auth/')) {
    try {
      if (await rotasDeAuth(req, res, url)) return;
    } catch (err) {
      console.error('[auth] rota estourou:', err.message);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ erro: 'login.falhou' }));
    }
  }

  // Compra de diamantes e os webhooks dos provedores de pagamento. Pelo mesmo motivo das
  // rotas de conta: são rotas de verdade, e o webhook é um POST de um servidor de fora que
  // não tem socket nenhum para falar com o jogo.
  // O painel de lucro. Mesma razão das rotas de conta — é rota, não arquivo. Sem
  // `ADMIN_EMAILS` no ambiente ele devolve 404 para todo mundo, inclusive para você.
  if (caminho.startsWith('/admin/')) {
    try {
      if (await rotasDeAdmin(req, res, url)) return;
    } catch (err) {
      console.error('[admin] rota estourou:', err.message);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ erro: 'admin.falhou' }));
    }
  }

  // O Vote & Ganhe. Vem ANTES das rotas de diamante porque as duas dividem o prefixo
  // `/webhooks/` — e o webhook do TopIdle credita diamante, então é aqui que ele mora.
  if (caminho === '/webhooks/topidle' || caminho.startsWith('/topidle/')) {
    try {
      if (await rotasDeTopIdle(req, res, url)) return;
    } catch (err) {
      console.error('[topidle] rota estourou:', err.message);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ erro: 'voto.falhou' }));
    }
  }

  if (caminho.startsWith('/diamantes/') || caminho.startsWith('/webhooks/')) {
    try {
      if (await rotasDeDiamantes(req, res, url)) return;
    } catch (err) {
      console.error('[diamantes] rota estourou:', err.message);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ erro: 'diamantes.falhou' }));
    }
  }

  if (caminho.startsWith('/affiliate/')) {
    try {
      if (await rotasDeAfiliados(req, res, url)) return;
    } catch (err) {
      console.error('[afiliados] rota estourou:', err.message);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ erro: 'afiliados.falhou' }));
    }
  }

  // A API do Tracker. Só leitura, sem sessão, com teto por IP e cache — ver `tracker-rotas.mjs`.
  // Vem antes do estático porque é rota, e porque o prefixo `/tracker` também serve a PÁGINA
  // (logo abaixo): sem esta linha, `/tracker/api/meta` cairia no `stat` de um arquivo.
  if (caminho.startsWith('/tracker/api/')) {
    try {
      if (await rotasDoTracker(req, res, url)) return;
    } catch (err) {
      console.error('[tracker] rota estourou:', err.message);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ erro: 'tracker.falhou' }));
    }
  }

  if (caminho === '/saude') return responderSaude(req, res);
  if (caminho === '/treinadores') return responderTreinadores(req, res);

  // Endereços "de gente" para as páginas soltas. `/terms` é o link do rodapé do jogo e o que
  // vai num pedido de remoção de direitos autorais — ele precisa ser curto e sem `.html`,
  // porque é um endereço que alguém copia e cola num e-mail.
  // A RAIZ é a landing page, e o JOGO mora em `/app`.
  //
  // Quem chega em pokeidle.io pela primeira vez vem de um anúncio ou de uma busca e precisa
  // de uma resposta para "o que é isso e por que eu jogaria" — a tela de login do jogo não
  // responde nenhuma das duas. Quem já joga não passa por aqui: a `landing.html` reenvia
  // para `/app` sozinha quando acha sessão no `localStorage`.
  //
  // `/index.html` continua servindo o jogo direto, sem redirecionamento, porque é o endereço
  // que já está em links antigos por aí.
  const PAGINAS = {
    '/': '/landing.html',
    '/app': '/index.html',
    '/terms': '/terms.html', '/termos': '/terms.html', '/admin': '/admin.html',
    '/tracker': '/tracker.html',
  };
  if (PAGINAS[caminho]) caminho = PAGINAS[caminho];
  // O TRACKER tem endereços de VERDADE por dentro (`/tracker/j/befoin`, `/tracker/pokemon/6`),
  // e todos servem a mesma página — quem lê o caminho e monta a tela é o roteador do cliente.
  //
  // Endereço e não `#hash` porque estas páginas são para serem compartilhadas e indexadas: o
  // Google não vê nada depois do `#`, e um link de perfil colado no Discord tem de mostrar de
  // quem é. O custo é esta linha, e a garantia de que ela não vira um buraco é a regra acima
  // dela: `/tracker/api/` já saiu daqui, e um caminho com `..` ou `\` nunca chega até aqui
  // (o `isentoDoBanDeIp` e o `normalize` mais abaixo cuidam disso).
  else if (caminho.startsWith('/tracker/')) caminho = '/tracker.html';
  // Navegador e Google pedem /favicon.ico sozinhos — aponta pro PNG que já existe.
  if (caminho === '/favicon.ico') caminho = '/img/favicon-64.png';

  let base = clientDir;
  let arquivoDados = null;
  if (caminho.startsWith('/shared/')) {
    base = sharedDir;
    caminho = caminho.slice('/shared'.length);
  } else if (caminho.startsWith('/assets/')) {
    base = config.assetsDir;
    const relAsset = caminho.slice('/assets'.length);
    arquivoDados = ASSETS_DADOS[relAsset] ?? null;
    caminho = relAsset;
  }
  if (caminho.endsWith('/')) caminho += 'index.html';

  const arquivo = arquivoDados ?? join(base, normalize(caminho));
  if (arquivoDados) {
    if (!arquivo.startsWith(dadosDir)) {
      res.writeHead(403).end('forbidden');
      return;
    }
  } else if (!arquivo.startsWith(base)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(arquivo);
    if (!info.isFile()) throw new Error('nao e arquivo');

    const ehAsset = base === config.assetsDir;
    const ext = extname(arquivo).toLowerCase();

    // PÁGINA: caminho próprio, porque o corpo muda a cada resposta (o nonce da CSP).
    if (ext === '.html') return servirPagina(req, res, arquivo, info);

    const etag = etagDe(info);
    const cabecalho = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': politicaDeCache(caminho, ehAsset, url.searchParams.get('v')),
      etag,
      'accept-ranges': 'bytes',
      // Sem isto, um proxy no meio do caminho pode servir a versão comprimida para um cliente
      // que não pediu compressão (ou o contrário).
      vary: 'accept-encoding',
    };

    // O navegador já tem este arquivo: 304 e ~200 bytes no lugar do conteúdo. É o que faz a
    // segunda sessão de um jogador custar quase nada de banda.
    if (req.headers['if-none-match'] === etag && !req.headers.range) {
      res.writeHead(304, cabecalho).end();
      return;
    }

    const faixa = faixaBytes(req.headers.range, info.size);
    if (faixa) {
      const { start, end } = faixa;
      const pedido = end - start + 1;
      res.writeHead(206, {
        ...cabecalho,
        'content-range': `bytes ${start}-${end}/${info.size}`,
        'content-length': pedido,
      });
      createReadStream(arquivo, { start, end }).pipe(res);
      return;
    }

    const querGzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    if (querGzip && COMPRIMIVEL.has(ext) && info.size >= MINIMO_GZIP) {
      const gz = await comprimido(arquivo, info);
      if (gz) {
        res.writeHead(200, {
          ...cabecalho,
          'content-encoding': 'gzip',
          'content-length': gz.length,
          // O tamanho ANTES de comprimir. A barra de carregamento precisa dele para mostrar
          // progresso de verdade: o `content-length` de uma resposta comprimida conta bytes do
          // fio, mas o que o navegador entrega ao JS já vem descomprimido — dividir um pelo
          // outro daria uma barra que fecha em 600%.
          'x-bytes-crus': info.size,
        });
        res.end(gz);
        return;
      }
    }

    res.writeHead(200, { ...cabecalho, 'content-length': info.size });
    createReadStream(arquivo).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`404 ${caminho}`);
  }
}

const nickValido = (n) => typeof n === 'string' && /^[a-zA-Z0-9_]{3,16}$/.test(n);

/** Durações permitidas de mute pelo MENU de moderação (minutos). */
const MUTE_MINUTOS = new Set([5, 30, 60, 1440]);

/** Teto do `/mute`, onde a duração é digitada: uma semana. */
const MUTE_CMD_MAX_MIN = 7 * 24 * 60;

async function avisoMuteAtivo(ws) {
  const ate = await muteChatAte(ws.nick);
  if (ate) ws.send(codificar({ t: SERVIDOR.CHAT_MUTE, ate }));
}

function formatarRestanteMute(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.ceil((s % 3600) / 60);
    return m ? `${h}h ${m}min` : `${h}h`;
  }
  if (s >= 60) return `${Math.ceil(s / 60)} min`;
  return `${s}s`;
}

async function recusarSeMutado(ws) {
  const ate = await muteChatAte(ws.nick);
  if (!ate) return false;
  ws.send(codificar({
    t: SERVIDOR.CHAT_AVISO,
    chave: 'chat.mutado',
    tempo: formatarRestanteMute(ate - Date.now()),
  }));
  return true;
}

/**
 * Guarda no socket o nível e o VIP que passam nos pacotes de estado.
 *
 * O chat sai daqui e não do sim — é o que deixa o fan-out valer para os N gateways sem
 * uma volta pelo worker dono do jogador. Só que o dourado do nick VIP e o `[42]` do lado
 * do nome são dados de JOGO, e este processo não tem estado de jogo nenhum.
 *
 * Em vez de pedir de volta ao sim a cada linha digitada (uma ida e volta no barramento por
 * mensagem de chat, para um dado que muda uma vez por mês), lê-se de carona: todo pacote de
 * estado que já ia para este socket passa por aqui antes de sair. O VIP fica no socket, e
 * quando a mensagem chega ele já está lá.
 *
 * Vem do SERVIDOR, nunca do cliente: um nick dourado que se ganha mandando `{vip:true}` no
 * `chat.send` não vale nada.
 */
function lerCargo(ws, msg) {
  const e = msg?.estado;
  if (!e) return;
  if (typeof e.level === 'number') ws.nivel = e.level;
  if (typeof e.loja?.vip === 'boolean') ws.vip = e.loja.vip;
  // A tag de Fundador pega carona pela mesma razão que o VIP: ela muda uma vez na vida (ao
  // abrir a caixa) e seria absurdo perguntar ao sim a cada linha digitada. `caixas` só falta
  // em cliente/servidor de versões diferentes — e aí a tag simplesmente não aparece, que é o
  // fracasso certo.
  if (e.caixas) ws.fundador = e.caixas.tag ?? null;
  // `'guild' in e` e não `e.guild?.id`: desde que o estado passou a viajar em DELTA, um pacote
  // sem a chave `guild` quer dizer "não mudou", não "saiu da guild". Ler o valor ausente como
  // ausência zerava `ws.guildId` no primeiro delta e o chat de guild parava de chegar —
  // silenciosamente, porque o filtro do fan-out simplesmente deixa de casar.
  if ('guild' in e) {
    ws.guildId = e.guild?.id ? Number(e.guild.id) : null;
    ws.guildTag = e.guild?.tag ?? null;
    ws.guildTagCor = e.guild?.tagCor ?? null;
  }
}

/** Admin ou tag [Moderador]/[Helper] do painel — podem apagar mensagens do chat. */
function podeApagarChat(ws) {
  return !!ws.admin || CARGOS_MOD_CHAT.includes(ws.chatCargo);
}

/** Admin ou tag [Moderador] — os comandos de barra. O helper fica de fora (ver CARGOS_CMD_CHAT). */
function podeComandarChat(ws) {
  return !!ws.admin || CARGOS_CMD_CHAT.includes(ws.chatCargo);
}

/**
 * Aplica o mute e avisa os dois lados. Usado pelo menu de moderação e pelo `/mute`.
 *
 * Quem chama já checou a permissão de QUEM aplica; aqui mora a checagem do ALVO — admin e
 * staff não se mutam entre si, nem por engano nem numa briga de bastidor. Devolve `false`
 * quando recusou, para o comando não responder "feito" ao que não foi feito.
 */
async function mutarPorStaff(ws, alvo, minutos) {
  if (await ehAdminPorNick(alvo)) {
    ws.send(codificar({ t: SERVIDOR.CHAT_AVISO, chave: 'chat.modMuteNegado' }));
    return false;
  }
  // `ws.admin ? null` — o admin PODE mutar moderador e helper; a checagem de cargo só existe
  // para impedir que a staff se mute entre si.
  const cargoAlvo = ws.admin ? null : await cargoPorNick(alvo);
  if (CARGOS_MOD_CHAT.includes(cargoAlvo)) {
    ws.send(codificar({ t: SERVIDOR.CHAT_AVISO, chave: 'chat.modMuteNegado' }));
    return false;
  }
  const porCargo = ws.admin ? 'admin' : (ws.chatCargo ?? 'moderador');
  const ate = await aplicarMuteChat(alvo, minutos * 60, {
    nick: alvo,
    porNick: ws.nick,
    porCargo,
    minutos,
  });
  if (!ate) return false;
  const gw = await gatewayDoJogador(alvo);
  if (gw) {
    publicar(canalGateway(gw), {
      para: alvo.toLowerCase(),
      msg: { t: SERVIDOR.CHAT_MUTE, ate },
    });
  }
  ws.send(codificar({
    t: SERVIDOR.CHAT_AVISO,
    chave: 'chat.modMuteOk',
    nick: alvo,
    minutos,
  }));
  // No mesmo formato do `[admin]` de `revogarMute`: quem aplicou, em quem e por quanto. O
  // painel já lista o mute vigente, mas o log é o que sobrevive à expiração.
  console.log(`[chat] ${ws.nick} (${porCargo}) mutou ${alvo} por ${minutos} min`);
  return true;
}

/** O selo que vai na mensagem: admin > tag do painel > vip. */
function cargoDoChat(ws) {
  if (ws.admin) return 'admin';
  if (ws.chatCargo) return ws.chatCargo;
  if (ws.vip) return 'vip';
  return null;
}

export async function iniciarGateway() {
  exigirChaveEmProducao();
  // Os cabeçalhos de segurança entram por `setHeader` ANTES de qualquer rota, e não dentro de
  // cada `writeHead`. O Node funde os dois (o objeto do `writeHead` ganha em caso de conflito),
  // então isto cobre de uma vez as rotas de conta, de pagamento, o `/saude`, os 404 e os 403 —
  // inclusive os que ainda não existem. Um lugar só para conferir, e nada para lembrar de
  // repetir na próxima rota.
  const http = createServer((req, res) => {
    const cabecalhos = cabecalhosBase({ https: ehHttps(req) });
    for (const [k, v] of Object.entries(cabecalhos)) res.setHeader(k, v);
    servirEstatico(req, res).catch((err) => {
      console.error('[http] rota estourou:', err.message);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('erro interno');
    });
  });
  const wss = new WebSocketServer({
    server: http,
    maxPayload: 16 * 1024,
    // ---------------------------------------------------------- compressão do socket
    //
    // O `ws` vem com isto DESLIGADO por padrão, e o efeito disso é a maior conta de banda do
    // projeto: 97% do egress é o pacote `estado`, que é JSON com nomes de chave repetidos
    // centenas de vezes — exatamente o material que o deflate mais gosta. Medido sobre 852
    // snapshots reais de produção: 538 kB de pacote viram 48 kB.
    //
    // Os parâmetros não são o padrão do `ws`, e cada desvio tem um motivo:
    //
    //   level 1 — mede −87,7% contra −91,0% do nível 6, por uma fração da CPU. Com dezenas de
    //     MB/s saindo, três pontos de compressão não pagam o dobro de tempo de CPU no laço.
    //
    //   windowBits 13 — janela de 8 kB: as mensagens do jogo são curtas, e o que se repete entre
    //     elas (nomes de campo, ids, golpes) cabe folgado.
    //
    //   CONTEXTO — `WS_DEFLATE_CONTEXTO=1`. Sem ele (o padrão), cada mensagem é comprimida sozinha
    //     e só as de 1 kB ou mais: em 15/09/2026, 93% dos bytes de um jogador caçando eram
    //     mensagens menores que isso, saindo CRUAS. Com contexto, cada mensagem aproveita o que as
    //     anteriores ensinaram ao compressor, e o `ws` comprime todas (o threshold só vale sem
    //     contexto). Medido com as mensagens reais de uma caçada e o próprio PerMessageDeflate do
    //     `ws`: 5,21 → 0,84 MB/h por jogador (−84%), por ~+0,05 núcleo e ~+120 MB de RAM a cada
    //     1.000 sockets e 5–20 ms a mais de fila no zlib (p99, de 1.000 a 3.000 sockets num
    //     processo). O jogo não muda: as mensagens são as mesmas e quem descomprime é o navegador —
    //     até o `app.js` antigo em cache. Liga-se gateway a gateway (drop-in do systemd) para
    //     comparar lado a lado antes de ligar em todos; ver `infra/FASES-ESCALA.md`.
    //
    //     Correção de 15/09/2026: este comentário dizia que sem contexto a RAM caía de ~300 MB para
    //     ~30 MB com 500 jogadores. No `ws` 8.21 não é assim — sem contexto ele dá `reset()` no
    //     stream, não `close()`, e o zlib continua vivo por socket; o contexto acrescenta o
    //     dicionário quente, os ~120 kB por socket medidos acima.
    //
    //   threshold 1024 — sem contexto, `pong` (14 B) e os pacotes pequenos passam direto: comprimir
    //     14 bytes sozinhos só acrescenta o cabeçalho do deflate.
    //
    // `WS_DEFLATE=0` desliga tudo isto: serve para medir o antes e o depois na mesma máquina
    // (`tools/medir-estado.mjs`) e como alavanca de emergência, sem precisar de um deploy.
    perMessageDeflate: process.env.WS_DEFLATE === '0' ? false : {
      threshold: 1024,
      zlibDeflateOptions: { level: 1, memLevel: 7, windowBits: 13 },
      zlibInflateOptions: { windowBits: 13 },
      clientNoContextTakeover: true,
      serverNoContextTakeover: process.env.WS_DEFLATE_CONTEXTO !== '1',
      // Teto de deflates simultâneos. Sem ele, um pico de jogadores entrando ao mesmo tempo
      // enfileira centenas de tarefas no threadpool do zlib e o tick fica esperando I/O.
      concurrencyLimit: 8,
    },
  });

  // As migrações do gateway passam pela mesma trava dos sims (`db.travarMigracoes`): várias
  // delas (auditoria, afiliados, chat) também rodam no boot de cada sim.
  const soltarMigracoes = await travarMigracoes(`gateway ${gatewayId}`);
  // Tabelas de conta. Ficam no gateway (e não no sim) porque é ele quem serve `/auth/*` — num
  // cluster com ROLE=gateway separado, o processo de simulação nem carrega este módulo.
  await migrarAuth();
  await migrarAdmin();
  // O ledger de diamantes e a tabela de pagamentos. Também aqui, e não no sim: quem recebe o
  // webhook do provedor é o gateway, e num cluster com ROLE separado o sim nem serve HTTP.
  await migrarDiamantes();
  await migrarAfiliados();
  await migrarTopIdle();
  const { migrar: migrarAudit } = await import('./audit-db.mjs');
  await migrarAudit();
  // O carimbo de origem das contas (IP e dispositivo). Mesma razão das de cima: quem vê a
  // requisição de cadastro e de login é o gateway.
  const { migrar: migrarOrigens } = await import('./origens-db.mjs');
  await migrarOrigens();
  // Documentos para MED: o registro das emissões e o log de quem consultou (ver `med-db.mjs`).
  // Depois dos diamantes, porque dois índices novos são na tabela de pagamentos.
  const { migrar: migrarMed } = await import('./med-db.mjs');
  await migrarMed();
  // As tabelas do Tracker (`/tracker`). Quem ESCREVE nelas é o rolo, no processo de simulação;
  // quem LÊ é este aqui, que serve a página e a API dela. Migrar nos dois é o mesmo caso de
  // afiliados e do chat: num cluster com ROLE separado, cada metade precisa que a tabela
  // exista no seu boot, e o `CREATE TABLE IF NOT EXISTS` é idempotente.
  const { migrar: migrarTracker } = await import('./tracker-db.mjs');
  await migrarTracker();
  await chatDb.migrar();
  await soltarMigracoes();
  await carregarOnlineExtra();

  await limparPresencaDoGateway(gatewayId);

  // ---- os baldes de rede: heartbeat, faxina e re-carimbo
  //
  // O carimbo de vivo vem ANTES da faxina, e a ordem importa: um gateway que varresse antes de
  // se anunciar seria dado como morto por outro que varresse no mesmo instante, e os dois
  // soltariam as vagas um do outro.
  await marcarGatewayVivo(gatewayId).catch(() => {});
  setInterval(() => { marcarGatewayVivo(gatewayId).catch(() => {}); }, INTERVALO_VIVO).unref();

  // A faxina tira as vagas de gateways que não existem mais — o que sobra de um crash ou de um
  // deploy. Sem ela, quatro jogadores de uma casa ficavam trancados fora do jogo até o TTL de
  // 12 h vencer, que é um preço absurdo para um limite que existe para incomodar quem abusa.
  const faxinaDeRede = () => limparOnlineOrfao()
    .then((n) => { if (n) console.log(`[rede] faxina soltou ${n} vaga(s) de gateway morto`); })
    .catch((err) => console.error('[rede] faxina dos baldes falhou:', err.message));
  await faxinaDeRede();
  setInterval(faxinaDeRede, 300_000).unref();

  // E o contrapeso: re-afirma as vagas que ESTE processo realmente tem abertas. Se uma pausa
  // longa fizer a faxina alheia achar que ele morreu, o buraco dura um ciclo em vez de valer
  // para sempre.
  setInterval(() => {
    const pares = [];
    for (const [nick, sock] of sockets) {
      if (sock.redeBucket && sock.readyState === 1) pares.push([sock.redeBucket, nick]);
    }
    reafirmarOnline(gatewayId, pares).catch(() => {});
  }, 60_000).unref();

  // O painel mexeu na whitelist: todo gateway derruba o cache na hora. Sem isto, liberar um IP
  // levava até 30 s para valer aqui — e quem acabou de clicar no botão ia achar que não pegou.
  await assinar(CANAL_WHITELIST, async () => {
    const { esquecerWhitelist } = await import('./origens-db.mjs');
    esquecerWhitelist();
  });

  // O painel baniu um IP: derruba o cache e fecha JÁ quem está conectado por aquela rede — em
  // qualquer gateway, porque cada jogador está em um. `wss.clients`, e não o mapa `sockets`:
  // pega também o socket aberto que ainda não mandou `hello`.
  await assinar(CANAL_IP_BANIDO, ({ ipBucket, banido } = {}) => {
    esquecerBanidos();
    if (!banido || !ipBucket) return;
    let n = 0;
    for (const ws of wss.clients) {
      if (bucketDeIp(ws.ip) !== ipBucket) continue;
      fecharPorIpBanido(ws, ipBucket);
      n++;
    }
    if (n) console.log(`[rede] ${ipBucket} banido: ${n} socket(s) derrubado(s) neste gateway`);
  });

  // saída da simulação → socket certo. `msgs` é o lote de um tick (batalha + campo + estado
  // num publish só); `msg` continua valendo para os envios avulsos.
  await assinar(canalGateway(gatewayId), ({ para, msg, msgs, kick }) => {
    const ws = sockets.get(para);
    if (ws?.readyState !== 1) return;
    for (const m of msgs ?? (msg ? [msg] : [])) {
      lerCargo(ws, m);
      if (m.t === SERVIDOR.WELCOME && ws.helloEm) {
        const ms = Date.now() - ws.helloEm;
        if (ms >= HELLO_LENTO_MS) {
          console.warn(`[gateway] hello lento: ${ms} ms · ${ws.nick ?? para}`);
        }
        ws.helloEm = null;
      }
      ws.send(codificar(m));
    }
    if (kick) ws.close(4000, 'banido');
  });

  // O mesmo canal no formato CRU do sim (`saida-crua.mjs`): os frames chegam prontos e só são
  // recortados e repassados — sem o JSON.parse do pacote e o JSON.stringify de cada mensagem, que
  // eram 20% do tempo deste processo. O `meta` traz o que `lerCargo` leria das mensagens.
  //
  // Os frames de um jogador saem dentro de um `cork`: numa volta de combate são três mensagens
  // (golpes, campo, estado), e sem ele cada uma virava uma escrita separada no socket.
  await assinarCru(canalGateway(gatewayId), (raw) => {
    lerPacoteCru(raw, (para, meta, frames) => {
      const ws = sockets.get(para);
      if (ws?.readyState !== 1) return;
      if (meta) {
        if ('l' in meta) ws.nivel = meta.l;
        if ('v' in meta) ws.vip = meta.v;
        if ('f' in meta) ws.fundador = meta.f;
        if ('g' in meta) ws.guildId = meta.g;
        if ('gt' in meta) ws.guildTag = meta.gt;
        if ('gc' in meta) ws.guildTagCor = meta.gc;
        if (meta.w && ws.helloEm) {
          const ms = Date.now() - ws.helloEm;
          if (ms >= HELLO_LENTO_MS) {
            console.warn(`[gateway] hello lento: ${ms} ms · ${ws.nick ?? para}`);
          }
          ws.helloEm = null;
        }
      }
      const socket = ws._socket;
      socket?.cork();
      for (const frame of frames) ws.send(frame);
      socket?.uncork();
    });
  });

  // chat: todo gateway recebe tudo e espalha para os seus sockets
  await assinar(CANAL_CHAT, (msg) => {
    if (msg.op === 'del') {
      const pacote = codificar({ t: SERVIDOR.CHAT_DEL, id: msg.id });
      for (const ws of sockets.values()) if (ws.readyState === 1) ws.send(pacote);
      return;
    }
    const pacote = codificar({ t: SERVIDOR.CHAT, ...msg });
    for (const ws of sockets.values()) {
      if (ws.readyState !== 1) continue;
      if (msg.canal === 'guild') {
        const gid = Number(msg.guildId) || 0;
        if (!ws.guildId || ws.guildId !== gid) continue;
      }
      ws.send(pacote);
    }
  });

  // avisos globais na tela (captura de shiny, etc.)
  await assinar(CANAL_GLOBAL, (msg) => {
    const pacote = codificar(msg.t ? msg : { t: SERVIDOR.SHINY_CAPTURA, ...msg });
    for (const ws of sockets.values()) if (ws.readyState === 1) ws.send(pacote);
  });

  // acréscimos na contagem online — invalida o cache do /saude na hora
  await assinar(CANAL_ONLINE_EXTRA, ({ extras }) => {
    definirExtras(extras);
    saudeCache.corpo = null;
    saudeCache.ate = 0;
  });

  wss.on('connection', (ws, req) => {
    ws.playerId = null;
    // De onde veio este socket. Vai ao sim no `entrar` e serve a UMA coisa: impedir que duas
    // contas da mesma casa se encontrem na fila do PvP ranqueado (ver `porqueNaoPodem` em
    // `game/pvp-ranqueado.mjs`). Lido aqui e não lá porque o `req` só existe neste ponto — e
    // quem decide em qual cabeçalho confiar é `ip-cliente.mjs`, uma vez para o servidor todo.
    ws.ip = ipCliente(req);
    // Rede banida: fecha antes do `hello`. O `hello` confere de novo, porque ele pode chegar
    // antes de esta consulta voltar.
    const bucketDaConexao = bucketDeIp(ws.ip);
    if (bucketDaConexao) {
      ipBanido(bucketDaConexao)
        .then((banido) => { if (banido) fecharPorIpBanido(ws, bucketDaConexao); })
        .catch(() => {});
    }
    ws.nick = null;
    ws.admin = false;
    ws.chatCargo = null;
    // Tag da Caixa de Fundador (`{ tipo, serie }`). Preenchida por `lerCargo` no primeiro
    // snapshot, como o VIP — nunca pelo cliente.
    ws.fundador = null;
    ws.guildTag = null;
    ws.guildTagCor = null;
    ws.vivo = true;
    // Token bucket: 20 msg/s sustentado, rajada de 15. Um intervalo mínimo fixo entre
    // mensagens derrubaria rajadas legítimas (o cliente manda hello e já emenda comandos).
    ws.tokens = 15;
    ws.ultimoRefil = Date.now();
    ws.on('pong', () => (ws.vivo = true));
    // Socket que abre e nunca manda `hello`. O cliente manda o `hello` no `open`, então quem fica
    // 30 s calado não é jogador: é alguém segurando conexão (cada uma custa o parser e o deflate).
    // Só olha se ALGUM hello chegou — uma sessão recusada (ban, rede cheia) continua aberta como
    // antes, porque é o cliente quem decide o que fazer com a recusa.
    const semHello = setTimeout(() => {
      if (!ws.helloTentado && ws.readyState === 1) ws.close(4002, 'sem hello');
    }, 30_000);
    ws.once('close', () => clearTimeout(semHello));

    ws.on('message', async (raw) => {
      // Qualquer tráfego do cliente prova que o socket não está morto. O ping de aplicação
      // (`{ t: 'ping' }`) NÃO dispara `ws.on('pong')` — só o pong nativo do protocolo — e em
      // alguns clientes (browser → localhost) esse pong nativo não chega; sem isto a conexão
      // cai exatamente aos ~60 s mesmo com o cliente mandando keepalive.
      ws.vivo = true;
      const msg = decodificar(raw);
      if (!msg) return;

      const t = Date.now();
      // Antes do hello o balde é do socket (ainda não há conta); depois, é da CONTA e não enche de
      // novo quando o socket é trocado. Os mesmos 15 de rajada e 20/s de antes.
      if (ws.playerId) {
        if (!limitesWs.permitir(ws.playerId, 'geral', t)) return recusarPorLimite(ws, ws.playerId, t);
      } else {
        ws.tokens = Math.min(15, ws.tokens + ((t - ws.ultimoRefil) / 1000) * 20);
        ws.ultimoRefil = t;
        if (ws.tokens < 1) return recusarPorLimite(ws, null, t);
        ws.tokens -= 1;
      }

      if (msg.t === CLIENTE.PING) return ws.send(codificar({ t: SERVIDOR.PONG }));

      if (msg.t === CLIENTE.HELLO) {
        ws.helloTentado = true;
        if (ws.playerId) return;
        // IP banido vem ANTES da sessão: um token válido de 30 dias não abre uma rede banida.
        const bucketDoHello = bucketDeIp(ws.ip);
        if (ws.fechadoPorIp || (bucketDoHello && await ipBanido(bucketDoHello))) {
          return fecharPorIpBanido(ws, bucketDoHello);
        }
        const sessao = await lerSessao(msg.token);
        if (!sessao) {
          return ws.send(codificar({
            t: SERVIDOR.ERRO,
            chave: 'auth.sessaoInvalida',
            msg: 'Sessão inválida — entre de novo.',
          }));
        }
        if (!sessao.contaId || sessao.provedor === 'guest') {
          return ws.send(codificar({
            t: SERVIDOR.ERRO,
            chave: 'auth.precisaLogin',
            msg: 'Entre com sua conta para jogar.',
          }));
        }
        // `hello` por CONTA, antes das consultas: reconectar em laço custaria duas idas ao banco por
        // volta. 20 de rajada e um a cada 3 s depois — F5 e queda de rede não chegam perto.
        if (!limitesWs.permitir(`conta:${sessao.contaId}`, 'hello', t)) {
          return recusarPorLimite(ws, `conta:${sessao.contaId}`, t);
        }

        // A conta e o ban saem juntos: os dois só leem, e as checagens abaixo continuam na ordem de
        // antes (conta, nick, ban). Em fila eram duas esperas no pool para cada login de uma leva.
        const [conta, ban] = await Promise.all([contaPorId(sessao.contaId), banDaConta(sessao.contaId)]);
        if (!conta) {
          return ws.send(codificar({
            t: SERVIDOR.ERRO,
            chave: 'auth.sessaoInvalida',
            msg: 'Conta não encontrada — entre de novo.',
          }));
        }
        if (conta.nick_ok === false) {
          return ws.send(codificar({
            t: SERVIDOR.ERRO,
            chave: 'login.precisaNick',
            msg: 'Escolha seu nick de treinador antes de jogar.',
          }));
        }
        const nick = conta.nick;
        if (!nickValido(nick)) {
          return ws.send(codificar({ t: SERVIDOR.ERRO, msg: 'Nick inválido (3-16, letras/números/_)' }));
        }

        if (ban) {
          return ws.send(codificar({
            t: SERVIDOR.ERRO,
            chave: 'auth.contaBanida',
            // `msg` continua pelo cliente antigo, que ainda estiver aberto numa aba; `motivoBan`
            // é o campo que o cliente novo lê. Eram a MESMA coisa neste ponto, e não podiam
            // ser: o cliente prefere a `chave` quando ela vem (para poder traduzir) e assim
            // descartava o `msg` — o motivo do ban chegava no socket e morria ali.
            msg: ban.motivo ?? 'Conta banida.',
            motivoBan: ban.motivo ?? null,
          }));
        }

        // ---- quantas contas desta REDE já estão jogando
        //
        // Vem depois do ban (quem está banido não ocupa vaga de ninguém) e ANTES de registrar
        // o socket: uma sessão recusada não pode aparecer no mapa, nem na presença, nem no
        // balde da rede — senão ela tranca a vaga que acabou de negar a si mesma.
        //
        // É um limite de SESSÃO, não de cadastro: ele não olha onde a conta nasceu, só quantas
        // estão conectadas agora saindo por este IP. É o que fecha o buraco do teto de
        // cadastro — contas abertas em redes diferentes e rodadas todas na mesma máquina.
        // Admin sai do e-mail da conta que já veio acima: é a mesma linha que `ehAdminPorNick` relia
        // pelo nick (único sem distinção de maiúsculas). A tag do chat — uma leitura só, e só de quem
        // não é admin — começa junto da checagem da rede; se a rede recusar, a leitura é descartada.
        //
        // `ehAdminNoJogo`, e não `ehAdmin`: a tag [Admin] vermelha é dos DOIS cargos do painel.
        // Com `ehAdmin` aqui, quem entrava em `AUDITORIA_RESOLVER_EMAILS` seguia no chat com a
        // tag velha de [Moderador] — a linha `chatCargo` abaixo só apaga a tag de quem é admin,
        // e ele não era. Quem decide DINHEIRO continua sendo `ehAdmin`, nas rotas do painel.
        const admin = ehAdminNoJogo(conta.email);
        const cargoPendente = admin ? null : cargoPorNick(nick);
        cargoPendente?.catch(() => {});
        const bucketDaSessao = bucketDeIp(ws.ip);
        const provisorio = nick.toLowerCase();
        if (bucketDaSessao) {
          const { maxOnlinePorIp, redeLiberada } = await import('./origens-db.mjs');
          // A whitelist zera o TETO, e não o registro: a conta entra no balde da rede de
          // qualquer jeito. É o que faz a coluna "on-line agora" do painel dizer a verdade
          // justamente nos IPs isentos — que são os que o moderador vai reavaliar um dia.
          const limite = (await redeLiberada(bucketDaSessao)) ? 0 : maxOnlinePorIp();
          const vaga = await entrarNaRede({
            ipBucket: bucketDaSessao, playerId: provisorio, gatewayId, limite,
          });
          if (!vaga.pode) {
            console.log(`[rede] ${provisorio} recusado: ${bucketDaSessao} já tem ${vaga.contagem}/${limite} on-line`);
            return ws.send(codificar({
              t: SERVIDOR.ERRO,
              chave: 'login.limiteOnlineIp',
              msg: `Esta rede já está com ${limite} contas conectadas.`,
            }));
          }
          // A vaga é DESTA sessão a partir daqui, e o `close` tem de devolvê-la.
          ws.redeBucket = bucketDaSessao;
        }
        ws.nick = nick;
        ws.playerId = provisorio;
        ws.admin = admin;
        ws.chatCargo = admin ? null : await cargoPendente;
        // Registra o socket novo ANTES de fechar o antigo: o `close` atrasado do velho não
        // pode mandar `sair` ao sim nem roubar respostas de uma aba recém-aberta (F5, 2ª aba).
        const anterior = sockets.get(provisorio);
        sockets.set(provisorio, ws);
        if (anterior && anterior !== ws && anterior.readyState === 1) {
          try { anterior.close(4001, 'substituido'); } catch {}
        }
        await marcarOnline(provisorio, gatewayId);
        // De onde esta sessão entrou. Aqui, e não só em `/auth/entrar`, porque é ESTE o caminho
        // de quem já joga: o token vale 30 dias e o jogo abre direto no socket, sem passar por
        // rota de login nenhuma. Só registra — ver `origens-db.mjs`. Dispara e esquece: um erro
        // de telemetria não pode ficar entre o jogador e o jogo.
        if (podeCarimbarOrigem(sessao.contaId)) {
          import('./origens-db.mjs')
            .then(({ registrarOrigem, dispositivoLimpo }) => registrarOrigem({
              contaId: sessao.contaId,
              nick,
              evento: 'entrar',
              ip: ws.ip ?? null,
              ipBucket: bucketDeIp(ws.ip),
              dispositivo: dispositivoLimpo(msg.dispositivo),
            }))
            .catch(() => {});
        }
        // Sessão na segunda metade do prazo: manda uma nova antes de qualquer outra coisa.
        // É o que segura a aba que fica aberta por semanas sem nunca recarregar a página.
        if (valeRenovar(sessao)) {
          const token = await renovarSessao(sessao);
          if (token) ws.send(codificar({ t: SERVIDOR.SESSAO_RENOVADA, token }));
        }
        ws.helloEm = Date.now();
        enviarParaSim(provisorio, {
          t: 'entrar', playerId: provisorio, nick, gatewayId, admin: ws.admin, chatCargo: ws.chatCargo ?? null,
          ip: ws.ip ?? null,
          // Repassa a bandeira do cliente. O sim só manda estado em delta para quem
          // anunciou que sabe remontá-lo; para o resto continua indo o quadro inteiro.
          delta: msg.delta === 1,
        });
        avisoMuteAtivo(ws).catch(() => {});
        return;
      }

      if (!ws.playerId) return;

      if (msg.t === CLIENTE.CHAT_MUTE) {
        if (!podeApagarChat(ws)) return;
        const alvo = String(msg.nick ?? '').trim();
        const minutos = Number(msg.minutos);
        if (!nickValido(alvo) || !MUTE_MINUTOS.has(minutos)) return;
        if (alvo.toLowerCase() === String(ws.nick ?? '').toLowerCase()) return;
        mutarPorStaff(ws, alvo, minutos)
          .catch((err) => console.error('[chat] mute falhou:', err.message));
        return;
      }

      /**
       * `/mute` e `/unmute` — a moderação sem tirar a mão do teclado.
       *
       * Existem porque a denúncia chega em PRIVADO — hoje pela DM da Lista de Amigos, desde
       * que a v1.55.1 tirou o sussurro do chat. O jogador conta que fulano está enchendo o
       * Mundo de propaganda, e até aqui o moderador tinha de achar uma mensagem daquele nick
       * no chat para abrir o menu dela. Se o infrator já parou de falar (ou o mute do menu
       * não cabe na régua da punição), não havia por onde. Digitar o nick resolve os dois.
       *
       * A checagem de permissão é do SERVIDOR, não do cliente que escondeu o comando: quem
       * não é admin nem moderador leva a recusa aqui, mesmo mandando o pacote na mão.
       */
      if (msg.t === CLIENTE.CHAT_COMANDO) {
        if (!podeComandarChat(ws)) {
          return ws.send(codificar({ t: SERVIDOR.CHAT_AVISO, chave: 'chat.cmdSemPermissao' }));
        }
        const cmd = String(msg.cmd ?? '').trim().toLowerCase();
        const alvo = String(msg.nick ?? '').trim().replace(/^@/, '');
        if (cmd !== 'mute' && cmd !== 'unmute') {
          return ws.send(codificar({ t: SERVIDOR.CHAT_AVISO, chave: 'chat.cmdDesconhecido' }));
        }
        if (!nickValido(alvo)) {
          return ws.send(codificar({
            t: SERVIDOR.CHAT_AVISO, chave: 'chat.cmdAlvoInvalido', nick: alvo,
          }));
        }
        if (alvo.toLowerCase() === String(ws.nick ?? '').toLowerCase()) {
          return ws.send(codificar({ t: SERVIDOR.CHAT_AVISO, chave: 'chat.cmdAlvoEuMesmo' }));
        }

        if (cmd === 'unmute') {
          (async () => {
            const r = await revogarMuteChat(alvo);
            if (!r.ok) {
              return ws.send(codificar({
                t: SERVIDOR.CHAT_AVISO, chave: 'chat.cmdUnmuteVazio', nick: alvo,
              }));
            }
            // O mutado precisa saber que voltou a falar. `ate: 0` é o que `chat.mute` já
            // usa como "acabou" — o cliente limpa o aviso e libera o input.
            const gw = await gatewayDoJogador(alvo);
            if (gw) {
              publicar(canalGateway(gw), {
                para: alvo.toLowerCase(),
                msg: { t: SERVIDOR.CHAT_MUTE, ate: 0 },
              });
            }
            ws.send(codificar({
              t: SERVIDOR.CHAT_AVISO, chave: 'chat.cmdUnmuteOk', nick: r.nick ?? alvo,
            }));
            console.log(`[chat] ${ws.nick} revogou o mute de ${r.nick ?? alvo}`);
          })().catch((err) => console.error('[chat] unmute falhou:', err.message));
          return;
        }

        const minutos = Math.floor(Number(msg.minutos));
        if (!Number.isFinite(minutos) || minutos < 1 || minutos > MUTE_CMD_MAX_MIN) {
          return ws.send(codificar({
            t: SERVIDOR.CHAT_AVISO, chave: 'chat.cmdMinutosInvalidos', minutos: MUTE_CMD_MAX_MIN,
          }));
        }
        mutarPorStaff(ws, alvo, minutos)
          .catch((err) => console.error('[chat] /mute falhou:', err.message));
        return;
      }

      if (msg.t === CLIENTE.CHAT_DELETE) {
        if (!podeApagarChat(ws)) return;
        const id = String(msg.id ?? '').trim();
        if (!id) return;
        chatDb.apagar(id).catch((err) => console.error('[chat-db] apagar:', err.message));
        return publicar(CANAL_CHAT, { op: 'del', id });
      }

      if (msg.t === CLIENTE.CHAT_HISTORICO) {
        if (!ws.playerId) return;
        const canal = CANAIS_CHAT.includes(msg.canal) ? msg.canal : 'mundo';
        (async () => {
          try {
            let mensagens;
            if (canal === 'guild') {
              if (!ws.guildId) return;
              mensagens = await chatDb.historicoGuild(ws.guildId);
            } else {
              mensagens = await chatDb.historicoMundo();
            }
            if (ws.readyState === 1) {
              ws.send(codificar({ t: SERVIDOR.CHAT_HISTORICO, canal, mensagens }));
            }
          } catch (err) {
            console.error('[chat] historico falhou:', err.message);
          }
        })();
        return;
      }

      if (msg.t === CLIENTE.CHAT_SEND) {
        const canal = CANAIS_CHAT.includes(msg.canal) ? msg.canal : 'mundo';
        const agoraChat = Date.now();
        if (!ws.admin && (ws.nivel ?? 0) < CHAT_NIVEL_MIN) {
          return ws.send(codificar({
            t: SERVIDOR.ERRO,
            chave: 'chat.nivelMinimo',
            msg: `Nível ${CHAT_NIVEL_MIN} para usar o chat.`,
          }));
        }
        (async () => {
          if (await recusarSeMutado(ws)) return;
          // A espera é da CONTA e não deste socket: `ws.ultimoChat` nascia zerado a cada
          // conexão, e reconectar entre uma mensagem e outra furava os 5 s. O balde já consome
          // a ficha ao passar, então não há carimbo a gravar aqui. Ver `limites-ws.mjs`.
          if (!podeApagarChat(ws) && !limitesWs.permitir(ws.playerId, 'chat', agoraChat)) {
            return ws.send(codificar({
              t: SERVIDOR.ERRO,
              chave: 'chat.espera',
              msg: `Aguarde ${CHAT_COOLDOWN_MS / 1000} segundos entre mensagens.`,
            }));
          }
          const idioma = IDIOMAS_CHAT.includes(msg.idioma) ? msg.idioma : 'pt';
          const texto = String(msg.texto ?? '').slice(0, 200).trim();
          if (!texto) return;
          if (chatContemNft(texto)) {
            return ws.send(codificar({ t: SERVIDOR.CHAT_AVISO, chave: 'chat.nftBloqueado' }));
          }
          if (canal === 'guild' && !ws.guildId) {
            return ws.send(codificar({
              t: SERVIDOR.ERRO,
              chave: 'chat.semGuild',
              msg: 'Entre numa guild para usar este chat.',
            }));
          }
          if (!ws.vip && /:vip\d{1,3}:/.test(texto)) {
            return ws.send(codificar({
              t: SERVIDOR.ERRO,
              chave: 'chat.vipEmojiTravado',
              msg: 'Emoji exclusivo de VIP — assine na Loja para soltar este aqui.',
            }));
          }
          const payload = {
            id: proximoIdChat(),
            canal,
            idioma,
            de: ws.nick,
            texto,
            ts: Date.now(),
            cargo: cargoDoChat(ws),
            fundador: ws.fundador ?? null,
            // A TAG da guild vai CARIMBADA na mensagem, e não resolvida pelo cliente a partir do
            // `guildId`: quem lê a linha no Mundo não tem a lista de guilds do servidor, e pedir
            // uma por autor seria uma consulta por fala alheia. Vem de `ws.guildTag`, que o
            // delta de estado mantém em dia (ver `lerCargo`).
            guildTag: ws.guildTag ?? null,
            guildTagCor: ws.guildTag ? (ws.guildTagCor ?? null) : null,
            nivel: ws.nivel ?? null,
            guildId: canal === 'guild' ? ws.guildId : undefined,
          };
          publicar(CANAL_CHAT, payload);
          persistirChat(payload);
        })().catch((err) => console.error('[chat] send falhou:', err.message));
        return;
      }

      // `doCliente` vai DEPOIS do spread, como o `playerId`: o cliente não consegue apagar nem
      // trocar. É o que diz ao sim que isto é clique de jogador, e clique de jogador só alcança os
      // comandos de jogador — ver o topo do handler de `canalSim` em `sim.mjs`.
      if (typeof msg.t !== 'string') return;
      // Limite por tipo de ação (mercado, loja, guild/amigos) — acima do pico real de um jogador.
      const categoria = limitesWs.categoriaDe(msg.t);
      if (categoria && !limitesWs.permitir(ws.playerId, categoria, t)) return recusarPorLimite(ws, ws.playerId, t);
      enviarParaSim(ws.playerId, { ...msg, playerId: ws.playerId, doCliente: true });
    });

    ws.on('close', () => {
      if (!ws.playerId) return;
      const dono = sockets.get(ws.playerId);

      // A vaga na rede volta quando NENHUM socket vivo segura mais este nick.
      //
      // São dois casos, e o segundo é o que uma guarda simples de "sou o dono?" deixaria
      // passar: o socket que pegou a vaga e morreu ANTES de se registrar no mapa (queda no
      // meio das consultas de cargo, por exemplo) nunca foi dono de nada — e a vaga dele
      // ficaria presa até o TTL de 12 h, com o jogador vendo a rede cheia sem estar.
      // No F5 o socket novo JÁ é o dono quando o antigo fecha, e aí a vaga é dele: não se
      // devolve nada, senão a rede passaria a aceitar uma quinta conta.
      if (ws.redeBucket && (dono === ws || dono === undefined)) {
        sairDaRede(ws.redeBucket, ws.playerId).catch(() => {});
      }

      // Daqui para baixo, só se ESTE socket ainda for o dono do nick.
      //
      // Num F5 (ou numa segunda aba) o socket novo entra no mapa ANTES de o antigo fechar.
      // Sem esta guarda, o `close` atrasado do antigo apagava a entrada do novo e mandava
      // `sair` ao sim — a aba recém-aberta ficava viva na tela, mas nenhum clique dela
      // chegava ao servidor.
      if (dono !== ws) return;
      sockets.delete(ws.playerId);
      marcarOffline(ws.playerId).catch(() => {});
      enviarParaSim(ws.playerId, { t: 'sair', playerId: ws.playerId });
    });

    ws.on('error', () => {});
  });

  // heartbeat: a cada 30 s manda ping nativo; se em 30 s não houve tráfego do cliente
  // (mensagem ou pong nativo — ver `ws.vivo = true` no handler de `message`), derruba.
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.vivo) {
        ws.terminate();
        continue;
      }
      ws.vivo = false;
      ws.ping();
    }
  }, 30000);

  // Rede de segurança do webhook: pergunta ao provedor se algum pendente já foi pago. Só roda
  // se houver provedor configurado — sem isso seria um timer varrendo o banco à toa em dev.
  if (pagamentosAtivos()) {
    setInterval(() => {
      reconciliarPendentes().catch((err) => console.error('[diamantes] reconciliação:', err.message));
    }, 60_000).unref();
  }

  // A agenda dos eventos: "toda sexta, meio-dia". A cada minuto o gateway pergunta ao banco
  // quais regras venceram e liga o evento — de um minuto, porque a hora marcada é anunciada
  // à comunidade e ninguém quer explicar por que o evento das 12h entrou 12:09.
  //
  // Roda AQUI, e não no sim: é o gateway quem já fala com o Postgres do painel, e a
  // reivindicação no banco (ver `reivindicarAgendasVencidas`) garante um disparo só mesmo com
  // mais de um processo destes de pé.
  setInterval(() => {
    dispararAgendaDeEventos().catch((err) => console.error('[eventos] agenda:', err.message));
  }, 60_000).unref();

  // A mesma rede de segurança para o voto: se o webhook do TopIdle se perder, a API deles é
  // relida a partir do último cursor. Cinco minutos porque um voto não tem ninguém olhando o
  // contador do outro lado — ao contrário de um pagamento, que acabou de sair do cartão.
  if (process.env.TOPIDLE_API_KEY) {
    setInterval(() => {
      recuperarVotos().catch((err) => console.error('[topidle] recuperação:', err.message));
    }, 5 * 60_000).unref();
  }

  http.listen(config.porta, () => {
    console.log(`[gateway] ${gatewayId} ouvindo em http://localhost:${config.porta}`);
    const prov = provedoresAtivos();
    const ligados = Object.entries(prov).filter(([, on]) => on).map(([n]) => n);
    console.log(
      `[auth] contas com senha ativas · provedores: ${ligados.length ? ligados.join(', ') : 'nenhum'}` +
        `${process.env.RESEND_API_KEY ? ' · Resend ligado' : ' · Resend desligado (e-mail não sai)'}`,
    );
    const pag = [pixAtivo() && 'PIX (Efí)', cartaoAtivo() && 'cartão (Stripe)'].filter(Boolean);
    console.log(
      `[diamantes] compra ${pag.length ? `ativa · ${pag.join(', ')}` : 'DESLIGADA (sem provedor configurado)'}`,
    );
    console.log(
      `[topidle] voto ${votoAtivo() ? `ativo · jogo ${JOGO_ID}` : 'DESLIGADO (sem TOPIDLE_WEBHOOK_SECRET)'}` +
        `${process.env.TOPIDLE_API_KEY ? ' · recuperação pela API ligada' : ''}`,
    );
    console.log(
      `[gateway] compressão do socket: ${process.env.WS_DEFLATE === '0' ? 'DESLIGADA'
        : process.env.WS_DEFLATE_CONTEXTO === '1' ? 'com contexto' : 'sem contexto (≥ 1 kB)'}`,
    );
  });

  // ---- saída de propósito: deploy, `systemctl restart`
  //
  // Fecha cada socket com 1012 antes de sair, para o navegador saber que é reinício e espalhar a
  // volta — ver `encerrar-gateway.mjs`. Só no ROLE=gateway: no `all` quem cuida do SIGTERM é o sim,
  // que precisa gravar todo jogador antes de o processo acabar.
  if (config.role === 'gateway') {
    const { fecharParaReinicio } = await import('./encerrar-gateway.mjs');
    const sair = (sinal) => {
      const n = fecharParaReinicio(wss.clients);
      console.log(`[gateway] ${sinal}: ${n} socket(s) fechados com 1012 — saindo`);
      setTimeout(() => process.exit(0), 1000);
    };
    process.once('SIGTERM', () => sair('SIGTERM'));
    process.once('SIGINT', () => sair('SIGINT'));
  }
}
