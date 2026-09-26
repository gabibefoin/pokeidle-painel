/**
 * As cinco raridades de BICICLETA — a tabela que servidor e cliente leem.
 *
 * ### O problema que ela resolve
 *
 * Nas hunts de spawn espaçado (a Outland, sobretudo) o pokémon passa boa parte do tempo
 * ANDANDO de um selvagem ao outro. O IV de Speed não ajuda: ele encurta o cooldown do golpe,
 * não o passo. A bicicleta é a progressão de mobilidade que faltava — encurta o passo do
 * pokémon e do treinador na hunt, e só na hunt.
 *
 * ### O caminho da Casa, com uma diferença
 *
 * Do drop até a venda é o caminho da Casa, que já está provado em produção: um ITEM na bolsa
 * (o Mercado da Comunidade já sabe negociar item), 10 fragmentos que caem só na Outland, uma
 * bancada no Professor Carvalho e a raridade SORTEADA com os pesos dela. Os pesos não são
 * copiados à mão — saem de `RARIDADES_CASA`, então balancear a Casa balanceia a bicicleta.
 *
 * A diferença é a posse. Casa é uma por conta; bicicleta, não: o jogador pode ter QUANTAS
 * quiser na bolsa, de qualquer raridade, e escolhe UMA para equipar. Só a equipada vale, e as
 * porcentagens NÃO somam — uma Comum, uma Incomum e uma Lendária na bolsa com a Comum equipada
 * é andar a +15%, não a +140%. A escolha é UM número (`automation.bicicletaEquipada`), então
 * "duas equipadas" nem tem como ser escrito.
 *
 * ### Onde ela NÃO vale
 *
 * PvP, Ginásio e Guild rodam em simuladores próprios que nunca leem a bolsa, e a arena do boss
 * usa o campo da hunt mas zera o fator (ver `processar`, no sim). O ganho é tempo de caminhada
 * na hunt — nunca dano, cooldown ou alcance.
 */

import { RARIDADES_CASA, numeroDaCasa } from './casas.mjs';

/**
 * O número de uma bicicleta como a tela o escreve — `#000042`. A MESMA largura da casa: as duas são
 * peças numeradas do Professor Carvalho, lado a lado nos registros, e os números se alinham.
 */
export const numeroDaBicicleta = (id) => numeroDaCasa(id);

/** O que cada raridade compra: +15% na Comum … +100% (passo na metade) na Lendária. */
const VELOCIDADE = { comum: 0.15, incomum: 0.25, rara: 0.5, mitica: 0.75, lendaria: 1 };

/** Ordem CRESCENTE de raridade, com os pesos da Casa. `en` é o nome do item no catálogo. */
export const RARIDADES_BICICLETA = RARIDADES_CASA.map((r) => ({
  id: r.id,
  rotulo: r.rotulo,
  en: r.en,
  velocidade: VELOCIDADE[r.id],
  peso: r.peso,
}));

/**
 * A raridade, se `v` é uma — ou `null`.
 *
 * Passa por aqui o que vem do cliente (`bicicleta.equipar`) e o que volta do jsonb gravado.
 * `typeof` antes de tudo: só string que é id de raridade passa; `["rara"]`, `{}` e `1` não.
 */
export function raridadeBicicletaValida(v) {
  if (typeof v !== 'string') return null;
  return RARIDADES_BICICLETA.some((r) => r.id === v) ? v : null;
}

/** A fração a mais de velocidade da raridade. Bicicleta nenhuma = 0. */
export const velocidadeDaRaridade = (id) =>
  RARIDADES_BICICLETA.find((r) => r.id === id)?.velocidade ?? 0;

/** O fator que DIVIDE a duração do passo: 1 a pé, 2 na Lendária. */
export const fatorPassoDaRaridade = (id) => 1 + velocidadeDaRaridade(id);

/**
 * A duração de um passo com a bicicleta.
 *
 * Fator que não é número, é infinito ou é menor que 1 vale 1: a bicicleta nunca deixa ninguém
 * mais LENTO, e um valor torto no campo não pode travar o herói com um passo de zero ou de
 * infinitos milissegundos.
 */
export function passoComBicicleta(passoMs, fator = 1) {
  const f = Number(fator);
  if (!Number.isFinite(f) || f <= 1) return passoMs;
  return Math.max(1, Math.round(passoMs / f));
}

/**
 * Sorteia a raridade de UMA bicicleta, pelos pesos da Casa.
 *
 * `aleatorio` entra por parâmetro pela mesma razão de `sortearRaridadeCasa`: o teste fixa o
 * resultado em vez de rodar milhões de sorteios.
 */
export function sortearRaridadeBicicleta(aleatorio = Math.random) {
  const total = RARIDADES_BICICLETA.reduce((s, r) => s + r.peso, 0);
  let n = aleatorio() * total;
  for (const r of RARIDADES_BICICLETA) {
    if (n < r.peso) return r.id;
    n -= r.peso;
  }
  return RARIDADES_BICICLETA[0].id;
}
