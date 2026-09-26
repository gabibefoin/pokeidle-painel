// Gera a arte das CAIXAS DE FUNDADOR a partir das folhas de outfit.
//
//     node tools/gerar-caixas-beta.mjs [pasta-com-as-folhas]
//
// Duas saídas por caixa, as duas versionadas em `src/client/img/` (arte NOSSA — o espelho de
// `public/data/asset-packs/` é regenerável e sumiria no primeiro `npm run fetch`; ver a nota
// de `FOLHAS_PROPRIAS` em `src/client/sprites.mjs`):
//
//   img/outfit-<tipo>.png        a folha do boneco, copiada da fonte (4 direções × 4 quadros
//                                de 64×64) — é o que `carregarFolhaPropria` lê
//   img/itens/caixa-<tipo>.png   o ÍCONE: um baú de madeira com o boneco saindo de dentro
//
// O ícone existe porque a Loja, a Bolsa e o Mercado desenham a caixa como ITEM, e um item
// precisa parecer uma caixa — não o boneco solto. O baú é desenhado aqui, pixel a pixel, na
// paleta de madeira do `:root` (ver `src/client/DESIGN.md`), e o boneco entra recortado pelo
// alto: só a cabeça e o tronco passam por cima da parede de trás e ficam atrás da da frente.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerPng, Tela } from './lib/png-cru.mjs';
import { CAIXAS_BETA } from '../src/shared/caixas-beta.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CLIENTE = join(AQUI, '..', 'src', 'client', 'img');
const ORIGEM = process.argv[2] ?? 'C:/Users/pedro/Desktop/Sprites/NP';

/** O lado de um quadro na folha de origem — 4 colunas (direção) por 4 linhas (quadro). */
const CELULA = 64;
/** Coluna 2 = direção 3 (sul): o boneco de frente, que é o que o ícone mostra. */
const COL_SUL = 2;

// A paleta de madeira do `:root`, em RGB. Escrita aqui porque um PNG não lê variável de CSS —
// mas os valores são LITERALMENTE os do design system, para o baú não destoar da tábua.
const MAD_LINHA = [0x48, 0x0e, 0x1e];
const MAD_LUZ = [0xf1, 0xd3, 0xb7];
const MAD = [0xbd, 0x69, 0x51];
const MAD_ESC = [0x91, 0x48, 0x50];
const MAD_QUENTE = [0xdf, 0x82, 0x4c];
const MAD_BASE = [0x72, 0x2c, 0x3f];

const hexRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Escurece uma cor — o contorno das ferragens sai daqui, sem precisar de um segundo hex. */
const escurecer = ([r, g, b], f) => [Math.round(r * f), Math.round(g * f), Math.round(b * f)];

/**
 * O ícone: baú aberto, boneco saindo.
 *
 * A ordem de desenho É o efeito. Primeiro a tampa (lá no alto, tombada para trás), depois a
 * parede de TRÁS do baú, então o boneco — recortado na altura da boca —, e por último a
 * parede da FRENTE por cima dele. É isso que faz o boneco parecer DENTRO da caixa em vez de
 * colado em cima dela.
 *
 * ### Por que 96×96 e não 64
 *
 * O boneco ocupa 45×52 do quadro de origem, e ele entra em escala 1:1 — reduzir pixel art por
 * um fator quebrado borra a arte que a caixa existe para vender. Num ícone de 64 sobrariam 12
 * px de cada lado: baú nenhum cabe nisso, e foi exatamente o que a primeira versão mostrou —
 * um bicho gigante com duas tábuas na frente. Em 96 o boneco fica com metade da altura da
 * arte e o baú tem onde ser um baú. Quem exibe escala para baixo (`object-fit: contain`).
 */
function desenharCaixa(folha, acento) {
  const L = 96;
  const tela = new Tela(L, L);
  const ferro = hexRgb(acento);
  const ferroEsc = escurecer(ferro, 0.5);
  const ferroLuz = [
    Math.min(255, ferro[0] + 55), Math.min(255, ferro[1] + 55), Math.min(255, ferro[2] + 55),
  ];
  const VAO = [0x2a, 0x18, 0x20]; // o miolo do baú, na cor do `--vao` do design system

  // ------------------------------------------------------------------ tampa
  // A tampa ABERTA, tombada para trás: uma laje logo acima da boca. Ela não fica flutuando
  // sozinha lá no topo (foi a primeira tentativa, e o resultado parecia uma prateleira solta)
  // — fica colada na boca do baú, e o boneco passa NA FRENTE dela. O que se vê da tampa são
  // as duas faixas dos lados, e é justamente isso que diz "está aberta".
  tela.retangulo(10, 32, 76, 20, MAD_LINHA);
  tela.retangulo(12, 34, 72, 16, MAD_ESC);
  tela.retangulo(12, 34, 72, 3, MAD);
  tela.retangulo(13, 34, 70, 1, MAD_LUZ);
  tela.retangulo(42, 32, 12, 20, ferroEsc);
  tela.retangulo(44, 34, 8, 16, ferro);
  tela.retangulo(44, 34, 8, 1, ferroLuz);

  // --------------------------------------------------------- parede de trás
  // A BOCA do baú: a faixa escura que aparece atrás dos ombros do boneco e diz que ele está
  // saindo de um buraco, e não parado na frente de um móvel.
  tela.retangulo(3, 48, 90, 16, MAD_LINHA);
  tela.retangulo(5, 50, 86, 14, VAO);
  tela.retangulo(5, 50, 86, 3, MAD_BASE);

  // ---------------------------------------------------------------- boneco
  // Recortado na linha da boca (`CORTE`): o que passa disso está dentro do baú e não se vê.
  // O quadro de origem tem 64×64 com padding transparente; `limites` acha o desenho de fato,
  // e daí ele é centrado com o corte na altura certa.
  //
  // `MERGULHO` é o quanto do boneco fica submerso, e ele é PEQUENO de propósito: quatro
  // pixels bastam para o boneco parecer dentro do baú, e cada pixel a mais come a cara —
  // que é justamente a coisa que a caixa está vendendo.
  const CORTE = 64;
  const MERGULHO = 4;
  const b = Tela.limites(folha, COL_SUL * CELULA, 0, CELULA, CELULA);
  const dx = Math.round((L - b.w) / 2);
  const dy = CORTE + MERGULHO - b.h;
  tela.colar(folha, {
    sx: b.x, sy: b.y, sw: b.w, sh: b.h, dx, dy,
    recorte: (x, y) => y < CORTE,
  });

  // -------------------------------------------------------- parede da frente
  tela.retangulo(5, 60, 86, 30, MAD_LINHA);
  tela.retangulo(7, 62, 82, 26, MAD);
  tela.retangulo(7, 62, 82, 2, MAD_LUZ);
  tela.retangulo(7, 83, 82, 4, MAD_QUENTE);
  tela.retangulo(7, 87, 82, 2, MAD_BASE);
  // As tábuas: dois vincos verticais. É o que distingue um baú de um bloco de madeira.
  tela.retangulo(31, 64, 2, 23, MAD_ESC);
  tela.retangulo(63, 64, 2, 23, MAD_ESC);
  // Cantoneiras — as duas quinas ganham reforço, como num baú de verdade.
  tela.retangulo(5, 60, 4, 30, MAD_BASE);
  tela.retangulo(87, 60, 4, 30, MAD_BASE);

  // ----------------------------------------------------------------- ferro
  // Cinta horizontal + fechadura no meio, na cor da caixa (verde no Fundador, roxo no
  // CoFundador). É o único lugar do desenho em que a COR diz de qual caixa se trata.
  tela.retangulo(5, 68, 86, 8, ferroEsc);
  tela.retangulo(5, 70, 86, 4, ferro);
  tela.retangulo(5, 70, 86, 1, ferroLuz);
  tela.retangulo(38, 64, 20, 18, ferroEsc);
  tela.retangulo(40, 66, 16, 14, ferro);
  tela.retangulo(40, 66, 16, 1, ferroLuz);
  tela.retangulo(45, 70, 6, 6, [0x18, 0x0e, 0x12]); // o buraco da chave

  // ---------------------------------------------------------------- sombra
  tela.retangulo(11, 90, 74, 3, [0x24, 0x12, 0x1c, 0x9c]);
  tela.retangulo(17, 93, 62, 2, [0x24, 0x12, 0x1c, 0x55]);

  return tela;
}

mkdirSync(join(CLIENTE, 'itens'), { recursive: true });

for (const caixa of Object.values(CAIXAS_BETA)) {
  const bruto = readFileSync(join(ORIGEM, `${caixa.arquivoFonte}.png`));
  const folha = lerPng(bruto);
  if (folha.larg !== CELULA * 4) {
    throw new Error(`${caixa.arquivoFonte}.png tem ${folha.larg}px de largura; esperado ${CELULA * 4}`);
  }

  // A folha do boneco vai como está: a convenção do arquivo (4 colunas de direção, N linhas de
  // quadro) já é a que `carregarFolhaPropria` lê. Copiar em vez de referenciar o Desktop é o
  // ponto — a arte precisa estar versionada junto do cliente.
  const destinoFolha = join(CLIENTE, `outfit-${caixa.tipo}.png`);
  writeFileSync(destinoFolha, bruto);

  const icone = desenharCaixa(folha, caixa.cor);
  const destinoIcone = join(CLIENTE, 'itens', `caixa-${caixa.tipo}.png`);
  writeFileSync(destinoIcone, icone.paraPng());

  console.log(`${caixa.tipo}: folha ${folha.larg}×${folha.alt} → ${destinoFolha}`);
  console.log(`${caixa.tipo}: ícone ${icone.larg}×${icone.alt} → ${destinoIcone}`);
}
