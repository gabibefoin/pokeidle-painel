// O CENTRO POKÉMON: a praça de Cerulean, onde os treinadores se encontram.
//
// ### Por que este arquivo existe
//
// É o segundo lugar do jogo em que jogadores dividem um campo — o primeiro é a arena PvP. A
// diferença é o que se faz lá dentro: na arena eles trocam dano, aqui não acontece NADA. Sem
// combate, sem selvagem, sem loot. Só gente andando, o pokémon de batalha de cada um atrás do
// dono e o balão de quem falou no chat.
//
// Isso muda o que precisa ser resolvido. Na arena o problema é a briga (alvo, dano, ELO);
// aqui o problema é o MOVIMENTO: o jogador dirige o próprio boneco, com o teclado, e tem de
// parecer imediato. Por isso este módulo tem tick próprio, mais rápido que o do jogo.
//
// ### O tick de 100 ms e o passo de 200 ms
//
// O tick do sim é de 250 ms, e é o certo para um idle: o pokémon anda sozinho e ninguém
// percebe 250 ms. Para quem está com a mão no WASD, 250 ms é o tempo que a tecla leva para
// "responder" — dá a sensação de boneco pesado, escorregando.
//
// Então a praça anda em `TICK_MS` = 100 ms e o passo dura `MS_PASSO` = 200 ms, que é
// EXATAMENTE dois ticks. Essa conta importa: um passo que termina em cima de um tick deixa o
// seguinte começar no mesmo instante, e a caminhada sai contínua. Com passo de 260 ms num
// tick de 250 (o número da hunt), o passo acaba 10 ms depois do tick e o próximo só sai no
// tick seguinte — o boneco anda uma tile e fica 240 ms parado antes da próxima. Dá para o
// pokémon da hunt, que só faz isso enquanto caça; não dá para quem está dirigindo.
//
// O custo de banda NÃO é 2,5× o do tick normal: o pacote é delta, e só entra nele quem
// COMEÇOU um passo. Um jogador andando começa 5 passos por segundo, com tick de 100 ms ou de
// 250 ms. O que cresce é o número de pacotes, não o conteúdo deles.
//
// ### O que o cliente manda
//
// Só a direção que está segurando (`centro.andar`), quando ela MUDA — não uma mensagem por
// passo, e nada de posição. Quem decide para onde o boneco vai é aqui: se a tile é andável,
// se tem alguém em cima, se ainda dá tempo. Um cliente adulterado só consegue pedir "estou
// segurando para a direita".
//
// ### Salas
//
// Todo mundo que desmaia cai aqui, então a praça é o lugar do jogo com mais chance de juntar
// gente demais: cada participante vê todos os outros, e o custo é o quadrado da população.
// Por isso a praça é dividida em SALAS de `CAPACIDADE_SALA`. Quem entra vai para a primeira
// sala com vaga (não uma aleatória), que é o que mantém as pessoas juntas em vez de espalhá-las
// por salas pela metade.
//
// ### O limite do sharding, e por que aqui ele não pode recusar entrada
//
// Como a arena PvP, a praça só funciona dentro de UM processo: as salas vivem na memória do
// sim. Com `SHARD_COUNT > 1`, dois jogadores em shards diferentes não se veem — cada processo
// tem as suas salas.
//
// A arena resolve isso recusando a entrada quando o cluster está shardado. Aqui não dá: o
// Centro é para onde o jogo MANDA quem perdeu o time, e recusar deixaria o jogador sem lugar
// nenhum. Então a degradação é silenciosa e por partes — a praça continua funcionando, só que
// cada shard tem a sua. É a escolha certa para uma área social: ver menos gente é um
// aborrecimento, não poder curar o time é um jogo travado.
import {
  gradeDaHunt,
  andavel,
  passoRumoA,
  darPasso,
  chebyshev,
  serializarMob,
  serializarHeroi,
} from './campo.mjs';
import { passoComBicicleta } from '../../shared/bicicletas.mjs';
import { fatorPassoBicicleta } from './bicicletas.mjs';
import { especies } from '../content.mjs';
import { empacotarVisual } from './visual.mjs';

// ------------------------------------------------------------------ constantes

/** A grade da praça (`tools/build-walkgrids.mjs`, área especial "centro"). */
export const CENTRO_SLUG = 'centro';

/** Intervalo do tick da praça. Ver o cabeçalho: 100 ms é o que faz o WASD responder. */
export const TICK_MS = 100;

/** Duração de um passo. DOIS ticks exatos — é isso que emenda um passo no outro. */
export const MS_PASSO = 200;

/** Quanto a tela anda atrás do jogo no passo de bicicleta que não cabe em ticks (`passoNoRitmo`). */
export const FOLGA_RITMO_MS = TICK_MS + TICK_MS / 4;

/**
 * Quantos ms antes da conta um tick ainda vale como "o passo acabou". O `setInterval` atrasa na
 * média, mas às vezes chega 1 ms ANTES do fim redondo do passo — e sem tolerância o passo seguinte
 * esperava um tick inteiro: a Lendária (um passo por tick) dava um tranco a cada poucos passos.
 */
export const TOLERANCIA_TICK_MS = 5;

/**
 * Quantos treinadores cabem numa sala.
 *
 * O custo de uma sala é quadrático: cada passo de um participante entra no pacote de todos os
 * outros. Com 40 pessoas andando ao mesmo tempo dá ~8 mil atualizações de entidade por
 * segundo na sala inteira — a mesma ordem de grandeza do que a arena PvP já sustenta com a
 * mesma capacidade.
 */
export const CAPACIDADE_SALA = 40;

/**
 * A Enfermeira Joy e a Chansey.
 *
 * O looktype 1309 é a arte DELA — touca branca de cruz vermelha, cabelo rosa em argolas,
 * avental sobre o vestido rosa. Antes daqui a Joy era o outfit `Trainer` feminino (160)
 * pintado de rosa pela paleta, porque não se sabia que existia sprite própria no pack.
 *
 * Duas coisas mudam junto com ele, e as duas são de propósito:
 *
 * · **Não é colorizável.** Não tem máscara `_template`, então a paleta não a alcança — e não
 *   precisa: ela já vem rosa desenhada. Por isso a entidade dela vai sem `visual`.
 * · **Tem uma direção só.** Ela nunca anda nem vira (fica parada atrás do balcão, `dir: 3`),
 *   e `quadrosDe` cai na única direção que existir quando a pedida falta. Dos 10 quadros só
 *   o primeiro aparece: o 0 é o parado, 1..n são passos que ela nunca dá.
 *
 * A Chansey é a de verdade — o ponto de spawn da grade carrega o pokeId 113 e o looktype sai
 * do catálogo de espécies.
 */
const LOOKTYPE_ENFERMEIRA = 1309;

/**
 * O PROFESSOR CARVALHO, no canto direito do Centro.
 *
 * Era o "TM Researcher" e virou o Professor quando o balcão dele deixou de vender uma coisa
 * só. Hoje são quatro bancadas: as duas dos discos de TM (o que ele sempre fez), fabricar
 * Casa a partir de Fragmentos de Chave e fabricar Shiny Stone. Um NPC chamado pelo primeiro
 * dos serviços descreveria mal os outros — e o nome do lugar é o que o jogador usa para
 * lembrar onde ficam as coisas.
 *
 * **Tem ARTE PRÓPRIA (90921), fora do atlas.** Era o outfit `Trainer` feminino (160) pintado
 * de preto pela paleta, o que punha uma segunda "menina" na praça, a três tiles da Enfermeira
 * Joy — duas pessoas diferentes com a mesma silhueta, e o jogador tendo de ler o botão para
 * saber com quem estava falando. Como a Joy, ele agora vai SEM `visual`: a cor está desenhada
 * no PNG, não há máscara `_template` para a paleta alcançar. Ver `FOLHAS_PROPRIAS` no
 * `sprites.mjs` do cliente, que resolve este looktype a partir de `img/professor-carvalho.png`.
 *
 * A tag interna continua sendo `tm`: ela vem do ponto de spawn gravado no walkgrid, e trocá-la
 * exigiria regerar as grades de todo mundo para não ganhar nada. O que o jogador lê sai do
 * i18n (`cena.centroTm`).
 */
const LOOKTYPE_TM_RESEARCHER = 90921;

/** Atendente do Depot — sala de cura, canto esquerdo. */
const LOOKTYPE_DEPOT = 128;
const VISUAL_DEPOT = [52, 52, 52, 52];

/** Longe demais para valer a pena seguir a pé: o pokémon reaparece do lado do dono. */
const DIST_TELEPORTE_PET = 14;

// 1=norte 2=leste 3=sul 4=oeste — a mesma numeração dos sprites de outfit e do resto do campo.
const PASSO_DA_DIRECAO = { 1: [0, -1], 2: [1, 0], 3: [0, 1], 4: [-1, 0] };

// ------------------------------------------------------------------ estado vivo

/** Salas em execução, `id -> sala`. A primeira entrada cria, a última saída destrói. */
const salas = new Map();

// ------------------------------------------------------------------- a sala

function abrirSala() {
  const g = gradeDaHunt(CENTRO_SLUG);
  if (!g) return null;

  // O id é o menor NÚMERO LIVRE, não um contador que só cresce: as salas nascem e morrem o
  // tempo todo (a última pessoa a sair fecha a sala), e com um contador o primeiro jogador de
  // uma noite calma acabava sozinho na "sala 47". Como a tela só mostra o número quando ele
  // não é zero, reaproveitar o índice faz o servidor tranquilo não falar de sala nenhuma.
  let id = 0;
  while (salas.has(id)) id++;

  const sala = {
    id,
    g,
    seq: 0,
    ents: new Map(), // slot -> entidade (treinadores, pokémon e os dois NPCs)
    membros: new Map(), // key do jogador -> membro
    proxSlot: 1,
    mudou: new Set(),
  };

  // Os NPCs são entidades como as outras, só que ninguém as move. Entram uma vez, na abertura
  // da sala, e ficam — assim quem chega depois recebe as duas no snapshot sem caso especial.
  //
  // O ponto sem pokeId é a ENFERMEIRA, e ela vai marcada com `cura`. É por essa marca que o
  // cliente sabe em cima de qual boneco pendurar o botão de curar: procurar pelo nome
  // 'Enfermeira Joy' funcionaria hoje e quebraria no primeiro idioma novo.
  for (const pt of g.pontos) {
    const [x, y, pokeId, tag] = pt;
    const esp = pokeId ? especies.get(pokeId) : null;
    const ehDepot = tag === 'depot';
    const ehTm = tag === 'tm';
    const ehCura = tag === 'cura' || (!esp && !ehTm && !ehDepot);
    const slot = sala.proxSlot++;
    sala.ents.set(slot, {
      slot,
      npc: true,
      cura: ehCura,
      tm: ehTm,
      depot: ehDepot,
      cx: x,
      cy: y,
      deCx: x,
      deCy: y,
      dir: 3,
      passoEm: 0,
      passoMs: 1,
      andando: false,
      looktype: esp?.looktype
        ?? (ehDepot ? LOOKTYPE_DEPOT : ehTm ? LOOKTYPE_TM_RESEARCHER : LOOKTYPE_ENFERMEIRA),
      // a Joy vai sem `visual`: a arte dela não tem máscara, a cor já está desenhada
      // A Joy e o Professor vão SEM `visual`: a arte dos dois já vem colorida e não tem
      // máscara `_template` para a paleta alcançar. Só o Depot ainda é um outfit pintado.
      visual: esp ? undefined : ehDepot ? VISUAL_DEPOT : undefined,
      nome: esp?.name ?? (ehDepot ? 'Depot' : ehTm ? 'Professor Carvalho' : 'Enfermeira Joy'),
    });
  }

  salas.set(sala.id, sala);
  return sala;
}

/** A primeira sala com vaga — abrir uma nova só quando todas estiverem cheias. */
function salaComVaga() {
  for (const s of salas.values()) if (s.membros.size < CAPACIDADE_SALA) return s;
  return abrirSala();
}

/**
 * Ninguém trava ninguém: na praça os bonecos se atravessam.
 *
 * Isto já foi o contrário — treinadores ocupavam a tile e empurravam quem chegasse. Parece
 * mais "físico", mas numa área social vira ferramenta: três pessoas paradas lado a lado
 * fecham a entrada do Centro Pokémon, e não há nada que quem está de fora possa fazer. Numa
 * área sem combate, sem objetivo disputado e com a enfermeira do outro lado da porta, o
 * bloqueio só serve para atrapalhar de propósito.
 *
 * A ocupação continua existindo para UMA coisa: espalhar quem chega. Dois treinadores podem
 * dividir a mesma tile, mas nascer empilhado em cima de quem já estava é feio à toa.
 */
function ocupacao(sala) {
  const s = new Set();
  for (const e of sala.ents.values()) {
    if (e.ehPokemon) continue;
    s.add(e.cy * sala.g.cols + e.cx);
  }
  return s;
}

/** Tile livre mais próxima de (cx,cy) — andável E sem ninguém parado em cima. */
function vagaPerto(sala, cx, cy, raio = 8) {
  const ocupadas = ocupacao(sala);
  const livre = (x, y) => andavel(sala.g, x, y) && !ocupadas.has(y * sala.g.cols + x);
  if (livre(cx, cy)) return { cx, cy };
  for (let r = 1; r <= raio; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (livre(cx + dx, cy + dy)) return { cx: cx + dx, cy: cy + dy };
      }
    }
  }
  return null;
}

const novaEntidade = (slot, cx, cy, passoMs, agora) => ({
  slot,
  cx,
  cy,
  deCx: cx,
  deCy: cy,
  dir: 1, // de frente para o balcão da enfermeira, que fica ao norte da entrada
  passoEm: agora,
  passoMs,
  andando: false,
});

// ------------------------------------------------------------------ entrada

/**
 * Coloca o treinador na praça.
 *
 * O pokémon de batalha entra JUNTO, mas só se estiver de pé: chegar aqui com o time no chão é
 * o caso mais comum (foi o nocaute que trouxe o jogador), e um pokémon desmaiado andando atrás
 * do dono contaria uma mentira. Ele aparece assim que a enfermeira curar — quem faz isso é
 * `atualizarPokemon`.
 *
 * @param pk o pokémon ativo do jogador (ou null)
 * @returns {{sala, membro}|null}  null = a grade da praça não existe neste servidor
 */
export function entrarNoCentro(p, pk, agora) {
  if (p.centro) sairDoCentro(p);

  const sala = salaComVaga();
  if (!sala) return null;

  const [ix, iy] = sala.g.inicio;
  const pos = vagaPerto(sala, ix, iy) ?? { cx: ix, cy: iy };

  const slotTr = sala.proxSlot++;
  const tr = {
    ...novaEntidade(slotTr, pos.cx, pos.cy, MS_PASSO, agora),
    dono: p.key,
    nome: p.nick,
    looktype: p.looktype,
    visual: empacotarVisual(p.visual),
    ehTreinador: true,
  };

  const membro = {
    key: p.key,
    nick: p.nick,
    sala,
    tr,
    pet: null,
    // A direção que o jogador está SEGURANDO agora (null = parado). É o único dado que vem do
    // cliente, e ele é reavaliado a cada tick — largar a tecla é mandar `null`.
    dir: null,
    // O fator da bicicleta equipada (1 = a pé). Relido a cada tecla e a cada troca de bicicleta
    // (`atualizarVelocidade`): o tick só conhece o membro, não o jogador.
    fatorPasso: fatorPassoBicicleta(p),
  };

  sala.ents.set(slotTr, tr);
  sala.mudou.add(slotTr);
  sala.membros.set(p.key, membro);

  p.centro = { salaId: sala.id, slotTr, slotPet: null };
  atualizarPokemon(p, pk, agora);

  return { sala, membro };
}

/** Tira o treinador (e o pokémon dele) da praça. Sala vazia é destruída. */
export function sairDoCentro(p) {
  const membro = membroDe(p);
  if (!membro) {
    p.centro = null;
    return;
  }
  const sala = membro.sala;
  for (const slot of [membro.tr.slot, membro.pet?.slot]) {
    if (slot == null) continue;
    sala.ents.delete(slot);
    sala.mudou.add(slot);
  }
  sala.membros.delete(p.key);
  if (!sala.membros.size) salas.delete(sala.id);
  p.centro = null;
}

/**
 * Põe (ou tira) o pokémon de batalha ao lado do dono.
 *
 * Chamado na entrada, na troca de pokémon ativo e depois da cura — é a cura que faz o pokémon
 * levantar e aparecer. Trocar de ativo não recria a entidade: só troca a aparência, senão o
 * pokémon novo nasceria na entrada da praça enquanto o dono está do outro lado.
 */
export function atualizarPokemon(p, pk, agora) {
  const membro = membroDe(p);
  if (!membro) return;
  const sala = membro.sala;
  const dePe = pk && pk.hp > 0;

  if (!dePe) {
    if (!membro.pet) return;
    sala.ents.delete(membro.pet.slot);
    sala.mudou.add(membro.pet.slot);
    membro.pet = null;
    p.centro.slotPet = null;
    return;
  }

  const aparencia = {
    nome: pk.nome,
    looktype: pk.looktype,
    // `serializarMob` escolhe entre as duas artes; sem `lookShiny` o pokémon que segue o
    // jogador pela praça sairia na cor comum mesmo sendo shiny.
    lookShiny: pk.lookShiny ?? null,
    level: pk.level,
    shiny: pk.shiny,
  };

  if (membro.pet) {
    Object.assign(membro.pet, aparencia);
    sala.mudou.add(membro.pet.slot);
    return;
  }

  const tr = membro.tr;
  const pos = vagaPerto(sala, tr.cx, tr.cy, 3) ?? { cx: tr.cx, cy: tr.cy };
  const slot = sala.proxSlot++;
  membro.pet = {
    ...novaEntidade(slot, pos.cx, pos.cy, MS_PASSO, agora),
    dono: p.key,
    ehPokemon: true,
    ...aparencia,
  };
  sala.ents.set(slot, membro.pet);
  sala.mudou.add(slot);
  p.centro.slotPet = slot;
}

/**
 * Reflete no boneco uma troca de outfit ou de nick (as duas se compram na loja).
 *
 * Sem isto, quem veste uma cosplay estando na praça continua com a roupa velha para todo mundo
 * até sair e voltar — e como o Centro é onde as pessoas se veem, é justamente ali que a roupa
 * nova importa.
 */
export function atualizarAparencia(p) {
  const membro = membroDe(p);
  if (!membro) return;
  membro.nick = p.nick;
  membro.tr.nome = p.nick;
  membro.tr.looktype = p.looktype;
  membro.tr.visual = empacotarVisual(p.visual);
  membro.sala.mudou.add(membro.tr.slot);
}

/**
 * A tecla que o jogador está segurando. `dir` fora de 1..4 (ou ausente) quer dizer PARAR.
 *
 * Não move ninguém: só anota. Quem anda é o tick — e é isso que impede um cliente de "andar
 * mais rápido" mandando o comando várias vezes por segundo.
 */
export function andarNoCentro(p, dir) {
  const membro = membroDe(p);
  if (!membro) return;
  membro.dir = PASSO_DA_DIRECAO[dir] ? dir : null;
  membro.fatorPasso = fatorPassoBicicleta(p);
}

/** Relê a bicicleta equipada — o jogador trocou de bicicleta com a praça aberta. */
export function atualizarVelocidade(p) {
  const membro = membroDe(p);
  if (membro) membro.fatorPasso = fatorPassoBicicleta(p);
}

/**
 * Um passo na praça, no ritmo `ms`: o `MS_PASSO` a pé, ou mais curto com bicicleta.
 *
 * A pé (200 ms) e na Lendária (100 ms) o passo cabe em ticks inteiros: começa num tick e acaba
 * em cima de outro, como sempre foi. Os ritmos do meio (174, 160, 133, 114 ms) não cabem — o fim
 * do passo cai entre dois ticks e só é notado no seguinte. Dar o passo "quando parou" fazia toda
 * bicicleta abaixo da Lendária andar exatamente como a pé.
 *
 * Nesses ritmos o relógio do JOGO e o da TELA se separam:
 *
 *   · o jogo encadeia o passo seguinte no fim exato do anterior (`fimPasso`), e não no tick em
 *     que o fim foi notado — a velocidade média é a da bicicleta, sem perder o resto do tick;
 *   · a tela recebe o passo com início `FOLGA_RITMO_MS` depois desse fim. O pacote sai no primeiro
 *     tick depois do fim, e esse tick chega antes da folga, então o início cai no futuro de quem
 *     recebe e cada passo começa na tela exatamente onde o anterior termina. O cliente segura o
 *     passo em andamento até lá (`anterior`, em `client/campo.mjs`).
 *
 * A folga é um tick e um quarto, e não um tick exato, porque o `setInterval` atrasa um ou dois ms
 * por volta: com folga de um tick só, um fim que caísse logo depois de um tick quebrava a
 * caminhada. Um tick muito atrasado (servidor engasgado) ainda quebra — e aí o passo só recomeça
 * como uma arrancada, sem pulo.
 *
 * O primeiro passo de uma caminhada começa no tick e dura `ms + FOLGA_RITMO_MS` na tela: é ele
 * que abre a folga, e sai como a arrancada de quem estava parado. Enquanto a tela estiver com a
 * folga (tirou a bicicleta andando), até o passo a pé segue o relógio da tela.
 */
export function passoNoRitmo(e, cx, cy, t, ms) {
  const encadeado = e.fimPasso != null && t - e.fimPasso < FOLGA_RITMO_MS;
  const telaAtrasada = e.andando && e.passoEm + e.passoMs > t + TOLERANCIA_TICK_MS;
  if (ms % TICK_MS === 0 && !telaAtrasada) {
    // O tick que chegou um triz antes da conta começa o passo onde o anterior termina na tela.
    const inicio = encadeado ? Math.max(t, e.passoEm + e.passoMs) : t;
    darPasso(e, cx, cy, inicio, ms);
    e.fimPasso = inicio + ms;
  } else if (encadeado) {
    const inicio = e.fimPasso;
    darPasso(e, cx, cy, inicio + FOLGA_RITMO_MS, ms);
    e.fimPasso = inicio + ms;
  } else {
    darPasso(e, cx, cy, t, ms + FOLGA_RITMO_MS);
    e.fimPasso = t + ms;
  }
}

/** Livre para o próximo passo: parado, ou com o passo de JOGO já terminado (ver `passoNoRitmo`). */
export const podeDarPasso = (e, t) => !e.andando || (e.fimPasso != null && t + TOLERANCIA_TICK_MS >= e.fimPasso);

/** O passo acabou na TELA — o `parado` da hunt, com a tolerância de tick da praça. */
export const paradoNaPraca = (e, t) => t + TOLERANCIA_TICK_MS >= e.passoEm + e.passoMs;

// ------------------------------------------------------------------- o tick

function tickSala(sala, t) {
  const g = sala.g;

  // ---------------------------------------------------------- os treinadores
  for (const m of sala.membros.values()) {
    const e = m.tr;

    if (e.andando && paradoNaPraca(e, t)) {
      e.andando = false;
      e.deCx = e.cx;
      e.deCy = e.cy;
      sala.mudou.add(e.slot);
    }
    if (!podeDarPasso(e, t) || !m.dir) continue;

    const [dx, dy] = PASSO_DA_DIRECAO[m.dir];
    const nx = e.cx + dx;
    const ny = e.cy + dy;

    // Encarar a direção pedida acontece SEMPRE, mesmo sem sair do lugar. É o que deixa o
    // jogador virar o boneco de frente para quem chegou — e o que faz uma parede parecer
    // parede, em vez de a tecla não ter funcionado.
    if (e.dir !== m.dir) {
      e.dir = m.dir;
      sala.mudou.add(e.slot);
    }
    // A ÚNICA coisa que impede um passo é a parede (ver `ocupacao`): gente atravessa gente.
    if (!andavel(g, nx, ny)) continue;

    passoNoRitmo(e, nx, ny, t, passoComBicicleta(MS_PASSO, m.fatorPasso));
    sala.mudou.add(e.slot);
  }

  // -------------------------------------------------------------- os pokémon
  //
  // Andam DEPOIS dos donos, no mesmo tick: assim o passo do pokémon já mira a tile nova do
  // treinador e os dois saem juntos, com o pokémon uma tile atrás, em vez de um tick atrasado.
  for (const m of sala.membros.values()) {
    const pet = m.pet;
    if (!pet) continue;
    const tr = m.tr;

    if (pet.andando && paradoNaPraca(pet, t)) {
      pet.andando = false;
      pet.deCx = pet.cx;
      pet.deCy = pet.cy;
      sala.mudou.add(pet.slot);
    }
    if (!podeDarPasso(pet, t)) continue;

    const dist = chebyshev(pet.cx, pet.cy, tr.cx, tr.cy);
    if (dist <= 1) continue;

    // Ficou para trás de um jeito que não se resolve andando (o dono entrou, saiu e voltou,
    // ou atravessou a praça enquanto o pokémon estava preso atrás de gente): reaparece do lado.
    if (dist > DIST_TELEPORTE_PET) {
      const pos = vagaPerto(sala, tr.cx, tr.cy, 3);
      if (pos) {
        pet.cx = pet.deCx = pos.cx;
        pet.cy = pet.deCy = pos.cy;
        pet.andando = false;
        pet.passoEm = t;
        pet.fimPasso = null;
        sala.mudou.add(pet.slot);
        continue;
      }
    }

    // `null` de ocupação, como no dono: aqui ninguém tem física. Ver `ocupacao`.
    const passo = passoRumoA(g, pet.cx, pet.cy, tr.cx, tr.cy, null, 1);
    if (!passo) continue;
    // No ritmo do dono: com bicicleta, o pokémon acompanha em vez de ficar para trás.
    passoNoRitmo(pet, passo.cx, passo.cy, t, passoComBicicleta(MS_PASSO, m.fatorPasso));
    sala.mudou.add(pet.slot);
  }
}

/**
 * O tick de TODAS as salas. Devolve, por chave de jogador, o pacote de campo daquele membro.
 *
 * A varredura de "quem mudou" é UMA por sala, não uma por jogador: com 40 pessoas numa sala,
 * repetir a varredura por participante seria 40× o mesmo trabalho. Igual ao que a arena faz.
 */
export function tickCentro(t) {
  const pacotes = new Map();
  for (const sala of [...salas.values()]) {
    tickSala(sala, t);
    if (!sala.mudou.size) continue;

    sala.seq++;
    const mudados = [...sala.mudou];
    sala.mudou.clear();
    for (const membro of sala.membros.values()) {
      const d = deltaPara(sala, membro, mudados, t);
      if (d) pacotes.set(membro.key, d);
    }
  }
  return pacotes;
}

// ------------------------------------------------------------- serialização

/**
 * O boneco do próprio jogador — vai como `heroi`, que é quem a câmera segue.
 *
 * `tr` marca que este herói é um TREINADOR, não um pokémon. É por ele que a tela sabe que a
 * placa é um nick (amarela, sem barra de vida) em vez do nome de um bicho.
 */
const serializarEu = (membro) => ({
  ...serializarHeroi(membro.tr),
  lt: membro.tr.looktype,
  vs: membro.tr.visual,
  n: membro.nick,
  tr: 1,
});

/**
 * A praça como UM participante a vê.
 *
 * O ponto de vista é o oposto do da hunt. Lá o `heroi` é o pokémon (é ele que caça, e é nele
 * que a câmera precisa ficar); aqui o `heroi` é o TREINADOR, porque é ele que o jogador
 * dirige. O pokémon do próprio dono vai junto dos outros, em `mobs`.
 */
export function snapshotDoCentro(sala, membro) {
  const outros = [];
  for (const e of sala.ents.values()) {
    if (e.slot === membro.tr.slot) continue;
    outros.push(serializarMob(e));
  }
  return {
    slug: CENTRO_SLUG,
    mapa: sala.g.mapa,
    ts: Date.now(),
    box: [sala.g.minTx, sala.g.minTy, sala.g.cols, sala.g.rows],
    groundZ: sala.g.groundZ,
    // A bandeira que liga o teclado no cliente e desliga o painel de captura. O nome ficou de
    // quando o Centro era uma cena parada; o que ele quer dizer agora é "área social andável".
    centro: true,
    sala: sala.id,
    heroi: serializarEu(membro),
    // Sem `treinador`: na praça o treinador É o herói. O cliente limpa o boneco que sobrou da
    // hunt anterior justamente por este campo vir vazio.
    mobs: outros,
    alvo: null,
  };
}

/** Delta para um participante: o que mudou na sala, separando "eu" de "os outros". */
function deltaPara(sala, membro, mudados, t) {
  const d = { seq: sala.seq, ts: t, alvo: null };
  const mobs = [];
  const fora = [];
  for (const slot of mudados) {
    const e = sala.ents.get(slot);
    if (!e) {
      fora.push(slot);
      continue;
    }
    if (slot === membro.tr.slot) d.heroi = serializarEu(membro);
    else mobs.push(serializarMob(e));
  }
  if (mobs.length) d.mobs = mobs;
  if (fora.length) d.fora = fora;
  if (!d.heroi && !mobs.length && !fora.length) return null;
  return d;
}

// ---------------------------------------------------------------- consultas

/** O membro de um jogador (ou null). */
export function membroDe(p) {
  if (!p.centro) return null;
  return salas.get(p.centro.salaId)?.membros.get(p.key) ?? null;
}

/** A sala de um jogador (ou null). */
export const salaDe = (p) => membroDe(p)?.sala ?? null;

/** Quantos treinadores estão na praça agora, somando as salas. */
export function quantosNoCentro() {
  let n = 0;
  for (const s of salas.values()) n += s.membros.size;
  return n;
}
