// O BANIMENTO DE IP de ponta a ponta, num servidor de verdade com banco e Redis PRÓPRIOS.
//
// O que só se prova com o servidor inteiro de pé, e é exatamente onde um ban de IP falha:
//
//   · ele barra TUDO — página, arquivo, cadastro, login e socket —, e não só a rota que alguém
//     lembrou de proteger;
//   · quem já estava jogando cai NA HORA (o painel publica, o gateway fecha o socket com 4003);
//   · o resto do mundo continua entrando, e o PAINEL continua abrindo para o admin;
//   · o IPv6 é banido pelo /64, e o /64 vizinho não;
//   · as travas: o próprio IP do admin, a contagem da prévia, o portão de admin (404) e o prazo.
//
// IPs diferentes vêm pelo `CF-Connecting-IP`, que o servidor de teste aceita de qualquer peer
// (`IP_CONFIAR_CF_SEMPRE=1`). O banco é uma cópia do SCHEMA do banco de dev (nada de dado) e é
// apagado no fim, junto com o Redis — o banco de dev não é tocado.
//
//   docker compose up -d && node tools/teste-ban-ip.mjs
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import Redis from 'ioredis';
import WebSocket from 'ws';
import { config } from '../src/server/config.mjs';
import { bucketDeIp } from '../src/server/ip-cliente.mjs';

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
const nomeBanco = `pokeidle_teste_banip_${marca}`;
const urlBanco = new URL(config.databaseUrl);
urlBanco.pathname = `/${nomeBanco}`;
const nomeRedis = `pokeidle-teste-banip-${marca}`;
const portaRedis = await portaLivre();
const urlRedis = `redis://127.0.0.1:${portaRedis}`;
const porta = await portaLivre();
const base = `http://127.0.0.1:${porta}`;

// Os IPs do roteiro.
const IP_ADMIN = '10.0.0.1';
const IP_FAZENDA = '5.6.7.8';
const IP_INOCENTE = '9.9.9.9';
const IP_OUTRA_REDE = '7.7.7.7';
const EMAIL_ADMIN = `adm${marca}@gmail.com`;

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

/** Uma requisição saindo de `ip`. Devolve status, corpo cru e o JSON, se for. */
async function req(caminho, { ip, metodo = 'GET', corpo, html = false } = {}) {
  const headers = { 'cf-connecting-ip': ip };
  if (corpo) headers['content-type'] = 'application/json';
  if (html) headers.accept = 'text/html,application/xhtml+xml';
  const r = await fetch(`${base}${caminho}`, {
    method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* página */ }
  return { status: r.status, texto, json };
}

const painel = (rota, corpo, ip = IP_ADMIN) =>
  req(`/admin/${rota}`, { ip, metodo: 'POST', corpo: { token: tokenAdmin, ...corpo } });

async function criarConta(nick, ip) {
  const r = await req('/auth/criar', {
    ip, metodo: 'POST', corpo: { nick, email: `${nick}@gmail.com`, senha: 'teste1234' },
  });
  if (r.status !== 200 || !r.json?.token) throw new Error(`cadastro de ${nick} falhou: ${r.status} ${r.texto.slice(0, 200)}`);
  return r.json;
}

/**
 * Abre o socket do jogo saindo de `ip` e manda o `hello`. O objeto devolvido acompanha o que
 * chega: `welcome` (entrou), os erros e o código de fechamento.
 */
function abrirJogo(ip, sessao) {
  const s = { mensagens: [], erros: [], welcome: false, fechou: null };
  s.ws = new WebSocket(`ws://127.0.0.1:${porta}/`, { headers: { 'cf-connecting-ip': ip } });
  s.ws.on('open', () => s.ws.send(JSON.stringify({ t: 'hello', nick: sessao.nick, token: sessao.token })));
  s.ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    s.mensagens.push(m);
    if (m.t === 'welcome') s.welcome = true;
    if (m.t === 'erro') s.erros.push(m.chave ?? m.msg);
  });
  s.ws.on('close', (codigo) => { s.fechou = codigo; });
  s.ws.on('error', () => {});
  return s;
}

let tokenAdmin = null;

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
  ok(!!(await pool.query(`SELECT to_regclass('public.accounts') AS t`)).rows[0].t,
    `banco ${nomeBanco} com o schema do banco de dev`);

  // Tudo que fala com fora vai vazio: este servidor não manda e-mail, não cobra, não assina nada.
  servidor = spawn(process.execPath, ['src/server/index.mjs'], {
    cwd: raiz,
    env: {
      ...process.env,
      PORT: String(porta), ROLE: 'all', SHARD_ID: '0', SHARD_COUNT: '1', ARENA_SHARD_ID: '0',
      ORBS_WORKER: '0', DATABASE_URL: urlBanco.toString(), REDIS_URL: urlRedis,
      URL_PUBLICA: base, IP_CONFIAR_CF_SEMPRE: '1', ADMIN_EMAILS: EMAIL_ADMIN,
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

  // ------------------------------------------------------------ o elenco
  secao('O elenco');
  const adm = await criarConta(`adm${marca}`.slice(0, 16), IP_ADMIN);
  tokenAdmin = adm.token;
  await pool.query(`UPDATE accounts SET email = $1 WHERE lower(nick) = lower($2)`, [EMAIL_ADMIN, adm.nick]);
  const fazenda = [];
  for (let i = 0; i < 5; i++) fazenda.push(await criarConta(`faz${i}${marca}`.slice(0, 16), IP_FAZENDA));
  const inocente = await criarConta(`ino${marca}`.slice(0, 16), IP_INOCENTE);
  ok(fazenda.length === 5, 'cinco contas criadas no IP da fazenda, uma no IP inocente');

  const jogando = abrirJogo(IP_FAZENDA, fazenda[0]);
  ok(await ate(() => jogando.welcome, 20_000), 'uma conta da fazenda está jogando', jogando.erros.join(','));

  // ------------------------------------------------------------ o portão
  secao('O portão do painel');
  const naoAdmin = await req('/admin/multicontas/ip-ban/banir', {
    ip: IP_INOCENTE, metodo: 'POST', corpo: { token: inocente.token, ip: IP_FAZENDA },
  });
  ok(naoAdmin.status === 404, 'quem não é admin leva 404 (a rota nem "existe")', `${naoAdmin.status}`);
  const semToken = await req('/admin/multicontas/ip-ban/previa', { ip: IP_ADMIN, metodo: 'POST', corpo: { ip: IP_FAZENDA } });
  ok(semToken.status === 404, 'sem token, 404 também', `${semToken.status}`);

  // ------------------------------------------------------------ a prévia
  secao('A prévia');
  const previa = await painel('multicontas/ip-ban/previa', { ip: IP_FAZENDA });
  ok(previa.status === 200 && previa.json.ipBucket === IP_FAZENDA, 'a prévia devolve a chave do IP', previa.texto.slice(0, 200));
  ok(previa.json?.nascidas?.length === 5, 'e as cinco contas nascidas ali', `${previa.json?.nascidas?.length}`);
  ok(await ate(async () => (await painel('multicontas/ip-ban/previa', { ip: IP_FAZENDA })).json?.onlineAgora === 1, 5000),
    'e conta quem está on-line por ali agora');
  ok(previa.json?.ehMeuIp === false, 'e sabe que não é o IP do admin');
  const lixo = await painel('multicontas/ip-ban/previa', { ip: 'isso não é ip' });
  ok(lixo.status === 400, 'texto que não é IP é recusado', `${lixo.status} ${lixo.texto.slice(0, 120)}`);
  const v6 = await painel('multicontas/ip-ban/previa', { ip: '2804:14C:0001:0002:aaaa::5' });
  ok(v6.json?.ipBucket === '2804:14c:1:2::/64', 'IPv6 vira o bloco /64', v6.json?.ipBucket);
  const v6chave = await painel('multicontas/ip-ban/previa', { ip: '2804:14c:1:2::/64' });
  ok(v6chave.json?.ipBucket === '2804:14c:1:2::/64', 'e a própria chave /64 do painel também é aceita', v6chave.json?.ipBucket);

  // ------------------------------------------------------------ as travas
  secao('As travas');
  const meu = await painel('multicontas/ip-ban/previa', { ip: IP_ADMIN });
  ok(meu.json?.ehMeuIp === true, 'a prévia avisa quando o IP é o do próprio admin');
  const autoBan = await painel('multicontas/ip-ban/banir', { ip: IP_ADMIN });
  ok(autoBan.status === 400, 'e o servidor recusa banir o IP de quem clica', autoBan.texto.slice(0, 160));
  const forjado = await painel('multicontas/ip-ban/banir', { ip: IP_ADMIN, ipDoAdmin: '1.1.1.1' });
  ok(forjado.status === 400, 'mandar outro "ipDoAdmin" no corpo não desliga a trava');
  const contagem = await painel('multicontas/ip-ban/banir', { ip: IP_FAZENDA, banirContas: true, esperado: 3 });
  ok(contagem.status === 400 && /mudou/.test(contagem.json?.erro ?? ''),
    'se a contagem da prévia não bate, nada é banido', contagem.texto.slice(0, 160));
  ok((await pool.query(`SELECT 1 FROM origem_banida WHERE ip_bucket = $1`, [IP_FAZENDA])).rowCount === 0,
    'e o IP continua sem ban');

  // ------------------------------------------------------------ o ban
  secao('O ban');
  const ban = await painel('multicontas/ip-ban/banir', {
    ip: IP_FAZENDA, motivo: 'fazenda de contas (teste)', horas: 0, banirContas: true, esperado: 5,
  });
  ok(ban.status === 200, 'o IP foi banido', ban.texto.slice(0, 200));
  ok(ban.json?.contasBanidas?.length === 5, 'e as cinco contas nascidas ali levaram ban soft', JSON.stringify(ban.json?.contasBanidas));
  ok(ban.json?.expiraEm === null, 'sem prazo');

  ok(await ate(() => jogando.fechou != null, 5000), 'quem estava jogando caiu na hora');
  ok(jogando.fechou === 4003, 'com o código 4003 (o cliente não reconecta)', `${jogando.fechou}`);
  ok(jogando.erros.includes('auth.ipBanido'), 'e a mensagem dizendo por quê', jogando.erros.join(','));

  secao('Tudo fechado para a rede banida');
  const pagina = await req('/app', { ip: IP_FAZENDA, html: true });
  ok(pagina.status === 403 && /Acesso bloqueado/.test(pagina.texto), 'o jogo (/app) abre a página de bloqueio', `${pagina.status}`);
  const landing = await req('/', { ip: IP_FAZENDA, html: true });
  ok(landing.status === 403, 'a landing também', `${landing.status}`);
  const arquivo = await req('/app.js', { ip: IP_FAZENDA });
  ok(arquivo.status === 403, 'e os arquivos do jogo', `${arquivo.status}`);
  const cadastro = await req('/auth/criar', {
    ip: IP_FAZENDA, metodo: 'POST', corpo: { nick: `nov${marca}`.slice(0, 16), email: `nov${marca}@gmail.com`, senha: 'teste1234' },
  });
  ok(cadastro.status === 403 && cadastro.json?.erro === 'login.ipBanido', 'o CADASTRO é recusado', cadastro.texto.slice(0, 120));
  const login = await req('/auth/entrar', { ip: IP_FAZENDA, metodo: 'POST', corpo: { id: inocente.nick, senha: 'teste1234' } });
  ok(login.status === 403 && login.json?.erro === 'login.ipBanido', 'o LOGIN é recusado — até de conta que nasceu em outra rede', login.texto.slice(0, 120));
  const oauth = await req('/auth/google', { ip: IP_FAZENDA, html: true });
  ok(oauth.status === 403, 'o login pelo Google também', `${oauth.status}`);
  const ficha = await req('/auth/conta', { ip: IP_FAZENDA, metodo: 'POST', corpo: { token: inocente.token } });
  ok(ficha.status === 403, 'e a leitura da conta com um token válido', `${ficha.status}`);

  const denovo = abrirJogo(IP_FAZENDA, inocente);
  ok(await ate(() => denovo.fechou != null, 5000) && denovo.fechou === 4003 && !denovo.welcome,
    'o SOCKET do jogo é fechado mesmo com um token válido de outra rede', `${denovo.fechou} welcome=${denovo.welcome}`);
  const n0 = (await pool.query(`SELECT count(*)::int AS n FROM accounts`)).rows[0].n;
  ok(n0 === 7, 'nenhuma conta nova nasceu da rede banida', `${n0}`);

  secao('O resto do mundo continua entrando');
  ok((await req('/app', { ip: IP_INOCENTE, html: true })).status === 200, 'outra rede abre o jogo');
  const jogoInocente = abrirJogo(IP_INOCENTE, inocente);
  ok(await ate(() => jogoInocente.welcome, 20_000), 'e joga', jogoInocente.erros.join(','));
  jogoInocente.ws.close();

  secao('O painel continua abrindo — mesmo da rede banida');
  const painelDoBanido = await painel('multicontas/ip-ban/listar', {}, IP_FAZENDA);
  ok(painelDoBanido.status === 200, 'as rotas /admin/* não caem no ban', `${painelDoBanido.status}`);
  ok((await req('/admin', { ip: IP_FAZENDA, html: true })).status === 200, 'nem a página do painel');
  // A isenção do painel não pode virar porta: o caminho chega decodificado e é normalizado depois.
  for (const truque of ['/admin%2f..%2findex.html', '/admin/..%2findex.html', '/admin/%2e%2e/app.js', '/admin%5c..%5capp.js']) {
    const r = await req(truque, { ip: IP_FAZENDA, html: true });
    ok(r.status === 403 || r.status === 404, `"${truque}" não fura o ban pela isenção do painel`, `${r.status}`);
  }
  const naLista = painelDoBanido.json?.banidos?.find((b) => b.ipBucket === IP_FAZENDA);
  ok(naLista?.motivo === 'fazenda de contas (teste)' && naLista?.nascidas === 5, 'a lista mostra o ban, o motivo e as contas', JSON.stringify(naLista));
  ok((naLista?.bloqueios ?? 0) >= 1, 'e já contou tentativa barrada', `${naLista?.bloqueios}`);

  secao('As contas da fazenda seguem banidas em qualquer rede');
  const deFora = await req('/auth/entrar', { ip: IP_OUTRA_REDE, metodo: 'POST', corpo: { id: fazenda[1].nick, senha: 'teste1234' } });
  ok(deFora.status !== 200, 'login de uma conta da fazenda por outra rede é recusado', deFora.texto.slice(0, 160));
  const jogoDeFora = abrirJogo(IP_OUTRA_REDE, fazenda[1]);
  ok(await ate(() => jogoDeFora.erros.length > 0, 5000) && !jogoDeFora.welcome && jogoDeFora.erros.includes('auth.contaBanida'),
    'e o token que ela já tinha não abre o jogo', jogoDeFora.erros.join(','));
  jogoDeFora.ws.close();

  // ------------------------------------------------------------ IPv6
  secao('IPv6: o /64 inteiro, e só ele');
  const ban6 = await painel('multicontas/ip-ban/banir', { ip: '2804:14c:1:2::5', motivo: 'v6', banirContas: false });
  ok(ban6.status === 200 && ban6.json?.ipBucket === '2804:14c:1:2::/64', 'banir um endereço bane o bloco dele', ban6.texto.slice(0, 160));
  ok((await req('/app', { ip: '2804:14c:1:2:ffff:1:2:3', html: true })).status === 403, 'outro endereço do mesmo /64 é barrado');
  ok((await req('/app', { ip: '2804:14c:1:3::9', html: true })).status === 200, 'o /64 vizinho não');

  // ------------------------------------------------------------ prazo
  secao('O prazo');
  const ban24 = await painel('multicontas/ip-ban/banir', { ip: '8.8.4.4', motivo: 'prazo', horas: 24 });
  const faltaH = (new Date(ban24.json?.expiraEm).getTime() - Date.now()) / 3_600_000;
  ok(ban24.status === 200 && faltaH > 23.9 && faltaH <= 24, 'ban de 24 horas vence em 24 horas', `${faltaH.toFixed(2)} h`);
  ok((await req('/app', { ip: '8.8.4.4', html: true })).status === 403, 'e barra enquanto vale');
  // Vence: o prazo vai para o passado no banco, e o aviso do painel derruba o cache do gateway.
  await pool.query(`UPDATE origem_banida SET expira_em = now() - INTERVAL '1 second' WHERE ip_bucket = '8.8.4.4'`);
  await pub.publish('origens:ip-banido', JSON.stringify({ ipBucket: '8.8.4.4', banido: false }));
  ok(await ate(async () => (await req('/app', { ip: '8.8.4.4', html: true })).status === 200, 5000),
    'vencido, a rede volta sozinha');
  const vencido = (await painel('multicontas/ip-ban/listar', {})).json?.banidos?.find((b) => b.ipBucket === '8.8.4.4');
  ok(vencido?.vencido === true, 'e aparece como vencido na lista, para limpar');

  // ------------------------------------------------------------ desbanir
  secao('Desbanir');
  const tirar = await painel('multicontas/ip-ban/desbanir', { ipBucket: IP_FAZENDA });
  ok(tirar.status === 200, 'o ban sai', tirar.texto.slice(0, 120));
  ok(await ate(async () => (await req('/app', { ip: IP_FAZENDA, html: true })).status === 200, 5000), 'e a rede volta a abrir o jogo');
  const contaAinda = await req('/auth/entrar', { ip: IP_FAZENDA, metodo: 'POST', corpo: { id: fazenda[2].nick, senha: 'teste1234' } });
  ok(contaAinda.status !== 200, 'mas as contas banidas junto continuam banidas (desbanir é pela ficha)', `${contaAinda.status}`);
  const deNovo = await painel('multicontas/ip-ban/desbanir', { ipBucket: IP_FAZENDA });
  ok(deNovo.status === 400, 'desbanir o que não está banido é recusado');

  // ------------------------------------------------------------ endurecimento
  secao('O que não se bane, e o que entra limpo');
  for (const [ip, nome] of [
    ['127.0.0.1', 'loopback'], ['::1', 'loopback IPv6'], ['104.16.0.1', 'IP do Cloudflare'],
    ['2606:4700:10::1', 'bloco IPv6 do Cloudflare'], ['999.1', 'IPv4 malformado'], ['1:2:3', 'IPv6 malformado'],
  ]) {
    const p = await painel('multicontas/ip-ban/previa', { ip });
    const b = await painel('multicontas/ip-ban/banir', { ip });
    ok(p.status === 400 && b.status === 400, `${nome} (${ip}) é recusado na prévia e no ban`, `${p.status}/${b.status} ${b.json?.erro ?? ''}`);
  }
  const semEmail = await painel('multicontas/ip-ban/previa', { ip: IP_FAZENDA });
  ok(!/@/.test(semEmail.texto), 'a prévia não leva o e-mail das contas para o navegador');
  const quebra = await painel('multicontas/ip-ban/banir', { ip: '6.6.6.6', motivo: 'linha1\n[admin] linha forjada\r\x07', horas: 1 });
  const gravado = (await pool.query(`SELECT motivo FROM origem_banida WHERE ip_bucket = '6.6.6.6'`)).rows[0]?.motivo ?? '';
  ok(quebra.status === 200 && !/[\n\r\x07]/.test(gravado), 'quebra de linha e controle no motivo não chegam ao registro', JSON.stringify(gravado));
  const gigante = await painel('multicontas/ip-ban/banir', { ip: '6.6.6.7', horas: 1e12 });
  const anos = (new Date(gigante.json?.expiraEm).getTime() - Date.now()) / (365 * 24 * 3_600_000);
  ok(gigante.status === 200 && anos > 9.9 && anos <= 10.01, 'prazo absurdo vira o teto de dez anos, sem erro de banco', `${gigante.status} ${anos.toFixed(2)}`);

  // ------------------------------------------------------------ a régua
  secao('A régua do IP');
  ok(bucketDeIp('::ffff:5.6.7.8') === '5.6.7.8', 'IPv4 embrulhado em IPv6 cai no mesmo balde do IPv4');
  const embrulhado = await painel('multicontas/ip-ban/previa', { ip: '::ffff:5.6.7.8' });
  ok(embrulhado.json?.ipBucket === IP_FAZENDA, 'e o painel o trata como o mesmo IP', embrulhado.json?.ipBucket);
}

main()
  .catch((err) => {
    falhas++;
    console.error('\n✗ o teste explodiu:', err.message);
    console.error(logServidor.slice(-25).join('\n'));
  })
  .finally(async () => {
    await desmontar();
    console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
    process.exit(falhas ? 1 : 0);
  });
