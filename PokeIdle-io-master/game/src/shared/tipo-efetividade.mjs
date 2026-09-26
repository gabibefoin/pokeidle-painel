/**
 * Efetividade elemental — mesma conta do bundle original e de `tools/build-formulas.mjs`.
 *
 * O espelho traz só off-diagonal; as diagonais foram apagadas de propósito na exportação
 * (ver comentário lá). Na conta, mesmo tipo usa a célula se existir; senão Ghost/Dragon
 * são ×2 entre si e a maioria dos tipos se resiste (×0,5). Normal, Ground e Flying ficam ×1.
 */

export function multAtaqueContraDefesa(atq, def, linha) {
  const a = String(atq).toUpperCase();
  const d = String(def).toUpperCase();
  if (d === a) {
    if (linha[d] != null) return linha[d];
    if (a === 'GHOST' || a === 'DRAGON') return 2;
    if (a === 'NORMAL' || a === 'GROUND' || a === 'FLYING') return 1;
    return 0.5;
  }
  return linha[d] ?? 1;
}

/** Multiplicador do golpe `atq` contra defensor `def1`/`def2` (tipos elementais). */
export function efetividade(atq, def1, def2, tabela) {
  const linha = tabela[String(atq).toUpperCase()] ?? {};
  let v = multAtaqueContraDefesa(atq, def1, linha);
  if (def2 && def2 !== def1) v *= multAtaqueContraDefesa(atq, def2, linha);
  return v;
}
