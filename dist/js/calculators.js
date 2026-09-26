/**
 * POKÉIDLE HUB — CENTRAL DE CALCULADORAS INTERATIVAS
 * Foco em TEMPO ESTIMADO e EVOLUÇÃO LEVEL A LEVEL fiel ao código oficial
 */

import {
  xpTotal,
  xpCustoNivel,
  deltaXp,
  xpBaseDoNivel,
  calcularMultiplicadorXp,
  formatarTempo,
  calcularEvolucaoLevelALevel,
  refinoCustoDegrau,
  refinoCustoTotal,
  refinoCustoEntre,
  simularOferenda,
  calcularNotaPokemon
} from './formulas.js';

let allHunts = [];
let allSpecies = [];

export async function initCalculators() {
  try {
    const [huntsRes, specRes] = await Promise.all([
      fetch('data/hunts_portal.json'),
      fetch('data/pokedex_portal.json')
    ]);
    allHunts = await huntsRes.json();
    allSpecies = await specRes.json();
  } catch (e) {
    console.warn('Erro ao carregar dados auxiliares das calculadoras:', e);
  }

  setupSubtabs();
  setupXpCalculator();
  setupBoostCalculator();
  setupRefinoOferendaCalculator();
  setupNotaCalculator();
}

function setupSubtabs() {
  const tabs = document.querySelectorAll('.calc-subtab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active', 'on'));
      btn.classList.add('active', 'on');
      const target = btn.dataset.calcTarget;
      document.querySelectorAll('.calc-panel').forEach(p => p.classList.remove('active-panel'));
      document.getElementById(target)?.classList.add('active-panel');
    });
  });
}

// ------------------------------------------------------------------ 1. CALCULADORA DE XP & TEMPO DO TREINADOR
let currentFarmMode = 'route'; // 'route' | 'single'

function setupXpCalculator() {
  const lvlFrom = document.getElementById('xp-lvl-from');
  const lvlTo = document.getElementById('xp-lvl-to');
  const cbVip = document.getElementById('xp-cb-vip');
  const cbBoostXp = document.getElementById('xp-cb-boost');
  const guildInput = document.getElementById('xp-guild-input');
  const eventInput = document.getElementById('xp-event-input');
  const speedSelect = document.getElementById('xp-speed-select');
  const speedCustom = document.getElementById('xp-speed-custom');
  const huntSelect = document.getElementById('xp-hunt-select');
  const huntSearch = document.getElementById('xp-hunt-search');
  const btnRoute = document.getElementById('btn-mode-route');
  const btnSingle = document.getElementById('btn-mode-single');

  // Alternador de Estratégia (Rota Otimizada vs Hunt Fixa)
  btnRoute?.addEventListener('click', () => {
    currentFarmMode = 'route';
    btnRoute.classList.add('on', 'active');
    btnRoute.classList.remove('apagado');
    btnSingle?.classList.remove('on', 'active');
    btnSingle?.classList.add('apagado');
    const lbl = document.getElementById('label-hunt-select');
    if (lbl) lbl.textContent = 'Hunt Inicial de Partida';
    updateXpCalculation();
  });

  btnSingle?.addEventListener('click', () => {
    currentFarmMode = 'single';
    btnSingle.classList.add('on', 'active');
    btnSingle.classList.remove('apagado');
    btnRoute?.classList.remove('on', 'active');
    btnRoute?.classList.add('apagado');
    const lbl = document.getElementById('label-hunt-select');
    if (lbl) lbl.textContent = 'Hunt Fixa Onde Irá Caçar';
    updateXpCalculation();
  });

  // Popular Hunts organizadas por região e nível
  populateHuntsDropdown();

  // Busca em tempo real de hunts
  huntSearch?.addEventListener('input', (e) => {
    populateHuntsDropdown(e.target.value.trim());
    updateXpCalculation();
  });

  // Velocidade de combate (preset vs custom)
  speedSelect?.addEventListener('change', () => {
    if (speedSelect.value === 'custom') {
      if (speedCustom) speedCustom.style.display = 'inline-block';
    } else {
      if (speedCustom) speedCustom.style.display = 'none';
    }
    updateXpCalculation();
  });

  const inputs = [lvlFrom, lvlTo, cbVip, cbBoostXp, guildInput, eventInput, speedSelect, speedCustom, huntSelect];
  inputs.forEach(el => el?.addEventListener('input', updateXpCalculation));

  updateXpCalculation();
}

const REGION_ORDER = ['kanto', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'outland', 'orre'];
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

function populateHuntsDropdown(filterText = '') {
  const huntSelect = document.getElementById('xp-hunt-select');
  const countBadge = document.getElementById('hunts-count-badge');
  if (!huntSelect || allHunts.length === 0) return;

  const prevSelected = huntSelect.value;
  const currentLvlFrom = parseInt(document.getElementById('xp-lvl-from')?.value, 10) || 500;

  const query = filterText.toLowerCase();
  const filtered = filterText
    ? allHunts.filter(h => {
        const nm = (h.nome ?? h.name ?? '').toLowerCase();
        const reg = (h.region ?? h.area ?? '').toLowerCase();
        const lvlStr = String(h.nivel ?? h.level ?? '');
        return nm.includes(query) || reg.includes(query) || lvlStr.includes(query);
      })
    : allHunts;

  if (countBadge) {
    countBadge.textContent = `${filtered.length} Hunts`;
  }

  // Agrupa por região
  const grouped = new Map();
  REGION_ORDER.forEach(r => grouped.set(r, []));

  filtered.forEach(h => {
    const reg = (h.region ?? h.area ?? 'kanto').toLowerCase();
    if (!grouped.has(reg)) grouped.set(reg, []);
    grouped.get(reg).push(h);
  });

  let html = '';
  let defaultOptionSlug = '';
  let closestDiff = Infinity;

  for (const [regKey, list] of grouped.entries()) {
    if (list.length === 0) continue;
    const regName = REGION_NAMES[regKey] || regKey.toUpperCase();
    html += `<optgroup label="${regName} (${list.length} hunts)">`;
    list.sort((a, b) => (a.nivel ?? a.level ?? 1) - (b.nivel ?? b.level ?? 1));

    list.forEach(h => {
      const lvl = h.nivel ?? h.level ?? 1;
      const nm = h.nome ?? h.name ?? 'Hunt';
      const slug = h.slug || h.id;

      // Encontra a melhor opção padrão próxima do nível inicial
      const diff = Math.abs(lvl - currentLvlFrom);
      if (lvl <= currentLvlFrom && diff < closestDiff) {
        closestDiff = diff;
        defaultOptionSlug = slug;
      }

      html += `<option value="${slug}" data-level="${lvl}">[Nv ${lvl}] ${nm} (${regName})</option>`;
    });

    html += `</optgroup>`;
  }

  huntSelect.innerHTML = html;

  if (prevSelected && huntSelect.querySelector(`option[value="${prevSelected}"]`)) {
    huntSelect.value = prevSelected;
  } else if (defaultOptionSlug) {
    huntSelect.value = defaultOptionSlug;
  }
}

function getSelectedHunt() {
  const huntSelect = document.getElementById('xp-hunt-select');
  const slug = huntSelect?.value;
  if (!slug) return allHunts[0] || null;
  return allHunts.find(h => (h.slug || h.id) === slug) || allHunts[0];
}

function updateXpCalculation() {
  const from = Math.max(1, parseInt(document.getElementById('xp-lvl-from')?.value, 10) || 1);
  const to = Math.max(from + 1, parseInt(document.getElementById('xp-lvl-to')?.value, 10) || (from + 50));

  const vip = document.getElementById('xp-cb-vip')?.checked || false;
  const xpBoost = document.getElementById('xp-cb-boost')?.checked || false;
  const guildPct = parseFloat(document.getElementById('xp-guild-input')?.value) || 0;
  const eventPct = parseFloat(document.getElementById('xp-event-input')?.value) || 0;

  const speedSelect = document.getElementById('xp-speed-select');
  const speedCustom = document.getElementById('xp-speed-custom');
  const killsPorHora = speedSelect?.value === 'custom'
    ? (parseInt(speedCustom?.value, 10) || 980)
    : (parseInt(speedSelect?.value, 10) || 980);

  const selectedHunt = getSelectedHunt();
  const selectedHuntLvl = selectedHunt?.nivel ?? selectedHunt?.level ?? 1;

  // Multiplicador oficial acumulado
  const { multTotal } = calcularMultiplicadorXp({
    vip,
    xpBoost,
    guildBonusPct: guildPct,
    eventBonusPct: eventPct
  });

  const xpTotalReq = deltaXp(from, to);

  // Exibição de Multiplicador e XP Total
  const xpSpan = document.getElementById('res-xp-required');
  if (xpSpan) xpSpan.textContent = xpTotalReq.toLocaleString() + ' XP';

  const multSpan = document.getElementById('res-xp-mult-val');
  if (multSpan) {
    const bonusPct = Math.round((multTotal - 1) * 100);
    multSpan.textContent = `${multTotal.toFixed(2)}× (+${bonusPct}%)`;
  }

  const tempoHero = document.getElementById('res-xp-tempo-hero');
  const heroLabel = document.getElementById('res-hero-label');
  const heroDesc = document.getElementById('res-hero-desc');
  const killsSpan = document.getElementById('res-xp-kills');
  const xpPerKillSpan = document.getElementById('res-xp-per-kill');
  const savingsBanner = document.getElementById('route-savings-banner');
  const routePanel = document.getElementById('xp-route-panel');

  if (currentFarmMode === 'route') {
    // -------------------------------------------------------------
    // MODO ROTA OTIMIZADA (TRANSIÇÕES NOS DEGRAUS DE HUNTS)
    // -------------------------------------------------------------
    const routeData = calcularRotaOtimizada(from, to, multTotal, killsPorHora, selectedHunt);

    if (tempoHero) tempoHero.textContent = formatarTempo(routeData.totalSegundos);
    if (heroLabel) heroLabel.textContent = 'TEMPO TOTAL ESTIMADO (ROTA OTIMIZADA)';
    if (heroDesc) heroDesc.textContent = `Acelerando o progresso ao migrar entre ${routeData.etapas.length} degraus de hunts`;

    if (killsSpan) killsSpan.textContent = '~' + routeData.totalKills.toLocaleString() + ' abates';
    if (xpPerKillSpan) {
      const avgXp = Math.round(xpTotalReq / Math.max(1, routeData.totalKills));
      xpPerKillSpan.textContent = `~${avgXp.toLocaleString()} XP médio/kill`;
    }

    // Economia comparada à hunt fixa inicial
    if (savingsBanner) {
      if (routeData.segundosEconomizados > 120 && routeData.etapas.length > 1) {
        savingsBanner.style.display = 'block';
        const savingsTimeStr = formatarTempo(routeData.segundosEconomizados);
        const titleEl = document.getElementById('route-savings-title');
        const descEl = document.getElementById('route-savings-desc');
        if (titleEl) {
          titleEl.textContent = `Economia de ${savingsTimeStr} (-${routeData.pctEconomia.toFixed(1)}% mais rápido!)`;
        }
        if (descEl) {
          descEl.textContent = `Ao migrar pelas hunts intermediárias, você economiza ${savingsTimeStr} de farm comparado a caçar apenas em [Nv ${selectedHuntLvl}] ${selectedHunt.nome}.`;
        }
      } else {
        savingsBanner.style.display = 'none';
      }
    }

    // Renderiza painel e timeline de etapas
    if (routePanel) routePanel.style.display = 'block';
    renderRouteTimeline(routeData.etapas);

    // Tabela nível a nível espelhando a rota
    renderRouteStepsTable(routeData.levelSteps);

  } else {
    // -------------------------------------------------------------
    // MODO HUNT FIXA (MESMA HUNT DO INÍCIO AO FIM)
    // -------------------------------------------------------------
    const xpBaseMob = xpBaseDoNivel(selectedHuntLvl);
    const xpEfetivoMob = Math.round(xpBaseMob * multTotal);
    const killsTotal = Math.ceil(xpTotalReq / Math.max(1, xpEfetivoMob));
    const segundosTotal = (killsTotal / killsPorHora) * 3600;

    if (tempoHero) tempoHero.textContent = formatarTempo(segundosTotal);
    if (heroLabel) heroLabel.textContent = 'TEMPO TOTAL ESTIMADO (HUNT FIXA)';
    if (heroDesc) heroDesc.textContent = `Caçando continuamente em [Nv ${selectedHuntLvl}] ${selectedHunt.nome}`;

    if (killsSpan) killsSpan.textContent = '~' + killsTotal.toLocaleString() + ' abates';
    if (xpPerKillSpan) {
      xpPerKillSpan.textContent = `${xpEfetivoMob.toLocaleString()} XP/kill (Base: ${xpBaseMob})`;
    }

    if (savingsBanner) savingsBanner.style.display = 'none';
    if (routePanel) routePanel.style.display = 'none';

    // Tabela nível a nível tradicional
    const evolucao = calcularEvolucaoLevelALevel({
      lvlFrom: from,
      lvlTo: to,
      huntLevel: selectedHuntLvl,
      multXp: multTotal,
      killsPorHora
    });
    renderLevelStepsTable(evolucao.steps);
  }
}

/**
 * Motor de Cálculo da Rota Otimizada de Hunts
 */
function calcularRotaOtimizada(from, to, multTotal, killsPorHora, initialHunt) {
  // 1. Encontra todos os níveis distintos de hunt entre 'from' e 'to'
  const distinctLevels = [...new Set(allHunts.map(h => h.nivel ?? h.level ?? 1))]
    .filter(lvl => lvl > from && lvl < to)
    .sort((a, b) => a - b);

  // 2. Filtra degraus significativos para evitar fragmentação excessiva
  let selectedTiers = [];
  if (distinctLevels.length <= 8) {
    selectedTiers = distinctLevels;
  } else {
    // Agrupa degraus garantindo saltos expressivos (pelo menos 30 a 50 níveis ou marcos importantes)
    let lastLevel = from;
    const minJump = Math.max(30, Math.floor((to - from) / 8));
    for (const lvl of distinctLevels) {
      if ((lvl - lastLevel) >= minJump || (lvl % 500 === 0) || (lvl % 100 === 0 && lvl < 1000)) {
        selectedTiers.push(lvl);
        lastLevel = lvl;
      }
    }
  }

  const milestones = [from, ...selectedTiers, to];
  const etapas = [];
  let totalSegundos = 0;
  let totalKills = 0;
  const levelSteps = [];

  let tempoAcumuladoSec = 0;

  for (let i = 0; i < milestones.length - 1; i++) {
    const lFrom = milestones[i];
    const lTo = milestones[i + 1];
    const deltaXpEtapa = deltaXp(lFrom, lTo);

    // Melhor hunt disponível para este degrau (maior nível <= lFrom)
    let bestHunt = initialHunt;
    if (i > 0 || !bestHunt || (bestHunt.nivel ?? bestHunt.level ?? 1) > lFrom) {
      const candidates = allHunts.filter(h => (h.nivel ?? h.level ?? 1) <= lFrom);
      if (candidates.length > 0) {
        bestHunt = candidates.sort((a, b) => (b.nivel ?? b.level ?? 1) - (a.nivel ?? a.level ?? 1))[0];
      }
    }

    const huntLvl = bestHunt.nivel ?? bestHunt.level ?? 1;
    const xpBase = xpBaseDoNivel(huntLvl);
    const xpEfetivo = Math.round(xpBase * multTotal);
    const killsEtapa = Math.ceil(deltaXpEtapa / Math.max(1, xpEfetivo));
    const segundosEtapa = (killsEtapa / killsPorHora) * 3600;

    totalKills += killsEtapa;
    totalSegundos += segundosEtapa;

    etapas.push({
      num: i + 1,
      lvlFrom: lFrom,
      lvlTo: lTo,
      hunt: bestHunt,
      deltaXp: deltaXpEtapa,
      xpMob: xpEfetivo,
      kills: killsEtapa,
      segundos: segundosEtapa,
      tempoFormatado: formatarTempo(segundosEtapa)
    });

    // Detalhamento level a level desta etapa
    for (let l = lFrom; l < lTo; l++) {
      const custoL = xpCustoNivel(l);
      const k = Math.ceil(custoL / Math.max(1, xpEfetivo));
      const sec = (k / killsPorHora) * 3600;
      tempoAcumuladoSec += sec;

      levelSteps.push({
        nivelDe: l,
        nivelPara: l + 1,
        custoXp: custoL,
        kills: k,
        huntNome: bestHunt.nome,
        huntNivel: huntLvl,
        tempoNivelFormatado: formatarTempo(sec),
        tempoAcumuladoFormatado: formatarTempo(tempoAcumuladoSec)
      });
    }
  }

  // Comparação com a hunt fixa inicial
  const initLvl = initialHunt?.nivel ?? initialHunt?.level ?? 1;
  const xpBaseInit = xpBaseDoNivel(initLvl);
  const xpEfetivoInit = Math.round(xpBaseInit * multTotal);
  const singleKills = Math.ceil(deltaXp(from, to) / Math.max(1, xpEfetivoInit));
  const singleSegundos = (singleKills / killsPorHora) * 3600;

  const segundosEconomizados = Math.max(0, singleSegundos - totalSegundos);
  const pctEconomia = singleSegundos > 0 ? (segundosEconomizados / singleSegundos) * 100 : 0;

  return {
    etapas,
    totalKills,
    totalSegundos,
    singleKills,
    singleSegundos,
    segundosEconomizados,
    pctEconomia,
    levelSteps
  };
}

/**
 * Renderiza a Timeline das Etapas da Rota
 */
function renderRouteTimeline(etapas) {
  const container = document.getElementById('route-timeline-container');
  const countBadge = document.getElementById('route-legs-count');
  if (!container) return;

  if (countBadge) countBadge.textContent = `${etapas.length} Etapas`;

  container.innerHTML = etapas.map(e => `
    <div class="vao" style="padding: 14px 16px; border-radius: 6px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; border-left: 4px solid var(--marca);">
      <div style="display: flex; align-items: center; gap: 12px; min-width: 240px;">
        <span class="btn on" style="font-size: 11px; padding: 4px 8px; min-width: 28px; text-align: center;">${e.num}</span>
        <div>
          <div style="font-weight: 800; font-size: 1.05rem; color: #fff;">
            Nv ${e.lvlFrom} → Nv ${e.lvlTo}
          </div>
          <div style="font-size: 0.84rem; color: var(--accent-cyan); display: flex; align-items: center; gap: 6px; margin-top: 2px;">
            <span>Hunt: <strong>[Nv ${e.hunt.nivel ?? e.hunt.level}] ${e.hunt.nome}</strong></span>
            <span style="color: var(--vao-dim);">(${REGION_NAMES[e.hunt.region ?? e.hunt.area] || e.hunt.area})</span>
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 18px; align-items: center; font-family: Tahoma, sans-serif;">
        <div style="text-align: right;">
          <div style="font-size: 0.75rem; color: var(--sobre-mad-dim);">XP da Etapa</div>
          <div style="font-weight: 700; color: #fff; font-size: 0.95rem;">${e.deltaXp.toLocaleString()}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 0.75rem; color: var(--sobre-mad-dim);">Abates</div>
          <div style="font-weight: 700; color: var(--accent-gold); font-size: 0.95rem;">~${e.kills.toLocaleString()}</div>
        </div>
        <div style="text-align: right; min-width: 90px;">
          <div style="font-size: 0.75rem; color: var(--sobre-mad-dim);">Tempo Previsto</div>
          <div style="font-weight: 800; color: var(--accent-emerald); font-size: 1.05rem;">${e.tempoFormatado}</div>
        </div>
      </div>
    </div>
  `).join('');
}

function renderRouteStepsTable(steps) {
  const tbody = document.getElementById('xp-steps-table-body');
  const countBadge = document.getElementById('xp-steps-count');
  if (!tbody) return;

  if (countBadge) countBadge.textContent = `${steps.length} níveis calculados`;

  const displaySteps = steps.slice(0, 100);

  tbody.innerHTML = displaySteps.map(s => `
    <tr>
      <td style="font-weight: 700; color: var(--accent-cyan);">
        Nv ${s.nivelDe} → Nv ${s.nivelPara}
      </td>
      <td style="color: #fff;">
        ${s.custoXp.toLocaleString()} XP
      </td>
      <td style="color: var(--accent-gold);">
        ~${s.kills.toLocaleString()} kills
      </td>
      <td style="font-weight: 600; color: var(--accent-emerald);">
        ⏱️ ${s.tempoNivelFormatado}
      </td>
      <td style="font-weight: 700; color: #fff;">
        ${s.tempoAcumuladoFormatado}
        <span style="display: block; font-size: 10px; color: var(--vao-dim); font-weight: 400;">
          [Nv ${s.huntNivel}] ${s.huntNome}
        </span>
      </td>
    </tr>
  `).join('');

  if (steps.length > 100) {
    tbody.innerHTML += `
      <tr>
        <td colspan="5" style="text-align:center; padding: 1rem; color: var(--accent-cyan); font-weight: 600;">
          ... Mostrando os primeiros 100 níveis da jornada (Tempo Total: ${steps[steps.length - 1].tempoAcumuladoFormatado})
        </td>
      </tr>
    `;
  }
}

function renderLevelStepsTable(steps) {
  const tbody = document.getElementById('xp-steps-table-body');
  const countBadge = document.getElementById('xp-steps-count');
  if (!tbody) return;

  if (countBadge) countBadge.textContent = `${steps.length} níveis calculados`;

  if (steps.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 1.5rem; color:var(--text-dim);">Nenhum degrau para calcular (nível inicial igual ao alvo).</td></tr>`;
    return;
  }

  const displaySteps = steps.slice(0, 100);

  tbody.innerHTML = displaySteps.map(s => `
    <tr>
      <td style="font-weight: 700; color: var(--accent-cyan);">
        Nv ${s.nivelDe} → Nv ${s.nivelPara}
      </td>
      <td style="color: #fff;">
        ${s.custoXp.toLocaleString()} XP
      </td>
      <td style="color: var(--accent-gold);">
        ~${s.kills.toLocaleString()} kills
      </td>
      <td style="font-weight: 600; color: var(--accent-emerald);">
        ⏱️ ${s.tempoNivelFormatado}
      </td>
      <td style="font-weight: 700; color: #fff;">
        ${s.tempoAcumuladoFormatado}
      </td>
    </tr>
  `).join('');

  if (steps.length > 100) {
    tbody.innerHTML += `
      <tr>
        <td colspan="5" style="text-align:center; padding: 1rem; color: var(--accent-cyan); font-weight: 600;">
          ... Mostrando os primeiros 100 níveis (Tempo Total Completo: ${steps[steps.length - 1].tempoAcumuladoFormatado})
        </td>
      </tr>
    `;
  }
}

// ------------------------------------------------------------------ 2. CALCULADORA DE BOOSTS
function setupBoostCalculator() {
  const cbs = ['boost-calc-vip', 'boost-calc-xp-tr', 'boost-calc-xp-pk', 'boost-calc-cap', 'boost-calc-lure'];
  cbs.forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateBoostCalculation);
  });
  document.getElementById('boost-guild-input')?.addEventListener('input', updateBoostCalculation);
  updateBoostCalculation();
}

function updateBoostCalculation() {
  const vip = document.getElementById('boost-calc-vip')?.checked || false;
  const xpTr = document.getElementById('boost-calc-xp-tr')?.checked || false;
  const xpPk = document.getElementById('boost-calc-xp-pk')?.checked || false;
  const cap = document.getElementById('boost-calc-cap')?.checked || false;
  const lure = document.getElementById('boost-calc-lure')?.checked || false;
  const guildPct = parseFloat(document.getElementById('boost-guild-input')?.value) || 0;

  const multGuild = 1 + (Math.max(0, Math.min(10, guildPct)) / 100);

  let multTr = 1.0;
  let multPk = 1.0;
  if (vip) { multTr *= 1.5; multPk *= 1.5; }
  if (xpTr) { multTr *= 1.5; }
  if (xpPk) { multPk *= 1.5; }

  multTr *= multGuild;
  multPk *= multGuild;

  const capMult = cap ? '2.00× (100% de bônus na chance de arremesso)' : '1.00× (Chance normal)';
  const lureMult = lure ? '2.00× (1 em 12.000 em vez de 1 em 24.000)' : '1.00× (1 em 24.000)';

  const trEl = document.getElementById('res-boost-tr');
  const pkEl = document.getElementById('res-boost-pk');
  const capEl = document.getElementById('res-boost-cap');
  const lureEl = document.getElementById('res-boost-lure');

  if (trEl) trEl.textContent = multTr.toFixed(3) + '× (' + (multTr > 1 ? '+' + Math.round((multTr - 1) * 100) + '%' : 'Sem bônus') + ')';
  if (pkEl) pkEl.textContent = multPk.toFixed(3) + '× (' + (multPk > 1 ? '+' + Math.round((multPk - 1) * 100) + '%' : 'Sem bônus') + ')';
  if (capEl) capEl.textContent = capMult;
  if (lureEl) lureEl.textContent = lureMult;
}

// ------------------------------------------------------------------ 3. REFINO & OFERENDA
function setupRefinoOferendaCalculator() {
  const refFrom = document.getElementById('refino-from');
  const refTo = document.getElementById('refino-to');

  [refFrom, refTo].forEach(el => el?.addEventListener('input', updateRefinoCalculation));
  updateRefinoCalculation();

  // Oferenda Simulator
  const addBtn = document.getElementById('oferenda-add-btn');
  const clearBtn = document.getElementById('oferenda-clear-btn');
  addBtn?.addEventListener('click', adicionarPokemonOferenda);
  clearBtn?.addEventListener('click', limparOferenda);
  updateOferendaDisplay();
}

function updateRefinoCalculation() {
  const from = parseInt(document.getElementById('refino-from')?.value, 10) || 0;
  const to = parseInt(document.getElementById('refino-to')?.value, 10) || 1;

  const stonesRequired = refinoCustoEntre(from, to);
  const nextTierCost = refinoCustoDegrau(to);

  const hours = +(stonesRequired / 20).toFixed(1);
  const days = +(hours / 24).toFixed(1);

  const stonesSpan = document.getElementById('res-refino-stones');
  const nextSpan = document.getElementById('res-refino-next');
  const timeSpan = document.getElementById('res-refino-time');

  if (stonesSpan) stonesSpan.textContent = stonesRequired.toLocaleString() + ' pedras do tipo';
  if (nextSpan) nextSpan.textContent = nextTierCost.toLocaleString() + ' pedras';
  if (timeSpan) timeSpan.textContent = `~${hours} horas (~${days} dias a 20 pedras/h)`;
}

let oferendaList = [
  { name: 'Charmander', type1: 'FIRE', shiny: false },
  { name: 'Bulbasaur', type1: 'GRASS', type2: 'POISON', shiny: false },
  { name: 'Gengar', type1: 'GHOST', type2: 'POISON', shiny: false }
];

function adicionarPokemonOferenda() {
  if (oferendaList.length >= 5) {
    alert('A roleta da oferenda aceita no máximo 5 pokémon!');
    return;
  }
  const typeSelect = document.getElementById('oferenda-type-input');
  const isShiny = document.getElementById('oferenda-shiny-input')?.checked || false;
  const type = typeSelect?.value || 'FIRE';

  oferendaList.push({
    name: `Pokémon ${type}`,
    type1: type,
    shiny: isShiny
  });

  updateOferendaDisplay();
}

function limparOferenda() {
  oferendaList = [];
  updateOferendaDisplay();
}

function updateOferendaDisplay() {
  const listEl = document.getElementById('oferenda-slots-list');
  const resEl = document.getElementById('oferenda-results-box');
  if (!listEl || !resEl) return;

  listEl.innerHTML = oferendaList.map((p, idx) => `
    <div style="background: rgba(0,0,0,0.3); padding: 0.5rem 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between;">
      <div>
        <strong>Slot ${idx + 1}:</strong> ${p.shiny ? 'Shiny ' : ''}${p.name}
        <span class="type-pill type-${p.type1.toLowerCase()}" style="margin-left: 0.5rem;">${p.type1}</span>
      </div>
      <button onclick="window.removerSlotOferenda(${idx})" style="background:transparent; border:none; color:var(--danger); cursor:pointer; font-weight:700;">Remover</button>
    </div>
  `).join('') || '<p style="color:var(--text-dim);">Nenhum Pokémon na roleta. Adicione até 5 pokémon abaixo.</p>';

  window.removerSlotOferenda = (idx) => {
    oferendaList.splice(idx, 1);
    updateOferendaDisplay();
  };

  const sim = simularOferenda(oferendaList);
  resEl.innerHTML = `
    <h4 style="font-size: 0.82rem; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.75rem;">Divisão da Roleta (${oferendaList.length}/5 Slots)</h4>
    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
      ${sim.fatias.map(f => `
        <div style="display:flex; justify-content: space-between; align-items: center; padding: 0.4rem 0.6rem; background: rgba(255,255,255,0.03); border-radius: 4px;">
          <span style="font-weight: 600; color: ${f.nome.includes('Shiny Stone') ? 'var(--gold-accent)' : 'var(--text-main)'};">${f.nome}</span>
          <strong style="font-family: var(--font-mono); color: var(--accent-cyan);">${f.pct}%</strong>
        </div>
      `).join('')}
    </div>
  `;
}

// ------------------------------------------------------------------ 4. CALCULADORA DE NOTA (N=)
function setupNotaCalculator() {
  const ivSlider = document.getElementById('nota-iv-sum');
  const qSlider = document.getElementById('nota-qualidade');
  const pSelect = document.getElementById('nota-potencia');
  const shinyCb = document.getElementById('nota-shiny');
  const specSelect = document.getElementById('nota-spec-select');

  if (specSelect && allSpecies.length > 0) {
    specSelect.innerHTML = `<option value="">Bases Neutras (Média do Catálogo 80/80/80...)</option>` +
      allSpecies.slice(0, 300).map(s => `
        <option value="${s.dex}">#${s.dex} - ${s.name} (BST: ${s.bst})</option>
      `).join('');
  }

  const inputs = [ivSlider, qSlider, pSelect, shinyCb, specSelect];
  inputs.forEach(el => el?.addEventListener('input', updateNotaCalculation));

  updateNotaCalculation();
}

function updateNotaCalculation() {
  const ivSum = parseInt(document.getElementById('nota-iv-sum')?.value, 10) || 100;
  const qualidade = parseFloat(document.getElementById('nota-qualidade')?.value) || 1.15;
  const potencia = parseInt(document.getElementById('nota-potencia')?.value, 10) || 1;
  const shiny = document.getElementById('nota-shiny')?.checked || false;
  const specDex = parseInt(document.getElementById('nota-spec-select')?.value, 10) || 0;

  document.getElementById('nota-iv-val').textContent = ivSum;
  document.getElementById('nota-q-val').textContent = qualidade.toFixed(2);

  const med = Math.floor(ivSum / 6);
  const rest = ivSum - (med * 6);
  const ivs = { hp: med, atk: med, def: med, spAtk: med, spDef: med, speed: med };
  const keys = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
  for (let i = 0; i < rest; i++) ivs[keys[i]]++;

  let bases = { hp: 80, atk: 80, def: 80, spAtk: 80, spDef: 80, speed: 80 };
  if (specDex > 0) {
    const sp = allSpecies.find(x => x.dex === specDex);
    if (sp?.baseStats) bases = sp.baseStats;
  }

  const res = calcularNotaPokemon({ ivs, qualidade, potencia, shiny, bases });

  const notaEl = document.getElementById('res-nota-score');
  const faixaEl = document.getElementById('res-nota-faixa');
  const somaEl = document.getElementById('res-nota-soma');

  if (notaEl) notaEl.textContent = res.nota.toFixed(3);
  if (faixaEl) faixaEl.textContent = res.faixa;
  if (somaEl) somaEl.textContent = res.soma.toLocaleString();
}
