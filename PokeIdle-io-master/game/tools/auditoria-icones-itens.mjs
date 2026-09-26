/**
 * Varredura de ícones de itens — o que aparece vazio na bolsa, ficha ou hunt analyser.
 *
 *   node tools/auditoria-icones-itens.mjs
 *   node tools/auditoria-icones-itens.mjs --json   # salva relatório em tools/auditoria-icones-itens.json
 *
 * Critérios:
 *   · arquivo_ausente     — item no catálogo, mas o PNG/GIF não existe no disco
 *   · sem_mapeamento      — sem entrada em items-icons.json e sem campo icon
 *   · placeholder         — icon aponta para _loot_placeholder (só funciona com override manual)
 *   · arquivo_minuscule   — PNG provavelmente vazio/corrompido (< 250 bytes)
 *   · drop_sem_catalogo   — nome de loot em alguma espécie, mas sem item em items.json
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITENS_NOSSOS } from '../src/server/game/itens-nossos.mjs';
import { IDS_ITEM_DUPLICADO, resolverNomeItem } from '../src/shared/alias-item.mjs';
import { caminhoIconeRel } from '../src/shared/icone-item.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = join(raiz, 'public/data');
const clientDir = join(raiz, 'game/src/client');
const salvarJson = process.argv.includes('--json');

const itemsEspelho = JSON.parse(readFileSync(join(dataDir, 'items.json'), 'utf8')).items;
const iconsMap = JSON.parse(readFileSync(join(dataDir, 'items-icons.json'), 'utf8'));
const creaturesEspelho = JSON.parse(readFileSync(join(dataDir, 'creatures.json'), 'utf8')).creatures;

let creaturesNovos = [];
try {
  creaturesNovos = JSON.parse(
    readFileSync(join(raiz, 'game/src/server/dados/creatures-novos.json'), 'utf8'),
  ).creatures ?? [];
} catch { /* opcional */ }

/** Espelha `ICONES_ITEM_FIXOS` do app.js. */
const ICONES_ITEM_FIXOS = {
  30: 'site/assets/items/dark_gem.png',
  63: 'site/assets/items/goggles.png',
  47: 'site/assets/items/farfetchd_stick.png',
  5041: 'site/assets/items/farfetchd_stick.png',
};

const catalogo = [...itemsEspelho.filter((i) => !IDS_ITEM_DUPLICADO.has(i.id)), ...ITENS_NOSSOS];
const icones = { ...iconsMap };

for (const i of catalogo) {
  if (i.icon && !icones[i.id]) {
    icones[i.id] = i.icon.startsWith('/') ? i.icon.replace(/^\//, '') : caminhoIconeRel(i.icon);
  }
}
for (const [id, rel] of Object.entries(ICONES_ITEM_FIXOS)) icones[id] = rel;

function resolveAbs(rel) {
  if (!rel) return null;
  let p = rel.startsWith('/') ? rel.slice(1) : rel;
  if (p.startsWith('assets/')) p = `site/${p}`;
  if (p.startsWith('img/')) return join(clientDir, p);
  return join(dataDir, p);
}

const porNome = new Map(catalogo.map((i) => [i.name.toLowerCase(), i]));
function itemPorNome(nome) {
  const canon = resolverNomeItem(nome);
  return porNome.get(String(canon).toLowerCase()) ?? porNome.get(String(nome).toLowerCase()) ?? null;
}

const arquivoAusente = [];
const semMapeamento = [];
const placeholder = [];
const arquivoMinuscule = [];

for (const item of [...catalogo].sort((a, b) => a.name.localeCompare(b.name))) {
  const rel = icones[item.id] ?? null;

  if ((item.icon ?? '').includes('_loot_placeholder')) {
    placeholder.push({ id: item.id, name: item.name, category: item.category, icon: item.icon, path: rel });
  }

  if (!rel) {
    semMapeamento.push({ id: item.id, name: item.name, category: item.category });
    continue;
  }

  const abs = resolveAbs(rel);
  if (!existsSync(abs)) {
    arquivoAusente.push({ id: item.id, name: item.name, category: item.category, path: rel });
    continue;
  }

  const bytes = statSync(abs).size;
  if (bytes < 250) {
    arquivoMinuscule.push({ id: item.id, name: item.name, category: item.category, path: rel, bytes });
  }
}

// Drops em espécies cujo nome não resolve para item — ficha mostra texto, ícone vazio.
const lootNomes = new Set();
for (const c of [...creaturesEspelho, ...creaturesNovos]) {
  for (const l of c.loot ?? []) lootNomes.add(l.name);
}

const dropSemCatalogo = [...lootNomes]
  .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  .filter((nome) => !itemPorNome(nome))
  .map((name) => ({ name }));

const relatorio = {
  gerado: new Date().toISOString(),
  catalogo: catalogo.length,
  resumo: {
    arquivo_ausente: arquivoAusente.length,
    sem_mapeamento: semMapeamento.length,
    placeholder: placeholder.length,
    arquivo_minuscule: arquivoMinuscule.length,
    drop_sem_catalogo: dropSemCatalogo.length,
  },
  arquivo_ausente: arquivoAusente,
  sem_mapeamento: semMapeamento,
  placeholder,
  arquivo_minuscule: arquivoMinuscule,
  drop_sem_catalogo: dropSemCatalogo,
};

function fmtLinha(i) {
  const extra = i.path ? ` → ${i.path}` : i.icon ? ` (icon: ${i.icon})` : i.bytes ? ` (${i.bytes}b)` : '';
  return `${String(i.id ?? '').padStart(6)}  ${(i.name ?? '').padEnd(40)}  [${i.category ?? 'drop'}]${extra}`;
}

console.log(`Catálogo: ${catalogo.length} itens · ${lootNomes.size} nomes de loot distintos\n`);

for (const [titulo, lista] of [
  [`ARQUIVO DE ÍCONE AUSENTE (${arquivoAusente.length})`, arquivoAusente],
  [`SEM MAPEAMENTO DE ÍCONE (${semMapeamento.length})`, semMapeamento],
  [`PLACEHOLDER (_loot_placeholder) (${placeholder.length})`, placeholder],
  [`ARQUIVO MINÚSCULO — provável ícone vazio (${arquivoMinuscule.length})`, arquivoMinuscule],
  [`DROP SEM ITEM NO CATÁLOGO — ícone vazio na ficha (${dropSemCatalogo.length})`, dropSemCatalogo],
]) {
  console.log(`=== ${titulo} ===`);
  console.log(lista.length ? lista.map(fmtLinha).join('\n') : '(nenhum)');
  console.log();
}

const totalProblemas = arquivoAusente.length + semMapeamento.length + placeholder.length
  + arquivoMinuscule.length + dropSemCatalogo.length;
console.log(`Total de entradas com problema: ${totalProblemas}`);

if (salvarJson) {
  const out = join(dirname(fileURLToPath(import.meta.url)), 'auditoria-icones-itens.json');
  writeFileSync(out, JSON.stringify(relatorio, null, 2));
  console.log(`\nRelatório salvo em ${out}`);
}
