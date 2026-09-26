/**
 * Uso local: node tools/dar-caixa-local.mjs <nick> [fundador|cofundador|ambos]
 *
 * Entrega caixas FECHADAS na bolsa — para testar Mercado, abertura, etc. Não debita diamante.
 * Consome um número da série global, como uma compra real na Loja.
 *
 * Se o jogador estiver online, desconecta antes — senão o flush do sim sobrescreve.
 */
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { migrar, comprarCaixa } from '../src/server/caixas-db.mjs';
import { conectarBus, desconectarJogador, gatewayDoJogador } from '../src/server/bus.mjs';
import { TIPOS_CAIXA, caixaPorTipo } from '../src/shared/caixas-beta.mjs';

const nick = process.argv[2];
const alvo = (process.argv[3] ?? 'ambos').toLowerCase();

const tipos = alvo === 'ambos'
  ? TIPOS_CAIXA
  : alvo === 'fundador' || alvo === 'cofundador'
    ? [alvo]
    : null;

if (!nick || !tipos) {
  console.error('Uso: node tools/dar-caixa-local.mjs <nick> [fundador|cofundador|ambos]');
  process.exit(1);
}

await migrar();

const { rows } = await pool.query(
  'SELECT id, nick FROM players WHERE lower(nick) = lower($1)',
  [nick],
);
if (!rows.length) {
  console.error(`Jogador "${nick}" não encontrado.`);
  process.exit(1);
}

const playerId = Number(rows[0].id);
const canon = rows[0].nick;
const chave = canon.toLowerCase();

await conectarBus();
const online = await gatewayDoJogador(chave);
if (online) {
  console.log(`${canon} está online — desconectando para gravar sem o flush sobrescrever…`);
  await desconectarJogador(chave, { k: 'aviso', msg: 'Reconecte — você recebeu caixas.' });
  await new Promise((r) => setTimeout(r, 3500));
}

const entregues = [];
for (const tipo of tipos) {
  const def = caixaPorTipo(tipo);
  try {
    const r = await comprarCaixa({ playerId, nick: canon, tipo });
    entregues.push(r.nome);
    console.log(`  ✓ ${r.nome} (id ${r.id}, restam ${r.restam} no servidor)`);
  } catch (err) {
    console.error(`  ✗ ${def?.nome ?? tipo}: ${err.message}`);
  }
}

if (!entregues.length) {
  await pool.end();
  process.exit(1);
}

console.log(`\n✓ ${canon} (id ${playerId}) — ${entregues.length} caixa(s) fechada(s) na bolsa.`);
if (online) console.log('  Reconecte no jogo (F5).');
else console.log('  Recarregue a página (F5) se estiver online.');
await pool.end();
