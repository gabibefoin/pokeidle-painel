// Teste das MEGA EVOLUÇÕES — sem banco e sem Redis.
//
// O que este teste protege:
//   · as megas viram espécies #3003…#3658, com as bases e os tipos da pokemondb, sem evolução
//     depois e sem tocar na espécie base (nem nas bases, nem no loot, nem nos golpes);
//   · a arte existe: `80000 + dex` e `85000 + dex` no `outfits-index.json`, nas 32;
//   · o MOVESET da mega é o da espécie base, cópia exata, MAIS um golpe de mega — 600 de poder,
//     30 s de recarga e o tipo primário DELA —, e nada nele é rederivado dos tipos novos;
//   · o número da Pokédex da mega é o pokeId (#3094), e não `3094 % 1000` = Gengar;
//   · a nota nunca cai ao megaevoluir: a mega herda a linhagem da base MAIS um degrau;
//   · os ids das pedras são `71000 + dex` / `72000 + dex`, não colidem com item nenhum, não
//     vendem ao NPC e entram no Mercado da Comunidade na aba MEGA que é só delas — sem levar
//     junto as 21 pedras de evolução de sempre (os fragmentos ficam na aba Fragmentos);
//   · o drop no boss segue a escada pedida — 0,5% e 0,25% no par 0 (nv 300), dobrando no par 1
//     (nv 650) — e o shiny é SEMPRE metade do comum;
//   · fabricar gasta exatamente 10 fragmentos, só com 10, e da família certa; espécie inválida,
//     dex forjado e mega sem shiny são recusados sem cobrar nada;
//   · todo ícone novo existe em disco, e toda chave de texto existe nas três línguas.
//
//   node tools/teste-megas.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  MEGAS,
  MEGA_POKE_BASE,
  dexDaMega,
  elosMegaDaNota,
  isMegaPokeId,
  looktypeMega,
  looktypeMegaShiny,
  megaDaEspecie,
  megaPokeId,
  megaPorPokeId,
  megaTemShiny,
  totalBasesMega,
  GOLPE_MEGA_POR_TIPO,
} from '../src/shared/megas.mjs';
import { chanceFragmentoMegaDoPar, chanceFragmentoMegaShinyDoPar } from '../src/shared/bosses-lendarios.mjs';
import { temSpriteJogo } from '../src/shared/sprite-jogo.mjs';
import { golpesDaFicha, fixarCooldownGolpe600 } from '../src/shared/golpes-especiais.mjs';
import { COOLDOWN_MEGA_MS } from '../src/shared/cooldown-golpes.mjs';
import { chavePokedex } from '../src/shared/pokedex.mjs';
import { notaDePokemon } from '../src/shared/nota-pokemon.mjs';
import {
  ITENS_NOSSOS,
  FRAGMENTO_MEGA_ID,
  FRAGMENTO_MEGA_SHINY_ID,
  MEGA_STONE_POR_DEX,
  MEGA_SHINY_STONE_POR_DEX,
  MEGA_POR_ITEM,
  ehMegaStone,
  CUSTO_FRAGMENTOS_MEGA,
  CUSTO_FRAGMENTOS_MEGA_SHINY,
} from '../src/server/game/itens-nossos.mjs';
import { fabricarMegaStone, megaStoneDeEvolucao, configMega } from '../src/server/game/mega.mjs';
import {
  especies, itens, ITENS_MERCADO, categoriaMercado, itensDaCategoria, CATEGORIAS_MERCADO, looktypeShiny,
} from '../src/server/content.mjs';
import { itemVendavelAoNpc } from '../src/shared/venda-npc-item.mjs';
import { BOSSES } from '../src/server/game/bosses.mjs';
import { _dicionarios } from '../src/client/i18n.mjs';

let testes = 0;
let falhas = 0;
function ok(cond, nome, detalhe = '') {
  testes++;
  if (cond) return console.log(`  ok  ${nome}`);
  falhas++;
  console.log(`  FALHOU  ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const raizRepo = join(raiz, '..');

// ------------------------------------------------------------------ a tabela

console.log('\n— a tabela das megas');
// O ÚNICO número literal do arquivo, de propósito: acrescentar uma mega passa por aqui, e
// isso é uma decisão (mais uma espécie na Pokédex, mais duas pedras no Mercado). Todo o resto
// deriva de `MEGAS.length`.
ok(MEGAS.length === 35, `são 35 megas (${MEGAS.length})`);
ok(new Set(MEGAS.map((m) => m.dex)).size === MEGAS.length, 'nenhum dex repetido');
ok(new Set(MEGAS.map((m) => m.pedra)).size === MEGAS.length, 'nenhum nome de pedra repetido');
ok(new Set(MEGAS.map((m) => m.slug)).size === MEGAS.length, 'nenhum slug repetido');
ok(MEGAS.every((m) => m.tipos.length >= 1 && m.tipos.length <= 2), 'toda mega tem 1 ou 2 tipos');
ok(
  MEGAS.every((m) => Object.values(m.bases).every((v) => Number.isInteger(v) && v > 0)),
  'as seis bases são inteiros positivos em todas',
);
ok(MEGAS.every(megaTemShiny), `as ${MEGAS.length} têm forma shiny`);
// A guarda continua de pé para a próxima mega que chegar só com a arte comum — foi o caso do
// Aggron no dia em que as megas entraram.
ok(megaTemShiny({ semShiny: false }) && !megaTemShiny({ semShiny: true }), 'e `semShiny` ainda barra quem não tiver');

// Os números que a pokemondb dá, conferidos em três megas de perfis bem diferentes: a que só
// ganha Sp. Atk, a que troca ataque por defesa e a que muda de tipo.
const porSlug = Object.fromEntries(MEGAS.map((m) => [m.slug, m]));
ok(porSlug.alakazam.bases.spAtk === 175, 'Mega Alakazam com 175 de Sp. Atk');
ok(porSlug.aggron.bases.def === 230 && porSlug.aggron.tipos.join('/') === 'STEEL', 'Mega Aggron 230 DEF, só STEEL');
ok(porSlug.gyarados.tipos.join('/') === 'WATER/DARK', 'Mega Gyarados vira WATER/DARK');
ok(porSlug.ampharos.tipos.join('/') === 'ELECTRIC/DRAGON', 'Mega Ampharos ganha DRAGON');
ok(porSlug.charizard.tipos.join('/') === 'FIRE/FLYING', 'a Charizard da pasta é a Y (FIRE/FLYING)');
ok(porSlug.charizard.pedra === 'Charizardite Y', 'e a pedra dela é a Charizardite Y');

// ------------------------------------------------------- a faixa #3000 e o dex

console.log('\n— a faixa #3000');
ok(megaPokeId(3) === 3003 && megaPokeId(94) === 3094, 'pokeId da mega = 3000 + dex');
ok(MEGAS.every((m) => isMegaPokeId(megaPokeId(m.dex))), 'todas caem na faixa das megas');
ok(!isMegaPokeId(2001) && !isMegaPokeId(13094) && !isMegaPokeId(94), 'Outland, Orre e o nacional ficam fora da faixa');
ok(dexDaMega(94) === 94, 'o Gengar nacional aponta para a mega dele');
ok(dexDaMega(13094) === 94, 'e o clone de Orre também');
ok(dexDaMega(2001) === null, 'variante de Outland NÃO megaevolui');
ok(dexDaMega(3094) === null, 'e a própria mega não megaevolui de novo');
ok(megaPorPokeId(3094)?.slug === 'gengar', 'o caminho de volta acha a ficha pelo pokeId');
// O `% 1000` do `dexDoPokeId` do cliente transformaria #3094 em #094 — o Gengar comum. A
// chave da Pokédex é o pokeId inteiro, como na Outland.
ok(chavePokedex(3094) === 3094, 'a chave da Pokédex da mega é o pokeId, não o dex da base');

// ------------------------------------------------------ as espécies no catálogo

console.log('\n— as espécies no catálogo');
const megasNoCatalogo = MEGAS.map((m) => especies.get(megaPokeId(m.dex)));
ok(megasNoCatalogo.every(Boolean), `as ${MEGAS.length} estão no catálogo`);
ok(megasNoCatalogo.every((e) => e.evolvesToId === 0), 'nenhuma mega evolui depois');
ok(megasNoCatalogo.every(temSpriteJogo), 'todas passam no teste de sprite do jogo');
for (const m of MEGAS) {
  const mega = especies.get(megaPokeId(m.dex));
  const base = especies.get(m.dex);
  if (!mega || !base) continue;
  const basesOk = mega.baseHp === m.bases.hp && mega.baseAtk === m.bases.atk
    && mega.baseDef === m.bases.def && mega.baseSpAtk === m.bases.spAtk
    && mega.baseSpDef === m.bases.spDef && mega.baseSpeed === m.bases.speed;
  if (!basesOk) ok(false, `${m.nome}: bases do catálogo batem com a tabela`);
}
ok(true, 'as bases do catálogo batem com a tabela em todas');

// A base não pode sair diferente do que era: a mega é uma cópia, não uma mutação.
const gengar = especies.get(94);
ok(gengar.baseSpAtk === 130 && gengar.name === 'Gengar', 'o Gengar comum continua com 130 de Sp. Atk');
ok(gengar.loot !== especies.get(3094).loot, 'o loot da mega é uma CÓPIA (não a mesma referência)');
ok(gengar.attacks !== especies.get(3094).attacks, 'os golpes da mega são uma CÓPIA');

// ------------------------------------------------------------- o moveset
//
// A regra: o moveset da mega é o da base, CÓPIA EXATA, mais UM golpe de mega. O caminho que
// se mede aqui é o da FICHA (`golpesDaFicha`), e não o do catálogo — era ele que divergia:
// a ficha rodava o injetor de golpes de 600 de novo e derivava do TIPO NOVO da mega, dando a
// Mega Gyarados (WATER/DARK) um golpe de DARK que o Gyarados (WATER/FLYING) não tem.

console.log('\n— o moveset: o da base, mais o golpe de mega');
const forasDaRegra = [];
for (const m of MEGAS) {
  const base = especies.get(m.dex);
  const mega = especies.get(megaPokeId(m.dex));
  if (!base || !mega) continue;
  const nomesBase = (base.attacks ?? []).map((a) => a.name);
  const daFicha = golpesDaFicha(mega);
  const nomesFicha = daFicha.map((a) => a.name);
  const aMais = nomesFicha.filter((x) => !nomesBase.includes(x));
  const sumiram = nomesBase.filter((x) => !nomesFicha.includes(x));
  const golpe = daFicha.find((a) => a.golpeMega);
  const seiscentos = daFicha.filter((a) => a.power >= 600);
  const problemas = [];
  if (sumiram.length) problemas.push(`perdeu ${sumiram.join(',')}`);
  if (aMais.length !== 1) problemas.push(`${aMais.length} golpes a mais`);
  if (!golpe) problemas.push('sem golpe de mega');
  else {
    if (golpe.power !== 600) problemas.push(`poder ${golpe.power}`);
    if (golpe.cooldownMs !== COOLDOWN_MEGA_MS) problemas.push(`cd ${golpe.cooldownMs}`);
    if (golpe.type !== m.tipos[0]) problemas.push(`tipo ${golpe.type} ≠ ${m.tipos[0]}`);
    if (golpe.name !== GOLPE_MEGA_POR_TIPO[m.tipos[0]]) problemas.push(`nome ${golpe.name}`);
  }
  if (seiscentos.length !== 3) problemas.push(`${seiscentos.length} golpes de 600`);
  if (problemas.length) forasDaRegra.push(`${m.slug}: ${problemas.join(' · ')}`);
}
ok(!forasDaRegra.length, `nas ${MEGAS.length}, a ficha = golpes da base + 1 golpe de mega de 600/30s`, forasDaRegra.slice(0, 4).join(' | '));
ok(
  MEGAS.every((m) => especies.get(m.dex).attacks.filter((a) => a.power >= 600).length === 2),
  'e a espécie base continua com os DOIS golpes de 600 de sempre',
);
// O cooldown é guardado pelo NOME do golpe (`cdGolpes[g.name]`): um nome repetido faria dois
// golpes dividirem o mesmo relógio. "Mega Drain", "Mega Kick" e "Mega Punch" existem no
// catálogo e por isso não entram na tabela.
const nomesDoCatalogo = new Set();
for (const e of especies.values()) for (const a of e.attacks ?? []) nomesDoCatalogo.add(a.name);
const nomesMega = Object.values(GOLPE_MEGA_POR_TIPO);
ok(new Set(nomesMega).size === 18, 'os 18 nomes de golpe de mega são distintos entre si');
const colididos = nomesMega.filter((nome) => {
  // O próprio golpe já está no catálogo agora (as megas são espécies): colide se algum
  // pokémon que NÃO é mega usar o nome.
  for (const e of especies.values()) {
    if (e.megaDeDex != null) continue;
    if ((e.attacks ?? []).some((a) => a.name === nome)) return true;
  }
  return false;
});
ok(!colididos.length, 'e nenhum colide com golpe de espécie não-mega', colididos.join(', '));
// A guarda do cooldown: sem `cdFixo`, `fixarCooldownGolpe600` devolveria o golpe para 60 s.
{
  const cobaia = { attacks: [{ name: 'x', power: 600, cooldownMs: COOLDOWN_MEGA_MS, cdFixo: true }] };
  fixarCooldownGolpe600(cobaia);
  ok(cobaia.attacks[0].cooldownMs === COOLDOWN_MEGA_MS, '`cdFixo` protege os 30 s do golpe de mega');
  const semMarca = { attacks: [{ name: 'x', power: 600, cooldownMs: COOLDOWN_MEGA_MS }] };
  fixarCooldownGolpe600(semMarca);
  ok(semMarca.attacks[0].cooldownMs === 60_000, 'e sem a marca ele volta para os 60 s de todo golpe de 600');
}

// ---------------------------------------------------------------- a arte

console.log('\n— a arte');
const indice = JSON.parse(
  readFileSync(join(raizRepo, 'public', 'data', 'asset-packs', 'outfits-index.json'), 'utf8'),
).outfits;
const semArte = MEGAS.filter((m) => !indice[String(looktypeMega(m.dex))]);
ok(!semArte.length, `as ${MEGAS.length} têm atlas publicado`, semArte.map((m) => m.slug).join(', '));
const semShinyArte = MEGAS.filter((m) => megaTemShiny(m) && !indice[String(looktypeMegaShiny(m.dex))]);
ok(!semShinyArte.length, `as ${MEGAS.length} têm atlas shiny`, semShinyArte.map((m) => m.slug).join(', '));
ok(!!indice[String(looktypeMegaShiny(306))], 'inclusive o Mega Aggron, que chegou por último');
ok(
  MEGAS.every((m) => looktypeShiny(megaPokeId(m.dex)) === (megaTemShiny(m) ? looktypeMegaShiny(m.dex) : null)),
  'o catálogo shiny devolve o looktype mega-shiny certo (e null no Aggron)',
);

// --------------------------------------------------- a nota nunca cai ao megaevoluir

console.log('\n— a nota nunca cai');
const elos = elosMegaDaNota([...especies.values()]);
ok(elos.length === MEGAS.length, `um elo base → mega por mega (${elos.length}/${MEGAS.length})`);
let notasPiores = [];
for (const m of MEGAS) {
  const base = especies.get(m.dex);
  const mega = especies.get(megaPokeId(m.dex));
  if (!base || !mega) continue;
  // O nascimento que mais sofria com a troca de régua: IV no teto e o resto no piso.
  const nascimento = {
    ivs: { hp: 31, atk: 31, def: 31, spAtk: 31, spDef: 31, speed: 31 },
    quality: 1,
    potencia: 1,
    shiny: false,
  };
  const antes = notaDePokemon(nascimento, base);
  const depois = notaDePokemon(nascimento, mega);
  if (depois < antes) notasPiores.push(`${m.nome} ${antes.toFixed(2)} → ${depois.toFixed(2)}`);
}
ok(!notasPiores.length, 'megaevoluir nunca derruba o N=', notasPiores.join(' · '));

// ------------------------------------------------------------------ as pedras

console.log('\n— as pedras e os fragmentos');
ok(MEGA_STONE_POR_DEX[94] === 71094, 'a Gengarite é o item 71094 (71000 + dex)');
ok(MEGA_SHINY_STONE_POR_DEX[94] === 72094, 'a Shiny Gengarite é o 72094 (72000 + dex)');
ok(MEGA_SHINY_STONE_POR_DEX[306] === 72306, 'a Shiny Aggronite existe (72000 + 306)');
ok(Object.keys(MEGA_STONE_POR_DEX).length === MEGAS.length, `uma Mega Stone por mega (${Object.keys(MEGA_STONE_POR_DEX).length})`);
ok(Object.keys(MEGA_SHINY_STONE_POR_DEX).length === MEGAS.filter(megaTemShiny).length, `uma Shiny por mega com arte shiny (${Object.keys(MEGA_SHINY_STONE_POR_DEX).length})`);
const idsNossos = ITENS_NOSSOS.map((i) => i.id);
ok(new Set(idsNossos).size === idsNossos.length, 'nenhum id de item nosso colide');
const nomesNossos = ITENS_NOSSOS.map((i) => i.name);
ok(new Set(nomesNossos).size === nomesNossos.length, 'nenhum nome de item nosso colide');
ok(ehMegaStone(71094) && ehMegaStone(72094) && !ehMegaStone(70012), 'ehMegaStone separa as pedras do resto');
ok(MEGA_POR_ITEM.get(72094)?.shiny === true, 'o caminho de volta sabe que a 72094 é shiny');

const pedrasItens = [...Object.values(MEGA_STONE_POR_DEX), ...Object.values(MEGA_SHINY_STONE_POR_DEX)];
ok(pedrasItens.every((id) => itens.has(id)), 'toda pedra existe no catálogo de itens');
ok(pedrasItens.every((id) => ITENS_MERCADO.has(id)), 'toda pedra é negociável no Mercado');
ok(
  pedrasItens.every((id) => categoriaMercado(itens.get(id)) === 'mega'),
  'e cai na aba MEGA da vitrine (não na de Pedras)',
);
// A aba nova não pode ter levado junto as 21 pedras de evolução de sempre.
const fireStone = [...itens.values()].find((i) => i.name === 'Fire Stone');
ok(categoriaMercado(fireStone) === 'stone', 'e a Fire Stone continua na aba Pedras');
ok(CATEGORIAS_MERCADO.includes('mega'), 'a aba `mega` existe na lista do welcome');
ok(
  itensDaCategoria('mega').length === pedrasItens.length,
  `a aba MEGA lista as ${pedrasItens.length} pedras`,
  String(itensDaCategoria('mega').length),
);
ok(
  !itensDaCategoria('stone').some((id) => pedrasItens.includes(id)),
  'e nenhuma mega sobrou na aba Pedras',
);
ok(
  pedrasItens.every((id) => !itemVendavelAoNpc(itens.get(id), {})),
  'nenhuma pedra se vende ao NPC',
);
for (const id of [FRAGMENTO_MEGA_ID, FRAGMENTO_MEGA_SHINY_ID]) {
  ok(ITENS_MERCADO.has(id), `o fragmento ${id} é negociável no Mercado`);
  ok(categoriaMercado(itens.get(id)) === 'fragment', `e cai na aba Fragmentos`);
  ok(!itemVendavelAoNpc(itens.get(id), {}), `e não se vende ao NPC`);
}

// --------------------------------------------------------------- os ícones

console.log('\n— os ícones em disco');
const cliente = join(raiz, 'src', 'client');
const faltaIcone = [];
for (const id of [FRAGMENTO_MEGA_ID, FRAGMENTO_MEGA_SHINY_ID, ...pedrasItens]) {
  const icon = itens.get(id)?.icon ?? '';
  if (!icon.startsWith('/img/')) {
    faltaIcone.push(`${id}: ícone fora de /img/`);
    continue;
  }
  if (!existsSync(join(cliente, icon.slice(1)))) faltaIcone.push(icon);
}
ok(!faltaIcone.length, 'os 65 ícones novos existem em disco', faltaIcone.slice(0, 5).join(', '));

// ---------------------------------------------------------- o drop no boss

console.log('\n— o drop no boss');
ok(chanceFragmentoMegaDoPar(0) === 0.005, 'par 0 (nv 300) → 0,5% de Fragmento de Mega Stone');
ok(chanceFragmentoMegaDoPar(1) === 0.01, 'par 1 (nv 650) → 1%');
ok(chanceFragmentoMegaDoPar(2) === 0.015, 'par 2 → 1,5%');
ok(chanceFragmentoMegaShinyDoPar(0) === 0.0025, 'par 0 → 0,25% de Fragmento de Mega Shiny Stone');
ok(chanceFragmentoMegaShinyDoPar(1) === 0.005, 'par 1 → 0,5%');
ok(
  [0, 1, 2, 5, 12].every((par) => chanceFragmentoMegaShinyDoPar(par) === chanceFragmentoMegaDoPar(par) / 2),
  'o shiny é sempre metade do comum',
);
const bosses = Object.values(BOSSES);
ok(
  bosses.every((b) => b.drops.some((d) => d.itemId === FRAGMENTO_MEGA_ID)
    && b.drops.some((d) => d.itemId === FRAGMENTO_MEGA_SHINY_ID)),
  `os ${bosses.length} bosses dropam os dois fragmentos`,
);

// ------------------------------------------------------------- a fabricação

console.log('\n— a bancada do Professor');
ok(CUSTO_FRAGMENTOS_MEGA === 10 && CUSTO_FRAGMENTOS_MEGA_SHINY === 10, 'as duas custam 10 fragmentos');

const jogador = (items) => ({ items: { ...items } });

let p = jogador({ [FRAGMENTO_MEGA_ID]: 9 });
ok(fabricarMegaStone(p, 94, false).erro, 'com 9 fragmentos não fabrica');
ok(p.items[FRAGMENTO_MEGA_ID] === 9, 'e não cobra nada na recusa');

p = jogador({ [FRAGMENTO_MEGA_ID]: 10 });
let r = fabricarMegaStone(p, 94, false);
ok(!r.erro && r.itemId === 71094, 'com 10 fabrica a Gengarite');
ok(p.items[FRAGMENTO_MEGA_ID] === undefined, 'gasta exatamente os 10 (some da bolsa)');
ok(p.items[71094] === 1, 'e credita 1 pedra');

p = jogador({ [FRAGMENTO_MEGA_ID]: 30 });
ok(fabricarMegaStone(p, 94, true).erro, 'fragmento comum NÃO compra a pedra shiny');
ok(p.items[FRAGMENTO_MEGA_ID] === 30, 'e não cobra nada nessa recusa');

p = jogador({ [FRAGMENTO_MEGA_SHINY_ID]: 10 });
r = fabricarMegaStone(p, 94, true);
ok(!r.erro && r.itemId === 72094, 'o fragmento shiny compra a Shiny Gengarite');

p = jogador({ [FRAGMENTO_MEGA_SHINY_ID]: 10 });
ok(!fabricarMegaStone(p, 306, true).erro, 'a Shiny Aggronite fabrica normalmente');
// A recusa de mega sem shiny continua coberta pela unidade, sem depender de qual mega é hoje:
ok(!!fabricarMegaStone(jogador({ [FRAGMENTO_MEGA_SHINY_ID]: 10 }), 1, true).erro, 'e uma espécie sem mega segue recusada');

for (const forjado of [0, -1, 99999, 3094, 2001, '94; DROP', null, undefined, NaN, 1.5]) {
  const q = jogador({ [FRAGMENTO_MEGA_ID]: 50 });
  const res = fabricarMegaStone(q, forjado, false);
  if (!res.erro || q.items[FRAGMENTO_MEGA_ID] !== 50) {
    ok(false, `dex forjado recusado sem cobrar: ${String(forjado)}`);
  }
}
ok(true, 'dex forjado (0, negativo, mega, Outland, string, NaN, fração) é recusado sem cobrar');

// `'94'` em string É o que o cliente manda num input — tem de funcionar, mas por `Number`.
p = jogador({ [FRAGMENTO_MEGA_ID]: 10 });
ok(!fabricarMegaStone(p, '94', false).erro, 'dex como string numérica é aceito (vem do JSON do socket)');

// ---------------------------------------------------- a pedra que cada um pede

console.log('\n— a pedra de cada pokémon');
ok(megaStoneDeEvolucao(94, false)?.itemId === 71094, 'Gengar comum pede a Gengarite');
ok(megaStoneDeEvolucao(94, true)?.itemId === 72094, 'Gengar shiny pede a Shiny Gengarite');
ok(megaStoneDeEvolucao(13094, false)?.itemId === 71094, 'o clone de Orre pede a mesma pedra');
ok(megaStoneDeEvolucao(306, true)?.itemId === 72306, 'Aggron shiny pede a Shiny Aggronite');
ok(megaStoneDeEvolucao(25, false) === null, 'Pikachu não tem mega');
ok(megaStoneDeEvolucao(2001, false) === null, 'variante de Outland não tem mega');
ok(megaStoneDeEvolucao(3094, false) === null, 'a mega não megaevolui de novo');
ok(megaStoneDeEvolucao(94, false)?.megaPokeId === 3094, 'a pedra aponta para a espécie #3094');

const cfg = configMega();
ok(cfg.pedras.length === MEGAS.length, `o welcome manda as ${MEGAS.length} megas`);
ok(cfg.pedras.filter((x) => x.itemShinyId).length === MEGAS.filter(megaTemShiny).length, 'e todas com pedra shiny');
ok(cfg.fragmentoId === FRAGMENTO_MEGA_ID && cfg.fragmentoShinyId === FRAGMENTO_MEGA_SHINY_ID, 'e os dois fragmentos');
ok(cfg.chanceBase === 0.005 && cfg.chanceBaseShiny === 0.0025, 'e as chances do primeiro par');

// ------------------------------------------------------------------ os textos

console.log('\n— os textos nas três línguas');
const CHAVES = [
  'dex.gerMega', 'painel.mega', 'tm.abaMega', 'tm.abaCurtaMega', 'tm.subMega', 'tm.subMegaShiny',
  'mega.familiaComum', 'mega.familiaShiny', 'mega.escolha', 'mega.faltam', 'mega.buscar',
  'mega.semResultado', 'mega.comoUsar', 'mega.titulo', 'mega.texto', 'mega.textoShiny',
  'mega.confirmar', 'mega.faltaPedra', 'mega.semShiny', 'mega.fabricada', 'mega.feita',
  'info.megaIntro', 'info.megaAviso',
];
for (const lang of ['pt', 'en', 'es']) {
  const faltam = CHAVES.filter((k) => !_dicionarios[lang]?.[k]);
  ok(!faltam.length, `${lang}: as ${CHAVES.length} chaves existem`, faltam.join(', '));
}

// ------------------------------------------------------ o equilíbrio, de olho

console.log('\n— o equilíbrio');
const somaBase = (e) => e.baseHp + e.baseAtk + e.baseDef + e.baseSpAtk + e.baseSpDef + e.baseSpeed;
const piores = MEGAS
  .map((m) => ({ m, ganho: totalBasesMega(m) - somaBase(especies.get(m.dex)) }))
  .filter((x) => x.ganho <= 0);
ok(!piores.length, 'toda mega soma MAIS base que a espécie', piores.map((x) => `${x.m.slug} ${x.ganho}`).join(', '));

console.log('\n==============================================');
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `todos os ${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
