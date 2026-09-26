// Percorre o onboarding inteiro num jogador NOVO: gênero → cores → starter.
//
//   node tools/teste-onboarding.mjs [url]
//
// Existe porque o onboarding é a única parte do jogo em que a ORDEM é a regra: o servidor
// recusa `starter.pick` de quem ainda não fechou o visual, e recusa `visual.set` de quem já
// fechou. Um teste que só abrisse a tela não pegaria isso — aqui a gente clica de verdade e
// confere o estado depois de cada passo.
//
// Também vale como conferência do desenho: cada passo vira um PNG em `teste-ob-*.png`.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';

const ORIGEM = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
const URL_BASE = `${ORIGEM}/app`;
const NICK = `ob${Date.now() % 100000}`;

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'ob-'));
const porta = 9600 + Math.floor(Math.random() * 200);
const proc = spawn(
  chrome,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
   `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, '--window-size=1100,860', 'about:blank'],
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
  if (m.method === 'Runtime.exceptionThrown') {
    errosConsole.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
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

console.log(`onboarding de ${NICK}`);
await cmd('Page.navigate', { url: `${URL_BASE}?nick=${NICK}` });

// A barra de carregamento agora tem marcos com pausa: ~2,4 s até o login, e o socket depois.
await dormir(9000);

// ---------------------------------------------------------------- passo 1
conferir(await js(`!document.getElementById('onboarding').classList.contains('hidden')`),
  'o onboarding abre para jogador novo');
conferir(await js(`document.getElementById('starter').classList.contains('hidden')`),
  'o starter NÃO abre antes do visual (a ordem é personagem → pokémon)');
conferir((await js(`document.querySelectorAll('.ob-genero').length`)) === 2,
  'dois gêneros para escolher');
await shot('teste-ob-genero.png');

// ------------------------------------------------- a bandeira TRADUZ o passo
//
// O onboarding é montado por JS com `t()` no instante em que o passo abre, então a tradução
// fica congelada: trocar a bandeira não mudava uma palavra, e é justamente aqui que ela mais
// importa — é a primeira tela do jogo. `aplicarI18n()` não alcança, porque o HTML é só a
// moldura vazia; quem remonta é `repintarPassoDoOnboarding`.
const tituloOb = () => js(`document.getElementById('ob-titulo').textContent.trim()`);
const clicarBandeira = (i) => js(`document.querySelectorAll('.idioma-btn')[${i}].click()`);

const emPt = await tituloOb();
await clicarBandeira(1); // inglês
await dormir(700);
const emEn = await tituloOb();
await clicarBandeira(2); // espanhol
await dormir(700);
const emEs = await tituloOb();
await clicarBandeira(0); // volta ao português para o resto do teste
await dormir(700);

conferir(emEn !== emPt && emEn.length > 0, `a bandeira traduz o passo do gênero (pt "${emPt}" → en "${emEn}")`);
conferir(emEs !== emPt && emEs !== emEn, `e o espanhol também (es "${emEs}")`);
conferir((await tituloOb()) === emPt, 'e voltar para a bandeira do Brasil devolve o português');

await js(`document.querySelectorAll('.ob-genero')[1].click()`); // feminino
await dormir(600);

// O passo das CORES também tem de traduzir — ele é montado por outra função.
const coresPt = await js(`document.querySelector('.ob-peca-nome').textContent.trim()`);
await clicarBandeira(1);
await dormir(700);
const coresEn = await js(`document.querySelector('.ob-peca-nome').textContent.trim()`);
conferir(coresEn !== coresPt && coresEn.length > 0,
  `a bandeira traduz o passo das cores (pt "${coresPt}" → en "${coresEn}")`);
// As cores já escolhidas NÃO podem se perder na remontagem — o rascunho é externo à tela.
await clicarBandeira(0);
await dormir(700);

// ---------------------------------------------------------------- passo 2
conferir((await js(`document.querySelectorAll('.ob-peca').length`)) === 4,
  'quatro regiões no editor (cabeça, camisa, calça, sapato — as da máscara _template)');
conferir((await js(`document.querySelectorAll('.ob-peca')[0].querySelectorAll('.ob-cor').length`)) === 133,
  'a paleta do Tibia inteira, 133 cores por região');
conferir((await js(`document.querySelectorAll('#ob-boneco canvas').length`)) === 1,
  'o boneco grande aparece no editor');
conferir((await js(`document.querySelectorAll('#ob-giro canvas').length`)) === 3,
  'as outras três direções aparecem ao lado');

// Uma cor DIFERENTE em cada região, para o print mostrar as quatro separadas: vermelho na
// cabeça, verde no tronco, azul nas pernas, amarelo nos pés. Se a colorização estivesse
// pegando a região errada (ou uma só), o boneco sairia monocromático e daria para ver.
const ESCOLHAS = [94, 120, 86, 79];
for (const [i, cor] of ESCOLHAS.entries()) {
  await js(`document.querySelectorAll('.ob-peca')[${i}].querySelector('[data-cor="${cor}"]').click()`);
}
await dormir(500);

const marcadas = await js(`document.querySelectorAll('.ob-cor.on').length`);
conferir(marcadas === 4, `uma cor marcada por região (marcadas: ${marcadas})`);
const escolhidas = await js(`[...document.querySelectorAll('.ob-cor.on')].map(b => b.dataset.cor).join(',')`);
conferir(escolhidas === ESCOLHAS.join(','), `as quatro cores certas ficaram marcadas (${escolhidas})`);

await shot('teste-ob-cores.png');

await js(`document.getElementById('ob-pronto').click()`);
await dormir(1200);

// ---------------------------------------------------------------- passo 3
conferir((await js(`document.querySelectorAll('#ob-starters .starter-card').length`)) === 3,
  'o starter é o ÚLTIMO passo, e só aparece depois das cores');
await shot('teste-ob-starter.png');

await js(`document.querySelectorAll('#ob-starters .starter-card')[0].click()`);
await dormir(1500);

conferir(await js(`document.getElementById('onboarding').classList.contains('hidden')`),
  'o onboarding fecha ao escolher o starter');
conferir((await js(`document.querySelectorAll('#time .poke-linha, #time > *').length`)) > 0,
  'o starter entrou na equipe');
await shot('teste-ob-jogo.png');

// ------------------------------------------------- o visual sobrevive ao F5
await cmd('Page.navigate', { url: `${URL_BASE}?nick=${NICK}` });
await dormir(9000);
conferir(await js(`document.getElementById('onboarding').classList.contains('hidden')`),
  'quem já escolheu NÃO passa pelo onboarding de novo');
conferir((await js(`document.querySelectorAll('#tr-retrato canvas').length`)) === 1,
  'o retrato do painel desenha o boneco do jogador');

// ------------------------------------------------------- a escolha do nick
//
// É o passo de quem entra por Google/Discord, e ele acontece ANTES do socket (o nick é a chave
// da conexão). Para exercitá-lo sem um login de provedor de verdade, planta-se uma sessão com
// `precisaNick` e recarrega — que é exatamente o estado em que o cliente cai ao voltar do
// OAuth. O envio final não é testado aqui porque o token plantado não é assinado; o que se
// confere é a tela, a validação de formato e a consulta de disponibilidade.
await js(`localStorage.setItem('sessao', JSON.stringify(
  { nick: 'provisorio1', token: 'nao-assinado', provedor: 'google', precisaNick: true }))`);
await cmd('Page.navigate', { url: URL_BASE });
await dormir(9000);

conferir(await js(`!document.getElementById('escolher-nick').classList.contains('hidden')`),
  'quem volta do provedor sem nick cai na tela de escolher o nick');
conferir(await js(`document.getElementById('login').classList.contains('hidden')`),
  'e o formulário de login some (é uma tela só de cada vez)');

// O corpo vai dentro de uma função: `Runtime.evaluate` avalia no escopo GLOBAL da página, e um
// `const` solto sobrevive à chamada — a segunda passada estouraria com "já declarado".
const digitarNick = async (texto) => {
  await js(`(() => {
    const campo = document.getElementById('nick-novo');
    campo.value = ${JSON.stringify(texto)};
    campo.dispatchEvent(new Event('input'));
  })()`);
  await dormir(900);
  return js(`document.getElementById('nick-estado').textContent`);
};

conferir((await digitarNick('ab')).length > 0, 'nick curto demais é recusado na hora de digitar');
const livre = await digitarNick(`nk${Date.now() % 1000000}`);
conferir(await js(`document.getElementById('nick-estado').classList.contains('bom')`),
  `nick inédito aparece como disponível ("${livre}")`);
const usado = await digitarNick(NICK);
conferir(await js(`document.getElementById('nick-estado').classList.contains('ruim')`),
  `nick já usado aparece como ocupado ("${usado}")`);
await shot('teste-ob-nick.png');

// A sessão plantada não pode sobrar para a próxima corrida.
await js(`localStorage.removeItem('sessao')`);

conferir(errosConsole.length === 0, `sem erro no console${errosConsole.length ? `: ${errosConsole[0]}` : ''}`);

proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});

console.log(falhas.length ? `\n${falhas.length} falha(s)` : '\ntudo certo');
process.exit(falhas.length ? 1 : 0);
