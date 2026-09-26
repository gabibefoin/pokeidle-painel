/**
 * Copia os PNGs do lab (normal + shiny) para pastas de backup por geração.
 *
 *   POKEDEX_BACKUP=%USERPROFILE%\Desktop\Pokedex Backup
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { FAIXAS } from './dex.mjs';
import { montarPokedex } from './pokedex-catalog.mjs';
import { pokedexBackup } from '../caminhos.mjs';

const BACKUP_PADRAO = pokedexBackup();

function limparNomeArquivo(slug) {
  return String(slug || 'sem_nome').replace(/[^a-z0-9_]+/gi, '_').slice(0, 48);
}

/** Acha `Geração 1`, `Geracao 1`, etc. dentro do backup. */
export async function pastasGeracaoBackup(backupRaiz) {
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

  const faltando = FAIXAS.filter((g) => !map[g.id]).map((g) => g.rotulo);
  if (faltando.length) {
    throw new Error(
      `faltam pastas no backup (${backupRaiz}): ${faltando.join(', ')} — crie "Geração 1" … "Geração 9"`,
    );
  }
  return map;
}

async function copiarPng(src, dest) {
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
}

/**
 * @param {{ outfits: object, spritesRaiz: string, backupRaiz?: string, geracao?: string }} opts
 * `geracao`: 'all' ou id '1'…'9' — só essa geração
 */
export async function backupPokedex(opts) {
  const { outfits, spritesRaiz } = opts;
  const backupRaiz = opts.backupRaiz || process.env.POKEDEX_BACKUP || BACKUP_PADRAO;
  const filtro = opts.geracao && opts.geracao !== 'all' ? String(opts.geracao) : null;

  const pastas = await pastasGeracaoBackup(backupRaiz);
  const dex = montarPokedex(outfits);

  const resumo = { backupRaiz, copiados: 0, pulados: 0, erros: [], porGeracao: {} };

  for (const g of dex.geracoes) {
    if (filtro && g.id !== filtro) continue;
    const destDir = pastas[g.id];
    if (!destDir) continue;

    let n = 0;
    for (const e of g.entradas) {
      const base = `${String(e.dex).padStart(3, '0')}_${limparNomeArquivo(e.slug)}`;

      for (const [slot, shiny] of [['normal', false], ['shiny', true]]) {
        const s = e[slot];
        if (!s || s.fonte === 'jogo') {
          resumo.pulados++;
          continue;
        }

        const lab = outfits[String(s.id)];
        const rel = lab?.arquivo?.replace(/\\/g, '/');
        if (!rel) {
          resumo.pulados++;
          resumo.erros.push(`${e.slug} ${slot}: sem PNG no lab-index (id ${s.id})`);
          continue;
        }

        const src = join(spritesRaiz, rel);
        try {
          await stat(src);
        } catch {
          resumo.pulados++;
          resumo.erros.push(`${e.slug} ${slot}: PNG ausente ${rel}`);
          continue;
        }

        const ext = extname(rel) || '.png';
        const nome = shiny ? `${base}_shiny${ext}` : `${base}${ext}`;
        const dest = join(destDir, nome);

        try {
          await copiarPng(src, dest);
          n++;
          resumo.copiados++;
        } catch (err) {
          resumo.pulados++;
          resumo.erros.push(`${e.slug} ${slot}: ${err.message}`);
        }
      }
    }
    resumo.porGeracao[g.id] = n;
  }

  return resumo;
}
