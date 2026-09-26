// Teste da LANDING PAGE — o caminho que o jogador novo faz de verdade.
//
//   node tools/teste-landing.mjs [prefixo-das-capturas]
//
// Precisa do servidor local no ar (`npm start`, com `docker compose up -d`).
//
// O que ele garante, em ordem:
//
//   1. `/` serve a LANDING, e não o jogo. Se alguém reverter o mapa `PAGINAS` do gateway, é
//      aqui que aparece — e o sintoma em produção seria a campanha inteira caindo na tela de
//      login.
//   2. A landing pinta sem erro de console e com o CTA principal visível SEM ROLAR. Botão de
//      conversão abaixo da dobra é o mesmo que não ter botão.
//   3. Clicar em "Jogar grátis" leva a `/app` e a tela de carregamento aparece — que é o
//      pedido de produto: da landing para a barrinha, sem passo intermediário.
//   4. Quem JÁ TEM sessão no `localStorage` não vê a landing: `/` reenvia para `/app`
//      sozinho, com a query string junto. É o que impede a página de venda de virar pedágio
//      de quem joga todo dia — e o que faz o retorno do OAuth (`?sessao=`) continuar de pé.
//   5. A página não rola na horizontal a 390 px, a largura de celular mais comum.
//   6. A meta de 100 mil treinadores: `/treinadores` devolve a contagem de contas, e a landing
//      mostra o bloco com o MESMO número e a barra cheia até ele.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';

const prefixo = process.argv[2] ?? 'teste-landing';
const BASE = process.env.HTTP_URL ?? 'http://localhost:8080';

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome não encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'land-'));
const porta = 9800 + Math.floor(Math.random() * 90);
const proc = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--hide-scrollbars', '--mute-audio',
  '--force-device-scale-factor=1', '--window-size=1440,900',
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let pagina;
for (let i = 0; i < 80 && !pagina; i++) {
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
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    erros.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  }
});
const cmd = (metodo, params = {}) => new Promise((ok) => {
  const meu = ++id; pend.set(meu, ok);
  ws.send(JSON.stringify({ id: meu, method: metodo, params }));
});
const js = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
};
// `cmd` resolve com a MENSAGEM inteira do CDP (`{ id, result }`), não com o `result` — é o
// que permite ler `exceptionDetails` no `js()`. Quem quer o payload desce mais um nível.
const shot = async (nome) => {
  const r = await cmd('Page.captureScreenshot', { format: 'png' });
  await writeFile(nome, Buffer.from(r.result.data, 'base64'));
};

await cmd('Runtime.enable');
await cmd('Page.enable');

const falhas = [];
const checar = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) falhas.push(msg); };

// ─────────────────────────────────────────────── 1. a raiz serve a landing
console.log('\n1. a raiz serve a landing');
await cmd('Page.navigate', { url: `${BASE}/` });
await dormir(2500);
checar(await js("location.pathname === '/'"), 'ficou em / (não redirecionou sem sessão)');
checar(await js('!!document.querySelector(\'a[href="/app"]\')'), 'tem link para /app');
checar(await js("document.title.includes('idle')"), `título: ${await js('document.title')}`);

// ─────────────────────────────── 2. o CTA aparece SEM ROLAR (acima da dobra)
console.log('\n2. o CTA principal está acima da dobra');
const cta = await js(`(() => {
  const b = document.querySelector('.heroi-botoes .cta-grande');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { base: Math.round(r.bottom), alt: innerHeight, texto: b.innerText.trim() };
})()`);
checar(!!cta, 'o botão do herói existe');
if (cta) {
  checar(cta.base <= cta.alt, `visível sem rolar (base ${cta.base} ≤ dobra ${cta.alt})`);
  // O RÓTULO do botão, que é português e continua sendo "Jogar grátis". Não confundir com o
  // endereço para onde ele aponta, que é `/app`.
  checar(/jogar/i.test(cta.texto), `diz "${cta.texto}"`);
}
checar(erros.length === 0, `sem erro de console${erros.length ? `: ${erros[0]}` : ''}`);
await shot(`${prefixo}-1-landing.png`);

// ────────────────────────────── 3. clicar leva ao jogo E à tela de carregamento
console.log('\n3. "Jogar grátis" → /app → tela de carregamento');
await js("document.querySelector('.heroi-botoes .cta-grande').click()");
await dormir(3500);
checar(await js("location.pathname === '/app'"), `foi para /app (está em ${await js('location.pathname')})`);
const carga = await js(`(() => {
  const p = document.getElementById('portal');
  const c = document.getElementById('carregando');
  if (!p || !c) return null;
  return {
    portalVisivel: getComputedStyle(p).display !== 'none' && !p.classList.contains('hidden'),
    cargaVisivel: getComputedStyle(c).display !== 'none' && !c.classList.contains('hidden'),
    pct: document.getElementById('carga-pct')?.textContent ?? '?',
  };
})()`);
checar(!!carga, 'o portal do jogo existe na página');
if (carga) {
  checar(carga.portalVisivel, 'o portal está na tela');
  // A barra pode já ter terminado e dado lugar ao login — as duas coisas são "chegou no jogo".
  const login = await js("!document.getElementById('login')?.classList.contains('hidden')");
  checar(carga.cargaVisivel || login,
    `a barra de carregamento apareceu (${carga.pct}%)${login ? ' e já passou para o login' : ''}`);
}
await shot(`${prefixo}-2-carregando.png`);

// ───────────────────────────── 4. quem já tem sessão não passa pela landing
console.log('\n4. quem já tem sessão pula a landing');
await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: "try { localStorage.setItem('sessao', JSON.stringify({ nick: 'x', token: 'y' })); } catch (_) {}",
});
await cmd('Page.navigate', { url: `${BASE}/?hunt=teste` });
await dormir(2500);
const depois = await js('location.pathname + location.search');
checar(depois.startsWith('/app'), `foi direto para o jogo (${depois})`);
checar(depois.includes('hunt=teste'), 'a query string foi junto (o retorno do OAuth depende disso)');

// ─────────────────────────────────────── 5. no celular, sem rolagem horizontal
console.log('\n5. celular a 390 px');
await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: "try { localStorage.removeItem('sessao'); } catch (_) {}",
});
await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cmd('Page.navigate', { url: `${BASE}/` });
await dormir(2500);
const movel = await js(`({
  scroll: document.documentElement.scrollWidth, larg: innerWidth,
  barra: !!document.querySelector('.barra-fixa'),
})`);
checar(movel.scroll <= movel.larg + 1, `sem rolagem horizontal (${movel.scroll} ≤ ${movel.larg})`);
checar(movel.barra, 'a barra fixa de CTA está montada');
await shot(`${prefixo}-3-celular.png`);

// ─────────────────────────────────────── 6. a meta de 100 mil treinadores
console.log('\n6. a meta de treinadores');
const metaApi = await fetch(`${BASE}/treinadores`).then((r) => r.json()).catch(() => null);
checar(!!metaApi?.ok && Number.isInteger(metaApi.total) && metaApi.total >= 0 && metaApi.meta === 100000,
  `/treinadores responde a contagem de contas (${metaApi?.total ?? '?'} de ${metaApi?.meta ?? '?'})`);
await js("document.getElementById('meta-treinadores')?.scrollIntoView({ block: 'center' })");
await dormir(2600);
const metaTela = await js(`(() => {
  const m = document.getElementById('meta-treinadores');
  if (!m) return null;
  return {
    visivel: !m.hidden,
    total: document.getElementById('meta-total').textContent,
    p: getComputedStyle(m.querySelector('.meta-barra')).getPropertyValue('--p').trim(),
  };
})()`);
checar(!!metaTela?.visivel, 'o bloco da meta aparece na landing');
if (metaApi?.ok && metaTela) {
  checar(metaTela.total === metaApi.total.toLocaleString('pt-BR'), `o total na tela bate com a contagem (${metaTela.total})`);
}
checar(!!metaTela?.p, `a barra encheu (--p ${metaTela?.p || 'vazio'})`);
await shot(`${prefixo}-4-meta.png`);

console.log(falhas.length ? `\n${falhas.length} FALHA(S):\n  · ${falhas.join('\n  · ')}\n` : '\ntudo certo.\n');

ws.close(); proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(falhas.length ? 1 : 0);
