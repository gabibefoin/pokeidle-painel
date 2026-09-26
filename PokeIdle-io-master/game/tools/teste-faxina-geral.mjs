// A FAXINA GERAL de multi-conta — a faxina de linha, para todos os IPs fora da whitelist.
//
// Só com Postgres e Redis (npm run infra). Monta IPs sintéticos com um prefixo próprio, e é por
// ele que a prévia e a execução ficam presas a este teste — o resto do banco não entra. O que ele
// protege:
//
//   · **quem entra**: só IP acima do teto e fora da whitelist; aparelho não entra;
//   · **a ordem da leva**: uma conta que cai num IP já não conta no seguinte — a prévia desconta,
//     e a execução bate com ela;
//   · **o que a faxina de linha já garante, agora em lote**: ban soft no excedente, carteira para a
//     principal, conta já banida intocada;
//   · **o que é pulado sem parar os outros**: IP que entrou na whitelist depois da prévia, grupo que
//     mudou, IP sem conta principal com personagem.
//
//   node tools/teste-faxina-geral.mjs
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { conectarBus, pub } from '../src/server/bus.mjs';
import { planoDeFaxinaGeral, faxinaGeral } from '../src/server/admin.mjs';
import { xpTotalParaNivel } from '../src/server/content.mjs';
import { maxContasPorIp } from '../src/server/origens-db.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const MARCA = Date.now().toString(36).slice(-5);
const PREFIXO = `198.18.${Math.floor(Math.random() * 200) + 20}.`;
const IP = (n) => `${PREFIXO}${n}`;
const LIMITE = maxContasPorIp() || 4;
const contas = [];

/** Uma conta com personagem (ou sem, `semPlayer`), nível e carteira, carimbada nos IPs pedidos. */
async function conta(sufixo, { nivel = 50, diamantes = 0, gemas = 0, ips = [], semPlayer = false, banida = false }) {
  const nick = `fx${MARCA}${sufixo}`;
  const { rows } = await pool.query(
    `INSERT INTO accounts (nick, email, provedor, email_ok) VALUES ($1, $2, 'local', true) RETURNING id`,
    [nick, `${nick}@test.local`],
  );
  const id = Number(rows[0].id);
  let playerId = null;
  if (!semPlayer) {
    const { rows: p } = await pool.query(
      `INSERT INTO players (nick, level, xp, diamonds, orbs, visual_ok) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [nick, nivel, xpTotalParaNivel(nivel), diamantes, gemas],
    );
    playerId = Number(p[0].id);
  }
  for (const ip of ips) {
    await pool.query(
      `INSERT INTO conta_origens (conta_id, nick, evento, ip, ip_bucket, dispositivo) VALUES ($1, $2, 'criar', $3, $3, $4)`,
      [id, nick, ip, `disp-${nick}`],
    );
  }
  if (banida) {
    await pool.query(`INSERT INTO account_bans (account_id, motivo, por_email, soft) VALUES ($1, 'ban antigo de teste', 'teste', false)`, [id]);
  }
  const c = { id, playerId, nick };
  contas.push(c);
  return c;
}

const carteira = async (c) => {
  const { rows } = await pool.query(`SELECT diamonds, orbs FROM players WHERE id = $1`, [c.playerId]);
  return { diamantes: Number(rows[0].diamonds), gemas: Number(rows[0].orbs) };
};
const ban = async (c) => {
  const { rows } = await pool.query(`SELECT motivo, soft FROM account_bans WHERE account_id = $1`, [c.id]);
  return rows[0] ?? null;
};

async function limpar() {
  const ids = contas.map((c) => c.id);
  await pool.query(`DELETE FROM origem_liberada WHERE ip_bucket LIKE $1`, [`${PREFIXO}%`]).catch(() => {});
  await pool.query(`DELETE FROM conta_origens WHERE conta_id = ANY($1::bigint[])`, [ids]).catch(() => {});
  await pool.query(`DELETE FROM account_bans WHERE account_id = ANY($1::bigint[])`, [ids]).catch(() => {});
  await pool.query(`DELETE FROM players WHERE lower(nick) = ANY($1::text[])`, [contas.map((c) => c.nick.toLowerCase())]).catch(() => {});
  await pool.query(`DELETE FROM accounts WHERE id = ANY($1::bigint[])`, [ids]).catch(() => {});
}

console.log(`FAXINA GERAL (IPs ${PREFIXO}*, limite ${LIMITE})\n${'='.repeat(40)}`);
try {
  await conectarBus();

  // IP 1: seis contas. Ficam as quatro de maior nível; a1 recebe a carteira de a5 e a6.
  const a = [];
  for (let i = 1; i <= 6; i++) {
    a.push(await conta(`a${i}`, { nivel: 400 - i * 10, diamantes: i * 10, gemas: i, ips: [IP(1)] }));
  }
  // IP 2: três contas próprias + a5 e a6, que caem no IP 1. Depois da leva, o IP 2 tem 3 de pé.
  for (let i = 1; i <= 3; i++) await conta(`b${i}`, { nivel: 300, ips: [IP(2)] });
  await pool.query(
    `INSERT INTO conta_origens (conta_id, nick, evento, ip, ip_bucket, dispositivo)
     SELECT id, nick, 'entrar', $1, $1, 'x' FROM accounts WHERE id = ANY($2::bigint[])`,
    [IP(2), [a[4].id, a[5].id]],
  );
  // IP 3: sete contas, mas na WHITELIST.
  for (let i = 1; i <= 7; i++) await conta(`c${i}`, { nivel: 100, ips: [IP(3)] });
  await pool.query(`INSERT INTO origem_liberada (ip_bucket, nota, por_email) VALUES ($1, 'teste', 'teste')`, [IP(3)]);
  // IP 4: seis contas, uma já banida (ban hard antigo) — de pé são cinco, cai uma.
  const d = [];
  for (let i = 1; i <= 6; i++) d.push(await conta(`d${i}`, { nivel: 200 - i, diamantes: 5, ips: [IP(4)], banida: i === 1 }));
  // IP 5: cinco contas sem personagem — não há para onde mandar a moeda.
  for (let i = 1; i <= 5; i++) await conta(`e${i}`, { ips: [IP(5)], semPlayer: true });
  // IP 6: cinco contas; vai entrar na whitelist DEPOIS da prévia.
  for (let i = 1; i <= 5; i++) await conta(`f${i}`, { nivel: 90 - i, ips: [IP(6)] });
  // IP 7: cinco contas; vai ganhar uma conta forte DEPOIS da prévia.
  const g = [];
  for (let i = 1; i <= 5; i++) g.push(await conta(`g${i}`, { nivel: 80 - i, ips: [IP(7)] }));
  // IP 8: quatro contas — dentro do limite.
  for (let i = 1; i <= 4; i++) await conta(`h${i}`, { nivel: 70, ips: [IP(8)] });
  // Um aparelho com seis contas (e IPs diferentes): aparelho não entra na faxina geral.
  for (let i = 1; i <= 6; i++) {
    const c = await conta(`k${i}`, { nivel: 60, ips: [] });
    await pool.query(
      `INSERT INTO conta_origens (conta_id, nick, evento, ip, ip_bucket, dispositivo) VALUES ($1, $2, 'criar', $3, $3, $4)`,
      [c.id, c.nick, IP(100 + i), `disp-compartilhado-${MARCA}`],
    );
  }

  secao('A prévia');
  const p = await planoDeFaxinaGeral({ prefixo: PREFIXO });
  const chaves = p.grupos.map((x) => x.chave);
  ok(JSON.stringify(chaves) === JSON.stringify([IP(1), IP(4), IP(5), IP(6), IP(7)]),
    'entram só os IPs acima do teto e fora da whitelist, do maior para o menor', JSON.stringify(chaves));
  ok(!chaves.includes(IP(2)), 'o IP 2 some: as duas contas que o passavam do teto já caem no IP 1');
  ok(!chaves.includes(IP(3)), 'o IP na whitelist não entra');
  ok(!chaves.includes(IP(8)), 'o IP dentro do limite não entra');
  ok(!chaves.some((c) => c.startsWith(`${PREFIXO}10`)), 'o aparelho compartilhado não entra (a faxina geral é por IP)');
  const g1 = p.grupos.find((x) => x.chave === IP(1));
  ok(JSON.stringify(g1.banir.map((c) => c.nick)) === JSON.stringify([a[4].nick, a[5].nick]), 'no IP 1 caem as duas mais fracas');
  ok(g1.principal?.nick === a[0].nick && g1.diamantes === 110 && g1.gemas === 11, 'e a carteira delas (110 💎, 11 gemas) vai para a mais forte',
    JSON.stringify(g1));
  const g4 = p.grupos.find((x) => x.chave === IP(4));
  ok(g4.banir.length === 1 && g4.banir[0].nick === d[5].nick, 'no IP 4 cai uma só — a já banida não conta', JSON.stringify(g4.banir));
  ok(p.grupos.find((x) => x.chave === IP(5))?.semDestino === true, 'o IP sem personagem vem marcado como sem destino');
  ok(p.banir === 2 + 1 + 1 + 1 + 1, `o total a banir é ${p.banir}`, String(p.banir));

  // O mundo muda entre a prévia e o clique.
  await pool.query(`INSERT INTO origem_liberada (ip_bucket, nota, por_email) VALUES ($1, 'teste', 'teste')`, [IP(6)]);
  await conta('gforte', { nivel: 999, ips: [IP(7)] });

  secao('A execução');
  const antesA1 = await carteira(a[0]);
  const r = await faxinaGeral({
    email: 'teste@local',
    prefixo: PREFIXO,
    // O que a tela manda: os grupos da prévia, INCLUSIVE o sem destino (a tela filtra; o servidor
    // tem de pular sozinho se receber).
    esperado: [...p.grupos.map((x) => ({ chave: x.chave, banir: x.banir.map((c) => c.nick) })),
      // E um IP de fora do prefixo, que não pode ser tocado.
      { chave: '0:0:0:0::/64', banir: ['ninguem'] }],
  });
  ok(r.grupos === 2 && r.banidos === 3, `dois IPs feitos, três contas banidas (${r.grupos}/${r.banidos})`, JSON.stringify(r.feitos));
  const pulados = Object.fromEntries(r.pulados.map((x) => [x.chave, x.erro]));
  ok(/whitelist/.test(pulados[IP(6)] ?? ''), 'o IP que entrou na whitelist foi pulado', pulados[IP(6)]);
  ok(/mudou/.test(pulados[IP(7)] ?? ''), 'o IP que ganhou uma conta depois da prévia foi pulado', pulados[IP(7)]);
  ok(/personagem/.test(pulados[IP(5)] ?? ''), 'o IP sem personagem foi pulado', pulados[IP(5)]);
  ok(!('0:0:0:0::/64' in pulados) && !r.feitos.some((f) => f.chave === '0:0:0:0::/64'),
    'o IP de fora do lote nem foi visitado');

  const b5 = await ban(a[4]);
  const b6 = await ban(a[5]);
  ok(b5?.soft === true && b6?.soft === true, 'a5 e a6 levaram ban soft');
  ok(new RegExp(a[0].nick).test(b5?.motivo ?? ''), 'e o motivo diz para quem foi a carteira', b5?.motivo);
  const depoisA1 = await carteira(a[0]);
  ok(depoisA1.diamantes - antesA1.diamantes === 110 && depoisA1.gemas - antesA1.gemas === 11,
    'a1 recebeu 110 💎 e 11 gemas', JSON.stringify({ antesA1, depoisA1 }));
  ok(JSON.stringify(await carteira(a[4])) === JSON.stringify({ diamantes: 0, gemas: 0 }), 'e a carteira de a5 ficou vazia');
  ok(await ban(a[3]) === null && await ban(a[0]) === null, 'as quatro mais fortes seguem sem ban');
  const d1 = await ban(d[0]);
  ok(d1?.soft === false && d1.motivo === 'ban antigo de teste', 'o ban antigo do IP 4 continua como era');
  ok((await ban(d[5]))?.soft === true, 'e a mais fraca do IP 4 caiu');
  ok(await ban(g[4]) === null, 'no IP pulado, ninguém foi banido');

  secao('De novo');
  const p2 = await planoDeFaxinaGeral({ prefixo: PREFIXO });
  const restam = p2.grupos.map((x) => x.chave);
  ok(!restam.includes(IP(1)) && !restam.includes(IP(4)), 'os IPs feitos saem da prévia seguinte', JSON.stringify(restam));
  ok(restam.includes(IP(7)), 'e o IP que mudou volta, com o plano novo');
  ok(!restam.includes(IP(6)), 'o que entrou na whitelist não volta');
  let recusou = null;
  try {
    await faxinaGeral({ email: 'teste@local', esperado: [], prefixo: PREFIXO });
  } catch (err) {
    recusou = err.message;
  }
  ok(/prévia/.test(recusou ?? ''), 'sem prévia, a execução recusa', recusou);
} catch (err) {
  falhas++;
  console.log(`  ✗ o roteiro quebrou: ${err.stack ?? err.message}`);
} finally {
  await limpar();
  await pool.end().catch(() => {});
  pub?.disconnect?.();
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
