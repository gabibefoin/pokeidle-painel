/**
 * Teste do escape de HTML — com o caso que a versão antiga deixava passar.
 *
 * O `escapar` do jogo cobria `< > &`. Isso basta para texto que vira CONTEÚDO de elemento e não
 * basta para texto que vira valor de ATRIBUTO, e `app.js` tem dezenas de
 * `title="${escapar(x)}"`. Uma aspa fecha o atributo e o resto da string vira marcação — sem
 * precisar de um único `<`, que era justamente o que estava sendo vigiado.
 *
 * O teste não confere strings bonitinhas: ele monta o atributo, escapa, e verifica que o
 * resultado não tem como sair de dentro das aspas.
 *
 *   node tools/teste-escapar-html.mjs
 */
import { escaparHtml } from '../src/shared/escapar-html.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

console.log('Escape de HTML\n==============');

secao('Os cinco caracteres');
ok(escaparHtml('<') === '&lt;', '<');
ok(escaparHtml('>') === '&gt;', '>');
ok(escaparHtml('&') === '&amp;', '&');
ok(escaparHtml('"') === '&quot;', '" (o que faltava no jogo)');
ok(escaparHtml("'") === '&#39;', "' (o que faltava nos dois)");

secao('A fuga de atributo que passava antes');
// O payload não tem `<` nenhum: ele só precisa fechar a aspa do `title` para virar marcação.
const payload = '" onmouseover="alert(1)';
const atributo = `<span title="${escaparHtml(payload)}">x</span>`;
ok(!/title="[^"]*"\s+onmouseover/.test(atributo), 'aspa dupla não fecha o atributo', atributo);
ok(!atributo.includes('onmouseover="'), 'não sobra manipulador de evento solto');

const payloadSimples = "' onfocus='alert(1)";
const atributoSimples = `<span title='${escaparHtml(payloadSimples)}'>x</span>`;
ok(!atributoSimples.includes("onfocus='"), 'aspa simples também não escapa do atributo', atributoSimples);

secao('Conteúdo de elemento continua protegido');
ok(
  escaparHtml('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;',
  'tag injetada em conteúdo vira texto',
);
ok(escaparHtml('a & b') === 'a &amp; b', 'o & vira entidade (senão o resto se perde)');

secao('Não corrompe texto normal');
// Acento, emoji e espaço passam intactos: escapar demais estragaria nick e chat de todo mundo.
for (const s of ['Menecito', 'João da Silva', 'Ração 50%', '★ shiny ★', 'ok?!', 'a<b']) {
  const saida = escaparHtml(s);
  const devolta = saida
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
  ok(devolta === s, `"${s}" volta idêntico ao desfazer o escape`, saida);
}

secao('Entradas que o servidor pode mandar');
ok(escaparHtml(null) === '', 'null vira string vazia (a versão antiga estourava)');
ok(escaparHtml(undefined) === '', 'undefined também');
ok(escaparHtml(0) === '0', 'número vira texto');

secao('Uma cópia só da regra');
// A do painel admin escapava `"` mas não `'`; a do jogo não escapava nenhuma das duas. Enquanto
// forem dois lugares, elas voltam a divergir — este teste existe para lembrar disso.
const { readFileSync } = await import('node:fs');
const app = readFileSync(new URL('../src/client/app.js', import.meta.url), 'utf8');
ok(app.includes("from '../shared/escapar-html.mjs'"), 'app.js usa a versão compartilhada');
ok(
  !/const escapar = \(s\) => s\.replace/.test(app),
  'e não sobrou a implementação local antiga',
);

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
