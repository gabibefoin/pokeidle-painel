// SEGURANÇA das features de 18/09/2026 — Passe de Batalha, PvP amistoso, análise da guerra e o
// histórico/filtro do Mercado — com o jogo no ar. Organizado pelo OWASP Top 10 (2021).
//
//   node tools/teste-seguranca-passe-amistoso.mjs   (ou npm run test:seguranca:passe)
//
// O que é regra de jogo (sequência, prêmio, espera) está em `teste-passe-batalha.mjs` e
// `teste-pvp-amistoso.mjs`. Aqui é só o que um cliente adulterado tentaria.
import WebSocket from 'ws';
import Redis from 'ioredis';
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { assinarSessao } from '../src/server/auth.mjs';
import { especies } from '../src/server/content.mjs';
import { criarLimites } from '../src/server/limites-ws.mjs';

const { categoriaDe } = criarLimites();

const WS_URL = process.env.WS_URL ?? 'ws://localhost:8080';
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);
const sufixo = `${Date.now() % 100000}`;
const criadas = [];

async function conta(nome, { nivel = 40, diamantes = 0 } = {}) {
  const nick = `sg${nome}${sufixo}`.slice(0, 16);
  const { rows: ac } = await pool.query(
    `INSERT INTO accounts (nick, email, provedor, email_ok, nick_ok) VALUES ($1, $2, 'local', true, true) RETURNING id`,
    [nick, `${nick}@test.local`],
  );
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, xp, gold, diamonds, visual_ok, tutorial_visto, discord_pop_campanha, aviso_visto)
     VALUES ($1, $2, 0, 1000, $3, true, true, 99, 99) RETURNING id`, [nick, nivel, diamantes],
  );
  const id = Number(rows[0].id);
  if (diamantes) {
    await pool.query(
      `INSERT INTO diamante_ledger (player_id, delta, saldo_apos, motivo, nota) VALUES ($1, $2, $2, 'ajuste_admin', 'teste de segurança')`,
      [id, diamantes],
    ).catch(() => {});
  }
  const esp = [...especies.values()].find((e) => e.name === 'Pikachu');
  await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, quality, ivs, hp, shiny, potencia, slot)
     VALUES ($1, $2, 50, 1.1, '{"hp":10,"atk":10,"def":10,"spAtk":10,"spDef":10,"speed":10}'::jsonb, 999, false, 1, 1)`,
    [id, esp.pokeId],
  );
  criadas.push({ id, contaId: Number(ac[0].id), key: nick.toLowerCase() });
  return { nick, id, key: nick.toLowerCase(), token: await assinarSessao({ nick, contaId: Number(ac[0].id), provedor: 'local' }) };
}

function conectar(c, { hello = true } = {}) {
  return new Promise((resolver, rejeitar) => {
    const ws = new WebSocket(WS_URL);
    const msgs = [];
    const s = {
      ws, msgs, fechou: null,
      mandar: (m) => { if (ws.readyState === 1) ws.send(typeof m === 'string' ? m : JSON.stringify(m)); },
      limpar: () => { msgs.length = 0; },
      async esperar(pred, ms = 6000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const a = msgs.find(pred); if (a) return a; await dormir(50); }
        return null;
      },
      avisos: (chave) => msgs.filter((m) => m.t === 'evento' && m.k === 'aviso' && (!chave || m.msg === chave)),
    };
    ws.on('message', (raw) => {
      let b; try { b = JSON.parse(raw.toString()); } catch { return; }
      for (const m of Array.isArray(b) ? b : [b]) {
        if (m?.t === 'batalha' && Array.isArray(m.ev)) for (const e of m.ev) msgs.push({ t: 'evento', ...e });
        else msgs.push(m);
        if (m?.t === 'welcome') resolver(s);
      }
    });
    ws.on('close', (code) => { s.fechou = code; });
    ws.on('open', () => { if (hello) s.mandar({ t: 'hello', token: c.token }); else resolver(s); });
    ws.on('error', rejeitar);
  });
}

const saudavel = () => fetch('http://localhost:8080/saude').then((r) => r.ok).catch(() => false);

const sockets = [];
try {
  const A = await conta('a', { nivel: 40, diamantes: 100 });
  const B = await conta('b', { nivel: 40 });
  const baixo = await conta('lo', { nivel: 5 });
  const [sA, sB, sLo] = await Promise.all([A, B, baixo].map((c) => conectar(c)));
  sockets.push(sA, sB, sLo);
  await dormir(700);

  // ------------------------------------------------------------------ A01
  secao('A01 · Controle de acesso');
  {
    // Sem hello: nenhum comando novo chega a jogador nenhum.
    const anon = await conectar({}, { hello: false });
    sockets.push(anon);
    for (const t of ['passe.resgatar', 'passe.comprarVip', 'guild.pvp.analise', 'amigo.pvp.convidar', 'amigo.pvp.fita']) anon.mandar({ t, amigoId: B.id });
    await dormir(1500);
    ok(!anon.msgs.some((m) => m.t === 'passe' || m.t === 'guild' || m.t === 'amigos'), 'sem autenticação, nenhum comando novo responde');

    // Forjar admin para pular o nível mínimo do Passe.
    sLo.limpar();
    sLo.mandar({ t: 'passe.resgatar', admin: true, playerId: A.key, doCliente: false, level: 999 });
    ok(!!(await sLo.esperar((m) => m.t === 'evento' && m.k === 'aviso' && m.msg === 'passe.nivelMin')), '"admin: true" e "level: 999" no pacote não furam o nível mínimo');
    sLo.mandar(JSON.stringify({ t: 'passe.resgatar', __proto__: { admin: true } }));
    sLo.mandar('{"t":"passe.resgatar","constructor":{"prototype":{"admin":true}}}');
    await dormir(800);
    ok(!sLo.msgs.some((m) => m.t === 'passe' && m.resgate), 'poluição de protótipo no pacote não dá admin');

    // "playerId" no pacote não troca de quem é o resgate: o gateway carimba o dono do socket.
    sB.limpar();
    sA.limpar();
    sA.mandar({ t: 'passe.resgatar', playerId: B.key });
    await sA.esperar((m) => m.t === 'passe' && m.resgate);
    await dormir(600);
    ok(!sB.msgs.some((m) => m.t === 'passe'), 'mandar "playerId" de outro não resgata na conta dele');

    // A fita do amistoso e o histórico do Mercado não aceitam alvo.
    sB.limpar();
    sB.mandar({ t: 'market.historico', vendedorId: A.id, pagina: 0 });
    const h = await sB.esperar((m) => m.t === 'market' && m.aba === 'historico');
    ok(!!h && (h.total ?? 0) === 0, 'o histórico de vendas é sempre o do próprio socket (vendedorId é ignorado)');
  }

  // ------------------------------------------------------------------ A03
  secao('A03 · Injeção');
  {
    sA.limpar();
    for (const dia of ["2026-09-18' OR '1'='1", '2026-09-18; DROP TABLE players', { $ne: null }, ['2026-09-18'], '9'.repeat(5000)]) {
      sA.mandar({ t: 'guild.pvp.analise', dia });
    }
    await dormir(2500);
    ok(await saudavel(), 'o "dia" da análise com SQL, objeto, lista e 5 mil caracteres não derruba nada');
    const { rows } = await pool.query(`SELECT count(*)::int n FROM players WHERE id = $1`, [A.id]);
    ok(rows[0].n === 1, '…e a tabela continua lá');
    sA.limpar();
    sA.mandar({ t: 'market.listar', tipo: 'pokemon', semOutland: "1) OR 1=1 --", busca: "x' OR '1'='1" });
    const l = await sA.esperar((m) => m.t === 'market' && m.aba === 'vitrine');
    ok(!!l && Array.isArray(l.linhas), 'semOutland e busca com SQL viram booleano e parâmetro, e a vitrine responde normal');
    // O id do convite vai para uma chave do Redis: só 32 hexadecimais passam.
    for (const cid of ['*', 'pvpa:cd:*', '../../', '\r\nFLUSHALL\r\n', 'a'.repeat(33)]) {
      sB.mandar({ t: 'amigo.pvp.responder', conviteId: cid, aceitar: true });
      sB.mandar({ t: 'amigo.pvp.fita', conviteId: cid });
    }
    await dormir(800);
    ok((await redis.dbsize()) > 0, 'nenhum comando de Redis injetado pelo id do convite (o banco do Redis segue com as chaves)');
  }

  // ------------------------------------------------------------------ A04
  secao('A04 · Desenho: corrida na compra do VIP e no resgate');
  {
    // A tem 100 💎: com 20 compras simultâneas, no máximo 2 passam (50 cada), e o saldo nunca fica negativo.
    sA.limpar();
    for (let i = 0; i < 20; i++) sA.mandar({ t: 'passe.comprarVip' });
    await dormir(4000);
    const compras = sA.msgs.filter((m) => m.t === 'passe' && m.vipComprado).length;
    const { rows: led } = await pool.query(`SELECT count(*)::int n, COALESCE(sum(delta), 0)::int soma FROM diamante_ledger WHERE player_id = $1 AND ref = 'passe_vip'`, [A.id]);
    const { rows: pl } = await pool.query(`SELECT diamonds FROM players WHERE id = $1`, [A.id]);
    ok(compras === 2 && led[0].n === 2, `20 compras simultâneas com 100 💎: exatamente 2 passam`, `${compras} / ledger ${led[0].n}`);
    ok(Number(pl[0].diamonds) === 0 && led[0].soma === -100, 'o saldo termina em 0, nunca negativo, e o ledger explica cada diamante', `${pl[0].diamonds}`);
  }

  // ------------------------------------------------------------------ A05 / DoS
  secao('A05 · Limites de ritmo (negação de serviço)');
  {
    ok(categoriaDe('passe.resgatar') === 'lojaCompra' && categoriaDe('passe.comprarVip') === 'lojaCompra', 'Passe no balde da Loja');
    ok(categoriaDe('guild.pvp.analise') === 'fita' && categoriaDe('guild.pvp.replay') === 'fita' && categoriaDe('amigo.pvp.fita') === 'fita', 'análise, replay e fita no balde "fita"');
    ok(['amigo.pvp.convidar', 'amigo.pvp.responder', 'amigo.pvp.cancelar'].every((t) => categoriaDe(t) === 'social'), 'amistoso no balde social');
    sB.limpar();
    for (let i = 0; i < 60; i++) sB.mandar({ t: 'guild.pvp.analise' });
    await dormir(4000);
    const respostas = sB.msgs.filter((m) => m.t === 'guild' && m.analise).length;
    ok(respostas <= 9, `60 pedidos de análise num segundo: só a rajada do balde responde (${respostas})`);
    ok(sB.fechou == null || sB.fechou === 1000, 'o socket não cai por isso', `close=${sB.fechou}`);
    ok(await saudavel(), 'o servidor continua respondendo');
  }

  // ------------------------------------------------------------------ A08
  secao('A08 · Integridade: o cliente não escreve prêmio nem estado');
  {
    // A comprou o VIP no A04 DEPOIS do resgate grátis do A01, então o próximo resgate é, com
    // razão, o VIP do Dia 1. O pacote vai forjado mesmo assim: o que sai tem de ser o do catálogo.
    await dormir(5500); // o flush grava o ouro de agora
    const { rows } = await pool.query(`SELECT gold FROM players WHERE id = $1`, [A.id]);
    sA.limpar();
    sA.mandar({ t: 'passe.resgatar', premios: [{ tipo: 'coins', qtd: 1e15 }], degrau: 30, passe: { degrau: 30 } });
    const vip = await sA.esperar((m) => m.t === 'passe' && m.resgate);
    const coinsVip = (vip?.resgate?.premios ?? []).filter((p) => p.tipo === 'coins').reduce((s, p) => s + p.qtd, 0);
    ok(vip?.resgate?.degrau === 1 && vip.resgate.premios.every((p) => p.trilha === 'vip') && coinsVip === 500_000,
      'o resgate forjado entrega o VIP do Dia 1 do CATÁLOGO (500 mil Coins), não o do pacote', JSON.stringify(vip?.resgate?.premios));
    sA.limpar();
    sA.mandar({ t: 'passe.resgatar', premios: [{ tipo: 'coins', qtd: 1e15 }], degrau: 30 });
    ok(!!(await sA.esperar((m) => m.t === 'evento' && m.msg === 'passe.jaPegou')), 'e o seguinte, forjado de novo, é recusado');
    await dormir(5500);
    const { rows: depois } = await pool.query(`SELECT gold, passe FROM players WHERE id = $1`, [A.id]);
    ok(Number(depois[0].gold) - Number(rows[0].gold) === 500_000, 'o ouro subiu exatamente o do catálogo', `${Number(depois[0].gold) - Number(rows[0].gold)}`);
    ok(Number(depois[0].passe?.degrau) === 1, 'o degrau gravado é o do servidor (1), não o do pacote');
  }
} catch (err) {
  falhas++;
  console.error('ERRO:', err);
} finally {
  for (const s of sockets) try { s.ws.close(); } catch {}
  await dormir(2500);
  const ids = criadas.map((c) => c.id);
  if (ids.length) {
    await pool.query(`DELETE FROM diamante_ledger WHERE player_id = ANY($1::bigint[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM player_pokemon WHERE player_id = ANY($1::bigint[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [ids]).catch(() => {});
  }
  for (const c of criadas) {
    await pool.query(`DELETE FROM conta_origens WHERE conta_id = $1`, [c.contaId]).catch(() => {});
    await pool.query(`DELETE FROM accounts WHERE id = $1`, [c.contaId]).catch(() => {});
    await redis.del(`pvpa:cd:${c.key}`, `pvpa:saida:${c.key}`).catch(() => {});
  }
  await pool.end();
  redis.disconnect();
}
console.log(`\n==============================================\n${falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`}`);
process.exit(falhas ? 1 : 0);
