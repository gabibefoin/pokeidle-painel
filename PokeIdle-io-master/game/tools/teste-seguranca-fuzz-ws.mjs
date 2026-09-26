// Fuzz dos comandos do sim pelo socket: payload torto não derruba o servidor nem cria moeda.
//
//     node tools/teste-seguranca-fuzz-ws.mjs [http://localhost:8080]
//
// Precisa de um servidor de pé apontando para o MESMO Postgres do `.env` — de preferência um
// cluster isolado, porque os comandos rodam de verdade (anúncio, pedido de amizade, fila de PvP)
// com uma conta descartável que é apagada no fim.
//
// Para CADA comando de `comandos` (lido do próprio `sim.mjs`, então comando novo entra sozinho)
// manda os payloads que um cliente comprometido mandaria: negativo, zero, fracionário, enorme,
// `NaN`/`Infinity` em texto, tipo errado, array, objeto, `__proto__`, HTML e texto gigante. O que
// se exige no fim:
//
//   · o sim continua respondendo (um comando legítimo volta com resposta);
//   · ouro, Gemas e diamantes da conta NÃO aumentaram — o fuzz não tem de onde ganhar moeda;
//   · a conta não ganhou item de graça sem ter gastado ouro (listado para conferência).
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { criarConta, assinarSessao } from '../src/server/auth.mjs';
import { pool } from '../src/server/db.mjs';

const ORIGEM = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
const WS_URL = ORIGEM.replace(/^http/, 'ws');
const NICK = `secfz${Date.now().toString(36).slice(-6)}`;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

// ---- os comandos, lidos do sim
const sim = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/server/sim.mjs'), 'utf8').replace(/\r\n/g, '\n');
const ini = sim.indexOf('const comandos = {');
const bloco = sim.slice(ini, sim.indexOf('\n};\n', ini));
const { CLIENTE } = await import('../src/server/protocol.mjs');
const tipos = new Set();
for (const m of bloco.matchAll(/^  '([a-zA-Z0-9_.:-]+)'\s*[:(]/gm)) tipos.add(m[1]);
for (const m of bloco.matchAll(/^  \[CLIENTE\.([A-Z0-9_]+)\]\s*[:(]/gm)) tipos.add(CLIENTE[m[1]]);

const GIGANTE = 'A'.repeat(4000);
const HTML = '<img src=x onerror=alert(1)>"\'`${7*7}';
const PAYLOADS = [
  {},
  { id: -1, qtd: -5, valor: -1000, preco: -1, orbs: -10, itemId: -1, slot: -1, amigoId: -1, pokemonId: -1, speciesId: -1, nivel: -1 },
  { id: 0, qtd: 0, valor: 0, preco: 0, orbs: 0, itemId: 0, amigoId: 0, pokemonId: 0 },
  { id: 0.5, qtd: 0.5, valor: 1000.5, preco: 0.5, orbs: 0.5 },
  { id: 1e308, qtd: 1e308, valor: 9007199254740993, preco: 1e308, orbs: 1e308, itemId: 1e308, pokemonId: 1e308 },
  { id: 'NaN', qtd: 'Infinity', valor: '-1e30', preco: 'abc', orbs: '1e400', itemId: '1 OR 1=1', nick: "x' OR '1'='1" },
  { id: [1, 2], qtd: { a: 1 }, valor: [1000], preco: {}, items: { __proto__: { gold: 1 } }, amigoId: [], nick: ['a'] },
  { nome: HTML, texto: GIGANTE, slug: '../../../../etc/passwd', key: '__proto__', rede: 'constructor', endereco: HTML, moeda: 'orb', tipo: 'diamante' },
];

async function novaConta() {
  const c = await criarConta({ nick: NICK, email: `${NICK}@gmail.com`, senha: 'teste1234' });
  const { rows } = await pool.query(
    `UPDATE accounts SET nick = $2, nick_ok = true, email_ok = true WHERE id = $1 RETURNING *`, [c.id, NICK],
  );
  // Com dinheiro e itens na mão: sem isso metade dos comandos de economia sairia na primeira linha.
  await pool.query(
    `INSERT INTO players (nick, level, gold, items, tutorial_visto) VALUES ($1, 60, 1000000, '{"1": 10, "40530": 5}'::jsonb, true)`,
    [NICK],
  );
  return assinarSessao({ nick: rows[0].nick, contaId: Number(rows[0].id), provedor: rows[0].provedor });
}

const linha = async () => (await pool.query(
  `SELECT p.id, p.gold, p.orbs, p.diamonds, p.items,
          (SELECT count(*)::int FROM player_pokemon k WHERE k.player_id = p.id) AS pokemons
     FROM players p WHERE lower(p.nick) = lower($1)`, [NICK],
)).rows[0];

async function limpar() {
  const p = await linha().catch(() => null);
  if (p) {
    const id = Number(p.id);
    for (const sql of [
      `DELETE FROM market_anuncios WHERE vendedor_id = $1`,
      `DELETE FROM guild_members WHERE player_id = $1`,
      `DELETE FROM guilds WHERE owner_id = $1`,
      `DELETE FROM player_pokemon WHERE player_id = $1`,
      `DELETE FROM players WHERE id = $1`,
    ]) await pool.query(sql, [id]).catch(() => {});
  }
  const { rows } = await pool.query(`SELECT id FROM accounts WHERE lower(nick) = lower($1)`, [NICK]);
  for (const r of rows) {
    await pool.query(`DELETE FROM conta_origens WHERE conta_id = $1`, [r.id]).catch(() => {});
    await pool.query(`DELETE FROM accounts WHERE id = $1`, [r.id]).catch(() => {});
  }
}

console.log(`FUZZ DOS COMANDOS DO SIM\n========================\n${ORIGEM} · ${tipos.size} comandos × ${PAYLOADS.length} payloads`);

try {
  const token = await novaConta();
  const ws = new WebSocket(WS_URL);
  const recebidas = [];
  await new Promise((resolver, rejeitar) => {
    const prazo = setTimeout(() => rejeitar(new Error('sem welcome em 20 s')), 20_000);
    ws.on('message', (raw) => {
      const txt = raw.toString();
      recebidas.push(txt.slice(0, 300));
      if (txt.includes('"t":"welcome"')) { clearTimeout(prazo); resolver(); }
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token })));
    ws.on('error', rejeitar);
  });
  const mandar = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  for (const speciesId of [1, 4, 7, 152, 155, 158]) { mandar({ t: 'starter.pick', speciesId }); await esperar(150); }
  await esperar(2500);
  const antes = await linha();

  let fechado = null;
  ws.on('close', (code) => { fechado = code; });
  // O ouro da tela, lido do `estado` que o sim manda: dá para dizer DEPOIS DE QUAL comando ele
  // subiu. Subir não é defeito por si (vender item ao NPC dá ouro); é o que se confere à mão.
  let emVoo = null;
  let ouroTela = null;
  const subidas = [];
  ws.on('message', (raw) => {
    const txt = raw.toString();
    if (!txt.startsWith('{"t":"estado"') && !txt.includes('"t":"estado"')) return;
    const achado = txt.match(/"gold":(\d+)/);
    if (!achado) return;
    const g = Number(achado[1]);
    if (ouroTela != null && g > ouroTela) subidas.push(`${emVoo ?? '?'} +${g - ouroTela}`);
    ouroTela = g;
  });
  let enviados = 0;
  for (const t of tipos) {
    for (const [i, p] of PAYLOADS.entries()) {
      emVoo = `${t}#${i}`;
      mandar({ ...p, t });
      enviados++;
      // 14/s: abaixo do balde de 20/s do gateway, para o fuzz testar o sim e não o limitador.
      await esperar(72);
    }
  }
  console.log(`  (${enviados} pacotes enviados)`);
  if (subidas.length) console.log(`    (ouro subiu depois de: ${subidas.join(' · ')})`);
  await esperar(4000);

  ok(fechado === null, 'o gateway não derrubou o socket durante o fuzz', `close=${fechado}`);
  const marcador = recebidas.length;
  mandar({ t: 'market.meus' });
  await esperar(2500);
  ok(recebidas.slice(marcador).some((m) => m.includes('"t":"market"')), 'o sim continua respondendo depois do fuzz');

  await esperar(2000);
  const depois = await linha();
  // Ouro pode subir por VENDA ao NPC (o fuzz chama `shop.sellAllItems` com a bolsa cheia). O que não
  // pode é subir sem nada ter saído da conta.
  const saiuAlgo = Object.entries(antes.items ?? {}).some(([id, q]) => Number(depois.items?.[id] ?? 0) < Number(q))
    || Number(depois.pokemons) < Number(antes.pokemons);
  ok(
    Number(depois.gold) <= Number(antes.gold) || saiuAlgo,
    'o ouro só aumenta se algo foi vendido',
    `${antes.gold} → ${depois.gold}`,
  );
  ok(Number(depois.orbs) <= Number(antes.orbs), 'as Gemas não aumentaram', `${antes.orbs} → ${depois.orbs}`);
  ok(Number(depois.diamonds) <= Number(antes.diamonds), 'os diamantes não aumentaram', `${antes.diamonds} → ${depois.diamonds}`);
  const ganhos = Object.entries(depois.items ?? {})
    .filter(([id, q]) => Number(q) > Number(antes.items?.[id] ?? 0))
    .map(([id, q]) => `${id}: ${antes.items?.[id] ?? 0}→${q}`);
  const gastouOuro = Number(depois.gold) < Number(antes.gold);
  ok(!ganhos.length || gastouOuro, 'item a mais só aparece se houve ouro gasto', ganhos.join(', '));
  if (ganhos.length) console.log(`    (itens a mais, com ${Number(antes.gold) - Number(depois.gold)} de ouro gasto: ${ganhos.join(', ')})`);
  const perdas = Object.entries(antes.items ?? {})
    .filter(([id, q]) => Number(depois.items?.[id] ?? 0) < Number(q))
    .map(([id, q]) => `${id}: ${q}→${depois.items?.[id] ?? 0}`);
  if (perdas.length) console.log(`    (itens a menos: ${perdas.join(', ')})`);
  ws.close();
} catch (err) {
  falhas++;
  console.log(`  ✗ o fuzz estourou: ${err.message}`);
} finally {
  await esperar(1500);
  await limpar().catch((err) => console.log(`  (limpeza falhou: ${err.message})`));
  await pool.end();
}

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
