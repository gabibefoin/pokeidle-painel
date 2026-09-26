// Mapa espécie → número da Pokédex nacional e faixas de geração.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

export const FAIXAS = [
  { id: '1', rotulo: '1ª gen', regiao: 'Kanto', min: 1, max: 151, total: 151 },
  { id: '2', rotulo: '2ª gen', regiao: 'Johto', min: 152, max: 251, total: 100 },
  { id: '3', rotulo: '3ª gen', regiao: 'Hoenn', min: 252, max: 386, total: 135 },
  { id: '4', rotulo: '4ª gen', regiao: 'Sinnoh', min: 387, max: 493, total: 107 },
  { id: '5', rotulo: '5ª gen', regiao: 'Unova', min: 494, max: 649, total: 156 },
  { id: '6', rotulo: '6ª gen', regiao: 'Kalos', min: 650, max: 721, total: 72 },
  { id: '7', rotulo: '7ª gen', regiao: 'Alola', min: 722, max: 809, total: 88 },
  { id: '8', rotulo: '8ª gen', regiao: 'Galar', min: 810, max: 905, total: 96 },
  { id: '9', rotulo: '9ª gen', regiao: 'Paldea', min: 906, max: 1025, total: 120 },
];

/** Pasta no disco para cada geração (ex.: `1GEN`, `2GEN`). */
export const pastaGen = (id) => `${id}GEN`;
export const PASTAS_GEN = FAIXAS.map((f) => pastaGen(f.id));

const NAO_ESPECIE = /^(trainer|trainer_vip|chansey_enfermeira|anuncio-shinys|anuncio-pvp|tyranitar_mascara)$/;

/** Mesma limpeza do servidor — espelhada aqui para o cliente poder filtrar sem nova ida. */
export function limpar(nome) {
  return nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019.]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/** Extrai o slug da espécie a partir do nome da sprite (shiny, montaria, _revisar…). */
export function especieDe(nome) {
  if (!nome) return null;
  let n = nome;
  if (n.startsWith('shiny_')) n = n.slice(6);
  else if (n.endsWith('_shiny')) n = n.slice(0, -6);
  n = n.replace(/_revisar(_\d+)?/g, '');
  n = n.replace(/_east_sea$/g, '_east').replace(/_west_sea$/g, '_west');
  n = n.replace(/_montaria(_\d+)?$/g, '').replace(/_montaria/g, '');
  n = n.replace(/_\d+$/g, '');
  if (n === 'farfetch') n = 'farfetchd';
  if (!n || NAO_ESPECIE.test(n)) return null;
  return n;
}

export function geracaoDe(dexNum) {
  if (!dexNum) return null;
  for (const f of FAIXAS) if (dexNum >= f.min && dexNum <= f.max) return f.id;
  return null;
}

let dexCache = null;

/** Carrega o mapa slug→dex (Pokédex nacional + overrides locais). */
export function carregarDex() {
  if (dexCache) return dexCache;
  dexCache = JSON.parse(readFileSync(join(AQUI, 'dex-nacional.json'), 'utf-8'));
  return dexCache;
}

export function dexDeNome(nome, dex = carregarDex()) {
  const esp = especieDe(nome);
  return esp ? dex[esp] ?? null : null;
}

export function geracaoDeNome(nome, dex = carregarDex()) {
  return geracaoDe(dexDeNome(nome, dex));
}

/** Contagens por geração para os chips (só sprites nomeadas que são espécie). */
export function statsPorGeracao(entries, dex = carregarDex()) {
  const stats = Object.fromEntries(FAIXAS.map((f) => [f.id, { sprites: 0, especies: new Set() }]));
  stats.sem = { sprites: 0, especies: new Set() };

  for (const e of Object.values(entries)) {
    if (!e.nomeado || e.kind === 'np' || e.kind === 'vazio') continue;
    const esp = especieDe(e.name);
    const num = esp ? dex[esp] : null;
    const g = geracaoDe(num) ?? 'sem';
    stats[g].sprites++;
    if (esp) stats[g].especies.add(esp);
  }

  const saida = {};
  for (const [k, v] of Object.entries(stats)) {
    saida[k] = { sprites: v.sprites, especies: v.especies.size };
  }
  return saida;
}
