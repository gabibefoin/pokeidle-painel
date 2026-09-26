// Persistência de guilds: criação, membros, GP, registro do PvP diário e bônus de ranking.
import { pool } from './db.mjs';
import {
  bonusPctPorPosRanking,
  CUSTO_CRIAR_GUILD,
  MAX_TIME_GUILD,
  BRASAO_EDITAR_MS,
  normalizarBrasao,
  nomeGuildValido,
} from './game/guild.mjs';
import {
  corTagValida,
  MAX_TAG_GUILD,
  motivoTagInvalida,
  TAG_EDITAR_MS,
  tagGuildValida,
  tagPadraoDoNome,
} from '../shared/guild-tag.mjs';

/**
 * Quantos membros a ficha pública de uma guild lista.
 *
 * A guild não tem mais teto de gente, e a ficha desenha um sprite animado por linha: sem um
 * teto AQUI, abrir a guild de mil membros no ranking seria mil bonecos numa tela só. Os
 * escalados vêm primeiro, então o corte só atinge reserva — e a contagem verdadeira viaja em
 * `totalMembros`.
 */
const MAX_MEMBROS_FICHA = 60;

export class ErroGuild extends Error {
  constructor(codigo, msg, extras = {}) {
    super(msg);
    this.codigo = codigo;
    Object.assign(this, extras);
  }
}

export async function migrar() {
  // `gp` é o ranking Diário: zerado toda vez que a Guerra do dia é apurada (ver
  // `zerarGpDiario`), então ele mede "hoje", não a vida inteira da guild — é o que decide o
  // bônus de XP/farm (`bonus_pct` logo abaixo). `gp_global` nunca zera sozinho — só uma vez por
  // mês, no fechamento da Temporada Global (`game/guild-global.mjs`), que paga o pódio em
  // diamante. As duas colunas crescem juntas em todo `adicionarGp`; só o reset é diferente.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guilds (
      id           BIGSERIAL PRIMARY KEY,
      nome         TEXT NOT NULL UNIQUE,
      brasao       JSONB NOT NULL DEFAULT '{}'::jsonb,
      gp           INT NOT NULL DEFAULT 0,
      gp_global    INT NOT NULL DEFAULT 0,
      owner_id     BIGINT NOT NULL REFERENCES players(id),
      bonus_pct    SMALLINT NOT NULL DEFAULT 0,
      criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`ALTER TABLE guilds ADD COLUMN IF NOT EXISTS gp_global INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE guilds ADD COLUMN IF NOT EXISTS brasao_editado_em TIMESTAMPTZ`);
  await pool.query(
    `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS pvp_auto_registro BOOLEAN NOT NULL DEFAULT false`,
  );
  // A TAG: até três letras ao lado do nick no chat, na cor que o dono escolher.
  await pool.query(`ALTER TABLE guilds ADD COLUMN IF NOT EXISTS tag TEXT`);
  await pool.query(`ALTER TABLE guilds ADD COLUMN IF NOT EXISTS tag_cor TEXT`);
  // Quando a tag foi trocada pela última vez. Nula na criação e no backfill de propósito: a
  // PRIMEIRA troca é livre, como no brasão — quem herdou "as três primeiras letras do nome" não
  // escolheu nada, e começar já devendo 24 h de espera por uma escolha que não foi dele seria
  // cobrar pelo padrão.
  await pool.query(`ALTER TABLE guilds ADD COLUMN IF NOT EXISTS tag_editada_em TIMESTAMPTZ`);
  // Backfill: toda guild que já existe ganha as três primeiras letras do próprio nome, que é a
  // mesma regra de `tagPadraoDoNome` — escrita em SQL para não ler mil linhas em JS só para
  // recortar uma string. `WHERE tag IS NULL` faz disto um passo Único sem carimbo em `game_meta`:
  // a coluna nasce nula uma vez só, e quem apagar a própria tag depois grava `''`, não `NULL`.
  //
  // As RESERVADAS ficam de fora aqui também (uma guild "Adm Team" não ganha `[ADM]` de graça):
  // ela nasce sem tag e o dono escolhe uma no painel.
  await pool.query(`
    UPDATE guilds
       SET tag = upper(substring(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g') from 1 for $1))
     WHERE tag IS NULL
       AND upper(substring(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g') from 1 for $1))
           NOT IN ('ADM', 'MOD', 'HLP', 'GM', 'STF', 'DEV', 'BOT', 'SYS')`,
    [MAX_TAG_GUILD]);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guilds_gp ON guilds(gp DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guilds_gp_global ON guilds(gp_global DESC)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_guilds_nome ON guilds(lower(nome))`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_members (
      guild_id    BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      player_id   BIGINT NOT NULL PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      entrou_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guild_members_guild ON guild_members(guild_id)`);
  // O TIME: quem está escalado para a Guerra de Guilds (e, por tabela, quem leva o bônus diário
  // do ranking e o diamante do fechamento mensal). `true` como padrão porque toda guild que já
  // existia cabia inteira no time — o teto de membros era 6, menor que as 10 vagas —, então a
  // migração não precisa escolher ninguém: ela só confirma o que já era verdade.
  await pool.query(
    `ALTER TABLE guild_members ADD COLUMN IF NOT EXISTS escalado BOOLEAN NOT NULL DEFAULT true`,
  );
  // O SUB-DONO: o segundo par de mãos da guild. Ver `mandoNaGuild` logo abaixo para o que ele
  // pode (quase tudo) e o que é só do dono (apagar, transferir e nomear outro sub-dono).
  await pool.query(
    `ALTER TABLE guild_members ADD COLUMN IF NOT EXISTS subdono BOOLEAN NOT NULL DEFAULT false`,
  );
  // A guerra lê "os escalados desta guild" uma vez por evento, e o editor do dono lê a cada
  // abertura. O índice parcial cobre os dois sem pesar no INSERT de quem entra na guild.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_guild_members_escalados
       ON guild_members(guild_id) WHERE escalado`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_pvp_registros (
      guild_id     BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      evento_data  DATE NOT NULL,
      registrado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (guild_id, evento_data)
    )`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_pvp_eventos (
      evento_data  DATE PRIMARY KEY,
      vencedor_id  BIGINT REFERENCES guilds(id),
      iniciado_em  TIMESTAMPTZ,
      encerrado_em TIMESTAMPTZ
    )`);
  // A chave nasceu sem `ON DELETE`, e isso trava o painel admin: apagar a conta de quem lidera
  // uma guild que já venceu um dia estouraria a restrição. O histórico do dia continua valendo
  // sem o vencedor — a guild é que deixou de existir.
  //
  // A troca só acontece enquanto a chave ainda NÃO é `ON DELETE SET NULL` (`confdeltype = 'n'`).
  // Fazer o DROP e o ADD em todo boot era trabalho à toa — e, com os dez sims subindo juntos, um
  // apagava a chave que o outro acabara de criar e o ADD estourava com `already exists`.
  const { rows: fkVencedor } = await pool.query(
    `SELECT confdeltype FROM pg_constraint
      WHERE conname = 'guild_pvp_eventos_vencedor_id_fkey' AND conrelid = 'guild_pvp_eventos'::regclass`,
  );
  if (fkVencedor[0]?.confdeltype !== 'n') {
    await pool.query(`ALTER TABLE guild_pvp_eventos DROP CONSTRAINT IF EXISTS guild_pvp_eventos_vencedor_id_fkey`);
    await pool.query(
      `ALTER TABLE guild_pvp_eventos ADD CONSTRAINT guild_pvp_eventos_vencedor_id_fkey
         FOREIGN KEY (vencedor_id) REFERENCES guilds(id) ON DELETE SET NULL`,
    );
  }

  // A gravação da guerra do dia: o resultado (leve, lido toda vez que alguém abre o painel) e
  // o replay (pesado, só baixado por quem clica em "assistir"). Duas colunas na mesma linha
  // porque a batalha é uma coisa só — mas nunca lidas juntas, e é por isso que
  // `ultimaBatalha` não seleciona `replay`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_pvp_batalhas (
      evento_data  DATE PRIMARY KEY,
      vencedor_id  BIGINT REFERENCES guilds(id) ON DELETE SET NULL,
      resumo       JSONB NOT NULL DEFAULT '{}'::jsonb,
      replay       JSONB,
      criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  // O fechamento mensal do ranking Global (`game/guild-global.mjs`): mesma forma de
  // `guild_pvp_eventos` (reivindicação por INSERT, retomada por trava velha), um mês por linha.
  // `podio` é só para histórico/auditoria — quem levou o quê no fechamento.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_global_temporadas (
      mes          CHAR(7) PRIMARY KEY,   -- 'YYYY-MM', o mês que fechou
      iniciado_em  TIMESTAMPTZ,
      fechado_em   TIMESTAMPTZ,
      podio        JSONB NOT NULL DEFAULT '[]'::jsonb
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guild_batalhas_data ON guild_pvp_batalhas(evento_data DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_invites (
      id            BIGSERIAL PRIMARY KEY,
      guild_id      BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      player_id     BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      convidado_por BIGINT NOT NULL REFERENCES players(id),
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (guild_id, player_id)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_guild_invites_player ON guild_invites(player_id)`);

  // Equipe de guerra de cada membro — separada da equipe de hunt. `null` no carregamento
  // significa "nunca salvou" (cai na equipe montada no slot); `[]` é escolha explícita de ir vazio.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_pvp_equipes (
      player_id     BIGINT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      pokemon_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

async function comTransacao(fn) {
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    const r = await fn(cli);
    await cli.query('COMMIT');
    return r;
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}

function mapGuild(r, ownerNick = null) {
  if (!r) return null;
  return {
    id: Number(r.id),
    nome: r.nome,
    brasao: typeof r.brasao === 'string' ? JSON.parse(r.brasao) : r.brasao,
    gp: Number(r.gp),
    ownerId: Number(r.owner_id),
    ownerNick: ownerNick ?? r.owner_nick ?? null,
    bonusPct: Number(r.bonus_pct) || 0,
    brasaoEditadoEm: r.brasao_editado_em?.getTime?.() ?? null,
    pvpAutoRegistro: !!r.pvp_auto_registro,
    criadoEm: r.criado_em?.getTime?.() ?? null,
    // `|| null` e não `?? null`: a coluna guarda `''` quando o dono apaga a tag, e a string
    // vazia tem de chegar à tela como ausência — senão o chat desenha dois colchetes vazios.
    tag: r.tag || null,
    tagCor: corTagValida(r.tag_cor),
    tagEditadaEm: r.tag_editada_em?.getTime?.() ?? null,
  };
}

/**
 * Quem MANDA na guild deste jogador, e em que grau.
 *
 * Devolve `{ guildId, ehDono, ehSubdono }` — ou lança, se ele não tem guild ou não manda nela.
 *
 * ### O que o sub-dono pode
 *
 * Quase tudo: convidar, expulsar membro comum, escalar o time, trocar o brasão e a tag,
 * registrar a guild na guerra. O que fica SÓ com o dono são as três coisas que mexem em quem
 * manda ou acabam com a guild:
 *
 *   · **apagar a guild** — some com tudo, inclusive com o dono;
 *   · **transferir a liderança** — um sub-dono que pudesse transferir se coroaria sozinho;
 *   · **nomear/tirar sub-dono** — quem controla a permissão controla a guild.
 *
 * As três são "expulsar o dono" escritas de outro jeito, e a regra que o dono pediu é
 * justamente essa: o sub-dono faz tudo, menos tirar o dono do lugar.
 *
 * `soDono` exige o dono de verdade; sem ele, sub-dono passa.
 */
async function mandoNaGuild(q, playerId, { soDono = false } = {}) {
  const { rows } = await q.query(
    `SELECT g.id, g.owner_id, gm.subdono
       FROM guild_members gm
       JOIN guilds g ON g.id = gm.guild_id
      WHERE gm.player_id = $1`,
    [playerId],
  );
  if (!rows.length) throw new ErroGuild('membro', 'Você não está em uma guild.');
  const ehDono = Number(rows[0].owner_id) === Number(playerId);
  const ehSubdono = !!rows[0].subdono;
  if (soDono && !ehDono) throw new ErroGuild('dono', 'guild.soDono');
  if (!ehDono && !ehSubdono) throw new ErroGuild('dono', 'guild.semMando');
  return { guildId: Number(rows[0].id), ehDono, ehSubdono };
}

/**
 * Preenche as vagas livres do TIME com quem entrou primeiro.
 *
 * É o que mantém verdadeira a promessa "guild com dez ou menos está toda escalada", sem o dono
 * precisar tocar em nada: quem entra numa guild com vaga já entra escalado, e a vaga aberta por
 * quem saiu (ou foi expulso) fecha sozinha com o membro mais antigo que estava de fora.
 *
 * A ordem é a de ENTRADA na guild, e não nível ou poder: o critério é o único que o servidor
 * pode defender sem escolher por ninguém — quem chegou antes entra antes. Nível seria o
 * servidor opinando sobre o time do dono, que é justamente a decisão que o editor devolve a ele.
 *
 * Roda dentro da transação de quem a chamou — é sempre a segunda metade de um INSERT ou DELETE
 * em `guild_members`, e as duas coisas precisam valer juntas ou não valer.
 */
async function completarTime(q, guildId) {
  await q.query(
    `UPDATE guild_members SET escalado = true
      WHERE player_id IN (
        SELECT player_id FROM guild_members
         WHERE guild_id = $1 AND NOT escalado
         ORDER BY entrou_em, player_id
         LIMIT GREATEST(0, $2::int - (
           SELECT count(*) FROM guild_members WHERE guild_id = $1 AND escalado))
      )`,
    [guildId, MAX_TIME_GUILD],
  );
}

/** Quantos membros a guild tem e quantos deles estão escalados. */
async function contarMembros(q, guildId) {
  const { rows } = await q.query(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE escalado)::int AS escalados
       FROM guild_members WHERE guild_id = $1`,
    [guildId],
  );
  return { membros: rows[0]?.n ?? 0, escalados: rows[0]?.escalados ?? 0 };
}

/**
 * A guild do jogador, como o estado dele a carrega.
 *
 * `membros` é uma CONTAGEM, não a lista: este objeto viaja no delta de estado a cada sincronia,
 * e com a guild sem teto de tamanho a lista cresceria sem fim dentro do pacote mais quente do
 * jogo. Quem precisa dos membros de verdade pede `guild.detalhe` (a ficha) ou `guild.escalacao`
 * (o editor do dono) — os dois por clique, e não a cada meio segundo.
 */
export async function guildDoJogador(playerId) {
  const { rows } = await pool.query(
    `SELECT g.*, po.nick AS owner_nick, gm.escalado, gm.subdono,
            (SELECT count(*)::int FROM guild_members x WHERE x.guild_id = g.id) AS membros_n,
            (SELECT count(*)::int FROM guild_members x
              WHERE x.guild_id = g.id AND x.escalado) AS escalados_n
       FROM guild_members gm
       JOIN guilds g ON g.id = gm.guild_id
       JOIN players po ON po.id = g.owner_id
      WHERE gm.player_id = $1`,
    [playerId],
  );
  if (!rows.length) return null;
  const g = mapGuild(rows[0]);
  g.membros = Number(rows[0].membros_n) || 0;
  g.escalados = Number(rows[0].escalados_n) || 0;
  g.escalado = !!rows[0].escalado;
  g.isOwner = g.ownerId === playerId;
  g.isSubdono = !!rows[0].subdono;
  return g;
}

/** Só o dono; no máximo uma vez a cada 24 h. */
export async function atualizarBrasao(ownerId, brasaoRaw) {
  const brasao = normalizarBrasao(brasaoRaw);
  const { guildId } = await mandoNaGuild(pool, ownerId);
  const { rows } = await pool.query(
    `SELECT g.id, g.brasao_editado_em FROM guilds g WHERE g.id = $1`,
    [guildId],
  );
  if (!rows.length) throw new ErroGuild('guild', 'Você não lidera nenhuma guild.');
  const editado = rows[0].brasao_editado_em?.getTime?.() ?? 0;
  if (editado && Date.now() - editado < BRASAO_EDITAR_MS) {
    const resta = BRASAO_EDITAR_MS - (Date.now() - editado);
    const horas = Math.max(1, Math.ceil(resta / 3_600_000));
    throw new ErroGuild('cooldown', 'guild.brasaoEspera', { horas });
  }
  await pool.query(
    `UPDATE guilds SET brasao = $2, brasao_editado_em = now() WHERE id = $1`,
    [Number(rows[0].id), JSON.stringify(brasao)],
  );
  return brasao;
}

/**
 * Troca a TAG e a cor dela. Só o dono.
 *
 * Espera de 24 h entre duas trocas, a MESMA do brasão e pela mesma razão — ver `TAG_EDITAR_MS`
 * em `shared/guild-tag.mjs`. A primeira é livre (`tag_editada_em` nulo).
 *
 * Tag vazia APAGA a tag (grava `''`, que é diferente do `NULL` que o backfill procura): é uma
 * escolha legítima, e obrigar uma guild a carregar três letras que ela não quer seria esquisito.
 * Apagar também gasta a vez — senão "apaga e põe de novo" seria a volta livre pela porta dos
 * fundos.
 */
export async function atualizarTagGuild(ownerId, tagRaw, corRaw) {
  const pedida = String(tagRaw ?? '').trim();
  const motivo = pedida ? motivoTagInvalida(pedida) : null;
  if (motivo === 'reservada') throw new ErroGuild('tag', 'guild.tagReservada');
  const tag = pedida ? tagGuildValida(pedida) : '';
  const cor = corTagValida(corRaw);

  const { guildId } = await mandoNaGuild(pool, ownerId);
  const { rows: atual } = await pool.query(
    `SELECT id, tag, tag_cor, tag_editada_em FROM guilds WHERE id = $1`,
    [guildId],
  );
  if (!atual.length) throw new ErroGuild('dono', 'Você não lidera nenhuma guild.');

  // Salvar o que JÁ está gravado não gasta a vez nem recusa: o botão fica disponível na tela e
  // clicar nele sem mudar nada não pode custar um dia de espera.
  const mesmaTag = (atual[0].tag || '') === (tag || '');
  const mesmaCor = corTagValida(atual[0].tag_cor) === cor;
  if (mesmaTag && mesmaCor) {
    return { guildId: Number(atual[0].id), tag: tag || null, tagCor: cor, semMudanca: true };
  }

  const editada = atual[0].tag_editada_em?.getTime?.() ?? 0;
  if (editada && Date.now() - editada < TAG_EDITAR_MS) {
    const resta = TAG_EDITAR_MS - (Date.now() - editada);
    const horas = Math.max(1, Math.ceil(resta / 3_600_000));
    throw new ErroGuild('cooldown', 'guild.tagEspera', { horas });
  }

  const { rows } = await pool.query(
    `UPDATE guilds SET tag = $2, tag_cor = $3, tag_editada_em = now() WHERE id = $1 RETURNING id`,
    [guildId, tag ?? '', cor],
  );
  if (!rows.length) throw new ErroGuild('dono', 'Você não lidera nenhuma guild.');
  return { guildId: Number(rows[0].id), tag: tag || null, tagCor: cor };
}

/**
 * Cria a guild e põe o dono dentro.
 *
 * `cobrarOuro: false` é o caminho do jogo: o sim já tirou o custo do ouro EM MEMÓRIA antes de
 * chamar. O ouro de quem está online só vai para o banco no flush, então cobrar aqui era cobrar de
 * um número velho — e o sim ainda copiava esse número de volta para a memória, apagando o que o
 * jogador tinha gastado (ou ganhado) desde o último flush. Gastar ouro e criar a guild antes do
 * flush devolvia o gasto.
 */
export async function criarGuild(playerId, nomeRaw, brasaoRaw, { cobrarOuro = true, tag: tagRaw, tagCor } = {}) {
  const nome = nomeGuildValido(nomeRaw);
  if (!nome) throw new ErroGuild('nome', 'Nome inválido (3–16 letras, números, espaço, - ou _).');
  const brasao = normalizarBrasao(brasaoRaw);
  // A tag escolhida na criação é OPCIONAL: quem não mexer no campo leva as três primeiras letras
  // do nome. O que não passa é a reservada — aí a guild não nasce, em vez de nascer com outra
  // tag em silêncio; escolher `[MOD]` e receber `[MO]` seria pior do que ouvir um não.
  const pedida = String(tagRaw ?? '').trim();
  if (pedida && motivoTagInvalida(pedida) === 'reservada') {
    throw new ErroGuild('tag', 'guild.tagReservada');
  }
  const tag = (pedida ? tagGuildValida(pedida) : null) ?? tagPadraoDoNome(nome);
  const cor = corTagValida(tagCor);

  return comTransacao(async (q) => {
    const { rows: ja } = await q.query(`SELECT 1 FROM guild_members WHERE player_id = $1`, [playerId]);
    if (ja.length) throw new ErroGuild('membro', 'Você já está em uma guild.');

    await q.query(`DELETE FROM guild_invites WHERE player_id = $1`, [playerId]);

    let ouro = [{ gold: null }];
    if (cobrarOuro) {
      ({ rows: ouro } = await q.query(
        `UPDATE players SET gold = gold - $2
          WHERE id = $1 AND gold >= $2
          RETURNING gold`,
        [playerId, CUSTO_CRIAR_GUILD],
      ));
      if (!ouro.length) throw new ErroGuild('ouro', `Precisa de ${CUSTO_CRIAR_GUILD.toLocaleString('pt-BR')} coins.`);
    }

    const { rows: gRows } = await q.query(
      `INSERT INTO guilds (nome, brasao, owner_id, tag, tag_cor)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nome, JSON.stringify(brasao), playerId, tag, cor],
    );
    const guild = mapGuild(gRows[0]);
    // O dono nasce escalado: guild de um membro está toda no time, e é ele.
    await q.query(
      `INSERT INTO guild_members (guild_id, player_id, escalado) VALUES ($1, $2, true)`,
      [guild.id, playerId],
    );
    guild.membros = 1;
    guild.escalados = 1;
    guild.escalado = true;
    guild.isOwner = true;
    return { guild, gold: ouro[0].gold == null ? null : Number(ouro[0].gold) };
  });
}

export async function convidarMembro(ownerId, nickAlvo) {
  const alvo = String(nickAlvo ?? '').trim();
  if (!alvo) throw new ErroGuild('nick', 'Informe um nick.');

  return comTransacao(async (q) => {
    // Dono OU sub-dono: chamar gente é o trabalho que mais se divide entre os dois.
    const { guildId } = await mandoNaGuild(q, ownerId);
    const { rows: gRows } = await q.query(`SELECT g.* FROM guilds g WHERE g.id = $1`, [guildId]);
    const guild = mapGuild(gRows[0]);

    // Sem teto de membros: a guild aceita quanta gente o dono quiser chamar. O que é limitado é
    // o TIME que vai à guerra (`MAX_TIME_GUILD`) — ver `definirEscalacao`.
    const { rows: alvoRows } = await q.query(`SELECT id, nick FROM players WHERE lower(nick) = lower($1)`, [alvo]);
    if (!alvoRows.length) throw new ErroGuild('nick', 'Treinador não encontrado.');
    const alvoId = Number(alvoRows[0].id);
    if (alvoId === ownerId) throw new ErroGuild('nick', 'Você já está na guild.');

    const { rows: ja } = await q.query(`SELECT 1 FROM guild_members WHERE player_id = $1`, [alvoId]);
    if (ja.length) throw new ErroGuild('membro', 'Esse treinador já está em uma guild.');

    const { rows: pend } = await q.query(
      `SELECT 1 FROM guild_invites WHERE guild_id = $1 AND player_id = $2`,
      [guild.id, alvoId],
    );
    if (pend.length) throw new ErroGuild('convite', 'Já existe um convite pendente para esse treinador.');

    await q.query(
      `INSERT INTO guild_invites (guild_id, player_id, convidado_por) VALUES ($1, $2, $3)`,
      [guild.id, alvoId, ownerId],
    );
    return { guildId: guild.id, alvoId, nick: alvoRows[0].nick };
  });
}

export async function convitesPendentes(playerId) {
  const { rows } = await pool.query(
    `SELECT gi.id, gi.guild_id, g.nome AS guild_nome, g.brasao, g.gp, po.nick AS de_nick
       FROM guild_invites gi
       JOIN guilds g ON g.id = gi.guild_id
       JOIN players po ON po.id = gi.convidado_por
      WHERE gi.player_id = $1
      ORDER BY gi.criado_em DESC`,
    [playerId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    guildId: Number(r.guild_id),
    guildNome: r.guild_nome,
    brasao: typeof r.brasao === 'string' ? JSON.parse(r.brasao) : r.brasao,
    gp: Number(r.gp),
    deNick: r.de_nick,
  }));
}

export async function aceitarConvite(playerId, inviteId) {
  const id = Number(inviteId);
  return comTransacao(async (q) => {
    const { rows: inv } = await q.query(
      `SELECT gi.*, g.nome FROM guild_invites gi JOIN guilds g ON g.id = gi.guild_id
        WHERE gi.id = $1 AND gi.player_id = $2`,
      [id, playerId],
    );
    if (!inv.length) throw new ErroGuild('convite', 'Convite não encontrado.');

    const { rows: ja } = await q.query(`SELECT 1 FROM guild_members WHERE player_id = $1`, [playerId]);
    if (ja.length) throw new ErroGuild('membro', 'Você já está em uma guild.');

    const guildId = Number(inv[0].guild_id);

    // Entra escalado se ainda houver vaga no time; senão entra como reserva e o dono escala
    // quando quiser. O `FOR UPDATE` na linha da guild serializa os aceites da MESMA guild: sem
    // ele, dois convites aceitos no mesmo segundo leriam "9 escalados" os dois e a guild entraria
    // na guerra com onze em campo.
    await q.query(`SELECT id FROM guilds WHERE id = $1 FOR UPDATE`, [guildId]);
    const { escalados } = await contarMembros(q, guildId);
    await q.query(
      `INSERT INTO guild_members (guild_id, player_id, escalado) VALUES ($1, $2, $3)`,
      [guildId, playerId, escalados < MAX_TIME_GUILD],
    );
    await q.query(`DELETE FROM guild_invites WHERE player_id = $1`, [playerId]);
    return { guildId, nome: inv[0].nome };
  });
}

export async function recusarConvite(playerId, inviteId) {
  const id = Number(inviteId);
  const { rowCount } = await pool.query(
    `DELETE FROM guild_invites WHERE id = $1 AND player_id = $2`,
    [id, playerId],
  );
  if (!rowCount) throw new ErroGuild('convite', 'Convite não encontrado.');
  return true;
}

export async function sairDaGuild(playerId) {
  return comTransacao(async (q) => {
    const { rows } = await q.query(
      `SELECT g.id, g.owner_id FROM guild_members gm
         JOIN guilds g ON g.id = gm.guild_id
        WHERE gm.player_id = $1`,
      [playerId],
    );
    if (!rows.length) throw new ErroGuild('membro', 'Você não está em uma guild.');
    if (Number(rows[0].owner_id) === playerId) {
      throw new ErroGuild('dono', 'O dono não pode sair — apague a guild.');
    }
    const guildId = Number(rows[0].id);
    await q.query(`DELETE FROM guild_members WHERE player_id = $1`, [playerId]);
    // Quem sai escalado abre uma vaga no time; ela fecha sozinha com o reserva mais antigo, em
    // vez de a guild ir à guerra com nove até o dono perceber.
    await completarTime(q, guildId);
    return { guildId };
  });
}

export async function expulsarMembro(ownerId, playerIdAlvo) {
  const alvoId = Number(playerIdAlvo);
  if (!Number.isFinite(alvoId)) throw new ErroGuild('membro', 'Membro inválido.');
  return comTransacao(async (q) => {
    const { guildId, ehDono } = await mandoNaGuild(q, ownerId);
    if (alvoId === ownerId) throw new ErroGuild('dono', 'guild.naoSeExpulsa');

    const { rows: alvo } = await q.query(
      `SELECT gm.subdono, g.owner_id
         FROM guild_members gm JOIN guilds g ON g.id = gm.guild_id
        WHERE gm.guild_id = $1 AND gm.player_id = $2`,
      [guildId, alvoId],
    );
    if (!alvo.length) throw new ErroGuild('membro', 'Esse treinador não está na sua guild.');
    // O DONO nunca é expulso, por ninguém. E o sub-dono só expulsa membro COMUM: deixar dois
    // sub-donos se expulsarem transformaria a promoção numa corrida de quem clica primeiro.
    if (Number(alvo[0].owner_id) === alvoId) throw new ErroGuild('dono', 'guild.donoNaoSaiExpulso');
    if (!ehDono && alvo[0].subdono) throw new ErroGuild('dono', 'guild.subNaoExpulsaSub');

    await q.query(
      `DELETE FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, alvoId],
    );
    await completarTime(q, guildId);
    return { guildId, playerId: alvoId };
  });
}

/**
 * Passa a liderança para outro membro. Só quem é `owner_id` no banco consegue — o `UPDATE` exige
 * `owner_id = $3` para fechar corrida de dois cliques e para recusar se o cliente estiver com
 * cache velho de `isOwner`. O alvo precisa estar em `guild_members` da mesma guild.
 */
export async function transferirLideranca(ownerId, novoOwnerId) {
  const alvoId = Number(novoOwnerId);
  if (!Number.isFinite(alvoId)) throw new ErroGuild('membro', 'Membro inválido.');
  if (alvoId === ownerId) throw new ErroGuild('membro', 'Você já é o dono.');
  return comTransacao(async (q) => {
    const { rows: gRows } = await q.query(`SELECT id FROM guilds WHERE owner_id = $1`, [ownerId]);
    if (!gRows.length) throw new ErroGuild('dono', 'Você não lidera uma guild.');
    const guildId = Number(gRows[0].id);

    const { rows: membro } = await q.query(
      `SELECT p.nick FROM guild_members gm JOIN players p ON p.id = gm.player_id
        WHERE gm.guild_id = $1 AND gm.player_id = $2`,
      [guildId, alvoId],
    );
    if (!membro.length) throw new ErroGuild('membro', 'Esse treinador não está na sua guild.');

    const { rowCount } = await q.query(
      `UPDATE guilds SET owner_id = $2 WHERE id = $1 AND owner_id = $3`,
      [guildId, alvoId, ownerId],
    );
    if (!rowCount) throw new ErroGuild('dono', 'Você não lidera mais esta guild.');
    // Quem virou dono deixa de ser sub-dono (seria a mesma permissão escrita duas vezes), e
    // quem SAIU da liderança vira sub-dono: transferir é passar o leme, não ser despejado — e
    // um ex-dono virando membro comum de um clique perderia até o direito de convidar.
    await q.query(
      `UPDATE guild_members SET subdono = (player_id = $3)
        WHERE guild_id = $1 AND player_id IN ($2, $3)`,
      [guildId, alvoId, ownerId],
    );

    return { guildId, novoOwnerId: alvoId, nick: membro[0].nick };
  });
}

// ------------------------------------------------------- o TIME da guild (a escalação)
//
// A guild não tem teto de gente, mas a guerra é de `MAX_TIME_GUILD` por guild. Quem escolhe os
// escalados é o dono; quem garante que a vaga nunca fica vazia é `completarTime`.

/**
 * A lista de membros para o editor de escalação do dono — LEVE de propósito.
 *
 * Nada de equipe de guerra nem de sprite aqui: numa guild de trezentos, a ficha pública
 * (`detalheDaGuild`) traria mil e quinhentas linhas de pokémon para uma tela que só precisa de
 * caixinhas de seleção. Escalados primeiro, depois por nível — é a ordem em que a decisão se
 * toma ("quem está no time?" e "quem é forte o bastante para entrar?").
 */
export async function membrosParaEscalacao(guildId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.nick, p.level, p.last_seen, gm.entrou_em, gm.escalado, gm.subdono
       FROM guild_members gm
       JOIN players p ON p.id = gm.player_id
      WHERE gm.guild_id = $1
      ORDER BY gm.escalado DESC, p.level DESC, gm.entrou_em`,
    [guildId],
  );
  return rows.map((r) => ({
    playerId: Number(r.id),
    nick: r.nick,
    level: Number(r.level) || 1,
    escalado: !!r.escalado,
    subdono: !!r.subdono,
    entrouEm: r.entrou_em?.getTime?.() ?? null,
    lastSeen: r.last_seen?.getTime?.() ?? null,
  }));
}

/**
 * Grava o time do dono: exatamente quem ele marcou, e o resto vira reserva.
 *
 * `completarTime` no fim não é cosmético — é a regra "o time nunca vai à guerra com vaga vazia".
 * Marcar quatro numa guild de trinta escala os quatro e preenche as outras seis com os reservas
 * mais antigos; numa guild de oito, marcar quatro devolve os oito ao time, porque não há
 * ninguém de fora para reservar. É assim que "guild com dez ou menos está toda escalada"
 * continua verdade sem o dono precisar saber disso.
 */
export async function definirEscalacao(ownerId, playerIdsRaw) {
  const pedidos = [
    ...new Set((Array.isArray(playerIdsRaw) ? playerIdsRaw : []).map(Number).filter(Number.isFinite)),
  ];
  if (pedidos.length > MAX_TIME_GUILD) {
    throw new ErroGuild('limite', `O time da guild tem ${MAX_TIME_GUILD} vagas.`);
  }
  return comTransacao(async (q) => {
    const { guildId } = await mandoNaGuild(q, ownerId);
    // `FOR UPDATE` pela mesma razão de `aceitarConvite`: um aceite no meio desta troca poderia
    // somar um escalado por cima dos dez que o dono acabou de definir.
    await q.query(`SELECT id FROM guilds WHERE id = $1 FOR UPDATE`, [guildId]);

    if (pedidos.length) {
      const { rows: ok } = await q.query(
        `SELECT player_id FROM guild_members WHERE guild_id = $1 AND player_id = ANY($2::bigint[])`,
        [guildId, pedidos],
      );
      if (ok.length !== pedidos.length) {
        throw new ErroGuild('membro', 'Um ou mais treinadores não estão mais na guild.');
      }
    }

    await q.query(
      `UPDATE guild_members SET escalado = (player_id = ANY($2::bigint[])) WHERE guild_id = $1`,
      [guildId, pedidos],
    );
    await completarTime(q, guildId);
    return { guildId };
  });
}

/**
 * Nomeia (ou tira) um SUB-DONO. Só o dono — ver `mandoNaGuild`.
 *
 * Sem teto de quantos: a guild perdeu o teto de membros, e amarrar "só dois sub-donos" numa de
 * duzentos seria inventar um limite que o dono não pediu. Quem responde por eles é ele.
 */
export async function definirSubdono(ownerId, alvoIdRaw, ligado) {
  const alvoId = Number(alvoIdRaw);
  if (!Number.isFinite(alvoId)) throw new ErroGuild('membro', 'Membro inválido.');
  if (alvoId === ownerId) throw new ErroGuild('membro', 'guild.donoJaManda');
  return comTransacao(async (q) => {
    const { guildId } = await mandoNaGuild(q, ownerId, { soDono: true });
    const { rows: membro } = await q.query(
      `SELECT p.nick FROM guild_members gm JOIN players p ON p.id = gm.player_id
        WHERE gm.guild_id = $1 AND gm.player_id = $2`,
      [guildId, alvoId],
    );
    if (!membro.length) throw new ErroGuild('membro', 'Esse treinador não está na sua guild.');
    await q.query(
      `UPDATE guild_members SET subdono = $3 WHERE guild_id = $1 AND player_id = $2`,
      [guildId, alvoId, !!ligado],
    );
    return { guildId, playerId: alvoId, nick: membro[0].nick, subdono: !!ligado };
  });
}

export async function apagarGuild(ownerId) {
  return comTransacao(async (q) => {
    const { rows } = await q.query(`DELETE FROM guilds WHERE owner_id = $1 RETURNING id`, [ownerId]);
    if (!rows.length) throw new ErroGuild('dono', 'Você não lidera uma guild.');
    return { guildId: Number(rows[0].id) };
  });
}

/** Ranking DIÁRIO (`gp`, zerado toda guerra) — é o que dá bônus de XP/farm por posição. */
export async function rankingGuild(limite = 50) {
  const { rows } = await pool.query(
    `SELECT g.id, g.nome, g.gp, g.brasao, g.bonus_pct, g.tag, g.tag_cor,
            (SELECT count(*)::int FROM guild_members gm WHERE gm.guild_id = g.id) AS membros,
            po.nick AS owner_nick
       FROM guilds g
       JOIN players po ON po.id = g.owner_id
      ORDER BY g.gp DESC, g.id ASC
      LIMIT $1`,
    [limite],
  );
  return rows.map((r, i) => ({
    pos: i + 1,
    id: Number(r.id),
    nome: r.nome,
    gp: Number(r.gp),
    brasao: typeof r.brasao === 'string' ? JSON.parse(r.brasao) : r.brasao,
    bonusPct: Number(r.bonus_pct) || 0,
    membros: Number(r.membros),
    ownerNick: r.owner_nick,
    tag: r.tag || null,
    tagCor: corTagValida(r.tag_cor),
  }));
}

/**
 * Ranking GLOBAL (`gp_global`, só zera no fechamento do mês) — sem bônus de %; o pódio leva
 * diamante no fechamento (ver `game/guild-global.mjs`). Mesmo formato de linha de `rankingGuild`
 * (inclusive o campo `gp`, que aqui é o valor de `gp_global`) para o cliente reaproveitar o
 * mesmo desenho sem precisar saber a diferença.
 */
export async function rankingGuildGlobal(limite = 50) {
  const { rows } = await pool.query(
    `SELECT g.id, g.nome, g.gp_global, g.brasao, g.tag, g.tag_cor,
            (SELECT count(*)::int FROM guild_members gm WHERE gm.guild_id = g.id) AS membros,
            po.nick AS owner_nick
       FROM guilds g
       JOIN players po ON po.id = g.owner_id
      ORDER BY g.gp_global DESC, g.id ASC
      LIMIT $1`,
    [limite],
  );
  return rows.map((r, i) => ({
    pos: i + 1,
    id: Number(r.id),
    nome: r.nome,
    gp: Number(r.gp_global),
    brasao: typeof r.brasao === 'string' ? JSON.parse(r.brasao) : r.brasao,
    membros: Number(r.membros),
    ownerNick: r.owner_nick,
    tag: r.tag || null,
    tagCor: corTagValida(r.tag_cor),
  }));
}

/** Posição no ranking de GP (1 = mais GP). Zero se a guild não tem GP. */
export async function posicaoRankingGp(guildId) {
  const { rows } = await pool.query(
    `SELECT pos::int AS pos FROM (
       SELECT id, ROW_NUMBER() OVER (ORDER BY gp DESC, id ASC) AS pos
         FROM guilds
        WHERE gp > 0
     ) r
     WHERE id = $1`,
    [guildId],
  );
  return rows[0]?.pos ?? 0;
}

/** Recalcula o bônus % por posição no ranking de GP (só guilds com GP > 0). */
export async function atualizarBonusRanking() {
  await pool.query(`UPDATE guilds SET bonus_pct = 0`);
  const { rows } = await pool.query(
    `SELECT id FROM guilds WHERE gp > 0 ORDER BY gp DESC, id ASC`,
  );
  for (let i = 0; i < rows.length; i++) {
    const pct = bonusPctPorPosRanking(i + 1);
    if (pct) await pool.query(`UPDATE guilds SET bonus_pct = $2 WHERE id = $1`, [rows[i].id, pct]);
  }
}

/** Soma nos dois placares — o diário (`gp`) e o que nunca zera sozinho (`gp_global`). */
export async function adicionarGp(guildId, delta) {
  await pool.query(`UPDATE guilds SET gp = gp + $2, gp_global = gp_global + $2 WHERE id = $1`, [guildId, delta]);
}

/**
 * Zera o ranking Diário de TODA guild — chamado uma vez por dia, antes de a guerra apurar o
 * resultado (ver `rodarGuerra` em `game/guild-pvp.mjs`). Sem isto, `gp` seria um acumulado para
 * sempre, e é exatamente esse acumulado que motivou a separação: quem já lidera não larga mais
 * o bônus, e guild nova nunca alcança. `UPDATE` puro é idempotente — não precisa de guarda
 * contra rodar mais de uma vez no mesmo dia.
 */
export async function zerarGpDiario() {
  await pool.query(`UPDATE guilds SET gp = 0`);
}

/** Zera o ranking Global de TODA guild — só no fechamento mensal (`game/guild-global.mjs`). */
export async function zerarGpGlobal() {
  await pool.query(`UPDATE guilds SET gp_global = 0`);
}

export function dataEventoGuild(agora = Date.now()) {
  const d = new Date(agora);
  return d.toISOString().slice(0, 10);
}

export async function registrarGuildPvp(guildId, ownerId, dataEvento) {
  const mando = await mandoNaGuild(pool, ownerId);
  if (mando.guildId !== Number(guildId)) {
    throw new ErroGuild('dono', 'Somente o dono pode registrar a guild.');
  }

  await pool.query(`UPDATE guilds SET pvp_auto_registro = true WHERE id = $1`, [guildId]);
  await pool.query(
    `INSERT INTO guild_pvp_registros (guild_id, evento_data) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [guildId, dataEvento],
  );
  return true;
}

/** Inscreve no dia todas as guilds com registro automático ligado. Idempotente. */
export async function registrarGuildsAutomaticas(dataEvento) {
  await pool.query(
    `INSERT INTO guild_pvp_registros (guild_id, evento_data)
     SELECT id, $1 FROM guilds WHERE pvp_auto_registro = true
     ON CONFLICT DO NOTHING`,
    [dataEvento],
  );
}

export async function registrosPvpDoDia(dataEvento) {
  const { rows } = await pool.query(
    `SELECT g.id, g.nome, g.brasao, g.gp, g.gp_global,
            (SELECT count(*)::int FROM guild_members gm WHERE gm.guild_id = g.id) AS membros
       FROM guild_pvp_registros r
       JOIN guilds g ON g.id = r.guild_id
      WHERE r.evento_data = $1
      ORDER BY g.gp DESC, g.nome`,
    [dataEvento],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    nome: r.nome,
    gp: Number(r.gp),
    gpGlobal: Number(r.gp_global) || 0,
    membros: Number(r.membros),
    brasao: typeof r.brasao === 'string' ? JSON.parse(r.brasao) : r.brasao,
  }));
}

export async function guildIdsRegistradas(dataEvento) {
  const { rows } = await pool.query(
    `SELECT guild_id FROM guild_pvp_registros WHERE evento_data = $1`,
    [dataEvento],
  );
  return rows.map((r) => Number(r.guild_id));
}

export async function marcarEventoEncerrado(dataEvento, vencedorId) {
  await pool.query(
    `INSERT INTO guild_pvp_eventos (evento_data, vencedor_id, encerrado_em)
     VALUES ($1, $2, now())
     ON CONFLICT (evento_data) DO UPDATE
       SET vencedor_id = EXCLUDED.vencedor_id, encerrado_em = now()`,
    [dataEvento, vencedorId],
  );
}

export async function eventoEncerrado(dataEvento) {
  const { rows } = await pool.query(
    `SELECT vencedor_id FROM guild_pvp_eventos WHERE evento_data = $1 AND encerrado_em IS NOT NULL`,
    [dataEvento],
  );
  return rows.length > 0;
}

/**
 * Os ESCALADOS da guild — quem levanta o prêmio do fechamento mensal.
 *
 * O diamante da Temporada Global segue quem lutou, não quem está na lista de membros: sem isso,
 * uma guild de duzentos convertidos em massa pagaria duzentos prêmios por uma guerra que dez
 * jogaram, e convidar gente ao acaso passaria a valer mais do que ganhar a guerra.
 */
export async function playerIdsEscalados(guildId) {
  const { rows } = await pool.query(
    `SELECT player_id FROM guild_members WHERE guild_id = $1 AND escalado`,
    [guildId],
  );
  return rows.map((r) => Number(r.player_id));
}

// ------------------------------------------------------- a guerra do dia (offline)
//
// A guerra deixou de ser uma arena ao vivo (ver o cabeçalho de `game/guild-pvp-sim.mjs`) e
// virou um trabalho que roda uma vez por dia. Como o cluster tem um processo de simulação por
// shard, e TODOS eles acordam na mesma hora, a corrida é resolvida aqui: quem conseguir
// INSERIR a linha do dia é o dono da batalha; os outros veem o conflito e não fazem nada.

/**
 * Tenta ficar com a batalha do dia. `true` só para UM processo do cluster.
 *
 * O segundo caminho (o UPDATE) é a rede de segurança: um processo que morra no meio da
 * simulação deixaria o dia reivindicado e sem resultado para sempre. Passados 10 minutos sem
 * `encerrado_em`, outro processo pode assumir — a simulação inteira leva segundos, então uma
 * reivindicação viva nunca chega perto desse prazo.
 */
export async function reivindicarEvento(dataEvento) {
  const { rows } = await pool.query(
    `INSERT INTO guild_pvp_eventos (evento_data, iniciado_em) VALUES ($1, now())
     ON CONFLICT (evento_data) DO NOTHING
     RETURNING evento_data`,
    [dataEvento],
  );
  if (rows.length) return true;

  const { rows: retomadas } = await pool.query(
    `UPDATE guild_pvp_eventos SET iniciado_em = now()
      WHERE evento_data = $1
        AND encerrado_em IS NULL
        AND iniciado_em < now() - interval '10 minutes'
      RETURNING evento_data`,
    [dataEvento],
  );
  return retomadas.length > 0;
}

/** Devolve o dia ao pool quando a simulação nem chegou a começar (nenhuma guild registrada). */
export async function liberarEvento(dataEvento) {
  await pool.query(`DELETE FROM guild_pvp_eventos WHERE evento_data = $1 AND encerrado_em IS NULL`, [
    dataEvento,
  ]);
}

// ------------------------------------------------------- temporada global (mensal)
//
// Mesma corrida de `reivindicarEvento`/`liberarEvento`/`marcarEventoEncerrado`, só que uma vez
// por MÊS em vez de uma vez por dia: quem conseguir INSERIR o mês fechado é quem paga o pódio e
// zera `gp_global`; os outros processos do cluster veem o conflito e não fazem nada.

/** Tenta ficar com o fechamento do mês. `true` só para UM processo do cluster. */
export async function reivindicarTemporada(mes) {
  const { rows } = await pool.query(
    `INSERT INTO guild_global_temporadas (mes, iniciado_em) VALUES ($1, now())
     ON CONFLICT (mes) DO NOTHING
     RETURNING mes`,
    [mes],
  );
  if (rows.length) return true;

  const { rows: retomadas } = await pool.query(
    `UPDATE guild_global_temporadas SET iniciado_em = now()
      WHERE mes = $1
        AND fechado_em IS NULL
        AND iniciado_em < now() - interval '30 minutes'
      RETURNING mes`,
    [mes],
  );
  return retomadas.length > 0;
}

/** Devolve o mês ao pool quando o fechamento falhou antes de terminar. */
export async function liberarTemporada(mes) {
  await pool.query(`DELETE FROM guild_global_temporadas WHERE mes = $1 AND fechado_em IS NULL`, [mes]);
}

/** Registra o pódio pago e marca o mês como fechado — para sempre; não roda de novo. */
export async function fecharTemporada(mes, podio) {
  await pool.query(
    `UPDATE guild_global_temporadas SET fechado_em = now(), podio = $2 WHERE mes = $1`,
    [mes, JSON.stringify(podio ?? [])],
  );
}

/**
 * Apaga o resultado de um dia para ele poder ser disputado de novo.
 *
 * Só para `tools/guerra-agora.mjs --refazer`: o GP já pago NÃO volta (seria preciso saber
 * quanto cada guild levou naquela rodada, e o valor já se misturou ao total). Em dev isso é
 * irrelevante; em produção, use com essa ressalva na cabeça.
 */
export async function apagarBatalha(dataEvento) {
  await pool.query(`DELETE FROM guild_pvp_batalhas WHERE evento_data = $1`, [dataEvento]);
  await pool.query(`DELETE FROM guild_pvp_eventos WHERE evento_data = $1`, [dataEvento]);
}

export async function salvarBatalha(dataEvento, vencedorId, resumo, replay) {
  await pool.query(
    `INSERT INTO guild_pvp_batalhas (evento_data, vencedor_id, resumo, replay)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (evento_data) DO UPDATE
       SET vencedor_id = EXCLUDED.vencedor_id,
           resumo = EXCLUDED.resumo,
           replay = EXCLUDED.replay,
           criado_em = now()`,
    [dataEvento, vencedorId, JSON.stringify(resumo ?? {}), replay ? JSON.stringify(replay) : null],
  );
}

const mapBatalha = (r) =>
  r && {
    dia: typeof r.evento_data === 'string' ? r.evento_data : r.evento_data.toISOString().slice(0, 10),
    vencedorId: r.vencedor_id == null ? null : Number(r.vencedor_id),
    resumo: typeof r.resumo === 'string' ? JSON.parse(r.resumo) : r.resumo,
    temReplay: !!r.tem_replay,
    replay: r.replay == null ? null : typeof r.replay === 'string' ? JSON.parse(r.replay) : r.replay,
  };

/** O resultado da guerra mais recente — SEM o replay, que é o que pesa. */
export async function ultimaBatalha() {
  const { rows } = await pool.query(
    `SELECT evento_data, vencedor_id, resumo, (replay IS NOT NULL) AS tem_replay
       FROM guild_pvp_batalhas
      ORDER BY evento_data DESC
      LIMIT 1`,
  );
  return rows.length ? mapBatalha(rows[0]) : null;
}

/** A gravação de um dia (ou a mais recente, quando `dataEvento` vem vazio). */
export async function replayDaBatalha(dataEvento = null) {
  const { rows } = dataEvento
    ? await pool.query(
        `SELECT evento_data, vencedor_id, resumo, replay, true AS tem_replay
           FROM guild_pvp_batalhas WHERE evento_data = $1`,
        [dataEvento],
      )
    : await pool.query(
        `SELECT evento_data, vencedor_id, resumo, replay, true AS tem_replay
           FROM guild_pvp_batalhas WHERE replay IS NOT NULL
          ORDER BY evento_data DESC LIMIT 1`,
      );
  return rows.length ? mapBatalha(rows[0]) : null;
}

/** `null` = nunca salvou (guerra usa a equipe de hunt); array = escolha explícita do jogador. */
export async function equipeGuerraSalva(playerId) {
  const { rows } = await pool.query(
    `SELECT pokemon_ids FROM guild_pvp_equipes WHERE player_id = $1`,
    [playerId],
  );
  if (!rows.length) return null;
  const bruto = rows[0].pokemon_ids;
  const ids = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
  if (!Array.isArray(ids)) return [];
  return ids.map(Number).filter(Number.isFinite);
}

/**
 * Grava até cinco pokémon para a Guerra de Guilds. Só aceita bichos do jogador e fora do Market.
 */
export async function salvarEquipeGuerra(playerId, pokemonIdsRaw, maxEquipe = 5) {
  const pedidos = [...new Set((Array.isArray(pokemonIdsRaw) ? pokemonIdsRaw : []).map(Number).filter(Number.isFinite))];
  if (pedidos.length > maxEquipe) {
    throw new ErroGuild('limite', `Máximo de ${maxEquipe} pokémon na equipe de guerra.`);
  }

  return comTransacao(async (q) => {
    const { rows: membro } = await q.query(`SELECT 1 FROM guild_members WHERE player_id = $1`, [playerId]);
    if (!membro.length) throw new ErroGuild('membro', 'Você não está em uma guild.');

    if (pedidos.length) {
      const { rows: ok } = await q.query(
        `SELECT id FROM player_pokemon
          WHERE player_id = $1 AND anuncio_id IS NULL AND id = ANY($2::bigint[])`,
        [playerId, pedidos],
      );
      if (ok.length !== pedidos.length) {
        throw new ErroGuild('pokemon', 'Um ou mais pokémon não estão mais disponíveis.');
      }
    }

    await q.query(
      `INSERT INTO guild_pvp_equipes (player_id, pokemon_ids, atualizado_em)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (player_id) DO UPDATE
         SET pokemon_ids = EXCLUDED.pokemon_ids, atualizado_em = now()`,
      [playerId, JSON.stringify(pedidos)],
    );
    return pedidos;
  });
}

/**
 * A FICHA PÚBLICA de uma guild: quem está nela e com que equipe cada um vai à guerra.
 *
 * É o que o card do Ranking de Guilds abre. Até aqui o ranking mostrava nome, dono e GP — e
 * mais nada: não dava para saber se a guild em primeiro tem quarenta membros de nível 20 ou
 * cinco de nível 600, que é exatamente o que decide se vale a pena desafiá-la ou pedir para
 * entrar.
 *
 * ### Por que uma consulta própria e não `membrosParaGuerra`
 *
 * Aquela ali seleciona só as colunas que o SIMULADOR precisa (`pp.id AS pk_id`, sem `xp`, sem
 * `hp`, sem `tm_aoe`). Esta devolve `pp.*`, que é o que `montarPokemon` no sim consome sem
 * adaptador nenhum — e é assim que a ficha aberta daqui sai IGUAL à do Mercado e à do placar,
 * em vez de ser uma quarta variante de ficha de pokémon.
 *
 * A regra de qual equipe aparece é a MESMA da guerra: quem salvou uma equipe de guerra mostra
 * essa; quem nunca salvou mostra a equipe de hunt. Mostrar outra coisa seria mentir sobre o
 * que aquele membro leva para a arena.
 */
export async function detalheDaGuild(guildId) {
  const { rows: cab } = await pool.query(
    `SELECT g.*, po.nick AS owner_nick
       FROM guilds g
       JOIN players po ON po.id = g.owner_id
      WHERE g.id = $1`,
    [guildId],
  );
  if (!cab.length) return null;
  const guild = mapGuild(cab[0]);

  // Escalados primeiro: a ficha responde "essa guild é forte?", e quem responde isso é o TIME.
  // O teto de linhas existe porque a guild deixou de ter teto de membros — numa de mil, a lista
  // inteira seria um sprite animado por linha numa tela só. `totalMembros` conta a verdade.
  const { rows: membros } = await pool.query(
    `SELECT p.id, p.nick, p.level, p.looktype, p.visual, p.last_seen, gm.entrou_em, gm.escalado, gm.subdono
       FROM guild_members gm
       JOIN players p ON p.id = gm.player_id
      WHERE gm.guild_id = $1
      ORDER BY (p.id = $3) DESC, gm.subdono DESC, gm.escalado DESC, p.level DESC, gm.entrou_em
      LIMIT $2`,
    [guildId, MAX_MEMBROS_FICHA, guild.ownerId],
  );
  const { membros: totalMembros, escalados } = await contarMembros(pool, guildId);

  // A ordem preserva a escolhida em "Editar meu Time" (ver o mesmo `WITH ORDINALITY` em
  // `membrosParaGuerra`) — a ficha pública mostra o time na MESMA ordem em que ele entra na
  // guerra, e não reordenado por `pp.id`.
  const { rows: pks } = await pool.query(
    `SELECT gm.player_id AS dono_id, pp.*
       FROM guild_members gm
       LEFT JOIN guild_pvp_equipes gpe ON gpe.player_id = gm.player_id
       LEFT JOIN LATERAL jsonb_array_elements_text(coalesce(gpe.pokemon_ids, '[]'::jsonb))
                 WITH ORDINALITY AS ord(pk_id_txt, posicao) ON true
       JOIN player_pokemon pp
              ON pp.player_id = gm.player_id
             AND pp.anuncio_id IS NULL
             AND (
               (gpe.player_id IS NOT NULL AND pp.id = ord.pk_id_txt::bigint)
               OR (gpe.player_id IS NULL AND pp.slot IS NOT NULL)
             )
      WHERE gm.guild_id = $1 AND gm.escalado
      ORDER BY gm.player_id,
               CASE WHEN gpe.player_id IS NOT NULL THEN ord.posicao ELSE pp.slot END`,
    [guildId],
  );

  const porJogador = new Map();
  for (const r of pks) {
    const id = Number(r.dono_id);
    if (!porJogador.has(id)) porJogador.set(id, []);
    porJogador.get(id).push(r);
  }

  return {
    id: guild.id,
    nome: guild.nome,
    brasao: guild.brasao,
    gp: guild.gp,
    bonusPct: guild.bonusPct,
    ownerId: guild.ownerId,
    ownerNick: guild.ownerNick,
    tag: guild.tag,
    tagCor: guild.tagCor,
    totalMembros,
    escalados,
    maxTime: MAX_TIME_GUILD,
    membros: membros.map((r) => ({
      playerId: Number(r.id),
      nick: r.nick,
      level: Number(r.level) || 1,
      looktype: Number(r.looktype) || null,
      visual: typeof r.visual === 'string' ? JSON.parse(r.visual) : r.visual,
      entrouEm: r.entrou_em?.getTime?.() ?? null,
      lastSeen: r.last_seen?.getTime?.() ?? null,
      ehDono: Number(r.id) === guild.ownerId,
      ehSubdono: !!r.subdono,
      escalado: !!r.escalado,
      linhasEquipe: porJogador.get(Number(r.id)) ?? [],
    })),
  };
}

/**
 * Os ESCALADOS das guilds registradas, com a EQUIPE de cada um — o retrato que vai para a guerra.
 *
 * O `gm.escalado` no WHERE é o que faz a guerra continuar sendo de `MAX_TIME_GUILD` por guild
 * depois de a guild perder o teto de membros. Sem ele, uma guild de duzentos entraria com
 * duzentos lutadores e o evento deixaria de medir time para medir lista de convites.
 *
 * Quem salvou em `guild_pvp_equipes` entra com essa lista; quem nunca salvou mantém o fallback
 * da equipe de hunt (`slot IS NOT NULL`). Membro sem lutadores ainda aparece na conta.
 *
 * A ORDEM das linhas de cada jogador é a ordem de entrada na batalha (ver `montarMembro` em
 * `guild-pvp-sim.mjs`: o primeiro pokémon da lista é o ativo, os seguintes são reservas nessa
 * sequência). Para quem salvou equipe, essa ordem vem do próprio array `pokemon_ids` — daí o
 * `WITH ORDINALITY`, que carrega a posição de cada id dentro do array escolhido pelo jogador em
 * vez de reordenar por `pp.id`. Para quem nunca salvou (fallback de hunt), a ordem continua
 * sendo `pp.slot`, como sempre foi.
 */
export async function membrosParaGuerra(guildIds) {
  if (!guildIds.length) return [];
  const { rows } = await pool.query(
    `SELECT gm.guild_id, p.id AS player_id, p.nick, p.looktype, p.visual,
            pp.id AS pk_id, pp.species_id, pp.level, pp.quality, pp.ivs,
            pp.shiny, pp.potencia, pp.slot, pp.tm_elemental, pp.bonus_base
       FROM guild_members gm
       JOIN players p ON p.id = gm.player_id
       LEFT JOIN guild_pvp_equipes gpe ON gpe.player_id = p.id
       LEFT JOIN LATERAL jsonb_array_elements_text(coalesce(gpe.pokemon_ids, '[]'::jsonb))
                 WITH ORDINALITY AS ord(pk_id_txt, posicao) ON true
       LEFT JOIN player_pokemon pp
              ON pp.player_id = p.id
             AND pp.anuncio_id IS NULL
             AND (
               (gpe.player_id IS NOT NULL AND pp.id = ord.pk_id_txt::bigint)
               OR (gpe.player_id IS NULL AND pp.slot IS NOT NULL)
             )
      WHERE gm.guild_id = ANY($1::bigint[]) AND gm.escalado
      ORDER BY gm.guild_id, p.id,
               CASE WHEN gpe.player_id IS NOT NULL THEN ord.posicao ELSE pp.slot END`,
    [guildIds],
  );
  return rows;
}

// ------------------------------------------------------------------ moderação

// Apagar uma guild pelo painel admin não é o mesmo que o dono apagar a dele.
//
// O dono some com a própria guild e pronto: o nome era escolha dele e ninguém se importa com
// o histórico. Aqui o motivo é outro — o nome É o problema (racismo, slur, ódio) —, e apagar
// só a linha de `guilds` deixaria exatamente o que se queria tirar do ar:
//
//   · `guild_pvp_batalhas.resumo`  o placar da guerra do dia, que TODO jogador abre;
//   · `guild_pvp_batalhas.replay`  a lista de guilds do replay, que qualquer um assiste;
//   · `guild_global_temporadas.podio`  o pódio do fechamento mensal.
//
// Os três guardam o nome COPIADO no dia (é o certo: o placar de ontem não pode mudar porque
// alguém se renomeou hoje), então nenhuma FK os alcança. Por isso a exclusão troca o nome por
// um rótulo neutro nesses três lugares, na mesma transação: ou some de tudo, ou não some de
// nada. O que sobra do registro — posição, GP, abates — continua verdadeiro.

/** O que fica no lugar do nome apagado, onde o histórico não pode simplesmente sumir. */
export const GUILD_NOME_REMOVIDO = 'Guild removida';

/** Uma página da lista de guilds do painel, com filtro por nome. A busca é por trecho. */
export async function listarGuildsAdmin({ busca = '', limite = 50 } = {}) {
  const termo = String(busca ?? '').trim().slice(0, 40);
  const lim = Math.max(1, Math.min(200, Number(limite) || 50));
  const { rows } = await pool.query(
    `SELECT g.id, g.nome, g.gp, g.gp_global, g.criado_em, po.nick AS owner_nick,
            (SELECT count(*)::int FROM guild_members gm WHERE gm.guild_id = g.id) AS membros
       FROM guilds g
       LEFT JOIN players po ON po.id = g.owner_id
      WHERE ($1 = '' OR g.nome ILIKE '%' || $1 || '%')
      ORDER BY g.criado_em DESC
      LIMIT $2`,
    [termo, lim],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    nome: r.nome,
    gp: Number(r.gp) || 0,
    gpGlobal: Number(r.gp_global) || 0,
    membros: r.membros ?? 0,
    ownerNick: r.owner_nick ?? null,
    criadoEm: r.criado_em?.getTime?.() ?? null,
  }));
}

/**
 * Apaga a guild e limpa o nome do histórico. Devolve o que foi apagado, para o log e o aviso.
 *
 * O `DELETE` sozinho já cuida de membros, convites e registros de evento (as FKs são
 * `ON DELETE CASCADE`) e de deixar `vencedor_id` nulo nas batalhas (`SET NULL`). O que ele
 * não cuida é do nome copiado dentro dos JSONB — daí os três `UPDATE` de cima.
 *
 * A troca é guiada pelo ID da guild dentro do documento, e não por uma busca pelo texto do
 * nome: nick de jogador, apelido de pokémon e nome de arena moram nos mesmos JSONB, e um
 * replace cego de texto atingiria qualquer um deles que por acaso contivesse a palavra.
 */
export async function apagarGuildPorAdmin(guildId, { por = null } = {}) {
  const id = Number(guildId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('guild inválida');
  return comTransacao(async (q) => {
    const { rows: gRows } = await q.query(
      `SELECT g.id, g.nome, g.gp, g.gp_global, g.criado_em, po.nick AS owner_nick
         FROM guilds g
         LEFT JOIN players po ON po.id = g.owner_id
        WHERE g.id = $1
          FOR UPDATE OF g`,
      [id],
    );
    if (!gRows.length) throw new Error('guild não encontrada');

    const { rows: membros } = await q.query(
      `SELECT p.id, p.nick FROM guild_members gm JOIN players p ON p.id = gm.player_id
        WHERE gm.guild_id = $1`,
      [id],
    );

    // $1 id como número (para a contenção JSONB, onde o id é número no documento), $2 o
    // nome novo já como literal JSON, $3 o mesmo id em texto (o `->>` devolve texto).
    const p = [id, JSON.stringify(GUILD_NOME_REMOVIDO), String(id)];
    // `@>` (contenção) em vez de `LIKE` no texto do documento: pergunta "existe no array um
    // objeto com este id?" sem depender de como o JSON foi serializado, e deixa de fora as
    // linhas que não falam desta guild — que assim não são reescritas à toa.
    const temNoArray = (campo, chave) =>
      `${campo} @> jsonb_build_array(jsonb_build_object('${chave}', $1::int))`;
    const trocarNome = (campo, chave) => `
      COALESCE((
        SELECT jsonb_agg(CASE WHEN e->>'${chave}' = $3 THEN jsonb_set(e, '{nome}', $2::jsonb) ELSE e END
                         ORDER BY ord)
          FROM jsonb_array_elements(${campo}) WITH ORDINALITY AS x(e, ord)
      ), ${campo})`;

    // O placar da guerra: o vencedor (objeto) e cada linha da tabela (array).
    await q.query(
      `UPDATE guild_pvp_batalhas
          SET resumo = jsonb_set(
                CASE WHEN resumo->'vencedor'->>'id' = $3
                     THEN jsonb_set(resumo, '{vencedor,nome}', $2::jsonb)
                     ELSE resumo END,
                '{placar}', ${trocarNome("resumo->'placar'", 'id')})
        WHERE jsonb_typeof(resumo->'placar') = 'array'
          AND (${temNoArray("resumo->'placar'", 'id')} OR resumo->'vencedor'->>'id' = $3)`,
      p,
    );

    // O replay: a lista de guilds que o cliente usa para etiquetar cada boneco.
    await q.query(
      `UPDATE guild_pvp_batalhas
          SET replay = jsonb_set(replay, '{guilds}', ${trocarNome("replay->'guilds'", 'id')})
        WHERE replay IS NOT NULL
          AND jsonb_typeof(replay->'guilds') = 'array'
          AND ${temNoArray("replay->'guilds'", 'id')}`,
      p,
    );

    // O pódio do fechamento mensal — aqui a chave se chama `guildId`, não `id`.
    await q.query(
      `UPDATE guild_global_temporadas
          SET podio = ${trocarNome('podio', 'guildId')}
        WHERE jsonb_typeof(podio) = 'array'
          AND ${temNoArray('podio', 'guildId')}`,
      p,
    );

    await q.query(`DELETE FROM guilds WHERE id = $1`, [id]);

    const g = gRows[0];
    return {
      id: Number(g.id),
      nome: g.nome,
      gp: Number(g.gp) || 0,
      gpGlobal: Number(g.gp_global) || 0,
      ownerNick: g.owner_nick ?? null,
      criadoEm: g.criado_em?.getTime?.() ?? null,
      membros: membros.map((m) => ({ id: Number(m.id), nick: m.nick })),
      por,
    };
  });
}
