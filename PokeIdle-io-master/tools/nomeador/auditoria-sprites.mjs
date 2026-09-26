#!/usr/bin/env node
/**
 * Varredura: espécie → looktype → nome real no lab-index.
 * Lista onde o sprite no atlas não bate com o nome da espécie.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarPokedex } from './pokedex-catalog.mjs';
import { hunts, especies } from '../../game/src/server/content.mjs';
import { labIndex } from '../caminhos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../..');
const LAB = labIndex();
const labOutfits = JSON.parse(readFileSync(LAB, 'utf8')).outfits;
const pokedex = montarPokedex(labOutfits);
const porSlug = new Map(pokedex.geracoes.flatMap((g) => g.entradas).map((e) => [e.slug, e]));

function slug(nome) {
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019.]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
}

function especieDe(name) {
  return String(name || '')
    .replace(/^shiny_/, '')
    .replace(/_shiny$/, '')
    .replace(/_\d+$/, '');
}

function casaComEspecie(labEntry, esperadoSlug) {
  if (!labEntry?.name) return false;
  const n = labEntry.name;
  if (n === esperadoSlug) return true;
  if (especieDe(n) === esperadoSlug) return true;
  return false;
}

function auditEspecie(c) {
  const s = slug(c.name);
  const lt = c.looktype;
  if (!lt || lt <= 1) return null;
  const labE = labOutfits[String(lt)];
  const cat = porSlug.get(s);
  const ltCat = cat?.normal?.id ?? cat?.normal?.looktype;
  const okLab = casaComEspecie(labE, s);
  const ltEsperado = ltCat;
  const okLt = lt === ltEsperado;
  if (okLab && okLt) return null;
  return {
    name: c.name,
    pokeId: c.pokeId,
    slug: s,
    looktype: lt,
    labName: labE?.name ?? '?',
    labArquivo: labE?.arquivo ?? '?',
    looktypeCatalogo: ltEsperado ?? null,
    catalogName: cat?.normal?.name ?? null,
    catalogArquivo: cat?.normal?.arquivo ?? null,
    problema: !okLab ? 'sprite-errado' : !okLt ? 'looktype-desatualizado' : 'ok',
  };
}

const erros = [];
for (const esp of especies.values()) {
  const r = auditEspecie(esp);
  if (r) erros.push(r);
}

const huntErros = [];
for (const h of Object.values(hunts)) {
  if (!h?.nome) continue;
  const s = slug(h.nome);
  const pokeId = h.pokemon?.[0]?.pokeId ?? h.spawns?.[0]?.pokeId;
  const esp = pokeId ? especies.get(pokeId) : null;
  const lt = esp?.looktype ?? h.looktype;
  const labE = labOutfits[String(lt)];
  if (!lt || lt <= 1) continue;
  if (!casaComEspecie(labE, s)) {
    huntErros.push({
      slug: h.slug ?? h.key,
      nome: h.nome,
      area: h.area,
      looktypeHunt: h.looktype,
      looktypeUsado: lt,
      labName: labE?.name ?? '?',
      labArquivo: labE?.arquivo ?? '?',
      looktypeEspecie: esp?.looktype,
      pokeId,
    });
  }
}

erros.sort((a, b) => a.name.localeCompare(b.name));
huntErros.sort((a, b) => (a.area ?? '').localeCompare(b.area ?? '') || a.nome.localeCompare(b.nome));

const hoenn = huntErros.filter((h) => h.area === 'hoenn' || String(h.slug).includes('hoenn'));

console.log(`Espécies com sprite errado: ${erros.length}`);
console.log(`Hunts com marcador errado: ${huntErros.length} (Hoenn: ${hoenn.length})`);
console.log('\n--- Hoenn hunts erradas ---');
for (const h of hoenn.slice(0, 40)) {
  console.log(`${h.slug}: ${h.nome} lt=${h.looktypeHunt} → lab=${h.labName} (${h.labArquivo}) espLt=${h.looktypeEspecie}`);
}
if (hoenn.length > 40) console.log(`… +${hoenn.length - 40} mais`);

console.log('\n--- Milotic ---');
console.log(JSON.stringify(erros.find((e) => e.slug === 'milotic'), null, 2));
console.log(JSON.stringify(huntErros.find((h) => h.slug?.includes('milotic')), null, 2));

const outPath = join(AQUI, 'auditoria-sprites.json');
writeFileSync(outPath, JSON.stringify({ erros, huntErros, stats: { especies: erros.length, hunts: huntErros.length, hoenn: hoenn.length } }, null, 2));
console.log('\nRelatório:', outPath);
