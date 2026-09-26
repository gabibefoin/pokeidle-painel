// Simula um jogador depositando na devnet.
//
//   node tools/devnet-depositar.mjs <endereço-de-depósito> [quantia]
//
// O endereço é o que a tela de depósito mostra para o jogador — aquele derivado, só dele.
// Manda o token de teste criado por `devnet-preparar.mjs`, da carteira de mentira do
// jogador para lá.
//
// É este comando que fecha o teste ponta a ponta e prova as duas coisas que só a rede
// prova: se o watcher enxerga o depósito NAQUELE endereço, e se ele credita ao jogador
// certo sem memo nenhum.
//
// Este import é por EFEITO COLATERAL: `config.mjs` é quem lê o .env e joga os valores em
// `process.env`. Sem ele, a ferramenta enxerga só o ambiente do shell e nada do arquivo —
// foi exatamente assim que um CHAIN_USDT_CONTRATO corretamente preenchido apareceu como
// "não configurado".
import '../src/server/config.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lerChaveSolana } from '../src/server/chain.mjs';

const [destino, quantiaArg] = process.argv.slice(2);
if (!destino) {
  console.error('\n  uso: node tools/devnet-depositar.mjs <endereço-de-depósito> [quantia]\n');
  process.exit(1);
}
const quantia = Number(quantiaArg ?? 25);

const RPC = process.env.CHAIN_RPC_URL ?? 'https://api.devnet.solana.com';
const MINT = process.env.CHAIN_USDT_CONTRATO;
if (!MINT) {
  console.error('\n  ✗ CHAIN_USDT_CONTRATO não configurado — rode devnet-preparar.mjs antes.\n');
  process.exit(1);
}

// O erro mais fácil de cometer aqui: mandar para a CARTEIRA DO PROJETO em vez do endereço
// derivado do jogador. Os dois são endereços Solana válidos, a transação passa, o dinheiro
// chega — e some, porque o watcher está olhando para os endereços dos jogadores, não para
// este. Recusar antes é melhor do que deixar procurar o defeito no watcher depois.
if (destino === process.env.CARTEIRA_PROJETO && process.env.ORB_SEED_DEPOSITOS) {
  console.error(`
  ✗ Esse é o endereço da CARTEIRA DO PROJETO, não o do jogador.

    Com ORB_SEED_DEPOSITOS configurada, cada jogador tem um endereço próprio, e é para ELE
    que o depósito vai. Mandar para a carteira do projeto funciona na blockchain, mas o
    watcher não olha para lá — o dinheiro chegaria sem ninguém a quem creditar.

    Descubra o endereço do jogador com:

      node tools/endereco-de.mjs <nick>
`);
  process.exit(1);
}

const web3 = await import('@solana/web3.js');
const spl = await import('@solana/spl-token');

const conexao = new web3.Connection(RPC, 'confirmed');
const jogador = web3.Keypair.fromSecretKey(lerChaveSolana(readFileSync(resolve('devnet-jogador.json'), 'utf8').trim()));
const mint = new web3.PublicKey(MINT);
const para = new web3.PublicKey(destino);

/**
 * O jogador de teste paga o próprio gás — é o que um jogador de verdade faz. Só que ele
 * nasce com 500 USDT e ZERO SOL, e sem SOL não se paga nem a criação da conta de token do
 * destino (que é o que estourava aqui com um `TokenAccountNotFoundError` bem pouco
 * explicativo: a conta não existia porque não deu para criar).
 *
 * Como isto é ferramenta de teste e a carteira do projeto tem SOL de sobra, o abastecimento
 * é automático. Um jogador real chega com SOL na carteira; o de mentira precisa de ajuda.
 */
const GAS_MINIMO = 0.02 * web3.LAMPORTS_PER_SOL;
const solDoJogador = await conexao.getBalance(jogador.publicKey);
if (solDoJogador < GAS_MINIMO) {
  const { readFileSync: ler } = await import('node:fs');
  const projeto = web3.Keypair.fromSecretKey(
    lerChaveSolana(ler(resolve(process.env.CARTEIRA_CHAVE_PRIVADA ?? './carteira-projeto.json'), 'utf8').trim()),
  );
  console.log(`  jogador de teste sem SOL (${solDoJogador / web3.LAMPORTS_PER_SOL}) — mandando 0,05 do projeto…`);
  const tx = new web3.Transaction().add(
    web3.SystemProgram.transfer({
      fromPubkey: projeto.publicKey,
      toPubkey: jogador.publicKey,
      lamports: 0.05 * web3.LAMPORTS_PER_SOL,
    }),
  );
  await web3.sendAndConfirmTransaction(conexao, tx, [projeto]);
  console.log(`  ok — ${(await conexao.getBalance(jogador.publicKey)) / web3.LAMPORTS_PER_SOL} SOL`);
}

const origem = await spl.getOrCreateAssociatedTokenAccount(conexao, jogador, mint, jogador.publicKey);
const alvo = await spl.getOrCreateAssociatedTokenAccount(conexao, jogador, mint, para);

// Saldo do TOKEN, e do mint que está no .env agora. Rodar `devnet-preparar` duas vezes
// cria mints diferentes; se o .env apontar para um e o jogador tiver saldo no outro, a
// transferência falha com um erro de matemática de saldo que não diz nada sobre isso.
const temToken = Number(origem.amount) / 1e6;
if (temToken < quantia) {
  console.error(`
  ✗ O jogador de teste tem ${temToken} USDT deste mint, e você pediu ${quantia}.

    mint em uso: ${MINT}

    Se você rodou o devnet-preparar mais de uma vez, pode ter criado um mint novo e o saldo
    ter ficado no antigo. Rode de novo para cunhar mais neste:

      npm run devnet:preparar
`);
  process.exit(1);
}

console.log(`\n  ${jogador.publicKey.toBase58()}\n    → ${destino}\n    ${quantia} USDT (de mentira)\n`);

const sig = await spl.transferChecked(
  conexao, jogador, origem.address, mint, alvo.address, jogador, Math.round(quantia * 1e6), 6,
);
console.log(`  enviado: ${sig}`);
console.log(`  https://solscan.io/tx/${sig}?cluster=devnet\n`);
console.log('  Agora abra a tela de Depósito no jogo. O watcher roda a cada 30 s.\n');
