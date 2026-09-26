// ENSAIO DE CAMPEONATO — joga uma edição inteira no banco LOCAL, para ver a chave de verdade.
//
// Não é um teste: é um ensaio. Ele pega os inscritos que existem no banco desta máquina (um
// espelho da produção) e adianta o relógio do campeonato para JÁ, congelando a chave, tirando o
// retrato das equipes e rodando as ondas até o pódio. Depois disso a aba Torneio do jogo local
// mostra a chave cheia, com os confrontos, os placares e o botão ▶ Assistir de cada partida.
//
// Roda pelo MESMO `avancarCampeonato` que o tick do servidor chama, com as MESMAS equipes
// congeladas e a MESMA simulação de luta do PvP Ranqueado. O que ele muda é só o relógio.
//
//     node tools/campeonato-ensaio.mjs                 # o Mundial de 2026-09-30, com quem já está inscrito
//     node tools/campeonato-ensaio.mjs --tipo amador   # copia os inscritos para o Amador e joga ele
//     node tools/campeonato-ensaio.mjs --limpar        # desfaz: apaga chave, partidas e seeds
//     node tools/campeonato-ensaio.mjs --tipo amador --limpar
//
// ### O que o `--tipo amador` prova
//
// O Amador não aceita shiny nem P5. Quem foi copiado para lá não escolheu equipe para ELE, então
// todo mundo cai na equipe do PvP Ranqueado — e é no congelamento que os shinys e os P5 são
// retirados dela, um por um. O relatório no fim conta quantos pokémon saíram por causa disso e
// quantos inscritos ficaram sem equipe nenhuma (e, portanto, entram de W.O.).
//
// ### Isto escreve no banco
//
// Em `campeonato_inscricoes` (a coluna `seed` e o retrato `equipe`), `campeonato_chaves` e
// `campeonato_partidas`. Só no banco LOCAL — e `--limpar` desfaz tudo o que ele criou.
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import * as cdb from '../src/server/campeonato-db.mjs';
import { avancarCampeonato } from '../src/server/game/campeonato.mjs';
import {
  campeonatoDe, derrotasPorSeed, montarChave, partidasDaChave, podioDaChave, resolverChave,
} from '../src/shared/campeonato.mjs';

const args = process.argv.slice(2);
const tipo = args.includes('--tipo') ? args[args.indexOf('--tipo') + 1] : 'mundial';
const limpar = args.includes('--limpar');

/** A EDIÇÃO que o ensaio joga: a primeira de cada tipo no calendário. */
const EDICAO = {
  mundial: campeonatoDe('mundial', 2026, 9),
  amador: campeonatoDe('amador', 2026, 10),
}[tipo];
if (!EDICAO) {
  console.error(`tipo desconhecido: ${tipo} (use mundial ou amador)`);
  process.exit(1);
}
/** De onde saem os inscritos quando a edição ainda não tem nenhum. */
const FONTE = campeonatoDe('mundial', 2026, 9).id;

const n = (v) => Number(v).toLocaleString('pt-BR');

async function apagar() {
  const p = await pool.query('DELETE FROM campeonato_partidas WHERE campeonato = $1', [EDICAO.id]);
  const c = await pool.query('DELETE FROM campeonato_chaves WHERE campeonato = $1', [EDICAO.id]);
  // No Mundial as inscrições são de VERDADE (vieram da produção): só as seeds e o retrato são
  // desfeitos. No Amador elas foram criadas por este ensaio, então saem inteiras.
  if (EDICAO.id === FONTE) {
    await pool.query(
      `UPDATE campeonato_inscricoes
          SET seed = NULL, posicao_congelada = NULL, pontos_congelados = NULL, equipe = NULL
        WHERE campeonato = $1`,
      [EDICAO.id],
    );
  } else {
    await pool.query('DELETE FROM campeonato_inscricoes WHERE campeonato = $1', [EDICAO.id]);
  }
  console.log(`limpo: ${p.rowCount} partida(s), ${c.rowCount} chave(s), inscrições de ${EDICAO.id} ${EDICAO.id === FONTE ? 'descongeladas' : 'apagadas'}`);
}

try {
  if (limpar) {
    await cdb.migrar();
    await apagar();
    process.exit(0);
  }

  await cdb.migrar();
  console.log(`\n=== ENSAIO: ${EDICAO.tipo.toUpperCase()} ${EDICAO.id} ===`);
  console.log(`prêmios ${EDICAO.premios.map((v) => `R$ ${n(v)}`).join(' / ')} · nível ${EDICAO.nivelMin}`
    + `${Object.keys(EDICAO.restricoes).length ? ' · SEM shiny e SEM P5' : ' · sem restrição de equipe'}`);

  // Começa do zero: um ensaio que reaproveitasse metade de uma chave anterior não diria nada.
  await apagar();

  // O Amador ainda não tem inscritos — o ensaio copia os do Mundial, que são reais.
  if (EDICAO.id !== FONTE) {
    const r = await pool.query(
      `INSERT INTO campeonato_inscricoes (campeonato, player_id, inscrito_em)
       SELECT $1, player_id, inscrito_em FROM campeonato_inscricoes WHERE campeonato = $2
       ON CONFLICT DO NOTHING`,
      [EDICAO.id, FONTE],
    );
    console.log(`${r.rowCount} inscrito(s) copiados de ${FONTE}`);
  }

  const { rows: [{ total }] } = await pool.query(
    'SELECT count(*)::int AS total FROM campeonato_inscricoes WHERE campeonato = $1', [EDICAO.id],
  );
  if (!total) {
    console.error('nenhum inscrito — nada a ensaiar');
    process.exit(1);
  }
  console.log(`${n(total)} inscrito(s)`);

  // O RELÓGIO adiantado: tudo daqui para a frente acontece como se fosse o dia da luta. É a
  // única coisa que o ensaio falsifica — a chave, as equipes e as lutas são as de verdade.
  let relogio = EDICAO.lutasEm;
  const t0 = Date.now();

  const rodadas = [];
  for (let onda = 1; onda <= 64; onda++) {
    const r = await avancarCampeonato(EDICAO, relogio);
    if (!r) break;
    rodadas.push(r);
    const s = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`  onda ${String(r.onda).padStart(2)} — ${String(r.partidas).padStart(3)} partida(s)  [${s}s]`);
    if (r.concluido) break;
    relogio += EDICAO.intervaloOndaMs;
  }

  // ------------------------------------------------------------------ o relatório
  const chave = await cdb.chaveGerada(EDICAO.id);
  const res = await cdb.resultados(EDICAO.id);
  const estrutura = montarChave(chave.participantes);
  const inscritos = await cdb.listarInscritos(EDICAO.id, 0);
  const porSeed = new Map(inscritos.filter((i) => i.seed != null).map((i) => [i.seed, i]));
  const nick = (seed) => (seed == null ? '—' : `#${String(seed).padStart(3, '0')} ${porSeed.get(seed)?.nick ?? '?'}`);

  console.log(`\nchave de ${n(chave.participantes)} em ${n(estrutura.tamanho)} vagas`
    + ` · ${n(partidasDaChave(estrutura).filter((p) => !p.bye).length)} confronto(s) reais`
    + ` · ${n(res.size)} jogado(s) em ${rodadas.length} onda(s)`);

  const wos = [...res.values()].filter((r) => r.estado === 'wo').length;
  const comFita = [...res.values()].filter((r) => r.temReplay).length;
  console.log(`${n(res.size - wos)} luta(s) de verdade · ${n(wos)} W.O. · ${n(comFita)} com replay`);

  const podio = podioDaChave(estrutura, res) ?? chave.podio;
  console.log('\n--- PÓDIO ---');
  console.log(`  🥇 ${nick(podio?.campeao)}   R$ ${n(EDICAO.premios[0])}`);
  console.log(`  🥈 ${nick(podio?.vice)}   R$ ${n(EDICAO.premios[1])}`);
  console.log(`  🥉 ${nick(podio?.terceiro)}   R$ ${n(EDICAO.premios[2])}`);

  // O caminho do campeão, partida a partida: é o que dá para conferir a olho contra a chave da
  // tela, e o que mostra que a eliminação dupla de fato ligou tudo.
  const resolvida = resolverChave(estrutura, res);
  const doCampeao = [...resolvida.values()]
    .filter((x) => !x.partida.bye && x.resultado
      && (x.a.seed === podio?.campeao || x.b.seed === podio?.campeao))
    .sort((a, b) => a.resultado.onda - b.resultado.onda);
  console.log('\n--- O CAMINHO DO CAMPEÃO ---');
  for (const x of doCampeao) {
    const souA = x.a.seed === podio.campeao;
    const contra = souA ? x.b.seed : x.a.seed;
    const venceu = x.resultado.vencedor === podio.campeao;
    // O placar sai na ordem da PARTIDA (`a × b`); aqui ele é virado para a ordem do CAMPEÃO,
    // senão uma vitória dele aparece como "4×5" e parece derrota.
    const p = x.resultado.placar;
    const placar = p ? ` (${souA ? p.a : p.b}×${souA ? p.b : p.a})` : '';
    console.log(`  ${x.partida.id.padEnd(6)} ${venceu ? '✓' : '✗'} vs ${nick(contra)}${placar}${x.resultado.estado === 'wo' ? '  W.O.' : ''}`);
  }

  // As equipes congeladas: no Amador é aqui que a restrição aparece em número.
  const { rows: eq } = await pool.query(
    `SELECT jsonb_array_length(equipe) AS n FROM campeonato_inscricoes
      WHERE campeonato = $1 AND equipe IS NOT NULL`,
    [EDICAO.id],
  );
  const tamanhos = eq.map((r) => Number(r.n));
  const vazias = tamanhos.filter((x) => x === 0).length;
  const somaEq = tamanhos.reduce((a, b) => a + b, 0);
  console.log('\n--- AS EQUIPES CONGELADAS ---');
  console.log(`  ${n(tamanhos.length)} retrato(s) · ${n(somaEq)} pokémon no total · média ${(somaEq / (tamanhos.length || 1)).toFixed(2)}`);
  console.log(`  ${n(vazias)} inscrito(s) sem NENHUM pokémon (entram de W.O.)`);
  if (Object.keys(EDICAO.restricoes).length) {
    // Quantos SERIAM se não houvesse restrição: a equipe de PvP salva, sem filtro.
    const { rows: [{ bruto }] } = await pool.query(
      `SELECT COALESCE(sum(jsonb_array_length(t.pokemon_ids)), 0)::int AS bruto
         FROM campeonato_inscricoes i JOIN pvp_time t ON t.player_id = i.player_id
        WHERE i.campeonato = $1`,
      [EDICAO.id],
    );
    console.log(`  a equipe de PvP dos mesmos inscritos soma ${n(bruto)} pokémon`);
    console.log(`  → ${n(Math.max(0, bruto - somaEq))} ficaram de fora por serem SHINY ou P5`);
  }

  // As derrotas: numa eliminação dupla honesta, todo eliminado sai com exatamente duas.
  const derrotas = derrotasPorSeed(res);
  const comDuas = [...derrotas.values()].filter((x) => x >= 2).length;
  console.log(`\n${n(comDuas)} eliminado(s) com duas derrotas · o campeão saiu com ${derrotas.get(podio?.campeao) ?? 0}`);

  console.log(`\nPronto em ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  console.log(`Abra o jogo local em /app → Torneio → ${EDICAO.tipo === 'amador' ? 'Campeonato Amador' : 'Campeonato Mundial'} → aba Bracket.`);
  console.log(`Para desfazer: node tools/campeonato-ensaio.mjs --tipo ${EDICAO.tipo} --limpar`);
} finally {
  await pool.end();
  // `game/campeonato.mjs` traz o barramento do Redis junto (é dele que sai o aviso de onda para
  // as telas), e a conexão dele segura o laço de eventos de pé para sempre. Fechar o Postgres
  // não basta: sem esta linha o ensaio termina o relatório e o processo fica pendurado.
  process.exit(0);
}
