// AS CONSULTAS DO TRACKER — tudo que a página `/tracker` mostra sai daqui.
//
// Separado de `tracker-db.mjs` (que ESCREVE, no processo de simulação) e de `tracker-rotas.mjs`
// (que serve HTTP) porque são três responsabilidades com três riscos diferentes: o rolo não
// pode errar a soma, a rota não pode confiar no que chega da internet, e aqui não pode vazar
// nada que a página não devesse mostrar.
//
// ### A regra de privacidade deste arquivo
//
// A página é PÚBLICA: sem login, indexável, linkável no Discord. Então o que ela mostra tem de
// ser exatamente o que o jogo já mostra a qualquer jogador — nick, nível, emblema de PvP,
// equipe que entrou numa partida, resultado. Nada aqui consulta `accounts`, e-mail, IP,
// pagamento, ouro, gema, inventário ou qualquer coluna de `players` fora das quatro de
// vitrine. Um `SELECT *` neste arquivo é um bug de privacidade esperando acontecer, e é por
// isso que toda consulta lista as colunas.
//
// O `ultima_em` de `pvp_rank` é o caso limite: ele diz A QUE HORAS a pessoa jogou pela última
// vez, e o próprio jogo já esconde isso da ficha pública (ver `comPrazo` em `rankParaCliente`).
// Aqui ele nunca sai da borda — entra só na conta do decaimento.
//
// ### Por que quase tudo tem `LIMIT` escrito e travado
//
// A página inteira é um alvo de raspagem, e a única defesa que não depende de adivinhar a
// intenção de quem chama é o teto: nenhuma consulta daqui pode devolver uma lista sem tamanho
// máximo, nem varrer a tabela por um parâmetro que veio de fora. Os tetos são aplicados nesta
// camada, e não na rota, porque quem escrever a segunda rota amanhã vai reusar estas funções.
// O POOL É O DO TRACKER, não o do jogo — ver `tracker-pool.mjs`. Trocar este import de volta
// para `db.mjs` devolve à página pública o poder de esgotar as conexões da simulação.
import { poolTracker as pool } from './tracker-pool.mjs';
import { analiseGuildWar } from './game/guild-pvp.mjs';
import {
  PVP_PARTIDAS_POSICIONAMENTO,
  rankComVaga,
  temporadaDe,
  vagaDecaiu,
} from '../shared/pvp-rank.mjs';

/** Quantas partidas uma espécie precisa ter para entrar nas tabelas ordenadas por taxa. */
export const MIN_PARTIDAS_META = 8;

/** Quantas partidas um confronto precisa ter para ser chamado de counter. */
const MIN_PARTIDAS_CONFRONTO = 4;

/** O teto absoluto de linhas de qualquer lista pública. */
const TETO_LISTA = 100;

/** Quantos nicks o prefixo colhe antes de o rank entrar na conta. Ver `buscar`. */
const CANDIDATOS_BUSCA = 50;

const inteiro = (v, padrao, min, max) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : padrao;
};

/**
 * Uma temporada VÁLIDA, ou a atual.
 *
 * O formato é conferido contra a régua (`temporadaDe` de uma data é sempre uma segunda-feira),
 * e não só contra a expressão regular: `2026-09-23` casa com `YYYY-MM-DD` e não é temporada
 * nenhuma. Sem isso a tela aceitaria um endereço que devolve sempre lista vazia — e cada um
 * deles seria uma chave de cache diferente.
 */
export function temporadaValida(bruta) {
  const s = String(bruta ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return temporadaDe(Date.now());
  const ms = Date.parse(`${s}T12:00:00Z`);
  if (!Number.isFinite(ms)) return temporadaDe(Date.now());
  const normal = temporadaDe(ms);
  return normal === s ? s : temporadaDe(Date.now());
}

/**
 * O nick, limpo, ou `null`.
 *
 * A regra é a MESMA do cadastro (letras, números e `_`, 3 a 20), e é conferida aqui e não só na
 * rota: é o que garante que nada além disso chegue perto de um `lower(nick) = $1`. A comparação
 * é por `lower()` porque é assim que o jogo roteia o jogador (ver a nota de troca de nome em
 * `pvp-ranqueado.mjs`) — buscar "Befoin" e "befoin" tem de achar a mesma pessoa.
 */
export function nickValido(bruto) {
  const s = String(bruto ?? '').trim();
  return /^[A-Za-z0-9_]{3,20}$/.test(s) ? s : null;
}

// ------------------------------------------------------------------ o meta

/** As colunas derivadas que toda linha de espécie leva. Uma conta só, num lugar só. */
const comTaxas = (r) => {
  const partidas = Number(r.partidas) || 0;
  const entradas = Number(r.entradas) || 0;
  return {
    id: Number(r.species_id),
    nome: r.nome ?? `#${r.species_id}`,
    looktype: Number(r.looktype) || 0,
    tipos: [r.tipo1, r.tipo2].filter(Boolean),
    partidas,
    vitorias: Number(r.vitorias) || 0,
    winrate: partidas ? (Number(r.vitorias) || 0) / partidas : 0,
    entradas,
    dano: Number(r.dano) || 0,
    recebido: Number(r.recebido) || 0,
    abates: Number(r.abates) || 0,
    mortes: Number(r.mortes) || 0,
    // Por ENTRADA em campo, não por partida: é o número que compara um titular com um reserva
    // que só entra quando o time já está apanhando.
    danoPorEntrada: entradas ? Math.round((Number(r.dano) || 0) / entradas) : 0,
    recebidoPorEntrada: entradas ? Math.round((Number(r.recebido) || 0) / entradas) : 0,
    abatesPorEntrada: entradas ? (Number(r.abates) || 0) / entradas : 0,
    // Quantas vezes ele saiu de campo carregado. É o "quem tanka" visto pelo avesso.
    sobrevivencia: entradas ? 1 - (Number(r.mortes) || 0) / entradas : 0,
  };
};

/** As ordenações que a tabela do meta oferece. Lista fechada — o cliente manda a CHAVE. */
const ORDENS_META = {
  uso: 'partidas DESC, e.species_id',
  winrate: 'CASE WHEN partidas > 0 THEN vitorias::float / partidas ELSE 0 END DESC, partidas DESC',
  dano: 'CASE WHEN entradas > 0 THEN dano::float / entradas ELSE 0 END DESC, partidas DESC',
  abates: 'CASE WHEN entradas > 0 THEN abates::float / entradas ELSE 0 END DESC, partidas DESC',
  tanque: 'CASE WHEN entradas > 0 THEN recebido::float / entradas ELSE 0 END DESC, partidas DESC',
};

/**
 * A TABELA DO META: as espécies de uma temporada, ordenadas pelo critério pedido.
 *
 * `ordem` é uma CHAVE de `ORDENS_META`, nunca um pedaço de SQL: a cláusula sai de um objeto
 * escrito aqui. É a única forma segura de ter `ORDER BY` variável — parâmetro de consulta não
 * serve para nome de coluna, e interpolar o que veio da URL seria injeção de manual.
 */
export async function meta({ temporada, ordem = 'uso', limite = 40, pagina = 0, minimo = null } = {}) {
  const t = temporadaValida(temporada);
  const clausula = ORDENS_META[ordem] ?? ORDENS_META.uso;
  const n = inteiro(limite, 40, 1, TETO_LISTA);
  const salto = inteiro(pagina, 0, 0, 200) * n;
  // Ordenar por TAXA sem piso de amostra é como a tabela mente: um pokémon com uma partida e
  // uma vitória lidera "melhor winrate" para sempre. Por USO o piso não faz falta — lá o
  // número pequeno já se coloca no fim sozinho.
  const piso = minimo != null
    ? inteiro(minimo, MIN_PARTIDAS_META, 0, 10_000)
    : (ordem === 'uso' ? 1 : MIN_PARTIDAS_META);

  const { rows } = await pool.query(
    `SELECT e.species_id, e.partidas, e.vitorias, e.entradas, e.dano, e.recebido,
            e.abates, e.mortes, p.nome, p.looktype, p.tipo1, p.tipo2
       FROM tracker_especie e
       LEFT JOIN tracker_pokemon p ON p.species_id = e.species_id
      WHERE e.temporada = $1 AND e.partidas >= $2
      ORDER BY ${clausula}
      LIMIT $3 OFFSET $4`,
    [t, piso, n, salto],
  );
  const { rows: cont } = await pool.query(
    `SELECT count(*)::int AS n, coalesce(sum(partidas), 0)::bigint AS amostra
       FROM tracker_especie WHERE temporada = $1 AND partidas >= $2`,
    [t, piso],
  );
  return {
    temporada: t,
    ordem: ORDENS_META[ordem] ? ordem : 'uso',
    pagina: inteiro(pagina, 0, 0, 200),
    porPagina: n,
    total: cont[0]?.n ?? 0,
    // A soma de aparições da temporada. É o denominador do "presente em X% dos times".
    amostra: Number(cont[0]?.amostra) || 0,
    minimo: piso,
    linhas: rows.map(comTaxas),
  };
}

/** As temporadas que já têm dado, da mais nova para a mais velha. Alimenta o seletor da tela. */
export async function temporadas(limite = 12) {
  const { rows } = await pool.query(
    `SELECT temporada, count(*)::int AS especies, coalesce(sum(partidas), 0)::bigint AS amostra
       FROM tracker_especie GROUP BY temporada ORDER BY temporada DESC LIMIT $1`,
    [inteiro(limite, 12, 1, 60)],
  );
  return rows.map((r) => ({
    temporada: r.temporada,
    especies: Number(r.especies) || 0,
    amostra: Number(r.amostra) || 0,
  }));
}

/**
 * A ficha de UMA espécie: os números dela, quem a counterou e quem ela counterou.
 *
 * Os dois lados do confronto saem da MESMA tabela lida duas vezes com ordens opostas, e não de
 * uma consulta só cortada no cliente: pedir a lista inteira para mostrar cinco de cada ponta
 * seria trazer todas as espécies do jogo por visita.
 */
export async function especie({ speciesId, temporada } = {}) {
  const id = inteiro(speciesId, 0, 1, 99_999);
  if (!id) return null;
  const t = temporadaValida(temporada);

  const { rows: base } = await pool.query(
    `SELECT e.species_id, e.partidas, e.vitorias, e.entradas, e.dano, e.recebido,
            e.abates, e.mortes, p.nome, p.looktype, p.tipo1, p.tipo2
       FROM tracker_especie e
       LEFT JOIN tracker_pokemon p ON p.species_id = e.species_id
      WHERE e.temporada = $1 AND e.species_id = $2`,
    [t, id],
  );
  if (!base.length) {
    // Sem linha na temporada pedida, a espécie ainda pode existir no dicionário — e aí a tela
    // mostra a ficha vazia com o nome certo em vez de um 404 para um pokémon que existe.
    const { rows } = await pool.query(
      `SELECT species_id, nome, looktype, tipo1, tipo2 FROM tracker_pokemon WHERE species_id = $1`,
      [id],
    );
    if (!rows.length) return null;
    return {
      temporada: t,
      pokemon: comTaxas({ ...rows[0], partidas: 0, vitorias: 0, entradas: 0, dano: 0, recebido: 0, abates: 0, mortes: 0 }),
      counters: [], vitimas: [], jogadores: [],
    };
  }

  const confrontos = async (crescente) => {
    const { rows } = await pool.query(
      `SELECT c.rival_id, c.partidas, c.vitorias, p.nome, p.looktype, p.tipo1, p.tipo2
         FROM tracker_confronto c
         LEFT JOIN tracker_pokemon p ON p.species_id = c.rival_id
        WHERE c.temporada = $1 AND c.species_id = $2 AND c.partidas >= $3
        ORDER BY (c.vitorias::float / c.partidas) ${crescente ? 'ASC' : 'DESC'}, c.partidas DESC
        LIMIT 8`,
      [t, id, MIN_PARTIDAS_CONFRONTO],
    );
    return rows.map((r) => ({
      id: Number(r.rival_id),
      nome: r.nome ?? `#${r.rival_id}`,
      looktype: Number(r.looktype) || 0,
      tipos: [r.tipo1, r.tipo2].filter(Boolean),
      partidas: Number(r.partidas) || 0,
      vitorias: Number(r.vitorias) || 0,
      winrate: r.partidas ? Number(r.vitorias) / Number(r.partidas) : 0,
    }));
  };

  // Quem mais usa a espécie. É de VIDA INTEIRA (a tabela do jogador não tem temporada) e a
  // tela diz isso — misturar as duas escalas sem avisar seria o tipo de número que parece
  // errado e não é.
  const { rows: donos } = await pool.query(
    `SELECT je.player_id, je.partidas, je.vitorias, je.dano, je.abates, pl.nick
       FROM tracker_jogador_especie je
       JOIN players pl ON pl.id = je.player_id
      WHERE je.species_id = $1 AND je.partidas >= $2
      ORDER BY je.partidas DESC, je.dano DESC
      LIMIT 10`,
    [id, MIN_PARTIDAS_CONFRONTO],
  );

  const [counters, vitimas] = await Promise.all([confrontos(true), confrontos(false)]);
  return {
    temporada: t,
    pokemon: comTaxas(base[0]),
    counters,
    vitimas,
    jogadores: donos.map((r) => ({
      nick: r.nick,
      partidas: Number(r.partidas) || 0,
      vitorias: Number(r.vitorias) || 0,
      winrate: r.partidas ? Number(r.vitorias) / Number(r.partidas) : 0,
      dano: Number(r.dano) || 0,
      abates: Number(r.abates) || 0,
    })),
  };
}

/** Os golpes da temporada, por dano. */
export async function golpes({ temporada, limite = 20 } = {}) {
  const t = temporadaValida(temporada);
  const { rows } = await pool.query(
    `SELECT golpe, tipo, usos, dano FROM tracker_golpe
      WHERE temporada = $1 ORDER BY dano DESC, usos DESC LIMIT $2`,
    [t, inteiro(limite, 20, 1, 50)],
  );
  return rows.map((r) => ({
    nome: r.golpe,
    tipo: r.tipo ?? null,
    usos: Number(r.usos) || 0,
    dano: Number(r.dano) || 0,
    medio: r.usos ? Math.round(Number(r.dano) / Number(r.usos)) : 0,
  }));
}

// --------------------------------------------------------------- a ladder

/** O emblema de uma linha de rank — a MESMA régua da tela do jogo, para os dois concordarem. */
const emblema = (linha, posicao) => {
  const pos = linha.partidas >= PVP_PARTIDAS_POSICIONAMENTO ? (posicao ?? 0) : 0;
  const r = rankComVaga(linha.pontos, pos, { inativo: vagaDecaiu(linha.ultimaEm) });
  return { tierId: r.tierId, rotulo: r.rotulo ?? r.tierId, posicao: pos || null };
};

/**
 * Quantos jogadores estão classificados — com cache de cinco minutos.
 *
 * É a única consulta do Tracker que cresce com a base e NÃO tem índice que a resolva: um
 * `count(*)` com filtro varre `pvp_rank` inteira. Ela aparece em duas telas (o topo da inicial e
 * o rodapé do ranking) e em toda página do ranking, então sem cache ela seria a varredura mais
 * frequente do sistema — para produzir um número que muda quando alguém termina o
 * posicionamento, ou seja, raramente.
 *
 * Cinco minutos de atraso num "87 classificados" não é erro que alguém perceba; uma varredura
 * por visita, com cem mil linhas, é.
 */
const CACHE_CLASSIFICADOS_MS = 5 * 60_000;
let classificadosCache = { em: 0, n: 0, promessa: null };

async function classificados() {
  const agora = Date.now();
  if (classificadosCache.promessa) return classificadosCache.promessa;
  if (agora - classificadosCache.em < CACHE_CLASSIFICADOS_MS) return classificadosCache.n;
  classificadosCache.promessa = pool
    .query(`SELECT count(*)::int AS n FROM pvp_rank WHERE partidas >= $1`, [PVP_PARTIDAS_POSICIONAMENTO])
    .then(({ rows }) => {
      classificadosCache = { em: Date.now(), n: rows[0]?.n ?? 0, promessa: null };
      return classificadosCache.n;
    })
    .catch((err) => {
      classificadosCache.promessa = null;
      // O número velho serve: uma contagem de cinco minutos atrás é melhor do que a tela sem
      // ela, e o erro de verdade já vai aparecer na consulta que importa.
      console.warn('[tracker] contagem de classificados falhou:', err.message);
      return classificadosCache.n;
    });
  return classificadosCache.promessa;
}

export async function ladder({ limite = 50, pagina = 0 } = {}) {
  const n = inteiro(limite, 50, 1, TETO_LISTA);
  const salto = inteiro(pagina, 0, 0, 200) * n;
  const { rows } = await pool.query(
    `SELECT r.player_id, r.pontos, r.pico, r.vitorias, r.derrotas, r.partidas, r.sequencia,
            r.ultima_em, p.nick, p.level AS nivel, p.looktype
       FROM pvp_rank r JOIN players p ON p.id = r.player_id
      WHERE r.partidas >= $1
      ORDER BY r.pontos DESC, r.vitorias DESC, r.player_id ASC
      LIMIT $2 OFFSET $3`,
    [PVP_PARTIDAS_POSICIONAMENTO, n, salto],
  );
  return {
    pagina: inteiro(pagina, 0, 0, 200),
    porPagina: n,
    total: await classificados(),
    linhas: rows.map((r, i) => {
      const linha = {
        pontos: Number(r.pontos) || 0,
        partidas: Number(r.partidas) || 0,
        ultimaEm: r.ultima_em,
      };
      const pos = salto + i + 1;
      return {
        posicao: pos,
        nick: r.nick,
        nivel: Number(r.nivel) || 1,
        looktype: Number(r.looktype) || 0,
        pontos: linha.pontos,
        pico: Number(r.pico) || 0,
        vitorias: Number(r.vitorias) || 0,
        derrotas: Number(r.derrotas) || 0,
        partidas: linha.partidas,
        sequencia: Number(r.sequencia) || 0,
        winrate: linha.partidas ? (Number(r.vitorias) || 0) / linha.partidas : 0,
        ...emblema(linha, pos),
      };
    }),
  };
}

/** A busca de nick da barra do topo. Prefixo, e nunca a tabela inteira. */
export async function buscar(q, limite = 8) {
  const termo = String(q ?? '').trim();
  // Duas letras é o piso: com uma, "a" devolveria meia base e a consulta viraria um teste de
  // carga grátis para quem digitasse depressa.
  if (termo.length < 2 || !/^[A-Za-z0-9_]{2,20}$/.test(termo)) return [];
  // DUAS ETAPAS, e a ordem delas é o ponto.
  //
  // A primeira colhe até `CANDIDATOS_BUSCA` nicks pelo PREFIXO, e só isso — é a etapa que o
  // índice `idx_players_nick_prefixo` resolve (um btree comum não serve para `LIKE 'x%'` fora
  // da collation C; o `text_pattern_ops` é o que faz ele servir).
  //
  // A segunda junta o rank SÓ desses. Era uma consulta só, com o `LEFT JOIN pvp_rank` antes do
  // corte: para devolver oito linhas, o banco montava a tabela de rank de TODO MUNDO e ordenava
  // — a cada tecla digitada, numa rota pública. Com cinquenta candidatos, o join vira cinquenta
  // buscas por chave primária.
  //
  // O preço: com mais de cinquenta nicks começando pelo mesmo prefixo, quem entra na lista é
  // decidido em ordem alfabética antes de o PR ser consultado. Para um campo de sugestão de
  // oito linhas é o comportamento esperado — quem procura alguém digita mais uma letra.
  const { rows } = await pool.query(
    `WITH achados AS (
       SELECT id, nick, level AS nivel, looktype
         FROM players
        WHERE lower(nick) LIKE lower($1) || '%'
        ORDER BY lower(nick)
        LIMIT ${CANDIDATOS_BUSCA}
     )
     SELECT a.nick, a.nivel, a.looktype, r.pontos, r.partidas
       FROM achados a
       LEFT JOIN pvp_rank r ON r.player_id = a.id
      ORDER BY (r.partidas IS NULL), r.pontos DESC NULLS LAST, length(a.nick), lower(a.nick)
      LIMIT $2`,
    [termo, inteiro(limite, 8, 1, 20)],
  );
  return rows.map((r) => ({
    nick: r.nick,
    nivel: Number(r.nivel) || 1,
    looktype: Number(r.looktype) || 0,
    pontos: r.pontos == null ? null : Number(r.pontos),
    partidas: Number(r.partidas) || 0,
  }));
}

// -------------------------------------------------------------- o jogador

/** Quantas partidas o histórico do Tracker mostra. Vinte é o pedido, e é o teto. */
export const HISTORICO_PARTIDAS = 20;

/**
 * A FICHA COMPLETA DE UM JOGADOR — o coração da página.
 *
 * Sete consultas, todas por índice, todas com teto. Elas vão juntas num `Promise.all` porque
 * são independentes: em série, a ficha custaria sete idas ao banco enfileiradas.
 */
export async function jogador(nickBruto) {
  const nick = nickValido(nickBruto);
  if (!nick) return null;

  const { rows: quem } = await pool.query(
    // As colunas de vitrine, e só elas. Ver a nota de privacidade no topo do arquivo.
    //
    // A data de criação sai em MÊS, e não em dia e hora, e isso é de propósito. O jogo não a
    // mostra em lugar nenhum, então ela já é informação que a página acrescenta; publicá-la com
    // precisão de segundo entregaria de graça o sinal mais usado para casar contas alternativas
    // ("estas seis contas nasceram no mesmo minuto"). Em mês, o "joga desde agosto/2026" continua
    // dizendo o que interessa a quem lê um perfil e não diz nada a quem está cruzando dados.
    `SELECT id, nick, level AS nivel, looktype, to_char(created_at, 'YYYY-MM') AS desde
       FROM players WHERE lower(nick) = lower($1)`,
    [nick],
  );
  if (!quem.length) return null;
  const id = Number(quem[0].id);

  const [rank, totais, pokemons, confrontos, gol, partidas, guild] = await Promise.all([
    pool.query(
      `SELECT pontos, pico, vitorias, derrotas, partidas, sequencia, ultima_em
         FROM pvp_rank WHERE player_id = $1`,
      [id],
    ),
    pool.query(
      `SELECT partidas, vitorias, dano, recebido, abates, mortes, duracao_ms
         FROM tracker_jogador WHERE player_id = $1`,
      [id],
    ),
    pool.query(
      `SELECT je.species_id, je.partidas, je.vitorias, je.entradas, je.dano, je.recebido,
              je.abates, je.mortes, p.nome, p.looktype, p.tipo1, p.tipo2
         FROM tracker_jogador_especie je
         LEFT JOIN tracker_pokemon p ON p.species_id = je.species_id
        WHERE je.player_id = $1
        ORDER BY je.partidas DESC, je.dano DESC
        LIMIT 24`,
      [id],
    ),
    pool.query(
      `SELECT jc.rival_id, jc.partidas, jc.vitorias, p.nome, p.looktype, p.tipo1, p.tipo2
         FROM tracker_jogador_confronto jc
         LEFT JOIN tracker_pokemon p ON p.species_id = jc.rival_id
        WHERE jc.player_id = $1 AND jc.partidas >= $2
        ORDER BY jc.partidas DESC
        LIMIT 40`,
      [id, MIN_PARTIDAS_CONFRONTO],
    ),
    pool.query(
      `SELECT golpe, tipo, usos, dano FROM tracker_jogador_golpe
        WHERE player_id = $1 ORDER BY dano DESC LIMIT 10`,
      [id],
    ),
    pool.query(
      // `peso > 0` NÃO é filtro de qualidade, é de PRIVACIDADE: peso zero quer dizer MESMA CASA
      // (dois jogadores atrás do mesmo endereço — ver `rodarPartida`). Publicar essas partidas
      // numa página aberta contaria ao mundo, com nome e sobrenome, que duas contas dividem a
      // mesma rede. É um fato que o jogo mostra aos dois envolvidos e a mais ninguém, e não é o
      // Tracker que vai transformá-lo num mapa de contas alternativas indexado pelo Google.
      //
      // Elas também já estavam fora do meta (`tracker-db.mjs`), então o corte é o mesmo nos dois
      // lugares: para o público, uma partida de peso zero não aconteceu.
      `SELECT a_id, b_id, a_nick, b_nick, a_antes, b_antes, a_delta, b_delta,
              venceu_a, motivo, duracao_ms, criado_em, detalhe
         FROM pvp_partidas
        WHERE (a_id = $1 OR b_id = $1) AND peso > 0
        ORDER BY criado_em DESC, id DESC
        LIMIT $2`,
      [id, HISTORICO_PARTIDAS],
    ),
    pool.query(
      `SELECT g.nome, g.brasao FROM guild_members m JOIN guilds g ON g.id = m.guild_id
        WHERE m.player_id = $1`,
      [id],
    ),
  ]);

  const linhaRank = rank.rows[0] ?? null;
  let posicao = null;
  if (linhaRank && Number(linhaRank.partidas) >= PVP_PARTIDAS_POSICIONAMENTO) {
    const { rows } = await pool.query(
      `SELECT 1 + count(*) AS pos FROM pvp_rank r
        WHERE r.partidas >= $2
          AND (r.pontos, r.vitorias, -r.player_id) >
              (SELECT m.pontos, m.vitorias, -m.player_id FROM pvp_rank m WHERE m.player_id = $1)`,
      [id, PVP_PARTIDAS_POSICIONAMENTO],
    );
    posicao = rows[0] ? Number(rows[0].pos) : null;
  }

  const t = totais.rows[0] ?? null;
  const tp = Number(t?.partidas) || 0;
  const comWinrate = (r, chaveId, chaveNome) => ({
    id: Number(r[chaveId]),
    nome: r[chaveNome] ?? `#${r[chaveId]}`,
    looktype: Number(r.looktype) || 0,
    tipos: [r.tipo1, r.tipo2].filter(Boolean),
    partidas: Number(r.partidas) || 0,
    vitorias: Number(r.vitorias) || 0,
    winrate: r.partidas ? Number(r.vitorias) / Number(r.partidas) : 0,
  });

  const rivais = confrontos.rows.map((r) => comWinrate(r, 'rival_id', 'nome'));

  return {
    jogador: {
      nick: quem[0].nick,
      nivel: Number(quem[0].nivel) || 1,
      looktype: Number(quem[0].looktype) || 0,
      desde: quem[0].desde,
      guild: guild.rows[0]
        ? { nome: guild.rows[0].nome, brasao: guild.rows[0].brasao ?? null }
        : null,
    },
    rank: linhaRank
      ? {
          pontos: Number(linhaRank.pontos) || 0,
          pico: Number(linhaRank.pico) || 0,
          vitorias: Number(linhaRank.vitorias) || 0,
          derrotas: Number(linhaRank.derrotas) || 0,
          partidas: Number(linhaRank.partidas) || 0,
          sequencia: Number(linhaRank.sequencia) || 0,
          winrate: linhaRank.partidas
            ? Number(linhaRank.vitorias) / Number(linhaRank.partidas)
            : 0,
          ...emblema(
            {
              pontos: Number(linhaRank.pontos) || 0,
              partidas: Number(linhaRank.partidas) || 0,
              ultimaEm: linhaRank.ultima_em,
            },
            posicao,
          ),
        }
      : null,
    totais: t
      ? {
          partidas: tp,
          vitorias: Number(t.vitorias) || 0,
          dano: Number(t.dano) || 0,
          recebido: Number(t.recebido) || 0,
          abates: Number(t.abates) || 0,
          mortes: Number(t.mortes) || 0,
          danoMedio: tp ? Math.round(Number(t.dano) / tp) : 0,
          recebidoMedio: tp ? Math.round(Number(t.recebido) / tp) : 0,
          abatesMedio: tp ? Number(t.abates) / tp : 0,
          duracaoMedia: tp ? Math.round(Number(t.duracao_ms) / tp) : 0,
        }
      : null,
    pokemons: pokemons.rows.map((r) => ({
      ...comTaxas(r),
      // Quanto do dano do time saiu DESTE pokémon. É o "quem carrega o time" da tela.
      fatiaDano: t && Number(t.dano) ? (Number(r.dano) || 0) / Number(t.dano) : 0,
    })),
    // As duas pontas da mesma lista: contra quem ele mais perde e contra quem mais ganha.
    // Ordenadas aqui, e não no banco, porque a lista já veio cortada em 40 — ordenar duas
    // vezes no Postgres seria duas consultas para escolher cinco linhas de cada ponta.
    counters: [...rivais].sort((x, y) => x.winrate - y.winrate || y.partidas - x.partidas).slice(0, 6),
    vitimas: [...rivais].sort((x, y) => y.winrate - x.winrate || y.partidas - x.partidas).slice(0, 6),
    golpes: gol.rows.map((r) => ({
      nome: r.golpe,
      tipo: r.tipo ?? null,
      usos: Number(r.usos) || 0,
      dano: Number(r.dano) || 0,
      medio: r.usos ? Math.round(Number(r.dano) / Number(r.usos)) : 0,
    })),
    partidas: partidas.rows.map((r) => partidaVista(r, id)),
  };
}

/**
 * Uma partida DO PONTO DE VISTA de um jogador.
 *
 * A tabela guarda os dois lados em colunas `a_*`/`b_*`; quem lê quer "eu" e "ele". A virada
 * acontece aqui, uma vez, e não em cada tela que mostra histórico.
 */
function partidaVista(r, id) {
  const souA = Number(r.a_id) === id;
  const eu = souA ? 0 : 1;
  const d = r.detalhe && r.detalhe.v === 1 && Array.isArray(r.detalhe.lados) ? r.detalhe : null;
  const meu = d?.lados?.[eu] ?? null;
  const dele = d?.lados?.[1 - eu] ?? null;
  const limparLado = (l) => l && {
    d: Number(l.d) || 0,
    r: Number(l.r) || 0,
    k: Number(l.k) || 0,
    mo: Number(l.mo) || 0,
    gl: Number(l.gl) || 0,
    sup: Number(l.sup) || 0,
    vivo: l.vivo ? 1 : 0,
    pks: (l.pks ?? []).slice(0, 8).map((pk) => ({
      id: Number(pk.e) || 0,
      nome: String(pk.n ?? ''),
      looktype: Number(pk.lt) || 0,
      nivel: Number(pk.nv) || 1,
      shiny: pk.sh ? 1 : 0,
      dano: Number(pk.d) || 0,
      recebido: Number(pk.r) || 0,
      abates: Number(pk.k) || 0,
      golpes: Number(pk.gl) || 0,
      caiu: pk.caiu ? 1 : 0,
    })),
    golpes: (l.golpes ?? []).slice(0, 4).map((g) => ({
      nome: String(g.n ?? ''), tipo: g.t ?? null, usos: Number(g.u) || 0, dano: Number(g.d) || 0,
    })),
    maior: l.maior
      ? { valor: Number(l.maior.v) || 0, nome: String(l.maior.n ?? ''), tipo: l.maior.t ?? null, pokemon: String(l.maior.pk ?? '') }
      : null,
  };
  return {
    // O `id` da linha NÃO sai daqui. Ele é uma `BIGSERIAL` global: publicá-lo entrega a
    // contagem de todas as partidas ranqueadas já jogadas no servidor (e o ritmo em que elas
    // acontecem) a qualquer um que abra duas fichas com um dia de diferença. A tela não precisa
    // dele — as partidas são desenhadas na ordem em que vêm.
    em: r.criado_em,
    venci: souA ? r.venceu_a : !r.venceu_a,
    motivo: r.motivo,
    duracaoMs: Number(r.duracao_ms) || 0,
    delta: souA ? Number(r.a_delta) : Number(r.b_delta),
    antes: souA ? Number(r.a_antes) : Number(r.b_antes),
    oponente: { nick: souA ? r.b_nick : r.a_nick, pontos: souA ? Number(r.b_antes) : Number(r.a_antes) },
    eu: limparLado(meu),
    ele: limparLado(dele),
  };
}

// ------------------------------------------------------------ guerra de guilds

/** As guerras recentes, só o pódio — a fita não é lida aqui (são dezenas de KB por dia). */
export async function guerras(limite = 14) {
  const { rows } = await pool.query(
    `SELECT b.evento_data, b.vencedor_id, b.resumo, (b.replay IS NOT NULL) AS tem_replay,
            g.nome AS vencedor_nome
       FROM guild_pvp_batalhas b
       LEFT JOIN guilds g ON g.id = b.vencedor_id
      ORDER BY b.evento_data DESC
      LIMIT $1`,
    [inteiro(limite, 14, 1, 40)],
  );
  return rows.map((r) => {
    const resumo = typeof r.resumo === 'string' ? JSON.parse(r.resumo) : (r.resumo ?? {});
    const placar = Array.isArray(resumo.placar) ? resumo.placar : [];
    return {
      dia: typeof r.evento_data === 'string' ? r.evento_data : r.evento_data.toISOString().slice(0, 10),
      vencedor: r.vencedor_nome ?? null,
      temAnalise: !!r.tem_replay,
      motivo: resumo.motivo ?? null,
      duracaoMs: Number(resumo.duracaoMs) || 0,
      // Só o pódio: a guerra pode ter 50 guilds e a lista inteira não cabe num cartão.
      podio: placar
        .slice()
        .sort((a, b) => (Number(a.pos) || 99) - (Number(b.pos) || 99))
        .slice(0, 3)
        .map((p) => ({ nome: p.nome ?? '?', pos: Number(p.pos) || 0, gp: Number(p.gp) || 0 })),
      guilds: placar.length,
    };
  });
}

/**
 * A ANÁLISE de uma guerra: quem bateu, quem apanhou, com o quê.
 *
 * Sai do MESMO lugar que a tela do jogo lê (`analiseGuildWar`), fita por fita, com o cache de
 * dez minutos que ele já tem. Refazer a conta aqui seria ter duas análises da mesma guerra no
 * mesmo servidor, e um dia elas discordariam.
 *
 * O que muda é o TAMANHO: lá dentro o jogador vê a guerra inteira, e aqui a lista é cortada no
 * topo. Uma guerra de 50 guilds tem centenas de lutadores com a ficha de cada pokémon; mandar
 * isso por uma página pública seria megabytes por visita para uma tela que mostra vinte linhas.
 */
let analiseEmCurso = Promise.resolve();

export async function guerra(dia) {
  const d = String(dia ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;

  // UMA ANÁLISE POR VEZ, e a fila é global ao processo.
  //
  // Esta é a única rota do Tracker com custo de CPU de verdade: ler a fita de uma guerra (dezenas
  // de KB de JSON no banco) e percorrê-la golpe a golpe. O analisador tem cache próprio, mas de
  // quatro entradas — e a lista da tela oferece catorze dias. Pedir os catorze em paralelo faria
  // o cache girar em falso e colocaria catorze análises rodando JUNTAS no gateway, que é o mesmo
  // processo que serve os sockets do jogo.
  //
  // Serializando, o pior caso vira "as análises demoram", e nunca "o jogo engasga". A espera é
  // do visitante, que já está clicando para abrir um relatório.
  const minhaVez = analiseEmCurso.then(() => analiseGuildWar(d), () => analiseGuildWar(d));
  // A fila anda mesmo quando uma análise falha; o `catch` aqui é só para a corrente não quebrar.
  analiseEmCurso = minhaVez.catch(() => {});
  const a = await minhaVez;
  if (!a) return null;

  const quem = (x) => (x ? { nick: x.nick, g: x.g ?? 0, valor: Number(x.v) || 0 } : null);
  return {
    dia: a.dia ?? d,
    dur: Number(a.dur) || 0,
    motivo: a.motivo ?? null,
    semGolpes: !!a.semGolpes,
    totais: a.totais ?? null,
    guilds: (a.guilds ?? []).slice(0, 12).map((g) => ({
      i: g.i, nome: g.nome, pos: g.pos, gp: g.gp,
      dano: g.d, recebido: g.r, abates: g.k, mortes: g.mo,
      lutadores: g.n, vivos: g.vivos, mvp: g.mvp ?? null,
    })),
    // Os vinte que mais causaram dano. A análise já vem ordenada assim.
    jogadores: (a.jogadores ?? []).slice(0, 20).map((j) => ({
      nick: j.nick, g: j.g,
      dano: j.d, recebido: j.r, abates: j.k, mortes: j.mo, golpes: j.gl, super: j.sup,
      vivo: j.vivo,
      // Só o RETRATO de cada pokémon que entrou, e o dano dele — a ficha inteira (HP máximo,
      // quando entrou, quando caiu) é do player de replay, não de uma tabela.
      pks: (j.pks ?? []).slice(0, 6).map((pk) => ({
        id: pk.e || 0, nome: pk.n, looktype: pk.lt, nivel: pk.nv, shiny: pk.sh ? 1 : 0,
        dano: pk.d, recebido: pk.r, abates: pk.k, caiu: pk.caiu ? 1 : 0,
      })),
    })),
    especies: (a.especies ?? []).slice(0, 8).map((e) => ({
      nome: e.n, looktype: e.lt, shiny: e.sh ? 1 : 0, usos: e.usos, dano: e.d, abates: e.k,
    })),
    golpes: (a.golpes ?? []).slice(0, 8).map((g) => ({
      nome: g.n, tipo: g.t ?? null, usos: g.usos, dano: g.d,
    })),
    destaques: {
      dano: quem(a.destaques?.dano),
      abates: quem(a.destaques?.abates),
      muralha: quem(a.destaques?.muralha),
      superEfetivo: quem(a.destaques?.superEfetivo),
      maiorGolpe: a.destaques?.maiorGolpe
        ? {
            nick: a.destaques.maiorGolpe.nick, valor: Number(a.destaques.maiorGolpe.v) || 0,
            golpe: a.destaques.maiorGolpe.golpe, tipo: a.destaques.maiorGolpe.tipo ?? null,
            pokemon: a.destaques.maiorGolpe.pk ?? null,
          }
        : null,
      pokemon: a.destaques?.pokemon
        ? {
            nick: a.destaques.pokemon.nick, nome: a.destaques.pokemon.n,
            looktype: a.destaques.pokemon.lt, valor: Number(a.destaques.pokemon.v) || 0,
            abates: Number(a.destaques.pokemon.k) || 0,
          }
        : null,
    },
  };
}

/** O ranking das guilds — os dois GP que o jogo já mantém. */
export async function rankingGuilds(limite = 20) {
  const { rows } = await pool.query(
    `SELECT g.nome, g.gp, g.gp_global, g.brasao, count(m.player_id)::int AS membros
       FROM guilds g LEFT JOIN guild_members m ON m.guild_id = g.id
      GROUP BY g.id, g.nome, g.gp, g.gp_global, g.brasao
      ORDER BY g.gp_global DESC, g.gp DESC, g.nome ASC
      LIMIT $1`,
    [inteiro(limite, 20, 1, 50)],
  );
  return rows.map((r, i) => ({
    posicao: i + 1,
    nome: r.nome,
    gp: Number(r.gp) || 0,
    gpGlobal: Number(r.gp_global) || 0,
    membros: Number(r.membros) || 0,
    brasao: r.brasao ?? null,
  }));
}
