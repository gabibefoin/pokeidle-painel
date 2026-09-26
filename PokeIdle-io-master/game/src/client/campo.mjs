// A cena: visão de cima da hunt, com a câmera seguindo o seu pokémon pelo mapa de tiles.
//
// O cliente NÃO decide posição nenhuma. O servidor manda, por tile, "fulano saiu de (c,r) e
// está indo para (c,r), começou em `em` e leva `ms`" — aqui só interpolamos entre as duas
// tiles e trocamos o quadro do sprite conforme a fração do passo. É o mesmo contrato do
// cliente deles (`field` → `walkFrom`/`stepStartAt`/`stepMs`).
//
// Ordem de desenho: o canvas de chão do mapa entra inteiro, e aí a banda de itens (árvores,
// pedras) é intercalada com os pokémon por profundidade — por isso um Abra passa ATRÁS da
// árvore que está na frente dele e NA FRENTE da que está atrás.

import {
  carregarOutfit,
  quadrosDe,
  efeitoDoTipo,
  efeitoTmElemental,
  folhasDaBola,
  QUADRO_BOLA_W,
  QUADRO_BOLA_H,
  MS_QUADRO_BOLA,
} from './sprites.mjs';
import { prepararMapa, soltarMapas, ez, BANDA_ITEM, POR_ANDAR } from './mapa.mjs';
import { t } from './i18n.mjs';
import { otimizadoLigado } from './preferencias.mjs';

const TILE = 32;

/**
 * Folga do RECORTE POR CÂMERA, em px de mundo.
 *
 * Generosa de propósito: o sprite de uma criatura sobe até ~96 px acima da tile em que ela
 * pisa, então quem está ancorado logo fora da tela ainda tem cabeça dentro dela. É a mesma
 * folga que o recorte dos sprites do mapa já usava em `desenharCena`.
 */
const MARGEM_VISTA = 128;

/** Formata o multiplicador de tipo para o popup de dano (×2, ×2.5, ×0.5…). */
const fmtMultEf = (v) => {
  const r = Math.round(v * 100) / 100;
  if (Number.isInteger(r)) return String(r);
  return String(r).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};

/**
 * Cores, tamanho e animação do popup de dano — deixa explícito ×1 neutro vs ×2.5 super vs imune.
 * `basico` = Investida (socão entre golpes): mesmo ×2.5 vale, mas o número é pequeno de propósito.
 */
function estiloDanoEf(ef, basico = false) {
  if (ef === 0) {
    return {
      tag: 'IMUNE',
      corTag: '#a8a8a8',
      corDano: '#888',
      tamDano: basico ? 11 : 13,
      tamTag: 10,
      tremor: 0.25,
      vy: -0.3,
      escala: 1,
      vida: 1.1,
    };
  }
  if (ef >= 2) {
    if (basico) {
      return {
        tag: `×${fmtMultEf(ef)} · socão`,
        corTag: '#8a9a70',
        corDano: '#c8ccb8',
        tamDano: 12,
        tamTag: 8,
        tremor: 0.45,
        vy: -0.42,
        escala: 1,
        vida: 0.85,
      };
    }
    return {
      tag: `×${fmtMultEf(ef)}`,
      corTag: ef >= 4 ? '#ffb347' : '#ffd166',
      corDano: '#fff4a8',
      tamDano: ef >= 4 ? 18 : 16,
      tamTag: 11,
      tremor: Math.min(1.6, 0.9 + ef * 0.15),
      vy: -0.62,
      escala: 1.35,
      vida: 1.15,
    };
  }
  if (ef < 1) {
    return {
      tag: basico ? `×${fmtMultEf(ef)} · socão` : `×${fmtMultEf(ef)}`,
      corTag: '#9fd3ff',
      corDano: '#c5e4ff',
      tamDano: basico ? 10 : 11,
      tamTag: basico ? 8 : 9,
      tremor: 0.35,
      vy: -0.38,
      escala: 1,
      vida: basico ? 0.85 : 0.95,
    };
  }
  return {
    tag: basico ? '×1 · socão' : '×1',
    corTag: '#b0b0b0',
    corDano: '#f0f0f0',
    tamDano: basico ? 11 : 13,
    tamTag: basico ? 8 : 9,
    tremor: basico ? 0.45 : 0.75,
    vy: -0.48,
    escala: basico ? 1 : 1.05,
    vida: basico ? 0.85 : 0.9,
  };
}

/** Quanto a bola leva voando até o alvo, antes de a folha de captura entrar. */
const MS_VOO_BOLA = 420;

/**
 * Zoom da cena, em pixels de tela por pixel de sprite.
 *
 * O cliente deles desenha com `ds = 2 × zoom`, ou seja, o padrão são tiles de 64 px na tela
 * (os 25×13 do preset). Desenhar a 32 px, como estava aqui, deixa a batalha longe demais —
 * num monitor largo davam 42 tiles de campo e os pokémon ficavam do tamanho de formiga.
 *
 * Os níveis são escalas inteiras (e a meia), que é o que mantém o pixel art nítido.
 */
const NIVEIS_ZOOM = [1, 1.5, 2, 3];
const ZOOM_PADRAO = 2;
/** Piso de tiles visíveis: impede que o zoom feche tanto a ponto de sumir o campo. */
const TILES_MIN = 9;

/** Quão rápido a câmera alcança o herói (fração por quadro a 60 Hz). */
const SUAVIDADE_CAMERA = 0.14;

/**
 * Cadência dos golpes de um pokémon em treino, em ms.
 *
 * Não tem nada a ver com o crédito do XP Share (que sai no abate, na hunt): um soco por abate
 * daria uma sala de
 * pokémon paralisados esperando o relógio. O que o servidor arbitra é o XP; o soco é desenho,
 * e desenho pode ser mais frequente do que a conta que ele ilustra.
 */
const MS_GOLPE_TREINO = 1100;

/** Largura da barra de XP que fica em cima de quem treina, em px de tela. */
const LARG_BARRA_TREINO = 40;

/** Quanto da diferença a barra de XP do treino cobre por quadro — é o que a faz SUBIR, e não pular. */
const SUAVIDADE_BARRA_TREINO = 0.08;

/** Quanto tempo o balão de fala fica no ar, na praça do Centro Pokémon. */
const MS_BALAO = 5000;
/** Largura máxima do balão, em px de TELA (ele é desenhado sem zoom, como as placas). */
const BALAO_LARG = 170;
/** Teto de linhas: o chat aceita 200 caracteres, e isso viraria uma parede em cima da cabeça. */
const BALAO_LINHAS = 3;

/**
 * Altura, em px de MUNDO, do ponto onde o botão de curar se pendura acima da enfermeira.
 *
 * O sprite de outfit tem o pé 11,52 px abaixo do centro da tile e 64 a 96 px de altura, então
 * a cabeça fica por volta de 36 px acima do topo da tile. 44 põe o botão logo acima dela em
 * qualquer zoom, porque a conta é em px de mundo e escala junto com o desenho.
 */
const ALTURA_BALCAO = 44;
/** Altura do botão de curar, em px de TELA. O balão da Joy sobe este degrau para não sumir atrás dele. */
const ALTURA_BOTAO_CURAR = 34;
/** Meia largura estimada do botão, só para ele não ser cortado ao encostar na borda lateral. */
const META_BOTAO_CURAR = 60;

/**
 * A faixa de cima da cena, em px de TELA — onde moram a etiqueta da área e a saída.
 *
 * Nada que flutue sobre o campo pode entrar aqui. No desktop a faixa é `top: 10` + 34 de
 * altura; no celular, `top: 7` + 38. 52 cobre as duas com folga.
 */
const ALTURA_TOPO_CENA = 52;

/** Altura do botão de escalação, no maior dos dois casos (38 no celular, 30 no desktop). */
const ALTURA_BOTAO_BONECO = 38;

export class Campo {
  /**
   * @param canvas onde desenhar
   * @param opcoes `chaveZoom`/`zoomPadrao`/`niveisZoom` — só o replay da Guerra de Guilds passa
   *               algo aqui (ver `ReplayGuerra`): uma chave de `localStorage` própria (para não
   *               reescrever o zoom da hunt ao vivo por cima) e um leque de zoom mais largo, já
   *               que a arena de guerra é bem maior que o palco de uma hunt normal.
   */
  constructor(canvas, { chaveZoom = 'zoom-campo', zoomPadrao = ZOOM_PADRAO, niveisZoom = NIVEIS_ZOOM } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width;
    this.H = canvas.height;
    this.chaveZoom = chaveZoom;
    this.niveisZoom = niveisZoom;
    this.zoom = Number(localStorage.getItem(chaveZoom)) || zoomPadrao;

    this.mapa = null;
    this.caixa = null;
    this.slug = null;
    this.carregando = null;
    this.aviso = null;

    this.heroi = null; // { cx, cy, deCx, deCy, dir, passoEm, passoMs, looktype, ... }
    this.treinador = null; // o treinador, que anda atrás do pokémon
    // Quem a CÂMERA segue quando não há herói. Só o replay da Guerra de Guilds usa: lá a cena
    // não é de ninguém em particular, e sem um alvo a câmera ficaria parada na origem do mapa
    // (`moverCamera` desiste sem ponto) e a batalha aconteceria fora do quadro.
    this.foco = null;
    /**
     * Desenha SÓ o andar do chão, ignorando a regra de cobertura. Exclusivo do replay.
     *
     * A regra herdada do cliente original só apaga o teto que está na DIAGONAL do herói (ver
     * `primeiroAndarVisivel`): num mapa de caverna, quem está na boca dela segue com o relevo
     * do andar de cima desenhado por cima. No jogo isso é bom — o jogador anda e entende a
     * geografia. No replay a câmera é de espectador e salta de briga em briga, e metade da
     * tela virava rocha cinza com a batalha acontecendo debaixo dela.
     */
    this.semTeto = false;
    /** Andar Z fixo — casas com escada (ver `casa-sala.mjs`). */
    this.andarFixo = null;
    this.enfermeira = null;
    this.tmResearcher = null; // NPC do TM Researcher — botão flutuante igual ao da Joy
    this.depotNpc = null;
    /** Bonecos da casa, indexados pelo posto de XP Share (0…cap−1). */
    this.bonecos = [];
    /** Quem treina em cada boneco, no MESMO índice — é o par `this.bonecos[i]` ↔ `this.petsTreino[i]`. */
    this.petsTreino = [];
    /** Progresso de XP por slot de treino, alimentado de fora (ver `atualizarTreinos`). */
    this.treinos = new Map();
    this.mobs = new Map(); // slot → entidade
    this.alvo = null;
    this.centro = false; // cena do Centro Pokémon (ninguém anda, tem botão de curar)

    this.cam = { x: 0, y: 0, iniciada: false };
    /**
     * Câmera LIVRE: enquanto verdadeiro, `moverCamera` não persegue mais o foco/herói — só o
     * arrasto do replay liga isto (ver `deslocarCamera`). Escolher um alvo de novo (`seguir`)
     * desliga sozinho, e a câmera desliza suave de volta para quem estava sendo seguido, porque
     * `cam.iniciada` continua `true` e o próximo `moverCamera` retoma o lerp de onde parou.
     */
    this.camLivre = false;
    this.flutuantes = [];
    this.efeitos = [];
    this.bolas = [];

    // Opacidade por andar. Entrar debaixo de um telhado (ou de uma caverna) apaga os andares
    // de cima; sair traz de volta. A transição é a deles: 180 ms de ponta a ponta.
    this.alfaAndar = new Map();
    this.primeiroVisivel = -Infinity;
    this.tileCobertura = '';
    this.ultimoQuadro = 0;

    // O tempo dos passos vem do relógio do SERVIDOR. Sem corrigir a diferença, um cliente
    // adiantado desenha todo mundo já no destino e a caminhada some.
    this.desvio = 0;
    this.temDesvio = false;

    // O canvas acompanha o tamanho do palco: a resolução interna é 1:1 com a tela (nada de
    // upscale borrado) e o zoom cai em telas estreitas para continuar mostrando mapa.
    this.redimensionar();
    this.observador = new ResizeObserver(() => this.redimensionar());
    this.observador.observe(canvas.parentElement ?? canvas);

    /** Modo Economia: a cena está desligada (ver `economia`). Só o campo do JOGO usa. */
    this.semCena = false;

    this.vivo = true;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  /**
   * Desliga a cena de vez: para o `requestAnimationFrame` e solta o observador de tamanho.
   *
   * O palco do jogo tem UM campo, vivo do login ao logout, e nunca precisou disto. O replay
   * da Guerra de Guilds tem outro, num canvas que nasce e morre com o modal — sem desligar, o
   * loop continuaria desenhando num canvas fora da tela a 60 Hz para sempre, e cada abertura
   * do modal somaria mais um.
   */
  destruir() {
    this.vivo = false;
    this.observador?.disconnect();
    this.observador = null;
    this.limpar();
  }

  /**
   * MODO ECONOMIA: a cena deixa de existir enquanto o jogo continua.
   *
   * Parar o `requestAnimationFrame` é metade — a outra é `limpar()`. O que pesa na memória não
   * é o laço: é o canvas de chão do mapa (a área inteira, desenhada uma vez) e as folhas de
   * sprite de cada espécie que apareceu na hunt, que vão se acumulando por horas. Parado e
   * cheio, o campo continuaria segurando tudo isso à espera de um quadro que não vem.
   *
   * Quem religa manda o servidor reenviar o `campo.init` (ver `cliente.economia` no sim): o
   * delta seguinte só traria quem se mexeu, e a cena voltaria vazia.
   */
  economia(ligado) {
    if (!!this.semCena === !!ligado) return;
    this.semCena = !!ligado;
    if (ligado) {
      this.vivo = false; // o laço sai no próximo quadro
      this.limpar();
      // `limpar()` só solta a REFERÊNCIA daqui; o canvas de chão continua vivo no cache de
      // `mapa.mjs`, que guarda dois deles. É esse cache que pesa — daí soltá-lo também.
      soltarMapas();
      return;
    }
    this.vivo = true;
    requestAnimationFrame(this.loop);
  }

  /** A entidade que a câmera segue no replay (por slot). `null` volta ao herói. */
  seguir(slot) {
    this.foco = slot == null ? null : this.mobs.get(slot) ?? null;
    // Escolher um alvo — automático ou por clique — é sempre a intenção de VOLTAR a acompanhar
    // alguém, então cancela a câmera livre (ver `deslocarCamera`) se ela estivesse solta.
    this.camLivre = false;
    return this.foco;
  }

  redimensionar() {
    const larg = Math.max(320, Math.round(this.cv.clientWidth || this.cv.width));
    const alt = Math.max(200, Math.round(this.cv.clientHeight || this.cv.height));
    this.zoom = this.limitarZoom(this.zoom, larg);
    if (this.cv.width === larg && this.cv.height === alt) return;
    this.cv.width = larg;
    this.cv.height = alt;
    this.W = larg;
    this.H = alt;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Num palco estreito, os níveis mais fechados sumiriam com o campo: derruba para o que cabe. */
  limitarZoom(z, larg = this.W) {
    const teto = larg / (TILE * TILES_MIN);
    const cabem = this.niveisZoom.filter((n) => n <= teto);
    if (!cabem.length) return this.niveisZoom[0];
    return Math.min(z, cabem[cabem.length - 1]);
  }

  /** Um degrau de zoom para dentro (+1) ou para fora (−1). Fica gravado entre sessões. */
  mudarZoom(passo) {
    const cabem = this.niveisZoom.filter((n) => n <= this.W / (TILE * TILES_MIN));
    const niveis = cabem.length ? cabem : [this.niveisZoom[0]];
    const i = niveis.indexOf(this.zoom);
    const atual = i >= 0 ? i : niveis.findIndex((n) => n >= this.zoom);
    this.zoom = niveis[Math.max(0, Math.min(niveis.length - 1, (atual < 0 ? niveis.length - 1 : atual) + passo))];
    localStorage.setItem(this.chaveZoom, String(this.zoom));
    return this.zoom;
  }

  get podeAproximar() {
    return this.zoom < this.limitarZoom(this.niveisZoom[this.niveisZoom.length - 1]);
  }

  get podeAfastar() {
    return this.zoom > this.niveisZoom[0];
  }

  get agora() {
    return performance.timeOrigin + performance.now() - this.desvio;
  }

  /** Sincroniza com o relógio do servidor (média móvel, igual à do cliente deles). */
  sincronizar(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return;
    const d = Date.now() - ts;
    if (!this.temDesvio || Math.abs(d - this.desvio) > 2000) {
      this.desvio = d;
      this.temDesvio = true;
    } else {
      this.desvio = 0.85 * this.desvio + 0.15 * d;
    }
  }

  // ------------------------------------------------------------- conteúdo

  /** Entrou numa hunt: carrega o mapa e recomeça o campo. */
  async iniciar(m) {
    if (this.semCena) return; // Modo Economia: nem baixa o mapa
    this.slug = m.slug;
    // O mapa de tiles nem sempre se chama como a área: as hunts nossas herdam a geografia
    // de uma hunt-fonte, então o slug é o delas mas o arquivo a baixar é o da fonte.
    this.mapaSlug = m.mapa ?? m.slug;
    this.centro = !!m.centro;
    this.caixa = { minTx: m.box[0], minTy: m.box[1], cols: m.box[2], rows: m.box[3], groundZ: m.groundZ };
    this.mapa = null;
    // Herói e treinador começam do zero a cada cena.
    //
    // Os dois são reconstruídos pelo `aplicar(m)` logo abaixo, com o que o pacote trouxer.
    // Zerar importa porque QUEM É o herói muda de cena para cena: na hunt é o pokémon, na
    // praça do Centro é o boneco do jogador. Sem isto, o nível do pokémon ficava colado no
    // treinador ("Fulano Nv 5", que é o nível do Charmander) e o boneco da hunt anterior
    // continuava desenhado na praça, parado na coordenada em que estava — um clone mudo do
    // jogador, a vinte tiles dele.
    this.heroi = null;
    this.treinador = null;
    this.foco = null;
    this.enfermeira = null;
    this.tmResearcher = null;
    this.depotNpc = null;
    this.bonecos = [];
    this.petsTreino = [];
    this.treinos.clear();
    this.mobs.clear();
    this.cam.iniciada = false;
    this.vista = null;
    this.flutuantes.length = 0;
    this.efeitos.length = 0;
    this.bolas.length = 0;
    this.alfaAndar.clear();
    this.primeiroVisivel = -Infinity;
    this.tileCobertura = '';
    this.andarFixo = m.casa != null ? (m.andar ?? m.groundZ ?? this.caixa?.groundZ ?? null) : null;

    this.aplicar(m);

    const pedido = (this.carregando = m.slug);
    try {
      const mapa = await prepararMapa(this.mapaSlug, this.caixa, (txt) => {
        if (this.carregando === pedido) this.aviso = txt;
      });
      if (this.carregando !== pedido) return; // trocou de hunt no meio do caminho
      this.mapa = mapa;
      this.aviso = null;
    } catch (err) {
      if (this.carregando === pedido) this.aviso = `mapa indisponível: ${err.message}`;
    }
  }

  /** Aplica um pacote do servidor — o inicial (completo) ou um delta. */
  aplicar(m) {
    if (this.semCena) return;
    if (m.ts) this.sincronizar(m.ts);
    if (m.andar != null) this.andarFixo = m.andar;
    if (m.heroi) {
      this.heroi ??= {};
      this.mesclar(this.heroi, m.heroi);
    }
    if (m.treinador) {
      this.treinador ??= {};
      this.mesclar(this.treinador, m.treinador);
    }
    for (const bruto of m.mobs ?? []) {
      let e = this.mobs.get(bruto.s);
      if (!e) this.mobs.set(bruto.s, (e = { slot: bruto.s }));
      const eraMorto = e.morto;
      this.mesclar(e, bruto);
      if (e.morto && !eraMorto) e.morreuEm = this.agora;
    }
    for (const slot of m.fora ?? []) {
      const e = this.mobs.get(slot);
      if (e?.ehBoneco && e.bonecoIndice != null) this.bonecos[e.bonecoIndice] = undefined;
      // Tirar um pokémon do treino apaga a entidade dele: sem soltar o índice, a barra de XP
      // e os socos continuariam mirando um fantasma.
      if (e?.emTreino && e.treinoSlot != null) this.petsTreino[e.treinoSlot] = undefined;
      if (e?.ehEnfermeira) this.enfermeira = null;
      if (e?.ehTmResearcher) this.tmResearcher = null;
      if (e?.ehDepotNpc) this.depotNpc = null;
      this.mobs.delete(slot);
    }
    // O delta nem sempre reenvia `cura`/`tm`; reancora pelos flags já gravados na entidade.
    if (this.centro) {
      for (const e of this.mobs.values()) {
        if (e.ehEnfermeira) this.enfermeira = e;
        if (e.ehTmResearcher) this.tmResearcher = e;
        if (e.ehDepotNpc) this.depotNpc = e;
      }
    }
    if (m.alvo !== undefined) this.alvo = m.alvo;
  }

  /**
   * Copia o pacote do servidor para dentro da entidade que JÁ existe.
   *
   * Tem que ser mutação, não um objeto novo: o sprite carrega em background e o callback
   * precisa achar a mesma entidade que o loop de desenho está lendo.
   */
  mesclar(e, b) {
    // A POSIÇÃO é opcional. Todo pacote de campo ao vivo traz `c`/`r` (é o que `serializarMob`
    // monta), mas o replay da Guerra de Guilds manda dano sem tocar no passo em andamento —
    // e sem esta guarda um pacote só de HP escreveria `cx = undefined` e sumiria com o boneco.
    if (b.c !== undefined) {
      const em = b.em ?? 0;
      const deCx = b.dc ?? b.c;
      const deCy = b.dr ?? b.r;
      // Um passo NOVO que começa no futuro e sai de onde o atual termina: é a bicicleta na praça,
      // que manda o próximo passo antes de o atual acabar na tela (ver `passoNoRitmo`, em
      // `server/game/centro.mjs`). O atual fica em `anterior`, e é ele que `pos()` desenha até a
      // hora do novo — sem isso o boneco pularia para o fim do passo em curso. Pacote do MESMO
      // passo (virar de frente, parar) não mexe no que está guardado.
      if (em !== e.passoEm || b.c !== e.cx || b.r !== e.cy) {
        e.anterior = em > this.agora && deCx === e.cx && deCy === e.cy && this.agora < e.passoEm + e.passoMs
          ? { cx: e.cx, cy: e.cy, deCx: e.deCx, deCy: e.deCy, passoEm: e.passoEm, passoMs: e.passoMs }
          : null;
      }
      e.cx = b.c;
      e.cy = b.r;
      e.deCx = deCx;
      e.deCy = deCy;
      e.dir = b.d ?? e.dir ?? 3;
      e.passoEm = em;
      e.passoMs = b.ms ?? 300;
    }
    if (b.hp !== undefined) e.hp = b.hp;
    if (b.mhp !== undefined) e.maxHp = b.mhp;
    if (b.n !== undefined) e.nome = b.n;
    if (b.nv !== undefined) e.level = b.nv;
    if (b.sh !== undefined) e.shiny = !!b.sh;
    if (b.x !== undefined) e.morto = !!b.x;
    // PvP: `tr` marca o boneco de um treinador (desenha sem barra de HP) e `elo` é o número
    // que vai escrito embaixo dele. Fora da arena nenhum dos dois vem no pacote.
    if (b.tr !== undefined) e.ehTreinador = !!b.tr;
    if (b.elo !== undefined) e.elo = b.elo;
    // BONECO do posto de XP Share. `tn` é a FATIA em pontos percentuais (null = posto vazio),
    // e é dela que sai a placa "XP Share 60%". O texto é montado no CLIENTE, e não no
    // servidor, porque é a única forma de ele sair traduzido — o servidor manda o número.
    if (b.bn !== undefined) e.ehBoneco = !!b.bn;
    if (b.tn !== undefined) e.pctShare = b.tn;
    if (b.bi !== undefined) e.bonecoIndice = b.bi;
    if (e.ehBoneco && e.bonecoIndice != null) this.bonecos[e.bonecoIndice] = e;
    // O outro lado: `ti` é o pokémon REGISTRADO e o posto em que ele está. É a chave de tudo
    // o que a casa desenha em cima dele — a barra de XP e o "+120 XP" do crédito.
    if (b.ti !== undefined) {
      e.emTreino = true;
      e.treinoSlot = b.ti;
      this.petsTreino[b.ti] = e;
    }
    // A enfermeira da praça. Guardada à parte porque duas coisas precisam achá-la a cada
    // quadro: o botão de curar, que flutua em cima dela, e a fala dela.
    if (b.cura) {
      e.ehEnfermeira = true;
      this.enfermeira = e;
    }
    if (b.tm) {
      e.ehTmResearcher = true;
      this.tmResearcher = e;
    }
    if (b.depot) {
      e.ehDepotNpc = true;
      this.depotNpc = e;
    }
    // `xr` é o que sobra de chão para o corpo, em ms. Quem entra na hunt no meio recebe
    // corpos já pela metade, então a hora de apagar tem que vir do servidor.
    if (b.xr !== undefined) e.expiraEm = this.agora + b.xr;
    // `vs` são as cores do outfit deste treinador (ver `cores-outfit.mjs`). Vem ANTES do `lt` de
    // propósito: os dois entram no mesmo pacote, e trocar o looktype primeiro montaria o
    // sprite com as cores velhas e jogaria o certo fora no `spriteDe ===` de baixo.
    if (b.vs !== undefined) e.visual = b.vs;
    if (b.lt !== undefined || b.vs !== undefined) {
      if (b.lt !== undefined) e.looktype = b.lt;
      this.garantirSprite(e);
    }
  }

  garantirSprite(e) {
    // A chave é looktype + visual: dois treinadores com o MESMO outfit e cores diferentes são
    // sprites diferentes, e sem o visual na chave o segundo herdava as cores do primeiro.
    const chave = `${e.looktype}|${e.visual?.join(',') ?? ''}`;
    if (e.spriteDe === chave) return;
    e.spriteDe = chave;
    e.sprite = null;
    carregarOutfit(e.looktype, e.visual).then((s) => {
      if (e.spriteDe !== chave) return;
      // Não carregou: SOLTA a chave. Sem isto, `spriteDe` continuava marcado e o `return` lá
      // em cima impedia qualquer nova tentativa — a entidade ficava invisível para sempre,
      // com placa e barra de HP no lugar. Agora o próximo pacote daquele mob tenta de novo.
      if (!s) return void (e.spriteDe = null);
      e.sprite = s;
    });
  }

  /** O pokémon do jogador em campo — o herói herda o looktype dele. */
  definirHeroi(dados) {
    this.heroi ??= { cx: 0, cy: 0, deCx: 0, deCy: 0, dir: 3, passoEm: 0, passoMs: 300 };
    Object.assign(this.heroi, dados);
    this.garantirSprite(this.heroi);
  }

  limpar() {
    this.slug = null;
    this.mapa = null;
    this.caixa = null;
    this.bonecos = [];
    this.petsTreino = [];
    this.treinos.clear();
    this.mobs.clear();
    this.foco = null;
    this.carregando = null;
    // Efeitos, números de dano e bolas no ar: quem os apaga é o laço, quadro a quadro, quando
    // a vida deles acaba. Sem laço (Modo Economia, replay fechado) eles ficariam para sempre.
    this.flutuantes.length = 0;
    this.efeitos.length = 0;
    this.bolas.length = 0;
  }

  // ------------------------------------------------------- posição na tela

  /** Posição interpolada, em tiles fracionários. */
  pos(e) {
    if (!e) return null;
    const agora = this.agora;
    // O passo guardado em `mesclar` vale até a hora do novo.
    const p = e.anterior && agora < e.passoEm ? e.anterior : e;
    const t = p.passoMs > 0 ? Math.min(1, Math.max(0, (agora - p.passoEm) / p.passoMs)) : 1;
    return {
      tx: this.caixa.minTx + p.deCx + (p.cx - p.deCx) * t,
      ty: this.caixa.minTy + p.deCy + (p.cy - p.deCy) * t,
      fase: t,
      andando: t < 1 || p !== e,
    };
  }

  // -------------------------------------------------------------- eventos

  /**
   * Investida do atacante + efeito no alvo + número de dano, na HUNT e na arena PvP.
   *
   * `por` diz de que lado veio a pancada, e é ele que decide quem dos dois é o herói:
   *
   *   jogador · pvp          EU bati — o atacante é o herói e `slot` é o ALVO
   *   selvagem · pvpInimigo  eu levei — `slot` é quem BATEU e o alvo sou eu
   *
   * O `pvp` caía no segundo grupo por não estar escrito aqui, e o resultado era o golpe
   * do jogador saindo ao contrário na arena: o pulinho no oponente, e o número de dano
   * com o efeito de tipo subindo em cima do próprio pokémon dele.
   */
  async golpe({ por, tipo, dano, ef, stab, slot, golpe: nomeGolpe }) {
    if (this.semCena || otimizadoLigado()) return;
    const meu = por === 'jogador' || por === 'pvp';
    return this.desenharGolpe({
      atacante: meu ? this.heroi : this.mobs.get(slot),
      alvo: meu ? this.mobs.get(slot) : this.heroi,
      tipo,
      dano,
      ef,
      stab,
      golpe: nomeGolpe,
    });
  }

  /**
   * O mesmo golpe, entre dois MOBS identificados por slot — é o que o replay usa.
   *
   * Na hunt e na arena um dos dois lados é sempre o herói, e por isso `golpe()` só precisa
   * saber "de que lado veio". Na Guerra de Guilds (e no duelo de ginásio) quem assiste não
   * está em campo: os 70 lutadores são todos mobs, e a pancada precisa nomear os dois.
   */
  async golpeEntreSlots({ de, para, tipo, dano, ef, stab, golpe: nomeGolpe }) {
    if (this.semCena || otimizadoLigado()) return;
    return this.desenharGolpe({
      atacante: this.mobs.get(de),
      alvo: this.mobs.get(para),
      tipo,
      dano,
      ef,
      stab,
      golpe: nomeGolpe,
    });
  }

  /**
   * O desenho em si, com as duas entidades já resolvidas.
   *
   * Aqui não há mais "eu" e "ele": só quem bate e quem apanha. É o que deixa a hunt, a
   * arena e o replay saírem do MESMO código — o vocabulário do golpe é o mesmo nos três,
   * e a única coisa que mudava entre eles era como achar as duas entidades.
   */
  async desenharGolpe({ atacante, alvo, tipo, dano, ef, stab, golpe: nomeGolpe }) {
    if (atacante && alvo) {
      const a = this.pos(atacante);
      const b = this.pos(alvo);
      if (a && b) {
        atacante.investida = 1;
        atacante.investidaDir = [Math.sign(b.tx - a.tx), Math.sign(b.ty - a.ty)];
      }
    }

    const p = this.pos(alvo);
    if (!p) return;
    const px = p.tx * TILE + TILE / 2;
    const py = p.ty * TILE;

    // RECORTE POR CÂMERA — e é aqui, na FONTE, e não na hora de desenhar.
    //
    // O que uma pancada fora da tela produz não é um desenho a mais: são três ou quatro
    // textos flutuantes (`fillText` com sombra, a coisa mais cara deste arquivo) vivendo um
    // segundo cada, mais um sprite de efeito, mais o PNG dele indo para a fila de download.
    // Nada disso o espectador consegue ler, porque acontece fora do quadro.
    //
    // Numa hunt isso nunca corta nada: o herói está no meio da tela e o selvagem, encostado
    // nele. Quem cobra a conta é o replay da guerra — 80 golpes num quadro de 250 ms, e no
    // 8× uns 840 efeitos vivos ao mesmo tempo espalhados por uma arena que não cabe na tela.
    if (!this.naVista(px, py)) return;

    const basico = !nomeGolpe || nomeGolpe === 'Investida';
    const est = estiloDanoEf(ef ?? 1, basico);
    if (alvo) alvo.tremor = est.tremor;

    this.flutuantes.push({
      txt: `-${dano}`,
      x: px,
      y: py - (basico ? 22 : 26),
      vy: est.vy,
      vida: est.vida,
      cor: est.corDano,
      tam: est.tamDano,
      escala: est.escala,
    });
    this.flutuantes.push({
      txt: est.tag,
      x: px,
      y: py - (basico ? 8 : 10),
      vy: est.vy * 0.85,
      vida: est.vida * 0.92,
      cor: est.corTag,
      tam: est.tamTag,
      escala: est.escala > 1 ? est.escala * 0.92 : 1,
    });
    if (!basico && nomeGolpe) {
      this.flutuantes.push({
        txt: nomeGolpe,
        x: px,
        y: py + 4,
        vy: est.vy * 0.7,
        vida: est.vida * 0.88,
        cor: est.corTag,
        tam: 9,
        escala: 1,
      });
    }
    if (stab && !basico) {
      this.flutuantes.push({
        txt: 'STAB',
        x: px + 22,
        y: py - 42,
        vy: -0.32,
        vida: 0.85,
        cor: '#c8ffdd',
        tam: 9,
        escala: 1,
      });
    }

    const ehTm = String(nomeGolpe ?? '').startsWith('TM ');
    const fx = ehTm ? await efeitoTmElemental(tipo) : await efeitoDoTipo(tipo);
    if (fx) this.efeitos.push({ fx, x: px, y: py + 4, t0: performance.now() });
  }

  // ------------------------------------------------------- XP Share (a casa)
  //
  // Três coisas acontecem em cima de quem está registrado, e cada uma vem de uma fonte
  // diferente:
  //
  //   a BARRA de XP    do snapshot, por `atualizarTreinos` — o app já tem `xp`/`xpProximo` de
  //                    cada pokémon e não faria sentido o servidor repetir isso no pacote da casa
  //   o "+120 XP"      do evento `xpshare`, por `treinoXp` — é o instante exato do crédito
  //   o SOCO           daqui de dentro, de graça: é enfeite, e enfeite não pede pacote
  //
  // Na prática o "+XP" e o soco quase nunca aparecem: a fatia é creditada no abate, e quem
  // está abatendo está na HUNT, não em casa. Ficam porque a casa continua sendo a janela — e
  // porque a barra de XP, essa sim, anda toda vez que o jogador abre a porta.
  //
  // O que amarra as três é o POSTO: `ti` no pacote da casa, `slot` no evento e o índice da
  // lista que o app manda. Boneco, pokémon e barra usam o mesmo número.

  /**
   * O progresso de XP de cada treino, do snapshot.
   *
   * A cena não sabe o que é um pokémon do jogador: quem cruza os postos com a lista de
   * pokémon é o app, e o que chega aqui é `{ slot, id, frac, tipo }` — a fatia já preenchida
   * do nível (0…1) e o elemento que sai na animação do golpe.
   */
  atualizarTreinos(lista) {
    const vistos = new Set();
    for (const { slot, id, frac, tipo } of lista ?? []) {
      vistos.add(slot);
      const atual = this.treinos.get(slot);
      // Entra CHEIA no valor certo em duas situações: ao ver o slot pela primeira vez (entrar
      // na casa não é a barra correndo do zero até onde ela já estava) e ao trocar de pokémon
      // no boneco (um nível 3 quase cheio no lugar de um nível 90 no começo faria a barra
      // deslizar por segundos contando um progresso que não aconteceu).
      if (!atual || atual.id !== id) {
        this.treinos.set(slot, { id, frac, vista: frac, tipo });
        continue;
      }
      atual.frac = frac;
      atual.tipo = tipo;
    }
    for (const slot of [...this.treinos.keys()]) if (!vistos.has(slot)) this.treinos.delete(slot);
  }

  /**
   * O XP que o XP Share acabou de creditar, subindo em cima do pokémon.
   *
   * Verde, e não o amarelo do dano: é ganho, não é apanhar. Se o slot não estiver na cena (o
   * jogador está caçando na Outland, que é o normal — o treino corre de qualquer jeito), isto
   * simplesmente não faz nada.
   */
  treinoXp(slot, xp) {
    const pet = this.petsTreino[slot];
    const p = pet && this.pos(pet);
    if (!p || !(xp > 0)) return;
    const boneco = this.bonecos[slot];
    if (boneco) this.golpeDeTreino(pet, boneco);
    this.flutuantes.push({
      txt: `+${xp} XP`,
      x: p.tx * TILE + TILE / 2,
      // Acima da barra E do nome. A barra fica a 14 px de mundo do pé do sprite e o nome logo
      // em cima dela, mas o nome é desenhado SEM zoom: nascer a 34 px de mundo é o que mantém
      // o número livre dos dois no zoom mais fechado, em que a distância de mundo encolhe.
      y: p.ty * TILE - 34,
      vy: -0.42,
      vida: 1.3,
      cor: '#8ef0a8',
      tam: 13,
      escala: 1.25,
    });
  }

  /**
   * Um soco no boneco: a investida do pokémon, o tremor do saco e o efeito do tipo dele.
   *
   * É o mesmo vocabulário do `golpe()` da hunt, sem número de dano — no boneco não há vida
   * para tirar, e um "-42" em cima dele contaria uma batalha que não existe.
   */
  golpeDeTreino(pet, boneco) {
    const a = this.pos(pet);
    const b = this.pos(boneco);
    if (!a || !b) return;
    pet.investida = 1;
    pet.investidaDir = [Math.sign(b.tx - a.tx), Math.sign(b.ty - a.ty)];
    boneco.tremor = 0.5;

    if (otimizadoLigado()) return;
    const tipo = this.treinos.get(pet.treinoSlot)?.tipo;
    if (!tipo) return;
    const x = b.tx * TILE + TILE / 2;
    const y = b.ty * TILE + 4;
    efeitoDoTipo(tipo).then((fx) => {
      if (fx) this.efeitos.push({ fx, x, y, t0: performance.now() });
    });
  }

  /**
   * Um quadro do treino: quem está na hora de bater bate, e a barra de XP anda para o alvo.
   *
   * O relógio de cada golpe é local e sorteado (`MS_GOLPE_TREINO` ± um terço) de propósito:
   * na casa Lendária são dois pokémon batendo, e cadência igual para os dois vira coreografia
   * — dois socos no mesmo quadro, duas pausas no seguinte.
   */
  animarTreinos(agora) {
    for (const treino of this.treinos.values()) {
      // Subiu de nível: a fatia despenca de 0,98 para 0,02, e interpolar isso desenharia a
      // barra ESVAZIANDO devagar — exatamente o contrário do que acabou de acontecer.
      if (treino.frac < treino.vista) treino.vista = treino.frac;
      else treino.vista += (treino.frac - treino.vista) * SUAVIDADE_BARRA_TREINO;
    }
    for (let i = 0; i < this.petsTreino.length; i++) {
      const pet = this.petsTreino[i];
      const boneco = this.bonecos[i];
      if (!pet || !boneco) continue;
      pet.proxGolpe ??= agora + Math.random() * MS_GOLPE_TREINO;
      if (agora < pet.proxGolpe) continue;
      pet.proxGolpe = agora + MS_GOLPE_TREINO * (0.7 + Math.random() * 0.6);
      this.golpeDeTreino(pet, boneco);
    }
  }

  /**
   * Os derrotados que ainda estão no chão, do mais recente para o mais antigo.
   *
   * É o que alimenta o painel de captura do palco: enquanto o corpo está aqui, dá para
   * arremessar bola nele. `resta` é em ms, para a barrinha de tempo.
   */
  corpos() {
    const lista = [];
    for (const e of this.mobs.values()) {
      if (!e.morto) continue;
      const resta = (e.expiraEm ?? 0) - this.agora;
      if (resta <= 0) continue;
      lista.push({ slot: e.slot, nome: e.nome, level: e.level, looktype: e.looktype, shiny: e.shiny, resta });
    }
    return lista.sort((a, b) => b.resta - a.resta);
  }

  /**
   * Arremesso de pokébola, com as folhas originais do jogo.
   *
   * A posição do alvo é fixada AGORA porque o servidor tira o pokémon do mapa no mesmo
   * tick — a animação continua rodando no lugar onde ele estava.
   */
  bola(sucesso, slot, ballId = 1) {
    if (this.semCena) return;
    const de = this.pos(this.heroi);
    const para = this.pos(this.mobs.get(slot));
    if (!de || !para) return;

    const arremesso = {
      t0: performance.now(),
      sucesso,
      x0: de.tx * TILE + TILE / 2,
      y0: de.ty * TILE,
      x1: para.tx * TILE + TILE / 2,
      y1: para.ty * TILE,
      folhas: null,
    };
    this.bolas.push(arremesso);
    folhasDaBola(ballId).then((f) => (arremesso.folhas = f));
  }

  /**
   * O balão de fala em cima do boneco de quem escreveu no chat.
   *
   * Não existe mensagem de servidor para isto, e é de propósito: o chat JÁ chega a todo mundo
   * (um fan-out só, por Redis) e a praça já diz o nick de cada boneco. Ligar as duas coisas é
   * uma busca por nome aqui dentro — mandar um segundo pacote com o mesmo texto seria pagar
   * duas vezes pela mesma frase.
   *
   * @returns true se havia alguém na cena com aquele nick
   */
  balao(nick, texto) {
    if (!this.centro || !nick || !texto) return false;
    const alvo =
      this.heroi?.nome === nick
        ? this.heroi
        : [...this.mobs.values()].find((e) => e.ehTreinador && e.nome === nick);
    return this.falar(alvo, texto);
  }

  /** A Enfermeira Joy falando — as respostas dela ao botão de curar. */
  falarEnfermeira(texto) {
    return this.falar(this.enfermeira, texto);
  }

  falar(alvo, texto) {
    if (!this.centro || !alvo || !texto) return false;
    // `linhas` fica nulo: quebrar o texto precisa medir a fonte, e quem tem o contexto do
    // canvas é o loop de desenho. Ele mede uma vez e guarda aqui.
    alvo.balao = { txt: texto, linhas: null, ate: performance.now() + MS_BALAO };
    return true;
  }

  /**
   * Onde a enfermeira está NA TELA, em px do canvas — ou null se ela estiver fora dele.
   *
   * É por aqui que o botão de curar, que é um elemento de DOM, gruda na cabeça dela. O botão
   * não é desenhado no canvas de propósito: assim ele é o mesmo botão roxo do resto do jogo,
   * com o mesmo hover, o mesmo toque e o mesmo foco de teclado — nada disso sai de graça num
   * retângulo pintado à mão.
   */
  telaDaEnfermeira() {
    return this.telaDoNpc(this.enfermeira);
  }

  /** Onde o TM Researcher está na tela — o botão de TM gruda nele. */
  telaDoTmResearcher() {
    return this.telaDoNpc(this.tmResearcher);
  }

  telaDoDepot() {
    return this.telaDoNpc(this.depotNpc);
  }

  /**
   * Onde o botão de escalação daquele boneco se pendura — ACIMA da placa dele, não da cabeça.
   *
   * O degrau tem de escalar com o ZOOM, e é aí que estava o defeito. A placa "Treinamento nvl
   * X" é desenhada 14 px de MUNDO acima da tile, o que dá 28 px de tela no zoom 2 do desktop e
   * só 14 no zoom 1 — o único que cabe num telefone. Um recuo fixo de 10 px cobria a placa
   * inteira no celular: o jogador via o botão e não via o nível que o botão vai definir.
   *
   * `14 * zoom` acompanha a placa e os 16 px são a altura do texto dela mais uma folga, que é
   * de TELA porque as placas são desenhadas sem zoom.
   */
  telaDoBoneco(i) {
    const p = this.telaDoNpc(this.bonecos[i]);
    if (!p) return null;
    const y = p.y - 14 * this.zoom - 16;
    // Boneco colado no alto do quadro: o botão cairia em cima da etiqueta da cena (à esquerda)
    // ou do "Sair de casa" (à direita). Ele SOME, como já some quando o boneco sai do quadro —
    // um passo do jogador e ele volta. Empilhado sobre a etiqueta, esconderia as duas coisas e
    // roubaria o toque de uma delas.
    //
    // `y` é a BASE do botão (o CSS o ancora por `translate(-50%, -100%)`), então quem tem de
    // ficar abaixo da faixa é `y − altura`, e não `y`.
    if (y - ALTURA_BOTAO_BONECO < ALTURA_TOPO_CENA) return null;
    p.y = y;
    return p;
  }

  telaDoNpc(e) {
    if (!this.centro || !this.caixa || !this.mapa || !e) return null;
    const p = this.pos(e);
    if (!p) return null;
    const escala = this.zoom;
    const camX = this.cam.x - this.W / escala / 2;
    const camY = this.cam.y - this.H / escala / 2;
    // Só a Joy fica atrás do balcão — o degrau extra alinha o botão na cabeça dela.
    const degrauY = e.ehEnfermeira ? ALTURA_BALCAO : 0;
    const x = (p.tx * TILE + TILE / 2 - camX) * escala;
    const y = (p.ty * TILE - degrauY - camY) * escala;
    if (x < -100 || x > this.W + 100 || y < -60 || y > this.H + 60) return null;
    return {
      x: Math.max(META_BOTAO_CURAR, Math.min(this.W - META_BOTAO_CURAR, x)),
      y: Math.max(ALTURA_BOTAO_CURAR + 6, Math.min(this.H - 6, y)),
    };
  }

  texto(txt, cor = '#ffcf5c') {
    if (this.semCena) return;
    const p = this.pos(this.heroi);
    this.flutuantes.push({
      txt,
      x: p ? p.tx * TILE + TILE / 2 : 0,
      y: p ? p.ty * TILE - 34 : 0,
      vy: -0.28,
      vida: 1.4,
      cor,
      tam: 14,
      naTela: !p,
    });
  }

  // ----------------------------------------------------------------- loop

  /**
   * Opacidade de cada andar, com fade.
   *
   * O herói entrou debaixo de um telhado? Os andares acima dele apagam. Numa caverna
   * (Geodude, Zubat) ou na pirâmide do Abra a área andável inteira é coberta — sem isto o
   * andar de cima é desenhado por último e o mapa vira uma laje cinza sem pokémon nenhum.
   */
  atualizarAndares(heroi, dt) {
    const chave = heroi ? `${Math.round(heroi.tx)},${Math.round(heroi.ty)}` : '';
    if (this.andarFixo != null) {
      this.primeiroVisivel = this.andarFixo;
    } else if (this.semTeto) {
      this.primeiroVisivel = this.mapa.groundZ;
    } else if (chave && chave !== this.tileCobertura) {
      this.tileCobertura = chave;
      this.primeiroVisivel = this.mapa.primeiroAndarVisivel(Math.round(heroi.tx), Math.round(heroi.ty));
    }
    const passo = dt / 180;
    for (let z = this.mapa.minZ; z <= this.mapa.groundZ; z++) {
      const destino = z >= this.primeiroVisivel ? 1 : 0;
      const atual = this.alfaAndar.get(z) ?? destino;
      if (atual === destino) {
        this.alfaAndar.set(z, destino);
        continue;
      }
      this.alfaAndar.set(z, destino > atual ? Math.min(1, atual + passo) : Math.max(0, atual - passo));
    }
  }

  loop(agora) {
    if (!this.vivo) return;
    requestAnimationFrame(this.loop);
    this.quadro(agora);
  }

  /**
   * UM quadro, sem agendar o próximo.
   *
   * Existe separado do `loop` por causa do PiP do Android: com a aba escondida atrás de outro
   * aplicativo o navegador PARA o `requestAnimationFrame`, e a janelinha flutuante congelaria
   * na última imagem. O `popup.mjs` chama este método por um relógio enquanto está lá fora —
   * chamar o `loop` no lugar dele agendaria um `rAF` a cada tique, e todos eles disparariam
   * juntos ao voltar para o jogo, multiplicando o laço.
   */
  quadro(agora) {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    const dt = Math.min(100, agora - (this.ultimoQuadro || agora));
    this.ultimoQuadro = agora;

    if (!this.mapa || !this.caixa) {
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.fillStyle = '#7d8894';
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(this.aviso ?? t(this.slug ? 'cena.carregandoMapa' : 'cena.escolhaAreaMapa'), this.W / 2, this.H / 2);
      return;
    }

    if (this.treinos.size) this.animarTreinos(agora);

    const heroi = this.pos(this.heroi);
    // No replay não existe herói: quem manda na câmera (e em qual andar do mapa fica visível)
    // é o lutador escolhido para acompanhar. Com a câmera livre (arrasto do replay), ninguém
    // manda — `moverCamera(null)` não mexe em `cam.x/y`, que já foi posicionado pelo arrasto.
    const olho = this.camLivre ? null : (this.foco && this.pos(this.foco)) || heroi;
    this.moverCamera(olho);
    this.atualizarAndares(olho, dt);

    const escala = this.zoom;
    const largVista = this.W / escala;
    const altVista = this.H / escala;
    const camX = this.cam.x - largVista / 2;
    const camY = this.cam.y - altVista / 2;

    // A janela que a câmera enxerga NESTE quadro, guardada para quem precisa dela fora do
    // laço de desenho — hoje o `desenharGolpe`, que é disparado por evento e não por quadro.
    this.vista = { x0: camX, y0: camY, x1: camX + largVista, y1: camY + altVista };

    ctx.setTransform(escala, 0, 0, escala, -camX * escala, -camY * escala);

    // fundo: andares de baixo + banda de chão, num blit só (recortado no que a câmera vê)
    ctx.fillStyle = '#05070a';
    ctx.fillRect(camX, camY, largVista, altVista);
    const m = this.mapa;
    const sx = Math.max(0, Math.floor(camX - m.ox));
    const sy = Math.max(0, Math.floor(camY - m.oy));
    const sw = Math.min(m.larg - sx, Math.ceil(largVista) + 2);
    const sh = Math.min(m.alt - sy, Math.ceil(altVista) + 2);
    if (sw > 0 && sh > 0) ctx.drawImage(m.chao, sx, sy, sw, sh, m.ox + sx, m.oy + sy, sw, sh);

    this.desenharCena(camX, camY, largVista, altVista, heroi);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.desenharPlacas(camX, camY, escala, heroi);
    this.desenharBaloes(camX, camY, escala, heroi);
    this.desenharFlutuantes(camX, camY, escala);
  }

  /**
   * Este ponto do mundo cabe no que a câmera está mostrando?
   *
   * Antes do primeiro quadro não existe câmera nenhuma, e aí a resposta é SIM: recortar
   * contra uma janela que ainda não foi calculada esconderia a cena inteira na abertura.
   */
  naVista(px, py, margem = MARGEM_VISTA) {
    const v = this.vista;
    if (!v) return true;
    return px >= v.x0 - margem && px <= v.x1 + margem && py >= v.y0 - margem && py <= v.y1 + margem;
  }

  moverCamera(heroi) {
    if (!heroi) return;
    const alvoX = heroi.tx * TILE + TILE / 2;
    const alvoY = heroi.ty * TILE + TILE / 2;
    if (!this.cam.iniciada) {
      this.cam.x = alvoX;
      this.cam.y = alvoY;
      this.cam.iniciada = true;
    } else {
      this.cam.x += (alvoX - this.cam.x) * SUAVIDADE_CAMERA;
      this.cam.y += (alvoY - this.cam.y) * SUAVIDADE_CAMERA;
    }
    this.limitarCamAosLimites();
  }

  /** Não deixa a câmera passar da borda do cenário renderizado. Compartilhado com `deslocarCamera`. */
  limitarCamAosLimites() {
    const meiaL = this.W / this.zoom / 2;
    const meiaA = this.H / this.zoom / 2;
    const l = this.mapa.limites;
    if (l.x1 - l.x0 > 2 * meiaL) this.cam.x = Math.max(l.x0 + meiaL, Math.min(l.x1 - meiaL, this.cam.x));
    else this.cam.x = (l.x0 + l.x1) / 2;
    if (l.y1 - l.y0 > 2 * meiaA) this.cam.y = Math.max(l.y0 + meiaA, Math.min(l.y1 - meiaA, this.cam.y));
    else this.cam.y = (l.y0 + l.y1) / 2;
  }

  /**
   * Desloca a câmera à mão, em px de TELA — o arrasto do replay (ver `ReplayGuerra.ligarArrasto`).
   * Divide pelo zoom para converter em px de MUNDO: no zoom 3, arrastar 30 px de tela é só 10
   * px de mapa, senão o arrasto ficaria "mais rápido" quanto mais fechada a câmera estivesse.
   */
  deslocarCamera(dxTela, dyTela) {
    if (!this.mapa) return;
    this.camLivre = true;
    this.cam.x -= dxTela / this.zoom;
    this.cam.y -= dyTela / this.zoom;
    this.limitarCamAosLimites();
  }

  /**
   * Intercala os sprites do mapa com os pokémon, na ordem de profundidade.
   *
   * As ops do mapa já vêm ordenadas; as criaturas entram recortadas pela câmera, então a
   * lista a ordenar tem o tamanho da TELA e não o do mapa — e aí basta andar nas duas ao
   * mesmo tempo.
   *
   * O recorte das criaturas é novo. A linha que estava aqui dizia "as criaturas são poucas",
   * e era verdade quando uma hunt tinha meia dúzia de mobs em volta do herói. O replay da
   * Guerra de Guilds põe 500 entidades no mesmo mapa (2.000 numa guerra de 200 guilds), e
   * quem está fora da tela custa exatamente o mesmo que quem aparece — mais o `sort` de
   * todas elas, a cada quadro. Medido numa guerra de 50 guilds, no zoom 1: 56% dos pedidos
   * de desenho caem aqui. Numa hunt não cai nenhum — lá todo mundo está em volta do herói.
   */
  desenharCena(camX, camY, largVista, altVista, heroi) {
    const ctx = this.ctx;
    const criaturas = [];

    const juntar = (e, p, ehHeroi) => {
      if (!p) return;
      // O HERÓI nunca é recortado. A câmera segue ele, mas presa na borda do mapa (ver
      // `limitarCamAosLimites`) ele pode chegar perto da margem — e um herói que pisca é
      // muito pior do que um sprite a mais por quadro.
      if (!ehHeroi && !this.naVista(p.tx * TILE, p.ty * TILE)) return;
      const gz = this.caixa?.groundZ ?? this.mapa?.groundZ ?? 7;
      const profAndar = this.andarFixo != null ? (gz - this.andarFixo) * POR_ANDAR : 0;
      criaturas.push({
        prof: BANDA_ITEM + ez(Math.round(p.tx), Math.floor(p.ty + 0.86)) + profAndar + 0.4,
        e,
        p,
        ehHeroi,
      });
    };
    for (const m of this.mobs.values()) juntar(m, this.pos(m), false);
    if (this.treinador) juntar(this.treinador, this.pos(this.treinador), false);
    if (this.heroi) juntar(this.heroi, heroi, true);
    criaturas.sort((a, b) => a.prof - b.prof);

    // margem generosa: uma árvore de 96 px encosta na tela a partir de duas tiles fora
    const x0 = camX - 128;
    const y0 = camY - 128;
    const x1 = camX + largVista + 64;
    const y1 = camY + altVista + 64;

    let i = 0;
    let alfa = 1;
    for (const o of this.mapa.ops) {
      while (i < criaturas.length && criaturas[i].prof <= o.prof) this.desenharCriatura(criaturas[i++]);
      if (o.x > x1 || o.y > y1 || o.x + o.w < x0 || o.y + o.h < y0) continue;
      // andar apagado (o herói está debaixo dele): pula ou desenha translúcido no meio do fade
      const a = this.alfaAndar.get(o.z) ?? 1;
      if (a <= 0.002) continue;
      if (a !== alfa) ctx.globalAlpha = alfa = a;
      ctx.drawImage(o.img, o.sx, o.sy, o.w, o.h, o.x, o.y, o.w, o.h);
    }
    if (alfa !== 1) ctx.globalAlpha = 1;
    while (i < criaturas.length) this.desenharCriatura(criaturas[i++]);

    this.desenharEfeitos();
    this.desenharBolas();
  }

  desenharCriatura({ e, p, ehHeroi }) {
    const ctx = this.ctx;
    if (!e.sprite) return;

    const quadros = quadrosDe(e.sprite, e.dir ?? 3);
    if (!quadros.length) return;

    // quadro 0 é parado; 1..n-1 são a caminhada, percorridos ao longo do passo
    let idx = 0;
    if (p.andando && quadros.length > 1) {
      const ciclo = quadros.length - 1;
      idx = 1 + Math.min(ciclo - 1, Math.floor(p.fase * ciclo));
    }
    const q = quadros[idx];

    // investida: um pulinho na direção do oponente quando bate
    let avX = 0;
    let avY = 0;
    if (e.investida > 0) {
      e.investida = Math.max(0, e.investida - 0.07);
      const s = Math.sin(e.investida * Math.PI) * 9;
      avX = (e.investidaDir?.[0] ?? 0) * s;
      avY = (e.investidaDir?.[1] ?? 0) * s;
    }
    if (e.tremor > 0) {
      e.tremor = Math.max(0, e.tremor - 0.09);
      avX += (Math.random() - 0.5) * 4 * e.tremor;
    }

    const cx = p.tx * TILE + TILE / 2 + avX;
    const cy = p.ty * TILE + TILE / 2 + avY;

    // Âncora do cliente deles: o "pé" do sprite fica 11,52 px abaixo do centro da tile.
    const x = Math.round(cx - q.w / 2);
    const y = Math.round(cy + 11.52 - q.h);

    ctx.save();
    ctx.globalAlpha = 1; // o andar anterior pode ter deixado o canvas translúcido

    // O derrotado fica CAÍDO no chão até o corpo expirar — é dele que sai a captura pelo
    // painel do palco. Perde a cor e pisca nos últimos segundos, avisando que vai sumir.
    if (e.morto) {
      const restante = (e.expiraEm ?? this.agora) - this.agora;
      if (restante <= 0) return ctx.restore();
      ctx.globalAlpha = restante < 3000 ? 0.4 + 0.35 * Math.abs(Math.sin(this.agora / 160)) : 0.78;
    }

    // sombra no chão, para o sprite não flutuar
    ctx.globalAlpha *= 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, Math.min(14, q.w / 2.6), 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha /= 0.3;

    const img = e.sprite.imagens[q.pagina];
    if (img) {
      // O corpo tomba de lado. A rotação fica só em volta do sprite, senão a sombra e o
      // anel de alvo girariam junto e o chão sairia torto.
      if (e.morto) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-Math.PI / 2);
        ctx.translate(-cx, -cy);
        ctx.filter = 'grayscale(0.7)';
        ctx.drawImage(img, q.x, q.y, q.w, q.h, x, y, q.w, q.h);
        ctx.restore();
      } else {
        ctx.drawImage(img, q.x, q.y, q.w, q.h, x, y, q.w, q.h);
      }
    }

    // anel embaixo do alvo em combate e do próprio herói
    if (ehHeroi || e.slot === this.alvo) {
      ctx.globalAlpha *= 0.85;
      ctx.strokeStyle = ehHeroi ? '#6fd3ff' : '#ff7a4d';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 9, 13, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Nome e barra de HP, desenhados sem zoom para o texto não borrar. */
  desenharPlacas(camX, camY, escala, heroi) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';

    const placa = (e, p, destaque, degrau = 0) => {
      if (!p || e.morto) return;
      const x = (p.tx * TILE + TILE / 2 - camX) * escala;
      const y = (p.ty * TILE - 14 - camY) * escala - degrau;
      if (x < -60 || x > this.W + 60 || y < -20 || y > this.H + 20) return;

      // O NICK de um jogador nunca desbota. Ele é a identidade de outra PESSOA na tela — na
      // praça é a única forma de saber com quem se está falando —, e o cinza a 75% que serve
      // para um bando de selvagens sumia no chão claro do Centro Pokémon.
      ctx.globalAlpha = destaque || e.ehTreinador || e.emTreino ? 1 : 0.75;

      // Quem TREINA tem barra de XP no lugar da de vida, e é ela que o jogador foi ver na
      // casa: aqui ninguém apanha, então a barra verde não teria o que contar. `vista` é o
      // valor interpolado (ver `animarTreinos`) — a barra sobe, não pula de quatro em quatro
      // segundos.
      const treino = e.emTreino ? this.treinos.get(e.treinoSlot) : null;
      if (treino) {
        const larg = LARG_BARRA_TREINO;
        ctx.fillStyle = '#000a';
        ctx.fillRect(x - larg / 2 - 1, y - 1, larg + 2, 5);
        ctx.fillStyle = '#6fc0f0';
        ctx.fillRect(x - larg / 2, y, larg * Math.max(0, Math.min(1, treino.vista)), 3);
      } else if (e.maxHp && !e.ehTreinador) {
        const larg = destaque ? 46 : 32;
        const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
        ctx.fillStyle = '#000a';
        ctx.fillRect(x - larg / 2 - 1, y - 1, larg + 2, 5);
        ctx.fillStyle = frac > 0.35 ? '#3ddc84' : '#ff5b3a';
        ctx.fillRect(x - larg / 2, y, larg * frac, 3);
      }

      // O BONECO tem placa própria: ou a fatia do posto, ou nada.
      //
      // Um boneco livre fica MUDO de propósito — escrever "Boneco" em cima de um boneco é
      // ruído, e a casa Lendária teria duas dessas etiquetas repetidas na tela. A placa
      // aparece justamente quando ela diz algo que não dá para ver olhando: a fatia.
      if (e.ehBoneco) {
        if (e.pctShare != null) {
          ctx.font = 'bold 10px system-ui';
          ctx.fillStyle = '#c9a227';
          ctx.shadowColor = '#000';
          ctx.shadowBlur = 3;
          ctx.fillText(t('casa.xpShareTag', { n: e.pctShare }), x, y - 4);
          ctx.shadowBlur = 0;
        }
      } else if (e.nome) {
        // Nick de gente sai em AMARELO e em corpo maior; nome de bicho continua branco. São
        // duas coisas diferentes na mesma cena, e a cor é o que separa uma da outra de longe.
        ctx.font = e.ehTreinador ? 'bold 11px system-ui' : destaque ? 'bold 10px system-ui' : '9px system-ui';
        ctx.fillStyle = e.ehTreinador ? '#ffd166' : e.shiny ? '#ffd166' : destaque ? '#fff' : '#dfe6ec';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 3;
        ctx.fillText(`${e.shiny ? `✨ ${t('calc.shiny')} ` : ''}${e.nome}${e.level ? ` ${t('painel.nivelCurto')}${e.level}` : ''}`, x, y - 4);
        ctx.shadowBlur = 0;
      }

      // O ELO vai EMBAIXO do personagem, não junto do nome: em cima, com o bando da arena
      // por perto, ele se perdia no meio dos nomes de pokémon. A âncora é o pé do sprite
      // (`p.ty * TILE`), 22 px abaixo da linha das placas.
      if (e.elo != null) {
        const yElo = (p.ty * TILE + 20 - camY) * escala;
        ctx.font = 'bold 9px system-ui';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 3;
        ctx.fillStyle = '#ffd166';
        ctx.fillText(`⚔ ${e.elo}`, x, yElo);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
    };

    // Um bando em cima do herói empilha cinco nomes na mesma linha e vira sopa de letras.
    // Escalonar por slot separa as placas, e o alvo/herói entram por último, por cima.
    //
    // A CASA fica fora do escalonamento — bonecos e quem treina neles. Duas razões:
    //
    //   1. lá não há bando: é um boneco por cômodo, com o pokémon dele colado, e ninguém
    //      empilha nome com ninguém;
    //   2. o botão "+"/"×" do XP Share se pendura ACIMA da placa do boneco (ver
    //      `telaDoBoneco`), e para isso a placa precisa estar sempre na MESMA altura. Com o
    //      escalonamento ela subia 11 ou 22 px conforme o slot que calhou — e ia parar
    //      debaixo do botão, que é onde o jogador lê o nível do treino.
    const semDegrau = (m) => m.emTreino || m.ehBoneco;
    for (const m of this.mobs.values()) {
      if (m.slot !== this.alvo) placa(m, this.pos(m), false, semDegrau(m) ? 0 : (m.slot % 3) * 11);
    }
    const alvo = this.alvo != null ? this.mobs.get(this.alvo) : null;
    if (alvo) placa(alvo, this.pos(alvo), true);
    if (this.heroi) placa(this.heroi, heroi, true);
    // O próprio treinador só ganha placa quando tem ELO — ou seja, dentro da arena PvP. Na
    // hunt ele é um boneco mudo andando atrás do pokémon e um nome ali só polui a cena.
    if (this.treinador?.elo != null) placa(this.treinador, this.pos(this.treinador), true);
  }

  /**
   * Os balões de fala, na praça do Centro Pokémon.
   *
   * Sem zoom, como as placas — texto de interface esticado por um zoom de 3× fica borrado. E
   * por cima de tudo: um balão atrás de uma árvore não seria lido, e ler é o ponto dele.
   */
  desenharBaloes(camX, camY, escala, heroi) {
    if (!this.centro) return;
    const ctx = this.ctx;
    const agora = performance.now();

    const desenhar = (e, p) => {
      if (!e?.balao || !p) return;
      if (agora > e.balao.ate) {
        e.balao = null;
        return;
      }
      ctx.font = 'bold 11px Tahoma, Verdana, "Segoe UI", sans-serif';
      e.balao.linhas ??= this.quebrarTexto(e.balao.txt);

      const alt = 6 + e.balao.linhas.length * 13 + 5;
      const larg =
        Math.max(...e.balao.linhas.map((l) => ctx.measureText(l).width)) + 14;
      const x = (p.tx * TILE + TILE / 2 - camX) * escala;
      // A enfermeira tem o botão de curar pendurado na cabeça, e ele é um elemento de DOM com
      // altura fixa. O degrau junta os dois sistemas de medida numa conta só: a diferença
      // entre as duas âncoras é de MUNDO (escala com o zoom) e o botão é de TELA (não escala).
      // Assim o balão dela fica logo acima do botão em qualquer nível de zoom.
      const degrau = e.ehEnfermeira ? (ALTURA_BALCAO - 30) * escala + ALTURA_BOTAO_CURAR + 8 : 0;
      // acima da placa de nome, que já fica 14 px de mundo acima do pé do sprite
      const base = (p.ty * TILE - 30 - camY) * escala - degrau;
      if (x < -larg || x > this.W + larg || base < -alt || base > this.H + alt) return;

      // Preso dentro do quadro. Vale para todo mundo, mas nasceu da enfermeira: ela fica no
      // fundo do salão e a câmera segue o jogador, então a fala dela cairia por cima da borda
      // justamente quando ele se afasta — e piada que ninguém lê não é piada.
      const bx = Math.round(Math.min(Math.max(x - larg / 2, 4), this.W - larg - 4));
      const by = Math.round(Math.min(Math.max(base - alt, 4), this.H - alt - 4));
      // O rabicho continua apontando para a boca de quem falou, mesmo com o balão encostado
      // na moldura — é ele que diz de quem é a fala quando há gente amontoada.
      const rabo = Math.min(Math.max(x, bx + 10), bx + larg - 10);

      // Os últimos 900 ms somem, para o balão não desaparecer no meio de uma leitura.
      ctx.globalAlpha = Math.min(1, (e.balao.ate - agora) / 900);
      // Vão escuro com filete, do mesmo vocabulário da interface (ver DESIGN.md). Retângulo
      // reto de propósito: canto arredondado em cima de pixel art destoa de todo o resto.
      ctx.fillStyle = '#33202b';
      ctx.fillRect(bx, by, larg, alt);
      ctx.fillStyle = '#480e1e';
      ctx.fillRect(bx, by, larg, 2);
      ctx.fillRect(bx, by + alt - 2, larg, 2);
      ctx.fillRect(bx, by, 2, alt);
      ctx.fillRect(bx + larg - 2, by, 2, alt);
      // o rabicho, apontando para a cabeça
      ctx.fillStyle = '#33202b';
      ctx.fillRect(rabo - 4, by + alt - 2, 8, 4);
      ctx.fillStyle = '#480e1e';
      ctx.fillRect(rabo - 4, by + alt + 2, 8, 2);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff6ef';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 2;
      e.balao.linhas.forEach((linha, i) => ctx.fillText(linha, bx + larg / 2, by + 15 + i * 13));
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    };

    for (const m of this.mobs.values()) if (m.balao) desenhar(m, this.pos(m));
    desenhar(this.heroi, heroi);
  }

  /** Quebra a fala em linhas que cabem no balão. O que passar do teto vira reticências. */
  quebrarTexto(txt) {
    const cabe = (s) => this.ctx.measureText(s).width <= BALAO_LARG;

    // Uma palavra maior que o balão inteiro (um endereço colado, um "aaaaaa…") não quebra em
    // espaço nenhum — vira pedaços do tamanho que cabe, senão ela estouraria a caixa sozinha.
    const pedacos = [];
    for (const palavra of String(txt).trim().split(/\s+/)) {
      let resto = palavra;
      while (resto && !cabe(resto)) {
        let n = 1;
        while (n < resto.length && cabe(resto.slice(0, n + 1))) n++;
        pedacos.push(resto.slice(0, n));
        resto = resto.slice(n);
      }
      if (resto) pedacos.push(resto);
    }

    const linhas = [];
    let atual = '';
    for (const p of pedacos) {
      const teste = atual ? `${atual} ${p}` : p;
      if (!atual || cabe(teste)) {
        atual = teste;
        continue;
      }
      if (linhas.length === BALAO_LINHAS - 1) {
        atual += '…';
        break;
      }
      linhas.push(atual);
      atual = p;
    }
    linhas.push(atual);
    return linhas;
  }

  desenharEfeitos() {
    const ctx = this.ctx;
    for (let i = this.efeitos.length - 1; i >= 0; i--) {
      const e = this.efeitos[i];
      const idx = Math.floor((performance.now() - e.t0) / (e.fx.frameMs || 60));
      if (idx >= e.fx.frames) {
        this.efeitos.splice(i, 1);
        continue;
      }
      const { img, frameW, frameH } = e.fx;
      const cols = e.fx.cols ?? 1;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      ctx.drawImage(img, col * frameW, row * frameH, frameW, frameH, e.x - frameW / 2, e.y - frameH / 2, frameW, frameH);
    }
  }

  /**
   * Arremesso e captura, com as folhas ORIGINAIS do jogo (ver `folhasDaBola`).
   *
   * Dois atos:
   *   voo    o sprite de 32×32 da grade 3×3, escolhido pela DIREÇÃO do arremesso,
   *          percorrendo um arco do treinador até o alvo
   *   folha  no impacto entra a tira de 64×96: a bola abre num clarão, chacoalha no
   *          chão e então confirma (faíscas verdes, some pálida) ou quebra (baforada
   *          branca). São desenhos prontos — aqui só se escolhe o quadro pelo tempo.
   */
  desenharBolas() {
    const ctx = this.ctx;
    const agora = performance.now();

    for (let i = this.bolas.length - 1; i >= 0; i--) {
      const b = this.bolas[i];
      const f = b.folhas;
      if (!f) continue; // folhas ainda carregando: espera, não inventa desenho

      const folha = b.sucesso ? f.captura : f.quebra;
      const total = b.sucesso ? f.quadrosCaptura : f.quadrosQuebra;
      const decorrido = agora - b.t0;

      if (decorrido < MS_VOO_BOLA) {
        this.desenharArremesso(ctx, b, f, decorrido / MS_VOO_BOLA);
        continue;
      }
      if (!folha || !total) {
        this.bolas.splice(i, 1);
        continue;
      }

      const quadro = Math.floor((decorrido - MS_VOO_BOLA) / MS_QUADRO_BOLA);
      if (quadro >= total) {
        this.bolas.splice(i, 1);
        continue;
      }

      // o quadro tem 96 px de altura com a bola apoiada embaixo: alinhar a base pelo
      // chão do alvo é o que faz o clarão nascer em cima dele
      ctx.drawImage(
        folha,
        0, quadro * QUADRO_BOLA_H, QUADRO_BOLA_W, QUADRO_BOLA_H,
        Math.round(b.x1 - QUADRO_BOLA_W / 2), Math.round(b.y1 + 12 - QUADRO_BOLA_H),
        QUADRO_BOLA_W, QUADRO_BOLA_H,
      );

      // o veredito entra junto com a virada da folha (quadro 40 nas duas)
      if (quadro >= 40 && !b.avisou) {
        b.avisou = true;
        this.flutuantes.push({
          txt: b.sucesso ? 'CAPTURADO!' : 'escapou...',
          x: b.x1,
          y: b.y1 - 30,
          vy: -0.35,
          vida: 1.2,
          cor: b.sucesso ? '#3ddc84' : '#ff8a7a',
          tam: b.sucesso ? 15 : 11,
        });
      }
    }
  }

  /**
   * A bola voando. A folha de arremesso e uma grade 3x3 indexada por DIRECAO - cada
   * celula ja traz o rastro apontando para o lado certo, entao nao se gira nada aqui.
   */
  desenharArremesso(ctx, b, f, fase) {
    if (!f.arremesso) return;
    const x = b.x0 + (b.x1 - b.x0) * fase;
    const y = b.y0 + (b.y1 - b.y0) * fase - Math.sin(fase * Math.PI) * 30;

    const dx = b.x1 - b.x0;
    const dy = b.y1 - b.y0;
    const col = dx < -TILE / 2 ? 0 : dx > TILE / 2 ? 2 : 1;
    let lin = dy < -TILE / 2 ? 0 : dy > TILE / 2 ? 2 : 1;
    // o miolo da grade e so rastro, sem bola: cai para "descendo" quando o alvo esta colado
    if (col === 1 && lin === 1) lin = 2;

    const L = 32;
    ctx.drawImage(f.arremesso, col * L, lin * L, L, L, Math.round(x - L / 2), Math.round(y - L / 2), L, L);
  }

  desenharFlutuantes(camX, camY, escala) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = this.flutuantes.length - 1; i >= 0; i--) {
      const f = this.flutuantes[i];
      f.y += f.vy;
      f.vida -= 0.016;
      if (f.escala > 1) f.escala = Math.max(1, f.escala - 0.04);
      if (f.vida <= 0) {
        this.flutuantes.splice(i, 1);
        continue;
      }
      const x = f.naTela ? this.W / 2 : (f.x - camX) * escala;
      const y = f.naTela ? this.H * 0.3 : (f.y - camY) * escala;
      const pop = f.escala ?? 1;
      ctx.globalAlpha = Math.min(1, f.vida);
      ctx.font = `bold ${f.tam}px system-ui`;
      ctx.fillStyle = f.cor;
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pop, pop);
      ctx.fillText(f.txt, 0, 0);
      ctx.restore();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = 'alphabetic';
  }
}
