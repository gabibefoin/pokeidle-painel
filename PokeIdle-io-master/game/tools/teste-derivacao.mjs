// Teste da derivação de endereços de depósito.
//
// Este arquivo é curto e é o mais importante do conjunto. Derivação errada não dá erro:
// gera um endereço perfeitamente válido, que NÃO é o que a carteira do jogador vai gerar
// para o mesmo índice. O dinheiro chega num lugar que ninguém consegue abrir, e só se
// descobre quando alguém tenta resgatar.
//
// Por isso aqui não se testa "roda sem estourar" — se confere byte a byte contra os
// VETORES OFICIAIS do SLIP-0010 (Test vector 1 e 2 para ed25519), que estão em
// https://github.com/satoshilabs/slips/blob/master/slip-0010.md
//
//   node tools/teste-derivacao.mjs
import {
  derivarSemente,
  sementeDoJogador,
  enderecoDoJogador,
  lerSeedMestra,
  CAMINHO_SOLANA,
} from '../src/server/derivacao.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

/** O caminho do SLIP-0010 vem com os índices já sem o bit de endurecimento. */
const hex = (b) => Buffer.from(b).toString('hex');

// ============================================== SLIP-0010, vetor de teste 1
secao('SLIP-0010 — vetor 1 (seed 000102...0e0f)');
const seed1 = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');

const casos1 = [
  { caminho: [], chave: '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7' },
  { caminho: [0], chave: '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3' },
  { caminho: [0, 1], chave: 'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2' },
  { caminho: [0, 1, 2], chave: '92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9' },
  { caminho: [0, 1, 2, 2], chave: '30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662' },
  { caminho: [0, 1, 2, 2, 1000000000], chave: '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793' },
];
for (const c of casos1) {
  const r = derivarSemente(seed1, c.caminho);
  ok(hex(r.chave) === c.chave, `m/${c.caminho.map((n) => `${n}'`).join('/') || ''} bate`, hex(r.chave));
}

// ============================================== SLIP-0010, vetor de teste 2
secao('SLIP-0010 — vetor 2 (seed longa)');
const seed2 = Buffer.from(
  'fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542',
  'hex',
);
// Só os níveis cujo valor oficial eu tenho conferido. O nível 1 fica FORA de propósito:
// ele é derivado dentro do nível 2, então o nível 2 bater já prova que o nível 1 está
// certo — uma cadeia HMAC não fecha por acaso a partir de um elo errado.
//
// Se algum dia alguém quiser cravar o nível 1 aqui, pegue o valor do documento do
// SLIP-0010, não da saída deste programa: colar o que o código imprimiu transformaria o
// teste num espelho, que passa exatamente quando não deveria.
const casos2 = [
  { caminho: [], chave: '171cb88b1b3c1db25add599712e36245d75bc65a1a5c9e18d76f9f2b1eab4012' },
  { caminho: [0, 2147483647], chave: 'ea4f5bfe8694d8bb74b7b59404632fd5968b774ed545e810de9c32a4fb4192f4' },
];
for (const c of casos2) {
  const r = derivarSemente(seed2, c.caminho);
  ok(hex(r.chave) === c.chave, `vetor 2, nível ${c.caminho.length} bate`, hex(r.chave));
}

// ================================================================ o caminho
secao('Caminho BIP44 da Solana');
ok(JSON.stringify(CAMINHO_SOLANA(7)) === '[44,501,7,0]', "m/44'/501'/7'/0' é o caminho do jogador 7");

// ============================================================== determinismo
secao('Determinismo e separação');
const mestra = Buffer.from('a'.repeat(64), 'hex');
const a1 = sementeDoJogador(mestra, 1);
ok(hex(sementeDoJogador(mestra, 1)) === hex(a1), 'o mesmo índice dá sempre a mesma semente');
ok(hex(sementeDoJogador(mestra, 2)) !== hex(a1), 'índices diferentes dão sementes diferentes');
ok(hex(sementeDoJogador(Buffer.from('b'.repeat(64), 'hex'), 1)) !== hex(a1),
  'seed mestra diferente dá endereço diferente para o MESMO índice');
ok(a1.length === 32, 'a semente tem 32 bytes (o que Keypair.fromSeed espera)');

// ================================================================== entrada
secao('Leitura da seed do ambiente');
const emHex = 'a'.repeat(64);
ok(lerSeedMestra(emHex).length === 32, 'aceita hex');
ok(lerSeedMestra(Buffer.from(emHex, 'hex').toString('base64')).length === 32, 'aceita base64');
ok(hex(lerSeedMestra(emHex)) === hex(lerSeedMestra(Buffer.from(emHex, 'hex').toString('base64'))),
  'hex e base64 do mesmo valor dão a mesma seed');

const recusa = (v, nome) => {
  let erro = null;
  try { lerSeedMestra(v); } catch (e) { erro = e.message; }
  ok(!!erro, nome, erro ?? 'passou!');
};
recusa('', 'recusa seed vazia');
recusa('abcd', 'recusa seed curta');

// ========================================= o endereço, conferido contra a lib
secao('Endereço: node:crypto vs @solana/web3.js');

// `enderecoDoJogador` monta a chave pública com node:crypto para NÃO carregar a web3.js no
// sim. Isso só vale se der o mesmo resultado que a lib de verdade — que é o que se prova
// aqui, no único lugar onde importá-la não custa nada.
const { Keypair } = await import('@solana/web3.js');
const seedTeste = Buffer.from('c'.repeat(64), 'hex');

let iguais = 0;
for (const i of [0, 1, 7, 42, 1000, 123456]) {
  const nosso = enderecoDoJogador(seedTeste, i);
  const daLib = Keypair.fromSeed(sementeDoJogador(seedTeste, i)).publicKey.toBase58();
  if (nosso === daLib) iguais++;
  else console.log(`      índice ${i}: nosso=${nosso} lib=${daLib}`);
}
ok(iguais === 6, 'os 6 índices dão o MESMO endereço nos dois caminhos', `${iguais}/6`);

const end0 = enderecoDoJogador(seedTeste, 0);
ok(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(end0), 'o endereço é base58 no formato da Solana', end0);
ok(enderecoDoJogador(seedTeste, 0) !== enderecoDoJogador(seedTeste, 1), 'jogadores diferentes, endereços diferentes');
ok(enderecoDoJogador(seedTeste, 9) === enderecoDoJogador(seedTeste, 9), 'e o mesmo jogador cai sempre no mesmo');

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
