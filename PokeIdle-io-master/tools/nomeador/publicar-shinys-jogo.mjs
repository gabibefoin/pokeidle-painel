#!/usr/bin/env node
/**
 * Varredura completa: todo shiny lab da Pokédex → espelho public/data + shiny-catalogo-novos.
 * Gera relatório e falha se sobrar buraco depois de publicar.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarPokedex } from './pokedex-catalog.mjs';
import { labIndex } from '../caminhos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../..');
const RELATORIO = join(AQUI, 'relatorio-shinys-jogo.json');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function carregarJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function looktypeJogo(dexId, formulas, novos) {
  return novos.entries.find((e) => e.dexId === dexId)?.looktype
    ?? formulas.shinyCatalogo?.find((e) => e.dexId === dexId)?.looktype
    ?? null;
}

function auditar() {
  const lab = carregarJson(labIndex());
  const idx = carregarJson(join(RAIZ, 'public/data/asset-packs/outfits-index.json'));
  const novos = carregarJson(join(RAIZ, 'game/src/server/dados/shiny-catalogo-novos.json'));
  const formulas = carregarJson(join(RAIZ, 'public/data/index/formulas.json'));
  const dex = montarPokedex(lab.outfits);

  const ok = [];
  const falhas = [];

  for (const g of dex.geracoes) {
    for (const e of g.entradas) {
      if (e.shiny?.fonte !== 'lab' && e.shiny?.fonte !== 'lab-alias') continue;
      const lt = e.shiny.id;
      const pub = idx.outfits[String(lt)];
      const man = pub?.manifest?.split('/').pop();
      const manPath = man ? join(RAIZ, 'public/data/asset-packs/categories', man) : null;
      const jogoLt = looktypeJogo(e.dex, formulas, novos);
      const item = {
        dex: e.dex,
        slug: e.slug,
        nome: e.nome,
        shiny: e.shiny.name,
        looktype: lt,
        jogoLooktype: jogoLt,
        publicOk: Boolean(pub && manPath && existsSync(manPath)),
        catalogoOk: jogoLt === lt,
      };
      if (item.publicOk && item.catalogoOk) ok.push(item);
      else falhas.push(item);
    }
  }

  return { ok, falhas, totalLab: ok.length + falhas.length };
}

function baselineDiff() {
  const basePath = join(AQUI, 'pokedex-lab-baseline.json');
  if (!existsSync(basePath)) return [];
  const base = carregarJson(basePath);
  const lab = carregarJson(labIndex());
  const dex = montarPokedex(lab.outfits);
  const mudou = [];
  for (const g of dex.geracoes) {
    for (const e of g.entradas) {
      const cur = e.shiny;
      const ant = base.entradas[e.slug]?.shiny;
      const curLab = cur && (cur.fonte === 'lab' || cur.fonte === 'lab-alias');
      const antLab = ant && (ant.fonte === 'lab' || ant.fonte === 'lab-alias');
      if (curLab && (!antLab || ant.id !== cur.id)) {
        mudou.push({
          dex: e.dex,
          slug: e.slug,
          nome: e.nome,
          shiny: cur.name,
          looktype: cur.id,
          era: ant?.id ?? null,
        });
      }
    }
  }
  mudou.sort((a, b) => a.dex - b.dex);
  return mudou;
}

function rodar(cmd, args) {
  const bin = cmd === 'npm' ? NPM : cmd;
  const comando = [bin, ...args].join(' ');
  const r = spawnSync(comando, { cwd: RAIZ, shell: true, stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log('→ Publicando sprites (force)…');
rodar('npm', ['run', 'publicar:sprites', '--', '--force']);

console.log('\n→ Sincronizando catálogo do jogo…');
rodar('npm', ['run', 'sync:sprites']);

const { ok, falhas, totalLab } = auditar();
const atualizados = baselineDiff();

const rel = {
  gerado: new Date().toISOString(),
  totalLabShiny: totalLab,
  okNoJogo: ok.length,
  falhas: falhas.length,
  atualizadosDesdeBaseline: atualizados,
  falhasDetalhe: falhas,
  exemplos: {
    bagon: ok.find((x) => x.slug === 'bagon') ?? falhas.find((x) => x.slug === 'bagon'),
    metagross: ok.find((x) => x.slug === 'metagross') ?? falhas.find((x) => x.slug === 'metagross'),
    barboach: ok.find((x) => x.slug === 'barboach') ?? falhas.find((x) => x.slug === 'barboach'),
  },
};

writeFileSync(RELATORIO, `${JSON.stringify(rel, null, 2)}\n`);

console.log(`\n=== Varredura completa ===`);
console.log(`Shinys lab na Pokédex: ${totalLab}`);
console.log(`OK no jogo local: ${ok.length}`);
console.log(`Falhas: ${falhas.length}`);
console.log(`Atualizados vs baseline: ${atualizados.length}`);
console.log(`Relatório: ${RELATORIO}`);

if (atualizados.length) {
  console.log('\nShinys novos/atualizados (vs baseline):');
  for (const x of atualizados) {
    console.log(`  #${x.dex} ${x.slug} ${x.shiny} #${x.looktype}${x.era ? ` (era #${x.era})` : ''}`);
  }
}

if (falhas.length) {
  console.error('\nAinda faltando no jogo:');
  for (const f of falhas) {
    console.error(`  #${f.dex} ${f.slug} lt ${f.looktype} public=${f.publicOk} catalogo=${f.catalogoOk}`);
  }
  process.exit(1);
}

console.log('\nBagon:', rel.exemplos.bagon ? `#${rel.exemplos.bagon.looktype} ok` : 'FALHOU');
