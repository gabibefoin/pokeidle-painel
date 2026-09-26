// Persistência do CAMPEONATO: quem se inscreveu e, depois do prazo, a seed congelada de cada um.
//
// ### Duas tabelas, dois momentos
//
// `campeonato_inscricoes` é a lista de inscritos. Enquanto as inscrições estão abertas a
// coluna `seed` fica vazia: a seed é PROVISÓRIA e sai da tabela do ranqueado na hora da
// leitura, porque o PR continua mudando até o último dia. No fechamento ela é gravada de uma
// vez e não muda mais — é a chave que vai ser jogada.
//
// `campeonato_chaves` é o carimbo desse fechamento: uma linha por campeonato, com quantos
// entraram na chave. É ela que diz "já congelou" para todos os processos, e o `INSERT` dela
// é o que torna o congelamento idempotente entre shards.
//
// `campeonato_partidas` é a chave sendo jogada: uma linha por partida decidida, com quem
// venceu, quem perdeu e a FITA (comprimida). A forma da chave não é gravada — ela sai inteira de
// `montarChave(participantes)`, e o que falta saber é só o resultado de cada partida.
//
// ### A equipe também congela — mas DEPOIS da seed
//
// A equipe de cada inscrito é copiada para `campeonato_inscricoes.equipe` e é com ELA que ele
// joga o campeonato inteiro. Sem isso, quem assistisse à fita da primeira rodada de um
// adversário poderia montar a equipe certa contra ele antes da rodada seguinte — e quem
// vendesse um pokémon no meio do dia lutaria desfalcado.
//
// São DOIS congelamentos, em dois momentos, e é de propósito: `congelarChave` grava as seeds na
// virada do 28 para o 29, que é quando a chave é publicada, e `congelarEquipes` tira o retrato
// das equipes às 23h do dia 29. O vão entre os dois é o dia de análise — o inscrito vê a chave
// que já existe e ajusta o time contra o adversário que ele já sabe qual é. `equipes_em`, em
// `campeonato_chaves`, é o carimbo do segundo, como a própria linha é a do primeiro.
//
// ### Por que a seed congela no banco, e não só na tela
//
// Se cada leitura recalculasse a ordem, uma partida de ranqueado jogada no dia 30 mudaria a
// chave do campeonato no meio dele. E um inscrito que apagasse a conta faria todo mundo abaixo
// dele subir uma seed — com a chave já anunciada.
import { pool } from './db.mjs';
import { compararSeeds } from '../shared/campeonato.mjs';
import { equipesDaPartida } from './pvp-ranqueado-db.mjs';

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campeonato_inscricoes (
      campeonato  TEXT   NOT NULL,
      player_id   BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      inscrito_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      seed        INT,
      -- O retrato do ranqueado no instante do congelamento: a base da seed, para quem quiser
      -- conferir depois por que ficou onde ficou. A tela mostra o PR de AGORA.
      posicao_congelada INT,
      pontos_congelados INT,
      PRIMARY KEY (campeonato, player_id)
    )`);
  await pool.query(`ALTER TABLE campeonato_inscricoes ADD COLUMN IF NOT EXISTS equipe JSONB`);
  // A equipe ESCOLHIDA para o campeonato (ids, na ordem). NULL = vale a equipe do PvP Ranqueado.
  // `equipe`, logo acima, é outra coisa: o retrato congelado no fim das inscrições.
  await pool.query(`ALTER TABLE campeonato_inscricoes ADD COLUMN IF NOT EXISTS equipe_ids JSONB`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campeonato_chaves (
      campeonato    TEXT PRIMARY KEY,
      participantes INT NOT NULL,
      gerada_em     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // O andamento: a última onda jogada, quando roda a próxima, e o pódio quando acaba.
  await pool.query(`ALTER TABLE campeonato_chaves ADD COLUMN IF NOT EXISTS onda INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE campeonato_chaves ADD COLUMN IF NOT EXISTS proxima_onda_em TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE campeonato_chaves ADD COLUMN IF NOT EXISTS concluida_em TIMESTAMPTZ`);
  // Quando o retrato das equipes foi tirado. É o carimbo que torna `congelarEquipes`
  // idempotente entre shards, do mesmo jeito que a linha de `campeonato_chaves` faz com a
  // chave — e que diz, para quem lê, se o `equipe` das inscrições já é o definitivo.
  await pool.query(`ALTER TABLE campeonato_chaves ADD COLUMN IF NOT EXISTS equipes_em TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE campeonato_chaves ADD COLUMN IF NOT EXISTS campeao_seed INT`);
  await pool.query(`ALTER TABLE campeonato_chaves ADD COLUMN IF NOT EXISTS vice_seed INT`);
  await pool.query(`ALTER TABLE campeonato_chaves ADD COLUMN IF NOT EXISTS terceiro_seed INT`);
  // `estado`: 'jogada' (houve luta e há fita) ou 'wo' (um lado sem equipe — sem fita).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campeonato_partidas (
      campeonato    TEXT NOT NULL,
      id            TEXT NOT NULL,
      a_seed        INT  NOT NULL,
      b_seed        INT  NOT NULL,
      vencedor_seed INT  NOT NULL,
      perdedor_seed INT  NOT NULL,
      estado        TEXT NOT NULL,
      onda          INT  NOT NULL,
      motivo        TEXT,
      duracao_ms    INT,
      placar        JSONB,
      replay        BYTEA,
      jogada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (campeonato, id)
    )`);
}

/** Inscreve. `true` se entrou agora, `false` se já estava. */
export async function inscrever(campeonato, playerId) {
  const { rowCount } = await pool.query(
    `INSERT INTO campeonato_inscricoes (campeonato, player_id) VALUES ($1, $2)
     ON CONFLICT (campeonato, player_id) DO NOTHING`,
    [campeonato, Number(playerId)],
  );
  return rowCount > 0;
}

/**
 * Tira a inscrição. `true` se saiu.
 *
 * `seed IS NULL` é a trava contra a corrida do último segundo: o prazo é conferido no sim antes
 * de chegar aqui, mas o congelamento pode ter acontecido no meio — e quem já tem seed gravada
 * está numa chave anunciada.
 */
export async function cancelar(campeonato, playerId) {
  const { rowCount } = await pool.query(
    `DELETE FROM campeonato_inscricoes
      WHERE campeonato = $1 AND player_id = $2 AND seed IS NULL`,
    [campeonato, Number(playerId)],
  );
  return rowCount > 0;
}

/**
 * Grava a equipe escolhida para o campeonato. `ids` vazio volta a valer a equipe do PvP.
 *
 * Devolve `'ok'`, `'congelada'` (o retrato já foi tirado: o prazo passou no meio do pedido) ou
 * `'fora'` (não está inscrito).
 *
 * A trava é `equipe IS NULL`, e NÃO o `seed IS NULL` de `cancelar`: a seed passa a existir na
 * virada do 28 para o 29, quando a chave é publicada, e a equipe continua aberta o dia 29
 * inteiro. Travar pela seed aqui recusaria todo ajuste do dia de análise — que é justamente o
 * que o dia de análise existe para permitir. Quem fecha a porta é `congelarEquipes`, às 23h,
 * gravando `equipe`.
 */
export async function escolherEquipe(campeonato, playerId, ids) {
  const { rows } = await pool.query(
    `WITH alvo AS (
       SELECT seed FROM campeonato_inscricoes WHERE campeonato = $1 AND player_id = $2
     ), feito AS (
       UPDATE campeonato_inscricoes SET equipe_ids = $3::jsonb
        WHERE campeonato = $1 AND player_id = $2 AND equipe IS NULL
        RETURNING 1
     )
     SELECT (SELECT count(*) FROM alvo)::int AS inscrito, (SELECT count(*) FROM feito)::int AS feito`,
    [campeonato, Number(playerId), ids?.length ? JSON.stringify(ids) : null],
  );
  if (rows[0].feito) return 'ok';
  return rows[0].inscrito ? 'congelada' : 'fora';
}

/** Os ids escolhidos para o campeonato, ou `null` quando vale a equipe do PvP. */
export async function equipeEscolhida(campeonato, playerId) {
  const { rows } = await pool.query(
    `SELECT equipe_ids FROM campeonato_inscricoes WHERE campeonato = $1 AND player_id = $2`,
    [campeonato, Number(playerId)],
  );
  const bruto = rows[0]?.equipe_ids;
  const arr = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
  return Array.isArray(arr) && arr.length ? arr.map(Number).filter(Number.isFinite) : null;
}

export async function estaInscrito(campeonato, playerId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM campeonato_inscricoes WHERE campeonato = $1 AND player_id = $2`,
    [campeonato, Number(playerId)],
  );
  return rows.length > 0;
}

const ms = (v) => (v == null ? null : new Date(v).getTime());

/**
 * O carimbo do congelamento e o andamento, ou `null` enquanto a chave não foi gerada.
 *
 * `{ participantes, geradaEm, onda, proximaOndaEm, concluidaEm, podio }`
 */
export async function chaveGerada(campeonato) {
  const { rows } = await pool.query(
    `SELECT * FROM campeonato_chaves WHERE campeonato = $1`,
    [campeonato],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    participantes: Number(r.participantes),
    geradaEm: ms(r.gerada_em),
    onda: Number(r.onda) || 0,
    proximaOndaEm: ms(r.proxima_onda_em),
    concluidaEm: ms(r.concluida_em),
    // Quando o retrato das equipes foi tirado (`congelarEquipes`). `null` = ainda não — a chave
    // existe desde o dia 29, mas as equipes só congelam às 23h.
    equipesEm: ms(r.equipes_em),
    podio: r.concluida_em
      ? { campeao: r.campeao_seed, vice: r.vice_seed, terceiro: r.terceiro_seed }
      : null,
  };
}

// ------------------------------------------------------------------ a chave sendo jogada

/**
 * RECLAMA a próxima onda: só um processo consegue, e só quando ela já venceu.
 *
 * É um `UPDATE` condicional, e é isso que dispensa trava: dois shards que vejam a mesma onda
 * vencida no mesmo segundo disputam a mesma linha, e o segundo encontra `onda` já avançada e
 * não altera nada. Devolve o número da onda reclamada, ou `null`.
 */
export async function reclamarOnda(campeonato, ondaVista, agora, proximaEm) {
  const { rows } = await pool.query(
    `UPDATE campeonato_chaves
        SET onda = onda + 1, proxima_onda_em = $4
      WHERE campeonato = $1 AND onda = $2 AND concluida_em IS NULL
        AND (proxima_onda_em IS NULL OR proxima_onda_em <= $3)
      RETURNING onda`,
    [campeonato, ondaVista, new Date(agora), new Date(proximaEm)],
  );
  return rows[0] ? Number(rows[0].onda) : null;
}

/** Os resultados já decididos: `Map` de id → `{ vencedor, perdedor, estado, onda, … }`. Sem fita. */
export async function resultados(campeonato) {
  const { rows } = await pool.query(
    `SELECT id, a_seed, b_seed, vencedor_seed, perdedor_seed, estado, onda, motivo, duracao_ms,
            placar, jogada_em, (replay IS NOT NULL) AS tem_replay
       FROM campeonato_partidas WHERE campeonato = $1`,
    [campeonato],
  );
  return new Map(rows.map((r) => [r.id, {
    a: Number(r.a_seed),
    b: Number(r.b_seed),
    vencedor: Number(r.vencedor_seed),
    perdedor: Number(r.perdedor_seed),
    estado: r.estado,
    onda: Number(r.onda),
    motivo: r.motivo,
    duracaoMs: r.duracao_ms,
    placar: typeof r.placar === 'string' ? JSON.parse(r.placar) : r.placar,
    jogadaEm: ms(r.jogada_em),
    temReplay: !!r.tem_replay,
  }]));
}

/** Grava os resultados de uma onda. Idempotente: partida já decidida não é reescrita. */
export async function gravarResultados(campeonato, lista) {
  for (const x of lista) {
    await pool.query(
      `INSERT INTO campeonato_partidas
         (campeonato, id, a_seed, b_seed, vencedor_seed, perdedor_seed, estado, onda,
          motivo, duracao_ms, placar, replay)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (campeonato, id) DO NOTHING`,
      [
        campeonato, x.id, x.a, x.b, x.vencedor, x.perdedor, x.estado, x.onda,
        x.motivo ?? null, x.duracaoMs ?? null,
        x.placar ? JSON.stringify(x.placar) : null,
        x.replay ?? null,
      ],
    );
  }
}

/** Fecha o campeonato com o pódio. */
export async function concluir(campeonato, { campeao, vice, terceiro }) {
  await pool.query(
    `UPDATE campeonato_chaves
        SET concluida_em = now(), proxima_onda_em = NULL,
            campeao_seed = $2, vice_seed = $3, terceiro_seed = $4
      WHERE campeonato = $1 AND concluida_em IS NULL`,
    [campeonato, campeao, vice, terceiro],
  );
}

/**
 * APAGA as fitas de um campeonato, de vez. Devolve quantas partidas perderam o replay.
 *
 * Chamado quando a janela de exibição fecha (ver `replaysAbertos` em `shared/campeonato.mjs`):
 * a partir daí a tela mostra só o pódio, então o `BYTEA` de cada partida é peso morto. Numa
 * chave de 168 inscritos são 334 partidas de umas dezenas de KB cada — uns 10 MB por edição,
 * todo mês, para sempre, de um conteúdo que ninguém mais abre.
 *
 * A linha da partida FICA: quem ganhou, quem perdeu, o placar e a onda continuam ali. O que sai
 * é só o vídeo. É por isso que a chave de um campeonato de 2027 ainda vai desenhar inteira em
 * 2030 — sem replay, mas inteira.
 */
export async function apagarReplaysVencidos(campeonato) {
  const { rowCount } = await pool.query(
    `UPDATE campeonato_partidas SET replay = NULL
      WHERE campeonato = $1 AND replay IS NOT NULL`,
    [campeonato],
  );
  return rowCount;
}

/**
 * O resumo de VÁRIOS campeonatos de uma vez, para a lista da tela: quantos se inscreveram,
 * se a chave existe, se acabou e qual foi o pódio.
 *
 * Uma consulta para a lista inteira, e não uma por edição: a tela mostra até dez linhas, e dez
 * idas ao banco por abertura de aba seriam dez vezes o custo por nada.
 */
export async function resumos(ids) {
  const lista = [...new Set((ids ?? []).map(String))];
  if (!lista.length) return new Map();
  const { rows } = await pool.query(
    `SELECT i.campeonato,
            count(*)::int AS inscritos,
            c.participantes, c.concluida_em, c.onda,
            c.campeao_seed, c.vice_seed, c.terceiro_seed,
            (SELECT count(*) FROM campeonato_partidas p
              WHERE p.campeonato = i.campeonato AND p.replay IS NOT NULL)::int AS com_fita,
            -- O NICK do campeão. Sai por subconsulta e não por um JOIN a mais porque só as
            -- edições ENCERRADAS o têm, e a chave primária de campeonato_inscricoes resolve cada
            -- uma com uma busca só. Sem ele a lista só teria a seed (#029), que não diz nada a
            -- quem está lendo.
            (SELECT p2.nick FROM campeonato_inscricoes i2 JOIN players p2 ON p2.id = i2.player_id
              WHERE i2.campeonato = i.campeonato AND i2.seed = c.campeao_seed) AS campeao_nick
       FROM campeonato_inscricoes i
       LEFT JOIN campeonato_chaves c ON c.campeonato = i.campeonato
      WHERE i.campeonato = ANY($1::text[])
      GROUP BY i.campeonato, c.participantes, c.concluida_em, c.onda,
               c.campeao_seed, c.vice_seed, c.terceiro_seed`,
    [lista],
  );
  const saida = new Map(rows.map((r) => [r.campeonato, {
    inscritos: Number(r.inscritos),
    participantes: r.participantes == null ? null : Number(r.participantes),
    concluidaEm: ms(r.concluida_em),
    onda: Number(r.onda) || 0,
    comFita: Number(r.com_fita) || 0,
    podio: r.concluida_em
      ? {
        campeao: r.campeao_seed,
        campeaoNick: r.campeao_nick ?? null,
        vice: r.vice_seed,
        terceiro: r.terceiro_seed,
      }
      : null,
  }]));
  // Uma edição sem nenhum inscrito não aparece no `GROUP BY` — a lista precisa dela do mesmo
  // jeito, com zero, senão a tela some com o campeonato que ainda não recebeu ninguém.
  for (const id of lista) if (!saida.has(id)) saida.set(id, { inscritos: 0, participantes: null, concluidaEm: null, onda: 0, comFita: 0, podio: null });
  return saida;
}

/** O nick de cada seed de um campeonato — para o pódio das edições antigas. */
export async function nicksDasSeeds(campeonato, seeds) {
  const lista = [...new Set((seeds ?? []).map(Number).filter(Number.isFinite))];
  if (!lista.length) return new Map();
  const { rows } = await pool.query(
    `SELECT i.seed, p.nick, p.looktype, p.visual FROM campeonato_inscricoes i
       JOIN players p ON p.id = i.player_id
      WHERE i.campeonato = $1 AND i.seed = ANY($2::int[])`,
    [campeonato, lista],
  );
  return new Map(rows.map((r) => [Number(r.seed), { nick: r.nick, looktype: r.looktype, visual: r.visual }]));
}

/** A fita (comprimida) de uma partida, com quem jogou. `null` se não houver. */
export async function fitaDaPartida(campeonato, id) {
  const { rows } = await pool.query(
    `SELECT id, a_seed, b_seed, vencedor_seed, replay FROM campeonato_partidas
      WHERE campeonato = $1 AND id = $2 AND replay IS NOT NULL`,
    [campeonato, String(id)],
  );
  const r = rows[0];
  return r
    ? { id: r.id, a: Number(r.a_seed), b: Number(r.b_seed), vencedor: Number(r.vencedor_seed), replay: r.replay }
    : null;
}

/**
 * Os lutadores congelados: `Map` de seed → `{ dbId, nick, looktype, visual, pokemons }`, no
 * formato que `simularDuelo` come. O nick e o boneco são os de agora; a equipe, a do
 * fechamento.
 */
export async function lutadores(campeonato) {
  const { rows } = await pool.query(
    `SELECT i.seed, i.player_id, i.equipe, p.nick, p.looktype, p.visual
       FROM campeonato_inscricoes i JOIN players p ON p.id = i.player_id
      WHERE i.campeonato = $1 AND i.seed IS NOT NULL`,
    [campeonato],
  );
  return new Map(rows.map((r) => [Number(r.seed), {
    dbId: Number(r.player_id),
    nick: r.nick,
    looktype: r.looktype,
    visual: r.visual,
    pokemons: (typeof r.equipe === 'string' ? JSON.parse(r.equipe) : r.equipe) ?? [],
  }]));
}

/**
 * Os inscritos, com o que a tela e a seed precisam: a conta, a linha do ranqueado e a POSIÇÃO
 * na tabela.
 *
 * A posição é a mesma da Tabela da aba PvP (`pvpdb.ladder`): pontos, vitórias e id, só entre
 * quem já saiu do posicionamento. É a que o jogador VÊ — uma seed que discordasse da tabela
 * ao lado seria uma seed que ninguém consegue conferir.
 *
 * A janela sobre `pvp_rank` inteira custa uma varredura do índice de pontos; quem chama segura
 * o resultado alguns segundos em memória (ver `game/campeonato.mjs`).
 */
export async function listarInscritos(campeonato, minimoPartidas) {
  const { rows } = await pool.query(
    `WITH tabela AS (
       SELECT player_id,
              ROW_NUMBER() OVER (ORDER BY pontos DESC, vitorias DESC, player_id ASC) AS pos
         FROM pvp_rank
        WHERE partidas >= $2
     )
     SELECT i.player_id, i.inscrito_em, i.seed, i.posicao_congelada, i.pontos_congelados,
            jsonb_array_length(i.equipe) AS equipe_n,
            p.nick, p.looktype, p.visual, p.level,
            r.pontos, r.pico, r.vitorias, r.derrotas, r.partidas, r.sequencia, r.escudo,
            r.tier_topo, r.ultima_em,
            t.pos
       FROM campeonato_inscricoes i
       JOIN players p ON p.id = i.player_id
       LEFT JOIN pvp_rank r ON r.player_id = i.player_id
       LEFT JOIN tabela t ON t.player_id = i.player_id
      WHERE i.campeonato = $1`,
    [campeonato, Math.max(0, Number(minimoPartidas) || 0)],
  );
  return rows.map((r) => ({
    playerId: Number(r.player_id),
    inscritoEm: new Date(r.inscrito_em).getTime(),
    seed: r.seed == null ? null : Number(r.seed),
    // Quantos pokémon a equipe CONGELADA tem — `null` antes do fechamento.
    equipeN: r.equipe_n == null ? null : Number(r.equipe_n),
    nick: r.nick,
    looktype: r.looktype,
    visual: r.visual,
    nivel: Number(r.level) || 0,
    posicao: r.pos == null ? null : Number(r.pos),
    // A linha do ranqueado no formato de `pvpdb.rankParaCliente`. Quem nunca jogou não tem
    // linha, e a tela diz "Não classificado".
    rank: r.pontos == null ? null : {
      pontos: Number(r.pontos),
      pico: Number(r.pico),
      vitorias: Number(r.vitorias),
      derrotas: Number(r.derrotas),
      partidas: Number(r.partidas),
      sequencia: Number(r.sequencia),
      escudo: Number(r.escudo),
      tierTopo: Number(r.tier_topo),
      ultimaEm: r.ultima_em ? new Date(r.ultima_em).getTime() : null,
    },
  }));
}

/**
 * Congela a chave: grava a seed de cada inscrito e carimba o campeonato. Idempotente.
 *
 * O `pg_advisory_xact_lock` enfileira os shards que perceberem o prazo no mesmo segundo; o
 * segundo a entrar acha o carimbo e sai sem mexer em nada. A ordem é a de `compararSeeds`, a
 * mesma que a tela mostrou durante as inscrições.
 *
 * SÓ AS SEEDS. A equipe congela depois, em `congelarEquipes`, no fim do dia de análise — se ela
 * fosse fotografada aqui, o retrato sairia 23 horas antes do prazo que o jogador vê na tela e
 * todo ajuste feito durante o dia 29 seria jogado fora sem aviso.
 *
 * Devolve `{ gerou, participantes }`.
 */
export async function congelarChave(campeonato, minimoPartidas) {
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    await cli.query(`SELECT pg_advisory_xact_lock(hashtext('campeonato:' || $1))`, [campeonato]);
    const ja = await cli.query(`SELECT participantes FROM campeonato_chaves WHERE campeonato = $1`, [campeonato]);
    if (ja.rows.length) {
      await cli.query('COMMIT');
      return { gerou: false, participantes: Number(ja.rows[0].participantes) };
    }
    // A leitura vai pela mesma conexão da transação: um inscrito que entrasse entre a leitura e
    // a gravação ficaria sem seed — e o prazo já passou, então nada entra, mas o custo de ler
    // pela transação é zero.
    const { rows } = await cli.query(
      `WITH tabela AS (
         SELECT player_id,
                ROW_NUMBER() OVER (ORDER BY pontos DESC, vitorias DESC, player_id ASC) AS pos
           FROM pvp_rank
          WHERE partidas >= $2
       )
       SELECT i.player_id, i.inscrito_em, p.level, r.pontos, r.vitorias, t.pos
         FROM campeonato_inscricoes i
         JOIN players p ON p.id = i.player_id
         LEFT JOIN pvp_rank r ON r.player_id = i.player_id
         LEFT JOIN tabela t ON t.player_id = i.player_id
        WHERE i.campeonato = $1
        FOR UPDATE OF i`,
      [campeonato, Math.max(0, Number(minimoPartidas) || 0)],
    );
    const ordem = rows
      .map((r) => ({
        playerId: Number(r.player_id),
        posicao: r.pos == null ? null : Number(r.pos),
        pontos: Number(r.pontos) || 0,
        vitorias: Number(r.vitorias) || 0,
        nivel: Number(r.level) || 0,
        inscritoEm: new Date(r.inscrito_em).getTime(),
      }))
      .sort(compararSeeds);
    if (ordem.length) {
      await cli.query(
        `UPDATE campeonato_inscricoes i
            SET seed = v.seed, posicao_congelada = v.pos, pontos_congelados = v.pontos
           FROM unnest($2::bigint[], $3::int[], $4::int[], $5::int[])
                AS v(player_id, seed, pos, pontos)
          WHERE i.campeonato = $1 AND i.player_id = v.player_id`,
        [
          campeonato,
          ordem.map((o) => o.playerId),
          ordem.map((_, i) => i + 1),
          ordem.map((o) => o.posicao),
          ordem.map((o) => o.pontos),
        ],
      );
    }
    await cli.query(
      `INSERT INTO campeonato_chaves (campeonato, participantes) VALUES ($1, $2)`,
      [campeonato, ordem.length],
    );
    await cli.query('COMMIT');
    return { gerou: true, participantes: ordem.length };
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}

/**
 * Congela as EQUIPES: tira o retrato de cada inscrito e carimba `equipes_em`. Idempotente.
 *
 * Roda no fim do dia de análise (`equipeAte`, 29/09 às 23h), e não junto com a seed: o jogador
 * passa o dia 29 vendo a chave e ajustando o time contra quem ele já sabe que vai enfrentar, e
 * só o que estiver salvo às 23h é o que luta.
 *
 * O retrato guarda só o que a luta precisa — sem o objeto da espécie (a simulação o refaz pelo
 * `speciesId`) e sem o dono (o id já está na linha). A posse é conferida AQUI, dentro de
 * `equipesDaPartida`: um pokémon escolhido e vendido antes das 23h simplesmente não entra.
 *
 * Congelar é o que impede duas coisas: quem assiste à fita da primeira rodada de um adversário
 * montar a equipe certa contra ele para a rodada seguinte, e quem vende um pokémon no meio do
 * dia 30 lutar desfalcado do nada.
 *
 * Exige a chave já congelada — sem seed não há quem fotografar. Devolve `{ gerou, equipes }`.
 */
export async function congelarEquipes(campeonato, regras = null) {
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    // A MESMA chave de lock de `congelarChave`: os dois congelamentos do mesmo campeonato se
    // enfileiram, e o segundo nunca lê uma seed pela metade.
    await cli.query(`SELECT pg_advisory_xact_lock(hashtext('campeonato:' || $1))`, [campeonato]);
    const carimbo = await cli.query(
      `SELECT equipes_em FROM campeonato_chaves WHERE campeonato = $1`,
      [campeonato],
    );
    // Sem chave não há o que congelar; com o carimbo, já congelou.
    if (!carimbo.rows.length || carimbo.rows[0].equipes_em) {
      await cli.query('COMMIT');
      return { gerou: false, equipes: 0 };
    }
    const { rows } = await cli.query(
      `SELECT player_id, equipe_ids FROM campeonato_inscricoes
        WHERE campeonato = $1 AND seed IS NOT NULL
        FOR UPDATE`,
      [campeonato],
    );
    if (rows.length) {
      const escolhidas = new Map();
      for (const r of rows) {
        const arr = typeof r.equipe_ids === 'string' ? JSON.parse(r.equipe_ids) : r.equipe_ids;
        if (Array.isArray(arr) && arr.length) escolhidas.set(Number(r.player_id), arr);
      }
      const ids = rows.map((r) => Number(r.player_id));
      // `regras` é o objeto do campeonato (ver `shared/campeonato.mjs`). No Amador ele carrega
      // `semShiny`/`semP5`, e é aqui — no retrato — que eles valem de verdade: a escolha foi
      // conferida no clique, mas a equipe do PvP de quem não escolheu nada nunca passou por
      // conferência nenhuma, e ela pode ter um shiny capturado depois da inscrição.
      const equipes = await equipesDaPartida(ids, { escolhidas, campeonato: regras });
      const retrato = (lista) => JSON.stringify((lista ?? []).map((pk) => ({
        id: pk.id,
        speciesId: pk.speciesId,
        level: pk.level,
        quality: pk.quality,
        potencia: pk.potencia,
        shiny: pk.shiny,
        ivs: pk.ivs,
        refino: pk.refino,
        tmElemental: pk.tmElemental,
      })));
      await cli.query(
        `UPDATE campeonato_inscricoes i
            SET equipe = v.equipe
           FROM unnest($2::bigint[], $3::jsonb[]) AS v(player_id, equipe)
          WHERE i.campeonato = $1 AND i.player_id = v.player_id`,
        [campeonato, ids, ids.map((id) => retrato(equipes.get(id)))],
      );
    }
    await cli.query(
      `UPDATE campeonato_chaves SET equipes_em = now() WHERE campeonato = $1`,
      [campeonato],
    );
    await cli.query('COMMIT');
    return { gerou: true, equipes: rows.length };
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}
