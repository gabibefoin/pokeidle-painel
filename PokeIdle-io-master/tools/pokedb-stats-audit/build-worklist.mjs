/**
 * Monta a worklist para a auditoria de stats+moves contra pokemondb.net.
 *
 * Escopo = INTERSEÇÃO de:
 *   (a) tem página no pokemondb  -> dex nacional 1..1025 + 6 Megas + Castform-Fire (14351)
 *   (b) tem SPRITE de verdade no jogo -> looktype != 1 e presente no atlas de outfits
 *
 * Quem cai fora:
 *   - dex 1..1025 SEM sprite (looktype 1): não está no jogo, "lixo" — ignorado de vez.
 *   - Outland 2001-2047, Orre 13xxx, fantasma 10001: conteúdo original, sem página no pokemondb.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const OUT = AQUI;
mkdirSync(join(OUT, 'cache'), { recursive: true });

const base = JSON.parse(readFileSync(join(RAIZ, 'public/data/creatures.json'), 'utf8')).creatures;
const novos = JSON.parse(readFileSync(join(RAIZ, 'game/src/server/dados/creatures-novos.json'), 'utf8')).creatures || [];

// atlas de sprites: looktype -> outfit. Quem não está aqui (ou é looktype 1) não tem sprite.
const idxOutfits = JSON.parse(readFileSync(join(RAIZ, 'public/data/asset-packs/outfits-index.json'), 'utf8'));
const outfits = idxOutfits.outfits || idxOutfits;
const LOOKTYPES = new Set(Object.keys(outfits).map(Number));
const temSprite = (c) => c.looktype != null && c.looktype !== 1 && LOOKTYPES.has(c.looktype);

const merged = new Map();
for (const c of base) merged.set(c.pokeId, { ...c, _src: 'base' });
for (const c of novos) merged.set(c.pokeId, { ...c, _src: 'novos' });
const all = [...merged.values()].sort((a, b) => a.pokeId - b.pokeId);

/** Move "assinatura" protegido: power >= 300 (os 600 por tipo + Draconic Soul 300). Não conta em N, não renomeia. */
const ehAssinatura = (a) => (a.power || 0) >= 300;

// slug pokemondb por pokeId da dex nacional (casos que a normalização não acerta)
const SLUG_ESPECIAL = {
  29: 'nidoran-f', 32: 'nidoran-m',
  83: 'farfetchd', 865: 'sirfetchd',
  122: 'mr-mime', 866: 'mr-rime', 439: 'mime-jr',
  250: 'ho-oh', 474: 'porygon-z', 772: 'type-null',
  669: 'flabebe', 785: 'tapu-koko', 786: 'tapu-lele', 787: 'tapu-bulu', 788: 'tapu-fini',
};

function normSlug(name) {
  let n = name.trim().replace(/\s*\([^)]*\)\s*$/g, '').trim(); // tira sufixo de forma "(Teal Mask)"
  n = n.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acento (Flabébé)
    .replace(/['’.:]/g, '')
    .replace(/\s+/g, '-');
  return n;
}

const MEGAS = new Set([14009, 14065, 14282, 14302, 14334, 14448]);
const FORMS_14 = new Set([14351]); // Castform Fire

const temPagina = (id) => (id >= 1 && id <= 1025) || MEGAS.has(id) || FORMS_14.has(id);

const work = [];
const foraDeEscopo = [];

for (const c of all) {
  const id = c.pokeId;
  const sprite = temSprite(c);
  const pagina = temPagina(id);

  if (!(sprite && pagina)) {
    let motivo;
    if (!sprite && pagina) motivo = 'sem-sprite';        // dex sem sprite: não está no jogo
    else if (sprite && !pagina) motivo = 'sem-pagina';   // Outland/Orre/fantasma: sem pokemondb
    else motivo = 'sem-sprite-e-sem-pagina';
    foraDeEscopo.push({ pokeId: id, name: c.name, src: c._src, looktype: c.looktype, motivo });
    continue;
  }

  const dex = id >= 14000 ? id % 1000 : id;
  let slug = SLUG_ESPECIAL[dex] || normSlug(c.name);
  if (MEGAS.has(id)) slug = SLUG_ESPECIAL[dex] || normSlug(c.name.replace(/^Mega\s+/i, ''));
  if (id === 14351) slug = 'castform';

  const attacks = (c.attacks || []).map((a) => ({
    name: a.name, type: a.type, category: a.category,
    power: a.power, cooldownMs: a.cooldownMs, learnLevel: a.learnLevel,
    sig: ehAssinatura(a),
  }));
  const regularCount = attacks.filter((a) => !a.sig).length;

  work.push({
    pokeId: id,
    dex,
    name: c.name,
    src: c._src,
    slug,
    kind: MEGAS.has(id) ? 'mega' : id === 14351 ? 'form' : 'dex',
    curStats: { hp: c.baseHp, atk: c.baseAtk, def: c.baseDef, spa: c.baseSpAtk, spd: c.baseSpDef, spe: c.baseSpeed },
    curTypes: [c.type1, c.type2 || null],
    regularCount,
    sigCount: attacks.length - regularCount,
    attacks,
    status: 'pending',
  });
}

writeFileSync(join(OUT, 'worklist.json'), JSON.stringify(work, null, 1));
writeFileSync(join(OUT, 'fora-de-escopo.json'), JSON.stringify(foraDeEscopo, null, 1));

const fdeMot = foraDeEscopo.reduce((m, f) => ((m[f.motivo] = (m[f.motivo] || 0) + 1), m), {});
console.log('worklist:', work.length, 'entradas | fora de escopo:', foraDeEscopo.length, JSON.stringify(fdeMot));
console.log('por kind:', work.reduce((m, w) => ((m[w.kind] = (m[w.kind] || 0) + 1), m), {}));
console.log('megas/form:', work.filter((w) => w.kind !== 'dex').map((w) => `${w.pokeId}:${w.slug}`).join(' '));
