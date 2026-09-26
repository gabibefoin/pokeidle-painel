// As rotas HTTP da compra de DIAMANTES, penduradas no mesmo servidor que serve o cliente.
//
// Por que HTTP e não WebSocket, como o resto do jogo: um pagamento sai da aba (cartão) ou fica
// numa tela de QR code dentro dela (Pix), e o provedor volta a falar conosco por WEBHOOK — que é
// uma requisição HTTP de um servidor de fora, sem socket nenhum. Não há como esse caminho ser
// WebSocket.
//
//   POST /diamantes/comprar      { qtd, metodo }  → { url } ou { qrcode, imagemQrcode }
//   GET  /diamantes/precos                        → a vitrine (público)
//   POST /webhooks/stripe                         → o Stripe confirmando
//   POST /webhooks/efi/:segredo                   → a Efí confirmando
//
// ### O crédito não confia no corpo do webhook
//
// Em ambos os casos o valor pago é reconferido — no Stripe pela assinatura HMAC do corpo cru,
// na Efí por uma consulta de volta à API deles (autenticada com o certificado mTLS). Creditar a
// partir do que o corpo diz seria entregar diamante para quem souber o formato do JSON.
import { lerSessao, contaPorId, URL_PUBLICA } from './auth.mjs';
import { pool } from './db.mjs';
import * as ddb from './diamantes-db.mjs';
import * as adb from './afiliados-db.mjs';
import { ipCliente } from './ip-cliente.mjs';
import {
  ErroDiamantes, METODOS, painelDeCompra, precoEmCentavos, novaReferencia, emReais, VALIDADE_MS,
  cpfValido,
} from './game/diamantes.mjs';
import {
  cartaoAtivo, pixAtivo, pagamentosAtivos,
  criarCheckoutCartao, consultarCartao, verificarWebhookStripe, pagoDeWebhookStripe,
  criarCobrancaPix, consultarPix, segredoWebhookEfiValido,
} from './pagamentos.mjs';

const json = (res, codigo, corpo) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
};

/**
 * Lê o corpo CRU.
 *
 * Cru, e não `JSON.parse`, porque a assinatura do Stripe é sobre os bytes exatos que vieram na
 * rede: reserializar o objeto (mesmo sem mudar valor nenhum) reordena chaves e muda espaços, e
 * a conferência passa a falhar sempre. Quem precisa do objeto dá o parse depois.
 */
function lerCru(req, limite = 64 * 1024) {
  return new Promise((ok, err) => {
    let dados = '';
    req.on('data', (p) => {
      dados += p;
      if (dados.length > limite) {
        req.destroy();
        err(new Error('corpo grande demais'));
      }
    });
    req.on('end', () => ok(dados));
    req.on('error', err);
  });
}

/** O IP do jogador. A regra de confianca mora em `ip-cliente.mjs` - leia la antes de mexer. */
const ipDe = (req) => ipCliente(req);

// ------------------------------------------------------------- rate limit
//
// Dois baldes com propósitos diferentes. O de COMPRA protege o provedor: cada tentativa cria
// uma cobrança de verdade lá fora, e um laço criaria centenas de cobranças órfãs em nome do
// jogador. O de WEBHOOK protege a nós: cada um pode virar uma consulta à API do provedor.

const baldes = new Map();

function estourou(chave, limite, janelaMs) {
  const agora = Date.now();
  const b = baldes.get(chave);
  if (!b || agora > b.zeraEm) {
    baldes.set(chave, { n: 1, zeraEm: agora + janelaMs });
    return false;
  }
  b.n += 1;
  return b.n > limite;
}

// Sem isto o Map cresce com um balde por IP para sempre.
setInterval(() => {
  const agora = Date.now();
  for (const [k, b] of baldes) if (agora > b.zeraEm) baldes.delete(k);
}, 60_000).unref();

// ------------------------------------------------------------------ sessão

/**
 * O jogador dono da sessão, ou `null`.
 *
 * Resolve pela CONTA (`contaId`, campo assinado do token), NUNCA pelo `nick` de dentro do
 * token. O nick é um retrato do momento em que o token foi emitido: quem terminou o onboarding
 * depois (Google/Discord escolhem o nick num segundo passo) ou trocou de nome fica com um token
 * cujo `nick` não bate mais com `players.nick` — e aí uma consulta por nick devolvia 401 (ou,
 * pior, se aquele nick antigo tiver sido pego por outra pessoa, apontava para a conta ERRADA e
 * o pagamento ia parar no jogador errado). É o mesmo caminho que o `hello` do gateway já usa:
 * `contaId` → conta no banco → nick ATUAL → `players`. Ver `admin-rotas.mjs` / `afiliados-rotas.mjs`.
 */
async function jogadorDaSessao(req, url) {
  const token = url.searchParams.get('sessao')
    ?? (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);
  const s = await lerSessao(token);
  if (!s?.contaId || s.provedor === 'guest') return null;

  const conta = await contaPorId(s.contaId);
  // `nick_ok === false` = conta de provedor/e-mail que ainda não escolheu o nick definitivo.
  // Não há `players` para ela ainda, e comprar diamante antes de terminar o cadastro não faz
  // sentido — recusa limpo em vez de cair no lookup vazio.
  if (!conta || conta.nick_ok === false) return null;

  const { rows } = await pool.query(
    `SELECT id, nick FROM players WHERE lower(nick) = lower($1)`,
    [conta.nick],
  );
  // `email` sai junto: é o e-mail do tomador na nota fiscal (o jogador não redigita, vem da
  // conta em que ele está logado). Ver `/diamantes/comprar`.
  return rows[0] ? { id: Number(rows[0].id), nick: rows[0].nick, email: conta.email ?? null } : null;
}

// ---------------------------------------------------------------- crédito

/**
 * Confirma um pagamento e credita, seja de onde vier o gatilho.
 *
 * Ponto único de propósito: webhook e reconciliação chegam por caminhos diferentes e não podem
 * divergir numa regra tão cara. A idempotência é do banco (`confirmarPagamento` só age na
 * transição pendente → pago), então chamar isto duas vezes com o mesmo pagamento é inofensivo.
 */
async function creditar(pago) {
  if (!pago) return false;
  if (pago.moeda !== 'BRL') {
    console.warn('[diamantes] pagamento em moeda inesperada:', pago.moeda);
    return false;
  }
  try {
    const r = await ddb.confirmarPagamento({
      referencia: pago.referencia,
      centavosRecebidos: pago.centavos,
      comprovante: pago.comprovante,
      // Nome de quem pagou, para a nota fiscal. Stripe: `customer_details.name`. Efí: vem do
      // corpo do webhook (`gnExtras.pagador.nome`), repassado pela rota abaixo.
      nomePagador: pago.nomePagador,
    });
    if (r.creditado) {
      console.log(
        `[diamantes] +${r.pagamento.qtd} para ${r.pagamento.nick} ` +
        `(${emReais(r.pagamento.centavos)} via ${r.pagamento.provedor})`,
      );
      adb.comissaoDiamante(r.pagamento.playerId, r.pagamento.qtd, pago.referencia)
        .then((c) => {
          if (c.creditado) {
            console.log(`[afiliados] +${c.qtd} diamantes de comissão (pagamento ${pago.referencia})`);
          }
        })
        .catch((err) => console.error('[afiliados] comissão diamante:', err.message));
    }
    return r.creditado;
  } catch (err) {
    console.error('[diamantes] falha ao creditar:', err.message);
    return false;
  }
}

/**
 * Pergunta ao provedor se os pendentes já foram pagos.
 *
 * É a rede de segurança do webhook: se ele se perder (deploy no meio, DNS, 500 nosso), o
 * jogador que pagou fica sem os diamantes e sem nada a fazer. Rodando de minuto em minuto, o
 * pior caso vira um minuto de espera em vez de um ticket de suporte.
 */
export async function reconciliarPendentes() {
  if (!pagamentosAtivos()) return;
  let pendentes;
  try {
    pendentes = await ddb.pendentesParaReconciliar();
  } catch (err) {
    return console.error('[diamantes] reconciliação não leu os pendentes:', err.message);
  }

  for (const p of pendentes) {
    try {
      const pago = p.provedor === 'stripe'
        ? p.provedorRef && cartaoAtivo() ? await consultarCartao(p.provedorRef) : null
        : p.provedor === 'efi' && pixAtivo() ? await consultarPix(p.referencia) : null;
      if (pago) await creditar(pago);
    } catch (err) {
      // Um pendente que estoura não pode parar os outros — provedor fora do ar derrubaria a
      // fila inteira, e a próxima passagem tenta de novo de qualquer forma.
      console.error(`[diamantes] reconciliar ${p.referencia}:`, err.message);
    }
  }
}

// ------------------------------------------------------------------ rotas

export async function rotasDeDiamantes(req, res, url) {
  const rota = url.pathname;
  if (!rota.startsWith('/diamantes/') && !rota.startsWith('/webhooks/')) return false;

  // ---- a vitrine: preços, pacotes e quais métodos existem
  if (rota === '/diamantes/precos' && req.method === 'GET') {
    json(res, 200, painelDeCompra({ pixAtivo: pixAtivo(), cartaoAtivo: cartaoAtivo() }));
    return true;
  }

  // ---- iniciar a compra
  if (rota === '/diamantes/comprar' && req.method === 'POST') {
    if (!pagamentosAtivos()) return json(res, 503, { erro: 'diamantes.indisponivel' }), true;
    if (estourou(`compra:${ipDe(req)}`, 10, 60_000)) {
      return json(res, 429, { erro: 'diamantes.muitasTentativas' }), true;
    }

    let corpo;
    try {
      corpo = JSON.parse((await lerCru(req, 4096)) || '{}');
    } catch {
      return json(res, 400, { erro: 'diamantes.jsonInvalido' }), true;
    }

    const jogador = await jogadorDaSessao(req, url);
    if (!jogador) return json(res, 401, { erro: 'diamantes.semSessao' }), true;

    // O ACEITE é obrigatório e conferido AQUI, não só na tela — um checkbox que existe apenas no navegador
    // não prova nada numa disputa de estorno, que é exatamente o cenário para o qual ele
    // existe. `registrarPendente` grava o carimbo ao lado do pagamento.
    if (corpo.aceite !== true) return json(res, 400, { erro: 'diamantes.precisaAceite' }), true;

    const metodo = String(corpo.metodo ?? '');
    if (!METODOS.includes(metodo)) return json(res, 400, { erro: 'diamantes.metodoInvalido' }), true;
    if (metodo === 'pix' && !pixAtivo()) return json(res, 503, { erro: 'diamantes.pixIndisponivel' }), true;
    if (metodo === 'cartao' && !cartaoAtivo()) {
      return json(res, 503, { erro: 'diamantes.cartaoIndisponivel' }), true;
    }

    // CPF do tomador da nota fiscal — SÓ no PIX. No cartão o pagador costuma ser estrangeiro
    // (sem CPF) e o nome vem do Stripe; exigir CPF aqui trancaria essas compras. Digitado pelo
    // jogador (nem Stripe nem Efí devolvem o CPF em claro) e validado aqui — dígitos
    // verificadores inclusive — antes de abrir a cobrança.
    let tomadorCpf = null;
    if (metodo === 'pix') {
      try {
        tomadorCpf = cpfValido(corpo.cpf);
      } catch (err) {
        return json(res, 400, { erro: err instanceof ErroDiamantes ? err.chave : 'diamantes.cpfInvalido' }), true;
      }
    }

    try {
      const qtd = Number(corpo.qtd);
      // O preço é calculado AQUI, do zero. O cliente manda a quantidade e mais nada — se ele
      // mandasse o valor, mandaria um centavo.
      const centavos = precoEmCentavos(qtd);
      const descricao = `${qtd} Diamantes — PokeIdle`;
      const metadata = { jogador: jogador.nick, playerId: String(jogador.id), qtd: String(qtd) };

      let url_ = null, qrcode = null, imagemQrcode = null, referencia, provedorRef = null, provedor;
      if (metodo === 'cartao') {
        provedor = 'stripe';
        referencia = novaReferencia();
        const c = await criarCheckoutCartao({
          centavos,
          referencia,
          descricao,
          urlOk: `${URL_PUBLICA}/?diamantes=ok`,
          urlCancelar: `${URL_PUBLICA}/?diamantes=cancelado`,
          metadata,
        });
        url_ = c.url;
        provedorRef = c.provedorRef;
      } else {
        provedor = 'efi';
        referencia = novaReferencia();
        // Ao contrário do Stripe (aba nova), a Efí não hospeda página nenhuma: a tela desenha
        // o QR code e o "copia e cola" ela mesma, com o que vem de volta aqui.
        const c = await criarCobrancaPix({
          centavos, referencia, descricao, expiracaoSegundos: Math.floor(VALIDADE_MS / 1000),
        });
        qrcode = c.qrcode;
        imagemQrcode = c.imagemQrcode;
      }

      await ddb.registrarPendente({
        referencia, playerId: jogador.id, nick: jogador.nick,
        qtd, centavos, metodo, provedor, provedorRef,
        tomadorCpf, tomadorEmail: jogador.email,
      });
      json(res, 200, { url: url_, qrcode, imagemQrcode, referencia, qtd, centavos });
    } catch (err) {
      if (err instanceof ErroDiamantes) return json(res, 400, { erro: err.chave }), true;
      console.error('[diamantes] compra falhou:', err.message);
      json(res, 502, { erro: 'diamantes.falhou' });
    }
    return true;
  }

  // ---- verificar PIX pendente do jogador (botão "Já paguei" / poll da loja)
  if (rota === '/diamantes/verificar' && req.method === 'POST') {
    if (estourou(`verif:${ipDe(req)}`, 30, 60_000)) {
      return json(res, 429, { erro: 'diamantes.muitasTentativas' }), true;
    }
    const jogador = await jogadorDaSessao(req, url);
    if (!jogador) return json(res, 401, { erro: 'diamantes.semSessao' }), true;

    const pend = await ddb.pendenteDoJogador(jogador.id);
    if (!pend) return json(res, 200, { ok: true, status: 'nenhum' }), true;

    try {
      let pago = null;
      if (pend.provedor === 'stripe' && pend.provedorRef && cartaoAtivo()) {
        pago = await consultarCartao(pend.provedorRef);
      } else if (pend.provedor === 'efi' && pixAtivo()) {
        pago = await consultarPix(pend.referencia);
      }
      if (!pago) return json(res, 200, { ok: true, status: 'aguardando', referencia: pend.referencia }), true;
      const creditado = await creditar(pago);
      return json(res, 200, {
        ok: true,
        status: creditado ? 'creditado' : 'ja_pago',
        qtd: pend.qtd,
        referencia: pend.referencia,
      }), true;
    } catch (err) {
      console.error(`[diamantes] verificar ${pend.referencia}:`, err.message);
      return json(res, 502, { erro: 'diamantes.verificarFalhou' }), true;
    }
  }

  // ---- webhook do Stripe
  if (rota === '/webhooks/stripe' && req.method === 'POST') {
    if (estourou(`wh:${ipDe(req)}`, 120, 60_000)) return json(res, 429, { ok: false }), true;
    const cru = await lerCru(req).catch(() => null);
    if (cru == null) return json(res, 400, { ok: false }), true;

    let evento;
    try {
      evento = verificarWebhookStripe(cru, req.headers['stripe-signature']);
    } catch (err) {
      console.error('[webhook/stripe] rejeitado:', err.message);
      return json(res, 400, { erro: 'assinatura' }), true;
    }
    // Responde 200 mesmo quando o evento não interessa: qualquer outra coisa faz o Stripe
    // reenviar em laço um evento que nunca vai virar nada.
    await creditar(pagoDeWebhookStripe(evento));
    json(res, 200, { ok: true });
    return true;
  }

  // ---- webhook da Efí (o segredo vem no caminho, e é OBRIGATÓRIO — ver validarWebhookEfi)
  if (rota.startsWith('/webhooks/efi') && req.method === 'POST') {
    if (!pixAtivo()) return json(res, 200, { ok: true }), true;
    if (estourou(`wh:${ipDe(req)}`, 120, 60_000)) return json(res, 429, { ok: false }), true;

    let corpo;
    try {
      corpo = JSON.parse((await lerCru(req, 16 * 1024)) || '{}');
    } catch {
      return json(res, 400, { ok: false }), true;
    }

    const segredoCaminho = rota.slice('/webhooks/efi/'.length) || undefined;

    if (!segredoWebhookEfiValido(segredoCaminho)) {
      console.warn('[webhook/efi] segredo inválido ou ausente');
      return json(res, 403, { ok: false }), true;
    }

    // Sem `txid` não há o que consultar. Isto NÃO é um evento hostil: é a própria Efí sondando
    // a URL com corpo vazio antes de aceitar o cadastro do webhook (`configurarWebhookPix`), ou
    // um tipo de notificação que não interessa. 200 aqui é o que faz o CADASTRO ser aceito —
    // 403/4xx faria a Efí achar que a URL não está no ar.
    const txid = corpo?.pix?.[0]?.txid;
    if (!txid) return json(res, 200, { ok: true }), true;

    try {
      console.log(`[webhook/efi] evento txid=${txid}`);
      // O corpo é só o GATILHO para o VALOR (que vem da consulta autenticada). Mas o NOME de
      // quem pagou só existe no corpo do webhook (`gnExtras.pagador.nome`) — a consulta não
      // traz. Então esse a gente lê daqui e cola no `pago` antes de creditar.
      const nomePagador = corpo?.pix?.[0]?.gnExtras?.pagador?.nome;
      const pago = await consultarPix(txid);
      if (pago) {
        if (nomePagador && !pago.nomePagador) pago.nomePagador = nomePagador;
        await creditar(pago);
      } else console.warn(`[webhook/efi] ainda não CONCLUIDA txid=${txid}`);
    } catch (err) {
      console.error('[webhook/efi]', err.message);
    }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
