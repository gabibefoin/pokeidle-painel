// Teste das PARTIDAS DO CAMPEONATO — com Postgres e Redis, sem o servidor do jogo.
//
// Joga um campeonato inteiro de mentira (id próprio, datas no passado) com contas reais do banco
// local, pelo MESMO `avancarCampeonato` que o tick chama, com um relógio que anda de onda em onda.
// O que ele protege:
//
//   · **a chave anda sozinha até o fim**, onda a onda, e termina com campeão, vice e 3º;
//   · **o relógio das ondas**: antes do intervalo vencer, nada é jogado — e a mesma onda não é
//     jogada duas vezes, nem com duas chamadas no mesmo instante;
//   · **a eliminação dupla no banco**: 2n−2 partidas gravadas, dois W.O. para quem ficou sem equipe
//     e duas derrotas para todo eliminado;
//   · **a fita**: toda partida jogada tem replay, ele volta da compressão com os dois lutadores, e
//     partida de W.O. não tem fita;
//   · **a JANELA das fitas**: elas somem do banco quando a chave do campeonato seguinte é
//     publicada, e o servidor recusa entregar fita de uma edição fora da janela — mesmo com a
//     linha da partida ainda lá, com vencedor e placar;
//   · **a equipe congelada**: a luta usa a equipe gravada no fechamento, não a de agora.
//
// Limpa tudo o que criou, mesmo quando falha.
//
//   node tools/teste-campeonato-partidas.mjs
import { gunzipSync } from 'node:zlib';
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import * as cdb from '../src/server/campeonato-db.mjs';
import { avancarCampeonato, fitaDoCampeonato } from '../src/server/game/campeonato.mjs';
import {
  campeonatoDe, derrotasPorSeed, montarChave, partidasDaChave,
  replaysAbertos, replaysAte,
} from '../src/shared/campeonato.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};

const INSCRITOS = 13;
const SEM_EQUIPE = 2;
const ID = `teste-partidas-${Date.now()}`;
const inicio = Date.now() - 60_000;
const C = {
  ...campeonatoDe('mundial', 2026, 9),
  id: ID,
  inscricoesAte: inicio,
  // O teste pula o dia de análise: inscrição, equipe e lutas no mesmo instante. Quem prova a
  // janela de verdade é o `teste-campeonato.mjs`, sem banco.
  equipeAte: inicio,
  lutasEm: inicio,
  intervaloOndaMs: 60_000,
};

async function limpar() {
  await pool.query('DELETE FROM campeonato_partidas WHERE campeonato = $1', [ID]);
  await pool.query('DELETE FROM campeonato_chaves WHERE campeonato = $1', [ID]);
  await pool.query('DELETE FROM campeonato_inscricoes WHERE campeonato = $1', [ID]);
}

try {
  await cdb.migrar();

  // Quem tem pokémon de sobra para montar cinco. As duas últimas contas ficam SEM equipe.
  const { rows: contas } = await pool.query(
    `SELECT p.id, p.nick FROM players p
      WHERE (SELECT count(*) FROM player_pokemon pp WHERE pp.player_id = p.id AND pp.anuncio_id IS NULL) >= 5
      ORDER BY p.level DESC LIMIT $1`,
    [INSCRITOS],
  );
  if (contas.length < INSCRITOS) throw new Error(`o banco local só tem ${contas.length} contas com 5 pokémon`);

  console.log('fechamento');
  for (const c of contas) await cdb.inscrever(ID, c.id);
  const cong = await cdb.congelarChave(ID, 5);
  ok(cong.gerou && cong.participantes === INSCRITOS, `chave congelada com ${INSCRITOS} inscritos`, JSON.stringify(cong));

  // As equipes do teste: os cinco pokémon de maior nível de cada conta, no formato do retrato do
  // fechamento. Gravadas DEPOIS do congelamento — é a coluna que a luta lê.
  const seeds = new Map((await pool.query(
    'SELECT player_id, seed FROM campeonato_inscricoes WHERE campeonato = $1', [ID],
  )).rows.map((r) => [Number(r.player_id), Number(r.seed)]));
  const semEquipe = new Set();
  for (const [i, c] of contas.entries()) {
    if (i >= INSCRITOS - SEM_EQUIPE) {
      await pool.query(`UPDATE campeonato_inscricoes SET equipe = '[]' WHERE campeonato = $1 AND player_id = $2`, [ID, c.id]);
      semEquipe.add(seeds.get(Number(c.id)));
      continue;
    }
    const { rows: pks } = await pool.query(
      `SELECT id, species_id, level, quality, potencia, shiny, ivs, bonus_base, tm_elemental
         FROM player_pokemon WHERE player_id = $1 AND anuncio_id IS NULL
        ORDER BY level DESC, id LIMIT 5`,
      [c.id],
    );
    const equipe = pks.map((r) => ({
      id: Number(r.id),
      speciesId: Number(r.species_id),
      level: Number(r.level),
      quality: Number(r.quality) || 1,
      potencia: Number(r.potencia) || 1,
      shiny: !!r.shiny,
      ivs: typeof r.ivs === 'string' ? JSON.parse(r.ivs) : r.ivs,
      refino: null,
      tmElemental: r.tm_elemental ?? null,
    }));
    await pool.query(
      'UPDATE campeonato_inscricoes SET equipe = $3 WHERE campeonato = $1 AND player_id = $2',
      [ID, c.id, JSON.stringify(equipe)],
    );
  }
  // Carimba o congelamento das equipes À MÃO: as equipes acima são as do teste, e sem o carimbo
  // a rede de segurança de `avancar` chamaria `congelarEquipes` e trocaria todas pelas de
  // verdade — inclusive devolvendo equipe às duas contas que têm de entrar sem nenhuma.
  await pool.query('UPDATE campeonato_chaves SET equipes_em = now() WHERE campeonato = $1', [ID]);

  console.log('as ondas');
  ok(await avancarCampeonato(C, inicio - 120_000) === null, 'antes do horário das lutas, nada é jogado');
  let agora = Date.now();
  const r1 = await avancarCampeonato(C, agora);
  ok(r1?.onda === 1 && r1.partidas > 0, `a primeira onda roda (${r1?.partidas} partidas)`, JSON.stringify(r1));
  ok(await avancarCampeonato(C, agora + 1_000) === null, 'antes do intervalo vencer, a onda seguinte espera');
  // Duas chamadas no mesmo instante: a segunda devolve a MESMA promessa, e o banco garante o resto.
  agora += C.intervaloOndaMs;
  const [d1, d2] = await Promise.all([avancarCampeonato(C, agora), avancarCampeonato(C, agora)]);
  ok(d1?.onda === 2 && d1 === d2, 'duas chamadas simultâneas jogam a onda uma vez só');

  let ultima = d1;
  for (let i = 0; i < 40 && !ultima?.concluido; i++) {
    agora += C.intervaloOndaMs;
    ultima = await avancarCampeonato(C, agora);
  }
  ok(ultima?.concluido === true, `a chave terminou sozinha na onda ${ultima?.onda}`);

  console.log('o resultado');
  const chaveRow = await cdb.chaveGerada(ID);
  const podio = chaveRow?.podio;
  ok(podio?.campeao && podio?.vice && podio?.terceiro, `pódio gravado: ${JSON.stringify(podio)}`);
  ok(new Set([podio?.campeao, podio?.vice, podio?.terceiro]).size === 3, 'campeão, vice e 3º são três pessoas diferentes');
  ok(!semEquipe.has(podio?.campeao), 'quem ficou sem equipe não é o campeão');

  const res = await cdb.resultados(ID);
  ok(res.size === 2 * INSCRITOS - 2, `${res.size} partidas gravadas (esperado ${2 * INSCRITOS - 2})`);
  const estrutura = montarChave(INSCRITOS);
  const faltando = partidasDaChave(estrutura).filter((p) => !p.bye && !res.has(p.id)).map((p) => p.id);
  ok(!faltando.length, 'nenhuma partida da chave ficou sem jogar', faltando.join(', '));
  const derrotas = derrotasPorSeed(res);
  const errados = [];
  for (let s = 1; s <= INSCRITOS; s++) {
    const d = derrotas.get(s) ?? 0;
    const certo = s === podio?.campeao ? d <= 1 : s === podio?.vice ? d >= 1 && d <= 2 : d === 2;
    if (!certo) errados.push(`seed ${s}: ${d}`);
  }
  ok(!errados.length, 'eliminado sai com duas derrotas; campeão com no máximo uma', errados.join(', '));

  const wos = [...res.values()].filter((r) => r.estado === 'wo');
  const jogadas = [...res.values()].filter((r) => r.estado === 'jogada');
  ok(wos.length >= SEM_EQUIPE, `${wos.length} W.O. — pelo menos um por conta sem equipe`);
  ok(wos.every((r) => semEquipe.has(r.perdedor)), 'todo W.O. derrota quem não tem equipe');
  ok(wos.every((r) => !r.temReplay), 'W.O. não tem fita');
  ok(jogadas.every((r) => r.temReplay), 'toda partida jogada tem fita');
  ok(jogadas.every((r) => r.placar && Number.isFinite(r.placar.a) && Number.isFinite(r.placar.b)), 'toda partida jogada tem placar');
  ok(jogadas.some((r) => r.placar.a + r.placar.b > 0), 'os placares não são todos zero');

  console.log('as fitas');
  const gf = res.get('GF');
  ok(gf && (gf.vencedor === podio?.campeao), 'a grande final decide o campeão');
  const alvo = jogadas[0];
  const idAlvo = [...res.entries()].find(([, r]) => r === alvo)?.[0];
  const fita = await cdb.fitaDaPartida(ID, idAlvo);
  const bruto = fita ? JSON.parse(gunzipSync(fita.replay).toString()) : null;
  ok(bruto?.replay?.atores?.length >= 2, `a fita de ${idAlvo} volta da compressão com os lutadores`);
  const nicks = new Set((bruto?.replay?.atores ?? []).map((a) => a.nick ?? a.dono ?? a.nome).filter(Boolean));
  ok(fita?.replay?.length < 60_000, `a fita comprimida tem ${fita?.replay?.length} bytes`);
  ok(bruto?.versao >= 1, `a fita guarda a versão do replay (${bruto?.versao})`);
  if (!nicks.size) console.log('    (os atores da fita não trazem nick — só conferido o número deles)');
  ok(await cdb.fitaDaPartida(ID, wos[0] ? [...res.entries()].find(([, r]) => r === wos[0])[0] : 'X') === null,
    'pedir a fita de um W.O. devolve nada');

  console.log('depois do fim');
  ok(await avancarCampeonato(C, agora + C.intervaloOndaMs * 3) === null, 'campeonato encerrado não joga mais nada');

  // ------------------------------------------------------------ a janela das fitas
  //
  // O ensaio acima roda num campeonato de MENTIRA (id fora do calendário), e `fitaDoCampeonato`
  // só entrega fita de uma edição de verdade. Então esta parte empresta UMA partida para uma
  // edição do calendário — o que se quer provar é a REGRA da janela, e ela não depende de quem
  // lutou.
  //
  // A edição emprestada é de 2030, e não o Mundial #1, de propósito: a faxina apaga as fitas do
  // campeonato INTEIRO, e rodar isto contra a edição de setembro de 2026 levaria junto as 300 e
  // tantas fitas de um ensaio feito no banco local (ver `tools/campeonato-ensaio.mjs`). Um
  // teste não pode apagar o trabalho de quem estava olhando a chave ao lado.
  console.log('a janela das fitas');
  const REAL = campeonatoDe('mundial', 2030, 6);
  const PROX = campeonatoDe('amador', 2030, 7);
  ok(replaysAte(REAL) === PROX.inscricoesAte,
    'a janela de um Mundial vai até a chave do Amador seguinte ser publicada');
  ok(replaysAbertos(REAL, PROX.inscricoesAte - 1), 'um milissegundo antes, a fita abre');
  ok(!replaysAbertos(REAL, PROX.inscricoesAte), 'no instante exato, fecha');

  // Empresta UMA partida com fita para o id de verdade, sem tocar nas inscrições dele.
  const EMPRESTADA = 'V1-9999';
  await pool.query('DELETE FROM campeonato_partidas WHERE campeonato = $1 AND id = $2', [REAL.id, EMPRESTADA]);
  await pool.query(
    `INSERT INTO campeonato_partidas
       (campeonato, id, a_seed, b_seed, vencedor_seed, perdedor_seed, estado, onda, replay)
     SELECT $1, $2, a_seed, b_seed, vencedor_seed, perdedor_seed, estado, onda, replay
       FROM campeonato_partidas WHERE campeonato = $3 AND id = $4`,
    [REAL.id, EMPRESTADA, ID, idAlvo],
  );
  try {
    const dentro = await fitaDoCampeonato(REAL.id, EMPRESTADA, REAL.fimEm + 1000);
    ok(dentro?.replay != null, 'dentro da janela, o servidor entrega a fita');
    const fora = await fitaDoCampeonato(REAL.id, EMPRESTADA, replaysAte(REAL) + 1000);
    ok(fora === null, 'FORA da janela, o servidor recusa — mesmo com o BYTEA ainda no banco');

    // A faxina: o `UPDATE` apaga o vídeo e deixa a linha.
    const n = await cdb.apagarReplaysVencidos(REAL.id);
    ok(n >= 1, `a faxina apagou ${n} fita(s)`);
    const { rows: sobrou } = await pool.query(
      `SELECT vencedor_seed, (replay IS NULL) AS sem_fita FROM campeonato_partidas
        WHERE campeonato = $1 AND id = $2`,
      [REAL.id, EMPRESTADA],
    );
    ok(sobrou.length === 1, 'a LINHA da partida continua no banco depois da faxina');
    ok(sobrou[0]?.sem_fita === true, 'e o replay dela foi a zero');
    ok(Number(sobrou[0]?.vencedor_seed) > 0, 'o vencedor continua gravado — some o vídeo, não o resultado');
    ok(await cdb.apagarReplaysVencidos(REAL.id) === 0, 'faxinar de novo não encontra mais nada');
  } finally {
    await pool.query('DELETE FROM campeonato_partidas WHERE campeonato = $1 AND id = $2', [REAL.id, EMPRESTADA]);
  }
} catch (err) {
  falhas++;
  console.log(`  ✗ erro: ${err.stack ?? err.message}`);
} finally {
  await limpar().catch(() => {});
  await pool.end().catch(() => {});
}

console.log(`\n${testes - falhas}/${testes} ok${falhas ? ` — ${falhas} FALHA(S)` : ''}`);
process.exit(falhas ? 1 : 0);
