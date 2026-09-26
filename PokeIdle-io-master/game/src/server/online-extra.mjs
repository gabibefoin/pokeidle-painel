// Cache em memória dos acréscimos na contagem online — lido no boot do gateway e atualizado
// pelo canal Redis quando o admin adiciona ou remove um incremento.
import * as odb from './online-extra-db.mjs';

let extras = [];

export function totalExtra() {
  return extras.reduce((s, e) => s + e.qtd, 0);
}

/** O número que vai no `/saude` — real + soma dos acréscimos. */
export function onlineExibido(real) {
  const r = Number(real);
  if (!(r >= 0)) return r;
  return r + totalExtra();
}

export function definirExtras(lista) {
  extras = Array.isArray(lista) ? lista : [];
}

export async function carregar() {
  extras = await odb.listar();
}
