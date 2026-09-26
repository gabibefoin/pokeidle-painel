// O painel de lucro: quanto entrou, quanto ainda é dos jogadores, e quanto sobra de fato.
//
// ### O que este arquivo protege
//
// Ele é o único lugar do sistema que decide **quanto USDT pode sair da tesouraria por vontade
// do dono**. Tudo aqui é escrito partindo de que a sessão que chega pode ser de um invasor.
//
// Três travas, e nenhuma delas é a tela:
//
//   1. **Quem** — o e-mail da conta tem de estar em `ADMIN_EMAILS`. Confere-se no servidor,
//      pelo `contaId` do token assinado; o cliente não manda quem ele é.
//   2. **Para onde** — só endereços de `CARTEIRAS_LUCRO`. Não existe campo livre. Se a sessão
//      do dono for roubada, o dinheiro só pode ir para onde ele já tinha autorizado — vira
//      transtorno, não prejuízo. Trocar a lista exige acesso ao `.env`, ou seja, SSH.
//   3. **Quanto** — no máximo a SOBRA, calculada abaixo. Nem o dono consegue clicar num valor
//      que quebre a solvência.
//
// ### Uma nota de nome: GEMA na tela, `orb` no código
//
// A moeda se chama **Gema** para o jogador. No código e no banco ela continua `orb`
// (`orb_ledger`, `orb_depositos`, `orbsEmCirculacao`) porque renomear tabela e sessenta e
// tantos identificadores é migração de risco real por zero ganho para quem joga. A regra é:
// **texto que o jogador lê diz Gema; nome de coluna, campo e variável continua `orb`.** Este
// arquivo devolve os campos com o nome do banco e a tela traduz.
//
// ### Por que "lucro" não é um saldo em lugar nenhum
//
// Os dois 30% do jogo (comissão do Mercado e spread do saque) nunca movem USDT:
//
//   · O Mercado credita 70% ao vendedor e **destrói** as outras 30% de Gema. O USDT que
//     lastreava aquilo continua parado na tesouraria — só deixou de ser devido.
//   · O saque paga 0,007 por Gema que foi comprada a 0,01. Os 0,003 já estavam lá.
//
// Então lucro é a distância entre o que se tem e o que se deve:
//
//     caixa   = quanto de USDT está de fato na tesouraria
//     passivo = (gemas em circulação + comissões de referral ainda não recolhidas) × preço de recompra
//     lucro   = caixa − passivo
//
// E o que se pode TIRAR é menos que o lucro, porque um caixa igual ao passivo quebra no
// primeiro dia de saque acima da média. Daí o colchão.
import { pool } from './db.mjs';
import { decifrar } from './cofre.mjs';
import * as ddb from './diamantes-db.mjs';
import { enviarParaSim, desconectarJogador, publicar, pub, PRESENCA, CANAL_EVENTO, CANAL_GUILD, CANAL_ONLINE_EXTRA, CANAL_WHITELIST, CANAL_IP_BANIDO, contarOnline, listarMutesChat, revogarMuteChat, canalGateway, gatewayDoJogador, quemEstaNaRede } from './bus.mjs';
import { executarExclusaoConta } from './conta-excluir.mjs';
import { liquidoPagamentoCentavos } from '../shared/taxa-pagamento.mjs';
import { enviarEmail, moldarEmail, resend, trocarEmailPeloSuporte } from './auth.mjs';
import { DOMINIOS_EMAIL_CADASTRO } from '../shared/email-cadastro.mjs';
import { emailCanonico } from '../shared/email-canonico.mjs';
import * as edb from './eventos-db.mjs';
import * as gdb from './guild-db.mjs';
import * as oxdb from './online-extra-db.mjs';
import { definirExtras } from './online-extra.mjs';
import { SERVIDOR } from './protocol.mjs';
import { PRECO_COMPRA, PRECO_SAQUE, MOTIVO as MOTIVO_ORB } from './game/orbs.mjs';
import { MOTIVOS_DE_TRANSFERENCIA, MOTIVO as MOTIVO_DIA } from './game/diamantes.mjs';

/**
 * Os motivos de diamante que só TROCAM DE DONO, como lista para o SQL.
 *
 * Toda conta de "emitido" e "gasto" neste arquivo é um `SUM(delta)` com filtro de sinal, e o
 * Mercado da Comunidade quebra essa leitura: um anúncio grava `mercado_escrow` (negativo) e a
 * venda grava `mercado_compra` (positivo) — os dois pelo mesmo tamanho, mas em jogadores
 * diferentes. Sem excluí-los, vender 1.000 diamantes de um jogador para outro aparece no painel
 * como 1.000 emitidos E 1.000 gastos, e o número que deveria bater com o provedor de pagamento
 * para de bater.
 *
 * `circulando` (o `SUM(delta)` sem filtro) continua certo com ou sem eles — a soma dos três é
 * zero. Quem precisa da exclusão são só as somas com filtro de sinal.
 */
const MOTIVOS_TRANSFERENCIA_DIA = [...MOTIVOS_DE_TRANSFERENCIA];

/**
 * O mesmo conjunto como TRECHO de SQL, para as consultas que já usam todos os `$n` que têm.
 *
 * Montar SQL concatenando string é o pecado de sempre, então a validação abaixo é a condição
 * de existir: estes valores vêm do nosso `MOTIVO` (identificadores minúsculos, escritos à mão
 * em `game/diamantes.mjs`), nunca de um cliente. O `throw` no boot é a rede — se alguém um dia
 * criar um motivo com aspas ou espaço, o servidor não sobe em vez de sair montando SQL torto.
 */
const SQL_NAO_TRANSFERENCIA_DIA = (() => {
  for (const m of MOTIVOS_TRANSFERENCIA_DIA) {
    if (!/^[a-z_]+$/.test(m)) throw new Error(`motivo de diamante inesperado para SQL: ${m}`);
  }
  return `motivo NOT IN (${MOTIVOS_TRANSFERENCIA_DIA.map((m) => `'${m}'`).join(', ')})`;
})();
import * as odb from './orbs-db.mjs';
import { criarChain } from './chain.mjs';
import { passagem as passagemVarredura, MINIMO_USDT_ADMIN } from './orbs-varredura.mjs';
import { itens, especies, bolaPorId } from './content.mjs';
import {
  multicontas, origensDaConta, contasDoGrupo, maxContasPorIp, maxOnlinePorIp,
  estadoDoTetoPorIp, liberarIp, travarIp, origensAcimaDoTeto, ipNaWhitelist,
  banirIp, desbanirIp, listarIpsBanidos, retratoDoIp, chaveDeBanDeIp,
} from './origens-db.mjs';
import { creditarItemNoBanco } from './market-db.mjs';
import { temSeed } from './orbs-enderecos.mjs';
import { registrarCoinGrande, registrarAcaoJogador, LIMITE_COINS_AUDIT } from './audit-db.mjs';
import {
  CUSTO_REDE_PRIMEIRO_SAQUE, ErroAfiliado, GEMAS_POR_DIAMANTE, MARGEM_MINIMA_CAIXA,
  PCT_DIA_COMISSAO, PCT_ORB_COMISSAO, TETO_DIA_EXTRA_MAX, TETO_DIA_MAX, TETO_DIA_SEGURO,
  TETO_ORB_RUINA, TETO_ORB_SEGURO, depositoDeEquilibrio, margemDoDeposito, normalizarSlug,
  tetoDaGema, validarTaxa,
} from './game/afiliados.mjs';
import {
  definirEspecial, listarEspeciais, removerEspecial, totalGemasComissaoPendentes,
} from './afiliados-db.mjs';

/**
 * A ponte com a blockchain, criada uma vez e só quando alguém abre o painel.
 *
 * Preguiçosa de propósito: `criarChain` lê a chave privada do ambiente, e não há motivo para
 * tocar nela no boot de um processo que pode passar a vida inteira sem ninguém abrir o painel.
 * Sem `CHAIN_REDE` configurada, `criarChain` devolve a rede SIMULADA — o painel funciona e
 * mostra números, mas nenhuma transferência sai para lugar nenhum.
 */
let chain = null;
const aChain = () => (chain ??= criarChain());

/** Evita duas varreduras manuais ao mesmo tempo — cada endereço assina na blockchain. */
let varreduraEmCurso = false;

const env = process.env;

/** Quem enxerga o painel. Vazio = ninguém, e o painel devolve 404 para todo mundo. */
const ADMINS = new Set(
  (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/** Quem pode usar a aba Resolver Auditoria (dar itens/diamantes com log dedicado). */
const RESOLVER_AUDITORIA = new Set(
  (env.AUDITORIA_RESOLVER_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/** Id sentinela no formulário — diamantes não são linha de `items`. */
export const RESOLVER_ITEM_DIAMANTES = 0;

/**
 * As carteiras que podem receber. É a trava que transforma "roubaram minha sessão e levaram o
 * caixa" em "moveram meu dinheiro para a minha própria carteira fria".
 *
 * Aceita as duas formas, separadas por vírgula:
 *
 *     CARTEIRAS_LUCRO=fria:HpSrFUid...,quente:7xKXtg2C...   com apelido
 *     CARTEIRAS_LUCRO=HpSrFUid...                            só o endereço
 *
 * A segunda existe porque exigir o prefixo era um erro silencioso: sem o `nome:`, a linha era
 * descartada e o painel dizia "nenhuma carteira cadastrada" sem dizer por quê. Endereço de
 * Solana é base58 e nunca contém `:`, então distinguir os dois casos é sem ambiguidade.
 *
 * O apelido só serve para você reconhecer a carteira no seletor da tela — quem manda é o
 * endereço.
 */
const CARTEIRAS = (env.CARTEIRAS_LUCRO ?? '')
  .split(',')
  .map((par) => par.trim())
  .filter(Boolean)
  .map((par) => {
    const i = par.indexOf(':');
    if (i < 0) return { nome: `${par.slice(0, 6)}…${par.slice(-4)}`, endereco: par };
    return { nome: par.slice(0, i).trim(), endereco: par.slice(i + 1).trim() };
  })
  .filter((c) => c.endereco);

/**
 * Quantas vezes o passivo tem de caber no caixa antes de sobrar alguma coisa.
 *
 * 1,5 quer dizer: só é "sobra" o que passar de uma vez e meia tudo que os jogadores poderiam
 * sacar hoje. Parece conservador e é de propósito — o custo de deixar dinheiro parado é zero,
 * e o custo de não conseguir pagar um saque é a confiança no jogo inteiro.
 */
const COLCHAO = Number(env.COLCHAO_LUCRO ?? 1.5);

export const ehAdmin = (email) => !!email && ADMINS.has(String(email).toLowerCase());
export const temPainel = () => ADMINS.size > 0 || RESOLVER_AUDITORIA.size > 0;
export const ehResolverAuditoria = (email) => !!email && RESOLVER_AUDITORIA.has(String(email).toLowerCase());
export const temResolverAuditoria = () => RESOLVER_AUDITORIA.size > 0;

/**
 * Quem usa a tag [Admin] vermelha DENTRO DO JOGO — os dois cargos do painel, não só `ADMIN_EMAILS`.
 *
 * Existe separada de `ehAdmin` porque as duas perguntas são diferentes, e misturá-las já deu
 * errado uma vez: quem entrava em `AUDITORIA_RESOLVER_EMAILS` continuava aparecendo no chat com
 * a tag que tinha antes — [Moderador], na maioria dos casos — porque o gateway perguntava
 * `ehAdmin` e ouvia não. Não era o [Moderador] passando na frente do [Admin]: `cargoDoChat`
 * sempre pôs admin primeiro; é que o [Admin] nunca chegava a ser atribuído.
 *
 * `ehAdmin` continua sendo a pergunta do DINHEIRO — Tesouraria, financeiro, notas. Esta aqui é a
 * pergunta do CHAT: quem a staff enxerga como staff, e quem não pode ser mutado por engano.
 */
export const ehAdminNoJogo = (email) => ehAdmin(email) || ehResolverAuditoria(email);

/** Tags de chat que o painel pode atribuir por nick (além de [Admin] por e-mail). */
export const CARGOS_CHAT = ['moderador', 'helper', 'streamer'];

/** Tags com poderes de moderação no chat (apagar, mutar). */
export const CARGOS_MOD_CHAT = ['moderador', 'helper'];

/**
 * Tags que podem usar os COMANDOS de barra do chat (`/mute`, `/unmute`).
 *
 * Mais estreita que `CARGOS_MOD_CHAT` de propósito: o menu de moderação oferece quatro
 * durações prontas, a maior delas 24 h; o comando aceita qualquer número de minutos até
 * uma semana e não pede confirmação nenhuma. O helper continua com o menu — quem digita a
 * duração é admin ou moderador.
 */
export const CARGOS_CMD_CHAT = ['moderador'];

/** O nick em jogo de quem tem cargo no painel — usado no chat para não mutar a própria staff. */
export async function ehAdminPorNick(nick) {
  if (!nick || (!ADMINS.size && !RESOLVER_AUDITORIA.size)) return false;
  const { rows } = await pool.query(
    `SELECT lower(email) AS email FROM accounts WHERE lower(nick) = lower($1)`,
    [nick],
  );
  return ehAdminNoJogo(rows[0]?.email);
}
export const carteirasDeLucro = () => CARTEIRAS.map(({ nome, endereco }) => ({ nome, endereco }));

export async function migrar() {
  // Toda colheita fica registrada, inclusive a que falhou. É o que permite responder "para
  // onde foi esse dinheiro" seis meses depois sem depender da memória de ninguém.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_colheitas (
      id         BIGSERIAL PRIMARY KEY,
      por_email  TEXT NOT NULL,
      carteira   TEXT NOT NULL,
      usdt       NUMERIC(20,6) NOT NULL,
      assinatura TEXT,
      erro       TEXT,
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_cargos (
      nick       TEXT PRIMARY KEY,
      cargo      TEXT NOT NULL,
      por_email  TEXT NOT NULL,
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_bans (
      account_id  BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      motivo      TEXT,
      por_email   TEXT NOT NULL,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // Ban soft: bloqueia login e expulsa quem está online, mas NÃO zera progresso.
  await pool.query(`ALTER TABLE account_bans ADD COLUMN IF NOT EXISTS soft BOOLEAN NOT NULL DEFAULT false`);
  // A tabela dos eventos globais. Migra aqui TAMBÉM (o sim já faz a sua) porque num cluster
  // com `ROLE=gateway` separado quem abre a seção EVENTOS é este processo, e ele não pode
  // depender de um sim ter subido antes para a consulta não estourar.
  await edb.migrar();
  await oxdb.migrar();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_custos (
      id              BIGSERIAL PRIMARY KEY,
      tipo            TEXT NOT NULL CHECK (tipo IN ('mensal', 'fixo')),
      descricao       TEXT NOT NULL,
      valor_centavos  BIGINT NOT NULL DEFAULT 0,
      ativo           BOOLEAN NOT NULL DEFAULT true,
      por_email       TEXT NOT NULL,
      criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // E-mails enviados manualmente pelo painel (aba Enviar novo) — não inclui confirmação de cadastro etc.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_emails_marketing (
      id         BIGSERIAL PRIMARY KEY,
      por_email  TEXT NOT NULL,
      para       TEXT NOT NULL,
      assunto    TEXT NOT NULL,
      mensagem   TEXT NOT NULL,
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_emails_marketing_em
      ON admin_emails_marketing(criado_em DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_fin_config (
      chave  TEXT PRIMARY KEY,
      valor  TEXT NOT NULL
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_resolver_log (
      id          BIGSERIAL PRIMARY KEY,
      por_email   TEXT NOT NULL,
      player_id   BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      player_nick TEXT NOT NULL,
      item_id     BIGINT NOT NULL,
      item_nome   TEXT NOT NULL,
      qtd         BIGINT NOT NULL,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_resolver_em ON admin_resolver_log(criado_em DESC)`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_resolver_player ON admin_resolver_log(player_id, criado_em DESC)`);
}

// -------------------------------------------------------------- usuários

/** Ban ativo da conta, ou `null`. */
export async function banDaConta(contaId) {
  if (!contaId) return null;
  const { rows } = await pool.query(
    `SELECT motivo, por_email, criado_em, soft FROM account_bans WHERE account_id = $1`,
    [contaId],
  );
  return rows[0] ?? null;
}

/** Lista contas com dados básicos do jogo e status de ban. */
export async function listarUsuarios({ q = '', limite = 50, offset = 0 } = {}) {
  const busca = String(q ?? '').trim();
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);

  const where = busca
    ? `WHERE lower(a.nick) LIKE '%' || lower($1) || '%'
          OR lower(coalesce(a.email, '')) LIKE '%' || lower($1) || '%'`
    : '';
  const params = busca ? [busca, lim, off] : [lim, off];
  const limOff = busca ? '$2' : '$1';
  const offOff = busca ? '$3' : '$2';

  const { rows } = await pool.query(
    `SELECT a.id, a.nick, a.email, a.provedor, a.email_ok, a.nick_ok,
            a.criado_em, a.ultimo_login,
            p.id AS player_id, p.level, p.gold, p.diamonds, p.orbs, p.elo, p.last_seen,
            coalesce(dia_comp.total, 0)::bigint AS diamantes_reset,
            coalesce(p.orbs, 0)::bigint AS gemas_reset,
            b.motivo AS ban_motivo, b.por_email AS ban_por, b.criado_em AS ban_em,
            b.soft AS ban_soft
       FROM accounts a
       LEFT JOIN players p ON lower(p.nick) = lower(a.nick)
       LEFT JOIN (
         SELECT player_id, sum(qtd)::bigint AS total
           FROM diamante_pagamentos
          WHERE status = 'pago'
          GROUP BY player_id
       ) dia_comp ON dia_comp.player_id = p.id
       LEFT JOIN account_bans b ON b.account_id = a.id
       ${where}
       ORDER BY a.ultimo_login DESC NULLS LAST, a.id DESC
       LIMIT ${limOff} OFFSET ${offOff}`,
    params,
  );

  const { rows: tot } = await pool.query(
    `SELECT count(*)::int AS n FROM accounts a ${where}`,
    busca ? [busca] : [],
  );

  let online = {};
  try {
    online = await pub.hgetall(PRESENCA);
  } catch {
    // Redis fora não derruba a listagem — só some o indicador online.
  }

  return {
    total: tot[0]?.n ?? 0,
    offset: off,
    limite: lim,
    usuarios: rows.map((r) => ({
      id: Number(r.id),
      nick: r.nick,
      email: r.email,
      provedor: r.provedor,
      emailOk: r.email_ok,
      nickOk: r.nick_ok,
      criadoEm: r.criado_em,
      ultimoLogin: r.ultimo_login,
      level: r.level != null ? Number(r.level) : null,
      gold: r.gold != null ? Number(r.gold) : null,
      diamonds: r.diamonds != null ? Number(r.diamonds) : null,
      orbs: r.orbs != null ? Number(r.orbs) : null,
      diamantesReset: Number(r.diamantes_reset ?? 0),
      gemasReset: Number(r.gemas_reset ?? 0),
      elo: r.elo != null ? Number(r.elo) : null,
      lastSeen: r.last_seen,
      online: !!online[String(r.nick ?? '').toLowerCase()],
      banido: !!r.ban_em,
      banSoft: !!r.ban_soft,
      banMotivo: r.ban_motivo,
      banPor: r.ban_por,
      banEm: r.ban_em,
    })),
  };
}

/**
 * TUDO sobre um jogador, numa tela — bolsa, pokémon, anúncios, origens e o log recente.
 *
 * ### Por que isto existe
 *
 * Um jogador relatou "o Hunt Analyser contou 3 Bronze Boss Token e a minha bolsa tem 1".
 * Responder aquilo exigiu nove consultas escritas à mão direto no Postgres de produção — a
 * bolsa, os anúncios dele, os pagamentos de cada anúncio, o log de auditoria — e a resposta
 * estava lá, inteira, o tempo todo: um dos tokens estava preso num anúncio ABERTO no Mercado
 * (escrow tira o item da bolsa) e os outros tinham sido vendidos. Nada disso aparecia em lugar
 * nenhum do painel. Esta função é aquele conjunto de consultas virando uma tela, para a
 * próxima pergunta desse tipo custar um clique.
 *
 * ### É leve?
 *
 * É. Toda consulta aqui é por `player_id`/`account_id` com índice, com teto de linhas, e são
 * disparadas em paralelo. O único cuidado real é o `player_pokemon` de quem tem depot grande —
 * daí o `LIMIT` com o total contado à parte, em vez de trazer tudo e cortar no cliente.
 *
 * ### O que NÃO tem aqui
 *
 * Nenhum botão. Isto é leitura. Mexer em coisa de jogador já tem lugar próprio (banir, coins,
 * resolver auditoria), com log de quem fez o quê — e misturar as duas coisas numa tela de
 * consulta é como um acidente acontece.
 */
export async function fichaDeJogador({ nick, completo = true } = {}) {
  const busca = String(nick ?? '').trim();
  if (!busca) throw new Error('diga o nick');

  const { rows: base } = await pool.query(
    `SELECT a.id AS conta_id, a.nick AS conta_nick, a.email, a.email_canon, a.provedor,
            a.email_ok, a.nick_ok, a.criado_em, a.ultimo_login,
            b.motivo AS ban_motivo, b.por_email AS ban_por, b.criado_em AS ban_em, b.soft AS ban_soft,
            p.*
       FROM players p
       LEFT JOIN accounts a ON lower(a.nick) = lower(p.nick)
       LEFT JOIN account_bans b ON b.account_id = a.id
      WHERE lower(p.nick) = lower($1)`,
    [busca],
  );
  if (!base[0]) throw new Error(`não achei o jogador ${busca}`);
  const j = base[0];
  const playerId = Number(j.id);

  const [pk, totalPk, anuncios, log, origens, pagamentos] = await Promise.all([
    pool.query(
      `SELECT id, species_id, level, shiny, potencia, quality, power, ivs, anuncio_id, caught_at
         FROM player_pokemon WHERE player_id = $1
        ORDER BY (anuncio_id IS NOT NULL) DESC, level DESC, id DESC LIMIT 60`,
      [playerId],
    ),
    pool.query(`SELECT count(*)::int AS n FROM player_pokemon WHERE player_id = $1`, [playerId]),
    pool.query(
      `SELECT id, tipo, item_id, qtd, pokemon_id, ficha, preco, moeda, estado,
              criado_em, fechado_em, comprador
         FROM market_anuncios WHERE vendedor_id = $1
        ORDER BY (estado = 'aberto') DESC, criado_em DESC LIMIT 40`,
      [playerId],
    ),
    pool.query(
      `SELECT criado_em, categoria, acao, detalhe, ref
         FROM player_gameplay_log WHERE player_id = $1
        ORDER BY criado_em DESC LIMIT 60`,
      [playerId],
    ),
    j.conta_id ? origensDaConta(Number(j.conta_id)) : Promise.resolve([]),
    pool.query(
      `SELECT anuncio_id, descricao, valor, bruto, moeda, comprador, criado_em
         FROM market_pagamentos WHERE vendedor_id = $1
        ORDER BY criado_em DESC LIMIT 30`,
      [playerId],
    ),
  ]);

  let online = false;
  try {
    online = !!(await pub.hget(PRESENCA, String(j.nick ?? '').toLowerCase()));
  } catch { /* Redis fora só apaga o indicador */ }

  // A bolsa vem como `{ "<id>": qtd }`. Sem o nome do catálogo ela é ilegível — e "70000: 1"
  // foi literalmente o formato em que a resposta do relato ficou escondida.
  const bolsa = Object.entries(j.items ?? {})
    .map(([id, qtd]) => {
      const item = itens.get(Number(id));
      return {
        itemId: Number(id),
        nome: item?.name ?? `#${id}`,
        categoria: item?.category ?? null,
        icone: item?.icon ?? null,
        npc: Number(item?.npcPrice ?? 0),
        qtd: Number(qtd) || 0,
      };
    })
    .filter((i) => i.qtd > 0)
    .sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome));

  const bolsaBolas = Object.entries(j.balls ?? {})
    .map(([id, qtd]) => ({
      id: Number(id),
      nome: bolaPorId.get(Number(id))?.nome ?? `#${id}`,
      qtd: Number(qtd) || 0,
    }))
    .filter((b) => b.qtd > 0)
    .sort((a, b) => b.qtd - a.qtd);

  return {
    jogador: {
      id: playerId,
      nick: j.nick,
      online,
      level: Number(j.level ?? 0),
      xp: Number(j.xp ?? 0),
      gold: Number(j.gold ?? 0),
      diamonds: Number(j.diamonds ?? 0),
      orbs: Number(j.orbs ?? 0),
      elo: Number(j.elo ?? 0),
      pvp: { abates: Number(j.pvp_abates ?? 0), mortes: Number(j.pvp_mortes ?? 0) },
      bossPoints: Number(j.boss_points ?? 0),
      huntSlug: j.hunt_slug,
      outlandTier: Number(j.outland_tier ?? 1),
      vipAte: Number(j.vip_ate ?? 0),
      fragChaveTotal: Number(j.frag_chave_total ?? 0),
      boosts: j.boosts ?? {},
      automation: j.automation ?? {},
      criadoEm: j.created_at,
      lastSeen: j.last_seen,
    },
    // `completo` é FALSO para quem só tem Resolver Auditoria. O que essa função vê continua
    // sendo tudo o que resolve um ticket — bolsa, depot, anúncios, escrow, log — e some o que
    // resolver ticket não exige e é dado pessoal: e-mail, IP e id de aparelho. Quem precisa
    // desses três para investigar multi-conta é o admin completo, que já tem a aba própria.
    conta: j.conta_id
      ? {
          id: Number(j.conta_id),
          email: completo ? j.email : null,
          emailCanon: completo ? j.email_canon : null,
          emailOculto: !completo,
          provedor: j.provedor,
          emailOk: j.email_ok,
          nickOk: j.nick_ok,
          criadoEm: j.criado_em,
          ultimoLogin: j.ultimo_login,
          banido: !!j.ban_em,
          banSoft: !!j.ban_soft,
          banMotivo: j.ban_motivo,
          banPor: j.ban_por,
          banEm: j.ban_em,
        }
      : null,
    bolsa,
    bolas: bolsaBolas,
    pokemons: {
      total: totalPk.rows[0]?.n ?? 0,
      lista: pk.rows.map((r) => ({
        id: Number(r.id),
        speciesId: Number(r.species_id),
        nome: especies.get(Number(r.species_id))?.name ?? `#${r.species_id}`,
        level: Number(r.level ?? 1),
        shiny: !!r.shiny,
        potencia: Number(r.potencia ?? 1),
        quality: Number(r.quality ?? 1),
        poder: Number(r.power ?? 0),
        ivs: r.ivs ?? {},
        // `anuncio_id` preenchido é pokémon em ESCROW: ele sumiu do depot do jogador porque
        // está num anúncio. Marcar isto na tela evita a próxima pergunta de "sumiu um bicho".
        anuncioId: r.anuncio_id != null ? Number(r.anuncio_id) : null,
        capturadoEm: r.caught_at,
      })),
    },
    anuncios: anuncios.rows.map((r) => ({
      id: Number(r.id),
      tipo: r.tipo,
      itemId: r.item_id != null ? Number(r.item_id) : null,
      nome: r.ficha?.nome ?? (r.item_id ? itens.get(Number(r.item_id))?.name : null) ?? r.tipo,
      // Numa compra parcial o `qtd` da linha é o que SOBROU, não o que foi anunciado — e um
      // anúncio já vendido guarda o tamanho da última fatia. O log de auditoria é quem diz
      // quanto entrou em escrow. Está dito aqui porque foi exatamente essa diferença que fez
      // a tabela e o log parecerem discordar durante a investigação do relato.
      qtd: Number(r.qtd ?? 1),
      preco: Number(r.preco ?? 0),
      moeda: r.moeda,
      estado: r.estado,
      criadoEm: r.criado_em,
      fechadoEm: r.fechado_em,
      comprador: r.comprador,
    })),
    pagamentos: pagamentos.rows.map((r) => ({
      anuncioId: Number(r.anuncio_id),
      descricao: r.descricao,
      valor: Number(r.valor ?? 0),
      bruto: Number(r.bruto ?? 0),
      moeda: r.moeda,
      comprador: r.comprador,
      criadoEm: r.criado_em,
    })),
    origens: completo ? origens : [],
    origensOcultas: !completo,
    log: log.rows.map((r) => ({
      em: r.criado_em,
      categoria: r.categoria,
      acao: r.acao,
      detalhe: r.detalhe,
      ref: r.ref,
    })),
  };
}

/** Zera o progresso do personagem — rankings e inventário, como se nunca tivesse jogado. */
async function zerarProgressoJogador(client, playerId, nick) {
  // `fishing_skill`/`fishing_fish`/`fishing_tier` NÃO entram na lista: a Pesca saiu do jogo e
  // as colunas ficaram só como comprovante do ressarcimento (1 💎 por nível, ver
  // `ressarcirPesca` em `diamantes-db.mjs`). Zerá-las aqui apagaria a prova de quanto cada
  // conta tinha no dia em que o modo foi retirado.
  await client.query(
    `UPDATE players SET
       level = 1, xp = 0, gold = 0,
       hunt_slug = NULL, active_poke = NULL,
       items = '{}'::jsonb, balls = '{}'::jsonb, automation = '{}'::jsonb,
       pokedex = '{}'::jsonb,
       boss_points = 0,
       elo = 1000, pvp_abates = 0, pvp_mortes = 0, pvp_cooldown_ate = 0,
       vip_ate = 0, boosts = '{}'::jsonb, boosts_hoje = '{}'::jsonb,
       bless = NULL, compras_cooldown = '{}'::jsonb,
       last_seen = now()
     WHERE id = $1`,
    [playerId],
  );
  await client.query(`DELETE FROM player_pokemon WHERE player_id = $1`, [playerId]);
  await client.query(`DELETE FROM guilds WHERE owner_id = $1`, [playerId]);
  await client.query(`DELETE FROM guild_members WHERE player_id = $1`, [playerId]);
  await client.query(`DELETE FROM guild_invites WHERE player_id = $1`, [playerId]);
  if (nick) await client.query(`DELETE FROM chat_cargos WHERE lower(nick) = lower($1)`, [nick]);
}

async function contaPorNickOuId({ nick, contaId }) {
  if (contaId) {
    const { rows } = await pool.query(`SELECT * FROM accounts WHERE id = $1`, [contaId]);
    return rows[0] ?? null;
  }
  const pedido = String(nick ?? '').trim();
  if (!pedido) return null;
  const { rows } = await pool.query(
    `SELECT * FROM accounts WHERE lower(nick) = lower($1) OR lower(email) = lower($1)`,
    [pedido],
  );
  return rows[0] ?? null;
}

/**
 * Bane a conta e expulsa se estiver online.
 *
 * `soft: true` — só bloqueia login; progresso intacto (desbanir devolve ao jogo).
 * `soft: false` — zera progresso; diamantes voltam ao total comprado, gemas permanecem
 * no saldo atual (quem sacou não recupera). Desbanir NÃO restaura progresso.
 */
export async function banirUsuario({ email: adminEmail, nick, motivo, soft = false }) {
  const conta = await contaPorNickOuId({ nick });
  if (!conta) throw new Error('conta não encontrada');
  if (ehEmailDeCargo(conta.email)) throw new Error('não dá para banir quem tem cargo no painel');
  if (String(conta.email ?? '').toLowerCase() === String(adminEmail).toLowerCase()) {
    throw new Error('não dá para banir a própria conta');
  }

  const { rows: pj } = await pool.query(
    `SELECT id FROM players WHERE lower(nick) = lower($1)`,
    [conta.nick],
  );
  const playerId = pj[0]?.id ?? null;
  const motivoLimpo = String(motivo ?? '').trim().slice(0, 500) || null;

  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    await cli.query(
      `INSERT INTO account_bans (account_id, motivo, por_email, soft) VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id) DO UPDATE
         SET motivo = EXCLUDED.motivo,
             por_email = EXCLUDED.por_email,
             soft = EXCLUDED.soft,
             criado_em = now()`,
      [conta.id, motivoLimpo, adminEmail, !!soft],
    );
    if (!soft && playerId) {
      await zerarProgressoJogador(cli, playerId, conta.nick);
      await ddb.restaurarCompradosNaTransacao(
        cli,
        playerId,
        `reset beta (ban hard por ${adminEmail})`,
      );
    }
    await cli.query('COMMIT');
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }

  const chave = conta.nick.toLowerCase();
  enviarParaSim(chave, { t: 'admin.ban', playerId: chave });
  await desconectarJogador(chave, {
    t: SERVIDOR.ERRO,
    chave: 'auth.contaBanida',
    msg: motivoLimpo ?? 'Conta banida.',
    motivoBan: motivoLimpo,
  });

  return { ok: true, nick: conta.nick, banido: true, soft: !!soft };
}

// ------------------------------------------- faxina de multi-conta (um clique)

// O `ref` do ledger. Existe para que a soma de tudo o que a faxina moveu saia num
// `WHERE ref = 'multiconta'`, sem depender de ler a nota em texto livre.
const REF_FAXINA = 'multiconta';

/**
 * `enviarParaSim` sem promessa solta.
 *
 * A faxina publica uma mensagem por conta banida, mais duas para a principal. `publicar`
 * devolve a promessa do Redis, e com o Redis fora uma delas rejeitaria sem dono no meio do
 * laço — o que derruba o processo, não só o aviso. Avisar o sim é cortesia (a moeda já está
 * commitada no banco); falhar nisso não pode custar mais que o aviso.
 */
const avisarSim = (alvo, msg) => Promise.resolve(enviarParaSim(alvo, msg)).catch(() => {});

/**
 * O texto que o jogador banido lê. É a única coisa que ele recebe, então diz as duas coisas
 * que importam: qual regra ele bateu, e para onde foi o que era dele.
 *
 * O número sai de `maxContasPorIp()` — muda junto com o teto, e não vira uma promessa velha na
 * tela de quem foi banido depois de a regra mudar. A frase que o CADASTRO recusado mostra é
 * outra (`login.limiteContasIp`, nos três idiomas) e essa sim traz o 4 escrito à mão: mexer em
 * `MAX_CONTAS_POR_IP` pede uma passada nas três traduções.
 */
const motivoDeFaxina = (limite, nick) =>
  `Multi Account (${limite} max por IP) - Diamantes e gemas devolvidos para: ${nick}`;

/**
 * Quem fica e quem cai num aglomerado de multi-conta.
 *
 * ### A ordem
 *
 * `contasDoGrupo` já devolve da mais FORTE para a mais fraca: nível, depois diamante, depois
 * gema, depois coin, e a conta mais VELHA desempata. As primeiras `manter` ficam; o resto cai.
 * É o pedido lido ao pé da letra — "soft ban nas contas mais fracas (menor nível, e que tenha
 * menos diamantes e menos gemas)" — só que expresso pelo outro lado, porque é o lado que não
 * erra: escolher quem FICA garante que sobrem exatamente `manter` contas, e escolher quem cai
 * não garante nada.
 *
 * ### Três grupos que este plano NÃO toca
 *
 * - **admin** — nunca, em hipótese nenhuma, e nem ocupa vaga: a conta da moderação num IP não
 *   pode nem ser banida nem empurrar um jogador para fora da lista dos que ficam.
 * - **já banida** — a punição dela já existe e tem um motivo escrito por alguém. Reescrever
 *   esse motivo com o texto da faxina apagaria a razão do ban original.
 * - **apagada** — não vem em `contasDoGrupo`; não há conta para banir.
 *
 * ### O diamante preso no Mercado
 *
 * Diamante anunciado saiu da carteira e está em escrow (`market_anuncios`), então a
 * transferência não o alcança — ele não está em `players.diamonds`. O plano mostra esse número
 * à parte em vez de fingir que devolveu tudo: a venda do anúncio ainda vai pagar a conta
 * banida, e quem olha precisa saber disso para cancelar o anúncio se quiser.
 */
export async function planoDeFaxina({ tipo = 'ip', chave, manter }) {
  const limite = maxContasPorIp() || 4;
  const todas = await contasDoGrupo({ tipo, chave });
  return montarPlanoDeFaxina({ tipo, chave, manter, limite, todas });
}

/**
 * O plano de UM aglomerado a partir das contas dele — sem ler nada.
 *
 * `vaoCair` (ids de conta) é o que a FAXINA GERAL já decidiu banir num IP anterior da mesma leva:
 * essas contas contam como banidas aqui, exatamente como estarão quando a leva chegar a este IP.
 * É o que faz a prévia geral bater, grupo a grupo, com o que a execução vai recalcular.
 */
function montarPlanoDeFaxina({ tipo, chave, manter, limite, todas, vaoCair = null }) {
  const quantos = Math.max(1, Math.min(50, Math.trunc(Number(manter) || limite)));
  const caiu = (c) => c.banido || !!vaoCair?.has(c.id);

  const protegidas = todas.filter((c) => ehEmailDeCargo(c.email));
  const jaBanidas = todas.filter((c) => !ehEmailDeCargo(c.email) && caiu(c));
  const elegiveis = todas.filter((c) => !ehEmailDeCargo(c.email) && !caiu(c));

  const mantidas = elegiveis.slice(0, quantos);
  const banir = elegiveis.slice(quantos);
  const principal = mantidas[0] ?? null;

  const soma = (lista, campo) => lista.reduce((t, c) => t + (c[campo] ?? 0), 0);

  return {
    tipo,
    chave,
    manter: quantos,
    limite,
    principal,
    mantidas,
    banir,
    jaBanidas,
    protegidas,
    diamantes: soma(banir, 'diamonds'),
    gemas: soma(banir, 'orbs'),
    diamantesPresos: soma(banir, 'diamantesEmAnuncio'),
    // Sem destino com personagem não há para onde mandar a moeda — e aí o certo é não fingir.
    semDestino: !principal?.playerId,
    motivo: principal ? motivoDeFaxina(limite, principal.nick) : null,
  };
}

/**
 * Move a carteira inteira de uma conta para outra, DENTRO da transação que a está banindo.
 *
 * `ajuste_admin` dos dois lados: a soma dos dois deltas é zero, então nada é emitido nem
 * queimado e a auditoria do caixa continua fechando. O efeito colateral que vale escrever é
 * que o diamante chega ao destino como BRINDE (`MOTIVOS_QUE_ENCHEM_A_COTA` não inclui
 * `ajuste_admin`), ou seja, não aumenta a cota de revenda no Mercado de quem recebeu. É o
 * lado certo do arredondamento: o dono do aglomerado recupera o que gastou para usar no jogo,
 * sem ganhar o direito de revender diamante que a faxina juntou para ele.
 */
async function transferirCarteira(cli, deId, paraId, { diamantes, gemas, nota }) {
  const feito = { diamantes: 0, gemas: 0, saldoDiamantes: null, saldoGemas: null };
  if (!deId || !paraId || deId === paraId) return feito;
  if (diamantes > 0) {
    await ddb.movimentarNaTransacao(cli, deId, -diamantes, MOTIVO_DIA.AJUSTE_ADMIN, REF_FAXINA, nota);
    feito.saldoDiamantes = await ddb.movimentarNaTransacao(
      cli, paraId, diamantes, MOTIVO_DIA.AJUSTE_ADMIN, REF_FAXINA, nota,
    );
    feito.diamantes = diamantes;
  }
  if (gemas > 0) {
    await odb.movimentarNaTransacao(cli, deId, -gemas, MOTIVO_ORB.AJUSTE_ADMIN, REF_FAXINA, nota);
    feito.saldoGemas = await odb.movimentarNaTransacao(
      cli, paraId, gemas, MOTIVO_ORB.AJUSTE_ADMIN, REF_FAXINA, nota,
    );
    feito.gemas = gemas;
  }
  return feito;
}

/**
 * Executa a faxina: soft ban nas fracas, carteira delas para a principal.
 *
 * ### O plano é recalculado aqui
 *
 * A lista que a tela mostrou NÃO é obedecida — ela volta só como `esperado`, para ser
 * conferida. Entre a prévia e o clique alguém pode ter subido de nível, comprado diamante ou
 * criado mais uma conta no mesmo IP, e obedecer uma lista velha baniria a conta errada. Se a
 * conferência não bate, nada acontece e a tela recarrega.
 *
 * ### Uma transação por conta, e não uma para todas
 *
 * Banir e esvaziar a carteira de UMA conta é indivisível — é o que impede uma conta banida com
 * a gema presa lá dentro. Mas amarrar as dez numa transação só significaria que um erro na
 * décima desfaria as nove que já deram certo, e a operação inteira viraria tudo-ou-nada por um
 * detalhe de uma conta qualquer. Cada conta fecha a sua; o que falhar entra em `falhas` e o
 * painel mostra.
 */
export async function faxinaDeMulticontas({ email: adminEmail, tipo = 'ip', chave, manter, esperado }) {
  const plano = await planoDeFaxina({ tipo, chave, manter });
  if (!plano.principal) throw new Error('nenhuma conta elegível nesta origem');
  if (!plano.banir.length) throw new Error('nada a fazer — o grupo já está dentro do limite');
  if (plano.semDestino) throw new Error('a conta principal não tem personagem para receber a moeda');

  if (Array.isArray(esperado)) {
    const agora = plano.banir.map((c) => c.nick).join('|').toLowerCase();
    if (esperado.join('|').toLowerCase() !== agora) {
      throw new Error('o grupo mudou desde a prévia — recarregue e confira de novo');
    }
  }

  const motivo = plano.motivo;
  const destinoId = plano.principal.playerId;
  const banidos = [];
  const falhas = [];
  let diamantes = 0;
  let gemas = 0;
  let saldoDiamantes = null;
  let saldoGemas = null;

  for (const conta of plano.banir) {
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');
      await cli.query(
        `INSERT INTO account_bans (account_id, motivo, por_email, soft) VALUES ($1, $2, $3, true)
         ON CONFLICT (account_id) DO UPDATE
           SET motivo = EXCLUDED.motivo, por_email = EXCLUDED.por_email,
               soft = true, criado_em = now()`,
        [conta.id, motivo, adminEmail],
      );
      const movido = await transferirCarteira(cli, conta.playerId, destinoId, {
        diamantes: conta.diamonds,
        gemas: conta.orbs,
        nota: `faxina multi-conta (${conta.nick} → ${plano.principal.nick}) por ${adminEmail}`,
      });
      await cli.query('COMMIT');
      diamantes += movido.diamantes;
      gemas += movido.gemas;
      if (movido.saldoDiamantes != null) saldoDiamantes = movido.saldoDiamantes;
      if (movido.saldoGemas != null) saldoGemas = movido.saldoGemas;
      banidos.push({
        nick: conta.nick,
        level: conta.level,
        diamantes: movido.diamantes,
        gemas: movido.gemas,
        diamantesPresos: conta.diamantesEmAnuncio,
      });
    } catch (err) {
      await cli.query('ROLLBACK').catch(() => {});
      falhas.push({ nick: conta.nick, erro: err.message });
    } finally {
      cli.release();
    }
  }

  // Expulsar vem DEPOIS do COMMIT, e fora da transação: derrubar o socket é efeito no mundo, e
  // um `ROLLBACK` não desfaz jogador chutado.
  for (const b of banidos) {
    const alvo = b.nick.toLowerCase();
    avisarSim(alvo, { t: 'admin.ban', playerId: alvo });
    await desconectarJogador(alvo, {
      t: SERVIDOR.ERRO,
      chave: 'auth.contaBanida',
      msg: motivo,
      motivoBan: motivo,
    }).catch(() => {});
  }

  // A principal pode estar jogando agora. Sem isto, a moeda chega ao banco e a tela dela só
  // enxerga na próxima entrada — e o dono lê como "sumiu".
  const destino = plano.principal.nick.toLowerCase();
  if (saldoDiamantes != null) {
    avisarSim(destino, { t: 'admin.diamantes', playerId: destino, saldo: saldoDiamantes, qtd: diamantes });
  }
  if (saldoGemas != null) {
    avisarSim(destino, { t: 'admin.gemas', playerId: destino, saldo: saldoGemas });
  }

  return {
    ok: true,
    tipo,
    chave,
    principal: plano.principal.nick,
    motivo,
    banidos,
    falhas,
    diamantes,
    gemas,
    diamantesPresos: plano.diamantesPresos,
    mantidas: plano.mantidas.map((c) => c.nick),
  };
}

// ------------------------------------------------------------- faxina GERAL (todos os IPs)

/** Quantos IPs uma leva da faxina geral visita. O resto fica para o próximo clique. */
const FAXINA_GERAL_MAX_GRUPOS = 150;

/**
 * A PRÉVIA da faxina geral: o plano de cada IP acima do teto e fora da whitelist, na ordem em que
 * a execução vai rodar.
 *
 * Os planos são montados EM SEQUÊNCIA, e não cada um por si: uma conta costuma aparecer em mais
 * de um IP (casa, trabalho, 4G), e quem cai no primeiro já não conta no segundo — é o que a
 * execução vai encontrar no banco quando chegar lá. Montar cada um isolado mostraria a mesma
 * conta caindo duas vezes e a conferência da execução recusaria o segundo grupo.
 *
 * Só IP: a whitelist é de rede, e o pedido é "todos que não estão na whitelist". Os aglomerados
 * por aparelho seguem na faxina de linha, um de cada vez.
 */
export async function planoDeFaxinaGeral({ prefixo = null } = {}) {
  const limite = maxContasPorIp() || 4;
  const { grupos, cortado } = await origensAcimaDoTeto(limite, { prefixo, max: FAXINA_GERAL_MAX_GRUPOS });
  const vaoCair = new Set();
  const planos = [];
  for (const g of grupos) {
    const todas = await contasDoGrupo({ tipo: 'ip', chave: g.chave });
    const plano = montarPlanoDeFaxina({ tipo: 'ip', chave: g.chave, manter: limite, limite, todas, vaoCair });
    if (!plano.banir.length) continue;
    for (const c of plano.banir) vaoCair.add(c.id);
    planos.push(plano);
  }
  const soma = (campo) => planos.reduce((t, p) => t + (p[campo] ?? 0), 0);
  const enxuta = (c) => ({ nick: c.nick, level: c.level, diamonds: c.diamonds, orbs: c.orbs });
  return {
    limite,
    cortado,
    maxGrupos: FAXINA_GERAL_MAX_GRUPOS,
    grupos: planos.map((p) => ({
      chave: p.chave,
      principal: p.principal ? enxuta(p.principal) : null,
      mantidas: p.mantidas.map((c) => c.nick),
      banir: p.banir.map(enxuta),
      diamantes: p.diamantes,
      gemas: p.gemas,
      diamantesPresos: p.diamantesPresos,
      semDestino: p.semDestino,
    })),
    banir: vaoCair.size,
    diamantes: soma('diamantes'),
    gemas: soma('gemas'),
    diamantesPresos: soma('diamantesPresos'),
  };
}

/**
 * Executa a faxina geral: a faxina de linha (`faxinaDeMulticontas`), IP por IP, na ordem da prévia.
 *
 * `esperado` é a prévia que a tela mostrou — `[{ chave, banir: [nick] }]` — e é ela que manda na
 * LISTA de IPs: nada fora dela é tocado, mesmo que um IP novo tenha passado do teto no meio do
 * caminho (ele aparece na próxima prévia). Cada IP é recalculado e conferido pela faxina de linha;
 * o que mudou desde a prévia, entrou na whitelist ou não tem para onde mandar a moeda é PULADO e
 * volta na resposta com o motivo, sem parar os outros.
 */
export async function faxinaGeral({ email, esperado, prefixo = null }) {
  if (!Array.isArray(esperado) || !esperado.length) throw new Error('prévia ausente — monte a prévia de novo');
  const pedidos = esperado.slice(0, FAXINA_GERAL_MAX_GRUPOS).map((g) => ({
    chave: String(g?.chave ?? '').trim(),
    banir: Array.isArray(g?.banir) ? g.banir.map(String) : [],
  })).filter((g) => g.chave && g.banir.length && (!prefixo || g.chave.startsWith(prefixo)));

  const feitos = [];
  const pulados = [];
  for (const g of pedidos) {
    try {
      if (await ipNaWhitelist(g.chave)) {
        pulados.push({ chave: g.chave, erro: 'entrou na whitelist depois da prévia' });
        continue;
      }
      const r = await faxinaDeMulticontas({ email, tipo: 'ip', chave: g.chave, esperado: g.banir });
      feitos.push(r);
    } catch (err) {
      pulados.push({ chave: g.chave, erro: err.message });
    }
  }
  return {
    ok: true,
    grupos: feitos.length,
    banidos: feitos.reduce((t, r) => t + r.banidos.length, 0),
    diamantes: feitos.reduce((t, r) => t + r.diamantes, 0),
    gemas: feitos.reduce((t, r) => t + r.gemas, 0),
    diamantesPresos: feitos.reduce((t, r) => t + (r.diamantesPresos ?? 0), 0),
    feitos: feitos.map((r) => ({
      chave: r.chave,
      principal: r.principal,
      banidos: r.banidos.map((b) => b.nick),
      diamantes: r.diamantes,
      gemas: r.gemas,
      falhas: r.falhas,
    })),
    pulados,
    falhas: feitos.flatMap((r) => r.falhas.map((f) => ({ chave: r.chave, ...f }))),
  };
}

/** Remove o ban. Progresso zerado por ban hard NÃO volta. */
export async function desbanirUsuario({ nick }) {
  const conta = await contaPorNickOuId({ nick });
  if (!conta) throw new Error('conta não encontrada');
  const { rows } = await pool.query(
    `DELETE FROM account_bans WHERE account_id = $1 RETURNING soft`,
    [conta.id],
  );
  if (!rows.length) throw new Error('conta não está banida');
  return { ok: true, nick: conta.nick, banido: false, eraSoft: !!rows[0].soft };
}

/**
 * Apaga conta e personagem de forma permanente (pedido LGPD / exclusão).
 * Remove login, e-mail, progresso e rankings. Não é reversível — diferente do ban.
 */
export async function apagarConta({ email: adminEmail, nick }) {
  const conta = await contaPorNickOuId({ nick });
  if (!conta) throw new Error('conta não encontrada');
  if (ehEmailDeCargo(conta.email)) throw new Error('não dá para apagar quem tem cargo no painel');
  if (String(conta.email ?? '').toLowerCase() === String(adminEmail).toLowerCase()) {
    throw new Error('não dá para apagar a própria conta');
  }

  return executarExclusaoConta(conta);
}

/** Define o saldo de coins (gold) de um jogador — valor absoluto, não delta. */
export async function definirCoinsUsuario({ email, nick, gold }) {
  const pedido = String(nick ?? '').trim();
  if (!pedido) throw new Error('nick obrigatório');
  const valor = Math.floor(Number(gold));
  if (!Number.isFinite(valor) || valor < 0) throw new Error('valor inválido');
  if (valor > 9_007_199_254_740_991) throw new Error('valor grande demais');

  const { rows } = await pool.query(
    `SELECT id, nick, gold FROM players WHERE lower(nick) = lower($1)`,
    [pedido],
  );
  if (!rows[0]) throw new Error('jogador não encontrado');

  const playerId = Number(rows[0].id);
  const canon = rows[0].nick;
  const anterior = Number(rows[0].gold);

  const { rows: upd } = await pool.query(
    `UPDATE players SET gold = $2, last_seen = now() WHERE id = $1 RETURNING gold`,
    [playerId, valor],
  );
  const novo = Number(upd[0].gold);

  const delta = Math.abs(novo - anterior);
  if (novo >= LIMITE_COINS_AUDIT || delta >= LIMITE_COINS_AUDIT) {
    registrarCoinGrande({
      playerId,
      nick: canon,
      valor: delta >= LIMITE_COINS_AUDIT ? delta : novo,
      saldoApos: novo,
      origem: 'admin',
      detalhe: `${anterior.toLocaleString('pt-BR')} → ${novo.toLocaleString('pt-BR')} (${email})`,
    });
  }

  enviarParaSim(canon.toLowerCase(), {
    t: 'admin.gold',
    playerId: canon.toLowerCase(),
    gold: novo,
  });

  return { ok: true, nick: canon, gold: novo, anterior, por: email };
}

/**
 * O endereço é de quem tem cargo no painel — pelo texto exato OU pela mesma caixa.
 *
 * `ehAdmin` compara o texto exato, e é isso que dá o cargo. A caixa entra só aqui: um jogador
 * com `fasi.contato@gmail.com` não vira admin, mas receberia na caixa do admin tudo o que o
 * jogo mandar para ele — e não há motivo para o painel permitir isso.
 *
 * Também é o escudo de BAN, EXCLUSÃO e FAXINA: nenhuma conta com cargo cai por clique de
 * dentro do painel. Isso passou a importar quando o cargo Resolver Auditoria ganhou a aba
 * Usuários e a Multi-contas — sem o escudo, um resolvedor poderia banir o outro, e a faxina
 * geral derrubaria a conta de um colega junto com um aglomerado. A regra é a mesma da troca
 * de e-mail logo abaixo: **quem tira cargo de alguém é o `.env`, não o botão.** Para banir um
 * resolvedor de verdade, tire o endereço de `AUDITORIA_RESOLVER_EMAILS` e reinicie primeiro.
 */
function ehEmailDeCargo(email) {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e) return false;
  if (ehAdmin(e) || ehResolverAuditoria(e)) return true;
  const caixa = emailCanonico(e);
  if (!caixa) return false;
  return [...ADMINS, ...RESOLVER_AUDITORIA].some((x) => emailCanonico(x) === caixa);
}

/** O que o jogador leria em `i18n.mjs`, dito para quem está no painel. */
const ERRO_TROCA_EMAIL = {
  'login.emailInvalido': 'e-mail novo inválido',
  'login.emailDominio': `domínio fora da whitelist — só ${DOMINIOS_EMAIL_CADASTRO.join(', ')}`,
  'login.emailEmUso': 'esse e-mail já é de outra conta',
  'login.emailMesmaCaixa': 'esse endereço cai na mesma caixa de outra conta (ponto ou +apelido)',
  'conta.emailIgual': 'a conta já usa esse e-mail',
  'login.falhou': 'conta não encontrada',
};

/**
 * Troca o e-mail de login de um jogador — para quem se cadastrou antes da whitelist de domínios
 * e hoje não entra mais. A troca em si (travas do endereço, tokens, sessões) é
 * `auth.trocarEmailPeloSuporte`; aqui fica só o que é do painel.
 *
 * Cargo do painel vem do e-mail (`ADMIN_EMAILS`, `AUDITORIA_RESOLVER_EMAILS`), então as duas
 * pontas são recusadas: trocar o e-mail de quem tem cargo tiraria o cargo, e trocar o e-mail de
 * um jogador PARA um desses endereços daria o cargo a ele. Mexer em cargo é pelo `.env`.
 */
export async function trocarEmailUsuario({ email: adminEmail, nick, novoEmail }) {
  const pedido = String(nick ?? '').trim();
  if (!pedido) throw new Error('conta não encontrada');
  // `contaPorNickOuId` devolve a primeira que casar — e contas antigas podem repetir o e-mail
  // trocando só maiúsculas. Aqui a troca tem de cair na conta que o admin conferiu, então
  // ambiguidade é recusa, não sorteio.
  const { rows: achadas } = await pool.query(
    `SELECT * FROM accounts WHERE lower(nick) = lower($1) OR lower(email) = lower($1) LIMIT 2`,
    [pedido],
  );
  if (!achadas.length) throw new Error('conta não encontrada');
  if (achadas.length > 1) throw new Error('mais de uma conta com esse e-mail — use o nick');
  const conta = achadas[0];
  if (ehEmailDeCargo(conta.email)) {
    throw new Error('essa conta tem cargo no painel — o e-mail dela se troca pelo .env');
  }
  const novo = String(novoEmail ?? '').trim().toLowerCase();
  if (ehEmailDeCargo(novo)) {
    throw new Error('esse e-mail é (ou cai na mesma caixa de) um cargo do painel — não pode ir para a conta de um jogador');
  }

  let r;
  try {
    r = await trocarEmailPeloSuporte({ contaId: conta.id, novoEmail: novo });
  } catch (err) {
    throw new Error(ERRO_TROCA_EMAIL[err.chave] ?? err.message);
  }

  const { rows: pj } = await pool.query(
    `SELECT id FROM players WHERE lower(nick) = lower($1)`,
    [r.nick],
  );
  registrarAcaoJogador({
    playerId: pj[0]?.id,
    nick: r.nick,
    categoria: 'conta',
    acao: 'email_admin',
    detalhe: `${r.anterior ?? '(sem e-mail)'} → ${r.email} (por ${adminEmail})`,
  });

  return { ok: true, ...r, por: adminEmail };
}

// ------------------------------------------------------------------- fiat

/**
 * Diamantes: o que entrou por PIX e cartão.
 *
 * `centavos` é inteiro em BRL — dinheiro em ponto flutuante é como se perde um centavo por
 * transação até alguém notar. A divisão por 100 acontece só na hora de mostrar.
 */
async function numerosDeFiat() {
  const { rows } = await pool.query(`
    SELECT metodo, provedor, count(*)::int AS n, COALESCE(SUM(centavos),0)::bigint AS centavos
      FROM diamante_pagamentos
     WHERE status = 'pago'
     GROUP BY metodo, provedor
     ORDER BY centavos DESC`);

  // `emitidos` e `gastos` ignoram os motivos de MERCADO (ver `MOTIVOS_TRANSFERENCIA_DIA`);
  // `circulando` não precisa, porque os três somam zero.
  const { rows: dia } = await pool.query(`
    SELECT COALESCE(SUM(delta) FILTER (WHERE delta > 0 AND NOT (motivo = ANY($1::text[]))), 0)::bigint AS emitidos,
           COALESCE(-SUM(delta) FILTER (WHERE delta < 0 AND NOT (motivo = ANY($1::text[]))), 0)::bigint AS gastos,
           COALESCE(SUM(delta), 0)::bigint AS circulando
      FROM diamante_ledger`, [MOTIVOS_TRANSFERENCIA_DIA]);

  const { rows: recentes } = await pool.query(`
    SELECT nick, metodo, provedor, qtd, centavos,
           COALESCE(pago_em, criado_em) AS em
      FROM diamante_pagamentos
     WHERE status = 'pago'
     ORDER BY COALESCE(pago_em, criado_em) DESC
     LIMIT 40`);

  const porMetodo = rows.map((r) => {
    const centavos = Number(r.centavos);
    const liquidoCentavos = liquidoPagamentoCentavos(centavos, { metodo: r.metodo, provedor: r.provedor });
    return {
      metodo: r.metodo,
      provedor: r.provedor,
      pagamentos: r.n,
      centavos,
      liquidoCentavos,
      taxaCentavos: centavos - liquidoCentavos,
    };
  });

  const totalCentavos = porMetodo.reduce((s, r) => s + r.centavos, 0);
  const totalLiquidoCentavos = porMetodo.reduce((s, r) => s + r.liquidoCentavos, 0);

  return {
    porMetodo,
    totalCentavos,
    totalLiquidoCentavos,
    totalTaxaCentavos: totalCentavos - totalLiquidoCentavos,
    recentes: recentes.map((r) => {
      const centavos = Number(r.centavos);
      const liquidoCentavos = liquidoPagamentoCentavos(centavos, { metodo: r.metodo, provedor: r.provedor });
      return {
        nick: r.nick,
        metodo: r.metodo,
        provedor: r.provedor,
        qtd: Number(r.qtd),
        centavos,
        liquidoCentavos,
        em: r.em,
      };
    }),
    diamantes: {
      emitidos: Number(dia[0].emitidos),
      gastos: Number(dia[0].gastos),
      circulando: Number(dia[0].circulando),
    },
  };
}

// ----------------------------------------------------------------- crypto

/**
 * Gemas: caixa, passivo e sobra.
 *
 * O caixa usado é o MENOR entre o contábil e o que está de fato na carteira on-chain. Os dois
 * divergem por motivo legítimo — depósito que ainda não foi varrido está no endereço do
 * jogador, não na tesouraria — e mandar o número contábil para a tela faria o painel oferecer
 * dinheiro que não dá para transferir. Na dúvida, o menor.
 */
async function numerosDeCrypto() {
  const [c, gemasAfiliadoPendentes] = await Promise.all([
    odb.numerosDoCaixa(),
    totalGemasComissaoPendentes(),
  ]);
  const contabil = c.compradoUsdt - c.sacadoUsdt;
  const orbsPassivoTotal = c.orbsEmCirculacao + gemasAfiliadoPendentes;
  const passivo = orbsPassivoTotal * PRECO_SAQUE;

  let naCarteira = null;
  try {
    const endereco = env.CARTEIRA_PROJETO;
    if (endereco) naCarteira = await aChain().saldoUsdt(endereco);
  } catch {
    // Um RPC fora do ar não pode derrubar o painel inteiro: os números contábeis continuam
    // valendo, e a sobra some (sem saber o saldo real, não se oferece transferência).
    naCarteira = null;
  }

  const caixa = naCarteira === null ? contabil : Math.min(contabil, naCarteira);
  const lucro = caixa - passivo;
  const sobra = Math.max(0, caixa - passivo * COLCHAO);

  return {
    compradoUsdt: c.compradoUsdt,
    sacadoUsdt: c.sacadoUsdt,
    orbsEmCirculacao: c.orbsEmCirculacao,
    gemasAfiliadoPendentes,
    orbsPassivoTotal,
    contabil,
    naCarteira,
    caixa,
    passivo,
    lucro,
    colchao: COLCHAO,
    // Sem saldo on-chain confirmado não se oferece botão nenhum — ver o `catch` acima.
    sobra: naCarteira === null ? 0 : sobra,
    precoSaque: PRECO_SAQUE,
  };
}

export async function painel() {
  const [fiat, crypto, cargos] = await Promise.all([
    numerosDeFiat(),
    numerosDeCrypto(),
    listarCargos(),
  ]);
  return {
    fiat,
    crypto,
    carteiras: carteirasDeLucro(),
    cargos,
    varredura: {
      disponivel: !!(env.CHAIN_REDE && temSeed() && env.CARTEIRA_PROJETO),
    },
  };
}

// ----------------------------------------------------------- tags do chat

/** Tag de chat atribuída pelo painel, ou `null`. Admin continua vindo de `ADMIN_EMAILS`. */
export async function cargoPorNick(nick) {
  if (!nick) return null;
  const { rows } = await pool.query(
    `SELECT cargo FROM chat_cargos WHERE lower(nick) = lower($1)`,
    [nick],
  );
  const c = rows[0]?.cargo;
  return CARGOS_CHAT.includes(c) ? c : null;
}

export async function listarCargos() {
  const { rows } = await pool.query(
    `SELECT nick, cargo, por_email, criado_em
       FROM chat_cargos ORDER BY criado_em DESC`,
  );
  return rows.map((r) => ({
    nick: r.nick,
    cargo: r.cargo,
    por: r.por_email,
    em: r.criado_em,
  }));
}

export async function definirCargo({ email, nick, cargo }) {
  if (!CARGOS_CHAT.includes(cargo)) throw new Error('tag inválida');
  const pedido = String(nick ?? '').trim();
  if (!pedido) throw new Error('nick obrigatório');
  const { rows } = await pool.query(
    `SELECT nick FROM players WHERE lower(nick) = lower($1)`,
    [pedido],
  );
  if (!rows[0]) throw new Error('jogador não encontrado');
  const canon = rows[0].nick;
  await pool.query(
    `INSERT INTO chat_cargos (nick, cargo, por_email) VALUES ($1, $2, $3)
     ON CONFLICT (nick) DO UPDATE
       SET cargo = EXCLUDED.cargo, por_email = EXCLUDED.por_email, criado_em = now()`,
    [canon, cargo, email],
  );
  return { ok: true, nick: canon, cargo };
}

export async function removerCargo({ nick }) {
  const pedido = String(nick ?? '').trim();
  if (!pedido) throw new Error('nick obrigatório');
  const { rowCount } = await pool.query(
    `DELETE FROM chat_cargos WHERE lower(nick) = lower($1)`,
    [pedido],
  );
  if (!rowCount) throw new Error('tag não encontrada');
  return { ok: true };
}

/** Lista mutes de chat ainda vigentes (Redis). */
export async function listarMutesAtivos() {
  return listarMutesChat();
}

/** Revoga mute antes da hora e avisa o jogador online, se houver. */
export async function revogarMute({ email, nick }) {
  const pedido = String(nick ?? '').trim();
  if (!pedido) throw new Error('nick obrigatório');
  const r = await revogarMuteChat(pedido);
  if (!r.ok) throw new Error('jogador não está mutado');
  const gw = await gatewayDoJogador(r.nick);
  if (gw) {
    publicar(canalGateway(gw), {
      para: String(r.nick).toLowerCase(),
      msg: { t: SERVIDOR.CHAT_MUTE, ate: 0 },
    });
  }
  console.log(`[admin] ${email} revogou mute de ${r.nick}`);
  return { ok: true, nick: r.nick };
}

/** Troca de nick na loja: a tag segue o personagem. */
export async function renomearCargoChat(nickAntigo, nickNovo) {
  if (!nickAntigo || !nickNovo) return;
  await pool.query(
    `UPDATE chat_cargos SET nick = $2 WHERE lower(nick) = lower($1)`,
    [nickAntigo, nickNovo],
  );
}

/** Ajuste manual de diamantes — uso interno; a tela pública é Resolver Auditoria. */
export async function creditarDiamantes({ email, nick, qtd }) {
  const pedido = String(nick ?? '').trim();
  if (!pedido) throw new Error('nick obrigatório');
  const q = Number(qtd);
  if (!Number.isInteger(q) || q === 0) throw new Error('quantidade inválida');
  const { rows } = await pool.query(
    `SELECT id, nick FROM players WHERE lower(nick) = lower($1)`,
    [pedido],
  );
  if (!rows[0]) throw new Error('jogador não encontrado');
  const playerId = Number(rows[0].id);
  const canon = rows[0].nick;
  const verbo = q > 0 ? 'crédito' : 'débito';
  const { saldo } = await ddb.creditarAdmin({
    playerId,
    qtd: q,
    nota: `${verbo} manual por ${email}`,
  });
  enviarParaSim(canon.toLowerCase(), {
    t: 'admin.diamantes',
    playerId: canon.toLowerCase(),
    saldo,
    qtd: q,
  });
  return { ok: true, nick: canon, qtd: q, saldo };
}

// ------------------------------------------------------ resolver auditoria

async function ajustarItemNoBanco(playerId, itemId, delta) {
  const id = Number(itemId);
  const d = Number(delta);
  if (!id || !Number.isInteger(d) || d === 0) throw new Error('ajuste de item inválido');
  if (d > 0) {
    await creditarItemNoBanco(playerId, id, d);
    return;
  }
  const chave = String(id);
  const { rows } = await pool.query(`SELECT items FROM players WHERE id = $1`, [playerId]);
  if (!rows[0]) throw new Error('jogador não encontrado');
  const atual = Number(rows[0].items?.[chave] ?? 0);
  const novo = atual + d;
  if (novo < 0) throw new Error('saldo insuficiente do item');
  if (novo === 0) {
    await pool.query(`UPDATE players SET items = items - $2 WHERE id = $1`, [playerId, chave]);
  } else {
    await pool.query(
      `UPDATE players SET items = jsonb_set(items, ARRAY[$2::text], to_jsonb($3::bigint), true) WHERE id = $1`,
      [playerId, chave, novo],
    );
  }
}

/** Catálogo para o select da tela — diamantes primeiro, depois itens por nome. */
export function catalogoResolverAuditoria() {
  const lista = [...itens.values()]
    .map((i) => ({ id: i.id, nome: i.name }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return [{ id: RESOLVER_ITEM_DIAMANTES, nome: 'Diamantes' }, ...lista];
}

export async function listarHistoricoResolverAuditoria(limite = 80) {
  const lim = Math.min(Math.max(Number(limite) || 80, 1), 200);
  const { rows } = await pool.query(
    `SELECT por_email, player_nick, item_id, item_nome, qtd, criado_em
       FROM admin_resolver_log
      ORDER BY id DESC
      LIMIT $1`,
    [lim],
  );
  return rows.map((r) => ({
    por: r.por_email,
    nick: r.player_nick,
    itemId: Number(r.item_id),
    itemNome: r.item_nome,
    qtd: Number(r.qtd),
    em: r.criado_em,
  }));
}

/**
 * Entrega item ou diamante a um jogador — só quem está em `AUDITORIA_RESOLVER_EMAILS`.
 * Tudo fica em `admin_resolver_log`.
 */
export async function resolverAuditoriaEntregar({ email, nick, itemId, qtd }) {
  const pedido = String(nick ?? '').trim();
  if (!pedido) throw new Error('nick obrigatório');
  const q = Number(qtd);
  if (!Number.isInteger(q) || q === 0) throw new Error('quantidade inválida');
  if (Math.abs(q) > 1_000_000) throw new Error('quantidade grande demais');

  const idItem = Number(itemId);
  if (!Number.isFinite(idItem) || idItem < 0) throw new Error('item inválido');

  const { rows } = await pool.query(
    `SELECT id, nick FROM players WHERE lower(nick) = lower($1)`,
    [pedido],
  );
  if (!rows[0]) throw new Error('jogador não encontrado');
  const playerId = Number(rows[0].id);
  const canon = rows[0].nick;

  let itemNome;
  let saldoApos = null;

  if (idItem === RESOLVER_ITEM_DIAMANTES) {
    itemNome = 'Diamantes';
    const verbo = q > 0 ? 'crédito' : 'débito';
    const { saldo } = await ddb.creditarAdmin({
      playerId,
      qtd: q,
      nota: `Resolver Auditoria · ${verbo} por ${email}`,
    });
    saldoApos = saldo;
    enviarParaSim(canon.toLowerCase(), {
      t: 'admin.diamantes',
      playerId: canon.toLowerCase(),
      saldo,
      qtd: q,
    });
  } else {
    const item = itens.get(idItem);
    if (!item) throw new Error('item não encontrado no catálogo');
    itemNome = item.name;
    await ajustarItemNoBanco(playerId, idItem, q);
    enviarParaSim(canon.toLowerCase(), {
      t: 'admin.items',
      playerId: canon.toLowerCase(),
      items: { [idItem]: q },
    });
  }

  await pool.query(
    `INSERT INTO admin_resolver_log (por_email, player_id, player_nick, item_id, item_nome, qtd)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [String(email ?? '').toLowerCase(), playerId, canon, idItem, itemNome, q],
  );

  return { ok: true, nick: canon, itemId: idItem, itemNome, qtd: q, saldoApos };
}

// --------------------------------------------------------------- eventos
//
// O buff que vale para TODO MUNDO ao mesmo tempo: XP do treinador, XP do pokémon e farm, por
// um punhado de minutos. É a alavanca de temporada — fim de semana dobrado, compensação por
// queda do servidor, comemoração de marco.
//
// O caminho é sempre o mesmo: grava no banco (verdade) e avisa no Redis (velocidade). Os sims
// escutam `CANAL_EVENTO`, trocam o multiplicador em memória e mandam a faixa para a tela dos
// jogadores deles. Nenhum deles consulta o banco — no tick, buff é multiplicação, não query.

/** Liga o evento para o mundo inteiro. Substitui o que estiver em andamento. */
export async function criarEvento({ email, xpTreinadorPct, xpPokemonPct, farmPct, minutos }) {
  const ev = await edb.criarEvento({
    xpTreinadorPct,
    xpPokemonPct,
    farmPct,
    minutos,
    criadoPor: email,
  });
  publicar(CANAL_EVENTO, { evento: ev });
  return ev;
}

/** Corta o evento em andamento. Silencioso quando não há nenhum — não é erro. */
export async function encerrarEvento({ email }) {
  const ev = await edb.encerrarEvento(email);
  publicar(CANAL_EVENTO, { evento: null });
  return { ok: true, encerrado: ev };
}

/** O que a seção EVENTOS do painel desenha: o que vale agora, a agenda e o histórico. */
export async function estadoDosEventos(limite = 20) {
  const [vigente, historico, agenda] = await Promise.all([
    edb.eventoVigente(),
    edb.listarEventos(limite),
    edb.listarAgendas(),
  ]);
  return { vigente, historico, agenda };
}

// ------------------------------------------------------- eventos que se repetem
//
// A agenda semanal. O painel escreve a REGRA ("toda sexta, 12h, 15/15/5 por 720 min") e o
// tique abaixo é quem a transforma em evento, pelo mesmo caminho do botão: grava no banco e
// publica no Redis. Nada de um segundo mecanismo de buff — o dia em que a regra mudasse, só
// um dos dois teria sido corrigido.

export const criarAgendaDeEvento = ({ email, ...regra }) => edb.criarAgenda({ ...regra, criadoPor: email });
export const listarAgendaDeEventos = () => edb.listarAgendas();
export const removerAgendaDeEvento = (id) => edb.removerAgenda(id);
export const alternarAgendaDeEvento = (id, ativa) => edb.alternarAgenda(id, ativa);

/**
 * Liga o que a agenda mandava ligar agora. Chamado pelo tique do gateway, a cada minuto.
 *
 * Um evento automático SUBSTITUI o que estiver no ar, como o botão faz — a regra "só existe
 * um evento por vez" continua sendo uma só. É também a escolha menos surpreendente: o evento
 * da agenda é o que foi anunciado para a comunidade, e ele não pode faltar porque alguém
 * deixou um teste de 10 minutos ligado às 11h58.
 */
export async function dispararAgendaDeEventos() {
  const vencidas = await edb.reivindicarAgendasVencidas();
  const ligados = [];
  for (const regra of vencidas) {
    try {
      const ev = await criarEvento({
        email: `agenda#${regra.id}`,
        xpTreinadorPct: regra.xpTreinadorPct,
        xpPokemonPct: regra.xpPokemonPct,
        farmPct: regra.farmPct,
        minutos: regra.minutos,
      });
      ligados.push({ regra, evento: ev });
      console.log(
        `[eventos] agenda #${regra.id} ligou: treinador +${regra.xpTreinadorPct}%, ` +
          `pokémon +${regra.xpPokemonPct}%, farm +${regra.farmPct}%, ${regra.minutos} min`,
      );
    } catch (err) {
      // A ocorrência já foi marcada, e não volta atrás: ver a nota em `reivindicarAgendasVencidas`.
      console.error(`[eventos] agenda #${regra.id} falhou:`, err.message);
    }
  }
  return ligados;
}

// ----------------------------------------------------------------- guilds
//
// Moderação de NOME. A guild é conteúdo escrito por jogador que aparece para todo mundo —
// no ranking, no chat da guerra, no placar do dia — e é por isso que ela precisa de um botão
// de apagar aqui: um nome racista não espera o dono resolver apagar sozinho.
//
// Quem faz o trabalho sujo é `apagarGuildPorAdmin` (inclusive tirar o nome do histórico das
// guerras). Aqui em cima ficam só as duas coisas que o banco não sabe fazer: avisar os sims,
// para que os membros online percam a guild na hora, e deixar o rastro no log.

export const listarGuilds = (filtro) => gdb.listarGuildsAdmin(filtro ?? {});

export async function apagarGuild({ email, id }) {
  const apagada = await gdb.apagarGuildPorAdmin(id, { por: email });
  // Todo sim, não só o dono do shard: os membros estão espalhados (ver `CANAL_GUILD`).
  publicar(CANAL_GUILD, { apagada: apagada.id });
  console.log(
    `[admin] ${email} apagou a guild #${apagada.id} "${apagada.nome}" ` +
      `(dono ${apagada.ownerNick ?? '—'}, ${apagada.membros.length} membro(s))`,
  );
  return apagada;
}

// ---------------------------------------------------------- contagem online
//
// Acréscimos manuais somados ao HLEN de `presenca` no `/saude`. Cada clique do admin cria uma
// linha removível; a soma de todas alimenta o número que os jogadores veem no painel do treinador.

async function avisarOnlineExtra() {
  const extras = await oxdb.listar();
  definirExtras(extras);
  publicar(CANAL_ONLINE_EXTRA, { extras });
  return extras;
}

/** Estado da seção CONTAGEM ONLINE: real, exibido e cada incremento ativo. */
export async function estadoContagemOnline() {
  const [onlineReal, extras] = await Promise.all([
    contarOnline().catch(() => -1),
    oxdb.listar(),
  ]);
  const totalExtra = extras.reduce((s, e) => s + e.qtd, 0);
  return {
    onlineReal,
    onlineExibido: onlineReal >= 0 ? onlineReal + totalExtra : onlineReal,
    totalExtra,
    extras,
  };
}

export async function adicionarContagemOnline({ email, qtd }) {
  const item = await oxdb.adicionar({ qtd, criadoPor: email });
  await avisarOnlineExtra();
  console.log(`[admin] ${email} adicionou +${item.qtd} na contagem online (id ${item.id})`);
  return item;
}

export async function removerContagemOnline({ email, id }) {
  const removido = await oxdb.remover(id);
  if (!removido) throw new Error('incremento não encontrado');
  await avisarOnlineExtra();
  console.log(`[admin] ${email} removeu +${removido.qtd} da contagem online (id ${removido.id})`);
  return removido;
}

export async function removerTodasContagensOnline({ email }) {
  const removidos = await oxdb.removerTodos();
  await avisarOnlineExtra();
  if (removidos.length) {
    const total = removidos.reduce((s, e) => s + e.qtd, 0);
    console.log(`[admin] ${email} removeu todos os acréscimos da contagem online (${removidos.length} item(ns), +${total})`);
  }
  return {
    removidos: removidos.length,
    totalExtra: removidos.reduce((s, e) => s + e.qtd, 0),
  };
}

// ---------------------------------------------------------- gemas (admin)

export async function listarSaquesAguardandoAprovacao(opts) {
  return odb.listarSaquesAguardandoAprovacao(opts);
}

/**
 * Aprova um saque de gemas — e recusa o de quem está aprovando.
 *
 * Aprovar não é um carimbo: move o saque de AGUARDANDO para PENDENTE, e PENDENTE é o que o
 * `orbs-worker` varre para **assinar a transferência de USDT on-chain**. Não existe terceiro
 * passo, nem confirmação humana depois — quem aprova é quem manda o dinheiro sair.
 *
 * É por isso que a aba existe: ela é a SEGUNDA camada do saque. Uma segunda camada que a
 * mesma pessoa pode operar sobre o próprio pedido não é camada nenhuma. Sem esta checagem, o
 * caminho é de dois cliques: pedir o saque no jogo, aprová-lo no painel, e o worker paga.
 *
 * Vale para os dois cargos, inclusive o admin completo. O dono não perde nada com isso — o
 * dinheiro dele sai pela Tesouraria (`colher`), que é o caminho que existe para isso e que
 * tem trava própria de carteira e de sobra.
 *
 * A conta e o personagem se ligam pelo nick, como no resto do arquivo.
 */
export async function aprovarSaqueGemas({ email, id }) {
  const saqueId = String(id ?? '').trim();
  if (!saqueId) throw new Error('id do saque obrigatório');

  const { rows } = await pool.query(
    `SELECT lower(a.email) AS email
       FROM orb_saques s
       JOIN players p  ON p.id = s.player_id
       JOIN accounts a ON lower(a.nick) = lower(p.nick)
      WHERE s.id = $1`,
    [saqueId],
  );
  const dono = rows[0]?.email ?? null;
  const quem = String(email ?? '').trim().toLowerCase();
  // Pela CAIXA, e não pelo texto: `fasi.contato@` e `fasicontato@` são a mesma pessoa no
  // Gmail, e comparar só o texto deixaria a trava passar com um ponto a mais no cadastro.
  if (dono && quem && (dono === quem || (emailCanonico(dono) && emailCanonico(dono) === emailCanonico(quem)))) {
    throw new Error('não dá para aprovar o próprio saque — peça a outro cargo do painel');
  }

  const ok = await odb.aprovarSaque(saqueId, email);
  if (!ok) throw new Error('saque não encontrado ou já processado');
  return { ok: true, id: saqueId };
}

export async function rejeitarSaqueGemas({ email, id, motivo }) {
  const saqueId = String(id ?? '').trim();
  if (!saqueId) throw new Error('id do saque obrigatório');
  const s = await odb.saquePorId(saqueId);
  if (!s || s.status !== 'aguardando_aprovacao') {
    throw new Error('saque não está aguardando aprovação');
  }
  const nota = String(motivo ?? '').trim().slice(0, 200) || `recusado por ${email}`;
  const r = await odb.cancelarSaque(saqueId, nota);
  if (!r.ok) throw new Error('não deu para recusar o saque');
  return { ok: true, id: saqueId, nick: null, saldo: r.saldo };
}

export async function listarHistoricoDepositosGemas(opts) {
  return odb.listarDepositosAdmin(opts);
}

export async function listarHistoricoSaquesGemas(opts) {
  return odb.listarSaquesAdmin(opts);
}

/** Indicadores e comissões do programa de referral — painel admin. */
export async function listarReferrals({ q = '', limite = 50, offset = 0 } = {}) {
  const busca = String(q ?? '').trim();
  const lim = Math.min(Math.max(Number(limite) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);

  const where = busca
    ? `WHERE lower(a.nick) LIKE '%' || lower($1) || '%'
          OR lower(coalesce(a.email, '')) LIKE '%' || lower($1) || '%'
          OR lower(coalesce(ac.code, '')) LIKE '%' || lower($1) || '%'`
    : '';
  const params = busca ? [busca, lim, off] : [lim, off];
  const limOff = busca ? '$2' : '$1';
  const offOff = busca ? '$3' : '$2';

  const base = `
    WITH agg AS (
      SELECT
        ar.referrer_account_id,
        count(*)::int AS indicados,
        count(*) FILTER (WHERE coalesce(rp.level, 0) >= 40)::int AS indicados_nv40
      FROM affiliate_referrals ar
      JOIN accounts ra ON ra.id = ar.referred_account_id
      LEFT JOIN players rp ON lower(rp.nick) = lower(ra.nick)
      GROUP BY ar.referrer_account_id
    ),
    com AS (
      SELECT
        a.id AS account_id,
        coalesce(sum(ac.qtd) FILTER (WHERE ac.tipo = 'diamante'), 0)::bigint AS com_dia,
        coalesce(sum(ac.qtd) FILTER (WHERE ac.tipo = 'gema'), 0)::bigint AS com_gema
      FROM accounts a
      JOIN players p ON lower(p.nick) = lower(a.nick)
      LEFT JOIN affiliate_comissao ac ON ac.referrer_player_id = p.id
      GROUP BY a.id
    ),
    tot_dia AS (
      -- O denominador do "% que veio de comissão". Diamante COMPRADO de outro jogador no
      -- Mercado não é entrada de afiliado nem de compra — contá-lo aqui só diluiria o
      -- percentual de quem indica. Ver MOTIVOS_TRANSFERENCIA_DIA.
      SELECT player_id, coalesce(sum(delta) FILTER (WHERE delta > 0 AND ${SQL_NAO_TRANSFERENCIA_DIA}), 0)::bigint AS total
        FROM diamante_ledger
       GROUP BY player_id
    ),
    tot_orb AS (
      SELECT player_id, coalesce(sum(delta) FILTER (WHERE delta > 0), 0)::bigint AS total
        FROM orb_ledger
       GROUP BY player_id
    )
    SELECT
      a.id,
      a.nick,
      a.email,
      ac.code,
      coalesce(ac.visitas, 0)::int AS visitas,
      g.indicados,
      g.indicados_nv40,
      coalesce(c.com_dia, 0)::bigint AS comissao_diamantes,
      coalesce(c.com_gema, 0)::bigint AS comissao_gemas,
      CASE WHEN coalesce(td.total, 0) > 0
        THEN round(100.0 * coalesce(c.com_dia, 0) / td.total, 1)
        ELSE 0 END AS pct_diamantes,
      CASE WHEN coalesce(to2.total, 0) > 0
        THEN round(100.0 * coalesce(c.com_gema, 0) / to2.total, 1)
        ELSE 0 END AS pct_gemas
    FROM agg g
    JOIN accounts a ON a.id = g.referrer_account_id
    LEFT JOIN affiliate_codes ac ON ac.account_id = a.id
    LEFT JOIN players p ON lower(p.nick) = lower(a.nick)
    LEFT JOIN com c ON c.account_id = a.id
    LEFT JOIN tot_dia td ON td.player_id = p.id
    LEFT JOIN tot_orb to2 ON to2.player_id = p.id
    ${where}`;

  const { rows } = await pool.query(
    `${base}
     ORDER BY g.indicados DESC, comissao_diamantes DESC, a.nick
     LIMIT ${limOff} OFFSET ${offOff}`,
    params,
  );

  const { rows: tot } = await pool.query(
    `WITH agg AS (
       SELECT referrer_account_id FROM affiliate_referrals GROUP BY referrer_account_id
     )
     SELECT count(*)::int AS n
       FROM agg g
       JOIN accounts a ON a.id = g.referrer_account_id
       LEFT JOIN affiliate_codes ac ON ac.account_id = a.id
       ${where}`,
    busca ? [busca] : [],
  );

  return {
    total: tot[0]?.n ?? 0,
    offset: off,
    limite: lim,
    q: busca,
    taxaDiamantePct: Math.round(PCT_DIA_COMISSAO * 100),
    taxaGemaPct: Math.round(PCT_ORB_COMISSAO * 100),
    indicadores: rows.map((r) => ({
      id: Number(r.id),
      nick: r.nick,
      email: r.email,
      code: r.code,
      visitas: Number(r.visitas),
      indicados: Number(r.indicados),
      indicadosNv40: Number(r.indicados_nv40),
      comissaoDiamantes: Number(r.comissao_diamantes),
      comissaoGemas: Number(r.comissao_gemas),
      pctDiamantes: Number(r.pct_diamantes),
      pctGemas: Number(r.pct_gemas),
    })),
  };
}

// ------------------------------------------------------ referral especial
//
// O acordo por streamer: taxa própria em cada moeda, link personalizado e o selo de Streamer
// Oficial. A REGRA econômica inteira mora em `game/afiliados.mjs` — aqui só se traduz erro para
// o português do painel e se decide quem pode salvar o quê.

/** As chaves de `ErroAfiliado` viram frase; o painel mostra `err.message` cru. */
const MENSAGEM_AFILIADO = {
  'afiliados.nickObrigatorio': 'informe o nick do jogador',
  'afiliados.nickNaoEncontrado': 'não existe conta com esse nick',
  'afiliados.slugInvalido':
    'link inválido: de 3 a 20 caracteres, só letras, números, hífen e sublinhado, começando e terminando em letra ou número',
  'afiliados.slugReservado': 'esse link é reservado pelo projeto',
  'afiliados.slugEmUso': 'esse link já é de outro indicador',
  'afiliados.taxaInvalida': 'porcentagem inválida',
  'afiliados.taxaAcimaDoTeto': 'porcentagem acima do teto permitido',
  'afiliados.taxaGemaAcimaDoTeto':
    `o teto da gema é ${(tetoDaGema() * 100).toFixed(0)}%. A cada US$ 10 depositados entram US$ 10 e ` +
    `saem US$ 9 em saque — o US$ 1 de diferença é o único dinheiro da operação, e a comissão sai ` +
    `dele. No teto, o padrinho já leva US$ 0,90 desse US$ 1; em ${(TETO_ORB_RUINA * 100).toFixed(2)}% ` +
    `ele leva o US$ 1 inteiro e o projeto zera. Para dar mais, use a taxa em diamante ou o bônus em ` +
    `diamante sobre o depósito — diamante não sai da tesouraria em USDT.`,
  'afiliados.taxaPedeConfirmacao': 'essa taxa precisa de confirmação — marque a caixa e salve de novo',
};

const erroDoPainel = (err) =>
  err instanceof ErroAfiliado ? new Error(MENSAGEM_AFILIADO[err.chave] ?? err.chave) : err;

/**
 * Os limites que o painel desenha, todos derivados dos preços da gema.
 *
 * Vão para a tela em vez de ficarem repetidos no cliente porque são a MESMA conta que o
 * servidor usa para recusar — um número copiado à mão no HTML viraria mentira no dia em que
 * o spread mudasse.
 */
export function limitesReferralEspecial() {
  return {
    padraoGema: PCT_ORB_COMISSAO,
    padraoDiamante: PCT_DIA_COMISSAO,
    tetoGemaSeguro: TETO_ORB_SEGURO,
    tetoGema: tetoDaGema(),
    tetoGemaRuina: TETO_ORB_RUINA,
    custoRedePrimeiroSaque: CUSTO_REDE_PRIMEIRO_SAQUE,
    equilibrioNoTeto: depositoDeEquilibrio(tetoDaGema()),
    equilibrioNoPadrao: depositoDeEquilibrio(PCT_ORB_COMISSAO),
    tetoDiamanteSeguro: TETO_DIA_SEGURO,
    tetoDiamanteMax: TETO_DIA_MAX,
    tetoDiaExtraMax: TETO_DIA_EXTRA_MAX,
    margemMinimaCaixa: MARGEM_MINIMA_CAIXA,
    gemasPorDiamante: GEMAS_POR_DIAMANTE,
    // A margem de cada faixa, para o painel mostrar "sobra US$ X por US$ 100" sem refazer a conta.
    margemPadrao: margemDoDeposito(PCT_ORB_COMISSAO),
    margemNoTetoSeguro: margemDoDeposito(TETO_ORB_SEGURO),
    // Os dois preços vão junto para o painel refazer a margem AO VIVO enquanto se digita, com a
    // mesma fórmula do servidor — é o que evita a tela prometer um número e o salvar recusar.
    precoCompra: PRECO_COMPRA,
    precoSaque: PRECO_SAQUE,
  };
}

export async function listarReferralEspecial() {
  return { limites: limitesReferralEspecial(), itens: await listarEspeciais() };
}

/**
 * Salva um acordo. Campo vazio = volta ao padrão do código (NULL na coluna), e é assim que se
 * tira uma taxa especial de alguém sem apagar o código de convite nem o histórico dele.
 */
export async function definirReferralEspecial({ email, nick, slug, taxaGemaPct, taxaDiamantePct, taxaDiaExtraPct, streamerOficial, confirmado }) {
  try {
    // Chega em PONTOS PERCENTUAIS do painel (15, e não 0,15) porque é assim que a pessoa pensa;
    // vira fração aqui, num lugar só, antes de qualquer validação de teto.
    const fracao = (v) => (v === '' || v == null ? null : Number(v) / 100);

    const gema = fracao(taxaGemaPct);
    const diamante = fracao(taxaDiamantePct);
    const diaExtra = fracao(taxaDiaExtraPct);

    const r = await definirEspecial({
      nick,
      slug: normalizarSlug(slug),
      taxaGema: gema == null ? null : validarTaxa(gema, {
        tetoSeguro: TETO_ORB_SEGURO, tetoDuro: tetoDaGema(), confirmado, moeda: 'gema',
      }),
      taxaDiamante: diamante == null ? null : validarTaxa(diamante, {
        tetoSeguro: TETO_DIA_SEGURO, tetoDuro: TETO_DIA_MAX, confirmado, moeda: 'diamante',
      }),
      taxaDiaExtra: diaExtra == null ? null : validarTaxa(diaExtra, {
        tetoSeguro: TETO_DIA_SEGURO, tetoDuro: TETO_DIA_EXTRA_MAX, confirmado, moeda: 'diamante',
      }),
      streamerOficial,
      porEmail: email,
    });

    const aviso = await sincronizarTagStreamer(r.nick, !!streamerOficial, email);
    return { ...r, aviso, limites: limitesReferralEspecial() };
  } catch (err) {
    throw erroDoPainel(err);
  }
}

export async function removerReferralEspecial({ nick }) {
  try {
    const r = await removerEspecial(nick);
    await sincronizarTagStreamer(r.nick, false, null);
    return r;
  } catch (err) {
    throw erroDoPainel(err);
  }
}

/**
 * Mantém a tag roxa de [STREAMER] no chat junto com o selo do painel.
 *
 * São duas coisas guardadas em lugares diferentes — `chat_cargos.cargo` e
 * `affiliate_codes.streamer_oficial` — e o dono não deveria ter de lembrar das duas. Aqui elas
 * andam juntas.
 *
 * A trava: `chat_cargos` tem o NICK como chave primária e `definirCargo` faz UPSERT, então
 * carimbar 'streamer' em cima de um moderador APAGARIA a moderação dele. Por isso só se escreve
 * quando não há cargo nenhum (ou já é 'streamer'), e nos outros casos devolve-se um aviso para a
 * tela em vez de mexer. O selo do modal Indique & Ganhe não depende disto — aquele sai da coluna
 * própria e aparece de qualquer jeito.
 */
async function sincronizarTagStreamer(nick, ligar, email) {
  const atual = await cargoPorNick(nick);
  if (ligar) {
    if (atual && atual !== 'streamer') {
      return `selo salvo, mas a tag do chat continua [${atual}]: ${nick} já tem esse cargo e trocar apagaria os poderes dele.`;
    }
    if (atual !== 'streamer') await definirCargo({ email, nick, cargo: 'streamer' });
    return null;
  }
  if (atual === 'streamer') await removerCargo({ nick });
  return null;
}

const FUSO_BR = 'America/Sao_Paulo';

function hojeBr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: FUSO_BR });
}

function validarDia(dia) {
  const s = String(dia ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function whereHistoricoDiamantes({ dia, nick }) {
  const condicoes = [
    `status = 'pago'`,
    `(COALESCE(pago_em, criado_em) AT TIME ZONE '${FUSO_BR}')::date = $1::date`,
  ];
  const params = [validarDia(dia) ?? hojeBr()];
  const busca = String(nick ?? '').trim();
  if (busca) {
    condicoes.push(`lower(nick) LIKE '%' || lower($${params.length + 1}) || '%'`);
    params.push(busca);
  }
  return { where: `WHERE ${condicoes.join(' AND ')}`, params, busca };
}

/** Pagamentos de diamantes confirmados — histórico paginado com filtro por dia e nick. */
export async function listarHistoricoDiamantes({ nick = '', dia, limite = 40, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limite) || 40, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const { where, params, busca } = whereHistoricoDiamantes({ dia, nick });
  const diaFiltro = params[0];
  const limIdx = params.length + 1;
  const offIdx = params.length + 2;

  const { rows: resumoRows } = await pool.query(
    `SELECT count(*)::int AS pagamentos,
            COALESCE(SUM(qtd), 0)::bigint AS diamantes,
            COALESCE(SUM(centavos), 0)::bigint AS centavos
       FROM diamante_pagamentos
       ${where}`,
    params,
  );
  const resumo = resumoRows[0] ?? {};
  const centavosBruto = Number(resumo.centavos ?? 0);

  const { rows } = await pool.query(
    `SELECT nick, metodo, provedor, qtd, centavos, referencia,
            COALESCE(pago_em, criado_em) AS em
       FROM diamante_pagamentos
       ${where}
       ORDER BY COALESCE(pago_em, criado_em) DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
    [...params, lim, off],
  );
  const { rows: tot } = await pool.query(
    `SELECT count(*)::int AS n FROM diamante_pagamentos ${where}`,
    params,
  );

  const pagamentos = rows.map((r) => {
    const centavos = Number(r.centavos);
    const liquidoCentavos = liquidoPagamentoCentavos(centavos, { metodo: r.metodo, provedor: r.provedor });
    return {
      nick: r.nick,
      metodo: r.metodo,
      provedor: r.provedor,
      qtd: Number(r.qtd),
      centavos,
      liquidoCentavos,
      referencia: r.referencia,
      em: r.em,
    };
  });

  let liquidoDia = 0;
  if (pagamentos.length || Number(resumo.pagamentos ?? 0) > 0) {
    const { rows: liqRows } = await pool.query(
      `SELECT metodo, provedor, centavos FROM diamante_pagamentos ${where}`,
      params,
    );
    for (const r of liqRows) {
      liquidoDia += liquidoPagamentoCentavos(Number(r.centavos), { metodo: r.metodo, provedor: r.provedor });
    }
  }

  return {
    dia: diaFiltro,
    resumoDia: {
      pagamentos: Number(resumo.pagamentos ?? 0),
      diamantes: Number(resumo.diamantes ?? 0),
      centavos: centavosBruto,
      liquidoCentavos: liquidoDia,
      taxaCentavos: centavosBruto - liquidoDia,
    },
    total: tot[0]?.n ?? 0,
    offset: off,
    limite: lim,
    nick: busca,
    pagamentos,
  };
}

// ------------------------------------------------------------ emissão de notas
//
// Export das compras confirmadas para lançar como NFS-e na contabilidade (Contabilizei →
// "Importar notas fiscais"). Não emite nada: só empacota os dados que a nota precisa.
//
// O que entra, e por quê:
//
//   · **O marco é o 1º pagamento confirmado da Efí.** Antes dele, a receita caía em conta
//     PESSOA FÍSICA (Stripe PF, LivePix) — não é faturamento do CNPJ. Do marco em diante, o
//     dinheiro é da empresa.
//   · **Efí + Stripe entram, a partir do marco.** Toda linha da Efí conta (não há Efí antes do
//     marco). A Stripe conta só a partir da data/hora do marco — a Stripe anterior era PF.
//     LivePix nunca entra.
//   · **Valor = líquido.** A nota sai pelo que caiu na conta (bruto − taxa do provedor), a
//     pedido da contabilidade. O bruto e a taxa vão no arquivo do lado, para conferência.
//   · **Sem CPF nas antigas.** O CPF não era coletado no começo; as compras novas já trazem o
//     que o jogador digitou no checkout. A nota das antigas vai como consumidor não
//     identificado.

// O CNPJ mora em `empresa.mjs` desde que o documento de MED passou a precisar dele também.
import { CNPJ_PRESTADOR } from './empresa.mjs';
const DESCRICAO_NOTA =
  'Licenciamento de conteúdo digital — {qtd} diamantes no aplicativo PokéIdle (pedido {ref})';

const descricaoNota = ({ qtd, referencia }) =>
  DESCRICAO_NOTA.replace('{qtd}', String(qtd)).replace('{ref}', referencia);

const cpfFormatado = (d) => {
  const s = String(d ?? '').replace(/\D/g, '');
  return s.length === 11 ? `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}` : '';
};
const dataBr = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: FUSO_BR });
const reaisPonto = (centavos) => (Number(centavos ?? 0) / 100).toFixed(2);
const reaisVirgula = (centavos) => reaisPonto(centavos).replace('.', ',');

/** Data/hora do 1º pagamento confirmado da Efí — o marco a partir do qual a receita é do CNPJ. */
async function marcoEfi() {
  const { rows } = await pool.query(
    `SELECT MIN(COALESCE(pago_em, criado_em)) AS em
       FROM diamante_pagamentos
      WHERE status = 'pago' AND lower(provedor) = 'efi'`,
  );
  return rows[0]?.em ?? null;
}

/**
 * Compras (Efí + Stripe, a partir do marco) agrupadas por competência — mês do pagamento em
 * horário de Brasília.
 *
 * Sem `mes` → devolve só a lista de meses (a tela da aba). Com `mes` → devolve também as notas
 * daquele mês e um resumo. A consulta traz tudo de uma vez e agrupa em memória: são ~milhares
 * de linhas no total, barato, e evita N+1 para recalcular o líquido linha a linha.
 */
export async function emissaoNotas({ mes } = {}) {
  const marco = await marcoEfi();

  // Sem marco (nenhum pagamento da Efí ainda) não há faturamento do CNPJ para declarar.
  //
  // `tomador_email` das compras antigas é nulo (a coluna nasceu na Fase 1). O e-mail da CONTA
  // em que o jogador estava logado serve de reserva — junta por `player_id → players.nick →
  // accounts.nick` (mesmo caminho de `jogadorDaSessao`/`listarUsuarios`). É o e-mail de login,
  // não necessariamente o do provedor de pagamento, mas identifica a pessoa na nota.
  const { rows } = marco
    ? await pool.query(
        `SELECT dp.referencia, dp.nick, dp.qtd, dp.centavos, dp.metodo, dp.provedor,
                dp.tomador_nome,
                COALESCE(dp.tomador_email, ac.email) AS tomador_email,
                dp.tomador_cpf,
                COALESCE(dp.pago_em, dp.criado_em) AS em,
                to_char((COALESCE(dp.pago_em, dp.criado_em) AT TIME ZONE '${FUSO_BR}'), 'YYYY-MM') AS competencia
           FROM diamante_pagamentos dp
           LEFT JOIN players  pl ON pl.id = dp.player_id
           LEFT JOIN accounts ac ON lower(ac.nick) = lower(pl.nick)
          WHERE dp.status = 'pago'
            AND lower(dp.provedor) IN ('efi', 'stripe')
            AND COALESCE(dp.pago_em, dp.criado_em) >= $1
          ORDER BY COALESCE(dp.pago_em, dp.criado_em) ASC`,
        [marco],
      )
    : { rows: [] };

  const porMes = new Map();
  for (const r of rows) {
    const bruto = Number(r.centavos);
    const liquido = liquidoPagamentoCentavos(bruto, { metodo: r.metodo, provedor: r.provedor });
    const qtd = Number(r.qtd);
    const nota = {
      referencia: r.referencia,
      nick: r.nick,
      provedor: r.provedor,
      em: r.em,
      competencia: r.competencia,
      qtd,
      brutoCentavos: bruto,
      taxaCentavos: bruto - liquido,
      liquidoCentavos: liquido,
      tomadorNome: r.tomador_nome || '',
      tomadorEmail: r.tomador_email || '',
      // Vem cifrado do banco (ver `cofre.mjs`); a nota fiscal e o CSV precisam do número.
      tomadorCpf: r.tomador_cpf ? cpfFormatado(decifrar(r.tomador_cpf) ?? '') : '',
      descricao: descricaoNota({ qtd, referencia: r.referencia }),
    };
    if (!porMes.has(r.competencia)) porMes.set(r.competencia, []);
    porMes.get(r.competencia).push(nota);
  }

  const contar = (notas, prov) => notas.filter((n) => String(n.provedor).toLowerCase() === prov).length;
  const resumir = (notas) => ({
    pagamentos: notas.length,
    efi: contar(notas, 'efi'),
    stripe: contar(notas, 'stripe'),
    brutoCentavos: notas.reduce((s, n) => s + n.brutoCentavos, 0),
    taxaCentavos: notas.reduce((s, n) => s + n.taxaCentavos, 0),
    liquidoCentavos: notas.reduce((s, n) => s + n.liquidoCentavos, 0),
    comCpf: notas.filter((n) => n.tomadorCpf).length,
  });

  const meses = [...porMes.entries()]
    .map(([m, notas]) => ({ mes: m, ...resumir(notas) }))
    .sort((a, b) => b.mes.localeCompare(a.mes));

  if (!mes) return { meses, marco };

  const notas = porMes.get(mes) ?? [];
  return { meses, marco, mes, notas, resumo: resumir(notas) };
}

/**
 * O arquivo para importar na contabilidade. `csv` (padrão) usa `;` e BOM UTF-8, que é o que o
 * Excel-BR abre sem embaralhar acento; `xml` é a mesma tabela num formato estruturado. Devolve
 * `{ arquivo, mime, conteudo }` — a tela monta um Blob e baixa (não streamamos: o corpo cabe
 * folgado num JSON e a rota já está atrás do portão do admin).
 */
export async function exportarNotas({ mes, formato = 'csv' }) {
  const m = String(mes ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error('mês inválido (use AAAA-MM)');
  const { notas } = await emissaoNotas({ mes: m });
  if (!notas.length) throw new Error(`nenhuma compra (Efí/Stripe) na competência ${m}`);

  if (formato === 'xml') {
    const esc = (t) => String(t ?? '').replace(/[<>&"']/g, (c) => (
      { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]
    ));
    const itens = notas.map((n) => `  <nota>
    <data>${dataBr(n.em)}</data>
    <competencia>${m}</competencia>
    <referencia>${esc(n.referencia)}</referencia>
    <provedor>${esc(n.provedor)}</provedor>
    <tomador>${esc(n.tomadorNome)}</tomador>
    <email>${esc(n.tomadorEmail)}</email>
    <cpf>${esc(n.tomadorCpf)}</cpf>
    <quantidadeDiamantes>${n.qtd}</quantidadeDiamantes>
    <valorBruto>${reaisPonto(n.brutoCentavos)}</valorBruto>
    <valorTaxa>${reaisPonto(n.taxaCentavos)}</valorTaxa>
    <valorLiquido>${reaisPonto(n.liquidoCentavos)}</valorLiquido>
    <descricao>${esc(n.descricao)}</descricao>
  </nota>`).join('\n');
    const conteudo =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<notas competencia="${m}" prestadorCnpj="${CNPJ_PRESTADOR}" quantidade="${notas.length}" valorPor="liquido">\n` +
      `${itens}\n</notas>\n`;
    return { arquivo: `notas-pokeidle-${m}.xml`, mime: 'application/xml', conteudo };
  }

  const campo = (t) => `"${String(t ?? '').replace(/"/g, '""')}"`;
  const cabecalho = [
    'Data', 'Competencia', 'Referencia', 'Provedor', 'Tomador', 'Email', 'CPF',
    'QuantidadeDiamantes', 'ValorBruto', 'Taxa', 'ValorLiquido', 'Descricao',
  ].join(';');
  const linhas = notas.map((n) => [
    dataBr(n.em), m, campo(n.referencia), n.provedor, campo(n.tomadorNome), campo(n.tomadorEmail),
    campo(n.tomadorCpf), n.qtd, reaisVirgula(n.brutoCentavos), reaisVirgula(n.taxaCentavos),
    reaisVirgula(n.liquidoCentavos), campo(n.descricao),
  ].join(';'));
  const conteudo = '\uFEFF' + [cabecalho, ...linhas].join('\r\n') + '\r\n';
  return { arquivo: `notas-pokeidle-${m}.csv`, mime: 'text/csv', conteudo };
}

// ---------------------------------------------------------------- colheita

/**
 * Manda a sobra para uma das carteiras cadastradas.
 *
 * A validação inteira acontece AQUI, e de novo: a tela já limitou o valor e já ofereceu só as
 * carteiras da lista, mas a tela é sugestão. Quem manda o POST na mão passa pelas mesmas
 * checagens.
 *
 * A sobra é recalculada no momento do envio, e não recebida do cliente — entre abrir o painel
 * e clicar, alguém pode ter sacado.
 */
export async function colher({ email, carteira, usdt }) {
  const destino = CARTEIRAS.find((c) => c.endereco === carteira);
  if (!destino) throw new Error('carteira não está na lista autorizada');

  const valor = Number(usdt);
  if (!Number.isFinite(valor) || valor <= 0) throw new Error('valor inválido');

  if (!env.CHAIN_REDE) {
    throw new Error('CHAIN_REDE não configurada — a rede é simulada e nada sairia de verdade');
  }

  const c = await numerosDeCrypto();
  if (c.sobra <= 0) throw new Error('não há sobra: o caixa não passa do colchão sobre o passivo');
  if (valor > c.sobra) throw new Error(`acima da sobra segura (${c.sobra.toFixed(6)} USDT)`);

  try {
    // O `id` é o que dá rastro: entra na transação e casa com a linha de `admin_colheitas`.
    const resultado = await aChain().enviar({
      para: destino.endereco,
      usdt: valor,
      id: `colheita-${Date.now()}`,
    });
    const assinatura = resultado?.txHash ?? resultado?.assinatura ?? String(resultado ?? '');
    await pool.query(
      `INSERT INTO admin_colheitas (por_email, carteira, usdt, assinatura) VALUES ($1,$2,$3,$4)`,
      [email, destino.endereco, valor, assinatura ?? null],
    );
    return { ok: true, assinatura, carteira: destino };
  } catch (err) {
    await pool.query(
      `INSERT INTO admin_colheitas (por_email, carteira, usdt, erro) VALUES ($1,$2,$3,$4)`,
      [email, destino.endereco, valor, String(err.message).slice(0, 500)],
    );
    throw err;
  }
}

/**
 * Varredura manual: junta na tesouraria o USDT parado nos endereços de depósito dos jogadores.
 * É o mesmo trabalho do cron (`node tools/varrer.mjs` às 4h UTC).
 */
export async function varrerDepositos({ email }) {
  if (!env.CHAIN_REDE) {
    throw new Error('CHAIN_REDE não configurada — a rede é simulada e nada sairia de verdade');
  }
  if (!temSeed()) {
    throw new Error('ORB_SEED_DEPOSITOS não configurada — sem endereços derivados para varrer');
  }
  if (!env.CARTEIRA_PROJETO) {
    throw new Error('CARTEIRA_PROJETO não configurada');
  }
  if (varreduraEmCurso) {
    throw new Error('já há uma varredura em andamento — aguarde terminar');
  }

  varreduraEmCurso = true;
  try {
    const c = aChain();
    if (c.simulada) {
      throw new Error('CHAIN_REDE não configurada — a rede é simulada e nada sairia de verdade');
    }
    const sol = await c.saldoSol?.(env.CARTEIRA_PROJETO);
    if (sol != null && sol < 0.005) {
      throw new Error(
        `tesouraria com pouco SOL (${sol.toFixed(4)}) — envie SOL para ${env.CARTEIRA_PROJETO} antes de varrer (a rede cobra taxa em cada endereço)`,
      );
    }
    const r = await passagemVarredura(c, { minimo: MINIMO_USDT_ADMIN });
    if (r.pulado) throw new Error(String(r.pulado));
    if (r.recolhidos === 0) {
      if (r.candidatos === 0) {
        throw new Error('nenhum endereço com depósito no ledger para varrer');
      }
      if (r.falhas > 0) {
        throw new Error(
          `${r.falhas} endereço(s) falharam na blockchain — confira SOL na tesouraria e veja [orbs] varredura no log do servidor`,
        );
      }
      if (r.pulados > 0 && r.pulados === r.olhados) {
        throw new Error(
          `nenhum endereço acima de ${MINIMO_USDT_ADMIN} USDT on-chain (${r.pulados} abaixo do piso) — o saldo "aguardando recolha" pode ser contábil, não USDT parado nos endereços`,
        );
      }
      throw new Error('nada foi recolhido — veja o log do servidor ([orbs] varredura)');
    }
    console.log(
      `[admin] ${email} varreu depósitos: ${r.recolhidos} endereço(s), ${r.usdt} USDT, ${r.falhas} falha(s)`,
    );
    return { ok: true, ...r };
  } finally {
    varreduraEmCurso = false;
  }
}

/** As últimas colheitas, para o painel mostrar o histórico. */
export async function historico(limite = 20) {
  const { rows } = await pool.query(
    `SELECT por_email, carteira, usdt, assinatura, erro, criado_em
       FROM admin_colheitas ORDER BY id DESC LIMIT $1`,
    [limite],
  );
  return rows.map((r) => ({
    email: r.por_email,
    carteira: r.carteira,
    usdt: Number(r.usdt),
    assinatura: r.assinatura,
    erro: r.erro,
    em: r.criado_em,
  }));
}

// --------------------------------------------------------- custos e ganhos

const FUSO_BR_FIN = 'America/Sao_Paulo';

async function lerFinConfig() {
  const { rows } = await pool.query(`SELECT chave, valor FROM admin_fin_config`);
  const out = { cotacao_usdt_brl: 5.8, meses_operacao: 1 };
  for (const r of rows) {
    if (r.chave === 'cotacao_usdt_brl') out.cotacao_usdt_brl = Math.max(0, Number(r.valor) || 5.8);
    if (r.chave === 'meses_operacao') out.meses_operacao = Math.max(1, Math.min(120, Math.round(Number(r.valor) || 1)));
  }
  return out;
}

async function salvarFinConfig(chave, valor) {
  await pool.query(
    `INSERT INTO admin_fin_config (chave, valor) VALUES ($1, $2)
     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
    [chave, String(valor)],
  );
}

/** Planilha de faturamento, custos operacionais e lucro estimado. */
export async function custosGanhos() {
  const [fiat, crypto, config] = await Promise.all([
    numerosDeFiat(),
    numerosDeCrypto(),
    lerFinConfig(),
  ]);

  const { rows: mesAtual } = await pool.query(`
    SELECT COALESCE(SUM(centavos), 0)::bigint AS centavos,
           count(*)::int AS pagamentos
      FROM diamante_pagamentos
     WHERE status = 'pago'
       AND date_trunc('month', (COALESCE(pago_em, criado_em) AT TIME ZONE $1))
         = date_trunc('month', (now() AT TIME ZONE $1))`, [FUSO_BR_FIN]);

  const { rows: taxaRows } = await pool.query(
    `SELECT COALESCE(SUM(taxa_paga), 0)::bigint AS total FROM market_anuncios`,
  );
  const taxaGemas = Number(taxaRows[0]?.total ?? 0);
  const taxaMercadoUsdt = taxaGemas * PRECO_COMPRA;

  const { rows: affRows } = await pool.query(`
    SELECT tipo, COALESCE(SUM(qtd), 0)::bigint AS total
      FROM affiliate_comissao
     GROUP BY tipo`);
  const comissaoDiamantes = Number(affRows.find((r) => r.tipo === 'diamante')?.total ?? 0);
  const comissaoGemas = Number(affRows.find((r) => r.tipo === 'gema')?.total ?? 0);
  const comissaoGemasUsdt = comissaoGemas * PRECO_COMPRA;

  const { rows: colheitas } = await pool.query(`
    SELECT COALESCE(SUM(usdt) FILTER (WHERE erro IS NULL), 0)::numeric AS usdt
      FROM admin_colheitas`);

  const { rows: custosRows } = await pool.query(`
    SELECT id, tipo, descricao, valor_centavos, ativo, criado_em
      FROM admin_custos
     ORDER BY tipo DESC, id ASC`);

  const custos = custosRows.map((r) => ({
    id: Number(r.id),
    tipo: r.tipo,
    descricao: r.descricao,
    valorCentavos: Number(r.valor_centavos),
    ativo: r.ativo,
    em: r.criado_em,
  }));

  const mensais = custos.filter((c) => c.tipo === 'mensal' && c.ativo);
  const fixos = custos.filter((c) => c.tipo === 'fixo' && c.ativo);
  const totalMensalCentavos = mensais.reduce((s, c) => s + c.valorCentavos, 0);
  const totalFixoCentavos = fixos.reduce((s, c) => s + c.valorCentavos, 0);
  const meses = config.meses_operacao;
  const totalOperacionalCentavos = totalFixoCentavos + totalMensalCentavos * meses;

  const cotacao = config.cotacao_usdt_brl;
  const receitaBrlCentavos = fiat.totalCentavos;
  const receitaLiquidaCentavos = fiat.totalLiquidoCentavos;
  const receitaMesCentavos = Number(mesAtual[0]?.centavos ?? 0);

  let receitaMesLiquidaCentavos = 0;
  {
    const { rows: mesRows } = await pool.query(`
      SELECT metodo, provedor, centavos
        FROM diamante_pagamentos
       WHERE status = 'pago'
         AND date_trunc('month', (COALESCE(pago_em, criado_em) AT TIME ZONE $1))
           = date_trunc('month', (now() AT TIME ZONE $1))`, [FUSO_BR_FIN]);
    for (const r of mesRows) {
      receitaMesLiquidaCentavos += liquidoPagamentoCentavos(Number(r.centavos), {
        metodo: r.metodo,
        provedor: r.provedor,
      });
    }
  }

  const depositosUsdt = crypto.compradoUsdt;
  const lucroCryptoUsdt = crypto.lucro;
  const colhidoUsdt = Number(colheitas[0]?.usdt ?? 0);

  // Lucro estimado em BRL: entradas líquidas fiat + margem crypto − custos operacionais.
  const margemUsdt = lucroCryptoUsdt + taxaMercadoUsdt;
  const margemBrlCentavos = Math.round(margemUsdt * cotacao * 100);
  const lucroEstimadoCentavos = receitaLiquidaCentavos + margemBrlCentavos - totalOperacionalCentavos;
  const lucroMesCentavos = receitaMesLiquidaCentavos - totalMensalCentavos;

  const precoMedioDiamanteCentavos = fiat.diamantes.emitidos > 0
    ? Math.round(receitaBrlCentavos / fiat.diamantes.emitidos)
    : 0;
  const comissaoDiamantesCentavos = precoMedioDiamanteCentavos > 0
    ? Math.round(comissaoDiamantes * precoMedioDiamanteCentavos)
    : 0;

  return {
    config: { cotacaoUsdtBrl: cotacao, mesesOperacao: meses },
    faturamento: {
      diamantesCentavos: receitaBrlCentavos,
      diamantesLiquidoCentavos: receitaLiquidaCentavos,
      diamantesTaxaCentavos: receitaBrlCentavos - receitaLiquidaCentavos,
      diamantesMesCentavos: receitaMesCentavos,
      diamantesMesLiquidoCentavos: receitaMesLiquidaCentavos,
      pagamentosMes: Number(mesAtual[0]?.pagamentos ?? 0),
      depositosUsdt,
      lucroCryptoUsdt,
      taxaMercadoUsdt,
      taxaGemas,
      colhidoUsdt,
      margemUsdt,
    },
    custosJogo: {
      comissaoDiamantes,
      comissaoGemas,
      comissaoGemasUsdt,
      comissaoDiamantesCentavos,
      // Em PONTOS PERCENTUAIS, como já faz `listarReferrals`. A fração crua ia direto para o
      // HTML da planilha, que imprimia "Comissões afiliados (0.1% diamantes)" — cem vezes menos
      // do que a taxa real, na mesma tela em que a seção Referrals mostrava 10% corretamente.
      pctDiamante: Math.round(PCT_DIA_COMISSAO * 100),
      pctGema: Math.round(PCT_ORB_COMISSAO * 100),
    },
    operacional: {
      mensais,
      fixos,
      totalMensalCentavos,
      totalFixoCentavos,
      totalCentavos: totalOperacionalCentavos,
    },
    resultado: {
      margemBrlCentavos,
      lucroEstimadoCentavos,
      lucroMesCentavos,
      precoMedioDiamanteCentavos,
    },
    passivo: {
      orbsEmCirculacao: crypto.orbsEmCirculacao,
      gemasAfiliadoPendentes: crypto.gemasAfiliadoPendentes,
      orbsPassivoTotal: crypto.orbsPassivoTotal,
      passivoUsdt: crypto.passivo,
      caixaUsdt: crypto.caixa,
      precoCompra: PRECO_COMPRA,
      precoSaque: PRECO_SAQUE,
    },
  };
}

export async function salvarCusto({ email, id, tipo, descricao, valorCentavos }) {
  const t = tipo === 'fixo' ? 'fixo' : 'mensal';
  const desc = String(descricao ?? '').trim();
  if (!desc || desc.length > 120) throw new Error('descrição inválida');
  const valor = Math.max(0, Math.round(Number(valorCentavos) || 0));
  if (id) {
    const { rowCount } = await pool.query(
      `UPDATE admin_custos SET tipo=$1, descricao=$2, valor_centavos=$3, atualizado_em=now()
       WHERE id=$4`,
      [t, desc, valor, Number(id)],
    );
    if (!rowCount) throw new Error('custo não encontrado');
    return { ok: true, id: Number(id) };
  }
  const { rows } = await pool.query(
    `INSERT INTO admin_custos (tipo, descricao, valor_centavos, por_email)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [t, desc, valor, email],
  );
  return { ok: true, id: Number(rows[0].id) };
}

export async function removerCusto({ id }) {
  const { rowCount } = await pool.query(`DELETE FROM admin_custos WHERE id=$1`, [Number(id)]);
  if (!rowCount) throw new Error('custo não encontrado');
  return { ok: true };
}

export async function definirFinConfig({ cotacaoUsdtBrl, mesesOperacao }) {
  if (cotacaoUsdtBrl != null) {
    const c = Math.max(0.01, Math.min(99, Number(cotacaoUsdtBrl) || 5.8));
    await salvarFinConfig('cotacao_usdt_brl', c.toFixed(4));
  }
  if (mesesOperacao != null) {
    const m = Math.max(1, Math.min(120, Math.round(Number(mesesOperacao) || 1)));
    await salvarFinConfig('meses_operacao', m);
  }
  return { ok: true, config: await lerFinConfig() };
}

const REMETENTE_SUPORTE = 'Pokéidle <support@pokeidle.io>';
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function escaparHtml(t) {
  return String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Envia e-mail manual pelo painel admin — remetente fixo em support@pokeidle.io. */
export async function enviarEmailAdmin({ email: adminEmail, para, assunto, mensagem }) {
  const dest = String(para ?? '').trim().toLowerCase();
  if (!FORMATO_EMAIL.test(dest)) throw new Error('e-mail de destino inválido');
  const subj = String(assunto ?? '').trim() || 'Mensagem do suporte Pokéidle.io';
  if (subj.length > 200) throw new Error('assunto grande demais');
  const texto = String(mensagem ?? '').trim();
  if (!texto) throw new Error('mensagem vazia');
  if (texto.length > 8000) throw new Error('mensagem grande demais');

  await enviarEmail({
    para: dest,
    assunto: subj,
    de: REMETENTE_SUPORTE,
    lancarErro: true,
    html: htmlMensagemSuporte(texto, subj),
  });

  const { rows } = await pool.query(
    `INSERT INTO admin_emails_marketing (por_email, para, assunto, mensagem)
     VALUES ($1, $2, $3, $4)
     RETURNING id, criado_em`,
    [String(adminEmail ?? '').toLowerCase(), dest, subj, texto],
  );

  console.log(`[admin] ${adminEmail} enviou e-mail para ${dest}: ${subj}`);
  return {
    ok: true,
    para: dest,
    assunto: subj,
    id: rows[0]?.id,
    em: rows[0]?.criado_em,
  };
}

function exigirResend() {
  if (!resend.ativo()) throw new Error('Resend não configurado (RESEND_API_KEY)');
}

async function resendGet(caminho, params = {}) {
  exigirResend();
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.after) qs.set('after', String(params.after));
  const url = `https://api.resend.com${caminho}${qs.size ? `?${qs}` : ''}`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${resend.chave}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

function extrairEmailDe(from) {
  const bruto = String(from ?? '').trim();
  const m = bruto.match(/<([^>]+)>/);
  const addr = (m ? m[1] : bruto).trim().toLowerCase();
  if (!FORMATO_EMAIL.test(addr)) throw new Error('remetente inválido no e-mail recebido');
  return addr;
}

function assuntoResposta(assunto) {
  const s = String(assunto ?? '').trim();
  if (!s) return 'Re: sua mensagem';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

function htmlMensagemSuporte(texto, titulo) {
  const corpo = texto
    .split('\n')
    .map(
      (linha) =>
        `<p style="margin:0 0 12px;line-height:1.7;font-size:14px;">${
          linha ? escaparHtml(linha) : '&nbsp;'
        }</p>`,
    )
    .join('');
  return moldarEmail({
    titulo,
    corpo,
    rodape:
      'Esta mensagem foi enviada pela equipe do Pokéidle.io.<br>' +
      'Responda a este e-mail se precisar de ajuda.',
  });
}

/** Lista e-mails recebidos (Resend Receiving). */
export async function listarEmailsRecebidos({ limit = 30, after } = {}) {
  const lim = Math.max(1, Math.min(100, Math.round(Number(limit) || 30)));
  const r = await resendGet('/emails/receiving', { limit: lim, after: after || undefined });
  const emails = (r.data ?? []).map((e) => ({
    id: e.id,
    de: e.from,
    para: e.to ?? [],
    assunto: e.subject ?? '',
    em: e.created_at,
    anexos: (e.attachments ?? []).length,
    messageId: e.message_id ?? null,
  }));
  return {
    emails,
    hasMore: !!r.has_more,
    after: emails.length ? emails[emails.length - 1].id : null,
  };
}

/** Conteúdo completo de um e-mail recebido. */
export async function obterEmailRecebido({ id }) {
  const emailId = String(id ?? '').trim();
  if (!emailId) throw new Error('id do e-mail obrigatório');
  const e = await resendGet(`/emails/receiving/${encodeURIComponent(emailId)}`);
  return {
    id: e.id,
    de: e.from,
    para: e.to ?? [],
    cc: e.cc ?? [],
    assunto: e.subject ?? '',
    em: e.created_at,
    html: e.html ?? null,
    text: e.text ?? null,
    messageId: e.message_id ?? null,
    anexos: (e.attachments ?? []).map((a) => ({
      id: a.id,
      nome: a.filename,
      tipo: a.content_type,
      tamanho: a.size,
    })),
  };
}

/** Responde um e-mail recebido — remetente fixo support@pokeidle.io. */
export async function responderEmailRecebido({ email: adminEmail, id, mensagem, assunto }) {
  const original = await obterEmailRecebido({ id });
  const dest = extrairEmailDe(original.de);
  const subj = String(assunto ?? '').trim() || assuntoResposta(original.assunto);
  if (subj.length > 200) throw new Error('assunto grande demais');
  const texto = String(mensagem ?? '').trim();
  if (!texto) throw new Error('mensagem vazia');
  if (texto.length > 8000) throw new Error('mensagem grande demais');

  const headers = original.messageId
    ? { 'In-Reply-To': original.messageId, References: original.messageId }
    : undefined;

  await enviarEmail({
    para: dest,
    assunto: subj,
    de: REMETENTE_SUPORTE,
    lancarErro: true,
    headers,
    html: htmlMensagemSuporte(texto, subj),
  });

  console.log(`[admin] ${adminEmail} respondeu e-mail ${original.id} para ${dest}: ${subj}`);
  return { ok: true, para: dest, assunto: subj, respostaDe: original.id };
}

/** Histórico de e-mails enviados pela aba Enviar novo (marketing/manual). */
export async function listarEmailsMarketingEnviados({ limit = 50, offset = 0 } = {}) {
  const lim = Math.max(1, Math.min(100, Math.round(Number(limit) || 50)));
  const off = Math.max(0, Math.round(Number(offset) || 0));
  const { rows } = await pool.query(
    `SELECT id, por_email, para, assunto, criado_em
       FROM admin_emails_marketing
      ORDER BY criado_em DESC
      LIMIT $1 OFFSET $2`,
    [lim, off],
  );
  const emails = rows.map((r) => ({
    id: Number(r.id),
    por: r.por_email,
    para: r.para,
    assunto: r.assunto,
    em: r.criado_em,
  }));
  return { emails, hasMore: emails.length === lim, offset: off + emails.length };
}

/** Detalhe de um e-mail marketing enviado pelo painel. */
export async function obterEmailMarketingEnviado({ id }) {
  const emailId = Number(id);
  if (!Number.isFinite(emailId) || emailId < 1) throw new Error('id inválido');
  const { rows } = await pool.query(
    `SELECT id, por_email, para, assunto, mensagem, criado_em
       FROM admin_emails_marketing WHERE id = $1`,
    [emailId],
  );
  const r = rows[0];
  if (!r) throw new Error('e-mail não encontrado');
  return {
    id: Number(r.id),
    por: r.por_email,
    para: r.para,
    assunto: r.assunto,
    mensagem: r.mensagem,
    em: r.criado_em,
  };
}

/** Os aglomerados de contas por origem. A regra e o porque moram em `origens-db.mjs`. */
export { multicontas, maxOnlinePorIp };

/**
 * O estado dos limites de rede, com a FOTO do momento junto.
 *
 * `onlineAgora` sai do Redis, e não do banco: é quem está com socket aberto neste instante. É
 * a informação que faltava para o moderador julgar um pedido de whitelist — "esta casa diz ter
 * 8 jogadores" é uma alegação; "este IP está com 8 contas jogando agora" é um fato.
 */
export async function estadoDosLimitesDeRede(opcoes) {
  const estado = await estadoDoTetoPorIp(opcoes);
  const comOnline = async (l) => ({ ...l, onlineAgora: (await quemEstaNaRede(l.ipBucket)).length });
  return {
    ...estado,
    liberados: await Promise.all(estado.liberados.map(comOnline)),
    recusas: await Promise.all(estado.recusas.map(comOnline)),
  };
}

/**
 * Põe (ou tira) um IP da whitelist — o botão do painel.
 *
 * A whitelist vale para os DOIS limites de rede de uma vez: o teto de CADASTRO (quantas contas
 * aquele IP pode abrir) e o de SESSÃO (quantas podem jogar ao mesmo tempo). É uma lista só de
 * propósito: quem libera um IP está dizendo "aqui mora mais gente do que a régua supõe", e
 * essa frase responde às duas perguntas. Duas listas separadas dariam o estado em que o
 * jogador consegue criar a conta e não consegue entrar nela.
 *
 * O `publicar` é o que faz o clique valer NA HORA: cada gateway guarda a whitelist em memória
 * (ela é conferida a cada socket que abre) e só releria sozinho em até 30 s.
 */
export const liberarIpDoTeto = async ({ email, ipBucket, nota }) => {
  const r = await liberarIp({ ipBucket, nota, porEmail: email });
  await publicar(CANAL_WHITELIST, { ipBucket: r.ipBucket }).catch(() => {});
  return r;
};

// ------------------------------------------------------------- banimento de IP
//
// A regra e o preço moram em `origens-db.mjs`; o bloqueio, no gateway. Aqui fica o que é do
// painel: a prévia, as travas contra o erro caro e o "banir também as contas nascidas ali".

/** Quantas contas o "banir junto" derruba de uma vez, no máximo. Uma fazenda cabe folgado. */
const MAX_CONTAS_NO_BAN_DE_IP = 500;

/**
 * O retrato de um IP antes de banir: contas nascidas ali (as que cairiam junto), contas que já
 * entraram por ali, quem está jogando agora, se está na whitelist e se o IP é o do próprio
 * moderador. É o que o painel mostra antes do botão.
 */
async function retratoParaBan({ ip, ipDoAdmin }) {
  const r = await retratoDoIp(ip);
  return {
    ...r,
    onlineAgora: (await quemEstaNaRede(r.ipBucket)).length,
    limitePorIp: maxContasPorIp(),
    ehMeuIp: !!ipDoAdmin && chaveDeBanDeIp(ipDoAdmin) === r.ipBucket,
  };
}

/** A prévia que vai à TELA: sem o e-mail das contas — o painel só precisa do nick. */
export async function previaBanDeIp(opcoes) {
  const r = await retratoParaBan(opcoes);
  return { ...r, nascidas: r.nascidas.map(({ id, nick }) => ({ id, nick })) };
}

/**
 * Bane o IP — e, se pedido, dá ban SOFT nas contas que nasceram nele.
 *
 * ### As travas
 *
 * · o IP de quem clica não pode ser banido: o painel continuaria abrindo (o gateway isenta
 *   `/admin`), mas o jogo e o login do próprio moderador não;
 * · `esperado` é quantas contas a prévia mostrou. Se nasceu conta nova entre a prévia e o
 *   clique, o número muda e nada é feito — a mesma conferência da faxina.
 *
 * ### Por que as contas levam ban SOFT
 *
 * O ban de IP fecha a REDE; as contas ainda abririam de outra (dados móveis, casa de amigo).
 * O ban soft fecha isso sem apagar nada: se uma delas for de um vizinho inocente do mesmo CGNAT,
 * desbanir devolve tudo como estava.
 */
export async function banirIpDoPainel({ email, ip, ipDoAdmin, motivo, horas, banirContas = false, esperado = null }) {
  const previa = await retratoParaBan({ ip, ipDoAdmin });
  if (previa.ehMeuIp) throw new Error('esse é o IP de onde você está usando o painel — banir trancaria você fora do jogo');
  if (banirContas && esperado != null && Number(esperado) !== previa.nascidas.length) {
    throw new Error(`o número de contas nascidas nesse IP mudou (${esperado} → ${previa.nascidas.length}) — abra a prévia de novo`);
  }
  if (banirContas && previa.nascidas.length > MAX_CONTAS_NO_BAN_DE_IP) {
    throw new Error(`mais de ${MAX_CONTAS_NO_BAN_DE_IP} contas nesse IP — bana o IP sem as contas e use a faxina`);
  }

  // Sem quebra de linha nem caractere de controle: o motivo vai para o log do servidor e para a
  // tela de quem foi banido, e uma quebra no meio forjaria uma linha de log inteira.
  const motivoLimpo = String(motivo ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300)
    || 'Criação de contas em massa';
  const r = await banirIp({ ipBucket: previa.ipBucket, motivo: motivoLimpo, porEmail: email, horas });
  // Todo gateway derruba o cache e fecha os sockets desta rede na hora.
  await publicar(CANAL_IP_BANIDO, { ipBucket: r.ipBucket, banido: true }).catch(() => {});

  const contas = [];
  const falhas = [];
  if (banirContas) {
    for (const c of previa.nascidas) {
      // Cargo do painel e a conta de quem clica ficam de fora — `banirUsuario` recusaria de qualquer
      // jeito, e aqui isso não é falha, é o esperado.
      if (ehEmailDeCargo(c.email) || String(c.email ?? '').toLowerCase() === String(email).toLowerCase()) continue;
      try {
        await banirUsuario({ email, nick: c.nick, motivo: `Banimento de IP (${r.ipBucket}): ${motivoLimpo}`, soft: true });
        contas.push(c.nick);
      } catch (err) {
        falhas.push({ nick: c.nick, erro: err.message });
      }
    }
  }
  return { ...r, motivo: motivoLimpo, contasBanidas: contas, falhas };
}

/** Tira o ban do IP. As contas banidas junto continuam banidas — desbanir cada uma é pela ficha. */
export async function desbanirIpDoPainel({ ipBucket }) {
  const r = await desbanirIp(ipBucket);
  await publicar(CANAL_IP_BANIDO, { ipBucket: r.ipBucket, banido: false }).catch(() => {});
  return r;
}

export const listarBansDeIp = (opcoes) => listarIpsBanidos(opcoes);

export const travarIpNoTeto = async ({ ipBucket }) => {
  const r = await travarIp(ipBucket);
  await publicar(CANAL_WHITELIST, { ipBucket: r.ipBucket }).catch(() => {});
  return r;
};

// ------------------------------------------------------- Convites do Discord

/**
 * O painel dos CONVITES DO DISCORD: quem trouxe quem, quais marcos viraram código e quais
 * códigos já foram trocados por prêmio no jogo.
 *
 * As duas tabelas (`convite_membros`, `convite_codigos`) são escritas pelo BOT e pelo sim — este
 * módulo só LÊ. Ver `convites-db.mjs`.
 *
 * ### Três números que não são o mesmo, e a coluna de cada um
 *
 *   `convidados`  quem entrou por um link daquele padrinho, tem conta de Discord com mais de um
 *                 ano E ainda está no servidor. É o número que move a escada.
 *   `trouxe`      tudo que entrou por ele, contando quem saiu e quem tem conta nova demais. A
 *                 diferença entre os dois é onde uma fazenda de contas aparece.
 *   `resgatados`  quantos dos códigos dele já viraram prêmio numa conta do jogo.
 *
 * O código é transferível de propósito (ver `convites-db.mjs`), então `quem_resgatou` pode ser
 * um nick diferente do dono do Discord — e é justamente por isso que a coluna existe.
 *
 * A busca casa com o id do Discord, o nome dele no Discord e o nick de quem resgatou: são as
 * três formas de chegar a uma pessoa a partir de uma reclamação.
 */
export async function convitesDiscord({ q = '', limite = 40, offset = 0 } = {}) {
  const busca = String(q ?? '').trim();
  const lim = Math.min(Math.max(Number(limite) || 40, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);

  // O resumo é de TUDO, e não da página: é a foto do programa inteiro.
  const { rows: [resumo] } = await pool.query(`
    SELECT
      (SELECT count(*) FROM convite_membros)::int                                     AS membros,
      (SELECT count(*) FROM convite_membros WHERE padrinho_id IS NOT NULL)::int        AS atribuidos,
      (SELECT count(*) FROM convite_membros
        WHERE padrinho_id IS NOT NULL AND vale_ponto AND saiu_em IS NULL)::int         AS validos,
      (SELECT count(*) FROM convite_membros WHERE saiu_em IS NOT NULL)::int            AS sairam,
      (SELECT count(DISTINCT padrinho_id) FROM convite_membros
        WHERE padrinho_id IS NOT NULL)::int                                            AS padrinhos,
      (SELECT count(*) FROM convite_codigos)::int                                      AS codigos,
      (SELECT count(*) FROM convite_codigos WHERE enviado_em IS NOT NULL)::int         AS enviados,
      (SELECT count(*) FROM convite_codigos WHERE resgatado_em IS NOT NULL)::int       AS resgatados,
      (SELECT coalesce(sum(delta), 0) FROM diamante_ledger WHERE motivo = 'convite')::bigint
                                                                                       AS diamantes`);

  // A busca escolhe QUAIS PADRINHOS entram na tabela; ela não pode filtrar as linhas que o
  // `count` soma. Filtrando direto no `WHERE`, procurar pelo nome de um convidado devolvia o
  // padrinho dele com "1 convidado" — o único que casou com a busca — em vez do total dele.
  //
  // Por isso o filtro é um `IN` sobre uma lista de padrinhos, e a agregação continua vendo o
  // grupo inteiro. Casa com quatro coisas, que são as quatro formas de chegar a alguém a partir
  // de uma reclamação: o nome do PADRINHO no Discord, o nome de um CONVIDADO dele, o id do
  // Discord e o NICK no jogo de quem resgatou um código dele.
  const where = busca
    ? `AND m.padrinho_id IN (
         SELECT m2.padrinho_id
           FROM convite_membros m2
           LEFT JOIN convite_membros eu2 ON eu2.discord_id = m2.padrinho_id
          WHERE m2.padrinho_id IS NOT NULL
            AND (
                 lower(coalesce(eu2.nome, '')) LIKE '%' || lower($1) || '%'
              OR lower(coalesce(m2.nome, ''))  LIKE '%' || lower($1) || '%'
              OR m2.padrinho_id LIKE '%' || $1 || '%'
              OR EXISTS (SELECT 1 FROM convite_codigos c2 JOIN players p2 ON p2.id = c2.player_id
                          WHERE c2.discord_id = m2.padrinho_id
                            AND lower(p2.nick) LIKE '%' || lower($1) || '%')
            )
       )`
    : '';
  const params = busca ? [busca, lim, off] : [lim, off];
  const pLim = busca ? '$2' : '$1';
  const pOff = busca ? '$3' : '$2';

  // O nome do PADRINHO sai da linha dele como convidado (`nome` de quando ele mesmo entrou).
  // Quem já estava no servidor antes do bot tem essa linha pela semeadura, então quase todo
  // padrinho tem nome; quem não tiver aparece pelo id, que é o que dá para mostrar.
  const base = `
    FROM convite_membros m
    LEFT JOIN convite_membros eu ON eu.discord_id = m.padrinho_id
    WHERE m.padrinho_id IS NOT NULL
    ${where}
    GROUP BY m.padrinho_id, eu.nome`;

  const { rows: [{ total }] } = await pool.query(
    `SELECT count(*)::int AS total FROM (SELECT m.padrinho_id ${base}) x`,
    busca ? [busca] : [],
  );

  const { rows } = await pool.query(`
    SELECT
      m.padrinho_id,
      eu.nome                                                                AS nome,
      count(*)::int                                                          AS trouxe,
      count(*) FILTER (WHERE m.vale_ponto AND m.saiu_em IS NULL)::int         AS convidados,
      count(*) FILTER (WHERE NOT m.vale_ponto)::int                          AS novos_demais,
      count(*) FILTER (WHERE m.saiu_em IS NOT NULL)::int                     AS sairam,
      max(m.entrou_em)                                                       AS ultimo_em,
      (SELECT count(*) FROM convite_codigos c WHERE c.discord_id = m.padrinho_id)::int          AS codigos,
      (SELECT count(*) FROM convite_codigos c
        WHERE c.discord_id = m.padrinho_id AND c.resgatado_em IS NOT NULL)::int                 AS resgatados,
      (SELECT string_agg(c.marco::text, ', ' ORDER BY c.marco) FROM convite_codigos c
        WHERE c.discord_id = m.padrinho_id AND c.resgatado_em IS NULL)                          AS marcos_abertos,
      (SELECT string_agg(DISTINCT p.nick, ', ') FROM convite_codigos c
        JOIN players p ON p.id = c.player_id
        WHERE c.discord_id = m.padrinho_id)                                                     AS quem_resgatou
    ${base}
    ORDER BY convidados DESC, trouxe DESC, m.padrinho_id
    LIMIT ${pLim} OFFSET ${pOff}`, params);

  // Os resgates, em ordem de quem chegou por último — é por aqui que se confere uma reclamação
  // de "resgatei e não veio". `entregue_em` vazio com `resgatado_em` preenchido é o caso raro em
  // que o processo caiu entre carimbar e gravar: o próximo login do jogador reentrega.
  const { rows: resgates } = await pool.query(`
    SELECT c.codigo, c.marco, c.discord_id, c.resgatado_em, c.entregue_em,
           p.nick, m.nome AS nome_discord
      FROM convite_codigos c
      LEFT JOIN players p ON p.id = c.player_id
      LEFT JOIN convite_membros m ON m.discord_id = c.discord_id
     WHERE c.resgatado_em IS NOT NULL
     ORDER BY c.resgatado_em DESC
     LIMIT 60`);

  const ms = (v) => (v == null ? null : new Date(v).getTime());
  return {
    q: busca,
    limite: lim,
    offset: off,
    total: Number(total),
    resumo: {
      membros: Number(resumo.membros),
      atribuidos: Number(resumo.atribuidos),
      validos: Number(resumo.validos),
      sairam: Number(resumo.sairam),
      padrinhos: Number(resumo.padrinhos),
      codigos: Number(resumo.codigos),
      enviados: Number(resumo.enviados),
      resgatados: Number(resumo.resgatados),
      diamantes: Number(resumo.diamantes),
    },
    padrinhos: rows.map((r) => ({
      discordId: r.padrinho_id,
      nome: r.nome,
      trouxe: Number(r.trouxe),
      convidados: Number(r.convidados),
      novosDemais: Number(r.novos_demais),
      sairam: Number(r.sairam),
      ultimoEm: ms(r.ultimo_em),
      codigos: Number(r.codigos),
      resgatados: Number(r.resgatados),
      marcosAbertos: r.marcos_abertos,
      quemResgatou: r.quem_resgatou,
    })),
    resgates: resgates.map((r) => ({
      codigo: r.codigo,
      marco: Number(r.marco),
      discordId: r.discord_id,
      nomeDiscord: r.nome_discord,
      nick: r.nick,
      resgatadoEm: ms(r.resgatado_em),
      entregueEm: ms(r.entregue_em),
    })),
  };
}
