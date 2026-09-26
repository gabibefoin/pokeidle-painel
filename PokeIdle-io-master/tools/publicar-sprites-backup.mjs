#!/usr/bin/env node
/**
 * Publica sprites a partir SOMENTE do Pokedex Backup (fonte oficial).
 *
 *   node tools/publicar-sprites-backup.mjs
 *   node tools/publicar-sprites-backup.mjs --dry-run
 *
 * Fluxo:
 *   Desktop/Pokedex Backup/Geração N/###_slug.png
 *     → converter.py → public/data/asset-packs/
 *     → creatures-sprites-lab.json + shiny-catalogo-novos.json
 *
 * Looktypes estáveis (sem LAB):
 *   normal  = 60000 + dex nacional
 *   shiny   = 70000 + dex nacional
 *
 * Variável de ambiente: POKEDEX_BACKUP (padrão Desktop/Pokedex Backup)
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { montarPokedexOficial, caminhoArquivoBackup } from './nomeador/pokedex-oficial.mjs';
import { ehFormaAlternativa } from './nomeador/importar-do-backup.mjs';
import { NOMES_OMITIDOS } from './nomeador/spawns-filtro.mjs';
import { isEspelhoFantasmaPokeId, isOutlandPokeId } from '../game/src/shared/outland.mjs';
import { dexSpriteBaseOutland } from '../game/src/shared/outland-sprite-dex.mjs';
import { pokedexBackup } from './caminhos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const BACKUP_PADRAO = pokedexBackup();
const PACK = join(RAIZ, 'public', 'data', 'asset-packs');
const INDICE_JOGO = join(PACK, 'outfits-index.json');
const INDICE_BACKUP = join(PACK, 'backup-sprites-index.json');
const DADOS = join(RAIZ, 'game', 'src', 'server', 'dados');
const PYTHON = process.env.PYTHON || 'python';
const CONVERTER = join(AQUI, 'nomeador', 'publicar-backup.py');

export const LT_NORMAL_BASE = 60000;
export const LT_SHINY_BASE = 70000;

export function looktypeBackup(dex, shiny = false) {
  const base = shiny ? LT_SHINY_BASE : LT_NORMAL_BASE;
  return base + Number(dex);
}

function dexDe(pokeId) {
  return pokeId < 1000 ? pokeId : pokeId % 1000;
}

function slug(nome) {
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019.]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
}

/**
 * Folhas em que a deteccao automatica de grade erra — `dex: [largura, altura, frames]`.
 *
 * `detectar_grade` (em `nomeador/converter.py`) acerta em 1.354 das 1.356 folhas do backup. O
 * caso que ela erra e sempre o mesmo: folha de 4 colunas cujas poses se TOCAM na vertical. A
 * contagem de faixas de conteudo devolve 1, a regra cai no desempate ("o quadro mais proximo
 * de quadrado, preferindo 3 frames") e, quando os dois candidatos estao a mesma distancia do
 * quadrado, ela escolhe o de 3.
 *
 * Totodile e exatamente isso: 256x288 com quadro de 64x32 e 9 frames. Os candidatos 32 e 96
 * empatam contra os 64 de largura, o desempate pegou 96, e o sprite saiu com TRES poses
 * empilhadas dentro de um quadro so — um Totodile de 2x3 tiles no meio de vizinhos de 2x2.
 *
 * A tabela existe em vez de um conserto na heuristica porque mexer nela mexeria nas outras
 * 1.354 folhas que ja estao certas, e trocar 2 erros por N desconhecidos nao e conserto.
 */
export const GRADE_MANUAL = {
  158: [64, 32, 9], // Totodile
};

function shinyTier(c) {
  const t = (c.baseHp ?? 0) + (c.baseAtk ?? 0) + (c.baseDef ?? 0)
    + (c.baseSpAtk ?? 0) + (c.baseSpDef ?? 0) + (c.baseSpeed ?? 0);
  if (t >= 600) return 'A';
  if (t >= 500) return 'B';
  return 'C';
}

async function montarJobs(backupRaiz) {
  const data = await montarPokedexOficial(backupRaiz);
  const jobs = [];

  for (const g of data.geracoes) {
    if (!g.pasta) continue;
    for (const e of g.entradas) {
      if (ehFormaAlternativa(e.slug)) continue;

      if (e.normal) {
        const png = await caminhoArquivoBackup(backupRaiz, g.id, e.normal.arquivo);
        if (!png) continue;
        jobs.push({
          dex: e.dex,
          slug: e.slug,
          shiny: false,
          nome: e.slug,
          png,
          gen: g.id,
          arquivo: e.normal.arquivo,
          grade: GRADE_MANUAL[e.dex] ?? null,
        });
      }
      if (e.shiny) {
        const png = await caminhoArquivoBackup(backupRaiz, g.id, e.shiny.arquivo);
        if (!png) continue;
        jobs.push({
          dex: e.dex,
          slug: e.slug,
          shiny: true,
          nome: `shiny_${e.slug}`,
          png,
          gen: g.id,
          arquivo: e.shiny.arquivo,
          grade: GRADE_MANUAL[e.dex] ?? null,
        });
      }
    }
  }

  jobs.sort((a, b) => a.dex - b.dex || Number(a.shiny) - Number(b.shiny));
  return { data, jobs };
}

function rodarPython(jobsPath, resultadoPath) {
  return new Promise((resolve, reject) => {
    const args = [
      CONVERTER,
      '--jobs', jobsPath,
      '--saida', PACK,
      '--resultado', resultadoPath,
    ];
    const proc = spawn(PYTHON, args, { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout?.on('data', (d) => { out += d; process.stdout.write(d); });
    proc.stderr?.on('data', (d) => { err += d; process.stderr.write(d); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else {
        const e = new Error(`conversão falhou (código ${code})`);
        e.out = out;
        e.err = err;
        e.code = code;
        reject(e);
      }
    });
  });
}

function sincronizarJogo(resultado, backupRaiz) {
  const formulas = JSON.parse(
    readFileSync(join(RAIZ, 'public', 'data', 'index', 'formulas.json'), 'utf-8'),
  );
  const shinyBase = new Map((formulas.shinyCatalogo ?? []).map((s) => [s.dexId, s]));
  const base = JSON.parse(readFileSync(join(RAIZ, 'public', 'data', 'creatures.json'), 'utf-8')).creatures;
  const novosPath = join(DADOS, 'creatures-novos.json');
  const novos = JSON.parse(readFileSync(novosPath, 'utf-8'));

  const porDexLt = new Map();
  for (const e of Object.values(resultado.outfits)) {
    porDexLt.set(`${e.dex}:${e.shiny ? 's' : 'n'}`, e.id);
  }

  const porDexStats = new Map();
  for (const c of [...base, ...novos.creatures]) {
    const dex = dexDe(c.pokeId);
    if (dex < 1 || dex > 1025) continue;
    if (!porDexStats.has(dex)) porDexStats.set(dex, c);
  }

  const patchMap = new Map();
  function addPatch(c, lt) {
    if (!lt || lt <= 1) return;
    patchMap.set(c.pokeId, { pokeId: c.pokeId, looktype: lt, name: c.name });
  }

  for (const c of base) {
    if (isEspelhoFantasmaPokeId(c.pokeId)) continue;
    if (isOutlandPokeId(c.pokeId)) continue;
    const dex = dexDe(c.pokeId);
    const lt = porDexLt.get(`${dex}:n`);
    if (lt) addPatch(c, lt);
  }

  for (const c of novos.creatures) {
    const dex = dexDe(c.pokeId);
    const lt = porDexLt.get(`${dex}:n`);
    if (lt) {
      c.looktype = lt;
      addPatch(c, lt);
    }
  }

  for (const c of base) {
    if (c.pokeId < 13000 || c.pokeId >= 14000) continue;
    const nacional = base.find((x) => x.pokeId === c.pokeId - 13000);
    const ltN = patchMap.get(nacional?.pokeId)?.looktype
      ?? porDexLt.get(`${dexDe(nacional?.pokeId)}:n`);
    if (ltN) addPatch(c, ltN);
  }

  for (const c of base) {
    if (!isOutlandPokeId(c.pokeId)) continue;
    const baseDex = dexSpriteBaseOutland(c.pokeId, c.name);
    if (!baseDex) continue;
    const ltN = patchMap.get(baseDex)?.looktype ?? porDexLt.get(`${baseDex}:n`);
    if (ltN) addPatch(c, ltN);
  }

  const patches = [...patchMap.values()].sort((a, b) => a.pokeId - b.pokeId);

  const shinies = [];
  for (const [key, meta] of Object.entries(resultado.outfits)) {
    if (!meta.shiny) continue;
    const c = porDexStats.get(meta.dex);
    const nome = c?.name ?? meta.slug;
    if (NOMES_OMITIDOS.has(nome)) continue;
    const baseSh = shinyBase.get(meta.dex);
    shinies.push({
      dexId: meta.dex,
      name: nome,
      looktype: Number(key),
      tier: c ? shinyTier(c) : (baseSh?.tier ?? 'C'),
      count: baseSh?.count ?? 3,
    });
  }
  shinies.sort((a, b) => a.dexId - b.dexId);

  writeFileSync(novosPath, JSON.stringify(novos, null, 2), 'utf-8');
  writeFileSync(
    join(DADOS, 'creatures-sprites-lab.json'),
    JSON.stringify({
      _leia: 'Looktypes publicados a partir do Pokedex Backup (60000+dex normal, 70000+dex shiny).',
      fonte: backupRaiz,
      patches,
    }, null, 2),
    'utf-8',
  );
  writeFileSync(
    join(DADOS, 'shiny-catalogo-novos.json'),
    JSON.stringify({
      _leia: 'Shiny catalog — sprites do Pokedex Backup (sem LAB/Nomeador).',
      entries: shinies,
      _stats: { total: shinies.length, comManifest: shinies.length },
    }, null, 2),
    'utf-8',
  );

  return { patches: patches.length, shinies: shinies.length };
}

function mesclarOutfitsIndex(resultado) {
  const prev = existsSync(INDICE_JOGO)
    ? JSON.parse(readFileSync(INDICE_JOGO, 'utf-8'))
    : { outfits: {} };
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
      kind: e.kind,
    };
  }
  writeFileSync(INDICE_JOGO, JSON.stringify({ outfits }, null, 2), 'utf-8');
  return Object.keys(resultado.outfits).length;
}

export async function publicarSpritesBackup(opts = {}) {
  const backupRaiz = opts.backupRaiz || process.env.POKEDEX_BACKUP || BACKUP_PADRAO;
  const dryRun = Boolean(opts.dryRun);

  console.log(`Fonte: ${backupRaiz}`);
  console.log(`Destino: ${PACK}`);
  console.log(`Looktypes: normal=${LT_NORMAL_BASE}+dex · shiny=${LT_SHINY_BASE}+dex\n`);

  const { data, jobs } = await montarJobs(backupRaiz);
  console.log(`PNG no backup: ${data.arquivos} · jobs: ${jobs.length}`);

  if (dryRun) {
    console.log('\n(dry-run — nada escrito)');
    console.log('  meowth normal:', jobs.find((j) => j.dex === 52 && !j.shiny));
    console.log('  meowth shiny:', jobs.find((j) => j.dex === 52 && j.shiny));
    return { dryRun: true, jobs: jobs.length };
  }

  mkdirSync(join(RAIZ, 'tools', '.cache'), { recursive: true });
  const jobsPath = join(RAIZ, 'tools', '.cache', 'backup-publicar.jobs.json');
  const resultadoPath = join(RAIZ, 'tools', '.cache', 'backup-publicar.resultado.json');
  writeFileSync(jobsPath, JSON.stringify(jobs, null, 2), 'utf-8');

  console.log('\n→ Convertendo PNG → atlas WEBP…');
  await rodarPython(jobsPath, resultadoPath);

  const resultado = JSON.parse(readFileSync(resultadoPath, 'utf-8'));
  const nIndice = mesclarOutfitsIndex(resultado);
  writeFileSync(INDICE_BACKUP, JSON.stringify({
    geradoEm: new Date().toISOString(),
    backupRaiz,
    looktypeNormalBase: LT_NORMAL_BASE,
    looktypeShinyBase: LT_SHINY_BASE,
    ...resultado,
  }, null, 2), 'utf-8');

  const sync = sincronizarJogo(resultado, backupRaiz);

  try { unlinkSync(jobsPath); } catch { /* ok */ }

  console.log(`\noutfits-index: +${nIndice} do backup (${Object.keys(JSON.parse(readFileSync(INDICE_JOGO, 'utf-8')).outfits).length} total)`);
  console.log(`patches espelho: ${sync.patches}`);
  console.log(`shinies catálogo: ${sync.shinies}`);
  console.log(`  meowth normal lt=${looktypeBackup(52)} · shiny lt=${looktypeBackup(52, true)}`);
  console.log(`  charizard shiny lt=${looktypeBackup(6, true)}`);
  console.log('\nPronto. Reinicie npm start e hard refresh no browser.');

  return { ok: true, ...resultado, sync };
}

const ehCli = process.argv[1] === fileURLToPath(import.meta.url);

if (ehCli) {
  publicarSpritesBackup({ dryRun: process.argv.includes('--dry-run') })
    .catch((e) => {
      console.error('\n' + (e.message || e));
      if (e.err) console.error(e.err);
      process.exit(typeof e.code === 'number' ? e.code : 1);
    });
}
