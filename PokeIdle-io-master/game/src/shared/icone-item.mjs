/** Converte o campo `icon` do items.json no caminho relativo servido em `/assets/…`. */
export function caminhoIconeRel(icon) {
  if (!icon) return null;
  if (icon.startsWith('site/')) return icon;
  if (icon.startsWith('/')) return `site${icon}`;
  return `site/assets/items/${icon}`;
}