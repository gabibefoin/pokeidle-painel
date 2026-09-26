// Derivação de endereços de depósito — um por jogador, todos de uma seed só.
//
// ### O problema que isto resolve
//
// Com UMA carteira para todo mundo, a única forma de saber de quem é o dinheiro é o memo:
// o jogador cola um código de 12 caracteres no envio. Na prática ele erra — manda sem memo,
// com o memo errado, ou de uma exchange que simplesmente não deixa anexar memo em envio SPL.
// Cada erro desses é dinheiro parado sem dono e um ticket de suporte.
//
// Com um endereço POR JOGADOR não existe campo para errar: quem recebeu já diz de quem é.
//
// ### Como funciona
//
// Uma seed mestra gera infinitos pares de chaves determinísticos. O jogador nº 7 sempre cai
// no mesmo endereço, hoje e daqui a dois anos, então não é preciso guardar chave nenhuma no
// banco — só o índice. Perder o banco de endereços não perde dinheiro: com a seed, todos
// voltam.
//
// O padrão é o SLIP-0010 (a versão do BIP32 para ed25519, que é a curva da Solana) no
// caminho BIP44 `m/44'/501'/N'/0'` — o mesmo que Phantom e o `solana-keygen` usam. Seguir o
// padrão importa: significa que a seed pode ser importada numa carteira de verdade para
// resgate manual, sem depender deste código.
//
// ### Por que à mão em vez de `ed25519-hd-key`
//
// São vinte linhas de HMAC-SHA512, e o `node:crypto` já traz tudo. Somar mais um pacote na
// árvore de dependências do caminho do dinheiro — que já acusa 8 vulnerabilidades por causa
// do `@solana/web3.js` — custa mais do que escrever isto. E, ao contrário de serializar
// transação, aqui há VETORES DE TESTE OFICIAIS: `teste-derivacao.mjs` confere contra os do
// próprio SLIP-0010, então "está certo" não é opinião.
//
// ### A seed mestra NÃO é a chave da tesouraria
//
// São dois segredos separados de propósito (`ORB_SEED_DEPOSITOS` e `CARTEIRA_CHAVE_PRIVADA`).
// Quem tiver a seed dos depósitos consegue varrer o que ainda não foi recolhido — ruim, mas
// limitado ao que está em trânsito. Se fosse a mesma chave, o mesmo vazamento levaria o
// caixa inteiro junto.
import { createHmac, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base58Encode } from './chain.mjs';

/** `m/44'/501'/N'/0'` — o caminho que Phantom e solana-keygen usam para contas Solana. */
export const CAMINHO_SOLANA = (indice) => [44, 501, indice, 0];

const ENDURECIDO = 0x80000000;

/**
 * SLIP-0010 para ed25519.
 *
 * Só existe derivação ENDURECIDA nesta curva — não há chave pública derivável sem a
 * privada, e é por isso que cada índice aqui leva o `| ENDURECIDO`. Quem tentar espelhar
 * isto com uma implementação de secp256k1 (Bitcoin/EVM) vai gerar endereços diferentes.
 */
export function derivarSemente(seed, caminho) {
  if (!Buffer.isBuffer(seed)) seed = Buffer.from(seed);
  if (seed.length < 16) throw new Error('seed curta demais (mínimo 16 bytes)');

  // Nó mestre: a chave HMAC é a string fixa do padrão.
  let h = createHmac('sha512', Buffer.from('ed25519 seed', 'utf8')).update(seed).digest();
  let chave = h.subarray(0, 32);
  let cadeia = h.subarray(32);

  for (const nivel of caminho) {
    const dados = Buffer.alloc(37);
    dados[0] = 0x00; // o byte zero que marca derivação endurecida
    chave.copy(dados, 1);
    dados.writeUInt32BE((nivel | ENDURECIDO) >>> 0, 33);

    h = createHmac('sha512', cadeia).update(dados).digest();
    chave = h.subarray(0, 32);
    cadeia = h.subarray(32);
  }
  return { chave: Buffer.from(chave), cadeia: Buffer.from(cadeia) };
}

/**
 * A semente de 32 bytes do jogador `indice`.
 *
 * É ela que vira `Keypair.fromSeed()` no `@solana/web3.js`. Devolver a semente em vez do
 * par pronto mantém este arquivo livre da biblioteca — ele roda em qualquer processo, e
 * quem precisa do par (só a varredura, que assina) faz a conversão lá.
 */
export const sementeDoJogador = (seedMestra, indice) =>
  derivarSemente(seedMestra, CAMINHO_SOLANA(indice)).chave;

/**
 * Lê a seed mestra do ambiente.
 *
 * Aceita hex ou base64. Não aceita frase de 12 palavras de propósito: converter mnemônico
 * em seed exige a tabela BIP39 inteira e o PBKDF2 do padrão, e uma implementação errada
 * disso gera endereços que parecem certos e não são. Gere os bytes uma vez com
 * `tools/gerar-seed-depositos.mjs` e guarde-os.
 */
/**
 * O prefixo DER de uma chave privada ed25519 em PKCS#8.
 *
 * `node:crypto` só aceita chave ed25519 embrulhada em DER, não os 32 bytes crus. São
 * sempre os mesmos 16 bytes de cabeçalho (versão, OID 1.3.101.112, comprimento), então
 * concatenar com a semente monta o embrulho sem trazer uma biblioteca de ASN.1.
 */
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

/**
 * O endereço Solana (base58) do jogador `indice`.
 *
 * Feito com `node:crypto` e não com `@solana/web3.js` por um motivo prático: esta função
 * roda no SIM, para mostrar o endereço na tela de depósito. Trazer a web3.js para cá
 * carregaria a árvore de dependências dela (e as 8 vulnerabilidades) num processo exposto
 * à internet que não precisa assinar nada. Só a varredura, que assina, importa a lib.
 *
 * `teste-derivacao.mjs` confere que este caminho dá EXATAMENTE o mesmo endereço que
 * `Keypair.fromSeed()` — sem isso, "não usa a lib" seria só uma forma elegante de errar.
 */
export function enderecoDoJogador(seedMestra, indice) {
  const semente = sementeDoJogador(seedMestra, indice);
  const privada = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519, semente]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privada).export({ format: 'der', type: 'spki' });
  // A chave pública crua são os últimos 32 bytes do SPKI — o resto é cabeçalho fixo.
  return base58Encode(spki.subarray(spki.length - 32));
}

export function lerSeedMestra(valor) {
  let bruto = String(valor ?? '').trim();
  if (!bruto) throw new Error('ORB_SEED_DEPOSITOS não configurada');

  // Aceita um CAMINHO de arquivo, pelo mesmo motivo de `lerChaveSolana`: menos cópias do
  // segredo circulando. Um valor com barra ou terminado em .txt/.key é caminho; hex puro,
  // não (hex é [0-9a-f], nunca tem barra).
  if (/[\\/]/.test(bruto) || /\.(txt|key|seed)$/i.test(bruto)) {
    bruto = readFileSync(resolve(bruto), 'utf8').trim();
  }
  const buf = /^[0-9a-fA-F]+$/.test(bruto) && bruto.length % 2 === 0
    ? Buffer.from(bruto, 'hex')
    : Buffer.from(bruto, 'base64');
  if (buf.length < 32) throw new Error(`ORB_SEED_DEPOSITOS deu ${buf.length} bytes, esperava ao menos 32`);
  return buf;
}
