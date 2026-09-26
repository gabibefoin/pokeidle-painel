// O AUTO SELECIONAR da Oferenda, e a equipe que o perfil mostra.
//
// O botão enche as casas vazias com os pokémon de menor nota (N=). O que este teste protege:
//
//   · **a régua**: nunca shiny, P5, item segurado, refino, TM, starter, trancado, vitrine, nem as
//     equipes do PvP Ranqueado e do campeonato — e, do resto, os de menor nota, na ordem certa;
//   · **o que ele escolhe, o servidor aceita**: a roda montada pelo botão passa em
//     `validarOferenda` e gira de verdade;
//   · **o socket**: `oferenda.protegidos` devolve as duas equipes do próprio jogador e nada mais;
//   · **o perfil**: a ficha de um inscrito no campeonato mostra a equipe do PvP Ranqueado, e a
//     equipe do campeonato não sai do servidor;
//   · **a tela**: o botão da roleta, o da folha (que respeita a busca), o "nada a escolher" e o
//     prazo sem resposta, que não escolhe nada.
//
// A parte pura roda sem nada. O resto precisa do servidor de pé e do Chrome:
//
//   npm start
//   node tools/teste-oferenda-auto.mjs
//
// `SO_PURO=1` roda só a parte pura. `PRINT=arquivo.png` guarda a roleta cheia pelo botão,
// `LOTE=arquivo.png` guarda o diálogo do "oferendar tudo", e
// `FOLHA=arquivo.png`, a folha de escolha depois do botão de lá.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import {
  OFERENDA_CASAS,
  escolherPioresDaOferenda,
  motivoForaDoAuto,
  montarRoleta,
} from '../src/shared/oferenda.mjs';
import { AUTO_LOCK_NOTA_MIN, notaDePokemon } from '../src/shared/nota-pokemon.mjs';
import { XP_SHARE_HELD_ID } from '../src/shared/xp-share-held.mjs';
import { campeonatoDe } from '../src/shared/campeonato.mjs';

/** O Mundial #1 — a edição de verdade que este teste usa para inscrever a conta. */
const CAMPEONATO = campeonatoDe('mundial', 2026, 9);
import { criarLimites } from '../src/server/limites-ws.mjs';
import { CLIENTE, SERVIDOR } from '../src/server/protocol.mjs';

const SO_PURO = process.env.SO_PURO === '1';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (lista) => JSON.stringify(lista.map((pk) => pk.id));

console.log('AUTO SELECIONAR DA OFERENDA\n===========================');

// ------------------------------------------------------------------------------------------------
secao('A régua do botão');
{
  const base = { id: 1, tipos: ['FIRE'], level: 10, potencia: 1, shiny: false };
  ok(motivoForaDoAuto(base) === null, 'um pokémon comum pode entrar');
  ok(motivoForaDoAuto(null) === 'sumiu', 'sem pokémon, fora');
  ok(motivoForaDoAuto({ ...base, shiny: true }) === 'shiny', 'shiny fica de fora');
  ok(motivoForaDoAuto({ ...base, potencia: 5 }) === 'p5', 'P5 fica de fora');
  ok(motivoForaDoAuto({ ...base, potencia: 4 }) === null, 'P4 pode');
  ok(motivoForaDoAuto({ ...base, heldItemId: XP_SHARE_HELD_ID }) === 'item', 'quem segura item fica de fora');
  ok(motivoForaDoAuto({ ...base, heldItemId: 0 }) === 'item', 'mesmo com id 0 (é item do mesmo jeito)');
  ok(motivoForaDoAuto({ ...base, refinoTotal: 3 }) === 'refino', 'refinado (pelo total) fica de fora');
  ok(motivoForaDoAuto({ ...base, refino: { hp: 0, atk: 2 } }) === 'refino', 'refinado (pelo objeto) fica de fora');
  ok(motivoForaDoAuto({ ...base, refino: { hp: 0, atk: 0 }, refinoTotal: 0 }) === null, 'refino zerado pode');
  ok(motivoForaDoAuto({ ...base, tmElemental: 'FIRE' }) === 'tm', 'TM elemental fica de fora');
  ok(motivoForaDoAuto({ ...base, tmAoe: true }) === 'tm', 'TM em área fica de fora');
  ok(motivoForaDoAuto({ ...base, starter: true }) === 'starter', 'o starter fica de fora');
  ok(motivoForaDoAuto({ ...base, tipos: ['???'] }) === 'semPedra', 'quem não pinta pedra nenhuma fica de fora');
  ok(motivoForaDoAuto({ ...base, tipos: [] }) === 'semPedra', 'e quem não tem tipo também');
}

// ------------------------------------------------------------------------------------------------
secao('Os de menor nota, na ordem');
{
  const notas = new Map();
  const pk = (id, nota, extra = {}) => {
    notas.set(id, nota);
    return { id, tipos: ['WATER'], level: 10, potencia: 1, shiny: false, ...extra };
  };
  const nota = (k) => notas.get(k.id);
  const lista = [
    pk(1, 5), pk(2, 1), pk(3, 3), pk(4, 0.5), pk(5, 2), pk(6, 4), pk(7, 9), pk(8, 1.5),
  ];
  ok(ids(escolherPioresDaOferenda(lista, { nota })) === '[4,2,8,5,3]', 'os cinco de menor nota, do menor ao maior',
    ids(escolherPioresDaOferenda(lista, { nota })));
  ok(ids(escolherPioresDaOferenda(lista, { nota, vagas: 2 })) === '[4,2]', 'vagas limita quantos entram');
  ok(ids(escolherPioresDaOferenda(lista, { nota, vagas: 0 })) === '[]', 'sem vaga, nada');
  ok(ids(escolherPioresDaOferenda(lista, { nota, vagas: -3 })) === '[]', 'vaga negativa, nada');
  ok(escolherPioresDaOferenda(lista, { nota, vagas: 99 }).length === OFERENDA_CASAS, 'nunca mais que as casas da roleta');
  ok(ids(escolherPioresDaOferenda(lista, { nota, vagas: 'x' })) === '[]', 'vaga que não é número, nada');
  ok(ids(escolherPioresDaOferenda(lista, { nota, jaEscolhidos: [4, 2], vagas: 3 })) === '[8,5,3]',
    'quem já está nas casas não entra de novo');
  ok(ids(escolherPioresDaOferenda(lista, { nota, protegidos: ['2', 8] })) === '[4,5,3,6,1]',
    'os protegidos ficam de fora (id em texto também)');
  ok(ids(escolherPioresDaOferenda([...lista, lista[3], lista[3]], { nota, vagas: 3 })) === '[4,2,8]',
    'o mesmo pokémon repetido na entrada ocupa uma casa só');
  ok(ids(escolherPioresDaOferenda(lista, {})) === '[]', 'sem função de nota, não escolhe nada');
  ok(ids(escolherPioresDaOferenda(null, { nota })) === '[]', 'sem lista, nada');
  ok(ids(escolherPioresDaOferenda([pk(20, null), pk(21, NaN), pk(22, 7)], { nota })) === '[22]',
    'sem nota (ficha sem IV) não entra');
  ok(ids(escolherPioresDaOferenda([pk(30, 1, { shiny: true }), pk(31, 2, { potencia: 5 }), pk(32, 3)], { nota })) === '[32]',
    'a régua vale dentro da escolha');

  // O teto: só entra nota ABAIXO dele (o Auto Lock tranca `≥`).
  ok(ids(escolherPioresDaOferenda(lista, { nota, notaMax: 3 })) === '[4,2,8,5]',
    'com teto 3, só os de nota abaixo de 3 — e a vaga que sobra fica vazia');
  ok(ids(escolherPioresDaOferenda(lista, { nota, notaMax: 2 })) === '[4,2,8]', 'nota igual ao teto não entra');
  ok(ids(escolherPioresDaOferenda(lista, { nota, notaMax: 0.5 })) === '[]', 'teto abaixo de todos: nada');
  ok(ids(escolherPioresDaOferenda(lista, { nota, notaMax: 10 })) === '[4,2,8,5,3]', 'teto 10 não atrapalha');
  for (const torto of [null, 'x', '3', NaN, -Infinity, {}]) {
    ok(ids(escolherPioresDaOferenda(lista, { nota, notaMax: torto })) === '[]',
      `teto torto (${String(torto)}) não abre a porta: nada entra`);
  }
  ok(ids(escolherPioresDaOferenda(lista, { nota, notaMax: undefined })) === '[4,2,8,5,3]', 'teto ausente é sem teto');

  // Empate: primeiro o de nível menor, depois o id maior (a captura mais recente).
  const empate = [
    pk(40, 2, { level: 30 }), pk(41, 2, { level: 10 }), pk(42, 2, { level: 10 }), pk(43, 2, { level: 50 }),
  ];
  ok(ids(escolherPioresDaOferenda(empate, { nota })) === '[42,41,40,43]', 'empate: nível menor, depois o mais recente',
    ids(escolherPioresDaOferenda(empate, { nota })));
  ok(ids(escolherPioresDaOferenda([...empate].reverse(), { nota })) === '[42,41,40,43]',
    'e a ordem de entrada não muda o resultado');
  ok(!('ordem' in lista[0]) && lista.length === 8, 'a lista de entrada não é mexida');
}

// ------------------------------------------------------------------------------------------------
secao('Propriedade: 400 depots sorteados');
{
  let semente = 20260916;
  const rnd = () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648;
  };
  const TIPOS = ['FIRE', 'WATER', 'GRASS', 'GHOST', 'POISON', 'DRAGON', 'NORMAL', '???'];
  let quebras = 0;
  let exemplo = '';
  for (let r = 0; r < 400; r++) {
    const n = Math.floor(rnd() * 30);
    const notas = new Map();
    const depot = [];
    for (let i = 0; i < n; i++) {
      const id = 1000 + i;
      notas.set(id, rnd() < 0.05 ? null : Math.round(rnd() * 1000) / 100);
      depot.push({
        id,
        tipos: [TIPOS[Math.floor(rnd() * TIPOS.length)], ...(rnd() < 0.4 ? [TIPOS[Math.floor(rnd() * 7)]] : [])],
        level: 1 + Math.floor(rnd() * 100),
        potencia: 1 + Math.floor(rnd() * 5),
        shiny: rnd() < 0.08,
        heldItemId: rnd() < 0.05 ? XP_SHARE_HELD_ID : null,
        refinoTotal: rnd() < 0.05 ? 2 : 0,
        tmElemental: rnd() < 0.05 ? 'FIRE' : null,
      });
    }
    const protegidos = depot.filter(() => rnd() < 0.15).map((k) => k.id);
    const jaEscolhidos = depot.filter(() => rnd() < 0.1).slice(0, 2).map((k) => k.id);
    const vagas = Math.floor(rnd() * 7) - 1;
    const notaMax = rnd() < 0.3 ? Infinity : Math.round(rnd() * 1000) / 100;
    const nota = (k) => notas.get(k.id);
    const saida = escolherPioresDaOferenda(depot, { nota, notaMax, vagas, protegidos, jaEscolhidos });

    const fora = new Set([...protegidos, ...jaEscolhidos]);
    const elegiveis = depot.filter((k) => !fora.has(k.id) && !motivoForaDoAuto(k)
      && Number.isFinite(nota(k)) && nota(k) < notaMax);
    const esperado = Math.max(0, Math.min(vagas, OFERENDA_CASAS, elegiveis.length));
    const problemas = [];
    if (saida.length !== esperado) problemas.push(`tamanho ${saida.length} ≠ ${esperado}`);
    if (new Set(saida.map((k) => k.id)).size !== saida.length) problemas.push('repetido');
    if (saida.some((k) => fora.has(k.id) || motivoForaDoAuto(k))) problemas.push('pegou protegido');
    if (saida.some((k) => nota(k) >= notaMax)) problemas.push('passou do teto');
    for (let i = 1; i < saida.length; i++) if (nota(saida[i]) < nota(saida[i - 1])) problemas.push('fora de ordem');
    const pior = saida.length ? Math.max(...saida.map(nota)) : -Infinity;
    const escolhidos = new Set(saida.map((k) => k.id));
    if (saida.length === Math.min(vagas, OFERENDA_CASAS)
      && elegiveis.some((k) => !escolhidos.has(k.id) && nota(k) < pior)) problemas.push('deixou um de nota menor');
    if (saida.length < Math.min(vagas, OFERENDA_CASAS) && saida.length !== elegiveis.length) problemas.push('sobrou vaga e elegível');
    // O que o botão monta a roleta aceita: nenhum sem pedra, e nunca mais que as casas.
    if (saida.length && !montarRoleta(saida)) problemas.push('roleta inválida');
    if (problemas.length) {
      quebras++;
      exemplo ||= `rodada ${r}: ${problemas.join(', ')}`;
    }
  }
  ok(quebras === 0, 'tamanho, ordem, régua e "nenhum de nota menor ficou para trás" em todas', exemplo);
}

// ------------------------------------------------------------------------------------------------
secao('O protocolo e o limite');
{
  const lim = criarLimites();
  ok(CLIENTE.OFERENDA_PROTEGIDOS === 'oferenda.protegidos', 'o pedido está no protocolo');
  ok(SERVIDOR.OFERENDA === 'oferenda', 'e a resposta também');
  ok(lim.categoriaDe('oferenda.protegidos') === 'mercadoLeitura', 'o pedido cai no balde de leitura');
  ok(lim.categoriaDe('oferenda.girar') === 'oferenda', 'e o giro segue no balde dele');
}

if (SO_PURO) {
  console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
  process.exit(falhas ? 1 : 0);
}

// ================================================================================================
// Daqui para baixo: servidor e banco.
const { pool } = await import('../src/server/db.mjs');
const { especies, xpTotalParaNivel } = await import('../src/server/content.mjs');
const cdb = await import('../src/server/campeonato-db.mjs');
const pvpdb = await import('../src/server/pvp-ranqueado-db.mjs');
const { equipeDoCampeonatoValendo } = await import('../src/server/game/campeonato.mjs');
const { validarOferenda } = await import('../src/server/game/oferenda.mjs');
const { sessaoDe, fecharBanco } = await import('./sessao-local.mjs');
const { helloCom } = await import('./auth-teste.mjs');

const URL_WS = process.env.WS_URL ?? 'ws://localhost:8080';
const BASE = process.env.JOGO_URL || 'http://localhost:8080';
const MARCA = Date.now().toString(36).slice(-5);
const criadas = [];

const esp = (nome) => [...especies.values()].find((e) => e.name === nome);
const ivsDe = (v) => ({ hp: v, atk: v, def: v, spAtk: v, spDef: v, speed: v });

async function criarConta(sufixo, nivel = 320) {
  const nick = `oau${MARCA}${sufixo}`;
  criadas.push(nick);
  await pool.query(`INSERT INTO accounts (nick, email, provedor, email_ok) VALUES ($1, $2, 'local', true)`, [nick, `${nick}@test.local`]);
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, xp, visual_ok, tutorial_visto, discord_pop_campanha, aviso_visto)
     VALUES ($1, $2, $3, true, true, 99, 99) RETURNING id`,
    [nick, nivel, xpTotalParaNivel(nivel)],
  );
  const id = Number(rows[0].id);
  const ativo = await porPokemon(id, 'Pikachu', { slot: 1, iv: 24, quality: 1.2 });
  await pool.query(`UPDATE players SET active_poke = $2 WHERE id = $1`, [id, ativo]);
  return { nick, id, ativo };
}

async function porPokemon(playerId, nome, {
  slot = null, iv = 1, quality = 1, potencia = 1, shiny = false, level = 20, tm = null, refino = {}, held = null,
} = {}) {
  const e = esp(nome);
  const { rows } = await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, quality, ivs, hp, shiny, potencia, slot,
                                 tm_elemental, bonus_base, held_item_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, 500, $6, $7, $8, $9, $10::jsonb, $11) RETURNING id`,
    [playerId, e.pokeId, level, quality, JSON.stringify(ivsDe(iv)), shiny, potencia, slot, tm, JSON.stringify(refino), held],
  );
  return Number(rows[0].id);
}

async function limpar() {
  for (const nick of criadas) {
    const { rows } = await pool.query(`SELECT id FROM players WHERE lower(nick) = lower($1)`, [nick]);
    const id = rows[0]?.id;
    if (id) {
      await pool.query(`DELETE FROM campeonato_inscricoes WHERE player_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM pvp_time WHERE player_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM player_pokemon WHERE player_id = $1`, [id]).catch(() => {});
    }
    await pool.query(`DELETE FROM accounts WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
    await pool.query(`DELETE FROM players WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
  }
}

/** Um socket logado que junta as mensagens que chegam. */
async function conectar(nick) {
  const c = { ws: new WebSocket(URL_WS), msgs: [] };
  await new Promise((resolve, reject) => {
    c.ws.on('open', async () => c.ws.send(JSON.stringify(helloCom(await sessaoDe(nick)))));
    c.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome') resolve();
      c.msgs.push(m);
    });
    c.ws.on('error', reject);
  });
  c.enviar = (o) => c.ws.send(JSON.stringify(o));
  c.esperar = async (cond, ms = 6000) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      const achado = c.msgs.find(cond);
      if (achado) return achado;
      await dormir(100);
    }
    return null;
  };
  return c;
}

let chrome = null;
try {
  await cdb.migrar();

  // ----------------------------------------------------------------------------------------------
  secao('O socket: oferenda.protegidos e o perfil');
  {
    const a = await criarConta('a');
    const b = await criarConta('b');
    const pvp = await porPokemon(a.id, 'Dragonite', { iv: 1, quality: 0.8 });
    const camp = await porPokemon(a.id, 'Tyranitar', { iv: 1, quality: 0.8 });
    const solto = await porPokemon(a.id, 'Rattata');
    await pvpdb.salvarTime(a.id, [pvp]);
    await cdb.inscrever(CAMPEONATO.id, a.id);
    ok(await cdb.escolherEquipe(CAMPEONATO.id, a.id, [camp]) === 'ok', 'a conta escolhe a equipe do campeonato');

    const antes = CAMPEONATO.fimEm - 60_000;
    ok(JSON.stringify(await equipeDoCampeonatoValendo(a.id, antes)) === JSON.stringify([camp]),
      'antes do fim do campeonato, a escolhida vale');
    ok(JSON.stringify(await equipeDoCampeonatoValendo(a.id, CAMPEONATO.fimEm)) === '[]', 'depois do fim, não vale mais');
    ok(JSON.stringify(await equipeDoCampeonatoValendo(b.id, antes)) === '[]', 'quem não escolheu não tem nada');

    const ca = await conectar(a.nick);
    ca.enviar({ t: 'oferenda.protegidos' });
    const ra = await ca.esperar((m) => m.t === 'oferenda');
    const protA = [...(ra?.protegidos ?? [])].sort((x, y) => x - y);
    ok(JSON.stringify(protA) === JSON.stringify([pvp, camp].sort((x, y) => x - y)),
      'a resposta traz a equipe do PvP e a do campeonato', JSON.stringify(ra));
    ok(!protA.includes(solto) && !protA.includes(a.ativo), 'e nada além delas');
    ca.enviar({ t: 'oferenda.protegidos', playerId: b.id, dbId: b.id, nick: b.nick });
    await dormir(600);
    const todas = ca.msgs.filter((m) => m.t === 'oferenda');
    ok(todas.length === 2 && JSON.stringify([...todas[1].protegidos].sort((x, y) => x - y)) === JSON.stringify(protA),
      'campos forjados no pacote não trocam de conta', JSON.stringify(todas.at(-1)));

    const cb = await conectar(b.nick);
    cb.enviar({ t: 'oferenda.protegidos' });
    const rb = await cb.esperar((m) => m.t === 'oferenda');
    ok(Array.isArray(rb?.protegidos) && rb.protegidos.length === 0, 'sem equipe nenhuma, a lista vem vazia', JSON.stringify(rb));

    cb.enviar({ t: 'ranking.perfil', nick: a.nick });
    const pf = await cb.esperar((m) => m.t === 'perfil');
    const time = pf?.perfil?.pvpTime ?? [];
    ok(time.length === 1 && time[0].id === pvp, 'o perfil de um inscrito mostra a equipe do PvP Ranqueado',
      JSON.stringify(time.map((k) => k.id)));
    ok(!time.some((k) => k.id === camp), 'e a equipe do campeonato não aparece nele');
    ok(pf && !('pvpTimeOculto' in pf.perfil) && !('campeonato' in pf.perfil), 'nem marca de equipe escondida',
      Object.keys(pf?.perfil ?? {}).join(','));
    ok(!JSON.stringify(pf ?? {}).includes(`"id":${camp}`), 'o id da equipe do campeonato não viaja no pacote');

    ca.enviar({ t: 'ranking.perfil', nick: a.nick });
    const proprio = await ca.esperar((m) => m.t === 'perfil');
    ok((proprio?.perfil?.pvpTime ?? []).map((k) => k.id).join() === String(pvp), 'o próprio dono vê a mesma equipe');
    ca.ws.close();
    cb.ws.close();
    await dormir(300);
  }

  // ----------------------------------------------------------------------------------------------
  // A conta do navegador. Os PROTEGIDOS têm a pior nota de todas (IV mínimo, qualidade 0,80):
  // se a régua falhar, são eles que o botão escolhe primeiro.
  const c = await criarConta('c', 150);
  const P = {
    trancado: await porPokemon(c.id, 'Rattata', { quality: 0.8 }),
    vitrine: await porPokemon(c.id, 'Rattata', { quality: 0.8 }),
    pvp: await porPokemon(c.id, 'Rattata', { quality: 0.8 }),
    camp: await porPokemon(c.id, 'Rattata', { quality: 0.8 }),
    tm: await porPokemon(c.id, 'Rattata', { quality: 0.8, tm: 'FIRE' }),
    refino: await porPokemon(c.id, 'Rattata', { quality: 0.8, refino: { atk: 2 } }),
    share: await porPokemon(c.id, 'Rattata', { quality: 0.8, held: XP_SHARE_HELD_ID }),
    p5: await porPokemon(c.id, 'Rattata', { quality: 0.8, potencia: 5 }),
    shiny: await porPokemon(c.id, 'Rattata', { quality: 0.8, shiny: true }),
  };
  // Os RUINS que podem entrar, em ordem de nota (medida: 0,18 · 0,59 · 0,79 · 0,89 · 1,40), e
  // o MÉDIO (1,89), que ainda está abaixo do teto de 3,5 e só entra quando os ruins acabam.
  const ruins = [
    ['Charmander', 10, 1.0], ['Squirtle', 14, 1.0], ['Bulbasaur', 16, 1.0], ['Charmander', 18, 1.0],
    ['Gengar', 12, 1.0], ['Charmander', 24, 1.2],
  ];
  const R = [];
  for (const [nome, iv, q] of ruins) R.push(await porPokemon(c.id, nome, { iv, quality: q }));
  // Os BONS (4,11 e 3,65): acima do teto do Auto Lock, o botão nunca pega, nem com vaga sobrando.
  const bons = [
    await porPokemon(c.id, 'Gengar', { iv: 32, quality: 1.8 }),
    await porPokemon(c.id, 'Charmander', { iv: 32, quality: 1.8 }),
  ];
  await pool.query(
    `UPDATE players SET vitrine = $2::jsonb, xp_share_total = 1,
            automation = jsonb_build_object('pokemonTravado', $3::jsonb) WHERE id = $1`,
    [c.id, JSON.stringify([P.vitrine]), JSON.stringify([P.trancado])],
  );
  await pvpdb.salvarTime(c.id, [P.pvp]);
  await cdb.inscrever(CAMPEONATO.id, c.id);
  await cdb.escolherEquipe(CAMPEONATO.id, c.id, [P.camp]);

  // O esperado, pela MESMA regra e pela MESMA nota — e conferido contra a intuição do cenário.
  const { rows: linhas } = await pool.query(
    `SELECT id, species_id, level, quality, ivs, shiny, potencia, tm_elemental, bonus_base, held_item_id, slot
       FROM player_pokemon WHERE player_id = $1 ORDER BY id`, [c.id],
  );
  const pkDaLinha = (l) => {
    const e = especies.get(Number(l.species_id));
    const refino = typeof l.bonus_base === 'string' ? JSON.parse(l.bonus_base) : (l.bonus_base ?? {});
    return {
      id: Number(l.id), speciesId: Number(l.species_id), level: l.level, quality: Number(l.quality), potencia: l.potencia,
      shiny: l.shiny, ivs: typeof l.ivs === 'string' ? JSON.parse(l.ivs) : l.ivs, slot: l.slot,
      tipos: [e.type1, e.type2].filter(Boolean), tmElemental: l.tm_elemental, refino,
      refinoTotal: Object.values(refino).reduce((s, v) => s + Number(v || 0), 0),
      heldItemId: l.held_item_id,
    };
  };
  const notaSrv = (k) => notaDePokemon(k, especies.get(k.speciesId));
  const colecao = linhas.map(pkDaLinha);
  const doDepot = colecao.filter((k) => k.slot == null && k.heldItemId !== XP_SHARE_HELD_ID);
  const protegidosC = [P.trancado, P.vitrine, P.pvp, P.camp];
  const regra = (lista, extra = {}) => escolherPioresDaOferenda(lista, {
    nota: notaSrv, notaMax: AUTO_LOCK_NOTA_MIN, protegidos: protegidosC, ...extra,
  }).map((k) => k.id);
  const esperado = regra(doDepot);

  secao('O cenário do navegador');
  {
    const notaDe = (id) => notaSrv(colecao.find((k) => k.id === id));
    const nP = Math.max(...Object.values(P).filter((id) => id !== P.shiny && id !== P.p5).map(notaDe));
    const nR = R.map(notaDe);
    ok(nR.every((n) => n > nP), 'os protegidos comuns têm nota menor que todos os ruins', `${nP} < ${nR.join(', ')}`);
    ok(nR.every((n, i) => i === 0 || n > nR[i - 1]), 'os ruins estão em ordem crescente de nota', nR.join(', '));
    ok(nR.every((n) => n < AUTO_LOCK_NOTA_MIN) && bons.every((id) => notaDe(id) >= AUTO_LOCK_NOTA_MIN),
      'ruins abaixo do teto, bons acima', `${nR.at(-1)} < ${AUTO_LOCK_NOTA_MIN} ≤ ${bons.map(notaDe).join(', ')}`);
    ok(JSON.stringify(esperado) === JSON.stringify(R.slice(0, 5)), 'a regra escolhe os cinco ruins, em ordem de nota',
      `${JSON.stringify(esperado)} × ${JSON.stringify(R.slice(0, 5))}`);
    const p = {
      pokemons: new Map(colecao.map((k) => [k.id, k])),
      activeId: c.ativo,
    };
    const v = validarOferenda(p, esperado, { emPosto: () => false });
    ok(!v.erro && v.roleta?.oferecidos === 5, 'e o servidor aceita essa roleta', v.erro ?? '');
    ok(!bons.some((id) => esperado.includes(id)), 'nenhum dos bons entra');
    const semRuins = { jaEscolhidos: R };
    ok(regra(doDepot, semRuins).length === 0, 'acabados os ruins, o teto segura os bons');
    ok(regra(doDepot, { ...semRuins, notaMax: Infinity }).length === 2, '(sem o teto, eles entrariam)');
  }

  // ----------------------------------------------------------------------------------------------
  const CHROMES = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ];
  const exe = CHROMES.find((x) => existsSync(x));
  if (!exe) throw new Error('Chrome/Edge não encontrado');
  const perfilDir = await mkdtemp(join(tmpdir(), 'ofrauto-'));
  const porta = 9200 + Math.floor(Math.random() * 250);
  chrome = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${porta}`, `--user-data-dir=${perfilDir}`, '--window-size=1500,950', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  let pagina;
  for (let i = 0; i < 60 && !pagina; i++) {
    try {
      const abas = await fetch(`http://127.0.0.1:${porta}/json/list`).then((r) => r.json());
      pagina = abas.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
    } catch {}
    if (!pagina) await dormir(250);
  }
  if (!pagina) throw new Error('Chrome não abriu a porta de debug');
  const cdp = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((res, rej) => { cdp.once('open', res); cdp.once('error', rej); });
  let seq = 0;
  const pend = new Map();
  const erros = [];
  cdp.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      erros.push((d.exception?.description ?? d.text ?? 'erro').split('\n').slice(0, 2).join(' <- ').slice(0, 300));
    }
  });
  const cmd = (method, params = {}) =>
    new Promise((res) => { const meu = ++seq; pend.set(meu, res); cdp.send(JSON.stringify({ id: meu, method, params })); });
  const js = async (expr) => {
    const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r?.result?.value;
  };
  const clicar = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const esperarQue = async (expr, ms = 10000) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      if (await js(expr)) return true;
      await dormir(200);
    }
    return false;
  };
  const nasCasas = () => js(`[...document.querySelectorAll('.ofr-casa-cheia')].map((c) => Number(c.dataset.id))`);
  const toastAgora = () => js(`(() => { const t = document.getElementById('toast'); return t && !t.classList.contains('hidden') ? t.textContent : ''; })()`);
  const fotografar = async (arquivo) => {
    if (!arquivo) return;
    const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
    await writeFile(arquivo, Buffer.from(data, 'base64'));
    console.log(`    print: ${arquivo}`);
  };
  const esvaziar = async () => {
    await clicar('#ofr-limpar');
    await esperarQue(`document.querySelectorAll('.ofr-casa-cheia').length === 0`, 3000);
  };

  // A ponte: guarda o socket do jogo e deixa o teste descartar um tipo de pacote.
  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__descartar = null;
      window.__enviados = [];
      const Orig = window.WebSocket;
      window.WebSocket = function (...args) {
        const s = new Orig(...args);
        window.__wsJogo = s;
        const enviar = s.send.bind(s);
        s.send = (dado) => {
          try {
            const m = JSON.parse(dado);
            window.__enviados.push(m.t);
            if (window.__descartar && m.t === window.__descartar) return;
          } catch (_) {}
          return enviar(dado);
        };
        return s;
      };
      window.WebSocket.prototype = Orig.prototype;
      Object.assign(window.WebSocket, Orig);
    })();`,
  });
  const sessao = await sessaoDe(c.nick);
  await cmd('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))}); } catch (_) {}`,
  });
  await cmd('Page.navigate', { url: `${BASE}/app` });

  secao('No navegador: o botão da roleta');
  {
    ok(await esperarQue(`(() => { const n = document.querySelector('#tr-nick')?.textContent?.trim() ?? ''; return n !== '' && n !== '—'; })()`, 40000),
      'o jogo conectou');
    await js(`document.getElementById('discord-popup-fechar')?.click()`);
    await dormir(300);
    await clicar('#btn-bolsa');
    await dormir(600);
    await clicar('.bolsa-aba[data-aba="oferenda"]');
    ok(await esperarQue(`!!document.querySelector('#ofr-auto')`, 8000), 'o botão Auto Selecionar está na roleta');
    const rotulo = await js(`document.getElementById('ofr-auto').textContent.trim()`);
    ok(/auto/i.test(rotulo), 'com o rótulo certo', rotulo);
    ok(await js(`document.getElementById('ofr-auto').disabled === false`), 'e começa aceso');

    await clicar('#ofr-auto');
    ok(await esperarQue(`document.querySelectorAll('.ofr-casa-cheia').length === 5`), 'um clique enche as cinco casas');
    const escolhidos = await nasCasas();
    ok(JSON.stringify(escolhidos) === JSON.stringify(esperado), 'com os cinco de menor nota, na ordem da regra',
      `${JSON.stringify(escolhidos)} × ${JSON.stringify(esperado)}`);
    ok(!escolhidos.some((id) => Object.values(P).includes(id)),
      'nenhum protegido entrou (cadeado, vitrine, PvP, campeonato, TM, refino, Exp. Share, P5, shiny)');
    ok(await js(`window.__enviados.includes('oferenda.protegidos')`), 'a tela perguntou ao servidor antes de escolher');
    ok(/5/.test(await toastAgora()), 'o aviso diz quantos entraram', await toastAgora());
    ok(await js(`document.getElementById('ofr-auto').disabled === true`), 'com a roleta cheia, o botão apaga');
    const chance = await js(`document.getElementById('ofr-chance').textContent`);
    ok(/100%/.test(chance), 'e a roda mostra 100%', chance);
    await fotografar(process.env.PRINT);

    // Com duas casas vazias, o botão só completa.
    await js(`(() => { const b = document.querySelectorAll('.ofr-casa-tirar'); b[4].click(); })()`);
    await dormir(150);
    await js(`(() => { const b = document.querySelectorAll('.ofr-casa-tirar'); b[0].click(); })()`);
    await dormir(200);
    const sobrou = await nasCasas();
    await clicar('#ofr-auto');
    await esperarQue(`document.querySelectorAll('.ofr-casa-cheia').length === 5`);
    const completo = await nasCasas();
    ok(JSON.stringify(completo.slice(0, 3)) === JSON.stringify(sobrou), 'quem já estava nas casas fica onde estava',
      `${JSON.stringify(sobrou)} → ${JSON.stringify(completo)}`);
    ok(JSON.stringify(completo.slice(3)) === JSON.stringify([esperado[0], esperado[4]]),
      'e as vagas voltam com os dois que saíram', JSON.stringify(completo));
    await esvaziar();
  }

  secao('No navegador: o botão da folha respeita a busca');
  {
    await clicar('.ofr-casa-vazia');
    ok(await esperarQue(`!!document.querySelector('.ofrpk #ofrpk-auto')`, 8000), 'a folha de escolha tem o próprio botão');
    const nota = await js(`document.querySelector('.ofrpk-auto-nota')?.textContent ?? ''`);
    ok(nota.length > 10, 'com a frase que diz de onde ele escolhe', nota);
    await js(`(() => { const i = document.getElementById('ofrpk-busca'); i.value = 'charmander'; i.dispatchEvent(new Event('input')); })()`);
    await dormir(300);
    await clicar('#ofrpk-auto');
    ok(await esperarQue(`document.querySelectorAll('.ofr-casa-cheia').length === 3`), 'com "charmander" na busca, entram só três');
    const escolhidos = await nasCasas();
    const soCharmander = regra(doDepot.filter((k) => especies.get(k.speciesId).name === 'Charmander'));
    ok(JSON.stringify(soCharmander) === JSON.stringify([R[0], R[3], R[5]]), '(a regra diz: os três Charmander abaixo do teto)',
      JSON.stringify(soCharmander));
    ok(JSON.stringify(escolhidos) === JSON.stringify(soCharmander), 'e são eles, em ordem de nota',
      `${JSON.stringify(escolhidos)} × ${JSON.stringify(soCharmander)}`);
    ok(!escolhidos.includes(bons[1]), 'o Charmander bom fica de fora mesmo com duas vagas sobrando');
    const aviso = await toastAgora();
    ok(/3/.test(aviso) && /3,5/.test(aviso), 'o aviso diz que só três entraram, e cita o teto', aviso);
    ok(await js(`document.querySelectorAll('.ofrpk .ofrpk-ordem').length === 3`), 'e os cards da folha ganham o número da casa');
    await fotografar(process.env.FOLHA);

    // Só protegidos na lista: nada entra.
    await clicar('#ofr-limpar');
    await dormir(300);
    await js(`(() => { const i = document.getElementById('ofrpk-busca'); i.value = 'rattata'; i.dispatchEvent(new Event('input')); })()`);
    await dormir(300);
    const naLista = await js(`document.querySelectorAll('.ofrpk .mk-card').length`);
    ok(naLista === 8, 'a busca "rattata" lista os oito que a mão pode escolher', `veio ${naLista}`);
    await clicar('#ofrpk-auto');
    await dormir(1500);
    ok((await nasCasas()).length === 0, 'mas o botão não escolhe nenhum deles');
    ok(/Auto/i.test(await toastAgora()), 'e avisa que não havia o que escolher', await toastAgora());

    // Busca sem resultado: o botão da folha apaga.
    await js(`(() => { const i = document.getElementById('ofrpk-busca'); i.value = 'zzzz'; i.dispatchEvent(new Event('input')); })()`);
    await dormir(300);
    ok(await js(`document.getElementById('ofrpk-auto').disabled === true`), 'com a lista vazia, o botão da folha apaga');
    await js(`(() => { const i = document.getElementById('ofrpk-busca'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
    await js(`document.querySelector('.cm-folha .cm-fechar')?.click()`);
    await dormir(300);
  }

  secao('No navegador: sem resposta do servidor, nada é escolhido');
  {
    await js(`window.__descartar = 'oferenda.protegidos'`);
    await clicar('#ofr-auto');
    await dormir(400);
    const conferindo = await js(`document.getElementById('ofr-auto')`
      + `.disabled && document.getElementById('ofr-auto').textContent`);
    ok(typeof conferindo === 'string' && conferindo.length > 0 && !/^auto/i.test(conferindo),
      'o botão fica em "Conferindo…" e apagado', String(conferindo));
    ok(await esperarQue(`document.getElementById('ofr-auto').disabled === false`, 12000), 'e volta sozinho no prazo');
    ok((await nasCasas()).length === 0, 'sem ter escolhido ninguém');
    ok((await toastAgora()).length > 0, 'e avisa que não deu para conferir', await toastAgora());
    await js(`window.__descartar = null`);
  }

  secao('No navegador: o que o botão escolhe, o servidor gira');
  {
    const { rows: antes } = await pool.query(`SELECT count(*)::int AS n FROM player_pokemon WHERE player_id = $1`, [c.id]);
    await clicar('#ofr-auto');
    await esperarQue(`document.querySelectorAll('.ofr-casa-cheia').length === 5`);
    const giro = await nasCasas();
    await clicar('#ofr-girar');
    await dormir(400);
    await clicar('#confirmar-sim');
    ok(await esperarQue(`!!document.querySelector('#recompensa:not(.hidden)')`, 12000), 'o giro acontece');
    await clicar('#rc-ok');
    await dormir(800);
    const { rows: depois } = await pool.query(`SELECT count(*)::int AS n FROM player_pokemon WHERE player_id = $1`, [c.id]);
    ok(depois[0].n === antes[0].n - 5, 'os cinco somem da coleção', `${antes[0].n} → ${depois[0].n}`);
    const { rows: vivos } = await pool.query(`SELECT id FROM player_pokemon WHERE id = ANY($1::bigint[])`, [[...Object.values(P), ...bons]]);
    ok(vivos.length === Object.values(P).length + bons.length, 'e todos os protegidos e os bons seguem vivos');
    ok(JSON.stringify(giro) === JSON.stringify(esperado), 'eram os cinco da regra');

    // Sobrou o médio e os dois bons: o botão pega só o médio.
    await clicar('#ofr-auto');
    await esperarQue(`document.querySelectorAll('.ofr-casa-cheia').length > 0`);
    await dormir(300);
    ok(JSON.stringify(await nasCasas()) === JSON.stringify([R[5]]), 'depois do giro, só o médio entra; os bons, não',
      JSON.stringify(await nasCasas()));
    await esvaziar();
  }

  // ---------------------------------------------------------------- o lote
  //
  // O diálogo do "oferendar tudo" é a TRAVA da feature: um clique apaga o Depot inteiro, e o que
  // segura a mão é esta tela. Se ela vier vazia ou ilegível, o botão fica perigoso — por isso o
  // teste confere o conteúdo dela, e não só que ela abriu. O botão CANCELAR fecha sem oferendar:
  // nada aqui apaga nada.
  secao('No navegador: o diálogo do lote');
  {
    const { rows: antesLote } = await pool.query(
      `SELECT count(*)::int AS n FROM player_pokemon WHERE player_id = $1`, [c.id],
    );
    ok(await js(`!!document.querySelector('#ofr-tudo')`), 'o botão "Oferendar tudo do Depot" está na aba');
    // A caixa de confirmação é REUSADA por todo o jogo: ela fica escondida, não é removida. Por
    // isso a espera é pelo TÍTULO deste diálogo, e não pela existência do botão — senão o teste
    // lê o texto da confirmação anterior, que continua no DOM.
    await clicar('#ofr-tudo');
    ok(await esperarQue(
      `!document.querySelector('#confirmar').classList.contains('hidden')
       && /Depot/i.test(document.querySelector('#confirmar-titulo').textContent)`, 12000),
      'o diálogo do lote abre');
    const texto = await js(`document.querySelector('#confirmar-texto')?.textContent ?? ''`);
    ok(/p[oó]k[eé]mon/i.test(texto), 'ele diz quantos pokémon vão', texto.slice(0, 120));
    ok(/giro/i.test(texto), 'e em quantos giros', texto.slice(0, 120));
    ok(/fora/i.test(texto), 'e o que fica de fora', texto.slice(0, 160));
    ok(/esperada|esperado/i.test(texto), 'com as pedras esperadas', texto.slice(0, 200));
    await fotografar(process.env.LOTE);
    await clicar('#confirmar-nao');
    await dormir(600);
    const { rows: depoisLote } = await pool.query(
      `SELECT count(*)::int AS n FROM player_pokemon WHERE player_id = $1`, [c.id],
    );
    ok(depoisLote[0].n === antesLote[0].n, 'cancelar não oferenda nada',
      `${antesLote[0].n} → ${depoisLote[0].n}`);
  }

  secao('Sem erro de JS');
  {
    const ruinsJs = erros.filter((e) => !/turnstile|cloudflare|facebook|googletagmanager|gtm|ERR_BLOCKED|401|403/i.test(e));
    ok(ruinsJs.length === 0, 'nenhuma exceção no cliente', ruinsJs.slice(0, 3).join(' | '));
  }
  cdp.close();
} catch (err) {
  falhas++;
  console.log(`  ✗ o roteiro quebrou: ${err.stack ?? err.message}`);
} finally {
  chrome?.kill();
  await dormir(300);
  await limpar();
  await fecharBanco().catch(() => {});
  await pool.end().catch(() => {});
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
