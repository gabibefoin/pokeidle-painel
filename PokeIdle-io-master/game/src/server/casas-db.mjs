// Persistência das CASAS — uma linha por casa, e o id da linha é o NÚMERO dela no servidor.
//
// ### Por que uma tabela, e não mais um número em `players.items`
//
// A casa foi quantidade (`items[70040] = 3`) enquanto só a raridade importava. Com o número, deixa
// de caber: três Casas Comuns são a #000007, a #000031 e a #000112, e é o número que o Mercado
// vende e que o registro do servidor mostra. O desenho é o da Caixa de Fundador (`caixas-db.mjs`),
// que já era peça numerada negociável: o dono é uma coluna, e anunciar põe `anuncio_id` na linha
// (escrow) na MESMA transação do anúncio — ver `market-db.mjs`.
//
// ### O número é o `id`, e o id é do Postgres
//
// `BIGSERIAL` dá um número global, crescente e irrepetível sem lock nenhum: dois sims fabricando
// casas ao mesmo tempo recebem números diferentes do mesmo `nextval`. Pode sobrar um buraco (uma
// transação que recebeu o número e voltou atrás), e está tudo bem — o número conta casas abertas
// no servidor, não promete ser contíguo.
//
// A linha NUNCA é apagada. `criador` é quem tirou a casa e fica para sempre, mesmo que ela troque
// de dono dez vezes: é o que responde "quem abriu a #000001" um ano depois.
//
// ### A virada: as casas-item que já existiam
//
// `numerarCasasLegadas` roda UMA vez (marca em `game_meta`) e numera as casas que estavam na
// bolsa e nos anúncios abertos, na ordem em que foram tiradas — ver `planejarNumeracao`. O resto
// deste cabeçalho é sobre a janela do deploy, que é onde isso pode dar errado.
//
// O deploy reinicia os sims UM DE CADA VEZ. O primeiro a subir migra o banco inteiro enquanto o
// segundo ainda é o processo ANTIGO, com as casas-item dos jogadores dele em memória — e a última
// coisa que ele faz ao parar é um flush, que regrava essas casas em `players.items`. Sem cuidado,
// o login seguinte converteria de novo e o jogador sairia com as casas em dobro.
//
// O cuidado é `players.casas_legado`: a migração anota quantas casas de cada raridade converteu
// daquela conta. No primeiro login depois dela, a casa-item que aparecer na bolsa só vira casa nova
// no que PASSAR dessa conta (uma fabricada no processo antigo durante a janela, por exemplo); o
// que couber nela é a cópia regravada pelo flush, e só sai da bolsa. A anotação é consumida nesse
// login — dali em diante não existe mais processo antigo para regravar nada.
import { pool } from './db.mjs';
import { RARIDADES_CASA } from '../shared/casas.mjs';
import { CASA_POR_RARIDADE } from './game/itens-nossos.mjs';
import { planejarNumeracao, raridadeCasaValida } from './game/casas.mjs';

/** Linhas por página no registro do servidor. */
export const POR_PAGINA_REGISTRO = 30;

const ITENS_CASA = RARIDADES_CASA.map((r) => CASA_POR_RARIDADE[r.id]);
const RARIDADE_DO_ITEM = new Map(RARIDADES_CASA.map((r) => [CASA_POR_RARIDADE[r.id], r.id]));
const CHAVE_META_NUMERACAO = 'casas_numeradas_v1';

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS casas (
      id          BIGSERIAL PRIMARY KEY,               -- o NÚMERO da casa no servidor
      raridade    TEXT   NOT NULL,
      dono_id     BIGINT REFERENCES players(id) ON DELETE SET NULL,
      -- Quem TIROU a casa. Não muda quando ela é vendida: é o "aberta por" do registro.
      criador_id  BIGINT REFERENCES players(id) ON DELETE SET NULL,
      criador     TEXT   NOT NULL,
      -- De onde ela veio: 'fabricada' (Professor Carvalho), 'legado' (numerada na virada, a partir
      -- da bolsa), 'anuncio' (numerada na virada, a partir de um anúncio aberto) e 'bolsa' (uma
      -- casa-item que apareceu depois da virada e foi numerada no login).
      origem      TEXT   NOT NULL DEFAULT 'fabricada',
      -- Escrow do Mercado da Comunidade. NULL = está com o dono; preenchido = está na vitrine.
      anuncio_id  BIGINT,
      criada_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // A lista do jogador (login e modal) e o registro filtrado por raridade são as consultas quentes.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_casas_dono ON casas(dono_id, id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_casas_raridade ON casas(raridade, id DESC)`);
  // Quantas casas-item a virada converteu desta conta — ver o cabeçalho. `{}` é "nada a conferir".
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS casas_legado JSONB NOT NULL DEFAULT '{}'::jsonb`);

  const virada = await numerarCasasLegadas();
  if (virada?.feito) {
    console.log(`[casas] virada: ${virada.casas} casa(s) numerada(s) · ${virada.contas} conta(s) · ${virada.anuncios} anúncio(s)`);
  }
  const anuncios = await numerarAnunciosAntigos();
  if (anuncios.casas) console.log(`[casas] ${anuncios.casas} casa(s) de anúncio antigo numerada(s)`);
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

/** A linha como o sim a guarda em `p.casas`. */
export const casaParaSim = (r) => ({
  id: Number(r.id),
  raridade: r.raridade,
  anunciada: r.anuncio_id != null,
  criadaEm: r.criada_em?.getTime?.() ?? null,
  criador: r.criador ?? null,
});

/** Lê a raridade de um detalhe do log: "obteve casa lendaria · shard 1" → 'lendaria'. */
const raridadeDoLog = (detalhe) => raridadeCasaValida(/obteve casa (\w+)/.exec(String(detalhe ?? ''))?.[1]);

/**
 * A VIRADA: numera as casas-item que existiam antes da tabela. Uma vez só, sob lock.
 *
 * Dois sims podem subir juntos; o `pg_advisory_xact_lock` põe o segundo na fila, e quando ele
 * entra a marca de `game_meta` já está lá. A marca é gravada na MESMA transação da numeração, então
 * não existe o estado "numerou mas não marcou".
 */
export function numerarCasasLegadas() {
  return comTransacao(async (cli) => {
    await cli.query(`SELECT pg_advisory_xact_lock(hashtext('casas:numeracao'))`);
    const { rows: meta } = await cli.query(`SELECT 1 FROM game_meta WHERE chave = $1`, [CHAVE_META_NUMERACAO]);
    if (meta.length) return { feito: false };

    const chavesItem = ITENS_CASA.map(String);
    const { rows: bolsas } = await cli.query(
      `SELECT id, nick, items FROM players WHERE items ?| $1::text[] ORDER BY id FOR UPDATE`,
      [chavesItem],
    );
    const { rows: anuncios } = await cli.query(
      `SELECT id, vendedor_id, vendedor, item_id, qtd FROM market_anuncios
        WHERE estado = 'aberto' AND tipo = 'item' AND item_id = ANY($1::int[]) AND ficha->>'casaId' IS NULL
        ORDER BY id FOR UPDATE`,
      [ITENS_CASA],
    );

    // O log pode não existir num banco novo (a migração dele roda depois); aí não há o que casar.
    const { rows: temLog } = await cli.query(`SELECT to_regclass('player_gameplay_log') AS t`);
    const aberturas = [];
    if (temLog[0]?.t) {
      const { rows } = await cli.query(
        `SELECT id, player_id, nick, detalhe, criado_em FROM player_gameplay_log
          WHERE categoria = 'casa' AND acao = 'nova' ORDER BY id`,
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
      for (const itemId of ITENS_CASA) {
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
      // Anúncio de uma casa só continua de pé, agora pelo número. De um lote de várias, a primeira
      // fica no anúncio e as outras voltam para o vendedor — uma casa numerada não empilha.
      for (let i = 0; i < qtd; i++) {
        unidades.push({ donoId: Number(a.vendedor_id), dono: a.vendedor, raridade, anuncioId: i === 0 ? Number(a.id) : null });
      }
    }

    const plano = planejarNumeracao({ unidades, aberturas });
    const { rows: maxRows } = await cli.query(`SELECT COALESCE(max(id), 0)::bigint AS m FROM casas`);
    let proximo = Number(maxRows[0].m);
    for (const u of plano) {
      proximo++;
      // O id vai EXPLÍCITO: a ordem dos números é o produto desta migração, e um `nextval` num
      // INSERT em lote não promete seguir a ordem do SELECT.
      await cli.query(
        `INSERT INTO casas (id, raridade, dono_id, criador_id, criador, origem, anuncio_id, criada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE(to_timestamp($8::double precision / 1000), now()))`,
        [proximo, u.raridade, u.donoId, u.criadorId, u.criador ?? u.dono ?? '?',
          u.anuncioId ? 'anuncio' : 'legado', u.anuncioId, u.em],
      );
      if (u.anuncioId) {
        await cli.query(
          `UPDATE market_anuncios
              SET qtd = 1,
                  ficha = ficha || jsonb_build_object('casaId', $2::bigint, 'numero', $2::bigint, 'casaRaridade', $3::text)
            WHERE id = $1`,
          [u.anuncioId, proximo, u.raridade],
        );
      }
    }
    if (proximo > 0) {
      await cli.query(`SELECT setval(pg_get_serial_sequence('casas', 'id'), $1)`, [proximo]);
    }

    for (const [playerId, contagem] of legadoPorConta) {
      await cli.query(
        `UPDATE players SET items = items - $2::text[], casas_legado = $3::jsonb WHERE id = $1`,
        [playerId, chavesItem, JSON.stringify(contagem)],
      );
    }

    const resumo = { casas: plano.length, contas: legadoPorConta.size, anuncios: anuncios.length, em: new Date().toISOString() };
    await cli.query(`INSERT INTO game_meta (chave, valor) VALUES ($1, $2)`, [CHAVE_META_NUMERACAO, JSON.stringify(resumo)]);
    return { feito: true, ...resumo };
  });
}

/**
 * Numera anúncio de casa ainda no formato de quantidade. Roda em TODO boot.
 *
 * Depois da virada só um processo antigo — o que ainda estava de pé na janela do deploy — pode ter
 * criado um anúncio assim. Sem esta passada, a compra dele entregaria uma casa-item ao comprador.
 * O critério (`ficha->>'casaId' IS NULL`) só casa com anúncio antigo, então a consulta volta vazia
 * em todo boot dali em diante.
 */
export function numerarAnunciosAntigos() {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(
      `SELECT id, vendedor_id, vendedor, item_id, qtd FROM market_anuncios
        WHERE estado = 'aberto' AND tipo = 'item' AND item_id = ANY($1::int[]) AND ficha->>'casaId' IS NULL
        ORDER BY id FOR UPDATE`,
      [ITENS_CASA],
    );
    let casas = 0;
    for (const a of rows) {
      const raridade = RARIDADE_DO_ITEM.get(Number(a.item_id));
      const qtd = Math.max(1, Math.floor(Number(a.qtd)));
      for (let i = 0; i < qtd; i++) {
        const { rows: nova } = await cli.query(
          `INSERT INTO casas (raridade, dono_id, criador_id, criador, origem, anuncio_id)
           VALUES ($1, $2, $2, $3, 'anuncio', $4) RETURNING id`,
          [raridade, a.vendedor_id, a.vendedor, i === 0 ? a.id : null],
        );
        casas++;
        if (i === 0) {
          await cli.query(
            `UPDATE market_anuncios
                SET qtd = 1,
                    ficha = ficha || jsonb_build_object('casaId', $2::bigint, 'numero', $2::bigint, 'casaRaridade', $3::text)
              WHERE id = $1`,
            [a.id, nova[0].id, raridade],
          );
        }
      }
    }
    return { casas };
  });
}

/**
 * Cria UMA casa e devolve a linha. É aqui que o número nasce.
 *
 * Não cobra nada: quem fabrica já gastou os fragmentos em memória e os devolve se isto estourar.
 */
export async function criarCasa({ donoId, nick, raridade, origem = 'fabricada' }) {
  const rar = raridadeCasaValida(raridade);
  if (!rar) throw new Error('casa.invalida');
  const { rows } = await pool.query(
    `INSERT INTO casas (raridade, dono_id, criador_id, criador, origem)
     VALUES ($1, $2, $2, $3, $4) RETURNING *`,
    [rar, donoId, nick, origem],
  );
  return casaParaSim(rows[0]);
}

/** Todas as casas do jogador — as da mão e as que estão no Mercado (`anunciada`). */
export async function casasDoJogador(playerId) {
  const { rows } = await pool.query(
    `SELECT id, raridade, anuncio_id, criada_em, criador FROM casas WHERE dono_id = $1 ORDER BY id`,
    [playerId],
  );
  return rows.map(casaParaSim);
}

/**
 * Numera as casas-item que aparecerem na bolsa depois da virada — ver o cabeçalho.
 *
 * `bolsa` é `{ raridade: qtd }` do que estava em `items`. O que couber em `casas_legado` é a cópia
 * regravada pelo processo antigo e só sai; o que passar vira casa nova. Na mesma transação as
 * chaves saem de `players.items` e a anotação é consumida, para um crash antes do flush não
 * numerar a mesma casa de novo no login seguinte.
 *
 * Devolve `{ criadas: [casa], descartadas: n }`.
 */
export function converterCasasDaBolsa({ playerId, nick, bolsa }) {
  return comTransacao(async (cli) => {
    const { rows } = await cli.query(`SELECT casas_legado FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    const legado = rows[0]?.casas_legado ?? {};
    const criadas = [];
    let descartadas = 0;
    for (const r of RARIDADES_CASA) {
      const naBolsa = Math.max(0, Math.floor(Number(bolsa?.[r.id] ?? 0)));
      const jaConvertidas = Math.max(0, Math.floor(Number(legado?.[r.id] ?? 0)));
      const novas = Math.max(0, naBolsa - jaConvertidas);
      descartadas += naBolsa - novas;
      for (let i = 0; i < novas; i++) {
        const { rows: nova } = await cli.query(
          `INSERT INTO casas (raridade, dono_id, criador_id, criador, origem)
           VALUES ($1, $2, $2, $3, 'bolsa') RETURNING *`,
          [r.id, playerId, nick],
        );
        criadas.push(casaParaSim(nova[0]));
      }
    }
    await cli.query(
      `UPDATE players SET items = items - $2::text[], casas_legado = '{}'::jsonb WHERE id = $1`,
      [playerId, ITENS_CASA.map(String)],
    );
    return { criadas, descartadas };
  });
}

/** Esquece a anotação da virada de quem logou sem casa-item nenhuma na bolsa. */
export async function consumirLegado(playerId) {
  await pool.query(`UPDATE players SET casas_legado = '{}'::jsonb WHERE id = $1 AND casas_legado <> '{}'::jsonb`, [playerId]);
}

/**
 * O REGISTRO do servidor: as casas mais novas primeiro, como o de shinys e P5 da Pokédex.
 *
 * `contagem` vem na mesma resposta, por raridade, porque é ela que desenha os filtros ("Lendária
 * · 3") e o contador do topo ("1.234 casas abertas") — duas consultas a menos. A tabela é pequena
 * (uma linha por casa que já existiu), então o `count` sem índice próprio cabe com folga.
 */
export async function registro({ raridade = null, pagina = 0 } = {}) {
  const rar = raridadeCasaValida(raridade);
  const pag = Math.max(0, Math.min(1_000, Math.floor(Number(pagina) || 0)));
  const filtros = RARIDADES_CASA.map((r) => `count(*) FILTER (WHERE raridade = '${r.id}')::int AS "${r.id}"`).join(', ');
  const [{ rows: cont }, { rows }] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total, ${filtros} FROM casas`),
    pool.query(
      `SELECT c.id, c.raridade, c.criador, c.criador_id, c.criada_em, c.dono_id,
              pl.nick AS dono, ma.id AS anuncio_id, ma.preco, ma.moeda
         FROM casas c
         LEFT JOIN players pl ON pl.id = c.dono_id
         LEFT JOIN market_anuncios ma ON ma.id = c.anuncio_id AND ma.estado = 'aberto'
        WHERE ($1::text IS NULL OR c.raridade = $1)
        ORDER BY c.id DESC
        LIMIT $2 OFFSET $3`,
      [rar, POR_PAGINA_REGISTRO, pag * POR_PAGINA_REGISTRO],
    ),
  ]);
  const contagem = { total: cont[0].total };
  for (const r of RARIDADES_CASA) contagem[r.id] = cont[0][r.id];
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

/** Uma casa pelo número, sem trava — leitura otimista, para prévia e teste. */
export async function casaPorId(id) {
  const { rows } = await pool.query(`SELECT * FROM casas WHERE id = $1`, [id]);
  const r = rows[0];
  return r ? { ...casaParaSim(r), donoId: r.dono_id == null ? null : Number(r.dono_id), anuncioId: r.anuncio_id == null ? null : Number(r.anuncio_id) } : null;
}
