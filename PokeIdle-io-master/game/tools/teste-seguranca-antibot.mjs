// O protocolo contra um cliente comprometido: VIP forjado, bola forjada, retenção do mercado,
// corrida de compra, cancelamento repetido, valores absurdos, loja NPC, limites por conta, o
// sinal de compra colada na liberação e o sorteio da liberação.
//
//     node tools/teste-seguranca-antibot.mjs [http://localhost:8080]
//
// Precisa de um servidor de pé (gateway + sim) no MESMO Postgres do `.env`, de preferência um
// cluster isolado com `FLUSH_MS=1000`: os comandos rodam de verdade, com contas descartáveis que
// são apagadas no fim. Toda conferência é no BANCO, não na tela.
import WebSocket from 'ws';
import { criarConta, assinarSessao } from '../src/server/auth.mjs';
import { pool } from '../src/server/db.mjs';
import { itens, categoriaMercado, bolaPorId } from '../src/server/content.mjs';
import { COOLDOWN_COMPRA_MS, PRECO_MIN_GOLD } from '../src/server/market-db.mjs';

const ORIGEM = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
const WS_URL = ORIGEM.replace(/^http/, 'ws');
const SUF = Date.now().toString(36).slice(-5);
const FLUSH = 2500;
const P = Math.max(PRECO_MIN_GOLD, 1000);

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const pedrasTodas = [...itens.values()].filter((i) => categoriaMercado(i) === 'stone').map((i) => i.id);
const pedras = pedrasTodas.slice(0, 6);
// Doze pedras DIFERENTES para o sorteio: a trava de "um anúncio aberto por item" (e 30 min depois
// de fechar) não deixa um vendedor abrir doze anúncios da mesma pedra.
const pedrasSorteio = pedrasTodas.slice(6, 18);
const BOLA = [...bolaPorId.values()].find((b) => b.compravel && b.priceGold > 0);

const criadas = [];
async function novaConta(sufixo, { gold = 5_000_000, items = {} } = {}) {
  const nick = `sab${SUF}${sufixo}`;
  const c = await criarConta({ nick, email: `${nick}@gmail.com`, senha: 'teste1234' });
  const { rows } = await pool.query(
    `UPDATE accounts SET nick = $2, nick_ok = true, email_ok = true WHERE id = $1 RETURNING *`, [c.id, nick],
  );
  criadas.push(nick);
  const { rows: pr } = await pool.query(
    `INSERT INTO players (nick, level, gold, items, balls, tutorial_visto)
     VALUES ($1, 60, $2, $3::jsonb, $4::jsonb, true) RETURNING id`,
    [nick, gold, JSON.stringify(items), JSON.stringify({ [BOLA.id]: 50 })],
  );
  return {
    nick,
    id: Number(pr[0].id),
    token: await assinarSessao({ nick, contaId: Number(c.id), provedor: rows[0].provedor }),
  };
}

/** Socket logado. Resolve no `welcome`; `devagar: true` resolve também na recusa por limite. */
function conectar(conta, { devagar = false } = {}) {
  return new Promise((resolver, rejeitar) => {
    const ws = new WebSocket(WS_URL);
    const s = {
      ws,
      recebidas: [],
      mandar: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)),
      texto: (desde = 0) => s.recebidas.slice(desde).join('\n'),
      contar: (re, desde = 0) => s.recebidas.slice(desde).reduce((n, m) => n + (m.match(re)?.length ?? 0), 0),
      fechar: () => new Promise((r) => {
        if (ws.readyState > 1) return r();
        ws.once('close', r);
        ws.close();
      }),
    };
    const prazo = setTimeout(() => rejeitar(new Error(`${conta.nick}: sem welcome em 20 s`)), 20_000);
    ws.on('message', (raw) => {
      const txt = raw.toString();
      s.recebidas.push(txt.length > 4000 ? txt.slice(0, 4000) : txt);
      if (txt.includes('"t":"welcome"')) {
        clearTimeout(prazo);
        resolver(s);
      } else if (devagar && txt.includes('Devagar aí')) {
        clearTimeout(prazo);
        s.recusado = true;
        resolver(s);
      }
    });
    ws.on('open', () => s.mandar({ t: 'hello', token: conta.token }));
    ws.on('error', rejeitar);
  });
}

const jogador = async (id) => (await pool.query(
  `SELECT gold, items, balls, automation, vip_ate,
          (SELECT count(*)::int FROM player_pokemon k WHERE k.player_id = players.id) AS pokemons
     FROM players WHERE id = $1`, [id],
)).rows[0];
const anuncio = async (vendedorId, itemId) => (await pool.query(
  `SELECT id, qtd, estado, preco, extract(epoch FROM (compravel_em - criado_em)) AS retencao_s
     FROM market_anuncios WHERE vendedor_id = $1 AND item_id = $2 ORDER BY id DESC LIMIT 1`,
  [vendedorId, itemId],
)).rows[0];
const qtdItem = (j, id) => Number(j?.items?.[id] ?? 0);

async function limpar() {
  if (!criadas.length) return;
  const nicks = criadas.map((n) => n.toLowerCase());
  const { rows } = await pool.query(`SELECT id FROM players WHERE lower(nick) = ANY($1::text[])`, [nicks]);
  const ids = rows.map((r) => Number(r.id));
  if (ids.length) {
    await pool.query(`DELETE FROM market_pagamentos WHERE vendedor_id = ANY($1::bigint[]) OR comprador_id = ANY($1::bigint[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM market_anuncios WHERE vendedor_id = ANY($1::bigint[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM player_pokemon WHERE player_id = ANY($1::bigint[])`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [ids]).catch(() => {});
  }
  const { rows: cs } = await pool.query(`SELECT id FROM accounts WHERE lower(nick) = ANY($1::text[])`, [nicks]);
  for (const c of cs) {
    await pool.query(`DELETE FROM conta_origens WHERE conta_id = $1`, [c.id]).catch(() => {});
    await pool.query(`DELETE FROM accounts WHERE id = $1`, [c.id]).catch(() => {});
  }
}

console.log(`ANTI-BOT NO PROTOCOLO\n=====================\n${ORIGEM}`);

try {
  ok(pedras.length === 6 && pedrasSorteio.length === 12 && !!BOLA, 'catálogo: 18 pedras de mercado e uma bola da loja', `${pedrasTodas.length} · ${BOLA?.id}`);
  const [v1, v2, v3, v4, cA, cB, cBot] = await Promise.all([
    novaConta('v1', { items: { [pedras[0]]: 20 } }),
    novaConta('v2', { items: { [pedras[1]]: 20 } }),
    novaConta('v3', { items: { [pedras[2]]: 5, [pedras[3]]: 5, [pedras[4]]: 5, [pedras[5]]: 5 } }),
    novaConta('v4', { items: Object.fromEntries(pedrasSorteio.map((id) => [id, 1])) }),
    novaConta('ca'),
    novaConta('cb'),
    novaConta('bt'),
  ]);
  const [vend1, vend2, vend3, vend4, compA, compB] = await Promise.all([v1, v2, v3, v4, cA, cB].map((c) => conectar(c)));
  await esperar(800);

  // ------------------------------------------------------------------ VIP
  console.log('\nVIP forjado');
  const vipAntes = Number((await jogador(cA.id)).vip_ate ?? 0);
  let marca = compA.recebidas.length;
  compA.mandar({ t: 'auto.set', autoBallSemParar: true, autoBallAteCapturar: false, ballIds: [BOLA.id], autoRevive: true, autoPotion: true, pvpAutoFila: true });
  compA.mandar({ t: 'auto.set', autoBall: true, vip: true, isVip: 1, vipAte: 9_999_999_999_999, pvpAutoFila: 'true' });
  compA.mandar({ t: 'auto.set', autoBallAteCapturar: 1, autoBallSemParar: '1', pvpAutoFila: 1, vip: 'true', entitlement: 'vip' });
  await esperar(400);
  compA.mandar({ t: 'auto.set', autoRevive: true, autoPotion: true, ballIds: [BOLA.id] });
  await esperar(FLUSH);
  let jA = await jogador(cA.id);
  ok(jA.automation?.autoBallSemParar !== true && jA.automation?.autoBallAteCapturar !== true,
    'sem VIP, nenhuma variante liga a bola automática', JSON.stringify(jA.automation));
  ok(jA.automation?.pvpAutoFila !== true, 'sem VIP, a fila automática do PvP não liga');
  ok(Number(jA.vip_ate ?? 0) === vipAntes && Number(jA.vip_ate ?? 0) < Date.now(),
    'vipAte mandado pelo cliente não vira VIP', `${vipAntes} → ${jA.vip_ate}`);
  ok(/recurso VIP/.test(compA.texto(marca)), 'o jogador recebe o aviso de recurso VIP de sempre');
  ok(jA.automation?.autoRevive === true, 'o que não é de VIP (auto-revive) liga normalmente');

  // ------------------------------------------------------------------ bola
  console.log('\nPokébola forjada');
  const antesBola = await jogador(cA.id);
  for (const m of [{ ballId: BOLA.id, slot: null }, { ballId: BOLA.id, slot: 0 }, { ballId: BOLA.id, slot: 999 },
    { ballId: BOLA.id, slot: 'abc' }, { ballId: 9999, slot: 0 }, { ballId: -1, slot: 1 }, { ballId: BOLA.id }]) {
    compA.mandar({ t: 'ball.throw', ...m });
  }
  await esperar(FLUSH);
  const depoisBola = await jogador(cA.id);
  ok(Number(depoisBola.balls?.[BOLA.id]) === Number(antesBola.balls?.[BOLA.id]),
    'arremesso sem pokémon caído não gasta bola', `${antesBola.balls?.[BOLA.id]} → ${depoisBola.balls?.[BOLA.id]}`);
  ok(depoisBola.pokemons === antesBola.pokemons, 'e não captura nada');

  // -------------------------------------------------------------- retenção
  console.log('\nRetenção de 2 min');
  vend1.mandar({ t: 'market.criar', tipo: 'item', itemId: pedras[0], qtd: 5, preco: P, moeda: 'gold' });
  await esperar(1500);
  const a1 = await anuncio(v1.id, pedras[0]);
  ok(a1?.estado === 'aberto' && Number(a1.qtd) === 5, 'o anúncio legítimo nasce', JSON.stringify(a1));
  ok(Math.abs(Number(a1?.retencao_s) - COOLDOWN_COMPRA_MS / 1000) < 5, 'retenção gravada no banco: 2 min', `${a1?.retencao_s} s`);
  marca = compA.recebidas.length;
  compA.mandar({ t: 'market.comprar', id: Number(a1.id), qtd: 1, preco: P, moeda: 'gold' });
  await esperar(1500);
  ok(/market\.retencao|retenção/.test(compA.texto(marca)), 'comprar durante a retenção é recusado');
  ok(Number((await anuncio(v1.id, pedras[0])).qtd) === 5, 'e o estoque continua 5');
  marca = vend1.recebidas.length;
  vend1.mandar({ t: 'market.editar', id: Number(a1.id), preco: P + 1, moeda: 'gold' });
  await esperar(1000);
  ok(/retencaoEditar/.test(vend1.texto(marca)), 'editar durante a retenção continua recusado');

  // ---------------------------------------------------------------- corrida
  console.log('\nCorrida de compra');
  // Liberado há 10 s: fora da janela do sorteio, é a corrida pura do `FOR UPDATE`.
  await pool.query(`UPDATE market_anuncios SET compravel_em = now() - interval '10 seconds' WHERE id = $1`, [a1.id]);
  await esperar(FLUSH);
  const gA = await jogador(cA.id);
  const gB = await jogador(cB.id);
  for (let i = 0; i < 10; i++) {
    compA.mandar({ t: 'market.comprar', id: Number(a1.id), qtd: 5, preco: P, moeda: 'gold' });
    compB.mandar({ t: 'market.comprar', id: Number(a1.id), qtd: 5, preco: P, moeda: 'gold' });
  }
  await esperar(3000 + FLUSH);
  const pags = (await pool.query(`SELECT comprador_id FROM market_pagamentos WHERE anuncio_id = $1`, [a1.id])).rows;
  ok(pags.length === 1, '20 pedidos simultâneos de dois compradores: um pagamento só', `${pags.length}`);
  ok((await anuncio(v1.id, pedras[0])).estado === 'vendido', 'o anúncio fecha como vendido');
  const gA2 = await jogador(cA.id);
  const gB2 = await jogador(cB.id);
  const gastoA = Number(gA.gold) - Number(gA2.gold);
  const gastoB = Number(gB.gold) - Number(gB2.gold);
  ok((gastoA === 5 * P && gastoB === 0) || (gastoB === 5 * P && gastoA === 0),
    'o ouro sai uma vez, só de quem levou', `A −${gastoA} · B −${gastoB}`);
  ok(qtdItem(gA2, pedras[0]) + qtdItem(gB2, pedras[0]) === 5, 'e existem exatamente 5 pedras novas no total');

  // ----------------------------------------------------------- cancelamento
  console.log('\nCancelamento repetido e de outra pessoa');
  vend2.mandar({ t: 'market.criar', tipo: 'item', itemId: pedras[1], qtd: 3, preco: P, moeda: 'gold' });
  await esperar(1500 + FLUSH);
  const a2 = await anuncio(v2.id, pedras[1]);
  const antesCancel = qtdItem(await jogador(v2.id), pedras[1]);
  ok(a2?.estado === 'aberto' && antesCancel === 17, 'anúncio de 3 aberto, 17 na bolsa', `${a2?.estado} · ${antesCancel}`);
  compA.mandar({ t: 'market.cancelar', id: Number(a2.id) });
  await esperar(1000);
  ok((await anuncio(v2.id, pedras[1])).estado === 'aberto', 'cancelar o anúncio de OUTRO jogador não faz nada');
  for (let i = 0; i < 10; i++) vend2.mandar({ t: 'market.cancelar', id: Number(a2.id) });
  await esperar(1500 + FLUSH);
  ok((await anuncio(v2.id, pedras[1])).estado === 'cancelado', 'o dono cancela');
  ok(qtdItem(await jogador(v2.id), pedras[1]) === 20, '10 cancelamentos devolvem as 3 pedras UMA vez',
    `${qtdItem(await jogador(v2.id), pedras[1])}`);

  // -------------------------------------------------------- valores absurdos
  console.log('\nValores absurdos no anúncio');
  for (const [qtd, preco] of [[-5, P], [0, P], [1e9, P], ['NaN', P], [1, -1], [1, 0.5], [1, 1e308], [[2], P], [{ x: 1 }, P]]) {
    vend3.mandar({ t: 'market.criar', tipo: 'item', itemId: pedras[2], qtd, preco, moeda: 'gold' });
  }
  await esperar(2000 + FLUSH);
  const j3 = await jogador(v3.id);
  const abertos3 = (await pool.query(
    `SELECT qtd, preco FROM market_anuncios WHERE vendedor_id = $1 AND item_id = $2 AND estado = 'aberto'`, [v3.id, pedras[2]],
  )).rows;
  const emAnuncio = abertos3.reduce((s, r) => s + Number(r.qtd), 0);
  ok(qtdItem(j3, pedras[2]) + emAnuncio === 5, 'bolsa + anúncios somam as 5 pedras de antes', `${qtdItem(j3, pedras[2])} + ${emAnuncio}`);
  ok(abertos3.every((r) => Number(r.qtd) >= 1 && Number(r.preco) >= PRECO_MIN_GOLD && Number.isFinite(Number(r.preco))),
    'nenhum anúncio com quantidade ou preço inválido', JSON.stringify(abertos3));

  // ------------------------------------------------------------ loja NPC
  console.log('\nLoja NPC com quantidade torta');
  const b0 = await jogador(cB.id);
  compB.mandar({ t: 'shop.buy', kind: 'ball', id: BOLA.id, qty: 1 });
  await esperar(FLUSH);
  const b1 = await jogador(cB.id);
  ok(Number(b1.balls?.[BOLA.id]) - Number(b0.balls?.[BOLA.id]) === 1 && Number(b0.gold) - Number(b1.gold) === BOLA.priceGold,
    'compra legítima: 1 bola pelo preço do catálogo');
  for (const qty of [-5, 0, 'NaN', 0.5, [3], { x: 1 }, 'Infinity']) compB.mandar({ t: 'shop.buy', kind: 'ball', id: BOLA.id, qty });
  compB.mandar({ t: 'shop.buy', kind: 'ball', id: 99999, qty: 1 });
  compB.mandar({ t: 'shop.buy', kind: 'item', id: -1, qty: 1 });
  compB.mandar({ t: 'shop.buy', kind: 'caixa', id: BOLA.id, qty: 1 });
  await esperar(FLUSH);
  const b2 = await jogador(cB.id);
  const gasto = Number(b1.gold) - Number(b2.gold);
  const ganhas = Number(b2.balls?.[BOLA.id]) - Number(b1.balls?.[BOLA.id]);
  ok(gasto === ganhas * BOLA.priceGold && gasto >= 0, 'quantidade torta nunca dá bola sem pagar o preço cheio', `${ganhas} bolas por ${gasto}`);

  // --------------------------------------------------------------- limites
  console.log('\nLimites por conta');
  const bot = await conectar(cBot);
  marca = bot.recebidas.length;
  for (let i = 0; i < 60; i++) {
    bot.mandar({ t: 'market.comprar', id: 2_147_480_000 + i, qtd: 1, preco: 1, moeda: 'gold' });
    await esperar(100);
  }
  await esperar(2500);
  const chegaram = bot.contar(/esse anúncio já saiu/g, marca);
  ok(bot.contar(/Devagar aí/g, marca) >= 1 && chegaram <= 34, '60 compras em 6 s: o gateway segura o excesso', `${chegaram} chegaram ao sim`);
  await bot.fechar();
  const bot2 = await conectar(cBot);
  marca = bot2.recebidas.length;
  for (let i = 0; i < 20; i++) {
    bot2.mandar({ t: 'market.comprar', id: 2_147_481_000 + i, qtd: 1, preco: 1, moeda: 'gold' });
    await esperar(100);
  }
  await esperar(2000);
  const chegaram2 = bot2.contar(/esse anúncio já saiu/g, marca);
  ok(chegaram2 <= 12, 'reconectar não devolve o balde da conta', `${chegaram2} de 20 chegaram ao sim`);
  await bot2.fechar();
  let recusadoHello = false;
  for (let i = 0; i < 30 && !recusadoHello; i++) {
    const s = await conectar(cBot, { devagar: true });
    recusadoHello = !!s.recusado;
    await s.fechar();
  }
  ok(recusadoHello, 'reconectar em laço esbarra no limite de hello da conta');

  // ----------------------------------------------------------------- snipe
  console.log('\nCompra colada na liberação');
  for (const itemId of pedras.slice(3, 6)) {
    vend3.mandar({ t: 'market.criar', tipo: 'item', itemId, qtd: 1, preco: P, moeda: 'gold' });
    await esperar(800);
  }
  await esperar(1500);
  const alvos = await Promise.all(pedras.slice(3, 6).map((id) => anuncio(v3.id, id)));
  ok(alvos.every((a) => a?.estado === 'aberto'), 'três anúncios de 1 aberto', JSON.stringify(alvos.map((a) => a?.estado)));
  const { rows: rel } = await pool.query(`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms`);
  const desvioRelogio = Number(rel[0].ms) - Date.now();
  const liberacoes = [];
  for (const [k, a] of alvos.entries()) {
    const { rows } = await pool.query(
      `UPDATE market_anuncios SET compravel_em = clock_timestamp() + ($2::int * INTERVAL '1 millisecond')
        WHERE id = $1 RETURNING (extract(epoch FROM compravel_em) * 1000)::bigint AS ms`,
      [a.id, 2500 + k * 1500],
    );
    liberacoes.push(Number(rows[0].ms));
  }
  marca = compA.recebidas.length;
  for (const [k, a] of alvos.entries()) {
    await esperar(Math.max(0, liberacoes[k] - desvioRelogio + 200 - Date.now()));
    compA.mandar({ t: 'market.comprar', id: Number(a.id), qtd: 1, preco: P, moeda: 'gold' });
  }
  // Pedido colado entra no sorteio e tenta entre 3 e 4 s depois de liberar.
  await esperar(5500);
  const pagos = (await pool.query(
    `SELECT count(*)::int AS n FROM market_pagamentos WHERE anuncio_id = ANY($1::bigint[])`, [alvos.map((a) => a.id)],
  )).rows[0].n;
  ok(compA.contar(/market\.sorteio"/g, marca) === 3, 'cada pedido colado na liberação entra no sorteio', `${compA.contar(/market\.sorteio"/g, marca)}`);
  ok(pagos === 3, 'sozinho no sorteio, as três compras acontecem (o sinal não bloqueia nada)', `${pagos}`);
  const suspeita = await pool.query(
    `SELECT detalhe FROM player_gameplay_log WHERE player_id = $1 AND categoria = 'suspeita' AND acao = 'mercado_snipe'`, [cA.id],
  );
  ok(suspeita.rowCount === 1, 'e viram UMA linha de suspeita na auditoria', `${suspeita.rowCount} · relógio banco−host ${desvioRelogio} ms · ${suspeita.rows[0]?.detalhe ?? ''}`);

  // ------------------------------------------------------ sorteio da liberação
  console.log('\nSorteio da liberação');
  // 12 anúncios de 1 (pedras e preços diferentes) liberando no MESMO instante. A pede colado
  // (80 ms, ritmo de bot) e repete 4 vezes o pedido do primeiro; B pede 2 s depois (ritmo de
  // gente). Antes, A levava os 12.
  for (const [k, itemId] of pedrasSorteio.entries()) {
    vend4.mandar({ t: 'market.criar', tipo: 'item', itemId, qtd: 1, preco: P + 10 + k, moeda: 'gold' });
    await esperar(150);
  }
  await esperar(2000);
  const sorteados = (await pool.query(
    `SELECT id, preco FROM market_anuncios WHERE vendedor_id = $1 AND estado = 'aberto' ORDER BY id`, [v4.id],
  )).rows;
  ok(sorteados.length === 12, '12 anúncios de 1 abertos', `${sorteados.length}`);
  const precoDe = new Map(sorteados.map((r) => [Number(r.id), Number(r.preco)]));
  const idsSorteio = [...precoDe.keys()];
  const { rows: libR } = await pool.query(
    `UPDATE market_anuncios SET compravel_em = clock_timestamp() + INTERVAL '1500 milliseconds'
      WHERE id = ANY($1::bigint[]) RETURNING (extract(epoch FROM compravel_em) * 1000)::bigint AS ms`,
    [idsSorteio],
  );
  const liberaHost = Math.max(...libR.map((r) => Number(r.ms))) - desvioRelogio;
  const [ouroA0, ouroB0] = (await Promise.all([jogador(cA.id), jogador(cB.id)])).map((j) => Number(j.gold));
  const marcaA = compA.recebidas.length;
  const marcaB = compB.recebidas.length;
  await esperar(Math.max(0, liberaHost + 80 - Date.now()));
  for (const id of idsSorteio) compA.mandar({ t: 'market.comprar', id, qtd: 1, preco: precoDe.get(id), moeda: 'gold' });
  for (let i = 0; i < 4; i++) {
    compA.mandar({ t: 'market.comprar', id: idsSorteio[0], qtd: 1, preco: precoDe.get(idsSorteio[0]), moeda: 'gold' });
  }
  await esperar(Math.max(0, liberaHost + 2000 - Date.now()));
  for (const id of idsSorteio) compB.mandar({ t: 'market.comprar', id, qtd: 1, preco: precoDe.get(id), moeda: 'gold' });
  await esperar(Math.max(0, liberaHost + 4000 - Date.now()) + 1500 + FLUSH);

  const vendas = (await pool.query(
    `SELECT anuncio_id, comprador_id FROM market_pagamentos WHERE anuncio_id = ANY($1::bigint[])`, [idsSorteio],
  )).rows;
  const deA = vendas.filter((v) => Number(v.comprador_id) === cA.id);
  const deB = vendas.filter((v) => Number(v.comprador_id) === cB.id);
  ok(vendas.length === 12 && new Set(vendas.map((v) => String(v.anuncio_id))).size === 12,
    'os 12 vendem, cada um uma vez só', `${vendas.length}`);
  ok(deB.length >= 1, 'quem pediu 2 s depois ganha parte dos sorteios (antes: nenhum)', `A ${deA.length} · B ${deB.length}`);
  ok(deA.length >= 1, 'e quem pediu colado também ganha parte — ninguém é punido por ser rápido', `A ${deA.length} · B ${deB.length}`);
  const bilhetesA = compA.contar(/market\.sorteio"/g, marcaA);
  ok(bilhetesA === 12, 'pedido repetido não vira bilhete extra: 16 pedidos de A, 12 entradas no sorteio', `${bilhetesA}`);
  const perdas = compA.contar(/market\.sorteioPerdeu/g, marcaA) + compB.contar(/market\.sorteioPerdeu/g, marcaB);
  ok(perdas === 12, 'e cada anúncio tem um perdedor, avisado de que perdeu o sorteio', `${perdas}`);
  const [ouroA1, ouroB1] = (await Promise.all([jogador(cA.id), jogador(cB.id)])).map((j) => Number(j.gold));
  const somaPrecos = (vs) => vs.reduce((s, v) => s + precoDe.get(Number(v.anuncio_id)), 0);
  ok(ouroA0 - ouroA1 === somaPrecos(deA) && ouroB0 - ouroB1 === somaPrecos(deB),
    'o ouro sai só pelo que cada um levou — perder o sorteio não cobra nada',
    `A −${ouroA0 - ouroA1} de ${somaPrecos(deA)} · B −${ouroB0 - ouroB1} de ${somaPrecos(deB)}`);

  await Promise.all([vend1, vend2, vend3, vend4, compA, compB].map((s) => s.fechar()));
} catch (err) {
  falhas++;
  console.log(`  ✗ o teste estourou: ${err.message}`);
} finally {
  await esperar(1500);
  await limpar().catch((err) => console.log(`  (limpeza falhou: ${err.message})`));
  await pool.end();
}

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
