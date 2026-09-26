// Todo arquivo que o cliente pede existe de verdade?
//
//   node tools/teste-assets.mjs [url]
//
// ### Por que este teste existe
//
// Dois ícones sumiram em produção e ninguém percebeu até um jogador abrir a tela. A causa não
// foi bug de código: foi um ícone NOSSO guardado em `public/data`, que é a cópia regenerável
// do pack de terceiro e está no `.gitignore`. Na máquina de quem desenhou ele estava lá; no
// servidor, que reconstrói a pasta com `npm run fetch`, ele nunca existiu.
//
// É uma classe de erro que passa por qualquer teste de lógica e por qualquer revisão de código,
// porque o código está certo — o que falta é o arquivo. Só um pedido HTTP de verdade pega.
//
// ### A regra que ele defende
//
//   · arte NOSSA        → `src/client/img/`, servida em `/img/`, versionada no git
//   · espelho de terceiro → `public/data/`, servida em `/assets/`, gitignorada e regenerável
//
// Ícone nosso em `/assets/` funciona na sua máquina e some em produção.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'http://localhost:8080').replace(/\/$/, '');
const CLIENTE = resolve(dirname(fileURLToPath(import.meta.url)), '../src/client');

const falhas = [];
const ok = (passou, oque, detalhe = '') => {
  console.log(`${passou ? '  ok  ' : ' FALHA'}  ${oque}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!passou) falhas.push(oque);
};

console.log(`ASSETS — ${BASE}\n${'='.repeat(46)}`);

// ------------------------------------------------- o que o cliente pede
//
// Varre o código do cliente atrás de caminho de arquivo. Não é análise sintática: é procura de
// texto, e é o suficiente porque todo caminho aqui é literal — nenhum é montado por variável,
// salvo os que têm `${` no meio, que este teste pula de propósito (ver abaixo).
/**
 * Tira comentário antes de procurar caminho.
 *
 * Sem isto o teste acusa os EXEMPLOS da documentação — este arquivo já reprovou duas vezes por
 * causa de um `img:site/assets/ui/NOME.png` escrito num JSDoc para explicar o formato. Um teste
 * que obriga a documentação a mentir sobre a forma das coisas é um teste que vai ser desligado.
 */
const semComentario = (texto) =>
  texto
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // bloco /* */, inclusive JSDoc
    .replace(/<!--[\s\S]*?-->/g, ' ') // comentário de HTML
    .replace(/^\s*(\/\/|\*).*$/gm, ' '); // linha que começa com // ou * (continuação de JSDoc)

const arquivos = (await readdir(CLIENTE)).filter((f) => /\.(js|mjs|html|css)$/.test(f));
const pedidos = new Set();

for (const nome of arquivos) {
  const texto = semComentario(await readFile(join(CLIENTE, nome), 'utf8'));
  for (const m of texto.matchAll(/["'`(]((?:\/assets\/|\/img\/|img:)[a-zA-Z0-9._\/-]+\.(?:png|jpg|jpeg|webp|svg|json))/g)) {
    pedidos.add(m[1].replace(/^img:/, '').replace(/^(?!\/)/, '/assets/'));
  }
}

console.log(`\n${pedidos.size} caminhos literais encontrados no cliente\n`);

// Caminho montado com `${...}` (trofeu-${pos}.png) não entra: o teste não sabe quais valores
// a variável assume, e chutar daria falso negativo. Eles ficam por conta dos testes de tela.

// ------------------------------------------------------ todos respondem?
const mortos = [];
await Promise.all(
  [...pedidos].map(async (caminho) => {
    try {
      const r = await fetch(`${BASE}${caminho}`, { method: 'HEAD' });
      if (!r.ok) mortos.push(`${r.status} ${caminho}`);
    } catch (err) {
      mortos.push(`erro ${caminho} (${err.message})`);
    }
  }),
);

for (const m of mortos.sort()) console.log(`        ${m}`);
ok(mortos.length === 0, `todos os ${pedidos.size} arquivos respondem`, `${mortos.length} faltando`);

// -------------------------------------------- e o que o SERVIDOR manda
//
// Varrer o cliente não basta, e a Loja provou isso: os 18 ícones dela não aparecem em lugar
// nenhum do código do cliente — eles chegam dentro do catálogo que o servidor envia no
// `welcome`, no campo `icone` de cada produto. O servidor inteiro ficou sem nenhum deles em
// produção e a varredura de texto só acusou 3, que por acaso também eram literais.
//
// Como isto é um script de Node, dá para importar o catálogo direto da fonte em vez de
// adivinhá-lo. É o único jeito de o teste cobrir o que ele precisa cobrir.
const { PRODUTOS } = await import('../src/server/game/loja.mjs');
const daLoja = [...new Set(PRODUTOS.map((p) => p.icone).filter(Boolean))].map((i) =>
  i.startsWith('/') ? i : `/assets/${i}`,
);

const lojaMortos = [];
await Promise.all(
  daLoja.map(async (caminho) => {
    try {
      const r = await fetch(`${BASE}${caminho}`, { method: 'HEAD' });
      if (!r.ok) lojaMortos.push(`${r.status} ${caminho}`);
    } catch (err) {
      lojaMortos.push(`erro ${caminho} (${err.message})`);
    }
  }),
);
for (const m of lojaMortos.sort()) console.log(`        ${m}`);
ok(lojaMortos.length === 0,
  `os ${daLoja.length} ícones do catálogo da Loja respondem`,
  `${lojaMortos.length} faltando`);

// ------------------------------------- arte nossa está versionada?
//
// A checagem que teria pego o bug antes de ele existir: se o cliente pede de `/img/`, o arquivo
// tem de estar em `src/client/img/` — que é a pasta que o git carrega para o servidor.
//
// `existsSync` no caminho inteiro, e não a lista da pasta raiz: metade da arte nossa mora em
// subpasta (`img/itens/`, `img/tipos/`, `img/itens/mega/`), e comparar com o `readdir` de
// `img/` acusava as 38 como ausentes desde sempre — um alarme que tocava todo dia e que, por
// tocar todo dia, não valia nada.
const nossos = [...pedidos].filter((p) => p.startsWith('/img/'));
const foraDoGit = nossos.filter((p) => !existsSync(join(CLIENTE, p.slice(1))));

ok(foraDoGit.length === 0,
  `os ${nossos.length} arquivos de /img/ existem em src/client/img/`,
  foraDoGit.join(', '));

// ------------------------------------- animação da Beast Ball no espelho
//
// A animação de arremesso/captura mora em `/assets/effects/catch/` (gitignorado). Se faltar,
// o cliente cai no fallback da Poké Ball — o mesmo tipo de bug que sumiu ícone nosso do espelho.
const beastBallAnim = [
  '/effects/catch/throw/idleball.png',
  '/effects/catch/idleball_catch.png',
  '/effects/catch/idleball_broke.png',
  '/effects/catch/throw/superball.png',
  '/effects/catch/superball_catch.png',
  '/effects/catch/superball_broke.png',
  '/img/ball-super.png',
];
const beastMortos = [];
await Promise.all(
  beastBallAnim.map(async (caminho) => {
    try {
      const r = await fetch(`${BASE}${caminho}`, { method: 'HEAD' });
      if (!r.ok) beastMortos.push(`${r.status} ${caminho}`);
    } catch (err) {
      beastMortos.push(`erro ${caminho} (${err.message})`);
    }
  }),
);
for (const m of beastMortos.sort()) console.log(`        ${m}`);
ok(beastMortos.length === 0,
  `as ${beastBallAnim.length} folhas/ícones das bolas nossas respondem`,
  `${beastMortos.length} faltando — rode node tools/build-superball-effects.mjs`);

console.log(`\n${'='.repeat(46)}`);
console.log(falhas.length ? `${falhas.length} FALHA(S)` : 'nenhum arquivo faltando');
// `process.exit()` logo depois de um `fetch({ method: 'HEAD' })` derruba o Node em
// Windows (assertion no handle de async do libuv, alheia a este teste). `exitCode` reporta
// o mesmo status e deixa o processo terminar sozinho, sem forçar o encerramento.
process.exitCode = falhas.length ? 1 : 0;
