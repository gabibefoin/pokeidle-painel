// A ÁREA DE TREINAMENTO — a bancada de testes do PvP.
//
// O jogador monta dois lados e assiste à luta. Cada lado aceita pokémon DELE (uma cópia, pelo id)
// e pokémon de MENTIRA, descritos na mão (espécie, nível, shiny, potência, qualidade e os seis
// IVs). O resultado é uma fita para assistir, e mais nada.
//
// ### A promessa: nada existe fora desta função
//
// Nenhum caminho daqui escreve em lugar nenhum — nem no Postgres, nem no Redis (fora o carimbo
// da espera), nem no jogador em memória. Em particular:
//
//   · o pokémon de teste NUNCA vira linha de `player_pokemon`. Ele nasce como objeto solto aqui,
//     entra no simulador e some quando a função retorna;
//   · o pokémon "meu" não é o objeto do jogador: é uma CÓPIA dos números de nascimento dele
//     (`copiaDoMeu`). O simulador machuca a cópia — HP, nocaute — e o pokémon de verdade nem
//     sabe que a luta aconteceu;
//   · os ids dos lutadores são NEGATIVOS e sequenciais (`-1`, `-2`, …). Não é enfeite: o id que
//     entra no simulador reaparece no replay, e um id negativo não casa com nenhuma linha do
//     banco em lugar nenhum do jogo. Se um dia alguém escrever "credita o dono deste id", não há
//     dono para creditar;
//   · o retorno não tem XP, ouro, item, pedra nem ponto de PvP. O `simularDuelo` devolve o
//     resultado da briga, e é só isso que sobe.
//
// ### A régua é a do Ranqueado
//
// `simularDuelo` é a MESMA função que o PvP Ranqueado e o Campeonato usam: mesma conversão de
// pokémon (com a régua de nível dos ginásios), mesma arena, mesmo simulador. É o ponto da
// feature — um treino jogado com outras regras não treinaria nada.
import { pub } from '../bus.mjs';
import { especies } from '../content.mjs';
import { LOOKTYPE_TREINADOR } from './campo.mjs';
import { simularDuelo } from './pvp-ranqueado.mjs';
import { empacotarVisual } from './visual.mjs';
import { TREINO_COOLDOWN_MS, TREINO_MAX_LADO, normalizarLado } from '../../shared/treino.mjs';

/** Recusa com chave de texto — a tela traduz (`treino.recusa.*`). */
export class ErroTreino extends Error {}

/** O boneco do lado B é o treinador padrão; o do lado A é a outfit de quem está treinando. */
const LOOKTYPE_LADO_B = LOOKTYPE_TREINADOR;

/** A espera, quando o Redis não responde: por processo, some com ele. Ver `reivindicarVez`. */
const esperaLocal = new Map();

/**
 * Prazo para o Redis responder.
 *
 * O cliente do jogo é `maxRetriesPerRequest: null` (ver `bus.mjs`): com o Redis fora do ar ele
 * ENFILEIRA o comando em vez de falhar, e sem este prazo o jogador ficaria esperando para sempre
 * por uma resposta que não vem. Meio segundo é dez vezes o que um `SET` leva num Redis vivo.
 */
const PRAZO_REDIS_MS = 500;
const comPrazo = (promessa) => Promise.race([
  promessa,
  new Promise((_, erro) => {
    setTimeout(() => erro(new Error('redis sem resposta')), PRAZO_REDIS_MS).unref?.();
  }),
]);

/**
 * Reivindica a vez do jogador: `true` se a batalha pode rodar agora.
 *
 * O carimbo é do Redis (`SET NX PX`), e não da memória do sim, por um motivo só: a memória morre
 * no relog. Com a espera na sessão, sair e entrar de novo — dois segundos — zeraria os cinco
 * minutos, e a trava viraria enfeite. A chave é o id da conta, então ela vale em qualquer shard.
 *
 * Redis fora do ar não pode derrubar a feature: cai para um `Map` deste processo, que segura o
 * caso normal (o jogador está sempre no mesmo sim enquanto joga).
 */
export async function reivindicarVez(dbId, agora = Date.now()) {
  const chave = `treino:${dbId}`;
  try {
    const ok = await comPrazo(pub.set(chave, String(agora), 'PX', TREINO_COOLDOWN_MS, 'NX'));
    if (ok) return { ok: true };
    const resta = await comPrazo(pub.pttl(chave)).catch(() => TREINO_COOLDOWN_MS);
    return { ok: false, restaMs: Math.max(0, Number(resta) || 0) };
  } catch {
    const ate = esperaLocal.get(dbId) ?? 0;
    if (ate > agora) return { ok: false, restaMs: ate - agora };
    esperaLocal.set(dbId, agora + TREINO_COOLDOWN_MS);
    return { ok: true };
  }
}

/** Devolve a vez quando a luta NÃO aconteceu (equipe vazia, espécie inválida). */
export async function devolverVez(dbId) {
  try {
    await comPrazo(pub.del(`treino:${dbId}`));
  } catch { /* o carimbo expira sozinho em 5 min */ }
  esperaLocal.delete(dbId);
}

/**
 * Uma cópia dos números de NASCIMENTO de um pokémon do jogador.
 *
 * Só o que decide a luta viaja: espécie, nível, nascimento (IV, qualidade, potência, shiny), o
 * refino comprado e o TM elemental. Nada de `id` verdadeiro, nada de slot, nada de dono — o
 * lutador é um sósia, e o original fica de fora da briga.
 */
const copiaDoMeu = (pk, id) => ({
  id,
  speciesId: pk.speciesId,
  level: pk.level,
  ivs: { ...(pk.ivs ?? {}) },
  quality: pk.quality,
  potencia: pk.potencia,
  shiny: !!pk.shiny,
  refino: pk.refino ?? null,
  tmElemental: pk.tmElemental ?? null,
});

/** O pokémon de teste, no formato que o simulador come. A espécie já foi conferida. */
const doTeste = (t, id) => ({
  id,
  speciesId: t.speciesId,
  level: t.level,
  ivs: { ...t.ivs },
  quality: t.qualidade,
  potencia: t.potencia,
  shiny: t.shiny,
  refino: null,
  tmElemental: null,
});

/**
 * Monta um lado a partir das casas que a tela mandou.
 *
 * `proximoId` é um contador compartilhado pelos dois lados: cada lutador sai com um id negativo
 * único, que é o que o replay usa para falar de cada um sem tocar em id de verdade.
 */
function montarLado(p, casas, proximoId) {
  const equipe = [];
  for (const casa of casas) {
    if (casa.meu != null) {
      // O pokémon precisa estar na memória DESTE jogador: é a única fonte aceita. Um id de
      // outra pessoa (ou um inventado) simplesmente não é achado e a casa some.
      const meu = p.pokemons?.get(casa.meu);
      if (!meu) continue;
      equipe.push(copiaDoMeu(meu, proximoId()));
      continue;
    }
    if (!especies.has(casa.teste.speciesId)) continue;
    equipe.push(doTeste(casa.teste, proximoId()));
  }
  return equipe.slice(0, TREINO_MAX_LADO);
}

/**
 * A batalha de treino. Recebe o pacote da tela, devolve o que ela precisa para tocar a fita.
 *
 * Quem chama já reivindicou a vez (`reivindicarVez`) — se a montagem falhar aqui, a vez é
 * devolvida por lá: gastar cinco minutos de espera por um pacote que nem chegou a lutar seria
 * castigar um clique num pokémon que acabou de ser vendido.
 */
export async function lutaDeTreino(p, msg) {
  // Um contador só para os dois lados: dois lutadores nunca dividem o mesmo id.
  const id = proximo();
  const a = montarLado(p, normalizarLado(msg?.a), id);
  const b = montarLado(p, normalizarLado(msg?.b), id);
  if (!a.length || !b.length) throw new ErroTreino('treino.recusa.vazio');

  // Os lados se chamam "A" e "B" — o nome vai para cima do boneco no replay, e quem escreve é o
  // SERVIDOR. Uma letra não tem idioma (a tela traduz o título em volta) e, principalmente, não
  // deixa a tela mandar texto arbitrário para dentro de uma fita.
  const visual = empacotarVisual(p.visual ?? null);
  const r = await simularDuelo(
    { dbId: p.dbId, nick: 'A', looktype: p.looktype, visual, pokemons: a },
    { dbId: p.dbId, nick: 'B', looktype: LOOKTYPE_LADO_B, visual: null, pokemons: b },
  );
  if (r.semTime) throw new ErroTreino('treino.recusa.vazio');

  return {
    venceuA: r.venceuA,
    motivo: r.motivo,
    duracaoMs: r.duracaoMs,
    placar: r.placar,
    versao: r.versao,
    arena: r.arena,
    replay: r.replay,
    // O que cada lado levou para a arena, para a tela escrever o placar sem adivinhar.
    ladoA: a.length,
    ladoB: b.length,
    cooldownMs: TREINO_COOLDOWN_MS,
  };
}

/** Contador dos ids negativos de uma batalha. Nasce em -1 e desce. */
function proximo() {
  let n = 0;
  return () => --n;
}

export const _testeMontarLado = (p, casas) => montarLado(p, normalizarLado(casas), proximo());
