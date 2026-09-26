// Gera a SEED MESTRA dos endereços de depósito.
//
//   node tools/gerar-seed-depositos.mjs
//
// Ela deriva o endereço de todo jogador (ver `derivacao.mjs`). Duas consequências que valem
// entender antes de rodar:
//
//   · a tabela `orb_enderecos` é DESCARTÁVEL. Com esta seed e o id do jogador, qualquer
//     endereço se recalcula do zero. Perder o banco não perde dinheiro;
//   · perder ESTA SEED perde tudo que ainda não foi varrido para a tesouraria. Não há
//     recuperação, não há suporte, não há segunda via.
//
// Guarde-a como você guardaria a chave da tesouraria — porque, para o dinheiro em trânsito,
// é exatamente isso que ela é.
//
// É um segredo SEPARADO de CARTEIRA_CHAVE_PRIVADA, e isso importa: quem vazar esta aqui
// alcança só os depósitos ainda não recolhidos. Se fossem a mesma chave, o mesmo vazamento
// levaria o caixa inteiro.
import { randomBytes } from 'node:crypto';
import { enderecoDoJogador } from '../src/server/derivacao.mjs';

const seed = randomBytes(32);
const hex = seed.toString('hex');

console.log(`
  Seed mestra dos depósitos (32 bytes).

  Ponha no .env, em ORB_SEED_DEPOSITOS:

    ORB_SEED_DEPOSITOS=${hex}

  Confira: com esta seed, os primeiros jogadores cairiam em

    jogador 1  →  ${enderecoDoJogador(seed, 1)}
    jogador 2  →  ${enderecoDoJogador(seed, 2)}
    jogador 3  →  ${enderecoDoJogador(seed, 3)}

  Estes endereços são determinísticos: a mesma seed dá sempre os mesmos. Se um dia você
  precisar resgatar à mão, importe a seed numa carteira que aceite SLIP-0010 e navegue
  para m/44'/501'/N'/0', onde N é o id do jogador.

  GUARDE A SEED FORA DESTA MÁQUINA. Perdeu, perdeu — inclusive o dinheiro que estiver
  parado nos endereços dos jogadores.
`);
