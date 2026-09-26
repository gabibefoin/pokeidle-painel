// O PASSE DE BATALHA — a trilha de 30 dias de login, grátis e VIP.
//
// ### A regra, em uma linha
//
// Um resgate por dia. Resgatou todo dia, anda um degrau; faltou UM dia, a trilha volta ao Dia 1.
// Fechou o Dia 30, recomeça do Dia 1 (um ciclo novo). O dia vira à meia-noite de Brasília
// (03:00 UTC) — a mesma virada do PvP semanal, e o fuso de quase todo mundo que joga.
//
// ### O VIP
//
// O Passe VIP custa `PASSE_VIP_PRECO` diamantes e vale `PASSE_VIP_DIAS` dias CORRIDOS a partir
// da compra — não um ciclo. Enquanto ele estiver valendo, cada resgate entrega a recompensa grátis
// E a VIP do mesmo dia. Se o jogador faltar um dia com o VIP ativo, a trilha volta ao Dia 1 como
// a de todo mundo, e o relógio do VIP continua correndo: os dias perdidos são perdidos. Comprar de
// novo com ele ativo ESTENDE (soma 30 dias ao fim atual), como o VIP da Loja.
//
// ### Por que as tabelas moram aqui
//
// A tela precisa delas para desenhar a trilha INTEIRA antes de qualquer resgate — o Dia 30 é a
// isca, e ele tem de estar à vista desde o Dia 1 — e o servidor precisa delas para entregar. Uma
// cópia só, importada dos dois lados (como `shared/caixas-npc.mjs`). Quem entrega de verdade é
// `server/game/passe-batalha.mjs`; aqui é só o catálogo.
//
// ### Como os prêmios foram escolhidos (e por que quase nada é negociável)
//
// 1 gema vale US$ 0,01 e sai em USDT. Tudo que o Mercado da Comunidade aceita (pedra, fragmento,
// Boss Token, Beast Ball) vira dinheiro sacável, e a trilha GRÁTIS é de qualquer conta — então o
// grátis dá sobretudo o que NÃO sai da conta: Coins, bolas comuns, poções, revives e boosts. O
// pouco de negociável que ele dá (Beast Ball e um Boss Token no Dia 30) soma uns trinta centavos
// de dólar por mês: não paga a conta de ninguém manter trinta logins seguidos em conta-fantasma.
//
// A trilha VIP é ~2× a grátis em Coins e bolas e bem mais em boost (é o que o VIP compra), com
// dias de VIP de assinatura espalhados e um Fragmento de Shiny Stone no Dia 30 — o único item
// "de dinheiro" dela, e ele vale na faixa do próprio preço do passe. Quem compra recebe mais do
// que pagou em JOGO (boosts, VIP, bolas), e não mais do que pagou em coisa sacável.

/** Dias de uma trilha. */
export const PASSE_DIAS = 30;
/** Preço do Passe VIP, em diamantes. */
export const PASSE_VIP_PRECO = 50;
/** Quanto o Passe VIP dura, em dias corridos a partir da compra. */
export const PASSE_VIP_DIAS = 30;
/** Nível mínimo para resgatar (e comprar o VIP) — a mesma trava de chat e amigos. */
export const PASSE_NIVEL_MIN = 10;
/** Quanto Brasília está atrás do UTC: o dia do passe vira às 03:00 UTC. */
export const PASSE_FUSO_MS = 3 * 60 * 60_000;
const DIA_MS = 24 * 60 * 60_000;

/** O número do dia do passe de um instante (inteiro, contado desde 1970 no fuso de Brasília). */
export const diaDoPasse = (ms) => Math.floor((Number(ms) - PASSE_FUSO_MS) / DIA_MS);
/** Quando começa (em ms) um dia do passe. */
export const inicioDoDiaDoPasse = (dia) => Number(dia) * DIA_MS + PASSE_FUSO_MS;

/**
 * O degrau que um resgate AGORA pegaria, a partir do que está gravado.
 *
 *   `ultimo`  o dia do passe do último resgate (ou null)
 *   `degrau`  o degrau que ele pegou (1..30)
 *
 * @returns `{ degrau, jaPegouHoje, quebrou }` — `quebrou` quando a sequência se perdeu (faltou um
 *          dia): a trilha recomeça no 1, e a tela avisa por quê.
 */
export function degrauDeHoje({ ultimo = null, degrau = 0 } = {}, agora = Date.now()) {
  const hoje = diaDoPasse(agora);
  const d = Number(degrau) || 0;
  if (ultimo == null || !Number.isFinite(Number(ultimo)) || d < 1) return { degrau: 1, jaPegouHoje: false, quebrou: false };
  const u = Number(ultimo);
  if (u === hoje) return { degrau: d, jaPegouHoje: true, quebrou: false };
  if (u === hoje - 1) return { degrau: d >= PASSE_DIAS ? 1 : d + 1, jaPegouHoje: false, quebrou: false };
  return { degrau: 1, jaPegouHoje: false, quebrou: true };
}

// ------------------------------------------------------------------ os prêmios
//
// Um prêmio é um de:
//   { tipo: 'coins', qtd }
//   { tipo: 'bola', id, qtd }            1 Poké · 2 Great · 3 Super · 4 Ultra · 5 Beast
//   { tipo: 'item', id, qtd }            os ids dos donos (ver `shared/caixas-npc.mjs`)
//   { tipo: 'boost', boost, horas }      xp · pokexp · loot · captura · shiny (ver `TIPOS_BOOST`)
//   { tipo: 'vip', dias }                dias de VIP de assinatura (+50% XP, auto-catch)
//
// Os ids são copiados dos donos pelo mesmo motivo de `caixas-npc.mjs`: a tela importa este arquivo
// e não alcança `src/server/`. `teste-passe-batalha.mjs` confere cada um contra o catálogo.
export const ITEM = {
  HYPER_POTION: 203,
  REVIVE: 205,
  MAX_REVIVE: 206,
  GOLDEN_POTION: 70070,
  ESCAPE_ROPE: 70010,
  BOSS_TOKEN: 70000,
  FRAG_SHINY: 70012,
};
export const BOLA = { ULTRA: 4, BEAST: 5 };

const coins = (qtd) => ({ tipo: 'coins', qtd });
const ultra = (qtd) => ({ tipo: 'bola', id: BOLA.ULTRA, qtd });
const beast = (qtd) => ({ tipo: 'bola', id: BOLA.BEAST, qtd });
const item = (id, qtd) => ({ tipo: 'item', id, qtd });
const boost = (b, horas) => ({ tipo: 'boost', boost: b, horas });
const vip = (dias) => ({ tipo: 'vip', dias });

/**
 * Os 30 degraus. `tier` é a moldura na tela — a mesma escada de raridade da Casa e da Bicicleta
 * (comum → incomum → rara → mítica → lendária): os dias 7, 14, 21 e 28 são BAÚS, e o 30 é o
 * lendário, o motivo de voltar todo dia.
 */
export const TRILHA = [
  { dia: 1, tier: 'comum', free: [coins(250_000)], vip: [vip(3), coins(500_000)] },
  { dia: 2, tier: 'comum', free: [ultra(30)], vip: [ultra(60), beast(10)] },
  { dia: 3, tier: 'incomum', free: [boost('xp', 1)], vip: [boost('xp', 3)] },
  { dia: 4, tier: 'comum', free: [item(ITEM.REVIVE, 50)], vip: [item(ITEM.REVIVE, 100), item(ITEM.MAX_REVIVE, 10)] },
  { dia: 5, tier: 'comum', free: [coins(500_000)], vip: [coins(1_000_000), boost('loot', 1)] },
  { dia: 6, tier: 'incomum', free: [beast(10)], vip: [beast(25)] },
  { dia: 7, tier: 'rara', bau: true, free: [coins(1_000_000), boost('loot', 1)], vip: [coins(3_000_000), boost('xp', 6), boost('pokexp', 6), boost('loot', 6)] },
  { dia: 8, tier: 'comum', free: [ultra(50)], vip: [ultra(100), boost('captura', 1)] },
  { dia: 9, tier: 'incomum', free: [boost('pokexp', 1)], vip: [boost('pokexp', 3)] },
  { dia: 10, tier: 'incomum', free: [coins(750_000)], vip: [vip(3), coins(1_500_000)] },
  { dia: 11, tier: 'incomum', free: [item(ITEM.MAX_REVIVE, 10)], vip: [item(ITEM.MAX_REVIVE, 30)] },
  { dia: 12, tier: 'incomum', free: [beast(15)], vip: [beast(40)] },
  { dia: 13, tier: 'rara', free: [boost('captura', 1)], vip: [boost('captura', 3)] },
  { dia: 14, tier: 'rara', bau: true, free: [coins(1_500_000), boost('xp', 2)], vip: [coins(4_000_000), boost('shiny', 3), item(ITEM.BOSS_TOKEN, 1)] },
  { dia: 15, tier: 'incomum', free: [item(ITEM.GOLDEN_POTION, 10)], vip: [item(ITEM.GOLDEN_POTION, 20), boost('xp', 3)] },
  { dia: 16, tier: 'comum', free: [coins(1_000_000)], vip: [coins(2_000_000)] },
  { dia: 17, tier: 'incomum', free: [beast(25)], vip: [beast(50)] },
  { dia: 18, tier: 'rara', free: [boost('shiny', 1)], vip: [boost('shiny', 3)] },
  { dia: 19, tier: 'comum', free: [ultra(100)], vip: [ultra(200), boost('loot', 2)] },
  { dia: 20, tier: 'incomum', free: [coins(1_250_000)], vip: [vip(3), coins(2_500_000)] },
  { dia: 21, tier: 'rara', bau: true, free: [coins(2_000_000), boost('captura', 2)], vip: [coins(5_000_000), boost('captura', 6), item(ITEM.BOSS_TOKEN, 1)] },
  { dia: 22, tier: 'incomum', free: [beast(30)], vip: [beast(60)] },
  { dia: 23, tier: 'rara', free: [boost('loot', 2)], vip: [boost('loot', 6)] },
  { dia: 24, tier: 'incomum', free: [item(ITEM.MAX_REVIVE, 20)], vip: [item(ITEM.MAX_REVIVE, 40), item(ITEM.ESCAPE_ROPE, 5)] },
  { dia: 25, tier: 'incomum', free: [coins(1_500_000)], vip: [coins(3_000_000), boost('pokexp', 6)] },
  { dia: 26, tier: 'rara', free: [boost('pokexp', 2)], vip: [boost('xp', 6)] },
  { dia: 27, tier: 'rara', free: [beast(40)], vip: [beast(80)] },
  { dia: 28, tier: 'mitica', bau: true, free: [coins(3_000_000), boost('shiny', 2)], vip: [coins(7_000_000), boost('shiny', 6), item(ITEM.BOSS_TOKEN, 2)] },
  { dia: 29, tier: 'rara', free: [item(ITEM.ESCAPE_ROPE, 3), boost('xp', 3)], vip: [vip(3), boost('captura', 6), boost('shiny', 6)] },
  {
    dia: 30,
    tier: 'lendaria',
    bau: true,
    free: [item(ITEM.BOSS_TOKEN, 1), coins(5_000_000), beast(50)],
    vip: [item(ITEM.FRAG_SHINY, 1), coins(10_000_000), beast(100), item(ITEM.BOSS_TOKEN, 2)],
  },
];

export const degrauDaTrilha = (dia) => TRILHA[Math.max(1, Math.min(PASSE_DIAS, Number(dia) || 1)) - 1];

/**
 * A soma de uma trilha — o "vale X" do card do VIP. Coins, bolas e itens somam por id; boost soma
 * horas por tipo; VIP soma dias. Nada de preço inventado: a tela converte com a tabela da Loja.
 */
export function somaDaTrilha(qual) {
  const s = { coins: 0, bolas: {}, itens: {}, boosts: {}, vipDias: 0 };
  for (const d of TRILHA) {
    for (const p of d[qual] ?? []) {
      if (p.tipo === 'coins') s.coins += p.qtd;
      else if (p.tipo === 'bola') s.bolas[p.id] = (s.bolas[p.id] ?? 0) + p.qtd;
      else if (p.tipo === 'item') s.itens[p.id] = (s.itens[p.id] ?? 0) + p.qtd;
      else if (p.tipo === 'boost') s.boosts[p.boost] = (s.boosts[p.boost] ?? 0) + p.horas;
      else if (p.tipo === 'vip') s.vipDias += p.dias;
    }
  }
  return s;
}

// ------------------------------------------------------------------ o estado

/**
 * O `passe` lido do banco, saneado. A coluna é jsonb e o jogador nunca escreve nela, mas um
 * valor torto (restore antigo, edição à mão) não pode virar exceção no tick: cai no vazio.
 */
export function normalizarPasse(bruto) {
  const o = bruto && typeof bruto === 'object' ? bruto : {};
  const int = (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : null);
  const degrau = int(o.degrau);
  return {
    ultimo: int(o.ultimo),
    degrau: degrau != null && degrau >= 0 && degrau <= PASSE_DIAS ? degrau : 0,
    ultimoVip: int(o.ultimoVip),
    vipAte: Math.max(0, Number(o.vipAte) || 0),
    ciclos: Math.max(0, int(o.ciclos) ?? 0),
    total: Math.max(0, int(o.total) ?? 0),
  };
}

export const vipAtivoNoPasse = (passe, agora) => (passe?.vipAte ?? 0) > agora;

/**
 * O que a tela precisa, num pacote: o degrau de hoje, se já pegou, o VIP, e os relógios.
 *
 * `alcance` responde à pergunta do card do VIP — "até onde eu chego se resgatar todo dia?": o
 * último degrau que ainda cai dentro do VIP. Sem VIP, a trilha grátis sempre chega ao 30.
 */
export function estadoDoPasse(p, agora = Date.now()) {
  const passe = normalizarPasse(p.passe);
  const st = degrauDeHoje(passe, agora);
  const hoje = diaDoPasse(agora);
  const vip = vipAtivoNoPasse(passe, agora);
  const viradaEm = inicioDoDiaDoPasse(hoje + 1);
  const vipPegouHoje = passe.ultimoVip === hoje;
  // O ALCANCE do VIP, resgatando todo dia daqui em diante: o primeiro resgate VIP que ainda vem
  // é HOJE (se o VIP de hoje não saiu) ou amanhã; cada dia coberto pelo prazo anda um degrau.
  // `alcanceVip` é o último degrau VIP que o prazo alcança (30 = chega ao lendário).
  let alcanceVip = 0;
  if (vip) {
    const ultimoDiaVip = diaDoPasse(passe.vipAte - 1);
    const vipHojePendente = !vipPegouHoje;
    const primeiroDia = vipHojePendente ? hoje : hoje + 1;
    const degrauDoPrimeiro = vipHojePendente
      ? st.degrau
      : (st.degrau >= PASSE_DIAS ? 1 : st.degrau + 1);
    const resgatesVip = Math.max(0, ultimoDiaVip - primeiroDia + 1);
    alcanceVip = resgatesVip > 0 ? Math.min(PASSE_DIAS, degrauDoPrimeiro + resgatesVip - 1) : 0;
  }
  return {
    degrau: st.degrau,
    jaPegouHoje: st.jaPegouHoje,
    quebrou: st.quebrou,
    // O VIP de hoje ainda está por pegar (comprou depois do resgate grátis).
    vipPendenteHoje: vip && st.jaPegouHoje && !vipPegouHoje,
    vipAte: passe.vipAte,
    vipAtivo: vip,
    viradaEm,
    alcanceVip,
    ciclos: passe.ciclos,
    total: passe.total,
    nivelMin: PASSE_NIVEL_MIN,
    precoVip: PASSE_VIP_PRECO,
    diasVip: PASSE_VIP_DIAS,
  };
}

