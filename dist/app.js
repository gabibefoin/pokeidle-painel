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
  hiddenCols: ['resist'],

  // Aba Captura
  ball: 'poke',
  captureBoost: false,
  shinyLure: false,

  // Aba Hunting
  huntLvlMin: null,
  huntLvlMax: null,
  f4Filter: '',
  f2Filter: '',
  resistFilter: '',
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
const dexSpriteFilenameMap = new Map();
const spriteMetadataMap = new Map();
const croppedSpriteCache = new Map();

function getSpriteFilename(p) {
  const id1 = String(p.poke_id || '');
  const id2 = String(p.dex || '');
  let fname = dexSpriteFilenameMap.get(id1) || dexSpriteFilenameMap.get(id2);

  if (!fname && p.nome) {
    const targetClean = p.nome.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [id, f] of dexSpriteFilenameMap.entries()) {
      const fClean = f.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (fClean.includes(targetClean) || targetClean.includes(fClean.replace(/^[0-9]+/, ''))) {
        fname = f;
        break;
      }
    }
  }

  if (!fname && p.nome) {
    const parts = p.nome.trim().split(' ');
    const baseName = parts[parts.length - 1];
    const baseClean = baseName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [id, f] of dexSpriteFilenameMap.entries()) {
      const fClean = f.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (fClean.includes(baseClean)) {
        fname = f;
        break;
      }
    }
  }

  return fname;
}

function getSpriteHTML(p, isShiny = false) {
  const boxSize = 32;
  const fname = getSpriteFilename(p);

  if (!fname) {
    return `<div class="monster-sprite-box" style="width:${boxSize}px;height:${boxSize}px;display:grid;place-items:center;background:#18261b;border:1px solid #6a9b27;border-radius:5px;flex-shrink:0;">
      <i class="monster-icon" style="border:0;background:transparent;"></i>
    </div>`;
  }

  const folder = isShiny ? 'shiny' : 'normal';
  const spriteFile = `${folder}/${fname}`;
  const cacheKey = `${spriteFile}`;

  const existingDataUrl = croppedSpriteCache.get(cacheKey);

  if (existingDataUrl) {
    return `<div class="monster-sprite-box" style="width:${boxSize}px;height:${boxSize}px;display:grid;place-items:center;background:#18261b;border:1px solid #6a9b27;border-radius:5px;overflow:hidden;flex-shrink:0;">
      <img src="${existingDataUrl}" alt="${p.nome}" style="max-width:${boxSize}px;max-height:${boxSize}px;object-fit:contain;image-rendering:pixelated;image-rendering:crisp-edges;display:block;" />
    </div>`;
  }

  const src = `assets/sprites-pokemon/${spriteFile}`;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const w = img.width;
      const h = img.height;
      const meta = spriteMetadataMap.get(spriteFile);

      let sx = 0, sy = 0, cropW = w, cropH = h;

      if (meta && meta.tileW && meta.frames) {
        const tw = meta.tileW;
        const th = meta.tileH;
        const frs = meta.frames || 3;
        const dir = 3; // Direção 3 = FRENTE / SUL

        const cellW = Math.floor((tw * 33) / 32);
        const cellH = Math.floor((th * 33) / 32);

        const colIdx = (dir - 1) * frs;

        sx = colIdx * cellW;
        sy = 0;
        if (sx >= w) {
          const row = Math.floor(sx / w);
          sx = sx % w;
          sy = row * cellH;
        }
        cropW = cellW;
        cropH = cellH;
      }

      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
      const dataUrl = canvas.toDataURL('image/png');
      croppedSpriteCache.set(cacheKey, dataUrl);

      document.querySelectorAll(`[data-sprite-key="${cacheKey}"]`).forEach(box => {
        box.innerHTML = `<img src="${dataUrl}" alt="${p.nome}" style="max-width:${boxSize}px;max-height:${boxSize}px;object-fit:contain;image-rendering:pixelated;image-rendering:crisp-edges;display:block;" />`;
      });
    } catch (e) {
      console.error('Erro ao cortar sprite para ' + p.nome, e);
    }
  };
  img.src = src;

  return `<div class="monster-sprite-box" data-sprite-key="${cacheKey}" style="width:${boxSize}px;height:${boxSize}px;display:grid;place-items:center;background:#18261b;border:1px solid #6a9b27;border-radius:5px;overflow:hidden;flex-shrink:0;">
    <i class="monster-icon" style="border:0;background:transparent;"></i>
  </div>`;
}

const mon = p => `<div class="monster"><span>${p.nome}</span></div>`;
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

function isRelevantDrop(itemStr) {
  if (!itemStr) return false;
  const lower = String(itemStr).trim().toLowerCase();
  
  // Excluir lixos que contêm 'stone' no nome mas não são pedras de evolução ou monkey paw
  if (['small stone', 'stone orb', 'branch of stone', 'monkey paw'].includes(lower)) return false;

  // 1. Pedras de Evolução
  if (lower.includes('stone')) return true;

  // 5. Tokens, Fragmentos & Utilidades
  if (
    lower.includes('token') ||
    lower.includes('fragmento') ||
    lower.includes('fragment') ||
    lower.includes('rope') ||
    lower.includes('chave') ||
    /\bkey\b/.test(lower) ||
    lower.includes('bicicleta') ||
    lower.includes('bike') ||
    lower.includes('mega')
  ) {
    return true;
  }

  return false;
}

// ==========================================
// DADOS
// ==========================================

async function loadPokemonData() {
  try {
    const [res, dexMapRes, mapRes] = await Promise.all([
      fetch('data/pokedex_portal.json').then(r => r.json()),
      fetch('data/dex_sprite_map.json').then(r => r.json()).catch(() => ({})),
      fetch('assets/sprites-pokemon/mapping.json').then(r => r.json()).catch(err => {
        console.warn('mapping.json error:', err);
        return [];
      })
    ]);

    Object.entries(dexMapRes || {}).forEach(([id, file]) => {
      dexSpriteFilenameMap.set(String(id), file);
    });

    (mapRes || []).forEach(item => {
      if (item.normal && item.normal.file) spriteMetadataMap.set(item.normal.file, item.normal);
      if (item.shiny && item.shiny.file) spriteMetadataMap.set(item.shiny.file, item.shiny);
    });

    const speciesMap = new Map();
    (res || []).filter(p => p.is_cacavel).forEach(p => {
      const key = String(p.dex) + '_' + String(p.nome).toLowerCase();
      const existing = speciesMap.get(key);
      if (!existing) {
        speciesMap.set(key, p);
      } else if (p.registro === 'clone_hunt' && existing.registro !== 'clone_hunt') {
        speciesMap.set(key, p);
      }
    });

    dexState.allSpecies = Array.from(speciesMap.values());
    dexState.allSpecies.forEach(p => {
      p.tipos = [p.tipo1, p.tipo2].filter(Boolean);
    });
    console.log('Dados carregados:', dexState.allSpecies.length, 'Pokémon caçáveis,', dexSpriteFilenameMap.size, 'mapa de arquivos,', spriteMetadataMap.size, 'metadados de atlas');
  } catch (err) {
    console.error('Erro ao carregar dados:', err);
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
    allSpecies, currentTab, search, tipo1, tipo2, apenasShiny, regiao, hiddenCols,
    ball, captureBoost, shinyLure, xpBoost, lootBoost,
    huntLvlMin, huntLvlMax, f4Filter, f2Filter, resistFilter, imuneFilter,
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
      if (resistFilter) {
        if (resistFilter === 'has_any') {
          if (!(s.r05_types || []).length && !(s.r025_types || []).length) return false;
        } else {
          const has05 = (s.r05_types || []).includes(resistFilter);
          const has025 = (s.r025_types || []).includes(resistFilter);
          if (!has05 && !has025) return false;
        }
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
      case 'drops': {
        const getDropPct = species => {
          const drops = species.drops_parsed || [];
          if (itemDropFilter) {
            const found = drops.find(d => (d.name || d.nome || d.item) === itemDropFilter);
            return found ? (found.pct || 0) : 0;
          }
          const rels = drops.filter(d => isRelevantDrop(d.name || d.nome || d.item));
          if (!rels.length) return 0;
          return Math.max(...rels.map(d => d.pct || 0));
        };
        comp = getDropPct(a) - getDropPct(b);
        break;
      }
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

function renderStatMeter(val, maxVal, suffix = '', fillColor = '#83ebbc') {
  const num = parseFloat(val) || 0;
  if (num <= 0) return '—';
  const pct = Math.min(100, Math.max(0, (num / maxVal) * 100));
  const fillWidth = Math.round((pct / 100) * 42);
  const formatted = num.toLocaleString('pt-BR') + suffix;
  return `<div><span>${formatted}</span><div style="width:42px;height:4px;margin-top:3px;position:relative;overflow:hidden;"><i style="position:absolute;left:0;top:0;width:42px;border-bottom:2px dashed #2f343f;display:block;"></i><i style="position:absolute;left:0;top:0;width:${fillWidth}px;border-bottom:2px dashed ${fillColor};display:block;"></i></div></div>`;
}

function renderTable(xpBoost, lootBoost) {
  const tbody = document.querySelector('.data-table tbody');
  if (!tbody) return;

  const { filteredSpecies, currentTab, ball, captureBoost, shinyLure, itemDropFilter, hiddenCols = [] } = dexState;
  const isHidden = colKey => hiddenCols.includes(colKey) ? ' col-hidden' : '';
  const cell = (colKey, content, extraCls = '') => {
    const cls = (extraCls + ' ' + isHidden(colKey)).trim();
    return `<td data-col="${colKey}" class="${cls}">${content}</td>`;
  };

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
        ${cell('dex', formattedDex, 'rank')}
        ${cell('nome', mon(r))}
        ${cell('tipo', `<span class="type-row">${r.tipos.map(type).join('')}</span>`)}
        ${cell('hunt', huntText)}
        ${cell('captura', renderStatMeter(bd.numPct, 100, '%', '#30d9d3'), 'stat-positive')}
        ${cell('derrotas', bd.derrotas)}
        ${cell('shiny', shinyText)}
      </tr>`;
    }

    if (currentTab === 'hunt') {
      const xpVal = xpBoost ? (r.xp_boosted || r.xp_base || 0) : (r.xp_base || r.xp_por_derrota || 0);
      const xpText = xpVal > 0 ? xpVal.toLocaleString('pt-BR') : '—';
      return `<tr>
        ${cell('dex', formattedDex, 'rank')}
        ${cell('nome', mon(r))}
        ${cell('tipo', `<span class="type-row">${r.tipos.map(type).join('')}</span>`)}
        ${cell('hunt', huntText)}
        ${cell('f4', renderTypeBadges(r.f4_types), 'col-matchup')}
        ${cell('f2', renderTypeBadges(r.f2_types), 'col-matchup')}
        ${cell('resist', renderResistBadges(r), 'col-matchup')}
        ${cell('imune', renderTypeBadges(r.imune_types), 'col-matchup')}
        ${cell('def', renderStatMeter(r.def_num || r.def, 230))}
        ${cell('spdef', renderStatMeter(r.spdef_num || r.spdef, 230))}
        ${cell('hp', renderStatMeter(r.hp_num || r.hp, 255))}
        ${cell('xp', `${xpText}${xpBoost ? ' <span class="badge update">+50%</span>' : ''}`, 'stat-green')}
      </tr>`;
    }

    if (currentTab === 'loot') {
      const goldNum = parseInt(r.ouro_por_derrota, 10) || 0;
      let relevantDrops = (r.drops_parsed || []).filter(d => isRelevantDrop(d.name || d.nome || d.item));
      if (itemDropFilter) {
        relevantDrops = relevantDrops.filter(d => (d.name || d.nome || d.item) === itemDropFilter);
      }
      const dropsHtml = relevantDrops.length
        ? relevantDrops.map(d => {
            let pct = d.pct;
            if (lootBoost && pct > 0) pct = Math.min(100, Math.round(pct * 1.4 * 100) / 100);
            const itemName = d.name || d.nome || d.item;
            return `<span style="display:inline-block;margin:1px 3px;background:#1e2029;padding:2px 6px;border-radius:4px;font-size:11px;"><b style="color:#f59e0b">${itemName}</b> ${pct}%</span>`;
          }).join('')
        : '—';
      return `<tr>
        ${cell('dex', formattedDex, 'rank')}
        ${cell('nome', mon(r))}
        ${cell('tipo', `<span class="type-row">${r.tipos.map(type).join('')}</span>`)}
        ${cell('hunt', huntText)}
        ${cell('gold', goldNum > 0 ? goldNum.toLocaleString('pt-BR') + ' Gold' : '—', 'stat-gold')}
        ${cell('drops', dropsHtml)}
      </tr>`;
    }

    if (currentTab === 'strong') {
      const evoText = r.evolui_para ? '→ ' + r.evolui_para : 'Não evolui';
      return `<tr>
        ${cell('dex', formattedDex, 'rank')}
        ${cell('nome', mon(r))}
        ${cell('tipo', `<span class="type-row">${r.tipos.map(type).join('')}</span>`)}
        ${cell('hunt', huntText)}
        ${cell('bst', renderStatMeter(r.bst_num || r.total_stats, 670, '', '#f4af25'), 'stat-positive')}
        ${cell('atk', renderStatMeter(r.atk_num || r.atk, 165))}
        ${cell('def', renderStatMeter(r.def_num || r.def, 230))}
        ${cell('spatk', renderStatMeter(r.spatk_num || r.spatk, 145))}
        ${cell('spdef', renderStatMeter(r.spdef_num || r.spdef, 230))}
        ${cell('spd', renderStatMeter(r.spd_num || r.spd, 160))}
        ${cell('estagio', `<span class="badge update">Estágio ${r.estagio_num || r.estagio_evolutivo || 1}</span>`)}
        ${cell('evolucao', evoText)}
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
  const hiddenCols = dexState.hiddenCols || [];
  const isHidden = colKey => hiddenCols.includes(colKey) ? ' col-hidden' : '';

  const th = (label, colKey, extra = '', colCls = '') => {
    const cls = (colCls + ' ' + isHidden(colKey)).trim();
    return `<th data-col="${colKey}" data-sort="${colKey}" class="${cls}" style="cursor:pointer;" ${extra}>${label}<span class="sort-ico"></span></th>`;
  };
  const thNoSort = (label, colKey, colCls = '') => {
    const cls = (colCls + ' ' + isHidden(colKey)).trim();
    return `<th data-col="${colKey}" class="${cls}">${label}</th>`;
  };

  if (mode === 'shiny') {
    return `<tr>
      ${th('#ID', 'dex')}${th('POKÉMON', 'nome')}${th('TIPOS', 'tipo')}${th('HUNT', 'hunt')}
      ${th('% CAPTURA', 'captura')}${th('DERROTAS (MÉDIA)', 'derrotas')}${th('SHINY (1 EM)', 'shiny')}
    </tr>`;
  }
  if (mode === 'hunt') {
    return `<tr>
      ${th('#ID', 'dex')}${th('POKÉMON', 'nome')}${th('TIPOS', 'tipo')}${th('HUNT / LOCAL', 'hunt')}
      ${th('FRAQUEZA 4X', 'f4', '', 'col-matchup')}${th('FRAQUEZA 2X', 'f2', '', 'col-matchup')}
      ${th('RESISTÊNCIA', 'resist', '', 'col-matchup')}${th('IMUNE', 'imune', '', 'col-matchup')}
      ${th('DEF', 'def')}${th('SP.DEF', 'spdef')}${th('HP', 'hp')}${th('XP', 'xp')}
    </tr>`;
  }
  if (mode === 'loot') {
    return `<tr>
      ${th('#ID', 'dex')}${th('POKÉMON', 'nome')}${th('TIPOS', 'tipo')}${th('HUNT / LOCAL', 'hunt')}
      ${th('GOLD NPC', 'gold')}${th('DROPS & CHANCES', 'drops')}
    </tr>`;
  }
  if (mode === 'strong') {
    return `<tr>
      ${th('#ID', 'dex')}${th('POKÉMON', 'nome')}${th('TIPOS', 'tipo')}${th('HUNT / LOCAL', 'hunt')}
      ${th('BST TOTAL', 'bst')}${th('ATK', 'atk')}${th('DEF', 'def')}${th('SP.ATK', 'spatk')}${th('SP.DEF', 'spdef')}${th('SPEED', 'spd')}
      ${th('ESTÁGIO', 'estagio')}${thNoSort('EVOLUÇÃO', 'evolucao')}
    </tr>`;
  }
  return '<tr></tr>';
}

function colToggleHTML() {
  const mode = dexState.currentTab;
  const colsMap = {
    shiny: [
      { id: 'dex', label: '#ID' },
      { id: 'nome', label: 'Pokémon' },
      { id: 'tipo', label: 'Tipos' },
      { id: 'hunt', label: 'Hunt / Local' },
      { id: 'captura', label: '% Captura' },
      { id: 'derrotas', label: 'Derrotas' },
      { id: 'shiny', label: 'Shiny' }
    ],
    hunt: [
      { id: 'dex', label: '#ID' },
      { id: 'nome', label: 'Pokémon' },
      { id: 'tipo', label: 'Tipos' },
      { id: 'hunt', label: 'Hunt / Local' },
      { id: 'f4', label: 'Fraqueza 4x' },
      { id: 'f2', label: 'Fraqueza 2x' },
      { id: 'resist', label: 'Resistência' },
      { id: 'imune', label: 'Imunidade' },
      { id: 'def', label: 'DEF' },
      { id: 'spdef', label: 'SP.DEF' },
      { id: 'hp', label: 'HP' },
      { id: 'xp', label: 'XP' }
    ],
    loot: [
      { id: 'dex', label: '#ID' },
      { id: 'nome', label: 'Pokémon' },
      { id: 'tipo', label: 'Tipos' },
      { id: 'hunt', label: 'Hunt / Local' },
      { id: 'gold', label: 'Gold NPC' },
      { id: 'drops', label: 'Drops' }
    ],
    strong: [
      { id: 'dex', label: '#ID' },
      { id: 'nome', label: 'Pokémon' },
      { id: 'tipo', label: 'Tipos' },
      { id: 'hunt', label: 'Hunt / Local' },
      { id: 'bst', label: 'BST Total' },
      { id: 'atk', label: 'ATK' },
      { id: 'def', label: 'DEF' },
      { id: 'spatk', label: 'SP.ATK' },
      { id: 'spdef', label: 'SP.DEF' },
      { id: 'spd', label: 'SPEED' },
      { id: 'estagio', label: 'Estágio' },
      { id: 'evolucao', label: 'Evolução' }
    ]
  };

  const currentCols = colsMap[mode] || [];
  const hiddenCols = dexState.hiddenCols || [];

  const items = currentCols.map(c => {
    const isChecked = !hiddenCols.includes(c.id);
    return `<label class="cols-popover-item">
      <input type="checkbox" data-col-toggle="${c.id}" ${isChecked ? 'checked' : ''}>
      <span>${c.label}</span>
    </label>`;
  }).join('');

  return `<div class="cols-toggle-container" style="margin-left:auto;flex-shrink:0;">
    <button class="control" id="cols-toggle-btn" title="Exibir / Ocultar Colunas" aria-label="Exibir Colunas" style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;min-width:36px;padding:0;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;color:#d5d7dc;">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    </button>
    <div class="cols-popover" id="cols-popover">
      <div class="cols-popover-title">
        <span>EXIBIR COLUNAS</span>
        <small style="color:#7984f4;cursor:pointer;" id="cols-reset-btn">Restaurar</small>
      </div>
      <div class="cols-popover-list">
        ${items}
      </div>
    </div>
  </div>`;
}

function filterBar(mode) {
  // Filtros globais comuns
  const globalFilters = `
    <input class="control search-field" id="dex-search" placeholder="⌕ Buscar por nome ou #dex..." value="${dexState.search}">
    <select class="control dropdown" id="dex-regiao">${regionOpts()}</select>
  `;

  if (mode === 'shiny') {
    return `<div class="filter-groups" style="display:flex;flex-direction:column;gap:10px;width:100%;">
      <div class="filter-row-top" style="display:flex;flex-wrap:nowrap;align-items:center;gap:6px;width:100%;overflow-x:auto;">
        ${globalFilters}
        <button class="control ${dexState.apenasShiny ? 'selected' : ''}" id="dex-apenas-shiny">✨ Apenas Shiny</button>
        <div class="ball-group" style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0;">
          <span class="group-label">POKÉBOLA</span>
          <button class="control ball ${dexState.ball === 'poke' ? 'selected' : ''}" data-ball="poke">Poké Ball (x1)</button>
          <button class="control ball ${dexState.ball === 'great' ? 'selected' : ''}" data-ball="great">Great Ball</button>
          <button class="control ball ${dexState.ball === 'super' ? 'selected' : ''}" data-ball="super">Super Ball</button>
          <button class="control ball ${dexState.ball === 'ultra' ? 'selected' : ''}" data-ball="ultra">Ultra Ball</button>
          <button class="control ball ${dexState.ball === 'beast' ? 'selected' : ''}" data-ball="beast">Beast Ball</button>
        </div>
        <div class="boost-options" style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0;">
          <span class="group-label">BOOSTS ATIVOS</span>
          <button class="control check ${dexState.captureBoost ? 'selected' : ''}" id="dex-boost-capture">Capture Boost</button>
          <button class="control check ${dexState.shinyLure ? 'selected' : ''}" id="dex-boost-lure">Shiny Lure</button>
        </div>
        ${colToggleHTML()}
      </div>
      <div class="filter-row-bottom" style="width:100%;">
        ${typeSelectorHTML()}
      </div>
    </div>`;
  }

  if (mode === 'hunt') {
    return `<div class="filter-groups" style="display:flex;flex-direction:column;gap:10px;width:100%;">
      <div class="filter-row-top" style="display:flex;flex-wrap:nowrap;align-items:center;gap:6px;width:100%;overflow-x:auto;">
        ${globalFilters}
        <div style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0;">
          <input class="control" id="hunt-nv-min" placeholder="Nv M" type="number" style="width:70px;" value="${dexState.huntLvlMin ?? ''}">
          <span style="color:#858b95;font-size:11px;">a</span>
          <input class="control" id="hunt-nv-max" placeholder="Nv M" type="number" style="width:70px;" value="${dexState.huntLvlMax ?? ''}">
        </div>
        <select class="control dropdown" id="filter-f4">${typeMatchupOpts('Fraqueza 4x')}</select>
        <select class="control dropdown" id="filter-f2">${typeMatchupOpts('Fraqueza 2x')}</select>
        <select class="control dropdown" id="filter-resist">${typeMatchupOpts('Resistência')}</select>
        <select class="control dropdown" id="filter-imune">${typeMatchupOpts('Imunidade')}</select>
        <button class="control check ${dexState.xpBoost ? 'selected' : ''}" id="dex-xp-boost">⚡ XP Boost (+50%)</button>
        ${colToggleHTML()}
      </div>
      <div class="filter-row-bottom" style="width:100%;">
        ${typeSelectorHTML()}
      </div>
    </div>`;
  }

  if (mode === 'loot') {
    return `<div class="filter-groups" style="display:flex;flex-direction:column;gap:10px;width:100%;">
      <div class="filter-row-top" style="display:flex;flex-wrap:nowrap;align-items:center;gap:6px;width:100%;overflow-x:auto;">
        ${globalFilters}
        <div style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0;">
          <input class="control" id="gold-nv-min" placeholder="Nv M" type="number" style="width:70px;" value="${dexState.goldLvlMin ?? ''}">
          <span style="color:#858b95;font-size:11px;">a</span>
          <input class="control" id="gold-nv-max" placeholder="Nv M" type="number" style="width:70px;" value="${dexState.goldLvlMax ?? ''}">
        </div>
        <select class="control dropdown" id="filter-item-drop"><option value="">Todas as stones</option></select>
        <button class="control check ${dexState.lootBoost ? 'selected' : ''}" id="dex-loot-boost">Loot Boost (+40%)</button>
        ${colToggleHTML()}
      </div>
      <div class="filter-row-bottom" style="width:100%;">
        ${typeSelectorHTML()}
      </div>
    </div>`;
  }

  if (mode === 'strong') {
    return `<div class="filter-groups" style="display:flex;flex-direction:column;gap:10px;width:100%;">
      <div class="filter-row-top" style="display:flex;flex-wrap:nowrap;align-items:center;gap:6px;width:100%;overflow-x:auto;">
        ${globalFilters}
        <div style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0;">
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
        ${colToggleHTML()}
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
    <div class="data-panel">
      <table class="data-table">
        <thead>${tableHeader(mode)}</thead>
        <tbody></tbody>
      </table>
    </div>
  `;
}

const defaultAdminImages = {
  homeBanner: '',
  quickIniciante: '',
  quickShiny: '',
  quickXp: '',
  quickWiki: '',
  cardTier: '',
  cardDiscord: ''
};

function getAdminConfig() {
  try {
    const saved = localStorage.getItem('pokeidle_admin_images');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!parsed.homeBanner && parsed.homeBanner1) {
        parsed.homeBanner = parsed.homeBanner1;
      }
      return { ...defaultAdminImages, ...parsed };
    }
  } catch (e) {}
  return { ...defaultAdminImages };
}

function saveAdminConfig(cfg) {
  try {
    localStorage.setItem('pokeidle_admin_images', JSON.stringify(cfg));
    return true;
  } catch (e) {
    console.error('Erro ao salvar imagens admin (Quota excedida):', e);
    showAdminToast('⚠️ Imagem muito grande para o armazenamento do navegador!');
    return false;
  }
}

function compressImage(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      const maxDim = 3200;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/webp', 0.88) || canvas.toDataURL('image/jpeg', 0.88);
      callback(compressed);
    };
    img.onerror = () => callback(e.target.result);
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function home() {
  const cfg = getAdminConfig();

  const quick = [
    ['Iniciante?', 'Veja nosso guia para entender tudo sobre o jogo.', 'Comece aqui', 'guides', cfg.quickIniciante],
    ['Captura de Shiny', 'Entenda a dificuldade de captura de cada espécie.', 'Ver Pokédex', 'pokedex', cfg.quickShiny],
    ['Calculadora de XP', 'Veja o tempo para o próximo nível.', 'Calcular agora', 'xp', cfg.quickXp],
    ['Wiki', 'Todas as informações do jogo em um só lugar.', 'Explorar', 'wiki', cfg.quickWiki]
  ];

  const renderCardImg = (url, fallbackText) => {
    if (url) {
      return `<img src="${url}" alt="${fallbackText}" style="width:100%;height:100%;object-fit:cover;object-position:center;border-radius:inherit;">`;
    }
    return `<span>${fallbackText}</span>`;
  };

  return `<section class="home-wire">
    <section class="section-card home-banner">
      <div class="banner-image">
        ${renderCardImg(cfg.homeBanner, 'Banner promocional')}
      </div>
      <div class="banner-cta">
        <h1>Jogue agora</h1>
        <p>Acesse o PokéIdle e comece sua jornada.</p>
        <a href="https://pokeidle.io/?ref=befoin" target="_blank" rel="noopener noreferrer" class="primary" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none;">Jogue agora</a>
      </div>
    </section>
    <div class="wire-quick-grid">
      ${quick.map(x => `
        <article class="section-card wire-quick">
          <h2>${x[0]}</h2>
          <p>${x[1]}</p>
          <div class="wire-image">${renderCardImg(x[4], 'Imagem')}</div>
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
        <div class="wide-image">${renderCardImg(cfg.cardTier, 'Imagem')}</div>
      </article>
      <article class="section-card wire-wide">
        <div>
          <h2>Entre na comunidade</h2>
          <p>Troque dicas, encontre players, negocie e fique por dentro de todas as novidades.</p>
          <a href="https://discord.gg/cX3nYH9GXa" target="_blank" rel="noopener noreferrer" class="secondary" style="display:inline-flex;align-items:center;text-decoration:none;">Entrar no Discord</a>
        </div>
        <div class="wide-image">${renderCardImg(cfg.cardDiscord, 'Imagem')}</div>
      </article>
    </div>
  </section>`;
}

function attachHomeListeners() {}

function tier() {
  return `<section class="section-card" style="max-width: 760px; margin: 40px auto; padding: 48px 32px; text-align: center; background: linear-gradient(145deg, #181b22 0%, #13161c 100%); border: 1px solid #2d323c; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
    <div style="display:inline-flex; align-items:center; justify-content:center; width:64px; height:64px; border-radius:16px; background:rgba(244,175,37,0.1); border:1px solid rgba(244,175,37,0.25); color:#f4af25; font-size:28px; margin-bottom:20px;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
        <path d="M4 22h16"></path>
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path>
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path>
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2z"></path>
      </svg>
    </div>
    <div style="margin-bottom:12px;">
      <span class="badge" style="background:#f4af25; color:#181b22; font-weight:800; font-size:10px; padding:4px 10px; border-radius:20px; letter-spacing:0.08em; text-transform:uppercase;">EM BREVE</span>
    </div>
    <h1 style="font-size:26px; font-weight:700; color:#ebeef0; margin-bottom:12px;">Criador de Tier Lists</h1>
    <p style="color:#a5a9b2; font-size:14px; max-width:520px; margin:0 auto 28px; line-height:1.6;">
      Estamos desenvolvendo uma ferramenta completa para você criar, personalizar e compartilhar suas próprias Tier Lists de Pokémons e estratégias com a comunidade.
    </p>
    <button class="primary" style="margin-top:0; padding:12px 24px; font-size:12px;" onclick="location.hash='pokedex'">
      Explorar Pokédex
    </button>
  </section>`;
}

// ==========================================
// CALCULADORA DE XP (Hunts, Pokédex & Hunt Analyser)
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

const xpState = {
  strategy: 'optimized', // 'optimized' | 'fixed'
  searchQuery: '',
  selectedDex: '303', // Default Mawile
  lvlFrom: 500,
  lvlTo: 1000,
  speedPreset: '980', // '980' | '1200' | '1500' | '1670' | 'custom'
  customSpeed: 980,
  vip: false,
  xpBoost: false,
  guild: 5,
  event: 0
};

function getXpSpeciesList() {
  const all = dexState.allSpecies || [];
  return Array.from(all).sort((a, b) => {
    const minA = Number(a.hunt_lvl_min ?? a.nivel_hunt_min ?? 1);
    const minB = Number(b.hunt_lvl_min ?? b.nivel_hunt_min ?? 1);
    return minA - minB;
  });
}

function getFilteredXpSpecies() {
  const species = getXpSpeciesList();
  const q = (xpState.searchQuery || '').trim().toLowerCase();
  if (!q) return species;
  return species.filter(p => {
    const nameMatch = (p.nome || '').toLowerCase().includes(q);
    const regMatch = (p.regiao || '').toLowerCase().includes(q);
    const dexMatch = String(p.dex || '').includes(q);
    const lvlMatch = String(p.hunt_lvl_min ?? p.nivel_hunt_min ?? '').includes(q);
    return nameMatch || regMatch || dexMatch || lvlMatch;
  });
}

function getFallbackBaseXp(huntLvl) {
  const hLvl = Math.max(1, Number(huntLvl) || 1);
  if (hLvl <= 150) {
    return Math.floor((6 * hLvl * hLvl) / 10) + 8;
  }
  return Math.round(13500 * Math.pow(hLvl / 150, 1.25));
}

function formatSecShort(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatSecFull(sec) {
  const totalH = Math.floor(sec / 3600);
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m`;
}

function calcXpState() {
  const from = Math.max(1, Number(xpState.lvlFrom) || 1);
  const to = Math.max(from + 1, Number(xpState.lvlTo) || (from + 1));
  const spd = xpState.speedPreset === 'custom' 
    ? Math.max(1, Number(xpState.customSpeed) || 1)
    : Math.max(1, Number(xpState.speedPreset) || 980);

  let mult = 1.0;
  if (xpState.vip) mult += 0.20;
  if (xpState.xpBoost) mult += 0.50;
  mult += (Number(xpState.guild) || 0) / 100;
  mult += (Number(xpState.event) || 0) / 100;

  const totalXpNeeded = Math.max(0, xpTotal(to) - xpTotal(from));
  const speciesList = getXpSpeciesList();
  
  let selectedSpecies = speciesList.find(s => String(s.dex) === String(xpState.selectedDex));
  if (!selectedSpecies && speciesList.length > 0) {
    selectedSpecies = speciesList[0];
    xpState.selectedDex = String(selectedSpecies.dex);
  }

  let totalKills = 0;
  let totalTimeSec = 0;
  let rowsHtml = '';

  if (xpState.strategy === 'fixed') {
    const hLvl = Number(selectedSpecies?.hunt_lvl_min ?? selectedSpecies?.nivel_hunt_min ?? from);
    const baseXp = Number(selectedSpecies?.xp_base) || getFallbackBaseXp(hLvl);
    const xpEfetivo = Math.max(1, Math.floor(baseXp * mult));
    totalKills = Math.ceil(totalXpNeeded / xpEfetivo);
    totalTimeSec = (totalKills / spd) * 3600;

    if (to - from <= 25) {
      let acumSec = 0;
      for (let L = from; L < to; L++) {
        const cost = xpCustoNivel(L);
        const killsL = Math.ceil(cost / xpEfetivo);
        const timeSecL = (killsL / spd) * 3600;
        acumSec += timeSecL;
        rowsHtml += `<tr>
          <td>Nv ${L}</td>
          <td>${selectedSpecies ? `[Nv ${hLvl}] ${selectedSpecies.nome}` : 'Hunt Fixa'}</td>
          <td class="stat-positive">${baseXp.toLocaleString('pt-BR')} XP</td>
          <td class="stat-green">${xpEfetivo.toLocaleString('pt-BR')} XP</td>
          <td>${cost.toLocaleString('pt-BR')}</td>
          <td class="stat-gold">~${killsL.toLocaleString('pt-BR')}</td>
          <td>${formatSecShort(timeSecL)}</td>
          <td>${formatSecShort(acumSec)}</td>
        </tr>`;
      }
    } else {
      const timeStr = formatSecFull(totalTimeSec);
      rowsHtml = `<tr>
        <td>Nv ${from} - ${to - 1}</td>
        <td>${selectedSpecies ? `[Nv ${hLvl}] ${selectedSpecies.nome} (${selectedSpecies.regiao || 'Hoenn'})` : 'Hunt Fixa'}</td>
        <td class="stat-positive">${baseXp.toLocaleString('pt-BR')} XP</td>
        <td class="stat-green">${xpEfetivo.toLocaleString('pt-BR')} XP</td>
        <td>${totalXpNeeded.toLocaleString('pt-BR')}</td>
        <td class="stat-gold">~${totalKills.toLocaleString('pt-BR')}</td>
        <td>${timeStr}</td>
        <td>${timeStr}</td>
      </tr>`;
    }
  } else {
    const stages = [];
    let currentHunt = null;
    let stageStartLvl = from;
    let stageXp = 0;
    let stageKills = 0;
    let stageTimeSec = 0;
    let stageBaseXp = 0;
    let stageEfetivoXp = 0;

    function getBestHunt(L) {
      let best = null;
      for (const s of speciesList) {
        const minL = Number(s.hunt_lvl_min ?? s.nivel_hunt_min ?? 1);
        if (minL <= L) {
          if (!best || (Number(s.xp_base) || 0) > (Number(best.xp_base) || 0)) {
            best = s;
          }
        }
      }
      return best;
    }

    for (let L = from; L < to; L++) {
      const best = getBestHunt(L);
      const cost = xpCustoNivel(L);
      const hLvl = Number(best?.hunt_lvl_min ?? best?.nivel_hunt_min ?? L);
      const baseXp = Number(best?.xp_base) || getFallbackBaseXp(hLvl);
      const xpEfetivo = Math.max(1, Math.floor(baseXp * mult));
      const kills = Math.ceil(cost / xpEfetivo);
      const timeSec = (kills / spd) * 3600;

      if (!currentHunt || currentHunt.dex !== (best?.dex ?? 0)) {
        if (currentHunt) {
          stages.push({
            hunt: currentHunt,
            fromLvl: stageStartLvl,
            toLvl: L - 1,
            xp: stageXp,
            kills: stageKills,
            baseXp: stageBaseXp,
            efetivoXp: stageEfetivoXp,
            timeSec: stageTimeSec
          });
        }
        currentHunt = best;
        stageStartLvl = L;
        stageXp = 0;
        stageKills = 0;
        stageTimeSec = 0;
        stageBaseXp = baseXp;
        stageEfetivoXp = xpEfetivo;
      }
      stageXp += cost;
      stageKills += kills;
      stageTimeSec += timeSec;
      totalTimeSec += timeSec;
      totalKills += kills;
    }
    if (currentHunt) {
      stages.push({
        hunt: currentHunt,
        fromLvl: stageStartLvl,
        toLvl: to - 1,
        xp: stageXp,
        kills: stageKills,
        baseXp: stageBaseXp,
        efetivoXp: stageEfetivoXp,
        timeSec: stageTimeSec
      });
    }

    let acumSec = 0;
    stages.forEach(st => {
      acumSec += st.timeSec;
      const hLvl = Number(st.hunt?.hunt_lvl_min ?? st.hunt?.nivel_hunt_min ?? st.fromLvl);
      const huntLabel = st.hunt ? `[Nv ${hLvl}] ${st.hunt.nome} (${st.hunt.regiao || ''})` : `Nv ${st.fromLvl}`;
      const lvlLabel = st.fromLvl === st.toLvl ? `Nv ${st.fromLvl}` : `Nv ${st.fromLvl} - ${st.toLvl}`;
      rowsHtml += `<tr>
        <td>${lvlLabel}</td>
        <td>${huntLabel}</td>
        <td class="stat-positive">${st.baseXp.toLocaleString('pt-BR')} XP</td>
        <td class="stat-green">${st.efetivoXp.toLocaleString('pt-BR')} XP</td>
        <td>${st.xp.toLocaleString('pt-BR')}</td>
        <td class="stat-gold">~${st.kills.toLocaleString('pt-BR')}</td>
        <td>${formatSecShort(st.timeSec)}</td>
        <td>${formatSecShort(acumSec)}</td>
      </tr>`;
    });
  }

  const avgXpPerKill = totalKills > 0 ? Math.round(totalXpNeeded / totalKills) : 0;
  const tempoStr = formatSecFull(totalTimeSec);

  return {
    totalXp: totalXpNeeded,
    tempoStr,
    totalKills,
    avgXpPerKill,
    rowsHtml,
    mult
  };
}

function xp() {
  const filteredSpecies = getFilteredXpSpecies();
  const res = calcXpState();

  const optionsHtml = filteredSpecies.map(p => {
    const hLvl = p.hunt_lvl_min ?? p.nivel_hunt_min ?? 1;
    const baseXp = p.xp_base ? `${p.xp_base.toLocaleString('pt-BR')} Base XP` : '';
    const sel = String(p.dex) === String(xpState.selectedDex) ? 'selected' : '';
    return `<option value="${p.dex}" ${sel}>[Nv ${hLvl}] ${p.nome} (${p.regiao || 'Kanto'}) ${baseXp ? '— ' + baseXp : ''}</option>`;
  }).join('');

  const isCustomSpeed = xpState.speedPreset === 'custom';

  return `
    <p class="eyebrow">Ferramentas › Calculadora de XP</p>
    <h1 style="margin:2px 0 16px">Calculadora de XP</h1>
    
    <div class="xp-layout">
      <div>
        <div class="form-card section-card">
          <h3 style="margin-bottom:8px">ESTRATÉGIA DE FARM</h3>
          <div class="xp-strategy-grid">
            <button class="xp-strategy-btn ${xpState.strategy === 'optimized' ? 'active' : ''}" id="xp-strat-opt">
              ↺ Rota Otimizada (Trocar nos Degraus)
            </button>
            <button class="xp-strategy-btn ${xpState.strategy === 'fixed' ? 'active' : ''}" id="xp-strat-fixed">
              📍 Hunt Fixa (Mesma Hunt Sempre)
            </button>
          </div>
          <p class="xp-note-text">
            ${xpState.strategy === 'optimized' 
              ? '* <b>Rota Otimizada</b>: migra automaticamente para hunts mais fortes assim que o nível da próxima hunt é alcançado, economizando dias de farm.'
              : '* <b>Hunt Fixa</b>: calcula o tempo e abates necessários permanecendo exclusivamente na hunt selecionada do início ao fim.'}
          </p>

          <h3 style="margin-top:14px;margin-bottom:8px">NÍVEL DO TREINADOR</h3>
          <div class="form-grid">
            <div class="field">
              <label>Nível Atual (de)</label>
              <input type="number" id="xp-in-from" value="${xpState.lvlFrom}">
            </div>
            <div class="field">
              <label>Nível Alvo (até)</label>
              <input type="number" id="xp-in-to" value="${xpState.lvlTo}">
            </div>
          </div>

          <div class="xp-hunt-header" style="margin-top:14px">
            <span style="font-size:11px;font-weight:800;color:#a9aeb8;text-transform:uppercase;">
              ${xpState.strategy === 'fixed' ? 'HUNT FIXA SELECIONADA' : 'HUNT INICIAL DE PARTIDA'}
            </span>
            <span class="xp-hunt-count" id="xp-hunt-count-badge">${filteredSpecies.length} Hunts</span>
          </div>
          <div style="margin-bottom:6px">
            <input class="control search-field" id="xp-search-hunt" placeholder="⌕ Pesquisar hunt (ex: mawil)..." value="${xpState.searchQuery}" style="width:100%;">
          </div>
          <div class="xp-hunt-row">
            <select id="xp-select-hunt" class="control select-control" style="flex:1;">
              ${optionsHtml}
            </select>
            <button id="xp-btn-pokedex" class="secondary" title="Ver tabela na Pokédex">📋 Tabela</button>
          </div>

          <h3 style="margin-top:14px;margin-bottom:8px">VELOCIDADE DE COMBATE / CADÊNCIA DE ABATE</h3>
          <div class="field" style="margin-bottom:6px">
            <select id="xp-select-speed">
              <option value="980" ${xpState.speedPreset === '980' ? 'selected' : ''}>Rápido / Padrão (~980 abates/hora)</option>
              <option value="1200" ${xpState.speedPreset === '1200' ? 'selected' : ''}>Eficiente (~1200 abates/hora)</option>
              <option value="1500" ${xpState.speedPreset === '1500' ? 'selected' : ''}>Avançado (~1500 abates/hora)</option>
              <option value="1670" ${xpState.speedPreset === '1670' ? 'selected' : ''}>Máximo (~1670 abates/hora)</option>
              <option value="custom" ${isCustomSpeed ? 'selected' : ''}>Personalizado (Hunt Analyser)</option>
            </select>
          </div>
          ${isCustomSpeed ? `
            <div class="field" style="margin-top:6px;">
              <label>Abates / Hora (Hunt Analyser)</label>
              <input type="number" id="xp-custom-speed" value="${xpState.customSpeed}" placeholder="Ex: 1100">
            </div>
          ` : ''}
          <p class="xp-note-text" style="margin-top:4px;">
            * Baseado nos abates reais por hora medidos pelo <b>Hunt Analyser</b> in-game.
          </p>

          <h3 style="margin-top:14px;margin-bottom:8px">BÔNUS & MULTIPLICADORES ATIVOS</h3>
          <div class="toggle-line">
            <label style="cursor:pointer;display:flex;align-items:center;gap:8px;">
              <input type="checkbox" id="xp-ck-vip" ${xpState.vip ? 'checked' : ''}> Assinatura VIP (+20% XP)
            </label>
          </div>
          <div class="toggle-line">
            <label style="cursor:pointer;display:flex;align-items:center;gap:8px;">
              <input type="checkbox" id="xp-ck-boost" ${xpState.xpBoost ? 'checked' : ''}> XP Boost (+50% XP)
            </label>
          </div>
          <div class="form-grid" style="margin-top:8px">
            <div class="field">
              <label>Bônus de Guild (%)</label>
              <input type="number" id="xp-in-guild" value="${xpState.guild}">
            </div>
            <div class="field">
              <label>Bônus de Evento (%)</label>
              <input type="number" id="xp-in-event" value="${xpState.event}">
            </div>
          </div>
        </div>
      </div>

      <div>
        <div class="metrics">
          <article class="metric">
            <b id="xp-out-total">${res.totalXp.toLocaleString('pt-BR')}</b>
            <small>XP TOTAL NECESSÁRIO</small>
          </article>
          <article class="metric">
            <b id="xp-out-tempo">${res.tempoStr}</b>
            <small>TEMPO TOTAL ESTIMADO</small>
          </article>
          <article class="metric yellow">
            <b id="xp-out-abates">~${res.totalKills.toLocaleString('pt-BR')}</b>
            <small>ABATES NECESSÁRIOS</small>
          </article>
          <article class="metric yellow">
            <b id="xp-out-efetivo">~${res.avgXpPerKill.toLocaleString('pt-BR')} XP</b>
            <small>XP MÉDIO / KILL</small>
          </article>
        </div>
        <p class="note">* Tabela de progressão calculada com base nas mecânicas de hunt e XP do PokéIdle.</p>
        <div class="data-panel">
          <table class="data-table">
            <thead>
              <tr>
                <th>FAIXA / NÍVEL</th>
                <th>HUNT</th>
                <th>XP BASE</th>
                <th>XP/KILL C/ BÔNUS</th>
                <th>XP NECESSÁRIO</th>
                <th>ABATES EST.</th>
                <th>TEMPO DA ETAPA</th>
                <th>TEMPO ACUMULADO</th>
              </tr>
            </thead>
            <tbody id="xp-out-rows">
              ${res.rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function attachXpListeners() {
  const updateUI = () => {
    const container = document.getElementById('app') || document.body;
    if (container) {
      container.innerHTML = xp();
      attachXpListeners();
    }
  };

  const softRecalc = () => {
    const res = calcXpState();
    const outTotal = document.getElementById('xp-out-total');
    const outTempo = document.getElementById('xp-out-tempo');
    const outAbates = document.getElementById('xp-out-abates');
    const outEfetivo = document.getElementById('xp-out-efetivo');
    const outRows = document.getElementById('xp-out-rows');

    if (outTotal) outTotal.textContent = res.totalXp.toLocaleString('pt-BR');
    if (outTempo) outTempo.textContent = res.tempoStr;
    if (outAbates) outAbates.textContent = '~' + res.totalKills.toLocaleString('pt-BR');
    if (outEfetivo) outEfetivo.textContent = '~' + res.avgXpPerKill.toLocaleString('pt-BR') + ' XP';
    if (outRows) outRows.innerHTML = res.rowsHtml;
  };

  document.getElementById('xp-strat-opt')?.addEventListener('click', () => {
    xpState.strategy = 'optimized';
    updateUI();
  });
  document.getElementById('xp-strat-fixed')?.addEventListener('click', () => {
    xpState.strategy = 'fixed';
    updateUI();
  });

  document.getElementById('xp-in-from')?.addEventListener('input', (e) => {
    xpState.lvlFrom = Number(e.target.value) || 1;
    softRecalc();
  });
  document.getElementById('xp-in-to')?.addEventListener('input', (e) => {
    xpState.lvlTo = Number(e.target.value) || 2;
    softRecalc();
  });

  const searchInput = document.getElementById('xp-search-hunt');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      xpState.searchQuery = e.target.value;
      const filteredSpecies = getFilteredXpSpecies();
      const badge = document.getElementById('xp-hunt-count-badge');
      if (badge) badge.textContent = `${filteredSpecies.length} Hunts`;

      const select = document.getElementById('xp-select-hunt');
      if (select) {
        if (filteredSpecies.length > 0 && !filteredSpecies.some(p => String(p.dex) === String(xpState.selectedDex))) {
          xpState.selectedDex = String(filteredSpecies[0].dex);
        }
        select.innerHTML = filteredSpecies.map(p => {
          const minLvl = p.hunt_lvl_min ?? p.nivel_hunt_min ?? 1;
          const label = `[Nv ${minLvl}] ${p.nome} (${p.regiao || 'Kanto'}) — ${p.xp_base || 0} Base XP`;
          return `<option value="${p.dex}" ${String(p.dex) === String(xpState.selectedDex) ? 'selected' : ''}>${label}</option>`;
        }).join('');
      }
      softRecalc();
    });
  }

  document.getElementById('xp-select-hunt')?.addEventListener('change', (e) => {
    xpState.selectedDex = e.target.value;
    softRecalc();
  });

  document.getElementById('xp-btn-pokedex')?.addEventListener('click', () => {
    window.location.hash = '#pokedex';
  });

  document.getElementById('xp-select-speed')?.addEventListener('change', (e) => {
    xpState.speedPreset = e.target.value;
    updateUI();
  });

  document.getElementById('xp-custom-speed')?.addEventListener('input', (e) => {
    xpState.customSpeed = Number(e.target.value) || 1;
    softRecalc();
  });

  document.getElementById('xp-ck-vip')?.addEventListener('change', (e) => {
    xpState.vip = e.target.checked;
    softRecalc();
  });
  document.getElementById('xp-ck-boost')?.addEventListener('change', (e) => {
    xpState.xpBoost = e.target.checked;
    softRecalc();
  });
  document.getElementById('xp-in-guild')?.addEventListener('input', (e) => {
    xpState.guild = Number(e.target.value) || 0;
    softRecalc();
  });
  document.getElementById('xp-in-event')?.addEventListener('input', (e) => {
    xpState.event = Number(e.target.value) || 0;
    softRecalc();
  });
}


function guides() {
  return `<div class="split-top"><div><p class="eyebrow">Aprender › Guias</p><h1>Guias da comunidade</h1></div></div><div class="guide-grid">${names.map((n,i)=>`<article class="guide-card"><span class="badge ${i%2?'update':''}">Guia</span><h3>${n}</h3><small><span>${5+i} min</span></small></article>`).join('')}</div>`;
}
function wiki() {
  return `<div class="wiki-layout"><aside class="wiki-rail"><strong>BUSCAR</strong><input placeholder="⌕ Buscar na wiki..."><strong>MECÂNICAS DO IDLE</strong><button class="active">Como funciona o Idle</button></aside><article class="article"><h1>Como funciona o Idle <span class="badge update">Mecânicas</span></h1><p>O PokéIdle gera progresso continuamente.</p></article></div>`;
}
function admin() {
  const cfg = getAdminConfig();

  const slots = [
    { key: 'homeBanner', title: 'Banner Hero (3200 × 700 px)', desc: 'Imagem principal do banner no topo da Home' },
    { key: 'quickIniciante', title: 'Card Iniciante?', desc: 'Imagem promocional do card de guias iniciais' },
    { key: 'quickShiny', title: 'Card Captura de Shiny', desc: 'Imagem promocional do card da Pokédex Shiny' },
    { key: 'quickXp', title: 'Card Calculadora de XP', desc: 'Imagem promocional do card Calculadora de XP' },
    { key: 'quickWiki', title: 'Card Wiki', desc: 'Imagem promocional do card da Wiki' },
    { key: 'cardTier', title: 'Card Tier List', desc: 'Imagem promocional do card Tier List' },
    { key: 'cardDiscord', title: 'Card Comunidade (Discord)', desc: 'Imagem promocional do card do Discord' }
  ];

  return `
    <div class="split-top" style="align-items:center;">
      <div>
        <p class="eyebrow">Administração › Gerenciador de Mídia</p>
        <h1 style="margin-top:2px;">Painel Administrativo de Imagens</h1>
      </div>
      <button class="primary" id="adm-btn-save" style="margin:0;padding:10px 22px;font-size:12px;">
        💾 Salvar Alterações
      </button>
    </div>

    <p class="note" style="margin-top:-6px;margin-bottom:24px;">
      Altere os links das imagens ou faça upload de arquivos (suporta resolução até 3200 × 700 px). As alterações são aplicadas instantaneamente em todas as páginas do PokéIdle.
    </p>

    <div class="asset-grid" style="display:grid;grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px;">
      ${slots.map(s => {
        const val = cfg[s.key] || '';
        return `
          <div class="section-card asset" style="padding:16px;">
            <b style="font-size:14px;color:#ebeef0;">${s.title}</b>
            <small style="display:block;color:#858b95;margin:2px 0 12px;font-size:11px;">${s.desc}</small>
            
            <div class="asset-preview" style="height:150px;display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid #303641;border-radius:6px;background:#171a21;position:relative;">
              <img class="adm-img-preview" data-key="${s.key}" src="${val}" style="width:100%;height:100%;object-fit:cover;object-position:center;${val ? '' : 'display:none;'}" alt="${s.title}">
              <span style="color:#69707c;font-size:11px;font-weight:700;${val ? 'display:none;' : ''}">Sem Imagem Definida</span>
            </div>

            <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">
              <input type="text" class="control adm-url-input" data-key="${s.key}" value="${val}" placeholder="URL da imagem ou caminho..." style="width:100%;">
              
              <input type="file" accept="image/*" class="adm-file-input" data-key="${s.key}" style="display:none;">
              <div class="asset-actions" style="display:flex;gap:8px;">
                <button class="secondary adm-btn-upload" data-key="${s.key}" style="flex:1;">📁 Upload de Imagem</button>
                <button class="secondary danger adm-btn-reset" data-key="${s.key}" title="Restaurar imagem padrão">↺ Padrão</button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function showAdminToast(msg) {
  let toast = document.getElementById('adm-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'adm-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;background:#22d656;color:#102818;font-weight:800;font-size:13px;padding:12px 20px;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,0.5);transition:all 0.2s ease;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.display = 'block';
  toast.style.opacity = '1';
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 200);
  }, 2500);
}

function attachAdminListeners() {
  const cfg = getAdminConfig();

  document.querySelectorAll('.adm-file-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const key = e.target.dataset.key;
      const file = e.target.files[0];
      if (file) {
        compressImage(file, (dataUrl) => {
          cfg[key] = dataUrl;
          saveAdminConfig(cfg);
          const textInput = document.querySelector(`.adm-url-input[data-key="${key}"]`);
          if (textInput) textInput.value = dataUrl;
          const imgPreview = document.querySelector(`.adm-img-preview[data-key="${key}"]`);
          if (imgPreview) {
            imgPreview.src = dataUrl;
            imgPreview.style.display = 'block';
            if (imgPreview.nextElementSibling) imgPreview.nextElementSibling.style.display = 'none';
          }
          showAdminToast('✓ Imagem otimizada e carregada!');
        });
      }
    });
  });

  document.querySelectorAll('.adm-btn-upload').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const fileInput = document.querySelector(`.adm-file-input[data-key="${key}"]`);
      fileInput?.click();
    });
  });

  document.querySelectorAll('.adm-url-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const key = e.target.dataset.key;
      const val = e.target.value.trim();
      cfg[key] = val;
      saveAdminConfig(cfg);
      const imgPreview = document.querySelector(`.adm-img-preview[data-key="${key}"]`);
      if (imgPreview) {
        if (val) {
          imgPreview.src = val;
          imgPreview.style.display = 'block';
          if (imgPreview.nextElementSibling) imgPreview.nextElementSibling.style.display = 'none';
        } else {
          imgPreview.style.display = 'none';
          if (imgPreview.nextElementSibling) imgPreview.nextElementSibling.style.display = 'inline';
        }
      }
    });
  });

  document.querySelectorAll('.adm-btn-reset').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      cfg[key] = defaultAdminImages[key] || '';
      saveAdminConfig(cfg);
      const textInput = document.querySelector(`.adm-url-input[data-key="${key}"]`);
      if (textInput) textInput.value = cfg[key];
      const imgPreview = document.querySelector(`.adm-img-preview[data-key="${key}"]`);
      if (imgPreview) {
        if (cfg[key]) {
          imgPreview.src = cfg[key];
          imgPreview.style.display = 'block';
          if (imgPreview.nextElementSibling) imgPreview.nextElementSibling.style.display = 'none';
        } else {
          imgPreview.style.display = 'none';
          if (imgPreview.nextElementSibling) imgPreview.nextElementSibling.style.display = 'inline';
        }
      }
      showAdminToast('Imagem restaurada para o padrão!');
    });
  });

  document.getElementById('adm-btn-save')?.addEventListener('click', () => {
    document.querySelectorAll('.adm-url-input').forEach(input => {
      const key = input.dataset.key;
      cfg[key] = input.value.trim();
    });
    const success = saveAdminConfig(cfg);
    if (success) {
      showAdminToast('✓ Todas as alterações foram salvas com sucesso!');
    }
  });
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
  setVal('filter-resist', dexState.resistFilter);
  setVal('filter-imune', dexState.imuneFilter);
  setVal('filter-item-drop', dexState.itemDropFilter);

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
  document.getElementById('filter-resist')?.addEventListener('change', e => {
    dexState.resistFilter = e.target.value;
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
    if (e.target.value) {
      dexState.sortCol = 'drops';
      dexState.sortDir = 'desc';
    } else {
      dexState.sortCol = 'gold';
      dexState.sortDir = 'desc';
    }
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

  // Popover de ocultar colunas
  const toggleBtn = document.getElementById('cols-toggle-btn');
  const popover = document.getElementById('cols-popover');
  if (toggleBtn && popover) {
    toggleBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      popover.classList.toggle('open');
    });

    popover.addEventListener('click', e => {
      e.stopPropagation();
      if (e.target.id === 'cols-reset-btn' || e.target.closest('#cols-reset-btn')) {
        dexState.hiddenCols = [];
        popover.querySelectorAll('input[type="checkbox"]').forEach(input => {
          input.checked = true;
        });
        document.querySelectorAll('.data-table [data-col]').forEach(el => {
          el.classList.remove('col-hidden');
        });
        applyFiltersAndRender();
      }
    });

    popover.addEventListener('change', e => {
      const input = e.target.closest('input[data-col-toggle]');
      if (!input) return;
      const colId = input.dataset.colToggle;
      if (input.checked) {
        dexState.hiddenCols = dexState.hiddenCols.filter(c => c !== colId);
      } else {
        if (!dexState.hiddenCols.includes(colId)) dexState.hiddenCols.push(colId);
      }
      document.querySelectorAll(`.data-table [data-col="${colId}"]`).forEach(el => {
        el.classList.toggle('col-hidden', !input.checked);
      });
    });

    document.addEventListener('click', e => {
      if (!popover.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
        popover.classList.remove('open');
      }
    });
  }

  // Preencher dropdown de itens da aba Loot (apenas relevantes)
  if (mode === 'loot') {
    const itemSel = document.getElementById('filter-item-drop');
    if (itemSel && dexState.allSpecies.length > 0) {
      const itemSet = new Set();
      dexState.allSpecies.forEach(s => {
        (s.item_names || []).forEach(i => {
          if (i && isRelevantDrop(i)) itemSet.add(i);
        });
      });
      const sorted = Array.from(itemSet).sort((a,b) => a.localeCompare(b));
      itemSel.innerHTML = '<option value="">Todas as stones</option>' + sorted.map(i => `<option value="${i}">${i}</option>`).join('');
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

  if ((view === 'pokedex' || view === 'xp') && dexState.allSpecies.length === 0) {
    loadPokemonData().then(() => render());
    return;
  }

  app.innerHTML = views[view](route[1] || 'shiny');
  document.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === view));
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => location.hash = b.dataset.go));

  if (view === 'home') {
    attachHomeListeners();
  }
  if (view === 'pokedex') {
    attachDexListeners(route[1] || 'shiny');
  }
  if (view === 'xp') {
    attachXpListeners();
  }
  if (view === 'admin') {
    attachAdminListeners();
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
render();
