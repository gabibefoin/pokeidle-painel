#!/usr/bin/env node
/**
 * Garante que a Pokédex Lab não regrediu em relação ao baseline congelado.
 *
 *   node tools/nomeador/verificar-pokedex-lab.mjs
 *   node tools/nomeador/verificar-pokedex-lab.mjs --atualizar   # regrava baseline (só quando você FIXOU de propósito)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarPokedex } from './pokedex-catalog.mjs';
import { spritesRaiz } from '../caminhos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(AQUI, 'pokedex-lab-baseline.json');
const RAIZ = spritesRaiz();
const INDICE = join(RAIZ, 'LAB', 'lab-index.json');
const ATUALIZAR = process.argv.includes('--atualizar');

function carregarIndice() {
  return JSON.parse(readFileSync(INDICE, 'utf-8'));
}

function snapshot(outfits) {
  const dex = montarPokedex(outfits);
  const entradas = {};
  for (const g of dex.geracoes) {
    for (const e of g.entradas) {
      const rec = { slug: e.slug, dex: e.dex, nome: e.nome };
      for (const slot of ['normal', 'shiny']) {
        const s = e[slot];
        if (!s) continue;
        rec[slot] = {
          fonte: s.fonte,
          id: s.id,
          name: s.name,
          manifest: s.manifest,
          looktype: s.looktype ?? null,
        };
        if (s.fonte === 'lab' || s.fonte === 'lab-alias') {
          const lab = outfits[String(s.id)];
          if (lab?.chave) rec[slot].chave = String(lab.chave).split('#')[0];
        }
      }
      entradas[e.slug] = rec;
    }
  }
  return {
    gerado: new Date().toISOString(),
    entradas,
  };
}

function comparar(atual, base) {
  const erros = [];
  const avisos = [];

  for (const [slug, esperado] of Object.entries(base.entradas)) {
    const got = atual.entradas[slug];
    if (!got) {
      erros.push(`${slug}: espécie sumiu do catálogo`);
      continue;
    }
    for (const slot of ['normal', 'shiny']) {
      const e = esperado[slot];
      if (!e) continue;
      const g = got[slot];
      if (!g) {
        erros.push(`${slug} ${slot}: slot sumiu (era ${e.fonte} id ${e.id})`);
        continue;
      }
      if ((e.fonte === 'lab' || e.fonte === 'lab-alias') && g.fonte === 'jogo') {
        erros.push(`${slug} ${slot}: caiu para espelho · jogo (era lab id ${e.id})`);
        continue;
      }
      if (e.fonte !== g.fonte) {
        avisos.push(`${slug} ${slot}: fonte ${e.fonte} → ${g.fonte}`);
      }
      if (e.id !== g.id) {
        erros.push(`${slug} ${slot}: id ${e.id} → ${g.id ?? '?'}`);
      }
      if (e.chave && g.chave && e.chave !== g.chave) {
        erros.push(`${slug} ${slot}: PNG mudou (chave ${e.chave} → ${g.chave})`);
      } else if (e.manifest && g.manifest && e.manifest !== g.manifest) {
        // Só exige manifest igual se a chave do PNG também divergiu (build regera o hash do .json).
        if (!e.chave || !g.chave) {
          erros.push(`${slug} ${slot}: manifest mudou`);
        }
      }
    }
  }

  return { erros, avisos };
}

function atlasVazio(outfits, base) {
  const erros = [];
  for (const e of Object.values(base.entradas)) {
    for (const slot of ['normal', 'shiny']) {
      const s = e[slot];
      if (!s || s.fonte === 'jogo' || !s.id) continue;
      const lab = outfits[String(s.id)];
      if (!lab?.manifest) continue;
      const manPath = join(RAIZ, 'LAB', lab.manifest.replace(/^\/assets-packs\//, '').replace(/\//g, '\\'));
      if (!existsSync(manPath)) {
        erros.push(`${e.slug} ${slot}: manifest ausente ${lab.manifest}`);
        continue;
      }
      try {
        const doc = JSON.parse(readFileSync(manPath, 'utf-8'));
        const cat = doc.categories?.[lab.category || `outfits/male/${s.id}`];
        const bytes = cat?.pages?.[0]?.bytes ?? 0;
        if (bytes < 200) {
          erros.push(`${e.slug} ${slot}: atlas quase vazio (${bytes} bytes, id ${s.id})`);
        }
      } catch {
        erros.push(`${e.slug} ${slot}: manifest ilegível`);
      }
    }
  }
  return erros;
}

const outfits = carregarIndice().outfits;
const atual = snapshot(outfits);

if (ATUALIZAR) {
  writeFileSync(BASELINE, `${JSON.stringify(atual, null, 2)}\n`);
  const labSlots = Object.values(atual.entradas).reduce((n, e) => {
    let c = 0;
    if (e.normal?.fonte === 'lab' || e.normal?.fonte === 'lab-alias') c++;
    if (e.shiny?.fonte === 'lab' || e.shiny?.fonte === 'lab-alias') c++;
    return n + c;
  }, 0);
  console.log(`baseline atualizado: ${Object.keys(atual.entradas).length} espécies, ${labSlots} slots lab`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error('baseline ausente. Rode: npm run nomeador:snapshot-pokedex');
  process.exit(1);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf-8'));
const { erros, avisos } = comparar(atual, base);
erros.push(...atlasVazio(outfits, base));

console.log(`baseline: ${base.gerado?.slice(0, 10) ?? '?'}`);
console.log(`lab-index: ${Object.keys(outfits).length} outfits`);

if (avisos.length) {
  console.log('\navisos:', avisos.length);
  for (const a of avisos.slice(0, 10)) console.log('  ~', a);
}

if (erros.length) {
  console.error('\nFALHOU — Pokédex Lab regrediu:');
  for (const e of erros.slice(0, 30)) console.error('  ✗', e);
  if (erros.length > 30) console.error(`  … +${erros.length - 30} erros`);
  console.error('\nCorrija e rode npm run nomeador:reparar. Só atualize o baseline se a mudança for intencional:');
  console.error('  npm run nomeador:snapshot-pokedex');
  process.exit(1);
}

console.log('ok — Pokédex Lab igual ao baseline congelado');
process.exit(0);
