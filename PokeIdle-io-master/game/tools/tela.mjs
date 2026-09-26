// Captura uma tela do jogo já logado — útil para conferir o visual sem clicar à mão.
//
//   node tools/tela.mjs <saida.png> [modal] [seletor-para-recortar]
//
// `modal` é o `data-modal` de um botão do menu do topo (mapa, pokedex, market, campeonato,
// ranking, bosses, community) — ou, se começar com `.` ou `#`, um seletor qualquer
// para clicar antes de capturar. Sem ele, captura a tela do jogo.
//
//   node tools/tela.mjs mapa.png mapa
//   node tools/tela.mjs menu.png "" .menu-topo
//   node tools/tela.mjs bolsa.png '[data-gaveta=inventario]' .col.esq
//
// `SEGUNDO_CLIQUE=<sel>` clica de novo depois do `modal`; vários vão separados por ` >> `.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { sessaoPara } from './auth-teste.mjs';
import { sessaoDe, fecharBanco } from './sessao-local.mjs';

const [saida, modal = '', recorte = ''] = process.argv.slice(2);
if (!saida) {
  console.error('uso: node tools/tela.mjs <saida.png> [modal] [seletor]');
  process.exit(1);
}

const LARG = 1500;
const ALT = 950;
const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'tela-'));
const porta = 9300 + Math.floor(Math.random() * 400);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`,
  `--window-size=${LARG},${ALT}`, 'about:blank',
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
  // A MENSAGEM inteira, e não só `.text` — aquele é sempre a palavra "Uncaught", que não diz
  // qual erro nem onde. O `description` traz o tipo, a mensagem e a pilha, que é a diferença
  // entre "tem um erro na tela do PvP" e "`$$` não existe, linha 5372".
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    erros.push((d.exception?.description ?? d.text ?? 'erro').split(String.fromCharCode(10)).slice(0, 3).join(' <- ').slice(0, 400));
  }
});
const cmd = (metodo, params = {}) => new Promise((ok) => {
  const meu = ++id; pend.set(meu, ok);
  ws.send(JSON.stringify({ id: meu, method: metodo, params }));
});
const js = async (expr) =>
  (await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

await cmd('Runtime.enable');
await cmd('Page.enable');
// nick novo a cada corrida: garante o mesmo estado inicial sempre. `NICK=<nome>` no ambiente
// reaproveita uma conta que já existe — é como se confere uma tela que depende de estado
// acumulado (saldo de diamante, anúncios no mercado) sem ter de jogar até lá.
//
// A sessão é semeada no localStorage ANTES de a página existir. O `?nick=` de antes deixou de
// entrar quando o jogo passou a exigir conta, e o `?sessao=` limpa a barra de endereço assim
// que lê o token — levando junto o `?starter=` que resolve o onboarding sozinho.

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
const nick = process.env.NICK || `ui${Date.now() % 100000}`;
const sessao = process.env.NICK
  ? await sessaoDe(process.env.NICK).finally(fecharBanco)
  : await sessaoPara(nick);
// `HUNT=<slug>` cai direto na área, sem passar pelo mapa-múndi — o cliente já aceita `?hunt=`.
const hunt = process.env.HUNT ? `&hunt=${encodeURIComponent(process.env.HUNT)}` : '';
await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))}); } catch (_) {}`,
});
await cmd('Page.navigate', { url: `http://localhost:8080/app?starter=4${hunt}` });
await dormir(8000);
// O pop-up do Discord aparece a cada visita e cobriria toda captura.
await js(`document.getElementById('discord-popup-fechar')?.click()`);
await dormir(250);

if (modal) {
  const alvo = /^[.#[]/.test(modal)
    ? modal                                          // seletor livre
    : `.menu-topo button[data-modal="${modal}"]`;    // atalho para o menu do topo
  await js(`document.querySelector(${JSON.stringify(alvo)}).click()`);
  await dormir(3000);

  // Cliques SEGUINTES, para telas que moram dentro de outra (o Depósito abre pela Loja, uma
  // edição do Torneio abre pela lista de campeonatos). Vários vão separados por ` >> `, na
  // ordem — com pop-up na frente, um slot só não bastava.
  const seg = process.env.SEGUNDO_CLIQUE;
  if (seg) {
    for (const sel of seg.split('>>').map((x) => x.trim()).filter(Boolean)) {
      // `js:<expressao>` roda a expressao em vez de clicar. E a saida para o que nao tem botao:
      // a escada do `/resgatar`, por exemplo, so abre por um comando digitado no chat.
      await js(sel.startsWith('js:')
        ? sel.slice(3)
        : `document.querySelector(${JSON.stringify(sel)})?.click()`);
      await dormir(2500);
    }
  }
}

let clip;
if (recorte) {
  const r = await js(`JSON.stringify(document.querySelector(${JSON.stringify(recorte)}).getBoundingClientRect().toJSON())`);
  const b = JSON.parse(r);
  clip = { x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 14, scale: 2 };
}

const { data } = await cmd('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
await writeFile(saida, Buffer.from(data, 'base64'));
if (erros.length) console.log(`erros no console: ${erros.slice(0, 3).join(' | ')}`);
console.log(`ok: ${saida}`);

ws.close();
proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(0);
