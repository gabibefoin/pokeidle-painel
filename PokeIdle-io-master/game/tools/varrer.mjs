// Roda UMA varredura à mão: junta na tesouraria o USDT parado nos endereços dos jogadores.
//
//   node tools/varrer.mjs --dry     # só mostra o que faria, não assina nada
//   node tools/varrer.mjs           # recolhe quem tem depósito no ledger
//   node tools/varrer.mjs --hoje    # só depósitos de hoje (UTC)
//
// Em produção, agende uma vez por dia (4h UTC = 1h BRT):
//   0 4 * * * cd /opt/pokeidle/game && /usr/bin/node tools/varrer.mjs >> /opt/pokeidle/orbs-varredura.log 2>&1
//
// Existe separado do laço automático porque a primeira vez que isto roda contra uma rede
// de verdade é o momento em que duas coisas se provam: se as duas assinaturas (endereço
// derivado + tesouraria pagando o gás) são aceitas, e se o endereço derivado é mesmo o que
// recebeu o dinheiro. Rode com `--dry` na devnet antes de deixar o laço ligado.
//
// Este import é por EFEITO COLATERAL: `config.mjs` é quem lê o .env e joga os valores em
// `process.env`. Sem ele, a ferramenta enxerga só o ambiente do shell e nada do arquivo —
// foi exatamente assim que um CHAIN_USDT_CONTRATO corretamente preenchido apareceu como
// "não configurado".
import '../src/server/config.mjs';
import { criarChain } from '../src/server/chain.mjs';
import { passagem, inicioDoDiaUtc } from '../src/server/orbs-varredura.mjs';
import { temSeed } from '../src/server/orbs-enderecos.mjs';
import { pool } from '../src/server/db.mjs';

const dry = process.argv.includes('--dry');
const hoje = process.argv.includes('--hoje');
const chain = criarChain();

if (chain.simulada) {
  console.error('\n  ✗ CHAIN_REDE está vazia — a rede simulada não tem o que varrer.\n');
  process.exit(1);
}
if (!temSeed()) {
  console.error('\n  ✗ ORB_SEED_DEPOSITOS não configurada — sem ela não há endereços derivados.\n');
  process.exit(1);
}

const escopo = hoje ? 'depósitos de hoje (UTC)' : 'ledger (usdt > 0)';
console.log(`\nVarredura ${dry ? '(DRY — não assina nada)' : 'DE VERDADE'} na rede ${chain.id} (${escopo})…\n`);
const r = await passagem(chain, { dry, desde: hoje ? inicioDoDiaUtc() : null });

console.log(`
  candidatos        : ${r.candidatos}
  endereços olhados : ${r.olhados}
  abaixo do piso    : ${r.pulados}
  recolhidos        : ${r.recolhidos}
  total             : ${r.usdt} USDT
  falhas            : ${r.falhas}
`);

await pool.end();
process.exit(r.falhas ? 1 : 0);
