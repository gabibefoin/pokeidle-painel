const app = document.querySelector('#app');
let pokemonData = [];
let huntsData = [];
window.pokemonData = pokemonData;

const dexState = {
  tab: 'captura',
  search: '',
  tipo1: 'all',
  tipo2: 'all',
  regiao: 'all',
  apenasShiny: false,
  ball: 'poke',
  captureBoost: false,
  shinyLure: false
};

// Load JSON datasets from data/
async function loadData() {
  try {
    const [pokedexRes, huntsRes] = await Promise.all([
      fetch('data/pokedex_portal.json'),
      fetch('data/hunts_portal.json')
    ]);
    pokemonData = await pokedexRes.json();
    huntsData = await huntsRes.json();
    window.pokemonData = pokemonData;
    console.log('PokéIdle Hub — Dados carregados com sucesso:', pokemonData.length, 'Pokémon');
  } catch (err) {
    console.error('Erro ao carregar dados em JSON:', err);
  }
}

// Helpers
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

function getBallRates(r, ballKey, captureBoost, shinyLure) {
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
  let numPct = 0;
  if (catchPctStr) {
    numPct = parseFloat(String(catchPctStr).replace(',', '.'));
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

const renderTypes = (t1, t2) => {
  let h = `<span class="type ${t1 ? t1.toLowerCase() : ''}">${t1 || ''}</span>`;
  if (t2) h += ` <span class="type ${t2.toLowerCase()}">${t2}</span>`;
  return h;
};

// ==========================================
// VIEWS
// ==========================================

function home() {
  return `
    <div class="home-wire">
      <section class="home-banner">
        <div class="banner-image">
          <span>Explore a Pokédex Inteligente e as Calculadoras do PokéIdle MMO</span>
        </div>
        <div class="banner-cta">
          <h1>PokéIdle Hub</h1>
          <p>Portal da comunidade para dados, cálculos de XP, taxas de captura e estratégias.</p>
          <button class="primary" data-go="pokedex">Explorar Pokédex ›</button>
        </div>
      </section>

      <section class="wire-quick-grid">
        <article class="wire-quick">
          <span class="badge">Ferramenta</span>
          <h2>Pokédex Completa</h2>
          <p>Confira taxas de captura por bola, odds shiny, fraquezas e drops.</p>
          <div class="wire-image">870 Espécies</div>
          <button class="secondary" data-go="pokedex">Abrir Pokédex</button>
        </article>
        <article class="wire-quick">
          <span class="badge new">Calculadora</span>
          <h2>Calculadora de XP</h2>
          <p>Simule tempo necessário, abates por hunt e evolução nível a nível.</p>
          <div class="wire-image">Fórmulas Oficiais</div>
          <button class="secondary" data-go="xp">Simular XP</button>
        </article>
        <article class="wire-quick">
          <span class="badge update">Ranking</span>
          <h2>Tier List</h2>
          <p>Descubra os melhores Pokémons para cada estágio do jogo.</p>
          <div class="wire-image">PvE & Hunts</div>
          <button class="secondary" data-go="tier">Ver Tier List</button>
        </article>
        <article class="wire-quick">
          <span class="badge">Guias</span>
          <h2>Guias & Wiki</h2>
          <p>Tutoriais passo a passo para iniciantes e endgame.</p>
          <div class="wire-image">42 Guias</div>
          <button class="secondary" data-go="guides">Ler Guias</button>
        </article>
      </section>
    </div>
  `;
}

function pokedex(tabKey = 'captura') {
  dexState.tab = tabKey;

  let filtered = pokemonData.filter(p => {
    if (dexState.search) {
      const q = dexState.search.toLowerCase();
      const matchName = (p.nome || '').toLowerCase().includes(q);
      const matchDex = String(p.dex || '').includes(q);
      if (!matchName && !matchDex) return false;
    }
    if (dexState.tipo1 !== 'all') {
      if ((p.tipo1 || '').toUpperCase() !== dexState.tipo1.toUpperCase()) return false;
    }
    if (dexState.tipo2 !== 'all') {
      if (dexState.tipo2 === 'none') {
        if (p.tipo2) return false;
      } else {
        if ((p.tipo2 || '').toUpperCase() !== dexState.tipo2.toUpperCase()) return false;
      }
    }
    if (dexState.regiao !== 'all') {
      if ((p.regiao || '').toLowerCase() !== dexState.regiao.toLowerCase()) return false;
    }
    if (dexState.apenasShiny) {
      if (p.tem_forma_shiny !== 'sim') return false;
    }
    return true;
  });

  const typesList = ['BUG','POISON','NORMAL','FLYING','GRASS','WATER','FIRE','ELECTRIC','GROUND','PSYCHIC','ROCK','ICE','FIGHTING','GHOST','DRAGON','STEEL','DARK','FAIRY'];
  const regionsList = ['Kanto','Johto','Hoenn','Sinnoh','Unova','Kalos','Alola','Galar','Paldea'];

  let tableHeaderHtml = '';
  if (dexState.tab === 'captura') {
    tableHeaderHtml = `
      <tr>
        <th style="width:70px">#ID</th>
        <th>POKÉMON</th>
        <th style="width:140px">TIPOS</th>
        <th>HUNT</th>
        <th style="width:130px; text-align:right">CATCH RATE</th>
        <th style="width:140px; text-align:right">MÉDIA DERROTAS</th>
        <th style="width:140px; text-align:right">SHINY ODDS</th>
        <th style="width:100px; text-align:center">AÇÕES</th>
      </tr>
    `;
  } else if (dexState.tab === 'hunting') {
    tableHeaderHtml = `
      <tr>
        <th style="width:70px">#ID</th>
        <th>POKÉMON</th>
        <th style="width:140px">TIPOS</th>
        <th>HUNT</th>
        <th>FRAQUEZA 4X</th>
        <th>FRAQUEZA 2X</th>
        <th style="width:70px; text-align:right">HP</th>
        <th style="width:100px; text-align:right">XP BASE</th>
        <th style="width:100px; text-align:center">AÇÕES</th>
      </tr>
    `;
  } else if (dexState.tab === 'gold_loot') {
    tableHeaderHtml = `
      <tr>
        <th style="width:70px">#ID</th>
        <th>POKÉMON</th>
        <th style="width:140px">TIPOS</th>
        <th>HUNT</th>
        <th style="width:110px; text-align:right">GOLD NPC</th>
        <th>DROPS & CHANCES</th>
        <th style="width:100px; text-align:center">AÇÕES</th>
      </tr>
    `;
  } else {
    tableHeaderHtml = `
      <tr>
        <th style="width:70px">#ID</th>
        <th>POKÉMON</th>
        <th style="width:140px">TIPOS</th>
        <th>HUNT</th>
        <th style="width:90px; text-align:right">BST TOTAL</th>
        <th style="width:60px; text-align:right">ATK</th>
        <th style="width:60px; text-align:right">DEF</th>
        <th style="width:60px; text-align:right">SP.ATK</th>
        <th style="width:60px; text-align:right">SP.DEF</th>
        <th style="width:60px; text-align:right">SPEED</th>
        <th style="width:100px; text-align:center">AÇÕES</th>
      </tr>
    `;
  }

  let tableRowsHtml = '';
  if (filtered.length === 0) {
    tableRowsHtml = `<tr><td colspan="8" style="text-align:center; padding: 24px; color: #8c929e;">Nenhum Pokémon encontrado com os filtros aplicados.</td></tr>`;
  } else {
    tableRowsHtml = filtered.slice(0, 100).map(p => {
      const formattedDex = '#' + String(p.dex || p.poke_id || 0).padStart(3, '0');
      const spriteFileName = `${parseInt(p.dex, 10)}-${(p.nome || '').toLowerCase().replace(/[^a-z0-9]/g, '_')}.png`;
      const spriteSrc = `assets/sprites-pokemon/normal/${spriteFileName}`;
      const spriteHtml = `<img src="${spriteSrc}" style="width:28px;height:28px;vertical-align:middle;margin-right:8px;" onerror="this.style.display='none'">`;
      const huntFormatted = cleanHunt(p);
      const typesBadge = renderTypes(p.tipo1, p.tipo2);

      if (dexState.tab === 'captura') {
        const stats = getBallRates(p, dexState.ball, dexState.captureBoost, dexState.shinyLure);
        const shinyText = (p.tem_forma_shiny === 'sim' && stats.shinyKillsNum > 0)
          ? `1 : ${stats.shinyKillsNum.toLocaleString('pt-BR')}`
          : '—';

        return `
          <tr>
            <td style="color:#858b95; font-family:monospace;">${formattedDex}</td>
            <td><strong style="color:#fff;">${spriteHtml}${p.nome}</strong></td>
            <td>${typesBadge}</td>
            <td style="color:#aeb4bf;">${huntFormatted}</td>
            <td style="text-align:right; font-weight:700; color:#4ade80;">${stats.formattedPct}</td>
            <td style="text-align:right; color:#e2e8f0;">${stats.catchKillsNum > 0 ? `${stats.catchKillsNum.toLocaleString('pt-BR')} derrotas` : '—'}</td>
            <td style="text-align:right; color:#facc15;">${shinyText}</td>
            <td style="text-align:center;"><button class="secondary" style="padding:4px 10px; font-size:11px;" onclick="openDetailsModal('${p.dex}')">Detalhes</button></td>
          </tr>
        `;
      } else if (dexState.tab === 'hunting') {
        const f4 = (p.f4_types || []).map(t => `<span class="type ${t.toLowerCase()}">${t}</span>`).join(' ');
        const f2 = (p.f2_types || []).map(t => `<span class="type ${t.toLowerCase()}">${t}</span>`).join(' ');

        return `
          <tr>
            <td style="color:#858b95; font-family:monospace;">${formattedDex}</td>
            <td><strong style="color:#fff;">${spriteHtml}${p.nome}</strong></td>
            <td>${typesBadge}</td>
            <td style="color:#aeb4bf;">${huntFormatted}</td>
            <td>${f4 || '—'}</td>
            <td>${f2 || '—'}</td>
            <td style="text-align:right;">${p.hp || '—'}</td>
            <td style="text-align:right; font-weight:700; color:#38bdf8;">${formatNum(p.xp_base || p.xp_por_derrota)}</td>
            <td style="text-align:center;"><button class="secondary" style="padding:4px 10px; font-size:11px;" onclick="openDetailsModal('${p.dex}')">Detalhes</button></td>
          </tr>
        `;
      } else if (dexState.tab === 'gold_loot') {
        const dropsHtml = (p.drops_parsed || []).map(d => `<span style="display:inline-block; margin-right:8px; background:#222630; padding:2px 6px; border-radius:4px; font-size:11px;"><strong style="color:#fbbf24">${d.name}</strong> ${d.pct}%</span>`).join(' ') || '—';

        return `
          <tr>
            <td style="color:#858b95; font-family:monospace;">${formattedDex}</td>
            <td><strong style="color:#fff;">${spriteHtml}${p.nome}</strong></td>
            <td>${typesBadge}</td>
            <td style="color:#aeb4bf;">${huntFormatted}</td>
            <td style="text-align:right; font-weight:700; color:#f59e0b;">$${formatNum(p.gold_num || p.ouro_por_derrota)}</td>
            <td>${dropsHtml}</td>
            <td style="text-align:center;"><button class="secondary" style="padding:4px 10px; font-size:11px;" onclick="openDetailsModal('${p.dex}')">Detalhes</button></td>
          </tr>
        `;
      } else {
        return `
          <tr>
            <td style="color:#858b95; font-family:monospace;">${formattedDex}</td>
            <td><strong style="color:#fff;">${spriteHtml}${p.nome}</strong></td>
            <td>${typesBadge}</td>
            <td style="color:#aeb4bf;">${huntFormatted}</td>
            <td style="text-align:right; font-weight:700; color:#a855f7;">${p.bst_num || p.total_stats || '—'}</td>
            <td style="text-align:right;">${p.atk || '—'}</td>
            <td style="text-align:right;">${p.def || '—'}</td>
            <td style="text-align:right;">${p.spatk || '—'}</td>
            <td style="text-align:right;">${p.spdef || '—'}</td>
            <td style="text-align:right;">${p.spd || '—'}</td>
            <td style="text-align:center;"><button class="secondary" style="padding:4px 10px; font-size:11px;" onclick="openDetailsModal('${p.dex}')">Detalhes</button></td>
          </tr>
        `;
      }
    }).join('');
  }

  return `
    <div class="split-top">
      <div>
        <p class="eyebrow">Catálogo Base › Pokédex Inteligente</p>
        <h1>Pokédex Oficial (${filtered.length} espécies)</h1>
        <p style="color:#a5a9b2;font-size:12px">Consulte taxas de captura, probabilidade Shiny, fraquezas de hunt e drops de itens.</p>
      </div>
    </div>

    <!-- ABAS DA POKÉDEX -->
    <div class="tabbar" id="dex-tabs" style="margin:16px 0;">
      <button class="control ${dexState.tab === 'captura' ? 'on active' : ''}" data-mode="captura">Captura e Shiny</button>
      <button class="control ${dexState.tab === 'hunting' ? 'on active' : ''}" data-mode="hunting">Hunting</button>
      <button class="control ${dexState.tab === 'gold_loot' ? 'on active' : ''}" data-mode="gold_loot">Gold e Loot</button>
      <button class="control ${dexState.tab === 'fortes' ? 'on active' : ''}" data-mode="fortes">Pokémons Fortes</button>
    </div>

    <!-- CONTROLES DA TOOLBAR -->
    <div class="filter-groups">
      <div class="filter-group filter-basics">
        <input class="control" id="dex-search" placeholder="⌕ Busque por nome ou #ID..." value="${dexState.search}" style="min-width: 200px;">
        
        <select class="control" id="dex-tipo1">
          <option value="all">Tipo 1 (Todos)</option>
          ${typesList.map(t => `<option value="${t}" ${dexState.tipo1 === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>

        <select class="control" id="dex-tipo2">
          <option value="all">Tipo 2 (Qualquer)</option>
          <option value="none" ${dexState.tipo2 === 'none' ? 'selected' : ''}>Nenhum (Puro)</option>
          ${typesList.map(t => `<option value="${t}" ${dexState.tipo2 === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>

        <select class="control" id="dex-regiao">
          <option value="all">Todas as Regiões</option>
          ${regionsList.map(r => `<option value="${r}" ${dexState.regiao === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>

        <button class="control toggle ${dexState.apenasShiny ? 'selected' : ''}" id="dex-apenas-shiny">Apenas Shiny</button>
      </div>

      <div class="filter-group ball-group">
        <span class="group-label">Pokébola:</span>
        <button class="control ${dexState.ball === 'poke' ? 'selected' : ''}" data-ball="poke">Poké (×1)</button>
        <button class="control ${dexState.ball === 'great' ? 'selected' : ''}" data-ball="great">Great (×2)</button>
        <button class="control ${dexState.ball === 'super' ? 'selected' : ''}" data-ball="super">Super (×3)</button>
        <button class="control ${dexState.ball === 'ultra' ? 'selected' : ''}" data-ball="ultra">Ultra (×4)</button>
        <button class="control ${dexState.ball === 'beast' ? 'selected' : ''}" data-ball="beast">Beast (×8)</button>
      </div>

      <div class="filter-group boost-options">
        <span class="group-label">Boosts Ativos:</span>
        <button class="control check ${dexState.captureBoost ? 'selected' : ''}" id="dex-boost-capture">Capture Boost (+100%)</button>
        <button class="control check ${dexState.shinyLure ? 'selected' : ''}" id="dex-boost-lure">Shiny Lure</button>
      </div>
    </div>

    <!-- TABELA DE DADOS -->
    <section class="section-card data-panel" style="padding:0; overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
        <thead style="background:#15181e; border-bottom:1px solid #282c34; color:#9ca3af; font-size:11px; text-transform:uppercase;">
          ${tableHeaderHtml}
        </thead>
        <tbody style="divide-y divide-gray-800">
          ${tableRowsHtml}
        </tbody>
      </table>
    </section>
  `;
}

function tier() {
  return `
    <div class="split-top">
      <div>
        <p class="eyebrow">Análise › Tier List</p>
        <h1>Tier List de Pokémons</h1>
        <p style="color:#a5a9b2;font-size:12px">Classificação por efetividade em Hunts, Bosses e Farm.</p>
      </div>
    </div>
    <div class="tier-layout" style="margin-top:16px;">
      <div>
        <div class="tier-row"><div class="tier-label ideal"><b>S+</b><small>EXCEPCIONAL</small></div><div class="tier-drop"><div class="slot"></div><div class="slot"></div><div class="slot"></div></div></div>
        <div class="tier-row"><div class="tier-label farm"><b>S</b><small>MUITO FORTE</small></div><div class="tier-drop"><div class="slot"></div><div class="slot"></div></div></div>
        <div class="tier-row"><div class="tier-label current"><b>A</b><small>SOLIDO</small></div><div class="tier-drop"><div class="slot"></div></div></div>
      </div>
      <aside class="section-card toolbox">
        <h3>Filtrar por Categoria</h3>
        <button class="secondary" style="width:100%; margin-bottom:8px;">Hunts Endgame</button>
        <button class="secondary" style="width:100%;">Bosses & Tokens</button>
      </aside>
    </div>
  `;
}

function xp() {
  return `
    <div class="split-top">
      <div>
        <p class="eyebrow">Ferramentas › Calculadora de XP</p>
        <h1>Calculadora de XP & Tempo de Treinador</h1>
        <p style="color:#a5a9b2;font-size:12px">Simule tempo estimado de hunt, abates e evolução nível a nível.</p>
      </div>
    </div>

    <div class="xp-layout" style="margin-top:16px;">
      <section class="section-card form-card">
        <h3>Parâmetros de Cálculo</h3>
        
        <div class="form-grid">
          <div class="field">
            <label>Nível Inicial</label>
            <input type="number" id="xp-in-from" value="20" min="1" max="1000">
          </div>
          <div class="field">
            <label>Nível Alvo</label>
            <input type="number" id="xp-in-to" value="40" min="1" max="1000">
          </div>
        </div>

        <div class="field" style="margin-top:12px;">
          <label>Hunt / Local de Caça</label>
          <select id="xp-in-hunt">
            <option value="custom">Calculado por XP/s Personalizado</option>
            ${huntsData.slice(0, 50).map(h => `<option value="${h.xp_sec || 50}">${h.nome} (${h.regiao}, XP/s: ~${h.xp_sec || 50})</option>`).join('')}
          </select>
        </div>

        <div class="field" style="margin-top:12px;">
          <label>Velocidade de XP Base (XP/s)</label>
          <input type="number" id="xp-in-speed" value="50" min="1">
        </div>

        <h3 style="margin-top:18px;">Bônus e Multiplicadores</h3>
        
        <div class="toggle-line">
          <span>Assinatura VIP (+20% XP)</span>
          <input type="checkbox" id="xp-ck-vip" checked style="width:18px;height:18px;">
        </div>

        <div class="toggle-line">
          <span>XP Boost (+50% XP)</span>
          <input type="checkbox" id="xp-ck-boost" checked style="width:18px;height:18px;">
        </div>

        <div class="form-grid" style="margin-top:10px;">
          <div class="field">
            <label>Bônus Guilda (0-10%)</label>
            <input type="number" id="xp-in-guild" value="0" min="0" max="10">
          </div>
          <div class="field">
            <label>Bônus Evento (0-100%)</label>
            <input type="number" id="xp-in-event" value="0" min="0" max="100">
          </div>
        </div>

        <button class="primary" id="xp-btn-calc" style="width:100%; margin-top:16px;">Recalcular Tempo</button>
      </section>

      <section class="section-card" style="padding:20px;">
        <h2>Resultado da Simulação</h2>
        <div class="metrics" style="margin-top:14px;">
          <div class="metric yellow">
            <small>XP NECESSÁRIO</small>
            <b id="xp-out-total">—</b>
          </div>
          <div class="metric">
            <small>TEMPO ESTIMADO</small>
            <b id="xp-out-tempo" style="color:#38bdf8;">—</b>
          </div>
        </div>
        
        <div class="metrics" style="margin-top:12px;">
          <div class="metric">
            <small>MÉDIA DE DERROTAS/KILLS</small>
            <b id="xp-out-abates">—</b>
          </div>
          <div class="metric">
            <small>TAXA EFETIVA DE XP/S</small>
            <b id="xp-out-efetivo">—</b>
          </div>
        </div>

        <h3 style="margin-top:20px; border-bottom:1px solid #292e37; padding-bottom:8px;">Progressão Level a Level</h3>
        <div id="xp-out-rows" style="margin-top:10px; max-height:260px; overflow-y:auto; font-size:12px; color:#a0a6b1;"></div>
      </section>
    </div>
  `;
}

function guides() {
  const names = ['Começando no PokéIdle','Guia de XP e Evolução','Bosses e Tokens: rota completa','Outland — guia de região completo','Estratégias de PvP e GvG','Mecânicas de shinies explicadas'];
  return `
    <div class="split-top">
      <div><p class="eyebrow">Aprender › Guias</p><h1>Guias da comunidade</h1></div>
    </div>
    <div class="guide-grid" style="margin-top:16px;">
      ${names.map((n, i) => `
        <article class="guide-card">
          <span class="badge ${i % 2 === 1 ? 'update' : ''}">Guia</span>
          <h3>${n}</h3>
          <small><span>${5 + i} min leitura</span></small>
        </article>
      `).join('')}
    </div>
  `;
}

function wiki() {
  return `
    <div class="wiki-layout">
      <aside class="wiki-rail">
        <strong>BUSCAR</strong>
        <input placeholder="⌕ Buscar na wiki...">
        <strong>MECÂNICAS DO IDLE</strong>
        <button class="active">Como funciona o Idle</button>
        <button>Sistema de XP</button>
      </aside>
      <article class="article">
        <h1>Como funciona o Idle <span class="badge update">Mecânicas</span></h1>
        <p>O PokéIdle gera progresso continuamente. Seus Pokémon em campo acumulam XP, moedas e drops com base no tempo offline.</p>
      </article>
    </div>
  `;
}

function admin() {
  return `
    <h1>Painel Administrativo</h1>
    <p style="color:#a6abb4; font-size:12px; margin-top:4px;">Gerencie novidades e atualizações da comunidade.</p>
  `;
}

// ==========================================
// CALCULADORA DE XP MATH (FÓRMULAS OFICIAIS)
// ==========================================

function xpTotalFormula(level) {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  if (L <= 1) return 0;
  return Math.round((50 / 3) * (Math.pow(L, 3) - 6 * Math.pow(L, 2) + 17 * L - 12));
}

function calculateXpSimulation() {
  const fromLvl = Math.max(1, parseInt(document.getElementById('xp-in-from')?.value, 10) || 1);
  const toLvl = Math.max(fromLvl + 1, parseInt(document.getElementById('xp-in-to')?.value, 10) || (fromLvl + 1));
  
  const huntSpeed = parseFloat(document.getElementById('xp-in-speed')?.value) || 50;
  const isVip = document.getElementById('xp-ck-vip')?.checked ?? true;
  const isBoost = document.getElementById('xp-ck-boost')?.checked ?? true;
  const guildBonus = parseFloat(document.getElementById('xp-in-guild')?.value) || 0;
  const eventBonus = parseFloat(document.getElementById('xp-in-event')?.value) || 0;

  let mult = 1.0;
  if (isVip) mult += 0.20;
  if (isBoost) mult += 0.50;
  mult += (guildBonus / 100);
  mult += (eventBonus / 100);

  const xpNeeded = Math.max(0, xpTotalFormula(toLvl) - xpTotalFormula(fromLvl));
  const effectiveXpSec = huntSpeed * mult;
  const totalSeconds = effectiveXpSec > 0 ? Math.ceil(xpNeeded / effectiveXpSec) : 0;

  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const timeStr = `${hours}h ${mins}m ${secs}s`;

  const killsNeeded = Math.ceil(xpNeeded / (150 * mult));

  if (document.getElementById('xp-out-total')) document.getElementById('xp-out-total').textContent = xpNeeded.toLocaleString('pt-BR') + ' XP';
  if (document.getElementById('xp-out-tempo')) document.getElementById('xp-out-tempo').textContent = timeStr;
  if (document.getElementById('xp-out-abates')) document.getElementById('xp-out-abates').textContent = '~' + killsNeeded.toLocaleString('pt-BR');
  if (document.getElementById('xp-out-efetivo')) document.getElementById('xp-out-efetivo').textContent = Math.round(effectiveXpSec).toLocaleString('pt-BR') + ' XP/s';

  // Roadmap level a level
  let rowsHtml = '<table style="width:100%; border-collapse:collapse;">';
  const step = Math.max(1, Math.floor((toLvl - fromLvl) / 10));
  for (let lvl = fromLvl; lvl < toLvl; lvl += step) {
    const nextLvl = Math.min(toLvl, lvl + step);
    const req = xpTotalFormula(nextLvl) - xpTotalFormula(lvl);
    const sec = Math.ceil(req / effectiveXpSec);
    rowsHtml += `
      <tr style="border-bottom:1px solid #222630;">
        <td style="padding:4px 0;">Nv <b>${lvl}</b> → <b>${nextLvl}</b></td>
        <td style="text-align:right;">${req.toLocaleString('pt-BR')} XP</td>
        <td style="text-align:right; color:#38bdf8;">~${Math.ceil(sec / 60)} min</td>
      </tr>
    `;
  }
  rowsHtml += '</table>';
  if (document.getElementById('xp-out-rows')) document.getElementById('xp-out-rows').innerHTML = rowsHtml;
}

function attachXpListeners() {
  ['xp-in-from','xp-in-to','xp-in-speed','xp-in-guild','xp-in-event'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calculateXpSimulation);
  });
  ['xp-ck-vip','xp-ck-boost'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', calculateXpSimulation);
  });
  document.getElementById('xp-in-hunt')?.addEventListener('change', (e) => {
    if (e.target.value !== 'custom') {
      const val = parseFloat(e.target.value) || 50;
      const speedIn = document.getElementById('xp-in-speed');
      if (speedIn) speedIn.value = val;
    }
    calculateXpSimulation();
  });
  document.getElementById('xp-btn-calc')?.addEventListener('click', calculateXpSimulation);
  calculateXpSimulation();
}

// ==========================================
// MODAL DE DETALHES DO POKÉMON
// ==========================================

window.openDetailsModal = function(dexId) {
  const p = pokemonData.find(item => String(item.dex) === String(dexId));
  if (!p) return;

  let modal = document.getElementById('pokedex-details-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pokedex-details-modal';
    modal.style.cssText = 'position:fixed; inset:0; z-index:999; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.75); padding:16px;';
    document.body.appendChild(modal);
  }

  const spriteFileName = `${parseInt(p.dex, 10)}-${(p.nome || '').toLowerCase().replace(/[^a-z0-9]/g, '_')}.png`;
  const spriteSrc = `assets/sprites-pokemon/normal/${spriteFileName}`;

  const pokeBallStats = getBallRates(p, 'poke', false, false);
  const greatBallStats = getBallRates(p, 'great', false, false);
  const superBallStats = getBallRates(p, 'super', false, false);
  const ultraBallStats = getBallRates(p, 'ultra', false, false);
  const beastBallStats = getBallRates(p, 'beast', false, false);

  modal.innerHTML = `
    <div style="background:#171a22; border:1px solid #303641; border-radius:12px; width:100%; max-width:620px; max-height:90vh; overflow-y:auto; padding:20px; color:#fff; position:relative;">
      <button onclick="document.getElementById('pokedex-details-modal').style.display='none'" style="position:absolute; top:16px; right:16px; border:0; background:transparent; color:#858b95; font-size:20px; cursor:pointer;">✕</button>
      
      <div style="display:flex; align-items:center; gap:16px;">
        <img src="${spriteSrc}" style="width:64px; height:64px;" onerror="this.style.display='none'">
        <div>
          <span style="font-family:monospace; color:#858b95;">#${String(p.dex).padStart(3, '0')}</span>
          <h2 style="font-size:22px; margin:2px 0;">${p.nome}</h2>
          <div>${renderTypes(p.tipo1, p.tipo2)}</div>
        </div>
      </div>

      <div style="margin-top:16px; padding:12px; background:#12141a; border-radius:8px; font-size:13px;">
        <strong>Local de Hunt:</strong> <span style="color:#38bdf8;">${cleanHunt(p)}</span>
      </div>

      <h3 style="margin-top:18px; font-size:14px; border-bottom:1px solid #292e37; padding-bottom:6px;">Taxas de Captura por Pokébola</h3>
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:8px;">
        <tr style="color:#858b95; border-bottom:1px solid #222630;">
          <th style="text-align:left; padding:4px;">Bola</th>
          <th style="text-align:right; padding:4px;">Catch Rate</th>
          <th style="text-align:right; padding:4px;">Média Derrotas</th>
          <th style="text-align:right; padding:4px;">Odds Shiny</th>
        </tr>
        <tr><td>Poké Ball (x1)</td><td style="text-align:right;">${pokeBallStats.formattedPct}</td><td style="text-align:right;">${pokeBallStats.catchKillsNum}</td><td style="text-align:right;">${pokeBallStats.shinyKillsNum ? '1 : ' + pokeBallStats.shinyKillsNum.toLocaleString('pt-BR') : '—'}</td></tr>
        <tr><td>Great Ball (x2)</td><td style="text-align:right;">${greatBallStats.formattedPct}</td><td style="text-align:right;">${greatBallStats.catchKillsNum}</td><td style="text-align:right;">${greatBallStats.shinyKillsNum ? '1 : ' + greatBallStats.shinyKillsNum.toLocaleString('pt-BR') : '—'}</td></tr>
        <tr><td>Super Ball (x3)</td><td style="text-align:right;">${superBallStats.formattedPct}</td><td style="text-align:right;">${superBallStats.catchKillsNum}</td><td style="text-align:right;">${superBallStats.shinyKillsNum ? '1 : ' + superBallStats.shinyKillsNum.toLocaleString('pt-BR') : '—'}</td></tr>
        <tr><td>Ultra Ball (x4)</td><td style="text-align:right;">${ultraBallStats.formattedPct}</td><td style="text-align:right;">${ultraBallStats.catchKillsNum}</td><td style="text-align:right;">${ultraBallStats.shinyKillsNum ? '1 : ' + ultraBallStats.shinyKillsNum.toLocaleString('pt-BR') : '—'}</td></tr>
        <tr><td>Beast Ball (x8)</td><td style="text-align:right;">${beastBallStats.formattedPct}</td><td style="text-align:right;">${beastBallStats.catchKillsNum}</td><td style="text-align:right;">${beastBallStats.shinyKillsNum ? '1 : ' + beastBallStats.shinyKillsNum.toLocaleString('pt-BR') : '—'}</td></tr>
      </table>

      <h3 style="margin-top:18px; font-size:14px; border-bottom:1px solid #292e37; padding-bottom:6px;">Status Base (BST: ${p.bst_num || p.total_stats || '—'})</h3>
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-top:8px; font-size:12px;">
        <div style="background:#20242c; padding:8px; border-radius:6px;">HP: <b>${p.hp || '—'}</b></div>
        <div style="background:#20242c; padding:8px; border-radius:6px;">ATK: <b>${p.atk || '—'}</b></div>
        <div style="background:#20242c; padding:8px; border-radius:6px;">DEF: <b>${p.def || '—'}</b></div>
        <div style="background:#20242c; padding:8px; border-radius:6px;">SP.ATK: <b>${p.spatk || '—'}</b></div>
        <div style="background:#20242c; padding:8px; border-radius:6px;">SP.DEF: <b>${p.spdef || '—'}</b></div>
        <div style="background:#20242c; padding:8px; border-radius:6px;">SPEED: <b>${p.spd || '—'}</b></div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
};

// ==========================================
// ROTEAMENTO & LISTENERS
// ==========================================

function attachDexListeners() {
  document.querySelectorAll('#dex-tabs button[data-mode]').forEach(b => {
    b.addEventListener('click', () => {
      location.hash = `pokedex/${b.dataset.mode}`;
    });
  });

  const updatePokedexView = () => {
    const mainPage = document.querySelector('#app');
    if (mainPage && location.hash.startsWith('#pokedex')) {
      const mode = location.hash.split('/')[1] || 'captura';
      mainPage.innerHTML = pokedex(mode);
      attachDexListeners();
    }
  };

  document.getElementById('dex-search')?.addEventListener('input', e => {
    dexState.search = e.target.value;
    updatePokedexView();
  });

  document.getElementById('dex-tipo1')?.addEventListener('change', e => {
    dexState.tipo1 = e.target.value;
    updatePokedexView();
  });

  document.getElementById('dex-tipo2')?.addEventListener('change', e => {
    dexState.tipo2 = e.target.value;
    updatePokedexView();
  });

  document.getElementById('dex-regiao')?.addEventListener('change', e => {
    dexState.regiao = e.target.value;
    updatePokedexView();
  });

  document.getElementById('dex-apenas-shiny')?.addEventListener('click', e => {
    dexState.apenasShiny = !dexState.apenasShiny;
    updatePokedexView();
  });

  document.querySelectorAll('.ball-group button[data-ball]').forEach(btn => {
    btn.addEventListener('click', () => {
      dexState.ball = btn.dataset.ball;
      updatePokedexView();
    });
  });

  document.getElementById('dex-boost-capture')?.addEventListener('click', () => {
    dexState.captureBoost = !dexState.captureBoost;
    updatePokedexView();
  });

  document.getElementById('dex-boost-lure')?.addEventListener('click', () => {
    dexState.shinyLure = !dexState.shinyLure;
    updatePokedexView();
  });
}

const views = { home, pokedex, tier, xp, guides, wiki, admin };

async function render() {
  if (pokemonData.length === 0) {
    await loadData();
  }

  const route = (location.hash.slice(1) || 'home').split('/');
  const viewName = views[route[0]] ? route[0] : 'home';
  const subMode = route[1] || 'captura';

  if (viewName === 'pokedex') {
    app.innerHTML = pokedex(subMode);
    attachDexListeners();
  } else if (viewName === 'xp') {
    app.innerHTML = xp();
    attachXpListeners();
  } else {
    app.innerHTML = views[viewName]();
  }

  document.querySelectorAll('[data-route]').forEach(a => {
    a.classList.toggle('active', a.dataset.route === viewName);
  });

  document.querySelectorAll('[data-go]').forEach(b => {
    b.onclick = () => {
      location.hash = b.dataset.go;
    };
  });

  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
document.addEventListener('DOMContentLoaded', render);
render();
