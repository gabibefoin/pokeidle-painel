#!/usr/bin/env node
/** Relatório: pares incompletos preenchíveis via aliases do lab ou sprites do jogo. */
import { readFileSync } from 'node:fs';
import { montarPokedex } from './pokedex-catalog.mjs';
import { slugsBusca, jogoDeSlug, entradaJogo } from './jogo-sprites.mjs';
import { labIndex } from '../caminhos.mjs';

const INDICE = labIndex();

const idx = JSON.parse(readFileSync(INDICE, 'utf-8'));
const p = montarPokedex(idx.outfits);

let labAlias = 0;
let jogoNormal = 0;
let jogoShiny = 0;
let aindaFaltando = 0;

for (const g of p.geracoes) {
  for (const e of g.entradas) {
    if (e.normal && e.shiny) continue;
    const tinhaN = !!e.normal;
    const tinhaS = !!e.shiny;
    if (!tinhaN && entradaJogo(e.slug, false)) jogoNormal++;
    if (!tinhaS && entradaJogo(e.slug, true)) jogoShiny++;
    if (e.normal?.fonte === 'lab-alias' || e.shiny?.fonte === 'lab-alias') labAlias++;
    if (!(e.normal || entradaJogo(e.slug, false)) || !(e.shiny || entradaJogo(e.slug, true))) aindaFaltando++;
  }
}

console.log('Pares incompletos preenchíveis:');
console.log('  lab (alias de nome)     — ver montarPokedex');
console.log('  jogo normal disponível ', jogoNormal);
console.log('  jogo shiny disponível  ', jogoShiny);
console.log('  ainda sem nenhuma fonte', aindaFaltando);
console.log('  slugs de busca ex:', slugsBusca('castform_sunny_form').join(', '));
