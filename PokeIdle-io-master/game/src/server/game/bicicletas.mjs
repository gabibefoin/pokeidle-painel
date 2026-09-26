/**
 * BICICLETAS — o que a bicicleta faz por quem está caçando.
 *
 * ### As três peças
 *
 * 1. **Fragmento de Bicicleta.** Cai na Outland a 0,0005% por kill (1 em 200.000), vezes o
 *    degrau da Outland (×1 a ×8) e o Loot Boost — a MESMA conta do Fragmento de Chave. Só lá,
 *    sem teto por conta.
 * 2. **A Bicicleta.** 10 fragmentos no Professor Carvalho. A raridade é SORTEADA com os pesos
 *    da Casa (`shared/bicicletas.mjs`). Cada fabricação credita uma bicicleta a mais: não há
 *    limite de quantas se tem na bolsa.
 * 3. **A equipada.** Das que estão na bolsa, o jogador escolhe UMA (`bicicleta.equipar`). Só
 *    ela encurta o passo do pokémon e do treinador na hunt — `1 + velocidade` vezes —, e as
 *    porcentagens das outras não somam.
 *
 * Fragmento e bicicleta pronta se negociam no Mercado da Comunidade; nenhum dos dois vende ao
 * NPC (`npcPrice: 0`).
 *
 * ### Cada bicicleta tem NÚMERO, e a equipada é conferida a cada leitura
 *
 * Como a Casa, a bicicleta é uma peça numerada (`bicicletas-db.mjs`): `p.bicicletas` é a lista
 * dela, e `automation.bicicletaEquipada` guarda o NÚMERO escolhido. Valer ou não é decidido na
 * hora, olhando se aquela bicicleta ainda está NA MÃO: anunciar a equipada no Mercado a marca
 * `anunciada` e derruba a velocidade no mesmo tick — mesmo com outra da mesma raridade na bolsa —,
 * sem ninguém precisar lembrar de desequipar; vendê-la a tira da lista; cancelar o anúncio a
 * devolve já equipada.
 */

import {
  RARIDADES_BICICLETA,
  raridadeBicicletaValida,
  sortearRaridadeBicicleta,
  fatorPassoDaRaridade,
} from '../../shared/bicicletas.mjs';
import {
  BICICLETA_POR_RARIDADE,
  FRAGMENTO_BICICLETA_ID,
  CUSTO_FRAGMENTOS_BICICLETA,
} from './itens-nossos.mjs';

/** Chance por selvagem derrotado na Outland — 0,0005% (1 em 200.000), igual ao Fragmento de Chave. */
export const CHANCE_FRAGMENTO_BICICLETA = 0.000005;

/**
 * Uma troca de bicicleta (equipar outra ou guardar a equipada) a cada 5 minutos — ver
 * `bicicleta.equipar`, no sim. O instante da última troca fica em
 * `automation.bicicletaTrocadaEm`, então sair e entrar de novo não zera a espera.
 */
export const INTERVALO_TROCA_BICICLETA_MS = 5 * 60_000;

/**
 * Um número de peça: inteiro seguro e positivo, ou `null`. Vem do cliente e do jsonb, então só passa
 * número de verdade (ou texto só de dígitos) — nada de array, objeto, `true` ou `"12abc"`.
 */
const idPositivo = (v) => {
  if (typeof v !== 'number' && !(typeof v === 'string' && /^\d{1,15}$/.test(v))) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const NIVEL = new Map(RARIDADES_BICICLETA.map((r, i) => [r.id, i]));

// ------------------------------------------------------------ a bicicleta

/** As bicicletas na MÃO: as do jogador que não estão presas num anúncio do Mercado. */
export const bicicletasNaMao = (p) => (p.bicicletas ?? []).filter((b) => !b.anunciada);

/** A mais rara primeiro, e dentro da raridade o número — a ordem da bolsa e do registro. */
export function ordenarBicicletas(lista) {
  return [...lista].sort((a, b) => (NIVEL.get(b.raridade) ?? 0) - (NIVEL.get(a.raridade) ?? 0) || a.id - b.id);
}

/** `{ comum: 2, lendaria: 1 }` — quantas bicicletas de cada raridade o jogador tem NA MÃO. */
export function bicicletasDoJogador(p) {
  const out = {};
  for (const b of bicicletasNaMao(p)) out[b.raridade] = (out[b.raridade] ?? 0) + 1;
  return out;
}

/** Uma bicicleta NA MÃO pelo número, ou `null`. O número vem do cliente. */
export function bicicletaNaMaoPorId(p, id) {
  const n = idPositivo(id);
  if (!n) return null;
  return bicicletasNaMao(p).find((b) => b.id === n) ?? null;
}

/** A bicicleta EQUIPADA — a única que vale —, se ainda estiver na mão. `null` = a pé. */
export function bicicletaEquipada(p) {
  const id = idPositivo(p.automation?.bicicletaEquipada);
  return id ? bicicletaNaMaoPorId(p, id) : null;
}

/** O fator que divide o passo na hunt. 1 = a pé. */
export const fatorPassoBicicleta = (p) => fatorPassoDaRaridade(bicicletaEquipada(p)?.raridade ?? null);

/**
 * A equipada como vem do jsonb, saneada na carga: o NÚMERO, ou — conta de antes da numeração — a
 * RARIDADE que estava equipada, que `resolverEquipadaLegada` troca pelo número quando as bicicletas
 * chegam do banco. Qualquer outra coisa (array, objeto, texto torto) é `null`.
 */
export function equipadaGravada(v) {
  return idPositivo(v) ?? raridadeBicicletaValida(v);
}

/**
 * Troca a equipada de antes da numeração (uma raridade) pela bicicleta de MENOR número daquela
 * raridade na mão — a mesma velocidade de antes, sem clique. Sem nenhuma daquela raridade, a pé.
 * Devolve `true` quando mudou algo.
 */
export function resolverEquipadaLegada(p) {
  const rar = raridadeBicicletaValida(p.automation?.bicicletaEquipada);
  if (!rar || !p.bicicletas) return false;
  const alvo = ordenarBicicletas(bicicletasNaMao(p).filter((b) => b.raridade === rar))[0];
  p.automation.bicicletaEquipada = alvo?.id ?? null;
  return true;
}

/**
 * Equipa a bicicleta de número `bicicletaId` — ou guarda a equipada, com `null`.
 *
 * O número vem do cliente: só passa inteiro positivo, e só se a bicicleta está NA MÃO dele (a que
 * está anunciada no Mercado não conta). Equipar outra SUBSTITUI a anterior; não existe segunda vaga.
 * Devolve `{ ok: true, bicicletaId, raridade }` ou `{ ok: false, erro }` — o erro é chave de i18n.
 */
export function equiparBicicleta(p, bicicletaId) {
  if (bicicletaId === null) {
    p.automation.bicicletaEquipada = null;
    return { ok: true, bicicletaId: null, raridade: null };
  }
  const id = idPositivo(bicicletaId);
  if (!id) return { ok: false, erro: 'bicicleta.invalida' };
  const bici = bicicletaNaMaoPorId(p, id);
  if (!bici) return { ok: false, erro: 'bicicleta.naoTem' };
  p.automation.bicicletaEquipada = bici.id;
  return { ok: true, bicicletaId: bici.id, raridade: bici.raridade };
}

/**
 * As bicicletas que ainda moram em `items` como QUANTIDADE — `[{ raridade, itemId, qtd }]`.
 *
 * A virada converte todas, mas uma bicicleta-item pode reaparecer (o painel admin, `dar-itens`, um
 * processo antigo na janela do deploy). O carregamento confere com esta função e numera o que achar.
 */
export function bicicletasNaBolsa(items) {
  const out = [];
  for (const r of RARIDADES_BICICLETA) {
    const itemId = BICICLETA_POR_RARIDADE[r.id];
    const qtd = Math.floor(Number(items?.[itemId] ?? 0));
    if (qtd > 0) out.push({ raridade: r.id, itemId, qtd });
  }
  return out;
}

// ------------------------------------------------------------- o fragmento

/**
 * Sorteia o drop de Fragmento de Bicicleta. `null` quando não cai (o caso normal).
 *
 * `mult` é o degrau da Outland — a escada mora em `shared/outland-tiers.mjs`.
 */
export function rolarFragmentoBicicleta(bonusPct = 0, area = null, mult = 1) {
  if (area !== 'outland') return null;
  if (Math.random() >= CHANCE_FRAGMENTO_BICICLETA * (1 + bonusPct / 100) * mult) return null;
  return { itemId: FRAGMENTO_BICICLETA_ID, nome: 'Bicycle Fragment', qtd: 1 };
}

// ---------------------------------------------------------------- fabricar

/**
 * Gasta 10 fragmentos e devolve a raridade sorteada. `null` se não dá para fabricar — e aí
 * nada foi gasto. Quem chama credita a bicicleta (`darBicicleta`).
 */
export function fabricarBicicletaComFragmentos(p) {
  const tem = Number(p.items?.[FRAGMENTO_BICICLETA_ID] ?? 0);
  if (tem < CUSTO_FRAGMENTOS_BICICLETA) return null;
  p.items[FRAGMENTO_BICICLETA_ID] = tem - CUSTO_FRAGMENTOS_BICICLETA;
  if (!p.items[FRAGMENTO_BICICLETA_ID]) delete p.items[FRAGMENTO_BICICLETA_ID];
  return sortearRaridadeBicicleta();
}


