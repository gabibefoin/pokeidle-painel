// As duas fontes do chat, espelhadas do Google Fonts para dentro do cliente.
//
// Barlow (corpo das mensagens e campo de texto) e Cinzel (abas de canal) são as mesmas do
// chat que serviu de referência. Ficam SELF-HOSTED, e não num `<link>` para o
// fonts.googleapis.com, por dois motivos: o jogo é um painel de tempo real onde um FOUT de
// meio segundo no chat salta aos olhos, e uma dependência de rede de terceiro no caminho
// crítico da primeira pintura é justamente o que não se quer num MMO.
//
// Ao contrário dos sprites (que são espelho e vivem em `public/data/`, gitignorado), estas
// entram no repositório: as duas são SIL Open Font License 1.1, então redistribuir junto do
// jogo é exatamente o uso previsto. A licença vai junto, em `fontes/OFL.txt`.
//
// Só os subsets `latin` e `latin-ext` — o chat fala português, inglês e espanhol, e puxar
// cirílico/vietnamita triplicaria o peso sem uma linha a mais legível.
//
//   node tools/fetch-chat-fonts.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = resolve(RAIZ, 'game/src/client/fontes');

/** O `css2` só devolve woff2 se o User-Agent for de um browser moderno. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const FAMILIAS = 'family=Barlow:wght@400;600;700&family=Cinzel:wght@700';
const SUBSETS = new Set(['latin', 'latin-ext']);

await mkdir(DEST, { recursive: true });

const css = await (
  await fetch(`https://fonts.googleapis.com/css2?${FAMILIAS}&display=swap`, { headers: { 'user-agent': UA } })
).text();

// O CSS do Google vem com um comentário `/* subset */` antes de cada @font-face — é o único
// lugar em que o nome do subset aparece, então é por ele que se separa latin do resto.
const blocos = css.split('/*').slice(1);
const linhas = [];

for (const bloco of blocos) {
  const subset = bloco.slice(0, bloco.indexOf('*/')).trim();
  if (!SUBSETS.has(subset)) continue;

  const familia = /font-family:\s*'([^']+)'/.exec(bloco)?.[1];
  const peso = /font-weight:\s*(\d+)/.exec(bloco)?.[1];
  const url = /src:\s*url\(([^)]+)\)/.exec(bloco)?.[1];
  const faixa = /unicode-range:\s*([^;]+);/.exec(bloco)?.[1];
  if (!familia || !peso || !url) continue;

  const nome = `${familia.toLowerCase()}-${peso}-${subset}.woff2`;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  await writeFile(resolve(DEST, nome), buf);
  linhas.push(`  · ${nome.padEnd(28)} ${(buf.byteLength / 1024).toFixed(1)} kB`);

  console.log(`@font-face { font-family: '${familia}'; font-weight: ${peso}; src: url(fontes/${nome}) format('woff2'); unicode-range: ${faixa}; }`);
}

await writeFile(
  resolve(DEST, 'LEIA-ME.txt'),
  [
    'Barlow e Cinzel — SIL Open Font License 1.1.',
    '',
    'Baixadas do Google Fonts por tools/fetch-chat-fonts.mjs (subsets latin e latin-ext).',
    'Licença completa: https://openfontlicense.org',
    'Barlow  © Jeremy Tribby     — https://fonts.google.com/specimen/Barlow',
    'Cinzel  © Natanael Gama     — https://fonts.google.com/specimen/Cinzel',
    '',
    'Rode o script de novo para atualizar; os @font-face saem no console prontos para colar',
    'em estilo.css.',
  ].join('\n'),
);

console.log(`\n${linhas.length} arquivos em game/src/client/fontes/:`);
for (const l of linhas) console.log(l);
