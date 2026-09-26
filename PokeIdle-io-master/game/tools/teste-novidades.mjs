// Teste das NOVIDADES NO POKÉIDLE — o modal do botão "!" e do aviso de mudança — sem banco.
//
// O que este teste protege:
//   · a lista vai da mais recente para a mais antiga: `aviso` estritamente decrescente, versão no
//     formato x.y.z e data AAAA-MM-DD de verdade, nunca mais nova que a da novidade de cima;
//   · `AVISO_VERSAO` é a novidade do topo — acrescentar uma entrada basta para o aviso abrir, e
//     quem já leu a mais recente não vê de novo;
//   · cada novidade tem o seu slide no `index.html`, na MESMA ordem da lista, e só o primeiro
//     nasce visível; não sobra slide sem entrada;
//   · o título, as setas, os pontinhos e o botão de cada novidade têm texto nas três línguas, e o
//     título leva a versão e a data;
//   · o botão "!" abre as novidades na mais recente, e as notas de versão saíram da tela.
//
//   node tools/teste-novidades.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NOVIDADES, AVISO_VERSAO, avisoDeveMostrar } from '../src/shared/aviso-jogo.mjs';
import { _dicionarios } from '../src/client/i18n.mjs';

let testes = 0;
let falhas = 0;
function ok(cond, nome, detalhe = '') {
  testes++;
  if (cond) return console.log(`  ok  ${nome}`);
  falhas++;
  console.log(`  FALHOU  ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel) => readFileSync(join(raiz, rel), 'utf8').replace(/\r\n/g, '\n');

console.log('\n— a lista');
ok(NOVIDADES.length >= 2, `há ${NOVIDADES.length} novidades`);
for (const [i, n] of NOVIDADES.entries()) {
  ok(Number.isInteger(n.aviso) && n.aviso > 0, `#${i}: aviso é inteiro positivo (${n.aviso})`);
  ok(/^\d+\.\d+\.\d+$/.test(n.versao), `#${i}: versão x.y.z (${n.versao})`);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(n.data) && !Number.isNaN(Date.parse(`${n.data}T12:00:00Z`)), `#${i}: data AAAA-MM-DD válida (${n.data})`);
  if (i > 0) {
    const cima = NOVIDADES[i - 1];
    ok(cima.aviso > n.aviso, `#${i}: vem depois de uma novidade de número maior (${cima.aviso} > ${n.aviso})`);
    ok(cima.data >= n.data, `#${i}: não é mais nova que a de cima (${cima.data} ≥ ${n.data})`);
  }
}
ok(AVISO_VERSAO === NOVIDADES[0].aviso, `AVISO_VERSAO é a novidade do topo (${AVISO_VERSAO})`);
ok(avisoDeveMostrar(AVISO_VERSAO - 1) && avisoDeveMostrar(0) && !avisoDeveMostrar(AVISO_VERSAO),
  'quem não leu a mais recente vê o aviso; quem leu, não');

console.log('\n— os slides');
{
  const html = ler('src/client/index.html');
  const modal = html.slice(html.indexOf('<div id="aviso-jogo"'), html.indexOf('id="aviso-jogo-ok"'));
  const slides = [...modal.matchAll(/<section class="novidade" data-aviso="(\d+)"( hidden)?>/g)];
  ok(JSON.stringify(slides.map((s) => Number(s[1]))) === JSON.stringify(NOVIDADES.map((n) => n.aviso)),
    'um slide por novidade, na ordem da lista', slides.map((s) => s[1]).join(', '));
  ok(slides.length > 0 && !slides[0][2] && slides.slice(1).every((s) => s[2]), 'só o primeiro slide nasce visível');
  ok(modal.includes('id="aviso-mais-antiga"') && modal.includes('id="aviso-mais-nova"') && modal.includes('id="aviso-pontos"'),
    'o modal tem as duas setas e os pontinhos');
  const chavesDoModal = [...modal.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map((m) => m[1]);
  for (const l of ['pt', 'en', 'es']) {
    const faltam = chavesDoModal.filter((k) => typeof _dicionarios[l]?.[k] !== 'string');
    ok(!faltam.length, `${l}: todo texto dos slides existe`, faltam.join(', '));
  }
}

console.log('\n— os textos');
for (const l of ['pt', 'en', 'es']) {
  const d = _dicionarios[l];
  const chaves = ['aviso.titulo', 'aviso.tituloVersao', 'aviso.maisAntiga', 'aviso.maisNova', 'aviso.irPara', ...NOVIDADES.map((n) => n.ok)];
  const faltam = chaves.filter((k) => typeof d?.[k] !== 'string');
  ok(!faltam.length, `${l}: título, setas, pontinhos e botão de cada novidade`, faltam.join(', '));
  ok((d['aviso.tituloVersao'] ?? '').includes('{versao}') && (d['aviso.tituloVersao'] ?? '').includes('{data}'), `${l}: o título leva a versão e a data`);
  ok(!('patch.titulo' in d) && !('modal.patchnotes' in d), `${l}: os textos das notas de versão saíram`);
}

console.log('\n— o botão "!"');
{
  const app = ler('src/client/app.js');
  ok(app.includes("novidades.id = 'btn-novidades';") && app.includes('novidades.onclick = () => abrirNovidades();'), 'o "!" abre as novidades');
  ok(/function abrirNovidades\(\) \{[\s\S]{0,120}mostrarNovidade\(0\);/.test(app), 'e sempre na mais recente');
  ok(/function maybeMostrarAviso\(\)[\s\S]*?abrirNovidades\(\);/.test(app), 'o aviso automático abre o mesmo modal');
  ok(!app.includes('PATCH_NOTES') && !app.includes("abrirModal('patchnotes')") && !app.includes('renderPatchNotes'), 'as notas de versão saíram da tela');
}

console.log(`\n${testes - falhas}/${testes} ok`);
if (falhas) {
  console.log(`${falhas} falha(s)`);
  process.exit(1);
}
