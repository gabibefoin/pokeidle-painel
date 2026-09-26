// Gera um par de chaves Solana SEM precisar do CLI instalado.
//
//   node tools/gerar-carteira.mjs [arquivo.json]
//
// Existe por dois motivos. O primeiro é destravar a devnet enquanto o `solana-install`
// não roda — o `@solana/web3.js` já está no projeto por causa do adaptador, e ele sabe
// gerar o mesmo formato de arquivo que o `solana-keygen new --outfile` produz (array JSON
// de 64 bytes), então o resto do ferramental lê sem adaptação.
//
// O segundo é que ele imprime **só o endereço público**. A chave nunca aparece no terminal,
// então colar a saída deste comando em qualquer lugar é seguro. Quem for pedir ajuda com a
// configuração manda esta saída, não o arquivo.
//
// ### ATENÇÃO: isto NÃO substitui o solana-keygen para valer
//
// `solana-keygen` deriva a chave de uma SEED PHRASE de 12/24 palavras, e é ela que permite
// recuperar a carteira se o arquivo se perder. Aqui não há seed phrase: o arquivo é a única
// cópia que existe. Perdeu o arquivo, perdeu o dinheiro, e não há recuperação possível.
//
// Para DEVNET isso não importa — o SOL é de graça e gerar outra carteira custa nada.
// Para MAINNET, use `solana-keygen new` (ou, melhor ainda, uma carteira de hardware) e
// guarde a seed phrase no papel.
import { writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const destino = resolve(process.argv[2] ?? 'carteira-projeto.json');

// Nunca sobrescreve. Um `--outfile` apontado sem querer para um arquivo que já existe é a
// forma mais boba de apagar uma carteira com saldo dentro.
try {
  await access(destino);
  console.error(`\n  ✗ ${destino} JÁ EXISTE.`);
  console.error('    Não vou sobrescrever — se aquela carteira tiver saldo, ele some junto.');
  console.error('    Escolha outro nome ou mova o arquivo antigo.\n');
  process.exit(1);
} catch {
  // não existe: é o caminho feliz
}

const { Keypair } = await import('@solana/web3.js');
const par = Keypair.generate();

await writeFile(destino, JSON.stringify([...par.secretKey]), 'utf8');

console.log(`
  Carteira criada.

  Arquivo (contém a CHAVE PRIVADA — não comite, não mande para ninguém):
    ${destino}

  Endereço público (pode colar em qualquer lugar):

    ${par.publicKey.toBase58()}

  Próximos passos:
    1. faça uma cópia do arquivo num lugar seguro e fora desta máquina;
    2. ponha o endereço acima em CARTEIRA_PROJETO, no .env;
    3. na devnet, financie com:  solana airdrop 2 ${par.publicKey.toBase58()} --url devnet

  Lembrete: esta carteira NÃO tem seed phrase. Serve para devnet.
  Para valer, refaça com \`solana-keygen new\` e guarde as palavras no papel.
`);
