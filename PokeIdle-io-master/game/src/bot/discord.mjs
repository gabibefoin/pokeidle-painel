// Um cliente mínimo do Discord: o Gateway (WebSocket) e o punhado de rotas REST que o bot usa.
//
// ### Por que não `discord.js`
//
// Porque uma dependência nova aqui custa um `package-lock.json` regerado, e o lock que o npm
// desta máquina escreve é recusado pelo servidor — já derrubou um deploy. O bot precisa de
// quatro eventos e cinco rotas; `ws` (que o jogo já usa) e o `fetch` do Node dão conta dos
// dois lados sem acrescentar um só pacote.
//
// ### O que o Gateway exige, em ordem
//
//   1. `GET /gateway/bot` diz a URL do socket (e quantos shards o bot precisa — nós usamos 1);
//   2. o servidor manda HELLO (op 10) com o intervalo do batimento;
//   3. o bot manda IDENTIFY (op 2) com token e INTENTS e passa a bater (op 1) no intervalo;
//   4. READY (op 0, `t: 'READY'`) traz o `session_id` e a URL de RESUME.
//
// Cair e reconectar é o caso NORMAL, não a exceção: o Discord derruba a conexão sozinho de
// tempos em tempos. Quem tem `session_id` e o último `s` recebido manda RESUME (op 6) e recebe
// os eventos perdidos; quem não tem (ou levou INVALID_SESSION sem `d: true`) reidentifica.
//
// ### Os intents, e por que eles precisam ser LIGADOS NO PAINEL
//
//   GUILDS         (1 << 0)   as guildas no READY, e o cache de canais
//   GUILD_MEMBERS  (1 << 1)   GUILD_MEMBER_ADD / REMOVE  ← PRIVILEGIADO
//   GUILD_INVITES  (1 << 6)   INVITE_CREATE / INVITE_DELETE
//
// `GUILD_MEMBERS` é um intent PRIVILEGIADO: pedir aqui não basta, ele tem de estar marcado em
// Developer Portal → Bot → Privileged Gateway Intents. Sem ele o IDENTIFY é recusado com
// close code 4014 e o bot nunca vê ninguém entrar — é o erro nº 1 de bot de convites, e por
// isso ele é tratado com mensagem própria em `CODIGOS_FATAIS`.
import { WebSocket } from 'ws';
import { setTimeout as esperar } from 'node:timers/promises';

const API = 'https://discord.com/api/v10';

export const INTENTS = (1 << 0) | (1 << 1) | (1 << 6);

const OP = {
  DESPACHO: 0,
  BATIMENTO: 1,
  IDENTIFICAR: 2,
  RETOMAR: 6,
  RECONECTAR: 7,
  SESSAO_INVALIDA: 9,
  OLA: 10,
  BATIMENTO_OK: 11,
};

/**
 * Códigos de fechamento em que reconectar não adianta — a configuração está errada e tentar de
 * novo só enche o log. Ver https://discord.com/developers/docs/topics/opcodes-and-status-codes
 */
const CODIGOS_FATAIS = new Map([
  [4004, 'token do bot inválido (DISCORD_BOT_TOKEN)'],
  [4013, 'intents inválidos'],
  [4014, 'intents privilegiados não liberados — marque SERVER MEMBERS INTENT no Developer Portal'],
]);

// ------------------------------------------------------------------ REST

export class ErroDiscord extends Error {
  constructor(status, corpo, rota) {
    super(`Discord ${status} em ${rota}: ${typeof corpo === 'string' ? corpo : JSON.stringify(corpo)}`);
    this.status = status;
    this.corpo = corpo;
    this.rota = rota;
  }
}

/**
 * Uma chamada REST, com o 429 tratado.
 *
 * O Discord responde 429 com `retry_after` em SEGUNDOS (fracionários) e espera que o cliente
 * durma exatamente isso. Ignorar o cabeçalho é o caminho mais rápido para o bot levar um ban
 * temporário de API — e o bot manda privado em rajada quando vários marcos caem juntos.
 */
export async function rest(token, rota, { metodo = 'GET', corpo = null, tentativas = 5 } = {}) {
  for (let i = 0; i < tentativas; i++) {
    const r = await fetch(`${API}${rota}`, {
      method: metodo,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'PokeIdleConvites (https://pokeidle.io, 1.0)',
      },
      body: corpo == null ? undefined : JSON.stringify(corpo),
    });
    if (r.status === 429) {
      const d = await r.json().catch(() => ({}));
      const espera = Math.min(60, Number(d.retry_after) || 1);
      console.warn(`[bot] 429 em ${rota} — esperando ${espera}s`);
      await esperar(espera * 1000);
      continue;
    }
    // 5xx do Discord é transitório: uma espera curta e de novo.
    if (r.status >= 500 && i < tentativas - 1) {
      await esperar(1000 * (i + 1));
      continue;
    }
    if (r.status === 204) return null;
    const texto = await r.text();
    const corpoResp = texto ? JSON.parse(texto) : null;
    if (!r.ok) throw new ErroDiscord(r.status, corpoResp ?? texto, rota);
    return corpoResp;
  }
  throw new ErroDiscord(429, 'limite de tentativas', rota);
}

/** Os convites do servidor, com `code`, `uses` e `inviter`. Exige MANAGE_GUILD no bot. */
export const listarConvites = (token, guildId) => rest(token, `/guilds/${guildId}/invites`);

/**
 * TODOS os membros do servidor, paginando de mil em mil.
 *
 * A paginação do Discord aqui é por `after=<id do último>`, e não por número de página: os ids
 * são crescentes no tempo, então pedir "os mil depois deste" percorre a lista inteira sem pular
 * nem repetir ninguém. Exige o SERVER MEMBERS INTENT, o mesmo que o bot já precisa para ver
 * alguém entrar.
 *
 * O teto de páginas é uma trava de sanidade: 200 mil membros é muito mais do que qualquer
 * servidor nosso, e sem ele um `after` que não avançasse viraria laço infinito.
 */
export async function listarMembros(token, guildId) {
  const todos = [];
  let depois = '0';
  for (let pagina = 0; pagina < 200; pagina++) {
    const lote = await rest(token, `/guilds/${guildId}/members?limit=1000&after=${depois}`);
    if (!lote?.length) break;
    todos.push(...lote);
    const ultimo = lote[lote.length - 1]?.user?.id;
    if (!ultimo || ultimo === depois) break;
    depois = ultimo;
    if (lote.length < 1000) break;
  }
  return todos;
}

/** Manda uma mensagem num canal. */
export const mandarNoCanal = (token, canalId, corpo) =>
  rest(token, `/channels/${canalId}/messages`, { metodo: 'POST', corpo });

/** As últimas mensagens de um canal. Exige READ_MESSAGE_HISTORY. */
export const listarMensagens = (token, canalId, limite = 50) =>
  rest(token, `/channels/${canalId}/messages?limit=${limite}`);

/** A EPHEMERAL do Discord: a mensagem que só quem interagiu enxerga. */
export const EFEMERA = 64;

/**
 * Responde a uma interação (clique de botão, comando).
 *
 * Esta é a ÚNICA forma de o Discord mostrar uma mensagem a uma pessoa só dentro de um canal
 * público: `flags: EFEMERA` só vale como RESPOSTA a uma interação. Um bot não consegue mandar
 * uma mensagem efêmera por vontade própria — por isso o código do marco sai por um botão que a
 * pessoa clica, e não por uma mensagem que o bot posta sozinho.
 *
 * O prazo é de TRÊS SEGUNDOS: passou disso, o Discord marca a interação como falha e a pessoa
 * vê "esta interação falhou". Por isso o que responde a este clique é uma consulta de índice e
 * mais nada.
 *
 * `tentativas: 1` porque repetir não ajuda: o token da interação vale uma vez.
 */
export const responderInteracao = (token, id, tokenInteracao, dados) =>
  rest(token, `/interactions/${id}/${tokenInteracao}/callback`, {
    metodo: 'POST',
    corpo: { type: 4, data: dados },
    tentativas: 1,
  });

/**
 * O bot consegue ESCREVER neste canal? Devolve `true`/`false`, sem escrever nada.
 *
 * `POST /channels/{id}/typing` exige exatamente a mesma permissao que mandar mensagem
 * (SEND_MESSAGES) e nao deixa mensagem nenhuma para tras — e' o unico jeito de perguntar
 * "eu posso falar aqui?" sem falar.
 *
 * Ver o canal e escrever nele sao permissoes DIFERENTES, e um canal de anuncios costuma negar a
 * segunda no override do proprio canal. Sem esta sonda, o bot subia dizendo "canal de log:
 * #convites" (que so prova VIEW_CHANNEL) e so descobria o 403 na primeira pessoa que entrasse —
 * que foi exatamente o que aconteceu em 21/09/2026.
 */
export async function podeEscrever(token, canalId) {
  try {
    await rest(token, `/channels/${canalId}/typing`, { metodo: 'POST', tentativas: 1 });
    return true;
  } catch (err) {
    if (err instanceof ErroDiscord && err.status === 403) return false;
    throw err;
  }
}

/**
 * Manda uma mensagem no PRIVADO de um usuário. São duas chamadas: abrir (ou reabrir) o canal
 * de DM e escrever nele. `POST /users/@me/channels` é idempotente — devolve o canal que já
 * existe em vez de criar outro.
 *
 * Lança `ErroDiscord` 403 quando a pessoa fechou o privado para membros do servidor. Não é um
 * erro do bot, é uma escolha dela: quem chama registra e segue (o código continua valendo, e a
 * pessoa pode pedir à staff).
 */
export async function mandarNoPrivado(token, usuarioId, corpo) {
  const canal = await rest(token, '/users/@me/channels', {
    metodo: 'POST',
    corpo: { recipient_id: String(usuarioId) },
  });
  return mandarNoCanal(token, canal.id, corpo);
}

// ------------------------------------------------------------------ Gateway

/**
 * Liga no Gateway e chama `aoEvento(nome, dados)` a cada despacho.
 *
 * Devolve um objeto com `fechar()`. Reconecta sozinho para sempre, com recuo exponencial até
 * 60 s — o bot é um serviço que fica de pé, não um script que roda e sai.
 */
export function conectarGateway(token, { aoEvento, aoPronto = null } = {}) {
  let ws = null;
  let batimento = null;
  let ultimoS = null;
  let sessao = null;
  let urlRetomar = null;
  let recuo = 1000;
  let vivo = true;
  // `batimentoConfirmado` é o detector de "zumbi": um socket aberto, sem erro nenhum, que parou
  // de receber. Sem ele o bot fica horas achando que está conectado. Dois batimentos sem
  // resposta e a conexão é derrubada na mão para o ciclo de reconexão assumir.
  let batimentoConfirmado = true;

  const pararBatimento = () => {
    if (batimento) clearInterval(batimento);
    batimento = null;
  };

  const derrubar = (codigo = 4000) => {
    pararBatimento();
    try { ws?.close(codigo); } catch { /* já fechado */ }
    ws = null;
  };

  async function ligar() {
    if (!vivo) return;
    let url = urlRetomar;
    if (!url) {
      const info = await rest(token, '/gateway/bot').catch((err) => {
        console.error('[bot] /gateway/bot falhou:', err.message);
        return null;
      });
      if (!info) return void agendar();
      url = info.url;
    }
    ws = new WebSocket(`${url}?v=10&encoding=json`);

    ws.on('message', (bruto) => {
      let m;
      try { m = JSON.parse(bruto); } catch { return; }
      if (m.s != null) ultimoS = m.s;

      if (m.op === OP.OLA) {
        batimentoConfirmado = true;
        pararBatimento();
        batimento = setInterval(() => {
          if (!batimentoConfirmado) {
            console.warn('[bot] batimento sem resposta — derrubando para reconectar');
            return derrubar(4000);
          }
          batimentoConfirmado = false;
          try { ws?.send(JSON.stringify({ op: OP.BATIMENTO, d: ultimoS })); } catch { /* fechando */ }
        }, m.d.heartbeat_interval);
        // Com sessão na mão, RETOMAR: os eventos perdidos durante a queda chegam em seguida.
        // Sem ela, IDENTIFICAR do zero.
        if (sessao && urlRetomar) {
          ws.send(JSON.stringify({ op: OP.RETOMAR, d: { token, session_id: sessao, seq: ultimoS } }));
        } else {
          ws.send(JSON.stringify({
            op: OP.IDENTIFICAR,
            d: {
              token,
              intents: INTENTS,
              properties: { os: process.platform, browser: 'pokeidle', device: 'pokeidle' },
            },
          }));
        }
        return;
      }

      if (m.op === OP.BATIMENTO) {
        batimentoConfirmado = true;
        try { ws?.send(JSON.stringify({ op: OP.BATIMENTO, d: ultimoS })); } catch { /* fechando */ }
        return;
      }
      if (m.op === OP.BATIMENTO_OK) {
        batimentoConfirmado = true;
        return;
      }
      if (m.op === OP.RECONECTAR) return void derrubar(4000);
      if (m.op === OP.SESSAO_INVALIDA) {
        // `d: true` = a sessão ainda pode ser retomada; `false` = comece do zero.
        if (!m.d) {
          sessao = null;
          urlRetomar = null;
          ultimoS = null;
        }
        return void derrubar(4000);
      }
      if (m.op !== OP.DESPACHO) return;

      if (m.t === 'READY') {
        sessao = m.d.session_id;
        urlRetomar = m.d.resume_gateway_url;
        recuo = 1000;
        aoPronto?.(m.d);
      }
      if (m.t === 'RESUMED') recuo = 1000;
      try {
        aoEvento?.(m.t, m.d);
      } catch (err) {
        console.error(`[bot] evento ${m.t} falhou:`, err.message);
      }
    });

    ws.on('close', (codigo) => {
      pararBatimento();
      ws = null;
      const fatal = CODIGOS_FATAIS.get(codigo);
      if (fatal) {
        console.error(`[bot] conexão recusada (${codigo}): ${fatal}`);
        vivo = false;
        process.exitCode = 1;
        return;
      }
      if (vivo) console.warn(`[bot] socket fechou (${codigo}) — reconectando`);
      agendar();
    });

    ws.on('error', (err) => console.error('[bot] socket:', err.message));
  }

  function agendar() {
    if (!vivo) return;
    const espera = recuo;
    recuo = Math.min(60_000, recuo * 2);
    setTimeout(() => { ligar().catch((err) => console.error('[bot] ligar falhou:', err.message)); }, espera);
  }

  ligar().catch((err) => {
    console.error('[bot] primeira conexão falhou:', err.message);
    agendar();
  });

  return {
    fechar() {
      vivo = false;
      derrubar(1000);
    },
  };
}
