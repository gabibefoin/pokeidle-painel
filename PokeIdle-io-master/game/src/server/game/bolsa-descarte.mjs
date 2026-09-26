// A LIXEIRA DA BOLSA — jogar fora o que encheu a mochila e não serve para nada.
//
// Quem caça o dia inteiro termina com 180 mil Poké Balls e 100 mil Great Balls, que não valem o
// suficiente para dar trabalho vender e ocupam a primeira tela da bolsa. A lixeira é a saída: o
// jogador escolhe o item e QUANTO quer jogar fora, e aquilo some.
//
// ### A regra de ouro: isto só SUBTRAI
//
// Um descarte é a única operação do jogo cujo resultado certo é sempre um número MENOR. Todo o
// desenho abaixo existe para que não haja caminho — nenhum, com nenhum pacote — em que a conta
// termine maior do que começou:
//
//   · a quantidade pedida é presa em `[1, o que ele tem]`. Negativo, zero, `NaN`, `Infinity` e
//     fracionário são RECUSADOS antes de qualquer conta, e não convertidos para um "1" simpático:
//     quem manda `-500` está testando o servidor, não errando o dedo;
//   · a conta é `tem - qtd`, com `qtd <= tem` já garantido. Não existe `+=` neste arquivo;
//   · o id precisa existir no catálogo E estar na aba TREINADOR. Sem isso, a lixeira viraria o
//     caminho mais curto para apagar um Fragmento de Chave por engano — ou de propósito, num
//     pacote forjado contra a conta de outra pessoa.
//
// ### Por que só a aba Treinador
//
// É onde estão as bolas e as poções: coisas que se acumulam aos milhares e se repõem farmando.
// Item raro, pedra, loot e as Caixas de Fundador ficam de fora porque o arrependimento ali é
// caro e irreversível — e um "joguei fora sem querer" com o Fragmento de Chave é um ticket de
// suporte que não tem resposta boa.
import { bolaPorId, itens } from '../content.mjs';

/** Recusa com chave de texto — a tela traduz (`bolsa.descarte.recusa.*`). */
export class ErroDescarte extends Error {}

/** As categorias de item que a aba Treinador mostra. Espelha `categoriaBolsa` no cliente. */
const CATEGORIAS_TREINADOR = new Set(['heal', 'revive']);

/**
 * Este par (tipo, id) pode ir para a lixeira?
 *
 * É a definição AUTORITATIVA — a do cliente (`categoriaBolsa`) serve para desenhar, esta serve
 * para decidir. `teste-bolsa-descarte.mjs` confere que as duas dizem a mesma coisa.
 */
export function podeDescartar(tipo, id) {
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  if (tipo === 'bola') return bolaPorId.has(id);
  if (tipo === 'item') return CATEGORIAS_TREINADOR.has(itens.get(id)?.category);
  return false;
}

/** O nome que vai para a auditoria e para o aviso na tela. */
const nomeDo = (tipo, id) => (tipo === 'bola' ? bolaPorId.get(id)?.nome : itens.get(id)?.name) ?? `#${id}`;

/**
 * Joga fora `qtd` de um item da aba Treinador. Devolve `{ tipo, id, nome, qtd, resta }`.
 *
 * `auditar` entra por parâmetro porque é do `sim.mjs`. A linha de auditoria não é opcional: o
 * descarte é irreversível, e quando alguém abrir um ticket dizendo "sumiram minhas 180 mil
 * pokébolas" a resposta precisa estar escrita em algum lugar.
 */
export function descartar(p, msg, { auditar }) {
  const tipo = msg?.tipo;
  // `String` explícito, e não coerção: `tipo: ['bola']` viraria "bola" numa comparação frouxa.
  if (tipo !== 'bola' && tipo !== 'item') throw new ErroDescarte('bolsa.descarte.recusa.invalido');

  const id = typeof msg?.id === 'number' ? msg.id : Number.NaN;
  if (!podeDescartar(tipo, id)) throw new ErroDescarte('bolsa.descarte.recusa.invalido');

  // A QUANTIDADE. Recusa em vez de consertar: um pedido torto não é um pedido de 1.
  const pedido = msg?.qtd;
  if (!Number.isSafeInteger(pedido) || pedido < 1) throw new ErroDescarte('bolsa.descarte.recusa.qtd');

  // O SALDO precisa ser um número finito. `Math.floor(Infinity)` é `Infinity`, e um saldo
  // infinito (corrupção, migração antiga, campo adulterado) faria `tem - qtd` continuar infinito:
  // o jogador descartaria para sempre sem a conta nunca baixar. `isFinite` antes do `floor` é o
  // que transforma isso numa recusa em vez de num poço sem fundo.
  const saco = tipo === 'bola' ? p.balls : p.items;
  const bruto = Number(saco?.[id]);
  const tem = Number.isFinite(bruto) ? Math.floor(bruto) : 0;
  if (tem < 1) throw new ErroDescarte('bolsa.descarte.recusa.semItem');

  // O piso é o que ele TEM. Daqui em diante `qtd` é no máximo `tem`, e a subtração não tem como
  // virar soma nem deixar saldo negativo.
  const qtd = Math.min(pedido, tem);
  const resta = tem - qtd;
  if (resta > 0) saco[id] = resta;
  else delete saco[id];

  const nome = nomeDo(tipo, id);
  auditar(
    `${nome} ×${qtd.toLocaleString('pt-BR')} jogado fora (${tem.toLocaleString('pt-BR')} → ${resta.toLocaleString('pt-BR')})`,
    `${tipo}:${id}`,
  );

  return { tipo, id, nome, qtd, resta };
}
