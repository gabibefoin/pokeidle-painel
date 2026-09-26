// Persistência das BICICLETAS — uma linha por bicicleta, e o id da linha é o NÚMERO dela no servidor.
//
// É o desenho de `casas-db.mjs`, peça por peça, e pela mesma razão: a bicicleta foi QUANTIDADE
// (`items[70084] = 2`) enquanto só a raridade importava. Com o número deixa de caber — duas Lendárias
// são a #000003 e a #000019, e é o número que o Mercado vende, que o Registro de Bikes mostra e que
// o jogador EQUIPA. O dono é uma coluna, e anunciar põe `anuncio_id` na linha (escrow) na MESMA
// transação do anúncio — ver `market-db.mjs`.
//
// ### O número é o `id`, e o id é do Postgres
//
// `BIGSERIAL` dá um número global, crescente e irrepetível sem lock nenhum: dois sims fabricando ao
// mesmo tempo recebem números diferentes do mesmo `nextval`. Pode sobrar um buraco (uma transação que
// recebeu o número e voltou atrás), e está tudo bem — o número conta bicicletas abertas, não promete
// ser contíguo. A linha NUNCA é apagada: `criador` é quem tirou, para sempre.
//
// ### A virada: as bicicletas-item que já existiam
//
// `numerarBicicletasLegadas` roda UMA vez (marca em `game_meta`) e numera as bicicletas que estavam
// na bolsa e nos anúncios abertos, na ordem em que foram tiradas (o log `bicicleta · nova`, casado por
// `planejarNumeracao`, a mesma função das casas).
//
// A janela do deploy é a das casas: o sim ANTIGO ainda de pé regrava a bolsa com as bicicletas-item no
// flush de saída. `players.bicicletas_legado` anota quantas de cada raridade a virada converteu, e no
// primeiro login depois dela só vira bicicleta nova o que PASSAR dessa conta.
import { pool } from './db.mjs';
import { RARIDADES_BICICLETA, raridadeBicicletaValida } from '../shared/bicicletas.mjs';
import { BICICLETA_POR_RARIDADE } from './game/itens-nossos.mjs';
import { planejarNumeracao } from './game/casas.mjs';

/** Linhas por página no Registro de Bikes. */
export const POR_PAGINA_REGISTRO = 30;

const ITENS_BICICLETA = RARIDADES_BICICLETA.map((r) => BICICLETA_POR_RARIDADE[r.id]);
const RARIDADE_DO_ITEM = new Map(RARIDADES_BICICLETA.map((r) => [BICICLETA_POR_RARIDADE[r.id], r.id]));
const CHAVE_META_NUMERACAO = 'bicicletas_numeradas_v1';

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bicicletas (
      id          BIGSERIAL PRIMARY KEY,               -- o NÚMERO da bicicleta no servidor
      raridade    TEXT   NOT NULL,
      dono_id     BIGINT REFERENCES players(id) ON DELETE SET NULL,
      -- Quem TIROU a bicicleta. Não muda quando ela é vendida: é o "tirada por" do registro.
      criador_id  BIGINT REFERENCES players(id) ON DELETE SET NULL,
      criador     TEXT   NOT NULL,
      -- 'fabricada' (Professor Carvalho), 'legado' (numerada na virada, da bolsa), 'anuncio' (da
      -- virada, de um anúncio aberto) e 'bolsa' (bicicleta-item que apareceu depois da virada).
      origem      TEXT   NOT NULL DEFAULT 'fabricada',
      -- Escrow do Mercado da Comunidade. NULL = está com o dono; preenchido = está na vitrine.
      anuncio_id  BIGINT,
      criada_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bicicletas_dono ON bicicletas(dono_id, id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bicicletas_raridade ON bicicletas(raridade, id DESC)`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS bicicletas_legado JSONB NOT NULL DEFAULT '{}'::jsonb`);

  const virada = await numerarBicicletasLegadas();
  if (virada?.feito) {
    console.log(`[bicicletas] virada: ${virada.bicicletas} bicicleta(s) numerada(s) · ${virada.contas} conta(s) · ${virada.anuncios} anúncio(s)`);
  }
  const anuncios = await numerarAnunciosAntigos();
  if (anuncios.bicicletas) console.log(`[bicicletas] ${anuncios.bicicletas} bicicleta(s) de anúncio antigo numerada(s)`);
}

/** Roda `fn` numa transação, com COMMIT/ROLLBACK garantidos. */
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

/** A linha como o sim a guarda em `p.bicicletas`. */
export const bicicletaParaSim = (r) => ({
  id: Number(r.id),
  raridade: r.raridade,
  anunciada: r.anuncio_id != null,
  criadaEm: r.criada_em?.getTime?.() ?? null,
  criador: r.criador ?? null,
});

/** Lê a raridade de um detalhe do log: "obteve bicicleta lendaria · shard 1" → 'lendaria'. */
const raridadeDoLog = (detalhe) => raridadeBicicletaValida(/obteve bicicleta (\w+)/.exec(String(detalhe ?? ''))?.[1]);

/** O pedaço de ficha que liga um anúncio a uma bicicleta — o mesmo que `market.criar` escreve. */
const fichaDaBicicleta = `jsonb_build_object('bicicletaId', $2::bigint, 'numero', $2::bigint, 'bicicletaRaridade', $3::text)`;

/**
 * A VIRADA: numera as bicicletas-item que existiam antes da tabela. Uma vez só, sob lock.
 *
 * Dois sims podem subir juntos; o `pg_advisory_xact_lock` põe o segundo na fila, e quando ele entra a
 * marca de `game_meta` já está lá. A marca é gravada na MESMA transação da numeração.
 */
export function numerarBicicletasLegadas() {
  return comTransacao(async (cli) => {
    await cli.query(`SELECT pg_advisory_xact_lock(hashtext('bicicletas:numeracao'))`);
    const { rows: meta } = await cli.query(`SELECT 1 FROM game_meta WHERE chave = $1`, [CHAVE_META_NUMERACAO]);
    if (meta.length) return { feito: false };

    const chavesItem = ITENS_BICICLETA.map(String);
    const { rows: bolsas } = await cli.query(
      `SELECT id, nick, items FROM players WHERE items ?| $1::text[] ORDER BY id FOR UPDATE`,
      [chavesItem],
    );
    const { rows: anuncios } = await cli.query(
      `SELECT id, vendedor_id, vendedor, item_id, qtd FROM market_anuncios
        WHERE estado = 'aberto' AND tipo = 'item' AND item_id = ANY($1::int[]) AND ficha->>'bicicletaId' IS NULL
        ORDER BY id FOR UPDATE`,
      [ITENS_BICICLETA],
    );

    const { rows: temLog } = await cli.query(`SELECT to_regclass('player_gameplay_log') AS t`);
    const aberturas = [];
    if (temLog[0]?.t) {
      const { rows } = await cli.query(
        `SELECT id, player_id, nick, detalhe, criado_em FROM player_gameplay_log
          WHERE categoria = 'bicicleta' AND acao = 'nova' ORDER BY id`,
      );
      for (const r of rows) {
        const raridade = raridadeDoLog(r.detalhe);
        if (!raridade) continue;
        aberturas.push({
          logId: Number(r.id), playerId: Number(r.player_id), nick: r.nick, raridade,
          em: r.criado_em?.getTime?.() ?? 0,
        });
      }
    }

    const unidades = [];
    const legadoPorConta = new Map();
    for (const b of bolsas) {
      const contagem = {};
      for (const itemId of ITENS_BICICLETA) {
        const qtd = Math.floor(Number(b.items?.[itemId] ?? 0));
        const raridade = RARIDADE_DO_ITEM.get(itemId);
        for (let i = 0; i < qtd; i++) unidades.push({ donoId: Number(b.id), dono: b.nick, raridade, anuncioId: null });
        if (qtd > 0) contagem[raridade] = qtd;
      }
      legadoPorConta.set(Number(b.id), contagem);
    }
    for (const a of anuncios) {
      const raridade = RARIDADE_DO_ITEM.get(Number(a.item_id));
      const qtd = Math.max(1, Math.floor(Number(a.qtd)));
      // Um lote de várias: a primeira fica no anúncio e as outras voltam ao vendedor — uma bicicleta
      // numerada não empilha.
      for (let i = 0; i < qtd; i++) {
        unidades.push({ donoId: Number(a.vendedor_id), dono: a.vendedor, raridade, anuncioId: i === 0 ? Number(a.id) : null });
      }
    }

    const plano = planejarNumeracao({ unidades, aberturas });
    const { rows: maxRows } = await cli.query(`SELECT COALESCE(max(id), 0)::bigint AS m FROM bicicletas`);
    let proximo = Number(maxRows[0].m);
    for (const u of plano) {
      proximo++;
      await cli.query(
        `INSERT INTO bicicletas (id, raridade, dono_id, criador_id, criador, origem, anuncio_id, criada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE(to_timestamp($8::double precision / 1000), now()))`,
        [proximo, u.raridade, u.donoId, u.criadorId, u.criador ?? u.dono ?? '?',
          u.anuncioId ? 'anuncio' : 'legado', u.anuncioId, u.em],
      );
      if (u.anuncioId) {
        await cli.query(
          `UPDATE market_anuncios SET qtd = 1, ficha = ficha || ${fichaDaBicicleta} WHERE id = $1`,
          [u.anuncioId, proximo, u.raridade],
        );
      }
    }
    if (proximo > 0) {
      await cli.query(`SELECT setval(pg_get_serial_sequence('bicicletas', 'id'), $1)`, [proximo]);
    }

    for (const [playerId, contagem] of legadoPorConta) {
      await cli.query(
        `UPDATE players SET items = items - $2::text[], bicicletas_legado = $3::jsonb WHERE id = $1`,
        [playerId, chavesItem, JSON.stringify(contagem)],
      );
    }

    const resumo = { bicicletas: plano.length, contas: legadoPorConta.size, anuncios: anuncios.length, em: new Date().toISOString() };
    await cli.query(`INSERT INTO game_meta (chave, valor) VALUES ($1, $2)`, [CHAVE_META_NUMERACAO, JSON.stringify(resumo)]);
    return { feito: true, ...resumo };
  });
}

/**
 * Numera anúncio de bicicleta ainda no formato de quantidade. Roda em TODO boot.
 *
 * Depois da virada, só um processo antigo — o que ainda estava de pé na janela do deploy — pode ter
 * criado um anúncio assim. Sem esta passada, a compra dele entregaria uma bicicleta-item ao comprador.
 */
export function numerarAnunciosAntigos() {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `SELECT id, vendedor_id, vendedor, item_id, qtd FROM market_anuncios
        WHERE estado = 'aberto' AND tipo = 'item' AND item_id = ANY($1::int[]) AND ficha->>'bicicletaId' IS NULL
        ORDER BY id FOR UPDATE`,
      [ITENS_BICICLETA],
    );
    let bicicletas = 0;
    for (const a of rows) {
      const raridade = RARIDADE_DO_ITEM.get(Number(a.item_id));
      const qtd = Math.max(1, Math.floor(Number(a.qtd)));
      for (let i = 0; i < qtd; i++) {
        const { rows: nova } = await cli.query(
          `INSERT INTO bicicletas (raridade, dono_id, criador_id, criador, origem, anuncio_id)
           VALUES ($1, $2, $2, $3, 'anuncio', $4) RETURNING id`,
          [raridade, a.vendedor_id, a.vendedor, i === 0 ? a.id : null],
        );
        bicicletas++;
        if (i === 0) {
          await cli.query(
            `UPDATE market_anuncios SET qtd = 1, ficha = ficha || ${fichaDaBicicleta} WHERE id = $1`,
            [a.id, nova[0].id, raridade],
          );
        }
      }
    }
    return { bicicletas };
  });
}

/**
 * Cria UMA bicicleta e devolve a linha. É aqui que o número nasce.
 *
 * Não cobra nada: quem fabrica já gastou os fragmentos em memória e os devolve se isto estourar.
 */
export async function criarBicicleta({ donoId, nick, raridade, origem = 'fabricada' }) {
  const rar = raridadeBicicletaValida(raridade);
  if (!rar) throw new Error('bicicleta.invalida');
  const { rows } = await pool.query(
    `INSERT INTO bicicletas (raridade, dono_id, criador_id, criador, origem)
     VALUES ($1, $2, $2, $3, $4) RETURNING *`,
    [rar, donoId, nick, origem],
  );
  return bicicletaParaSim(rows[0]);
}

/** Todas as bicicletas do jogador — as da mão e as que estão no Mercado (`anunciada`). */
export async function bicicletasDoJogador(playerId) {
  const { rows } = await pool.query(
    `SELECT id, raridade, anuncio_id, criada_em, criador FROM bicicletas WHERE dono_id = $1 ORDER BY id`,
    [playerId],
  );
  return rows.map(bicicletaParaSim);
}

/**
 * Numera as bicicletas-item que aparecerem na bolsa depois da virada.
 *
 * `bolsa` é `{ raridade: qtd }` do que estava em `items`. O que couber em `bicicletas_legado` é a cópia
 * regravada pelo processo antigo e só sai; o que passar vira bicicleta nova. Na mesma transação as
 * chaves saem de `players.items` e a anotação é consumida. Devolve `{ criadas, descartadas }`.
 */
export function converterBicicletasDaBolsa({ playerId, nick, bolsa }) {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(`SELECT bicicletas_legado FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    const legado = rows[0]?.bicicletas_legado ?? {};
    const criadas = [];
    let descartadas = 0;
    for (const r of RARIDADES_BICICLETA) {
      const naBolsa = Math.max(0, Math.floor(Number(bolsa?.[r.id] ?? 0)));
      const jaConvertidas = Math.max(0, Math.floor(Number(legado?.[r.id] ?? 0)));
      const novas = Math.max(0, naBolsa - jaConvertidas);
      descartadas += naBolsa - novas;
      for (let i = 0; i < novas; i++) {
        const { rows: nova } = await cli.query(
          `INSERT INTO bicicletas (raridade, dono_id, criador_id, criador, origem)
           VALUES ($1, $2, $2, $3, 'bolsa') RETURNING *`,
          [r.id, playerId, nick],
        );
        criadas.push(bicicletaParaSim(nova[0]));
      }
    }
    await cli.query(
      `UPDATE players SET items = items - $2::text[], bicicletas_legado = '{}'::jsonb WHERE id = $1`,
      [playerId, ITENS_BICICLETA.map(String)],
    );
    return { criadas, descartadas };
  });
}

/** Esquece a anotação da virada de quem logou sem bicicleta-item nenhuma na bolsa. */
export async function consumirLegado(playerId) {
  await pool.query(
    `UPDATE players SET bicicletas_legado = '{}'::jsonb WHERE id = $1 AND bicicletas_legado <> '{}'::jsonb`,
    [playerId],
  );
}

/**
 * O REGISTRO DE BIKES: as bicicletas mais novas primeiro, filtrável por raridade — o espelho do
 * registro de casas, com a contagem por raridade na mesma resposta (os filtros e o contador do topo).
 */
export async function registro({ raridade = null, pagina = 0 } = {}) {
  const rar = raridadeBicicletaValida(raridade);
  const pag = Math.max(0, Math.min(1_000, Math.floor(Number(pagina) || 0)));
  const filtros = RARIDADES_BICICLETA.map((r) => `count(*) FILTER (WHERE raridade = '${r.id}')::int AS "${r.id}"`).join(', ');
  const [{ rows: cont }, { rows }] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total, ${filtros} FROM bicicletas`),
    pool.query(
      `SELECT b.id, b.raridade, b.criador, b.criador_id, b.criada_em, b.dono_id,
              pl.nick AS dono, ma.id AS anuncio_id, ma.preco, ma.moeda
         FROM bicicletas b
         LEFT JOIN players pl ON pl.id = b.dono_id
         LEFT JOIN market_anuncios ma ON ma.id = b.anuncio_id AND ma.estado = 'aberto'
        WHERE ($1::text IS NULL OR b.raridade = $1)
        ORDER BY b.id DESC
        LIMIT $2 OFFSET $3`,
      [rar, POR_PAGINA_REGISTRO, pag * POR_PAGINA_REGISTRO],
    ),
  ]);
  const contagem = { total: cont[0].total };
  for (const r of RARIDADES_BICICLETA) contagem[r.id] = cont[0][r.id];
  return {
    raridade: rar,
    pagina: pag,
    porPagina: POR_PAGINA_REGISTRO,
    total: rar ? contagem[rar] : contagem.total,
    contagem,
    linhas: rows.map((r) => ({
      id: Number(r.id),
      raridade: r.raridade,
      dono: r.dono ?? null,
      donoId: r.dono_id == null ? null : Number(r.dono_id),
      criador: r.criador,
      criadorId: r.criador_id == null ? null : Number(r.criador_id),
      criadaEm: r.criada_em?.getTime?.() ?? null,
      anuncio: r.anuncio_id ? { id: Number(r.anuncio_id), preco: Number(r.preco), moeda: r.moeda } : null,
    })),
  };
}

/** Uma bicicleta pelo número, sem trava — leitura otimista, para prévia e teste. */
export async function bicicletaPorId(id) {
  const { rows } = await pool.query(`SELECT * FROM bicicletas WHERE id = $1`, [id]);
  const r = rows[0];
  return r
    ? { ...bicicletaParaSim(r), donoId: r.dono_id == null ? null : Number(r.dono_id), anuncioId: r.anuncio_id == null ? null : Number(r.anuncio_id) }
    : null;
}
