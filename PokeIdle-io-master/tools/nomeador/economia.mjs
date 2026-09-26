// ECONOMIA — o mapa completo de hunts → pokémon → itens, e o modelo de reequilíbrio.
//
// Este módulo não escreve nada. Ele lê as MESMAS fontes que `game/src/server/content.mjs`
// lê no boot do jogo, remonta o grafo inteiro da economia e devolve dois retratos lado a
// lado: o que o jogo paga HOJE e o que o modelo proposto pagaria. A tela `economia.html`
// é só a leitura disso.
//
// ### As três travas do desenho
//
// A proposta trabalha sob restrições duras, e elas são o que dá forma a tudo aqui:
//
//   1. **Nenhum item novo.** Nada de Hyper/Cosmic/Genesis Ball. O catálogo é o que é.
//   2. **Nenhum preço muda.** Nem de loja, nem de `npcPrice` de item. A loja fica intocada.
//   3. **Todo o dinheiro vem de DROP.** A kill deixa de pagar ouro.
//
// Sobra um único lever: **a composição e a QUANTIDADE dos drops de cada espécie**. É esse o
// modelo abaixo — para cada nível de hunt existe uma banda de preço de item, e a quantidade é
// resolvida para fechar a renda alvo. "Aumentar a quantidade de forma gradual e seletiva".
//
// ### Por que remontar em vez de importar do servidor
//
// `content.mjs` importa `config.mjs`, que quer variáveis de ambiente do jogo, e `loja.mjs`,
// que arrasta o catálogo de diamantes. O Sprite Lab roda sem nada disso. As regras que
// importam aqui (escala de hunt level, curva de ouro, normalização do sellValue) vivem em
// `game/src/shared/`, que é código puro — essas SÃO importadas, para não haver duas verdades.

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aplicarEscalaHuntLevel } from '../../game/src/shared/escala-hunt-level.mjs';
import { NOMES_OMITIDOS } from '../../game/src/shared/spawns-filtro.mjs';
import { ouroDoNivel, xpDoNivel, normalizarSellValue } from '../../game/src/shared/sell-value.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const JOGO = resolve(AQUI, '../../public/data');
const DADOS = resolve(AQUI, '../../game/src/server/dados');

const ler = (p) => JSON.parse(readFileSync(p, 'utf8'));
const lerOpc = (p) => {
  try {
    return ler(p);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- o modelo

/**
 * A CURVA ALVO — renda por kill, em coins, pelo nível da hunt. Toda ela vem de drop.
 *
 * Hoje o jogo tem DUAS curvas emendadas e as duas estão erradas em direções opostas:
 *
 *   · Kanto/Johto paga `experience`, que é `0,6·n²` — uma QUADRÁTICA. 1 coin por kill no
 *     nível 1 contra um Max Revive de 2.500: são 600 kills por um revive.
 *   · Hoenn+ paga `12000·(n/150)^0,6`, que nunca deixa de crescer — 787.928 por kill no
 *     nível 160.300, contra uma Ultra Ball que continua custando 130.
 *
 * A proposta é `60 · n^0,26`. O expoente é baixo de propósito: com os preços de loja
 * CONGELADOS, o crescimento da renda é o crescimento do poder de compra, um para um. 23×
 * do começo ao fim é o que cabe sem transformar o late game em bilionário — no topo dá
 * ~1,08 M/hora, e não os 630 M/hora de hoje.
 *
 * O bonito do expoente baixo com preço fixo é que **a escada de bolas que já existe vira a
 * progressão**: o jogador começa na Poké Ball, chega na Great por volta do nível 100, na
 * Super lá pelo 3.000 e só banca a Ultra no fim do jogo. Não foi preciso inventar bola
 * nenhuma — bastou parar de dar dinheiro demais.
 */
export const G_BASE = 60;
export const G_EXP = 0.26;
export const rendaAlvo = (n) => Math.round(G_BASE * Math.max(1, n) ** G_EXP);

/** Curva de hoje, para o antes-e-depois. Kanto/Johto = `experience`; Hoenn+ = `ouroDoNivel`. */
export const rendaHoje = (n) => (n <= 150 ? Math.round(xpDoNivel(n)) : ouroDoNivel(n));

/**
 * A LOJA, exatamente como ela é hoje. Nada aqui muda — é dado de entrada, não proposta.
 *
 * A análise de autonomia escolhe, em cada nível, o melhor degrau que o jogador CONSEGUE
 * sustentar dentro do orçamento (bola 22% da renda, poção 12%, revive 5%). É assim que a
 * graduação Poké → Great → Super → Ultra aparece sozinha na tabela.
 */
export const LOJA_BOLAS = [
  { id: 1, nome: 'Poké Ball', catchRate: 1, preco: 5 },
  { id: 2, nome: 'Great Ball', catchRate: 2, preco: 20 },
  { id: 3, nome: 'Super Ball', catchRate: 3, preco: 50 },
  { id: 4, nome: 'Ultra Ball', catchRate: 4, preco: 130 },
];
export const LOJA_POCOES = [
  { id: 200, nome: 'Small Potion', cura: 60, preco: 50 },
  { id: 201, nome: 'Great Potion', cura: 150, preco: 150 },
  { id: 202, nome: 'Ultra Potion', cura: 400, preco: 400 },
  { id: 203, nome: 'Hyper Potion', cura: 1000, preco: 800 },
  { id: 204, nome: 'Ultimate Potion', cura: 3000, preco: 1500 },
];
export const LOJA_REVIVES = [
  { id: 205, nome: 'Revive', preco: 600 },
  { id: 206, nome: 'Max Revive', preco: 2500 },
];

/**
 * Consumo por kill e ritmo de caçada.
 *
 * `pocoes` NÃO está aqui de propósito — poção não é uma taxa fixa por kill, é consequência do
 * dano levado, e é a conta mais importante da tela. Ver `POCAO` logo abaixo.
 */
export const CONSUMO = { bolas: 2.0, revives: 0.02 };
export const ORCAMENTO = { bolas: 0.22, pocoes: 0.12, revives: 0.05 };
export const KILLS_HORA = 800;

/**
 * A CONTA DA POÇÃO — o gasto recorrente que manda na economia, e o que ninguém tinha medido.
 *
 * Poção é usada muito mais que revive: o revive só entra quando o pokémon cai, a poção entra
 * toda vez que o HP passa do limiar (`hpLimiar`, 30% por padrão em `sim.mjs`). Então ela não
 * pode ser modelada como "0,3 por kill" — ela sai do DANO LEVADO.
 *
 * E há uma assimetria que muda tudo: **o HP escala com o nível, a cura da poção é FIXA.**
 *
 *   maxHp = hpDeCombate(stats.hp) = 12 · (baseHp + 2·IV) · nível/100     ← linear no nível
 *   cura  = item.healAmount                                             ← 60, 150, 400, 1.000, 3.000
 *
 * O selvagem é `huntLevel ± 2` (ver `nivelSelvagem` em `combate.mjs`), então nível de hunt e
 * nível de bicho andam juntos. Resultado: a fração do HP que a MELHOR poção do jogo cobre
 * desaba linearmente — 243% do maxHp no nível 100, 24% no 1.000, 4,9% no 5.000, 0,2% no fim.
 *
 * Acima de `COBERTURA_MIN` a poção deixa de ser um recurso e o jogador cai no Centro Pokémon,
 * que cura de graça. Isso não é problema de economia: é TETO DE CATÁLOGO, e aparece na tela
 * como tal.
 */
export const POCAO = {
  /** `baseHp + 2·IV` de uma espécie média com IV médio — a régua de HP por nível. */
  HP_POR_NIVEL: 12 * 103 / 100,
  /** Quanto do maxHp o pokémon perde por kill. Premissa; é o número a calibrar com telemetria. */
  FRACAO_HP_POR_KILL: 0.12,
  /** Abaixo desta cobertura (cura / maxHp) a poção vira inútil e o jogador usa o Centro. */
  COBERTURA_MIN: 0.05,
};

/** HP máximo aproximado de um pokémon no nível daquela hunt. */
export const maxHpAprox = (n) => Math.round(POCAO.HP_POR_NIVEL * Math.max(1, n));

/** HP que o jogador precisa repor por kill naquele nível. */
export const hpPorKill = (n, frac = POCAO.FRACAO_HP_POR_KILL) => frac * maxHpAprox(n);

/**
 * A poção que o jogador realmente usaria naquele nível.
 *
 * Duas regras, nesta ordem: não desperdiçar (a cura não deve passar do maxHp do bicho — usar
 * uma Ultimate de 3.000 num pokémon de 12 HP joga 99,6% fora) e, entre as que servem, a mais
 * eficiente em COINS POR HP. É essa segunda regra que faz a graduação Small → Hyper → Ultimate
 * aparecer sozinha, e ela expõe uma distorção de preço do catálogo: Great e Ultra Potion custam
 * 1,00 coin/HP, PIOR que a Small (0,83). Quem sabe a tabela nunca compra as duas do meio.
 */
export function melhorPocao(n, coberturaMin = POCAO.COBERTURA_MIN) {
  const teto = maxHpAprox(n);
  const cabem = LOJA_POCOES.filter((x) => x.cura <= teto);
  const lista = cabem.length ? cabem : [LOJA_POCOES[0]];
  let melhor = lista[0];
  for (const x of lista) {
    if (x.preco / Math.min(x.cura, teto) < melhor.preco / Math.min(melhor.cura, teto)) melhor = x;
  }
  const curaUtil = Math.min(melhor.cura, teto);
  const topo = LOJA_POCOES[LOJA_POCOES.length - 1];
  return {
    ...melhor,
    curaUtil,
    custoPorHp: melhor.preco / curaUtil,
    /** Cobertura do TOPO do catálogo — é ela que diz quando a escada de poções acaba. */
    cobertura: topo.cura / teto,
    viavel: topo.cura / teto >= coberturaMin,
  };
}

/** O melhor degrau da loja que cabe no orçamento daquela renda. Nunca abaixo do primeiro. */
export function melhorDegrau(lista, renda, share, consumo) {
  let melhor = lista[0];
  for (const d of lista) if (d.preco * consumo <= renda * share) melhor = d;
  return melhor;
}

/**
 * OS QUATRO SLOTS de uma tabela de loot, e quanto da renda cada um carrega.
 *
 * A forma não é invenção: é a que as tabelas do espelho já têm. Dragonite hoje dropa
 * Straw a 75% valendo 1, Feather a 33% valendo 8, Dragon Tooth a 4,4% valendo 610 e
 * Crystal Stone a 0,11% valendo 50.000 — lixo, comum, bom e jackpot. O que falta não é a
 * escada, é ela apontar para itens do PREÇO CERTO em cada faixa de nível.
 *
 * `chance` e `carrega` são fixos; o que o gerador resolve é a QUANTIDADE (`min`/`max`) e
 * QUAL item entra em cada slot, escolhido pela banda de preço do nível.
 */
export const SLOTS = [
  { id: 'comum', chance: 60, carrega: 0.45, qtdMax: 12 },
  { id: 'bom', chance: 25, carrega: 0.3, qtdMax: 8 },
  { id: 'raro', chance: 4, carrega: 0.17, qtdMax: 3 },
  { id: 'jackpot', chance: 0.4, carrega: 0.08, qtdMax: 1 },
];

/**
 * AS BANDAS — a faixa de preço de item que cada nível de hunt pode dropar.
 *
 * É isto que resolve o problema estrutural do pool: hoje os mesmos 193 itens caem do nível 1
 * ao 160.300, então nenhum preço serve para os dois. Com bandas, o item de 20 coins fica em
 * Kanto e o de 800 fica no fim do jogo — sem mexer em preço nenhum, só em QUEM dropa O QUÊ.
 *
 * `alvo` é o preço ideal do item de cada slot naquela banda; o gerador pega o item real mais
 * próximo dele dentro do catálogo. Do `raro` para cima nas bandas altas entram as PEDRAS
 * (5.000 e 50.000) — são os únicos itens caros que existem, e é o papel natural delas: a
 * recompensa rara e valiosa de uma caçada de alto nível.
 */
export const BANDAS = [
  { id: 'B0', min: 1, max: 9, rotulo: 'início' },
  { id: 'B1', min: 10, max: 29, rotulo: 'Kanto' },
  { id: 'B2', min: 30, max: 99, rotulo: 'Kanto/Johto' },
  { id: 'B3', min: 100, max: 299, rotulo: 'Johto' },
  { id: 'B4', min: 300, max: 999, rotulo: 'Hoenn' },
  { id: 'B5', min: 1000, max: 4999, rotulo: 'Sinnoh' },
  { id: 'B6', min: 5000, max: 24999, rotulo: 'Unova/Kalos' },
  { id: 'B7', min: 25000, max: Infinity, rotulo: 'Alola+' },
];

export const bandaDe = (n) => BANDAS.find((b) => n >= b.min && n <= b.max) ?? BANDAS[0];

/**
 * Preço ideal do item de um slot, num nível.
 *
 * Sai da própria conta que o gerador precisa fechar: se o slot carrega `carrega·G(n)` e cai
 * `chance%` das vezes com quantidade média `q`, então o preço tem de ser
 * `carrega·G(n) / (chance/100 · q)`. Aqui usamos uma quantidade de referência para achar o
 * ALVO de preço; a quantidade final é resolvida depois, contra o item real escolhido.
 */
const QTD_REF = { comum: 2.5, bom: 1.5, raro: 1, jackpot: 1 };
export function precoAlvoSlot(slot, n) {
  return (slot.carrega * rendaAlvo(n)) / ((slot.chance / 100) * QTD_REF[slot.id]);
}

// ------------------------------------------------------- carga das fontes

/** Carrega e funde tudo o que o jogo funde no boot: espelho + nossos. */
function carregarFontes() {
  const base = ler(join(JOGO, 'creatures.json')).creatures;
  const novos = (lerOpc(join(DADOS, 'creatures-novos.json'))?.creatures ?? []).filter(
    (c) => !NOMES_OMITIDOS.has(c.name),
  );
  const creatures = [...base, ...novos];
  // A escala de hunt level só vale para as espécies NOVAS, mas precisa do catálogo inteiro
  // para montar as cadeias evolutivas — é o mesmo par de argumentos que `content.mjs` passa.
  aplicarEscalaHuntLevel(novos, undefined, creatures);
  for (const esp of creatures) normalizarSellValue(esp);

  const itens = ler(join(JOGO, 'items.json')).items;
  const spawns = ler(join(JOGO, 'index/spawns-index.json'));
  const editor = lerOpc(join(DADOS, 'spawns-editor.json'));
  return { creatures, itens, spawns, editor };
}

const REGIOES = [
  { nome: 'Kanto', min: 1, max: 151 },
  { nome: 'Johto', min: 152, max: 251 },
  { nome: 'Hoenn', min: 252, max: 386 },
  { nome: 'Sinnoh', min: 387, max: 493 },
  { nome: 'Unova', min: 494, max: 649 },
  { nome: 'Kalos', min: 650, max: 721 },
  { nome: 'Alola', min: 722, max: 809 },
  { nome: 'Galar+', min: 810, max: 1025 },
];

const dexDe = (pokeId) => (pokeId < 1000 ? pokeId : pokeId % 1000);
const regiaoDe = (pokeId) => {
  const d = dexDe(pokeId);
  return REGIOES.find((r) => d >= r.min && d <= r.max)?.nome ?? '?';
};

/**
 * Itens que NÃO entram em tabela de loot gerada, por mais que o preço encaixe.
 *
 * `Strange Pheromone` (1.000.000) e o `Bronze Boss Token` (250.000) não são vendáveis pelo
 * caminho normal — o token é moeda de arena e o feromônio é entrada morta do espelho, com
 * chance 0 em toda espécie. Deixá-los entrar faria o gerador achar que resolveu a renda de
 * uma banda inteira com um item que ninguém consegue vender.
 */
const ITENS_PROIBIDOS = new Set(['strange pheromone', 'bronze boss token', '10.000 carat emerald']);

/**
 * A PEDRA de cada tipo elemental — o desempate do slot raro/jackpot.
 *
 * As catorze pedras de 5.000 têm preço IDÊNTICO, então uma escolha por preço cai sempre na
 * mesma (era Cocoon Stone em seis bandas seguidas). Escolher pelo tipo do pokémon resolve o
 * empate e ainda dá sabor: um Growlithe larga Fire Stone, um Gyarados larga Water Stone.
 * As três de 50.000 servem o slot de jackpot pela mesma régua.
 */
const PEDRA_POR_TIPO = {
  FIRE: 'fire stone', WATER: 'water stone', GRASS: 'leaf stone', ELECTRIC: 'thunder stone',
  GROUND: 'earth stone', POISON: 'venom stone', FAIRY: 'heart stone', BUG: 'cocoon stone',
  DARK: 'darkness stone', FLYING: 'feather stone', ICE: 'ice stone', FIGHTING: 'punch stone',
  ROCK: 'rock stone', PSYCHIC: 'enigma stone', GHOST: 'enigma stone', NORMAL: 'rough gemstone',
  STEEL: 'metal stone', DRAGON: 'ancient stone',
};
const PEDRA_TOPO_POR_TIPO = {
  STEEL: 'metal stone', DRAGON: 'ancient stone', ROCK: 'ancient stone', GROUND: 'ancient stone',
};
const NOMES_PEDRA = new Set([...Object.values(PEDRA_POR_TIPO), ...Object.values(PEDRA_TOPO_POR_TIPO)]);

// ------------------------------------------------------------- o grafo

/**
 * Monta o grafo inteiro: hunts → espécies → itens, e a volta.
 *
 * O nível de uma hunt do espelho é o `nivel` dela; o das nossas é o marcador do
 * spawns-editor. O `huntLevel` da espécie é o fallback para quem não aparece em hunt
 * nenhuma (evolução de topo que só nasce por evoluir, por exemplo).
 */
export function montarGrafo() {
  const { creatures, itens, spawns, editor } = carregarFontes();

  const itemPorNome = new Map(itens.map((i) => [i.name.toLowerCase(), i]));

  // ---- hunts
  const hunts = [];
  for (const h of Object.values(spawns.porHunt ?? {})) {
    const ids = [...new Set((h.spawns ?? []).map((s) => s.pokeId))];
    if (!ids.length) continue;
    hunts.push({
      slug: h.slug,
      nome: h.nome ?? h.slug,
      area: h.area ?? 'kanto',
      nivel: h.nivel ?? 1,
      fonte: 'espelho',
      especies: ids,
    });
  }
  for (const [regiao, r] of Object.entries(editor?.regioes ?? {})) {
    for (const m of r.marcadores ?? []) {
      hunts.push({
        slug: m.slug,
        nome: m.nome ?? m.slug,
        area: regiao,
        nivel: m.nivel ?? r.nivelGate ?? 500,
        fonte: 'editor',
        especies: [m.pokeId],
      });
    }
  }

  // Nível efetivo de cada espécie: o menor nível de hunt em que ela aparece (é onde o
  // jogador de fato a encontra), com `huntLevel` como fallback.
  const nivelDaEsp = new Map();
  const huntsDaEsp = new Map();
  for (const h of hunts) {
    for (const id of h.especies) {
      const atual = nivelDaEsp.get(id);
      if (atual == null || h.nivel < atual) nivelDaEsp.set(id, h.nivel);
      if (!huntsDaEsp.has(id)) huntsDaEsp.set(id, []);
      huntsDaEsp.get(id).push(h.slug);
    }
  }

  const especies = [];
  for (const c of creatures) {
    const nivel = nivelDaEsp.get(c.pokeId) ?? c.huntLevel ?? 1;
    const loot = (c.loot ?? [])
      .map((l) => {
        const it = itemPorNome.get((l.name ?? '').toLowerCase());
        return {
          nome: l.name,
          itemId: it?.id ?? null,
          chancePct: (l.chance ?? 0) / 1000,
          min: l.minCount ?? 1,
          max: l.maxCount ?? 1,
          npcPrice: it?.npcPrice ?? 0,
        };
      })
      .filter((l) => l.itemId != null);
    especies.push({
      pokeId: c.pokeId,
      nome: c.name,
      dex: dexDe(c.pokeId),
      regiao: regiaoDe(c.pokeId),
      nivel,
      tipo: c.type1 ?? null,
      hunts: huntsDaEsp.get(c.pokeId) ?? [],
      loot,
    });
  }

  // ---- itens, com quem dropa
  const dropPorItem = new Map();
  for (const e of especies) {
    for (const l of e.loot) {
      if (!dropPorItem.has(l.itemId)) dropPorItem.set(l.itemId, []);
      dropPorItem.get(l.itemId).push({
        pokeId: e.pokeId,
        nome: e.nome,
        regiao: e.regiao,
        nivel: e.nivel,
        chancePct: l.chancePct,
        min: l.min,
        max: l.max,
      });
    }
  }

  const itensOut = itens.map((i) => {
    const drops = (dropPorItem.get(i.id) ?? []).filter((d) => d.chancePct > 0);
    const niveis = drops.map((d) => d.nivel).sort((a, b) => a - b);
    const chances = drops.map((d) => d.chancePct).sort((a, b) => a - b);
    return {
      id: i.id,
      nome: i.name,
      categoria: i.category ?? '?',
      npcPrice: i.npcPrice ?? 0,
      drops,
      nEspecies: drops.length,
      nivelMin: niveis[0] ?? null,
      nivelMax: niveis[niveis.length - 1] ?? null,
      chanceMed: chances.length ? chances[Math.floor(chances.length / 2)] : null,
      // O espalhamento é o diagnóstico central: um item que cai do nível 1 ao 160.300 não
      // pode servir às duas pontas. Quanto maior, mais o item é um problema.
      espalhamento: niveis.length ? niveis[niveis.length - 1] / Math.max(1, niveis[0]) : null,
    };
  });

  return { hunts, especies, itens: itensOut };
}

// ------------------------------------------------- gerador de tabela de loot

/**
 * Monta o catálogo de candidatos por slot: todo item vendável, ordenado por preço.
 *
 * `stone` entra junto de `loot` porque as pedras são os ÚNICOS itens caros do jogo (5.000 e
 * 50.000) e sem elas os slots `raro` e `jackpot` das bandas altas não têm com o que trabalhar.
 * O papel delas passa a ser esse: a recompensa rara de uma caçada de alto nível.
 */
function catalogoVendavel(itensGrafo) {
  return itensGrafo
    .filter((i) => (i.categoria === 'loot' || i.categoria === 'stone') && i.npcPrice > 0)
    .filter((i) => !ITENS_PROIBIDOS.has(i.nome.toLowerCase()))
    .sort((a, b) => a.npcPrice - b.npcPrice);
}

/**
 * O item do catálogo com preço mais próximo do alvo.
 *
 * Dois desempates, nesta ordem: o que a espécie JÁ dropa (mantém o sabor da tabela original)
 * e, entre pedras de preço idêntico, a do TIPO do pokémon.
 */
function itemMaisProximo(catalogo, alvo, preferidos, tipo) {
  const pedraTipo = PEDRA_POR_TIPO[tipo] ?? null;
  const pedraTopo = PEDRA_TOPO_POR_TIPO[tipo] ?? null;
  let melhor = null;
  let melhorD = Infinity;
  for (const i of catalogo) {
    // Erro relativo, não absoluto: errar 50 num alvo de 20 é muito pior que num alvo de 900.
    const d = Math.abs(Math.log(i.npcPrice / alvo));
    let bonus = preferidos.has(i.id) ? 0.35 : 0; // desconto para manter o sabor original
    const chave = i.nome.toLowerCase();
    if (NOMES_PEDRA.has(chave)) {
      // Pedra do tipo certo ganha; pedra de outro tipo perde, para não empatar por acaso.
      bonus += chave === pedraTipo || chave === pedraTopo ? 0.5 : -0.5;
    }
    if (d - bonus < melhorD) {
      melhorD = d - bonus;
      melhor = i;
    }
  }
  return melhor;
}

/**
 * Gera a tabela de loot PROPOSTA de uma espécie.
 *
 * Para cada slot: escolhe o item pelo preço alvo da banda daquele nível (preferindo os que a
 * espécie já dropava, para não apagar o sabor), e resolve a QUANTIDADE que faz o slot entregar
 * a fatia de renda que lhe cabe. A quantidade é o único número livre — preço e chance são fixos.
 *
 *   qtd média necessária = carrega · G(n) / (chance/100 · preço do item)
 *
 * Devolve `min`/`max` em torno dessa média, com o teto do slot para não gerar "37 palhas".
 */
export function proporLoot(esp, catalogo) {
  const n = esp.nivel;
  const alvoTotal = rendaAlvo(n);
  const preferidos = new Set(esp.loot.map((l) => l.itemId));
  const usados = new Set();
  const linhas = [];

  for (const slot of SLOTS) {
    const alvoPreco = precoAlvoSlot(slot, n);
    const cand = catalogo.filter((i) => !usados.has(i.id));
    const item = itemMaisProximo(cand, alvoPreco, preferidos, esp.tipo);
    if (!item) continue;
    usados.add(item.id);

    const qtdMedia = (slot.carrega * alvoTotal) / ((slot.chance / 100) * item.npcPrice);
    // Abaixo de 1 unidade não dá para descer pela quantidade — desce pela CHANCE. É o que
    // mantém honesto o slot de jackpot nas bandas baixas, onde a pedra de 5.000 valeria
    // mais que a renda de cem kills.
    let chance = slot.chance;
    let min;
    let max;
    if (qtdMedia < 1) {
      chance = Math.max(0.05, slot.chance * qtdMedia);
      min = 1;
      max = 1;
    } else {
      const q = Math.min(slot.qtdMax, qtdMedia);
      min = Math.max(1, Math.round(q * 0.5));
      max = Math.max(min, Math.round(q * 1.5));
      // `min`/`max` são inteiros, então a média real quase nunca é a média pedida — e o teto
      // de quantidade pode ter cortado mais ainda. A chance absorve a diferença nos DOIS
      // sentidos, e é o que faz o EV fechar no alvo em vez de errar 10% para cima.
      const mediaReal = (min + max) / 2;
      chance = Math.min(95, chance * (qtdMedia / mediaReal));
    }

    linhas.push({
      slot: slot.id,
      itemId: item.id,
      nome: item.nome,
      categoria: item.categoria,
      npcPrice: item.npcPrice,
      chancePct: Number(chance.toFixed(3)),
      min,
      max,
      ev: (chance / 100) * ((min + max) / 2) * item.npcPrice,
      mantido: preferidos.has(item.id),
    });
  }

  const ev = linhas.reduce((a, l) => a + l.ev, 0);
  return { linhas, ev, alvo: alvoTotal, erro: alvoTotal > 0 ? ev / alvoTotal : null };
}

// ------------------------------------------------------------ analytics

/**
 * A tabela de AUTONOMIA — o que o jogador consegue comprar, hoje e na proposta.
 *
 * Com os preços de loja CONGELADOS, o degrau que ele usa é o melhor que cabe no orçamento.
 * É por isso que a coluna da proposta mostra a graduação Poké → Great → Super → Ultra
 * acontecendo sozinha: ela é consequência da curva de renda, não uma regra à parte.
 */
export function autonomia(
  niveis = [1, 5, 10, 30, 60, 100, 150, 300, 600, 1200, 3000, 8000, 25000, 60000, 160300],
  { frac = POCAO.FRACAO_HP_POR_KILL, coberturaMin = POCAO.COBERTURA_MIN } = {},
) {
  const conta = (renda, n) => {
    // A POÇÃO PRIMEIRO — é o gasto recorrente que manda. O revive só entra quando o bicho cai;
    // a poção entra toda vez que o HP fura o limiar, e o dano cresce com o nível.
    const pocao = melhorPocao(n, coberturaMin);
    const hpKill = hpPorKill(n, frac);
    // Fora da faixa em que a poção funciona, o jogador usa o Centro (de graça) e o gasto some.
    // Modelar 128 poções por kill num nível onde ela cura 0,2% do HP seria inventar um número.
    const pocoesPorKill = pocao.viavel ? hpKill / pocao.curaUtil : 0;
    const custoPocao = pocoesPorKill * pocao.preco;

    const bola = melhorDegrau(LOJA_BOLAS, renda, ORCAMENTO.bolas, CONSUMO.bolas);
    const revive = melhorDegrau(LOJA_REVIVES, renda, ORCAMENTO.revives, CONSUMO.revives);
    const custoBola = CONSUMO.bolas * bola.preco;
    const custoRevive = CONSUMO.revives * revive.preco;
    const gasto = custoPocao + custoBola + custoRevive;

    return {
      renda,
      rendaHora: renda * KILLS_HORA,
      // --- poção (o bloco principal)
      maxHp: maxHpAprox(n),
      hpPorKill: hpKill,
      pocao: pocao.nome,
      pocaoCura: pocao.cura,
      pocaoPreco: pocao.preco,
      custoPorHp: pocao.custoPorHp,
      pocoesPorKill,
      pocoesPorHora: pocoesPorKill * KILLS_HORA,
      custoPocao,
      pocaoPctRenda: (100 * custoPocao) / renda,
      killsPorPocao: pocao.preco / renda,
      cobertura: pocao.cobertura,
      pocaoViavel: pocao.viavel,
      // --- resto
      bola: bola.nome,
      revive: revive.nome,
      killsPorBola: bola.preco / renda,
      killsPorRevive: revive.preco / renda,
      custoBola,
      custoRevive,
      // Quantas Ultra Balls (o topo da loja) uma hora de caçada compra. É a régua de
      // "ficou bilionário?": no fim do jogo isto tem de ser um número que ainda se conta.
      ultraPorHora: (renda * KILLS_HORA) / 130,
      gasto,
      saldoPct: (100 * (renda - gasto)) / renda,
    };
  };
  return niveis.map((n) => ({ nivel: n, hoje: conta(rendaHoje(n), n), novo: conta(rendaAlvo(n), n) }));
}

/**
 * O nível em que a escada de poções acaba — a melhor poção cura menos que `COBERTURA_MIN`.
 *
 * É um teto de CATÁLOGO, não de economia: nenhum ajuste de renda ou de drop muda isto, porque
 * a cura é um número fixo no item. Daqui para cima o jogador depende do Centro Pokémon.
 */
export function nivelTetoPocao(coberturaMin = POCAO.COBERTURA_MIN) {
  const topo = LOJA_POCOES[LOJA_POCOES.length - 1];
  return Math.round(topo.cura / (coberturaMin * POCAO.HP_POR_NIVEL));
}

// ---------------------------------------------------------------- painel

/** Cache do grafo — remontar custa ~1 s e o painel é consultado a cada troca de aba. */
let cache = null;
export function invalidarCache() {
  cache = null;
}
function grafoCacheado() {
  if (!cache) {
    const grafo = montarGrafo();
    const catalogo = catalogoVendavel(grafo.itens);
    const propostas = new Map();
    for (const e of grafo.especies) propostas.set(e.pokeId, proporLoot(e, catalogo));
    cache = { grafo, catalogo, propostas };
  }
  return cache;
}

/** Detalhe de UM item: todo pokémon que o dropa hoje, com chance, quantidade e nível. */
export function detalheItem(itemId) {
  const { grafo } = grafoCacheado();
  const item = grafo.itens.find((i) => i.id === Number(itemId));
  if (!item) return null;
  return {
    id: item.id,
    nome: item.nome,
    categoria: item.categoria,
    npcPrice: item.npcPrice,
    espalhamento: item.espalhamento,
    drops: [...item.drops].sort((a, b) => a.nivel - b.nivel || b.chancePct - a.chancePct),
  };
}

/** Detalhe de UMA espécie: a tabela de loot de hoje e a proposta, lado a lado. */
export function detalheEspecie(pokeId) {
  const { grafo, propostas } = grafoCacheado();
  const e = grafo.especies.find((x) => x.pokeId === Number(pokeId));
  if (!e) return null;
  const p = propostas.get(e.pokeId);
  return {
    pokeId: e.pokeId,
    nome: e.nome,
    regiao: e.regiao,
    nivel: e.nivel,
    banda: bandaDe(e.nivel).id,
    hoje: e.loot.map((l) => ({ ...l, ev: (l.chancePct / 100) * ((l.min + l.max) / 2) * l.npcPrice })),
    novo: p?.linhas ?? [],
    evHoje: e.loot.reduce((a, l) => a + (l.chancePct / 100) * ((l.min + l.max) / 2) * l.npcPrice, 0),
    evNovo: p?.ev ?? 0,
    alvo: p?.alvo ?? 0,
  };
}

/** Tudo o que a tela precisa, num payload só. */
export function montarPainel() {
  const { grafo, catalogo, propostas } = grafoCacheado();

  const itens = grafo.itens
    .filter((i) => i.nEspecies > 0 || i.npcPrice > 0)
    .map((i) => ({
      id: i.id,
      nome: i.nome,
      categoria: i.categoria,
      npcPrice: i.npcPrice,
      nDrops: i.nEspecies,
      nivelMin: i.nivelMin,
      nivelMax: i.nivelMax,
      chanceMed: i.chanceMed,
      espalhamento: i.espalhamento,
    }));

  const especies = grafo.especies
    .filter((e) => e.loot.length)
    .map((e) => {
      const p = propostas.get(e.pokeId);
      const evHoje = e.loot.reduce((a, l) => a + (l.chancePct / 100) * ((l.min + l.max) / 2) * l.npcPrice, 0);
      return {
        pokeId: e.pokeId,
        nome: e.nome,
        regiao: e.regiao,
        nivel: e.nivel,
        banda: bandaDe(e.nivel).id,
        nHunts: e.hunts.length,
        killHoje: rendaHoje(e.nivel),
        lootHoje: Math.round(evHoje),
        totalHoje: Math.round(rendaHoje(e.nivel) + evHoje),
        lootNovo: Math.round(p?.ev ?? 0),
        alvo: p?.alvo ?? 0,
        erro: p?.erro ?? null,
        mantidos: (p?.linhas ?? []).filter((l) => l.mantido).length,
      };
    });

  const hunts = grafo.hunts
    .map((h) => ({
      slug: h.slug,
      nome: h.nome,
      area: h.area,
      nivel: h.nivel,
      fonte: h.fonte,
      banda: bandaDe(h.nivel).id,
      nEspecies: h.especies.length,
      rendaHoje: rendaHoje(h.nivel),
      rendaNova: rendaAlvo(h.nivel),
    }))
    .sort((a, b) => a.nivel - b.nivel);

  // A prateleira de cada banda: qual item o gerador escolhe para cada slot naquele nível.
  const bandas = BANDAS.map((b) => {
    const nRef = b.max === Infinity ? 160300 : Math.round(Math.sqrt(b.min * b.max));
    const fake = { nivel: nRef, loot: [] };
    const p = proporLoot(fake, catalogo);
    return {
      ...b,
      max: b.max === Infinity ? null : b.max,
      nRef,
      alvo: p.alvo,
      linhas: p.linhas,
    };
  });

  return {
    gerado: new Date().toISOString(),
    modelo: {
      G_BASE,
      G_EXP,
      CONSUMO,
      ORCAMENTO,
      POCAO,
      KILLS_HORA,
      SLOTS,
      loja: { bolas: LOJA_BOLAS, pocoes: LOJA_POCOES, revives: LOJA_REVIVES },
    },
    resumo: {
      itens: itens.length,
      itensDeLoot: itens.filter((i) => i.nDrops > 0).length,
      catalogo: catalogo.length,
      especies: especies.length,
      hunts: hunts.length,
      amplitudeHoje: rendaHoje(160300) / rendaHoje(1),
      amplitudeNova: rendaAlvo(160300) / rendaAlvo(1),
      tetoPocao: nivelTetoPocao(),
      precoMaxLoot: Math.max(...catalogo.filter((i) => i.categoria === 'loot').map((i) => i.npcPrice)),
    },
    autonomia: autonomia(),
    bandas,
    itens,
    especies,
    hunts,
  };
}
