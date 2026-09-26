// As cores do outfit do jogador, do lado de quem manda: validar e empacotar.
//
// A COLORIZAÇÃO mora no cliente (`src/client/cores-outfit.mjs`) — é lá que a máscara
// `_template` do atlas vira pixel pintado. Aqui só existe o que o servidor precisa saber para
// não confiar no cliente: quantas cores a paleta tem, e como o visual viaja no pacote.
//
// São as quatro regiões do Tibia, que é o que a máscara do pack marca:
//
//     cabeça (amarelo) · tronco (vermelho) · pernas (verde) · pés (azul)

/**
 * A paleta de outfit do Tibia tem 133 cores (19 matizes × 7 faixas de saturação/brilho).
 *
 * Aqui só interessa o TAMANHO — o servidor nunca precisa saber que a cor 94 é vermelha, só
 * que 94 é um índice válido e 200 não é. O cliente gera os valores pela mesma fórmula do
 * cliente original.
 */
const CORES = 133;

/** A ordem em que as regiões viajam no pacote. Mudar isto quebra clientes já carregados. */
export const PECAS = ['cabeca', 'corpo', 'pernas', 'pes'];

/** Cabeça alaranjada, tronco azul, calça e sapato quase pretos — o traje padrão do jogo. */
export const VISUAL_PADRAO = { cabeca: 78, corpo: 69, pernas: 114, pes: 114 };

/**
 * Peneira um visual vindo do cliente (ou do banco).
 *
 * Índice fora da faixa vira o padrão em vez de recusar o pacote inteiro: um cliente antigo que
 * mande três regiões certas e uma errada sai com um boneco desenhável, não com um erro. O que
 * NÃO se aceita é o número fora da paleta chegar ao banco — é ele que o desenho indexa.
 */
export function normalizarVisual(v) {
  const lido = Array.isArray(v) ? Object.fromEntries(PECAS.map((p, i) => [p, v[i]])) : v;
  const saida = {};
  for (const peca of PECAS) {
    const n = Number(lido?.[peca]);
    saida[peca] = Number.isInteger(n) && n >= 0 && n < CORES ? n : VISUAL_PADRAO[peca];
  }
  return saida;
}

/**
 * `[cabeca, corpo, pernas, pes]` — o que vai no campo `vs` do pacote de campo.
 *
 * O GÊNERO não entra aqui: ele já está no `looktype` que viaja ao lado (159/1503 masculino,
 * 160/1494 feminino), e mandar duas vezes a mesma informação é convite para as duas divergirem.
 */
export const empacotarVisual = (visual) => {
  const v = normalizarVisual(visual);
  return PECAS.map((p) => v[p]);
};

/**
 * O corpo de treinador de cada gênero — os dois outfits colorizáveis do pack.
 *
 * Houve uma tentativa de oferecer um segundo corpo por gênero no onboarding (1503 e 1494 do
 * espelho). Ficou ruim e saiu: o 1494 tem UM quadro por direção, então o boneco feminino
 * escorregava pelo mapa sem ciclo de caminhada. Enquanto não houver um par de sprites com a
 * mesma qualidade dos dois abaixo, a escolha é só o gênero.
 */
export const CORPO_DO_GENERO = { male: 159, female: 160 };

/** O corpo do gênero. Um lugar só para o número, em vez de `160 : 159` espalhado. */
export const corpoPadrao = (genero) => (genero === 'female' ? CORPO_DO_GENERO.female : CORPO_DO_GENERO.male);
