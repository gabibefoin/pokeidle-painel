// XP e ouro por kill — padronizados pelo nível do mob, no jogo inteiro.
import { ouroDoNivel, xpDoNivel, ouroPorKillDoNivel } from './sell-value.mjs';

export { ouroDoNivel, xpDoNivel };

/**
 * O XP de um abate — UMA curva, pelo nível do mob. Mesmo nível, mesmo XP, qualquer espécie.
 *
 * Kanto, Johto e Outland pagavam o `especie.experience` do espelho, que é a lei
 * `⌊0,6·n²⌋ + 8` aplicada ao `huntLevel` DA ESPÉCIE, não ao nível em que ela nasce. Onde os dois
 * batem dava no mesmo; nas seis hunts em que não batem, a mesma faixa pagava coisas diferentes:
 * a Eevee nasce Nv 40 e pagava o XP do nível 20 (248, contra os 968 do Ivysaur Nv 40), e o
 * Houndoom nasce Nv 80 e pagava o do 100. Como `xpDoNivel` é a própria lei do espelho, o resto
 * de Kanto não muda um número.
 *
 * `hunt` e `especie` ficam na assinatura pelo mesmo motivo do `ouroPorDerrotaHunt` abaixo.
 */
export function xpPorDerrota(hunt, nivelMob, especie) {
  return xpDoNivel(nivelMob);
}

/**
 * O ouro de um abate — UMA curva, para o jogo inteiro, pelo nível do mob.
 *
 * A distinção de região saiu daqui de propósito. Ela existia porque Kanto pagava o
 * `especie.experience` do espelho e Hoenn+ pagava `ouroDoNivel`, e as duas emendavam num
 * degrau: a mesma faixa de nível valia coisas diferentes conforme a região. Agora as duas
 * pontas são a mesma lei de potência (ver `ouroPorKillDoNivel` em `sell-value.mjs`), então não
 * há mais o que distinguir. O XP ao lado seguiu o mesmo caminho.
 *
 * `hunt` e `especie` deixam de ser lidas e ficam na assinatura porque as chamadas passam as
 * três coisas.
 */
export function ouroPorDerrotaHunt(hunt, nivelMob, especie) {
  return ouroPorKillDoNivel(nivelMob);
}
