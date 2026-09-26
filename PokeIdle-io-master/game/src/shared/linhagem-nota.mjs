// O PISO DA LINHAGEM — evoluir sempre SOBE o N=, nunca derruba e nunca empata.
//
// ### O que estava acontecendo
//
// A nota é uma POSIÇÃO DENTRO DA ESPÉCIE: 0 é o pior nascimento possível dela, 10 é o melhor.
// Cada espécie tem a sua régua, e a régua muda quando as bases mudam — então o MESMO
// nascimento não cai no mesmo ponto em duas formas da mesma cadeia.
//
// A causa é que os quatro eixos do nascimento não entram na conta do mesmo jeito:
//
//   soma = Σ (base_k + 2 × iv_k) × qualidade^expo × multPotência × multShiny
//            └──── ADITIVO ────┘   └─────────── MULTIPLICATIVO ───────────┘
//
// O IV é SOMADO à base; qualidade, potência e shiny MULTIPLICAM o total. Quando a evolução
// levanta a base, ela dilui o que é somado e não toca no que é multiplicado. O peso do IV na
// régua encolhe, o dos outros três fica igual — e a nota desliza na direção deles.
//
// O resultado, medido em Magmar → Magmortar (base 495 → 540):
//
//   · nascimento com qualidade/potência/shiny NO TETO → evoluir SOBE a nota (+0,17 a +0,23)
//   · nascimento com IV alto e os outros três NO PISO → evoluir DESCE a nota (−0,02 a −0,07)
//
// Ou seja: quem nasceu com o IV relativamente melhor que o resto perdia nota ao evoluir,
// porque justamente o eixo em que ele era forte passava a valer menos. Não era erro de conta
// em lugar nenhum — era a régua da espécie nova medindo diferente.
//
// Isso nunca foi visível na maior parte do catálogo porque quase toda evolução levanta MUITO a
// base, e aí o ganho multiplicativo da régua nova cobre a diluição. Aparecia nas cadeias de
// degrau curto — em geral as que ganharam um elo entre gerações (Magmar → Magmortar, Electabuzz
// → Electivire, Rhydon → Rhyperior, Scyther → Scizor), onde a base sobe pouco ou nada.
//
// ### A correção
//
// A nota de um pokémon passa a ser, no mínimo, a que o mesmo nascimento tiraria na forma
// anterior MAIS UM DEGRAU de `GANHO_MIN_EVOLUCAO` por evolução. Como a régua de cada espécie
// continua a mesma, isto não re-avalia o catálogo: só levanta onde a conta ficava curta.
//
// O degrau não é enfeite. Sem ele a correção seria um empate — Magmar 2,495 virando Magmortar
// 2,495 —, e um empate mente tanto quanto a queda: os stats-base da forma nova SÃO maiores, e o
// número tem de dizer isso. Com o degrau, evoluir sempre move o N= para cima, nem que seja o
// mínimo. O único lugar em que o ganho encolhe é o topo da escala, onde não há para onde subir:
// um nascimento que já tira 9,96 vira 10, e 10 é o teto para os dois lados.
//
// A alternativa era ancorar a régua inteira na forma base da cadeia. Ficaria mais "puro" — a
// nota viraria uma função só do nascimento —, mas mudaria a nota de 98,75% dos nascimentos em
// 465 espécies, e 13.405 combinações cairiam abaixo do piso de 3,5 do Mercado. O piso da
// linhagem mexe em 5,2% e não derruba nenhuma: ele só sobe, e 52 combinações passam a ALCANÇAR
// o piso do Mercado em vez de perdê-lo.
//
// Medido depois da regra: o pior ganho de uma evolução no catálogo inteiro é +0,044, e as duas
// únicas amostras (de 159.600) que ficam abaixo do degrau são Type: Null → Silvally e
// Duraludon → Archaludon com o nascimento quase perfeito, batendo no teto de 10.
//
// ### Por que uma lista pronta, e não a cadeia inteira em cada conta
//
// `nota-pokemon.mjs` é compartilhado e não conhece o catálogo — ele recebe bases, não espécies.
// Por isso a cadeia é resolvida UMA vez, na montagem do catálogo (nos dois lados), e o que
// sobra em cada espécie é só a lista das formas anteriores: as bases de cada uma e a QUANTOS
// degraus ela está. Os degraus são o que faz a garantia valer na cadeia inteira — num trio,
// a terceira forma tem de ficar dois degraus acima da primeira, e não um.
//
// Tem de rodar DEPOIS dos ajustes de evolução: metade dos elos que importam aqui (os de geração
// cruzada) não existe no espelho e é escrita em `aplicarEvolucoesEntreGeracoes`.
import { destinosDeEvolucao } from './evolucoes-ramificadas.mjs';

/** As bases de uma espécie no formato que a nota entende. `null` quando a espécie não tem. */
function basesDe(esp) {
  if (!esp) return null;
  return {
    hp: esp.baseHp, atk: esp.baseAtk, def: esp.baseDef,
    spAtk: esp.baseSpAtk, spDef: esp.baseSpDef, speed: esp.baseSpeed,
  };
}

/** Profundidade máxima ao subir a cadeia — trava de segurança contra elo circular no catálogo. */
const MAX_ELOS = 12;

/**
 * Escreve `esp.notaAncestrais` em cada espécie: `[{ bases, passos }]` de TODAS as formas
 * anteriores a ela, com `passos` = quantas evoluções separam uma da outra.
 *
 * Ramificação entra pelos dois lados. Um Wormadam tem só o Burmy atrás, mas se um dia uma forma
 * puder ser alcançada por dois caminhos, os dois entram na lista: o máximo sobre um conjunto
 * maior continua sendo ≥ o de qualquer caminho isolado, então a garantia vale para o jogador
 * que evoluiu por qualquer um deles. `passos` sai da BUSCA EM LARGURA, ou seja é o caminho mais
 * curto — o degrau mede a distância de evolução, e o caminho curto é o que o jogador andou.
 *
 * `elosExtras` são pares `[deId, paraId]` que contam como um degrau para a nota mas NÃO são
 * evolução no catálogo. Hoje são os elos "espécie → mega" (ver `megas.mjs`): megaevoluir tem
 * de subir o N= pelo mesmo motivo que evoluir, mas a mega não pode aparecer como destino de
 * `destinosDeEvolucao` — senão uma pedra de tipo comum a alcançaria.
 *
 * @param {Array} lista todas as espécies do catálogo
 * @param {(id:number)=>object|undefined} buscar como achar uma espécie pelo `pokeId`
 * @param {Array<[number, number]>} elosExtras degraus que não passam por `evolvesToId`
 */
export function anotarLinhagemDaNota(lista, buscar, elosExtras = []) {
  // Quem vem ANTES de quem. Um `Set` por espécie porque a mesma forma pode ser alcançada de
  // mais de um lugar, e o elo repetido não pode duplicar a base na lista final.
  const paisDe = new Map();
  const ligar = (de, para) => {
    if (!de || !para || de === para) return;
    if (!paisDe.has(para)) paisDe.set(para, new Set());
    paisDe.get(para).add(de);
  };
  for (const esp of lista) {
    if (!esp?.pokeId) continue;
    for (const d of destinosDeEvolucao(esp, buscar)) {
      ligar(esp.pokeId, d.especie?.pokeId);
    }
  }
  for (const [de, para] of elosExtras) ligar(Number(de), Number(para));

  for (const esp of lista) {
    if (!esp?.pokeId) continue;
    // Largura primeiro, subindo. `vistos` carrega a própria espécie desde o começo: sem isso
    // uma cadeia que se fecha (o catálogo do espelho já trouxe coisa assim) daria volta infinita.
    const vistos = new Set([esp.pokeId]);
    const anteriores = [];
    let camada = [...(paisDe.get(esp.pokeId) ?? [])];
    for (let passos = 1; passos <= MAX_ELOS && camada.length; passos++) {
      const proxima = [];
      for (const id of camada) {
        if (vistos.has(id)) continue;
        vistos.add(id);
        const bases = basesDe(buscar(id));
        // Espécie sem bases no espelho não vira piso de ninguém — entraria como uma régua de
        // zeros e daria nota 10 para qualquer nascimento.
        if (bases && Object.values(bases).every((v) => Number.isFinite(Number(v)) && Number(v) > 0)) {
          anteriores.push({ bases, passos });
        }
        for (const pai of paisDe.get(id) ?? []) proxima.push(pai);
      }
      camada = proxima;
    }
    // Só escreve quando há o que comparar: a espécie sem ancestral segue exatamente como antes,
    // sem nenhuma conta a mais por nota calculada.
    if (anteriores.length) esp.notaAncestrais = anteriores;
    else if (esp.notaAncestrais) delete esp.notaAncestrais;
  }
}
