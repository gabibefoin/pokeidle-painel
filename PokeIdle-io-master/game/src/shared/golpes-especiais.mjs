/**
 * Golpes de assinatura (600 de dano) por tipo — o “ultimate” das últimas evoluções.
 *
 * A injeção roda no boot (`content.mjs`) e no catálogo do cliente (`app.js`), para não depender
 * de editar `public/data/creatures.json` na VPS. O script `tools/injetar-golpes-especiais.mjs`
 * só grava no JSON quando quiser persistir offline.
 */
import { isOutlandPokeId, isEspelhoFantasmaPokeId } from './outland.mjs';
import { COOLDOWN_600_MS } from './cooldown-golpes.mjs';

export const GOLPE_600_POR_TIPO = {
  GRASS: { name: 'Petal Bloom', power: 600, type: 'GRASS', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  WATER: { name: 'Cyclonic Tide', power: 600, type: 'WATER', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  FIRE: { name: 'Ignition Point', power: 600, type: 'FIRE', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  FLYING: { name: 'Massive Hurricane', power: 600, type: 'FLYING', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  BUG: { name: 'Hive Crush', power: 600, type: 'BUG', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  POISON: { name: 'Toxic Deluge', power: 600, type: 'POISON', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  ELECTRIC: { name: 'Static Overload', power: 600, type: 'ELECTRIC', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  GROUND: { name: 'Crossing Fissure', power: 600, type: 'GROUND', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  FIGHTING: { name: 'Meteor Fists', power: 600, type: 'FIGHTING', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  PSYCHIC: { name: 'Mental Singularity', power: 600, type: 'PSYCHIC', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  ROCK: { name: 'Crumbling Rain', power: 600, type: 'ROCK', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  GHOST: { name: 'Untold Nightmare', power: 600, type: 'GHOST', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  ICE: { name: 'Ice Time', power: 600, type: 'ICE', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  DARK: { name: 'Endless Hollow', power: 600, type: 'DARK', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  STEEL: { name: 'Alloy Breaker', power: 600, type: 'STEEL', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  DRAGON: { name: 'Eternal Dragon', power: 600, type: 'DRAGON', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  FAIRY: { name: 'Starlight Charm', power: 600, type: 'FAIRY', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  NORMAL: { name: 'Ultimate Force', power: 600, type: 'NORMAL', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
};

/**
 * Segundo golpe de 600 por tipo — nomes de "ultimate" reais do pokemondb.
 *
 * Pokémon de tipo DUPLO ganham um golpe de 600 por tipo (2 no total). Os de tipo ÚNICO
 * ficavam só com 1 e em desvantagem; este segundo golpe, do MESMO tipo e MESMO cooldown,
 * empata a conta.
 */
export const GOLPE_600_POR_TIPO_B = {
  NORMAL: { name: 'Giga Impact', power: 600, type: 'NORMAL', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  FIRE: { name: 'Blast Burn', power: 600, type: 'FIRE', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  WATER: { name: 'Hydro Cannon', power: 600, type: 'WATER', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  GRASS: { name: 'Frenzy Plant', power: 600, type: 'GRASS', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  ELECTRIC: { name: 'Bolt Strike', power: 600, type: 'ELECTRIC', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  ICE: { name: 'Glacial Lance', power: 600, type: 'ICE', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  FIGHTING: { name: 'Meteor Assault', power: 600, type: 'FIGHTING', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  POISON: { name: 'Gunk Shot', power: 600, type: 'POISON', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  GROUND: { name: 'Precipice Blades', power: 600, type: 'GROUND', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  FLYING: { name: 'Sky Attack', power: 600, type: 'FLYING', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  PSYCHIC: { name: 'Prismatic Laser', power: 600, type: 'PSYCHIC', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  BUG: { name: 'Megahorn', power: 600, type: 'BUG', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  ROCK: { name: 'Rock Wrecker', power: 600, type: 'ROCK', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  GHOST: { name: 'Astral Barrage', power: 600, type: 'GHOST', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  DRAGON: { name: 'Roar of Time', power: 600, type: 'DRAGON', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  DARK: { name: 'Wicked Blow', power: 600, type: 'DARK', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  STEEL: { name: 'Steel Beam', power: 600, type: 'STEEL', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  FAIRY: { name: 'Light of Ruin', power: 600, type: 'FAIRY', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
};

/**
 * Reserva do segundo golpe de 600, para quando a espécie JÁ tem um golpe comum com o nome do B
 * (Weezing/Muk/Arbok com Gunk Shot 120, Snorlax/Tauros com Giga Impact 150, Groudon com
 * Precipice Blades 120…). O cooldown é guardado pelo NOME (`cdGolpes[g.name]`), então os dois
 * não podem conviver — e sem esta tabela a espécie ficava com um 600 só.
 *
 * Nomes que nenhuma espécie do catálogo usa (conferido contra o `especies` do servidor).
 */
export const GOLPE_600_RESERVA = {
  NORMAL: { name: 'Blood Moon', power: 600, type: 'NORMAL', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  FIRE: { name: 'Mind Blown', power: 600, type: 'FIRE', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  WATER: { name: 'Steam Eruption', power: 600, type: 'WATER', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  GRASS: { name: 'Chloroblast', power: 600, type: 'GRASS', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  ELECTRIC: { name: 'Plasma Fists', power: 600, type: 'ELECTRIC', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  ICE: { name: 'Freeze Shock', power: 600, type: 'ICE', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  FIGHTING: { name: 'Combat Torque', power: 600, type: 'FIGHTING', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  POISON: { name: 'Noxious Torque', power: 600, type: 'POISON', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  GROUND: { name: "Land's Wrath", power: 600, type: 'GROUND', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  FLYING: { name: 'Bleakwind Storm', power: 600, type: 'FLYING', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  PSYCHIC: { name: 'Psycho Boost', power: 600, type: 'PSYCHIC', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  BUG: { name: 'Pollen Puff', power: 600, type: 'BUG', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  ROCK: { name: 'Diamond Storm', power: 600, type: 'ROCK', category: 'PHYSICAL', cooldownMs: COOLDOWN_600_MS },
  GHOST: { name: 'Moongeist Beam', power: 600, type: 'GHOST', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  DRAGON: { name: 'Dynamax Cannon', power: 600, type: 'DRAGON', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  DARK: { name: 'Fiery Wrath', power: 600, type: 'DARK', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  STEEL: { name: 'Make It Rain', power: 600, type: 'STEEL', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
  FAIRY: { name: 'Fleur Cannon', power: 600, type: 'FAIRY', category: 'SPECIAL', cooldownMs: COOLDOWN_600_MS },
};

export const TIPOS_ELEMENTO = Object.keys(GOLPE_600_POR_TIPO);

export function dexDe(id) {
  return id < 1000 ? id : id % 1000;
}

/** Última evolução da linha (não evolui mais). */
export function ehUltimaEvolucao(c) {
  return !c.evolvesToId;
}

/**
 * Últimas evoluções do dex nacional, Orre e Outland — fantasma do espelho (10xxx) não, e MEGA
 * também não.
 *
 * A mega fica de fora porque o moveset dela já nasce FECHADO: é o da espécie base, cópia
 * exata, mais o golpe de mega (ver `criarEspeciesMega` em `megas.mjs`). Deixar o injetor rodar
 * aqui quebraria isso de um jeito silencioso, porque ele deriva o golpe de 600 dos TIPOS — e
 * os tipos da mega mudam. Medido antes da trava: Mega Gyarados (WATER/DARK contra o
 * WATER/FLYING do Gyarados) ganhava um `Endless Hollow` de DARK na ficha que não existia no
 * catálogo; o mesmo acontecia com Mega Pinsir, Mega Ampharos e Mega Sceptile. A ficha e o
 * servidor mostravam golpes diferentes para o mesmo bicho.
 */
export function elegivelParaGolpeEspecial(c) {
  if (!ehUltimaEvolucao(c)) return false;
  if (isEspelhoFantasmaPokeId(c.pokeId)) return false;
  // `megaDeDex` é carimbado em toda espécie mega. Ler o campo, e não importar `isMegaPokeId`,
  // evita um ciclo: `megas.mjs` precisa das tabelas daqui.
  if (c.megaDeDex != null) return false;
  return true;
}

export function temGolpe600DoTipo(attacks, tipo) {
  return (attacks ?? []).some((a) => a.power >= 600 && a.type === tipo);
}

/** Tira golpes inválidos que o gerador antigo colocou (NEUTRAL, status com dano 10, etc.). */
export function limparGolpesQuebrados(attacks) {
  return (attacks ?? []).filter((a) => {
    if (!TIPOS_ELEMENTO.includes(a.type)) return false;
    if ((a.power ?? 0) <= 10) return false;
    return true;
  });
}

/**
 * Garante um golpe de 600 por tipo elementar da espécie (type1 e type2).
 * Devolve true se alterou o array de golpes.
 */
/** Golpe de 600 = a ponta da curva de cooldown (`COOLDOWN_600_MS`). Vale pra QUALQUER creature
 *  (inclusive não-finais com um 600 herdado do gerador antigo). Devolve true se mexeu. */
export function fixarCooldownGolpe600(creature) {
  let mexeu = false;
  for (const a of creature.attacks ?? []) {
    // `cdFixo` é o golpe que sai da curva DE PROPÓSITO — hoje só o da mega, que tem poder 600
    // e 30 s. Sem esta guarda, esta função o "consertaria" para os 60 s de todo golpe de 600 na
    // primeira vez que a ficha fosse montada, e a mega perderia metade do que ela entrega.
    if (a.cdFixo) continue;
    if ((a.power ?? 0) >= 600 && a.cooldownMs !== COOLDOWN_600_MS) { a.cooldownMs = COOLDOWN_600_MS; mexeu = true; }
  }
  return mexeu;
}

export function injetarGolpesEspeciais(creature) {
  fixarCooldownGolpe600(creature);
  if (!elegivelParaGolpeEspecial(creature)) return false;

  let attacks = limparGolpesQuebrados(creature.attacks);
  const antes = JSON.stringify(attacks);
  const tipos = [...new Set([creature.type1, creature.type2].filter((t) => t && TIPOS_ELEMENTO.includes(t)))];

  // Categoria do golpe de assinatura = o lado de ataque mais forte da espécie (Weavile/Flareon
  // batem fisicamente; Alakazam/Magmortar, especial). Ignora o template — mas não a planilha dos
  // iniciais, que escolhe a categoria golpe a golpe e marca com `categoriaFixa`.
  const catAssinatura = (creature.baseAtk ?? 0) >= (creature.baseSpAtk ?? 0) ? 'PHYSICAL' : 'SPECIAL';
  for (const a of attacks) {
    if (a.power < 600) continue;
    if (!a.categoriaFixa) a.category = catAssinatura;
    a.cooldownMs = COOLDOWN_600_MS;
  }

  for (const tipo of tipos) {
    const tmpl = GOLPE_600_POR_TIPO[tipo];
    if (!tmpl || temGolpe600DoTipo(attacks, tipo)) continue;
    attacks.push({ ...tmpl, category: catAssinatura, learnLevel: 1 });
  }

  // Tipo ÚNICO (só 1 golpe de 600 no fim): dá um segundo, do mesmo tipo, pra empatar com os
  // de tipo duplo. Mesmo cooldown. Se o nome do B já está em uso por um golpe comum, vai o da reserva.
  // Conta GOLPES, não tipos: quem já tem dois 600 do mesmo tipo (a planilha dos iniciais, ou a
  // própria espécie passando aqui pela segunda vez em `golpesDaFicha`) não pode ganhar um terceiro.
  const golpes600 = attacks.filter((a) => a.power >= 600 && TIPOS_ELEMENTO.includes(a.type));
  if (golpes600.length === 1) {
    const b = [GOLPE_600_POR_TIPO_B, GOLPE_600_RESERVA]
      .map((tabela) => tabela[golpes600[0].type])
      .find((g) => g && !attacks.some((a) => a.name === g.name));
    if (b) attacks.push({ ...b, category: catAssinatura, learnLevel: 1 });
  }

  if (JSON.stringify(attacks) === antes) return false;
  creature.attacks = attacks;
  return true;
}

/** Golpes para a ficha da espécie — aplica a injeção sem mutar o catálogo em memória. */
export function golpesDaFicha(especie) {
  if (!especie) return [];
  const clone = { ...especie, attacks: (especie.attacks ?? []).map((a) => ({ ...a })) };
  injetarGolpesEspeciais(clone);
  return clone.attacks ?? [];
}
