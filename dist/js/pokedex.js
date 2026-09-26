import { criarCanvasSprite } from './sprites.js';

/**
 * Verifica se um nome de item é uma pedra ou item evolutivo útil
 */
export function isUsefulStoneDrop(itemName) {
  if (!itemName) return false;
  const name = String(itemName).trim().toLowerCase();
  if (name.includes('stone')) return true;
  const evoItems = [
    'metal coat', "king's rock", 'kings rock', 'dragon scale', 'up-grade',
    'dubious disc', 'electirizer', 'magmarizer', 'protector', 'reaper cloth',
    'razor claw', 'razor fang', 'deep sea tooth', 'deep sea scale', 'prism scale',
    'sachet', 'whipped dream', 'oval stone'
  ];
  return evoItems.some(item => name.includes(item));
}

// Nomes oficiais dos tipos em inglês (para bater com o game)
const TYPE_LABELS = {
  BUG: 'Bug',
  POISON: 'Poison',
  NORMAL: 'Normal',
  FLYING: 'Flying',
  GRASS: 'Grass',
  WATER: 'Water',
  FIRE: 'Fire',
  ELECTRIC: 'Electric',
  GROUND: 'Ground',
  PSYCHIC: 'Psychic',
  ROCK: 'Rock',
  ICE: 'Ice',
  FIGHTING: 'Fighting',
  GHOST: 'Ghost',
  DRAGON: 'Dragon',
  STEEL: 'Steel',
  DARK: 'Dark',
  FAIRY: 'Fairy',
  ALTERED: 'Ghost',
  FORME: 'Dragon'
};

const TYPE_CLASSES = {
  BUG: 'clean-type-bug',
  POISON: 'clean-type-poison',
  NORMAL: 'clean-type-normal',
  FLYING: 'clean-type-flying',
  GRASS: 'clean-type-grass',
  WATER: 'clean-type-water',
  FIRE: 'clean-type-fire',
  ELECTRIC: 'clean-type-electric',
  GROUND: 'clean-type-ground',
  PSYCHIC: 'clean-type-psychic',
  ROCK: 'clean-type-rock',
  ICE: 'clean-type-ice',
  FIGHTING: 'Fighting',
  GHOST: 'clean-type-ghost',
  DRAGON: 'clean-type-dragon',
  STEEL: 'clean-type-steel',
  DARK: 'clean-type-dark',
  FAIRY: 'clean-type-fairy'
};

export const pokedexState = {
  allSpecies: [],
  filteredSpecies: [],
  currentTab: 'captura', // 'captura' | 'hunting' | 'gold_loot' | 'fortes'
  
  // Tab 1: Captura e Shiny
  ball: 'beast',
  captureBoost: false,
  shinyLure: false,
  huntFilter: 'all',

  // Tab 2: Hunting (Filtros específicos e granulares)
  huntLvlMin: null,
  huntLvlMax: null,
  f4Filter: 'all',
  f2Filter: 'all',
  r05Filter: 'all',
  r025Filter: 'all',
  imuneFilter: 'all',
  xpBoost: false, // +50% XP

  // Tab 3: Gold e Loot
  goldLvlMin: null,
  goldLvlMax: null,
  itemDropFilter: 'all',
  sortGoldDir: 'desc',
  lootBoost: false, // +40% chance de loot

  // Tab 4: Pokemons Fortes
  fortesLvlMin: null,
  fortesLvlMax: null,
  estagioFilter: 'all',
  sortFortesMode: 'bst_desc',

  // Filtros Globais
  search: '',
  type1Filter: 'all',
  type2Filter: 'all',
  shinyOnly: false,
  regionFilter: 'all',
  sortCol: 'dex',
  sortDir: 'asc',

  // Sem limite de páginas — lista contínua / infinita rolando para baixo
  currentPage: 1,
  pageSize: 999999
};

// Mapa de sprites de Pokémon (dex -> arquivo png oficial)
let dexSpriteMap = {};

/**
 * Inicializa a Pokédex oficial
 */
export async function initPokedex() {
  try {
    const [dexRes, spriteMapRes] = await Promise.all([
      fetch('data/pokedex_portal.json'),
      fetch('data/dex_sprite_map.json').catch(() => null)
    ]);

    if (!dexRes.ok) throw new Error(`HTTP ${dexRes.status}`);
    const raw = await dexRes.json();
    pokedexState.allSpecies = raw.filter(p => p.is_cacavel && p.hunt_tag !== 'sem hunt no mapa hoje').map(s => {
      let parsed = s.drops_parsed;
      if (!parsed || !Array.isArray(parsed)) {
        if (s.drops && typeof s.drops === 'string') {
          parsed = s.drops.split('|').map(rawDrop => {
            const parts = rawDrop.trim().match(/^(.+?)\s+([\d.,]+)%\s*(.*)$/);
            if (parts) {
              return {
                name: parts[1].trim(),
                pct: parseFloat(parts[2].replace(',', '.')),
                raw: rawDrop.trim()
              };
            }
            return { name: rawDrop.trim(), pct: 0, raw: rawDrop.trim() };
          });
        } else {
          parsed = [];
        }
      }

      const cleanDrops = parsed.map(d => {
        const name = d.name || d.nome || d.item || 'Item';
        const pct = typeof d.pct === 'number' ? d.pct : (parseFloat(String(d.pct).replace(',', '.')) || 0);
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        return { ...d, name, pct, slug };
      });

      const stoneDrops = cleanDrops.filter(d => isUsefulStoneDrop(d.name));

      return {
        ...s,
        drops_parsed: cleanDrops,
        stone_drops: stoneDrops
      };
    });

    if (spriteMapRes && spriteMapRes.ok) {
      dexSpriteMap = await spriteMapRes.json();
    }

    populateItemsDropdown();
    setupModeTabs();
    setupPokedexControls();
    switchTab('captura');
  } catch (err) {
    console.error('Falha ao carregar pokedex_portal.json:', err);
    const tbody = document.getElementById('pokedex-body');
    if (tbody) {
      tbody.innerHTML = `
        <tr><td colspan="14" style="text-align: center; padding: 2.5rem; color: #ef4444;">
          Erro ao carregar dados oficiais de <code>pokedex_portal.json</code>.
        </td></tr>
      `;
    }
  }
}

/**
 * Preenche o dropdown de Itens/Drops dinamicamente com os 288 itens reais da tabela
 */
function populateItemsDropdown() {
  const select = document.getElementById('filter-gold-item-drop');
  if (!select) return;

  const itemSet = new Set();
  pokedexState.allSpecies.forEach(s => {
    (s.item_names || []).forEach(item => {
      if (item && item.length > 1) itemSet.add(item);
    });
  });

  const sortedItems = Array.from(itemSet).sort((a, b) => a.localeCompare(b));
  let optionsHtml = '<option value="all">Todos os Drops (Itens)</option>';
  sortedItems.forEach(it => {
    optionsHtml += `<option value="${it}">${it}</option>`;
  });
  select.innerHTML = optionsHtml;
}

/**
 * Configura a troca entre as 4 Abas Oficiais
 */
function setupModeTabs() {
  document.querySelectorAll('.dex-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

export function switchTab(tabKey) {
  pokedexState.currentTab = tabKey;
  pokedexState.currentPage = 1;

  // Atualiza botões das abas
  document.querySelectorAll('.dex-tab-btn').forEach(b => {
    const isActive = b.dataset.tab === tabKey;
    b.classList.toggle('active', isActive);
    b.classList.toggle('on', isActive);
    b.classList.toggle('apagado', !isActive);
  });

  // Mostra apenas o painel de filtros correspondente
  document.querySelectorAll('.tab-filters-panel').forEach(p => p.style.display = 'none');
  const activePanel = document.getElementById(`tab-filters-${tabKey.replace('_', '-')}`);
  if (activePanel) activePanel.style.display = 'block';

  // Configura ordenação padrão coerente para cada aba
  if (tabKey === 'captura') {
    pokedexState.sortCol = 'dex';
    pokedexState.sortDir = 'asc';
  } else if (tabKey === 'hunting') {
    pokedexState.sortCol = 'xp';
    pokedexState.sortDir = 'desc';
  } else if (tabKey === 'gold_loot') {
    pokedexState.sortCol = 'gold';
    pokedexState.sortDir = 'desc';
  } else if (tabKey === 'fortes') {
    pokedexState.sortCol = 'bst';
    pokedexState.sortDir = 'desc';
  }

  renderTableHeader();
  applyFiltersAndRender();
}

/**
 * Renderiza o cabeçalho <thead> exato para a aba ativa
 */
function renderTableHeader() {
  const thead = document.getElementById('clean-table-thead');
  if (!thead) return;

  const { currentTab, sortCol, sortDir } = pokedexState;

  const th = (colKey, label, width = '', align = 'left', isNum = false) => {
    const isActive = sortCol === colKey;
    const sortClass = isActive ? (sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc') : '';
    const numClass = isNum ? 'num-col' : '';
    const centerClass = align === 'center' ? 'center-col' : '';
    const style = width ? `style="width: ${width};"` : '';
    return `<th data-sort="${colKey}" class="sortable ${sortClass} ${numClass} ${centerClass}" ${style}>${label}</th>`;
  };

  let html = '<tr>';

  if (currentTab === 'captura') {
    html += th('dex', '#ID', '70px');
    html += th('nome', 'POKÉMON');
    html += th('tipo', 'TIPOS', '140px');
    html += th('hunt', 'HUNT');
    html += th('captura', 'CATCH RATE', '120px', 'right', true);
    html += th('derrotas', 'MÉDIA DERROTAS', '140px', 'right', true);
    html += th('shiny', 'SHINY ODDS', '140px', 'right', true);
    html += '<th class="center-col" style="width: 100px;">AÇÕES</th>';
  } else if (currentTab === 'hunting') {
    html += th('dex', '#ID', '70px');
    html += th('nome', 'POKÉMON');
    html += th('tipo', 'TIPOS', '140px');
    html += th('hunt', 'HUNT');
    html += th('f4', 'FRAQUEZA 4X');
    html += th('f2', 'FRAQUEZA 2X');
    html += th('r05', 'RESIST. 0,5X');
    html += th('r025', 'RESIST. 0,25X');
    html += th('imune', 'IMUNE');
    html += th('def', 'DEF', '60px', 'right', true);
    html += th('spdef', 'SP.DEF', '65px', 'right', true);
    html += th('hp', 'HP', '60px', 'right', true);
    html += th('xp', 'XP', '90px', 'right', true);
    html += '<th class="center-col" style="width: 100px;">AÇÕES</th>';
  } else if (currentTab === 'gold_loot') {
    html += th('dex', '#ID', '70px');
    html += th('nome', 'POKÉMON');
    html += th('tipo', 'TIPOS', '140px');
    html += th('hunt', 'HUNT');
    html += th('gold', 'GOLD NPC', '120px', 'right', true);
    html += th('drops', 'DROPS & CHANCES');
    html += '<th class="center-col" style="width: 100px;">AÇÕES</th>';
  } else if (currentTab === 'fortes') {
    html += th('dex', '#ID', '70px');
    html += th('nome', 'POKÉMON');
    html += th('tipo', 'TIPOS', '140px');
    html += th('hunt', 'HUNT');
    html += th('bst', 'BST TOTAL', '90px', 'right', true);
    html += th('hp', 'HP', '55px', 'right', true);
    html += th('atk', 'ATK', '55px', 'right', true);
    html += th('def', 'DEF', '55px', 'right', true);
    html += th('spatk', 'SP.ATK', '60px', 'right', true);
    html += th('spdef', 'SP.DEF', '60px', 'right', true);
    html += th('spd', 'SPEED', '60px', 'right', true);
    html += th('estagio', 'ESTÁGIO', '80px');
    html += th('evolui_para', 'EVOLUÇÃO');
    html += '<th class="center-col" style="width: 100px;">AÇÕES</th>';
  }

  html += '</tr>';
  thead.innerHTML = html;

  // Reconecta clique nos cabeçalhos
  thead.querySelectorAll('th.sortable').forEach(header => {
    header.addEventListener('click', () => {
      const col = header.dataset.sort;
      if (pokedexState.sortCol === col) {
        pokedexState.sortDir = pokedexState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        pokedexState.sortCol = col;
        // Padrão numérico começa desc para bst/xp/gold/captura; asc para dex/derrotas/shiny/nome
        pokedexState.sortDir = ['bst', 'hp', 'atk', 'def', 'spatk', 'spdef', 'spd', 'golpes', 'xp', 'gold', 'captura'].includes(col) ? 'desc' : 'asc';
      }
      pokedexState.currentPage = 1;
      renderTableHeader();
      applyFiltersAndRender();
    });
  });
}

/**
 * Configura listeners de controles e filtros
 */
function setupPokedexControls() {
  // 1. Busca Global
  document.querySelectorAll('.global-dex-search').forEach(input => {
    input.addEventListener('input', (e) => {
      pokedexState.search = e.target.value.trim().toLowerCase();
      // Sincroniza os inputs de busca entre abas
      document.querySelectorAll('.global-dex-search').forEach(i => {
        if (i !== e.target) i.value = e.target.value;
      });
      pokedexState.currentPage = 1;
      applyFiltersAndRender();
    });
  });

  // 2. Filtro Duplo de Tipos (Tipo 1 e Tipo 2)
  document.querySelectorAll('.filter-type1-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      pokedexState.type1Filter = e.target.value;
      document.querySelectorAll('.filter-type1-select').forEach(s => {
        if (s !== e.target) s.value = e.target.value;
      });
      pokedexState.currentPage = 1;
      applyFiltersAndRender();
    });
  });

  document.querySelectorAll('.filter-type2-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      pokedexState.type2Filter = e.target.value;
      document.querySelectorAll('.filter-type2-select').forEach(s => {
        if (s !== e.target) s.value = e.target.value;
      });
      pokedexState.currentPage = 1;
      applyFiltersAndRender();
    });
  });

  // 3. Filtro Apenas Forma Shiny
  document.querySelectorAll('.filter-shiny-only-check').forEach(chk => {
    chk.addEventListener('change', (e) => {
      pokedexState.shinyOnly = e.target.checked;
      document.querySelectorAll('.filter-shiny-only-check').forEach(c => {
        if (c !== e.target) c.checked = e.target.checked;
      });
      document.querySelectorAll('.label-shiny-only').forEach(lbl => {
        lbl.classList.toggle('active', e.target.checked);
      });
      pokedexState.currentPage = 1;
      applyFiltersAndRender();
    });
  });

  // 3. Filtro de Região Global
  document.querySelectorAll('.filter-region-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      pokedexState.regionFilter = e.target.value;
      document.querySelectorAll('.filter-region-select').forEach(s => {
        if (s !== e.target) s.value = e.target.value;
      });
      pokedexState.currentPage = 1;
      applyFiltersAndRender();
    });
  });

  // --- TAB 1: CAPTURA & SHINY CONTROLS ---
  document.querySelectorAll('.clean-ball-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.clean-ball-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pokedexState.ball = btn.dataset.ball;
      pokedexState.currentPage = 1;
      applyFiltersAndRender();
    });
  });

  document.getElementById('clean-toggle-boost')?.addEventListener('change', (e) => {
    pokedexState.captureBoost = e.target.checked;
    document.getElementById('label-capture-boost')?.classList.toggle('active', e.target.checked);
    applyFiltersAndRender();
  });

  document.getElementById('clean-toggle-lure')?.addEventListener('change', (e) => {
    pokedexState.shinyLure = e.target.checked;
    document.getElementById('label-shiny-lure')?.classList.toggle('active', e.target.checked);
    applyFiltersAndRender();
  });

  document.querySelector('.filter-hunt-select')?.addEventListener('change', (e) => {
    pokedexState.huntFilter = e.target.value;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });


  // --- TAB 2: HUNTING FILTERS GRANULARES ---
  document.getElementById('hunt-lvl-min')?.addEventListener('input', (e) => {
    pokedexState.huntLvlMin = e.target.value ? parseInt(e.target.value, 10) : null;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('hunt-lvl-max')?.addEventListener('input', (e) => {
    pokedexState.huntLvlMax = e.target.value ? parseInt(e.target.value, 10) : null;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('filter-hunting-f4')?.addEventListener('change', (e) => {
    pokedexState.f4Filter = e.target.value;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('filter-hunting-f2')?.addEventListener('change', (e) => {
    pokedexState.f2Filter = e.target.value;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('filter-hunting-r05')?.addEventListener('change', (e) => {
    pokedexState.r05Filter = e.target.value;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('filter-hunting-r025')?.addEventListener('change', (e) => {
    pokedexState.r025Filter = e.target.value;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('filter-hunting-imune')?.addEventListener('change', (e) => {
    pokedexState.imuneFilter = e.target.value;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('clean-toggle-xp-boost')?.addEventListener('change', (e) => {
    pokedexState.xpBoost = e.target.checked;
    document.getElementById('label-xp-boost')?.classList.toggle('active', e.target.checked);
    applyFiltersAndRender();
  });

  // --- TAB 3: GOLD & LOOT CONTROLS ---
  document.getElementById('gold-lvl-min')?.addEventListener('input', (e) => {
    pokedexState.goldLvlMin = e.target.value ? parseInt(e.target.value, 10) : null;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('gold-lvl-max')?.addEventListener('input', (e) => {
    pokedexState.goldLvlMax = e.target.value ? parseInt(e.target.value, 10) : null;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('filter-gold-item-drop')?.addEventListener('change', (e) => {
    pokedexState.itemDropFilter = e.target.value;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('sort-gold-select')?.addEventListener('change', (e) => {
    pokedexState.sortCol = 'gold';
    pokedexState.sortDir = e.target.value === 'gold_asc' ? 'asc' : 'desc';
    pokedexState.currentPage = 1;
    renderTableHeader();
    applyFiltersAndRender();
  });

  document.getElementById('clean-toggle-loot-boost')?.addEventListener('change', (e) => {
    pokedexState.lootBoost = e.target.checked;
    document.getElementById('label-loot-boost')?.classList.toggle('active', e.target.checked);
    applyFiltersAndRender();
  });

  // --- TAB 4: POKEMONS FORTES CONTROLS ---
  document.getElementById('fortes-lvl-min')?.addEventListener('input', (e) => {
    pokedexState.fortesLvlMin = e.target.value ? parseInt(e.target.value, 10) : null;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('fortes-lvl-max')?.addEventListener('input', (e) => {
    pokedexState.fortesLvlMax = e.target.value ? parseInt(e.target.value, 10) : null;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('filter-fortes-estagio')?.addEventListener('change', (e) => {
    pokedexState.estagioFilter = e.target.value;
    pokedexState.currentPage = 1;
    applyFiltersAndRender();
  });

  document.getElementById('sort-fortes-stats')?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'bst_desc') { pokedexState.sortCol = 'bst'; pokedexState.sortDir = 'desc'; }
    else if (val === 'hp_desc') { pokedexState.sortCol = 'hp'; pokedexState.sortDir = 'desc'; }
    else if (val === 'atk_desc') { pokedexState.sortCol = 'atk'; pokedexState.sortDir = 'desc'; }
    else if (val === 'def_desc') { pokedexState.sortCol = 'def'; pokedexState.sortDir = 'desc'; }
    else if (val === 'spatk_desc') { pokedexState.sortCol = 'spatk'; pokedexState.sortDir = 'desc'; }
    else if (val === 'spdef_desc') { pokedexState.sortCol = 'spdef'; pokedexState.sortDir = 'desc'; }
    else if (val === 'speed_desc') { pokedexState.sortCol = 'spd'; pokedexState.sortDir = 'desc'; }
    else if (val === 'golpes_desc') { pokedexState.sortCol = 'golpes'; pokedexState.sortDir = 'desc'; }
    pokedexState.currentPage = 1;
    renderTableHeader();
    applyFiltersAndRender();
  });

  // Paginação
  document.getElementById('prev-page-btn')?.addEventListener('click', () => {
    if (pokedexState.currentPage > 1) {
      pokedexState.currentPage--;
      renderTableRows();
      window.scrollTo({ top: 350, behavior: 'smooth' });
    }
  });

  document.getElementById('next-page-btn')?.addEventListener('click', () => {
    const maxPage = Math.ceil(pokedexState.filteredSpecies.length / pokedexState.pageSize);
    if (pokedexState.currentPage < maxPage) {
      pokedexState.currentPage++;
      renderTableRows();
      window.scrollTo({ top: 350, behavior: 'smooth' });
    }
  });
}

/**
 * Obtém estatísticas de captura dinâmicas
 */
export function getSpeciesBallStats(s, ball, captureBoost, shinyLure) {
  let catchPctStr = '';
  if (captureBoost) {
    if (ball === 'poke') catchPctStr = s.captura_pok_ball_com_capture_boost_pct;
    else if (ball === 'great') catchPctStr = s.captura_great_ball_com_capture_boost_pct;
    else if (ball === 'super') catchPctStr = s.captura_super_ball_com_capture_boost_pct;
    else if (ball === 'ultra') catchPctStr = s.captura_ultra_ball_com_capture_boost_pct;
    else if (ball === 'beast') catchPctStr = s.captura_beast_ball_com_capture_boost_pct;
  } else {
    if (ball === 'poke') catchPctStr = s.captura_pok_ball_pct;
    else if (ball === 'great') catchPctStr = s.captura_great_ball_pct;
    else if (ball === 'super') catchPctStr = s.captura_super_ball_pct;
    else if (ball === 'ultra') catchPctStr = s.captura_ultra_ball_pct;
    else if (ball === 'beast') catchPctStr = s.captura_beast_ball_pct;
  }

  let baseDerrotas = 0;
  if (ball === 'poke') baseDerrotas = parseInt(s.captura_pok_ball_derrotas_media, 10) || 0;
  else if (ball === 'great') baseDerrotas = parseInt(s.captura_great_ball_derrotas_media, 10) || 0;
  else if (ball === 'super') baseDerrotas = parseInt(s.captura_super_ball_derrotas_media, 10) || 0;
  else if (ball === 'ultra') baseDerrotas = parseInt(s.captura_ultra_ball_derrotas_media, 10) || 0;
  else if (ball === 'beast') baseDerrotas = parseInt(s.captura_beast_ball_derrotas_media, 10) || 0;

  const catchKillsNum = (captureBoost && baseDerrotas > 0) ? Math.max(1, Math.ceil(baseDerrotas / 2)) : baseDerrotas;

  let baseShinyCatch = 0;
  if (s.tem_forma_shiny === 'sim') {
    if (ball === 'poke') baseShinyCatch = parseInt(s.shiny_encontrar_e_capturar_pok_ball_1_em, 10) || 0;
    else if (ball === 'great') baseShinyCatch = parseInt(s.shiny_encontrar_e_capturar_great_ball_1_em, 10) || 0;
    else if (ball === 'super') baseShinyCatch = parseInt(s.shiny_encontrar_e_capturar_super_ball_1_em, 10) || 0;
    else if (ball === 'ultra') baseShinyCatch = parseInt(s.shiny_encontrar_e_capturar_ultra_ball_1_em, 10) || 0;
    else if (ball === 'beast') baseShinyCatch = parseInt(s.shiny_encontrar_e_capturar_beast_ball_1_em, 10) || 0;

    let divisor = 1;
    if (shinyLure) divisor *= 2;
    if (captureBoost) divisor *= 2;
    baseShinyCatch = Math.max(1, Math.round(baseShinyCatch / divisor));
  }

  let formattedPct = '—';
  let numPct = 0;
  if (catchPctStr) {
    numPct = parseFloat(catchPctStr.replace(',', '.'));
    if (!isNaN(numPct)) {
      formattedPct = numPct.toFixed(2).replace('.', ',') + '%';
    }
  }

  return {
    numPct,
    formattedPct,
    catchKillsNum,
    shinyKillsNum: baseShinyCatch
  };
}

/**
 * Filtra e ordena as espécies
 */
export function applyFiltersAndRender() {
  const {
    allSpecies, currentTab, search, type1Filter, type2Filter, shinyOnly, regionFilter,
    huntFilter, huntLvlMin, huntLvlMax,
    f4Filter, f2Filter, r05Filter, r025Filter, imuneFilter,
    goldLvlMin, goldLvlMax, itemDropFilter,
    fortesLvlMin, fortesLvlMax, estagioFilter,
    sortCol, sortDir, ball, captureBoost, shinyLure
  } = pokedexState;

  const filtered = allSpecies.filter(s => {
    // 1. Busca por nome ou #dex
    if (search) {
      const matchDex = s.dex === search;
      const matchNome = s.nome.toLowerCase().includes(search);
      if (!matchDex && !matchNome) return false;
    }

    // 2. Filtro Apenas com forma Shiny
    if (shinyOnly && s.tem_forma_shiny !== 'sim') return false;

    // 3. Filtro Duplo de Tipos (Tipo 1 e/ou Tipo 2)
    if (type1Filter !== 'all' || type2Filter !== 'all') {
      const spT1 = (s.tipo1 || '').toUpperCase();
      const spT2 = (s.tipo2 || '').toUpperCase();

      if (type1Filter !== 'all' && type2Filter !== 'all') {
        if (type2Filter === 'none') {
          // Requer que seja exatamente Tipo 1 puro (sem tipo 2)
          if (spT1 !== type1Filter && spT2 !== type1Filter) return false;
          if (spT2 && spT2 !== '' && spT2 !== spT1) return false;
        } else {
          // Requer combinação dupla dos dois tipos (ex: FIRE + FLYING)
          const hasT1 = spT1 === type1Filter || spT2 === type1Filter;
          const hasT2 = spT1 === type2Filter || spT2 === type2Filter;
          if (!hasT1 || !hasT2) return false;
        }
      } else if (type1Filter !== 'all') {
        // Apenas Tipo 1 selecionado
        if (spT1 !== type1Filter && spT2 !== type1Filter) return false;
      } else if (type2Filter !== 'all') {
        // Apenas Tipo 2 selecionado
        if (type2Filter === 'none') {
          if (spT2 && spT2 !== '') return false;
        } else {
          if (spT1 !== type2Filter && spT2 !== type2Filter) return false;
        }
      }
    }

    // 4. Região / Área
    if (regionFilter !== 'all') {
      if (!s.regiao || !s.regiao.toLowerCase().includes(regionFilter.toLowerCase())) return false;
    }

    // Filtros específicos da Aba 1 (Captura)
    if (currentTab === 'captura') {
      if (huntFilter === 'cacavel' && !s.is_cacavel) return false;
      if (huntFilter === 'sem_hunt' && s.is_cacavel) return false;
    }

    // Filtros específicos da Aba 2 (Hunting)
    if (currentTab === 'hunting') {
      if (huntLvlMin !== null && s.hunt_lvl_max < huntLvlMin) return false;
      if (huntLvlMax !== null && s.hunt_lvl_min > huntLvlMax) return false;

      // Filtros Manuais Granulares
      if (f4Filter && f4Filter !== 'all') {
        if (f4Filter === 'has_any') {
          if (!(s.f4_types || []).length) return false;
        } else {
          if (!(s.f4_types || []).includes(f4Filter)) return false;
        }
      }
      if (f2Filter && f2Filter !== 'all') {
        if (f2Filter === 'has_any') {
          if (!(s.f2_types || []).length) return false;
        } else {
          if (!(s.f2_types || []).includes(f2Filter)) return false;
        }
      }
      if (r05Filter && r05Filter !== 'all') {
        if (r05Filter === 'has_any') {
          if (!(s.r05_types || []).length) return false;
        } else {
          if (!(s.r05_types || []).includes(r05Filter)) return false;
        }
      }
      if (r025Filter && r025Filter !== 'all') {
        if (r025Filter === 'has_any') {
          if (!(s.r025_types || []).length) return false;
        } else {
          if (!(s.r025_types || []).includes(r025Filter)) return false;
        }
      }
      if (imuneFilter && imuneFilter !== 'all') {
        if (imuneFilter === 'has_any') {
          if (!(s.imune_types || []).length) return false;
        } else {
          if (!(s.imune_types || []).includes(imuneFilter)) return false;
        }
      }
    }

    // Filtros específicos da Aba 3 (Gold & Loot)
    if (currentTab === 'gold_loot') {
      if (goldLvlMin !== null && s.hunt_lvl_max < goldLvlMin) return false;
      if (goldLvlMax !== null && s.hunt_lvl_min > goldLvlMax) return false;
      if (itemDropFilter !== 'all') {
        if (!(s.item_names || []).includes(itemDropFilter)) return false;
      }
    }

    // Filtros específicos da Aba 4 (Fortes)
    if (currentTab === 'fortes') {
      if (fortesLvlMin !== null && s.hunt_lvl_max < fortesLvlMin) return false;
      if (fortesLvlMax !== null && s.hunt_lvl_min > fortesLvlMax) return false;
      if (estagioFilter !== 'all') {
        if (String(s.estagio_num) !== String(estagioFilter)) return false;
      }
    }

    return true;
  });

  // Ordenação
  filtered.sort((a, b) => {
    let comp = 0;

    switch (sortCol) {
      case 'dex':
        comp = (parseInt(a.dex, 10) || 0) - (parseInt(b.dex, 10) || 0);
        break;
      case 'nome':
        comp = a.nome.localeCompare(b.nome);
        break;
      case 'hunt':
        comp = a.hunt_tag.localeCompare(b.hunt_tag);
        break;
      case 'tipo':
        comp = (a.tipo1 || '').localeCompare(b.tipo1 || '');
        break;
      case 'captura': {
        const stA = getSpeciesBallStats(a, ball, captureBoost, shinyLure);
        const stB = getSpeciesBallStats(b, ball, captureBoost, shinyLure);
        comp = stA.numPct - stB.numPct;
        break;
      }
      case 'derrotas': {
        const stA = getSpeciesBallStats(a, ball, captureBoost, shinyLure);
        const stB = getSpeciesBallStats(b, ball, captureBoost, shinyLure);
        comp = (stA.catchKillsNum || 9999999) - (stB.catchKillsNum || 9999999);
        break;
      }
      case 'shiny': {
        const stA = getSpeciesBallStats(a, ball, captureBoost, shinyLure);
        const stB = getSpeciesBallStats(b, ball, captureBoost, shinyLure);
        comp = (stA.shinyKillsNum || 999999999) - (stB.shinyKillsNum || 999999999);
        break;
      }
      case 'tem_shiny':
        comp = (b.tem_forma_shiny === 'sim' ? 1 : 0) - (a.tem_forma_shiny === 'sim' ? 1 : 0);
        break;
      case 'xp':
        comp = (b.xp_base || 0) - (a.xp_base || 0);
        break;
      case 'gold':
        comp = (b.price_npc_num || 0) - (a.price_npc_num || 0);
        break;
      case 'bst':
        comp = (b.bst_num || 0) - (a.bst_num || 0);
        break;
      case 'hp':
        comp = (b.hp_num || 0) - (a.hp_num || 0);
        break;
      case 'atk':
        comp = (b.atk_num || 0) - (a.atk_num || 0);
        break;
      case 'def':
        comp = (b.def_num || 0) - (a.def_num || 0);
        break;
      case 'spatk':
        comp = (b.spatk_num || 0) - (a.spatk_num || 0);
        break;
      case 'spdef':
        comp = (b.spdef_num || 0) - (a.spdef_num || 0);
        break;
      case 'spd':
        comp = (b.spd_num || 0) - (a.spd_num || 0);
        break;
      case 'estagio':
        comp = (b.estagio_num || 1) - (a.estagio_num || 1);
        break;
      case 'evolui_para':
        comp = (a.evolui_para || '').localeCompare(b.evolui_para || '');
        break;
      case 'golpes':
        comp = (b.qtd_golpes_num || 0) - (a.qtd_golpes_num || 0);
        break;
      default:
        comp = (parseInt(a.dex, 10) || 0) - (parseInt(b.dex, 10) || 0);
    }

    return sortDir === 'asc' ? comp : -comp;
  });

  pokedexState.filteredSpecies = filtered;

  // Atualiza indicadores de ordenação nos th
  document.querySelectorAll('.clean-pokedex-table th.sortable').forEach(th => {
    const col = th.dataset.sort;
    const ico = th.querySelector('.sort-ico');
    if (col === sortCol) {
      th.classList.add('active-sort');
      if (ico) ico.textContent = sortDir === 'asc' ? '▾' : '▴';
    } else {
      th.classList.remove('active-sort');
      if (ico) ico.textContent = '';
    }
  });

  // Atualiza contador em todas as abas
  document.querySelectorAll('.clean-pokedex-count').forEach(el => {
    el.textContent = filtered.length.toLocaleString('pt-BR');
  });

  renderTableRows();
}

/**
 * Renderiza as linhas da tabela conforme a aba ativa
 */
function renderTableRows() {
  const tbody = document.getElementById('pokedex-body');
  if (!tbody) return;

  const { filteredSpecies, currentTab, ball, captureBoost, shinyLure, xpBoost, lootBoost } = pokedexState;

  if (filteredSpecies.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="14" style="text-align: center; padding: 3rem; color: #9ca3af;">
        Nenhum Pokémon encontrado com os filtros selecionados.
      </td></tr>
    `;
    updatePagination();
    return;
  }

  const renderTypes = (t1, t2) => {
    let h = `<span class="type-badge ${(t1||'').toLowerCase()}">${(t1||'').toUpperCase()}</span>`;
    if (t2) {
      h += ` <span class="type-badge ${(t2||'').toLowerCase()}">${(t2||'').toUpperCase()}</span>`;
    }
    return `<div class="clean-types-wrap">${h}</div>`;
  };

  const renderMatchupTypes = (typesList) => {
    if (!typesList || !typesList.length) return '<span class="cell-muted">—</span>';
    const chips = typesList.map(t => {
      return `<span class="type-badge ${t.toLowerCase()}">${t.toUpperCase()}</span>`;
    }).join(' ');
    return `<div class="clean-matchup-wrap">${chips}</div>`;
  };

  const html = filteredSpecies.map(s => {
    const spriteFileName = dexSpriteMap[s.dex] || dexSpriteMap[parseInt(s.dex, 10)] || `${parseInt(s.dex, 10)}-${s.nome.toLowerCase().replace(/[^a-z0-9]/g, '_')}.png`;
    const spriteSrc = `assets/sprites-pokemon/normal/${spriteFileName}`;
    const spriteHtml = `<span class="clean-sprite-cell" data-dex="${s.dex}" data-look="${s.looktype || s.dex}" data-src="${spriteSrc}" style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; vertical-align: middle; margin-right: 6px;"></span>`;

    const formattedDex = '#' + String(s.dex).padStart(3, '0');
    const huntText = s.is_cacavel ? `${s.regiao || 'Kanto'}, Nv ${s.nivel_hunt_min || s.nivel_ao_capturar || 20}` : 'Sem hunt';
    const typesHtml = renderTypes(s.tipo1, s.tipo2);

    let rowContent = '';

    if (currentTab === 'captura') {
      const stats = getSpeciesBallStats(s, ball, captureBoost, shinyLure);
      const shinyText = (s.tem_forma_shiny === 'sim' && stats.shinyKillsNum > 0)
        ? `1 : ${stats.shinyKillsNum.toLocaleString('pt-BR')}`
        : '<span class="cell-muted">—</span>';

      rowContent = `
        <td class="tabular-nums cell-muted">${formattedDex}</td>
        <td><div class="cell-name">${spriteHtml} ${s.nome}</div></td>
        <td>${typesHtml}</td>
        <td>${huntText}</td>
        <td class="num-col tabular-nums cell-highlight">${stats.formattedPct}</td>
        <td class="num-col tabular-nums">${stats.catchKillsNum > 0 ? `${stats.catchKillsNum.toLocaleString('pt-BR')} derrotas` : '—'}</td>
        <td class="num-col tabular-nums cell-muted">${shinyText}</td>
        <td class="center-col"><button class="ds-btn ds-btn-sm ds-btn-secondary clean-btn-ver" data-dex="${s.dex}">Detalhes</button></td>
      `;
    } else if (currentTab === 'hunting') {
      const xpVal = xpBoost ? s.xp_boosted : s.xp_base;
      const xpTag = xpBoost ? ' <span class="clean-xp-boost-badge">+50%</span>' : '';

      rowContent = `
        <td class="tabular-nums cell-muted">${formattedDex}</td>
        <td><div class="cell-name">${spriteHtml} ${s.nome}</div></td>
        <td>${typesHtml}</td>
        <td>${huntText}</td>
        <td>${renderMatchupTypes(s.f4_types)}</td>
        <td>${renderMatchupTypes(s.f2_types)}</td>
        <td>${renderMatchupTypes(s.r05_types)}</td>
        <td>${renderMatchupTypes(s.r025_types)}</td>
        <td>${renderMatchupTypes(s.imune_types)}</td>
        <td class="num-col tabular-nums">${s.def_num}</td>
        <td class="num-col tabular-nums">${s.spdef_num}</td>
        <td class="num-col tabular-nums">${s.hp_num}</td>
        <td class="num-col tabular-nums cell-highlight">${xpVal ? xpVal.toLocaleString('pt-BR') : '—'}${xpVal ? xpTag : ''}</td>
        <td class="center-col"><button class="ds-btn ds-btn-sm ds-btn-secondary clean-btn-ver" data-dex="${s.dex}">Detalhes</button></td>
      `;
    } else if (currentTab === 'gold_loot') {
      // Exibe apenas drops úteis (pedras evolutivas / stones) com recálculo de Loot Boost (+40%)
      const targetDrops = (s.stone_drops && s.stone_drops.length > 0) ? s.stone_drops : (s.drops_parsed || []).filter(d => isUsefulStoneDrop(d.name));
      const dropsList = targetDrops.map(d => {
        let pct = d.pct;
        let isBoosted = false;
        if (lootBoost && pct > 0) {
          pct = Math.min(100, Math.round(pct * 1.4 * 100) / 100);
          isBoosted = true;
        }
        return { ...d, pct, isBoosted };
      });

      const dropsHtml = dropsList.length ? dropsList.map(d => {
        const itemImg = `<img src="assets/site/assets/items/${d.slug}.png" class="clean-drop-ico" alt="${d.name}" onerror="this.style.display='none'">`;
        const boostedClass = d.isBoosted ? 'boosted' : '';
        return `<span class="clean-drop-row ${boostedClass}">${itemImg} <span style="font-weight: 600; color: #fbbf24;">${d.name}</span> <span class="clean-drop-pct tabular-nums">${d.pct}%</span></span>`;
      }).join(' ') : '<span class="cell-muted">—</span>';

      const goldVal = s.gold_num || 0;

      rowContent = `
        <td class="tabular-nums cell-muted">${formattedDex}</td>
        <td><div class="cell-name">${spriteHtml} ${s.nome}</div></td>
        <td>${typesHtml}</td>
        <td>${huntText}</td>
        <td class="num-col tabular-nums cell-gold">${goldVal > 0 ? goldVal.toLocaleString('pt-BR') : '—'}</td>
        <td><div class="clean-drops-cell">${dropsHtml}</div></td>
        <td class="center-col"><button class="ds-btn ds-btn-sm ds-btn-secondary clean-btn-ver" data-dex="${s.dex}">Detalhes</button></td>
      `;
    } else if (currentTab === 'fortes') {
      const estagioLabel = s.estagio_num ? `Estágio ${s.estagio_num}` : '—';
      const estagioHtml = `<span class="ds-badge ds-badge-subtle">${estagioLabel}</span>`;
      const evolucaoHtml = s.evolui_para ? `<span class="cell-secondary">↳ ${s.evolui_para}</span>` : '<span class="cell-muted">—</span>';

      rowContent = `
        <td class="tabular-nums cell-muted">${formattedDex}</td>
        <td><div class="cell-name">${spriteHtml} ${s.nome}</div></td>
        <td>${typesHtml}</td>
        <td>${huntText}</td>
        <td class="num-col tabular-nums cell-highlight" style="font-weight: 700;">${s.bst_num}</td>
        <td class="num-col tabular-nums">${s.hp_num}</td>
        <td class="num-col tabular-nums">${s.atk_num}</td>
        <td class="num-col tabular-nums">${s.def_num}</td>
        <td class="num-col tabular-nums">${s.spatk_num}</td>
        <td class="num-col tabular-nums">${s.spdef_num}</td>
        <td class="num-col tabular-nums">${s.spd_num}</td>
        <td class="center-col">${estagioHtml}</td>
        <td>${evolucaoHtml}</td>
        <td class="center-col"><button class="ds-btn ds-btn-sm ds-btn-secondary clean-btn-ver" data-dex="${s.dex}">Detalhes</button></td>
      `;
    }

    return `<tr class="clean-pokedex-row" data-dex="${s.dex}">${rowContent}</tr>`;
  }).join('');

  tbody.innerHTML = html;

  // Renderiza sprites de frente em cada linha via Canvas Pixel Art (direção 3 = frente)
  tbody.querySelectorAll('.clean-sprite-cell').forEach(cell => {
    const look = cell.dataset.look;
    const src = cell.dataset.src;
    const canvas = criarCanvasSprite(look, 32, 3, src);
    canvas.style.verticalAlign = 'middle';
    cell.appendChild(canvas);
  });

  // Vincula clique na linha para abrir a ficha oficial do Pokémon
  tbody.querySelectorAll('.clean-pokedex-row').forEach(row => {
    row.addEventListener('click', (e) => {
      tbody.querySelectorAll('.clean-pokedex-row.selected').forEach(r => {
        r.classList.remove('selected');
        const b = r.querySelector('.clean-btn-ver');
        if (b) {
          b.classList.remove('ds-btn-primary');
          b.classList.add('ds-btn-secondary');
        }
      });
      row.classList.add('selected');
      const b = row.querySelector('.clean-btn-ver');
      if (b) {
        b.classList.remove('ds-btn-secondary');
        b.classList.add('ds-btn-primary');
      }

      if (!e.target.closest('button')) {
        const dex = row.dataset.dex;
        const sp = filteredSpecies.find(x => x.dex === dex) || pokedexState.allSpecies.find(x => x.dex === dex);
        if (sp) openOfficialSpeciesModal(sp);
      }
    });
  });

  // Vincula clique nos botões Detalhes
  tbody.querySelectorAll('.clean-btn-ver').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dex = btn.dataset.dex;
      const sp = filteredSpecies.find(x => x.dex === dex) || pokedexState.allSpecies.find(x => x.dex === dex);
      if (sp) openOfficialSpeciesModal(sp);
    });
  });

  updatePagination();
}

/**
 * Atualiza o indicador de contagem de Pokémon sem restrição de paginação
 */
function updatePagination() {
  const container = document.getElementById('pokedex-pagination-wrap');
  if (!container) return;

  const { filteredSpecies } = pokedexState;
  container.className = 'ds-pagination';
  container.style.justifyContent = 'center';
  container.style.padding = '16px';
  container.innerHTML = `
    <span style="font-size: 13px; font-weight: 600; color: var(--text-secondary);">Mostrando <strong style="color: var(--text-primary); font-size: 15px;">${filteredSpecies.length}</strong> espécies de Pokémon (Rolagem Infinita)</span>
  `;
}

/**
 * ABRE A FICHA OFICIAL DA ESPÉCIE (MODAL COMPLETO 100% CSV)
 */
export function openOfficialSpeciesModal(s) {
  const modal = document.getElementById('species-modal');
  const title = document.getElementById('modal-species-title');
  const content = document.getElementById('modal-species-content');
  if (!modal || !title || !content) return;

  title.innerHTML = `${s.nome.toUpperCase()} #${s.dex}`;

  const spriteFileName = dexSpriteMap[s.dex] || dexSpriteMap[parseInt(s.dex, 10)] || `${parseInt(s.dex, 10)}-${s.nome.toLowerCase().replace(/[^a-z0-9]/g, '_')}.png`;
  const spriteSrc = `assets/sprites-pokemon/normal/${spriteFileName}`;

  const t1 = TYPE_LABELS[s.tipo1] || s.tipo1;
  const t2 = s.tipo2 ? (TYPE_LABELS[s.tipo2] || s.tipo2) : null;
  const typesBadges = `<span class="clean-type-pill ${TYPE_CLASSES[s.tipo1] || 'clean-type-outro'}">${t1}</span>`
    + (t2 ? ` <span class="clean-type-pill ${TYPE_CLASSES[s.tipo2] || 'clean-type-outro'}">${t2}</span>` : '');

  const formatEvolutionLink = (text) => {
    if (!text || text === 'Espécie Base' || text === 'Não evolui' || text === '—') {
      return `<span style="color: var(--text-muted);">${text || '—'}</span>`;
    }
    let html = text;
    const allNames = Array.from(new Set(pokedexState.allSpecies.map(sp => sp.nome)))
      .sort((a, b) => b.length - a.length);

    for (const name of allNames) {
      const regex = new RegExp(`\\b(${name})\\b`, 'gi');
      if (regex.test(html)) {
        html = html.replace(regex, (match) => {
          return `<button class="ds-btn ds-btn-sm ds-btn-secondary evo-link-btn" data-evo-name="${match}" style="padding: 2px 10px; font-size: 0.8rem; font-weight: 700; color: #a855f7; border-color: rgba(168,85,247,0.5); margin: 0 4px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">↳ ${match}</button>`;
        });
        break;
      }
    }
    return html;
  };

  const renderStatBar = (label, valStr) => {
    const val = parseInt(valStr, 10) || 0;
    const pct = Math.min(100, Math.round((val / 180) * 100));
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-size: 0.82rem;">
        <span style="width: 55px; font-weight: 700; color: var(--text-muted);">${label}</span>
        <div style="flex: 1; height: 7px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden;">
          <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #7c3aed, #a855f7); border-radius: 4px;"></div>
        </div>
        <strong style="width: 35px; text-align: right; color: var(--text-primary); font-family: monospace;">${val}</strong>
      </div>
    `;
  };

  let golpesHtml = '';
  if (s.golpes) {
    const moves = s.golpes.split('|').map(m => m.trim()).filter(Boolean);
    golpesHtml = moves.map(m => `<li style="padding: 5px 0; border-bottom: 1px solid var(--border-subtle); font-size: 0.8rem; color: var(--text-primary);">${m}</li>`).join('');
  } else {
    golpesHtml = '<li style="color: var(--text-muted); font-style: italic;">Sem golpes registrados.</li>';
  }

  const dropsList = (s.drops_parsed && s.drops_parsed.length > 0) ? s.drops_parsed : [];
  let dropsHtml = '';
  if (dropsList.length) {
    dropsHtml = dropsList.map(d => {
      const isStone = isUsefulStoneDrop(d.name);
      const color = isStone ? '#fbbf24' : 'var(--text-primary)';
      const icon = isStone ? 'assets/site/assets/ui/menu-ranking.png' : 'assets/site/assets/loja/supplypack.png';
      return `<li style="padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.8rem; color: ${color}; display: flex; align-items: center; gap: 8px;">
        <img src="${icon}" style="width: 14px; height: 14px; object-fit: contain; image-rendering: pixelated;" alt="">
        <strong style="font-weight: 600;">${d.name}</strong> <span style="opacity: 0.8; font-family: monospace;">${d.pct}%</span>
      </li>`;
    }).join('');
  } else {
    dropsHtml = '<li style="color: var(--text-muted); font-style: italic;">Não derruba itens comuns.</li>';
  }

  const modalSparkle = s.tem_forma_shiny === 'sim'
    ? '<img src="assets/site/assets/loja/shinysecretlure.png" class="dex-sparkle-asset" alt="Shiny">'
    : '';

  content.innerHTML = `
    <div style="padding: 10px 4px;">
      
      <!-- Cabeçalho do Card com Sprite de Frente -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 14px; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 14px;">
          <div id="modal-species-sprite-box" style="width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; flex-shrink: 0; box-shadow: inset 0 0 10px rgba(0,0,0,0.3);"></div>
          <div>
            <h3 style="margin: 0; font-size: 1.35rem; color: var(--text-primary); font-weight: 800; display: flex; align-items: center; gap: 6px;">
              ${modalSparkle}${s.nome}
            </h3>
            <span style="font-size: 0.85rem; color: var(--text-muted);">
              #${s.dex} · ${s.regiao || 'Desconhecida'} · Geração ${s.geracao || 1}
            </span>
          </div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          ${typesBadges}
        </div>
      </div>

      <!-- Grid 2 Colunas: Stats & Evoluções -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 18px;">
        
        <!-- Base Stats -->
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 14px;">
          <h4 style="margin: 0 0 12px 0; font-size: 0.78rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.05em;">
            Base Stats (Total: ${s.total_stats || 0})
          </h4>
          ${renderStatBar('HP', s.hp)}
          ${renderStatBar('ATK', s.atk)}
          ${renderStatBar('DEF', s.def)}
          ${renderStatBar('SP.ATK', s.spatk)}
          ${renderStatBar('SP.DEF', s.spdef)}
          ${renderStatBar('SPEED', s.spd)}
        </div>

        <!-- Cadeia Evolutiva Clicável & Dados de Economia -->
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 12px;">
          <h4 style="margin: 0; font-size: 0.78rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.05em;">
            Cadeia Evolutiva & Economia
          </h4>
          
          <div style="font-size: 0.85rem; color: var(--text-primary); display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <strong style="color: var(--text-muted);">Evolui de:</strong> ${formatEvolutionLink(s.evolui_de || 'Espécie Base')}
          </div>
          <div style="font-size: 0.85rem; color: var(--text-primary); display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <strong style="color: var(--text-muted);">Evolui para:</strong> ${formatEvolutionLink(s.evolui_para || 'Não evolui')}
          </div>
          ${s.pedra_evolucao ? `<div style="font-size: 0.82rem; color: var(--text-primary); display: flex; align-items: center; gap: 5px;"><strong style="color: var(--text-muted);">Pedra:</strong> <img src="assets/site/assets/ui/menu-ranking.png" style="width: 14px; height: 14px; image-rendering: pixelated;" alt=""> ${s.pedra_evolucao}</div>` : ''}
          ${s.shiny_stone_evolucao ? `<div style="font-size: 0.82rem; color: var(--text-primary); display: flex; align-items: center; gap: 5px;"><strong style="color: var(--text-muted);">Pedra Shiny:</strong> <img src="assets/site/assets/loja/shinysecretlure.png" class="dex-sparkle-asset" alt=""> ${s.shiny_stone_evolucao}</div>` : ''}

          <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px; margin-top: auto;">
            <div style="font-size: 0.82rem; color: #fbbf24; display: flex; align-items: center; gap: 6px;">
              <img src="assets/site/assets/ui/moeda-ouro.png" style="width: 15px; height: 15px; image-rendering: pixelated;" alt=""> <strong>Preço NPC:</strong> ${parseInt(s.price_npc, 10)?.toLocaleString('pt-BR') || '0'} gold
            </div>
            <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span style="display: inline-flex; align-items: center; gap: 4px;"><img src="assets/site/assets/loja/exp.png" style="width: 14px; height: 14px; image-rendering: pixelated;" alt=""> <strong>XP por Derrota:</strong> ${s.xp_por_derrota || '—'}</span>
              <span>|</span>
              <span style="display: inline-flex; align-items: center; gap: 4px;"><img src="assets/site/assets/ui/moeda-ouro.png" style="width: 13px; height: 13px; image-rendering: pixelated;" alt=""> <strong>Ouro:</strong> ${s.ouro_por_derrota || '—'}</span>
            </div>
          </div>
        </div>

      </div>

      <!-- Tabela Oficial de Captura por Pokébola (100% CSV) -->
      <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 14px; margin-bottom: 18px; overflow-x: auto;">
        <h4 style="margin: 0 0 10px 0; font-size: 0.78rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.05em;">
          Taxas Oficiais de Captura por Pokébola
        </h4>
        <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; text-align: left;">
          <thead>
            <tr style="border-bottom: 1px solid var(--border-default); color: var(--text-muted);">
              <th style="padding: 6px 8px;">Pokébola</th>
              <th style="padding: 6px 8px;">Chance Arremesso</th>
              <th style="padding: 6px 8px;">Com Capture Boost</th>
              <th style="padding: 6px 8px;">Derrotas Médias</th>
              <th style="padding: 6px 8px;">Shiny: 1 Captura Em</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
              <td style="padding: 7px 8px; font-weight: 700; color: #ef4444; display: flex; align-items: center; gap: 6px;"><img src="assets/site/assets/ui/ball-poke.png" style="width: 16px; height: 16px; image-rendering: pixelated;" alt=""> Poké Ball (×1)</td>
              <td style="padding: 7px 8px; color: #4ade80; font-family: monospace;">${s.captura_pok_ball_pct || '—'}%</td>
              <td style="padding: 7px 8px; color: #fde047; font-family: monospace;">${s.captura_pok_ball_com_capture_boost_pct || '—'}%</td>
              <td style="padding: 7px 8px; font-family: monospace;">${s.captura_pok_ball_derrotas_media || '—'}</td>
              <td style="padding: 7px 8px; font-family: monospace;">${s.shiny_encontrar_e_capturar_pok_ball_1_em ? '1 em ' + parseInt(s.shiny_encontrar_e_capturar_pok_ball_1_em, 10).toLocaleString('pt-BR') : '—'}</td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
              <td style="padding: 7px 8px; font-weight: 700; color: #3b82f6; display: flex; align-items: center; gap: 6px;"><img src="assets/site/assets/ui/ball-great.png" style="width: 16px; height: 16px; image-rendering: pixelated;" alt=""> Great Ball (×2)</td>
              <td style="padding: 7px 8px; color: #4ade80; font-family: monospace;">${s.captura_great_ball_pct || '—'}%</td>
              <td style="padding: 7px 8px; color: #fde047; font-family: monospace;">${s.captura_great_ball_com_capture_boost_pct || '—'}%</td>
              <td style="padding: 7px 8px; font-family: monospace;">${s.captura_great_ball_derrotas_media || '—'}</td>
              <td style="padding: 7px 8px; font-family: monospace;">${s.shiny_encontrar_e_capturar_great_ball_1_em ? '1 em ' + parseInt(s.shiny_encontrar_e_capturar_great_ball_1_em, 10).toLocaleString('pt-BR') : '—'}</td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
              <td style="padding: 7px 8px; font-weight: 700; color: #f59e0b; display: flex; align-items: center; gap: 6px;"><img src="assets/site/assets/ui/ball-super.png" style="width: 16px; height: 16px; image-rendering: pixelated;" alt=""> Super Ball (×3)</td>
              <td style="padding: 7px 8px; color: #4ade80; font-family: monospace;">${s.captura_super_ball_pct || '—'}%</td>
              <td style="padding: 7px 8px; color: #fde047; font-family: monospace;">${s.captura_super_ball_com_capture_boost_pct || '—'}%</td>
              <td style="padding: 7px 8px; font-family: monospace;">${s.captura_super_ball_derrotas_media || '—'}</td>
              <td style="padding: 7px 8px; font-family: monospace;">${s.shiny_encontrar_e_capturar_super_ball_1_em ? '1 em ' + parseInt(s.shiny_encontrar_e_capturar_super_ball_1_em, 10).toLocaleString('pt-BR') : '—'}</td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
              <td style="padding: 7px 8px; font-weight: 700; color: #8b5cf6; display: flex; align-items: center; gap: 6px;"><img src="assets/site/assets/ui/ball-ultra.png" style="width: 16px; height: 16px; image-rendering: pixelated;" alt=""> Ultra Ball (×4)</td>
              <td style="padding: 7px 8px; color: #4ade80; font-family: monospace;">${s.captura_ultra_ball_pct || '—'}%</td>
              <td style="padding: 7px 8px; color: #fde047; font-family: monospace;">${s.captura_ultra_ball_com_capture_boost_pct || '—'}%</td>
              <td style="padding: 7px 8px; font-family: monospace;">${s.captura_ultra_ball_derrotas_media || '—'}</td>
              <td style="padding: 7px 8px; font-family: monospace;">${s.shiny_encontrar_e_capturar_ultra_ball_1_em ? '1 em ' + parseInt(s.shiny_encontrar_e_capturar_ultra_ball_1_em, 10).toLocaleString('pt-BR') : '—'}</td>
            </tr>
            <tr>
              <td style="padding: 7px 8px; font-weight: 700; color: #06b6d4; display: flex; align-items: center; gap: 6px;"><img src="assets/site/assets/ui/ball-beast.png" style="width: 16px; height: 16px; image-rendering: pixelated;" alt=""> Beast Ball (×8)</td>
              <td style="padding: 7px 8px; color: #4ade80; font-family: monospace;">${s.captura_beast_ball_pct || '—'}%</td>
              <td style="padding: 7px 8px; color: #fde047; font-family: monospace;">${s.captura_beast_ball_com_capture_boost_pct || '—'}%</td>
              <td style="padding: 7px 8px; font-family: monospace;">${s.captura_beast_ball_derrotas_media || '—'}</td>
              <td style="padding: 7px 8px; font-family: monospace;">${s.shiny_encontrar_e_capturar_beast_ball_1_em ? '1 em ' + parseInt(s.shiny_encontrar_e_capturar_beast_ball_1_em, 10).toLocaleString('pt-BR') : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Onde Encontrar & Drops -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 18px;">
        
        <!-- Onde Encontrar -->
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 14px;">
          <h4 style="margin: 0 0 10px 0; font-size: 0.78rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px;">
            <img src="assets/site/assets/ui/menu-mapa.png" style="width: 15px; height: 15px; image-rendering: pixelated;" alt=""> Onde Encontrar (Hunts)
          </h4>
          <p style="margin: 0; font-size: 0.82rem; color: var(--text-primary); line-height: 1.5;">
            ${s.onde_encontrar || 'Não informado na tabela.'}
          </p>
          ${s.boss === 'arena' || s.boss === 'sim' ? `
            <div style="margin-top: 10px; padding: 8px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; font-size: 0.8rem; color: #fca5a5; display: flex; align-items: center; gap: 6px;">
              <img src="assets/site/assets/ui/menu-bosses.png" style="width: 14px; height: 14px; image-rendering: pixelated;" alt=""> <strong>Boss:</strong> ${s.observacao || 'Boss de arena'} (Arena Nv ${s.boss_nivel_arena || '?'})
            </div>
          ` : ''}
        </div>

        <!-- Drops -->
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 14px;">
          <h4 style="margin: 0 0 10px 0; font-size: 0.78rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px;">
            <img src="assets/site/assets/loja/supplypack.png" style="width: 15px; height: 15px; image-rendering: pixelated;" alt=""> Drops Oficiais (${dropsList.length})
          </h4>
          <ul style="list-style: none; padding: 0; margin: 0; max-height: 140px; overflow-y: auto;">
            ${dropsHtml}
          </ul>
        </div>

      </div>

      <!-- Golpes Aprendidos -->
      <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 14px;">
        <h4 style="margin: 0 0 10px 0; font-size: 0.78rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px;">
          <img src="assets/site/assets/ui/menu-pvp.png" style="width: 15px; height: 15px; image-rendering: pixelated;" alt=""> Golpes Aprendidos (${s.qtd_golpes || 0})
        </h4>
        <ul style="list-style: none; padding: 0; margin: 0; max-height: 180px; overflow-y: auto;">
          ${golpesHtml}
        </ul>
      </div>

    </div>
  `;

  // Renderiza sprite de frente no topo do modal
  const spriteBox = content.querySelector('#modal-species-sprite-box');
  if (spriteBox) {
    const canvas = criarCanvasSprite(s.looktype || s.dex, 52, 3, spriteSrc);
    spriteBox.appendChild(canvas);
  }

  // Ativa links para navegação instantânea entre espécies evolutivas
  content.querySelectorAll('.evo-link-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const evoName = btn.dataset.evoName;
      if (evoName) {
        const target = pokedexState.allSpecies.find(sp => sp.nome.toLowerCase() === evoName.toLowerCase());
        if (target) openOfficialSpeciesModal(target);
      }
    });
  });

  modal.classList.add('open', 'active');

  const closeBtn = document.getElementById('modal-close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => modal.classList.remove('open', 'active');
  }
  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.remove('open', 'active');
  };
}

// Aliases para compatibilidade
export {
  pokedexState as huntState,
  applyFiltersAndRender as applyPokedexFilters,
  openOfficialSpeciesModal as openSpeciesModal
};
