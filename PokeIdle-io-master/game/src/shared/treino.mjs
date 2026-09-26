// A ÁREA DE TREINAMENTO — as regras puras, iguais no servidor e na tela.
//
// A aba "Treinamento" do PvP é um laboratório: o jogador monta dois lados (com pokémon DELE ou
// com pokémon de MENTIRA, montados na mão), manda lutar e assiste. Não há prêmio, não há XP, não
// há Coin, e NADA é gravado — nem o pokémon de teste, nem o resultado da luta.
//
// ### Por que os números vivem aqui
//
// A tela precisa deles para desenhar o formulário (os limites de cada campo, o que é um valor
// válido) e o servidor precisa deles para NÃO CONFIAR na tela. Duas cópias divergiriam no
// primeiro ajuste, e a divergência aqui é um pokémon de teste com stat que o jogo não sabe
// produzir. Uma cópia só, importada dos dois lados — como `shared/campeonato.mjs` e as outras.
//
// ### O que este arquivo garante
//
// `normalizarPokemonTeste` é a peneira: todo campo vira número, é preso na faixa e volta como um
// objeto NOVO. O que não tiver espécie válida volta `null`. É ele que impede que um pacote
// forjado descreva um Magikarp com 40.000 de ataque: a espécie manda nas bases, e IV, qualidade,
// potência e nível são presos nas mesmas faixas que uma captura de verdade pode dar.
import {
  IV_POR_STAT, POTENCIA_MIN, POTENCIA_MAX, QUALIDADE_MIN, QUALIDADE_MAX,
} from './nota-pokemon.mjs';

/** Quantos pokémon cabem de cada lado. Os dois lados são independentes: 5 × 1 é uma luta válida. */
export const TREINO_MAX_LADO = 5;

/**
 * Espera entre uma batalha de treino e a próxima, por CONTA.
 *
 * Cinco minutos não é medo de custo — um duelo custa ~3 ms de CPU no pior caso e ~17 KB de
 * replay (medido em `tools/bancada-treino.mjs`). É a trava que impede a área virar uma bancada
 * de força bruta: sem ela, um script varreria combinações de equipe a dezenas por segundo,
 * gastando o processo que também roda as hunts de todo o shard.
 */
export const TREINO_COOLDOWN_MS = 5 * 60_000;

/**
 * Faixa de nível do pokémon de teste.
 *
 * O teto é generoso de propósito: acima de 150 a régua do ginásio (`nivelNoGinasio`) comprime o
 * nível, que é a mesma conta do PvP Ranqueado e do Campeonato. Um nível absurdo não vira um
 * stat absurdo — ele só deixa o jogador ver isso com os próprios olhos.
 */
export const TREINO_NIVEL_MIN = 1;
export const TREINO_NIVEL_MAX = 9999;

/** Os seis stats, na ordem em que a tela os mostra. */
export const STATS_IV = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];

const inteiro = (v, min, max, padrao) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return padrao;
  return Math.max(min, Math.min(max, n));
};

/** O pokémon de teste que o formulário abre: nível 100, nascimento mediano. */
export const pokemonTestePadrao = (speciesId = 1) => ({
  speciesId: inteiro(speciesId, 1, 100_000, 1),
  level: 100,
  shiny: false,
  potencia: POTENCIA_MIN,
  qualidade: 1,
  ivs: Object.fromEntries(STATS_IV.map((k) => [k, 16])),
});

/**
 * A peneira do pokémon de teste. Devolve um objeto NOVO, com tudo preso na faixa válida, ou
 * `null` quando não dá para dizer de que espécie ele é.
 *
 * Não confere se a espécie EXISTE — isso é do servidor, que tem o catálogo (`especies`) e é
 * quem decide; aqui é só forma e faixa, para o mesmo código valer no navegador.
 */
export function normalizarPokemonTeste(bruto) {
  const speciesId = Math.round(Number(bruto?.speciesId));
  if (!Number.isFinite(speciesId) || speciesId <= 0) return null;
  const q = Number(bruto?.qualidade);
  const ivsBrutos = bruto?.ivs ?? {};
  return {
    speciesId,
    level: inteiro(bruto?.level, TREINO_NIVEL_MIN, TREINO_NIVEL_MAX, 100),
    shiny: !!bruto?.shiny,
    potencia: inteiro(bruto?.potencia, POTENCIA_MIN, POTENCIA_MAX, POTENCIA_MIN),
    // A qualidade é o único campo fracionário; três casas é o que a tela mostra.
    qualidade: Number.isFinite(q)
      ? Math.round(Math.max(QUALIDADE_MIN, Math.min(QUALIDADE_MAX, q)) * 1000) / 1000
      : 1,
    ivs: Object.fromEntries(
      STATS_IV.map((k) => [k, inteiro(ivsBrutos[k], IV_POR_STAT.min, IV_POR_STAT.max, IV_POR_STAT.min)]),
    ),
  };
}

/**
 * Um lado da bancada, como a tela manda: até cinco casas, cada uma `{ meu: id }` ou
 * `{ teste: {...} }`. Casa vazia (ou torta) simplesmente não entra.
 *
 * O corte em `TREINO_MAX_LADO` acontece ANTES de qualquer trabalho: um pacote com mil casas é
 * cortado em cinco, não recusado — recusar daria ao atacante uma mensagem para calibrar, e
 * cortar dá a ele exatamente o que um jogador teria.
 */
export function normalizarLado(bruto) {
  if (!Array.isArray(bruto)) return [];
  const saida = [];
  for (const casa of bruto.slice(0, TREINO_MAX_LADO)) {
    const meu = Math.round(Number(casa?.meu));
    if (Number.isFinite(meu) && meu > 0) {
      saida.push({ meu });
      continue;
    }
    const teste = normalizarPokemonTeste(casa?.teste);
    if (teste) saida.push({ teste });
  }
  return saida;
}
