// Bancada do replay da Guerra de Guilds — vê a batalha sem subir o jogo.
//
// O player (`src/client/replay.mjs`) só precisa de duas coisas: a gravação e os assets. Nada
// de Postgres, Redis, login ou WebSocket. Esta bancada monta exatamente isso: simula uma
// guerra, serve os arquivos do cliente e abre o modal de replay sozinho numa página.
//
//   node tools/replay-demo.mjs                     abre e fica de pé (Ctrl+C para sair)
//   node tools/replay-demo.mjs --guilds 4 --membros 5 --nivel 90
//   node tools/replay-demo.mjs --banco             usa a ÚLTIMA guerra de verdade do Postgres
//   node tools/replay-demo.mjs --foto tela.png     tira uma foto e sai
//   node tools/replay-demo.mjs --foto t.png --em 20000   ...num instante da fita
//
// O MARKUP do modal não é reescrito aqui: ele é recortado do `index.html` de verdade em tempo
// de execução, e o CSS é o `estilo.css` do jogo. Assim a bancada não vira uma segunda versão
// da tela que envelhece sozinha — se o modal mudar lá, muda aqui.
//
// O que a bancada NÃO cobre: o caminho até o botão (o painel de PvP, o pedido ao servidor).
// Isso depende do jogo de pé; aqui a pergunta é só "a gravação vira batalha na tela?".

import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, extname, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { simularGuerra } from '../src/server/game/guild-pvp-sim.mjs';
import { especies, calcularStats, hpDeCombate, multDeNascenca, looktypeShiny } from '../src/server/content.mjs';

const raizJogo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dirCliente = join(raizJogo, 'src', 'client');
const dirShared = join(raizJogo, 'src', 'shared');
const dirAssets = resolve(raizJogo, '..', 'public', 'data');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

// ------------------------------------------------------------------ argumentos

const argv = process.argv.slice(2);
const opcao = (nome, padrao) => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : padrao;
};
const flag = (nome) => argv.includes(`--${nome}`);

const N_GUILDS = Number(opcao('guilds', 5));
const N_MEMBROS = Number(opcao('membros', 5));
const NIVEL = Number(opcao('nivel', 85));
const PORTA = Number(opcao('porta', 8123));
const FOTO = opcao('foto', null);
const FOTO_EM = Number(opcao('em', 0));

// ------------------------------------------------------------------ a gravação

/** Uma guerra inventada, com times variados para a briga não sair homogênea. */
function guerraDeMentira() {
  // Iniciais evoluídos + um par de tipos que se batem: dá vantagem elemental de verdade em
  // campo, que é o que faz o replay ter reviravolta em vez de todo mundo trocando ×1.
  const TIMES = [
    [6, 3, 9], [9, 6, 3], [3, 9, 6], [65, 68, 94], [94, 130, 149], [130, 149, 65], [149, 94, 68],
  ];
  const NOMES = ['Fasi Guild', 'Soul Eater', 'Team Rocket', 'Elite Four', 'Nightmare', 'Kanto Kings', 'Dragon Clan'];
  const BRASOES = [
    { escudo: 'heater', emblema: 'star', bg: '#4a2c6e', pri: '#ffd166', sec: '#ffffff' },
    { escudo: 'round', emblema: 'skull', bg: '#7a1f2b', pri: '#ff8a7a', sec: '#33202b' },
    { escudo: 'kite', emblema: 'bolt', bg: '#1f4a6e', pri: '#6fd3ff', sec: '#ffffff' },
    { escudo: 'heater', emblema: 'leaf', bg: '#1f5a34', pri: '#8affc1', sec: '#33202b' },
    { escudo: 'round', emblema: 'diamond', bg: '#5a3a1f', pri: '#ffb347', sec: '#ffffff' },
    { escudo: 'kite', emblema: 'heart', bg: '#6e1f5a', pri: '#d9a6ff', sec: '#ffffff' },
    { escudo: 'heater', emblema: 'star', bg: '#2b2b2b', pri: '#9fe0a0', sec: '#ffffff' },
  ];

  const pokemon = (speciesId, nivel, shiny) => {
    const esp = especies.get(speciesId);
    const ivs = { hp: 0, atk: 0, def: 0, spAtk: 0, spDef: 0, speed: 0 };
    for (const k of Object.keys(ivs)) ivs[k] = 14 + Math.floor(Math.random() * 19);
    const qualidade = 1 + Math.random() * 0.5;
    const stats = calcularStats(esp, ivs, nivel, qualidade, multDeNascenca(1, shiny));
    return {
      id: Math.floor(Math.random() * 1e9),
      speciesId,
      nome: esp.name,
      looktype: esp.looktype,
      lookShiny: shiny ? looktypeShiny(speciesId) : null,
      tipos: [esp.type1, esp.type2].filter(Boolean),
      level: nivel,
      shiny,
      stats,
      maxHp: hpDeCombate(stats.hp),
      tmElemental: null,
    };
  };

  return Array.from({ length: N_GUILDS }, (_, g) => ({
    id: g + 1,
    nome: NOMES[g % NOMES.length],
    brasao: BRASOES[g % BRASOES.length],
    membros: Array.from({ length: N_MEMBROS }, (_, m) => ({
      playerId: g * 100 + m,
      nick: `${NOMES[g % NOMES.length].split(' ')[0]}${m + 1}`,
      looktype: m % 2 ? 160 : 159,
      visual: [
        20 + ((g * 7 + m * 13) % 100),
        20 + ((g * 11 + m * 5) % 100),
        20 + ((g * 3 + m * 17) % 100),
        20 + ((g * 19 + m * 2) % 100),
      ],
      equipe: TIMES[(g + m) % TIMES.length].map((s, i) =>
        // Um shiny por guild, no primeiro membro: é o que deixa conferir de olho se a arte da
        // forma brilhante chega ao campo pelo `lt` do ator.
        pokemon(s, NIVEL + ((g * 3 + m) % 9) - 4, m === 0 && i === 0),
      ),
    })),
  }));
}

/** A última guerra de verdade, se o Postgres estiver de pé. */
async function guerraDoBanco() {
  const gdb = await import('../src/server/guild-db.mjs');
  const b = await gdb.replayDaBatalha();
  if (!b?.replay) throw new Error('o banco não tem nenhuma guerra gravada ainda');
  console.log(`[demo] replay real de ${b.dia} — ${b.replay.atores.length / 2} lutadores`);
  return b.replay;
}

// ------------------------------------------------------------------ a página

/** Recorta o `<div id="gwr">…</div>` do index.html de verdade. */
async function markupDoModal() {
  const html = await readFile(join(dirCliente, 'index.html'), 'utf8');
  const i = html.indexOf('<div id="gwr"');
  if (i < 0) throw new Error('o modal #gwr não está no index.html');
  // Conta as tags para achar o fecho certo — o bloco tem `div` aninhada até três níveis.
  let nivel = 0;
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = i;
  for (let m; (m = re.exec(html)); ) {
    nivel += m[0] === '</div>' ? -1 : 1;
    if (nivel === 0) return html.slice(i, m.index + m[0].length).replace(' hidden"', '"');
  }
  throw new Error('não achei o fecho do #gwr');
}

const paginaDemo = (modal) => `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bancada — replay da Guerra de Guilds</title>
<link rel="stylesheet" href="/estilo.css">
<style>
  /* A bancada não tem o app em volta: o modal precisa de um fundo e de espaço para respirar. */
  body { margin: 0; display: grid; place-items: center; min-height: 100vh; }
  #gwr { position: static; display: grid; place-items: center; padding: 18px; }
  .demo-nota {
    position: fixed; left: 10px; bottom: 10px; z-index: 50;
    font: 700 11px Tahoma, sans-serif; color: var(--sobre-mad-dim);
    background: var(--vao); padding: 6px 10px; border-radius: 6px;
    box-shadow: inset 0 0 0 2px var(--mad-linha);
  }
</style>
</head><body>
${modal}
<div class="demo-nota" id="demo-nota">bancada — carregando a gravação…</div>
<script type="module">
import { ReplayGuerra, VELOCIDADES } from '/replay.mjs';

const $ = (s) => document.querySelector(s);
const CORES = ['#ffd166', '#6fd3ff', '#8affc1', '#ff8a7a', '#d9a6ff', '#ffb347', '#9fe0a0'];
const cor = (i) => CORES[i % CORES.length];
const tempo = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s / 60 | 0 ? \`\${(s / 60) | 0}:\${String(s % 60).padStart(2, '0')}\` : \`0:\${String(s).padStart(2, '0')}\`;
};

const rep = await fetch('/replay.json').then((r) => r.json());
$('#gwr-titulo').textContent = 'Guerra de Guilds — bancada';
$('#gwr-carregando').textContent = 'carregando o mapa…';

// A MESMA ligação de controles do jogo (ver \`montarControlesReplay\` em app.js). Está repetida
// aqui de propósito: a bancada não pode depender do app.js, que abre socket e exige login.
const player = new ReplayGuerra($('#gwr-campo'), rep, { aoAtualizar: pintar });
window.player = player;

$('#gwr-vels').innerHTML = VELOCIDADES
  .map((v) => \`<button type="button" class="gwr-vel\${v === 1 ? ' on' : ''}" data-vel="\${v}">\${v}×</button>\`)
  .join('');
$('#gwr-vels').onclick = (ev) => {
  const b = ev.target.closest('.gwr-vel');
  if (!b) return;
  const v = player.velocidade(Number(b.dataset.vel));
  for (const c of $('#gwr-vels').querySelectorAll('.gwr-vel')) c.classList.toggle('on', Number(c.dataset.vel) === v);
};
$('#gwr-play').onclick = () => player.alternar();
$('#gwr-linha').oninput = (ev) => player.irPara((Number(ev.target.value) / 1000) * player.duracao);
$('#gwr-auto').textContent = 'Câmera automática';
$('#gwr-auto').onclick = () => {
  player.auto = !player.auto;
  $('#gwr-auto').classList.toggle('on', player.auto);
  if (player.auto) player.escolherFoco();
};
$('#gwr-lateral').innerHTML = player.lutadores()
  .map((l) => \`<button type="button" class="gwr-lutador" data-slot="\${l.slot}" style="--gw-cor:\${cor(l.guilda)}">
      <b>\${l.nick}</b><span>\${l.pokemon} Nv\${l.nivel}</span></button>\`)
  .join('');
$('#gwr-lateral').onclick = (ev) => {
  const b = ev.target.closest('.gwr-lutador');
  if (b) player.seguir(Number(b.dataset.slot), true);
};

let ultimo = '';
function pintar(s) {
  if (player.campo.mapa) $('#gwr-carregando').classList.add('hidden');
  const chave = \`\${(s.t / 500) | 0}|\${s.guilds.map((g) => g.vivos).join()}|\${s.feed.length}|\${s.foco}|\${s.tocando}\`;
  if (chave === ultimo) return;
  ultimo = chave;
  $('#gwr-tempo').textContent = \`\${tempo(s.t)} / \${tempo(s.dur)}\`;
  $('#gwr-linha').value = String(Math.round((s.t / s.dur) * 1000));
  $('#gwr-play').textContent = s.tocando ? '❚❚' : s.acabou ? '↺' : '▶';
  $('#gwr-guilds').innerHTML = s.guilds
    .map((g) => \`<div class="gwr-guild" style="--gw-cor:\${cor(g.idx)}">
        <span class="gwr-guild-nome">\${g.nome}</span><span class="gwr-guild-vivos">\${g.vivos}/\${g.total}</span></div>\`)
    .join('')
    + (s.guildsFora > 0 ? \`<div class="gwr-guild fora"><span class="gwr-guild-nome">+\${s.guildsFora} eliminadas</span></div>\` : '');
  $('#gwr-feed').innerHTML = s.feed
    .map((e) => {
      const linha = e.p
        ? \`<b>\${e.a}</b> ⚔ <em class="gwr-abate-pk">\${e.p}</em> <span>de \${e.v}</span>\`
        : \`<b>\${e.a}</b> ⚔ <span>\${e.v}</span>\`;
      return \`<div class="gwr-abate" style="--gw-cor:\${cor(e.g)}">\${linha}</div>\`;
    })
    .join('');
  for (const b of $('#gwr-lateral').querySelectorAll('.gwr-lutador')) {
    const slot = Number(b.dataset.slot);
    b.classList.toggle('on', slot === s.foco);
    b.classList.toggle('gwr-caido', !!player.estado.get(slot)?.fora);
  }
  $('#demo-nota').textContent =
    \`bancada · \${s.guilds.length} guilds · \${player.lutadores().length} lutadores · \${tempo(s.dur)} de fita\`;
}

await player.iniciar();
window.mapaPronto = true;
const busca = new URL(location).searchParams;
const em = Number(busca.get('em') ?? 0);
if (em > 0) player.irPara(em);
// "?pausar=1" congela no instante pedido — é o que a foto usa, para o quadro capturado ser
// sempre o mesmo e não depender de quanto o navegador demorou para acordar.
if (busca.get('pausar') !== '1') player.tocar();
</script>
</body></html>`;

// ------------------------------------------------------------------ o servidor

async function servir(replay, modal) {
  const html = paginaDemo(modal);
  const servidor = createServer(async (req, res) => {
    const caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (caminho === '/' || caminho === '/index.html') {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      return res.end(html);
    }
    if (caminho === '/replay.json') {
      res.writeHead(200, { 'content-type': MIME['.json'] });
      return res.end(JSON.stringify(replay));
    }
    // As mesmas três raízes do gateway — o cliente pede `/assets/*` e `/shared/*` por caminho
    // absoluto, então a bancada precisa responder pelos três.
    let base = dirCliente;
    let rel = caminho;
    if (caminho.startsWith('/assets/')) {
      base = dirAssets;
      rel = caminho.slice('/assets'.length);
    } else if (caminho.startsWith('/shared/')) {
      base = dirShared;
      rel = caminho.slice('/shared'.length);
    }
    const arquivo = join(base, normalize(rel));
    if (!arquivo.startsWith(base)) return res.writeHead(403).end('forbidden');
    try {
      if (!(await stat(arquivo)).isFile()) throw new Error('nao e arquivo');
    } catch {
      return res.writeHead(404).end('404');
    }
    res.writeHead(200, {
      'content-type': MIME[extname(arquivo).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(arquivo).pipe(res);
  });
  await new Promise((ok) => servidor.listen(PORTA, ok));
  return servidor;
}

// ------------------------------------------------------------------ a foto

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

/** Uma foto da bancada, pelo Chrome sem cabeça (o mesmo caminho do `tools/tela.mjs`). */
async function fotografar(saida, emMs) {
  const chrome = CHROMES.find((c) => existsSync(c));
  if (!chrome) throw new Error('Chrome/Edge não encontrado');
  const { default: WebSocket } = await import('ws');
  const perfil = await mkdtemp(join(tmpdir(), 'replay-demo-'));
  const portaCdp = 9500 + Math.floor(Math.random() * 400);
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${portaCdp}`, `--user-data-dir=${perfil}`,
    '--window-size=1360,940', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  let alvo = null;
  for (let i = 0; i < 60 && !alvo; i++) {
    try {
      alvo = (await fetch(`http://127.0.0.1:${portaCdp}/json/list`).then((r) => r.json()))
        .find((a) => a.type === 'page' && a.webSocketDebuggerUrl);
    } catch {}
    if (!alvo) await dormir(250);
  }
  if (!alvo) throw new Error('Chrome não abriu a porta de debug');

  const ws = new WebSocket(alvo.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((ok, err) => (ws.once('open', ok), ws.once('error', err)));
  let id = 0;
  const pend = new Map();
  const erros = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pend.has(m.id)) {
      const { ok, err } = pend.get(m.id);
      pend.delete(m.id);
      m.error ? err(new Error(m.error.message)) : ok(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      erros.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      erros.push(m.params.exceptionDetails.exception?.description ?? 'exceção');
    }
  });
  const cmd = (method, params = {}) =>
    new Promise((ok, err) => {
      const n = ++id;
      pend.set(n, { ok, err });
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  await cmd('Runtime.enable');
  await cmd('Page.enable');
  const url = `http://127.0.0.1:${PORTA}/${emMs > 0 ? `?em=${emMs}&pausar=1` : ''}`;
  await cmd('Page.navigate', { url });
  // O mapa de tiles são dezenas de páginas de atlas: espera o player avisar que terminou.
  for (let i = 0; i < 120; i++) {
    const r = await cmd('Runtime.evaluate', { expression: 'window.mapaPronto === true', returnByValue: true });
    if (r.result.value) break;
    await dormir(500);
  }
  // Mais um respiro para os outfits (cada boneco é um atlas colorizado em runtime).
  await dormir(3500);
  const estado = await cmd('Runtime.evaluate', {
    expression: 'JSON.stringify(window.player ? window.player.instantaneo() : null)',
    returnByValue: true,
  });
  const foto = await cmd('Page.captureScreenshot', { format: 'png' });
  await writeFile(saida, Buffer.from(foto.data, 'base64'));

  ws.close();
  proc.kill();
  await rm(perfil, { recursive: true, force: true }).catch(() => {});
  return { erros, estado: JSON.parse(estado.result.value ?? 'null') };
}

// ------------------------------------------------------------------ o roteiro

const replay = flag('banco')
  ? await guerraDoBanco()
  : await (async () => {
      const guilds = guerraDeMentira();
      const t0 = Date.now();
      const r = await simularGuerra(guilds, { aoRespirar: () => new Promise((ok) => setImmediate(ok)) });
      console.log(
        `[demo] guerra simulada: ${guilds.length} guilds · ${r.replay.atores.length / 2} lutadores · ` +
          `${(r.duracaoMs / 1000).toFixed(1)}s de fita (${r.motivo}) · ${r.replay.quadros.length} quadros · ` +
          `${(JSON.stringify(r.replay).length / 1024).toFixed(1)} KB · ${Date.now() - t0} ms de CPU`,
      );
      console.log(`[demo] pódio: ${r.placar.map((g) => `${g.pos}º ${g.nome} (${g.abates}⚔)`).join(' · ')}`);
      return r.replay;
    })();

const servidor = await servir(replay, await markupDoModal());

if (FOTO) {
  const { erros, estado } = await fotografar(FOTO, FOTO_EM);
  console.log(`[demo] foto em ${FOTO}`);
  if (estado) {
    console.log(`[demo] na hora da foto: ${(estado.t / 1000).toFixed(1)}s de ${(estado.dur / 1000).toFixed(1)}s · ` +
      `${estado.guilds.map((g) => `${g.nome} ${g.vivos}/${g.total}`).join(' · ')}`);
  }
  if (erros.length) {
    console.error(`[demo] ${erros.length} erro(s) no console do navegador:`);
    for (const e of erros.slice(0, 10)) console.error(`        ${e}`);
  } else {
    console.log('[demo] nenhum erro no console do navegador');
  }
  servidor.close();
  process.exit(erros.length ? 1 : 0);
} else {
  console.log(`\n  ▶  http://127.0.0.1:${PORTA}/    (Ctrl+C para sair)\n`);
}
