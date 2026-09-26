// Teste do CAMPEONATO — sem banco e sem Redis.
//
// A chave é aritmética sobre um número de inscritos, então o contrato inteiro se prova sem
// infra. O que este teste protege:
//
//   · **a regra das seeds.** Na primeira rodada a Seed 1 enfrenta a última, a 2 a penúltima —
//     todo par soma `tamanho + 1` — e a 1 e a 2 só podem se cruzar na final;
//   · **a eliminação dupla de verdade.** Simulando o torneio inteiro com resultados sorteados,
//     de 2 a 70 inscritos, pelo MESMO `resolverChave` que o servidor usa para decidir o que
//     jogar: todo eliminado sai com exatamente duas derrotas, o campeão com no máximo uma, e são
//     sempre 2n−2 partidas. É a prova de que nenhuma queda para a chave dos perdedores ficou sem
//     destino, nenhuma vaga aponta para o lugar errado e a chave nunca trava no meio;
//   · **a grande final é única.** Quem vence a GF é o campeão, venha de cima ou de baixo;
//   · **os byes.** Com 10 inscritos numa chave de 16, as seis melhores seeds avançam direto — e
//     a segunda rodada já mostra o NOME delas, não "vencedor da partida 1";
//   · **o tamanho da chave dos perdedores** — 4/4/2/2/1/1 numa chave de 16, o desenho padrão;
//   · **a ordem das seeds** entre os inscritos: posição na tabela primeiro, depois o resto;
//   · **o prazo.** 28/09 às 23:59 de Brasília ainda inscreve; meia-noite do dia 29, não;
//   · **o CALENDÁRIO.** Mundial no último dia do mês, Amador no dia 15, os dois se gerando
//     sozinhos mês a mês — incluindo fevereiro, ano bissexto e virada de ano;
//   · **a janela das fitas**: cada edição fica assistível até a chave da seguinte ser publicada;
//   · **as restrições do Amador**: shiny e P5 não entram, e no Mundial entram.
//
//   node tools/teste-campeonato.mjs
import {
  equipeAberta,
  janelaDeAnalise,
  campeonatoDe,
  campeonatoPorId,
  listaDeCampeonatos,
  proximoDepois,
  replaysAbertos,
  replaysAte,
  porQueNaoPodeLutar,
  ultimoDiaDoMes,
  compararSeeds,
  derrotasPorSeed,
  estreiaDaSeed,
  faseDoCampeonato,
  montarChave,
  ordemDasSeeds,
  partidasDaChave,
  podeInscrever,
  podioDaChave,
  resolverChave,
  tamanhoDaChave,
} from '../src/shared/campeonato.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, msg) => {
  testes++;
  if (!cond) {
    falhas++;
    console.log(`  ✗ ${msg}`);
  }
};
const igual = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — veio ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);

console.log('ordem das seeds');
igual(ordemDasSeeds(2), [1, 2], 'chave de 2');
igual(ordemDasSeeds(4), [1, 4, 2, 3], 'chave de 4');
igual(ordemDasSeeds(8), [1, 8, 4, 5, 2, 7, 3, 6], 'chave de 8');
for (const s of [2, 4, 8, 16, 32, 64, 128]) {
  const o = ordemDasSeeds(s);
  ok(o.length === s, `chave de ${s} tem ${s} vagas`);
  ok(new Set(o).size === s, `chave de ${s} não repete seed`);
  let somam = true;
  for (let i = 0; i < s; i += 2) if (o[i] + o[i + 1] !== s + 1) somam = false;
  ok(somam, `chave de ${s}: todo par da 1ª rodada soma ${s + 1} (1 × última, 2 × penúltima)`);
  // A 1 na metade de cima, a 2 na de baixo: só se cruzam na final.
  ok(o.indexOf(1) < s / 2 && o.indexOf(2) >= s / 2, `chave de ${s}: seeds 1 e 2 em metades opostas`);
}

console.log('tamanho da chave');
for (const [n, s] of [[2, 2], [3, 4], [4, 4], [5, 8], [8, 8], [9, 16], [17, 32], [33, 64], [70, 128]]) {
  igual(tamanhoDaChave(n), s, `${n} inscritos → chave de ${s}`);
}
ok(montarChave(0) === null && montarChave(1) === null, 'menos de 2 inscritos não gera chave');

console.log('forma da chave');
const tamanhos = (rodadas) => rodadas.map((r) => r.length);
igual(tamanhos(montarChave(16).vencedores), [8, 4, 2, 1], '16: vencedores 8/4/2/1');
igual(tamanhos(montarChave(16).perdedores), [4, 4, 2, 2, 1, 1], '16: perdedores 4/4/2/2/1/1');
igual(tamanhos(montarChave(8).perdedores), [2, 2, 1, 1], '8: perdedores 2/2/1/1');
igual(tamanhos(montarChave(4).perdedores), [1, 1], '4: perdedores 1/1');
{
  const c2 = montarChave(2);
  igual(tamanhos(c2.perdedores), [], '2: sem chave dos perdedores');
  igual(c2.final[0].b, { perde: 'V1-1' }, '2: a grande final é a revanche da única partida');
}
{
  const c = montarChave(16);
  igual(c.final[0].a, { vence: 'V4-1' }, 'grande final: campeão dos vencedores de um lado');
  igual(c.final[0].b, { vence: 'P6-1' }, 'grande final: campeão dos perdedores do outro');
  igual(c.final.length, 1, 'grande final única, sem partida de desempate');
  // A rodada par dos perdedores recebe quem cai da rodada seguinte dos vencedores.
  const quedas = c.perdedores[1].map((p) => p.b.perde);
  igual([...quedas].sort(), ['V2-1', 'V2-2', 'V2-3', 'V2-4'], 'perdedores R2 recebe as quatro quedas da V2');
  igual(c.perdedores[5][0].b, { perde: 'V4-1' }, 'final dos perdedores recebe quem perdeu a final dos vencedores');
}

console.log('byes');
{
  const c = montarChave(10);
  igual(c.tamanho, 16, '10 inscritos → chave de 16');
  const byesV1 = c.vencedores[0].filter((p) => p.bye);
  igual(byesV1.length, 6, 'seis partidas da 1ª rodada são bye');
  const comBye = byesV1.map((p) => p.a.seed ?? p.b.seed).sort((x, y) => x - y);
  igual(comBye, [1, 2, 3, 4, 5, 6], 'quem avança direto são as seis melhores seeds');
  const reais = c.vencedores[0].filter((p) => !p.bye).map((p) => [p.a.seed, p.b.seed].sort((x, y) => x - y));
  igual(reais.sort((x, y) => x[0] - y[0]), [[7, 10], [8, 9]], 'jogam de verdade 7×10 e 8×9');
  // Na segunda rodada a Seed 1 já aparece pelo nome.
  const v2 = c.vencedores[1].flatMap((p) => [p.a, p.b]);
  ok(v2.some((l) => l.seed === 1), 'a V2 já mostra a Seed 1 (o bye foi resolvido)');
  ok(!c.vencedores[1].some((p) => p.bye), 'nenhuma partida da V2 é bye com 10 inscritos');
  igual(estreiaDaSeed(c, 1)?.rodada, 2, 'a Seed 1 estreia na 2ª rodada');
  igual(estreiaDaSeed(c, 7)?.contra, { seed: 10 }, 'a Seed 7 estreia contra a 10');
  igual(estreiaDaSeed(c, 10)?.contra, { seed: 7 }, 'a Seed 10 estreia contra a 7');
}
{
  const c = montarChave(8);
  ok(!c.vencedores.flat().some((p) => p.bye) && !c.perdedores.flat().some((p) => p.bye), 'chave cheia não tem bye');
  igual([c.vencedores[0][0].a, c.vencedores[0][0].b], [{ seed: 1 }, { seed: 8 }], 'chave de 8: a primeira partida é 1 × 8');
}

console.log('simulação completa (2 a 70 inscritos, 40 torneios cada)');
// Um gerador com semente: a falha que aparecer aqui tem de se repetir na próxima corrida.
let semente = 12345;
const aleatorio = () => {
  semente = (semente * 1103515245 + 12345) % 2147483648;
  return semente / 2147483648;
};

/**
 * Joga a chave inteira como o servidor joga: onda a onda, só o que `resolverChave` diz que está
 * pronto. Devolve as derrotas, quem jogou, quantas partidas reais houve e o pódio.
 */
function simular(chave) {
  const resultados = new Map();
  const jogou = new Set();
  let reais = 0;
  let ondas = 0;
  for (;;) {
    const prontas = [...resolverChave(chave, resultados).values()].filter((x) => x.pronta);
    if (!prontas.length) break;
    ondas++;
    for (const x of prontas) {
      const [venceu, perdeu] = aleatorio() < 0.5 ? [x.a.seed, x.b.seed] : [x.b.seed, x.a.seed];
      resultados.set(x.partida.id, { vencedor: venceu, perdedor: perdeu });
      jogou.add(venceu);
      jogou.add(perdeu);
      reais++;
    }
    if (ondas > 200) return { travou: true };
  }
  // Toda partida que não é bye tem de ter sido jogada; sobrar alguma é a chave travada.
  const faltou = partidasDaChave(chave).filter((p) => !p.bye && !resultados.has(p.id));
  if (faltou.length) return { travou: true, faltou: faltou.map((p) => p.id) };
  return { travou: false, derrotas: derrotasPorSeed(resultados), jogou, reais, ondas, podio: podioDaChave(chave, resultados) };
}

let simulacoes = 0;
for (let n = 2; n <= 70; n++) {
  const chave = montarChave(n);
  let problema = null;
  for (let t = 0; t < 40 && !problema; t++) {
    const r = simular(chave);
    simulacoes++;
    if (r.travou) { problema = `a chave travou (${(r.faltou ?? []).join(', ')})`; break; }
    const { campeao, vice, terceiro } = r.podio ?? {};
    if (campeao == null || vice == null) { problema = 'grande final sem campeão'; break; }
    for (let s = 1; s <= n; s++) {
      const d = r.derrotas.get(s) ?? 0;
      // O campeão sai com 0 ou 1; o vice com 1 (veio de cima e perdeu a GF) ou 2; o resto, 2.
      const ok = s === campeao ? d <= 1 : s === vice ? d >= 1 && d <= 2 : d === 2;
      if (!ok) { problema = `seed ${s} terminou com ${d} derrota(s)`; break; }
      if (!r.jogou.has(s)) { problema = `seed ${s} não jogou nenhuma partida`; break; }
    }
    if (!problema && n >= 3 && (terceiro == null || terceiro === campeao || terceiro === vice)) {
      problema = `3º lugar inválido (${terceiro})`;
    }
    if (!problema && r.reais !== 2 * n - 2) problema = `${r.reais} partidas reais (esperado ${2 * n - 2})`;
  }
  ok(!problema, `${n} inscritos: ${problema}`);
}
console.log(`  (${simulacoes} torneios simulados)`);

console.log('ordem entre os inscritos');
{
  const lista = [
    { playerId: 5, posicao: null, pontos: 900, vitorias: 3, nivel: 400, inscritoEm: 1 },
    { playerId: 2, posicao: 7, pontos: 1200, vitorias: 30, nivel: 310, inscritoEm: 9 },
    { playerId: 9, posicao: 2, pontos: 1900, vitorias: 80, nivel: 300, inscritoEm: 5 },
    { playerId: 4, posicao: null, pontos: 900, vitorias: 3, nivel: 500, inscritoEm: 7 },
    { playerId: 1, posicao: null, pontos: 0, vitorias: 0, nivel: 999, inscritoEm: 2 },
    { playerId: 3, posicao: null, pontos: 0, vitorias: 0, nivel: 999, inscritoEm: 1 },
  ];
  igual(lista.sort(compararSeeds).map((x) => x.playerId), [9, 2, 4, 5, 3, 1],
    'tabela primeiro (pos 2, pos 7); depois pontos, nível e quem se inscreveu antes');
}

console.log('prazo e fases');
{
  const C = campeonatoDe('mundial', 2026, 9);
  const brasilia = (dia, h, m = 0) => Date.UTC(2026, 8, dia, h + 3, m);
  igual(faseDoCampeonato(brasilia(10, 12), C), 'futuro', '10/09: as inscrições ainda nem abriram');
  igual(faseDoCampeonato(brasilia(16, 12), C), 'inscricoes', '16/09: inscrições abertas');
  igual(faseDoCampeonato(brasilia(28, 23, 59), C), 'inscricoes', '28/09 23:59 (Brasília): ainda aberto');
  igual(faseDoCampeonato(brasilia(29, 0), C), 'chaveado', '29/09 00:00 (Brasília): inscrições fecham, chave de pé');
  igual(faseDoCampeonato(brasilia(30, 0), C), 'chaveado', '30/09 00:00 (Brasília): as lutas começam');
  igual(faseDoCampeonato(brasilia(30, 23, 59), C), 'chaveado', '30/09 23:59: dia do campeonato');
  igual(faseDoCampeonato(Date.UTC(2026, 9, 1, 3, 0), C), 'encerrado', '01/10 00:00 (Brasília): encerrado');
  const agora = brasilia(20, 10);
  igual(podeInscrever({ nivel: 300, agora }, C), { ok: true }, 'nível 300 inscreve');
  igual(podeInscrever({ nivel: 299, agora }, C), { ok: false, motivo: 'nivel' }, 'nível 299 não inscreve');
  igual(podeInscrever({ nivel: 900, inscrito: true, agora }, C), { ok: false, motivo: 'jaInscrito' }, 'inscrito não inscreve de novo');
  igual(podeInscrever({ nivel: 900, agora: brasilia(29, 0) }, C), { ok: false, motivo: 'encerradas' }, 'depois do prazo não inscreve');
  igual(podeInscrever({ nivel: 900, agora: brasilia(10, 0) }, C), { ok: false, motivo: 'naoAbriu' }, 'antes de abrir não inscreve');
  igual(C.premios, [1000, 500, 250], 'Mundial: premiação 1000/500/250');
  igual(campeonatoDe('amador', 2026, 10).premios, [300, 150, 50], 'Amador: premiação 300/150/50');
  igual(campeonatoDe('amador', 2026, 10).nivelMin, 100, 'Amador: nível 100');
}

console.log('o dia de análise');
{
  const C = campeonatoDe('mundial', 2026, 9);
  const brasilia = (dia, h, m = 0) => Date.UTC(2026, 8, dia, h + 3, m);
  // A ordem dos três instantes é a regra inteira: fecha, analisa, trava, luta.
  ok(C.inscricoesAte < C.equipeAte, 'inscrições fecham ANTES de a equipe travar');
  ok(C.equipeAte < C.lutasEm, 'a equipe trava ANTES da primeira onda');
  igual(C.inscricoesDe, brasilia(16, 0), 'inscrições abrem no dia 16');
  igual(C.inscricoesAte, brasilia(29, 0), 'inscrições: virada do 28 para o 29');
  igual(C.equipeAte, brasilia(29, 23), 'equipe: 29/09 às 23h');
  igual(C.lutasEm, brasilia(30, 0), 'lutas: 30/09 à meia-noite');

  // A equipe abre durante as inscrições E durante o dia de análise — é o ponto da janela.
  ok(equipeAberta(brasilia(20, 10), C), 'equipe abre durante as inscrições');
  ok(equipeAberta(brasilia(29, 0), C), 'equipe abre no instante em que a chave sai');
  ok(equipeAberta(brasilia(29, 22, 59), C), '29/09 22:59: ainda dá para trocar');
  ok(!equipeAberta(brasilia(29, 23), C), '29/09 23:00: travou');
  ok(!equipeAberta(brasilia(30, 0), C), 'na hora das lutas, travada');

  // A janela: só entre a chave existir e a primeira onda.
  igual(janelaDeAnalise(brasilia(28, 23, 59), C), null, 'antes de fechar não há janela');
  ok(janelaDeAnalise(brasilia(29, 0), C) !== null, '29/09 00:00: a janela abre com a chave');
  ok(janelaDeAnalise(brasilia(29, 23, 30), C)?.equipeAberta === false, '23:30: ainda é janela, mas a equipe travou');
  igual(janelaDeAnalise(brasilia(30, 0), C), null, 'na primeira onda a janela fecha');
  igual(Math.round((C.lutasEm - C.inscricoesAte) / 3_600_000), 24, 'a janela inteira dura 24h');
}

console.log('o calendário');
{
  // O Mundial #1 tem de continuar saindo EXATAMENTE como estava antes de o calendário existir:
  // é a edição que já tem 168 inscritos em produção, e o `id` dela é a chave no banco.
  const primeiro = campeonatoDe('mundial', 2026, 9);
  igual(primeiro.id, '2026-09-30', 'o Mundial #1 continua sendo 2026-09-30');
  igual(primeiro.numero, 1, 'e continua sendo o número 1');
  igual(primeiro.ultimoDiaInscricao, '2026-09-28', 'último dia de inscrição: 28/09');
  igual(primeiro.diaEquipe, '2026-09-29', 'dia de travar a equipe: 29/09');

  igual(campeonatoDe('mundial', 2026, 8), null, 'não existe Mundial antes do #1');
  igual(campeonatoDe('amador', 2026, 9), null, 'não existe Amador antes de outubro');
  igual(campeonatoDe('amador', 2026, 10).numero, 1, 'o Amador #1 é o de outubro');

  // O último dia do mês, em todo mês que tem armadilha.
  igual(campeonatoDe('mundial', 2027, 2).dia, '2027-02-28', 'fevereiro comum: dia 28');
  igual(campeonatoDe('mundial', 2028, 2).dia, '2028-02-29', 'fevereiro bissexto: dia 29');
  igual(campeonatoDe('mundial', 2027, 4).dia, '2027-04-30', 'abril: dia 30');
  igual(campeonatoDe('mundial', 2026, 12).dia, '2026-12-31', 'dezembro: dia 31');
  igual(ultimoDiaDoMes(2028, 2), 29, 'ultimoDiaDoMes acerta o bissexto');

  // A virada do ano: o fim de dezembro cai em janeiro.
  const dez = campeonatoDe('mundial', 2026, 12);
  igual(new Date(dez.fimEm).toISOString(), '2027-01-01T03:00:00.000Z', 'o Mundial de dezembro acaba em 01/01');

  // O Amador é sempre dia 15, e as datas dele são a MESMA conta do Mundial.
  for (const [a, m] of [[2026, 10], [2027, 2], [2027, 12]]) {
    const c = campeonatoDe('amador', a, m);
    igual(c.dia.slice(8), '15', `Amador ${a}-${m}: lutas no dia 15`);
    igual(c.ultimoDiaInscricao.slice(8), '13', `Amador ${a}-${m}: inscrições até o 13`);
    igual(c.diaEquipe.slice(8), '14', `Amador ${a}-${m}: equipe trava no 14`);
  }

  // O id volta a ser o campeonato, e só um id do calendário existe.
  igual(campeonatoPorId('2026-09-30')?.tipo, 'mundial', 'o id 2026-09-30 é o Mundial');
  igual(campeonatoPorId('2026-10-15')?.tipo, 'amador', 'o id 2026-10-15 é o Amador');
  igual(campeonatoPorId('2026-09-29'), null, 'um dia que não é de luta não é campeonato');
  igual(campeonatoPorId('2026-13-15'), null, 'mês 13 não existe');
  igual(campeonatoPorId(`2026-09-30'; DROP TABLE campeonato_chaves; --`), null,
    'id com SQL dentro não vira campeonato');
  igual(campeonatoPorId(''), null, 'id vazio não vira campeonato');
  igual(campeonatoPorId(null), null, 'id nulo não vira campeonato');

  // A lista: os vivos primeiro (do mais próximo ao mais longe), os mortos depois.
  const agora = Date.UTC(2026, 8, 21, 15);
  const lista = listaDeCampeonatos(agora);
  igual(lista.map((c) => c.id), ['2026-09-30', '2026-10-15', '2026-10-31'],
    'em 21/09 a lista é o Mundial de setembro e os dois de outubro');
  const depois = listaDeCampeonatos(Date.UTC(2026, 10, 20, 15));
  ok(depois[0].lutasEm > Date.UTC(2026, 10, 20, 15), 'em 20/11 o primeiro da lista ainda não aconteceu');
  ok(depois.some((c) => c.id === '2026-09-30'), 'e o Mundial de setembro continua na lista, como passado');
}

console.log('a janela das fitas');
{
  const agora = Date.UTC(2026, 8, 21, 15);
  const mundial = campeonatoPorId('2026-09-30');
  const amador = campeonatoPorId('2026-10-15');
  igual(proximoDepois(mundial, agora)?.id, '2026-10-15', 'depois do Mundial de setembro vem o Amador de outubro');
  igual(proximoDepois(amador, agora)?.id, '2026-10-31', 'e depois dele, o Mundial de outubro');
  // "até o dia 14", que é quando a chave do Amador é publicada.
  igual(replaysAte(mundial, agora), Date.UTC(2026, 9, 14, 3),
    'as fitas do Mundial de setembro valem até 14/10 00:00 (a chave do Amador)');
  ok(replaysAbertos(mundial, Date.UTC(2026, 9, 13, 20)), '13/10: ainda dá para assistir');
  ok(!replaysAbertos(mundial, Date.UTC(2026, 9, 14, 3)), '14/10 00:00: a janela fecha');
  ok(!replaysAbertos(mundial, Date.UTC(2026, 9, 20, 0)), '20/10: fechada');
  igual(replaysAte(amador, agora), Date.UTC(2026, 9, 30, 3),
    'as do Amador de outubro valem até 30/10 (a chave do Mundial)');
}

console.log('as restrições do Amador');
{
  const mundial = campeonatoDe('mundial', 2026, 9);
  const amador = campeonatoDe('amador', 2026, 10);
  const normal = { shiny: false, potencia: 3 };
  const shiny = { shiny: true, potencia: 2 };
  const p5 = { shiny: false, potencia: 5 };
  igual(porQueNaoPodeLutar(normal, amador), null, 'Amador aceita pokémon comum');
  igual(porQueNaoPodeLutar(shiny, amador), 'camp.recusa.semShiny', 'Amador recusa shiny');
  igual(porQueNaoPodeLutar(p5, amador), 'camp.recusa.semP5', 'Amador recusa P5');
  igual(porQueNaoPodeLutar({ shiny: 1, potencia: 1 }, amador), 'camp.recusa.semShiny',
    'shiny vindo do banco como 1 também é recusado');
  igual(porQueNaoPodeLutar(shiny, mundial), null, 'Mundial aceita shiny');
  igual(porQueNaoPodeLutar(p5, mundial), null, 'Mundial aceita P5');
  igual(porQueNaoPodeLutar(p5, null), null, 'sem campeonato não há restrição');
}

console.log(`\n${testes - falhas}/${testes} ok${falhas ? ` — ${falhas} FALHA(S)` : ''}`);
process.exit(falhas ? 1 : 0);
