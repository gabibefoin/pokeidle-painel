// AS CAIXAS DO MARKET — o ralo de Coins, sem banco e sem Redis.
//
// O que este teste protege, em ordem de importância:
//
//   1. a caixa NÃO IMPRIME DINHEIRO. Nenhum prêmio é Coin, diamante ou gema, e todo id da
//      tabela existe de verdade no catálogo do jogo (um id errado creditaria um item fantasma);
//   2. os ids dos prêmios continuam sendo os mesmos do servidor — a cópia em `shared/` é
//      conferida contra os donos originais (`BOSS_TOKEN_ID`, `FRAGMENTO_*`, `PIECE_*`,
//      `BEAST_BALL`);
//   3. UM PRÊMIO POR CAIXA, e a tabela somando exatamente 100%. É a promessa que a tela faz no
//      "Ver Conteúdo": a porcentagem ao lado de cada linha é a chance dela sair. Se a soma
//      escorregar, a tela passa a mentir;
//   4. o PORTÃO DO VIP: a caixa de diamante dobra a chance dos lendários e não pode abrir para
//      quem não é VIP, por mais que o cliente peça;
//   5. o preço: a quantidade multiplica Coins E diamante, e o relato de milhares de caixas
//      cabe em dezesseis linhas (`agruparPremios`) sem perder nem inventar quantidade;
//   6. o equilíbrio desenhado em 17/09/2026 (quanto custa, em Coins, cada item raro) — se
//      alguém mexer nas tabelas, o número muda aqui antes de mudar no servidor;
//   7. a compra em si: cobra o ouro, credita o prêmio na memória, audita, e recusa quem não pode.
//
//   node tools/teste-caixas-npc.mjs
import { readFileSync } from 'node:fs';
import { itens, bolas } from '../src/server/content.mjs';
import { BOSS_TOKEN_ID } from '../src/server/game/bosses.mjs';
import { FRAGMENTO_BICICLETA_ID, FRAGMENTO_CHAVE_ID, FRAGMENTO_SHINY_ID } from '../src/server/game/itens-nossos.mjs';
import { BEAST_BALL } from '../src/server/game/loja.mjs';
import {
  CAIXAS, PREMIOS, QTD_MAX, TIER_COMUM, TIER_LENDARIO, TIER_RARO,
  abrirCaixa, abrirCaixas, agruparPremios, caixaPorId, conteudoDaCaixa, custoDaCaixa,
  limitarQtdCaixa, melhorTier,
  BEAST_BALL_ID, BOSS_TOKEN_ID as BOSS_TOKEN_COPIA, FRAG_BICICLETA_ID, FRAG_CHAVE_ID,
  FRAG_SHINY_ID,
} from '../src/shared/caixas-npc.mjs';
import { comprarCaixa, ErroCaixa } from '../src/server/game/caixas-npc.mjs';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};
const secao = (s) => console.log(`\n${s}`);
const erroDe = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const milhoes = (n) => `${(n / 1e6).toFixed(1)}M`;
const linhaDe = (caixaId, id) => conteudoDaCaixa(caixaId).find((l) => l.id === id);

/** Sorteio determinístico (mulberry32): a mesma sequência em toda execução. */
function prng(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------ os ids
secao('Os ids dos prêmios');
{
  const pares = [
    ['Bronze Boss Token', BOSS_TOKEN_COPIA, BOSS_TOKEN_ID],
    ['Fragmento de Chave', FRAG_CHAVE_ID, FRAGMENTO_CHAVE_ID],
    ['Fragmento de Shiny', FRAG_SHINY_ID, FRAGMENTO_SHINY_ID],
    ['Fragmento de Bicicleta', FRAG_BICICLETA_ID, FRAGMENTO_BICICLETA_ID],
    ['Beast Ball', BEAST_BALL_ID, BEAST_BALL.id],
  ];
  for (const [nome, copia, original] of pares) {
    ok(copia === original, `${nome}: a cópia em shared bate com o servidor (${copia})`, `${copia} ≠ ${original}`);
  }

  for (const premio of PREMIOS) {
    const existe = premio.tipo === 'bola' ? bolas.some((x) => x.id === premio.id) : itens.has(premio.id);
    ok(existe, `prêmio ${premio.tipo}:${premio.id} existe no catálogo do jogo`);
  }
}

// ------------------------------------------------- nada de dinheiro
secao('A caixa não imprime dinheiro');
{
  const tipos = new Set();
  const ids = new Set();
  const formas = new Set();
  const conhecidos = new Set(PREMIOS.map((x) => x.id));
  const dado = prng(1234);
  for (const caixa of CAIXAS) {
    for (let i = 0; i < 4000; i++) {
      const premio = abrirCaixa(caixa.id, dado);
      tipos.add(premio.tipo);
      ids.add(premio.id);
      formas.add(Object.keys(premio).sort().join(','));
    }
  }
  ok([...tipos].every((x) => x === 'bola' || x === 'item'), 'todo prêmio é bola ou item', [...tipos].join(', '));
  ok([...ids].every((x) => conhecidos.has(x)), 'e nenhum id fora da tabela', [...ids].filter((x) => !conhecidos.has(x)).join(', '));
  ok([...formas].every((f) => f === 'id,qtd,tier,tipo'),
    'o prêmio tem só tipo, id, qtd e raridade — não há campo de moeda', [...formas].join(' | '));

  // Só o CÓDIGO, não os comentários: a regra é que nada aqui aumente uma moeda. `p.diamonds =`
  // é o saldo que o ledger devolveu depois de COBRAR, e por isso a busca é por `+=` e por
  // chamada de função que credite.
  const mod = readFileSync(new URL('../src/server/game/caixas-npc.mjs', import.meta.url), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  ok(!/\bp\.(gold|diamonds|orbs)\s*\+=/.test(mod), 'e o módulo do servidor nunca soma ouro, diamante ou gema');
  ok(!/\b(somarGold|creditarOuro|creditarGold|darGold|adicionarGold|creditarDiamantes)\s*\(/.test(mod),
    'nem chama quem credita moeda');
}

// ------------------------------------------------------------ as caixas
secao('As duas caixas');
{
  ok(CAIXAS.length === 2, 'são duas caixas', `${CAIXAS.length}`);
  ok(CAIXAS.map((c) => c.id).join(',') === 'free,vip', 'a Free e a Diamante VIP', CAIXAS.map((c) => c.id).join(','));
  const free = caixaPorId('free');
  const vip = caixaPorId('vip');
  ok(free.coins === 3_000_000 && free.diamantes === 0 && free.vip === false,
    'a Free custa 3 milhões de Coins, sem diamante e sem exigir VIP');
  ok(vip.coins === 1_500_000 && vip.diamantes === 2 && vip.vip === true,
    'a VIP custa 1,5 milhão + 2 diamantes e exige VIP ativo');
  ok(free.mult === 1 && vip.mult === 2, 'e a VIP dobra a chance das raras (×2)', `${free.mult} / ${vip.mult}`);
  ok(caixaPorId('iii') === null && caixaPorId(3) === null && custoDaCaixa('nada', 1) === null,
    'as caixas III, IV e V não existem mais');
  ok(free.plate === 'iron' && vip.plate === 'splash', 'cada uma tem o seu ícone de plate');

  // A COMPOSIÇÃO dos degraus. As peças de TM saíram (são o prêmio do boss — vender a peça na
  // caixa tirava o motivo de lutar contra ele) e o Bronze Boss Token subiu para lendário, porque
  // o que ele dá é a ENTRADA nessa luta.
  const tierDe = (id) => PREMIOS.find((x) => x.id === id)?.tier;
  ok(!PREMIOS.some((x) => x.id === 59194 || x.id === 40530), 'as peças de TM não saem mais da caixa');
  ok(tierDe(BOSS_TOKEN_COPIA) === TIER_LENDARIO, 'o Bronze Boss Token é lendário');
  ok(tierDe(BEAST_BALL_ID) === TIER_RARO, 'e a Beast Ball é a rara');
  ok(PREMIOS.filter((x) => x.tier === TIER_RARO).length === 1, 'o degrau raro tem um item só');
  ok(PREMIOS.filter((x) => x.tier === TIER_LENDARIO).length === 4,
    'e o lendário tem quatro: os três fragmentos e o token');
}

// ------------------------------------------------------- a tabela
secao('A tabela: um prêmio por caixa, somando 100%');
{
  for (const caixa of CAIXAS) {
    const tabela = conteudoDaCaixa(caixa.id);
    const soma = tabela.reduce((s, l) => s + l.chance, 0);
    ok(Math.abs(soma - 1) < 1e-12, `a tabela da caixa ${caixa.id} soma exatamente 100%`, `${soma}`);
    ok(tabela.length === PREMIOS.length, `e mostra todos os ${PREMIOS.length} prêmios`, `${tabela.length}`);
    ok(tabela.every((l) => l.chance > 0), 'nenhum prêmio tem chance zero (a tela não anuncia o impossível)');
    ok(tabela.every((l) => l.qtd > 0 && Number.isInteger(l.qtd)), 'e toda quantidade é inteira e positiva');
  }

  const sorte = (id) => conteudoDaCaixa(id).filter((l) => l.tier !== TIER_COMUM).reduce((s, l) => s + l.chance, 0);
  ok(Math.abs(sorte('vip') - sorte('free') * 2) < 1e-12,
    'a fatia de sorte da VIP é exatamente o dobro da Free', `${sorte('free')} → ${sorte('vip')}`);
  for (const premio of PREMIOS.filter((p) => p.tier !== TIER_COMUM)) {
    const f = linhaDe('free', premio.id).chance;
    const v = linhaDe('vip', premio.id).chance;
    ok(Math.abs(v - f * 2) < 1e-15, `${premio.tipo}:${premio.id} dobra na VIP (${(f * 100).toFixed(3)}% → ${(v * 100).toFixed(3)}%)`);
  }
  for (const premio of PREMIOS.filter((p) => p.tier === TIER_COMUM)) {
    ok(linhaDe('vip', premio.id).chance < linhaDe('free', premio.id).chance,
      `e o comum ${premio.tipo}:${premio.id} encolhe na mesma medida`);
  }

  // A ordem da tabela é a ordem do sorteio: as duas pontas leem a mesma lista.
  const tabela = conteudoDaCaixa('free');
  ok(abrirCaixa('free', () => 0).id === tabela[0].id, 'o sorteio no 0 cai na primeira linha da tabela');
  ok(abrirCaixa('free', () => 0.999999).id === tabela.at(-1).id, 'e no fim cai na última');
  const naSoma = tabela.slice(0, 7).reduce((s, l) => s + l.chance, 0);
  ok(abrirCaixa('free', () => naSoma + 1e-9).id === tabela[7].id, 'e uma fatia no meio cai na linha dela');

  const um = abrirCaixa('free', prng(9));
  ok(um && !Array.isArray(um) && um.qtd > 0, 'abrirCaixa devolve UM prêmio, não uma lista');
  ok([TIER_COMUM, TIER_RARO, TIER_LENDARIO].includes(um.tier), 'e ele vem com a raridade');
  ok(abrirCaixa('nao-existe', prng(9)) === null, 'caixa inventada não sorteia nada');
}

// ------------------------------------------------------------ o preço
secao('O preço e a quantidade');
{
  // O teto é o MESMO do resto do jogo (`shop.buy`, `maxCompraPorOuro`). Quem limita de verdade
  // é o bolso: a 3.000.000 por caixa, os 3 bilhões do topo do servidor dão 1.000 caixas.
  ok(QTD_MAX === 9999, 'o teto por clique é o 9999 do resto do Market', `${QTD_MAX}`);
  ok(limitarQtdCaixa(0) === 1 && limitarQtdCaixa(1e9) === QTD_MAX && limitarQtdCaixa('x') === 1,
    `a quantidade forjada é presa entre 1 e ${QTD_MAX}`);

  const c1 = custoDaCaixa('vip', 1);
  const c10 = custoDaCaixa('vip', 10);
  ok(c10.coins === c1.coins * 10, 'dez caixas custam dez vezes o ouro');
  ok(c10.diamantes === c1.diamantes * 10, 'E dez vezes o diamante — são dez caixas, não um desconto');
  ok(custoDaCaixa('free', 7).diamantes === 0, 'a Free nunca cobra diamante');
  ok(custoDaCaixa('free', QTD_MAX).coins === 3_000_000 * QTD_MAX, 'e o preço acompanha até o teto');

  ok(abrirCaixas('free', 10, prng(3)).length === 10, 'dez caixas dão dez prêmios');
  ok(abrirCaixas('free', 1e9, prng(3)).length === QTD_MAX, 'e a quantidade forjada é presa aqui também');

  // O AGRUPAMENTO: mil caixas não viram mil linhas no pacote. É só o relato que junta — o
  // sorteio continua sendo um por caixa, e a conta tem de fechar dos dois lados.
  const cru = abrirCaixas('free', 3000, prng(11));
  const junto = agruparPremios(cru);
  ok(cru.length === 3000, 'três mil caixas, três mil sorteios');
  ok(junto.length <= PREMIOS.length, `e no máximo ${PREMIOS.length} linhas de relato`, `${junto.length}`);
  ok(junto.reduce((s, x) => s + x.qtd, 0) === cru.reduce((s, x) => s + x.qtd, 0),
    'o agrupamento não perde nem inventa quantidade');
  ok(junto.reduce((s, x) => s + x.vezes, 0) === cru.length,
    'e `vezes` soma exatamente o número de caixas abertas');
  ok(agruparPremios(abrirCaixas('free', 1, prng(5))).every((x) => x.vezes === 1),
    'com uma caixa só, a linha é a de sempre');
  ok(agruparPremios([]).length === 0 && agruparPremios(null).length === 0, 'e lista vazia agrupa em nada');
  ok(melhorTier([{ tier: TIER_COMUM }, { tier: TIER_LENDARIO }, { tier: TIER_RARO }]) === TIER_LENDARIO
    && melhorTier([{ tier: TIER_COMUM }, { tier: TIER_RARO }]) === TIER_RARO
    && melhorTier([{ tier: TIER_COMUM }]) === TIER_COMUM,
  'a festa da tela segue o melhor prêmio da leva');
}

// ------------------------------------------------------ a estatística
secao('O sorteio sai como a tabela promete');
{
  const dado = prng(20260917);
  const N = 200_000;
  const conta = new Map();
  for (let i = 0; i < N; i++) {
    const premio = abrirCaixa('free', dado);
    conta.set(premio.id, (conta.get(premio.id) ?? 0) + 1);
  }
  for (const id of [BOSS_TOKEN_COPIA, BEAST_BALL_ID, 1, 4]) {
    const obtido = (conta.get(id) ?? 0) / N;
    const esperado = linhaDe('free', id).chance;
    ok(Math.abs(obtido - esperado) < 0.005,
      `${id}: sai perto do anunciado (${(obtido * 100).toFixed(2)}% vs ${(esperado * 100).toFixed(2)}%)`);
  }
  const lendarios = [...conta].filter(([id]) => PREMIOS.find((p) => p.id === id)?.tier === TIER_LENDARIO)
    .reduce((s, [, n]) => s + n, 0) / N;
  const esperado = conteudoDaCaixa('free').filter((l) => l.tier === TIER_LENDARIO).reduce((s, l) => s + l.chance, 0);
  ok(Math.abs(lendarios - esperado) < 0.002,
    `o lendário inteiro sai em ${(lendarios * 100).toFixed(3)}% (tabela: ${(esperado * 100).toFixed(3)}%)`);
}

// ------------------------------------------------------- o equilíbrio
secao('O equilíbrio desenhado (Coins por item raro)');
{
  const coinsPor = (caixaId, id) => caixaPorId(caixaId).coins / linhaDe(caixaId, id).chance;

  const fragFree = coinsPor('free', FRAG_CHAVE_ID);
  const fragVip = coinsPor('vip', FRAG_CHAVE_ID);
  ok(Math.round(fragFree) === 3_750_000_000, `um fragmento custa 3,75 bilhões de Coins na Free (${milhoes(fragFree)})`);
  ok(Math.round(fragVip) === 937_500_000, `e 937,5 milhões na VIP, mais 1.250 diamantes (${milhoes(fragVip)})`);

  const tokenFree = coinsPor('free', BOSS_TOKEN_COPIA);
  ok(Math.round(tokenFree / 1e6) === 75, `um Bronze Boss Token custa 75 milhões na Free (${milhoes(tokenFree)})`);
  // Farmar o token custa ~1,5 milhão de Coins em abates da Outland (ver MECANICAS §6b).
  ok(tokenFree > 1.5e6 * 40,
    'e a caixa é ~50 vezes mais cara que farmar o mesmo token — ela vende sorte, não desconto');
  // Na VIP o ouro é a metade e a chance o dobro: o token sai a 1/4 do ouro da Free. Ainda tem de
  // custar bem mais que farmar, com os diamantes por fora — senão a VIP vira atalho, e não sorte.
  const tokenVip = coinsPor('vip', BOSS_TOKEN_COPIA);
  ok(tokenVip > 1.5e6 * 10, `e mesmo na VIP ele sai a ${milhoes(tokenVip)} de ouro, mais de dez vezes o farm`);

  // O RETORNO: quanto, em Coins de farm, uma abertura devolve em média. Abaixo de 100% a caixa é
  // um ralo; acima, seria uma torneira. Este é o número que justifica a feature existir.
  const valor = new Map([
    [FRAG_CHAVE_ID, 146e6], [FRAG_SHINY_ID, 146e6], [FRAG_BICICLETA_ID, 146e6],
    [BOSS_TOKEN_COPIA, 1.46e6],
    [BEAST_BALL_ID, 0], // não se compra com Coin em lugar nenhum: vale 0 na régua de ouro
    [1, 5], [2, 20], [3, 50], [4, 130], [205, 600], [206, 5000], [203, 800], [204, 1500], [70070, 2500],
  ]);
  const retorno = (id) => conteudoDaCaixa(id)
    .reduce((s, l) => s + l.chance * l.qtd * (valor.get(l.id) ?? 0), 0) / caixaPorId(id).coins;
  // 18/09/2026: a Free foi a 3 milhões e a VIP a 1,5 milhão + 2 diamantes (eram 5 milhões as
  // duas). Na Free ~84% de cada abertura vira fumaça; na VIP ~42% — o diamante paga o resto.
  const rFree = retorno('free');
  const rVip = retorno('vip');
  ok(rFree < 0.2, `a Caixa Free devolve ${(rFree * 100).toFixed(1)}% do preço em valor de farm`);
  ok(rFree > 0.05, 'e não é zero: o chão comum ainda devolve alguma coisa');
  ok(rVip > rFree, 'a VIP devolve mais (o diamante paga a diferença)', `${(rVip * 100).toFixed(0)}%`);
  // A invariante que não pode cair: as DUAS são ralo. Acima de 100% a caixa viraria torneira —
  // cada abertura criaria valor em vez de queimar ouro.
  ok(rVip < 1, `e a VIP continua um ralo: devolve ${(rVip * 100).toFixed(1)}% do ouro que cobra`);

  // A CADÊNCIA: de quantas em quantas caixas acontece alguma coisa boa. Abaixo de uma a cada
  // vinte, a caixa vira um botão de perder dinheiro; acima de uma a cada cinco, a festa cansa.
  const bom = conteudoDaCaixa('free').filter((l) => l.tier !== TIER_COMUM).reduce((s, l) => s + l.chance, 0);
  ok(bom > 1 / 20 && bom < 1 / 4,
    `sai algo raro ou lendário a cada ${(1 / bom).toFixed(1)} caixas`, `${(bom * 100).toFixed(2)}%`);
}

// --------------------------------------------------------- a compra
secao('A compra (o que sai do bolso e o que entra)');
{
  const jogador = (gold, { diamonds = 0, vip = false } = {}) => ({
    dbId: 77, nick: 'rico', gold, diamonds, items: {}, balls: {},
    vipAte: vip ? Date.now() + 86_400_000 : 0,
  });
  const ganchos = (p) => {
    const linhas = [];
    return {
      linhas,
      debitarOuro: (coins) => {
        const saiu = Math.min(coins, p.gold);
        p.gold -= saiu;
        return saiu;
      },
      auditar: (detalhe, ref) => linhas.push(`${ref} ${detalhe}`),
    };
  };

  const p = jogador(20_000_000);
  const g = ganchos(p);
  const r = await comprarCaixa(p, { caixaId: 'free', qtd: 1 }, g);
  ok(p.gold === 17_000_000, 'os 3 milhões saíram do ouro', `${p.gold}`);
  ok(r.premios.length === 1, 'e UMA caixa devolveu UM prêmio', `${r.premios.length}`);
  const creditado = Object.values(p.items).reduce((s, v) => s + v, 0)
    + Object.values(p.balls).reduce((s, v) => s + v, 0);
  ok(creditado === r.premios[0].qtd, 'o que saiu foi creditado na memória');
  ok(r.tier === r.premios[0].tier, 'a resposta diz a raridade, para a tela saber o tamanho da festa');
  ok(g.linhas.length === 1 && g.linhas[0].startsWith('caixa:free:1'), 'a abertura deixou uma linha de auditoria');
  ok(!('gold' in p.items) && p.diamonds === 0, 'e nada de moeda entrou de volta');

  // O "Máx" do card enche com o que o bolso paga: um jogador com 3 bilhões abre 1.000 de uma vez.
  const rico = jogador(3_000_000_000);
  const r2 = await comprarCaixa(rico, { caixaId: 'free', qtd: 1000 }, ganchos(rico));
  ok(r2.qtd === 1000 && rico.gold === 0, 'mil caixas num clique zeram três bilhões', `${rico.gold}`);
  ok(r2.premios.reduce((s, x) => s + x.vezes, 0) === 1000, 'e as mil viraram prêmio');
  ok(r2.premios.length <= PREMIOS.length, 'num relato de no máximo 16 linhas', `${r2.premios.length}`);
  ok(JSON.stringify(r2.premios).length < 4096, 'e num pacote de poucos KB', `${JSON.stringify(r2.premios).length} bytes`);

  // Forjar acima do teto não compra acima do teto — e nem acima do bolso.
  const forja = jogador(20_000_000);
  const r3 = await comprarCaixa(forja, { caixaId: 'free', qtd: 1e9 }, ganchos(forja)).catch((e) => e);
  ok(r3 instanceof ErroCaixa && r3.message === 'caixa.recusa.semCoins',
    'pedir 1 bilhão de caixas com 20 milhões no bolso é recusado');
  ok(forja.gold === 20_000_000, 'e o ouro não é tocado');

  const pobre = jogador(999_999);
  const e1 = await erroDe(() => comprarCaixa(pobre, { caixaId: 'free', qtd: 1 }, ganchos(pobre)));
  ok(e1 instanceof ErroCaixa && e1.message === 'caixa.recusa.semCoins', 'sem Coins, a caixa não abre');
  ok(pobre.gold === 999_999, 'e o ouro dele não foi tocado');

  // O PORTÃO DO VIP — o teste que mais importa aqui: quem não é VIP não abre a caixa que dobra
  // a chance dos lendários, nem mandando o comando na mão.
  const semVip = jogador(1e9, { diamonds: 1000 });
  const e2 = await erroDe(() => comprarCaixa(semVip, { caixaId: 'vip', qtd: 1 }, ganchos(semVip)));
  ok(e2 instanceof ErroCaixa && e2.message === 'caixa.recusa.soVip', 'sem VIP, a Caixa Diamante é recusada');
  ok(semVip.gold === 1e9 && semVip.diamonds === 1000, 'e nem o ouro nem o diamante foram tocados');

  const vipVencido = { ...jogador(1e9, { diamonds: 1000 }), vipAte: Date.now() - 1 };
  const e3 = await erroDe(() => comprarCaixa(vipVencido, { caixaId: 'vip', qtd: 1 }, ganchos(vipVencido)));
  ok(e3 instanceof ErroCaixa && e3.message === 'caixa.recusa.soVip', 'VIP vencido também é recusado');

  const semDia = jogador(50_000_000, { vip: true });
  const e4 = await erroDe(() => comprarCaixa(semDia, { caixaId: 'vip', qtd: 1 }, ganchos(semDia)));
  ok(e4 instanceof ErroCaixa && e4.message === 'caixa.recusa.semDiamantes',
    'VIP sem diamante também não abre — e o ledger nem foi chamado');
  ok(semDia.gold === 50_000_000, 'o ouro não foi cobrado antes do diamante');

  const e5 = await erroDe(() => comprarCaixa(jogador(1e9), { caixaId: 'caixa-fantasma' }, ganchos(jogador(1e9))));
  ok(e5 instanceof ErroCaixa && e5.message === 'caixa.recusa.invalida', 'caixa inventada é recusada');
}

secao('No fonte: a tela e o comando');
{
  const app = readFileSync(new URL('../src/client/app.js', import.meta.url), 'utf8');
  const cats = app.slice(app.indexOf('const CATEGORIAS_COMPRA = ['), app.indexOf('];', app.indexOf('const CATEGORIAS_COMPRA = [')));
  ok(cats.includes("{ id: 'caixas', nome: 'mk.caixas' },"), 'Caixas é uma CATEGORIA da aba Compra (não uma aba)');
  ok(cats.indexOf("'caixas'") > cats.indexOf("'revives'"), 'e fica embaixo de Revives no menu lateral');
  const abas = app.slice(app.indexOf('const ABAS_MARKET = ['), app.indexOf('];', app.indexOf('const ABAS_MARKET = [')));
  ok(!abas.includes("'caixas'"), 'e não sobrou aba de Caixas no topo');

  ok(app.includes('const card = cardMarket({') && app.includes("chave: `caixa-${caixa.id}`,"),
    'a caixa usa o card padrão do Market (mesmo tamanho, mesmo contador)');
  ok(app.includes("else if (m.t === 'caixa.npc') aoReceberCaixaNpc(m);"), 'a resposta do servidor é despachada');
  ok(app.includes("enviar({ t: 'caixa.npc.abrir', caixaId: caixa.id, qtd: ctd.ler() });"),
    'o pedido leva só a caixa e a quantidade — o preço e o sorteio são do servidor');
  ok(app.includes('conteudoDaCaixa(caixa.id)'), 'o "Ver Conteúdo" lê a mesma tabela que o servidor sorteia');
  ok(app.includes("t('caixa.verConteudo')"), 'e o botão primário é o "Ver Conteúdo"');

  // A ABERTURA precisa comemorar o que merece: o palco muda de fase e o som segue a raridade.
  const abertura = app.slice(app.indexOf('function abrirAberturaDeCaixa('));
  ok(abertura.includes("palco.dataset.fase = 'aberta'"), 'a abertura tem os dois tempos (fechada → aberta)');
  ok(abertura.includes('tocarShinyCaptura()') && abertura.includes('tocarTmBossDrop()'),
    'lendário e raro têm som próprio');
  ok(abertura.includes('ab-raios') && abertura.includes('ab-confete'), 'e a festa usa os raios e o confete do jogo');

  // O PÉ DA FOLHA: as duas telas rolam (16 linhas de conteúdo, até 10 prêmios), e sem o aviso de
  // rolagem o último item aparece serrado no fim do quadro — que é o que parece defeito.
  const iConteudo = app.indexOf('function abrirConteudoDaCaixa(');
  const conteudoFn = app.slice(iConteudo, app.indexOf('\n}', iConteudo));
  ok(conteudoFn.includes('setaDeRolagem(corpo)'), 'o "Ver Conteúdo" avisa que tem mais para rolar');
  ok(abertura.includes('setaDeRolagem(corpo)') && abertura.includes('medir();'),
    'a abertura também — e remede depois do estouro, que é quando a lista nasce');
  const css = readFileSync(new URL('../src/client/estilo.css', import.meta.url), 'utf8');
  ok(/\.cm-folha-caixa\.tem-mais \.cm-rolo \{[^}]*mask-image/.test(css),
    'o conteúdo dissolve no pé em vez de ser cortado');
  ok(!/\.cm-folha-caixa\.tem-mais \.cm-rolo \{[^}]*padding/.test(css),
    'e nada que mude a altura entra junto — senão a lista pula ao chegar no fim');

  const sim = readFileSync(new URL('../src/server/sim.mjs', import.meta.url), 'utf8');
  const handlers = [...sim.matchAll(/^ {2}'caixa[^']*': \(p, m\) => \{/gm)].map((m) => m[0].trim());
  ok(new Set(handlers).size === handlers.length, 'nenhum comando de caixa foi sobrescrito por outro', handlers.join(' | '));
  ok(sim.includes("'caixa.abrir': (p, m) => {") && sim.includes("'caixa.npc.abrir': (p, m) => {"),
    'a Caixa de Fundador e a Caixa do Market são comandos diferentes');
  const bloco = sim.slice(sim.indexOf("'caixa.npc.abrir'"), sim.indexOf("'shop.sellItem'"));
  ok(bloco.includes('enfileirarEconomia(p'), 'a compra roda na fila de economia (dois cliques não leem o mesmo saldo)');

  const servidor = readFileSync(new URL('../src/server/game/caixas-npc.mjs', import.meta.url), 'utf8');
  ok(servidor.includes('if (caixa.vip && !vipAtivo(p, Date.now()))'),
    'o portão do VIP está no SERVIDOR, não só na tela');
  ok(servidor.indexOf('vipAtivo') < servidor.indexOf('gastarNaLoja'),
    'e ele vem antes de qualquer cobrança');
}

console.log(`\n${testes - falhas}/${testes} ok`);
if (falhas) console.log(`${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
