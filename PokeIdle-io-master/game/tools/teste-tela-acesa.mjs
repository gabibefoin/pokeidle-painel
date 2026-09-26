// A TELA SEMPRE ACESA (Screen Wake Lock), conferida no jogo de verdade.
//
//   node tools/teste-tela-acesa.mjs [url]
//
// O que se confere:
//
//   · no computador a linha nem aparece — aba minimizada já continua conectada lá;
//   · no celular ela aparece, e ligar PRENDE a trava de verdade (o `navigator.wakeLock`);
//   · a trava que o navegador solta ao esconder a página VOLTA sozinha quando ela reaparece —
//     é o caso de todo dia: o jogador olha o WhatsApp e volta;
//   · desligar solta; F5 com ela ligada prende de novo (no máximo no primeiro toque);
//   · num navegador sem a API a linha fica travada, explicando o porquê.
//
// Quem diz o estado é o `<html data-tela-acesa>` (`presa` | `pedida` | `solta`), que o
// `tela-acesa.mjs` mantém. A permissão do wake lock é dada ao Chrome headless por CDP — sem
// ela o pedido é recusado ali, mas não num celular de verdade.
//
// A conta nasce direto no banco, como no `teste-modo-economia.mjs`.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { criarConta, assinarSessao } from '../src/server/auth.mjs';

const NL = String.fromCharCode(10);
const ORIGEM = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
const NICK = `tla${Date.now() % 100000}`;

const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const c = await criarConta({ nick: NICK, email: `${NICK}@gmail.com`, senha: 'teste1234' });
await pool.query(`UPDATE accounts SET nick = $2, nick_ok = true, email_ok = true WHERE id = $1`, [c.id, NICK]);
const sessao = { nick: NICK, token: await assinarSessao({ nick: NICK, contaId: Number(c.id), provedor: c.provedor }) };
await pool.end();

const perfil = await mkdtemp(join(tmpdir(), 'tla-'));
const porta = 9300 + Math.floor(Math.random() * 200);
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, '--window-size=1500,950', 'about:blank'],
{ stdio: 'ignore', windowsHide: true });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let alvos = [];
for (let i = 0; i < 80; i++) {
  try {
    alvos = await fetch(`http://127.0.0.1:${porta}/json/list`).then((r) => r.json());
    if (alvos.some((a) => a.type === 'page')) break;
  } catch { /* subindo */ }
  await dormir(250);
}
const versao = await fetch(`http://127.0.0.1:${porta}/json/version`).then((r) => r.json());

/** Uma conexão CDP (a do navegador, para abas e permissões; a da página, para o resto). */
async function conectar(url) {
  const ws = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });
  let id = 0;
  const pend = new Map();
  const erros = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.error ? { erro: m.error } : m.result); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      erros.push((d.exception?.description ?? d.text ?? 'erro').split(NL).slice(0, 3).join(' <- ').slice(0, 300));
    }
  });
  const cmd = (metodo, params = {}) => new Promise((ok) => {
    const meu = ++id; pend.set(meu, ok);
    ws.send(JSON.stringify({ id: meu, method: metodo, params }));
  });
  return { ws, cmd, erros };
}

const nav = await conectar(versao.webSocketDebuggerUrl);
const pagina = alvos.find((a) => a.type === 'page');
const pg = await conectar(pagina.webSocketDebuggerUrl);
const js = async (e) =>
  (await pg.cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;
const estadoTrava = () => js('document.documentElement.dataset.telaAcesa');
const limparPorCima = () =>
  js("document.getElementById('discord-popup-fechar')?.click(); document.getElementById('tutorial-pular')?.click();");
const abrirConfig = async () => {
  await js("document.getElementById('btn-config').click()");
  await dormir(1200);
};
const fecharModal = () => js("document.querySelector('.modal-topo button')?.click()");

let falhas = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FALHA'} ${msg}`);
  if (!cond) falhas++;
};

await pg.cmd('Runtime.enable');
await pg.cmd('Page.enable');
const perm = await nav.cmd('Browser.grantPermissions', { origin: ORIGEM, permissions: ['wakeLockScreen'] });
if (perm?.erro) console.log('  (aviso) permissão do wake lock não concedida: ' + JSON.stringify(perm.erro));
await pg.cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: [
    `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))}); } catch (_) {}`,
    // `?semwakelock` simula o navegador antigo: sem a API, como um Safari antes do iOS 16.4.
    "if (location.search.includes('semwakelock')) { try { delete Navigator.prototype.wakeLock; } catch (_) {} }",
  ].join(NL),
});

console.log(`TELA SEMPRE ACESA · conta ${NICK} · ${ORIGEM}`);

// --------------------------------------------------------------- 1. computador
await pg.cmd('Page.navigate', { url: `${ORIGEM}/app?starter=4` });
await dormir(14000);
await limparPorCima();
await pg.cmd('Page.navigate', { url: `${ORIGEM}/app` });
await dormir(12000);
await limparPorCima();
await abrirConfig();
console.log(NL + 'No computador');
ok(!(await js("!!document.getElementById('cfg-tela-acesa')")), 'a linha nem aparece nas Configurações');
ok((await estadoTrava()) === 'solta', `nenhuma trava pedida (${await estadoTrava()})`);
await fecharModal();

// ------------------------------------------------------------------ 2. celular
await pg.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await pg.cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await pg.cmd('Page.navigate', { url: `${ORIGEM}/app` });
await dormir(12000);
await limparPorCima();
await abrirConfig();
console.log(NL + 'No celular');
ok(await js("!!document.getElementById('cfg-tela-acesa')"), 'a linha aparece nas Configurações');
ok(await js("!document.getElementById('cfg-tela-acesa')?.disabled"), 'e está liberada (o navegador tem a API)');
ok(await js("!document.getElementById('cfg-tela-acesa')?.classList.contains('on')"), 'e nasce DESLIGADA');
const ordem = await js(`[...document.querySelectorAll('#cfg-corpo .cfg-toggle')].map((b) => b.id).join(',')`);
ok(/cfg-economia,cfg-tela-acesa/.test(ordem), 'logo abaixo do Modo Economia');

await js("document.getElementById('cfg-tela-acesa').click()");
await dormir(1500);
ok(await js("document.getElementById('cfg-tela-acesa')?.classList.contains('on')"), 'o clique acende o interruptor');
ok((await estadoTrava()) === 'presa', `e PRENDE a trava de verdade (${await estadoTrava()})`);
ok(await js("localStorage.getItem('cfg-tela-acesa') === '1'"), 'e a escolha fica gravada');
await fecharModal();

// ---------------------------------------------- 3. esconde a página e volta
// Outra aba na frente é o "olhou o WhatsApp": o navegador solta a trava ao esconder a página.
const outra = await nav.cmd('Target.createTarget', { url: 'about:blank' });
await dormir(1500);
const visivelEscondida = await js('document.visibilityState');
const travaEscondida = await estadoTrava();
await nav.cmd('Target.activateTarget', { targetId: pagina.id });
await nav.cmd('Target.closeTarget', { targetId: outra.targetId });
await dormir(1500);
console.log(NL + 'Escondeu e voltou');
if (visivelEscondida === 'hidden') {
  ok(travaEscondida === 'pedida', `com a página escondida o navegador soltou a trava (${travaEscondida})`);
} else {
  console.log(`  (o headless não escondeu a página — visibilityState=${visivelEscondida}; o passo de soltar não pôde ser conferido)`);
}
ok((await estadoTrava()) === 'presa', `de volta à página, a trava volta sozinha (${await estadoTrava()})`);

// ------------------------------------------------------------ 4. desligar
await abrirConfig();
await js("document.getElementById('cfg-tela-acesa').click()");
await dormir(1000);
console.log(NL + 'Desligar');
ok((await estadoTrava()) === 'solta', `desligar solta a trava (${await estadoTrava()})`);
await fecharModal();

// -------------------------------------------------- 5. F5 com ela ligada
await js("localStorage.setItem('cfg-tela-acesa', '1')");
await pg.cmd('Page.navigate', { url: `${ORIGEM}/app` });
await dormir(12000);
await limparPorCima();
let depoisDoF5 = await estadoTrava();
if (depoisDoF5 !== 'presa') {
  // Sem gesto alguns navegadores recusam — o primeiro toque do jogador tem de resolver.
  await pg.cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400 }] });
  await pg.cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await dormir(1000);
}
console.log(NL + 'Depois do F5');
ok((await estadoTrava()) === 'presa', `a trava volta a ser presa (${depoisDoF5 === 'presa' ? 'sozinha' : 'no primeiro toque'})`);

// ------------------------------------------------ 6. navegador sem a API
await pg.cmd('Page.navigate', { url: `${ORIGEM}/app?semwakelock=1` });
await dormir(12000);
await limparPorCima();
await abrirConfig();
console.log(NL + 'Navegador sem a API');
ok(await js("!!document.getElementById('cfg-tela-acesa')?.disabled"), 'a linha aparece TRAVADA');
const desc = await js("document.getElementById('cfg-tela-acesa')?.parentElement.querySelector('.cfg-desc')?.textContent ?? ''");
ok(/iOS 16\.4/.test(desc), 'e explica o porquê');
ok((await estadoTrava()) !== 'presa', 'e nenhuma trava é presa');

ok(pg.erros.length === 0, `sem erro no console${pg.erros.length ? ': ' + pg.erros.slice(0, 3).join(' | ') : ''}`);
console.log(NL + (falhas ? `${falhas} FALHA(S)` : 'tudo certo'));

pg.ws.close();
nav.ws.close();
proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(falhas ? 1 : 0);
