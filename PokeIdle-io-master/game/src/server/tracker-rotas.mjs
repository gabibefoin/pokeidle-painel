// A API DO TRACKER — `/tracker/api/*`, o único jeito de a página falar com o servidor.
//
// ### Por que HTTP, e não o socket do jogo
//
// O jogo inteiro fala por WebSocket, e a tentação era reusar aquele caminho. Não serve, por
// duas razões que se somam:
//
//   · o socket exige `hello` com token de sessão. O Tracker é público — quem abre o link do
//     Discord não tem conta, e exigir uma seria matar a razão da página;
//   · um socket é um processo dedicado por visitante enquanto a aba estiver aberta. Uma página
//     de consulta que se lê e se fecha não pode custar isso: o pico de tráfego dela é um post
//     no Discord, e seriam mil conexões para mil pessoas lendo uma tabela que não muda.
//
// Aqui cada visita é um GET, respondido do cache, e o servidor esquece quem foi.
//
// ### A postura de segurança
//
// A superfície é PÚBLICA, SEM AUTENTICAÇÃO e indexável. Então a regra é a mais simples
// possível: **este arquivo só lê, e só devolve o que o jogo já mostra a qualquer jogador.**
//
//   · só `GET` e `HEAD`. Qualquer outro método leva 405 antes de tocar no banco — não há nada
//     aqui para criar, alterar ou apagar, e uma rota de leitura que aceita POST é um convite
//     a alguém procurar o que ela faz com o corpo;
//   · NENHUM token de sessão é lido. Nem no corpo, nem no `Authorization`, nem em cookie. A
//     resposta é a mesma para todo mundo, então não há sessão para roubar nem resposta
//     privada para envenenar num cache;
//   · nenhum valor da URL entra em SQL: nick e temporada passam por expressão regular, ids por
//     `Math.trunc`, e a ordenação é uma CHAVE de um objeto escrito à mão (ver
//     `tracker-consultas.mjs`). Toda consulta é parametrizada;
//   · nenhuma resposta é HTML. É `application/json` com `X-Content-Type-Options: nosniff`
//     (posto globalmente pelo `cabecalhosBase`), então nem um nick com `<script>` dentro tem
//     como ser interpretado como página — e a página que o desenha usa `textContent`;
//   · sem `Access-Control-Allow-Origin`. A API é de mesma origem; um site de fora não lê a
//     resposta pelo navegador de ninguém;
//   · teto por IP e cache curto. O teto é o que impede raspagem e martelo; o cache é o que faz
//     um post viral custar uma consulta em vez de dez mil.
//
// O ban de IP do painel já vale aqui: `servirEstatico` o confere antes de qualquer rota.
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import * as q from './tracker-consultas.mjs';
import { ipCliente, bucketDeIp } from './ip-cliente.mjs';
import { retratosDe, MAX_POR_PEDIDO } from './tracker-sprites.mjs';

const comprimir = promisify(gzip);

/**
 * Teto por ORIGEM: requisições por janela. Generoso para uma pessoa, apertado para um raspador.
 *
 * Quem tem o teto MAIS APERTADO é a busca (`TETO_BUSCA`), e por um motivo só dela: ela é a
 * única rota que enumera. Com dois caracteres de prefixo e oito respostas por chamada, 1.296
 * chamadas varrem a lista de nicks do servidor inteiro — e sessenta por minuto tornariam isso
 * um trabalho de vinte minutos. Os nicks são públicos (aparecem no chat, no Mercado e na
 * tabela), então não é segredo que se está protegendo: é a diferença entre "público" e
 * "empacotado num arquivo", que é o que alimenta lista de alvo para roubo de conta.
 */
const TETO_POR_IP = 60;
const TETO_BUSCA = 20;
const JANELA_MS = 60_000;

/** Cache de resposta. Curto porque o dado é vivo; longo o bastante para segurar um pico. */
const CACHE_MS = 30_000;

/**
 * Teto do cache em BYTES, e não em número de entradas.
 *
 * Era em entradas (400), e a medição mostrou o problema: a ficha de um jogador tem ~38 kB de
 * JSON, então 400 fichas são ~15 MB de texto mais o grafo de objetos que o gerou — uma rajada
 * de 300 perfis diferentes subiu o RSS do processo em 53 MB. Num gateway que também segura
 * milhares de sockets, é memória demais para uma página de consulta, e é memória que um
 * visitante escolhe gastar (basta pedir perfis diferentes).
 *
 * Contando bytes, o teto é o que importa: cabem milhares de respostas pequenas (meta, ladder,
 * sprites) ou algumas centenas de fichas grandes, e o número não depende de quem está pedindo.
 */
const CACHE_MAX_BYTES = 8 * 1024 * 1024;

/** O corpo de resposta maior que isto não sai: é sinal de que um teto de lista falhou. */
const TETO_CORPO = 512 * 1024;

/** A partir deste tamanho a resposta vai comprimida para quem aceitar. */
const MINIMO_GZIP = 1024;

// ------------------------------------------------------------------- baldes

const baldes = new Map();

/**
 * A ORIGEM de um pedido, para efeito de teto.
 *
 * `bucketDeIp` e não o IP cru — é o mesmo agrupamento que o ban de IP do painel usa. Num IPv4 é
 * o próprio endereço; num IPv6 é o /64, que é o bloco que uma operadora entrega a UMA casa.
 *
 * Com o IP cru o teto era decorativo contra quem tem IPv6: dá para trocar de endereço dentro do
 * próprio /64 a cada requisição, e cada uma cairia num balde novo. De quebra, cada endereço
 * novo virava uma entrada no `Map` — um martelo de IPv6 fazia o teto não barrar nada E ainda
 * enchia a memória do processo com os baldes que ele acabara de criar.
 */
const origemDe = (req) => bucketDeIp(ipCliente(req)) ?? 'desconhecida';

function passouDoTeto(origem, teto) {
  const agora = Date.now();
  const b = baldes.get(origem);
  if (!b || agora > b.zeraEm) {
    baldes.set(origem, { n: 1, busca: 0, zeraEm: agora + JANELA_MS });
    return false;
  }
  b.n += 1;
  // Só registra a PRIMEIRA vez que o balde estoura na janela: um raspador que insista escreve
  // uma linha por minuto no log, e não dez mil.
  if (b.n === TETO_POR_IP + 1) console.warn(`[tracker] teto atingido: ${origem}`);
  return b.n > teto;
}

/** O balde exclusivo da busca, contado por cima do geral. */
function passouDoTetoDaBusca(origem) {
  const b = baldes.get(origem);
  if (!b) return false;
  b.busca = (b.busca ?? 0) + 1;
  return b.busca > TETO_BUSCA;
}

setInterval(() => {
  const agora = Date.now();
  for (const [origem, b] of baldes) if (agora > b.zeraEm) baldes.delete(origem);
}, JANELA_MS).unref();

// ------------------------------------------------------------------- cache

const cache = new Map(); // chave → { em, promessa, bytes }
let cacheBytes = 0;

/**
 * Responde do cache ou gera — e guarda a PROMESSA, não o resultado.
 *
 * Guardar a promessa é o que faz cem visitas no mesmo instante virarem UMA consulta: as outras
 * 99 esperam a mesma. Com o resultado, as cem sairiam para o banco antes de a primeira voltar,
 * que é exatamente o cenário do link recém-postado.
 *
 * O tamanho de cada entrada só é conhecido DEPOIS de a promessa resolver, então a conta de
 * bytes é feita lá — e é lá que a faxina roda. Uma entrada que ainda não resolveu conta zero,
 * o que é conservador na direção certa: ela ainda não ocupou nada.
 */
function comCache(chave, gerar) {
  const agora = Date.now();
  const achado = cache.get(chave);
  if (achado && agora - achado.em < CACHE_MS) return achado.promessa;

  const entrada = { em: agora, promessa: null, bytes: 0 };
  entrada.promessa = gerar().then((r) => {
    // O JSON é montado UMA vez por entrada de cache, e não uma vez por requisição. Cem visitas
    // à mesma tabela no mesmo minuto serializavam a mesma resposta cem vezes — trabalho puro,
    // proporcional ao tráfego, para produzir sempre o mesmo texto.
    const pronta = {
      codigo: r?.codigo ?? 200,
      cacheSegundos: r?.cacheSegundos ?? 0,
      texto: JSON.stringify(r?.corpo ?? null),
      gz: null, // preenchido na primeira vez que alguém aceitar gzip — ver `json()`
    };
    entrada.bytes = pronta.texto.length * 2;
    cacheBytes += entrada.bytes;
    faxinarCache(Date.now());
    return pronta;
  });
  // Erro não fica em cache: o pedido seguinte tenta de novo, em vez de herdar a falha por 30 s.
  entrada.promessa.catch(() => descartar(chave));
  cache.set(chave, entrada);
  return entrada.promessa;
}

function descartar(chave) {
  const e = cache.get(chave);
  if (!e) return;
  cacheBytes -= e.bytes;
  cache.delete(chave);
}

function faxinarCache(agora) {
  // Primeiro o que já venceu: é lixo, independente de haver pressão de memória.
  for (const [k, v] of cache) if (agora - v.em >= CACHE_MS) descartar(k);
  if (cacheBytes <= CACHE_MAX_BYTES) return;
  // Ainda cheio com tudo fresco: sai a mais VELHA primeiro. A ordem de inserção do `Map` já é
  // a ordem de chegada, então percorrer do começo é percorrer da mais velha para a mais nova —
  // sem ordenar nada.
  for (const k of cache.keys()) {
    if (cacheBytes <= CACHE_MAX_BYTES) break;
    descartar(k);
  }
}

// ----------------------------------------------------------------- resposta

/**
 * A resposta JSON, comprimida quando vale a pena.
 *
 * O gzip não é enfeite de banda: a ficha de um jogador tem ~38 kB (vinte partidas com o
 * relatório de cada pokémon) e comprime para ~4 kB, porque é JSON repetitivo — as mesmas
 * chaves, os mesmos nomes de espécie, os mesmos tipos, vinte vezes. Numa página que se abre
 * do celular, é a diferença entre carregar num pestanejar e carregar.
 *
 * Só acima de 1 kB: abaixo disso o cabeçalho do gzip come o ganho e o custo de CPU não se paga.
 */
async function json(req, res, pronta) {
  const { codigo = 200, cacheSegundos = 0, texto } = pronta;
  if (texto.length > TETO_CORPO) {
    console.error(`[tracker] resposta de ${texto.length} bytes barrada — algum teto de lista falhou`);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return void res.end('{"erro":"tracker.falhou"}');
  }
  const cabecalho = {
    'content-type': 'application/json; charset=utf-8',
    // `public` é seguro porque a resposta NÃO depende de quem pediu — não há sessão aqui. Um
    // cache compartilhado (Cloudflare) servir a mesma tabela a todo mundo é o desejado, e é o
    // que faz um link viral custar uma consulta em vez de dez mil.
    'cache-control': codigo === 200 && cacheSegundos
      ? `public, max-age=${cacheSegundos}`
      : 'no-store',
    // Sem isto, um proxy no meio do caminho pode servir a resposta comprimida para um cliente
    // que não pediu compressão (ou o contrário).
    vary: 'accept-encoding',
  };

  if (texto.length >= MINIMO_GZIP && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    try {
      const gz = await gzipDaResposta(pronta);
      res.writeHead(codigo, { ...cabecalho, 'content-encoding': 'gzip', 'content-length': gz.length });
      return void res.end(req.method === 'HEAD' ? undefined : gz);
    } catch { /* comprimir falhou: segue sem compressão, que é sempre uma resposta válida */ }
  }
  const bruto = Buffer.from(texto, 'utf8');
  res.writeHead(codigo, { ...cabecalho, 'content-length': bruto.length });
  // `HEAD` recebe os mesmos cabeçalhos e corpo nenhum — é o que o Node espera, e é o que faz um
  // monitor externo conseguir checar a rota sem baixar a tabela inteira.
  res.end(req.method === 'HEAD' ? undefined : bruto);
}

/**
 * O gzip de uma resposta — UMA vez por entrada de cache, e no máximo alguns ao mesmo tempo.
 *
 * As duas travas saíram da mesma medição. Comprimir a cada requisição fazia 300 pedidos
 * simultâneos abrirem 300 contextos de deflate no zlib (cada um com seu buffer de janela), e o
 * RSS do processo subia ~90 MB numa rajada — num gateway que também segura os sockets do jogo.
 *
 *   · memoizar na entrada resolve o caso comum: a mesma tabela pedida cem vezes em trinta
 *     segundos comprime uma vez;
 *   · a fila de `GZIP_SIMULTANEOS` resolve o caso ruim: trezentas respostas DIFERENTES não
 *     viram trezentos contextos de zlib de uma vez, viram quatro por vez.
 *
 * O ganho que justifica tudo isso: a ficha de um jogador sai de ~13 kB para ~1,2 kB.
 */
const GZIP_SIMULTANEOS = 4;
let gzipsAgora = 0;
const filaGzip = [];

function vagaDeGzip() {
  if (gzipsAgora < GZIP_SIMULTANEOS) {
    gzipsAgora++;
    return Promise.resolve();
  }
  return new Promise((ok) => filaGzip.push(ok));
}

function soltarVagaDeGzip() {
  const proximo = filaGzip.shift();
  if (proximo) proximo();
  else gzipsAgora--;
}

function gzipDaResposta(pronta) {
  // A promessa é guardada (e não o buffer): dois pedidos simultâneos da mesma resposta esperam
  // a MESMA compressão, em vez de disputarem duas vagas para produzir o mesmo buffer.
  if (pronta.gz) return pronta.gz;
  pronta.gz = (async () => {
    await vagaDeGzip();
    try {
      return await comprimir(Buffer.from(pronta.texto, 'utf8'));
    } finally {
      soltarVagaDeGzip();
    }
  })();
  pronta.gz.catch(() => { pronta.gz = null; });
  return pronta.gz;
}

// ------------------------------------------------------------------- rotas

/**
 * As rotas, num objeto. Cada uma devolve `{ corpo, cacheSegundos }` ou lança.
 *
 * Tabela e não uma cadeia de `if`: a lista do que a API expõe cabe numa tela, e uma rota nova
 * não pode entrar sem alguém escrever o nome dela aqui. Foi a forma encontrada de a superfície
 * pública ser auditável de relance.
 */
const ROTAS = {
  async '/tracker/api/inicio'(url) {
    const temporada = q.temporadaValida(url.searchParams.get('temporada'));
    const [tabela, top, ladder, temps] = await Promise.all([
      q.meta({ temporada, ordem: 'uso', limite: 10 }),
      q.meta({ temporada, ordem: 'winrate', limite: 5 }),
      q.ladder({ limite: 10 }),
      q.temporadas(8),
    ]);
    return {
      corpo: {
        temporada,
        temporadas: temps,
        amostra: tabela.amostra,
        maisUsados: tabela.linhas,
        melhorTaxa: top.linhas,
        ladder: ladder.linhas,
        classificados: ladder.total,
      },
      cacheSegundos: 30,
    };
  },

  async '/tracker/api/meta'(url) {
    const dados = await q.meta({
      temporada: url.searchParams.get('temporada'),
      ordem: url.searchParams.get('ordem') ?? 'uso',
      limite: url.searchParams.get('limite'),
      pagina: url.searchParams.get('pagina'),
    });
    return { corpo: dados, cacheSegundos: 30 };
  },

  async '/tracker/api/golpes'(url) {
    const lista = await q.golpes({ temporada: url.searchParams.get('temporada') });
    return { corpo: { temporada: q.temporadaValida(url.searchParams.get('temporada')), linhas: lista }, cacheSegundos: 60 };
  },

  async '/tracker/api/pokemon'(url) {
    const ficha = await q.especie({
      speciesId: url.searchParams.get('id'),
      temporada: url.searchParams.get('temporada'),
    });
    if (!ficha) return { codigo: 404, corpo: { erro: 'tracker.semPokemon' } };
    return { corpo: ficha, cacheSegundos: 30 };
  },

  async '/tracker/api/jogador'(url) {
    const nick = q.nickValido(url.searchParams.get('nick'));
    // Nick fora do formato é 400, e não 404: são coisas diferentes, e a tela diz frases
    // diferentes ("esse nome não existe no jogo" contra "ninguém com esse nome").
    if (!nick) return { codigo: 400, corpo: { erro: 'tracker.nickInvalido' } };
    const ficha = await q.jogador(nick);
    if (!ficha) return { codigo: 404, corpo: { erro: 'tracker.semJogador' } };
    return { corpo: ficha, cacheSegundos: 20 };
  },

  async '/tracker/api/busca'(url) {
    const lista = await q.buscar(url.searchParams.get('q'));
    // A busca NÃO entra em cache compartilhado: a chave é o que a pessoa digitou, e uma
    // resposta por prefixo em cache de borda seria um índice de nicks servido de graça.
    return { corpo: { linhas: lista }, cacheSegundos: 0 };
  },

  async '/tracker/api/ladder'(url) {
    const dados = await q.ladder({
      limite: url.searchParams.get('limite'),
      pagina: url.searchParams.get('pagina'),
    });
    return { corpo: dados, cacheSegundos: 30 };
  },

  async '/tracker/api/guilds'() {
    const [lista, ranking] = await Promise.all([q.guerras(14), q.rankingGuilds(20)]);
    return { corpo: { guerras: lista, ranking }, cacheSegundos: 60 };
  },

  /**
   * A ANÁLISE de UMA guerra de guilds. Cache de um minuto aqui e de dez no analisador — ela
   * não muda depois de a guerra acabar, e reler a fita de 40 KB do banco a cada visita seria
   * o único ponto caro da página.
   */
  async '/tracker/api/guerra'(url) {
    const a = await q.guerra(url.searchParams.get('dia'));
    if (!a) return { codigo: 404, corpo: { erro: 'tracker.semGuerra' } };
    // Meia hora: uma guerra que já aconteceu não muda mais. O único motivo de não ser um dia é
    // a troca de nome de uma guild, que o analisador relê no cache dele.
    return { corpo: a, cacheSegundos: 1800 };
  },

  /**
   * ONDE recortar o retrato de cada espécie — ver `tracker-sprites.mjs`.
   *
   * Rota à parte, e não um campo nas outras, por causa do CACHE: isto só muda quando o pack de
   * sprites muda, ou seja, num deploy. Um dia de validade aqui não atrasa nenhum número da
   * tela, e tira do caminho a metade dos bytes de uma visita repetida.
   */
  async '/tracker/api/sprites'(url) {
    const lista = String(url.searchParams.get('lt') ?? '')
      .split(',')
      .slice(0, MAX_POR_PEDIDO);
    return { corpo: { retratos: await retratosDe(lista) }, cacheSegundos: 86_400 };
  },
};

/**
 * A porta de entrada. Devolve `true` quando a requisição foi respondida aqui.
 *
 * @returns {Promise<boolean>}
 */
export async function rotasDoTracker(req, res, url) {
  const rota = url.pathname;
  if (!rota.startsWith('/tracker/api/')) return false;

  // MÉTODO primeiro, antes de qualquer trabalho. A API é de leitura; um `POST` aqui é sempre
  // ou um engano ou uma sondagem, e as duas coisas terminam do mesmo jeito.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET, HEAD' });
    res.end(JSON.stringify({ erro: 'tracker.metodo' }));
    return true;
  }

  const origem = origemDe(req);
  const fn = ROTAS[rota];
  if (!fn) {
    await json(req, res, { codigo: 404, texto: JSON.stringify({ erro: 'tracker.rota' }) });
    return true;
  }

  // O teto vem DEPOIS de saber que a rota existe (senão qualquer 404 consumiria balde) e ANTES
  // do cache: quem já estourou não deve nem receber resposta barata, ou o teto vira enfeite.
  //
  // A BUSCA tem um balde a mais, e o pedido precisa passar nos dois: ela é a única rota que
  // enumera (ver `TETO_BUSCA`), e quem a martela não está lendo a página.
  const ehBusca = rota === '/tracker/api/busca';
  if (passouDoTeto(origem, TETO_POR_IP) || (ehBusca && passouDoTetoDaBusca(origem))) {
    res.writeHead(429, {
      'content-type': 'application/json; charset=utf-8',
      'retry-after': '60',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify({ erro: 'tracker.muitasRequisicoes' }));
    return true;
  }

  // A CHAVE DE CACHE é montada só com os parâmetros que a rota entende, já normalizados por
  // `URLSearchParams`. Usar a URL crua faria `?x=1&pagina=2` e `?pagina=2&x=1` serem duas
  // entradas — e daria a quem quisesse encher o cache uma chave nova por requisição.
  const chave = `${rota}?${chaveDosParametros(rota, url)}`;
  try {
    await json(req, res, await comCache(chave, () => fn(url)));
  } catch (err) {
    // O pool do Tracker cheio (`connectionTimeoutMillis`) é um caso ESPERADO, e não um defeito:
    // quer dizer que a página está sendo martelada mais depressa do que o banco responde. 503
    // com `Retry-After` é a resposta honesta — e é o que impede a fila de virar queda.
    const cheio = /timeout exceeded when trying to connect|Connection terminated/i.test(err.message ?? '');
    if (!cheio) console.error(`[tracker] ${rota} estourou:`, err.message);
    if (cheio) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'retry-after': '5', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ erro: 'tracker.ocupado' }));
    } else {
      await json(req, res, { codigo: 500, texto: JSON.stringify({ erro: 'tracker.falhou' }) });
    }
  }
  return true;
}

/** Os parâmetros que cada rota de fato lê, em ordem fixa — ver a nota da chave de cache. */
const PARAMETROS = {
  '/tracker/api/inicio': ['temporada'],
  '/tracker/api/meta': ['temporada', 'ordem', 'limite', 'pagina'],
  '/tracker/api/golpes': ['temporada'],
  '/tracker/api/pokemon': ['id', 'temporada'],
  '/tracker/api/jogador': ['nick'],
  '/tracker/api/busca': ['q'],
  '/tracker/api/ladder': ['limite', 'pagina'],
  '/tracker/api/guilds': [],
  '/tracker/api/guerra': ['dia'],
  '/tracker/api/sprites': ['lt'],
};

const chaveDosParametros = (rota, url) => (PARAMETROS[rota] ?? [])
  // 80 caracteres é acima de qualquer valor legítimo (o maior é um nick de 20) e impede que um
  // parâmetro gigante vire uma chave gigante no Map do cache.
  .map((p) => `${p}=${String(url.searchParams.get(p) ?? '').slice(0, 80)}`)
  .join('&');
