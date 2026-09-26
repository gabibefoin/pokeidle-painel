const app=document.querySelector('#app');
var pokemon = []; window.pokemon = pokemon; // populated from CSV


// Load CSV data (relative to the project root)
function loadPokemonData(){
  return fetch('pokedex-completa-excel.csv')
    .then(r=>r.text())
    .then(text=>{
      const lines=text.split(/\r?\n/).filter(l=>l.trim());
      const headers=lines[0].split(';');
      const data=lines.slice(1).map(line=>{
        const cols=line.split(';');
        const obj={};
        headers.forEach((h,i)=>obj[h]=cols[i]);
        // Build tipos array from tipo1 and tipo2 (ignore empty)
        obj.tipos=[obj.tipo1, obj.tipo2].filter(Boolean);
        return obj;
      });
      pokemon.push(...data);
    });
}

// Helper to render monster name/icon

const mon = p => `<div class="monster"><i class="monster-icon"></i>${p.nome}</div>`;
const type = x => `<span class="type ${x}">${x}</span>`;
const panel = (x, c = '') => `<section class="section-card ${c}">${x}</section>`;
const names = ['Começando no PokéIdle','Guia de XP e Evolução','Bosses e Tokens: rota completa','Outland — guia de região completo','Estratégias de PvP e GvG','Mecânicas de shinies explicadas','Evento sazonal: Festival de Outono','Ginásio: primeiros passos'];
const dexState = {
  search: '',
  tipo1: '',
  tipo2: '',
  regiao: '',
  apenasShiny: false,
  ball: 'poke',
  captureBoost: false,
  shinyLure: false
};

function formatNum(n) {
  if (!n || isNaN(n)) return n || '—';
  return Number(n).toLocaleString('pt-BR');
}

function cleanHunt(r) {
  const reg = r.regiao || 'Kanto';
  const lvl = r.nivel_hunt_min || r.nivel_ao_capturar || 20;
  return `${reg}, Nv ${lvl}`;
}

function getBallData(r, ballKey, captureBoost) {
  const map = {
    poke: {
      pct: captureBoost ? r.captura_pok_ball_com_capture_boost_pct : r.captura_pok_ball_pct,
      derrotas: r.captura_pok_ball_derrotas_media,
      shiny: r.shiny_encontrar_e_capturar_pok_ball_1_em
    },
    great: {
      pct: captureBoost ? r.captura_great_ball_com_capture_boost_pct : r.captura_great_ball_pct,
      derrotas: r.captura_great_ball_derrotas_media,
      shiny: r.shiny_encontrar_e_capturar_great_ball_1_em
    },
    super: {
      pct: captureBoost ? r.captura_super_ball_com_capture_boost_pct : r.captura_super_ball_pct,
      derrotas: r.captura_super_ball_derrotas_media,
      shiny: r.shiny_encontrar_e_capturar_super_ball_1_em
    },
    ultra: {
      pct: captureBoost ? r.captura_ultra_ball_com_capture_boost_pct : r.captura_ultra_ball_pct,
      derrotas: r.captura_ultra_ball_derrotas_media,
      shiny: r.shiny_encontrar_e_capturar_ultra_ball_1_em
    },
    beast: {
      pct: captureBoost ? r.captura_beast_ball_com_capture_boost_pct : r.captura_beast_ball_pct,
      derrotas: r.captura_beast_ball_derrotas_media,
      shiny: r.shiny_encontrar_e_capturar_beast_ball_1_em
    }
  };
  return map[ballKey] || map.poke;
}

function getFilteredPokemon() {
  return pokemon.filter(r => {
    if (dexState.search) {
      const q = dexState.search.toLowerCase();
      const mName = r.nome && r.nome.toLowerCase().includes(q);
      const mDex = r.dex && String(r.dex).includes(q);
      if (!mName && !mDex) return false;
    }
    if (dexState.tipo1 && (!r.tipos || !r.tipos.includes(dexState.tipo1))) return false;
    if (dexState.tipo2 && (!r.tipos || !r.tipos.includes(dexState.tipo2))) return false;
    if (dexState.regiao && r.regiao !== dexState.regiao) return false;
    if (dexState.apenasShiny && r.tem_forma_shiny !== 'sim') return false;
    return true;
  });
}

function table(mode = 'shiny') {
  let heads = [];
  let body = [];
  const list = getFilteredPokemon();
  if (mode === 'shiny') {
    heads = ['#ID','POKÉMON','TIPOS','HUNT','% CAPTURA','DERROTAS (MÉDIA)','SHINY (1 EM)','AÇÕES'];
    body = list.map(r => {
      const bData = getBallData(r, dexState.ball, dexState.captureBoost);
      return `<tr><td class="rank">${r.dex}</td><td>${mon(r)}</td><td><span class="type-row">${r.tipos.map(type).join('')}</span></td><td>${cleanHunt(r)}</td><td class="stat-positive">${bData.pct ? bData.pct + '%' : '—'}<i class="meter"></i></td><td>${bData.derrotas || '—'}</td><td>${bData.shiny ? '1 em ' + formatNum(bData.shiny) : (r.shiny_1_em ? '1 em ' + formatNum(r.shiny_1_em) : '—')}</td><td><button class="detail">Detalhes</button></td></tr>`;
    });
  } else if (mode === 'hunt') {
    heads = ['#ID','POKÉMON','TIPOS','HUNT','FRAQUEZA','RESISTÊNCIA','DEF','SP.DEF','HP','XP','AÇÕES'];
    body = list.map(r => `<tr><td class="rank">${r.dex}</td><td>${mon(r)}</td><td><span class="type-row">${r.tipos.map(type).join('')}</span></td><td>${cleanHunt(r)}</td><td>${r.fraco_contra || '—'}</td><td>${r.resiste_a || '—'}</td><td>${r.def || '—'}</td><td>${r.spdef || '—'}</td><td>${r.hp || '—'}</td><td class="stat-green">${r.xp_por_derrota || '—'}</td><td><button class="detail">Detalhes</button></td></tr>`);
  } else if (mode === 'loot') {
    heads = ['#ID','POKÉMON','TIPOS','HUNT','GOLD NPC','DROPS & CHANCES','AÇÕES'];
    body = list.map(r => `<tr><td class="rank">${r.dex}</td><td>${mon(r)}</td><td><span class="type-row">${r.tipos.map(type).join('')}</span></td><td>${cleanHunt(r)}</td><td class="stat-gold">${r.ouro_por_derrota ? r.ouro_por_derrota + ' Gold' : '—'}</td><td>${r.drops || '—'}</td><td><button class="detail">Detalhes</button></td></tr>`);
  } else {
    heads = ['#ID','POKÉMON','TIPOS','HUNT','BST TOTAL','HP','ATK','DEF','SP.ATK','SP.DEF','SPEED','ESTÁGIO','EVOLUÇÃO','AÇÕES'];
    body = list.map(r => `<tr><td class="rank">${r.dex}</td><td>${mon(r)}</td><td><span class="type-row">${r.tipos.map(type).join('')}</span></td><td>${cleanHunt(r)}</td><td class="stat-positive">${r.total_stats || '—'}</td><td>${r.hp || '—'}</td><td>${r.atk || '—'}</td><td>${r.def || '—'}</td><td>${r.spatk || '—'}</td><td>${r.spdef || '—'}</td><td>${r.spd || '—'}</td><td><span class="badge update">Estágio ${r.estagio_evolutivo || 1}</span></td><td>${r.evolui_para ? '→ ' + r.evolui_para : 'Não evolui'}</td><td><button class="detail">Detalhes</button></td></tr>`);
  }
  return `<div class="data-panel"><table class="data-table"><thead><tr>${heads.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`;
}

function filterBar(mode) {
  if (mode !== 'shiny') return `<div class="filters">${filters[mode].map(control).join('')}</div>`;

  const typeOptions = `
    <option value="">Tipo</option>
    <option value="NORMAL">Normal</option>
    <option value="FIRE">Fire</option>
    <option value="WATER">Water</option>
    <option value="GRASS">Grass</option>
    <option value="ELECTRIC">Electric</option>
    <option value="ICE">Ice</option>
    <option value="FIGHTING">Fighting</option>
    <option value="POISON">Poison</option>
    <option value="GROUND">Ground</option>
    <option value="FLYING">Flying</option>
    <option value="PSYCHIC">Psychic</option>
    <option value="BUG">Bug</option>
    <option value="ROCK">Rock</option>
    <option value="GHOST">Ghost</option>
    <option value="DRAGON">Dragon</option>
    <option value="STEEL">Steel</option>
    <option value="DARK">Dark</option>
    <option value="FAIRY">Fairy</option>
  `;

  const regionOptions = `
    <option value="">Região</option>
    <option value="Kanto">Kanto</option>
    <option value="Johto">Johto</option>
    <option value="Hoenn">Hoenn</option>
    <option value="Sinnoh">Sinnoh</option>
    <option value="Unova">Unova</option>
    <option value="Kalos">Kalos</option>
    <option value="Alola">Alola</option>
    <option value="Galar">Galar</option>
    <option value="Outland">Outland</option>
  `;

  return `<div class="filter-groups">
    <div class="filter-group filter-basics">
      <input class="control search-field" id="dex-search" placeholder="⌕ Buscar Pokémon..." value="${dexState.search}">
      <select class="control dropdown" id="dex-tipo1">${typeOptions}</select>
      <select class="control dropdown" id="dex-tipo2">${typeOptions}</select>
      <select class="control dropdown" id="dex-regiao">${regionOptions}</select>
      <button class="control dropdown ${dexState.apenasShiny ? 'selected' : ''}" id="dex-apenas-shiny">Apenas Shiny <span class="caret">⌄</span></button>
    </div>
    <div class="filter-group ball-group">
      <span class="group-label">POKÉBOLA</span>
      <button class="control ball ${dexState.ball === 'poke' ? 'selected' : ''}" data-ball="poke">Poké Ball (x1)</button>
      <button class="control ball ${dexState.ball === 'great' ? 'selected' : ''}" data-ball="great">Great Ball</button>
      <button class="control ball ${dexState.ball === 'super' ? 'selected' : ''}" data-ball="super">Super Ball</button>
      <button class="control ball ${dexState.ball === 'ultra' ? 'selected' : ''}" data-ball="ultra">Ultra Ball</button>
      <button class="control ball ${dexState.ball === 'beast' ? 'selected' : ''}" data-ball="beast">Beast Ball</button>
    </div>
    <div class="filter-group boost-options">
      <span class="group-label">BOOSTS ATIVOS</span>
      <button class="control check ${dexState.captureBoost ? 'selected' : ''}" id="dex-boost-capture">Capture Boost</button>
      <button class="control check ${dexState.shinyLure ? 'selected' : ''}" id="dex-boost-lure">Shiny Lure</button>
    </div>
  </div>`;
}

function pokedex(mode='shiny'){return `<div class="tabbar" id="dex-tabs"><button class="${mode==='shiny'?'active':''}" data-mode="shiny">Captura e Shiny</button><button class="${mode==='hunt'?'active':''}" data-mode="hunt">Hunting</button><button class="${mode==='loot'?'active':''}" data-mode="loot">Gold e Loot</button><button class="${mode==='strong'?'active':''}" data-mode="strong">Pokémons Fortes</button></div>${filterBar(mode)}${table(mode)}`}
function home(){const quick=[['Iniciante?','Veja nosso guia para entender tudo sobre o jogo.','Comece aqui','guides'],['Captura de Shiny','Entenda a dificuldade de captura de cada espécie.','Ver Pokédex','pokedex'],['Calculadora de XP','Veja o tempo para o próximo nível.','Calcular agora','xp'],['Wiki','Todas as informações do jogo em um só lugar.','Explorar','wiki']];return `<section class="home-wire"><section class="section-card home-banner"><div class="banner-image"><span>Imagem promocional do jogo</span></div><div class="banner-cta"><h1>Jogue agora</h1><p>Acesse o PokéIdle e comece sua jornada.</p><button class="primary">Jogue agora</button></div></section><div class="wire-quick-grid">${quick.map(x=>`<article class="section-card wire-quick"><h2>${x[0]}</h2><p>${x[1]}</p><div class="wire-image">Imagem</div><button class="secondary" data-go="${x[3]}">${x[2]}</button></article>`).join('')}</div><div class="wire-bottom"><article class="section-card wire-wide"><div><h2>Tier List <span class="badge new">Novo</span></h2><p>Crie tier lists dos seus Pokémon favoritos e compartilhe com amigos!</p><button class="secondary" data-go="tier">Criar agora</button></div><div class="wide-image">Imagem</div></article><article class="section-card wire-wide"><div><h2>Entre na comunidade</h2><p>Troque dicas, encontre players, negocie e fique por dentro de todas as novidades.</p><button class="secondary">Entrar no Discord</button></div><div class="wide-image">Imagem</div></article></div></section>`}
function tier(){const tiers=[['fav','FAVS','MEUS FAVORITOS',3],['ideal','TIME IDEAL','ENDGAME',4],['current','TIME ATUAL','EM USO AGORA',3],['farm','BONS DE FARM','CUSTO-BENEFÍCIO',3],['over','SUPERESTIMADOS','NA REAL, MEH',1],['hate','ODEIO','NUNCA MAIS',2]];return `<div class="split-top"><div class="tier-toolbar"><span class="eyebrow">Tier List ›</span><input class="tier-name" value="Melhores da minha conta" aria-label="Nome da tier list"></div><div class="tier-toolbar"><span class="segmented"><button>Ver</button><button class="active">Editar</button></span><button class="share">⌘ Compartilhar</button></div></div><div class="tier-layout"><div>${tiers.map(t=>`<section class="tier-row"><div class="tier-label ${t[0]}"><b>${t[1]}</b><small>${t[2]}</small></div><div class="tier-drop">${Array.from({length:t[3]},()=>'<i class="slot"></i>').join('')}</div></section>`).join('')}</div><aside class="section-card toolbox"><h3>□ Toolbox</h3><div class="toolbox-actions"><button class="primary">+ Nova Linha</button><button class="secondary">Limpar Tudo</button></div><input class="toolbox-search" placeholder="⌕  Buscar Pokémon..."><div class="tool-tabs"><span class="on">Todos</span><span>Tipos</span><span>Regiões</span></div><div class="tool-grid">${'<i></i>'.repeat(8)}</div></aside></div>`}

function xpTotal(level) {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  if (L <= 1) return 0;
  return Math.round((50 / 3) * (Math.pow(L, 3) - 6 * Math.pow(L, 2) + 17 * L - 12));
}

function xpCustoNivel(level) {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  return xpTotal(L + 1) - xpTotal(L);
}

function deltaXp(lvlFrom, lvlTo) {
  return Math.max(0, xpTotal(lvlTo) - xpTotal(lvlFrom));
}

function xpBaseDoNivel(huntLevel) {
  const n = Math.max(1, Math.floor(Number(huntLevel) || 1));
  if (n <= 150) {
    return Math.floor((6 * n * n) / 10) + 8;
  }
  return Math.round(13500 * Math.pow(n / 150, 1.25));
}

function calcularMultiplicadorXp({ vip = false, xpBoost = false, guildBonusPct = 0, eventBonusPct = 0 }) {
  let mult = 1.0;
  if (vip) mult *= 1.5;
  if (xpBoost) mult *= 1.5;
  mult *= (1 + Math.max(0, Math.min(10, Number(guildBonusPct) || 0)) / 100);
  if (Number(eventBonusPct) > 0) mult *= (1 + Number(eventBonusPct) / 100);
  return mult;
}

function formatarTempo(segundos) {
  if (!segundos || segundos <= 0 || !Number.isFinite(segundos)) return '0s';
  const totalSeg = Math.round(segundos);
  const dias = Math.floor(totalSeg / 86400);
  const horas = Math.floor((totalSeg % 86400) / 3600);
  const mins = Math.floor((totalSeg % 3600) / 60);
  const segs = totalSeg % 60;
  if (dias > 0) return `${dias}d ${horas}h ${mins}m`;
  if (horas > 0) return `${horas}h ${mins}m ${segs}s`;
  if (mins > 0) return `${mins}m ${segs}s`;
  return `${segs}s`;
}

function calcXpState(state = {}) {
  const lvlFrom = Number(state.lvlFrom) || 500;
  const lvlTo = Number(state.lvlTo) || 1000;
  const huntLvl = Number(state.huntLvl) || 500;
  const speed = Number(state.speed) || 1670;
  const vip = Boolean(state.vip);
  const xpBoost = Boolean(state.xpBoost);
  const guild = Number(state.guild) || 0;
  const event = Number(state.event) || 0;

  const totalXp = deltaXp(lvlFrom, lvlTo);
  const mult = calcularMultiplicadorXp({ vip, xpBoost, guildBonusPct: guild, eventBonusPct: event });
  const xpBase = xpBaseDoNivel(huntLvl);
  const xpEfetivo = Math.max(1, Math.round(xpBase * mult));
  const abates = Math.ceil(totalXp / xpEfetivo);
  const tempoSeg = (abates / speed) * 3600;

  const limit = Math.min(lvlFrom + 20, lvlTo);
  let rowsHtml = '';
  let acumXp = 0;
  for (let l = lvlFrom; l < limit; l++) {
    const c = xpCustoNivel(l);
    acumXp += c;
    const kNivel = Math.ceil(c / xpEfetivo);
    const kAcum = Math.ceil(acumXp / xpEfetivo);
    const tNivel = formatarTempo((kNivel / speed) * 3600);
    const tAcum = formatarTempo((kAcum / speed) * 3600);
    rowsHtml += `<tr><td>${l}</td><td class="stat-positive">${c.toLocaleString('pt-BR')}</td><td class="stat-gold">~${kNivel.toLocaleString('pt-BR')}</td><td>${tNivel}</td><td>${tAcum}</td></tr>`;
  }

  return {
    totalXp,
    mult,
    xpEfetivo,
    abates,
    tempoStr: formatarTempo(tempoSeg),
    rowsHtml
  };
}

function xp() {
  const res = calcXpState({ lvlFrom: 500, lvlTo: 1000, huntLvl: 500, speed: 1670, vip: false, xpBoost: false, guild: 5, event: 0 });
  return `<p class="eyebrow">Ferramentas › Calculadora de XP</p><h1 style="margin:2px 0 12px">Calculadora de XP</h1><div class="xp-layout"><div>${panel(`<h3>PARÂMETROS DE TREINO DO TREINADOR</h3><div class="form-grid"><div class="field"><label>Nível atual</label><input id="xp-in-from" value="500"></div><div class="field"><label>Nível alvo</label><input id="xp-in-to" value="1000"></div><div class="field"><label>Nível da Hunt</label><input id="xp-in-hunt" value="500"></div><div class="field"><label>Abates/h</label><input id="xp-in-speed" value="1670"></div></div><h3 style="margin-top:18px">BÔNUS & MULTIPLICADORES ATIVOS</h3><div class="toggle-line"><label style="cursor:pointer;display:flex;align-items:center;gap:8px;"><input type="checkbox" id="xp-ck-vip"> Assinatura VIP (+50% XP)</label></div><div class="toggle-line"><label style="cursor:pointer;display:flex;align-items:center;gap:8px;"><input type="checkbox" id="xp-ck-boost"> XP Boost (+50% XP)</label></div><div class="form-grid"><div class="field"><label>Bônus de Guild (%)</label><input id="xp-in-guild" value="5"></div><div class="field"><label>Bônus de Evento (%)</label><input id="xp-in-event" value="0"></div></div><button id="xp-btn-calc" class="primary" style="width:100%;margin-top:12px;">Calcular XP</button>`,'form-card')}</div><div><div class="metrics"><article class="metric"><b id="xp-out-total">${res.totalXp.toLocaleString('pt-BR')}</b><small>XP TOTAL NECESSÁRIO</small></article><article class="metric"><b id="xp-out-tempo">${res.tempoStr}</b><small>TEMPO TOTAL ESTIMADO</small></article><article class="metric yellow"><b id="xp-out-abates">~${res.abates.toLocaleString('pt-BR')}</b><small>ABATES NECESSÁRIOS</small></article><article class="metric yellow"><b id="xp-out-efetivo">~${res.xpEfetivo.toLocaleString('pt-BR')} XP</b><small>XP MÉDIO / KILL</small></article></div><p class="note">Calculado usando as fórmulas oficiais do jogo — o XP de todas as hunts do PokéIdle está mapeado nesta ferramenta.</p><div class="data-panel"><table class="data-table"><thead><tr><th>NÍVEL</th><th>XP DO PRÓXIMO NÍVEL</th><th>ABATES NECESSÁRIOS</th><th>TEMPO DESSE NÍVEL</th><th>TEMPO ACUMULADO</th></tr></thead><tbody id="xp-out-rows">${res.rowsHtml}</tbody></table></div></div></div>`;
}

function attachXpListeners() {
  const getVal = id => document.getElementById(id)?.value;
  const getCk = id => document.getElementById(id)?.checked;
  const recalc = () => {
    const s = calcXpState({
      lvlFrom: getVal('xp-in-from'),
      lvlTo: getVal('xp-in-to'),
      huntLvl: getVal('xp-in-hunt'),
      speed: getVal('xp-in-speed'),
      vip: getCk('xp-ck-vip'),
      xpBoost: getCk('xp-ck-boost'),
      guild: getVal('xp-in-guild'),
      event: getVal('xp-in-event')
    });
    if (document.getElementById('xp-out-total')) document.getElementById('xp-out-total').textContent = s.totalXp.toLocaleString('pt-BR');
    if (document.getElementById('xp-out-tempo')) document.getElementById('xp-out-tempo').textContent = s.tempoStr;
    if (document.getElementById('xp-out-abates')) document.getElementById('xp-out-abates').textContent = '~' + s.abates.toLocaleString('pt-BR');
    if (document.getElementById('xp-out-efetivo')) document.getElementById('xp-out-efetivo').textContent = '~' + s.xpEfetivo.toLocaleString('pt-BR') + ' XP';
    if (document.getElementById('xp-out-rows')) document.getElementById('xp-out-rows').innerHTML = s.rowsHtml;
  };
  ['xp-in-from','xp-in-to','xp-in-hunt','xp-in-speed','xp-in-guild','xp-in-event'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', recalc);
  });
  ['xp-ck-vip','xp-ck-boost'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', recalc);
  });
  document.getElementById('xp-btn-calc')?.addEventListener('click', recalc);
}

function guides(){return `<div class="split-top"><div><p class="eyebrow">Aprender › Guias</p><h1>Guias da comunidade</h1><p style="color:#a5a9b2;font-size:12px">Passo a passo escrito por jogadores, do início ao endgame.</p></div><span class="eyebrow">42 guias publicados</span></div><section class="guides-feature"><div><span class="badge">Destaque da semana</span><h2>Rota otimizada pós-500: o guia definitivo de farm</h2><p>Como migrar de hunt na hora certa e cortar dias do seu grind até o nível 1000.</p></div></section><div class="chips"><button class="chip active">Todos</button><button class="chip">Iniciante</button><button class="chip">Intermediário</button><button class="chip">Avançado</button><button class="chip">Evento</button></div><div class="guide-grid">${names.map((n,i)=>`<article class="guide-card"><span class="badge ${i%3===1?'update':''}">${i%2?'Intermediário':'Iniciante'}</span><h3>${n}</h3><small><span>${4+i} min</span><span>${i+2} dias atrás</span></small></article>`).join('')}</div>`}
function wiki(){return `<div class="wiki-layout"><aside class="wiki-rail"><strong>BUSCAR</strong><input placeholder="⌕  Buscar na wiki..."><strong>MECÂNICAS DO IDLE</strong><button class="active">▣ Como funciona o Idle</button><button>□ Sistema de progresso offline</button><strong>SISTEMA DE XP</strong><button>□ Guia de XP e Evolução</button><button>□ Bônus e multiplicadores</button><strong>POKÉDEX</strong><button>□ Shinies e formas especiais</button><button>□ Mecânicas de captura</button><strong>ITENS</strong><button>□ TM's e habilidades</button><button>□ Fragmentos e refino</button></aside><article class="article"><p class="crumb">Wiki › Mecânicas do Idle › <b>Como funciona o Idle</b></p><h1>Como funciona o Idle <span class="badge update">Mecânicas</span></h1><p class="meta">Atualizado há 2 dias · editado por 4 colaboradores</p><div class="article-visual"></div><p>O PokéIdle continua gerando progresso mesmo com o jogo fechado. Seus Pokémon em campo acumulam XP, itens e moedas com base no tempo offline, até um teto de 8 horas sem boosts ativos.</p><h2>Como maximizar o ganho offline</h2><ul><li>Deixe Pokémon de tier alto em rotas de XP antes de fechar o app.</li><li>Ative um XP Boost antes de sair para dobrar o acúmulo.</li><li>Colete assim que voltar — o teto de 8h não acumula além disso.</li></ul><aside class="callout">💡 Dica: a Assinatura VIP aumenta o teto de acúmulo offline para 12 horas.</aside><h2>O que conta como progresso offline</h2><p>XP de treinador, XP dos Pokémon em campo, gold de NPCs derrotados e chances de drop de itens comuns. Shiny odds e drops raros não são calculados durante o tempo offline.</p></article></div>`}
function admin(){const assets=['Hero da Home','Card “Jogue Agora”','Destaque da Wiki','Guia em Destaque','Promo App Mobile','Card “Entre na Comunidade”'];return `<h1>Painel Administrativo</h1><p style="margin:3px 0 14px;color:#a6abb4;font-size:12px">Edite imagens, atualize a wiki e poste novidades — tudo sem mexer em código.</p><div class="admin-layout"><aside class="section-card module-nav"><button class="active">▧ Imagens do Site<small>Hero, cards e banners</small></button><button>▤ Guias<small>42 publicados · 3 rascunhos</small></button><button>▯ Wiki<small>128 artigos</small></button><button>⌁ Atualizações<small>Feed da Home</small></button><p>Você é <b>Moderador</b> — pode editar Guias, Wiki e Imagens.</p></aside><section class="section-card admin-content"><header><div><h2>Imagens do Site</h2><p>Troque qualquer imagem usada no portal — sem precisar editar código.</p></div><button class="primary">+ Enviar Imagem</button></header><div class="asset-grid">${assets.map(a=>`<article class="asset"><div class="asset-preview"></div><b>${a}</b><small>Imagem do portal</small><div class="asset-actions"><button class="secondary">Trocar</button><button class="secondary danger">Remover</button></div></article>`).join('')}</div></section></div>`}
function attachDexListeners(mode) {
  document.querySelectorAll('#dex-tabs button').forEach(b=>b.addEventListener('click',()=>location.hash=`pokedex/${b.dataset.mode}`));

  const updateTable = () => {
    const dataPanel = document.querySelector('.data-panel');
    if (dataPanel) {
      dataPanel.outerHTML = table(mode);
    }
  };

  const searchIn = document.getElementById('dex-search');
  if (searchIn) {
    searchIn.addEventListener('input', e => {
      dexState.search = e.target.value;
      updateTable();
    });
  }

  const t1 = document.getElementById('dex-tipo1');
  if (t1) {
    t1.value = dexState.tipo1;
    t1.addEventListener('change', e => {
      dexState.tipo1 = e.target.value;
      updateTable();
    });
  }

  const t2 = document.getElementById('dex-tipo2');
  if (t2) {
    t2.value = dexState.tipo2;
    t2.addEventListener('change', e => {
      dexState.tipo2 = e.target.value;
      updateTable();
    });
  }

  const reg = document.getElementById('dex-regiao');
  if (reg) {
    reg.value = dexState.regiao;
    reg.addEventListener('change', e => {
      dexState.regiao = e.target.value;
      updateTable();
    });
  }

  const shinyBtn = document.getElementById('dex-apenas-shiny');
  if (shinyBtn) {
    shinyBtn.addEventListener('click', () => {
      dexState.apenasShiny = !dexState.apenasShiny;
      shinyBtn.classList.toggle('selected', dexState.apenasShiny);
      updateTable();
    });
  }

  document.querySelectorAll('.ball-group button[data-ball]').forEach(btn => {
    btn.addEventListener('click', () => {
      dexState.ball = btn.dataset.ball;
      document.querySelectorAll('.ball-group button[data-ball]').forEach(b => b.classList.toggle('selected', b.dataset.ball === dexState.ball));
      updateTable();
    });
  });

  const capBoostBtn = document.getElementById('dex-boost-capture');
  if (capBoostBtn) {
    capBoostBtn.addEventListener('click', () => {
      dexState.captureBoost = !dexState.captureBoost;
      capBoostBtn.classList.toggle('selected', dexState.captureBoost);
      updateTable();
    });
  }

  const lureBtn = document.getElementById('dex-boost-lure');
  if (lureBtn) {
    lureBtn.addEventListener('click', () => {
      dexState.shinyLure = !dexState.shinyLure;
      lureBtn.classList.toggle('selected', dexState.shinyLure);
      updateTable();
    });
  }
}

const views={home,pokedex,tier,xp,guides,wiki,admin};
function render(){
  const route=(location.hash.slice(1)||'home').split('/'),
        view=views[route[0]]?route[0]:'home';
  if(view==='pokedex' && pokemon.length===0){
    loadPokemonData().then(()=>{render();});
    return;
  }
  app.innerHTML=views[view](route[1]||'shiny');
  document.querySelectorAll('[data-route]').forEach(a=>a.classList.toggle('active',a.dataset.route===view));
  document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>location.hash=b.dataset.go));
  if(view==='pokedex'){
    attachDexListeners(route[1]||'shiny');
  }
  if(view==='xp'){
    attachXpListeners();
  }
  window.scrollTo(0,0);
}
window.addEventListener('hashchange',render);
render();
