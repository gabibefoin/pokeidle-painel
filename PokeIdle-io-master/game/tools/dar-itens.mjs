#!/usr/bin/env node
// Credita itens na bolsa de um jogador — uso dev/admin. Qualquer item, qualquer quantidade.
//   node tools/dar-itens.mjs fasi 70011=200 70013=200     # fragmentos de casa e de bike
//   node tools/dar-itens.mjs fasi 70080=1 70084=1         # bicicletas
//   node tools/dar-itens.mjs fasi 70000=20                # Bronze Boss Token
//
// ### Por que banco E memória, e nunca "derruba e grava no banco"
//
// É o mesmo caminho do "Resolver" do painel admin (`admin.mjs`): grava no Postgres e manda
// `admin.items` para o sim. As duas metades cobrem os dois casos:
//
//   · jogador carregado no sim → a memória recebe o crédito, e o próximo flush grava a bolsa
//     inteira por cima do banco, já com o item (o crédito no banco é sobrescrito, não somado);
//   · jogador fora do sim → o `admin.items` não acha ninguém e não faz nada; vale o banco.
//
// A versão anterior (a do `dar-casa.mjs`) derrubava o socket, esperava 3,5 s e gravava só no
// banco. Não funciona: o sim segura o jogador na memória por `GRACA_DESCONEXAO_MS` (90 s)
// depois de o socket cair, e quem reconecta dentro dessa janela volta para a memória SEM o
// item — que o flush seguinte grava por cima do banco, apagando o crédito. Foi assim que as
// bicicletas do fasi sumiram no servidor local.
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { conectarBus, enviarParaSim } from '../src/server/bus.mjs';
import { itens } from '../src/server/content.mjs';

const USO = 'uso: node tools/dar-itens.mjs <nick> <itemId>=<qtd> [<itemId>=<qtd> ...]';
const [nick, ...pares] = process.argv.slice(2);

const pedido = {};
for (const par of pares) {
  const m = /^(\d+)=(-?\d+)$/.exec(par);
  if (!m) {
    console.error(`argumento inválido: "${par}"\n${USO}`);
    process.exit(1);
  }
  const itemId = Number(m[1]);
  if (!itens.has(itemId)) {
    console.error(`item ${itemId} não existe no catálogo`);
    process.exit(1);
  }
  pedido[itemId] = (pedido[itemId] ?? 0) + Number(m[2]);
}
if (!nick || !Object.keys(pedido).length) {
  console.error(USO);
  process.exit(1);
}

const { rows } = await pool.query('SELECT id, nick FROM players WHERE lower(nick) = lower($1)', [nick]);
if (!rows[0]) {
  console.error(`jogador "${nick}" não encontrado`);
  process.exit(1);
}
const playerId = Number(rows[0].id);
const canon = rows[0].nick;
const chave = canon.toLowerCase();

// 1) banco — numa transação só: ou entram todos, ou nenhum.
const cli = await pool.connect();
try {
  await cli.query('BEGIN');
  for (const [itemId, qtd] of Object.entries(pedido)) {
    const { rows: upd } = await cli.query(
      `UPDATE players
          SET items = jsonb_set(
                COALESCE(items, '{}'::jsonb),
                ARRAY[$2::text],
                to_jsonb(GREATEST(0, COALESCE((items->>$2)::int, 0) + $3::int))
              )
        WHERE id = $1
      RETURNING items->>$2 AS qtd`,
      [playerId, String(itemId), qtd],
    );
    console.log(`✓ ${canon}: ${qtd > 0 ? '+' : ''}${qtd} ${itens.get(Number(itemId)).name} (item ${itemId}) — banco: ${upd[0].qtd}`);
  }
  await cli.query('COMMIT');
} catch (err) {
  await cli.query('ROLLBACK');
  throw err;
} finally {
  cli.release();
}

// 2) memória do sim — se ele estiver carregado lá (online OU na carência de 90 s), é aqui que vale.
await conectarBus();
enviarParaSim(chave, { t: 'admin.items', playerId: chave, items: pedido });
await new Promise((r) => setTimeout(r, 800));
console.log('  memória do sim avisada (admin.items) — aparece na bolsa sem F5 se ele estiver no jogo.');

await pool.end();
process.exit(0);
