/**
 * Pokédex OFICIAL — lê só os PNGs em Desktop/Pokedex Backup/Geração N.
 * Nome dos arquivos: ###_slug.png · ###_slug_shiny.png
 */
import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { FAIXAS } from './dex.mjs';
import { carregarCatalogo } from './pokedex-catalog.mjs';

const RE_ARQUIVO = /^(\d+)_([a-z0-9_]+?)(_shiny)?\.png$/i;

function tituloDeSlug(slug) {
  return slug.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function mapaNomesCatalogo() {
  const nomes = new Map();
  for (const g of carregarCatalogo().geracoes) {
    for (const e of g.entradas) nomes.set(e.slug, e.nome);
  }
  return nomes;
}

/** Pastas Geração 1…9 que existirem no backup (não exige todas). */
export async function pastasBackupDisponiveis(backupRaiz) {
  let dirs;
  try {
    dirs = await readdir(backupRaiz);
  } catch (e) {
    throw new Error(`pasta de backup inacessível: ${backupRaiz} (${e.message})`);
  }
  const map = {};
  for (const f of FAIXAS) {
    const hit = dirs.find((d) => {
      const m = d.match(/(\d+)/);
      return m && m[1] === f.id;
    });
    if (hit) map[f.id] = join(backupRaiz, hit);
  }
  return map;
}

function parseArquivo(nome) {
  const m = RE_ARQUIVO.exec(nome);
  if (!m) return null;
  return {
    dex: Number(m[1]),
    slug: m[2].toLowerCase(),
    shiny: Boolean(m[3]),
    arquivo: nome,
  };
}

/**
 * @param {string} backupRaiz
 * @returns {Promise<object>}
 */
export async function montarPokedexOficial(backupRaiz) {
  const nomes = mapaNomesCatalogo();
  const pastas = await pastasBackupDisponiveis(backupRaiz);

  const geracoes = [];

  for (const faixa of FAIXAS) {
    const dir = pastas[faixa.id];
    const porChave = new Map();

    if (dir) {
      const files = await readdir(dir);
      for (const fn of files) {
        if (!fn.toLowerCase().endsWith('.png')) continue;
        const p = parseArquivo(fn);
        if (!p) continue;
        const chave = `${p.dex}:${p.slug}`;
        let rec = porChave.get(chave);
        if (!rec) {
          rec = {
            slug: p.slug,
            dex: p.dex,
            nome: nomes.get(p.slug) ?? tituloDeSlug(p.slug),
            normal: null,
            shiny: null,
          };
          porChave.set(chave, rec);
        }
        const slot = {
          arquivo: fn,
          url: `/backup/${faixa.id}/${encodeURIComponent(fn)}`,
        };
        if (p.shiny) rec.shiny = slot;
        else rec.normal = slot;
      }
    }

    const entradas = [...porChave.values()].sort((a, b) => a.dex - b.dex || a.slug.localeCompare(b.slug));
    let comNormal = 0;
    let comShiny = 0;
    let completos = 0;
    for (const e of entradas) {
      if (e.normal) comNormal++;
      if (e.shiny) comShiny++;
      if (e.normal && e.shiny) completos++;
    }

    geracoes.push({
      id: faixa.id,
      rotulo: faixa.rotulo,
      regiao: faixa.regiao,
      min: faixa.min,
      max: faixa.max,
      total: entradas.length,
      pasta: dir ?? null,
      stats: { comNormal, comShiny, completos },
      entradas,
    });
  }

  let arquivos = 0;
  for (const g of geracoes) arquivos += g.stats.comNormal + g.stats.comShiny;

  return {
    fonte: 'backup',
    backupRaiz,
    arquivos,
    geracoes,
  };
}

/** Resolve caminho seguro de um PNG no backup (gen id + nome do arquivo). */
export async function caminhoArquivoBackup(backupRaiz, genId, arquivo) {
  const pastas = await pastasBackupDisponiveis(backupRaiz);
  const dir = pastas[String(genId)];
  if (!dir) return null;
  const nome = basename(decodeURIComponent(String(arquivo || '')));
  if (!RE_ARQUIVO.test(nome)) return null;
  const file = join(dir, nome);
  if (!file.startsWith(dir)) return null;
  return file;
}

export async function statBackup(backupRaiz) {
  try {
    await stat(backupRaiz);
    const data = await montarPokedexOficial(backupRaiz);
    return { ok: true, arquivos: data.arquivos, backupRaiz };
  } catch (e) {
    return { ok: false, erro: String(e.message || e), backupRaiz };
  }
}
