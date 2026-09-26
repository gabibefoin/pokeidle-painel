// A ESCADA DO PvP RANQUEADO — pura aritmética, sem banco, sem Redis e sem socket.
//
// O que este teste protege, em ordem de "quanto dói se quebrar":
//
//   1. o ELO faz o que foi pedido: entre iguais move muito, o favorito que ganha leva pouco,
//      o azarão que ganha leva muito — e a soma continua fechando em zero;
//   2. a escada não tem buraco nem degrau em falso: todo PR cai em exatamente um rank, e a
//      barrinha nunca sai de 0..1;
//   3. o pareamento casa o par mais PRÓXIMO, dá a vez a quem esperou mais, e recusa mesma
//      casa / revanche / janela — as três travas anti-abuso;
//   4. a fila que abre com o tempo abre de verdade, e sempre pela paciência do menos paciente;
//   5. o piso, o escudo de tier e o posicionamento se comportam nas bordas;
//   6. a escada CONVERGE: 200 jogadores com força fixa e escondida, 6.000 partidas, e o
//      ranking final tem de bater com a força de verdade;
//   7. o duelo 1×1 roda mesmo na arena do ginásio e devolve uma fita que o cliente lê.
//
//   node tools/teste-pvp-rank.mjs
import {
  PVP_ESCUDO_TIER,
  PVP_PARTIDAS_POSICIONAMENTO,
  PVP_PONTOS_INICIAIS,
  PVP_PONTOS_MIN,
  PVP_PONTOS_POR_DIVISAO,
  PVP_ATRITO_DERROTA,
  PVP_DECAIMENTO_MS,
  PVP_PR_DIAMANTE,
  PVP_PR_ELITE,
  PVP_TETO_POSICIONAMENTO,
  PVP_TIERS,
  PVP_VAGAS_CHALLENGER,
  PVP_VAGAS_MESTRE,
  aceitamSeMutuamente,
  aplicarDelta,
  decaiEm,
  deltaDaPartida,
  expectativa,
  janelaDeBusca,
  kDoTier,
  pontosAposDecaimento,
  rankComVaga,
  rankDePontos,
  vagaDecaiu,
} from '../src/shared/pvp-rank.mjs';
import { emparelhar, _testeChaveDoPar } from '../src/server/game/pvp-ranqueado.mjs';
import { simularGuerra, arenaDeDuelo, VERSAO_REPLAY } from '../src/server/game/guild-pvp-sim.mjs';
import { especies, calcularStats, hpDeCombate, multDeNascenca } from '../src/server/content.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

// ------------------------------------------------------------------ 1. a escada

secao('A escada: sete tiers, três divisões embaixo, dois abertos em cima');

ok(PVP_TIERS.length === 7, 'são sete tiers');
ok(
  PVP_TIERS.map((t) => t.id).join(',') === 'bronze,prata,ouro,platina,diamante,mestre,challenger',
  'na ordem Bronze → Challenger',
);

const r0 = rankDePontos(0);
ok(r0.tierId === 'bronze' && r0.divisao === 1, 'PR 0 = Bronze I (a entrada da escada)');
ok(rankDePontos(-500).pontos === PVP_PONTOS_MIN, 'PR negativo é grampeado no piso');
// A numeração SOBE com o jogador: I é a entrada do tier, III é o degrau antes do próximo.
ok(rankDePontos(99).rotulo === 'bronze I', 'PR 99 ainda é Bronze I');
ok(rankDePontos(100).rotulo === 'bronze II', 'PR 100 vira Bronze II');
ok(rankDePontos(299).rotulo === 'bronze III', 'PR 299 é Bronze III — o topo do Bronze');
ok(rankDePontos(300).rotulo === 'prata I', 'PR 300 vira Prata I');
ok(
  rankDePontos(PVP_PONTOS_INICIAIS).rotulo === 'bronze I',
  'quem nunca jogou nasce no PÉ da escada — Bronze I',
);
ok(rankDePontos(600).rotulo === 'ouro I', 'PR 600 vira Ouro I');
ok(rankDePontos(1499).rotulo === 'diamante III', 'PR 1499 é Diamante III');
ok(rankDePontos(PVP_PR_ELITE).tierId === 'mestre', `PR ${PVP_PR_ELITE} abre a porta da elite`);
ok(rankDePontos(999_999).tierId === 'mestre', 'a elite é ABERTA — não há teto de pontos');
ok(rankDePontos(2000).progresso === null, 'a elite não desenha barrinha (não há faixa seguinte)');

// A escada inteira tem de caber na escala do Elo: do pé ao topo, uma diferença que descreva
// jogadores de verdade. Passar disso é dizer que o topo ganha cem mil vezes seguidas.
{
  const extremos = expectativa(PVP_TIERS[PVP_TIERS.length - 1].de, 0);
  ok(extremos < 0.99999, `do Bronze III ao Challenger: ${(extremos * 100).toFixed(3)}% — extremo, mas finito`);
}

// Varredura: nenhum PR pode cair fora de um rank, e a barra nunca sai de 0..1.
{
  let buracos = 0;
  let barraFora = 0;
  let saltos = 0;
  let anterior = null;
  for (let pr = 0; pr <= 5000; pr++) {
    const r = rankDePontos(pr);
    if (!r?.tierId) buracos++;
    if (r.progresso !== null && (r.progresso < 0 || r.progresso >= 1.0000001)) barraFora++;
    // A escada só pode subir: nunca um PR maior cair num tier menor.
    if (anterior && r.tierIdx < anterior.tierIdx) saltos++;
    anterior = r;
  }
  ok(buracos === 0, '5.001 valores de PR: nenhum sem rank');
  ok(barraFora === 0, 'a barra de progresso nunca sai de 0..1');
  ok(saltos === 0, 'a escada é monótona — mais PR nunca é um tier mais baixo');
}

// A fronteira de cada divisão bate com a largura declarada.
{
  let erros = 0;
  for (const tier of PVP_TIERS) {
    if (tier.divisoes !== 3) continue;
    for (let d = 0; d < 3; d++) {
      const dentro = rankDePontos(tier.de + d * PVP_PONTOS_POR_DIVISAO);
      const fim = rankDePontos(tier.de + (d + 1) * PVP_PONTOS_POR_DIVISAO - 1);
      if (dentro.divisao !== fim.divisao || dentro.tierId !== tier.id) erros++;
    }
  }
  ok(erros === 0, `cada divisão ocupa exatos ${PVP_PONTOS_POR_DIVISAO} PR`);
}

secao('O topo é por VAGA, não por pontos');
{
  const pr = PVP_PR_ELITE + 500;
  ok(rankComVaga(pr, 1).tierId === 'challenger', '1º lugar é Challenger');
  ok(
    rankComVaga(pr, PVP_VAGAS_CHALLENGER).tierId === 'challenger',
    `a ${PVP_VAGAS_CHALLENGER}ª posição ainda é Challenger`,
  );
  ok(
    rankComVaga(pr, PVP_VAGAS_CHALLENGER + 1).tierId === 'mestre',
    `a ${PVP_VAGAS_CHALLENGER + 1}ª já é Mestre`,
  );
  ok(rankComVaga(pr, PVP_VAGAS_MESTRE).tierId === 'mestre', `a ${PVP_VAGAS_MESTRE}ª é a última vaga de Mestre`);

  // O caso que dá sentido aos outros: tem os pontos, não tem a vaga.
  const semVaga = rankComVaga(pr, PVP_VAGAS_MESTRE + 1);
  ok(semVaga.rotulo === 'diamante III', 'passar dos pontos sem vaga fica em Diamante III');
  ok(semVaga.aguardandoVaga === true, 'e a tela sabe dizer que ele está esperando');
  ok(semVaga.faltamPosicoes === 1, 'com quantas posições faltam', `${semVaga.faltamPosicoes}`);
  ok(semVaga.pontos === pr, 'e os PONTOS dele continuam os de verdade');
  ok(rankComVaga(pr, 200).faltamPosicoes === 200 - PVP_VAGAS_MESTRE, 'a conta vale para qualquer posição');

  ok(rankComVaga(pr, 0).aguardandoVaga === true, 'sem posição conhecida, não há vaga a conceder');
  ok(rankComVaga(pr, null).aguardandoVaga === true, 'nem com `null`');

  // Abaixo da elite a posição é irrelevante — quem manda é o número, sempre.
  ok(rankComVaga(700, 1).rotulo === rankDePontos(700).rotulo, 'abaixo da elite a posição não muda nada');
  ok(rankComVaga(0, 1).rotulo === 'bronze I', 'nem o 1º lugar vira Challenger com 0 PR');
}

// ------------------------------------------------------------------- 2. o Elo

secao('O ELO: o que o pedido descreve, número por número');

const igual = { pontos: 1000, partidas: 50 };
{
  const { deltaA, deltaB } = deltaDaPartida(igual, { ...igual }, true);
  const kAqui = kDoTier(rankDePontos(igual.pontos).tierId);
  ok(deltaA === Math.round(kAqui / 2), `entre iguais o vencedor leva K/2 (+${deltaA} em ${rankDePontos(igual.pontos).rotulo})`);
  ok(
    deltaB === -Math.round((kAqui / 2) * PVP_ATRITO_DERROTA),
    `e o perdedor paga só ${PVP_ATRITO_DERROTA * 100}% disso (${deltaB})`,
  );
  ok(deltaA + deltaB > 0, 'a partida INJETA pontos — é o atrito que faz a escada subir do chão');
}

// O caso EXATO do pedido: um Challenger (1.900) contra um Mestre (1.600).
const challenger = { pontos: 1900, partidas: 200 };
const mestre = { pontos: 1600, partidas: 200 };
const chVence = deltaDaPartida(challenger, mestre, true);
const mestreVence = deltaDaPartida(challenger, mestre, false);

ok(
  chVence.deltaA > 0 && chVence.deltaA < mestreVence.deltaB,
  `o Challenger vencendo leva POUCO (+${chVence.deltaA}) — menos do que o Mestre levaria (+${mestreVence.deltaB})`,
);
ok(
  Math.abs(mestreVence.deltaA) > Math.abs(chVence.deltaB),
  `o Challenger PERDENDO paga caro (${mestreVence.deltaA}) — mais do que o Mestre paga ao perder (${chVence.deltaB})`,
);
ok(
  chVence.deltaA + chVence.deltaB > 0 && mestreVence.deltaA + mestreVence.deltaB > 0,
  'os dois cenários injetam pontos, e não destroem',
);
ok(
  expectativa(1900, 1600) > 0.8,
  `um tier de vantagem (300 PR) é ${(expectativa(1900, 1600) * 100).toFixed(1)}% de expectativa`,
);

// Nenhuma partida termina em "não aconteceu nada".
{
  const abismo = deltaDaPartida({ pontos: 2200, partidas: 99 }, { pontos: 0, partidas: 99 }, true);
  ok(abismo.deltaA >= 1 && abismo.deltaB <= -1, 'mesmo o abismo total move ao menos 1 PR para cada lado');
}

secao('K por tier: converge embaixo, estabiliza em cima');
ok(kDoTier('bronze') > kDoTier('challenger'), 'K do Bronze é maior que o do Challenger');
{
  const kBronze = deltaDaPartida({ pontos: 100, partidas: 50 }, { pontos: 100, partidas: 50 }, true);
  const kTopo = deltaDaPartida({ pontos: 1900, partidas: 50 }, { pontos: 1900, partidas: 50 }, true);
  ok(kBronze.deltaA > kTopo.deltaA, `Bronze move mais (${kBronze.deltaA}) que Challenger (${kTopo.deltaA})`);
}
{
  // Tiers distantes usam o K do MAIS ESTÁVEL: a mesma partida não pode valer duas réguas
  // diferentes dependendo de para quem se pergunta.
  const misto = deltaDaPartida({ pontos: 100, partidas: 50 }, { pontos: 1900, partidas: 50 }, false);
  const kMin = Math.min(kDoTier('bronze'), kDoTier('mestre'));
  ok(
    Math.abs(misto.deltaB) <= kMin && Math.abs(misto.deltaA) <= kMin,
    'Bronze × elite: os dois se movem pela régua do mais estável',
  );
}

secao('Posicionamento: cinco partidas, e o teto é Bronze III');
{
  const novato = { pontos: 400, partidas: 0 };
  const veterano = { pontos: 400, partidas: 99 };
  const d = deltaDaPartida(novato, veterano, true);
  const entreVeteranos = deltaDaPartida(veterano, { ...veterano }, true);
  ok(
    d.deltaA === entreVeteranos.deltaA && d.deltaB === entreVeteranos.deltaB,
    'o posicionamento NÃO move mais o dobro — vale o mesmo que entre veteranos',
  );

  // O pedido é literal: cinco vitórias seguidas na estreia não cospem ninguém no meio da
  // tabela. Cinco vitórias de 16 PR dariam 80 — mas mesmo um ganho absurdo para no teto.
  let linha = { pontos: 0, partidas: 0, escudo: 0, tierTopo: 0 };
  for (let i = 0; i < PVP_PARTIDAS_POSICIONAMENTO; i++) {
    linha = { ...linha, ...aplicarDelta(linha, 500), partidas: linha.partidas + 1 };
  }
  ok(
    linha.pontos === PVP_TETO_POSICIONAMENTO,
    `mesmo ganhando 500 por partida, o posicionamento para em ${PVP_TETO_POSICIONAMENTO} PR`,
    `${linha.pontos}`,
  );
  ok(rankDePontos(linha.pontos).rotulo === 'bronze III', 'ou seja: a estreia vai no máximo até Bronze III');
  ok(rankDePontos(0).rotulo === 'bronze I', 'e começa no Bronze I');

  // O TETO NÃO PODE DERRUBAR NINGUÉM. Foi o bug relatado da tela: uma linha acima do teto
  // (herdada de uma escada anterior) transformava uma VITÓRIA em "-601 PR · você caiu de
  // tier". Um teto que puxa para baixo não é teto, é punição por ter ganhado.
  const acimaDoTeto = aplicarDelta(
    { pontos: 700, partidas: 1, escudo: 0, tierTopo: 0 }, 16,
  );
  ok(acimaDoTeto.deltaAplicado >= 0, 'quem está acima do teto NÃO perde pontos ao vencer',
    `${acimaDoTeto.deltaAplicado}`);
  ok(acimaDoTeto.pontos === 700, 'ele simplesmente não sobe — para onde estava', `${acimaDoTeto.pontos}`);
  const acimaPerdendo = aplicarDelta({ pontos: 700, partidas: 1, escudo: 0, tierTopo: 0 }, -11);
  ok(acimaPerdendo.pontos === 689, 'e perder continua custando o normal', `${acimaPerdendo.pontos}`);

  // Passada a quinta, o caminho abre.
  const livre = aplicarDelta({ ...linha, partidas: PVP_PARTIDAS_POSICIONAMENTO }, 500);
  ok(livre.pontos > PVP_TETO_POSICIONAMENTO, 'da sexta partida em diante o teto some', `${livre.pontos}`);
}

secao('Revanche paga INTEIRO — e a mesma casa continua zerando');
{
  // O peso de revanche (2ª partida valendo metade, 5ª valendo nada) FOI RETIRADO. Ele existia
  // contra duas contas combinadas e, numa população pequena, acertava o alvo errado: o topo da
  // tabela se reencontra por não haver mais ninguém na faixa, e passava a jogar de graça —
  // relatado em produção com quatro vitórias seguidas valendo +0.
  const a = { pontos: 700, partidas: 50 };
  const b = { pontos: 700, partidas: 50 };
  const primeira = deltaDaPartida(a, b, true);
  const decima = deltaDaPartida(a, b, true);
  ok(
    decima.deltaA === primeira.deltaA && decima.deltaA > 0,
    `a décima partida contra o mesmo oponente paga igual à primeira (${primeira.deltaA} PR)`,
  );

  // A conta continua sendo o Elo puro: quem está ACIMA ganha pouco ao vencer quem está abaixo,
  // e quem está abaixo ganha muito ao vencer quem está acima. É o pedido, e é o que sobrou.
  const alto = { pontos: 290, partidas: 50 };   // Bronze III
  const baixo = { pontos: 10, partidas: 50 };   // Bronze I
  const favoritoVence = deltaDaPartida(alto, baixo, true);
  const zebra = deltaDaPartida(alto, baixo, false);
  ok(
    favoritoVence.deltaA < Math.abs(zebra.deltaB),
    `o de cima ganha POUCO ao vencer o de baixo (+${favoritoVence.deltaA}), e o de baixo ganha MUITO ao virar (+${zebra.deltaB})`,
  );
  const iguais = deltaDaPartida(a, b, true);
  ok(iguais.deltaA > favoritoVence.deltaA, 'e dois do mesmo rank trocam o valor padrão, maior que o do favorito');

  // O zero da MESMA CASA sobrevive à retirada, e continua sendo zero de verdade — não o piso
  // de 1 PR. 1 PR por partida, com duas contas do mesmo dono rodando o dia inteiro, é torneira
  // aberta, e é este teste que impede que o piso volte a valer ali.
  const casa = deltaDaPartida(a, b, true, 0);
  ok(casa.deltaA === 0 && casa.deltaB === 0, 'mesma casa NÃO move 1 PR — move ZERO');
}

// -------------------------------------------------------- 3. piso e escudo

secao('Piso e escudo de rebaixamento');
{
  const noChao = aplicarDelta({ pontos: 5, escudo: 0, tierTopo: 0, partidas: 99 }, -40);
  ok(noChao.pontos === PVP_PONTOS_MIN, 'perder no fundo do Bronze para no piso, não vira negativo');
  ok(noChao.deltaAplicado === -5, 'e o delta APLICADO diz a verdade (-5, não -40)');
}
{
  // Promoveu para Ouro (600): ganha o escudo. A derrota seguinte para no piso do tier.
  const promo = aplicarDelta({ pontos: 590, escudo: 0, tierTopo: 1, partidas: 99 }, 20);
  ok(promo.promoveu && promo.escudo === PVP_ESCUDO_TIER, 'promover a um tier inédito dá o escudo');
  ok(promo.tierTopo === 2, 'e registra o novo topo alcançado');

  const protegida = aplicarDelta({ pontos: 605, escudo: 1, tierTopo: 2, partidas: 99 }, -30);
  ok(protegida.pontos === 600 && protegida.escudoUsou, 'a 1ª derrota no piso do Ouro é segurada');
  ok(!protegida.rebaixou, 'e não rebaixa');
  ok(protegida.escudo === 0, 'e o escudo é GASTO — não protege duas vezes');

  const semEscudo = aplicarDelta({ pontos: 600, escudo: 0, tierTopo: 2, partidas: 99 }, -30);
  ok(semEscudo.pontos === 570 && semEscudo.rebaixou, 'gasto o escudo, a próxima derrota cai mesmo');

  const revolta = aplicarDelta({ pontos: 610, escudo: 0, tierTopo: 2, partidas: 99 }, 200);
  ok(revolta.escudo === 0, 'voltar a um tier que já foi o topo NÃO devolve escudo de graça');

  // Linha sem `tierTopo` (a de quem nunca promoveu, e a que um banco antigo devolveria). O
  // perigo aqui é silencioso: `Number(undefined)` é NaN, `??` não pega NaN, e o NaN acabaria
  // numa coluna INT — derrubando a transação que grava a partida INTEIRA, para os dois lados.
  const semCampo = aplicarDelta({ pontos: 590, partidas: 99 }, 20);
  ok(Number.isFinite(semCampo.tierTopo), 'linha sem `tierTopo` não vira NaN', `${semCampo.tierTopo}`);
  // E a linha sem `partidas` NÃO pode ser confundida com "está posicionando": o teto de 99
  // PR cairia sobre um veterano sem uma única mensagem de erro.
  const semPartidas = aplicarDelta({ pontos: 900, escudo: 0, tierTopo: 3 }, 30);
  ok(semPartidas.pontos === 930, 'linha sem `partidas` não leva o teto do posicionamento', `${semPartidas.pontos}`);
  ok(Number.isFinite(semCampo.escudo) && Number.isFinite(semCampo.pontos), 'nem `escudo` nem `pontos`');
  ok(semCampo.promoveu && semCampo.escudo === PVP_ESCUDO_TIER, 'e o escudo é concedido do mesmo jeito');
}

// --------------------------------------------------------- 4. a janela

secao('A janela de busca abre com a espera');
{
  let monotona = true;
  let ant = -1;
  for (let ms = 0; ms <= 500_000; ms += 1000) {
    const j = janelaDeBusca(ms);
    if (j < ant) monotona = false;
    ant = j;
  }
  ok(monotona, 'a janela nunca encolhe com o tempo');
  ok(janelaDeBusca(0) === 25, 'começa em 25 PR — um quarto de divisão');
  ok(janelaDeBusca(5 * 60_000) === 100, 'aos 5 min chega a UMA divisão (100)');
  ok(janelaDeBusca(30 * 60_000) === 250, 'aos 30 min abre para 250');
  ok(janelaDeBusca(60 * 60_000) === 400, 'a 1 h, 400 — pouco mais de um tier');
  ok(!Number.isFinite(janelaDeBusca(6 * 60 * 60_000)), 'só às 6 h aceita qualquer rank');
  ok(janelaDeBusca(3 * 60_000) > 50 && janelaDeBusca(3 * 60_000) < 100, 'entre os degraus ela INTERPOLA');

  // O motivo de toda esta seção existir: a curva anterior abria em MINUTOS, e em quatro
  // deles um Bronze III já podia encontrar um Challenger. Se isso acontece, o emblema não
  // separa ninguém de ninguém.
  ok(
    janelaDeBusca(4 * 60_000) < PVP_PONTOS_POR_DIVISAO,
    `aos 4 min a busca ainda cabe numa divisão (${Math.round(janelaDeBusca(4 * 60_000))} PR)`,
  );
  ok(
    janelaDeBusca(30 * 60_000) < 300,
    'e aos 30 min ainda não atravessa um tier inteiro',
  );
}
{
  const SEIS_H = 6 * 60 * 60_000;
  const paciente = { pontos: 1900, desde: 0 };
  const recemChegado = { pontos: 400, desde: SEIS_H - 60_000 };
  ok(
    !aceitamSeMutuamente(paciente, recemChegado, SEIS_H),
    'quem acabou de entrar NÃO é arrastado para a partida de quem esperou 6 h',
  );
  ok(
    aceitamSeMutuamente({ pontos: 1900, desde: 0 }, { pontos: 400, desde: 0 }, SEIS_H),
    'mas dois que esperaram 6 h se aceitam',
  );
}

// ------------------------------------------------------- 5. o pareamento

secao('Pareamento: o mais próximo, com a vez de quem esperou mais');

const entrada = (key, pontos, esperaMs, ip = null) => ({
  key, nick: key, dbId: key.charCodeAt(0) * 1000 + pontos, pontos, desde: -esperaMs, ip,
});

{
  // Quatro jogadores, dois pares óbvios. A janela está aberta o bastante para qualquer
  // combinação — quem tem de decidir é a proximidade, não o que "cabe".
  const fila = [
    entrada('alto1', 1500, 25_000_000),
    entrada('baixo1', 200, 25_000_000),
    entrada('alto2', 1520, 25_000_000),
    entrada('baixo2', 190, 25_000_000),
  ];
  const pares = emparelhar(fila, 0);
  const casou = (x, y) => pares.some(([a, b]) => (a.key === x && b.key === y) || (a.key === y && b.key === x));
  ok(pares.length === 2, 'dois pares saem de quatro candidatos');
  ok(casou('alto1', 'alto2') && casou('baixo1', 'baixo2'), 'e cada um vai com o mais PRÓXIMO em PR');
}

{
  // O caso que a ordem por espera existe para resolver: o único Challenger contra uma fila de
  // Ouro. Enquanto os Ouro são recém-chegados, a janela DELES recusa — e recusar é o certo:
  // ninguém é arrastado para uma partida desequilibrada nos primeiros segundos de fila.
  const fila = [
    entrada('challenger', 1900, 25_000_000),
    entrada('ouro1', 650, 5_000),
    entrada('ouro2', 660, 5_000),
  ];
  const pares = emparelhar(fila, 0);
  ok(
    pares.length === 1 && !pares[0].some((e) => e.key === 'challenger'),
    'o Challenger paciente NÃO arrasta os Ouro recém-chegados; eles casam entre si',
  );

  // Com todos esperando o bastante, aí sim: quem espera há mais tempo escolhe primeiro.
  const todosEsperando = [
    entrada('challenger', 1900, 25_000_000),
    entrada('ouro1', 650, 25_000_000),
    entrada('ouro2', 660, 25_000_000),
  ];
  const p2 = emparelhar(todosEsperando, 0);
  ok(p2.length >= 1 && p2[0][0].key === 'challenger', 'quem espera há mais tempo escolhe primeiro');
}

// ------------------------------------------- a chave de dev do bloqueio de revanche
{
  // `PVP_SEM_REVANCHE` existe para dar para testar o PvP com duas contas sem esperar dez
  // minutos por partida. O que este teste guarda NÃO é a conveniência — é a trava: ligada num
  // `.env` de produção por engano, ela deixaria duas contas combinadas se enfrentarem sem
  // intervalo. Por isso o valor é lido com `NODE_ENV !== 'production'` no `config.mjs`, e é
  // esse `&&` que não pode ser removido sem o teste gritar.
  //
  // Roda em processo filho porque `config` é lido UMA vez, na carga do módulo: trocar
  // `process.env` depois do import não mudaria nada.
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const raizGame = fileURLToPath(new URL('..', import.meta.url));
  const ler = (env) => {
    const saida = execFileSync(
      process.execPath,
      ['-e', "import('./src/server/config.mjs').then(m=>{console.log('PSR='+(m.config.pvpSemRevanche?'1':'0'));process.exit(0)})"],
      { cwd: raizGame, env: { ...process.env, ...env }, encoding: 'utf8' },
    );
    // O `content.mjs` cospe duas linhas de carga antes; o que interessa é a marcada.
    return (saida.match(/PSR=([01])/) ?? [])[1];
  };

  ok(ler({ PVP_SEM_REVANCHE: '1', NODE_ENV: 'development' }) === '1',
    'em desenvolvimento, PVP_SEM_REVANCHE=1 desliga a espera de revanche');
  ok(ler({ PVP_SEM_REVANCHE: '1', NODE_ENV: 'production' }) === '0',
    'em PRODUÇÃO a mesma variável é IGNORADA — a espera continua de pé');
  // O caso que de fato importa nesta instalação: a produção do PokeIdle NÃO define `NODE_ENV`.
  // Com a guarda escrita como `!== 'production'`, este caso daria LIGADO no servidor real.
  ok(ler({ PVP_SEM_REVANCHE: '1', NODE_ENV: '' }) === '0',
    'e sem NODE_ENV nenhum ela também é ignorada — a guarda é positiva, não por ausência');
  ok(ler({ PVP_SEM_REVANCHE: '', NODE_ENV: 'development' }) === '0',
    'e sem a variável o padrão é a espera ligada');
}

{
  // A mesma casa deixou de ser um BLOQUEIO e virou último recurso: as duas contas se
  // encontram quando não sobrou mais ninguém, e a partida delas não vale ponto (o peso zero
  // é aplicado em `rodarPartida`). O bloqueio duro impedia o dono do jogo de testar o próprio
  // PvP e condenava irmãos e lan house a uma fila que nunca anda.
  const mesmaCasa = [
    entrada('conta1', 500, 25_000_000, 'casa-a'),
    entrada('conta2', 500, 25_000_000, 'casa-a'),
  ];
  ok(emparelhar(mesmaCasa, 0).length === 1, 'sozinhas na fila, duas contas da mesma casa SE ENCONTRAM');

  const comTerceiro = [...mesmaCasa, entrada('outro', 500, 25_000_000, 'casa-b')];
  const pares = emparelhar(comTerceiro, 0);
  ok(pares.length === 1, 'com um terceiro na fila, sai UM par');
  ok(
    pares[0].some((e) => e.key === 'outro'),
    'e ele é com quem vem de FORA — a casa é sempre a última opção',
  );

  // A distância em pontos não inverte a prioridade: o de fora ganha mesmo estando mais longe.
  const casaPerto = [
    entrada('conta1', 500, 25_000_000, 'casa-a'),
    entrada('conta2', 501, 25_000_000, 'casa-a'),
    entrada('longe', 560, 25_000_000, 'casa-b'),
  ];
  const p2 = emparelhar(casaPerto, 0);
  ok(
    p2.length === 1 && p2[0].some((e) => e.key === 'longe'),
    'e vale mesmo quando o par doméstico está mais perto em PR',
  );
}

{
  const par = [entrada('a', 500, 25_000_000), entrada('b', 500, 25_000_000)];
  // Os rivais recentes vêm POR JOGADOR (`Map<key, Set<key>>`), e não por par: com a chave por
  // par o pareador precisava perguntar ao Redis por N·(N−1)/2 chaves a cada passada, e com 500
  // na fila o `mget` estourava a pilha do Node — desligando o bloqueio em silêncio.
  const rivais = new Map([['a', new Set(['b'])], ['b', new Set(['a'])]]);
    // `semRevanche: false` EXPLÍCITO nos três: sem isso, um `.env` de desenvolvimento com
  // `PVP_SEM_REVANCHE=1` desligaria justamente os testes que guardam o bloqueio, em silêncio.
  ok(emparelhar(par, 0, rivais, { semRevanche: false }).length === 0, 'o par de bloqueio de revanche não casa');
  ok(
    emparelhar([par[1], par[0]], 0, rivais, { semRevanche: false }).length === 0,
    'inverter a fila não fura o bloqueio',
  );
  // O registro é nos DOIS sentidos. Se só um lado soubesse, bastaria a ordem da fila mudar
  // para o par escapar — e a ordem muda a cada passada, porque é por tempo de espera.
  const soUmLado = new Map([['a', new Set(['b'])]]);
  ok(emparelhar(par, 0, soUmLado, { semRevanche: false }).length === 0, 'e basta UM dos lados lembrar para o par não sair');

  ok(
    _testeChaveDoPar('b', 'a') === _testeChaveDoPar('a', 'b'),
    'a chave do CONTADOR de encontros continua igual nas duas ordens',
  );
}

{
  const distantes = [entrada('a', 200, 0), entrada('b', 1500, 0)];
  ok(emparelhar(distantes, 0).length === 0, 'recém-chegados distantes não casam (janela de 40 PR)');
}

{
  const sozinho = [entrada('a', 500, 25_000_000)];
  ok(emparelhar(sozinho, 0).length === 0, 'ninguém joga contra si mesmo');
}

{
  // Um jogador não pode sair em dois pares da mesma passada.
  const fila = [
    entrada('a', 500, 25_000_000), entrada('b', 500, 25_000_000),
    entrada('c', 500, 25_000_000), entrada('d', 500, 25_000_000), entrada('e', 500, 25_000_000),
  ];
  const pares = emparelhar(fila, 0);
  const vistos = pares.flat().map((x) => x.key);
  ok(new Set(vistos).size === vistos.length, 'ninguém aparece em dois pares da mesma passada');
  ok(pares.length === 2, 'cinco candidatos rendem dois pares (um sobra para a próxima)');
}

// ------------------------------------------------- 6. a escada converge

secao('A escada sobe: progressão, ordem e a escassez do topo');
{
  // O teste que mais pesa no arquivo, e o que já reprovou DUAS versões desta escada.
  //
  // A primeira espalhava os tiers por 3.500 PR e espremia todo mundo em dois deles — a
  // fórmula do Elo não tem essa amplitude para dar. A segunda começava todo mundo no chão com
  // Elo de soma zero, e aí a população simplesmente NÃO SUBIA: com 300 partidas por jogador o
  // melhor de 200 chegava a 578 PR, e Diamante para cima era inalcançável para qualquer um.
  //
  // O que se mede aqui, então, são as três coisas que a escada precisa fazer ao mesmo tempo:
  // subir, ordenar por mérito, e manter o topo escasso mesmo enquanto o número infla.
  const N = 160;
  const PARTIDAS_POR_JOGADOR = 500;
  const SIGMA = 250;

  let semente = 20260910;
  const rnd = () => {
    semente = (semente * 1664525 + 1013904223) % 4294967296;
    return semente / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

  // A força verdadeira é um sino, como gente é. Ela NÃO tem a mesma unidade do PR aqui: o PR
  // infla com o tempo e a força não, então o que se pode exigir é a ORDEM, não a distância.
  const jogadores = Array.from({ length: N }, (_, i) => ({
    key: `j${i}`,
    real: Math.round(normal() * SIGMA),
    pontos: PVP_PONTOS_INICIAIS,
    partidas: 0,
    escudo: 0,
    tierTopo: 0,
  }));

  let agora = 0;
  let partidas = 0;
  const alvo = (N * PARTIDAS_POR_JOGADOR) / 2;
  while (partidas < alvo) {
    agora += 30_000;
    const fila = [];
    while (fila.length < 12) {
      const j = jogadores[Math.floor(rnd() * N)];
      if (fila.some((f) => f.key === j.key)) continue;
      // Esperas de até 2 h: com a curva nova, é o que faz a janela abrir o suficiente para a
      // fila andar. É também a leitura honesta do que o jogo vai ser — fila longa, com a
      // fila automática ligada.
      fila.push({ key: j.key, dbId: 0, pontos: j.pontos, desde: agora - rnd() * 2 * 60 * 60_000, ip: null });
    }
    for (const [a, b] of emparelhar(fila, agora)) {
      const ja = jogadores.find((x) => x.key === a.key);
      const jb = jogadores.find((x) => x.key === b.key);
      const venceuA = rnd() < expectativa(ja.real, jb.real);
      const { deltaA, deltaB } = deltaDaPartida(ja, jb, venceuA);
      const ra = aplicarDelta(ja, deltaA);
      const rb = aplicarDelta(jb, deltaB);
      ja.pontos = ra.pontos; ja.escudo = ra.escudo; ja.tierTopo = ra.tierTopo; ja.partidas++;
      jb.pontos = rb.pontos; jb.escudo = rb.escudo; jb.tierTopo = rb.tierTopo; jb.partidas++;
      partidas++;
    }
  }

  const jogaram = jogadores.filter((j) => j.partidas >= PVP_PARTIDAS_POSICIONAMENTO);
  const ordenado = [...jogaram].sort((a, b) => a.pontos - b.pontos);
  const mediana = ordenado[Math.floor(jogaram.length / 2)];

  ok(jogaram.length === N, `os ${N} jogadores saíram do posicionamento (${partidas} partidas)`);

  // 1. SOBE. É a propriedade que a versão de soma zero não tinha.
  ok(
    mediana.pontos > PVP_PONTOS_INICIAIS + 400,
    `a população sobe do chão — a mediana chegou a ${mediana.pontos} PR`,
    `mediana ${mediana.pontos}`,
  );
  ok(
    ordenado[ordenado.length - 1].pontos >= PVP_PR_ELITE,
    `e o topo alcança a porta da elite (${ordenado[ordenado.length - 1].pontos} PR)`,
  );

  // 2. ORDENA. Distância não dá para exigir (o PR infla, a força não); ordem, sim.
  const posto = (lista, chave) => {
    const ord = [...lista].sort((x, y) => x[chave] - y[chave]);
    return new Map(ord.map((j, i) => [j.key, i]));
  };
  const pf = posto(jogaram, 'real');
  const pp = posto(jogaram, 'pontos');
  const n = jogaram.length;
  const somaD2 = jogaram.reduce((s, j) => s + (pf.get(j.key) - pp.get(j.key)) ** 2, 0);
  const rho = 1 - (6 * somaD2) / (n * (n * n - 1));
  ok(rho > 0.85, `o PR ordena por mérito (Spearman ρ = ${rho.toFixed(3)})`, 'ρ ≤ 0,85');

  const topReal = new Set([...jogaram].sort((a, b) => b.real - a.real).slice(0, 10).map((j) => j.key));
  const topPr = new Set([...jogaram].sort((a, b) => b.pontos - a.pontos).slice(0, 25).map((j) => j.key));
  const acertos = [...topReal].filter((k) => topPr.has(k)).length;
  ok(acertos >= 8, `${acertos}/10 dos mais fortes de verdade terminam no top 25 da tabela`);

  ok(jogadores.every((j) => j.pontos >= PVP_PONTOS_MIN), 'ninguém furou o piso');

  const tiers = new Map();
  for (const j of jogaram) {
    const id = rankDePontos(j.pontos).tierId;
    tiers.set(id, (tiers.get(id) ?? 0) + 1);
  }
  ok(tiers.size >= 3, `a população se espalhou por ${tiers.size} faixas de pontos`);
  console.log(`      distribuição por PONTOS: ${PVP_TIERS.map((t) => `${t.id} ${tiers.get(t.id) ?? 0}`).filter((x) => !x.endsWith(' 0')).join(' · ')}`);

  // 3. O TOPO CONTINUA ESCASSO. Esta é a razão de Mestre e Challenger serem por VAGA: o
  // número infla com o tempo, e nenhum limiar de pontos sobrevive a isso. A posição sobrevive.
  const porPr = [...jogaram].sort((a, b) => b.pontos - a.pontos || a.key.localeCompare(b.key));
  const comVaga = porPr.map((j, i) => rankComVaga(j.pontos, i + 1));
  const challengers = comVaga.filter((r) => r.tierId === 'challenger').length;
  const mestres = comVaga.filter((r) => r.tierId === 'mestre').length;
  const esperando = comVaga.filter((r) => r.aguardandoVaga).length;

  ok(
    challengers <= PVP_VAGAS_CHALLENGER,
    `no máximo ${PVP_VAGAS_CHALLENGER} Challengers, aconteça o que acontecer com os pontos (${challengers})`,
  );
  ok(
    challengers + mestres <= PVP_VAGAS_MESTRE,
    `e no máximo ${PVP_VAGAS_MESTRE} entre Mestre e Challenger (${challengers + mestres})`,
  );
  console.log(
    `      topo: ${challengers} challenger · ${mestres} mestre · ${esperando} com os pontos, esperando vaga`,
  );
}

secao('O atrito: quem ganha metade sobe, quem ganha pouco desce');
{
  // A regra que faz a escada subir tem um lado que precisa ser verdade também: ela não pode
  // fazer TODO MUNDO subir. Quem perde mais do que ganha tem de cair.
  const simular = (taxaVitoria, partidas) => {
    let linha = { pontos: 800, partidas: 99, escudo: 0, tierTopo: 2 };
    let semente = 7;
    const rnd = () => {
      semente = (semente * 1664525 + 1013904223) % 4294967296;
      return semente / 4294967296;
    };
    for (let i = 0; i < partidas; i++) {
      // Sempre contra um igual: isola o efeito do atrito do efeito do emparelhamento.
      const oponente = { pontos: linha.pontos, partidas: 99 };
      const venceu = rnd() < taxaVitoria;
      const { deltaA } = deltaDaPartida(linha, oponente, venceu);
      linha = { ...linha, ...aplicarDelta(linha, deltaA) };
    }
    return linha.pontos;
  };

  const meioAMeio = simular(0.5, 400);
  ok(meioAMeio > 800, `ganhando metade das partidas, sobe (${meioAMeio} PR depois de 400)`);
  const ganhando = simular(0.65, 400);
  ok(ganhando > meioAMeio, `ganhando 65%, sobe mais rápido (${ganhando} PR)`);
  const perdendo = simular(0.25, 400);
  ok(perdendo < 800, `ganhando só 25%, DESCE (${perdendo} PR)`, `${perdendo}`);
  ok(
    PVP_ATRITO_DERROTA > 0 && PVP_ATRITO_DERROTA < 1,
    `o atrito é uma fração de verdade (${PVP_ATRITO_DERROTA})`,
  );
}


// ------------------------------------------------ 7. o duelo roda mesmo

secao('O duelo 1×1 na arena do ginásio');
{
  const IVS = { hp: 24, atk: 24, def: 24, spAtk: 24, spDef: 24, speed: 24 };
  const pk = (nome, nivel) => {
    const esp = [...especies.values()].find((e) => e.name.toLowerCase() === nome.toLowerCase());
    if (!esp) throw new Error(`espécie ausente no espelho: ${nome}`);
    const stats = calcularStats(esp, IVS, nivel, 1, multDeNascenca(1, false), {});
    return {
      id: Math.floor(Math.random() * 1e9),
      speciesId: esp.pokeId,
      nome: esp.name,
      looktype: esp.looktype,
      lookShiny: null,
      tipos: [esp.type1, esp.type2].filter(Boolean),
      level: nivel,
      shiny: false,
      stats,
      maxHp: hpDeCombate(stats.hp),
      tmElemental: null,
    };
  };
  const lado = (id, nick, equipe) => ({
    id, nome: nick, brasao: null,
    membros: [{ playerId: id, nick, looktype: 159, visual: null, equipe }],
  });

  const arena = arenaDeDuelo();
  const r = await simularGuerra(
    [
      lado(1, 'Ash', [pk('Charizard', 150), pk('Pikachu', 150), pk('Snorlax', 150), pk('Lapras', 150), pk('Venusaur', 150)]),
      lado(2, 'Gary', [pk('Blastoise', 150), pk('Alakazam', 150), pk('Arcanine', 150), pk('Gyarados', 150), pk('Machamp', 150)]),
    ],
    { arenaSlug: arena.slug, gradeInteira: arena.gradeInteira, ordemFixa: true },
  );

  ok(r.vencedorId === 1 || r.vencedorId === 2, 'a partida termina com um vencedor');
  ok(r.replay?.v === VERSAO_REPLAY, 'a fita sai na versão que o cliente sabe ler');
  ok(r.replay.atores.length === 4, 'quatro atores: dois pokémon e dois treinadores');
  ok(r.replay.quadros.length > 0, `a fita tem ${r.replay.quadros.length} quadros`);
  ok(r.placar.length === 2 && r.placar[0].pos === 1, 'o placar traz os dois lados, o vencedor em 1º');
  ok(r.duracaoMs > 0 && r.duracaoMs <= 5 * 60_000, `durou ${(r.duracaoMs / 1000).toFixed(1)} s`);

  const kb = Buffer.byteLength(JSON.stringify(r.replay)) / 1024;
  ok(kb < 200, `a fita cabe na rede (${kb.toFixed(1)} KB)`, 'passou de 200 KB');
  console.log(`      arena: ${arena.slug} (grade ${arena.gradeInteira ? 'inteira' : 'recortada'})`);
}

// ------------------------------------------------------- a queda por inatividade

secao('Um dia sem jogar: cai para UM ACIMA do primeiro Diamante');
{
  ok(PVP_PR_DIAMANTE === 1200, 'o Diamante começa em 1.200 PR', `${PVP_PR_DIAMANTE}`);
  ok(pontosAposDecaimento(1450) === 1451, 'primeiro Diamante com 1.450 → quem cai fica com 1.451');
  ok(rankDePontos(pontosAposDecaimento(1450)).tierId === 'diamante', 'e 1.451 é Diamante de fato');
  ok(pontosAposDecaimento(1499) === PVP_PR_ELITE - 1,
    'primeiro Diamante no 1.499 → empata no teto, e NÃO volta aos pontos de elite',
    `${pontosAposDecaimento(1499)}`);
  ok(pontosAposDecaimento(950) === PVP_PR_DIAMANTE,
    'sem Diamante na tabela (o primeiro abaixo é Platina) → cai no Diamante I, não na Platina',
    `${pontosAposDecaimento(950)}`);
  ok(pontosAposDecaimento(0) === PVP_PR_DIAMANTE, 'tabela vazia abaixo da elite → Diamante I');
  ok(pontosAposDecaimento(null) === PVP_PR_DIAMANTE, 'e sem número nenhum também');

  // Três caem na mesma passada: o de menos pontos leva o degrau 1, e a ordem entre eles fica.
  const juntos = [3, 2, 1].map((d) => pontosAposDecaimento(1300, d));
  ok(juntos.join(',') === '1303,1302,1301', 'quem cai junto mantém a ordem entre si', juntos.join(','));
  ok(pontosAposDecaimento(1498, 5) === 1499, 'e o degrau nunca fura o teto');
}

secao('O relógio da queda');
{
  const t0 = Date.parse('2026-09-18T12:00:00Z');
  ok(decaiEm(t0, 'challenger') === t0 + PVP_DECAIMENTO_MS, 'Challenger: 24 h depois da última partida');
  ok(decaiEm(new Date(t0).toISOString(), 'mestre') === t0 + PVP_DECAIMENTO_MS,
    'Mestre também, e aceita o carimbo como texto (é assim que o banco o devolve)');
  ok(decaiEm(t0, 'diamante') === null, 'Diamante não tem relógio — mesmo com pontos de elite esperando vaga');
  ok(decaiEm(t0, 'ouro') === null, 'nem ninguém de baixo');
  ok(decaiEm(null, 'challenger') === null, 'sem partida nenhuma, sem relógio');

  // O relógio e o emblema falam a mesma coisa no mesmo instante.
  const prazo = decaiEm(t0, 'challenger');
  ok(!vagaDecaiu(t0, prazo - 1), 'um milissegundo antes do prazo a vaga ainda é dele');
  ok(vagaDecaiu(t0, prazo), 'no prazo, o emblema cai');
}

// ------------------------------------------------------------------ fim

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
