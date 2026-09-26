// Teste de fluxo do Market e das regras de equipe, pela interface de verdade.
//
// Complementa o teste-ui.mjs: aqui o foco é economia (comprar, vender, vender tudo) e o
// limite da equipe. Precisa do Postgres de pé — o depot é populado direto no banco, porque
// capturar de verdade leva dezenas de bolas e o teste demoraria minutos.
//
//   node tools/teste-market.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { sessaoPara } from './auth-teste.mjs';

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
const perfil = await mkdtemp(join(tmpdir(), 'fluxo-'));
const porta = 9750 + Math.floor(Math.random() * 200);
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
/**
 * Avalia no navegador. Exceção dentro do `evaluate` NÃO vira `exceptionThrown` — volta
 * no próprio resultado. Sem registrar aqui, um `querySelector` que devolveu null falha em
 * silêncio e o teste acusa bug no jogo em vez de erro no roteiro.
 */
const js = async (e) => {
  const r = await cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) {
    erros.push(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  }
  return r?.result?.value;
};

/**
 * Espera o seletor aparecer antes de seguir. Sem isto o teste clica no vazio quando a
 * máquina está lenta — o clique não falha, simplesmente não faz nada, e o teste acusa um
 * bug que não existe.
 */
async function esperarPor(seletor, ms = 15000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await js(`!!document.querySelector(${JSON.stringify(seletor)})`)) return true;
    await dormir(250);
  }
  throw new Error(`"${seletor}" não apareceu em ${ms}ms`);
}

/**
 * Espera a expressão devolver o valor esperado. Substitui `dormir(n)` fixo nas asserções:
 * o estado chega do servidor no máximo 2×/s, então uma pausa fixa às vezes lê a tela de
 * ANTES da ação e acusa uma falha que não existe.
 */
async function esperarValor(expr, esperado, ms = 8000) {
  const limite = Date.now() + ms;
  let ultimo;
  while (Date.now() < limite) {
    ultimo = await js(expr);
    if (ultimo === esperado) return ultimo;
    await dormir(200);
  }
  return ultimo;
}

const testes = [];
const checar = (nome, ok, det = '') => {
  testes.push(ok);
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}${det ? ` — ${det}` : ''}`);
};

const ouro = async () => Number((await js(`document.getElementById('tr-gold').textContent`)).replace(/\D/g, ''));
const abrirMarket = async (aba) => {
  await esperarPor('.menu-topo button[data-modal="market"]');
  await js(`document.querySelector('.menu-topo button[data-modal="market"]').click()`);
  await esperarPor('.mk-abas');
  await js(`document.querySelector('.mk-aba[data-aba="${aba}"]').click()`);
  await dormir(700);
};
const fechar = () => js(`document.getElementById('modal-fechar').click()`);

await cmd('Runtime.enable');
await cmd('Page.enable');
// `Date.now() % 100000` dá volta a cada 100 s: duas corridas seguidas pegavam o MESMO
// nick e a sessão anterior ainda viva no sim atrapalhava. O sufixo aleatório resolve.
const nick = `fx${Date.now() % 100000}${Math.floor(Math.random() * 900 + 100)}`;
// A sessão é semeada no localStorage ANTES de a página existir: o `?nick=` deixou de entrar
// quando o jogo passou a exigir conta, e o `?sessao=` limpa a barra de endereço assim que lê o
// token — levando junto o `?starter=` que resolve o onboarding sozinho.
const sessao = await sessaoPara(nick);
await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))}); } catch (_) {}`,
});
await cmd('Page.navigate', { url: `http://localhost:8080/app?starter=4` });
await esperarPor('#ativo-card .ativo-nome');
await dormir(1200);

// ------------------------------------------------------------------- compra
await abrirMarket('compra');
await esperarPor('.mk-card .mk-acao');
const ouro0 = await ouro();
// Poké Ball é o primeiro card; sobe a quantidade para 10 pelo botão de +
await js(`
  const c = document.querySelector('.mk-card');
  for (let i = 0; i < 9; i++) c.querySelector('.mk-passo[data-passo="1"]').click();
  c.querySelector('.mk-acao').click();`);
await esperarValor(`document.getElementById('tr-gold').textContent`, String(ouro0 - 50));
const ouro1 = await ouro();
checar('comprar 10 Poké Balls custa 50', ouro0 - ouro1 === 50, `${ouro0} → ${ouro1}`);

const bolasNaBolsa = await js(`
  document.querySelector('#gaveta-abas button[data-gaveta="inventario"]').click();
  new Promise(ok => setTimeout(() => ok(document.querySelector('#itens .inv-item b')?.textContent), 600))`);
checar('as bolas entraram na bolsa', bolasNaBolsa === '110', `bolsa=${bolasNaBolsa}`);

// ------------------------------------------------------------------ venda
await abrirMarket('venda');
const temConsumivel = await js(
  `[...document.querySelectorAll('.mk-nome')].some(e => /Potion|Revive/.test(e.textContent))`,
);
checar('consumível comprável não aparece na venda', temConsumivel === false);
await fechar();

// --------------------------------------------------------------- equipe = 5
// Níveis embaralhados de propósito: é o que torna a ordenação do depot testável.
const sql = [[16, 7], [19, 22], [21, 4], [25, 15], [133, 30], [147, 11]].map(
  ([esp, nivel]) => `INSERT INTO player_pokemon (player_id, species_id, level, xp, quality, ivs, hp, shiny, slot)
     SELECT id, ${esp}, ${nivel}, 0, 1, '{"hp":16,"atk":16,"def":16,"spAtk":16,"spDef":16,"speed":16}'::jsonb, 50, false, NULL
     FROM players WHERE nick = '${nick}';`,
).join('\n');
execFileSync('docker', ['exec', '-i', 'game-postgres-1', 'psql', '-U', 'poke', '-d', 'pokeidle', '-c', sql]);
await cmd('Page.navigate', { url: 'http://localhost:8080/app' });
await esperarPor('#ativo-card .ativo-nome');
await dormir(1200);

await js(`document.querySelector('#gaveta-abas button[data-gaveta="depot"]').click()`);
await esperarPor('#depot .poke-linha');

// depot vem do mais forte para o mais fraco — com dezenas guardados é o que faz o painel
// ser útil sem rolar
// Sem regex de propósito: `\d` dentro de template literal vira `d` antes de chegar ao
// navegador, e a extração voltava vazia — o teste passava sem testar nada.
const niveis = await js(
  `[...document.querySelectorAll('#depot .pl-lv')].map(e => parseInt(e.textContent.replace('Nv', ''), 10))`,
);
const lidos = niveis.length > 1 && niveis.every((n) => Number.isFinite(n));
const ordenado = niveis.every((n, i) => i === 0 || niveis[i - 1] >= n);
checar('depot ordenado por nível, do maior para o menor', lidos && ordenado, `[${niveis.join(', ')}]`);

// a seta de subir tem que existir em quem está no depot
const temSeta = await js(`!!document.querySelector('#depot .poke-linha .pl-mover[data-para="equipe"]')`);
checar('depot tem botão de subir para a equipe', temSeta === true);

// clica em cada linha do depot para tentar subir todo mundo para a equipe
for (let i = 0; i < 7; i++) {
  await js(`document.querySelector('#depot .poke-linha')?.click()`);
  await dormir(700);
}
const contador = await js(`document.getElementById('time-cnt').textContent`);
checar('equipe trava em 5', contador === '5/5', `mostra "${contador}"`);

// ------------------------------------------------- guardar da equipe no depot
const noDepotAntes = await js(`document.querySelectorAll('#depot .poke-linha').length`);
await js(`
  const linhas = [...document.querySelectorAll('#time .poke-linha')];
  const alvo = linhas.find(l => !l.classList.contains('ativo')) ?? linhas[0];
  alvo.querySelector('.pl-mover').click()`);
const contador2 = await esperarValor(`document.getElementById('time-cnt').textContent`, '4/5');
const noDepotDepois = await js(`document.querySelectorAll('#depot .poke-linha').length`);
checar('botão guarda no depot', contador2 === '4/5' && noDepotDepois === noDepotAntes + 1,
  `equipe ${contador2}, depot ${noDepotAntes}→${noDepotDepois}`);

// --------------------------------------------------------- venda de pokémon
await abrirMarket('pokemons');
const ouroA = await ouro();
const cardsA = await js(`document.querySelectorAll('.mk-card').length`);
await js(`document.querySelector('.mk-card .mk-acao').click()`);
const cardsB = await esperarValor(`document.querySelectorAll('.mk-card').length`, cardsA - 1);
const ouroB = await ouro();
checar('vender pokémon remove o card e paga', cardsB === cardsA - 1 && ouroB > ouroA,
  `cards ${cardsA}→${cardsB}, ouro ${ouroA}→${ouroB}`);

// ------------------------------------------------------- vender todo o depot
await js(`document.querySelector('.mk-vender-tudo button').click()`);
await dormir(900);
const popupAberto = await js(`!document.getElementById('confirmar').classList.contains('hidden')`);
checar('vender tudo pede confirmação', popupAberto === true);

await js(`document.getElementById('confirmar-nao').click()`);
await dormir(600);
const cardsAposCancelar = await js(`document.querySelectorAll('.mk-card').length`);
checar('cancelar não vende nada', cardsAposCancelar === cardsB, `${cardsB} → ${cardsAposCancelar}`);

await js(`document.querySelector('.mk-vender-tudo button').click()`);
await dormir(700);
await js(`document.getElementById('confirmar-sim').click()`);
await esperarValor(`document.querySelector('.mk-vt-info').textContent.includes('nada para vender')`, true);
const infoFinal = await js(`document.querySelector('.mk-vt-info').textContent`);
checar('confirmar esvazia o depot', /nada para vender/.test(infoFinal), `"${infoFinal.trim()}"`);

if (erros.length) console.log(`\nerros no console: ${erros.slice(0, 3).join(' | ')}`);
const falhas = testes.filter((t) => !t).length;
console.log(`\n${testes.length - falhas}/${testes.length} passaram`);
ws.close(); proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(falhas ? 1 : 0);
