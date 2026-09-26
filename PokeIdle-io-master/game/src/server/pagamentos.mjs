// Pagamento em dinheiro de verdade: PIX (Efí) e cartão (Stripe).
//
// ### Por que não os SDKs oficiais
//
// O `stripe` do npm traz ~2 MB e uma árvore de dependências para fazer, aqui, três chamadas:
// criar sessão, consultar sessão e conferir a assinatura do webhook. As duas primeiras são
// `POST`/`GET` com corpo form-encoded, e a terceira é um HMAC-SHA256 — tudo que o Node já tem.
// A Efí também tem SDK oficial, e também não entra: a API dela são cinco chamadas HTTP com um
// certificado de cliente, e `node:https` já faz isso sozinho. Este servidor hospeda OAuth, gzip
// e um watcher de blockchain escritos do mesmo jeito; um SDK só para isto destoaria e engordaria
// o deploy sem trocar nada em confiabilidade.
//
// ### As duas integrações são independentes
//
// Dá para subir com só uma configurada. `pixAtivo()`/`cartaoAtivo()` dizem quais existem, e a
// tela esconde o botão do que faltar — oferecer um caminho que responde 503 é pior que não
// oferecer. Sem nenhuma das duas, a compra some da Loja e o resto do jogo segue igual.
//
// ### Variáveis de ambiente
//
//   STRIPE_SECRET_KEY        sk_live_… / sk_test_…
//   STRIPE_WEBHOOK_SECRET    whsec_…  (obrigatória para o webhook ser aceito)
//   EFI_CLIENT_ID            credenciais da aplicação Pix da Efí
//   EFI_CLIENT_SECRET
//   EFI_CERTIFICADO          caminho do certificado .p12 baixado no painel da Efí
//   EFI_CERTIFICADO_SENHA    opcional — só se o .p12 tiver senha
//   EFI_CHAVE_PIX            a chave Pix cadastrada na conta Efí que recebe o dinheiro
//   EFI_WEBHOOK_SEGREDO      OBRIGATÓRIA — sem ela o webhook não é aceito (ver validarWebhookEfi)
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Agent, request as httpsRequest } from 'node:https';

const seg = (v) => (v ?? '').trim();

export const cartaoAtivo = () => !!seg(process.env.STRIPE_SECRET_KEY);
export const pixAtivo = () => !!(
  seg(process.env.EFI_CLIENT_ID) && seg(process.env.EFI_CLIENT_SECRET) &&
  seg(process.env.EFI_CERTIFICADO) && seg(process.env.EFI_CHAVE_PIX) &&
  // Sem segredo, o webhook aceitaria qualquer POST — ver o cabeçalho de `validarWebhookEfi`.
  seg(process.env.EFI_WEBHOOK_SEGREDO)
);
export const pagamentosAtivos = () => cartaoAtivo() || pixAtivo();

/**
 * O resultado normalizado de uma consulta ao provedor.
 *
 * Os dois provedores respondem formatos diferentes; quem chama só quer saber "foi pago, de
 * qual referência, quanto e em quê". `comprovante` é a prova que fica gravada no pagamento —
 * o `payment_intent` do Stripe ou o `endToEndId` da Efí.
 *
 * @typedef {{referencia:string, centavos:number, moeda:string, comprovante:string}} Pago
 */

// ------------------------------------------------------------------- Stripe

const STRIPE_API = 'https://api.stripe.com/v1';

/**
 * A API do Stripe é form-encoded com chaves aninhadas por colchete
 * (`line_items[0][price_data][currency]`). Isto achata o objeto nesse formato.
 */
function achatar(obj, prefixo = '', saida = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const chave = prefixo ? `${prefixo}[${k}]` : k;
    if (typeof v === 'object') achatar(v, chave, saida);
    else saida.append(chave, String(v));
  }
  return saida;
}

async function stripe(caminho, { metodo = 'GET', corpo } = {}) {
  const chave = seg(process.env.STRIPE_SECRET_KEY);
  if (!chave) throw new Error('stripe não configurado');

  const r = await fetch(`${STRIPE_API}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${chave}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: corpo ? achatar(corpo).toString() : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`stripe ${caminho} ${r.status}: ${j?.error?.message ?? 'erro'}`);
  return j;
}

/**
 * Cria a sessão de Checkout hospedada e devolve para onde mandar o jogador.
 *
 * `client_reference_id` leva a NOSSA referência. É por ela que o webhook reencontra a linha em
 * `diamante_pagamentos` — sem isso, casar um pagamento com um jogador dependeria do valor, que
 * não é único.
 *
 * `payment_method_types: card` é explícito: este caminho é o do CARTÃO. O PIX do jogo vai pela
 * Efí, e deixar o Stripe oferecer os dois faria a mesma compra existir em dois provedores.
 */
export async function criarCheckoutCartao({ centavos, referencia, descricao, urlOk, urlCancelar, metadata }) {
  const s = await stripe('/checkout/sessions', {
    metodo: 'POST',
    corpo: {
      mode: 'payment',
      payment_method_types: { 0: 'card' },
      client_reference_id: referencia,
      success_url: urlOk,
      cancel_url: urlCancelar,
      line_items: {
        0: {
          quantity: 1,
          price_data: {
            currency: 'brl',
            unit_amount: centavos,
            product_data: { name: descricao },
          },
        },
      },
      metadata,
    },
  });
  if (!s.url) throw new Error('stripe não devolveu url de checkout');
  return { url: s.url, provedorRef: s.id };
}

/** Traduz uma sessão do Stripe para `Pago` — ou `null` se ainda não foi paga. */
function sessaoParaPago(s) {
  if (!s || s.payment_status !== 'paid') return null;
  const ref = seg(s.client_reference_id);
  const centavos = Number(s.amount_total ?? 0);
  if (!ref || centavos <= 0) return null;
  const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
  return {
    referencia: ref,
    centavos,
    moeda: String(s.currency ?? 'brl').toUpperCase(),
    comprovante: pi ?? s.id,
    // Nome de quem pagou — vai para `tomador_nome` na nota fiscal. O Stripe Checkout coleta o
    // nome do titular do cartão e o devolve em `customer_details.name`.
    nomePagador: seg(s.customer_details?.name) || undefined,
  };
}

export async function consultarCartao(sessaoId) {
  return sessaoParaPago(await stripe(`/checkout/sessions/${encodeURIComponent(sessaoId)}`));
}

/**
 * Nome e e-mail de quem pagou uma sessão de cartão — para preencher o tomador da nota fiscal
 * em compras ANTIGAS (antes da Fase 1). Diferente de `consultarCartao`, que devolve o `Pago`
 * (status/valor): aqui interessa a identificação, que o Stripe guarda em `customer_details`.
 * `null` se a sessão não existir.
 *
 * @returns {Promise<{nome?:string, email?:string, pago:boolean}|null>}
 */
export async function dadosPagadorCartao(sessaoId) {
  const s = await stripe(`/checkout/sessions/${encodeURIComponent(sessaoId)}`);
  if (!s?.id) return null;
  const cd = s.customer_details ?? {};
  return {
    nome: seg(cd.name) || undefined,
    email: seg(cd.email) || undefined,
    pago: s.payment_status === 'paid',
  };
}

/**
 * Confere a assinatura do webhook do Stripe e devolve o evento.
 *
 * O cabeçalho é `t=<carimbo>,v1=<hmac>`, e o que se assina é `<carimbo>.<corpo cru>` — por isso
 * o corpo tem de chegar aqui EXATAMENTE como veio na rede. Reserializar o JSON (mesmo sem
 * mudar nada) reordena chaves e muda espaços, e a assinatura deixa de bater.
 *
 * A janela de 5 minutos é contra replay: sem ela, um pedido capturado uma vez continua válido
 * para sempre, porque a assinatura dele não expira sozinha.
 */
export function verificarWebhookStripe(corpoCru, assinatura) {
  const segredo = seg(process.env.STRIPE_WEBHOOK_SECRET);
  if (!segredo) throw new Error('STRIPE_WEBHOOK_SECRET não configurado');
  if (!assinatura) throw new Error('assinatura ausente');

  const partes = Object.fromEntries(
    String(assinatura).split(',').map((p) => p.split('=', 2)).filter((p) => p.length === 2),
  );
  const t = partes.t;
  const v1 = partes.v1;
  if (!t || !v1) throw new Error('assinatura malformada');

  const idade = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(idade) || idade > 300) throw new Error('assinatura fora da janela');

  const esperado = createHmac('sha256', segredo).update(`${t}.${corpoCru}`).digest('hex');
  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  // `timingSafeEqual` exige o mesmo tamanho — comparar antes evita a exceção e já descarta
  // um `v1` de tamanho errado, que nunca poderia bater de qualquer forma.
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('assinatura inválida');

  return JSON.parse(corpoCru);
}

/** O `Pago` de um evento de webhook do Stripe, quando ele é de sessão concluída. */
export function pagoDeWebhookStripe(evento) {
  if (evento?.type !== 'checkout.session.completed') return null;
  return sessaoParaPago(evento.data?.object);
}

// --------------------------------------------------------------------- Efí
//
// A API Pix da Efí autentica diferente das outras duas: TODA requisição (inclusive a troca do
// token OAuth) precisa apresentar um certificado de cliente (mTLS) além do client_id/secret.
// É por isso que esta seção não usa `fetch()` como as de cima — o fetch nativo do Node não tem
// onde plugar um certificado de cliente — e fala `node:https` puro, com um `Agent` dedicado que
// carrega o `.p12` uma vez.
const EFI_HOST = 'pix.api.efipay.com.br';

let agenteEfi = null;

/** Carrega o certificado uma vez só. Erra alto (e cedo) se o caminho estiver errado. */
function agenteCertificadoEfi() {
  if (agenteEfi) return agenteEfi;
  const caminho = seg(process.env.EFI_CERTIFICADO);
  if (!caminho) throw new Error('efi não configurado (EFI_CERTIFICADO)');
  agenteEfi = new Agent({
    pfx: readFileSync(caminho),
    passphrase: seg(process.env.EFI_CERTIFICADO_SENHA) || undefined,
    keepAlive: true,
  });
  return agenteEfi;
}

/** POST/GET/PUT cru contra a API da Efí, com o certificado mTLS na conexão. */
function requisicaoEfi(caminho, { metodo = 'GET', corpo, headers = {} } = {}) {
  return new Promise((resolvida, rejeitada) => {
    let agente;
    try {
      agente = agenteCertificadoEfi();
    } catch (err) {
      return rejeitada(err);
    }
    const dados = corpo ? JSON.stringify(corpo) : undefined;
    const req = httpsRequest({
      hostname: EFI_HOST,
      path: caminho,
      method: metodo,
      agent: agente,
      headers: {
        'content-type': 'application/json',
        ...(dados ? { 'content-length': Buffer.byteLength(dados) } : {}),
        ...headers,
      },
    }, (r) => {
      let bruto = '';
      r.on('data', (c) => { bruto += c; });
      r.on('end', () => {
        let corpoResp;
        try { corpoResp = bruto ? JSON.parse(bruto) : {}; } catch { corpoResp = {}; }
        if (r.statusCode >= 200 && r.statusCode < 300) return resolvida(corpoResp);
        // Quando o erro não tem o formato de JSON da Efí (`mensagem`/`nome`), é sinal de que a
        // resposta nem chegou a ser deles — página de WAF/CDN, por exemplo. Mostrar um pedaço do
        // corpo cru é o que diferencia "a Efí recusou por X" de "nem chegou na Efí".
        const detalhe = corpoResp?.mensagem ?? corpoResp?.nome ?? bruto.slice(0, 300) ?? 'erro';
        const e = new Error(`efi ${caminho} ${r.statusCode}: ${detalhe}`);
        e.status = r.statusCode;
        rejeitada(e);
      });
    });
    req.on('error', rejeitada);
    if (dados) req.write(dados);
    req.end();
  });
}

let tokenCacheEfi = null;

async function tokenEfi() {
  const agora = Date.now();
  // Renova um minuto antes de vencer: um token que expira no voo derruba a compra de alguém.
  if (tokenCacheEfi && agora < tokenCacheEfi.expiraEm - 60_000) return tokenCacheEfi.token;

  const id = seg(process.env.EFI_CLIENT_ID);
  const segredo = seg(process.env.EFI_CLIENT_SECRET);
  if (!id || !segredo) throw new Error('efi não configurado');

  const basic = Buffer.from(`${id}:${segredo}`).toString('base64');
  const j = await requisicaoEfi('/oauth/token', {
    metodo: 'POST',
    corpo: { grant_type: 'client_credentials' },
    headers: { authorization: `Basic ${basic}` },
  });
  tokenCacheEfi = { token: j.access_token, expiraEm: agora + Number(j.expires_in) * 1000 };
  return tokenCacheEfi.token;
}

async function efi(caminho, { metodo = 'GET', corpo, headers = {} } = {}) {
  const token = await tokenEfi();
  return requisicaoEfi(caminho, { metodo, corpo, headers: { authorization: `Bearer ${token}`, ...headers } });
}

/**
 * Abre a cobrança PIX na Efí e devolve o material para a TELA desenhar.
 *
 * Diferença central para o LivePix: a Efí não hospeda página de pagamento nenhuma. O que ela
 * devolve é o "copia e cola" (`qrcode`) e a imagem do QR code (`imagemQrcode`, já em
 * `data:image/png;base64,…`) — quem chama é que precisa mostrar isso dentro do próprio jogo, em
 * vez de abrir uma aba nova.
 *
 * Também é a NOSSA referência que vira o identificador da cobrança (`txid`, via
 * `PUT /v2/cob/:txid`) — ao contrário do LivePix, que gerava a dele e não aceitava a nossa. É
 * por isso que `referencia` entra aqui já pronta, do mesmo jeito que no caminho do cartão.
 * `novaReferencia()` (um UUID sem hífen, 32 caracteres) cai dentro da faixa de 26–35 caracteres
 * alfanuméricos que a Efí exige para o txid.
 */
export async function criarCobrancaPix({ centavos, referencia, descricao, expiracaoSegundos }) {
  const chave = seg(process.env.EFI_CHAVE_PIX);
  if (!chave) throw new Error('efi não configurado (EFI_CHAVE_PIX)');

  const cob = await efi(`/v2/cob/${encodeURIComponent(referencia)}`, {
    metodo: 'PUT',
    corpo: {
      calendario: { expiracao: expiracaoSegundos },
      valor: { original: (centavos / 100).toFixed(2) },
      chave,
      solicitacaoPagador: descricao,
    },
  });
  const locId = cob?.loc?.id;
  if (!locId) throw new Error('efi não devolveu loc.id da cobrança');

  const qr = await efi(`/v2/loc/${locId}/qrcode`);
  if (!qr?.qrcode) throw new Error('efi não devolveu o qrcode');
  return { referencia, qrcode: qr.qrcode, imagemQrcode: qr.imagemQrcode };
}

/** A Efí só considera pago quando `status` fecha e existe pelo menos uma liquidação em `pix`. */
function efiParaPago(d) {
  if (d?.status !== 'CONCLUIDA') return null;
  const p = Array.isArray(d.pix) ? d.pix[0] : null;
  if (!p?.endToEndId) return null;
  return {
    referencia: d.txid,
    centavos: Math.round(Number(p.valor ?? d.valor?.original ?? 0) * 100),
    moeda: 'BRL',
    comprovante: p.endToEndId,
    // Nome de quem pagou. Na Efí ele vem em `gnExtras.pagador.nome` — presente no CORPO do
    // webhook; a consulta `GET /v2/cob/:txid` nem sempre traz. A rota do webhook repassa o
    // nome do corpo quando existe (ver `diamantes-rotas.mjs`); aqui só aproveitamos se vier.
    nomePagador: seg(p.gnExtras?.pagador?.nome) || undefined,
  };
}

const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Consulta a cobrança na Efí pelo txid (que é a NOSSA referência), com retry em 5xx.
 *
 * Ao contrário do LivePix, não existe consulta "por listagem" — o txid é escolhido por nós na
 * criação, então é sempre uma busca direta por chave.
 */
export async function consultarPix(referencia, { tentativas = 4 } = {}) {
  let ultimo;
  for (let i = 0; i < tentativas; i++) {
    try {
      return efiParaPago(await efi(`/v2/cob/${encodeURIComponent(referencia)}`));
    } catch (err) {
      ultimo = err;
      if (Number(err.status) === 404) return null; // cobrança nunca chegou a existir na Efí
      if (Number(err.status) >= 500 && i < tentativas - 1) {
        await dormir(400 * (i + 1));
        continue;
      }
      throw err;
    }
  }
  throw ultimo;
}

/**
 * Nome (e CPF, quando a Efí devolve sem máscara) de quem pagou um PIX — para o tomador da nota
 * fiscal de compras ANTIGAS. Tenta primeiro a consulta do Pix recebido pelo `endToEndId`
 * (`GET /v2/pix/:e2eid`), que traz `pagador.nome` e costuma trazer o CPF completo, mas exige o
 * escopo `pix.read` nas credenciais da Efí; se ele não estiver liberado (403), cai para o
 * `gnExtras` da cobrança (só o nome, e nem sempre presente).
 *
 * `scopeNegado: true` no retorno sinaliza que o `pix.read` está faltando — útil para o lote
 * avisar uma vez em vez de a cada linha.
 *
 * @param {{e2eid?:string, txid?:string}} chaves
 * @returns {Promise<{nome?:string, cpf?:string, fonte:'pix'|'cob', scopeNegado?:boolean}|null>}
 */
export async function dadosPagadorPix({ e2eid, txid } = {}) {
  let scopeNegado = false;

  if (e2eid) {
    try {
      const p = await efi(`/v2/pix/${encodeURIComponent(e2eid)}`);
      const pg = p?.pagador ?? {};
      const cpf = String(pg.cpf ?? '').replace(/\D/g, '');
      if (seg(pg.nome) || cpf.length === 11) {
        return { nome: seg(pg.nome) || undefined, cpf: cpf.length === 11 ? cpf : undefined, fonte: 'pix' };
      }
    } catch (err) {
      if (Number(err.status) === 403) scopeNegado = true;       // sem `pix.read` — tenta o fallback
      else if (Number(err.status) !== 404) throw err;
    }
  }

  if (txid) {
    try {
      const d = await efi(`/v2/cob/${encodeURIComponent(txid)}`);
      const pg = (Array.isArray(d?.pix) ? d.pix[0] : null)?.gnExtras?.pagador ?? {};
      if (seg(pg.nome)) return { nome: seg(pg.nome), fonte: 'cob', scopeNegado };
    } catch (err) {
      if (Number(err.status) !== 404) throw err;
    }
  }

  return scopeNegado ? { fonte: 'pix', scopeNegado: true } : null;
}

/**
 * Confere o segredo no caminho do webhook da Efí. Só isso — de propósito.
 *
 * A Efí não assina o corpo com HMAC nenhum, e o único identificador que ele carrega (`chave`, a
 * chave Pix) é informação pública — não prova origem nenhuma. Por isso o SEGREDO NO CAMINHO é a
 * ÚNICA barreira aqui, e é OBRIGATÓRIO (ver `pixAtivo`), diferente do LivePix, que tinha o
 * `clientId` do corpo como primeira linha de defesa e podia deixar o segredo opcional.
 *
 * O FORMATO do corpo não entra nesta checagem — e isso não é frouxidão, é necessário: antes de
 * aceitar o cadastro (`PUT /v2/webhook/:chave`), a própria Efí sonda a URL com um POST de corpo
 * vazio e espera 2xx de volta. Exigir `pix[].txid` aqui faria essa sonda tomar 403 e o cadastro
 * do webhook nunca ser aceito. Aceitar um corpo vazio não abre brecha nenhuma: sem `txid` não há
 * o que consultar (ver a rota em `diamantes-rotas.mjs`), e o valor pago NUNCA sai do corpo de
 * qualquer forma — quem credita é sempre `consultarPix`, reconsultando `/v2/cob/:txid` com o
 * certificado mTLS. Mesmo que alguém adivinhasse o segredo e forjasse um corpo de "pago", a
 * cobrança forjada continuaria `ATIVA` na consulta de verdade, e nada seria creditado.
 */
export function segredoWebhookEfiValido(segredoCaminho) {
  const esperado = seg(process.env.EFI_WEBHOOK_SEGREDO);
  return !!esperado && segredoCaminho === esperado;
}

/**
 * Cadastra a URL de notificação na Efí. Não roda no boot do servidor — é passo de SETUP, feito
 * uma vez (ou de novo se `URL_PUBLICA` mudar) por `tools/efi-configurar-webhook.mjs`.
 *
 * O `?ignorar=` no fim da URL existe porque, sem ele, a Efí acrescenta `/pix` sozinha no
 * endereço que ela chama de verdade — o que faria a notificação bater numa rota que a gente
 * não está escutando.
 *
 * Antes de aceitar o cadastro, a Efí sonda a própria URL com um POST e espera 2xx de volta. É
 * por isso que `segredoWebhookEfiValido` (acima) não exige `pix[].txid` no corpo — essa sonda
 * nunca vai ter um.
 *
 * `x-skip-mtls-checking: true` — por padrão a Efí exige mTLS também na NOSSA ponta (um
 * certificado dela sendo validado pelo nosso servidor ao receber a chamada). A gente optou pelo
 * outro modelo que a própria Efí sanciona: segredo na URL + reconsulta sempre à API antes de
 * creditar (`segredoWebhookEfiValido` + `consultarPix`). Sem este cabeçalho, o cadastro é
 * recusado com "autenticação de TLS mútuo não está configurada na URL informada".
 */
export async function configurarWebhookPix(url) {
  const chave = seg(process.env.EFI_CHAVE_PIX);
  if (!chave) throw new Error('efi não configurado (EFI_CHAVE_PIX)');
  return efi(`/v2/webhook/${encodeURIComponent(chave)}`, {
    metodo: 'PUT',
    corpo: { webhookUrl: `${url}?ignorar=` },
    headers: { 'x-skip-mtls-checking': 'true' },
  });
}

/** O que está cadastrado agora — só para o script de setup confirmar. */
export async function statusWebhookPix() {
  const chave = seg(process.env.EFI_CHAVE_PIX);
  if (!chave) throw new Error('efi não configurado (EFI_CHAVE_PIX)');
  return efi(`/v2/webhook/${encodeURIComponent(chave)}`);
}
