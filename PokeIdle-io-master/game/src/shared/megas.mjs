/**
 * MEGA EVOLUÇÃO — as 35 formas, a pedra de cada uma, a arte e o lugar delas na Pokédex.
 *
 * ### As megas são ESPÉCIES, na faixa #3000
 *
 * O mesmo desenho das variantes de Outland (`#2001+`, ver `outland.mjs`): cada mega é uma
 * espécie de verdade no catálogo, com `pokeId = 3000 + dex nacional` — Mega Venusaur é o
 * **#3003**, Mega Gengar o **#3094**, Mega Gallade o **#3475**. Elas ganham a aba "Mega" na
 * Pokédex, do lado da aba "Outland", e entram na Coleção como qualquer outra espécie.
 *
 * `3000 + dex` e não uma contagem corrida (3001, 3002, …) porque o número precisa DIZER de
 * quem ele é. Com a soma, #3094 é Gengar para sempre; numa contagem, inserir a mega do
 * Abomasnow um dia empurraria metade da lista e mudaria o número de bichos que os jogadores já
 * têm. A maior mega é a do Greninja (#658), então a faixa usada vai até #3658 e não encosta nos
 * clones de Orre (`13xxx`).
 *
 * Por serem espécies de verdade, não há nada de "mega" para ensinar ao resto do servidor:
 * `especies.get(pk.speciesId)` devolve a mega já com as bases, os tipos e a arte certos, e
 * combate, PvP, ginásios, Mercado, ranking e nota funcionam sem uma linha a mais.
 *
 * ### As bases vêm da pokemondb, inteiras — não são um bônus
 *
 * `bases` SUBSTITUI as seis bases da espécie, com os números da aba "Mega Evolution" da ficha
 * de cada pokémon na pokemondb. Não é "+X%": Mega Alakazam tem 175 de Sp. Atk contra 135, e
 * Mega Aggron troca Sp. Atk por 230 de Defense. Um multiplicador único apagaria exatamente o
 * que diferencia uma mega da outra.
 *
 * O IV, a qualidade, a potência e o REFINO continuam valendo por cima — a mega troca o chão,
 * não o prédio. Quem refinou +40 em ATK continua com +40 depois de megaevoluir.
 *
 * ### Os tipos também mudam
 *
 * Mega Gyarados vira WATER/DARK, Mega Ampharos ganha DRAGON, Mega Charizard Y continua
 * FIRE/FLYING. Isso mexe em STAB, em efetividade e na pedra de refino — de propósito, é metade
 * da graça de megaevoluir.
 *
 * ### Quais entraram, e por que só 35
 *
 * Duas listas mandam: a arte em `Pokedex Backup/MEGAS` e a aba "Mega Evolution" na pokemondb.
 * A pedra do pokesprite NÃO manda — ele só tem as 47 de X/Y e ORAS, e as megas de Legends: Z-A
 * (Dragonite, Meganium, Greninja) não estão lá. A pedra das três é feita em
 * `tools/gerar-icones-mega.py`: as 47 são a mesma silhueta com paleta trocada, então uma a
 * mais no conjunto é só uma cor a mais. Os stats e os tipos continuam sendo os oficiais.
 *
 * (Esta regra nasceu errada: a primeira leva usou a lista de PEDRAS como filtro e cortou
 * Dragonite, Meganium e Greninja antes de consultar a pokemondb — os três têm aba lá. Os dois
 * primeiros voltaram na v1.148.0; o Greninja precisou esperar a arte BASE dele, porque o
 * Greninja do jogo era `looktype: 1` e ninguém conseguia ter um para megaevoluir.)
 *
 * Ficaram de fora:
 *
 *   · **Mewtwo, Latias, Latios, Salamence, Diancie, Abomasnow, Medicham, Altaria, Glalie,
 *     Slowbro, Sableye, Audino, Lopunny** — têm pedra no pokesprite, mas não têm arte aqui;
 *   · **Mega Charizard X** e as formas "Z" de Legends: Z-A — a arte da pasta é a Y (laranja,
 *     conferida pixel a pixel), e a X é outro sprite.
 *
 * As 35 têm arte comum E shiny. `semShiny: true` continua existindo na ficha para o dia em que
 * uma mega nova chegar só com a arte comum: ela fica sem Shiny Stone no catálogo e a bancada
 * do Professor não a oferece, em vez de vender uma pedra que não dá para usar. O Aggron foi
 * esse caso por um dia (22/09/2026) e deixou de ser quando a arte shiny dele entrou.
 *
 * ### Os looktypes
 *
 * `80000 + dex` para a mega comum e `85000 + dex` para a mega shiny, nas mesmas regras dos
 * `60000 + dex` / `70000 + dex` do Pokedex Backup (ver `tools/publicar-sprites-megas.mjs`).
 * As duas faixas estavam vazias no `outfits-index.json`, e 85000 evita de longe os 909xx que
 * os outfits de NPC e das Caixas de Fundador ocupam.
 */
import { dexDe } from './escala-hunt-level.mjs';
import { isOutlandPokeId } from './outland.mjs';
import { COOLDOWN_MEGA_MS } from './cooldown-golpes.mjs';

/** Primeiro pokeId da faixa das megas — `MEGA_POKE_BASE + dex nacional`. */
export const MEGA_POKE_BASE = 3000;

/** Teto exclusivo da faixa. Nada mora entre #3000 e #4000 além das megas. */
export const MEGA_POKE_MAX = 4000;

/** Looktype da arte da mega comum: `80000 + dex nacional`. */
export const MEGA_LOOKTYPE_BASE = 80000;

/** Looktype da arte da mega SHINY: `85000 + dex nacional`. */
export const MEGA_SHINY_LOOKTYPE_BASE = 85000;

export const looktypeMega = (dex) => MEGA_LOOKTYPE_BASE + Number(dex);
export const looktypeMegaShiny = (dex) => MEGA_SHINY_LOOKTYPE_BASE + Number(dex);

/** pokeId da mega de uma espécie: #3 (Venusaur) → #3003. */
export const megaPokeId = (dex) => MEGA_POKE_BASE + Number(dex);

export function isMegaPokeId(pokeId) {
  const id = Number(pokeId);
  return id > MEGA_POKE_BASE && id < MEGA_POKE_MAX;
}

/**
 * As 35 megas.
 *
 *   dex    o nacional da espécie base — a chave de tudo (`pokeId` da mega = 3000 + dex)
 *   slug   o nome do arquivo em `Pokedex Backup/MEGAS` (`mega_<slug>.png`)
 *   nome   o nome da espécie mega, como aparece na Pokédex
 *   pedra  o nome da Mega Stone, em inglês como o resto do catálogo
 *   icone  o PNG do pokesprite em `img/itens/mega/<icone>.png`
 *   tipos  os tipos DEPOIS da mega (substituem os da espécie)
 *   bases  as seis bases DEPOIS da mega (substituem as da espécie)
 */
export const MEGAS = [
  {
    dex: 3,
    slug: 'venusaur',
    nome: 'Mega Venusaur',
    pedra: 'Venusaurite',
    icone: 'venusaurite',
    tipos: ['GRASS', 'POISON'],
    bases: { hp: 80, atk: 100, def: 123, spAtk: 122, spDef: 120, speed: 80 },
  },
  {
    dex: 6,
    slug: 'charizard',
    nome: 'Mega Charizard Y',
    pedra: 'Charizardite Y',
    icone: 'charizardite-y',
    tipos: ['FIRE', 'FLYING'],
    bases: { hp: 78, atk: 104, def: 78, spAtk: 159, spDef: 115, speed: 100 },
  },
  {
    dex: 9,
    slug: 'blastoise',
    nome: 'Mega Blastoise',
    pedra: 'Blastoisinite',
    icone: 'blastoisinite',
    tipos: ['WATER'],
    bases: { hp: 79, atk: 103, def: 120, spAtk: 135, spDef: 115, speed: 78 },
  },
  {
    dex: 15,
    slug: 'beedrill',
    nome: 'Mega Beedrill',
    pedra: 'Beedrillite',
    icone: 'beedrillite',
    tipos: ['BUG', 'POISON'],
    bases: { hp: 65, atk: 150, def: 40, spAtk: 15, spDef: 80, speed: 145 },
  },
  {
    dex: 18,
    slug: 'pidgeot',
    nome: 'Mega Pidgeot',
    pedra: 'Pidgeotite',
    icone: 'pidgeotite',
    tipos: ['NORMAL', 'FLYING'],
    bases: { hp: 83, atk: 80, def: 80, spAtk: 135, spDef: 80, speed: 121 },
  },
  {
    dex: 65,
    slug: 'alakazam',
    nome: 'Mega Alakazam',
    pedra: 'Alakazite',
    icone: 'alakazite',
    tipos: ['PSYCHIC'],
    bases: { hp: 55, atk: 50, def: 65, spAtk: 175, spDef: 105, speed: 150 },
  },
  {
    dex: 94,
    slug: 'gengar',
    nome: 'Mega Gengar',
    pedra: 'Gengarite',
    icone: 'gengarite',
    tipos: ['GHOST', 'POISON'],
    bases: { hp: 60, atk: 65, def: 80, spAtk: 170, spDef: 95, speed: 130 },
  },
  {
    dex: 115,
    slug: 'kangaskhan',
    nome: 'Mega Kangaskhan',
    pedra: 'Kangaskhanite',
    icone: 'kangaskhanite',
    tipos: ['NORMAL'],
    bases: { hp: 105, atk: 125, def: 100, spAtk: 60, spDef: 100, speed: 100 },
  },
  {
    dex: 127,
    slug: 'pinsir',
    nome: 'Mega Pinsir',
    pedra: 'Pinsirite',
    icone: 'pinsirite',
    tipos: ['BUG', 'FLYING'],
    bases: { hp: 65, atk: 155, def: 120, spAtk: 65, spDef: 90, speed: 105 },
  },
  {
    dex: 130,
    slug: 'gyarados',
    nome: 'Mega Gyarados',
    pedra: 'Gyaradosite',
    icone: 'gyaradosite',
    tipos: ['WATER', 'DARK'],
    bases: { hp: 95, atk: 155, def: 109, spAtk: 70, spDef: 130, speed: 81 },
  },
  {
    dex: 142,
    slug: 'aerodactyl',
    nome: 'Mega Aerodactyl',
    pedra: 'Aerodactylite',
    icone: 'aerodactylite',
    tipos: ['ROCK', 'FLYING'],
    bases: { hp: 80, atk: 135, def: 85, spAtk: 70, spDef: 95, speed: 150 },
  },
  {
    dex: 149,
    slug: 'dragonite',
    nome: 'Mega Dragonite',
    pedra: 'Dragonitite',
    icone: 'dragonitite',
    tipos: ['DRAGON', 'FLYING'],
    bases: { hp: 91, atk: 124, def: 115, spAtk: 145, spDef: 125, speed: 100 },
  },
  {
    dex: 154,
    slug: 'meganium',
    nome: 'Mega Meganium',
    pedra: 'Meganiumite',
    icone: 'meganiumite',
    tipos: ['GRASS', 'FAIRY'],
    bases: { hp: 80, atk: 92, def: 115, spAtk: 143, spDef: 115, speed: 80 },
  },
  {
    dex: 181,
    slug: 'ampharos',
    nome: 'Mega Ampharos',
    pedra: 'Ampharosite',
    icone: 'ampharosite',
    tipos: ['ELECTRIC', 'DRAGON'],
    bases: { hp: 90, atk: 95, def: 105, spAtk: 165, spDef: 110, speed: 45 },
  },
  {
    dex: 208,
    slug: 'steelix',
    nome: 'Mega Steelix',
    pedra: 'Steelixite',
    icone: 'steelixite',
    tipos: ['STEEL', 'GROUND'],
    bases: { hp: 75, atk: 125, def: 230, spAtk: 55, spDef: 95, speed: 30 },
  },
  {
    dex: 212,
    slug: 'scizor',
    nome: 'Mega Scizor',
    pedra: 'Scizorite',
    icone: 'scizorite',
    tipos: ['BUG', 'STEEL'],
    bases: { hp: 70, atk: 150, def: 140, spAtk: 65, spDef: 100, speed: 75 },
  },
  {
    dex: 214,
    slug: 'heracross',
    nome: 'Mega Heracross',
    pedra: 'Heracronite',
    icone: 'heracronite',
    tipos: ['BUG', 'FIGHTING'],
    bases: { hp: 80, atk: 185, def: 115, spAtk: 40, spDef: 105, speed: 75 },
  },
  {
    dex: 229,
    slug: 'houndoom',
    nome: 'Mega Houndoom',
    pedra: 'Houndoominite',
    icone: 'houndoominite',
    tipos: ['DARK', 'FIRE'],
    bases: { hp: 75, atk: 90, def: 90, spAtk: 140, spDef: 90, speed: 115 },
  },
  {
    dex: 248,
    slug: 'tyranitar',
    nome: 'Mega Tyranitar',
    pedra: 'Tyranitarite',
    icone: 'tyranitarite',
    tipos: ['ROCK', 'DARK'],
    bases: { hp: 100, atk: 164, def: 150, spAtk: 95, spDef: 120, speed: 71 },
  },
  {
    dex: 254,
    slug: 'sceptile',
    nome: 'Mega Sceptile',
    pedra: 'Sceptilite',
    icone: 'sceptilite',
    tipos: ['GRASS', 'DRAGON'],
    bases: { hp: 70, atk: 110, def: 75, spAtk: 145, spDef: 85, speed: 145 },
  },
  {
    dex: 257,
    slug: 'blaziken',
    nome: 'Mega Blaziken',
    pedra: 'Blazikenite',
    icone: 'blazikenite',
    tipos: ['FIRE', 'FIGHTING'],
    bases: { hp: 80, atk: 160, def: 80, spAtk: 130, spDef: 80, speed: 100 },
  },
  {
    dex: 260,
    slug: 'swampert',
    nome: 'Mega Swampert',
    pedra: 'Swampertite',
    icone: 'swampertite',
    tipos: ['WATER', 'GROUND'],
    bases: { hp: 100, atk: 150, def: 110, spAtk: 95, spDef: 110, speed: 70 },
  },
  {
    dex: 282,
    slug: 'gardevoir',
    nome: 'Mega Gardevoir',
    pedra: 'Gardevoirite',
    icone: 'gardevoirite',
    tipos: ['PSYCHIC', 'FAIRY'],
    bases: { hp: 68, atk: 85, def: 65, spAtk: 165, spDef: 135, speed: 100 },
  },
  {
    dex: 303,
    slug: 'mawile',
    nome: 'Mega Mawile',
    pedra: 'Mawilite',
    icone: 'mawilite',
    tipos: ['STEEL', 'FAIRY'],
    bases: { hp: 50, atk: 105, def: 125, spAtk: 55, spDef: 95, speed: 50 },
  },
  {
    dex: 306,
    slug: 'aggron',
    nome: 'Mega Aggron',
    pedra: 'Aggronite',
    icone: 'aggronite',
    tipos: ['STEEL'],
    bases: { hp: 70, atk: 140, def: 230, spAtk: 60, spDef: 80, speed: 50 },
  },
  {
    dex: 310,
    slug: 'manectric',
    nome: 'Mega Manectric',
    pedra: 'Manectite',
    icone: 'manectite',
    tipos: ['ELECTRIC'],
    bases: { hp: 70, atk: 75, def: 80, spAtk: 135, spDef: 80, speed: 135 },
  },
  {
    dex: 319,
    slug: 'sharpedo',
    nome: 'Mega Sharpedo',
    pedra: 'Sharpedonite',
    icone: 'sharpedonite',
    tipos: ['WATER', 'DARK'],
    bases: { hp: 70, atk: 140, def: 70, spAtk: 110, spDef: 65, speed: 105 },
  },
  {
    dex: 323,
    slug: 'camerupt',
    nome: 'Mega Camerupt',
    pedra: 'Cameruptite',
    icone: 'cameruptite',
    tipos: ['FIRE', 'GROUND'],
    bases: { hp: 70, atk: 120, def: 100, spAtk: 145, spDef: 105, speed: 20 },
  },
  {
    dex: 354,
    slug: 'banette',
    nome: 'Mega Banette',
    pedra: 'Banettite',
    icone: 'banettite',
    tipos: ['GHOST'],
    bases: { hp: 64, atk: 165, def: 75, spAtk: 93, spDef: 83, speed: 75 },
  },
  {
    dex: 359,
    slug: 'absol',
    nome: 'Mega Absol',
    pedra: 'Absolite',
    icone: 'absolite',
    tipos: ['DARK'],
    bases: { hp: 65, atk: 150, def: 60, spAtk: 115, spDef: 60, speed: 115 },
  },
  {
    dex: 376,
    slug: 'metagross',
    nome: 'Mega Metagross',
    pedra: 'Metagrossite',
    icone: 'metagrossite',
    tipos: ['STEEL', 'PSYCHIC'],
    bases: { hp: 80, atk: 145, def: 150, spAtk: 105, spDef: 110, speed: 110 },
  },
  {
    dex: 445,
    slug: 'garchomp',
    nome: 'Mega Garchomp',
    pedra: 'Garchompite',
    icone: 'garchompite',
    tipos: ['DRAGON', 'GROUND'],
    bases: { hp: 108, atk: 170, def: 115, spAtk: 120, spDef: 95, speed: 92 },
  },
  {
    dex: 448,
    slug: 'lucario',
    nome: 'Mega Lucario',
    pedra: 'Lucarionite',
    icone: 'lucarionite',
    tipos: ['FIGHTING', 'STEEL'],
    bases: { hp: 70, atk: 145, def: 88, spAtk: 140, spDef: 70, speed: 112 },
  },
  {
    dex: 475,
    slug: 'gallade',
    nome: 'Mega Gallade',
    pedra: 'Galladite',
    icone: 'galladite',
    tipos: ['PSYCHIC', 'FIGHTING'],
    bases: { hp: 68, atk: 165, def: 95, spAtk: 65, spDef: 115, speed: 110 },
  },
  {
    dex: 658,
    slug: 'greninja',
    nome: 'Mega Greninja',
    pedra: 'Greninjite',
    icone: 'greninjite',
    tipos: ['WATER', 'DARK'],
    bases: { hp: 72, atk: 125, def: 77, spAtk: 133, spDef: 81, speed: 142 },
  },
];

/** dex nacional → a ficha da mega. */
export const MEGA_POR_DEX = new Map(MEGAS.map((m) => [m.dex, m]));

/** pokeId da mega (#3xxx) → a ficha dela. */
export const MEGA_POR_POKEID = new Map(MEGAS.map((m) => [megaPokeId(m.dex), m]));

/**
 * O dex nacional por trás de um `pokeId`, para efeito de mega.
 *
 * Aceita o clone de Orre (`13xxx`) porque ele É a mesma espécie com outra hunt — um Tyranitar
 * de Orre megaevolui com a mesma Tyranitarite. Recusa Outland (`#2001+`): lá as variantes já
 * são outra criatura, com base e tipos próprios, e a mega em cima disso seria um terceiro
 * conjunto de números sem arte que o represente. Recusa a própria mega: ela não megaevolui de
 * novo.
 */
export function dexDaMega(pokeId) {
  const id = Number(pokeId);
  if (!Number.isFinite(id) || isOutlandPokeId(id) || isMegaPokeId(id)) return null;
  const dex = dexDe(id);
  return MEGA_POR_DEX.has(dex) ? dex : null;
}

/** A ficha da mega em que esta espécie pode virar, ou `null` quando ela não tem mega. */
export function megaDaEspecie(pokeId) {
  const dex = dexDaMega(pokeId);
  return dex == null ? null : MEGA_POR_DEX.get(dex);
}

/** A ficha da mega a partir do pokeId DELA (#3094 → Mega Gengar). */
export const megaPorPokeId = (pokeId) => MEGA_POR_POKEID.get(Number(pokeId)) ?? null;

/** A espécie tem mega SHINY? (Aggron é a única que não tem — ver o cabeçalho.) */
export const megaTemShiny = (meta) => !!meta && !meta.semShiny;

/** Soma das seis bases da mega — tabelas, auditoria e testes. */
export const totalBasesMega = (m) =>
  m.bases.hp + m.bases.atk + m.bases.def + m.bases.spAtk + m.bases.spDef + m.bases.speed;

/**
 * O GOLPE DE MEGA — um por tipo, 600 de poder e 30 s de recarga.
 *
 * ### O que a mega ganha de golpe, e o que ela NÃO ganha
 *
 * O moveset da mega é o da espécie base, **cópia exata**, mais este. Nada sai, nada é
 * rederivado: um Mega Venusaur bate com os mesmos golpes do Venusaur. É a regra mais simples
 * possível, e a única que não surpreende quem passou a conta de dez fragmentos de boss.
 *
 * A trava que sustenta isso está em `elegivelParaGolpeEspecial` (`golpes-especiais.mjs`), que
 * recusa a mega: o injetor de golpes de 600 deriva do TIPO, e os tipos da mega mudam. Sem ela,
 * Mega Gyarados (WATER/DARK contra o WATER/FLYING do Gyarados) ganhava na ficha um golpe de
 * DARK que não existia no catálogo do servidor.
 *
 * ### Por que 30 s, e não os 60 s de todo golpe de 600
 *
 * Porque é isto que a mega entrega. Um terceiro golpe de 600 na mesma recarga dos outros dois
 * seria mais uma linha na ficha e quase nenhum dano a mais — o gargalo de um pokémon de
 * endgame é o cooldown, não a falta de opção. Na metade do tempo, ele dispara duas vezes por
 * ciclo dos outros: é ritmo, que é o que se sente numa luta idle.
 *
 * Ele sai da curva de `cooldown-golpes.mjs` de propósito, e por isso carrega `cdFixo: true` —
 * a marca que impede `fixarCooldownGolpe600` de "consertá-lo" de volta para 60 s na primeira
 * vez que a ficha for montada.
 *
 * ### O tipo é o PRIMÁRIO da mega
 *
 * O primário DELA, não o da base: Mega Gyarados é WATER/DARK, e o golpe sai WATER. É a mesma
 * régua da pedra de evolução e da Shiny Stone (ver `shiny-stone.mjs`), e ela garante STAB —
 * o golpe mais forte do bicho sempre bate no tipo em que ele é mais forte.
 *
 * ### Os nomes começam com "Mega "
 *
 * Não é enfeite: o cooldown é guardado pelo NOME do golpe (`cdGolpes[g.name]`), então um nome
 * repetido faria dois golpes dividirem o mesmo relógio. O prefixo garante que nenhum deles
 * colide com os 549 nomes do catálogo — as três exceções que já usam a palavra (Mega Drain,
 * Mega Kick, Mega Punch) estão fora desta lista, e o teste `teste-megas.mjs` confere.
 */
export const GOLPE_MEGA_POR_TIPO = {
  NORMAL: 'Mega Onslaught',
  FIRE: 'Mega Inferno',
  WATER: 'Mega Maelstrom',
  GRASS: 'Mega Bloom',
  ELECTRIC: 'Mega Thunderstorm',
  ICE: 'Mega Permafrost',
  FIGHTING: 'Mega Rampage',
  POISON: 'Mega Venom',
  GROUND: 'Mega Earthshock',
  FLYING: 'Mega Tempest',
  PSYCHIC: 'Mega Mindbreak',
  BUG: 'Mega Swarm',
  ROCK: 'Mega Landslide',
  GHOST: 'Mega Eclipse',
  DRAGON: 'Mega Cataclysm',
  DARK: 'Mega Abyss',
  STEEL: 'Mega Forge',
  FAIRY: 'Mega Radiance',
};

/**
 * O golpe de mega de uma ficha da tabela `MEGAS`, pronto para entrar na lista de golpes.
 *
 * A categoria segue a MESMA regra dos golpes de assinatura (`injetarGolpesEspeciais`): o lado
 * de ataque mais forte da mega. Mega Gengar tem 170 de Sp. Atk contra 65 de Atk e bate
 * especial; Mega Heracross tem 185 de Atk e bate físico. Escolher pelo lado fraco daria um
 * golpe de 600 que não acerta.
 */
export function golpeMegaDe(meta) {
  const tipo = meta?.tipos?.[0];
  const nome = GOLPE_MEGA_POR_TIPO[tipo];
  if (!nome) return null;
  return {
    name: nome,
    power: 600,
    type: tipo,
    category: (meta.bases.atk ?? 0) >= (meta.bases.spAtk ?? 0) ? 'PHYSICAL' : 'SPECIAL',
    cooldownMs: COOLDOWN_MEGA_MS,
    learnLevel: 1,
    // Ver o cabeçalho: sem esta marca o golpe volta para os 60 s de todo golpe de 600.
    cdFixo: true,
    // O que a tela usa para pintar o selo de "golpe da mega" na ficha.
    golpeMega: true,
  };
}

/**
 * Monta as 35 espécies mega a partir das espécies base já carregadas.
 *
 * Rodar DEPOIS dos golpes das planilhas e dos ajustes de evolução: o que a mega herda da base
 * (golpes, loot, nível de hunt, experiência) tem de ser o valor final, não o que o espelho
 * trouxe. Ver a chamada em `content.mjs`.
 *
 * Herda quase tudo e troca só o que a mega muda: nome, arte, tipos, as seis bases e o fim da
 * cadeia. `evolvesToId: 0` é a trava — megaevoluído não evolui mais; sem ela o Mega Scizor
 * continuaria oferecendo a evolução do Scizor e o jogador trocaria a mega por um bicho comum
 * gastando uma pedra, sem volta.
 *
 * O `huntLevel` e o `loot` vêm da base de propósito, embora mega nenhuma apareça numa hunt:
 * são eles que a Pokédex mostra na ficha ("onde aparece", "o que dropa"), e a resposta certa
 * para um Mega Gengar é a do Gengar.
 *
 * @param lista  todas as espécies do catálogo (base do espelho + nossas)
 * @returns as espécies mega, para serem concatenadas na lista
 */
export function criarEspeciesMega(lista) {
  const porId = new Map(lista.map((c) => [c.pokeId, c]));
  const saida = [];
  for (const m of MEGAS) {
    const base = porId.get(m.dex);
    if (!base) continue;
    saida.push({
      ...base,
      pokeId: megaPokeId(m.dex),
      name: m.nome,
      looktype: looktypeMega(m.dex),
      description: `a ${m.nome.toLowerCase()}`,
      type1: m.tipos[0],
      type2: m.tipos[1] ?? null,
      baseHp: m.bases.hp,
      baseAtk: m.bases.atk,
      baseDef: m.bases.def,
      baseSpAtk: m.bases.spAtk,
      baseSpDef: m.bases.spDef,
      baseSpeed: m.bases.speed,
      evolvesToId: 0,
      evolveLevel: 0,
      // `loot` e `attacks` viriam por REFERÊNCIA no espalhamento acima, e passagens do boot
      // ainda dão `push` neles (ver `aplicarDropsNossos`). Copiar aqui é o que impede a mega
      // de escrever na ficha do Gengar de verdade.
      loot: (base.loot ?? []).map((l) => ({ ...l })),
      // O moveset da base, CÓPIA EXATA, mais o golpe de mega — e nada mais. Ver o cabeçalho de
      // `GOLPE_MEGA_POR_TIPO` para por que ele não é rederivado dos tipos novos.
      attacks: [
        ...(base.attacks ?? []).map((a) => ({ ...a })),
        ...(golpeMegaDe(m) ? [golpeMegaDe(m)] : []),
      ],
      megaDeDex: m.dex,
    });
  }
  return saida;
}

/**
 * Os elos "base → mega" para o piso da linhagem da nota.
 *
 * Megaevoluir tem de SUBIR o N= pela mesma razão que evoluir (ver `linhagem-nota.mjs`): a
 * régua da nota é por espécie, e a mega levanta muito as bases — um nascimento com IV
 * relativamente alto cairia de nota ao virar mega. O elo não mora em `evolvesToId` de
 * propósito: se morasse, a mega apareceria como destino normal de evolução e uma pedra comum
 * de tipo a alcançaria.
 */
export function elosMegaDaNota(lista) {
  const existe = new Set(lista.map((c) => c.pokeId));
  const elos = [];
  for (const m of MEGAS) {
    const mega = megaPokeId(m.dex);
    if (!existe.has(m.dex) || !existe.has(mega)) continue;
    elos.push([m.dex, mega]);
  }
  return elos;
}
