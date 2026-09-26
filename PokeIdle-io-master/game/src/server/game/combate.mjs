// Regras de combate.
//
// ATENÇÃO à procedência: efetividade de tipo, amplificação da hunt (+50%), HP ×5 e dano ×1.8
// do selvagem, a curva de XP, as bandas de qualidade e os COOLDOWNS de cada golpe são os
// valores REAIS extraídos do jogo original. São nossos: a fórmula de dano (o servidor deles
// nunca expõe a dele, então adaptamos a clássica da série) e o ataque básico lá embaixo.
// Os dois estão isolados aqui de propósito: se um dia os reais aparecerem, troca-se só isto.
import {
  especies,
  efetividadeHunt,
  golpesDisponiveis,
  MULT_DANO_SELVAGEM,
} from '../content.mjs';
import { golpeTmElemental } from './tm.mjs';

const entre = (min, max) => min + Math.random() * (max - min);

/**
 * Bônus de cooldown pelo IV de Speed — fixo no nascimento, não sobe com nível.
 *
 * IV 1 → −0,01 s · IV 32 → −0,32 s · IV 26 → −0,26 s (linear: 10 ms por ponto de IV).
 * Vale no intervalo global entre ataques e no cooldown de cada golpe. Sp.ATK/Sp.DEF não entram.
 */
export const IV_SPEED_CD_MIN = 1;
export const IV_SPEED_CD_MAX = 32;
export const IV_SPEED_CD_MS_POR_PONTO = 10;
/** Piso depois do bônus — evita cadência absurda no global ou na Investida. */
export const SPD_CD_MIN_MS = 400;

export function ivSpeedDe(atacante) {
  const bruto = atacante?.ivs?.speed ?? atacante?.ivSpeed;
  if (bruto == null || !Number.isFinite(Number(bruto))) return IV_SPEED_CD_MIN;
  return Math.min(IV_SPEED_CD_MAX, Math.max(IV_SPEED_CD_MIN, Math.round(Number(bruto))));
}

export function reducaoCooldownPorIvSpeed(ivSpeed) {
  return ivSpeedDe({ ivs: { speed: ivSpeed } }) * IV_SPEED_CD_MS_POR_PONTO;
}

/** Cooldown em ms depois do bônus do IV de Speed (golpe ou intervalo global). */
export function cooldownComSpeed(cooldownMs, ivSpeed) {
  const base = Math.max(0, Number(cooldownMs) || 0);
  if (base <= 0) return base;
  return Math.max(SPD_CD_MIN_MS, base - reducaoCooldownPorIvSpeed(ivSpeed));
}

/**
 * Pontuação para a IA escolher golpe — espelha a fórmula de dano, mas eleva efetividade
 * (ef^1.5) para preferir super efetivo quando o stat físico/especial puxa pro TM errado.
 * Ex.: Gyarados com ATK alto usava Hurricane (×1) em vez de Cyclonic Tide (×2.5) no Charizard.
 */
function notaGolpe(g, { nivel, stats, tipos, tiposDefensor, defStats, ehSelvagem = false }) {
  const ef = efetividadeHunt(g.type, tiposDefensor[0], tiposDefensor[1]);
  if (ef === 0) return -1;
  const stab = tipos.includes(g.type) ? 1.5 : 1;
  const atk = g.category === 'SPECIAL' ? stats.spAtk : stats.atk;
  const def = defStats
    ? (g.category === 'SPECIAL' ? defStats.spDef : defStats.def)
    : atk;
  const base = ((2 * nivel) / 5 + 2) * g.power * (atk / Math.max(1, def)) / 50 + 2;
  const mult = ehSelvagem ? MULT_DANO_SELVAGEM : 1;
  return base * stab * ef ** 1.5 * mult;
}

/**
 * Dano de um golpe.
 * base = ((2·nível/5 + 2) · power · atk/def) / 50 + 2
 * final = base · STAB · efetividadeDaHunt · aleatório(0,85..1,00)
 */
export function calcularDano({ nivelAtacante, power, atk, def, tipoGolpe, tiposAtacante, tiposDefensor, ehSelvagem }) {
  const base = ((2 * nivelAtacante) / 5 + 2) * power * (atk / Math.max(1, def)) / 50 + 2;

  const stab = tiposAtacante.includes(tipoGolpe) ? 1.5 : 1;
  const ef = efetividadeHunt(tipoGolpe, tiposDefensor[0], tiposDefensor[1]);
  const variacao = entre(0.85, 1.0);
  const selvagem = ehSelvagem ? MULT_DANO_SELVAGEM : 1;

  return {
    dano: Math.max(ef === 0 ? 0 : 1, Math.floor(base * stab * ef * variacao * selvagem)),
    efetividade: ef,
    stab: stab > 1,
  };
}

/**
 * Ataque básico — o soco que sempre está disponível.
 *
 * Os cooldowns dos golpes são os REAIS do jogo, e desde a curva nova (`cooldown-golpes.mjs`)
 * eles saem do poder do golpe: um Caterpie nível 5 conhece dois, de 18,8s e 25,9s; um
 * Charmander conhece três, de 18,8s, 27,6s e 36,5s. Sem um ataque básico, o pokémon dava
 * dois ou três golpes e ficava MEIO MINUTO colado no selvagem sem fazer nada — que é
 * exatamente o "ficam grudados e não atacam". A curva esticou essas esperas, então o básico
 * passou a carregar uma fatia bem maior do dano do que carregava antes.
 *
 * Isto aqui é DESIGN NOSSO, no molde de OTPokemon/Tibia: o pokémon bate sem parar no alvo
 * (poucos danos, cadência curta) e os golpes de verdade entram por cima quando saem do
 * cooldown. Power 30 contra os 56–72 de um golpe, a cada 2s.
 */
const ATAQUE_BASICO = { name: 'Investida', power: 30, cooldownMs: 2000, category: 'PHYSICAL' };

/** O básico sai no tipo do próprio pokémon; se o alvo for imune a ele, tenta o segundo tipo. */
function basicoContra(tipos, tiposDefensor) {
  for (const tipo of tipos.length ? tipos : ['NORMAL']) {
    if (efetividadeHunt(tipo, tiposDefensor[0], tiposDefensor[1]) > 0) return { ...ATAQUE_BASICO, type: tipo };
  }
  return null; // imune ao básico dos dois tipos: só um golpe de verdade resolve
}

/**
 * Melhor golpe DISPONÍVEL agora: o de maior dano esperado entre os que já saíram do
 * cooldown, ou o ataque básico enquanto todos estão carregando.
 *
 * @param cds  objeto { [nomeDoGolpe]: timestampEmQuePodeUsarDeNovo }
 * @param defStats  stats do defensor — melhora a escolha físico vs especial
 * @param ehSelvagem  inclui ×1,8 na pontuação (selvagem de hunt)
 */
export function melhorGolpe(especie, nivel, stats, tiposDefensor, cds = {}, t = Date.now(), defStats = null, ehSelvagem = false) {
  const tipos = [especie.type1, especie.type2].filter(Boolean);
  let melhor = null;
  let melhorNota = -1;

  for (const g of golpesDisponiveis(especie, nivel)) {
    if ((cds[g.name] ?? 0) > t) continue;
    const nota = notaGolpe(g, { nivel, stats, tipos, tiposDefensor, defStats, ehSelvagem });
    if (nota > melhorNota) {
      melhorNota = nota;
      melhor = g;
    }
  }
  if (melhor) return melhor;

  if ((cds[ATAQUE_BASICO.name] ?? 0) > t) return null;
  return basicoContra(tipos, tiposDefensor);
}

/**
 * Melhor golpe do jogador — inclui o especial do TM elemental, se houver.
 */
export function melhorGolpeJogador(especie, pk, nivel, stats, tiposDefensor, cds = {}, t = Date.now(), defStats = null) {
  const tipos = [especie.type1, especie.type2].filter(Boolean);
  let melhor = null;
  let melhorNota = -1;

  const candidatos = [...golpesDisponiveis(especie, nivel)];
  if (pk?.tmElemental) candidatos.push(golpeTmElemental(pk.tmElemental));

  for (const g of candidatos) {
    if ((cds[g.name] ?? 0) > t) continue;
    const nota = notaGolpe(g, { nivel, stats, tipos, tiposDefensor, defStats, ehSelvagem: false });
    if (nota > melhorNota) {
      melhorNota = nota;
      melhor = g;
    }
  }
  if (melhor) return melhor;

  if ((cds[ATAQUE_BASICO.name] ?? 0) > t) return null;
  return basicoContra(tipos, tiposDefensor);
}

/** Nível de um selvagem: o da hunt, com variação, para o campo não ficar homogêneo. */
export const nivelSelvagem = (especie) => Math.max(1, (especie?.huntLevel ?? 5) + Math.floor(entre(-2, 3)));

/** Um selvagem sorteado a partir da lista de spawns da hunt (peso = nº de pontos de spawn). */
export function sortearSelvagem(hunt) {
  const total = hunt.especies.reduce((s, e) => s + e.pontos, 0);
  let r = Math.random() * total;
  let escolhido = hunt.especies[0];
  for (const e of hunt.especies) {
    if (r < e.pontos) {
      escolhido = e;
      break;
    }
    r -= e.pontos;
  }
  const especie = especies.get(escolhido.pokeId);
  return { especie, nivel: nivelSelvagem(especie) };
}

/** Rola o loot de um selvagem derrotado. `chance` é percentual × 1000. */
export function rolarLoot(especie, bonusPct = 0) {
  const drops = [];
  for (const l of especie.loot ?? []) {
    const pct = (l.chance / 1000) * (1 + bonusPct / 100);
    if (Math.random() * 100 < pct) {
      const qtd = l.minCount + Math.floor(Math.random() * (l.maxCount - l.minCount + 1));
      if (qtd > 0) drops.push({ nome: l.name, qtd });
    }
  }
  return drops;
}

/** Ouro direto ao derrotar um selvagem — o `experience` da espécie, não o `sellValue`. */
export function ouroPorDerrota(especie) {
  if (!especie) return 1;
  const exp = Number(especie.experience);
  return Math.max(1, Number.isFinite(exp) ? exp : 10);
}
