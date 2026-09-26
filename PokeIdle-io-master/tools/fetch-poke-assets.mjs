// Espelha localmente o pack de sprites servido publicamente por poke.idleworld.online.
//
// O jogo renderiza outfits (looktypes) extraídos de um .spr/.dat de PokéTibia; o servidor
// publica esses outfits já empacotados em atlas .webp + manifests JSON. Este script baixa
// o índice, todos os manifests, todos os atlas, os catálogos (creatures/items) e os ícones
// de item — preservando a estrutura de caminhos para o visualizador reusar sem reescrever nada.
//
//   node tools/fetch-poke-assets.mjs             baixa o que falta (resume)
//   node tools/fetch-poke-assets.mjs --force     rebaixa tudo
//   node tools/fetch-poke-assets.mjs --only=pokemon,shiny
//   node tools/fetch-poke-assets.mjs --no-items
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://poke.idleworld.online';
const PACK = '/game/asset-packs';
const OUT = resolve(fileURLToPath(new URL('../public/data', import.meta.url)));
const UA = 'Mozilla/5.0 (compatible; sprite-lab/1.0; pesquisa acadêmica)';
const CONCURRENCY = 8;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const FORCE = has('--force');
const SKIP_ITEMS = has('--no-items');
const ONLY = opt('only')?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const stats = { baixados: 0, cacheados: 0, bytes: 0, falhas: [] };

/** Sprites compostos do idleworld — o espelho traz versão minúscula/errada; manter a nossa. */
const ICONES_PRESERVAR = new Set([
  'site/assets/items/band_aid.png',
  'site/assets/items/essence_of_fire.png',
]);

// ---------------------------------------------------------------- utilidades

const exists = (p) => access(p).then(() => true, () => false);

async function save(rel, buf) {
  const dest = join(OUT, rel);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  stats.bytes += buf.byteLength;
}

async function fetchBuf(url, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= tries) throw err;
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    }
  }
}

// Baixa url -> OUT/rel, pulando o que já existe (a não ser com --force).
async function grab(url, rel) {
  if (ICONES_PRESERVAR.has(rel)) {
    stats.cacheados++;
    return false;
  }
  if (!FORCE && (await exists(join(OUT, rel)))) {
    stats.cacheados++;
    return false;
  }
  const buf = await fetchBuf(url);
  await save(rel, buf);
  stats.baixados++;
  return true;
}

// Pool de concorrência com barra de progresso de uma linha.
async function pool(items, worker, label) {
  let done = 0;
  const total = items.length;
  const queue = items[Symbol.iterator]();
  const tick = () => {
    done++;
    if (done % 10 === 0 || done === total) {
      const pct = String(Math.round((done / total) * 100)).padStart(3);
      process.stdout.write(`\r  ${label} ${pct}%  (${done}/${total})   `);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
      for (const item of queue) {
        try {
          await worker(item);
        } catch (err) {
          stats.falhas.push({ item: String(item?.url ?? item?.id ?? item), erro: err.message });
        }
        tick();
      }
    }),
  );
  process.stdout.write('\n');
}

const json = (buf) => JSON.parse(buf.toString('utf8'));
// Manifests referenciam "/assets-packs/..."; espelhamos sob data/asset-packs/...
const packRel = (p) => 'asset-packs/' + p.replace(/^\/assets-packs\//, '');
const packUrl = (p) => ORIGIN + p.replace(/^\/assets-packs/, PACK);

// ------------------------------------------------------------------ etapas

async function baixarOutfits() {
  console.log('\n[1/3] índice de outfits');
  const indexBuf = await fetchBuf(`${ORIGIN}${PACK}/outfits-index.json?v=2`);
  await save('asset-packs/outfits-index.json', indexBuf);
  stats.baixados++;

  const index = json(indexBuf);
  let entradas = Object.values(index.outfits);
  if (ONLY) entradas = entradas.filter((o) => ONLY.includes(String(o.kind).toLowerCase()));

  const porKind = entradas.reduce((acc, o) => ((acc[o.kind] = (acc[o.kind] || 0) + 1), acc), {});
  console.log(`      ${entradas.length} outfits →`, porKind);

  console.log('[2/3] manifests + atlas');
  await pool(
    entradas,
    async (outfit) => {
      const manRel = packRel(outfit.manifest);
      await grab(packUrl(outfit.manifest), manRel);
      const manifest = json(await readFile(join(OUT, manRel)));

      for (const cat of Object.values(manifest.categories ?? {})) {
        for (const page of cat.pages ?? []) {
          await grab(packUrl(page.image), packRel(page.image));
        }
      }
    },
    'outfits',
  );

  return index;
}

async function baixarCatalogos() {
  console.log('[3/3] catálogos + ícones de item');
  await grab(`${ORIGIN}/game/creatures.json`, 'creatures.json');
  await grab(`${ORIGIN}/game/items.json`, 'items.json');

  if (SKIP_ITEMS) return { items: [], mapa: {} };

  const { items } = json(await readFile(join(OUT, 'items.json')));

  // icon é ou uma URL absoluta (pokexguides.com) ou um caminho do próprio site.
  const alvos = [];
  const mapa = {};
  for (const item of items) {
    const icon = item.icon;
    if (!icon) continue;
    let url, rel;
    if (/^https?:\/\//i.test(icon)) {
      const u = new URL(icon);
      url = icon;
      rel = `items/${u.hostname.replace(/[^a-z0-9]+/gi, '-')}${u.pathname}`;
    } else {
      // A barra tem de ser garantida aqui, e não presumida.
      //
      // Este trecho era `ORIGIN + icon` e `'site' + icon`, o que só funciona quando o catálogo
      // manda o caminho começando com `/`. Quando ele manda um nome solto (`venom_stone.gif`),
      // a concatenação crua produz `https://origemvenom_stone.gif` para baixar e
      // `sitevenom_stone.gif` para guardar — o download falha em silêncio E o índice fica com
      // um caminho que nunca vai existir. O jogador vê um item sem ícone e não há erro em
      // lugar nenhum que explique.
      // O catálogo manda o ícone de DUAS formas, e a segunda apareceu depois:
      //
      //   `/assets/stones/ancient_stone.gif`  caminho a partir da raiz
      //   `venom_stone.gif`                   só o nome — mora em `/assets/items/`
      //
      // Concatenar cru (`ORIGIN + icon`) só funciona na primeira: na segunda produzia
      // `https://origemvenom_stone.gif` para baixar e `sitevenom_stone.gif` para guardar. O
      // download falhava calado E o índice gravava um caminho impossível — item sem ícone no
      // jogo, sem nenhum erro que explicasse. Hoje são 172 itens nesse formato.
      const caminho = icon.startsWith('/') ? icon : `/assets/items/${icon}`;
      url = ORIGIN + caminho;
      rel = `site${caminho}`; // ex.: site/assets/stones/ancient_stone.gif
    }
    mapa[item.id] = rel;
    alvos.push({ url, rel, id: item.id });
  }

  await pool(alvos, (a) => grab(a.url, a.rel), 'ícones ');
  await save('items-icons.json', Buffer.from(JSON.stringify(mapa, null, 1)));
  return { items, mapa };
}

// -------------------------------------------------------------------- main

const t0 = Date.now();
console.log(`Espelhando ${ORIGIN}${PACK} → ${OUT}`);

const index = await baixarOutfits();
const { items } = await baixarCatalogos();

await save(
  'summary.json',
  Buffer.from(
    JSON.stringify(
      {
        origem: ORIGIN,
        baixadoEm: new Date().toISOString(),
        outfits: Object.keys(index.outfits).length,
        porKind: Object.values(index.outfits).reduce(
          (acc, o) => ((acc[o.kind] = (acc[o.kind] || 0) + 1), acc),
          {},
        ),
        items: items.length,
        falhas: stats.falhas,
      },
      null,
      2,
    ),
  ),
);

const mb = (stats.bytes / 1024 / 1024).toFixed(1);
console.log(
  `\nPronto em ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
    `${stats.baixados} arquivos novos (${mb} MB), ${stats.cacheados} em cache.`,
);
if (stats.falhas.length) {
  console.log(`${stats.falhas.length} falha(s) — veja public/data/summary.json`);
  for (const f of stats.falhas.slice(0, 8)) console.log(`  · ${f.item}: ${f.erro}`);
}
console.log('Agora: npm start');
