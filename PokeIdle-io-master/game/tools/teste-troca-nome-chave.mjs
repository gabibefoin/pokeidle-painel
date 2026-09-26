// Teste da TROCA DE NOME com DOIS SIMS de verdade — o buraco que só aparece quando o nick
// antigo volta para a prateleira e alguém o compra.
//
// O nick em minúsculas é a chave de roteamento do jogo: indexa `jogadores` no sim, `sockets` no
// gateway, a presença no Redis e, pelo `shardDoJogador`, QUAL processo é dono do jogador. A troca
// de nome gravava `players`, `accounts`, o cargo do chat e o token — e deixava o personagem vivo
// na memória sob a chave VELHA. Como a chave velha fica livre no mesmo instante, quem a comprasse
// em seguida entrava e o `entrar` achava aquele objeto: tratava como reconexão e o jogador caía
// DENTRO do personagem do outro, com depot, ouro e Mercado na mão.
//
// Aconteceu em produção em 20/09/2026 (`_MG_` → `_MG_1`, 23 s entre as duas trocas).
//
// O que se prova aqui:
//
//   1. quem renomeia é derrubado (kick) para reconectar com chave e shard novos;
//   2. o que ainda não tinha ido ao banco vai ANTES do socket cair — sem isso, o `hello` no
//      shard novo leria um estado de segundos atrás;
//   3. quem COMPRA o nick que acabou de vagar entra no PRÓPRIO personagem (o bug em si);
//   4. quem renomeou reencontra o personagem dele ao reconectar com o nome novo;
//   5. `accounts` acompanha pelo ID da conta, não pelo nick que está mudando;
//   6. uma troca RECUSADA (nome em uso) não derruba a sessão de ninguém.
//
// O teste monta o próprio cluster e o desmonta no fim — Redis descartável no Docker, banco
// próprio com o schema copiado do banco de dev (`accounts` nasce nas migrações do GATEWAY, que
// este teste não sobe) e os sims 0 e 1 de SHARD_COUNT=2, com SAIDA_CRUA=0 para a saída vir em
// JSON. Este script faz o papel do gateway: publica em `sim:N` e lê `gw:<id>`.
//
// Precisa do Docker e do Postgres de `npm run infra`. Leva menos de um minuto.
//
//   node tools/teste-troca-nome-chave.mjs
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import Redis from 'ioredis';
import { config } from '../src/server/config.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARDS = 2;
const GW = 'gwnome';
const PRECO_NOME = 6; // o produto `name` da loja

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
    await espera(200);
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
const nomeBanco = `pokeidle_teste_nome_${marca}`;
const urlBanco = new URL(config.databaseUrl);
urlBanco.pathname = `/${nomeBanco}`;
const nomeRedis = `pokeidle-teste-nome-${marca}`;
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

// ------------------------------------------------------------ o "gateway"
//
// Um jogador aqui é indexado pela chave ATUAL, e a troca de nome muda a chave: `reindexar` faz
// o que o gateway de verdade faz no `hello` seguinte.
const jogadores = new Map();
const lerEstado = (j, e) => {
  if (!e) return;
  if (e.gold != null) j.gold = e.gold;
  if (e.diamonds != null) j.diamonds = e.diamonds;
  if (e.nick) j.nickNaTela = e.nick;
};
function ouvirGateway() {
  sub.on('message', (canal, raw) => {
    if (canal !== `gw:${GW}`) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const j = jogadores.get(m.para);
    if (!j) return;
    for (const x of m.msgs ?? (m.msg ? [m.msg] : [])) {
      if (x?.t === 'welcome') {
        j.welcomes++;
        lerEstado(j, x.estado);
      } else if (x?.t === 'estado') {
        lerEstado(j, x.estado);
      } else if (x?.t === 'batalha') {
        for (const e of x.ev ?? []) if (e?.k) j.eventos.push(e);
      }
    }
    // O `kick` é o que o gateway de verdade traduz em `ws.close(4000)`. Guarda-se a CHAVE em
    // que ele chegou: é ela que o teste confere, não o nick.
    if (m.kick) j.kicks.push({ chave: m.para, em: Date.now() });
  });
}
const paraSim = (j, msg) => pub.publish(`sim:${shardDe(j.chave)}`, JSON.stringify({ playerId: j.chave, ...msg }));
async function entrar(j) {
  j.welcomes = 0;
  await pub.hset('presenca', j.chave, GW);
  await paraSim(j, { t: 'entrar', nick: j.nick, gatewayId: GW, admin: false, delta: false });
  return ate(() => j.welcomes > 0, 30_000);
}
const sair = (j) => paraSim(j, { t: 'sair' });
const eventos = (j, k) => j.eventos.filter((e) => e.k === k);
/** O jogador passou a atender por outra chave — o mapa do "gateway" acompanha. */
function reindexar(j, nickNovo) {
  jogadores.delete(j.chave);
  j.nick = nickNovo;
  j.chave = nickNovo.toLowerCase();
  jogadores.set(j.chave, j);
}

// ------------------------------------------------------------------ banco
/** Um nick livre que caia no shard pedido — a chave é o que decide o dono. */
function nickNoShard(base, shard) {
  for (let i = 0; ; i++) {
    const nick = `${base}${marca}${i}`;
    if (nick.length <= 16 && shardDe(nick.toLowerCase()) === shard) return nick;
  }
}
async function criarJogador(base, shard, { gold, diamantes = 50 }) {
  const nick = nickNoShard(base, shard);
  const id = Number((await pool.query(
    `INSERT INTO players (nick, gold, diamonds, tutorial_visto) VALUES ($1, $2, $3, true) RETURNING id`,
    [nick, gold, diamantes])).rows[0].id);
  const contaId = Number((await pool.query(
    `INSERT INTO accounts (nick, email, email_canon, provedor, email_ok, nick_ok)
     VALUES ($1, $2, $2, 'local', true, true) RETURNING id`,
    [nick, `${nick.toLowerCase()}@exemplo.test`])).rows[0].id);
  const ivs = JSON.stringify({ hp: 30, atk: 30, def: 30, spAtk: 30, spDef: 30, speed: 30 });
  const ativo = Number((await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, ivs, hp, slot, power)
     VALUES ($1, 1, 10, $2::jsonb, 100, 0, 100) RETURNING id`, [id, ivs])).rows[0].id);
  await pool.query(`UPDATE players SET active_poke = $2 WHERE id = $1`, [id, ativo]);
  const j = {
    nick, chave: nick.toLowerCase(), id, contaId, nickInicial: nick,
    welcomes: 0, gold: 0, diamonds: 0, nickNaTela: null, eventos: [], kicks: [],
  };
  jogadores.set(j.chave, j);
  return j;
}
const noBanco = async (j) => (await pool.query(
  `SELECT nick, gold, diamonds FROM players WHERE id = $1`, [j.id])).rows[0];
const contaNoBanco = async (j) => (await pool.query(
  `SELECT nick FROM accounts WHERE id = $1`, [j.contaId])).rows[0];

/** Compra a troca de nome e espera o evento (ou o aviso de recusa). */
async function comprarNome(j, nickNovo) {
  const antesOk = eventos(j, 'nomeTrocado').length;
  const antesAviso = eventos(j, 'aviso').length;
  await paraSim(j, { t: 'loja.comprar', id: 'name', nome: nickNovo });
  await ate(() => eventos(j, 'nomeTrocado').length > antesOk
    || eventos(j, 'aviso').length > antesAviso, 20_000);
  return {
    trocou: eventos(j, 'nomeTrocado').length > antesOk,
    aviso: eventos(j, 'aviso').slice(antesAviso).map((e) => e.msg).join(' / '),
  };
}

// ================================================================== o teste
try {
  secao('Montando o cluster (Redis descartável, banco próprio, 2 sims)');
  execFileSync('docker', ['run', '-d', '--rm', '--name', nomeRedis, '-p', `127.0.0.1:${portaRedis}:6379`, 'redis:7-alpine'],
    { stdio: 'ignore' });
  redisNoAr = true;
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
  if (!(await pool.query(`SELECT to_regclass('public.accounts') AS t`)).rows[0].t) {
    throw new Error(`o schema não veio do banco "${bancoDev}" (o Postgres de \`npm run infra\` está no ar?)`);
  }
  ok(true, `banco ${nomeBanco} com o schema do banco de dev`);

  await sub.subscribe(`gw:${GW}`);
  ouvirGateway();
  const vivo = () => pub.hset('gwvivos', GW, Date.now()).catch(() => {});
  await vivo();
  const batimento = setInterval(vivo, 5000);
  batimento.unref();

  for (const s of [0, 1]) {
    const noAr = await subirSim(s);
    ok(noAr, `sim ${s} no ar`);
    if (!noAr) throw new Error(`o sim ${s} não subiu — ver o log abaixo`);
  }

  // ---------------------------------------------------------------- preparo
  //
  // O ouro é a impressão digital de cada personagem: é por ele que se sabe, no welcome, DENTRO
  // de quem o jogador entrou.
  secao('Preparo: A (alt, shard 0) e B (principal, shard 1) on-line');
  const OURO_A = 111_111;
  const OURO_B = 7_777_777;
  const A = await criarJogador('tnA', 0, { gold: OURO_A });
  const B = await criarJogador('tnB', 1, { gold: OURO_B });
  const nickAntigoA = A.nick;
  // O nome novo de A cai no OUTRO shard: é o caso que uma re-indexação em memória não resolveria.
  const nomeNovoA = nickNoShard('tnZ', 1);
  ok(shardDe(nickAntigoA.toLowerCase()) === 0 && shardDe(nomeNovoA.toLowerCase()) === 1,
    `a troca de A muda de shard (${nickAntigoA} → ${nomeNovoA})`);
  ok(await entrar(A), `${A.nick} entrou (shard 0)`);
  ok(await entrar(B), `${B.nick} entrou (shard 1)`);
  ok(A.gold === OURO_A && B.gold === OURO_B, 'cada um entrou no próprio personagem');

  // ------------------------------------------------- 1 e 2: a chave se solta
  secao('1 e 2 · A troca de nome: grava o que faltava e derruba a sessão');
  // Ouro novo SÓ na memória: se o kick sair antes do flush, isto se perde.
  const OURO_A_NOVO = 222_222;
  await paraSim(A, { t: 'admin.gold', gold: OURO_A_NOVO });
  ok(await ate(async () => A.gold === OURO_A_NOVO, 10_000), 'A ganhou ouro (ainda só na memória)');
  ok((await noBanco(A)).gold === String(OURO_A) || Number((await noBanco(A)).gold) === OURO_A,
    'o banco ainda tem o ouro velho (o flush não passou)');

  const trocaA = await comprarNome(A, nomeNovoA);
  ok(trocaA.trocou, `A comprou a troca de nome para ${nomeNovoA}`, trocaA.aviso);
  const evNome = eventos(A, 'nomeTrocado')[0];
  ok(evNome?.nick === nomeNovoA, 'o evento trouxe o nick novo');
  ok(typeof evNome?.token === 'string' && evNome.token.length > 20, 'o evento trouxe token novo');
  ok(await ate(() => A.kicks.length > 0, 15_000), 'a sessão de A foi derrubada (kick)');
  ok(A.kicks[0]?.chave === nickAntigoA.toLowerCase(),
    'o kick saiu na CHAVE ANTIGA (é ela que o gateway tem no mapa)', A.kicks[0]?.chave);

  const aDepois = await noBanco(A);
  ok(aDepois.nick === nomeNovoA, 'players.nick trocou');
  ok(Number(aDepois.gold) === OURO_A_NOVO,
    'o ouro que estava só na memória foi ao banco ANTES do kick', `banco=${aDepois.gold}`);
  ok(Number(aDepois.diamonds) === 50 - PRECO_NOME, 'os 6 diamantes foram cobrados');
  ok((await contaNoBanco(A)).nick === nomeNovoA, 'accounts.nick acompanhou');
  ok((await contaNoBanco(B)).nick === B.nick, 'a conta de B não foi tocada');

  // -------------------------------------------- 3: o nick vago não é uma porta
  secao('3 · B compra o nick que acabou de vagar e entra — no PRÓPRIO personagem');
  const trocaB = await comprarNome(B, nickAntigoA);
  ok(trocaB.trocou, `B comprou o nick ${nickAntigoA}`, trocaB.aviso);
  ok(await ate(() => B.kicks.length > 0, 15_000), 'a sessão de B também foi derrubada');
  const chaveVelhaDeB = B.chave;
  reindexar(B, nickAntigoA);
  ok(shardDe(B.chave) === 0, 'B passou a rotear pelo shard 0 (o shard do nick que ele comprou)');
  // É AQUI que o bug aparecia: o sim 0 ainda teria o personagem de A vivo sob esta chave, e o
  // `entrar` de B seria tratado como reconexão DELE.
  ok(await entrar(B), `B entrou com o nick novo (${B.nick})`);
  ok(B.gold === OURO_B, 'B entrou no PERSONAGEM DELE, não no de A',
    `ouro no welcome=${B.gold} (o de A seria ${OURO_A_NOVO})`);
  ok(B.nickNaTela == null || B.nickNaTela === nickAntigoA, 'a tela de B mostra o nick de B');

  // ------------------------------------- 4: quem renomeou reencontra o dele
  secao('4 · A reconecta com o nome novo e reencontra o personagem dele');
  reindexar(A, nomeNovoA);
  ok(shardDe(A.chave) === 1, 'A passou a rotear pelo shard 1');
  ok(await entrar(A), `A entrou com o nick novo (${A.nick})`);
  ok(A.gold === OURO_A_NOVO, 'A voltou ao personagem dele, com o ouro de antes da troca',
    `ouro no welcome=${A.gold}`);

  // ----------------------------------- 5: os dois personagens seguem separados
  secao('5 · As duas linhas do banco continuam separadas');
  const OURO_B_NOVO = 8_888_888;
  await paraSim(B, { t: 'admin.gold', gold: OURO_B_NOVO });
  await paraSim(A, { t: 'admin.gold', gold: OURO_A_NOVO });
  await espera(config.flushMs + 2500);
  const fimA = await noBanco(A);
  const fimB = await noBanco(B);
  ok(Number(fimB.gold) === OURO_B_NOVO && fimB.nick === nickAntigoA,
    'o que B fez foi gravado na linha de B', `${fimB.nick}=${fimB.gold}`);
  ok(Number(fimA.gold) === OURO_A_NOVO && fimA.nick === nomeNovoA,
    'a linha de A não foi tocada pela sessão de B', `${fimA.nick}=${fimA.gold}`);
  ok(fimA.nick !== fimB.nick, 'os dois nicks continuam distintos');

  // --------------------------------- 6: recusa não pode derrubar quem não errou
  secao('6 · Troca recusada (nome em uso) não derruba a sessão');
  const kicksAntes = A.kicks.length;
  const diamantesAntes = Number((await noBanco(A)).diamonds);
  const recusa = await comprarNome(A, B.nick);
  ok(!recusa.trocou, 'a troca para um nome em uso foi recusada', recusa.aviso);
  await espera(2000);
  ok(A.kicks.length === kicksAntes, 'ninguém foi derrubado por uma compra recusada');
  ok(Number((await noBanco(A)).diamonds) === diamantesAntes, 'e nada foi cobrado');
  ok(await ate(async () => (await noBanco(A)).nick === nomeNovoA, 3000), 'o nick de A continua o dele');

  sair(A);
  sair(B);
  await espera(500);
} catch (err) {
  falhas++;
  console.error('\nerro no teste:', err.message);
  for (const [shard, linhas] of logs) {
    const ruim = linhas.filter((l) => /erro|error|falh/i.test(l)).slice(-10);
    if (ruim.length) console.error(`\n--- sim ${shard} ---\n${ruim.join('\n')}`);
  }
} finally {
  await desmontar();
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} passaram`);
process.exit(falhas ? 1 : 0);
