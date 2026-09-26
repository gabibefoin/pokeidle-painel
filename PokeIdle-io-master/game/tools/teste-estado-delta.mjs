// O estado em DELTA: a remontagem, e a tela de verdade em cima dela.
//
//   node tools/teste-estado-delta.mjs [url] [pokemonsNoDepot]
//
// O servidor deixou de mandar o quadro inteiro do jogador a cada meio segundo e passou a
// mandar só o que mudou (`estadoParaEnviar` em `sim.mjs`). A promessa dessa troca é forte e
// precisa ser provada, não argumentada:
//
//     a tela não pode notar.
//
// São duas metades, e um teste que olhasse só uma passaria com a outra quebrada — um teste de
// socket passa com a interface em pedaços; um teste de tela passa com o delta desligado. Por
// isso este arquivo tem as duas:
//
//   PARTE 1  o mesclador (`shared/estado-delta.mjs`) sozinho, sem servidor. É onde mora o
//            risco de verdade: ordem da coleção, campo ausente vs. campo apagado, quadro
//            completo no meio do caminho. Roda em milissegundos e não depende de nada.
//
//   PARTE 2  o cliente do jogo num Chrome de verdade, com o WebSocket da PÁGINA grampeado:
//            confirma que o que chegou foi delta (e não o quadro inteiro) ao mesmo tempo em
//            que confere que HUD, equipe, Depot, bolsa e os modais montaram.
//
// O DEPOT GRANDE não é enfeite: é o caso que criou o problema. Com 1 pokémon, delta e quadro
// inteiro custam quase o mesmo e um erro de remontagem passa despercebido.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { urlEntrada, sessaoPara, helloCom } from './auth-teste.mjs';
import { criarMescladorDeEstado } from '../src/shared/estado-delta.mjs';

const ORIGEM = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
const DEPOT = Number(process.argv[3] ?? 150);
const PG = process.env.PG_CONTAINER ?? 'game-postgres-1';
const NICK = process.env.NICK_DELTA ?? 'deltaui';
const HUNT = process.env.HUNT ?? 'pidgey';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const testes = [];
const checar = (nome, ok, detalhe = '') => {
  testes.push({ nome, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${nome}${detalhe ? `  — ${detalhe}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

console.log('ESTADO EM DELTA');
console.log('='.repeat(64));

// ════════════════════════════════════════════════ PARTE 1 — o mesclador, sozinho
secao('PARTE 1 · a remontagem (sem servidor)');

{
  const m = criarMescladorDeEstado();
  const cheio = m({
    cheio: true, nick: 'ash', gold: 100, level: 5, loja: { vip: false },
    pokemons: [{ id: 1, nome: 'A' }, { id: 2, nome: 'B' }, { id: 3, nome: 'C' }],
  });
  checar('o quadro completo entra inteiro', cheio.nick === 'ash' && cheio.gold === 100);
  checar('a coleção vira array na ordem recebida',
    cheio.pokemons.map((p) => p.id).join(',') === '1,2,3', cheio.pokemons.map((p) => p.id).join(','));
  checar('a marca `cheio` não vaza para a tela', !('cheio' in cheio));

  const d1 = m({ gold: 150 });
  checar('o delta muda só o campo que veio', d1.gold === 150 && d1.nick === 'ash' && d1.level === 5);
  checar('e a coleção sobrevive intacta', d1.pokemons.length === 3);

  const d2 = m({ pkMud: [{ id: 2, nome: 'B2' }] });
  checar('pkMud substitui o pokémon pelo id',
    d2.pokemons.find((p) => p.id === 2).nome === 'B2');
  checar('e NÃO muda a posição dele na lista',
    d2.pokemons.map((p) => p.id).join(',') === '1,2,3', d2.pokemons.map((p) => p.id).join(','));

  const d3 = m({ pkMud: [{ id: 9, nome: 'novo' }] });
  checar('um id novo entra no fim (é uma captura)',
    d3.pokemons.map((p) => p.id).join(',') === '1,2,3,9', d3.pokemons.map((p) => p.id).join(','));

  const d4 = m({ pkFora: [1] });
  checar('pkFora tira o pokémon (venda, anúncio, evolução)',
    d4.pokemons.map((p) => p.id).join(',') === '2,3,9', d4.pokemons.map((p) => p.id).join(','));

  const d5 = m({ loja: null });
  checar('`null` explícito apaga o campo', d5.loja === null);
  const d6 = m({ gold: 151 });
  checar('campo ausente continua sendo "não mudou"', d6.loja === null && d6.nick === 'ash');

  // A POKÉDEX vem pelo mesmo mecanismo da coleção: um abate mexe numa espécie só, e mandar o
  // mapa inteiro era 80% do delta depois que a coleção saiu do caminho.
  const dx0 = m({ cheio: true, nick: 'ash', pokedex: { 16: { k: 3, c: 1 }, 25: { k: 9, c: 0 } }, pokemons: [] });
  checar('a Pokédex entra inteira no quadro completo',
    dx0.pokedex[16].k === 3 && dx0.pokedex[25].k === 9);
  const dx1 = m({ dexMud: { 25: { k: 10, c: 0 } } });
  checar('dexMud mexe só na espécie que mudou',
    dx1.pokedex[25].k === 10 && dx1.pokedex[16].k === 3);
  const dx2 = m({ dexMud: { 133: { k: 1, c: 1 } } });
  checar('uma espécie nova entra na Pokédex',
    dx2.pokedex[133].c === 1 && Object.keys(dx2.pokedex).length === 3);
  const dx3 = m({ dexFora: ['16'] });
  checar('dexFora tira a espécie (limpeza de chave legada)',
    !('16' in dx3.pokedex) && Object.keys(dx3.pokedex).length === 2);
  const refAntes = dx3.pokedex;
  const dx4 = m({ dexMud: { 25: { k: 11, c: 0 } } });
  checar('cada patch cria um objeto NOVO (a tela compara por referência)',
    dx4.pokedex !== refAntes && refAntes[25].k === 10);

  const d7 = m({ cheio: true, nick: 'gary', gold: 7, pokemons: [{ id: 42, nome: 'Z' }] });
  checar('um quadro completo no meio do caminho RECOMEÇA tudo',
    d7.nick === 'gary' && d7.pokemons.length === 1 && d7.pokemons[0].id === 42);
  checar('e o que existia antes não sobra', d7.level === undefined && d7.loja === undefined);
}

{
  // A ordem é a invariante que um delta mal remontado quebraria em silêncio: o Depot e a
  // chave de cache da Shop dependem dela. Aqui as MESMAS operações são aplicadas ao `Map` do
  // servidor e ao mesclador do cliente, e no fim as duas listas têm de sair iguais.
  const servidor = new Map();
  const m = criarMescladorDeEstado();
  for (let i = 1; i <= 40; i++) servidor.set(i, { id: i, nome: `p${i}`, hp: 10 });
  let visto = m({ cheio: true, pokemons: [...servidor.values()] });

  const ops = [
    () => { servidor.get(7).hp = 5; return { pkMud: [{ ...servidor.get(7) }] }; },
    () => { servidor.delete(3); return { pkFora: [3] }; },
    () => { servidor.set(99, { id: 99, nome: 'novo', hp: 10 }); return { pkMud: [{ ...servidor.get(99) }] }; },
    () => { servidor.get(40).hp = 1; return { pkMud: [{ ...servidor.get(40) }] }; },
    () => { servidor.delete(1); servidor.delete(20); return { pkFora: [1, 20] }; },
    () => { servidor.set(7, { ...servidor.get(7), nome: 'evoluiu' }); return { pkMud: [{ ...servidor.get(7) }] }; },
    () => { servidor.set(100, { id: 100, nome: 'outro', hp: 9 }); return { pkMud: [{ ...servidor.get(100) }] }; },
  ];
  for (const op of ops) visto = m(op());

  const noServidor = [...servidor.values()].map((p) => p.id).join(',');
  const noCliente = visto.pokemons.map((p) => p.id).join(',');
  checar('a ordem do cliente acompanha a do servidor após 7 operações',
    noServidor === noCliente, noServidor === noCliente ? `${servidor.size} pokémon` : `srv=${noServidor}\n      cli=${noCliente}`);
  checar('e o conteúdo também',
    JSON.stringify([...servidor.values()]) === JSON.stringify(visto.pokemons));
}

// ════════════════════════════════════════ PARTE 2 — o cliente real, num navegador
const psql = (sql) =>
  execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'poke', '-d', 'pokeidle', '-t', '-A', '-c', sql])
    .toString()
    .trim();

const sessao = await sessaoPara(NICK);
let playerId = psql(`SELECT id FROM players WHERE lower(nick) = lower('${sessao.nick}')`);
if (!playerId) {
  // O primeiro login cria a linha do jogador e o starter. Um socket cru resolve, sem navegador.
  const w = new WebSocket(ORIGEM.replace(/^http/, 'ws'));
  await new Promise((ok) => w.once('open', ok));
  w.send(JSON.stringify(helloCom(sessao)));
  await new Promise((ok) => {
    const fim = setTimeout(ok, 12000);
    w.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t !== 'welcome') return;
      if (m.starters?.length) {
        w.send(JSON.stringify({ t: 'visual.set', genero: 'male', visual: {} }));
        w.send(JSON.stringify({ t: 'starter.pick', speciesId: m.starters[0].speciesId }));
        setTimeout(() => { clearTimeout(fim); ok(); }, 3000);
      } else { clearTimeout(fim); ok(); }
    });
  });
  w.close();
  await dormir(1500);
  playerId = psql(`SELECT id FROM players WHERE lower(nick) = lower('${sessao.nick}')`);
}
if (!playerId) throw new Error(`não consegui criar o jogador ${sessao.nick}`);

// ------------------------------------------------------------------ a semeadura
//
// O DEPOT e a CASA são escritos direto no Postgres, e por isso o teste precisa esperar antes
// de abrir o navegador. O sim é dono do estado em memória: enquanto o jogador estiver lá
// dentro, ele grava por cima do banco no flush (write-behind de 5 s) e uma linha inserida por
// fora simplesmente desaparece. E fechar o socket não basta — sair sem ser no PvP põe o
// jogador em CARÊNCIA por `GRACA_DESCONEXAO_MS` (90 s), congelado mas ainda em memória, para
// que um F5 seja transparente.
//
// Então: semeia, espera a carência vencer (aí `finalizarDesconexao` grava e solta), e só então
// o navegador entra — agora sim carregando do banco o que foi semeado.
psql(`INSERT INTO player_pokemon (player_id, species_id, level, xp, quality, ivs, hp, shiny, slot)
      SELECT ${playerId}, 1 + (g % 140), 5 + (g % 60), 0, 1.2,
             '{"hp":16,"atk":16,"def":16,"spAtk":16,"spDef":16,"speed":16}'::jsonb, 50, false, NULL
      FROM generate_series(1, GREATEST(0, ${DEPOT} - (
        SELECT count(*) FROM player_pokemon WHERE player_id = ${playerId} AND anuncio_id IS NULL
      ))) g`);
// A Casa Comum na bolsa: o botão "Casa" entra direto na sala e, sem casa, o clique vira um
// aviso e nada abre — e aí o XP Share, que é uma das telas que lê a coleção remontada, ficaria
// fora do teste. 70040 é `CASA_POR_RARIDADE.comum` (`game/itens-nossos.mjs`).
psql(`UPDATE players
         SET items = COALESCE(items, '{}'::jsonb) || '{"70040": 1}'::jsonb,
             gold = GREATEST(COALESCE(gold, 0), 50000),
             hunt_slug = NULL
       WHERE id = ${playerId}`);

process.stdout.write('esperando a carência de reconexão vencer (90 s) para o sim reler o banco');
for (let i = 0; i < 19; i++) { await dormir(5000); process.stdout.write('.'); }
console.log(' pronto');

const noDepotDb = Number(
  psql(`SELECT count(*) FROM player_pokemon WHERE player_id = ${playerId} AND slot IS NULL AND anuncio_id IS NULL`),
);
const totalDb = Number(
  psql(`SELECT count(*) FROM player_pokemon WHERE player_id = ${playerId} AND anuncio_id IS NULL`),
);

secao(`PARTE 2 · o cliente real (${sessao.nick} · ${totalDb} pokémon, ${noDepotDb} no Depot)`);

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'delta-'));
const porta = 9500 + Math.floor(Math.random() * 300);
const proc = spawn(
  chrome,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
   `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, '--window-size=1500,950', 'about:blank'],
  { stdio: 'ignore', windowsHide: true },
);

let pagina;
for (let i = 0; i < 60 && !pagina; i++) {
  try {
    const abas = await fetch(`http://127.0.0.1:${porta}/json/list`).then((r) => r.json());
    pagina = abas.find((a) => a.type === 'page' && a.webSocketDebuggerUrl);
  } catch {}
  if (!pagina) await dormir(250);
}
if (!pagina) throw new Error('Chrome não abriu a porta de debug');

const cdp = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((ok, err) => { cdp.once('open', ok); cdp.once('error', err); });

let id = 0;
const pendentes = new Map();
const errosConsole = [];
cdp.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pendentes.has(m.id)) { pendentes.get(m.id)(m.result); pendentes.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    errosConsole.push(m.params.exceptionDetails.text ?? JSON.stringify(m.params.exceptionDetails));
  }
});
const cmd = (method, params = {}) =>
  new Promise((ok) => { const meu = ++id; pendentes.set(meu, ok); cdp.send(JSON.stringify({ id: meu, method, params })); });
const js = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
};
async function esperarPor(seletor, ms = 30000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await js(`!!document.querySelector(${JSON.stringify(seletor)})`)) return true;
    await dormir(250);
  }
  return false;
}

await cmd('Runtime.enable');
await cmd('Page.enable');

// O GRAMPO NO SOCKET DA PÁGINA.
//
// Vai por `addScriptToEvaluateOnNewDocument` para entrar ANTES do `app.js`: o jogo abre a
// conexão durante a carga, e um patch aplicado depois pegaria a página no meio do caminho.
// Só observa — não toca no que chega.
await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__d = { cheios: 0, deltas: 0, semColecao: 0, maiorDelta: 0, maiorCheio: 0,
                   pkMud: 0, pkFora: 0, bytesEstado: 0, bytesTotal: 0 };
    const Orig = window.WebSocket;
    window.WebSocket = class extends Orig {
      constructor(...a) {
        super(...a);
        this.addEventListener('message', (ev) => {
          if (typeof ev.data !== 'string') return;
          const L = window.__d;
          L.bytesTotal += ev.data.length;
          let m; try { m = JSON.parse(ev.data); } catch { return; }
          const e = m.estado;
          if (m.t === 'welcome' && e) { L.cheios++; L.maiorCheio = Math.max(L.maiorCheio, ev.data.length); return; }
          if (m.t !== 'estado' || !e) return;
          L.bytesEstado += ev.data.length;
          if (e.cheio) { L.cheios++; L.maiorCheio = Math.max(L.maiorCheio, ev.data.length); return; }
          L.deltas++;
          L.maiorDelta = Math.max(L.maiorDelta, ev.data.length);
          if (!e.pokemons) L.semColecao++;
          if (e.pkMud) L.pkMud += e.pkMud.length;
          if (e.pkFora) L.pkFora += e.pkFora.length;
        });
      }
    };
  `,
});

const url = await urlEntrada(sessao.nick, ORIGEM);
await cmd('Page.navigate', { url });
if (!(await esperarPor('#ativo-card .ativo-nome', 60000))) {
  throw new Error('o jogo não abriu (o card do pokémon ativo não apareceu)');
}
await dormir(3000);

// ------------------------------------------------ a tela, montada do quadro completo
secao('A tela monta a partir do que chegou');
const H = JSON.parse((await js(`JSON.stringify({
  nick: document.getElementById('tr-nick')?.textContent?.trim(),
  gold: document.getElementById('tr-gold')?.textContent?.trim(),
  ativo: document.querySelector('#ativo-card .ativo-nome')?.textContent?.trim(),
  noCentro: !document.getElementById('centro-depot')?.classList.contains('hidden'),
})`)) ?? '{}');
checar('o nick aparece no HUD', H.nick === sessao.nick, `"${H.nick}"`);
checar('o ouro aparece no HUD', !!H.gold, `"${H.gold}"`);
checar('o pokémon ativo aparece', !!H.ativo, `"${H.ativo}"`);

// O DEPOT — a tela que existe por causa da coleção, e a que quebraria primeiro
await js(`document.getElementById('centro-depot')?.click()`);
const abriuDepot = await esperarPor('#centro-depot-modal:not(.hidden)', 10000);
checar('o Depot abre', abriuDepot);
await dormir(1500);
const D = JSON.parse((await js(`JSON.stringify({
  guardados: document.querySelectorAll('#depot-guardados .poke-linha').length,
  equipe: document.querySelectorAll('#depot-equipe .poke-linha').length,
  cnt: document.getElementById('depot-guardados-cnt')?.textContent?.trim(),
  timeCnt: document.getElementById('depot-time-cnt')?.textContent?.trim(),
})`)) ?? '{}');
checar('o Depot desenha as linhas', D.guardados > 0, `${D.guardados} linhas`);
checar('a equipe desenha as linhas', D.equipe > 0, `${D.equipe} na equipe`);
checar('a coleção da tela bate com o banco, pokémon a pokémon', D.guardados === noDepotDb,
    `tela=${D.guardados} banco=${noDepotDb}`);
await js(`document.getElementById('depot-fechar')?.click()`);
await dormir(600);

// AS TELAS DE JOGO. Todas leem `estado.eu` — se a remontagem estivesse errada, elas
// abririam vazias ou estourariam.
for (const [nome, alvo] of [
  ['o Mercado da Comunidade abre', 'market'],
  ['a Pokédex abre', 'pokedex'],
  ['a Loja abre', 'shop'],
  ['a bolsa abre', 'bolsa'],
]) {
  if (alvo === 'bolsa') await js(`document.getElementById('btn-bolsa')?.click()`);
  else await js(`document.querySelector('[data-modal="${alvo}"]')?.click()`);
  const abriu = await esperarPor(`#modal:not(.hidden) .modal-caixa[data-modal="${alvo}"]`, 10000);
  const temCorpo = abriu ? await js(`(document.getElementById('modal-corpo')?.innerHTML?.length ?? 0) > 200`) : false;
  checar(nome, abriu && temCorpo, abriu ? (temCorpo ? '' : 'abriu vazio') : 'não abriu');
  await js(`document.getElementById('modal')?.classList.add('hidden')`);
  await dormir(400);
}

// A CASA E O XP SHARE.
//
// O botão abre o modal das casas: as do jogador, cada uma com o número do servidor e os postos, e
// o registro do servidor. Vale a pena estar aqui porque o modal lê `estado.eu.casa.lista` — que
// viaja pelo delta como qualquer outro campo — e só repinta quando ela muda.
secao('A Casa e o XP Share');
await js(`document.querySelector('[data-modal="casa"]')?.click()`);
const abriuCasa = await esperarPor('#modal:not(.hidden) .modal-caixa[data-modal="casa"] .csm-painel', 10000);
checar('o botão Casa abre o modal das casas', abriuCasa);
await dormir(1500);
const C = JSON.parse((await js(`JSON.stringify({
  abas: document.querySelectorAll('.csm-aba').length,
  cards: document.querySelectorAll('.csm-card').length,
  vazio: !!document.querySelector('.csm-vazio'),
  contador: document.getElementById('csm-contador')?.textContent ?? '',
})`)) ?? '{}');
checar('o modal mostra as casas (ou o convite de quem não tem)', C.abas === 2 && (C.cards > 0 || C.vazio), JSON.stringify(C));
checar('o contador de casas do servidor chega', /\d/.test(C.contador), C.contador);
await js(`document.getElementById('modal')?.classList.add('hidden')`);
await dormir(400);

// ------------------------------------------------------- o delta em regime de caça
secao('Caçando: o estado passa a viajar em delta');
// A sessão já está no localStorage desde a primeira carga. Esta navegação vai SEM `?sessao=`
// de propósito: o cliente apaga a query inteira ao guardar a sessão, e com ela iria junto o
// `?hunt=`. É também o caminho real de quem já jogou e volta pelo atalho.
await cmd('Page.navigate', { url: `${ORIGEM}/app?hunt=${HUNT}&auto=1` });
if (!(await esperarPor('#ativo-card .ativo-nome', 60000))) throw new Error('não voltou para o jogo');
await dormir(28000); // tempo de caçar: dano, XP, ouro e loot mudando de verdade

const L = JSON.parse((await js(`JSON.stringify(window.__d)`)) ?? '{}');
// Com o intervalo padrão (5 min) o único quadro completo da sessão é o welcome. Rodando com
// `SINCRONIA_CHEIA_MS` curto — que é como a Parte 3 exercita o reenvio de segurança — vêm
// mais, e isso é o comportamento CERTO: a asserção acompanha o ambiente em vez de fingir que
// só existe um cenário.
const intervaloCfg = Number(process.env.SINCRONIA_CHEIA_MS) || 5 * 60_000;
const cheiosEsperados = intervaloCfg > 60_000 ? 1 : 1 + Math.ceil(31_000 / intervaloCfg);
checar('o quadro completo veio só quando devia',
  L.cheios >= 1 && L.cheios <= cheiosEsperados,
  `cheios=${L.cheios} (teto ${cheiosEsperados} para SINCRONIA_CHEIA_MS=${intervaloCfg})`);
checar('e o regime permanente é delta', L.deltas > 5, `${L.deltas} deltas`);
checar('nenhum delta carregou a coleção inteira', L.deltas > 0 && L.semColecao === L.deltas,
  `${L.semColecao}/${L.deltas}`);
checar('o delta manda os pokémon que mudaram, não todos', L.pkMud > 0 && L.pkMud < totalDb,
  `${L.pkMud} envios de pokémon em ${L.deltas} deltas · coleção tem ${totalDb}`);
checar('o maior delta é uma fração do quadro completo',
  L.maiorCheio > 0 && L.maiorDelta > 0 && L.maiorDelta < L.maiorCheio / 10,
  `delta ${L.maiorDelta} B · completo ${L.maiorCheio} B (${(L.maiorCheio / Math.max(1, L.maiorDelta)).toFixed(0)}×)`);

// E a tela continua viva no fim de tudo
const fim = JSON.parse((await js(`JSON.stringify({
  ativo: document.querySelector('#ativo-card .ativo-nome')?.textContent?.trim(),
  gold: document.getElementById('tr-gold')?.textContent?.trim(),
  barra: document.querySelector('#ativo-card .xp-fill, #ativo-card .barra-xp')?.style?.width ?? '',
})`)) ?? '{}');
checar('o HUD continua coerente depois de caçar', !!fim.ativo && !!fim.gold,
  `ativo="${fim.ativo}" ouro="${fim.gold}"`);

await js(`document.getElementById('centro-depot')?.click()`);
await dormir(800);
const relevantes = errosConsole.filter((e) => !/favicon|net::ERR|ERR_|Failed to load resource|manifest/i.test(e));
checar('nenhum erro de JavaScript no caminho', relevantes.length === 0, relevantes.slice(0, 2).join(' | '));

// ══════════════════════ PARTE 3 — os caminhos em que o delta se perderia
//
// Duas situações em que o servidor tem de ESQUECER o que acha que já mandou. Nas duas, o
// cliente do outro lado é novo (ou pode ser) e não tem base nenhuma sobre a qual aplicar um
// delta — mandar um aqui deixaria a tela pela metade, sem erro nenhum aparecendo.
secao('PARTE 3 · reconexão e reenvio de segurança');

/** Abre um socket cru e devolve os pacotes de estado já classificados. */
function sessaoCrua(sessao, aoAbrir) {
  const w = new WebSocket(ORIGEM.replace(/^http/, 'ws'));
  const reg = { cheios: [], deltas: [], mesclar: criarMescladorDeEstado(), ultimo: null, ws: w };
  // `delta: 1` como o cliente de verdade manda — sem isto o servidor trataria este socket
  // como um cliente antigo e mandaria só quadros completos (é o que a Parte 4 verifica).
  w.on('open', () => w.send(JSON.stringify({ ...helloCom(sessao), delta: 1 })));
  w.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') {
      reg.cheios.push(m.estado);
      reg.ultimo = reg.mesclar(m.estado);
      if (aoAbrir) aoAbrir(w);
      return;
    }
    if (m.t !== 'estado') return;
    (m.estado.cheio ? reg.cheios : reg.deltas).push(m.estado);
    reg.ultimo = reg.mesclar(m.estado);
  });
  return reg;
}

// ---- A RECONEXÃO (F5, aba nova, queda de Wi-Fi)
//
// Fora do PvP, quem cai fica 90 s em CARÊNCIA: continua na memória do sim, congelado, para
// que a volta seja transparente. É justamente aí que mora o risco — o jogador é o mesmo
// objeto, com o baseline do delta já preenchido, mas o NAVEGADOR do outro lado começou do
// zero. Sem `zerarBaselineDeTela` no welcome, ele receberia deltas sobre um quadro que não
// tem, e ficaria com um estado pela metade para sempre.
const a = sessaoCrua(sessao, (w) => w.send(JSON.stringify({ t: 'hunt.select', slug: HUNT })));
await dormir(9000);
checar('a 1ª sessão recebe o quadro completo e depois deltas',
  a.cheios.length === 1 && a.deltas.length > 0, `${a.cheios.length} cheio · ${a.deltas.length} deltas`);
const pkAntes = a.ultimo?.pokemons?.length ?? 0;
const ouroAntes = a.ultimo?.gold;
a.ws.close();
await dormir(2500); // bem DENTRO dos 90 s de carência: o sim ainda tem o jogador na memória

const b = sessaoCrua(sessao);
await dormir(7000);
checar('a reconexão dentro da carência recebe o quadro COMPLETO de novo',
  b.cheios.length >= 1, `${b.cheios.length} cheio(s)`);
const primeiro = b.cheios[0] ?? {};
checar('e esse quadro traz a coleção inteira, não um delta',
  Array.isArray(primeiro.pokemons) && primeiro.pokemons.length === pkAntes,
  `${primeiro.pokemons?.length ?? 0} de ${pkAntes} pokémon`);
checar('e traz os campos que um delta teria omitido',
  primeiro.nick != null && primeiro.gold != null && primeiro.loja != null && primeiro.casa != null);
checar('o estado remontado na volta bate com o de antes',
  (b.ultimo?.pokemons?.length ?? 0) === pkAntes && b.ultimo?.gold >= ouroAntes,
  `${b.ultimo?.pokemons?.length} pokémon · ouro ${ouroAntes} → ${b.ultimo?.gold}`);
b.ws.close();
await dormir(1500);

// ---- O REENVIO DE SEGURANÇA
//
// O delta parte de uma crença ("isto o cliente já tem") e uma crença errada não se conserta
// sozinha. Por isso o quadro completo volta de tempos em tempos mesmo sem necessidade. Só é
// testável porque o intervalo é regulável: rode com `SINCRONIA_CHEIA_MS=8000` para vê-lo
// acontecer em segundos em vez de cinco minutos — a variável tem de estar no SERVIDOR (o sim
// é quem decide quando reenviar), e aqui ela só liga a verificação.
const intervalo = Number(process.env.SINCRONIA_CHEIA_MS) || 0;
if (intervalo && intervalo <= 30000) {
  const c = sessaoCrua(sessao, (w) => w.send(JSON.stringify({ t: 'hunt.select', slug: HUNT })));
  await dormir(intervalo * 2.6);
  checar('o quadro completo volta sozinho no intervalo configurado',
    c.cheios.length >= 2, `${c.cheios.length} quadros completos em ${Math.round(intervalo * 2.6 / 1000)}s`);
  checar('e entre eles continuam vindo deltas',
    c.deltas.length > 0, `${c.deltas.length} deltas`);
  checar('a tela remontada continua íntegra depois do reenvio',
    (c.ultimo?.pokemons?.length ?? 0) === pkAntes && c.ultimo?.nick === sessao.nick,
    `${c.ultimo?.pokemons?.length} pokémon`);
  c.ws.close();
} else {
  console.log('  · reenvio periódico não exercitado (rode com SINCRONIA_CHEIA_MS=8000 para testá-lo)');
}
await dormir(1000);

// ═══════════════ PARTE 4 — o cliente velho que ainda não recarregou
//
// O caminho mais fácil de quebrar o jogo inteiro num deploy, e o menos óbvio: quando o
// servidor reinicia, o socket cai e o cliente **reconecta sem recarregar a página**. Quem
// estava jogando na hora continua com o `app.js` ANTIGO em memória — e o Cloudflare ainda
// guarda o arquivo por horas para quem entrar depois.
//
// Um servidor novo mandando delta para um cliente que espera o quadro inteiro faria
// `aplicarEstado` receber um objeto sem `pokemons` e estourar. Para TODO MUNDO que estivesse
// online, até apertar F5.
//
// Por isso o delta é negociado: o cliente anuncia `delta: 1` no `hello`, e quem não anuncia
// continua recebendo o que sempre recebeu. Este teste é o que impede alguém de "simplificar"
// isso um dia sem perceber o que está tirando.
secao('PARTE 4 · compatibilidade com o cliente antigo');

function medirCliente(extraNoHello) {
  return new Promise((ok) => {
    const w = new WebSocket(ORIGEM.replace(/^http/, 'ws'));
    const r = { cheios: 0, deltas: 0, comColecao: 0, bytes: 0 };
    w.on('open', () => w.send(JSON.stringify({ ...helloCom(sessao), ...extraNoHello })));
    w.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome') { w.send(JSON.stringify({ t: 'hunt.select', slug: HUNT })); return; }
      if (m.t !== 'estado') return;
      r.bytes += raw.length;
      if (m.estado.cheio) {
        r.cheios++;
        if (Array.isArray(m.estado.pokemons)) r.comColecao++;
      } else r.deltas++;
    });
    w.on('error', () => {});
    setTimeout(() => { try { w.close(); } catch {} ok(r); }, 13000);
  });
}

const velho = await medirCliente({});           // como o app.js de antes desta mudança
await dormir(1500);
const novo = await medirCliente({ delta: 1 });  // como o app.js de agora

checar('o cliente ANTIGO continua recebendo o quadro inteiro',
  velho.cheios > 0 && velho.deltas === 0,
  `${velho.cheios} completos · ${velho.deltas} deltas`);
checar('e cada um deles traz a coleção, como ele espera',
  velho.comColecao === velho.cheios, `${velho.comColecao}/${velho.cheios}`);
// O cliente novo recebe delta. Quantos quadros completos ele vê depende do reenvio de
// segurança (5 min por padrão, segundos quando a Parte 3 o exercita), então o que se afirma
// é a RELAÇÃO — ele vê menos quadros completos que o antigo — e não um número absoluto.
checar('o cliente NOVO recebe delta',
  novo.deltas > 0 && novo.cheios < velho.cheios,
  `${novo.cheios} completos · ${novo.deltas} deltas (antigo: ${velho.cheios} completos)`);
checar('e paga uma fração da banda pelo mesmo jogo',
  novo.bytes > 0 && velho.bytes > novo.bytes * 3,
  `antigo ${(velho.bytes / 1024).toFixed(0)} kB · novo ${(novo.bytes / 1024).toFixed(1)} kB · ` +
  `${Math.round(velho.bytes / Math.max(1, novo.bytes))}×`);
await dormir(1000);

// ---------------------------------------------------------------------- resumo
console.log(`\n${'='.repeat(64)}`);
if (L.deltas > 0) {
  console.log(`estado: ${L.cheios} completo + ${L.deltas} deltas · ${(L.bytesEstado / 1024).toFixed(1)} kB`);
  console.log(`média por delta: ${Math.round(L.bytesEstado / L.deltas)} B` +
    `  ·  quadro completo: ${L.maiorCheio} B`);
}
const falhas = testes.filter((t) => !t.ok);
console.log(falhas.length ? `\n${falhas.length} de ${testes.length} FALHARAM` : `\n${testes.length} testes passaram`);

cdp.close();
proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(falhas.length ? 1 : 0);
