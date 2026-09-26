// Teste do adaptador Solana e do watcher de depósitos.
//
// Duas metades, com riscos diferentes:
//
//   · o ADAPTADOR é testado contra um `fetch` de mentira, com respostas de RPC no formato
//     real. O que se prova aqui é o PARSING — achar quanto entrou na nossa conta olhando a
//     diferença de saldo, extrair o memo, identificar quem mandou. É onde um erro silencioso
//     creditaria o valor errado, e é justamente o que não dá para exercitar sem rede.
//
//   · o WATCHER é testado contra a rede simulada e o Postgres de verdade. O que se prova é
//     a IDEMPOTÊNCIA: o mesmo depósito visto duas vezes não pode virar ORB duas vezes.
//     Depósito é a única emissão do sistema, então creditar em dobro fura o lastro.
//
//   node tools/teste-orbs-watcher.mjs
import { pool } from '../src/server/db.mjs';
import * as db from '../src/server/db.mjs';
import * as odb from '../src/server/orbs-db.mjs';
import { redeSimulada, redeSolana, base58Encode, lerChaveSolana } from '../src/server/chain.mjs';
import { passagem, migrar, CONFIRMACOES_MINIMAS } from '../src/server/orbs-watcher.mjs';
import { novaReferencia, usdtParaOrbs, PRECO_COMPRA, MOTIVO } from '../src/server/game/orbs.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

// ============================================================== base58
secao('Base58 (o formato de tudo na Solana)');

// Vetor conhecido: 32 bytes zerados são 32 caracteres '1'.
ok(base58Encode(new Uint8Array(32)) === '1'.repeat(32), '32 bytes zero viram 32 uns');
ok(base58Encode(Uint8Array.from([0, 0, 1])) === '112', 'zeros à esquerda viram uns');
ok(base58Encode(Uint8Array.from([255])) === '5Q', 'byte 255 = "5Q"');

// Ida e volta pela chave: o decodificador é o que lê o .env, e um erro nele é chave errada.
const chaveBytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 3) % 256);
const chaveB58 = base58Encode(chaveBytes);
ok(
  Buffer.compare(Buffer.from(lerChaveSolana(chaveB58)), Buffer.from(chaveBytes)) === 0,
  'base58 → bytes → base58 fecha o círculo',
);
ok(
  Buffer.compare(Buffer.from(lerChaveSolana(JSON.stringify([...chaveBytes]))), Buffer.from(chaveBytes)) === 0,
  'aceita também o array JSON do solana-keygen',
);
let erroChave = null;
try { lerChaveSolana('[1,2,3]'); } catch (e) { erroChave = e.message; }
ok(!!erroChave, 'recusa chave com tamanho errado', erroChave ?? 'passou!');

// ====================================================== adaptador Solana
secao('Adaptador Solana — parsing do RPC');

const PROJETO = 'ProJEToWa11etAddreSS1111111111111111111111';
const MINT = 'UsdTMint1111111111111111111111111111111111';
const fetchOriginal = globalThis.fetch;

/** A conta de token do projeto. O adaptador pergunta as assinaturas DELA, não do dono. */
const ATA_PROJETO = 'AtaDoProjeto11111111111111111111111111111';

/**
 * Um `fetch` que responde JSON-RPC conforme um roteiro.
 *
 * `getTokenAccountsByOwner` vem embutido porque TODA leitura passa por ele: o adaptador
 * precisa saber quais contas de token o dono tem antes de pedir assinaturas. Esse passo
 * não existia na primeira versão — ela perguntava as assinaturas do endereço do DONO, e na
 * devnet isso devolvia só a criação da conta, perdendo a transferência inteira. O teste
 * passava porque o `fetch` de mentira respondia o que o código pedia, não o que a Solana
 * responderia.
 */
function fetchDeMentira(respostas) {
  const padrao = {
    getTokenAccountsByOwner: { value: [{ pubkey: ATA_PROJETO }] },
  };
  return async (_url, opcoes) => {
    const { method, params } = JSON.parse(opcoes.body);
    const r = respostas[method] ?? padrao[method];
    const result = typeof r === 'function' ? r(params) : r;
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  };
}

/** Uma transação como o RPC devolve, com saldos antes/depois em unidades mínimas. */
const txDeposito = ({ antes, depois, deAntes, deDepois, memo, dono = 'Jogador111111111111111111111111111111111' }) => ({
  meta: {
    err: null,
    preTokenBalances: [
      { accountIndex: 1, owner: PROJETO, mint: MINT, uiTokenAmount: { amount: String(antes) } },
      { accountIndex: 2, owner: dono, mint: MINT, uiTokenAmount: { amount: String(deAntes) } },
    ],
    postTokenBalances: [
      { accountIndex: 1, owner: PROJETO, mint: MINT, uiTokenAmount: { amount: String(depois) } },
      { accountIndex: 2, owner: dono, mint: MINT, uiTokenAmount: { amount: String(deDepois) } },
    ],
    innerInstructions: [],
  },
  transaction: {
    message: { instructions: memo ? [{ program: 'spl-memo', parsed: memo }] : [] },
  },
});

const solana = redeSolana({ rpcUrl: 'http://mentira', contratoUsdt: MINT, carteiraProjeto: PROJETO });

globalThis.fetch = fetchDeMentira({
  getAccountInfo: { value: { data: { parsed: { info: { decimals: 6 } } } } },
  getSignaturesForAddress: [
    { signature: 'sigB', err: null, confirmationStatus: 'finalized', blockTime: 1700000200 },
    { signature: 'sigA', err: null, confirmationStatus: 'finalized', blockTime: 1700000100 },
  ],
  getTransaction: ([sig]) =>
    sig === 'sigA'
      ? txDeposito({ antes: 0, depois: 5_000_000, deAntes: 9_000_000, deDepois: 4_000_000, memo: 'ABC123' })
      : txDeposito({ antes: 5_000_000, depois: 5_500_000, deAntes: 4_000_000, deDepois: 3_500_000, memo: null }),
});

const recebidos = await solana.recebidos({});
ok(recebidos.length === 2, 'dois depósitos lidos', `veio ${recebidos.length}`);
ok(recebidos[0].txHash === 'sigA', 'da MAIS ANTIGA para a mais nova (o cursor depende disso)');
ok(recebidos[0].usdt === 5, 'valor sai da DIFERENÇA de saldo: 5.000.000 / 10^6 = 5 USDT', `veio ${recebidos[0].usdt}`);
ok(recebidos[0].memo === 'ABC123', 'memo extraído da instrução spl-memo');
ok(recebidos[0].de === 'Jogador111111111111111111111111111111111', 'remetente = quem perdeu saldo');
ok(recebidos[1].usdt === 0.5, 'segundo depósito: 0,5 USDT', `veio ${recebidos[1].usdt}`);
ok(recebidos[1].memo === null, 'sem memo vira null, não string vazia');

// REGRESSÃO: o adaptador tem de pedir as assinaturas da CONTA DE TOKEN, não do dono.
// Perguntar pelo dono foi o bug que só a devnet mostrou — a transferência SPL não menciona
// o dono da conta de destino, então o depósito passava despercebido.
{
  const pedidos = [];
  const antes = globalThis.fetch;
  globalThis.fetch = async (url, opcoes) => {
    const { method, params } = JSON.parse(opcoes.body);
    if (method === 'getSignaturesForAddress') pedidos.push(params[0]);
    return antes(url, opcoes);
  };
  await solana.recebidos({});
  globalThis.fetch = antes;
  ok(pedidos.length > 0 && pedidos.every((p) => p === ATA_PROJETO),
    'pede assinaturas da CONTA DE TOKEN, nunca do endereço do dono', JSON.stringify(pedidos));
}

// Sem conta de token, não há o que ler — e não pode estourar.
globalThis.fetch = fetchDeMentira({
  getAccountInfo: { value: { data: { parsed: { info: { decimals: 6 } } } } },
  getTokenAccountsByOwner: { value: [] },
});
ok((await solana.recebidos({})).length === 0, 'dono sem conta de token devolve lista vazia');

// Uma SAÍDA nossa (saldo caiu) não pode ser lida como depósito.
globalThis.fetch = fetchDeMentira({
  getAccountInfo: { value: { data: { parsed: { info: { decimals: 6 } } } } },
  getSignaturesForAddress: [{ signature: 'saida', err: null, confirmationStatus: 'finalized' }],
  getTransaction: () => txDeposito({ antes: 5_000_000, depois: 1_000_000, deAntes: 0, deDepois: 4_000_000 }),
});
ok((await solana.recebidos({})).length === 0, 'saída da carteira NÃO conta como depósito');

// Transação que falhou não moveu nada.
globalThis.fetch = fetchDeMentira({
  getAccountInfo: { value: { data: { parsed: { info: { decimals: 6 } } } } },
  getSignaturesForAddress: [{ signature: 'ruim', err: { InstructionError: [] }, confirmationStatus: 'finalized' }],
  getTransaction: () => txDeposito({ antes: 0, depois: 9_000_000, deAntes: 9_000_000, deDepois: 0, memo: 'X' }),
});
ok((await solana.recebidos({})).length === 0, 'transação com erro é ignorada');

// `estado`: só `finalized` fecha o saque.
const estados = {
  getSignatureStatuses: ([[sig]]) => ({
    value: [
      sig === 'fin' ? { err: null, confirmationStatus: 'finalized' }
      : sig === 'conf' ? { err: null, confirmationStatus: 'confirmed' }
      : sig === 'err' ? { err: { x: 1 }, confirmationStatus: 'finalized' }
      : null,
    ],
  }),
};
globalThis.fetch = fetchDeMentira(estados);
ok((await solana.estado('fin')) === 'confirmada', 'finalized → confirmada');
ok((await solana.estado('conf')) === 'pendente', 'confirmed ainda é PENDENTE (fork pode desfazer)');
ok((await solana.estado('err')) === 'falhou', 'com erro → falhou');
ok((await solana.estado('nada')) === 'inexistente', 'desconhecida → inexistente');

globalThis.fetch = fetchOriginal;

// ============================================================== watcher
secao('Watcher de depósitos');

await db.aguardarBanco();
await db.migrar();
await odb.migrar();
await migrar();

const marca = Date.now() % 1000000;
const { rows: pl } = await pool.query(`INSERT INTO players (nick) VALUES ($1) RETURNING id`, [`wat${marca}`]);
const playerId = Number(pl[0].id);
const ref = await odb.referenciaDe(playerId, novaReferencia);

const chain = redeSimulada('solana');
const saldo = async () => Number((await pool.query(`SELECT orbs FROM players WHERE id=$1`, [playerId])).rows[0].orbs);

// Um depósito de 10 USDT com o memo certo.
const dep = { txHash: `tx${marca}a`, de: 'Alguem', usdt: 10, memo: ref, confirmacoes: 1 };
chain.ctrl.recebidos.push({ ...dep });
const r1 = await passagem(chain);
ok(r1.creditados === 1, 'depósito com memo válido é creditado');
ok((await saldo()) === usdtParaOrbs(10), `10 USDT viram ${usdtParaOrbs(10)} ORBs`, `saldo ${await saldo()}`);

// O MESMO depósito de novo — o caso que fura o lastro se passar.
chain.ctrl.recebidos.push({ ...dep });
const r2 = await passagem(chain);
ok(r2.creditados === 0 && r2.repetidos === 1, 'o mesmo tx_hash NÃO credita de novo');
ok((await saldo()) === usdtParaOrbs(10), 'e o saldo não se mexeu');

// Sem memo: vira órfão, não sumiço.
chain.ctrl.recebidos.push({ txHash: `tx${marca}b`, de: 'X', usdt: 5, memo: null, confirmacoes: 1 });
const r3 = await passagem(chain);
ok(r3.orfaos === 1, 'depósito sem memo vira órfão');
const { rows: orf } = await pool.query(`SELECT motivo FROM orb_orfaos WHERE tx_hash=$1`, [`tx${marca}b`]);
ok(orf[0]?.motivo === 'sem_memo', 'com o motivo anotado');

// Memo que não bate com ninguém.
chain.ctrl.recebidos.push({ txHash: `tx${marca}c`, de: 'X', usdt: 5, memo: 'NAOEXISTE99', confirmacoes: 1 });
await passagem(chain);
const { rows: orf2 } = await pool.query(`SELECT motivo FROM orb_orfaos WHERE tx_hash=$1`, [`tx${marca}c`]);
ok(orf2[0]?.motivo === 'memo_desconhecido', 'memo desconhecido também vira órfão');

// Valor menor que uma ORB (PRECO_COMPRA = 0,01 USDT).
chain.ctrl.recebidos.push({ txHash: `tx${marca}d`, de: 'X', usdt: PRECO_COMPRA / 2, memo: ref, confirmacoes: 1 });
await passagem(chain);
const { rows: orf3 } = await pool.query(`SELECT motivo FROM orb_orfaos WHERE tx_hash=$1`, [`tx${marca}d`]);
ok(orf3[0]?.motivo === 'valor_menor_que_uma_orb', 'poeira vira órfão em vez de sumir');

// Não finalizado: não credita e não avança o cursor.
const antesImaturo = await saldo();
chain.ctrl.recebidos.push({ txHash: `tx${marca}e`, de: 'X', usdt: 50, memo: ref, confirmacoes: CONFIRMACOES_MINIMAS - 1 });
const r5 = await passagem(chain);
ok(r5.imaturos === 1 && r5.creditados === 0, 'depósito não finalizado NÃO é creditado');
ok((await saldo()) === antesImaturo, 'e o saldo continua igual');

// O invariante do caixa: tudo que emitiu ORB tem de ser depósito.
const { rows: emissao } = await pool.query(
  `SELECT motivo, SUM(delta)::bigint AS v FROM orb_ledger WHERE player_id=$1 GROUP BY motivo`, [playerId]);
ok(emissao.length === 1 && emissao[0].motivo === MOTIVO.COMPRA,
  'todo ORB deste jogador nasceu de COMPRA (depósito), de nada mais');

// =============================================== endereço por jogador
secao('Watcher com ENDEREÇO POR JOGADOR (sem memo)');

process.env.ORB_SEED_DEPOSITOS = 'd'.repeat(64);
const enderecos = await import('../src/server/orbs-enderecos.mjs');
const { passagemDerivada } = await import('../src/server/orbs-watcher.mjs');
await enderecos.migrar();

const { rows: pl2 } = await pool.query(`INSERT INTO players (nick) VALUES ($1) RETURNING id`, [`der${marca}`]);
const jogador2 = Number(pl2[0].id);

// Sem armar, o watcher não olha — é o que segura o custo de RPC com muita gente.
const semArmar = await enderecos.enderecoDe(jogador2);
ok(!!semArmar, 'o endereço é derivado na primeira consulta', semArmar);
ok((await enderecos.armados()).every((a) => a.playerId !== jogador2), 'consultar sem armar NÃO entra na fila');

// Abrir a tela de depósito arma.
const meuEndereco = await enderecos.enderecoDe(jogador2, { armar: true });
ok(meuEndereco === semArmar, 'e o endereço é sempre o mesmo (derivado, não sorteado)');
ok((await enderecos.armados()).some((a) => a.endereco === meuEndereco), 'armar coloca na fila do watcher');

// O dinheiro chega NO endereço dele. Nenhum memo em lugar nenhum.
chain.ctrl.recebidos.push({
  txHash: `der${marca}1`, de: 'QualquerUm', usdt: 25, memo: null,
  confirmacoes: 1, paraEndereco: meuEndereco,
});
const d1 = await passagemDerivada(chain);
ok(d1.creditados === 1, 'depósito SEM memo é creditado ao dono do endereço');
const saldo2 = async () => Number((await pool.query(`SELECT orbs FROM players WHERE id=$1`, [jogador2])).rows[0].orbs);
ok((await saldo2()) === usdtParaOrbs(25), `25 USDT viram ${usdtParaOrbs(25)} ORBs`, `saldo ${await saldo2()}`);

// Idempotência continua valendo neste modo.
chain.ctrl.recebidos.push({
  txHash: `der${marca}1`, de: 'QualquerUm', usdt: 25, memo: null,
  confirmacoes: 1, paraEndereco: meuEndereco,
});
const d2 = await passagemDerivada(chain);
ok(d2.creditados === 0 && d2.repetidos === 1, 'o mesmo tx_hash não credita duas vezes');
ok((await saldo2()) === usdtParaOrbs(25), 'e o saldo não se mexeu');

// Dinheiro no endereço de OUTRO jogador não pode cair na conta errada.
const { rows: pl3 } = await pool.query(`INSERT INTO players (nick) VALUES ($1) RETURNING id`, [`der${marca}b`]);
const jogador3 = Number(pl3[0].id);
const outroEndereco = await enderecos.enderecoDe(jogador3, { armar: true });
ok(outroEndereco !== meuEndereco, 'dois jogadores, dois endereços');
chain.ctrl.recebidos.push({
  txHash: `der${marca}2`, de: 'X', usdt: 10, memo: null, confirmacoes: 1, paraEndereco: outroEndereco,
});
await passagemDerivada(chain);
ok((await saldo2()) === usdtParaOrbs(25), 'o depósito do outro NÃO caiu na minha conta');
const s3 = Number((await pool.query(`SELECT orbs FROM players WHERE id=$1`, [jogador3])).rows[0].orbs);
ok(s3 === usdtParaOrbs(10), 'caiu na conta certa', `saldo ${s3}`);

await pool.query(`DELETE FROM orb_orfaos WHERE tx_hash LIKE $1`, [`tx${marca}%`]);
await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [[playerId, jogador2, jogador3]]);

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
await pool.end();
process.exit(falhas ? 1 : 0);
