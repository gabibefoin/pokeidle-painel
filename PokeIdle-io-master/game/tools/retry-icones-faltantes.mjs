/** Baixa ícones que falharam no import principal. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '../../public/data/site/assets/items');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PENDENTES = [
  { nome: "Eevee Valentine's Card", arquivos: ["Eevee Valentine's Card.png", 'Eevee Valentine Card.png'] },
  { nome: "Flareon Valentine's Card", arquivos: ["Flareon Valentine's Card.png"] },
  { nome: "Jolteon Valentine's Card", arquivos: ["Jolteon Valentine's Card.png"] },
  { nome: "Vaporeon Valentine's Card", arquivos: ["Vaporeon Valentine's Card.png"] },
  { nome: 'Gardestrike Essence', arquivos: ['Gardestrike Essence.png', 'Gardestrike Essence.gif'] },
  { nome: 'Pizza', arquivos: ['Pizza.png'] },
  { nome: 'Psychic Ear', arquivos: ['Psychic Ear.png'] },
  { nome: 'Talon', arquivos: ['Talon.png', 'Talon Claw.png'] },
];

function iconLocal(nome) {
  return `${nome.replace(/'/g, '').replace(/\./g, '').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()}.png`;
}

async function urlImagemWiki(arquivo) {
  const titulo = encodeURIComponent(`Arquivo:${arquivo.replace(/ /g, '_')}`);
  const html = await fetch(`https://wiki.pokexgames.com/index.php?title=${titulo}`, {
    headers: { 'User-Agent': 'PokeIdle-import/1.0' },
  }).then((r) => r.text());
  const m = html.match(/\/images\/[a-f0-9]\/[a-f0-9]{2}\/[^"'\\]+?\.(?:png|gif)/i);
  return m ? `https://wiki.pokexgames.com${m[0]}` : null;
}

mkdirSync(iconsDir, { recursive: true });

for (const item of PENDENTES) {
  const dest = join(iconsDir, iconLocal(item.nome));
  let ok = false;
  for (const arq of item.arquivos) {
    const url = await urlImagemWiki(arq);
    if (!url) continue;
    const res = await fetch(url);
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 80) continue;
    writeFileSync(dest, buf);
    console.log('OK', item.nome, '←', arq, buf.length, 'b');
    ok = true;
    break;
  }
  if (!ok) console.log('FALHOU', item.nome);
  await sleep(200);
}
