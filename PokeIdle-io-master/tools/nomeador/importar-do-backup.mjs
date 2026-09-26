/**
 * Importa PNGs do Desktop/Pokedex Backup → SPRITES_RAIZ/{N}GEN/.
 *
 *   node tools/nomeador/importar-do-backup.mjs
 *
 * Padrão no backup: ###_slug.png · ###_slug_shiny.png
 * Formas alternativas (_form / _forme) são ignoradas — só a variante base entra.
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pokedexBackup, spritesRaiz } from '../caminhos.mjs';
import { pastasBackupDisponiveis } from './pokedex-oficial.mjs';
import { pastaGen } from './dex.mjs';

const BACKUP_PADRAO = pokedexBackup();
const RAIZ_PADRAO = spritesRaiz();
const RE_ARQUIVO = /^(\d+)_([a-z0-9_]+?)(_shiny)?\.png$/i;

/** Castform chuva/sol/neve etc. — mesma espécie, sprite repetido no jogo. */
export function ehFormaAlternativa(slug) {
  return /_(form|forme)(_|$)/i.test(String(slug || ''));
}

function destinoLab(slug, shiny, genId) {
  const pasta = pastaGen(genId);
  if (shiny) {
    return {
      pasta,
      rel: `${pasta}/shiny_${slug}.png`,
      nome: `shiny_${slug}`,
    };
  }
  return { pasta, rel: `${pasta}/${slug}.png`, nome: slug };
}

/**
 * @param {{ backupRaiz?: string, spritesRaiz?: string, dryRun?: boolean }} [opts]
 */
export async function importarDoBackup(opts = {}) {
  const backupRaiz = opts.backupRaiz || process.env.POKEDEX_BACKUP || BACKUP_PADRAO;
  const spritesRaiz = opts.spritesRaiz || process.env.SPRITES_RAIZ || RAIZ_PADRAO;
  const dryRun = Boolean(opts.dryRun);

  const pastas = await pastasBackupDisponiveis(backupRaiz);
  const resumo = {
    backupRaiz,
    spritesRaiz,
    copiados: 0,
    ignorados: 0,
    formas: 0,
    erros: [],
    porGeracao: {},
  };

  for (const [genId, dir] of Object.entries(pastas)) {
    let n = 0;
    const files = await readdir(dir);
    for (const fn of files) {
      if (!fn.toLowerCase().endsWith('.png')) continue;
      const m = RE_ARQUIVO.exec(fn);
      if (!m) {
        resumo.ignorados++;
        continue;
      }

      const slug = m[2].toLowerCase();
      const shiny = Boolean(m[3]);

      if (ehFormaAlternativa(slug)) {
        resumo.formas++;
        continue;
      }

      const { rel } = destinoLab(slug, shiny, genId);
      const src = join(dir, fn);
      const dest = join(spritesRaiz, rel.replace(/\//g, '\\'));

      try {
        await stat(src);
      } catch {
        resumo.erros.push(`${fn}: origem ausente`);
        continue;
      }

      if (dryRun) {
        n++;
        resumo.copiados++;
        continue;
      }

      try {
        await mkdir(join(spritesRaiz, pastaGen(genId)), { recursive: true });
        await copyFile(src, dest);
        n++;
        resumo.copiados++;
      } catch (e) {
        resumo.erros.push(`${fn}: ${e.message}`);
      }
    }
    resumo.porGeracao[genId] = n;
  }

  return resumo;
}

const ehCli = process.argv[1]?.endsWith('importar-do-backup.mjs');

if (ehCli) {
  importarDoBackup({ dryRun: process.argv.includes('--dry-run') })
    .then((r) => {
      console.log(`Backup: ${r.backupRaiz}`);
      console.log(`Sprites: ${r.spritesRaiz}`);
      console.log(`${r.copiados} copiados · ${r.formas} formas ignoradas · ${r.ignorados} arquivos fora do padrão`);
      for (const [g, n] of Object.entries(r.porGeracao)) {
        if (n) console.log(`  gen ${g}: ${n}`);
      }
      if (r.erros.length) {
        console.warn('\nerros:');
        for (const e of r.erros.slice(0, 15)) console.warn(' ', e);
      }
    })
    .catch((e) => {
      console.error(e.message || e);
      process.exit(1);
    });
}
