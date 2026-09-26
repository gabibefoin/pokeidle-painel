// Percorre o GUIA DO PRIMEIRO LOGIN inteiro, no desktop e no celular.
//
//   node tools/teste-guia.mjs [url]
//
// O guia é a única tela do jogo que MEXE na interface enquanto explica: ele abre modal, troca
// a aba do Market, sobe a gaveta do celular e persegue um botão que anda pela praça. Um teste
// que só lesse o texto não pegaria nada disso — aqui cada passo é conferido pelo retângulo do
// holofote, que é o que prova que o alvo daquele passo existe e está na tela.
//
// A conta é criada DIRETO no banco (`criarConta`), e não pela rota `/auth/criar`: em dev com
// `TURNSTILE_SECRET_KEY` no `.env` a rota pública recusa o robô, e era isso que derrubava as
// ferramentas de print. O token é assinado do mesmo jeito que o `sessao-local.mjs` faz.
//
// Cada passo vira um PNG em `teste-guia-*.png` — inclusive a escolha do inicial, que é onde
// se confere se os três cartões saem do mesmo tamanho.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { criarConta, assinarSessao } from '../src/server/auth.mjs';

const ORIGEM = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
const NICK = `guia${Date.now() % 100000}`;

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

// ------------------------------------------------------------------ as contas
//
// DUAS, e não uma: o servidor grava `tutorialVisto` ao fim do guia, então o jogador do teste
// de desktop nunca mais o veria e a passada de celular abriria direto no jogo. As duas nascem
// aqui porque o pool fecha logo em seguida — depois de `pool.end()` não há mais banco.
const novaConta = async (nick) => {
  const c = await criarConta({ nick, email: `${nick}@gmail.com`, senha: 'teste1234' });
  // Com o Resend ligado no `.env`, `criarConta` grava um nick PROVISÓRIO e `nick_ok = false`:
  // a pessoa escolheria o nome depois de confirmar o e-mail. O robô não tem caixa de entrada,
  // então o carimbo é dado aqui — é o mesmo UPDATE que `escolherNick` faria no fim daquele
  // caminho. Sem isto o teste abre na tela de escolher nick, e não no onboarding.
  const { rows } = await pool.query(
    `UPDATE accounts SET nick = $2, nick_ok = true, email_ok = true WHERE id = $1 RETURNING *`,
    [c.id, nick],
  );
  const conta = rows[0];
  return {
    nick: conta.nick,
    token: await assinarSessao({ nick: conta.nick, contaId: Number(conta.id), provedor: conta.provedor }),
  };
};
const sessao = await novaConta(NICK);
const sessao2 = await novaConta(`${NICK}m`);
await pool.end();

// ------------------------------------------------------------------ o navegador
const perfil = await mkdtemp(join(tmpdir(), 'guia-'));
const porta = 9800 + Math.floor(Math.random() * 150);
const proc = spawn(
  chrome,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`,
    '--window-size=1280,880', 'about:blank'],
  { stdio: 'ignore', windowsHide: true },
);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let pagina;
for (let i = 0; i < 60 && !pagina; i++) {
  try {
    const abas = await fetch(`http://127.0.0.1:${porta}/json/list`).then((r) => r.json());
    pagina = abas.find((a) => a.type === 'page' && a.webSocketDebuggerUrl);
  } catch { /* o Chrome ainda não subiu a porta */ }
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
  if (m.method === 'Runtime.exceptionThrown') {
    errosConsole.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  }
  // Chave de i18n que não existe sai como `console.warn` — no guia isso é um passo mudo.
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') {
    const txt = (m.params.args ?? []).map((a) => a.value).join(' ');
    if (txt.includes('[i18n] chave sem tradução')) errosConsole.push(txt);
  }
});
const cmd = (method, params = {}) =>
  new Promise((ok) => { const meu = ++id; pendentes.set(meu, ok); ws.send(JSON.stringify({ id: meu, method, params })); });

const js = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r?.result?.value;
};
const shot = async (nome) => {
  const r = await cmd('Page.captureScreenshot', { format: 'png' });
  if (r?.data) await writeFile(nome, Buffer.from(r.data, 'base64'));
};

const falhas = [];
const conferir = (ok, oque) => {
  console.log(`${ok ? '  ok  ' : ' FALHA'}  ${oque}`);
  if (!ok) falhas.push(oque);
};

await cmd('Runtime.enable');
await cmd('Page.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))}); } catch (_) {}`,
});

/** Passa o onboarding: gênero, cores e o inicial pedido (0 Bulbasaur, 1 Charmander, 2 Squirtle). */
async function passarOnboarding(qual) {
  await cmd('Page.navigate', { url: `${ORIGEM}/app` });
  await dormir(9000);
  await js(`document.getElementById('discord-popup-fechar')?.click()`);

  conferir(await js(`!document.getElementById('onboarding').classList.contains('hidden')`),
    'o onboarding abre para a conta nova');
  await js(`document.querySelectorAll('.ob-genero')[0].click()`);
  await dormir(700);
  await js(`document.getElementById('ob-pronto').click()`);
  await dormir(1200);

  conferir((await js(`document.querySelectorAll('#ob-starters .starter-card').length`)) === 3,
    'os três cartões de inicial aparecem');
  await shot('teste-guia-starter.png');

  // O TAMANHO DOS TRÊS. O Charmander mora numa célula 64×32 e os outros dois numa 32×32: sem
  // o `encaixar` do `spriteAnimado`, ele saía com metade da altura dos vizinhos.
  const alturas = await js(`[...document.querySelectorAll('#ob-starters .st-arte canvas')]
    .map((c) => Math.round(c.getBoundingClientRect().height))`);
  const larguras = await js(`[...document.querySelectorAll('#ob-starters .st-arte canvas')]
    .map((c) => Math.round(c.getBoundingClientRect().width))`);
  const maior = Math.max(...alturas);
  const menor = Math.min(...alturas);
  conferir(alturas.length === 3 && menor >= maior * 0.8,
    `os três iniciais saem do mesmo tamanho (alturas ${alturas.join(', ')} px · larguras ${larguras.join(', ')} px)`);

  // E as três artes têm de terminar na MESMA linha de chão — mas só quando estão LADO A LADO.
  // No celular a lista vira uma coluna só, e aí cada cartão tem a sua linha, o que é o certo.
  const pes = await js(`[...document.querySelectorAll('#ob-starters .st-arte canvas')]
    .map((c) => Math.round(c.getBoundingClientRect().bottom))`);
  const emLinha = (await js(`new Set([...document.querySelectorAll('#ob-starters .starter-card')]
    .map((c) => Math.round(c.getBoundingClientRect().top))).size`)) === 1;
  if (emLinha) conferir(new Set(pes).size === 1, `e com o pé na mesma linha (${pes.join(', ')})`);
  else console.log(`  ·     cartões empilhados (uma coluna): pés em ${pes.join(', ')}`);

  await js(`document.querySelectorAll('#ob-starters .starter-card')[${qual}].click()`);
  await dormir(2500);
}

/**
 * Percorre o guia do começo ao fim, conferindo cada passo. `rotulo` só nomeia os prints.
 *
 * `extras` liga as conferências de "Voltar" e de troca de idioma. Elas rodam uma vez só, na
 * passada de desktop: são sobre a máquina de passos, que é a mesma nos dois layouts.
 */
async function percorrerGuia(rotulo, extras = false) {
  conferir(await js(`!document.getElementById('tutorial').classList.contains('hidden')`),
    `${rotulo}: o guia abre sozinho depois do inicial`);

  const total = await js(`document.getElementById('tutorial-contador').textContent`);
  console.log(`         contador: "${total}"`);

  const vistos = [];
  for (let i = 0; i < 30; i++) {
    const passo = await js(`(() => {
      const t = document.getElementById('tutorial-titulo').textContent.trim();
      const b = document.getElementById('tutorial-corpo').textContent.trim();
      const c = document.getElementById('tutorial-contador').textContent.trim();
      const spot = document.getElementById('tutorial-spot');
      const anel = document.getElementById('tutorial-anel');
      const prog = document.getElementById('tutorial-progresso');
      const r = spot.classList.contains('hidden') ? null : spot.getBoundingClientRect();
      const ra = anel.classList.contains('hidden') ? null : anel.getBoundingClientRect();
      const cx = document.getElementById('tutorial-caixa').getBoundingClientRect();
      return {
        titulo: t, corpo: b, contador: c,
        progresso: prog.style.width,
        spot: r && { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        anel: ra && { x: Math.round(ra.x), y: Math.round(ra.y), w: Math.round(ra.width), h: Math.round(ra.height) },
        cartao: { x: Math.round(cx.x), y: Math.round(cx.y), w: Math.round(cx.width), h: Math.round(cx.height) },
        ultimo: document.getElementById('tutorial-proximo').textContent.trim(),
        modal: document.getElementById('modal').classList.contains('hidden') ? null
          : document.querySelector('#modal .modal-caixa').dataset.modal,
      };
    })()`);
    vistos.push(passo);

    const n = vistos.length;
    await shot(`teste-guia-${rotulo}-${String(n).padStart(2, '0')}.png`);

    // Um passo mudo (chave sem tradução) sai com o próprio nome da chave no título.
    conferir(passo.titulo.length > 0 && !passo.titulo.startsWith('tut.'),
      `${rotulo} ${n}. "${passo.titulo}"${passo.modal ? ` · modal ${passo.modal}` : ''}`);
    conferir(passo.corpo.length > 30 && !passo.corpo.startsWith('tut.'),
      `${rotulo} ${n}. o texto do passo chegou traduzido (${passo.corpo.length} caracteres)`);

    const tela = await js(`({ w: innerWidth, h: innerHeight })`);

    // O CARTÃO NÃO PODE TAPAR O QUE ELE APONTA. É o erro clássico de tour guiado.
    const marca = passo.anel ?? passo.spot;
    if (marca) {
      conferir(marca.w > 0 && marca.h > 0,
        `${rotulo} ${n}. o holofote achou o alvo (${marca.w}×${marca.h} em ${marca.x},${marca.y})`);
      const cobre = !(passo.cartao.y + passo.cartao.h <= marca.y
        || passo.cartao.y >= marca.y + marca.h
        || passo.cartao.x + passo.cartao.w <= marca.x
        || passo.cartao.x >= marca.x + marca.w);
      // Alvo grande demais para o cartão caber ao lado — o mapa dentro do modal, o palco da
      // batalha. Aí a régua não é "não encostar", é "quanto do alvo sobrou à vista".
      //
      // A conta é a MESMA das quatro faixas de `posicionarTutorial`, de propósito: enquanto
      // couber uma faixa, o teste exige que o cartão a use; só quando as quatro estão fechadas
      // é que ele passa a cobrar a fração visível. Sem isto, um cartão que tapasse o botão do
      // Mapa tendo meia tela livre ao lado passaria batido.
      const cx = passo.cartao;
      const regiao = marca.y + marca.h + 14 + cx.h > tela.h
        && marca.y - 14 - cx.h < 0
        && marca.x + marca.w + 14 + cx.w > tela.w
        && marca.x - 14 - cx.w < 0;
      if (!regiao) {
        conferir(!cobre, `${rotulo} ${n}. o cartão não cobre o que está apontando`);
      } else {
        const visivel = Math.max(0, Math.min(marca.y + marca.h, passo.cartao.y) - marca.y)
          + Math.max(0, (marca.y + marca.h) - Math.max(marca.y, passo.cartao.y + passo.cartao.h));
        conferir(visivel >= marca.h * 0.35,
          `${rotulo} ${n}. o alvo é a tela toda, e ${Math.round((visivel / marca.h) * 100)}% dele continua à vista`);
      }
    }

    // O cartão inteiro tem de caber na tela — no celular, acima da barra de abas.
    conferir(passo.cartao.y >= 0 && passo.cartao.y + passo.cartao.h <= tela.h + 1
      && passo.cartao.x >= 0 && passo.cartao.x + passo.cartao.w <= tela.w + 1,
      `${rotulo} ${n}. o cartão cabe na tela (${passo.cartao.x},${passo.cartao.y} ${passo.cartao.w}×${passo.cartao.h} em ${tela.w}×${tela.h})`);

    // No terceiro passo, os dois caminhos que ninguém percorre andando para a frente: voltar
    // um passo e trocar de bandeira no meio do guia. Os dois passam por `renderTutorialPasso`
    // com estado já montado — é onde um tour guiado costuma se perder de si mesmo.
    if (n === 3 && extras) {
      await js(`document.getElementById('tutorial-voltar').click()`);
      await dormir(700);
      const voltou = await js(`document.getElementById('tutorial-contador').textContent`);
      conferir(Number(voltou.match(/[0-9]+/)?.[0]) === 2, `${rotulo}: "Voltar" anda um passo para trás ("${voltou}")`);
      await js(`document.getElementById('tutorial-proximo').click()`);
      await dormir(700);

      const antes = await js(`document.getElementById('tutorial-titulo').textContent.trim()`);
      const contadorPt = await js(`document.getElementById('tutorial-contador').textContent`);
      await js(`document.querySelectorAll('.idioma-btn')[1].click()`); // inglês
      await dormir(900);
      const emEn = await js(`document.getElementById('tutorial-titulo').textContent.trim()`);
      const contadorEn = await js(`document.getElementById('tutorial-contador').textContent`);
      conferir(emEn.length > 0 && emEn !== antes,
        `${rotulo}: a bandeira traduz o guia sem fechá-lo ("${antes}" → "${emEn}")`);
      conferir(contadorEn.replace(/\D+/g, '') === contadorPt.replace(/\D+/g, ''),
        `${rotulo}: e o jogador continua no mesmo passo ("${contadorPt}" → "${contadorEn}")`);
      await js(`document.querySelectorAll('.idioma-btn')[0].click()`);
      await dormir(900);
      conferir((await js(`document.getElementById('tutorial-titulo').textContent.trim()`)) === antes,
        `${rotulo}: e voltar a bandeira devolve o português`);
    }

    // O botão "Pular" some no último passo: é assim que se sabe que o próximo clique fecha.
    const acabou = await js(`document.getElementById('tutorial-pular').classList.contains('hidden')`);
    await js(`document.getElementById('tutorial-proximo').click()`);
    await dormir(900);
    if (acabou) break;
  }

  return vistos;
}

// =========================================================== desktop
console.log(`\nguia de ${NICK} — DESKTOP 1280×880`);
await passarOnboarding(1); // Charmander: o inicial de célula larga, que era o que saía pequeno
const noDesktop = await percorrerGuia('desktop', true);

conferir(await js(`document.getElementById('tutorial').classList.contains('hidden')`),
  'desktop: o guia fecha no último passo');
conferir(await js(`document.getElementById('modal').classList.contains('hidden')`),
  'desktop: e devolve o jogador ao jogo, sem modal aberto por cima');

const passosNoMenu = noDesktop.filter((p) => p.titulo.toLowerCase().includes('menu')).length;
conferir(passosNoMenu === 0, 'desktop: o passo do botão "Menu" não aparece (é só do celular)');

// =========================================================== celular
//
// Conta nova para o celular: o servidor grava `tutorialVisto` ao terminar o guia, e o mesmo
// jogador nunca mais o veria.
console.log('\nguia no CELULAR 390×844');
await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao2))}); } catch (_) {}`,
});
await cmd('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
});
await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cmd('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });

await passarOnboarding(1);
conferir(await js(`document.documentElement.classList.contains('mobile')`),
  'celular: o jogo entrou no modo móvel');
const noCelular = await percorrerGuia('movel');

const temMenu = noCelular.some((p) => p.titulo.toLowerCase().includes('menu'));
conferir(temMenu, 'celular: o passo do botão "Menu" entra na lista (é um a mais que no desktop)');
conferir(noCelular.length === noDesktop.length + 1,
  `celular: ${noCelular.length} passos contra ${noDesktop.length} no desktop`);

conferir(errosConsole.length === 0,
  `sem erro nem chave sem tradução no console${errosConsole.length ? `: ${errosConsole[0]}` : ''}`);

ws.close();
proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});

console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\ntudo certo');
process.exit(falhas.length ? 1 : 0);
