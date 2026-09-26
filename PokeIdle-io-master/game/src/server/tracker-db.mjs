// O TRACKER — as tabelas de agregado que sustentam `pokeidle.io/tracker`.
//
// ### Por que existe uma camada agregada, e não só consultas na tabela de partidas
//
// A página responde perguntas que são varreduras: "qual espécie tem a melhor taxa de vitória",
// "contra quem este jogador mais perde", "que golpe mais causou dano na temporada". Respondê-las
// direto de `pvp_partidas` significaria abrir a ficha `JSONB` de TODA partida a cada visita — e
// a página é PÚBLICA, sem login e linkável no Discord. O primeiro post com o link seria uma
// varredura de meses de histórico por visitante.
//
// Aqui o custo é pago UMA vez, no rolo: cada partida é lida uma vez na vida e vira uma soma.
// A página lê linhas prontas, por chave primária ou por índice.
//
// ### E por que o agregado do JOGADOR não tem temporada
//
// A tabela de partidas é limpa aos 30 dias (`RETENCAO_PARTIDAS_DIAS`). Se o histórico pessoal
// do Tracker morasse só lá, o relatório de um jogador esqueceria o mês passado — e "o meu
// Tyranitar já causou 4,1 milhões de dano em 380 partidas" é justamente o número que faz a
// página valer a visita. Os agregados por jogador são de VIDA INTEIRA e sobrevivem à faxina;
// o que morre aos 30 dias é o detalhe partida a partida, que é o que ninguém relê.
//
// Os agregados GLOBAIS (o "meta") são por temporada, porque é disso que meta trata: o
// interessante é o que está forte AGORA, e uma média de todos os tempos esconderia exatamente
// a mudança que a página existe para mostrar.
//
// ### O rolo, e a corrida que ele evita
//
// `rolar()` anda por `id` crescente de `pvp_partidas`, guardando o último id lido em
// `game_meta`. Só processa linhas com mais de `ATRASO_MS` de idade, e é esta a parte que não
// é capricho: `id` vem de uma `BIGSERIAL` reservada no INÍCIO da transação, mas a linha só fica
// VISÍVEL no commit. Sem o atraso, uma partida cuja transação demorasse um pouco mais que a da
// seguinte apareceria depois do cursor já ter passado por ela — e nunca seria somada.
//
// O atraso não é uma prova, é uma margem: a transação de uma partida dura milissegundos, e um
// minuto é três ordens de grandeza acima disso. O pior caso de errar é uma partida faltando na
// média global de dano de uma temporada. Nada aqui move ponto, ouro ou prêmio — os números do
// jogo continuam saindo de `pvp_rank`, que é escrita na mesma transação da partida.
import { pool } from './db.mjs';
import { temporadaDe } from '../shared/pvp-rank.mjs';

/** A chave do cursor em `game_meta`. */
const CHAVE_CURSOR = 'tracker_cursor';

/** Idade mínima de uma partida para o rolo encostar nela. Ver o cabeçalho. */
const ATRASO_MS = 60_000;

/** Partidas por passada. O custo é uma soma em memória; o teto existe para o UPSERT em lote. */
const LOTE = 500;

export async function migrar() {
  // O DICIONÁRIO de espécies. Existe para o gateway não precisar do catálogo: `content.mjs`
  // carrega os creatures inteiros na memória do processo, e o gateway de produção é onde a
  // memória é cara (são seis deles). Quem escreve aqui é o rolo, que roda no processo de
  // simulação — lá o catálogo já está carregado de qualquer forma.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracker_pokemon (
      species_id    INT PRIMARY KEY,
      nome          TEXT NOT NULL,
      looktype      INT  NOT NULL DEFAULT 0,
      tipo1         TEXT,
      tipo2         TEXT,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  // O META por temporada. `partidas` conta a PARTIDA em que a espécie apareceu (uma vez, mesmo
  // que ela entre em campo duas), e `entradas` conta as entradas — a razão entre os dois é o
  // quanto a espécie é titular contra reserva.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracker_especie (
      temporada  TEXT NOT NULL,
      species_id INT  NOT NULL,
      partidas   INT  NOT NULL DEFAULT 0,
      vitorias   INT  NOT NULL DEFAULT 0,
      entradas   INT  NOT NULL DEFAULT 0,
      dano       BIGINT NOT NULL DEFAULT 0,
      recebido   BIGINT NOT NULL DEFAULT 0,
      abates     INT  NOT NULL DEFAULT 0,
      mortes     INT  NOT NULL DEFAULT 0,
      PRIMARY KEY (temporada, species_id)
    )`);
  // A tabela do meta é lida ORDENADA por uso dentro de uma temporada — é a primeira tela.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_tracker_especie_uso
       ON tracker_especie(temporada, partidas DESC, species_id)`);

  // OS CONFRONTOS: quantas vezes a espécie X esteve do lado oposto ao da espécie Y, e quantas
  // dessas o lado de X venceu. É daqui que sai "os seus maiores counters" — a pergunta que o
  // jogo inteiro não respondia e que manda no Mercado.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracker_confronto (
      temporada  TEXT NOT NULL,
      species_id INT  NOT NULL,
      rival_id   INT  NOT NULL,
      partidas   INT  NOT NULL DEFAULT 0,
      vitorias   INT  NOT NULL DEFAULT 0,
      PRIMARY KEY (temporada, species_id, rival_id)
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_tracker_confronto_especie
       ON tracker_confronto(temporada, species_id, partidas DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracker_golpe (
      temporada TEXT NOT NULL,
      golpe     TEXT NOT NULL,
      tipo      TEXT,
      usos      INT    NOT NULL DEFAULT 0,
      dano      BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (temporada, golpe)
    )`);

  // ---- o que é do JOGADOR, e é de vida inteira

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracker_jogador (
      player_id     BIGINT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      partidas      INT  NOT NULL DEFAULT 0,
      vitorias      INT  NOT NULL DEFAULT 0,
      dano          BIGINT NOT NULL DEFAULT 0,
      recebido      BIGINT NOT NULL DEFAULT 0,
      abates        INT  NOT NULL DEFAULT 0,
      mortes        INT  NOT NULL DEFAULT 0,
      duracao_ms    BIGINT NOT NULL DEFAULT 0,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracker_jogador_especie (
      player_id  BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      species_id INT    NOT NULL,
      partidas   INT    NOT NULL DEFAULT 0,
      vitorias   INT    NOT NULL DEFAULT 0,
      entradas   INT    NOT NULL DEFAULT 0,
      dano       BIGINT NOT NULL DEFAULT 0,
      recebido   BIGINT NOT NULL DEFAULT 0,
      abates     INT    NOT NULL DEFAULT 0,
      mortes     INT    NOT NULL DEFAULT 0,
      PRIMARY KEY (player_id, species_id)
    )`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracker_jogador_confronto (
      player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      rival_id  INT    NOT NULL,
      partidas  INT    NOT NULL DEFAULT 0,
      vitorias  INT    NOT NULL DEFAULT 0,
      PRIMARY KEY (player_id, rival_id)
    )`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracker_jogador_golpe (
      player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      golpe     TEXT   NOT NULL,
      tipo      TEXT,
      usos      INT    NOT NULL DEFAULT 0,
      dano      BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (player_id, golpe)
    )`);

  // ---- os dois índices que a PÁGINA precisa, e que ninguém mais precisava
  //
  // Os dois nasceram de um `EXPLAIN ANALYZE` com 2.000 jogadores e 20.000 partidas plantadas:
  // eram os únicos `Seq Scan` do Tracker que crescem com a base. Com aquele tamanho custavam
  // menos de 2 ms e não apareceriam em teste nenhum — mas são varreduras de tabela inteira numa
  // rota pública, ou seja, exatamente o tipo de coisa que só dói quando já é tarde.

  // "Quem mais usa esta espécie": a chave primária é (player_id, species_id), então filtrar SÓ
  // por espécie varre a tabela de todo mundo × todo pokémon que já usaram.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_tracker_jog_especie_por_especie
       ON tracker_jogador_especie(species_id, partidas DESC)`);

  // A BUSCA por prefixo (`lower(nick) LIKE 'abc%'`). O `idx_players_nick_min` que o `auth.mjs`
  // cria resolve a IGUALDADE (`lower(nick) = $1`, a ficha do jogador) e não resolve o prefixo:
  // um btree comum só serve para `LIKE 'x%'` quando o banco está numa collation C, e o nosso
  // não está. `text_pattern_ops` é o operador que faz esse índice valer para prefixo — sem ele,
  // cada TECLA digitada na busca do topo varre a tabela de jogadores inteira.
  //
  // Mora aqui, e não no `auth.mjs`, porque quem precisa dele é o Tracker: o jogo nunca procurou
  // jogador por começo de nome.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_players_nick_prefixo
       ON players (lower(nick) text_pattern_ops)`);

  await comecarOCursorNoFim();
}

/**
 * Na PRIMEIRA subida, o rolo começa no fim da tabela — e não no começo dela.
 *
 * O cursor nasceria em zero, e aí a primeira coisa que o Tracker faria num banco que já roda há
 * meses seria caminhar por TODAS as partidas antigas. Em produção são ~100 mil linhas: a 500 por
 * passada, de 30 em 30 segundos, são umas cem passadas por hora e mais de uma hora e meia até
 * ele alcançar o presente.
 *
 * E não haveria o que colher no caminho. `detalhe` é uma coluna que este mesmo deploy acrescenta:
 * TODA linha anterior a ele tem `NULL` ali, porque a ficha não existia quando aquelas partidas
 * foram jogadas. O rolo passaria uma hora e meia lendo lote por lote para não somar nada — e,
 * enquanto isso, as partidas de HOJE, que têm ficha, ficariam esperando atrás delas. A página
 * abriria vazia durante toda a primeira tarde no ar.
 *
 * Começar no `max(id)` é a leitura honesta do que existe: o histórico anterior não tem relatório,
 * e o meta começa a contar da primeira partida jogada com a versão que sabe gravá-lo.
 *
 * `ON CONFLICT DO NOTHING` é o que faz isto rodar UMA vez: dezesseis processos sobem juntos e
 * todos passam por aqui, mas só o primeiro escreve. E num banco novo (`max` nulo) o valor é 0,
 * que é exatamente onde o cursor deveria começar mesmo.
 */
async function comecarOCursorNoFim() {
  const { rowCount } = await pool.query(
    `INSERT INTO game_meta (chave, valor)
     SELECT $1, coalesce(max(id), 0)::text FROM pvp_partidas
     ON CONFLICT (chave) DO NOTHING`,
    [CHAVE_CURSOR],
  );
  if (rowCount) {
    const { rows } = await pool.query(`SELECT valor FROM game_meta WHERE chave = $1`, [CHAVE_CURSOR]);
    console.log(`[tracker] cursor começa em ${rows[0]?.valor ?? 0} (as partidas anteriores não têm ficha)`);
  }
}

// ------------------------------------------------------------------ o cursor

async function lerCursor() {
  const { rows } = await pool.query(`SELECT valor FROM game_meta WHERE chave = $1`, [CHAVE_CURSOR]);
  return Number(rows[0]?.valor) || 0;
}

async function gravarCursor(cli, id) {
  await cli.query(
    `INSERT INTO game_meta (chave, valor) VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
    [CHAVE_CURSOR, String(id)],
  );
}

// ------------------------------------------------------------------- o rolo

/**
 * O tipo de um golpe, enquanto ele for um só.
 *
 * `vistoTipo` separa "ainda não vi tipo nenhum" de "já vi dois diferentes" — sem essa marca, o
 * segundo tipo seria indistinguível do primeiro chegando num acumulador zerado.
 */
function marcarTipo(alvo, tipo) {
  if (!alvo.vistoTipo) {
    alvo.vistoTipo = true;
    alvo.tipo = tipo;
  } else if (alvo.tipo !== tipo) {
    alvo.tipo = null;
  }
}

/** Um acumulador: soma chave a chave sem precisar de um `if` em cada campo. */
function somar(mapa, chave, valores) {
  const alvo = mapa.get(chave) ?? {};
  for (const [k, v] of Object.entries(valores)) alvo[k] = (alvo[k] ?? 0) + v;
  mapa.set(chave, alvo);
  return alvo;
}

/**
 * Lê as partidas novas, soma tudo em memória e grava os agregados numa transação.
 *
 * A transação cobre os UPSERTs E o cursor: se o processo morrer no meio, ou tudo entrou e o
 * cursor andou, ou nada entrou e a próxima passada relê o mesmo lote. O que não pode acontecer
 * é o cursor andar sobre somas que não foram gravadas — aí a partida sumiria do meta para
 * sempre, sem nada indicando.
 *
 * @returns quantas partidas foram somadas nesta passada.
 */
export async function rolar({ lote = LOTE, especies = null } = {}) {
  const cursor = await lerCursor();
  const { rows } = await pool.query(
    `SELECT id, a_id, b_id, a_nick, b_nick, venceu_a, peso, duracao_ms, criado_em, detalhe
       FROM pvp_partidas
      WHERE id > $1 AND criado_em < now() - ($2::bigint * INTERVAL '1 millisecond')
      ORDER BY id
      LIMIT $3`,
    [cursor, ATRASO_MS, Math.max(1, Math.min(2000, Number(lote) || LOTE))],
  );
  if (!rows.length) return 0;

  const ultimoId = Number(rows[rows.length - 1].id);

  // As chaves são strings porque o Map precisa de igualdade por valor; o formato de cada uma
  // está no comentário do UPSERT correspondente lá embaixo.
  const especiesMeta = new Map(); // `${temporada}|${speciesId}`
  const confrontos = new Map(); // `${temporada}|${speciesId}|${rivalId}`
  const golpes = new Map(); // `${temporada}|${golpe}`
  const jogadores = new Map(); // playerId
  const jogEspecie = new Map(); // `${playerId}|${speciesId}`
  const jogConfronto = new Map(); // `${playerId}|${rivalId}`
  const jogGolpe = new Map(); // `${playerId}|${golpe}`
  const dicionario = new Map(); // speciesId → { nome, looktype }
  let somadas = 0;

  for (const r of rows) {
    const d = r.detalhe;
    // Partida sem ficha (fita cortada, versão antiga) e partida de PESO ZERO ficam de fora.
    // O peso zero é a MESMA CASA: dois jogadores do mesmo endereço podem se enfrentar, mas não
    // movem ponto — e também não podem mover o meta. Sem este corte, duas contas de uma pessoa
    // só decidiriam sozinhas qual é o pokémon mais forte do jogo.
    if (!d || d.v !== 1 || !Array.isArray(d.lados) || d.lados.length !== 2) continue;
    if (!(Number(r.peso) > 0)) continue;

    const temporada = temporadaDe(new Date(r.criado_em).getTime());
    const ids = [Number(r.a_id), Number(r.b_id)];
    const venceu = [!!r.venceu_a, !r.venceu_a];
    somadas++;

    // As espécies de cada lado, sem repetição — é o que faz uma partida contar UMA vez para a
    // espécie mesmo que ela entre em campo duas vezes (o que não acontece hoje, mas aconteceria
    // se um dia o time pudesse repetir espécie).
    const porLado = d.lados.map((l) => {
      const vistas = new Map(); // speciesId → { entradas, d, r, k, mortes, nome, lt }
      for (const pk of l.pks ?? []) {
        const e = Number(pk.e) || 0;
        if (!e) continue;
        const v = vistas.get(e) ?? { entradas: 0, dano: 0, recebido: 0, abates: 0, mortes: 0 };
        v.entradas++;
        v.dano += Number(pk.d) || 0;
        v.recebido += Number(pk.r) || 0;
        v.abates += Number(pk.k) || 0;
        v.mortes += pk.caiu ? 1 : 0;
        vistas.set(e, v);
        if (!dicionario.has(e)) dicionario.set(e, { nome: String(pk.n ?? ''), looktype: Number(pk.lt) || 0 });
      }
      return vistas;
    });

    for (let g = 0; g < 2; g++) {
      const l = d.lados[g];
      const meu = porLado[g];
      const dele = porLado[1 - g];
      const venci = venceu[g] ? 1 : 0;
      const pid = ids[g];

      somar(jogadores, pid, {
        partidas: 1,
        vitorias: venci,
        dano: Number(l.d) || 0,
        recebido: Number(l.r) || 0,
        abates: Number(l.k) || 0,
        mortes: Number(l.mo) || 0,
        duracao: Number(r.duracao_ms) || 0,
      });

      for (const [e, v] of meu) {
        const linha = {
          partidas: 1, vitorias: venci, entradas: v.entradas,
          dano: v.dano, recebido: v.recebido, abates: v.abates, mortes: v.mortes,
        };
        somar(especiesMeta, `${temporada}|${e}`, linha);
        somar(jogEspecie, `${pid}|${e}`, linha);
        // O confronto é o PRODUTO CARTESIANO dos dois lados: cada espécie minha contra cada
        // espécie dele. Com times de cinco são 25 pares por partida — barato, e é a única
        // forma de a pergunta "quem me counterou" ter resposta sem simular de novo.
        for (const rival of dele.keys()) {
          somar(confrontos, `${temporada}|${e}|${rival}`, { partidas: 1, vitorias: venci });
        }
      }
      // O confronto do JOGADOR é contra a espécie adversária, não par a par: a pergunta dele é
      // "contra que bicho eu perco", e não "qual dos meus perde para qual dos dele".
      for (const rival of dele.keys()) {
        somar(jogConfronto, `${pid}|${rival}`, { partidas: 1, vitorias: venci });
      }

      for (const gp of l.golpes ?? []) {
        const nome = String(gp.n ?? '').slice(0, 64);
        if (!nome) continue;
        const soma = { usos: Number(gp.u) || 0, dano: Number(gp.d) || 0 };
        // O TIPO só sobrevive enquanto for sempre o mesmo. O ataque básico ("Investida") sai
        // com o tipo de QUEM bateu, então somá-lo por nome e guardar o último tipo visto daria
        // uma linha dizendo "Investida · WATER" para seis mil golpes que foram de dezoito
        // tipos diferentes — um selo inventado em cima de um número certo. Divergiu, o tipo
        // vira `null` e a tela simplesmente não desenha selo nenhum.
        marcarTipo(somar(golpes, `${temporada}|${nome}`, soma), gp.t ?? null);
        marcarTipo(somar(jogGolpe, `${pid}|${nome}`, soma), gp.t ?? null);
      }
    }
  }

  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    await gravarDicionario(cli, dicionario, especies);
    await gravarEspecies(cli, especiesMeta);
    await gravarConfrontos(cli, confrontos);
    await gravarGolpes(cli, golpes);
    await gravarJogadores(cli, jogadores);
    await gravarJogadorEspecie(cli, jogEspecie);
    await gravarJogadorConfronto(cli, jogConfronto);
    await gravarJogadorGolpe(cli, jogGolpe);
    await gravarCursor(cli, ultimoId);
    await cli.query('COMMIT');
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
  return somadas;
}

// ------------------------------------------------------------------ escrita
//
// Todo UPSERT abaixo é um `unnest` de arrays: uma ida ao banco por tabela, não uma por linha.
// Com 500 partidas no lote, a diferença é entre 8 consultas e algumas dezenas de milhares.

const colunas = (mapa, campos) => {
  const saida = campos.map(() => []);
  for (const [chave, v] of mapa) {
    const partes = String(chave).split('|');
    campos.forEach((c, i) => {
      saida[i].push(typeof c === 'function' ? c(v, partes, chave) : (v[c] ?? 0));
    });
  }
  return saida;
};

async function gravarDicionario(cli, dicionario, especies) {
  if (!dicionario.size) return;
  const ids = [];
  const nomes = [];
  const lts = [];
  const t1 = [];
  const t2 = [];
  for (const [id, v] of dicionario) {
    // O catálogo é a fonte melhor (nome canônico e os dois tipos); a ficha é o plano B, e é o
    // que faz isto funcionar no processo que não carrega `content.mjs`.
    const esp = especies?.get?.(id) ?? null;
    ids.push(id);
    nomes.push(String(esp?.name ?? v.nome ?? '').slice(0, 64) || `#${id}`);
    lts.push(Number(esp?.looktype ?? v.looktype) || 0);
    t1.push(esp?.type1 ?? null);
    t2.push(esp?.type2 ?? null);
  }
  await cli.query(
    `INSERT INTO tracker_pokemon (species_id, nome, looktype, tipo1, tipo2)
     SELECT * FROM unnest($1::int[], $2::text[], $3::int[], $4::text[], $5::text[])
     ON CONFLICT (species_id) DO UPDATE SET
       nome = EXCLUDED.nome, looktype = EXCLUDED.looktype,
       -- O tipo só é sobrescrito por quem TEM tipo: uma passada rodada sem catálogo não pode
       -- apagar o que uma passada com catálogo já tinha gravado.
       tipo1 = COALESCE(EXCLUDED.tipo1, tracker_pokemon.tipo1),
       tipo2 = COALESCE(EXCLUDED.tipo2, tracker_pokemon.tipo2),
       atualizado_em = now()`,
    [ids, nomes, lts, t1, t2],
  );
}

async function gravarEspecies(cli, mapa) {
  if (!mapa.size) return;
  const [temp, esp, pa, vi, en, da, re, ab, mo] = colunas(mapa, [
    (_v, p) => p[0], (_v, p) => Number(p[1]),
    'partidas', 'vitorias', 'entradas', 'dano', 'recebido', 'abates', 'mortes',
  ]);
  await cli.query(
    `INSERT INTO tracker_especie
       (temporada, species_id, partidas, vitorias, entradas, dano, recebido, abates, mortes)
     SELECT * FROM unnest($1::text[], $2::int[], $3::int[], $4::int[], $5::int[],
                          $6::bigint[], $7::bigint[], $8::int[], $9::int[])
     ON CONFLICT (temporada, species_id) DO UPDATE SET
       partidas = tracker_especie.partidas + EXCLUDED.partidas,
       vitorias = tracker_especie.vitorias + EXCLUDED.vitorias,
       entradas = tracker_especie.entradas + EXCLUDED.entradas,
       dano     = tracker_especie.dano     + EXCLUDED.dano,
       recebido = tracker_especie.recebido + EXCLUDED.recebido,
       abates   = tracker_especie.abates   + EXCLUDED.abates,
       mortes   = tracker_especie.mortes   + EXCLUDED.mortes`,
    [temp, esp, pa, vi, en, da, re, ab, mo],
  );
}

async function gravarConfrontos(cli, mapa) {
  if (!mapa.size) return;
  const [temp, esp, riv, pa, vi] = colunas(mapa, [
    (_v, p) => p[0], (_v, p) => Number(p[1]), (_v, p) => Number(p[2]), 'partidas', 'vitorias',
  ]);
  await cli.query(
    `INSERT INTO tracker_confronto (temporada, species_id, rival_id, partidas, vitorias)
     SELECT * FROM unnest($1::text[], $2::int[], $3::int[], $4::int[], $5::int[])
     ON CONFLICT (temporada, species_id, rival_id) DO UPDATE SET
       partidas = tracker_confronto.partidas + EXCLUDED.partidas,
       vitorias = tracker_confronto.vitorias + EXCLUDED.vitorias`,
    [temp, esp, riv, pa, vi],
  );
}

async function gravarGolpes(cli, mapa) {
  if (!mapa.size) return;
  // O nome do golpe pode ter `|`? Não tem hoje, e se um dia tiver o `split` o quebraria em
  // duas partes. Por isso a chave é reconstruída pelo RESTO das partes, e não por `p[1]`.
  const [temp, nome, tipo, us, da] = colunas(mapa, [
    (_v, p) => p[0], (_v, p) => p.slice(1).join('|'), (v) => v.tipo ?? null, 'usos', 'dano',
  ]);
  await cli.query(
    `INSERT INTO tracker_golpe (temporada, golpe, tipo, usos, dano)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::bigint[])
     ON CONFLICT (temporada, golpe) DO UPDATE SET
       -- A mesma regra do marcarTipo(), agora ENTRE lotes: tipo diferente do que já estava
       -- apaga o selo. IS DISTINCT FROM trata o NULL como valor, então uma vez apagado ele
       -- não volta — que é o certo: o golpe já provou não ter um tipo só.
       tipo = CASE WHEN tracker_golpe.tipo IS DISTINCT FROM EXCLUDED.tipo
                   THEN NULL ELSE EXCLUDED.tipo END,
       usos = tracker_golpe.usos + EXCLUDED.usos,
       dano = tracker_golpe.dano + EXCLUDED.dano`,
    [temp, nome, tipo, us, da],
  );
}

async function gravarJogadores(cli, mapa) {
  if (!mapa.size) return;
  const ids = [...mapa.keys()];
  const v = [...mapa.values()];
  await cli.query(
    `INSERT INTO tracker_jogador
       (player_id, partidas, vitorias, dano, recebido, abates, mortes, duracao_ms)
     SELECT u.* FROM unnest($1::bigint[], $2::int[], $3::int[], $4::bigint[], $5::bigint[],
                            $6::int[], $7::int[], $8::bigint[])
       AS u(player_id, partidas, vitorias, dano, recebido, abates, mortes, duracao_ms)
      WHERE EXISTS (SELECT 1 FROM players p WHERE p.id = u.player_id)
     ON CONFLICT (player_id) DO UPDATE SET
       partidas   = tracker_jogador.partidas   + EXCLUDED.partidas,
       vitorias   = tracker_jogador.vitorias   + EXCLUDED.vitorias,
       dano       = tracker_jogador.dano       + EXCLUDED.dano,
       recebido   = tracker_jogador.recebido   + EXCLUDED.recebido,
       abates     = tracker_jogador.abates     + EXCLUDED.abates,
       mortes     = tracker_jogador.mortes     + EXCLUDED.mortes,
       duracao_ms = tracker_jogador.duracao_ms + EXCLUDED.duracao_ms,
       atualizado_em = now()`,
    [ids, v.map((x) => x.partidas), v.map((x) => x.vitorias), v.map((x) => x.dano),
     v.map((x) => x.recebido), v.map((x) => x.abates), v.map((x) => x.mortes),
     v.map((x) => x.duracao)],
  );
}

async function gravarJogadorEspecie(cli, mapa) {
  if (!mapa.size) return;
  const [pid, esp, pa, vi, en, da, re, ab, mo] = colunas(mapa, [
    (_v, p) => Number(p[0]), (_v, p) => Number(p[1]),
    'partidas', 'vitorias', 'entradas', 'dano', 'recebido', 'abates', 'mortes',
  ]);
  await cli.query(
    `INSERT INTO tracker_jogador_especie
       (player_id, species_id, partidas, vitorias, entradas, dano, recebido, abates, mortes)
     SELECT u.* FROM unnest($1::bigint[], $2::int[], $3::int[], $4::int[], $5::int[],
                            $6::bigint[], $7::bigint[], $8::int[], $9::int[])
       AS u(player_id, species_id, partidas, vitorias, entradas, dano, recebido, abates, mortes)
      WHERE EXISTS (SELECT 1 FROM players p WHERE p.id = u.player_id)
     ON CONFLICT (player_id, species_id) DO UPDATE SET
       partidas = tracker_jogador_especie.partidas + EXCLUDED.partidas,
       vitorias = tracker_jogador_especie.vitorias + EXCLUDED.vitorias,
       entradas = tracker_jogador_especie.entradas + EXCLUDED.entradas,
       dano     = tracker_jogador_especie.dano     + EXCLUDED.dano,
       recebido = tracker_jogador_especie.recebido + EXCLUDED.recebido,
       abates   = tracker_jogador_especie.abates   + EXCLUDED.abates,
       mortes   = tracker_jogador_especie.mortes   + EXCLUDED.mortes`,
    [pid, esp, pa, vi, en, da, re, ab, mo],
  );
}

async function gravarJogadorConfronto(cli, mapa) {
  if (!mapa.size) return;
  const [pid, riv, pa, vi] = colunas(mapa, [
    (_v, p) => Number(p[0]), (_v, p) => Number(p[1]), 'partidas', 'vitorias',
  ]);
  await cli.query(
    `INSERT INTO tracker_jogador_confronto (player_id, rival_id, partidas, vitorias)
     SELECT u.* FROM unnest($1::bigint[], $2::int[], $3::int[], $4::int[])
       AS u(player_id, rival_id, partidas, vitorias)
      WHERE EXISTS (SELECT 1 FROM players p WHERE p.id = u.player_id)
     ON CONFLICT (player_id, rival_id) DO UPDATE SET
       partidas = tracker_jogador_confronto.partidas + EXCLUDED.partidas,
       vitorias = tracker_jogador_confronto.vitorias + EXCLUDED.vitorias`,
    [pid, riv, pa, vi],
  );
}

async function gravarJogadorGolpe(cli, mapa) {
  if (!mapa.size) return;
  const [pid, nome, tipo, us, da] = colunas(mapa, [
    (_v, p) => Number(p[0]), (_v, p) => p.slice(1).join('|'), (v) => v.tipo ?? null, 'usos', 'dano',
  ]);
  await cli.query(
    `INSERT INTO tracker_jogador_golpe (player_id, golpe, tipo, usos, dano)
     SELECT u.* FROM unnest($1::bigint[], $2::text[], $3::text[], $4::int[], $5::bigint[])
       AS u(player_id, golpe, tipo, usos, dano)
      WHERE EXISTS (SELECT 1 FROM players p WHERE p.id = u.player_id)
     ON CONFLICT (player_id, golpe) DO UPDATE SET
       tipo = CASE WHEN tracker_jogador_golpe.tipo IS DISTINCT FROM EXCLUDED.tipo
                   THEN NULL ELSE EXCLUDED.tipo END,
       usos = tracker_jogador_golpe.usos + EXCLUDED.usos,
       dano = tracker_jogador_golpe.dano + EXCLUDED.dano`,
    [pid, nome, tipo, us, da],
  );
}

/** A temporada corrente, para quem monta a tela sem querer importar a régua do PvP. */
export const temporadaAtual = () => temporadaDe(Date.now());
