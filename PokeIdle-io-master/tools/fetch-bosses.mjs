// Espelha o que os BOSSES precisam: a arte do catálogo e os mapas de arena.
//
// O catálogo em si (`world/bossCatalog.json`, 87 entradas) já vem no `fetch-world.mjs`, e é
// só a galeria: nome, arte, categoria, nível e a lista curta de drops. Quem é jogável de
// verdade — com stats, golpes, taxa de entrada e tabela de drops — sai do `/api/game/boss`
// e está transcrito em `game/src/server/game/bosses.mjs`.
//
// As arenas são mapas próprios (`cruel_boss`, `aero_boss`), fora dos 347 de hunt. Nem todas
// estão publicadas: hoje só `cruel_boss` responde, e o script não trata isso como erro.
//
//   node tools/fetch-bosses.mjs [--force]
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ORIGIN, OUT, grab, pool, resumo, stats, exists } from './lib.mjs';

const FORCE = process.argv.includes('--force');
const t0 = Date.now();

// ---------------------------------------------------------------- 1. a arte

const catalogo = JSON.parse(await readFile(join(OUT, 'world/bossCatalog.json'), 'utf8'));
const bosses = Object.values(catalogo).flat();

// `img` é a arte grande do cartão; `icon` só existe em alguns e é a miniatura.
const imagens = [...new Set(bosses.flatMap((b) => [b.img, b.icon].filter(Boolean)))];

console.log(`Espelhando ${imagens.length} imagens de ${bosses.length} bosses\n`);
await pool(imagens, (rel) => grab(ORIGIN + rel, `site${rel}`, FORCE), 'arte   ');

// ------------------------------------------------------------ 2. as arenas

// Os mapas de arena não aparecem no `map-markers`, então a lista é a das arenas que o
// `/api/game/boss` devolve. Manter à mão aqui é melhor do que pedir um token só para isso.
const ARENAS = ['cruel_boss', 'aero_boss'];

console.log('\nmapas de arena');
for (const slug of ARENAS) {
  const destino = `world/maps/${slug}.json`;
  if (!FORCE && (await exists(join(OUT, destino)))) {
    console.log(`  ${slug}: já em cache`);
    continue;
  }
  try {
    await grab(`${ORIGIN}/game/maps/${slug}.json`, destino, FORCE);
    console.log(`  ${slug}: ok`);
  } catch (err) {
    // 404 é o caso normal de uma arena que eles ainda não publicaram — não é falha nossa.
    console.log(`  ${slug}: indisponível (${err.message}) — o boss fica sem arena e não entra`);
    stats.falhas = stats.falhas.filter((f) => !String(f.url ?? f).includes(slug));
  }
}

console.log(
  '\nDepois disto, gere a grade andável da arena:\n' +
    '  node tools/build-walkgrids.mjs',
);
resumo(t0);
