/**
 * As duas pontas contam a mesma história?
 *
 * O cliente monta o catálogo dele do zero em `carregarCatalogoEspecies` (app.js), lendo os
 * mesmos JSONs e sem passar pelo `content.mjs`. Toda regra de evolução e de drop mora em
 * `shared/` justamente por isso, e a ORDEM em que elas são aplicadas é parte do contrato —
 * trocar duas linhas de lugar de um lado só faz a Pokédex prometer um número que o servidor
 * não cobra, que é como Vigoroth e Shelgon apareceram como "não evolui".
 *
 * Este script repete o passo a passo do cliente sobre os arquivos de verdade e compara
 * `evolveLevel` e `loot` espécie a espécie contra o que o servidor carregou. Qualquer número
 * diferente de zero aqui é um bug.
 *
 *   node game/tools/auditoria-catalogo-duas-pontas.mjs
 */
import { readFileSync } from 'node:fs';
import { especies, nivelDeHuntDaEspecie } from '../src/server/content.mjs';
import { herdarLooktypeOrre } from '../src/shared/herdar-looktype-orre.mjs';
import { herdarLooktypeOutland } from '../src/shared/herdar-looktype-outland.mjs';
import { aplicarCadeiasTruncadas, aplicarEvolucoesEntreGeracoes, normalizarEvolveLevel600, corrigirNiveisDeEvolucao } from '../src/shared/evolucoes-cruzadas.mjs';
import { alinharNivelPadraoRamificado } from '../src/shared/evolucoes-ramificadas.mjs';
import { aplicarDropsNossos } from '../src/shared/drops-nossos.mjs';
import { aplicarTetoDeCaptura } from '../src/shared/teto-captura.mjs';
import { injetarGolpesEspeciais } from '../src/shared/golpes-especiais.mjs';
import { normalizarSellValue } from '../src/shared/sell-value.mjs';
import { assentarValorDasEspecies } from '../src/shared/valor-cadeia.mjs';
import { aplicarEconomiaDrop } from '../src/shared/economia-drop.mjs';
import { ehPedraEvolucao, normalizarNpcPriceItem } from '../src/shared/venda-npc-item.mjs';
import { ajustarPrecoEspelho } from '../src/shared/preco-item-espelho.mjs';
import { ITENS_NOSSOS } from '../src/server/game/itens-nossos.mjs';
import { isOutlandPokeId, isEspelhoFantasmaPokeId } from '../src/shared/outland.mjs';
import { ALIAS_NOME_ITEM, resolverNomeItem } from '../src/shared/alias-item.mjs';

const lista = [
  ...JSON.parse(readFileSync('public/data/creatures.json', 'utf8')).creatures,
  ...JSON.parse(readFileSync('game/src/server/dados/creatures-novos.json', 'utf8')).creatures,
];
for (const p of JSON.parse(readFileSync('game/src/server/dados/creatures-sprites-lab.json', 'utf8')).patches ?? []) {
  const c = lista.find((x) => x.pokeId === p.pokeId);
  if (c && p.looktype) c.looktype = p.looktype;
}
herdarLooktypeOrre(lista);
herdarLooktypeOutland(lista);
aplicarCadeiasTruncadas(lista);
normalizarEvolveLevel600(lista);
const cliente = new Map();
for (const c of lista) {
  if (isEspelhoFantasmaPokeId(c.pokeId)) continue;
  // A canonização do NOME do item, que o cliente faz na mesma varredura (`resolverNomeItem` em
  // `carregarCatalogoEspecies`) e o servidor na linha 281 do `content.mjs`. Faltava aqui, e o
  // buraco só não aparecia porque nada dependia do nome: agora o solver da economia de drop
  // busca o PREÇO por ele, e um `band-aid` não resolvido valia zero — a espécie inteira
  // recebia a escala errada.
  for (const l of c.loot ?? []) l.name = resolverNomeItem(l.name);
  injetarGolpesEspeciais(c);
  normalizarSellValue(c);
  if (isOutlandPokeId(c.pokeId)) { c.evolvesToId = 0; c.evolveLevel = 0; }
  cliente.set(c.pokeId, c);
}
aplicarEvolucoesEntreGeracoes(lista);
alinharNivelPadraoRamificado(lista);
corrigirNiveisDeEvolucao(lista);
/**
 * O teto de captura, na MESMA posição em que o cliente o aplica — por último entre os ajustes
 * de evolução. Ele escreve `tetoCaptura` e reescreve `evolveLevel` de Outland+; sair de ordem
 * aqui é exatamente o tipo de divergência que este script existe para pegar.
 *
 * Ressalva conhecida: `EVOLUCOES_RAMIFICADAS` é estado de MÓDULO, e o `import` do
 * `content.mjs` lá em cima já a reescreveu. A comparação continua valendo porque a operação
 * é idempotente, mas uma ordem trocada DENTRO da tabela ramificada não apareceria aqui.
 */
const { estagios } = aplicarTetoDeCaptura(lista, (id) => cliente.get(id));
aplicarDropsNossos(lista);
// As hunts do `welcome` são o `huntsJogaveis` do servidor — `nivelDeHuntDaEspecie` sai delas.
assentarValorDasEspecies(cliente.values(), estagios, nivelDeHuntDaEspecie);

/**
 * O REEQUILÍBRIO DA RENDA, na mesma posição em que o cliente o aplica: depois de o catálogo de
 * espécies estar montado, e com o catálogo de ITENS já em mãos — no app.js ele roda na etapa
 * `carga.itens`, que é a seguinte à das espécies, justamente porque precisa dos preços.
 *
 * O catálogo de itens é remontado AQUI da mesma fonte que o cliente lê (`items.json` do espelho
 * mais os nossos, pelos mesmos dois normalizadores) em vez de reaproveitar o `itens` do
 * servidor: o preço é a entrada do solver, e um preço vindo do lado que está sendo testado não
 * testaria nada.
 */
const itensCliente = new Map(
  [...JSON.parse(readFileSync('public/data/items.json', 'utf8')).items, ...ITENS_NOSSOS]
    .map(normalizarNpcPriceItem)
    .map(ajustarPrecoEspelho)
    .map((i) => [i.name.toLowerCase(), i]),
);
for (const [slug] of ALIAS_NOME_ITEM) {
  const canon = itensCliente.get(resolverNomeItem(slug).toLowerCase());
  if (canon) itensCliente.set(slug, canon);
}
const COMPRAVEIS_NPC = new Set(['heal', 'revive']);
aplicarEconomiaDrop(lista, (nome) => {
  const item = itensCliente.get(String(nome ?? '').toLowerCase());
  if (!item || COMPRAVEIS_NPC.has(item.category) || ehPedraEvolucao(item)) return 0;
  return item.npcPrice ?? 0;
});

/**
 * Divergência de `huntLevel` — PRÉ-EXISTENTE, e a causa raiz de quase toda diferença de loot.
 *
 * Duas fontes de nível moram só no servidor: `AJUSTE_HUNT_LEVEL` (dentro do `content.mjs`) e o
 * degrau que `dados/hunts-sinnoh.json` aplica a quem ganhou hunt lá (Ditto 1 → 1.000, Eevee
 * 20 → 1.000, Blissey 100 → 1.125). O cliente nunca leu nenhuma das duas, então a Pokédex já
 * mostrava XP e valor de venda errados nessas 31 espécies muito antes de existir economia de
 * drop.
 *
 * Agora isso também desalinha o LOOT, porque `shared/economia-drop.mjs` resolve a tabela a
 * partir do nível. Separar a contagem é o que mantém o zero desta auditoria significando "bug
 * novo": misturado, o número nunca mais chegaria a zero e pararia de avisar qualquer coisa.
 *
 * O conserto de verdade é levar as duas fontes de nível para `shared/`, como já aconteceu com
 * evolução, teto de captura e drops nossos. Enquanto isso não acontece, é dívida conhecida.
 */
let difNivelHunt = 0; let difNivel = 0; let difLoot = 0; let difLootMesmoNivel = 0; let conferidos = 0;
for (const [id, cli] of cliente) {
  const srv = especies.get(id);
  if (!srv) continue;
  conferidos++;
  const mesmoNivelHunt = (cli.huntLevel ?? 0) === (srv.huntLevel ?? 0);
  if (!mesmoNivelHunt) difNivelHunt++;
  if ((cli.evolveLevel ?? 0) !== (srv.evolveLevel ?? 0)) {
    difNivel++;
    if (difNivel <= 8) console.log(`  nível difere #${id} ${cli.name}: cliente ${cli.evolveLevel} · servidor ${srv.evolveLevel}`);
  }
  // A quantidade entra na comparação: é o lever da economia de drop (`shared/economia-drop.mjs`),
  // e sem ela uma divergência de `minCount`/`maxCount` entre as pontas passaria batida — a
  // Pokédex prometeria "×3" onde a hunt larga ×20.
  const chaveLoot = (l) => `${l.name}:${l.chance}:${l.minCount ?? 1}-${l.maxCount ?? 1}`;
  const l1 = (cli.loot ?? []).map(chaveLoot).sort().join('|');
  const l2 = (srv.loot ?? []).map(chaveLoot).sort().join('|');
  if (l1 !== l2) {
    difLoot++;
    // Só denuncia quem diverge com o MESMO huntLevel dos dois lados: aí a culpa é de regra,
    // e é bug de verdade. O resto é a dívida de nível explicada acima.
    if (mesmoNivelHunt) {
      difLootMesmoNivel++;
      if (difLootMesmoNivel <= 8) console.log(`  loot difere #${id} ${cli.name}\n     cli ${l1}\n     srv ${l2}`);
    }
  }
}
console.log(`
cliente × servidor, catálogo inteiro (${conferidos} espécies): `
  + `${difNivel} evolveLevel divergentes · ${difLootMesmoNivel} listas de loot divergentes`);
console.log(
  `dívida conhecida (huntLevel só no servidor): ${difNivelHunt} espécies · `
  + `${difLoot - difLootMesmoNivel} listas de loot que divergem por causa dela`,
);
/**
 * As quatro divergências que sobram são anteriores a esta varredura e não têm número certo.
 *
 * `content.mjs` chama `aplicarEscalaHuntLevel(creaturesNovos, ...)` no boot, e essa passagem
 * reescreve `evolveLevel` pela escada das gerações. O cliente não a executa — ele lê o campo
 * como está no JSON. Nas espécies em que o JSON e a escada concordam (a esmagadora maioria,
 * porque `tools/aplicar-escala-hunt-level.mjs` grava a escada no arquivo) ninguém percebe; em
 * Duraludon, Gimmighoul, Dipplin e Poltchageist o JSON traz o 40 do espelho e a escada devolve
 * 132.200, que não é nível de hunt nenhum — é o degrau teórico de um alvo de gen 9 sem hunt.
 *
 * Não conserto aqui porque os quatro alvos (Archaludon, Gholdengo, Hydrapple, Sinistcha) estão
 * com `looktype: 1`: a evolução já é recusada por falta de sprite, antes de o nível ser
 * conferido. A mentira é só na ficha, e o conserto de verdade é nomear as sprites.
 */
console.log('\nCasos denunciados:');
for (const id of [415, 416, 564, 565, 636, 637, 495, 496]) {
  const c = especies.get(id);
  console.log(`  #${id} ${c.name} (${c.type1}${c.type2 ? '/' + c.type2 : ''}) evolui no Nv ${c.evolveLevel ?? '—'} · drops: ${(c.loot ?? []).filter((l) => l.chance > 0).map((l) => `${l.name} ${(l.chance / 1000).toFixed(2)}%`).join(', ')}`);
}
