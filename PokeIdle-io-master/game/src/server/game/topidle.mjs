// VOTE & GANHE — as regras do voto no TopIdle. Sem banco e sem HTTP, só a regra.
//
// O TopIdle (https://topidle.com) é um ranking de jogos idle. O jogador vota lá, autenticado
// pela conta Google DELES, e o TopIdle nos avisa por webhook. Cada aviso confirmado vira
// diamante aqui dentro.
//
// ### Por que o voto EMITE diamante
//
// `MOTIVOS_QUE_EMITEM`, em `diamantes.mjs`, tinha dois motivos e um comentário dizendo que
// diamante nascido fora de um pagamento é produto entregue de graça. O voto é o terceiro, e é
// uma decisão de negócio consciente: é custo de aquisição — a única forma de subir no ranking
// do TopIdle é ter jogador votando, e o ranking é de onde vem jogador novo.
//
// O que segura a emissão é o TETO DIÁRIO daqui embaixo, e ele é conferido no banco, dentro da
// mesma transação que credita (ver `topidle-db.mjs`). Sem teto, um jogador com duas contas no
// TopIdle viraria uma torneira.
//
// ### Como o jogador é encontrado
//
// Pelo NOME DO PERSONAGEM (`playerIdentifier`), não pelo e-mail Google. O TopIdle deixa
// escolher os dois, mas o e-mail só serviria se a conta do jogo fosse SEMPRE a mesma conta
// Google — e aqui não é: dá para entrar com senha própria ou com Discord. O nick é a chave de
// rota de todo o jogo (`players.nick`), então é ele que vai no link de voto.
//
// O e-mail continua sendo aceito como SEGUNDA tentativa, para o caso de o jogador votar sem
// passar pelo nosso link: se a conta dele aqui for Google e o e-mail bater, o voto acha o dono.

/** O id do nosso jogo no TopIdle, o que aparece na URL pública de votação. */
export const JOGO_ID_PADRAO = 'pokeidle-io-5f9969';

/** Quantos votos fecham um diamante. */
export const VOTOS_POR_DIAMANTE = 2;

/** Quantos diamantes cada par de votos paga. */
export const DIAMANTES_POR_PAR = 1;

/**
 * A RECARGA por jogador: quanto tempo tem de passar entre dois votos que CONTAM.
 *
 * ### O buraco que isto fecha (relatado e reproduzido em produção)
 *
 * O TopIdle não barra multi-conta. Dá para logar com `a@gmail.com`, votar em "fasi", trocar
 * para `b@gmail.com`, votar em "fasi" de novo — e os dois eventos chegam aqui, legítimos e
 * assinados, com segundos de diferença. O evento **não traz identidade nenhuma da conta que
 * votou** (ver `chaveVotante`), então não há como distinguir as duas pelo conteúdo.
 *
 * A trava anterior era um teto por DIA UTC, e ela tinha um furo de calendário: um voto às
 * 23h50 e outro às 00h10 caem em dias diferentes e passavam os dois, vinte minutos depois um
 * do outro. Contar por janela deslizante não tem beira para explorar.
 *
 * ### Como o servidor decide
 *
 * Todo voto que conta grava, na própria linha, o instante a partir do qual o PRÓXIMO voto
 * daquele jogador pode contar (`proximo_em = votado_em + esta janela`). Um voto que chegue
 * antes disso entra gravado, marcado com `recarga`, e não soma. O jogador não perde o voto
 * para o ranking do TopIdle — que é o que nos interessa lá —, só não ganha por ele duas vezes.
 *
 * A janela é a mesma que o TopIdle anuncia (`RECARGA_MS`), menos uma folga: ver `FOLGA_MS`.
 */
export const RECARGA_MS = 24 * 60 * 60 * 1000;

/**
 * Folga na recarga, para nunca recusar um voto honesto.
 *
 * Se a janela deles for de 24 h cravadas e a nossa também, o jogador que volta exatamente no
 * horário é recusado por causa de milissegundos de diferença entre os dois relógios — e o
 * prejuízo dele é real (um dia de progresso), enquanto o ganho de um fraudador com meia hora
 * a menos de espera é nenhum.
 */
export const FOLGA_MS = 30 * 60 * 1000;

/** A janela que o servidor de fato cobra. */
export const RECARGA_EFETIVA_MS = RECARGA_MS - FOLGA_MS;

/** A partir de quando o próximo voto deste jogador pode contar. */
export const proximoVotoEm = (votadoEm) =>
  new Date((votadoEm?.getTime?.() ?? Date.now()) + RECARGA_EFETIVA_MS);

/**
 * Quantas contas do TopIdle podem votar no MESMO jogador.
 *
 * ### O buraco que isto fecha
 *
 * O teto diário já limita o dinheiro, mas sozinho ele deixa um cenário feio de pé: alguém
 * abre vinte contas Google no TopIdle e vota em todas com o mesmo `playerIdentifier`. O
 * prejuízo continua sendo um diamante por dia — mas a pessoa sobe no ranking à custa de
 * contas falsas, e não há registro nenhum de que isso aconteceu.
 *
 * Então o vínculo é fechado nos DOIS sentidos, na primeira vez que cada lado aparece:
 *
 *   - uma conta do TopIdle que já votou no jogador A nunca mais conta para o jogador B
 *     (é o vetor "vender voto", e também o de sabotagem: encher a cota diária de um rival);
 *   - um jogador aceita no máximo DUAS contas distintas votando nele.
 *
 * Duas, e não uma, porque trocar de e-mail acontece de verdade — quem perdeu o acesso ao
 * Google antigo não pode ficar sem votar para sempre. A partir da terceira é padrão de
 * fazenda, e aí o voto entra gravado, marcado, e não soma.
 *
 * **Isto só funciona se o evento trouxer alguma identidade do votante** (ver `chaveVotante`).
 * Se não trouxer, o registro fica com `sem_votante` e a única trava é o teto diário — por
 * isso o webhook grita no log quando isso acontece.
 */
export const MAX_VOTANTES_POR_JOGADOR = 2;


/**
 * Tolerância do carimbo de tempo do webhook, em segundos.
 *
 * A assinatura sozinha não impede REPLAY: quem interceptar um POST válido pode reenviá-lo para
 * sempre. O carimbo entra no HMAC, então não dá para forjar um novo — recusar o que for velho
 * demais fecha a janela. Cinco minutos cobre atraso de fila e relógio fora de sincronia sem
 * deixar o pacote velho valer o dia inteiro.
 */
export const TOLERANCIA_S = 300;

/** O que o TopIdle aceita como identificador — é o nick, e o nick tem forma fixa. */
export const IDENTIFICADOR_OK = /^[a-zA-Z0-9_]{3,16}$/;

/** A URL de votação, já com o nick preenchido para o jogador só conferir e autorizar. */
export function urlDeVoto(jogoId, identificador) {
  const base = `https://topidle.com/jogo/${encodeURIComponent(jogoId || JOGO_ID_PADRAO)}`;
  if (!identificador) return base;
  return `${base}?playerIdentifier=${encodeURIComponent(identificador)}`;
}

/**
 * O dia do voto, em UTC.
 *
 * O teto diário precisa de um recorte, e o recorte é o do TopIdle (UTC), não o do jogador —
 * usar o fuso de quem vota faria o mesmo evento contar em dias diferentes conforme o servidor
 * que o processasse.
 */
export const diaUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * QUEM votou — a identidade da conta do TopIdle, não a do jogador.
 *
 * É a chave do vínculo de `MAX_VOTANTES_POR_JOGADOR`, e a única defesa possível contra abrir
 * várias contas lá e votar em todas no mesmo nick. O TopIdle não documenta o nome deste campo
 * (a especificação só promete o `playerIdentifier` OU o e-mail), então a busca é ampla de
 * propósito: qualquer um destes serve, desde que seja ESTÁVEL entre os votos da mesma conta.
 *
 * A ordem importa — o `voterId` deles, se existir, é melhor que o e-mail, porque e-mail muda.
 *
 * Devolve `''` quando o evento não traz identidade nenhuma. Nesse caso o vínculo não roda e a
 * única trava que sobra é o teto diário; quem chama grita no log.
 */
export function chaveVotante(bruto) {
  const candidatos = [
    bruto?.voterId, bruto?.voter_id, bruto?.userId, bruto?.user_id,
    bruto?.googleId, bruto?.google_id, bruto?.googleSub, bruto?.sub,
    bruto?.accountId, bruto?.account_id,
    bruto?.email, bruto?.googleEmail,
  ];
  for (const c of candidatos) {
    const v = String(c ?? '').trim().toLowerCase();
    if (v) return v;
  }
  return '';
}

/**
 * Normaliza um evento de voto, venha ele do webhook ou da API de recuperação.
 *
 * Os dois caminhos trazem o mesmo evento com nomes ligeiramente diferentes de campo, e a
 * regra de "processe cada eventId uma única vez" só funciona se os dois chegarem ao banco
 * com a MESMA cara. Devolve `null` para o que não é voto identificável.
 */
export function normalizarEvento(bruto) {
  if (!bruto || typeof bruto !== 'object') return null;

  const eventId = String(bruto.eventId ?? bruto.id ?? '').trim();
  if (!eventId) return null;

  // O evento real traz `type: "vote.created"`. Nada promete que seja o único tipo — um
  // `vote.deleted` ou `vote.reverted` no futuro chegaria com a mesma cara e, sem esta linha,
  // viraria crédito. Aceitar só o que se conhece é mais barato que descobrir depois.
  // Ausente passa: o "Enviar teste" do painel deles pode não carimbar tipo nenhum.
  const tipo = String(bruto.type ?? bruto.evento ?? '').trim().toLowerCase();
  if (tipo && tipo !== 'vote.created') return null;

  const identificador = String(bruto.playerIdentifier ?? bruto.identifier ?? '').trim();
  const email = String(bruto.email ?? bruto.googleEmail ?? '').trim().toLowerCase();
  if (!identificador && !email) return null;

  const votadoBruto = bruto.votedAt ?? bruto.createdAt ?? bruto.timestamp ?? null;
  const votadoMs = votadoBruto ? Date.parse(votadoBruto) : Date.now();

  return {
    eventId,
    identificador: IDENTIFICADOR_OK.test(identificador) ? identificador : '',
    email: email.includes('@') ? email : '',
    votante: chaveVotante(bruto),
    // Nunca no futuro. A recarga é contada a partir daqui, então um `votedAt` adiantado —
    // por relógio deles fora de hora ou por fuso mal serializado — trancaria o jogador para
    // além do que a regra manda, e ele não teria como perceber nem reclamar do lugar certo.
    votadoEm: new Date(Math.min(Number.isFinite(votadoMs) ? votadoMs : Date.now(), Date.now())),
    // O evento original, só para o log dizer QUAIS campos vieram quando não achamos identidade
    // de votante. Não vai para o banco e não sai daqui — é material de diagnóstico do primeiro
    // evento real, que é quando se descobre o formato de verdade deles.
    bruto,
  };
}
