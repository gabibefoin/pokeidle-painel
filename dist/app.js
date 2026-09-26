const app = document.querySelector('#app');
let pokemon = [];
let hunts = [];
window.pokemon = pokemon;

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

// Load JSON datasets from data/
async function loadPokemonData() {
  try {
    const [pokedexRes, huntsRes] = await Promise.all([
      fetch('data/pokedex_portal.json'),
      fetch('data/hunts_portal.json')
    ]);
    const data = await pokedexRes.json();
    hunts = await huntsRes.json();
    
    // Process types and fields
    data.forEach(p => {
      p.tipos = [p.tipo1, p.tipo2].filter(Boolean);
    });

    pokemon.push(...data);
    console.log('PokéIdle Painel — Dados carregados:', pokemon.length, 'Pokémon');
  } catch (err) {
    console.error('Erro ao carregar dados:', err);
  }
}

// Formatters
const mon = p => `<div class="monster"><i class="monster-icon"></i>${p.nome}</div>`;
const type = x => `<span class="type ${x ? x.toLowerCase() : ''}">${x}</span>`;
const panel = (x, c = '') => `<section class="section-card ${c}">${x}</section>`;

function formatNum(n) {
  if (n === undefined || n === null || n === '') return '—';
  const num = Number(n);
  if (isNaN(num)) return n;
  return num.toLocaleString('pt-BR');
}

function cleanHunt(r) {
  if (!r.is_cacavel && r.aparece_em_hunt !== 'sim') return 'Sem hunt';
  const reg = r.regiao || 'Kanto';
  const lvl = r.nivel_hunt_min || r.nivel_ao_capturar || 20;
  return `${reg}, Nv ${lvl}`;
}

function getBallData(r, ballKey, captureBoost, shinyLure) {
  let catchPctStr = '';
  if (captureBoost) {
    if (ballKey === 'poke') catchPctStr = r.captura_pok_ball_com_capture_boost_pct;
    else if (ballKey === 'great') catchPctStr = r.captura_great_ball_com_capture_boost_pct;
    else if (ballKey === 'super') catchPctStr = r.captura_super_ball_com_capture_boost_pct;
    else if (ballKey === 'ultra') catchPctStr = r.captura_ultra_ball_com_capture_boost_pct;
    else if (ballKey === 'beast') catchPctStr = r.captura_beast_ball_com_capture_boost_pct;
  } else {
    if (ballKey === 'poke') catchPctStr = r.captura_pok_ball_pct;
    else if (ballKey === 'great') catchPctStr = r.captura_great_ball_pct;
    else if (ballKey === 'super') catchPctStr = r.captura_super_ball_pct;
    else if (ballKey === 'ultra') catchPctStr = r.captura_ultra_ball_pct;
    else if (ballKey === 'beast') catchPctStr = r.captura_beast_ball_pct;
  }

  let baseDerrotas = 0;
  if (ballKey === 'poke') baseDerrotas = parseInt(r.captura_pok_ball_derrotas_media, 10) || 0;
  else if (ballKey === 'great') baseDerrotas = parseInt(r.captura_great_ball_derrotas_media, 10) || 0;
  else if (ballKey === 'super') baseDerrotas = parseInt(r.captura_super_ball_derrotas_media, 10) || 0;
  else if (ballKey === 'ultra') baseDerrotas = parseInt(r.captura_ultra_ball_derrotas_media, 10) || 0;
  else if (ballKey === 'beast') baseDerrotas = parseInt(r.captura_beast_ball_derrotas_media, 10) || 0;

  const catchKillsNum = (captureBoost && baseDerrotas > 0) ? Math.max(1, Math.ceil(baseDerrotas / 2)) : baseDerrotas;

  let baseShinyCatch = 0;
  if (r.tem_forma_shiny === 'sim') {
    if (ballKey === 'poke') baseShinyCatch = parseInt(r.shiny_encontrar_e_capturar_pok_ball_1_em, 10) || 0;
    else if (ballKey === 'great') baseShinyCatch = parseInt(r.shiny_encontrar_e_capturar_great_ball_1_em, 10) || 0;
    else if (ballKey === 'super') baseShinyCatch = parseInt(r.shiny_encontrar_e_capturar_super_ball_1_em, 10) || 0;
    else if (ballKey === 'ultra') baseShinyCatch = parseInt(r.shiny_encontrar_e_capturar_ultra_ball_1_em, 10) || 0;
    else if (ballKey === 'beast') baseShinyCatch = parseInt(r.shiny_encontrar_e_capturar_beast_ball_1_em, 10) || 0;

    let divisor = 1;
    if (shinyLure) divisor *= 2;
    if (captureBoost) divisor *= 2;
    baseShinyCatch = Math.max(1, Math.round(baseShinyCatch / divisor));
  }

  let formattedPct = '—';
  if (catchPctStr) {
    const numPct = parseFloat(String(catchPctStr).replace(',', '.'));
    if (!isNaN(numPct)) {
      formattedPct = numPct.toFixed(2).replace('.', ',') + '%';
    }
  }

  return {
    pct: formattedPct,
    derrotas: catchKillsNum > 0 ? catchKillsNum.toLocaleString('pt-BR') : '—',
    shiny: baseShinyCatch > 0 ? baseShinyCatch : null
  };
}

function getFilteredPokemon() {
  return pokemon.filter(r => {
    if (dexState.search) {
      const q = dexState.search.toLowerCase().trim();
      const mName = r.nome && r.nome.toLowerCase().includes(q);
      const mDex = r.dex && String(r.dex).includes(q);
      if (!mName && !mDex) return false;
    }
    if (dexState.tipo1 && (!r.tipos || !r.tipos.map(t=>t.toUpperCase()).includes(dexState.tipo1.toUpperCase()))) return false;
    if (dexState.tipo2 && (!r.tipos || !r.tipos.map(t=>t.toUpperCase()).includes(dexState.tipo2.toUpperCase()))) return false;
    if (dexState.regiao && r.regiao && r.regiao.toLowerCase() !== dexState.regiao.toLowerCase()) return false;
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
      const bData = getBallData(r, dexState.ball, dexState.captureBoost, dexState.shinyLure);
      return `<tr><td class="rank">${r.dex}</td><td>${mon(r)}</td><td><span class="type-row">${(r.tipos || []).map(type).join('')}</span></td><td>${cleanHunt(r)}</td><td class="stat-positive">${bData.pct}<i class="meter"></i></td><td>${bData.derrotas}</td><td>${bData.shiny ? '1 em ' + formatNum(bData.shiny) : '—'}</td><td><button class="detail" onclick="openDetailsModal('${r.dex}')">Detalhes</button></td></tr>`;
    });
  } else if (mode === 'hunt') {
    heads = ['#ID','POKÉMON','TIPOS','HUNT','FRAQUEZA','RESISTÊNCIA','DEF','SP.DEF','HP','XP','AÇÕES'];
    body = list.map(r => `<tr><td class="rank">${r.dex}</td><td>${mon(r)}</td><td><span class="type-row">${(r.tipos || []).map(type).join('')}</span></td><td>${cleanHunt(r)}</td><td>${(r.f2_types || []).join(', ') || r.fraco_contra || '—'}</td><td>${(r.r05_types || []).join(', ') || r.resiste_a || '—'}</td><td>${r.def || '—'}</td><td>${r.spdef || '—'}</td><td>${r.hp || '—'}</td><td class="stat-green">${formatNum(r.xp_base || r.xp_por_derrota)}</td><td><button class="detail" onclick="openDetailsModal('${r.dex}')">Detalhes</button></td></tr>`);
  } else if (mode === 'loot') {
    heads = ['#ID','POKÉMON','TIPOS','HUNT','GOLD NPC','DROPS & CHANCES','AÇÕES'];
    body = list.map(r => `<tr><td class="rank">${r.dex}</td><td>${mon(r)}</td><td><span class="type-row">${(r.tipos || []).map(type).join('')}</span></td><td>${cleanHunt(r)}</td><td class="stat-gold">${(r.gold_num || r.ouro_por_derrota) ? formatNum(r.gold_num || r.ouro_por_derrota) + ' Gold' : '—'}</td><td>${(r.drops_parsed || []).map(d => `${d.name} ${d.pct}%`).join(' | ') || r.drops || '—'}</td><td><button class="detail" onclick="openDetailsModal('${r.dex}')">Detalhes</button></td></tr>`);
  } else {
    heads = ['#ID','POKÉMON','TIPOS','HUNT','BST TOTAL','HP','ATK','DEF','SP.ATK','SP.DEF','SPEED','ESTÁGIO','EVOLUÇÃO','AÇÕES'];
    body = list.map(r => `<tr><td class="rank">${r.dex}</td><td>${mon(r)}</td><td><span class="type-row">${(r.tipos || []).map(type).join('')}</span></td><td>${cleanHunt(r)}</td><td class="stat-positive">${r.bst_num || r.total_stats || '—'}</td><td>${r.hp || '—'}</td><td>${r.atk || '—'}</td><td>${r.def || '—'}</td><td>${r.spatk || '—'}</td><td>${r.spdef || '—'}</td><td>${r.spd || '—'}</td><td><span class="badge update">Estágio ${r.estagio_num || r.estagio_evolutivo || 1}</span></td><td>${r.evolui_para ? '→ ' + r.evolui_para : 'Não evolui'}</td><td><button class="detail" onclick="openDetailsModal('${r.dex}')">Detalhes</button></td></tr>`);
  }
  return `<div class="data-panel"><table class="data-table"><thead><tr>${heads.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`;
}

function filterBar(mode) {
  const typeOptions = `
    <option value="">Tipo</option>
    <option value="BUG">Bug</option>
    <option value="POISON">Poison</option>
    <option value="NORMAL">Normal</option>
    <option value="FLYING">Flying</option>
    <option value="GRASS">Grass</option>
    <option value="WATER">Water</option>
    <option value="FIRE">Fire</option>
    <option value="ELECTRIC">Electric</option>
    <option value="GROUND">Ground</option>
    <option value="PSYCHIC">Psychic</option>
    <option value="ROCK">Rock</option>
    <option value="ICE">Ice</option>
    <option value="FIGHTING">Fighting</option>
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
    <option value="Paldea">Paldea</option>
  `;

  return `<div class="filter-groups">
    <div class="filter-group filter-basics">
      <input class="control search-field" id="dex-search" placeholder="⌕ Buscar Pokémon..." value="${dexState.search}">
      <select class="control dropdown" id="dex-tipo1">${typeOptions}</select>
      <select class="control dropdown" id="dex-tipo2">${typeOptions}</select>
      <select class="control dropdown" id="dex-regiao">${regionOptions}</select>
      <button class="control ${dexState.apenasShiny ? 'selected' : ''}" id="dex-apenas-shiny">Apenas Shiny</button>
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

function pokedex(mode = 'shiny') {
  return `<div class="tabbar" id="dex-tabs">
    <button class="${mode === 'shiny' ? 'active' : ''}" data-mode="shiny">Captura e Shiny</button>
    <button class="${mode === 'hunt' ? 'active' : ''}" data-mode="hunt">Hunting</button>
    <button class="${mode === 'loot' ? 'active' : ''}" data-mode="loot">Gold e Loot</button>
    <button class="${mode === 'strong' ? 'active' : ''}" data-mode="strong">Pokémons Fortes</button>
  </div>${filterBar(mode)}${table(mode)}`;
}

function home() {
  const quick = [
    ['Iniciante?', 'Veja nosso guia para entender tudo sobre o jogo.', 'Comece aqui', 'guides'],
    ['Captura de Shiny', 'Entenda a dificuldade de captura de cada espécie.', 'Ver Pokédex', 'pokedex'],
    ['Calculadora de XP', 'Veja o tempo para o próximo nível.', 'Calcular agora', 'xp'],
    ['Wiki', 'Todas as informações do jogo em um só lugar.', 'Explorar', 'wiki']
  ];
  return `<section class="home-wire">
    <section class="section-card home-banner">
      <div class="banner-image"><span>Imagem promocional do jogo</span></div>
      <div class="banner-cta">
        <h1>Jogue agora</h1>
        <p>Acesse o PokéIdle e comece sua jornada.</p>
        <button class="primary">Jogue agora</button>
      </div>
    </section>
    <div class="wire-quick-grid">
      ${quick.map(x => `
        <article class="section-card wire-quick">
          <h2>${x[0]}</h2>
          <p>${x[1]}</p>
          <div class="wire-image">Imagem</div>
          <button class="secondary" data-go="${x[3]}">${x[2]}</button>
        </article>
      `).join('')}
    </div>
    <div class="wire-bottom">
      <article class="section-card wire-wide">
        <div>
          <h2>Tier List <span class="badge new">Novo</span></h2>
          <p>Crie tier lists dos seus Pokémon favoritos e compartilhe com amigos!</p>
          <button class="secondary" data-go="tier">Criar agora</button>
        </div>
        <div class="wide-image">Imagem</div>
      </article>
      <article class="section-card wire-wide">
        <div>
          <h2>Entre na comunidade</h2>
          <p>Troque dicas, encontre players, negocie e fique por dentro de todas as novidades.</p>
          <button class="secondary">Entrar no Discord</button>
        </div>
        <div class="wide-image">Imagem</div>
      </article>
    </div>
  </section>`;
}

function tier() {
  const tiers = [
    ['fav', 'FAVS', 'MEUS FAVORITOS', 3],
    ['ideal', 'TIME IDEAL', 'ENDGAME', 4],
    ['current', 'TIME ATUAL', 'EM USO AGORA', 3],
    ['farm', 'BONS DE FARM', 'CUSTO-BENEFÍCIO', 3],
    ['over', 'SUPERESTIMADOS', 'NA REAL, MEH', 1],
    ['hate', 'ODEIO', 'NUNCA MAIS', 2]
  ];
  return `<div class="split-top">
    <div class="tier-toolbar">
      <span class="eyebrow">Tier List ›</span>
      <input class="tier-name" value="Melhores da minha conta" aria-label="Nome da tier list">
    </div>
    <div class="tier-toolbar">
      <span class="segmented"><button>Ver</button><button class="active">Editar</button></span>
      <button class="share">⌘ Compartilhar</button>
    </div>
  </div>
  <div class="tier-layout">
    <div>
      ${tiers.map(t => `
        <section class="tier-row">
          <div class="tier-label ${t[0]}"><b>${t[1]}</b><small>${t[2]}</small></div>
          <div class="tier-drop">${Array.from({ length: t[3] }, () => '<i class="slot"></i>').join('')}</div>
        </section>
      `).join('')}
    </div>
    <aside class="section-card toolbox">
      <h3>□ Toolbox</h3>
      <div class="toolbox-actions">
        <button class="primary">+ Nova Linha</button>
        <button class="secondary">Limpar Tudo</button>
      </div>
      <input class="toolbox-search" placeholder="⌕ Buscar Pokémon...">
      <div class="tool-tabs"><span class="on">Todos</span><span>Tipos</span><span>Regiões</span></div>
      <div class="tool-grid">${'<i></i>'.repeat(8)}</div>
    </aside>
  </div>`;
}

function xpTotal(level) {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  if (L <= 1) return 0;
  return Math.round((50 / 3) * (Math.pow(L, 3) - 6 * Math.pow(L, 2) + 17 * L - 12));
}

function xpCustoNivel(level) {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  return xpTotal(L + 1) - xpTotal(L);
}

function calcXpState({ lvlFrom = 500, lvlTo = 1000, huntLvl = 500, speed = 1670, vip = false, xpBoost = false, guild = 5, event = 0 }) {
  const from = Math.max(1, Number(lvlFrom) || 1);
  const to = Math.max(from + 1, Number(lvlTo) || (from + 1));
  const hLvl = Math.max(1, Number(huntLvl) || 1);
  const spd = Math.max(1, Number(speed) || 1);

  let mult = 1.0;
  if (vip) mult += 0.20;
  if (xpBoost) mult += 0.50;
  mult += ((Number(guild) || 0) / 100);
  mult += ((Number(event) || 0) / 100);

  const totalXp = Math.max(0, xpTotal(to) - xpTotal(from));
  const xpBase = hLvl <= 150 ? (Math.floor((6 * hLvl * hLvl) / 10) + 8) : Math.round(13500 * Math.pow(hLvl / 150, 1.25));
  const xpEfetivo = Math.max(1, Math.round(xpBase * mult));
  const abates = Math.ceil(totalXp / xpEfetivo);
  const tempoSeg = (abates / spd) * 3600;

  const hours = Math.floor(tempoSeg / 3600);
  const mins = Math.floor((tempoSeg % 3600) / 60);
  const secs = Math.floor(tempoSeg % 60);
  const tempoStr = `${hours}h ${mins}m ${secs}s`;

  const limit = Math.min(from + 15, to);
  let rowsHtml = '';
  let acumXp = 0;
  for (let l = from; l < limit; l++) {
    const c = xpCustoNivel(l);
    acumXp += c;
    const kNivel = Math.ceil(c / xpEfetivo);
    const kAcum = Math.ceil(acumXp / xpEfetivo);
    const tNivel = `${Math.floor((kNivel / spd) * 60)}m`;
    const tAcum = `${Math.floor((kAcum / spd) * 60)}m`;
    rowsHtml += `<tr><td>${l}</td><td class="stat-positive">${c.toLocaleString('pt-BR')}</td><td class="stat-gold">~${kNivel.toLocaleString('pt-BR')}</td><td>${tNivel}</td><td>${tAcum}</td></tr>`;
  }

  return {
    totalXp,
    mult,
    xpEfetivo,
    abates,
    tempoStr,
    rowsHtml
  };
}

function xp() {
  const res = calcXpState({ lvlFrom: 500, lvlTo: 1000, huntLvl: 500, speed: 1670, vip: false, xpBoost: false, guild: 5, event: 0 });
  return `<p class="eyebrow">Ferramentas › Calculadora de XP</p><h1 style="margin:2px 0 12px">Calculadora de XP</h1><div class="xp-layout"><div>${panel(`<h3>PARÂMETROS DE TREINO DO TREINADOR</h3><div class="form-grid"><div class="field"><label>Nível atual</label><input id="xp-in-from" value="500"></div><div class="field"><label>Nível alvo</label><input id="xp-in-to" value="1000"></div><div class="field"><label>Nível da Hunt</label><input id="xp-in-hunt" value="500"></div><div class="field"><label>Abates/h</label><input id="xp-in-speed" value="1670"></div></div><h3 style="margin-top:18px">BÔNUS & MULTIPLICADORES ATIVOS</h3><div class="toggle-line"><label style="cursor:pointer;display:flex;align-items:center;gap:8px;"><input type="checkbox" id="xp-ck-vip"> Assinatura VIP (+20% XP)</label></div><div class="toggle-line"><label style="cursor:pointer;display:flex;align-items:center;gap:8px;"><input type="checkbox" id="xp-ck-boost"> XP Boost (+50% XP)</label></div><div class="form-grid"><div class="field"><label>Bônus de Guild (%)</label><input id="xp-in-guild" value="5"></div><div class="field"><label>Bônus de Evento (%)</label><input id="xp-in-event" value="0"></div></div><button id="xp-btn-calc" class="primary" style="width:100%;margin-top:12px;">Calcular XP</button>`, 'form-card')}</div><div><div class="metrics"><article class="metric"><b id="xp-out-total">${res.totalXp.toLocaleString('pt-BR')}</b><small>XP TOTAL NECESSÁRIO</small></article><article class="metric"><b id="xp-out-tempo">${res.tempoStr}</b><small>TEMPO TOTAL ESTIMADO</small></article><article class="metric yellow"><b id="xp-out-abates">~${res.abates.toLocaleString('pt-BR')}</b><small>ABATES NECESSÁRIOS</small></article><article class="metric yellow"><b id="xp-out-efetivo">~${res.xpEfetivo.toLocaleString('pt-BR')} XP</b><small>XP MÉDIO / KILL</small></article></div><p class="note">Calculado usando as fórmulas oficiais do jogo — o XP de todas as hunts do PokéIdle está mapeado nesta ferramenta.</p><div class="data-panel"><table class="data-table"><thead><tr><th>NÍVEL</th><th>XP DO PRÓXIMO NÍVEL</th><th>ABATES NECESSÁRIOS</th><th>TEMPO DESSE NÍVEL</th><th>TEMPO ACUMULADO</th></tr></thead><tbody id="xp-out-rows">${res.rowsHtml}</tbody></table></div></div></div>`;
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
  ['xp-in-from', 'xp-in-to', 'xp-in-hunt', 'xp-in-speed', 'xp-in-guild', 'xp-in-event'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', recalc);
  });
  ['xp-ck-vip', 'xp-ck-boost'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', recalc);
  });
  document.getElementById('xp-btn-calc')?.addEventListener('click', recalc);
}

function guides() {
  const names = ['Começando no PokéIdle', 'Guia de XP e Evolução', 'Bosses e Tokens: rota completa', 'Outland — guia de região completo', 'Estratégias de PvP e GvG', 'Mecânicas de shinies explicadas'];
  return `<div class="split-top"><div><p class="eyebrow">Aprender › Guias</p><h1>Guias da comunidade</h1></div></div><div class="guide-grid">${names.map((n, i) => `<article class="guide-card"><span class="badge ${i % 2 ? 'update' : ''}">Guia</span><h3>${n}</h3><small><span>${5 + i} min</span></small></article>`).join('')}</div>`;
}

function wiki() {
  return `<div class="wiki-layout"><aside class="wiki-rail"><strong>BUSCAR</strong><input placeholder="⌕ Buscar na wiki..."><strong>MECÂNICAS DO IDLE</strong><button class="active">Como funciona o Idle</button><button>Sistema de XP</button></aside><article class="article"><h1>Como funciona o Idle <span class="badge update">Mecânicas</span></h1><p>O PokéIdle gera progresso continuamente.</p></article></div>`;
}

function admin() {
  return `<h1>Painel Administrativo</h1><p style="color:#a6abb4;font-size:12px">Gerencie a wiki e imagens do portal.</p>`;
}

// Modal
window.openDetailsModal = function(dexId) {
  const p = pokemon.find(item => String(item.dex) === String(dexId));
  if (!p) return;

  let modal = document.getElementById('pokedex-details-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pokedex-details-modal';
    modal.style.cssText = 'position:fixed; inset:0; z-index:999; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.75); padding:16px;';
    document.body.appendChild(modal);
  }

  const pokeBallStats = getBallData(p, 'poke', false, false);
  const greatBallStats = getBallData(p, 'great', false, false);
  const superBallStats = getBallData(p, 'super', false, false);
  const ultraBallStats = getBallData(p, 'ultra', false, false);
  const beastBallStats = getBallData(p, 'beast', false, false);

  modal.innerHTML = `
    <div style="background:#15181e; border:1px solid #343a46; border-radius:10px; width:100%; max-width:600px; max-height:90vh; overflow-y:auto; padding:20px; color:#fff; position:relative;">
      <button onclick="document.getElementById('pokedex-details-modal').style.display='none'" style="position:absolute; top:16px; right:16px; border:0; background:transparent; color:#858b95; font-size:20px; cursor:pointer;">✕</button>
      
      <div style="display:flex; align-items:center; gap:16px;">
        <div>
          <span style="font-family:monospace; color:#858b95;">#${String(p.dex).padStart(3, '0')}</span>
          <h2 style="font-size:22px; margin:2px 0;">${p.nome}</h2>
          <div>${(p.tipos || []).map(type).join(' ')}</div>
        </div>
      </div>

      <div style="margin-top:16px; padding:12px; background:#1e222b; border-radius:6px; font-size:13px;">
        <strong>HUNT:</strong> <span style="color:#7984f4;">${cleanHunt(p)}</span>
      </div>

      <h3 style="margin-top:18px; font-size:14px; border-bottom:1px solid #292e37; padding-bottom:6px;">Taxas de Captura por Pokébola</h3>
      <table class="data-table" style="margin-top:8px;">
        <thead>
          <tr>
            <th>BOLA</th>
            <th>CATCH RATE</th>
            <th>MÉDIA DERROTAS</th>
            <th>ODDS SHINY</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Poké Ball (x1)</td><td class="stat-positive">${pokeBallStats.pct}</td><td>${pokeBallStats.derrotas}</td><td>${pokeBallStats.shiny ? '1 em ' + formatNum(pokeBallStats.shiny) : '—'}</td></tr>
          <tr><td>Great Ball (x2)</td><td class="stat-positive">${greatBallStats.pct}</td><td>${greatBallStats.derrotas}</td><td>${greatBallStats.shiny ? '1 em ' + formatNum(greatBallStats.shiny) : '—'}</td></tr>
          <tr><td>Super Ball (x3)</td><td class="stat-positive">${superBallStats.pct}</td><td>${superBallStats.derrotas}</td><td>${superBallStats.shiny ? '1 em ' + formatNum(superBallStats.shiny) : '—'}</td></tr>
          <tr><td>Ultra Ball (x4)</td><td class="stat-positive">${ultraBallStats.pct}</td><td>${ultraBallStats.derrotas}</td><td>${ultraBallStats.shiny ? '1 em ' + formatNum(ultraBallStats.shiny) : '—'}</td></tr>
          <tr><td>Beast Ball (x8)</td><td class="stat-positive">${beastBallStats.pct}</td><td>${beastBallStats.derrotas}</td><td>${beastBallStats.shiny ? '1 em ' + formatNum(beastBallStats.shiny) : '—'}</td></tr>
        </tbody>
      </table>
    </div>
  `;
  modal.style.display = 'flex';
};

// Event Attachments
function attachDexListeners(mode) {
  document.querySelectorAll('#dex-tabs button').forEach(b => {
    b.addEventListener('click', () => {
      location.hash = `pokedex/${b.dataset.mode}`;
    });
  });

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
      document.querySelectorAll('.ball-group button[data-ball]').forEach(b => {
        b.classList.toggle('selected', b.dataset.ball === dexState.ball);
      });
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

const views = { home, pokedex, tier, xp, guides, wiki, admin };

function render() {
  const route = (location.hash.slice(1) || 'home').split('/');
  const view = views[route[0]] ? route[0] : 'home';

  if (view === 'pokedex' && pokemon.length === 0) {
    loadPokemonData().then(() => { render(); });
    return;
  }

  app.innerHTML = views[view](route[1] || 'shiny');
  document.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === view));
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => location.hash = b.dataset.go));

  if (view === 'pokedex') {
    attachDexListeners(route[1] || 'shiny');
  }
  if (view === 'xp') {
    attachXpListeners();
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
render();
