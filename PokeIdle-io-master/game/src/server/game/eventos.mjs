// EVENTOS globais: o buff que o administrador liga para TODO MUNDO ao mesmo tempo.
//
// Três porcentagens e um prazo — XP do treinador, XP do pokémon e farm (loot). É o mesmo
// eixo dos boosts da Loja, só que sem dono: não pertence a um jogador, não é comprado e não
// entra no `boosts` de ninguém. Por isso mora aqui, num módulo sem estado de jogador.
//
// ### Por que o vigente é uma variável de módulo
//
// O evento é um dado só para o processo inteiro. Guardá-lo no jogador significaria carimbar
// N cópias do mesmo número (e ter de acertar todas quando o admin encerra antes da hora).
// Aqui ele é lido no boot (`eventos-db.mjs`) e trocado quando o aviso chega pelo Redis —
// cada sim tem a sua cópia, todas iguais, e nenhuma consulta ao banco entra no tick.
//
// ### A expiração não precisa de timer
//
// `terminaEm` é um carimbo. Quem pergunta compara com o relógio, e no instante seguinte ao
// fim o multiplicador volta a 1 sozinho — sem `setTimeout` para errar, sem varredura, e sem
// diferença entre um processo que estava de pé e um que acabou de subir.

/** O evento vigente, ou `null`. Trocado no boot e a cada aviso do canal `evento`. */
let vigente = null;

/** Teto de cada buff. Não é desconfiança do admin — é a rede contra o dedo escorregado. */
export const EVENTO_PCT_MAX = 50_000;

/** Teto de duração, em minutos (7 dias). Evento é temporada, não regra permanente. */
export const EVENTO_MINUTOS_MAX = 10_080;

/** Arredonda e limita uma das três porcentagens do evento. */
export const limitarPct = (v) =>
  Math.max(0, Math.min(EVENTO_PCT_MAX, Math.round(Number(v) || 0)));

export const limitarMinutos = (v) =>
  Math.max(1, Math.min(EVENTO_MINUTOS_MAX, Math.round(Number(v) || 0)));

/**
 * Troca o evento vigente. `null` (ou um já vencido) desliga.
 *
 * Aceita tanto a linha do banco quanto o objeto que viaja no Redis: os dois trazem os mesmos
 * quatro números, e normalizar aqui evita que cada chamador tenha de lembrar do formato.
 */
export function definirEvento(ev) {
  if (!ev) {
    vigente = null;
    return null;
  }
  const terminaEm = Number(ev.terminaEm) || 0;
  vigente = terminaEm > Date.now()
    ? {
        id: Number(ev.id) || 0,
        xpTreinadorPct: limitarPct(ev.xpTreinadorPct),
        xpPokemonPct: limitarPct(ev.xpPokemonPct),
        farmPct: limitarPct(ev.farmPct),
        minutos: limitarMinutos(ev.minutos),
        terminaEm,
      }
    : null;
  return vigente;
}

/** O evento de agora, ou `null` se não há nenhum (ou o prazo venceu). */
export const eventoAtivo = (agora = Date.now()) =>
  vigente && vigente.terminaEm > agora ? vigente : null;

/** Multiplicador de XP do treinador vindo do evento — 1 quando não há evento. */
export const multEventoXpTreinador = (agora = Date.now()) =>
  1 + (eventoAtivo(agora)?.xpTreinadorPct ?? 0) / 100;

export const multEventoXpPokemon = (agora = Date.now()) =>
  1 + (eventoAtivo(agora)?.xpPokemonPct ?? 0) / 100;

/**
 * O bônus de FARM do evento, em pontos percentuais.
 *
 * Soma (não multiplica) porque é assim que `bonusLootPct` já trata Loot Boost, guild e
 * ranking: os quatro entram na mesma conta de "quanto a mais de drop nesta kill".
 */
export const bonusEventoFarmPct = (agora = Date.now()) => eventoAtivo(agora)?.farmPct ?? 0;

/**
 * O que a tela precisa saber. Vai no snapshot de todo jogador, e é `null` na esmagadora
 * maioria dos dias — um campo nulo por pacote é barato, e evita uma rota só para perguntar
 * "tem evento?" a cada login.
 */
export function eventoParaCliente(agora = Date.now()) {
  const ev = eventoAtivo(agora);
  if (!ev) return null;
  return {
    id: ev.id,
    xpTreinadorPct: ev.xpTreinadorPct,
    xpPokemonPct: ev.xpPokemonPct,
    farmPct: ev.farmPct,
    minutos: ev.minutos,
    terminaEm: ev.terminaEm,
  };
}
