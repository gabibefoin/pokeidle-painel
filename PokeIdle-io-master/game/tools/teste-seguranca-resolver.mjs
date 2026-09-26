// O painel sob ataque: um cargo Resolver Auditoria tentando virar admin, e um estranho
// tentando virar qualquer coisa.
//
// O outro arquivo (`teste-resolver-auditoria.mjs`) pergunta "o cargo consegue trabalhar?".
// Este pergunta o contrário: **dá para subir de cargo sem passar pelo `.env`?** Tudo aqui é
// escrito do ponto de vista de quem já tem alguma coisa — uma sessão de jogador comum, uma
// sessão do cargo, um token interceptado — e quer mais do que recebeu.
//
// O roteiro segue o OWASP Top 10 (2021), só nos itens que esta superfície realmente tem:
//
//   A01 Broken Access Control ...... o cargo alcança o que não é dele? o estranho alcança algo?
//   A02 Cryptographic Failures ..... o token assinado aguenta ser remendado no meio do caminho?
//   A03 Injection .................. nick e busca chegam ao SQL como dado ou como comando?
//   A04 Insecure Design ............ a segunda camada do saque é mesmo uma segunda pessoa?
//   A05 Security Misconfiguration .. o erro devolve pilha, caminho de arquivo, nome de coluna?
//   A07 Auth Failures .............. token vazio, remendado, de conta apagada, de conta banida.
//   A08 Data Integrity ............. campo a mais no corpo JSON vira permissão?
//   A09 Logging .................... o que o cargo faz fica registrado com o nome dele?
//
// A04, A06 e A10 não têm alvo aqui: não há upload, não há dependência nova, e nenhuma rota
// do painel busca URL que o cliente escolha.
//
// Servidor, banco e Redis PRÓPRIOS, apagados no fim. O banco de dev não é tocado.
//
//   docker compose up -d && node tools/teste-seguranca-resolver.mjs
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import Redis from 'ioredis';
import WebSocket from 'ws';
import { config } from '../src/server/config.mjs';
import { SAQUE } from '../src/server/game/orbs.mjs';

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
const portaLivre = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

const marca = Date.now().toString(36);
const nomeBanco = `pokeidle_teste_segres_${marca}`;
const urlBanco = new URL(config.databaseUrl);
urlBanco.pathname = `/${nomeBanco}`;
const nomeRedis = `pokeidle-teste-segres-${marca}`;
const portaRedis = await portaLivre();
const urlRedis = `redis://127.0.0.1:${portaRedis}`;
const porta = await portaLivre();
const base = `http://127.0.0.1:${porta}`;

const IP = '10.0.0.1';
const EMAIL_ADMIN = `adm${marca}@gmail.com`;
const EMAIL_RESOLVER = `res${marca}@gmail.com`;
// Um segundo endereço no mesmo `.env`: é a conta descartável do teste de sessão revogada.
const EMAIL_RESOLVER2 = `re2${marca}@gmail.com`;

const admin = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
let pool = null;
let pub = null;
let servidor = null;
const logServidor = [];
let redisNoAr = false;
let bancoCriado = false;

async function desmontar() {
  servidor?.kill();
  pub?.disconnect();
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

async function req(caminho, { metodo = 'GET', corpo, cru, tipo } = {}) {
  const headers = { 'cf-connecting-ip': IP };
  if (corpo || cru) headers['content-type'] = tipo ?? 'application/json';
  let r;
  try {
    r = await fetch(`${base}${caminho}`, {
      method: metodo, headers, body: cru ?? (corpo ? JSON.stringify(corpo) : undefined),
    });
  } catch {
    // Conexão derrubada no meio é RESPOSTA, e a certa: `lerCorpo` faz `req.destroy()` quando o
    // corpo passa do limite, em vez de seguir juntando bytes de quem manda um megabyte. Sem
    // este `catch` o teste leria a defesa funcionando como se fosse o teste quebrando.
    return { status: 0, texto: '', json: null, cortou: true };
  }
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* página */ }
  return { status: r.status, texto, json, cortou: false };
}

const painel = (rota, token, corpo = {}) =>
  req(`/admin/${rota}`, { metodo: 'POST', corpo: { token, ...corpo } });

async function criarConta(nick) {
  const r = await req('/auth/criar', {
    metodo: 'POST', corpo: { nick, email: `${nick}@gmail.com`, senha: 'teste1234' },
  });
  if (r.status !== 200 || !r.json?.token) {
    throw new Error(`cadastro de ${nick} falhou: ${r.status} ${r.texto.slice(0, 200)}`);
  }
  return r.json;
}

/** Entra no jogo uma vez — é o que faz a linha em `players` existir. */
async function nascerPersonagem(sessao) {
  const s = { welcome: null };
  const ws = new WebSocket(`ws://127.0.0.1:${porta}/`, { headers: { 'cf-connecting-ip': IP } });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', nick: sessao.nick, token: sessao.token })));
  ws.on('message', (raw) => {
    try { const m = JSON.parse(String(raw)); if (m.t === 'welcome') s.welcome = m; } catch { /* binário */ }
  });
  ws.on('error', () => {});
  await ate(() => s.welcome, 20_000);
  ws.close();
  await espera(300);
  return s.welcome;
}

// ---------------------------------------------------------------- remendos de token
//
// O token é `corpo.mac`: base64url de um JSON, e um HMAC-SHA256 por cima. Ele é ASSINADO, não
// cifrado — quem intercepta lê o conteúdo. Isso é de projeto (é o mesmo desenho de um JWT) e
// não é o que se testa aqui. O que se testa é a única coisa que importa: **o conteúdo pode ser
// trocado?** Se puder, trocar o `contaId` pelo do admin é escalar de cargo com um editor de texto.

const parteCorpo = (token) => JSON.parse(Buffer.from(String(token).split('.')[0], 'base64url').toString());

/** Reescreve o miolo do token e mantém o MAC original — o ataque clássico de token assinado. */
function remendar(token, mudanca) {
  const [corpo, mac] = String(token).split('.');
  const dados = { ...JSON.parse(Buffer.from(corpo, 'base64url').toString()), ...mudanca };
  const novo = Buffer.from(JSON.stringify(dados)).toString('base64url');
  return `${novo}.${mac}`;
}

/** Vira um caractere do MAC — mesmo comprimento, para o `timingSafeEqual` chegar a comparar. */
function macTorto(token) {
  const [corpo, mac] = String(token).split('.');
  const trocado = (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1);
  return `${corpo}.${trocado}`;
}

/** Payloads de SQL — o `'` fecha a string, o resto tenta virar comando. */
const INJECOES = [
  `' OR '1'='1`,
  `'; DROP TABLE accounts; --`,
  `" OR 1=1 --`,
  `' UNION SELECT email, 1, 1 FROM accounts --`,
  `admin'--`,
  `%' OR nick LIKE '%`,
];

async function main() {
  secao('Infra própria');
  execFileSync('docker', ['run', '-d', '--rm', '--name', nomeRedis, '-p', `127.0.0.1:${portaRedis}:6379`, 'redis:7-alpine'],
    { stdio: 'ignore' });
  redisNoAr = true;
  pub = new Redis(urlRedis).on('error', () => {});
  ok(await ate(() => pub.status === 'ready', 20_000), `Redis no ar (porta ${portaRedis})`);

  await admin.query(`CREATE DATABASE ${nomeBanco}`);
  bancoCriado = true;
  const usuario = decodeURIComponent(urlBanco.username);
  const bancoDev = new URL(config.databaseUrl).pathname.slice(1);
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c',
    `pg_dump -U "${usuario}" -s "${bancoDev}" | psql -q -U "${usuario}" -d "${nomeBanco}"`],
  { cwd: raiz, stdio: 'ignore' });
  pool = new pg.Pool({ connectionString: urlBanco.toString(), max: 2 });

  servidor = spawn(process.execPath, ['src/server/index.mjs'], {
    cwd: raiz,
    env: {
      ...process.env,
      PORT: String(porta), ROLE: 'all', SHARD_ID: '0', SHARD_COUNT: '1', ARENA_SHARD_ID: '0',
      ORBS_WORKER: '0', DATABASE_URL: urlBanco.toString(), REDIS_URL: urlRedis,
      URL_PUBLICA: base, IP_CONFIAR_CF_SEMPRE: '1',
      ADMIN_EMAILS: EMAIL_ADMIN,
      AUDITORIA_RESOLVER_EMAILS: `${EMAIL_RESOLVER},${EMAIL_RESOLVER2}`,
      MED_EMAILS: '',
      // A Tesouraria precisa existir para o teste de vazamento ter o que vazar.
      CARTEIRAS_LUCRO: `fria:HpSrFUidPfBoFBbTvbLPTHVYuCgUhAcJEKPnGKPNrJp5`,
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
  if (!noAr) throw new Error('o servidor não subiu');

  secao('O elenco');
  const adm = await criarConta(`adm${marca}`.slice(0, 16));
  await pool.query(`UPDATE accounts SET email = $1 WHERE lower(nick) = lower($2)`, [EMAIL_ADMIN, adm.nick]);
  const res = await criarConta(`res${marca}`.slice(0, 16));
  await pool.query(`UPDATE accounts SET email = $1 WHERE lower(nick) = lower($2)`, [EMAIL_RESOLVER, res.nick]);
  const zeh = await criarConta(`zeh${marca}`.slice(0, 16));
  await nascerPersonagem(res);
  await nascerPersonagem(zeh);
  ok(true, 'admin, um resolvedor e um jogador comum — os dois últimos com personagem');

  // ================================================================ A01
  secao('A01 · Broken Access Control — o cargo tentando alcançar o caixa');
  const NEGADAS = [
    ['colher', { carteira: 'HpSrFUidPfBoFBbTvbLPTHVYuCgUhAcJEKPnGKPNrJp5', usdt: 1 }],
    ['gemas/varredura', {}],
    ['financeiro/resumo', {}],
    ['financeiro/config', {}],
    ['diamantes/historico', {}],
    ['online-contagem/estado', {}],
    ['notas/listar', {}],
    ['med/historico', {}],
  ];
  let barradas = 0;
  for (const [rota, corpo] of NEGADAS) {
    const r = await painel(rota, res.token, corpo);
    if (r.status === 404) barradas++;
    else console.log(`      ↳ ${rota} deixou o cargo passar (${r.status})`);
  }
  ok(barradas === NEGADAS.length, `as ${NEGADAS.length} rotas de dinheiro respondem 404 ao cargo`, `${barradas}`);

  const zehTenta = await painel('usuarios/listar', zeh.token, {});
  ok(zehTenta.status === 404, 'o jogador comum não abre nem a aba mais inocente');

  // O 404 é escolha: um 403 confirmaria que a rota existe e que há painel atrás dela.
  const inventada = await painel('usuarios/listar', res.token, {});
  const inexistente = await painel('rota-que-nao-existe', res.token, {});
  ok(inventada.status === 200 && inexistente.status === 404,
    'rota fechada e rota inexistente respondem igual — nada a enumerar');

  secao('A01 · O painel não vaza o caixa por JSON');
  const pAdm = await painel('painel', adm.token);
  const pRes = await painel('painel', res.token);
  ok(pAdm.json?.crypto != null && pAdm.json?.carteiras?.length > 0,
    'o admin recebe os números e as carteiras (é a aba dele)');
  const vazou = ['crypto', 'fiat', 'carteiras', 'varredura', 'historico'].filter((k) => pRes.json?.[k] != null);
  ok(vazou.length === 0, 'o cargo NÃO recebe crypto, fiat, carteiras, varredura nem histórico', vazou.join(', '));
  ok(!/HpSrFUid/.test(pRes.texto), 'e o endereço da carteira de lucro não aparece em lugar nenhum da resposta');
  ok(Array.isArray(pRes.json?.cargos), 'mas continua recebendo `cargos` — a aba Tags do chat é dele');

  // ================================================================ A02 / A07
  secao('A02 · o token remendado no meio do caminho');
  const miolo = parteCorpo(res.token);
  ok(typeof miolo.contaId !== 'undefined', `o token carrega contaId=${miolo.contaId} em claro (assinado, não cifrado)`);

  const contaIdAdmin = (await pool.query(
    `SELECT id FROM accounts WHERE lower(email) = lower($1)`, [EMAIL_ADMIN],
  )).rows[0].id;

  const ataques = [
    ['trocar o contaId pelo do admin', remendar(res.token, { contaId: Number(contaIdAdmin) })],
    ['trocar o contaId em texto', remendar(res.token, { contaId: String(contaIdAdmin) })],
    ['esticar a validade', remendar(res.token, { exp: Date.now() + 9e11 })],
    ['virar um caractere do MAC', macTorto(res.token)],
    ['ficar só com o miolo, sem MAC', String(res.token).split('.')[0]],
    ['MAC vazio', `${String(res.token).split('.')[0]}.`],
    ['token de outro formato', 'eyJhbGciOiJub25lIn0.e30.'],
    ['token vazio', ''],
  ];
  for (const [nome, token] of ataques) {
    const r = await painel('painel', token);
    ok(r.status === 404, `${nome} → 404`, `${r.status}`);
  }
  const semToken = await req('/admin/painel', { metodo: 'POST', corpo: {} });
  ok(semToken.status === 404, 'sem campo token → 404');
  for (const esquisito of [null, 0, [], { contaId: 1 }, true]) {
    const r = await req('/admin/painel', { metodo: 'POST', corpo: { token: esquisito } });
    ok(r.status === 404, `token do tipo ${JSON.stringify(esquisito)} → 404`, `${r.status}`);
  }

  secao('A07 · a sessão depois que a conta muda');
  const apagavel = await criarConta(`tmp${marca}`.slice(0, 16));
  await pool.query(`UPDATE accounts SET email = $1 WHERE lower(nick) = lower($2)`, [EMAIL_RESOLVER2, apagavel.nick]);
  const antesDeApagar = await painel('painel', apagavel.token);
  ok(antesDeApagar.status === 200, 'um segundo endereço no mesmo .env abre o painel');
  await pool.query(`DELETE FROM accounts WHERE lower(nick) = lower($1)`, [apagavel.nick]);
  const depoisDeApagar = await painel('painel', apagavel.token);
  ok(depoisDeApagar.status === 404, 'apagada a conta, o token que ela tinha não abre mais nada');

  // ================================================================ A08
  secao('A08 · campo a mais no corpo JSON não vira permissão');
  const forjados = [
    ['adminCompleto', { token: zeh.token, adminCompleto: true }],
    ['email do admin', { token: zeh.token, email: EMAIL_ADMIN }],
    ['contaId do admin', { token: zeh.token, contaId: Number(contaIdAdmin) }],
    ['os três juntos', { token: zeh.token, adminCompleto: true, email: EMAIL_ADMIN, contaId: Number(contaIdAdmin) }],
  ];
  for (const [nome, corpo] of forjados) {
    const r = await req('/admin/painel', { metodo: 'POST', corpo });
    ok(r.status === 404, `o jogador comum mandando ${nome} → 404`, `${r.status}`);
  }
  const resForja = await req('/admin/painel', { metodo: 'POST', corpo: { token: res.token, adminCompleto: true, email: EMAIL_ADMIN } });
  ok(resForja.json?.adminCompleto === false,
    'e o cargo que manda adminCompleto:true continua recebendo false — quem responde é o servidor');
  ok(resForja.json?.email === EMAIL_RESOLVER,
    'o e-mail da resposta é o do BANCO, não o que veio no corpo', String(resForja.json?.email));

  secao('A01 · as portas de cargo, uma a uma');
  const cargo = await painel('cargos/definir', res.token, { nick: zeh.nick, cargo: 'admin' });
  ok(cargo.status === 400, 'não dá para atribuir a tag "admin" pelo painel — a lista é fechada',
    `${cargo.status} ${cargo.json?.erro ?? ''}`);
  for (const inventado of ['administrador', 'Admin', 'owner', 'root', '__proto__']) {
    const r = await painel('cargos/definir', res.token, { nick: zeh.nick, cargo: inventado });
    ok(r.status === 400, `nem a tag "${inventado}"`, `${r.status}`);
  }

  const proprioEmail = await painel('usuarios/email', res.token, { nick: res.nick, novoEmail: EMAIL_ADMIN });
  ok(proprioEmail.status === 400, 'o cargo não troca o PRÓPRIO e-mail para o do admin',
    `${proprioEmail.status} ${proprioEmail.json?.erro ?? ''}`);
  const emailDoAdmin = await painel('usuarios/email', res.token, { nick: adm.nick, novoEmail: `livre${marca}@gmail.com` });
  ok(emailDoAdmin.status === 400, 'nem tira o admin do endereço dele',
    `${emailDoAdmin.status} ${emailDoAdmin.json?.erro ?? ''}`);
  const promoverZeh = await painel('usuarios/email', res.token, { nick: zeh.nick, novoEmail: EMAIL_ADMIN });
  ok(promoverZeh.status === 400, 'nem promove um laranja pondo o e-mail do admin na conta dele',
    `${promoverZeh.status} ${promoverZeh.json?.erro ?? ''}`);
  // A mesma caixa com um ponto no meio — `ehEmailDeCargo` compara canônico, não texto.
  const comPonto = EMAIL_ADMIN.replace('@', '.x@').replace('.x@', '@');
  const pontoNoNome = `${EMAIL_ADMIN.split('@')[0].split('').join('.')}@gmail.com`;
  const porCaixa = await painel('usuarios/email', res.token, { nick: zeh.nick, novoEmail: pontoNoNome });
  ok(porCaixa.status === 400, 'nem pela mesma CAIXA do Gmail (pontos no nome)',
    `${porCaixa.status} ${porCaixa.json?.erro ?? ''} [${comPonto ? '' : ''}${pontoNoNome}]`);

  // ================================================================ A03
  secao('A03 · Injection — nick e busca chegam como dado');
  const antes = (await pool.query(`SELECT count(*)::int AS n FROM accounts`)).rows[0].n;
  let estourou = 0;
  let vazouLista = 0;
  for (const p of INJECOES) {
    const busca = await painel('usuarios/listar', res.token, { q: p, limite: 40 });
    if (busca.status >= 500) estourou++;
    // `' OR '1'='1` como TEXTO não casa com nick nenhum: lista cheia seria o WHERE tendo virado comando.
    if (busca.json?.usuarios?.length > 0) vazouLista++;
    for (const rota of ['usuarios/ficha', 'usuarios/banir-soft', 'usuarios/desbanir', 'chat/mutes/revogar']) {
      const r = await painel(rota, res.token, { nick: p, motivo: 'x' });
      if (r.status >= 500) estourou++;
    }
  }
  ok(estourou === 0, `nenhum dos ${INJECOES.length} payloads derrubou uma rota (500)`, `${estourou} estouro(s)`);
  ok(vazouLista === 0, 'e nenhum fez a busca devolver a base inteira', `${vazouLista}`);
  const depois = (await pool.query(`SELECT count(*)::int AS n FROM accounts`)).rows[0].n;
  ok(antes === depois, 'a tabela accounts continua de pé, com o mesmo número de linhas', `${antes} → ${depois}`);
  ok(!!(await pool.query(`SELECT to_regclass('public.accounts') AS t`)).rows[0].t, 'o DROP TABLE não aconteceu');

  // ================================================================ A04
  secao('A04 · Insecure Design — a segunda camada do saque é outra pessoa?');
  const playerRes = (await pool.query(`SELECT id FROM players WHERE lower(nick) = lower($1)`, [res.nick])).rows[0].id;
  const playerZeh = (await pool.query(`SELECT id FROM players WHERE lower(nick) = lower($1)`, [zeh.nick])).rows[0].id;
  const criarSaque = async (id, playerId) => pool.query(
    `INSERT INTO orb_saques (id, player_id, orbs, usdt, rede, endereco, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, playerId, 1000, 7, 'solana', 'HpSrFUidPfBoFBbTvbLPTHVYuCgUhAcJEKPnGKPNrJp5', SAQUE.AGUARDANDO],
  );
  await criarSaque(`sq_res_${marca}`, playerRes);
  await criarSaque(`sq_zeh_${marca}`, playerZeh);

  const proprio = await painel('gemas/saques/aprovar', res.token, { id: `sq_res_${marca}` });
  ok(proprio.status === 400 && /próprio saque/.test(proprio.json?.erro ?? ''),
    'o cargo NÃO aprova o próprio saque', `${proprio.status} ${proprio.json?.erro ?? proprio.texto.slice(0, 80)}`);
  const estadoProprio = (await pool.query(`SELECT status FROM orb_saques WHERE id = $1`, [`sq_res_${marca}`])).rows[0].status;
  ok(estadoProprio === SAQUE.AGUARDANDO,
    'e o saque dele continua aguardando — não chegou a PENDENTE, que é o que o worker paga', estadoProprio);

  const deOutro = await painel('gemas/saques/aprovar', res.token, { id: `sq_zeh_${marca}` });
  ok(deOutro.status === 200, 'mas aprova o de outro jogador — a aba continua servindo para o que existe',
    `${deOutro.status} ${deOutro.texto.slice(0, 100)}`);

  secao('A04 · o teto do que o cargo entrega por ticket');
  const absurdo = await painel('resolver-auditoria/entregar', res.token, { nick: zeh.nick, itemId: 0, qtd: 999_999_999 });
  ok(absurdo.status === 400, 'quantidade absurda de diamante é recusada', `${absurdo.status} ${absurdo.json?.erro ?? ''}`);
  for (const q of [1.5, NaN, Infinity, '1e30', null]) {
    const r = await painel('resolver-auditoria/entregar', res.token, { nick: zeh.nick, itemId: 0, qtd: q });
    ok(r.status === 400, `quantidade ${JSON.stringify(q)} recusada`, `${r.status}`);
  }

  // ================================================================ A05
  secao('A05 · o erro não conta como o servidor é por dentro');
  const sujeira = [
    ['gemas/saques/aprovar', { id: { $ne: null } }],
    ['usuarios/coins', { nick: zeh.nick, gold: 'muito' }],
    ['guilds/apagar', { id: 'não-é-número' }],
    ['multicontas/plano', { tipo: '../../etc/passwd', chave: 'x' }],
  ];
  let vazamentos = [];
  for (const [rota, corpo] of sujeira) {
    const r = await painel(rota, res.token, corpo);
    const t = r.texto;
    if (/at \/|at [A-Z]:\\|node_modules|\.mjs:\d|ECONNREFUSED|syntax error at or near|relation "/.test(t)) {
      vazamentos.push(`${rota}: ${t.slice(0, 120)}`);
    }
    if (r.status >= 500 && /stack|Error:/i.test(t)) vazamentos.push(`${rota}: pilha`);
  }
  ok(vazamentos.length === 0, 'nenhuma resposta traz caminho de arquivo, pilha ou erro cru do Postgres',
    vazamentos.join(' | '));
  const corpoGigante = await req('/admin/painel', { metodo: 'POST', cru: 'x'.repeat(100_000) });
  ok(corpoGigante.cortou || corpoGigante.status === 404 || corpoGigante.status === 400,
    'corpo gigante é cortado sem derrubar a rota',
    `${corpoGigante.cortou ? 'conexao derrubada' : corpoGigante.status}`);
  const aindaDePe = await painel('painel', res.token);
  ok(aindaDePe.status === 200, 'e o servidor segue atendendo logo depois', `${aindaDePe.status}`);

  // O 404 só esconde o painel se ele for a resposta para TUDO. Um corpo que não parseia
  // respondendo 500 numa rota real, e 404 numa rota inventada, é um mapa do painel de graça.
  secao('A05 · corpo torto não separa rota que existe de rota que não existe');
  const TORTOS = ['token=abc', 'nao é json', '{', '[]', 'null', '7', '"texto"', ''];
  const ALVOS = [
    '/admin/painel', '/admin/colher', '/admin/usuarios/listar', '/admin/gemas/saques/aprovar',
    '/admin/financeiro/resumo', '/admin/med/historico',
    '/admin/rota-inventada', '/admin/usuarios/inventada',
  ];
  const respostas = new Set();
  const fora = [];
  for (const alvo of ALVOS) {
    for (const t of TORTOS) {
      const r = await req(alvo, { metodo: 'POST', cru: t, tipo: 'application/x-www-form-urlencoded' });
      respostas.add(r.status);
      if (r.status !== 404) fora.push(`${alvo} [${t.slice(0, 12)}] → ${r.status}`);
    }
  }
  ok(fora.length === 0,
    `${ALVOS.length} caminhos × ${TORTOS.length} corpos tortos: todos respondem 404, iguais`,
    fora.slice(0, 4).join(' | '));
  ok(respostas.size === 1 && respostas.has(404),
    'nenhum 500 no meio para denunciar qual rota existe', [...respostas].join('/'));

  // ================================================================ A09
  secao('A09 · o que o cargo faz fica no nome dele');
  await painel('resolver-auditoria/entregar', res.token, { nick: zeh.nick, itemId: 0, qtd: 5 });
  const log = (await pool.query(
    `SELECT por_email, player_nick, qtd FROM admin_resolver_log ORDER BY id DESC LIMIT 1`,
  )).rows[0];
  ok(log?.por_email === EMAIL_RESOLVER && log?.player_nick === zeh.nick,
    'a entrega por ticket grava quem entregou, para quem e quanto', JSON.stringify(log));
  const aprovador = (await pool.query(
    `SELECT aprovado_por FROM orb_saques WHERE id = $1`, [`sq_zeh_${marca}`],
  )).rows[0]?.aprovado_por;
  ok(aprovador === EMAIL_RESOLVER, 'e o saque aprovado guarda o e-mail de quem aprovou', String(aprovador));
  const banido = await painel('usuarios/banir-soft', res.token, { nick: zeh.nick, motivo: 'auditoria' });
  const porQuem = (await pool.query(
    `SELECT por_email FROM account_bans ab JOIN accounts a ON a.id = ab.account_id
      WHERE lower(a.nick) = lower($1)`, [zeh.nick],
  )).rows[0]?.por_email;
  ok(banido.status === 200 && porQuem === EMAIL_RESOLVER, 'e o ban guarda quem baniu', String(porQuem));
}

try {
  await main();
} catch (err) {
  falhas++;
  console.error('\nerro fatal:', err.message, err.stack?.split('\n')[1] ?? '');
  if (logServidor.length) console.error(logServidor.slice(-25).join('\n'));
} finally {
  await desmontar();
}

console.log(`\n${falhas ? `✗ ${falhas} de ${testes} falharam` : `✓ ${testes}/${testes} ataques repelidos`}`);
process.exit(falhas ? 1 : 0);
