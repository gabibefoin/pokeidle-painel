/**
 * O sorteio da liberação do Mercado da Comunidade.
 *
 * ### O problema
 *
 * Um anúncio fica retido por 2 minutos e libera num instante que todo mundo conhece (`compravelEm`).
 * Quem compra primeiro leva — e primeiro, ali, é quem manda o pedido no milissegundo certo. Em
 * produção (14 dias até 15/09/2026) 481 compras aconteceram menos de 0,5 s depois de liberar,
 * a maioria de poucos compradores com mediana de 14–44 ms: bot, não gente.
 *
 * ### A regra
 *
 * Pedido que chega nos primeiros `JANELA_SORTEIO_MS` (3 s) depois da liberação não compra na
 * hora: ele TENTA num instante sorteado entre 3 e 4 s. Chegar no 1º milissegundo ou no 2º segundo
 * dá a mesma chance. Pedido que chega entre 3 e 4 s espera o sorteio terminar. Depois de 4 s,
 * compra na hora, como sempre.
 *
 * ### Por que funciona entre shards sem coordenação
 *
 * Cada sim sorteia o instante do próprio pedido. O primeiro instante sorteado a chegar ao banco
 * leva — o `FOR UPDATE` de `comprarAnuncio` decide —, e isso é um sorteio uniforme entre TODOS os
 * pedidos da janela, de qualquer shard. Pilha com várias unidades vai sendo levada na ordem
 * sorteada até acabar.
 */
export const JANELA_SORTEIO_MS = 3000;
export const ESPALHAR_SORTEIO_MS = 1000;

/**
 * Quanto este pedido espera antes de tentar a compra.
 *
 *   · `retido`  — antes da liberação: quem recusa é a retenção, com a mensagem de sempre;
 *   · `sorteio` — nos primeiros 3 s: tenta num instante sorteado entre 3 e 4 s depois de liberar;
 *   · `espera`  — entre 3 e 4 s: tenta logo depois de o sorteio terminar;
 *   · `agora`   — depois de 4 s (ou anúncio sem retenção): compra na hora.
 */
export function planoDaCompra(compravelEm, agora, aleatorio = Math.random) {
  if (!compravelEm) return { tipo: 'agora', esperaMs: 0 };
  if (agora < compravelEm) return { tipo: 'retido', esperaMs: 0 };
  const fimJanela = compravelEm + JANELA_SORTEIO_MS;
  const fimSorteio = fimJanela + ESPALHAR_SORTEIO_MS;
  if (agora < fimJanela) {
    return { tipo: 'sorteio', esperaMs: Math.max(1, Math.round(fimJanela + aleatorio() * ESPALHAR_SORTEIO_MS - agora)) };
  }
  if (agora < fimSorteio) return { tipo: 'espera', esperaMs: Math.max(1, fimSorteio + 25 - agora) };
  return { tipo: 'agora', esperaMs: 0 };
}
