/**
 * POKÉIDLE HUB — GUIA DO INICIANTE & PROGRESSÃO DE HUNTS (ATLAS GUIAS)
 */

let allHunts = [];

export async function initGuide() {
  setupGuideCategoryFilter();

  try {
    const res = await fetch('data/hunts_portal.json');
    allHunts = await res.json();
    setupHuntsGuideTable();
  } catch (err) {
    console.warn('Erro ao carregar dados de hunts para o guia:', err);
  }
}

function setupGuideCategoryFilter() {
  const chips = document.querySelectorAll('#view-guide .filter-chip');
  const cards = document.querySelectorAll('#view-guide .guide-card');
  const countBadge = document.getElementById('guide-count-badge');

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('on', 'active'));
      chip.classList.add('on', 'active');

      const cat = chip.dataset.category;
      let visibleCount = 0;

      cards.forEach(card => {
        if (!cat || cat === 'all' || card.dataset.category === cat) {
          card.style.display = 'flex';
          visibleCount++;
        } else {
          card.style.display = 'none';
        }
      });

      if (countBadge) {
        countBadge.textContent = `${visibleCount} guias exibidos`;
      }
    });
  });

  const guiasData = {
    start: {
      titulo: 'Começando no Pokéidle — Guia do Starter',
      categoria: 'INICIANTE',
      cor: '#2f9d63',
      tempo: '5 min de leitura',
      conteudo: `
        <p>O Starter possui características de segurança exclusivas no servidor para evitar desmaios precoces:</p>
        <div style="background:var(--bg-surface-subtle); padding:12px; border-radius:8px; margin:10px 0; border:1px solid var(--line);">
          <strong>Pisos de Segurança do Starter:</strong>
          <ul style="margin:6px 0 0; padding-left:20px;">
            <li>Qualidade mínima de <strong>1.30</strong> (Rara).</li>
            <li>Soma de IVs superior a <strong>140</strong> (de 192 possíveis).</li>
            <li>Cada IV isolado com piso mínimo de <strong>16</strong>.</li>
          </ul>
        </div>
        <p><strong>Loop de Captura:</strong> Quando um monstro cai na hunt, o corpo fica disponível por exatamente 30 segundos. Arremesse sua melhor pokébola — você tem apenas 1 chance por corpo abatido.</p>
      `
    },
    xp: {
      titulo: 'Guia de XP e Evolução',
      categoria: 'INICIANTE',
      cor: '#2f9d63',
      tempo: '7 min de leitura',
      conteudo: `
        <p>Entenda a regra fundamental de níveis do servidor:</p>
        <p><strong>A Trava de Folga de 5 Níveis:</strong> O pokémon só luta se estiver no máximo 5 níveis acima do nível atual do seu Treinador. Evite upar o monstro isoladamente com boosts sem upar o treinador, caso contrário ele ficará bloqueado para hunts!</p>
        <p><strong>Desmaio:</strong> Se todos os 5 pokémon desmaiarem em uma hunt, você perde 10% do XP do nível atual de treinador. Mantenha poções e revives estocados na bolsa.</p>
      `
    },
    bosses: {
      titulo: 'Bosses e Tokens de Raid',
      categoria: 'AVANÇADO',
      cor: '#c98a2f',
      tempo: '10 min de leitura',
      conteudo: `
        <p>Os chefes de raid surgem em horários marcados nas zonas de perigo e requerem times com alta resistência elemental.</p>
        <p><strong>Tokens de Recompensa:</strong> Derrotar bosses garante Bronze Boss Tokens e Silver Boss Tokens para troca de pedras de evolução raras e itens cosméticos exclusivos.</p>
      `
    },
    outland: {
      titulo: 'Outland — Guia Completo',
      categoria: 'INTERMEDIÁRIO',
      cor: '#c23f8a',
      tempo: '9 min de leitura',
      conteudo: `
        <p>Outland é a dimensão endgame do PokéIdle. Nela, o dano elemental e a taxa de drop de itens raros são multiplicados.</p>
        <p>Para entrar em Outland com segurança, certifique-se de que sua equipe possua pokémons com qualidade mínima 1.50 e nota (N=) acima de 3.5.</p>
      `
    },
    pvp: {
      titulo: 'Estratégias de PvP e GvG',
      categoria: 'AVANÇADO',
      cor: '#6d3fc4',
      tempo: '12 min de leitura',
      conteudo: `
        <p>No combate entre jogadores, o stat de <strong>IV de Velocidade</strong> é o diferencial determinante, reduzindo o cooldown dos ataques em até -320 milissegundos.</p>
        <p>Forme formações balanceadas com cobertura defensiva para cobrir fraquezas quádruplas (×5.5 de dano sofrido).</p>
      `
    },
    shinies: {
      titulo: 'Mecânicas de Shinies',
      categoria: 'INTERMEDIÁRIO',
      cor: '#1f7dc4',
      tempo: '6 min de leitura',
      conteudo: `
        <p>Monstros shiny possuem 3× todos os atributos básicos e nascem com soma de IVs garantida acima de 110.</p>
        <p>Evoluem exclusivamente através de <strong>Shiny Stones</strong> correspondentes ao seu tipo principal.</p>
      `
    },
    event: {
      titulo: 'Evento Sazonal: Festival',
      categoria: 'EVENTO',
      cor: '#c98a2f',
      tempo: '4 min de leitura',
      conteudo: `
        <p>Durante o Festival, a taxa de captura de todas as rotas de Kanto até Paldea recebe um bônus de 20%, e o drop de moedas de ouro é duplicado em abates consecutivos.</p>
      `
    },
    gym: {
      titulo: 'Ginásio: Primeiros Passos',
      categoria: 'INICIANTE',
      cor: '#2f9d63',
      tempo: '6 min de leitura',
      conteudo: `
        <p>Vencer os 8 líderes de ginásio de cada região desbloqueia o passe de viagem para a próxima região e concede insígnias que aumentam a taxa máxima de captura permanentemente.</p>
      `
    }
  };

  window.abrirGuiaModal = (key) => {
    const guia = guiasData[key];
    if (!guia) return;

    const modal = document.getElementById('species-modal');
    const modalTitle = document.getElementById('modal-species-title');
    const modalContent = document.getElementById('modal-species-content');

    if (modalTitle) modalTitle.textContent = guia.titulo;
    if (modalContent) {
      modalContent.innerHTML = `
        <div style="padding: 10px 4px;">
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px;">
            <span class="guide-pill" style="background: ${guia.cor}; color: #fff;">${guia.categoria}</span>
            <span style="font-size:12px; color:var(--muted);">${guia.tempo}</span>
          </div>
          <div style="font-size: 13.5px; color: var(--ink); line-height: 1.6;">
            ${guia.conteudo}
          </div>
        </div>
      `;
    }
    if (modal) modal.style.display = 'flex';
  };
}

function setupHuntsGuideTable() {
  const tableBody = document.getElementById('guide-hunts-table-body');
  const regionSelect = document.getElementById('guide-region-filter');
  const maxLvlInput = document.getElementById('guide-max-lvl');

  if (!tableBody) return;

  function renderHunts() {
    const selectedRegion = regionSelect?.value || 'all';
    const maxLvl = parseInt(maxLvlInput?.value, 10) || 999999;

    const filtered = allHunts.filter(h => {
      const reg = (h.region ?? h.area ?? '').toLowerCase();
      const lvl = h.nivel ?? h.level ?? 1;
      if (selectedRegion !== 'all' && reg !== selectedRegion.toLowerCase()) return false;
      if (lvl > maxLvl) return false;
      return true;
    });

    const display = filtered.slice(0, 50);

    let html = display.map(h => {
      const lvl = h.nivel ?? h.level ?? 1;
      const nm = h.nome ?? h.name ?? 'Hunt';
      const reg = h.region ?? h.area ?? 'Kanto';
      return `
        <tr>
          <td style="font-weight: 700; color: var(--accent-2);">Nv ${lvl}</td>
          <td style="font-weight: 600; color: var(--ink);">${nm}</td>
          <td><span class="guide-pill" style="margin:0; font-size: 9.5px; padding: 2px 8px; background: var(--accent-soft); color: var(--accent-ink);">${reg}</span></td>
          <td style="color: var(--muted); font-size: 0.85rem;">Treinador Nv ${lvl}+</td>
        </tr>
      `;
    }).join('');

    if (filtered.length > 50) {
      html += `
        <tr>
          <td colspan="4" style="text-align:center; padding: 1rem; color: var(--accent-ink); font-weight: 700;">
            Mostrando 50 de ${filtered.length} hunts filtradas.
            <button class="btn on" style="margin-left: 10px; font-size: 11px; padding: 4px 10px;" onclick="window.abrirCatalogoHunts?.()">
              Ver Catálogo Completo com 824 Hunts →
            </button>
          </td>
        </tr>
      `;
    }

    tableBody.innerHTML = html || `<tr><td colspan="4" style="text-align:center; color: var(--muted); padding: 1.5rem;">Nenhuma hunt encontrada com esses filtros.</td></tr>`;
  }

  regionSelect?.addEventListener('change', renderHunts);
  maxLvlInput?.addEventListener('input', renderHunts);

  renderHunts();
}
