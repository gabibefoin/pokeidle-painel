/** Normaliza texto de busca — tira acento, apóstrofo (Farfetch'd → farfetchd). */
export function normalizarBusca(q) {
  return String(q ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019.]/g, '')
    .toLowerCase().trim();
}
