/** Sucata de drop de pedra — não evolui; continua vendável ao NPC se tiver preço. */
export const SUCATA_STONE = new Set(['rough gemstone']);

/**
 * Itens mortos do espelho — não entram no catálogo, loot, Mercado nem venda ao NPC.
 *
 * A Moon Stone entrou aqui em 13/09/2026: não evolui nenhuma espécie, não cai de pokémon nenhum e
 * só ocupava uma vaga na aba Pedras do Mercado. Em produção ninguém a tinha na bolsa nem anunciada.
 */
const ITENS_MORTOS = new Set(['strange pheromone', '10000 carat emerald', 'moon stone']);

function normNomeItemMorto(nome) {
  return String(nome ?? '').toLowerCase().replace(/\./g, '');
}

export function itemMortoPorNome(nome) {
  return ITENS_MORTOS.has(normNomeItemMorto(nome));
}

export function itemMortoDoJogo(item) {
  return !!item && itemMortoPorNome(item.name);
}

/** Pedra de evolução — negociável no Mercado da Comunidade, não vende ao NPC. */
export function ehPedraEvolucao(item) {
  return !!item && item.category === 'stone' && !SUCATA_STONE.has((item.name ?? '').toLowerCase());
}

/**
 * Se o item pode ir na aba Venda do Market / auto-venda ao NPC.
 * Espelha `precoDeVenda` do servidor.
 */
export function itemVendavelAoNpc(item, {
  bossTokenId,
  pvpFichaId,
  categoriasCompraveis = new Set(['heal', 'revive']),
  itensCompraveisIds = new Set(),
} = {}) {
  if (!item || (item.npcPrice ?? 0) <= 0) return false;
  if (bossTokenId != null && item.id === bossTokenId) return false;
  if (pvpFichaId != null && item.id === pvpFichaId) return false;
  if (categoriasCompraveis.has(item.category)) return false;
  if (itensCompraveisIds instanceof Map ? itensCompraveisIds.has(item.id) : itensCompraveisIds.has(item.id)) return false;
  if (ehPedraEvolucao(item)) return false;
  if (itemMortoDoJogo(item)) return false;
  return true;
}

/** Zera o preço de NPC das pedras de evolução — o espelho ainda traz 5.000. */
export function normalizarNpcPriceItem(item) {
  if (!item || !ehPedraEvolucao(item)) return item;
  return item.npcPrice === 0 ? item : { ...item, npcPrice: 0 };
}
