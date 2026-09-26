/**
 * TETO DE NÍVEL NA CAPTURA — em que degrau um selvagem entra na equipe.
 *
 * O selvagem continua com a força do degrau da hunt: um Salamence numa hunt de 2.000 luta
 * como nível 2.000, dá o XP e o ouro de nível 2.000 e é tão difícil de capturar quanto era.
 * O que muda é o que sai de dentro da bola. Ele entra na equipe no TETO da espécie, e o teto
 * sai de uma coisa só: quantos elos a cadeia evolutiva dele tem, e em qual deles ele está.
 *
 *   cadeia de 3 (Treecko → Grovyle → Sceptile)   20 · 40 · 100
 *   cadeia de 2 (Makuhita → Hariyama)                 40 · 100
 *   sem evolução (Spinda, variantes de Outland)            100
 *
 * ### Por que isto existe
 *
 * Kanto vai do nível 1 ao 100 e a captura sempre coube dentro dessa faixa. Da Outland (150)
 * para cima a escada de hunts abre para 500, 2.000, 25.000, 160.300 — e, como o capturado
 * nascia no nível do mob, um jogador que chegava em Sinnoh trocava a equipe inteira por
 * bichos de nível 2.000 numa tarde de bolas. Três coisas quebravam juntas:
 *
 *   · **progressão** — não havia o que treinar. O nível vinha pronto dentro da bola, e o
 *     único jeito de ficar mais forte era capturar de novo, mais acima;
 *   · **Mercado** — `precoVendaPokemon` escala com `nível / 50`, então um nível 2.000 valia
 *     41x a base contra 3x de um nível 100. O preço de tudo subia atrás disso;
 *   · **Ranking de Pokémon Forte** — virava uma lista de quem tinha aberto a hunt mais alta,
 *     não de quem tinha criado o melhor bicho.
 *
 * ### A cerca: o teto só morde acima de 100
 *
 * `nivelDeCaptura` devolve o nível do mob intacto enquanto ele for menor ou igual a
 * `TETO_CAPTURA_MAX`. É o que mantém Kanto exatamente como estava — lá um Rhyhorn de hunt 30
 * continua vindo nível 30, e não caindo para o 20 da escada. A escada só entra onde o
 * problema está: acima de 100.
 *
 * ### E o nível de EVOLUÇÃO anda junto
 *
 * Sem isso o sistema não fecha. O `evolveLevel` de Hoenn+ é colado no `huntLevel` do próximo
 * estágio (Zigzagoon pedia 650 para virar Linoone, Nosepass pedia 2.000 para virar Probopass):
 * um capturado no teto de 40 ficaria seiscentos níveis longe de evoluir, o que é pior do que
 * o problema que estamos consertando. `aplicarTetoDeCaptura` reescreve esses degraus para o
 * teto do DESTINO — a mesma escada, uma história só. Ver `EVOLUCOES_RAMIFICADAS`, que também
 * é reescrita porque as cadeias que abrem em vários destinos guardam o nível delas lá dentro.
 */

import { destinosDeEvolucao, EVOLUCOES_RAMIFICADAS } from './evolucoes-ramificadas.mjs';
import { dexDe } from './escala-hunt-level.mjs';
import { isOutlandPokeId } from './outland.mjs';

/**
 * O teto absoluto — e, ao mesmo tempo, o degrau a partir do qual a escada passa a valer.
 *
 * Os dois papéis são o MESMO número de propósito: 100 é onde Kanto termina, é o teto da
 * última evolução e é a fronteira abaixo da qual nada muda. Separar em duas constantes só
 * criaria a chance de elas divergirem.
 */
export const TETO_CAPTURA_MAX = 100;

/**
 * A escada, por comprimento de cadeia. O índice é o ESTÁGIO (0 = base).
 *
 * A de 3 é a que o jogo já ensina com os iniciais de Kanto. A de 2 reaproveita o degrau do
 * meio (40) em vez de inventar um próprio: quem é o penúltimo de uma cadeia custa o mesmo,
 * tenha ela dois elos ou três. A de 4 não tem ninguém hoje — nenhuma cadeia do catálogo passa
 * de 3 elos — e existe para uma geração nova não cair num `undefined`.
 */
export const ESCADA_TETO_CAPTURA = {
  1: [100],
  2: [40, 100],
  3: [20, 40, 100],
  4: [20, 40, 70, 100],
};

/** Quantas passagens de relaxação antes de desistir de crescer a cadeia. */
const PASSAGENS_MAX = 8;

/** A escada de uma cadeia com `elos` estágios — cadeia mais longa que a tabela usa a maior. */
export function escadaDeElos(elos) {
  const n = Math.min(Math.max(Math.floor(Number(elos) || 1), 1), 4);
  return ESCADA_TETO_CAPTURA[n] ?? ESCADA_TETO_CAPTURA[4];
}

/**
 * Mapa `pokeId → { estagio, elos }` para o catálogo inteiro.
 *
 * `estagio` é a maior distância ATRÁS (quantas evoluções levam até ele) e `elos` é o
 * comprimento total da cadeia — atrás + à frente + ele mesmo. Nas famílias que abrem, as duas
 * medidas são as MAIORES: o Eevee tem oito destinos e todos a um passo, então a família
 * inteira é uma cadeia de 2 e cada eeveelution é estágio 1.
 *
 * A conta é uma relaxação de no máximo `PASSAGENS_MAX` passagens, e não uma recursão. O
 * catálogo tem clones (`13xxx` de Hoenn) apontando para a linha nacional e elos costurados em
 * `evolucoes-cruzadas.mjs`; um ciclo acidental numa dessas tabelas travaria uma DFS ingênua,
 * enquanto aqui ele só para de render altura depois de algumas passagens.
 */
export function montarEstagiosEvolutivos(lista, buscar) {
  const especies = [...lista];
  const saidaDe = new Map();
  const entradaDe = new Map();

  for (const c of especies) {
    if (!c?.pokeId) continue;
    const destinos = new Set();
    for (const d of destinosDeEvolucao(c, buscar)) {
      if (!d.pokeId || d.pokeId === c.pokeId) continue;
      destinos.add(d.pokeId);
      if (!entradaDe.has(d.pokeId)) entradaDe.set(d.pokeId, new Set());
      entradaDe.get(d.pokeId).add(c.pokeId);
    }
    saidaDe.set(c.pokeId, destinos);
  }

  /** Maior caminho seguindo `arestas`, por relaxação limitada. */
  const alturas = (arestas) => {
    const h = new Map();
    for (const id of saidaDe.keys()) h.set(id, 0);
    for (let passagem = 0; passagem < PASSAGENS_MAX; passagem++) {
      let mudou = false;
      for (const [id, vizinhos] of arestas) {
        const base = h.get(id) ?? 0;
        for (const v of vizinhos) {
          if (base + 1 > (h.get(v) ?? 0)) {
            h.set(v, base + 1);
            mudou = true;
          }
        }
      }
      if (!mudou) break;
    }
    return h;
  };

  const atras = alturas(saidaDe); // quantas evoluções levam ATÉ ele
  const frente = alturas(entradaDe); // quantas ele ainda tem PELA FRENTE

  const out = new Map();
  for (const id of saidaDe.keys()) {
    const e = atras.get(id) ?? 0;
    const f = frente.get(id) ?? 0;
    out.set(id, { estagio: e, elos: e + f + 1 });
  }
  return out;
}

/** O teto de uma espécie, dado o mapa de `montarEstagiosEvolutivos`. */
export function tetoDeCaptura(pokeId, estagios) {
  const info = estagios?.get?.(pokeId);
  if (!info) return TETO_CAPTURA_MAX;
  const escada = escadaDeElos(info.elos);
  return escada[Math.min(info.estagio, escada.length - 1)];
}

/**
 * O nível com que o capturado nasce.
 *
 * Abaixo da cerca o mob passa inteiro — é o que deixa Kanto intocada. Acima dela o teto manda,
 * e o `Math.min` continua ali porque um teto NUNCA deve promover ninguém: um mob nível 120 de
 * uma cadeia sem evolução (teto 100) vem 100, e não sobe para lugar nenhum.
 */
export function nivelDeCaptura(nivelSelvagem, teto) {
  const n = Math.max(1, Math.floor(Number(nivelSelvagem) || 1));
  if (n <= TETO_CAPTURA_MAX) return n;
  const t = Math.max(1, Math.floor(Number(teto) || TETO_CAPTURA_MAX));
  return Math.min(n, t);
}

/**
 * A espécie é de Outland para cima?
 *
 * Pelo DEX, não pelo `huntLevel`: é a régua que o pedido usa ("Outland, Hoenn, Sinnoh, Unova,
 * Kalos e Alola") e a única que não se move quando alguém retuna uma hunt. Os clones `13xxx`
 * de Hoenn caem aqui pelo `dexDe`, e as variantes de Outland (10501+) entram pelo nome —
 * elas não evoluem, então só aparecem do lado do teto, nunca do lado do degrau de evolução.
 */
export function ehOutlandOuAcima(pokeId) {
  if (isOutlandPokeId(pokeId)) return true;
  const dex = dexDe(pokeId);
  return Number.isFinite(dex) && dex >= 252;
}

/**
 * Um elo precisa descer para a escada?
 *
 * Duas portas, e a segunda não é redundante. A primeira é o recorte do pedido: destino de
 * Hoenn+ passa a pedir o teto dele. A segunda pega os elos que MORAM em Kanto/Johto mas foram
 * empurrados para cima porque o destino vive numa hunt alta — as eeveelutions (Jolteon pedia
 * 1.000, Sylveon 12.750) e o Slowking (1.000). Deixá-los de fora criaria o absurdo de o jogo
 * ENTREGAR um Jolteon nível 100 na bola e ainda cobrar 1.000 de quem quisesse evoluir o Eevee.
 */
function precisaDescer(destinoId, nivelAtual) {
  return ehOutlandOuAcima(destinoId) || (Number(nivelAtual) || 0) > TETO_CAPTURA_MAX;
}

/**
 * Grava `tetoCaptura` em cada espécie e alinha os níveis de evolução à mesma escada.
 *
 * Roda nas DUAS pontas — no boot do servidor (`content.mjs`) e no do cliente
 * (`carregarCatalogoEspecies`) — e precisa rodar DEPOIS de tudo que escreve `evolveLevel`
 * (`aplicarEscalaHuntLevel`, `aplicarEvolucoesEntreGeracoes`, `alinharNivelPadraoRamificado`,
 * `corrigirNiveisDeEvolucao`), senão um desses reescreve por cima e as duas pontas passam a
 * contar histórias diferentes sobre o mesmo bicho.
 *
 * `EVOLUCOES_RAMIFICADAS` é reescrita NO LUGAR, e é de propósito: `destinosDeEvolucao` lê a
 * tabela direto, e é ele quem alimenta tanto o modal de evolução quanto a trava do servidor
 * em `pokemon.evoluir`. A operação é idempotente — rodar duas vezes dá o mesmo resultado.
 */
export function aplicarTetoDeCaptura(lista, buscar) {
  const especies = [...lista];
  const estagios = montarEstagiosEvolutivos(especies, buscar);

  for (const c of especies) {
    if (!c?.pokeId) continue;
    c.tetoCaptura = tetoDeCaptura(c.pokeId, estagios);
  }

  let elosAjustados = 0;
  let ramosAjustados = 0;

  for (const c of especies) {
    if (!c?.pokeId || !c.evolvesToId || c.evolvesToId <= 0) continue;
    if (!precisaDescer(c.evolvesToId, c.evolveLevel)) continue;
    const novo = tetoDeCaptura(c.evolvesToId, estagios);
    if (c.evolveLevel === novo) continue;
    c.evolveLevel = novo;
    elosAjustados++;
  }

  for (const familia of Object.values(EVOLUCOES_RAMIFICADAS)) {
    for (const r of familia) {
      // `fixo`: o nível foi escolhido à mão para a família inteira (as eeveelutions, no 80) e
      // já está abaixo do teto. Reescrever para o teto do destino subiria os de Sinnoh e Kalos.
      if (r.fixo) continue;
      if (!precisaDescer(r.para, r.nivel)) continue;
      const novo = tetoDeCaptura(r.para, estagios);
      if (r.nivel === novo) continue;
      r.nivel = novo;
      ramosAjustados++;
    }
  }

  return { estagios, elosAjustados, ramosAjustados };
}
