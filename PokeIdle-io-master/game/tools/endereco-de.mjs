// Mostra o endereço de depósito de um jogador, sem precisar abrir o jogo.
//
//   node tools/endereco-de.mjs <nick>
//
// Serve para testar: o `devnet-depositar.mjs` precisa do endereço DERIVADO do jogador, e
// pegá-lo pela interface dá um vaivém a cada tentativa. Também é o comando de suporte para
// "mandei e não caiu" — com ele dá para conferir, em dois segundos, se o endereço que a
// pessoa usou é mesmo o dela.
//
// ARMA o endereço, igual à tela de depósito faz. Sem isso, o watcher não estaria olhando
// para ele e o depósito de teste ficaria parado sem explicação.
//
// Este import é por EFEITO COLATERAL: `config.mjs` é quem lê o .env e joga os valores em
// `process.env`. Sem ele, a ferramenta enxerga só o ambiente do shell e nada do arquivo —
// foi exatamente assim que um CHAIN_USDT_CONTRATO corretamente preenchido apareceu como
// "não configurado".
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import * as enderecos from '../src/server/orbs-enderecos.mjs';

const nick = process.argv[2];
if (!nick) {
  console.error('\n  uso: node tools/endereco-de.mjs <nick>\n');
  process.exit(1);
}

if (!enderecos.temSeed()) {
  console.error(`
  ✗ ORB_SEED_DEPOSITOS está vazia no .env.

    Sem ela não existem endereços por jogador — o jogo fica no modo antigo, com uma
    carteira só e o jogador tendo que colar um código no memo.

    Gere e cole no .env:   npm run orbs:seed
`);
  process.exit(1);
}

await enderecos.migrar();
const { rows } = await pool.query(`SELECT id, nick FROM players WHERE lower(nick) = lower($1)`, [nick]);
if (!rows.length) {
  console.error(`\n  ✗ nenhum jogador com o nick "${nick}". Entre no jogo com ele uma vez primeiro.\n`);
  await pool.end();
  process.exit(1);
}

const endereco = await enderecos.enderecoDe(Number(rows[0].id), { armar: true });
console.log(`
  jogador : ${rows[0].nick}  (id ${rows[0].id})
  endereço: ${endereco}

  Armado — o watcher vai olhar para ele nas próximas 6 horas.

  Para simular um depósito na devnet:

    node tools/devnet-depositar.mjs ${endereco} 25
`);

await pool.end();
process.exit(0);
