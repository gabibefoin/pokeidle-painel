// Teste da OFERENDA DE POKÉMON — sem banco e sem Redis.
//
// A roleta é aritmética sobre o catálogo e uma lista de ids, então o contrato inteiro se prova
// sem infra. O que este teste protege:
//
//   · **a promessa da chance.** `P(sair pedra) = pokémon oferecidos ÷ 5`, EXATAMENTE, e sem
//     depender da mistura de tipos. É a invariante que impede o atalho de três dual-type (seis
//     fatias) fecharem o círculo e darem pedra garantida por pouco mais da metade do preço;
//   · **a mistura dos tipos.** dado que saiu pedra, cada uma vale a fração de pokémon que a
//     pediram — o exemplo (2 Charmander, 1 Bulbasaur, 2 Gengar) sai em 2:1:3:2;
//   · **o sorteio é uniforme de verdade.** varrendo os inteiros de `[0, total)` um a um, cada
//     fatia recebe exatamente o seu peso — nenhuma faixa a mais na primeira nem a menos na
//     última (o bug clássico de soma em ponto flutuante);
//   · **as travas.** id repetido, id de outra pessoa, pokémon em campo, na equipe, com Exp. Share,
//     e o último da conta. Cada uma dessas é uma fraude ou uma perda irreversível. O cadeado de
//     venda NÃO está na lista de propósito — ele é do Mercado NPC (ver `validarOferenda`), e este
//     teste guarda justamente o contrário: que o trancado passa;
//   · **a Darkness Stone serve DARK e GHOST** sem contar duas vezes num bicho que é os dois;
//   · **o SHINY paga em Shiny Stone, e só nela.** Shiny Dratini pinta Dragon Shiny Stone e mais
//     nada; Shiny Bulbasaur abre Grass e Poison. E, ao contrário das comuns, as dezoito Shiny
//     Stones NÃO se fundem: um shiny DARK/GHOST pinta duas fatias, porque são dois itens;
//   · **toda pedra do jogo é alcançável** por alguma espécie com spawn — uma pedra que nenhuma
//     roleta pode pintar é uma promessa quebrada no catálogo.
//
//   node tools/teste-oferenda.mjs
import {
  OFERENDA_CASAS,
  montarRoleta,
  sortearFatia,
  pedrasDoPokemon,
  resumoDaRoleta,
} from '../src/shared/oferenda.mjs';
import { idsDaOferenda, validarOferenda, girarOferenda } from '../src/server/game/oferenda.mjs';
import { PEDRA_POR_TIPO, PEDRAS } from '../src/shared/pedras-evolucao.mjs';
import { especies, PEDRA_EVOLUCAO_POR_TIPO } from '../src/server/content.mjs';
import { SHINY_STONE_POR_TIPO, TIPOS_POKEMON } from '../src/server/game/itens-nossos.mjs';
import { XP_SHARE_HELD_ID } from '../src/shared/xp-share-held.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

console.log('OFERENDA DE POKÉMON — a roleta de pedras\n=======================================');

// -------------------------------------------------------------------- fixtures

/** Um pokémon como o sim o tem em memória, só com o que a oferenda lê. */
let proximoId = 1;
const pk = (nome, tipos, extra = {}) => ({
  id: proximoId++,
  nome,
  tipos,
  level: 50,
  slot: null,
  heldItemId: null,
  ...extra,
});

const charmander = () => pk('Charmander', ['FIRE']);
const bulbasaur = () => pk('Bulbasaur', ['GRASS', 'POISON']);
const gengar = () => pk('Gengar', ['GHOST', 'POISON']);
const umbreon = () => pk('Umbreon', ['DARK']);

/** Jogador de mentira: só a coleção, o ativo e a bolsa. */
function jogador(lista, { activeId = null, travados = [] } = {}) {
  return {
    pokemons: new Map(lista.map((k) => [k.id, k])),
    activeId,
    items: {},
    automation: { pokemonTravado: [...travados] },
  };
}
/** As duas prateleiras, como o sim as passa. */
const PEDRAS_DAS_DUAS = { normal: PEDRA_EVOLUCAO_POR_TIPO, shiny: SHINY_STONE_POR_TIPO };
const validar = (p, ids) => validarOferenda(p, ids, { pedras: PEDRAS_DAS_DUAS });

const fatia = (roleta, nome) => roleta.fatias.find((f) => f.nome === nome) ?? null;
const vazio = (roleta) => roleta.fatias.find((f) => f.vazio) ?? null;
const peso = (roleta, nome) => fatia(roleta, nome)?.peso ?? 0;

// ------------------------------------------------------------- o desenho pedido

secao('A roleta tem CINCO casas');

// Eram dez até 16/09/2026. O número é de design, e é ele que decide o preço de uma pedra.
ok(OFERENDA_CASAS === 5, 'cinco casas', String(OFERENDA_CASAS));

secao('O exemplo: 2 Charmander + 1 Bulbasaur + 2 Gengar');

const exemplo = [
  ...Array.from({ length: 2 }, charmander),
  bulbasaur(),
  ...Array.from({ length: 2 }, gengar),
];
const rExemplo = montarRoleta(exemplo, PEDRAS_DAS_DUAS);

ok(rExemplo != null, 'a roleta monta com cinco pokémon');
ok(rExemplo.oferecidos === 5, 'cinco oferecidos');
ok(vazio(rExemplo) === null, 'com as cinco casas cheias não há fatia vazia');
ok(rExemplo.chancePedra === 1, 'pedra garantida');

// As quatro pedras, na proporção 2 : 1 : 3 : 2 — Venom Stone soma Bulbasaur e Gengar.
const esperado = { 'Fire Stone': 2, 'Leaf Stone': 1, 'Venom Stone': 3, 'Darkness Stone': 2 };
for (const [nome, qtd] of Object.entries(esperado)) {
  ok(
    fatia(rExemplo, nome)?.pokemons === qtd,
    `${nome}: ${qtd} pokémon a pedem`,
    `veio ${fatia(rExemplo, nome)?.pokemons ?? 'nada'}`,
  );
}
ok(rExemplo.fatias.length === 4, 'quatro fatias, e nenhuma a mais');

const somaPesos = rExemplo.fatias.reduce((s, f) => s + f.peso, 0);
ok(somaPesos === rExemplo.total, 'os pesos somam o total', `${somaPesos} ≠ ${rExemplo.total}`);

const somaPct = rExemplo.fatias.reduce((s, f) => s + f.pct, 0);
ok(Math.abs(somaPct - 1) < 1e-12, 'as porcentagens fecham 100%');

// E as PORCENTAGENS, que são o que o jogador lê. Cada pokémon vale uma casa (20%), dividida
// entre os tipos dele: os dois Charmander são tipo único e levam 20% cada; o Bulbasaur e o
// Gengar partem a casa ao meio, então cada um põe 10% em cada uma das duas pedras dele.
const pctDe = (nome) => Math.round((fatia(rExemplo, nome)?.pct ?? 0) * 1000) / 10;
ok(pctDe('Fire Stone') === 40, 'Fire Stone 40% — 2 Charmander × 20%', String(pctDe('Fire Stone')));
ok(pctDe('Venom Stone') === 30, 'Venom Stone 30% — (1 + 2) × 10%', String(pctDe('Venom Stone')));
ok(pctDe('Darkness Stone') === 20, 'Darkness Stone 20% — 2 Gengar × 10%', String(pctDe('Darkness Stone')));
ok(pctDe('Leaf Stone') === 10, 'Leaf Stone 10% — 1 Bulbasaur × 10%', String(pctDe('Leaf Stone')));
ok(
  pctDe('Fire Stone') + pctDe('Venom Stone') + pctDe('Darkness Stone') + pctDe('Leaf Stone') === 100,
  'e as quatro fecham 100%',
);
console.log(`    roleta: ${resumoDaRoleta(rExemplo)}`);

// -------------------------------------------------- a invariante: chance = n/5

secao('P(sair pedra) = oferecidos ÷ 5, com qualquer mistura de tipos');

const misturas = {
  'só tipo único': charmander,
  'só dual-type': gengar,
  'dual que cai numa pedra só (DARK/GHOST)': () => pk('Sombra', ['DARK', 'GHOST']),
};

for (const [rotulo, fabrica] of Object.entries(misturas)) {
  let todasBatem = true;
  const detalhes = [];
  for (let n = 1; n <= OFERENDA_CASAS; n++) {
    const r = montarRoleta(Array.from({ length: n }, fabrica), PEDRAS_DAS_DUAS);
    const pesoPedra = r.fatias.filter((f) => !f.vazio).reduce((s, f) => s + f.peso, 0);
    // A chance vale como FRAÇÃO EXATA: pesoPedra/total tem de ser n/5 sem arredondar.
    if (pesoPedra * OFERENDA_CASAS !== n * r.total) {
      todasBatem = false;
      detalhes.push(`n=${n}: ${pesoPedra}/${r.total}`);
    }
  }
  ok(todasBatem, `${rotulo}: a chance é exatamente n/5 de 1 a 5`, detalhes.join(' '));
}

// O atalho que o `vazio` fecha: três Gengar fazem SEIS fatias de pedra — mais que as cinco
// casas —, mas não fecham o círculo.
const tresGengar = montarRoleta(Array.from({ length: 3 }, gengar), PEDRAS_DAS_DUAS);
ok(tresGengar.chancePedra === 0.6, 'três dual-type continuam valendo 60%, não 100%');
ok(vazio(tresGengar)?.peso === 12, 'a fatia vazia pesa (5 − 3) × 6');
ok(
  vazio(tresGengar).peso * 5 === tresGengar.total * 2,
  'e ela ocupa dois quintos do círculo',
);

// Duas casas de tipo único: a pedra é 40%, e o vazio os outros 60%.
const doisCharm = montarRoleta(Array.from({ length: 2 }, charmander), PEDRAS_DAS_DUAS);
ok(doisCharm.chancePedra === 0.4, 'dois Charmander valem 40%');
ok(
  peso(doisCharm, 'Fire Stone') * 3 === vazio(doisCharm).peso * 2,
  'Fire Stone e vazio dividem o círculo em 40 / 60',
);

// ------------------------------------------------------ o sorteio, inteiro a inteiro

secao('O sorteio: uniforme e sem faixa perdida');

// Varre TODO valor possível do intervalo. Cada fatia tem de receber exatamente o seu peso —
// é a prova de que não há viés na primeira nem buraco na última.
const contagem = new Map();
for (let n = 0; n < rExemplo.total; n++) {
  const i = sortearFatia(rExemplo, () => n);
  contagem.set(i, (contagem.get(i) ?? 0) + 1);
}
let varreduraOk = true;
const erros = [];
for (let i = 0; i < rExemplo.fatias.length; i++) {
  if ((contagem.get(i) ?? 0) !== rExemplo.fatias[i].peso) {
    varreduraOk = false;
    erros.push(`#${i} ${rExemplo.fatias[i].nome}: ${contagem.get(i) ?? 0} ≠ ${rExemplo.fatias[i].peso}`);
  }
}
ok(varreduraOk, `os ${rExemplo.total} valores caem no peso de cada fatia`, erros.join(' · '));
ok(
  [...contagem.values()].reduce((s, v) => s + v, 0) === rExemplo.total,
  'nenhum valor do intervalo fica sem fatia',
);

// Valor fora da faixa (um sorteador quebrado) não escolhe fatia nenhuma em vez de escolher a 0.
ok(sortearFatia(rExemplo, () => rExemplo.total) === -1, 'valor no teto é recusado');
ok(sortearFatia(rExemplo, () => -1) === -1, 'valor negativo é recusado');
ok(sortearFatia(rExemplo, () => 1.5) === -1, 'valor fracionário é recusado');

// A primeira e a última fatia, nas bordas exatas.
ok(sortearFatia(rExemplo, () => 0) === 0, 'o zero cai na primeira fatia');
ok(
  sortearFatia(rExemplo, () => rExemplo.total - 1) === rExemplo.fatias.length - 1,
  'o último valor cai na última fatia',
);

// A ordem das fatias é DETERMINÍSTICA: é ela que casa o índice do servidor com o desenho da tela.
const ordemA = montarRoleta(exemplo, PEDRAS_DAS_DUAS).fatias.map((f) => f.nome).join('|');
const ordemB = montarRoleta([...exemplo].reverse(), PEDRAS_DAS_DUAS).fatias.map((f) => f.nome).join('|');
ok(ordemA === ordemB, 'a ordem das fatias não depende da ordem em que os pokémon entraram');

// ------------------------------------------------------------ a fatia vazia

secao('A fatia vazia: girar com a roleta pela metade');

const meio = montarRoleta([charmander(), gengar()], PEDRAS_DAS_DUAS);
ok(meio.chancePedra === 0.4, 'dois pokémon valem 40%');
const giroVazio = girarOferenda(meio, () => meio.total - 1);
ok(!giroVazio.ganhou, 'cair no vazio não dá pedra');
ok(giroVazio.fatia?.vazio === true, 'e a fatia sorteada é a vazia');
ok(/vazio/.test(giroVazio.auditoria), 'a auditoria registra o vazio', giroVazio.auditoria);

const giroPedra = girarOferenda(meio, () => 0);
ok(giroPedra.ganhou, 'cair numa pedra dá pedra');
ok(giroPedra.fatia.itemId > 0, 'e a fatia tem itemId do catálogo');
ok(
  /→ #0 /.test(giroPedra.auditoria) && / \/\d+$/.test(resumoDaRoleta(meio)),
  'a auditoria guarda os pesos e a fatia sorteada',
  giroPedra.auditoria,
);

// --------------------------------------------------------- Darkness Stone

secao('A Darkness Stone serve DARK e GHOST — e conta uma vez só');

const dupla = montarRoleta([gengar(), umbreon()], PEDRAS_DAS_DUAS);
ok(fatia(dupla, 'Darkness Stone')?.pokemons === 2, 'Gengar e Umbreon somam na mesma pedra');
ok(
  (fatia(dupla, 'Darkness Stone')?.tipos ?? []).join('/') === 'DARK/GHOST',
  'a fatia diz os dois tipos que chegaram nela',
);
const soDark = pedrasDoPokemon({ tipos: ['DARK', 'GHOST'] });
ok(soDark.size === 1, 'um DARK/GHOST pinta UMA fatia, não duas');

const sombra = montarRoleta([pk('Sombra', ['DARK', 'GHOST'])], PEDRAS_DAS_DUAS);
ok(
  peso(sombra, 'Darkness Stone') === montarRoleta([umbreon()], PEDRAS_DAS_DUAS).fatias[0].peso,
  'e ele não vale mais que um DARK puro',
);

// ----------------------------------------------------------------- as travas

secao('Os ids que chegam do cliente');

ok(idsDaOferenda([3, 3, 3, 3]).length === 1, 'id repetido conta uma vez');
ok(idsDaOferenda(Array.from({ length: 50 }, (_, i) => i + 1)).length === OFERENDA_CASAS, 'corta nas cinco casas');
ok(idsDaOferenda([0, -1, 1.5, NaN, Infinity, '2']).join(',') === '2', 'só inteiro positivo passa');
ok(idsDaOferenda('7').length === 0, 'o que não é lista não vira oferenda');
ok(idsDaOferenda([{ id: 1 }, [2]]).length === 0, 'objeto e array aninhado não viram id');

// A fraude mais barata: o mesmo Gengar cinco vezes daria 100% Darkness e Venom ao preço de um
// pokémon.
const repetidos = (() => {
  const g = gengar();
  const p = jogador([g, charmander(), charmander()]);
  return validar(p, Array.from({ length: OFERENDA_CASAS }, () => g.id));
})();
ok(!repetidos.erro, 'cinco vezes o mesmo id é aceito…');
ok(repetidos.pokemons.length === 1, '…como UM pokémon');
ok(repetidos.roleta.chancePedra === 0.2, 'e a roleta vale 20%, não 100%');

secao('As travas de posse');

const ativo = charmander();
const naEquipe = pk('Pidgey', ['NORMAL', 'FLYING'], { slot: 2 });
const trancado = bulbasaur();
const comShare = pk('Eevee', ['NORMAL'], { heldItemId: XP_SHARE_HELD_ID });
const livre1 = gengar();
const livre2 = umbreon();
const p = jogador([ativo, naEquipe, trancado, comShare, livre1, livre2], {
  activeId: ativo.id,
  travados: [trancado.id],
});

ok(validar(p, [999999]).erro === 'oferenda.erroNaoTem', 'id que não é dele é recusado');
ok(validar(p, [ativo.id]).erro === 'oferenda.erroAtivo', 'o que está lutando não entra');
ok(validar(p, [naEquipe.id]).erro === 'oferenda.erroEquipe', 'o da equipe não entra');
// O CADEADO é do Mercado NPC, e não vale aqui: ele existe contra a venda em LOTE, e a oferenda
// é escolha casa a casa com confirmação. Herdá-lo obrigaria a destravar um a um para usar a tela.
ok(!validar(p, [trancado.id]).erro, 'o trancado no cadeado ENTRA — o cadeado é só do NPC');
ok(validar(p, [trancado.id]).pokemons?.[0]?.id === trancado.id, 'e é ele mesmo que entra');
ok(validar(p, [comShare.id]).erro === 'oferenda.erroXpShare', 'o que segura Exp. Share não entra');
// O posto de XP Share de uma Casa: quem sabe dos postos é o sim, que passa `emPosto`.
{
  const noPosto = pk('Machop', ['FIGHTING'], { slot: 3 });
  const pc = jogador([ativo, noPosto, livre1, livre2], { activeId: ativo.id });
  const comPostos = (ids) => validarOferenda(pc, ids, { pedras: PEDRAS_DAS_DUAS, emPosto: (id) => id === noPosto.id });
  ok(comPostos([noPosto.id]).erro === 'oferenda.erroCasa', 'o que está no posto de uma Casa não entra — e a recusa diz Casa, não equipe');
  ok(comPostos([livre1.id, noPosto.id]).erro === 'oferenda.erroCasa', 'e ele barra a oferenda inteira');
  ok(!comPostos([livre1.id]).erro, 'quem não está em posto nenhum passa');
}
ok(validar(p, []).erro === 'oferenda.erroVazia', 'lista vazia é recusada');
ok(!validar(p, [livre1.id, livre2.id]).erro, 'dois do depot, livres, passam');

// Uma trava barra a OFERENDA INTEIRA, e não só a linha ruim: cobrar nove e dizer "um não valeu"
// é pior que recusar e deixar o jogador arrumar a lista.
ok(
  validar(p, [livre1.id, ativo.id]).erro === 'oferenda.erroAtivo',
  'um id barrado recusa a oferenda toda',
);

secao('O último pokémon da conta não sai');

const so1 = jogador([charmander()]);
ok(validar(so1, [[...so1.pokemons.keys()][0]]).erro === 'oferenda.erroUltimo', 'com um só, nada sai');
const so2 = jogador([charmander(), gengar()]);
const idsSo2 = [...so2.pokemons.keys()];
ok(validar(so2, idsSo2).erro === 'oferenda.erroUltimo', 'com dois, os dois juntos são recusados');
ok(!validar(so2, [idsSo2[0]]).erro, 'mas um dos dois passa');

// ------------------------------------------------------- o catálogo inteiro

secao('Toda pedra do jogo é alcançável por alguma espécie');

const tipoDeEspecie = new Set();
for (const e of especies.values()) {
  if (e.type1) tipoDeEspecie.add(e.type1);
  if (e.type2) tipoDeEspecie.add(e.type2);
}
const pedrasAlcancaveis = new Set();
for (const t of tipoDeEspecie) {
  const nome = PEDRA_POR_TIPO[t];
  if (nome) pedrasAlcancaveis.add(nome);
}
const pedrasDeEvolucao = new Set(Object.values(PEDRA_POR_TIPO));
const inalcancaveis = [...pedrasDeEvolucao].filter((n) => !pedrasAlcancaveis.has(n));
ok(!inalcancaveis.length, 'as 18 pedras de evolução têm espécie que as pinte', inalcancaveis.join(', '));
ok(
  !pedrasAlcancaveis.has('Crystal Stone'),
  'a Crystal Stone fica fora: não é pedra de tipo nenhum (só de refino/mercado)',
);
ok(PEDRAS.has('Crystal Stone'), 'e ela continua no conjunto de pedras do catálogo');

// Cada tipo elemental resolve para um item de verdade no catálogo (ou a roleta sairia sem itemId).
const semItem = Object.keys(PEDRA_POR_TIPO).filter((t) => !PEDRA_EVOLUCAO_POR_TIPO[t]?.itemId);
ok(!semItem.length, 'todo tipo tem itemId resolvido no catálogo', semItem.join(', '));

// Uma roleta de verdade, montada com espécies do catálogo em vez de fixtures.
const doCatalogo = [...especies.values()].filter((e) => e.type1).slice(0, OFERENDA_CASAS);
const rCatalogo = montarRoleta(
  doCatalogo.map((e, i) => ({ id: i + 1, tipos: [e.type1, e.type2].filter(Boolean) })),
  PEDRAS_DAS_DUAS,
);
ok(rCatalogo?.oferecidos === OFERENDA_CASAS, 'cinco espécies do catálogo montam a roleta');
ok(rCatalogo.fatias.every((f) => f.vazio || f.itemId > 0), 'e toda fatia tem itemId');

// ------------------------------------------- um pokémon = uma casa = 20% do círculo

secao('Um pokémon vale UMA CASA (20%), tenha ele um tipo ou dois');

{
  // O caso que fez a regra da casa existir: um Shiny Charmander no meio de Tyranitar ficava com
  // metade da fatia, porque cada TIPO valia uma casa e o Tyranitar (ROCK/DARK) pesava o dobro.
  const r = montarRoleta(
    [pk('Charmander', ['FIRE'], { shiny: true }), ...Array.from({ length: 4 }, () => pk('Tyranitar', ['ROCK', 'DARK']))],
    PEDRAS_DAS_DUAS,
  );
  const pctDe = (nome) => Math.round((r.fatias.find((f) => f.nome === nome)?.pct ?? 0) * 1000) / 10;
  ok(pctDe('Fire Shiny Stone') === 20, 'Shiny Charmander + 4 Tyranitar: a shiny fica em 20%', String(pctDe('Fire Shiny Stone')));
  ok(pctDe('Rock Stone') === 40, 'Rock Stone 40% — 4 × 10%', String(pctDe('Rock Stone')));
  ok(pctDe('Darkness Stone') === 40, 'Darkness Stone 40% — 4 × 10%', String(pctDe('Darkness Stone')));
  ok(r.fatias.every((f) => !f.vazio), 'e as cinco casas cheias não deixam vazio');
}

{
  // Tipo único leva a casa inteira; dual-type parte ao meio. Dois bichos, mesma fatia total.
  const unico = montarRoleta([pk('Charmander', ['FIRE'])], PEDRAS_DAS_DUAS);
  ok(Math.round(unico.fatias[0].pct * 100) === 20, 'um tipo único sozinho: 20% numa pedra só');

  const duplo = montarRoleta([pk('Charizard', ['FIRE', 'FLYING'])], PEDRAS_DAS_DUAS);
  const pedras = duplo.fatias.filter((f) => !f.vazio);
  ok(pedras.length === 2, 'um dual-type sozinho abre duas pedras');
  ok(
    pedras.every((f) => Math.round(f.pct * 100) === 10),
    'com 10% cada — a mesma casa, partida ao meio',
    pedras.map((f) => `${f.nome}=${(f.pct * 100).toFixed(1)}%`).join(' '),
  );
  ok(
    Math.abs(pedras.reduce((acc, f) => acc + f.pct, 0) - unico.fatias[0].pct) < 1e-12,
    'e os dois juntos valem exatamente o que o tipo único vale',
  );
}

{
  // Os dois tipos caindo na MESMA pedra não partem a casa: é uma pedra só, e ela leva tudo.
  // A divisão é pelas PEDRAS que o bicho pinta, não pelos tipos que ele tem.
  const fundido = montarRoleta([pk('Sombra', ['DARK', 'GHOST'])], PEDRAS_DAS_DUAS);
  const pedras = fundido.fatias.filter((f) => !f.vazio);
  ok(pedras.length === 1, 'DARK/GHOST comum pinta uma pedra só');
  ok(Math.round(pedras[0].pct * 100) === 20, 'e leva a casa INTEIRA nela (20%)', `${(pedras[0].pct * 100).toFixed(1)}%`);

  // O shiny do mesmo bicho pinta duas (as Shiny Stones não se fundem) e aí, sim, parte ao meio.
  const shiny = montarRoleta([pk('Sombra', ['DARK', 'GHOST'], { shiny: true })], PEDRAS_DAS_DUAS);
  const duas = shiny.fatias.filter((f) => !f.vazio);
  ok(duas.length === 2 && duas.every((f) => Math.round(f.pct * 100) === 10), 'o shiny dele parte em 10% + 10%');
}

{
  // A soma das fatias de pedra é SEMPRE 20% × pokémon, em qualquer mistura.
  const misturas = [
    [['FIRE'], ['ROCK', 'DARK'], ['GRASS', 'POISON'], ['NORMAL']],
    [['DARK', 'GHOST'], ['FIRE'], ['WATER', 'FLYING']],
    [['PSYCHIC'], ['PSYCHIC'], ['BUG', 'FLYING'], ['STEEL', 'ROCK'], ['FAIRY']],
  ];
  let todasBatem = true;
  const detalhes = [];
  for (const mistura of misturas) {
    const r = montarRoleta(mistura.map((tipos, i) => pk(`P${i}`, tipos)), PEDRAS_DAS_DUAS);
    const soma = r.fatias.filter((f) => !f.vazio).reduce((acc, f) => acc + f.pct, 0);
    if (Math.abs(soma - mistura.length / OFERENDA_CASAS) > 1e-12) {
      todasBatem = false;
      detalhes.push(`${mistura.length} bichos → ${(soma * 100).toFixed(2)}%`);
    }
  }
  ok(todasBatem, 'a soma das pedras é sempre 20% × nº de pokémon', detalhes.join(' · '));
}

{
  // A garantia que o `PESO_CASA = 2` depende: nenhuma espécie do catálogo pinta uma TERCEIRA
  // pedra. Se um dia houver um terceiro tipo, a divisão deixa de fechar em inteiro.
  const demais = [];
  for (const e of especies.values()) {
    const tipos = [e.type1, e.type2].filter(Boolean);
    for (const shiny of [false, true]) {
      const q = pedrasDoPokemon({ tipos, shiny }).size;
      if (q > 2) demais.push(`${e.name}${shiny ? ' shiny' : ''}=${q}`);
    }
  }
  ok(!demais.length, 'nenhuma espécie do catálogo pinta mais de duas pedras', demais.slice(0, 5).join(', '));
}

// --------------------------------------------------------------- SHINY

secao('SHINY paga em Shiny Stone, e só nela');

const shinyDratini = () => pk('Dratini', ['DRAGON'], { shiny: true });
const shinyBulbasaur = () => pk('Bulbasaur', ['GRASS', 'POISON'], { shiny: true });
const shinyGengar = () => pk('Gengar', ['GHOST', 'POISON'], { shiny: true });

{
  // O exemplo do pedido: Shiny Dratini só pode dar Dragon Shiny Stone.
  const r = montarRoleta([shinyDratini()], PEDRAS_DAS_DUAS);
  ok(r.fatias.filter((f) => !f.vazio).length === 1, 'Shiny Dratini pinta UMA fatia');
  const f = r.fatias[0];
  ok(f.shiny === true, 'e ela é de Shiny Stone');
  ok(f.nome === 'Dragon Shiny Stone', 'a Dragon Shiny Stone', f.nome);
  ok(f.itemId === SHINY_STONE_POR_TIPO.DRAGON, 'com o itemId do bloco das shiny', String(f.itemId));
  ok(
    !r.fatias.some((x) => x.nome === PEDRA_POR_TIPO.DRAGON),
    'e a Ancient Stone comum NÃO aparece — shiny não paga na prateleira comum',
  );
}

{
  // O outro exemplo: Shiny Bulbasaur é GRASS/POISON e abre as duas.
  const r = montarRoleta([shinyBulbasaur()], PEDRAS_DAS_DUAS);
  const nomes = r.fatias.filter((x) => !x.vazio).map((x) => x.nome).sort();
  ok(
    nomes.join(' | ') === 'Grass Shiny Stone | Poison Shiny Stone',
    'Shiny Bulbasaur abre Grass e Poison Shiny Stone',
    nomes.join(' | '),
  );
  ok(r.fatias.filter((x) => !x.vazio).every((x) => x.shiny), 'as duas são shiny');
  ok(
    r.fatias.filter((x) => !x.vazio).every((x) => x.itemId > 0),
    'e as duas resolvem itemId',
  );
}

{
  // A diferença que a chave `s:<TIPO>` existe para guardar: as comuns FUNDEM DARK e GHOST na
  // Darkness Stone, as shiny NÃO — Dark Shiny Stone e Ghost Shiny Stone são itens diferentes.
  const comum = montarRoleta([pk('Sombra', ['DARK', 'GHOST'])], PEDRAS_DAS_DUAS);
  ok(comum.fatias.filter((f) => !f.vazio).length === 1, 'DARK/GHOST comum: uma fatia só');

  const shiny = montarRoleta([pk('Sombra', ['DARK', 'GHOST'], { shiny: true })], PEDRAS_DAS_DUAS);
  const nomes = shiny.fatias.filter((f) => !f.vazio).map((f) => f.nome).sort();
  ok(nomes.length === 2, 'DARK/GHOST shiny: DUAS fatias', nomes.join(' | '));
  ok(
    nomes.join(' | ') === 'Dark Shiny Stone | Ghost Shiny Stone',
    'e são as duas Shiny Stones distintas',
    nomes.join(' | '),
  );
  ok(
    SHINY_STONE_POR_TIPO.DARK !== SHINY_STONE_POR_TIPO.GHOST,
    'porque no catálogo elas são itens diferentes mesmo',
  );
}

{
  // Misturado: o comum e o shiny da MESMA espécie convivem sem se fundir.
  const r = montarRoleta([charmander(), pk('Charmander', ['FIRE'], { shiny: true })], PEDRAS_DAS_DUAS);
  const pedras = r.fatias.filter((f) => !f.vazio);
  ok(pedras.length === 2, 'Charmander + Shiny Charmander = duas fatias', String(pedras.length));
  ok(pedras.some((f) => !f.shiny && f.nome === 'Fire Stone'), 'uma Fire Stone comum');
  ok(pedras.some((f) => f.shiny && f.nome === 'Fire Shiny Stone'), 'e uma Fire Shiny Stone');
  ok(pedras[0].peso === pedras[1].peso, 'com o mesmo peso — uma casa cada');
}

{
  // A invariante da chance vale igual com shiny no meio: cinco shinys do mesmo tipo fecham o
  // círculo, e é essa conta que faz "cinco shinys por uma Shiny Stone".
  const cheia = montarRoleta(Array.from({ length: OFERENDA_CASAS }, shinyDratini), PEDRAS_DAS_DUAS);
  ok(cheia.chancePedra === 1, 'cinco Shiny Dratini garantem a pedra');
  ok(cheia.fatias.length === 1 && cheia.fatias[0].nome === 'Dragon Shiny Stone', 'e o círculo inteiro é dela');

  const um = montarRoleta([shinyDratini(), ...Array.from({ length: 4 }, charmander)], PEDRAS_DAS_DUAS);
  const fShiny = um.fatias.find((f) => f.shiny);
  ok(
    fShiny.peso * 5 === um.total,
    'um shiny no meio de quatro comuns vale 20% do círculo',
    `${fShiny.peso}/${um.total}`,
  );
  ok(um.chancePedra === 1, 'e a roleta continua garantindo ALGUMA pedra');
}

{
  // Mistura shiny + dual comum: a chance de sair pedra não muda, só a divisão.
  let todasBatem = true;
  const detalhes = [];
  for (let n = 1; n <= OFERENDA_CASAS; n++) {
    const lista = Array.from({ length: n }, (_, i) => (i % 2 ? shinyGengar() : bulbasaur()));
    const r = montarRoleta(lista, PEDRAS_DAS_DUAS);
    const pesoPedra = r.fatias.filter((f) => !f.vazio).reduce((s, f) => s + f.peso, 0);
    if (pesoPedra * OFERENDA_CASAS !== n * r.total) {
      todasBatem = false;
      detalhes.push(`n=${n}`);
    }
  }
  ok(todasBatem, 'shiny misturado com comum: a chance segue exatamente n/5', detalhes.join(' '));
}

{
  // As dezoito Shiny Stones existem e são distintas entre si.
  const ids = new Set(TIPOS_POKEMON.map((t) => SHINY_STONE_POR_TIPO[t]));
  ok(ids.size === 18, 'as 18 Shiny Stones têm itemId próprio', String(ids.size));
  const semFatia = TIPOS_POKEMON.filter((t) => {
    const r = montarRoleta([pk('X', [t], { shiny: true })], PEDRAS_DAS_DUAS);
    return !r || r.fatias.filter((f) => !f.vazio).length !== 1;
  });
  ok(!semFatia.length, 'e todo tipo shiny pinta a fatia dele', semFatia.join(', '));
}

{
  // O shiny entra na auditoria com o nome da pedra shiny — é o que se confere depois.
  const r = montarRoleta([shinyDratini()], PEDRAS_DAS_DUAS);
  const g = girarOferenda(r, () => 0);
  ok(g.ganhou, 'o giro que cai na fatia shiny paga');
  ok(g.fatia.shiny === true, 'e o resultado vem marcado como shiny');
  ok(/Dragon Shiny Stone/.test(g.auditoria), 'a auditoria nomeia a pedra shiny', g.auditoria);
}

secao('Bordas');

ok(montarRoleta([], PEDRAS_DAS_DUAS) === null, 'roleta vazia não existe');
ok(
  montarRoleta(Array.from({ length: OFERENDA_CASAS + 1 }, charmander), PEDRAS_DAS_DUAS) === null,
  'acima das cinco casas não monta',
);
ok(
  montarRoleta([pk('Sem tipo', [])], PEDRAS_DAS_DUAS) === null,
  'pokémon sem tipo nenhum não pinta roleta',
);
ok(
  montarRoleta([pk('Lixo', ['NAOEXISTE'])], PEDRAS_DAS_DUAS) === null,
  'tipo que não existe não inventa fatia',
);
// Um sem tipo no meio de quatro válidos: ele não pinta fatia, mas CONTA como pokémon oferecido —
// senão o jogador pagaria cinco e a chance sairia de quatro.
const comLixo = montarRoleta(
  [...Array.from({ length: 4 }, charmander), pk('Sem tipo', [])],
  PEDRAS_DAS_DUAS,
);
ok(comLixo.oferecidos === 5, 'o sem-tipo conta como oferecido');
ok(comLixo.chancePedra === 1, 'e a roleta fecha em 100%');
ok(
  montarRoleta([charmander()], null).fatias[0].itemId === null,
  'sem o mapa do welcome a fatia sai sem itemId (só contagem)',
);

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
