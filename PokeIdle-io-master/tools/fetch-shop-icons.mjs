// Ícones da LOJA de diamantes, espelhados de `/assets/diamondstore/` do jogo original.
//
// Os nomes vêm do campo `icon` de cada produto em `GET /api/game/diamonds` (a resposta
// inteira está espelhada em `site/api/diamonds-shop.json`).
//
// ### A pasta certa é `diamondstore`
//
// A primeira versão deste arquivo varria `topmenu/`, `ranking/`, `diamonds/` e `shop/` — as
// pastas que já serviam outros ícones do site. Só seis dos dezoito estavam lá (os de boost), e
// o resto caía num SUBSTITUTO do pokesprite: o Pacote de Suprimentos virava uma Beast Ball, o
// VIP virava um Rare Candy, a Troca de Gênero virava um passe. Ficava tudo parecido demais
// entre si e nada parecido com o produto.
//
// `diamondstore/` tem os dezoito, com a arte original. Não há mais substituto: se um sumir da
// origem, o certo é aparecer na lista de PERDIDOS e ser resolvido à mão, e não trocado em
// silêncio por um desenho que não é aquilo.
//
//   node tools/fetch-shop-icons.mjs
import { ORIGIN, OUT, resumo, stats } from './lib.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const t0 = Date.now();
const DEST = 'site/assets/loja';
const PASTA = 'diamondstore';

/** Os 18 nomes distintos que os 61 produtos usam. */
const ICONES = [
  'ditto.png', 'sditto.png', 'idleball.png', 'supplypack.png', 'gamepass.png',
  'vip.png', 'name.png', 'gender.png', 'tower.png',
  'blessp.png', 'blessu.png', 'blessm.png',
  'exp.png', 'boost.png', 'loot.png', 'catch.png', 'shinysecretlure.png', 'diamond.png',
];

await mkdir(join(OUT, DEST), { recursive: true });

const baixados = [];
const perdidos = [];

for (const nome of ICONES) {
  try {
    const r = await fetch(`${ORIGIN}/assets/${PASTA}/${nome}`);
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image')) {
      perdidos.push(`${nome} (HTTP ${r.status})`);
      continue;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    await writeFile(join(OUT, DEST, nome), buf);
    stats.baixados++;
    stats.bytes += buf.byteLength;
    baixados.push(`${nome} — ${buf.byteLength} B`);
  } catch (err) {
    perdidos.push(`${nome} (${err.message})`);
  }
}

console.log(`\nDE /assets/${PASTA}/ (${baixados.length}):`);
for (const l of baixados) console.log('  · ' + l);
if (perdidos.length) {
  console.log(`\nSEM ÍCONE (${perdidos.length}) — resolver à mão, NÃO substituir em silêncio:`);
  for (const l of perdidos) console.log('  · ' + l);
}

resumo(t0);
