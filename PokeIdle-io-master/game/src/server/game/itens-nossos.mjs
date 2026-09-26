/**
 * Os itens que são NOSSOS — não vêm do espelho de `public/data/items.json`.
 *
 * ### Por que aqui, e não editando o items.json
 *
 * Mesma razão da Beast Ball (ver o cabeçalho de `loja.mjs`) e do `creatures-novos.json`:
 * `public/data/` é espelho regenerável e está no `.gitignore`. Um item escrito lá funciona na
 * máquina de quem escreveu e some no primeiro `npm run fetch` — inclusive em produção, onde o
 * espelho é baixado do zero. Definidos em código, eles são mesclados no catálogo no boot
 * (`content.mjs`) e existem em qualquer máquina.
 *
 * ### A faixa 70000+
 *
 * O espelho vai de 1 a ~600. A Ficha PvP já tinha carimbado 70001 como "id nosso"; tudo aqui
 * segue na mesma faixa, com um bloco por família para os ids continuarem legíveis num log.
 *
 * ### Os ícones são arte NOSSA
 *
 * Caminho ABSOLUTO (`/img/itens/…`), servido junto do cliente em `src/client/img/`, pela
 * mesma razão: ícone posto no espelho evapora no fetch seguinte. `iconeArquivo`, no app.js,
 * distingue os dois casos pela barra inicial. Os PNGs vêm do pokesprite (`basement-key`,
 * `escape-rope`, `shiny-stone`, `full-heal` para a Golden Potion).
 *
 * ### As 35 Mega Stones NÃO dividem ícone
 *
 * Ao contrário das Shiny Stones de tipo (abaixo), cada Mega Stone tem o seu PNG. É o que o
 * pokesprite entrega e o que o jogo original faz: a Gengarite é roxa, a Charizardite laranja,
 * a Blastoisinite azul — o jogador reconhece a pedra pelo desenho antes de ler o nome, e são
 * 70 pedras na bolsa de quem coleciona. As Shiny levam a MESMA pedra com uma áurea dourada por
 * cima (`tools/gerar-icones-mega.py`), que é a única diferença que precisa existir.
 *
 * ### As 18 Shiny Stones dividem UM ícone
 *
 * É de propósito: o que separa uma Shiny Stone FIRE de uma PSYCHIC é o nome e o selo de tipo
 * que a tela pinta em cima, não um desenho por tipo. Dezoito variações da mesma pedra seriam
 * dezoito arquivos quase idênticos para dizer o que uma palavra já diz. (Os TM Disks
 * elementais seguiam a mesma regra e deixaram de seguir: o pokesprite tem um disco desenhado
 * por tipo, e na bolsa dezoito discos iguais só se distinguiam lendo — ver
 * `aplicarIconesTmElemental`, no app.js.)
 */

import { MEGAS, megaTemShiny } from '../../shared/megas.mjs';
import { RARIDADES_CASA } from '../../shared/casas.mjs';
import { RARIDADES_BICICLETA } from '../../shared/bicicletas.mjs';
import { XP_SHARE_HELD_ID } from '../../shared/xp-share-held.mjs';
import { LISTA_CAIXAS } from '../../shared/caixas-beta.mjs';

/**
 * Os 18 tipos, na ordem canônica.
 *
 * Mora AQUI, e não em `content.mjs`, por uma questão de ordem de inicialização: as Shiny
 * Stones precisam existir no catálogo já na primeira linha em que `itemsRaw` é montado, e
 * `TIPOS_POKEMON` só era declarado 500 linhas abaixo. `content.mjs` reexporta esta constante,
 * então continua havendo UMA lista no jogo inteiro.
 */
export const TIPOS_POKEMON = [
  'NORMAL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'ICE', 'FIGHTING', 'POISON', 'GROUND',
  'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY',
];

const ICONE_CHAVE = '/img/itens/fragmento-chave.png';
const ICONE_CORDA = '/img/itens/escape-rope.png';
const ICONE_SHINY_STONE = '/img/itens/shiny-stone.png';
const ICONE_XP_SHARE = '/img/itens/exp-share.png';
/** Fragmento de Mega Stone: a pedra do pokesprite em preto e branco (`tools/gerar-icones-mega.py`). */
const ICONE_FRAGMENTO_MEGA = '/img/itens/fragmento-mega.png';
/** Fragmento de Mega Shiny Stone: a mesma pedra em ciano, com a aurea dourada. */
const ICONE_FRAGMENTO_MEGA_SHINY = '/img/itens/fragmento-mega-shiny.png';
const ICONE_GOLDEN_POTION = '/img/itens/golden-potion.png';

/** Um PNG por raridade — a vitrine e a bolsa mostram a fachada certa. */
const ICONE_CASA = Object.fromEntries(
  RARIDADES_CASA.map((r) => [r.id, `/img/itens/casa-${r.id}.png`]),
);

/** Bicicletas: pokesprite `key-item/` — acro-bike, bicycle, bike--green, mach-bike, bike--yellow. */
const ICONE_BICICLETA = Object.fromEntries(
  RARIDADES_BICICLETA.map((r) => [r.id, `/img/itens/bicicleta-${r.id}.png`]),
);
/** Fragmento de Bicicleta: pokesprite `key-item/parcel`. */
const ICONE_FRAGMENTO_BICICLETA = '/img/itens/fragmento-bicicleta.png';

/** Escape Rope — sai da hunt para o Centro na hora, sem os 3 s (ver `escapeRope` no sim). */
export const ESCAPE_ROPE_ID = 70010;

/** Fragmento de Chave — 10 deles fabricam uma Casa. Sem teto por conta (contador só para estatística). */
export const FRAGMENTO_CHAVE_ID = 70011;

/** Fragmento de Shiny Stone — 10 viram uma Shiny Stone do tipo escolhido. */
export const FRAGMENTO_SHINY_ID = 70012;

/** Fragmento de Bicicleta — 10 fabricam uma Bicicleta. Cai só na Outland, sem teto. */
export const FRAGMENTO_BICICLETA_ID = 70013;

/** Fragmento de Mega Stone - 10 viram a Mega Stone da especie escolhida. Cai em BOSS. */
export const FRAGMENTO_MEGA_ID = 70014;

/** Fragmento de Mega Shiny Stone - 10 viram a Shiny Mega Stone. Cai em BOSS, metade da chance. */
export const FRAGMENTO_MEGA_SHINY_ID = 70015;

/**
 * Primeiro id do bloco das 5 Bicicletas: `BICICLETA_BASE + índice da raridade` (70080…70084).
 * Os mesmos números aparecem em `shiny-catalogo-novos.json`, mas lá são LOOKTYPES — outro
 * espaço de numeração, que nunca passa por `itens`.
 */
const BICICLETA_BASE = 70080;

/** raridade ('comum'…'lendaria') → itemId da Bicicleta. */
export const BICICLETA_POR_RARIDADE = Object.fromEntries(
  RARIDADES_BICICLETA.map((r, i) => [r.id, BICICLETA_BASE + i]),
);

/** itemId → raridade. */
export const RARIDADE_POR_BICICLETA = new Map(
  Object.entries(BICICLETA_POR_RARIDADE).map(([r, id]) => [id, r]),
);

export const ehItemBicicleta = (id) => RARIDADE_POR_BICICLETA.has(Number(id));

/** Exp. Share (held) — repassa 5% do XP de batalha. */
export { XP_SHARE_HELD_ID } from '../../shared/xp-share-held.mjs';

/**
 * Golden Potion — a poção do topo do Market, e a única que cura por PORCENTAGEM.
 *
 * As cinco do espelho curam um NÚMERO fixo (`healAmount`: 60 … 3.000), e um número fixo
 * envelhece: os 3.000 da Ultimate são a vida inteira de um pokémon de nível 40 e um arranhão
 * num de nível 800. `healPct` não envelhece — 50% do HP máximo valem o mesmo em qualquer
 * nível, que é o que faz dela a compra sensata de quem passou do meio do jogo.
 */
export const GOLDEN_POTION_ID = 70070;

/** Fração do HP máximo que a Golden Potion devolve. */
export const GOLDEN_POTION_PCT = 0.5;

/** Primeiro id do bloco das 18 Shiny Stones: `SHINY_STONE_BASE + índice do tipo`. */
const SHINY_STONE_BASE = 70020;

/** Primeiro id do bloco das 5 Casas: `CASA_BASE + índice da raridade`. */
const CASA_BASE = 70040;

/**
 * As MEGA STONES: `71000 + dex` para a comum e `72000 + dex` para a Shiny.
 *
 * Pelo dex, e nunca por posição na lista: o itemId vive na BOLSA do jogador (`players.items`)
 * e no Mercado, e um id que se desloca troca a pedra que alguém comprou pela de outro bicho.
 * Uma mega nova com dex no meio da lista — o Abomasnow é o #460, cabe entre o Lucario (#448) e
 * o Gallade (#475) — deslocaria todo mundo depois dela num esquema por índice. Com o dex,
 * `71094` é a Gengarite hoje e daqui a dois anos.
 *
 * O maior dex com mega é o Gallade (#475), então a faixa usada é 71003…71475 e 72003…72475,
 * bem longe do bloco 70000…70084 do resto dos itens nossos.
 */
const MEGA_STONE_BASE = 71000;
const MEGA_SHINY_STONE_BASE = 72000;

/** dex da espécie → itemId da Mega Stone dela. */
export const MEGA_STONE_POR_DEX = Object.fromEntries(
  MEGAS.map((m) => [m.dex, MEGA_STONE_BASE + m.dex]),
);

/** dex da espécie → itemId da Shiny Mega Stone. Mega sem arte shiny fica de fora (ver `shared/megas.mjs`). */
export const MEGA_SHINY_STONE_POR_DEX = Object.fromEntries(
  MEGAS.filter(megaTemShiny).map((m) => [m.dex, MEGA_SHINY_STONE_BASE + m.dex]),
);

/** itemId → { dex, shiny } — o caminho de volta, para a mega saber qual pedra foi gasta. */
export const MEGA_POR_ITEM = new Map([
  ...Object.entries(MEGA_STONE_POR_DEX).map(([dex, id]) => [id, { dex: Number(dex), shiny: false }]),
  ...Object.entries(MEGA_SHINY_STONE_POR_DEX).map(([dex, id]) => [id, { dex: Number(dex), shiny: true }]),
]);

export const ehMegaStone = (id) => MEGA_POR_ITEM.has(Number(id));

/** tipo → itemId da Shiny Stone daquele tipo. */
export const SHINY_STONE_POR_TIPO = Object.fromEntries(
  TIPOS_POKEMON.map((t, i) => [t, SHINY_STONE_BASE + i]),
);

/** itemId → tipo. O caminho de volta, para a evolução saber que pedra foi gasta. */
export const TIPO_POR_SHINY_STONE = new Map(
  Object.entries(SHINY_STONE_POR_TIPO).map(([t, id]) => [id, t]),
);

/** raridade ('comum'…'lendaria') → itemId da Casa. */
export const CASA_POR_RARIDADE = Object.fromEntries(
  RARIDADES_CASA.map((r, i) => [r.id, CASA_BASE + i]),
);

/** itemId → raridade. */
export const RARIDADE_POR_CASA = new Map(
  Object.entries(CASA_POR_RARIDADE).map(([r, id]) => [id, r]),
);

export const ehItemCasa = (id) => RARIDADE_POR_CASA.has(Number(id));

/**
 * Nome de exibição em inglês, como todo o resto do catálogo.
 *
 * O jogo é multilíngue e o `items.json` do espelho é inteiro em inglês; um "Fragmento de
 * Chave" no meio de "Water Stone" e "Thunder Stone" quebraria a ordenação alfabética da
 * bolsa e do mercado. A tradução para as três línguas fica no i18n do cliente, que é onde
 * está a de todo o resto.
 */
function stoneDoTipo(tipo) {
  return `${tipo.charAt(0)}${tipo.slice(1).toLowerCase()} Shiny Stone`;
}

/**
 * O catálogo, no MESMO formato do `items.json` do espelho.
 *
 * `npcPrice: 0` em quase tudo. Nenhum destes se vende ao NPC: os três primeiros porque são
 * moeda de fabricação (vendê-los por ouro esvaziaria a progressão), e as casas porque o preço
 * delas é o que a comunidade paga no Mercado.
 *
 * A exceção é a Golden Potion, e ela não contradiz a regra: `npcPrice` na categoria `heal` é o
 * preço de COMPRA no Market (ver `COMPRAVEIS` no sim), e consumível que o NPC vende o NPC não
 * recompra — `itemVendavelAoNpc` recusa a categoria inteira, então não há moedinha infinita.
 *
 * `rare: true` acende a moldura de raro na bolsa e no card do mercado.
 */
export const ITENS_NOSSOS = [
  {
    id: ESCAPE_ROPE_ID,
    name: 'Escape Rope',
    icon: ICONE_CORDA,
    category: 'key-item',
    rare: false,
    npcPrice: 0,
  },
  {
    id: FRAGMENTO_CHAVE_ID,
    name: 'Key Fragment',
    icon: ICONE_CHAVE,
    category: 'key-item',
    rare: true,
    npcPrice: 0,
  },
  {
    id: FRAGMENTO_SHINY_ID,
    name: 'Shiny Stone Fragment',
    icon: ICONE_SHINY_STONE,
    category: 'key-item',
    rare: true,
    npcPrice: 0,
  },
  {
    id: FRAGMENTO_BICICLETA_ID,
    name: 'Bicycle Fragment',
    icon: ICONE_FRAGMENTO_BICICLETA,
    category: 'key-item',
    rare: true,
    npcPrice: 0,
  },
  {
    id: FRAGMENTO_MEGA_ID,
    name: 'Mega Stone Fragment',
    icon: ICONE_FRAGMENTO_MEGA,
    category: 'key-item',
    rare: true,
    npcPrice: 0,
  },
  {
    id: FRAGMENTO_MEGA_SHINY_ID,
    name: 'Mega Shiny Stone Fragment',
    icon: ICONE_FRAGMENTO_MEGA_SHINY,
    category: 'key-item',
    rare: true,
    npcPrice: 0,
  },
  {
    id: XP_SHARE_HELD_ID,
    name: 'Exp. Share',
    icon: ICONE_XP_SHARE,
    category: 'key-item',
    rare: true,
    npcPrice: 0,
  },
  {
    id: GOLDEN_POTION_ID,
    name: 'Golden Potion',
    icon: ICONE_GOLDEN_POTION,
    // `heal` de propósito: é uma poção, cai na aba Poções do Market e entra na fila da
    // auto-poção como as outras cinco. O que a distingue é o `healPct` no lugar do
    // `healAmount` — ver `usarPocao` no sim, que prefere a porcentagem quando ela existe.
    category: 'heal',
    rare: true,
    npcPrice: 2500,
    healPct: GOLDEN_POTION_PCT,
  },
  ...TIPOS_POKEMON.map((tipo) => ({
    id: SHINY_STONE_POR_TIPO[tipo],
    name: stoneDoTipo(tipo),
    icon: ICONE_SHINY_STONE,
    // `stone` de propósito: é uma pedra de evolução e cai na mesma aba do Mercado que as
    // outras vinte. O que a distingue é evoluir SHINY, e isso está no nome.
    category: 'stone',
    rare: true,
    npcPrice: 0,
  })),
  // As 35 MEGA STONES e as 35 Shiny. Diferente das Shiny Stones de tipo, cada uma tem o SEU
  // ícone: as pedras do pokesprite são desenhos distintos (a Gengarite é roxa, a Charizardite
  // laranja) e é assim que o jogador as reconhece no jogo original. A Shiny é a mesma pedra
  // com a áurea dourada por cima — ver `tools/gerar-icones-mega.py`.
  //
  // `category: 'stone'` nas duas: são pedras de evolução e caem na mesma aba do Mercado que as
  // outras cinquenta. O que as distingue é o nome e a áurea.
  ...MEGAS.map((m) => ({
    id: MEGA_STONE_POR_DEX[m.dex],
    name: m.pedra,
    icon: `/img/itens/mega/${m.icone}.png`,
    category: 'stone',
    rare: true,
    npcPrice: 0,
  })),
  ...MEGAS.filter(megaTemShiny).map((m) => ({
    id: MEGA_SHINY_STONE_POR_DEX[m.dex],
    name: `Shiny ${m.pedra}`,
    icon: `/img/itens/mega-shiny/${m.icone}.png`,
    category: 'stone',
    rare: true,
    npcPrice: 0,
  })),
  ...RARIDADES_CASA.map((r) => ({
    id: CASA_POR_RARIDADE[r.id],
    name: `${r.en} House`,
    icon: ICONE_CASA[r.id],
    category: 'casa',
    rare: true,
    npcPrice: 0,
  })),
  // As Bicicletas, pela mesma razão das casas: o preço delas é o que a comunidade paga.
  ...RARIDADES_BICICLETA.map((r) => ({
    id: BICICLETA_POR_RARIDADE[r.id],
    name: `${r.en} Bicycle`,
    icon: ICONE_BICICLETA[r.id],
    category: 'bicicleta',
    rare: true,
    npcPrice: 0,
  })),
  // As Caixas de Fundador. Estão no catálogo de itens para que a Bolsa e o Mercado saibam o
  // NOME e o ÍCONE delas — mas a unidade não mora em `players.items`: cada caixa é uma linha
  // com série própria em `caixas_beta` (ver `caixas-db.mjs`), porque a `#01` e a `#02` são
  // mercadorias diferentes e uma contagem apagaria o número.
  ...LISTA_CAIXAS.map((c) => ({
    id: c.itemId,
    name: c.nome,
    icon: `/img/itens/caixa-${c.tipo}.png`,
    category: 'caixa',
    rare: true,
    npcPrice: 0,
  })),
];

/**
 * Itens que o Mercado da Comunidade NÃO aceita, mesmo caindo numa categoria negociável.
 *
 * A Escape Rope entra aqui (comprada com diamante; revendê-la por ouro seria lavagem de
 * diamante em ouro). Os fragmentos e as pedras/casas prontas são negociáveis — ver
 * `ITENS_MERCADO` em `content.mjs`.
 */
export const ITENS_FORA_DO_MERCADO = new Set([ESCAPE_ROPE_ID]);

/** Fragmentos gastos por fabricação. Todos custam 10, como as peças do TM Researcher. */
export const CUSTO_FRAGMENTOS_CASA = 10;
export const CUSTO_FRAGMENTOS_SHINY_STONE = 10;
export const CUSTO_FRAGMENTOS_BICICLETA = 10;
export const CUSTO_FRAGMENTOS_MEGA = 10;
export const CUSTO_FRAGMENTOS_MEGA_SHINY = 10;
