// Teste de UI de verdade: digita com eventos de teclado reais via CDP.
//
// Existe porque entrar pela URL (?nick=) não exercita o teclado — e foi exatamente aí que
// passou um bug em que `onkeydown` retornando false cancelava a digitação.
//
//   node tools/teste-ui.mjs [url]
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { urlEntrada } from './auth-teste.mjs';

// A ORIGEM (host), não o endereço da página: as rotas `/auth/*` penduram no host, e a
// página do jogo mora em `/app` desde que a raiz virou a landing.
const ORIGEM = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
const URL_BASE = `${ORIGEM}/app`;
const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'ui-'));
const porta = 9800 + Math.floor(Math.random() * 300);
const proc = spawn(
  chrome,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
   `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, '--window-size=1500,900', 'about:blank'],
  { stdio: 'ignore', windowsHide: true },
);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

let pagina;
for (let i = 0; i < 60 && !pagina; i++) {
  try {
    const abas = await fetch(`http://127.0.0.1:${porta}/json/list`).then((r) => r.json());
    pagina = abas.find((a) => a.type === 'page' && a.webSocketDebuggerUrl);
  } catch {}
  if (!pagina) await dormir(250);
}
if (!pagina) throw new Error('Chrome não abriu a porta de debug');

const ws = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });

let id = 0;
const pendentes = new Map();
const errosConsole = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pendentes.has(m.id)) { pendentes.get(m.id)(m.result); pendentes.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errosConsole.push(m.params.exceptionDetails.text);
});
const cmd = (method, params = {}) =>
  new Promise((ok) => { const meu = ++id; pendentes.set(meu, ok); ws.send(JSON.stringify({ id: meu, method, params })); });

const js = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
};

/** Digita caractere a caractere com keyDown/char/keyUp — como um humano. */
async function digitar(texto) {
  for (const ch of texto) {
    await cmd('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch });
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await dormir(25);
  }
}

async function tecla(key, code, keyCode) {
  await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode });
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
}

const testes = [];
const checar = (nome, ok, detalhe = '') => {
  testes.push({ nome, ok, detalhe });
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

/** Espera um seletor aparecer. Melhor que `dormir` fixo: a tela de carregamento leva o tempo
    que a rede levar, e um número mágico aqui falharia sozinho em máquina lenta. */
async function esperarPor(seletor, ms = 15000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await js(`!!document.querySelector(${JSON.stringify(seletor)})`)) return true;
    await dormir(250);
  }
  throw new Error(`"${seletor}" não apareceu em ${ms}ms`);
}

await cmd('Runtime.enable');
await cmd('Page.enable');
await cmd('Page.navigate', { url: URL_BASE });

// A tela de carregamento vem antes do login: espera ela sair (ou desistir) em vez de dormir
// um tempo fixo, que numa máquina lenta pegaria a barra ainda a meio caminho.
await esperarPor('#login:not(.hidden) #login-id', 25000);

// 1. CRIAR CONTA, digitando de verdade
//
// O jogo não tem mais "entrar sem conta": a porta é conta com senha ou provedor. Então o
// caminho de teclado a exercitar é o cadastro — quatro campos, Tab entre eles e Enter no fim,
// que é exatamente onde um bug de `onkeydown` se esconde.
const nick = `ui${Date.now() % 100000}`;
const senha = 'segredo12345';

await js(`[...document.querySelectorAll('.login-aba')].find(b => b.dataset.aba === 'criar').click()`);
await esperarPor('#form-criar:not(.hidden) #cad-nick');

for (const [campo, texto] of [
  ['cad-nick', nick],
  ['cad-email', `${nick}@exemplo.com`],
  ['cad-senha', senha],
  ['cad-senha2', senha],
]) {
  await js(`document.getElementById('${campo}').focus(); document.getElementById('${campo}').value = ''`);
  await digitar(texto);
}
const valor = await js(`document.getElementById('cad-nick').value`);
checar('digitar no campo de nick', valor === nick, `valor="${valor}" esperado="${nick}"`);

// 2. Enter fecha o cadastro
//
// Com o Resend configurado, criar conta NÃO entra no jogo: o servidor manda confirmar o
// e-mail e a tela troca para o aviso. Sem Resend, a conta entra na hora — o teste aceita as
// duas saídas porque as duas são o comportamento correto do ambiente em que ele está rodando.
await tecla('Enter', 'Enter', 13);
await dormir(5000);
const confirmando = await js(`!document.getElementById('confirmar-email').classList.contains('hidden')`);
const appVisivel = await js(`!document.getElementById('app').classList.contains('hidden')`);
checar('Enter conclui o cadastro', confirmando || appVisivel,
  `confirmação=${confirmando} jogo=${appVisivel}`);
if (confirmando) {
  const texto = await js(`document.getElementById('confirma-texto').textContent`);
  checar('a tela diz para onde o link foi', texto.includes('@'), `texto="${texto.slice(0, 60)}"`);
  const { data: pngConfirma } = await cmd('Page.captureScreenshot', { format: 'png' });
  await writeFile('teste-confirmar-email.png', Buffer.from(pngConfirma, 'base64'));
}

// 3. entrar no jogo e passar pelo onboarding
//
// Quem já entrou no passo 2 (sem Resend) continua na mesma aba. Quem precisou confirmar
// e-mail pula este bloco. Os demais abrem com sessão assinada — o mesmo caminho do OAuth.
if (!confirmando) {
  const jaNoJogo = await js(`!document.getElementById('app').classList.contains('hidden')`);
  if (!jaNoJogo) {
    const url = await urlEntrada(nick, ORIGEM);
    await cmd('Page.navigate', { url });
  }
  await esperarPor('#onboarding:not(.hidden) .ob-genero', 30000);

const generos = await js(`document.querySelectorAll('.ob-genero').length`);
checar('onboarding pergunta o gênero antes de tudo', generos === 2, `${generos} opções`);
const starterAntes = await js(`document.querySelectorAll('#ob-starters .starter-card').length`);
checar('o starter não aparece antes do visual', starterAntes === 0, `${starterAntes} opções`);

await js(`document.querySelectorAll('.ob-genero')[0].click()`);
await dormir(600);
const pecas = await js(`document.querySelectorAll('.ob-peca').length`);
checar('editor com as quatro regiões da máscara', pecas === 4, `${pecas} regiões`);

await js(`document.getElementById('ob-pronto').click()`);
await dormir(1200);

const nickNaTela = await js(`document.getElementById('tr-nick').textContent`);
checar('estado do servidor chegou', nickNaTela === nick, `tr-nick="${nickNaTela}"`);

// 4. escolher o starter — o último passo do onboarding
const cardsStarter = await js(`document.querySelectorAll('#ob-starters .starter-card').length`);
checar('escolha de starter aparece', cardsStarter === 3, `${cardsStarter} opções`);

await js(`document.querySelector('#ob-starters .starter-card[data-especie="4"]').click()`);
await dormir(3000);
const starterFechou = await js(`document.getElementById('onboarding').classList.contains('hidden')`);
const emCampo = await js(`document.querySelector('#ativo-card .ativo-nome')?.textContent ?? ''`);
checar('starter escolhido entra em campo', starterFechou && emCampo.includes('Charmander'), `em campo="${emCampo}"`);

// 4. escolher uma hunt no mapa-múndi (marcadores entram depois que a imagem carrega)
await js(`document.querySelector('.menu-topo button[data-modal="mapa"]').click()`);
await dormir(2500);
const temMarcadores = await js(`document.querySelectorAll('#mapa-mundi .marcador').length`);
checar('mapa-múndi planta os marcadores', temMarcadores > 100, `${temMarcadores} marcadores`);

const comFiltro = await js(`
  document.querySelector('#f-tipos .tipo-btn[data-tipo="WATER"]').click();
  new Promise(ok => setTimeout(() => ok(document.querySelectorAll('#mapa-mundi .marcador').length), 1500))`);
checar('filtro por tipo corta a lista', comFiltro > 0 && comFiltro < temMarcadores, `${comFiltro} áreas de água`);

await js(`document.querySelector('#f-tipos .tipo-btn[data-tipo=""]').click()`);
await dormir(1500);

// a lupa aproxima e afasta (a tela do mapa cresce/encolhe junto)
const larguraTela = () => js(`document.getElementById('mapa-tela').getBoundingClientRect().width`);
const antesZoom = await larguraTela();
await js(`document.getElementById('zoom-mais').click(); document.getElementById('zoom-mais').click()`);
await dormir(500);
const aproximado = await larguraTela();
await js(`for (let i = 0; i < 6; i++) document.getElementById('zoom-menos').click()`);
await dormir(500);
const afastado = await larguraTela();
checar(
  'lupa aproxima e afasta o mapa',
  aproximado > antesZoom * 1.5 && afastado < aproximado,
  `${antesZoom | 0}px → +zoom ${aproximado | 0}px → −zoom ${afastado | 0}px`,
);

await js(`document.querySelector('#mapa-mundi .marcador:not(.travado)').click()`);
await dormir(5000);
const huntAtiva = await js(`document.getElementById('hud-hunt').textContent`);
checar('hunt selecionada', !huntAtiva.includes('escolha'), huntAtiva);

// 5. o zoom da cena de batalha (lupas sobre o palco)
const zoomCena = () => js(`document.getElementById('palco').dataset.zoom`);
const zoomInicial = await zoomCena();
await js(`document.getElementById('cena-zoom-menos').click()`);
await dormir(250);
const maisLonge = await zoomCena();
await js(`document.getElementById('cena-zoom-mais').click(); document.getElementById('cena-zoom-mais').click()`);
await dormir(250);
const maisPerto = await zoomCena();
checar(
  'lupa da batalha aproxima e afasta',
  Number(maisLonge) < Number(zoomInicial) && Number(maisPerto) > Number(maisLonge),
  `${zoomInicial}× → −zoom ${maisLonge}× → +zoom ${maisPerto}×`,
);

// 6. as gavetas da esquerda abrem uma de cada vez
const escondido = (sel) => js(`document.querySelector('${sel}').classList.contains('hidden')`);
await js(`document.querySelector('#gaveta-abas button[data-gaveta="depot"]').click()`);
await dormir(300);
const depotAberto = (await escondido('[data-painel="depot"]')) === false && (await escondido('[data-painel="inventario"]')) === true;
checar('clicar em Depot abre só o Depot', depotAberto);

await js(`document.querySelector('#gaveta-abas button[data-gaveta="inventario"]').click()`);
await dormir(300);
const trocou = (await escondido('[data-painel="inventario"]')) === false && (await escondido('[data-painel="depot"]')) === true;
checar('clicar na Bolsa fecha o Depot', trocou);

// 7. digitar e enviar no chat
await js(`document.getElementById('chat-input').focus()`);
await digitar('teste de chat');
const chatValor = await js(`document.getElementById('chat-input').value`);
checar('digitar no chat', chatValor === 'teste de chat', `valor="${chatValor}"`);

await tecla('Enter', 'Enter', 13);
await dormir(1200);
const msgs = await js(`document.querySelectorAll('#chat-msgs div').length`);
const limpou = await js(`document.getElementById('chat-input').value === ''`);
checar('Enter envia a mensagem', msgs > 0 && limpou, `${msgs} mensagem(ns) na aba`);

// 8. a batalha está rodando
await dormir(4000);
const linhasLog = await js(`document.querySelectorAll('#hud-log div').length`);
checar('batalha gerando eventos', linhasLog >= 2, `${linhasLog} linhas de log`);

const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
await writeFile('teste-ui.png', Buffer.from(data, 'base64'));
}

if (errosConsole.length) console.log(`\nerros no console: ${errosConsole.slice(0, 3).join(' | ')}`);

const falhas = testes.filter((t) => !t.ok).length;
console.log(`\n${testes.length - falhas}/${testes.length} passaram · screenshot em teste-ui.png`);

ws.close();
proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(falhas ? 1 : 0);
