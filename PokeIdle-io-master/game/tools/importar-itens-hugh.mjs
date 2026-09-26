/**
 * Importa itens faltantes (drops sem catálogo) a partir da wiki NPC Hugh.
 *
 *   node tools/importar-itens-hugh.mjs           # dry-run
 *   node tools/importar-itens-hugh.mjs --apply     # grava PNGs + items.json + items-icons.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = join(raiz, 'public/data');
const itemsPath = join(dataDir, 'items.json');
const iconsPath = join(dataDir, 'items-icons.json');
const iconsDir = join(dataDir, 'site/assets/items');
const auditPath = join(dirname(fileURLToPath(import.meta.url)), 'auditoria-icones-itens.json');
const wikiMdPath = join(process.env.USERPROFILE ?? '', '.cursor/projects/c-PokeIdle-io/uploads/NPC_Hugh__Itens_-0.md');

const aplicar = process.argv.includes('--apply');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Nome exibido → nome do arquivo PNG na wiki (1ª coluna da tabela Hugh). */
function parseWikiHugh(md) {
  const map = new Map();
  const re = /\|\s*\[([^\]]+\.(?:png|gif|jpg))\][^|]*\|\s*([^|]+?)\s*\|\s*\$?([\d,]+(?:\.\d+)?)/gi;
  for (const m of md.matchAll(re)) {
    const arquivo = m[1].trim();
    const nome = m[2].trim().replace(/\s+/g, ' ');
    const precoWiki = Number(m[3].replace(/,/g, ''));
    if (!nome || !Number.isFinite(precoWiki)) continue;
    map.set(normNome(nome), { nome, arquivo, precoWiki });
  }
  return map;
}

function normNome(n) {
  return String(n).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Nome → snake_case do espelho (Armadillo Claw → armadillo_claw.png). */
function iconLocal(nome) {
  return `${nome
    .replace(/'/g, '')
    .replace(/\./g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase()}.png`;
}

/** Variações do nome de arquivo na wiki. */
function wikiArquivos(nome, arquivoHint) {
  const out = new Set();
  if (arquivoHint) {
    out.add(arquivoHint);
    out.add(arquivoHint.replace(/\.png$/i, '.gif'));
  }
  const base = nome.replace(/'/g, "'");
  out.add(`${base}.png`);
  out.add(`${base.replace(/ /g, '_')}.png`);
  out.add(`${base.replace(/ of /gi, ' Of ').replace(/ /g, '_')}.png`);
  out.add(`${base.replace(/ Of /g, ' of ').replace(/ /g, '_')}.png`);
  return [...out];
}

async function urlImagemWiki(arquivo) {
  const titulo = encodeURIComponent(`Arquivo:${arquivo.replace(/ /g, '_')}`);
  const html = await fetch(`https://wiki.pokexgames.com/index.php?title=${titulo}`, {
    headers: { 'User-Agent': 'PokeIdle-import/1.0' },
  }).then((r) => r.text());
  const m = html.match(/\/images\/[a-f0-9]\/[a-f0-9]{2}\/[^"'\\]+?\.(?:png|gif)/i);
  if (!m) return null;
  return `https://wiki.pokexgames.com${m[0].replace(/&amp;/g, '&')}`;
}

async function baixarIcone(nome, arquivoHint) {
  for (const arq of wikiArquivos(nome, arquivoHint)) {
    try {
      const url = await urlImagemWiki(arq);
      if (!url) continue;
      const res = await fetch(url, { headers: { 'User-Agent': 'PokeIdle-import/1.0' } });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 80) continue;
      return { buf, url, arquivo: arq };
    } catch {
      /* tenta próximo */
    }
    await sleep(120);
  }
  return null;
}

/** Preço calibrado com a economia ATUAL — fósseis ~500, raros Hugh inflados ~500–1000. */
function escalaPreco(precoWiki, nome) {
  const n = String(nome).toLowerCase();
  if (/fossil/i.test(n)) return 500;
  if (precoWiki >= 80_000) return 1000;
  if (precoWiki >= 8000) return 500;
  if (precoWiki >= 1000) return 500;
  if (precoWiki >= 200) return Math.max(5, Math.round((precoWiki * 0.08) / 5) * 5);
  return Math.max(3, Math.round((precoWiki * 0.08) / 5) * 5);
}

const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
const faltantes = audit.drop_sem_catalogo.map((x) => x.name);
const itemsJson = JSON.parse(readFileSync(itemsPath, 'utf8'));
const iconsJson = JSON.parse(readFileSync(iconsPath, 'utf8'));
const itemsAtuais = itemsJson.items;

let wikiMd;
try {
  wikiMd = readFileSync(wikiMdPath, 'utf8');
} catch {
  console.error('Markdown da wiki não encontrado em', wikiMdPath);
  process.exit(1);
}

const wikiMap = parseWikiHugh(wikiMd);
console.log(`Wiki Hugh: ${wikiMap.size} itens com preço`);

let nextId = 70100;
while (itemsAtuais.some((i) => i.id === nextId)) nextId++;

const relatorio = [];
const novos = [];
const novosIcones = { ...iconsJson };

for (const lootNome of faltantes) {
  const wiki = wikiMap.get(normNome(lootNome))
    ?? wikiMap.get(normNome(lootNome.replace(/ Of /g, ' of ')))
    ?? wikiMap.get(normNome(lootNome.replace(/'/g, "'")));

  const nomeCanon = wiki?.nome ?? lootNome;
  const precoWiki = wiki?.precoWiki ?? null;
  const npcPrice = precoWiki != null ? escalaPreco(precoWiki, nomeCanon) : 40;
  const iconFile = iconLocal(nomeCanon);
  const id = nextId++;

  const entrada = {
    id,
    name: nomeCanon,
    icon: iconFile,
    category: 'loot',
    rare: npcPrice >= 1000,
    npcPrice,
  };

  let download = null;
  if (aplicar) {
    download = await baixarIcone(nomeCanon, wiki?.arquivo ?? null);
    if (download) {
      mkdirSync(iconsDir, { recursive: true });
      writeFileSync(join(iconsDir, iconFile), download.buf);
    }
    await sleep(150);
  }

  novos.push(entrada);
  novosIcones[id] = `site/assets/items/${iconFile}`;
  relatorio.push({
    id,
    name: nomeCanon,
    lootNome,
    precoWiki,
    npcPrice,
    icon: iconFile,
    wiki: !!wiki,
    baixou: !!download,
    url: download?.url ?? null,
  });

  const flag = !wiki ? 'sem wiki' : !download && aplicar ? 'sem png' : 'ok';
  console.log(`${flag.padEnd(9)} ${String(id).padStart(5)}  ${nomeCanon.padEnd(36)}  wiki $${precoWiki ?? '?'} → ${npcPrice}`);
}

const semWiki = relatorio.filter((r) => !r.wiki);
const semPng = aplicar ? relatorio.filter((r) => !r.baixou) : [];

console.log(`\nNovos: ${novos.length} · sem wiki: ${semWiki.length}${aplicar ? ` · sem png: ${semPng.length}` : ''}`);

const outReport = join(dirname(fileURLToPath(import.meta.url)), 'importar-itens-hugh-relatorio.json');
writeFileSync(outReport, JSON.stringify({ relatorio }, null, 2));
console.log('Relatório:', outReport);

if (!aplicar) {
  console.log('\nDry-run. Rode com --apply para gravar.');
  process.exit(0);
}

itemsJson.items = [...itemsAtuais, ...novos].sort((a, b) => a.id - b.id);
writeFileSync(itemsPath, `${JSON.stringify(itemsJson, null, 1)}\n`);
writeFileSync(iconsPath, `${JSON.stringify(novosIcones, null, 1)}\n`);
console.log(`\nGravado: ${itemsPath}`);
console.log(`Gravado: ${iconsPath}`);
console.log(`PNG em: ${iconsDir}`);
