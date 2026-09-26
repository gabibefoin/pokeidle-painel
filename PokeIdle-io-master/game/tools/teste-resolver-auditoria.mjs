// O cargo Resolver Auditoria: o que ele alcança, o que ele NÃO alcança, e a tag que ele usa.
//
// O cargo nasceu pequeno (item perdido em ticket) e hoje enxerga quinze abas do painel. Isso o
// põe a uma linha de distância do caixa do jogo, e é essa linha que este arquivo vigia. Três
// perguntas, nessa ordem de importância:
//
//   · **o que ficou de fora ficou mesmo de fora?** Tesouraria, Custos e Ganhos, Diamantes,
//     Contagem online, Notas e MED têm de devolver 404 para ele — 404, e não 403, porque um 403
//     conta que a rota existe. É o teste que impede a aba dezesseis de vazar sem ninguém notar.
//   · **o que entrou funciona de ponta a ponta?** Não basta a aba aparecer: `secoesDoPainel`
//     esconde, mas quem tranca é `sessaoPainel`. Uma aba visível com rota fechada é um painel
//     que dá erro no clique.
//   · **a tag [Admin] aparece no jogo?** Quem entra em `AUDITORIA_RESOLVER_EMAILS` continuava
//     no chat com a tag velha de [Moderador], porque o gateway perguntava `ehAdmin` e ouvia não.
//
// E, de brinde, o escudo novo: nenhuma conta com cargo de painel cai por clique de dentro do
// painel — nem a de um colega, nem a do dono.
//
// Servidor de verdade, com banco e Redis PRÓPRIOS: o banco é uma cópia do SCHEMA do banco de
// dev (nada de dado) e é apagado no fim. O banco de dev não é tocado.
//
//   docker compose up -d && node tools/teste-resolver-auditoria.mjs
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import Redis from 'ioredis';
import WebSocket from 'ws';
import { config } from '../src/server/config.mjs';

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
const nomeBanco = `pokeidle_teste_resolver_${marca}`;
const urlBanco = new URL(config.databaseUrl);
urlBanco.pathname = `/${nomeBanco}`;
const nomeRedis = `pokeidle-teste-resolver-${marca}`;
const portaRedis = await portaLivre();
const urlRedis = `redis://127.0.0.1:${portaRedis}`;
const porta = await portaLivre();
const base = `http://127.0.0.1:${porta}`;

const IP = '10.0.0.1';
// Os dois cargos com e-mails DIFERENTES — é o ponto do teste. Com o mesmo endereço nas duas
// variáveis (o caso do `.env` de dev) o admin completo ganha e nada aqui provaria coisa alguma.
const EMAIL_ADMIN = `adm${marca}@gmail.com`;
const EMAIL_RESOLVER = `res${marca}@gmail.com`;
const EMAIL_RESOLVER2 = `re2${marca}@gmail.com`;
// Um nick que não existe: o corpo inválido faz a rota parar na validação (400) em vez de fazer
// alguma coisa, e 400 já prova o que interessa — que o PORTÃO deixou passar.
const FANTASMA = `__ninguem_${marca}`;

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

async function req(caminho, { metodo = 'GET', corpo } = {}) {
  const headers = { 'cf-connecting-ip': IP };
  if (corpo) headers['content-type'] = 'application/json';
  const r = await fetch(`${base}${caminho}`, {
    method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* página */ }
  return { status: r.status, texto, json };
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

/** Abre o socket, manda o `hello` e devolve o `welcome` — é dele que sai a tag do chat. */
function abrirJogo(sessao) {
  const s = { welcome: null, erros: [], fechou: null };
  s.ws = new WebSocket(`ws://127.0.0.1:${porta}/`, { headers: { 'cf-connecting-ip': IP } });
  s.ws.on('open', () => s.ws.send(JSON.stringify({ t: 'hello', nick: sessao.nick, token: sessao.token })));
  s.ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.t === 'welcome') s.welcome = m;
    if (m.t === 'erro') s.erros.push(m.chave ?? m.msg);
  });
  s.ws.on('close', (codigo) => { s.fechou = codigo; });
  s.ws.on('error', () => {});
  return s;
}

// ---------------------------------------------------------------- o mapa das rotas
//
// Uma linha por rota, agrupada pela aba que a usa. Os corpos são de propósito inválidos ou
// vazios: o que se mede aqui é o PORTÃO, não a regra de negócio. Passou pelo portão = qualquer
// coisa menos 404.

/** As quinze abas do cargo Resolver Auditoria, e as rotas de cada uma. */
const PERMITIDAS = [
  ['Ficha do jogador', [['usuarios/ficha', { nick: FANTASMA }]]],
  ['Auditoria', [['usuarios/auditoria', { nick: FANTASMA }]]],
  ['Aprovação saques', [
    ['gemas/saques/pendentes', {}],
    ['gemas/saques/aprovar', { id: -1 }],
    ['gemas/saques/rejeitar', { id: -1 }],
  ]],
  ['Resolver Auditoria', [
    ['resolver-auditoria/catalogo', {}],
    ['resolver-auditoria/historico', {}],
    ['resolver-auditoria/entregar', { nick: FANTASMA, itemId: 0, qtd: 1 }],
  ]],
  ['Usuários', [
    ['usuarios/listar', {}],
    ['usuarios/banir', { nick: FANTASMA, motivo: 'teste' }],
    ['usuarios/banir-soft', { nick: FANTASMA, motivo: 'teste' }],
    ['usuarios/desbanir', { nick: FANTASMA }],
    ['usuarios/apagar', { nick: FANTASMA }],
    ['usuarios/coins', { nick: FANTASMA, gold: 1 }],
    ['usuarios/email', { nick: FANTASMA, novoEmail: 'x@gmail.com' }],
  ]],
  ['Referrals', [['referrals/listar', {}]]],
  ['Referral Especial', [
    ['referral-especial/listar', {}],
    ['referral-especial/definir', { nick: FANTASMA }],
    ['referral-especial/remover', { nick: FANTASMA }],
  ]],
  ['Convites Discord', [['convites/listar', {}]]],
  ['Eventos', [
    ['eventos/estado', {}],
    ['eventos/criar', { minutos: -1 }],
    ['eventos/agenda/criar', {}],
    ['eventos/agenda/remover', { id: -1 }],
    ['eventos/agenda/alternar', { id: -1 }],
    ['eventos/encerrar', {}],
  ]],
  ['Multi-contas', [
    ['multicontas/listar', {}],
    ['multicontas/teto', { limite: 5 }],
    ['multicontas/plano', { tipo: 'ip', chave: '' }],
    ['multicontas/faxina', { tipo: 'ip', chave: '', esperado: null }],
    ['multicontas/plano-geral', {}],
    ['multicontas/faxina-geral', { esperado: null }],
    ['multicontas/liberar-ip', { ipBucket: '' }],
    ['multicontas/ip-ban/previa', { ip: '' }],
    ['multicontas/ip-ban/banir', { ip: '' }],
    ['multicontas/ip-ban/desbanir', { ipBucket: '' }],
    ['multicontas/ip-ban/listar', {}],
  ]],
  ['Guilds', [
    ['guilds/listar', {}],
    ['guilds/apagar', { id: -1 }],
  ]],
  ['Histórico gemas', [
    ['gemas/depositos/listar', {}],
    ['gemas/saques/listar', {}],
  ]],
  ['Tags do chat', [
    ['cargos/definir', { nick: FANTASMA, cargo: 'moderador' }],
    ['cargos/remover', { nick: FANTASMA }],
  ]],
  ['Usuários mutados', [
    ['chat/mutes/listar', {}],
    ['chat/mutes/revogar', { nick: FANTASMA }],
  ]],
  ['Enviar emails', [
    ['emails/enviar', { para: '', assunto: '', mensagem: '' }],
    ['emails/enviados/listar', { limite: 5 }],
    ['emails/enviados/detalhe', { id: -1 }],
    ['emails/recebidos/listar', { limite: 5 }],
    ['emails/recebidos/detalhe', { id: -1 }],
    ['emails/recebidos/responder', { id: -1 }],
  ]],
];

/** As seis abas que ficaram só para `ADMIN_EMAILS` — dinheiro e papel da empresa. */
const NEGADAS = [
  ['Tesouraria', [
    ['colher', { carteira: '', usdt: 1 }],
    ['gemas/varredura', {}],
  ]],
  ['Custos e Ganhos', [
    ['financeiro/resumo', {}],
    ['financeiro/config', {}],
    ['financeiro/custos/salvar', {}],
    ['financeiro/custos/remover', { id: -1 }],
  ]],
  ['Diamantes', [['diamantes/historico', {}]]],
  ['Contagem online', [
    ['online-contagem/estado', {}],
    ['online-contagem/adicionar', { qtd: 1 }],
    ['online-contagem/remover', { id: -1 }],
    ['online-contagem/remover-tudo', {}],
  ]],
  ['Emissão de Notas', [
    ['notas/listar', {}],
    ['notas/exportar', { mes: '2026-01', formato: 'csv' }],
  ]],
  // Só `med/historico`: é a única rota de MED que serve de sonda. As outras devolvem 404
  // quando o jogador não existe (`ErroMed(..., 404)`), e aí o 404 deixa de significar "o
  // portão te barrou" — que é a única coisa que este arquivo mede.
  ['Documentos para MED', [['med/historico', {}]]],
];

const todasAsRotas = (grupos) => grupos.flatMap(([aba, rotas]) => rotas.map(([r, c]) => [aba, r, c]));

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
  const contas = {};
  for (const [papel, email] of [
    ['adm', EMAIL_ADMIN], ['res', EMAIL_RESOLVER], ['re2', EMAIL_RESOLVER2], ['zeh', null],
  ]) {
    const c = await criarConta(`${papel}${marca}`.slice(0, 16));
    if (email) await pool.query(`UPDATE accounts SET email = $1 WHERE lower(nick) = lower($2)`, [email, c.nick]);
    contas[papel] = c;
  }
  ok(Object.keys(contas).length === 4, 'admin, dois resolvedores e um jogador comum');

  // ------------------------------------------------------------ o portão
  secao('O portão do painel');
  const p = {
    adm: await painel('painel', contas.adm.token),
    res: await painel('painel', contas.res.token),
    zeh: await painel('painel', contas.zeh.token),
    semToken: await painel('painel', undefined),
  };
  ok(p.adm.status === 200 && p.adm.json?.adminCompleto === true, 'o admin abre o painel como completo');
  ok(p.res.status === 200, 'o resolvedor abre o painel', `${p.res.status}`);
  ok(p.res.json?.adminCompleto === false, 'e o painel sabe que ele NÃO é admin completo');
  ok(p.res.json?.podeResolverAuditoria === true, 'e que ele é do cargo Resolver Auditoria');
  ok(p.res.json?.podeDocumentosMed === false, 'e que ele não emite documento para MED');
  ok(p.zeh.status === 404, 'o jogador comum leva 404 (a rota nem "existe")', `${p.zeh.status}`);
  ok(p.semToken.status === 404, 'sem token, 404 também', `${p.semToken.status}`);

  // ------------------------------------------------------------ as quinze abas
  secao('As quinze abas que o cargo alcança');
  for (const [aba, rotas] of PERMITIDAS) {
    const passaram = [];
    for (const [rota, corpo] of rotas) {
      const r = await painel(rota, contas.res.token, corpo);
      if (r.status !== 404) passaram.push(rota);
      else console.log(`      ↳ ${rota} devolveu 404`);
    }
    ok(passaram.length === rotas.length, `${aba} — ${rotas.length} rota(s) abertas ao cargo`,
      `${passaram.length}/${rotas.length}`);
  }

  // ------------------------------------------------------------ as seis que ficaram de fora
  secao('As seis abas que ficaram só para o admin');
  for (const [aba, rotas] of NEGADAS) {
    const fechadas = [];
    for (const [rota, corpo] of rotas) {
      const r = await painel(rota, contas.res.token, corpo);
      if (r.status === 404) fechadas.push(rota);
      else console.log(`      ↳ ${rota} DEIXOU o cargo passar (${r.status})`);
    }
    ok(fechadas.length === rotas.length, `${aba} — 404 para o cargo`, `${fechadas.length}/${rotas.length}`);
  }

  secao('E o admin completo continua alcançando as seis');
  for (const [aba, rotas] of NEGADAS) {
    const abertas = [];
    for (const [rota, corpo] of rotas) {
      const r = await painel(rota, contas.adm.token, corpo);
      if (r.status !== 404) abertas.push(rota);
      else console.log(`      ↳ ${rota} fechou para o PRÓPRIO admin (${r.status})`);
    }
    ok(abertas.length === rotas.length, `${aba} — segue aberta ao admin`, `${abertas.length}/${rotas.length}`);
  }

  secao('E o jogador comum não alcança nada');
  const tudo = [...todasAsRotas(PERMITIDAS), ...todasAsRotas(NEGADAS)];
  const vazou = [];
  for (const [, rota, corpo] of tudo) {
    const r = await painel(rota, contas.zeh.token, corpo);
    if (r.status !== 404) vazou.push(`${rota} (${r.status})`);
  }
  ok(vazou.length === 0, `as ${tudo.length} rotas do painel devolvem 404 para quem não tem cargo`, vazou.join(', '));

  // ------------------------------------------------------------ a tag do chat
  //
  // O caso real: a pessoa já tinha [Moderador] do painel quando o e-mail entrou na variável.
  // A tag do cargo tem de passar na frente — e passa porque `ws.admin` apaga o `chatCargo`.
  secao('A tag [Admin] dentro do jogo');
  const primeiraEntrada = abrirJogo(contas.res);
  ok(await ate(() => primeiraEntrada.welcome, 20_000), 'o resolvedor entra no jogo', primeiraEntrada.erros.join(','));
  primeiraEntrada.ws.close();
  await espera(500);

  const deuCargo = await painel('cargos/definir', contas.adm.token, { nick: contas.res.nick, cargo: 'moderador' });
  ok(deuCargo.status === 200, 'o admin dá a tag [Moderador] a ele pelo painel', deuCargo.texto.slice(0, 120));

  const resolvedor = abrirJogo(contas.res);
  ok(await ate(() => resolvedor.welcome, 20_000), 'e ele reconecta', resolvedor.erros.join(','));
  ok(resolvedor.welcome?.admin === true,
    'o welcome carimba admin=true — a tag vermelha, não a de [Moderador]', JSON.stringify(resolvedor.welcome?.admin));
  ok(resolvedor.welcome?.chatMod === true, 'e ele modera o chat');
  ok(resolvedor.welcome?.chatCmd === true, 'e usa os comandos de barra');

  const comum = abrirJogo(contas.zeh);
  ok(await ate(() => comum.welcome, 20_000), 'o jogador comum entra', comum.erros.join(','));
  ok(comum.welcome?.admin === false, 'e NÃO leva a tag de admin de carona');
  ok(comum.welcome?.chatMod === false, 'nem modera o chat');
  resolvedor.ws.close();
  comum.ws.close();

  // ------------------------------------------------------------ o escudo
  //
  // O cargo ganhou a aba Usuários e a Multi-contas. Sem escudo, um resolvedor bania o outro —
  // e a faxina geral derrubaria a conta de um colega junto com um aglomerado.
  secao('Nenhuma conta com cargo cai por clique do painel');
  const alvos = [
    ['a do admin', contas.adm.nick],
    ['a do outro resolvedor', contas.re2.nick],
    ['a dele mesmo', contas.res.nick],
  ];
  for (const [quem, nick] of alvos) {
    const ban = await painel('usuarios/banir-soft', contas.res.token, { nick, motivo: 'teste' });
    ok(ban.status === 400 && /cargo no painel|própria conta/.test(ban.json?.erro ?? ''),
      `o resolvedor não bane ${quem}`, `${ban.status} ${ban.json?.erro ?? ban.texto.slice(0, 80)}`);
    const apagar = await painel('usuarios/apagar', contas.res.token, { nick });
    ok(apagar.status === 400 && /cargo no painel|própria conta/.test(apagar.json?.erro ?? ''),
      `nem apaga ${quem}`, `${apagar.status} ${apagar.json?.erro ?? apagar.texto.slice(0, 80)}`);
  }
  const banComum = await painel('usuarios/banir-soft', contas.res.token, { nick: contas.zeh.nick, motivo: 'teste' });
  ok(banComum.status === 200, 'mas bane um jogador comum — o escudo é só para quem tem cargo',
    `${banComum.status} ${banComum.texto.slice(0, 120)}`);
  await painel('usuarios/desbanir', contas.res.token, { nick: contas.zeh.nick });
}

try {
  await main();
} catch (err) {
  falhas++;
  console.error('\nerro fatal:', err.message);
  if (logServidor.length) console.error(logServidor.slice(-25).join('\n'));
} finally {
  await desmontar();
}

console.log(`\n${falhas ? `✗ ${falhas} de ${testes} falharam` : `✓ ${testes}/${testes} testes passaram`}`);
process.exit(falhas ? 1 : 0);
