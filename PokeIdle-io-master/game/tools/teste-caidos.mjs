// Teste dos derrotados no chão: o corpo fica capturável por 30 s e o painel do palco
// arremessa bola nele.
//
// Precisa do servidor de pé (`npm start`). Demora ~1 min: espera uma batalha de verdade
// acontecer, porque é justamente o encadeamento derrota → corpo → captura que se quer testar.
//
//   node tools/teste-caidos.mjs
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
const perfil = await mkdtemp(join(tmpdir(), 'caidos-'));
const porta = 9600 + Math.floor(Math.random() * 200);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, '--window-size=1500,950', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let pagina;
for (let i = 0; i < 60 && !pagina; i++) {
  try {
    pagina = (await fetch(`http://127.0.0.1:${porta}/json/list`).then((r) => r.json()))
      .find((a) => a.type === 'page' && a.webSocketDebuggerUrl);
  } catch {}
  if (!pagina) await dormir(250);
}
const ws = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });
let id = 0; const pend = new Map(); const erros = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') erros.push(m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    erros.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});
const cmd = (mt, p = {}) => new Promise((ok) => { const i = ++id; pend.set(i, ok); ws.send(JSON.stringify({ id: i, method: mt, params: p })); });
const js = async (e) => (await cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;

const testes = [];
const checar = (nome, ok, det = '') => { testes.push(ok); console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}${det ? ` — ${det}` : ''}`); };

await cmd('Runtime.enable');
await cmd('Page.enable');
const nick = `cd${Date.now() % 100000}${Math.floor(Math.random() * 900 + 100)}`;
await cmd('Page.navigate', { url: `http://localhost:8080/app?nick=${nick}&starter=4` });
await dormir(7000);

// escolhe uma hunt
await js(`document.querySelector('.menu-topo button[data-modal="mapa"]').click()`);
await dormir(2500);
await js(`document.querySelector('#mapa-mundi .marcador:not(.travado)').click()`);
await dormir(1200);
await js(`document.getElementById('modal-fechar').click()`);

// espera aparecer corpo no chão
let apareceu = false;
for (let i = 0; i < 60 && !apareceu; i++) {
  apareceu = await js(`!document.getElementById('caidos').classList.contains('hidden')`);
  if (!apareceu) await dormir(1000);
}
checar('painel de caídos aparece após derrotar', apareceu);

const quantos = await js(`document.querySelectorAll('#caidos-lista .caido').length`);
checar('lista tem pelo menos um caído', quantos > 0, `${quantos} no chão`);

// o corpo tem que continuar lá bem depois dos 2,6 s da onda seguinte
await dormir(9000);
const aindaLa = await js(`document.querySelectorAll('#caidos-lista .caido').length`);
checar('corpo dura além da próxima onda', aindaLa > 0, `${aindaLa} depois de 9 s`);

// arremessa nele
await js(`document.querySelector('#gaveta-abas button[data-gaveta="inventario"]').click()`);
await dormir(600);
const antes = Number((await js(`document.querySelector('#itens .inv-item b')?.textContent ?? '0'`)).replace(/\D/g, ''));
// guarda QUAL corpo recebeu a bola, para conferir que ele sai de cena
const alvo = await js(`
  const c = document.querySelector('#caidos-lista .caido');
  const s = c.dataset.slot; c.click(); s`);
// Espera a bolsa reagir em vez de dormir um tanto fixo: o desconto só aparece quando o
// snapshot seguinte chega (até 2×/s) e repinta o inventário.
let depois = antes;
for (let i = 0; i < 40 && depois !== antes - 1; i++) {
  await dormir(200);
  depois = Number((await js(`document.querySelector('#itens .inv-item b')?.textContent ?? '0'`)).replace(/\D/g, ''));
}
// Um time de um pokémon nível 5 às vezes desmaia no meio da caçada; aí o campo vira o
// Centro Pokémon e os corpos somem legitimamente. Não é falha do jogo — o teste diz isso
// em vez de acusar um bug que não existe.
const foiParaOCentro = await js(`!document.getElementById('centro-barra').classList.contains('hidden')`);
if (foiParaOCentro) {
  console.log('  (time desmaiou no meio: campo virou o Centro Pokémon, arremesso ignorado)');
} else {
  checar('clicar no caído gasta uma bola', depois === antes - 1, `${antes} → ${depois}`);
}

// É UMA tentativa por pokémon: capturado ou escapado, o corpo sai da lista. Sem isso a
// captura vira "despeje bolas no mesmo alvo até sair".
//
// Espera pela condição em vez de dormir um tanto fixo: o corpo sai do mapa no servidor na
// hora, mas a lista só muda quando o delta do campo chega e o timer de 250 ms repinta.
let alvoSumiu = false;
for (let i = 0; i < 30 && !alvoSumiu; i++) {
  alvoSumiu = await js(`!document.querySelector('#caidos-lista .caido[data-slot="${alvo}"]')`);
  if (!alvoSumiu) await dormir(200);
}
if (!foiParaOCentro) checar('o alvo sai da lista depois da tentativa', alvoSumiu === true, `slot ${alvo}`);

const { data: shot2 } = await cmd('Page.captureScreenshot', { format: 'png' });
await writeFile('teste-caidos.png', Buffer.from(shot2, 'base64'));

// e some depois dos 30 s
await dormir(26000);
const sumiu = await js(`document.getElementById('caidos').classList.contains('hidden')
  || document.querySelectorAll('#caidos-lista .caido').length`);
console.log(`  (após ~35 s do primeiro corpo: ${sumiu === true ? 'painel fechado' : sumiu + ' ainda no chão'})`);

if (erros.length) console.log(`\nerros no console: ${erros.slice(0, 4).join(' | ')}`);
const falhas = testes.filter((t) => !t).length;
console.log(`\n${testes.length - falhas}/${testes.length} passaram`);
ws.close(); proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(falhas ? 1 : 0);
