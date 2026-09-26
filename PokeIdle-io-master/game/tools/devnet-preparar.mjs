// Prepara a DEVNET para o teste ponta a ponta, sem precisar do CLI da Solana instalado.
//
//   node tools/devnet-preparar.mjs
//
// Faz três coisas, nesta ordem:
//
//   1. pede SOL de graça para a carteira do projeto (é ela que paga o gás de tudo);
//   2. cria um token SPL de 6 casas para fazer o papel do USDT — a devnet não tem USDT
//      oficial, e usar um mint inventado da internet é como testar com dinheiro de outro;
//   3. cunha um tanto desse token numa carteira de MENTIRA, que faz o papel do jogador.
//
// No fim imprime o mint (para `CHAIN_USDT_CONTRATO`) e deixa a carteira do jogador de teste
// num arquivo, para `devnet-depositar.mjs` usar.
//
// Nada disto toca a mainnet: o RPC é fixo na devnet, e o token criado aqui não vale nada em
// lugar nenhum — é justamente o ponto.
//
// Este import é por EFEITO COLATERAL: `config.mjs` é quem lê o .env e joga os valores em
// `process.env`. Sem ele, a ferramenta enxerga só o ambiente do shell e nada do arquivo —
// foi exatamente assim que um CHAIN_USDT_CONTRATO corretamente preenchido apareceu como
// "não configurado".
import '../src/server/config.mjs';
import { writeFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { lerChaveSolana } from '../src/server/chain.mjs';

// Dá para apontar para um RPC com chave (Helius, QuickNode, Alchemy). O faucet público
// tem limite DIÁRIO por endereço e por IP, e quando ele seca não há o que fazer no
// terminal — um endpoint próprio costuma ter faucet mais generoso.
const RPC = process.env.CHAIN_RPC_URL || 'https://api.devnet.solana.com';
const ARQ_PROJETO = process.argv[2] ?? 'carteira-projeto.json';
const ARQ_JOGADOR = 'devnet-jogador.json';

/**
 * Piso de SOL para o script conseguir trabalhar.
 *
 * Criar um mint paga aluguel (~0,0015 SOL), cada conta de token paga o seu (~0,002), e
 * ainda há a taxa de cada transação. Com menos que isto o `createMint` falha com
 * "Attempt to debit an account but found no record of a prior credit" — uma mensagem que
 * não diz "você está sem saldo", que é exatamente o que ela quer dizer.
 */
const SOL_MINIMO = 0.05;

const web3 = await import('@solana/web3.js');
const spl = await import('@solana/spl-token');

const conexao = new web3.Connection(RPC, 'confirmed');
const projeto = web3.Keypair.fromSecretKey(lerChaveSolana(readFileSync(resolve(ARQ_PROJETO), 'utf8').trim()));

console.log(`\n  Carteira do projeto: ${projeto.publicKey.toBase58()}\n`);

// ------------------------------------------------------------------ 1. SOL
const saldoAntes = await conexao.getBalance(projeto.publicKey);
console.log(`  SOL agora: ${saldoAntes / web3.LAMPORTS_PER_SOL}`);
if (saldoAntes < 0.5 * web3.LAMPORTS_PER_SOL) {
  console.log('  pedindo airdrop de 2 SOL…');
  try {
    const sig = await conexao.requestAirdrop(projeto.publicKey, 2 * web3.LAMPORTS_PER_SOL);
    await conexao.confirmTransaction(sig, 'confirmed');
    console.log(`  ok — saldo: ${(await conexao.getBalance(projeto.publicKey)) / web3.LAMPORTS_PER_SOL} SOL`);
  } catch (err) {
    // O faucet público tem limite diário. Não é erro do script.
    console.log(`  airdrop recusado: ${String(err.message).split('\n')[0]}`);
  }
}

// PARA AQUI se não houver saldo. Seguir adiante só troca uma mensagem clara por um
// `SendTransactionError` de simulação, que não diz a ninguém que o problema é falta de SOL.
const saldo = await conexao.getBalance(projeto.publicKey);
if (saldo < SOL_MINIMO * web3.LAMPORTS_PER_SOL) {
  console.error(`
  ✗ SOL insuficiente: ${saldo / web3.LAMPORTS_PER_SOL} (preciso de ao menos ${SOL_MINIMO}).

    O faucet público tem limite por dia e por endereço, e o seu bateu no teto. Três saídas:

    1. faucet web — cole o endereço abaixo em https://faucet.solana.com
       (pede login do GitHub, e costuma liberar mesmo quando o do terminal não libera)

         ${projeto.publicKey.toBase58()}

    2. RPC com chave — crie uma conta grátis no Helius ou QuickNode, pegue a URL de devnet
       e rode de novo com ela:

         CHAIN_RPC_URL="https://devnet.helius-rpc.com/?api-key=SUA_CHAVE" npm run devnet:preparar

    3. espere o limite virar (24h) e rode de novo.

    Nada foi criado ainda — pode repetir este comando à vontade quando tiver saldo.
`);
  process.exit(1);
}

// -------------------------------------------------------- 2. o "USDT" de teste
//
// Reaproveita o mint que já estiver no .env. Sem isso, rodar o script duas vezes cria um
// token novo, o .env fica apontando para o antigo, e o depósito de teste vai para um token
// que o watcher não reconhece — meia hora de confusão por um comando repetido.
let mint;
if (process.env.CHAIN_USDT_CONTRATO) {
  mint = new web3.PublicKey(process.env.CHAIN_USDT_CONTRATO);
  console.log(`\n  token de teste já existe: ${mint.toBase58()}`);
} else {
  console.log('\n  criando o token de teste (6 casas, como o USDT)…');
  mint = await spl.createMint(conexao, projeto, projeto.publicKey, null, 6);
  console.log(`  mint: ${mint.toBase58()}`);
}

// ------------------------------------------------------- 3. o jogador de teste
//
// Reaproveita o mesmo jogador entre execuções, pelo mesmo motivo do mint: um jogador novo
// a cada corrida deixaria o saldo de teste espalhado por carteiras que ninguém usa mais.
let jogador;
if (existsSync(resolve(ARQ_JOGADOR))) {
  jogador = web3.Keypair.fromSecretKey(lerChaveSolana(readFileSync(resolve(ARQ_JOGADOR), 'utf8').trim()));
  console.log(`\n  jogador de teste já existe: ${jogador.publicKey.toBase58()}`);
} else {
  jogador = web3.Keypair.generate();
  await writeFile(resolve(ARQ_JOGADOR), JSON.stringify([...jogador.secretKey]), 'utf8');
}

// SOL para o jogador de teste. Ele paga o próprio gás no `devnet-depositar` — como um
// jogador de verdade —, e sem isto a primeira transferência dele morre num
// `TokenAccountNotFoundError` que não diz "faltou SOL", que é o que aconteceu.
if ((await conexao.getBalance(jogador.publicKey)) < 0.02 * web3.LAMPORTS_PER_SOL) {
  const tx = new web3.Transaction().add(
    web3.SystemProgram.transfer({
      fromPubkey: projeto.publicKey,
      toPubkey: jogador.publicKey,
      lamports: 0.05 * web3.LAMPORTS_PER_SOL,
    }),
  );
  await web3.sendAndConfirmTransaction(conexao, tx, [projeto]);
  console.log('  jogador de teste abastecido com 0,05 SOL para o gás dele');
}

const contaJogador = await spl.getOrCreateAssociatedTokenAccount(conexao, projeto, mint, jogador.publicKey);
await spl.mintTo(conexao, projeto, mint, contaJogador.address, projeto, 500_000_000); // 500 "USDT"
console.log(`\n  jogador de teste: ${jogador.publicKey.toBase58()} (500 USDT de mentira)`);
console.log(`  chave dele em: ${ARQ_JOGADOR}`);

console.log(`
  ────────────────────────────────────────────────────────────
  Ponha no .env:

    CHAIN_REDE=solana
    CHAIN_RPC_URL=${RPC}
    CHAIN_USDT_CONTRATO=${mint.toBase58()}
    CARTEIRA_PROJETO=${projeto.publicKey.toBase58()}
    CARTEIRA_CHAVE_PRIVADA=./${ARQ_PROJETO}

  Depois, para simular um jogador depositando:

    node tools/devnet-depositar.mjs <endereço-do-jogador-no-jogo> 25
  ────────────────────────────────────────────────────────────
`);
