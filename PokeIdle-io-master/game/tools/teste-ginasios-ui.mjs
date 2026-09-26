// Os Ginásios no NAVEGADOR, logado, com o jogo rodando de verdade.
//
// Os dois testes de ginásio que já existem provam as regras (`teste-ginasios.mjs`) e o SQL
// (`teste-ginasios-db.mjs`). Nenhum dos dois pega o que quebrou de fato na primeira vez que
// alguém abriu a tela, porque os dois bugs eram do CLIENTE e só apareciam com o jogo andando:
//
//   1. a tela ficava em "Carregando os ginásios…" para sempre quando a resposta não vinha —
//      não havia estado de falha, só espera;
//   2. abrir um ginásio e ficar nele era impossível: `aplicarEstado` remontava o modal a cada
//      snapshot (~500 ms em combate) e `montarGinasios` jogava o jogador de volta na grade.
//
// O (2) é o que este arquivo existe para não deixar voltar: ele abre um ginásio e ESPERA
// vários snapshots passarem antes de conferir que a tela continua lá.
//
// Precisa do servidor de pé E sem captcha (o cadastro é por HTTP):
//
//   TURNSTILE_SECRET_KEY= TURNSTILE_SITE_KEY= npm start
//   node tools/teste-ginasios-ui.mjs

import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { sessaoPara, sessaoParaUrl } from './auth-teste.mjs';
import { pool } from '../src/server/db.mjs';
import { especies, xpTotalParaNivel } from '../src/server/content.mjs';

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const NICK = `gin${Date.now().toString(36).slice(-6)}`;
/** Caçada de nível 1 — qualquer conta nova entra, e o combate faz o snapshot fluir. */
const HUNT = 'caterpie';
const perfil = await mkdtemp(join(tmpdir(), 'ginui-'));
const porta = 9100 + Math.floor(Math.random() * 200);
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
  if (m.method === 'Runtime.exceptionThrown') erros.push(m.params.exceptionDetails.text ?? '?');
});
const cmd = (method, params = {}) =>
  new Promise((ok) => { const meu = ++id; pend.set(meu, ok); ws.send(JSON.stringify({ id: meu, method, params })); });
const js = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text);
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

/** Espera um seletor aparecer; devolve false em vez de estourar. */
async function esperarPor(seletor, ms = 20000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await js(`!!document.querySelector(${JSON.stringify(seletor)})`)) return true;
    await dormir(250);
  }
  return false;
}

/**
 * Espera o jogo estar CONECTADO, e não só desenhado.
 *
 * A barra do topo existe no HTML desde o primeiro frame — clicar nela assim que ela aparece
 * é clicar antes de o socket ter entregado o estado do jogador, e aí o `ginasio.info` sai
 * antes de haver com quem falar. O nick preenchido no HUD é o primeiro sinal de que o
 * `welcome` chegou de verdade.
 */
async function esperarJogoPronto(ms = 40000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    const pronto = await js(`(() => {
      const nick = document.querySelector('#tr-nick')?.textContent?.trim() ?? '';
      return nick !== '' && nick !== '—';
    })()`);
    if (pronto) return true;
    await dormir(300);
  }
  return false;
}

const IVS = { hp: 24, atk: 24, def: 24, spAtk: 24, spDef: 24, speed: 24 };

/**
 * Passa pelo onboarding como um jogador: gênero → cores → starter.
 *
 * Não dá para pular isso pelo banco. O sim guarda o jogador EM MEMÓRIA a partir do `hello` e
 * o flush regrava por cima — um `UPDATE players SET visual_ok = true` feito com a sessão
 * aberta é desfeito sozinho. E enquanto o onboarding está de pé o jogo não anda: sem starter
 * não há combate, sem combate não há snapshot, e sem snapshot este teste não prova nada.
 * (Pior: `element.click()` do CDP atravessa overlay, então os cliques nos botões de trás
 * "funcionam" e o teste passa achando que está jogando.)
 */
async function passarPeloOnboarding() {
  if (!(await esperarPor('.ob-genero', 25000))) return false;
  await js(`document.querySelectorAll('.ob-genero')[0].click()`);
  await dormir(1200);
  await js(`document.getElementById('ob-pronto')?.click()`);
  await dormir(1500);
  if (!(await esperarPor('#ob-starters .starter-card', 15000))) return false;
  await js(`document.querySelectorAll('#ob-starters .starter-card')[0].click()`);
  await dormir(2000);
  return js(`document.getElementById('onboarding').classList.contains('hidden')`);
}

/**
 * Cria o jogador JÁ PRONTO — nível 150, onboarding fechado e um time de fogo.
 *
 * Tem de ser ANTES do primeiro login, e não depois: o sim carrega o jogador na memória no
 * `hello` e passa a ser a fonte da verdade; um `UPDATE` feito com a sessão aberta é
 * sobrescrito pelo flush, e a reconexão dentro dos 90 s de carência reusa a cópia em memória
 * em vez de reler o banco. Como `carregarOuCriarJogador` só INSERE quando a linha não
 * existe, deixar a linha pronta aqui é o caminho por onde o sim entra sem briga.
 */
async function criarJogadorDeTeste(nick) {
  // O `xp` vai junto, e não é detalhe: o nível do treinador é DERIVADO do XP acumulado, então
  // um `level = 150` com `xp = 0` dura até o primeiro abate — o sim recalcula e o jogador
  // despenca para o nível que o XP sustenta (foi assim que este teste viu "nv 14" depois de
  // ter entrado com 150).
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, xp, visual_ok, tutorial_visto, discord_pop_campanha)
     VALUES ($1, 150, $2, true, true, 99) RETURNING id`,
    [nick, xpTotalParaNivel(150)],
  );
  const playerId = Number(rows[0].id);

  const nomes = ['Charizard', 'Arcanine', 'Ninetales', 'Rapidash', 'Magmar'];
  let slot = 1;
  let primeiro = null;
  for (const nome of nomes) {
    const esp = [...especies.values()].find((e) => e.name.toLowerCase() === nome.toLowerCase());
    if (!esp) continue;
    const { rows: novo } = await pool.query(
      `INSERT INTO player_pokemon (player_id, species_id, level, quality, ivs, hp, shiny, potencia, slot)
       VALUES ($1, $2, 150, 1.4, $3::jsonb, 9999, false, 3, $4) RETURNING id`,
      [playerId, esp.pokeId, JSON.stringify(IVS), slot],
    );
    primeiro ??= Number(novo[0].id);
    slot++;
  }
  // SEM `active_poke` não há quem lute — e sem luta o estado não flui, que é justamente a
  // condição que este teste precisa reproduzir.
  if (primeiro) await pool.query(`UPDATE players SET active_poke = $2 WHERE id = $1`, [playerId, primeiro]);
  return playerId;
}

/**
 * Entra numa caçada pelo MAPA, que é o caminho do jogador.
 *
 * O `?hunt=` da URL não serve aqui: ele dispara no carregamento da página, antes de a conta
 * nova ter escolhido o starter — e sem pokémon não há caçada. Então a hunt é escolhida
 * depois, clicando no marcador, como qualquer um faria.
 */
async function entrarNaHunt() {
  await clicar('.menu-topo button[data-modal="mapa"]');
  await esperarPor('.marcador', 15000);
  const clicou = await js(`(() => {
    const m = document.querySelector('.marcador[data-slug=${JSON.stringify(HUNT)}]')
      || document.querySelector('.marcador');
    if (!m) return false;
    m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`);
  await dormir(3000);
  return clicou;
}

/**
 * Conta os pacotes `estado` que chegam pelo socket — a PRECONDIÇÃO do teste principal.
 *
 * O bug que este arquivo guarda é `aplicarEstado` remontando o modal, e `aplicarEstado` só
 * roda quando um `estado` chega. Medir isso por um número na tela não serve (pode não mudar);
 * o que importa é o pacote. O contador é instalado ANTES de qualquer script da página, então
 * pega a conexão desde o primeiro frame.
 */
const CONTADOR_DE_ESTADO = `
  (() => {
    window.__estados = 0;
    const OrigWS = window.WebSocket;
    window.WebSocket = function (...args) {
      const ws = new OrigWS(...args);
      ws.addEventListener('message', (ev) => {
        try {
          if (typeof ev.data === 'string' && ev.data.includes('"t":"estado"')) window.__estados++;
        } catch (_) {}
      });
      return ws;
    };
    window.WebSocket.prototype = OrigWS.prototype;
    Object.assign(window.WebSocket, OrigWS);
  })();
`;

/** Espera o estado começar a chegar em CADÊNCIA de combate (vários pacotes seguidos). */
async function esperarSnapshotsCorrendo(ms = 30000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    const antes = await js(`window.__estados ?? -1`);
    await dormir(2500);
    const depois = await js(`window.__estados ?? -1`);
    if (depois - antes >= 2) return true;
  }
  return false;
}

const clicar = (seletor) => js(`(() => {
  const el = document.querySelector(${JSON.stringify(seletor)});
  if (!el) return false;
  el.click();
  return true;
})()`);

try {
  console.log(`Ginásios no navegador (conta ${NICK})\n==========================================`);
  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: CONTADOR_DE_ESTADO });
  // A conta nasce EQUIPADA, direto no banco. Não é atalho de preguiça: a tela do ginásio
  // exige nível 150 para registrar time, e o bug que este teste guarda só aparece com o
  // estado chegando a cada meio segundo — ou seja, com o pokémon caçando de verdade.
  // Passar por captura de verdade levaria dezenas de minutos para provar a mesma coisa.
  const sessao = await sessaoPara(NICK);
  await criarJogadorDeTeste(NICK);

  secao('Entrar no jogo');
  {
    // Primeiro login: é ele que CRIA a linha em `players` (quem cria é o sim, no `hello` —
    // a conta do `/auth` sozinha não basta).
    await cmd('Page.navigate', { url: sessaoParaUrl(sessao) });
    ok(await esperarPor('.menu-topo button[data-modal="ginasios"]', 30000), 'o jogo carregou e o botão Ginásio está na barra');
    ok(await esperarJogoPronto(), 'o socket entregou o estado do jogador');
    const nivel = await js(`Number(document.querySelector('#tr-level')?.textContent ?? 0)`);
    ok(nivel >= 150, 'entrou já no nível 150, sem passar pelo onboarding', `nv ${nivel}`);
    ok(
      await js(`document.getElementById('onboarding')?.classList.contains('hidden') !== false`),
      'e o onboarding não está por cima da tela',
    );

    // A caçada é escolhida pelo MAPA, e não pelo `?hunt=` da URL: aquele dispara no
    // carregamento da página, antes de o socket estar aberto, e a mensagem se perde.
    await entrarNaHunt();
    const naHunt = await js(`(document.querySelector('#hud-hunt')?.textContent ?? '').trim()`);
    ok(/\S/.test(naHunt) && !/escolha/i.test(naHunt), 'o jogador entrou numa caçada', naHunt);
    ok(await esperarSnapshotsCorrendo(), 'o estado chega em cadência de combate (~2/s)');
  }

  secao('Abrir a tela e sair do "carregando"');
  {
    await clicar('.menu-topo button[data-modal="ginasios"]');
    const veio = await esperarPor('#gin-grade .gin-card', 15000);
    ok(veio, 'a GRADE dos ginásios chegou (não ficou em "carregando" para sempre)');
    const n = await js(`document.querySelectorAll('#gin-grade .gin-card').length`);
    ok(n === 18, 'os 18 ginásios estão na grade', `vieram ${n}`);
    const carregando = await js(`!!document.querySelector('.gin-carregando')`);
    ok(!carregando, 'o "carregando" sumiu depois da resposta');
  }

  secao('Abrir um ginásio E CONTINUAR NELE');
  {
    await clicar('#gin-grade .gin-card.FIRE');
    const abriu = await esperarPor('#gin-podio', 15000);
    ok(abriu, 'o painel do ginásio de FIRE abriu');

    // O CORAÇÃO DO TESTE: vários snapshots passam por aqui. Antes da guarda em
    // `aplicarEstado`, o modal era remontado e a tela voltava para a grade em ~500 ms.
    await dormir(8000);
    const aindaNoPainel = await js(`!!document.querySelector('#gin-podio')`);
    const voltouParaGrade = await js(`!!document.querySelector('#gin-grade')`);
    ok(aindaNoPainel && !voltouParaGrade, 'oito segundos depois a tela CONTINUA no ginásio aberto');

    const titulo = await js(`document.querySelector('.gin-topo-nome')?.textContent ?? ''`);
    ok(/FIRE/.test(titulo), 'e é o ginásio que foi clicado', titulo);
  }

  secao('Voltar e navegar de novo');
  {
    await clicar('#gin-voltar');
    ok(await esperarPor('#gin-grade .gin-card', 15000), 'o botão voltar leva de novo à grade');
    await clicar('#gin-grade .gin-card.WATER');
    ok(await esperarPor('#gin-podio', 15000), 'e dá para abrir outro ginásio na sequência');
    const titulo = await js(`document.querySelector('.gin-topo-nome')?.textContent ?? ''`);
    ok(/WATER/.test(titulo), 'é o ginásio de WATER', titulo);
  }

  secao('Registrar time no ginásio');
  {
    await clicar('#gin-voltar');
    await esperarPor('#gin-grade .gin-card', 15000);
    await clicar('#gin-grade .gin-card.FIRE');
    await esperarPor('#gin-podio', 15000);

    ok(!(await js(`document.querySelector('#gin-editar')?.disabled`)), 'o botão de registrar está liberado no nível 150');
    await clicar('#gin-editar');
    await dormir(1200);
    // O editor tem de SOBREVIVER aos snapshots — foi aqui que ele era trocado pelo painel
    // por uma resposta atrasada do servidor.
    await dormir(5000);
    ok(await esperarPor('#gin-ed-lista .gin-ed-pk', 15000), 'o editor abre e CONTINUA aberto depois de vários snapshots');
    const candidatos = await js(`document.querySelectorAll('#gin-ed-lista .gin-ed-pk').length`);
    ok(candidatos >= 5, 'os cinco pokémon de fogo aparecem como candidatos', `${candidatos}`);

    // Escolhe dois e confere que a contagem do topo acompanha.
    await js(`document.querySelectorAll('#gin-ed-lista .gin-ed-pk')[0].click()`);
    await dormir(400);
    await js(`document.querySelectorAll('#gin-ed-lista .gin-ed-pk')[1].click()`);
    await dormir(400);
    const contagem = await js(`document.querySelector('.gin-contagem')?.textContent ?? ''`);
    ok(/2\s*\/\s*5/.test(contagem), 'a contagem mostra 2/5', contagem);
    const marcados = await js(`document.querySelectorAll('#gin-ed-lista .gin-ed-pk.on').length`);
    ok(marcados === 2, 'dois cards ficam marcados', `${marcados}`);

    await clicar('#gin-ed-salvar');
    // O pódio tem DUAS formas: os três degraus do topo e a lista do 4º em diante. Onde eu
    // caio depende de quantos jogadores já estão inscritos naquele ginásio — o teste não
    // pode presumir nenhuma das duas, então aceita as duas.
    ok(await esperarPor('.gin-degraus .gin-pod', 15000), 'salvar volta ao pódio com o time registrado');
    const euNoPodio = await js(
      `!!document.querySelector('#gin-podio .gin-pod.eu, #gin-podio .gin-linha.eu')`,
    );
    ok(euNoPodio, 'e eu apareço no pódio do ginásio (degrau ou lista)');
    const poder = await js(
      `document.querySelector('#gin-podio .gin-pod.eu .gin-pod-val, #gin-podio .gin-linha.eu .gin-poder')?.textContent ?? ''`,
    );
    ok(/\d/.test(poder), 'com a força do time calculada', poder);

    // Continua de pé depois de mais alguns snapshots — o mesmo cuidado do teste anterior.
    await dormir(5000);
    ok(await js(`!!document.querySelector('#gin-podio')`), 'e a tela não é arrancada depois de salvar');

    // O pódio novo: os três degraus, o troféu e o prêmio escrito no primeiro lugar.
    const degraus = await js(`document.querySelectorAll('.gin-degraus .gin-pod').length`);
    ok(degraus === 3, 'o pódio tem os três degraus (2º, 1º, 3º)', `${degraus}`);
    ok(
      await js(`!!document.querySelector('.gin-degraus .lugar-1 .gin-pod-trofeu')`),
      'com o troféu do Ranking em cada degrau',
    );
    const premio = await js(`document.querySelector('.gin-degraus .lugar-1 .gin-pod-premio')?.textContent ?? ''`);
    ok(/%/.test(premio), 'e o prêmio (+25%) escrito no degrau de cima', premio);
    ok(
      await js(`!!document.querySelector('.gin-degraus .lugar-1 .gin-pod-ava canvas')`),
      'o boneco do líder é desenhado no degrau',
    );
  }

  secao('Sem erro de JS');
  {
    const ruins = erros.filter((e) => !/turnstile|cloudflare|facebook|googletagmanager|gtm|ERR_BLOCKED|401|403/i.test(e));
    ok(ruins.length === 0, 'nenhuma exceção no cliente durante o fluxo', ruins.slice(0, 3).join(' | '));
  }
} finally {
  ws.close();
  proc.kill();
  // A conta de teste sai junto — rodar o teste vinte vezes não pode deixar vinte treinadores
  // fantasmas no banco, nem vinte times pendurados nos ginásios.
  await pool.query(`DELETE FROM ginasio_times WHERE player_id IN (SELECT id FROM players WHERE lower(nick) = lower($1))`, [NICK]).catch(() => {});
  await pool.query(`DELETE FROM accounts WHERE lower(nick) = lower($1)`, [NICK]).catch(() => {});
  await pool.query(`DELETE FROM players WHERE lower(nick) = lower($1)`, [NICK]).catch(() => {});
  await pool.end().catch(() => {});
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
