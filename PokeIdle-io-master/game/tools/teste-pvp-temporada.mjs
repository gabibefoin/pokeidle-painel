// A TEMPORADA DO PvP contra o Postgres de verdade — prêmio, reset e as duas idempotências.
//
// `teste-pvp-rank.mjs` cobre a aritmética da escada com objetos em memória. Este cobre o que
// só quebra no banco, e que é exatamente onde uma temporada dá errado:
//
//   · a transação que premia E zera — se ela partisse ao meio, ou o mês de disputa evaporava
//     sem prêmio, ou os prêmios seriam pagos de novo na tentativa seguinte;
//   · a marca da competência, que faz a VIRADA rodar uma vez só mesmo com dois shards
//     acordando no mesmo segundo;
//   · o `UPDATE … RETURNING` de `recolherPremios`, que faz a ENTREGA acontecer uma vez só
//     mesmo com login e varredura disputando o mesmo jogador;
//   · o corte por decaimento, que tira da foto quem já tinha perdido a vaga por sumir;
//   · a SEMANA: a chave da temporada é a segunda-feira de Brasília, a virada é às 00:00 BRT,
//     e a troca de formato (mensal → semanal) não pode virar nada sozinha no deploy.
//
// Cria os próprios jogadores (nick `_pvpts_*`) e APAGA tudo no fim, inclusive a marca da
// competência de teste em `game_meta`. Precisa do Postgres de pé:
//
//   docker compose up -d && node tools/teste-pvp-temporada.mjs

import { pool } from '../src/server/db.mjs';
import * as pvpdb from '../src/server/pvp-ranqueado-db.mjs';
import {
  _testeResetarCache,
  entregarPremiosPvp,
  verificarTemporadaPvp,
} from '../src/server/game/pvp-temporada.mjs';
import {
  PVP_DECAIMENTO_HORAS,
  PVP_DECAIMENTO_MS,
  PVP_PARTIDAS_POSICIONAMENTO,
  PVP_VAGAS_CHALLENGER,
  PVP_VAGAS_MESTRE,
  fimDaTemporada,
  inicioDaTemporada,
  premioDaPosicao,
  temporadaAnterior,
  temporadaDe,
} from '../src/shared/pvp-rank.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const PREFIXO = `_pvpts_${Date.now().toString(36)}`;
// Uma competência que NUNCA existirá de verdade, para não colidir com a marca de uma semana real
// caso este teste rode num banco que já virou temporada. No formato semanal (uma segunda-feira).
const COMPETENCIA = '1999-12-27';
const HORA_MS = 60 * 60_000;
const criados = [];

async function criarJogador(sufixo, { pontos, partidas = PVP_PARTIDAS_POSICIONAMENTO, diasSemJogar = 0 }) {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level) VALUES ($1, 200) RETURNING id`,
    [`${PREFIXO}_${sufixo}`],
  );
  const id = Number(rows[0].id);
  criados.push(id);
  await pool.query(
    `INSERT INTO pvp_rank (player_id, pontos, pico, vitorias, partidas, ultima_em)
     VALUES ($1, $2, $2, $3, $3, now() - ($4::bigint * INTERVAL '1 millisecond'))`,
    [id, pontos, partidas, Math.round(diasSemJogar * 24 * 60 * 60_000)],
  );
  return id;
}

async function limpar() {
  if (criados.length) {
    await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [criados]);
  }
  await pool.query(`DELETE FROM game_meta WHERE chave = $1`, [`pvp_temporada_${COMPETENCIA}`]);
}

async function main() {
  await pvpdb.migrar();

  // A escada zera para TODO MUNDO na virada, então este teste não pode rodar num banco com
  // gente de verdade jogando — o que num banco de dev é aceitável, e em produção é o ponto.
  const { rows: antes } = await pool.query(`SELECT count(*)::int AS n FROM pvp_rank WHERE pontos > 0`);

  secao('A semana vira segunda-feira, 00:00 de Brasília');
  {
    const c = (iso) => temporadaDe(Date.parse(iso));
    ok(c('2026-09-21T02:59:59Z') === '2026-09-14', 'domingo 23:59:59 em Brasília ainda é a semana de 14/09',
      c('2026-09-21T02:59:59Z'));
    ok(c('2026-09-21T03:00:00Z') === '2026-09-21', 'segunda 00:00 em Brasília (03:00 UTC) já é a semana nova',
      c('2026-09-21T03:00:00Z'));
    ok(c('2026-09-18T20:00:00Z') === '2026-09-14', 'uma sexta cai na segunda-feira da própria semana');
    ok(new Date(`${c('2026-09-18T20:00:00Z')}T00:00:00Z`).getUTCDay() === 1, 'e a chave é sempre uma segunda-feira');
    ok(temporadaAnterior('2026-09-21') === '2026-09-14', 'a anterior é sete dias antes');
    ok(temporadaAnterior('2026-01-05') === '2025-12-29', 'e atravessa a virada do ano');
    ok(inicioDaTemporada('2026-09-14') === Date.parse('2026-09-14T03:00:00Z'), 'começa segunda às 03:00 UTC');
    ok(fimDaTemporada('2026-09-14') === Date.parse('2026-09-21T03:00:00Z'), 'e acaba na segunda seguinte, mesma hora');
    ok(PVP_DECAIMENTO_HORAS === 24, 'o decaimento de Mestre/Challenger é de um dia', `${PVP_DECAIMENTO_HORAS} h`);
  }

  secao('A foto da temporada');
  const campeao = await criarJogador('campeao', { pontos: 2000 });
  const segundo = await criarJogador('segundo', { pontos: 1900 });
  const terceiro = await criarJogador('terceiro', { pontos: 1800 });
  const quarto = await criarJogador('quarto', { pontos: 1700 });
  // Sumiu há um dia e uma hora — passou do decaimento: tinha pontos de elite e já tinha caído
  // para o Diamante antes da virada.
  const sumido = await criarJogador('sumido', {
    pontos: 1950, diasSemJogar: (PVP_DECAIMENTO_MS + HORA_MS) / 86_400_000,
  });
  // Jogou há 20 horas: ainda dentro do dia, ainda conta. É o 5º da foto.
  const ontem = await criarJogador('ontem', { pontos: 1650, diasSemJogar: 20 / 24 });
  // Ainda posicionando: não está na tabela e não disputa nada.
  const novato = await criarJogador('novato', { pontos: 1600, partidas: 1 });

  const r = await pvpdb.virarTemporada(COMPETENCIA);
  ok(r.virou === true, 'a virada aconteceu', JSON.stringify(r));
  ok(r.premiados >= 4, 'premiou pelo menos os quatro da frente', `${r.premiados}`);

  secao('Quem levou o quê');
  const premioDe = async (id) => {
    const { rows } = await pool.query(
      `SELECT posicao, faixa, boosts, unidade FROM pvp_premios WHERE player_id = $1 AND temporada = $2`,
      [id, COMPETENCIA],
    );
    return rows[0] ?? null;
  };
  const pC = await premioDe(campeao);
  ok(pC?.faixa === 'podio', 'o 1º leva o prêmio de pódio', pC?.faixa);
  ok(
    pC && Number(pC.boosts.shiny) === 48 && Number(pC.boosts.captura) === 48,
    'e o pódio leva shiny e captura por 48 horas (dois dias)',
    JSON.stringify(pC?.boosts),
  );
  ok(pC?.unidade === 'horas', 'e o registro diz que o número é em HORAS', pC?.unidade);
  const p4 = await premioDe(quarto);
  ok(p4?.faixa === 'challenger', 'o 4º cai na faixa do Challenger', p4?.faixa);
  ok(
    p4 && Number(p4.boosts.shiny) === 18 && Number(p4.boosts.captura) === 18,
    'e leva os mesmos dois boosts, por 18 horas',
    JSON.stringify(p4?.boosts),
  );
  const p5 = await premioDe(ontem);
  ok(p5?.posicao === 5 && p5?.faixa === 'challenger', 'quem jogou há 20 horas ainda entra (5º, Challenger)',
    JSON.stringify(p5));
  ok(await premioDe(sumido) === null, 'quem passou de 24 h sem jogar NÃO entra na foto (caiu para o Diamante)');
  ok(await premioDe(novato) === null, 'quem ainda posiciona também não entra');

  secao('As faixas, na régua do shared');
  ok(premioDaPosicao(PVP_VAGAS_CHALLENGER)?.faixa === 'challenger', `o ${PVP_VAGAS_CHALLENGER}º ainda é Challenger`);
  ok(premioDaPosicao(PVP_VAGAS_CHALLENGER + 1)?.faixa === 'mestre', `e o ${PVP_VAGAS_CHALLENGER + 1}º já é Mestre`);
  ok(premioDaPosicao(PVP_VAGAS_MESTRE)?.faixa === 'mestre', `o ${PVP_VAGAS_MESTRE}º é o último premiado`);
  ok(premioDaPosicao(PVP_VAGAS_MESTRE + 1) === null, `e o ${PVP_VAGAS_MESTRE + 1}º não leva nada`);

  secao('O reset');
  const { rows: depois } = await pool.query(
    `SELECT pontos, partidas, ultima_em FROM pvp_rank WHERE player_id = $1`, [campeao],
  );
  ok(Number(depois[0].pontos) === 0, 'o campeão voltou a 0 PR', `${depois[0].pontos}`);
  ok(Number(depois[0].partidas) === 0, 'e ao posicionamento (partidas zeradas)');
  ok(depois[0].ultima_em === null, 'e sem carimbo de última partida — o decaimento recomeça limpo');
  const { rows: sobrou } = await pool.query(`SELECT count(*)::int AS n FROM pvp_rank WHERE pontos > 0`);
  ok(sobrou[0].n === 0, 'ninguém sobrou com PR na tabela', `${sobrou[0].n} (antes: ${antes[0].n})`);

  secao('A virada roda UMA vez');
  const r2 = await pvpdb.virarTemporada(COMPETENCIA);
  ok(r2.virou === false, 'a segunda chamada não vira nada', JSON.stringify(r2));
  ok(await pvpdb.temporadaApurada(COMPETENCIA) === true, 'e a competência fica marcada como apurada');

  secao('A queda por inatividade, no banco');
  {
    // A escada acabou de zerar: só os jogadores daqui têm pontos, e a conta é previsível.
    const d1 = await criarJogador('dia1', { pontos: 1400, partidas: 30, diasSemJogar: 1 / 24 });
    await criarJogador('dia2', { pontos: 1300, partidas: 30, diasSemJogar: 1 / 24 });
    const sumA = await criarJogador('sumA', { pontos: 1978, partidas: 60, diasSemJogar: 25 / 24 });
    const sumB = await criarJogador('sumB', { pontos: 1700, partidas: 60, diasSemJogar: 30 / 24 });
    const ativo = await criarJogador('ativo', { pontos: 1949, partidas: 60, diasSemJogar: 2 / 24 });
    // 23h59: ainda dentro do dia. Não cai.
    const quase = await criarJogador('quase', { pontos: 1600, partidas: 60, diasSemJogar: (24 * 60 - 1) / (24 * 60) });

    const caidos = await pvpdb.aplicarDecaimento();
    const porId = new Map(caidos.map((c) => [c.playerId, c]));
    ok(caidos.length === 2, 'caíram os dois que passaram de 24 h', JSON.stringify(caidos));
    ok(porId.get(sumA)?.antes === 1978 && porId.get(sumA)?.pontos === 1402,
      'o de 1.978 cai para 1.402 — acima do primeiro Diamante (1.400) e do outro que caiu junto',
      JSON.stringify(porId.get(sumA)));
    ok(porId.get(sumB)?.pontos === 1401, 'o de 1.700 cai para 1.401 — um acima do primeiro Diamante',
      JSON.stringify(porId.get(sumB)));
    ok(String(porId.get(sumA)?.nick ?? '').endsWith('_sumA'), 'e o nick vem junto, para avisar o shard dono');

    const pontosDe = async (id) =>
      Number((await pool.query(`SELECT pontos FROM pvp_rank WHERE player_id = $1`, [id])).rows[0].pontos);
    ok(await pontosDe(sumA) === 1402, 'o banco gravou os pontos novos');
    ok(await pontosDe(ativo) === 1949, 'quem jogou há 2 horas não foi tocado');
    ok(await pontosDe(quase) === 1600, 'nem quem está a um minuto do prazo');
    ok(await pontosDe(d1) === 1400, 'nem o primeiro Diamante');

    const tabela = (await pvpdb.ladder(10, PVP_PARTIDAS_POSICIONAMENTO)).filter((l) => criados.includes(l.playerId));
    ok(tabela.map((l) => l.pontos).join(',') === '1949,1600,1402,1401,1400,1300',
      'na tabela, quem caiu fica abaixo da elite e logo acima do primeiro Diamante',
      tabela.map((l) => l.pontos).join(','));
    const rotulos = tabela.map((l) => pvpdb.rankParaCliente(l, l.posicao).tierId);
    ok(rotulos.slice(0, 2).every((x) => x === 'challenger'), 'os dois ativos ficam com as vagas do Challenger',
      rotulos.join(','));
    ok(rotulos.slice(2).every((x) => x === 'diamante'), 'e quem caiu é Diamante de verdade', rotulos.join(','));

    ok((await pvpdb.aplicarDecaimento()).length === 0, 'rodar de novo não derruba ninguém duas vezes');

    // Dois processos na mesma passada: a trava de linha deixa só um deles derrubar.
    await criarJogador('sumC', { pontos: 1800, partidas: 60, diasSemJogar: 2 });
    const [x, y] = await Promise.all([pvpdb.aplicarDecaimento(), pvpdb.aplicarDecaimento()]);
    ok(x.length + y.length === 1, 'duas passadas simultâneas derrubam o jogador UMA vez',
      `${x.length} + ${y.length}`);
    ok([...x, ...y][0]?.pontos === 1403, 'e ele cai para um acima do novo primeiro Diamante (1.402)',
      JSON.stringify([...x, ...y]));

    secao('O relógio vai só para o dono');
    const linhaAtivo = await pvpdb.rankDe(ativo);
    const comPrazo = pvpdb.rankParaCliente(linhaAtivo, 1, { comPrazo: true });
    const esperado = new Date(linhaAtivo.ultimaEm).getTime() + PVP_DECAIMENTO_MS;
    ok(comPrazo.tierId === 'challenger' && comPrazo.decaiEm === esperado,
      'o Challenger recebe o instante da queda: última partida + 24 h', `${comPrazo.decaiEm} vs ${esperado}`);
    ok(!('decaiEm' in pvpdb.rankParaCliente(linhaAtivo, 1)),
      'na tabela e na ficha pública o campo nem existe — não entrega a hora em que o outro jogou');
    const linhaDia = await pvpdb.rankDe(d1);
    ok(pvpdb.rankParaCliente(linhaDia, 5, { comPrazo: true }).decaiEm === null, 'Diamante não tem relógio');
  }

  secao('Ambiente sem histórico NÃO vira temporada sozinho');
  {
    // O caso real da subida da v1.65.0: num banco que nunca viu uma virada, "o mês anterior já
    // foi apurado?" responde NÃO para qualquer mês, e a primeira subida fechava o mês passado
    // por conta própria — premiando com a tabela de hoje e zerando a escada no meio do mês.
    const marcas = await pool.query(`SELECT chave FROM game_meta WHERE chave LIKE 'pvp_temporada_%'`);
    ok(await pvpdb.existeTemporadaApurada() === true,
      'com marca no banco, o ambiente é reconhecido como já iniciado', `${marcas.rowCount} marca(s)`);

    // Tira as marcas do caminho para simular um ambiente virgem, e devolve depois.
    const guardadas = marcas.rows.map((r) => r.chave);
    await pool.query(`DELETE FROM game_meta WHERE chave LIKE 'pvp_temporada_%'`);
    try {
      ok(await pvpdb.existeTemporadaApurada() === false, 'sem marca nenhuma, o ambiente é virgem');
      _testeResetarCache();
      // Sexta, 11/09/2026: a semana corrente é a de 07/09, e a anterior (a que seria fechada) a
      // de 31/08.
      const r = await verificarTemporadaPvp(Date.parse('2026-09-11T03:23:00Z'));
      ok(r?.semeado === true && r?.virou === false,
        'a primeira subida SEMEIA em vez de virar', JSON.stringify(r));
      ok(r?.premiados === 0 && r?.zerados === 0, 'e não premia nem zera ninguém');
      ok(await pvpdb.temporadaApurada('2026-08-31') === true,
        'a semana anterior fica marcada, para a próxima segunda-feira ser a primeira virada de verdade');
      const { rows: semente } = await pool.query(
        `SELECT valor FROM game_meta WHERE chave = 'pvp_temporada_2026-08-31'`,
      );
      ok(semente[0]?.valor === 'semente', 'e a marca diz que é semente, não apuração', semente[0]?.valor);

      // A TROCA DE FORMATO. Um banco que já virou temporadas MENSAIS tem marcas "AAAA-MM" — e
      // nenhuma semanal. Se as mensais contassem como histórico, o código novo perguntaria "a
      // semana passada foi apurada?", ouviria NÃO e fecharia a semana no meio, no deploy.
      await pool.query(`DELETE FROM game_meta WHERE chave LIKE 'pvp_temporada_%'`);
      await pool.query(`INSERT INTO game_meta (chave, valor) VALUES ('pvp_temporada_2026-08', 'semente')`);
      ok(await pvpdb.existeTemporadaApurada() === false,
        'só marca MENSAL no banco não conta como temporada semanal apurada');
      _testeResetarCache();
      const r2 = await verificarTemporadaPvp(Date.parse('2026-09-18T20:00:00Z'));
      ok(r2?.semeado === true && r2?.virou === false && r2?.zerados === 0,
        'e a primeira subida do código semanal SEMEIA — não fecha a semana no meio do deploy',
        JSON.stringify(r2));
      ok(await pvpdb.temporadaApurada('2026-09-07') === true,
        'a semana anterior (07/09) é a semente; a virada de verdade é segunda 21/09, 00:00 BRT');
    } finally {
      await pool.query(`DELETE FROM game_meta WHERE chave LIKE 'pvp_temporada_%'`);
      for (const c of guardadas) {
        await pool.query(`INSERT INTO game_meta (chave, valor) VALUES ($1, '0') ON CONFLICT DO NOTHING`, [c]);
      }
    }
  }

  secao('A entrega também roda UMA vez');
  const jogador = { dbId: campeao, boosts: {} };
  const agora = Date.now();
  const entregues = await entregarPremiosPvp(jogador, agora);
  ok(entregues.length === 1, 'o prêmio chega na primeira tentativa', `${entregues.length}`);
  const ateShiny = jogador.boosts.shiny;
  ok(
    ateShiny === agora + 48 * HORA_MS,
    'e o boost de shiny vale 48 horas a partir de agora',
    `${((ateShiny - agora) / HORA_MS).toFixed(1)} h`,
  );
  const denovo = await entregarPremiosPvp(jogador, agora);
  ok(denovo.length === 0, 'a segunda tentativa não entrega nada');
  ok(jogador.boosts.shiny === ateShiny, 'e o boost não foi estendido de novo');

  secao('Prêmio da era mensal (em DIAS) ainda vale dias');
  {
    // Um registro gravado antes da troca: sem a coluna `unidade` preenchida, ele cai no default
    // 'dias'. Lido como horas, "1" daria uma hora a quem ganhou um dia.
    await pool.query(
      `INSERT INTO pvp_premios (player_id, temporada, posicao, faixa, boosts)
       VALUES ($1, '1999-12', 1, 'podio', '{"xp": 1}'::jsonb)`,
      [campeao],
    );
    const velho = { dbId: campeao, boosts: {} };
    const t0 = Date.now();
    const r = await entregarPremiosPvp(velho, t0);
    ok(r.length === 1 && r[0].unidade === 'dias', 'o prêmio antigo sai marcado em dias', JSON.stringify(r));
    ok(velho.boosts.xp === t0 + 24 * HORA_MS, 'e "1" vira um dia de boost, não uma hora',
      `${((velho.boosts.xp - t0) / HORA_MS).toFixed(1)} h`);
  }

  secao('O prêmio NÃO consome a cota diária de boost');
  ok(jogador.boostsHoje === undefined, 'a cota do dia não foi tocada — prêmio não é compra');
}

main()
  .catch((err) => {
    falhas++;
    console.error('\n✗ o teste explodiu:', err.message);
  })
  .finally(async () => {
    await limpar().catch((err) => console.error('limpeza falhou:', err.message));
    await pool.end();
    console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
    process.exit(falhas ? 1 : 0);
  });
