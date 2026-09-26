// VARREDURA DE SEGURANÇA da MEGA EVOLUÇÃO — sem banco e sem Redis.
//
// Não é um teste de "funciona": é um teste de ATAQUE. Cada bloco é um jogador hostil falando
// direto com o socket, sem passar pela tela — o único jeito realista de atacar este jogo,
// porque o cliente é aberto e o pacote é JSON.
//
// O que se procura, na ordem em que dói:
//
//   1. DUPLICAR PEDRA — fabricar sem pagar, pagar uma vez e levar duas, pagar com a moeda
//      errada (fragmento comum comprando pedra shiny), pagar com saldo negativo ou forjado.
//      Toda fabricação é medida pela CONSERVAÇÃO: fragmentos que saíram ÷ custo == pedras que
//      entraram, sempre, em todo caminho;
//   2. FABRICAR A PEDRA DE QUEM NÃO EXISTE — dex forjado, dex de Outland, dex da própria mega,
//      fração, `Infinity`, string com SQL, objeto;
//   3. MEGAEVOLUIR DE GRAÇA ou DUAS VEZES — o mesmo pokémon megaevoluindo em sequência, um
//      pokémon de outro jogador, uma espécie sem mega, e o pulo do `shiny` (gastar a pedra
//      comum, mais barata, num shiny — ou o contrário);
//   4. ESCOLHER O ITEM — o pacote de `pokemon.mega` NÃO pode aceitar um `itemId` do cliente.
//      Se aceitasse, bastaria apontar para a pedra mais barata da bolsa;
//   5. POLUIR O PROTÓTIPO — `__proto__` e `constructor` nos lugares em que o pacote vira chave;
//   6. DERRUBAR O SERVIDOR — quanto custa, em CPU, o pedido mais caro que dá para formular.
//
//   node tools/teste-seguranca-megas.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { fabricarMegaStone, megaStoneDeEvolucao, configMega } from '../src/server/game/mega.mjs';
import {
  FRAGMENTO_MEGA_ID,
  FRAGMENTO_MEGA_SHINY_ID,
  MEGA_STONE_POR_DEX,
  MEGA_SHINY_STONE_POR_DEX,
  CUSTO_FRAGMENTOS_MEGA,
} from '../src/server/game/itens-nossos.mjs';
import { MEGAS, megaPokeId, megaDaEspecie, megaTemShiny } from '../src/shared/megas.mjs';
import { especies } from '../src/server/content.mjs';

let testes = 0;
let falhas = 0;
function ok(cond, nome, detalhe = '') {
  testes++;
  if (cond) return console.log(`  ok  ${nome}`);
  falhas++;
  console.log(`  FALHOU  ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = (rel) => readFileSync(join(raiz, rel), 'utf8').replace(/\r\n/g, '\n');

const jogador = (items = {}) => ({ items: { ...items } });

/** Quantas pedras de mega o jogador tem somadas — a saída que a conservação mede. */
function pedrasDe(p) {
  let n = 0;
  for (const [id, q] of Object.entries(p.items)) {
    const num = Number(id);
    if (Object.values(MEGA_STONE_POR_DEX).includes(num)) n += Number(q);
    if (Object.values(MEGA_SHINY_STONE_POR_DEX).includes(num)) n += Number(q);
  }
  return n;
}

// ===================================================================== 1. duplicar

console.log('\n1. DUPLICAR PEDRA — a conservação de fragmentos');

{
  // O caminho honesto, medido: 50 fragmentos viram exatamente 5 pedras, nem uma a mais.
  const p = jogador({ [FRAGMENTO_MEGA_ID]: 50 });
  let feitas = 0;
  for (let i = 0; i < 20; i++) {
    const r = fabricarMegaStone(p, MEGAS[i % MEGAS.length].dex, false);
    if (!r.erro) feitas++;
  }
  const sobrou = Number(p.items[FRAGMENTO_MEGA_ID] ?? 0);
  ok(feitas === 5, `20 tentativas com 50 fragmentos fabricam 5 pedras (${feitas})`);
  ok(sobrou === 0, `e não sobra fragmento (${sobrou})`);
  ok(pedrasDe(p) === 5, `e existem 5 pedras na bolsa (${pedrasDe(p)})`);
}

{
  // A tentativa clássica: saldo negativo. Se alguma subtração virasse crédito, `tem < custo`
  // já barra — mas o que se mede aqui é que a bolsa não MELHORA depois da recusa.
  const p = jogador({ [FRAGMENTO_MEGA_ID]: -100 });
  const r = fabricarMegaStone(p, 94, false);
  ok(!!r.erro, 'saldo negativo não fabrica');
  ok(Number(p.items[FRAGMENTO_MEGA_ID]) === -100, 'e a recusa não mexe no saldo');
  ok(pedrasDe(p) === 0, 'e nenhuma pedra foi criada');
}

for (const valor of [Infinity, -Infinity, NaN, '10', 10.9, true, null, undefined, [], {}, '1e999']) {
  const p = jogador({ [FRAGMENTO_MEGA_ID]: valor });
  const antes = Number(p.items[FRAGMENTO_MEGA_ID]);
  const r = fabricarMegaStone(p, 94, false);
  const pedras = pedrasDe(p);
  // `'10'` e `Infinity` PODEM fabricar (o `Number()` aceita os dois); o que não pode é
  // fabricar SEM debitar. A invariante é a mesma nos dois casos: pedra criada ⇒ 10 a menos.
  const depois = Number(p.items[FRAGMENTO_MEGA_ID] ?? 0);
  const debitou = Number.isFinite(antes) ? antes - depois === CUSTO_FRAGMENTOS_MEGA : true;
  if (pedras > 0 && (!debitou || pedras !== 1)) {
    ok(false, `saldo forjado ${String(valor)} fabricou sem debitar`);
  }
  if (pedras === 0 && !r.erro) ok(false, `saldo forjado ${String(valor)} devolveu sucesso sem pedra`);
}
ok(true, 'saldo forjado (Infinity, NaN, string, bool, array, objeto) nunca cria pedra sem débito');

{
  // A MOEDA ERRADA: o fragmento comum é o dobro mais fácil de farmar que o shiny. Se a pedra
  // shiny aceitasse o comum, a família shiny inteira valeria metade do que devia.
  const p = jogador({ [FRAGMENTO_MEGA_ID]: 1000 });
  const r = fabricarMegaStone(p, 94, true);
  ok(!!r.erro, 'mil fragmentos COMUNS não compram nenhuma pedra shiny');
  ok(Number(p.items[FRAGMENTO_MEGA_ID]) === 1000, 'e a recusa não cobra');
  ok(pedrasDe(p) === 0, 'e nenhuma pedra shiny aparece');
}

{
  const p = jogador({ [FRAGMENTO_MEGA_SHINY_ID]: 1000 });
  const r = fabricarMegaStone(p, 94, false);
  // O contrário é permitido? NÃO: cada família compra a sua. Gastar o fragmento raro na pedra
  // comum seria um prejuízo silencioso para o jogador, e o handler não tem por que aceitar.
  ok(!!r.erro, 'o fragmento SHINY também não compra a pedra comum');
  ok(Number(p.items[FRAGMENTO_MEGA_SHINY_ID]) === 1000, 'e essa recusa também não cobra');
}

{
  // `shiny` só é verdade quando é o booleano `true` — é o que o handler do sim escreve
  // (`m.shiny === true`). Um cliente mandando `'false'`, `1` ou `{}` não pode cair na família
  // shiny por coerção.
  const src = fonte('src/server/sim.mjs');
  ok(
    /const shiny = m\.shiny === true;/.test(src),
    "o handler compara `m.shiny === true` (sem coerção)",
  );
}

// ============================================================ 2. dex que não existe

console.log('\n2. FABRICAR A PEDRA DE QUEM NÃO EXISTE');

const DEX_FORJADOS = [
  0, -1, -94, 1.5, 93.999, 99999, Infinity, -Infinity, NaN,
  2001, 2058, // Outland
  3094, 3475, // a própria mega
  13094, // o clone de Orre NÃO é chave da tabela (a mega mora no dex nacional)
  1, 25, 150, // espécies sem mega
  '94; DROP TABLE players', '', ' ', null, undefined, true, false, [], {},
  '__proto__', 'constructor', 'toString',
];
let brechas = [];
for (const dex of DEX_FORJADOS) {
  const p = jogador({ [FRAGMENTO_MEGA_ID]: 500, [FRAGMENTO_MEGA_SHINY_ID]: 500 });
  for (const shiny of [false, true]) {
    const r = fabricarMegaStone(p, dex, shiny);
    if (!r.erro) brechas.push(`${String(dex)}${shiny ? ' (shiny)' : ''} → ${r.itemId}`);
  }
  if (Number(p.items[FRAGMENTO_MEGA_ID]) !== 500 || Number(p.items[FRAGMENTO_MEGA_SHINY_ID]) !== 500) {
    brechas.push(`${String(dex)} COBROU numa recusa`);
  }
}
ok(!brechas.length, `${DEX_FORJADOS.length} dex forjados recusados sem cobrar`, brechas.slice(0, 6).join(' · '));

// `[94]` e `'0x5E'` viram 94 no `Number()` do JavaScript, então FABRICAM — e é o certo: o
// jogador escolheu o dex 94 escrevendo de outro jeito. O que não pode é a forma exótica abrir
// um atalho, então o que se mede é o PREÇO: a mesma Gengarite, pelos mesmos 10 fragmentos.
for (const exotico of [[94], '0x5E', ' 94 ', 94.0]) {
  const p = jogador({ [FRAGMENTO_MEGA_ID]: 10 });
  const r = fabricarMegaStone(p, exotico, false);
  const cobrou = (p.items[FRAGMENTO_MEGA_ID] ?? 0) === 0;
  const certa = r.itemId === MEGA_STONE_POR_DEX[94];
  if (!(!r.erro && cobrou && certa)) ok(false, `${JSON.stringify(exotico)} fabricou fora da regra`);
}
ok(true, 'dex escrito de forma exótica ([94], hex, com espaço) fabrica a MESMA pedra pelo MESMO preço');

{
  // Poluição de protótipo pelo lado do valor: um dex que vira chave herdada não pode achar
  // pedra nenhuma.
  const p = jogador({ [FRAGMENTO_MEGA_ID]: 500 });
  const r = fabricarMegaStone(p, { valueOf: () => 94 }, false);
  // `{ valueOf }` também vira 94 — e, de novo, só vale se cobrar.
  const debitou = Number(p.items[FRAGMENTO_MEGA_ID] ?? 0) === (r.erro ? 500 : 490);
  ok(debitou, 'objeto com `valueOf` não fabrica de graça');
}

{
  // Poluição de protótipo: `__proto__` como dex não pode escrever em `Object.prototype`, e a
  // bolsa que sai da fabricação não pode ganhar chaves herdadas.
  const p = jogador({ [FRAGMENTO_MEGA_ID]: 500 });
  fabricarMegaStone(p, '__proto__', false);
  fabricarMegaStone(p, 'constructor', true);
  ok({}.polui === undefined && {}[71094] === undefined, 'nada vazou para Object.prototype');
  ok(Object.keys(p.items).every((k) => /^\d+$/.test(k)), 'a bolsa só tem chaves numéricas');
}

// =================================================== 3. megaevoluir de graça / 2x

console.log('\n3. MEGAEVOLUIR DE GRAÇA, DUAS VEZES OU NO BICHO ERRADO');

ok(megaStoneDeEvolucao(3094, false) === null, 'a mega #3094 não tem pedra (não megaevolui de novo)');
ok(megaStoneDeEvolucao(3094, true) === null, 'nem na família shiny');
ok(
  MEGAS.every((m) => megaStoneDeEvolucao(megaPokeId(m.dex), false) === null),
  'nenhuma das 32 megas aceita uma segunda mega',
);
ok(megaDaEspecie(3094) === null, 'e `megaDaEspecie` da mega é null (a trava do handler)');

ok(megaStoneDeEvolucao(2001, false) === null, 'variante de Outland não megaevolui');
ok(megaStoneDeEvolucao(25, false) === null, 'espécie sem mega não tem pedra');
ok(megaStoneDeEvolucao(306, true)?.itemId === MEGA_SHINY_STONE_POR_DEX[306], 'Aggron shiny pede a Shiny Aggronite');
ok(megaStoneDeEvolucao(306, false)?.itemId === MEGA_STONE_POR_DEX[306], 'e o Aggron comum, a Aggronite');
// A trava de "mega sem arte shiny" não tem dono hoje (as 32 têm shiny), mas continua valendo:
// é ela que impede vender uma pedra que não dá para usar quando uma mega nova chegar sem arte.
{
  const semArte = MEGAS.map((m) => (m.slug === 'gengar' ? { ...m, semShiny: true } : m));
  ok(!megaTemShiny(semArte.find((m) => m.slug === 'gengar')), 'a guarda `semShiny` segue de pé');
}

{
  // A pedra é derivada da ESPÉCIE e do `pk.shiny`, nunca de um campo do pacote. Um Gengar
  // shiny não pode gastar a Gengarite comum, e um Gengar comum não pode gastar a shiny.
  ok(megaStoneDeEvolucao(94, true).itemId !== megaStoneDeEvolucao(94, false).itemId, 'as duas pedras do Gengar são itens diferentes');
  const src = fonte('src/server/sim.mjs');
  const bloco = src.slice(src.indexOf("'pokemon.mega': (p, m) => {"), src.indexOf("'pokemon.refinar': (p, m) => {"));
  ok(bloco.length > 500, 'o handler `pokemon.mega` existe no sim');
  ok(
    /megaStoneDeEvolucao\(pk\.speciesId, !!pk\.shiny\)/.test(bloco),
    'a pedra vem de `pk.speciesId` + `pk.shiny` — nunca do pacote',
  );
  ok(!/m\.itemId|m\.pedra|m\.dex|m\.alvoId|m\.shiny/.test(bloco), 'o handler NÃO lê itemId/dex/shiny do pacote');
  ok(/const pk = p\.pokemons\.get\(Number\(m\.pokemonId\)\);/.test(bloco), 'e só alcança pokémon da PRÓPRIA conta');
  ok(/if \(!pk\) return evento/.test(bloco), 'pokémon que não é seu (ou já vendido) é recusado');
  ok(/pk\.shiny && !megaTemShiny\(meta\)/.test(bloco), 'shiny sem mega shiny é recusado (não destrói o shiny)');
  ok(/const tem = p\.items\[pedra\.itemId\] \?\? 0;[\s\S]{0,120}if \(tem < 1\)/.test(bloco), 'confere a pedra ANTES de trocar a espécie');
  ok(
    bloco.indexOf('p.items[pedra.itemId] = tem - 1;') < bloco.indexOf('pk.speciesId = novaEsp.pokeId;'),
    'e DEBITA antes de trocar (uma falha no meio não deixa mega de graça)',
  );
  ok(/temSpriteJogo\(novaEsp\)/.test(bloco), 'mega sem arte publicada é recusada (não entrega bicho invisível)');
  ok(/travarPokemon\(p, pk\.id\)/.test(bloco), 'e o pokémon fica trancado na venda depois');
  ok(/enfileirarEconomia\(p, \(\) => \{/.test(bloco), 'roda na fila de economia (duas abas não gastam a mesma pedra)');
  ok(/auditar\(/.test(bloco), 'e deixa linha de auditoria');

  const blocoFab = src.slice(src.indexOf("'mega.fabricar': (p, m) => {"), src.indexOf("'item.use': (p, m) => {"));
  ok(blocoFab.length > 300, 'o handler `mega.fabricar` existe no sim');
  ok(/enfileirarEconomia\(p, \(\) => \{/.test(blocoFab), 'a fabricação também roda na fila de economia');
  ok(/auditar\(/.test(blocoFab), 'e também deixa linha de auditoria');
}

// ========================================================= 4. o item do cliente

console.log('\n4. O CLIENTE NÃO ESCOLHE O ITEM');

{
  const proto = fonte('src/server/protocol.mjs');
  ok(/POKEMON_MEGA: 'pokemon\.mega', \/\/ \{ pokemonId \}/.test(proto), 'o protocolo de `pokemon.mega` só declara `pokemonId`');
  ok(/MEGA_FABRICAR: 'mega\.fabricar', \/\/ \{ dex, shiny\? \}/.test(proto), 'e o de `mega.fabricar`, `dex` e `shiny`');
}

{
  // Na fabricação o cliente ESCOLHE o dex — é o ponto da bancada —, mas o item que sai vem da
  // tabela, não do pacote. Confere que todo dex válido devolve exatamente a pedra daquele dex.
  const erradas = [];
  for (const m of MEGAS) {
    const p = jogador({ [FRAGMENTO_MEGA_ID]: 10, [FRAGMENTO_MEGA_SHINY_ID]: 10 });
    const r = fabricarMegaStone(p, m.dex, false);
    if (r.itemId !== MEGA_STONE_POR_DEX[m.dex]) erradas.push(`${m.slug} comum`);
    if (megaTemShiny(m)) {
      const s = fabricarMegaStone(p, m.dex, true);
      if (s.itemId !== MEGA_SHINY_STONE_POR_DEX[m.dex]) erradas.push(`${m.slug} shiny`);
    }
  }
  ok(!erradas.length, 'as 63 pedras saem do dex pedido, nunca de outro', erradas.join(', '));
}

// ================================================= 5. o que vai no welcome

console.log('\n5. O QUE VAZA NO WELCOME');

{
  const cfg = configMega();
  const texto = JSON.stringify(cfg);
  ok(!/chanceDrop|segredo|token|senha/i.test(texto), 'a config não leva nada que não seja público');
  ok(cfg.pedras.every((x) => Number.isInteger(x.itemId)), 'os ids são inteiros (nada de objeto solto)');
  const bytes = Buffer.byteLength(texto, 'utf8');
  ok(bytes < 8000, `a config da mega pesa ${bytes} B no welcome (teto 8 KB)`);
}

// ================================================ 6. custo do pedido mais caro

console.log('\n6. O PEDIDO MAIS CARO');

{
  // Fabricar é O(1): uma consulta num Map de 32 e duas escritas na bolsa. 200 mil chamadas
  // medem o pior caso realista de um script martelando o socket até o balde de limite cortar.
  const p = jogador({ [FRAGMENTO_MEGA_ID]: 2_000_000 });
  const t0 = performance.now();
  for (let i = 0; i < 200_000; i++) fabricarMegaStone(p, MEGAS[i % MEGAS.length].dex, false);
  const ms = performance.now() - t0;
  ok(ms < 2000, `200.000 fabricações em ${ms.toFixed(0)} ms (teto 2 s)`);
  // A bolsa APAGA a chave quando zera (é o que mantém o jsonb pequeno) — por isso o `?? 0`.
  ok(Number(p.items[FRAGMENTO_MEGA_ID] ?? 0) === 0, 'e a conservação aguenta 200 mil: sobrou 0 fragmento');
  ok(pedrasDe(p) === 200_000, `e existem 200.000 pedras (${pedrasDe(p)})`);
}

{
  // A recusa tem de ser BARATA: é ela que um script vai receber 99,99% das vezes.
  const p = jogador({});
  const t0 = performance.now();
  for (let i = 0; i < 500_000; i++) fabricarMegaStone(p, 999999, false);
  const ms = performance.now() - t0;
  ok(ms < 1500, `500.000 recusas em ${ms.toFixed(0)} ms (teto 1,5 s)`);
  ok(Object.keys(p.items).length === 0, 'e a bolsa continua vazia depois de meio milhão de recusas');
}

{
  // `megaDaEspecie` roda em toda pintura do painel do cliente e em todo `pokemon.mega`.
  const ids = [...especies.keys()];
  const t0 = performance.now();
  let achou = 0;
  for (let i = 0; i < 500_000; i++) if (megaDaEspecie(ids[i % ids.length])) achou++;
  const ms = performance.now() - t0;
  ok(ms < 1500, `500.000 consultas de megaDaEspecie em ${ms.toFixed(0)} ms (teto 1,5 s)`);
  ok(achou > 0, 'e elas de fato acham megas (não é um laço vazio)');
}

console.log('\n==============================================');
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `todos os ${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
