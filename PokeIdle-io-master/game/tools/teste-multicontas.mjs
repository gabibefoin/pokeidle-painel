// O teto de contas por IP e a faxina de multi-conta, contra o Postgres de verdade.
//
// São as duas metades da mesma regra e elas têm de concordar: o painel bane o excedente, e o
// cadastro para de aceitar conta nova naquela rede. Se as duas contagens divergirem, o
// moderador faz a faxina e a fazenda renasce no minuto seguinte — que é exatamente o defeito
// que este arquivo existe para não deixar voltar.
//
// O que é coberto aqui e não dá para cobrir em memória:
//
//   · `evento = 'criar'` — quem só ENTROU pela rede não ocupa vaga (o caso do CGNAT), quem
//     nasceu nela ocupa, a BANIDA continua ocupando e a APAGADA não;
//   · a isenção (`origem_liberada`) devolvendo o cadastro mesmo com a rede cheia;
//   · a ordem de força do plano (nível → 💎 → gema → coin → conta mais velha);
//   · admin e já-banida fora do plano;
//   · a transferência ser SOMA ZERO nos dois ledgers — nada emitido, nada queimado;
//   · o `esperado` recusando um plano que envelheceu entre a prévia e o clique;
//   · a rota `/auth/criar` de verdade — cabeçalho de IP, a chave de erro que o jogador lê, e
//     a prova de que ela para ANTES de criar a conta.
//
// Cria as próprias contas (nick `_mc_teste_*`) e APAGA tudo no fim, ledgers inclusive.
// Precisa do Postgres de pé (o Redis é opcional — o aviso ao sim falha em silêncio):
//
//   docker compose up -d && node tools/teste-multicontas.mjs
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { pool } from '../src/server/db.mjs';
import * as odb from '../src/server/origens-db.mjs';
import * as admin from '../src/server/admin.mjs';
import { rotasDeAuth } from '../src/server/auth-rotas.mjs';
import { entrarComSenha, entrarComProvedor, hashSenha } from '../src/server/auth.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const PREFIXO = `_mc_teste_${Date.now().toString(36)}`;
const IP_A = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
const IP_B = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
const contas = [];
const players = [];

/** Uma conta + personagem + carimbo de origem, em uma chamada. */
async function criar(sufixo, {
  ip, evento = 'criar', level = 1, diamonds = 0, orbs = 0, gold = 0,
  email = null, provedor = 'local', provedorId = null, senhaHash = null,
} = {}) {
  const nick = `${PREFIXO}_${sufixo}`;
  const { rows: a } = await pool.query(
    `INSERT INTO accounts (nick, email, provedor, provedor_id, senha_hash, email_ok, ultimo_login)
     VALUES ($1, $2, $3, $4, $5, true, now()) RETURNING id`,
    [nick, email ?? `${nick}@exemplo.invalido`, provedor, provedorId, senhaHash],
  );
  const contaId = Number(a[0].id);
  contas.push(contaId);

  const { rows: p } = await pool.query(
    `INSERT INTO players (nick, level, gold, diamonds, orbs) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [nick, level, gold, diamonds, orbs],
  );
  const playerId = Number(p[0].id);
  players.push(playerId);

  await odb.registrarOrigem({ contaId, nick, evento, ip, ipBucket: ip, dispositivo: '' });
  return { contaId, playerId, nick };
}

const banir = (contaId, motivo) => pool.query(
  `INSERT INTO account_bans (account_id, motivo, por_email, soft) VALUES ($1, $2, 'teste', true)`,
  [contaId, motivo],
);

const somaLedger = async (tabela, playerIds) => {
  if (!playerIds.length) return 0;
  const { rows } = await pool.query(
    `SELECT coalesce(sum(delta), 0)::bigint AS n FROM ${tabela} WHERE player_id = ANY($1::bigint[])`,
    [playerIds],
  );
  return Number(rows[0].n);
};

async function limpar() {
  if (players.length) {
    await pool.query(`DELETE FROM orb_ledger WHERE player_id = ANY($1::bigint[])`, [players]);
    await pool.query(`DELETE FROM diamante_ledger WHERE player_id = ANY($1::bigint[])`, [players]);
    await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [players]);
  }
  if (contas.length) {
    await pool.query(`DELETE FROM account_bans WHERE account_id = ANY($1::bigint[])`, [contas]);
    await pool.query(`DELETE FROM conta_origens WHERE conta_id = ANY($1::bigint[])`, [contas]);
    await pool.query(`DELETE FROM accounts WHERE id = ANY($1::bigint[])`, [contas]);
  }
  // Rede de segurança: se um dia a ordem das travas mudar e a rota passar a criar a conta, a
  // linha some junto com o teste em vez de ficar no banco de desenvolvimento.
  await pool.query(`DELETE FROM accounts WHERE email = 'alguem.novo@gmail.com'`);
  await pool.query(`DELETE FROM origem_liberada WHERE ip_bucket = ANY($1::text[])`, [[IP_A, IP_B]]);
  await pool.query(`DELETE FROM origem_recusas WHERE ip_bucket = ANY($1::text[])`, [[IP_A, IP_B]]);
}

console.log('Multi-contas — teto por IP e faxina\n===================================');

try {
  await odb.migrar();

  // ------------------------------------------------------------- a contagem
  secao('Quem ocupa vaga na rede');

  const fortes = [];
  fortes.push(await criar('for1', { ip: IP_A, level: 300, diamonds: 120, orbs: 50, gold: 9000 }));
  fortes.push(await criar('for2', { ip: IP_A, level: 250, diamonds: 80, orbs: 40 }));
  fortes.push(await criar('for3', { ip: IP_A, level: 200, diamonds: 60, orbs: 30 }));
  fortes.push(await criar('for4', { ip: IP_A, level: 150, diamonds: 40, orbs: 20 }));

  ok(await odb.contasNascidasNoIp(IP_A) === 4, '4 contas nascidas na rede contam 4');

  const visitante = await criar('visita', { ip: IP_A, evento: 'entrar', level: 999, diamonds: 999 });
  ok(
    await odb.contasNascidasNoIp(IP_A) === 4,
    'quem só ENTROU pela rede não ocupa vaga (o caso do CGNAT)',
    `deu ${await odb.contasNascidasNoIp(IP_A)}`,
  );

  // -------------------------------------------------------- a busca por nick
  secao('Busca por nick no painel');

  const busca = await odb.multicontas({ nick: fortes[0].nick.toUpperCase() });
  const linhaA = busca.porIp.find((l) => l.chave === IP_A);
  ok(busca.alvo?.nick === fortes[0].nick, 'acha a conta pelo nick, sem diferenciar maiúsculas', JSON.stringify(busca.alvo));
  ok(
    !!linhaA && [...fortes.map((f) => f.nick), visitante.nick].every((n) => linhaA.nicks.includes(n)),
    'a origem dele traz todas as contas que passaram por ela, visitante incluído',
    JSON.stringify(linhaA?.nicks),
  );
  ok(
    busca.porIp.every((l) => l.chave === IP_A) && busca.porDispositivo.length === 0,
    'só aparecem as origens que ESTA conta usou',
    JSON.stringify(busca.porIp.map((l) => l.chave)),
  );
  const erroNick = await odb.multicontas({ nick: `${PREFIXO}_nao_existe` }).then(() => null, (e) => e.message);
  ok(/nenhuma conta com o nick/.test(erroNick ?? ''), 'nick que não existe vira erro legível', String(erroNick));
  const geral = await odb.multicontas({});
  ok(geral.alvo === null, 'sem nick, a listagem geral segue igual (sem alvo)');

  // ------------------------------------------------------------------ o teto
  secao('O teto de cadastro');

  let v = await odb.podeCriarNoIp(IP_A);
  ok(!v.pode && v.contas === 4 && v.limite === 4, 'a 5ª conta na rede cheia é recusada', JSON.stringify(v));
  ok((await odb.podeCriarNoIp(IP_B)).pode, 'rede vazia continua aceitando cadastro');
  ok((await odb.podeCriarNoIp(null)).pode, 'sem IP legível o cadastro PASSA (falha aberta)');
  ok((await odb.podeCriarNoIp('')).pode, 'IP vazio também passa');

  await odb.liberarIp({ ipBucket: IP_A, nota: 'CGNAT de teste', porEmail: 'teste@exemplo.invalido' });
  v = await odb.podeCriarNoIp(IP_A);
  ok(v.pode && v.liberado, 'a isenção devolve o cadastro à rede cheia');
  await odb.travarIp(IP_A);
  ok(!(await odb.podeCriarNoIp(IP_A)).pode, 'destravar devolve a rede ao teto');

  await odb.registrarRecusaDeIp(IP_A);
  await odb.registrarRecusaDeIp(IP_A);
  const teto = await odb.estadoDoTetoPorIp({ limite: 100 });
  const recusa = teto.recusas.find((r) => r.ipBucket === IP_A);
  ok(recusa?.vezes === 2, 'a recusa é contada por IP', JSON.stringify(recusa));
  ok(recusa?.nascidas === 4, 'o painel do teto mostra a MESMA contagem que o teto cobra');

  // A banida continua ocupando; se liberasse a vaga, quatro bans virariam quatro contas novas.
  await banir(fortes[3].contaId, 'teste');
  ok(await odb.contasNascidasNoIp(IP_A) === 4, 'conta BANIDA continua ocupando a vaga');
  await pool.query(`DELETE FROM account_bans WHERE account_id = $1`, [fortes[3].contaId]);

  // --------------------------------------------------------- a rota de cadastro
  //
  // A rota de verdade, sem servidor HTTP no meio: `rotasDeAuth` só precisa de um `req` que
  // seja um stream com cabeçalhos e de um `res` que aceite `writeHead`/`end`.
  //
  // NENHUM caso aqui chega a criar conta — e é de propósito. Com o Resend ligado no `.env`,
  // uma conta criada de verdade dispara e-mail para um endereço inventado, que é efeito no
  // mundo lá fora por causa de um teste. Os dois casos param antes: um no teto (é o que se
  // quer provar) e o outro no formato do e-mail, o que já prova que o teto DEIXOU passar.
  secao('A rota /auth/criar');

  const chamarCriar = async (ip, corpo) => {
    const req = Readable.from([JSON.stringify(corpo)]);
    req.method = 'POST';
    req.headers = { 'cf-connecting-ip': ip, 'content-type': 'application/json' };
    req.socket = { remoteAddress: ip };
    let codigo = 0;
    let texto = '';
    const res = {
      writeHead(c) { codigo = c; return res; },
      end(t) { texto = t ?? ''; },
    };
    await rotasDeAuth(req, res, new URL('http://x/auth/criar'));
    let corpoResp = {};
    try { corpoResp = JSON.parse(texto || '{}'); } catch {}
    return { codigo, ...corpoResp };
  };

  const naRedeCheia = await chamarCriar(IP_A, {
    nick: 'AlguemNovo', email: 'alguem.novo@gmail.com', senha: 'senhagrande123',
  });
  ok(
    naRedeCheia.codigo === 400 && naRedeCheia.erro === 'login.limiteContasIp',
    'a rota recusa a 5ª conta com a chave certa',
    JSON.stringify(naRedeCheia),
  );

  const { rows: naoCriou } = await pool.query(
    `SELECT count(*)::int AS n FROM accounts WHERE email = 'alguem.novo@gmail.com'`,
  );
  ok(naoCriou[0].n === 0, 'e não criou conta nenhuma (parou ANTES do cadastro)');

  const recusaNova = await odb.estadoDoTetoPorIp({ limite: 100 });
  ok(
    recusaNova.recusas.find((r) => r.ipBucket === IP_A)?.vezes === 3,
    'a rota contou a recusa (2 do teste + 1 desta)',
  );

  // Rede livre: o teto deixa passar e quem barra é o formato do e-mail, lá adiante. É o que
  // prova que a ordem está certa — o teto não é o primeiro a falar, o Turnstile é.
  const naRedeLivre = await chamarCriar(IP_B, {
    nick: 'AlguemNovo', email: 'nao-e-email', senha: 'senhagrande123',
  });
  ok(
    naRedeLivre.erro === 'login.emailInvalido',
    'na rede livre o teto deixa passar e o cadastro segue',
    JSON.stringify(naRedeLivre),
  );

  // ------------------------------------------------------------- o plano
  secao('O plano da faxina');

  const fracas = [];
  fracas.push(await criar('fra1', { ip: IP_A, level: 100, diamonds: 30, orbs: 10 }));
  fracas.push(await criar('fra2', { ip: IP_A, level: 50, diamonds: 20, orbs: 5 }));
  fracas.push(await criar('fra3', { ip: IP_A, level: 5, diamonds: 3, orbs: 1 }));

  const jaBanida = await criar('ban1', { ip: IP_A, level: 2, diamonds: 7, orbs: 7 });
  await banir(jaBanida.contaId, 'motivo anterior que não pode ser reescrito');

  let plano = await admin.planoDeFaxina({ tipo: 'ip', chave: IP_A });
  ok(plano.manter === 4, 'mantém 4 por padrão (o mesmo número do teto)');
  ok(plano.principal?.nick === visitante.nick, 'a mais forte recebe — mesmo tendo só ENTRADO na rede', plano.principal?.nick);
  ok(
    plano.mantidas.map((c) => c.nick).join(',') === [visitante, fortes[0], fortes[1], fortes[2]].map((c) => c.nick).join(','),
    'ficam as 4 mais fortes, em ordem de força',
    plano.mantidas.map((c) => `${c.nick}(${c.level})`).join(' '),
  );
  ok(
    plano.banir.map((c) => c.nick).join(',') === [fortes[3], ...fracas].map((c) => c.nick).join(','),
    'caem as mais fracas, da menos fraca para a mais fraca',
    plano.banir.map((c) => `${c.nick}(${c.level})`).join(' '),
  );
  ok(plano.jaBanidas.some((c) => c.nick === jaBanida.nick), 'conta já banida fica de fora do plano');
  ok(!plano.banir.some((c) => c.nick === jaBanida.nick), 'e não é rebanida');
  ok(
    plano.diamantes === 40 + 30 + 20 + 3 && plano.gemas === 20 + 10 + 5 + 1,
    'os totais a transferir batem com a soma das carteiras fracas',
    `${plano.diamantes} 💎 / ${plano.gemas} gemas`,
  );
  ok(
    plano.motivo === `Multi Account (4 max por IP) - Diamantes e gemas devolvidos para: ${visitante.nick}`,
    'o motivo do ban é exatamente o texto pedido',
    plano.motivo,
  );

  // ------------------------------------------------------------- a execução
  secao('A execução');

  const todosPlayers = [...players];
  const diaAntes = await somaLedger('diamante_ledger', todosPlayers);
  const orbAntes = await somaLedger('orb_ledger', todosPlayers);

  let recusou = null;
  try {
    await admin.faxinaDeMulticontas({
      email: 'teste@exemplo.invalido', tipo: 'ip', chave: IP_A, esperado: ['nick_que_nao_existe'],
    });
  } catch (err) {
    recusou = err.message;
  }
  ok(!!recusou, 'um plano que envelheceu entre a prévia e o clique é RECUSADO', recusou ?? 'passou');

  const r = await admin.faxinaDeMulticontas({
    email: 'teste@exemplo.invalido',
    tipo: 'ip',
    chave: IP_A,
    esperado: plano.banir.map((c) => c.nick),
  });
  ok(r.banidos.length === 4 && !r.falhas.length, '4 contas banidas, nenhuma falha', JSON.stringify(r.falhas));
  ok(r.diamantes === 93 && r.gemas === 36, 'moveu a carteira inteira', `${r.diamantes} 💎 / ${r.gemas} gemas`);

  const { rows: destino } = await pool.query(
    `SELECT diamonds, orbs FROM players WHERE id = $1`, [visitante.playerId],
  );
  ok(
    Number(destino[0].diamonds) === 999 + 93 && Number(destino[0].orbs) === 0 + 36,
    'a conta principal recebeu tudo',
    `${destino[0].diamonds} 💎 / ${destino[0].orbs} gemas`,
  );

  const { rows: vazias } = await pool.query(
    `SELECT count(*)::int AS n FROM players
      WHERE id = ANY($1::bigint[]) AND (diamonds <> 0 OR orbs <> 0)`,
    [plano.banir.map((c) => c.playerId ?? 0)],
  );
  ok(vazias[0].n === 0, 'as contas banidas ficaram com a carteira zerada');

  ok(
    await somaLedger('diamante_ledger', todosPlayers) === diaAntes,
    'o ledger de diamantes fecha em SOMA ZERO — nada emitido, nada queimado',
  );
  ok(
    await somaLedger('orb_ledger', todosPlayers) === orbAntes,
    'o ledger de gemas fecha em SOMA ZERO',
  );

  const { rows: bans } = await pool.query(
    `SELECT motivo, soft FROM account_bans WHERE account_id = ANY($1::bigint[])`,
    [plano.banir.map((c) => c.id)],
  );
  ok(bans.length === 4 && bans.every((b) => b.soft), 'todos os bans são SOFT (progresso intacto)');
  ok(bans.every((b) => b.motivo === plano.motivo), 'todos gravaram o motivo pedido');

  const { rows: anterior } = await pool.query(
    `SELECT motivo FROM account_bans WHERE account_id = $1`, [jaBanida.contaId],
  );
  ok(
    anterior[0]?.motivo === 'motivo anterior que não pode ser reescrito',
    'o motivo do ban que já existia NÃO foi reescrito',
    anterior[0]?.motivo,
  );

  plano = await admin.planoDeFaxina({ tipo: 'ip', chave: IP_A });
  ok(!plano.banir.length, 'depois da faxina o grupo está dentro do limite');

  let semNada = null;
  try {
    await admin.faxinaDeMulticontas({ email: 'teste@exemplo.invalido', tipo: 'ip', chave: IP_A });
  } catch (err) {
    semNada = err.message;
  }
  ok(!!semNada, 'rodar de novo não faz nada e avisa', semNada ?? 'passou em silêncio');

  // A regra fecha o ciclo: as banidas continuam ocupando vaga, então a rede segue trancada.
  ok(!(await odb.podeCriarNoIp(IP_A)).pode, 'depois da faxina a rede continua sem vaga para a 5ª conta');

  // ------------------------------------------------- o motivo chega ao jogador
  //
  // O ban grava um motivo, e durante muito tempo ele morria no banco: as três portas de
  // entrada (senha, Google, Discord) respondiam só `login.contaBanida`, e quem tomou o ban
  // lia "Conta banida — você não pode entrar no jogo." sem saber por quê nem para onde foi a
  // moeda dele. Cada caso abaixo é uma dessas portas.
  secao('O motivo do ban chega ao jogador');

  const MOTIVO_ESPERADO = `Multi Account (4 max por IP) - Diamantes e gemas devolvidos para: ${visitante.nick}`;

  // ---- porta 1: senha
  //
  // As contas que a faxina baniu não têm senha (nasceram direto no banco), e `entrarComSenha`
  // pararia em "credencial inválida" antes de chegar ao ban. Então vai uma conta com senha de
  // verdade, banida com o MESMO texto — o que se quer medir é o caminho do motivo, e não como
  // a linha do ban foi parar lá.
  const comSenha = await criar('senha', {
    ip: IP_B, level: 1, email: `${PREFIXO}_senha@gmail.com`,
    senhaHash: await hashSenha('senhagrande123'),
  });
  await banir(comSenha.contaId, MOTIVO_ESPERADO);

  let erroSenha = null;
  try {
    await entrarComSenha({ id: comSenha.nick, senha: 'senhagrande123' });
  } catch (err) {
    erroSenha = err;
  }
  ok(erroSenha?.chave === 'login.contaBanida', 'login com senha recusa a conta banida');
  ok(
    erroSenha?.extra?.motivoBan === MOTIVO_ESPERADO,
    'e o erro carrega o motivo escrito pela moderação',
    JSON.stringify(erroSenha?.extra),
  );

  const respostaSenha = await (async () => {
    const req = Readable.from([JSON.stringify({ id: comSenha.nick, senha: 'senhagrande123' })]);
    req.method = 'POST';
    req.headers = { 'cf-connecting-ip': IP_B, 'content-type': 'application/json' };
    req.socket = { remoteAddress: IP_B };
    let codigo = 0;
    let texto = '';
    const res = { writeHead(c) { codigo = c; return res; }, end(t) { texto = t ?? ''; } };
    await rotasDeAuth(req, res, new URL('http://x/auth/entrar'));
    return { codigo, ...JSON.parse(texto || '{}') };
  })();
  ok(
    respostaSenha.erro === 'login.contaBanida' && respostaSenha.motivoBan === MOTIVO_ESPERADO,
    'a rota /auth/entrar devolve o motivo no corpo',
    JSON.stringify(respostaSenha),
  );

  // ---- porta 2: Google / Discord, direto na função que decide
  const porProvedor = await criar('goog', {
    ip: IP_B, level: 1, email: `${PREFIXO}_goog@gmail.com`,
    provedor: 'google', provedorId: `${PREFIXO}-sub-1`,
  });
  await banir(porProvedor.contaId, MOTIVO_ESPERADO);

  let erroProv = null;
  try {
    await entrarComProvedor({
      provedor: 'google', provedorId: `${PREFIXO}-sub-1`,
      email: `${PREFIXO}_goog@gmail.com`, emailConfirmado: true, nomeSugerido: 'x',
    });
  } catch (err) {
    erroProv = err;
  }
  ok(erroProv?.chave === 'login.contaBanida', 'login por provedor recusa a conta banida');
  ok(
    erroProv?.extra?.motivoBan === MOTIVO_ESPERADO,
    'e também carrega o motivo (era isto que voltava vazio pelo Google)',
    JSON.stringify(erroProv?.extra),
  );

  // ---- porta 2b: o retorno do OAuth de verdade, com o `fetch` do provedor dublado
  //
  // É o trecho que o teste da função acima NÃO cobre: o OAuth não responde JSON, ele
  // REDIRECIONA — e o motivo tem de sobreviver à volta pela query da URL.
  const fetchReal = globalThis.fetch;
  let destinoOAuth = '';
  try {
    globalThis.fetch = async (u) => ({
      json: async () => (String(u).includes('token')
        ? { access_token: 'fake' }
        : { sub: `${PREFIXO}-sub-1`, email: `${PREFIXO}_goog@gmail.com`, email_verified: true, given_name: 'x' }),
    });
    const corpoState = Buffer
      .from(JSON.stringify({ provedor: 'google', dispositivo: null, exp: Date.now() + 600_000 }))
      .toString('base64url');
    const mac = createHmac('sha256', process.env.AUTH_SEGREDO ?? 'dev').update(corpoState).digest('base64url');

    const req = Readable.from(['']);
    req.method = 'GET';
    req.headers = { 'cf-connecting-ip': IP_B };
    req.socket = { remoteAddress: IP_B };
    const res = {
      writeHead(_c, h) { destinoOAuth = h?.location ?? ''; return res; },
      end() {},
    };
    await rotasDeAuth(
      req, res,
      new URL(`http://x/auth/google/retorno?code=abc&state=${encodeURIComponent(`${corpoState}.${mac}`)}`),
    );
  } finally {
    globalThis.fetch = fetchReal;
  }
  ok(destinoOAuth.includes('erroAuth=login.contaBanida'), 'a volta do Google redireciona com o erro de ban', destinoOAuth);
  const daUrl = new URL(destinoOAuth, 'http://x').searchParams.get('motivoBan');
  ok(daUrl === MOTIVO_ESPERADO, 'e leva o motivo na query, inteiro', String(daUrl));

  // ---- porta 3: o socket, para quem já estava dentro
  //
  // `fracas[0]` (e não `plano.banir[0]`): o `plano` foi recalculado depois da faxina e a lista
  // de banir está vazia agora — que é justamente o que o teste acima provou.
  const banSalvo = await admin.banDaConta(fracas[0].contaId);
  ok(banSalvo?.motivo === MOTIVO_ESPERADO, 'o gateway tem de onde tirar o motivo no reconnect');
  ok(banSalvo?.soft === true, 'e sabe que o ban é soft');
} catch (err) {
  falhas++;
  console.log(`\n  ✗ erro no meio do teste: ${err.stack}`);
} finally {
  await limpar().catch((err) => console.log(`  ! limpeza falhou: ${err.message}`));
  await pool.end();
}

console.log('\n==============================================');
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} passaram`);
process.exit(falhas ? 1 : 0);
