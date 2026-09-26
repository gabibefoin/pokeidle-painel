// PvP AMISTOSO — o desafio entre dois amigos, pela conversa da Lista de Amigos.
//
// ### O fluxo
//
//   1. Fulano abre a conversa com Beltrano e clica em "PvP amistoso". O convite nasce aqui, no
//      Redis, com prazo de 5 minutos, e vira uma linha da conversa (DM do tipo 3) com os botões
//      Aceitar / Recusar do lado de Beltrano.
//   2. Beltrano aceita: a luta roda INTEIRA no servidor, na hora, com as regras do Ranqueado
//      (`simularDuelo` — a mesma arena, a mesma régua de nível, o mesmo simulador), e a fita vai
//      para os dois. Não mexe em PR, não dá prêmio, não grava placar: é amistoso.
//   3. Os DOIS entram numa espera de 5 minutos em que não desafiam nem aceitam desafio de
//      ninguém. É ela que impede a turma de transformar o amistoso num segundo ranqueado sem fila.
//
// ### Por que mora no Redis, e não no Postgres
//
// Um convite vive cinco minutos e ninguém precisa dele depois — o que fica para a história é a
// linha da conversa, e ela já está no banco (`dm_mensagens`). O Redis dá o prazo de graça (TTL)
// e é global: o convite nasce no sim de quem desafia e é aceito no sim de quem foi desafiado,
// que quase nunca são o mesmo processo.
//
// ### As três travas, e por que cada uma é atômica
//
//   · o CONVITE é consumido por um script Lua que confere o destinatário e apaga numa operação
//     só — dois cliques em "Aceitar" (ou Aceitar e Recusar ao mesmo tempo) resolvem UMA vez;
//   · a ESPERA dos dois é armada com `SET … NX` antes da luta: se Beltrano aceitar dois convites
//     no mesmo instante, só um deles consegue a vaga, e o outro devolve a do desafiante;
//   · o convite PENDENTE de quem desafia é um só (`pvpa:saida:<nick>`), e também sai por NX —
//     não dá para espalhar vinte convites e ficar com o que for aceito primeiro.
//
// Nada que decide a luta vem do cliente: o pacote de aceitar tem o id do convite e mais nada.
import { randomUUID } from 'node:crypto';
import { pub } from '../bus.mjs';
import { pool } from '../db.mjs';
import * as pvpdb from '../pvp-ranqueado-db.mjs';
import { simularDuelo } from './pvp-ranqueado.mjs';
import { PVP_TIME_MAX } from '../../shared/pvp-rank.mjs';

/** Quanto tempo o convidado tem para aceitar. */
export const CONVITE_MS = 5 * 60_000;
/** A espera dos DOIS depois de uma luta aceita — vale contra qualquer outro amigo. */
export const ESPERA_MS = 5 * 60_000;
/** Quanto tempo a fita fica guardada para o "Assistir" da conversa. */
export const FITA_MS = 30 * 60_000;

const chaveConvite = (id) => `pvpa:conv:${id}`;
const chaveSaida = (key) => `pvpa:saida:${key}`;
const chaveEspera = (key) => `pvpa:cd:${key}`;
const chaveFita = (id) => `pvpa:fita:${id}`;

/** Um id de convite que veio do CLIENTE: 32 hexadecimais, e nada mais chega ao Redis. */
export const idConviteValido = (id) => typeof id === 'string' && /^[0-9a-f]{32}$/.test(id);

export class ErroAmistoso extends Error {
  constructor(chave, params = {}) {
    super(chave);
    this.chave = chave;
    this.params = params;
  }
}

/** Quanto falta da espera de um jogador, em ms. `0` = livre. */
export async function msDeEspera(key) {
  try {
    const ttl = await pub.pttl(chaveEspera(key));
    return ttl > 0 ? ttl : 0;
  } catch {
    return 0;
  }
}

/** O convite pendente que ESTE jogador mandou, ou `null`. */
export async function conviteDeSaida(key) {
  try {
    const id = await pub.get(chaveSaida(key));
    if (!id) return null;
    const raw = await pub.get(chaveConvite(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const minutos = (ms) => Math.max(1, Math.ceil(ms / 60_000));

/**
 * Cria o convite. Quem chama (o sim) já conferiu a amizade, o nível e a presença do amigo.
 *
 * @param de   `{ key, dbId, nick }` — quem desafia
 * @param para `{ key, dbId, nick }` — o amigo
 * @returns o convite (`{ id, deKey, deId, deNick, paraKey, paraId, paraNick, criadoEm, expiraEm }`)
 * @throws `ErroAmistoso` com a chave de tradução da recusa
 */
export async function criarConvite(de, para, agora = Date.now()) {
  if (!de?.key || !para?.key || de.key === para.key) throw new ErroAmistoso('amigos.pvpa.invalido');

  const [minhaEspera, esperaDele] = await Promise.all([msDeEspera(de.key), msDeEspera(para.key)]);
  if (minhaEspera > 0) throw new ErroAmistoso('amigos.pvpa.euEspero', { min: minutos(minhaEspera) });
  if (esperaDele > 0) throw new ErroAmistoso('amigos.pvpa.eleEspera', { nick: para.nick, min: minutos(esperaDele) });

  const convite = {
    id: randomUUID().replace(/-/g, ''),
    deKey: de.key,
    deId: Number(de.dbId),
    deNick: de.nick,
    paraKey: para.key,
    paraId: Number(para.dbId),
    paraNick: para.nick,
    criadoEm: agora,
    expiraEm: agora + CONVITE_MS,
  };

  // Um convite pendente por desafiante, e ele é reservado ANTES de o convite existir: sem o NX,
  // dois cliques rápidos em "PvP amistoso" (ou um script) criariam dois convites vivos.
  const reservou = await pub.set(chaveSaida(de.key), convite.id, 'PX', CONVITE_MS, 'NX');
  if (reservou !== 'OK') {
    const pendente = await conviteDeSaida(de.key);
    throw new ErroAmistoso('amigos.pvpa.jaTemConvite', { nick: pendente?.paraNick ?? '?' });
  }
  await pub.set(chaveConvite(convite.id), JSON.stringify(convite), 'PX', CONVITE_MS);
  return convite;
}

/** Guarda o id da linha da conversa no convite — é ela que o aceite atualiza depois. */
export async function anotarLinhaDaConversa(convite, dmId) {
  const resta = Math.max(1, convite.expiraEm - Date.now());
  const comDm = { ...convite, dmId: Number(dmId) };
  await pub.set(chaveConvite(convite.id), JSON.stringify(comDm), 'PX', resta, 'XX').catch(() => {});
  return comDm;
}

/**
 * Consome o convite SE ele ainda existe e SE `quem` pode consumi-lo (`'para'` para aceitar ou
 * recusar, `'de'` para cancelar). Numa operação só: o segundo clique encontra nada.
 */
const LUA_CONSUMIR = `
local v = redis.call('GET', KEYS[1])
if not v then return false end
local ok, o = pcall(cjson.decode, v)
if not ok then return false end
local dono = o[ARGV[1] .. 'Key']
if dono ~= ARGV[2] then return 'X' end
redis.call('DEL', KEYS[1])
if redis.call('GET', KEYS[2]) == o['id'] then redis.call('DEL', KEYS[2]) end
return v`;

async function consumir(id, lado, key) {
  if (!idConviteValido(id)) return null;
  const raw = await pub.get(chaveConvite(id)).catch(() => null);
  if (!raw) return null;
  let deKey;
  try { deKey = JSON.parse(raw).deKey; } catch { return null; }
  const r = await pub.eval(LUA_CONSUMIR, 2, chaveConvite(id), chaveSaida(deKey), lado, key);
  if (!r || r === 'X') return null;
  return JSON.parse(r);
}

/** O convite como está no Redis, sem consumir — `null` se não existe. */
export async function lerConvite(id) {
  if (!idConviteValido(id)) return null;
  try {
    const raw = await pub.get(chaveConvite(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** O convite ainda está de pé? (Para saber se uma recusa aconteceu antes ou depois de consumi-lo.) */
export async function conviteExiste(id) {
  if (!idConviteValido(id)) return false;
  try {
    return (await pub.exists(chaveConvite(id))) === 1;
  } catch {
    return true; // na dúvida, não marca a bolha como falha
  }
}

/** Recusa (o convidado) — devolve o convite consumido, ou `null` se já não havia. */
export const recusarConvite = (id, key) => consumir(id, 'para', key);

/** Cancela (quem desafiou) — devolve o convite consumido, ou `null` se já não havia. */
export const cancelarConvite = (id, key) => consumir(id, 'de', key);

/** A equipe de hunt gravada: os cinco da equipe, na ordem dos slots. É o plano B de quem não montou a de PvP. */
async function equipeDeHunt(playerId) {
  const { rows } = await pool.query(
    `SELECT id FROM player_pokemon
      WHERE player_id = $1 AND slot IS NOT NULL AND anuncio_id IS NULL
      ORDER BY slot ASC, id ASC LIMIT $2`,
    [Number(playerId), PVP_TIME_MAX],
  );
  return rows.map((r) => Number(r.id));
}

/**
 * As duas equipes: a de PvP salva (a do Ranqueado) e, para quem nunca montou uma, a de hunt.
 * Quem escolhe o que luta é o banco — o pacote de aceitar não carrega pokémon nenhum.
 */
async function equipesDosDois(idA, idB) {
  const ids = [Number(idA), Number(idB)];
  let equipes = await pvpdb.equipesDaPartida(ids);
  const semTime = ids.filter((id) => !(equipes.get(id) ?? []).length);
  if (semTime.length) {
    const escolhidas = new Map();
    for (const id of semTime) escolhidas.set(id, await equipeDeHunt(id));
    equipes = await pvpdb.equipesDaPartida(ids, { escolhidas });
  }
  return equipes;
}

async function perfis(ids) {
  const { rows } = await pool.query(
    `SELECT id, nick, looktype, visual FROM players WHERE id = ANY($1::bigint[])`,
    [ids.map(Number)],
  );
  return new Map(rows.map((r) => [Number(r.id), r]));
}

/**
 * Aceita e LUTA. `quem` é o convidado (o jogador do sim que recebeu o clique).
 *
 * A ordem é a que protege as travas: consome o convite → arma a espera dos dois (NX) → monta
 * as equipes → simula → guarda a fita. Se algo falhar depois de a espera ser armada, ela é
 * desarmada: ninguém fica cinco minutos de castigo por uma luta que não aconteceu.
 *
 * @returns `{ convite, partida }` — `partida` é o resultado neutro (lado A = quem desafiou)
 * @throws `ErroAmistoso`
 */
export async function aceitarConvite(id, quem, agora = Date.now()) {
  if (!idConviteValido(id)) throw new ErroAmistoso('amigos.pvpa.sumiu');

  // A espera é conferida ANTES de consumir: quem está esperando não perde o convite por isso —
  // ele continua lá, e dá para aceitar quando a espera passar (se ainda estiver no prazo).
  const cru = await pub.get(chaveConvite(id)).catch(() => null);
  if (!cru) throw new ErroAmistoso('amigos.pvpa.sumiu');
  const previa = JSON.parse(cru);
  if (previa.paraKey !== quem.key) throw new ErroAmistoso('amigos.pvpa.sumiu');
  const [minhaEspera, esperaDele] = await Promise.all([msDeEspera(quem.key), msDeEspera(previa.deKey)]);
  if (minhaEspera > 0) throw new ErroAmistoso('amigos.pvpa.euEspero', { min: minutos(minhaEspera) });
  if (esperaDele > 0) throw new ErroAmistoso('amigos.pvpa.eleEspera', { nick: previa.deNick, min: minutos(esperaDele) });

  const convite = await consumir(id, 'para', quem.key);
  if (!convite) throw new ErroAmistoso('amigos.pvpa.sumiu');

  // As duas esperas, cada uma com NX. Se a segunda não entrar (o desafiante acabou de lutar com
  // outro amigo neste mesmo instante), a primeira é desfeita.
  const ateEm = String(agora + ESPERA_MS);
  const a = await pub.set(chaveEspera(convite.deKey), ateEm, 'PX', ESPERA_MS, 'NX');
  if (a !== 'OK') throw new ErroAmistoso('amigos.pvpa.eleEspera', { nick: convite.deNick, min: minutos(await msDeEspera(convite.deKey)) });
  const b = await pub.set(chaveEspera(convite.paraKey), ateEm, 'PX', ESPERA_MS, 'NX');
  if (b !== 'OK') {
    await pub.del(chaveEspera(convite.deKey)).catch(() => {});
    throw new ErroAmistoso('amigos.pvpa.euEspero', { min: minutos(await msDeEspera(convite.paraKey)) });
  }
  const desarmar = () => pub.del(chaveEspera(convite.deKey), chaveEspera(convite.paraKey)).catch(() => {});

  try {
    const [equipes, perfisDB] = await Promise.all([
      equipesDosDois(convite.deId, convite.paraId),
      perfis([convite.deId, convite.paraId]),
    ]);
    const lado = (dbId, nick) => {
      const pf = perfisDB.get(Number(dbId));
      return { dbId: Number(dbId), nick: pf?.nick ?? nick, looktype: pf?.looktype, visual: pf?.visual, pokemons: equipes.get(Number(dbId)) ?? [] };
    };
    const r = await simularDuelo(lado(convite.deId, convite.deNick), lado(convite.paraId, convite.paraNick));
    if (r.semTime) {
      await desarmar();
      const sem = r.semTime[0] ? convite.deNick : convite.paraNick;
      throw new ErroAmistoso('amigos.pvpa.semTime', { nick: sem });
    }
    const partida = {
      id: convite.id,
      versao: r.versao,
      arena: r.arena,
      replay: r.replay,
      motivo: r.motivo,
      duracaoMs: r.duracaoMs,
      venceuDesafiante: !!r.venceuA,
      vencedor: r.venceuA ? convite.deNick : convite.paraNick,
      de: convite.deNick,
      para: convite.paraNick,
      em: agora,
    };
    // A fita fica meia hora para o "Assistir" da conversa. Falhar aqui não desfaz a luta — os
    // dois já vão receber a fita ao vivo; só o replay posterior é que não existiria.
    await pub.set(chaveFita(convite.id), JSON.stringify(partida), 'PX', FITA_MS).catch(() => {});
    return { convite, partida };
  } catch (err) {
    if (!(err instanceof ErroAmistoso)) await desarmar();
    throw err;
  }
}

/** A fita guardada de uma luta, se `key` lutou nela. `null` quando expirou ou não é dele. */
export async function fitaDaLuta(id, key) {
  if (!idConviteValido(id)) return null;
  try {
    const raw = await pub.get(chaveFita(id));
    if (!raw) return null;
    const p = JSON.parse(raw);
    const k = String(key).toLowerCase();
    if (p.de?.toLowerCase() !== k && p.para?.toLowerCase() !== k) return null;
    return p;
  } catch {
    return null;
  }
}

/** O pacote de UM lado: a fita, quem era o outro e se ganhou. `meuLado` pinta a coluna certa. */
export function pacoteParaLado(partida, souDesafiante) {
  return {
    id: partida.id,
    versao: partida.versao,
    replay: partida.replay,
    motivo: partida.motivo,
    duracaoMs: partida.duracaoMs,
    venci: souDesafiante ? partida.venceuDesafiante : !partida.venceuDesafiante,
    oponente: { nick: souDesafiante ? partida.para : partida.de },
    meuLado: souDesafiante ? 1 : 2,
    amistoso: true,
  };
}
