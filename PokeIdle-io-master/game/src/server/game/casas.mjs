/**
 * CASAS e XP SHARE — o que a casa faz por quem está caçando.
 *
 * ### As três peças
 *
 * 1. **Fragmento de Chave.** Cai na Outland a 0,0005% por kill — só lá, sem teto por conta.
 * 2. **A Casa.** 10 fragmentos no Professor Carvalho. A raridade é SORTEADA pelos pesos de
 *    `shared/casas.mjs` — não se escolhe qual casa vem. Cada casa sai com um NÚMERO do servidor
 *    (`#000001`, `#000002`…), dado pelo banco na hora em que ela nasce (ver `casas-db.mjs`).
 * 3. **O posto de XP Share.** Dentro da casa, um boneco de madeira. Clicando nele o jogador
 *    registra UM pokémon **da equipe**, e esse pokémon passa a receber uma fatia do XP que o
 *    pokémon de batalha ganha na hunt. A raridade decide a fatia — 25% na Comum, 100% na
 *    Mítica e Lendária —, e só a Lendária tem dois postos (ver `shared/casas.mjs`).
 *
 * O Fragmento de Chave **não entra no Mercado da Comunidade** (ver `ITENS_FORA_DO_MERCADO`).
 * A Casa PRONTA, essa sim, se vende — pelo número.
 *
 * ### Quantas casas quiser, CINCO em uso
 *
 * Não existe mais casa "equipada", e ter casa não tem teto: cada sorteio é uma casa a mais na
 * conta. O teto é de USO — até `MAX_CASAS_EM_USO` casas repartem XP ao mesmo tempo, e o jogador
 * escolhe quais no modal da Casa (`automation.casasEmUso`). As outras ficam GUARDADAS: continuam
 * dele, vendem no Mercado e entram em uso quando ele quiser, mas não têm posto valendo.
 *
 * Cada casa em uso tem os seus postos (`p.xpShare.porCasa`, chaveado pelo número). A regra dos
 * postos é uma só: **o mesmo pokémon não ocupa dois postos**, em casa nenhuma. Sem ela, duas
 * Míticas dariam 200% ao mesmo registrado; com ela, o teto de quem recebe continua sendo a
 * equipe — cinco lugares, menos o de batalha.
 *
 * A casa anunciada no Mercado não vale (está em escrow, fora da mão do dono) e perde os postos
 * no ato do anúncio. Cancelar não devolve os pokémon: a casa volta VAZIA — ver `market.criar`.
 *
 * ### Por que XP Share, e não mais treino contra o boneco
 *
 * O boneco rendia XP sozinho, em paralelo com a hunt: era uma SEGUNDA fonte, e uma que não
 * pedia atenção nenhuma. O XP Share não cria XP novo — ele reparte o que o jogador já está
 * ganhando caçando de verdade, e por isso escala com a hunt em que ele está sem virar um farm
 * paralelo. Some junto o problema de auditoria do farm off-line: sem hunt rodando, não há o
 * que repartir, então não há nada acontecendo com o jogo fechado.
 *
 * ### O registrado não pode ser o de batalha
 *
 * Quem está lutando já leva o XP inteiro. Se ele também fosse o registrado, a casa viraria um
 * bônus de XP puro em cima do próprio pokémon ativo — e a escolha ("qual dos cinco eu quero
 * subir junto?") deixaria de existir. A trava mora em `creditarXpShare`, no sim.
 *
 * ### Este arquivo não fala com o banco
 *
 * Tudo aqui é regra sobre o jogador em memória (`p.casas`, `p.xpShare`) — o que deixa as regras
 * testáveis sem Postgres (`tools/teste-casas.mjs`). Criar, numerar e mudar de dono é de
 * `casas-db.mjs`.
 */

import {
  RARIDADES_CASA,
  MAX_CASAS_EM_USO,
  bonecosDaRaridade,
  xpShareDaRaridade,
  nivelDaRaridade,
  sortearRaridadeCasa,
} from '../../shared/casas.mjs';
import {
  CASA_POR_RARIDADE,
  FRAGMENTO_CHAVE_ID,
  CUSTO_FRAGMENTOS_CASA,
} from './itens-nossos.mjs';

/** Chance por selvagem derrotado na Outland — 0,0005%, igual ao Fragmento de Shiny Stone. */
export const CHANCE_FRAGMENTO_CHAVE = 0.000005;

/** Preço da Casa em diamante, na Loja. Sorteia igual à fabricação. */
export const PRECO_CASA_DIAMANTE = 50;

/**
 * Teto de postos lidos por casa na coluna. A Lendária tem dois; o oito é só a rede para um jsonb
 * adulterado não virar uma lista de mil posições no login.
 */
const MAX_POSTOS_LIDOS = 8;

/** Teto de casas lidas na coluna `xp_share` — a mesma rede, para o objeto inteiro. */
const MAX_CASAS_LIDAS = 1_000;

const IDS_RARIDADE = new Set(RARIDADES_CASA.map((r) => r.id));

/**
 * A raridade, se for uma de verdade; `null` para qualquer outra coisa.
 *
 * O valor vem do jsonb do banco e do cliente, então só passa string que é id de raridade — nada
 * de número, objeto, `"__proto__"` ou `"Lendaria "` com espaço.
 */
export const raridadeCasaValida = (r) => (typeof r === 'string' && IDS_RARIDADE.has(r) ? r : null);

/** Um id positivo e inteiro, ou `null`. Serve para número de casa e id de pokémon. */
const idPositivo = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

// ------------------------------------------------------------------ as casas

/**
 * A ordem em que as casas aparecem: a mais rara primeiro, e dentro da raridade o número.
 *
 * É a ordem de quem abre o modal procurando "a minha Lendária" — e a mesma em que o crédito do
 * XP Share resolve um posto duplicado (fica no que rende mais).
 */
export function ordenarCasas(lista) {
  return [...lista].sort(
    (a, b) => nivelDaRaridade(b.raridade) - nivelDaRaridade(a.raridade) || a.id - b.id,
  );
}

/** As casas na MÃO do jogador: as que não estão presas num anúncio do Mercado. */
export const casasNaMao = (p) => (p.casas ?? []).filter((c) => !c.anunciada);

/**
 * A escolha PADRÃO de casas em uso, para quem nunca escolheu: primeiro as que JÁ têm pokémon nos
 * postos (a virada não pode tirar ninguém do XP Share sem clique), depois as de maior fatia, e
 * dentro disso o número.
 */
export function casasEmUsoPadrao(p, naMao = casasNaMao(p)) {
  const porCasa = p.xpShare?.porCasa ?? {};
  const temPostos = (c) => (porCasa[c.id] ?? []).some((x) => x != null);
  return [...naMao]
    .sort((a, b) => Number(temPostos(b)) - Number(temPostos(a))
      || nivelDaRaridade(b.raridade) - nivelDaRaridade(a.raridade) || a.id - b.id)
    .slice(0, MAX_CASAS_EM_USO);
}

/**
 * As casas que VALEM agora — as EM USO, no máximo `MAX_CASAS_EM_USO`.
 *
 * A escolha mora em `p.automation.casasEmUso` (números). Sem ela — conta que nunca escolheu, ou
 * campo torto — vale a escolha padrão, calculada na hora: é o que faz a virada não mudar nada para
 * quem já tinha escalado pokémon, e o que mantém estas regras testáveis sem o jogador inteiro.
 */
export function casasAtivas(p) {
  const naMao = casasNaMao(p);
  const escolha = p.automation?.casasEmUso;
  if (!Array.isArray(escolha)) return casasEmUsoPadrao(p, naMao);
  // Na ORDEM da escolha, e não na do banco: é a ordem que `fixarCasasEmUso` grava, e devolver outra
  // faria a mesma escolha parecer uma mudança a cada carregamento (e um flush à toa).
  const porId = new Map(naMao.map((c) => [c.id, c]));
  const out = [];
  for (const id of escolha) {
    const c = porId.get(Number(id));
    if (c && !out.includes(c)) out.push(c);
    if (out.length >= MAX_CASAS_EM_USO) break;
  }
  return out;
}

/** Uma casa EM USO do jogador pelo número, ou `null`. O número vem do cliente. */
export function casaAtivaPorId(p, id) {
  const n = idPositivo(id);
  if (!n) return null;
  return casasAtivas(p).find((c) => c.id === n) ?? null;
}

/** Uma casa na MÃO pelo número — em uso ou guardada —, ou `null`. É a que o Mercado anuncia. */
export function casaNaMaoPorId(p, id) {
  const n = idPositivo(id);
  if (!n) return null;
  return casasNaMao(p).find((c) => c.id === n) ?? null;
}

// ------------------------------------------------------------- os postos

/**
 * Lê a coluna `players.xp_share`.
 *
 * Dois formatos convivem, e é por isso que a função existe:
 *
 *   · `{ "12": [pokemonId|null, …], "40": [...] }` — o de hoje, um pedaço por casa;
 *   · `[pokemonId|null, …]` — o de ANTES das casas numeradas, quando só a casa equipada tinha
 *     postos. Volta como `legado`, e `aplicarXpShareLegado` o põe na casa certa assim que as
 *     casas do jogador chegam do banco.
 *
 * Tolerante de propósito: a coluna é jsonb e pode chegar como texto (driver antigo), como `null`
 * (conta anterior à coluna) ou com lixo dentro. O que não passar por `Number` vira posto vazio —
 * nunca uma exceção no login.
 */
export function normalizarXpShare(cru) {
  let bruto = cru;
  if (typeof cru === 'string') {
    try {
      bruto = JSON.parse(cru || '{}');
    } catch {
      return { porCasa: {}, legado: null };
    }
  }
  const lerIds = (lista) => lista.slice(0, MAX_POSTOS_LIDOS).map(idPositivo);
  if (Array.isArray(bruto)) {
    const ids = lerIds(bruto);
    return { porCasa: {}, legado: ids.some((x) => x != null) ? ids : null };
  }
  const porCasa = {};
  if (!bruto || typeof bruto !== 'object') return { porCasa, legado: null };
  let lidas = 0;
  for (const [chave, valor] of Object.entries(bruto)) {
    if (lidas++ >= MAX_CASAS_LIDAS) break;
    const casaId = idPositivo(chave);
    if (!casaId || !Array.isArray(valor)) continue;
    const ids = lerIds(valor);
    if (ids.some((x) => x != null)) porCasa[casaId] = ids;
  }
  return { porCasa, legado: null };
}

/**
 * O que o flush grava na coluna.
 *
 * Enquanto o legado não foi aplicado (as casas ainda não chegaram do banco), grava o LEGADO: um
 * flush nesse meio segundo do login escreveria `{}` por cima da escalação antiga, e o jogador
 * encontraria os postos apagados sem ter mexido em nada.
 */
export function xpShareParaGravar(p) {
  if (p.xpShare?.legado) return p.xpShare.legado;
  return p.xpShare?.porCasa ?? {};
}

/** Apaga o cache de quem recebe. Toda escrita em `porCasa` ou em `p.casas` passa por aqui. */
export const mexeuNoXpShare = (p) => {
  p.xpShareRecebe = null;
};

/** Os postos de UMA casa, na largura da raridade: `[pokemonId|null, …]`. */
export function postosDaCasa(p, casa) {
  const cap = bonecosDaRaridade(casa?.raridade);
  const ids = p.xpShare?.porCasa?.[casa?.id] ?? [];
  const out = [];
  for (let i = 0; i < cap; i++) out.push(ids[i] ?? null);
  return out;
}

/**
 * Onde este pokémon está registrado: `{ casaId, slot }`, ou `null`.
 *
 * `exceto` é o posto que está sendo trocado — registrar de novo o mesmo bicho no mesmo lugar não
 * é "estar em outro posto".
 */
export function postoDoPokemon(p, pokemonId, exceto = null) {
  const alvo = idPositivo(pokemonId);
  if (!alvo) return null;
  const porCasa = p.xpShare?.porCasa ?? {};
  for (const [chave, ids] of Object.entries(porCasa)) {
    const casaId = Number(chave);
    for (let slot = 0; slot < ids.length; slot++) {
      if (ids[slot] !== alvo) continue;
      if (exceto && exceto.casaId === casaId && exceto.slot === slot) continue;
      return { casaId, slot };
    }
  }
  return null;
}

/**
 * Escreve (ou esvazia, com `pokemonId = null`) um posto.
 *
 * Não valida nada além da forma: dono, equipe, duplicata e item segurado são do sim, que tem as
 * mensagens para cada recusa. A casa sem ninguém some do objeto, para a coluna não carregar
 * `[null]` de toda casa que o jogador já teve.
 */
export function registrarNoPosto(p, casa, slot, pokemonId) {
  const cap = bonecosDaRaridade(casa.raridade);
  if (!Number.isInteger(slot) || slot < 0 || slot >= cap) return false;
  p.xpShare ??= { porCasa: {}, legado: null };
  const porCasa = p.xpShare.porCasa;
  const ids = postosDaCasa(p, casa);
  ids[slot] = pokemonId == null ? null : idPositivo(pokemonId);
  if (ids.some((x) => x != null)) porCasa[casa.id] = ids;
  else delete porCasa[casa.id];
  mexeuNoXpShare(p);
  return true;
}

/**
 * Esvazia os postos de uma casa e devolve quem estava neles.
 *
 * É o que o anúncio no Mercado faz: a casa sai da mão do dono, e os pokémon dela saem do XP
 * Share junto — cancelar o anúncio não os traz de volta.
 */
export function soltarPostosDaCasa(p, casaId) {
  const porCasa = p.xpShare?.porCasa;
  const ids = porCasa?.[casaId];
  if (!ids) return [];
  delete porCasa[casaId];
  mexeuNoXpShare(p);
  return ids.filter((x) => x != null);
}

// ------------------------------------------------------------ as casas em uso

/**
 * Grava a escolha de casas em uso, saneada: só número de casa NA MÃO, sem repetir, no teto.
 *
 * Sem `ids`, grava a escolha que vale agora — é assim que a escolha PADRÃO vira escolha gravada
 * no primeiro carregamento, e uma casa que chegar depois não embaralha as que já estavam. Casa
 * anunciada ou vendida cai da lista aqui. Devolve `true` quando mudou algo.
 */
export function fixarCasasEmUso(p, ids = null) {
  if (!p.casas) return false;
  p.automation ??= {};
  const naMao = new Set(casasNaMao(p).map((c) => c.id));
  const limpa = [];
  for (const v of ids ?? casasAtivas(p).map((c) => c.id)) {
    const n = idPositivo(v);
    if (n && naMao.has(n) && !limpa.includes(n)) limpa.push(n);
    if (limpa.length >= MAX_CASAS_EM_USO) break;
  }
  const antes = p.automation.casasEmUso;
  if (Array.isArray(antes) && antes.length === limpa.length && antes.every((x, i) => x === limpa[i])) return false;
  p.automation.casasEmUso = limpa;
  mexeuNoXpShare(p);
  return true;
}

/**
 * Põe (`usar = true`) ou tira UMA casa de uso. Devolve `{ ok, erro?, soltos }`.
 *
 * Pôr exige a casa na mão e uma vaga — o erro é chave de i18n. Tirar solta os pokémon dos postos
 * DELA: casa guardada não reparte XP, e deixar os registrados lá pareceria escalação valendo.
 * Pedir o que já é (pôr a que está em uso, tirar a guardada) não é erro.
 */
export function usarCasa(p, casaId, usar) {
  const casa = casaNaMaoPorId(p, casaId);
  if (!casa) return { ok: false, erro: 'casa.naoDisponivel', soltos: [] };
  const emUso = casasAtivas(p).map((c) => c.id);
  const jaEmUso = emUso.includes(casa.id);
  if (usar) {
    if (jaEmUso) return { ok: true, soltos: [] };
    if (emUso.length >= MAX_CASAS_EM_USO) return { ok: false, erro: 'casa.limiteEmUso', soltos: [] };
    fixarCasasEmUso(p, [...emUso, casa.id]);
    return { ok: true, soltos: [] };
  }
  if (!jaEmUso) return { ok: true, soltos: [] };
  const soltos = soltarPostosDaCasa(p, casa.id);
  fixarCasasEmUso(p, emUso.filter((id) => id !== casa.id));
  return { ok: true, soltos };
}

/**
 * Tira dos postos quem não pode mais estar neles.
 *
 * Um posto vira inválido por caminhos que não passam por aqui: o pokémon foi para o Depot, foi
 * vendido ou anunciado, a casa foi anunciada ou vendida. Em vez de pendurar um gancho em cada um
 * — várias chances de esquecer um —, a validade é conferida onde ela IMPORTA: no pacote da tela
 * e no crédito. `naEquipe(id)` diz se o pokémon ainda está num dos cinco lugares.
 *
 * Um pokémon repetido (só por dado torto: a trava de `xpshare.escolher` não deixa) fica no posto
 * de MAIOR fatia, que é o que ele renderia de qualquer jeito.
 *
 * Sem `p.casas` carregado ainda não toca em nada: nesse meio segundo do login toda casa pareceria
 * "não ser mais dele", e a limpeza apagaria a escalação inteira.
 *
 * Devolve `true` quando mudou algo, para quem chama marcar sujo.
 */
export function limparXpShare(p, naEquipe) {
  const porCasa = p.xpShare?.porCasa;
  if (!porCasa || !p.casas) return false;
  const ativas = new Map(casasAtivas(p).map((c) => [c.id, c]));
  const fatorDe = (id) => xpShareDaRaridade(ativas.get(id)?.raridade);
  const chaves = Object.keys(porCasa).map(Number).sort((a, b) => fatorDe(b) - fatorDe(a) || a - b);
  const vistos = new Set();
  let mudou = false;
  for (const casaId of chaves) {
    const casa = ativas.get(casaId);
    const ids = porCasa[casaId];
    if (!casa || !Array.isArray(ids)) {
      delete porCasa[casaId];
      mudou = true;
      continue;
    }
    const cap = bonecosDaRaridade(casa.raridade);
    if (ids.length > cap) {
      ids.length = cap;
      mudou = true;
    }
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id == null) continue;
      if (vistos.has(id) || !naEquipe(id)) {
        ids[i] = null;
        mudou = true;
        continue;
      }
      vistos.add(id);
    }
    if (!ids.some((x) => x != null)) {
      delete porCasa[casaId];
      mudou = true;
    }
  }
  if (mudou) mexeuNoXpShare(p);
  return mudou;
}

/**
 * Põe a escalação ANTIGA (`[ids]`, da época da casa equipada) na casa em que ela estava.
 *
 * A casa escolhida é a primeira ATIVA da raridade que o jogador tinha equipada — era nela que os
 * pokémon estavam, e trocar de raridade na migração mudaria a fatia de alguém sem clique nenhum.
 * Sem casa daquela raridade (vendeu), vai para a melhor que ele tiver, cortada nos postos dela.
 * Sem casa nenhuma, a escalação some: não há onde registrar.
 */
export function aplicarXpShareLegado(p, raridadeEquipada = null) {
  const legado = p.xpShare?.legado;
  if (!legado || !p.casas) return false;
  p.xpShare.legado = null;
  // Na MÃO, e não em uso: a virada roda antes de existir escolha de casas em uso, e a escolha
  // padrão prefere justamente a casa com gente nos postos — é isso que a põe em uso.
  const ativas = ordenarCasas(casasNaMao(p));
  const rar = raridadeCasaValida(raridadeEquipada);
  const alvo = (rar && ativas.filter((c) => c.raridade === rar).sort((a, b) => a.id - b.id)[0]) || ativas[0];
  if (alvo) {
    const cap = bonecosDaRaridade(alvo.raridade);
    const ids = legado.slice(0, cap);
    if (ids.some((x) => x != null)) {
      while (ids.length < cap) ids.push(null);
      p.xpShare.porCasa[alvo.id] = ids;
    }
  }
  mexeuNoXpShare(p);
  return true;
}

/**
 * Quem recebe XP Share neste abate: `[{ pkId, casaId, slot, fator }]`.
 *
 * Cacheado em `p.xpShareRecebe` porque o crédito roda UMA VEZ POR ABATE — várias vezes por
 * segundo por jogador —, e remontar a lista a partir de todas as casas a cada golpe seria pagar
 * pelo número de casas o tempo inteiro. Com o cache, o abate custa o número de REGISTRADOS, que
 * tem teto na equipe (cinco). O cache cai em `mexeuNoXpShare`.
 */
export function recebedoresXpShare(p) {
  if (p.xpShareRecebe) return p.xpShareRecebe;
  const lista = [];
  const porCasa = p.xpShare?.porCasa ?? {};
  for (const casa of casasAtivas(p)) {
    const ids = porCasa[casa.id];
    if (!ids) continue;
    const fator = xpShareDaRaridade(casa.raridade);
    const cap = Math.min(ids.length, bonecosDaRaridade(casa.raridade));
    for (let slot = 0; slot < cap; slot++) {
      if (ids[slot] != null) lista.push({ pkId: ids[slot], casaId: casa.id, slot, fator });
    }
  }
  p.xpShareRecebe = lista;
  return lista;
}

// ------------------------------------------------------- casas-item antigas

/**
 * As casas que ainda moram em `items` como QUANTIDADE — `[{ raridade, itemId, qtd }]`.
 *
 * A migração do boot converte todas, mas um item de casa pode reaparecer na bolsa por um caminho
 * que só escreve no banco (o ajuste manual do admin, um anúncio antigo devolvido por uma
 * varredura). O login confere com esta função e numera o que achar.
 */
export function casasNaBolsa(items) {
  const out = [];
  for (const r of RARIDADES_CASA) {
    const itemId = CASA_POR_RARIDADE[r.id];
    const qtd = Math.floor(Number(items?.[itemId] ?? 0));
    if (qtd > 0) out.push({ raridade: r.id, itemId, qtd });
  }
  return out;
}

/**
 * A ordem em que as casas que já existiam ganham número — a numeração retroativa.
 *
 * A pergunta é "quem tirou a primeira casa do servidor?", e a resposta está no log de gameplay
 * (`casa` · `nova`, uma linha por sorteio, com a raridade e o instante). O problema é que as
 * casas eram QUANTIDADE: o log diz que o fulano tirou uma Comum na terça, mas não diz qual das
 * Comuns que existem hoje é aquela. O casamento é feito em dois passos, por raridade:
 *
 *   1. quem tirou e ainda tem: a casa fica com o sorteio DO PRÓPRIO dono (o mais antigo dele);
 *   2. as que mudaram de mão pegam os sorteios que sobraram, do mais antigo para o mais novo —
 *      e aí o `criador` é quem tirou, não quem tem hoje.
 *
 * Casa sem sorteio no log (o log começou depois dela, ou veio de um caminho que não loga) vai
 * para o fim, na ordem do dono. Nenhum número fica vago: a numeração é de casas que EXISTEM.
 *
 * `unidades`: `[{ donoId, dono, raridade, anuncioId }]`, uma por casa.
 * `aberturas`: `[{ logId, playerId, nick, raridade, em }]`, `em` em ms.
 * Devolve as unidades na ordem dos números, cada uma com `em`, `criadorId` e `criador`.
 */
export function planejarNumeracao({ unidades, aberturas }) {
  const cronologica = [...aberturas].sort((a, b) => a.em - b.em || a.logId - b.logId);
  const porRaridade = new Map();
  const porDono = new Map();
  for (const a of cronologica) {
    const s = { ...a, usada: false };
    if (!porRaridade.has(a.raridade)) porRaridade.set(a.raridade, []);
    porRaridade.get(a.raridade).push(s);
    const chave = `${a.raridade}:${a.playerId}`;
    if (!porDono.has(chave)) porDono.set(chave, []);
    porDono.get(chave).push(s);
  }

  const saida = unidades.map((u) => ({ ...u, em: null, logId: null, criadorId: u.donoId, criador: u.dono }));
  const ordemDoDono = (a, b) => a.donoId - b.donoId || (a.anuncioId ?? 0) - (b.anuncioId ?? 0);
  const naOrdemDoDono = [...saida].sort(ordemDoDono);
  const casar = (u, a) => {
    a.usada = true;
    u.em = a.em;
    u.logId = a.logId;
    u.criadorId = a.playerId;
    u.criador = a.nick;
  };

  for (const u of naOrdemDoDono) {
    const fila = porDono.get(`${u.raridade}:${u.donoId}`);
    const a = fila?.find((x) => !x.usada);
    if (a) casar(u, a);
  }
  const cursor = new Map();
  for (const u of naOrdemDoDono) {
    if (u.em != null) continue;
    const fila = porRaridade.get(u.raridade) ?? [];
    let i = cursor.get(u.raridade) ?? 0;
    while (i < fila.length && fila[i].usada) i++;
    cursor.set(u.raridade, i);
    if (i < fila.length) casar(u, fila[i]);
  }

  return saida.sort((a, b) => {
    if (a.em != null && b.em != null) return a.em - b.em || a.logId - b.logId;
    if (a.em != null) return -1;
    if (b.em != null) return 1;
    return ordemDoDono(a, b);
  });
}

// ------------------------------------------------------- fragmentos de chave

/**
 * Credita `qtd` Fragmentos de Chave na bolsa e soma no contador vitalício da conta.
 *
 * Sem teto: Fragmento de Chave cai livre na Outland. `fragChaveTotal` é só um número histórico
 * (nenhuma regra depende dele) — ver a coluna em `db.mjs`.
 */
export function darFragmentosDeChave(p, qtd = 1) {
  const n = Math.max(0, Math.floor(qtd));
  if (n <= 0) return 0;
  p.items[FRAGMENTO_CHAVE_ID] = (p.items[FRAGMENTO_CHAVE_ID] ?? 0) + n;
  p.fragChaveTotal = (Number(p.fragChaveTotal) || 0) + n;
  return n;
}

/**
 * Sorteia o drop de Fragmento de Chave. `null` quando não cai (o caso normal).
 *
 * `mult` é o degrau da Outland — a escada mora em `shared/outland-tiers.mjs`.
 */
export function rolarFragmentoChave(p, bonusPct = 0, area = null, mult = 1) {
  if (area !== 'outland') return null;
  // O Loot Boost vale aqui pela mesma razão do Bronze Boss Token: é drop de kill na Outland.
  if (Math.random() >= CHANCE_FRAGMENTO_CHAVE * (1 + bonusPct / 100) * mult) return null;
  return { itemId: FRAGMENTO_CHAVE_ID, nome: 'Key Fragment', qtd: 1 };
}

// ---------------------------------------------------------------- fabricar

/**
 * Gasta 10 fragmentos e devolve a raridade sorteada. `null` se não dá para fabricar.
 *
 * Quem chama cria a casa no banco (é lá que o número nasce) e devolve os fragmentos se a
 * gravação falhar — esta função só cobra e sorteia.
 */
export function fabricarCasaComFragmentos(p) {
  const tem = Number(p.items?.[FRAGMENTO_CHAVE_ID] ?? 0);
  if (tem < CUSTO_FRAGMENTOS_CASA) return null;
  p.items[FRAGMENTO_CHAVE_ID] = tem - CUSTO_FRAGMENTOS_CASA;
  if (!p.items[FRAGMENTO_CHAVE_ID]) delete p.items[FRAGMENTO_CHAVE_ID];
  return sortearRaridadeCasa();
}
