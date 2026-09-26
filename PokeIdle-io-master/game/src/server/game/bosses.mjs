// BOSSES: arenas de lendários — um par por degrau de nível, drop só de peça de TM.
//
// A galeria (`bossesCatalogo`) é gerada das mesmas fichas. Só entram lendários com sprite,
// na ordem dex por geração (Hoenn → Paldea). A vantagem progressiva é só a % de drop de TM.
//
// ### Penalidade de equipe (deduzida do original)
//
//     força   = Σ min(1, nível do pokémon / teamLevel)
//     déficit = 5 − força
//     mult    = 3 ^ déficit
import { especies, calcularStats, hpDeCombate, poder, itens } from '../content.mjs';
import { PIECE_AOE, PIECE_ELEMENTAL } from './tm.mjs';
import { dropsMegaDoPar } from './mega.mjs';
import {
  lendariosComSprite,
  nivelMinimoDoPar,
  chanceTmDoPar,
  DIST_COMBATE_LENDARIO,
  GOLPES_PADRAO_LENDARIO,
} from '../../shared/bosses-lendarios.mjs';
import { carregarPoolsBoss, escolherFonteBoss } from '../../shared/bosses-mapas.mjs';
import { carregarCatalogo } from '../../../../tools/nomeador/pokedex-catalog.mjs';

const POOLS_MAPA_BOSS = carregarPoolsBoss();

/** Quantos pokémon no nível do boss zeram a penalidade. */
export const BOSS_EQUIPE_IDEAL = 5;

/** Base da penalidade exponencial. */
export const BOSS_PENALIDADE_BASE = 3;

/**
 * Penalidade de dano do boss para uma equipe.
 *
 * @param time     os pokémon da equipe (só nível importa)
 * @param teamLevel  nível de referência do boss
 */
export function penalidadeDeEquipe(time, teamLevel) {
  const forca = time.reduce((s, k) => s + Math.min(1, k.level / teamLevel), 0);
  const deficit = Math.max(0, BOSS_EQUIPE_IDEAL - forca);
  return {
    membros: time.length,
    forca: +forca.toFixed(4),
    deficit: +deficit.toFixed(4),
    mult: +Math.pow(BOSS_PENALIDADE_BASE, deficit).toFixed(2),
  };
}

const slugPorDex = (() => {
  const map = new Map();
  for (const g of carregarCatalogo().geracoes) {
    for (const e of g.entradas) {
      if (!map.has(e.dex)) map.set(e.dex, e.slug);
    }
  }
  return map;
})();

export const BOSS_TOKEN_ID = 70000;

function construirBossesLendarios() {
  const lista = lendariosComSprite(especies);
  const bosses = {};
  for (let i = 0; i < lista.length; i++) {
    const { dex, gen, especie } = lista[i];
    const par = Math.floor(i / 2);
    const teamLevel = nivelMinimoDoPar(par);
    const chance = chanceTmDoPar(par);
    const aoE = i % 2 === 1;
    const itemId = aoE ? PIECE_AOE : PIECE_ELEMENTAL;
    const nomePeca = itens.get(itemId)?.name ?? (aoE ? 'AoE TM Disk Piece' : 'TM Disk Piece');
    const key = slugPorDex.get(dex) ?? `dex${dex}`;

    bosses[key] = {
      key,
      nome: especie.name,
      pokeId: especie.pokeId,
      looktype: especie.looktype,
      level: teamLevel,
      hpMult: 10,
      teamLevel,
      minNivelTreinador: teamLevel,
      quality: 1.7,
      ivTotal: 100,
      type1: especie.type1,
      type2: especie.type2 ?? null,
      mapaFonte: escolherFonteBoss(dex, especie.type1, POOLS_MAPA_BOSS),
      parTm: par,
      chanceTm: chance,
      neutro: true,
      categoria: `Lendário · ${gen}`,
      arena: `boss_${key}`,
      distCombate: DIST_COMBATE_LENDARIO,
      pontos: 1,
      entrada: { itemId: BOSS_TOKEN_ID, nome: 'Bronze Boss Token', qtd: 1 },
      golpes: GOLPES_PADRAO_LENDARIO,
      // A peça de TM que sempre existiu MAIS os dois fragmentos de Mega Stone. Todo boss
      // dropa os três: a peça de TM alterna elemental/AoE por par, mas a mega não alterna —
      // são 32 espécies e uma escolha no Professor Carvalho no fim, então o que o par muda é
      // só a CHANCE (ver `dropsMegaDoPar`), como já era com o TM.
      drops: [{ itemId, nome: nomePeca, chance }, ...dropsMegaDoPar(par)],
    };
  }
  return bosses;
}

/** Fichas jogáveis — lendários com sprite, em pares por degrau de nível. */
export const BOSSES = construirBossesLendarios();

/** Galeria do modal de bosses (substitui o bossCatalog.json antigo). */
export const bossesCatalogo = Object.values(BOSSES)
  .map((b) => ({
    key: b.key,
    name: b.nome,
    looktype: b.looktype,
    pokeId: b.pokeId,
    category: b.categoria,
    level: b.teamLevel,
    minNivelTreinador: b.minNivelTreinador,
    type1: b.type1,
    type2: b.type2,
    chanceTm: b.chanceTm,
    parTm: b.parTm,
    drops: b.drops.map((d) => d.nome),
    dropsDetalhe: b.drops.map((d) => ({
      itemId: d.itemId,
      nome: d.nome,
      chance: d.chance ?? null,
    })),
  }))
  .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

export const bossPorKey = (key) => BOSSES[key] ?? null;

/** Chance por selvagem derrotado na Outland (0,05% = 0,0005). Média ~2.000 kills por token. */
export const CHANCE_BOSS_TOKEN_SELVAGEM = 0.0005;

/**
 * Sorteia Bronze Boss Token — só em kills na Outland; `bonusPct` segue o Loot Boost.
 *
 * `mult` é o degrau da Outland (a escada mora em `shared/outland-tiers.mjs`). Entra
 * MULTIPLICANDO o Loot Boost, e não somando: o boost é um bônus percentual sobre a chance da
 * área, e a área da vez é a que o jogador escolheu no Mapa.
 */
export function rolarBossTokenSelvagem(bonusPct = 0, area = null, mult = 1) {
  if (area !== 'outland') return null;
  const chance = CHANCE_BOSS_TOKEN_SELVAGEM * (1 + bonusPct / 100) * mult;
  if (Math.random() >= chance) return null;
  return { itemId: BOSS_TOKEN_ID, nome: 'Bronze Boss Token', qtd: 1 };
}

/** IVs do boss: `ivTotal` repartido igualmente entre os seis stats. */
function ivsDoBoss(total) {
  const base = Math.floor(total / 6);
  const sobra = total - base * 6;
  const v = [base, base, base, base, base, base];
  for (let i = 0; i < sobra; i++) v[i]++;
  return { hp: v[0], atk: v[1], def: v[2], spAtk: v[3], spDef: v[4], speed: v[5] };
}

/**
 * Monta a ficha de combate do boss, no mesmo formato de um selvagem.
 *
 * O HP usa o `hpMult` do boss (×10) no lugar do ×5 de selvagem, e o `dano` que ele leva
 * NÃO passa pela tabela de tipos — `neutro` desliga a efetividade nos dois sentidos.
 */
export function montarBoss(boss) {
  const especie = especies.get(boss.pokeId);
  if (!especie) return null;

  const ivs = ivsDoBoss(boss.ivTotal);
  const stats = calcularStats(especie, ivs, boss.level, boss.quality);
  const maxHp = hpDeCombate(stats.hp * boss.hpMult);

  return {
    bossKey: boss.key,
    speciesId: especie.pokeId,
    nome: boss.nome,
    // o looktype é o do BOSS (sprite gigante), não o da espécie
    looktype: boss.looktype,
    tipos: boss.neutro ? [] : [especie.type1, especie.type2].filter(Boolean),
    neutro: !!boss.neutro,
    level: boss.level,
    stats,
    ivs,
    hp: maxHp,
    maxHp,
    shiny: false,
    poder: poder(stats),
    // XP à altura: é o `experience` da espécie escalado pelo nível do boss contra o de hunt.
    xp: Math.round((especie.experience ?? 10) * (boss.level / Math.max(1, especie.huntLevel ?? 1))),
    golpes: boss.golpes,
    cdGolpes: {},
    fixo: true, // não vagueia nem persegue: o boss espera na arena
  };
}

/** Sorteia a tabela de drops de um boss. */
export function rolarDropsDeBoss(boss) {
  const saida = [];
  for (const d of boss.drops ?? []) {
    if (d.chance != null) {
      if (Math.random() < d.chance) saida.push({ itemId: d.itemId, nome: d.nome, qtd: 1 });
      continue;
    }
    // `pesos` é [[quantidade, peso], …] — sempre cai, o que varia é quanto
    const total = d.pesos.reduce((s, [, p]) => s + p, 0);
    let r = Math.random() * total;
    for (const [qtd, peso] of d.pesos) {
      if (r < peso) {
        saida.push({ itemId: d.itemId, nome: d.nome, qtd });
        break;
      }
      r -= peso;
    }
  }
  return saida;
}
