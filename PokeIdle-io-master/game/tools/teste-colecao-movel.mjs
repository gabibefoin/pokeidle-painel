// A COLEÇÃO no CELULAR — teste de usabilidade, tela a tela.
//
// `teste-colecao-ui.mjs` prova que as telas funcionam num monitor. Este prova que elas são
// JOGÁVEIS num telefone: o Chrome em modo de aparelho (viewport, toque, `pointer: coarse`), uma
// conta com a caixa de um jogador de verdade (equipe cheia, depot e Coleção com dezenas de
// pokémon, guild, amigo, inscrição no campeonato, Exp. Share na bolsa) e, em cada tela:
//
//   · nada estoura a largura (nem a página, nem a folha);
//   · o que se toca tem tamanho de dedo (nada abaixo de 32 px; as ações das casas e o
//     "Pronto" dos filtros, ≥ 40);
//   · os campos de texto têm 16 px (abaixo disso o Safari dá zoom e não desfaz);
//   · a LISTA aparece sem rolar: é ela o motivo da tela, e cabeçalho e filtros não podem
//     empurrá-la para fora da dobra;
//   · os filtros ficam atrás de "Filtros" (a dobra do Mercado da Comunidade), e o botão diz
//     quantos estão ligados.
//
//   npm start
//   node tools/teste-colecao-movel.mjs                  (APARELHO=iphone|android-pequeno|…)
//   PRINT=pasta node tools/teste-colecao-movel.mjs      (guarda um print por tela)

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { sessaoDe } from './sessao-local.mjs';
import { pool } from '../src/server/db.mjs';
import { especies, xpTotalParaNivel } from '../src/server/content.mjs';
import { campeonatoDe } from '../src/shared/campeonato.mjs';

/** O Mundial #1 — a edição de verdade que este teste usa para inscrever a conta. */
const CAMPEONATO = campeonatoDe('mundial', 2026, 9);
import { XP_SHARE_HELD_ID } from '../src/shared/xp-share-held.mjs';

const APARELHOS = {
  iphone: { larg: 390, alt: 844, dpr: 3, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  'android-pequeno': { larg: 360, alt: 740, dpr: 3, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
  android: { larg: 412, alt: 915, dpr: 2.6, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
};
const NOME_AP = process.env.APARELHO ?? 'iphone';
const ap = APARELHOS[NOME_AP];
if (!ap) throw new Error(`aparelho desconhecido: ${NOME_AP}`);
const PRINT = process.env.PRINT || '';
const BASE = process.env.JOGO_URL || 'http://localhost:8080';

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'colmov-'));
const porta = 9300 + Math.floor(Math.random() * 400);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`,
  `--window-size=${Math.max(ap.larg, 500)},${Math.max(ap.alt, 500)}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let pagina;
for (let i = 0; i < 60 && !pagina; i++) {
  try { pagina = (await fetch(`http://127.0.0.1:${porta}/json/list`).then((x) => x.json())).find((a) => a.type === 'page' && a.webSocketDebuggerUrl); } catch {}
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
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    erros.push((d.exception?.description ?? d.text ?? 'erro').split('\n').slice(0, 2).join(' <- ').slice(0, 300));
  }
});
const cmd = (method, params = {}) => new Promise((ok) => { const meu = ++id; pend.set(meu, ok); ws.send(JSON.stringify({ id: meu, method, params })); });
const js = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
  return r?.result?.value;
};

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);
async function esperar(expr, ms = 10000) {
  for (let t = 0; t < ms; t += 200) {
    if (await js(expr)) return true;
    await dormir(200);
  }
  return false;
}
const ha = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`;
const existe = (sel) => js(ha(sel));
/** Coberturas achadas pelos toques: um botão que está debaixo de outra coisa não é tocável. */
const cobertos = [];

/**
 * Um TOQUE no elemento: rola até ele, confere que é ELE que está no topo naquele ponto (nada
 * cobrindo o alvo do dedo) e clica. O gesto sintético do Chrome headless não vira `click`, e o
 * que interessa aqui é o alvo estar alcançável.
 */
async function tocar(sel) {
  const r = await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
    el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect();
    const topo = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
    const livre = !!topo && (topo === el || el.contains(topo));
    el.click();
    return { livre, topo: topo ? (topo.id || '') + '.' + String(topo.className) : 'nada' }; })()`);
  if (!r) return false;
  if (!r.livre) cobertos.push(`${sel} (coberto por ${r.topo})`);
  await dormir(350);
  return true;
}
const clicar = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
async function foto(nome) {
  if (!PRINT) return;
  const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(PRINT, `movel-${NOME_AP}-${nome}.png`), Buffer.from(data, 'base64'));
}
async function abrirMenu(modal) {
  await clicar('.m-nav button[data-aba="menu"]');
  await dormir(400);
  const foi = await clicar(`.menu-topo button[data-modal="${modal}"]`);
  await dormir(900);
  return foi;
}
/** Guild e Amigos moram na aba "Menu" do celular: é por lá que o dedo chega neles. */
async function tocarNoMenu(sel) {
  // A aba alterna: tocada com a gaveta do menu já aberta, ela FECHA.
  const aberto = await js(`(() => { const g = document.querySelector('#m-gaveta'); const el = document.querySelector(${JSON.stringify(sel)});
    return !!g && g.classList.contains('aberta') && !!el?.closest('.m-pane.on'); })()`);
  if (!aberto) await clicar('.m-nav button[data-aba="menu"]');
  await dormir(600);
  return tocar(sel);
}
async function fecharTudo() {
  await js(`document.querySelector('.cm-folha')?.remove()`);
  await js(`(() => { for (const b of ['#modal-fechar', '#depot-fechar', '#guild-time-fechar', '#guild-fechar', '#vitrine-editor-fechar', '#amigos-fechar']) {
    const el = document.querySelector(b); if (el && el.offsetParent !== null) el.click(); } })()`);
  await dormir(400);
}

/**
 * As medidas de usabilidade de uma tela. `raiz` é a caixa que está na frente (folha ou modal);
 * `lista` é o que a tela existe para mostrar.
 */
async function medir(raiz, lista = null, { alvos = 'button, select, [role="button"], .mk-card' } = {}) {
  return js(`(() => {
    const W = innerWidth, H = innerHeight;
    const raiz = document.querySelector(${JSON.stringify(raiz)});
    if (!raiz) return { erro: 'sem raiz ${raiz}' };
    const desc = (el) => (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : el.tagName.toLowerCase());
    const visivel = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < H; };
    const todos = [...raiz.querySelectorAll('*')].filter(visivel);
    const estoura = todos.filter((el) => { const r = el.getBoundingClientRect(); return r.right > W + 1 || r.left < -1; })
      .filter((el) => !el.closest('.mk-grade, .cm-pk-escolha-grade') || el.matches('.mk-card')).slice(0, 6).map(desc);
    const pequenos = [...raiz.querySelectorAll(${JSON.stringify(alvos)})].filter(visivel)
      .filter((el) => !el.disabled && !el.matches('input[type="checkbox"]'))
      .map((el) => [desc(el), el.getBoundingClientRect()])
      .filter(([, r]) => r.height < 32 || r.width < 32)
      .map(([d, r]) => d + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)).slice(0, 8);
    const campos = [...raiz.querySelectorAll('input:not([type="checkbox"]), select, textarea')].filter(visivel)
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map(desc).slice(0, 6);
    const larguraRaiz = raiz.scrollWidth > raiz.clientWidth + 1 && getComputedStyle(raiz).overflowX !== 'hidden';
    let listaVisivel = null, cardsInteiros = null, listaTopo = null;
    const lista = ${lista ? `document.querySelector(${JSON.stringify(lista)})` : 'null'};
    if (lista) {
      const cx = raiz.getBoundingClientRect();
      const r = lista.getBoundingClientRect();
      const baixo = Math.min(r.bottom, cx.bottom, H), cima = Math.max(r.top, cx.top, 0);
      listaVisivel = Math.max(0, Math.round(baixo - cima));
      listaTopo = Math.round(r.top);
      cardsInteiros = [...lista.children].filter((c) => { const q = c.getBoundingClientRect();
        return q.height > 0 && q.top >= Math.max(cx.top, 0) - 1 && q.bottom <= Math.min(cx.bottom, H) + 1; }).length;
    }
    return { W, H, rolagemPagina: document.documentElement.scrollWidth > W + 1, larguraRaiz, estoura, pequenos, campos,
      listaVisivel, listaTopo, cardsInteiros };
  })()`);
}

/** As regras que toda tela desta feature tem de cumprir no celular. */
function conferir(nome, m, { minLista = null, minCards = null } = {}) {
  if (m.erro) return ok(false, `${nome}: a tela abriu`, m.erro);
  ok(!m.rolagemPagina && !m.larguraRaiz && !m.estoura.length, `${nome}: nada estoura a largura`, JSON.stringify(m.estoura));
  ok(!m.pequenos.length, `${nome}: alvos de toque com tamanho de dedo`, m.pequenos.join(' · '));
  ok(!m.campos.length, `${nome}: campos com 16 px (sem zoom do Safari)`, m.campos.join(' · '));
  if (minLista != null) ok(m.listaVisivel >= minLista, `${nome}: a lista aparece sem rolar (${m.listaVisivel} px, ≥ ${minLista})`, `topo em ${m.listaTopo}`);
  if (minCards != null) ok(m.cardsInteiros >= minCards, `${nome}: ${m.cardsInteiros} itens inteiros na primeira tela (≥ ${minCards})`);
}

/**
 * A folha de filtros de um seletor (`dobrarFiltrosNoCelular`): o funil abre por cima da lista,
 * os campos são de dedo, ligar um filtro acende a bolinha, "Limpar" apaga, "Pronto" fecha.
 * `raiz` pode ser uma lista de seletores: vale o primeiro que tiver o funil.
 */
async function conferirFolhaDeFiltros(nome, raiz) {
  const host = await js(`(() => { for (const r of ${JSON.stringify(raiz)}.split(',')) {
    const bt = document.querySelector(r.trim() + ' .pkf-bt'); if (bt) return r.trim(); } return null; })()`);
  ok(!!host, `${nome}: filtros atrás de "Filtros"`);
  if (!host) return;
  const bt = `${host} .pkf-bt`;
  const hostDe = `document.querySelector(${JSON.stringify(bt)}).closest('.pkf-host')`;
  ok(!(await js(`${hostDe}.classList.contains('pkf-aberta')`)), `${nome}: a folha de filtros nasce fechada`);
  await tocar(bt);
  const aberta = await js(`(() => { const f = ${hostDe}.querySelector(':scope > .pkf-folha');
    if (!f || getComputedStyle(f).display === 'none') return null;
    const r = f.getBoundingClientRect();
    const campos = [...f.querySelectorAll('select, input:not([type="checkbox"])')].map((c) => { const q = c.getBoundingClientRect();
      return { h: Math.round(q.height), fs: parseFloat(getComputedStyle(c).fontSize), w: Math.round(q.width) }; });
    const pr = f.querySelector('.pkf-pronto').getBoundingClientRect();
    return { alt: Math.round(r.height), larg: Math.round(r.width), campos, pronto: Math.round(pr.height),
      prontoVisivel: pr.bottom <= innerHeight + 1 && pr.bottom <= r.bottom + 1 }; })()`);
  ok(!!aberta, `${nome}: o funil abre a folha de filtros`);
  if (!aberta) return;
  await foto(`${nome.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-filtros`);
  ok(aberta.campos.length >= 2 && aberta.campos.every((c) => c.h >= 40 && c.fs >= 16 && c.w >= aberta.larg * 0.6),
    `${nome}: na folha, cada campo é uma linha de dedo`, JSON.stringify(aberta.campos));
  ok(aberta.pronto >= 44 && aberta.prontoVisivel, `${nome}: o "Pronto" está à vista e tem ${aberta.pronto} px`);
  // Liga o IV mínimo: a bolinha acende e o "Limpar" aparece.
  await js(`(() => { const c = ${hostDe}.querySelector('.pkf-folha input[data-f="ivMin"]');
    c.value = '150'; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await dormir(250);
  ok((await js(`${hostDe}.querySelector('.pkf-bt .filtros-conta')?.textContent`)) === '1',
    `${nome}: ligar um filtro acende a bolinha "1"`);
  ok(await js(`!${hostDe}.querySelector('.pkf-limpar').classList.contains('hidden')`), `${nome}: e o "Limpar" aparece`);
  await tocar(`${host} .pkf-limpar`);
  await dormir(250);
  const limpo = await js(`(() => { const h = ${hostDe};
    return { conta: !!h.querySelector('.pkf-bt .filtros-conta'), iv: h.querySelector('.pkf-folha input[data-f="ivMin"]').value }; })()`);
  ok(!limpo.conta && limpo.iv === '', `${nome}: "Limpar" apaga o filtro e a bolinha`, JSON.stringify(limpo));
  await tocar(`${host} .pkf-pronto`);
  ok(!(await js(`${hostDe}.classList.contains('pkf-aberta')`)), `${nome}: "Pronto" fecha a folha`);
}

// ------------------------------------------------------------------ a conta

const NICK = `mv${Date.now().toString(36).slice(-7)}`;
const AMIGO = `${NICK}a`;
const IVS = { hp: 24, atk: 22, def: 20, spAtk: 18, spDef: 26, speed: 28 };
const esp = (n) => [...especies.values()].find((e) => e.name.toLowerCase() === n.toLowerCase());
const criados = [];

async function jogador(nick, level) {
  criados.push(nick);
  await pool.query(`INSERT INTO accounts (nick, email, provedor, email_ok) VALUES ($1, $2, 'local', true)`, [nick, `${nick}@test.local`]);
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, xp, gold, visual_ok, tutorial_visto, discord_pop_campanha, aviso_visto)
     VALUES ($1, $2, $3, 50000000, true, true, 99, 99) RETURNING id`, [nick, level, xpTotalParaNivel(level)]);
  return Number(rows[0].id);
}
async function pokemon(pid, nome, { slot = null, level = 120, pot = 1, shiny = false, q = 1.2 } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, quality, ivs, hp, shiny, potencia, slot)
     VALUES ($1, $2, $3, $4, $5::jsonb, 99999, $6, $7, $8) RETURNING id`,
    [pid, esp(nome).pokeId, level, q, JSON.stringify(IVS), shiny, pot, slot]);
  return Number(rows[0].id);
}

async function montarConta() {
  const pid = await jogador(NICK, 320);
  const time = [];
  for (const [i, n] of ['Charizard', 'Blastoise', 'Venusaur', 'Arcanine', 'Gyarados'].entries()) {
    time.push(await pokemon(pid, n, { slot: i, level: 300, pot: 3 }));
  }
  await pool.query(`UPDATE players SET active_poke = $2, items = $3::jsonb, xp_share_total = 1 WHERE id = $1`,
    [pid, time[0], JSON.stringify({ [XP_SHARE_HELD_ID]: 2 })]);
  const nomes = ['Charmander', 'Squirtle', 'Bulbasaur', 'Growlithe', 'Magikarp', 'Pidgey', 'Rattata', 'Gastly',
    'Abra', 'Machop', 'Geodude', 'Ponyta', 'Eevee', 'Dratini', 'Larvitar', 'Houndour'];
  const colecao = [];
  for (let i = 0; i < 34; i++) {
    const idp = await pokemon(pid, nomes[i % nomes.length], { level: 80 + i, pot: 1 + (i % 5), shiny: i % 11 === 0, q: 0.9 + (i % 7) / 10 });
    if (i % 3 === 0) colecao.push(idp);
  }
  colecao.push(time[1]);
  await pool.query(
    `UPDATE players SET automation = jsonb_build_object('pokemonTravado', $2::jsonb, 'autoLockShiny', true) WHERE id = $1`,
    [pid, JSON.stringify(colecao)]);
  // O amigo, para o anexo da DM.
  const amigo = await jogador(AMIGO, 50);
  await pokemon(amigo, 'Pikachu', { slot: 0 });
  const [a, b] = pid < amigo ? [pid, amigo] : [amigo, pid];
  await pool.query(`INSERT INTO amizades (a_id, b_id) VALUES ($1, $2)`, [a, b]);
  // A inscrição no campeonato (a folha "Selecionar minha Equipe" só abre para inscrito).
  await pool.query(`INSERT INTO campeonato_inscricoes (campeonato, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [CAMPEONATO.id, pid]);
  return pid;
}

async function apagarContas() {
  for (const nick of criados) {
    const { rows } = await pool.query(`SELECT id FROM players WHERE lower(nick) = lower($1)`, [nick]);
    const pid = rows[0]?.id;
    if (pid) {
      await pool.query(`DELETE FROM guilds WHERE owner_id = $1`, [pid]).catch(() => {});
      await pool.query(`DELETE FROM campeonato_inscricoes WHERE player_id = $1`, [pid]).catch(() => {});
      await pool.query(`DELETE FROM player_pokemon WHERE player_id = $1`, [pid]).catch(() => {});
    }
    await pool.query(`DELETE FROM accounts WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
    await pool.query(`DELETE FROM players WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
  }
}

const PONTE_WS = `(() => {
  const Orig = window.WebSocket;
  window.WebSocket = function (...a) { const s = new Orig(...a); window.__wsJogo = s; return s; };
  window.WebSocket.prototype = Orig.prototype; Object.assign(window.WebSocket, Orig);
})();`;
const mandar = (p) => js(`window.__wsJogo.send(${JSON.stringify(JSON.stringify(p))})`);

// ------------------------------------------------------------------ o tour

try {
  console.log(`COLEÇÃO no celular — ${NOME_AP} ${ap.larg}×${ap.alt}\n${'='.repeat(44)}`);
  await montarConta();
  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', {
    width: ap.larg, height: ap.alt, deviceScaleFactor: ap.dpr, mobile: true, screenWidth: ap.larg, screenHeight: ap.alt,
  });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cmd('Emulation.setUserAgentOverride', { userAgent: ap.ua });
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: PONTE_WS });
  const sessao = await sessaoDe(NICK);
  await cmd('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))}); } catch (_) {}`,
  });
  await cmd('Page.navigate', { url: `${BASE}/app` });
  ok(await esperar(`document.documentElement.classList.contains('mobile') && (document.querySelector('#tr-nick')?.textContent ?? '').trim().length > 2`, 40000),
    'o jogo abriu na montagem de celular');
  await js(`document.getElementById('discord-popup-fechar')?.click()`);
  await dormir(600);
  await mandar({ t: 'guild.criar', nome: `Mv${NICK.slice(-6)}`, brasao: {} });
  await dormir(1200);
  // Criar a guild abre a janela dela por cima de tudo.
  await clicar('#guild-fechar');
  await dormir(400);

  // -------------------------------------------------------------------------------------
  secao('1. Market NPC — Venda Pokémons');
  await abrirMenu('market');
  await tocar('.mk-aba[data-aba="pokemons"]');
  await esperar(ha('#mk-corpo .mk-colecao'));
  await foto('market');
  conferir('Venda Pokémons', await medir('#modal .modal-caixa', '#mk-corpo .mk-grade'), { minLista: 300, minCards: 2 });
  const alvoSeta = await js(`(() => { const r = document.querySelector('#mk-corpo .mk-colecao').getBoundingClientRect(); return Math.min(r.width, r.height); })()`);
  ok(alvoSeta >= 32, `a setinha da Coleção tem ${Math.round(alvoSeta)} px`);
  const sobre = await js(`(() => { const a = document.querySelector('#mk-corpo .mk-colecao').getBoundingClientRect();
    const b = document.querySelector('#mk-corpo .mk-ficha-btn').getBoundingClientRect();
    return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top); })()`);
  ok(!sobre, 'a setinha e o (i) não se sobrepõem');
  await conferirFolhaDeFiltros('Venda Pokémons', '#mk-corpo');
  await fecharTudo();

  // -------------------------------------------------------------------------------------
  secao('2. Bolsa — aba Coleção');
  await clicar('.m-nav button[data-aba="bolsa"]');
  await dormir(700);
  await tocar('.bolsa-aba[data-aba="colecao"]');
  await esperar(ha('#colb-grade .mk-card'));
  await foto('bolsa');
  conferir('Bolsa · Coleção', await medir('#modal .modal-caixa', '#colb-grade'), { minLista: 380, minCards: 4 });
  await conferirFolhaDeFiltros('Bolsa · Coleção', '.colb');
  await fecharTudo();

  // -------------------------------------------------------------------------------------
  secao('3. Depot — Depot | Coleção');
  await clicar('.ir-centro');
  await esperar(`!document.getElementById('centro-depot')?.classList.contains('hidden')`, 8000);
  await tocar('#centro-depot');
  await esperar(`!document.getElementById('centro-depot-modal').classList.contains('hidden')`);
  await foto('depot');
  conferir('Depot', await medir('#centro-depot-modal .modal-caixa', '#depot-guardados'), { minLista: 250, minCards: 3 });
  await tocar('#depot-lados .depot-lado[data-lado="colecao"]');
  await foto('depot-colecao');
  conferir('Depot · Coleção', await medir('#centro-depot-modal .modal-caixa', '#depot-guardados'), { minLista: 250, minCards: 3 });
  const linha = await js(`(() => { const l = document.querySelector('#depot-guardados .poke-linha'); if (!l) return null;
    const nome = l.querySelector('.pl-nome').getBoundingClientRect(); return { nome: Math.round(nome.width), linha: Math.round(l.getBoundingClientRect().width) }; })()`);
  ok(linha && linha.nome >= 120, `o nome na linha do Depot tem espaço (${linha?.nome} px de ${linha?.linha})`);
  await fecharTudo();

  // -------------------------------------------------------------------------------------
  const folha = async (nome, abrir, lista, { minLista = 230, minCards = 2 } = {}) => {
    secao(nome);
    const foi = await abrir();
    ok(foi, `${nome}: abriu`);
    if (!foi) return;
    await esperar(ha(`${lista} .mk-card`), 8000);
    await foto(nome.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
    const caixa = '.cm-folha-caixa, #guild-time-modal:not(.hidden) .modal-caixa';
    conferir(nome, await medir(caixa, lista), { minLista, minCards });
    const alt = await js(`Math.round(document.querySelector(${JSON.stringify(caixa)}).getBoundingClientRect().height / innerHeight * 100)`);
    ok(alt >= 85, `${nome}: a folha usa a altura da tela (${alt}%)`);
    await conferirFolhaDeFiltros(nome, '.cm-folha-caixa, #guild-time-corpo');
  };

  await folha('4. Oferenda', async () => {
    await clicar('.m-nav button[data-aba="bolsa"]');
    await dormir(700);
    await tocar('.bolsa-aba[data-aba="oferenda"]');
    await esperar(ha('.ofr-casa-vazia'));
    return tocar('.ofr-casa-vazia');
  }, '#ofrpk-grade', { minLista: 380, minCards: 4 });
  await fecharTudo();

  await folha('5. Novo anúncio', async () => {
    await abrirMenu('community');
    await esperar(ha('#cm-anunciar'));
    await tocar('#cm-anunciar');
    await dormir(400);
    return js(`(() => { const b = [...document.querySelectorAll('.cm-folha button')].find((x) => /pok/i.test(x.textContent) && !/diamant/i.test(x.textContent)); b?.click(); return !!b; })()`);
  }, '#cm-pks', { minLista: 380, minCards: 4 });
  // A regra do anúncio mostra duas linhas e abre no toque.
  if (await existe('.cmpk-notas.nota-dobravel')) {
    const antes = await js(`document.querySelector('.cmpk-notas').getBoundingClientRect().height`);
    await tocar('.cmpk-notas');
    const depois = await js(`document.querySelector('.cmpk-notas').getBoundingClientRect().height`);
    ok(depois > antes + 10, `a regra do anúncio abre no toque (${Math.round(antes)} → ${Math.round(depois)} px)`);
  } else ok(false, 'a regra do anúncio fica dobrada no celular');
  await fecharTudo();

  await folha('6. Anexo da DM', async () => {
    await tocarNoMenu('#btn-amigos');
    await esperar(ha('.amigo-linha[data-id]'));
    await tocar('.amigo-linha[data-id]');
    await esperar(ha('#dm-anexo'));
    return tocar('#dm-anexo');
  }, '#dmpk-grade', { minLista: 420, minCards: 4 });
  await fecharTudo();
  await js(`document.querySelector('#amigos-fechar, #amigos .modal-topo button')?.click()`);
  await dormir(300);

  await folha('7. Equipe do PvP', async () => {
    await abrirMenu('pvp');
    await esperar(ha('#pvp-editar-time'));
    return tocar('#pvp-editar-time');
  }, '.eqf-grade', { minLista: 300, minCards: 4 });
  if (await existe('.eqf-grade .mk-card')) {
    // A conta nasce sem equipe de PvP salva: a folha começa vazia.
    await js(`(() => { for (const c of document.querySelectorAll('.eqf-grade .mk-card.ofrpk-on')) c.click(); })()`);
    await dormir(200);
    ok(/Toque nos cards/i.test(await js(`document.querySelector('.eqf-casa-barra')?.textContent ?? ''`)), 'sem escolhidos, a barra ensina a escolher');
    await tocar('.eqf-grade .mk-card:nth-child(1)');
    await tocar('.eqf-grade .mk-card:not(.ofrpk-on)');
    const ids = await js(`[...document.querySelectorAll('.eqf-grade .mk-card.ofrpk-on')].map((c) => c.dataset.id)`);
    ok(ids.length === 2, `tocar dois cards escolhe dois (${ids.length})`);
    ok(/Toque numa casa/i.test(await js(`document.querySelector('.eqf-casa-barra').textContent`)), 'com escolhidos, a barra ensina a mexer na casa');
    ok(await js(`getComputedStyle(document.querySelector('.eqf-casa.cheia .eqf-casa-acoes')).display === 'none'`), 'as setinhas miúdas da casa somem no celular');
    await tocar('.eqf-casa.cheia');
    const barra = await js(`(() => { const b = document.querySelector('.eqf-casa-barra.ativa'); if (!b) return null;
      return { nome: b.querySelector('.eqf-barra-nome').textContent.trim(),
        bts: [...b.querySelectorAll('button')].map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), x.disabled]; }) }; })()`);
    ok(!!barra, 'tocar a casa abre a barra das ações dela');
    ok(barra && barra.bts.length === 3 && barra.bts.every(([w, h]) => w >= 40 && h >= 40), `as ações da casa têm tamanho de dedo (${JSON.stringify(barra?.bts)})`);
    ok(barra && barra.bts[0][2] === true && barra.bts[2][2] === false, 'na casa 1, só o "para a direita" vale');
    await foto('7-pvp-casa');
    const semNumero = (x) => x.trim().replace(/^\d+\s*/, '');
    const primeiro = await js(`document.querySelector('.eqf-casa-barra .eqf-barra-nome').textContent`);
    await tocar('.eqf-casa-barra .eqf-barra-bt[data-mover="1"]');
    const agora = await js(`document.querySelector('.eqf-casa-barra .eqf-barra-nome')?.textContent ?? ''`);
    ok(/^2\b/.test(agora.trim()) && semNumero(agora) === semNumero(primeiro),
      `"▶" leva o marcado para a casa 2 e a barra acompanha (${primeiro.trim()} → ${agora.trim()})`);
    await tocar('.eqf-casa-barra .eqf-barra-tirar');
    const restam = await js(`document.querySelectorAll('.eqf-casa.cheia').length`);
    ok(restam === 1 && !(await existe('.eqf-casa-barra.ativa')), `"Tirar" esvazia a casa e fecha a barra (${restam} cheia)`);
  }
  await fecharTudo();

  await folha('8. Equipe de guerra', async () => {
    await tocarNoMenu('#tr-guild');
    await esperar(ha('#guild-editar-time'), 8000);
    return tocar('#guild-editar-time');
  }, '#guild-time-corpo .eqf-grade', { minLista: 300, minCards: 4 });
  if (await existe('#guild-time-corpo .eqf-nota')) {
    ok(await existe('#guild-time-corpo .eqf-nota.nota-dobravel'), 'o texto longo da guerra fica dobrado em duas linhas');
  }
  await fecharTudo();

  await folha('9. Equipe do Campeonato', async () => {
    await abrirMenu('campeonato');
    await esperar(ha('#camp-equipe-abrir'), 8000);
    return tocar('#camp-equipe-abrir');
  }, '#campeq-grade', { minLista: 360, minCards: 4 });
  await fecharTudo();

  secao('10. Vitrine do perfil');
  await tocar('#tr-retrato');
  await esperar(ha('#pf-vitrine-editar'), 8000);
  await tocar('#pf-vitrine-editar');
  await esperar(`!document.getElementById('vitrine-editor').classList.contains('hidden')`);
  await foto('vitrine');
  conferir('Vitrine', await medir('#vitrine-editor .modal-caixa', '#vte-grade'), { minLista: 300, minCards: 4 });
  const barraVte = await js(`(() => { const b = document.querySelector('#vte-busca').getBoundingClientRect(); const l = document.querySelector('#vte-local').getBoundingClientRect();
    return { busca: Math.round(b.width), local: Math.round(l.width), mesmaLinha: Math.abs(b.top - l.top) < 6 }; })()`);
  ok(barraVte.busca >= 150 && barraVte.mesmaLinha, `a busca da vitrine tem espaço ao lado do Local (${JSON.stringify(barraVte)})`);
  await fecharTudo();

  secao('11. Exp. Share');
  await clicar('.m-nav button[data-aba="bolsa"]');
  await dormir(700);
  await tocar('.bolsa-aba[data-aba="raros"]');
  await dormir(400);
  await tocar('.bolsa-card-xpshare');
  await esperar(ha('.xsh-secao'), 6000);
  await foto('xpshare');
  const secoes = await js(`[...document.querySelectorAll('.xsh-secao-titulo')].map((h) => h.textContent)`);
  ok(secoes.some((s) => /Cole/i.test(s)), 'o Exp. Share tem a seção Coleção', JSON.stringify(secoes));
  conferir('Exp. Share', await medir('.cm-folha-caixa', '.xsh-grade'), { minCards: 2 });
  await fecharTudo();

  secao('12. Ginásio');
  await abrirMenu('ginasios');
  await esperar(ha('.gin-card'), 8000);
  await tocar('.gin-card.FIRE');
  await esperar(ha('#gin-editar'), 6000);
  await tocar('#gin-editar');
  await esperar(ha('#gin-ed-lista'), 6000);
  await foto('ginasio');
  conferir('Editor de ginásio', await medir('#modal .modal-caixa', '#gin-ed-lista'), { minLista: 150, minCards: 1 });
  await fecharTudo();

  ok(cobertos.length === 0, 'nenhum botão tocado estava coberto por outra coisa', cobertos.join(' · '));
  ok(erros.length === 0, 'sem erro de JavaScript', erros.join(' | '));
} catch (err) {
  falhas++;
  console.log(`\n✗ o teste parou: ${err.stack ?? err.message}`);
} finally {
  ws.close();
  proc.kill();
  await apagarContas();
  await pool.end().catch(() => {});
}
console.log(`\n${testes - falhas}/${testes} ${falhas ? `— ${falhas} FALHA(S)` : 'ok'}`);
process.exit(falhas ? 1 : 0);
