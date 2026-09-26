// Persistência dos 18 Ginásios: o time que cada jogador registrou em cada tipo e quem está
// no topo de cada um.
//
// ### Duas tabelas, papéis opostos
//
// `ginasio_times` é a INTENÇÃO do jogador: "no ginásio de FIRE eu ponho estes cinco ids,
// nesta ordem". É a única coisa que ele escreve, e escreve raramente.
//
// `ginasio_lideres` é o RESULTADO, recalculado de tempos em tempos por um shard só (ver
// `game/ginasios.mjs`). Ela existe por um motivo específico: o +25% de dano do líder precisa
// ser consultado a cada golpe de cada hunt do servidor inteiro, e isso não pode virar uma
// consulta ao Postgres — nem sequer uma soma de força. Então o pódio é apurado uma vez por
// minuto, gravado em 18 linhas, e todo shard lê essas 18 linhas para um mapa em memória.
//
// ### O poder NÃO é gravado com o time
//
// Foi pedido "a FORÇA atual da equipe", e força atual muda sozinha: o jogador sobe o pokémon
// de nível, refina, evolui. Um `poder` gravado no INSERT envelheceria em silêncio e o pódio
// mostraria o retrato de semanas atrás. Aqui a força é sempre calculada na leitura, a partir
// das linhas vivas de `player_pokemon` — o custo é uma consulta por ginásio, e o número na
// tela é o de agora.
import { pool } from './db.mjs';
import { especies } from './content.mjs';
import { normalizarRefino } from '../shared/refino-stats.mjs';
import {
  GINASIO_DESAFIO_COOLDOWN_MS,
  GINASIO_TIME_MAX,
  TIPOS_GINASIO,
  poderNoGinasio,
  tipoDeGinasio,
  timeValidoDoGinasio,
  validarTimeGinasio,
} from '../shared/ginasios.mjs';

export class ErroGinasio extends Error {
  constructor(codigo, msg) {
    super(msg);
    this.codigo = codigo;
  }
}

export async function migrar() {
  // `pokemon_ids` guarda a ORDEM escolhida: o primeiro é quem abre a luta no desafio, os
  // outros entram como reserva na sequência — a mesma convenção da equipe de guerra.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ginasio_times (
      player_id     BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      tipo          TEXT   NOT NULL,
      pokemon_ids   JSONB  NOT NULL DEFAULT '[]'::jsonb,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, tipo)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ginasio_times_tipo ON ginasio_times(tipo)`);

  // Uma linha por ginásio, sempre as mesmas 18. `desde` é o que a tela usa para dizer "líder
  // desde tal dia" — e é preservado enquanto o líder não mudar (ver `gravarLideres`).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ginasio_lideres (
      tipo       TEXT PRIMARY KEY,
      player_id  BIGINT REFERENCES players(id) ON DELETE SET NULL,
      poder      INT NOT NULL DEFAULT 0,
      desde      TIMESTAMPTZ NOT NULL DEFAULT now(),
      apurado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  // Cooldown do desafio — uma linha por (jogador, ginásio). Fire e Grass não se misturam.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ginasio_desafio_cd (
      player_id  BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      tipo       TEXT   NOT NULL,
      proximo_em TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (player_id, tipo)
    )`);
}

// ------------------------------------------------------------------ leitura

/** A linha crua de `player_pokemon` vira o objeto que as regras do ginásio entendem. */
function pokemonDaLinha(r) {
  const esp = especies.get(Number(r.species_id));
  if (!esp) return null;
  const ivs = typeof r.ivs === 'string' ? JSON.parse(r.ivs) : r.ivs;
  if (!ivs) return null;
  return {
    id: Number(r.pk_id),
    speciesId: esp.pokeId,
    nome: esp.name,
    looktype: esp.looktype,
    tipos: [esp.type1, esp.type2].filter(Boolean),
    level: Number(r.level) || 1,
    quality: Number(r.quality) || 1,
    // `|| 1` e não `??`: linha ainda não alcançada pelo backfill vem com 0, que não é potência.
    potencia: Number(r.potencia) || 1,
    shiny: !!r.shiny,
    ivs,
    refino: normalizarRefino(r.bonus_base),
    tmElemental: r.tm_elemental ?? null,
    esp,
  };
}

/**
 * A LEITURA e em DOIS PASSOS, e isso e de proposito.
 *
 * A primeira versao fazia tudo numa consulta so: `ginasio_times` x `LATERAL
 * jsonb_array_elements` x `player_pokemon`. O plano era bom com tres times inscritos, mas
 * medido em escala (5.700 times, 13.400 pokemon) o Postgres trocava o indice por uma
 * VARREDURA COMPLETA de `player_pokemon`, e o custo passava a crescer com a colecao INTEIRA
 * do jogo — 179 mil linhas hoje, subindo a cada captura de cada jogador. 306 ms.
 *
 * Em dois passos o custo volta a crescer com quem de fato joga o ginasio: le os times (tabela
 * pequena, indexada por tipo), junta os ids e busca os pokemon por CHAVE PRIMARIA. Mesma
 * escala, 75 ms — e a diferenca aumenta conforme a colecao cresce, que e o ponto.
 *
 * A ORDEM escolhida pelo jogador sai do SQL e passa a ser montada aqui: o array
 * `pokemon_ids` ja E a ordem, e percorre-lo e mais direto (e mais barato) que um
 * `WITH ORDINALITY` so para reconstrui-la.
 */
const SQL_SO_OS_TIMES = `
  SELECT gt.player_id, gt.tipo, gt.pokemon_ids, gt.atualizado_em,
         p.nick, p.level AS nivel_treinador, p.looktype, p.visual
    FROM ginasio_times gt
    JOIN players p ON p.id = gt.player_id`;

/** Os pokemon de uma leva de ids, por chave primaria. `Map` id -> pokemon. */
async function pokemonsPorId(ids) {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT pp.id AS pk_id, pp.player_id, pp.species_id, pp.level, pp.quality, pp.ivs,
            pp.shiny, pp.potencia, pp.tm_elemental, pp.bonus_base
       FROM player_pokemon pp
      WHERE pp.anuncio_id IS NULL AND pp.id = ANY($1::bigint[])`,
    [ids],
  );
  const mapa = new Map();
  for (const r of rows) {
    const pk = pokemonDaLinha(r);
    if (pk) mapa.set(pk.id, { ...pk, donoId: Number(r.player_id) });
  }
  return mapa;
}

/** Ids unicos de todos os times, para uma busca so. */
function idsDosTimes(linhas) {
  const ids = new Set();
  for (const l of linhas) {
    const arr = typeof l.pokemon_ids === 'string' ? JSON.parse(l.pokemon_ids) : l.pokemon_ids;
    for (const id of arr ?? []) {
      const n = Number(id);
      if (Number.isFinite(n)) ids.add(n);
    }
  }
  return [...ids];
}

/**
 * Monta os times pontuados, ja ordenados para o podio.
 *
 * Pokemon que saiu da conta (vendido, anunciado no Mercado, evoluiu para uma especie que ja
 * esta no time) simplesmente nao aparece — ver `timeValidoDoGinasio`. O time continua
 * valendo com o que sobrou; ninguem e expulso do ginasio por ter evoluido um bicho.
 */
function montarTimes(linhas, porId) {
  const times = [];
  for (const l of linhas) {
    const arr = typeof l.pokemon_ids === 'string' ? JSON.parse(l.pokemon_ids) : l.pokemon_ids;
    const pokemons = [];
    for (const id of arr ?? []) {
      const pk = porId.get(Number(id));
      // O DONO e conferido AQUI, e nao some com o passo a mais: buscar por id sem checar de
      // quem e seria aceitar o pokemon de outro jogador num time — que e exatamente o que a
      // juncao antiga (`pp.player_id = gt.player_id`) impedia.
      if (pk && pk.donoId === Number(l.player_id)) pokemons.push(pk);
    }
    const time = {
      playerId: Number(l.player_id),
      tipo: l.tipo,
      nick: l.nick,
      nivelTreinador: Number(l.nivel_treinador) || 1,
      looktype: Number(l.looktype) || 159,
      visual: typeof l.visual === 'string' ? JSON.parse(l.visual) : l.visual,
      atualizadoEm: l.atualizado_em,
      pokemons: timeValidoDoGinasio(pokemons, l.tipo),
    };
    time.poder = time.pokemons.reduce((s, pk) => s + poderNoGinasio(pk, pk.esp), 0);
    times.push(time);
  }
  // Empate no poder decide por quem registrou ANTES: quem chegou primeiro no topo não perde
  // o ginásio para alguém que empatou depois. Sem isto o pódio de dois times idênticos
  // trocaria de dono a cada apuração, e o +25% ficaria piscando entre os dois.
  times.sort((a, b) => b.poder - a.poder || new Date(a.atualizadoEm) - new Date(b.atualizadoEm));
  return times;
}

/** O pódio de UM ginásio, do mais forte para o mais fraco. Times vazios ficam de fora. */
export async function rankingDoGinasio(tipo) {
  const t = tipoDeGinasio(tipo);
  if (!t) return [];
  const { rows } = await pool.query(`${SQL_SO_OS_TIMES} WHERE gt.tipo = $1`, [t]);
  const porId = await pokemonsPorId(idsDosTimes(rows));
  return montarTimes(rows, porId).filter((x) => x.pokemons.length > 0);
}

/** Os times de TODOS os ginásios de uma vez — a apuração dos líderes usa esta. */
export async function todosOsTimes() {
  const { rows } = await pool.query(SQL_SO_OS_TIMES);
  const porId = await pokemonsPorId(idsDosTimes(rows));
  const porTipo = new Map(TIPOS_GINASIO.map((t) => [t, []]));
  for (const time of montarTimes(rows, porId)) {
    if (!time.pokemons.length) continue;
    porTipo.get(time.tipo)?.push(time);
  }
  return porTipo;
}

/** Os times que ESTE jogador registrou: `{ FIRE: { pokemonIds, poder, pokemons }, … }`. */
export async function timesDoJogador(playerId) {
  const { rows } = await pool.query(`${SQL_SO_OS_TIMES} WHERE gt.player_id = $1`, [playerId]);
  const porId = await pokemonsPorId(idsDosTimes(rows));
  const saida = {};
  for (const time of montarTimes(rows, porId)) {
    saida[time.tipo] = {
      poder: time.poder,
      atualizadoEm: time.atualizadoEm,
      pokemonIds: time.pokemons.map((pk) => pk.id),
      pokemons: time.pokemons,
    };
  }
  return saida;
}

// ------------------------------------------------------------------ escrita

const MENSAGEM_RECUSA = {
  tipo: 'Esse pokémon não é do tipo do ginásio.',
  especie: 'Só um pokémon de cada espécie por ginásio.',
  repetido: 'O mesmo pokémon não entra duas vezes.',
  cheio: `Máximo de ${GINASIO_TIME_MAX} pokémon por ginásio.`,
  sumiu: 'Um ou mais pokémon não estão mais disponíveis.',
};

/**
 * Grava o time de um ginásio.
 *
 * As checagens são todas refeitas aqui contra o banco — o editor do cliente é conveniência,
 * não autoridade. `[]` é escolha válida: é como se sai do ginásio.
 */
export async function salvarTime(playerId, tipoBruto, pokemonIdsRaw) {
  const tipo = tipoDeGinasio(tipoBruto);
  if (!tipo) throw new ErroGinasio('tipo', 'Ginásio desconhecido.');

  const pedidos = [...new Set(
    (Array.isArray(pokemonIdsRaw) ? pokemonIdsRaw : []).map(Number).filter(Number.isFinite),
  )];
  if (pedidos.length > GINASIO_TIME_MAX) {
    throw new ErroGinasio('cheio', MENSAGEM_RECUSA.cheio);
  }

  if (pedidos.length) {
    const { rows } = await pool.query(
      `SELECT pp.id AS pk_id, pp.species_id, pp.level, pp.quality, pp.ivs, pp.shiny,
              pp.potencia, pp.tm_elemental, pp.bonus_base
         FROM player_pokemon pp
        WHERE pp.player_id = $1 AND pp.anuncio_id IS NULL AND pp.id = ANY($2::bigint[])`,
      [playerId, pedidos],
    );
    const porId = new Map(rows.map((r) => [Number(r.pk_id), pokemonDaLinha(r)]));
    const time = pedidos.map((id) => porId.get(id));
    if (time.some((pk) => !pk)) {
      throw new ErroGinasio('pokemon', MENSAGEM_RECUSA.sumiu);
    }
    const { ok, motivo } = validarTimeGinasio(time, tipo);
    if (!ok) throw new ErroGinasio(motivo, MENSAGEM_RECUSA[motivo] ?? 'Time inválido.');
  }

  await pool.query(
    `INSERT INTO ginasio_times (player_id, tipo, pokemon_ids, atualizado_em)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (player_id, tipo) DO UPDATE
       SET pokemon_ids = EXCLUDED.pokemon_ids, atualizado_em = now()`,
    [playerId, tipo, JSON.stringify(pedidos)],
  );
  return { tipo, pokemonIds: pedidos };
}

// ------------------------------------------------------------------ líderes

/** As 18 linhas do pódio, para o mapa em memória de cada shard. */
export async function lideres() {
  // `looktype` e `visual` vêm junto porque o card do ginásio DESENHA o líder andando — sem
  // eles a grade teria dezoito bonecos genéricos, que é o oposto do que ela quer dizer.
  const { rows } = await pool.query(
    `SELECT gl.tipo, gl.player_id, gl.poder, gl.desde, p.nick, p.looktype, p.visual
       FROM ginasio_lideres gl
       LEFT JOIN players p ON p.id = gl.player_id`,
  );
  return rows.map((r) => ({
    tipo: r.tipo,
    playerId: r.player_id == null ? null : Number(r.player_id),
    nick: r.nick ?? null,
    looktype: Number(r.looktype) || 159,
    visual: typeof r.visual === 'string' ? JSON.parse(r.visual) : r.visual,
    poder: Number(r.poder) || 0,
    desde: r.desde,
  }));
}

/**
 * Grava o pódio apurado.
 *
 * O DONO do título só muda em dois casos: (1) ginásio vazio ou o líder saiu do time — aí
 * entra quem tem maior ⚔; (2) alguém vence o desafio (`transferirLiderancaPorDesafio`).
 * Ter ⚔ maior que o líder no pódio NÃO rouba o título sozinho — precisa vencer na luta.
 *
 * `desde` só reinicia quando `player_id` muda. O `poder` do líder atual é sempre refrescado.
 */
export async function gravarLideres(porTipo) {
  const atuais = new Map((await lideres()).map((l) => [l.tipo, l]));
  const valores = TIPOS_GINASIO.map((tipo) => {
    const times = porTipo.get(tipo) ?? [];
    const topo = times[0] ?? null;
    const atual = atuais.get(tipo);
    const liderId = atual?.playerId ?? null;
    const timeLider = liderId ? times.find((t) => Number(t.playerId) === Number(liderId)) : null;

    if (!topo) return { tipo, player_id: null, poder: 0 };
    if (!liderId || !timeLider) {
      return { tipo, player_id: topo.playerId, poder: topo.poder };
    }
    return { tipo, player_id: liderId, poder: timeLider.poder };
  });
  await pool.query(
    `INSERT INTO ginasio_lideres (tipo, player_id, poder, desde, apurado_em)
     SELECT v.tipo, v.player_id, v.poder, now(), now()
       FROM jsonb_to_recordset($1::jsonb) AS v(tipo text, player_id bigint, poder int)
     ON CONFLICT (tipo) DO UPDATE
       SET player_id  = EXCLUDED.player_id,
           poder      = EXCLUDED.poder,
           apurado_em = now(),
           desde      = CASE
                          WHEN ginasio_lideres.player_id IS DISTINCT FROM EXCLUDED.player_id
                          THEN now() ELSE ginasio_lideres.desde
                        END`,
    [JSON.stringify(valores)],
  );
  return valores;
}

/** Vitória no desafio — o vencedor toma o título na hora. */
export async function transferirLiderancaPorDesafio(tipo, playerId, poder) {
  const t = tipoDeGinasio(tipo);
  if (!t) return;
  await pool.query(
    `INSERT INTO ginasio_lideres (tipo, player_id, poder, desde, apurado_em)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (tipo) DO UPDATE
       SET player_id = EXCLUDED.player_id,
           poder = EXCLUDED.poder,
           desde = now(),
           apurado_em = now()`,
    [t, playerId, Math.max(0, Math.floor(Number(poder) || 0))],
  );
}

/** Quanto falta, em ms, para este jogador desafiar de novo ESTE ginásio. */
export async function msAteProximoDesafio(playerId, tipoBruto) {
  const tipo = tipoDeGinasio(tipoBruto);
  if (!tipo) return 0;
  const { rows } = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (proximo_em - now())) * 1000 AS ms
       FROM ginasio_desafio_cd
      WHERE player_id = $1 AND tipo = $2`,
    [playerId, tipo],
  );
  const ms = Number(rows[0]?.ms);
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms) : 0;
}

/** Registra o cooldown de 24 h após um desafio (vitória ou derrota). */
export async function registrarCooldownDesafio(playerId, tipoBruto) {
  const tipo = tipoDeGinasio(tipoBruto);
  if (!tipo) return;
  await pool.query(
    `INSERT INTO ginasio_desafio_cd (player_id, tipo, proximo_em)
     VALUES ($1, $2, now() + ($3::bigint * interval '1 millisecond'))
     ON CONFLICT (player_id, tipo) DO UPDATE
       SET proximo_em = EXCLUDED.proximo_em`,
    [playerId, tipo, GINASIO_DESAFIO_COOLDOWN_MS],
  );
}
