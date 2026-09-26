/**
 * Cadeias que se ABREM em mais de um destino, a arte que decide se um destino existe, e a
 * regra de QUAL PEDRA cada evolução pede (`tipoDaPedraDeEvolucao`, no fim do arquivo).
 *
 * `evolvesToId` é UM campo, então o catálogo só sabe dizer "Eevee vira Vaporeon". As outras
 * sete eeveelutions, o Gallade, a Froslass, o Shedinja — todos já existiam aqui, com sprite, e
 * sem caminho nenhum para chegar até eles.
 *
 * ### O nível é o `huntLevel` do destino — de TODOS eles
 *
 * O nível é o do MARCADOR da hunt onde o destino aparece — o número que a ficha dele mostra.
 * Mesma régua de `evolucoes-cruzadas.mjs`, e aplicada à família inteira, não só aos destinos
 * novos: dois irmãos do mesmo degrau têm de custar o mesmo, senão a tela de escolha vira uma
 * pergunta com uma resposta certa. É por isso que a tabela repete o destino que já estava no
 * `evolvesToId` em vez de listar só o que falta.
 *
 * Dois números mudam por causa disso, e os dois estavam baixos:
 *
 *   · **Vaporeon: 80 → 1.125.** Era o único irmão de graça — mesmo BST do Jolteon (1.000) por
 *     um treze avos do nível. 1.125 é o degrau da hunt dele.
 *   · **Vileplume: 60 → 70.** O `huntLevel` do Vileplume, e agora o Bellossom fica em 50.
 *
 * ### Os números literais abaixo NÃO são a palavra final
 *
 * No boot, as duas pontas rodam `aplicarTetoDeCaptura` (`shared/teto-captura.mjs`), que
 * REESCREVE `nivel` nesta tabela, no lugar, para todo destino de Outland+ ou que pedisse mais
 * de 100 — o Slowking cai para 100, o Gallade e a Froslass idem. A exceção é quem vem marcado
 * `fixo` (as eeveelutions, ver a entrada do Eevee): o teto passa reto por elas. Foi o teto de captura que exigiu isso: se a bola entrega um Jolteon no Nv 100, cobrar
 * 1.000 de quem quer evoluir o Eevee seria o jogo se contradizendo na mesma tela.
 *
 * O que está escrito aqui continua sendo a régua ANTERIOR — "o degrau da hunt onde o destino
 * mora" — e é dela que o alinhamento de irmãos (dois do mesmo degrau custam o mesmo) sai. Para
 * ler o número que o jogo cobra hoje, use `destinosDeEvolucao` depois do boot, nunca a tabela
 * crua.
 *
 * ### O que decide se um destino é ESCOLHÍVEL
 *
 * `looktype: 1` é o placeholder de "sprite ainda não nomeada no Sprite Lab", e ele nem está no
 * `outfits-index.json` — 291 espécies do catálogo carregam esse valor. Evoluir para uma delas
 * gasta a pedra e devolve um pokémon sem arte nenhuma, sem volta. `temArteJogavel` é a trava, e
 * ela não vale só para esta tabela: 95 elos que já estavam no catálogo apontam para um alvo
 * assim (Chespin → Quilladin, Grookey → Thwackey, Applin → Flapple, Dreepy → Drakloak…).
 */

import { LOOKTYPE_SEM_ARTE, temSpriteJogo } from './sprite-jogo.mjs';

export { LOOKTYPE_SEM_ARTE };

/** A espécie tem sprite de verdade? É a trava que impede evoluir para um placeholder. */
export function temArteJogavel(especie) {
  return temSpriteJogo(especie);
}

/**
 * A família inteira por espécie base, na ordem em que a tela mostra.
 *
 * O primeiro da lista é o destino que o `evolvesToId` do catálogo já apontava — ele abre a
 * escolha porque é o que o jogador conhece. Bases com clone `13xxx` (as hunts de Hoenn) repetem
 * a entrada: são duas espécies distintas no catálogo, e o jogador pode ter qualquer uma.
 */
export const EVOLUCOES_RAMIFICADAS = {
  // Gloom (GRASS) — Leaf Stone
  44: [{ para: 45, nivel: 70 }, { para: 182, nivel: 50 }],
  // Poliwhirl (WATER) — Water Stone
  61: [{ para: 62, nivel: 80 }, { para: 186, nivel: 70 }],
  // Slowpoke (WATER) — Water Stone
  79: [{ para: 80, nivel: 60 }, { para: 199, nivel: 1_000 }],
  // Eevee (NORMAL) — a pedra é a do DESTINO. A família mais larga do jogo: oito destinos.
  //
  // Todos no Nv 80, e `fixo`: é o nível em que Vaporeon, Jolteon e Flareon aparecem nas hunts
  // de Kanto, e o jogador lia "a evolução é nível 80, mas o Eevee só evolui no 100" na mesma
  // tela. Os oito ficam iguais porque são irmãos do mesmo degrau (ver o topo do arquivo) — e o
  // `fixo` impede o teto de captura de devolver Leafeon, Glaceon e Sylveon ao 100 só por serem de
  // Sinnoh e Kalos. O que o teto protege (ninguém cobrar ACIMA do que a bola entrega) continua
  // valendo: 80 está abaixo dele.
  133: [
    { para: 134, nivel: 80, fixo: true }, // Vaporeon
    { para: 135, nivel: 80, fixo: true }, // Jolteon
    { para: 136, nivel: 80, fixo: true }, // Flareon
    { para: 196, nivel: 80, fixo: true }, // Espeon
    { para: 197, nivel: 80, fixo: true }, // Umbreon
    { para: 470, nivel: 80, fixo: true }, // Leafeon
    { para: 471, nivel: 80, fixo: true }, // Glaceon
    { para: 700, nivel: 80, fixo: true }, // Sylveon
  ],
  // Tyrogue (FIGHTING) — Punch Stone. Os três irmãos no mesmo degrau.
  236: [{ para: 237, nivel: 60 }, { para: 106, nivel: 60 }, { para: 107, nivel: 60 }],
  // Wurmple (BUG) — Cocoon Stone
  265: [{ para: 266, nivel: 650 }, { para: 268, nivel: 500 }],
  13265: [{ para: 266, nivel: 650 }, { para: 268, nivel: 500 }],
  // Kirlia (PSYCHIC) — Enigma Stone
  281: [{ para: 282, nivel: 100 }, { para: 475, nivel: 1_500 }],
  13281: [{ para: 282, nivel: 100 }, { para: 475, nivel: 1_500 }],
  // Nincada (BUG) — Cocoon Stone
  290: [{ para: 291, nivel: 700 }, { para: 292, nivel: 500 }],
  13290: [{ para: 291, nivel: 700 }, { para: 292, nivel: 500 }],
  // Snorunt (ICE) — Ice Stone
  361: [{ para: 362, nivel: 80 }, { para: 478, nivel: 1_250 }],
  13361: [{ para: 362, nivel: 80 }, { para: 478, nivel: 1_250 }],
  // Clamperl (WATER) — Water Stone
  366: [{ para: 367, nivel: 700 }, { para: 368, nivel: 550 }],
  13366: [{ para: 367, nivel: 700 }, { para: 368, nivel: 550 }],
  // Burmy (BUG) — ramifica em Wormadam (BUG/GRASS) ou Mothim (BUG/FLYING)
  412: [{ para: 413, nivel: 2_000 }, { para: 414, nivel: 1_250 }],
};

/**
 * O TIPO que decide a pedra de uma evolução.
 *
 * Fora das ramificações é o tipo primário da BASE, como sempre foi — Sneasel é DARK e pede
 * Darkness Stone para virar Weavile, e mexer nisso trocaria a pedra de umas quatrocentas
 * cadeias que já funcionam.
 *
 * Dentro de uma ramificação é o tipo primário do DESTINO, e é o que dá sentido à escolha: o
 * Eevee é NORMAL e pedia Sun Stone para virar qualquer coisa, inclusive Vaporeon. Agora Vaporeon
 * pede Water Stone, Jolteon pede Thunder Stone, Flareon pede Fire Stone — a pedra passa a ser o
 * que ele vai VIRAR, não o que ele é. Das onze famílias que abrem, só o Eevee tem destinos de
 * tipos diferentes; nas outras dez a conta dá exatamente a mesma pedra de antes.
 *
 * De quebra conserta espécies cujo espelho antigo trazia rótulos de forma no lugar de tipo
 * (Burmy era `"PLANT"`/`"CLOAK"`). Com BUG de verdade, Mothim e Wormadam pedem Cocoon Stone
 * pela regra do destino; Wormadam Plant segue BUG/GRASS.
 */
/**
 * Espécies cuja pedra segue o tipo SECUNDÁRIO, e não o primário.
 *
 * A regra geral do jogo é "pedra = tipo primário", desde a v1.11.0. Ela funciona para quase
 * tudo e quebra numa família só: o pássaro NORMAL/FLYING. Pidgey é NORMAL antes de ser
 * qualquer coisa, então pedia Sun Stone — a pedra genérica — enquanto a **Feather Stone
 * existia sem uso nenhum**. No catálogo inteiro só três espécies têm FLYING como primário
 * (Noibat, Rookidee, Corvisquire) e duas delas estão travadas por falta de sprite; sobrava
 * UMA evolução no jogo consumindo a pedra, e ainda no nível 20.000.
 *
 * A lista é curada, não derivada de `type2 === 'FLYING'`. Aplicar a regra por tipo pegaria
 * mais 21 espécies e tiraria Zubat da Venom Stone, Scyther da Cocoon e Gligar da Earth — onde
 * o primário é bem mais característico que o "voa". Aqui entram só os pássaros em que voar É
 * a identidade e o NORMAL é enchimento.
 *
 * Os clones `13xxx` (hunts de Hoenn) repetem a entrada: são espécies distintas no catálogo e o
 * jogador pode ter qualquer uma das duas.
 */
export const TIPO_DA_PEDRA_POR_ESPECIE = {
  16: 'FLYING',    // Pidgey     → Pidgeotto
  17: 'FLYING',    // Pidgeotto  → Pidgeot
  21: 'FLYING',    // Spearow    → Fearow
  163: 'FLYING',   // Hoothoot   → Noctowl
  276: 'FLYING',   // Taillow    → Swellow
  13276: 'FLYING',
  333: 'FLYING',   // Swablu     → Altaria
  13333: 'FLYING',
  396: 'FLYING',   // Starly     → Staravia
  397: 'FLYING',   // Staravia   → Staraptor
  627: 'FLYING',   // Rufflet    → Braviary
  661: 'FLYING',   // Fletchling → Fletchinder
  731: 'FLYING',   // Pikipek    → Trumbeak
  732: 'FLYING',   // Trumbeak   → Toucannon
};

/**
 * O TIPO que decide a pedra de uma evolução — o ponto único onde isso se resolve.
 *
 * Três regras, nesta ordem:
 *
 *   1. `TIPO_DA_PEDRA_POR_ESPECIE` — a exceção escrita à mão ganha de tudo. É explícita, e
 *      explícito ganha de derivado.
 *   2. Dentro de uma ramificação, o tipo primário do DESTINO. É o que dá sentido à escolha:
 *      Vaporeon pede Water Stone e Flareon pede Fire Stone, apesar de o Eevee ser NORMAL.
 *   3. Fora disso, o tipo primário da BASE — a regra de sempre, que vale para as ~400 cadeias
 *      restantes e não se mexe.
 *
 * Vale igual para a Shiny Stone (`shinyStoneDeEvolucao`): um Pidgey shiny pede a Flying Shiny
 * Stone, um Eevee shiny pede a do destino escolhido.
 */
export function tipoDaPedraDeEvolucao(base, destino = null) {
  if (!base) return null;
  const forcado = TIPO_DA_PEDRA_POR_ESPECIE[base.pokeId];
  if (forcado) return forcado;
  if (destino?.type1 && EVOLUCOES_RAMIFICADAS[base.pokeId]) return destino.type1;
  return base.type1 ?? null;
}

/**
 * Todos os destinos de uma espécie, na ordem em que a tela mostra.
 *
 * `buscar` é `(pokeId) => especie` — no servidor é o `especies` do `content.mjs`, no cliente é
 * o `estado.especies`. Recebe a função em vez do mapa para os dois lados passarem o que têm.
 *
 * Devolve `[]` para quem não evolui. Destino que não existe no catálogo some da lista (o Espurr
 * aponta para um Meowstic que não está aqui); destino SEM ARTE fica, marcado com
 * `temArte: false` — a tela precisa dele para escrever "sprite ainda não disponível" em vez de
 * esconder uma evolução que o jogador sabe que existe.
 */
export function destinosDeEvolucao(especie, buscar) {
  if (!especie) return [];
  const saida = [];
  const juntar = (pokeId, nivel) => {
    if (!pokeId || saida.some((d) => d.pokeId === pokeId)) return;
    const alvo = buscar(pokeId);
    if (!alvo) return;
    saida.push({ pokeId, nivel: nivel ?? 0, especie: alvo, temArte: temArteJogavel(alvo) });
  };

  const familia = EVOLUCOES_RAMIFICADAS[especie.pokeId];
  if (familia) {
    for (const r of familia) juntar(r.para, r.nivel);
    // O `evolvesToId` do catálogo entra mesmo fora da tabela: se um dia ele mudar e a tabela
    // ficar velha, o jogador perde a escolha nova — não a evolução que já tinha.
    juntar(especie.evolvesToId, especie.evolveLevel);
  } else {
    juntar(especie.evolvesToId, especie.evolveLevel);
  }
  return saida;
}

/**
 * Espécies finais alcançáveis a partir da atual — folhas da árvore com arte jogável.
 * Ramificações (Eevee, Gloom…) devolvem cada final; cadeias lineares devolvem só a última.
 */
export function evolucoesFinais(especie, buscar) {
  if (!especie) return [];
  const finais = new Map();

  const dfs = (esp, ehRaiz) => {
    const proximos = destinosDeEvolucao(esp, buscar).filter((d) => d.temArte);
    if (proximos.length === 0) {
      if (!ehRaiz) finais.set(esp.pokeId, esp);
      return;
    }
    for (const d of proximos) dfs(d.especie, false);
  };

  dfs(especie, true);
  return [...finais.values()];
}

/**
 * Alinha `evolveLevel` da base com o nível do destino PADRÃO da tabela.
 *
 * Sem isto o catálogo fica com duas verdades: a tela de escolha diria "Vaporeon no Nv 1.125" e
 * qualquer código que ainda leia `especie.evolveLevel` diria 80. Rodar nas duas pontas, junto
 * com os outros ajustes de evolução, deixa uma só.
 */
export function alinharNivelPadraoRamificado(lista) {
  let ajustados = 0;
  for (const c of lista) {
    const familia = EVOLUCOES_RAMIFICADAS[c.pokeId];
    if (!familia?.length) continue;
    const padrao = familia.find((r) => r.para === c.evolvesToId) ?? familia[0];
    if (c.evolveLevel === padrao.nivel) continue;
    c.evolveLevel = padrao.nivel;
    ajustados++;
  }
  return ajustados;
}
