// A OFERENDA no NAVEGADOR, logada, com o jogo rodando de verdade.
//
// `teste-oferenda.mjs` prova a matemática da roleta e as travas do servidor sem infra nenhuma.
// O que ele NÃO pode provar é o que só existe quando a tela e o socket estão no meio:
//
//   · a roleta desenhada bate com a que o servidor sorteia — as duas chamam `montarRoleta`, mas
//     só aqui se vê a prévia virar o mesmo círculo que a agulha percorre;
//   · a pedra entra na bolsa e os cinco pokémon somem da coleção, no mesmo pacote;
//   · a trava da tela solta sozinha depois do giro (um botão que ficasse morto exigiria F5);
//   · **e o socket recusa o que a tela nunca manda.** Este teste forja `oferenda.girar` na mão —
//     o mesmo id repetido, o id do pokémon que está lutando, o id de outra conta — porque é
//     exatamente isso que um cliente adulterado faz, e nenhum teste sem navegador chega lá.
//
// Precisa do servidor de pé (a conta nasce direto no banco, então o captcha não entra):
//
//   npm start
//   node tools/teste-oferenda-ui.mjs

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { sessaoDe, fecharBanco } from './sessao-local.mjs';
import { pool } from '../src/server/db.mjs';
import { especies, xpTotalParaNivel } from '../src/server/content.mjs';
import { PEDRA_POR_TIPO } from '../src/shared/pedras-evolucao.mjs';
import { OFERENDA_CASAS } from '../src/shared/oferenda.mjs';
import { XP_SHARE_HELD_ID } from '../src/shared/xp-share-held.mjs';

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const NICK = `ofr${Date.now().toString(36).slice(-6)}`;
const OUTRO = `${NICK}b`;
const IVS = { hp: 24, atk: 24, def: 24, spAtk: 24, spDef: 24, speed: 24 };
/** A roleta cheia: 2 Charmander (FIRE), 1 Bulbasaur (GRASS/POISON), 2 Gengar (GHOST/POISON). */
const CARGA = [['Charmander', 2], ['Bulbasaur', 1], ['Gengar', 2]];
/** Sobras que NÃO entram na roleta: é nelas que o giro forjado bate, depois do giro de verdade. */
const RESERVA = [['Rattata', 2]];
/** Um SHINY (que o Auto Lock vai trancar) para provar a fatia de Shiny Stone — e que trancado entra. */
const SHINY = [['Dratini', 1]];
/** O Shiny Gengar que vai para o Mercado: anunciado, ele não pode ficar na Oferenda. */
const ANUNCIADO = [['Gengar', 1]];
/** Um do depot SEGURANDO Exp. Share: ele não pode nem aparecer na folha. */
const COM_SHARE = [['Squirtle', 1]];
/** O que vai pela OFERENDA RÁPIDA — um só, que é o que basta para provar que a roda não gira. */
const RAPIDA = [['Charmander', 1]];
/** Linhas de `player_pokemon` que cada conta nasce tendo: todas as listas acima, mais o ativo. */
const POKEMON_POR_CONTA = 1 + [CARGA, RESERVA, SHINY, ANUNCIADO, COM_SHARE, RAPIDA]
  .flat().reduce((s, [, qtd]) => s + qtd, 0);
const PRINT = process.env.PRINT || '';
/**
 * De onde o navegador abre o jogo. `JOGO_URL` existe porque a porta 8080 é disputada: o Burp
 * Suite escuta nela por padrão e, quando ele está aberto, fica com `127.0.0.1:8080` enquanto o
 * jogo fica só em `[::1]:8080`. O teste então "conecta" no proxy e falha inteiro, com cara de
 * regressão. `JOGO_URL=http://[::1]:8080` contorna sem mexer em nada.
 */
const BASE = process.env.JOGO_URL || 'http://localhost:8080';
/** `PREMIO=arquivo.png` guarda também a tela de "você recebeu", que é o quadro do prêmio. */
const PREMIO = process.env.PREMIO || '';
/** `FOLHA=arquivo.png` guarda a folha de escolha, com a nota de quem ficou de fora. */
const FOLHA = process.env.FOLHA || '';

const perfil = await mkdtemp(join(tmpdir(), 'ofrui-'));
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

async function esperarPor(seletor, ms = 20000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await js(`!!document.querySelector(${JSON.stringify(seletor)})`)) return true;
    await dormir(250);
  }
  return false;
}

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

const clicar = (seletor) => js(`(() => {
  const el = document.querySelector(${JSON.stringify(seletor)});
  if (!el) return false;
  el.click();
  return true;
})()`);

/**
 * Poe na roleta os pokemon pedidos, PELO ID, passando pela folha de escolha.
 *
 * A folha nao fecha ao escolher (e o ponto do desenho: as casas todas numa sentada), entao um "+" so
 * abre e os cliques seguintes acontecem todos dentro dela. Devolve quantos de fato entraram.
 */
async function porNaRoleta(ids) {
  await abrirSeletorOferenda();
  return js(`(() => {
    let n = 0;
    for (const id of ${JSON.stringify(ids)}) {
      const el = document.querySelector('.ofrpk .mk-card[data-id="' + id + '"]:not(.ofrpk-bloqueado)');
      if (!el) continue;
      el.click();
      n++;
    }
    return n;
  })()`);
}

/** Abre a folha de escolha pelo primeiro "+" livre, se ela ainda nao estiver aberta. */
async function abrirSeletorOferenda() {
  if (await js(`!!document.querySelector('.ofrpk')`)) return true;
  await clicar('.ofr-casa-vazia');
  return esperarPor('.ofrpk .cm-pk-escolha-grade', 8000);
}

/** Fecha a folha de escolha, se houver uma aberta. */
async function fecharSeletorOferenda() {
  await js(`document.querySelector('.cm-folha .cm-fechar')?.click()`);
  await dormir(300);
}

/** Tira TODAS as casas cheias, clicando o x de cada uma. */
const esvaziarRoleta = () => js(`(() => {
  for (const b of document.querySelectorAll('.ofr-casa-tirar')) b.click();
  return document.querySelectorAll('.ofr-casa-cheia').length;
})()`);

/**
 * A PONTE com o socket do jogo — é ela que deixa este teste forjar um pacote.
 *
 * Instalada antes de qualquer script da página, ela guarda a conexão que o cliente abrir e os
 * avisos que voltarem. Sem isso não há como mandar `oferenda.girar` com uma lista que a tela se
 * recusa a montar — e é justamente essa lista que a validação do servidor existe para barrar.
 */
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

/** Manda um pacote CRU pelo socket do jogo e devolve o próximo aviso que chegar. */
async function forjar(pacote, ms = 3500) {
  await js(`(() => { window.__avisos = []; window.__wsJogo.send(${JSON.stringify(JSON.stringify(pacote))}); })()`);
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    const avisos = await js(`window.__avisos ?? []`);
    if (avisos.length) return avisos[0];
    await dormir(200);
  }
  return '';
}

const especiePorNome = (nome) =>
  [...especies.values()].find((e) => e.name.toLowerCase() === nome.toLowerCase());

/** A conta nasce pronta: nível alto, sem onboarding, sem pop-up, e com o depot carregado. */
async function criarConta(nick, { carga = true } = {}) {
  // A linha de `accounts` é o que `sessaoDe` assina. Vai direto no banco, e não pela rota
  // `/auth/criar`, porque aquela passa pelo Turnstile — que é justamente o que derruba as
  // ferramentas quando o captcha está ligado no `.env`.
  await pool.query(
    `INSERT INTO accounts (nick, email, provedor, email_ok) VALUES ($1, $2, 'local', true)`,
    [nick, `${nick}@test.local`],
  );
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, xp, gold, visual_ok, tutorial_visto, discord_pop_campanha, aviso_visto)
     VALUES ($1, 150, $2, 10000000, true, true, 99, 99) RETURNING id`,
    [nick, xpTotalParaNivel(150)],
  );
  const playerId = Number(rows[0].id);

  // O ATIVO fica na equipe (slot 1). Ele é o que prova a trava do "não dá para oferendar quem
  // está lutando" — e sem um pokémon ativo o jogador nem entra direito.
  const ativo = especiePorNome('Pikachu');
  const { rows: pk } = await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, quality, ivs, hp, shiny, potencia, slot)
     VALUES ($1, $2, 100, 1.2, $3::jsonb, 9999, false, 3, 1) RETURNING id`,
    [playerId, ativo.pokeId, JSON.stringify(IVS)],
  );
  const ativoId = Number(pk[0].id);
  await pool.query(`UPDATE players SET active_poke = $2 WHERE id = $1`, [playerId, ativoId]);

  const porDepot = async (lista, destino, { shiny = false } = {}) => {
    for (const [nome, qtd] of lista) {
      const esp = especiePorNome(nome);
      for (let i = 0; i < qtd; i++) {
        const { rows: novo } = await pool.query(
          `INSERT INTO player_pokemon (player_id, species_id, level, quality, ivs, hp, shiny, potencia, slot)
           VALUES ($1, $2, 20, 1, $3::jsonb, 500, $4, 1, NULL) RETURNING id`,
          [playerId, esp.pokeId, JSON.stringify(IVS), shiny],
        );
        destino.push(Number(novo[0].id));
      }
    }
  };
  const depot = [];
  const reserva = [];
  const shiny = [];
  const anunciado = [];
  const comShare = [];
  const rapida = [];
  if (carga) {
    await porDepot(CARGA, depot);
    await porDepot(RESERVA, reserva);
    await porDepot(RAPIDA, rapida);
    await porDepot(SHINY, shiny, { shiny: true });
    await porDepot(ANUNCIADO, anunciado, { shiny: true });
    await porDepot(COM_SHARE, comShare);
    await pool.query(`UPDATE player_pokemon SET held_item_id = $1 WHERE id = ANY($2::bigint[])`, [XP_SHARE_HELD_ID, comShare]);
    // O direito ao item: sem ele, a conferência do login marcaria a unidade como suspeita.
    await pool.query(`UPDATE players SET xp_share_total = 1 WHERE id = $1`, [playerId]);
    // `autoLockShiny` fica LIGADO (o padrão do jogo), e é de propósito: ele tranca todo shiny no
    // primeiro login, e a oferenda tem de aceitar o trancado mesmo assim — o cadeado é do
    // Mercado NPC. Este teste só prova alguma coisa com ele ligado.
  }
  return { playerId, ativoId, depot, reserva, shiny, anunciado, comShare, rapida };
}

/**
 * Espião da roda: marca `window.__girou` se QUALQUER `<g>` da roleta ganhar a classe `girando`
 * (a transição de 4 s). É o que separa o giro normal da Oferenda Rápida — o tempo sozinho não
 * prova nada, porque uma roda girada em 0 s também "terminaria rápido".
 */
const espiarGiro = () => js(`(() => {
  window.__girou = false;
  window.__espiaoGiro?.disconnect();
  window.__espiaoGiro = new MutationObserver(() => {
    if (document.querySelector('.ofr-roda-gira.girando')) window.__girou = true;
  });
  window.__espiaoGiro.observe(document.getElementById('ofr-roda-caixa'), {
    subtree: true, childList: true, attributes: true, attributeFilter: ['class'],
  });
})()`);

const apagarConta = async (nick) => {
  await pool.query(
    `DELETE FROM player_pokemon WHERE player_id IN (SELECT id FROM players WHERE lower(nick) = lower($1))`,
    [nick],
  ).catch(() => {});
  await pool.query(`DELETE FROM accounts WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
  await pool.query(`DELETE FROM players WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
};

try {
  console.log(`OFERENDA no navegador (conta ${NICK})\n=====================================`);
  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: PONTE_WS });

  const eu = await criarConta(NICK);
  const outro = await criarConta(OUTRO);
  const sessao = await sessaoDe(NICK);
  await cmd('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))}); } catch (_) {}`,
  });
  await cmd('Page.navigate', { url: `${BASE}/app` });

  secao('A aba abre');
  ok(await esperarJogoPronto(), 'o jogo conectou');
  await js(`document.getElementById('discord-popup-fechar')?.click()`);
  await dormir(300);
  ok(await clicar('#btn-bolsa'), 'a bolsa abre');
  await dormir(700);
  ok(await clicar('.bolsa-aba[data-aba="oferenda"]'), 'a aba Oferenda existe na bolsa');
  ok(await esperarPor('#ofr-casas', 8000), 'a oficina desenha');
  ok(await js(`document.querySelectorAll('.ofr-casa').length === ${OFERENDA_CASAS}`), 'a roleta nasce com cinco casas');
  ok(
    await js(`document.querySelectorAll('.ofr-casa-vazia .ofr-casa-mais').length === ${OFERENDA_CASAS}`),
    'e as cinco nascem como botao de "+"',
  );
  ok(await js(`document.getElementById('ofr-girar')?.disabled === true`), 'e o botão nasce desabilitado');
  ok(await js(`document.getElementById('ofr-rapida')?.disabled === true`), 'e a Oferenda Rápida também');

  secao('A folha de escolha: so o DEPOT, e o cadeado so informa');
  {
    ok(await abrirSeletorOferenda(), 'o "+" abre a folha de escolha');
    // A conta tem POKEMON_POR_CONTA pokemon: 1 na equipe (o ativo) e o resto no depot, um deles
    // segurando Exp. Share. A folha lista so os que podem entrar — o da equipe e o do Exp. Share
    // ficam fora.
    const podem = POKEMON_POR_CONTA - 2;
    const total = await js(`document.querySelectorAll('.ofrpk .mk-card').length`);
    ok(total === podem, `os ${podem} do DEPOT que podem entrar estao na folha`, `veio ${total}`);
    ok(
      await js(`!document.querySelector('.ofrpk .mk-card[data-id="${eu.comShare[0]}"]')`),
      'o que segura Exp. Share NAO aparece na folha',
    );
    const nota = await js(`document.querySelector('.ofrpk .ofrpk-ocultos')?.textContent ?? ''`);
    ok(/1/.test(nota) && /Exp\. Share/.test(nota), 'e a folha avisa que ele ficou de fora', nota);
    if (FOLHA) {
      const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
      await writeFile(FOLHA, Buffer.from(data, 'base64'));
      console.log(`    print: ${FOLHA}`);
    }
    ok(
      await js(`!document.querySelector('.ofrpk .mk-card[data-id="${eu.ativoId}"]')`),
      'e o da equipe nao aparece',
    );
    const bloqueados = await js(`document.querySelectorAll('.ofrpk .ofrpk-bloqueado').length`);
    ok(bloqueados === 0, 'nada fica apagado: o que sobrou e tudo escolhivel', `veio ${bloqueados}`);
    // Os selos P/IV/Q/N no card sao o motivo desta folha existir: e por eles que se decide.
    ok(
      await js(`!!document.querySelector('.ofrpk .mk-card .pk-selos .pk-selo')`),
      'os cards trazem a fileira P/IV/Q/N',
    );
    ok(
      await js(`!!document.querySelector('.ofrpk #ofrpk-busca') && !!document.querySelector('.ofrpk .dmpk-filtros select')`),
      'e a folha tem busca e filtros',
    );
    // A COLEÇÃO (o antigo cadeado) informa, mas não barra: o shiny nasce nela pelo Auto Coleção
    // e mesmo assim tem de estar escolhível — com a ★ no card.
    const shinyId = eu.shiny[0];
    ok(
      await js(`!!document.querySelector('.ofrpk .mk-card[data-id="${shinyId}"] .pk-colecao-marca')`),
      'o da Coleção mostra a ★',
    );
    ok(
      await js(`!document.querySelector('.ofrpk .mk-card[data-id="${shinyId}"]')?.classList.contains('ofrpk-bloqueado')`),
      'e NÃO está bloqueado por causa dele',
    );
  }

  secao('Carregar as cinco casas');
  {
    // Os cinco POR ID — 2 Charmander, 1 Bulbasaur, 2 Gengar. Clicar "os cinco primeiros" da
    // lista montaria outra roleta e a conferência abaixo deixaria de valer.
    const postos = await porNaRoleta(eu.depot);
    ok(postos === 5, 'cinco cliques entram nas casas', `veio ${postos}`);
    await dormir(400);
    // A folha NAO fecha ao escolher: e o que permite encher as cinco numa sentada.
    ok(await js(`!!document.querySelector('.ofrpk')`), 'a folha continua aberta depois de escolher');
    ok(
      await js(`document.querySelectorAll('.ofrpk .ofrpk-ordem').length === 5`),
      'e cada card escolhido mostra o numero da casa',
    );
    await fecharSeletorOferenda();
    ok(await js(`document.querySelectorAll('.ofr-casa-cheia').length === 5`), 'as cinco casas ficam cheias');
    const selos = await js(`JSON.stringify([...document.querySelectorAll('.ofr-casa-cheia')].map((c) => c.querySelectorAll('.ofr-casa-selos .pk-selo, .ofr-casa-selos .cm-pot').length))`);
    ok(
      JSON.parse(selos).every((n) => n >= 4),
      'e cada casa mostra os quatro selos (P/IV/Q/N)',
      selos,
    );
    ok(
      await js(`!!document.querySelector('.ofr-casa-cheia .ofr-casa-nome')?.textContent`),
      'com o nome do pokemon',
    );
    ok(
      await js(`document.querySelectorAll('.ofr-casa-cheia .ofr-casa-tirar').length === 5`),
      'e o x para tirar da casa',
    );

    const chance = await js(`document.getElementById('ofr-chance').textContent`);
    ok(/5.*5/.test(chance) && /100%/.test(chance), 'a chance anuncia 100%', chance);

    // A roleta com a casa dividida entre os tipos: cada pokémon vale 20%, então os dois
    // Charmander (tipo único) levam 40%, e o Bulbasaur e os Gengar põem 10% em cada uma das
    // duas pedras deles — o que faz a Venom Stone somar (1 + 2) × 10% = 30%.
    const legenda = await js(`JSON.stringify([...document.querySelectorAll('.ofr-leg')].map((l) => ({
      nome: l.querySelector('.ofr-leg-nome')?.textContent?.trim() ?? '',
      pct: Number((l.querySelector('.ofr-leg-pct')?.textContent ?? '').replace('%', '')),
    })))`);
    const fatias = Object.fromEntries(JSON.parse(legenda).map((f) => [f.nome, f.pct]));
    ok(Object.keys(fatias).length === 4, 'quatro fatias na legenda', legenda);
    ok(fatias[PEDRA_POR_TIPO.FIRE] === 40, `${PEDRA_POR_TIPO.FIRE} em 40% (2 × 20%)`, legenda);
    ok(fatias[PEDRA_POR_TIPO.POISON] === 30, `${PEDRA_POR_TIPO.POISON} em 30% (Bulbasaur + Gengar, 10% cada)`, legenda);
    ok(fatias[PEDRA_POR_TIPO.GHOST] === 20, `${PEDRA_POR_TIPO.GHOST} em 20% (2 × 10%)`, legenda);
    ok(fatias[PEDRA_POR_TIPO.GRASS] === 10, `${PEDRA_POR_TIPO.GRASS} em 10% (1 × 10%)`, legenda);

    const setores = await js(`document.querySelectorAll('.ofr-roda-gira path').length`);
    ok(setores === 4, 'a roda desenha quatro setores', `veio ${setores}`);
    ok(await js(`!!document.querySelector('.ofr-agulha')`), 'e a agulha está lá');
    ok(
      await js(`document.getElementById('ofr-girar')?.disabled === false`),
      'o botão acendeu com a roleta cheia',
    );
    if (PRINT) {
      const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
      await writeFile(PRINT, Buffer.from(data, 'base64'));
      console.log(`    print: ${PRINT}`);
    }
  }

  secao('O giro: a pedra entra, os cinco somem');
  {
    const { rows: pkAntes } = await pool.query(
      `SELECT count(*)::int AS n FROM player_pokemon WHERE player_id = $1`, [eu.playerId],
    );

    await espiarGiro();
    ok(await clicar('#ofr-girar'), 'o botão Oferendar responde');
    await dormir(500);
    ok(
      await js(`document.getElementById('confirmar')?.classList.contains('hidden') === false`),
      'a confirmação ABRE antes de gastar (e não só existe no HTML)',
    );
    const texto = await js(`document.getElementById('confirmar-texto')?.textContent ?? ''`);
    ok(/100%/.test(texto) && /\b5\b/.test(texto), 'e ela diz quantos vão e a chance', texto.slice(0, 90));

    await clicar('#confirmar-sim');
    await dormir(600);
    ok(
      await js(`document.getElementById('ofr-girar')?.disabled === true`),
      'o botão trava enquanto gira (clique duplo não gasta duas)',
    );

    // A roda gira por 4 s; a revelação abre depois.
    ok(await esperarPor('#recompensa:not(.hidden)', 12000), 'a tela de recompensa abre no fim do giro');
    ok(await js(`window.__girou === true`), 'e a roda GIROU até lá (a animação de 4 s)');
    const premio = await js(`document.getElementById('rc-nome')?.textContent ?? ''`);
    ok(/stone/i.test(premio), 'e o prêmio é uma pedra (roleta cheia = 100%)', premio);
    ok(
      [PEDRA_POR_TIPO.FIRE, PEDRA_POR_TIPO.POISON, PEDRA_POR_TIPO.GHOST, PEDRA_POR_TIPO.GRASS]
        .some((n) => premio.toLowerCase().includes(n.toLowerCase())),
      'e é uma das quatro que a roleta desenhou',
      premio,
    );

    if (PREMIO) {
      const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
      await writeFile(PREMIO, Buffer.from(data, 'base64'));
      console.log(`    print: ${PREMIO}`);
    }
    await clicar('#rc-ok');
    await dormir(1200);
    ok(await js(`document.getElementById('ofr-girar')?.disabled === true`), 'o botão volta desabilitado…');
    ok(await js(`document.querySelectorAll('.ofr-casa-cheia').length === 0`), '…porque as casas voltaram vazias');

    const { rows: pkDepois } = await pool.query(
      `SELECT count(*)::int AS n FROM player_pokemon WHERE player_id = $1`, [eu.playerId],
    );
    ok(
      pkDepois[0].n === pkAntes[0].n - 5,
      'os cinco oferecidos sumiram da coleção',
      `${pkAntes[0].n} → ${pkDepois[0].n}`,
    );

    // A bolsa é write-behind (5 s em lote), então a pedra demora a chegar ao banco.
    let bolsa = {};
    for (let i = 0; i < 12; i++) {
      const { rows } = await pool.query(`SELECT items FROM players WHERE id = $1`, [eu.playerId]);
      bolsa = typeof rows[0].items === 'string' ? JSON.parse(rows[0].items) : (rows[0].items ?? {});
      if (Object.keys(bolsa).length) break;
      await dormir(1000);
    }
    const pedras = Object.values(bolsa).reduce((s, v) => s + Number(v || 0), 0);
    ok(pedras === 1, 'e UMA pedra entrou na bolsa — nunca duas', JSON.stringify(bolsa));
  }

  secao('A auditoria guarda o sorteio');
  {
    const { rows } = await pool.query(
      `SELECT acao, detalhe FROM player_gameplay_log
        WHERE player_id = $1 AND categoria = 'oferenda' ORDER BY id DESC LIMIT 1`,
      [eu.playerId],
    ).catch(() => ({ rows: [] }));
    ok(rows.length === 1, 'a oferenda deixou linha na auditoria');
    ok(rows[0]?.acao === 'pedra', 'marcada como pedra', rows[0]?.acao ?? '');
    ok(/→ #\d+/.test(rows[0]?.detalhe ?? ''), 'com a fatia sorteada', (rows[0]?.detalhe ?? '').slice(0, 130));
    ok(/\/\d+$/.test((rows[0]?.detalhe ?? '').split(' → ')[0] ?? ''), 'e com os pesos da roleta', (rows[0]?.detalhe ?? '').slice(0, 130));
  }

  secao('O SHINY pinta Shiny Stone, e não a pedra comum');
  {
    // Esvazia a roleta e põe só o Shiny Dratini: DRAGON, então Dragon Shiny Stone e mais nada.
    await esvaziarRoleta();
    await dormir(350);
    const posto = await porNaRoleta(eu.shiny);
    await fecharSeletorOferenda();
    ok(posto === 1, 'o Shiny Dratini entra na roleta MESMO TRANCADO pelo Auto Lock', `veio ${posto}`);
    await dormir(350);

    const legenda = await js(`JSON.stringify([...document.querySelectorAll('.ofr-leg')].map((l) => ({
      nome: l.querySelector('.ofr-leg-nome')?.textContent?.trim() ?? '',
      shiny: !!l.querySelector('.ofr-leg-cor-shiny'),
    })))`);
    const fatias = JSON.parse(legenda);
    const pedra = fatias.find((f) => !/^Nada|^Nothing|^Nada$/.test(f.nome) && f.nome);
    // O nome na tela é o TRADUZIDO (`pedra.nome` = "Shiny Stone {tipo}"), e não o do catálogo em
    // inglês — é o mesmo rótulo que a bolsa e o Mercado já usam para as dezoito.
    ok(
      fatias.some((f) => /shiny stone/i.test(f.nome) && /dragon/i.test(f.nome)),
      'a legenda mostra a Shiny Stone de DRAGON',
      legenda,
    );
    ok(
      !fatias.some((f) => new RegExp(`${PEDRA_POR_TIPO.DRAGON}$`).test(f.nome)),
      `e NÃO mostra a ${PEDRA_POR_TIPO.DRAGON} comum`,
      legenda,
    );
    ok(pedra?.shiny === true, 'a fatia vem marcada como shiny na legenda', legenda);
    ok(
      await js(`!!document.querySelector('.ofr-fatia-shiny') || !!document.querySelector('circle.ofr-fatia-shiny')`),
      'e a fatia ganha o contorno de ouro na roda',
    );
    ok(
      await js(`!!document.querySelector('.ofr-casa-shiny')`),
      'a casa com o shiny dentro fica marcada',
    );
    // A quina de cima e uma FILEIRA: o shiny trancado tem de mostrar as DUAS marcas mais o x,
    // sem nenhum por cima do outro. Era o bug dos dois `::after` no mesmo elemento.
    const quina = await js(`(() => {
      const c = document.querySelector('.ofr-casa-shiny .ofr-casa-quina');
      if (!c) return null;
      const marcas = [...c.querySelectorAll('.ofr-casa-marca')].map((m) => m.textContent);
      const caixas = [...c.children].map((el) => Math.round(el.getBoundingClientRect().left));
      return { marcas, caixas, temX: !!c.querySelector('.ofr-casa-tirar') };
    })()`);
    ok(quina?.marcas?.length === 2, 'shiny trancado mostra as duas marcas', JSON.stringify(quina));
    ok(quina?.temX, 'e o x continua lá', JSON.stringify(quina));
    ok(
      quina && quina.caixas.every((x, i) => i === 0 || x > quina.caixas[i - 1]),
      'e os tres ficam lado a lado, sem sobrepor',
      JSON.stringify(quina?.caixas),
    );

    // O diálogo avisa, com todas as letras, que tem shiny ali.
    await clicar('#ofr-girar');
    await dormir(400);
    const aviso = await js(`document.querySelector('.ofr-aviso-shiny')?.textContent ?? ''`);
    ok(/shiny/i.test(aviso), 'a confirmação avisa que há shiny na roleta', aviso || '(sem aviso)');
    await clicar('#confirmar-nao');
    await dormir(300);
    ok(
      await js(`document.querySelectorAll('.ofr-casa-cheia').length === 1`),
      'e cancelar não queima o shiny',
    );
    await esvaziarRoleta();
    await dormir(300);
  }

  secao('O Shiny Gengar anunciado no Mercado sai da Oferenda');
  {
    // Ele entra numa casa ANTES de ir para a vitrine, junto com o Shiny Dratini — é o caminho
    // de quem monta a roleta, vai ao Mercado, anuncia e volta.
    const [gengar] = eu.anunciado;
    const postos = await porNaRoleta([...eu.shiny, gengar]);
    await fecharSeletorOferenda();
    ok(postos === 2, 'Shiny Dratini e Shiny Gengar entram nas casas', `veio ${postos}`);
    ok(await js(`document.querySelectorAll('.ofr-casa-cheia').length === 2`), 'duas casas cheias');

    // O anúncio sai pelo mesmo pacote que a tela do Mercado manda.
    await js(`(() => { window.__wsJogo.send(JSON.stringify({ t: 'market.criar', tipo: 'pokemon', pokemonId: ${gengar}, preco: 900000, moeda: 'gold', dias: 1 })); })()`);
    let anunciado = false;
    for (let i = 0; i < 20 && !anunciado; i++) {
      await dormir(300);
      const { rows } = await pool.query(`SELECT anuncio_id FROM player_pokemon WHERE id = $1`, [gengar]);
      anunciado = rows[0]?.anuncio_id != null;
    }
    ok(anunciado, 'o Shiny Gengar foi para a vitrine');
    await dormir(800);
    ok(
      await js(`document.querySelectorAll('.ofr-casa-cheia').length === 1`),
      'a casa dele esvazia sozinha — sobra só o Dratini',
    );
    const chance = await js(`document.getElementById('ofr-chance').textContent`);
    ok(/1\D+5/.test(chance) && /20%/.test(chance), 'e a chance cai para 1 de 5 (20%)', chance);
    ok(await abrirSeletorOferenda(), 'a folha de escolha abre');
    ok(
      await js(`!document.querySelector('.ofrpk .mk-card[data-id="${gengar}"]')`),
      'e o Shiny Gengar anunciado NÃO aparece nela',
    );
    await fecharSeletorOferenda();

    // O giro manda SÓ o que a roda mostra. Antes, o id do anunciado ia junto e o servidor
    // recusava a oferenda inteira.
    await js(`(() => {
      window.__enviados = [];
      const enviar = window.__wsJogo.send.bind(window.__wsJogo);
      window.__wsJogo.send = (dado) => { window.__enviados.push(String(dado)); return enviar(dado); };
    })()`);
    await clicar('#ofr-girar');
    await dormir(400);
    await clicar('#confirmar-sim');
    ok(await esperarPor('#recompensa:not(.hidden)', 12000), 'o giro com o Dratini acontece');
    const pedido = await js(`window.__enviados.map((d) => JSON.parse(d)).find((m) => m.t === 'oferenda.girar') ?? null`);
    ok(
      JSON.stringify(pedido?.pokemonIds) === JSON.stringify(eu.shiny),
      'e o pacote levou só o Dratini — o anunciado ficou de fora',
      JSON.stringify(pedido?.pokemonIds),
    );
    await clicar('#rc-ok');
    await dormir(800);
    const { rows: gRow } = await pool.query(`SELECT anuncio_id FROM player_pokemon WHERE id = $1`, [gengar]);
    ok(gRow[0]?.anuncio_id != null, 'o Shiny Gengar segue inteiro, no anúncio');
  }

  secao('A Oferenda Rápida: o mesmo sorteio, sem a roda girar');
  {
    const postos = await porNaRoleta(eu.rapida);
    await fecharSeletorOferenda();
    ok(postos === 1, 'o Charmander entra na roleta', `veio ${postos}`);
    await dormir(300);
    ok(await js(`document.getElementById('ofr-rapida')?.disabled === false`), 'a Oferenda Rápida acende junto com o Oferendar');

    await espiarGiro();
    ok(await clicar('#ofr-rapida'), 'o botão Oferenda Rápida responde');
    await dormir(400);
    // Pular a animação não pode pular a confirmação: o pokémon some do mesmo jeito.
    ok(
      await js(`document.getElementById('confirmar')?.classList.contains('hidden') === false`),
      'a MESMA confirmação abre antes de gastar',
    );
    await clicar('#confirmar-sim');
    const t0 = Date.now();
    const abriu = await esperarPor('#recompensa:not(.hidden)', 6000);
    const ms = Date.now() - t0;
    ok(abriu, 'o resultado aparece');
    // O giro normal leva 4 s de transição. 2 s de teto cobre ida e volta do socket e o pintar da
    // tela com folga, e ainda fica longe dos 4 s — se a roda voltasse a girar, isto pegaria.
    ok(ms < 2000, 'e aparece sem esperar os 4 s da roda', `${ms} ms`);
    ok(await js(`window.__girou === false`), 'e a roda NÃO girou');
    await clicar('#rc-ok');
    await dormir(800);
    ok(await js(`document.querySelectorAll('.ofr-casa-cheia').length === 0`), 'as casas voltam vazias');
    ok(
      await js(`document.getElementById('ofr-girar')?.disabled === true && document.getElementById('ofr-rapida')?.disabled === true`),
      'e os dois botões voltam desabilitados',
    );
    const { rows: rap } = await pool.query(`SELECT count(*)::int AS n FROM player_pokemon WHERE id = ANY($1::bigint[])`, [eu.rapida]);
    ok(rap[0].n === 0, 'o Charmander oferecido sumiu da coleção');
    const { rows: log } = await pool.query(
      `SELECT count(*)::int AS n FROM player_gameplay_log WHERE player_id = $1 AND categoria = 'oferenda'`,
      [eu.playerId],
    ).catch(() => ({ rows: [{ n: -1 }] }));
    ok(log[0].n === 3, 'e o sorteio dela entrou na auditoria como qualquer outro', `${log[0].n} linhas`);
  }

  secao('O socket recusa o que a tela nunca manda');
  {
    // Daqui para baixo os pacotes vão CRUS pelo socket — é o que um cliente adulterado faz.
    // Sobram duas reservas no depot, que é o que o giro de id repetido precisa para existir.
    const reserva = eu.reserva[0];

    // 1. O mesmo id dez vezes — a fraude que daria 100% de uma pedra ao preço de um pokémon.
    //    Não é RECUSADA: é deduplicada, e a roleta que volta vale 20%. Provado pelo número.
    await js(`(() => {
      window.__oferenda = null;
      window.__wsJogo.addEventListener('message', (ev) => {
        try {
          for (const e of (JSON.parse(ev.data).ev ?? [])) if (e.k === 'oferenda') window.__oferenda = e;
        } catch (_) {}
      });
    })()`);
    await js(`(() => { window.__oferenda = null; window.__wsJogo.send(${JSON.stringify(JSON.stringify({
      t: 'oferenda.girar', pokemonIds: null,
    }))}); })()`);
    await dormir(200);
    await js(`(() => { window.__wsJogo.send(JSON.stringify({ t: 'oferenda.girar', pokemonIds: Array.from({ length: 10 }, () => ${reserva}) })); })()`);
    await dormir(2500);
    const roleta = await js(`window.__oferenda`);
    ok(!!roleta, 'o giro com id repetido é aceito…');
    ok(roleta?.oferecidos === 1, '…mas como UM pokémon só', `veio ${roleta?.oferecidos}`);
    const pesoVazio = (roleta?.fatias ?? []).filter((f) => f.vazio).reduce((s, f) => s + f.peso, 0);
    ok(
      roleta && pesoVazio * 5 === roleta.total * 4,
      'e 80% do círculo é a fatia vazia',
      `${pesoVazio}/${roleta?.total}`,
    );
    // E a fatia de pedra do bicho solto vale exatamente uma casa: 20% do círculo.
    const pesoPedra = (roleta?.fatias ?? []).filter((f) => !f.vazio).reduce((s, f) => s + f.peso, 0);
    ok(
      roleta && pesoPedra * 5 === roleta.total,
      'e a pedra dele vale a casa inteira (20%)',
      `${pesoPedra}/${roleta?.total}`,
    );

    // 2. O pokémon que está lutando.
    const avisoAtivo = await forjar({ t: 'oferenda.girar', pokemonIds: [eu.ativoId] });
    ok(avisoAtivo === 'oferenda.erroAtivo', 'o ativo é recusado', avisoAtivo || '(sem aviso)');

    // 3. O pokémon de OUTRA conta — a checagem de posse, que é o coração da validação.
    const avisoAlheio = await forjar({ t: 'oferenda.girar', pokemonIds: [outro.depot[0]] });
    ok(avisoAlheio === 'oferenda.erroNaoTem', 'o pokémon de outra conta é recusado', avisoAlheio || '(sem aviso)');

    // 4. Lixo no lugar dos ids.
    const avisoLixo = await forjar({ t: 'oferenda.girar', pokemonIds: [0, -3, 1.5, null, 'x', {}, []] });
    ok(avisoLixo === 'oferenda.erroVazia', 'lista de lixo não vira oferenda', avisoLixo || '(sem aviso)');

    // 5. O último pokémon da conta não sai: sobrou a reserva e o ativo.
    const avisoUltimo = await forjar({ t: 'oferenda.girar', pokemonIds: [eu.reserva[1], eu.ativoId] });
    ok(
      avisoUltimo === 'oferenda.erroUltimo' || avisoUltimo === 'oferenda.erroAtivo',
      'esvaziar a conta é recusado',
      avisoUltimo || '(sem aviso)',
    );

    // 6. A coleção da outra conta continua intacta — nenhuma das recusas apagou nada.
    const { rows: vivos } = await pool.query(
      `SELECT count(*)::int AS n FROM player_pokemon WHERE player_id = $1`, [outro.playerId],
    );
    ok(vivos[0].n === POKEMON_POR_CONTA, 'e a coleção da outra conta ficou intacta', `${vivos[0].n} de ${POKEMON_POR_CONTA} linhas`);
  }

  secao('Sem erro de JS');
  {
    const ruins = erros.filter((e) => !/turnstile|cloudflare|facebook|googletagmanager|gtm|ERR_BLOCKED|401|403/i.test(e));
    ok(ruins.length === 0, 'nenhuma exceção no cliente durante o fluxo', ruins.slice(0, 3).join(' | '));
  }
} finally {
  ws.close();
  proc.kill();
  await apagarConta(NICK);
  await apagarConta(OUTRO);
  await fecharBanco().catch(() => {});
  await pool.end().catch(() => {});
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
