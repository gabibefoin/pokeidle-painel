// O PLAYER do replay da Guerra de Guilds.
//
// A guerra é decidida no servidor, uma vez por dia, com todo mundo offline (ver
// `server/game/guild-pvp-sim.mjs`). O que chega aqui é a GRAVAÇÃO dela: quem deu um passo
// para onde, quem perdeu HP, quem bateu em quem com qual golpe, quem caiu — nada de imagem.
//
// Por isso este arquivo não desenha nada. Ele reidrata a gravação nos MESMOS pacotes de campo
// que o jogo ao vivo usa e entrega para o renderizador de sempre (`campo.mjs`), que já sabe
// interpolar passo, carregar outfit, ordenar profundidade e escrever placa de nome. O player
// é só o relógio: onde estamos na fita, a que velocidade, e quem a câmera acompanha.
//
// ### O relógio
//
// Duas linhas do tempo andando juntas:
//
//   virtual  o tempo DENTRO da guerra (`quadro.t`, começando em 0)
//   real     o relógio do navegador, que é o que o `campo.mjs` usa para interpolar
//
// A ponte é a âncora (`ancoraReal` ↔ `ancoraVirtual`) mais a velocidade. Mudar de 1× para 4×
// é reancorar e dividir a duração dos passos por 4 — o renderizador não sabe que existe
// replay, só recebe "este passo começou agora e leva 65 ms".

import { Campo } from './campo.mjs';

/** As velocidades oferecidas. 1× é a cadência real da batalha. */
export const VELOCIDADES = [1, 2, 4, 8];

/**
 * Teto da velocidade LIVRE (ver `velocidade`). Acima disto cada passo do renderizador ficaria
 * menor que um quadro de tela, e a briga viraria teletransporte em vez de batalha.
 */
const TETO_VELOCIDADE = 32;

/** Quantas linhas o feed de abates guarda. */
const MAX_FEED = 40;

/** Teto de guilds no placar flutuante. Acima disto ele cobriria a lateral do campo. */
const MAX_PLACAR = 8;

/** Um passo aplicado "de uma vez" (busca na linha do tempo) começa neste tanto de ms atrás. */
const PASSO_INSTANTANEO = 5000;

/**
 * O leque de zoom do replay — mais largo que o da hunt ao vivo (`[1, 1.5, 2, 3]` em campo.mjs).
 *
 * A arena de guerra é um raio de 22 tiles a partir do centro (44 de ponta a ponta) com até dez
 * guildas espalhadas nele — no zoom mínimo da hunt já não cabe a briga inteira. 0,5× e 0,75×
 * dão o "afastar para ver o campo de batalha inteiro" que a hunt nunca precisou.
 */
const NIVEIS_ZOOM_REPLAY = [0.5, 0.75, 1, 1.5, 2, 3];
/** Zoom inicial do replay: mais aberto que o padrão da hunt (2×), para começar já vendo mais campo. */
const ZOOM_PADRAO_REPLAY = 1;
/** Chave própria de `localStorage` — sem ela, mexer no zoom do replay mudaria o zoom da hunt. */
const CHAVE_ZOOM_REPLAY = 'zoom-replay';

/** Zoom da janelinha: chave própria e mais fechado — ver o construtor. */
const ZOOM_PADRAO_MINI = 2;
const CHAVE_ZOOM_MINI = 'zoom-replay-mini';

/**
 * Intervalo mínimo, em ms de RELÓGIO (não de fita), entre dois saltos da câmera automática.
 *
 * Sem isto, uma guerra com setenta lutadores pode render abates a cada fração de segundo — e a
 * câmera pulava de duelo em duelo tão rápido que ninguém acompanhava briga nenhuma. O intervalo
 * é de tempo REAL porque é a leitura HUMANA que importa, não o relógio da guerra: em 8×, três
 * segundos e meio de tela continuam sendo três segundos e meio de olhar.
 */
const COOLDOWN_FOCO_AUTO_MS = 3500;

/** 1=norte 2=leste 3=sul 4=oeste — a mesma numeração dos sprites de outfit. */
const direcaoDe = (dx, dy) => (dy < 0 ? 1 : dy > 0 ? 3 : dx > 0 ? 2 : 4);

export class ReplayGuerra {
  /**
   * @param canvas   onde desenhar
   * @param rep      a gravação, como veio do servidor
   * @param opcoes   `aoAtualizar(estado)` é chamado a cada quadro de tela — é por ele que a
   *                 interface pinta a linha do tempo, o placar e o feed sem consultar nada.
   */
  /**
   * `mini` é a janelinha do canto do palco (PvP ranqueado minimizado).
   *
   * Ela troca DUAS coisas, e as duas por causa do tamanho: a chave de zoom passa a ser própria
   * — senão afastar na janelinha de 260 px afastaria também o replay em tela cheia da próxima
   * vez — e o zoom inicial é mais fechado, porque no padrão do modal os lutadores saem com
   * poucos pixels e não dá para ver quem está batendo em quem.
   */
  constructor(canvas, rep, { aoAtualizar = null, mini = false } = {}) {
    this.rep = rep;
    this.aoAtualizar = aoAtualizar;
    this.mini = !!mini;
    this.campo = new Campo(canvas, {
      chaveZoom: mini ? CHAVE_ZOOM_MINI : CHAVE_ZOOM_REPLAY,
      zoomPadrao: mini ? ZOOM_PADRAO_MINI : ZOOM_PADRAO_REPLAY,
      niveisZoom: NIVEIS_ZOOM_REPLAY,
    });
    // Câmera de espectador: o teto da caverna nunca ajuda a entender a batalha, e cobria
    // metade do quadro toda vez que a briga chegava perto da boca dela.
    this.campo.semTeto = true;

    /**
     * Os atores como a gravação os entregou.
     *
     * Fica intocado porque a troca de pokémon REESCREVE o ator (mesmo slot, outro bicho), e
     * voltar a fita precisa remontar a cena com quem estava lá no primeiro segundo — não com
     * o reserva que entrou no terceiro minuto.
     */
    this.base = new Map((rep.atores ?? []).map((a) => [a.s, a]));
    // Já nasce preenchido (e não só no `iniciar`): a interface monta a lista de lutadores
    // ANTES de o mapa carregar, e um player mudo até lá deixava a tira do elenco vazia.
    this.atores = new Map([...this.base].map(([s, a]) => [s, { ...a }]));

    /** Espelho do estado de cada slot. É o que dá o `de` de cada passo e o placar ao vivo. */
    this.estado = new Map();

    this.dur = Math.max(1, rep.dur ?? 0);
    this.corpoMs = rep.corpoMs ?? 2800;
    this.tv = 0;
    this.vel = 1;
    this.tocando = false;
    this.acabou = false;
    this.iQuadro = 0;
    this.feed = [];
    this.focoSlot = null;
    /**
     * Câmera automática: pula para quem acabou de abater alguém. Começa DESLIGADA — é escolha
     * de quem assiste, não um padrão imposto. `escolherFoco()` (chamado em `iniciar()`) ainda
     * dá um alvo inicial pra câmera com isto desligado; é só o salto a cada abate que fica de
     * fora até o jogador ligar no botão.
     */
    this.auto = false;
    /** Relógio de PAREDE do último salto automático — ver `COOLDOWN_FOCO_AUTO_MS`. */
    this.ultimoFocoAutoEm = 0;
    this.vivo = true;
    this.seq = 0;

    this.laco = this.laco.bind(this);
    requestAnimationFrame(this.laco);
    this.ligarArrasto();
  }

  // ------------------------------------------------------------------ montagem

  /**
   * Carrega o mapa e põe todo mundo no ponto de partida.
   *
   * A promessa só resolve com o cenário na mão — e quem chama espera por ela antes de dar
   * play. O mapa de tiles pode levar segundos na primeira vez, e começar a fita antes disso
   * gastaria a abertura da guerra numa tela preta.
   */
  iniciar() {
    const rep = this.rep;
    const pronto = this.campo.iniciar({
      slug: rep.slug,
      mapa: rep.mapa,
      box: rep.box,
      groundZ: rep.groundZ,
      ts: Date.now(),
      mobs: this.mobsIniciais(),
      alvo: null,
    });
    this.escolherFoco();
    return pronto;
  }

  /** O pacote completo de quem está em campo no instante zero. */
  mobsIniciais() {
    this.estado.clear();
    this.atores = new Map([...this.base].map(([s, a]) => [s, { ...a }]));
    const agora = Date.now() - PASSO_INSTANTANEO;
    const mobs = [];
    const ini = this.rep.inicio ?? [];
    for (let i = 0; i + 2 < ini.length; i += 3) {
      const slot = ini[i];
      const a = this.atores.get(slot);
      if (!a) continue;
      const cx = ini[i + 1];
      const cy = ini[i + 2];
      this.estado.set(slot, { cx, cy, dir: 3, hp: a.hp ?? null, mhp: a.mhp ?? null, fora: false });
      mobs.push(this.pacoteDe(a, { cx, cy, dc: cx, dr: cy, d: 3, em: agora, ms: 1 }));
    }
    return mobs;
  }

  /**
   * Um registro no formato que `campo.mjs` já entende (`serializarMob`).
   *
   * Os campos que não mudam (sprite, nome, nível, HP máximo, se é treinador) vêm do ATOR, que
   * viajou uma vez só no começo da gravação — é isso que deixa cada quadro ser três números
   * por entidade em vez de um objeto inteiro.
   */
  pacoteDe(a, mov) {
    const m = {
      s: a.s,
      lt: a.lt,
      n: a.n,
      tr: a.tr ? 1 : undefined,
      vs: a.vs,
      nv: a.nv,
      sh: a.sh ?? 0,
      hp: a.hp,
      mhp: a.mhp,
      x: 0,
    };
    if (mov) {
      m.c = mov.cx;
      m.r = mov.cy;
      m.dc = mov.dc;
      m.dr = mov.dr;
      m.d = mov.d;
      m.em = mov.em;
      m.ms = mov.ms;
    }
    return m;
  }

  // -------------------------------------------------------------- o relógio

  get duracao() {
    return this.dur;
  }

  /** Converte um instante da FITA no instante do relógio do navegador em que ele acontece. */
  paraRelogio(tvX) {
    return this.ancoraReal + (tvX - this.ancoraVirtual) / this.vel;
  }

  ancorar() {
    this.ancoraReal = Date.now();
    this.ancoraVirtual = this.tv;
  }

  tocar() {
    if (this.acabou) this.irPara(0);
    this.tocando = true;
    this.ancorar();
    return this;
  }

  pausar() {
    this.tocando = false;
    return this;
  }

  alternar() {
    return this.tocando ? this.pausar() : this.tocar();
  }

  /**
   * Muda a velocidade da fita.
   *
   * Sem `livre`, só aceita o que está em `VELOCIDADES` — os botões da barra, e qualquer outra
   * coisa cai em 1×. Com `livre`, aceita qualquer fator positivo.
   *
   * A porta livre existe para o ajuste AUTOMÁTICO do PvP ranqueado: uma partida pode durar até
   * o teto de 5 min do simulador, e a fila automática puxa a seguinte 20 s depois do fim — sem
   * comprimir, o jogador ainda estaria assistindo à partida anterior quando a próxima chegasse.
   * O fator que resolve isso (300/20 = 15×) não é nenhum dos quatro da barra, e ARREDONDAR para
   * 8× deixaria a fita em 37 s, ainda por cima do limite. Daí ser um número contínuo, e não
   * mais um botão.
   */
  velocidade(v, { livre = false } = {}) {
    const n = Number(v);
    if (livre && Number.isFinite(n) && n > 0) this.vel = Math.min(TETO_VELOCIDADE, Math.max(0.25, n));
    else this.vel = VELOCIDADES.includes(n) ? n : 1;
    this.ancorar();
    return this.vel;
  }

  /**
   * Salta para um instante da fita.
   *
   * Voltar atrás significa remontar a cena do zero e reaplicar os quadros — não há como
   * "desfazer" um passo. São algumas centenas de quadros de números, então o custo é o de um
   * laço, e em troca a busca é exata: o que aparece na tela é o que estava lá naquele segundo.
   */
  irPara(tvAlvo) {
    const alvo = Math.max(0, Math.min(this.dur, tvAlvo));
    if (alvo < this.tv || this.acabou) {
      // Não há como desfazer um passo: voltar é remontar a cena do zero e reaplicar. Quem foi
      // removido volta ao mapa porque o pacote inicial recria TODOS os slots.
      this.iQuadro = 0;
      this.feed = [];
      this.campo.aplicar({ ts: Date.now(), mobs: this.mobsIniciais(), alvo: null });
      this.acabou = false;
    }
    this.tv = alvo;
    this.ancorar();
    this.aplicarAte(alvo, true);
    this.escolherFoco();
    // A câmera SALTA para o novo ponto em vez de deslizar até ele. A suavização é para
    // acompanhar quem anda; num pulo de trinta segundos ela viraria um sobrevoo de dois
    // segundos pelo mapa, com a batalha acontecendo fora do quadro o caminho inteiro.
    this.campo.cam.iniciada = false;
    return this;
  }

  laco() {
    if (!this.vivo) return;
    requestAnimationFrame(this.laco);
    if (this.tocando) {
      const tv = this.ancoraVirtual + (Date.now() - this.ancoraReal) * this.vel;
      this.tv = Math.min(this.dur, tv);
      this.aplicarAte(this.tv, false);
      if (tv >= this.dur) {
        this.tv = this.dur;
        this.tocando = false;
        this.acabou = true;
      }
    }
    this.aoAtualizar?.(this.instantaneo());
  }

  // ------------------------------------------------------------- os quadros

  /**
   * Aplica todos os quadros até `tvAlvo`.
   *
   * `deUmaVez` é a diferença entre assistir e buscar: no playback cada passo começa no
   * instante em que começou na guerra (e o renderizador interpola a caminhada); na busca todo
   * mundo já aparece na tile de destino, parado.
   */
  aplicarAte(tvAlvo, deUmaVez) {
    const quadros = this.rep.quadros ?? [];
    while (this.iQuadro < quadros.length && quadros[this.iQuadro].t <= tvAlvo) {
      this.aplicarQuadro(quadros[this.iQuadro++], deUmaVez);
    }
  }

  aplicarQuadro(q, deUmaVez) {
    const mobs = [];
    const fora = [];
    const relogio = deUmaVez ? Date.now() - PASSO_INSTANTANEO : this.paraRelogio(q.t);

    for (let i = 0; q.p && i + 2 < q.p.length; i += 3) {
      const slot = q.p[i];
      const a = this.atores.get(slot);
      const e = this.estado.get(slot);
      if (!a || !e) continue;
      const cx = q.p[i + 1];
      const cy = q.p[i + 2];
      const d = direcaoDe(cx - e.cx, cy - e.cy);
      mobs.push({
        s: slot,
        c: cx,
        r: cy,
        dc: e.cx,
        dr: e.cy,
        d,
        em: relogio,
        ms: deUmaVez ? 1 : Math.max(1, Math.round((a.ms ?? 260) / this.vel)),
      });
      e.cx = cx;
      e.cy = cy;
      e.dir = d;
    }

    for (let i = 0; q.h && i + 1 < q.h.length; i += 2) {
      const slot = q.h[i];
      const e = this.estado.get(slot);
      if (!e) continue;
      e.hp = q.h[i + 1];
      mobs.push({ s: slot, hp: e.hp });
    }

    // Troca de pokémon: o slot continua o mesmo, mas quem está nele é outro bicho. O ATOR é
    // reescrito para que uma busca posterior remonte a cena com o pokémon certo.
    for (const c of q.c ?? []) {
      const a = this.atores.get(c.s);
      const e = this.estado.get(c.s);
      if (!a || !e) continue;
      Object.assign(a, { n: c.n, lt: c.lt, nv: c.nv, sh: c.sh, mhp: c.mhp, hp: c.hp });
      e.hp = c.hp;
      e.mhp = c.mhp;
      mobs.push({ s: c.s, n: c.n, lt: c.lt, nv: c.nv, sh: c.sh, hp: c.hp, mhp: c.mhp });
    }

    // Caiu: sai da conta de vivos na hora, mas continua no mapa como corpo. O renderizador já
    // sabe desenhar isso (tombado, sem cor, sumindo) — `xr` é quanto ainda resta de chão, e
    // escala com a velocidade para o corpo não durar oito vezes mais no 8×.
    for (const slot of q.m ?? []) {
      const e = this.estado.get(slot);
      if (e) e.fora = true;
      mobs.push({ s: slot, x: 1, xr: deUmaVez ? 1 : Math.round(this.corpoMs / this.vel) });
    }

    for (const slot of q.x ?? []) {
      const e = this.estado.get(slot);
      if (e) e.fora = true;
      fora.push(slot);
    }

    for (const ev of q.e ?? []) {
      this.feed.push({ ...ev, t: q.t });
      if (this.feed.length > MAX_FEED) this.feed.shift();
      if (this.auto && !deUmaVez) this.focarAlgozDe(ev);
    }

    if (mobs.length || fora.length) {
      this.campo.aplicar({ seq: ++this.seq, ts: Date.now(), mobs, fora, alvo: null });
    }

    // Os GOLPES vêm depois do `aplicar`, e não antes: o pulinho do atacante sai na direção
    // do alvo e o efeito de tipo estoura em cima dele, então as duas entidades precisam já
    // estar na posição deste quadro — senão a pancada de agora sairia mirando onde os dois
    // estavam há 250 ms.
    if (!deUmaVez) this.desenharGolpes(q);

    // O acompanhado caiu: a câmera precisa de outro dono, senão a batalha continua fora do
    // quadro enquanto o corpo dele esfria no meio da tela.
    if (this.focoSlot != null && this.estado.get(this.focoSlot)?.fora) this.escolherFoco();
  }

  /**
   * As pancadas de um quadro, entregues ao MESMO `golpe()` que a hunt usa.
   *
   * Não roda na busca (`deUmaVez`): pular para o minuto três aplica centenas de quadros num
   * laço só, e cada golpe deles viraria um efeito começando neste instante — a tela inteira
   * explodindo de uma vez, com trinta minutos de guerra desenhados em meio segundo.
   *
   * O `campo` já recusa tudo sozinho no MODO OTIMIZADO (é a primeira linha de
   * `golpeEntreSlots`), então não há um segundo interruptor aqui: quem joga com o desenho
   * enxuto assiste o replay do mesmo jeito que joga.
   *
   * A promessa do `golpe()` (ele espera o sprite do efeito carregar) é solta de propósito,
   * como no jogo ao vivo: o quadro seguinte não pode ficar esperando um PNG.
   */
  desenharGolpes(q) {
    const tabela = this.rep.golpes ?? [];
    // Gravação antiga, de antes de `a` existir: toca igual, só sem as animações.
    for (let i = 0; q.a && i + 5 < q.a.length; i += 6) {
      const g = tabela[q.a[i + 2]];
      if (!g) continue;
      this.campo.golpeEntreSlots({
        de: q.a[i],
        para: q.a[i + 1],
        golpe: g.n,
        tipo: g.t,
        dano: q.a[i + 3],
        ef: q.a[i + 4] / 100,
        stab: q.a[i + 5] === 1,
      });
    }
  }

  // ---------------------------------------------------------------- a câmera

  /**
   * Põe a câmera em quem acabou de abater — é onde a briga está acontecendo.
   *
   * O salto é seco, sem suavização: com os dois lados a vinte tiles um do outro, deslizar
   * levaria mais tempo do que o próximo abate, e a câmera passaria a fita inteira em trânsito.
   *
   * `COOLDOWN_FOCO_AUTO_MS` segura a FREQUÊNCIA dos saltos: numa guerra de setenta lutadores os
   * abates saem em rajada, e sem um piso de tempo real entre uma troca e outra a câmera vira um
   * estroboscópio — pula de duelo em duelo rápido demais para acompanhar qualquer um deles.
   */
  focarAlgozDe(ev) {
    const agora = Date.now();
    if (agora - this.ultimoFocoAutoEm < COOLDOWN_FOCO_AUTO_MS) return;
    this.porNick ??= new Map(
      [...this.base.values()].filter((a) => !a.tr).map((a) => [a.dono, a.s]),
    );
    const slot = this.porNick.get(ev.a);
    if (slot == null || slot === this.focoSlot || this.estado.get(slot)?.fora) return;
    this.ultimoFocoAutoEm = agora;
    this.seguir(slot);
    this.campo.cam.iniciada = false;
  }

  seguir(slot, manual = false) {
    if (manual) this.auto = false;
    this.focoSlot = slot;
    this.campo.seguir(slot);
    return slot;
  }

  /** Alguém para a câmera olhar: o foco atual continua valendo se ainda estiver de pé. */
  escolherFoco() {
    if (this.focoSlot != null && !this.estado.get(this.focoSlot)?.fora) {
      return this.campo.seguir(this.focoSlot);
    }
    const vivo = [...this.atores.values()].find((a) => !a.tr && !this.estado.get(a.s)?.fora);
    const qualquer = vivo ?? [...this.atores.values()].find((a) => !a.tr);
    return qualquer ? this.seguir(qualquer.s) : null;
  }

  /**
   * Liga o arrasto do mouse/dedo no canvas: olhar ao redor sem largar o foco de quem entrou na
   * guerra — só a câmera solta (`campo.deslocarCamera`), e clicar em qualquer lutador (ou
   * religar a câmera automática) retoma o acompanhamento suave de onde o arrasto deixou.
   *
   * Fica em `ReplayGuerra`, e não em `Campo`, de propósito: o palco ao vivo (`estado.campo`)
   * nunca deve responder a arrasto — clicar e segurar ali é escalar pokémon, dar bola, tudo
   * menos "olhar ao redor". Prender isto ao canvas do REPLAY é o que garante que a hunt nunca
   * herda o comportamento sem querer.
   */
  ligarArrasto() {
    const cv = this.campo.cv;
    let arrastando = false;
    let ultX = 0;
    let ultY = 0;
    const inicio = (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      arrastando = true;
      ultX = ev.clientX;
      ultY = ev.clientY;
      cv.setPointerCapture?.(ev.pointerId);
      cv.classList.add('arrastando');
    };
    const mover = (ev) => {
      if (!arrastando) return;
      const dx = ev.clientX - ultX;
      const dy = ev.clientY - ultY;
      ultX = ev.clientX;
      ultY = ev.clientY;
      if (!dx && !dy) return;
      // Arrastar é pegar o volante: a câmera automática solta o quanto durar o arrasto.
      this.auto = false;
      this.campo.deslocarCamera(dx, dy);
    };
    const fim = (ev) => {
      arrastando = false;
      cv.classList.remove('arrastando');
      cv.releasePointerCapture?.(ev.pointerId);
    };
    cv.addEventListener('pointerdown', inicio);
    cv.addEventListener('pointermove', mover);
    cv.addEventListener('pointerup', fim);
    cv.addEventListener('pointercancel', fim);
    // O canvas do replay é reaproveitado a cada guerra assistida (mora fixo no HTML) — sem
    // desligar estes ouvintes no `destruir`, cada abertura do modal somaria mais um conjunto,
    // todos arrastando a câmera de instâncias já mortas.
    this._desligarArrasto = () => {
      cv.removeEventListener('pointerdown', inicio);
      cv.removeEventListener('pointermove', mover);
      cv.removeEventListener('pointerup', fim);
      cv.removeEventListener('pointercancel', fim);
    };
  }

  /** Lutadores da fita, para a lista lateral: quem acompanhar com a câmera. */
  lutadores() {
    return [...this.atores.values()]
      .filter((a) => !a.tr)
      .map((a) => ({
        slot: a.s,
        guilda: a.g,
        nick: a.dono,
        pokemon: a.n,
        nivel: a.nv,
        vivo: !this.estado.get(a.s)?.fora,
      }));
  }

  // ------------------------------------------------------------- para a tela

  /** Tudo que a interface precisa desenhar por quadro, sem vasculhar o estado interno. */
  instantaneo() {
    const vivos = (this.rep.guilds ?? []).map(() => 0);
    const totais = (this.rep.guilds ?? []).map(() => 0);
    for (const a of this.atores.values()) {
      if (a.tr) continue;
      totais[a.g] = (totais[a.g] ?? 0) + 1;
      if (!this.estado.get(a.s)?.fora) vivos[a.g] = (vivos[a.g] ?? 0) + 1;
    }
    const todasGuilds = (this.rep.guilds ?? []).map((g, i) => ({
      ...g,
      vivos: vivos[i] ?? 0,
      total: totais[i] ?? 0,
      idx: i,
    }));
    // Só as guilds AINDA DE PÉ, da mais inteira para a mais machucada. Com vinte inscritas a
    // lista completa cobria a lateral esquerda do campo inteira — e o nome de quem já foi
    // eliminado não diz nada sobre a briga que está rolando. As caídas viram um contador.
    const emPe = todasGuilds.filter((g) => g.vivos > 0).sort((a, b) => b.vivos - a.vivos || a.nome.localeCompare(b.nome));

    return {
      t: this.tv,
      dur: this.dur,
      tocando: this.tocando,
      acabou: this.acabou,
      vel: this.vel,
      auto: this.auto,
      foco: this.focoSlot,
      // Câmera solta pelo arrasto (ver `campo.deslocarCamera`) — é o que liga o botão de
      // recentralizar no painel.
      camLivre: this.campo.camLivre,
      guilds: emPe.slice(0, MAX_PLACAR),
      /** Quantas ficaram de fora do placar: as eliminadas mais as que não couberam. */
      guildsFora: (this.rep.guilds ?? []).length - Math.min(emPe.length, MAX_PLACAR),
      /** Ordem ESTÁVEL (a de cadastro), com todo mundo — o painel lateral usa esta, não `guilds`,
       * porque reordenar as guilds à medida que morrem tornaria "achar minha guild" um jogo de
       * caça-níquel no meio da fita. */
      guildsTodas: todasGuilds,
      feed: this.feed.slice(-8),
    };
  }

  destruir() {
    this.vivo = false;
    this.tocando = false;
    this._desligarArrasto?.();
    this.campo.destruir();
  }
}
