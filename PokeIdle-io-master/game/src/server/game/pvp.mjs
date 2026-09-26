// ARENA PvP AO VIVO — APOSENTADA. Nada neste arquivo é alcançável hoje.
//
// O PvP individual passou a ser RANQUEADO e por fila (`game/pvp-ranqueado.mjs`): equipe
// fechada antes de entrar, partida simulada de uma vez no servidor e resultado em pontos de
// rank. O comando `pvp.entrar` do protocolo deixou de existir, e ele era o ÚNICO caminho
// para cá — sem ele, `entrarNaArena` nunca é chamada, `vivas` fica vazia para sempre e
// `tickArenas` devolve um mapa vazio a cada tick sem custo nenhum.
//
// O arquivo continua no repositório em vez de ser apagado por uma razão de risco, e não de
// gosto: a remoção completa toca ~50 pontos de `sim.mjs`, entre eles o caminho de desconexão,
// o tick e a migração entre shards — código que carrega OUTRAS funcionalidades. Arrancá-lo
// junto com a entrega do ranqueado misturaria duas mudanças com perfis de risco muito
// diferentes na mesma leva.
//
// **Quem for apagar** precisa levar junto, na mesma passada: `teste-pvp.mjs`, o `test:pvp` do
// package.json, `PVP_FICHA_ID`/`PVP_ENTRADA_GOLD` e o item Ficha PvP em `ITENS_COMPRAVEIS`, e
// todo o balé de `migrarParaArenaRemota`/`migrarDeVoltaParaCasa`/`filaRetornoArena` em
// `sim.mjs` (inclusive as mensagens `pvp.entrarRemoto`, `pvp.retornouDoRemoto` e
// `pvp.limparEmigrado` no barramento).
//
// O que está escrito daqui para baixo descreve o sistema como ele FOI, e é leitura de história.
//
// ---
//
// ARENA PvP: o único lugar do jogo onde dois jogadores se encostam.
//
// ### Por que este arquivo é diferente de todos os outros
//
// O resto do jogo é idle: cada jogador tem o PRÓPRIO campo, com os PRÓPRIOS selvagens, e
// nunca esbarra em ninguém. É essa independência que deixa shardar por jogador
// (`shardDoJogador`) sem coordenação nenhuma — dois vizinhos de hunt podem estar em processos
// diferentes e ninguém percebe.
//
// A arena quebra exatamente essa premissa: os participantes precisam se ver, se perseguir e
// trocar dano. Então aqui o dono autoritativo não é o shard do jogador — é a ARENA. Um campo
// só, compartilhado, com todo mundo dentro dele.
//
// ### Multi-shard: migração, não distribuição
//
// Com `SHARD_COUNT > 1`, as arenas moram inteiras num shard só (`config.arenaShardId`, hoje o
// 0). Quem entra vindo de outro shard é MIGRADO para lá antes: `sim.mjs` grava o jogador no
// Postgres, tira ele da própria memória e pede para o shard da arena recarregá-lo (o mesmo
// caminho do `entrar()` de reconexão) — dali em diante ele é um jogador local de verdade para
// aquele processo, e este arquivo nem sabe que houve migração. Ao sair da arena, o mesmo
// acontece ao contrário. Esse balé todo mora em `sim.mjs`; aqui dentro o único fio que amarra
// é o gancho `aposSairDaArena`, chamado no fim de `sairDaArena` — é o ÚNICO ponto por onde todo
// mundo sai (saída voluntária, nocaute sem suplente, desconexão), então é o ÚNICO lugar que
// `sim.mjs` precisa observar para saber "acabou, decide se manda esse jogador para casa".
//
// ### As regras que vieram do pedido
//
//   · duas arenas, as duas maiores áreas andáveis do espelho;
//   · entra quem quiser, briga contra quem já estava e contra quem chegar depois;
//   · o pokémon ataca o mais PRÓXIMO, sempre;
//   · matar sobe o ELO, morrer desce o ELO **e** custa XP do treinador;
//   · para sair é preciso ficar 10 s fora de combate e então ir ao Centro Pokémon;
//   · "em combate" é DANO — aplicado ou recebido. Perseguir não conta;
//   · quem sai da arena só volta a entrar depois de 5 minutos (é o que impede a turma de
//     entrar em fila só para segurar alguém dentro do combate para sempre).
import {
  gradeDaHunt,
  encaixar,
  passoRumoA,
  darPasso,
  parado,
  chebyshev,
  serializarMob,
  serializarHeroi,
  MS_PASSO_HEROI,
  MS_PASSO_TREINADOR,
  LOOKTYPE_TREINADOR,
  DIST_COMBATE,
} from './campo.mjs';
import { especies, calcularStats, hpDeCombate, multDeNascenca } from '../content.mjs';
import { aplicarPerdaDeXpTreinador, XP_PERDIDO_MORTE } from './morte-xp.mjs';
import { calcularDano, melhorGolpe, cooldownComSpeed, ivSpeedDe } from './combate.mjs';
import { empacotarVisual } from './visual.mjs';
import { nivelMinimoTreinador } from '../../shared/pokemon-nivel-treinador.mjs';
// ------------------------------------------------------------------ constantes

/**
 * As duas arenas.
 *
 * `slug` é uma grade andável que já existe no espelho — as duas MAIORES, medidas em
 * `world/walkgrids.json`: dusclops tem 4.320 tiles andáveis e brave_charizard 3.409. Um mapa
 * novo exigiria regerar o walkgrids (e ter os 238 MB de mapas em disco); reaproveitar dois
 * mapas grandes dá a "arena muito grande" pedida sem nenhum passo de build a mais.
 */
/** Treinador precisa ter pelo menos este nível para pisar em qualquer arena. */
export const PVP_NIVEL_MIN = 80;

/** Item consumido ao entrar numa arena — comprado no Market (seção Arena). */
export const PVP_FICHA_ID = 70001;

/**
 * Preço de 1 Ficha PvP no Market (coins).
 *
 * Os 1.000.000 foram precificados contra a economia velha, e ali eles queriam dizer coisas
 * opostas nas duas pontas: 3.700 abates para quem estava no nível 100 e **4** para quem estava
 * no 25.000. Com o ouro travado (ver `shared/economia-drop.mjs`) a renda por abate passa a ser
 * quase a mesma para todo mundo acima do 100, então um preço fixo finalmente significa o mesmo
 * esforço para todos — e é por isso que ele pôde cair para um número honesto: ~35 abates,
 * uns dois minutos e meio de caçada.
 */
export const PVP_ENTRADA_GOLD = 250_000;

export const ARENAS = [
  {
    id: 'ancestral',
    nome: 'Arena Ancestral',
    slug: 'dusclops',
    capacidade: 40,
    capNivel: 120,
  },
  { id: 'flamejante', nome: 'Arena Flamejante', slug: 'brave_charizard', capacidade: 40 },
];

export const arenaPorId = new Map(ARENAS.map((a) => [a.id, a]));

/** ELO de quem nunca lutou. */
export const ELO_INICIAL = 1000;

/** ELO mínimo — sem piso, uma sequência ruim leva o número a negativo e a tabela fica feia. */
export const ELO_MINIMO = 100;

/**
 * Fator K do Elo. 24 é o meio-termo dos xadrezes online: uma vitória contra um igual move
 * 12 pontos, contra um muito mais forte move perto de 24, e contra um muito mais fraco
 * move ~1. É o que faz o placar convergir sem que uma noite de sorte vire título.
 */
export const ELO_K = 24;

/** Segundos sem dano (nos dois sentidos) para poder deixar a arena. */
export const PVP_SAIDA_MS = 10_000;

/** Espera até poder entrar de novo. Conta a partir da SAÍDA, não da entrada. */
export const PVP_COOLDOWN_MS = 5 * 60_000;

/**
 * Fatia do XP do nível atual que a morte em PvP cobra.
 *
 * Do nível é de propósito, não do total: 10% do XP acumulado de um treinador nível 80 seria
 * uma queda de vários níveis por morte. Assim a punição dói igual em qualquer nível e nunca
 * faz descer de nível — o piso é o XP de entrada do nível.
 */
export const PVP_XP_PERDIDO = XP_PERDIDO_MORTE;

/** Intervalo mínimo entre dois golpes do mesmo lutador na arena. */
const CD_GOLPE_MS = 900;

/** O pokémon procura briga neste raio; fora dele, anda até o mais próximo de qualquer jeito. */
const DIST_PVP = DIST_COMBATE;

// ------------------------------------------------------------------ estado vivo

/**
 * As arenas em execução, `id -> arena`. Só existe arena com gente dentro: a primeira entrada
 * cria, a última saída destrói. Um mapa parado não custa tick.
 */
const vivas = new Map();

/** Ganchos que o sim injeta no boot — evita import circular entre sim.mjs e este arquivo. */
let ganchos = {
  evento: () => {},
  enviar: () => {},
  marcarSujo: () => {},
  ativo: () => null,
  irParaOCentro: () => {},
  // Chamado no fim de `sairDaArena`, sempre — é como `sim.mjs` sabe que um jogador migrado
  // (veio de outro shard) precisa voltar para casa. Quem nunca saiu do próprio shard (o caso
  // de sempre, com SHARD_COUNT=1 ou quando a arena já é local) não aciona migração nenhuma.
  aposSairDaArena: () => {},
};

export const ligarGanchos = (g) => (ganchos = { ...ganchos, ...g });

// ------------------------------------------------------------------- o ELO

/**
 * Elo clássico. `sa` é 1 para quem venceu e 0 para quem perdeu.
 *
 * O ganho de um é exatamente a perda do outro, então a soma do ELO da arena é constante —
 * não dá para inflar o placar combinando mortes com um amigo.
 */
export function novoElo(elo, eloOponente, sa) {
  const esperado = 1 / (1 + 10 ** ((eloOponente - elo) / 400));
  return Math.round(elo + ELO_K * (sa - esperado));
}

// --------------------------------------------------------------- a arena viva

function abrirArena(def) {
  const g = gradeDaHunt(def.slug);
  if (!g) return null;
  const arena = {
    ...def,
    g,
    seq: 0,
    // slot -> entidade. Cada participante ocupa DOIS slots: o pokémon e o treinador.
    ents: new Map(),
    proxSlot: 1,
    // key do jogador -> participante
    membros: new Map(),
    mudou: new Set(),
  };
  vivas.set(def.id, arena);
  return arena;
}

/** Quantos treinadores estão dentro de cada arena, para a tela de escolha. */
export const ocupacaoDasArenas = () =>
  ARENAS.map((a) => ({
    id: a.id,
    nome: a.nome,
    capacidade: a.capacidade,
    dentro: vivas.get(a.id)?.membros.size ?? 0,
  }));

/** Célula ocupada por algum pokémon vivo — treinador não conta (ele anda junto do dono). */
function ocupacao(arena) {
  const s = new Set();
  for (const e of arena.ents.values()) {
    if (e.ehTreinador || e.hp <= 0) continue;
    s.add(e.cy * arena.g.cols + e.cx);
  }
  return s;
}

/**
 * Nível, stats e HP efetivos DENTRO da arena.
 *
 * Na Ancestral, quem entra com pokémon acima do cap luta como se fosse nv 120 — só na arena.
 * O pokémon real (`player_pokemon`) não muda de nível nem de stats; ao sair, volta a valer o
 * de verdade. O HP copiado é proporcional ao máximo real, recalculado no teto da arena.
 */
function statsDeCombateArena(arena, pk) {
  const cap = arena.capNivel;
  if (!cap || pk.level <= cap) {
    return { level: pk.level, stats: pk.stats, maxHp: pk.maxHp, hp: pk.hp };
  }
  const esp = especies.get(pk.speciesId);
  // `pk.refino` entra aqui pelo mesmo motivo que a qualidade e a potência: a Ancestral rebaixa
  // o NÍVEL, não o pokémon. Sem ele, quem investiu pedras perdia o investimento ao passar do
  // cap — exatamente na arena em que ele mais valeria.
  const stats = calcularStats(esp, pk.ivs, cap, pk.quality, multDeNascenca(pk.potencia, pk.shiny), pk.refino);
  const maxHp = hpDeCombate(stats.hp);
  const hp = Math.max(1, Math.min(pk.hp, Math.round((pk.hp / pk.maxHp) * maxHp)));
  return { level: cap, stats, maxHp, hp };
}

/** Copia o HP da entidade da arena de volta para o pokémon real (proporcional ao maxHp real). */
function sincronizarHpArenaParaReal(arenaPk, pkReal) {
  if (!arenaPk || !pkReal) return;
  if (arenaPk.hp <= 0 || arenaPk.maxHp <= 0) {
    pkReal.hp = 0;
    return;
  }
  const ratio = arenaPk.hp / arenaPk.maxHp;
  pkReal.hp = Math.max(1, Math.min(pkReal.maxHp, Math.round(ratio * pkReal.maxHp)));
}

/** Herói na arena leva nv/hp — o `serializarHeroi` da hunt só manda posição. */
function serializarHeroiPvp(pk) {
  return {
    ...serializarHeroi(pk),
    hp: pk.hp,
    mhp: pk.maxHp,
    nv: pk.level,
    n: pk.nome,
    lt: (pk.shiny && pk.lookShiny) || pk.looktype,
    sh: pk.shiny ? 1 : 0,
  };
}

function montarPkArena(arena, pk, base, slotPk, donoKey) {
  const c = statsDeCombateArena(arena, pk);
  return {
    ...base,
    slot: slotPk,
    dono: donoKey,
    nome: pk.nome,
    looktype: pk.looktype,
    lookShiny: pk.lookShiny ?? null,
    level: c.level,
    shiny: pk.shiny,
    tipos: pk.tipos,
    stats: c.stats,
    ivSpeed: ivSpeedDe(pk),
    speciesId: pk.speciesId,
    hp: c.hp,
    maxHp: c.maxHp,
    morto: false,
  };
}

/** Troca a aparência/stats da entidade de campo sem mover o slot — troca manual ou suplente. */
function reaplicarPkNaEntidadeArena(arena, entidade, pkReal) {
  const c = statsDeCombateArena(arena, pkReal);
  entidade.nome = pkReal.nome;
  entidade.looktype = pkReal.looktype;
  entidade.lookShiny = pkReal.lookShiny ?? null;
  entidade.level = c.level;
  entidade.shiny = pkReal.shiny;
  entidade.tipos = pkReal.tipos;
  entidade.stats = c.stats;
  entidade.ivSpeed = ivSpeedDe(pkReal);
  entidade.speciesId = pkReal.speciesId;
  entidade.hp = c.hp;
  entidade.maxHp = c.maxHp;
  entidade.morto = false;
}

/**
 * Troca manual de pokémon ativo dentro da arena.
 * O pokémon que sai leva o HP proporcional de volta; o que entra usa stats capados da arena.
 */
export function trocarPokemonNaArena(p, pk, agora) {
  if (!p.pvp) return { ok: false, msg: 'você não está numa arena' };
  const arena = vivas.get(p.pvp.arenaId);
  const membro = arena?.membros.get(p.key);
  if (!arena || !membro?.pk) return { ok: false, msg: 'arena indisponível' };
  if (!pk || pk.slot == null) return { ok: false, msg: 'esse pokémon não está na equipe' };
  if (pk.hp <= 0) return { ok: false, msg: 'esse pokémon está nocauteado' };
  if (pk.id === p.activeId) return { ok: true };

  const saindo = ganchos.ativo(p);
  if (saindo && saindo.id !== pk.id) {
    sincronizarHpArenaParaReal(membro.pk, saindo);
    ganchos.marcarSujo(p, saindo);
  }

  reaplicarPkNaEntidadeArena(arena, membro.pk, pk);
  membro.cdGolpes = {};
  membro.proxGolpe = agora + 1500;
  arena.mudou.add(membro.pk.slot);
  ganchos.evento(p, { k: 'troca', id: pk.id, nome: pk.nome });
  ganchos.enviar(p, { t: 'campo', ts: agora, heroi: serializarHeroiPvp(membro.pk) });
  return { ok: true };
}

/** Ponto de entrada: espalha os que chegam pelos pontos de spawn da grade. */
function pontoDeEntrada(arena) {
  const pontos = arena.g.pontos.length ? arena.g.pontos : [arena.g.inicio];
  const p = pontos[Math.floor(Math.random() * pontos.length)];
  return encaixar(arena.g, p[0], p[1]) ?? { cx: arena.g.inicio[0], cy: arena.g.inicio[1] };
}

// ------------------------------------------------------------------ entrada

/**
 * Coloca o treinador dentro de uma arena.
 *
 * Quem chama já garantiu que `p` está no processo CERTO (o dono das arenas, ver o cabeçalho
 * do arquivo) — esta função não sabe nada sobre shard, só sobre o jogador em memória.
 *
 * @returns {{ok:true}|{ok:false, msg:string}}
 */
export function entrarNaArena(p, arenaId, agora) {
  const def = arenaPorId.get(arenaId);
  if (!def) return { ok: false, msg: 'Arena desconhecida.' };
  if (p.pvp) return { ok: false, msg: 'Você já está numa arena.' };
  if (p.level < PVP_NIVEL_MIN) {
    return { ok: false, msg: `A Arena PvP exige nível ${PVP_NIVEL_MIN} ou mais (seu nv ${p.level}).` };
  }

  // O COOLDOWN é conferido antes do time nocauteado de propósito.
  //
  // Quem acabou de morrer na arena falha nos dois: está no Centro Pokémon E dentro dos 5
  // minutos. Avisar do time primeiro mandava o jogador curar, voltar e só então descobrir a
  // espera — a trava mais longa é a que ele precisa saber agora.
  if (agora < (p.pvpCooldownAte ?? 0)) {
    const s = Math.ceil((p.pvpCooldownAte - agora) / 1000);
    return { ok: false, msg: `Aguarde ${Math.floor(s / 60)}m ${s % 60}s para entrar de novo.` };
  }

  // Da praça do Centro Pokémon SE ENTRA na arena, e é o caminho natural: é lá que o time é
  // curado e onde a turma se junta para combinar a briga. A trava que existia aqui não
  // protegia nada — quem estava com o time no chão já é barrado logo abaixo, pelo pokémon de
  // pé, e quem estava curado só era obrigado a dar a volta pelo Mapa sem motivo nenhum.
  const pk = ganchos.ativo(p);
  if (!pk || pk.hp <= 0) return { ok: false, msg: 'Você precisa de um pokémon de pé.' };
  if (!ganchos.podeUsarPokemon?.(p, pk)) {
    return {
      ok: false,
      msg: `${pk.nome} é nv ${pk.level} — você precisa ser pelo menos nv ${nivelMinimoTreinador(pk.level)} para usá-lo.`,
    };
  }

  const arena = vivas.get(arenaId) ?? abrirArena(def);
  if (!arena) return { ok: false, msg: 'A área desta arena não está disponível.' };
  if (arena.membros.size >= def.capacidade) return { ok: false, msg: 'Arena lotada.' };

  const pos = pontoDeEntrada(arena);

  // O pokémon e o treinador entram como duas entidades no MESMO campo compartilhado. Quem
  // olha de fora vê os dois; o dono vê o próprio pokémon como "herói" (ver `viewDe`).
  const membro = {
    key: p.key,
    nick: p.nick,
    dbId: p.dbId,
    gatewayId: p.gatewayId,
    elo: p.elo ?? ELO_INICIAL,
    entrouEm: agora,
    // Carimbo do último DANO trocado (aplicado ou recebido). É ele que decide se dá para sair.
    emCombateAte: 0,
    proxGolpe: agora + 1500, // ninguém abre a briga no frame em que entrou
    cdGolpes: {},
    abates: 0,
    mortes: 0,
  };

  const slotPk = arena.proxSlot++;
  const slotTr = arena.proxSlot++;

  const base = (cx, cy, passoMs) => ({
    cx, cy, deCx: cx, deCy: cy, dir: 3, passoEm: agora, passoMs, andando: false,
  });

  membro.pk = montarPkArena(arena, pk, base(pos.cx, pos.cy, MS_PASSO_HEROI), slotPk, p.key);
  membro.tr = {
    ...base(pos.cx, pos.cy, MS_PASSO_TREINADOR),
    slot: slotTr,
    dono: p.key,
    ehTreinador: true,
    nome: p.nick,
    // A outfit e as cores do DONO: na arena os bonecos são de outros jogadores, e um mar de
    // treinadores idênticos tirava justamente o que faz a arena parecer cheia de gente.
    looktype: p.looktype ?? LOOKTYPE_TREINADOR,
    visual: empacotarVisual(p.visual),
    elo: membro.elo,
  };

  arena.ents.set(slotPk, membro.pk);
  arena.ents.set(slotTr, membro.tr);
  arena.mudou.add(slotPk);
  arena.mudou.add(slotTr);
  arena.membros.set(p.key, membro);

  p.pvp = { arenaId, slotPk, slotTr };
  p.boss = null;
  p.campo = null;
  p.selvagem = null;
  p.cdGolpes = {};
  ganchos.marcarSujo(p);

  return { ok: true, arena, membro };
}

/**
 * Tira o treinador da arena.
 *
 * `motivo`: 'saiu' (foi ao Centro por vontade própria) | 'morreu' | 'desconectou'. Os três
 * disparam o cooldown de 5 minutos — inclusive o disconnect, senão bastaria fechar a aba
 * para zerar a espera.
 */
export function sairDaArena(p, motivo, agora) {
  if (!p.pvp) return null;
  const arena = vivas.get(p.pvp.arenaId);
  const membro = arena?.membros.get(p.key);

  if (membro?.pk) {
    const pkReal = ganchos.ativo(p);
    if (pkReal) {
      sincronizarHpArenaParaReal(membro.pk, pkReal);
      ganchos.marcarSujo(p, pkReal);
    }
  }

  if (arena) {
    arena.ents.delete(p.pvp.slotPk);
    arena.ents.delete(p.pvp.slotTr);
    arena.mudou.add(p.pvp.slotPk);
    arena.mudou.add(p.pvp.slotTr);
    arena.membros.delete(p.key);
    // Arena vazia não fica ocupando tick — a próxima entrada reabre.
    if (!arena.membros.size) vivas.delete(arena.id);
  }

  p.pvp = null;
  p.pvpCooldownAte = agora + PVP_COOLDOWN_MS;
  ganchos.marcarSujo(p);
  ganchos.evento(p, { k: 'pvpSaiu', motivo, cooldownAte: p.pvpCooldownAte });
  // Único ponto de saída da arena (voluntária, nocaute sem suplente, desconexão) — é daqui
  // que `sim.mjs` decide se este jogador veio migrado de outro shard e precisa voltar.
  ganchos.aposSairDaArena(p, motivo);
  return membro;
}

/**
 * Fechar a aba dentro da arena conta como MORRER lá.
 *
 * Sem isto, o disconnect era a saída perfeita: a briga perdida acabava sem custo nenhum, e o
 * jogador voltava com o ELO intacto. O cooldown de 5 minutos que `sairDaArena` carimba resolve
 * a volta imediata, mas não devolve nada a quem estava ganhando a luta.
 *
 * O ELO é calculado contra a MÉDIA de quem ficou na arena — abandonar é perder para a sala,
 * não para um oponente específico. Sozinho na arena não há para quem perder, e aí só a saída
 * é registrada; nesse caso ninguém estava ganhando nada de você.
 *
 * Precisa ser chamado ANTES de `sairDaArena`: depois dele o participante já não existe.
 *
 * @returns {{elo:number, delta:number, xpPerdido:number}|null}
 */
export function penalizarAbandono(p, agora) {
  const arena = arenaDe(p);
  const membro = arena?.membros.get(p.key);
  if (!membro) return null;

  const outros = [...arena.membros.values()].filter((m) => m !== membro);
  if (!outros.length) return null;

  const media = Math.round(outros.reduce((s, m) => s + m.elo, 0) / outros.length);
  const antes = membro.elo;
  membro.elo = Math.max(ELO_MINIMO, novoElo(antes, media, 0));
  p.elo = membro.elo;
  p.pvpMortes = (p.pvpMortes ?? 0) + 1;
  const xpPerdido = aplicarPerdaDeXpTreinador(p, ganchos.consumirBless);

  ganchos.marcarSujo(p);
  ganchos.atualizarPosicaoPvp?.(p);
  return { elo: membro.elo, delta: membro.elo - antes, xpPerdido };
}

/** Está livre para ir ao Centro Pokémon? Só depois de 10 s sem trocar dano. */
export function podeSairDaArena(p, agora) {
  const arena = vivas.get(p.pvp?.arenaId);
  const m = arena?.membros.get(p.key);
  if (!m) return true;
  return agora >= m.emCombateAte + PVP_SAIDA_MS;
}

/** Quanto falta, em ms, para o botão de sair liberar. 0 = liberado. */
export function msParaSair(p, agora) {
  const arena = vivas.get(p.pvp?.arenaId);
  const m = arena?.membros.get(p.key);
  if (!m) return 0;
  return Math.max(0, m.emCombateAte + PVP_SAIDA_MS - agora);
}

// ------------------------------------------------------------------ o tick

/** Marca os DOIS lados como em combate. É só isto que trava a saída. */
function marcarCombate(a, b, agora) {
  a.emCombateAte = agora;
  b.emCombateAte = agora;
}

/** Pokémon inimigo vivo mais próximo — a regra é "o mais perto", sem lista de alvo. */
function inimigoMaisProximo(arena, membro) {
  const meu = membro.pk;
  let melhor = null;
  let melhorD = Infinity;
  for (const outro of arena.membros.values()) {
    if (outro === membro || outro.pk.hp <= 0) continue;
    const d = chebyshev(meu.cx, meu.cy, outro.pk.cx, outro.pk.cy);
    if (d < melhorD) {
      melhorD = d;
      melhor = outro;
    }
  }
  return melhor;
}

/**
 * Um tick de uma arena: todo mundo anda, quem está encostado troca golpes.
 *
 * Roda UMA vez por arena (não uma vez por jogador), porque o campo é compartilhado — é o que
 * garante que os dois lados de uma briga vejam o mesmo dano no mesmo instante.
 */
function tickArena(arena, t, jogadores) {
  const g = arena.g;
  const ocupadas = ocupacao(arena);
  const celula = (cx, cy) => cy * g.cols + cx;

  for (const membro of arena.membros.values()) {
    const p = jogadores.get(membro.key);
    if (!p) continue;
    const e = membro.pk;

    // fim do passo anterior
    if (e.andando && parado(e, t)) {
      e.andando = false;
      e.deCx = e.cx;
      e.deCy = e.cy;
      arena.mudou.add(e.slot);
    }

    const alvo = inimigoMaisProximo(arena, membro);
    membro.alvo = alvo?.key ?? null;
    if (!alvo) continue;

    const dist = chebyshev(e.cx, e.cy, alvo.pk.cx, alvo.pk.cy);

    // --------------------------------------------------------------- andar
    if (dist > DIST_PVP && parado(e, t)) {
      const passo = passoRumoA(g, e.cx, e.cy, alvo.pk.cx, alvo.pk.cy, ocupadas, DIST_PVP);
      if (passo) {
        ocupadas.delete(celula(e.cx, e.cy));
        ocupadas.add(celula(passo.cx, passo.cy));
        darPasso(e, passo.cx, passo.cy, t, MS_PASSO_HEROI);
        arena.mudou.add(e.slot);
      }
      continue; // andou neste tick: não bate também
    }
    if (dist > DIST_PVP) continue;

    // --------------------------------------------------------------- brigar
    if (t < membro.proxGolpe) continue;
    if (e.hp <= 0) continue;

    const golpe = melhorGolpe(
      especies.get(e.speciesId),
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
      // O ×1,8 é o multiplicador do SELVAGEM de hunt. Entre jogadores não entra: os dois
      // lados são pokémon de treinador, com os mesmos stats e as mesmas contas.
      ehSelvagem: false,
    });

    // O HP que vale é o da ENTIDADE da arena — o pokémon real só é atualizado ao sair.
    const alvoP = jogadores.get(alvo.key);
    if (!alvoP) continue;

    alvo.pk.hp = Math.max(0, alvo.pk.hp - r.dano);
    arena.mudou.add(alvo.pk.slot);

    // AQUI é o que conta como "em combate": dano trocado. Perseguir não marca nada.
    marcarCombate(membro, alvo, t);
    ganchos.marcarSujo(alvoP);

    const evAtaque = {
      k: 'ataque',
      por: 'pvp',
      slot: alvo.pk.slot,
      golpe: golpe.name,
      tipo: golpe.type,
      dano: r.dano,
      ef: r.efetividade,
      stab: r.stab,
      hpAlvo: alvo.pk.hp,
      de: membro.nick,
      para: alvo.nick,
    };
    ganchos.evento(p, evAtaque);
    ganchos.evento(alvoP, { ...evAtaque, slot: membro.pk.slot, por: 'pvpInimigo' });

    if (alvo.pk.hp <= 0) abater(arena, membro, alvo, p, alvoP, t, jogadores);
  }

  // ------------------------------------------------------------- treinadores
  // Cada treinador anda atrás do próprio pokémon, um passo mais devagar — a mesma regra da
  // hunt. Não entra na ocupação: dois bonecos do mesmo dono na mesma tile é melhor do que o
  // treinador travando o caminho de uma briga.
  for (const membro of arena.membros.values()) {
    const tr = membro.tr;
    if (tr.andando && parado(tr, t)) {
      tr.andando = false;
      tr.deCx = tr.cx;
      tr.deCy = tr.cy;
      arena.mudou.add(tr.slot);
    }
    if (!parado(tr, t)) continue;
    if (chebyshev(tr.cx, tr.cy, membro.pk.cx, membro.pk.cy) <= 1) continue;
    const passo = passoRumoA(g, tr.cx, tr.cy, membro.pk.cx, membro.pk.cy, null, 1);
    if (passo) {
      darPasso(tr, passo.cx, passo.cy, t, MS_PASSO_TREINADOR);
      arena.mudou.add(tr.slot);
    }
  }
}

/**
 * Um pokémon caiu numa briga de PvP.
 *
 * Move o ELO dos dois (soma zero), cobra o XP do treinador derrotado e tenta trocar por outro
 * do time. Sem suplente, o derrotado é EXPULSO da arena e vai para o Centro Pokémon — é a
 * única forma de morrer aqui, e é ela que dispara o cooldown de 5 minutos.
 */
function abater(arena, vencedor, perdedor, pVenc, pPerd, t, jogadores) {
  vencedor.abates++;
  perdedor.mortes++;

  const eloA = vencedor.elo;
  const eloB = perdedor.elo;
  vencedor.elo = Math.max(ELO_MINIMO, novoElo(eloA, eloB, 1));
  perdedor.elo = Math.max(ELO_MINIMO, novoElo(eloB, eloA, 0));
  vencedor.tr.elo = vencedor.elo;
  perdedor.tr.elo = perdedor.elo;
  arena.mudou.add(vencedor.tr.slot);
  arena.mudou.add(perdedor.tr.slot);

  pVenc.elo = vencedor.elo;
  pVenc.pvpAbates = (pVenc.pvpAbates ?? 0) + 1;
  pPerd.elo = perdedor.elo;
  pPerd.pvpMortes = (pPerd.pvpMortes ?? 0) + 1;

  // ---------------------------------------------------------------- o XP
  const pkMorto = ganchos.ativo(pPerd);
  if (pkMorto) {
    pkMorto.hp = 0;
    ganchos.marcarSujo(pPerd, pkMorto);
  }

  const xpPerdido = aplicarPerdaDeXpTreinador(pPerd, ganchos.consumirBless);

  ganchos.marcarSujo(pVenc);
  ganchos.marcarSujo(pPerd);

  ganchos.evento(pVenc, {
    k: 'pvpAbate',
    alvo: perdedor.nick,
    elo: vencedor.elo,
    delta: vencedor.elo - eloA,
  });
  ganchos.evento(pPerd, {
    k: 'pvpMorte',
    por: vencedor.nick,
    elo: perdedor.elo,
    delta: perdedor.elo - eloB,
    xpPerdido,
  });

  ganchos.atualizarPosicaoPvp?.(pVenc);
  ganchos.atualizarPosicaoPvp?.(pPerd);

  // ------------------------------------------------------------ o suplente
  const suplente = [...pPerd.pokemons.values()].find(
    (k) => k.slot != null && k.hp > 0 && ganchos.podeUsarPokemon?.(pPerd, k),
  );
  if (suplente) {
    pPerd.activeId = suplente.id;
    reaplicarPkNaEntidadeArena(arena, perdedor.pk, suplente);
    perdedor.cdGolpes = {};
    perdedor.proxGolpe = t + 1500;
    arena.mudou.add(perdedor.pk.slot);
    ganchos.evento(pPerd, { k: 'troca', id: suplente.id, nome: suplente.nome });
    ganchos.enviar(pPerd, { t: 'campo', ts: t, heroi: serializarHeroiPvp(perdedor.pk) });
    return;
  }

  // Time inteiro no chão: sai da arena e vai para a enfermeira. `sairDaArena` já carimba o
  // cooldown de 5 minutos.
  sairDaArena(pPerd, 'morreu', t);
  pPerd.automation.morteXpCobrada = true;
  ganchos.irParaOCentro(pPerd, 'morte', { xpJaCobrado: true, autoVoltarHunt: false });
}

// ------------------------------------------------------------- serialização

/**
 * O campo como UM participante o vê.
 *
 * O mesmo mundo, ponto de vista diferente: o pokémon do próprio jogador vai como `heroi`
 * (é o que o cliente centraliza na câmera e desenha com destaque) e o treinador dele como
 * `treinador`; todo o resto — pokémon e treinadores dos outros — vai como `mobs`.
 */
export function snapshotArena(arena, membro) {
  const outros = [];
  for (const e of arena.ents.values()) {
    if (e.slot === membro.pk.slot || e.slot === membro.tr.slot) continue;
    outros.push(serializarMob(e));
  }
  return {
    slug: arena.slug,
    mapa: arena.g.mapa,
    ts: Date.now(),
    box: [arena.g.minTx, arena.g.minTy, arena.g.cols, arena.g.rows],
    groundZ: arena.g.groundZ,
    pvp: true,
    heroi: serializarHeroiPvp(membro.pk),
    // O treinador leva `elo` e `n` porque é sob ELE que o número aparece na cena — o cliente
    // desenha a placa do próprio treinador exatamente quando o ELO existe (só na arena).
    treinador: {
      ...serializarHeroi(membro.tr),
      lt: membro.tr.looktype,
      vs: membro.tr.visual,
      n: membro.nick,
      elo: membro.elo,
    },
    mobs: outros,
    alvo: null,
  };
}

/**
 * Delta da arena para um participante.
 *
 * A lista de "quem mudou" é COMPARTILHADA (uma por arena, não uma por jogador), então a
 * varredura acontece uma vez por tick por arena; aqui só se separa o que é "eu" do que é
 * "os outros". Sem isso, N participantes fariam N varreduras do mesmo campo.
 */
function deltaPara(arena, membro, mudados, t) {
  const d = { seq: arena.seq, ts: t, alvo: null };
  const mobs = [];
  const fora = [];
  for (const slot of mudados) {
    const e = arena.ents.get(slot);
    if (!e) {
      fora.push(slot);
      continue;
    }
    if (slot === membro.pk.slot) d.heroi = serializarHeroiPvp(e);
    else if (slot === membro.tr.slot) d.treinador = { ...serializarHeroi(e), elo: e.elo };
    else mobs.push(serializarMob(e));
  }
  if (mobs.length) d.mobs = mobs;
  if (fora.length) d.fora = fora;
  if (!d.heroi && !d.treinador && !mobs.length && !fora.length) return null;
  return d;
}

/**
 * O tick de TODAS as arenas. Chamado uma vez por tick do sim, antes do laço de jogadores.
 *
 * Devolve, por chave de jogador, o pacote de campo daquele participante — o sim junta com os
 * eventos de batalha dele e manda tudo num publish só, como já faz com a hunt.
 */
export function tickArenas(t, jogadores) {
  const pacotes = new Map();
  for (const arena of [...vivas.values()]) {
    tickArena(arena, t, jogadores);

    if (!arena.mudou.size) continue;
    arena.seq++;
    const mudados = [...arena.mudou];
    arena.mudou.clear();
    for (const membro of arena.membros.values()) {
      const d = deltaPara(arena, membro, mudados, t);
      if (d) pacotes.set(membro.key, d);
    }
  }
  return pacotes;
}

/** A arena viva de um jogador (ou null). */
export const arenaDe = (p) => (p.pvp ? vivas.get(p.pvp.arenaId) ?? null : null);

/** O participante de um jogador (ou null). */
export function membroDe(p) {
  const a = arenaDe(p);
  return a?.membros.get(p.key) ?? null;
}

/** Placar da arena, para o painel: quem está dentro, ordenado por ELO. */
export function placarDaArena(arena) {
  return [...arena.membros.values()]
    .map((m) => ({ nick: m.nick, elo: m.elo, abates: m.abates, mortes: m.mortes }))
    .sort((a, b) => b.elo - a.elo);
}
