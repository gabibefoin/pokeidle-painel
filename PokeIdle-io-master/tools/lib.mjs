// Utilidades compartilhadas pelos downloaders.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORIGIN = 'https://poke.idleworld.online';
export const PACK = '/game/asset-packs';
export const OUT = resolve(fileURLToPath(new URL('../public/data', import.meta.url)));
export const UA = 'Mozilla/5.0 (compatible; sprite-lab/1.0; pesquisa acadêmica)';

export const stats = { baixados: 0, cacheados: 0, bytes: 0, falhas: [] };

export const exists = (p) => access(p).then(() => true, () => false);

// Manifests referenciam "/assets-packs/..."; espelhamos sob data/asset-packs/...
export const packRel = (p) => 'asset-packs/' + p.replace(/^\/assets-packs\//, '');
export const packUrl = (p) => ORIGIN + p.replace(/^\/assets-packs/, PACK);

export async function save(rel, buf) {
  const dest = join(OUT, rel);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  stats.bytes += buf.byteLength;
}

export async function fetchBuf(url, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= tries) throw err;
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    }
  }
}

export const fetchJson = async (url) => JSON.parse((await fetchBuf(url)).toString('utf8'));

/** Baixa url -> OUT/rel, pulando o que já existe (a não ser com force). */
export async function grab(url, rel, force = false) {
  if (!force && (await exists(join(OUT, rel)))) {
    stats.cacheados++;
    return false;
  }
  const buf = await fetchBuf(url);
  await save(rel, buf);
  stats.baixados++;
  return true;
}

/** Pool de concorrência com barra de progresso de uma linha. */
export async function pool(items, worker, label, concurrency = 8) {
  let done = 0;
  const total = items.length;
  if (!total) return;
  const queue = items[Symbol.iterator]();
  const tick = () => {
    done++;
    if (done % 5 === 0 || done === total) {
      const pct = String(Math.round((done / total) * 100)).padStart(3);
      const mb = (stats.bytes / 1024 / 1024).toFixed(0);
      process.stdout.write(`\r  ${label} ${pct}%  (${done}/${total})  ${mb} MB   `);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, async () => {
      for (const item of queue) {
        try {
          await worker(item);
        } catch (err) {
          stats.falhas.push({ item: String(item?.url ?? item?.slug ?? item?.id ?? item), erro: err.message });
        }
        tick();
      }
    }),
  );
  process.stdout.write('\n');
}

export function resumo(t0) {
  const mb = (stats.bytes / 1024 / 1024).toFixed(1);
  console.log(
    `\nPronto em ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
      `${stats.baixados} arquivos novos (${mb} MB), ${stats.cacheados} em cache.`,
  );
  if (stats.falhas.length) {
    console.log(`${stats.falhas.length} falha(s):`);
    for (const f of stats.falhas.slice(0, 8)) console.log(`  · ${f.item}: ${f.erro}`);
  }
}
