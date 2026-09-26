// OFERENDAR TUDO DO DEPOT — o lote da oferenda.
//
// O botão de um clique que substitui 40 rodadas de quatro cliques. O que este teste protege:
//
//   · **a régua é a MESMA do Auto Selecionar** — se as duas peneiras divergirem, o lote leva
//     pokémon que o giro de um recusa, e a diferença só aparece depois de as linhas sumirem;
//   · **a ordem**: pior primeiro, igual ao botão de um giro;
//   · **os grupos**: de cinco em cinco, e o último pode sair incompleto (vai com chance parcial);
//   · **o último pokémon da conta não sai** — a trava de `validarOferenda` aplicada ANTES, porque
//     a remoção do lote acontece toda no fim e lá ela não pegaria mais;
//   · **o teto de giros** de uma chamada, e o `restantes` que a tela usa para dizer "clique de novo";
//   · **a prévia não mente**: a esperança por pedra bate com a roleta que vai girar, e a soma das
//     probabilidades de um giro fecha em `pokémon / casas`.
//
// Tudo puro — sem banco, sem servidor, sem Chrome:
//
//   node tools/teste-oferenda-lote.mjs
import {
  OFERENDA_CASAS,
  OFERENDA_LOTE_GIROS_MAX,
  montarLoteDaOferenda,
  previaDoLote,
  montarRoleta,
} from '../src/shared/oferenda.mjs';
import { XP_SHARE_HELD_ID } from '../src/shared/xp-share-held.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);
const perto = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// As duas prateleiras, no formato que `montarRoleta` espera.
const PEDRAS = {
  normal: { FIRE: 101, WATER: 102, GRASS: 103, FLYING: 104 },
  shiny: { FIRE: 201, WATER: 202 },
};

// Os pokémon do teste: a nota vem de um mapa, como no servidor (`pk.nota`).
const notas = new Map();
const pk = (id, nota, extra = {}) => {
  notas.set(id, nota);
  return { id, tipos: ['WATER'], level: 10, potencia: 1, shiny: false, ...extra };
};
const nota = (k) => notas.get(k.id);
const ids = (grupo) => grupo.map((k) => k.id);
const achatado = (grupos) => grupos.flatMap(ids);

console.log('OFERENDA EM LOTE\n================');

// ------------------------------------------------------------------------------------------------
secao('Os grupos, de cinco em cinco');
{
  const lista = Array.from({ length: 12 }, (_, i) => pk(i + 1, i + 1));
  const { grupos, restantes } = montarLoteDaOferenda(lista, { nota, totalNaConta: 100 });
  ok(grupos.length === 3, 'doze pokémon viram três grupos', String(grupos.length));
  ok(grupos[0].length === 5 && grupos[1].length === 5, 'os dois primeiros vão cheios');
  ok(grupos[2].length === 2, 'e o último sai com a sobra', String(grupos[2].length));
  ok(restantes === 0, 'nada ficou para a próxima chamada');
  ok(JSON.stringify(achatado(grupos)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    'a ordem é a do pior para o melhor', JSON.stringify(achatado(grupos)));
}

// ------------------------------------------------------------------------------------------------
secao('A régua — a mesma do Auto Selecionar');
{
  const lista = [
    pk(1, 1),
    pk(2, 2, { shiny: true }),
    pk(3, 3, { potencia: 5 }),
    pk(4, 4, { heldItemId: XP_SHARE_HELD_ID }),
    pk(5, 5, { refinoTotal: 2 }),
    pk(6, 6, { tmAoe: true }),
    pk(7, 7, { starter: true }),
    pk(8, 8, { tipos: [] }),
    pk(9, 9),
  ];
  const { grupos, fora } = montarLoteDaOferenda(lista, { nota, totalNaConta: 100 });
  ok(JSON.stringify(achatado(grupos)) === JSON.stringify([1, 9]),
    'só os dois comuns entram', JSON.stringify(achatado(grupos)));
  ok(fora.shiny === 1 && fora.p5 === 1 && fora.item === 1, 'shiny, P5 e item segurado ficam de fora');
  ok(fora.refino === 1 && fora.tm === 1 && fora.starter === 1 && fora.semPedra === 1,
    'refino, TM, starter e sem-pedra também', JSON.stringify(fora));
}

// ------------------------------------------------------------------------------------------------
secao('A régua de nota do jogador, e os protegidos');
{
  const lista = [pk(11, 1), pk(12, 4), pk(13, 6), pk(14, 9)];
  const { grupos, fora } = montarLoteDaOferenda(lista, { nota, notaMax: 5, totalNaConta: 100 });
  ok(JSON.stringify(achatado(grupos)) === JSON.stringify([11, 12]), 'só abaixo da régua entra');
  ok(fora.regua === 2, 'e os de cima são contados como "acima da régua"', JSON.stringify(fora));

  const comProtegido = montarLoteDaOferenda(lista, { nota, protegidos: [11, 12], totalNaConta: 100 });
  ok(JSON.stringify(achatado(comProtegido.grupos)) === JSON.stringify([13, 14]),
    'quem está na lista de protegidos não entra');
  ok(comProtegido.fora.protegido === 2, 'e é contado como protegido');
}

// ------------------------------------------------------------------------------------------------
secao('O último pokémon da conta não sai');
{
  const lista = [pk(21, 1), pk(22, 2), pk(23, 3)];
  const { grupos } = montarLoteDaOferenda(lista, { nota, totalNaConta: 3 });
  ok(achatado(grupos).length === 2, 'de três elegíveis numa conta de três, só dois vão',
    String(achatado(grupos).length));

  const um = montarLoteDaOferenda([pk(24, 1)], { nota, totalNaConta: 1 });
  ok(um.grupos.length === 0, 'com um pokémon só na conta, o lote não acontece');

  // A conta tem 10, mas só 3 passam na peneira: a trava do último não pode cortar nada aqui.
  const solto = montarLoteDaOferenda(lista, { nota, totalNaConta: 10 });
  ok(achatado(solto.grupos).length === 3, 'e ela não corta quando há outros fora da peneira');
}

// ------------------------------------------------------------------------------------------------
secao('O teto de giros de uma chamada');
{
  const quantos = OFERENDA_LOTE_GIROS_MAX * OFERENDA_CASAS + 7;
  const lista = Array.from({ length: quantos }, (_, i) => pk(1000 + i, i + 1));
  const { grupos, restantes } = montarLoteDaOferenda(lista, { nota, totalNaConta: quantos + 50 });
  ok(grupos.length === OFERENDA_LOTE_GIROS_MAX, 'para no teto de giros', String(grupos.length));
  ok(achatado(grupos).length === OFERENDA_LOTE_GIROS_MAX * OFERENDA_CASAS, 'todos os grupos cheios');
  ok(restantes === 7, 'e diz quantos ficaram para a próxima chamada', String(restantes));

  const menor = montarLoteDaOferenda(lista, { nota, totalNaConta: 9999, girosMax: 2 });
  ok(menor.grupos.length === 2, 'o teto é ajustável por chamada');
  ok(menor.restantes === quantos - 10, 'e o resto é reportado certo', String(menor.restantes));
}

// ------------------------------------------------------------------------------------------------
secao('Nada para oferendar');
{
  ok(montarLoteDaOferenda([], { nota, totalNaConta: 10 }).grupos.length === 0, 'lista vazia não gera grupo');
  ok(montarLoteDaOferenda(null, { nota, totalNaConta: 10 }).grupos.length === 0, 'nem lista nenhuma');
  const semNota = montarLoteDaOferenda([{ id: 90, tipos: ['FIRE'], level: 1, potencia: 1 }], {
    nota: () => null, totalNaConta: 10,
  });
  ok(semNota.grupos.length === 0 && semNota.fora.semNota === 1, 'pokémon sem nota não entra');
}

// ------------------------------------------------------------------------------------------------
secao('A prévia não mente');
{
  // Onze WATER: dois giros cheios (pedra garantida) e um de um pokémon só (20%).
  const lista = Array.from({ length: 11 }, (_, i) => pk(2000 + i, i + 1));
  const { grupos } = montarLoteDaOferenda(lista, { nota, totalNaConta: 100 });
  const previa = previaDoLote(grupos, PEDRAS);

  ok(previa.giros === 3, 'três giros', String(previa.giros));
  ok(previa.oferecidos === 11, 'onze pokémon');
  ok(previa.garantidos === 2, 'dois giros com pedra garantida', String(previa.garantidos));
  ok(previa.parcial?.pokemons === 1, 'o último grupo é o parcial');
  ok(perto(previa.parcial?.chance, 1 / OFERENDA_CASAS), 'e a chance dele é pokémon/casas',
    String(previa.parcial?.chance));

  // Todos WATER: uma pedra só na lista, com esperança 1 + 1 + 0,2.
  ok(previa.pedras.length === 1 && previa.pedras[0].itemId === 102, 'a esperança é toda da Water Stone');
  ok(perto(previa.pedras[0].esperado, 2.2), 'e vale 2,2 pedras', String(previa.pedras[0].esperado));

  // A soma das fatias não-vazias de UM giro é exatamente `pokémon / casas` — a promessa do
  // arquivo. Se a prévia somasse errado, é aqui que apareceria.
  for (const grupo of grupos) {
    const r = montarRoleta(grupo, PEDRAS);
    const soma = r.fatias.filter((f) => !f.vazio).reduce((s, f) => s + f.peso / r.total, 0);
    ok(perto(soma, grupo.length / OFERENDA_CASAS),
      `giro de ${grupo.length}: as fatias somam ${grupo.length}/${OFERENDA_CASAS}`, String(soma));
  }
}

// ------------------------------------------------------------------------------------------------
secao('Prévia com tipos misturados');
{
  const fogo = (id, n) => pk(id, n, { tipos: ['FIRE'] });
  const misto = (id, n) => pk(id, n, { tipos: ['GRASS', 'FLYING'] });
  const lista = [fogo(3001, 1), fogo(3002, 2), fogo(3003, 3), misto(3004, 4), misto(3005, 5)];
  const { grupos } = montarLoteDaOferenda(lista, { nota, totalNaConta: 100 });
  const previa = previaDoLote(grupos, PEDRAS);
  const total = previa.pedras.reduce((s, x) => s + x.esperado, 0);
  ok(previa.giros === 1 && previa.garantidos === 1, 'um giro, pedra garantida');
  ok(perto(total, 1), 'a esperança total fecha em uma pedra', String(total));
  const fire = previa.pedras.find((x) => x.itemId === 101);
  ok(perto(fire.esperado, 3 / 5), 'três de cinco casas são Fire Stone', String(fire?.esperado));
  ok(previa.pedras.length === 3, 'e as duas do dual-type aparecem separadas', String(previa.pedras.length));
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} passaram`);
process.exit(falhas ? 1 : 0);
