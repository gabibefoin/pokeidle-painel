// O jogo no CELULAR — a segunda montagem da mesma tela.
//
// ### A ideia
//
// No desktop o jogo é um tabuleiro de três colunas: status à esquerda, batalha no meio,
// automações e chat à direita. Tudo à vista ao mesmo tempo, porque há 1500 px de largura para
// gastar. Num telefone há 390 — e a resposta *não* é empilhar as três colunas numa página que
// rola (era o que acontecia até aqui): a batalha, que é o produto, sumia no primeiro rolinho e
// chegar ao chat custava três dedadas.
//
// A montagem de celular é um **app**, não um documento: a janela inteira, sem rolagem de
// página, com a cena ocupando tudo que sobra e o resto guardado numa **gaveta** que sobe do
// rodapé quando se pede. O polegar alcança a barra de baixo; a batalha nunca sai da vista.
//
//     ┌──────────────────────────┐
//     │ retrato · nick · moedas  │  cabeçalho fixo (o HUD do treinador, comprimido)
//     ├──────────────────────────┤
//     │                          │
//     │      C E N A             │  ocupa toda a altura que sobrar
//     │                          │
//     ├──────────────────────────┤
//     │  gaveta (aba escolhida)  │  altura arrastável, fecha por completo
//     ├──────────────────────────┤
//     │ Equipe Bolsa Auto Chat ≡ │  barra de abas, à mão do polegar
//     └──────────────────────────┘
//
// ### A regra que sustenta tudo: MOVER, nunca copiar
//
// Este módulo não desenha nenhum painel. Ele **realoca os nós que já existem** — o painel da
// equipe, a bolsa, as automações, o chat e a barra de menus saem das colunas do desktop e
// entram nas gavetas. É o que faz o `app.js` continuar funcionando sem saber que existe
// celular: ele segue escrevendo em `#time`, `#itens`, `#chat-msgs` e companhia pelos mesmos
// ids, e não importa em que caixa esses ids estejam.
//
// Uma cópia dos painéis daria a mesma tela por um dia e duas telas divergentes por um ano.
//
// Cada movimento anota de onde o nó veio (`mover`), então `desmontar()` devolve tudo ao lugar
// — é isso que permite girar um tablet e voltar ao layout de desktop sem recarregar a página.
//
// ### Onde ficam as regras de estilo
//
// Em `mobile.css`, TODAS penduradas em `html.mobile`. O desktop não paga nada e não corre
// risco: sem a classe, o arquivo inteiro é regra que não casa com nada.

import { t } from './i18n.mjs';

// ------------------------------------------------------------------ detecção

const CHAVE_PREF = 'cfg-movel';
const CHAVE_ALTURA = 'movel-gaveta';

/**
 * Quem é "celular".
 *
 * Duas condições, e nenhuma delas é o user-agent (que mente, e envelhece a cada aparelho
 * novo). A primeira é a que pega telefone e tablet de verdade: **dedo** (`pointer: coarse`)
 * numa tela que não é de mesa. A segunda é a rede de segurança para uma janela de desktop
 * espremida abaixo de 720 px, onde as três colunas não cabem de jeito nenhum — ali a
 * montagem de celular é melhor do que a de desktop quebrada.
 *
 * O que fica de fora, de propósito: o notebook comum, o monitor, e o tablet deitado com
 * espaço para as três colunas. Ninguém que joga hoje vê a tela mudar.
 */
const CONSULTAS = ['(pointer: coarse) and (max-width: 1024px)', '(max-width: 720px)'];

/** `?movel=1` / `?movel=0` força a montagem — é como se confere uma das duas sem aparelho. */
function forcadoNaUrl() {
  try {
    const v = new URLSearchParams(location.search).get('movel');
    return v === '1' || v === '0' ? v : null;
  } catch {
    return null;
  }
}

/** A escolha do jogador nas Configurações: `'1'`, `'0'` ou `null` (= deixa o jogo decidir). */
function preferenciaMovel() {
  try {
    const v = localStorage.getItem(CHAVE_PREF);
    return v === '1' || v === '0' ? v : null;
  } catch {
    return null;
  }
}

export function definirPreferenciaMovel(v) {
  try {
    if (v === null) localStorage.removeItem(CHAVE_PREF);
    else localStorage.setItem(CHAVE_PREF, v);
  } catch { /* navegação privada / cota */ }
  avaliar();
}

/** Só mostra o interruptor nas Configurações a quem ele pode servir (tem dedo ou tela curta). */
export function aparelhoDeToque() {
  try {
    return telaCurtaOuToque() || matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function telaCurtaOuToque() {
  try {
    return CONSULTAS.some((q) => matchMedia(q).matches);
  } catch {
    return false;
  }
}

/** Tira do armazenamento uma pref `'1'` que sobrou de teste no celular/janela estreita. */
function limparPrefMovelSeObsoleta() {
  try {
    if (localStorage.getItem(CHAVE_PREF) !== '1') return;
    if (forcadoNaUrl()) return;
    if (telaCurtaOuToque() || matchMedia('(pointer: coarse)').matches) return;
    localStorage.removeItem(CHAVE_PREF);
  } catch { /* navegação privada / cota */ }
}

function deveSerMovel() {
  const url = forcadoNaUrl();
  if (url === '1') return true;
  if (url === '0') return false;

  const pref = preferenciaMovel();
  if (pref === '0') return false;

  const auto = telaCurtaOuToque();
  if (pref === '1') {
    // Quem ligou no celular não pode ficar preso no mobile ao abrir num monitor largo.
    return auto || aparelhoDeToque();
  }
  return auto;
}

// -------------------------------------------------------------------- estado

let ativo = false;
let ligado = false; // `iniciarMobile` já rodou
let abaAtual = null;
let deps = {};
const refs = {};

/** Pilha de mudanças de lugar, para `desmontar()` desfazer na ordem inversa. */
const movidos = [];

export const movelAtivo = () => ativo;

const $ = (s) => document.querySelector(s);

function mover(el, destino) {
  if (!el || !destino || el.parentElement === destino) return el;
  movidos.push({ el, pai: el.parentElement, irmao: el.nextElementSibling });
  destino.appendChild(el);
  return el;
}

function devolverTudo() {
  for (let i = movidos.length - 1; i >= 0; i--) {
    const { el, pai, irmao } = movidos[i];
    if (!pai) continue;
    // O irmão pode ter se mudado nesse meio-tempo; sem ele o nó volta para o fim do pai, que
    // é onde ele estava em quase todos os casos.
    pai.insertBefore(el, irmao?.parentElement === pai ? irmao : null);
  }
  movidos.length = 0;
}

const criar = (tag, classe, dentro) => {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  dentro?.appendChild(el);
  return el;
};

// ----------------------------------------------------------------- as abas
//
// Cinco, que é o teto do que um polegar acerta sem olhar. A ordem é a do uso: o que se abre a
// cada minuto à esquerda, o que se abre uma vez por sessão à direita.
//
// O MAPA não está aqui de propósito — ele tem porta própria no menu. A plaquinha da hunt,
// dentro da cena, vira atalho à Pokédex no celular (ver `pintarAtalhoHuntCena` em `app.js`).

const BOLA = '/assets/site/assets/ui/ball-poke.png';
const BOLSA = '/assets/site/assets/ui/menu-bolsa.png';

/** Ícones que não existem no espelho de assets: SVG de uma linha, como o resto da interface. */
const SVG = {
  auto: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" fill="currentColor"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 2-2z" fill="currentColor"/><circle cx="8" cy="11" r="1.3" fill="var(--rx-esc)"/><circle cx="12" cy="11" r="1.3" fill="var(--rx-esc)"/><circle cx="16" cy="11" r="1.3" fill="var(--rx-esc)"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><rect x="3" y="5" width="18" height="3" rx="1.5"/><rect x="3" y="10.5" width="18" height="3" rx="1.5"/><rect x="3" y="16" width="18" height="3" rx="1.5"/></g></svg>`,
};

const ABAS = [
  { id: 'equipe', chave: 'm.equipe', img: BOLA },
  { id: 'bolsa', chave: 'm.bolsa', img: BOLSA },
  { id: 'auto', chave: 'm.auto', svg: SVG.auto },
  { id: 'chat', chave: 'm.chat', svg: SVG.chat },
  { id: 'menu', chave: 'm.menu', svg: SVG.menu },
];

// --------------------------------------------------------------- a montagem

function montarShell() {
  const app = $('#app');
  if (!app || refs.shell) return;

  // ---- cabeçalho: o HUD do treinador comprimido numa faixa de ~60 px ----
  //
  // Os nós são os MESMOS do painel de desktop (nick, nível, barra de XP, moedas, retrato) —
  // por isso o `pintarTreinador` continua acertando todos eles sem saber de nada. O que
  // sobra do painel (boosts ativos, online, ELO) segue inteiro na gaveta "Equipe".
  const topo = criar('header', 'm-topo', app);
  topo.id = 'm-topo';

  // O retrato entra SEM embrulho: ele já é um botão (`role="button"` + `onclick` que abre a
  // ficha do treinador, no app.js). Pô-lo dentro de um `<button>` daria botão dentro de botão
  // — HTML inválido e um alvo de toque que responde a dois donos.
  mover($('#tr-retrato'), topo);

  const ident = criar('div', 'm-ident', topo);
  mover($('.tr-topo'), ident);

  const acoes = criar('div', 'm-topo-acoes', topo);
  mover($('#btn-config'), acoes);

  // O `#btn-afiliados` mora dentro de `.tr-moedas`, e é o único item de lá que não é saldo:
  // sai antes, para a faixa do topo ficar com as três moedas e nada mais. Ele reaparece na
  // gaveta "Menu", que é onde as portas de fora do jogo se juntam.
  const afiliados = $('#btn-afiliados');
  const moedas = criar('div', 'm-moedas', topo);
  const xp = criar('div', 'm-xp', topo);
  mover($('.barra.xp'), xp);

  // ---- a gaveta ----
  const gaveta = criar('section', 'm-gaveta', app);
  gaveta.id = 'm-gaveta';
  gaveta.setAttribute('aria-hidden', 'true');

  const alca = criar('div', 'm-alca', gaveta);
  alca.id = 'm-alca';
  alca.setAttribute('role', 'separator');
  alca.setAttribute('aria-label', t('m.arrastar'));
  criar('i', null, alca);

  const corpo = criar('div', 'm-gaveta-corpo', gaveta);
  const panes = {};
  for (const aba of ABAS) {
    const p = criar('div', 'm-pane', corpo);
    p.dataset.aba = aba.id;
    panes[aba.id] = p;
  }

  // ---- o que vai em cada gaveta ----
  mover($('#p-treinador'), panes.equipe);
  mover($('#p-ativo'), panes.equipe);
  mover($('#p-equipe'), panes.equipe);
  mover($('#p-auto'), panes.auto);
  mover($('#p-chat'), panes.chat);

  // A barra de menus do topo vira uma grade de dois por linha dentro da gaveta "Menu".
  mover($('.menu-topo'), panes.menu);

  // As portas que não são "abas do jogo": a guild, votar, calcular a nota de um bicho e
  // indicar amigos. No desktop moram espalhadas pela coluna da esquerda, e o que diz o que
  // cada uma faz é o `title` — que num telefone NÃO EXISTE, porque não há para onde apontar.
  // Por isso aqui cada uma ganha um rótulo embaixo do desenho.
  //
  // O rótulo mora num embrulho, e não dentro do botão: o botão é o mesmo nó do desktop, e
  // escrever dentro dele deixaria lixo para trás ao desmontar.
  const extras = criar('div', 'm-extras', panes.menu);
  const comRotulo = (el, chave) => {
    if (!el) return;
    const caixa = criar('div', 'm-extra', extras);
    mover(el, caixa);
    const rot = criar('span', 'm-extra-rot', caixa);
    rot.dataset.i18n = chave;
    rot.textContent = t(chave);
  };
  comRotulo($('#tr-guild'), 'guild.titulo');
  comRotulo($('#btn-votar'), 'modal.votar');
  comRotulo($('#btn-calculadora'), 'modal.calculadora');
  comRotulo($('#btn-amigos'), 'modal.amigos');
  comRotulo(afiliados, 'modal.afiliados');

  // Idioma, redes e sair: a barra que no desktop flutua no canto de baixo à esquerda, e que
  // no celular cairia exatamente em cima da barra de abas.
  mover(document.querySelector('.idiomas'), panes.menu);
  mover(document.querySelector('.rodape-fan-jogo'), panes.menu);
  mover($('#versao'), panes.menu);

  // As moedas entram por último: `.tr-moedas` só perde o botão de afiliados depois que ele
  // já foi levado para os extras.
  mover($('.tr-moedas'), moedas);

  // ---- barra de abas ----
  const nav = criar('nav', 'm-nav', app);
  nav.id = 'm-nav';
  for (const aba of ABAS) {
    const b = criar('button', 'm-nav-btn', nav);
    b.type = 'button';
    b.dataset.aba = aba.id;
    const ico = criar('span', 'm-nav-ico', b);
    if (aba.img) {
      const img = criar('img', null, ico);
      img.src = aba.img;
      img.alt = '';
      img.width = 24;
      img.height = 24;
    } else {
      ico.innerHTML = aba.svg;
    }
    const rot = criar('span', 'm-nav-rot', b);
    rot.dataset.i18n = aba.chave;
    rot.textContent = t(aba.chave);
    const contador = criar('b', 'm-selo', b);
    contador.hidden = true;
  }

  refs.shell = true;
  refs.app = app;
  refs.gaveta = gaveta;
  refs.nav = nav;
  refs.alca = alca;
  refs.panes = panes;

  montarFaixaDaCena();
  ligarNav();
  ligarAlca();
  ligarPinchNaCena();
  ligarCaptura();
}

/**
 * A FAIXA DE CIMA DA CENA — uma fileira só, do canto esquerdo ao direito do palco.
 *
 * Antes, tudo que se faz "de dentro da batalha" ficava espalhado: a plaquinha da hunt num
 * canto, a corda e o pop-up noutro, "Ir ao Centro" e "Desistir" empilhados num terceiro.
 * Quatro peças em três cantos, cada uma com um tamanho — o que num telefone de 360 px vira o
 * amontoado que o desenho de referência resolve com UMA linha.
 *
 * Aqui é a mesma solução do resto do módulo: MOVER os nós que já existem. O `#hud-hunt` e o
 * `#hunt-saida` continuam sendo os mesmos elementos que o `app.js` mostra e esconde pelos
 * mesmos ids — só passaram a morar numa faixa em vez de flutuarem cada um no seu canto.
 */
function montarFaixaDaCena() {
  const palco = $('#palco');
  if (!palco) return;

  const barra = criar('div', 'm-cena-topo', palco);
  barra.id = 'm-cena-topo';
  mover($('#hud-hunt'), barra);

  const acoes = criar('div', 'm-cena-acoes', barra);

  // As saídas da cena, na ordem em que aparecem: hunt (pop-up + corda + Centro + desistir),
  // arena de boss e casa. Nunca há duas ao mesmo tempo — quem esconde cada uma é o
  // `app.js`, pela classe `hidden` de sempre.
  mover($('#hunt-saida'), acoes);
  mover($('#boss-sair'), acoes);
  mover($('#casa-sair'), acoes);

  refs.barra = barra;
}

/**
 * CAPTURAR — o painel dos corpos no chão vira uma janelinha com botão próprio.
 *
 * No desktop ele é uma coluna encostada no canto e cabe. No celular era uma FITA rente à base
 * que rolava DE LADO: os corpos entravam pela direita, e ver o quarto exigia arrastar a fita —
 * num painel que se olha para decidir um toque em dois segundos, com o corpo sumindo do chão
 * enquanto se arrasta. Pior: ela ficava aberta o tempo todo, tapando a faixa de baixo da cena.
 *
 * Agora é o botão `C`, na base à direita, na mesma fileira da prancheta e do histórico de
 * capturas — que são os outros dois interruptores de painel daquele canto, com a mesma
 * gramática de "madeira apagado, roxo aberto". Ele entra como PRIMEIRO da fileira, o que o
 * põe exatamente em cima da seta da fileira de baixo, e mantém o canto na largura que já
 * tinha: crescer a fileira de baixo para quatro botões empurraria o log da batalha.
 *
 * Um toque abre a janelinha (título, as bolas que ele tem e a lista em COLUNA, como no
 * desktop), outro toque a guarda.
 *
 * O botão só existe quando há corpo no chão, e quem decide isso continua sendo o
 * `pintarCaidos` do app.js pela classe `hidden` — aqui a gente só ESCUTA essa classe.
 */
function ligarCaptura() {
  const fileira = document.querySelector('.hud-zoom-btns');
  const caidos = $('#caidos');
  if (!fileira || !caidos) return;

  // `sessao-btn` não é enfeite: é a classe que dá a esses botões o corpo de 40 px, a tábua
  // apagada e o roxo do `.on`. O painel aberto acende do mesmo jeito que a prancheta.
  const bt = criar('button', 'sessao-btn m-captura');
  bt.type = 'button';
  bt.id = 'cena-captura';
  bt.textContent = 'C'; // de Capturar / Catch / Capturar — a mesma letra nos três idiomas
  bt.title = t('cena.capturar');
  bt.setAttribute('aria-label', t('cena.capturar'));
  fileira.insertBefore(bt, fileira.firstChild);
  bt.addEventListener('click', () => {
    bt.classList.toggle('on', caidos.classList.toggle('m-aberto'));
  });

  // Título curto: "Proximidade para Capturar" ocupa três linhas numa caixa de 190 px. Troca a
  // CHAVE, e não só o texto — assim trocar de idioma continua traduzindo o rótulo certo.
  const tit = caidos.querySelector('.caidos-titulo');
  if (tit) {
    refs.tituloCaidos = { el: tit, chave: tit.dataset.i18n };
    tit.dataset.i18n = 'cena.capturar';
    tit.textContent = t('cena.capturar');
  }

  const sincronizar = () => {
    bt.hidden = caidos.classList.contains('hidden');
  };
  sincronizar();
  const observador = new MutationObserver(sincronizar);
  observador.observe(caidos, { attributes: true, attributeFilter: ['class'] });
  refs.captura = { bt, observador, caidos };
}

/** Desfaz o `ligarCaptura`: o botão sai, o painel volta a ser do desktop. */
function desligarCaptura() {
  const c = refs.captura;
  if (c) {
    c.observador.disconnect();
    c.bt.remove();
    c.caidos.classList.remove('m-aberto');
  }
  const tit = refs.tituloCaidos;
  if (tit?.el) {
    if (tit.chave) tit.el.dataset.i18n = tit.chave;
    else delete tit.el.dataset.i18n;
    tit.el.textContent = t(tit.chave ?? 'cena.noChao');
  }
}

function desmontarShell() {
  if (!refs.shell) return;
  chatNaoLidas = 0;
  desligarCaptura();
  devolverTudo(); // antes de remover as caixas: os nós movidos voltam para os pais de origem
  refs.barra?.remove();
  refs.gaveta?.remove();
  refs.nav?.remove();
  document.getElementById('m-topo')?.remove();
  for (const k of Object.keys(refs)) delete refs[k];
  abaAtual = null;
}

// ---------------------------------------------------------------- interação

function ligarNav() {
  refs.nav.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-aba]');
    if (!b) return;
    if (b.dataset.aba === 'bolsa') {
      deps.abrirModal?.('bolsa');
      return fecharGaveta();
    }
    alternarAba(b.dataset.aba);
  });

  // A gaveta do Menu FICA ABERTA quando uma tela sobe. O modal cobre tudo de qualquer jeito, e
  // fechá-la junto tornava a navegação picotada: escolher Pokédex, fechar, e ter de reabrir o
  // Menu para ir ao Mapa. Aberta, o fluxo é um só — a tela sobe e desce, o menu continua ali.
}

/**
 * A alça: arrastar para cima cresce a gaveta, para baixo encolhe, e soltar embaixo do piso
 * fecha. A altura fica gravada — quem gosta do chat grande não reajusta a cada sessão.
 *
 * Em fração da janela (e não em pixels) de propósito: com o teclado aberto a janela encolhe
 * para menos da metade, e uma altura em px viraria uma gaveta que come a tela inteira.
 */
const FRACAO_MIN = 0.18;
const FRACAO_MAX = 0.78;
const FRACAO_PADRAO = 0.46;

function fracaoGravada() {
  const v = Number(localStorage.getItem(CHAVE_ALTURA));
  return Number.isFinite(v) && v >= FRACAO_MIN && v <= FRACAO_MAX ? v : FRACAO_PADRAO;
}

function aplicarFracao(f) {
  refs.app?.style.setProperty('--m-gaveta', `${Math.round(f * 1000) / 10}%`);
}

function ligarAlca() {
  aplicarFracao(fracaoGravada());
  let arrasto = null;

  refs.alca.addEventListener('pointerdown', (ev) => {
    if (!refs.gaveta.classList.contains('aberta')) return;
    ev.preventDefault();
    refs.alca.setPointerCapture?.(ev.pointerId);
    arrasto = { y: ev.clientY, f: refs.gaveta.getBoundingClientRect().height / alturaUtil() };
    refs.gaveta.classList.add('arrastando');
  });

  refs.alca.addEventListener('pointermove', (ev) => {
    if (!arrasto) return;
    const f = arrasto.f + (arrasto.y - ev.clientY) / alturaUtil();
    aplicarFracao(Math.max(FRACAO_MIN * 0.6, Math.min(FRACAO_MAX, f)));
  });

  const soltar = () => {
    if (!arrasto) return;
    arrasto = null;
    refs.gaveta.classList.remove('arrastando');
    const f = refs.gaveta.getBoundingClientRect().height / alturaUtil();
    if (f < FRACAO_MIN) {
      aplicarFracao(fracaoGravada());
      return fecharGaveta();
    }
    const limpo = Math.max(FRACAO_MIN, Math.min(FRACAO_MAX, f));
    aplicarFracao(limpo);
    try {
      localStorage.setItem(CHAVE_ALTURA, String(Math.round(limpo * 1000) / 1000));
    } catch { /* cota */ }
  };
  refs.alca.addEventListener('pointerup', soltar);
  refs.alca.addEventListener('pointercancel', soltar);

  // Tocar na alça (sem arrastar) fecha — o gesto que todo mundo tenta primeiro.
  refs.alca.addEventListener('click', () => {
    if (refs.gaveta.classList.contains('aberta')) fecharGaveta();
  });
}

const alturaUtil = () => window.visualViewport?.height ?? window.innerHeight;

export function abrirAba(nome) {
  if (!ativo || !refs.panes?.[nome]) return;
  abaAtual = nome;
  for (const [id, p] of Object.entries(refs.panes)) p.classList.toggle('on', id === nome);
  for (const b of refs.nav.querySelectorAll('button[data-aba]')) {
    b.classList.toggle('on', b.dataset.aba === nome);
    b.setAttribute('aria-expanded', String(b.dataset.aba === nome));
  }
  refs.gaveta.classList.add('aberta');
  refs.gaveta.setAttribute('aria-hidden', 'false');
  refs.app.classList.add('gaveta-aberta');
  if (nome === 'chat') {
    chatNaoLidas = 0;
    selo('chat', 0);
    deps.aoAbrirChat?.();
  }
}

export function fecharGaveta() {
  if (!ativo || !refs.gaveta) return;
  abaAtual = null;
  refs.gaveta.classList.remove('aberta');
  refs.gaveta.setAttribute('aria-hidden', 'true');
  refs.app.classList.remove('gaveta-aberta');
  for (const b of refs.nav.querySelectorAll('button[data-aba]')) {
    b.classList.remove('on');
    b.setAttribute('aria-expanded', 'false');
  }
  // Com a gaveta fechando embaixo de um campo de texto, o teclado ficaria no ar sozinho.
  if (document.activeElement?.tagName === 'INPUT') document.activeElement.blur();
}

function alternarAba(nome) {
  if (abaAtual === nome) return fecharGaveta();
  abrirAba(nome);
}

/** O contador vermelho de uma aba (hoje: mensagens novas no chat). `0` apaga. */
function selo(aba, n) {
  const b = refs.nav?.querySelector(`button[data-aba="${aba}"] .m-selo`);
  if (!b) return;
  const v = Number(n) || 0;
  b.hidden = v <= 0;
  b.textContent = v > 99 ? '99+' : String(v);
}

/**
 * Uma mensagem entrou no chat.
 *
 * A conta é daqui (e não do `estado.chatNovas` do app) porque as duas perguntas são
 * diferentes: lá é "você subiu a rolagem e perdeu linhas"; aqui é "a gaveta do chat está
 * fechada e você nem viu que alguém falou". Com a gaveta fechada a lista mede zero, e a
 * conta de lá responderia sempre que está tudo lido.
 */
let chatNaoLidas = 0;
export function seloChatMobile() {
  if (!ativo) return;
  if (abaAtual === 'chat') return;
  chatNaoLidas++;
  selo('chat', chatNaoLidas);
}

/**
 * Pinça para aproximar a batalha.
 *
 * Os dois botões de lupa continuam ali (são a porta descoberta por quem não pensa em gesto),
 * mas num telefone a pinça é o que a mão faz sozinha. Os níveis de zoom são degraus fixos —
 * então a pinça não escala nada continuamente: ela conta quanto os dedos se afastaram e
 * dispara UM degrau a cada 35% de distância, que é o ponto em que o gesto já foi claramente
 * intencional.
 */
function ligarPinchNaCena() {
  const palco = $('#palco');
  if (!palco) return;
  const dedos = new Map();
  let base = 0;

  const dist = () => {
    const [a, b] = [...dedos.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const aoDescer = (ev) => {
    dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (dedos.size === 2) base = dist();
  };
  const aoMover = (ev) => {
    if (!dedos.has(ev.pointerId)) return;
    dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (dedos.size !== 2 || !base) return;
    const razao = dist() / base;
    if (razao > 1.35) {
      deps.zoomCena?.(1);
      base = dist();
    } else if (razao < 0.74) {
      deps.zoomCena?.(-1);
      base = dist();
    }
  };
  const aoSubir = (ev) => {
    dedos.delete(ev.pointerId);
    base = 0;
  };

  palco.addEventListener('pointerdown', aoDescer);
  palco.addEventListener('pointermove', aoMover);
  palco.addEventListener('pointerup', aoSubir);
  palco.addEventListener('pointercancel', aoSubir);
  refs.pinch = { palco, aoDescer, aoMover, aoSubir };
}

function desligarGestos() {
  const p = refs.pinch;
  if (p) {
    p.palco.removeEventListener('pointerdown', p.aoDescer);
    p.palco.removeEventListener('pointermove', p.aoMover);
    p.palco.removeEventListener('pointerup', p.aoSubir);
    p.palco.removeEventListener('pointercancel', p.aoSubir);
  }
}

// ------------------------------------------------------- altura de verdade
//
// `100vh` no celular é uma mentira antiga: ela mede a janela SEM a barra de endereço, que
// aparece e some enquanto se rola, e não encolhe quando o teclado sobe. O resultado é o
// rodapé do jogo escondido atrás do Chrome, ou a barra de abas debaixo do teclado.
//
// `visualViewport` é a medida certa — é o retângulo que o jogador realmente enxerga — e o
// `--m-alt` que sai daqui é a altura de todo o app.

function ajustarAltura() {
  const vv = window.visualViewport;
  const h = Math.round(vv?.height ?? window.innerHeight);
  document.documentElement.style.setProperty('--m-alt', `${h}px`);
  // O DESLOCAMENTO é a outra metade do problema, e é só do iOS: com o teclado aberto o Safari
  // ROLA a página por baixo para revelar o campo em foco, e um `body` fixo em `top: 0` fica
  // ancorado no lugar antigo — o jogo sobe e a barra de abas some. `offsetTop` é exatamente o
  // quanto ele rolou.
  document.documentElement.style.setProperty('--m-off', `${Math.round(vv?.offsetTop ?? 0)}px`);
}

// ---------------------------------------------------------------- ligar/desligar

function aplicar(novo) {
  if (novo === ativo) return;
  ativo = novo;
  document.documentElement.classList.toggle('mobile', novo);
  if (novo) {
    montarShell();
    ajustarAltura();
  } else {
    desligarGestos();
    desmontarShell();
    document.documentElement.style.removeProperty('--m-alt');
  }
  // A cena precisa reconferir o tamanho do canvas: a moldura mudou de altura no mesmo quadro.
  window.dispatchEvent(new Event('resize'));
}

function avaliar() {
  if (!ligado) return;
  limparPrefMovelSeObsoleta();
  aplicar(deveSerMovel());
}

/**
 * Liga a montagem de celular.
 *
 * `dependencias` é o que este módulo precisa do `app.js` sem ter de importá-lo (o que faria
 * um ciclo): abrir um modal, dar um degrau de zoom e avisar que o chat foi aberto.
 */
export function iniciarMobile(dependencias = {}) {
  if (ligado) return;
  deps = dependencias;
  ligado = true;

  for (const q of CONSULTAS) {
    const mq = matchMedia(q);
    mq.addEventListener?.('change', avaliar);
  }
  // Girar o aparelho não dispara `change` em nenhuma das consultas quando as duas continuam
  // valendo — mas muda a altura, e a gaveta é uma fração dela.
  window.addEventListener('orientationchange', () => setTimeout(ajustarAltura, 120));
  window.visualViewport?.addEventListener('resize', () => {
    if (ativo) ajustarAltura();
  });
  window.addEventListener('resize', () => {
    if (ativo) ajustarAltura();
  });

  avaliar();
}

/**
 * Chamado a cada pacote de estado. Só carrega para a barra de abas o que se precisa saber com
 * a gaveta FECHADA — hoje, o pontinho de convite de guild e o de voto disponível, que no
 * desktop moram em botões visíveis o tempo todo e aqui ficam dois toques abaixo.
 */
export function sincronizarMobile() {
  if (!ativo || !refs.nav) return;
  const chamando =
    !!document.querySelector('#tr-guild.tem-convite')
    || !!document.querySelector('#btn-votar.tem-voto')
    || !!document.querySelector('#btn-afiliados.tem-af-pendente')
    // O Passe de Batalha com resgate esperando: o botão dele mora na barra do topo, que no
    // celular fica dentro do Menu.
    || !!document.querySelector('.menu-topo button[data-modal="passe"].tem-premio');
  refs.nav.querySelector('button[data-aba="menu"]')?.classList.toggle('chamando', chamando);
}
