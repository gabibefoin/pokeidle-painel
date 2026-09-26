// O TRACKER de ponta a ponta: a ficha da partida, o rolo dos agregados e a API pública.
//
//   docker compose up -d && node tools/teste-tracker.mjs
//
// ### O que este teste prova, e por que cada parte precisa existir
//
// **A ficha** (`game/pvp-analise.mjs`) é tirada de uma partida SIMULADA DE VERDADE, com o mesmo
// `simularGuerra` do jogo — e não de uma fita escrita à mão. É o único jeito de provar a
// corrente inteira: o `speciesId` sai do catálogo, entra no ator da fita, sobrevive à troca de
// pokémon do meio da luta e chega ao relatório. Uma fita de mentira provaria só que o código
// lê a fita de mentira.
//
// **O rolo** (`tracker-db.mjs`) é rodado contra um banco de verdade, com partidas plantadas —
// inclusive uma de PESO ZERO, que NÃO pode entrar no meta (é a mesma casa: duas contas de uma
// pessoa não decidem qual é o pokémon mais forte do jogo).
//
// **A API** é atacada. A página é pública, sem login e indexável, então as perguntas são as de
// sempre: dá para injetar SQL pelo nick? dá para escapar da rota com `..`? o método POST faz
// alguma coisa? o teto por IP existe? a resposta vaza e-mail, IP, ouro ou qualquer coluna que o
// jogo não mostra? o `nosniff` está lá para um nick com `<script>` dentro não virar página?
//
// O banco é uma cópia do SCHEMA do banco de dev (nada de dado) e é apagado no fim, junto com o
// Redis — o banco de dev não é tocado.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import Redis from 'ioredis';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

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
const portaLivre = () => new Promise((resolve2, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve2(port));
  });
});

/**
 * O endereço do banco de DEV, lido sem importar `config.mjs`.
 *
 * Importar o config aqui em cima seria fatal para o teste: ele congela `databaseUrl` na
 * primeira carga, e os módulos do servidor que este arquivo importa mais abaixo (o rolo) o
 * pegariam apontando para o banco de desenvolvimento — o teste plantaria partidas de mentira
 * no banco em que você joga. Ler o `.env` na mão é a forma de escolher o banco ANTES disso.
 */
function urlDoBancoDeDev() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const arq = resolve(raiz, '.env');
  if (existsSync(arq)) {
    for (const linha of readFileSync(arq, 'utf8').split('\n')) {
      const m = linha.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  }
  return 'postgres://poke:poke@localhost:5433/pokeidle';
}

const marca = Date.now().toString(36);
const urlDev = urlDoBancoDeDev();
const nomeBanco = `pokeidle_teste_tracker_${marca}`;
const urlBanco = new URL(urlDev);
urlBanco.pathname = `/${nomeBanco}`;
const nomeRedis = `pokeidle-teste-tracker-${marca}`;
const portaRedis = await portaLivre();
const urlRedis = `redis://127.0.0.1:${portaRedis}`;
const porta = await portaLivre();
const base = `http://127.0.0.1:${porta}`;

// A TROCA DO BANCO, antes de qualquer `import` de módulo do servidor. Os imports do servidor
// são todos DINÂMICOS neste arquivo justamente por isto.
process.env.DATABASE_URL = urlBanco.toString();
process.env.REDIS_URL = urlRedis;

const admin = new pg.Pool({ connectionString: urlDev, max: 1 });
let pool = null;
let redis = null;
let servidor = null;
const logServidor = [];
let redisNoAr = false;
let bancoCriado = false;

async function desmontar() {
  servidor?.kill();
  redis?.disconnect();
  await pool?.end().catch(() => {});
  try {
    const db = await import('../src/server/db.mjs');
    await db.pool.end().catch(() => {});
  } catch { /* nem chegou a importar */ }
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

/** Uma requisição à API, saindo de `ip`. */
async function req(caminho, { ip = '203.0.113.7', metodo = 'GET', corpo = null, extra = {} } = {}) {
  const headers = { 'cf-connecting-ip': ip, ...extra };
  if (corpo) headers['content-type'] = 'application/json';
  const r = await fetch(`${base}${caminho}`, {
    method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined, redirect: 'manual',
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* página ou vazio */ }
  return { status: r.status, texto, json, headers: r.headers };
}

// -------------------------------------------------------- o elenco de teste

/** Nicks curtos e únicos por rodada — `players.nick` é UNIQUE e o banco morre no fim. */
const NICK_A = `tka${marca}`.slice(0, 16);
const NICK_B = `tkb${marca}`.slice(0, 16);
const NICK_C = `tkc${marca}`.slice(0, 16);

/** Um pokémon pronto para o campo, no formato que `simularGuerra` espera. */
function paraCombate(conteudo, pokeId, nivel, id) {
  const { especies, calcularStats, hpDeCombate, multDeNascenca } = conteudo;
  const esp = especies.get(pokeId);
  if (!esp) throw new Error(`espécie ${pokeId} não existe no catálogo`);
  const ivs = { hp: 20, atk: 20, def: 20, spa: 20, spd: 20, spe: 20 };
  const stats = calcularStats(esp, ivs, nivel, 3, multDeNascenca(3, false), null);
  return {
    id,
    speciesId: esp.pokeId,
    nome: esp.name,
    looktype: esp.looktype,
    lookShiny: null,
    tipos: [esp.type1, esp.type2].filter(Boolean),
    level: nivel,
    shiny: false,
    stats,
    maxHp: hpDeCombate(stats.hp),
    tmElemental: null,
  };
}

const lado = (idx, nick, equipe) => ({
  id: idx,
  nome: nick,
  brasao: null,
  membros: [{ playerId: idx, nick, looktype: 159, visual: null, equipe }],
});

async function main() {
  // ------------------------------------------------------------ infra
  secao('Infra própria');
  execFileSync('docker', ['run', '-d', '--rm', '--name', nomeRedis, '-p', `127.0.0.1:${portaRedis}:6379`, 'redis:7-alpine'],
    { stdio: 'ignore' });
  redisNoAr = true;
  redis = new Redis(urlRedis).on('error', () => {});
  ok(await ate(() => redis.status === 'ready', 20_000), `Redis no ar (porta ${portaRedis})`);

  await admin.query(`CREATE DATABASE ${nomeBanco}`);
  bancoCriado = true;
  const usuario = decodeURIComponent(urlBanco.username);
  const bancoDev = new URL(urlDev).pathname.slice(1);
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c',
    `pg_dump -U "${usuario}" -s "${bancoDev}" | psql -q -U "${usuario}" -d "${nomeBanco}"`],
  { cwd: raiz, stdio: 'ignore' });
  pool = new pg.Pool({ connectionString: urlBanco.toString(), max: 3 });
  ok(!!(await pool.query(`SELECT to_regclass('public.players') AS t`)).rows[0].t,
    `banco ${nomeBanco} com o schema do banco de dev`);

  // ------------------------------------------- a ficha, de uma partida de verdade
  secao('A ficha da partida (partida simulada de verdade)');
  const conteudo = await import('../src/server/content.mjs');
  const { simularGuerra, arenaDeDuelo } = await import('../src/server/game/guild-pvp-sim.mjs');
  const { fichaDaPartida } = await import('../src/server/game/pvp-analise.mjs');

  // Times de três, com espécies bem diferentes de força: a luta tem de acabar em wipe, e com
  // TROCA de pokémon no meio — é a troca que exercita o caminho do `c` (o `speciesId` do
  // reserva) na análise.
  const equipeA = [
    paraCombate(conteudo, 6, 120, 101),   // Charizard
    paraCombate(conteudo, 9, 120, 102),   // Blastoise
    paraCombate(conteudo, 3, 120, 103),   // Venusaur
  ];
  const equipeB = [
    paraCombate(conteudo, 65, 110, 201),  // Alakazam
    paraCombate(conteudo, 68, 110, 202),  // Machamp
    paraCombate(conteudo, 94, 110, 203),  // Gengar
  ];
  const arena = arenaDeDuelo();
  const r = await simularGuerra([lado(1, NICK_A, equipeA), lado(2, NICK_B, equipeB)], {
    arenaSlug: arena.slug, gradeInteira: arena.gradeInteira, ordemFixa: true,
  });
  ok(!!r?.replay?.atores?.length, 'a partida simulou e gravou fita');

  const comEspecie = (r.replay.atores ?? []).filter((a) => !a.tr && Number(a.e) > 0).length;
  ok(comEspecie === 2, 'o ator de pokémon da fita leva o speciesId (`e`)', `com e: ${comEspecie}`);

  const trocas = (r.replay.quadros ?? []).flatMap((q) => q.c ?? []);
  ok(trocas.length > 0, 'houve troca de pokémon no meio da luta', `trocas: ${trocas.length}`);
  ok(trocas.every((c) => Number(c.e) > 0), 'toda troca também leva o speciesId');

  const ficha = fichaDaPartida(r.replay, { nickA: NICK_A, nickB: NICK_B });
  ok(!!ficha && ficha.v === 1 && ficha.lados?.length === 2, 'a ficha saiu da fita');
  const idsDaFicha = new Set(ficha.lados.flatMap((l) => l.pks.map((p) => p.e)));
  ok([...idsDaFicha].every((e) => e > 0), 'todo pokémon da ficha tem espécie');
  ok(idsDaFicha.has(6) && idsDaFicha.has(65), 'as espécies da ficha são as que entraram em campo',
    [...idsDaFicha].join(','));

  const somaDano = ficha.lados.reduce((s, l) => s + l.d, 0);
  const somaPks = ficha.lados.reduce((s, l) => s + l.pks.reduce((x, p) => x + p.d, 0), 0);
  ok(somaDano > 0 && somaDano === somaPks,
    'o dano do lado é a soma do dano dos pokémon dele', `${somaDano} vs ${somaPks}`);
  const recebido = ficha.lados.reduce((s, l) => s + l.r, 0);
  ok(recebido === somaDano, 'o que um causou é o que o outro recebeu', `${somaDano} / ${recebido}`);
  ok(ficha.lados.some((l) => l.golpes.length > 0), 'a ficha lista os golpes que renderam');
  ok(ficha.lados.every((l) => l.golpes.length <= 4), 'a lista de golpes é cortada no topo');

  // A ficha é gravada como JSONB: precisa caber. Um relatório que cresce sem teto encheria o
  // banco em silêncio, e é exatamente o problema que fez o replay do ranqueado ser descartado.
  const bytes = Buffer.byteLength(JSON.stringify(ficha));
  ok(bytes < 4096, `a ficha cabe no orçamento (${bytes} bytes, teto 4 KB)`);

  // ------------------------------------------------------------ o rolo
  secao('O rolo dos agregados');
  // A migração do PvP vem antes: é ela que acrescenta a coluna `detalhe` a `pvp_partidas`, e
  // o dump do banco de dev pode ser anterior a ela.
  const pvpdb = await import('../src/server/pvp-ranqueado-db.mjs');
  await pvpdb.migrar();
  const trackerDb = await import('../src/server/tracker-db.mjs');
  await trackerDb.migrar();
  ok(!!(await pool.query(`SELECT to_regclass('public.tracker_especie') AS t`)).rows[0].t,
    'a migração criou as tabelas do Tracker');
  const { rows: temCol } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'pvp_partidas' AND column_name = 'detalhe'`,
  );
  ok(temCol.length === 1, 'e `pvp_partidas` ganhou a coluna `detalhe`');

  const idDe = async (nick) => {
    const { rows } = await pool.query(
      `INSERT INTO players (nick) VALUES ($1) RETURNING id`, [nick],
    );
    return Number(rows[0].id);
  };
  const idA = await idDe(NICK_A);
  const idB = await idDe(NICK_B);
  const idC = await idDe(NICK_C);
  await pool.query(
    `INSERT INTO pvp_rank (player_id, pontos, vitorias, derrotas, partidas, ultima_em)
     VALUES ($1, 1400, 12, 4, 16, now()), ($2, 1100, 6, 10, 16, now()), ($3, 900, 1, 1, 2, now())`,
    [idA, idB, idC],
  );

  // Seis partidas iguais (A ganha de B) + uma de PESO ZERO. O peso zero é o teste que importa:
  // ele NÃO pode aparecer em lugar nenhum do agregado.
  const plantar = async (a, b, venceuA, peso, detalhe, minutosAtras) => {
    await pool.query(
      `INSERT INTO pvp_partidas
         (a_id, b_id, a_nick, b_nick, a_antes, b_antes, a_delta, b_delta, venceu_a,
          motivo, duracao_ms, peso, detalhe, criado_em)
       VALUES ($1,$2,$3,$4,1200,1200,$5,$6,$7,'wipe',$8,$9,$10, now() - ($11 || ' minutes')::interval)`,
      [a === idA ? idA : idB, b === idB ? idB : idA, a === idA ? NICK_A : NICK_B,
       b === idB ? NICK_B : NICK_A, venceuA ? 14 : -14, venceuA ? -14 : 14, venceuA,
       ficha.dur, peso, JSON.stringify(detalhe), String(minutosAtras)],
    );
  };
  for (let i = 0; i < 6; i++) await plantar(idA, idB, true, 1, ficha, 30 + i);
  await plantar(idA, idB, true, 0, ficha, 20); // mesma casa — não conta
  // Uma partida RECENTE demais para o rolo (a margem de um minuto contra o commit fora de ordem).
  await plantar(idA, idB, true, 1, ficha, 0);

  const somadas = await trackerDb.rolar({ especies: conteudo.especies });
  ok(somadas === 6, `o rolo somou as 6 partidas válidas (e ignorou peso 0 e a recente)`, `somou ${somadas}`);

  const { rows: esp } = await pool.query(
    `SELECT species_id, partidas, vitorias, entradas, dano FROM tracker_especie ORDER BY species_id`,
  );
  ok(esp.length > 0, 'o meta ganhou linhas de espécie');
  const char = esp.find((x) => Number(x.species_id) === 6);
  ok(char && Number(char.partidas) === 6, 'Charizard aparece nas 6 partidas', `${char?.partidas}`);
  ok(char && Number(char.vitorias) === 6, 'e venceu as 6 (ele estava no lado A)');
  const ala = esp.find((x) => Number(x.species_id) === 65);
  ok(ala && Number(ala.vitorias) === 0, 'Alakazam, do lado B, venceu 0');

  const { rows: dic } = await pool.query(
    `SELECT nome, looktype, tipo1 FROM tracker_pokemon WHERE species_id = 6`,
  );
  ok(dic[0]?.nome && dic[0].tipo1, 'o dicionário de espécie levou nome e tipo do catálogo',
    JSON.stringify(dic[0] ?? {}));

  const { rows: conf } = await pool.query(
    `SELECT partidas, vitorias FROM tracker_confronto WHERE species_id = 6 AND rival_id = 65`,
  );
  ok(Number(conf[0]?.partidas) === 6 && Number(conf[0]?.vitorias) === 6,
    'o confronto Charizard × Alakazam foi contado seis vezes', JSON.stringify(conf[0] ?? {}));

  const { rows: jog } = await pool.query(
    `SELECT partidas, vitorias, dano FROM tracker_jogador WHERE player_id = $1`, [idA],
  );
  ok(Number(jog[0]?.partidas) === 6 && Number(jog[0]?.vitorias) === 6,
    'o agregado do jogador A fechou em 6/6', JSON.stringify(jog[0] ?? {}));

  // O CURSOR COMEÇA NO FIM da tabela numa base que já existe. É o caso de produção: a coluna
  // `detalhe` chega com este deploy, então nenhuma das partidas antigas tem ficha — e caminhar
  // por elas seria mais de uma hora de lotes vazios ANTES de o rolo chegar às partidas de hoje.
  await pool.query(`DELETE FROM game_meta WHERE chave = 'tracker_cursor'`);
  await trackerDb.migrar();
  const { rows: cur } = await pool.query(`SELECT valor FROM game_meta WHERE chave = 'tracker_cursor'`);
  const { rows: topo } = await pool.query(`SELECT coalesce(max(id), 0)::text AS m FROM pvp_partidas`);
  ok(cur[0]?.valor === topo[0].m,
    `numa base que já existe, o cursor nasce no fim dela (${cur[0]?.valor} = ${topo[0].m})`);
  const doZero = await trackerDb.rolar({ especies: conteudo.especies });
  ok(doZero === 0, 'e por isso o rolo não reprocessa o histórico inteiro', `somou ${doZero}`);

  // IDEMPOTÊNCIA: o cursor andou, então rodar de novo não pode somar nada duas vezes.
  const denovo = await trackerDb.rolar({ especies: conteudo.especies });
  const { rows: esp2 } = await pool.query(`SELECT partidas FROM tracker_especie WHERE species_id = 6`);
  ok(denovo === 0 && Number(esp2[0].partidas) === 6,
    'rodar o rolo de novo não soma nada duas vezes', `somou ${denovo}, partidas ${esp2[0].partidas}`);

  // ------------------------------------------------------------ o servidor
  secao('O servidor');
  servidor = spawn(process.execPath, ['src/server/index.mjs'], {
    cwd: raiz,
    env: {
      ...process.env,
      PORT: String(porta), ROLE: 'all', SHARD_ID: '0', SHARD_COUNT: '1', ARENA_SHARD_ID: '0',
      ORBS_WORKER: '0', DATABASE_URL: urlBanco.toString(), REDIS_URL: urlRedis,
      URL_PUBLICA: base, IP_CONFIAR_CF_SEMPRE: '1',
      MAX_CONTAS_POR_IP: '0', MAX_ONLINE_POR_IP: '0',
      TURNSTILE_SECRET_KEY: '', TURNSTILE_SITE_KEY: '', RESEND_API_KEY: '',
      CARTEIRA_CHAVE_PRIVADA: '', CHAIN_RPC_URL: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '',
      EFI_CLIENT_ID: '', EFI_CLIENT_SECRET: '', LIVEPIX_CLIENT_ID: '', LIVEPIX_CLIENT_SECRET: '',
      CONTABILIZEI_USUARIO: '', CONTABILIZEI_SENHA: '', GOOGLE_CLIENT_SECRET: '', DISCORD_CLIENT_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ler = (buf) => logServidor.push(...String(buf).split('\n').filter(Boolean));
  servidor.stdout.on('data', ler);
  servidor.stderr.on('data', ler);
  const noAr = await ate(async () => (await fetch(`${base}/saude`).catch(() => null))?.ok === true, 90_000);
  ok(noAr, `servidor no ar (porta ${porta})`);
  if (!noAr) throw new Error(`o servidor não subiu:\n${logServidor.slice(-25).join('\n')}`);

  // ------------------------------------------------------------ a página
  secao('A página');
  const pag = await req('/tracker');
  ok(pag.status === 200 && pag.texto.includes('tracker.mjs'), '/tracker serve a página', `${pag.status}`);
  ok(/content-security-policy/i.test([...pag.headers.keys()].join(',')), 'a página leva CSP');
  ok(pag.headers.get('x-frame-options') === 'DENY', 'e X-Frame-Options: DENY');
  ok(/<script nonce="/.test(pag.texto), 'o nonce foi injetado nos scripts da página');
  const fundo = await req('/tracker/j/qualquercoisa');
  ok(fundo.status === 200 && fundo.texto.includes('tracker.mjs'),
    'um endereço interno (/tracker/j/…) serve a MESMA página', `${fundo.status}`);
  const css = await req('/tracker.css');
  ok(css.status === 200 && css.texto.includes('--mad-linha'), 'a folha de estilo é servida');

  // ------------------------------------------------------------ a API
  secao('A API');
  const inicio = await req('/tracker/api/inicio');
  ok(inicio.status === 200 && Array.isArray(inicio.json?.maisUsados), '/inicio responde', `${inicio.status}`);
  ok(inicio.json.maisUsados.some((x) => x.nome), 'e as espécies vêm com nome');

  const meta = await req('/tracker/api/meta?ordem=winrate&limite=5');
  ok(meta.status === 200 && meta.json.ordem === 'winrate', '/meta aceita a ordenação da lista');

  const metaRuim = await req('/tracker/api/meta?ordem=' + encodeURIComponent('partidas; DROP TABLE players'));
  ok(metaRuim.status === 200 && metaRuim.json.ordem === 'uso',
    'ordenação desconhecida cai no padrão (a cláusula sai de uma lista fechada)', metaRuim.json?.ordem);
  ok(!!(await pool.query(`SELECT to_regclass('public.players') AS t`)).rows[0].t,
    'e a tabela players continua de pé depois do "DROP TABLE"');

  const ficheJ = await req(`/tracker/api/jogador?nick=${NICK_A}`);
  ok(ficheJ.status === 200 && ficheJ.json.jogador?.nick === NICK_A, '/jogador responde a ficha');
  ok(ficheJ.json.totais?.partidas === 6, 'com as 6 partidas somadas', `${ficheJ.json.totais?.partidas}`);
  // Sete, e não oito: a de PESO ZERO fica fora. Peso zero é MESMA CASA, e publicá-la numa
  // página aberta contaria ao mundo que duas contas dividem a mesma rede.
  ok(ficheJ.json.partidas?.length === 7, 'o histórico traz 7 partidas (a de peso zero fica fora)',
    `${ficheJ.json.partidas?.length}`);
  ok(ficheJ.json.partidas.every((p) => p.valeuPonto === undefined),
    'e a ficha nem carrega o campo que denunciaria a mesma casa');
  ok(ficheJ.json.partidas.every((p) => p.id === undefined),
    'nenhuma partida leva o id interno (ele contaria quantas partidas o servidor já teve)');
  ok(ficheJ.json.partidas.every((p) => p.eu?.pks?.length), 'toda partida traz o relatório por pokémon');
  ok(ficheJ.json.pokemons?.some((p) => p.id === 6), 'a lista de pokémon do jogador tem o Charizard');
  ok(ficheJ.json.counters?.length > 0, 'e os counters dele');

  // O NICK é procurado sem diferenciar maiúscula, como o jogo roteia.
  const caixaAlta = await req(`/tracker/api/jogador?nick=${NICK_A.toUpperCase()}`);
  ok(caixaAlta.status === 200 && caixaAlta.json.jogador?.nick === NICK_A,
    'a busca de nick ignora maiúsculas/minúsculas');

  const busca = await req(`/tracker/api/busca?q=${NICK_A.slice(0, 4)}`);
  ok(busca.status === 200 && busca.json.linhas?.some((l) => l.nick === NICK_A), '/busca acha por prefixo');
  const buscaCurta = await req('/tracker/api/busca?q=a');
  ok(buscaCurta.status === 200 && buscaCurta.json.linhas.length === 0,
    'uma letra só não busca nada (piso de duas)');

  const pk = await req('/tracker/api/pokemon?id=6');
  ok(pk.status === 200 && pk.json.pokemon?.id === 6, '/pokemon responde a ficha da espécie');
  ok(pk.json.vitimas?.some((v) => v.id === 65), 'e o Alakazam está entre as vítimas dele');

  const lad = await req('/tracker/api/ladder');
  ok(lad.status === 200 && lad.json.linhas?.length >= 1, '/ladder responde');
  ok(lad.json.linhas.every((l) => l.tierId), 'toda linha da ladder tem emblema');

  const gui = await req('/tracker/api/guilds');
  ok(gui.status === 200 && Array.isArray(gui.json.guerras), '/guilds responde');

  // A ANÁLISE de uma guerra. Não há guerra nenhuma neste banco, então o que se prova aqui é o
  // portão: dia fora do formato e dia inexistente terminam em 404, e nunca numa consulta com o
  // que veio da URL dentro.
  for (const dia of ['2026-09-21', 'ontem', "2026-09-21' OR '1'='1", '../../etc/passwd', '']) {
    const r2 = await req(`/tracker/api/guerra?dia=${encodeURIComponent(dia)}`);
    ok(r2.status === 404, `guerra inexistente/inválida leva 404: ${JSON.stringify(dia).slice(0, 26)}`, `${r2.status}`);
  }

  // O TIPO de um golpe só aparece quando ele é sempre o mesmo. O ataque básico sai com o tipo
  // de quem bateu, e uma linha dizendo "Investida · WATER" para golpes de dezoito tipos seria
  // um selo inventado em cima de um número certo.
  await pool.query(
    `INSERT INTO tracker_golpe (temporada, golpe, tipo, usos, dano) VALUES ('2026-01-05','X','FIRE',1,10)`,
  );
  await pool.query(
    `INSERT INTO tracker_golpe (temporada, golpe, tipo, usos, dano) VALUES ('2026-01-05','X','WATER',1,10)
     ON CONFLICT (temporada, golpe) DO UPDATE SET
       tipo = CASE WHEN tracker_golpe.tipo IS DISTINCT FROM EXCLUDED.tipo THEN NULL ELSE EXCLUDED.tipo END,
       usos = tracker_golpe.usos + EXCLUDED.usos`,
  );
  const { rows: golpeMisto } = await pool.query(
    `SELECT tipo, usos FROM tracker_golpe WHERE temporada = '2026-01-05' AND golpe = 'X'`,
  );
  ok(golpeMisto[0]?.tipo === null && Number(golpeMisto[0]?.usos) === 2,
    'golpe com dois tipos perde o selo e mantém a soma', JSON.stringify(golpeMisto[0] ?? {}));

  // Os RETRATOS: a rota que diz onde recortar o sprite de cada espécie.
  const spr = await req('/tracker/api/sprites?lt=60006,60149,999999');
  ok(spr.status === 200 && spr.json.retratos?.['60006']?.img,
    '/sprites devolve o recorte de uma espécie que existe');
  ok(!spr.json.retratos?.['999999'], 'e omite o looktype que não está no pack');
  ok(String(spr.json.retratos['60006'].img).startsWith('/assets/'),
    'o caminho do sprite é relativo ao nosso servidor', spr.json.retratos['60006'].img);
  const sprMuitos = await req(`/tracker/api/sprites?lt=${Array.from({ length: 400 }, (_, i) => 60000 + i).join(',')}`);
  ok(sprMuitos.status === 200 && Object.keys(sprMuitos.json.retratos).length <= 80,
    'o pedido de retratos é cortado no teto de 80', `${Object.keys(sprMuitos.json.retratos ?? {}).length}`);
  // Looktype inventado não pode virar entrada permanente em memória: o parâmetro aceita
  // qualquer inteiro, e cachear a resposta "não existe" era um vazamento com endereço público.
  const sprLixo = await req(`/tracker/api/sprites?lt=${Array.from({ length: 80 }, (_, i) => 900000 + i).join(',')}`);
  ok(sprLixo.status === 200 && Object.keys(sprLixo.json.retratos).length === 0,
    'looktype inventado volta vazio, e sem erro');

  // ------------------------------------------------------------ privacidade
  secao('Privacidade: o que a resposta NÃO pode conter');
  await pool.query(`UPDATE players SET gold = 999777, diamonds = 4242 WHERE id = $1`, [idA]);
  const fichaCrua = (await req(`/tracker/api/jogador?nick=${NICK_A}`)).texto;
  for (const proibido of ['999777', '4242', 'email', '@gmail', 'senha', 'token', 'ip_', 'items']) {
    ok(!fichaCrua.toLowerCase().includes(proibido.toLowerCase()),
      `a ficha não contém "${proibido}"`);
  }
  ok(!fichaCrua.includes('ultima_em') && !fichaCrua.includes('ultimaEm'),
    'nem a hora da última partida (o jogo já a esconde da ficha pública)');
  // A idade da conta sai em MÊS. Com dia e hora ela viraria o sinal mais fácil para cruzar
  // contas alternativas de fora — "estas seis nasceram no mesmo minuto".
  const desde = (await req(`/tracker/api/jogador?nick=${NICK_A}`)).json?.jogador?.desde;
  ok(/^\d{4}-\d{2}$/.test(String(desde)), `a data de criação da conta sai só em mês (${desde})`);

  // ------------------------------------------------------------ injeção
  secao('Injeção e travessia');
  const ataquesNick = [
    "' OR 1=1 --", "'; DROP TABLE players; --", `${NICK_A}' UNION SELECT NULL--`,
    '../../etc/passwd', '%2e%2e%2f%2e%2e%2fetc%2fpasswd', '<script>alert(1)</script>',
    'a'.repeat(500), '\u0000nulo', 'admin\\', '{"$ne":null}',
  ];
  for (const a of ataquesNick) {
    const r2 = await req(`/tracker/api/jogador?nick=${encodeURIComponent(a)}`);
    ok(r2.status === 400 || r2.status === 404,
      `nick hostil recusado: ${JSON.stringify(a).slice(0, 34)}`, `${r2.status}`);
    ok(!/error|sintaxe|syntax|pg_|relation|SELECT/i.test(r2.texto),
      '  e a resposta não devolve erro do banco', r2.texto.slice(0, 80));
  }
  ok(!!(await pool.query(`SELECT to_regclass('public.players') AS t`)).rows[0].t,
    'players continua existindo depois de toda a rodada');

  const idHostil = await req('/tracker/api/pokemon?id=' + encodeURIComponent('6 OR 1=1'));
  ok(idHostil.status === 200 || idHostil.status === 404,
    'id de pokémon com SQL dentro vira número ou 404', `${idHostil.status}`);
  const idNegativo = await req('/tracker/api/pokemon?id=-1');
  ok(idNegativo.status === 404, 'id negativo não existe', `${idNegativo.status}`);

  const temporadaHostil = await req(`/tracker/api/meta?temporada=${encodeURIComponent("2026-01-01' OR '1'='1")}`);
  ok(temporadaHostil.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(temporadaHostil.json.temporada),
    'temporada inválida cai na temporada atual', temporadaHostil.json?.temporada);
  const temporadaQuaseCerta = await req('/tracker/api/meta?temporada=2026-09-23');
  ok(temporadaQuaseCerta.json.temporada !== '2026-09-23',
    'uma data que NÃO é segunda-feira não é temporada e cai na atual',
    temporadaQuaseCerta.json?.temporada);

  const paginaEnorme = await req('/tracker/api/ladder?pagina=999999999&limite=99999');
  ok(paginaEnorme.status === 200 && paginaEnorme.json.porPagina <= 100,
    'limite e página são travados no teto', JSON.stringify({ p: paginaEnorme.json?.porPagina }));

  // ------------------------------------------------------------ método e rota
  secao('Método, rota e cabeçalhos');
  for (const metodo of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r2 = await req('/tracker/api/inicio', { metodo, corpo: { x: 1 } });
    ok(r2.status === 405, `${metodo} na API leva 405`, `${r2.status}`);
  }
  const rotaInventada = await req('/tracker/api/deixa-eu-ver');
  ok(rotaInventada.status === 404, 'rota inventada leva 404 e não cai na página',
    `${rotaInventada.status}`);
  ok(rotaInventada.json?.erro === 'tracker.rota', 'e responde JSON, não HTML');

  const cab = await req('/tracker/api/inicio');
  ok(cab.headers.get('content-type')?.startsWith('application/json'), 'a API responde JSON');
  ok(cab.headers.get('x-content-type-options') === 'nosniff', 'com nosniff');
  ok(!cab.headers.get('access-control-allow-origin'),
    'e SEM CORS — nenhum site de fora lê isto pelo navegador de ninguém');
  ok(!cab.headers.get('set-cookie'), 'a API não planta cookie nenhum');

  // A sessão não é lida: mandar um token não muda nada, e é isso que garante que não há
  // resposta privada nenhuma para envenenar num cache compartilhado.
  const comToken = await req('/tracker/api/inicio', { extra: { authorization: 'Bearer nao-existe' } });
  ok(comToken.status === 200, 'um Authorization inventado não muda nada (a API não lê sessão)');

  // ------------------------------------------------------------ o teto por IP
  secao('O teto por origem');
  const ipMartelo = '198.51.100.9';
  let bateu = 0;
  let status429 = 0;
  for (let i = 0; i < 75; i++) {
    const r2 = await req('/tracker/api/inicio', { ip: ipMartelo });
    if (r2.status === 200) bateu++;
    if (r2.status === 429) status429++;
  }
  ok(status429 > 0, `o teto barra o martelo (${bateu} passaram, ${status429} levaram 429)`);
  const outroIp = await req('/tracker/api/inicio', { ip: '198.51.100.10' });
  ok(outroIp.status === 200, 'e o teto é por ORIGEM — o vizinho continua entrando', `${outroIp.status}`);

  // O IPv6 é contado pelo /64, que é o bloco de UMA casa. Sem isso, trocar de endereço dentro
  // do próprio prefixo (coisa de uma linha para quem tem IPv6) zerava o teto a cada pedido.
  let v6ok = 0;
  let v6barrado = 0;
  for (let i = 0; i < 75; i++) {
    const r2 = await req('/tracker/api/inicio', { ip: `2804:14d:1::${(i + 1).toString(16)}` });
    if (r2.status === 200) v6ok++;
    if (r2.status === 429) v6barrado++;
  }
  ok(v6barrado > 0, `IPv6 rotativo no mesmo /64 cai no MESMO balde (${v6ok} ok, ${v6barrado} barrados)`);
  const outroV6 = await req('/tracker/api/inicio', { ip: '2804:14d:2::1' });
  ok(outroV6.status === 200, 'e o /64 vizinho continua entrando', `${outroV6.status}`);

  // A BUSCA tem um teto próprio, mais apertado: é a única rota que enumera nick.
  let buscaOk = 0;
  let buscaBarrada = 0;
  for (let i = 0; i < 40; i++) {
    const r2 = await req(`/tracker/api/busca?q=tk${i % 9}`, { ip: '198.51.100.44' });
    if (r2.status === 200) buscaOk++;
    if (r2.status === 429) buscaBarrada++;
  }
  ok(buscaBarrada > 0 && buscaOk <= 20,
    `a busca tem teto próprio e mais baixo (${buscaOk} ok, ${buscaBarrada} barradas)`);

  // ------------------------------------------------------ o banco protegido
  secao('O banco protegido');
  const { rows: pools } = await pool.query(
    `SELECT application_name, count(*)::int AS n FROM pg_stat_activity
      WHERE datname = $1 AND application_name <> '' GROUP BY 1 ORDER BY 1`, [nomeBanco]);
  const doTracker = pools.filter((r) => r.application_name.startsWith('pokeidle-tracker'));
  ok(doTracker.length === 1, 'o Tracker fala com o banco por um pool PRÓPRIO',
    JSON.stringify(pools));
  ok(doTracker[0] && doTracker[0].n <= 4,
    `e ele nunca passa de 4 conexões (${doTracker[0]?.n ?? 0})`);

  // Uma rajada de perfis DIFERENTES (pior caso: nada vem do cache) não pode encostar no pool
  // do jogo. É o cenário que o pool separado existe para impedir.
  await Promise.all(Array.from({ length: 60 }, (_, i) =>
    req(`/tracker/api/jogador?nick=${[NICK_A, NICK_B, NICK_C][i % 3]}`, { ip: `203.0.113.${100 + (i % 40)}` })));
  const { rows: durante } = await pool.query(
    `SELECT application_name, count(*)::int AS n FROM pg_stat_activity
      WHERE datname = $1 AND application_name LIKE 'pokeidle-tracker%' GROUP BY 1`, [nomeBanco]);
  ok((durante[0]?.n ?? 0) <= 4, `depois da rajada o pool do Tracker continua em ${durante[0]?.n ?? 0} conexões`);

  // ------------------------------------------------------------ a compressão
  secao('A compressão');
  const semGzip = await req(`/tracker/api/jogador?nick=${NICK_A}`, { extra: { 'accept-encoding': 'identity' } });
  const comGzip = await fetch(`${base}/tracker/api/jogador?nick=${NICK_A}`, {
    headers: { 'cf-connecting-ip': '203.0.113.200', 'accept-encoding': 'gzip' },
  });
  ok(comGzip.headers.get('content-encoding') === 'gzip', 'a ficha desce comprimida para quem aceita gzip');
  const tamGz = Number(comGzip.headers.get('content-length')) || 0;
  ok(tamGz > 0 && tamGz < semGzip.texto.length / 2,
    `e cabe em menos da metade (${semGzip.texto.length} B → ${tamGz} B)`);
  ok(comGzip.headers.get('vary')?.includes('accept-encoding'),
    'com `Vary: accept-encoding`, para nenhum proxy servir a versão errada');

  // ------------------------------------------------------------ o XSS
  secao('XSS: um nick com HTML dentro');
  // O cadastro não deixa criar um nick assim, mas o banco é o que é: se um dia um nick
  // estranho entrar (importação, correção na mão, bug de validação), a página não pode
  // executá-lo. A API devolve JSON e a página monta tudo por `textContent` — as duas coisas
  // juntas é o que fecha este buraco, e o que se testa aqui é a primeira.
  const nickXss = `x${marca}`.slice(0, 12);
  await pool.query(`UPDATE players SET nick = $1 WHERE id = $2`, [nickXss, idC]);
  const rXss = await req(`/tracker/api/jogador?nick=${nickXss}`);
  ok(rXss.status === 200, 'a ficha do nick de teste abre');
  ok(rXss.headers.get('content-type')?.includes('application/json'),
    'e vem como JSON (com nosniff, o navegador nunca a interpreta como página)');

  // A ESCRITA de `innerHTML` é o que abre o buraco — `.innerHTML =`, e não a palavra solta num
  // comentário. Uma só é esperada (as bandeiras do seletor de idioma, constantes do arquivo);
  // qualquer outra é alguém montando HTML por concatenação numa página que mostra nick alheio.
  const tracker = readFileSync(join(raiz, 'src/client/tracker.mjs'), 'utf8');
  const escritas = (tracker.match(/\.innerHTML\s*[+]?=/g) ?? []).length;
  ok(escritas === 1,
    'o cliente escreve em `innerHTML` uma única vez (as bandeiras, constantes do próprio arquivo)',
    `escritas: ${escritas}`);
  ok(/BANDEIRAS\[/.test(tracker.split('.innerHTML')[1]?.slice(0, 40) ?? ''),
    'e o que ela escreve é a constante das bandeiras');

  // ------------------------------------------------------------ o log
  secao('O log do servidor');
  const estouros = logServidor.filter((l) => /tracker.*estourou|UnhandledPromise/i.test(l));
  ok(estouros.length === 0, 'nenhuma rota do Tracker estourou durante o teste', estouros.slice(0, 3).join(' | '));
}

try {
  await main();
} catch (err) {
  falhas++;
  console.error('\n[X] o teste parou:', err.stack ?? err.message);
  if (logServidor.length) console.error(logServidor.slice(-25).join('\n'));
} finally {
  await desmontar();
}

console.log(`\n${testes - falhas}/${testes} passaram.`);
process.exit(falhas ? 1 : 0);
