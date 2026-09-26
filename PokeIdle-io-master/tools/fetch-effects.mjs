// Espelha as animações de efeito: os 80 sprite sheets de move e as folhas de captura.
//
//   /assets/effects/moves/index.json   nome do efeito → { file, frameW, frameH, frames, frameMs, scale, offset }
//   /assets/effects/moves/<file>       tira VERTICAL: o quadro i fica em (0, i*frameH)
//   /assets/effects/catch/<file>       folhas de captura/quebra da pokébola, quadros 64×96
//
// O efeito de cada golpe é escolhido pelo servidor (o evento de batalha carrega `fx`/`fx2`),
// mas os 18 tipos elementais têm folha própria — é o que dá para cruzar offline, via o
// `type` de cada ataque em creatures.json.
import { ORIGIN, stats, save, grab, pool, fetchJson, resumo } from './lib.mjs';

const FORCE = process.argv.includes('--force');

// Tabela de pokébolas extraída do bundle do cliente (id → folhas). Quadros de 64×96.
// Os nomes aqui são os da ORIGEM e não podem mudar — são os arquivos que existem lá.
// (A de id 3 é a Super Ball nossa — arte em `src/client/effects/`; veja tools/build-superball-effects.mjs.)
// A Beast Ball (id 5) usa as folhas da Idle Ball deles — mesma mecânica, outro nome.
const BOLAS = {
  1: { nome: 'Poké Ball', catch: ['pokeball_catch.png', 60], broke: ['pokeball_broke.png', 44], throw: 'pokeball.png' },
  2: { nome: 'Great Ball', catch: ['greatball_catch.png', 60], broke: ['greatball_broke.png', 44], throw: 'greatball.png' },
  3: { nome: 'Super Ball', catch: ['superball_catch.png', 60], broke: ['superball_broke.png', 44], throw: 'superball.png' },
  4: { nome: 'Ultra Ball', catch: ['ultraball_catch.png', 60], broke: ['ultraball_broke.png', 44], throw: 'ultraball.png' },
  5: { nome: 'Beast Ball', catch: ['idleball_catch.png', 60], broke: ['idleball_broke.png', 44], throw: 'idleball.png' },
};

const t0 = Date.now();
console.log(`Espelhando efeitos de ${ORIGIN}\n`);

// ------------------------------------------------------------- 1. de move

console.log('[1/2] folhas de efeito de move');
const index = await fetchJson(`${ORIGIN}/assets/effects/moves/index.json`);
await save('effects/moves/index.json', Buffer.from(JSON.stringify(index, null, 1)));
stats.baixados++;

const efeitos = Object.entries(index);
console.log(`      ${efeitos.length} efeitos · ${efeitos.reduce((s, [, v]) => s + (v.frames || 0), 0)} quadros no total`);

await pool(
  efeitos,
  ([nome, v]) => grab(`${ORIGIN}/assets/effects/moves/${v.file}`, `effects/moves/${v.file}`, FORCE),
  'moves  ',
);

// ---------------------------------------------------------- 2. de captura

console.log('[2/2] folhas de captura');
// catch/broke ficam na raiz; o sprite de arremesso fica em catch/throw/ (grade de 32px).
const arquivosBola = [];
for (const b of Object.values(BOLAS)) {
  if (b.catch) arquivosBola.push(b.catch[0]);
  if (b.broke) arquivosBola.push(b.broke[0]);
  if (b.throw) arquivosBola.push(`throw/${b.throw}`);
}
await pool(
  arquivosBola,
  (f) => grab(`${ORIGIN}/assets/effects/catch/${f}`, `effects/catch/${f}`, FORCE),
  'catch  ',
);

// Índice próprio, já que este o site não publica — veio do bundle.
await save(
  'effects/catch/index.json',
  Buffer.from(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(BOLAS).map(([id, b]) => [
          id,
          {
            nome: b.nome,
            frameW: 64,
            frameH: 96,
            catch: b.catch ? { file: b.catch[0], frames: b.catch[1] } : null,
            broke: b.broke ? { file: b.broke[0], frames: b.broke[1] } : null,
            throw: b.throw ?? null,
          },
        ]),
      ),
      null,
      1,
    ),
  ),
);
stats.baixados++;

resumo(t0);
console.log('Agora: node tools/build-indexes.mjs');
