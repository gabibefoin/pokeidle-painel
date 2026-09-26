// Os 111 emojis VIP do chat, espelhados de `/assets/emojis/vip/` do jogo original.
//
// São PNGs de 28 a 41 px com alfa, os mesmos que o chat de lá manda por `:vip1:` … `:vip111:`.
// O caminho não aparece em lugar nenhum do HTML: saiu do bundle do chat deles, na função que
// monta o `src` (`e => \`/assets/emojis/vip/vip${e}.png\``).
//
// Ao contrário do resto do espelho, estes ficam DENTRO do cliente (`src/client/img/`) e vão
// para o repositório — são 490 kB no total e o chat precisa deles no primeiro frame, então
// não vale a pena passarem pela pasta de assets, que é opcional e regenerável.
//
//   node tools/fetch-vip-emojis.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = resolve(RAIZ, 'game/src/client/img/emojis-vip');
const ORIGEM = 'https://poke.idleworld.online/assets/emojis/vip';

/** O cliente varre de 1 a este número; se a origem publicar mais, é só subir aqui e no app.js. */
const QUANTOS = 111;

await mkdir(DEST, { recursive: true });

const perdidos = [];
let bytes = 0;

for (let n = 1; n <= QUANTOS; n++) {
  try {
    const r = await fetch(`${ORIGEM}/vip${n}.png`);
    if (!r.ok) throw new Error(String(r.status));
    const buf = Buffer.from(await r.arrayBuffer());
    // PNG começa com \x89PNG. Sem esta checagem, uma página de erro 404 disfarçada de 200
    // entraria como "emoji" e viraria um quadrado quebrado no chat.
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('não é PNG');
    await writeFile(resolve(DEST, `vip${n}.png`), buf);
    bytes += buf.byteLength;
  } catch (err) {
    perdidos.push(`vip${n}.png (${err.message})`);
  }
}

console.log(`${QUANTOS - perdidos.length}/${QUANTOS} em game/src/client/img/emojis-vip/ · ${(bytes / 1024).toFixed(0)} kB`);
if (perdidos.length) console.log(`SEM IMAGEM (${perdidos.length}): ${perdidos.join(', ')}`);
