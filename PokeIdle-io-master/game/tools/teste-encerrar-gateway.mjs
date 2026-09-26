// O gateway saindo do ar: todo socket aberto recebe 1012 — sem cluster, com um servidor `ws` local.
//
//     node tools/teste-encerrar-gateway.mjs
import { WebSocketServer, WebSocket } from 'ws';
import { fecharParaReinicio, CODIGO_REINICIO } from '../src/server/encerrar-gateway.mjs';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

const wss = new WebSocketServer({ port: 0, perMessageDeflate: { serverNoContextTakeover: false } });
await new Promise((r) => wss.once('listening', r));
const url = `ws://127.0.0.1:${wss.address().port}`;

const abrir = () => new Promise((resolver, rejeitar) => {
  const ws = new WebSocket(url);
  const s = { ws, codigo: null, motivo: null };
  s.fechou = new Promise((r) => ws.on('close', (codigo, motivo) => { s.codigo = codigo; s.motivo = motivo.toString(); r(); }));
  ws.on('open', () => resolver(s));
  ws.on('error', rejeitar);
});

const clientes = await Promise.all([abrir(), abrir(), abrir()]);
await new Promise((r) => setTimeout(r, 100));
// Um já fechado pelo próprio cliente: não conta e não quebra.
clientes[2].ws.close(1000);
await clientes[2].fechou;
await new Promise((r) => setTimeout(r, 100));

const n = fecharParaReinicio(wss.clients);
await Promise.all(clientes.map((c) => c.fechou));

ok(n === 2, 'fecha os sockets abertos e devolve quantos', `${n}`);
ok(clientes[0].codigo === CODIGO_REINICIO && clientes[1].codigo === 1012, 'o navegador recebe 1012 (Service Restart)',
  `${clientes[0].codigo} ${clientes[1].codigo}`);
ok(clientes[0].motivo === 'reinicio', 'com o motivo', clientes[0].motivo);
ok(clientes[2].codigo === 1000, 'quem já tinha saído fica como estava', `${clientes[2].codigo}`);
ok(fecharParaReinicio([]) === 0, 'sem ninguém conectado, nada a fazer');

wss.close();
console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
