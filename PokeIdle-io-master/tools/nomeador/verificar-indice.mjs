#!/usr/bin/env node
/** Varredura de saúde do lab-index + PNGs. */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spritesRaiz } from '../caminhos.mjs';

const RAIZ = spritesRaiz();
const INDICE = join(RAIZ, 'LAB', 'lab-index.json');

const idx = JSON.parse(readFileSync(INDICE, 'utf-8'));
let misId = 0;
let misMd5 = 0;
let misMan = 0;
let missing = 0;
const dupChave = new Map();

for (const [k, e] of Object.entries(idx.outfits)) {
  if (String(e.id) !== String(k)) misId++;
  const p = join(RAIZ, (e.arquivo || '').replace(/\//g, '\\'));
  if (!existsSync(p)) { missing++; continue; }
  const h = createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 16);
  const esp = String(e.chave || '').split('#')[0];
  if (h !== esp) misMd5++;
  const m = String(e.manifest || '').match(/outfits-male-(\d+)-/);
  if (m && m[1] !== String(k)) misMan++;
  const c = e.chave || h;
  dupChave.set(c, (dupChave.get(c) || 0) + 1);
}
const dups = [...dupChave.entries()].filter(([, n]) => n > 1).length;

console.log('sprites:', Object.keys(idx.outfits).length);
console.log('id desalinhado:', misId, misId ? '-> python tools/nomeador/reparar-indice.py' : 'ok');
console.log('PNG ausente:', missing);
console.log('md5 != chave:', misMd5);
console.log('manifest != id:', misMan, misMan ? '-> python tools/nomeador/reparar-indice.py' : 'ok');
console.log('chaves duplicadas (esperado p/ clones):', dups);
process.exit(misId || misMd5 || misMan || missing ? 1 : 0);
