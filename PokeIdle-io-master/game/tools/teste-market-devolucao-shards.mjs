// Teste da DEVOLUÇÃO do Mercado com DOIS SIMS de verdade — o caso que só existe em produção:
// o sim que fecha o anúncio não é o sim do dono.
//
// Foi assim que o pokémon anunciado "sumia" ao vencer: o sim que varreu o fechava e só devolvia
// à memória de quem estava NELE; o dono, noutro shard, ficava sem o bicho até relogar (um F5 não
// bastava — a reconexão reaproveita a memória). O item era pior: ia para o banco por baixo de
// um jogador carregado noutro sim, e o flush dele apagava.
//
// O que se prova aqui, sempre como "exatamente uma vez" (nem some, nem duplica):
//
//   1. vencimento com o dono on-line no OUTRO shard e no MESMO shard, nos dois sentidos;
//   2. o que chegou à memória sobrevive ao flush, ao F5 e a um relog de verdade (carência vencida);
//   3. dono off-line quando venceu: recebe no login; dono em carência: recebe na volta;
//   4. devolução de BOOT (curadoria, preço inválido) com o dono jogando noutro sim;
//   5. uma entrega atrasada não ressuscita o pokémon que o dono já anunciou de novo.
//
// O teste monta o próprio cluster e o desmonta no fim:
//   · um Redis descartável (Docker) — o pub/sub do Redis ignora o índice do banco, então no
//     mesmo Redis os sims daqui e o `npm start` de quem roda disputariam o canal `sim:0`;
//   · um banco próprio no mesmo Postgres, com o schema copiado do banco de dev (`pg_dump -s`
//     dentro do container) — no banco de dev, a varredura global do servidor de lá fecharia os
//     anúncios daqui. O `sql/schema.sql` sozinho não serve: `accounts` e outras nascem nas
//     migrações do GATEWAY, que este teste não sobe;
//   · os sims 0 e 1 de SHARD_COUNT=2, com SAIDA_CRUA=0 para a saída vir em JSON.
// Este script faz o papel do gateway: publica em `sim:N` e lê `gw:<id>`.
//
// Precisa do Docker e do Postgres de `npm run infra`. Leva uns 4 minutos: a varredura do mercado
// é de minuto em minuto, e um dos casos espera a carência de reconexão (90 s) vencer.
//
//   node tools/teste-market-devolucao-shards.mjs
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import Redis from 'ioredis';
import { config } from '../src/server/config.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARDS = 2;
const GW = 'gwteste';
const PEDRA = 2; // Ancient Stone
const PROIBIDO = 1; // Air Tank — fora da curadoria do Mercado
const BOLA = 5; // Beast Ball — mora em `balls`
const CARENCIA_MS = 90_000; // `GRACA_DESCONEXAO_MS` do sim

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(cond, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cond()) return true;
    await espera(250);
  }
  return false;
}
// O mesmo FNV-1a de `shardDoJogador`, com o SHARD_COUNT daqui (o `config` deste processo é o de dev).
const shardDe = (chave) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < chave.length; i++) {
    h ^= chave.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % SHARDS;
};
const portaLivre = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

// ------------------------------------------------------------------ o cluster
const marca = Date.now().toString(36);
const nomeBanco = `pokeidle_teste_devolucao_${marca}`;
const urlBanco = new URL(config.databaseUrl);
urlBanco.pathname = `/${nomeBanco}`;
const nomeRedis = `pokeidle-teste-devolucao-${marca}`;
const portaRedis = await portaLivre();
const urlRedis = `redis://127.0.0.1:${portaRedis}`;

const admin = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
let pool = null;
let pub = null;
let sub = null;
const sims = new Map();
const logs = new Map();
let redisNoAr = false;
let bancoCriado = false;

async function desmontar() {
  for (const filho of sims.values()) filho.kill();
  sims.clear();
  pub?.disconnect();
  sub?.disconnect();
  await pool?.end().catch(() => {});
  if (redisNoAr) {
    try { execFileSync('docker', ['stop', nomeRedis], { stdio: 'ignore' }); } catch { /* já parou */ }
  }
  if (bancoCriado) {
    await espera(500);
    await admin.query(`DROP DATABASE IF EXISTS ${nomeBanco} WITH (FORCE)`)
      .catch((err) => console.error(`não deu para apagar o banco ${nomeBanco}:`, err.message));
  }
  await admin.end().catch(() => {});
}
process.on('SIGINT', () => { desmontar().finally(() => process.exit(130)); });

function subirSim(shard) {
  const filho = spawn(process.execPath, ['src/server/index.mjs'], {
    cwd: raiz,
    env: {
      ...process.env,
      ROLE: 'sim', SHARD_ID: String(shard), SHARD_COUNT: String(SHARDS), ARENA_SHARD_ID: '0',
      SAIDA_CRUA: '0', ORBS_WORKER: '0',
      DATABASE_URL: urlBanco.toString(), REDIS_URL: urlRedis,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const linhas = [];
  logs.set(shard, linhas);
  const ler = (buf) => linhas.push(...String(buf).split('\n').filter(Boolean));
  filho.stdout.on('data', ler);
  filho.stderr.on('data', ler);
  sims.set(shard, filho);
  return ate(() => linhas.some((l) => l.includes(`[sim] shard ${shard}/${SHARDS} pronto`)), 120_000);
}
const logDe = (shard, trecho) => (logs.get(shard) ?? []).filter((l) => l.includes(trecho));

// ------------------------------------------------------------ o "gateway"
const jogadores = new Map();
const lerEstado = (j, e) => {
  if (!e) return;
  if (e.pokemons) j.pokemons = e.pokemons.map((k) => k.id);
  if (e.items) j.items = e.items;
  if (e.balls) j.balls = e.balls;
  if (e.gold != null) j.gold = e.gold;
};
function ouvirGateway() {
  sub.on('message', (canal, raw) => {
    if (canal !== `gw:${GW}`) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const j = jogadores.get(m.para);
    if (!j) return;
    for (const x of m.msgs ?? [m.msg]) {
      if (x?.t === 'welcome') {
        j.welcomes++;
        lerEstado(j, x.estado);
      } else if (x?.t === 'estado') {
        lerEstado(j, x.estado);
      } else if (x?.t === 'batalha') {
        for (const e of x.ev ?? []) if (e?.k) j.eventos.push(e);
      }
    }
  });
}
const paraSim = (j, msg) => pub.publish(`sim:${j.shard}`, JSON.stringify({ playerId: j.chave, ...msg }));
async function entrar(j) {
  j.welcomes = 0;
  await pub.hset('presenca', j.chave, GW);
  await paraSim(j, { t: 'entrar', nick: j.nick, gatewayId: GW, admin: false, delta: false });
  return ate(() => j.welcomes > 0, 30_000);
}
const sair = (j) => paraSim(j, { t: 'sair' });
const vezes = (j, id) => j.pokemons.filter((x) => x === id).length;
const qtd = (obj, id) => Number(obj?.[id] ?? 0);
const eventos = (j, k) => j.eventos.filter((e) => e.k === k).length;
// Suja o jogador com uma mensagem de servidor inofensiva (o mesmo saldo) e espera o flush.
async function flush(...lista) {
  for (const j of lista) await paraSim(j, { t: 'admin.gold', gold: j.gold });
  await espera(config.flushMs + 2500);
}

// ------------------------------------------------------------------ banco
async function criarJogador(base, shard) {
  let nick;
  for (let i = 0; ; i++) {
    nick = `${base}${marca}${i}`;
    if (shardDe(nick.toLowerCase()) === shard) break;
  }
  const id = Number((await pool.query(
    `INSERT INTO players (nick, gold, tutorial_visto) VALUES ($1, 1000000, true) RETURNING id`, [nick])).rows[0].id);
  const ivs = JSON.stringify({ hp: 30, atk: 30, def: 30, spAtk: 30, spDef: 30, speed: 30 });
  const novo = async (sql) => Number((await pool.query(sql, [id, ivs])).rows[0].id);
  const ativo = await novo(`INSERT INTO player_pokemon (player_id, species_id, level, ivs, hp, slot, power)
                            VALUES ($1, 1, 10, $2::jsonb, 100, 0, 100) RETURNING id`);
  // Shiny passa pela curadoria da vitrine sem depender de nota.
  const shiny = `INSERT INTO player_pokemon (player_id, species_id, level, ivs, hp, shiny, power)
                 VALUES ($1, 6, 60, $2::jsonb, 100, true, 900) RETURNING id`;
  const venda = await novo(shiny);
  const venda2 = await novo(shiny);
  await pool.query(`UPDATE players SET active_poke = $2 WHERE id = $1`, [id, ativo]);
  const chave = nick.toLowerCase();
  const j = { nick, chave, id, shard, venda, venda2, welcomes: 0, pokemons: [], items: {}, balls: {}, gold: 0, eventos: [] };
  jogadores.set(chave, j);
  return j;
}
const INSERIR_ANUNCIO = `INSERT INTO market_anuncios
    (vendedor_id, vendedor, tipo, item_id, qtd, pokemon_id, ficha, preco, moeda, dias, expira_em)
  VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'gold', $9, now() + ($9::int * INTERVAL '1 day'))
  RETURNING id`;
async function anuncioNoBanco(j, { tipo = 'item', itemId = null, qtd: n = 1, pokemonId = null, ficha, preco = 5000, dias = 1 }) {
  const id = Number((await pool.query(INSERIR_ANUNCIO,
    [j.id, j.nick, tipo, itemId, n, pokemonId, JSON.stringify(ficha), preco, dias])).rows[0].id);
  if (pokemonId) await pool.query(`UPDATE player_pokemon SET anuncio_id = $1, slot = NULL WHERE id = $2`, [id, pokemonId]);
  return id;
}
const pedraComPrazo = (j) => anuncioNoBanco(j, { itemId: PEDRA, qtd: 3, ficha: { nome: 'Ancient Stone' } });
const bolaComPrazo = (j) => anuncioNoBanco(j, { itemId: BOLA, qtd: 2, ficha: { nome: 'Beast Ball', bola: true, ballId: BOLA } });
async function anunciarPeloSim(j, pokemonId) {
  const antes = eventos(j, 'marketCriado');
  await paraSim(j, { t: 'market.criar', doCliente: true, tipo: 'pokemon', pokemonId, preco: 5000, moeda: 'gold', dias: 1 });
  const saiu = await ate(() => eventos(j, 'marketCriado') > antes && vezes(j, pokemonId) === 0, 15_000);
  const { rows } = await pool.query(
    `SELECT id FROM market_anuncios WHERE pokemon_id = $1 AND estado = 'aberto'`, [pokemonId]);
  return saiu ? Number(rows[0]?.id) : null;
}
const bolsaNoBanco = async (j) => (await pool.query(`SELECT items, balls FROM players WHERE id = $1`, [j.id])).rows[0];
const pokemonNoBanco = async (id) => (await pool.query(
  `SELECT player_id, anuncio_id FROM player_pokemon WHERE id = $1`, [id])).rows[0];
const quantosPokemons = async (j) => (await pool.query(
  `SELECT count(*)::int AS n FROM player_pokemon WHERE player_id = $1`, [j.id])).rows[0].n;

// ================================================================== o teste
try {
  secao('Montando o cluster (Redis descartável, banco próprio, 2 sims)');
  execFileSync('docker', ['run', '-d', '--rm', '--name', nomeRedis, '-p', `127.0.0.1:${portaRedis}:6379`, 'redis:7-alpine'],
    { stdio: 'ignore' });
  redisNoAr = true;
  // O container leva um instante para aceitar conexão; o ioredis tenta de novo sozinho.
  pub = new Redis(urlRedis).on('error', () => {});
  sub = new Redis(urlRedis).on('error', () => {});
  ok(await ate(() => pub.status === 'ready' && sub.status === 'ready', 20_000), `Redis no ar (porta ${portaRedis})`);

  await admin.query(`CREATE DATABASE ${nomeBanco}`);
  bancoCriado = true;
  const usuario = decodeURIComponent(urlBanco.username);
  const bancoDev = new URL(config.databaseUrl).pathname.slice(1);
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c',
    `pg_dump -U "${usuario}" -s "${bancoDev}" | psql -q -U "${usuario}" -d "${nomeBanco}"`],
  { cwd: raiz, stdio: 'ignore' });
  pool = new pg.Pool({ connectionString: urlBanco.toString(), max: 4 });
  const { rows: tabelas } = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`);
  if (!(await pool.query(`SELECT to_regclass('public.accounts') AS t`)).rows[0].t) {
    throw new Error(`o schema não veio do banco "${bancoDev}" (o Postgres de \`npm run infra\` está no ar?)`);
  }
  ok(true, `banco ${nomeBanco} com o schema do banco de dev (${tabelas[0].n} tabelas)`);

  await sub.subscribe(`gw:${GW}`);
  ouvirGateway();
  const vivo = () => pub.hset('gwvivos', GW, Date.now()).catch(() => {});
  await vivo();
  const batimento = setInterval(vivo, 5000);
  batimento.unref();

  // Um de cada vez: as migrações do boot passam por uma trava do Postgres de qualquer jeito.
  for (const s of [0, 1]) {
    const noAr = await subirSim(s);
    ok(noAr, `sim ${s} no ar`);
    if (!noAr) throw new Error(`o sim ${s} não subiu — ver o log abaixo`);
  }

  // ---------------------------------------------------------------- preparo
  secao('Preparo: A e E (shard 0), B e F (shard 1) e D (shard 0) on-line; C (shard 1) nunca entrou');
  const A = await criarJogador('dvA', 0);
  const B = await criarJogador('dvB', 1);
  const C = await criarJogador('dvC', 1);
  const D = await criarJogador('dvD', 0);
  // E e F são o SEGUNDO lote: vence logo depois de o primeiro ser fechado, para cair no outro sim.
  const E = await criarJogador('dvE', 0);
  const F = await criarJogador('dvF', 1);
  const todos = [A, B, C, D, E, F];
  for (const j of [A, B, D, E, F]) ok(await entrar(j), `${j.nick} entrou`);
  for (const j of [A, B, D, E, F]) ok(vezes(j, j.venda) === 1, `${j.nick}: o pokémon a anunciar está na memória`);

  const anuncio = new Map();
  for (const j of [A, B, D, E, F]) {
    anuncio.set(j, await anunciarPeloSim(j, j.venda));
    ok(anuncio.get(j) != null, `${j.nick}: anunciou pelo sim e o pokémon saiu da memória`,
      j.eventos.filter((e) => e.k === 'aviso').map((e) => e.msg).join(' / '));
  }
  anuncio.set(C, await anuncioNoBanco(C, { tipo: 'pokemon', pokemonId: C.venda, ficha: { nome: 'Charizard', level: 60, shiny: true } }));
  const lote = [A, B, C, D].map((j) => anuncio.get(j));
  for (const j of [A, B, C, D]) lote.push(await pedraComPrazo(j), await bolaComPrazo(j));
  const lote2 = [E, F].map((j) => anuncio.get(j));
  for (const j of [E, F]) lote2.push(await pedraComPrazo(j), await bolaComPrazo(j));
  const antes2 = new Map([E, F].map((j) => [j, { pedra: qtd(j.items, PEDRA), bola: qtd(j.balls, BOLA) }]));

  // D fecha a aba: entra em carência, ainda na memória do sim.
  const antesD = { pedra: qtd(D.items, PEDRA), bola: qtd(D.balls, BOLA) };
  await sair(D);
  await espera(500);
  const antes = new Map([A, B].map((j) => [j, { pedra: qtd(j.items, PEDRA), bola: qtd(j.balls, BOLA), eventos: j.eventos.length }]));
  const antesC = await bolsaNoBanco(C);

  // ------------------------------------------------------------- vencimento
  secao('Vencimento: os 12 anúncios vencem no mesmo instante');
  await pool.query(`UPDATE market_anuncios SET expira_em = now() - interval '1 second' WHERE id = ANY($1::bigint[])`, [lote]);
  const t0 = Date.now();
  const fechou = await ate(async () => (await pool.query(
    `SELECT count(*)::int AS n FROM market_anuncios WHERE id = ANY($1::bigint[]) AND estado = 'aberto'`, [lote])).rows[0].n === 0, 75_000);
  // O segundo lote vence JÁ: quem acabou de varrer só volta daqui a um minuto, então quem o
  // fecha é o outro sim — e o teste cobre os dois sentidos (sim 0 → dono no 1, e sim 1 → dono no 0).
  await pool.query(`UPDATE market_anuncios SET expira_em = now() - interval '1 second' WHERE id = ANY($1::bigint[])`, [lote2]);
  ok(fechou, `a varredura fechou os 12 (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const varridos = (s) => logDe(s, 'anúncio(s) expirados').length;
  const quem = [0, 1].filter((s) => varridos(s));
  const varreu1 = [varridos(0), varridos(1)];
  ok(quem.length === 1, `um sim só fechou o lote (sim ${quem.join(' e ')}) — o dono ${quem[0] === 0 ? 'B' : 'A'} está no OUTRO shard`);

  const chegou = await ate(() => [A, B].every((j) =>
    vezes(j, j.venda) === 1 && qtd(j.items, PEDRA) === antes.get(j).pedra + 3 && qtd(j.balls, BOLA) === antes.get(j).bola + 2), 20_000);
  ok(chegou, 'a devolução chegou à memória de A e de B em segundos, sem esperar a próxima varredura');
  for (const j of [A, B]) {
    ok(vezes(j, j.venda) === 1, `${j.nick}: o pokémon voltou UMA vez`, `aparece ${vezes(j, j.venda)}×`);
    ok(qtd(j.items, PEDRA) === antes.get(j).pedra + 3, `${j.nick}: +3 pedras, nem mais nem menos`, `${antes.get(j).pedra} → ${qtd(j.items, PEDRA)}`);
    ok(qtd(j.balls, BOLA) === antes.get(j).bola + 2, `${j.nick}: +2 Beast Balls, nas bolas`, `${antes.get(j).bola} → ${qtd(j.balls, BOLA)}`);
    ok(eventos(j, 'marketExpirou') === 3, `${j.nick}: um aviso por anúncio vencido`, `${eventos(j, 'marketExpirou')} avisos`);
  }

  secao('D estava em carência (aba fechada há segundos) e volta');
  await espera(1500);
  ok(await entrar(D), `${D.nick} reconectou`);
  ok(vezes(D, D.venda) === 1, 'D: o pokémon está lá, uma vez', `aparece ${vezes(D, D.venda)}×`);
  ok(qtd(D.items, PEDRA) === antesD.pedra + 3 && qtd(D.balls, BOLA) === antesD.bola + 2, 'D: +3 pedras e +2 bolas, uma vez',
    `pedra ${antesD.pedra} → ${qtd(D.items, PEDRA)} · bola ${antesD.bola} → ${qtd(D.balls, BOLA)}`);

  secao('O que chegou à memória vai para o banco no flush');
  await flush(A, B, D);
  for (const j of [A, B, D]) {
    const banco = await bolsaNoBanco(j);
    ok(qtd(banco.items, PEDRA) === qtd(j.items, PEDRA) && qtd(banco.balls, BOLA) === qtd(j.balls, BOLA),
      `${j.nick}: bolsa do banco = bolsa da memória (pedra ${qtd(banco.items, PEDRA)}, bola ${qtd(banco.balls, BOLA)})`);
    const pk = await pokemonNoBanco(j.venda);
    ok(Number(pk.player_id) === j.id && pk.anuncio_id === null, `${j.nick}: o pokémon é dele e está fora do escrow`);
    ok(await quantosPokemons(j) === 3, `${j.nick}: 3 pokémon no banco — nenhum perdido, nenhum copiado`);
  }

  secao('F5 (reconexão dentro da carência) não entrega de novo');
  const depois = new Map([A, B].map((j) => [j, { pedra: qtd(j.items, PEDRA), bola: qtd(j.balls, BOLA), avisos: eventos(j, 'marketExpirou') }]));
  for (const j of [A, B]) await sair(j);
  await espera(1500);
  for (const j of [A, B]) ok(await entrar(j), `${j.nick} reconectou`);
  await espera(3000);
  for (const j of [A, B]) {
    const d = depois.get(j);
    ok(vezes(j, j.venda) === 1 && qtd(j.items, PEDRA) === d.pedra && qtd(j.balls, BOLA) === d.bola,
      `${j.nick}: tudo igual — pokémon 1×, pedra ${qtd(j.items, PEDRA)}, bola ${qtd(j.balls, BOLA)}`);
    ok(eventos(j, 'marketExpirou') === d.avisos, `${j.nick}: nenhum aviso repetido`);
  }

  secao('C estava off-line quando venceu e entra agora');
  ok(await entrar(C), `${C.nick} entrou`);
  await ate(() => qtd(C.items, PEDRA) === qtd(antesC.items, PEDRA) + 3, 10_000);
  ok(vezes(C, C.venda) === 1, 'C: o pokémon está lá, uma vez', `aparece ${vezes(C, C.venda)}×`);
  ok(qtd(C.items, PEDRA) === qtd(antesC.items, PEDRA) + 3 && qtd(C.balls, BOLA) === qtd(antesC.balls, BOLA) + 2,
    'C: +3 pedras e +2 bolas, entregues no login',
    `pedra ${qtd(antesC.items, PEDRA)} → ${qtd(C.items, PEDRA)} · bola ${qtd(antesC.balls, BOLA)} → ${qtd(C.balls, BOLA)}`);
  ok(eventos(C, 'marketExpirou') === 3, 'C: e vê os 3 avisos', `${eventos(C, 'marketExpirou')} avisos`);
  const cAntesF5 = { pedra: qtd(C.items, PEDRA), bola: qtd(C.balls, BOLA) };
  await sair(C);
  await espera(1000);
  ok(await entrar(C), `${C.nick} reconectou`);
  await espera(2000);
  ok(vezes(C, C.venda) === 1 && qtd(C.items, PEDRA) === cAntesF5.pedra && qtd(C.balls, BOLA) === cAntesF5.bola,
    'C: o F5 não entrega de novo');

  secao('O outro sentido: o segundo lote (E no shard 0, F no shard 1) cai no outro sim');
  const fechou2 = await ate(async () => (await pool.query(
    `SELECT count(*)::int AS n FROM market_anuncios WHERE id = ANY($1::bigint[]) AND estado = 'aberto'`, [lote2])).rows[0].n === 0, 75_000);
  ok(fechou2, 'a varredura fechou os 6');
  const quem2 = [0, 1].filter((s) => varridos(s) > varreu1[s]);
  ok(quem2.length === 1 && quem2[0] !== quem[0],
    `quem fechou foi o sim ${quem2.join(' e ')}, não o do primeiro lote — o dono ${quem2[0] === 0 ? 'F' : 'E'} está no OUTRO shard`);
  ok(await ate(() => [E, F].every((j) =>
    vezes(j, j.venda) === 1 && qtd(j.items, PEDRA) === antes2.get(j).pedra + 3 && qtd(j.balls, BOLA) === antes2.get(j).bola + 2), 20_000),
  'a devolução chegou à memória de E e de F');
  for (const j of [E, F]) {
    ok(vezes(j, j.venda) === 1 && qtd(j.items, PEDRA) === antes2.get(j).pedra + 3 && qtd(j.balls, BOLA) === antes2.get(j).bola + 2,
      `${j.nick}: pokémon 1×, +3 pedras, +2 bolas`,
      `pokémon ${vezes(j, j.venda)}× · pedra ${antes2.get(j).pedra} → ${qtd(j.items, PEDRA)} · bola ${antes2.get(j).bola} → ${qtd(j.balls, BOLA)}`);
    ok(eventos(j, 'marketExpirou') === 3, `${j.nick}: um aviso por anúncio`, `${eventos(j, 'marketExpirou')} avisos`);
  }
  await flush(E, F);
  for (const j of [E, F]) {
    const banco = await bolsaNoBanco(j);
    ok(qtd(banco.items, PEDRA) === qtd(j.items, PEDRA) && qtd(banco.balls, BOLA) === qtd(j.balls, BOLA),
      `${j.nick}: bolsa do banco = bolsa da memória depois do flush`);
  }

  // ------------------------------------------------------- relog de verdade
  secao(`A sai de vez (a carência de ${CARENCIA_MS / 1000} s vence) e entra de novo, lido do banco`);
  const aFinal = { pedra: qtd(A.items, PEDRA), bola: qtd(A.balls, BOLA) };
  await sair(A);
  await espera(CARENCIA_MS + 8000);
  // Marca no banco: se o sim ainda tivesse A na memória, o welcome não traria este saldo.
  await pool.query(`UPDATE players SET gold = 777777 WHERE id = $1`, [A.id]);
  ok(await entrar(A), `${A.nick} entrou de novo`);
  ok(A.gold === 777777, 'A foi relido do banco (não é a sessão antiga)', `gold ${A.gold}`);
  ok(vezes(A, A.venda) === 1, 'A: o pokémon continua lá, uma vez', `aparece ${vezes(A, A.venda)}×`);
  ok(qtd(A.items, PEDRA) === aFinal.pedra && qtd(A.balls, BOLA) === aFinal.bola,
    `A: pedra ${qtd(A.items, PEDRA)} e bola ${qtd(A.balls, BOLA)}, as mesmas de antes — nada perdido, nada em dobro`);

  // --------------------------------------------------------- devolução de boot
  secao('Devolução de BOOT: o sim 0 reinicia enquanto B joga no sim 1');
  const aNovo = await anunciarPeloSim(B, B.venda2);
  ok(aNovo != null, 'B anunciou o segundo pokémon');
  await pool.query(`UPDATE market_anuncios SET preco = 1 WHERE id = $1`, [aNovo]); // abaixo do mínimo
  const aProibido = await anuncioNoBanco(B, { itemId: PROIBIDO, qtd: 4, ficha: { nome: 'Air Tank' }, dias: null });
  const antesBoot = { proibido: qtd(B.items, PROIBIDO), devolvidos: eventos(B, 'marketDevolvido') };

  sims.get(0).kill();
  sims.delete(0);
  await espera(1000);
  await pub.del('posse:sim:0'); // a trava do processo morto (expiraria em 15 s)
  const voltou = await subirSim(0);
  ok(voltou, 'sim 0 subiu de novo');
  if (!voltou) throw new Error('o sim 0 não subiu de novo — ver o log abaixo');
  ok(logDe(0, 'fora da curadoria cancelados').length === 1, 'o boot fechou o item fora da curadoria');
  ok(logDe(0, 'abaixo do mínimo em Coins cancelados').length === 1, 'e o pokémon com preço abaixo do mínimo');

  const bootChegou = await ate(() => vezes(B, B.venda2) === 1 && qtd(B.items, PROIBIDO) === antesBoot.proibido + 4, 20_000);
  ok(bootChegou, 'B recebeu na memória, no sim 1, sem relogar');
  ok(vezes(B, B.venda2) === 1, 'B: o pokémon voltou UMA vez', `aparece ${vezes(B, B.venda2)}×`);
  ok(qtd(B.items, PROIBIDO) === antesBoot.proibido + 4, 'B: +4 do item fora da curadoria, uma vez',
    `${antesBoot.proibido} → ${qtd(B.items, PROIBIDO)}`);
  ok(eventos(B, 'marketDevolvido') === antesBoot.devolvidos + 2, 'B: dois avisos de "encerrado pelo sistema"');
  for (const id of [aNovo, aProibido]) {
    const { rows } = await pool.query(`SELECT estado, devolucao_pendente FROM market_anuncios WHERE id = $1`, [id]);
    ok(rows[0].estado === 'cancelado' && !rows[0].devolucao_pendente, `#${id}: cancelado e já entregue`);
  }
  await flush(B);
  const bancoB = await bolsaNoBanco(B);
  ok(qtd(bancoB.items, PROIBIDO) === qtd(B.items, PROIBIDO), 'B: o item está no banco depois do flush — o boot não escreveu por baixo');

  // ------------------------------------------------ entrega atrasada / repetida
  secao('Entrega atrasada não ressuscita o pokémon anunciado de novo');
  const reanuncio = await anunciarPeloSim(B, B.venda);
  ok(reanuncio != null, 'B anunciou de novo o pokémon que tinha voltado');
  // Força a pior hipótese: a entrega do anúncio vencido lá de cima chega DE NOVO agora.
  await pool.query(`UPDATE market_anuncios SET devolucao_pendente = true WHERE id = $1`, [anuncio.get(B)]);
  await paraSim(B, { t: 'market.devolver' });
  await ate(async () => !(await pool.query(`SELECT devolucao_pendente FROM market_anuncios WHERE id = $1`, [anuncio.get(B)])).rows[0].devolucao_pendente, 10_000);
  await espera(1500);
  ok(vezes(B, B.venda) === 0, 'B: o pokémon continua na vitrine, fora da memória', `aparece ${vezes(B, B.venda)}×`);
  ok(Number((await pokemonNoBanco(B.venda)).anuncio_id) === reanuncio, 'e o escrow é o do anúncio novo');

  // ----------------------------------------------------------------- fim
  secao('No fim');
  const { rows: pend } = await pool.query(
    `SELECT count(*)::int AS n FROM market_anuncios WHERE devolucao_pendente AND vendedor_id = ANY($1::bigint[])`,
    [todos.map((j) => j.id)]);
  ok(pend[0].n === 0, 'nenhuma devolução ficou pendente');
  for (const j of todos) ok(await quantosPokemons(j) === 3, `${j.nick}: 3 pokémon no banco`);
  const erros = [0, 1].flatMap((s) => logDe(s, 'devolução').filter((l) => /falhou|erro|Error/i.test(l)));
  ok(!erros.length, 'nenhum erro de devolução nos logs dos sims', erros.join(' | '));
} catch (err) {
  falhas++;
  console.error('\n✗ o teste estourou:', err);
} finally {
  if (falhas) {
    for (const [s, linhas] of logs) console.log(`\n--- últimas linhas do sim ${s}\n${linhas.slice(-15).join('\n')}`);
  }
  await desmontar();
}

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
