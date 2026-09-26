// Cruza os catálogos baixados e gera os índices que o jogo não expõe prontos:
//
//   spawns-index.json   pokémon → em que hunts aparece (e quantos spawns em cada)
//                       hunt    → que pokémon aparecem ali
//   loot-index.json     item    → que pokémon dropam, com chance e quantidade
//                       + preço de venda no NPC, cruzado com items.json
//
// Roda offline, só lê public/data. Rode depois de fetch-poke-assets e fetch-world.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT } from './lib.mjs';
import { mesclarHuntConfigs } from './hunt-config-merge.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const ler = async (rel) => JSON.parse(await readFile(join(OUT, rel), 'utf8'));
const escrever = async (rel, dados) => {
  await mkdir(join(OUT, 'index'), { recursive: true });
  await writeFile(join(OUT, rel), JSON.stringify(dados));
  const kb = (JSON.stringify(dados).length / 1024).toFixed(0);
  console.log(`  ${rel.padEnd(28)} ${kb} KB`);
};

const { creatures } = await ler('creatures.json');
const creaturesNovos = JSON.parse(
  await readFile(join(RAIZ, 'game/src/server/dados/creatures-novos.json'), 'utf8'),
).creatures;
const todasCreatures = [...creatures, ...creaturesNovos];
const { items } = await ler('items.json');
const markers = await ler('world/map-markers.json');
const huntConfigsRaw = await ler('world/hunt-configs.json');
const huntConfigs = mesclarHuntConfigs(huntConfigsRaw);
const cityNpcs = await ler('world/city-npcs.json');

const porPokeId = new Map(todasCreatures.map((c) => [c.pokeId, c]));
const marcadorPorSlug = new Map(markers.hunts.map((h) => [h.slug, h]));

// ------------------------------------------------------------------ spawns

// hunt → { pokeId: quantidade de pontos de spawn }
const porHunt = {};
const porPokemon = {};

for (const [slug, cfg] of Object.entries(huntConfigs)) {
  const contagem = new Map();
  for (const s of cfg.spawns ?? []) contagem.set(s.pokeId, (contagem.get(s.pokeId) || 0) + 1);

  const m = marcadorPorSlug.get(slug);
  porHunt[slug] = {
    slug,
    nome: m?.name ?? slug,
    area: m?.area ?? null,
    pixel: m?.pixel ?? null, // posição do marcador no mapa-múndi
    range: m?.range ?? null, // [x1, y1, x2, y2, z] no mundo
    looktype: m?.looktype ?? null,
    nivel: m?.level ?? 0,
    start: cfg.start ?? null,
    catchChance: cfg.catchChance ?? null,
    totalSpawns: cfg.spawns?.length ?? 0,
    npcs: cityNpcs[slug] ?? [],
    pokemon: [...contagem]
      .map(([pokeId, pontos]) => ({ pokeId, nome: porPokeId.get(pokeId)?.name ?? `#${pokeId}`, pontos }))
      .sort((a, b) => b.pontos - a.pontos),
    // coordenadas cruas, para plotar sobre o mapa de tiles
    spawns: cfg.spawns ?? [],
  };

  for (const [pokeId, pontos] of contagem) {
    (porPokemon[pokeId] ??= []).push({ slug, nome: m?.name ?? slug, area: m?.area ?? null, pontos });
  }
}

for (const lista of Object.values(porPokemon)) lista.sort((a, b) => b.pontos - a.pontos);

const semSpawn = creatures.filter((c) => !porPokemon[c.pokeId]);
await escrever('index/spawns-index.json', {
  gerado: new Date().toISOString(),
  mapaMundi: markers.map,
  porHunt,
  porPokemon,
});

// -------------------------------------------------------------------- loot

// O loot em creatures.json traz o NOME do item; items.json tem preço e ícone.
const itemPorNome = new Map(items.map((i) => [i.name.toLowerCase(), i]));
const porItem = {};
const semCatalogo = new Set();

for (const c of todasCreatures) {
  for (const l of c.loot ?? []) {
    const cat = itemPorNome.get(l.name.toLowerCase());
    if (!cat) semCatalogo.add(l.name);
    const alvo = (porItem[l.name] ??= {
      nome: l.name,
      itemId: cat?.id ?? null,
      categoria: cat?.category ?? null,
      raro: cat?.rare ?? null,
      npcPrice: cat?.npcPrice ?? null,
      icone: cat?.icon ?? null,
      dropadoPor: [],
    });
    alvo.dropadoPor.push({
      pokeId: c.pokeId,
      nome: c.name,
      // chance é percentual × 1000 — a pokepedia deles faz chance/1e3 e exibe 71% para 71498
      chance: l.chance,
      chancePct: l.chance ? +(l.chance / 1000).toFixed(4) : 0,
      min: l.minCount,
      max: l.maxCount,
    });
  }
}

for (const it of Object.values(porItem)) it.dropadoPor.sort((a, b) => b.chance - a.chance);

// Itens do catálogo que ninguém dropa (loja, cards, TMs…)
for (const i of items) {
  if (!porItem[i.name]) {
    porItem[i.name] = {
      nome: i.name,
      itemId: i.id,
      categoria: i.category,
      raro: i.rare,
      npcPrice: i.npcPrice ?? null,
      icone: i.icon,
      dropadoPor: [],
    };
  }
}

await escrever('index/loot-index.json', {
  gerado: new Date().toISOString(),
  porItem,
  // preços dos próprios pokémon, que ficam em creatures.json e não em items.json
  precosPokemon: Object.fromEntries(
    todasCreatures.map((c) => [c.pokeId, { nome: c.name, priceNpc: c.priceNpc ?? null, sellValue: c.sellValue ?? null }]),
  ),
});

// ----------------------------------------------------------------- ataques

// creatures.json lista os ataques por pokémon; aqui invertemos para ataque → quem aprende.
// O efeito visual de cada golpe é escolhido pelo servidor no evento de batalha, então o que
// dá para cruzar offline é o TIPO do ataque → a folha daquele tipo em effects/moves.
let efeitos = {};
try {
  efeitos = await ler('effects/moves/index.json');
} catch {
  console.log('  (effects/moves/index.json ausente — rode node tools/fetch-effects.mjs)');
}

const porAtaque = {};
for (const c of creatures) {
  for (const a of c.attacks ?? []) {
    const alvo = (porAtaque[a.name] ??= {
      nome: a.name,
      tipo: a.type,
      categoria: a.category,
      power: a.power,
      cooldownMs: a.cooldownMs,
      tm: a.tm ?? null,
      // a folha do tipo é o efeito que o cliente usa quando o servidor não manda um fx próprio
      efeitoTipo: efeitos[String(a.type).toUpperCase()] ? String(a.type).toUpperCase() : null,
      aprendidoPor: [],
    });
    // o mesmo golpe pode ter power/cooldown diferentes por espécie: guardamos o intervalo
    alvo.powerMin = Math.min(alvo.powerMin ?? a.power, a.power);
    alvo.powerMax = Math.max(alvo.powerMax ?? a.power, a.power);
    alvo.aprendidoPor.push({ pokeId: c.pokeId, nome: c.name, learnLevel: a.learnLevel ?? null, power: a.power });
  }
}
for (const a of Object.values(porAtaque)) a.aprendidoPor.sort((x, y) => (x.learnLevel ?? 0) - (y.learnLevel ?? 0));

await escrever('index/moves-index.json', {
  gerado: new Date().toISOString(),
  porAtaque,
  efeitos, // cópia do index.json dos sheets, para o visualizador não precisar de outro fetch
});

// ---------------------------------------------------------------- relatório

const comDrop = Object.values(porItem).filter((i) => i.dropadoPor.length).length;
console.log(`
  hunts com spawn      ${Object.values(porHunt).filter((h) => h.totalSpawns).length}/${Object.keys(porHunt).length}
  pokémon com local    ${Object.keys(porPokemon).length}/${creatures.length}
  pokémon sem local    ${semSpawn.length}${semSpawn.length ? ` (${semSpawn.slice(0, 6).map((c) => c.name).join(', ')}${semSpawn.length > 6 ? '…' : ''})` : ''}
  ataques distintos    ${Object.keys(porAtaque).length} (${Object.values(porAtaque).filter((a) => a.efeitoTipo).length} com folha de efeito por tipo)
  folhas de efeito     ${Object.keys(efeitos).length}
  itens no índice      ${Object.keys(porItem).length} (${comDrop} dropáveis)
  drops sem catálogo   ${semCatalogo.size}${semCatalogo.size ? ` (${[...semCatalogo].slice(0, 6).join(', ')}${semCatalogo.size > 6 ? '…' : ''})` : ''}`);
