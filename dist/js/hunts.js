/**
 * POKÉIDLE HUB — CATÁLOGO GERAL DE TODAS AS 824 HUNTS
 * Tabela interativa completa com todas as hunts de todas as regiões (Kanto a Alola),
 * visualização de spawns, XP/hora, Ouro/hora e integração direta com a Calculadora.
 */

import { criarCanvasSprite } from './sprites.js';

let allHunts = [];
let allSpecies = [];
let speciesMap = new Map();

let currentPage = 1;
const ITEMS_PER_PAGE = 30;

const REGION_NAMES = {
  kanto: 'Kanto',
  johto: 'Johto',
  hoenn: 'Hoenn',
  sinnoh: 'Sinnoh',
  unova: 'Unova',
  kalos: 'Kalos',
  alola: 'Alola',
  outland: 'Outland',
  orre: 'Orre'
};

export async function initHuntsCatalog() {
  try {
    const [huntsRes, specRes] = await Promise.all([
      fetch('data/hunts_portal.json'),
      fetch('data/pokedex_portal.json')
    ]);
    allHunts = await huntsRes.json();
    allSpecies = await specRes.json();
    speciesMap = new Map(allSpecies.map(s => [s.pokeId, s]));
  } catch (e) {
    console.warn('Erro ao carregar dados para o catálogo de hunts:', e);
  }

  setupSubtabsNavigation();
  setupHuntsTableFilters();
  renderHuntsCatalog();
}

/**
 * Alterna entre a Pokédex de Espécies e o Catálogo de Hunts
 */
function setupSubtabsNavigation() {
  const btnSpecies = document.getElementById('dex-subtab-species');
  const btnHunts = document.getElementById('dex-subtab-hunts');
  const panelSpecies = document.getElementById('dex-panel-species');
  const panelHunts = document.getElementById('dex-panel-hunts');

  function showTab(tab) {
    if (tab === 'hunts') {
      btnHunts?.classList.add('on', 'active');
      btnHunts?.classList.remove('apagado');
      btnSpecies?.classList.remove('on', 'active');
      btnSpecies?.classList.add('apagado');
      if (panelSpecies) panelSpecies.style.display = 'none';
      if (panelHunts) panelHunts.style.display = 'block';
      renderHuntsCatalog();
    } else {
      btnSpecies?.classList.add('on', 'active');
      btnSpecies?.classList.remove('apagado');
      btnHunts?.classList.remove('on', 'active');
      btnHunts?.classList.add('apagado');
      if (panelHunts) panelHunts.style.display = 'none';
      if (panelSpecies) panelSpecies.style.display = 'block';
    }
  }

  btnSpecies?.addEventListener('click', () => showTab('species'));
  btnHunts?.addEventListener('click', () => showTab('hunts'));

  // Botão externo vindo de Calculadoras ou Header
  window.abrirCatalogoHunts = () => {
    document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.nav-tab-btn[data-view="view-pokedex"]')?.classList.add('active');
    document.querySelectorAll('.portal-view').forEach(v => v.classList.remove('active-view'));
    document.getElementById('view-pokedex')?.classList.add('active-view');
    showTab('hunts');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
}

function setupHuntsTableFilters() {
  const searchInput = document.getElementById('hunts-table-search');
  const regionSelect = document.getElementById('hunts-table-region');
  const minLvlInput = document.getElementById('hunts-table-min-lvl');
  const maxLvlInput = document.getElementById('hunts-table-max-lvl');
  const sortSelect = document.getElementById('hunts-table-sort');

  const prevBtn = document.getElementById('hunts-prev-page-btn');
  const nextBtn = document.getElementById('hunts-next-page-btn');

  const onFilterChange = () => {
    currentPage = 1;
    renderHuntsCatalog();
  };

  searchInput?.addEventListener('input', onFilterChange);
  regionSelect?.addEventListener('change', onFilterChange);
  minLvlInput?.addEventListener('input', onFilterChange);
  maxLvlInput?.addEventListener('input', onFilterChange);
  sortSelect?.addEventListener('change', onFilterChange);

  prevBtn?.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderHuntsCatalog();
      scrollTableToTop();
    }
  });

  nextBtn?.addEventListener('click', () => {
    currentPage++;
    renderHuntsCatalog();
    scrollTableToTop();
  });
}

function scrollTableToTop() {
  document.getElementById('dex-panel-hunts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function renderHuntsCatalog() {
  const tbody = document.getElementById('hunts-catalog-body');
  const counterEl = document.getElementById('hunts-table-counter');
  const pageInfoEl = document.getElementById('hunts-page-info');
  const prevBtn = document.getElementById('hunts-prev-page-btn');
  const nextBtn = document.getElementById('hunts-next-page-btn');

  if (!tbody || allHunts.length === 0) return;

  const searchQuery = (document.getElementById('hunts-table-search')?.value || '').toLowerCase().trim();
  const regionVal = document.getElementById('hunts-table-region')?.value || 'all';
  const minLvl = parseInt(document.getElementById('hunts-table-min-lvl')?.value, 10) || 0;
  const maxLvl = parseInt(document.getElementById('hunts-table-max-lvl')?.value, 10) || Infinity;
  const sortVal = document.getElementById('hunts-table-sort')?.value || 'lvl_asc';

  // 1. FILTRAGEM
  let list = allHunts.filter(h => {
    const lvl = h.nivel ?? h.level ?? 1;
    if (lvl < minLvl || lvl > maxLvl) return false;

    const reg = (h.region ?? h.area ?? 'kanto').toLowerCase();
    if (regionVal !== 'all' && reg !== regionVal.toLowerCase()) return false;

    if (searchQuery) {
      const nm = (h.nome ?? h.name ?? '').toLowerCase();
      const inMobs = (h.especies || []).some(e => (e.nome || '').toLowerCase().includes(searchQuery));
      if (!nm.includes(searchQuery) && !reg.includes(searchQuery) && !inMobs && !String(lvl).includes(searchQuery)) {
        return false;
      }
    }

    return true;
  });

  // 2. ORDENAÇÃO
  list.sort((a, b) => {
    const lvlA = a.nivel ?? a.level ?? 1;
    const lvlB = b.nivel ?? b.level ?? 1;
    const nmA = a.nome ?? a.name ?? '';
    const nmB = b.nome ?? b.name ?? '';
    const xpA = a.xpPorHora || 0;
    const xpB = b.xpPorHora || 0;
    const goldA = a.ouroPorHora || 0;
    const goldB = b.ouroPorHora || 0;

    switch (sortVal) {
      case 'lvl_asc': return lvlA - lvlB || nmA.localeCompare(nmB);
      case 'lvl_desc': return lvlB - lvlA || nmA.localeCompare(nmB);
      case 'xp_desc': return xpB - xpA || lvlA - lvlB;
      case 'gold_desc': return goldB - goldA || lvlA - lvlB;
      case 'name_asc': return nmA.localeCompare(nmB);
      default: return lvlA - lvlB;
    }
  });

  if (counterEl) {
    counterEl.textContent = `${list.length} Hunts Filtradas`;
  }

  // 3. PAGINAÇÃO
  const totalPages = Math.max(1, Math.ceil(list.length / ITEMS_PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;

  if (pageInfoEl) {
    pageInfoEl.textContent = `Página ${currentPage} de ${totalPages} (${list.length} total)`;
  }
  if (prevBtn) prevBtn.disabled = (currentPage === 1);
  if (nextBtn) nextBtn.disabled = (currentPage === totalPages);

  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
  const pageItems = list.slice(startIdx, startIdx + ITEMS_PER_PAGE);

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--vao-dim);">Nenhuma hunt encontrada com esses filtros.</td></tr>`;
    return;
  }

  // 4. RENDERIZAÇÃO
  tbody.innerHTML = pageItems.map(h => {
    const lvl = h.nivel ?? h.level ?? 1;
    const nm = h.nome ?? h.name ?? 'Hunt';
    const reg = (h.region ?? h.area ?? 'kanto').toLowerCase();
    const regLabel = REGION_NAMES[reg] || reg.toUpperCase();

    // Spawns
    const mobsHtml = (h.especies || []).map(e => {
      const sp = speciesMap.get(e.pokeId);
      const looktype = sp?.looktype || 0;
      const dex = sp?.dex || (e.pokeId < 1000 ? e.pokeId : e.pokeId % 1000);
      return `
        <div class="hunt-mob-chip vao" style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 4px; margin: 2px;">
          <span class="hunt-mob-icon-holder" data-looktype="${looktype}" data-dex="${dex}"></span>
          <span style="font-weight: 700; color: #fff; font-size: 11px;">${e.nome || sp?.name || 'Mob'}</span>
          <span style="font-size: 10px; color: var(--accent-gold); font-weight: 600;">${e.pesoPct || 100}%</span>
        </div>
      `;
    }).join(' ');

    const xpHourStr = (h.xpPorHora || 0).toLocaleString('pt-BR');
    const goldHourStr = (h.ouroPorHora || 0).toLocaleString('pt-BR');
    const xpMobStr = (h.especies?.[0]?.xpDerrota || 0).toLocaleString('pt-BR');

    return `
      <tr>
        <td style="white-space: nowrap;">
          <span class="badge-hunt-nv">Nv ${lvl}</span>
        </td>
        <td style="font-weight: 700; color: #fff; font-size: 1.05rem;">
          ${nm}
        </td>
        <td>
          <span class="hero-badge" style="margin: 0; font-size: 10px; padding: 2px 8px;">${regLabel}</span>
        </td>
        <td style="max-width: 320px;">
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            ${mobsHtml}
          </div>
        </td>
        <td style="font-family: Tahoma, sans-serif; white-space: nowrap;">
          <strong style="color: var(--accent-emerald); font-size: 0.98rem;">${xpHourStr} XP/h</strong>
          <span style="display: block; font-size: 10px; color: var(--vao-dim);">~${xpMobStr} XP/kill</span>
        </td>
        <td style="font-family: Tahoma, sans-serif; white-space: nowrap;">
          <strong style="color: var(--accent-gold); font-size: 0.98rem;">${goldHourStr} coins/h</strong>
          <span style="display: block; font-size: 10px; color: var(--vao-dim);">~${h.killsH || 980} kills/h</span>
        </td>
        <td style="white-space: nowrap;">
          <button class="btn on btn-sim-hunt" data-slug="${h.slug || h.id}" data-level="${lvl}" style="font-size: 11px; padding: 5px 10px;">
            Simular XP
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Mini sprites nos chips de mobs
  tbody.querySelectorAll('.hunt-mob-icon-holder').forEach(holder => {
    const looktype = parseInt(holder.dataset.looktype, 10);
    const dex = parseInt(holder.dataset.dex, 10);
    const fallback = dex > 0 ? `assets/sprites-pokemon/normal/${dex}.png` : null;
    const cv = criarCanvasSprite(looktype, 20, 3, fallback);
    holder.appendChild(cv);
  });

  // Botões de ação "Simular XP"
  tbody.querySelectorAll('.btn-sim-hunt').forEach(btn => {
    btn.addEventListener('click', () => {
      const slug = btn.dataset.slug;
      const level = parseInt(btn.dataset.level, 10) || 1;

      document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('.nav-tab-btn[data-view="view-calculators"]')?.classList.add('active');
      document.querySelectorAll('.portal-view').forEach(v => v.classList.remove('active-view'));
      document.getElementById('view-calculators')?.classList.add('active-view');

      const lvlFromInput = document.getElementById('xp-lvl-from');
      const lvlToInput = document.getElementById('xp-lvl-to');
      const huntSelect = document.getElementById('xp-hunt-select');

      if (lvlFromInput) lvlFromInput.value = level;
      if (lvlToInput) lvlToInput.value = Math.min(100000, level + 50);
      if (huntSelect) {
        huntSelect.value = slug;
      }

      const evt = new Event('input', { bubbles: true });
      lvlFromInput?.dispatchEvent(evt);

      document.getElementById('calc-xp')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}
