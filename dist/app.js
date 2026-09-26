const app = document.querySelector('#app');

// Estado global da Pokédex
const dexState = {
  allSpecies: [],
  filteredSpecies: [],
  currentTab: 'shiny',

  // Filtros globais
  search: '',
  tipo1: '',
  tipo2: '',
  regiao: '',
  apenasShiny: false,

  // Aba Captura
  ball: 'poke',
  captureBoost: false,
  shinyLure: false,

  // Aba Hunting
  huntLvlMin: null,
  huntLvlMax: null,
  f4Filter: '',
  f2Filter: '',
  r05Filter: '',
  r025Filter: '',
  imuneFilter: '',
  xpBoost: false,

  // Aba Gold & Loot
  goldLvlMin: null,
  goldLvlMax: null,
  itemDropFilter: '',
  lootBoost: false,

  // Aba Fortes
  fortesLvlMin: null,
  fortesLvlMax: null,
  estagioFilter: '',

  // Ordenação
  sortCol: 'dex',
  sortDir: 'asc',
};

// Helpers
const mon = p => `<div class="monster"><i class="monster-icon"></i>${p.nome}</div>`;
const type = x => x ? `<span class="type ${x.toLowerCase()}">${x[0].toUpperCase()+x.slice(1).toLowerCase()}</span>` : '';
const panel = (x, c = '') => `<section class="section-card ${c}">${x}</section>`;
const names = ['Começando no PokéIdle','Guia de XP e Evolução','Bosses e Tokens: rota completa','Outland — guia de região completo','Estratégias de PvP e GvG','Mecânicas de shinies explicadas','Evento sazonal: Festival de Outono','Ginásio: primeiros passos'];

function formatNum(n) {
  if (n === undefined || n === null || n === '') return '—';
  const num = Number(n);
  if (isNaN(num)) return '—';
  return num.toLocaleString('pt-BR');
}

function cleanHunt(r) {
  if (!r.is_cacavel && r.aparece_em_hunt !== 'sim') return 'Sem hunt';
  const reg = r.regiao || 'Kanto';
  const lvl = r.nivel_hunt_min || r.nivel_ao_capturar || 20;
  return `${reg}, Nv ${lvl}`;
}

// ==========================================
// DADOS
// ==========================================

async function loadPokemonData() {
  try {
    const res = await fetch('data/pokedex_portal.json');
    const raw = await res.json();
    // Apenas caçáveis, espelhando o hub
    dexState.allSpecies = raw.filter(p => p.is_cacavel);
    dexState.allSpecies.forEach(p => {
      p.tipos = [p.tipo1, p.tipo2].filter(Boolean);
    });
    console.log('Dados carregados:', dexState.allSpecies.length, 'Pokémon caçáveis');
  } catch (err) {
    console.error('Erro ao carregar pokedex_portal.json:', err);
  }
}

// ==========================================
// CÁLCULOS DE POKÉBOLA (hub logic)
// ==========================================

function getBallData(r, ballKey, captureBoost, shinyLure) {
  // % Captura
  let catchPctStr = '';
  if (captureBoost) {
    if (ballKey === 'poke')  catchPctStr = r.captura_pok_ball_com_capture_boost_pct;
    else if (ballKey === 'great') catchPctStr = r.captura_great_ball_com_capture_boost_pct;
    else if (ballKey === 'super') catchPctStr = r.captura_super_ball_com_capture_boost_pct;
    else if (ballKey === 'ultra') catchPctStr = r.captura_ultra_ball_com_capture_boost_pct;
    else if (ballKey === 'beast') catchPctStr = r.captura_beast_ball_com_capture_boost_pct;
  } else {
    if (ballKey === 'poke')  catchPctStr = r.captura_pok_ball_pct;
    else if (ballKey === 'great') catchPctStr = r.captura_great_ball_pct;
    else if (ballKey === 'super') catchPctStr = r.captura_super_ball_pct;
    else if (ballKey === 'ultra') catchPctStr = r.captura_ultra_ball_pct;
    else if (ballKey === 'beast') catchPctStr = r.captura_beast_ball_pct;
  }
  let numPct = 0;
  let pctStr = '—';
  if (catchPctStr) {
    numPct = parseFloat(String(catchPctStr).replace(',', '.'));
    if (!isNaN(numPct)) pctStr = numPct.toFixed(2).replace('.', ',') + '%';
  }

  // Derrotas
  let baseDerrotas = 0;
  if (ballKey === 'poke')  baseDerrotas = parseInt(r.captura_pok_ball_derrotas_media, 10) || 0;
  else if (ballKey === 'great') baseDerrotas = parseInt(r.captura_great_ball_derrotas_media, 10) || 0;
  else if (ballKey === 'super') baseDerrotas = parseInt(r.captura_super_ball_derrotas_media, 10) || 0;
  else if (ballKey === 'ultra') baseDerrotas = parseInt(r.captura_ultra_ball_derrotas_media, 10) || 0;
  else if (ballKey === 'beast') baseDerrotas = parseInt(r.captura_beast_ball_derrotas_media, 10) || 0;
  const catchKills = (captureBoost && baseDerrotas > 0) ? Math.max(1, Math.ceil(baseDerrotas / 2)) : baseDerrotas;

  // Shiny
  let baseShinyCatch = 0;
  if (r.tem_forma_shiny === 'sim') {
    if (ballKey === 'poke')  baseShinyCatch = parseInt(r.shiny_encontrar_e_capturar_pok_ball_1_em, 10) || 0;
    else if (ballKey === 'great') baseShinyCatch = parseInt(r.shiny_encontrar_e_capturar_great_ball_1_em, 10) || 0;
    else if (ballKey === 'super') baseShinyCatch = parseInt(r.shiny_encontrar_e_capturar_super_ball_1_em, 10) || 0;
    else if (ballKey === 'ultra') baseShinyCatch = parseInt(r.shiny_encontrar_e_capturar_ultra_ball_1_em, 10) || 0;
    else if (ballKey === 'beast') baseShinyCatch = parseInt(r.shiny_encontrar_e_capturar_beast_ball_1_em, 10) || 0;
    let divisor = 1;
    if (shinyLure) divisor *= 2;
    if (captureBoost) divisor *= 2;
    if (divisor > 1) baseShinyCatch = Math.max(1, Math.round(baseShinyCatch / divisor));
  }

  return {
    numPct,
    pct: pctStr,
    derrotas: catchKills > 0 ? catchKills.toLocaleString('pt-BR') : '—',
    catchKills,
    shiny: baseShinyCatch > 0 ? baseShinyCatch : null
  };
}

// ==========================================
// FILTROS + ORDENAÇÃO (hub logic)
// ==========================================

function applyFiltersAndRender() {
  const {
    allSpecies, currentTab, search, tipo1, tipo2, apenasShiny, regiao,
    ball, captureBoost, shinyLure, xpBoost, lootBoost,
    huntLvlMin, huntLvlMax, f4Filter, f2Filter, r05Filter, r025Filter, imuneFilter,
    goldLvlMin, goldLvlMax, itemDropFilter,
    fortesLvlMin, fortesLvlMax, estagioFilter,
    sortCol, sortDir
  } = dexState;

  let filtered = allSpecies.filter(s => {
    // 1. Busca
    if (search) {
      const q = search.toLowerCase().trim();
      const mDex = String(s.dex) === q;
      const mNome = (s.nome || '').toLowerCase().includes(q);
      if (!mDex && !mNome) return false;
    }

    // 2. Apenas Shiny
    if (apenasShiny && s.tem_forma_shiny !== 'sim') return false;

    // 3. Tipo 1 e Tipo 2 — lógica combinada do hub
    if (tipo1 || tipo2) {
      const spT1 = (s.tipo1 || '').toUpperCase();
      const spT2 = (s.tipo2 || '').toUpperCase();
      if (tipo1 && tipo2) {
        if (tipo2 === 'none') {
          if (spT1 !== tipo1 && spT2 !== tipo1) return false;
          if (spT2 && spT2 !== '' && spT2 !== spT1) return false;
        } else {
          const hasT1 = spT1 === tipo1 || spT2 === tipo1;
          const hasT2 = spT1 === tipo2 || spT2 === tipo2;
          if (!hasT1 || !hasT2) return false;
        }
      } else if (tipo1) {
        if (spT1 !== tipo1 && spT2 !== tipo1) return false;
      } else if (tipo2) {
        if (tipo2 === 'none') {
          if (spT2 && spT2 !== '') return false;
        } else {
          if (spT1 !== tipo2 && spT2 !== tipo2) return false;
        }
      }
    }

    // 4. Região
    if (regiao) {
      if (!s.regiao || !s.regiao.toLowerCase().includes(regiao.toLowerCase())) return false;
    }

    // Filtros da aba Hunting
    if (currentTab === 'hunt') {
      if (huntLvlMin !== null && (s.hunt_lvl_max || s.nivel_hunt_max || 0) < huntLvlMin) return false;
      if (huntLvlMax !== null && (s.hunt_lvl_min || s.nivel_hunt_min || 0) > huntLvlMax) return false;
      if (f4Filter) {
        if (f4Filter === 'has_any') { if (!(s.f4_types || []).length) return false; }
        else { if (!(s.f4_types || []).includes(f4Filter)) return false; }
      }
      if (f2Filter) {
        if (f2Filter === 'has_any') { if (!(s.f2_types || []).length) return false; }
        else { if (!(s.f2_types || []).includes(f2Filter)) return false; }
      }
      if (r05Filter) {
        if (r05Filter === 'has_any') { if (!(s.r05_types || []).length) return false; }
        else { if (!(s.r05_types || []).includes(r05Filter)) return false; }
      }
      if (r025Filter) {
        if (r025Filter === 'has_any') { if (!(s.r025_types || []).length) return false; }
        else { if (!(s.r025_types || []).includes(r025Filter)) return false; }
      }
      if (imuneFilter) {
        if (imuneFilter === 'has_any') { if (!(s.imune_types || []).length) return false; }
        else { if (!(s.imune_types || []).includes(imuneFilter)) return false; }
      }
    }

    // Filtros da aba Gold & Loot
    if (currentTab === 'loot') {
      if (goldLvlMin !== null && (s.hunt_lvl_max || 0) < goldLvlMin) return false;
      if (goldLvlMax !== null && (s.hunt_lvl_min || 0) > goldLvlMax) return false;
      if (itemDropFilter && !(s.item_names || []).includes(itemDropFilter)) return false;
    }

    // Filtros da aba Fortes
    if (currentTab === 'strong') {
      if (fortesLvlMin !== null && (s.hunt_lvl_max || 0) < fortesLvlMin) return false;
      if (fortesLvlMax !== null && (s.hunt_lvl_min || 0) > fortesLvlMax) return false;
      if (estagioFilter && String(s.estagio_num) !== String(estagioFilter)) return false;
    }

    return true;
  });

  // Ordenação
  filtered.sort((a, b) => {
    let comp = 0;
    switch (sortCol) {
      case 'dex':    comp = (parseInt(a.dex, 10) || 0) - (parseInt(b.dex, 10) || 0); break;
      case 'nome':   comp = (a.nome || '').localeCompare(b.nome || ''); break;
      case 'tipo':   comp = (a.tipo1 || '').localeCompare(b.tipo1 || ''); break;
      case 'hunt':   comp = (a.regiao || '').localeCompare(b.regiao || ''); break;
      case 'captura': {
        const stA = getBallData(a, ball, captureBoost, shinyLure);
        const stB = getBallData(b, ball, captureBoost, shinyLure);
        comp = stA.numPct - stB.numPct; break;
      }
      case 'derrotas': {
        const stA = getBallData(a, ball, captureBoost, shinyLure);
        const stB = getBallData(b, ball, captureBoost, shinyLure);
        comp = (stA.catchKills || 9999999) - (stB.catchKills || 9999999); break;
      }
      case 'shiny': {
        const stA = getBallData(a, ball, captureBoost, shinyLure);
        const stB = getBallData(b, ball, captureBoost, shinyLure);
        comp = (stA.shiny || 999999999) - (stB.shiny || 999999999); break;
      }
      case 'xp':     comp = (a.xp_base || 0) - (b.xp_base || 0); break;
      case 'def':    comp = (a.def_num || 0) - (b.def_num || 0); break;
      case 'spdef':  comp = (a.spdef_num || 0) - (b.spdef_num || 0); break;
      case 'hp':     comp = (a.hp_num || 0) - (b.hp_num || 0); break;
      case 'gold':   comp = (parseInt(a.ouro_por_derrota, 10) || 0) - (parseInt(b.ouro_por_derrota, 10) || 0); break;
      case 'bst':    comp = (a.bst_num || 0) - (b.bst_num || 0); break;
      case 'atk':    comp = (a.atk_num || 0) - (b.atk_num || 0); break;
      case 'spatk':  comp = (a.spatk_num || 0) - (b.spatk_num || 0); break;
      case 'spd':    comp = (a.spd_num || 0) - (b.spd_num || 0); break;
      case 'estagio':comp = (a.estagio_num || 1) - (b.estagio_num || 1); break;
      default:       comp = (parseInt(a.dex, 10) || 0) - (parseInt(b.dex, 10) || 0);
    }
    return sortDir === 'asc' ? comp : -comp;
  });

  dexState.filteredSpecies = filtered;
  renderTable(xpBoost, lootBoost);
  updateSortIndicators();
  updateCounter(filtered.length);
}

function updateSortIndicators() {
  document.querySelectorAll('.data-table th[data-sort]').forEach(th => {
    const col = th.dataset.sort;
    if (col === dexState.sortCol) {
      th.classList.add('active-sort');
      const ico = th.querySelector('.sort-ico');
      if (ico) ico.textContent = dexState.sortDir === 'asc' ? ' ▾' : ' ▴';
    } else {
      th.classList.remove('active-sort');
      const ico = th.querySelector('.sort-ico');
      if (ico) ico.textContent = '';
    }
  });
}

function updateCounter(count) {
  const el = document.getElementById('dex-counter');
  if (el) el.textContent = `Mostrando ${count.toLocaleString('pt-BR')} espécies`;
}

function renderTypeBadges(typesArray) {
  if (!typesArray || !typesArray.length) return '<span style="color:#555">—</span>';
  return `<span class="type-row">${typesArray.map(type).join('')}</span>`;
}

function renderResistBadges(r) {
  const r05 = r.r05_types || [];
  const r025 = r.r025_types || [];
  if (!r05.length && !r025.length) return '<span style="color:#555">—</span>';
  const b05 = r05.map(t => `<span class="type-badge-wrap">${type(t)}</span>`).join('');
  const b025 = r025.map(t => `<span class="type-badge-wrap">${type(t)}<small style="color:#f4af25;font-size:8px;font-weight:800;">0,25x</small></span>`).join('');
  return `<span class="type-row">${b05}${b025}</span>`;
}

function renderTable(xpBoost, lootBoost) {
  const tbody = document.querySelector('.data-table tbody');
  if (!tbody) return;

  const { filteredSpecies, currentTab, ball, captureBoost, shinyLure } = dexState;

  if (filteredSpecies.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:2rem;color:#858b95;">Nenhum Pokémon encontrado com os filtros aplicados.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredSpecies.map(r => {
    const formattedDex = '#' + String(r.dex).padStart(3, '0');
    const huntText = cleanHunt(r);

    if (currentTab === 'shiny') {
      const bd = getBallData(r, ball, captureBoost, shinyLure);
      const shinyText = bd.shiny ? '1 em ' + formatNum(bd.shiny) : '—';
      return `<tr>
        <td class="rank">${formattedDex}</td>
        <td>${mon(r)}</td>
        <td><span class="type-row">${r.tipos.map(type).join('')}</span></td>
        <td>${huntText}</td>
        <td class="stat-positive">${bd.pct}<i class="meter"></i></td>
        <td>${bd.derrotas}</td>
        <td>${shinyText}</td>
        <td><button class="detail" onclick="openDetailsModal('${r.dex}')">Detalhes</button></td>
      </tr>`;
    }

    if (currentTab === 'hunt') {
      const xpVal = xpBoost ? (r.xp_boosted || r.xp_base || 0) : (r.xp_base || r.xp_por_derrota || 0);
      const xpText = xpVal > 0 ? xpVal.toLocaleString('pt-BR') : '—';
      return `<tr>
        <td class="rank">${formattedDex}</td>
        <td>${mon(r)}</td>
        <td><span class="type-row">${r.tipos.map(type).join('')}</span></td>
        <td>${huntText}</td>
        <td>${renderTypeBadges(r.f4_types)}</td>
        <td>${renderTypeBadges(r.f2_types)}</td>
        <td>${renderResistBadges(r)}</td>
        <td>${renderTypeBadges(r.imune_types)}</td>
        <td>${r.def_num || r.def || '—'}</td>
        <td>${r.spdef_num || r.spdef || '—'}</td>
        <td>${r.hp_num || r.hp || '—'}</td>
        <td class="stat-green">${xpText}${xpBoost ? ' <span class="badge update">+50%</span>' : ''}</td>
        <td><button class="detail" onclick="openDetailsModal('${r.dex}')">Detalhes</button></td>
      </tr>`;
    }

    if (currentTab === 'loot') {
      const goldNum = parseInt(r.ouro_por_derrota, 10) || 0;
      const dropsArr = r.drops_parsed || [];
      const dropsHtml = dropsArr.length
        ? dropsArr.map(d => {
            let pct = d.pct;
            if (lootBoost && pct > 0) pct = Math.min(100, Math.round(pct * 1.4 * 100) / 100);
            return `<span style="display:inline-block;margin:1px 3px;background:#1e2029;padding:2px 6px;border-radius:4px;font-size:11px;"><b style="color:#f59e0b">${d.name}</b> ${pct}%</span>`;
          }).join('')
        : '—';
      return `<tr>
        <td class="rank">${formattedDex}</td>
        <td>${mon(r)}</td>
        <td><span class="type-row">${r.tipos.map(type).join('')}</span></td>
        <td>${huntText}</td>
        <td class="stat-gold">${goldNum > 0 ? goldNum.toLocaleString('pt-BR') + ' Gold' : '—'}</td>
        <td>${dropsHtml}</td>
        <td><button class="detail" onclick="openDetailsModal('${r.dex}')">Detalhes</button></td>
      </tr>`;
    }

    if (currentTab === 'strong') {
      const evoText = r.evolui_para ? '→ ' + r.evolui_para : 'Não evolui';
      return `<tr>
        <td class="rank">${formattedDex}</td>
        <td>${mon(r)}</td>
        <td><span class="type-row">${r.tipos.map(type).join('')}</span></td>
        <td>${huntText}</td>
        <td class="stat-positive">${r.bst_num || r.total_stats || '—'}</td>
        <td>${r.atk_num || r.atk || '—'}</td>
        <td>${r.def_num || r.def || '—'}</td>
        <td>${r.spatk_num || r.spatk || '—'}</td>
        <td>${r.spdef_num || r.spdef || '—'}</td>
        <td>${r.spd_num || r.spd || '—'}</td>
        <td><span class="badge update">Estágio ${r.estagio_num || r.estagio_evolutivo || 1}</span></td>
        <td>${evoText}</td>
        <td><button class="detail" onclick="openDetailsModal('${r.dex}')">Detalhes</button></td>
      </tr>`;
    }

    return '';
  }).join('');
}

// ==========================================
// VIEWS
// ==========================================

const TYPE_OPTS = ['NORMAL','FIRE','WATER','GRASS','ELECTRIC','ICE','FIGHTING','POISON','GROUND','FLYING','PSYCHIC','BUG','ROCK','GHOST','DRAGON','DARK','STEEL','FAIRY'];
const REGION_OPTS = ['Kanto','Johto','Hoenn','Sinnoh','Unova','Kalos','Alola','Galar','Paldea'];

function typeMatchupOpts(label) {
  return `<option value="">${label}</option>` +
    `<option value="has_any">Qualquer</option>` +
    TYPE_OPTS.map(t => `<option value="${t}">${t[0] + t.slice(1).toLowerCase()}</option>`).join('');
}

function regionOpts() {
  return `<option value="">Região</option>` + REGION_OPTS.map(r => `<option value="${r}">${r}</option>`).join('');
}

// Seletor visual de tipos (clicável, até 2 seleções)
function typeSelectorHTML() {
  const t1 = dexState.tipo1;
  const t2 = dexState.tipo2;
  const tags = TYPE_OPTS.map(t => {
    let cls = t.toLowerCase();
    if (t === t1) cls += ' sel-1';
    else if (t === t2) cls += ' sel-2';
    return `<span class="type ${cls}" data-type-filter="${t}">${t[0]+t.slice(1).toLowerCase()}</span>`;
  }).join('');
  return `<div class="type-selector" id="type-selector">${tags}</div>`;
}

function tableHeader(mode) {
  const th = (label, col, extra = '') =>
    `<th data-sort="${col}" style="cursor:pointer;" ${extra}>${label}<span class="sort-ico"></span></th>`;

  if (mode === 'shiny') {
    return `<tr>
      ${th('#ID', 'dex')}${th('POKÉMON', 'nome')}${th('TIPOS', 'tipo')}${th('HUNT', 'hunt')}
      ${th('% CAPTURA', 'captura')}${th('DERROTAS (MÉDIA)', 'derrotas')}${th('SHINY (1 EM)', 'shiny')}
      <th>AÇÕES</th>
    </tr>`;
  }
  if (mode === 'hunt') {
    return `<tr>
      ${th('#ID', 'dex')}${th('POKÉMON', 'nome')}${th('TIPOS', 'tipo')}${th('HUNT / LOCAL', 'hunt')}
      ${th('FRAQUEZA 4X', 'f4')}${th('FRAQUEZA 2X', 'f2')}${th('RESISTÊNCIA', 'resist')}${th('IMUNE', 'imune')}
      ${th('DEF', 'def')}${th('SP.DEF', 'spdef')}${th('HP', 'hp')}${th('XP', 'xp')}
      <th>AÇÕES</th>
    </tr>`;
  }
  if (mode === 'loot') {
    return `<tr>
      ${th('#ID', 'dex')}${th('POKÉMON', 'nome')}${th('TIPOS', 'tipo')}${th('HUNT / LOCAL', 'hunt')}
      ${th('GOLD NPC', 'gold')}${th('DROPS & CHANCES', 'drops')}
      <th>AÇÕES</th>
    </tr>`;
  }
  if (mode === 'strong') {
    return `<tr>
      ${th('#ID', 'dex')}${th('POKÉMON', 'nome')}${th('TIPOS', 'tipo')}${th('HUNT / LOCAL', 'hunt')}
      ${th('BST TOTAL', 'bst')}${th('ATK', 'atk')}${th('DEF', 'def')}${th('SP.ATK', 'spatk')}${th('SP.DEF', 'spdef')}${th('SPEED', 'spd')}
      ${th('ESTÁGIO', 'estagio')}<th>EVOLUÇÃO</th><th>AÇÕES</th>
    </tr>`;
  }
  return '<tr></tr>';
}

function filterBar(mode) {
  // Filtros globais comuns
  const globalFilters = `
    <input class="control search-field" id="dex-search" placeholder="⌕ Buscar por nome ou #dex..." value="${dexState.search}">
    <select class="control dropdown" id="dex-regiao">${regionOpts()}</select>
  `;

  if (mode === 'shiny') {
    return `<div class="filter-groups" style="display:flex;flex-direction:column;gap:10px;width:100%;">
      <div class="filter-row-top" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;width:100%;">
        ${globalFilters}
        <button class="control ${dexState.apenasShiny ? 'selected' : ''}" id="dex-apenas-shiny">✨ Apenas Shiny</button>
        <div class="ball-group" style="display:inline-flex;align-items:center;gap:6px;">
          <span class="group-label">POKÉBOLA</span>
          <button class="control ball ${dexState.ball === 'poke' ? 'selected' : ''}" data-ball="poke">Poké Ball (x1)</button>
          <button class="control ball ${dexState.ball === 'great' ? 'selected' : ''}" data-ball="great">Great Ball</button>
          <button class="control ball ${dexState.ball === 'super' ? 'selected' : ''}" data-ball="super">Super Ball</button>
          <button class="control ball ${dexState.ball === 'ultra' ? 'selected' : ''}" data-ball="ultra">Ultra Ball</button>
          <button class="control ball ${dexState.ball === 'beast' ? 'selected' : ''}" data-ball="beast">Beast Ball</button>
        </div>
        <div class="boost-options" style="display:inline-flex;align-items:center;gap:6px;">
          <span class="group-label">BOOSTS ATIVOS</span>
          <button class="control check ${dexState.captureBoost ? 'selected' : ''}" id="dex-boost-capture">Capture Boost</button>
          <button class="control check ${dexState.shinyLure ? 'selected' : ''}" id="dex-boost-lure">Shiny Lure</button>
        </div>
      </div>
      <div class="filter-row-bottom" style="width:100%;">
        ${typeSelectorHTML()}
      </div>
    </div>`;
  }

  if (mode === 'hunt') {
    return `<div class="filter-groups" style="display:flex;flex-direction:column;gap:10px;width:100%;">
      <div class="filter-row-top" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;width:100%;">
        ${globalFilters}
        <div style="display:inline-flex;align-items:center;gap:4px;">
          <input class="control" id="hunt-nv-min" placeholder="Nv M" type="number" style="width:70px;" value="${dexState.huntLvlMin ?? ''}">
          <span style="color:#858b95;font-size:11px;">a</span>
          <input class="control" id="hunt-nv-max" placeholder="Nv M" type="number" style="width:70px;" value="${dexState.huntLvlMax ?? ''}">
        </div>
        <select class="control dropdown" id="filter-f4">${typeMatchupOpts('Fraqueza 4x')}</select>
        <select class="control dropdown" id="filter-f2">${typeMatchupOpts('Fraqueza 2x')}</select>
        <select class="control dropdown" id="filter-r05">${typeMatchupOpts('Resistência 0,5x')}</select>
        <select class="control dropdown" id="filter-r025">${typeMatchupOpts('Resistência 0,25x')}</select>
        <select class="control dropdown" id="filter-imune">${typeMatchupOpts('Imunidade')}</select>
        <button class="control check ${dexState.xpBoost ? 'selected' : ''}" id="dex-xp-boost">⚡ XP Boost (+50%)</button>
      </div>
      <div class="filter-row-bottom" style="width:100%;">
        ${typeSelectorHTML()}
      </div>
    </div>`;
  }

  if (mode === 'loot') {
    return `<div class="filter-groups" style="display:flex;flex-direction:column;gap:10px;width:100%;">
      <div class="filter-row-top" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;width:100%;">
        ${globalFilters}
        <div style="display:inline-flex;align-items:center;gap:4px;">
          <input class="control" id="gold-nv-min" placeholder="Nv M" type="number" style="width:70px;" value="${dexState.goldLvlMin ?? ''}">
          <span style="color:#858b95;font-size:11px;">a</span>
          <input class="control" id="gold-nv-max" placeholder="Nv M" type="number" style="width:70px;" value="${dexState.goldLvlMax ?? ''}">
        </div>
        <select class="control dropdown" id="filter-item-drop"><option value="">Todos os Drops (Itens)</option></select>
        <button class="control check ${dexState.lootBoost ? 'selected' : ''}" id="dex-loot-boost">Loot Boost (+40%)</button>
      </div>
      <div class="filter-row-bottom" style="width:100%;">
        ${typeSelectorHTML()}
      </div>
    </div>`;
  }

  if (mode === 'strong') {
    return `<div class="filter-groups" style="display:flex;flex-direction:column;gap:10px;width:100%;">
      <div class="filter-row-top" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;width:100%;">
        ${globalFilters}
        <div style="display:inline-flex;align-items:center;gap:4px;">
          <input class="control" id="fortes-nv-min" placeholder="Nv M" type="number" style="width:70px;" value="${dexState.fortesLvlMin ?? ''}">
          <span style="color:#858b95;font-size:11px;">a</span>
          <input class="control" id="fortes-nv-max" placeholder="Nv M" type="number" style="width:70px;" value="${dexState.fortesLvlMax ?? ''}">
        </div>
        <select class="control dropdown" id="filter-estagio">
          <option value="">Todos Estágios</option>
          <option value="1">Estágio 1</option>
          <option value="2">Estágio 2</option>
          <option value="3">Estágio 3</option>
        </select>
        <select class="control dropdown" id="filter-bst-sort">
          <option value="bst_desc">BST Total (Maior)</option>
          <option value="bst_asc">BST Total (Menor)</option>
        </select>
      </div>
      <div class="filter-row-bottom" style="width:100%;">
        ${typeSelectorHTML()}
      </div>
    </div>`;
  }

  return '';
}

function pokedex(mode = 'shiny') {
  dexState.currentTab = mode;
  // Set default sort per tab
  if (mode === 'shiny')  { dexState.sortCol = 'dex';  dexState.sortDir = 'asc'; }
  if (mode === 'hunt')   { dexState.sortCol = 'xp';   dexState.sortDir = 'desc'; }
  if (mode === 'loot')   { dexState.sortCol = 'gold'; dexState.sortDir = 'desc'; }
  if (mode === 'strong') { dexState.sortCol = 'bst';  dexState.sortDir = 'desc'; }

  return `
    <div class="tabbar" id="dex-tabs">
      <button class="${mode === 'shiny' ? 'active' : ''}" data-mode="shiny">Captura e Shiny</button>
      <button class="${mode === 'hunt' ? 'active' : ''}" data-mode="hunt">Hunting</button>
      <button class="${mode === 'loot' ? 'active' : ''}" data-mode="loot">Gold e Loot</button>
      <button class="${mode === 'strong' ? 'active' : ''}" data-mode="strong">Pokémons Fortes</button>
    </div>
    ${filterBar(mode)}
    <div style="display:flex;justify-content:flex-end;padding:4px 0 8px;font-size:11px;color:#858b95;">
      <span id="dex-counter">Carregando...</span>
    </div>
    <div class="data-panel">
      <table class="data-table">
        <thead>${tableHeader(mode)}</thead>
        <tbody></tbody>
      </table>
    </div>
  `;
}

function home() {
  const quick = [
    ['Iniciante?','Veja nosso guia para entender tudo sobre o jogo.','Comece aqui','guides'],
    ['Captura de Shiny','Entenda a dificuldade de captura de cada espécie.','Ver Pokédex','pokedex'],
    ['Calculadora de XP','Veja o tempo para o próximo nível.','Calcular agora','xp'],
    ['Wiki','Todas as informações do jogo em um só lugar.','Explorar','wiki']
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
      ${quick.map(x => `<article class="section-card wire-quick"><h2>${x[0]}</h2><p>${x[1]}</p><div class="wire-image">Imagem</div><button class="secondary" data-go="${x[3]}">${x[2]}</button></article>`).join('')}
    </div>
    <div class="wire-bottom">
      <article class="section-card wire-wide"><div><h2>Tier List <span class="badge new">Novo</span></h2><p>Crie tier lists dos seus Pokémon favoritos e compartilhe com amigos!</p><button class="secondary" data-go="tier">Criar agora</button></div><div class="wide-image">Imagem</div></article>
      <article class="section-card wire-wide"><div><h2>Entre na comunidade</h2><p>Troque dicas, encontre players, negocie e fique por dentro de todas as novidades.</p><button class="secondary">Entrar no Discord</button></div><div class="wide-image">Imagem</div></article>
    </div>
  </section>`;
}

function tier() {
  const tiers = [['fav','FAVS','MEUS FAVORITOS',3],['ideal','TIME IDEAL','ENDGAME',4],['current','TIME ATUAL','EM USO AGORA',3],['farm','BONS DE FARM','CUSTO-BENEFÍCIO',3],['over','SUPERESTIMADOS','NA REAL, MEH',1],['hate','ODEIO','NUNCA MAIS',2]];
  return `<div class="split-top"><div class="tier-toolbar"><span class="eyebrow">Tier List ›</span><input class="tier-name" value="Melhores da minha conta" aria-label="Nome da tier list"></div><div class="tier-toolbar"><span class="segmented"><button>Ver</button><button class="active">Editar</button></span><button class="share">⌘ Compartilhar</button></div></div><div class="tier-layout"><div>${tiers.map(t=>`<section class="tier-row"><div class="tier-label ${t[0]}"><b>${t[1]}</b><small>${t[2]}</small></div><div class="tier-drop">${Array.from({length:t[3]},()=>'<i class="slot"></i>').join('')}</div></section>`).join('')}</div><aside class="section-card toolbox"><h3>□ Toolbox</h3><div class="toolbox-actions"><button class="primary">+ Nova Linha</button><button class="secondary">Limpar Tudo</button></div><input class="toolbox-search" placeholder="⌕  Buscar Pokémon..."><div class="tool-tabs"><span class="on">Todos</span><span>Tipos</span><span>Regiões</span></div><div class="tool-grid">${'<i></i>'.repeat(8)}</div></aside></div>`;
}

// ==========================================
// CALCULADORA DE XP
// ==========================================
function xpTotal(level) {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  if (L <= 1) return 0;
  return Math.round((50 / 3) * (Math.pow(L, 3) - 6 * Math.pow(L, 2) + 17 * L - 12));
}
function xpCustoNivel(level) {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  return xpTotal(L + 1) - xpTotal(L);
}
function calcXpState({ lvlFrom=500, lvlTo=1000, huntLvl=500, speed=1670, vip=false, xpBoost=false, guild=5, event=0 }) {
  const from = Math.max(1, Number(lvlFrom)||1);
  const to = Math.max(from+1, Number(lvlTo)||(from+1));
  const hLvl = Math.max(1, Number(huntLvl)||1);
  const spd = Math.max(1, Number(speed)||1);
  let mult = 1.0;
  if (vip) mult += 0.20;
  if (xpBoost) mult += 0.50;
  mult += ((Number(guild)||0)/100);
  mult += ((Number(event)||0)/100);
  const totalXp = Math.max(0, xpTotal(to) - xpTotal(from));
  const xpBase = hLvl <= 150 ? (Math.floor((6*hLvl*hLvl)/10)+8) : Math.round(13500*Math.pow(hLvl/150,1.25));
  const xpEfetivo = Math.max(1, Math.round(xpBase*mult));
  const abates = Math.ceil(totalXp/xpEfetivo);
  const tempoSeg = (abates/spd)*3600;
  const h = Math.floor(tempoSeg/3600);
  const m = Math.floor((tempoSeg%3600)/60);
  const s = Math.floor(tempoSeg%60);
  const limit = Math.min(from+15, to);
  let rowsHtml = '';
  let acumXp = 0;
  for (let l = from; l < limit; l++) {
    const c = xpCustoNivel(l);
    acumXp += c;
    const kNivel = Math.ceil(c/xpEfetivo);
    const kAcum = Math.ceil(acumXp/xpEfetivo);
    const tNivel = `${Math.floor((kNivel/spd)*60)}m`;
    const tAcum = `${Math.floor((kAcum/spd)*60)}m`;
    rowsHtml += `<tr><td>${l}</td><td class="stat-positive">${c.toLocaleString('pt-BR')}</td><td class="stat-gold">~${kNivel.toLocaleString('pt-BR')}</td><td>${tNivel}</td><td>${tAcum}</td></tr>`;
  }
  return { totalXp, mult, xpEfetivo, abates, tempoStr:`${h}h ${m}m ${s}s`, rowsHtml };
}

function xp() {
  const res = calcXpState({ lvlFrom:500, lvlTo:1000, huntLvl:500, speed:1670, vip:false, xpBoost:false, guild:5, event:0 });
  return `<p class="eyebrow">Ferramentas › Calculadora de XP</p><h1 style="margin:2px 0 12px">Calculadora de XP</h1><div class="xp-layout"><div>${panel(`<h3>PARÂMETROS DE TREINO DO TREINADOR</h3><div class="form-grid"><div class="field"><label>Nível atual</label><input id="xp-in-from" value="500"></div><div class="field"><label>Nível alvo</label><input id="xp-in-to" value="1000"></div><div class="field"><label>Nível da Hunt</label><input id="xp-in-hunt" value="500"></div><div class="field"><label>Abates/h</label><input id="xp-in-speed" value="1670"></div></div><h3 style="margin-top:18px">BÔNUS & MULTIPLICADORES ATIVOS</h3><div class="toggle-line"><label style="cursor:pointer;display:flex;align-items:center;gap:8px;"><input type="checkbox" id="xp-ck-vip"> Assinatura VIP (+20% XP)</label></div><div class="toggle-line"><label style="cursor:pointer;display:flex;align-items:center;gap:8px;"><input type="checkbox" id="xp-ck-boost"> XP Boost (+50% XP)</label></div><div class="form-grid"><div class="field"><label>Bônus de Guild (%)</label><input id="xp-in-guild" value="5"></div><div class="field"><label>Bônus de Evento (%)</label><input id="xp-in-event" value="0"></div></div><button id="xp-btn-calc" class="primary" style="width:100%;margin-top:12px;">Calcular XP</button>`,'form-card')}</div><div><div class="metrics"><article class="metric"><b id="xp-out-total">${res.totalXp.toLocaleString('pt-BR')}</b><small>XP TOTAL NECESSÁRIO</small></article><article class="metric"><b id="xp-out-tempo">${res.tempoStr}</b><small>TEMPO TOTAL ESTIMADO</small></article><article class="metric yellow"><b id="xp-out-abates">~${res.abates.toLocaleString('pt-BR')}</b><small>ABATES NECESSÁRIOS</small></article><article class="metric yellow"><b id="xp-out-efetivo">~${res.xpEfetivo.toLocaleString('pt-BR')} XP</b><small>XP MÉDIO / KILL</small></article></div><p class="note">Calculado usando as fórmulas oficiais do jogo.</p><div class="data-panel"><table class="data-table"><thead><tr><th>NÍVEL</th><th>XP DO PRÓXIMO NÍVEL</th><th>ABATES NECESSÁRIOS</th><th>TEMPO DESSE NÍVEL</th><th>TEMPO ACUMULADO</th></tr></thead><tbody id="xp-out-rows">${res.rowsHtml}</tbody></table></div></div></div>`;
}

function attachXpListeners() {
  const getVal = id => document.getElementById(id)?.value;
  const getCk  = id => document.getElementById(id)?.checked;
  const recalc = () => {
    const s = calcXpState({ lvlFrom:getVal('xp-in-from'), lvlTo:getVal('xp-in-to'), huntLvl:getVal('xp-in-hunt'), speed:getVal('xp-in-speed'), vip:getCk('xp-ck-vip'), xpBoost:getCk('xp-ck-boost'), guild:getVal('xp-in-guild'), event:getVal('xp-in-event') });
    document.getElementById('xp-out-total').textContent = s.totalXp.toLocaleString('pt-BR');
    document.getElementById('xp-out-tempo').textContent = s.tempoStr;
    document.getElementById('xp-out-abates').textContent = '~'+s.abates.toLocaleString('pt-BR');
    document.getElementById('xp-out-efetivo').textContent = '~'+s.xpEfetivo.toLocaleString('pt-BR')+' XP';
    document.getElementById('xp-out-rows').innerHTML = s.rowsHtml;
  };
  ['xp-in-from','xp-in-to','xp-in-hunt','xp-in-speed','xp-in-guild','xp-in-event'].forEach(id => document.getElementById(id)?.addEventListener('input', recalc));
  ['xp-ck-vip','xp-ck-boost'].forEach(id => document.getElementById(id)?.addEventListener('change', recalc));
  document.getElementById('xp-btn-calc')?.addEventListener('click', recalc);
}

function guides() {
  return `<div class="split-top"><div><p class="eyebrow">Aprender › Guias</p><h1>Guias da comunidade</h1></div></div><div class="guide-grid">${names.map((n,i)=>`<article class="guide-card"><span class="badge ${i%2?'update':''}">Guia</span><h3>${n}</h3><small><span>${5+i} min</span></small></article>`).join('')}</div>`;
}
function wiki() {
  return `<div class="wiki-layout"><aside class="wiki-rail"><strong>BUSCAR</strong><input placeholder="⌕ Buscar na wiki..."><strong>MECÂNICAS DO IDLE</strong><button class="active">Como funciona o Idle</button></aside><article class="article"><h1>Como funciona o Idle <span class="badge update">Mecânicas</span></h1><p>O PokéIdle gera progresso continuamente.</p></article></div>`;
}
function admin() {
  return `<h1>Painel Administrativo</h1>`;
}

// ==========================================
// MODAL DE DETALHES
// ==========================================
window.openDetailsModal = function(dexId) {
  const r = dexState.allSpecies.find(p => String(p.dex) === String(dexId));
  if (!r) return;

  let modal = document.getElementById('pokedex-details-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pokedex-details-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);padding:16px;';
    document.body.appendChild(modal);
  }

  const balls = [['Poké Ball (x1)','poke'],['Great Ball (x2)','great'],['Super Ball (x3)','super'],['Ultra Ball (x4)','ultra'],['Beast Ball (x8)','beast']];

  modal.innerHTML = `
    <div style="background:#15181e;border:1px solid #343a46;border-radius:10px;width:100%;max-width:600px;max-height:90vh;overflow-y:auto;padding:20px;color:#fff;position:relative;">
      <button onclick="document.getElementById('pokedex-details-modal').style.display='none'" style="position:absolute;top:16px;right:16px;border:0;background:transparent;color:#858b95;font-size:20px;cursor:pointer;">✕</button>
      <div style="display:flex;align-items:center;gap:16px;">
        <div>
          <span style="font-family:monospace;color:#858b95;">#${String(r.dex).padStart(3,'0')}</span>
          <h2 style="font-size:22px;margin:2px 0;">${r.nome}</h2>
          <div><span class="type-row">${r.tipos.map(type).join(' ')}</span></div>
        </div>
      </div>
      <div style="margin-top:16px;padding:12px;background:#1e222b;border-radius:6px;font-size:13px;">
        <strong>HUNT:</strong> <span style="color:#7984f4;">${cleanHunt(r)}</span>
      </div>
      <h3 style="margin-top:18px;font-size:14px;border-bottom:1px solid #292e37;padding-bottom:6px;">Taxas por Pokébola</h3>
      <table class="data-table" style="margin-top:8px;">
        <thead><tr><th>BOLA</th><th>CATCH RATE</th><th>MÉDIA DERROTAS</th><th>ODDS SHINY</th></tr></thead>
        <tbody>
          ${balls.map(([label, key]) => {
            const bd = getBallData(r, key, false, false);
            return `<tr><td>${label}</td><td class="stat-positive">${bd.pct}</td><td>${bd.derrotas}</td><td>${bd.shiny ? '1 em '+formatNum(bd.shiny) : '—'}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
      <h3 style="margin-top:18px;font-size:14px;border-bottom:1px solid #292e37;padding-bottom:6px;">Status Base (BST: ${r.bst_num || r.total_stats || '—'})</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px;font-size:12px;">
        <div style="background:#20242c;padding:8px;border-radius:6px;">HP: <b>${r.hp_num||r.hp||'—'}</b></div>
        <div style="background:#20242c;padding:8px;border-radius:6px;">ATK: <b>${r.atk_num||r.atk||'—'}</b></div>
        <div style="background:#20242c;padding:8px;border-radius:6px;">DEF: <b>${r.def_num||r.def||'—'}</b></div>
        <div style="background:#20242c;padding:8px;border-radius:6px;">SP.ATK: <b>${r.spatk_num||r.spatk||'—'}</b></div>
        <div style="background:#20242c;padding:8px;border-radius:6px;">SP.DEF: <b>${r.spdef_num||r.spdef||'—'}</b></div>
        <div style="background:#20242c;padding:8px;border-radius:6px;">SPEED: <b>${r.spd_num||r.spd||'—'}</b></div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
};

// ==========================================
// LISTENERS DA POKÉDEX
// ==========================================
function attachDexListeners(mode) {
  // Troca de aba
  document.querySelectorAll('#dex-tabs button').forEach(b => {
    b.addEventListener('click', () => location.hash = `pokedex/${b.dataset.mode}`);
  });

  // Ordenação por coluna
  document.querySelectorAll('.data-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (dexState.sortCol === col) {
        dexState.sortDir = dexState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        dexState.sortCol = col;
        // Numéricos começam desc, texto começa asc
        const numCols = ['captura','derrotas','shiny','xp','gold','bst','atk','def','spatk','spdef','spd','hp','estagio'];
        dexState.sortDir = numCols.includes(col) ? 'desc' : 'asc';
      }
      applyFiltersAndRender();
    });
  });

  // Preenchimento inicial dos selects com valor atual do estado
  const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  setVal('dex-regiao', dexState.regiao);
  setVal('filter-f4', dexState.f4Filter);
  setVal('filter-f2', dexState.f2Filter);
  setVal('filter-r05', dexState.r05Filter);
  setVal('filter-r025', dexState.r025Filter);
  setVal('filter-imune', dexState.imuneFilter);

  // Seletor visual de tipos — clique em tag seleciona tipo 1 (roxo) ou tipo 2 (amarelo)
  const typeSel = document.getElementById('type-selector');
  if (typeSel) {
    typeSel.addEventListener('click', e => {
      const tag = e.target.closest('[data-type-filter]');
      if (!tag) return;
      const t = tag.dataset.typeFilter;
      if (dexState.tipo1 === t) {
        dexState.tipo1 = dexState.tipo2;
        dexState.tipo2 = '';
      } else if (dexState.tipo2 === t) {
        dexState.tipo2 = '';
      } else if (!dexState.tipo1) {
        dexState.tipo1 = t;
      } else if (!dexState.tipo2) {
        dexState.tipo2 = t;
      } else {
        dexState.tipo1 = dexState.tipo2;
        dexState.tipo2 = t;
      }
      
      // Atualiza classes CSS in-place sem recriar nós do DOM (desempenho instantâneo)
      typeSel.querySelectorAll('[data-type-filter]').forEach(el => {
        const val = el.dataset.typeFilter;
        let cls = `type ${val.toLowerCase()}`;
        if (val === dexState.tipo1) cls += ' sel-1';
        else if (val === dexState.tipo2) cls += ' sel-2';
        el.className = cls;
      });

      applyFiltersAndRender();
    });
  }

  // Filtros globais
  document.getElementById('dex-search')?.addEventListener('input', e => {
    dexState.search = e.target.value.toLowerCase().trim();
    applyFiltersAndRender();
  });
  document.getElementById('dex-regiao')?.addEventListener('change', e => {
    dexState.regiao = e.target.value;
    applyFiltersAndRender();
  });
  document.getElementById('dex-apenas-shiny')?.addEventListener('click', function() {
    dexState.apenasShiny = !dexState.apenasShiny;
    this.classList.toggle('selected', dexState.apenasShiny);
    applyFiltersAndRender();
  });

  // Pokébolas
  document.querySelectorAll('.ball-group button[data-ball]').forEach(btn => {
    btn.addEventListener('click', () => {
      dexState.ball = btn.dataset.ball;
      document.querySelectorAll('.ball-group button[data-ball]').forEach(b => b.classList.toggle('selected', b.dataset.ball === dexState.ball));
      applyFiltersAndRender();
    });
  });

  // Boosts aba Captura
  document.getElementById('dex-boost-capture')?.addEventListener('click', function() {
    dexState.captureBoost = !dexState.captureBoost;
    this.classList.toggle('selected', dexState.captureBoost);
    applyFiltersAndRender();
  });
  document.getElementById('dex-boost-lure')?.addEventListener('click', function() {
    dexState.shinyLure = !dexState.shinyLure;
    this.classList.toggle('selected', dexState.shinyLure);
    applyFiltersAndRender();
  });

  // Filtros aba Hunting
  document.getElementById('hunt-nv-min')?.addEventListener('input', e => {
    dexState.huntLvlMin = e.target.value ? parseInt(e.target.value, 10) : null;
    applyFiltersAndRender();
  });
  document.getElementById('hunt-nv-max')?.addEventListener('input', e => {
    dexState.huntLvlMax = e.target.value ? parseInt(e.target.value, 10) : null;
    applyFiltersAndRender();
  });
  document.getElementById('filter-f4')?.addEventListener('change', e => {
    dexState.f4Filter = e.target.value;
    applyFiltersAndRender();
  });
  document.getElementById('filter-f2')?.addEventListener('change', e => {
    dexState.f2Filter = e.target.value;
    applyFiltersAndRender();
  });
  document.getElementById('filter-r05')?.addEventListener('change', e => {
    dexState.r05Filter = e.target.value;
    applyFiltersAndRender();
  });
  document.getElementById('filter-r025')?.addEventListener('change', e => {
    dexState.r025Filter = e.target.value;
    applyFiltersAndRender();
  });
  document.getElementById('filter-imune')?.addEventListener('change', e => {
    dexState.imuneFilter = e.target.value;
    applyFiltersAndRender();
  });
  document.getElementById('dex-xp-boost')?.addEventListener('click', function() {
    dexState.xpBoost = !dexState.xpBoost;
    this.classList.toggle('selected', dexState.xpBoost);
    applyFiltersAndRender();
  });

  // Filtros aba Loot
  document.getElementById('gold-nv-min')?.addEventListener('input', e => {
    dexState.goldLvlMin = e.target.value ? parseInt(e.target.value, 10) : null;
    applyFiltersAndRender();
  });
  document.getElementById('gold-nv-max')?.addEventListener('input', e => {
    dexState.goldLvlMax = e.target.value ? parseInt(e.target.value, 10) : null;
    applyFiltersAndRender();
  });
  document.getElementById('filter-item-drop')?.addEventListener('change', e => {
    dexState.itemDropFilter = e.target.value;
    applyFiltersAndRender();
  });
  document.getElementById('dex-loot-boost')?.addEventListener('click', function() {
    dexState.lootBoost = !dexState.lootBoost;
    this.classList.toggle('selected', dexState.lootBoost);
    applyFiltersAndRender();
  });

  // Filtros aba Fortes
  document.getElementById('fortes-nv-min')?.addEventListener('input', e => {
    dexState.fortesLvlMin = e.target.value ? parseInt(e.target.value, 10) : null;
    applyFiltersAndRender();
  });
  document.getElementById('fortes-nv-max')?.addEventListener('input', e => {
    dexState.fortesLvlMax = e.target.value ? parseInt(e.target.value, 10) : null;
    applyFiltersAndRender();
  });
  document.getElementById('filter-estagio')?.addEventListener('change', e => {
    dexState.estagioFilter = e.target.value;
    applyFiltersAndRender();
  });
  document.getElementById('filter-bst-sort')?.addEventListener('change', e => {
    const val = e.target.value;
    dexState.sortCol = 'bst';
    dexState.sortDir = val === 'bst_desc' ? 'desc' : 'asc';
    applyFiltersAndRender();
  });

  // Preencher dropdown de itens da aba Loot
  if (mode === 'loot') {
    const itemSel = document.getElementById('filter-item-drop');
    if (itemSel && dexState.allSpecies.length > 0) {
      const itemSet = new Set();
      dexState.allSpecies.forEach(s => (s.item_names || []).forEach(i => i && itemSet.add(i)));
      const sorted = Array.from(itemSet).sort((a,b) => a.localeCompare(b));
      itemSel.innerHTML = '<option value="">Todos os Drops (Itens)</option>' + sorted.map(i => `<option value="${i}">${i}</option>`).join('');
    }
  }

  // Render inicial
  applyFiltersAndRender();
}

// ==========================================
// ROTEAMENTO
// ==========================================
const views = { home, pokedex, tier, xp, guides, wiki, admin };

function render() {
  const route = (location.hash.slice(1) || 'home').split('/');
  const view = views[route[0]] ? route[0] : 'home';

  if (view === 'pokedex' && dexState.allSpecies.length === 0) {
    loadPokemonData().then(() => render());
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
