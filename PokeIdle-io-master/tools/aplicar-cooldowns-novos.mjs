/**
 * Põe TODO o catálogo de golpes na curva nova de cooldown (`shared/cooldown-golpes.mjs`).
 *
 * Mexe em dois campos de cada `attacks[]`: o `power` sobe para 15 quando estava abaixo disso,
 * e o `cooldownMs` passa a ser função do poder. Roda nos quatro arquivos que juntos formam o
 * catálogo que `content.mjs` monta no boot, mais o índice do visualizador offline.
 *
 *   node tools/aplicar-cooldowns-novos.mjs
 *   node tools/aplicar-cooldowns-novos.mjs --dry
 *
 * Os arquivos têm formatações diferentes entre si (indentação de 1 e de 2, um sem newline no
 * fim, o de auditoria em CRLF, o índice compacto). Reescrever tudo com um `JSON.stringify`
 * padrão trocaria o arquivo inteiro de linha e o diff viraria ruído, então o estilo de cada um
 * é DESCOBERTO antes — round-trip do original até achar a combinação que devolve os mesmos
 * bytes — e reusado na escrita. Assim o diff mostra só as linhas de power e cooldown.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aplicarCurvaNoGolpe, cooldownDoPoder } from '../game/src/shared/cooldown-golpes.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry');

const ALVOS = [
  { arq: 'public/data/creatures.json', lista: 'creatures' },
  { arq: 'game/src/server/dados/creatures-novos.json', lista: 'creatures' },
  { arq: 'game/src/server/dados/creatures-outland-novos.json', lista: 'creatures' },
  { arq: 'game/src/server/dados/creatures-audit-overrides.json', lista: 'overrides' },
];

/** Acha a (indentação, fim de linha, newline final) que reproduz o arquivo byte a byte. */
function descobrirEstilo(raw, dados) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lf = eol === '\r\n' ? raw.replace(/\r\n/g, '\n') : raw;
  for (const indent of [0, 1, 2, 3, 4, '\t']) {
    const corpo = JSON.stringify(dados, null, indent);
    if (lf === corpo) return { indent, eol, nl: false };
    if (lf === `${corpo}\n`) return { indent, eol, nl: true };
  }
  return null;
}

function escrever(caminho, dados, estilo) {
  let txt = JSON.stringify(dados, null, estilo.indent);
  if (estilo.nl) txt += '\n';
  if (estilo.eol === '\r\n') txt = txt.replace(/\n/g, '\r\n');
  writeFileSync(caminho, txt);
}

let totalGolpes = 0;
let totalMexidos = 0;
let totalPiso = 0;

for (const { arq, lista } of ALVOS) {
  const caminho = join(RAIZ, arq);
  const raw = readFileSync(caminho, 'utf8');
  const dados = JSON.parse(raw);
  const estilo = descobrirEstilo(raw, dados);
  if (!estilo) throw new Error(`${arq}: não reconheci a formatação — abortando para não estourar o diff`);

  let golpes = 0;
  let mexidos = 0;
  let piso = 0;
  for (const c of dados[lista] ?? []) {
    for (const a of c.attacks ?? []) {
      golpes++;
      if ((a.power ?? 0) < 15) piso++;
      if (aplicarCurvaNoGolpe(a)) mexidos++;
    }
  }

  totalGolpes += golpes;
  totalMexidos += mexidos;
  totalPiso += piso;
  console.log(`${arq}\n  ${golpes} golpes · ${mexidos} mudaram · ${piso} subiram para poder 15`);
  if (!dry) escrever(caminho, dados, estilo);
}

/**
 * O índice do visualizador offline (`public/viewer.js`) guarda uma CÓPIA de power/cooldown por
 * golpe. Ele é derivado do espelho e só é regerado por `build-indexes.mjs` — que refaz também
 * loot e spawns —, então aqui a mesma curva é aplicada na cópia, para a página não mostrar o
 * cooldown antigo. O que `content.mjs` consome deste arquivo é só `efeitos`, que não é tocado.
 */
{
  const caminho = join(RAIZ, 'public/data/index/moves-index.json');
  const raw = readFileSync(caminho, 'utf8');
  const idx = JSON.parse(raw);
  const estilo = descobrirEstilo(raw, idx);
  if (!estilo) throw new Error('moves-index.json: não reconheci a formatação');

  let mexidos = 0;
  for (const m of Object.values(idx.porAtaque ?? {})) {
    if (aplicarCurvaNoGolpe(m)) mexidos++;
    for (const k of ['powerMin', 'powerMax']) {
      if (typeof m[k] === 'number') m[k] = Math.max(15, m[k]);
    }
    for (const q of m.aprendidoPor ?? []) {
      if (typeof q.power === 'number') q.power = Math.max(15, q.power);
    }
  }
  console.log(`public/data/index/moves-index.json\n  ${Object.keys(idx.porAtaque ?? {}).length} golpes distintos · ${mexidos} mudaram`);
  if (!dry) escrever(caminho, idx, estilo);
}

console.log(`\ncatálogo: ${totalGolpes} golpes · ${totalMexidos} com cooldown novo · ${totalPiso} com poder elevado ao piso`);
console.log(`amostra: poder 15 → ${cooldownDoPoder(15) / 1000}s · 40 → ${cooldownDoPoder(40) / 1000}s · 100 → ${cooldownDoPoder(100) / 1000}s · 600 → ${cooldownDoPoder(600) / 1000}s`);
if (dry) console.log('(--dry: nada foi gravado)');
