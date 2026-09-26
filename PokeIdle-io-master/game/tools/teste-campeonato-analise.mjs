// O DIA DE ANÁLISE do campeonato — a janela entre a chave sair e as lutas começarem.
//
// A linha do tempo tem TRÊS instantes, e este teste existe porque eles já foram um só:
//
//   `inscricoesAte`  29/09 00:00 — fecham as inscrições, as seeds congelam, a CHAVE aparece
//   `equipeAte`      29/09 23:00 — a equipe e a ordem travam, e o retrato de cada uma é tirado
//   `lutasEm`        30/09 00:00 — a primeira onda roda
//
// O que ele protege:
//
//   · **a chave sai no primeiro prazo, sem equipe congelada**: `congelarChave` grava seed e não
//     toca em `equipe` — congelar as duas juntas tiraria o retrato 23h antes do prazo da tela;
//   · **a equipe troca DEPOIS de as inscrições fecharem**: é a janela inteira. Era o que o
//     `seed IS NULL` do banco recusava, e o erro não aparecia em lugar nenhum;
//   · **às 23h ela trava**: `congelarEquipes` tira o retrato, carimba, e a troca passa a ser
//     recusada — pelo servidor E pelo banco;
//   · **o retrato é o que luta**: o que estava salvo às 23h, e não o que era no fim das inscrições;
//   · **a rede de segurança**: chegou a hora de lutar sem ninguém ter congelado, `avancar`
//     congela antes da primeira partida em vez de jogar um campeonato inteiro de W.O.;
//   · **idempotência**: os dois congelamentos rodam duas vezes sem estragar nada.
//
// Campeonato de mentira, com id próprio e datas no passado — o de verdade não é tocado. As
// contas são as que já existem no banco local; nada é criado nem apagado além das linhas deste
// campeonato. Precisa de Postgres e Redis (npm run infra):
//
//   node tools/teste-campeonato-analise.mjs
import { pool } from '../src/server/db.mjs';
import * as cdb from '../src/server/campeonato-db.mjs';
import { escolherEquipeEm, avancarCampeonato } from '../src/server/game/campeonato.mjs';
import { campeonatoDe, equipeAberta, janelaDeAnalise } from '../src/shared/campeonato.mjs';

/** O Mundial #1, de onde saem as durações reais que o campeonato de mentira herda. */
const REAL = campeonatoDe('mundial', 2026, 9);

let testes = 0;
let falhas = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (s) => console.log(`\n${s}`);

const INSCRITOS = 6;
const ID = `teste-analise-${Date.now()}`;
// As três datas, todas no passado, com a mesma FORMA da linha do tempo de verdade.
const fecha = Date.now() - 3 * 60 * 60_000; // inscrições fecharam 3h atrás
const trava = Date.now() - 2 * 60 * 60_000; // equipe travaria 2h atrás
const luta = Date.now() - 1 * 60 * 60_000; // lutas começaram 1h atrás
const C = { ...REAL, id: ID, inscricoesAte: fecha, equipeAte: trava, lutasEm: luta, intervaloOndaMs: 60_000 };

const limpar = async () => {
  await pool.query('DELETE FROM campeonato_partidas WHERE campeonato = $1', [ID]);
  await pool.query('DELETE FROM campeonato_chaves WHERE campeonato = $1', [ID]);
  await pool.query('DELETE FROM campeonato_inscricoes WHERE campeonato = $1', [ID]);
};

/** A linha de um inscrito, crua — é no banco que a verdade é conferida, não no pacote da tela. */
const linha = async (playerId) => (await pool.query(
  'SELECT seed, equipe, equipe_ids FROM campeonato_inscricoes WHERE campeonato = $1 AND player_id = $2',
  [ID, playerId],
)).rows[0];

const jsonArr = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/** `escolherEquipe` recusou com a chave esperada? Devolve a chave, ou `null` se passou. */
const recusa = async (fn) => {
  try {
    await fn();
    return null;
  } catch (err) {
    return err.message;
  }
};

try {
  await cdb.migrar();
  await limpar();

  const { rows: contas } = await pool.query(
    `SELECT p.id, p.nick FROM players p
      WHERE (SELECT count(*) FROM player_pokemon pp WHERE pp.player_id = p.id AND pp.anuncio_id IS NULL) >= 5
      ORDER BY p.level DESC LIMIT $1`,
    [INSCRITOS],
  );
  if (contas.length < INSCRITOS) throw new Error(`o banco local só tem ${contas.length} contas com 5 pokémon`);
  const pksDe = async (playerId, limite = 5) => (await pool.query(
    `SELECT id FROM player_pokemon WHERE player_id = $1 AND anuncio_id IS NULL ORDER BY level DESC, id LIMIT $2`,
    [playerId, limite],
  )).rows.map((r) => Number(r.id));

  secao('A forma da linha do tempo (o campeonato de verdade)');
  {
    ok(REAL.inscricoesAte < REAL.equipeAte && REAL.equipeAte < REAL.lutasEm,
      'os três instantes estão em ordem: fecha < trava < luta');
    const meio = (REAL.inscricoesAte + REAL.equipeAte) / 2;
    ok(janelaDeAnalise(meio, REAL) !== null && equipeAberta(meio, REAL), 'no meio da janela a equipe ainda abre');
  }

  secao('O primeiro congelamento: a chave sai SEM o retrato das equipes');
  for (const c of contas) await cdb.inscrever(ID, c.id);
  // Uma escolha feita ANTES de as inscrições fecharem, para provar que ela pode mudar depois.
  const alvo = contas[0];
  const escolhaVelha = await pksDe(alvo.id, 2);
  await cdb.escolherEquipe(ID, alvo.id, escolhaVelha);

  const cong = await cdb.congelarChave(ID, 0);
  ok(cong.gerou && cong.participantes === INSCRITOS, `chave congelada com ${INSCRITOS} inscritos`, JSON.stringify(cong));
  {
    const l = await linha(alvo.id);
    ok(l.seed != null, 'a seed foi gravada no fechamento das inscrições');
    ok(l.equipe == null, 'a equipe NÃO foi congelada junto com a seed');
    const g = await cdb.chaveGerada(ID);
    ok(g.equipesEm == null, 'o carimbo `equipes_em` continua vazio — o retrato não foi tirado');
  }

  secao('A janela: com as inscrições fechadas, a equipe ainda troca');
  {
    const nova = await pksDe(alvo.id, 4);
    // O caminho do jogador, com o relógio dentro da janela: servidor + banco.
    const { ids } = await escolherEquipeEm(C, { dbId: alvo.id }, nova, fecha + 60_000);
    ok(ids.length === 4, 'o servidor aceita a troca depois do fechamento das inscrições');
    const l = await linha(alvo.id);
    ok(jsonArr(l.equipe_ids)?.length === 4, 'o banco gravou a escolha nova (o guard não é mais `seed IS NULL`)');
    ok(jsonArr(l.equipe_ids).join() !== escolhaVelha.join(), 'a escolha do dia de análise substituiu a anterior');
  }

  secao('Às 23h: o retrato é tirado e a porta fecha');
  {
    const r = await cdb.congelarEquipes(ID, C);
    ok(r.gerou && r.equipes === INSCRITOS, `retrato tirado dos ${INSCRITOS} inscritos`, JSON.stringify(r));
    const g = await cdb.chaveGerada(ID);
    ok(g.equipesEm != null, 'o carimbo `equipes_em` foi gravado');
    const l = await linha(alvo.id);
    const eq = jsonArr(l.equipe);
    ok(Array.isArray(eq) && eq.length === 4, 'o retrato tem os 4 da escolha do dia de análise, não os 2 de antes',
      `tem ${eq?.length}`);
    ok(eq.every((pk) => pk.speciesId && pk.level), 'o retrato carrega o que a luta precisa (speciesId, level)');
  }
  {
    const erro = await recusa(() => escolherEquipeEm(C, { dbId: alvo.id }, escolhaVelha, trava + 1));
    ok(erro === 'camp.recusa.equipeCongelada', 'depois das 23h o servidor recusa a troca', String(erro));
    // E o banco também: mesmo que o relógio do sim errasse, a trava de baixo segura.
    const r = await cdb.escolherEquipe(ID, alvo.id, escolhaVelha);
    ok(r === 'congelada', 'o banco recusa por conta própria (`equipe IS NULL`)', String(r));
    const l = await linha(alvo.id);
    ok(jsonArr(l.equipe).length === 4, 'o retrato ficou intacto depois da recusa');
  }

  secao('Idempotência dos dois congelamentos');
  {
    const c2 = await cdb.congelarChave(ID, 0);
    ok(!c2.gerou && c2.participantes === INSCRITOS, 'congelarChave de novo não regrava nada');
    const e2 = await cdb.congelarEquipes(ID, C);
    ok(!e2.gerou, 'congelarEquipes de novo não tira um retrato novo');
    const l = await linha(alvo.id);
    ok(jsonArr(l.equipe).length === 4, 'e o retrato continua o mesmo');
  }

  secao('As lutas usam o retrato, e a rede de segurança segura o esquecimento');
  {
    const lut = await cdb.lutadores(ID);
    const meu = [...lut.values()].find((x) => x.dbId === Number(alvo.id));
    ok(meu?.pokemons?.length === 4, 'a luta lê os 4 pokémon do retrato', `leu ${meu?.pokemons?.length}`);
    ok([...lut.values()].every((x) => x.pokemons.length > 0), 'nenhum inscrito entra sem equipe');
  }
  {
    // A REDE: apaga o carimbo e o retrato, como se ninguém tivesse congelado às 23h, e manda
    // avançar. `avancar` tem de congelar antes de jogar — senão é um campeonato inteiro de W.O.
    await pool.query('UPDATE campeonato_chaves SET equipes_em = NULL WHERE campeonato = $1', [ID]);
    await pool.query('UPDATE campeonato_inscricoes SET equipe = NULL WHERE campeonato = $1', [ID]);
    const r1 = await avancarCampeonato(C, Date.now());
    ok(r1?.partidas > 0, `a primeira onda rodou (${r1?.partidas} partidas)`, JSON.stringify(r1));
    const g = await cdb.chaveGerada(ID);
    ok(g.equipesEm != null, 'a rede de segurança congelou as equipes antes de jogar');
    const { rows } = await pool.query(
      `SELECT count(*)::int n FROM campeonato_partidas WHERE campeonato = $1 AND estado = 'wo'`, [ID],
    );
    ok(rows[0].n === 0, 'nenhuma partida saiu W.O. por falta de retrato', `${rows[0].n} W.O.`);
  }

  secao('Antes da hora das lutas, nada é jogado');
  {
    await limpar();
    for (const c of contas) await cdb.inscrever(ID, c.id);
    await cdb.congelarChave(ID, 0);
    ok(await avancarCampeonato(C, luta - 60_000) === null, 'no dia de análise a chave existe e nenhuma onda roda');
    const { rows } = await pool.query('SELECT count(*)::int n FROM campeonato_partidas WHERE campeonato = $1', [ID]);
    ok(rows[0].n === 0, 'nenhuma partida foi gravada durante a janela');
  }
} finally {
  await limpar();
  await pool.end();
}

console.log(`\n${testes - falhas}/${testes} ok${falhas ? ` — ${falhas} FALHA(S)` : ''}`);
process.exit(falhas ? 1 : 0);
