// O CAMPO: a área andável de uma hunt e quem está andando nela.
//
// Espelha o modelo do jogo original. Lá o cliente recebe `field-init` com a grade da hunt
// (`rows`, `cols`, `grid`) e depois `field` a cada tick com as posições de herói e mobs em
// linha/coluna — o cliente só INTERPOLA entre a tile anterior e a atual. Nada de posição é
// decidido no browser; aqui é igual.
//
// Coordenadas: tudo em célula da grade (cx, cy), com origem no canto da caixa `_meta.walk`.
// A conversão para tile do mapa (o que o renderizador usa) é `tx = minTx + cx`.
//
// A grade em si vem pronta de `world/walkgrids.json` (tools/build-walkgrids.mjs) — abrir os
// mapas de 238 MB no servidor não é opção.
import { grades } from '../content.mjs';
import { passoComBicicleta } from '../../shared/bicicletas.mjs';

// ------------------------------------------------------------------ constantes
//
// Design nosso: o servidor deles não expõe estes números. Ficam juntos para balancear fácil.

/** Duração de um passo, em ms. O herói anda o dobro da velocidade dos selvagens. */
export const MS_PASSO_HEROI = 260;
export const MS_PASSO_MOB = 520;
/** O treinador anda um tico mais devagar que o pokémon — fica sempre um passo atrás. */
export const MS_PASSO_TREINADOR = 290;

/** Outfit do treinador que segue o pokémon (kind `trainer` no índice de outfits). */
export const LOOKTYPE_TREINADOR = 159;

/** Quanto um selvagem pode se afastar do ponto de spawn dele enquanto vagueia. */
const RAIO_VAGUEIO = 5;

/** Pausa entre dois passos de um selvagem ocioso (sorteada nesta faixa). */
const PAUSA_MOB = [700, 2600];

/**
 * Selvagem só persegue o herói dentro deste raio — mais que isso, volta a vaguear.
 *
 * Vale para QUALQUER selvagem, não só o que está sendo caçado: com os 15 pontos de spawn
 * espalhados pela caixa inteira (na abra, quatro deles são os cantos do mapa), um herói que
 * só corre atrás de um por vez passa 85% do tempo andando. Com os vizinhos vindo junto, a
 * caçada tem fila e o campo parece vivo — que é como a hunt do original se comporta.
 */
const RAIO_PERSEGUICAO = 12;

/**
 * Uma vez irritado, o selvagem só desiste quando o herói passa desta distância.
 *
 * Sem a histerese só um chegava por vez: o herói anda o dobro da velocidade deles, então
 * quem entrava no raio saía dele no passo seguinte e voltava a vaguear. Com a coleira de
 * aggro, o bando inteiro que viu o herói vem junto e forma fila em volta dele.
 *
 * O raio é grande de propósito. Os pontos de spawn de uma hunt ficam espalhados pela caixa
 * toda (na abra, quatro deles são os cantos do mapa): com 7 tiles, o herói tinha em média
 * 0,9 selvagem por perto — ou seja, só o alvo. Com 12 a conta dá ~3, que é o bando que se vê
 * na hunt do original.
 */
const RAIO_DESISTIR = 18;

/** Distância (Chebyshev) em que herói e alvo trocam golpes. Igual à do findPath deles. */
export const DIST_COMBATE = 1;

/**
 * Teto de selvagens em campo ao mesmo tempo. Nenhuma hunt tem mais de 16 pontos de spawn,
 * então na prática isto quer dizer "todos os pontos da hunt, de uma vez".
 */
export const MAX_MOBS = 16;

/** Pausa entre a última morte da onda e a onda seguinte. */
export const MS_ONDA = 2600;

/** Quanto tempo o derrotado fica caído no chão, capturável, antes de sumir. */
export const CORPO_MS = 30000;

/** Teto de corpos simultâneos no campo, para o desenho não pesar em ondas rápidas. */
const MAX_CORPOS = 24;

/** Teto de células visitadas numa busca de caminho — evita varrer um mapa inteiro por engano. */
const TETO_BUSCA = 4000;

/** A maior geração que cabe num Int32Array — ver `rascunho` e `OcupacaoGrade`. */
const GERACAO_MAXIMA = 0x7fffffff;

// 1=norte 2=leste 3=sul 4=oeste (a mesma numeração dos sprites de outfit)
const VIZINHOS = [
  [0, -1, 1],
  [1, 0, 2],
  [0, 1, 3],
  [-1, 0, 4],
];

/** Rascunho das opções do vagueio (até 4 vizinhos × 2 coordenadas), reaproveitado — ver `moverCampo`. */
const OPCOES_VAGUEIO = new Int32Array(8);

// ------------------------------------------------------------------- a grade

const cache = new Map();

function parseGrid(bruta, slug, andar) {
  if (bruta.andares) {
    const camada = bruta.andares[String(andar)];
    if (!camada?.grid?.length) return null;
    return montarGridParseada(bruta, slug, andar, camada);
  }
  if (!bruta?.grid?.length) return null;
  return montarGridParseada(bruta, slug, andar, bruta);
}

function montarGridParseada(bruta, slug, andar, camada) {
  const cols = camada.grid[0].length;
  const rows = camada.grid.length;
  const grid = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const linha = camada.grid[y];
    for (let x = 0; x < cols; x++) if (linha.charCodeAt(x) === 49) grid[y * cols + x] = 1;
  }
  return {
    slug,
    mapa: bruta.mapa ?? slug,
    minTx: bruta.box[0],
    minTy: bruta.box[1],
    cols,
    rows,
    grid,
    groundZ: bruta.groundZ,
    andar,
    escadas: bruta.escadas ?? null,
    inicio: camada.inicio ?? bruta.inicio,
    pontos: camada.pontos ?? bruta.pontos ?? [],
  };
}

/**
 * Grade andável de uma hunt, compartilhada por todos os jogadores naquela hunt.
 * Casas com escadas aceitam `andar` (Z do mapa) para o pavimento correto.
 * @returns {{slug, minTx, minTy, cols, rows, grid: Uint8Array, inicio, pontos, andar, escadas}|null}
 */
export function gradeDaHunt(slug, andar = null) {
  const bruta = grades[slug];
  if (!bruta?.grid?.length && !bruta?.andares) return null;
  const z = andar ?? bruta.groundZ ?? 7;
  const chave = bruta.andares ? `${slug}@${z}` : slug;
  if (cache.has(chave)) return cache.get(chave);

  const g = bruta.andares ? parseGrid(bruta, slug, z) : parseGrid({ ...bruta, andares: null }, slug, z);
  cache.set(chave, g);
  return g;
}

export const andavel = (g, cx, cy) =>
  cx >= 0 && cx < g.cols && cy >= 0 && cy < g.rows && g.grid[cy * g.cols + cx] === 1;

export const chebyshev = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** Distância do herói até um selvagem, em tiles de tabuleiro. */
export const distanciaDoHeroi = (campo, mob) =>
  chebyshev(campo.heroi.cx, campo.heroi.cy, mob.cx, mob.cy);

/**
 * Raio de perseguição/aggro ajustado ao tamanho da hunt.
 *
 * Hunts grandes (Onix, Kingdra…) têm spawns longe do `inicio`; com 12 tiles o selvagem
 * lá embaixo nunca “vê” o herói em cima — o pokémon fica alternando alvo sem chegar a
 * brigar. O raio cobre o spawn mais distante + folga; o desistir fica acima disso.
 */
export function raiosAggroDaGrade(g) {
  const [ix, iy] = g.inicio ?? [0, 0];
  let max = 0;
  for (const p of g.pontos ?? []) max = Math.max(max, chebyshev(ix, iy, p[0], p[1]));
  const perseg = Math.max(RAIO_PERSEGUICAO, max + 2);
  return { raioPersegucao: perseg, raioDesistir: perseg + 6 };
}

/**
 * Rascunho de busca por grade, reaproveitado entre chamadas.
 *
 * Alocar um `Int32Array` do tamanho do mapa por busca custaria ~8 KB por entidade por tick —
 * com 2000 jogadores × 17 entidades × 4 Hz isso é 1 GB/s de lixo só para achar um caminho de
 * cinco tiles. A grade é compartilhada e o sim é single-thread, então um rascunho por hunt
 * resolve; o contador de geração dispensa limpar o buffer a cada busca.
 */
function rascunho(g) {
  if (!g._veioDe) {
    const n = g.cols * g.rows;
    g._veioDe = new Int32Array(n);
    g._geracao = new Int32Array(n);
    g._fila = new Int32Array(n);
    g._contador = 0;
  }
  // O contador é gravado num Int32Array. Passando de 2^31 ele gravaria negativo, e nenhuma célula
  // voltaria a contar como visitada: a busca passava a devolver `null` e, logo em seguida, entrava num
  // laço infinito refazendo a trilha — o sim congelado, com o processo vivo. Acontece depois de ~2,1
  // bilhões de buscas numa mesma grade. Zerar as marcas antes do estouro é começar do zero, que é o
  // que cada busca já supõe. Ver `tools/teste-campo-passo.mjs`.
  if (g._contador >= GERACAO_MAXIMA) {
    g._geracao.fill(0);
    g._contador = 0;
  }
  g._contador++;
  return g;
}

/**
 * Primeiro passo do caminho de (ox,oy) até ficar adjacente a (dx,dy).
 *
 * Busca em largura, 4 direções, com o mesmo critério de parada do cliente deles: chegar a
 * Chebyshev ≤ 1 do destino já conta como chegar. Devolve `null` se não houver caminho —
 * aí quem chamou decide (o herói fica parado, o mob volta a vaguear).
 */
export function passoRumoA(g, ox, oy, dx, dy, ocupadas, dist = DIST_COMBATE) {
  if (chebyshev(ox, oy, dx, dy) <= dist) return null;
  // A ocupação é lida numa grade (`OcupacaoGrade`). Quem ainda passa um `Set` de índices — a arena
  // PvP, a guerra de guilds, os testes — recebe uma grade montada com as mesmas tiles.
  const oc = ocupadas == null ? null : ocupadas instanceof OcupacaoGrade ? ocupadas : gradeDoConjunto(g, ocupadas);
  // Sem nenhuma casa de CHEGADA livre em volta do destino, a busca não teria onde terminar e
  // varreria até TETO_BUSCA células só para devolver null. É o que acontecia com cada selvagem
  // perseguindo um herói já cercado pelos outros, a cada passo: o perfil de produção de
  // 14/09/2026 pôs esta função em 21% do tempo do sim. Ver `semChegada`.
  if (dist >= 1 && semChegada(g, dx, dy, oc, dist)) return null;

  rascunho(g);
  const { _veioDe: veioDe, _geracao: geracao, _fila: fila, _contador: gen, cols, rows, grid } = g;
  const temOcupadas = oc !== null;
  const marca = temOcupadas ? oc.marca : null;
  const genOcupada = temOcupadas ? oc.gen : 0;
  const limiteFila = fila.length;

  const inicio = oy * cols + ox;
  veioDe[inicio] = inicio;
  geracao[inicio] = gen;
  fila[0] = inicio;
  let cabeca = 0;
  let cauda = 1;

  while (cabeca < cauda && cabeca < TETO_BUSCA) {
    const atual = fila[cabeca++];
    const ax = atual % cols;
    const ay = (atual - ax) / cols;

    // Os quatro vizinhos desenrolados, na MESMA ordem de `VIZINHOS` (norte, leste, sul, oeste): a
    // ordem decide qual caminho sai quando há mais de um do mesmo tamanho. Uma tile ocupada só é
    // intransponível se não for o próprio destino.
    //
    // A CHEGADA é conferida ao enfileirar, e não ao tirar da fila: numa fila, a primeira tile de
    // chegada que entra é a primeira que sairia, então o caminho devolvido é o mesmo — só deixa de
    // expandir o resto da camada até ela. `cauda < TETO_BUSCA` preserva o teto: a busca anterior
    // nunca tirava da fila uma tile daquela posição em diante. `teste-campo-passo.mjs` confere o
    // resultado contra a busca original.
    let idx = atual - cols; // norte
    if (ay > 0 && grid[idx] === 1 && geracao[idx] !== gen
        && !(temOcupadas && marca[idx] === genOcupada && !(ax === dx && ay - 1 === dy))) {
      geracao[idx] = gen;
      veioDe[idx] = atual;
      if (cauda < limiteFila) {
        if (cauda < TETO_BUSCA && chega(ax, ay - 1, dx, dy, dist)) return primeiroPasso(veioDe, inicio, idx, cols);
        fila[cauda++] = idx;
      }
    }
    idx = atual + 1; // leste
    if (ax + 1 < cols && grid[idx] === 1 && geracao[idx] !== gen
        && !(temOcupadas && marca[idx] === genOcupada && !(ax + 1 === dx && ay === dy))) {
      geracao[idx] = gen;
      veioDe[idx] = atual;
      if (cauda < limiteFila) {
        if (cauda < TETO_BUSCA && chega(ax + 1, ay, dx, dy, dist)) return primeiroPasso(veioDe, inicio, idx, cols);
        fila[cauda++] = idx;
      }
    }
    idx = atual + cols; // sul
    if (ay + 1 < rows && grid[idx] === 1 && geracao[idx] !== gen
        && !(temOcupadas && marca[idx] === genOcupada && !(ax === dx && ay + 1 === dy))) {
      geracao[idx] = gen;
      veioDe[idx] = atual;
      if (cauda < limiteFila) {
        if (cauda < TETO_BUSCA && chega(ax, ay + 1, dx, dy, dist)) return primeiroPasso(veioDe, inicio, idx, cols);
        fila[cauda++] = idx;
      }
    }
    idx = atual - 1; // oeste
    if (ax > 0 && grid[idx] === 1 && geracao[idx] !== gen
        && !(temOcupadas && marca[idx] === genOcupada && !(ax - 1 === dx && ay === dy))) {
      geracao[idx] = gen;
      veioDe[idx] = atual;
      if (cauda < limiteFila) {
        if (cauda < TETO_BUSCA && chega(ax - 1, ay, dx, dy, dist)) return primeiroPasso(veioDe, inicio, idx, cols);
        fila[cauda++] = idx;
      }
    }
  }
  return null;
}

/** Chebyshev de (x,y) até o destino ≤ `dist` — sem Math.max/Math.abs no laço mais quente do sim. */
function chega(x, y, dx, dy, dist) {
  return x - dx <= dist && dx - x <= dist && y - dy <= dist && dy - y <= dist;
}

/** Volta pela trilha da busca até o passo logo depois da origem. */
function primeiroPasso(veioDe, inicio, no, cols) {
  while (veioDe[no] !== inicio) no = veioDe[no];
  const px = no % cols;
  return { cx: px, cy: (no - px) / cols };
}

/**
 * `true` quando NENHUMA tile pode encerrar a busca rumo a (dx,dy) — então ela devolveria `null`
 * de qualquer jeito, e dá para responder sem varrer o mapa.
 *
 * Por que isto é exato (e não uma aproximação): a busca só termina numa tile que ela ENFILEIROU
 * e que está a Chebyshev ≤ `dist` do destino. Enfileirar exige ser andável e não ocupada — a
 * não ser que seja o próprio destino. Só que, com `dist ≥ 1`, o destino só é alcançado passando
 * antes por um vizinho dele, e esse vizinho já está a distância 1 ≤ `dist`: a busca teria parado
 * nele. Logo, sem nenhuma tile andável e livre no quadrado em volta do destino (fora o destino),
 * não há onde parar.
 */
function semChegada(g, dx, dy, oc, dist) {
  const { cols, rows, grid } = g;
  const y0 = dy - dist < 0 ? 0 : dy - dist;
  const y1 = dy + dist >= rows ? rows - 1 : dy + dist;
  const x0 = dx - dist < 0 ? 0 : dx - dist;
  const x1 = dx + dist >= cols ? cols - 1 : dx + dist;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x === dx && y === dy) continue;
      const idx = y * cols + x;
      if (grid[idx] !== 1) continue;
      if (oc !== null && oc.marca[idx] === oc.gen) continue;
      return false;
    }
  }
  return true;
}

export const direcaoDe = (dx, dy) => (dy < 0 ? 1 : dy > 0 ? 3 : dx > 0 ? 2 : 4);

/** Começa um passo de uma tile. O cliente interpola entre `de` e a posição nova. */
export function darPasso(e, cx, cy, agora, passoMs) {
  e.deCx = e.cx;
  e.deCy = e.cy;
  e.dir = direcaoDe(cx - e.cx, cy - e.cy);
  e.cx = cx;
  e.cy = cy;
  e.passoEm = agora;
  e.passoMs = passoMs;
  e.andando = true;
}

/** Uma entidade está "livre" quando o passo atual terminou. */
export const parado = (e, agora) => agora >= e.passoEm + e.passoMs;

/** Tile andável mais próxima de (cx,cy), em anéis — a mesma busca do `teleportTo` deles. */
export function encaixar(g, cx, cy, raio = 6) {
  if (andavel(g, cx, cy)) return { cx, cy };
  for (let r = 1; r <= raio; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (andavel(g, cx + dx, cy + dy)) return { cx: cx + dx, cy: cy + dy };
      }
    }
  }
  return null;
}

// -------------------------------------------------------------------- o campo

/**
 * Cria o campo de uma hunt com o herói no ponto de entrada e nenhum selvagem ainda.
 *
 * `opcoes`:
 *   `looktypeTreinador`  o outfit do boneco que segue o pokémon
 *   `visualTreinador`    as cores do boneco do dono (ver `game/visual.mjs`)
 *   `usarRaioHunt`       `false` na arena do boss, que tem raio próprio
 *   `distCombate`        alcance de briga — 2 na arena que fica dentro da água
 */
export function criarCampo(slug, agora, opcoes = {}) {
  const g = gradeDaHunt(slug);
  if (!g || !g.pontos.length) return null;
  // `distCombate` é por campo por causa da arena: o Giant Cruel fica dentro da água e se
  // briga com ele a 2 tiles (o `heroStop` da arena deles), não encostado.
  const distCombate = opcoes.distCombate ?? DIST_COMBATE;
  const autoRaio = raiosAggroDaGrade(g);
  const raios =
    opcoes.usarRaioHunt === false
      ? {
          raioPersegucao: opcoes.raioPersegucao ?? RAIO_PERSEGUICAO,
          raioDesistir: opcoes.raioDesistir ?? RAIO_DESISTIR,
        }
      : {
          raioPersegucao: opcoes.raioPersegucao ?? autoRaio.raioPersegucao,
          raioDesistir: opcoes.raioDesistir ?? autoRaio.raioDesistir,
        };

  const [ix, iy] = g.inicio;
  const dir = 3;
  const parado = (cx, cy, passoMs) => ({
    cx, cy, deCx: cx, deCy: cy, dir, passoEm: agora, passoMs, andando: false,
  });

  return {
    slug,
    g,
    seq: 0,
    heroi: parado(ix, iy, MS_PASSO_HEROI),
    // O treinador nasce em cima do pokémon e vai atrás dele o jogo inteiro.
    treinador: parado(ix, iy, MS_PASSO_TREINADOR),
    mobs: new Map(),
    proxSlot: 1,
    alvo: null,
    /** Contador de ondas já spawnadas — separa “sem dano nesta onda” da trava de 3 s. */
    ondaSeq: 0,
    ondaEm: agora,
    mudou: new Set(), // slots com estado novo para mandar ao cliente
    heroiMudou: true,
    treinadorMudou: true,
    looktypeTreinador: opcoes.looktypeTreinador ?? LOOKTYPE_TREINADOR,
    visualTreinador: opcoes.visualTreinador ?? null,
    distCombate,
    raioPersegucao: raios.raioPersegucao,
    raioDesistir: raios.raioDesistir,
  };
}

/**
 * Tiles ocupadas, numa grade do tamanho do mapa: a tile `idx` está ocupada quando `marca[idx] === gen`.
 *
 * Tem a interface do `Set` de antes (`has`, `add`, `delete`), então `moverCampo` e `porMobEmCampo`
 * não mudaram — mas a busca de caminho lê a grade direto. Consultar um `Set` a cada vizinho examinado
 * era a maior parte do custo da busca: com a grade ela ficou 1,8× mais rápida nas grades reais,
 * devolvendo os mesmos passos (`tools/teste-campo-passo.mjs`).
 *
 * Esvaziar é trocar de geração, sem varrer nada. Diferente de um `Set`, uma tile fora da grade não é
 * guardada — e ninguém pergunta por uma: toda consulta vem depois de conferir que a tile é andável.
 */
class OcupacaoGrade {
  constructor(n) {
    this.marca = new Int32Array(n);
    this.gen = 0;
  }

  /** Esvazia, com o mesmo cuidado de `rascunho` no estouro do contador. */
  recomecar() {
    if (this.gen >= GERACAO_MAXIMA) {
      this.marca.fill(0);
      this.gen = 0;
    }
    this.gen++;
    return this;
  }

  has(idx) {
    return this.marca[idx] === this.gen;
  }

  add(idx) {
    this.marca[idx] = this.gen;
    return this;
  }

  delete(idx) {
    this.marca[idx] = 0;
  }
}

/**
 * As tiles ocupadas por selvagens vivos (para eles não se empilharem), montadas uma vez por chamada e
 * mantidas em dia a cada passo — refazer por entidade era quadrático no número de mobs.
 *
 * A grade é da HUNT, compartilhada por quem caça nela, como o rascunho da busca: isto roda por jogador
 * a cada tick, e os dois que chamam (`moverCampo`, `porMobEmCampo`) usam a ocupação e largam na hora,
 * sem nada no meio que volte a chamar esta função.
 */
function ocupacao(campo) {
  const g = campo.g;
  const oc = (g._ocupacao ??= new OcupacaoGrade(g.cols * g.rows)).recomecar();
  const cols = g.cols;
  for (const m of campo.mobs.values()) if (!m.morto) oc.add(m.cy * cols + m.cx);
  return oc;
}

/** Um `Set` de índices de tile como grade — para `passoRumoA` atender quem ainda passa `Set`. */
function gradeDoConjunto(g, conjunto) {
  const oc = (g._ocupacaoConjunto ??= new OcupacaoGrade(g.cols * g.rows)).recomecar();
  for (const idx of conjunto) oc.add(idx);
  return oc;
}

/**
 * Coloca um selvagem em campo, ancorado num ponto de spawn da hunt.
 * `dados` traz o que o sim já sorteou (espécie, nível, stats, hp…).
 */
export function porMobEmCampo(campo, dados, ponto, agora) {
  const g = campo.g;
  const ocupadas = ocupacao(campo);
  // Mob FIXO (o boss) fica exatamente onde o ponto manda, mesmo em tile não-andável: o Giant
  // Cruel nasce dentro da poça da arena, e encaixá-lo o jogaria para a margem.
  let pos = dados.fixo ? { cx: ponto[0], cy: ponto[1] } : encaixar(g, ponto[0], ponto[1]);
  // ponto ocupado por outro selvagem: procura uma tile livre em volta (o fixo não desvia)
  if (pos && !dados.fixo && ocupadas.has(pos.cy * g.cols + pos.cx)) {
    pos =
      [...VIZINHOS, [1, 1], [-1, 1], [1, -1], [-1, -1]]
        .map(([dx, dy]) => ({ cx: pos.cx + dx, cy: pos.cy + dy }))
        .find((p) => andavel(g, p.cx, p.cy) && !ocupadas.has(p.cy * g.cols + p.cx)) ?? pos;
  }
  if (!pos) return null;

  const slot = campo.proxSlot++;
  const mob = {
    ...dados,
    slot,
    cx: pos.cx,
    cy: pos.cy,
    deCx: pos.cx,
    deCy: pos.cy,
    dir: 1 + Math.floor(Math.random() * 4),
    passoEm: agora,
    passoMs: MS_PASSO_MOB,
    andando: false,
    ancora: [pos.cx, pos.cy],
    proxPasso: agora + PAUSA_MOB[0] + Math.random() * (PAUSA_MOB[1] - PAUSA_MOB[0]),
    morto: false,
  };
  campo.mobs.set(slot, mob);
  campo.mudou.add(slot);
  return mob;
}

/** Sem alocação de propósito: isto roda por jogador, 4×/s. */
export function algumMobVivo(campo) {
  for (const m of campo.mobs.values()) if (!m.morto) return true;
  return false;
}

/**
 * O derrotado fica caído no chão por CORPO_MS antes de sumir — é nessa janela que o
 * jogador arremessa a bola nele. Aqui só a limpeza: quem passou do tempo sai do mapa e
 * entra no delta como "fora", para o cliente apagar também.
 *
 * O teto existe para o pior caso: ondas rápidas empilhariam corpos até pesar no desenho.
 * Some primeiro o mais antigo, que é o que estava mais perto de expirar de qualquer jeito.
 */
export function limparCorpos(campo, agora) {
  // Roda por jogador a cada tick, e quase sempre há menos corpos que o teto: conta primeiro e só
  // monta a lista (na mesma ordem de antes) quando precisa ordenar e cortar.
  let restantes = 0;
  for (const m of campo.mobs.values()) {
    if (!m.morto) continue;
    if (agora - (m.mortoEm ?? agora) >= CORPO_MS) {
      campo.mobs.delete(m.slot);
      campo.mudou.add(m.slot);
    } else restantes++;
  }
  if (restantes <= MAX_CORPOS) return;
  const corpos = [];
  for (const m of campo.mobs.values()) if (m.morto) corpos.push(m);
  corpos.sort((a, b) => a.mortoEm - b.mortoEm);
  for (const m of corpos.slice(0, corpos.length - MAX_CORPOS)) {
    campo.mobs.delete(m.slot);
    campo.mudou.add(m.slot);
  }
}

/** Tira o mob do mapa na hora (capturado) — sem deixar corpo. */
export function removerMob(campo, mob) {
  campo.mobs.delete(mob.slot);
  campo.mudou.add(mob.slot);
  if (campo.alvo === mob.slot) {
    campo.alvo = null;
    campo.heroiMudou = true;
  }
}

/** Selvagem vivo mais perto do herói, em distância de tabuleiro (não de caminho). */
export function alvoMaisProximo(campo) {
  const h = campo.heroi;
  let melhor = null;
  let melhorD = Infinity;
  for (const m of campo.mobs.values()) {
    if (m.morto) continue;
    const d = chebyshev(h.cx, h.cy, m.cx, m.cy);
    // Empate de distância: slot menor — evita flip-flop quando dois estão na mesma tile-métrica.
    if (d < melhorD || (d === melhorD && melhor && m.slot < melhor.slot)) {
      melhorD = d;
      melhor = m;
    }
  }
  return melhor;
}

/**
 * Alvo em hunt: sempre o mais próximo, com histerese no empate.
 *
 * Troca se o novo for estritamente mais perto (ex.: bloqueio na frente). À mesma distância
 * mantém o atual — evita ir e voltar entre dois selvagens equidistantes sem sair do lugar.
 */
export function escolherAlvoHunt(campo) {
  const melhor = alvoMaisProximo(campo);
  if (!melhor) return null;
  const atual = campo.alvo != null ? campo.mobs.get(campo.alvo) : null;
  if (!atual || atual.morto) return melhor;
  if (melhor.slot === atual.slot) return atual;

  const dAtual = distanciaDoHeroi(campo, atual);
  const dNovo = distanciaDoHeroi(campo, melhor);
  if (dNovo < dAtual) return melhor;
  return atual;
}

/**
 * Um passo de movimento de todo mundo no campo.
 *
 * O herói caça: vai até o alvo mais próximo e para ao encostar. Os selvagens vagueiam em
 * volta do ponto de spawn; o que está sendo caçado persegue o herói de volta.
 *
 * @returns {boolean} true se o herói está encostado no alvo (ou seja, dá para brigar)
 */
export function moverCampo(campo, agora) {
  const g = campo.g;
  const h = campo.heroi;
  const ocupadas = ocupacao(campo);
  const cols = g.cols;
  // Alcance de briga: 1 numa hunt, 2 na arena do boss que fica dentro da água.
  const dist = campo.distCombate ?? DIST_COMBATE;

  if (h.andando && parado(h, agora)) {
    h.andando = false;
    h.deCx = h.cx;
    h.deCy = h.cy;
    campo.heroiMudou = true;
  }

  const alvo = campo.alvo != null ? campo.mobs.get(campo.alvo) : null;
  const alvoValido = alvo && !alvo.morto ? alvo : null;
  if (!alvoValido) campo.alvo = null;

  // ------------------------------------------------------------------ herói
  let encostado = false;
  if (alvoValido) {
    encostado = chebyshev(h.cx, h.cy, alvoValido.cx, alvoValido.cy) <= dist && !h.andando;
    if (!h.andando && !encostado) {
      const passo = passoRumoA(g, h.cx, h.cy, alvoValido.cx, alvoValido.cy, ocupadas, dist);
      if (passo) {
        // `campo.velocidade` é a BICICLETA, posta pelo sim a cada tick (1 = a pé, e sempre 1 na
        // arena do boss). O `ms` do passo vai no delta, então o cliente anima no ritmo novo.
        darPasso(h, passo.cx, passo.cy, agora, passoComBicicleta(MS_PASSO_HEROI, campo.velocidade));
        campo.heroiMudou = true;
      } else {
        // sem caminho: encara o alvo e espera ele vir
        const d = direcaoDe(alvoValido.cx - h.cx, alvoValido.cy - h.cy);
        if (d !== h.dir) {
          h.dir = d;
          campo.heroiMudou = true;
        }
      }
    }
    if (encostado) {
      const d = direcaoDe(alvoValido.cx - h.cx, alvoValido.cy - h.cy);
      if (d !== h.dir) {
        h.dir = d;
        campo.heroiMudou = true;
      }
    }
  }

  // ------------------------------------------------------------- treinador
  //
  // Segue o pokémon e para ao encostar. Não entra na conta de ocupação: dois personagens do
  // mesmo jogador dividindo tile é melhor do que o treinador travando o caminho dos mobs.
  const tr = campo.treinador;
  if (tr) {
    if (tr.andando && parado(tr, agora)) {
      tr.andando = false;
      tr.deCx = tr.cx;
      tr.deCy = tr.cy;
      campo.treinadorMudou = true;
    }
    if (!tr.andando && chebyshev(tr.cx, tr.cy, h.cx, h.cy) > DIST_COMBATE) {
      const passo = passoRumoA(g, tr.cx, tr.cy, h.cx, h.cy, null);
      if (passo) {
        darPasso(tr, passo.cx, passo.cy, agora, passoComBicicleta(MS_PASSO_TREINADOR, campo.velocidade));
        campo.treinadorMudou = true;
      }
    } else if (!tr.andando) {
      const d = direcaoDe(h.cx - tr.cx, h.cy - tr.cy);
      if (d !== tr.dir) {
        tr.dir = d;
        campo.treinadorMudou = true;
      }
    }
  }

  // -------------------------------------------------------------- selvagens
  for (const m of campo.mobs.values()) {
    if (m.morto) continue;
    // O boss é FIXO: não vagueia nem persegue. Ele espera na arena e só encara o herói.
    if (m.fixo) {
      const d = direcaoDe(h.cx - m.cx, h.cy - m.cy);
      if (d !== m.dir) {
        m.dir = d;
        campo.mudou.add(m.slot);
      }
      continue;
    }

    if (m.andando && parado(m, agora)) {
      m.andando = false;
      m.deCx = m.cx;
      m.deCy = m.cy;
      m.proxPasso = agora + PAUSA_MOB[0] + Math.random() * (PAUSA_MOB[1] - PAUSA_MOB[0]);
      campo.mudou.add(m.slot);
    }
    if (m.andando) continue;

    // Perseguir não respeita a pausa do vagueio: quem viu o herói vem sem parar. Mas só há
    // perseguição enquanto o herói está caçando — com ele desmaiado, os selvagens que
    // estavam em cima dele voltam a vaguear em vez de congelar ali para sempre.
    const dist = chebyshev(m.cx, m.cy, h.cx, h.cy);
    const raioPerseg = campo.raioPersegucao ?? RAIO_PERSEGUICAO;
    const raioDesist = campo.raioDesistir ?? RAIO_DESISTIR;
    if (!alvoValido || dist > raioDesist) m.irritado = false;
    else if (dist <= raioPerseg) m.irritado = true;

    const perseguindo = !!alvoValido && m.irritado;
    if (!perseguindo && agora < m.proxPasso) continue;

    if (perseguindo) {
      if (chebyshev(m.cx, m.cy, h.cx, h.cy) <= DIST_COMBATE) {
        // encostado: só vira para o herói
        const d = direcaoDe(h.cx - m.cx, h.cy - m.cy);
        if (d !== m.dir) {
          m.dir = d;
          campo.mudou.add(m.slot);
        }
        m.proxPasso = agora + 400;
        continue;
      }
      const passo = passoRumoA(g, m.cx, m.cy, h.cx, h.cy, ocupadas);
      if (passo) {
        ocupadas.delete(m.cy * cols + m.cx);
        ocupadas.add(passo.cy * cols + passo.cx);
        darPasso(m, passo.cx, passo.cy, agora, MS_PASSO_MOB);
        campo.mudou.add(m.slot);
        continue;
      }
    }

    // vagueio: uma tile aleatória em volta, sem sair da coleira nem pisar em outro. As opções vão
    // num rascunho fixo (nada de array novo por selvagem por tick), na MESMA ordem de `VIZINHOS` —
    // é essa ordem, junto com o único `Math.random`, que decide para onde o selvagem vai.
    let n = 0;
    const ancX = m.ancora[0];
    const ancY = m.ancora[1];
    for (let v = 0; v < 4; v++) {
      const nx = m.cx + VIZINHOS[v][0];
      const ny = m.cy + VIZINHOS[v][1];
      if (!andavel(g, nx, ny)) continue;
      if (ocupadas.has(ny * cols + nx)) continue;
      if (chebyshev(nx, ny, ancX, ancY) > RAIO_VAGUEIO) continue;
      OPCOES_VAGUEIO[n++] = nx;
      OPCOES_VAGUEIO[n++] = ny;
    }
    if (!n) {
      m.proxPasso = agora + 900;
      continue;
    }
    const k = 2 * Math.floor((Math.random() * n) / 2);
    const vx = OPCOES_VAGUEIO[k];
    const vy = OPCOES_VAGUEIO[k + 1];
    ocupadas.delete(m.cy * cols + m.cx);
    ocupadas.add(vy * cols + vx);
    darPasso(m, vx, vy, agora, MS_PASSO_MOB);
    campo.mudou.add(m.slot);
  }

  return encostado;
}

// O Centro Pokémon já foi uma cena parada montada aqui (um recorte de 19×19 em volta da
// enfermeira, com todo mundo de pé olhando o balcão). Hoje ele é uma PRAÇA compartilhada, com
// jogadores andando de verdade, e mora em `centro.mjs` — que usa as mesmas peças deste
// arquivo (grade, passo, serialização) sem precisar do resto do campo de hunt.

// ------------------------------------------------------------ serialização
//
// Nomes curtos de campo de propósito: isto vai no socket a cada tick, para cada jogador.

export const serializarMob = (m) => ({
  s: m.slot,
  c: m.cx,
  r: m.cy,
  dc: m.deCx,
  dr: m.deCy,
  d: m.dir,
  em: m.passoEm,
  ms: m.passoMs,
  hp: m.hp,
  mhp: m.maxHp,
  x: m.morto ? 1 : 0,
  // quanto o corpo ainda tem de chão, em ms. Vai junto porque quem entra na hunt no meio
  // (ou volta do Centro) precisa saber a hora de apagar cada um.
  xr: m.morto ? Math.max(0, CORPO_MS - (Date.now() - (m.mortoEm ?? 0))) : undefined,
  // O looktype que o campo DESENHA. Num shiny é a arte da forma brilhante (Charizard 67 vira
  // Shiny Charizard 9874) — a troca é feita aqui, e não no cliente, porque `lt` é o único
  // looktype que o pacote de campo carrega e o resto da tela não precisa saber dos dois.
  lt: (m.shiny && m.lookShiny) || m.looktype,
  n: m.nome,
  nv: m.level,
  sh: m.shiny ? 1 : 0,
  // ---- PvP ----
  // Na arena as entidades são de OUTROS jogadores, e o cliente precisa de dois dados a mais:
  // `tr` marca o boneco do treinador (desenha sem barra de vida) e `elo` é o número que vai
  // escrito embaixo dele. Nas hunts nenhum dos dois existe, e `undefined` some do JSON.
  tr: m.ehTreinador ? 1 : undefined,
  elo: m.elo,
  // As cores do boneco daquele treinador (`[genero, pele, cabelo, bone, camisa, calca,
  // sapato]`). Só existe em entidade de gente; num pokémon é `undefined` e some do JSON.
  vs: m.visual,
  // ---- praça do Centro ----
  // `cura` marca a enfermeira: é em cima dela que o cliente pendura o botão de curar, e é a
  // boca dela que fala os balões da casa. `tm` marca o TM Researcher — botão flutuante igual.
  cura: m.cura ? 1 : undefined,
  tm: m.tm ? 1 : undefined,
  depot: m.depot ? 1 : undefined,
});

export const serializarHeroi = (h) => ({
  c: h.cx,
  r: h.cy,
  dc: h.deCx,
  dr: h.deCy,
  d: h.dir,
  em: h.passoEm,
  ms: h.passoMs,
});

/** Estado completo do campo — vai quando o jogador entra na hunt. */
export function snapshotCampo(campo) {
  return {
    slug: campo.slug,
    // o arquivo de tiles a carregar — só difere do slug nas áreas recortadas
    mapa: campo.g.mapa,
    // o cliente acerta o relógio já no primeiro pacote; sem isto o primeiro passo de cada
    // entidade sai errado até chegar o primeiro delta
    ts: Date.now(),
    box: [campo.g.minTx, campo.g.minTy, campo.g.cols, campo.g.rows],
    groundZ: campo.g.groundZ,
    heroi: serializarHeroi(campo.heroi),
    // o outfit é do CAMPO
    treinador: campo.treinador && {
      ...serializarHeroi(campo.treinador),
      lt: campo.looktypeTreinador ?? LOOKTYPE_TREINADOR,
      vs: campo.visualTreinador,
    },
    mobs: [...campo.mobs.values()].map(serializarMob),
    alvo: campo.alvo,
  };
}

/**
 * Só o que mudou desde o último envio. É isto que segura a banda: um selvagem só entra no
 * pacote no tick em que ele começa um passo novo, não a cada tick.
 */
export function deltaCampo(campo, agora) {
  if (!campo.mudou.size && !campo.heroiMudou && !campo.treinadorMudou) return null;
  const d = { seq: ++campo.seq, ts: agora, alvo: campo.alvo };
  if (campo.heroiMudou) d.heroi = serializarHeroi(campo.heroi);
  if (campo.treinadorMudou && campo.treinador) {
    d.treinador = serializarHeroi(campo.treinador);
    campo.treinadorMudou = false;
  }
  if (campo.mudou.size) {
    // Um laço só, sem os arrays intermediários do encadeamento: roda por jogador a cada tick. As
    // chaves saem na mesma ordem (`mobs`, e `fora` só quando há), então o JSON é o mesmo.
    const mobs = [];
    let fora = null;
    for (const slot of campo.mudou) {
      const m = campo.mobs.get(slot);
      if (m) mobs.push(serializarMob(m));
      else (fora ??= []).push(slot);
    }
    d.mobs = mobs;
    if (fora) d.fora = fora;
  }
  campo.mudou.clear();
  campo.heroiMudou = false;
  return d;
}
