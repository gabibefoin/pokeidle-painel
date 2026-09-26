// Teste das BICICLETAS e dos ícones de TM elemental — sem banco e sem Redis.
//
// O que este teste protege:
//   · as bicicletas usam os MESMOS pesos da Casa (lidos dela, não copiados à mão) e a escada de
//     velocidade pedida: +15/+25/+50/+75/+100%, crescente;
//   · para o mesmo número, o sorteio da bicicleta dá a mesma raridade que o da Casa;
//   · o passo com bicicleta divide pelo fator, e fator torto (NaN, Infinity, < 1) nunca deixa o
//     herói mais lento nem trava o passo;
//   · o fragmento só cai na Outland, na chance do Fragmento de Chave × degrau × Loot Boost;
//   · fabricar gasta 10 e só com 10, e cada fabricação soma uma bicicleta — sem teto na bolsa;
//   · VÁRIAS na bolsa, UMA equipada, e as porcentagens NÃO somam; equipar outra substitui;
//     só equipa o que tem; raridade adulterada é recusada; a equipada que sai da bolsa deixa
//     de valer na hora;
//   · os itens novos não colidem com nenhum id nosso, não vendem ao NPC e entram no Mercado da
//     Comunidade — fragmento na aba Fragmentos, bicicleta na aba própria —, e caem em Itens Raros;
//   · o sim só aplica a velocidade na HUNT (a arena do boss usa o mesmo campo) e o campo usa o
//     passo com bicicleta no herói e no treinador;
//   · todo ícone novo existe em disco, inclusive os 18 de TM elemental;
//   · toda chave de texto que o servidor e a tela usam existe nas três línguas.
//
//   node tools/teste-bicicletas.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  RARIDADES_BICICLETA,
  raridadeBicicletaValida,
  sortearRaridadeBicicleta,
  velocidadeDaRaridade,
  fatorPassoDaRaridade,
  passoComBicicleta,
} from '../src/shared/bicicletas.mjs';
import { RARIDADES_CASA, sortearRaridadeCasa } from '../src/shared/casas.mjs';
import { CHANCE_FRAGMENTO_CHAVE } from '../src/server/game/casas.mjs';
import {
  CHANCE_FRAGMENTO_BICICLETA,
  bicicletasDoJogador,
  bicicletaEquipada,
  fatorPassoBicicleta,
  equiparBicicleta,
  rolarFragmentoBicicleta,
  fabricarBicicletaComFragmentos,
  equipadaGravada,
  resolverEquipadaLegada,
  bicicletasNaBolsa,
} from '../src/server/game/bicicletas.mjs';
import {
  ITENS_NOSSOS,
  FRAGMENTO_BICICLETA_ID,
  BICICLETA_POR_RARIDADE,
  CUSTO_FRAGMENTOS_BICICLETA,
  ehItemBicicleta,
} from '../src/server/game/itens-nossos.mjs';
import {
  itens,
  itemAnunciavelMercado,
  categoriaMercado,
  CATEGORIAS_MERCADO,
  itensDaCategoria,
} from '../src/server/content.mjs';
import { itemVendavelAoNpc } from '../src/shared/venda-npc-item.mjs';
import { _dicionarios } from '../src/client/i18n.mjs';

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
const jogador = (items = {}, automation = {}) => ({ items: { ...items }, automation: { ...automation } });
/** Uma bicicleta numerada, como chega do banco. */
const bike = (id, raridade, anunciada = false) => ({ id, raridade, anunciada });
/** Um jogador com as bicicletas já carregadas do banco. */
const ciclista = (lista, automation = {}) => ({ items: {}, bicicletas: lista, automation: { ...automation } });
const B = BICICLETA_POR_RARIDADE;

console.log('BICICLETAS — movespeed na hunt\n==============================');

// ------------------------------------------------------------------ a tabela

secao('A tabela — pesos da Casa, velocidade pedida');

ok(RARIDADES_BICICLETA.length === 5, 'cinco raridades');
ok(
  RARIDADES_BICICLETA.every((r, i) => r.id === RARIDADES_CASA[i].id && r.peso === RARIDADES_CASA[i].peso),
  'mesmas raridades e MESMOS pesos da Casa, na mesma ordem',
);
ok(
  JSON.stringify(RARIDADES_BICICLETA.map((r) => r.velocidade)) === '[0.15,0.25,0.5,0.75,1]',
  'Comum +15% · Incomum +25% · Rara +50% · Mítica +75% · Lendária +100%',
);
ok(velocidadeDaRaridade(null) === 0 && fatorPassoDaRaridade(null) === 1, 'sem bicicleta: +0%, fator 1');
{
  let iguais = true;
  for (let i = 0; i < 20000; i++) {
    const x = i / 20000;
    if (sortearRaridadeBicicleta(() => x) !== sortearRaridadeCasa(() => x)) iguais = false;
  }
  ok(iguais, 'para o mesmo número, a bicicleta sorteia a mesma raridade que a Casa (20.000 pontos)');
}
ok(
  sortearRaridadeBicicleta(() => 0) === 'comum' && sortearRaridadeBicicleta(() => 0.99999999) === 'lendaria',
  'as pontas: 0 → Comum, quase 1 → Lendária',
);

// ------------------------------------------------------------------- o passo

secao('O passo');

ok(passoComBicicleta(260, 1) === 260, 'a pé: 260 ms');
ok(passoComBicicleta(260, 1.15) === 226, 'Comum: 260 → 226 ms');
ok(passoComBicicleta(260, 1.5) === 173, 'Rara: 260 → 173 ms');
ok(passoComBicicleta(260, 2) === 130 && passoComBicicleta(290, 2) === 145, 'Lendária: herói 130 ms, treinador 145 ms');
for (const [f, nome] of [[0.5, '0,5'], [0, '0'], [-2, '−2'], [Number.NaN, 'NaN'], [Number.POSITIVE_INFINITY, 'Infinity'], [undefined, 'undefined'], [null, 'null']]) {
  ok(passoComBicicleta(260, f) === 260, `fator ${nome} → passo normal (nunca mais lento, nunca travado)`);
}

// --------------------------------------------------------------- o fragmento

secao('O fragmento');

ok(
  CHANCE_FRAGMENTO_BICICLETA === 0.000005 && CHANCE_FRAGMENTO_BICICLETA === CHANCE_FRAGMENTO_CHAVE,
  'chance base 0,0005% (1 em 200.000), a mesma do Fragmento de Chave',
);
{
  const original = Math.random;
  const c = CHANCE_FRAGMENTO_BICICLETA;
  try {
    Math.random = () => 0;
    ok(
      rolarFragmentoBicicleta(0, 'kanto', 8) === null && rolarFragmentoBicicleta(0, null, 8) === null,
      'fora da Outland não cai — nem com o sorteio mais favorável',
    );
    const d = rolarFragmentoBicicleta(0, 'outland', 1);
    ok(d?.itemId === FRAGMENTO_BICICLETA_ID && d.qtd === 1, 'na Outland cai 1 Fragmento de Bicicleta');
    Math.random = () => c - 1e-12;
    ok(rolarFragmentoBicicleta(0, 'outland', 1) !== null, 'Outland ×1: cai logo abaixo da chance');
    Math.random = () => c;
    ok(rolarFragmentoBicicleta(0, 'outland', 1) === null, 'Outland ×1: não cai na chance exata');
    Math.random = () => c * 8 - 1e-12;
    ok(
      rolarFragmentoBicicleta(0, 'outland', 8) !== null && rolarFragmentoBicicleta(0, 'outland', 1) === null,
      'o degrau da Outland multiplica a chance (×8)',
    );
    Math.random = () => c * 1.5 - 1e-12;
    ok(
      rolarFragmentoBicicleta(50, 'outland', 1) !== null && rolarFragmentoBicicleta(0, 'outland', 1) === null,
      'o Loot Boost de 50% multiplica por 1,5',
    );
  } finally {
    Math.random = original;
  }
}

// ------------------------------------------------------------------ fabricar

secao('Fabricar — soma, sem teto');

ok(CUSTO_FRAGMENTOS_BICICLETA === 10, 'custa 10 fragmentos');
{
  const p = jogador({ [FRAGMENTO_BICICLETA_ID]: 9 });
  ok(fabricarBicicletaComFragmentos(p) === null && p.items[FRAGMENTO_BICICLETA_ID] === 9, 'com 9 não fabrica e não gasta nada');
}
{
  const p = jogador({ [FRAGMENTO_BICICLETA_ID]: 23 });
  const rar = fabricarBicicletaComFragmentos(p);
  ok(RARIDADES_BICICLETA.some((r) => r.id === rar) && p.items[FRAGMENTO_BICICLETA_ID] === 13, 'com 23 gasta 10, sobram 13 e sai uma raridade');
}
{
  const p = jogador({ [FRAGMENTO_BICICLETA_ID]: 10 });
  fabricarBicicletaComFragmentos(p);
  ok(!(FRAGMENTO_BICICLETA_ID in p.items), 'gastar o último fragmento apaga a linha da bolsa');
}
{
  const p = ciclista([bike(1, 'lendaria'), bike(2, 'comum'), bike(3, 'comum'), bike(4, 'lendaria'), bike(5, 'rara', true)]);
  const q = bicicletasDoJogador(p);
  ok(
    q.comum === 2 && q.lendaria === 2 && Object.keys(q).length === 2,
    'quem já tem bicicleta continua ganhando: 2 Comuns e 2 Lendárias, cada uma com o seu número',
  );
  ok(!('rara' in q), 'a anunciada no Mercado não conta como bicicleta na mão');
}

// -------------------------------------------------------------- a equipada

secao('Várias na bolsa, UMA equipada, sem somar');

{
  const p = ciclista([bike(11, 'comum'), bike(12, 'comum'), bike(13, 'incomum'), bike(14, 'lendaria')]);
  ok(bicicletaEquipada(p) === null && fatorPassoBicicleta(p) === 1, 'ter bicicletas não é ter uma equipada: a pé até escolher');

  ok(equiparBicicleta(p, 11).ok && fatorPassoBicicleta(p) === 1.15, 'Comum #11 equipada com Incomum e Lendária na bolsa: +15%, não +140%');
  ok(equiparBicicleta(p, 14).ok && bicicletaEquipada(p)?.id === 14 && fatorPassoBicicleta(p) === 2, 'equipar a Lendária #14 SUBSTITUI a Comum: +100%');
  ok(p.automation.bicicletaEquipada === 14, 'a escolha é UM número — não há como guardar duas equipadas');

  ok(equiparBicicleta(p, null).ok && bicicletaEquipada(p) === null && fatorPassoBicicleta(p) === 1, 'null guarda a bicicleta: a pé');

  const naoTem = equiparBicicleta(p, 99);
  ok(!naoTem.ok && naoTem.erro === 'bicicleta.naoTem' && p.automation.bicicletaEquipada === null, 'não equipa número que não é dele — e nada muda');

  for (const [v, nome] of [['lendaria', '"lendaria" (raridade no lugar do número)'], [[14], '[14]'], [{ id: 14 }, 'objeto'], [0, '0'], [-14, '−14'], [14.5, '14,5'], [true, 'true'], ['', 'string vazia'], ['14abc', '"14abc"'], [undefined, 'undefined']]) {
    const r = equiparBicicleta(p, v);
    ok(!r.ok && r.erro === 'bicicleta.invalida' && p.automation.bicicletaEquipada === null, `número adulterado ${nome} → recusado`);
  }
}
{
  const rara = bike(21, 'rara');
  const p = ciclista([rara, bike(22, 'rara')], { bicicletaEquipada: 21 });
  ok(fatorPassoBicicleta(p) === 1.5, 'Rara #21 equipada: +50%');
  rara.anunciada = true; // anunciou no Mercado
  ok(bicicletaEquipada(p) === null && fatorPassoBicicleta(p) === 1, 'a equipada foi anunciada: deixa de valer na hora — a outra Rara (#22) não entra no lugar sozinha');
  rara.anunciada = false; // cancelou o anúncio
  ok(bicicletaEquipada(p)?.id === 21 && fatorPassoBicicleta(p) === 1.5, 'cancelou o anúncio: volta equipada');
  p.bicicletas = p.bicicletas.filter((b) => b !== rara); // vendida
  ok(bicicletaEquipada(p) === null && fatorPassoBicicleta(p) === 1, 'vendida: a pé');
}
ok(
  raridadeBicicletaValida('mitica') === 'mitica' && raridadeBicicletaValida('x') === null && raridadeBicicletaValida(null) === null,
  'raridadeBicicletaValida: só id de raridade',
);
ok(fatorPassoBicicleta(ciclista([bike(5, 'lendaria')], { bicicletaEquipada: [5] })) === 1, 'jsonb torto na equipada (array) não vale nada');

secao('A conta de antes da numeração');

{
  ok(equipadaGravada('mitica') === 'mitica' && equipadaGravada(7) === 7 && equipadaGravada('7') === 7, 'na carga, a equipada gravada passa como raridade (conta antiga) ou como número');
  ok(equipadaGravada(['mitica']) === null && equipadaGravada('divina') === null && equipadaGravada(0) === null, 'o resto vira a pé');
  const p = ciclista([bike(40, 'mitica'), bike(31, 'mitica'), bike(30, 'lendaria')], { bicicletaEquipada: 'mitica' });
  ok(fatorPassoBicicleta(p) === 1, 'enquanto é raridade, não dá velocidade');
  ok(resolverEquipadaLegada(p) && p.automation.bicicletaEquipada === 31 && fatorPassoBicicleta(p) === 1.75,
    'a Mítica equipada vira a Mítica de MENOR número na mão (#31): a mesma velocidade de antes, sem clique');
  ok(!resolverEquipadaLegada(p), 'já resolvida, não muda de novo');
  const semEla = ciclista([bike(50, 'comum')], { bicicletaEquipada: 'lendaria' });
  ok(resolverEquipadaLegada(semEla) && semEla.automation.bicicletaEquipada === null, 'sem nenhuma daquela raridade na mão: a pé');
  ok(
    JSON.stringify(bicicletasNaBolsa({ [B.rara]: 2, [B.comum]: 0, 11: 3 })) === JSON.stringify([{ raridade: 'rara', itemId: B.rara, qtd: 2 }]),
    'bicicleta-item que reaparece na bolsa é achada para ser numerada',
  );
}

// ------------------------------------------------------------------ os itens

secao('Os itens, o NPC, o Mercado e a bolsa');

{
  const ids = ITENS_NOSSOS.map((i) => i.id);
  ok(new Set(ids).size === ids.length, `nenhum id repetido entre os ${ids.length} itens nossos`);
}
const novos = [FRAGMENTO_BICICLETA_ID, ...Object.values(B)];
ok(JSON.stringify(novos) === '[70013,70080,70081,70082,70083,70084]', 'ids: fragmento 70013, bicicletas 70080…70084');
for (const id of novos) {
  const it = itens.get(id);
  ok(!!it && it.npcPrice === 0 && !itemVendavelAoNpc(it), `${it?.name ?? id}: no catálogo e NÃO vende ao NPC`);
  ok(itemAnunciavelMercado(it), `${it?.name ?? id}: negociável no Mercado da Comunidade`);
  ok(!!it?.icon && existsSync(join(raiz, 'src/client', it.icon)), `${it?.name ?? id}: o ícone ${it?.icon} existe`);
}
ok(categoriaMercado(itens.get(FRAGMENTO_BICICLETA_ID)) === 'fragment', 'o fragmento cai na aba Fragmentos');
ok(Object.values(B).every((id) => categoriaMercado(itens.get(id)) === 'bicicleta'), 'as bicicletas caem na aba Bicicletas');
ok(
  CATEGORIAS_MERCADO.includes('bicicleta') && itensDaCategoria('bicicleta').length === 5 && itensDaCategoria('fragment').includes(FRAGMENTO_BICICLETA_ID),
  'a aba existe e lista as 5; a de Fragmentos inclui o novo',
);
ok(!ehItemBicicleta(FRAGMENTO_BICICLETA_ID) && ehItemBicicleta(70084), 'ehItemBicicleta: bicicleta sim, fragmento não');
{
  const app = readFileSync(join(raiz, 'src/client/app.js'), 'utf8');
  const raro = app.slice(app.indexOf('function ehRaroBolsa'), app.indexOf('function categoriaBolsa'));
  ok(/FRAGMENTO_BICICLETA_ID/.test(raro) && /RAR_POR_BICICLETA_ITEM\[id\]/.test(raro), 'fragmento e bicicletas caem em Itens Raros na bolsa');
  ok(/grade\.appendChild\(cardBicicletaDaBolsa\(ent\.bici\)\);/.test(app), 'a bolsa mostra um card por bicicleta, com o número');
  ok(/const acao = \(\) => pedirEquiparBicicleta\(equipada \? null : bici\);/.test(app) && /t: 'bicicleta\.equipar', bicicletaId: bici \? bici\.id : null \}/.test(app),
    'clicar na equipada guarda; clicar em outra troca pelo número (depois de confirmar)');
  ok(/if \(bici\.anunciada\) return el;/.test(app), 'a bicicleta anunciada não se equipa pela bolsa');
}

// ------------------------------------------------------------ TM elemental

secao('TM elemental: um ícone por tipo');

{
  const tipos = ['bug', 'dark', 'dragon', 'electric', 'fairy', 'fighting', 'fire', 'flying', 'ghost', 'grass',
    'ground', 'ice', 'normal', 'poison', 'psychic', 'rock', 'steel', 'water'];
  const faltando = tipos.filter((t) => !existsSync(join(raiz, 'src/client/img/itens/tm', `${t}.png`)));
  ok(!faltando.length, 'os 18 PNGs estão em img/itens/tm/', faltando.join(', '));
  const discos = [...itens.values()].filter((i) => /^[A-Za-z]+-Type TM Disk$/.test(i.name ?? ''));
  ok(discos.length === 18, `o catálogo tem 18 discos elementais (achei ${discos.length})`);
  const semArte = discos.filter((i) => {
    const tipo = /^([A-Za-z]+)-Type/.exec(i.name)[1].toLowerCase();
    return !existsSync(join(raiz, 'src/client/img/itens/tm', `${tipo}.png`));
  });
  ok(!semArte.length, 'todo disco elemental do catálogo acha o PNG do próprio tipo', semArte.map((i) => i.name).join(', '));
  const app = readFileSync(join(raiz, 'src/client/app.js'), 'utf8');
  ok((app.match(/aplicarIconesTmElemental\(\);/g) ?? []).length === 2, 'o cliente aplica os ícones nas duas cargas do catálogo');
}

// ---------------------------------------------------------- onde vale

secao('Onde a velocidade vale');

{
  const sim = readFileSync(join(raiz, 'src/server/sim.mjs'), 'utf8');
  ok(/campo\.velocidade = p\.huntSlug && !p\.boss \? fatorPassoBicicleta\(p\) : 1;/.test(sim), 'o sim só põe a velocidade na hunt (boss = 1)');
  ok(sim.indexOf('campo.velocidade = ') < sim.indexOf('const encostado = moverCampo(campo, t);'), '… e põe ANTES de mover o campo');
  ok(/rolarFragmentoBicicleta\(bonusLootPct\(p, t\), hunt\?\.area, multOutland\)/.test(sim), 'o drop usa a área da hunt, o Loot Boost e o degrau da Outland');
  ok(/'bicicleta\.equipar':[\s\S]{0,200}let pedida = m\.bicicletaId;[\s\S]{0,1500}equiparBicicleta\(p, pedida\)/.test(sim), 'o handler de equipar passa pelo validador');
  ok(/bicicletaEquipada: equipadaGravada\(jogador\.automation\?\.bicicletaEquipada\)/.test(sim), 'a equipada gravada no banco passa pelo validador na carga');
  ok(!/temBicicletaInventario|jaPossuiComprar|jaPossuiCancelar|bicicleta\.anuncioUma/.test(sim), 'sem trava de "uma por vez" no Mercado nem na fabricação');

  const campo = readFileSync(join(raiz, 'src/server/game/campo.mjs'), 'utf8');
  ok(
    /darPasso\(h, passo\.cx, passo\.cy, agora, passoComBicicleta\(MS_PASSO_HEROI, campo\.velocidade\)\)/.test(campo)
      && /darPasso\(tr, passo\.cx, passo\.cy, agora, passoComBicicleta\(MS_PASSO_TREINADOR, campo\.velocidade\)\)/.test(campo),
    'o campo usa o passo com bicicleta no pokémon e no treinador',
  );
  const outros = ['pvp.mjs', 'guild-pvp-sim.mjs', 'ginasios.mjs', 'pvp-ranqueado.mjs']
    .filter((f) => /bicicleta|fatorPasso|passoComBicicleta/i.test(readFileSync(join(raiz, 'src/server/game', f), 'utf8')));
  ok(!outros.length, 'PvP, Guild, Ginásio e ranqueado (simuladores próprios) não conhecem a bicicleta', outros.join(', '));
}

// ------------------------------------------------------------------ i18n

secao('Textos nas três línguas');

{
  const chaves = [
    'item.fragmentoBicicleta', ...RARIDADES_BICICLETA.map((r) => `item.bicicleta.${r.id}`),
    'tm.abaBicicleta', 'cm.catBicicleta', 'bicicleta.velocidade', 'bicicleta.fabricar', 'bicicleta.fabFaltam',
    'bicicleta.fabIntro', 'bicicleta.fabRegra', 'bicicleta.suaAtual', 'bicicleta.nenhumaEquipada',
    'bicicleta.faltamFragmentos', 'bicicleta.fabricada', 'bicicleta.equipadaSelo', 'bicicleta.equiparDica',
    'bicicleta.desequiparDica', 'bicicleta.equipadaToast', 'bicicleta.desequipadaToast',
    'bicicleta.invalida', 'bicicleta.naoTem',
    'info.bicicletaIntro', 'info.bicicletaFrag', 'info.bicicletaNota',
  ];
  for (const l of ['pt', 'en', 'es']) {
    const faltam = chaves.filter((k) => typeof _dicionarios[l]?.[k] !== 'string');
    ok(!faltam.length, `${l}: as ${chaves.length} chaves existem`, faltam.join(', '));
  }
  const velhas = ['bicicleta.upgrade', 'bicicleta.mantida', 'bicicleta.anuncioUma', 'bicicleta.jaPossuiAnuncie', 'bicicleta.jaPossuiCancelar', 'bicicleta.jaPossuiComprar'];
  ok(!velhas.some((k) => k in _dicionarios.pt), 'as frases de "uma por vez" saíram do dicionário');
}

{
  // Os três raros da Outland são listados à mão na tela; o de bicicleta tinha ficado de fora.
  const app = readFileSync(join(raiz, 'src/client/app.js'), 'utf8').replace(/\r\n/g, '\n');
  const analyser = app.slice(app.indexOf('function htmlDropsAnalyser'), app.indexOf('function pintarIconesDropsAnalyser'));
  ok(/estado\.bicicletas\?\.fragmento\?\.chanceDrop[\s\S]*\* multOutland/.test(analyser)
    && analyser.includes("linhas.push(linhaDropOutland(fragBicicletaId, 'Bicycle Fragment', chanceFragBicicleta));"),
    'drops da Outland mostram o Fragmento de Bicicleta no Hunt Analyser (chance do servidor × degrau)');
  ok(app.includes("+ linhaDropOutland(fragBicicletaId, 'Bicycle Fragment', chanceFragBicicleta)"),
    'e na tabela de drops da ficha da Pokédex');
}
{
  // O painel Sessão: o contador nasce em 0, soma o drop no abate (tolerando a sessão gravada antes
  // dele existir) e aparece na lista que desenha o painel e alimenta o "Copiar".
  const app = readFileSync(join(raiz, 'src/client/app.js'), 'utf8').replace(/\r\n/g, '\n');
  const nova = app.slice(app.indexOf('const sessaoNova = () => ({'), app.indexOf('});', app.indexOf('const sessaoNova = () => ({')));
  const registrar = app.slice(app.indexOf('function registrarSessao(e) {'), app.indexOf("case 'bossMorto':", app.indexOf('function registrarSessao(e) {')));
  const linhas = app.slice(app.indexOf('function linhasSessao(s) {'), app.indexOf('\n}\n', app.indexOf('function linhasSessao(s) {')));
  ok(nova.includes('fragBicicleta: 0')
    && /s\.fragBicicleta = \(s\.fragBicicleta \?\? 0\)\s*\+ dropsItem\(e\.drops, estado\.bicicletas\?\.fragmento\?\.itemId \?\? FRAGMENTO_BICICLETA_ID, 'Bicycle Fragment'\)/.test(registrar)
    && linhas.includes("[t('sessao.fragBicicleta'), num(s.fragBicicleta ?? 0)]"),
    'o painel Sessão conta o Fragmento de Bicicleta (e aparece no Copiar)');
  const faltam = ['pt', 'en', 'es'].filter((l) => typeof _dicionarios[l]?.['sessao.fragBicicleta'] !== 'string');
  ok(!faltam.length, 'o rótulo do contador existe nas três línguas', faltam.join(', '));
}
console.log(`\n${testes - falhas}/${testes} ok`);
if (falhas) {
  console.log(`${falhas} falha(s)`);
  process.exit(1);
}
