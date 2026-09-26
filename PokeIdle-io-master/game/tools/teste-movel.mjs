// A montagem de CELULAR, num navegador de verdade em modo de aparelho.
//
//   RESEND_API_KEY= npm start        (noutro terminal)
//   node tools/teste-movel.mjs
//
// O `RESEND_API_KEY=` vazio é a mesma exigência de todos os testes que abrem conta pelo
// `auth-teste.mjs`: com o Resend ligado o servidor pede confirmação de e-mail e a conta de
// teste nunca chega a entrar.
//
// O que este teste protege, e por que cada item está aqui:
//
//   · a montagem LIGA sozinha num aparelho de toque e DESLIGA num monitor — é a única coisa
//     que separa os dois layouts, e errar isso troca a tela de todo mundo;
//   · os painéis MUDAM DE LUGAR, não são copiados. Se um dia alguém duplicar o HTML, os ids
//     ficam repetidos e o `app.js` passa a escrever no nó errado — a checagem de "um id, um
//     nó" pega isso na hora;
//   · a página não rola. Rolagem horizontal ou vertical no `body` quer dizer que alguma peça
//     estourou a janela, que é o defeito clássico de layout de celular;
//   · nada de campo com fonte menor que 16 px: abaixo disso o Safari dá zoom sozinho ao focar
//     e não desfaz — o jogo fica torto até recarregar;
//   · desligar o layout no interruptor das Configurações devolve a tela de computador
//     INTEIRA, com os painéis de volta nas colunas de onde saíram.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import WebSocket from 'ws';
import { sessaoDe, fecharBanco } from './sessao-local.mjs';

const URL_BASE = process.argv[2] ?? 'http://localhost:8080';
const LARG = 390;
const ALT = 844;

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) throw new Error('Chrome/Edge não encontrado');

const perfil = await mkdtemp(join(tmpdir(), 'movel-'));
const porta = 9500 + Math.floor(Math.random() * 200);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`,
  '--window-size=900,900', 'about:blank',
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
if (!pagina) throw new Error('Chrome não abriu a porta de debug');

const ws = new WebSocket(pagina.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((ok, err) => { ws.once('open', ok); ws.once('error', err); });
let id = 0;
const pend = new Map();
const errosConsole = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errosConsole.push(m.params.exceptionDetails.text);
});
const cmd = (metodo, params = {}) => new Promise((ok) => {
  const meu = ++id; pend.set(meu, ok);
  ws.send(JSON.stringify({ id: meu, method: metodo, params }));
});
const js = async (expr) =>
  (await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

const testes = [];
const checar = (nome, ok, detalhe = '') => {
  testes.push({ nome, ok });
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

async function esperarPor(seletor, ms = 25000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await js(`!!document.querySelector(${JSON.stringify(seletor)})`)) return true;
    await dormir(250);
  }
  return false;
}

/** Liga o modo aparelho: viewport de telefone, toque de verdade e user-agent de iPhone. */
async function virarCelular(ligado) {
  if (!ligado) {
    await cmd('Emulation.clearDeviceMetricsOverride');
    await cmd('Emulation.setTouchEmulationEnabled', { enabled: false });
    return;
  }
  await cmd('Emulation.setDeviceMetricsOverride', {
    width: LARG, height: ALT, deviceScaleFactor: 3, mobile: true,
    screenWidth: LARG, screenHeight: ALT,
  });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cmd('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
}

await cmd('Runtime.enable');
await cmd('Page.enable');
await virarCelular(true);

// A sessão vem do assinador LOCAL, não da rota de cadastro: desde que a validação de domínio
// entrou (v1.27.0), o `nick@test.local` que o `auth-teste.mjs` monta bate em
// `login.emailDominio` e nenhuma suíte de navegador sobe. Aqui a conta já existe no banco.
//
// `NICK=<nome>` escolhe outra; o padrão é a primeira conta local com progresso, que é o que
// exercita as telas de verdade (depot cheio, equipe montada, saldo).
const nick = process.env.NICK || 'Italos';
const sessao = await sessaoDe(nick).finally(fecharBanco);
await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('sessao', ${JSON.stringify(JSON.stringify(sessao))}); } catch (_) {}`,
});
await cmd('Page.navigate', { url: `${URL_BASE}/app?starter=4` });

const entrou = await esperarPor('#app:not(.hidden) .m-nav');
checar('a montagem de celular liga sozinha num aparelho de toque', entrou);
if (!entrou) {
  console.log('\n(sem a barra de abas não há o que testar)');
  process.exit(1);
}
await js(`document.getElementById('discord-popup-fechar')?.click()`);
await dormir(400);

// ---- 1. os painéis MUDARAM DE LUGAR, e continuam únicos ----
const idsUnicos = await js(`(() => {
  const ids = ['tr-nick','tr-gold','time','itens','chat-msgs','p-treinador','p-ativo','p-equipe','p-bolsa','p-auto','p-chat'];
  const repetidos = ids.filter((i) => document.querySelectorAll('#' + i).length !== 1);
  return JSON.stringify(repetidos);
})()`);
checar('cada painel existe UMA vez só (foi movido, não copiado)', idsUnicos === '[]', idsUnicos);

const dentroDaGaveta = await js(`(() => {
  const p = (id, aba) => !!document.querySelector('.m-pane[data-aba="' + aba + '"] #' + id);
  return JSON.stringify({
    equipe: p('p-equipe', 'equipe'),
    // A Bolsa virou modal: o botão dela viaja junto com os painéis de time (e some por CSS).
    bolsa: p('p-bolsa', 'equipe'),
    auto: p('p-auto', 'auto'),
    chat: p('p-chat', 'chat'),
    menu: !!document.querySelector('.m-pane[data-aba="menu"] .menu-topo'),
  });
})()`);
const gav = JSON.parse(dentroDaGaveta);
checar('cada painel foi para a gaveta certa', Object.values(gav).every(Boolean), dentroDaGaveta);

// ---- 2. a página NÃO rola ----
const rolagem = await js(`JSON.stringify({
  x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
})`);
const r = JSON.parse(rolagem);
checar('a janela não rola (nada estourou a tela)', r.x <= 1 && r.y <= 1, rolagem);

// ---- 3. a gaveta abre, troca de aba e fecha ----
await js(`document.querySelector('.m-nav button[data-aba="equipe"]').click()`);
await dormir(400);
const abriu = await js(`document.getElementById('m-gaveta').classList.contains('aberta')
  && document.querySelector('.m-pane[data-aba="equipe"]').classList.contains('on')`);
checar('tocar numa aba abre a gaveta naquele painel', !!abriu);

const palcoComGaveta = await js(`document.getElementById('palco').getBoundingClientRect().height`);
await js(`document.querySelector('.m-nav button[data-aba="equipe"]').click()`);
await dormir(400);
const fechou = await js(`!document.getElementById('m-gaveta').classList.contains('aberta')`);
checar('tocar na mesma aba fecha a gaveta', !!fechou);

// ---- 3b. a fileira de ações da cena ----
//
// Tudo o que se faz de dentro da batalha (trocar de área, pop-up, corda, ir ao Centro,
// desistir) mora numa LINHA só, no alto do palco. Se ela quebrar, o jogador reencontra o
// amontoado de botões em quatro cantos que essa faixa veio resolver.
const faixa = await js(`(() => {
  const barra = document.getElementById('m-cena-topo');
  if (!barra) return JSON.stringify({ erro: 'sem faixa' });
  const r = barra.getBoundingClientRect();
  return JSON.stringify({
    hunt: !!barra.querySelector('#hud-hunt'),
    saida: !!barra.querySelector('#hunt-saida'),
    umaLinha: r.height <= 40,
    naCena: !!document.querySelector('#palco #m-cena-topo'),
    zoomNoCanto: !!document.querySelector('.hud-zoom-par #cena-zoom-mais'),
  });
})()`);
const fx = JSON.parse(faixa);
checar(
  'a fileira da cena tem hunt + saídas, numa linha só',
  fx.hunt && fx.saida && fx.umaLinha && fx.naCena && fx.zoomNoCanto,
  faixa,
);

// ---- 3c. CAPTURAR: o botão C abre e guarda a janelinha dos corpos no chão ----
//
// O painel dos caídos não fica mais aberto o tempo todo (era uma fita que rolava de lado e
// comia a base da cena). Duas coisas têm de valer: o botão C só existe quando há corpo no
// chão, e a lista rola PARA BAIXO, como no computador.
const captura = await js(`(() => {
  const bt = document.getElementById('cena-captura');
  const caidos = document.getElementById('caidos');
  if (!bt || !caidos) return JSON.stringify({ erro: 'sem botão C ou sem painel' });
  const vazio = caidos.classList.contains('hidden');
  // Com o painel escondido pelo app.js, o botão também tem de estar fora da tela.
  const escondidoJunto = vazio ? bt.hidden : true;
  caidos.classList.remove('hidden');
  bt.hidden = false;
  const fechadoAntes = getComputedStyle(caidos).display === 'none';
  bt.click();
  const abriu = getComputedStyle(caidos).display !== 'none';
  const col = getComputedStyle(document.getElementById('caidos-lista'));
  const r = caidos.getBoundingClientRect();
  bt.click();
  const guardou = getComputedStyle(caidos).display === 'none';
  if (vazio) { caidos.classList.add('hidden'); bt.hidden = true; }
  return JSON.stringify({
    escondidoJunto, fechadoAntes, abriu, guardou,
    coluna: col.flexDirection === 'column',
    rolaPraBaixo: col.overflowY === 'auto' && col.overflowX === 'hidden',
    estreito: r.width <= 210,
  });
})()`);
const cap = JSON.parse(captura);
checar(
  'o botão C abre e guarda a janelinha de Capturar',
  cap.escondidoJunto && cap.fechadoAntes && cap.abriu && cap.guardou,
  captura,
);
checar(
  'a lista de Capturar rola para baixo, numa caixa estreita',
  cap.coluna && cap.rolaPraBaixo && cap.estreito,
  captura,
);
await dormir(300);

const palcoSemGaveta = await js(`document.getElementById('palco').getBoundingClientRect().height`);
checar(
  'a cena cresce quando a gaveta fecha',
  palcoSemGaveta > palcoComGaveta + 40,
  `${Math.round(palcoComGaveta)}px → ${Math.round(palcoSemGaveta)}px`,
);

// ---- 4. o canvas acompanha a moldura ----
const canvasBate = await js(`(() => {
  const c = document.getElementById('cena');
  const r = c.getBoundingClientRect();
  return Math.abs(c.width - Math.round(r.width)) <= 2 && Math.abs(c.height - Math.round(r.height)) <= 2;
})()`);
checar('o canvas da batalha acompanha o tamanho do palco', !!canvasBate);

// ---- 5. campos de texto com 16 px (o zoom automático do Safari) ----
const pequenos = await js(`(() => {
  const maus = [];
  for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=range]), select, textarea')) {
    if (!el.offsetParent && el.type !== 'hidden') continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) maus.push((el.id || el.className || el.tagName) + ':' + fs);
  }
  return JSON.stringify(maus.slice(0, 6));
})()`);
checar('nenhum campo abaixo de 16px (o Safari daria zoom sozinho)', pequenos === '[]', pequenos);

// ---- 6. alvos de toque ----
const alvos = await js(`(() => {
  const maus = [];
  for (const b of document.querySelectorAll('.m-nav button, .m-topo button, .m-topo [role=button]')) {
    const r = b.getBoundingClientRect();
    if (r.height < 40 || r.width < 40) maus.push((b.dataset.aba || b.id || b.className) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return JSON.stringify(maus);
})()`);
checar('barra de abas e cabeçalho com alvos de 40px+', alvos === '[]', alvos);

// ---- 6b. janela curta (o que o teclado virtual faz) ----
//
// Com o teclado aberto a janela cai para menos da metade. Não dá para emular o teclado, mas
// dá para emular a janela que ele deixa — e é aí que se vê se a barra de abas e a linha de
// digitar continuam ACIMA da dobra, ou se afundaram atrás dele.
await js(`document.querySelector('.m-nav button[data-aba="chat"]').click()`);
await dormir(400);
await cmd('Emulation.setDeviceMetricsOverride', {
  width: LARG, height: 460, deviceScaleFactor: 3, mobile: true,
  screenWidth: LARG, screenHeight: ALT,
});
await dormir(600);
const comTeclado = await js(`(() => {
  const alt = window.visualViewport ? window.visualViewport.height : innerHeight;
  const nav = document.getElementById('m-nav').getBoundingClientRect();
  const campo = document.getElementById('chat-input').getBoundingClientRect();
  return JSON.stringify({
    alt: Math.round(alt),
    navDentro: nav.bottom <= alt + 1 && nav.top >= 0,
    campoDentro: campo.bottom <= alt + 1 && campo.top >= 0,
    campoVisivel: campo.height > 20,
  });
})()`);
const k = JSON.parse(comTeclado);
checar(
  'janela curta (teclado aberto): abas e campo do chat continuam na tela',
  k.navDentro && k.campoDentro && k.campoVisivel,
  comTeclado,
);
await cmd('Emulation.setDeviceMetricsOverride', {
  width: LARG, height: ALT, deviceScaleFactor: 3, mobile: true,
  screenWidth: LARG, screenHeight: ALT,
});
await dormir(500);
await js(`document.querySelector('.m-nav button[data-aba="chat"]').click()`);
await dormir(400);

// ---- 7. a plaquinha da hunt abre o Mapa ----
await js(`document.getElementById('hud-hunt').click()`);
await dormir(1200);
const mapaAbriu = await js(`!document.getElementById('modal').classList.contains('hidden')
  && document.querySelector('#modal .modal-caixa')?.dataset.modal === 'mapa'`);
checar('a plaquinha da hunt abre o Mapa', !!mapaAbriu);

// ---- 8. os filtros do mapa nascem fechados e o botão os abre ----
const filtroFechado = await js(`getComputedStyle(document.querySelector('.mapa-filtros-grupo')).display === 'none'`);
checar('o Mapa abre com os filtros recolhidos', !!filtroFechado);
await js(`document.getElementById('filtros-bt').click()`);
await dormir(250);
const filtroAberto = await js(`getComputedStyle(document.querySelector('.mapa-filtros-grupo')).display !== 'none'`);
checar('o botão Filtros abre a dobra', !!filtroAberto);

// ---- 9. tocar num marcador ABRE a ficha e não troca de área ----
const huntAntes = await js(`document.getElementById('hud-hunt').textContent`);
await js(`document.querySelector('.marcador:not(.travado)')?.click()`);
await dormir(700);
const fichaAberta = await js(`!document.getElementById('hunt-analyser').classList.contains('hidden')
  && !!document.querySelector('#hunt-analyser .ha-cacar')`);
checar('tocar num marcador abre a ficha da área com o botão de caçar', !!fichaAberta);
const modalAindaAberto = await js(`!document.getElementById('modal').classList.contains('hidden')`);
checar('tocar no marcador NÃO troca de área sozinho', !!modalAindaAberto, huntAntes);
await js(`document.getElementById('modal-fechar').click()`);
await dormir(300);

// ---- 9b. a folha de filtros NÃO encolhe o resultado ----
//
// Era o defeito da primeira versão: aberta, a barra de filtros empurrava o mapa para fora do
// corpo do modal e sobrava uma nesga com o Hunt Analyser espremido por cima. A folha cobre o
// corpo em vez de dividi-lo, então o mapa mede o MESMO com ela aberta e fechada.
// Estado conhecido: o passo anterior deixou o Mapa aberto e a folha de filtros por cima.
await js(`document.getElementById('modal-fechar').click()`);
await dormir(400);
await js(`document.getElementById('hud-hunt').click()`);
await dormir(1400);
const mapaFechado = await js(`document.getElementById('mapa-mundi').getBoundingClientRect().height`);
await js(`document.getElementById('filtros-bt').click()`);
await dormir(400);
const mapaAberto = await js(`document.getElementById('mapa-mundi').getBoundingClientRect().height`);
checar(
  'a folha de filtros não rouba altura do mapa',
  Math.abs(mapaAberto - mapaFechado) <= 2 && mapaFechado > 300,
  `${Math.round(mapaFechado)}px → ${Math.round(mapaAberto)}px`,
);
const cobre = await js(`(() => {
  const f = document.querySelector('.mapa-filtros-grupo').getBoundingClientRect();
  const c = document.querySelector('#modal .modal-corpo').getBoundingClientRect();
  return JSON.stringify({
    ok: Math.abs(f.top - c.top) <= 2 && Math.abs(f.bottom - c.bottom) <= 2,
    folha: [Math.round(f.top), Math.round(f.bottom)],
    corpo: [Math.round(c.top), Math.round(c.bottom)],
  });
})()`);
checar('a folha cobre o corpo do modal (e não uma fatia dele)', JSON.parse(cobre).ok, cobre);
await js(`document.getElementById('filtros-pronto').click()`);
await dormir(300);
const fechouFolha = await js(`getComputedStyle(document.querySelector('.mapa-filtros-grupo')).display === 'none'`);
checar('o "Pronto" fecha a folha', !!fechouFolha);

// ---- 9c. a ficha da área cabe: cabeçalho e botão não comem o conteúdo ----
await js(`document.querySelector('.marcador:not(.travado)')?.click()`);
await dormir(700);
const fichaCabe = await js(`(() => {
  const p = document.getElementById('hunt-analyser');
  const corpo = document.getElementById('hunt-analyser-corpo');
  const bt = p.querySelector('.ha-cacar');
  const topo = p.querySelector('.ha-topo');
  if (!corpo || !bt || !topo) return JSON.stringify({ erro: 'faltou peça' });
  const r = corpo.getBoundingClientRect();
  const rb = bt.getBoundingClientRect();
  const rt = topo.getBoundingClientRect();
  return JSON.stringify({
    corpoAlt: Math.round(r.height),
    // nada de sobreposição entre as três faixas
    semSobrepor: rt.bottom <= r.top + 1 && r.bottom <= rb.top + 1,
    botaoNaTela: rb.bottom <= window.innerHeight + 1,
  });
})()`);
const fc = JSON.parse(fichaCabe);
checar(
  'a ficha da área tem corpo de sobra e nada se sobrepõe',
  fc.corpoAlt >= 120 && fc.semSobrepor && fc.botaoNaTela,
  fichaCabe,
);
await js(`document.getElementById('modal-fechar').click()`);
await dormir(300);

// ---- 9d. o Depot: uma lista por vez, e nenhuma vaza por cima da outra ----
await js(`document.getElementById('centro-depot')?.click()`);
await dormir(1200);
const depotAberto = await js(`!document.getElementById('centro-depot-modal').classList.contains('hidden')`);
if (!depotAberto) {
  checar('o Depot abre no Centro', false, 'botão do Depot não apareceu');
} else {
  const depot = await js(`(() => {
    const secoes = [...document.querySelectorAll('.depot-secao')];
    const visiveis = secoes.filter((s) => s.offsetParent !== null);
    const vaza = visiveis.some((s) => s.scrollHeight > s.clientHeight + 1);
    const lista = visiveis[0]?.querySelector('.depot-lista');
    return JSON.stringify({
      abas: document.querySelectorAll('.depot-aba').length,
      visiveis: visiveis.length,
      // a seção RECORTA: o que passa dela rola na lista de dentro, não vaza para a de baixo
      secaoRecorta: !vaza,
      listaRola: !!lista && getComputedStyle(lista).overflowY === 'auto',
      listaAlt: Math.round(lista?.getBoundingClientRect().height ?? 0),
    });
  })()`);
  const d2 = JSON.parse(depot);
  checar('o Depot mostra UMA lista por vez, com abas', d2.abas === 2 && d2.visiveis === 1, depot);
  checar(
    'a lista do Depot rola por dentro (nada vaza por cima da outra)',
    d2.secaoRecorta && d2.listaRola && d2.listaAlt > 200,
    depot,
  );
  await js(`document.getElementById('depot-fechar').click()`);
  await dormir(300);
}

// ---- 9e. abrir uma tela pelo Menu NÃO fecha a gaveta ----
await js(`document.querySelector('.m-nav button[data-aba="menu"]').click()`);
await dormir(500);
await js(`document.querySelector('.menu-topo button[data-modal="pokedex"]').click()`);
await dormir(1200);
const menuFicou = await js(`JSON.stringify({
  gaveta: document.getElementById('m-gaveta').classList.contains('aberta'),
  aba: document.querySelector('.m-nav button[data-aba="menu"]').classList.contains('on'),
  modal: !document.getElementById('modal').classList.contains('hidden'),
})`);
const mf = JSON.parse(menuFicou);
checar('abrir uma tela pelo Menu deixa a gaveta aberta', mf.gaveta && mf.aba && mf.modal, menuFicou);
await js(`document.getElementById('modal-fechar').click()`);
await dormir(300);

// ---- 9f. nada do Menu desenha por cima de um diálogo ----
//
// O rodapé de fan game, a etiqueta de versão e a barra de idiomas carregam `z-index: 60/70`
// do CSS de desktop, onde flutuam por cima de tudo. Dentro do Menu elas viram ITENS FLEX — e
// item flex com `z-index` cria contexto de empilhamento mesmo sendo `position: static`. Era o
// que fazia "Termos, Privacidade e Direitos" e a versão aparecerem sobre o "sair da conta".
const zMenu = await js(`(() => {
  const maus = [];
  for (const sel of ['.rodape-fan-jogo', '#versao', '.idiomas']) {
    const el = document.querySelector('.m-pane[data-aba="menu"] ' + sel);
    if (!el) { maus.push(sel + ':ausente'); continue; }
    const c = getComputedStyle(el);
    if (c.zIndex !== 'auto') maus.push(sel + ':' + c.zIndex);
  }
  return JSON.stringify(maus);
})()`);
checar('o rodapé do Menu não cria camada acima dos diálogos', zMenu === '[]', zMenu);

// ---- 9g. o Ranking usa a largura toda em TODAS as abas ----
//
// `.rk-corpo` é uma linha com `align-items: flex-start` no desktop; virada em coluna, esse
// alinhamento passa a valer para a largura e a coluna do pódio encolhe até o texto. Só dava
// para ver no "Top Catch", que é a aba de valores mais curtos.
await js(`document.querySelector('.m-nav button[data-aba="menu"]').click()`);
await dormir(400);
await js(`document.querySelector('.menu-topo button[data-modal="ranking"]').click()`);
await dormir(1800);
await js(`document.querySelector('.rk-aba[data-aba="capturas"]')?.click()`);
await dormir(1200);
const rk = await js(`(() => {
  const corpo = document.querySelector('.rk-corpo');
  const princ = document.querySelector('.rk-principal');
  if (!corpo || !princ) return JSON.stringify({ erro: 'sem ranking' });
  return JSON.stringify({
    corpo: Math.round(corpo.getBoundingClientRect().width),
    principal: Math.round(princ.getBoundingClientRect().width),
  });
})()`);
const r2 = JSON.parse(rk);
checar(
  'o Ranking ocupa a largura toda no Top Catch',
  r2.principal >= r2.corpo - 2,
  rk,
);
await js(`document.getElementById('modal-fechar').click()`);
await dormir(300);

// ---- 9h. o direcional não depende de fonte (nada de emoji nas setas) ----
const dpad = await js(`(() => {
  const bs = [...document.querySelectorAll('#centro-dpad button')];
  return JSON.stringify({
    botoes: bs.length,
    todosSvg: bs.length > 0 && bs.every((b) => !!b.querySelector('svg')),
    semTexto: bs.every((b) => b.textContent.trim() === ''),
  });
})()`);
const dp = JSON.parse(dpad);
checar(
  'as setas do direcional são SVG (não caem em emoji no iOS)',
  dp.botoes === 4 && dp.todosSvg && dp.semTexto,
  dpad,
);

// ---- 10. o interruptor das Configurações devolve o layout de computador ----
await js(`document.getElementById('btn-config').click()`);
await dormir(900);
const temInterruptor = await js(`!!document.getElementById('cfg-movel')`);
checar('as Configurações mostram o interruptor de layout', !!temInterruptor);
if (temInterruptor) {
  await js(`document.getElementById('cfg-movel').click()`);
  await dormir(900);
  const voltou = await js(`(() => {
    const html = document.documentElement;
    const esq = document.querySelector('.col.esq');
    return JSON.stringify({
      semClasse: !html.classList.contains('mobile'),
      semBarra: !document.getElementById('m-nav'),
      painelDeVolta: !!esq?.querySelector('#p-treinador') && !!esq?.querySelector('#p-equipe'),
      chatDeVolta: !!document.querySelector('.col.dir #p-chat'),
      retratoDeVolta: !!document.querySelector('.tr-coluna-retrato #tr-retrato'),
      moedasDeVolta: !!document.querySelector('.tr-dados .tr-moedas'),
      menuDeVolta: !!document.querySelector('.col.centro .menu-topo'),
    });
  })()`);
  const v = JSON.parse(voltou);
  checar('desligar devolve a tela de computador inteira', Object.values(v).every(Boolean), voltou);

  // e voltar a ligar não deixa nada para trás
  await js(`document.getElementById('cfg-movel')?.click()`);
  await dormir(900);
  const religou = await js(`document.documentElement.classList.contains('mobile')
    && document.querySelectorAll('#m-nav').length === 1
    && document.querySelectorAll('#tr-nick').length === 1`);
  checar('religar remonta sem duplicar nada', !!religou);
}

// ---- 11. num monitor a montagem não liga ----
await js(`try { localStorage.removeItem('cfg-movel'); } catch (_) {}`);
await virarCelular(false);
await cmd('Page.navigate', { url: `${URL_BASE}/app` });
await esperarPor('#app:not(.hidden) .menu-topo');
await dormir(1200);
const noDesktop = await js(`JSON.stringify({
  semClasse: !document.documentElement.classList.contains('mobile'),
  semBarra: !document.getElementById('m-nav'),
  tresColunas: !!document.querySelector('.col.esq #p-treinador') && !!document.querySelector('.col.dir #p-chat'),
})`);
const d = JSON.parse(noDesktop);
checar('num monitor a montagem de celular não liga', Object.values(d).every(Boolean), noDesktop);

const passaram = testes.filter((x) => x.ok).length;
console.log(`\n${passaram}/${testes.length} passaram`);
if (errosConsole.length) console.log(`erros no console: ${errosConsole.slice(0, 3).join(' | ')}`);

ws.close();
proc.kill();
await rm(perfil, { recursive: true, force: true }).catch(() => {});
process.exit(passaram === testes.length ? 0 : 1);
