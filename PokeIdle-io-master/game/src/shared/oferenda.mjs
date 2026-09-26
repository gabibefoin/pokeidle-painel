/**
 * OFERENDA DE POKÉMON — a roleta que troca pokémon do depot por uma pedra de evolução.
 *
 * O jogador carrega até cinco pokémon na roleta. Cada um pinta uma fatia do **tipo** dele, e o
 * giro devolve UMA pedra: a que caiu. Os pokémon oferecidos somem.
 *
 * Aqui mora só a matemática — sem banco, sem jogador, sem `Math.random` obrigatório. É o que
 * permite ao `tools/teste-oferenda.mjs` provar a distribuição com um sorteador falso, e ao
 * cliente desenhar exatamente a mesma roleta que o servidor vai girar (ver `montarRoleta`).
 *
 * ### Um pokémon vale UMA CASA — 20% do círculo —, tenha ele um tipo ou dois
 *
 * É a regra inteira, e dela sai todo o resto:
 *
 *   · **Charmander** (FIRE) → 20% de Fire Stone;
 *   · **Charizard** (FIRE/FLYING) → 10% de Fire Stone e 10% de Feather Stone;
 *   · **Gengar** (GHOST/POISON) → 10% de Darkness Stone e 10% de Venom Stone.
 *
 * O segundo tipo, portanto, compra VARIEDADE e não vantagem: ele parte a casa ao meio em vez de
 * acrescentar uma. Quando cada tipo valia uma casa inteira, um dual-type pesava o dobro de um
 * tipo único — um Shiny Charmander no meio de Tyranitar saía com metade da fatia que o dono dele
 * tinha pago.
 *
 * Um pokémon cujos dois tipos caem na MESMA pedra (um DARK/GHOST comum, que só tem a Darkness
 * Stone) leva a casa inteira nela. A divisão é pelas PEDRAS que ele pinta, não pelos tipos que
 * ele tem — e é por isso que ela usa `pedrasDoPokemon`, que já resolve essa fusão.
 *
 * ### SHINY paga em SHINY STONE, e só nela
 *
 * Um pokémon shiny na roleta não pinta a pedra comum do tipo dele: pinta a **Shiny Stone** do
 * tipo. Shiny Dratini (DRAGON) pinta Dragon Shiny Stone e mais nada; Shiny Bulbasaur
 * (GRASS/POISON) pinta Grass Shiny Stone **ou** Poison Shiny Stone. É a mesma regra de tipo de
 * sempre — o que muda é a prateleira de onde a pedra sai.
 *
 * É a ÚNICA fonte de Shiny Stone que não passa por fragmento. E ela se paga sozinha, sem regra
 * extra nenhuma: o shiny ocupa **uma casa das cinco**, então a fatia dele vale 1/5 do círculo.
 * Cinco shinys do mesmo tipo fecham a roleta e garantem a pedra; um shiny no meio de quatro
 * comuns dá ~20% de chance. Nos dois casos a conta é a mesma — **cinco shinys por uma Shiny
 * Stone** —, o que fica perto do caminho do fragmento, e um pouco acima dele (10 fragmentos a
 * 0,0005% na Outland ≈ 2 milhões de abates; cinco shinys ≈ 2,4 milhões, pela chance de captura
 * shiny).
 *
 * As dezoito Shiny Stones NÃO se fundem como as comuns: DARK e GHOST dividem a Darkness Stone,
 * mas Dark Shiny Stone e Ghost Shiny Stone são itens diferentes (ver `SHINY_STONE_POR_TIPO`).
 * Daí as fatias serem indexadas por CHAVE (`n:<nome>` para comum, `s:<TIPO>` para shiny) em vez
 * de por nome: só assim as duas tabelas convivem no mesmo círculo sem uma fundir a outra.
 *
 * O **cadeado de venda NÃO barra a oferenda** (ver `validarOferenda`): ele é do Mercado NPC, onde
 * existe um botão que apaga o depot inteiro num clique. Aqui cada pokémon entra por uma escolha
 * própria, num card que mostra a ficha dele, e o diálogo do fim conta quantos shinys vão — é esse
 * conjunto, e não o cadeado, que segura a mão de quem for queimar um shiny.
 *
 * ### O `vazio` é o que faz a roleta pela metade valer a metade
 *
 * A roleta tem cinco casas. Enchendo as cinco, sai pedra garantida. Com duas, a chance é 40% —
 * o resto do círculo é a fatia VAZIA, e ela aparece desenhada na tela antes de o jogador
 * confirmar. Sem isso, girar com um pokémon só daria a mesma pedra que girar com cinco, e
 * ninguém jamais carregaria a segunda casa: a mecânica inteira viraria "ofereça um Charmander,
 * receba uma Fire Stone".
 *
 * A conta abaixo é o que mantém a promessa exata `P(pedra) = pokémon / 5` mesmo com dual-type
 * no meio (senão três Gengar — seis fatias — passariam das cinco casas e dariam pedra garantida
 * por pouco mais da metade do preço):
 *
 *     peso[pedra] = Σ (2 ÷ nº de pedras daquele pokémon), sobre quem pede aquela pedra
 *     W           = Σ peso = 2 × (pokémon que pintam alguma pedra)
 *     fatia[pedra]= n × peso[pedra]
 *     vazio       = (5 − n) × W
 *     total       = 5 × W
 *
 *     P(pedra)        = n·W / 5·W = n/5        ← só depende de quantos pokémon entraram
 *     P(esta | pedra) = peso[pedra] / W        ← só depende da mistura de tipos
 *
 * Tudo em inteiro, de propósito: o sorteio é um `randomInt(0, total)` uniforme, sem soma de
 * ponto flutuante acumulando erro na última fatia.
 *
 * ### Cinco pokémon por UMA pedra: de onde sai o número
 *
 * A roleta nasceu com dez casas; em 16/09/2026 caiu para cinco, por decisão de design — dez
 * pokémon por pedra pesava demais para quem precisa de uma pedra só. Medido no banco de produção
 * (restore de 15/09/2026):
 *
 *   · o depot cresce **13 a 160 pokémon por dia** por jogador ativo (mediana perto de 55) — são
 *     os que ele GUARDA, fora o que já vende ao NPC;
 *   · o jogador MEDIANO tem **9 pedras** na bolsa. O topo tem 3.321, e 2.054 contas têm alguma.
 *
 * Cinco por uma põe a oferenda em ~11 pedras/dia para quem está no meio da tabela — mais que o
 * dobro do que ele tem hoje — e em ~32/dia no teto absoluto de captura, contra as ~250/dia de UM
 * tipo que o topo do ranking já farma (ver §3b de `MECANICAS.md`). Ou seja: muda o jogo de quem
 * precisa de uma pedra específica e continua pequeno para quem já tem mil. Era o contrário que se
 * precisava evitar — uma torneira de pedra no endgame derruba o preço da única coisa que a
 * comunidade negocia entre si, porque o NPC não compra pedra (`normalizarNpcPriceItem`).
 *
 * O preço real da oferenda não é "cinco pokémon": é o ouro do NPC que eles valiam (~10 abates cada,
 * ver `TETO_SELL_POKEMON`). Quem oferenda está trocando ouro por uma pedra **do tipo que ele
 * escolhe** — e é a escolha que se está vendendo, não a quantidade.
 *
 * Mexer nisso é mexer em `OFERENDA_CASAS`, e em mais nada: a chance é `pokémon / casas`, então
 * seis casas encarecem a pedra na mesma proporção.
 *
 * ### Por que o tipo vem de `type1`/`type2`, e não da regra da evolução
 *
 * `tiposPedraRefino` (o que o refino usa) começa por `tipoDaPedraDeEvolucao`, que carrega
 * exceções escritas à mão — o Pidgey evolui com Feather Stone, e não com a Sun Stone do NORMAL.
 * Boa regra para evoluir, ruim para ESTA tela: o card mostra os selos `NORMAL · FLYING` e o
 * jogador espera as pedras desses dois. Aqui a roleta é o que está escrito no card.
 */

import { PEDRA_POR_TIPO } from './pedras-evolucao.mjs';
import { POTENCIA_MAX } from './nota-pokemon.mjs';

/** Casas da roleta. Cinco pokémon = pedra garantida; menos que isso, o resto é fatia vazia. */
export const OFERENDA_CASAS = 5;

/**
 * Quanto UMA casa vale, em peso — e o número existe só para a divisão fechar em inteiro.
 *
 * Um pokémon vale uma casa, e a casa se divide entre as pedras que ele pinta: tipo único leva os
 * dois pontos numa pedra só, dual-type leva um em cada. `2` basta porque um pokémon tem no
 * máximo dois tipos (`type1`/`type2`), então o divisor é 1 ou 2 — `tools/teste-oferenda.mjs`
 * varre o catálogo inteiro provando que nenhuma espécie pinta uma terceira pedra.
 */
const PESO_CASA = 2;

/** "DRAGON" → "Dragon Shiny Stone". A mesma fôrma de `stoneDoTipo`, em `game/itens-nossos.mjs`. */
export const nomeShinyStone = (tipo) => `${tipo.charAt(0)}${tipo.slice(1).toLowerCase()} Shiny Stone`;

/**
 * As pedras que UM pokémon pinta — `Map` de chave → `{ chave, shiny, tipo, nome }`, sem repetir.
 *
 * A chave é o que evita duas fusões erradas ao mesmo tempo:
 *
 *   · `n:<nome>` para pedra comum. Um Umbreon DARK e um bicho DARK/GHOST caem os dois na
 *     Darkness Stone, que serve os dois tipos — e é isso que se quer: uma fatia, peso 2, e não
 *     duas fatias da mesma pedra. É por NOME, portanto, e não por tipo.
 *   · `s:<TIPO>` para Shiny Stone. Aqui é o contrário: as dezoito são itens distintos, então
 *     Dark Shiny Stone e Ghost Shiny Stone TÊM de ficar separadas. Um shiny DARK/GHOST pinta
 *     duas fatias, como qualquer outro dual-type.
 *
 * `pk` é o pokémon inteiro (e não só os tipos) porque quem decide a prateleira é o `shiny`.
 */
export function pedrasDoPokemon(pk) {
  const out = new Map();
  const shiny = !!pk?.shiny;
  for (const t of pk?.tipos ?? []) {
    const tipo = String(t ?? '').toUpperCase();
    const comum = PEDRA_POR_TIPO[tipo];
    // `PEDRA_POR_TIPO` é a lista dos dezoito tipos que o jogo reconhece; um tipo fora dela não
    // tem pedra de nenhuma das duas prateleiras.
    if (!comum) continue;
    if (shiny) out.set(`s:${tipo}`, { chave: `s:${tipo}`, shiny: true, tipo, nome: nomeShinyStone(tipo) });
    else out.set(`n:${comum}`, { chave: `n:${comum}`, shiny: false, tipo, nome: comum });
  }
  return out;
}

/**
 * O `itemId` de uma pedra, nas duas prateleiras.
 *
 * `pedras` é `{ normal, shiny }`. A `normal` é o `PEDRA_EVOLUCAO_POR_TIPO` do welcome
 * (`tipo → { itemId, nome }`); a `shiny` é `tipo → itemId` (o `SHINY_STONE_POR_TIPO` do
 * servidor) ou `tipo → { itemId }`, que é como a tela remonta a dela a partir do welcome. As
 * duas formas são aceitas porque as duas pontas guardam o mapa no formato que já tinham.
 */
function itemIdDaPedra(fonte, tipo) {
  const v = fonte?.[tipo];
  if (v == null) return null;
  const id = typeof v === 'object' ? v.itemId : v;
  return Number.isInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;
}

/**
 * Monta a roleta de uma oferenda.
 *
 * `pokemons` é `[{ id, tipos, shiny }]` — o formato que o snapshot manda para a tela e o que o
 * sim tem em memória, para as duas pontas lerem a MESMA função. `pedras` é
 * `{ normal, shiny }`; sem ele as fatias saem sem `itemId` e servem só para contar.
 *
 * Devolve `null` quando não há roleta possível (lista vazia, acima das cinco casas, ou nenhum dos
 * pokémon casa com uma pedra). A fatia vazia entra na lista como `{ vazio: true }` para a tela
 * desenhar e o sorteio tratar as duas do mesmo jeito — um sorteio que precisasse lembrar de
 * somar o vazio por fora é um sorteio com um bug esperando.
 */
export function montarRoleta(pokemons, pedras = null) {
  const lista = Array.isArray(pokemons) ? pokemons : [];
  const n = lista.length;
  if (!n || n > OFERENDA_CASAS) return null;

  /** chave da pedra → { meta, peso, qtd, tipos } — `peso` é o que desenha, `qtd` é quantos bichos */
  const contagem = new Map();

  for (const pk of lista) {
    const pedrasDele = [...pedrasDoPokemon(pk).values()];
    if (!pedrasDele.length) continue;
    // A CASA INTEIRA vale `PESO_CASA`, dividida entre as pedras que este pokémon pinta. É isto
    // que faz um pokémon valer sempre uma casa do círculo (20%), tenha ele um tipo ou dois.
    const fatiaDele = PESO_CASA / pedrasDele.length;
    for (const meta of pedrasDele) {
      const atual = contagem.get(meta.chave);
      if (atual) {
        atual.peso += fatiaDele;
        atual.qtd++;
        atual.tipos.add(meta.tipo);
      } else {
        contagem.set(meta.chave, { meta, peso: fatiaDele, qtd: 1, tipos: new Set([meta.tipo]) });
      }
    }
  }

  // Soma `PESO_CASA × (pokémon que pintam alguma pedra)`. Um bicho sem pedra nenhuma (tipo fora
  // da tabela) não entra em W — mas CONTA em `n`, e é por isso que ele encolhe a chance em vez
  // de sumir da conta: o jogador pagou a casa.
  const W = [...contagem.values()].reduce((s, v) => s + v.peso, 0);
  if (!W) return null;

  const total = OFERENDA_CASAS * W;
  // Da maior fatia para a menor, e a CHAVE como desempate: a ordem tem de ser DETERMINÍSTICA,
  // porque é ela que casa o índice sorteado no servidor com a fatia desenhada na tela. Uma
  // ordem que dependesse da iteração de um Map montado noutra ordem de ids faria a animação
  // parar numa pedra e o jogador receber outra.
  const fatias = [...contagem.entries()]
    .sort((a, b) => b[1].peso - a[1].peso || a[0].localeCompare(b[0]))
    .map(([chave, { meta, peso, qtd, tipos }]) => ({
      chave,
      shiny: meta.shiny,
      nome: meta.nome,
      // A comum resolve pelo TIPO (a Darkness Stone serve DARK e GHOST, e qualquer um dos dois
      // chega no mesmo item); a shiny resolve pelo tipo dela, que é único por definição.
      itemId: meta.shiny
        ? itemIdDaPedra(pedras?.shiny, meta.tipo)
        : ([...tipos].sort().map((t) => itemIdDaPedra(pedras?.normal, t)).find((id) => id) ?? null),
      tipos: [...tipos].sort(),
      // `pokemons` é quantos bichos alimentam esta fatia (vai na dica da tela); `peso` é o que
      // o sorteio usa. Os dois deixaram de ser o mesmo número quando a casa passou a se dividir
      // entre os tipos — dois Gengar são 2 pokémon valendo peso 2 em Darkness, não 2 e 2.
      pokemons: qtd,
      peso: n * peso,
      pct: (n * peso) / total,
    }));

  const vazio = (OFERENDA_CASAS - n) * W;
  if (vazio > 0) {
    fatias.push({
      chave: 'vazio', vazio: true, shiny: false, nome: null, itemId: null,
      tipos: [], pokemons: 0, peso: vazio, pct: vazio / total,
    });
  }

  return { casas: OFERENDA_CASAS, oferecidos: n, fatias, total, chancePedra: n / OFERENDA_CASAS };
}

/**
 * Sorteia uma fatia. `aleatorioInt(max)` tem de devolver um inteiro uniforme em `[0, max)`.
 *
 * O servidor passa o `randomInt` do `node:crypto` (uniforme por rejeição, sem o viés de módulo
 * que um `% total` sobre bytes crus teria); o teste passa um contador, e é assim que ele varre
 * a roleta fatia por fatia e prova que cada faixa do intervalo cai onde deveria.
 */
export function sortearFatia(roleta, aleatorioInt) {
  if (!roleta?.total) return -1;
  let n = aleatorioInt(roleta.total);
  if (!Number.isInteger(n) || n < 0 || n >= roleta.total) return -1;
  for (let i = 0; i < roleta.fatias.length; i++) {
    n -= roleta.fatias[i].peso;
    if (n < 0) return i;
  }
  return roleta.fatias.length - 1; // inalcançável: os pesos somam `total`
}

/** A linha que vai para a auditoria — a roleta inteira, para um sorteio contestado ser conferível. */
export function resumoDaRoleta(roleta) {
  if (!roleta) return '';
  return roleta.fatias
    .map((f) => `${f.vazio ? 'vazio' : f.nome}=${f.peso}`)
    .join(' ') + ` /${roleta.total}`;
}

// ------------------------------------------------------------------ Auto Selecionar

/**
 * Por que o AUTO SELECIONAR deixa este pokémon de fora — ou `null` se ele pode entrar.
 *
 * A mão pode oferecer qualquer um que `validarOferenda` aceita, porque cada card é uma escolha
 * olhada. O botão escolhe SEM olhar, então a régua dele é mais dura: fica de fora o que é raro de
 * nascer (shiny, P5), o que carrega investimento que some junto com a linha (item segurado,
 * refino, TM) e o starter. Um pokémon que não pinta pedra nenhuma também fica: ele ocuparia uma
 * casa sem pôr fatia na roda.
 *
 * O cadeado, a vitrine e as duas equipes (PvP e campeonato) são travas por ID. Quem sabe delas é a
 * tela e o banco, e não o pokémon, então elas chegam pela lista `protegidos` de
 * `escolherPioresDaOferenda`.
 */
export function motivoForaDoAuto(pk) {
  if (!pk) return 'sumiu';
  if (pk.shiny) return 'shiny';
  if (Number(pk.potencia) >= POTENCIA_MAX) return 'p5';
  if (pk.heldItemId != null) return 'item';
  if (Number(pk.refinoTotal) > 0 || Object.values(pk.refino ?? {}).some((v) => Number(v) > 0)) return 'refino';
  if (pk.tmElemental || pk.tmAoe) return 'tm';
  if (pk.starter) return 'starter';
  if (!pedrasDoPokemon(pk).size) return 'semPedra';
  return null;
}

/**
 * AUTO SELECIONAR: os pokémon de MENOR NOTA para as casas vazias da roleta.
 *
 * `candidatos` já vem só com quem a oferenda aceita (o depot, sem o ativo, sem posto de Casa e sem
 * Exp. Share: o `ofrMotivoBloqueio` da tela). `nota(pk)` é a nota N= da calculadora
 * (`notaDePokemon`), passada de fora para esta conta não precisar do catálogo de espécies. Quem
 * já está nas casas (`jaEscolhidos`) e os ids de `protegidos` não entram.
 *
 * A nota vai de 0 a 10 DENTRO DA ESPÉCIE: ela diz "nasceu mal", e não "é fraco". Um Dragonite de
 * nota 1 ainda bate mais que um Rattata de nota 9, e é por isso que as equipes de PvP e do
 * campeonato entram em `protegidos`: é nelas que mora o bicho forte que nasceu ruim.
 *
 * `notaMax` é o TETO: só entra nota abaixo dele. Sem teto, um depot com três ruins e um ótimo
 * encheria a quarta casa com o ótimo, e o botão se chama "os piores". A tela passa a nota do
 * Auto Lock N do jogador (a régua que ele mesmo deu para "vale guardar"), com a mesma comparação
 * do cadeado: o Auto Lock tranca `nota ≥ teto`, então aqui entra só `nota < teto`.
 *
 * Empate na nota: vai primeiro o de nível MENOR (menos tempo investido nele) e, depois, o de id
 * maior, a captura mais recente. A ordem é total, então dois cliques seguidos escolhem os mesmos.
 * Pokémon sem nota (ficha sem IV) não entra, porque não dá para dizer que ele é o pior.
 */
export function escolherPioresDaOferenda(candidatos, {
  nota,
  notaMax = Infinity,
  vagas = OFERENDA_CASAS,
  jaEscolhidos = [],
  protegidos = [],
} = {}) {
  const { elegiveis } = elegiveisDaOferenda(candidatos, { nota, notaMax, jaEscolhidos, protegidos });
  const quantos = Math.max(0, Math.min(OFERENDA_CASAS, Math.floor(Number(vagas)) || 0));
  return elegiveis.slice(0, quantos);
}

/**
 * O CRIVO do Auto Selecionar, sozinho: quem passa, em ordem do pior para o melhor, e a conta de
 * quem ficou de fora e por quê.
 *
 * Saiu de dentro de `escolherPioresDaOferenda` para o lote usar a MESMA régua. Se as duas
 * peneiras divergissem, o botão "oferendar tudo" levaria pokémon que o botão de um giro recusa —
 * e a diferença só apareceria depois de as linhas terem sido apagadas.
 *
 * `fora` é o que a tela mostra ao jogador ("3 shiny, 2 refinados, 10 acima da sua régua") e é por
 * isso que ele conta por MOTIVO em vez de só somar: "ficaram 15 de fora" não ajuda ninguém a
 * decidir; "15, sendo 3 shiny" ajuda.
 */
export function elegiveisDaOferenda(candidatos, {
  nota,
  notaMax = Infinity,
  jaEscolhidos = [],
  protegidos = [],
} = {}) {
  const bloqueados = new Set([...jaEscolhidos, ...protegidos].map(Number));
  // Sem teto só quando ele não veio. Um teto torto (texto, `null`, NaN) não pode abrir a porta
  // para tudo: vira zero, e nada entra.
  const teto = notaMax === Infinity ? Infinity
    : (typeof notaMax === 'number' && Number.isFinite(notaMax) ? notaMax : 0);
  const lista = [];
  const fora = {};
  const marcar = (motivo) => { fora[motivo] = (fora[motivo] ?? 0) + 1; };
  for (const pk of Array.isArray(candidatos) ? candidatos : []) {
    if (!pk) continue;
    if (bloqueados.has(Number(pk.id))) { marcar('protegido'); continue; }
    const motivo = motivoForaDoAuto(pk);
    if (motivo) { marcar(motivo); continue; }
    const n = typeof nota === 'function' ? nota(pk) : null;
    if (n == null || !Number.isFinite(Number(n))) { marcar('semNota'); continue; }
    if (Number(n) >= teto) { marcar('regua'); continue; }
    lista.push({ pk, n: Number(n) });
    // O mesmo id duas vezes na entrada não ocupa duas casas.
    bloqueados.add(Number(pk.id));
  }
  lista.sort((a, b) => a.n - b.n
    || (Number(a.pk.level) || 0) - (Number(b.pk.level) || 0)
    || Number(b.pk.id) - Number(a.pk.id));
  return { elegiveis: lista.map((x) => x.pk), fora };
}

// --------------------------------------------------------------- oferendar tudo
//
// O pedido que deu origem a isto: "ta foda catar 200 pokemon e ficar 5 minuto roletando de 3 em
// 3". Quem limpa o Depot depois de dois dias fora gastava 40 rodadas de quatro cliques cada.
//
// ### Isto NÃO é uma torneira de pedra
//
// Duzentos pokémon a cinco por giro dão quarenta pedras, clicando quarenta vezes ou uma. O lote
// não cria pedra que a paciência não criaria — ele tira o tédio, e só. A regra que segura a
// economia continua sendo `OFERENDA_CASAS` (ver o cabeçalho deste arquivo), e ela não é tocada
// aqui.
//
// ### O que o lote ABRE MÃO
//
// A roleta vende ESCOLHA DE TIPO: garimpar cinco do mesmo tipo é o que faz sair a pedra que se
// quer. O lote agrupa na ordem do pior para o melhor e leva o que vier — quem quer um tipo
// específico continua montando as cinco casas à mão. É de propósito: fosse o lote também
// escolher o tipo, o garimpo deixaria de valer alguma coisa.

/**
 * Teto de giros de UMA chamada.
 *
 * Existe pelo tamanho da transação, não pelo jogo: cada giro é uma roleta montada, e o lote
 * apaga todas as linhas de uma vez. Quem tem mais que isto clica de novo — e a tela diz quantos
 * ficaram para a próxima.
 */
export const OFERENDA_LOTE_GIROS_MAX = 50;

/**
 * Os GRUPOS do "oferendar tudo do Depot" — a mesma peneira do Auto Selecionar, a mesma ordem
 * (pior primeiro), fatiada de cinco em cinco.
 *
 * O último grupo pode sair INCOMPLETO, e vai assim mesmo: é a chance parcial de sempre
 * (`n / OFERENDA_CASAS`), a mesma que a roleta à mão dá para quem gira com três casas cheias.
 * Quem chama tem de mostrar essa chance na confirmação — um grupo de três somem com 40% de dar
 * em nada, e isso não pode ser descoberto depois.
 *
 * `totalNaConta` é o tamanho da coleção inteira, e serve a uma regra só: o último pokémon da
 * conta não sai. `validarOferenda` a aplica por giro, mas aqui ela tem de valer ANTES de formar
 * os grupos — a remoção do lote acontece toda no fim, então no último giro `p.pokemons` ainda
 * estaria cheio e a trava não pegaria.
 */
export function montarLoteDaOferenda(candidatos, {
  nota,
  notaMax = Infinity,
  protegidos = [],
  totalNaConta = Infinity,
  girosMax = OFERENDA_LOTE_GIROS_MAX,
} = {}) {
  const { elegiveis, fora } = elegiveisDaOferenda(candidatos, { nota, notaMax, protegidos });
  const teto = Math.max(0, Math.min(
    elegiveis.length,
    Number.isFinite(totalNaConta) ? Math.max(0, totalNaConta - 1) : elegiveis.length,
    Math.max(0, Math.floor(Number(girosMax)) || 0) * OFERENDA_CASAS,
  ));
  const vao = elegiveis.slice(0, teto);
  const grupos = [];
  for (let i = 0; i < vao.length; i += OFERENDA_CASAS) {
    grupos.push(vao.slice(i, i + OFERENDA_CASAS));
  }
  return { grupos, fora, restantes: elegiveis.length - vao.length };
}

/**
 * A PRÉVIA do lote: quantos giros, quantas pedras garantidas e quanto se espera de cada pedra.
 *
 * O número por pedra é ESPERANÇA, não promessa: a soma, giro a giro, da probabilidade de cada
 * fatia. Vinte giros com uma fatia de 40% dão "8,0 Fire Stone" — e o jogador pode receber seis
 * ou dez. Por isso a tela o mostra com uma casa decimal e a palavra "esperado": um número
 * redondo seria lido como contrato.
 *
 * Roda no cliente (para a confirmação) e no servidor (para conferir o que foi prometido) com o
 * mesmo código e os mesmos grupos — é o que impede a tela de prometer uma distribuição que o
 * sorteio não tinha como dar.
 */
export function previaDoLote(grupos, pedras) {
  const porPedra = new Map();
  let garantidos = 0;
  let giros = 0;
  for (const grupo of grupos ?? []) {
    const roleta = montarRoleta(grupo, pedras);
    if (!roleta) continue;
    giros++;
    if (roleta.chancePedra >= 1) garantidos++;
    for (const f of roleta.fatias) {
      if (f.vazio) continue;
      const atual = porPedra.get(f.itemId) ?? {
        itemId: f.itemId, nome: f.nome, shiny: !!f.shiny, tipos: f.tipos, esperado: 0,
      };
      atual.esperado += f.peso / roleta.total;
      porPedra.set(f.itemId, atual);
    }
  }
  const ultimo = (grupos ?? [])[(grupos ?? []).length - 1] ?? [];
  return {
    giros,
    oferecidos: (grupos ?? []).reduce((s, g) => s + g.length, 0),
    garantidos,
    // O grupo incompleto do fim, quando existe — é o único que pode não dar nada.
    parcial: ultimo.length && ultimo.length < OFERENDA_CASAS
      ? { pokemons: ultimo.length, chance: ultimo.length / OFERENDA_CASAS }
      : null,
    pedras: [...porPedra.values()].sort((a, b) => b.esperado - a.esperado),
  };
}
