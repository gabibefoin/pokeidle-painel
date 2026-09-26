// A compressão do socket, de ponta a ponta num cluster: o que o gateway negocia e se o jogo chega
// inteiro. Rode com e sem `WS_DEFLATE_CONTEXTO=1` — a MESMA variável no ambiente do cluster e do teste:
//
//     node tools/teste-ws-compressao.mjs http://localhost:8095
//
// O que protege:
//   · sem a variável, o de sempre: `server_no_context_takeover` na resposta do upgrade;
//   · com ela, sem essa cláusula — o `ws` passa a comprimir com contexto;
//   · e nada muda no jogo: welcome, estado (em delta) e campo chegam, se remontam e se leem igual.
import WebSocket from 'ws';
import { criarConta, assinarSessao } from '../src/server/auth.mjs';
import { pool } from '../src/server/db.mjs';
import { criarMescladorDeEstado } from '../src/shared/estado-delta.mjs';

const ORIGEM = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
const WS_URL = ORIGEM.replace(/^http/, 'ws');
const COM_CONTEXTO = process.env.WS_DEFLATE_CONTEXTO === '1';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

const nick = `wsz${Date.now().toString(36).slice(-6)}`;
console.log(`COMPRESSÃO DO SOCKET — ${COM_CONTEXTO ? 'COM contexto' : 'sem contexto'}\n${ORIGEM}`);

let conta = null;
try {
  conta = await criarConta({ nick, email: `${nick}@gmail.com`, senha: 'teste1234' });
  const { rows } = await pool.query(
    `UPDATE accounts SET nick = $2, nick_ok = true, email_ok = true WHERE id = $1 RETURNING *`, [conta.id, nick],
  );
  const token = await assinarSessao({ nick, contaId: Number(conta.id), provedor: rows[0].provedor });

  let extensoes = '';
  const tipos = new Map();
  let jsonRuim = 0;
  let welcome = null;
  let estadoMontado = null;
  let bytesJson = 0;
  const mesclar = criarMescladorDeEstado();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: true });
  ws.on('upgrade', (res) => { extensoes = String(res.headers['sec-websocket-extensions'] ?? ''); });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token, delta: 1 })));
  ws.on('message', (raw) => {
    const txt = raw.toString();
    bytesJson += txt.length;
    let m;
    try { m = JSON.parse(txt); } catch { jsonRuim++; return; }
    tipos.set(m.t, (tipos.get(m.t) ?? 0) + 1);
    if (m.t === 'welcome') { welcome = m; estadoMontado = mesclar(m.estado); }
    if (m.t === 'estado' && estadoMontado) estadoMontado = mesclar(m.estado);
  });
  await new Promise((r, f) => { ws.once('open', r); ws.once('error', f); });
  const inicio = ws._socket.bytesRead;
  await esperar(12_000);
  const noFio = ws._socket.bytesRead - inicio;

  ok(/permessage-deflate/.test(extensoes), 'o gateway negocia permessage-deflate', extensoes);
  ok(COM_CONTEXTO ? !/server_no_context_takeover/.test(extensoes) : /server_no_context_takeover/.test(extensoes),
    COM_CONTEXTO ? 'com a variável: SEM server_no_context_takeover (comprime com contexto)'
      : 'sem a variável: server_no_context_takeover, como sempre', extensoes);
  ok(!!welcome && estadoMontado?.nick?.toLowerCase() === nick.toLowerCase(), 'o welcome chega e o estado se remonta', estadoMontado?.nick);
  ok(tipos.get('campo.init') >= 1, 'a cena do Centro chega (campo.init)', JSON.stringify([...tipos]));
  ok(jsonRuim === 0, 'nenhuma mensagem ilegível', `${jsonRuim}`);
  ok(noFio > 0 && noFio < bytesJson, 'no fio sai menos do que o JSON', `${noFio} B no fio · ${bytesJson} B de JSON · ${(100 - (100 * noFio) / bytesJson).toFixed(0)}% menor`);
  ws.close();
  await esperar(1500);
} catch (err) {
  falhas++;
  console.log(`  ✗ o teste estourou: ${err.message}`);
} finally {
  const { rows } = await pool.query(`SELECT id FROM players WHERE lower(nick) = lower($1)`, [nick]).catch(() => ({ rows: [] }));
  for (const r of rows) {
    await pool.query(`DELETE FROM player_pokemon WHERE player_id = $1`, [r.id]).catch(() => {});
    await pool.query(`DELETE FROM players WHERE id = $1`, [r.id]).catch(() => {});
  }
  if (conta) {
    await pool.query(`DELETE FROM conta_origens WHERE conta_id = $1`, [conta.id]).catch(() => {});
    await pool.query(`DELETE FROM accounts WHERE id = $1`, [conta.id]).catch(() => {});
  }
  await pool.end();
}

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
