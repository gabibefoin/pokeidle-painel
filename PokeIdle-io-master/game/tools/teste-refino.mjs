// Teste do REFINO (+1) — sem banco e sem Redis.
//
// O refino é aritmética sobre o catálogo, então dá para provar o contrato inteiro sem infra.
//
// O que este teste protege:
//   · o custo é POR STAT e dobra a cada degrau do MESMO stat (500 → 1.000 → 2.000 …), e um
//     stat nunca refinado continua no preço inicial mesmo com os outros no teto — é a regra
//     que transforma o sistema numa escolha em vez de numa barra que se enche;
//   · `normalizarRefino` sobrevive a lixo (jsonb como texto, chave a mais, número negativo,
//     valor acima do teto) — a entrada é o histórico inteiro da tabela, e um `undefined` no
//     meio da conta de stats vira NaN, que o Postgres rejeita na coluna `power`;
//   · o degrau entra na BASE, antes de tudo, e portanto é amplificado por nível, qualidade e
//     potência — é isso que faz refinar um shiny P5 valer mais que refinar um bicho comum;
//   · o SPD nunca refina (o stat dele não entra em combate: quem manda é o IV de Speed);
//   · a nota N= e o ⚔ sobem com refino — TM elemental não entra na nota;
//   · TODA espécie do catálogo tem uma pedra de refino, inclusive as formas finais que não
//     evoluem para lugar nenhum (Dragonite, Blissey), que são justamente as que alguém
//     investiria.
//
//   node tools/teste-refino.mjs
import {
  STATS_REFINAVEIS,
  REFINO_CUSTO_BASE,
  REFINO_EXPOENTE,
  REFINO_TETO_TECNICO,
  REFINO_PASSO,
  CAMPO_BASE,
  normalizarRefino,
  totalDoRefino,
  temRefino,
  custoDoRefino,
  custoTotalDoRefino,
  investidoNoRefino,
  refinoNoTeto,
  compactarRefino,
  basesComRefino,
} from '../src/shared/refino-stats.mjs';
import {
  especies,
  calcularStats,
  hpDeCombate,
  multDeNascenca,
  pedraDeRefino,
  pedraDeEvolucao,
  pedrasDeRefino,
} from '../src/server/content.mjs';
import {
  saldoPedrasRefino,
  consumirPedrasRefino,
  nomesPedraRefino,
} from '../src/shared/refino-pedras.mjs';
import { notaDePokemon, poderDePokemon } from '../src/shared/nota-pokemon.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

console.log('REFINO (+1) — stats-base comprados com pedra\n===========================================');

// ------------------------------------------------------------------- a tabela

secao('A curva de custo — cúbica no acumulado, sem teto');

ok(REFINO_CUSTO_BASE === 500, 'o primeiro degrau custa 500 pedras');
ok(REFINO_EXPOENTE === 3, 'a curva é cúbica');

// O contrato inteiro numa linha: ter `+N` custou `500 × N³` somando tudo. Se esta identidade
// quebrar, os dois lados do sistema (o preço do degrau e o "investido" da tela) divergem.
let acumulado = 0;
let bate = true;
for (let n = 0; n < 40; n++) {
  acumulado += custoDoRefino(n);
  if (acumulado !== custoTotalDoRefino(n + 1)) bate = false;
}
ok(bate, 'a soma dos degraus é exatamente `500 × N³` em todos os 40 primeiros pontos');

ok(custoDoRefino(0) === 500, '+1 → 500');
ok(custoDoRefino(1) === 3500, '+2 → 3.500');
ok(custoDoRefino(2) === 9500, '+3 → 9.500');
ok(custoDoRefino(3) === 18500, '+4 → 18.500');
ok(custoTotalDoRefino(10) === 500000, 'chegar ao +10 custou 500.000 no total');
ok(custoDoRefino(-3) === 500, 'nível negativo cai no preço inicial em vez de virar fração');

// O que a cúbica compra em relação ao dobro: o degrau continua CARO, mas nunca vira piada —
// e é isso que permite não ter teto nenhum.
const dobrando = (n) => 500 * 2 ** n;
ok(custoDoRefino(1) > dobrando(1), 'no começo a cúbica é mais dura que dobrar');
ok(
  custoDoRefino(20) * 800 < dobrando(20),
  'no vigésimo degrau ela é ~800× mais barata que dobrar — é o que permite não ter teto',
  `${custoDoRefino(20)} contra ${dobrando(20)}`,
);
ok(
  custoDoRefino(29) < Number.MAX_SAFE_INTEGER,
  'o degrau 30 ainda é um número que existe (dobrando seria 268 bilhões)',
  String(custoDoRefino(29)),
);

// Sem teto de JOGO: a guarda é só de aritmética, e fica longe de qualquer coisa alcançável.
ok(REFINO_TETO_TECNICO >= 9999, 'a guarda de aritmética não é um teto de progressão');
ok(!refinoNoTeto(500), 'um `+500` seguiria comprável (se alguém tivesse as pedras)');
ok(refinoNoTeto(REFINO_TETO_TECNICO), 'a guarda existe e fecha no limite declarado');
ok(
  Number.isFinite(custoDoRefino(REFINO_TETO_TECNICO)),
  'nem no limite da guarda o custo vira Infinity ou NaN',
);

// O ponto do sistema: focar tudo num stat NÃO encarece os outros.
const focado = normalizarRefino({ hp: 4 });
ok(custoDoRefino(focado.hp) === 30500, 'quatro degraus em HP levam o quinto a 30.500');
ok(custoDoRefino(focado.atk) === 500, 'o ATK intocado continua a 500 mesmo com o HP no +4');

// "Investido" é o que a tela mostra no lugar da antiga barra "x de 10".
ok(investidoNoRefino({ hp: 3, atk: 2 }) === 13500 + 4000, 'o investido soma a cúbica dos cinco stats');
ok(investidoNoRefino(null) === 0, 'pokémon intocado tem zero investido');

// ------------------------------------------------------------ normalizar lixo

secao('Normalização — a entrada é o histórico inteiro da tabela');

const limpo = normalizarRefino(null);
ok(
  STATS_REFINAVEIS.every((k) => limpo[k] === 0),
  'null vira os cinco stats em zero (nunca `undefined`)',
);
ok(
  Object.keys(normalizarRefino({ hp: 2, lixo: 9 })).length === STATS_REFINAVEIS.length,
  'chave estranha é descartada',
);
ok(normalizarRefino({ atk: -5 }).atk === 0, 'valor negativo vira zero');
ok(
  normalizarRefino({ def: 1e308 }).def === REFINO_TETO_TECNICO,
  'valor absurdo é aparado na guarda de aritmética (senão os stats viram NaN)',
);
ok(
  Number.isFinite(calcularStats(especies.get(1), { hp: 16, atk: 16, def: 16, spAtk: 16, spDef: 16, speed: 16 }, 100, 1, 1, { def: 1e308 }).def),
  'e o stat resultante continua sendo um número',
);
ok(normalizarRefino({ hp: 2.9 }).hp === 2, 'fração é truncada para baixo');
ok(normalizarRefino('{"hp":3}').hp === 3, 'jsonb que voltou como TEXTO é lido igual');
ok(normalizarRefino('não é json').hp === 0, 'texto inválido não derruba a conta');
ok(totalDoRefino({ hp: 3, atk: 2 }) === 5, 'o total soma os degraus dos cinco stats');
ok(!temRefino(null) && temRefino({ hp: 1 }), '`temRefino` separa o refinado do intocado');
ok(
  totalDoRefino(normalizarRefino({ hp: 99, atk: 99, def: 99, spAtk: 99, spDef: 99 })) === 495,
  'não há teto de jogo: um `+99` em cada stat soma +495 sem ser aparado',
);

// O que vai para o banco é a forma enxuta — `{}` no pokémon que nunca foi refinado.
ok(
  JSON.stringify(compactarRefino(null)) === '{}',
  'pokémon intocado grava `{}`, não cinco zeros',
);
ok(
  JSON.stringify(compactarRefino({ hp: 3, atk: 0 })) === '{"hp":3}',
  'só o stat com degrau vai para o jsonb',
);
ok(
  normalizarRefino(compactarRefino({ hp: 3 })).atk === 0,
  'a volta do formato compacto continua completa',
);

// --------------------------------------------------------------- nos stats

secao('O degrau entra na BASE, antes de tudo');

const bulbasaur = especies.get(1);
const ivs = { hp: 16, atk: 16, def: 16, spAtk: 16, spDef: 16, speed: 16 };

const bases = basesComRefino(bulbasaur, { hp: 3, atk: 2 });
ok(bases.hp === bulbasaur.baseHp + 3 * REFINO_PASSO, 'a base de HP sobe 1 por degrau');
ok(bases.atk === bulbasaur.baseAtk + 2 * REFINO_PASSO, 'a base de ATK sobe 1 por degrau');
ok(bases.def === bulbasaur.baseDef, 'stat sem refino fica exatamente como estava');
ok(bases.speed === bulbasaur.baseSpeed, 'o SPD nunca sobe');
ok(
  basesComRefino(bulbasaur, null).hp === bulbasaur.baseHp,
  'sem refino, `basesComRefino` devolve a espécie intacta',
);

const cru = calcularStats(bulbasaur, ivs, 100, 1);
const semRefino = calcularStats(bulbasaur, ivs, 100, 1, 1, null);
ok(
  JSON.stringify(cru) === JSON.stringify(semRefino),
  'passar `refino: null` dá exatamente o mesmo resultado de não passar nada',
);

const nv100 = calcularStats(bulbasaur, ivs, 100, 1, 1, { hp: 5 });
ok(nv100.hp === cru.hp + 5, 'nível 100 e qualidade 1: +5 de base = +5 de stat');
ok(nv100.atk === cru.atk, 'refinar HP não mexe em mais nada');

// Metade do nível, metade do ganho — o degrau passa pelo `nível/100` como o resto.
const nv50base = calcularStats(bulbasaur, ivs, 50, 1);
const nv50 = calcularStats(bulbasaur, ivs, 50, 1, 1, { hp: 10 });
ok(nv50.hp === nv50base.hp + 5, 'no nível 50 o mesmo +10 de base rende metade');

// E é amplificado por qualidade × potência × shiny, que é o que o torna endgame.
const multTop = multDeNascenca(5, true); // P5 shiny = ×4
const topBase = calcularStats(bulbasaur, ivs, 100, 1.8, multTop);
const topRef = calcularStats(bulbasaur, ivs, 100, 1.8, multTop, { atk: 5 });
ok(
  topRef.atk - topBase.atk > (nv100.hp - cru.hp),
  'num P5 shiny de qualidade 1,8 o mesmo degrau rende muito mais',
  `ganhou ${topRef.atk - topBase.atk} contra ${nv100.hp - cru.hp}`,
);

// HP de combate: o multiplicador ×12 vale para o ganho também.
ok(
  hpDeCombate(nv100.hp) - hpDeCombate(cru.hp) === 5 * 12,
  '+5 de HP-base vira +60 de HP de combate no nível 100',
);

// -------------------------------------------------------- nota vs ⚔

secao('Nota e ⚔ refletem refino · TM elemental não');

const nasc = {
  ivs,
  quality: 1.44,
  potencia: 3,
  shiny: false,
  level: 100,
};
const notaAntes = notaDePokemon(nasc, bulbasaur);
const poderAntes = poderDePokemon(nasc, bulbasaur);
const comRefino = { ...nasc, refino: { hp: 5, atk: 5, def: 0, spAtk: 0, spDef: 0 } };
ok(notaDePokemon(comRefino, bulbasaur) > notaAntes, 'a nota N= sobe com refino', `${notaAntes} → ${notaDePokemon(comRefino, bulbasaur)}`);
ok(poderDePokemon(comRefino, bulbasaur) > poderAntes, 'o ⚔ sobe com refino', `${poderAntes} → ${poderDePokemon(comRefino, bulbasaur)}`);

const makuhita = especies.get(296);
const hariyama = especies.get(297);
ok(makuhita && hariyama, 'Makuhita e Hariyama no catálogo');
const nascEvo = {
  ivs: { hp: 22, atk: 18, def: 20, spAtk: 16, spDef: 19, speed: 21 },
  quality: 1.35,
  potencia: 2,
  shiny: false,
  level: 80,
};
const poderMaku = poderDePokemon(nascEvo, makuhita);
const poderHari = poderDePokemon(nascEvo, hariyama);
ok(poderHari > poderMaku, 'evoluir Makuhita → Hariyama sobe o ⚔', `${poderMaku} → ${poderHari}`);

// ------------------------------------------------------------------ a pedra

secao('A pedra — a mesma da evolução, e existe para TODA espécie');

let semPedra = 0;
const exemplos = [];
for (const esp of especies.values()) {
  const pedra = pedraDeRefino(esp);
  if (!pedra) {
    semPedra++;
    if (exemplos.length < 5) exemplos.push(esp.name);
  }
}
ok(semPedra === 0, `todas as ${especies.size} espécies têm pedra de refino`, exemplos.join(', '));

const casos = [
  [1, 'Leaf Stone'],    // Bulbasaur, GRASS
  [6, 'Fire Stone'],    // Charizard, FIRE — forma final
  [149, 'Ancient Stone'], // Dragonite, DRAGON — forma final
  [113, 'Sun Stone'],   // Chansey, NORMAL
  [25, 'Thunder Stone'], // Pikachu, ELECTRIC
  [16, 'Feather Stone'], // Pidgey — exceção escrita à mão (FLYING, não NORMAL)
];
for (const [id, nome] of casos) {
  const esp = especies.get(id);
  ok(pedraDeRefino(esp)?.nome === nome, `${esp?.name} refina com ${nome}`, pedraDeRefino(esp)?.nome);
}

// A diferença que justifica a função existir: forma final não tem pedra de EVOLUÇÃO.
const dragonite = especies.get(149);
ok(pedraDeEvolucao(dragonite) === null, 'Dragonite não tem pedra de evolução (não evolui)');
ok(pedraDeRefino(dragonite) !== null, 'mas tem pedra de refino — senão o endgame ficaria de fora');

// Quem evolui usa a MESMA pedra nos dois sistemas, que é o que o jogador espera.
const bulba = especies.get(1);
ok(
  pedraDeRefino(bulba).itemId === pedraDeEvolucao(bulba).itemId,
  'quem evolui refina com a mesma pedra com que evolui',
);

// ------------------------------------------------------------------- dual-type

secao('Dual-type — pedras dos dois tipos e mescla de saldos');

const charizard = especies.get(6);
const pedrasChar = pedrasDeRefino(charizard);
ok(pedrasChar.length === 2, 'Charizard aceita duas pedras', pedrasChar.map((p) => p.nome).join(' / '));
ok(
  pedrasChar.some((p) => p.nome === 'Fire Stone') && pedrasChar.some((p) => p.nome === 'Feather Stone'),
  'Charizard: Fire Stone + Feather Stone',
);

const pikachu = especies.get(25);
ok(pedrasDeRefino(pikachu).length === 1, 'Pikachu mono-type continua com uma pedra');

const items = Object.fromEntries(pedrasChar.map((p) => [p.itemId, 250]));
ok(saldoPedrasRefino(items, pedrasChar) === 500, '250 + 250 = 500 disponíveis');

const gasto = consumirPedrasRefino(items, pedrasChar, 500);
ok(gasto?.length === 2 && gasto.every((g) => g.qtd === 250), 'mescla 250/250 no degrau de 500');
ok(saldoPedrasRefino(items, pedrasChar) === 0, 'esvazia os dois tipos');

const misto = Object.fromEntries([
  [pedrasChar.find((p) => p.nome === 'Feather Stone').itemId, 300],
  [pedrasChar.find((p) => p.nome === 'Fire Stone').itemId, 200],
]);
ok(consumirPedrasRefino(misto, pedrasChar, 500)?.reduce((s, g) => s + g.qtd, 0) === 500,
  '300 Feather + 200 Fire fecham 500');

ok(nomesPedraRefino(charizard).length === 2, 'nomesPedraRefino bate com pedrasDeRefino');

// ------------------------------------------------------------------- SPD

secao('O SPD fica de fora');

ok(!STATS_REFINAVEIS.includes('speed'), 'speed não está na lista de stats refináveis');
ok(STATS_REFINAVEIS.length === 5, 'são cinco stats refináveis');
ok(
  normalizarRefino({ speed: 10 }).speed === undefined,
  'um "+10 speed" forjado é simplesmente descartado',
);
ok(
  calcularStats(bulbasaur, ivs, 100, 1, 1, { speed: 10 }).speed === cru.speed,
  'e não chega aos stats nem por acidente',
);
ok(CAMPO_BASE.speed === 'baseSpeed', 'o campo do SPD continua mapeado (a tela mostra a linha)');

console.log('\n==============================================');
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `todos os ${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
