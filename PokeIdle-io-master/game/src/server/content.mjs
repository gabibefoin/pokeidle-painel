// Carrega o conteúdo do jogo a partir do espelho em public/data (o mesmo que o sprite-lab usa).
// Tudo aqui é imutável e compartilhado entre todos os jogadores — carrega uma vez no boot.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';
import { BEAST_BALL, BEAST_VS_ULTRA } from './game/loja.mjs';
import { ouroDoNivel, xpDoNivel, normalizarSellValue } from '../shared/sell-value.mjs';
import { efetividade as efetividadeTipos } from '../shared/tipo-efetividade.mjs';
import { ehPedraEvolucao, itemMortoDoJogo, itemMortoPorNome, normalizarNpcPriceItem } from '../shared/venda-npc-item.mjs';
import { aplicarEconomiaDrop } from '../shared/economia-drop.mjs';
import { ajustarPrecoEspelho } from '../shared/preco-item-espelho.mjs';
import { fontePorTipo, NOMES_OMITIDOS } from '../shared/spawns-filtro.mjs';
import { herdarLooktypeOrre } from '../shared/herdar-looktype-orre.mjs';
import { herdarLooktypeOutland } from '../shared/herdar-looktype-outland.mjs';
import { herdarBaseOutland } from '../shared/herdar-base-outland.mjs';
import { herdarGolpesOrre } from '../shared/herdar-golpes-orre.mjs';
import { dexSpriteBaseOutland } from '../shared/outland-sprite-dex.mjs';
import { aplicarEscalaHuntLevel, dexDe } from '../shared/escala-hunt-level.mjs';
import { pisoReducaoNivel } from '../shared/reduzir-nivel.mjs';
import { IDS_ITEM_DUPLICADO, resolverNomeItem, ALIAS_NOME_ITEM } from '../shared/alias-item.mjs';
import { tituloInglesItem } from '../shared/titulo-item.mjs';
import { injetarGolpesEspeciais } from '../shared/golpes-especiais.mjs';
import {
  aplicarCadeiasTruncadas,
  aplicarEvolucoesEntreGeracoes,
  normalizarEvolveLevel600,
  corrigirNiveisDeEvolucao,
} from '../shared/evolucoes-cruzadas.mjs';
import { aplicarAjustesHuntLevel } from '../shared/ajustes-especie-espelho.mjs';
import { aplicarGolpesDasPlanilhas } from '../shared/golpes-planilhas.mjs';
import { alinharNivelPadraoRamificado, tipoDaPedraDeEvolucao } from '../shared/evolucoes-ramificadas.mjs';
import {
  pedrasRefinoResolvidas,
  nomesPedraRefino,
} from '../shared/refino-pedras.mjs';
import { aplicarTetoDeCaptura, nivelDeCaptura, TETO_CAPTURA_MAX } from '../shared/teto-captura.mjs';
import { assentarValorDasEspecies } from '../shared/valor-cadeia.mjs';
import { basesComRefino } from '../shared/refino-stats.mjs';
import { aplicarDropsNossos } from '../shared/drops-nossos.mjs';
import { PEDRA_POR_TIPO } from '../shared/pedras-evolucao.mjs';
import { anotarLinhagemDaNota } from '../shared/linhagem-nota.mjs';
import {
  criarEspeciesMega,
  elosMegaDaNota,
  isMegaPokeId,
  looktypeMegaShiny,
  megaPokeId,
  megaTemShiny,
  MEGAS,
} from '../shared/megas.mjs';
import { isOutlandPokeId, isEspelhoFantasmaPokeId, montarOutlandDex, montarOutlandDexLegado48, aplicarRemapOutlandLista, remapOutlandPokeId, OUTLAND_DEX_BASE } from '../shared/outland.mjs';
import { ehNomeVarianteOutland } from '../shared/outland-sprite-dex.mjs';
import { setOutlandDexMap, setOutlandDexLegado48 } from '../shared/pokedex.mjs';
import {
  ITENS_NOSSOS,
  ITENS_FORA_DO_MERCADO,
  FRAGMENTO_CHAVE_ID,
  FRAGMENTO_SHINY_ID,
  FRAGMENTO_BICICLETA_ID,
  FRAGMENTO_MEGA_ID,
  FRAGMENTO_MEGA_SHINY_ID,
  SHINY_STONE_POR_TIPO,
  TIPO_POR_SHINY_STONE,
  XP_SHARE_HELD_ID,
  ehItemCasa,
  ehItemBicicleta,
  ehMegaStone,
  TIPOS_POKEMON,
} from './game/itens-nossos.mjs';
import { ehItemCaixaBeta } from '../shared/caixas-beta.mjs';

const ler = (rel) => JSON.parse(readFileSync(join(config.assetsDir, rel), 'utf8'));
const lerLocal = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const lerOpcional = (rel) => {
  try {
    return ler(rel);
  } catch {
    return null;
  }
};
const lerLocalOpcional = (rel) => {
  try {
    return lerLocal(rel);
  } catch {
    return null;
  }
};

const creaturesBase = ler('creatures.json').creatures;
const creaturesNovos = (lerLocalOpcional('./dados/creatures-novos.json')?.creatures ?? [])
  .filter((c) => !NOMES_OMITIDOS.has(c.name));
const creaturesOutlandNovos = lerLocalOpcional('./dados/creatures-outland-novos.json')?.creatures ?? [];
const spritesLab = lerLocalOpcional('./dados/creatures-sprites-lab.json')?.patches ?? [];
/** Auditoria pokemondb das espécies base-only (só existem no espelho). Ver o arquivo. */
const auditOverrides = lerLocalOpcional('./dados/creatures-audit-overrides.json')?.overrides ?? [];
const creatures = [...creaturesBase, ...creaturesNovos, ...creaturesOutlandNovos].filter((c) => !isEspelhoFantasmaPokeId(c.pokeId));
aplicarRemapOutlandLista(creatures);
for (const p of spritesLab) {
  p.pokeId = remapOutlandPokeId(p.pokeId);
  const c = creatures.find((x) => x.pokeId === p.pokeId);
  if (c && p.looktype) c.looktype = p.looktype;
}
herdarLooktypeOrre(creatures);
herdarLooktypeOutland(creatures);
aplicarEscalaHuntLevel(creaturesNovos, undefined, creatures);
// Auditoria pokemondb das espécies base-only (patch por cima do espelho, mesmo motivo do
// AJUSTE_HUNT_LEVEL). Depois disso o Outland herda os stats/moves já corrigidos da dex-base.
for (const ov of auditOverrides) {
  const c = creatures.find((x) => x.pokeId === ov.pokeId);
  if (!c) continue;
  for (const k of ['baseHp', 'baseAtk', 'baseDef', 'baseSpAtk', 'baseSpDef', 'baseSpeed']) {
    if (typeof ov[k] === 'number') c[k] = ov[k];
  }
  if (Array.isArray(ov.attacks)) c.attacks = ov.attacks.map((a) => ({ ...a }));
}
// Os golpes das planilhas (iniciais, pseudo-lendários) — por cima dos overrides, antes do Outland.
aplicarGolpesDasPlanilhas((id) => creatures.filter((x) => x.pokeId === id));
herdarBaseOutland(creatures);
/**
 * O catálogo de itens: o espelho MAIS os nossos.
 *
 * A mescla acontece aqui, na primeira linha em que `itemsRaw` existe, e não numa passagem
 * depois — tudo o que vem abaixo (o tipo elemental de cada item, a curadoria do Mercado, o
 * mapa nome→item) varre esta lista, e um item que chegasse tarde ficaria de fora de todas
 * essas tabelas sem nenhum erro aparecer. Ver `game/itens-nossos.mjs`.
 */
const itemsRaw = [...ler('items.json').items, ...ITENS_NOSSOS]
  .filter((i) => !IDS_ITEM_DUPLICADO.has(i.id))
  .filter((i) => !itemMortoDoJogo(i))
  .map((i) => (i.name === i.name.toLowerCase() ? { ...i, name: tituloInglesItem(i.name) } : i))
  .map(normalizarNpcPriceItem)
  .map(ajustarPrecoEspelho);
const spawns = ler('index/spawns-index.json');
const formulas = ler('index/formulas.json');
const moves = ler('index/moves-index.json');
/** Quem dropa cada item — a fonte do tipo elemental dos itens (ver `TIPO_DO_ITEM`). */
const loot = lerOpcional('index/loot-index.json')?.porItem ?? {};

/**
 * Área andável por hunt, pré-extraída dos mapas de tiles (tools/build-walkgrids.mjs).
 * Sem isto não há onde andar, então a hunt não entra na lista de jogáveis.
 */
const walkgrids = lerOpcional('world/walkgrids.json');
export const grades = walkgrids?.hunts ?? {};

/**
 * A PRAÇA do Centro Pokémon: a área social, gerada como "área especial" pelo
 * `tools/build-walkgrids.mjs` a partir do mapa de Cerulean.
 *
 * Sem ela o jogo não tem para onde mandar quem perdeu o time, então isto é o teste de
 * existência que o sim faz antes de teleportar alguém — e o motivo do aviso no fim do arquivo.
 */
export const CENTRO_SLUG = 'centro';
export const centroPokemon = grades[CENTRO_SLUG]?.grid?.length ? { slug: CENTRO_SLUG } : null;

/**
 * A recompensa por abate acima do nível 150.
 *
 * O espelho segue uma lei limpa até ali: `experience ≈ 0,6 × huntLevel²`, medida em 224
 * espécies de Kanto (k = 0,605) e nas 47 de Outland (k = 0,600). Orre é a exceção, e por
 * acidente: as espécies de Hoenn entraram com o `experience` original delas — número de
 * pokémon de início de jogo — enquanto o `huntLevel` foi inflado para 470–550. Deu k = 0,007,
 * 86× abaixo da lei. Na prática um bicho de nível 550 rendia 2.168, MENOS que um de nível 80
 * em Kanto, que rende 3.848: a região de level alto era a pior da economia.
 *
 * Aplicar a lei pura consertaria (181.500 no 550), mas multiplicaria a economia por 84 de uma
 * vez. Então acima de 150 o expoente cai de 2 para 1,25, ancorado no último ponto bom da
 * curva (Outland, nível 150 = 13.500). Kanto e Outland não mudam um número sequer.
 *
 *   nível ≤ 150 : ⌊0,6 × nível²⌋ + 8            (o espelho, intacto)
 *   nível > 150 : 13.500 × (nível / 150)^1,25
 *
 * O ouro sobe mais devagar (expoente 0,6) porque inflaciona preço de mercado entre jogadores,
 * enquanto XP só acelera a progressão de quem caça.
 */
const NIVEL_ANCORA = 150;

/**
 * As hunts que o espelho não tem e nós criamos, todas em Sinnoh.
 *
 * Cada uma reaproveita a geografia de uma hunt FONTE de Kanto escolhida pelo tipo elemental:
 * um pokémon de fogo herda o mapa e o desenho de spawns do Charmander, um de água herda do
 * Squirtle. Nada de tile novo — `grades[slug].mapa` aponta para o mapa da fonte.
 */
const HUNTS_SINNOH = JSON.parse(
  readFileSync(new URL('./dados/hunts-sinnoh.json', import.meta.url), 'utf8'),
).hunts;

/** Variantes Outland novas (#2048+) — marcador no mapa Outland e tiles da hunt-fonte. */
const HUNTS_OUTLAND_NOVOS = JSON.parse(
  readFileSync(new URL('./dados/hunts-outland-novos.json', import.meta.url), 'utf8'),
).hunts;

/** Hunts Kanto ausentes no espelho (Eevee, Ditto…) — marcador na aba Kanto. */
const HUNTS_KANTO_NOVOS = JSON.parse(
  readFileSync(new URL('./dados/hunts-kanto-novos.json', import.meta.url), 'utf8'),
).hunts;

/** Hunts Johto ausentes no espelho — marcador na aba Johto (mapa compartilhado com Kanto). */
const HUNTS_JOHTO_NOVOS = JSON.parse(
  readFileSync(new URL('./dados/hunts-johto-novos.json', import.meta.url), 'utf8'),
).hunts;

/**
 * Hunts cujo JSON de tiles pesa demais no cliente (29/30 páginas do atlas no 1º load).
 * Herdam caixa, grade e spawns de outra hunt; `grades[slug].mapa` aponta pro .json leve.
 */
const MAPAS_HERDADOS = {
  aerodactyl: 'kabutops',
  gastly: 'haunter',
  hoppip: 'oddish',
  sunkern: 'oddish',
  ponyta: 'charmander',
  parasect: 'chikorita',
};

/** Hunts desenhadas no Sprite Lab (spawns.html) — entram quando têm fonte de tiles. */
const SPAWNS_EDITOR = lerLocalOpcional('./dados/spawns-editor.json');
const HUNTS_EDITOR = [];
for (const [regId, reg] of Object.entries(SPAWNS_EDITOR?.regioes ?? {})) {
  if (regId === 'galar' || regId === 'paldea') continue;
  for (const m of reg.marcadores ?? []) {
    const fonte = m.fonte || fontePorTipo(m.tipo);
    const regiaoMapa = regId === 'galar' || regId === 'paldea' ? 'alola' : regId;
    HUNTS_EDITOR.push({ ...m, fonte, regiao: regiaoMapa });
  }
}
/** Dex já marcado no Nomeador (spawns-editor) — hunts-sinnoh.json não sobrepõe. */
const DEX_NO_EDITOR = new Set(HUNTS_EDITOR.map((h) => h.pokeId));
const HUNTS_SINNOH_ATIVAS = HUNTS_SINNOH.filter((h) => !DEX_NO_EDITOR.has(h.pokeId));

const SHINY_NOVOS_DOC = lerLocalOpcional('./dados/shiny-catalogo-novos.json');
const SHINY_NOVOS = (SHINY_NOVOS_DOC?.entries ?? [])
  .filter((e) => !NOMES_OMITIDOS.has(e.name));
/** Catálogo gerado por `npm run publicar:backup` — lista fechada; ausência = sem shiny. */
const CATALOGO_SHINY_BACKUP = String(SHINY_NOVOS_DOC?._leia ?? '').includes('Pokedex Backup');

export const especies = new Map(creatures.map((c) => [c.pokeId, c]));
aplicarAjustesHuntLevel((id) => especies.get(id));
// Vigoroth → Slaking e Shelgon → Salamence: cadeias truncadas do espelho. Aqui, ANTES do
// `injetarGolpesEspeciais` lá embaixo — deixar de ser última evolução é o que tira deles o
// golpe de 600. A tabela mora em `shared/` porque a Pokédex do cliente precisa dela também.
aplicarCadeiasTruncadas([...especies.values()]);
// O `evolveLevel: 600` que o espelho escreveu por engano → 100 (ver `evolucoes-cruzadas.mjs`).
normalizarEvolveLevel600(especies.values());
/** Variantes Outland (#2001+) não evoluem — o espelho herdou cadeia nacional em Pupitar/Dragonair. */
for (const esp of especies.values()) {
  if (isOutlandPokeId(esp.pokeId)) {
    esp.evolvesToId = 0;
    esp.evolveLevel = 0;
  }
}
// Golpes 600 nas últimas evos Hoenn+ — injetados aqui (não no JSON do espelho) para o git push
// bastar; public/data/creatures.json na VPS não precisa de deploy-public-data só por isto.
for (const esp of especies.values()) injetarGolpesEspeciais(esp);
// Os clones de ORRE (#13xxx) copiam a lista de golpes do nacional — DEPOIS da injeção, e não
// junto do Outland lá em cima, porque a injeção olha para a cadeia de evolução de cada espécie
// e as duas não são a mesma: o Dusclops nacional evolui em Dusknoir e por isso NÃO ganha os
// golpes de 600, enquanto o clone de Orre não tem um Dusknoir de Orre para onde ir, passava por
// última evolução e ganhava dois golpes de 600 que a Pokédex do Dusclops não tem. Copiando por
// último, a lista do clone é a do nacional e ponto — que é a regra ("a Pokédex é rei").
herdarGolpesOrre([...especies.values()]);
// O degrau das hunts legadas (hunts-sinnoh.json) — só espécies que não estão no spawns-editor.
// Não sobrescreve `huntLevel` global: o nível de cada hunt fica em `hunt.nivel`.
for (const h of HUNTS_SINNOH_ATIVAS) {
  const esp = especies.get(h.pokeId);
  if (!esp || !h.nivel) continue;
  if ((esp.huntLevel ?? 0) <= NIVEL_ANCORA) {
    esp.huntLevel = h.nivel;
    esp.experience = xpDoNivel(h.nivel);
    esp.sellValue = ouroDoNivel(h.nivel);
    esp.priceNpc = esp.sellValue;
  }
}
// Sneasel → Weavile e os outros catorze elos entre gerações (`shared/evolucoes-cruzadas.mjs`).
// Roda DEPOIS do `evolveLevel === 600 → 100` (senão um 550 escrito aqui viraria 100) e depois
// do `injetarGolpesEspeciais` (senão o elo novo do Makuhita tiraria dele o golpe de 600 que ele
// já tem). O cliente aplica na mesma ordem em `carregarCatalogoEspecies`.
aplicarEvolucoesEntreGeracoes([...especies.values()]);
// E o nível do destino padrão das cadeias que abrem em mais de um (Eevee, Kirlia, Snorunt…),
// para `especie.evolveLevel` e a tela de escolha nunca contarem histórias diferentes.
alinharNivelPadraoRamificado(especies.values());
// E o nível de quem pedia um degrau de outra era (Electabuzz → Electivire no nv 100).
corrigirNiveisDeEvolucao(especies.values());
/**
 * O TETO DE CAPTURA — e, por tabela, o degrau de evolução de Outland+ na mesma escada.
 *
 * POR ÚLTIMO entre os ajustes de evolução, e isso não é preferência de arrumação: as quatro
 * chamadas acima escrevem `evolveLevel`, e qualquer uma delas rodando depois desta desfaria o
 * alinhamento em silêncio. O cliente repete a mesma ordem em `carregarCatalogoEspecies`.
 */
export const { estagios: ESTAGIOS_EVOLUTIVOS } = aplicarTetoDeCaptura(
  [...especies.values()],
  (id) => especies.get(id),
);
// A Sun Stone não cai de nenhuma hunt do espelho, e 34 evoluções dependem dela.
aplicarDropsNossos(especies.values());
/**
 * As 35 MEGAS (#3003…#3658) entram no catálogo aqui, e não lá em cima.
 *
 * Depois de TUDO o que mexe na espécie base: os golpes injetados, os golpes das planilhas, os
 * elos entre gerações, o teto de captura e os drops nossos. A mega herda golpes e loot da base
 * (ver `criarEspeciesMega`), e herdar de uma base ainda pela metade daria uma Mega Gengar com
 * uma Pokédex diferente da do Gengar.
 *
 * Antes de `anotarLinhagemDaNota` e de `normalizarSellValue`, que precisam vê-las.
 */
export const ESPECIES_MEGA = criarEspeciesMega([...especies.values()]);
for (const esp of ESPECIES_MEGA) especies.set(esp.pokeId, esp);
// `creatures` é a MESMA lista, e as passagens que vêm depois varrem ela e não o Map (a
// resolução de alias do loot, logo abaixo, é uma). Uma mega fora daqui ficaria com nomes de
// drop crus na ficha da Pokédex.
creatures.push(...ESPECIES_MEGA);
// O PISO DA LINHAGEM do N=, depois de todos os ajustes acima: metade dos elos que importam aqui
// (Magmar → Magmortar, Electabuzz → Electivire, Rhydon → Rhyperior) é escrita por
// `aplicarEvolucoesEntreGeracoes`, e rodar antes dela deixaria justamente essas cadeias sem piso.
// Os elos "espécie → mega" entram como degrau extra: megaevoluir também nunca derruba o N=.
anotarLinhagemDaNota(
  [...especies.values()],
  (id) => especies.get(id),
  elosMegaDaNota([...especies.values()]),
);
// Hoenn+ e priceNpc absurdo do espelho — regra em sell-value.mjs (normalizarSellValue).
for (const esp of especies.values()) normalizarSellValue(esp);
for (const c of creatures) {
  for (const l of c.loot ?? []) l.name = resolverNomeItem(l.name);
  if (c.loot?.length) c.loot = c.loot.filter((l) => !itemMortoPorNome(l.name));
}
export const itens = new Map(itemsRaw.map((i) => [i.id, i]));
export const itensPorNome = new Map(itemsRaw.map((i) => [i.name.toLowerCase(), i]));
for (const [slug] of ALIAS_NOME_ITEM) {
  const canon = resolverNomeItem(slug);
  const item = itensPorNome.get(canon.toLowerCase());
  if (item) itensPorNome.set(slug, item);
}
export const hunts = spawns.porHunt;

/** Marcador errado no espelho — alinhar às outras finais de starter (Charizard/Venusaur = 80). */
if (hunts.blastoise) hunts.blastoise.nivel = 80;

/** Troca geografia pesada pela de `fonteSlug`, mantendo marcador/nível/nome da hunt original. */
function herdarMapaHunt(slug, fonteSlug) {
  const hunt = hunts[slug];
  const huntFonte = hunts[fonteSlug];
  const gradeFonte = grades[fonteSlug];
  if (!hunt || !huntFonte || !gradeFonte?.pontos?.length) {
    console.warn(`[content] mapa herdado "${slug}" ← "${fonteSlug}": fonte inválida — pulando`);
    return;
  }
  const pokeId = hunt.pokemon?.[0]?.pokeId ?? hunt.spawns?.[0]?.pokeId;
  if (!pokeId) {
    console.warn(`[content] mapa herdado "${slug}": sem pokeId — pulando`);
    return;
  }
  const esp = especies.get(pokeId);
  hunts[slug] = {
    ...huntFonte,
    slug,
    nome: hunt.nome,
    area: hunt.area,
    pixel: hunt.pixel,
    range: hunt.range,
    nivel: hunt.nivel,
    looktype: esp?.looktype ?? hunt.looktype,
    catchChance: hunt.catchChance ?? huntFonte.catchChance,
    npcs: hunt.npcs ?? huntFonte.npcs,
    pokemon: [{ pokeId, nome: esp?.name ?? hunt.nome, pontos: huntFonte.totalSpawns }],
    spawns: (huntFonte.spawns ?? []).map((s) => ({ ...s, pokeId })),
  };
  grades[slug] = {
    ...gradeFonte,
    mapa: gradeFonte.mapa ?? fonteSlug,
    pontos: (gradeFonte.pontos ?? []).map(([x, y]) => [x, y, pokeId]),
  };
}

for (const [slug, fonteSlug] of Object.entries(MAPAS_HERDADOS)) {
  herdarMapaHunt(slug, fonteSlug);
}

/**
 * Funde as nossas hunts no catálogo do espelho.
 *
 * A geografia inteira (caixa, pontos andáveis, coordenadas de spawn) vem da fonte; o que muda
 * é quem mora ali. `mapa` é o pulo do gato: aponta para o mapa de tiles da fonte, então o
 * cliente baixa um arquivo que já existe em vez de precisarmos duplicar 600 KB por hunt.
 *
 * `regiao` é declarada aqui porque as abas do mapa agrupam por geração, e estas fogem à regra
 * de propósito — um Ditto de Gen 1 numa hunt de Sinnoh cairia na aba Kanto sem esse campo.
 */
for (const nova of HUNTS_SINNOH_ATIVAS) {
  const fonte = hunts[nova.fonte];
  const gradeFonte = grades[nova.fonte];
  if (!fonte || !gradeFonte?.pontos?.length) {
    console.warn(`[content] hunt "${nova.slug}": fonte "${nova.fonte}" não existe no espelho — pulando`);
    continue;
  }
  const esp = especies.get(nova.pokeId);
  if (!esp) {
    console.warn(`[content] hunt "${nova.slug}": pokeId ${nova.pokeId} não está em creatures.json — pulando`);
    continue;
  }
  hunts[nova.slug] = {
    ...fonte,
    slug: nova.slug,
    nome: nova.nome,
    area: 'orre',
    regiao: 'sinnoh',
    nivel: nova.nivel,
    pixel: nova.pixel,
    looktype: esp.looktype,
    pokemon: [{ pokeId: nova.pokeId, nome: esp.name, pontos: fonte.totalSpawns }],
    spawns: (fonte.spawns ?? []).map((s) => ({ ...s, pokeId: nova.pokeId })),
  };
  // Cada ponto andável é `[x, y, pokeId]`, e é o TERCEIRO elemento que `povoarOnda` lê para
  // saber quem nasce ali — não o `spawns` da hunt. Clonar a grade sem reescrever esse campo
  // deixava a hunt do Dragalge cuspindo Ivysaur, porque o pokeId da fonte vinha junto.
  grades[nova.slug] = {
    ...gradeFonte,
    mapa: gradeFonte.mapa ?? nova.fonte,
    pontos: (gradeFonte.pontos ?? []).map(([x, y]) => [x, y, nova.pokeId]),
  };
}

for (const nova of HUNTS_EDITOR) {
  const fonte = hunts[nova.fonte];
  const gradeFonte = grades[nova.fonte];
  if (!fonte || !gradeFonte?.pontos?.length) {
    console.warn(`[content] hunt editor "${nova.slug}": fonte "${nova.fonte}" inválida — pulando`);
    continue;
  }
  const esp = especies.get(nova.pokeId);
  if (!esp) {
    console.warn(`[content] hunt editor "${nova.slug}": pokeId ${nova.pokeId} ausente — pulando`);
    continue;
  }
  hunts[nova.slug] = {
    ...fonte,
    slug: nova.slug,
    nome: nova.nome,
    area: 'orre',
    regiao: nova.regiao,
    nivel: nova.nivel,
    pixel: nova.pixel,
    looktype: esp.looktype,
    pokemon: [{ pokeId: nova.pokeId, nome: esp.name, pontos: fonte.totalSpawns }],
    spawns: (fonte.spawns ?? []).map((s) => ({ ...s, pokeId: nova.pokeId })),
  };
  grades[nova.slug] = {
    ...gradeFonte,
    mapa: gradeFonte.mapa ?? nova.fonte,
    pontos: (gradeFonte.pontos ?? []).map(([x, y]) => [x, y, nova.pokeId]),
  };
}

for (const nova of HUNTS_KANTO_NOVOS) {
  const fonte = hunts[nova.fonte];
  const gradeFonte = grades[nova.fonte];
  if (!fonte || !gradeFonte?.pontos?.length) {
    console.warn(`[content] hunt kanto "${nova.slug}": fonte "${nova.fonte}" inválida — pulando`);
    continue;
  }
  const esp = especies.get(nova.pokeId);
  if (!esp) {
    console.warn(`[content] hunt kanto "${nova.slug}": pokeId ${nova.pokeId} ausente — pulando`);
    continue;
  }
  hunts[nova.slug] = {
    ...fonte,
    slug: nova.slug,
    nome: nova.nome,
    area: 'kanto',
    regiao: 'kanto',
    nivel: nova.nivel,
    pixel: nova.pixel,
    looktype: esp.looktype,
    pokemon: [{ pokeId: nova.pokeId, nome: esp.name, pontos: fonte.totalSpawns }],
    spawns: (fonte.spawns ?? []).map((s) => ({ ...s, pokeId: nova.pokeId })),
  };
  grades[nova.slug] = {
    ...gradeFonte,
    mapa: gradeFonte.mapa ?? nova.fonte,
    pontos: (gradeFonte.pontos ?? []).map(([x, y]) => [x, y, nova.pokeId]),
  };
}

for (const nova of HUNTS_JOHTO_NOVOS) {
  const fonte = hunts[nova.fonte];
  const gradeFonte = grades[nova.fonte];
  if (!fonte || !gradeFonte?.pontos?.length) {
    console.warn(`[content] hunt johto "${nova.slug}": fonte "${nova.fonte}" inválida — pulando`);
    continue;
  }
  const esp = especies.get(nova.pokeId);
  if (!esp) {
    console.warn(`[content] hunt johto "${nova.slug}": pokeId ${nova.pokeId} ausente — pulando`);
    continue;
  }
  hunts[nova.slug] = {
    ...fonte,
    slug: nova.slug,
    nome: nova.nome,
    area: 'kanto',
    regiao: 'johto',
    nivel: nova.nivel,
    pixel: nova.pixel,
    looktype: esp.looktype,
    pokemon: [{ pokeId: nova.pokeId, nome: esp.name, pontos: fonte.totalSpawns }],
    spawns: (fonte.spawns ?? []).map((s) => ({ ...s, pokeId: nova.pokeId })),
  };
  grades[nova.slug] = {
    ...gradeFonte,
    mapa: gradeFonte.mapa ?? nova.fonte,
    pontos: (gradeFonte.pontos ?? []).map(([x, y]) => [x, y, nova.pokeId]),
  };
}

for (const nova of HUNTS_OUTLAND_NOVOS) {
  const fonte = hunts[nova.fonte];
  const gradeFonte = grades[nova.fonte];
  if (!fonte || !gradeFonte?.pontos?.length) {
    console.warn(`[content] hunt outland "${nova.slug}": fonte "${nova.fonte}" inválida — pulando`);
    continue;
  }
  const esp = especies.get(nova.pokeId);
  if (!esp) {
    console.warn(`[content] hunt outland "${nova.slug}": pokeId ${nova.pokeId} ausente — pulando`);
    continue;
  }
  hunts[nova.slug] = {
    ...fonte,
    slug: nova.slug,
    nome: nova.nome,
    area: 'outland',
    regiao: 'outland',
    nivel: nova.nivel ?? 150,
    pixel: nova.pixel,
    looktype: esp.looktype,
    pokemon: [{ pokeId: nova.pokeId, nome: esp.name, pontos: fonte.totalSpawns }],
    spawns: (fonte.spawns ?? []).map((s) => ({ ...s, pokeId: nova.pokeId })),
  };
  grades[nova.slug] = {
    ...gradeFonte,
    mapa: gradeFonte.mapa ?? nova.fonte,
    pontos: (gradeFonte.pontos ?? []).map(([x, y]) => [x, y, nova.pokeId]),
  };
}

/** Remapeia pokeIds legados 10501+ → #2001+ em hunts e walkgrids do espelho. */
function aplicarRemapOutlandHunts(huntsObj, gradesObj) {
  for (const h of Object.values(huntsObj)) {
    for (const p of h.pokemon ?? []) p.pokeId = remapOutlandPokeId(p.pokeId);
    for (const s of h.spawns ?? []) s.pokeId = remapOutlandPokeId(s.pokeId);
  }
  for (const g of Object.values(gradesObj)) {
    for (const pt of g.pontos ?? []) {
      if (pt.length >= 3) pt[2] = remapOutlandPokeId(pt[2]);
    }
  }
}
aplicarRemapOutlandHunts(hunts, grades);

/**
 * As pokébolas, com a BEAST BALL acrescentada ao catálogo do espelho.
 *
 * As quatro primeiras são deles (`/api/game/balls`). A Beast Ball é a nossa versão da "Idle
 * Ball" da loja de diamantes: **2× a eficiência da Ultra Ball**, nome e sprite trocados. Ela
 * entra aqui, e não em `loja.mjs`, porque o arremesso precisa achá-la em `bolaPorId` como
 * qualquer outra — o caminho do `ball.throw` é um só.
 */
const catchUltra = formulas.bolas.find((b) => b.id === 4)?.catchRate ?? 4;
const beastBall = { ...BEAST_BALL, catchRate: catchUltra * BEAST_VS_ULTRA };
export const bolas = [...formulas.bolas, beastBall];
export const bolaPorId = new Map(bolas.map((b) => [b.id, b]));
export const tabelaTipos = formulas.tipos.tabela;
export const catalogoShiny = new Map((formulas.shinyCatalogo ?? []).map((s) => [s.dexId, s]));
/** Shiny das variantes Outland — chave = pokeId `#2001+`, separado do dex nacional Unova. */
export const catalogoShinyOutland = new Map();

function pokeIdShinyOutlandDeEntrada(s) {
  if (s.pokeId != null) return remapOutlandPokeId(s.pokeId);
  if (s.dexId >= 501 && s.dexId <= 547 && ehNomeVarianteOutland(s.name)) {
    return OUTLAND_DEX_BASE + (s.dexId - 501);
  }
  return null;
}

for (const s of SHINY_NOVOS) {
  const pokeOutland = pokeIdShinyOutlandDeEntrada(s);
  if (pokeOutland != null && isOutlandPokeId(pokeOutland) && especies.has(pokeOutland)) {
    const esp = especies.get(pokeOutland);
    const baseDex = dexSpriteBaseOutland(pokeOutland, esp?.name ?? s.name);
    const baseShiny = baseDex ? catalogoShiny.get(baseDex) : null;
    catalogoShinyOutland.set(pokeOutland, {
      ...baseShiny,
      ...s,
      looktype: s.looktype ?? baseShiny?.looktype ?? null,
    });
    continue;
  }
  if (s.dexId == null) continue;
  // O lab/nomeador manda no looktype — o espelho fica só como fallback de tier.
  catalogoShiny.set(s.dexId, { ...catalogoShiny.get(s.dexId), ...s });
}

// Unova #501–547: slots do espelho Outland ocupavam o dexId — preenche do baseline do lab.
// Com `publicar:backup`, o shiny-catalogo-novos.json já é a lista fechada — não reintroduz
// shiny que sumiu do Pokedex Backup só porque o baseline do Nomeador ainda aponta pro lab.
const baselineShiny = lerLocalOpcional('../../../tools/nomeador/pokedex-lab-baseline.json')?.entradas ?? {};
for (const ent of Object.values(baselineShiny)) {
  const dex = ent?.dex;
  if (dex == null || dex < 501 || dex > 547 || !ent.shiny?.id) continue;
  if (CATALOGO_SHINY_BACKUP) continue;
  if (catalogoShiny.has(dex)) continue;
  catalogoShiny.set(dex, {
    dexId: dex,
    name: ent.nome ?? ent.slug,
    looktype: 70000 + dex,
    tier: 'C',
    count: 3,
  });
}

/**
 * A forma SHINY das 35 megas entra no MESMO catálogo, com a chave sendo o pokeId da mega.
 *
 * `looktypeShiny` resolve `#3094` por `dexDe`, que devolve 3094 para a faixa das megas — então
 * basta a entrada existir com essa chave para o Mega Gengar shiny desenhar. E, como o
 * `welcome` monta `shinyLooks` a partir deste mapa, o cliente recebe as 35 sem mais nenhuma
 * linha de protocolo.
 *
 * O `count` é 0 de propósito: ele é quantos daquela forma já foram CAPTURADOS no mundo, e mega
 * não se captura — ela se fabrica. Um número aqui viraria uma estatística que nunca anda.
 */
for (const m of MEGAS) {
  if (!megaTemShiny(m)) continue;
  const id = megaPokeId(m.dex);
  catalogoShiny.set(id, {
    dexId: id,
    name: m.nome,
    looktype: looktypeMegaShiny(m.dex),
    tier: 'A',
    count: 0,
  });
}

export const OUTLAND_DEX = montarOutlandDex(especies);
setOutlandDexMap(OUTLAND_DEX);
setOutlandDexLegado48(montarOutlandDexLegado48(especies));

/** Faixas da Pokédex — mesma lógica do cliente (`app.js`) para a aba do mapa. */
const FAIXA_GERACAO = [
  [1, 151, 'kanto'], [152, 251, 'johto'], [252, 386, 'hoenn'],
  [387, 493, 'sinnoh'], [494, 649, 'unova'], [650, 721, 'kalos'],
  [722, 809, 'alola'], [810, 905, 'alola'], [906, 1025, 'alola'],
];
const geracaoDoDex = (d) => FAIXA_GERACAO.find(([a, b]) => d >= a && d <= b)?.[2] ?? null;

function regiaoTabDoHunt(h) {
  if (h.regiao) {
    if (h.regiao === 'galar' || h.regiao === 'paldea') return 'alola';
    return h.regiao;
  }
  const peso = new Map();
  for (const p of h.pokemon ?? []) {
    const g = geracaoDoDex(dexDe(p.pokeId));
    if (g) peso.set(g, (peso.get(g) ?? 0) + (p.pontos ?? 1));
  }
  let melhor = null;
  let max = -1;
  for (const [g, n] of peso) if (n > max) [melhor, max] = [g, n];
  return melhor;
}

/** Dex já coberto por hunt nossa (spawns-editor / hunts-sinnoh) na mesma aba regional. */
const customDexPorRegiao = new Map();
for (const h of Object.values(hunts)) {
  if (!h.regiao || !h.pokemon?.length) continue;
  const reg = regiaoTabDoHunt(h);
  if (!reg || reg === 'kanto' || reg === 'johto') continue;
  const dex = dexDe(h.pokemon[0].pokeId);
  if (!customDexPorRegiao.has(reg)) customDexPorRegiao.set(reg, new Set());
  customDexPorRegiao.get(reg).add(dex);
}

/** Espelho (orre, sem `regiao`) some quando já existe marcador nosso na mesma aba — evita 2× Snorunt. */
function huntEspelhadaDuplicada(h) {
  if (h.regiao || h.area !== 'orre' || !h.pokemon?.length) return false;
  const reg = regiaoTabDoHunt(h);
  if (!reg || reg === 'kanto' || reg === 'johto') return false;
  return customDexPorRegiao.get(reg)?.has(dexDe(h.pokemon[0].pokeId)) ?? false;
}

// hunts que dá para caçar de verdade: têm spawn E têm área andável extraída do mapa
// (as cidades ficam de fora pelos dois critérios)
export const huntsJogaveis = Object.values(hunts)
  .filter((h) => !huntEspelhadaDuplicada(h))
  .filter((h) => h.totalSpawns > 0 && h.pokemon.length && grades[h.slug]?.pontos?.length)
  .map((h) => ({
    slug: h.slug,
    nome: h.nome,
    area: h.area,
    // nível da hunt = marcador (spawns-editor / hunts-sinnoh), não o huntLevel global da espécie
    nivel: h.nivel ?? Math.max(...h.pokemon.map((p) => especies.get(p.pokeId)?.huntLevel ?? 1)),
    especies: h.pokemon.map((p) => ({ pokeId: p.pokeId, nome: p.nome, pontos: p.pontos })),
    totalSpawns: h.totalSpawns,
    // Só as nossas trazem estes: o cliente monta o marcador a partir daqui, porque hunt que
    // não veio do espelho também não está em `map-markers.json`.
    ...(h.regiao ? { regiao: h.regiao, pixel: h.pixel, looktype: h.looktype } : {}),
  }))
  .sort((a, b) => a.nivel - b.nivel);

export const huntJogavelPorSlug = new Map(huntsJogaveis.map((h) => [h.slug, h]));

/**
 * O MENOR degrau de hunt em que cada espécie aparece.
 *
 * É o número que a ficha da espécie usa como referência (`nivelRef` em `corpoDaEspecie`), e
 * não o `huntLevel` do catálogo: as dezoito espécies que moram em duas hunts de eras
 * diferentes contam histórias diferentes nos dois campos, e a que vale é onde o jogador de
 * fato a encontra pela primeira vez.
 */
const nivelHuntPorEspecie = (() => {
  const m = new Map();
  for (const h of huntsJogaveis) {
    for (const e of h.especies) {
      const antes = m.get(e.pokeId);
      if (antes == null || h.nivel < antes) m.set(e.pokeId, h.nivel);
    }
  }
  return m;
})();

/** O degrau em que a espécie é encontrada — `null` quando ela não está em hunt nenhuma. */
export const nivelDeHuntDaEspecie = (pokeId) => nivelHuntPorEspecie.get(Number(pokeId)) ?? null;

// O VALOR das espécies (`shared/valor-cadeia.mjs`): sobe ao da hunt quem tem nível de Kanto e só
// aparece acima dele, e o pré-evolução fica abaixo da evolução. Aqui, e não junto do
// `normalizarSellValue`, porque precisa da hunt mais baixa de cada espécie, que só existe agora.
// O cliente repete no fim de `carregarCatalogoEspecies` e quando as hunts chegam no `welcome`.
assentarValorDasEspecies(especies.values(), ESTAGIOS_EVOLUTIVOS, nivelDeHuntDaEspecie);

// ------------------------------------------------------------------ fórmulas

const xpPelaFormula = (L) => (L <= 1 ? 0 : Math.round((50 / 3) * (L ** 3 - 6 * L ** 2 + 17 * L - 12)));

/**
 * A fórmula acima, lembrada por nível inteiro. Ela roda duas vezes por pokémon em cada pacote de
 * estado (`xpNivel`/`xpProximo`) e uma vez por nível no laço de `nivelPeloXp` — em 14/09/2026 era
 * 1,4% do tempo do sim. O resultado é o MESMO double (cabe exato: 8.191³·50/3 < 2⁵³); nível fora da
 * faixa, negativo ou fracionário cai direto na fórmula.
 */
const XP_POR_NIVEL = new Float64Array(8192).fill(-1);
export const xpTotalParaNivel = (L) => {
  if (L >= 0 && L < 8192 && L === Math.floor(L)) {
    const v = XP_POR_NIVEL[L];
    return v >= 0 ? v : (XP_POR_NIVEL[L] = xpPelaFormula(L));
  }
  return xpPelaFormula(L);
};

export function nivelPeloXp(xp) {
  let L = 1;
  // Sem teto artificial: hunts de Sinnoh+ pedem nv 1000+; o `while (L < 999)` cortava quem
  // tinha XP de nv 2000 de volta para 999 no primeiro ganho de XP.
  while (xpTotalParaNivel(L + 1) <= xp) L++;
  return L;
}

/**
 * O TETO da espécie — o nível mais alto com que ela pode SAIR de uma pokébola.
 *
 * Sai do estágio evolutivo dela (`shared/teto-captura.mjs`), e não do `huntLevel`: quem é
 * base de cadeia vale 20, o do meio 40, a última evolução 100. Fica gravado em `tetoCaptura`
 * no boot; este acessor existe para o resto do servidor não precisar carregar o mapa de
 * estágios só para ler um número.
 */
export const tetoDeCapturaDaEspecie = (esp) => esp?.tetoCaptura ?? TETO_CAPTURA_MAX;

/**
 * Em que nível este selvagem entra na equipe, se a bola fechar.
 *
 * Até 100 é o nível dele mesmo — Kanto inteira não muda nada. Acima disso o
 * teto da espécie manda. Ver o cabeçalho de `shared/teto-captura.mjs` para o porquê.
 */
export const nivelDeCapturaDe = (esp, nivelSelvagem) =>
  nivelDeCaptura(nivelSelvagem, tetoDeCapturaDaEspecie(esp));

/**
 * O piso do botão "Reduzir o nível" da ficha: o "Nível ao capturar" da espécie.
 *
 * Mora aqui, e não no `shared/`, porque só o servidor tem as duas metades da conta em mão — o
 * degrau da hunt e o `tetoCaptura` gravado no boot. A regra e o porquê estão em
 * `shared/reduzir-nivel.mjs`; esta linha é o acessor que o resto do servidor usa.
 */
export const pisoDeReducaoDaEspecie = (esp) =>
  pisoReducaoNivel(esp, esp ? nivelDeHuntDaEspecie(esp.pokeId) : null);

/** Efetividade base, multiplicativa nos dois tipos do defensor. */
export function efetividade(atq, def1, def2) {
  return efetividadeTipos(atq, def1, def2, tabelaTipos);
}

/** Na hunt a vantagem é +50% mais pronunciada nos dois sentidos (0 e 1 não mudam). */
export const amplificarHunt = (v) => (v === 0 || v === 1 ? v : v > 1 ? 1 + (v - 1) * 1.5 : v / 1.5);

export const efetividadeHunt = (atq, d1, d2) => amplificarHunt(efetividade(atq, d1, d2));

const BANDAS = formulas.qualidade.bandas;
const EXPO = formulas.qualidade.expoentePorStat;

/** Roll de qualidade com as bandas reais (somam 100%). */
export function rolarQualidade(rand = Math.random) {
  let t = 100 * rand();
  for (const b of BANDAS) {
    if (t < b.chance) {
      if (b.min === b.max) return b.min;
      return Math.floor((b.min + rand() * (b.max - b.min)) * 1000) / 1000;
    }
    t -= b.chance;
  }
  return 1;
}

const iv = (rand) => 1 + Math.floor(32 * rand());

export function rolarIVs(rand = Math.random) {
  return { hp: iv(rand), atk: iv(rand), def: iv(rand), spAtk: iv(rand), spDef: iv(rand), speed: iv(rand) };
}

/** Shiny rerola até a soma dos 6 IVs passar de 110. */
export function rolarIVsShiny(rand = Math.random) {
  for (let i = 0; i < 512; i++) {
    const s = rolarIVs(rand);
    if (s.hp + s.atk + s.def + s.spAtk + s.spDef + s.speed > 110) return s;
  }
  return { hp: 19, atk: 19, def: 19, spAtk: 19, spDef: 19, speed: 19 };
}

/**
 * O STARTER não é sorteado como um selvagem — ele tem piso.
 *
 * Medido na conta de referência (30/07/2026): o Charmander nível 11 de lá tem 168 de HP de
 * combate e power 123, o que só fecha com qualidade ≥ 1,30 (Rara) e soma de IVs perto de 180
 * de 192. Com o roll livre de captura, um em cada dez treinadores nasce com um starter da
 * banda "Fraca" (0,8–1,0): o starter que motivou este piso saiu com qualidade 0,839 e IVs de
 * ATK 8 / DEF 6 — 48 de power contra os 123 do de referência, e a mesma hunt que lá é
 * vencível vira intransponível.
 *
 * Os pisos abaixo foram escolhidos por medição: reproduzem o desempenho do pokémon de
 * referência na hunt do Exeggcute dentro de poucos pontos percentuais de HP restante. O
 * limite de 512 tentativas é o mesmo do roll shiny.
 *
 * O piso POR STAT existe além do da soma: só a soma deixava passar um starter com IV de HP
 * igual a 3 e todo o resto no teto — soma alta, 84 de HP, morrendo na hunt do mesmo jeito.
 * Com soma > 140 e cada IV ≥ 16 o sorteio fecha em ~73 tentativas e praticamente nunca cai
 * no conjunto fixo de reserva.
 */
export const STARTER_QUALIDADE_MIN = 1.3;
export const STARTER_IV_SOMA_MIN = 140;
export const STARTER_IV_STAT_MIN = 16;

export function rolarStarter(rand = Math.random) {
  let quality = STARTER_QUALIDADE_MIN;
  for (let i = 0; i < 512; i++) {
    const q = rolarQualidade(rand);
    if (q >= STARTER_QUALIDADE_MIN) {
      quality = q;
      break;
    }
  }
  let ivs = { hp: 24, atk: 24, def: 24, spAtk: 24, spDef: 24, speed: 24 };
  for (let i = 0; i < 512; i++) {
    const s = rolarIVs(rand);
    const v = [s.hp, s.atk, s.def, s.spAtk, s.spDef, s.speed];
    if (v.reduce((a, b) => a + b, 0) > STARTER_IV_SOMA_MIN && Math.min(...v) >= STARTER_IV_STAT_MIN) {
      ivs = s;
      break;
    }
  }
  return { quality, ivs };
}

// ---------------------------------------------------------------- potência
//
// A POTÊNCIA é o segundo eixo que separa dois pokémon da mesma espécie e do mesmo nível — o
// primeiro é a qualidade, que o jogador nunca escolhe e quase não vê. Ela é sorteada UMA vez,
// no instante da captura, e nunca mais muda: subir de nível não melhora a potência, e é isso
// que dá valor de mercado a um pokémon de nível baixo com potência alta.
//
// A tabela é literal — as chances somam exatamente 100 e o bônus é o mesmo em TODOS os stats
// (hp, atk, def, spAtk, spDef, speed), aplicado depois da qualidade:
//
//     1 → 74,495%   +0%     o caso comum: três de cada quatro capturas
//     2 → 20%       +5%
//     3 →  5%      +10%
//     4 →  0,5%    +25%
//     5 →  0,005%  +100%    um a cada vinte mil
//
// Repare a distância entre 4 e 5: a potência 4 é rara mas acontece (uma a cada 200), e a 5 é
// da ordem do shiny. Ter as duas juntas seria um bicho de 4× o normal, e é raro o bastante
// para valer o preço que vai pedir no Mercado Global.
export const POTENCIAS = [
  { n: 1, chance: 74.495, bonus: 0 },
  { n: 2, chance: 20, bonus: 0.05 },
  { n: 3, chance: 5, bonus: 0.1 },
  { n: 4, chance: 0.5, bonus: 0.25 },
  { n: 5, chance: 0.005, bonus: 1 },
];

export const POTENCIA_MAX = POTENCIAS.length;

/**
 * O SHINY também é um multiplicador de stats, e o maior de todos: +200% (×3).
 *
 * Ele já era raro (1/24.000 por encontro) e já rerolava IVs até somarem mais de 110,
 * mas isso valia poucos pontos percentuais — na prática o shiny era só uma cor diferente. Com
 * o triplo em tudo, encontrar um passa a mudar o time de verdade, e a raridade justifica.
 */
export const MULT_SHINY_STATS = 3;

/** O multiplicador de uma potência (1 = neutro). Fora da faixa cai em 1, nunca em NaN. */
export const multPotencia = (n) => 1 + (POTENCIAS[(n ?? 1) - 1]?.bonus ?? 0);

/**
 * Tudo que multiplica os stats de um pokémon POR SER QUEM ELE É — potência e shiny juntos.
 * Um só lugar para a conta significa que `montarPokemon`, `recalcular` e a criação nunca
 * podem divergir, que é o tipo de bug que só aparece depois do relog.
 */
export const multDeNascenca = (potencia, shiny) =>
  multPotencia(potencia) * (shiny ? MULT_SHINY_STATS : 1);

/** Gira a roleta da potência. Roda uma vez por captura, no servidor. */
export function rolarPotencia(rand = Math.random) {
  let t = 100 * rand();
  for (const p of POTENCIAS) {
    if (t < p.chance) return p.n;
    t -= p.chance;
  }
  return 1;
}

// ------------------------------------------------------------------- shiny

/**
 * O looktype da forma SHINY, quando a espécie tem uma.
 *
 * O `shinyCatalogo` traz um looktype próprio por espécie (Charizard 67 → Shiny Charizard
 * 9874), e é ele que desenha o bicho preto. Sem isto o shiny era só um ✨ ao lado de um sprite
 * idêntico ao do pokémon comum — e, do outro lado, quem visse a arte preta em algum lugar não
 * tinha como saber que era um shiny.
 *
 * Devolve `null` para as 379 espécies sem forma shiny, e quem chama continua com o normal.
 */
export const looktypeShiny = (pokeId) => {
  if (isOutlandPokeId(pokeId)) {
    // Outland não tem shiny jogável — só entra no catálogo se alguém cadastrar de propósito.
    return catalogoShinyOutland.get(pokeId)?.looktype ?? null;
  }
  const dex = pokeId < 1000 ? pokeId : pokeId >= 13000 ? pokeId - 13000 : dexDe(pokeId);
  return catalogoShiny.get(dex)?.looktype ?? null;
};

const umStat = (base, growth, nivel, mult) => Math.round((base + 2 * growth) * (nivel / 100) * mult);

/**
 * `mult` é o multiplicador de nascença (potência × shiny). Entra JUNTO com a qualidade, no
 * mesmo lugar, porque é a mesma natureza de coisa: um número que o pokémon carrega desde que
 * nasceu e que vale para os seis stats.
 *
 * `refino` é o `+N` comprado com pedras (ver `shared/refino-stats.mjs`). Soma na BASE, antes
 * do IV e antes de qualquer multiplicador — é o único jeito de o degrau valer mais num bicho
 * bom do que num ruim, que é o que sustenta o sistema como coisa de endgame. `null` (o padrão)
 * é o pokémon que nunca foi refinado, que é a esmagadora maioria e não paga nada por isto.
 */
export function calcularStats(especie, ivs, nivel, qualidade, mult = 1, refino = null) {
  const m = (k) => Math.pow(qualidade, EXPO[k]) * mult;
  // `basesComRefino` com `null` devolve as bases da espécie intactas — a esmagadora maioria
  // das chamadas passa por aqui, e nenhuma delas precisa saber que o refino existe.
  const b = basesComRefino(especie, refino);
  return {
    hp: umStat(b.hp, ivs.hp, nivel, m('hp')),
    atk: umStat(b.atk, ivs.atk, nivel, m('atk')),
    def: umStat(b.def, ivs.def, nivel, m('def')),
    spAtk: umStat(b.spAtk, ivs.spAtk, nivel, m('spAtk')),
    spDef: umStat(b.spDef, ivs.spDef, nivel, m('spDef')),
    speed: umStat(b.speed, ivs.speed, nivel, m('speed')),
  };
}

/** Soma dos seis stats — só exibição de boss; o ranking ⚔ usa `poderDePokemon` em `nota-pokemon.mjs`. */
export const poder = (stats) =>
  Math.round(stats.hp + stats.atk + stats.def + stats.spAtk + stats.spDef + stats.speed);

/** HP de combate. O selvagem ainda leva ×5 por cima disto. */
export const hpDeCombate = (hp) => Math.max(24, Math.round(hp * 12));

export const MULT_HP_SELVAGEM = formulas.combate.wildHp.valor; // 5
export const MULT_DANO_SELVAGEM = formulas.combate.wildDano.valor; // 1.8
/** Quanto a vantagem elemental é amplificada na hunt (ver `amplificarHunt`). */
export const AMPLIACAO_HUNT = formulas.combate.vantagemElemental.valor; // 1.5

/** Golpes que a espécie já aprendeu naquele nível. */
export function golpesDisponiveis(especie, nivel) {
  return (especie.attacks ?? []).filter((a) => (a.learnLevel ?? 1) <= nivel);
}

export const efeitoDoTipo = (tipo) => moves.efeitos[String(tipo).toUpperCase()] ?? null;

// ------------------------------------------------- tipo elemental dos itens
//
// O jogador pensa em item por ELEMENTO ("preciso de coisa de água"), mas `items.json` não tem
// tipo nenhum — só uma categoria de arrumação (loot, stone, tm, clan, card, heal, revive).
// O tipo é derivado aqui, uma vez no boot, por três caminhos em ordem de confiança:
//
//   1. o NOME diz — "Fire-Type TM Disk" e "Shiny Charizard Card" não deixam dúvida;
//   2. quem DROPA diz — se 50%+ dos pokémon que soltam "Fire Tail" são de fogo, é de fogo.
//      É a leitura mais honesta que existe: o item é literalmente o pedaço do bicho;
//   3. uma palavra-chave no nome, e por último os droppers de novo com 30%.
//
// As ~34 sobras (poções, revives, fichas de boss, essências genéricas) ficam sem tipo de
// propósito — inventar um para uma Ultra Potion seria pior que não ter.

// A lista dos 18 tipos mora em `game/itens-nossos.mjs` — as Shiny Stones precisam dela antes
// desta linha existir (ver o comentário lá). Reexportada aqui porque este é o módulo em que o
// resto do jogo a procura, e para continuar havendo UMA lista só.
export { TIPOS_POKEMON };
const TIPO_VALIDO = new Set(TIPOS_POKEMON);

/** Categorias de item que a vitrine oferece como filtro, na ordem em que aparecem. */
export const CATEGORIAS_ITEM = ['loot', 'stone', 'tm', 'clan', 'card'];

// Pares "trecho do nome → tipo", conferidos um a um contra a lista de itens. A ordem importa:
// o primeiro que casar ganha, então o específico vem antes do genérico.
const PALAVRA_TIPO = [
  ['lava', 'FIRE'], ['magma', 'FIRE'], ['flame', 'FIRE'], ['fire', 'FIRE'], ['sun', 'FIRE'],
  ['fish', 'WATER'], ['shell', 'WATER'], ['water', 'WATER'], ['fin', 'WATER'],
  ['snow', 'ICE'], ['ski', 'ICE'], ['frozen', 'ICE'], ['crystal', 'ICE'], ['ice', 'ICE'],
  ['leaf', 'GRASS'], ['seed', 'GRASS'], ['plant', 'GRASS'], ['straw', 'GRASS'],
  ['moss', 'GRASS'], ['flower', 'GRASS'], ['vine', 'GRASS'],
  ['cocoon', 'BUG'], ['bug', 'BUG'],
  ['thunder', 'ELECTRIC'], ['electric', 'ELECTRIC'], ['magnet', 'ELECTRIC'],
  ['shock', 'ELECTRIC'], ['rubber', 'ELECTRIC'],
  ['venom', 'POISON'], ['poison', 'POISON'], ['gosme', 'POISON'],
  ['earth', 'GROUND'], ['sand', 'GROUND'], ['ground', 'GROUND'],
  ['fossil', 'ROCK'], ['amber', 'ROCK'], ['rock', 'ROCK'],
  ['ghost', 'GHOST'], ['dragon', 'DRAGON'], ['ancient', 'DRAGON'], ['dark', 'DARK'],
  ['metal', 'STEEL'], ['steel', 'STEEL'], ['iron', 'STEEL'], ['screw', 'STEEL'],
  ['punch', 'FIGHTING'], ['kick', 'FIGHTING'], ['martial', 'FIGHTING'],
  ['feather', 'FLYING'], ['wing', 'FLYING'], ['beak', 'FLYING'],
  ['enigma', 'PSYCHIC'], ['psychic', 'PSYCHIC'], ['hypnosis', 'PSYCHIC'],
  ['heart', 'FAIRY'], ['moon', 'FAIRY'],
  ['fur', 'NORMAL'], ['horn', 'NORMAL'], ['comb', 'NORMAL'],
];

const especiePorNome = new Map(creatures.map((c) => [c.name.toLowerCase(), c]));

/**
 * O tipo dominante entre quem dropa o item.
 *
 * `limiar` é a fatia mínima do vencedor: 0,5 exige maioria (usado antes das palavras-chave) e
 * 0,3 aceita a moda (usado depois, como última tentativa). O tipo secundário conta meio ponto
 * — um Charizard é mais de fogo que de voador para efeito do que ele solta.
 *
 * Item dropado por mais de 60 espécies é ignorado: é lixo universal (Strange Pheromone cai de
 * 443 pokémon), e a moda ali só descreveria o catálogo, não o item.
 */
function tipoPorDroppers(nome, limiar) {
  const dropadoPor = loot[nome]?.dropadoPor?.filter((d) => d.chancePct > 0) ?? [];
  if (!dropadoPor.length || dropadoPor.length > 60) return null;

  const contagem = {};
  for (const d of dropadoPor) {
    const e = especies.get(d.pokeId);
    if (!e) continue;
    if (e.type1) contagem[e.type1] = (contagem[e.type1] ?? 0) + 1;
    if (e.type2) contagem[e.type2] = (contagem[e.type2] ?? 0) + 0.5;
  }
  const ranque = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
  if (!ranque.length) return null;
  const total = ranque.reduce((s, [, n]) => s + n, 0);
  return ranque[0][1] / total >= limiar ? ranque[0][0] : null;
}

function tipoPorNome(item) {
  if (item.category === 'tm') {
    const m = /^([A-Za-z]+)-Type/.exec(item.name);
    const t = m?.[1].toUpperCase();
    return TIPO_VALIDO.has(t) ? t : null;
  }
  // As cartas são "Shiny <Espécie> Card": o tipo é o da espécie, sem chute nenhum.
  if (item.category === 'card') {
    const m = /^Shiny (.+) Cards?$/.exec(item.name);
    return (m && especiePorNome.get(m[1].toLowerCase())?.type1) ?? null;
  }
  return null;
}

function derivarTipoDoItem(item) {
  const doNome = tipoPorNome(item);
  if (doNome) return doNome;
  const maioria = tipoPorDroppers(item.name, 0.5);
  if (maioria) return maioria;

  const minusculo = item.name.toLowerCase();
  for (const [trecho, tipo] of PALAVRA_TIPO) if (minusculo.includes(trecho)) return tipo;

  return tipoPorDroppers(item.name, 0.3);
}

/** itemId → tipo elemental, ou ausente quando o item não tem um que faça sentido. */
export const TIPO_DO_ITEM = new Map();
for (const item of itemsRaw) {
  const tipo = derivarTipoDoItem(item);
  if (tipo) TIPO_DO_ITEM.set(item.id, tipo);
}
// As Shiny Stones são carimbadas, não adivinhadas. A derivação por palavra-chave acertaria a
// maioria por acidente ("Fire Shiny Stone" casa com `fire`) e erraria calada nas que não têm
// palavra na tabela — `Fighting Shiny Stone` ficaria SEM tipo, e é justamente o tipo que diz
// qual pokémon aquela pedra evolui. Aqui o mapa tipo→item já existe e é a fonte certa.
for (const [tipo, itemId] of Object.entries(SHINY_STONE_POR_TIPO)) TIPO_DO_ITEM.set(itemId, tipo);

/**
 * O REEQUILÍBRIO DA RENDA. Ver `shared/economia-drop.mjs` — o desenho inteiro está lá.
 *
 * Mora AQUI, e não junto do `normalizarSellValue` lá em cima, por ordem de dependência: o
 * solver precisa do preço de cada item, e `itens` só existe depois de `itemsRaw`. Mora DEPOIS
 * do `TIPO_DO_ITEM` porque a derivação de tipo lê o loot ORIGINAL do espelho — inverter a
 * ordem faria o tipo de cada item ser deduzido da tabela que este passo acabou de reescrever.
 *
 * Muta `esp.loot` no lugar, e `especies` guarda referência: quem já pegou a espécie enxerga a
 * tabela nova. As únicas leituras de loot antes daqui são a canonização de nome (linha ~281) e
 * o índice do espelho, e nenhuma das duas guarda cópia.
 */
/** Espelha `COMPRAVEIS` no sim: consumível que o NPC vende, o NPC não recompra. */
const COMPRAVEIS_NPC = new Set(['heal', 'revive']);
const precoDeVendaPorNome = (nome) => {
  if (itemMortoPorNome(nome)) return 0;
  const item = itensPorNome.get(String(nome ?? '').toLowerCase());
  if (!item || COMPRAVEIS_NPC.has(item.category) || ehPedraEvolucao(item)) return 0;
  return item.npcPrice ?? 0;
};
export const ESPECIES_REEQUILIBRADAS = aplicarEconomiaDrop([...especies.values()], precoDeVendaPorNome);

/** Os itens de um tipo — o que o filtro da vitrine vira, já que anúncio guarda `item_id`. */
export function itensDoTipo(tipo) {
  const t = String(tipo).toUpperCase();
  return [...TIPO_DO_ITEM].filter(([, v]) => v === t).map(([id]) => id);
}

/** Os itens de uma categoria (stone, tm, …). Mesmo papel do `itensDoTipo`. */
export function itensDaCategoria(categoria) {
  if (categoria === 'boss') return itemsRaw.filter(ehBossToken).map((i) => i.id);
  if (categoria === 'stone') return itemsRaw.filter(ehPedraMercado).map((i) => i.id);
  if (categoria === 'beast') return [BEAST_BALL.id];
  if (categoria === 'fragment') return [...FRAGMENTOS_MERCADO];
  if (categoria === 'mega') return itemsRaw.filter((i) => ehMegaStone(i.id)).map((i) => i.id);
  if (categoria === 'tm') {
    return [
      ...itemsRaw.filter((i) => i.category === 'tm').map((i) => i.id),
      ...PECAS_TM_MERCADO,
    ];
  }
  // A vitrine fala em `box`, mas o catálogo grava `caixa` — mesma regra de `categoriaMercado`.
  if (categoria === 'box') return itemsRaw.filter((i) => ehItemCaixaBeta(i.id)).map((i) => i.id);
  if (categoria === 'casa') return itemsRaw.filter((i) => ehItemCasa(i.id)).map((i) => i.id);
  if (categoria === 'bicicleta') return itemsRaw.filter((i) => ehItemBicicleta(i.id)).map((i) => i.id);
  return itemsRaw.filter((i) => i.category === categoria).map((i) => i.id);
}

// ------------------------------------------------- o que a vitrine aceita
//
// O mercado da comunidade deixou de ser "tudo que o NPC compra". Drop de pokémon saiu:
// eram centenas de itens de mil moedas que enterravam o que a pessoa foi procurar. Ficam
// três famílias, e o filtro da tela tem exatamente uma aba para cada:
//
//   pedra — as que EVOLUEM alguém, que é o que dá valor a elas
//   tm    — discos de golpe e peças de boss (TM Disk Piece / AoE TM Disk Piece)
//   boss  — as fichas de boss, que não têm preço de NPC e quem precifica é a comunidade
//   beast — a Beast Ball (loja com diamante; revenda só entre jogadores)
//
// `Rough Gemstone` está na categoria `stone` mas é sucata de drop de pokémon de pedra:
// não evolui nada e não entra. A `Crystal Stone` também não evolui nada HOJE, mas fica — é
// pedra de verdade no imaginário do jogador, e a decisão foi mantê-la negociável. A `Moon
// Stone` saiu do jogo inteiro (ver `ITENS_MORTOS` em `shared/venda-npc-item.mjs`).
const ehPedraMercado = (i) => ehPedraEvolucao(i) && !ehMegaStone(i.id);

const FRAGMENTOS_MERCADO = new Set([
  FRAGMENTO_CHAVE_ID, FRAGMENTO_SHINY_ID, FRAGMENTO_BICICLETA_ID,
  FRAGMENTO_MEGA_ID, FRAGMENTO_MEGA_SHINY_ID,
]);

const ehFragmentoMercado = (i) => FRAGMENTOS_MERCADO.has(i.id);

/** Peças de TM (drop de boss) — ids do espelho; constantes espelhadas em `game/tm.mjs`. */
const PECA_TM_ELEMENTAL_ID = 59194;
const PECA_TM_AOE_ID = 40530;
const PECAS_TM_MERCADO = new Set([PECA_TM_ELEMENTAL_ID, PECA_TM_AOE_ID]);
const ehPecaTmMercado = (i) => PECAS_TM_MERCADO.has(i.id);

/**
 * A Exp. Share saiu da vitrine — e o predicado fica, do lado de FORA de `ITENS_MERCADO`, para
 * barrar em vez de deixar entrar.
 *
 * Ela é o único item cuja unidade mora em duas tabelas (bolsa e `held_item_id` do pokémon), e
 * é aí que ela duplica. Enquanto negociável, uma cópia falsa se dissolvia na comunidade: virava
 * ouro de um e item de outro, e desfazer exigiria desfazer negócio de quem não fez nada de
 * errado. Fechada na conta que comprou, cada jogador se explica sozinho — `bolsa + equipadas ==
 * xp_share_total` — e a correção nunca passa de uma conta. Ver `shared/xp-share-held.mjs`.
 */
const ehXpShareHeldMercado = (i) => i.id === XP_SHARE_HELD_ID;

// Casa pelo NOME e não pelo id porque a ficha de boss mora na categoria `loot` (o catálogo
// do espelho não tem categoria própria para ela) e porque as de prata/ouro, quando vierem,
// entram sozinhas. `bosses.mjs` importa daqui, então importar o id de lá faria ciclo.
const ehBossToken = (i) => /boss token$/i.test(i.name);

/**
 * Ids que podem ir à vitrine da comunidade.
 *
 * A CASA entra: é o item mais caro do jogo e a razão de ele ser um item era exatamente poder
 * ser vendido entre jogadores (ver `shared/casas.mjs`).
 *
 * `ITENS_FORA_DO_MERCADO` sai por último e por cima de tudo — hoje só a Escape Rope.
 */
export const ITENS_MERCADO = new Set(
  itemsRaw
    .filter((i) => ehPedraMercado(i) || ehMegaStone(i.id) || ehFragmentoMercado(i) || ehPecaTmMercado(i) || i.category === 'tm' || ehBossToken(i) || ehItemCasa(i.id) || ehItemBicicleta(i.id) || ehItemCaixaBeta(i.id))
    .map((i) => i.id)
    .filter((id) => !ITENS_FORA_DO_MERCADO.has(id) && id !== BEAST_BALL.id && id !== XP_SHARE_HELD_ID),
);

/** Inclui Beast Ball — id 5 colide com Band Aid; a bola anuncia por caminho separado (`m.bola`). */
export const IDS_MERCADO_PERMITIDOS = new Set([...ITENS_MERCADO, BEAST_BALL.id]);

/** Band Aid (id 5) não é negociável — o id é compartilhado com a Beast Ball. */
export const ehBandAid = (item) => item?.id === BEAST_BALL.id && item?.category === 'loot';

export const itemAnunciavelMercado = (item) => !!item && !ehBandAid(item) && ITENS_MERCADO.has(item.id);

/** A aba da vitrine em que o item cai — `null` se ele não é negociável. */
export function categoriaMercado(item) {
  if (!item?.id) return null;
  if (ehBandAid(item)) return null;
  if (item.id === BEAST_BALL.id) return 'beast';
  if (!ITENS_MERCADO.has(item.id)) return null;
  if (ehItemCaixaBeta(item.id)) return 'box';
  if (ehItemCasa(item.id)) return 'casa';
  if (ehItemBicicleta(item.id)) return 'bicicleta';
  if (ehFragmentoMercado(item)) return 'fragment';
  // As 63 Mega Stones saem da aba Pedras e têm a delas. São mais itens do que as 21 pedras de
  // evolução somadas: misturadas, a aba Pedras virava uma lista de 84 linhas em que a Water
  // Stone de todo dia ficava enterrada entre trinta e duas pedras de mega. Ver `shared/megas.mjs`.
  if (ehMegaStone(item.id)) return 'mega';
  if (ehBossToken(item)) return 'boss';
  if (ehPecaTmMercado(item) || item.category === 'tm') return 'tm';
  return 'stone';
}

/**
 * As abas de item da vitrine, na ordem em que aparecem.
 *
 * `box` (as Caixas de Fundador) abre a lista porque é a única aba em que cada anúncio é uma
 * PEÇA — o `#01` e o `#37` não se somam nem se substituem —, e porque é a mais cara do
 * mercado. Ver `shared/caixas-beta.mjs`.
 */
// `held` saiu: a Exp. Share deixou de ser negociável (ver `ehXpShareHeldMercado` acima). Era a
// única moradora da aba, então a aba foi junto — no servidor e na tela.
export const CATEGORIAS_MERCADO = ['box', 'casa', 'bicicleta', 'fragment', 'mega', 'stone', 'tm', 'boss', 'beast'];

/** Catálogo enxuto que a vitrine desenha, mesmo para item que ninguém está vendendo. */
export const CATALOGO_MERCADO = [
  ...itemsRaw
    .filter((i) => ITENS_MERCADO.has(i.id) && i.id !== BEAST_BALL.id)
    .map((i) => ({
      id: i.id,
      nome: i.name,
      icone: i.icon ?? null,
      categoria: categoriaMercado(i),
      tipo: TIPO_DO_ITEM.get(i.id) ?? null,
      npc: i.npcPrice ?? 0,
    })),
  {
    id: BEAST_BALL.id,
    nome: BEAST_BALL.nome,
    icone: BEAST_BALL.icone,
    categoria: 'beast',
    tipo: null,
    npc: 0,
  },
].sort((a, b) => CATEGORIAS_MERCADO.indexOf(a.categoria) - CATEGORIAS_MERCADO.indexOf(b.categoria)
  // Dentro da aba de CASAS a ordem é a da raridade, não a alfabética: os ids do bloco já são
  // crescentes por raridade (ver `CASA_POR_RARIDADE`), então ordenar por id dá Comum → Lendária.
  // Em ordem alfabética a vitrine abriria com "Common, Legendary, Mythic, Rare, Uncommon", que
  // não diz nada sobre qual casa é melhor — e é a única coisa que importa nessa aba.
  //
  // As CAIXAS seguem a mesma lógica e pela mesma razão: por id vem Fundador (50 no mundo) antes
  // de CoFundador (100); em ordem alfabética "Co-Founder Box" abriria a aba, pondo a menos rara
  // na frente só porque o hífen vem antes do F.
  // As BICICLETAS também: o bloco 70080…70084 é crescente por raridade.
  || (a.categoria === 'casa' || a.categoria === 'bicicleta' || a.categoria === 'box'
    ? a.id - b.id
    : a.nome.localeCompare(b.nome)));

/** As espécies de um tipo — o filtro de tipo da aba Pokémon casa contra `ficha.speciesId`. */
export function especiesDoTipo(tipo) {
  const t = String(tipo).toUpperCase();
  return creatures.filter((c) => c.type1 === t || c.type2 === t).map((c) => c.pokeId);
}

// -------------------------------------------------------------- evolução
//
// Evoluir exige nível (`evolveLevel`) E uma pedra do tipo primário da espécie. O catálogo não
// traz `evolveStoneId` — `PEDRA_POR_TIPO` fecha o buraco com os nomes reais de `items.json`.
//
// O mapa mora em `shared/pedras-evolucao.mjs` porque o gerador de drops
// (`tools/povoar-loot-regioes.mjs`) precisa exatamente do mesmo: a pedra que a hunt solta tem
// de ser a pedra que a evolução cobra, e duas cópias divergindo é como o Combee acabou soltando
// Rock e Metal Stone sem soltar a Cocoon Stone de que ele precisa.
const NOME_PEDRA_POR_TIPO = PEDRA_POR_TIPO;

/** tipo → { itemId, nome } — vai no welcome para a tela montar o modal sem adivinhar. */
export const PEDRA_EVOLUCAO_POR_TIPO = Object.fromEntries(
  Object.entries(NOME_PEDRA_POR_TIPO)
    .map(([tipo, nome]) => {
      const item = itensPorNome.get(nome.toLowerCase());
      return item ? [tipo, { itemId: item.id, nome: item.name }] : null;
    })
    .filter(Boolean),
);

/**
 * Qual pedra uma espécie precisa para evoluir. `null` se não evolui.
 *
 * `destino` só muda a conta nas cadeias que abrem em mais de um caminho, onde a pedra passa a
 * ser a do que ele VAI VIRAR — ver `tipoDaPedraDeEvolucao`. Sem ele, vale o tipo da base, que é
 * o que as outras quatrocentas cadeias sempre usaram.
 */
export function pedraDeEvolucao(especie, destino = null) {
  if (!especie?.evolvesToId) return null;
  const tipo = tipoDaPedraDeEvolucao(especie, destino);
  return PEDRA_EVOLUCAO_POR_TIPO[tipo] ?? PEDRA_EVOLUCAO_POR_TIPO.NORMAL ?? null;
}

/**
 * A pedra que REFINA uma espécie — a mesma que ela usa para evoluir, quando evolui.
 *
 * A diferença para `pedraDeEvolucao` é uma só, e é a razão desta função existir: aqui não se
 * exige `evolvesToId`. Metade dos pokémon que alguém refinaria de verdade é forma final
 * (Dragonite, Blissey, Tyranitar) e não evolui para lugar nenhum — se o refino herdasse a
 * regra da evolução, justamente eles ficariam de fora do sistema inteiro. Vale o tipo do
 * PRÓPRIO bicho: Dragonite é DRAGON, então refina com Ancient Stone.
 *
 * Sem `destino`, `tipoDaPedraDeEvolucao` cai no tipo primário (respeitando as exceções escritas
 * à mão, como o Pidgey → Feather Stone). Um Eevee, portanto, refina com Sun Stone — a pedra
 * DELE, não a de uma eeveelution que ele ainda não é.
 *
 * **Dual-type:** qualquer pedra dos tipos elementares do bicho vale, e os saldos somam —
 * Charizard Fire/Flying aceita Fire Stone, Feather Stone ou uma mistura dos dois.
 *
 * **Shiny refina com a pedra comum, não com a Shiny Stone.** Seria coerente pedir a shiny (é o
 * que a evolução faz), e seria o fim do sistema para shinys: a Shiny Stone custa 10 fragmentos
 * que caem a 0,0005% na Outland, então um único degrau de 500 pedras pediria 5.000 fragmentos.
 * O refino não é evolução — não troca a espécie nem arrisca a arte —, então não herda o preço
 * dela.
 */
export function pedraDeRefino(especie) {
  const pedras = pedrasDeRefino(especie);
  return pedras[0] ?? null;
}

/** Todas as pedras válidas para refinar esta espécie (dual-type inclui as duas). */
export function pedrasDeRefino(especie) {
  if (!especie) return [];
  return pedrasRefinoResolvidas(especie, PEDRA_EVOLUCAO_POR_TIPO);
}

/** Tipos/nomes — útil para testes e ferramentas sem carregar itemId. */
export { nomesPedraRefino };

console.log(
  `[content] ${especies.size} espécies · ${huntsJogaveis.length} hunts jogáveis · ` +
    `${itens.size} itens (${TIPO_DO_ITEM.size} com tipo) · ${catalogoShiny.size} formas shiny · ` +
    `${bolas.length} bolas · ${Object.keys(moves.efeitos).length} efeitos · ` +
    `${Object.keys(grades).length} grades de caminhada`,
);

if (!walkgrids) {
  console.error(
    '[content] world/walkgrids.json NÃO EXISTE — sem ele nenhuma hunt é jogável, porque não\n' +
      '          há área andável para o herói e os selvagens. Rode, no sprite-lab:\n' +
      '            node tools/build-walkgrids.mjs   (precisa dos mapas: npm run fetch:maps)',
  );
} else if (!centroPokemon) {
  // Sem a praça, o jogador que perde o time não tem para onde ir e fica preso numa hunt
  // com o pokémon no chão.
  console.error(
    '[content] a área "centro" não está no walkgrids.json — o Centro Pokémon fica indisponível\n' +
      '          e quem for nocauteado não terá para onde ir. Regere a grade no sprite-lab:\n' +
      '            node tools/build-walkgrids.mjs',
  );
}
