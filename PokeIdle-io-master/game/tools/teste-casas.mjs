// As CASAS NUMERADAS e o XP Share com várias casas — as regras puras, sem banco e sem Redis.
//
//   node tools/teste-casas.mjs
//
// O que este teste protege:
//   · o número da casa na tela: `#000042`, largura fixa, sem cortar acima de 999.999;
//   · a coluna `xp_share` nos dois formatos — o de hoje (`{ casa: [ids] }`) e o de antes das casas
//     numeradas (`[ids]`), que vira `legado` e só é gravado de volta enquanto não foi aplicado;
//   · UM pokémon, UM posto: `postoDoPokemon` acha o registrado em qualquer casa, e a limpeza tira a
//     cópia de dado torto deixando o posto de maior fatia;
//   · a casa anunciada não vale e perde os postos; a limpeza não toca em nada antes de as casas
//     chegarem do banco;
//   · a escalação antiga vai para a casa da raridade que estava equipada;
//   · quem recebe: a fatia de CADA casa, com cache que cai a cada mudança;
//   · a numeração retroativa: quem tirou e ainda tem fica com o próprio sorteio, as que mudaram de
//     mão pegam os que sobraram em ordem, e a casa sem log vai para o fim;
//   · o sim e a tela usando as regras (conferência no fonte) e os textos nas três línguas.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { numeroDaCasa, bonecosDaRaridade, xpShareDaRaridade, MAX_CASAS_EM_USO } from '../src/shared/casas.mjs';
import {
  ordenarCasas,
  casasAtivas,
  casaAtivaPorId,
  casasNaMao,
  casaNaMaoPorId,
  casasEmUsoPadrao,
  fixarCasasEmUso,
  usarCasa,
  normalizarXpShare,
  xpShareParaGravar,
  mexeuNoXpShare,
  postosDaCasa,
  postoDoPokemon,
  registrarNoPosto,
  soltarPostosDaCasa,
  limparXpShare,
  aplicarXpShareLegado,
  recebedoresXpShare,
  casasNaBolsa,
  planejarNumeracao,
  fabricarCasaComFragmentos,
} from '../src/server/game/casas.mjs';
import { CASA_POR_RARIDADE, FRAGMENTO_CHAVE_ID, CUSTO_FRAGMENTOS_CASA } from '../src/server/game/itens-nossos.mjs';
import { _dicionarios } from '../src/client/i18n.mjs';

let testes = 0;
let falhas = 0;
function ok(cond, nome, detalhe = '') {
  testes++;
  if (cond) return console.log(`  ok  ${nome}`);
  falhas++;
  console.log(`  FALHOU  ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}
const secao = (s) => console.log(`\n— ${s}`);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel) => readFileSync(join(raiz, rel), 'utf8').replace(/\r\n/g, '\n');
function trecho(src, inicio, fim) {
  const i = src.indexOf(inicio);
  if (i < 0) return '';
  const j = src.indexOf(fim, i + inicio.length);
  return src.slice(i, j < 0 ? undefined : j);
}

/** Um jogador com casas carregadas e uma equipe de cinco (ids 1–5) e um no Depot (id 9). */
function jogador(casas, porCasa = {}) {
  return {
    casas,
    xpShare: { porCasa: structuredClone(porCasa), legado: null },
    naEquipe: new Set([1, 2, 3, 4, 5]),
  };
}
const naEquipeDe = (p) => (id) => p.naEquipe.has(id);
const casa = (id, raridade, anunciada = false) => ({ id, raridade, anunciada, criadaEm: 0, criador: 'x' });

// ---------------------------------------------------------------- o número

secao('o número da casa');
ok(numeroDaCasa(1) === '#000001', 'a primeira casa é a #000001');
ok(numeroDaCasa(42) === '#000042', '42 vira #000042');
ok(numeroDaCasa(999_999) === '#999999', 'o último de seis dígitos');
ok(numeroDaCasa(1_234_567) === '#1234567', 'acima de 999.999 a largura cresce, não corta');
ok(numeroDaCasa('7') === '#000007' && numeroDaCasa(null) === '#000000', 'aguenta texto e nulo sem estourar');

// ------------------------------------------------------------- a coluna

secao('a coluna xp_share');
{
  const hoje = normalizarXpShare({ 12: [3, null], 40: [5] });
  ok(igual(hoje.porCasa, { 12: [3, null], 40: [5] }) && hoje.legado === null, 'o formato de hoje passa inteiro');
  const texto = normalizarXpShare('{"12":[3]}');
  ok(igual(texto.porCasa, { 12: [3] }), 'jsonb como texto também');
  const antigo = normalizarXpShare([7, null]);
  ok(igual(antigo.porCasa, {}) && igual(antigo.legado, [7, null]), 'a lista antiga vira `legado`, esperando as casas');
  ok(normalizarXpShare([]).legado === null && normalizarXpShare('[]').legado === null, 'lista antiga vazia não é legado nenhum');
  ok(igual(normalizarXpShare({ abc: [1], 5: 'x', 6: [null], '-3': [2] }).porCasa, {}), 'chave torta, valor torto e casa sem ninguém saem');
  ok(igual(normalizarXpShare(['7', 'lixo', -3]).legado, [7, null, null]), 'lixo vira posto vazio');
  ok(igual(normalizarXpShare('{isso não é json').porCasa, {}) && igual(normalizarXpShare(null).porCasa, {}), 'texto quebrado e null não derrubam o login');
  ok(normalizarXpShare({ 1: new Array(50).fill(2) }).porCasa[1].length === 8, 'lista gigante é cortada em 8 postos');
  const muitas = Object.fromEntries(Array.from({ length: 2_000 }, (_, i) => [i + 1, [1]]));
  ok(Object.keys(normalizarXpShare(muitas).porCasa).length === 1_000, 'um objeto de 2.000 casas é cortado em 1.000');
}
{
  const p = { xpShare: normalizarXpShare([7, 8]) };
  ok(igual(xpShareParaGravar(p), [7, 8]), 'enquanto o legado não foi aplicado, o flush grava o LEGADO (e não `{}` por cima)');
  p.xpShare.legado = null;
  p.xpShare.porCasa = { 3: [7] };
  ok(igual(xpShareParaGravar(p), { 3: [7] }), 'depois, grava o formato de hoje');
}

// ------------------------------------------------------------- os postos

secao('os postos');
{
  const p = jogador([casa(10, 'comum'), casa(11, 'lendaria')]);
  ok(postosDaCasa(p, p.casas[0]).length === bonecosDaRaridade('comum'), 'a Comum tem os postos dela');
  ok(postosDaCasa(p, p.casas[1]).length === bonecosDaRaridade('lendaria'), 'a Lendária tem os dois');
  ok(registrarNoPosto(p, p.casas[1], 1, 4) && igual(p.xpShare.porCasa[11], [null, 4]), 'registra no segundo posto da Lendária');
  ok(!registrarNoPosto(p, p.casas[0], 1, 3), 'não registra num posto que a Comum não tem');
  ok(igual(postoDoPokemon(p, 4), { casaId: 11, slot: 1 }), 'acha onde o pokémon está, em qualquer casa');
  ok(postoDoPokemon(p, 4, { casaId: 11, slot: 1 }) === null, 'o próprio posto não conta como "outro posto"');
  ok(postoDoPokemon(p, 3) === null, 'quem não está em posto nenhum não é achado');
  registrarNoPosto(p, p.casas[1], 1, null);
  ok(!(11 in p.xpShare.porCasa), 'casa sem ninguém some do objeto (a coluna não carrega [null, null])');
}
{
  const p = jogador([casa(1, 'rara'), casa(2, 'mitica')], { 1: [3], 2: [5] });
  const soltos = soltarPostosDaCasa(p, 1);
  ok(igual(soltos, [3]) && !(1 in p.xpShare.porCasa) && igual(p.xpShare.porCasa[2], [5]),
    'anunciar solta os pokémon SÓ daquela casa');
}

// ------------------------------------------------------------- a limpeza

secao('a limpeza');
{
  const p = jogador(null, { 1: [3] });
  ok(!limparXpShare(p, () => false) && igual(p.xpShare.porCasa, { 1: [3] }),
    'sem as casas carregadas não toca em nada — senão o login apagaria a escalação');
}
{
  const p = jogador([casa(1, 'comum'), casa(2, 'mitica', true)], { 1: [3], 2: [4], 99: [5] });
  ok(limparXpShare(p, naEquipeDe(p)), 'limpa e diz que limpou');
  ok(igual(p.xpShare.porCasa, { 1: [3] }), 'casa anunciada e casa que não é mais dele perdem os postos');
  ok(!limparXpShare(p, naEquipeDe(p)), 'numa segunda passada não há o que limpar');
}
{
  const p = jogador([casa(1, 'lendaria')], { 1: [9, 2, 7] });
  limparXpShare(p, naEquipeDe(p));
  ok(igual(p.xpShare.porCasa, { 1: [null, 2] }), 'corta nos postos da raridade e esvazia quem saiu da equipe');
}
{
  // Dado torto: o mesmo pokémon em duas casas. Fica no posto que rende mais.
  const p = jogador([casa(1, 'comum'), casa(2, 'mitica'), casa(3, 'rara')], { 1: [4], 2: [4], 3: [4] });
  limparXpShare(p, naEquipeDe(p));
  ok(igual(p.xpShare.porCasa, { 2: [4] }), 'um pokémon repetido fica só na casa de maior fatia (a Mítica)');
}

// ------------------------------------------------------------- o legado

secao('a escalação de antes das casas numeradas');
{
  const p = jogador([casa(5, 'comum'), casa(8, 'rara'), casa(3, 'rara'), casa(9, 'lendaria')]);
  p.xpShare = normalizarXpShare([4]);
  ok(aplicarXpShareLegado(p, 'rara') && igual(p.xpShare.porCasa, { 3: [4] }) && p.xpShare.legado === null,
    'vai para a casa da raridade que estava equipada — a de menor número, se houver duas');
}
{
  const p = jogador([casa(5, 'comum'), casa(9, 'lendaria')]);
  p.xpShare = normalizarXpShare([4, 2]);
  aplicarXpShareLegado(p, 'mitica');
  ok(igual(p.xpShare.porCasa, { 9: [4, 2] }), 'sem casa daquela raridade, vai para a melhor que ele tem');
}
{
  const p = jogador([casa(5, 'comum')]);
  p.xpShare = normalizarXpShare([4, 2]);
  aplicarXpShareLegado(p, 'lendaria');
  ok(igual(p.xpShare.porCasa, { 5: [4] }), 'cortada nos postos da casa que a recebe');
}
{
  const p = jogador([casa(5, 'comum', true)]);
  p.xpShare = normalizarXpShare([4]);
  aplicarXpShareLegado(p, 'comum');
  ok(igual(p.xpShare.porCasa, {}) && p.xpShare.legado === null, 'sem casa ativa nenhuma, a escalação some (não há onde registrar)');
}
{
  const p = { casas: null, xpShare: normalizarXpShare([4]) };
  ok(!aplicarXpShareLegado(p, 'comum') && igual(p.xpShare.legado, [4]), 'antes das casas chegarem, o legado espera');
}

// ------------------------------------------------------------ quem recebe

secao('quem recebe');
{
  const p = jogador([casa(1, 'comum'), casa(2, 'lendaria'), casa(3, 'mitica', true)], { 1: [3], 2: [4, 5], 3: [2] });
  const lista = recebedoresXpShare(p);
  ok(lista.length === 3, 'três registrados em duas casas ativas; a anunciada não entra', JSON.stringify(lista));
  ok(lista.find((r) => r.pkId === 3)?.fator === xpShareDaRaridade('comum'), 'o da Comum recebe a fatia da Comum');
  ok(lista.filter((r) => r.casaId === 2).every((r) => r.fator === xpShareDaRaridade('lendaria')), 'os da Lendária, a da Lendária');
  ok(recebedoresXpShare(p) === lista, 'a lista fica em cache entre um abate e outro');
  registrarNoPosto(p, p.casas[0], 0, null);
  ok(recebedoresXpShare(p) !== lista && recebedoresXpShare(p).length === 2, 'mexer num posto derruba o cache');
  p.casas[1].anunciada = true;
  mexeuNoXpShare(p);
  ok(recebedoresXpShare(p).length === 0, 'anunciar a casa tira os dela da lista');
}
{
  // O teto de quem recebe é a EQUIPE: com um pokémon por posto, cinco casas Míticas e cinco
  // pokémon na equipe dão no máximo cinco registrados — e o de batalha não recebe no crédito.
  const casas = [1, 2, 3, 4, 5, 6, 7].map((id) => casa(id, 'mitica'));
  const p = jogador(casas);
  let pk = 1;
  for (const c of casas) {
    if (pk > 5) break;
    registrarNoPosto(p, c, 0, pk++);
  }
  ok(recebedoresXpShare(p).length === 5, 'sete Míticas e uma equipe de cinco: no máximo cinco registrados');
}

// ------------------------------------------------------- as casas em uso

secao('as casas em uso (quantas quiser, 5 valendo)');
{
  ok(MAX_CASAS_EM_USO === 5, 'o teto de casas EM USO é 5');
  // Sete casas e nenhuma escolha gravada: a padrão prefere quem já tem gente no posto, depois a fatia.
  const casas = [
    casa(1, 'comum'), casa(2, 'comum'), casa(3, 'rara'), casa(4, 'mitica'),
    casa(5, 'incomum'), casa(6, 'lendaria'), casa(7, 'comum', true),
  ];
  const p = jogador(casas, { 2: [3] });
  const padrao = casasAtivas(p).map((c) => c.id);
  ok(padrao.length === 5 && padrao[0] === 2, 'sem escolha, valem 5 — primeiro a que já tem pokémon no posto', padrao.join(','));
  ok(igual(padrao, [2, 6, 4, 3, 5]), 'depois as de maior fatia; a anunciada nunca entra', padrao.join(','));
  ok(igual(casasEmUsoPadrao(p).map((c) => c.id), padrao), 'sem escolha gravada, `casasAtivas` é a escolha padrão');
  ok(casasNaMao(p).length === 6, 'na mão são seis: a anunciada fica de fora');
  ok(fixarCasasEmUso(p) && igual(p.automation.casasEmUso, padrao), 'o primeiro carregamento GRAVA a escolha padrão');
  ok(!fixarCasasEmUso(p), 'gravar de novo a mesma escolha não conta como mudança');
  ok(casaAtivaPorId(p, 1) === null && casaNaMaoPorId(p, 1)?.id === 1, 'a guardada está na mão, mas não em uso');
  ok(casaNaMaoPorId(p, 7) === null, 'a anunciada nem na mão está');
}
{
  const casas = [1, 2, 3, 4, 5, 6].map((id) => casa(id, 'comum'));
  const p = jogador(casas);
  p.automation = { casasEmUso: [1, 2, 3, 4, 5] };
  const cheio = usarCasa(p, 6, true);
  ok(!cheio.ok && cheio.erro === 'casa.limiteEmUso', 'com 5 em uso, a sexta não entra — e o erro diz o motivo');
  registrarNoPosto(p, casas[0], 0, 4);
  const guardou = usarCasa(p, 1, false);
  ok(guardou.ok && igual(guardou.soltos, [4]) && !(1 in p.xpShare.porCasa), 'guardar solta os pokémon dos postos DAQUELA casa');
  ok(igual(p.automation.casasEmUso, [2, 3, 4, 5]), 'e a tira da lista de uso');
  ok(usarCasa(p, 6, true).ok && igual(p.automation.casasEmUso, [2, 3, 4, 5, 6]), 'com a vaga aberta, a sexta entra');
  ok(usarCasa(p, 6, true).ok && usarCasa(p, 1, false).ok, 'pedir o que já é não é erro');
  ok(usarCasa(p, 99, true).erro === 'casa.naoDisponivel', 'casa que não é dele não entra em uso');
}
{
  // A escolha gravada manda — e casa que saiu da mão cai dela.
  const casas = [casa(1, 'lendaria'), casa(2, 'comum'), casa(3, 'rara')];
  const p = jogador(casas, { 1: [4] });
  p.automation = { casasEmUso: [2, 99, 2, 3] };
  ok(igual(casasAtivas(p).map((c) => c.id), [2, 3]), 'vale a escolha gravada, mesmo com uma Lendária guardada');
  ok(recebedoresXpShare(p).length === 0, 'a casa guardada não reparte XP, mesmo com o posto escrito');
  ok(limparXpShare(p, naEquipeDe(p)) && !(1 in p.xpShare.porCasa), 'e a limpeza tira o posto dela');
  casas[1].anunciada = true;
  ok(fixarCasasEmUso(p) && igual(p.automation.casasEmUso, [3]), 'número que não existe, repetido ou anunciado sai da lista gravada');
  const torto = jogador(casas);
  torto.automation = { casasEmUso: 'tudo' };
  ok(casasAtivas(torto).length === 2, 'campo torto no jsonb cai na escolha padrão');
}

// ------------------------------------------------------------ as casas

secao('as casas');
{
  const lista = [casa(9, 'comum'), casa(3, 'lendaria'), casa(4, 'comum'), casa(7, 'mitica')];
  ok(igual(ordenarCasas(lista).map((c) => c.id), [3, 7, 4, 9]), 'a mais rara primeiro, e dentro da raridade o número');
  const p = jogador([casa(1, 'rara'), casa(2, 'rara', true)]);
  ok(casasAtivas(p).length === 1 && casaAtivaPorId(p, 1) && !casaAtivaPorId(p, 2), 'a anunciada não é ativa');
  ok(!casaAtivaPorId(p, '__proto__') && !casaAtivaPorId(p, -1) && !casaAtivaPorId(p, 1.5), 'número adulterado não acha casa');
}
{
  const items = { [CASA_POR_RARIDADE.comum]: 2, [CASA_POR_RARIDADE.lendaria]: 1, 11: 5 };
  ok(igual(casasNaBolsa(items).map((b) => [b.raridade, b.qtd]), [['comum', 2], ['lendaria', 1]]), 'acha as casas-item que sobraram na bolsa');
  ok(casasNaBolsa({}).length === 0, 'bolsa sem casa-item: nada');
}
{
  const p = { items: { [FRAGMENTO_CHAVE_ID]: CUSTO_FRAGMENTOS_CASA - 1 } };
  ok(fabricarCasaComFragmentos(p) === null && p.items[FRAGMENTO_CHAVE_ID] === CUSTO_FRAGMENTOS_CASA - 1, 'sem 10 fragmentos não fabrica nem cobra');
  p.items[FRAGMENTO_CHAVE_ID] = CUSTO_FRAGMENTOS_CASA;
  ok(typeof fabricarCasaComFragmentos(p) === 'string' && !(FRAGMENTO_CHAVE_ID in p.items), 'com 10, cobra e sorteia');
}

// ------------------------------------------------------ a numeração retroativa

secao('a numeração retroativa');
{
  const aberturas = [
    { logId: 1, playerId: 10, nick: 'Ana', raridade: 'comum', em: 1_000 },
    { logId: 2, playerId: 20, nick: 'Bia', raridade: 'comum', em: 2_000 },
    { logId: 3, playerId: 10, nick: 'Ana', raridade: 'rara', em: 3_000 },
    { logId: 4, playerId: 30, nick: 'Caio', raridade: 'comum', em: 4_000 },
  ];
  const unidades = [
    // A Bia ainda tem a Comum dela.
    { donoId: 20, dono: 'Bia', raridade: 'comum', anuncioId: null },
    // A Rara da Ana está no Mercado, anunciada por ela.
    { donoId: 10, dono: 'Ana', raridade: 'rara', anuncioId: 77 },
    // O Davi comprou uma Comum — não tirou nenhuma.
    { donoId: 40, dono: 'Davi', raridade: 'comum', anuncioId: null },
    // Uma Lendária sem log (o log começou depois dela).
    { donoId: 50, dono: 'Eva', raridade: 'lendaria', anuncioId: null },
  ];
  const plano = planejarNumeracao({ unidades, aberturas });
  const ordem = plano.map((u) => `${u.dono}:${u.raridade}`);
  ok(igual(ordem, ['Davi:comum', 'Bia:comum', 'Ana:rara', 'Eva:lendaria']),
    'a ordem é a dos sorteios; a sem log vai para o fim', ordem.join(' · '));
  ok(plano[1].criador === 'Bia' && plano[1].em === 2_000, 'quem tirou e ainda tem fica com o PRÓPRIO sorteio');
  ok(plano[0].criador === 'Ana' && plano[0].em === 1_000, 'a que mudou de mão pega o sorteio mais antigo que sobrou — e o criador é quem tirou');
  ok(plano[2].anuncioId === 77 && plano[2].criador === 'Ana', 'a anunciada é numerada como qualquer outra, com o anúncio junto');
  ok(plano[3].em === null && plano[3].criador === 'Eva', 'sem log, o criador é o dono de hoje');
  ok(plano.length === unidades.length, 'nenhuma casa fica sem número, e nenhum número sobra');
}
{
  const aberturas = [1, 2, 3].map((i) => ({ logId: i, playerId: 10, nick: 'Ana', raridade: 'comum', em: i * 100 }));
  const unidades = [1, 2].map(() => ({ donoId: 10, dono: 'Ana', raridade: 'comum', anuncioId: null }));
  const plano = planejarNumeracao({ unidades, aberturas });
  ok(igual(plano.map((u) => u.em), [100, 200]), 'duas casas da mesma conta pegam os dois sorteios mais antigos dela');
}
{
  const unidades = Array.from({ length: 5_000 }, (_, i) => ({ donoId: i % 700, dono: `j${i % 700}`, raridade: 'comum', anuncioId: null }));
  const aberturas = Array.from({ length: 6_000 }, (_, i) => ({ logId: i, playerId: i % 900, nick: `j${i % 900}`, raridade: 'comum', em: i }));
  const t0 = performance.now();
  planejarNumeracao({ unidades, aberturas });
  const ms = performance.now() - t0;
  ok(ms < 2_000, `5.000 casas contra 6.000 sorteios planejam num boot sem travar (${ms.toFixed(0)} ms)`);
}

// --------------------------------------------------------------- o sim

secao('o sim');
{
  const sim = ler('src/server/sim.mjs');
  const escolher = trecho(sim, "'xpshare.escolher': (p, m) => {", '\n  },');
  ok(/postoDoPokemon\(p, pedido, \{ casaId: casa\.id, slot \}\)[\s\S]*casa\.jaEmOutroPosto/.test(escolher),
    'xpshare.escolher: recusa o pokémon que já está em OUTRO posto, de qualquer casa, dizendo qual');
  ok(escolher.includes('casaAtivaPorId(p, m.casaId ?? p.casa?.casaId)'), 'xpshare.escolher: a casa vem pelo número e tem de ser ativa');
  const entrar = trecho(sim, "'casa.entrar': (p, m) => {", '\n  },');
  ok(entrar.includes('casaAtivaPorId(p, m.casaId)') && entrar.includes('sala.casaId = casa.id'), 'casa.entrar: entra na casa PEDIDA, pelo número');
  ok(!sim.includes("'casa.equipar'") && !/casaDoJogador|capacidadeXpShare|fatorXpShare|INTERVALO_TROCA_CASA_MS/.test(sim),
    'não sobrou casa equipada, nem a espera de troca');
  const credito = trecho(sim, 'function creditarXpShare(p, ativoPk, xpDoAtivo) {', '\n}\n');
  ok(credito.includes('recebedoresXpShare(p)') && credito.includes('r.fator'), 'o crédito lê a lista de quem recebe, com a fatia de cada casa');
  const mercado = trecho(sim, 'if (m.casaId != null) {', '// CAIXA DE FUNDADOR.');
  ok(/pararXpShareDaCasa\(p, casa\)[\s\S]*mdb\.criarAnuncio\(/.test(mercado), 'Mercado: os postos da casa saem ANTES de o anúncio ser criado');
  ok(/catch \(err\) \{[\s\S]*registrarNoPosto\(p, casa, slot, id\)/.test(mercado), 'Mercado: o anúncio que falha devolve os pokémon aos postos');
  ok(mercado.includes('casaId: casa.id') && mercado.includes('numero: casa.id'), 'Mercado: a ficha leva o número');
  ok(sim.includes('xpShare: JSON.stringify(xpShareParaGravar(p))'), 'o flush grava pela regra do legado');
  ok(/await mdb\.migrar\(\);[\s\S]{0,400}await casasDb\.migrar\(\);/.test(sim), 'a migração das casas roda logo depois da do Mercado, antes das varreduras');
  const fabricar = trecho(sim, "'casa.fabricar': (p) => {", '\n  },');
  ok(/casasDb\.criarCasa\([\s\S]*catch \(err\) \{[\s\S]*CUSTO_FRAGMENTOS_CASA/.test(fabricar), 'fabricar: se o número não nascer, os fragmentos voltam');
  ok(fabricar.includes('obteve casa ${raridade}'), 'fabricar: o log mantém "obteve casa <raridade>", que a numeração retroativa lê');
  ok(fabricar.includes('usarCasa(p, casa.id, true)') && fabricar.includes('emUso, maxEmUso: MAX_CASAS_EM_USO'),
    'fabricar: a casa nova entra em uso se houver vaga, e a tela sabe se ela chegou guardada');
  const usarCmd = trecho(sim, "'casa.usar': (p, m) => {", '\n  },');
  ok(usarCmd.includes('usarCasa(p, casaId, usar)') && usarCmd.includes('casa.saiaParaGuardar'),
    'casa.usar: põe ou guarda pela regra, e não guarda a casa em que o jogador está');
  const carregar = trecho(sim, 'async function carregarCasas(p) {', '\n}\n');
  ok(/naMaoAntes[\s\S]*usarCasa\(p, c\.id, true\)[\s\S]*fixarCasasEmUso\(p\)/.test(carregar),
    'carregar: casa que chega à mão entra em uso se houver vaga, e a escolha fica gravada');
  ok(mercado.includes('casaNaMaoPorId(p, m.casaId)'), 'Mercado: a casa guardada também se anuncia');
}
{
  const mdb = ler('src/server/market-db.mjs');
  ok(mdb.includes("if (tipo === 'item' && !caixaId && !casaId && !bicicletaId) {"), 'Mercado: a casa (e a bicicleta) não empilha nem cai na trava de reanúncio do item');
  ok(/UPDATE casas SET anuncio_id = \$1\s+WHERE id = \$2 AND dono_id = \$3 AND anuncio_id IS NULL/.test(mdb), 'Mercado: escrow da casa pela linha, só do dono e só uma vez');
  ok(/UPDATE casas SET dono_id = \$1, anuncio_id = NULL WHERE id = \$2 AND anuncio_id = \$3/.test(mdb), 'Mercado: a compra troca o dono na transação');
  ok(mdb.includes('UPDATE casas SET anuncio_id = NULL WHERE id = ANY($1::bigint[])'), 'Mercado: devolução solta o escrow da casa');
  // As devoluções do servidor (vencimento, curadoria, preço inválido) não escrevem na bolsa: o
  // escrow solta a casa no banco, e quem entrega o resto é o sim do dono (`entregarDevolucoes`).
  const fechar = trecho(mdb, 'async function fecharParaDevolucao(', '\n}\n');
  ok(fechar.includes('await soltarCaixasDeAnuncios(cli, linhas);') && !fechar.includes('UPDATE players'),
    'Mercado: a devolução do servidor solta a casa pelo escrow e não escreve na bolsa');
  const entregar = trecho(ler('src/server/sim.mjs'), 'async function entregarDevolucoesAgora(p) {', '\n}\n');
  ok(/if \(a\.caixaId\)[^\n]*\n\s*else if \(a\.casaId\)[^\n]*\n\s*else if \(a\.bicicletaId\)[\s\S]*p\.items\[a\.itemId\] =/.test(entregar),
    'Mercado: nenhuma devolução soma casa como quantidade');
}

// --------------------------------------------------------------- a tela

secao('a tela');
{
  const app = ler('src/client/app.js');
  ok(!/abrirCasaOuEntrar|pedirEquiparCasa|ligarCardCasa|minhaCasa\(/.test(app), 'o botão Casa abre o modal; não há mais equipar');
  ok(app.includes("if (nome === 'casa') aoAbrirCasa();") && app.includes("enviar({ t: 'casa.sincronizar' });"), 'abrir o modal relê as casas no servidor');
  ok(/const assinatura = JSON\.stringify\(\[\s*'minhas'/.test(app) && app.includes('if (assinatura === casaTela.assinatura) return;'),
    'o painel só repinta quando muda o que ele mostra (as animações não reiniciam a cada snapshot)');
  ok(app.includes("enviar({ t: 'xpshare.escolher', casaId: noutro.casaId, slot: noutro.slot, pokemonId: null });"), 'mover de casa tira de lá antes de pôr aqui');
  ok(app.includes('casaId: alvo.casaId ?? null,'), 'o anúncio manda o número da casa');
  ok(/\} else if \(estado\.modalAberto === 'casa'\) \{[\s\S]{0,700}\} else if \(estado\.modalAberto === 'campeonato'\)/.test(app),
    'a Casa tem ramo próprio no estado: o snapshot de combate não recria o modal (lista não volta ao topo)');
  ok(!app.includes('contarAteCasa') && /if \(el && total != null\) el\.textContent = num\(total\);/.test(app),
    'o contador do servidor é fixo, sem animação');
  ok(/function repintarPainelCasa\(painel, aba, html\)[\s\S]*painel\.scrollTop = manter \? rolagem : 0;/.test(app),
    'repintar o painel na mesma aba mantém a rolagem');
  ok(app.includes('data-ver-anuncio=') && app.includes("estado.cmFiltro.categoria = 'casa';") && /function abrirAnuncioPendente[\s\S]*abrirCompra\(a\)/.test(app),
    '"Ver anúncio" leva à casa no Mercado e abre a compra daquele anúncio');
  ok(app.includes('if (caixaTipo || ehCasa || ehBike) {'), 'a compra de uma casa (ou bicicleta) não mostra seletor de quantidade');
  const css = ler('src/client/estilo.css');
  ok(css.includes('.csm-card.rar-lendaria:not(.anunciada)::before') && css.includes('@media (prefers-reduced-motion: reduce)'),
    'a Lendária gira e brilha — e para para quem pediu menos movimento');
  ok(ler('src/client/mobile.css').includes('html.mobile .modal-caixa[data-modal="casa"]'), 'no celular a folha da Casa ocupa a altura inteira');
}

// --------------------------------------------------------------- textos

secao('textos');
{
  const novas = [
    'casa.abaMinhas', 'casa.abaRegistro', 'casa.contadorServidor', 'casa.resumoTopo', 'casa.todasValem', 'casa.noMercado',
    'casa.noMercadoDica', 'casa.registroVazio', 'casa.deDono', 'casa.tiradaPor', 'casa.naoDisponivel', 'casa.jaEmOutroPosto',
    'casa.saiaParaAnunciar', 'casa.anuncieNumero', 'casa.fabricarFalhou', 'casa.soltosAoAnunciar', 'casa.avisoAnunciar',
    'casa.compraVazia', 'casa.moverParaCa', 'casa.naCasa', 'casa.escolherTituloNum', 'recompensa.casaSubAtiva',
  ];
  const velhas = ['casa.equipar', 'casa.equipadaSelo', 'casa.trocaEspera', 'casa.suaAtual', 'recompensa.casaSubEquipar'];
  for (const l of ['pt', 'en', 'es']) {
    const faltam = novas.filter((k) => typeof _dicionarios[l]?.[k] !== 'string');
    ok(!faltam.length, `${l}: as ${novas.length} chaves novas existem`, faltam.join(', '));
    ok(!velhas.some((k) => k in _dicionarios[l]), `${l}: as frases da casa equipada saíram`);
    ok((_dicionarios[l]['cena.casaDentro'] ?? '').includes('{numero}'), `${l}: a cena diz o número da casa`);
  }
}

console.log(`\n${testes - falhas}/${testes} ok`);
if (falhas) {
  console.log(`${falhas} falha(s)`);
  process.exit(1);
}
