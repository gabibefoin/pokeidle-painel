// As CONSULTAS DOS RADARES do Discord — o que o bot lê do banco do jogo para anunciar.
//
// Três feeds, quatro consultas:
//
//   `shiny_pk`        shiny novo na coleção     → ✨┃radar-shiny
//   `saque_pedido`    saque PEDIDO              → canal da staff (com menção ao cargo)
//   `saque_aprovado`  saque APROVADO            → 🤑┃radar-depositos-saques
//   `deposito`        depósito confirmado       → 🤑┃radar-depositos-saques
//
// ### O bot só LÊ. Nada aqui escreve no estado do jogador
//
// Mesma regra do `convites-db.mjs`: o bot não é um segundo dono do estado. A única tabela que
// ele escreve é a `radar_cursor`, que é dele e de mais ninguém — e que existe justamente para
// o bot poder cair, subir e não repetir nem perder o que já anunciou.
//
// ### Por que CURSOR, e não "os últimos N minutos"
//
// Uma janela de tempo ("o que aconteceu desde `now() - 1 min`") depende do relógio e do bot
// estar de pé. Um restart de três minutos perderia três minutos de shiny, e um relógio que
// ande para trás anuncia tudo duas vezes. O cursor é a última linha JÁ ANUNCIADA: o bot pode
// ficar uma hora fora do ar que, ao voltar, continua exatamente de onde parou.
//
// ### A fonte de cada feed, e por que ela e não outra
//
// **Shiny** sai de `player_pokemon`: é lá que ele nasce (`inserirPokemon`, no `db.mjs`, é uma
// escrita direta na captura — não passa pelo write-behind), e é lá que estão a potência, a
// qualidade e os IVs que o canal mostra. A auditoria (`player_gameplay_log`) também registra a
// captura de shiny, mas só como TEXTO — e texto não tem IV somado nem nota.
//
// **Saque pedido** e **saque aprovado** são a MESMA tabela lida por dois carimbos diferentes
// (`criado_em` e `aprovado_em`), porque são dois fatos diferentes para duas plateias
// diferentes: a staff precisa saber que há fila, e o servidor inteiro vê quem recebeu.
//
// ### Os cursores de tempo e o empate de microssegundos
//
// `orb_saques.id` é UUID — não dá para ordenar por ele. Os dois feeds de saque usam carimbo de
// tempo com `>` estrito, e isso tem um buraco teórico: dois saques com `criado_em` idêntico até
// o microssegundo, e o segundo some. Com `now()` do Postgres isso não acontece na prática (a
// resolução é de microssegundo e os dois INSERTs não caem no mesmo), e a alternativa —
// guardar a lista de ids já anunciados — custa uma tabela que cresce para sempre para resolver
// um empate que nunca vi. Fica anotado: se um dia um saque não for anunciado, é aqui.
import { pool } from './db.mjs';

/** Quantos eventos um feed anuncia por ciclo. O resto fica para o ciclo seguinte. */
export const TETO_POR_CICLO = 20;

/**
 * O nome do feed do shiny carrega o sufixo `_pk` porque a FONTE dele mudou.
 *
 * A primeira versão lia `player_gameplay_log` e o cursor guardava o id de lá; esta lê
 * `player_pokemon`, e os dois contadores não têm nada a ver um com o outro. Reaproveitar o
 * nome faria o cursor antigo (um id da auditoria, na casa dos 900 mil) ser lido como id de
 * pokémon — e o radar despejaria no canal todo shiny do jogo com id acima disso.
 *
 * Trocar o nome resolve sozinho: o feed novo não tem cursor, nasce no presente pela semeadura,
 * e o `migrar()` varre a linha órfã do nome velho.
 */
export const FEEDS = ['shiny_pk', 'saque_pedido', 'saque_aprovado', 'deposito'];

export async function migrar() {
  // Uma linha por feed. `valor` é TEXT porque os quatro cursores não são do mesmo tipo (dois
  // são `bigint`, dois são carimbo de tempo) e uma coluna por tipo seria três colunas nulas em
  // toda linha. Quem lê converte — são quatro consultas, todas neste arquivo.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS radar_cursor (
      feed  TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      em    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // Cursor de feed que não existe mais é lixo — e lixo com nome parecido é pior que lixo, porque
  // um dia alguém reaproveita o nome e herda um número que significava outra coisa.
  await pool.query(`DELETE FROM radar_cursor WHERE feed <> ALL($1::text[])`, [FEEDS]);
}

export async function lerCursor(feed) {
  const { rows } = await pool.query(`SELECT valor FROM radar_cursor WHERE feed = $1`, [feed]);
  return rows[0]?.valor ?? null;
}

export async function gravarCursor(feed, valor) {
  await pool.query(
    `INSERT INTO radar_cursor (feed, valor, em) VALUES ($1, $2, now())
     ON CONFLICT (feed) DO UPDATE SET valor = EXCLUDED.valor, em = now()`,
    [feed, String(valor)],
  );
}

/**
 * O primeiro boot começa do AGORA, não do começo do jogo.
 *
 * Foi pedido assim, e é o único jeito que faz sentido: sem isto, ligar o radar despejaria no
 * canal os 258 shinies e os 134 saques da vida inteira do servidor, em rajada, e o Discord
 * cortaria o bot por excesso de requisições no meio da enxurrada.
 *
 * Roda a cada boot e só preenche o que FALTA (`ON CONFLICT DO NOTHING`): um feed que já tem
 * cursor continua de onde parou, e um feed novo (acrescentado numa versão futura) nasce no
 * presente em vez de varrer o histórico dele.
 */
export async function semearCursores() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COALESCE(MAX(id), 0)::text FROM player_pokemon)                 AS shiny_pk,
      (SELECT COALESCE(MAX(id), 0)::text FROM orb_depositos)                  AS deposito,
      (SELECT COALESCE(MAX(criado_em), now())::text FROM orb_saques)          AS saque_pedido,
      (SELECT COALESCE(MAX(aprovado_em), now())::text FROM orb_saques)        AS saque_aprovado`);
  const agora = rows[0] ?? {};
  const novos = [];
  for (const feed of FEEDS) {
    const { rowCount } = await pool.query(
      `INSERT INTO radar_cursor (feed, valor) VALUES ($1, $2) ON CONFLICT (feed) DO NOTHING`,
      [feed, String(agora[feed] ?? '0')],
    );
    if (rowCount) novos.push(feed);
  }
  return novos;
}

// ---------------------------------------------------------------- as quatro consultas

/**
 * Shinies novos desde o cursor — direto de `player_pokemon`, que é onde eles nascem.
 *
 * ### Por que daqui, e não da auditoria
 *
 * A primeira versão lia `player_gameplay_log` (a linha que o `sim.mjs` escreve na captura de
 * shiny): ela já vinha com o nick e com o NOME da espécie resolvido, e evitava carregar o
 * catálogo dentro do bot. O canal, porém, passou a pedir **potência, qualidade, IV somado e
 * nota** — e nada disso está no texto da auditoria. Está tudo aqui, em colunas.
 *
 * Com o catálogo já carregado no bot (é ele que dá o nome e as bases para a nota), a auditoria
 * deixou de ter vantagem: esta tabela é a fonte da verdade, é estruturada e não depende de
 * ninguém continuar escrevendo o rótulo no mesmo formato.
 *
 * ### O índice que serve
 *
 * `idx_pp_shiny` é PARCIAL (`WHERE shiny`), então a varredura passa só pelos shinies do jogo —
 * algumas centenas de linhas na vida inteira do servidor —, e não pelas duzentas mil de
 * `player_pokemon`.
 *
 * `bonus_base` (o refino comprado com pedras) entra porque a nota o considera. Num bicho
 * recém-capturado ele é `{}`, mas ler a coluna custa nada e deixa a conta idêntica à do jogo.
 */
export async function novosShinys(cursor, limite = TETO_POR_CICLO) {
  const { rows } = await pool.query(
    `SELECT pp.id::text, pp.species_id, pp.level, pp.quality, pp.ivs, pp.potencia,
            pp.bonus_base, pp.caught_at,
            COALESCE(p.nick, '#' || pp.player_id) AS nick
       FROM player_pokemon pp
       LEFT JOIN players p ON p.id = pp.player_id
      WHERE pp.shiny AND pp.id > $1::bigint
      ORDER BY pp.id
      LIMIT $2`,
    [cursor ?? '0', limite],
  );
  return rows;
}

/** Saques PEDIDOS desde o cursor — o que a staff precisa aprovar. */
export async function novosSaques(cursor, limite = TETO_POR_CICLO) {
  const { rows } = await pool.query(
    `SELECT s.id, s.orbs::text, s.usdt::text, s.rede, s.status, s.criado_em::text AS criado_em,
            COALESCE(p.nick, '#' || s.player_id) AS nick
       FROM orb_saques s
       LEFT JOIN players p ON p.id = s.player_id
      WHERE s.criado_em > $1::timestamptz
      ORDER BY s.criado_em
      LIMIT $2`,
    [cursor, limite],
  );
  return rows;
}

/**
 * Saques APROVADOS desde o cursor.
 *
 * `aprovado_em` é carimbado por `aprovarSaque` (orbs-db.mjs), na transição `aguardando →
 * pendente`: o admin liberou e o worker vai pagar. NÃO é o dinheiro na carteira — esse é o
 * `concluido_em` do status `confirmado`. Quem escolheu foi o pedido: "quando o saque for
 * aprovado". Ver a nota em `radar.mjs` sobre o que isso significa para o canal.
 *
 * `aprovado_por` (o e-mail do admin) fica de fora da consulta de propósito: o canal é público.
 */
export async function saquesAprovados(cursor, limite = TETO_POR_CICLO) {
  const { rows } = await pool.query(
    `SELECT s.id, s.orbs::text, s.usdt::text, s.rede, s.aprovado_em::text AS aprovado_em,
            COALESCE(p.nick, '#' || s.player_id) AS nick
       FROM orb_saques s
       LEFT JOIN players p ON p.id = s.player_id
      WHERE s.aprovado_em IS NOT NULL AND s.aprovado_em > $1::timestamptz
      ORDER BY s.aprovado_em
      LIMIT $2`,
    [cursor, limite],
  );
  return rows;
}

/**
 * Depósitos desde o cursor.
 *
 * A linha de `orb_depositos` só nasce depois de a transação estar confirmada na rede (ver
 * `chain.mjs`), então todo depósito que aparece aqui é dinheiro que já entrou — não existe o
 * estado "pendente" que os saques têm.
 */
export async function novosDepositos(cursor, limite = TETO_POR_CICLO) {
  const { rows } = await pool.query(
    `SELECT d.id::text, d.orbs::text, d.usdt::text, d.rede, d.criado_em,
            COALESCE(p.nick, '#' || d.player_id) AS nick
       FROM orb_depositos d
       LEFT JOIN players p ON p.id = d.player_id
      WHERE d.id > $1::bigint
      ORDER BY d.id
      LIMIT $2`,
    [cursor ?? '0', limite],
  );
  return rows;
}
