// As rotas HTTP do Vote & Ganhe.
//
//   POST /topidle/me         → o painel do jogador (precisa de sessão)
//   POST /webhooks/topidle   → o TopIdle avisando de um voto
//
// ### Por que HTTP e não WebSocket
//
// Mesmo motivo do webhook de pagamento: o voto acontece FORA da nossa aba. O jogador sai para
// o topidle.com, autoriza lá, e quem volta a falar conosco é o servidor deles — que não tem
// socket nenhum e nem sabe que o jogador está online.
//
// ### A assinatura é conferida sobre os bytes CRUS
//
// `X-TopIdle-Signature` é o HMAC SHA-256 de `X-TopIdle-Timestamp + "." + corpo_bruto`. Reler o
// corpo com `JSON.parse` e reserializar reordena chaves e mexe em espaços — a conferência
// passaria a falhar sempre. Por isso o corpo é lido como texto e só é parseado DEPOIS de a
// assinatura fechar.
//
// Sem `TOPIDLE_WEBHOOK_SECRET` no ambiente o webhook é RECUSADO, e não ignorado: um endpoint
// que aceita qualquer POST enquanto o segredo não está configurado é uma torneira de diamante
// aberta para quem descobrir a URL.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { lerSessao, contaPorId } from './auth.mjs';
import { pool } from './db.mjs';
import * as tdb from './topidle-db.mjs';
import { ipCliente } from './ip-cliente.mjs';
import {
  JOGO_ID_PADRAO, TOLERANCIA_S, normalizarEvento, urlDeVoto,
} from './game/topidle.mjs';

const json = (res, codigo, corpo) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
};

export const JOGO_ID = process.env.TOPIDLE_JOGO_ID || JOGO_ID_PADRAO;
const SEGREDO = process.env.TOPIDLE_WEBHOOK_SECRET || '';
const CHAVE_API = process.env.TOPIDLE_API_KEY || '';
const API_BASE = (process.env.TOPIDLE_API_URL || 'https://topidle.com').replace(/\/+$/, '');

/** O webhook só existe se o segredo existir. A tela usa isto para não prometer o que não paga. */
export const votoAtivo = () => Boolean(SEGREDO);

// ------------------------------------------------------------------ corpo cru

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
setInterval(() => {
  const agora = Date.now();
  for (const [k, b] of baldes) if (agora > b.zeraEm) baldes.delete(k);
}, 60_000).unref();

// ------------------------------------------------------------------ assinatura

/**
 * Compara duas assinaturas em tempo constante.
 *
 * `===` em string vaza o tamanho do prefixo igual pelo tempo de resposta, e é assim que se
 * descobre um HMAC byte a byte. `timingSafeEqual` exige buffers do mesmo tamanho — daí a
 * checagem de comprimento antes, que é pública de qualquer jeito.
 */
function igualSeguro(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/**
 * Confere `X-TopIdle-Signature` e devolve o corpo já parseado, ou lança.
 *
 * O carimbo entra no HMAC, então recusar o que estiver fora da tolerância fecha a porta do
 * replay sem precisar guardar assinatura nenhuma. Ele vem em segundos na especificação, mas
 * aceitar milissegundos também custa uma linha e evita um dia inteiro de depuração se eles
 * mudarem de unidade.
 */
export function verificarAssinatura(cru, cabecalhos) {
  if (!SEGREDO) throw new Error('TOPIDLE_WEBHOOK_SECRET não configurado');

  const assinatura = String(cabecalhos['x-topidle-signature'] ?? '').replace(/^sha256=/i, '').trim();
  const carimbo = String(cabecalhos['x-topidle-timestamp'] ?? '').trim();
  if (!assinatura || !carimbo) throw new Error('faltou assinatura ou carimbo');

  const n = Number(carimbo);
  if (!Number.isFinite(n)) throw new Error('carimbo inválido');
  const carimboMs = n > 1e11 ? n : n * 1000;
  if (Math.abs(Date.now() - carimboMs) > TOLERANCIA_S * 1000) throw new Error('carimbo vencido');

  const esperado = createHmac('sha256', SEGREDO).update(`${carimbo}.${cru}`).digest('hex');
  if (!igualSeguro(esperado, assinatura.toLowerCase())) throw new Error('assinatura não confere');

  return JSON.parse(cru || '{}');
}

// ------------------------------------------------------------------ processar

/**
 * Um evento (ou vários) do corpo de um webhook.
 *
 * O TopIdle manda um evento por POST, mas a API de recuperação devolve lista — e o "Enviar
 * teste" do painel deles pode vir em qualquer um dos dois formatos. Aceitar os três não custa
 * nada e evita um webhook recusado por causa do envelope.
 */
function eventosDoCorpo(corpo) {
  const bruto = Array.isArray(corpo) ? corpo
    : Array.isArray(corpo?.events) ? corpo.events
      : Array.isArray(corpo?.votes) ? corpo.votes
        : Array.isArray(corpo?.data) ? corpo.data
          : [corpo?.event ?? corpo?.vote ?? corpo];
  return bruto.map(normalizarEvento).filter(Boolean);
}

/** Trava do aviso de `sem_votante` — ver o uso, logo abaixo. */
let avisouSemVotante = false;

/** Registra os eventos e conta o que virou diamante. Nunca lança por causa de um evento só. */
async function processar(eventos, origem) {
  let creditados = 0;
  for (const ev of eventos) {
    const quem = ev.identificador || ev.email;
    try {
      const r = await tdb.registrarVoto(ev);
      if (r.creditado) {
        creditados += 1;
        console.log(`[topidle] +${r.qtd} diamante · ${r.contados} votos de ${quem} (${origem})`);
      } else if (r.contou) {
        console.log(`[topidle] voto de ${quem} contou (${r.contados}) — falta fechar o par`);
      } else if (r.novo) {
        // `muitos_votantes` e `votante_de_outro` são o alarme de multi-conta: é a fazenda de
        // contas do TopIdle batendo na trava. Vale um aviso, e não uma linha comum de log.
        const alarme = r.motivoZero === 'muitos_votantes' || r.motivoZero === 'votante_de_outro';
        const linha = `[topidle] voto sem crédito (${r.motivoZero}) · ${quem}`;
        if (alarme) console.warn(`${linha} — possível multi-conta`);
        else console.log(linha);
      }
      // Sem identidade do votante o vínculo não roda, e a trava que sobra é a RECARGA. Junto
      // vão os NOMES dos campos que vieram — não os valores. É o que responde, olhando o log
      // uma vez, se eles passaram a mandar alguma identidade com outro nome (e aí basta
      // acrescentá-lo em `chaveVotante`). Só as chaves porque o payload pode carregar e-mail
      // de terceiro, e isso não tem por que virar linha de log.
      //
      // UMA vez por processo: medido em produção, o TopIdle não manda identidade nenhuma
      // quando o campo de identificador está preenchido, então isto vale para TODO voto, e um
      // aviso por voto viraria ruído escondendo os avisos de verdade.
      if (r.motivoZero === 'sem_votante' && !avisouSemVotante) {
        avisouSemVotante = true;
        console.warn(
          `[topidle] evento ${ev.eventId} sem identidade de votante — vínculo de conta DESLIGADO` +
          ` · campos recebidos: ${Object.keys(ev.bruto ?? {}).join(', ') || '(nenhum)'}` +
          ' · quem segura a emissão aqui é a recarga por jogador (RECARGA_MS)',
        );
      }
    } catch (err) {
      // Um evento que estoura não pode derrubar os outros do mesmo lote — e o TopIdle vai
      // reenviar (ou a recuperação vai reler) o que ficou para trás.
      console.error(`[topidle] evento ${ev.eventId}:`, err.message);
    }
  }
  return creditados;
}

// ------------------------------------------------------------------ recuperação
//
// A rede de segurança do webhook, igual à `reconciliarPendentes` dos diamantes: se o POST se
// perder (deploy no meio, DNS, 500 nosso), o jogador que votou fica sem o diamante e sem nada
// a fazer. Aqui perguntamos de volta a partir do último cursor.

export async function recuperarVotos() {
  if (!CHAVE_API) return;
  let cursor;
  try {
    cursor = await tdb.lerCursor();
  } catch (err) {
    return console.error('[topidle] não deu para ler o cursor:', err.message);
  }

  // ESVAZIA a fila, em vez de uma página por passagem.
  //
  // A página deles é PEQUENA — medido em produção, `after=0` voltou com UM evento. Com uma
  // página a cada cinco minutos, um dia de webhook fora do ar levaria meio dia para drenar, e
  // o jogador ficaria esperando um diamante que já era dele.
  //
  // O laço para em três condições, e é por isso que ele não gira para sempre: página vazia,
  // cursor que não anda (defesa contra API que devolve o mesmo cursor eternamente) ou o teto
  // de páginas. Com o webhook ativo isto quase sempre sai na primeira volta, sem evento nenhum.
  const MAX_PAGINAS = 40;
  try {
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const r = await fetch(`${API_BASE}/api/v1/votes?after=${encodeURIComponent(cursor)}`, {
        headers: { authorization: `Bearer ${CHAVE_API}`, accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const corpo = await r.json();

      const eventos = eventosDoCorpo(corpo);
      if (eventos.length) await processar(eventos, 'api');

      // O cursor só avança DEPOIS de processar. Gravá-lo antes transformaria uma falha no meio
      // do lote em voto perdido para sempre — e reprocessar é inofensivo (o `event_id` barra).
      const proximo = corpo?.nextCursor ?? corpo?.next_cursor ?? null;
      if (proximo == null || String(proximo) === String(cursor)) break;
      await tdb.gravarCursor(proximo);
      cursor = proximo;
      if (!eventos.length) break;
    }
  } catch (err) {
    console.error('[topidle] recuperação falhou:', err.message);
  }
}

// ------------------------------------------------------------------ sessão

/**
 * O jogador dono da sessão.
 *
 * Resolve pela CONTA (`contaId`, campo assinado do token), nunca pelo `nick` de dentro do
 * token — esse é um retrato do momento da emissão e desatualiza quando o jogador escolhe o
 * nick no onboarding (Google/Discord) ou troca de nome, resultando em 401 aqui enquanto o
 * WebSocket continua funcionando. Mesmo caminho do `hello` do gateway. Ver o comentário gêmeo
 * em `diamantes-rotas.mjs`.
 */
async function jogadorDaSessao(req, url, corpo) {
  const token = corpo?.token
    ?? url.searchParams.get('sessao')
    ?? (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);
  const s = await lerSessao(token);
  if (!s?.contaId || s.provedor === 'guest') return null;
  const conta = await contaPorId(s.contaId);
  if (!conta || conta.nick_ok === false) return null;
  const { rows } = await pool.query(
    `SELECT id, nick FROM players WHERE lower(nick) = lower($1)`,
    [conta.nick],
  );
  return rows[0] ? { id: Number(rows[0].id), nick: rows[0].nick } : null;
}

// ------------------------------------------------------------------ rotas

export async function rotasDeTopIdle(req, res, url) {
  const rota = url.pathname;
  if (rota !== '/topidle/me' && rota !== '/webhooks/topidle') return false;

  // ---- o painel do jogador
  if (rota === '/topidle/me' && req.method === 'POST') {
    if (estourou(`me:${ipDe(req)}`, 60, 60_000)) return json(res, 429, { erro: 'voto.falhou' }), true;
    let corpo;
    try {
      corpo = JSON.parse((await lerCru(req, 4096)) || '{}');
    } catch {
      return json(res, 400, { erro: 'voto.falhou' }), true;
    }
    const jogador = await jogadorDaSessao(req, url, corpo);
    if (!jogador) return json(res, 401, { erro: 'auth.precisaLogin' }), true;

    const painel = await tdb.painelDe(jogador.id);
    json(res, 200, {
      ...painel,
      ativo: votoAtivo(),
      identificador: jogador.nick,
      url: urlDeVoto(JOGO_ID, jogador.nick),
    });
    return true;
  }

  // ---- o webhook
  if (rota === '/webhooks/topidle' && req.method === 'POST') {
    if (estourou(`wh:${ipDe(req)}`, 120, 60_000)) return json(res, 429, { ok: false }), true;
    if (!SEGREDO) {
      console.warn('[topidle] webhook recebido sem TOPIDLE_WEBHOOK_SECRET configurado');
      return json(res, 503, { erro: 'nao configurado' }), true;
    }

    const cru = await lerCru(req).catch(() => null);
    if (cru == null) return json(res, 400, { erro: 'corpo' }), true;

    let corpo;
    try {
      corpo = verificarAssinatura(cru, req.headers);
    } catch (err) {
      console.error('[topidle] webhook recusado:', err.message);
      return json(res, 401, { erro: 'assinatura' }), true;
    }

    const eventos = eventosDoCorpo(corpo);
    // 200 mesmo quando o corpo não traz voto identificável: o "Enviar teste" do painel deles
    // cai aqui, e qualquer outra resposta faria o TopIdle reenviar em laço um evento que
    // nunca vai virar nada.
    if (!eventos.length) return json(res, 200, { ok: true, processados: 0 }), true;

    const creditados = await processar(eventos, 'webhook');
    json(res, 200, { ok: true, processados: eventos.length, creditados });
    return true;
  }

  return false;
}
