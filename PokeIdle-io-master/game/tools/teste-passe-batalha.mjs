// PASSE DE BATALHA — as regras da trilha (unidade) e o resgate/compra com o jogo no ar (ponta a ponta).
//
//   node tools/teste-passe-batalha.mjs             (ou npm run test:passe)
//   SO_UNIDADE=1 node tools/teste-passe-batalha.mjs   sem o servidor
import WebSocket from 'ws';
import '../src/server/config.mjs';
import {
  TRILHA, PASSE_DIAS, PASSE_VIP_PRECO, PASSE_NIVEL_MIN, ITEM, BOLA,
  diaDoPasse, inicioDoDiaDoPasse, degrauDeHoje, estadoDoPasse, normalizarPasse, somaDaTrilha,
} from '../src/shared/passe-batalha.mjs';
import { resgatar, podeComprarVip, ativarVip, ErroPasse } from '../src/server/game/passe-batalha.mjs';
import { TIPOS_BOOST } from '../src/server/game/loja.mjs';
import { itens as catalogoItens, IDS_MERCADO_PERMITIDOS } from '../src/server/content.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);
const H = 3600_000;
const DIA = 24 * H;
// Meio-dia de Brasília (15:00 UTC) de um dia qualquer: longe da virada das 03:00 UTC.
const T0 = Date.UTC(2026, 8, 18, 15, 0, 0);

const jogador = (extra = {}) => ({
  nick: 'T', level: 50, gold: 0, diamonds: 0, balls: {}, items: {}, boosts: {}, vipAte: 0, passe: null, ...extra,
});
const erroDe = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ============================================================================ unidade
secao('O dia do passe vira à meia-noite de Brasília (03:00 UTC)');
{
  const d = diaDoPasse(T0);
  ok(diaDoPasse(Date.UTC(2026, 8, 19, 2, 59, 59)) === d, '02:59:59 UTC ainda é o mesmo dia');
  ok(diaDoPasse(Date.UTC(2026, 8, 19, 3, 0, 0)) === d + 1, '03:00 UTC já é o dia seguinte');
  ok(inicioDoDiaDoPasse(d + 1) === Date.UTC(2026, 8, 19, 3, 0, 0), 'o início do dia seguinte é 03:00 UTC');
}

secao('A trilha: anda um por dia, zera ao faltar, recomeça depois do 30');
{
  ok(degrauDeHoje({}, T0).degrau === 1, 'quem nunca resgatou está no Dia 1');
  const p = jogador();
  let r = resgatar(p, T0);
  ok(r.degrau === 1 && p.passe.degrau === 1, 'primeiro resgate = Dia 1');
  ok(erroDe(() => resgatar(p, T0 + H))?.chave === 'passe.jaPegou', 'dois resgates no mesmo dia: o segundo é recusado');
  r = resgatar(p, T0 + DIA);
  ok(r.degrau === 2, 'no dia seguinte, Dia 2');
  const st = degrauDeHoje(p.passe, T0 + 3 * DIA);
  ok(st.degrau === 1 && st.quebrou, 'faltou um dia: volta ao Dia 1 e avisa que quebrou');
  r = resgatar(p, T0 + 3 * DIA);
  ok(r.degrau === 1 && r.quebrou, 'o resgate depois da falta é o Dia 1');
  // 30 dias seguidos
  const q = jogador();
  for (let i = 0; i < PASSE_DIAS; i++) resgatar(q, T0 + i * DIA);
  ok(q.passe.degrau === 30 && q.passe.ciclos === 1, '30 dias seguidos fecham o ciclo', JSON.stringify(q.passe));
  r = resgatar(q, T0 + 30 * DIA);
  ok(r.degrau === 1 && !r.quebrou, 'o dia seguinte ao 30 recomeça no Dia 1 (sem ser "quebra")');
  ok(q.passe.total === 31, 'o total de resgates conta a vida inteira');
}

secao('O que cada resgate entrega');
{
  const p = jogador();
  resgatar(p, T0);
  ok(p.gold === 250_000, 'Dia 1 grátis: 250 mil Coins', `${p.gold}`);
  ok((p.vipAte ?? 0) === 0, 'sem VIP, o prêmio VIP do Dia 1 (dias de VIP) NÃO sai');
  resgatar(p, T0 + DIA);
  ok(p.balls[BOLA.ULTRA] === 30, 'Dia 2 grátis: 30 Ultra Balls');
  resgatar(p, T0 + 2 * DIA);
  ok(p.boosts.xp === T0 + 2 * DIA + 1 * H, 'Dia 3 grátis: 1h de XP Boost a partir de agora');
  // O Dia 30 grátis
  const q = jogador();
  for (let i = 0; i < PASSE_DIAS; i++) resgatar(q, T0 + i * DIA);
  ok(q.items[ITEM.BOSS_TOKEN] === 1, 'o Dia 30 grátis dá o Bronze Boss Token');
  ok(!q.items[ITEM.FRAG_SHINY], '…e NÃO dá o fragmento (é do VIP)');
  const soma = somaDaTrilha('free');
  ok(q.gold === soma.coins, 'a trilha grátis inteira soma o que o catálogo diz', `${q.gold} vs ${soma.coins}`);
}

secao('O VIP');
{
  const p = jogador({ diamonds: 200 });
  ok(!erroDe(() => podeComprarVip(p, T0)), 'com diamante e nível, pode comprar');
  ativarVip(p, T0);
  ok(p.passe.vipAte === T0 + 30 * DIA, 'o VIP vale 30 dias corridos a partir da compra');
  const r = resgatar(p, T0);
  ok(r.premios.some((x) => x.trilha === 'free') && r.premios.some((x) => x.trilha === 'vip'), 'com VIP, o resgate entrega grátis E VIP');
  ok(p.gold === 250_000 + 500_000, 'Coins das duas trilhas', `${p.gold}`);
  ok(p.vipAte === T0 + 3 * DIA, 'o Dia 1 VIP dá 3 dias de VIP de assinatura');
  ok(erroDe(() => resgatar(p, T0 + H))?.chave === 'passe.jaPegou', 'e não pega de novo no mesmo dia');

  // Comprou DEPOIS de resgatar o grátis: pega o VIP de hoje na hora, uma vez.
  const q = jogador({ diamonds: 200 });
  resgatar(q, T0);
  ativarVip(q, T0 + H);
  const st = estadoDoPasse(q, T0 + H);
  ok(st.vipPendenteHoje, 'comprou depois do grátis: o VIP de hoje fica pendente');
  const r2 = resgatar(q, T0 + 2 * H);
  ok(r2.premios.every((x) => x.trilha === 'vip') && r2.premios.length > 0, '…e o resgate seguinte entrega SÓ o VIP do dia');
  ok(erroDe(() => resgatar(q, T0 + 3 * H))?.chave === 'passe.jaPegou', '…uma vez só');

  // Faltou um dia com o VIP ativo: a trilha zera, o prazo do VIP continua correndo.
  const w = jogador({ diamonds: 200 });
  ativarVip(w, T0);
  resgatar(w, T0);
  resgatar(w, T0 + DIA);
  const r3 = resgatar(w, T0 + 3 * DIA);
  ok(r3.degrau === 1 && r3.quebrou, 'faltou um dia com VIP: volta ao Dia 1');
  ok(w.passe.vipAte === T0 + 30 * DIA, '…e o prazo do VIP não volta (os dias perdidos são perdidos)');

  // VIP expirado: só o grátis.
  const e = jogador({ diamonds: 200 });
  ativarVip(e, T0);
  const r4 = resgatar(e, T0 + 31 * DIA);
  ok(r4.premios.every((x) => x.trilha === 'free'), 'VIP vencido: só o grátis');

  // Teto de 90 dias e falta de diamante.
  const t = jogador({ diamonds: 1000 });
  ativarVip(t, T0);
  ativarVip(t, T0);
  ativarVip(t, T0);
  ok(erroDe(() => podeComprarVip(t, T0))?.chave === 'passe.vipTeto', 'não acumula além de 90 dias');
  ok(erroDe(() => podeComprarVip(jogador({ diamonds: PASSE_VIP_PRECO - 1 }), T0))?.chave === 'passe.semDiamantes', 'sem 50 💎 não compra');
  ok(erroDe(() => resgatar(jogador({ level: PASSE_NIVEL_MIN - 1 }), T0))?.chave === 'passe.nivelMin', `abaixo do nível ${PASSE_NIVEL_MIN} não resgata`);
  ok(erroDe(() => podeComprarVip(jogador({ level: 1, diamonds: 999 }), T0))?.chave === 'passe.nivelMin', '…nem compra o VIP');
}

secao('O alcance do VIP ("até onde eu chego")');
{
  const p = jogador({ diamonds: 999 });
  ativarVip(p, T0);
  ok(estadoDoPasse(p, T0).alcanceVip === 30, 'VIP novo no Dia 1: cobre até o 30');
  const q = jogador();
  q.passe = { ultimo: diaDoPasse(T0) - 1, degrau: 5, ultimoVip: null, vipAte: T0 + 3 * DIA, ciclos: 0, total: 5 };
  ok(estadoDoPasse(q, T0).alcanceVip === 9, 'no Dia 6 com 3 dias e meio de VIP: chega ao Dia 9', `${estadoDoPasse(q, T0).alcanceVip}`);
}

secao('Dado torto no banco não derruba nada');
{
  for (const lixo of [null, 'x', 42, [], { degrau: 999 }, { degrau: -3, ultimo: 'abc' }, { vipAte: 'NaN' }]) {
    const n = normalizarPasse(lixo);
    ok(n.degrau >= 0 && n.degrau <= 30 && Number.isFinite(n.vipAte), `normaliza ${JSON.stringify(lixo)}`);
  }
}

secao('O catálogo bate com o jogo');
{
  const ids = new Set(catalogoItens.keys());
  for (const [nome, id] of Object.entries(ITEM)) ok(ids.has(id), `item ${nome} (${id}) existe no catálogo`);
  for (const d of TRILHA) {
    for (const pr of [...d.free, ...d.vip]) {
      if (pr.tipo === 'boost' && !TIPOS_BOOST[pr.boost]) ok(false, `boost desconhecido no dia ${d.dia}: ${pr.boost}`);
      if (pr.tipo === 'bola' && ![1, 2, 3, 4, 5].includes(pr.id)) ok(false, `bola desconhecida no dia ${d.dia}`);
    }
  }
  ok(TRILHA.length === PASSE_DIAS && TRILHA.every((d, i) => d.dia === i + 1), 'são 30 degraus, em ordem');
  // A regra de economia do cabeçalho: o GRÁTIS quase não dá coisa negociável.
  const negociaveisFree = TRILHA.flatMap((d) => d.free).filter((pr) => (pr.tipo === 'item' || pr.tipo === 'bola') && IDS_MERCADO_PERMITIDOS.has(pr.id));
  const idsNeg = [...new Set(negociaveisFree.map((pr) => pr.id))];
  ok(idsNeg.every((id) => id === BOLA.BEAST || id === ITEM.BOSS_TOKEN), 'o grátis só dá Beast Ball e Boss Token de negociável', JSON.stringify(idsNeg));
  ok(!TRILHA.some((d) => d.free.some((pr) => pr.id === ITEM.FRAG_SHINY)), 'fragmento (≈ US$ 4) nunca na trilha grátis');
}

// ============================================================================ ponta a ponta
if (!process.env.SO_UNIDADE) {
  const { pool } = await import('../src/server/db.mjs');
  const { assinarSessao } = await import('../src/server/auth.mjs');
  const WS_URL = process.env.WS_URL ?? 'ws://localhost:8080';
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const nick = `passe${Date.now() % 100000}`;
  let conta = null;
  let player = null;
  let ws = null;
  try {
    secao('Ponta a ponta: resgate, recusa, compra do VIP e o VIP do dia');
    const { rows: ac } = await pool.query(
      `INSERT INTO accounts (nick, email, provedor, email_ok, nick_ok) VALUES ($1, $2, 'local', true, true) RETURNING id, provedor`,
      [nick, `${nick}@test.local`],
    );
    conta = Number(ac[0].id);
    const { rows } = await pool.query(
      `INSERT INTO players (nick, level, xp, gold, diamonds, visual_ok, tutorial_visto, discord_pop_campanha, aviso_visto)
       VALUES ($1, 30, 0, 0, 90, true, true, 99, 99) RETURNING id`,
      [nick],
    );
    player = Number(rows[0].id);
    // O ledger precisa explicar o saldo: a linha que teria posto os 90 💎 ali.
    await pool.query(
      `INSERT INTO diamante_ledger (player_id, delta, saldo_apos, motivo, ref, nota) VALUES ($1, 90, 90, 'ajuste_admin', null, 'teste do passe')`,
      [player],
    ).catch(() => {});
    const token = await assinarSessao({ nick, contaId: conta, provedor: ac[0].provedor ?? 'local' });
    const msgs = [];
    ws = new WebSocket(WS_URL);
    await new Promise((ok2, err) => {
      const prazo = setTimeout(() => err(new Error('sem welcome')), 20_000);
      ws.on('message', (raw) => {
        let b; try { b = JSON.parse(raw.toString()); } catch { return; }
        for (const m of Array.isArray(b) ? b : [b]) {
          if (m?.t === 'batalha' && Array.isArray(m.ev)) for (const e of m.ev) msgs.push({ t: 'evento', ...e });
          else msgs.push(m);
          if (m?.t === 'welcome') { clearTimeout(prazo); ok2(); }
        }
      });
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token })));
      ws.on('error', err);
    });
    const esperar = async (pred, ms = 8000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const a = msgs.find(pred); if (a) return a; await dormir(60); }
      return null;
    };
    const mandar = (m) => ws.send(JSON.stringify(m));
    await dormir(700);

    msgs.length = 0;
    mandar({ t: 'passe.resgatar', dia: 30, premios: [{ tipo: 'coins', qtd: 1e12 }] }); // campos forjados são ignorados
    const r1 = await esperar((m) => m.t === 'passe' && m.resgate);
    ok(r1?.resgate?.degrau === 1, 'o resgate pelo socket entrega o Dia 1 (os campos forjados não contam)');
    ok(r1?.resgate?.premios?.length === 1 && r1.resgate.premios[0].qtd === 250_000, '…com o prêmio do catálogo, não o do pacote');
    const est = await esperar((m) => m.t === 'estado' && m.estado?.passe?.degrau === 1);
    ok(!!est, 'o snapshot traz o passe atualizado');

    msgs.length = 0;
    mandar({ t: 'passe.resgatar' });
    mandar({ t: 'passe.resgatar' });
    const rec = await esperar((m) => m.t === 'evento' && m.k === 'aviso' && m.msg === 'passe.jaPegou');
    ok(!!rec, 'resgatar de novo no mesmo dia: recusado');
    await dormir(500);
    ok(!msgs.some((m) => m.t === 'passe' && m.resgate), '…e nada é entregue');

    msgs.length = 0;
    mandar({ t: 'passe.comprarVip', preco: 0 });
    const comprou = await esperar((m) => m.t === 'passe' && m.vipComprado);
    ok(!!comprou && comprou.vipComprado.vipAte > Date.now() + 29 * DIA, 'compra o VIP (o "preço" do pacote é ignorado)');
    await dormir(1500);
    const { rows: led } = await pool.query(
      `SELECT delta, motivo, ref FROM diamante_ledger WHERE player_id = $1 ORDER BY id DESC LIMIT 1`, [player],
    );
    ok(Number(led[0]?.delta) === -PASSE_VIP_PRECO && led[0]?.ref === 'passe_vip', 'o débito de 50 💎 está no ledger, com a referência do passe');
    const { rows: pl } = await pool.query(`SELECT diamonds, passe FROM players WHERE id = $1`, [player]);
    ok(Number(pl[0].diamonds) === 90 - PASSE_VIP_PRECO, 'o saldo caiu 50');
    ok(Number(pl[0].passe?.vipAte) > Date.now(), 'o prazo do VIP já está gravado no banco (flush forçado)');

    msgs.length = 0;
    mandar({ t: 'passe.resgatar' });
    const r2 = await esperar((m) => m.t === 'passe' && m.resgate);
    ok(r2?.resgate?.premios?.every((x) => x.trilha === 'vip'), 'comprou depois do resgate: pega o VIP de hoje');
    msgs.length = 0;
    mandar({ t: 'passe.resgatar' });
    ok(!!(await esperar((m) => m.t === 'evento' && m.k === 'aviso' && m.msg === 'passe.jaPegou')), '…e só uma vez');

    // Compra com saldo curto (40 💎 sobrando): recusa ANTES do ledger.
    msgs.length = 0;
    mandar({ t: 'passe.comprarVip' });
    ok(!!(await esperar((m) => m.t === 'evento' && m.k === 'aviso' && m.msg === 'passe.semDiamantes')), 'sem saldo para outro VIP: recusado');
    const { rows: led2 } = await pool.query(`SELECT count(*)::int n FROM diamante_ledger WHERE player_id = $1 AND ref = 'passe_vip'`, [player]);
    ok(led2[0].n === 1, '…sem débito nenhum no ledger');
  } catch (err) {
    falhas++;
    console.error('ERRO:', err);
  } finally {
    try { ws?.close(); } catch {}
    await dormir(2500);
    if (player) {
      await pool.query(`DELETE FROM diamante_ledger WHERE player_id = $1`, [player]).catch(() => {});
      await pool.query(`DELETE FROM player_pokemon WHERE player_id = $1`, [player]).catch(() => {});
      await pool.query(`DELETE FROM players WHERE id = $1`, [player]).catch(() => {});
    }
    if (conta) {
      await pool.query(`DELETE FROM conta_origens WHERE conta_id = $1`, [conta]).catch(() => {});
      await pool.query(`DELETE FROM accounts WHERE id = $1`, [conta]).catch(() => {});
    }
    await pool.end();
  }
}

console.log(`\n==============================================\n${falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`}`);
process.exit(falhas ? 1 : 0);
