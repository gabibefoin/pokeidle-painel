/**
 * Reconstrói mapas-editor.json a partir dos campos `fonte` em spawns-editor.json.
 *   node tools/reconstruir-mapas-editor.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPAWNS = join(RAIZ, 'game/src/server/dados/spawns-editor.json');
const MAPAS = join(RAIZ, 'game/src/server/dados/mapas-editor.json');

const spawns = JSON.parse(readFileSync(SPAWNS, 'utf8'));
const mapas = JSON.parse(readFileSync(MAPAS, 'utf8'));
const porDex = { ...(mapas.porDex ?? {}) };

let n = 0;
for (const reg of Object.values(spawns.regioes ?? {})) {
  for (const m of reg.marcadores ?? []) {
    if (!m.fonte) continue;
    porDex[String(m.dex)] = m.fonte;
    n++;
  }
}

mapas.porDex = porDex;
writeFileSync(MAPAS, JSON.stringify(mapas, null, 2), 'utf8');
console.log(`mapas-editor: ${Object.keys(porDex).length} dex · ${n} fontes lidas do spawns-editor`);
