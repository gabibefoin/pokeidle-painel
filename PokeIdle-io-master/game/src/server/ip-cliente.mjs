import { BlockList, isIPv4, isIPv6 } from 'node:net';

/**
 * De quem é esta requisição — o IP usado como chave dos limites por jogador.
 *
 * Existia uma cópia disto em quatro arquivos de rota (`auth`, `afiliados`, `diamantes`,
 * `topidle`), todas com o mesmo defeito, e é por isso que agora mora aqui: um limite por IP não
 * vale mais do que a confiança na origem do IP, e essa é uma decisão para se tomar UMA vez.
 *
 * ### O defeito que isto conserta
 *
 * As quatro liam `X-Forwarded-For.split(',')[0]` — o PRIMEIRO da lista. O comentário do
 * Caddyfile explicava a escolha pelo caso do Cloudflare (`<jogador>, <cloudflare>`), e a
 * explicação estava certa sobre o formato e errada sobre a confiança: nenhum proxy do caminho
 * APAGA o que o cliente mandou. Quem chega com `X-Forwarded-For: 1.2.3.4` inventado faz a lista
 * virar `1.2.3.4, <jogador>, <cloudflare>` — e o primeiro elemento, o único que era lido, é o
 * que o atacante escreveu. Um cabeçalho diferente por requisição dava um balde novo a cada
 * tentativa: o limite de 12 logins por minuto virava ilimitado.
 *
 * ### O que se lê agora, e por quê nesta ordem
 *
 * 1. `CF-Connecting-IP` — o Cloudflare SOBRESCREVE este cabeçalho no que passa por ele, então
 *    o cliente não consegue plantar valor nele. É o único da lista que um proxy garante.
 * 2. O ÚLTIMO elemento de `X-Forwarded-For` — o que o Caddy acrescentou, ou seja, o peer que
 *    ELE viu. Nunca é escolha do cliente; o cliente só consegue empurrar coisa para a
 *    esquerda da lista, não para a direita.
 * 3. O socket, quando não há proxy nenhum (desenvolvimento).
 *
 * ### `CF-Connecting-IP` só vale quando quem ENTREGOU a requisição é o Cloudflare
 *
 * A origem responde na 443 direto, sem passar pelo Cloudflare — e quem fala com ela escreve o
 * `CF-Connecting-IP` que quiser, porque ali não há Cloudflare nenhum para sobrescrever. Um valor
 * inventado por requisição era um balde novo por tentativa: o limite de 12 logins por minuto, o
 * de compra, o teto de contas por rede e o carimbo de origem viravam ilimitados (ou, pior,
 * apontáveis para a rede de outra pessoa).
 *
 * Por isso o cabeçalho só é lido quando o PEER — o último de `X-Forwarded-For`, que o Caddy
 * escreve, ou o socket — está numa faixa oficial do Cloudflare. Quem chega por fora fica preso ao
 * próprio IP, e o cabeçalho forjado é ignorado (e anotado no log, uma vez a cada 10 min por peer).
 *
 * As faixas mudam raramente, mas mudam. Se um dia o Cloudflare publicar uma nova e ela não
 * estiver aqui, os jogadores que passarem por ela aparecem com o IP do Cloudflare — e o log
 * `[ip] CF-Connecting-IP de fora do Cloudflare` começa a citar o peer. Duas saídas sem deploy:
 * `CLOUDFLARE_FAIXAS_EXTRA=a.b.c.d/nn,...` no `.env` (e restart), ou `IP_CONFIAR_CF_SEMPRE=1`,
 * que volta ao comportamento antigo. Conferido em 15/09/2026: 2.338 de 2.338 conexões na 443 da
 * produção vinham destas faixas.
 */
const FAIXAS_CLOUDFLARE = {
  // https://www.cloudflare.com/ips-v4 (15/09/2026)
  ipv4: [
    '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
    '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
    '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  ],
  // https://www.cloudflare.com/ips-v6 (15/09/2026)
  ipv6: [
    '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
    '2a06:98c0::/29', '2c0f:f248::/32',
  ],
};

/** `::ffff:1.2.3.4` (IPv4 embrulhado pelo Node) volta a ser `1.2.3.4`. */
const semEmbrulho = (ip) => String(ip ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

let faixasCloudflare = null;
/** Montada na primeira consulta, e não no import: o `.env` pode ainda não ter sido lido ali. */
function faixas() {
  if (faixasCloudflare) return faixasCloudflare;
  const lista = new BlockList();
  const extras = String(process.env.CLOUDFLARE_FAIXAS_EXTRA ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const faixa of [...FAIXAS_CLOUDFLARE.ipv4, ...FAIXAS_CLOUDFLARE.ipv6, ...extras]) {
    const [rede, bits] = faixa.split('/');
    const tipo = isIPv4(rede) ? 'ipv4' : isIPv6(rede) ? 'ipv6' : null;
    if (!tipo || !Number.isInteger(Number(bits))) {
      console.warn(`[ip] faixa do Cloudflare ignorada (formato): ${faixa}`);
      continue;
    }
    lista.addSubnet(rede, Number(bits), tipo);
  }
  faixasCloudflare = lista;
  return lista;
}

/** O endereço está numa faixa do Cloudflare? Texto que não é IP responde `false`. */
export function ehCloudflare(ip) {
  const s = semEmbrulho(ip);
  if (isIPv4(s)) return faixas().check(s, 'ipv4');
  if (isIPv6(s)) return faixas().check(s, 'ipv6');
  return false;
}

const avisados = new Map();
function avisarCabecalhoDeFora(peer) {
  const agora = Date.now();
  if ((avisados.get(peer) ?? 0) > agora) return;
  if (avisados.size >= 1000) avisados.clear();
  avisados.set(peer, agora + 600_000);
  console.warn(`[ip] CF-Connecting-IP de fora do Cloudflare (peer ${String(peer).slice(0, 64)}) — ignorado`);
}

export function ipCliente(req) {
  const encaminhado = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const peer = encaminhado.length ? encaminhado[encaminhado.length - 1] : (req.socket?.remoteAddress || '');

  const cf = String(req.headers['cf-connecting-ip'] ?? '').trim();
  if (cf) {
    if (ehCloudflare(peer) || process.env.IP_CONFIAR_CF_SEMPRE === '1') return cf;
    avisarCabecalhoDeFora(peer);
  }
  return peer || '?';
}

/**
 * O IP reduzido à CASA que ele representa — a chave de agrupamento de contas por origem.
 *
 * Em IPv4 é o próprio endereço, e não há o que fazer: o provedor é quem decide quantas casas
 * dividem um. Em IPv6 é diferente e vale a pena aproveitar: a operadora entrega um bloco /64
 * inteiro por assinante, e o aparelho ainda troca de endereço dentro dele sozinho (privacy
 * extensions). Contar o endereço cheio contaria o mesmo notebook como uma casa nova a cada
 * dia; contar o /64 conta a assinatura, que é o que se quer saber.
 *
 * O `::ffff:1.2.3.4` do Node (IPv4 embrulhado em IPv6) é desembrulhado antes, senão o mesmo
 * jogador cairia em dois baldes conforme a pilha de rede da vez.
 */
/**
 * O maior endereço possível é um IPv6 completo: 39 caracteres. 64 dá folga para zona
 * (`%eth0`) sem deixar passar lixo.
 *
 * O teto existe porque o valor lido acima vem de um CABEÇALHO, e quem fala direto com a
 * origem escreve o que quiser nele (ver a ressalva no topo deste arquivo). Sem o teto, um
 * `CF-Connecting-IP` de 16 kB (o limite de cabeçalho do Node) entraria como chave de um índice
 * btree — que recusa entradas acima de ~2,7 kB — e cada requisição dessas viraria um erro
 * gravado em log, além de inflar a tabela.
 */
const IP_MAX = 64;

/** O que um endereço pode conter: hex, ponto, dois-pontos e a zona. Nada mais. */
const IP_FORMATO = /^[0-9a-f.:%]+$/;

/**
 * O IP cru, podado para caber no banco. Mantém o valor como veio (é prova forense de um
 * cabeçalho forjado), só não deixa passar de `IP_MAX`.
 */
export const ipParaGravar = (ip) => {
  const s = String(ip ?? '').trim();
  return s ? s.slice(0, IP_MAX) : null;
};

export function bucketDeIp(ip) {
  const cru = String(ip ?? '').trim().toLowerCase();
  if (!cru || cru === '?' || cru.length > IP_MAX) return null;
  // Formato antes de qualquer conta: um cabeçalho forjado com texto arbitrário não pode virar
  // "casa" nenhuma. Sem isto, quem chega na origem escolhe em que balde cai — e escolher o
  // balde de outra pessoa é plantar contas alheias no aglomerado dela no painel.
  if (!IP_FORMATO.test(cru)) return null;

  const semZona = cru.split('%')[0];
  const v4Embrulhado = semZona.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Embrulhado) return v4Embrulhado[1];
  if (!semZona.includes(':')) return semZona;

  // IPv6: os quatro primeiros grupos são o /64. `::` é expandido antes para que
  // `2804:1b3::1` e `2804:1b3:0:0:...` caiam no mesmo balde.
  const [esq, dir] = semZona.split('::');
  const a = esq ? esq.split(':').filter(Boolean) : [];
  const b = dir ? dir.split(':').filter(Boolean) : [];
  const grupos = semZona.includes('::')
    ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b]
    : a;
  if (grupos.length < 4) return semZona;
  return `${grupos.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
