// VARREDURA DE SEGURANÇA das features novas: as Caixas do Market e a Área de Treinamento.
//
// Não é um teste de "funciona": é um teste de ATAQUE. Cada bloco aqui é um jogador hostil
// falando direto com o socket, sem passar pela tela — que é o único jeito realista de atacar
// este jogo, porque o cliente é aberto e o pacote é JSON.
//
// O que se procura, na ordem em que dói:
//
//   1. IMPRIMIR DINHEIRO — quantidade negativa, `Infinity`, string, array, saldo que muda no meio
//      da compra. O convite clássico é `qtd: -1`: se alguma conta multiplicar por um negativo, o
//      débito vira crédito. Aqui todo caminho é medido pela conservação: o que saiu da carteira
//      tem de bater, ao Coin, com o que entrou na mochila;
//   2. PULAR A CAIXA REGISTRADORA — abrir a caixa VIP sem VIP, pagar por uma e levar dez, pagar
//      menos do que a caixa custa;
//   3. GERAR POKÉMON, XP OU ITEM pelo Treinamento — um pokémon de mentira que vire linha no
//      banco, ou que saia da arena mais forte do que qualquer captura real consegue ser;
//   4. USAR O QUE NÃO É SEU — o id do pokémon de outra pessoa numa casa da bancada;
//   5. POLUIR O PROTÓTIPO — `__proto__` e `constructor` nos lugares onde o pacote vira objeto;
//   6. DERRUBAR O SERVIDOR — quanto custa, em CPU e em bytes, o pedido mais caro que um jogador
//      consegue formular.
//
//   node tools/teste-seguranca-caixas-treino.mjs
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { especies } from '../src/server/content.mjs';
import { IV_POR_STAT, POTENCIA_MAX, QUALIDADE_MAX } from '../src/shared/nota-pokemon.mjs';
import {
  CAIXAS, PREMIOS, QTD_MAX, TIER_COMUM,
  abrirCaixa, abrirCaixas, agruparPremios, caixaPorId, conteudoDaCaixa, custoDaCaixa,
  limitarQtdCaixa,
} from '../src/shared/caixas-npc.mjs';
import { comprarCaixa, ErroCaixa } from '../src/server/game/caixas-npc.mjs';
import { TREINO_MAX_LADO, normalizarLado, normalizarPokemonTeste } from '../src/shared/treino.mjs';
import { ErroTreino, lutaDeTreino, _testeMontarLado } from '../src/server/game/treino.mjs';

// O preço da Free, lido da regra: as contas de "pagou N, levou N" e de "dinheiro para três" são
// feitas em CAIXAS, não em Coins. Com o preço escrito à mão, a baixa de 5 para 3 milhões (v1.124.0)
// fez a conferência acusar furo onde não havia nenhum.
const PRECO_FREE = caixaPorId('free').coins;

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
const ler = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/**
 * O CATÁLOGO DE LIXO — o que um atacante realmente digita no console do navegador antes de
 * apertar enter. Cada um destes já derrubou alguma coisa em algum jogo.
 */
const LIXO = [
  ['negativo', -1],
  ['negativo gigante', -1e9],
  ['zero', 0],
  ['fração', 0.5],
  ['fração negativa', -0.4],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['-Infinity', -Infinity],
  ['string de número', '10'],
  ['string científica', '1e9'],
  ['string hexa', '0x10'],
  ['string com espaço', '  7  '],
  ['string vazia', ''],
  ['texto', 'dez'],
  ['acima do inteiro seguro', 9007199254740993],
  ['MAX_VALUE', Number.MAX_VALUE],
  ['array com número', [7]],
  ['array vazio', []],
  ['objeto', {}],
  ['objeto com valueOf', { valueOf: () => 1e9 }],
  ['null', null],
  ['undefined', undefined],
  ['true', true],
  ['false', false],
  ['bigint-ish', '99999999999999999999'],
];

// =====================================================================================
secao('1 · A superfície: o que um pacote do cliente alcança');
{
  const sim = ler('src/server/sim.mjs');

  // A porta de entrada. Só `comandos` é alcançável por pacote de jogador — e é por isso que
  // `market.devolver` (a entrega de anúncio vencido, que credita pokémon) não é atacável: ela é
  // mensagem de BARRAMENTO, entre sims.
  ok(sim.includes('if (msg.doCliente === true) {') && sim.includes('Object.hasOwn(comandos, msg.t)'),
    'pacote do cliente só alcança `comandos`, e por `Object.hasOwn`');
  const ingresso = sim.slice(sim.indexOf('if (msg.doCliente === true) {'));
  ok(ingresso.indexOf('return;') < ingresso.indexOf("msg.t === 'entrar'"),
    'e nunca chega às mensagens de servidor (`entrar`, `admin.*`, `market.devolver`)');
  ok(!/^ {2}'market\.devolver':/m.test(sim), 'market.devolver não é comando de cliente');

  const gw = ler('src/server/gateway.mjs');
  ok(gw.includes('{ ...msg, playerId: ws.playerId, doCliente: true }'),
    'o gateway carimba playerId DEPOIS do spread — o cliente não escolhe de quem é o pacote');
  ok(/maxPayload: 16 \* 1024/.test(gw), 'e o socket corta pacote acima de 16 KB');

  // Os dois comandos novos têm balde próprio: sem isso, o freio seria só o `geral` (20/s).
  const lim = ler('src/server/limites-ws.mjs');
  ok(/\['treino\.lutar', 'treino'\]/.test(lim) && /treino: \{ capacidade: 3/.test(lim),
    'treino.lutar tem balde próprio (3 de rajada)');
  ok(/\['caixa\.npc\.abrir', 'caixa'\]/.test(lim) && /caixa: \{ capacidade: 10/.test(lim),
    'caixa.npc.abrir tem balde próprio (10 de rajada)');
  // O balde vive num `Map` de módulo, criado UMA vez, e é indexado pelo `playerId` (o nick
  // minúsculo da conta). Se morasse no socket, fechar e reabrir a conexão daria um balde novo e
  // cheio — que é como se contorna limite de mensagem em quase todo jogo.
  ok(/^const limitesWs = criarLimites\(\);$/m.test(gw), 'o limitador é único no processo do gateway');
  ok(gw.includes('limitesWs.permitir(ws.playerId, categoria, t)'),
    'e a ficha é gasta na chave da CONTA — reconectar não zera o balde');
  ok(/function criarLimites\([^)]*\) \{\s*const contas = new Map\(\);/.test(lim),
    'o mapa dos baldes é do limitador, não do socket');
}

// =====================================================================================
secao('2 · Caixas: entrada hostil em `qtd` e `caixaId`');
{
  // A regra: seja qual for o lixo, a quantidade cai numa faixa de jogador — 1 ao teto.
  let tortos = [];
  for (const [nome, v] of LIXO) {
    const n = limitarQtdCaixa(v);
    if (!Number.isInteger(n) || n < 1 || n > QTD_MAX) tortos.push(`${nome}→${n}`);
  }
  ok(!tortos.length, `os ${LIXO.length} lixos viram quantidade entre 1 e ${QTD_MAX}`, tortos.join(', '));

  // E o PREÇO acompanha a quantidade, sempre positivo. Um custo negativo seria um crédito.
  tortos = [];
  for (const [nome, v] of LIXO) {
    for (const caixa of CAIXAS) {
      const c = custoDaCaixa(caixa.id, v);
      if (!(c.coins > 0) || !Number.isInteger(c.coins) || c.coins !== caixa.coins * c.qtd) {
        tortos.push(`${caixa.id}/${nome}→${c.coins}`);
      }
      if (c.diamantes < 0 || c.diamantes !== caixa.diamantes * c.qtd) tortos.push(`${caixa.id}/${nome}💎${c.diamantes}`);
    }
  }
  ok(!tortos.length, 'o custo nunca é negativo e sempre é preço × quantidade', tortos.join(', '));

  // O id da caixa: nomes de propriedade do Object são o teste clássico.
  const idsHostis = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty',
    '', ' free', 'FREE', 'free ', 0, -1, 1, 5, 'iii', 'vip\u0000', ['free'], {}, null, undefined,
    { toString: () => 'free' }];
  const aceitos = idsHostis.filter((id) => caixaPorId(id) !== null);
  ok(!aceitos.length, `nenhum dos ${idsHostis.length} ids hostis vira caixa`, JSON.stringify(aceitos));
  ok(caixaPorId('free') && caixaPorId('vip'), 'e os dois ids de verdade continuam valendo');

  // `abrirCaixa` com id hostil não pode devolver prêmio nenhum.
  const premiados = idsHostis.filter((id) => abrirCaixa(id, () => 0.5) !== null);
  ok(!premiados.length, 'e id hostil não sorteia prêmio', JSON.stringify(premiados));

  // A tabela hostil: `conteudoDaCaixa` é chamada pela TELA, mas também pelo sorteio.
  const tabelasTortas = idsHostis.filter((id) => conteudoDaCaixa(id).length !== 0);
  ok(!tabelasTortas.length, 'nem devolve tabela', JSON.stringify(tabelasTortas));
}

// =====================================================================================
secao('3 · Caixas: o sorteio não inventa prêmio');
{
  // O gerador é injetável — e um gerador HOSTIL é o jeito de varrer as bordas da tabela.
  const bordas = [0, -1, -1e9, 1, 1.0000001, 2, 1e9, NaN, Infinity, -Infinity, 0.9999999999999999];
  const ruins = [];
  const conhecidos = new Set(PREMIOS.map((p) => `${p.tipo}:${p.id}`));
  for (const caixa of CAIXAS) {
    for (const n of bordas) {
      const premio = abrirCaixa(caixa.id, () => n);
      if (!premio) { ruins.push(`${caixa.id}/${n}→null`); continue; }
      if (!conhecidos.has(`${premio.tipo}:${premio.id}`)) ruins.push(`${caixa.id}/${n}→${premio.tipo}:${premio.id}`);
      if (!(premio.qtd > 0) || !Number.isInteger(premio.qtd)) ruins.push(`${caixa.id}/${n}→qtd ${premio.qtd}`);
    }
  }
  ok(!ruins.length, 'sorteio fora da faixa [0,1) ainda cai numa linha real da tabela', ruins.join(', '));

  // A quantidade de prêmios é EXATAMENTE a de caixas pagas. "Pagar 1 e levar 10" mora aqui.
  const descasados = [];
  for (const [nome, v] of LIXO) {
    const n = limitarQtdCaixa(v);
    const premios = abrirCaixas('free', v, () => 0.5);
    if (premios.length !== n) descasados.push(`${nome}: pagou ${n} levou ${premios.length}`);
  }
  ok(!descasados.length, 'sai um prêmio por caixa paga, para todo lixo', descasados.join(', '));
}

// =====================================================================================
secao('4 · Poluição de protótipo');
{
  const sujo = JSON.parse('{"__proto__":{"invadido":true},"constructor":{"prototype":{"invadido2":true}}}');

  caixaPorId(sujo);
  custoDaCaixa(sujo, sujo);
  abrirCaixas('free', sujo, () => 0.5);
  normalizarPokemonTeste(JSON.parse('{"speciesId":1,"ivs":{"__proto__":{"invadido3":true}}}'));
  normalizarLado(JSON.parse('[{"teste":{"speciesId":1,"__proto__":{"invadido4":true}}}]'));
  normalizarLado(sujo);

  ok(({}).invadido === undefined && ({}).invadido2 === undefined
    && ({}).invadido3 === undefined && ({}).invadido4 === undefined,
  'nenhum caminho suja Object.prototype');

  // O pokémon de teste sai com chaves conhecidas e nada mais: um campo extra é um campo que
  // alguém, um dia, lê sem conferir.
  const t = normalizarPokemonTeste(JSON.parse(
    '{"speciesId":1,"refino":{"atk":999},"tmElemental":"fire","dono":7,"id":123,"admin":true}',
  ));
  ok(Object.keys(t).sort().join(',') === 'ivs,level,potencia,qualidade,shiny,speciesId',
    'a peneira devolve só os seis campos — refino, tm, id e dono forjados somem', Object.keys(t).join(','));
  ok(Object.keys(t.ivs).sort().join(',') === 'atk,def,hp,spAtk,spDef,speed',
    'e os IVs só têm os seis stats');
}

// =====================================================================================
secao('5 · Treinamento: o pokémon forjado não passa do teto de uma captura real');
{
  const monstro = normalizarPokemonTeste({
    speciesId: 1,
    level: 1e12,
    shiny: 'sim',
    potencia: 99999,
    qualidade: 1e9,
    ivs: Object.fromEntries(['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'].map((k) => [k, 1e9])),
  });
  ok(Object.values(monstro.ivs).every((v) => v <= IV_POR_STAT.max && v >= IV_POR_STAT.min),
    `IV forjado é preso no teto de captura (${IV_POR_STAT.max})`, JSON.stringify(monstro.ivs));
  ok(monstro.potencia <= POTENCIA_MAX, `potência presa em ${POTENCIA_MAX}`, `${monstro.potencia}`);
  ok(monstro.qualidade <= QUALIDADE_MAX, `qualidade presa em ${QUALIDADE_MAX}`, `${monstro.qualidade}`);
  ok(monstro.level <= 9999, 'nível preso em 9999', `${monstro.level}`);

  const negativo = normalizarPokemonTeste({
    speciesId: 1, level: -1e9, potencia: -5, qualidade: -1e9,
    ivs: { hp: -99, atk: -1e9, def: NaN, spAtk: Infinity, spDef: '-5', speed: null },
  });
  ok(negativo.level >= 1 && negativo.potencia >= 1 && negativo.qualidade >= 0
    && Object.values(negativo.ivs).every((v) => v >= IV_POR_STAT.min),
  'e valores negativos viram o PISO, não um stat invertido', JSON.stringify(negativo));

  // Espécie: só o catálogo manda. Espécie inventada não pode virar lutador.
  const especiesHostis = [0, -1, 1e9, 99999, NaN, Infinity, '__proto__', 'constructor', null, {}, []];
  const passaram = especiesHostis.filter((id) => {
    const t = normalizarPokemonTeste({ speciesId: id });
    return t && especies.has(t.speciesId);
  });
  ok(!passaram.length, 'nenhuma espécie inventada existe no catálogo', JSON.stringify(passaram));

  const jogador = { dbId: 1, pokemons: new Map() };
  const montado = _testeMontarLado(jogador, especiesHostis.map((id) => ({ teste: { speciesId: id } })));
  ok(montado.length === 0, 'e o lado montado com elas fica vazio', `${montado.length}`);
}

// =====================================================================================
secao('6 · Treinamento: usar o que não é seu (IDOR)');
{
  const meuPk = {
    id: 10, speciesId: 1, level: 50, ivs: { hp: 10, atk: 10, def: 10, spAtk: 10, spDef: 10, speed: 10 },
    quality: 1, potencia: 1, shiny: false, refino: null, tmElemental: null,
  };
  const jogador = { dbId: 1, pokemons: new Map([[10, meuPk]]) };

  // A peneira CORTA em 5 casas antes de olhar o conteúdo, então o teste vai em levas de 5 —
  // um id válido na sexta posição sumiria por ter sido cortado, não por ser inválido.
  const alheios = [11, 999999, -1, 0, 1e15, NaN, Infinity, null, {}, [], '999', -0.4, 1e308];
  const entraram = [];
  for (let i = 0; i < alheios.length; i += TREINO_MAX_LADO) {
    const leva = alheios.slice(i, i + TREINO_MAX_LADO).map((id) => ({ meu: id }));
    entraram.push(..._testeMontarLado(jogador, leva));
  }
  ok(entraram.length === 0, 'nenhum id alheio ou torto vira lutador', `${entraram.length}`);
  ok(_testeMontarLado(jogador, [{ meu: '10' }]).length === 1,
    'e o id DELE entra mesmo vindo como string (o JSON do cliente é solto)');

  const soAlheios = _testeMontarLado(jogador, [{ meu: 11 }, { meu: 12 }, { meu: 999999 }]);
  ok(soAlheios.length === 0, 'id de outro jogador não vira lutador', `${soAlheios.length}`);

  // O id que entra na arena é NEGATIVO: não casa com linha nenhuma do banco, em lugar nenhum.
  const meus = _testeMontarLado(jogador, [{ meu: 10 }, { meu: 10 }]);
  ok(meus.every((x) => x.id < 0), 'os lutadores recebem ids negativos', JSON.stringify(meus.map((x) => x.id)));
  ok(new Set(meus.map((x) => x.id)).size === meus.length, 'e nunca repetidos');
  ok(meus.every((x) => !('dono' in x) && !('playerId' in x) && !('slot' in x)),
    'a cópia não leva dono nem slot');

  // O corte de 5 acontece antes de qualquer trabalho: mil casas não são mil simulações.
  const mil = _testeMontarLado(jogador, Array.from({ length: 1000 }, () => ({ meu: 10 })));
  ok(mil.length === TREINO_MAX_LADO, `mil casas viram ${TREINO_MAX_LADO}`, `${mil.length}`);
  ok(normalizarLado(Array.from({ length: 100_000 }, () => ({ meu: 1 }))).length === TREINO_MAX_LADO,
    'e cem mil também — o corte é na peneira, não depois');
  for (const [nome, v] of LIXO) {
    if (normalizarLado(v).length !== 0) { ok(false, `lado ${nome} deveria virar vazio`); break; }
  }
  ok(normalizarLado('xxx').length === 0 && normalizarLado({ length: 5 }).length === 0,
    'lado que não é array vira vazio');
}

// =====================================================================================
secao('7 · Treinamento: nada é gerado e nada é tocado');
{
  // O pokémon do jogador vai CONGELADO para a bancada. Se qualquer caminho tentar escrever nele
  // (HP, XP, nocaute, refino compartilhado por referência), o modo estrito do ESM estoura.
  const congelar = (o) => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const v of Object.values(o)) congelar(v);
    }
    return o;
  };
  const especieReal = [...especies.keys()][0];
  const pk = congelar({
    id: 10, speciesId: especieReal, level: 100,
    ivs: { hp: 20, atk: 20, def: 20, spAtk: 20, spDef: 20, speed: 20 },
    quality: 1.2, potencia: 3, shiny: false,
    refino: { atk: 5, hp: 5 }, tmElemental: null,
  });
  const jogador = {
    dbId: 1, nick: 'alvo', looktype: 159, visual: null,
    pokemons: new Map([[10, pk]]),
    gold: 1000, diamonds: 5, xp: 0, items: {}, balls: {},
  };
  const antes = JSON.stringify({ gold: jogador.gold, dia: jogador.diamonds, xp: jogador.xp, itens: jogador.items, bolas: jogador.balls });

  const erro = await erroDe(() => lutaDeTreino(jogador, {
    a: [{ meu: 10 }],
    b: [{ teste: { speciesId: especieReal, level: 9999, potencia: 5, qualidade: 9, ivs: { hp: 32, atk: 32, def: 32, spAtk: 32, spDef: 32, speed: 32 } } }],
  }));
  ok(!erro, 'a batalha roda com o pokémon do jogador CONGELADO', erro?.message);

  const depois = JSON.stringify({ gold: jogador.gold, dia: jogador.diamonds, xp: jogador.xp, itens: jogador.items, bolas: jogador.balls });
  ok(antes === depois, 'nada de ouro, diamante, XP, item ou bola mudou');
  ok(jogador.pokemons.size === 1, 'nenhum pokémon nasceu no depot', `${jogador.pokemons.size}`);
  ok(jogador.pokemons.get(10) === pk, 'e o original é o mesmo objeto de antes');

  // O que SOBE para a tela não pode ter prêmio nenhum, nem dado de terceiro.
  const r = await lutaDeTreino(jogador, { a: [{ meu: 10 }], b: [{ meu: 10 }] });
  const campos = Object.keys(r).sort().join(',');
  ok(campos === 'arena,cooldownMs,duracaoMs,ladoA,ladoB,motivo,placar,replay,venceuA,versao',
    'a resposta tem só o que a fita precisa', campos);
  const texto = JSON.stringify(r);
  ok(!/"(xp|gold|coins|moedas|orbs|diamonds|premio|recompensa|drop|item)"/i.test(texto),
    'e nenhum campo de recompensa no corpo inteiro da resposta');
  ok(!texto.includes('"alvo"'), 'o nick do jogador não vai na fita — os lados são "A" e "B"');

  const fonte = ler('src/server/game/treino.mjs');
  const semComentario = fonte.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const proibidos = ['pool.query', 'inserirPokemon', 'somarGold', 'subtrairGold', 'marcarSujo',
    'p.items', 'p.balls', 'p.gold', 'p.xp', 'p.diamonds', 'p.pokemons.set', 'p.pokemons.delete'];
  const achados = proibidos.filter((x) => semComentario.includes(x));
  ok(!achados.length, 'o módulo do treino não sabe escrever em lugar nenhum', achados.join(', '));
}

// =====================================================================================
secao('8 · Caixas: a caixa registradora (autorização e conservação)');
{
  const jogador = (gold, { diamonds = 0, vip = false } = {}) => ({
    dbId: 77, nick: 'atacante', gold, diamonds, items: {}, balls: {},
    vipAte: vip ? Date.now() + 86_400_000 : 0,
  });
  const ganchos = (p) => {
    const linhas = [];
    return {
      linhas,
      debitarOuro: (coins) => {
        // O `subtrairGold` de verdade faz CLAMP em 0 — este gancho imita isso, que é o que
        // torna o "pagar menos" possível se ninguém conferir o retorno.
        const saiu = Math.max(0, Math.min(Math.floor(Number(coins)) || 0, p.gold));
        p.gold -= saiu;
        return saiu;
      },
      auditar: (detalhe, ref) => linhas.push(`${ref} ${detalhe}`),
    };
  };

  // ---- CONSERVAÇÃO: para todo lixo, o que saiu da carteira bate com o que entrou na mochila.
  const furos = [];
  for (const [nome, v] of LIXO) {
    const p = jogador(1e12);
    const r = await comprarCaixa(p, { caixaId: 'free', qtd: v }, ganchos(p)).catch((e) => e);
    if (r instanceof Error) { furos.push(`${nome}: ${r.message}`); continue; }
    const saiu = 1e12 - p.gold;
    // `premios` vem AGRUPADO (no máximo 16 linhas), então o que se conta é `vezes`: uma caixa
    // paga, um sorteio entregue. É esta soma que fecha "pagou N, levou N".
    const sorteios = r.premios.reduce((s, x) => s + x.vezes, 0);
    if (saiu !== r.qtd * PRECO_FREE) furos.push(`${nome}: saiu ${saiu} por ${r.qtd} caixas`);
    if (sorteios !== r.qtd) furos.push(`${nome}: ${sorteios} sorteios por ${r.qtd} caixas`);
    if (p.gold > 1e12) furos.push(`${nome}: OURO AUMENTOU`);
    if (p.diamonds !== 0) furos.push(`${nome}: diamante mudou`);
  }
  ok(!furos.length, `os ${LIXO.length} lixos cobram o preço cheio e não criam moeda`, furos.join(' | '));

  // ---- AUTORIZAÇÃO: a caixa que dobra os lendários exige VIP, e a checagem é do servidor.
  const semVip = jogador(1e12, { diamonds: 1e6 });
  const e1 = await erroDe(() => comprarCaixa(semVip, { caixaId: 'vip', qtd: 10 }, ganchos(semVip)));
  ok(e1 instanceof ErroCaixa && e1.message === 'caixa.recusa.soVip', 'sem VIP a caixa de diamante recusa');
  ok(semVip.gold === 1e12 && semVip.diamonds === 1e6, 'e nada saiu do bolso');

  const vencido = { ...jogador(1e12, { diamonds: 1e6 }), vipAte: Date.now() - 1 };
  const e2 = await erroDe(() => comprarCaixa(vencido, { caixaId: 'vip', qtd: 1 }, ganchos(vencido)));
  ok(e2 instanceof ErroCaixa && e2.message === 'caixa.recusa.soVip', 'VIP vencido por 1 ms também recusa');

  // `vipAte` forjado no pacote não existe: o campo é do servidor, não da mensagem.
  const forjado = jogador(1e12, { diamonds: 1e6 });
  const e3 = await erroDe(() => comprarCaixa(forjado, {
    caixaId: 'vip', qtd: 1, vip: true, vipAte: Date.now() + 1e9, loja: { vip: true },
  }, ganchos(forjado)));
  ok(e3 instanceof ErroCaixa && e3.message === 'caixa.recusa.soVip',
    'mandar `vip: true` no pacote não compra VIP');

  // ---- PAGAR MENOS: o saldo cai entre a conferência e a cobrança (é o que acontece quando
  // outra mensagem do mesmo jogador gasta ouro durante o `await` do ledger de diamante —
  // `amigo.coins`, por exemplo, não passa pela fila de economia).
  const p = jogador(50_000_000);
  const ganchoQueMinga = {
    debitarOuro: () => PRECO_FREE, // só uma caixa de ouro estava lá quando a cobrança chegou
    auditar: () => {},
  };
  const r = await comprarCaixa(p, { caixaId: 'free', qtd: 10 }, ganchoQueMinga).catch((e) => e);
  ok(r instanceof ErroCaixa,
    'saldo que mingou no meio da compra RECUSA a caixa (não entrega 10 por 1)',
    r instanceof Error ? r.message : `entregou ${r.premios?.length} prêmios por 1.000.000`);

  // ---- e o estorno: o que foi tirado antes da recusa volta.
  const p2 = jogador(50_000_000);
  let devolvido = 0;
  await comprarCaixa(p2, { caixaId: 'free', qtd: 10 }, {
    debitarOuro: () => PRECO_FREE,
    devolverOuro: (v) => { devolvido = v; },
    auditar: () => {},
  }).catch(() => {});
  ok(devolvido === PRECO_FREE, 'e o pedaço cobrado é estornado', `${devolvido}`);
}

// =====================================================================================
secao('9 · Caixas: a ordem da cobrança');
{
  // Sem comentários: procurar `await` num arquivo que EXPLICA onde não pode haver `await` acha
  // sempre a explicação. A regra vale para o código.
  const fonte = ler('src/server/game/caixas-npc.mjs')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const iVip = fonte.indexOf('vipAtivo(p, Date.now())');
  const iConfere = fonte.indexOf('if ((p.gold ?? 0) < custo.coins)');
  const iOuro = fonte.indexOf('const cobrado = debitarOuro(');
  const iLedger = fonte.indexOf('gastarNaLoja(');
  const iPremio = fonte.indexOf('const premios = agruparPremios(abrirCaixas(');
  ok(iVip > 0 && iVip < iOuro && iVip < iLedger, 'o VIP é conferido antes de qualquer cobrança');
  ok(iConfere > 0 && iOuro > iConfere && iOuro < iLedger,
    'o ouro sai ANTES do `await` do diamante — é o que fecha a janela do TOCTOU');
  ok(iLedger < iPremio, 'e o prêmio só é sorteado depois das duas cobranças');

  // A JANELA. Entre conferir o saldo e descontá-lo não pode haver `await`: é exatamente ali que
  // outra mensagem do mesmo jogador (`amigo.coins`, que não passa pela fila de economia) se
  // encaixava para esvaziar a carteira e levar dez caixas pelo que sobrou.
  ok(!/\bawait\b/.test(fonte.slice(iConfere, iOuro)),
    'e entre a conferência do saldo e o débito não há await nenhum');
  ok(/if \(cobrado !== custo\.coins\)/.test(fonte),
    'o retorno do débito é conferido — "cobrei o que deu" era a forma do buraco');
  ok(/devolverOuro\?\.\(cobrado\);\s*\n\s*throw new ErroCaixa\('caixa\.recusa\.semDiamantes'\)/.test(fonte),
    'e o ledger recusando devolve o ouro inteiro');

  // Do sorteio até o crédito, nada de await: ninguém vê o jogador pago e sem a caixa.
  ok(!/\bawait\b/.test(fonte.slice(iPremio, fonte.indexOf('auditar(', iPremio))),
    'do sorteio ao crédito dos prêmios não há await');

  const sim = ler('src/server/sim.mjs');
  const bloco = sim.slice(sim.indexOf("  'caixa.npc.abrir'"), sim.indexOf("  'shop.sellItem'"));
  ok(bloco.includes('devolverOuro:') && bloco.includes("'caixa_estorno'"),
    'o sim liga o estorno, e ele é auditado');
  ok(/sempre: true/.test(bloco), 'o estorno audita SEMPRE — crédito em laço só aparece assim');

  // A REGRA GERAL, para o próximo que escrever uma compra: `subtrairGold` faz CLAMP em 0 e
  // devolve o que conseguiu tirar. Jogar esse retorno fora é dizer "cobrei o que deu" — que foi,
  // literalmente, a forma deste buraco. Todo chamador tem de guardar o valor.
  const chamadas = [...sim.matchAll(/^.*\bsubtrairGold\(/gm)].map((m) => m[0].trim());
  const descartadas = chamadas.filter((l) => !/(const|let|var)?\s*\w+\s*=\s*subtrairGold\(/.test(l));
  ok(!descartadas.length,
    `os ${chamadas.length} débitos de ouro do sim guardam o retorno de subtrairGold`,
    descartadas.join(' | '));
}

// =====================================================================================
secao('10 · Custo: o pedido mais caro que um jogador consegue formular');
{
  const especieReal = [...especies.keys()];
  const forte = (id) => ({
    teste: {
      speciesId: id, level: 9999, potencia: 5, qualidade: 9, shiny: true,
      ivs: { hp: 32, atk: 32, def: 32, spAtk: 32, spDef: 32, speed: 32 },
    },
  });
  const fraco = (id) => ({
    teste: { speciesId: id, level: 1, potencia: 1, qualidade: 0, ivs: { hp: 1, atk: 1, def: 1, spAtk: 1, spDef: 1, speed: 1 } },
  });
  const jogador = { dbId: 1, nick: 'x', looktype: 159, visual: null, pokemons: new Map() };

  // O pior caso não é 5×5 fortes (acaba rápido): é tanque contra tanque, a luta que bate o teto
  // de tempo simulado. Cinco de cada lado, tudo no máximo.
  const pedido = {
    a: especieReal.slice(0, 5).map(forte),
    b: especieReal.slice(5, 10).map(forte),
  };
  const amostras = [];
  let maior = 0;
  for (let i = 0; i < 12; i++) {
    const t0 = performance.now();
    const r = await lutaDeTreino(jogador, pedido);
    amostras.push(performance.now() - t0);
    maior = Math.max(maior, JSON.stringify(r).length);
  }
  amostras.sort((x, y) => x - y);
  const p50 = amostras[Math.floor(amostras.length / 2)];
  const pior = amostras.at(-1);
  console.log(`    5×5 no máximo: p50 ${p50.toFixed(2)} ms · pior ${pior.toFixed(2)} ms · resposta ${(maior / 1024).toFixed(1)} KB`);
  ok(pior < 60, `a luta mais cara fica abaixo de 60 ms de CPU (pior: ${pior.toFixed(1)} ms)`);
  ok(maior < 512 * 1024, `e a resposta abaixo de 512 KB (${(maior / 1024).toFixed(1)} KB)`);

  // O outro extremo: 5 tanques contra 1 filhote, a luta que demora porque ninguém morre.
  const t1 = performance.now();
  const r2 = await lutaDeTreino(jogador, { a: especieReal.slice(0, 5).map(forte), b: [fraco(especieReal[0])] });
  const ms2 = performance.now() - t1;
  console.log(`    5×1 desequilibrado: ${ms2.toFixed(2)} ms · ${(JSON.stringify(r2).length / 1024).toFixed(1)} KB`);
  ok(ms2 < 60, `o 5×1 também (${ms2.toFixed(1)} ms)`);

  // Com o balde de 3 e a espera de 5 min, o TETO de uma conta é 3 lutas por 5 minutos.
  const porContaPorHora = 3 * 12;
  const custoHora = (pior * porContaPorHora) / 1000;
  console.log(`    teto por conta: ${porContaPorHora} lutas/h = ${custoHora.toFixed(2)} s de CPU/h`);
  ok(custoHora < 5, 'uma conta em ataque contínuo não passa de 5 s de CPU por hora');

  // AS CAIXAS no teto. O "Máx" do card enche com o que o bolso paga, então o pedido mais caro
  // que existe é o do jogador mais rico do servidor — hoje 3 bilhões de Coins, ou 1.000 caixas a
  // 3 milhões (e o teto de 9.999 cobre qualquer bolso).
  for (const n of [10, 3000, QTD_MAX]) {
    const voltas = n > 100 ? 20 : 1000;
    const t2 = performance.now();
    let pacote = 0;
    for (let i = 0; i < voltas; i++) pacote = JSON.stringify(agruparPremios(abrirCaixas('vip', n))).length;
    const msN = (performance.now() - t2) / voltas;
    console.log(`    ${String(n).padStart(4)} caixas: ${msN.toFixed(2)} ms · pacote ${pacote} bytes`);
    ok(msN < 30, `abrir ${n} caixas custa menos de 30 ms (${msN.toFixed(2)} ms)`);
    // O agrupamento é o que mantém o pacote pequeno: sem ele, 3.000 caixas seriam 3.000 objetos.
    ok(pacote < 4096, `e o pacote de ${n} caixas cabe em 4 KB (${pacote} bytes)`);
  }
}

// =====================================================================================
secao('11 · Os freios: a espera do treino não se contorna');
{
  const treino = ler('src/server/game/treino.mjs');
  ok(treino.includes("`treino:${dbId}`") && treino.includes("'PX', TREINO_COOLDOWN_MS, 'NX'"),
    'a espera é carimbo no Redis com SET NX — dois pedidos colados, um só passa');
  ok(treino.includes('const chave = `treino:${dbId}`'),
    'a chave é o id da CONTA: relogar não zera, e vale em qualquer shard');
  ok(!/esperaLocal[^\n]*\n[^\n]*await/.test(treino.slice(treino.indexOf('} catch {'))),
    'o plano B (Redis fora) decide sem await — dois pedidos não passam juntos');

  const sim = ler('src/server/sim.mjs');
  const bloco = sim.slice(sim.indexOf("  'treino.lutar'"), sim.indexOf("  'amigos.info'"));
  ok(bloco.indexOf('reivindicarVez') < bloco.indexOf('lutaDeTreino'),
    'a vez é reivindicada ANTES de montar e simular qualquer coisa');
  ok(bloco.includes('await devolverVez(p.dbId)'), 'e devolvida quando a luta não aconteceu');
}

// =====================================================================================
secao('12 · Corrida: vinte compras ao mesmo tempo com dinheiro para três');
{
  // A fila de economia do sim serializa as mensagens, mas a defesa não pode DEPENDER dela: se
  // amanhã alguém chamar `comprarCaixa` de outro lugar, a conta tem de fechar do mesmo jeito.
  // Com a conferência e o débito no mesmo bloco síncrono, vinte chamadas soltas de uma vez só
  // podem terminar de um jeito: três caixas e nem um Coin a mais.
  const p = { dbId: 77, nick: 'corrida', gold: 3 * PRECO_FREE, diamonds: 0, items: {}, balls: {}, vipAte: 0 };
  const ganchos = {
    debitarOuro: (coins) => {
      const saiu = Math.max(0, Math.min(Math.floor(Number(coins)) || 0, p.gold));
      p.gold -= saiu;
      return saiu;
    },
    devolverOuro: (coins) => { p.gold += coins; },
    auditar: () => {},
  };

  const saidas = await Promise.allSettled(
    Array.from({ length: 20 }, () => comprarCaixa(p, { caixaId: 'free', qtd: 1 }, ganchos)),
  );
  const venceram = saidas.filter((s) => s.status === 'fulfilled');
  const premios = venceram.reduce((s, x) => s + x.value.premios.reduce((n, y) => n + y.vezes, 0), 0);
  ok(venceram.length === 3, 'exatamente três compras passam', `${venceram.length}`);
  ok(p.gold === 0, 'o ouro chega a zero e não passa dele', `${p.gold}`);
  ok(premios === 3, 'e saíram três prêmios, um por caixa paga', `${premios}`);
  ok(saidas.filter((s) => s.status === 'rejected')
    .every((s) => s.reason instanceof ErroCaixa && s.reason.message === 'caixa.recusa.semCoins'),
  'as outras dezessete são recusadas por saldo, sem erro solto');

  // E o caso oposto: vinte pedidos de dez caixas com dinheiro para dez. Nenhum pode sair pela
  // metade — ou leva as dez, ou não leva nenhuma.
  const p2 = { dbId: 78, nick: 'corrida2', gold: 10 * PRECO_FREE, diamonds: 0, items: {}, balls: {}, vipAte: 0 };
  const g2 = {
    debitarOuro: (coins) => {
      const saiu = Math.max(0, Math.min(Math.floor(Number(coins)) || 0, p2.gold));
      p2.gold -= saiu;
      return saiu;
    },
    devolverOuro: (coins) => { p2.gold += coins; },
    auditar: () => {},
  };
  const saidas2 = await Promise.allSettled(
    Array.from({ length: 20 }, () => comprarCaixa(p2, { caixaId: 'free', qtd: 10 }, g2)),
  );
  const ok2 = saidas2.filter((s) => s.status === 'fulfilled');
  const sorteios = ok2.reduce((t, x) => t + x.value.premios.reduce((n, y) => n + y.vezes, 0), 0);
  ok(ok2.length === 1 && sorteios === 10,
    'uma leva de dez sai inteira, e só uma', `${ok2.length} leva(s), ${sorteios} sorteios`);
  ok(p2.gold === 0, 'sem sobra e sem estouro', `${p2.gold}`);
}

// =====================================================================================
secao('13 · Reflexão: o texto do cliente não volta na resposta');
{
  const veneno = '"><img src=x onerror=alert(1)>__VENENO__';
  const jogador = { dbId: 1, nick: 'vitima', looktype: 159, visual: null, pokemons: new Map() };
  const especieReal = [...especies.keys()][0];

  // O pacote vai envenenado em todo campo que um atacante tentaria: os que a feature lê, e os
  // que ele CHUTARIA que a feature lê.
  const r = await lutaDeTreino(jogador, {
    nick: veneno, nome: veneno, titulo: veneno, arena: veneno, motivo: veneno,
    versao: veneno, replay: veneno, looktype: veneno, visual: veneno, playerId: veneno,
    a: [{ teste: { speciesId: especieReal, nome: veneno, nick: veneno, apelido: veneno } }],
    b: [{ teste: { speciesId: especieReal, nome: veneno } }],
  });
  const texto = JSON.stringify(r);
  ok(!texto.includes('__VENENO__'), 'nenhum texto do pacote reaparece na fita');
  ok(r.arena && !String(r.arena).includes('<'), 'a arena é escolhida pelo servidor', String(r.arena));
  ok(typeof r.versao === 'number' || /^[\w.-]+$/.test(String(r.versao)), 'e a versão do replay também');

  // A caixa: o mesmo, no que sobe depois da compra.
  const p = { dbId: 2, nick: 'v2', gold: 5e7, diamonds: 0, items: {}, balls: {}, vipAte: 0 };
  const compra = await comprarCaixa(p, {
    caixaId: 'free', qtd: 1, nome: veneno, detalhe: veneno, produtoId: veneno, tier: veneno,
  }, {
    debitarOuro: (c) => { p.gold -= c; return c; },
    devolverOuro: () => {},
    auditar: () => {},
  });
  ok(!JSON.stringify(compra).includes('__VENENO__'), 'nem na resposta da caixa');
  ok(compra.caixaId === 'free' && [TIER_COMUM, 'raro', 'lendario'].includes(compra.tier),
    'o id e a raridade da resposta vêm da tabela, não do pacote');
}

// =====================================================================================
secao('14 · A tela: nada entra em HTML sem passar pela peneira');
{
  // O cliente monta HTML com template literal. Todo `${}` que vá para `innerHTML` tem de passar
  // por `escapar` (ou ser número formatado): é ali que um nome de item vindo do catálogo — ou
  // amanhã de outro jogador — viraria script.
  const app = ler('src/client/app.js');
  const trechos = [
    ['as caixas', app.slice(app.indexOf('function pintarCaixasNpc('), app.indexOf('/** A resposta do servidor: a abertura'))],
    ['a abertura', app.slice(app.indexOf('function abrirAberturaDeCaixa('), app.indexOf('\n}', app.indexOf('function abrirAberturaDeCaixa(')))],
    ['a seta', app.slice(app.indexOf('function setaDeRolagem('), app.indexOf('\n}', app.indexOf('function setaDeRolagem(')))],
  ];
  // As funções que devolvem TEXTO (catálogo de itens, dicionário de idioma). Número formatado
  // (`num`, `pctDaChance`) não precisa de peneira; texto precisa, sempre.
  const FONTES_DE_TEXTO = ['nomeDoPremio(', 'nomeDaCaixa(', 'nomeItem(', 't('];
  const cruas = [];
  for (const [onde, trecho] of trechos) {
    for (const i of [...trecho.matchAll(/\$\{/g)].map((m) => m.index)) {
      // Casa as chaves na mão: `${a ? `x${b}` : ''}` tem template dentro de template, e regex
      // simples corta no primeiro `}` e acusa o inocente.
      let nivel = 0;
      let fim = i + 2;
      for (; fim < trecho.length; fim++) {
        if (trecho[fim] === '{') nivel++;
        else if (trecho[fim] === '}') { if (!nivel) break; nivel--; }
      }
      const expr = trecho.slice(i + 2, fim);

      // Expressão que é, INTEIRA, um `escapar(...)` já está coberta — inclusive o `t()` de
      // dentro de outro `t()`, que é interpolado antes de a peneira passar.
      const corte = expr.trim();
      if (corte.startsWith('escapar(')) {
        let n = 1;
        let j = 'escapar('.length;
        for (; j < corte.length && n; j++) {
          if (corte[j] === '(') n++;
          else if (corte[j] === ')') n--;
        }
        if (j === corte.length) continue;
      }

      for (const fonte of FONTES_DE_TEXTO) {
        let em = expr.indexOf(fonte);
        while (em !== -1) {
          // Fronteira de palavra: sem ela, `t(` casa dentro de `repeat(` e o teste acusa o
          // inocente — foi o primeiro falso positivo que este scanner deu.
          const anterior = em > 0 ? expr[em - 1] : ' ';
          if (!/[A-Za-z0-9_$.]/.test(anterior)) {
            const antes = expr.slice(Math.max(0, em - 8), em);
            if (!antes.endsWith('escapar(')) cruas.push(`${onde}: ${fonte}…`);
          }
          em = expr.indexOf(fonte, em + 1);
        }
      }
    }
  }
  ok(!cruas.length, 'todo texto interpolado em HTML passa por `escapar`', [...new Set(cruas)].join(' | '));

  // E o `escapar` do jogo tem de dar conta dos cinco caracteres que importam.
  const esc = ler('src/shared/escapar-html.mjs');
  ok(/replace\(\/\[<>&"'\]\/g/.test(esc), 'o `escapar` cobre < > & " e apóstrofo');
  ok(app.includes('const escapar = escaparHtml;'), 'e é ele que o cliente usa');

  // `textContent` também é seguro — e é o que o botão da seta e o "Ver Conteúdo" usam.
  ok(app.includes("ver.textContent = t('caixa.verConteudo');"),
    'o rótulo do "Ver Conteúdo" entra por textContent');
}

console.log(`\n${testes - falhas}/${testes} ok`);
if (falhas) console.log(`${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
