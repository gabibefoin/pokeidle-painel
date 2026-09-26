// Teste da REGRA: a Pokédex é rei — um clone com o nome de uma espécie usa os golpes dela.
//
// Não precisa de banco nem de servidor — é catálogo puro.
//
//   node tools/teste-golpes-clones.mjs
//
// Nasceu de um relato no Discord: um Shedinja shiny com Tackle e Quick Attack (NORMAL, num
// BUG/GHOST), todos com 56 de poder, enquanto a Pokédex do Shedinja mostra a escada curada de
// 25 a 140. O shiny era coincidência — quem tinha golpes próprios era o CLONE DE ORRE (#13292),
// que herda nome, sprite e tipos da espécie nacional e ficou parado nos golpes crus do espelho.
// Eram 130 dos 132 clones. Ver `src/shared/herdar-golpes-orre.mjs`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { especies } from '../src/server/content.mjs';
import { nacionalDeOrre } from '../src/shared/herdar-golpes-orre.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

/** A lista de golpes como texto — nome, tipo, categoria e poder, na ordem. */
const assinatura = (esp) =>
  (esp?.attacks ?? []).map((m) => `${m.name}|${m.type}|${m.damageClass}|${m.power}`).join(' · ');

// ------------------------------------------------------- todos os clones de Orre
secao('Todo clone de Orre usa os golpes da espécie nacional');
{
  const divergem = [];
  const semBase = [];
  let clones = 0;
  for (const esp of especies.values()) {
    const baseId = nacionalDeOrre(esp.pokeId);
    if (baseId == null) continue;
    clones++;
    const base = especies.get(baseId);
    if (!base) { semBase.push(`#${esp.pokeId} ${esp.name}`); continue; }
    // O nome tem de ser o mesmo: é ele que faz o jogador olhar a Pokédex da espécie e esperar
    // aquela lista. Se um dia um clone ganhar nome próprio, esta é a linha que avisa.
    if (esp.name !== base.name) divergem.push(`#${esp.pokeId} tem nome próprio ("${esp.name}")`);
    else if (assinatura(esp) !== assinatura(base)) {
      divergem.push(`#${esp.pokeId} ${esp.name}: ${(esp.attacks ?? []).length} golpes vs ${(base.attacks ?? []).length} do #${baseId}`);
    }
  }
  ok(clones > 100, `o catálogo tem ${clones} clones de Orre`);
  ok(semBase.length === 0, 'todos têm a espécie nacional no catálogo', semBase.join(', '));
  ok(divergem.length === 0, 'e nenhum deles diverge dela nos golpes', divergem.slice(0, 6).join(' | '));
}

// ----------------------------------------------------------- o caso do Discord
secao('O Shedinja do relato');
{
  const nacional = especies.get(292);
  const clone = especies.get(13292);
  ok(clone != null, 'o clone de Orre #13292 existe');
  ok(assinatura(clone) === assinatura(nacional),
    `#13292 tem a mesma lista do #292 (${(clone?.attacks ?? []).length} golpes)`);
  // Os dois sintomas que o jogador apontou, checados na unha: nada de NORMAL num BUG/GHOST, e
  // os golpes de GHOST são mais que dois.
  const tipos = (clone?.attacks ?? []).map((m) => m.type);
  ok(!tipos.includes('NORMAL'), 'sem golpe NORMAL num BUG/GHOST', tipos.join(','));
  ok(tipos.filter((t) => t === 'GHOST').length > 2,
    `e mais de dois golpes GHOST (${tipos.filter((t) => t === 'GHOST').length})`);
  // E o poder deixou de ser o 56 chapado do espelho.
  const poderes = new Set((clone?.attacks ?? []).map((m) => m.power));
  ok(poderes.size > 4, `a escada de poder voltou (${poderes.size} valores diferentes)`);
}

// ------------------------------------- o clone não ganha golpe que o nacional não tem
secao('O clone não inventa golpe de 600 que a Pokédex não dá');
{
  // O Dusclops é a armadilha da ordem: o nacional evolui em Dusknoir e por isso NÃO ganha os
  // golpes de assinatura, mas não existe Dusknoir de Orre — o clone passava por última evolução
  // e ganhava dois golpes de 600 sozinho. Só copiar DEPOIS da injeção resolve.
  const nacional = especies.get(356);
  const clone = especies.get(13356);
  const seis = (e) => (e?.attacks ?? []).filter((m) => m.power >= 600).map((m) => m.name);
  ok(seis(nacional).length === 0, 'o Dusclops nacional não tem golpe de 600 (ele ainda evolui)');
  ok(seis(clone).length === 0, 'e o clone de Orre também não', seis(clone).join(', '));
  ok(assinatura(clone) === assinatura(nacional), 'as duas listas são idênticas');

  // E o contrário: quem É última evolução mantém os dois golpes de 600 dos dois lados.
  const shedinja = especies.get(292);
  const cloneShed = especies.get(13292);
  ok(seis(shedinja).length === 2 && seis(cloneShed).length === 2,
    'e o Shedinja, que é ponta de cadeia, mantém os dois nos dois');
}

// ------------------------------------------------------------ shiny não mexe em golpe
secao('Ser shiny não muda golpe nenhum');
{
  // O relato veio de um shiny, mas o shiny é só looktype: `catalogoShiny` guarda sprite, tier e
  // contagem, e a lista de golpes sai de `golpesDaFicha(especie)`, que só recebe a ESPÉCIE.
  // Este teste é o que impede alguém de um dia ramificar golpe por shiny sem perceber.
  // Os comentários saem antes da busca: eles CITAM o shiny (o relato veio de um), e o que não
  // pode existir é código ramificando por ele.
  const semComentario = (txt) => txt
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  for (const arquivo of ['golpes-especiais.mjs', 'golpes-planilhas.mjs', 'herdar-golpes-orre.mjs']) {
    const txt = semComentario(readFileSync(join(raiz, 'src/shared', arquivo), 'utf8'));
    ok(!/\bshiny\b/i.test(txt), `${arquivo}: nenhum código olha para shiny`);
  }
  const golpes = readFileSync(join(raiz, 'src/shared/golpes-especiais.mjs'), 'utf8').replace(/\r\n/g, '\n');
  ok(/export function golpesDaFicha\(especie\)/.test(golpes),
    'e `golpesDaFicha` recebe a espécie, não o pokémon (não há de onde tirar o shiny)');
}

// ------------------------------------------- cliente e servidor na mesma ordem
secao('As duas pontas herdam no mesmo ponto');
{
  const conteudo = readFileSync(join(raiz, 'src/server/content.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const app = readFileSync(join(raiz, 'src/client/app.js'), 'utf8').replace(/\r\n/g, '\n');
  for (const [nome, txt] of [['servidor', conteudo], ['cliente', app]]) {
    const iInjeta = txt.indexOf('injetarGolpesEspeciais(');
    const iHerda = txt.indexOf('herdarGolpesOrre(');
    ok(iHerda > 0, `${nome}: chama herdarGolpesOrre`);
    // DEPOIS da injeção, e é a ordem que resolve o Dusclops acima. Invertida, o clone volta a
    // ganhar golpe de 600 por ter a cadeia truncada — e só nele, em silêncio.
    ok(iInjeta > 0 && iHerda > iInjeta,
      `${nome}: e depois de injetarGolpesEspeciais, senão o clone de cadeia truncada ganha 600 sozinho`);
  }
}

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
