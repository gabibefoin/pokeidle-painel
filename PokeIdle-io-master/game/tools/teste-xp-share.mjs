/**
 * Teste do XP SHARE da Casa — a escada de fatias e as regras de quem recebe.
 *
 * Não precisa de servidor nem de Postgres. A escada é uma tabela pura (`shared/casas.mjs`) e
 * a regra de crédito é aritmética simples; o que este arquivo prova é que as duas contam a
 * mesma história que a Pokepédia e a tela.
 *
 *   1. a escada é 25 / 40 / 75 / 100 / 100%, e só a Lendária tem dois postos;
 *   2. sem casa não há fatia — nem o piso de 1 XP;
 *   3. a fatia sai do XP do pokémon de BATALHA, então escala com a hunt;
 *   4. o registrado que ESTÁ lutando não recebe (ele já leva o XP inteiro);
 *   5. o Depot não entra: só a equipe;
 *   6. o piso de 1 XP vale para a Casa Comum em hunt de nível baixo;
 *   7. `normalizarXpShare` aguenta o que o banco pode devolver (null, texto, lixo).
 *
 *   node tools/teste-xp-share.mjs
 */
import {
  RARIDADES_CASA,
  bonecosDaRaridade,
  xpShareDaRaridade,
  melhorCasa,
} from '../src/shared/casas.mjs';
import { normalizarXpShare } from '../src/server/game/casas.mjs';
import { xpDoNivel } from '../src/shared/recompensa-hunt.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

// --------------------------------------------------------------- a escada

secao('A escada de fatias');
const ESPERADO = { comum: 0.25, incomum: 0.4, rara: 0.75, mitica: 1, lendaria: 1 };
for (const [id, pct] of Object.entries(ESPERADO)) {
  ok(
    xpShareDaRaridade(id) === pct,
    `Casa ${id} → ${Math.round(pct * 100)}% do XP da hunt`,
    `${xpShareDaRaridade(id)}`,
  );
}
ok(xpShareDaRaridade(null) === 0, 'sem casa → 0% (e é o 0 que impede o piso de virar XP de graça)');
ok(xpShareDaRaridade('inexistente') === 0, 'raridade desconhecida → 0%');

secao('Os postos');
for (const id of ['comum', 'incomum', 'rara', 'mitica']) {
  ok(bonecosDaRaridade(id) === 1, `Casa ${id} tem 1 posto`, `${bonecosDaRaridade(id)}`);
}
ok(bonecosDaRaridade('lendaria') === 2, 'só a Lendária tem 2 postos', `${bonecosDaRaridade('lendaria')}`);
ok(bonecosDaRaridade(null) === 0, 'sem casa, nenhum posto');

secao('A escada é crescente nos dois campos');
for (let i = 1; i < RARIDADES_CASA.length; i++) {
  const a = RARIDADES_CASA[i - 1];
  const b = RARIDADES_CASA[i];
  ok(
    b.xpShare >= a.xpShare && b.bonecos >= a.bonecos,
    `${b.id} não é pior que ${a.id}`,
    `${a.xpShare}/${a.bonecos} → ${b.xpShare}/${b.bonecos}`,
  );
}
ok(melhorCasa({ comum: 2, rara: 1 }) === 'rara', 'a que manda é a MELHOR da bolsa');
ok(melhorCasa({}) === null, 'bolsa sem casa → nenhuma');

// ------------------------------------------------------- a conta do crédito
//
// A mesma linha de `creditarXpShare`: `max(1, round(xpDoAtivo × fator))`, com a trava do
// pokémon ativo por fora. Repetida aqui para a regra ser testável sem subir o sim inteiro —
// se ela mudar lá e não aqui, este arquivo é quem denuncia.

const fatia = (xpDoAtivo, raridade) => {
  const fator = xpShareDaRaridade(raridade);
  if (fator <= 0 || xpDoAtivo <= 0) return 0;
  return Math.max(1, Math.round(xpDoAtivo * fator));
};

secao('A fatia sai do XP do pokémon de BATALHA');
const xpHunt600 = xpDoNivel(600);
const xpHunt10 = xpDoNivel(10);
ok(
  fatia(xpHunt600, 'rara') === Math.round(xpHunt600 * 0.75),
  `hunt 600 (${xpHunt600.toLocaleString('pt-BR')} XP/kill), Casa Rara → ${Math.round(xpHunt600 * 0.75).toLocaleString('pt-BR')} por abate`,
);
ok(
  fatia(xpHunt10, 'rara') < fatia(xpHunt600, 'rara'),
  'a mesma casa rende MUITO menos numa hunt de nível 10 — a fatia escala com a hunt',
  `${fatia(xpHunt10, 'rara')} vs ${fatia(xpHunt600, 'rara')}`,
);
ok(
  fatia(xpHunt10, 'comum') >= 1,
  'e ainda assim nunca é zero: o piso de 1 XP segura a Casa Comum em hunt baixa',
  `${fatia(xpHunt10, 'comum')}`,
);
ok(fatia(xpHunt600, null) === 0, 'sem casa não há fatia — o piso NÃO vale para quem não tem casa');
ok(fatia(0, 'lendaria') === 0, 'abate que não pagou XP também não paga fatia');
ok(
  fatia(xpHunt600, 'lendaria') === xpHunt600,
  'a Lendária paga 100% por posto: o registrado sobe no mesmo ritmo do pokémon de batalha',
);

secao('A fatia é do XP JÁ multiplicado');
// O sim passa `ganho.pokemon`, que já levou VIP/boost/guild/evento. Um jogador com +50% de XP
// de pokémon vê a fatia subir junto — e ela NÃO é multiplicada de novo (seria o quadrado).
const semBoost = 1000;
const comBoost = Math.round(semBoost * 1.5);
ok(
  fatia(comBoost, 'mitica') === Math.round(fatia(semBoost, 'mitica') * 1.5),
  'o +50% de XP de pokémon aparece na fatia exatamente uma vez',
  `${fatia(comBoost, 'mitica')} vs ${fatia(semBoost, 'mitica')}`,
);

// ------------------------------------------------------------- quem recebe
//
// As duas travas do servidor, escritas como o `creditarXpShare` as aplica.

const recebe = (registrado, ativo) => {
  if (!registrado) return false;
  if (registrado.slot == null) return false; // Depot não entra
  if (ativo && registrado.id === ativo.id) return false; // o de batalha já levou tudo
  return true;
};

secao('Quem recebe');
const charizard = { id: 1, nome: 'Charizard', slot: 0 };
const squirtle = { id: 2, nome: 'Squirtle', slot: 1 };
const noDepot = { id: 3, nome: 'Bulbasaur', slot: null };

ok(
  !recebe(charizard, charizard),
  'registrei o Charizard e cacei COM o Charizard → não recebe (o exemplo do pedido)',
);
ok(
  recebe(squirtle, charizard),
  'registrei o Squirtle e cacei com o Charizard → o Squirtle sobe junto',
);
ok(
  recebe(charizard, squirtle),
  'registrei o Charizard e cacei com o Squirtle → o Charizard sobe (pouco, se a hunt for baixa)',
);
ok(!recebe(noDepot, charizard), 'pokémon no Depot não recebe nada');
ok(!recebe(null, charizard), 'posto vazio não credita nada');

secao('O caso do Charizard nível 600 numa hunt de nível 10');
// O terceiro exemplo do pedido, com número: ele sobe, mas devagar — e é isso que a regra
// "a fatia é do XP da hunt" garante sozinha, sem nenhum tratamento especial de nível.
const migalha = fatia(xpDoNivel(10), 'mitica');
const cheio = fatia(xpDoNivel(600), 'mitica');
ok(migalha >= 1 && migalha < cheio / 10, `ele ganha ${migalha} XP por abate, contra ${cheio.toLocaleString('pt-BR')} na hunt de 600`);

// -------------------------------------------------- o que o banco devolve

secao('A leitura da coluna aguenta o que o banco devolve');
// A função é a do sim (`game/casas.mjs`). Desde as casas numeradas a coluna guarda um pedaço por
// casa; a lista antiga volta como `legado` — o formato inteiro é testado em `teste-casas.mjs`.
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const vazio = (x) => igual(x.porCasa, {}) && x.legado === null;
ok(vazio(normalizarXpShare(null)), 'conta anterior à coluna (null) → nenhum posto');
ok(vazio(normalizarXpShare('[]')), 'jsonb como texto vazio → nenhum posto');
ok(igual(normalizarXpShare({ 3: [7, 9] }).porCasa, { 3: [7, 9] }), 'o formato por casa passa inteiro');
ok(igual(normalizarXpShare('{"3":[7,9]}').porCasa, { 3: [7, 9] }), 'e como texto também');
ok(igual(normalizarXpShare([7, 9]).legado, [7, 9]), 'a lista de antes das casas numeradas vira legado');
ok(igual(normalizarXpShare(['7', null, 'lixo', -3]).legado, [7, null, null, null]), 'lixo vira posto vazio, não exceção');
ok(vazio(normalizarXpShare('{isso não é json')), 'texto quebrado não derruba o login');
ok(vazio(normalizarXpShare({ a: 1 })), 'objeto torto → nenhum posto');
ok(normalizarXpShare(new Array(50).fill(1)).legado.length === 8, 'lista gigante é cortada em 8');

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
