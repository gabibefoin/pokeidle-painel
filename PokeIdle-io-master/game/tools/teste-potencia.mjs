// Teste da POTÊNCIA e das formas SHINY, sem banco e sem Redis.
//
// As duas coisas são aritmética e tabela sobre o catálogo do espelho, então dá para provar
// tudo sem infra nenhuma.
//
// O que este teste protege:
//   · a roleta de potência sai EXATAMENTE na distribuição pedida (a soma fecha em 100%, e a
//     frequência medida bate com a tabela dentro da margem de um sorteio desse tamanho);
//   · o bônus é o da tabela e vale para os SEIS stats, não só para um;
//   · shiny triplica os stats, e potência e shiny se MULTIPLICAM (P5 shiny = 6×);
//   · toda espécie com forma shiny tem um looktype próprio, e ele é diferente do comum —
//     é isso que faz o Charizard shiny aparecer preto em vez de laranja;
//   · o tipo elemental dos itens sai da derivação com os casos óbvios certos.
//
//   node tools/teste-potencia.mjs
import {
  POTENCIAS,
  POTENCIA_MAX,
  MULT_SHINY_STATS,
  rolarPotencia,
  multPotencia,
  multDeNascenca,
  looktypeShiny,
  calcularStats,
  catalogoShiny,
  especies,
  itens,
  TIPO_DO_ITEM,
  itensDoTipo,
  itensDaCategoria,
  especiesDoTipo,
} from '../src/server/content.mjs';
import { ouroPorDerrota } from '../src/server/game/combate.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

// ------------------------------------------------------------------ a tabela

secao('A tabela de potência');

const soma = POTENCIAS.reduce((s, p) => s + p.chance, 0);
ok(Math.abs(soma - 100) < 1e-9, 'as chances somam exatamente 100%', `somou ${soma}`);
ok(POTENCIA_MAX === 5, 'são cinco potências');
ok(
  POTENCIAS.every((p, i) => i === 0 || p.chance < POTENCIAS[i - 1].chance),
  'quanto maior a potência, mais rara',
);
ok(
  POTENCIAS.every((p, i) => i === 0 || p.bonus > POTENCIAS[i - 1].bonus),
  'quanto maior a potência, maior o bônus',
);
ok(POTENCIAS[0].bonus === 0, 'potência 1 não dá bônus nenhum');
ok(POTENCIAS[4].bonus === 1, 'potência 5 dá +100%');

// ------------------------------------------------------------------- a roleta
//
// 4 milhões de giros: com 0,005% esperado na potência 5 isso dá ~200 acertos, o bastante para
// a medida ter significado. A margem é RELATIVA e frouxa (25%) justamente por causa da cauda —
// exigir precisão numa faixa de 200 amostras daria um teste que falha sozinho de vez em quando.

secao('A roleta (4.000.000 de giros)');

const N = 4_000_000;
const cont = Object.fromEntries(POTENCIAS.map((p) => [p.n, 0]));
for (let i = 0; i < N; i++) cont[rolarPotencia()]++;

ok(
  Object.values(cont).reduce((s, v) => s + v, 0) === N,
  'todo giro devolve uma potência válida de 1 a 5',
);
for (const p of POTENCIAS) {
  const medido = (100 * cont[p.n]) / N;
  const erro = Math.abs(medido - p.chance) / p.chance;
  ok(erro < 0.25, `potência ${p.n}: ${p.chance}% esperado, ${medido.toFixed(4)}% medido`);
}

// ------------------------------------------------------- o efeito nos stats

secao('O efeito nos stats');

for (const p of POTENCIAS) {
  ok(
    Math.abs(multPotencia(p.n) - (1 + p.bonus)) < 1e-9,
    `potência ${p.n} multiplica por ${(1 + p.bonus).toFixed(2)}`,
  );
}
ok(multPotencia(0) === 1 && multPotencia(99) === 1, 'potência fora da faixa cai em 1, nunca em NaN');
ok(multDeNascenca(1, true) === MULT_SHINY_STATS, 'shiny sozinho triplica');
ok(Math.abs(multDeNascenca(5, true) - 6) < 1e-9, 'potência 5 + shiny multiplica por 6');

// O bônus tem de valer para os SEIS stats. Testar só o HP deixaria passar uma aplicação
// parcial — que é exatamente o tipo de erro que ninguém vê até comparar dois pokémon iguais.
const charizard = especies.get(6);
const ivs = { hp: 20, atk: 20, def: 20, spAtk: 20, spDef: 20, speed: 20 };
const base = calcularStats(charizard, ivs, 80, 1, 1);
const CHAVES = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];

for (const p of POTENCIAS.slice(1)) {
  const comBonus = calcularStats(charizard, ivs, 80, 1, multPotencia(p.n));
  const todos = CHAVES.every((k) => {
    const esperado = Math.round(base[k] * (1 + p.bonus));
    return Math.abs(comBonus[k] - esperado) <= 1; // ±1 pelo arredondamento por stat
  });
  ok(todos, `potência ${p.n} sobe os 6 stats em +${p.bonus * 100}%`);
}

const shiny = calcularStats(charizard, ivs, 80, 1, multDeNascenca(1, true));
ok(
  CHAVES.every((k) => Math.abs(shiny[k] - base[k] * MULT_SHINY_STATS) <= 1),
  'shiny triplica os 6 stats',
);

// ------------------------------------------------------- as formas shiny

secao('As formas shiny (sprites)');

const semLook = [...catalogoShiny.values()].filter((s) => !s.looktype);
ok(!semLook.length, `as ${catalogoShiny.size} espécies do catálogo shiny têm looktype próprio`,
   semLook.map((s) => s.name).join(', '));

const iguaisAoComum = [...catalogoShiny.values()].filter(
  (s) => s.looktype === especies.get(s.dexId)?.looktype,
);
ok(!iguaisAoComum.length, 'nenhum looktype shiny é igual ao da forma comum',
   iguaisAoComum.map((s) => s.name).join(', '));

ok(looktypeShiny(6) === 9874, 'Charizard shiny é o looktype 9874 (o preto), não o 67');
ok(looktypeShiny(6) !== especies.get(6).looktype, 'e ele é diferente do Charizard comum');
ok(looktypeShiny(25) === null, 'espécie sem forma shiny devolve null, e quem chama fica no comum');

// ------------------------------------------------- o tipo elemental dos itens

secao('O tipo elemental dos itens');

ok(TIPO_DO_ITEM.size > 250, `${TIPO_DO_ITEM.size} dos ${itens.size} itens têm tipo`);

const tipoDe = (nome) => {
  const item = [...itens.values()].find((i) => i.name === nome);
  return item ? TIPO_DO_ITEM.get(item.id) : undefined;
};
const CASOS = [
  ['Fire Stone', 'FIRE'], ['Water Stone', 'WATER'], ['Leaf Stone', 'GRASS'],
  ['Thunder Stone', 'ELECTRIC'], ['Ice Stone', 'ICE'], ['Metal Stone', 'STEEL'],
  ['Fire-Type TM Disk', 'FIRE'], ['Dragon-Type TM Disk', 'DRAGON'],
  ['Dragon Scale', 'DRAGON'], ['Ghost Essence', 'GHOST'],
];
for (const [nome, esperado] of CASOS) {
  ok(tipoDe(nome) === esperado, `${nome} é do tipo ${esperado}`, `deu ${tipoDe(nome)}`);
}
// Poção não é de tipo nenhum, e inventar um seria pior que deixar sem.
ok(tipoDe('Ultra Potion') === undefined, 'poção fica sem tipo, de propósito');

ok(itensDoTipo('FIRE').length > 0 && itensDoTipo('WATER').length > 0, 'os filtros por tipo acham itens');
ok(itensDaCategoria('stone').length === 20, 'a categoria "stone" tem as 20 pedras');
ok(
  especiesDoTipo('FIRE').includes(6) && !especiesDoTipo('WATER').includes(6),
  'Charizard entra no filtro de fogo e fica fora do de água',
);

// ----------------------------------------------------------- ouro por kill

secao('Ouro por derrota');
{
  const togepi = [...especies.values()].find((e) => e.name === 'Togepi');
  const pidgey = [...especies.values()].find((e) => e.name === 'Pidgey');
  ok(togepi, 'Togepi está no catálogo');
  ok(pidgey, 'Pidgey está no catálogo');
  ok(ouroPorDerrota(togepi) === 8, 'Togepi paga 8 de ouro (experience), não sellValue/10', `${ouroPorDerrota(togepi)}`);
  ok(ouroPorDerrota(pidgey) === 8, 'Pidgey paga 8 de ouro');
  const smeargle = [...especies.values()].find((e) => e.name === 'Smeargle');
  ok(smeargle, 'Smeargle está no catálogo');
  ok(ouroPorDerrota(smeargle) === 8, 'Smeargle paga 8 de ouro, não sellValue/10', `${ouroPorDerrota(smeargle)}`);
  ok(togepi.sellValue === 80, 'Togepi vende por 80 como os outros lvl 1', `${togepi.sellValue}`);
}

// --------------------------------------------------------------------- fim

console.log(`\n${testes - falhas}/${testes} passaram`);
process.exit(falhas ? 1 : 0);
