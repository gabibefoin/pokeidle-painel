// O MODO ECONOMIA, conferido no jogo de verdade.
//
//   node tools/teste-modo-economia.mjs          (desktop)
//   MOVEL=1 node tools/teste-modo-economia.mjs  (celular)
//   PRINT=1 ...                                 guarda os PNGs de cada passo
//
// O modo promete três coisas, e as três são mensuráveis de fora:
//
//   1. o jogo PARA de pedir quadro — é o `requestAnimationFrame` que acorda a tela 60×/s e
//      come bateria. Contado aqui embrulhando o `requestAnimationFrame` da página ANTES de o
//      jogo carregar; o relógio do próprio espião usa o rAF original, senão contaria a si mesmo;
//   2. o servidor PARA de mandar `campo` — a maior fatia da banda de quem caça. Contado por um
//      espião no `WebSocket`, que soma os pacotes recebidos por tipo;
//   3. o farm CONTINUA — e a tela acompanha. Provado pelo contador de abates da prancheta
//      subindo entre dois olhares separados por 20 s, com a cena desligada o tempo todo.
//
// E o caminho de volta, que é onde um modo assim costuma quebrar: desligar tem de devolver a
// cena, o laço de quadro, os pacotes de campo e os dois painéis que o modo tomou emprestado
// do canto do palco.
//
// A conta é criada DIRETO no banco (`criarConta`), como no `teste-guia.mjs`: em dev com
// Turnstile ou Resend ligados no `.env`, a rota pública recusa o robô.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import { criarConta, assinarSessao } from '../src/server/auth.mjs';

const NL = String.fromCharCode(10);
const ORIGEM = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
const NICK = `eco${Date.now() % 100000}`;
const MOVEL = process.env.MOVEL === '1';
const PRINT = process.env.PRINT ? (process.env.PRINT === '1' ? '.' : process.env.PRINT) : '';
const HUNT = process.env.HUNT ?? 'rattata';

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const novaConta = async (nick) => {
  const c = await criarConta({ nick, email: `${nick}@gmail.com`, senha: 'teste1234' });
  // Com o Resend ligado, `criarConta` grava um nick provisório e `nick_ok = false`; o robô não
  // tem caixa de entrada, então o carimbo é dado aqui (o mesmo UPDATE do `escolherNick`).
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
await pool.end();

// ------------------------------------------------------------------ o navegador
const perfil = await mkdtemp(join(tmpdir(), 'eco-'));
const porta = 9500 + Math.floor(Math.random() * 200);
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, '--window-size=1500,950', 'about:blank'],
{ stdio: 'ignore', windowsHide: true });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let pagina;
for (let i = 0; i < 80 && !pagina; i++) {
  try {
    pagina = (await fetch(`http://127.0.0.1:${porta}/json/list`).then((r) => r.json()))
      .find((a) => a.type === 'page' && a.webSocketDebuggerUrl);
  } catch { /* o Chrome ainda não subiu a porta */ }
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
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    erros.push((d.exception?.description ?? d.text ?? 'erro').split(NL).slice(0, 3).join(' <- ').slice(0, 300));
  }
});
const cmd = (metodo, params = {}) => new Promise((ok) => {
  const meu = ++id; pend.set(meu, ok);
  ws.send(JSON.stringify({ id: meu, method: metodo, params }));
});
const js = async (e) =>
  (await cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;

/** O pop-up do Discord e o guia do primeiro login voltam sozinhos e cobririam tudo. */
const limparPorCima = () =>
  js("document.getElementById('discord-popup-fechar')?.click(); document.getElementById('tutorial-pular')?.click();");

const print = async (nome) => {
  if (!PRINT) return;
  await limparPorCima();
  await dormir(600);
  const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
  const arquivo = join(PRINT, `${MOVEL ? 'teste-economia-movel' : 'teste-economia'}-${nome}.png`);
  await writeFile(arquivo, Buffer.from(data, 'base64'));
  console.log('  print: ' + arquivo);
};

await cmd('Runtime.enable');
await cmd('Page.enable');
if (MOVEL) {
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
}

// A semente roda antes de qualquer script da página, em TODA carga (o teste recarrega três vezes).
const SEMENTE = [
  `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))}); } catch (_) {}`,
  MOVEL ? "try { localStorage.setItem('cfg-movel', '1'); } catch (_) {}" : '',
  'window.__pacotes = {}; window.__enviados = [];',
  'const OrigWS = WebSocket;',
  'window.WebSocket = function (...a) {',
  '  const s = new OrigWS(...a); window.__ws = s;',
  "  s.addEventListener('message', (ev) => { try { const k = JSON.parse(ev.data).t; window.__pacotes[k] = (window.__pacotes[k] || 0) + 1; } catch (_) {} });",
  '  const env = s.send.bind(s);',
  '  s.send = (d) => { try { window.__enviados.push(JSON.parse(d).t); } catch (_) {} return env(d); };',
  '  return s;',
  '};',
  'window.WebSocket.prototype = OrigWS.prototype;',
  'const rafOrig = window.requestAnimationFrame.bind(window);',
  'window.__raf = 0;',
  'window.requestAnimationFrame = (cb) => { window.__raf++; return rafOrig(cb); };',
  'window.__relogio = 0;',
  '(function tic() { window.__relogio++; rafOrig(tic); })();',
].join(NL);
await cmd('Page.addScriptToEvaluateOnNewDocument', { source: SEMENTE });

/** Uma leitura de 3 s: o que está na tela, quantos quadros o jogo pediu e o que chegou pelo socket. */
const OLHAR = [
  '(() => {',
  "  const vis = (s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).display : 'AUSENTE'; };",
  '  const raf0 = window.__raf; const rel0 = window.__relogio;',
  '  const pac0 = JSON.stringify(window.__pacotes);',
  '  return new Promise((ok) => setTimeout(() => {',
  '    const antes = JSON.parse(pac0); const agora = window.__pacotes; const delta = {};',
  '    for (const k of Object.keys(agora)) { const d = agora[k] - (antes[k] || 0); if (d) delta[k] = d; }',
  '    ok(JSON.stringify({',
  "      economia: document.documentElement.classList.contains('modo-economia'),",
  "      painelEco: vis('#eco-painel'), cena: vis('#cena'), hudZoom: vis('.hud-zoom'), golpes: vis('#golpes-painel'),",
  "      onde: document.getElementById('eco-onde')?.textContent,",
  "      ritmo: [...document.querySelectorAll('#eco-ritmo .eco-cel')].map((c) => c.querySelector('i').textContent + ' = ' + c.querySelector('b').textContent),",
  // Nove linhas, e não as seis de antes: a prancheta ganhou um `/h` embaixo de cada uma das três
  // primeiras, e o contador de abates — que é o que este teste LÊ — desceu para a oitava.
  "      prancheta: [...document.querySelectorAll('#sessao-painel .sessao-linhas li')].map((li) => li.textContent).slice(0, 9),",
  "      sessaoNaColuna: !!document.querySelector('#eco-lado > #sessao-painel'),",
  "      capturasNaColuna: !!document.querySelector('.eco-corpo > #capturas-painel'),",
  '      rafDoJogoPorSeg: Math.round((window.__raf - raf0) / ((window.__relogio - rel0) / 60)),',
  '      pacotesEm3s: delta,',
  '    }));',
  '  }, 3000));',
  '})()',
].join(NL);

let verboso = process.env.VERBOSO === '1';
const olhar = async (rotulo) => {
  const d = JSON.parse(await js(OLHAR));
  if (verboso) console.log(NL + '===== ' + rotulo + NL + JSON.stringify(d, null, 1));
  return d;
};

// ----------------------------------------------------------------- 1. onboarding
console.log(`MODO ECONOMIA — ${MOVEL ? 'celular' : 'desktop'} · conta ${NICK} · ${ORIGEM}`);
await cmd('Page.navigate', { url: `${ORIGEM}/app?starter=4` });
await dormir(14000);
await limparPorCima();

// ---------------------------------- 2. recarrega DENTRO da hunt, com a cena ligada
// O `?hunt=` só vale no welcome que NÃO abre o starter — daí a segunda carga.
await cmd('Page.navigate', { url: `${ORIGEM}/app?hunt=${HUNT}&auto=1` });
await dormir(15000);
await limparPorCima();
await dormir(10000);
const antes = await olhar('a cena ligada — o jogo de sempre');
await print('0-cena');

// ------------------------------------------------ 3. liga o modo nas Configurações
await js("document.getElementById('btn-config').click()");
await dormir(1500);
await print('1-config');
await js("document.getElementById('cfg-economia').click()");
await dormir(3000);
await print('2-ligado');
const ligado = await olhar('modo economia ligado');

await dormir(20000); // caça de verdade com a cena desligada
const rodando = await olhar('20 s depois, ainda no modo');
await print('3-rodando');

// ------------------------- 4. TROCA DE ÁREA com a cena desligada, e só então liga a cena
//
// É o furo mais fácil de abrir num modo assim: o servidor engoliu o `campo.init` da área nova
// (o cliente pediu para não receber), então o que ele reenvia ao religar TEM de ser a cena de
// agora, e não a de quando o modo foi ligado. A mensagem vai pelo mesmo socket do jogo.
//
// O pedido vai em tentativas: o servidor tranca a troca de área por 3 s a cada dano trocado
// (`msgBloqueioTrocaDeHunt`), e um bicho em combate contínuo recusa a primeira. É a mesma
// espera que o jogador encontra clicando no Mapa — não tem nada a ver com o modo.
const OUTRA = process.env.HUNT2 ?? 'pidgey';
for (let i = 0; i < 14; i++) {
  await js(`window.__ws.send(JSON.stringify({ t: 'hunt.select', slug: '${OUTRA}' }))`);
  await dormir(2000);
  const onde = await js("document.getElementById('eco-onde')?.textContent ?? ''");
  if (new RegExp(OUTRA, 'i').test(onde)) break;
}
await dormir(3000);
const trocou = await olhar('trocou de área sem cena');
await print('4-trocou');

// -------------------------------------------- 5. desliga pelo botão do próprio painel
await js("document.getElementById('eco-sair').click()");
await dormir(8000);
const desligado = await olhar('depois de "Ligar a cena"');
await print('5-voltou');

// -------------------------------------------- 6. F5 com o modo ligado (o caso do dia a dia)
await js("document.getElementById('btn-config').click()");
await dormir(1200);
await js("document.getElementById('cfg-economia').click()");
await dormir(2000);
await cmd('Page.navigate', { url: `${ORIGEM}/app` });
await dormir(14000);
await limparPorCima();
await dormir(8000);
const apos = await olhar('depois do F5 com o modo ligado');
await print('6-f5');

// ------------------------------- 7. o MODO IMERSIVO por cima (o bug da tela preta, 18/09/2026)
//
// Cada modo esconde "tudo do palco menos o seu": o imersivo deixa o canvas e o botão de sair, a
// economia deixa o painel. Juntos apagavam os três, e o jogador ficava numa tela preta sem saída.
// Liga pelas Configurações, como a pessoa faz, e sai pelo botão do canto.
const vista = (id) => `getComputedStyle(document.getElementById('${id}')).display`;
await js("document.getElementById('btn-config').click()");
await dormir(1200);
await js("document.getElementById('cfg-imersivo').click()");
await dormir(1500);
await js("document.querySelector('#modal .modal-topo button')?.click()");
await dormir(800);
const juntos = JSON.parse(await js(`JSON.stringify({
  imersivo: document.documentElement.classList.contains('modo-imersivo'),
  painel: ${vista('eco-painel')}, sair: ${vista('imersivo-sair')},
  sairNaTela: (() => { const r = document.getElementById('imersivo-sair').getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.right <= innerWidth; })(),
  sobrepoe: (() => { const a = document.getElementById('imersivo-sair').getBoundingClientRect(); const b = document.getElementById('eco-sair').getBoundingClientRect(); return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top); })(),
})`));
await print('7-imersivo');
await js("document.getElementById('imersivo-sair').click()");
await dormir(1200);
const semImersivo = JSON.parse(await js(`JSON.stringify({
  imersivo: document.documentElement.classList.contains('modo-imersivo'), painel: ${vista('eco-painel')},
})`));

// ------------------------------------------------------------------- o veredito
let falhas = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FALHA'} ${msg}`);
  if (!cond) falhas++;
};
const abatesDe = (d) => Number((d.prancheta.find((l) => /abatidos|defeated|derrotados/i.test(l)) ?? '0').replace(/\D+/g, '')) || 0;

console.log(NL + 'A cena ligada (a régua)');
ok(antes.cena === 'block' && antes.painelEco === 'none', 'canvas à vista, painel do modo escondido');
ok((antes.pacotesEm3s.campo ?? 0) > 0, `o servidor manda campo (${antes.pacotesEm3s.campo ?? 0} pacotes em 3 s)`);
ok(antes.rafDoJogoPorSeg > 30, `o jogo pede quadro (${antes.rafDoJogoPorSeg}/s)`);

console.log(NL + 'Com o Modo Economia ligado');
ok(ligado.painelEco === 'flex' && ligado.cena === 'none', 'o painel entra no lugar do canvas');
ok(ligado.hudZoom === 'none' && ligado.golpes === 'none', 'os HUDs do palco somem junto');
ok(ligado.sessaoNaColuna && ligado.capturasNaColuna, 'prancheta e histórico foram MOVIDOS para o painel');
ok(!rodando.pacotesEm3s.campo, `nenhum pacote campo em 3 s (${rodando.pacotesEm3s.campo ?? 0})`);
ok(rodando.rafDoJogoPorSeg <= 2, `o jogo não pede mais quadro (${rodando.rafDoJogoPorSeg}/s)`);
ok(abatesDe(rodando) > abatesDe(ligado),
  `o farm continua e a tela acompanha (${abatesDe(ligado)} → ${abatesDe(rodando)} abates em 20 s)`);
ok(rodando.ritmo.some((r) => !/= 0$/.test(r)), 'o ritmo por hora tem número');
ok(new RegExp(OUTRA, 'i').test(trocou.onde ?? ''),
  `trocar de área sem cena atualiza o cabeçalho ("${trocou.onde}")`);
ok(!trocou.pacotesEm3s.campo, 'e o servidor continua sem mandar campo depois da troca');

console.log(NL + 'A volta');
ok(desligado.cena === 'block' && desligado.painelEco === 'none', 'a cena voltou');
ok(new RegExp(OUTRA, 'i').test(desligado.onde ?? ''),
  `a cena que volta é a de AGORA, não a de quando o modo foi ligado ("${desligado.onde}")`);
ok((desligado.pacotesEm3s.campo ?? 0) > 0, `o campo voltou (${desligado.pacotesEm3s.campo ?? 0} pacotes em 3 s)`);
ok(desligado.rafDoJogoPorSeg > 30, `o laço de quadro voltou (${desligado.rafDoJogoPorSeg}/s)`);
ok(!desligado.sessaoNaColuna && !desligado.capturasNaColuna, 'os dois painéis voltaram ao canto da cena');

console.log(NL + 'Depois do F5');
ok(apos.economia && apos.painelEco === 'flex' && apos.cena === 'none', 'abre já sem cena');
ok(!apos.pacotesEm3s.campo, `o servidor já não manda campo (${apos.pacotesEm3s.campo ?? 0})`);

console.log(NL + 'Com o Modo Imersivo junto');
ok(juntos.imersivo && juntos.painel === 'flex', 'o painel continua à vista (não vira tela preta)');
ok(juntos.sair === 'grid' && juntos.sairNaTela, 'e o botão de sair do imersivo está no canto');
ok(!juntos.sobrepoe, 'sem cair em cima do "Ligar a cena"');
ok(!semImersivo.imersivo && semImersivo.painel === 'flex', 'o botão tira do imersivo e o Modo Economia fica');
ok(erros.length === 0, `sem erro no console${erros.length ? ': ' + erros.slice(0, 3).join(' | ') : ''}`);

console.log(NL + (falhas ? `${falhas} FALHA(S)` : 'tudo certo'));

ws.close();
proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(falhas ? 1 : 0);
