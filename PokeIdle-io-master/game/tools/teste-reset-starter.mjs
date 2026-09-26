#!/usr/bin/env node
/**
 * O jogador que atravessou o reset do beta COM shiny no Depot ainda escolhe o inicial.
 *
 *   node tools/teste-reset-starter.mjs            (com o servidor no ar e o reset já rodado)
 *
 * É o único comportamento que `tools/reset-beta.mjs` muda no JOGO, e ele é contraintuitivo:
 * até aqui "tem pokémon" e "já escolheu inicial" eram a mesma pergunta, e o reset separou as
 * duas. Se a folga do `reset_starter` quebrar, quem mais jogou o beta — justamente quem
 * guardou um shiny — é quem entra no lançamento sem starter, sem kit e sem ninguém em campo.
 * Um teste que só olhasse conta nova nunca veria isso: conta nova passa dos dois jeitos.
 *
 * O que ele cobra, nesta ordem:
 *   1. o `welcome` de quem tem pokémon no Depot E `reset_starter` traz os três iniciais;
 *   2. escolher um cria o starter na equipe e mantém o shiny onde estava, no Depot;
 *   3. a bandeira cai no BANCO na hora (não no flush) — senão um crash daria um segundo
 *      starter de graça;
 *   4. um segundo `starter.pick` é recusado.
 */
import WebSocket from 'ws';
import { pool } from '../src/server/db.mjs';
import { sessaoDe } from './sessao-local.mjs';
import { helloCom } from './auth-teste.mjs';
import { criarMescladorDeEstado } from '../src/shared/estado-delta.mjs';

const URL = process.env.WS_URL ?? 'ws://localhost:8080';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

let falhas = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✔' : '✖'} ${msg}`);
  if (!cond) falhas++;
};

// O cobaia: alguém que o reset deixou com pokémon no Depot e ainda devendo o inicial. Sai de
// uma consulta e não de um nick fixo porque quem sobrou depende do backup restaurado.
const { rows: [alvo] } = await pool.query(`
  SELECT p.id, p.nick, count(pp.id)::int AS pokemons
    FROM players p
    JOIN player_pokemon pp ON pp.player_id = p.id
    JOIN accounts a ON lower(a.nick) = lower(p.nick)
   WHERE p.reset_starter
   GROUP BY p.id, p.nick
   ORDER BY count(pp.id) DESC
   LIMIT 1
`);
if (!alvo) {
  console.error('Nenhum jogador com pokémon no Depot e reset_starter — rode o tools/reset-beta.mjs antes.');
  await pool.end();
  process.exit(1);
}
console.log(`\ncobaia: ${alvo.nick} — ${alvo.pokemons} pokémon no Depot, devendo o inicial\n`);

// ------------------------------------------------------------------- socket

const c = { estado: null, welcome: null, avisos: [] };
const mesclar = criarMescladorDeEstado();
const sessao = await sessaoDe(alvo.nick);
const ws = new WebSocket(URL);

ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') c.welcome = m;
  if (m.t === 'welcome' || m.t === 'estado') c.estado = mesclar(m.estado);
  if (m.t === 'batalha') for (const e of m.ev ?? []) c.avisos.push(e.k);
});
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
ws.send(JSON.stringify(helloCom(sessao)));

const esperar = async (pred, ms = 8000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (pred()) return true; await dormir(100); }
  return false;
};
if (!(await esperar(() => c.welcome))) throw new Error('o servidor não respondeu — está no ar?');

// ----------------------------------------------------- 1. a oferta aparece

const oferta = c.welcome.starters ?? [];
ok(oferta.length === 3, `o welcome traz os três iniciais (veio ${oferta.length})`);
ok(
  (c.estado?.pokemons ?? []).length === alvo.pokemons,
  `os ${alvo.pokemons} pokémon do Depot continuam na sessão`,
);
ok(
  (c.estado?.pokemons ?? []).every((p) => p.slot == null),
  'nenhum deles entrou em campo sozinho',
);

// -------------------------------------------------------- 2. escolher um

const escolhido = oferta[0];
ws.send(JSON.stringify({ t: 'starter.pick', speciesId: escolhido.speciesId }));
const nasceu = await esperar(
  () => (c.estado?.pokemons ?? []).some((p) => p.speciesId === escolhido.speciesId && p.slot != null),
);
ok(nasceu, `${escolhido.nome} nasceu e entrou na equipe`);
ok(
  (c.estado?.pokemons ?? []).length === alvo.pokemons + 1,
  'o Depot não perdeu nada para o starter',
);

// ------------------------------------------- 3. a bandeira caiu no banco

await esperar(async () => {
  const { rows } = await pool.query(`SELECT reset_starter FROM players WHERE id = $1`, [alvo.id]);
  return rows[0]?.reset_starter === false;
}, 5000);
const { rows: [depois] } = await pool.query(
  `SELECT reset_starter FROM players WHERE id = $1`, [alvo.id],
);
ok(depois.reset_starter === false, 'reset_starter caiu no banco, sem esperar o flush');

// ------------------------------------------- 4. não dá para pegar dois

const antes = (c.estado?.pokemons ?? []).length;
ws.send(JSON.stringify({ t: 'starter.pick', speciesId: oferta[1].speciesId }));
await dormir(1500);
ok((c.estado?.pokemons ?? []).length === antes, 'o segundo starter.pick foi recusado');

ws.close();
await pool.end();
console.log(falhas ? `\n✖ ${falhas} falha(s)\n` : '\n✔ tudo certo\n');
process.exit(falhas ? 1 : 0);
