/**
 * POKÉIDLE HUB — MOTOR DE FÓRMULAS E MATEMÁTICA OFICIAL
 * Espelha 100% o código-fonte do servidor (sim.mjs, nota-pokemon.mjs, sell-value.mjs, recompensa-hunt.mjs, loja.mjs, guild.mjs)
 */

export const BASE_CAPTURA = 0.0075;
export const CAPTURA_RARIDADE_DIV = 17;
export const CAPTURA_PISO = 0.003;
export const CAPTURA_TETO = 0.10;

export const BALL_RATES = {
  poke: 1,
  great: 2,
  super: 3,
  ultra: 4,
  beast: 8
};

// ------------------------------------------------------------------ CAPTURA E SHINY
export function calcRaridade(priceNpc) {
  const p = Math.max(100, Number(priceNpc) || 100);
  return Math.log10(p) - 1;
}

export function calcFator(raridade) {
  return 1 + (Math.pow(raridade, 3) / CAPTURA_RARIDADE_DIV);
}

export function chanceCaptura(priceNpc, ballKey = 'poke', hasCaptureBoost = false) {
  const catchRate = BALL_RATES[ballKey] ?? 1;
  const raridade = calcRaridade(priceNpc);
  const fator = calcFator(raridade);
  const baseChance = BASE_CAPTURA * (catchRate / fator) * 1.4;
  const multBoost = hasCaptureBoost ? 2 : 1;
  return Math.min(CAPTURA_TETO, Math.max(CAPTURA_PISO, baseChance * multBoost));
}

export function abatesMediosCaptura(chanceFinal) {
  if (chanceFinal <= 0) return Infinity;
  return Math.round(1 / chanceFinal);
}

export function shinyOddsPerBall(hasShinyLure = false) {
  return hasShinyLure ? (1 / 12000) : (1 / 24000);
}

export function abatesMediosShiny(chanceFinal, hasShinyLure = false) {
  const pShiny = shinyOddsPerBall(hasShinyLure);
  const probJoint = pShiny * chanceFinal;
  if (probJoint <= 0) return Infinity;
  return Math.round(1 / probJoint);
}

// ------------------------------------------------------------------ XP, HUNT E TEMPO
/**
 * xpTotal(L) = round( 50/3 * (L^3 - 6L^2 + 17L - 12) ) para L > 1
 */
export function xpTotal(level) {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  if (L <= 1) return 0;
  return Math.round((50 / 3) * (Math.pow(L, 3) - 6 * Math.pow(L, 2) + 17 * L - 12));
}

/** Custo em XP para ir do nível L para L+1 */
export function xpCustoNivel(level) {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  return xpTotal(L + 1) - xpTotal(L);
}

export function deltaXp(lvlFrom, lvlTo) {
  const xpFrom = xpTotal(lvlFrom);
  const xpTo = xpTotal(lvlTo);
  return Math.max(0, xpTo - xpFrom);
}

/**
 * Curva oficial de XP base por abate: xpDoNivel (recompensa-hunt.mjs e sell-value.mjs)
 * Até 150: floor(0.6 * n^2) + 8
 * Acima de 150: round(13500 * (n / 150)^1.25)
 */
export function xpBaseDoNivel(huntLevel) {
  const n = Math.max(1, Math.floor(Number(huntLevel) || 1));
  if (n <= 150) {
    return Math.floor((6 * n * n) / 10) + 8;
  }
  return Math.round(13500 * Math.pow(n / 150, 1.25));
}

/**
 * Multiplicador de XP do jogo (loja.mjs e guild.mjs)
 * Boost e VIP se multiplicam; Guild soma % (1 + pct / 100)
 */
export function calcularMultiplicadorXp({ vip = false, xpBoost = false, guildBonusPct = 0, eventBonusPct = 0 }) {
  let mult = 1.0;
  if (vip) mult *= 1.5;
  if (xpBoost) mult *= 1.5;

  const pctGuild = Math.max(0, Math.min(10, Number(guildBonusPct) || 0));
  const multGuild = 1 + (pctGuild / 100);
  mult *= multGuild;

  const pctEvent = Math.max(0, Number(eventBonusPct) || 0);
  if (pctEvent > 0) mult *= (1 + pctEvent / 100);

  return {
    multTotal: mult,
    multGuild,
    pctGuild,
    pctEvent
  };
}

/** Formata segundos em tempo amigável */
export function formatarTempo(segundos) {
  if (!segundos || segundos <= 0 || !Number.isFinite(segundos)) return '0s';
  const totalSeg = Math.round(segundos);
  const dias = Math.floor(totalSeg / 86400);
  const horas = Math.floor((totalSeg % 86400) / 3600);
  const mins = Math.floor((totalSeg % 3600) / 60);
  const segs = totalSeg % 60;

  if (dias > 0) {
    return `${dias}d ${horas}h ${mins}min`;
  }
  if (horas > 0) {
    return `${horas}h ${mins}min ${segs}s`;
  }
  if (mins > 0) {
    return `${mins}min ${segs}s`;
  }
  return `${segs}s`;
}

/**
 * Calcula a evolução detalhada level a level
 */
export function calcularEvolucaoLevelALevel({ lvlFrom, lvlTo, huntLevel, multXp, killsPorHora = 980 }) {
  const start = Math.max(1, Math.min(lvlFrom, lvlTo));
  const end = Math.max(start + 1, Math.max(lvlFrom, lvlTo));

  const xpBasePorMob = xpBaseDoNivel(huntLevel);
  const xpEfetivoPorMob = Math.round(xpBasePorMob * multXp);
  const segundosPorMob = 3600 / killsPorHora;

  let tempoAcumuladoSegundos = 0;
  let xpAcumuladoTotal = 0;
  let killsAcumuladosTotal = 0;
  const steps = [];

  for (let lvl = start; lvl < end; lvl++) {
    const custoNivel = xpCustoNivel(lvl);
    const killsNivel = Math.ceil(custoNivel / xpEfetivoPorMob);
    const tempoNivelSegundos = killsNivel * segundosPorMob;

    tempoAcumuladoSegundos += tempoNivelSegundos;
    xpAcumuladoTotal += custoNivel;
    killsAcumuladosTotal += killsNivel;

    steps.push({
      nivelDe: lvl,
      nivelPara: lvl + 1,
      custoXp: custoNivel,
      kills: killsNivel,
      tempoNivelSegundos,
      tempoNivelFormatado: formatarTempo(tempoNivelSegundos),
      tempoAcumuladoSegundos,
      tempoAcumuladoFormatado: formatarTempo(tempoAcumuladoSegundos)
    });
  }

  return {
    xpBasePorMob,
    xpEfetivoPorMob,
    xpAcumuladoTotal,
    killsAcumuladosTotal,
    tempoTotalSegundos: tempoAcumuladoSegundos,
    tempoTotalFormatado: formatarTempo(tempoAcumuladoSegundos),
    steps
  };
}

// ------------------------------------------------------------------ REFINO (+1 A +N)
export function refinoCustoDegrau(n) {
  const N = Math.max(1, Math.floor(n));
  return 500 * (3 * Math.pow(N, 2) - 3 * N + 1);
}

export function refinoCustoTotal(n) {
  const N = Math.max(0, Math.floor(n));
  return 500 * Math.pow(N, 3);
}

export function refinoCustoEntre(de, para) {
  const cDe = refinoCustoTotal(de);
  const cPara = refinoCustoTotal(para);
  return Math.max(0, cPara - cDe);
}

// ------------------------------------------------------------------ OFERENDA (ROULETTE)
export function simularOferenda(pokemons) {
  if (!pokemons || pokemons.length === 0) {
    return { pedras: [], fatias: [{ nome: 'Vazio', pct: 100, cor: '#475569' }] };
  }

  const casas = 5;
  const count = Math.min(casas, pokemons.length);
  const pctPorPoke = 100 / casas;

  const distribuicao = new Map();

  for (const p of pokemons.slice(0, 5)) {
    const isShiny = !!p.shiny;
    const tipos = [];
    if (p.type1) tipos.push(p.type1);
    if (p.type2 && p.type2 !== p.type1) tipos.push(p.type2);
    if (tipos.length === 0) tipos.push('NORMAL');

    const pctPorTipo = pctPorPoke / tipos.length;
    for (const t of tipos) {
      const key = (isShiny ? 'Shiny Stone ' : 'Stone ') + t;
      distribuicao.set(key, (distribuicao.get(key) || 0) + pctPorTipo);
    }
  }

  const fatias = [];
  for (const [nome, pct] of distribuicao.entries()) {
    fatias.push({ nome, pct: +pct.toFixed(1) });
  }

  const casasVazias = casas - count;
  if (casasVazias > 0) {
    fatias.push({ nome: 'Nada (Slot Vazio)', pct: +(casasVazias * 20).toFixed(1) });
  }

  return { fatias };
}

// ------------------------------------------------------------------ NOTA POKÉMON (N= 0 A 10)
export const BONUS_POTENCIA = [0, 0.05, 0.10, 0.25, 1.00];
export const multPotencia = (p) => 1 + (BONUS_POTENCIA[Math.min(5, Math.max(1, p)) - 1] ?? 0);
export const multDeNascenca = (p, shiny) => multPotencia(p) * (shiny ? 3 : 1);

const STAT_KEYS = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
const EXPO_QUALIDADE = { hp: 0.95, atk: 0.8, def: 0.8, spAtk: 0.8, spDef: 0.8, speed: 0.95 };
const REF_BASE = { hp: 80, atk: 80, def: 80, spAtk: 80, spDef: 80, speed: 80 };

export function somaStatsNascimento({ ivs, qualidade = 1.0, potencia = 1, shiny = false, bases = REF_BASE }) {
  const mult = multDeNascenca(potencia, shiny);
  const q = Math.min(1.8, Math.max(0.8, Number(qualidade) || 1.0));
  let soma = 0;
  for (const k of STAT_KEYS) {
    const iv = Number(ivs?.[k] ?? 16);
    const b = Number(bases?.[k] ?? 80);
    soma += Math.round((b + 2 * iv) * Math.pow(q, EXPO_QUALIDADE[k]) * mult);
  }
  return soma;
}

export function limitesScoreEspecie(bases = REF_BASE) {
  const ivMin = { hp: 1, atk: 1, def: 1, spAtk: 1, spDef: 1, speed: 1 };
  const ivMax = { hp: 32, atk: 32, def: 32, spAtk: 32, spDef: 32, speed: 32 };
  const min = somaStatsNascimento({ ivs: ivMin, qualidade: 0.8, potencia: 1, shiny: false, bases });
  const max = somaStatsNascimento({ ivs: ivMax, qualidade: 1.8, potencia: 5, shiny: true, bases });
  return { min, max };
}

export function calcularNotaPokemon({ ivs, qualidade = 1.0, potencia = 1, shiny = false, bases = REF_BASE }) {
  const soma = somaStatsNascimento({ ivs, qualidade, potencia, shiny, bases });
  const limites = limitesScoreEspecie(bases);
  
  if (limites.max <= limites.min) return { nota: 0, soma, faixa: 'Fraco' };
  
  const lo = Math.log(limites.min);
  const hi = Math.log(limites.max);
  const s = Math.max(1, soma);
  const bruta = 10 * (Math.log(s) - lo) / (hi - lo);
  const nota = +(Math.min(10, Math.max(0, bruta))).toFixed(3);

  let faixa = 'Fraco';
  if (nota >= 9.0) faixa = 'Divino';
  else if (nota >= 8.0) faixa = 'Lendário';
  else if (nota >= 7.0) faixa = 'Mítico';
  else if (nota >= 6.0) faixa = 'Poderoso';
  else if (nota >= 5.0) faixa = 'Forte';
  else if (nota >= 4.0) faixa = 'Bom';
  else if (nota >= 3.0) faixa = 'Razoável';
  else if (nota >= 2.0) faixa = 'Mediano';

  return { nota, soma, faixa, limites };
}
