#!/usr/bin/env node
/**
 * Publica atlases WEBP + manifests do Sprite Lab (LAB/) para o espelho local do jogo.
 *
 * A conversão PNG → WEBP já acontece em `nomeador:build` (construir.py + converter.py).
 * Este script só copia o resultado para public/data/asset-packs/ e atualiza outfits-index.json.
 *
 *   node tools/publicar-sprites-lab.mjs                  pokemon + shiny (padrão)
 *   node tools/publicar-sprites-lab.mjs --tudo           todos os outfits do lab-index
 *   node tools/publicar-sprites-lab.mjs --apenas=shiny   filtro por kind
 *   node tools/publicar-sprites-lab.mjs --force          recopia mesmo se já existir
 */
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  existsSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spritesRaiz } from './caminhos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const SPRITES = spritesRaiz();
const LAB = join(SPRITES, 'LAB');
const PACK = join(RAIZ, 'public', 'data', 'asset-packs');
const INDICE_LAB = join(LAB, 'lab-index.json');
const INDICE_JOGO = join(PACK, 'outfits-index.json');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const TUDO = argv.includes('--tudo');
const APENAS = argv.find((a) => a.startsWith('--apenas='))?.split('=')[1]
  ?.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const packRel = (p) => p.replace(/^\/assets-packs\//, '');

const CAMPOS_INDICE = [
  'id',
  'gender',
  'category',
  'manifest',
  'colorizable',
  'directions',
  'frames',
  'width',
  'height',
  'name',
  'kind',
];

function copiar(src, dest, forcar = false) {
  if (!existsSync(src)) return { ok: false, motivo: 'origem ausente' };
  mkdirSync(dirname(dest), { recursive: true });
  if (!FORCE && !forcar && existsSync(dest)) {
    try {
      if (statSync(src).size === statSync(dest).size) return { ok: true, copiado: false };
    } catch {
      /* destino sumiu entre exists e stat */
    }
  }
  copyFileSync(src, dest);
  return { ok: true, copiado: true };
}

function entradaIndice(e) {
  const out = {};
  for (const k of CAMPOS_INDICE) {
    if (e[k] !== undefined) out[k] = e[k];
  }
  return out;
}

function publicarOutfit(e, stats) {
  if (!e.manifest || e.erro) {
    stats.pulados++;
    return;
  }

  const manRel = packRel(e.manifest);
  const manSrc = join(LAB, manRel);
  const manDest = join(PACK, manRel);
  const prev = stats.indice[String(e.id)];
  const manifestMudou = Boolean(prev?.manifest && prev.manifest !== e.manifest);
  const rMan = copiar(manSrc, manDest, manifestMudou);
  if (!rMan.ok) {
    stats.falhas.push({ id: e.id, arquivo: manRel, erro: rMan.motivo });
    return;
  }
  if (rMan.copiado) stats.manifests++;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manDest, 'utf-8'));
  } catch (err) {
    stats.falhas.push({ id: e.id, arquivo: manRel, erro: err.message });
    return;
  }

  for (const cat of Object.values(manifest.categories ?? {})) {
    for (const page of cat.pages ?? []) {
      const imgRel = packRel(page.image);
      const imgSrc = join(LAB, imgRel);
      const imgDest = join(PACK, imgRel);
      const rImg = copiar(imgSrc, imgDest, manifestMudou);
      if (!rImg.ok) {
        stats.falhas.push({ id: e.id, arquivo: imgRel, erro: rImg.motivo });
        return;
      }
      if (rImg.copiado) stats.atlas++;
    }
  }

  stats.indice[String(e.id)] = entradaIndice(e);
  stats.publicados++;
}

function main() {
  if (!existsSync(INDICE_LAB)) {
    console.error('lab-index ausente — rode: npm run nomeador:build');
    process.exit(1);
  }

  const lab = JSON.parse(readFileSync(INDICE_LAB, 'utf-8'));
  let entradas = Object.values(lab.outfits ?? {});

  if (APENAS?.length) {
    entradas = entradas.filter((e) => APENAS.includes(String(e.kind).toLowerCase()));
  } else if (!TUDO) {
    entradas = entradas.filter((e) => ['pokemon', 'shiny'].includes(String(e.kind).toLowerCase()));
  }

  const indiceJogo = existsSync(INDICE_JOGO)
    ? JSON.parse(readFileSync(INDICE_JOGO, 'utf-8'))
    : { outfits: {} };

  const stats = {
    publicados: 0,
    pulados: 0,
    manifests: 0,
    atlas: 0,
    falhas: [],
    indice: { ...indiceJogo.outfits },
  };

  console.log(`Publicando ${entradas.length} outfits do LAB → ${PACK}`);
  for (const e of entradas) publicarOutfit(e, stats);

  writeFileSync(
    INDICE_JOGO,
    JSON.stringify({ outfits: stats.indice }, null, 2),
    'utf-8',
  );

  const totalIndice = Object.keys(stats.indice).length;
  console.log(
    `\nPronto: ${stats.publicados} outfits publicados` +
      ` (${stats.manifests} manifests, ${stats.atlas} atlas copiados)` +
      `\noutfits-index: ${totalIndice} entradas (${stats.publicados} do lab nesta execução)`,
  );
  if (stats.pulados) console.log(`${stats.pulados} pulados (sem manifest ou com erro de conversão)`);
  if (stats.falhas.length) {
    console.log(`${stats.falhas.length} falha(s):`);
    for (const f of stats.falhas.slice(0, 10)) {
      console.log(`  · id ${f.id} ${f.arquivo}: ${f.erro}`);
    }
    process.exitCode = 1;
  } else {
    console.log('\nPróximo passo: node tools/sincronizar-sprites-jogo.mjs');
  }
}

main();
