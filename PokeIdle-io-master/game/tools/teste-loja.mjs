// Teste da LOJA VIP, sem banco e sem Redis.
//
// `loja.mjs` é aritmética pura sobre um objeto de jogador — dá para montar um treinador de
// mentira e comprar tudo, sem infra nenhuma.
//
// O que este teste protege:
//   · o catálogo bate com o do jogo original (preços e durações são deles, não estimados);
//   · o diamante SÓ é debitado quando a compra dá certo;
//   · os limites (5 boosts/dia por tipo, 1 pacote por semana) travam de verdade;
//   · boost não acumula, mas ESTENDE — e o VIP renovado soma em vez de reiniciar;
//   · os multiplicadores expiram na hora certa.
//
//   node tools/teste-loja.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PRODUTOS,
  produtoPorId,
  validarCompra,
  aplicarEfeito,
  multBoost,
  multXpTreinador,
  multXpPokemon,
  multCaptura,
  multShiny,
  bonusLootPct,
  vipAtivo,
  consumirBless,
  catalogoParaCliente,
  BEAST_BALL,
  BEAST_VS_ULTRA,
  TIPOS_BOOST,
  DURACOES,
  BLESS,
  VIP_MULT_XP,
  precoBoost7d,
  PACOTES_BOOST,
  DURACOES_PACOTE,
  DESCONTO_PACOTE,
  somaAvulsaDoPacote,
  precoDoPacote,
  OUTFITS_VIP,
  LOOKTYPES_OUTFIT_VIP,
  podeEquiparLooktype,
  reverterOutfitVipExpirado,
} from '../src/server/game/loja.mjs';
import { bolas } from '../src/server/content.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const H = 3600_000;
const T0 = Date.UTC(2026, 7, 3, 12, 0, 0); // meio-dia UTC, longe da virada do dia

const jogador = (diamonds = 1000) => ({
  nick: 'Teste',
  diamonds,
  balls: { 1: 100 },
  boosts: {},
  boostsHoje: {},
  comprasCooldown: {},
  vipAte: 0,
  bless: null,
  gender: 'male',
  looktype: 159,
  ownedOutfits: [],
});

/**
 * Reproduz o que o servidor faz numa compra: valida, DEBITA e só então aplica o efeito.
 *
 * O débito de verdade é uma transação no ledger (`diamantes-db.gastarNaLoja`); aqui ele é um
 * decremento simples, porque este teste não abre banco. O que se exercita é a ORDEM —
 * validar antes de cobrar, cobrar antes de entregar — que é a parte da regra que mora em
 * `loja.mjs`. A atomicidade do débito é coberta por `teste-diamantes.mjs`, com Postgres de verdade.
 */
function comprar(p, id, agora, extra = {}) {
  const v = validarCompra(p, id, agora, extra);
  if (!v.ok) return { ok: false, erro: v.erro };
  p.diamonds -= v.produto.preco;
  const r = aplicarEfeito(p, v.produto, agora, { nome: v.nomePedido });
  return { ok: true, produto: r.produto, efeito: r.efeito, nomePedido: v.nomePedido };
}

console.log('LOJA VIP\n========');

// ------------------------------------------------- o catálogo contra a fonte

secao('Catálogo × jogo original');
{
  const fonte = JSON.parse(
    readFileSync(join(raiz, '../public/data/site/api/diamonds-shop.json'), 'utf8'),
  ).products;
  const preçoDeles = new Map(fonte.map((x) => [x.id, x.priceDiamonds]));

  ok(fonte.length === 61, `a fonte espelhada tem 61 produtos (${fonte.length})`);
  ok(PRODUTOS.length >= 50, `o nosso catálogo tem ${PRODUTOS.length} produtos`);

  // Os 35 boosts: 5 tipos × 7 durações, com os preços deles.
  const boosts = PRODUTOS.filter((x) => x.cat === 'boosts');
  ok(boosts.length === 35, `35 boosts (5 tipos × 7 durações) — deu ${boosts.length}`);

  const divergentes = [];
  for (const p of PRODUTOS) {
    const deles = preçoDeles.get(p.id);
    if (deles === undefined || deles === p.preco) continue;
    // O 7d corrigimos de propósito: o espelho quebrava o desconto do 24h.
    if (p.cat === 'boosts' && p.id.endsWith('_7d')) {
      const id24 = p.id.replace(/_7d$/, '_24h');
      const p24 = produtoPorId.get(id24);
      if (p24 && p.preco === precoBoost7d(p24.preco)) continue;
    }
    divergentes.push(`${p.id}: nosso ${p.preco} ≠ deles ${deles}`);
  }
  ok(!divergentes.length, 'todo produto com id em comum tem o preço DELES (ou 7d corrigido)', divergentes.slice(0, 5).join(' | '));

  // Os boosts têm ids iguais aos deles (boost_xp, boost_loot_7d…) — confere um a um.
  const semPar = boosts.filter((b) => !preçoDeles.has(b.id));
  ok(!semPar.length, 'todo boost nosso existe na loja deles', semPar.slice(0, 5).map((x) => x.id).join(', '));

  // VIP: os três, com os preços deles.
  ok(produtoPorId.get('vip30').preco === 10, 'VIP 30 dias custa 10 💎');
  ok(produtoPorId.get('vip60').preco === 17, 'VIP 60 dias custa 17 💎');
  ok(produtoPorId.get('vip90').preco === 25, 'VIP 90 dias custa 25 💎');
  ok(produtoPorId.get('name').preco === 6, 'Troca de Nome custa 6 💎');
  ok(!produtoPorId.has('genderswap'), 'Troca de Gênero saiu da loja');

  // A Beast Ball no lugar da Idle Ball: mesmos preços, mesmas quantidades.
  ok(produtoPorId.get('beast100').preco === preçoDeles.get('idleball100'), 'Beast Ball ×100 = preço da Idle Ball ×100');
  ok(produtoPorId.get('beast300').preco === preçoDeles.get('idleball300'), 'Beast Ball ×300 = preço da Idle Ball ×300');
  ok(produtoPorId.get('beast600').preco === preçoDeles.get('idleball600'), 'Beast Ball ×600 = preço da Idle Ball ×600');
  ok(BEAST_BALL.catchRate === 8, 'a Beast Ball tem catchRate 8 (2× a Ultra Ball)');
  ok(!BEAST_BALL.compravel, 'e NÃO é comprável com ouro');
  const ultra = bolas.find((b) => b.id === 4);
  const beast = bolas.find((b) => b.id === 5);
  ok(beast?.catchRate === (ultra?.catchRate ?? 4) * BEAST_VS_ULTRA,
    'no catálogo jogável a Beast vale 2× a Ultra', `${beast?.catchRate} vs ${ultra?.catchRate}`);

  const cli = catalogoParaCliente();
  ok(cli.length === PRODUTOS.length, 'o catálogo do cliente tem tudo');
  ok(!cli.some((x) => x.efeito), 'e não vaza os internos do efeito');
}

// ------------------------------------------------------------------ o saldo

secao('Cobrança');
{
  const p = jogador(10);
  const r = comprar(p, 'vip30', T0);
  ok(r.ok, 'compra com saldo dá certo');
  ok(p.diamonds === 0, 'o preço é debitado', `sobrou ${p.diamonds}`);

  const r2 = comprar(p, 'vip30', T0);
  ok(!r2.ok && /insuficiente/.test(r2.erro), 'sem saldo, recusa');
  ok(p.diamonds === 0, 'e NÃO debita nada na recusa');

  const p3 = jogador(1000);
  const r3 = comprar(p3, 'produto_que_nao_existe', T0);
  ok(!r3.ok, 'produto inexistente é recusado');
  ok(p3.diamonds === 1000, 'e também não cobra');
}

// ------------------------------------------------------------------ Beast Ball

secao('Beast Ball');
{
  const p = jogador();
  comprar(p, 'beast100', T0);
  ok(p.balls[BEAST_BALL.id] === 100, '×100 entra no inventário', `${p.balls[BEAST_BALL.id]}`);
  comprar(p, 'beast600', T0);
  ok(p.balls[BEAST_BALL.id] === 700, 'e o pacote seguinte SOMA', `${p.balls[BEAST_BALL.id]}`);

  ok(comprar(p, 'supplypack', T0).ok, 'o Pacote de Suprimentos dá 1000');
  ok(p.balls[BEAST_BALL.id] === 1700, '…somando ao que já tinha', `${p.balls[BEAST_BALL.id]}`);
  const r = comprar(p, 'supplypack', T0 + 3 * 24 * H);
  ok(!r.ok && /7 dias/.test(r.erro), 'e trava por 7 dias', r.erro);
  ok(comprar(p, 'supplypack', T0 + 8 * 24 * H).ok, 'liberando depois da semana');
}

// --------------------------------------------------------------------- VIP

secao('VIP');
{
  const p = jogador();
  comprar(p, 'vip30', T0);
  ok(vipAtivo(p, T0 + 29 * 24 * H), 'VIP de 30 dias vale no dia 29');
  ok(!vipAtivo(p, T0 + 31 * 24 * H), 'e expira no dia 31');
  ok(multXpTreinador(p, T0) === VIP_MULT_XP, `VIP dá ×${VIP_MULT_XP} de XP de treinador`);
  ok(multXpPokemon(p, T0) === VIP_MULT_XP, `e ×${VIP_MULT_XP} de XP de pokémon`);

  // Renovar ESTENDE: comprar 30 dias com 30 já pagos dá 60, não 30.
  comprar(p, 'vip30', T0 + 10 * 24 * H);
  ok(vipAtivo(p, T0 + 55 * 24 * H), 'renovar estende em vez de reiniciar');
  ok(!vipAtivo(p, T0 + 61 * 24 * H), 'e a soma é exata (30 + 30)');
}

// ------------------------------------------------------------------ boosts

secao('Boosts');
{
  ok(precoBoost7d(29) === 175, 'XP Boost 7d com desconto da curva (175, não 203/278)');
  ok(precoBoost7d(58) === 350, 'outros boosts 7d com desconto da curva (350, não 406/555)');
  ok(produtoPorId.get('boost_xp_7d').preco === 175, 'catálogo XP 7d');
  ok(produtoPorId.get('boost_loot_7d').preco === 350, 'catálogo Loot 7d');
  ok(produtoPorId.get('boost_shinycharm_7d').preco === 350, 'catálogo Shiny 7d');

  const p = jogador();
  comprar(p, 'boost_xp', T0); // 1h
  ok(multBoost(p, 'xp', T0) === 1.5, 'XP Boost dá ×1,5');
  ok(multBoost(p, 'xp', T0 + H - 1) === 1.5, 'ainda vale um instante antes de 1h');
  ok(multBoost(p, 'xp', T0 + H + 1) === 1, 'e some passada 1h');
  ok(multBoost(p, 'loot', T0) === 1, 'boost de um tipo não afeta outro');

  // "Não acumula": estende o prazo, não multiplica o efeito.
  comprar(p, 'boost_xp_2h', T0);
  ok(multBoost(p, 'xp', T0) === 1.5, 'comprar de novo NÃO dobra o multiplicador');
  ok(multBoost(p, 'xp', T0 + 2.5 * H) === 1.5, 'mas ESTENDE o prazo (1h + 2h)');
  ok(multBoost(p, 'xp', T0 + 3.5 * H) === 1, 'e o prazo estendido também acaba');

  // VIP e boost se multiplicam — são compras separadas.
  comprar(p, 'vip30', T0);
  ok(
    Math.abs(multXpTreinador(p, T0) - 1.5 * VIP_MULT_XP) < 1e-9,
    `VIP + boost = ×${(1.5 * VIP_MULT_XP).toFixed(2)}, não ×1,5`,
    `${multXpTreinador(p, T0)}`,
  );

  const q = jogador();
  comprar(q, 'boost_capture_24h', T0);
  ok(multCaptura(q, T0) === 2, 'Capture Boost DOBRA');
  comprar(q, 'boost_shinycharm_24h', T0);
  ok(multShiny(q, T0) === 2, 'Shiny Secret Lure DOBRA');
  comprar(q, 'boost_loot_24h', T0);
  ok(Math.abs(bonusLootPct(q, T0) - 40) < 1e-9, 'Loot Boost vira +40 pontos percentuais', `${bonusLootPct(q, T0)}`);
  ok(bonusLootPct(q, T0 + 25 * H) === 0, 'e zera quando expira');
}

secao('Boosts sem limite diário');
{
  // A cota de 5/dia por tipo saiu em 18/09/2026: o diamante é do jogador.
  const p = jogador(10000);
  for (let i = 0; i < 12; i++) {
    ok(comprar(p, 'boost_xp', T0).ok === true, `boost ${i + 1} passa`);
  }
  // "Não acumula": doze compras de 1h no mesmo instante dão doze horas, e o multiplicador é um só.
  ok(p.boosts.xp === T0 + 12 * H, 'as compras estendem o prazo', `${(p.boosts.xp - T0) / H}h`);
  ok(multBoost(p, 'xp', T0) === TIPOS_BOOST.xp.mult, 'e o multiplicador continua um só', `${multBoost(p, 'xp', T0)}`);

  // Durações diferentes também passam, uma atrás da outra.
  const q = jogador(10000);
  for (const d of DURACOES) ok(comprar(q, `boost_xp${d.sufixo}`, T0).ok, `a de ${d.rotulo} passa`);
}

// ------------------------------------------------------------------- Bless

secao('Bless');
{
  const p = jogador();
  ok(consumirBless(p) === null, 'sem bênção, devolve null (a perda padrão vale)');

  comprar(p, 'blessplus', T0);
  ok(p.bless === 'blessplus', 'a bênção fica guardada');
  ok(consumirBless(p) === BLESS.blessplus.pctMorte, 'Bless Plus deixa a morte em 8%');
  ok(p.bless === null, 'e é consumida: vale por UMA morte');
  ok(consumirBless(p) === null, 'a morte seguinte já é sem bênção');

  comprar(p, 'blessmax', T0);
  ok(consumirBless(p) === 0, 'Bless Max zera a perda de XP');
}

// ----------------------------------------------------------------- outfits

secao('Outfits');
{
  const p = jogador();

  const antes = p.diamonds;
  ok(comprar(p, 'outfit_20003', T0).ok, 'compra uma outfit');
  ok(p.ownedOutfits.includes(20003), 'ela entra na lista de possuídas');
  ok(p.looktype === 20003, 'e já é equipada');
  const r = comprar(p, 'outfit_20003', T0);
  ok(!r.ok && /já tem/.test(r.erro), 'comprar de novo é recusado', r.erro);
  ok(p.diamonds === antes - 30, 'e a recusa não cobra de novo', `${p.diamonds}`);
}

// ------------------------------------------------------- outfits VIP

secao('Outfits VIP');
{
  const p = jogador();
  ok(!produtoPorId.get('outfit_20028'), 'Gamer VIP Outfit não é comprável');
  ok(produtoPorId.get('outfit_vip_20028')?.vipExclusive, 'aparece no catálogo como exclusiva de VIP');
  ok(/outfit exclusiva na aba Outfits/.test(produtoPorId.get('vip30').descricao), 'VIP 30 menciona outfit na aba Outfits');

  const r = comprar(p, 'outfit_vip_20028', T0);
  ok(!r.ok && /VIP/.test(r.erro), 'não dá para comprar outfit VIP', r.erro);

  ok(!podeEquiparLooktype(p, 20028, T0), 'sem VIP não equipa');
  comprar(p, 'vip30', T0);
  ok(podeEquiparLooktype(p, 20028, T0), 'com VIP ativo pode equipar');
  p.looktype = 20028;
  ok(!podeEquiparLooktype(p, 20028, T0 + 31 * 24 * H), 'VIP expirado perde acesso');
  ok(reverterOutfitVipExpirado(p, T0 + 31 * 24 * H), 'e o visual volta ao padrão');
  ok(p.looktype === 159, 'looktype padrão masculino');
}

// ----------------------------------------------------------- pacotes

secao('Pacotes de boost');
{
  const idsPacote = PACOTES_BOOST.flatMap((x) => DURACOES_PACOTE.map((d) => `${x.id}${d}`));
  ok(idsPacote.every((id) => produtoPorId.has(id)), 'os quatro pacotes estão no catálogo');

  // A invariante do produto: um pacote NUNCA pode custar mais que comprar os boosts avulsos.
  // Ela é o que sobra de pé se alguém reajustar a tabela de boosts sem olhar para cá.
  for (const id of idsPacote) {
    const prod = produtoPorId.get(id);
    ok(prod.preco < prod.pacote.avulso,
      `${id} custa menos que os avulsos`, `${prod.preco} vs ${prod.pacote.avulso}`);
    ok(prod.pacote.economia === prod.pacote.avulso - prod.preco,
      `${id}: a economia anunciada bate com a conta`);
  }

  // Os preços pedidos pelo produto: 100 no kit de um dia, 600 no de sete.
  ok(produtoPorId.get('pacote_shiny_hunter_24h').preco === 100, 'Shiny Hunter 1d custa 100 💎');
  ok(produtoPorId.get('pacote_shiny_hunter_7d').preco === 600, 'Shiny Hunter 7d custa 600 💎');
  ok(produtoPorId.get('pacote_farmer_24h').preco === 100, 'Farmer 1d custa 100 💎');
  ok(produtoPorId.get('pacote_farmer_7d').preco === 600, 'Farmer 7d custa 600 💎');

  // O preço não é decorado: sai da soma dos avulsos com o desconto.
  ok(precoDoPacote(['captura', 'shiny'], '_24h') === 100, 'o preço sai da fórmula, não da mão');
  ok(somaAvulsaDoPacote(['xp', 'pokexp', 'loot'], '_24h')
     === TIPOS_BOOST.xp.precos[5] + TIPOS_BOOST.pokexp.precos[5] + TIPOS_BOOST.loot.precos[5],
    'a soma avulsa é a dos preços reais dos boosts');
  ok(DESCONTO_PACOTE > 0 && DESCONTO_PACOTE < 1, 'o desconto é uma fração sã');

  // Só o de 7 dias carrega a segunda comparação ("contra 7 dias soltos").
  ok(produtoPorId.get('pacote_farmer_7d').pacote.economiaSemanaPct > 0,
    'o kit de 7 dias anuncia a economia contra 7 dias soltos');
  ok(produtoPorId.get('pacote_farmer_24h').pacote.economiaSemanaPct === null,
    'e o de 1 dia não anuncia — a comparação não faria sentido');
  ok(produtoPorId.get('pacote_farmer_7d').pacote.economiaSemanaPct
     > produtoPorId.get('pacote_farmer_7d').pacote.economiaPct,
    'a comparação com 7 dias soltos desconta mais que a com o avulso de 7d');
}

secao('Pacote: o que ele liga');
{
  const p = jogador();
  const r = comprar(p, 'pacote_farmer_24h', T0);
  ok(r.ok, 'o Pacote Farmer compra');
  ok(p.diamonds === 900, 'cobrando 100 💎', `${p.diamonds}`);
  ok(multXpTreinador(p, T0) > 1, 'ligou o XP do treinador');
  ok(multXpPokemon(p, T0) > 1, 'ligou o XP do pokémon');
  ok(bonusLootPct(p, T0) > 0, 'ligou o loot');
  ok(multCaptura(p, T0) === 1, 'e NÃO ligou captura, que não vem neste kit');
  ok(p.boosts.xp === T0 + 24 * H, 'a duração é a de 24h do card avulso', `${p.boosts.xp - T0}`);

  // "Não acumula": comprar de novo ESTENDE, como o boost avulso.
  comprar(p, 'pacote_farmer_24h', T0 + H);
  ok(p.boosts.xp === T0 + 48 * H, 'o segundo pacote estende em vez de reiniciar', `${p.boosts.xp - T0}`);
}

secao('Pacote: sem cota diária, compra depois de vários avulsos');
{
  const p = jogador();
  for (let i = 0; i < 8; i++) comprar(p, 'boost_loot_24h', T0);
  const r = comprar(p, 'pacote_farmer_24h', T0);
  ok(r.ok, 'o pacote passa mesmo depois de oito Loot Boosts no dia', r.erro);
}

// -------------------------------------------------------------- nome

secao('Troca de nome');
{
  const p = jogador();
  const r = comprar(p, 'name', T0, { nome: 'ab' });
  ok(!r.ok && /inválido/.test(r.erro), 'nome curto demais é recusado');
  ok(p.diamonds === 1000, 'e não cobra');

  ok(!comprar(p, 'name', T0, { nome: 'nome com espaço' }).ok, 'nome com espaço é recusado');
  p.nick = 'Tester';
  ok(!comprar(p, 'name', T0, { nome: 'Tester' }).ok, 'nome igual ao atual é recusado');

  const r2 = comprar(p, 'name', T0, { nome: 'AshKetchum' });
  ok(r2.ok, 'nome válido passa');
  ok(r2.nomePedido === 'AshKetchum', 'e o nome pedido volta para quem grava no banco');
  ok(p.diamonds === 994, 'cobrando os 6 diamantes', `${p.diamonds}`);
}

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
