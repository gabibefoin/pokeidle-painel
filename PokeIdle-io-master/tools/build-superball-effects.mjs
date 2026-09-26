// Gera o ícone da Super Ball (id 3) e copia as folhas de animação do espelho.
//
// O ícone padrão é o Quick Ball do pokesprite (visual da Super Ball neste jogo):
//   https://raw.githubusercontent.com/msikma/pokesprite/master/items/ball/quick.png
//
// As folhas de captura/quebra/arremesso vêm de `public/data/effects/catch/` (espelho do
// poke.idleworld.online). Não gerar a partir da Great Ball — isso deixava pixels da
// animação original aparecendo por baixo do ícone colado.
//
//   node tools/build-superball-effects.mjs
//   node tools/build-superball-effects.mjs caminho/outro.png
import { copyFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodificar, recortarTransparente } from './png.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUICK_POKESPRITE =
  'https://raw.githubusercontent.com/msikma/pokesprite/master/items/ball/quick.png';
const ORIGEM_BOLA = process.argv[2] ?? QUICK_POKESPRITE;
const PUBLIC = join(RAIZ, 'public', 'data', 'effects', 'catch');
const CLIENTE = join(RAIZ, 'game', 'src', 'client');
const SAIDA = join(CLIENTE, 'effects', 'catch');
const ICONE = join(CLIENTE, 'img', 'ball-super.png');

const FOLHAS = [
  ['superball_catch.png', 'superball_catch.png'],
  ['superball_broke.png', 'superball_broke.png'],
  ['throw/superball.png', 'throw/superball.png'],
];

async function carregarBola(origem) {
  const buf = origem.startsWith('http')
    ? Buffer.from(await (await fetch(origem)).arrayBuffer())
    : await readFile(origem);
  return { buf, dec: decodificar(buf) };
}

const { buf: bolaBuf } = await carregarBola(ORIGEM_BOLA);
await mkdir(dirname(ICONE), { recursive: true });
await mkdir(join(SAIDA, 'throw'), { recursive: true });
const iconeRecortado = recortarTransparente(bolaBuf);
const iconeBuf = iconeRecortado?.buf ?? bolaBuf;
await writeFile(ICONE, iconeBuf);
console.log(
  `Ícone: ${ICONE}${iconeRecortado ? ` (${iconeRecortado.antes} → ${iconeRecortado.largura}×${iconeRecortado.altura})` : ''}`,
);

console.log('\nFolhas (espelho → cliente):');
for (const [origem, destino] of FOLHAS) {
  const de = join(PUBLIC, origem);
  const para = join(SAIDA, destino);
  await copyFile(de, para);
  console.log(`  ${destino}`);
}
console.log('\nPronto.');
