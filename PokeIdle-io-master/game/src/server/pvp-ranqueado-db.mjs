// Persistência do PvP Ranqueado: a linha de rank, a equipe salva e o histórico de partidas.
//
// ### Por que o PR NÃO mora em `players`
//
// A coluna `players.elo` da arena antiga é escrita pelo `flushJogadores`, que grava a partir
// da MEMÓRIA do sim dono do jogador. Isso funciona para tudo que só o próprio sim altera —
// e quebra para tudo o mais. Aqui quem move o PR é o processo do MATCHMAKING, que pode ser
// outro shard: creditar em `players.elo` seria escrever um número que o próximo flush do
// jogador (com o valor de antes da partida, ainda em memória) apagaria cinco segundos depois.
//
// É o mesmo problema do Mercado Global e das duas moedas pagas, e a solução é a mesma:
// tabela própria, fora do write-behind, escrita em transação. `pvp_rank` é a verdade; o
// cliente lê pelo pacote `pvp`, e nenhum sim mantém cópia disso em memória.
//
// ### O que NÃO é gravado: o replay
//
// A fita da partida (o mesmo formato da Guerra de Guilds, ~40 KB) é entregue AO VIVO aos dois
// jogadores e descartada. Guardá-la significaria dezenas de MB por dia de um conteúdo que se
// assiste uma vez, nos primeiros dez segundos depois da partida — e o jogador que estava
// online (a única forma de estar na fila) já viu. O histórico guarda o RESUMO, que é o que se
// consulta depois: contra quem, quem ganhou, quantos pontos.
import { pool } from './db.mjs';
import { especies } from './content.mjs';
import { normalizarRefino } from '../shared/refino-stats.mjs';
import { porQueNaoPodeLutar } from '../shared/campeonato.mjs';
import {
  PVP_DECAIMENTO_MS,
  PVP_PARTIDAS_POSICIONAMENTO,
  PVP_PONTOS_INICIAIS,
  PVP_PR_ELITE,
  PVP_PREMIOS,
  PVP_TIME_MAX,
  decaiEm,
  pontosAposDecaimento,
  premioDaPosicao,
  rankComVaga,
  temporadaDe,
  vagaDecaiu,
} from '../shared/pvp-rank.mjs';

export class ErroPvp extends Error {
  constructor(codigo, msg) {
    super(msg);
    this.codigo = codigo;
  }
}

/** Quanto tempo o resumo de uma partida fica no histórico antes da faxina. */
export const RETENCAO_PARTIDAS_DIAS = 30;

export async function migrar() {
  // `tier_topo` é o ÍNDICE do maior tier já alcançado (0 = bronze). É ele que decide quando
  // um escudo de rebaixamento novo é concedido — ver `aplicarDelta` em `shared/pvp-rank.mjs`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pvp_rank (
      player_id     BIGINT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      pontos        INT NOT NULL DEFAULT ${PVP_PONTOS_INICIAIS},
      pico          INT NOT NULL DEFAULT ${PVP_PONTOS_INICIAIS},
      vitorias      INT NOT NULL DEFAULT 0,
      derrotas      INT NOT NULL DEFAULT 0,
      partidas      INT NOT NULL DEFAULT 0,
      sequencia     INT NOT NULL DEFAULT 0,
      escudo        INT NOT NULL DEFAULT 0,
      tier_topo     INT NOT NULL DEFAULT 0,
      ultima_em     TIMESTAMPTZ,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // A tabela é lida inteira e ordenada a cada abertura da aba: sem este índice, cada leitura
  // do topo seria uma varredura da tabela de todo jogador que já entrou numa fila.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_pvp_rank_pontos ON pvp_rank(pontos DESC, player_id)`,
  );
  // O ponto de partida foi ao chão depois da primeira versão. Num banco que já tinha a
  // tabela o `CREATE TABLE IF NOT EXISTS` não mexe no DEFAULT — e uma conta nova nasceria
  // com o número velho. O ALTER é idempotente e resolve as duas situações com uma linha.
  await pool.query(
    `ALTER TABLE pvp_rank ALTER COLUMN pontos SET DEFAULT ${PVP_PONTOS_INICIAIS}`,
  );
  await pool.query(
    `ALTER TABLE pvp_rank ALTER COLUMN pico SET DEFAULT ${PVP_PONTOS_INICIAIS}`,
  );
  // A equipe é fechada ANTES da fila, e é ela que entra na partida. Guardar só os ids (e não
  // um retrato dos stats) é de propósito: o jogador que subiu o pokémon de nível entre uma
  // partida e a seguinte leva o bicho como ele está AGORA.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pvp_time (
      player_id     BIGINT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      pokemon_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  // `a_visto`/`b_visto`: a caixa postal de quem caiu no último segundo. A partida resolve
  // sozinha (ver o cabeçalho de `game/pvp-ranqueado.mjs`), então quem perdeu a conexão no
  // meio ainda tem o resultado esperando no próximo login.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pvp_partidas (
      id         BIGSERIAL PRIMARY KEY,
      a_id       BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      b_id       BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      a_nick     TEXT NOT NULL,
      b_nick     TEXT NOT NULL,
      a_antes    INT NOT NULL,
      b_antes    INT NOT NULL,
      a_delta    INT NOT NULL,
      b_delta    INT NOT NULL,
      venceu_a   BOOLEAN NOT NULL,
      motivo     TEXT NOT NULL DEFAULT 'wipe',
      duracao_ms INT NOT NULL DEFAULT 0,
      peso       REAL NOT NULL DEFAULT 1,
      a_visto    BOOLEAN NOT NULL DEFAULT false,
      b_visto    BOOLEAN NOT NULL DEFAULT false,
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_pvp_partidas_a ON pvp_partidas(a_id, criado_em DESC)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_pvp_partidas_b ON pvp_partidas(b_id, criado_em DESC)`,
  );
  // A FICHA DA PARTIDA — o resumo analítico da fita que foi descartada (ver
  // `game/pvp-analise.mjs`). É o que o Tracker mostra em "as suas últimas partidas": dano
  // causado e recebido por pokémon, abates, quem caiu e os golpes que renderam.
  //
  // Coluna aqui, e não tabela à parte, porque ela vive e morre com a linha: a mesma faxina de
  // 30 dias (`limparPartidasAntigas`) leva as duas, e ninguém lê uma ficha sem ler a partida.
  // Uma tabela separada seria um JOIN em toda leitura do histórico e um segundo DELETE na
  // faxina, para guardar exatamente o mesmo dado pelo mesmo tempo.
  //
  // `NULL` é um valor legítimo e frequente: partida sem golpe gravado, fita truncada, ou
  // qualquer linha anterior a esta versão. Quem lê desenha o resumo de sempre e só não mostra
  // o relatório — o histórico nunca depende dela.
  //
  // A tabela guarda SÓ ranqueado: o Campeonato tem `campeonato_partidas` (com fita própria) e
  // o amistoso não grava nada. O rolo do Tracker (`tracker-db.mjs`) conta com isso — o que ele
  // soma daqui é ladder, e nada mais.
  await pool.query(`ALTER TABLE pvp_partidas ADD COLUMN IF NOT EXISTS detalhe JSONB`);

  // O prêmio da temporada, gravado na virada da semana e entregue quando o jogador aparece.
  //
  // ### Por que uma tabela, e não um `UPDATE players SET boosts = …`
  //
  // A virada acontece de madrugada (segunda, 00:00 de Brasília), com a maioria dos premiados
  // OFFLINE. Escrever direto na coluna resolveria esses, e quebraria justamente os que estão
  // online: o estado do
  // jogador vive em memória e desce pelo write-behind, então um `UPDATE` no meio do caminho
  // seria sobrescrito no flush seguinte — o prêmio sumiria para quem estava jogando na hora.
  //
  // Com a caixa postal não há corrida: a virada só REGISTRA o fato, e quem entrega é sempre o
  // mesmo caminho que já entrega pagamento do Mercado e coins de amigo (`recolherPremios`,
  // chamado no login e na varredura de quem já está dentro). `entregue_em` faz a entrega ser
  // idempotente, e o par (player_id, temporada) faz a VIRADA ser idempotente: rodar duas vezes
  // na mesma semana não paga duas vezes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pvp_premios (
      player_id   BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      temporada   TEXT   NOT NULL,
      posicao     INT    NOT NULL,
      faixa       TEXT   NOT NULL,
      boosts      JSONB  NOT NULL,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
      entregue_em TIMESTAMPTZ,
      PRIMARY KEY (player_id, temporada)
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_pvp_premios_pendente
       ON pvp_premios(player_id) WHERE entregue_em IS NULL`,
  );
  // A UNIDADE das durações em `boosts`. Até a temporada virar semanal (18/09/2026) o número era
  // em DIAS; daí em diante é em HORAS (`PVP_PREMIOS.horas`). O default 'dias' é o que mantém um
  // prêmio antigo ainda não entregue valendo o que valia — sem ele, "7" viraria sete horas.
  await pool.query(`ALTER TABLE pvp_premios ADD COLUMN IF NOT EXISTS unidade TEXT NOT NULL DEFAULT 'dias'`);

  // Devolve `true` na subida em que o reset de fato aconteceu — quem chama usa isso para
  // limpar a parte da memória que não mora no Postgres (ver `iniciarSim`).
  //
  // Ficou no FIM de propósito. Já esteve no meio da função, logo depois dos `ALTER` de
  // `pvp_rank`, e o efeito era invisível no desenvolvimento e fatal num banco novo: tudo daqui
  // para cima virava código inalcançável, e `pvp_time`/`pvp_partidas` simplesmente não eram
  // criadas. Aqui não dava para perceber porque as tabelas já existiam de uma versão anterior.
  return { escadaZerada: await zerarEscadaUmaVez() };
}

/**
 * Devolve TODO MUNDO ao pé da escada — uma vez só, na primeira subida que encontrar a marca
 * ausente.
 *
 * ### Por que isto existe
 *
 * A escada mudou de forma durante o desenvolvimento: o ponto de partida saiu de 700 PR (o meio
 * do Ouro) para 0, e o `ALTER … SET DEFAULT` acima só governa linhas NOVAS. As que já existiam
 * ficaram com 700 e viraram dois sintomas na tela, os dois relatados: um "Não Classificado"
 * sendo emparelhado como Ouro II, e — pior — uma VITÓRIA aparecendo como "-601 PR", porque o
 * teto do posicionamento puxava 700 para dentro do Bronze.
 *
 * A correção do teto (`aplicarDelta`) impede o segundo sintoma de voltar. Esta função conserta
 * o dado que já estava errado.
 *
 * ### Por que apagar, e não converter
 *
 * Não há conversão honesta: aqueles pontos foram ganhos com outra fórmula de Elo (soma zero,
 * sem atrito), outra largura de escada e outro ponto de partida. Qualquer regra de conversão
 * seria um número inventado com cara de histórico. E o custo de apagar é zero: o PvP ranqueado
 * nunca foi ao ar — o que existe em `pvp_rank` é dado de teste.
 *
 * A marca em `game_meta` é o que faz isto rodar UMA vez. Se um dia a escada mudar de novo
 * depois de o modo estar no ar, o caminho não é mexer aqui: é uma TEMPORADA, com aviso,
 * premiação do ciclo anterior e reset anunciado.
 *
 * O Postgres é só METADE do estado: os contadores de revanche vivem no Redis, e um reset que
 * os deixasse de pé faria a primeira partida depois dele já valer meio ponto "por revanche"
 * contra alguém que, para a escada nova, nunca foi enfrentado. Quem limpa aquela metade é o
 * chamador — ver o `escadaZerada` no retorno de `migrar`.
 */
async function zerarEscadaUmaVez() {
  const MARCA = 'pvp_rank_reset_v2';
  const feito = await pool.query(`SELECT 1 FROM game_meta WHERE chave = $1`, [MARCA]);
  if (feito.rows.length) return false;

  const { rowCount: linhas } = await pool.query(
    `UPDATE pvp_rank SET pontos = $1, pico = $1, vitorias = 0, derrotas = 0, partidas = 0,
                         sequencia = 0, escudo = 0, tier_topo = 0, ultima_em = NULL,
                         atualizado_em = now()`,
    [PVP_PONTOS_INICIAIS],
  );
  // O histórico vai junto: os deltas gravados nele saíram da fórmula antiga, e uma lista de
  // "+22 PR" que não bate com nenhum número da escada de hoje é pior do que uma lista vazia.
  const { rowCount: partidas } = await pool.query(`DELETE FROM pvp_partidas`);
  await pool.query(`INSERT INTO game_meta (chave, valor) VALUES ($1, '1')`, [MARCA]);

  if (linhas || partidas) {
    console.log(
      `[pvp] escada zerada: ${linhas} rank(s) de volta a ${PVP_PONTOS_INICIAIS} PR e `
      + `${partidas} partida(s) de histórico apagadas (mudança de fórmula, roda uma vez só)`,
    );
  }
  return true;
}

// ---------------------------------------------------------------- temporada

/**
 * A última posição que ainda premia. Sai da própria tabela de prêmios, e não de um 50 escrito
 * à mão: mexer nas faixas move o LIMIT da virada junto, que é o certo.
 */
const PVP_VAGAS_PREMIADAS = PVP_PREMIOS.at(-1).ate;

/** A marca de uma temporada já apurada. Uma linha em `game_meta` por semana virada. */
const marcaDaTemporada = (competencia) => `pvp_temporada_${competencia}`;

/**
 * Vira a semana: premia a tabela final da temporada que acabou e zera a escada.
 *
 * ### As duas coisas acontecem na MESMA transação, e isso não é detalhe
 *
 * Premiar e zerar são um ato só. Se o processo morresse entre os dois, o resultado seria o pior
 * dos dois mundos — ou a escada zerada sem ninguém premiado (a semana inteira de disputa jogada
 * fora), ou os prêmios pagos com a escada de pé (e pagos de novo na tentativa seguinte). Em
 * transação, ou a semana virou por completo ou não virou.
 *
 * ### Quem entra na foto
 *
 * Os mesmos dois filtros da vaga (ver `posicaoRankingElo`): quem terminou o posicionamento e
 * quem jogou dentro da janela de decaimento. É coerente com o que o jogador via na véspera —
 * quem já tinha perdido o emblema por sumir não leva prêmio de um posto que não ocupava.
 *
 * Com a janela de decaimento em 24 h, isso quer dizer: só leva prêmio quem jogou no dia que
 * antecede a virada — o mesmo "um dia parado derruba para o Diamante" que a tabela já mostrava.
 *
 * @param competencia  "2026-09-14" — a temporada (semana) que ACABOU.
 * @returns `{ virou, premiados, zerados }`. `virou:false` = já estava apurada.
 */
export async function virarTemporada(competencia) {
  const marca = marcaDaTemporada(competencia);
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    // A marca é lida DENTRO da transação e com trava de linha: dois shards que acordem no
    // mesmo segundo não podem apurar a mesma semana em paralelo. O segundo espera, relê e desiste.
    const { rows: feito } = await cli.query(
      `SELECT 1 FROM game_meta WHERE chave = $1 FOR UPDATE`, [marca],
    );
    if (feito.length) {
      await cli.query('ROLLBACK');
      return { virou: false, premiados: 0, zerados: 0 };
    }

    const { rows: tabela } = await cli.query(
      `SELECT player_id, pontos FROM pvp_rank
        WHERE partidas >= $1
          AND ultima_em IS NOT NULL
          AND ultima_em >= now() - ($2::bigint * INTERVAL '1 millisecond')
        ORDER BY pontos DESC, vitorias DESC, player_id ASC
        LIMIT $3`,
      [PVP_PARTIDAS_POSICIONAMENTO, PVP_DECAIMENTO_MS, PVP_VAGAS_PREMIADAS],
    );

    let premiados = 0;
    for (let i = 0; i < tabela.length; i++) {
      const posicao = i + 1;
      const premio = premioDaPosicao(posicao);
      if (!premio) break; // a lista está ordenada: a primeira posição sem prêmio encerra
      await cli.query(
        `INSERT INTO pvp_premios (player_id, temporada, posicao, faixa, boosts, unidade)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'horas')
         ON CONFLICT (player_id, temporada) DO NOTHING`,
        [tabela[i].player_id, competencia, posicao, premio.faixa, JSON.stringify(premio.horas)],
      );
      premiados++;
    }

    // O reset é TOTAL: PR, pico, placar, sequência, escudo e o tier máximo alcançado. O
    // `ultima_em` vai junto — mantê-lo faria o jogador nascer na temporada nova já contando
    // decaimento de uma partida que pertence à semana passada.
    const { rowCount: zerados } = await cli.query(
      `UPDATE pvp_rank SET pontos = $1, pico = $1, vitorias = 0, derrotas = 0, partidas = 0,
                           sequencia = 0, escudo = 0, tier_topo = 0, ultima_em = NULL,
                           atualizado_em = now()`,
      [PVP_PONTOS_INICIAIS],
    );

    await cli.query(`INSERT INTO game_meta (chave, valor) VALUES ($1, $2)`, [marca, String(premiados)]);
    await cli.query('COMMIT');
    return { virou: true, premiados, zerados };
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}


/** Esta temporada já foi apurada? */
export async function temporadaApurada(competencia) {
  const { rows } = await pool.query(
    `SELECT 1 FROM game_meta WHERE chave = $1`, [marcaDaTemporada(competencia)],
  );
  return rows.length > 0;
}

/**
 * Alguma temporada SEMANAL já foi apurada NESTE ambiente?
 *
 * É o que distingue "a semana virou" de "este banco nunca viu uma virada". Ver
 * `sementeDaTemporada`.
 *
 * ### Só a marca semanal conta
 *
 * As marcas da era mensal ("pvp_temporada_2026-08") continuam no banco, e contá-las aqui seria
 * repetir o acidente da v1.65.0 na troca de formato: o ambiente pareceria "já iniciado", a
 * pergunta "a semana passada foi apurada?" responderia NÃO (nenhuma semana nunca foi), e a
 * primeira subida do código semanal premiaria a tabela de hoje e zeraria a escada — no meio da
 * semana, por causa de um deploy. Ignorando as mensais, a primeira subida só SEMEIA a semana
 * anterior, e a primeira virada de verdade é a próxima segunda-feira.
 */
export async function existeTemporadaApurada() {
  const { rows } = await pool.query(
    `SELECT 1 FROM game_meta WHERE chave ~ '^pvp_temporada_[0-9]{4}-[0-9]{2}-[0-9]{2}$' LIMIT 1`,
  );
  return rows.length > 0;
}

/**
 * Marca uma competência como apurada SEM premiar e SEM zerar — a semente do ambiente.
 *
 * ### Por que isto precisa existir
 *
 * `verificarTemporadaPvp` pergunta "a temporada anterior já foi apurada?". Num banco que nunca
 * viu uma virada a resposta é não — para QUALQUER temporada —, então a primeira subida fecharia
 * a anterior por conta própria: premiaria com a tabela de hoje e zeraria a escada, no meio da
 * temporada, por causa de um deploy.
 *
 * Aconteceu de verdade, na subida da v1.65.0 em 11/09/2026: o processo fechou "2026-08", um mês
 * que nunca foi jogado. Não houve estrago porque o modo ainda não estava no ar e a tabela estava
 * vazia — mas se estivesse, a temporada de setembro teria ido embora sem pagar ninguém.
 *
 * A semente resolve pela raiz: ambiente sem histórico não VIRA nada, apenas registra onde a
 * contagem começa. A primeira virada de verdade passa a ser a próxima fronteira real (hoje, a
 * próxima segunda-feira, 00:00 de Brasília).
 */
export async function sementeDaTemporada(competencia) {
  const { rowCount } = await pool.query(
    `INSERT INTO game_meta (chave, valor) VALUES ($1, 'semente')
     ON CONFLICT (chave) DO NOTHING`,
    [marcaDaTemporada(competencia)],
  );
  return rowCount > 0;
}

/**
 * Recolhe os prêmios pendentes de um jogador — a caixa postal da temporada.
 *
 * Marca e devolve no MESMO comando: dois logins simultâneos (duas abas, dois shards) não podem
 * pagar duas vezes, e um `SELECT` seguido de `UPDATE` deixaria essa janela aberta. É o mesmo
 * desenho de `partidasNaoVistas`, logo acima.
 */
export async function recolherPremios(playerId) {
  const id = Number(playerId);
  if (!Number.isFinite(id)) return [];
  const { rows } = await pool.query(
    `UPDATE pvp_premios SET entregue_em = now()
      WHERE player_id = $1 AND entregue_em IS NULL
      RETURNING temporada, posicao, faixa, boosts, unidade`,
    [id],
  );
  return rows.map((r) => ({
    temporada: r.temporada,
    posicao: Number(r.posicao),
    faixa: r.faixa,
    boosts: typeof r.boosts === 'string' ? JSON.parse(r.boosts) : r.boosts,
    // 'dias' (a era mensal) ou 'horas' (a semanal). Ver o ALTER em `migrar`.
    unidade: r.unidade === 'horas' ? 'horas' : 'dias',
  }));
}

/** Quais destes jogadores têm prêmio esperando — uma consulta para o shard inteiro. */
export async function comPremioPendente(ids) {
  const lista = [...new Set((ids ?? []).map(Number).filter(Number.isFinite))];
  if (!lista.length) return new Set();
  const { rows } = await pool.query(
    `SELECT DISTINCT player_id FROM pvp_premios
      WHERE entregue_em IS NULL AND player_id = ANY($1::bigint[])`,
    [lista],
  );
  return new Set(rows.map((r) => Number(r.player_id)));
}

// ------------------------------------------------------------------ leitura

const linhaDeRank = (r) => ({
  playerId: Number(r.player_id),
  pontos: Number(r.pontos) || 0,
  pico: Number(r.pico) || 0,
  vitorias: Number(r.vitorias) || 0,
  derrotas: Number(r.derrotas) || 0,
  partidas: Number(r.partidas) || 0,
  sequencia: Number(r.sequencia) || 0,
  escudo: Number(r.escudo) || 0,
  tierTopo: Number(r.tier_topo) || 0,
  ultimaEm: r.ultima_em ?? null,
  nick: r.nick ?? undefined,
  looktype: r.looktype != null ? Number(r.looktype) : undefined,
  visual: r.visual ?? undefined,
  nivel: r.nivel != null ? Number(r.nivel) : undefined,
});

/**
 * A linha de rank de um jogador, CRIANDO-A na primeira leitura.
 *
 * O `INSERT … ON CONFLICT DO NOTHING` seguido de `SELECT` (em vez de um `RETURNING`) é o que
 * faz duas leituras concorrentes — a tela e o matchmaking no mesmo instante — devolverem a
 * mesma linha em vez de uma delas voltar vazia.
 */
export async function rankDe(playerId) {
  const id = Number(playerId);
  if (!Number.isFinite(id)) return null;
  await pool.query(
    `INSERT INTO pvp_rank (player_id) VALUES ($1) ON CONFLICT (player_id) DO NOTHING`,
    [id],
  );
  const { rows } = await pool.query(`SELECT * FROM pvp_rank WHERE player_id = $1`, [id]);
  return rows[0] ? linhaDeRank(rows[0]) : null;
}

/**
 * A linha de rank de OUTRO jogador, só lendo — a ficha pública do treinador.
 *
 * Diferente de `rankDe`, não cria a linha: abrir a ficha de alguém não é motivo para dar a ele
 * um lugar em `pvp_rank`. Quem nunca jogou volta `null`, e a tela diz "Não classificado".
 */
export async function rankPublicoDe(playerId) {
  const id = Number(playerId);
  if (!Number.isFinite(id)) return null;
  const { rows } = await pool.query(`SELECT * FROM pvp_rank WHERE player_id = $1`, [id]);
  return rows[0] ? linhaDeRank(rows[0]) : null;
}

/** As linhas de vários jogadores de uma vez — o matchmaking lê os dois lados num round-trip. */
export async function ranksDe(ids) {
  const lista = [...new Set((ids ?? []).map(Number).filter(Number.isFinite))];
  if (!lista.length) return new Map();
  await pool.query(
    `INSERT INTO pvp_rank (player_id)
       SELECT unnest($1::bigint[]) ON CONFLICT (player_id) DO NOTHING`,
    [lista],
  );
  const { rows } = await pool.query(
    `SELECT * FROM pvp_rank WHERE player_id = ANY($1::bigint[])`,
    [lista],
  );
  return new Map(rows.map((r) => [Number(r.player_id), linhaDeRank(r)]));
}

/**
 * O topo da tabela.
 *
 * Quem ainda está no posicionamento fica DE FORA (`partidas >= $2`): um jogador com uma
 * vitória e K dobrado apareceria em Ouro por meia hora sem ter provado nada, e uma tabela em
 * que isso acontece deixa de valer como referência.
 */
export async function ladder(limite, minimoPartidas) {
  const { rows } = await pool.query(
    `SELECT r.*, p.nick, p.looktype, p.visual, p.level AS nivel
       FROM pvp_rank r JOIN players p ON p.id = r.player_id
      WHERE r.partidas >= $2
      ORDER BY r.pontos DESC, r.vitorias DESC, r.player_id ASC
      LIMIT $1`,
    [Math.max(1, Math.min(200, Number(limite) || 50)), Math.max(0, Number(minimoPartidas) || 0)],
  );
  // A POSIÇÃO sai daqui, do índice da própria consulta, e não de uma segunda ida ao banco:
  // a ordem é a mesma de `posicaoNaLadder`, e é ela que decide quem é Challenger e quem é
  // Mestre (ver `rankComVaga`). Sem isso, a tabela desenharia o emblema errado no topo.
  return rows.map((r, i) => ({ ...linhaDeRank(r), posicao: i + 1 }));
}

/** Em que lugar da tabela este jogador está. `null` para quem ainda posiciona. */
export async function posicaoNaLadder(playerId, minimoPartidas) {
  const { rows } = await pool.query(
    `SELECT 1 + count(*) AS pos FROM pvp_rank r
      WHERE r.partidas >= $2
        AND (r.pontos, r.vitorias, -r.player_id) >
            (SELECT m.pontos, m.vitorias, -m.player_id FROM pvp_rank m WHERE m.player_id = $1)`,
    [Number(playerId), Math.max(0, Number(minimoPartidas) || 0)],
  );
  return rows[0] ? Number(rows[0].pos) : null;
}

/** Quantos jogadores estão classificados (para o "12º de 87"). */
export async function totalClassificados(minimoPartidas) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM pvp_rank WHERE partidas >= $1`,
    [Math.max(0, Number(minimoPartidas) || 0)],
  );
  return rows[0]?.n ?? 0;
}

/** As últimas partidas de um jogador, já do ponto de vista DELE. */
export async function historico(playerId, limite = 12) {
  const id = Number(playerId);
  const { rows } = await pool.query(
    `SELECT * FROM pvp_partidas
      WHERE a_id = $1 OR b_id = $1
      ORDER BY criado_em DESC, id DESC LIMIT $2`,
    [id, Math.max(1, Math.min(50, Number(limite) || 12))],
  );
  return rows.map((r) => {
    const souA = Number(r.a_id) === id;
    return {
      id: Number(r.id),
      oponente: souA ? r.b_nick : r.a_nick,
      oponentePontos: souA ? Number(r.b_antes) : Number(r.a_antes),
      antes: souA ? Number(r.a_antes) : Number(r.b_antes),
      delta: souA ? Number(r.a_delta) : Number(r.b_delta),
      venci: souA ? r.venceu_a : !r.venceu_a,
      motivo: r.motivo,
      duracaoMs: Number(r.duracao_ms) || 0,
      peso: Number(r.peso) || 1,
      visto: souA ? r.a_visto : r.b_visto,
      criadoEm: r.criado_em,
    };
  });
}

/**
 * Partidas que o jogador ainda NÃO viu — a caixa postal de quem caiu no meio.
 *
 * Marca como vistas na mesma consulta: se o pacote se perder no caminho de volta, o resumo
 * ainda está no histórico. Mostrar duas vezes o mesmo "você perdeu 14 pontos" seria pior.
 */
export async function partidasNaoVistas(playerId, limite = 5) {
  const id = Number(playerId);
  const { rows } = await pool.query(
    `UPDATE pvp_partidas SET a_visto = (a_id = $1) OR a_visto, b_visto = (b_id = $1) OR b_visto
      WHERE id IN (
        SELECT id FROM pvp_partidas
         WHERE (a_id = $1 AND NOT a_visto) OR (b_id = $1 AND NOT b_visto)
         ORDER BY criado_em DESC, id DESC LIMIT $2)
      RETURNING *`,
    [id, Math.max(1, Math.min(20, Number(limite) || 5))],
  );
  return rows
    .map((r) => {
      const souA = Number(r.a_id) === id;
      return {
        id: Number(r.id),
        oponente: souA ? r.b_nick : r.a_nick,
        antes: souA ? Number(r.a_antes) : Number(r.b_antes),
        delta: souA ? Number(r.a_delta) : Number(r.b_delta),
        venci: souA ? r.venceu_a : !r.venceu_a,
        criadoEm: r.criado_em,
      };
    })
    .sort((x, y) => new Date(x.criadoEm) - new Date(y.criadoEm));
}

// ------------------------------------------------------------------ a equipe

/** A linha crua de `player_pokemon` vira o objeto que a simulação entende. */
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

const SQL_POKEMON = `
  SELECT pp.id AS pk_id, pp.player_id, pp.species_id, pp.level, pp.quality, pp.ivs,
         pp.shiny, pp.potencia, pp.tm_elemental, pp.bonus_base
    FROM player_pokemon pp
   WHERE pp.anuncio_id IS NULL`;

/** Os ids que o jogador salvou, na ORDEM escolhida (o primeiro abre a partida). */
export async function timeSalvo(playerId) {
  const { rows } = await pool.query(
    `SELECT pokemon_ids FROM pvp_time WHERE player_id = $1`,
    [Number(playerId)],
  );
  if (!rows[0]) return [];
  const arr = typeof rows[0].pokemon_ids === 'string'
    ? JSON.parse(rows[0].pokemon_ids)
    : rows[0].pokemon_ids;
  return (arr ?? []).map(Number).filter(Number.isFinite);
}

/**
 * As LINHAS CRUAS da equipe de PvP, na ordem salva — para a ficha pública do treinador.
 *
 * Devolve `player_pokemon.*` e não o objeto de `pokemonDaLinha` de propósito: quem monta a
 * ficha que vai à tela é o sim, com o mesmo `montarPokemon` + `empacotarFichaResposta` que a
 * vitrine usa. É isso que faz os cards da equipe saírem IDÊNTICOS aos da vitrine — mesmos
 * selos, mesma ordem de atributos, mesmo clique abrindo a mesma ficha. Empacotar aqui de outro
 * jeito criaria um segundo formato de card que divergiria do primeiro no dia seguinte.
 *
 * O `player_id` no WHERE é a trava de posse, e não sobra de filtro: um id gravado antes de uma
 * venda traria o pokémon do COMPRADOR para a equipe de quem vendeu. `anuncio_id IS NULL` tira
 * quem está em escrow no Mercado — ele também não lutaria.
 */
export async function timePublicoLinhas(playerId) {
  const ids = await timeSalvo(playerId);
  if (!ids.length) return [];
  const { rows } = await pool.query(
    `SELECT pp.* FROM player_pokemon pp
       JOIN unnest($2::bigint[]) WITH ORDINALITY AS o(id, pos) ON o.id = pp.id
      WHERE pp.player_id = $1 AND pp.anuncio_id IS NULL
      ORDER BY o.pos`,
    [Number(playerId), ids.slice(0, PVP_TIME_MAX)],
  );
  return rows;
}

/**
 * A regra de uma equipe de PvP, sem gravar nada: ids sem repetição, no máximo `PVP_TIME_MAX`, e
 * todos do jogador e fora do Mercado. Devolve os ids na ordem pedida, ou lança `ErroPvp`.
 *
 * Sai de `salvarTime` porque a equipe do CAMPEONATO segue exatamente a mesma regra — a luta é a
 * mesma — e duas cópias dela divergiriam na primeira mudança.
 */
export async function conferirTime(playerId, pokemonIdsRaw, { campeonato = null } = {}) {
  const pedidos = [...new Set(
    (Array.isArray(pokemonIdsRaw) ? pokemonIdsRaw : [])
      .filter((v) => typeof v === 'number' || typeof v === 'string')
      .map(Number)
      .filter((n) => Number.isSafeInteger(n) && n > 0),
  )];
  if (pedidos.length > PVP_TIME_MAX) {
    throw new ErroPvp('cheio', `Máximo de ${PVP_TIME_MAX} pokémon na equipe de PvP.`);
  }

  if (pedidos.length) {
    const { rows } = await pool.query(
      `${SQL_POKEMON} AND pp.player_id = $1 AND pp.id = ANY($2::bigint[])`,
      [Number(playerId), pedidos],
    );
    // A conferência é de POSSE: pedir o id do pokémon de outro jogador (ou um já anunciado no
    // Mercado) some da consulta e cai aqui, em vez de virar um lutador emprestado na arena.
    if (rows.length !== pedidos.length) {
      throw new ErroPvp('sumiu', 'Um ou mais pokémon não estão mais disponíveis.');
    }
    // A RESTRIÇÃO do campeonato (o Amador não aceita shiny nem P5). Conferida aqui, contra as
    // linhas que acabaram de vir do banco, e não contra o que o cliente mandou: o seletor da
    // tela esconde os proibidos por educação, e esconder não é recusar.
    if (campeonato) {
      for (const r of rows) {
        const motivo = porQueNaoPodeLutar({ shiny: r.shiny, potencia: r.potencia }, campeonato);
        if (motivo) throw new ErroPvp('restrito', motivo);
      }
    }
  }
  return pedidos;
}

/**
 * Grava a equipe de PvP.
 *
 * Tudo é reconferido contra o banco — o seletor do cliente é conveniência, não autoridade.
 * `[]` é escolha válida (é como se sai da fila de vez), e nada aqui olha para o tipo do
 * pokémon: o PvP ranqueado não tem restrição de tipo, ao contrário do ginásio.
 */
export async function salvarTime(playerId, pokemonIdsRaw) {
  const pedidos = await conferirTime(playerId, pokemonIdsRaw);
  await pool.query(
    `INSERT INTO pvp_time (player_id, pokemon_ids, atualizado_em)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (player_id) DO UPDATE
       SET pokemon_ids = EXCLUDED.pokemon_ids, atualizado_em = now()`,
    [Number(playerId), JSON.stringify(pedidos)],
  );
  return { pokemonIds: pedidos };
}

/**
 * As equipes dos DOIS lados da partida, lidas no instante do pareamento.
 *
 * Lidas agora, e não no momento em que entraram na fila, porque a fila pode durar minutos e
 * o jogador continua caçando enquanto espera — a equipe que luta é a que ele tem AGORA. Um
 * pokémon vendido ou anunciado no Mercado no meio da espera simplesmente não vem, e quem
 * decide o que fazer com um lado vazio é o matchmaking (ver `montarLado`).
 *
 * `escolhidas` (`Map<playerId, id[]>`) passa NA FRENTE da equipe salva no PvP: é a equipe que o
 * jogador escolheu para outra competição (a do Campeonato). Lista vazia ou ausente = vale a do PvP.
 *
 * @returns `Map<playerId, pokemon[]>` na ordem salva pelo jogador
 */
export async function equipesDaPartida(ids, { escolhidas = null, campeonato = null } = {}) {
  const lista = [...new Set((ids ?? []).map(Number).filter(Number.isFinite))];
  if (!lista.length) return new Map();

  const { rows: linhasTime } = await pool.query(
    `SELECT player_id, pokemon_ids FROM pvp_time WHERE player_id = ANY($1::bigint[])`,
    [lista],
  );

  const ordemPor = new Map();
  for (const l of linhasTime) {
    const arr = typeof l.pokemon_ids === 'string' ? JSON.parse(l.pokemon_ids) : l.pokemon_ids;
    ordemPor.set(Number(l.player_id), (arr ?? []).map(Number).filter(Number.isFinite).slice(0, PVP_TIME_MAX));
  }
  for (const [pid, arr] of escolhidas ?? []) {
    const ids2 = (arr ?? []).map(Number).filter(Number.isFinite).slice(0, PVP_TIME_MAX);
    if (ids2.length && lista.includes(Number(pid))) ordemPor.set(Number(pid), ids2);
  }
  const todosIds = new Set([...ordemPor.values()].flat());
  if (!todosIds.size) return new Map(lista.map((id) => [id, []]));

  const { rows } = await pool.query(
    `${SQL_POKEMON} AND pp.id = ANY($1::bigint[])`,
    [[...todosIds]],
  );
  const porId = new Map();
  for (const r of rows) {
    const pk = pokemonDaLinha(r);
    if (pk) porId.set(pk.id, { ...pk, donoId: Number(r.player_id) });
  }

  const saida = new Map();
  for (const id of lista) {
    const ordem = ordemPor.get(id) ?? [];
    // O DONO é conferido aqui, e não no `WHERE`: sem isso, um id gravado antes de uma venda
    // traria o pokémon do COMPRADOR para a equipe de quem vendeu.
    //
    // A RESTRIÇÃO do campeonato entra no mesmo filtro, e não numa etapa à parte, porque ela é a
    // mesma coisa: um pokémon que não pode lutar aqui é tão inexistente para esta partida
    // quanto um que foi vendido. O caso que ela resolve é o do inscrito que NÃO escolheu equipe
    // e cai na do PvP Ranqueado — se ela tiver um shiny, o Amador teria de recusá-lo, e recusar
    // no congelamento (em vez de no clique) é o único momento em que dá: o jogador pode ter
    // capturado o shiny depois de se inscrever.
    saida.set(id, ordem
      .map((pkId) => porId.get(pkId))
      .filter((pk) => pk && pk.donoId === id && !porQueNaoPodeLutar(pk, campeonato)));
  }
  return saida;
}

// ------------------------------------------------------------------ escrita

/**
 * Grava o resultado de uma partida: as duas linhas de rank e o resumo, numa transação só.
 *
 * Numa transação porque as duas metades são o mesmo fato. Meia partida gravada — o vencedor
 * subiu e o perdedor não desceu — é um furo de soma zero que ninguém descobriria até a
 * tabela já estar inflada.
 *
 * @param a `{ playerId, nick, antes, depois, escudo, tierTopo, delta, venceu }`
 * @param b idem
 */
export async function gravarPartida(a, b, extra = {}) {
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    for (const lado of [a, b]) {
      await cli.query(
        `UPDATE pvp_rank
            SET pontos = $2,
                pico = GREATEST(pico, $2),
                vitorias = vitorias + $3,
                derrotas = derrotas + $4,
                partidas = partidas + 1,
                -- A sequência é reiniciada quando o sinal vira: 3 vitórias seguidas viram -1
                -- na primeira derrota, e não 2. É o "3V" / "2D" que a tela mostra.
                sequencia = CASE WHEN $3 = 1 THEN GREATEST(sequencia, 0) + 1
                                 ELSE LEAST(sequencia, 0) - 1 END,
                escudo = $5,
                tier_topo = $6,
                ultima_em = now(),
                atualizado_em = now()
          WHERE player_id = $1`,
        [lado.playerId, lado.depois, lado.venceu ? 1 : 0, lado.venceu ? 0 : 1,
         lado.escudo, lado.tierTopo],
      );
    }
    const { rows } = await cli.query(
      `INSERT INTO pvp_partidas
         (a_id, b_id, a_nick, b_nick, a_antes, b_antes, a_delta, b_delta,
          venceu_a, motivo, duracao_ms, peso, detalhe)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, criado_em`,
      [a.playerId, b.playerId, a.nick, b.nick, a.antes, b.antes, a.delta, b.delta,
       !!a.venceu, extra.motivo ?? 'wipe', Math.round(extra.duracaoMs ?? 0), extra.peso ?? 1,
       // A ficha entra como JSON puro; `null` quando a fita não deu para analisar. O `JSON
       // .stringify` é feito aqui (e não pelo driver) para que um objeto inesperado estoure
       // AGORA, na transação da partida, e não vire uma coluna com "[object Object]".
       extra.detalhe ? JSON.stringify(extra.detalhe) : null],
    );
    await cli.query('COMMIT');
    return { id: Number(rows[0].id), criadoEm: rows[0].criado_em };
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}

/**
 * Derruba para o Diamante quem ficou `PVP_DECAIMENTO_MS` sem partida com pontos de elite.
 *
 * Os pontos novos são "um acima do primeiro Diamante" (`pontosAposDecaimento`): o maior PR abaixo
 * de `PVP_PR_ELITE`, lido na mesma transação. Quem cai vira o topo do Diamante, e sai do alto da
 * tabela — que era o que faltava quando a queda era só de emblema.
 *
 * ### Idempotente sem marca nenhuma
 *
 * O filtro é `pontos >= PVP_PR_ELITE`, e o resultado é sempre menor que isso. Rodar de novo no
 * segundo seguinte não acha ninguém; só volta a achar o jogador se ele jogar, voltar aos 1.500 e
 * sumir outro dia inteiro.
 *
 * ### Dois processos, e a partida no meio
 *
 * `FOR UPDATE` nas linhas candidatas: um segundo processo que rodasse junto espera, relê a linha
 * já rebaixada e a descarta pelo próprio `WHERE`. Uma partida gravada no mesmo instante também
 * espera — e grava por cima o número que calculou antes. É o desfecho certo: se a partida
 * aconteceu, o jogador estava jogando.
 *
 * @returns `[{ playerId, nick, antes, pontos }]` — quem caiu, para avisar o shard de cada um.
 */
export async function aplicarDecaimento() {
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    // Na ordem da TABELA (a mesma de `ladder`), para o degrau de cada um sair dela.
    const { rows: caidos } = await cli.query(
      `SELECT r.player_id, r.pontos, p.nick
         FROM pvp_rank r JOIN players p ON p.id = r.player_id
        WHERE r.partidas >= $1
          AND r.pontos >= $2
          AND r.ultima_em IS NOT NULL
          AND r.ultima_em < now() - ($3::bigint * INTERVAL '1 millisecond')
        ORDER BY r.pontos DESC, r.vitorias DESC, r.player_id ASC
          FOR UPDATE OF r`,
      [PVP_PARTIDAS_POSICIONAMENTO, PVP_PR_ELITE, PVP_DECAIMENTO_MS],
    );
    if (!caidos.length) {
      await cli.query('COMMIT');
      return [];
    }

    // O primeiro Diamante é lido DEPOIS da trava: dois processos em fila não calculam o degrau
    // contra a mesma foto.
    const { rows: topo } = await cli.query(
      `SELECT max(pontos)::int AS p FROM pvp_rank WHERE partidas >= $1 AND pontos < $2`,
      [PVP_PARTIDAS_POSICIONAMENTO, PVP_PR_ELITE],
    );
    const topoDiamante = topo[0]?.p ?? 0;

    const saida = caidos.map((c, i) => ({
      playerId: Number(c.player_id),
      nick: c.nick,
      antes: Number(c.pontos),
      // O último da lista (o de menos pontos) fica logo acima do primeiro Diamante; cada um
      // acima dele, um ponto a mais — a ordem entre os que caíram juntos sobrevive à queda.
      pontos: pontosAposDecaimento(topoDiamante, caidos.length - i),
    }));
    await cli.query(
      `UPDATE pvp_rank r
          SET pontos = n.pontos, atualizado_em = now()
         FROM unnest($1::bigint[], $2::int[]) AS n(player_id, pontos)
        WHERE r.player_id = n.player_id`,
      [saida.map((s) => s.playerId), saida.map((s) => s.pontos)],
    );
    await cli.query('COMMIT');
    return saida;
  } catch (err) {
    await cli.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}

/** Marca como vista a partida que o jogador acabou de assistir ao vivo. */
export async function marcarVista(playerId, partidaId) {
  const id = Number(playerId);
  await pool.query(
    `UPDATE pvp_partidas
        SET a_visto = a_visto OR (a_id = $1), b_visto = b_visto OR (b_id = $1)
      WHERE id = $2`,
    [id, Number(partidaId)],
  );
}

/** Faxina do histórico. Roda no mesmo relógio horário que a das DMs e a do chat. */
export async function limparPartidasAntigas() {
  const { rowCount } = await pool.query(
    `DELETE FROM pvp_partidas WHERE criado_em < now() - ($1 || ' days')::interval`,
    [String(RETENCAO_PARTIDAS_DIAS)],
  );
  return rowCount ?? 0;
}

/**
 * O rank empacotado do jeito que a tela desenha — a linha crua mais o que dela se deriva.
 *
 * Fica AQUI, e não no cliente, por um motivo só: o mesmo objeto vai para a tela do dono, para
 * a tabela e para a ficha do oponente. Três montagens do mesmo dado seriam três lugares para
 * esquecer de somar o posicionamento.
 *
 * `posicao` não é enfeite: acima de `PVP_PR_ELITE` é ela que decide entre Challenger, Mestre
 * e "tem os pontos, espera vaga". Sem ela, todo mundo no topo sairia como Diamante I.
 *
 * `comPrazo` põe junto `decaiEm`, o instante em que a elite cai por inatividade — o timer da
 * tela. Só no rank do PRÓPRIO jogador: na tabela e na ficha pública ele diria a qualquer um
 * a que horas o outro jogou pela última vez.
 */
export function rankParaCliente(linha, posicao = null, { comPrazo = false } = {}) {
  if (!linha) return null;
  // Quem ainda posiciona não tem posição na tabela — e, portanto, não tem vaga de elite.
  const pos = linha.partidas >= PVP_PARTIDAS_POSICIONAMENTO ? (posicao ?? linha.posicao ?? 0) : 0;
  // O decaimento é lido da MESMA coluna que a consulta de posição usa para cortar. As duas
  // leituras têm de concordar, senão a ficha diz "Challenger" enquanto a tabela já deu a vaga
  // a outro: aqui o emblema cai, e lá a cadeira é liberada.
  const inativo = vagaDecaiu(linha.ultimaEm);
  const r = rankComVaga(linha.pontos, pos, { inativo });
  return {
    posicao: pos || null,
    aguardandoVaga: !!r.aguardandoVaga,
    vagaDecaiu: !!r.vagaDecaiu,
    faltamPosicoes: r.faltamPosicoes ?? null,
    ...(comPrazo ? { decaiEm: decaiEm(linha.ultimaEm, r.tierId) } : {}),
    pontos: linha.pontos,
    pico: linha.pico,
    vitorias: linha.vitorias,
    derrotas: linha.derrotas,
    partidas: linha.partidas,
    sequencia: linha.sequencia,
    escudo: linha.escudo,
    tierId: r.tierId,
    divisao: r.divisao,
    divisaoNum: r.divisaoNum,
    de: r.de,
    ate: Number.isFinite(r.ate) ? r.ate : null,
    progresso: r.progresso,
    naFaixa: r.naFaixa,
    larguraFaixa: r.larguraFaixa,
    nick: linha.nick,
    looktype: linha.looktype,
    visual: linha.visual,
  };
}
