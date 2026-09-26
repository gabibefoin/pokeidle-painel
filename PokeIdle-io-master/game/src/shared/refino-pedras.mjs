/**
 * Quais pedras de evolução servem para REFINAR uma espécie — e como mesclar saldos.
 *
 * Dual-type aceita pedra de qualquer um dos tipos elementares do bicho (Fire Stone OU Feather
 * Stone num Charizard). Os custos somam entre elas: 300 Feather + 200 Fire fecham um degrau de
 * 500. A ordem de consumo é determinística (maior pilha primeiro) — o jogador não precisa
 * escolher a mistura na tela.
 */
import { tipoDaPedraDeEvolucao } from './evolucoes-ramificadas.mjs';
import { PEDRA_POR_TIPO } from './pedras-evolucao.mjs';

/** Tipos elementais cujas pedras entram no refino desta espécie (sem repetir). */
export function tiposPedraRefino(especie) {
  if (!especie) return [];
  const vistos = new Set();
  const out = [];
  for (const t of [tipoDaPedraDeEvolucao(especie), especie.type1, especie.type2]) {
    if (!t || vistos.has(t)) continue;
    vistos.add(t);
    out.push(t);
  }
  return out;
}

/** `{ tipo, nome }[]` — nomes únicos, na ordem dos tipos acima. */
export function nomesPedraRefino(especie) {
  const vistos = new Set();
  const out = [];
  for (const tipo of tiposPedraRefino(especie)) {
    const nome = PEDRA_POR_TIPO[tipo] ?? PEDRA_POR_TIPO.NORMAL;
    if (vistos.has(nome)) continue;
    vistos.add(nome);
    out.push({ tipo, nome });
  }
  return out;
}

/** Resolve `{ tipo, nome, itemId }[]` usando o mapa tipo→pedra do welcome/catálogo. */
export function pedrasRefinoResolvidas(especie, mapaPorTipo) {
  const vistos = new Set();
  const out = [];
  for (const tipo of tiposPedraRefino(especie)) {
    const p = mapaPorTipo?.[tipo] ?? mapaPorTipo?.NORMAL;
    if (!p?.itemId || vistos.has(p.itemId)) continue;
    vistos.add(p.itemId);
    out.push({ tipo, itemId: p.itemId, nome: p.nome ?? p.name ?? 'Stone' });
  }
  return out;
}

export function saldoPedrasRefino(items, pedras) {
  let s = 0;
  for (const p of pedras ?? []) s += Math.max(0, Math.floor(Number(items?.[p.itemId]) || 0));
  return s;
}

/**
 * Gasta `custo` pedras mesclando os tipos válidos. Mutates `items`.
 * @returns {{ itemId, nome, qtd }[]} ou `null` se o saldo não fechar.
 */
export function consumirPedrasRefino(items, pedras, custo) {
  const total = Math.floor(Number(custo) || 0);
  if (total <= 0) return [];
  if (saldoPedrasRefino(items, pedras) < total) return null;

  let falta = total;
  const consumido = [];
  const ordenadas = [...(pedras ?? [])].sort(
    (a, b) => (items[b.itemId] ?? 0) - (items[a.itemId] ?? 0),
  );

  for (const p of ordenadas) {
    if (falta <= 0) break;
    const tem = Math.max(0, Math.floor(Number(items[p.itemId]) || 0));
    if (!tem) continue;
    const usa = Math.min(tem, falta);
    const resta = tem - usa;
    if (resta > 0) items[p.itemId] = resta;
    else delete items[p.itemId];
    consumido.push({ itemId: p.itemId, nome: p.nome, qtd: usa });
    falta -= usa;
  }

  return falta <= 0 ? consumido : null;
}

/** Prévia do consumo — não altera o inventário real. */
export function simularConsumoPedrasRefino(items, pedras, custo) {
  const copia = { ...(items ?? {}) };
  return consumirPedrasRefino(copia, pedras, custo);
}

export function formatarConsumoPedras(consumido) {
  if (!consumido?.length) return '';
  return consumido.map((c) => `${c.qtd}× ${c.nome}`).join(' + ');
}

export function rotuloPedrasRefino(pedras) {
  if (!pedras?.length) return '';
  if (pedras.length === 1) return pedras[0].nome;
  return pedras.map((p) => p.nome).join(' / ');
}
