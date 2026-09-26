#!/usr/bin/env node
/** Dev local — zera cooldown de troca de e-mail / senha de uma conta. */
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';

const alvo = process.argv[2];
if (!alvo) {
  console.error('Uso: node tools/limpar-cooldown-conta.mjs <nick ou e-mail>');
  process.exit(1);
}

const { rows } = await pool.query(
  `SELECT id, nick, email FROM accounts
    WHERE lower(nick) = lower($1) OR lower(email) = lower($1)
    LIMIT 1`,
  [alvo.trim()],
);
const conta = rows[0];
if (!conta) {
  console.error('Conta não encontrada.');
  process.exit(1);
}

const { rows: tokens } = await pool.query(
  `UPDATE account_tokens SET usado_em = now()
    WHERE account_id = $1
      AND tipo IN ('email_troca_pedido', 'email_troca', 'senha')
      AND usado_em IS NULL
    RETURNING tipo`,
  [conta.id],
);
await pool.query(
  `UPDATE accounts SET email_novo_pendente = NULL, senha_nova_pendente = NULL WHERE id = $1`,
  [conta.id],
);

console.log(`Conta: ${conta.nick} (${conta.email ?? 'sem e-mail'})`);
console.log(
  tokens.length
    ? `Tokens liberados: ${tokens.map((t) => t.tipo).join(', ')}`
    : 'Nenhum token pendente — cooldown já estava zerado.',
);
console.log('Pendência de troca de e-mail limpa. Recarregue a ficha do perfil.');
await pool.end();
