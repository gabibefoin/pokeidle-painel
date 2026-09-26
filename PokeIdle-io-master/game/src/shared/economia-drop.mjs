/**
 * A ECONOMIA DE COINS — a renda passa a ser paga pelo DROP, não pela kill.
 *
 * ### O que estava acontecendo
 *
 * Duas curvas emendadas, erradas na mesma direção. O ouro por abate era `0,6·n²` até o nível
 * 150 e `12.000·(n/150)^0,6` acima dele, e ia de **8 coins no nível 1 a 787.928 no 160.300** —
 * amplitude de 98.491×. O loot, no mesmo trecho, ficava parado entre 16 e 400 coins por kill: a
 * fatia dele na renda caía de 67% no começo para **0,0%** no fim. Pior, ele SUMIA — das 233
 * espécies acima do nível 25.000, só 45 largavam algo que o NPC compra, com valor esperado
 * médio de 6 coins.
 *
 * Quem passava do nível 100 parava de olhar para o chão. A hunt virava uma torneira de coin — e
 * uma torneira que multiplicava por 98 mil do começo ao fim, o que com preço de loja parado é
 * poder de compra multiplicado por 98 mil.
 *
 * ### O desenho
 *
 * Duas peças, e elas só funcionam juntas:
 *
 * 1. **Uma curva só de ouro, travada no nível 25.000.** `ouroPorKillDoNivel`, em
 *    `sell-value.mjs`, é uma lei de potência ancorada em dois pontos de produto — nível 1 paga
 *    36 e nível 5.000 paga 6.000 —, e ela para de crescer no 25.000, em 15.776. Do 25.000 para
 *    cima todo abate paga o mesmo.
 *
 * 2. **O drop é a outra camada.** Este arquivo resolve, espécie a espécie, a tabela de loot que
 *    faz a renda TOTAL bater o alvo de `alvoRendaPorKill`:
 *
 * ```
 * renda alvo = 1,15 · ouro(n)                              n ≤ 25.000
 * renda alvo = 1,15 · 15.776 · (n/25.000)^0,30             n > 25.000
 * ```
 *
 * Abaixo do teto o drop é uma camada FINA e constante: 13% da renda. Não é enfeite — é o que
 * mantém o loot valendo alguma coisa em Hoenn, Sinnoh, Unova e Kalos, onde antes ele era 0,1%
 * e ninguém olhava para o chão. Mas ali quem manda é o ouro, que é o que a curva promete.
 *
 * Acima do teto o ouro congela e o drop assume o crescimento. O expoente 0,30 foi escolhido
 * para uma coisa só: na hunt mais alta do jogo (160.300) o drop responde por **metade** da
 * renda. Do teto ao topo a renda cresce 1,75× — a escada de 6,4× de nível que existe ali não
 * pode virar 6,4× de poder de compra, com preço de loja parado.
 *
 * Medido, em hunts cujo marcador bate com o nível das espécies:
 *
 * | nível | hunt | ouro | drop | total | drop% |
 * |---|---|---|---|---|---|
 * | 1 | caterpie | 36 | 12 | 48 | 25% |
 * | 100 | houndoom | 572 | 84 | 656 | 13% |
 * | 1.000 | ditto_sinnoh | 2.282 | 409 | 2.691 | 15% |
 * | 5.000 | snivy_unova | 6.000 | 846 | 6.846 | 12% |
 * | 25.000 | litten_alola | 15.776 | 2.317 | 18.093 | 13% |
 * | 160.300 | tinkaton_alola | 15.776 | 16.000 | 31.776 | 50% |
 *
 * ### Por que a CHANCE não muda e a QUANTIDADE muda
 *
 * A chance é o que dá o sabor da espécie — o Dragonite larga Dragon Scale quase sempre e
 * Crystal Stone quase nunca, e essa proporção é curadoria que não se joga fora por uma conta de
 * economia. A quantidade não carrega sabor nenhum: "3 Dragon Scale" e "40 Dragon Scale" contam
 * a mesma história. Então o solver mexe só na quantidade, e o EV é linear nela — o alvo fecha
 * sem tocar em uma única probabilidade do catálogo.
 *
 * Entrada com `chance: 0` fica intocada de propósito: é item desligado no espelho (o Dragonite
 * tem um Strange Pheromone de 1.000.000 assim), e ligá-lo por acidente seria uma impressora.
 *
 * ### O teto de quantidade e a Rare Pokémon Picture
 *
 * Escalar só a quantidade quebra no topo: uma espécie de nível 5.000 com EV 36 precisaria de
 * ×100, e "Straw ×500" não é drop, é ruído. Então a quantidade tem teto (`QTD_MAX`) e o que
 * sobra do alvo vai para UM slot raro.
 *
 * Esse slot é a **Rare Pokémon Picture** (5.000 coins), e ela é a escolha óbvia por três
 * motivos: é o item mais caro do catálogo que o NPC de fato compra, **não cai de espécie
 * nenhuma hoje** — então promovê-la não infla nada que já exista —, e o nome já diz o papel.
 * Ela vira a moeda reconhecível do alto nível: 5% por abate, e a quantidade fecha a conta.
 *
 * As pedras de evolução NÃO servem para isso, embora a ECONOMIA.md as proponha: o `npcPrice`
 * delas é zerado por `normalizarNpcPriceItem` — quem paga por pedra é a comunidade, não o NPC.
 *
 * ### Espécie sem nada vendável
 *
 * Ganha primeiro o item do TIPO elemental dela (`ITEM_POR_TIPO`), a 60%, só para ter chão e
 * sabor; o alvo fecha na Picture como em todas as outras. É a mesma regra que o espelho já
 * segue no resto do catálogo — Water Stone cai de WATER em 84% dos casos — e a mesma que
 * `drops-nossos.mjs` usou para tapar o buraco da Sun Stone.
 *
 * ### Rode nas DUAS pontas
 *
 * O cliente monta o catálogo dele do zero (`carregarCatalogoEspecies`) dos MESMOS JSONs e
 * desenha a lista de drops direto de `especie.loot`. Loot que só o servidor conhecesse cairia
 * na hunt sem aparecer na Pokédex — o mesmo motivo pelo qual `aplicarDropsNossos` mora em
 * `shared/`.
 */

import { TETO_OURO_KILL, NIVEL_TETO_OURO, ouroPorKillDoNivel } from './sell-value.mjs';

/**
 * Quanto o DROP acrescenta sobre o ouro abaixo do teto.
 *
 * 0,15 sobre o ouro = 13% da renda. É camada fina de propósito: abaixo do teto quem manda é a
 * curva de ouro, e essa fração existe só para o loot continuar valendo alguma coisa nas regiões
 * do meio — onde ele era 0,1% da renda e o jogador tinha razão em ignorá-lo.
 */
export const FRACAO_DROP_BASE = 0.15;

/**
 * Expoente da subida da renda total ACIMA do teto, onde o ouro já congelou.
 *
 * Escolhido para o drop responder por metade da renda na hunt mais alta do jogo (160.300).
 * Do teto ao topo a renda cresce 1,75×, contra 6,4× de escada de nível.
 */
export const EXPOENTE_RENDA = 0.30;

/** Teto de unidades por entrada de loot — acima disto a leitura vira ruído. */
export const QTD_MAX = 20;

/** O slot raro que fecha a conta do alto nível. Ver o cabeçalho. */
export const ITEM_RARO = 'Rare Pokémon Picture';

/** Chance do slot raro, em percentual (o catálogo guarda `% × 1000`). */
export const CHANCE_RARO_PCT = 5;

/**
 * Chance MÁXIMA do item-semente de tipo, em percentual.
 *
 * É teto, não valor fixo: a chance real é resolvida contra o alvo daquele nível. Fixá-la em 60%
 * quebrava embaixo — uma espécie de nível 10 sem loot ganhava um item de 500 coins a 60% e
 * entregava 300 de EV contra um alvo de 22, inflando a hunt inteira em 12×.
 */
export const CHANCE_SEMENTE_MAX_PCT = 60;

/**
 * O item que uma espécie SEM loot vendável passa a largar, pelo tipo elemental dela.
 *
 * É o mais caro que o catálogo tem daquele tipo, para a quantidade ficar legível. FAIRY não tem
 * item nenhum no espelho e cai em NORMAL — é o tipo que o espelho já usa como neutro.
 */
export const ITEM_POR_TIPO = {
  NORMAL: 'Luck Medallion',
  FIRE: 'Magma Foot',
  WATER: 'Air Tank',
  GRASS: 'Massive Vines',
  ELECTRIC: 'Electric Tail',
  ICE: 'Ski Poles',
  FIGHTING: 'Belt of Champion',
  POISON: 'Female Ear',
  GROUND: 'Horn Drill',
  FLYING: 'Colored Feather',
  PSYCHIC: 'Fox Tail',
  BUG: 'Pinsir Horn',
  ROCK: 'Solid Rock Paw',
  GHOST: 'Traces of Ghost',
  DRAGON: 'Dragon Tooth',
  DARK: 'Dark Moon',
  STEEL: 'Steelix Tail',
  FAIRY: 'Luck Medallion',
};

/** A renda TOTAL alvo por kill (ouro + venda do drop) num nível de hunt. */
export function alvoRendaPorKill(nivel) {
  const n = Math.max(1, Number(nivel) || 1);
  const base = n <= NIVEL_TETO_OURO
    ? ouroPorKillDoNivel(n)
    : TETO_OURO_KILL * (n / NIVEL_TETO_OURO) ** EXPOENTE_RENDA;
  return Math.round(base * (1 + FRACAO_DROP_BASE));
}

/**
 * A parte da renda alvo que o DROP tem de pagar: o que sobra depois do ouro daquele nível.
 *
 * Abaixo do teto isso é a camada fina de `FRACAO_DROP_BASE`; acima, é todo o crescimento, já
 * que o ouro congelou. A conta é a mesma nos dois lados — é a curva do ouro que muda de forma,
 * não esta função.
 */
export function alvoDropPorKill(nivel) {
  return Math.max(0, alvoRendaPorKill(nivel) - ouroPorKillDoNivel(nivel));
}

/** Quantidade média de uma entrada de loot. */
const qtdMedia = (l) => ((l.minCount ?? 1) + (l.maxCount ?? 1)) / 2;

/** Valor esperado de uma entrada, em coins por kill. `chance` no catálogo é `% × 1000`. */
const evDaEntrada = (l, preco) => (Math.min(100, (l.chance ?? 0) / 1000) / 100) * qtdMedia(l) * preco;

/**
 * Reescreve a tabela de loot das espécies para a renda bater o alvo.
 *
 * `precoDe(nome)` devolve o que o NPC paga por uma unidade do item, ou 0 se ele não compra —
 * quem não é vendável (pedra de evolução, key-item, consumível de loja) fica fora da conta e
 * intocado na tabela, porque não é renda.
 *
 * Devolve quantas espécies foram ajustadas.
 */
export function aplicarEconomiaDrop(lista, precoDe) {
  let ajustadas = 0;
  for (const esp of lista ?? []) {
    if (reequilibrarEspecie(esp, precoDe)) ajustadas++;
  }
  return ajustadas;
}

/** O reequilíbrio de UMA espécie. Devolve `false` quando ela está abaixo do teto e nada muda. */
export function reequilibrarEspecie(esp, precoDe) {
  const alvo = alvoDropPorKill(esp?.huntLevel);
  if (!esp || alvo <= 0) return false;

  esp.loot ??= [];
  const precoRaro = precoDe(ITEM_RARO) || 0;

  /** Só entra na conta o que ROLA e o que o NPC compra. `chance: 0` fica de fora e intocado. */
  const pagantes = () => esp.loot.filter((l) => (l.chance ?? 0) > 0 && precoDe(l.name) > 0);

  // Espécie sem nada vendável ganha o item do tipo dela — chão e sabor antes da conta.
  //
  // A chance sai do ALVO, não de um número fixo: uma unidade de um item de 500 coins a 60% são
  // 300 de EV, que é o alvo inteiro de uma hunt de nível 700 e doze vezes o de uma de nível 10.
  // Resolvida, ela vira 4% lá embaixo e bate no teto de 60% lá em cima, onde a quantidade e a
  // Picture assumem o resto.
  if (!pagantes().length) {
    const semente = ITEM_POR_TIPO[String(esp.type1 ?? '').toUpperCase()] ?? ITEM_POR_TIPO.NORMAL;
    const preco = precoDe(semente);
    if (preco > 0) {
      const pct = Math.min(CHANCE_SEMENTE_MAX_PCT, (alvo / preco) * 100);
      esp.loot.push({ name: semente, chance: Math.max(1, Math.round(pct * 1000)), minCount: 1, maxCount: 1 });
    }
  }

  const entradas = pagantes().filter((l) => l.name !== ITEM_RARO);
  const evAtual = entradas.reduce((s, l) => s + evDaEntrada(l, precoDe(l.name)), 0);

  // A escala vai toda na QUANTIDADE, com teto, e nos DOIS sentidos.
  //
  // Escalar para baixo é seguro porque o alvo é contínuo: ele é uma fração fixa do ouro daquele
  // nível, então não existe degrau em que uma espécie um ponto acima da vizinha seja esmagada.
  // E é necessário — o espelho traz quantidades que não são desenho, são acidente de
  // importação: o Mightyena larga `Dark Gem ×103-4467`, um item de 1 coin, e isso sozinho eram
  // 2.171 de EV contra um alvo de 217. Dez vezes a renda da faixa, em ruído ilegível.
  //
  // O piso de 1 unidade e o teto de `QTD_MAX` significam que nem todo alvo fecha exato: uma
  // espécie cujo drop mais barato já passa do alvo com uma unidade continua acima dele. O
  // desvio que sobra é pequeno em coin e a alternativa seria mexer na chance, que é a curadoria.
  const escala = evAtual > 0 ? alvo / evAtual : 0;
  if (escala > 0) {
    for (const l of entradas) {
      const min = Math.max(1, Math.min(QTD_MAX, Math.round((l.minCount ?? 1) * escala)));
      const max = Math.max(min, Math.min(QTD_MAX, Math.round((l.maxCount ?? 1) * escala)));
      l.minCount = min;
      l.maxCount = max;
    }
  }

  // O que o teto de quantidade não deixou fechar vai para o slot raro.
  const evDepois = entradas.reduce((s, l) => s + evDaEntrada(l, precoDe(l.name)), 0);
  const falta = alvo - evDepois;
  const jaTem = esp.loot.find((l) => l.name === ITEM_RARO);

  // Uma unidade da Picture a 5% já são 250 de EV. Sem o teste de qtd >= 1 ela entrava mesmo
  // quando faltavam 22 coins — e 250 num alvo de 22 é a hunt inteira inflada em 12×. Abaixo
  // disso o alvo simplesmente fica um pouco por fechar, que custa moedas e não distorce nada.
  const qtd = precoRaro > 0 ? Math.round(falta / ((CHANCE_RARO_PCT / 100) * precoRaro)) : 0;

  if (falta > 0 && qtd >= 1) {
    if (jaTem) {
      jaTem.chance = CHANCE_RARO_PCT * 1000;
      jaTem.minCount = qtd;
      jaTem.maxCount = qtd;
    } else {
      esp.loot.push({ name: ITEM_RARO, chance: CHANCE_RARO_PCT * 1000, minCount: qtd, maxCount: qtd });
    }
  } else if (jaTem) {
    // Sobrou renda sem precisar do slot raro — tira, senão ele viraria excedente puro.
    esp.loot.splice(esp.loot.indexOf(jaTem), 1);
  }

  return true;
}
