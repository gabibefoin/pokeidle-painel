// Captura uma tela do jogo COMO NO CELULAR — mesma ideia do `tela.mjs`, com o Chrome em modo
// de dispositivo (viewport de telefone, `pointer: coarse`, toque de verdade).
//
//   node tools/tela-mobile.mjs <saida.png> [modal] [seletor-para-recortar]
//
// `modal` é o `data-modal` de um botão do menu (mapa, pokedex, market…) — ou, começando com
// `.`, `#` ou `[`, um seletor qualquer para clicar antes de capturar.
//
// Variáveis de ambiente:
//   APARELHO=iphone|iphone-max|android|android-pequeno|ipad|deitado   (padrão: iphone)
//   NICK=<nome>      reaproveita uma conta que já existe
//   HUNT=<slug>      cai direto na área
//   ABA=<nome>       abre uma gaveta do rodapé antes de capturar (equipe, bolsa, auto, chat, menu)
//   ESPERA=<ms>      folga extra depois de abrir a tela
//   SEGUNDO_CLIQUE=<seletor>
//
//   node tools/tela-mobile.mjs m-jogo.png
//   node tools/tela-mobile.mjs m-mapa.png mapa
//   APARELHO=android node tools/tela-mobile.mjs m-chat.png "" ""
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { sessaoPara, sessaoParaUrl } from './auth-teste.mjs';
import { sessaoDe, fecharBanco } from './sessao-local.mjs';

const [saida, modal = '', recorte = ''] = process.argv.slice(2);
if (!saida) {
  console.error('uso: node tools/tela-mobile.mjs <saida.png> [modal] [seletor]');
  process.exit(1);
}

/**
 * Os aparelhos de referência. São os que cobrem o que se vê de verdade num painel de acessos:
 * o iPhone comum (390), o iPhone grande (430), o Android mediano (412), o Android baratinho
 * (360 — o piso real de largura hoje) e o tablet. `deitado` é o mesmo iPhone virado, que é
 * onde o layout de coluna quebra primeiro.
 */
const APARELHOS = {
  iphone: { larg: 390, alt: 844, dpr: 3, ua: 'iPhone' },
  'iphone-max': { larg: 430, alt: 932, dpr: 3, ua: 'iPhone' },
  android: { larg: 412, alt: 915, dpr: 2.6, ua: 'Android' },
  'android-pequeno': { larg: 360, alt: 800, dpr: 3, ua: 'Android' },
  ipad: { larg: 820, alt: 1180, dpr: 2, ua: 'iPad' },
  deitado: { larg: 844, alt: 390, dpr: 3, ua: 'iPhone' },
};
const UAS = {
  iPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  Android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  iPad:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

const ap = APARELHOS[process.env.APARELHO ?? 'iphone'];
if (!ap) throw new Error(`aparelho desconhecido: ${process.env.APARELHO} (${Object.keys(APARELHOS).join(', ')})`);

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'telam-'));
const porta = 9700 + Math.floor(Math.random() * 250);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`,
  `--window-size=${Math.max(ap.larg, 500)},${Math.max(ap.alt, 500)}`, 'about:blank',
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
if (!pagina) throw new Error('Chrome não abriu a porta de debug');

const ws = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });
let id = 0;
const pend = new Map();
const erros = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') erros.push(m.params.exceptionDetails.text);
});
const cmd = (metodo, params = {}) => new Promise((ok) => {
  const meu = ++id; pend.set(meu, ok);
  ws.send(JSON.stringify({ id: meu, method: metodo, params }));
});
const js = async (expr) =>
  (await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

await cmd('Runtime.enable');
await cmd('Page.enable');

// O que faz a página ACREDITAR que é um celular: viewport do aparelho, `mobile: true` (é isso
// que liga `pointer: coarse`/`hover: none` junto do toque) e o user-agent do sistema — sem ele
// nada muda para código que farejar a string.
await cmd('Emulation.setDeviceMetricsOverride', {
  width: ap.larg, height: ap.alt, deviceScaleFactor: ap.dpr, mobile: true,
  screenWidth: ap.larg, screenHeight: ap.alt,
});
await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cmd('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
await cmd('Emulation.setUserAgentOverride', {
  userAgent: UAS[ap.ua],
  platform: ap.ua === 'Android' ? 'Linux armv8l' : 'iPhone',
});

// A conta de teste entra por sessão assinada (o `?nick=` de antes já não existe). Cria na
// primeira corrida e reaproveita nas seguintes — com `NICK=<nome>` dá para conferir uma tela
// que depende de estado acumulado (saldo, equipe cheia, anúncios no mercado).
//
// A sessão é semeada no localStorage ANTES de a página existir, e não por `?sessao=`: aquele
// caminho limpa a barra de endereço assim que lê o token, e leva junto o `?starter=` que faz o
// onboarding se resolver sozinho — a captura ficava parada na escolha do inicial.

/**
 * A sessão: conta que JÁ EXISTE (`NICK=<nome>`) ou conta nova de teste.
 *
 * `NICK` passa pelo `sessao-local.mjs`, que assina o token direto contra o banco. Antes ele ia
 * pelo `/auth/entrar` com a senha padrão de teste — o que nunca funcionou para conta de
 * verdade (senha diferente, ou login por Google) e é justamente o caso em que se quer `NICK`:
 * capturar uma tela que depende de progresso acumulado.
 *
 * Sem `NICK`, segue o caminho de sempre — cria uma conta pela rota pública, para a captura
 * nascer do mesmo estado inicial toda vez.
 */
const nick = process.env.NICK || `m${Date.now() % 100000}`;
const sessao = process.env.NICK
  ? await sessaoDe(process.env.NICK).finally(fecharBanco)
  : await sessaoPara(nick);
const hunt = process.env.HUNT ? `&hunt=${encodeURIComponent(process.env.HUNT)}` : '';
await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))}); } catch (_) {}`,
});
await cmd('Page.navigate', { url: `http://localhost:8080/app?starter=4${hunt}` });
await dormir(9000);

// O pop-up do Discord aparece a cada visita e cobriria toda captura.
await js(`document.getElementById('discord-popup-fechar')?.click()`);
await dormir(300);

if (process.env.ABA) {
  await js(`document.querySelector('.m-nav button[data-aba="${process.env.ABA}"]')?.click()`);
  await dormir(700);
}

// `ANTES=<expressao>` roda na página já montada, antes dos cliques — serve para pôr a tela no
// estado exato de um relato ("com a gaveta rolada até o fim", por exemplo).
if (process.env.ANTES) {
  await js(process.env.ANTES);
  await dormir(300);
}

if (modal) {
  const alvo = /^[.#[]/.test(modal)
    ? modal
    : `.menu-topo button[data-modal="${modal}"]`;
  // No celular o menu do topo vive na gaveta "Menu": abre antes de procurar o botão.
  if (!/^[.#[]/.test(modal)) {
    await js(`document.querySelector('.m-nav button[data-aba="menu"]')?.click()`);
    await dormir(500);
  }
  await js(`document.querySelector(${JSON.stringify(alvo)})?.click()`);
  await dormir(3000);

  const seg = process.env.SEGUNDO_CLIQUE;
  if (seg) {
    await js(`document.querySelector(${JSON.stringify(seg)})?.click()`);
    await dormir(2500);
  }
}

// `ROLAR=<seletor>` desce aquele elemento até o fim antes de capturar — é como se confere o
// pé de uma gaveta ou de um modal que não cabe na tela.
if (process.env.ROLAR) {
  await js(`(() => { const el = document.querySelector(${JSON.stringify(process.env.ROLAR)}); if (el) el.scrollTop = el.scrollHeight; })()`);
  await dormir(500);
}

if (process.env.ESPERA) await dormir(Number(process.env.ESPERA));

// `AVALIAR=<expressao>` imprime o que a expressão devolver, na página já montada. É a lupa
// para quando o print mostra que algo está errado mas não POR QUE — medir a caixa na hora
// evita o palpite de CSS.
if (process.env.AVALIAR) {
  console.log(await js(process.env.AVALIAR));
}

let clip;
if (recorte) {
  const r = await js(`JSON.stringify(document.querySelector(${JSON.stringify(recorte)}).getBoundingClientRect().toJSON())`);
  const b = JSON.parse(r);
  clip = { x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 14, scale: 2 };
}

const { data } = await cmd('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
await writeFile(saida, Buffer.from(data, 'base64'));

// O diagnóstico que interessa numa tela de celular: o que estourou a largura e o que ficou
// menor que o alvo de toque de 44 px. Sai no terminal junto do print.
const diag = await js(`(() => {
  const doc = document.documentElement;
  const largura = doc.clientWidth;
  const estoura = [];
  for (const el of document.querySelectorAll('#app *, .modal:not(.hidden) *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > largura + 1.5 || r.left < -1.5) {
      estoura.push((el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0,2).join('.') : el.tagName)
        + ' [' + Math.round(r.left) + '→' + Math.round(r.right) + ']');
    }
  }
  const pequenos = [];
  for (const el of document.querySelectorAll('#app button, #app a, #app input, .modal:not(.hidden) button, .modal:not(.hidden) a, .modal:not(.hidden) input, .modal:not(.hidden) select')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 32 || r.width < 26) {
      pequenos.push((el.id ? '#' + el.id : '.' + String(el.className).split(' ').filter(Boolean).slice(0,2).join('.')) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  }
  return JSON.stringify({
    largura,
    rolagemHorizontal: doc.scrollWidth > largura + 1,
    scrollWidth: doc.scrollWidth,
    coarse: matchMedia('(pointer: coarse)').matches,
    mobileLigado: doc.classList.contains('mobile'),
    estoura: [...new Set(estoura)].slice(0, 14),
    pequenos: [...new Set(pequenos)].slice(0, 14),
  });
})()`);
console.log(`ok: ${saida}`);
console.log(diag);
if (erros.length) console.log(`erros no console: ${erros.slice(0, 3).join(' | ')}`);

ws.close();
proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(0);
