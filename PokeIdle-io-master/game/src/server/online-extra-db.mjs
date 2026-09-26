// Acréscimos manuais na contagem de jogadores online — só visíveis no `/saude` e no painel admin.
//
// Cada linha é um incremento independente (ex.: +50, depois +30). O admin remove um de cada vez;
// a soma de todos alimenta o número que os jogadores veem no canto da tela.
import { pool } from './db.mjs';

export async function migrar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_online_extra (
      id         BIGSERIAL PRIMARY KEY,
      qtd        INT NOT NULL CHECK (qtd > 0),
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
      criado_por TEXT
    )`);
}

const linha = (r) =>
  r && {
    id: Number(r.id),
    qtd: Number(r.qtd),
    criadoEm: r.criado_em?.getTime?.() ?? null,
    criadoPor: r.criado_por ?? null,
  };

/** Todos os acréscimos ativos, do mais antigo para o mais novo. */
export async function listar() {
  const { rows } = await pool.query(`SELECT * FROM admin_online_extra ORDER BY id ASC`);
  return rows.map(linha);
}

/** Registra mais um incremento. */
export async function adicionar({ qtd, criadoPor }) {
  const n = Math.round(Number(qtd) || 0);
  if (!(n > 0)) throw new Error('informe um valor maior que zero');
  const { rows } = await pool.query(
    `INSERT INTO admin_online_extra (qtd, criado_por) VALUES ($1, $2) RETURNING *`,
    [n, criadoPor ?? null],
  );
  return linha(rows[0]);
}

/** Remove um incremento pelo id. Devolve o que foi apagado, ou `null`. */
export async function remover(id) {
  const { rows } = await pool.query(
    `DELETE FROM admin_online_extra WHERE id = $1 RETURNING *`,
    [Number(id) || 0],
  );
  return linha(rows[0]) ?? null;
}

/** Remove todos os acréscimos ativos. Devolve a lista apagada. */
export async function removerTodos() {
  const { rows } = await pool.query(`DELETE FROM admin_online_extra RETURNING *`);
  return rows.map(linha);
}
