// Persistência das CAIXAS DE FUNDADOR — uma linha por unidade, com série própria.
//
// ### Por que uma tabela, e não mais um número em `players.items`
//
// O inventário do jogo é quantidade: `items[70011] = 12` diz que há doze Fragmentos de Chave e
// não diz (nem precisa dizer) QUAIS. A caixa é o contrário — o `#01` e o `#02` são mercadorias
// diferentes, com preços diferentes no Mercado, e o número é o que o comprador está pagando.
// Guardá-las como quantidade apagaria o produto.
//
// Então o desenho é o do POKÉMON, não o do item: cada caixa é uma linha, o dono é uma coluna,
// e anunciar no Mercado põe `anuncio_id` na linha (escrow) em vez de mexer numa contagem em
// memória. Ver `market-db.mjs`, que faz as duas coisas na MESMA transação do anúncio.
//
// ### A numeração é do banco, e é irrepetível
//
// A série sai de `MAX(serie) + 1` dentro de um `pg_advisory_xact_lock` por tipo. O lock é o que
// impede duas compras simultâneas de calcularem o mesmo número; o `UNIQUE (tipo, serie)` é a
// segunda rede, para o caso de alguém um dia escrever um caminho novo e esquecer do lock.
//
// A linha NUNCA é apagada. Abrir a caixa não remove nada: carimba `aberta_em` e guarda o nick
// que ficou com a tag. É esse histórico que responde "quem é o Fundador #07" um ano depois,
// mesmo que a pessoa troque de nome ou exclua a conta.
import { pool } from './db.mjs';
import { MOTIVO } from './game/diamantes.mjs';
import { movimentarNaTransacao } from './diamantes-db.mjs';
import {
  CAIXAS_BETA, COMPRAS_POR_JOGADOR, TIPOS_CAIXA, caixaPorTipo, nomeDaCaixa,
} from '../shared/caixas-beta.mjs';

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS caixas_beta (
      id            BIGSERIAL PRIMARY KEY,
      tipo          TEXT   NOT NULL,          -- 'fundador' | 'cofundador'
      serie         INT    NOT NULL,          -- 1..limite, irrepetível dentro do tipo
      dono_id       BIGINT REFERENCES players(id) ON DELETE SET NULL,
      -- Quem comprou na Loja. Fica para sempre, mesmo depois de a caixa mudar de mão: é o
      -- registro de quem bancou o beta, e é diferente de quem acabou abrindo.
      comprador_id  BIGINT REFERENCES players(id) ON DELETE SET NULL,
      comprador     TEXT   NOT NULL,
      -- Escrow do Mercado da Comunidade. NULL = está com o dono; preenchido = está na vitrine.
      anuncio_id    BIGINT,
      -- Aberta = os prêmios saíram e a caixa não é mais transferível. Nunca volta a NULL.
      aberta_em     TIMESTAMPTZ,
      aberta_por    BIGINT REFERENCES players(id) ON DELETE SET NULL,
      aberta_nick   TEXT,
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tipo, serie)
    )`);
  // A bolsa do jogador ("as minhas caixas fechadas") e a varredura de tags do chat ("quem
  // abriu o quê") são as duas únicas consultas quentes; uma por índice.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_caixas_dono ON caixas_beta(dono_id) WHERE aberta_em IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_caixas_aberta ON caixas_beta(aberta_por) WHERE aberta_em IS NOT NULL`);
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

/** A linha como o resto do jogo a enxerga. */
export const caixaParaCliente = (r) => ({
  id: Number(r.id),
  tipo: r.tipo,
  serie: Number(r.serie),
  nome: nomeDaCaixa(r.tipo, r.serie),
  aberta: !!r.aberta_em,
  anunciada: r.anuncio_id != null,
});

/**
 * Quantas de cada tipo já saíram da Loja.
 *
 * Conta a tabela inteira, e não só as fechadas: uma caixa aberta continua tendo consumido a
 * sua vaga no limite. Passar a contar só as fechadas devolveria vagas a cada abertura, e o
 * "só 50 no mundo" viraria mentira.
 */
export async function vendidas() {
  const { rows } = await pool.query(
    `SELECT tipo, count(*)::int AS n FROM caixas_beta GROUP BY tipo`,
  );
  const total = Object.fromEntries(TIPOS_CAIXA.map((t) => [t, 0]));
  for (const r of rows) if (r.tipo in total) total[r.tipo] = Number(r.n);
  return total;
}

/**
 * Vende UMA caixa. Não cobra nada — quem cobra é o débito de diamante em `loja.comprar`.
 *
 * A ordem certa é a mesma de toda compra da Loja: valida → DEBITA → aplica. Esta função é o
 * "aplica", e é ela quem descobre o número. Por isso os DOIS limites são conferidos AQUI
 * DENTRO, com o lock segurando: um teto lido antes do débito seria um teto de mentira, porque
 * outra compra pode fechar a última vaga (ou ser o segundo clique do próprio jogador) no meio
 * do caminho.
 *
 * @throws `'esgotada'` quando o tipo acabou no mundo, `'caixas.jaComprou'` quando este jogador
 *   já levou uma deste tipo. Quem chama estorna o diamante nos dois casos.
 */
export function comprarCaixa({ playerId, nick, tipo }) {
  const def = caixaPorTipo(tipo);
  if (!def) throw new Error('caixa inexistente');
  return comTransacao(async (cli) => {
    // Um lock por TIPO: duas compras de Fundador viram fila, mas uma de Fundador e uma de
    // CoFundador seguem em paralelo. `hashtext` é estável dentro da mesma versão do Postgres,
    // que é tudo o que um lock de transação precisa.
    //
    // O lock é por tipo e não por jogador de propósito: ele já serializa TUDO daquele tipo,
    // então cobre de quebra os dois cliques do mesmo jogador na trava de "uma por conta".
    await cli.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`caixa_beta:${def.tipo}`]);

    const { rows: cont } = await cli.query(
      `SELECT COALESCE(max(serie), 0)::int AS ultima,
              count(*)::int AS n,
              count(*) FILTER (WHERE comprador_id = $2)::int AS minhas
         FROM caixas_beta WHERE tipo = $1`,
      [def.tipo, playerId],
    );
    const vendidasDoTipo = Number(cont[0].n);
    if (vendidasDoTipo >= def.limite) throw new Error('esgotada');
    // UMA POR CONTA, no balcão. `comprador_id` é quem comprou na LOJA e não muda quando a
    // caixa é revendida — então quem comprou a sua, vendeu no Mercado e voltou aqui continua
    // sem poder comprar outra, que é exatamente a regra (ver `shared/caixas-beta.mjs`).
    if (Number(cont[0].minhas) >= COMPRAS_POR_JOGADOR) throw new Error('caixas.jaComprou');

    const { rows } = await cli.query(
      `INSERT INTO caixas_beta (tipo, serie, dono_id, comprador_id, comprador)
       VALUES ($1, $2, $3, $3, $4)
       RETURNING *`,
      [def.tipo, Number(cont[0].ultima) + 1, playerId, nick],
    );
    return { ...caixaParaCliente(rows[0]), vendidas: vendidasDoTipo + 1, restam: def.limite - vendidasDoTipo - 1 };
  });
}

/** As caixas FECHADAS que estão na mão do jogador — a bolsa dele. Anúncio no Mercado sai. */
export async function caixasDoJogador(playerId) {
  const { rows } = await pool.query(
    `SELECT * FROM caixas_beta
      WHERE dono_id = $1 AND aberta_em IS NULL AND anuncio_id IS NULL
      ORDER BY tipo, serie`,
    [playerId],
  );
  return rows.map(caixaParaCliente);
}

/**
 * Quais tipos este jogador já comprou NA LOJA — `{ fundador: 1, cofundador: 0 }`.
 *
 * A chave é `comprador_id`, e não `dono_id`: o que a trava de "uma por conta" conta é a
 * passagem pelo BALCÃO, e ela não se desfaz vendendo a caixa depois. Comprar no Mercado da
 * Comunidade não entra aqui — lá não há teto.
 *
 * A tabela tem 150 linhas no total, para sempre, então a varredura sem índice em
 * `comprador_id` custa menos que manter um índice para ela.
 */
export async function comprasDoJogador(playerId) {
  const { rows } = await pool.query(
    `SELECT tipo, count(*)::int AS n FROM caixas_beta WHERE comprador_id = $1 GROUP BY tipo`,
    [playerId],
  );
  const total = Object.fromEntries(TIPOS_CAIXA.map((t) => [t, 0]));
  for (const r of rows) if (r.tipo in total) total[r.tipo] = Number(r.n);
  return total;
}

/**
 * As tags que este jogador CONQUISTOU — as caixas que ele abriu.
 *
 * Chave é `aberta_por` e não `dono_id`: a tag é de quem abriu, e a linha continua sendo dele
 * mesmo que um dia a coluna de dono mude por outro caminho.
 */
export async function tagsDoJogador(playerId) {
  const { rows } = await pool.query(
    `SELECT tipo, serie FROM caixas_beta
      WHERE aberta_por = $1 AND aberta_em IS NOT NULL
      ORDER BY tipo, serie`,
    [playerId],
  );
  return rows.map((r) => ({ tipo: r.tipo, serie: Number(r.serie) }));
}

/**
 * ABRE uma caixa: o ponto sem volta.
 *
 * Tudo numa transação só, e a razão é o diamante. Se a marcação de "aberta" e o crédito
 * fossem duas transações, um processo que caísse no meio deixaria o jogador com uma caixa
 * gasta e sem os diamantes dentro — e não há como saber, depois, se ela chegou a pagar.
 *
 * O que NÃO acontece aqui é a outfit: ela mora no `ownedOutfits` do jogador, que é memória do
 * sim gravada pelo flush, e não dá para escrevê-la nesta transação sem brigar com o
 * `flushJogadores`. Em vez de tentar, o direito à outfit é DERIVADO desta tabela — quem abriu
 * a caixa pode vestir, e o login reconcilia a lista (ver `sincronizarOutfitsDeCaixa` em
 * `game/caixas.mjs`). Assim a outfit não depende de um flush ter acontecido.
 *
 * @returns {{caixa, saldo:number, diamantes:number}}
 */
export function abrirCaixa({ id, playerId, nick }) {
  return comTransacao(async (cli) => {
    // As mensagens são CHAVES de tradução, e não frases: o `aviso` do cliente reconhece o
    // formato `a.b` e traduz (ver o `case 'aviso'` em app.js). O jogo tem três idiomas, e um
    // "essa caixa não é sua" cru apareceria em português para quem joga em inglês.
    const { rows } = await cli.query(`SELECT * FROM caixas_beta WHERE id = $1 FOR UPDATE`, [id]);
    const c = rows[0];
    if (!c) throw new Error('caixas.semCaixa');
    if (Number(c.dono_id) !== Number(playerId)) throw new Error('caixas.naoSua');
    if (c.anuncio_id != null) throw new Error('caixas.emAnuncio');
    if (c.aberta_em) throw new Error('caixas.jaAberta');

    const def = caixaPorTipo(c.tipo);
    if (!def) throw new Error('caixas.semCaixa');

    // `aberta_em IS NULL` no WHERE, e não só no `if` acima: entre o SELECT e o UPDATE não há
    // ninguém (a linha está travada), mas escrever a condição no UPDATE é o que garante que
    // um caminho futuro sem `FOR UPDATE` também não abra duas vezes.
    const upd = await cli.query(
      `UPDATE caixas_beta
          SET aberta_em = now(), aberta_por = $2, aberta_nick = $3
        WHERE id = $1 AND aberta_em IS NULL
        RETURNING *`,
      [id, playerId, nick],
    );
    if (!upd.rowCount) throw new Error('caixas.jaAberta');

    const saldo = await movimentarNaTransacao(
      cli, playerId, def.diamantes, MOTIVO.CAIXA_BETA,
      `caixa:${c.tipo}:${c.serie}`,
      nomeDaCaixa(c.tipo, c.serie),
    );
    return { caixa: caixaParaCliente(upd.rows[0]), saldo, diamantes: def.diamantes };
  });
}

/**
 * O mural do painel de admin: quem comprou cada número e quem abriu.
 *
 * Sem paginação de propósito — são 150 linhas no total, para sempre.
 */
export async function listarTodas() {
  const { rows } = await pool.query(
    `SELECT c.*, p.nick AS dono_nick
       FROM caixas_beta c
       LEFT JOIN players p ON p.id = c.dono_id
      ORDER BY c.tipo, c.serie`,
  );
  return rows.map((r) => ({
    ...caixaParaCliente(r),
    dono: r.dono_nick ?? null,
    comprador: r.comprador,
    abertaPor: r.aberta_nick ?? null,
    abertaEm: r.aberta_em?.getTime?.() ?? null,
    criadoEm: r.criado_em?.getTime?.() ?? null,
  }));
}

export { CAIXAS_BETA };
