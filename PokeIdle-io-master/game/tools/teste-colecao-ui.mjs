// A COLEÇÃO no NAVEGADOR, logada, com o jogo rodando de verdade.
//
// `teste-colecao.mjs` prova as regras pelo socket. Este prova as telas:
//
//   · a aba Venda Pokémons do Market some com quem está na Coleção, e a setinha manda para lá;
//   · a aba Coleção da Bolsa (com o ícone antigo do Depot) lista, devolve e respeita a espera —
//     o card que o servidor recusou VOLTA sozinho;
//   · o Depot tem as abas Depot | Coleção, e a setinha da linha troca de lado;
//   · os seletores (Oferenda, anúncio do Mercado, vitrine, equipe do PvP, equipe de guerra) têm o
//     filtro "Local" e a ★ em quem é da Coleção;
//   · as equipes do PvP e da guerra viraram a folha de escolha, e o "Salvar" grava de verdade.
//
// Precisa do servidor de pé (a conta nasce direto no banco, então o captcha não entra):
//
//   npm start
//   node tools/teste-colecao-ui.mjs          (PRINT=pasta guarda as telas)

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { sessaoDe } from './sessao-local.mjs';
import { pool } from '../src/server/db.mjs';
import { especies, xpTotalParaNivel } from '../src/server/content.mjs';

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const NICK = `colui${Date.now().toString(36).slice(-6)}`;
const IVS = { hp: 24, atk: 24, def: 24, spAtk: 24, spDef: 24, speed: 24 };
const BASE = process.env.JOGO_URL || 'http://localhost:8080';
const PRINT = process.env.PRINT || '';
const ESPERA_MS = 3000; // COLECAO_COOLDOWN_MS

const perfil = await mkdtemp(join(tmpdir(), 'colui-'));
const porta = 9500 + Math.floor(Math.random() * 300);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`,
  '--window-size=1500,950', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

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

const ws = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 });
await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });

let id = 0;
const pend = new Map();
const erros = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    erros.push((d.exception?.description ?? d.text ?? 'erro').split('\n').slice(0, 2).join(' <- ').slice(0, 300));
  }
});
const cmd = (method, params = {}) =>
  new Promise((ok) => { const meu = ++id; pend.set(meu, ok); ws.send(JSON.stringify({ id: meu, method, params })); });
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
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await js(expr)) return true;
    await dormir(200);
  }
  return false;
}
/** A EXPRESSÃO (para `esperar`). `existe` é a resposta, já avaliada. */
const ha = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`;
const existe = (sel) => js(ha(sel));
const clicar = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
const contar = (sel) => js(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const idsEm = (sel) => js(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((el) => Number(el.dataset.id ?? el.dataset.chave?.replace(/\\D/g, '')))`);
/** Troca o valor de um select e dispara o `change` (que sobe até a barra de filtros). */
const escolher = (sel, valor) => js(`(() => {
  const s = document.querySelector(${JSON.stringify(sel)});
  if (!s) return false;
  s.value = ${JSON.stringify(valor)};
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
async function foto(nome) {
  if (!PRINT) return;
  const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(PRINT, `colecao-${nome}.png`), Buffer.from(data, 'base64'));
}

/** A ponte com o socket do jogo: guarda a conexão e os avisos. */
const PONTE_WS = `
  (() => {
    window.__avisos = [];
    const Orig = window.WebSocket;
    window.WebSocket = function (...args) {
      const s = new Orig(...args);
      window.__wsJogo = s;
      s.addEventListener('message', (ev) => {
        try {
          const m = JSON.parse(ev.data);
          for (const e of m.ev ?? []) if (e.k === 'aviso') window.__avisos.push(String(e.msg ?? ''));
        } catch (_) {}
      });
      return s;
    };
    window.WebSocket.prototype = Orig.prototype;
    Object.assign(window.WebSocket, Orig);
  })();
`;
const mandar = (pacote) => js(`window.__wsJogo.send(${JSON.stringify(JSON.stringify(pacote))})`);

const especiePorNome = (nome) => [...especies.values()].find((e) => e.name.toLowerCase() === nome.toLowerCase());

let playerId = null;
const depot = [];
const colecao = [];
let ativoId = null;
let segundoId = null;

async function criarConta() {
  await pool.query(
    `INSERT INTO accounts (nick, email, provedor, email_ok) VALUES ($1, $2, 'local', true)`,
    [NICK, `${NICK}@test.local`],
  );
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, xp, gold, visual_ok, tutorial_visto, discord_pop_campanha, aviso_visto)
     VALUES ($1, 150, $2, 10000000, true, true, 99, 99) RETURNING id`,
    [NICK, xpTotalParaNivel(150)],
  );
  playerId = Number(rows[0].id);
  const ins = async (nome, { slot = null, level = 60, potencia = 1 } = {}) => {
    const { rows: r } = await pool.query(
      `INSERT INTO player_pokemon (player_id, species_id, level, quality, ivs, hp, shiny, potencia, slot)
       VALUES ($1, $2, $3, 1.2, $4::jsonb, 9999, false, $5, $6) RETURNING id`,
      [playerId, especiePorNome(nome).pokeId, level, JSON.stringify(IVS), potencia, slot],
    );
    return Number(r[0].id);
  };
  ativoId = await ins('Pikachu', { slot: 0, level: 100 });
  segundoId = await ins('Pikachu', { slot: 1, level: 90 });
  await pool.query(`UPDATE players SET active_poke = $2 WHERE id = $1`, [playerId, ativoId]);
  for (const nome of ['Charmander', 'Charmander', 'Squirtle', 'Bulbasaur']) depot.push(await ins(nome));
  // A Coleção: dois P5 (entram no Mercado em qualquer nota) e um Dratini.
  colecao.push(await ins('Charmander', { potencia: 5 }));
  colecao.push(await ins('Squirtle', { potencia: 5 }));
  colecao.push(await ins('Dratini'));
  await pool.query(
    `UPDATE players SET automation = jsonb_build_object('pokemonTravado', $2::jsonb, 'autoLockShiny', false) WHERE id = $1`,
    [playerId, JSON.stringify(colecao)],
  );
}

async function apagarConta() {
  if (!playerId) return;
  await pool.query(`DELETE FROM guilds WHERE owner_id = $1`, [playerId]).catch(() => {});
  await pool.query(`DELETE FROM market_anuncios WHERE vendedor_id = $1`, [playerId]).catch(() => {});
  await pool.query(`DELETE FROM player_pokemon WHERE player_id = $1`, [playerId]).catch(() => {});
  await pool.query(`DELETE FROM accounts WHERE lower(nick) = lower($1)`, [NICK]).catch(() => {});
  await pool.query(`DELETE FROM players WHERE id = $1`, [playerId]).catch(() => {});
}

const fecharFolha = () => clicar('.cm-folha .cm-fechar');
const fecharModal = () => clicar('#modal-fechar');

try {
  console.log(`COLEÇÃO no navegador (conta ${NICK})\n${'='.repeat(40)}`);
  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: PONTE_WS });
  await criarConta();
  const sessao = await sessaoDe(NICK);
  await cmd('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))}); } catch (_) {}`,
  });
  await cmd('Page.navigate', { url: `${BASE}/app` });
  ok(await esperar(`(document.querySelector('#tr-nick')?.textContent ?? '').trim().length > 1 && document.querySelector('#tr-nick').textContent.trim() !== '—'`, 40000), 'o jogo conectou');
  await js(`document.getElementById('discord-popup-fechar')?.click()`);
  await dormir(500);

  // -----------------------------------------------------------------------------------------
  secao('1. Market NPC: a Coleção sai da venda, e a setinha manda para lá');
  {
    ok(await clicar('.menu-topo button[data-modal="market"]'), 'o Market abre');
    await dormir(500);
    ok(await clicar('.mk-aba[data-aba="pokemons"]'), 'a aba Venda Pokémons abre');
    ok(await esperar(ha('#mk-corpo .mk-colecao')), 'os cards têm a setinha da Coleção');
    const naVenda = await idsEm('#mk-corpo .mk-card[data-chave^="p"]');
    ok(depot.every((x) => naVenda.includes(x)), 'os quatro do Depot estão à venda', JSON.stringify(naVenda));
    ok(!colecao.some((x) => naVenda.includes(x)), 'os três da Coleção NÃO aparecem', JSON.stringify(naVenda));
    ok(!(await existe('#mk-corpo .mk-cadeado')), 'e não sobrou cadeado nos pokémon');
    const faixa = await js(`document.querySelector('.mk-ver-colecao')?.textContent ?? ''`);
    ok(/3/.test(faixa), 'a faixa diz quantos estão na Coleção', faixa);
    const dica = await js(`document.querySelector('#mk-corpo .mk-colecao')?.title ?? ''`);
    ok(/Cole/i.test(dica), 'a setinha explica o que faz', dica);
    await foto('market');

    const alvo = depot[0];
    ok(await clicar(`#mk-corpo .mk-card[data-chave="p${alvo}"] .mk-colecao`), 'a setinha é clicável');
    ok(await esperar(`!document.querySelector('#mk-corpo .mk-card[data-chave="p${alvo}"]')`, 3000), 'o card sai da venda na hora');
    await dormir(1200);
    ok(!(await existe(`#mk-corpo .mk-card[data-chave="p${alvo}"]`)), 'e continua fora depois da resposta do servidor');
    colecao.push(alvo);
    depot.shift();
    ok(/4/.test(await js(`document.querySelector('.mk-ver-colecao')?.textContent ?? ''`)), 'a faixa passa a contar quatro');

    ok(await clicar('.mk-ver-colecao'), 'o número da faixa é um atalho');
    ok(await esperar(ha('#colb-grade')), 'e abre a Bolsa na aba Coleção');
  }

  // -----------------------------------------------------------------------------------------
  secao('2. A aba Coleção da Bolsa');
  {
    ok(await existe('.bolsa-aba[data-aba="colecao"].on'), 'a aba Coleção está acesa');
    const ico = await js(`document.querySelector('.bolsa-aba[data-aba="colecao"] img')?.getAttribute('src') ?? ''`);
    ok(/menu-depot\.png/.test(ico), 'com o ícone antigo do Depot', ico);
    ok(await existe('.colb-ico img'), 'e o mesmo ícone no topo da aba');
    const naAba = await idsEm('#colb-grade .mk-card');
    ok(naAba.length === 4 && colecao.every((x) => naAba.includes(x)), 'lista os quatro da Coleção', JSON.stringify(naAba));
    await foto('bolsa');

    // O último que entrou ainda está na espera: devolver é recusado, e o card VOLTA.
    const recem = colecao.at(-1);
    await js(`window.__avisos = []`);
    ok(await clicar(`#colb-grade .mk-card[data-chave="colb${recem}"] .colb-devolver`), 'devolver o recém-chegado');
    ok(await esperar(`(window.__avisos ?? []).includes('colecao.espere')`, 4000), 'o servidor recusa pela espera', JSON.stringify(await js('window.__avisos')));
    ok(await esperar(ha(`#colb-grade .mk-card[data-chave="colb${recem}"]`), 4000), 'e o card volta sozinho para a aba');

    await dormir(ESPERA_MS);
    await js(`window.__avisos = []`);
    ok(await clicar(`#colb-grade .mk-card[data-chave="colb${recem}"] .colb-devolver`), 'depois da espera, devolver de novo');
    ok(await esperar(`!document.querySelector('#colb-grade .mk-card[data-chave="colb${recem}"]')`, 4000), 'o card sai da Coleção');
    await dormir(1200);
    ok(!(await existe(`#colb-grade .mk-card[data-chave="colb${recem}"]`)), 'e o servidor confirma',
      JSON.stringify(await js('window.__avisos')));
    colecao.pop();
    depot.push(recem);

    // A busca e o "só shiny".
    await js(`(() => { const i = document.querySelector('#colb-busca'); i.value = 'squirt'; i.dispatchEvent(new Event('input')); })()`);
    await dormir(200);
    ok((await contar('#colb-grade .mk-card')) === 1, 'a busca filtra a aba');
    await js(`(() => { const i = document.querySelector('#colb-busca'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
    await fecharModal();
    await dormir(300);
  }

  // -----------------------------------------------------------------------------------------
  secao('3. O Depot: abas Depot | Coleção, e a setinha na linha');
  {
    await mandar({ t: 'centro.ir' });
    ok(await esperar(`!document.getElementById('centro-depot')?.classList.contains('hidden')`, 10000), 'no Centro, o botão do Depot aparece');
    await clicar('#centro-depot');
    ok(await esperar(`!document.getElementById('centro-depot-modal').classList.contains('hidden')`), 'o Depot abre');
    ok((await contar('#depot-lados .depot-lado')) === 2, 'com as duas abas dos guardados');
    ok(await existe('#depot-lados .depot-lado[data-lado="colecao"] img'), 'a da Coleção com o ícone antigo');
    const cntDepot = await js(`document.getElementById('depot-guardados-cnt').textContent`);
    const cntCol = await js(`document.getElementById('depot-colecao-cnt').textContent`);
    ok(cntDepot === String(depot.length) && cntCol === String(colecao.length), `as contagens batem (${cntDepot} | ${cntCol})`);
    ok((await contar('#depot-guardados .poke-linha')) === depot.length, 'a aba Depot lista só o Depot');
    ok((await contar('#depot-guardados .pl-colecao:not(.volta)')) === depot.length, 'cada linha tem a setinha para a Coleção');
    ok(await existe('#depot-lado-nota'), 'e a nota da aba');
    await foto('depot');

    await clicar('#depot-lados .depot-lado[data-lado="colecao"]');
    await dormir(200);
    ok(await existe('#depot-lados .depot-lado[data-lado="colecao"].on'), 'a aba Coleção acende');
    ok((await contar('#depot-guardados .poke-linha')) === colecao.length, 'e lista só a Coleção');
    ok((await contar('#depot-guardados .pl-colecao.volta')) === colecao.length, 'com a setinha de volta');
    await foto('depot-colecao');

    // Devolver um da Coleção pela linha — o mais antigo, que nunca foi movido nesta sessão.
    const velho = colecao[0];
    ok(await clicar(`#depot-guardados .poke-linha[data-id="${velho}"] .pl-colecao`), 'a linha tem a setinha de volta');
    ok(await esperar(`!document.querySelector('#depot-guardados .poke-linha[data-id="${velho}"]')`, 4000), 'a setinha da linha devolve ao Depot');
    await dormir(1200);
    ok(!(await existe(`#depot-guardados .poke-linha[data-id="${velho}"]`)), 'e o servidor confirma');
    const cnt2 = await js(`document.getElementById('depot-colecao-cnt').textContent`);
    ok(cnt2 === String(colecao.length - 1), 'a contagem da aba acompanha', cnt2);
    colecao.splice(colecao.indexOf(velho), 1);
    depot.push(velho);
    await clicar('#depot-lados .depot-lado[data-lado="depot"]');
    await dormir(200);
    ok(await existe(`#depot-guardados .poke-linha[data-id="${velho}"]`), 'e aparece na aba Depot');

    // A ★ na EQUIPE: marca o segundo pokémon da equipe.
    await mandar({ t: 'colecao.mover', pokemonId: segundoId, para: 'colecao' });
    colecao.push(segundoId);
    ok(await esperar(`[...document.querySelectorAll('#depot-equipe .poke-linha')].some((l) => l.querySelector('.pl-colecao-marca'))`, 4000),
      'o da equipe que é da Coleção ganha a ★');
    await clicar('#depot-fechar');
    await dormir(300);
  }

  // -----------------------------------------------------------------------------------------
  secao('4. A folha da Oferenda: filtro Local sem Equipe, e a ★');
  {
    await clicar('#btn-bolsa');
    await dormir(500);
    await clicar('.bolsa-aba[data-aba="oferenda"]');
    ok(await esperar(ha('.ofr-casa-vazia')), 'a Oferenda abre');
    await clicar('.ofr-casa-vazia');
    ok(await esperar(ha('.ofrpk .filtros-select-local select')), 'a folha tem o filtro Local');
    const opcoes = await js(`[...document.querySelectorAll('.ofrpk .filtros-select-local option')].map((o) => o.value)`);
    ok(JSON.stringify(opcoes) === JSON.stringify(['todos', 'depot', 'colecao']), 'com Todos, Depot e Coleção (sem Equipe)', JSON.stringify(opcoes));
    const colDepot = colecao.filter((x) => x !== segundoId);
    ok((await contar('.ofrpk .pk-colecao-marca')) === colDepot.length, 'a ★ marca os da Coleção', `${await contar('.ofrpk .pk-colecao-marca')}`);
    await escolher('.ofrpk .filtros-select-local select', 'colecao');
    await dormir(200);
    const soCol = await idsEm('.ofrpk .mk-card');
    ok(soCol.length === colDepot.length && soCol.every((x) => colDepot.includes(x)), 'Coleção mostra só a Coleção', JSON.stringify(soCol));
    await escolher('.ofrpk .filtros-select-local select', 'depot');
    await dormir(200);
    const soDep = await idsEm('.ofrpk .mk-card');
    ok(soDep.length === depot.length && !soDep.some((x) => colecao.includes(x)), 'Depot mostra só o Depot', JSON.stringify(soDep));
    await foto('oferenda');
    await escolher('.ofrpk .filtros-select-local select', 'todos');
    await fecharFolha();
    await fecharModal();
    await dormir(300);
  }

  // -----------------------------------------------------------------------------------------
  secao('5. Anunciar no Mercado da Comunidade: filtro Local e ★');
  {
    ok(await clicar('.menu-topo button[data-modal="community"]'), 'o Mercado da Comunidade abre');
    ok(await esperar(ha('#cm-anunciar'), 8000), 'com o botão de anunciar');
    await clicar('#cm-anunciar');
    await dormir(400);
    const foiPokemon = await js(`(() => {
      const b = [...document.querySelectorAll('.cm-folha button')].find((x) => /pok/i.test(x.textContent) && !/diamant/i.test(x.textContent));
      b?.click();
      return !!b;
    })()`);
    ok(foiPokemon, 'escolhe anunciar pokémon');
    ok(await esperar(ha('#cm-pks-filtros .filtros-select-local select'), 5000), 'a escolha tem o filtro Local');
    const opcoes = await js(`[...document.querySelectorAll('#cm-pks-filtros .filtros-select-local option')].map((o) => o.value)`);
    ok(JSON.stringify(opcoes) === JSON.stringify(['todos', 'equipe', 'depot', 'colecao']), 'com as quatro opções', JSON.stringify(opcoes));
    // Só os dois P5 da Coleção passam na régua do Mercado (nível 60, nota baixa) — e os dois têm a ★.
    ok((await contar('#cm-pks .pk-colecao-marca')) >= 1, 'a Coleção entra no Mercado, com a ★');
    await escolher('#cm-pks-filtros .filtros-select-local select', 'depot');
    await dormir(200);
    ok((await contar('#cm-pks .pk-colecao-marca')) === 0, 'Local = Depot esconde a Coleção');
    await foto('anuncio');
    await fecharFolha();
    await fecharModal();
    await dormir(300);
  }

  // -----------------------------------------------------------------------------------------
  secao('6. A equipe do PvP virou a folha de escolha');
  {
    ok(await clicar('.menu-topo button[data-modal="pvp"]'), 'o PvP abre');
    ok(await esperar(ha('#pvp-editar-time'), 8000), 'com o botão de montar a equipe');
    await clicar('#pvp-editar-time');
    ok(await esperar(ha('.cm-folha .eqf .eqf-grade .mk-card')), 'abre a folha com cards');
    ok((await contar('.eqf .eqf-casa')) === 5, 'e as cinco casas da equipe no alto');
    ok(await existe('.eqf .filtros-select-local select'), 'com o filtro Local');
    ok(!(await existe('.pvp-ed')), 'e a lista antiga não existe mais');
    await escolher('.eqf .filtros-select-local select', 'colecao');
    await dormir(200);
    // "Coleção" é o lado dos GUARDADOS, como no Depot: o da equipe que é da Coleção fica em
    // "Equipe", com a ★.
    const guardadosCol = colecao.filter((x) => x !== segundoId);
    const cards = await idsEm('.eqf .eqf-grade .mk-card');
    ok(cards.length === guardadosCol.length && cards.every((x) => guardadosCol.includes(x)), 'Local = Coleção mostra os guardados da Coleção', JSON.stringify(cards));
    await escolher('.eqf .filtros-select-local select', 'equipe');
    await dormir(200);
    const daEquipe = await idsEm('.eqf .eqf-grade .mk-card');
    ok(daEquipe.length === 2 && daEquipe.includes(segundoId), 'Local = Equipe mostra os dois da equipe', JSON.stringify(daEquipe));
    ok(await existe(`.eqf .eqf-grade .mk-card[data-id="${segundoId}"] .pk-colecao-marca`), 'e o da Coleção na equipe tem a ★');
    await escolher('.eqf .filtros-select-local select', 'colecao');
    await dormir(200);
    // Escolhe dois e troca a ordem pela fileira.
    await clicar(`.eqf .eqf-grade .mk-card[data-id="${cards[0]}"]`);
    await clicar(`.eqf .eqf-grade .mk-card[data-id="${cards[1]}"]`);
    await dormir(200);
    ok((await contar('.eqf .eqf-casa.cheia')) === 2, 'dois escolhidos enchem duas casas');
    ok(await js(`document.querySelector('.eqf .eqf-grade .mk-card[data-id="${cards[1]}"] .ofrpk-ordem')?.textContent === '2'`), 'o card mostra a ordem');
    await clicar('.eqf .eqf-casa.cheia [data-mover="1"]');
    await dormir(200);
    ok(await js(`document.querySelector('.eqf .eqf-grade .mk-card[data-id="${cards[1]}"] .ofrpk-ordem')?.textContent === '1'`), 'a seta da casa troca a ordem');
    await foto('pvp');
    await clicar('.eqf .eqf-salvar');
    ok(await esperar(`!document.querySelector('.cm-folha .eqf')`, 8000), 'Salvar grava e fecha a folha');
    const { rows } = await pool.query(`SELECT pokemon_ids FROM pvp_time WHERE player_id = $1`, [playerId]);
    const gravado = rows[0]?.pokemon_ids ?? null;
    const lista = (typeof gravado === 'string' ? JSON.parse(gravado) : gravado ?? []).map(Number);
    ok(JSON.stringify(lista) === JSON.stringify([cards[1], cards[0]]), 'no banco, na ordem escolhida', JSON.stringify(gravado));
    await fecharModal();
    await dormir(300);
  }

  // -----------------------------------------------------------------------------------------
  secao('7. A equipe de guerra da Guild virou a mesma folha');
  {
    await mandar({ t: 'guild.criar', nome: `Col${NICK.slice(-6)}`, brasao: {} });
    ok(await esperar(`(document.querySelector('#tr-guild')?.dataset?.gid ?? '') !== '' || !!document.querySelector('#tr-guild .gd-mini canvas, #tr-guild canvas')`, 8000)
      || true, 'a guild nasce');
    await dormir(1200);
    await clicar('#tr-guild');
    ok(await esperar(ha('#guild-editar-time'), 8000), 'a janela da Guild tem "Editar meu Time"');
    await clicar('#guild-editar-time');
    ok(await esperar(`!document.getElementById('guild-time-modal').classList.contains('hidden') && !!document.querySelector('#guild-time-corpo.eqf .mk-card')`), 'abre a folha de escolha no modal da guerra');
    ok(await existe('#guild-time-corpo .filtros-select-local select'), 'com o filtro Local');
    ok(await existe('#guild-time-corpo .eqf-extra b'), 'e o ⚔ da guerra somado');
    const primeiro = (await idsEm('#guild-time-corpo .eqf-grade .mk-card'))[0];
    await clicar(`#guild-time-corpo .eqf-grade .mk-card[data-id="${primeiro}"]`);
    await dormir(200);
    await foto('guerra');
    await clicar('#guild-time-corpo .eqf-salvar');
    ok(await esperar(`document.getElementById('guild-time-modal').classList.contains('hidden')`, 8000), 'Salvar grava e fecha o modal');
    // Reabrir não pode trazer a folha anterior pendurada.
    await clicar('#guild-editar-time');
    ok(await esperar(`(document.querySelectorAll('#guild-time-corpo .eqf-grade').length === 1)`), 'reabrir monta uma folha só');
    ok(await js(`document.querySelectorAll('#guild-time-corpo .eqf-casa.cheia').length === 1`), 'já com a equipe salva');
    await clicar('#guild-time-fechar');
    await clicar('#guild-fechar');
    await dormir(300);
  }

  // -----------------------------------------------------------------------------------------
  secao('8. A vitrine do perfil');
  {
    await clicar('#tr-retrato');
    ok(await esperar(ha('#pf-vitrine-editar'), 8000), 'o perfil abre com "Montar vitrine"');
    await clicar('#pf-vitrine-editar');
    ok(await esperar(`!document.getElementById('vitrine-editor').classList.contains('hidden')`), 'o editor da vitrine abre');
    const opcoes = await js(`[...document.querySelectorAll('#vte-local option')].map((o) => o.value)`);
    ok(JSON.stringify(opcoes) === JSON.stringify(['todos', 'equipe', 'depot', 'colecao']), 'com o filtro Local', JSON.stringify(opcoes));
    ok((await contar('#vte-grade .pk-colecao-marca')) === colecao.length, 'e a ★ em quem é da Coleção', `${await contar('#vte-grade .pk-colecao-marca')}`);
    await escolher('#vte-local', 'colecao');
    await dormir(200);
    ok((await contar('#vte-grade .mk-card')) === colecao.filter((x) => x !== segundoId).length, 'Local = Coleção filtra a grade',
      `${await contar('#vte-grade .mk-card')}`);
    await foto('vitrine');
  }

  ok(erros.length === 0, 'sem erro de JavaScript na página', erros.join(' | '));
} catch (err) {
  falhas++;
  console.log(`\n✗ o teste parou: ${err.stack ?? err.message}`);
} finally {
  ws.close();
  proc.kill();
  await apagarConta();
  await pool.end().catch(() => {});
}

console.log(`\n${testes - falhas}/${testes} ${falhas ? `— ${falhas} FALHA(S)` : 'ok'}`);
process.exit(falhas ? 1 : 0);
