// Teste do Centro Pokémon: quando o time inteiro cai, o botão de curar TEM que aparecer.
//
// Existe por causa de um bug intermitente: `irParaOCentro` mudava `noCentro` sem marcar o
// jogador para sincronizar, então o botão só aparecia se a bandeira por acaso ainda
// estivesse de pé de outra mudança. Metade das vezes o jogador ficava preso na cena do
// Centro sem botão nenhum.
//
// O botão hoje flutua em cima da Enfermeira Joy, dentro da cena — o `.fora` do teste abaixo é
// justamente ele: a classe que o esconde quando ela sai do quadro.
//
// Para a queda ser rápida e certa, o pokémon vai para 1 de HP direto no banco — mas só
// DEPOIS de desconectar. Com a sessão viva, o flush de saída sobrescreveria a alteração;
// como `sair()` grava na hora e `entrar()` espera essa gravação, mexer com o jogador fora
// do ar é seguro.
//
//   node tools/teste-centro.mjs
import { spawn, execFileSync } from 'node:child_process';
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
const perfil = await mkdtemp(join(tmpdir(), 'centro-'));
const porta = 9850 + Math.floor(Math.random() * 120);
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
});
const cmd = (mt, p = {}) => new Promise((ok) => { const i = ++id; pend.set(i, ok); ws.send(JSON.stringify({ id: i, method: mt, params: p })); });
const js = async (e) => {
  const r = await cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) erros.push('evaluate: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  return r?.result?.value;
};
async function esperarPor(seletor, ms = 20000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await js(`!!document.querySelector(${JSON.stringify(seletor)})`)) return true;
    await dormir(250);
  }
  throw new Error(`"${seletor}" não apareceu`);
}

const testes = [];
const checar = (nome, ok, det = '') => {
  testes.push(ok);
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}${det ? ` — ${det}` : ''}`);
};

await cmd('Runtime.enable');
await cmd('Page.enable');

// O bug era um cara-ou-coroa contra o intervalo de 500 ms entre snapshots. Uma rodada só
// passaria por sorte, então repete — se a caixa depender de sorte, alguma volta pega.
const RODADAS = 5;
const MIN_QUEDAS = 2; // abaixo disso o teste não observou o bastante para afirmar nada
let apareceuSempre = true;
let autoReviveDesligada = true;
let quedas = 0;

for (let r = 1; r <= RODADAS; r++) {
  const nick = `ct${Date.now() % 100000}${Math.floor(Math.random() * 900 + 100)}`;
  await cmd('Page.navigate', { url: `http://localhost:8080/app?nick=${nick}&starter=4` });
  await esperarPor('#ativo-card .ativo-nome');
  await dormir(1000);

  // A auto-revive precisa estar DESLIGADA, senão o time não chega a cair — e ela passou a
  // NASCER ligada (ver `carregarJogador` em `sim.mjs`). Então o teste a desliga em vez de
  // contar com o padrão, junto com a auto-poção e a volta automática à hunt, que pelo mesmo
  // motivo manteriam o time de pé (ou o tirariam do Centro antes da conferência).
  await js(`for (const id of ['auto-revive', 'auto-potion', 'auto-voltar-hunt']) {
    const c = document.getElementById(id);
    if (c?.checked) { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }
  }`);
  await dormir(700);
  const reviveLigado = await js(`document.getElementById('auto-revive').checked`);
  if (reviveLigado) autoReviveDesligada = false;

  // desconecta, deixa o pokémon com 1 de HP e volta
  await cmd('Page.navigate', { url: 'about:blank' });
  await dormir(1500);
  execFileSync('docker', ['exec', '-i', 'game-postgres-1', 'psql', '-U', 'poke', '-d', 'pokeidle', '-c',
    `UPDATE player_pokemon SET hp = 1 WHERE player_id = (SELECT id FROM players WHERE nick = '${nick}');`]);
  await cmd('Page.navigate', { url: `http://localhost:8080/app?nick=${nick}` });
  await esperarPor('#ativo-card .ativo-nome');
  await dormir(800);

  // entra numa hunt qualquer e espera o time cair
  await js(`document.querySelector('.menu-topo button[data-modal="mapa"]').click()`);
  await esperarPor('#mapa-mundi .marcador');
  await js(`document.querySelector('#mapa-mundi .marcador:not(.travado)').click()`);
  await dormir(1000);
  await js(`document.getElementById('modal-fechar').click()`);

  let caiu = false;
  for (let i = 0; i < 40 && !caiu; i++) {
    caiu = await js(`[...document.querySelectorAll('#hud-log div')].some(e => /nocauteado/.test(e.textContent))`);
    if (!caiu) await dormir(1000);
  }
  if (!caiu) {
    console.log(`  (rodada ${r}: o time não caiu a tempo, pulando)`);
    continue;
  }

  // o botão tem que vir junto — espera bem mais que os 500 ms do intervalo de snapshot
  let botao = false;
  for (let i = 0; i < 25 && !botao; i++) {
    botao = await js(
      `(b => !b.classList.contains('hidden') && !b.classList.contains('fora'))(document.getElementById('centro-curar'))`,
    );
    if (!botao) await dormir(200);
  }
  quedas++;
  if (!botao) apareceuSempre = false;
  console.log(`  rodada ${r}: botão de curar ${botao ? 'apareceu' : 'NÃO APARECEU'}`);

  if (r === 1 && botao) {
    const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
    await writeFile('teste-centro.png', Buffer.from(data, 'base64'));

    // e o botão tem que curar de verdade. O botão NÃO some depois (ele é a enfermeira, e ela
    // continua ali), então quem confirma a cura é o log da cena.
    await js(`document.getElementById('centro-curar').click()`);
    let curou = false;
    for (let i = 0; i < 30 && !curou; i++) {
      await dormir(250);
      curou = await js(`[...document.querySelectorAll('#hud-log div')].some(e => /curou o seu time/.test(e.textContent))`);
    }
    checar('o botão em cima da Joy cura o time', curou === true);
  }
}

checar('o teste conseguiu desligar a auto-revive (senão o time não cairia)', autoReviveDesligada === true);
// Sem este piso o teste passaria de graça numa corrida em que o time nunca caísse —
// exatamente o tipo de teste que dá falsa segurança.
checar(`o time caiu vezes suficientes para afirmar algo (${quedas} de ${RODADAS})`, quedas >= MIN_QUEDAS);
checar(`botão de curar apareceu em todas as ${quedas} quedas`, apareceuSempre === true && quedas > 0);

if (erros.length) console.log(`\nerros no console: ${erros.slice(0, 3).join(' | ')}`);
const falhas = testes.filter((t) => !t).length;
console.log(`\n${testes.length - falhas}/${testes.length} passaram · screenshot em teste-centro.png`);
ws.close(); proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(falhas ? 1 : 0);
