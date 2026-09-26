#!/usr/bin/env node
/**
 * Varredura de shinys: PNG duplicado, nome errado no lab, atlas ausente, chave desatualizada.
 *
 *   node tools/nomeador/auditar-shinys.mjs
 *   node tools/nomeador/auditar-shinys.mjs --json
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarPokedex } from './pokedex-catalog.mjs';
import { limpar, especieDe } from './dex.mjs';
import { montarPokedexOficial } from './pokedex-oficial.mjs';
import { labIndex, pokedexBackup, spritesRaiz } from '../caminhos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../..');
const SPRITES = spritesRaiz();
const LAB = labIndex();
const BACKUP = pokedexBackup();
const CAT = join(RAIZ, 'public', 'data', 'asset-packs', 'categories');
const SHINIES = join(RAIZ, 'game', 'src', 'server', 'dados', 'shiny-catalogo-novos.json');
const BASELINE = join(AQUI, 'pokedex-lab-baseline.json');

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');

function md5(buf) {
  return createHash('md5').update(buf).digest('hex').slice(0, 16);
}

function slug(nome) {
  return limpar(nome);
}

function pngDims(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function casaNomeLab(e, s, shiny = false) {
  if (!e?.name) return false;
  if (shiny) {
    return e.name === `shiny_${s}` || e.name === `${s}_shiny`
      || (especieDe(e.name) === s && (e.name.startsWith('shiny_') || e.name.endsWith('_shiny')));
  }
  return (e.name === s || especieDe(e.name) === s) && e.kind !== 'shiny';
}

function webpDeLooktype(lt) {
  const dir = join(RAIZ, 'public', 'data', 'asset-packs', 'outfits', 'male', String(lt));
  if (!existsSync(dir)) return null;
  const fn = readdirSync(dir).find((f) => f.endsWith('.webp'));
  if (!fn) return null;
  const buf = readFileSync(join(dir, fn));
  return { hash: md5(buf), file: fn, bytes: buf.length };
}

function looktypesComManifest() {
  if (!existsSync(CAT)) return [];
  const ids = new Set();
  for (const f of readdirSync(CAT)) {
    const m = f.match(/^outfits-male-(\d+)-/);
    if (m) ids.add(Number(m[1]));
  }
  return [...ids];
}

function temManifest(lt) {
  if (!lt || lt <= 1) return false;
  return looktypesComManifest().includes(lt);
}

function lerPng(rel) {
  const p = join(SPRITES, rel.replace(/\//g, '\\'));
  if (!existsSync(p)) return { ok: false, path: p };
  const buf = readFileSync(p);
  return { ok: true, path: p, buf, hash: md5(buf), dims: pngDims(buf) };
}

const lab = JSON.parse(readFileSync(LAB, 'utf-8')).outfits;
const pokedex = montarPokedex(lab);
const porSlug = new Map(pokedex.geracoes.flatMap((g) => g.entradas).map((e) => [e.slug, e]));
const shinies = JSON.parse(readFileSync(SHINIES, 'utf-8')).entries ?? [];
const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf-8')).entradas ?? {}
  : {};

/** md5 → [{ slug, slot, looktype, labName, arquivo }] */
const porHash = new Map();
const registros = [];

async function main() {

const atlasPorHash = new Map();
for (const lt of looktypesComManifest()) {
  const w = webpDeLooktype(lt);
  if (!w) continue;
  const labE = lab[String(lt)];
  const rec = { looktype: lt, labName: labE?.name ?? '?', kind: labE?.kind ?? '?', ...w };
  if (!atlasPorHash.has(w.hash)) atlasPorHash.set(w.hash, []);
  atlasPorHash.get(w.hash).push(rec);
}

for (const g of pokedex.geracoes) {
  for (const e of g.entradas) {
    for (const slot of ['normal', 'shiny']) {
      const ent = e[slot];
      if (!ent?.id) continue;
      const labE = lab[String(ent.id)];
      const arq = labE?.arquivo ?? ent.arquivo;
      if (!arq) continue;
      const png = lerPng(arq);
      if (!png.ok) continue;
      const rec = {
        slug: e.slug,
        dex: e.dex,
        nome: e.nome,
        slot,
        looktype: ent.id,
        labName: labE?.name ?? ent.name,
        arquivo: arq,
        hash: png.hash,
        dims: png.dims,
      };
      registros.push(rec);
      if (!porHash.has(png.hash)) porHash.set(png.hash, []);
      porHash.get(png.hash).push(rec);
    }
  }
}

const problemas = [];

function add(codigo, rec, extra = {}) {
  problemas.push({
    codigo,
    dex: rec.dex,
    nome: rec.nome,
    slug: rec.slug,
    looktype: rec.looktype,
    labName: rec.labName,
    arquivo: rec.arquivo,
    ...extra,
  });
}

for (const s of shinies) {
  const sl = slug(s.name);
  const cat = porSlug.get(sl);
  const lt = s.looktype;
  const labE = lab[String(lt)];
  const recBase = {
    dex: s.dexId,
    nome: s.name,
    slug: sl,
    looktype: lt,
    labName: labE?.name ?? '?',
    arquivo: labE?.arquivo ?? '?',
  };

  if (!labE) {
    add('sem-lab', recBase);
    continue;
  }
  if (!casaNomeLab(labE, sl, true)) {
    add('nome-lab-errado', recBase, { esperado: `shiny_${sl}`, labName: labE.name });
  }
  if (!temManifest(lt)) {
    add('sem-manifest', recBase);
  }

  const dexSh = cat?.shiny;
  if (dexSh?.id && dexSh.id !== lt) {
    add('looktype-diverge-pokedex', recBase, { pokedexLt: dexSh.id });
  }

  const baseSh = baseline[sl]?.shiny;
  if (baseSh?.id && baseSh.id !== lt) {
    add('baseline-id-diferente', recBase, { baselineLt: baseSh.id });
  }

  const png = labE.arquivo ? lerPng(labE.arquivo) : { ok: false };
  if (!png.ok) {
    add('sem-png', recBase, { path: png.path });
    continue;
  }
  const chaveLab = String(labE.chave || '').split('#')[0];
  if (chaveLab && chaveLab !== png.hash) {
    add('chave-desatualizada', recBase, { chaveLab, hashArquivo: png.hash });
  }

  const dupes = (porHash.get(png.hash) ?? []).filter((r) => r.slug !== sl || r.slot !== 'shiny');
  for (const d of dupes) {
    if (d.slug === sl && d.slot === 'normal') {
      add('shiny-igual-normal', recBase, { outro: `${d.slug} normal` });
    } else {
      add('png-duplicado', recBase, {
        outroSlug: d.slug,
        outroNome: d.nome,
        outroSlot: d.slot,
        outroLooktype: d.looktype,
        outroLabName: d.labName,
      });
    }
  }

  const atlas = webpDeLooktype(lt);
  if (!atlas) {
    add('sem-atlas', recBase);
  } else {
    const conflitos = (atlasPorHash.get(atlas.hash) ?? []).filter((a) => a.looktype !== lt);
    for (const c of conflitos) {
      add('atlas-duplicado', recBase, {
        atlasHash: atlas.hash,
        outroLooktype: c.looktype,
        outroLabName: c.labName,
        outroKind: c.kind,
      });
    }
  }
}

// Backup: mesmo PNG em espécies diferentes (###_slug_shiny.png)
let backupDupes = [];
try {
  const oficial = await montarPokedexOficial(BACKUP);
  const hashBackup = new Map();
  for (const g of oficial.geracoes) {
    for (const e of g.entradas) {
      for (const slot of ['normal', 'shiny']) {
        const ent = e[slot];
        if (!ent?.path || !existsSync(ent.path)) continue;
        const h = md5(readFileSync(ent.path));
        if (!hashBackup.has(h)) hashBackup.set(h, []);
        hashBackup.get(h).push({ dex: e.dex, slug: e.slug, nome: e.nome, slot, path: ent.path });
      }
    }
  }
  for (const [h, arr] of hashBackup) {
    if (arr.length < 2) continue;
    const slugs = new Set(arr.map((x) => x.slug));
    if (slugs.size < 2) continue;
    backupDupes.push({ hash: h, entradas: arr });
  }
} catch {
  backupDupes = null;
}

problemas.sort((a, b) => a.dex - b.dex || a.codigo.localeCompare(b.codigo));

const porCodigo = {};
for (const p of problemas) {
  porCodigo[p.codigo] = (porCodigo[p.codigo] ?? 0) + 1;
}

const relatorio = {
  geradoEm: new Date().toISOString(),
  totalShiniesCatalogo: shinies.length,
  totalProblemas: problemas.length,
  porCodigo,
  backupDuplicados: backupDupes,
  problemas,
};

const outPath = join(AQUI, 'auditoria-shinys.json');
writeFileSync(outPath, JSON.stringify(relatorio, null, 2));

if (asJson) {
  console.log(JSON.stringify(relatorio, null, 2));
  process.exit(problemas.length ? 1 : 0);
}

console.log(`Shinys no catálogo: ${shinies.length}`);
console.log(`Problemas: ${problemas.length}`);
console.log('Por tipo:', porCodigo);
console.log('');

const ordem = ['atlas-duplicado', 'png-duplicado', 'shiny-igual-normal', 'nome-lab-errado', 'sem-atlas', 'sem-manifest', 'sem-png', 'chave-desatualizada', 'looktype-diverge-pokedex', 'sem-lab'];
for (const cod of ordem) {
  const lista = problemas.filter((p) => p.codigo === cod);
  if (!lista.length) continue;
  console.log(`\n=== ${cod} (${lista.length}) ===`);
  for (const p of lista.slice(0, 80)) {
    const extra = p.outroLooktype && p.outroLabName
      ? ` → atlas igual ao lt ${p.outroLooktype} (${p.outroLabName}${p.outroKind ? ` ${p.outroKind}` : ''})`
      : p.outroSlug
      ? ` → mesmo PNG que #${p.outroSlug} ${p.outroSlot} (lt ${p.outroLooktype} ${p.outroLabName})`
      : p.outro
        ? ` → ${p.outro}`
        : p.esperado
          ? ` (esperado ${p.esperado}, lab=${p.labName})`
          : '';
    console.log(`#${String(p.dex).padStart(3)} ${p.nome.padEnd(22)} lt=${p.looktype}${extra}`);
  }
  if (lista.length > 80) console.log(`… +${lista.length - 80} mais`);
}

if (backupDupes?.length) {
  console.log(`\n=== backup PNG duplicado entre espécies (${backupDupes.length}) ===`);
  for (const g of backupDupes.slice(0, 40)) {
    console.log(g.entradas.map((e) => `#${e.dex} ${e.slug} ${e.slot}`).join(' | '));
  }
  if (backupDupes.length > 40) console.log(`… +${backupDupes.length - 40} mais`);
}

console.log(`\nRelatório completo: ${outPath}`);
process.exit(problemas.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
