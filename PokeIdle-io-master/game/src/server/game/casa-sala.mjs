/**
 * A CASA por dentro — a instância privada em que o jogador escolhe quem recebe o XP Share.
 *
 * ### Por que não é uma sala como o Centro Pokémon
 *
 * `centro.mjs` existe para resolver um problema que aqui não existe: **gente**. Lá o custo é
 * quadrático (cada passo de um participante entra no pacote de todos os outros), e daí as
 * salas de 40, o delta por membro e a varredura única de "quem mudou".
 *
 * A casa é de UM jogador. Não há fan-out, não há capacidade, não há sala com id. Cada
 * instância tem exatamente um humano dentro, e o resto são adereços: os bonecos de madeira
 * (parados) e os pokémon registrados no XP Share (parados também, cada um plantado de frente
 * para o boneco dele). O pacote vai para uma pessoa só, então o delta é o estado.
 *
 * ### O que a casa NÃO é
 *
 * Não é onde o XP Share acontece. Os postos são `p.xpShare`, e a fatia é creditada no abate,
 * lá na hunt — é essa a graça. Este módulo é a JANELA para eles: entrar na casa é ver, não é
 * ligar. Sair não interrompe nada.
 *
 * É por isso que aqui não há uma linha de XP: quem credita é `creditarXpShare`, no sim.
 *
 * ### O herói é o TREINADOR
 *
 * Como na praça e ao contrário da hunt: quem o jogador dirige com o teclado é o boneco dele,
 * e o `centro: true` do snapshot é justamente a bandeira que liga o WASD no cliente. O nome
 * do campo ficou de quando "centro" queria dizer a praça; o que ele quer dizer hoje é "área
 * social andável, sem combate".
 */

import {
  gradeDaHunt,
  andavel,
  darPasso,
  parado,
  direcaoDe,
  encaixar,
  serializarMob,
  serializarHeroi,
} from './campo.mjs';
import { empacotarVisual } from './visual.mjs';
import { bonecosDaRaridade } from '../../shared/casas.mjs';

/** Passo de 200 ms, como na praça: dois ticks de 100 ms, e é o que emenda um passo no outro. */
export const MS_PASSO = 200;

/** O slug da grade de uma raridade — o que `tools/build-walkgrids.mjs` gera. */
export const slugDaCasa = (raridade) => `casa-${raridade}`;

/**
 * O looktype do boneco de madeira.
 *
 * Fora da faixa do espelho de propósito (ver `itens-nossos.mjs` para o mesmo raciocínio com
 * os ids de item): 90920 carrega o 920 do arquivo de origem (`Boneco_920.png`) e o prefixo
 * que marca "arte nossa". O cliente resolve este looktype por um caminho próprio — não é um
 * outfit do atlas (ver `SPRITE_BONECO` no app.js).
 */
export const LOOKTYPE_BONECO = 90920;

/** 1=norte 2=leste 3=sul 4=oeste — a mesma numeração dos sprites e do resto do campo. */
const PASSO_DA_DIRECAO = { 1: [0, -1], 2: [1, 0], 3: [0, 1], 4: [-1, 0] };

/**
 * As tiles vizinhas do boneco, na ordem de preferência do posto de treino.
 *
 * Sul primeiro porque é de onde a câmera olha: o pokémon fica ENTRE o jogador e o boneco, de
 * costas para quem assiste e de cara para quem apanha. As outras três são a saída quando a
 * planta da casa põe um móvel ali.
 */
const VIZINHAS = [[0, 1], [-1, 0], [1, 0], [0, -1]];

/** Existe grade para esta raridade? Sem ela a casa não abre. */
export const casaDisponivel = (raridade) => {
  const g = gradeDaHunt(slugDaCasa(raridade));
  return !!g?.grid?.length;
};

const visivelNaAndar = (casa, ent) => (ent.z ?? casa.groundZ) === casa.andar;

function temEscada(casa, tipo, cx, cy) {
  return (casa.escadas?.[tipo] ?? []).some(([x, y]) => x === cx && y === cy);
}

/** Troca o pavimento andável — espelha `aplicarEscadaJogo` do nomeador. */
function tentarEscada(casa) {
  if (!casa.escadas) return false;
  const e = casa.tr;
  const gz = casa.groundZ;
  let dest = null;
  if (temEscada(casa, 'subir', e.cx, e.cy) && casa.andar >= gz) dest = gz - 1;
  else if (temEscada(casa, 'descer', e.cx, e.cy) && casa.andar < gz) dest = gz;
  if (dest == null || dest === casa.andar) return false;

  const novo = gradeDaHunt(casa.slug, dest);
  if (!novo?.grid?.length) return false;
  casa.andar = dest;
  casa.g = novo;
  if (!andavel(novo, e.cx, e.cy)) {
    const p = encaixar(novo, e.cx, e.cy);
    if (p) {
      e.cx = p.cx;
      e.cy = p.cy;
      e.deCx = p.cx;
      e.deCy = p.cy;
    }
  }
  for (const ent of casa.ents.values()) casa.mudou.add(ent.slot);
  return true;
}

function montarDelta(casa, t) {
  casa.seq++;
  const mudados = [...casa.mudou];
  casa.mudou.clear();

  const d = { seq: casa.seq, ts: t, alvo: null, andar: casa.andar };
  const mobs = [];
  const fora = [];
  for (const slot of mudados) {
    const ent = casa.ents.get(slot);
    if (!ent) {
      fora.push(slot);
      continue;
    }
    if (slot === casa.tr.slot) {
      d.heroi = serializarEu(casa);
      continue;
    }
    if (!visivelNaAndar(casa, ent)) {
      fora.push(slot);
      continue;
    }
    mobs.push(serializarEntidade(ent));
  }
  if (mobs.length) d.mobs = mobs;
  if (fora.length) d.fora = fora;
  if (!d.heroi && !d.mobs?.length && !d.fora?.length) return null;
  return d;
}

/**
 * Abre a casa para um jogador. `null` se a grade não foi gerada.
 *
 * `treinando` é a lista de `{ slot, pokemonId, nome, looktype, lookShiny, level, pctShare }`
 * que o sim monta a partir de `p.xpShare` — este módulo não conhece pokémon do jogador, só
 * desenha o que recebe.
 */
export function abrirCasa(p, raridade, treinando, agora) {
  const slug = slugDaCasa(raridade);
  const g0 = gradeDaHunt(slug);
  if (!g0?.grid?.length) return null;

  const groundZ = g0.groundZ ?? 7;
  const andar = groundZ;
  const g = gradeDaHunt(slug, andar) ?? g0;

  const casa = {
    raridade,
    slug,
    groundZ,
    andar,
    escadas: g0.escadas ?? null,
    g,
    seq: 0,
    ents: new Map(),
    proxSlot: 1,
    mudou: new Set(),
    dir: null,
    bonecos: [],
  };

  // ------------------------------------------------------------- o treinador
  const [ix, iy] = g.inicio;
  const slotTr = casa.proxSlot++;
  casa.tr = {
    slot: slotTr,
    cx: ix,
    cy: iy,
    deCx: ix,
    deCy: iy,
    dir: 3,
    passoEm: agora,
    passoMs: MS_PASSO,
    andando: false,
    nome: p.nick,
    looktype: p.looktype,
    visual: empacotarVisual(p.visual),
    ehTreinador: true,
  };
  casa.ents.set(slotTr, casa.tr);

  // --------------------------------------------------------------- bonecos
  //
  // Vêm dos pontos da grade marcados com a tag `boneco` no editor, NA ORDEM em que foram
  // marcados — e a raridade corta a lista. Hoje quatro raridades param no primeiro ponto e só
  // a Lendária chega ao segundo (ver `shared/casas.mjs`), mas o corte continua sendo por
  // `slice` e não por "pegue o único": rebalancear a escada de volta para mais bonecos é
  // mexer numa tabela, não neste arquivo.
  const quantos = bonecosDaRaridade(raridade);
  const pontosBoneco = (g0.pontos ?? []).filter((pt) => pt[3] === 'boneco').slice(0, quantos);
  for (const [x, y] of pontosBoneco) {
    const slot = casa.proxSlot++;
    const bonecoIndice = casa.bonecos.length;
    const e = {
      slot,
      bonecoIndice,
      npc: true,
      boneco: true,
      z: groundZ,
      cx: x,
      cy: y,
      deCx: x,
      deCy: y,
      dir: 3,
      passoEm: 0,
      passoMs: 1,
      andando: false,
      looktype: LOOKTYPE_BONECO,
      nome: 'Boneco',
      // O rótulo "XP Share X%" que a tela pendura em cima. `null` = posto vazio.
      pctShare: null,
    };
    casa.ents.set(slot, e);
    casa.bonecos.push(e);
  }

  sincronizarTreinos(casa, treinando, agora);
  return casa;
}

/**
 * Põe (ou tira) os pokémon registrados ao lado dos bonecos.
 *
 * Chamada na abertura e sempre que o XP Share muda de escalação enquanto o jogador está
 * dentro — trocar quem recebe precisa aparecer na hora, senão a tela mostra um pokémon que
 * não está mais lá.
 */
export function sincronizarTreinos(casa, treinando, agora) {
  if (!casa) return;
  const gChao = gradeDaHunt(casa.slug, casa.groundZ) ?? casa.g;
  const porSlot = new Map((treinando ?? []).map((t) => [t.slot, t]));

  // Primeira passada: o nível de cada boneco e a saída de quem foi tirado do treino. Vem
  // ANTES de qualquer chegada porque é ela que libera as tiles — tirar do slot 1 e escalar no
  // slot 2 no mesmo pacote é uma troca, e o que sai tem que sair antes de o que entra escolher
  // onde ficar.
  casa.bonecos.forEach((boneco, i) => {
    const pct = porSlot.has(i) ? porSlot.get(i).pctShare : null;
    if (boneco.pctShare !== pct) {
      boneco.pctShare = pct;
      casa.mudou.add(boneco.slot);
    }
    if (porSlot.has(i) || !boneco.pet) return;
    casa.ents.delete(boneco.pet.slot);
    casa.mudou.add(boneco.pet.slot);
    boneco.pet = null;
  });

  // As tiles que já têm dono. Sem isto, dois bonecos vizinhos podem mandar seus pokémon para a
  // MESMA tile livre entre eles — e dois sprites empilhados no mesmo lugar parecem bug.
  const ocupadas = new Set();
  for (const boneco of casa.bonecos) {
    ocupadas.add(`${boneco.cx},${boneco.cy}`);
    if (boneco.pet) ocupadas.add(`${boneco.pet.cx},${boneco.pet.cy}`);
  }

  casa.bonecos.forEach((boneco, i) => {
    const t = porSlot.get(i);
    if (!t) return;

    const aparencia = {
      nome: t.nome,
      looktype: t.looktype,
      lookShiny: t.lookShiny ?? null,
      level: t.level,
      shiny: !!t.shiny,
    };
    if (boneco.pet) {
      Object.assign(boneco.pet, aparencia, { pokemonId: t.pokemonId });
      casa.mudou.add(boneco.pet.slot);
      return;
    }
    const pos = postoDeTreino(gChao, boneco, ocupadas);
    ocupadas.add(`${pos.cx},${pos.cy}`);
    const slot = casa.proxSlot++;
    boneco.pet = {
      slot,
      ehPokemon: true,
      emTreino: true,
      z: casa.groundZ,
      // O índice do boneco É o posto de XP Share (os dois nascem da mesma ordem, ali em cima):
      // é por ele que a tela liga este pokémon ao XP que o evento `xpshare` credita.
      slotTreino: i,
      pokemonId: t.pokemonId,
      cx: pos.cx,
      cy: pos.cy,
      deCx: pos.cx,
      deCy: pos.cy,
      // Encarando o boneco, e travado assim: quem treina não vira as costas para o saco.
      dir: direcaoDe(boneco.cx - pos.cx, boneco.cy - pos.cy),
      passoEm: agora,
      passoMs: MS_PASSO,
      andando: false,
      ...aparencia,
    };
    casa.ents.set(slot, boneco.pet);
    casa.mudou.add(slot);
  });
}

/**
 * Onde o pokémon fica para bater no boneco: colado nele, na primeira vizinha livre e andável.
 *
 * O `encaixar` de reserva é para a casa mal desenhada — um boneco cercado de móvel dos quatro
 * lados. Ele afasta o pokémon até três tiles, e é feio, mas é melhor do que não desenhar o
 * pokémon que o jogador acabou de escalar.
 */
function postoDeTreino(g, boneco, ocupadas) {
  for (const [dx, dy] of VIZINHAS) {
    const cx = boneco.cx + dx;
    const cy = boneco.cy + dy;
    if (andavel(g, cx, cy) && !ocupadas.has(`${cx},${cy}`)) return { cx, cy };
  }
  return encaixar(g, boneco.cx, boneco.cy + 1, 3) ?? { cx: boneco.cx, cy: boneco.cy };
}

/** A tecla que o jogador está segurando. Fora de 1..4 (ou ausente) = parar. */
export function andarNaCasa(casa, dir) {
  if (!casa) return;
  casa.dir = PASSO_DA_DIRECAO[dir] ? dir : null;
}

/** Reflete uma troca de outfit ou de nick no boneco do jogador. */
export function atualizarAparencia(casa, p) {
  if (!casa) return;
  casa.tr.nome = p.nick;
  casa.tr.looktype = p.looktype;
  casa.tr.visual = empacotarVisual(p.visual);
  casa.mudou.add(casa.tr.slot);
}

/**
 * Um tick da casa. Devolve o delta, ou `null` quando nada mudou.
 *
 * Nada aqui decide nada de jogo, e desde que os pokémon deixaram de passear a única coisa que
 * se mexe é o treinador — quem entra e fica quieto não gera pacote nenhum. O XP é do
 * `creditarXpShare`, no sim, e continua pingando com a casa fechada.
 */
export function tickCasa(casa, t) {
  if (!casa) return null;

  // ------------------------------------------------------------ o treinador
  const e = casa.tr;
  if (e.andando && parado(e, t)) {
    e.andando = false;
    e.deCx = e.cx;
    e.deCy = e.cy;
    casa.mudou.add(e.slot);
    if (tentarEscada(casa)) return montarDelta(casa, t);
  }
  if (!e.andando && casa.dir) {
    const [dx, dy] = PASSO_DA_DIRECAO[casa.dir];
    if (e.dir !== casa.dir) {
      e.dir = casa.dir;
      casa.mudou.add(e.slot);
    }
    if (andavel(casa.g, e.cx + dx, e.cy + dy)) {
      darPasso(e, e.cx + dx, e.cy + dy, t, MS_PASSO);
      casa.mudou.add(e.slot);
    }
  }

  // --------------------------------------------------------- os em treino
  //
  // Nada. Eles ficam PARADOS de frente para o boneco, e é essa a diferença entre "treinando" e
  // "solto na sala": um pokémon que passeia enquanto o número de XP sobe em cima dele conta a
  // história errada. A investida, o efeito do golpe e o número que sobe são desenho, e por
  // isso vivem no cliente (ver `treinoAtaque` em `campo.mjs`) — mandar um pacote por soco
  // seria pagar banda por uma animação que ninguém precisa arbitrar.

  if (!casa.mudou.size) return null;
  return montarDelta(casa, t);
}

/** O boneco do próprio jogador — é nele que a câmera fica. */
const serializarEu = (casa) => ({
  ...serializarHeroi(casa.tr),
  lt: casa.tr.looktype,
  vs: casa.tr.visual,
  n: casa.tr.nome,
  tr: 1,
});

/**
 * Uma entidade da casa.
 *
 * `bn`/`tn` são os dois campos que só existem aqui: marcam que a entidade é um BONECO e qual
 * o nível do treino que acontece nele. É por `tn` que a tela escreve "Treinamento nvl 30" em
 * cima do boneco — mandar o texto pronto impediria a tradução, e mandar só o `bn` obrigaria o
 * cliente a cruzar boneco com escalação por conta própria.
 *
 * `ti` é o outro lado da mesma ponte: o POSTO a que este pokémon pertence. Sem ele
 * o cliente receberia dois pokémon iguais parados na sala Lendária e não saberia em qual
 * pendurar a barra de XP quando o evento `xpshare` do posto 1 chegar.
 */
function serializarEntidade(e) {
  const base = serializarMob(e);
  if (e.boneco) return { ...base, bn: 1, tn: e.pctShare ?? null, bi: e.bonecoIndice };
  if (e.emTreino) return { ...base, ti: e.slotTreino };
  return base;
}

/** A casa inteira, para o cliente montar a cena ao entrar. */
export function snapshotDaCasa(casa) {
  const mobs = [];
  for (const e of casa.ents.values()) {
    if (e.slot === casa.tr.slot) continue;
    if (!visivelNaAndar(casa, e)) continue;
    mobs.push(serializarEntidade(e));
  }
  return {
    slug: casa.slug,
    mapa: casa.g.mapa,
    ts: Date.now(),
    box: [casa.g.minTx, casa.g.minTy, casa.g.cols, casa.g.rows],
    groundZ: casa.groundZ,
    andar: casa.andar,
    // Liga o teclado e desliga o painel de captura — a mesma bandeira da praça.
    centro: true,
    // …mas a tela precisa distinguir as duas para trocar os botões do canto (aqui é
    // "Escolher pokémon" e "Sair de casa", lá é a Joy, o Depot e o Professor).
    casa: casa.raridade,
    heroi: serializarEu(casa),
    mobs,
    alvo: null,
  };
}
