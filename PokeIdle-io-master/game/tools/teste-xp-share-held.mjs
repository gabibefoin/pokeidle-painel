/**
 * Teste do Exp. Share (held) como item FECHADO na conta.
 *
 * Não precisa de servidor nem de Postgres: o que está aqui é o catálogo do Mercado (tabela pura
 * de `content.mjs`) e a regra de corte (`shared/xp-share-held.mjs`). O que este arquivo prova:
 *
 *   1. o item não entra na vitrine por caminho nenhum — nem na lista, nem no catálogo, nem
 *      numa aba, nem pelo predicado que o `market.criar` consulta;
 *   2. a aba `held` sumiu do servidor (era a única moradora);
 *   3. o corte tira da bolsa primeiro e, quando precisa desequipar, começa pelo menor nível;
 *   4. quem está certo — ou com MENOS do que comprou — nunca é cortado;
 *   5. o cooldown de troca é maior que um ciclo de flush, que é a fresta que ele existe para
 *      tirar o jogador de perto.
 *
 *   node tools/teste-xp-share-held.mjs
 */
import {
  XP_SHARE_HELD_ID,
  XP_SHARE_HELD_COOLDOWN_MS,
  XP_SHARE_HELD_NEGOCIAVEL,
  planoDeCorteXpShare,
} from '../src/shared/xp-share-held.mjs';
import {
  ITENS_MERCADO,
  IDS_MERCADO_PERMITIDOS,
  CATEGORIAS_MERCADO,
  CATALOGO_MERCADO,
  categoriaMercado,
  itemAnunciavelMercado,
  itensDaCategoria,
  itens,
} from '../src/server/content.mjs';
import { config } from '../src/server/config.mjs';
import { congelarPokemon } from '../src/server/db.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

console.log('Exp. Share — item fechado na conta\n==================================');

// ------------------------------------------------------- fora do Mercado

secao('Fora do Mercado da Comunidade');
const item = itens.get(XP_SHARE_HELD_ID);
ok(!!item, 'o item existe no catálogo do jogo', `id ${XP_SHARE_HELD_ID}`);
ok(XP_SHARE_HELD_NEGOCIAVEL === false, 'a constante declara que ele não é negociável');
ok(!ITENS_MERCADO.has(XP_SHARE_HELD_ID), 'não está em ITENS_MERCADO');
ok(!IDS_MERCADO_PERMITIDOS.has(XP_SHARE_HELD_ID), 'não está em IDS_MERCADO_PERMITIDOS');
ok(!itemAnunciavelMercado(item), 'itemAnunciavelMercado() recusa — é o que o market.criar lê');
ok(categoriaMercado(item) === null, 'não cai em nenhuma aba da vitrine');
ok(
  !CATALOGO_MERCADO.some((i) => i.id === XP_SHARE_HELD_ID),
  'não aparece no catálogo que a vitrine desenha',
);
ok(!CATEGORIAS_MERCADO.includes('held'), 'a aba `held` saiu das categorias do servidor');
ok(
  itensDaCategoria('held').length === 0,
  'itensDaCategoria("held") não devolve mais nada',
  `${itensDaCategoria('held')}`,
);
// A rede de baixo: o item não pode reaparecer por nenhum outro nome no catálogo da vitrine.
ok(
  !CATALOGO_MERCADO.some((i) => /exp\.? ?share/i.test(i.nome)),
  'nenhum "Exp. Share" sobrou na vitrine por nome',
);

// --------------------------------------------------------- regra de corte

secao('O corte tira da bolsa primeiro');
const equipe = [
  { id: 10, level: 5000 },
  { id: 11, level: 1200 },
  { id: 12, level: 3000 },
];

const nada = planoDeCorteXpShare({ bolsa: 0, equipados: equipe, direito: 3 });
ok(nada.excedente === 0, 'quem tem exatamente o que comprou não é tocado');
ok(nada.desequipar.length === 0, 'e nenhum pokémon é desequipado');

const faltando = planoDeCorteXpShare({ bolsa: 0, equipados: [equipe[0]], direito: 3 });
ok(faltando.excedente === 0, 'quem tem MENOS do que comprou também não é tocado');

const soBolsa = planoDeCorteXpShare({ bolsa: 2, equipados: equipe, direito: 3 });
ok(soBolsa.excedente === 2, 'excedente de 2 é reconhecido', `${soBolsa.excedente}`);
ok(soBolsa.daBolsa === 2, 'os 2 saem da bolsa');
ok(soBolsa.desequipar.length === 0, 'e nenhum pokémon perde o item');

secao('Quando precisa desequipar, começa pelo menor nível');
const um = planoDeCorteXpShare({ bolsa: 0, equipados: equipe, direito: 2 });
ok(um.excedente === 1, 'excedente de 1');
ok(um.daBolsa === 0, 'não há nada na bolsa para tirar');
ok(um.desequipar.length === 1, 'um pokémon é desequipado');
ok(um.desequipar[0].id === 11, 'e é o de MENOR nível (Nv 1200)', `#${um.desequipar[0]?.id}`);

const dois = planoDeCorteXpShare({ bolsa: 1, equipados: equipe, direito: 2 });
ok(dois.excedente === 2, 'bolsa 1 + 3 equipadas para direito 2 → excedente 2');
ok(dois.daBolsa === 1, 'tira 1 da bolsa');
ok(dois.desequipar.length === 1 && dois.desequipar[0].id === 11, 'e desequipa só o menor nível');

const todos = planoDeCorteXpShare({ bolsa: 0, equipados: equipe, direito: 0 });
ok(todos.excedente === 3 && todos.desequipar.length === 3, 'direito 0 tira as três');
ok(
  todos.desequipar.map((k) => k.id).join(',') === '11,12,10',
  'na ordem do mais barato para o mais caro',
  todos.desequipar.map((k) => k.id).join(','),
);

secao('Entradas que o banco pode devolver');
ok(planoDeCorteXpShare({}).excedente === 0, 'chamada vazia não estoura e não corta');
ok(
  planoDeCorteXpShare({ bolsa: null, equipados: [], direito: null }).excedente === 0,
  'null na bolsa e no direito vira 0',
);
ok(
  planoDeCorteXpShare({ bolsa: 2, equipados: [], direito: 0 }).daBolsa === 2,
  'bolsa sem nenhum equipado corta só a bolsa',
);
// O plano NÃO pode mexer na lista que recebeu — ela é a mesma que o chamador usa depois.
const original = [...equipe];
planoDeCorteXpShare({ bolsa: 0, equipados: equipe, direito: 0 });
ok(
  equipe.map((k) => k.id).join(',') === original.map((k) => k.id).join(','),
  'a lista de equipados do chamador não é reordenada',
);

// -------------------------------------------------- o congelamento do flush
//
// A ORIGEM da duplicação: `players.items` ia para o banco como retrato (JSON tirado ao montar o
// payload) e o pokémon ia como referência VIVA, lida ~1 s depois, dentro da transação. Equipar
// nessa janela gravava as duas metades em estados diferentes. `congelarPokemon` reduz o pokémon
// a valores no mesmo instante — e é isso que estes testes provam.

secao('O flush congela as duas metades no mesmo instante');
const IDX_HELD = 9; // posição de `held_item_id` em $1..$11

const vivo = {
  id: 777, level: 1500, xp: 42, hp: 300, slot: 0, poder: 9000, speciesId: 130,
  tmElemental: null, tmAoe: false, heldItemId: null, refino: null,
};

const antesDeEquipar = congelarPokemon(vivo);
ok(antesDeEquipar[IDX_HELD] === null, 'o retrato sai com o pokémon sem o item');

// A troca que antes caía no meio da transação. O retrato já foi tirado — não pode mudar.
vivo.heldItemId = XP_SHARE_HELD_ID;
vivo.level = 1600;
ok(
  antesDeEquipar[IDX_HELD] === null,
  'equipar DEPOIS do retrato não altera o retrato — a fresta que duplicava',
  `${antesDeEquipar[IDX_HELD]}`,
);
ok(antesDeEquipar[1] === 1500, 'e nenhum outro campo vaza do objeto vivo para o retrato');

const depoisDeEquipar = congelarPokemon(vivo);
ok(depoisDeEquipar[IDX_HELD] === XP_SHARE_HELD_ID, 'o retrato SEGUINTE já sai com o item');
ok(depoisDeEquipar[1] === 1600, 'e com o nível novo');

// Refino é o outro campo que a transação lia vivo — e ali a fresta custava pedras, não item.
const comRefino = { ...vivo, refino: { atk: 3 } };
const retrato = congelarPokemon(comRefino);
comRefino.refino.atk = 99;
ok(
  retrato[10] !== null && !String(retrato[10]).includes('99'),
  'o refino também vai congelado, não por referência',
  String(retrato[10]),
);

// ------------------------------------------------------------- cooldown

secao('O freio de troca');
ok(
  XP_SHARE_HELD_COOLDOWN_MS > config.flushMs,
  'o cooldown é maior que um ciclo de flush',
  `${XP_SHARE_HELD_COOLDOWN_MS} ms vs FLUSH_MS ${config.flushMs} ms`,
);
ok(
  XP_SHARE_HELD_COOLDOWN_MS >= 60_000,
  'e tem folga de sobra sobre a transação de flush medida (~1 s)',
  `${XP_SHARE_HELD_COOLDOWN_MS} ms`,
);

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
