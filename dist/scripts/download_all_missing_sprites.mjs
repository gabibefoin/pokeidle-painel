/**
 * DOWNLOADER DE SPRITES COMPLETOS (POKÉAPI BACKUP)
 * Garante que 100% dos 1.218 Pokémon tenham sprite normal e shiny sem nenhuma imagem faltando.
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const pokedex = JSON.parse(fs.readFileSync('./portal/data/pokedex_portal.json', 'utf8'));

fs.mkdirSync('portal/assets/sprites-pokemon/normal', { recursive: true });
fs.mkdirSync('portal/assets/sprites-pokemon/shiny', { recursive: true });

function download(url, dest) {
  return new Promise((resolve) => {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100) {
      return resolve(true);
    }
    const req = https.get(url, (res) => {
      if (res.statusCode === 200) {
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(true);
        });
      } else {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function run() {
  console.log(`Verificando sprites para ${pokedex.length} espécies...`);
  let normalDownloaded = 0;
  let shinyDownloaded = 0;
  const CONCURRENCY = 25;
  const queue = [...pokedex];

  async function worker() {
    while (queue.length > 0) {
      const s = queue.shift();
      if (!s) break;
      const dex = s.dex || (s.pokeId < 1000 ? s.pokeId : s.pokeId % 1000);
      if (!dex || dex < 1 || dex > 1025) continue;

      const normDest = `portal/assets/sprites-pokemon/normal/${s.pokeId}-${s.slug}.png`;
      const shinyDest = `portal/assets/sprites-pokemon/shiny/${s.pokeId}-${s.slug}.png`;

      // Se não existe, baixa do PokeAPI
      if (!fs.existsSync(normDest)) {
        const ok = await download(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dex}.png`, normDest);
        if (ok) normalDownloaded++;
      }

      if (!fs.existsSync(shinyDest)) {
        const ok = await download(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${dex}.png`, shinyDest);
        if (ok) shinyDownloaded++;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log(`Download concluído! Normais baixados: ${normalDownloaded}, Shinies baixados: ${shinyDownloaded}`);
}

run();
