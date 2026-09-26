// Renderiza os 347 mapas para PNG usando o Chrome headless.
//
// O renderizador vive no browser (precisa decodificar .webp e desenhar em canvas), então o
// jeito mais simples de gerar arquivo é apontar o Chrome para public/_mapexport.html?slug=X
// — que desenha o canvas colado no canto — e capturar a página inteira. Para isso o tamanho
// da janela precisa bater com o canvas, então recalculamos aqui a mesma conta de mapview.mjs.
//
//   node tools/export-map-pngs.mjs                 todos os que faltam (~1,8 GB em 1×)
//   node tools/export-map-pngs.mjs --escala=0.5    metade da resolução (~450 MB)
//   node tools/export-map-pngs.mjs charizard onix  só esses
//   node tools/export-map-pngs.mjs --force
//
// Requer o servidor no ar (npm start).
import { readFile, mkdir, access, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT } from './lib.mjs';

const exec = promisify(execFile);
const BASE = process.env.LAB_URL || 'http://localhost:5173';
const DESTINO = join(OUT, 'world/maps-png');
const MAPAS = join(OUT, 'world/maps');

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const existe = (p) => access(p).then(() => true, () => false);

async function acharChrome() {
  for (const c of CHROMES) if (await existe(c)) return c;
  throw new Error('Chrome/Edge não encontrado — ajuste CHROMES em tools/export-map-pngs.mjs');
}

// Mesma conta de mapview.mjs: limites em tile de tela + margem, e queda para 0,5× acima de 12MP.
// Com --escala=N a escala é forçada, e o mesmo N vai na query para o renderizador usar.
async function dimensoes(slug, forcada) {
  const mapa = JSON.parse(await readFile(join(MAPAS, `${slug}.json`), 'utf8'));
  const meta = mapa._meta ?? {};
  const groundZ = meta.groundZ ?? meta.range?.[4] ?? 7;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of mapa.tiles) {
    const sx = t[0] + (t[2] - groundZ);
    const sy = t[1] + (t[2] - groundZ);
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  const MARGEM = 96;
  const w = (maxX - minX + 1) * 32 + MARGEM;
  const h = (maxY - minY + 1) * 32 + MARGEM;
  const s = forcada ?? (w * h > 12e6 ? 0.5 : 1);
  return { w: Math.ceil(w * s), h: Math.ceil(h * s), escala: s, tiles: mapa.tiles.length };
}

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const ESCALA = argv.find((a) => a.startsWith('--escala='))?.split('=')[1];
const escalaForcada = ESCALA ? Number(ESCALA) : undefined;
const pedidos = argv.filter((a) => !a.startsWith('--'));

const chrome = await acharChrome();
await mkdir(DESTINO, { recursive: true });

const slugs = pedidos.length
  ? pedidos
  : (await readdir(MAPAS)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

console.log(`Renderizando ${slugs.length} mapas → ${DESTINO}`);
console.log(`Chrome: ${chrome}\nServidor: ${BASE}\n`);

let feitos = 0;
let pulados = 0;
const falhas = [];
const t0 = Date.now();

for (const slug of slugs) {
  const destino = join(DESTINO, `${slug}.png`);
  if (!FORCE && (await existe(destino))) {
    pulados++;
    continue;
  }

  try {
    const { w, h, escala, tiles } = await dimensoes(slug, escalaForcada);
    await exec(
      chrome,
      [
        '--headless=old',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--default-background-color=00000000', // fundo transparente
        `--window-size=${w},${h}`,
        '--virtual-time-budget=90000',
        `--screenshot=${destino}`,
        `${BASE}/_mapexport.html?slug=${encodeURIComponent(slug)}${escalaForcada ? `&escala=${escalaForcada}` : ''}`,
      ],
      { timeout: 180000, windowsHide: true },
    ).catch((e) => {
      // o Chrome headless costuma sair com código != 0 mesmo escrevendo o arquivo
      if (!e.code && !e.killed) throw e;
    });

    if (!(await existe(destino))) throw new Error('Chrome não gerou o arquivo');
    feitos++;
    const seg = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(`\r  ${feitos + pulados}/${slugs.length}  ${slug.padEnd(20)} ${w}×${h} @${escala}× (${tiles} tiles)  ${seg}s      `);
  } catch (err) {
    falhas.push({ slug, erro: err.message });
  }
}

process.stdout.write('\n');
console.log(`\nPronto em ${((Date.now() - t0) / 1000).toFixed(0)}s — ${feitos} renderizados, ${pulados} já existiam, ${falhas.length} falhas.`);
for (const f of falhas.slice(0, 10)) console.log(`  · ${f.slug}: ${f.erro}`);
