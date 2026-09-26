// Teste do Referral Especial — as regras que decidem quanto um parceiro pode receber.
//
// Não precisa de Postgres: tudo aqui é aritmética e validação de formato, e é de propósito.
// O que este arquivo protege é a única coisa do programa de indicação que não dá para consertar
// depois — a taxa em GEMA, que é emissão sem lastro. Um `0.05` virando `0.15` num descuido só
// apareceria no caixa semanas depois, quando os saques chegassem.
//
//   node tools/teste-afiliados.mjs
import { PRECO_COMPRA, PRECO_SAQUE } from '../src/server/game/orbs.mjs';
import {
  CODIGO_OK,
  GEMAS_POR_DIAMANTE,
  MARGEM_MINIMA_CAIXA,
  PCT_DIA_COMISSAO,
  PCT_ORB_COMISSAO,
  SLUG_OK,
  TETO_DIA_MAX,
  TETO_DIA_SEGURO,
  TETO_ORB_MAX,
  TETO_ORB_RUINA,
  TETO_ORB_SEGURO,
  CUSTO_REDE_PRIMEIRO_SAQUE,
  depositoDeEquilibrio,
  diamantesDoBonus,
  margemDoDeposito,
  normalizarSlug,
  refOk,
  tetoDaGema,
  validarTaxa,
} from '../src/server/game/afiliados.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

/** Roda `fn` e devolve a chave do ErroAfiliado, ou null se não estourou. */
const chaveDoErro = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return err.chave ?? err.message;
  }
};

console.log('Referral Especial — taxas, tetos e link\n=======================================');

secao('O teto da gema sai da álgebra, não de opinião');
{
  // saque × (1 + taxa) ≤ compra  ⟺  taxa ≤ compra/saque − 1
  const esperado = PRECO_COMPRA / PRECO_SAQUE - 1;
  ok(Math.abs(TETO_ORB_RUINA - esperado) < 1e-12,
    `o ponto de empate é ${(esperado * 100).toFixed(4)}%`, `${(TETO_ORB_RUINA * 100).toFixed(4)}%`);
  ok(Math.abs(TETO_ORB_RUINA - 0.111111111) < 1e-6,
    'com spread de 10% isso dá 11,11% — e não os 4,76% do comentário antigo, que falava do SPREAD');

  ok(Math.abs(margemDoDeposito(PCT_ORB_COMISSAO) - 0.055) < 1e-9,
    'a 5% sobram 5,5% do depósito no caixa');
  ok(Math.abs(margemDoDeposito(0.10) - 0.01) < 1e-9,
    'a 10% sobra 1%');
  ok(Math.abs(margemDoDeposito(TETO_ORB_RUINA)) < 1e-9,
    'no teto a margem é exatamente zero');
  ok(Math.abs(margemDoDeposito(0.15) + 0.035) < 1e-9,
    'a 15% o caixa PERDE 3,5% de cada depósito', `${(margemDoDeposito(0.15) * 100).toFixed(4)}%`);

  // A conta em dinheiro, do jeito que ela aparece no painel.
  const passivo15 = (10_000 + 1_500) * PRECO_SAQUE;
  ok(Math.abs(passivo15 - 103.5) < 1e-9,
    'US$ 100 depositados a 15% viram US$ 103,50 de saque', `${passivo15.toFixed(4)}`);

  ok(TETO_ORB_SEGURO < TETO_ORB_RUINA, 'o teto sem aviso é menor que o de ruína');
  ok(Math.abs(margemDoDeposito(TETO_ORB_SEGURO) - MARGEM_MINIMA_CAIXA) < 1e-9,
    `no teto sem aviso sobra exatamente a margem mínima (${(MARGEM_MINIMA_CAIXA * 100).toFixed(0)}%)`);
  ok(PRECO_SAQUE * (1 + PCT_ORB_COMISSAO) < PRECO_COMPRA,
    'e a taxa PADRÃO cabe no spread com folga');
}

secao('O teto de produto é 10%, e fica abaixo do empate');
{
  ok(TETO_ORB_MAX === 0.10, 'o teto que o painel aplica é 10%');
  ok(tetoDaGema() === TETO_ORB_MAX, 'e é ele que vale enquanto for menor que o empate');
  ok(tetoDaGema() < TETO_ORB_RUINA, 'nunca encosta no empate');
  ok(Math.abs(margemDoDeposito(TETO_ORB_MAX) - 0.01) < 1e-9,
    'no teto sobra 1% do depósito — US$ 0,10 a cada US$ 10');

  // A armadilha de linguagem: "10% dos US$ 10" são US$ 1,00, que são 111 gemas = 11,11%.
  const gemasParaUmDolar = 1 / PRECO_SAQUE;
  ok(Math.abs(gemasParaUmDolar / 1000 - TETO_ORB_RUINA) < 1e-9,
    'dar US$ 1,00 (10% de US$ 10) custa 11,11% das gemas, não 10%',
    `${(gemasParaUmDolar / 10).toFixed(4)}%`);
  ok(Math.abs(Math.floor(1000 * TETO_ORB_MAX) * PRECO_SAQUE - 0.9) < 1e-9,
    'a 10%, o padrinho leva US$ 0,90 do US$ 1,00 de margem');
  ok(Math.abs(10 - 1000 * PRECO_SAQUE - Math.floor(1000 * TETO_ORB_MAX) * PRECO_SAQUE - 0.10) < 1e-9,
    'e sobram exatamente US$ 0,10 para o projeto');
}

secao('O custo fixo de rede decide o tamanho mínimo do indicado');
{
  ok(CUSTO_REDE_PRIMEIRO_SAQUE > 0, 'o custo do 1º saque de cada jogador está declarado');
  const noPadrao = depositoDeEquilibrio(PCT_ORB_COMISSAO);
  const noTeto = depositoDeEquilibrio(TETO_ORB_MAX);
  ok(Math.abs(noPadrao - CUSTO_REDE_PRIMEIRO_SAQUE / 0.055) < 1e-9,
    `a 5%, o indicado passa a render acima de US$ ${noPadrao.toFixed(2)} depositados`);
  ok(Math.abs(noTeto - CUSTO_REDE_PRIMEIRO_SAQUE / 0.01) < 1e-9,
    `a 10%, só acima de US$ ${noTeto.toFixed(2)}`);
  ok(noTeto > noPadrao, 'e o teto exige indicado bem maior que o padrão');
  ok(depositoDeEquilibrio(TETO_ORB_RUINA) === Infinity,
    'no empate não existe depósito grande o bastante');
}

secao('A validação recusa o que fura o caixa');
{
  const gema = (v, confirmado = false) => validarTaxa(v, {
    tetoSeguro: TETO_ORB_SEGURO, tetoDuro: tetoDaGema(), confirmado, moeda: 'gema',
  });

  ok(gema(0.05) === 0.05, 'aceita a taxa padrão sem confirmação');
  ok(chaveDoErro(() => gema(0.15)) === 'afiliados.taxaGemaAcimaDoTeto',
    '15% em gema é RECUSADO');
  ok(chaveDoErro(() => gema(0.15, true)) === 'afiliados.taxaGemaAcimaDoTeto',
    'e confirmar não libera nada acima do teto');
  ok(chaveDoErro(() => gema(0.1111, true)) === 'afiliados.taxaGemaAcimaDoTeto',
    'o ponto de empate (11,11%) também é recusado — o teto é 10%');
  ok(chaveDoErro(() => gema(0.10)) === 'afiliados.taxaPedeConfirmacao',
    '10% é o teto e pede confirmação');
  ok(gema(0.10, true) === 0.10, 'e passa confirmado');
  ok(chaveDoErro(() => gema(-1)) === 'afiliados.taxaInvalida', 'recusa negativo');
  ok(chaveDoErro(() => gema('abacaxi')) === 'afiliados.taxaInvalida', 'recusa não-número');
  // O erro de digitação que o teto duro existe para pegar: 15 em vez de 0,15.
  ok(chaveDoErro(() => gema(15)) === 'afiliados.taxaGemaAcimaDoTeto',
    'e recusa 15 (ponto percentual no lugar de fração)');

  const dia = (v, confirmado = false) => validarTaxa(v, {
    tetoSeguro: TETO_DIA_SEGURO, tetoDuro: TETO_DIA_MAX, confirmado, moeda: 'diamante',
  });
  ok(dia(0.15) === 0.15, '15% em DIAMANTE passa liso — diamante não é passivo em USDT');
  ok(dia(0.25) === 0.25, 'e 25% também');
  ok(chaveDoErro(() => dia(0.30)) === 'afiliados.taxaPedeConfirmacao', '30% pede confirmação');
  ok(dia(0.30, true) === 0.30, 'e passa confirmado');
  ok(chaveDoErro(() => dia(0.90)) === 'afiliados.taxaAcimaDoTeto', '90% estoura o teto de estrago');
}

secao('O link personalizado');
{
  ok(normalizarSlug('matta') === 'matta', 'aceita "matta"');
  ok(normalizarSlug('  MattaYahu ') === 'mattayahu', 'apara e baixa a caixa');
  ok(normalizarSlug('') === null, 'vazio significa "sem link personalizado"');
  ok(normalizarSlug(null) === null, 'e null também');
  ok(normalizarSlug('gaules_tv') === 'gaules_tv', 'aceita sublinhado');
  ok(normalizarSlug('alan-zoka') === 'alan-zoka', 'aceita hífen no meio');

  ok(chaveDoErro(() => normalizarSlug('ab')) === 'afiliados.slugInvalido', 'recusa curto demais');
  ok(chaveDoErro(() => normalizarSlug('-matta')) === 'afiliados.slugInvalido', 'recusa começar com hífen');
  ok(chaveDoErro(() => normalizarSlug('matta-')) === 'afiliados.slugInvalido', 'recusa terminar com hífen');
  ok(chaveDoErro(() => normalizarSlug('mat--ta')) === 'afiliados.slugInvalido', 'recusa hífen duplo');
  ok(chaveDoErro(() => normalizarSlug('mat ta')) === 'afiliados.slugInvalido', 'recusa espaço');
  ok(chaveDoErro(() => normalizarSlug('matt@')) === 'afiliados.slugInvalido', 'recusa símbolo');
  ok(chaveDoErro(() => normalizarSlug('a'.repeat(21))) === 'afiliados.slugInvalido', 'recusa longo demais');
  ok(chaveDoErro(() => normalizarSlug('admin')) === 'afiliados.slugReservado', 'recusa reservado');
  ok(chaveDoErro(() => normalizarSlug('PokeIdle')) === 'afiliados.slugReservado', 'reservado ignora a caixa');

  // O slug precisa aceitar I e O — o código gerado os evita por ambiguidade visual, mas nome de
  // gente tem I e O. Era exatamente aqui que "matta" morria: `CODIGO_OK` exige 6 a 8.
  ok(SLUG_OK.test('bio'), 'o charset do slug aceita I e O');
  ok(!CODIGO_OK.test('MATTA'), 'e o código gerado continua exigindo 6 a 8 (não foi afrouxado)');
  ok(CODIGO_OK.test('ABC2345'), 'código gerado de 7 continua válido');
}

secao('O ?ref= aceita os dois tipos de link');
{
  ok(refOk('matta'), 'aceita o slug');
  ok(refOk('MATTA'), 'e o slug em maiúscula (a busca é case-insensitive)');
  ok(refOk('ABC2345'), 'aceita o código gerado');
  ok(refOk('abc2345'), 'e o código em minúscula');
  ok(!refOk(''), 'recusa vazio');
  ok(!refOk('ab'), 'recusa curto demais');
  ok(!refOk('  '), 'recusa só espaço');
  ok(!refOk('<script>'), 'recusa lixo');

  // A regex frouxa que o cliente usa (landing.js, app.js) tem de aceitar tudo o que `refOk`
  // aceita: se ela recusar antes, a indicação some sem erro nenhum para o jogador.
  const CLIENTE = /^[a-z0-9][a-z0-9_-]{1,18}[a-z0-9]$/i;
  for (const v of ['matta', 'MATTA', 'ABC2345', 'gaules_tv', 'alan-zoka']) {
    ok(CLIENTE.test(v) === refOk(v), `cliente e servidor concordam sobre "${v}"`);
  }
}

secao('O bônus em diamante sobre o depósito');
{
  ok(diamantesDoBonus(10_000, 0.10) === Math.floor(1000 / GEMAS_POR_DIAMANTE),
    `10% de 10.000 gemas viram ${Math.floor(1000 / GEMAS_POR_DIAMANTE)} diamantes`);
  ok(diamantesDoBonus(10_000, 0) === 0, 'sem bônus configurado, não nasce linha nenhuma');
  ok(diamantesDoBonus(10, 0.10) === 0, 'e o resto trunca para baixo (nunca paga a mais)');

  // A equivalência que justifica o número: o diamante pago vale, na vitrine, um pouco MAIS do
  // que a gema que ele substitui — e mesmo assim sai mais barato para a tesouraria, porque
  // diamante não é passivo em USDT.
  const valorDaGemaEmUsd = GEMAS_POR_DIAMANTE * PRECO_SAQUE;
  ok(valorDaGemaEmUsd > 0.06 && valorDaGemaEmUsd < 0.07,
    `${GEMAS_POR_DIAMANTE} gemas custam US$ ${valorDaGemaEmUsd.toFixed(4)} ao caixa`);

  // O caso concreto que motivou a feature: prometer 15% do depósito sem furar o caixa.
  const taxaGema = PCT_ORB_COMISSAO;      // 5%, dentro do teto
  const bonus = 0.10;                     // os 10 pontos restantes, em diamante
  ok(Math.abs(taxaGema + bonus - 0.15) < 1e-9, 'o parceiro recebe 15% do depósito');
  ok(Math.abs(margemDoDeposito(taxaGema) - 0.055) < 1e-9,
    'e o caixa continua com os mesmos 5,5% de hoje, porque só a gema pesa nele');
}

secao('Os padrões não mudaram');
{
  ok(PCT_ORB_COMISSAO === 0.05, 'gema segue em 5% para quem não tem acordo');
  ok(PCT_DIA_COMISSAO === 0.10, 'diamante segue em 10%');
}

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
