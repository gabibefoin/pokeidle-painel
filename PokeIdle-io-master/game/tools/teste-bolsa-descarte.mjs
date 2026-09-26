// A LIXEIRA DA BOLSA, sob ataque.
//
// Descarte é a única operação do jogo cujo resultado certo é sempre um número MENOR. Todo este
// arquivo existe para provar que não há pacote — nenhum — que faça a conta terminar maior:
//
//   1. NUNCA AUMENTA. Para todo lixo em `qtd` (negativo, `NaN`, `Infinity`, string, array,
//      fracionário, acima do inteiro seguro), ou a operação é recusada e nada muda, ou ela tira
//      exatamente o que disse que tirou. `qtd: -500` é o convite clássico: se alguma conta
//      multiplicasse por um negativo, o descarte viraria duplicação;
//   2. SÓ A ABA TREINADOR. Fragmento de Chave, pedra, loot, TM e Caixa de Fundador são recusados
//      mesmo com o pacote na mão — a lixeira não pode virar o caminho curto para apagar o que
//      não se repõe;
//   3. NÃO PASSA DO QUE TEM. Pedir 1 bilhão com 200 na mochila tira 200, e o saldo nunca fica
//      negativo (um saldo negativo somado depois viraria item de graça);
//   4. a corrida: vinte descartes ao mesmo tempo não tiram mais do que existe.
//
//   node tools/teste-bolsa-descarte.mjs
import { readFileSync } from 'node:fs';
import { bolas, itens } from '../src/server/content.mjs';
import { descartar, podeDescartar, ErroDescarte } from '../src/server/game/bolsa-descarte.mjs';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};
const secao = (s) => console.log(`\n${s}`);
const ler = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const erroDe = (fn) => { try { fn(); return null; } catch (e) { return e; } };

/** Um jogador de mentira, com a mochila que o teste pedir. */
const jogador = (balls = {}, items = {}) => ({
  dbId: 9, nick: 'alvo', balls: { ...balls }, items: { ...items },
});
const auditor = () => { const linhas = []; return { linhas, auditar: (d, r) => linhas.push(`${r} ${d}`) }; };

const POKE_BALL = 1;
const REVIVE = 205;

/** O CATÁLOGO DE LIXO — o que um atacante digita no console antes de apertar enter. */
const LIXO_QTD = [
  ['negativo', -1], ['negativo gigante', -1e9], ['zero', 0], ['fração', 0.5],
  ['fração negativa', -0.4], ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity],
  ['string de número', '10'], ['string científica', '1e9'], ['texto', 'dez'], ['string vazia', ''],
  ['acima do inteiro seguro', 9007199254740993], ['MAX_VALUE', Number.MAX_VALUE],
  ['array', [7]], ['array vazio', []], ['objeto', {}], ['objeto com valueOf', { valueOf: () => 1e9 }],
  ['null', null], ['undefined', undefined], ['true', true], ['false', false],
];

// =====================================================================================
secao('1 · A lixeira NUNCA aumenta nada');
{
  const furos = [];
  for (const [nome, v] of LIXO_QTD) {
    const p = jogador({ [POKE_BALL]: 1000 }, { [REVIVE]: 500 });
    const a = auditor();
    const r = erroDe(() => descartar(p, { tipo: 'bola', id: POKE_BALL, qtd: v }, a));
    const tem = p.balls[POKE_BALL] ?? 0;
    if (r) {
      // Recusado: a mochila não pode ter sido tocada.
      if (!(r instanceof ErroDescarte)) furos.push(`${nome}: erro solto ${r.message}`);
      if (tem !== 1000) furos.push(`${nome}: recusou mas mexeu (${tem})`);
      if (a.linhas.length) furos.push(`${nome}: recusou mas auditou`);
    } else if (tem > 1000) {
      furos.push(`${nome}: AUMENTOU para ${tem}`);
    } else if (tem < 0) {
      furos.push(`${nome}: saldo NEGATIVO (${tem})`);
    }
    if ((p.items[REVIVE] ?? 0) !== 500) furos.push(`${nome}: mexeu no que não foi pedido`);
  }
  ok(!furos.length, `os ${LIXO_QTD.length} lixos em qtd não criam item nem saldo negativo`, furos.join(' | '));

  // O único caminho que funciona: inteiro positivo. E ele tira EXATAMENTE o que disse.
  const p = jogador({ [POKE_BALL]: 1000 });
  const a = auditor();
  const r = descartar(p, { tipo: 'bola', id: POKE_BALL, qtd: 300 }, a);
  ok(p.balls[POKE_BALL] === 700 && r.qtd === 300 && r.resta === 700,
    'um pedido válido tira exatamente o que pediu', `${p.balls[POKE_BALL]}`);
  ok(a.linhas.length === 1 && a.linhas[0].startsWith('bola:1'), 'e deixa uma linha de auditoria');
}

// =====================================================================================
secao('2 · Não passa do que tem');
{
  const p = jogador({ [POKE_BALL]: 200 });
  const r = descartar(p, { tipo: 'bola', id: POKE_BALL, qtd: 1_000_000_000 }, auditor());
  ok(r.qtd === 200 && r.resta === 0, 'pedir 1 bilhão com 200 na mochila tira 200', `${r.qtd}`);
  ok(!(POKE_BALL in p.balls), 'e a chave some quando zera (não fica um 0 pendurado)');

  const vazio = jogador({});
  const e = erroDe(() => descartar(vazio, { tipo: 'bola', id: POKE_BALL, qtd: 1 }, auditor()));
  ok(e instanceof ErroDescarte && e.message === 'bolsa.descarte.recusa.semItem',
    'jogar fora o que não se tem é recusado');

  // Saldo torto no próprio jogador (corrupção, migração antiga): não pode virar item.
  for (const torto of [-50, 0, NaN, Infinity, null, undefined, '30', {}]) {
    const q = jogador({ [POKE_BALL]: torto });
    const er = erroDe(() => descartar(q, { tipo: 'bola', id: POKE_BALL, qtd: 5 }, auditor()));
    const depois = q.balls[POKE_BALL];
    if (torto === '30') {
      ok(!er && depois === 25, 'saldo em string vira número e desce', `${depois}`);
    } else {
      ok(er instanceof ErroDescarte, `saldo torto (${String(torto)}) é recusado`, String(depois));
    }
  }
}

// =====================================================================================
secao('3 · Só a aba Treinador — o resto é intocável');
{
  // Toda bola é descartável; todo item de cura/revive também.
  const bolasOk = bolas.every((b) => podeDescartar('bola', b.id));
  ok(bolasOk, `as ${bolas.length} bolas do catálogo podem ir para a lixeira`);
  const cura = [...itens.values()].filter((i) => i.category === 'heal' || i.category === 'revive');
  ok(cura.every((i) => podeDescartar('item', i.id)), `e os ${cura.length} itens de cura/revive também`);

  // E NADA fora disso. Os ids que doem: fragmento, pedra, TM, loot, Boss Token.
  const fora = [...itens.values()].filter((i) => i.category !== 'heal' && i.category !== 'revive');
  const vazaram = fora.filter((i) => podeDescartar('item', i.id));
  ok(!vazaram.length, `nenhum dos ${fora.length} itens de outras abas é descartável`,
    vazaram.slice(0, 5).map((i) => `${i.id} ${i.name}`).join(', '));

  for (const id of [70011, 70012, 70013, 70000, 59194, 40530]) {
    const p = jogador({}, { [id]: 10 });
    const e = erroDe(() => descartar(p, { tipo: 'item', id, qtd: 1 }, auditor()));
    ok(e instanceof ErroDescarte && e.message === 'bolsa.descarte.recusa.invalido'
      && p.items[id] === 10, `o item ${id} (fragmento/token/TM) é recusado e fica intacto`);
  }

  // A definição do SERVIDOR e a da TELA têm de dizer a mesma coisa, ou o jogador vê um botão
  // que o servidor recusa (ou, pior, não vê um que ele aceitaria).
  const app = ler('src/client/app.js');
  const cat = app.slice(app.indexOf('function categoriaBolsa('), app.indexOf('\n}', app.indexOf('function categoriaBolsa(')));
  ok(cat.includes("if (ent.tipo === 'bola') return 'treinador';"), 'a tela põe toda bola em Treinador');
  ok(cat.includes("if (item.category === 'heal' || item.category === 'revive') return 'treinador';"),
    'e cura/revive também — a mesma regra do servidor');
}

// =====================================================================================
secao('4 · Tipo e id forjados');
{
  const tiposHostis = ['bolas', 'item ', 'ITEM', 'Bola', '', '__proto__', 'constructor',
    ['bola'], { toString: () => 'bola' }, 0, 1, null, undefined, true];
  const furos = [];
  for (const tipo of tiposHostis) {
    const p = jogador({ [POKE_BALL]: 50 }, { [REVIVE]: 50 });
    const e = erroDe(() => descartar(p, { tipo, id: POKE_BALL, qtd: 1 }, auditor()));
    if (!(e instanceof ErroDescarte)) furos.push(`tipo ${JSON.stringify(tipo)} passou`);
    if ((p.balls[POKE_BALL] ?? 0) !== 50) furos.push(`tipo ${JSON.stringify(tipo)} mexeu na mochila`);
  }
  ok(!furos.length, `nenhum dos ${tiposHostis.length} tipos hostis passa`, furos.join(' | '));

  const idsHostis = ['1', '__proto__', 'constructor', 'toString', 0, -1, -1e9, 0.5, NaN, Infinity,
    9007199254740993, Number.MAX_VALUE, [1], {}, null, undefined, true, { valueOf: () => 1 }];
  const furosId = [];
  for (const id of idsHostis) {
    const p = jogador({ [POKE_BALL]: 50 });
    const e = erroDe(() => descartar(p, { tipo: 'bola', id, qtd: 1 }, auditor()));
    if (!(e instanceof ErroDescarte)) furosId.push(`id ${JSON.stringify(id)} passou`);
    if ((p.balls[POKE_BALL] ?? 0) !== 50) furosId.push(`id ${JSON.stringify(id)} mexeu na mochila`);
  }
  ok(!furosId.length, `nem os ${idsHostis.length} ids hostis — inclusive a string "1"`, furosId.join(' | '));

  // Poluição de protótipo pelos três campos do pacote.
  const sujo = JSON.parse('{"tipo":"bola","id":1,"qtd":1,"__proto__":{"invadido":true},"constructor":{"prototype":{"invadido2":true}}}');
  descartar(jogador({ [POKE_BALL]: 10 }), sujo, auditor());
  ok(({}).invadido === undefined && ({}).invadido2 === undefined, 'o pacote não suja Object.prototype');

  // E o `__proto__` como CHAVE da mochila não vira item.
  const p = jogador({ [POKE_BALL]: 10 });
  erroDe(() => descartar(p, { tipo: 'bola', id: '__proto__', qtd: 1 }, auditor()));
  ok(Object.keys(p.balls).join(',') === String(POKE_BALL), 'e a mochila segue com as chaves dela');
}

// =====================================================================================
secao('5 · A corrida: vinte descartes ao mesmo tempo');
{
  // A fila de economia do sim serializa, mas a defesa não pode DEPENDER dela. Como a função é
  // toda síncrona, vinte chamadas soltas só podem terminar de um jeito: 150 a menos, e zero.
  const p = jogador({ [POKE_BALL]: 150 });
  let tirado = 0;
  let recusas = 0;
  for (let i = 0; i < 20; i++) {
    try {
      tirado += descartar(p, { tipo: 'bola', id: POKE_BALL, qtd: 100 }, auditor()).qtd;
    } catch (e) {
      if (e instanceof ErroDescarte) recusas += 1;
      else throw e;
    }
  }
  ok(tirado === 150, 'vinte pedidos de 100 com 150 na mochila tiram 150', `${tirado}`);
  ok(!(POKE_BALL in p.balls), 'e a mochila fica vazia, não negativa');
  ok(recusas === 18, 'os outros dezoito são recusados por não ter item', `${recusas}`);
}

// =====================================================================================
secao('6 · No fonte: o que o módulo não sabe fazer');
{
  const mod = ler('src/server/game/bolsa-descarte.mjs')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  ok(!/\+=/.test(mod), 'não existe `+=` no módulo — ele só sabe subtrair');
  ok(!/somarGold|creditar|p\.gold|p\.diamonds|p\.orbs|pool\.query/.test(mod),
    'e ele não toca em moeda nem no banco');
  ok(/Number\.isSafeInteger\(pedido\)/.test(mod), 'a quantidade passa por `isSafeInteger`');
  ok(/Math\.min\(pedido, tem\)/.test(mod), 'e é presa no que o jogador tem');

  const sim = ler('src/server/sim.mjs');
  const bloco = sim.slice(sim.indexOf("  'bolsa.descartar'"), sim.indexOf("  'shop.sellAllItems'"));
  ok(bloco.includes('enfileirarEconomia(p'), 'o comando roda na fila de economia');
  ok(bloco.includes('auditar(p, ') && bloco.includes("'descarte'"), 'e toda passagem é auditada');
  ok(/^ {2}'bolsa\.descartar': \(p, m\) => \{/m.test(sim), 'o comando existe uma vez só');

  const lim = ler('src/server/limites-ws.mjs');
  ok(/\['bolsa\.descartar', 'descarte'\]/.test(lim) && /descarte: \{ capacidade: 10/.test(lim),
    'e tem balde de limite próprio (10 de rajada)');

  // A TELA só oferece a lixeira na aba Treinador — e o servidor não confia nisso, mas a tela
  // também não pode oferecer o que vai ser recusado.
  const app = ler('src/client/app.js');
  ok(app.includes("if (aba === 'treinador') host.appendChild(barraDaLixeira());"),
    'a barra da lixeira só aparece na aba Treinador');
  ok(app.includes("else estado.bolsaLixeira = false;"), 'e o modo se desliga ao trocar de aba');
  ok(app.includes("enviar({ t: 'bolsa.descartar', tipo, id, qtd: ctd.ler() });"),
    'o pedido leva só tipo, id e quantidade');
}

console.log(`\n${testes - falhas}/${testes} ok`);
if (falhas) console.log(`${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
