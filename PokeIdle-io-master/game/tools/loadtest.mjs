// Teste de carga: abre N WebSockets, cada um entra numa hunt com automações ligadas, e mede
// o que importa — tempo de conexão, throughput de mensagens e o tick do servidor sob carga.
//
//   node tools/loadtest.mjs [n] [segundos] [porConexaoPorSegundo] [prefixoDoNick]
//
// O prefixo importa: nicks iguais são a MESMA conta, e uma segunda conexão com o mesmo nick
// reaponta o roteamento (é reconexão). Ao testar dois gateways ao mesmo tempo, use prefixos
// diferentes ou um dos dois fica sem receber nada.
//
// Roda tudo de um processo só; para passar de ~3000 é melhor dividir em vários processos
// (o gargalo vira o cliente, não o servidor).
import WebSocket from 'ws';
import { sessaoPara } from './auth-teste.mjs';

const [nRaw, segRaw, rampaRaw, prefixo = 'load'] = process.argv.slice(2);
const n = Number(nRaw ?? 200);
const segundos = Number(segRaw ?? 30);
const rampa = Number(rampaRaw ?? 200);
const URL = process.env.WS_URL ?? 'ws://localhost:8080';
const SAUDE = process.env.HTTP_URL ?? 'http://localhost:8080/saude';

const conexoes = [];
const m = {
  abertas: 0,
  fechadas: 0,
  erros: 0,
  welcome: 0,
  msgs: 0,
  bytes: 0,
  temposConexao: [],
  motivos: new Map(),
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const HTTP = process.env.HTTP_URL ?? 'http://localhost:8080';

// `BENCH_TOKENS=arquivo.json` ({ nick: token }) pula o `/auth`: a rota limita tentativas por IP, e uma
// bancada abre centenas de contas do mesmo endereço. As sessões vêm prontas de quem gerou o arquivo.
const tokensProntos = process.env.BENCH_TOKENS
  ? JSON.parse((await import('node:fs')).readFileSync(process.env.BENCH_TOKENS, 'utf8'))
  : null;

async function tokenPara(nick) {
  if (tokensProntos?.[nick]) return tokensProntos[nick];
  const s = await sessaoPara(nick, { http: HTTP });
  return s.token;
}
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))];
};

let hunts = null;
let abertas = null;

// O bot se comporta como o navegador: negocia a compressão do socket e anuncia `delta: 1` no hello,
// como o `app.js`. Sem isso o sim manda o quadro INTEIRO (~90 kB) a cada envio de estado e o gateway
// nunca comprime nada — a carga medida seria de um cliente que ninguém usa. `LOADTEST_CLIENTE_ANTIGO=1`
// volta ao bot de antes (sem delta, sem deflate), para comparar com medições antigas.
const CLIENTE_ANTIGO = process.env.LOADTEST_CLIENTE_ANTIGO === '1';
// `LOADTEST_ECONOMIA=1`: o bot liga o MODO ECONOMIA logo depois de entrar na hunt, como a aba faz
// com o interruptor ligado — o servidor para de mandar (e de calcular) o `campo` para ele. É o
// que mede quanto o modo tira do servidor, com a mesma carga do bot comum.
const ECONOMIA = process.env.LOADTEST_ECONOMIA === '1';

function abrir(i) {
  const t0 = performance.now();
  const ws = new WebSocket(URL, { perMessageDeflate: !CLIENTE_ANTIGO });
  conexoes.push(ws);

  ws.on('open', async () => {
    m.abertas++;
    const nick = `${prefixo}_${i}`;
    try {
      const token = await tokenPara(nick);
      ws.send(JSON.stringify(CLIENTE_ANTIGO ? { t: 'hello', nick, token } : { t: 'hello', nick, token, delta: 1 }));
    } catch {
      m.erros++;
    }
  });

  ws.on('message', (raw) => {
    m.msgs++;
    m.bytes += raw.length;
    const msg = JSON.parse(raw);
    if (msg.t === 'welcome') {
      m.welcome++;
      m.temposConexao.push(performance.now() - t0);
      hunts ??= msg.hunts;
      // Bot novo nasce sem pokémon E sem personagem: fecha o visual e só então escolhe o
      // starter — é a ordem que o servidor cobra (ver o onboarding em `sim.mjs`).
      if (msg.starters?.length) {
        ws.send(JSON.stringify({ t: 'visual.set', genero: i % 2 ? 'female' : 'male', visual: {} }));
        ws.send(JSON.stringify({ t: 'starter.pick', speciesId: msg.starters[i % msg.starters.length].speciesId }));
      }
      // Espalha os bots pelas áreas que um treinador NOVO consegue entrar. O servidor recusa
      // área acima do nível do jogador, e só 12 das 347 hunts abrem no nível 1 — mandar todo
      // mundo para as 40 primeiras deixaria a maioria parada, medindo carga de gente ociosa.
      abertas ??= hunts.filter((x) => x.nivel <= 1);
      const h = abertas[i % abertas.length];
      ws.send(JSON.stringify({ t: 'hunt.select', slug: h.slug }));
      if (ECONOMIA) ws.send(JSON.stringify({ t: 'cliente.economia', ativo: true }));
      ws.send(JSON.stringify({
        t: 'auto.set',
        autoBallSemParar: true,
        autoBallAteCapturar: false,
        ballIds: [1],
        autoRevive: true,
        autoPotion: true,
      }));
    }
  });

  ws.on('close', () => m.fechadas++);
  ws.on('error', (err) => {
    m.erros++;
    const chave = err.code ?? err.message;
    m.motivos.set(chave, (m.motivos.get(chave) ?? 0) + 1);
  });
}

console.log(`abrindo ${n} conexões em ${URL} (rampa de ${rampa}/s)…`);
const t0 = performance.now();

for (let i = 0; i < n; i++) {
  abrir(i);
  if (i % rampa === rampa - 1) await dormir(1000);
}

// espera todo mundo receber o welcome (ou desistir)
for (let i = 0; i < 60 && m.welcome < n; i++) await dormir(500);

const tConexao = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`${m.welcome}/${n} entraram em ${tConexao}s · erros=${m.erros}`);
if (m.motivos.size) {
  console.log('motivos:', [...m.motivos].map(([k, v]) => `${k}×${v}`).join(', '));
}
console.log(
  `latência do hello→welcome: p50 ${pct(m.temposConexao, 50).toFixed(0)}ms · ` +
    `p95 ${pct(m.temposConexao, 95).toFixed(0)}ms · p99 ${pct(m.temposConexao, 99).toFixed(0)}ms`,
);

console.log(`\nmedindo por ${segundos}s…`);
const msgs0 = m.msgs;
const bytes0 = m.bytes;
const amostras = [];

for (let i = 0; i < Number(segundos); i++) {
  await dormir(1000);
  try {
    const s = await fetch(SAUDE).then((r) => r.json());
    amostras.push(s);
  } catch {}
}

const dm = m.msgs - msgs0;
const db = m.bytes - bytes0;
const ticks = amostras.map((a) => a.tickMs).filter((x) => x != null);

console.log(`\n--- resultado ---`);
console.log(`conexões vivas     ${m.abertas - m.fechadas}`);
console.log(`mensagens          ${dm} em ${segundos}s = ${(dm / segundos).toFixed(0)}/s`);
console.log(`banda (saída)      ${(db / segundos / 1024).toFixed(0)} KB/s = ${((db / segundos / 1024 / m.abertas) * 1024).toFixed(0)} B/s por jogador`);
console.log(`tick da simulação  p50 ${pct(ticks, 50).toFixed(1)}ms · p95 ${pct(ticks, 95).toFixed(1)}ms · max ${Math.max(...ticks).toFixed(1)}ms`);
console.log(`jogadores no sim   ${amostras.at(-1)?.jogadores ?? '?'}`);
console.log(`online (Redis)     ${amostras.at(-1)?.online ?? '?'}`);

for (const ws of conexoes) ws.close();
await dormir(500);
process.exit(0);
