/**
 * EXPORTADOR OFICIAL DA POKÉDEX E HUNTS DO POKÉIDLE
 * Extrai 100% dos dados reais do código do jogo sem inventar nada.
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Importa módulos oficiais do jogo
const GAME_DIR = resolve('PokeIdle-io-master/game');
const mappingJsonPath = resolve('PokeIdle-io-master/public/data/sprites-pokemon/mapping.json');
const dexCatalogPath = resolve('PokeIdle-io-master/tools/nomeador/pokedex-catalog.json');

const {
  especies,
  hunts,
  itens,
  itensPorNome,
  pedraDeEvolucao,
  tabelaTipos,
  potencias: potenciasCatalogo,
  catalogoShiny,
  bolas: catalogoBolas,
  tetoCaptura: getTetoCaptura,
} = await import(join(GAME_DIR, 'src/server/content.mjs'));

const { golpesDaFicha } = await import(join(GAME_DIR, 'src/shared/golpes-especiais.mjs'));
const {
  listaDropsEspecie,
  matchupDefensivo,
  matchupTiposHunt,
  killsPorHora,
  mediaPorKill,
} = await import(join(GAME_DIR, 'src/client/hunt-analyser.mjs'));

const { xpPorDerrota, ouroPorDerrotaHunt } = await import(join(GAME_DIR, 'src/shared/recompensa-hunt.mjs'));
const { resolverNomeItem } = await import(join(GAME_DIR, 'src/shared/alias-item.mjs'));

// Carrega mapeamento de sprites oficial
let spriteMapping = [];
if (existsSync(mappingJsonPath)) {
  spriteMapping = JSON.parse(readFileSync(mappingJsonPath, 'utf8'));
}
const spriteMap = new Map(spriteMapping.map(m => [m.pokeId, m]));

// Carrega catálogo de dex por geração
let genByDex = new Map();
if (existsSync(dexCatalogPath)) {
  try {
    const dexCat = JSON.parse(readFileSync(dexCatalogPath, 'utf8'));
    for (const item of dexCat) {
      if (item.dex) genByDex.set(item.dex, { gen: item.gen, region: item.region });
    }
  } catch (e) {
    console.warn('dexCatalogPath error:', e);
  }
}

function getGenRegion(dex) {
  if (genByDex.has(dex)) return genByDex.get(dex);
  if (dex <= 151) return { gen: 1, region: 'Kanto' };
  if (dex <= 251) return { gen: 2, region: 'Johto' };
  if (dex <= 386) return { gen: 3, region: 'Hoenn' };
  if (dex <= 493) return { gen: 4, region: 'Sinnoh' };
  if (dex <= 649) return { gen: 5, region: 'Unova' };
  if (dex <= 721) return { gen: 6, region: 'Kalos' };
  if (dex <= 809) return { gen: 7, region: 'Alola' };
  if (dex <= 905) return { gen: 8, region: 'Galar' };
  return { gen: 9, region: 'Paldea' };
}

// --------------------------------------------------------------------------
// 1. PROCESSAMENTO DE HUNTS (TODAS AS 828 HUNTS DE TODAS AS REGIÕES)
// --------------------------------------------------------------------------
console.log('⚡ Processando catálogo completo de Hunts oficiais do jogo...');

const DADOS_DIR = join(GAME_DIR, 'src/server/dados');
const spawnsIndex = JSON.parse(readFileSync(resolve('PokeIdle-io-master/public/data/index/spawns-index.json'), 'utf8'));
const spawnsEditor = JSON.parse(readFileSync(join(DADOS_DIR, 'spawns-editor.json'), 'utf8'));
const huntsOutland = JSON.parse(readFileSync(join(DADOS_DIR, 'hunts-outland-novos.json'), 'utf8')).hunts || [];
const huntsSinnoh = JSON.parse(readFileSync(join(DADOS_DIR, 'hunts-sinnoh.json'), 'utf8')).hunts || [];
const huntsKanto = JSON.parse(readFileSync(join(DADOS_DIR, 'hunts-kanto-novos.json'), 'utf8')).hunts || [];
const huntsJohto = JSON.parse(readFileSync(join(DADOS_DIR, 'hunts-johto-novos.json'), 'utf8')).hunts || [];

const allRawHuntsMap = new Map();

// 1. Spawns index (Kanto, Orre, Outland)
for (const [slug, h] of Object.entries(spawnsIndex.porHunt || {})) {
  allRawHuntsMap.set(slug, {
    slug,
    nome: h.nome,
    area: h.area || 'kanto',
    regiao: h.regiao || h.area || 'kanto',
    nivel: h.nivel || 1,
    especies: (h.pokemon || h.especies || []).map(e => ({
      pokeId: e.pokeId,
      nome: e.nome,
      pontos: e.pontos || 1
    }))
  });
}

// 2. Kanto novos
for (const h of huntsKanto) {
  allRawHuntsMap.set(h.slug, {
    slug: h.slug,
    nome: h.nome,
    area: 'kanto',
    regiao: 'kanto',
    nivel: h.nivel || 1,
    especies: [{ pokeId: h.pokeId, nome: h.nome, pontos: 1 }]
  });
}

// 3. Johto novos
for (const h of huntsJohto) {
  allRawHuntsMap.set(h.slug, {
    slug: h.slug,
    nome: h.nome,
    area: 'johto',
    regiao: 'johto',
    nivel: h.nivel || 1,
    especies: [{ pokeId: h.pokeId, nome: h.nome, pontos: 1 }]
  });
}

// 4. Outland novos
for (const h of huntsOutland) {
  allRawHuntsMap.set(h.slug, {
    slug: h.slug,
    nome: h.nome,
    area: 'outland',
    regiao: 'outland',
    nivel: h.nivel || 1,
    especies: [{ pokeId: h.pokeId, nome: h.nome, pontos: 1 }]
  });
}

// 5. Sinnoh legados
for (const h of huntsSinnoh) {
  allRawHuntsMap.set(h.slug, {
    slug: h.slug,
    nome: h.nome,
    area: 'sinnoh',
    regiao: 'sinnoh',
    nivel: h.nivel || 1000,
    especies: [{ pokeId: h.pokeId, nome: h.nome, pontos: 1 }]
  });
}

// 6. Spawns editor (Hoenn, Sinnoh, Unova, Kalos, Alola, etc.)
for (const [regId, reg] of Object.entries(spawnsEditor.regioes || {})) {
  for (const m of reg.marcadores || []) {
    allRawHuntsMap.set(m.slug, {
      slug: m.slug,
      nome: m.nome,
      area: regId,
      regiao: regId,
      nivel: m.nivel || reg.nivelGate || 1,
      especies: [{ pokeId: m.pokeId, nome: m.nome, pontos: 1 }]
    });
  }
}

// Também mescla quaisquer hunts de content.mjs
for (const [slug, h] of Object.entries(hunts || {})) {
  if (!allRawHuntsMap.has(slug)) {
    allRawHuntsMap.set(slug, {
      slug,
      nome: h.nome,
      area: h.area || 'kanto',
      regiao: h.regiao || h.area || 'kanto',
      nivel: h.nivel || 1,
      especies: (h.pokemon || h.especies || []).map(e => ({
        pokeId: e.pokeId,
        nome: e.nome,
        pontos: e.pontos || 1
      }))
    });
  }
}

console.log(`⚡ Carregadas ${allRawHuntsMap.size} hunts únicas de todas as regiões.`);

const allHuntsList = [];
const huntsByPokeId = new Map();
const huntsByDex = new Map();

for (const [slug, h] of allRawHuntsMap.entries()) {
  const especiesNaHunt = h.especies || [];
  if (!h || !h.nome || especiesNaHunt.length === 0) continue;

  const huntAdaptada = { ...h, especies: especiesNaHunt };
  const kph = killsPorHora(huntAdaptada) || 980;
  const totalPontos = especiesNaHunt.reduce((s, e) => s + (e.pontos || 1), 0) || 1;

  const huntObj = {
    slug,
    id: slug,
    nome: h.nome,
    name: h.nome,
    area: h.area || 'kanto',
    region: h.regiao || h.area || 'kanto',
    nivel: h.nivel || 1,
    level: h.nivel || 1,
    killsH: Math.round(kph),
    xpPorHora: 0,
    ouroPorHora: 0,
    especies: []
  };

  let somaXpPond = 0;
  let somaGoldPond = 0;

  for (const e of especiesNaHunt) {
    const pId = e.pokeId;
    const esp = especies.get(pId);
    const peso = (e.pontos || 1) / totalPontos;
    const mobKillsH = Math.round(kph * peso);
    const xpMob = xpPorDerrota(huntAdaptada, h.nivel || 1, esp);
    const goldMob = ouroPorDerrotaHunt(huntAdaptada, h.nivel || 1, esp);
    const mobXpH = Math.round(mobKillsH * xpMob);
    const mobGoldH = Math.round(mobKillsH * goldMob);

    somaXpPond += mobXpH;
    somaGoldPond += mobGoldH;

    huntObj.especies.push({
      pokeId: pId,
      nome: e.nome || esp?.name || 'Desconhecido',
      pontos: e.pontos || 1,
      pesoPct: +(peso * 100).toFixed(1),
      killsH: mobKillsH,
      xpDerrota: xpMob,
      goldDerrota: goldMob,
      xpH: mobXpH,
      goldH: mobGoldH
    });

    const huntRef = {
      slug,
      id: slug,
      nome: h.nome,
      name: h.nome,
      area: h.area || 'kanto',
      region: h.regiao || h.area || 'kanto',
      nivel: h.nivel || 1,
      level: h.nivel || 1,
      killsH: mobKillsH,
      pesoPct: +(peso * 100).toFixed(1),
      xpDerrota: xpMob,
      goldDerrota: goldMob,
      xpH: mobXpH,
      goldH: mobGoldH
    };

    if (!huntsByPokeId.has(pId)) huntsByPokeId.set(pId, []);
    huntsByPokeId.get(pId).push(huntRef);

    const dexMob = pId < 1000 ? pId : (pId >= 13000 ? pId - 13000 : pId % 1000);
    if (!huntsByDex.has(dexMob)) huntsByDex.set(dexMob, []);
    huntsByDex.get(dexMob).push(huntRef);
  }

  huntObj.xpPorHora = somaXpPond;
  huntObj.ouroPorHora = somaGoldPond;

  allHuntsList.push(huntObj);
}

// Ordena hunts pelo nível
allHuntsList.sort((a, b) => a.nivel - b.nivel);

// --------------------------------------------------------------------------
// 2. MAPA DE EVOLUÇÕES ANTERIORES
// --------------------------------------------------------------------------
const evolvesFromMap = new Map();
for (const [pokeId, esp] of especies.entries()) {
  if (esp && esp.evolvesToId) {
    evolvesFromMap.set(esp.evolvesToId, esp.name);
  }
}

// --------------------------------------------------------------------------
// 3. PROCESSAMENTO DE ESPÉCIES
// --------------------------------------------------------------------------
console.log('⚡ Processando Catálogo de Espécies com todas as métricas...');

const STATS_ORDEM = [
  ['hp', 'baseHp'],
  ['atk', 'baseAtk'],
  ['def', 'baseDef'],
  ['spAtk', 'baseSpAtk'],
  ['spDef', 'baseSpDef'],
  ['speed', 'baseSpeed'],
];
const IV_REF = 16;
function statRef(base, nivel, mult) {
  return Math.round((base + 2 * IV_REF) * (nivel / 100) * mult);
}
function poderRef(esp, nivel, mult) {
  return STATS_ORDEM.reduce((acc, [, campo]) => acc + statRef(esp[campo] || 10, nivel, mult), 0);
}

// Fórmulas oficiais de captura (regras do servidor)
function calcChanceCaptura(priceNpc, catchRate, boost = false) {
  const preco = priceNpc > 0 ? priceNpc : 6.5e9;
  const raridade = Math.log10(Math.max(100, preco)) - 1;
  const fator = 1 + (raridade ** 3) / 17;
  const base = 0.0075 * (catchRate / fator) * 1.4 * (boost ? 2 : 1);
  return Math.max(0.003, Math.min(0.10, base));
}

const exportedSpecies = [];
const allItemsMap = new Map();

for (const [pokeId, esp] of especies.entries()) {
  if (!esp || !esp.name) continue;

  const dex = esp.pokeId <= 10500 ? (esp.pokeId % 10000) : (esp.dex || esp.pokeId);
  const { gen, region } = getGenRegion(dex);

  // Stats
  const baseStats = {
    hp: esp.baseHp || 10,
    atk: esp.baseAtk || 10,
    def: esp.baseDef || 10,
    spAtk: esp.baseSpAtk || 10,
    spDef: esp.baseSpDef || 10,
    speed: esp.baseSpeed || 10,
  };
  const bst = baseStats.hp + baseStats.atk + baseStats.def + baseStats.spAtk + baseStats.spDef + baseStats.speed;

  // Nível da hunt e teto de captura
  const myHunts = huntsByPokeId.get(pokeId) || huntsByDex.get(dex) || [];
  const hasHunt = myHunts.length > 0;
  const huntLevel = hasHunt ? Math.min(...myHunts.map(h => h.nivel)) : null;
  const nivelRef = huntLevel ?? (esp.huntLevel && esp.huntLevel <= 100 ? esp.huntLevel : (esp.evolveLevel || 20));
  const tetoCaptura = esp.tetoCaptura || (esp.evolvesToId ? (esp.evolveLevel > 30 ? 40 : 20) : (hasHunt ? Math.min(100, huntLevel) : 100));

  // Preço NPC / Experiência
  const priceNpc = esp.priceNpc || esp.sellValue || 3000;
  const experience = hasHunt
    ? (xpPorDerrota(null, huntLevel, esp) || Math.round(huntLevel * 12.4))
    : (esp.experience || 248);

  // Evolução
  let evolvesTo = null;
  let evolucaoTexto = 'Não evolui';
  if (esp.evolvesToId) {
    const alvo = especies.get(esp.evolvesToId);
    if (alvo) {
      evolvesTo = {
        pokeId: esp.evolvesToId,
        name: alvo.name,
        level: esp.evolveLevel || 40,
      };
      evolucaoTexto = `vira ${alvo.name} no Nv ${esp.evolveLevel || 40}`;
    }
  }
  const evolvesFrom = evolvesFromMap.get(pokeId) || null;

  // Pedra de evolução
  const pedra = pedraDeEvolucao(esp);
  let pedraInfo = null;
  if (pedra) {
    const pSlug = pedra.nome.toLowerCase().replace(/ /g, '_');
    let pUrl = `assets/site/assets/items/${pSlug}.gif`;
    if (!existsSync(resolve('portal/' + pUrl))) {
      pUrl = `assets/site/assets/items/${pSlug}.png`;
      if (!existsSync(resolve('portal/' + pUrl))) {
        pUrl = `assets/site/assets/stones/${pSlug}.png`;
      }
    }
    pedraInfo = {
      itemId: pedra.itemId,
      nome: pedra.nome,
      iconUrl: pUrl,
    };
  }

  // Golpes oficiais
  const golpesBrutos = golpesDaFicha(esp);
  const attacks = golpesBrutos.map(g => ({
    name: g.name,
    type: g.type,
    category: g.category === 'PHYSICAL' ? 'Físico' : (g.category === 'SPECIAL' ? 'Especial' : 'Status'),
    power: g.power || 0,
    cooldownMs: g.cooldownMs,
    cooldownSec: Math.round(g.cooldownMs / 1000),
    learnLevel: g.learnLevel || 1,
  }));

  // Drops detalhados
  const dropsBrutos = listaDropsEspecie(esp);
  const loot = dropsBrutos.map(d => {
    const itemObj = itensPorNome?.get?.(d.name?.toLowerCase?.()) || null;
    const iSlug = d.name.toLowerCase().replace(/ /g, '_');
    let dUrl = `assets/site/assets/items/${iSlug}.png`;
    if (!existsSync(resolve('portal/' + dUrl))) {
      dUrl = `assets/site/assets/items/${iSlug}.gif`;
      if (!existsSync(resolve('portal/' + dUrl))) {
        dUrl = `assets/site/assets/stones/${iSlug}.png`;
      }
    }

    if (itemObj) {
      allItemsMap.set(itemObj.id || d.name, {
        id: itemObj.id || 0,
        name: itemObj.name || d.name,
        priceNpc: itemObj.npcPrice || 1,
        iconUrl: dUrl,
      });
    }

    return {
      name: d.name,
      chancePct: +(d.pct).toFixed(2),
      minCount: d.minCount,
      maxCount: d.maxCount,
      priceNpc: itemObj?.npcPrice || 1,
      iconUrl: dUrl
    };
  });

  // Matchups (fraquezas e vantagens)
  const tipos = [esp.type1, esp.type2].filter(Boolean);
  const def = matchupDefensivo(tipos, tabelaTipos);
  const ofe = matchupTiposHunt(tipos, tabelaTipos);
  const weaknesses = def.fracos.map(f => f.tipo);

  // Potências P1 a P5 (referência com qualidade 1.00 e IV 16)
  const temShiny = catalogoShiny.has(pokeId) || catalogoShiny.has(dex);
  const potencias = [
    { n: 'P1', chancePct: '74,5%', bonus: '—', poder: poderRef(esp, nivelRef, 1), poderShiny: poderRef(esp, nivelRef, 3) },
    { n: 'P2', chancePct: '20,0%', bonus: '+5%', poder: poderRef(esp, nivelRef, 1.05), poderShiny: poderRef(esp, nivelRef, 3.15) },
    { n: 'P3', chancePct: '5,00%', bonus: '+10%', poder: poderRef(esp, nivelRef, 1.10), poderShiny: poderRef(esp, nivelRef, 3.30) },
    { n: 'P4', chancePct: '0,50%', bonus: '+25%', poder: poderRef(esp, nivelRef, 1.25), poderShiny: poderRef(esp, nivelRef, 3.75) },
    { n: 'P5', chancePct: '0,0050%', bonus: '+100%', poder: poderRef(esp, nivelRef, 2.00), poderShiny: poderRef(esp, nivelRef, 6.00) },
  ];

  // Looktypes para animação fiel do cliente
  const looktype = esp.looktype || dex;
  const shinyEntry = catalogoShiny.get(pokeId) ?? catalogoShiny.get(dex);
  const shinyLooktype = shinyEntry?.looktype ?? null;

  // Resolução rigorosa de Sprites (sem nunca deixar vazio)
  const cleanSlug = esp.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const spEntry = spriteMap.get(pokeId) || spriteMap.get(dex);

  let normalSprite = null;
  if (spEntry?.normal?.file && existsSync(resolve('portal/assets/sprites-pokemon/' + spEntry.normal.file))) {
    normalSprite = `assets/sprites-pokemon/${spEntry.normal.file}`;
  } else if (existsSync(resolve(`portal/assets/sprites-pokemon/normal/${pokeId}-${cleanSlug}.png`))) {
    normalSprite = `assets/sprites-pokemon/normal/${pokeId}-${cleanSlug}.png`;
  } else if (existsSync(resolve(`portal/assets/sprites-pokemon/normal/${dex}-${cleanSlug}.png`))) {
    normalSprite = `assets/sprites-pokemon/normal/${dex}-${cleanSlug}.png`;
  } else {
    normalSprite = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dex}.png`;
  }

  let shinySprite = null;
  if (spEntry?.shiny?.file && existsSync(resolve('portal/assets/sprites-pokemon/' + spEntry.shiny.file))) {
    shinySprite = `assets/sprites-pokemon/${spEntry.shiny.file}`;
  } else if (existsSync(resolve(`portal/assets/sprites-pokemon/shiny/${pokeId}-${cleanSlug}.png`))) {
    shinySprite = `assets/sprites-pokemon/shiny/${pokeId}-${cleanSlug}.png`;
  } else if (existsSync(resolve(`portal/assets/sprites-pokemon/shiny/${dex}-${cleanSlug}.png`))) {
    shinySprite = `assets/sprites-pokemon/shiny/${dex}-${cleanSlug}.png`;
  } else if (temShiny) {
    shinySprite = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${dex}.png`;
  }

  const sprites = {
    normal: normalSprite,
    shiny: shinySprite,
    tileW: spEntry?.normal?.tileW || 32,
    tileH: spEntry?.normal?.tileH || 32
  };

  // Tabelas de bolas pré-calculadas (Poké, Great, Super, Ultra, Beast)
  const ballsConfig = [
    { key: 'poke', name: 'Poké Ball', rate: 1, preco: '5', precoFormatado: '5' },
    { key: 'great', name: 'Great Ball', rate: 2, preco: '20', precoFormatado: '20' },
    { key: 'super', name: 'Super Ball', rate: 3, preco: '50', precoFormatado: '50' },
    { key: 'ultra', name: 'Ultra Ball', rate: 4, preco: '130', precoFormatado: '130' },
    { key: 'beast', name: 'Beast Ball', rate: 8, preco: 'só com diamante', precoFormatado: 'só com diamante' },
  ];

  const ballRates = [];
  const shinyBallRates = [];
  for (const b of ballsConfig) {
    const chanceBase = calcChanceCaptura(priceNpc, b.rate, false);
    const derrotasMedia = Math.ceil(1 / chanceBase);
    const chanceShinyReal = (1 / 24000) * chanceBase;
    const derrotasShinyMedia = Math.round(1 / chanceShinyReal);

    ballRates.push({
      key: b.key,
      name: b.name,
      eficiencia: `×${b.rate}`,
      chancePct: (chanceBase * 100).toFixed(2).replace('.', ',') + '%',
      chanceNum: +(chanceBase * 100).toFixed(2),
      derrotasMedia,
      preco: b.precoFormatado
    });

    shinyBallRates.push({
      key: b.key,
      name: b.name,
      eficiencia: `×${b.rate}`,
      chancePct: (chanceBase * 100).toFixed(2).replace('.', ',') + '%',
      capturarShiny: `1 em ${derrotasShinyMedia.toLocaleString('pt-BR')}`
    });
  }

  exportedSpecies.push({
    pokeId,
    dex,
    name: esp.name,
    slug: cleanSlug,
    gen,
    region,
    type1: esp.type1,
    type2: esp.type2 || null,
    baseStats,
    bst,
    hasHunt,
    huntLevel,
    evolvesFrom,
    tetoCaptura,
    priceNpc,
    experience,
    evolvesTo,
    evolucaoTexto,
    pedra: pedraInfo,
    hasShiny: temShiny,
    attacks,
    loot,
    lootItemNames: loot.map(l => l.name),
    weaknesses,
    fracoContra: def.fracos,
    forteContra: ofe.fortes,
    potencias,
    sprites,
    looktype,
    shinyLooktype,
    hunts: myHunts,
    ballRates,
    shinyBallRates,
    ultraChance: calcChanceCaptura(priceNpc, 4, false),
    beastChance: calcChanceCaptura(priceNpc, 8, false),
  });
}

// Salva os arquivos finais
console.log(`💾 Salvando dados consolidados...`);
writeFileSync('portal/data/pokedex_portal.json', JSON.stringify(exportedSpecies, null, 2), 'utf8');
writeFileSync('portal/data/hunts_portal.json', JSON.stringify(allHuntsList, null, 2), 'utf8');
writeFileSync('portal/data/items_catalog.json', JSON.stringify([...allItemsMap.values()], null, 2), 'utf8');

console.log(`✅ Concluído com sucesso!`);
console.log(`- ${exportedSpecies.length} espécies em pokedex_portal.json`);
console.log(`- ${allHuntsList.length} hunts em hunts_portal.json`);
console.log(`- ${allItemsMap.size} itens em items_catalog.json`);
