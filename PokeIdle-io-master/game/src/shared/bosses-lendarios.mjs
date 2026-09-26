/**
 * Bosses lendários — ordem por geração (Hoenn → Paldea), nível mínimo por par e chance de TM.
 *
 * Par 0: nv 300 · 0,5% TM · par 1: nv 650 · 1% · par 2+: 300 + 350×par³ · +0,5% por par.
 */
import { LENDARIO_DEX } from './spawns-filtro.mjs';
import { dexDe } from './escala-hunt-level.mjs';

export const GERACOES_LENDARIO = [
  { min: 252, max: 386, rotulo: 'Hoenn' },
  { min: 387, max: 493, rotulo: 'Sinnoh' },
  { min: 494, max: 649, rotulo: 'Unova' },
  { min: 650, max: 721, rotulo: 'Kalos' },
  { min: 722, max: 809, rotulo: 'Alola' },
  { min: 810, max: 905, rotulo: 'Galar' },
  { min: 906, max: 1025, rotulo: 'Paldea' },
];

/** Último dex com boss na galeria — para em Naganadel até Galar/Paldea terem sprite e arena. */
export const BOSS_DEX_MAX = 804;

/** Nível mínimo do treinador (e referência da equipe) para o par de bosses. */
export function nivelMinimoDoPar(par) {
  if (par <= 0) return 300;
  if (par === 1) return 650;
  return 300 + Math.round(350 * par ** 3);
}

/** Chance de dropar a peça de TM por vitória (0,5% · 1% · 1,5% …). */
export function chanceTmDoPar(par) {
  return 0.005 * (par + 1);
}

/**
 * O FRAGMENTO DE MEGA STONE segue exatamente a escada da peça de TM: 0,5% no primeiro par de
 * bosses (nv 300), 1% no segundo (nv 650), +0,5 ponto percentual por par daí em diante.
 *
 * Igual à do TM de propósito. O boss já é a porta do endgame e já tem uma escada que o jogador
 * conhece de cor — inventar uma segunda curva para a mega obrigaria a decorar duas tabelas
 * para a mesma pergunta ("vale a pena subir de boss?"). E o custo é o mesmo: 10 fragmentos.
 */
export const chanceFragmentoMegaDoPar = (par) => chanceTmDoPar(par);

/**
 * O FRAGMENTO DE MEGA SHINY STONE cai pela METADE: 0,25% · 0,50% · 0,75% …
 *
 * A metade é a régua do jogo para "a versão shiny disto": um shiny vale mais que o comum em
 * todo lugar, e a pedra que megaevolui um shiny tem de custar mais tempo que a que megaevolui
 * um comum. Metade da chance é o dobro do tempo, e o dobro é um número que o jogador consegue
 * estimar sem tabela.
 */
export const chanceFragmentoMegaShinyDoPar = (par) => chanceTmDoPar(par) / 2;

export const DIST_COMBATE_LENDARIO = 1;

export const GOLPES_PADRAO_LENDARIO = [
  { name: 'Legendary Strike', power: 280, cooldownMs: 10_000, category: 'SPECIAL' },
  { name: 'Legendary Burst', power: 400, cooldownMs: 15_000, category: 'SPECIAL' },
];

/** Lendários com sprite, na ordem dex por geração. */
export function lendariosComSprite(especies) {
  const porDex = new Map();
  for (const esp of especies.values()) {
    const dex = dexDe(esp.pokeId);
    if (!LENDARIO_DEX.has(dex)) continue;
    const hit = porDex.get(dex);
    if (!hit || (esp.looktype ?? 1) > (hit.looktype ?? 1)) porDex.set(dex, esp);
  }

  const saida = [];
  for (const gen of GERACOES_LENDARIO) {
    const dexList = [...LENDARIO_DEX].filter((d) => d >= gen.min && d <= gen.max).sort((a, b) => a - b);
    for (const dex of dexList) {
      if (dex > BOSS_DEX_MAX) continue;
      const esp = porDex.get(dex);
      if ((esp?.looktype ?? 1) > 1) saida.push({ dex, gen: gen.rotulo, especie: esp });
    }
  }
  return saida;
}
