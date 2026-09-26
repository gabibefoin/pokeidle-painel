// Preenche ícones de item faltantes a partir do pokesprite (msikma/pokesprite).
//
// Roda DEPOIS de `fetch-poke-assets.mjs` — só baixa o que ainda não existe localmente
// ou o que ainda aponta para `_loot_placeholder.png`. Atualiza `items-icons.json`.
//
//   node tools/fetch-itens-pokesprite.mjs [--force]
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { grab, fetchJson, fetchBuf, pool, resumo, stats, OUT } from './lib.mjs';
import { recortarTransparente } from './png.mjs';

const POKESPRITE = 'https://raw.githubusercontent.com/msikma/pokesprite/master/items';
const FORCE = process.argv.includes('--force');
const INVENTORY_URL = 'https://msikma.github.io/pokesprite/overview/inventory.html';

/** pokesprite (origem) → caminho flat no espelho (destino). */
const MANUAL = {
  'Dark Gem': { ps: 'gem/dark', rel: 'site/assets/items/dark_gem.png' },
  Goggles: { ps: 'hold-item/safety-goggles', rel: 'site/assets/items/goggles.png' },
  'Farfetchd Stick': { ps: 'hold-item/stick', rel: 'site/assets/items/farfetchd_stick.png' },
  "Farfetch'd Stick": { ps: 'hold-item/stick', rel: 'site/assets/items/farfetchd_stick.png' },
};

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const slugsDe = (nome, icon) => {
  const out = new Set();
  if (nome) {
    out.add(slug(nome));
    out.add(slug(nome.replace(/\s+stone$/i, '-stone')));
  }
  if (icon && !icon.includes('://')) {
    const base = icon.replace(/\.(png|gif)$/i, '');
    out.add(slug(base.replace(/_/g, '-')));
    out.add(slug(base.replace(/_/g, ' ')));
  }
  return [...out].filter(Boolean);
};

/** Índice slug → caminho pokesprite (ex.: `moon-stone` → `evo-item/moon-stone`). */
async function indicePokesprite() {
  const mapa = new Map();

  const add = (path) => {
    const semExt = path.replace(/\.png$/i, '');
    const s = semExt.includes('/') ? semExt.split('/').pop() : semExt;
    if (!mapa.has(s)) mapa.set(s, semExt);
  };

  const itemMap = await fetchJson(
    'https://raw.githubusercontent.com/msikma/pokesprite/master/data/item-map.json',
  );
  for (const path of Object.values(itemMap)) add(`${path}.png`);

  try {
    const html = (await fetchBuf(INVENTORY_URL)).toString('utf8');
    for (const m of html.matchAll(/\|\s*([\w-]+)\s*\|\s*([\w/-]+\.png)\s*\|/g)) add(m[2]);
    for (const m of html.matchAll(/items\/([\w/-]+\.png)/g)) add(m[1]);
  } catch (err) {
    console.log(`(inventory HTML indisponível — só item-map.json: ${err.message})`);
  }

  return mapa;
}

function relDoItem(item, icons) {
  return icons[String(item.id)] ?? (item.icon?.startsWith('/') ? `site${item.icon}` : `site/assets/items/${item.icon}`);
}

function precisaSubstituir(item, rel) {
  const manual = MANUAL[item.name];
  if (manual && rel !== manual.rel) return true;
  if (!rel) return true;
  if (item.icon?.includes('_loot_placeholder')) return true;
  if (rel.includes('_loot_placeholder')) return true;
  if (!existsSync(join(OUT, rel))) return true;
  return false;
}

function acharPath(nome, icon, indice) {
  if (MANUAL[nome]) return MANUAL[nome];
  for (const s of slugsDe(nome, icon)) {
    const hit = indice.get(s);
    if (hit) return { ps: hit, rel: `site/assets/items/${hit.split('/').pop()}.png` };
  }
  return null;
}

const t0 = Date.now();
const items = JSON.parse(await readFile(join(OUT, 'items.json'), 'utf8')).items;
const icons = JSON.parse(await readFile(join(OUT, 'items-icons.json'), 'utf8'));
const indice = await indicePokesprite();

const alvos = [];
const semMatch = [];

for (const item of items) {
  const relAtual = relDoItem(item, icons);
  if (!precisaSubstituir(item, relAtual)) continue;

  const hit = acharPath(item.name, item.icon, indice);
  if (!hit) {
    semMatch.push(item);
    continue;
  }

  alvos.push({
    id: item.id,
    nome: item.name,
    url: `${POKESPRITE}/${hit.ps}.png`,
    rel: hit.rel,
    relAnterior: relAtual,
  });
}

console.log(`${alvos.length} ícone(s) para buscar no pokesprite`);
if (semMatch.length) {
  console.log(`${semMatch.length} item(ns) sem correspondência no pokesprite:`);
  for (const i of semMatch) console.log(`  · ${i.id} ${i.name} (${i.icon})`);
}

await pool(alvos, (a) => grab(a.url, a.rel, FORCE), 'pokesprite');

let atualizados = 0;
for (const a of alvos) {
  if (!existsSync(join(OUT, a.rel))) continue;
  icons[String(a.id)] = a.rel;
  atualizados++;
  try {
    const buf = await readFile(join(OUT, a.rel));
    const r = recortarTransparente(buf);
    if (r) await writeFile(join(OUT, a.rel), r.buf);
  } catch {
    /* recorte opcional */
  }
}

if (atualizados) {
  await writeFile(join(OUT, 'items-icons.json'), JSON.stringify(icons, null, 1) + '\n');
  console.log(`\nitems-icons.json: ${atualizados} entrada(s) atualizada(s).`);
}

resumo(t0);
process.exit(stats.falhas.length ? 1 : 0);
