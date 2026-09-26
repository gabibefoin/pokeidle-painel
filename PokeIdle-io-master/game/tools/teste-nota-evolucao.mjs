// Teste da REGRA: evoluir sempre SOBE o N=, nunca derruba e nunca empata.
//
// Não precisa de banco nem de servidor — é catálogo e conta pura.
//
//   node tools/teste-nota-evolucao.mjs
//
// A regra nasceu de um relato de jogador: Magmar 2,495 virava Magmortar 2,479, e Electabuzz
// 2,492 virava Electivire 2,479 com o MESMO nascimento. A causa e a correção estão explicadas
// em `src/shared/linhagem-nota.mjs`; aqui se prova que ela vale para o catálogo inteiro, e não
// só para as quatro cadeias que apareceram no Discord.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { especies } from '../src/server/content.mjs';
import { destinosDeEvolucao } from '../src/shared/evolucoes-ramificadas.mjs';
import { notaDePokemon, GANHO_MIN_EVOLUCAO } from '../src/shared/nota-pokemon.mjs';

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

const nota = (esp, iv, q, pot, shiny) =>
  notaDePokemon({ iv, quality: q, potencia: pot, shiny }, esp);

// A grade cobre os extremos e o meio de cada eixo. Os extremos importam mais do que parecem: a
// queda era MAIOR justamente no canto "IV no teto, qualidade e potência no piso", porque é ali
// que o eixo diluído pela base é o único que estava sustentando a nota.
const IVS = [6, 40, 97, 130, 160, 192];
const QS = [0.8, 1.037, 1.2, 1.5, 1.8];
const POTS = [1, 2, 3, 4, 5];
const SHINYS = [false, true];

// ------------------------------------------------- o catálogo inteiro, par a par
secao('Toda evolução do catálogo SOBE a nota');
{
  const quedas = [];
  const curtas = [];
  let pares = 0;
  let amostras = 0;
  let noTeto = 0;
  for (const esp of especies.values()) {
    for (const d of destinosDeEvolucao(esp, (id) => especies.get(id))) {
      if (!d.especie || d.especie.pokeId === esp.pokeId) continue;
      pares++;
      for (const iv of IVS) for (const q of QS) for (const pot of POTS) for (const shiny of SHINYS) {
        const a = nota(esp, iv, q, pot, shiny);
        const b = nota(d.especie, iv, q, pot, shiny);
        if (a == null || b == null) continue;
        amostras++;
        const caso = `${esp.name} -> ${d.especie.name} (IV ${iv} q ${q} P${pot}${shiny ? ' shiny' : ''}): ${a} -> ${b}`;
        // A margem é de meio milésimo: a nota é arredondada em três casas, e exigir
        // igualdade binária transformaria o ruído do arredondamento em falha.
        if (b - a < -0.0005) quedas.push(caso);
        // O TETO é a única exceção legítima ao degrau: 10 é 10, e não há para onde subir. Vale
        // para o nascimento que já bate em 10 dos dois lados (não mudou nada) e também para o
        // que chega em 10 só depois de evoluir — Type: Null 9,952 → Silvally 10 ganha 0,048 e
        // está certo, porque o degrau inteiro pediria um 10,05 que não existe.
        if (a >= 9.9995 && b >= 9.9995) { noTeto++; continue; }
        if (b >= 9.9995) continue;
        if (b - a < GANHO_MIN_EVOLUCAO - 0.0005) curtas.push(caso);
      }
    }
  }
  ok(pares > 400, `o catálogo tem ${pares} pares de evolução para conferir`);
  ok(amostras > 100000, `${amostras} combinações de nascimento medidas dos dois lados`);
  ok(quedas.length === 0, 'nenhuma delas PERDE nota ao evoluir', quedas.slice(0, 5).join(' | '));
  ok(curtas.length === 0,
    `e nenhuma ganha menos que o degrau de ${GANHO_MIN_EVOLUCAO} (fora as ${noTeto} que já estão no teto)`,
    curtas.slice(0, 5).join(' | '));
}

// ------------------------------------------------------- os casos que geraram a regra
secao('Os quatro relatados no Discord, com o nascimento exato do print');
{
  // IV 97, qualidade 1,037, potência IV, sem shiny — os números do print do jogador.
  const roll = [97, 1.037, 4, false];
  const pares = [
    ['Magmar', 126, 'Magmortar', 467],
    ['Electabuzz', 125, 'Electivire', 466],
    ['Rhydon', 112, 'Rhyperior', 464],
    ['Scyther', 123, 'Scizor', 212],
  ];
  for (const [nomeDe, idDe, nomePara, idPara] of pares) {
    const a = nota(especies.get(idDe), ...roll);
    const b = nota(especies.get(idPara), ...roll);
    ok(b - a >= GANHO_MIN_EVOLUCAO - 0.0005,
      `${nomeDe} ${a} -> ${nomePara} ${b}`, `ganhou só ${(b - a).toFixed(3)}`);
  }
  // E o canto onde a queda era pior: IV no teto com o resto no piso.
  for (const [nomeDe, idDe, nomePara, idPara] of pares) {
    const a = nota(especies.get(idDe), 192, 0.8, 1, false);
    const b = nota(especies.get(idPara), 192, 0.8, 1, false);
    ok(b - a >= GANHO_MIN_EVOLUCAO - 0.0005,
      `${nomeDe} -> ${nomePara} no pior canto (IV 192, q 0,8, P1): ${a} -> ${b}`,
      `ganhou só ${(b - a).toFixed(3)}`);
  }
}

// ------------------------------------------------------------------ o piso não achata
secao('O degrau é um piso, não um acréscimo — e vale na cadeia inteira');
{
  // Onde a evolução já ganhava mais que o degrau por conta própria, o valor tem de ser o dela,
  // e não o degrau: o piso é um mínimo. Aqui o eixo forte é a qualidade, que a base não dilui.
  const magby = especies.get(240);
  const magmar = especies.get(126);
  const magmortar = especies.get(467);
  const sobe = nota(magmortar, 6, 1.8, 5, true) - nota(magmar, 6, 1.8, 5, true);
  ok(sobe > GANHO_MIN_EVOLUCAO,
    `com o IV no piso e o resto no teto, o ganho próprio (+${sobe.toFixed(3)}) é maior que o degrau e prevalece`);

  // Num TRIO, a terceira forma fica dois degraus acima da primeira — senão a garantia valeria
  // de um elo para o outro e se perderia ao longo da cadeia.
  if (magby) {
    const d = nota(magmortar, 192, 0.8, 1, false) - nota(magby, 192, 0.8, 1, false);
    ok(d >= 2 * GANHO_MIN_EVOLUCAO - 0.001,
      `Magby -> Magmar -> Magmortar acumula os dois degraus (+${d.toFixed(3)})`);
  }

  // O teto é o teto: nascimento perfeito é 10 dos dois lados, e o degrau não inventa um 10,1.
  const perfeito = nota(magmortar, 192, 1.8, 5, true);
  ok(perfeito === 10, `nascimento perfeito continua valendo exatamente 10 (${perfeito})`);

  // E quem não tem forma anterior nenhuma continua sem nenhuma conta a mais.
  const bulbasaur = especies.get(1);
  ok(!bulbasaur?.notaAncestrais, 'espécie que abre cadeia não ganha piso (Bulbasaur)');
  ok(Array.isArray(magmortar?.notaAncestrais) && magmortar.notaAncestrais.length >= 2,
    `Magmortar carrega o piso das formas anteriores (${magmortar?.notaAncestrais?.length ?? 0})`);
  ok(magmortar?.notaAncestrais?.some((a) => a.passos === 2),
    'e sabe que uma delas está a DOIS degraus de distância');
}

// ------------------------------------------------- cliente e servidor na mesma ordem
secao('O catálogo dos dois lados anota o piso no mesmo ponto');
{
  const conteudo = readFileSync(join(raiz, 'src/server/content.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const app = readFileSync(join(raiz, 'src/client/app.js'), 'utf8').replace(/\r\n/g, '\n');
  for (const [nome, txt] of [['servidor', conteudo], ['cliente', app]]) {
    const iCruzadas = txt.indexOf('aplicarEvolucoesEntreGeracoes(');
    const iLinhagem = txt.indexOf('anotarLinhagemDaNota(');
    ok(iLinhagem > 0, `${nome}: chama anotarLinhagemDaNota`);
    // Os elos entre gerações são metade das cadeias que tinham o problema. Anotar o piso antes
    // deles deixaria Magmortar e Electivire sem forma anterior nenhuma — e o bug de volta, em
    // silêncio e só nessas espécies.
    ok(iCruzadas > 0 && iLinhagem > iCruzadas,
      `${nome}: e depois dos elos entre gerações, senão as cadeias cruzadas ficam sem piso`);
  }
}

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
