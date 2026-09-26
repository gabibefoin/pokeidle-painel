/**
 * Painel de Economia — leitura do grafo hunts → pokémon → itens.
 *
 * Tudo aqui é LEITURA. Nenhum botão desta tela grava no jogo: ela existe para responder
 * "de onde vem o coin, para onde ele vai, e quanto disso está quebrado" antes de mexer em
 * qualquer número. O que ela mostra vem de `/api/economia`, que remonta as mesmas fontes que
 * o servidor do jogo lê no boot.
 *
 * A proposta que a tela exibe trabalha sob três travas: nenhum item novo, nenhum preço
 * alterado, e todo o dinheiro vindo de drop. O único lever é a COMPOSIÇÃO e a QUANTIDADE
 * dos drops de cada espécie.
 */
const $ = (s) => document.querySelector(s);

const ABAS = ['diagnostico', 'autonomia', 'bandas', 'itens', 'especies', 'hunts'];

const state = {
  dados: null,
  // A aba vem do hash para a tela ser linkável — `#autonomia` abre direto nos analytics.
  aba: ABAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'diagnostico',
  q: '',
  soConflito: false,
  abertos: new Set(),
  // Premissas da conta de poção — as duas que mandam no resultado e que ainda não foram
  // medidas em jogo. A tela deixa calibrar as duas e refaz a tabela no servidor.
  fracHp: null,
  cobertura: null,
  tetoPocao: null,
};

const N = (v, d = 0) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d });

const X = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${N(v, d)}×`);
const PCT = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(0)}%`);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --------------------------------------------------------------- carga

async function carregar() {
  const r = await fetch('/api/economia');
  state.dados = await r.json();
  const d = state.dados;
  $('#counts').innerHTML =
    `<b>${N(d.resumo.itens)}</b> itens · <b>${N(d.resumo.catalogo)}</b> vendáveis · ` +
    `<b>${N(d.resumo.especies)}</b> espécies · <b>${N(d.resumo.hunts)}</b> hunts`;
  render();
}

// ----------------------------------------------------------- diagnóstico

function abaDiagnostico() {
  const d = state.dados;
  const a = d.autonomia;
  const ini = a[0];
  const fim = a[a.length - 1];
  const m = d.modelo;

  const cards = [
    { rot: 'amplitude hoje', val: X(d.resumo.amplitudeHoje, 0), cls: 'ruim', nota: 'renda por kill, nv 1 → 160.300' },
    { rot: 'amplitude proposta', val: X(d.resumo.amplitudeNova, 0), cls: 'bom', nota: `curva única ${m.G_BASE}·n^${m.G_EXP}` },
    { rot: 'saldo no nv 1 · hoje', val: PCT(ini.hoje.saldoPct), cls: 'ruim', nota: `${N(ini.hoje.killsPorRevive, 0)} kills por um revive` },
    { rot: 'saldo no fim · hoje', val: PCT(fim.hoje.saldoPct), cls: 'ruim', nota: `${N(fim.hoje.ultraPorHora, 0)} Ultra Balls por hora` },
    {
      rot: 'saldo proposto',
      val: `${PCT(Math.min(...a.map((x) => x.novo.saldoPct)))} – ${PCT(Math.max(...a.map((x) => x.novo.saldoPct)))}`,
      cls: 'bom',
      nota: `no fim, ${N(fim.novo.ultraPorHora, 0)} Ultra Balls por hora`,
    },
  ];

  return `
<section class="eco-sec">
  <h2>As três travas do desenho</h2>
  <p class="sub">
    <b>Nenhum item novo</b> — o catálogo é o que é. <b>Nenhum preço muda</b> — nem de loja, nem de
    <code>npcPrice</code>. <b>Todo o dinheiro vem de drop</b> — a kill deixa de pagar ouro.
    Sobra um lever só: <b>a composição e a quantidade dos drops de cada espécie</b>, e é isso que
    o modelo resolve. Com os preços congelados, o crescimento da renda é o crescimento do poder
    de compra um para um — por isso a curva é chata de propósito.
  </p>
  <div class="eco-cards">
    ${cards.map((c) => `<div class="eco-card"><div class="rot">${c.rot}</div><div class="val ${c.cls}">${c.val}</div><div class="nota">${c.nota}</div></div>`).join('')}
  </div>
</section>

<section class="eco-sec">
  <h2>A curva</h2>
  <p class="sub">
    Escala log nos dois eixos. Vermelha é o que o jogo paga hoje; verde é a proposta
    <code>${m.G_BASE}·n^${m.G_EXP}</code>. O cruzamento fica por volta do <b>nível 25</b>: abaixo dele a
    proposta paga mais e o começo deixa de ser escravidão; acima ela corta, e corta mais quanto
    mais tarde. No fim são <b>23×</b> do começo ao fim, contra os 787.928× de hoje — é esse número
    que decide se o late game vira bilionário.
  </p>
  ${grafico()}
</section>

<section class="eco-sec">
  <h2>A loja não muda — ela vira a progressão</h2>
  <p class="sub">
    Este é o achado do desenho. Com a renda crescendo devagar e os preços <b>congelados</b>, a
    escada de bolas que <i>já existe</i> passa a ser a progressão: o jogador começa na Poké Ball,
    banca a Great por volta do nível 100, a Super lá pelo 3.000 e só sustenta a Ultra no fim do
    jogo. Não foi preciso inventar bola nenhuma — bastou parar de dar dinheiro demais.
  </p>
  <div class="escadas">
    ${lojaTab('Bolas', m.loja.bolas, (b) => `captura ${b.catchRate}×`)}
    ${lojaTab('Poções', m.loja.pocoes, (b) => `cura ${N(b.cura)}`)}
    ${lojaTab('Revives', m.loja.revives, () => '')}
  </div>
</section>`;
}

function lojaTab(titulo, lista, extra) {
  const a = state.dados.autonomia;
  // Em que nível de hunt cada degrau passa a ser o compra-padrão da proposta.
  const abre = (nome) => {
    const hit = a.find((r) => r.novo.bola === nome || r.novo.pocao === nome || r.novo.revive === nome);
    return hit ? `nv ${N(hit.nivel)}` : '—';
  };
  return `<div class="escada"><h3>${titulo} <span class="tag ok">preço intocado</span></h3><table>
    <tr><td class="dup">item</td><td class="dup">preço</td><td class="dup">vira padrão em</td><td class="dup"></td></tr>
    ${lista
      .map(
        (b) => `<tr>
      <td>${esc(b.nome)}</td>
      <td><b>${N(b.preco)}</b></td>
      <td class="dup">${abre(b.nome)}</td>
      <td class="dup">${extra(b)}</td>
    </tr>`,
      )
      .join('')}
  </table></div>`;
}

/** Gráfico log-log das duas curvas. SVG cru — não vale uma dependência. */
function grafico() {
  const W = 900;
  const H = 300;
  const P = { l: 60, r: 20, t: 16, b: 34 };
  const pts = state.dados.autonomia;
  const x1 = Math.max(...pts.map((p) => Math.log10(Math.max(1, p.nivel))));
  const y1 = Math.max(...pts.flatMap((p) => [Math.log10(Math.max(1, p.hoje.renda)), Math.log10(Math.max(1, p.novo.renda))]));
  const px = (v) => P.l + (Math.log10(Math.max(1, v)) / x1) * (W - P.l - P.r);
  const py = (v) => H - P.b - (Math.log10(Math.max(1, v)) / y1) * (H - P.t - P.b);
  const linha = (sel) => pts.map((p, i) => `${i ? 'L' : 'M'}${px(p.nivel).toFixed(1)},${py(sel(p)).toFixed(1)}`).join(' ');

  return `<div class="eco-grafico"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="renda por kill, hoje contra proposta">
  ${[1, 10, 100, 1000, 10000, 100000, 1000000]
    .filter((v) => Math.log10(v) <= y1)
    .map(
      (v) => `<line x1="${P.l}" y1="${py(v).toFixed(1)}" x2="${W - P.r}" y2="${py(v).toFixed(1)}" stroke="#272d3a"/>
     <text x="${P.l - 8}" y="${(py(v) + 4).toFixed(1)}" fill="#8b93a5" font-size="10" text-anchor="end">${N(v)}</text>`,
    )
    .join('')}
  ${[1, 10, 100, 1000, 10000, 100000]
    .filter((v) => Math.log10(v) <= x1)
    .map(
      (v) => `<line x1="${px(v).toFixed(1)}" y1="${P.t}" x2="${px(v).toFixed(1)}" y2="${H - P.b}" stroke="#1f2531"/>
     <text x="${px(v).toFixed(1)}" y="${H - P.b + 16}" fill="#8b93a5" font-size="10" text-anchor="middle">nv ${N(v)}</text>`,
    )
    .join('')}
  <path d="${linha((p) => p.hoje.renda)}" fill="none" stroke="#ef5350" stroke-width="2.5"/>
  <path d="${linha((p) => p.novo.renda)}" fill="none" stroke="#7bd88f" stroke-width="2.5"/>
</svg>
<div class="leg">
  <span><i style="background:#ef5350"></i>hoje</span>
  <span><i style="background:#7bd88f"></i>proposta</span>
  <span class="dup">eixos em escala logarítmica</span>
</div></div>`;
}

// ------------------------------------------------------------ autonomia

/** Cabeçalho fixo da aba: texto e os controles de premissa. O corpo vive em `corpoAutonomia`. */
function abaAutonomia() {
  const m = state.dados.modelo;
  return `
<section class="eco-sec">
  <h2>Autonomia do jogador — a conta da poção</h2>
  <p class="sub">
    <b>Poção é o gasto recorrente que manda</b>, e não dá para tratá-la como taxa fixa por kill: o
    revive só entra quando o pokémon cai, a poção entra toda vez que o HP fura o limiar de 30%.
    Então ela sai do <b>dano levado</b>:
    <code>HP reposto/kill = ${PCT((state.fracHp ?? m.POCAO.FRACAO_HP_POR_KILL) * 100)} do maxHp</code>, e
    <code>maxHp ≈ ${N(m.POCAO.HP_POR_NIVEL, 2)} × nível</code> (de <code>hpDeCombate</code>, com o selvagem
    valendo <code>huntLevel ± 2</code>).
    <br>
    A poção usada é a mais eficiente em <b>coins por HP</b> que não desperdiça cura acima do maxHp
    do bicho. Preços de loja congelados; bola ${N(m.CONSUMO.bolas, 1)}/kill e revive ${N(m.CONSUMO.revives, 2)}/kill.
  </p>

  <div class="eco-premissas">
    <label>HP perdido por kill
      <input type="range" id="frac-hp" min="2" max="30" step="1" value="${Math.round((state.fracHp ?? m.POCAO.FRACAO_HP_POR_KILL) * 100)}">
      <b id="frac-hp-v">${PCT((state.fracHp ?? m.POCAO.FRACAO_HP_POR_KILL) * 100)}</b> do maxHp
    </label>
    <label>cobertura mínima da poção
      <input type="range" id="cob-min" min="1" max="40" step="1" value="${Math.round((state.cobertura ?? m.POCAO.COBERTURA_MIN) * 100)}">
      <b id="cob-min-v">${PCT((state.cobertura ?? m.POCAO.COBERTURA_MIN) * 100)}</b> do maxHp
    </label>
    <span class="dup">nenhuma das duas foi medida em jogo — foram derivadas das fórmulas. Calibre e veja a tabela reagir.</span>
  </div>

  <div id="auto-corpo">${corpoAutonomia()}</div>
</section>`;
}

/**
 * O corpo da aba — cartões, tabela e leitura.
 *
 * Separado do cabeçalho de propósito: os controles de premissa ficam FORA daqui, senão o
 * `innerHTML` do recálculo destruiria o slider no meio do arraste e o ponteiro perderia o
 * elemento. Só este pedaço é reescrito quando as premissas mudam.
 */
function corpoAutonomia() {
  const a = state.dados.autonomia;
  const m = state.dados.modelo;
  const teto = state.tetoPocao ?? state.dados.resumo.tetoPocao;
  const cls = (v) => (v < 20 ? 'down' : v > 92 ? 'warn' : 'up');
  const clsPct = (v) => (v > 100 ? 'down' : v > 60 ? 'warn' : 'up');

  const linha = (r, lado, borda = false) => {
    const x = r[lado];
    return `
      <td class="num"${borda ? ' style="border-left:2px solid var(--line)"' : ''}>${N(x.renda)}</td>
      <td class="num dup">${N(x.maxHp)}</td>
      <td class="num dup">${N(x.hpPorKill)}</td>
      <td class="l ${x.pocaoViavel ? '' : 'warn'}">${x.pocaoViavel ? esc(x.pocao.replace(' Potion', '')) : 'Centro'}</td>
      <td class="num">${x.pocaoViavel ? N(x.pocoesPorKill, 2) : '—'}</td>
      <td class="num dup">${x.pocaoViavel ? N(x.pocoesPorHora) : '—'}</td>
      <td class="num"><b>${x.pocaoViavel ? N(x.custoPocao) : '—'}</b></td>
      <td class="num ${x.pocaoViavel ? clsPct(x.pocaoPctRenda) : 'dup'}">${x.pocaoViavel ? PCT(x.pocaoPctRenda) : '—'}</td>
      <td class="num dup">${N(x.custoBola)}</td>
      <td class="num dup">${N(x.custoRevive)}</td>
      <td class="num ${cls(x.saldoPct)}">${PCT(x.saldoPct)}</td>`;
  };

  return `
  <div class="eco-cards">
    <div class="eco-card"><div class="rot">teto da escada de poções</div><div class="val ruim">nv ${N(teto)}</div>
      <div class="nota">acima disso a Ultimate cura &lt;5% do maxHp e o jogador cai no Centro</div></div>
    <div class="eco-card"><div class="rot">cobertura no nv 100</div><div class="val bom">${PCT(a.find((r) => r.nivel === 100).novo.cobertura * 100)}</div>
      <div class="nota">a Ultimate cura duas vezes o HP inteiro</div></div>
    <div class="eco-card"><div class="rot">cobertura no fim</div><div class="val ruim">${PCT(a[a.length - 1].novo.cobertura * 100)}</div>
      <div class="nota">3.000 de cura contra ${N(a[a.length - 1].novo.maxHp)} de HP</div></div>
    <div class="eco-card"><div class="rot">pior banda de poção</div><div class="val ruim">${PCT(Math.max(...a.filter((r) => r.novo.pocaoViavel).map((r) => r.novo.pocaoPctRenda)))}</div>
      <div class="nota">da renda só em poção, no pico</div></div>
  </div>

  <div class="eco-tab-wrap"><table class="eco">
    <thead>
    <tr><th class="l dup"></th>
      <th colspan="11" class="dup" style="text-align:center">— HOJE —</th>
      <th colspan="11" class="dup" style="text-align:center;border-left:2px solid var(--line)">— PROPOSTA —</th>
    </tr>
    <tr>
      <th class="l">nível</th>
      ${[0, 1]
        .map(
          (i) => `
      <th ${i ? 'style="border-left:2px solid var(--line)"' : ''}>renda/kill</th>
      <th>maxHp</th><th>HP/kill</th>
      <th class="l">poção</th><th>poç/kill</th><th>poç/hora</th><th>custo poção</th><th>% da renda</th>
      <th>bola</th><th>revive</th><th>saldo</th>`,
        )
        .join('')}
    </tr></thead>
    <tbody>
    ${a
      .map(
        (r) => `<tr>
      <td class="l"><b>nv ${N(r.nivel)}</b></td>
      ${linha(r, 'hoje')}
      ${linha(r, 'novo', true)}
    </tr>`,
      )
      .join('')}
    </tbody>
  </table></div>

  <p class="sub" style="margin-top:14px">
    <b>O que a tabela revela.</b> Entre o nível 150 e o ${N(teto)} a poção fica <b class="down">cara demais</b> —
    chega a passar de 100% da renda. Não é a curva de coin que está errada: é que o <b>HP cresce com o
    nível e a cura da poção é um número fixo no item</b> (3.000 no topo). Custo de poção sobe linear,
    renda sobe como n^${m.G_EXP}. Nenhum ajuste de drop ou de preço fecha essa conta.
    <br><br>
    Acima do nível ${N(teto)} o problema se resolve sozinho pelo pior motivo: a poção cura tão pouco que
    deixa de ser um recurso, e o jogador passa a depender do <b>Centro Pokémon</b>, que é de graça.
    O custo vira <b>tempo de ida ao Centro</b>, não coin — por isso a coluna zera ali.
    <br><br>
    <span class="dup">Duas premissas para calibrar com telemetria antes de fechar qualquer número:
    a fração de HP perdida por kill (agora ${PCT((state.fracHp ?? m.POCAO.FRACAO_HP_POR_KILL) * 100)}) e a cobertura
    mínima que ainda faz a poção valer a pena (agora ${PCT((state.cobertura ?? m.POCAO.COBERTURA_MIN) * 100)}). As duas mandam no
    resultado, e nenhuma das duas foi medida em jogo — foram derivadas das fórmulas.</span>
  </p>
`;
}

// -------------------------------------------------------------- bandas

function abaBandas() {
  const b = state.dados.bandas;
  return `
<section class="eco-sec">
  <h2>A prateleira de cada banda</h2>
  <p class="sub">
    Aqui está o coração da proposta. Hoje os mesmos 193 itens caem do nível 1 ao 160.300 —
    <code>Enchanted Gem</code> vem de 124 espécies entre os níveis 1 e 43.100. Com um
    <code>npcPrice</code> só, <b>nenhum preço serve às duas pontas</b>. A saída, sem tocar em preço
    nenhum, é mudar <b>quem dropa o quê</b>: cada banda de nível ganha a sua faixa de preço de item,
    e a <b>quantidade</b> é resolvida para fechar a renda alvo daquele nível.
    <br>
    Repare no slot <b>jackpot</b>: nas bandas altas ele são as <b>pedras</b> (5.000 e 50.000) — os
    únicos itens caros que o jogo tem, e o papel natural delas. A pedra escolhida segue o
    <b>tipo do pokémon</b>, então um Charizard larga Fire Stone e um Gyarados larga Water Stone.
    <br>
    <span class="dup">As tabelas abaixo são a <b>referência</b> da banda, calculada num nível médio e
    sem tipo — por isso o jackpot delas cai num item genérico. Cada espécie recebe a sua versão, com
    a pedra do tipo dela e preferência pelos itens que ela já dropava; veja na aba <b>Espécies</b>.</span>
  </p>
  ${b
    .map(
      (x) => `<div class="escada" style="margin-bottom:14px">
    <h3>${x.id} · ${esc(x.rotulo)} <span class="dup" style="font-weight:400">— nv ${N(x.min)}–${x.max == null ? '∞' : N(x.max)} · alvo <b>${N(x.alvo)}</b> coins/kill</span></h3>
    <div class="eco-tab-wrap"><table class="eco">
      <thead><tr><th class="l">slot</th><th class="l">item de referência</th><th class="l">cat.</th><th>npcPrice</th><th>chance</th><th>qtd</th><th>coins/kill</th><th>% da renda</th></tr></thead>
      <tbody>${x.linhas
        .map(
          (l) => `<tr>
        <td class="l"><b>${esc(l.slot)}</b></td>
        <td class="l">${esc(l.nome)}</td>
        <td class="l dup">${esc(l.categoria)}</td>
        <td class="num">${N(l.npcPrice)}</td>
        <td class="num">${N(l.chancePct, 2)}%</td>
        <td class="num">${l.min === l.max ? N(l.min) : `${N(l.min)}–${N(l.max)}`}</td>
        <td class="num up">${N(l.ev)}</td>
        <td class="num dup">${PCT((100 * l.ev) / x.alvo)}</td>
      </tr>`,
        )
        .join('')}</tbody>
    </table></div></div>`,
    )
    .join('')}
</section>`;
}

// ---------------------------------------------------------------- itens

function abaItens() {
  const q = state.q.toLowerCase();
  const lista = state.dados.itens
    .filter((i) => !state.soConflito || (i.espalhamento ?? 0) > 10)
    .filter((i) => !q || i.nome.toLowerCase().includes(q) || i.categoria.toLowerCase().includes(q))
    .sort((a, b) => (b.espalhamento ?? 0) - (a.espalhamento ?? 0) || b.nDrops - a.nDrops);

  return `
<section class="eco-sec">
  <h2>Itens · ${N(lista.length)}</h2>
  <p class="sub">
    Todo item do jogo com o <code>npcPrice</code> que ele tem <b>e continuará tendo</b> — preço não é
    lever nesta proposta. A coluna que importa é o <b>espalhamento</b>: quantas vezes o nível mais
    alto que dropa o item é maior que o mais baixo. É a medida de quanto o pool está embaralhado
    hoje, e é a lista do que o rebanding tem de separar.
    Clique numa linha para ver todo pokémon que dropa aquele item.
  </p>
  <div class="eco-tab-wrap"><table class="eco">
    <thead><tr>
      <th class="l">item</th><th class="l">categoria</th>
      <th>espécies</th><th>chance méd.</th><th>nv mín</th><th>nv máx</th>
      <th>npcPrice</th><th>espalhamento</th>
    </tr></thead>
    <tbody>${lista.map((i) => linhaItem(i)).join('')}</tbody>
  </table></div>
</section>`;
}

function linhaItem(i) {
  const e = i.espalhamento;
  const tag =
    e == null
      ? '—'
      : e > 50
        ? `<span class="tag grave">${X(e, 0)}</span>`
        : e > 10
          ? `<span class="warn">${X(e, 0)}</span>`
          : `<span class="tag ok">${X(e, 1)}</span>`;
  const aberto = state.abertos.has(`i${i.id}`);
  return `<tr class="clicavel ${aberto ? 'aberta' : ''}" data-item="${i.id}">
    <td class="l"><b>${esc(i.nome)}</b></td>
    <td class="l dup">${esc(i.categoria)}</td>
    <td class="num">${N(i.nDrops)}</td>
    <td class="num dup">${i.chanceMed == null ? '—' : `${N(i.chanceMed, 2)}%`}</td>
    <td class="num dup">${N(i.nivelMin)}</td>
    <td class="num dup">${N(i.nivelMax)}</td>
    <td class="num"><b>${N(i.npcPrice)}</b></td>
    <td class="num">${tag}</td>
  </tr>${aberto ? `<tr class="det-linha"><td colspan="8"><div class="det" id="det-i${i.id}">carregando…</div></td></tr>` : ''}`;
}

async function abrirItem(id) {
  const alvo = document.getElementById(`det-i${id}`);
  if (!alvo) return;
  const d = await (await fetch(`/api/economia/item/${id}`)).json();
  if (d.erro) return void (alvo.textContent = d.erro);
  alvo.innerHTML = `
    <h4>${esc(d.nome)} — ${N(d.drops.length)} espécies dropam hoje</h4>
    <div class="eco-tab-wrap"><table class="eco">
      <thead><tr><th class="l">pokémon</th><th class="l">região</th><th>nv da hunt</th><th>chance</th><th>qtd</th></tr></thead>
      <tbody>${d.drops
        .map(
          (x) => `<tr>
        <td class="l">${esc(x.nome)}</td><td class="l dup">${esc(x.regiao)}</td>
        <td class="num">${N(x.nivel)}</td><td class="num">${N(x.chancePct, 2)}%</td>
        <td class="num dup">${x.min === x.max ? N(x.min) : `${N(x.min)}–${N(x.max)}`}</td>
      </tr>`,
        )
        .join('')}</tbody>
    </table></div>`;
}

// -------------------------------------------------------------- espécies

function abaEspecies() {
  const q = state.q.toLowerCase();
  const lista = state.dados.especies
    .filter((e) => !q || e.nome.toLowerCase().includes(q) || e.regiao.toLowerCase().includes(q) || e.banda.toLowerCase() === q)
    .sort((a, b) => a.nivel - b.nivel || a.nome.localeCompare(b.nome))
    .slice(0, 1200);

  return `
<section class="eco-sec">
  <h2>Espécies · ${N(lista.length)}</h2>
  <p class="sub">
    O que cada pokémon paga por kill hoje (kill + venda do loot) contra o que a tabela de drops
    proposta paga. <b>"loot hoje" é o diagnóstico mais duro do jogo</b>: fica em ~50-85 coins em
    <i>todas</i> as regiões, do nível 1 ao 160.300, enquanto a kill vai a 787.928 — o drop responde
    hoje por 0,01% da renda no late game. Na proposta ele responde por <b>100%</b>.
    <br>
    <b>mantidos</b> = quantos dos 4 slots caíram num item que a espécie <i>já dropava</i>, ou seja,
    quanto do sabor original sobreviveu ao rebanding. Clique para ver as duas tabelas lado a lado.
  </p>
  <div class="eco-tab-wrap"><table class="eco">
    <thead><tr>
      <th class="l">pokémon</th><th class="l">região</th><th class="l">banda</th><th>nv hunt</th><th>hunts</th>
      <th>kill hoje</th><th>loot hoje</th><th>total hoje</th>
      <th style="border-left:2px solid var(--line)">loot novo</th><th>mantidos</th>
    </tr></thead>
    <tbody>${lista.map((e) => linhaEspecie(e)).join('')}</tbody>
  </table></div>
</section>`;
}

function linhaEspecie(e) {
  const aberto = state.abertos.has(`e${e.pokeId}`);
  return `<tr class="clicavel ${aberto ? 'aberta' : ''}" data-especie="${e.pokeId}">
    <td class="l"><b>${esc(e.nome)}</b></td>
    <td class="l dup">${esc(e.regiao)}</td>
    <td class="l dup">${esc(e.banda)}</td>
    <td class="num">${N(e.nivel)}</td>
    <td class="num dup">${N(e.nHunts)}</td>
    <td class="num">${N(e.killHoje)}</td>
    <td class="num ${e.lootHoje < e.killHoje / 100 ? 'down' : 'dup'}">${N(e.lootHoje)}</td>
    <td class="num">${N(e.totalHoje)}</td>
    <td class="num up" style="border-left:2px solid var(--line)"><b>${N(e.lootNovo)}</b></td>
    <td class="num dup">${N(e.mantidos)}/4</td>
  </tr>${aberto ? `<tr class="det-linha"><td colspan="10"><div class="det" id="det-e${e.pokeId}">carregando…</div></td></tr>` : ''}`;
}

async function abrirEspecie(id) {
  const alvo = document.getElementById(`det-e${id}`);
  if (!alvo) return;
  const d = await (await fetch(`/api/economia/especie/${id}`)).json();
  if (d.erro) return void (alvo.textContent = d.erro);
  const tab = (titulo, linhas, total) => `
    <h4>${titulo} — ${N(total)} coins/kill</h4>
    <div class="eco-tab-wrap"><table class="eco">
      <thead><tr><th class="l">slot</th><th class="l">item</th><th>npc</th><th>chance</th><th>qtd</th><th>coins/kill</th></tr></thead>
      <tbody>${linhas
        .map(
          (l) => `<tr>
        <td class="l dup">${esc(l.slot ?? '—')}</td>
        <td class="l">${esc(l.nome)}${l.mantido ? ' <span class="tag ok">mantido</span>' : ''}</td>
        <td class="num">${N(l.npcPrice)}</td>
        <td class="num">${N(l.chancePct, 2)}%</td>
        <td class="num">${l.min === l.max ? N(l.min) : `${N(l.min)}–${N(l.max)}`}</td>
        <td class="num">${N(l.ev)}</td>
      </tr>`,
        )
        .join('')}</tbody>
    </table></div>`;
  alvo.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px">
    <div>${tab(`${esc(d.nome)} — loot de HOJE`, d.hoje, d.evHoje)}</div>
    <div>${tab(`loot PROPOSTO (banda ${esc(d.banda)}, alvo ${N(d.alvo)})`, d.novo, d.evNovo)}</div>
  </div>`;
}

// ----------------------------------------------------------------- hunts

function abaHunts() {
  const q = state.q.toLowerCase();
  const lista = state.dados.hunts.filter(
    (h) => !q || h.nome.toLowerCase().includes(q) || h.slug.toLowerCase().includes(q) || h.area.toLowerCase().includes(q) || h.banda.toLowerCase() === q,
  );

  return `
<section class="eco-sec">
  <h2>Hunts · ${N(lista.length)}</h2>
  <p class="sub">
    Toda hunt do jogo — as ${N(state.dados.hunts.filter((h) => h.fonte === 'espelho').length)} do espelho e as
    ${N(state.dados.hunts.filter((h) => h.fonte === 'editor').length)} do editor de spawns — com a banda
    a que passa a pertencer e a renda por kill de hoje contra a proposta.
    <span class="up">Verde</span> onde a proposta paga mais (o early), <span class="down">vermelho</span> onde ela corta.
  </p>
  <div class="eco-tab-wrap"><table class="eco">
    <thead><tr>
      <th class="l">hunt</th><th class="l">área</th><th class="l">fonte</th><th class="l">banda</th>
      <th>nível</th><th>espécies</th><th>renda hoje</th><th>renda nova</th><th>fator</th>
    </tr></thead>
    <tbody>${lista
      .map((h) => {
        const f = h.rendaHoje > 0 ? h.rendaNova / h.rendaHoje : null;
        return `<tr>
      <td class="l"><b>${esc(h.nome)}</b></td>
      <td class="l dup">${esc(h.area)}</td>
      <td class="l dup">${esc(h.fonte)}</td>
      <td class="l dup">${esc(h.banda)}</td>
      <td class="num">${N(h.nivel)}</td>
      <td class="num dup">${N(h.nEspecies)}</td>
      <td class="num">${N(h.rendaHoje)}</td>
      <td class="num"><b>${N(h.rendaNova)}</b></td>
      <td class="num ${f == null ? 'dup' : f > 1 ? 'up' : 'down'}">${f == null ? '—' : X(f, 2)}</td>
    </tr>`;
      })
      .join('')}</tbody>
  </table></div>
</section>`;
}

// ---------------------------------------------------------------- render

function render() {
  if (!state.dados) return;
  const mapa = {
    diagnostico: abaDiagnostico,
    autonomia: abaAutonomia,
    bandas: abaBandas,
    itens: abaItens,
    especies: abaEspecies,
    hunts: abaHunts,
  };
  $('#conteudo').innerHTML = mapa[state.aba]();
  for (const chave of state.abertos) {
    if (chave[0] === 'i' && state.aba === 'itens') abrirItem(chave.slice(1));
    if (chave[0] === 'e' && state.aba === 'especies') abrirEspecie(chave.slice(1));
  }
}

// ----------------------------------------------------------------- eventos

function marcarAba() {
  for (const x of $('#abas').querySelectorAll('.chip')) x.classList.toggle('on', x.dataset.aba === state.aba);
}

$('#abas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-aba]');
  if (!b) return;
  state.aba = b.dataset.aba;
  location.hash = state.aba;
  marcarAba();
  render();
});

addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (!ABAS.includes(h) || h === state.aba) return;
  state.aba = h;
  marcarAba();
  render();
});

/**
 * Recalcula a autonomia no servidor com as premissas da tela.
 *
 * Vai ao servidor em vez de refazer a conta aqui porque o modelo tem de ter UMA fonte só —
 * duplicar a fórmula no cliente é como as duas divergem sem ninguém perceber. O grafo fica em
 * cache lá, então a resposta é imediata.
 */
let pedidoAutonomia = 0;
async function recalcularAutonomia() {
  const meu = ++pedidoAutonomia;
  const qs = new URLSearchParams();
  if (state.fracHp != null) qs.set('frac', state.fracHp);
  if (state.cobertura != null) qs.set('cobertura', state.cobertura);
  const r = await (await fetch(`/api/economia/autonomia?${qs}`)).json();
  // Descarta resposta velha: arrastar o slider dispara vários pedidos e eles podem voltar fora
  // de ordem, o que faria a tabela piscar um valor que não é o do controle.
  if (meu !== pedidoAutonomia) return;
  state.dados.autonomia = r.autonomia;
  state.tetoPocao = r.tetoPocao;
  const corpo = document.getElementById('auto-corpo');
  if (corpo) corpo.innerHTML = corpoAutonomia();
  else render();
}

$('#conteudo').addEventListener('input', (e) => {
  if (e.target.id === 'frac-hp') {
    state.fracHp = Number(e.target.value) / 100;
    $('#frac-hp-v').textContent = `${e.target.value}%`;
    recalcularAutonomia();
  }
  if (e.target.id === 'cob-min') {
    state.cobertura = Number(e.target.value) / 100;
    $('#cob-min-v').textContent = `${e.target.value}%`;
    recalcularAutonomia();
  }
});

$('#q').addEventListener('input', (e) => {
  state.q = e.target.value.trim();
  render();
});

$('#so-conflito').addEventListener('change', (e) => {
  state.soConflito = e.target.checked;
  render();
});

$('#conteudo').addEventListener('click', (e) => {
  const tr = e.target.closest('[data-item], [data-especie]');
  if (!tr) return;
  const chave = tr.dataset.item ? `i${tr.dataset.item}` : `e${tr.dataset.especie}`;
  if (state.abertos.has(chave)) state.abertos.delete(chave);
  else state.abertos.add(chave);
  render();
});

marcarAba();
carregar().catch((e) => {
  $('#conteudo').innerHTML = `<p class="empty">falhou ao carregar: ${esc(e.message)}</p>`;
});
