// Teste do REDUZIR O NÍVEL — sem banco e sem Redis.
//
// A mensagem `pokemon.reduzirNivel` passou a levar `nivelAlvo`, um número que o CLIENTE escreve.
// Este teste é a prova de que não há valor nesse campo que faça um pokémon subir de nível.
//
// O que ele protege:
//   · o porteiro `validarNivelAlvo` NUNCA devolve um nível ≥ ao de agora nem abaixo do piso,
//     qualquer que seja o `nivelAlvo` — varrido em milhares de combinações;
//   · negativo, zero, acima do atual, fração, string, array, objeto, `null`, booleano,
//     `Infinity` e o que sai de um `JSON.parse` de mensagem adulterada são RECUSADOS — e não
//     arredondados para a borda (um `-40` não pode virar "baixar até o piso");
//   · quem já está no piso (ou abaixo dele) não tem faixa nenhuma;
//   · o campo nasce no maior nível que cabe no treinador, sempre dentro da faixa;
//   · o handler do servidor entrega `m.nivelAlvo` CRU ao porteiro, sem `Number()` no caminho;
//   · o caso que motivou o campo: Venusaur nv 499 comprado com o treinador no 188.
//
//   node tools/teste-reduzir-nivel.mjs
import { readFileSync } from 'node:fs';
import {
  PASSO_REDUCAO_NIVEL,
  faixaReducaoNivel,
  podeReduzirNivel,
  nivelSugeridoReducao,
  validarNivelAlvo,
} from '../src/shared/reduzir-nivel.mjs';
import { FOLGA_NIVEL_POKEMON, podeUsarPokemon } from '../src/shared/pokemon-nivel-treinador.mjs';
import { especies, pisoDeReducaoDaEspecie } from '../src/server/content.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

/** O que o handler faz com a mensagem — a mesma linha de `server/sim.mjs`. */
const alvoDaMensagem = (m, atual) => (m?.nivelAlvo === undefined ? atual - PASSO_REDUCAO_NIVEL : m.nivelAlvo);

console.log('REDUZIR O NÍVEL — o nível digitado pelo jogador\n===============================================');

// ------------------------------------------------------------------ a faixa

secao('A faixa — do piso até um abaixo do nível de agora');

ok(JSON.stringify(faixaReducaoNivel(499, 32)) === '{"min":32,"max":498}', 'nv 499, piso 32 → escolhe de 32 a 498');
ok(faixaReducaoNivel(32, 32) === null, 'no piso não há faixa');
ok(faixaReducaoNivel(5, 20) === null, 'ABAIXO do piso também não (descer até o piso seria subir)');
ok(podeReduzirNivel(33, 32) && !podeReduzirNivel(32, 32), 'podeReduzirNivel acompanha a faixa');

// --------------------------------------------------------- os pedidos legítimos

secao('Pedidos legítimos passam, e caem exatamente no nível pedido');

for (const [alvo, nome] of [
  [32, 'o próprio piso'],
  [193, 'um nível no meio'],
  [498, 'um abaixo do atual'],
]) {
  const r = validarNivelAlvo(499, 32, alvo);
  ok(r.ok && r.novo === alvo, `nv 499 → ${alvo} (${nome})`, JSON.stringify(r));
}

// ------------------------------------------------------ os pedidos adulterados

secao('Pedidos adulterados — todos recusados, nenhum arrastado para a borda');

const ATAQUES = [
  [-40, 'negativo (−40)'],
  [-1, 'negativo (−1)'],
  [0, 'zero'],
  [-0, 'menos zero'],
  [31, 'um abaixo do piso'],
  [499, 'o próprio nível atual'],
  [500, 'um ACIMA do atual'],
  [999999, 'nível absurdo'],
  [1e9, '1e9'],
  [2 ** 53, '2^53 (fora do inteiro seguro)'],
  [150.5, 'fração'],
  [Number.NaN, 'NaN'],
  [Number.POSITIVE_INFINITY, 'Infinity'],
  [Number.NEGATIVE_INFINITY, '−Infinity'],
  ['150', 'string "150"'],
  ['-40', 'string "-40"'],
  ['', 'string vazia'],
  [[150], 'array [150]'],
  [{ valueOf: () => 150 }, 'objeto com valueOf'],
  [null, 'null'],
  [true, 'true'],
  [undefined, 'undefined direto no porteiro'],
];

for (const [alvo, nome] of ATAQUES) {
  const r = validarNivelAlvo(499, 32, alvo);
  ok(!r.ok && r.novo === undefined, `${nome} → recusado`, JSON.stringify(r));
}

secao('Mensagens cruas, como chegam do WebSocket');

const MENSAGENS = [
  '{"t":"pokemon.reduzirNivel","pokemonId":7,"nivelAlvo":-40}',
  '{"t":"pokemon.reduzirNivel","pokemonId":7,"nivelAlvo":600}',
  '{"t":"pokemon.reduzirNivel","pokemonId":7,"nivelAlvo":1e400}',
  '{"t":"pokemon.reduzirNivel","pokemonId":7,"nivelAlvo":-1e400}',
  '{"t":"pokemon.reduzirNivel","pokemonId":7,"nivelAlvo":"193"}',
  '{"t":"pokemon.reduzirNivel","pokemonId":7,"nivelAlvo":[193]}',
  '{"t":"pokemon.reduzirNivel","pokemonId":7,"nivelAlvo":{"$gt":0}}',
  '{"t":"pokemon.reduzirNivel","pokemonId":7,"nivelAlvo":null}',
  '{"t":"pokemon.reduzirNivel","pokemonId":7,"nivelAlvo":193.0000001}',
];
for (const bruto of MENSAGENS) {
  const m = JSON.parse(bruto);
  const r = validarNivelAlvo(499, 32, alvoDaMensagem(m, 499));
  ok(!r.ok, `recusa ${bruto.slice(bruto.indexOf('nivelAlvo'))}`, JSON.stringify(r));
}
{
  // Sem o campo: a aba de antes do campo existir cai UM nível, pelo mesmo porteiro.
  const r = validarNivelAlvo(499, 32, alvoDaMensagem(JSON.parse('{"pokemonId":7}'), 499));
  ok(r.ok && r.novo === 498, 'mensagem sem nivelAlvo (aba antiga) → cai um nível', JSON.stringify(r));
  const noPiso = validarNivelAlvo(32, 32, alvoDaMensagem({ pokemonId: 7 }, 32));
  ok(!noPiso.ok && noPiso.motivo === 'noPiso', 'aba antiga no piso → recusado');
}

// --------------------------------------------------------------- a varredura

secao('Varredura — nenhum alvo, em nenhum nível, sobe ou fura o piso');

{
  const alvos = [-1e6, -100, -2, -1, 0, 1, 2, 3, 10, 50, 99, 100, 101, 250, 499, 500, 501, 1000, 1e6, 0.5, 7.25];
  let combinacoes = 0;
  let violacoes = 0;
  let aceitosForaDoPedido = 0;
  for (let atual = 1; atual <= 520; atual += 7) {
    for (const piso of [1, 5, 20, 32, 40, 80, 100, 499]) {
      for (const base of alvos) {
        for (const alvo of [base, atual - 1, atual, atual + 1, piso - 1, piso, piso + 1]) {
          combinacoes++;
          const r = validarNivelAlvo(atual, piso, alvo);
          if (!r.ok) continue;
          if (!(r.novo < atual && r.novo >= piso && Number.isSafeInteger(r.novo))) violacoes++;
          if (r.novo !== alvo) aceitosForaDoPedido++;
        }
      }
    }
  }
  ok(violacoes === 0, `${combinacoes.toLocaleString('pt-BR')} combinações: nenhum nível novo ≥ atual ou < piso`, `${violacoes} violações`);
  ok(aceitosForaDoPedido === 0, 'todo pedido aceito cai EXATAMENTE no nível pedido (nada é arredondado)', `${aceitosForaDoPedido}`);
}

// ----------------------------------------------------------------- a sugestão

secao('O nível com que o campo nasce');

ok(nivelSugeridoReducao(499, 32, 188) === 188 + FOLGA_NIVEL_POKEMON, `treinador 188 → campo em ${188 + FOLGA_NIVEL_POKEMON} (treinador + folga)`);
ok(nivelSugeridoReducao(60, 32, 188) === 59, 'pokémon que já cabe → sugere só um nível abaixo');
ok(nivelSugeridoReducao(499, 300, 10) === 300, 'treinador baixo demais → sugere o piso');
ok(nivelSugeridoReducao(32, 32, 188) === null, 'no piso não há sugestão');
{
  let fora = 0;
  for (let atual = 2; atual <= 600; atual += 11) {
    for (const piso of [1, 20, 80, 300]) {
      for (const tr of [0, 1, 50, 188, 400, 1000]) {
        const s = nivelSugeridoReducao(atual, piso, tr);
        if (s === null) continue;
        if (!validarNivelAlvo(atual, piso, s).ok) fora++;
      }
    }
  }
  ok(fora === 0, 'a sugestão SEMPRE passa no porteiro', `${fora} fora`);
}

// ------------------------------------------------------ o caso do jogador

secao('O caso do jogador — Venusaur nv 499, treinador nv 188');

{
  const venusaur = [...especies.values()].find((e) => e.name === 'Venusaur');
  ok(!!venusaur, 'Venusaur está no catálogo');
  if (venusaur) {
    const piso = pisoDeReducaoDaEspecie(venusaur);
    const sugerido = nivelSugeridoReducao(499, piso, 188);
    const r = validarNivelAlvo(499, piso, sugerido);
    ok(r.ok, `piso da espécie ${piso}; campo nasce no ${sugerido} e o pedido passa`, JSON.stringify(r));
    ok(!podeUsarPokemon(188, { level: 499 }) && podeUsarPokemon(188, { level: r.novo }), 'antes travado, depois do pedido usável — num pedido só');
  }
}

// ---------------------------------------------------------- o handler de verdade

secao('O handler do servidor entrega o número cru ao porteiro');

{
  const fonte = readFileSync(new URL('../src/server/sim.mjs', import.meta.url), 'utf8');
  const ini = fonte.indexOf("'pokemon.reduzirNivel':");
  const bloco = ini >= 0 ? fonte.slice(ini, fonte.indexOf('\n  },', ini)) : '';
  ok(bloco.length > 0, 'achei o handler em sim.mjs');
  ok(/validarNivelAlvo\(atual, piso, alvo\)/.test(bloco), 'o handler passa pelo validarNivelAlvo');
  ok(!/Number\(\s*m\??\.nivelAlvo/.test(bloco) && !/parseInt\(\s*m\??\.nivelAlvo/.test(bloco), 'nenhum Number()/parseInt() em m.nivelAlvo antes do porteiro');
  ok(/const atual = Math\.max\(1, Math\.floor\(Number\(pk\.level\)/.test(bloco), 'o nível de partida é o pk.level do servidor');
  ok(/if \(!pedido\.ok\)/.test(bloco) && bloco.indexOf('if (!pedido.ok)') < bloco.indexOf('pk.level = novo'), 'a recusa vem ANTES de gravar o nível');
}

console.log(`\n${testes - falhas}/${testes} ok`);
if (falhas) {
  console.log(`${falhas} falha(s)`);
  process.exit(1);
}
