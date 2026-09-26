// A persistência dos EVENTOS globais (o buff que o admin liga para todo mundo).
//
// Uma tabela append-only: cada evento é uma linha, e encerrar antes da hora é um UPDATE em
// `termina_em` — nunca um DELETE. O histórico é o que responde "por que o servidor rendeu o
// dobro naquela terça?" seis meses depois.
//
// ### Por que o banco e não só o Redis
//
// O Redis carrega o AVISO (o sim precisa saber na hora que o admin clicou), mas ele não é a
// verdade: um restart do cluster no meio de um evento de 6 horas apagaria o buff sem
// ninguém perceber. O sim lê daqui no boot, e a partir daí só escuta.
import { pool } from './db.mjs';
import { limitarPct, limitarMinutos } from './game/eventos.mjs';

/**
 * `CREATE TABLE IF NOT EXISTS` que aguenta os três processos subindo juntos.
 *
 * O `IF NOT EXISTS` do Postgres NÃO é atômico: ele confere e só então cria, e quem perde a
 * corrida estoura com `23505` em `pg_type` (ou `42P07`). Na tabela que já existe isso nunca
 * acontece — a conferência resolve antes de criar —, e é por isso que o problema só aparece
 * no PRIMEIRO boot depois do deploy que traz a tabela nova. Aí ele aparece no pior momento:
 * o gateway e os dois sims reiniciam em sequência e rodam a mesma migração com milissegundos
 * de diferença.
 *
 * Perder a corrida não é erro: a tabela ficou criada do mesmo jeito, pelo outro processo.
 */
const criarTabela = async (sql) => {
  try {
    await pool.query(sql);
  } catch (err) {
    if (err.code !== '23505' && err.code !== '42P07') throw err;
    console.log('[eventos] tabela criada por outro processo no mesmo instante — seguindo');
  }
};

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eventos_buff (
      id               BIGSERIAL PRIMARY KEY,
      xp_treinador_pct INT NOT NULL DEFAULT 0,
      xp_pokemon_pct   INT NOT NULL DEFAULT 0,
      farm_pct         INT NOT NULL DEFAULT 0,
      minutos          INT NOT NULL,
      criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
      termina_em       TIMESTAMPTZ NOT NULL,
      criado_por       TEXT,
      encerrado_por    TEXT
    )`);
  // A consulta do boot é sempre "o que ainda está valendo agora", e ela roda antes de o
  // gateway aceitar conexão — o índice a mantém instantânea mesmo com anos de histórico.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_evt_vigente ON eventos_buff(termina_em DESC)`,
  );
  // A AGENDA: os eventos que se repetem toda semana sem ninguém clicar em nada.
  //
  // `dias` é um array de dow do Postgres (0 = domingo … 6 = sábado) porque uma regra é quase
  // sempre mais de um dia ("sábado e domingo"), e três linhas iguais menos o dia seriam três
  // lugares para editar quando a porcentagem mudar.
  //
  // `hora`/`minuto` são hora de PAREDE no Brasil, não UTC. O servidor roda em UTC e quem
  // marca "sexta ao meio-dia" quer meio-dia de São Paulo — a conversão mora na consulta, com
  // o banco de fusos do Postgres, e não numa conta de -3 que o primeiro horário de verão
  // quebraria em silêncio.
  //
  // `ultimo_em` guarda a OCORRÊNCIA disparada (a sexta 12:00 daquela semana), não o instante
  // do disparo: é o que torna a checagem idempotente com dois gateways de pé e com o tick
  // rodando a cada minuto.
  await criarTabela(`
    CREATE TABLE IF NOT EXISTS eventos_agenda (
      id               BIGSERIAL PRIMARY KEY,
      dias             SMALLINT[] NOT NULL,
      hora             SMALLINT NOT NULL,
      minuto           SMALLINT NOT NULL DEFAULT 0,
      xp_treinador_pct INT NOT NULL DEFAULT 0,
      xp_pokemon_pct   INT NOT NULL DEFAULT 0,
      farm_pct         INT NOT NULL DEFAULT 0,
      minutos          INT NOT NULL,
      ativa            BOOLEAN NOT NULL DEFAULT true,
      criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
      criado_por       TEXT,
      ultimo_em        TIMESTAMPTZ
    )`);
}

const linhaParaCliente = (r) => r && {
  id: Number(r.id),
  xpTreinadorPct: Number(r.xp_treinador_pct),
  xpPokemonPct: Number(r.xp_pokemon_pct),
  farmPct: Number(r.farm_pct),
  minutos: Number(r.minutos),
  criadoEm: r.criado_em?.getTime?.() ?? null,
  terminaEm: r.termina_em?.getTime?.() ?? 0,
  criadoPor: r.criado_por ?? null,
  encerradoPor: r.encerrado_por ?? null,
};

/**
 * Abre um evento.
 *
 * Só existe UM por vez: qualquer outro ainda em pé é encerrado na mesma transação. Dois
 * eventos simultâneos seriam dois buffs somados sem que a tela tivesse como mostrar os dois
 * — e o admin que liga o segundo quase sempre quer justamente substituir o primeiro.
 */
export async function criarEvento({ xpTreinadorPct, xpPokemonPct, farmPct, minutos, criadoPor }) {
  const tr = limitarPct(xpTreinadorPct);
  const pk = limitarPct(xpPokemonPct);
  const farm = limitarPct(farmPct);
  const mins = limitarMinutos(minutos);
  if (!tr && !pk && !farm) throw new Error('informe pelo menos um bônus maior que zero');

  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    await cli.query(
      `UPDATE eventos_buff SET termina_em = now(), encerrado_por = $1
        WHERE termina_em > now()`,
      [criadoPor ?? null],
    );
    const { rows } = await cli.query(
      `INSERT INTO eventos_buff (xp_treinador_pct, xp_pokemon_pct, farm_pct, minutos, termina_em, criado_por)
       VALUES ($1,$2,$3,$4, now() + ($4::int * INTERVAL '1 minute'), $5)
       RETURNING *`,
      [tr, pk, farm, mins, criadoPor ?? null],
    );
    await cli.query('COMMIT');
    return linhaParaCliente(rows[0]);
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}

/** Corta o evento em andamento agora. Devolve o que foi encerrado, ou `null`. */
export async function encerrarEvento(encerradoPor) {
  const { rows } = await pool.query(
    `UPDATE eventos_buff SET termina_em = now(), encerrado_por = $1
      WHERE termina_em > now() RETURNING *`,
    [encerradoPor ?? null],
  );
  return linhaParaCliente(rows[0]) ?? null;
}

/** O evento que ainda está valendo, ou `null`. É o que o sim lê no boot. */
export async function eventoVigente() {
  const { rows } = await pool.query(
    `SELECT * FROM eventos_buff WHERE termina_em > now() ORDER BY id DESC LIMIT 1`,
  );
  return linhaParaCliente(rows[0]) ?? null;
}

/** Os últimos eventos, do mais novo para o mais velho — o histórico do painel. */
export async function listarEventos(limite = 20) {
  const n = Math.max(1, Math.min(100, Number(limite) || 20));
  const { rows } = await pool.query(
    `SELECT * FROM eventos_buff ORDER BY id DESC LIMIT $1`,
    [n],
  );
  return rows.map(linhaParaCliente);
}

// ------------------------------------------------------------------ agenda semanal
//
// O evento que se repete sozinho: "toda sexta, meio-dia, 15/15/5 por 12 horas". A tabela
// guarda a REGRA; quem transforma regra em evento é o tique do gateway, que a cada minuto
// pergunta ao banco quais ocorrências venceram e chama o mesmo `criarEvento` do botão.
//
// ### Por que o disparo é uma reivindicação, e não um `SELECT` seguido de `INSERT`
//
// Entre ler "esta agenda venceu" e gravar "já disparei" cabe outro processo lendo a mesma
// coisa — e dois gateways ligariam o mesmo evento duas vezes, com o segundo encerrando o
// primeiro no mesmo segundo. O `UPDATE ... RETURNING` abaixo faz as duas coisas numa
// operação só: quem conseguir escrever `ultimo_em` é quem leva a linha, e o outro recebe
// lista vazia. Vale também para o tique que atropela o anterior num servidor travado.

/** O fuso em que a hora marcada é lida. Hora de parede do Brasil, não do relógio do servidor. */
const FUSO = 'America/Sao_Paulo';

/**
 * Quanto tempo depois da hora marcada um disparo atrasado ainda vale.
 *
 * Existe porque o servidor pode estar reiniciando às 12:00 em ponto. Meia hora é curta o
 * bastante para ninguém estranhar ("o evento das 12h começou 12:03") e longa o bastante para
 * cobrir um deploy. Passou disso, a ocorrência é PULADA — ligar às 19h um evento anunciado
 * para as 12h é pior do que não ligar.
 */
export const AGENDA_TOLERANCIA_MIN = 30;

/** A ocorrência de HOJE desta regra, como instante — a hora de parede convertida pelo fuso. */
const OCORRENCIA_HOJE = `
  ((date_trunc('day', now() AT TIME ZONE '${FUSO}')
    + make_interval(hours => hora, mins => minuto)) AT TIME ZONE '${FUSO}')`;

/** A mesma ocorrência de hoje, mas com a hora vindo de parâmetro — usada no INSERT. */
const OCORRENCIA_DE_PARAMETRO = `
  ((date_trunc('day', now() AT TIME ZONE '${FUSO}')
    + make_interval(hours => $2::int, mins => $3::int)) AT TIME ZONE '${FUSO}')`;

/** O próximo disparo futuro: o menor entre os dias marcados, já virando a semana se preciso. */
const PROXIMA_OCORRENCIA = `
  (SELECT min(CASE WHEN c.quando > now() THEN c.quando ELSE c.quando + INTERVAL '7 days' END)
     FROM unnest(a.dias) AS d
     CROSS JOIN LATERAL (
       SELECT ((date_trunc('day', now() AT TIME ZONE '${FUSO}')
                + make_interval(
                    days => ((d - EXTRACT(dow FROM now() AT TIME ZONE '${FUSO}')::int + 7) % 7),
                    hours => a.hora, mins => a.minuto)) AT TIME ZONE '${FUSO}') AS quando
     ) c)`;

const agendaParaCliente = (r) => r && {
  id: Number(r.id),
  dias: (r.dias ?? []).map(Number),
  hora: Number(r.hora),
  minuto: Number(r.minuto),
  xpTreinadorPct: Number(r.xp_treinador_pct),
  xpPokemonPct: Number(r.xp_pokemon_pct),
  farmPct: Number(r.farm_pct),
  minutos: Number(r.minutos),
  ativa: !!r.ativa,
  criadoEm: r.criado_em?.getTime?.() ?? null,
  criadoPor: r.criado_por ?? null,
  ultimoEm: r.ultimo_em?.getTime?.() ?? null,
  proximoEm: r.proximo_em?.getTime?.() ?? null,
};

/** `[0..6]`, sem repetido e em ordem. Vazio é erro: uma regra sem dia nunca dispararia. */
const limparDias = (v) => {
  const dias = [...new Set((Array.isArray(v) ? v : [])
    .map((d) => Math.trunc(Number(d)))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  if (!dias.length) throw new Error('escolha pelo menos um dia da semana');
  return dias;
};

const limparHora = (v) => Math.max(0, Math.min(23, Math.trunc(Number(v) || 0)));
const limparMinuto = (v) => Math.max(0, Math.min(59, Math.trunc(Number(v) || 0)));

export async function criarAgenda({
  dias, hora, minuto, xpTreinadorPct, xpPokemonPct, farmPct, minutos, criadoPor,
}) {
  const tr = limitarPct(xpTreinadorPct);
  const pk = limitarPct(xpPokemonPct);
  const farm = limitarPct(farmPct);
  if (!tr && !pk && !farm) throw new Error('informe pelo menos um bônus maior que zero');
  // Nasce com a ocorrência de HOJE já marcada como gasta quando ela ficou para trás.
  //
  // Sem isto, criar às 12:05 a regra das 12:00 de sexta ligava o evento no minuto seguinte —
  // enquanto a tabela, do lado, prometia "próximo: sexta que vem". Uma regra passa a valer da
  // próxima ocorrência em diante, que é como se lê "toda sexta ao meio-dia" depois do almoço.
  const { rows } = await pool.query(
    `WITH o AS (SELECT ${OCORRENCIA_DE_PARAMETRO} AS quando)
     INSERT INTO eventos_agenda
       (dias, hora, minuto, xp_treinador_pct, xp_pokemon_pct, farm_pct, minutos, criado_por, ultimo_em)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN o.quando <= now() THEN o.quando END
       FROM o
     RETURNING *`,
    [limparDias(dias), limparHora(hora), limparMinuto(minuto), tr, pk, farm,
     limitarMinutos(minutos), criadoPor ?? null],
  );
  // O INSERT não calcula `proximo_em` — quem desenha a lista quer a linha completa.
  return (await listarAgendas()).find((a) => a.id === Number(rows[0].id)) ?? agendaParaCliente(rows[0]);
}

export async function listarAgendas() {
  const { rows } = await pool.query(
    `SELECT a.*, ${PROXIMA_OCORRENCIA} AS proximo_em
       FROM eventos_agenda a
      ORDER BY a.ativa DESC, proximo_em NULLS LAST, a.id DESC`,
  );
  return rows.map(agendaParaCliente);
}

export async function removerAgenda(id) {
  const { rows } = await pool.query(
    `DELETE FROM eventos_agenda WHERE id = $1 RETURNING *`,
    [Number(id) || 0],
  );
  return agendaParaCliente(rows[0]) ?? null;
}

/** Liga/desliga sem perder a regra — o "pausar" de uma temporada que não vai rolar esta semana. */
export async function alternarAgenda(id, ativa) {
  const { rows } = await pool.query(
    `UPDATE eventos_agenda SET ativa = $2 WHERE id = $1 RETURNING *`,
    [Number(id) || 0, !!ativa],
  );
  return agendaParaCliente(rows[0]) ?? null;
}

/**
 * Marca como disparadas as ocorrências vencidas e devolve as regras que venceram.
 *
 * Marcar ANTES de ligar o evento é de propósito: se o `criarEvento` falhar, a ocorrência fica
 * perdida — e é o certo. O contrário (marcar depois) transforma qualquer erro de banco numa
 * fila de eventos atrasados que entram todos juntos no minuto seguinte.
 */
export async function reivindicarAgendasVencidas(toleranciaMin = AGENDA_TOLERANCIA_MIN) {
  const tol = Math.max(1, Math.min(720, Math.trunc(Number(toleranciaMin) || AGENDA_TOLERANCIA_MIN)));
  const { rows } = await pool.query(
    `UPDATE eventos_agenda a
        SET ultimo_em = o.quando
       FROM (SELECT id, ${OCORRENCIA_HOJE} AS quando FROM eventos_agenda) o
      WHERE a.id = o.id
        AND a.ativa
        AND EXTRACT(dow FROM now() AT TIME ZONE '${FUSO}')::int = ANY(a.dias)
        AND now() >= o.quando
        AND now() < o.quando + make_interval(mins => $1)
        AND (a.ultimo_em IS NULL OR a.ultimo_em < o.quando)
      RETURNING a.*, o.quando AS ocorrencia`,
    [tol],
  );
  return rows.map((r) => ({ ...agendaParaCliente(r), ocorrencia: r.ocorrencia?.getTime?.() ?? null }));
}
