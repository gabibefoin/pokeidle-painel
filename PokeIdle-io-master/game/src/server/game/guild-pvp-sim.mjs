// A GUERRA DE GUILDS, simulada de cabo a rabo no servidor — sem ninguém conectado.
//
// ### Por que deixou de ser ao vivo
//
// A versão anterior era uma arena compartilhada às 22h UTC: quem estivesse online naquele
// minuto entrava, o resto ficava de fora. Com 400 pessoas espalhadas pelo dia e o evento
// durando um minuto, o resultado real era "ganha a guild que tinha alguém acordado" — e uma
// vitória automática porque só uma guild tinha gente na arena não é um evento de guild, é um
// sorteio de fuso horário. Pior: com `SHARD_COUNT > 1` cada processo simulava metade da
// arena sem ver a outra, então nem estar online garantia participar da MESMA batalha.
//
// Aqui a guerra roda uma vez, sozinha, a partir do que está GRAVADO no banco: toda a guild
// registrada entra inteira, membro online ou não. O que os jogadores veem depois é o REPLAY —
// e é por isso que este arquivo grava enquanto simula.
//
// ### O que é gravado
//
// Nada de imagem: o replay é a MESMA conversa que o campo ao vivo tem com o cliente (quem
// deu um passo para onde, quem perdeu HP, quem saiu do mapa), só que com o relógio começando
// em zero e escrita compacta. O player do cliente reidrata isso em pacotes de campo e deixa
// o renderizador de sempre desenhar — sem código de desenho novo e sem WebSocket.
//
// O formato está descrito em `gravarQuadro`, e o custo dele em `quadrosDoLimite`.
//
// ### O que este arquivo NÃO faz
//
// Não fala com o banco, não distribui GP, não avisa ninguém. Recebe as guilds já montadas e
// devolve o resultado com o replay em memória — quem orquestra é `guild-pvp.mjs`. Assim dá
// para rodar a guerra inteira num teste, sem Postgres e sem Redis.
import {
  gradeDaHunt,
  andavel,
  passoRumoA,
  darPasso,
  parado,
  chebyshev,
  MS_PASSO_HEROI,
  MS_PASSO_TREINADOR,
  LOOKTYPE_TREINADOR,
  DIST_COMBATE,
} from './campo.mjs';
import { especies, looktypeShiny } from '../content.mjs';
import { SLUG_ARENA_GINASIO } from '../../shared/ginasios.mjs';
import { calcularDano, melhorGolpeJogador, cooldownComSpeed, ivSpeedDe } from './combate.mjs';

/** Versão do formato do replay. O cliente recusa o que não souber ler. */
export const VERSAO_REPLAY = 1;

/** A arena padrão da Guerra de Guilds (100×63, 3.409 tiles). */
export const SLUG_ARENA = 'brave_charizard';

/** Passo do relógio da simulação. O mesmo tick do jogo — a briga sai com a cadência de sempre. */
export const PASSO_MS = 250;

/** Intervalo mínimo entre dois golpes do mesmo lutador (igual ao da arena PvP). */
const CD_GOLPE_MS = 900;

/**
 * Teto de tempo simulado de um DUELO (ginásio, PvP ranqueado e, por ele, o campeonato). Passou
 * disto, decide no critério de desempate.
 *
 * Num duelo de dois times, cinco minutos é muito mais do que a briga precisa; o teto existe para
 * o caso patológico: dois times imunes um ao tipo do outro se batendo por 1 de dano.
 */
export const LIMITE_MS_DUELO = 5 * 60_000;

/**
 * Teto de tempo simulado da GUERRA DE GUILDS — dez minutos desde 16/09/2026.
 *
 * Com cinco, a guerra deixou de acabar: de 11/09 em diante, com 48 a 67 guilds e 208 a 280
 * lutadores, TODA guerra bateu o teto com gente de pé e foi decidida no desempate por fração de
 * HP. O desempate é honesto como ordenação, mas não é uma vitória — e o replay terminava no meio
 * da briga. O custo de dobrar o teto está medido em `tools/bancada-guerra.mjs`.
 */
export const LIMITE_MS_GUERRA = 10 * 60_000;

/**
 * Teto de quadros gravados, a partir do teto de tempo da luta (`limiteMs / PASSO_MS`). É o que
 * segura o tamanho do replay no banco e na rede.
 *
 * Cada quadro é uma linha de números (ver `gravarQuadro`), e o peso cresce com o número de
 * lutadores: a guerra de 16/09/2026 (67 guilds, 280 lutadores, 5 minutos) gravou 1.135 quadros
 * em ~900 KB de JSON (~450 KB no jsonb). A simulação continua até o fim mesmo se o gravador
 * parar: o RESULTADO nunca depende de caber no arquivo.
 */
const quadrosDoLimite = (limiteMs) => Math.ceil(limiteMs / PASSO_MS);

/**
 * Teto de lutadores para GRAVAR os golpes (a lista `a`).
 *
 * É cinto de segurança, não afinação: do tamanho do jogo hoje ele nunca dispara. A conta que
 * define o número é o peso da fita — a lista de golpes é ~45% dela. Medido em 16/09/2026
 * (`tools/bancada-guerra.mjs`): 278 lutadores dão ~750 KB de JSON (~210 KB em gzip), com o teto
 * de 5 ou de 10 minutos — os minutos finais têm pouca gente de pé e quase não pesam. Muito acima
 * disso a guerra já está quebrada por outros motivos (bate o teto de tempo e é decidida no
 * desempate por HP), e o que se quer é só a garantia de que a lista de golpes nunca seja a
 * coisa que estoura a linha do banco.
 *
 * O que acontece quando dispara: a guerra roda igual e o replay toca igual, só sem as
 * animações de golpe — o `a` some dos quadros e o player não tem o que desenhar. Fica
 * marcado em `golpesCortados` no cabeçalho para não virar mistério depois.
 *
 * A verdadeira resposta para uma guerra desse tamanho não é esta trava, é quebrar o evento
 * em chaves de N guilds — cada uma com sua arena e seu replay.
 */
const LIMITE_LUTADORES_GOLPES = 1200;

/** Quantos ticks a simulação roda antes de devolver o event loop ao tick do jogo. */
const TICKS_POR_FOLEGO = 40;

/**
 * Quanto tempo o derrotado fica CAÍDO no chão antes de sumir do replay.
 *
 * O renderizador já sabe desenhar corpo (tombado de lado, sem cor, sumindo aos poucos) — é o
 * mesmo desenho da hunt. Sem esta janela, um wipe é gente evaporando, e não dá para ver o que
 * aconteceu; com ela, cada abate deixa a marca no chão pelo tempo de olhar para o lado.
 */
const CORPO_MS = 2800;

/**
 * Meia-largura da ARENA, em tiles a partir do ponto de entrada.
 *
 * A grade de `brave_charizard` tem 100×63 e 3.409 tiles andáveis espalhadas por relevo,
 * caverna e beira de lava. A guerra usa só o miolo dela, e por dois motivos:
 *
 *   · **desenho** — fora dessa região o mapa tem estrutura no andar de cima, e a regra de
 *     andares do cliente (herdada do original: só apaga o teto que está na diagonal) deixa a
 *     rocha desenhada por cima dos lutadores. No replay isso vira briga atrás de uma parede.
 *   · **leitura** — sem coleira, os dois últimos sobreviventes se perseguem por quarenta
 *     tiles, e a fita termina com meio minuto de caminhada.
 *
 * O recorte é uma GRADE nova: o resto do arquivo não sabe que existe borda, porque para ele
 * aquelas tiles simplesmente não são andáveis. É também o TETO do nascimento: as âncoras das
 * guilds (`ancorasDeGuild`) nunca saem daqui, então a arena inteira que já é segura pro
 * replay vira o espaço de sobra pra espalhar — não só um anel de 15 tiles como antes.
 */
const RAIO_ARENA = 22;

/**
 * A arena dos DUELOS um-contra-um — o desafio de ginásio e a partida ranqueada.
 *
 * É o recorte desenhado no nomeador (`/ginasios.html`): pequeno, com os dois pontos de
 * nascimento marcados (`gin-a`/`gin-b`) e a grade inteira aproveitada, para que os dois lados
 * se encontrem no meio em segundos em vez de atravessar meio mapa. Sem esse recorte no
 * espelho de assets, cai na arena grande da Guerra de Guilds — que funciona, só rende uma
 * fita mais longa.
 *
 * Mora aqui, e não em cada chamador, porque a decisão "qual mapa e com ou sem recorte" é uma
 * só: dois lugares escolhendo por conta própria é como um deles fica para trás no dia em que
 * o mapa mudar.
 */
export function arenaDeDuelo() {
  const g = gradeDaHunt(SLUG_ARENA_GINASIO);
  if (g?.grid?.length) return { slug: SLUG_ARENA_GINASIO, gradeInteira: true };
  return { slug: SLUG_ARENA, gradeInteira: false };
}

/** Usa a grade inteira do recorte — arenas pequenas desenhadas no nomeador (ginásio). */
function prepararGradeInteira(g) {
  const grid = new Uint8Array(g.grid.length);
  for (let i = 0; i < g.grid.length; i++) grid[i] = g.grid[i];
  return { ...g, grid, _veioDe: undefined, _geracao: undefined, _fila: undefined, _contador: 0 };
}

/** Spawns fixos do duelo de ginásio — tags `gin-a` (desafiante) e `gin-b` (líder). */
function spawnsDueloDaGrade(g) {
  let a = null;
  let b = null;
  for (const p of g.pontos ?? []) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const cx = Number(p[0]);
    const cy = Number(p[1]);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    const tag = p[3];
    if (tag === 'gin-a') a = { cx, cy };
    if (tag === 'gin-b') b = { cx, cy };
  }
  return a && b ? [a, b] : null;
}

/** A grade da hunt recortada num quadrado em volta do ponto de entrada. */
function recortarArena(g) {
  const [ix, iy] = g.inicio ?? [Math.floor(g.cols / 2), Math.floor(g.rows / 2)];
  const grid = new Uint8Array(g.grid.length);
  for (let y = Math.max(0, iy - RAIO_ARENA); y <= Math.min(g.rows - 1, iy + RAIO_ARENA); y++) {
    for (let x = Math.max(0, ix - RAIO_ARENA); x <= Math.min(g.cols - 1, ix + RAIO_ARENA); x++) {
      grid[y * g.cols + x] = g.grid[y * g.cols + x];
    }
  }
  // Os rascunhos de busca de caminho ficam PENDURADOS na grade (ver `passoRumoA`). Herdar os
  // do original faria a guerra e as hunts de todo mundo escreverem no mesmo buffer.
  return { ...g, grid, _veioDe: undefined, _geracao: undefined, _fila: undefined, _contador: 0 };
}

const soma = (lista) => lista.reduce((s, v) => s + v, 0);

/** Fisher-Yates — embaralha uma cópia da lista, não mexe na original. */
function embaralhada(lista) {
  const r = [...lista];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// ------------------------------------------------------------------ nascimento

/** As 4 direções ortogonais — mesma vizinhança que `passoRumoA` usa pra andar. */
const VIZINHOS_4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Todo tile ANDÁVEL E ALCANÇÁVEL a pé a partir do ponto de entrada, dentro da arena recortada
 * — os candidatos a âncora de guild.
 *
 * ### O bug que isto corrige (relatado e reproduzido)
 *
 * `recortarArena` corta um QUADRADO em volta do ponto de entrada, e o corte é cego: ele não
 * sabe se aquele quadrado deixa o chão andável inteiro CONECTADO. Em `brave_charizard` não
 * deixa — o recorte isola um bolsão de 16 tiles do resto (1.254 tiles) sem nenhum caminho
 * entre os dois dentro da caixa; o caminho que os ligaria passa por FORA do raio da arena,
 * que `recortarArena` zera.
 *
 * Antes esta função devolvia TODO tile andável do recorte, ilha incluída. Com o espalhamento
 * por ponto mais distante (`ancorasDeGuild`), cair uma guild nessa ilha era só questão de
 * tempo — e quando os dois últimos sobreviventes ficam em componentes diferentes, `passoRumoA`
 * nunca acha caminho entre eles (`null` pra sempre): ninguém anda, ninguém luta, a guerra
 * inteira vira os 5 minutos do teto de tempo sem um golpe trocado entre as duas guildas.
 *
 * A correção é andar a pé a partir do `inicio` (busca em largura, 4 direções — a mesma
 * vizinhança de `passoRumoA`) em vez de varrer a caixa: só o que dá pra ALCANÇAR virando
 * candidato garante que qualquer par de âncoras tem um caminho de verdade entre elas.
 */
function tilesAndaveisDaArena(g) {
  const [cx, cy] = g.inicio ?? [Math.floor(g.cols / 2), Math.floor(g.rows / 2)];
  if (!andavel(g, cx, cy)) return [];
  const visitados = new Set([cy * g.cols + cx]);
  const tiles = [{ cx, cy }];
  for (let i = 0; i < tiles.length; i++) {
    const atual = tiles[i];
    for (const [dx, dy] of VIZINHOS_4) {
      const nx = atual.cx + dx;
      const ny = atual.cy + dy;
      if (!andavel(g, nx, ny)) continue;
      const idx = ny * g.cols + nx;
      if (visitados.has(idx)) continue;
      visitados.add(idx);
      tiles.push({ cx: nx, cy: ny });
    }
  }
  return tiles;
}

/**
 * Distância A PÉ de `origem` até cada tile, indexada por `cy * cols + cx` (`-1` = inalcançável).
 *
 * Busca em largura pelo chão andável, 4 direções — a mesma vizinhança de `passoRumoA`. É esta, e
 * não a distância em linha reta, que decide quem se encontra primeiro: duas guilds a 10 tiles uma
 * da outra com um rio de lava no meio não são vizinhas.
 */
function distanciasAPe(g, origem) {
  const total = g.cols * g.rows;
  const dist = new Int32Array(total).fill(-1);
  if (!andavel(g, origem.cx, origem.cy)) return dist;
  const fila = new Int32Array(total);
  let ini = 0;
  let fim = 0;
  const i0 = origem.cy * g.cols + origem.cx;
  dist[i0] = 0;
  fila[fim++] = i0;
  while (ini < fim) {
    const i = fila[ini++];
    const cx = i % g.cols;
    const cy = (i - cx) / g.cols;
    for (const [dx, dy] of VIZINHOS_4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!andavel(g, nx, ny)) continue;
      const j = ny * g.cols + nx;
      if (dist[j] !== -1) continue;
      dist[j] = dist[i] + 1;
      fila[fim++] = j;
    }
  }
  return dist;
}

/**
 * As quatro PONTAS da arena, pelas diagonais — é numa delas que nasce a 1ª cabeça de chave.
 *
 * Qual das quatro é sorteado a cada guerra, e de propósito: o chão da arena não é simétrico (lava
 * de um lado, rocha do outro), e uma ponta fixa daria ao 1º do ranking o mesmo terreno todo dia.
 * O que importa para a justiça — a 2ª nascer o mais longe possível dela — não depende da ponta.
 */
const PONTAS = [
  (c) => -(c.cx + c.cy), // cima-esquerda
  (c) => c.cy - c.cx, // baixo-esquerda
  (c) => c.cx + c.cy, // baixo-direita
  (c) => c.cx - c.cy, // cima-direita
];

function pontaDaArena(candidatos, aleatorio = Math.random) {
  const chave = PONTAS[Math.floor(aleatorio() * PONTAS.length) % PONTAS.length];
  let melhor = candidatos[0];
  for (const c of candidatos) if (chave(c) > chave(melhor)) melhor = c;
  return melhor;
}

/**
 * Uma âncora por guild, espalhadas pelo CHÃO ANDÁVEL de verdade da arena — não por um anel
 * geométrico de raio fixo, que ignora onde tem rocha ou lava no caminho.
 *
 * A versão anterior sorteava um ângulo num anel de 15 tiles e deixava `encaixar` achar o chão
 * andável mais próximo daquele ponto. Isso tinha dois problemas: o anel usava só uma fatia da
 * arena (15 dos 22 tiles de raio que `RAIO_ARENA` já garante seguros pro desenho — 7 tiles de
 * sobra nunca aproveitados) e, pior, em mapas com relevo irregular (a arena tem lava e rocha
 * espalhadas), vários pontos do anel caem perto do MESMO bolsão de chão livre — e várias
 * guilds "espalhadas" no papel nascem coladas na prática, que era exatamente a reclamação.
 *
 * A troca é **amostragem por ponto mais distante** (farthest-point sampling): a primeira âncora
 * nasce numa PONTA da arena (`pontaDaArena`); cada âncora seguinte é o tile andável que maximiza
 * a distância A PÉ até a âncora MAIS PRÓXIMA já escolhida. É o mesmo princípio por trás de
 * "espalhar postes de luz numa praça" — cada novo poste vai no ponto mais vazio que sobrou.
 * Com isso as guilds usam a arena inteira que já é segura pro replay, e a distância entre elas
 * cai graciosamente conforme `n` cresce, em vez de depender de um anel que não conhece o mapa.
 *
 * A ORDEM das âncoras é a hierarquia do espalhamento: a 2ª é a mais longe da 1ª, a 3ª e a 4ª as
 * mais longe das duas, e daí para baixo cada uma entra num vão cada vez menor. É essa ordem que
 * o chaveamento (`nascimentoPorChave`) usa para pôr as guilds mais fortes nas primeiras.
 */
function ancorasDeGuild(g, n, aleatorio = Math.random) {
  const [cx, cy] = g.inicio ?? [Math.floor(g.cols / 2), Math.floor(g.rows / 2)];
  const candidatos = tilesAndaveisDaArena(g);
  if (!candidatos.length) return Array.from({ length: n }, () => ({ cx, cy }));

  const idx = (c) => c.cy * g.cols + c.cx;
  const ancoras = [pontaDaArena(candidatos, aleatorio)];
  // A distância a pé de cada tile até a âncora mais próxima, atualizada a cada âncora nova: são
  // `n` buscas em largura pelo chão da arena (~1.250 tiles), e não `n²` comparações por tile.
  const maisPerto = distanciasAPe(g, ancoras[0]);
  while (ancoras.length < n && ancoras.length < candidatos.length) {
    let melhor = null;
    let melhorDist = 0;
    for (const c of candidatos) {
      const d = maisPerto[idx(c)];
      if (d > melhorDist) {
        melhorDist = d;
        melhor = c;
      }
    }
    if (!melhor) break;
    ancoras.push(melhor);
    const daNova = distanciasAPe(g, melhor);
    for (const c of candidatos) {
      const i = idx(c);
      if (daNova[i] >= 0 && daNova[i] < maisPerto[i]) maisPerto[i] = daNova[i];
    }
  }
  // Mais guilds do que tiles andáveis na arena (nunca aconteceu, mas não é motivo pra travar a
  // guerra): repete posições em vez de faltar âncora — `vagaPerto` ainda acha lugar pros
  // membros ao redor, só fica mais apertado.
  while (ancoras.length < n) ancoras.push(candidatos[ancoras.length % candidatos.length]);
  return ancoras;
}

// ------------------------------------------------------------------ o chaveamento
//
// QUEM NASCE ONDE. Até aqui a lista era embaralhada e as âncoras saíam de um ponto sorteado:
// justo no sentido de "ninguém escolhe", injusto no sentido que importa — o 1º e o 2º do ranking
// podiam nascer colados e se destruir no primeiro minuto, e a guerra virava loteria.
//
// A régua agora é a dos chaveamentos de campeonato, levada para o mapa:
//
//   · as CABEÇAS DE CHAVE (as `CABECAS_DE_CHAVE` guilds mais fortes) ficam com as primeiras
//     âncoras do espalhamento: a 1ª numa ponta, a 2ª no ponto mais distante dela a pé, a 3ª e a
//     4ª nos mais distantes das duas — o "1 e 2 em metades opostas da chave, 3 e 4 nos quartos
//     que sobram" do tênis;
//   · toda âncora restante pertence à REGIÃO da cabeça de chave mais próxima a pé;
//   · as outras guilds entram nas regiões em SERPENTINA, da mais forte para a mais fraca,
//     começando pela região da última cabeça: é o 1-8-9-16 / 2-7-10-15 / 3-6-11-14 / 4-5-12-13
//     de uma chave de 16 — toda região soma a mesma força;
//   · dentro da região, a guild mais FRACA nasce mais perto da cabeça de chave e a mais forte na
//     divisa: o primeiro encontro de uma favorita é com quem tem menos chance, e as fortes de
//     regiões vizinhas se enfrentam na fronteira, como nas quartas de uma chave.
//
// O resultado é o que um campeonato promete: as favoritas só se cruzam no fim.

/** Quantas guilds mais fortes viram cabeças de chave — uma por ponta da arena. */
const CABECAS_DE_CHAVE = 4;

/** A força bruta da equipe de guerra: a soma dos stats de todo pokémon que a guild leva. Só desempata. */
function forcaDaGuild(guild) {
  let total = 0;
  for (const m of guild.membros ?? []) {
    for (const pk of m.equipe ?? []) {
      for (const v of Object.values(pk.stats ?? {})) total += Number(v) || 0;
    }
  }
  return total;
}

/**
 * A ORDEM DE FORÇA — a cabeça de chave 1 é a primeira da lista.
 *
 *   1. **GP Global** (a temporada do mês): mede a guild ao longo de semanas, não um dia de sorte;
 *   2. **GP de ontem** (o ranking Diário, lido ANTES de a guerra zerá-lo): decide no começo do mês,
 *      quando a temporada ainda está zerada para todo mundo;
 *   3. **a força bruta das equipes** (`forcaDaGuild`): decide entre guilds que ainda não pontuaram;
 *   4. **sorteio**: empate em tudo não pode dar a vantagem sempre à mesma guild pelo id — por isso
 *      a lista é embaralhada antes da ordenação, que é estável.
 */
export function ordenarPorSemente(guilds) {
  const forca = new Map(guilds.map((gu) => [gu, forcaDaGuild(gu)]));
  return embaralhada(guilds).sort((a, b) =>
    (Number(b.gpGlobal) || 0) - (Number(a.gpGlobal) || 0)
    || (Number(b.gp) || 0) - (Number(a.gp) || 0)
    || forca.get(b) - forca.get(a));
}

/**
 * Em que região entra cada guild que NÃO é cabeça de chave — a serpentina de uma chave de
 * campeonato. `capacidades[r]` é quantas vagas a região `r` tem; devolve, para as `n` guilds
 * seguintes (da mais forte à mais fraca), o índice da região de cada uma.
 *
 * A primeira volta vai da última cabeça para a primeira, a segunda da primeira para a última, e
 * assim alternando. Numa chave de 16 com quatro regiões de 3 vagas isso dá exatamente {1,8,9,16}
 * {2,7,10,15} {3,6,11,14} {4,5,12,13}: toda região soma 34. Região cheia é pulada — as regiões do
 * mapa não têm o mesmo tamanho, e ninguém pode ficar sem lugar.
 */
function serpentinaDasChaves(capacidades, n) {
  const livre = [...capacidades];
  const regioes = livre.length;
  const out = [];
  for (let volta = 0; out.length < n && livre.some((v) => v > 0); volta++) {
    for (let k = 0; k < regioes && out.length < n; k++) {
      const r = volta % 2 === 0 ? regioes - 1 - k : k;
      if (livre[r] <= 0) continue;
      livre[r]--;
      out.push(r);
    }
  }
  return out;
}

/**
 * As âncoras na ORDEM DAS SEMENTES: a posição `i` é onde nasce a guild `i` da lista ordenada por
 * força (`ordenarPorSemente`). Ver o topo desta seção.
 */
function nascimentoPorChave(g, n, aleatorio = Math.random) {
  const livres = ancorasDeGuild(g, n, aleatorio);
  const cabecas = Math.min(CABECAS_DE_CHAVE, livres.length);
  if (livres.length <= cabecas) return livres;

  const idx = (c) => c.cy * g.cols + c.cx;
  const distDaCabeca = livres.slice(0, cabecas).map((a) => distanciasAPe(g, a));
  // Cada âncora restante vai para a região da cabeça de chave mais próxima a pé.
  const regioes = Array.from({ length: cabecas }, () => []);
  for (let i = cabecas; i < livres.length; i++) {
    let melhor = 0;
    let melhorDist = Infinity;
    for (let h = 0; h < cabecas; h++) {
      const d = distDaCabeca[h][idx(livres[i])];
      if (d >= 0 && d < melhorDist) {
        melhorDist = d;
        melhor = h;
      }
    }
    regioes[melhor].push({ ancora: livres[i], dist: melhorDist });
  }
  for (const r of regioes) r.sort((a, b) => a.dist - b.dist);

  // As guilds seguintes, da mais forte à mais fraca, repartidas em serpentina.
  const regiaoDe = serpentinaDasChaves(regioes.map((r) => r.length), livres.length - cabecas);
  const sementesDaRegiao = Array.from({ length: cabecas }, () => []);
  regiaoDe.forEach((r, k) => sementesDaRegiao[r].push(cabecas + k));

  const saida = livres.slice(0, cabecas);
  for (let r = 0; r < cabecas; r++) {
    // Da mais FRACA (maior índice) para a mais forte, da vaga mais perto da cabeça para a divisa.
    const sementes = [...sementesDaRegiao[r]].sort((a, b) => b - a);
    sementes.forEach((s, k) => {
      saida[s] = regioes[r][k].ancora;
    });
  }
  return saida;
}

/** Tiles livres em volta da âncora da guild, em anéis — um por membro. */
function vagaPerto(g, ancora, ocupadas) {
  for (let r = 0; r <= 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = ancora.cx + dx;
        const cy = ancora.cy + dy;
        if (!andavel(g, cx, cy)) continue;
        const idx = cy * g.cols + cx;
        if (ocupadas.has(idx)) continue;
        ocupadas.add(idx);
        return { cx, cy };
      }
    }
  }
  return { ...ancora };
}

// ---------------------------------------------------------------- os lutadores

/**
 * O pokémon que vai para o campo, a partir da linha do banco já com stats calculados.
 *
 * Todo mundo entra CURADO, e é decisão de desenho: o evento acontece com a guild inteira
 * offline, então usar o HP gravado transformaria "desloguei desmaiado ontem" em peso morto
 * permanente na guerra da guild — uma punição por não estar online, que é justamente o que
 * este formato existe para acabar.
 */
function emCampo(pk) {
  return {
    id: pk.id,
    speciesId: pk.speciesId,
    nome: pk.nome,
    looktype: pk.looktype,
    lookShiny: pk.lookShiny ?? (pk.shiny ? looktypeShiny(pk.speciesId) : null),
    level: pk.level,
    shiny: !!pk.shiny,
    tipos: pk.tipos,
    stats: pk.stats,
    ivSpeed: ivSpeedDe(pk),
    maxHp: pk.maxHp,
    hp: pk.maxHp,
    tmElemental: pk.tmElemental ?? null,
  };
}

/**
 * Monta um lutador: o pokémon em campo, o boneco do treinador atrás dele e a fila de reservas.
 *
 * `slot` é o número que identifica a entidade no replay inteiro — o pokémon e o treinador de
 * cada membro têm um cada, e eles nunca são reciclados.
 */
function montarMembro(m, guildIdx, guildId, pos, slotPk, slotTr) {
  const time = (m.equipe ?? []).map(emCampo).filter((pk) => pk.maxHp > 0);
  if (!time.length) return null;
  const base = (passoMs) => ({
    cx: pos.cx,
    cy: pos.cy,
    deCx: pos.cx,
    deCy: pos.cy,
    dir: 3,
    passoEm: 0,
    passoMs,
    andando: false,
  });
  const ativo = time[0];
  return {
    key: m.playerId,
    nick: m.nick,
    guildId,
    guildIdx,
    time,
    iAtivo: 0,
    abates: 0,
    mortes: 0,
    cdGolpes: {},
    // Uma janela de mira sorteada: sem ela os 35 lutadores atacariam no mesmo milissegundo
    // para sempre, e a guerra virava uma troca de turnos sincronizada.
    proxGolpe: 600 + Math.floor(Math.random() * 900),
    pk: { ...base(MS_PASSO_HEROI), slot: slotPk, ...ativo },
    tr: {
      ...base(MS_PASSO_TREINADOR),
      slot: slotTr,
      ehTreinador: true,
      nome: m.nick,
      looktype: m.looktype ?? LOOKTYPE_TREINADOR,
      visual: m.visual ?? null,
    },
  };
}

// ------------------------------------------------------------------ a gravação

/**
 * O gravador.
 *
 * O formato é enxuto de propósito — ele viaja inteiro para o navegador de quem clicar em
 * "assistir", e um replay de 5 minutos com 70 bonecos em JSON legível passaria de 3 MB.
 *
 *   atores  uma vez só: quem é cada slot (nick ou nome do bicho, sprite, nível, HP máximo,
 *           duração do passo, de que guild é). Nada disso muda quadro a quadro.
 *   inicio  `[slot, coluna, linha, …]` — onde todo mundo nasce.
 *   quadros `{ t, p, h, c, x, e }`, cada chave só aparece quando tem conteúdo:
 *             t  ms desde o começo da guerra
 *             p  passos: `[slot, colunaDestino, linhaDestino, …]`. Quem entra aqui COMEÇOU
 *                o passo neste instante, então o cliente deduz `de` (a posição em que a
 *                entidade estava), a direção e o `passoEm` — três campos que não precisam
 *                trafegar porque são consequência de estar na lista.
 *             h  HP novo: `[slot, hp, …]`
 *             c  troca de pokémon: o pacote inteiro daquele slot (sprite, nome, nível, HP)
 *             m  caiu: fica de corpo no chão por `CORPO_MS` antes de sair
 *             x  slots que saíram do mapa
 *             e  o que vira texto no feed: `{k:'abate', a: algoz, p: pokémon, v: dono, g: guildIdx}`
 *             a  GOLPES: `[slotAtacante, slotAlvo, iGolpe, dano, ef100, stab, …]`, seis
 *                números por pancada. É o que o player entrega ao `golpe()` do campo para
 *                sair a mesma investida, o mesmo tremor, o mesmo número voando e o mesmo
 *                efeito de tipo da hunt.
 *   golpes  a tabela do cabeçalho que o `iGolpe` indexa: `{ n: nome, t: tipo }`.
 *
 * Numa guerra grande demais o `a` não é gravado e o cabeçalho ganha `golpesCortados` com o
 * número de lutadores — ver `LIMITE_LUTADORES_GOLPES`.
 *
 * Por que `a` existe, se o HP já está em `h`: `h` diz que alguém perdeu vida, não QUEM
 * bateu nem COM O QUÊ. Numa guerra de 35 lutadores é justamente isso que se quer ler —
 * quem está batendo em quem, e quem já soltou o TM elemental.
 *
 * O custo, medido: uma guerra de 7 guilds × 5 membros (68 s, 567 golpes) sai de 40,8 KB
 * para 54,3 KB, +33%; uma de 10 × 7 (92 s, 1.448 golpes), de 75,9 KB para 106,5 KB, +40%.
 * A tabela de golpes é o que segura isso — sem ela, repetir "Massive Hurricane" e "WATER"
 * mil vezes pesaria mais do que os números todos juntos.
 */
function novoGravador(g, guilds) {
  return {
    v: VERSAO_REPLAY,
    slug: g.slug,
    mapa: g.mapa,
    box: [g.minTx, g.minTy, g.cols, g.rows],
    groundZ: g.groundZ,
    passoMs: PASSO_MS,
    // Quanto o corpo fica no chão. Vai no cabeçalho para o player não repetir a constante —
    // se o tempo mudar aqui, o replay antigo continua tocando com o tempo dele.
    corpoMs: CORPO_MS,
    guilds: guilds.map((gu) => ({ id: gu.id, nome: gu.nome, brasao: gu.brasao ?? null })),
    // Nome e tipo de cada golpe VISTO na guerra, uma vez só. Cada pancada gravada guarda o
    // índice aqui em vez da string: numa fita com dez mil golpes, repetir "Flamethrower" e
    // "FIRE" a cada um deles pesaria mais do que todo o resto da gravação junto.
    golpes: [],
    atores: [],
    inicio: [],
    quadros: [],
    dur: 0,
    cheio: false,
  };
}

// `e` é a ESPÉCIE (o `pokeId` do catálogo), e existe para a análise da fita poder agregar por
// espécie sem depender do NOME. O nome não serve de chave: ele é traduzido na tela, e duas
// espécies diferentes podem chegar com o mesmo rótulo depois de uma renomeação do catálogo.
// Um inteiro por pokémon que entra em campo — a fita de uma guerra cheia cresce alguns bytes,
// e sem ele o ranking de espécies do Tracker (`pvp-analise.mjs`) não teria como existir.
const atorDoPokemon = (membro) => ({
  s: membro.pk.slot,
  g: membro.guildIdx,
  n: membro.pk.nome,
  e: membro.pk.speciesId ?? 0,
  lt: (membro.pk.shiny && membro.pk.lookShiny) || membro.pk.looktype,
  nv: membro.pk.level,
  sh: membro.pk.shiny ? 1 : 0,
  mhp: membro.pk.maxHp,
  hp: membro.pk.hp,
  ms: MS_PASSO_HEROI,
  dono: membro.nick,
});

const atorDoTreinador = (membro) => ({
  s: membro.tr.slot,
  g: membro.guildIdx,
  n: membro.nick,
  lt: membro.tr.looktype,
  vs: membro.tr.visual,
  tr: 1,
  ms: MS_PASSO_TREINADOR,
});

/** Um quadro em branco. As listas só entram no JSON se alguma coisa cair nelas. */
const quadroVazio = (t) => ({ t, p: [], h: [], c: [], m: [], x: [], e: [], a: [] });

function gravarQuadro(rep, q, limiteQuadros) {
  const listas = ['p', 'h', 'c', 'm', 'x', 'e', 'a'];
  if (listas.every((k) => !q[k].length)) return;
  if (rep.quadros.length >= limiteQuadros) {
    rep.cheio = true;
    return;
  }
  const saida = { t: q.t };
  for (const k of listas) if (q[k].length) saida[k] = q[k];
  rep.quadros.push(saida);
}

// ------------------------------------------------------------------ a batalha

/** Inimigo vivo mais próximo — de qualquer guild que não a minha. */
function inimigoMaisProximo(membros, membro) {
  const meu = membro.pk;
  let melhor = null;
  let melhorD = Infinity;
  for (const outro of membros) {
    if (outro === membro || outro.fora || outro.pk.hp <= 0) continue;
    if (outro.guildId === membro.guildId) continue;
    const d = chebyshev(meu.cx, meu.cy, outro.pk.cx, outro.pk.cy);
    if (d < melhorD) {
      melhorD = d;
      melhor = outro;
    }
  }
  return melhor;
}

const guildsVivas = (membros) => {
  const s = new Set();
  for (const m of membros) if (!m.fora && m.pk.hp > 0) s.add(m.guildId);
  return s;
};

/** HP restante de uma guild, em fração do total com que ela entrou. É o desempate do teto de tempo. */
function saudeDaGuild(membros, guildId) {
  let vivo = 0;
  let total = 0;
  for (const m of membros) {
    if (m.guildId !== guildId) continue;
    for (const pk of m.time) {
      total += pk.maxHp;
      vivo += Math.max(0, pk.hp);
    }
  }
  return total > 0 ? vivo / total : 0;
}

/**
 * A guerra inteira.
 *
 * @param guilds `[{ id, nome, brasao, membros: [{ playerId, nick, looktype, visual, equipe }] }]`
 * @param opcoes `aoRespirar` é chamado a cada TICKS_POR_FOLEGO ticks — é por onde o chamador
 *               devolve o event loop ao tick do jogo em vez de travá-lo por segundos.
 *               `limiteMs` é o teto de tempo simulado: `LIMITE_MS_DUELO` se nada vier, e a
 *               Guerra de Guilds manda `LIMITE_MS_GUERRA`. Preso entre 30 s e 30 min.
 * @returns `{ vencedorId, colocacoes, replay, placar, motivo }`
 */
export async function simularGuerra(guilds, {
  aoRespirar = null,
  arenaSlug = SLUG_ARENA,
  ordemFixa = false,
  gradeInteira = false,
  limiteMs = LIMITE_MS_DUELO,
} = {}) {
  const teto = Math.max(30_000, Math.min(30 * 60_000, Number(limiteMs) || LIMITE_MS_DUELO));
  const limiteQuadros = quadrosDoLimite(teto);
  const bruta = gradeDaHunt(arenaSlug);
  if (!bruta?.grid?.length) throw new Error(`walkgrid ausente (${arenaSlug})`);
  const g = gradeInteira ? prepararGradeInteira(bruta) : recortarArena(bruta);

  // A lista sai na ORDEM DE FORÇA (a cabeça de chave 1 primeiro), e a âncora `i` é a da guild `i`
  // no chaveamento — ver "o chaveamento". `ordemFixa` é para quem já manda a lista na ordem certa
  // (os duelos de ginásio e ranqueado, que nascem nas marcas `gin-a`/`gin-b`).
  const comGente = (ordemFixa ? [...guilds] : ordenarPorSemente(guilds))
    .filter((gu) => (gu.membros ?? []).some((m) => (m.equipe ?? []).length));
  if (comGente.length < 1) throw new Error('nenhuma guild com equipe montada');

  const spawnsDuelo = comGente.length === 2 ? spawnsDueloDaGrade(g) : null;
  const ancoras = spawnsDuelo ?? nascimentoPorChave(g, comGente.length);
  const ocupadas = new Set();
  const membros = [];
  let proxSlot = 1;
  for (let i = 0; i < comGente.length; i++) {
    for (const m of comGente[i].membros ?? []) {
      const pos = vagaPerto(g, ancoras[i], ocupadas);
      const membro = montarMembro(m, i, comGente[i].id, pos, proxSlot, proxSlot + 1);
      if (!membro) continue;
      proxSlot += 2;
      membros.push(membro);
    }
  }
  if (!membros.length) throw new Error('nenhum membro com pokémon na equipe');

  const rep = novoGravador(g, comGente);

  // Guerra grande demais: a fita sai sem as animações de golpe — ver `LIMITE_LUTADORES_GOLPES`.
  const gravarGolpes = membros.length <= LIMITE_LUTADORES_GOLPES;
  if (!gravarGolpes) rep.golpesCortados = membros.length;

  /**
   * O índice de um golpe na tabela do cabeçalho, criando a entrada na primeira vez.
   *
   * O `Map` fica FORA de `rep` porque `rep` é serializado inteiro para o banco e para o
   * navegador: ele é o índice invertido da tabela, não parte da gravação.
   */
  const idxGolpe = new Map();
  const golpeIdx = (golpe) => {
    let i = idxGolpe.get(golpe.name);
    if (i == null) {
      i = rep.golpes.push({ n: golpe.name, t: golpe.type }) - 1;
      idxGolpe.set(golpe.name, i);
    }
    return i;
  };

  for (const m of membros) {
    rep.atores.push(atorDoPokemon(m), atorDoTreinador(m));
    rep.inicio.push(m.pk.slot, m.pk.cx, m.pk.cy, m.tr.slot, m.tr.cx, m.tr.cy);
  }

  const totalGuilds = comGente.length;
  /** Colocação de quem já caiu. A última guild de pé entra como 1º no final. */
  const colocacoes = new Map();
  let proximaColocacao = totalGuilds;
  const celula = (cx, cy) => cy * g.cols + cx;

  const eliminarGuild = (guildId) => {
    if (colocacoes.has(guildId)) return;
    colocacoes.set(guildId, proximaColocacao);
    proximaColocacao = Math.max(1, proximaColocacao - 1);
  };

  let t = 0;
  let motivo = 'wipe';
  let ticks = 0;
  /** Quando a fita para de rodar depois de a guerra já estar decidida. */
  let fimEm = null;
  /** Corpos esperando a hora de sumir: `{ em, slots }`, do pokémon e do treinador do caído. */
  const remocoes = [];

  while (t < teto) {
    t += PASSO_MS;
    ticks++;
    const q = quadroVazio(t);

    for (let i = remocoes.length - 1; i >= 0; i--) {
      if (remocoes[i].em > t) continue;
      q.x.push(...remocoes[i].slots);
      remocoes.splice(i, 1);
    }

    // Tiles ocupadas por quem está de pé: dois pokémon não se empilham. Montado uma vez por
    // tick e mantido em dia a cada passo, como no campo ao vivo.
    const ocupacao = new Set();
    for (const m of membros) {
      if (!m.fora && m.pk.hp > 0) ocupacao.add(celula(m.pk.cx, m.pk.cy));
    }

    // ---------------------------------------------------------------- pokémon
    for (const membro of membros) {
      if (membro.fora) continue;
      const e = membro.pk;
      if (e.hp <= 0) continue;
      if (e.andando && parado(e, t)) e.andando = false;

      const alvo = inimigoMaisProximo(membros, membro);
      if (!alvo) continue;

      const dist = chebyshev(e.cx, e.cy, alvo.pk.cx, alvo.pk.cy);
      if (dist > DIST_COMBATE) {
        if (!parado(e, t)) continue;
        const passo = passoRumoA(g, e.cx, e.cy, alvo.pk.cx, alvo.pk.cy, ocupacao, DIST_COMBATE);
        if (!passo) continue;
        ocupacao.delete(celula(e.cx, e.cy));
        ocupacao.add(celula(passo.cx, passo.cy));
        darPasso(e, passo.cx, passo.cy, t, MS_PASSO_HEROI);
        q.p.push(e.slot, e.cx, e.cy);
        continue;
      }

      if (t < membro.proxGolpe) continue;
      const golpe = melhorGolpeJogador(
        especies.get(e.speciesId),
        e,
        e.level,
        e.stats,
        alvo.pk.tipos,
        membro.cdGolpes,
        t,
        alvo.pk.stats,
      );
      if (!golpe) continue;
      membro.cdGolpes[golpe.name] = t + cooldownComSpeed(golpe.cooldownMs, ivSpeedDe(e));
      membro.proxGolpe = t + cooldownComSpeed(CD_GOLPE_MS, ivSpeedDe(e));

      const atkKey = golpe.category === 'SPECIAL' ? 'spAtk' : 'atk';
      const defKey = golpe.category === 'SPECIAL' ? 'spDef' : 'def';
      const r = calcularDano({
        nivelAtacante: e.level,
        power: golpe.power,
        atk: e.stats[atkKey],
        def: alvo.pk.stats[defKey],
        tipoGolpe: golpe.type,
        tiposAtacante: e.tipos,
        tiposDefensor: alvo.pk.tipos,
        ehSelvagem: false,
      });
      alvo.pk.hp = Math.max(0, alvo.pk.hp - r.dano);
      alvo.time[alvo.iAtivo].hp = alvo.pk.hp;
      q.h.push(alvo.pk.slot, alvo.pk.hp);
      // A pancada, para o replay desenhar. `ef` vai ×100 porque a efetividade é fracionária
      // (0,25 · 0,5 · 1 · 2 · 4) e um inteiro ocupa menos espaço na fita do que "0.25".
      if (gravarGolpes) q.a.push(
        e.slot,
        alvo.pk.slot,
        golpeIdx(golpe),
        r.dano,
        Math.round(r.efetividade * 100),
        r.stab ? 1 : 0,
      );
      if (alvo.pk.hp > 0) continue;

      // ------------------------------------------------------------- abate
      membro.abates++;
      alvo.mortes++;
      q.e.push({ k: 'abate', a: membro.nick, p: alvo.pk.nome, v: alvo.nick, g: membro.guildIdx });

      const reserva = alvo.time.findIndex((pk, i) => i > alvo.iAtivo && pk.hp > 0);
      if (reserva >= 0) {
        alvo.iAtivo = reserva;
        const novo = alvo.time[reserva];
        // O slot é o mesmo; o que muda é QUEM está nele. O cliente troca o sprite, o nome e
        // a barra sem tirar a entidade do mapa — que é como a troca de pokémon já funciona.
        Object.assign(alvo.pk, novo);
        q.c.push({
          s: alvo.pk.slot,
          n: novo.nome,
          e: novo.speciesId ?? 0, // a espécie, pelo mesmo motivo de `atorDoPokemon`
          lt: (novo.shiny && novo.lookShiny) || novo.looktype,
          nv: novo.level,
          sh: novo.shiny ? 1 : 0,
          mhp: novo.maxHp,
          hp: novo.hp,
        });
        continue;
      }

      // Time inteiro no chão: o membro está fora da briga na hora, mas o corpo fica alguns
      // segundos no mapa antes de sumir — é o que deixa um wipe legível no replay.
      alvo.fora = true;
      ocupacao.delete(celula(alvo.pk.cx, alvo.pk.cy));
      q.m.push(alvo.pk.slot);
      remocoes.push({ em: t + CORPO_MS, slots: [alvo.pk.slot, alvo.tr.slot] });
      if (!membros.some((m) => !m.fora && m.guildId === alvo.guildId)) eliminarGuild(alvo.guildId);
    }

    // -------------------------------------------------------------- treinador
    //
    // Anda atrás do próprio pokémon e nunca entra na conta de ocupação: dois personagens do
    // mesmo jogador dividindo tile é melhor do que o boneco travando o caminho da briga.
    for (const membro of membros) {
      if (membro.fora) continue;
      const tr = membro.tr;
      if (tr.andando && parado(tr, t)) tr.andando = false;
      if (!parado(tr, t)) continue;
      if (chebyshev(tr.cx, tr.cy, membro.pk.cx, membro.pk.cy) <= 1) continue;
      const passo = passoRumoA(g, tr.cx, tr.cy, membro.pk.cx, membro.pk.cy, null, 1);
      if (!passo) continue;
      darPasso(tr, passo.cx, passo.cy, t, MS_PASSO_TREINADOR);
      q.p.push(tr.slot, tr.cx, tr.cy);
    }

    gravarQuadro(rep, q, limiteQuadros);

    if (fimEm == null) {
      const vivas = guildsVivas(membros);
      if (vivas.size <= 1) {
        for (const guildId of vivas) {
          colocacoes.set(guildId, 1);
          break;
        }
        // A guerra está decidida, mas a fita continua rodando por alguns segundos: é o tempo
        // de o último corpo sumir e de os treinadores vencedores alcançarem os pokémon deles.
        // Cortar no golpe fatal deixava o replay terminando no meio de um passo.
        fimEm = t + CORPO_MS + 1200;
      }
    }
    if (fimEm != null && t >= fimEm) break;

    if (ticks % TICKS_POR_FOLEGO === 0 && aoRespirar) await aoRespirar();
  }

  // Estourou o tempo: quem tem mais HP em pé leva, e as outras entram na ordem da saúde. É
  // um desempate e está marcado como tal no resumo — ninguém "venceu" uma guerra que não
  // terminou, mas deixar sete guilds sem colocação seria pior.
  const sobreviventes = guildsVivas(membros);
  if (sobreviventes.size > 1) {
    motivo = 'tempo';
    // A ordem de quem caiu já está gravada em `colocacoes` (último a cair = número menor).
    // As sobreviventes entram TODAS na frente delas, e por isso a tabela é remontada do zero:
    // atribuir 1º a um sobrevivente sem mexer nos eliminados criaria duas guilds no 3º lugar.
    const caidas = [...colocacoes.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    colocacoes.clear();
    let pos = 1;
    for (const { id } of [...sobreviventes]
      .map((id) => ({ id, saude: saudeDaGuild(membros, id) }))
      .sort((a, b) => b.saude - a.saude)) {
      colocacoes.set(id, pos++);
    }
    for (const id of caidas) colocacoes.set(id, pos++);
  }

  for (const gu of comGente) if (!colocacoes.has(gu.id)) eliminarGuild(gu.id);

  // Aperta a tabela para 1..N. Sem isto, um wipe mútuo (as últimas guilds caindo no mesmo
  // tick) deixaria o pódio começando no 2º lugar — e o GP do 1º sem dono, num evento que
  // terminou com um vencedor de fato.
  {
    let pos = 1;
    for (const [id] of [...colocacoes.entries()].sort((a, b) => a[1] - b[1])) {
      colocacoes.set(id, pos++);
    }
  }

  rep.dur = t;
  const vencedorId = [...colocacoes.entries()].find(([, pos]) => pos === 1)?.[0] ?? null;

  const placar = comGente.map((gu, i) => {
    const meus = membros.filter((m) => m.guildIdx === i);
    return {
      id: gu.id,
      nome: gu.nome,
      brasao: gu.brasao ?? null,
      pos: colocacoes.get(gu.id) ?? comGente.length,
      abates: soma(meus.map((m) => m.abates)),
      mortes: soma(meus.map((m) => m.mortes)),
      membros: meus
        .map((m) => ({ nick: m.nick, abates: m.abates, sobreviveu: !m.fora }))
        .sort((a, b) => b.abates - a.abates || a.nick.localeCompare(b.nick)),
    };
  }).sort((a, b) => a.pos - b.pos);

  return { vencedorId, colocacoes, replay: rep, placar, motivo, duracaoMs: t };
}

// ------------------------------------------------------------------ testes
//
// Expostas pra `tools/teste-guild-pvp.mjs` conferir o espalhamento/conectividade das âncoras
// direto pelas funções DE VERDADE — sem isto, um teste reimplementaria a lógica à parte e
// corria o risco de testar uma cópia que já não bate mais com o código real.

export const _testeAncorasDeGuild = ancorasDeGuild;
export const _testeNascimentoPorChave = nascimentoPorChave;
export const _testeSerpentinaDasChaves = serpentinaDasChaves;
export const _testeDistanciasAPe = distanciasAPe;
export const _testeTilesAndaveisDaArena = tilesAndaveisDaArena;
export const _testeRecortarArena = recortarArena;
