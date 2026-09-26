#!/usr/bin/env node
/**
 * Publica a arte das MEGA EVOLUÇÕES a partir do `Pokedex Backup/MEGAS`.
 *
 *   node tools/publicar-sprites-megas.mjs
 *   node tools/publicar-sprites-megas.mjs --dry-run
 *
 * Fluxo, o mesmo de `publicar-sprites-backup.mjs`:
 *   Desktop/Pokedex Backup/MEGAS/mega_<slug>.png   → converter.py → public/data/asset-packs/
 *   Desktop/Pokedex Backup/MEGAS/mega_<slug>_shiny.png
 *
 * Looktypes: `80000 + dex` (mega comum) e `85000 + dex` (mega shiny) — ver `shared/megas.mjs`.
 *
 * ### Por que é um tool separado, e ADITIVO
 *
 * `publicar-sprites-backup.mjs` varre as nove pastas de geração e REESCREVE o
 * `shiny-catalogo-novos.json` inteiro a partir do que achou. Rodar a publicação das megas por
 * dentro dele custaria os 1.354 sprites do backup de novo a cada ajuste numa mega — e, pior,
 * um engano na lista apagaria o catálogo de shiny do jogo inteiro.
 *
 * Aqui só se mexe no `outfits-index.json`, e só MESCLANDO: as chaves que já existem ficam
 * como estão, as 63 das megas entram. É o que mantém o envio para produção do tamanho do que
 * mudou (ver HOSPEDAGEM.md) em vez do pacote inteiro de 700 MB.
 *
 * As megas NÃO entram no `shiny-catalogo-novos.json`: aquele catálogo é o que diz quais
 * ESPÉCIES têm forma shiny e alimenta o sorteio da captura, e mega não se captura.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEGAS, looktypeMega, looktypeMegaShiny } from '../game/src/shared/megas.mjs';
import { pokedexBackup } from './caminhos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const PACK = join(RAIZ, 'public', 'data', 'asset-packs');
const INDICE_JOGO = join(PACK, 'outfits-index.json');
const INDICE_MEGAS = join(PACK, 'megas-sprites-index.json');
const CACHE = join(RAIZ, 'tools', '.cache');
const REPARADAS = join(CACHE, 'megas-reparadas');
const PYTHON = process.env.PYTHON || 'python';
const CONVERTER = join(AQUI, 'nomeador', 'publicar-backup.py');
const REPARADOR = join(AQUI, 'nomeador', 'reparar-folhas.py');

/** Largura de folha que o converter aceita: 4 colunas (as quatro direções) inteiras. */
const larguraValida = (png) => {
  // O cabeçalho IHDR do PNG: 8 bytes de assinatura, 4 de tamanho, 4 de tipo, 4 de largura.
  const buf = readFileSync(png);
  return buf.readUInt32BE(16) % 4 === 0;
};

/** A pasta do backup em que a arte das megas mora. */
export const PASTA_MEGAS = 'MEGAS';

/**
 * Jobs de conversão, mais a lista de folhas APARADAS que precisam de conserto antes.
 *
 * Duas shinys do backup vieram com a moldura transparente cortada (`mega_pidgeot_shiny.png`
 * em 251×184 e `mega_tyranitar_shiny.png` em 247×191, contra os 256×192 das comuns), e folha
 * cuja largura não divide em 4 o converter recusa. Em vez de falhar a publicação inteira por
 * causa da moldura, a folha é recomposta a partir da versão comum do MESMO pokémon (ver
 * `nomeador/reparar-folhas.py`) numa cópia em `tools/.cache` — o backup do usuário não é
 * tocado. O conserto sai no log, porque re-exportar o PNG certo continua sendo o certo.
 */
export function montarJobs(backupRaiz) {
  const base = join(backupRaiz, PASTA_MEGAS);
  const jobs = [];
  const faltando = [];
  const reparos = [];

  for (const m of MEGAS) {
    const normal = join(base, `mega_${m.slug}.png`);
    if (existsSync(normal)) {
      jobs.push({
        oid: looktypeMega(m.dex),
        dex: m.dex,
        slug: m.slug,
        shiny: false,
        nome: `mega_${m.slug}`,
        png: normal,
      });
    } else {
      faltando.push(`mega_${m.slug}.png`);
    }

    if (m.semShiny) continue;
    const shiny = join(base, `mega_${m.slug}_shiny.png`);
    if (existsSync(shiny)) {
      let png = shiny;
      if (existsSync(normal) && !larguraValida(shiny)) {
        png = join(REPARADAS, `mega_${m.slug}_shiny.png`);
        reparos.push({ ref: normal, cortada: shiny, destino: png });
      }
      jobs.push({
        oid: looktypeMegaShiny(m.dex),
        dex: m.dex,
        slug: m.slug,
        shiny: true,
        nome: `mega_shiny_${m.slug}`,
        png,
      });
    } else {
      faltando.push(`mega_${m.slug}_shiny.png`);
    }
  }

  jobs.sort((a, b) => a.dex - b.dex || Number(a.shiny) - Number(b.shiny));
  return { jobs, faltando, reparos };
}

function rodarPython(script, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [script, ...args], {
      cwd: RAIZ,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    proc.stdout?.on('data', (d) => process.stdout.write(d));
    proc.stderr?.on('data', (d) => { err += d; process.stderr.write(d); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      const e = new Error(`${script} falhou (código ${code})`);
      e.err = err;
      e.code = code;
      reject(e);
    });
  });
}

/** Mescla as megas no `outfits-index.json` sem tocar em nada que já estava lá. */
function mesclarOutfitsIndex(resultado) {
  const prev = existsSync(INDICE_JOGO) ? JSON.parse(readFileSync(INDICE_JOGO, 'utf-8')) : { outfits: {} };
  const outfits = { ...prev.outfits };
  for (const [id, e] of Object.entries(resultado.outfits)) {
    outfits[id] = {
      id: e.id,
      gender: e.gender,
      category: e.category,
      manifest: e.manifest,
      colorizable: e.colorizable,
      directions: e.directions,
      frames: e.frames,
      width: e.width,
      height: e.height,
      name: e.name,
      // `mega` e `mega-shiny` no lugar de `pokemon`/`shiny`: o índice é a única lista que
      // enumera tudo o que o cliente sabe desenhar, e é nela que uma auditoria futura precisa
      // achar as megas sem cruzar faixa de número.
      kind: e.shiny ? 'mega-shiny' : 'mega',
    };
  }
  writeFileSync(INDICE_JOGO, JSON.stringify({ outfits }, null, 2), 'utf-8');
  return Object.keys(outfits).length;
}

export async function publicarSpritesMegas(opts = {}) {
  const backupRaiz = opts.backupRaiz || process.env.POKEDEX_BACKUP || pokedexBackup();
  const dryRun = Boolean(opts.dryRun);

  console.log(`Fonte: ${join(backupRaiz, PASTA_MEGAS)}`);
  console.log(`Destino: ${PACK}`);
  console.log(`Looktypes: mega=80000+dex · mega shiny=85000+dex\n`);

  const { jobs, faltando, reparos } = montarJobs(backupRaiz);
  console.log(`megas na tabela: ${MEGAS.length} · jobs: ${jobs.length}`);
  if (faltando.length) {
    console.log(`PNG ausentes (${faltando.length}): ${faltando.join(', ')}`);
  }
  if (!jobs.length) throw new Error('nenhum PNG de mega encontrado');

  if (dryRun) {
    console.log('\n(dry-run — nada escrito)');
    for (const j of jobs.slice(0, 4)) console.log(' ', j.oid, j.nome, j.png);
    if (reparos.length) console.log(`  a reparar: ${reparos.map((r) => r.cortada).join(', ')}`);
    return { dryRun: true, jobs: jobs.length, faltando, reparos: reparos.length };
  }

  mkdirSync(CACHE, { recursive: true });
  if (reparos.length) {
    mkdirSync(REPARADAS, { recursive: true });
    const paresPath = join(CACHE, 'megas-reparar.json');
    writeFileSync(paresPath, JSON.stringify(reparos, null, 2), 'utf-8');
    console.log(`\n→ ${reparos.length} folha(s) APARADA(s) no backup — recompondo pela folha comum:`);
    await rodarPython(REPARADOR, ['--pares', paresPath]);
    console.log('  (o backup NÃO foi alterado — reexporte esses PNG em 256×192 quando puder)');
  }

  const jobsPath = join(CACHE, 'megas-publicar.jobs.json');
  const resultadoPath = join(CACHE, 'megas-publicar.resultado.json');
  writeFileSync(jobsPath, JSON.stringify(jobs, null, 2), 'utf-8');

  console.log('\n→ Convertendo PNG → atlas WEBP…');
  await rodarPython(CONVERTER, ['--jobs', jobsPath, '--saida', PACK, '--resultado', resultadoPath]);

  const resultado = JSON.parse(readFileSync(resultadoPath, 'utf-8'));
  const total = mesclarOutfitsIndex(resultado);
  writeFileSync(INDICE_MEGAS, JSON.stringify({
    geradoEm: new Date().toISOString(),
    backupRaiz,
    looktypeMegaBase: 80000,
    looktypeMegaShinyBase: 85000,
    faltando,
    reparadas: reparos.map((r) => r.cortada),
    ...resultado,
  }, null, 2), 'utf-8');

  try { unlinkSync(jobsPath); } catch { /* ok */ }

  console.log(`\noutfits-index: +${Object.keys(resultado.outfits).length} megas (${total} no total)`);
  console.log('Pronto. Reinicie o npm start e dê hard refresh no browser.');
  return { ok: true, ...resultado, faltando, reparos: reparos.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  publicarSpritesMegas({ dryRun: process.argv.includes('--dry-run') }).catch((e) => {
    console.error('\n' + (e.message || e));
    if (e.err) console.error(e.err);
    process.exit(typeof e.code === 'number' ? e.code : 1);
  });
}
