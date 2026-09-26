// Perda de XP do treinador ao desmaiar — hunt, boss e PvP.
//
// A conta é sobre o XP acumulado DENTRO do nível atual, com piso na entrada do nível: assim
// a perda pesa igual em qualquer nível e nunca faz o treinador descer de nível.
import { xpTotalParaNivel } from '../content.mjs';

/** Fração do XP do nível atual cobrada em toda morte (selvagem, boss, PvP). */
export const XP_PERDIDO_MORTE = 0.1;

/**
 * @param {object} p jogador em memória
 * @param {(p: object) => number|null|undefined} [consumirBless] consome bênção e devolve a fração
 * @returns quanto de XP foi perdido
 */
export function aplicarPerdaDeXpTreinador(p, consumirBless) {
  const piso = xpTotalParaNivel(p.level);
  const dentroDoNivel = Math.max(0, p.xp - piso);
  const pct = consumirBless?.(p) ?? null;
  const perda = Math.floor(dentroDoNivel * (pct ?? XP_PERDIDO_MORTE));
  p.xp = Math.max(piso, p.xp - perda);
  return perda;
}
