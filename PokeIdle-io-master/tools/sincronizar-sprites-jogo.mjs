#!/usr/bin/env node
/** Sincroniza looktypes e shiny catalog do lab-index → dados do jogo. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarPokedex } from './nomeador/pokedex-catalog.mjs';
import { entradaJogo } from './nomeador/jogo-sprites.mjs';
import { NOMES_OMITIDOS } from './nomeador/spawns-filtro.mjs';
import { isEspelhoFantasmaPokeId } from '../game/src/shared/outland.mjs';
import { labIndex } from './caminhos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const LAB = labIndex();
const GAME = join(RAIZ, 'public', 'data');
const DADOS = join(RAIZ, 'game', 'src', 'server', 'dados');
const CAT = join(GAME, 'asset-packs', 'categories');

const manifests = existsSync(CAT)
  ? new Set(readdirSync(CAT).filter((f) => f.startsWith('outfits-male-')).map((f) => Number(f.split('-')[2])))
  : new Set();

const temManifest = (lt) => lt > 1 && manifests.has(lt);

const ltDe = (spr) => spr?.looktype ?? spr?.id ?? null;

const lab = JSON.parse(readFileSync(LAB, 'utf-8'));
const pokedex = montarPokedex(lab.outfits);
const porSlug = new Map(pokedex.geracoes.flatMap((g) => g.entradas).map((e) => [e.slug, e]));

const formulas = JSON.parse(readFileSync(join(GAME, 'index', 'formulas.json'), 'utf-8'));
const shinyBase = new Map((formulas.shinyCatalogo ?? []).map((s) => [s.dexId, s]));

const base = JSON.parse(readFileSync(join(GAME, 'creatures.json'), 'utf-8')).creatures;
const novosPath = join(DADOS, 'creatures-novos.json');
const novos = JSON.parse(readFileSync(novosPath, 'utf-8'));

function slug(nome) {
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019.]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
}

function shinyTier(c) {
  const t = (c.baseHp ?? 0) + (c.baseAtk ?? 0) + (c.baseDef ?? 0)
    + (c.baseSpAtk ?? 0) + (c.baseSpDef ?? 0) + (c.baseSpeed ?? 0);
  if (t >= 600) return 'A';
  if (t >= 500) return 'B';
  return 'C';
}

/** Dex nacional — clones Orre/Outland (13xxx, 10xxx) viram o mesmo #252. */
const dexDe = (pokeId) => (pokeId < 1000 ? pokeId : pokeId % 1000);

/** Formas alternativas perdem para o slug “limpo” (castform > castform_rainy_form). */
function pontuaSlug(pe) {
  if (pe.slug.includes('_form') || pe.slug.includes('_forme')) return 3;
  if (pe.slug.includes('_')) return 1;
  return 0;
}

/** Stats e nome por dex — inclui Orre (13252 → 252), que o filtro `pokeId < 10000` ignorava. */
const porDexStats = new Map();
for (const c of [...base, ...novos.creatures]) {
  const dex = dexDe(c.pokeId);
  if (dex < 1 || dex > 1025) continue;
  if (!porDexStats.has(dex)) porDexStats.set(dex, c);
}

function looktypeCatalogo(nome) {
  const pe = porSlug.get(slug(nome));
  const jogo = entradaJogo(slug(nome), false);
  const lt = ltDe(pe?.normal) ?? ltDe(jogo);
  return lt && temManifest(lt) ? lt : null;
}

let ltNovos = 0;
for (const c of novos.creatures) {
  const lt = looktypeCatalogo(c.name);
  if (lt && lt !== c.looktype) {
    c.looktype = lt;
    ltNovos++;
  }
}

const patchMap = new Map();
function addPatch(c, lt) {
  if (!lt || lt <= 1 || !temManifest(lt)) return;
  if (c.looktype === lt && patchMap.get(c.pokeId)?.looktype === lt) return;
  patchMap.set(c.pokeId, { pokeId: c.pokeId, looktype: lt, name: c.name });
}

for (const c of base) {
  if (isEspelhoFantasmaPokeId(c.pokeId)) continue;
  const lt = looktypeCatalogo(c.name);
  if (lt) addPatch(c, lt);
}

// Orre (13xxx): mesmo sprite da espécie nacional já corrigida no catálogo.
for (const c of base) {
  if (c.pokeId < 13000 || c.pokeId >= 14000) continue;
  const nacional = base.find((x) => x.pokeId === c.pokeId - 13000);
  const ltN = patchMap.get(nacional?.pokeId)?.looktype
    ?? looktypeCatalogo(nacional?.name)
    ?? nacional?.looktype;
  if (ltN) addPatch(c, ltN);
}

const patches = [...patchMap.values()].sort((a, b) => a.pokeId - b.pokeId);

/**
 * Catálogo shiny NOVO — tudo que tem sprite shiny no lab (nomeador).
 *
 * Entra quando a espécie NÃO está no espelho, ou quando o looktype do lab mudou
 * (Treecko no espelho era 5490; no lab é 42029 — sem isto o shiny antigo ficava preso).
 */
const shiniesPorDex = new Map();
for (const pe of pokedex.geracoes.flatMap((g) => g.entradas)) {
  const ltS = ltDe(pe.shiny) ?? ltDe(entradaJogo(pe.slug, true));
  if (!ltS || ltS <= 1) continue;

  const baseSh = shinyBase.get(pe.dex);
  if (baseSh?.looktype === ltS) continue;

  const c = porDexStats.get(pe.dex);
  const nome = c?.name ?? pe.nome;
  // porDexStats pode trazer o macho omitido (Meowstic Male) num dex compartilhado — o catálogo Pokédex manda.
  if (NOMES_OMITIDOS.has(pe.nome) || (NOMES_OMITIDOS.has(nome) && pe.nome === nome)) continue;

  const cand = {
    dexId: pe.dex,
    name: nome,
    looktype: ltS,
    tier: c ? shinyTier(c) : (baseSh?.tier ?? 'C'),
    count: baseSh?.count ?? 3,
    manifestOk: temManifest(ltS),
    _pontos: pontuaSlug(pe),
  };
  const ant = shiniesPorDex.get(pe.dex);
  if (!ant || cand._pontos < ant._pontos) shiniesPorDex.set(pe.dex, cand);
}

const shinies = [...shiniesPorDex.values()].sort((a, b) => a.dexId - b.dexId);

writeFileSync(novosPath, JSON.stringify(novos, null, 2), 'utf-8');
writeFileSync(
  join(DADOS, 'creatures-sprites-lab.json'),
  JSON.stringify({ _leia: 'Looktypes do lab com manifest no jogo.', patches }, null, 2),
  'utf-8',
);
writeFileSync(
  join(DADOS, 'shiny-catalogo-novos.json'),
  JSON.stringify({
    _leia: 'Shiny catalog — sprites do lab-index (via pokedex-catalog). manifestOk=false ainda precisa importar atlas.',
    entries: shinies.map(({ manifestOk, _pontos, ...s }) => s),
    _stats: {
      total: shinies.length,
      comManifest: shinies.filter((s) => s.manifestOk).length,
    },
  }, null, 2),
  'utf-8',
);

const orrePatches = patches.filter((p) => p.pokeId >= 13000 && p.pokeId < 14000).length;
console.log(`looktypes creatures-novos: ${ltNovos}`);
console.log(`patches espelho (manifest ok): ${patches.length} (${orrePatches} Orre)`);
console.log(`shinies novos: ${shinies.length} (${shinies.filter((s) => s.manifestOk).length} com atlas no jogo)`);
console.log(`  treecko shiny: ${shinies.find((s) => s.dexId === 252)?.looktype ?? '—'}`);
console.log(`  caterpie shiny: ${shinies.find((s) => s.dexId === 10)?.looktype ?? '—'}`);
console.log(`  absol orre: ${patches.find((p) => p.pokeId === 13359)?.looktype ?? '—'}`);

