/**
 * POKÉIDLE HUB — APLICAÇÃO PRINCIPAL & ROTEAMENTO COMPLETO
 */

import { initPokedex, huntState, applyPokedexFilters, openSpeciesModal } from './pokedex.js?v=20260923_2';
import { initCalculators } from './calculators.js';
import { initGuide } from './guide.js';
import { initWiki } from './wiki.js';
import { initHuntsCatalog } from './hunts.js';

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupHomeInteractions();
  setupModalEvents();

  // Initialize modules
  await initPokedex();
  await initHuntsCatalog();
  await initCalculators();
  await initGuide();
  initWiki();

  console.log('PokéIdle Hub Portal inicializado com sucesso!');
});

export function closeModal() {
  const modal = document.getElementById('species-modal');
  if (modal) {
    modal.classList.remove('open', 'active');
    modal.style.display = 'none';
  }
}
window.closeModal = closeModal;
window.closeSpeciesModal = closeModal;

export function switchView(targetViewId) {
  // Redirecionar tentativas de acesso às seções ocultas da Beta para o Início
  if (targetViewId === 'view-wiki' || targetViewId === 'view-guide') {
    targetViewId = 'view-home';
  }
  const navButtons = document.querySelectorAll('.nav-tab-btn');
  const views = document.querySelectorAll('.portal-view');

  navButtons.forEach(b => {
    const isTarget = b.dataset.view === targetViewId;
    b.classList.toggle('active', isTarget);
    b.classList.toggle('on', isTarget);
  });

  views.forEach(v => {
    v.classList.toggle('active-view', v.id === targetViewId);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setupModalEvents() {
  const modal = document.getElementById('species-modal');
  const closeBtn = document.getElementById('modal-close-btn');

  if (closeBtn) {
    closeBtn.onclick = (e) => {
      if (e) e.preventDefault();
      closeModal();
    };
  }

  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-tab-btn');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      const subtab = btn.dataset.subtab;
      switchView(targetView);
      if (targetView === 'view-pokedex') {
        if (subtab === 'hunts') {
          document.getElementById('dex-subtab-hunts')?.click();
        } else {
          document.getElementById('dex-subtab-species')?.click();
        }
      }
    });
  });

  // Global search redirect to pokedex if typing outside
  const globalSearch = document.getElementById('global-portal-search') || document.getElementById('global-quick-search');
  if (globalSearch) {
    globalSearch.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (val) {
        const pokeTabBtn = document.querySelector('.nav-tab-btn[data-view="view-pokedex"]');
        if (pokeTabBtn && !pokeTabBtn.classList.contains('active')) {
          switchView('view-pokedex');
        }
        const pokeSearch = document.getElementById('clean-search-input') || document.getElementById('pokedex-search');
        if (pokeSearch) {
          pokeSearch.value = val;
          huntState.search = val.toLowerCase();
          huntState.currentPage = 1;
          applyPokedexFilters();
        }
      }
    });
  }

  window.switchView = switchView;

  // Dark / Light Theme Toggle & Persistence
  const themeToggle = document.getElementById('theme-toggle');
  const themeCheck = document.getElementById('theme-toggle-check');

  function applyTheme(isLight) {
    if (isLight) {
      document.body.classList.add('modo-claro');
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.body.classList.remove('modo-claro');
      document.documentElement.setAttribute('data-theme', 'dark');
    }
    if (themeToggle) {
      themeToggle.textContent = isLight ? 'Escuro' : 'Claro';
    }
    if (themeCheck) {
      themeCheck.checked = !isLight;
    }
    try {
      localStorage.setItem('pokeidle_portal_theme', isLight ? 'light' : 'dark');
    } catch (e) {}
  }

  // Load saved theme
  try {
    const savedTheme = localStorage.getItem('pokeidle_portal_theme');
    if (savedTheme === 'light') {
      applyTheme(true);
    } else {
      applyTheme(false);
    }
  } catch (e) {}

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentlyLight = document.documentElement.getAttribute('data-theme') === 'light' || document.body.classList.contains('modo-claro');
      applyTheme(!currentlyLight);
    });
  }

  if (themeCheck) {
    themeCheck.addEventListener('change', () => {
      applyTheme(!themeCheck.checked);
    });
  }

  setupAdminPanel();

  // Handle URL hash on load
  const hash = window.location.hash.replace('#', '');
  if (hash === 'pokedex') {
    switchView('view-pokedex');
  } else if (hash === 'calculators' || hash === 'calc') {
    switchView('view-calculators');
  } else if (hash === 'wiki') {
    switchView('view-wiki');
  } else if (hash === 'guide') {
    switchView('view-guide');
  } else if (hash === 'roadmap') {
    switchView('view-roadmap');
  } else if (hash === 'admin') {
    switchView('view-admin');
  }
}

function setupAdminPanel() {
  const articlesList = document.getElementById('admin-articles-list');
  const searchInput = document.getElementById('admin-search-input');
  const newBtn = document.getElementById('admin-btn-new');
  const titleInput = document.getElementById('admin-input-title');
  const catSelect = document.getElementById('admin-select-cat');
  const tagsInput = document.getElementById('admin-input-tags');
  const statusSelect = document.getElementById('admin-select-status');
  const textareaContent = document.getElementById('admin-textarea-content');
  const editorTitle = document.getElementById('admin-editor-title');
  const saveDraftBtn = document.getElementById('admin-save-draft-btn');
  const publishBtn = document.getElementById('admin-publish-btn');
  const feedbackMsg = document.getElementById('admin-feedback-msg');

  const articlesData = {
    idle: {
      title: 'Como funciona o Idle',
      cat: 'mecanicas',
      tags: 'idle, offline, progresso, fórmulas',
      status: 'pub',
      content: 'O PokéIdle é um MMO idle em que o monstrinho combate automaticamente na hunt.\n- Nível do Treinador controla o desbloqueio de novas hunts e regiões.\n- Nível do Pokémon controla o poder e estatísticas individuais.\n- Ao alcançar os requisitos de nível, o sistema migra ou destranca rotas de farm com taxas superiores de XP e drop de moedas.'
    },
    xp: {
      title: 'Guia de XP e Evolução',
      cat: 'sistemas',
      tags: 'xp, evolução, pedras, refino',
      status: 'pub',
      content: 'A evolução de pokémon no servidor requer nível adequado e pedras elementais obtidas em abates ou através da Oferenda de Pokémon.\n- Refino concede multiplicadores extras de stats e poder.\n- A progressão de nível é calculada pela fórmula oficial documentada na calculadora de XP.'
    },
    festival: {
      title: 'Evento Sazonal: Festival',
      cat: 'evento',
      tags: 'evento, festival, tokens, bônus',
      status: 'draft',
      content: 'Rascunho de planejamento do próximo evento sazonal de caça e bônus de abates com dobradinha de shiny odds.'
    },
    shinies: {
      title: 'Shinies e Formas Especiais',
      cat: 'pokedex',
      tags: 'shiny, formas, raridade, iv',
      status: 'pub',
      content: 'Mecânica detalhada dos 612 monstros shiny, garantindo multiplicador de 3x em todos os stats e IVs superiores a 110.'
    },
    tms: {
      title: "TM's e Habilidades",
      cat: 'itens',
      tags: 'tms, golpes, combate, skills',
      status: 'draft',
      content: 'Guia de discos de movimentos e golpes especiais para montagem de cobertura elemental de times em hunts de endgame.'
    },
    bosses: {
      title: 'Bosses e Tokens',
      cat: 'evento',
      tags: 'bosses, raids, tokens, outland',
      status: 'pub',
      content: 'Horários de respawn, mecânicas de ataque em área de Bosses lendários de Outland e recompensas em tokens bronze e prata.'
    }
  };

  articlesList?.querySelectorAll('.admin-art-row').forEach(row => {
    row.addEventListener('click', () => {
      articlesList.querySelectorAll('.admin-art-row').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      const id = row.dataset.id;
      const data = articlesData[id];
      if (data) {
        if (titleInput) titleInput.value = data.title;
        if (editorTitle) editorTitle.textContent = `Editando: ${data.title}`;
        if (catSelect) catSelect.value = data.cat;
        if (tagsInput) tagsInput.value = data.tags;
        if (statusSelect) statusSelect.value = data.status;
        if (textareaContent) textareaContent.value = data.content;
      }
    });
  });

  searchInput?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    articlesList?.querySelectorAll('.admin-art-row').forEach(row => {
      const txt = row.innerText.toLowerCase();
      row.style.display = txt.includes(term) ? 'flex' : 'none';
    });
  });

  newBtn?.addEventListener('click', () => {
    articlesList?.querySelectorAll('.admin-art-row').forEach(r => r.classList.remove('active'));
    if (titleInput) { titleInput.value = 'Novo Artigo'; titleInput.focus(); }
    if (editorTitle) editorTitle.textContent = 'Criando Novo Artigo';
    if (tagsInput) tagsInput.value = '';
    if (statusSelect) statusSelect.value = 'draft';
    if (textareaContent) textareaContent.value = '';
  });

  const showFeedback = (msg) => {
    if (feedbackMsg) {
      feedbackMsg.textContent = msg;
      feedbackMsg.style.display = 'block';
      setTimeout(() => { feedbackMsg.style.display = 'none'; }, 3000);
    }
  };

  saveDraftBtn?.addEventListener('click', () => {
    showFeedback('✓ Rascunho salvo com sucesso no banco de dados local!');
  });

  publishBtn?.addEventListener('click', () => {
    showFeedback('✓ Artigo publicado e disponibilizado no portal oficial!');
    const activeRow = articlesList?.querySelector('.admin-art-row.active');
    if (activeRow) {
      const pill = activeRow.querySelector('.guide-pill');
      if (pill) {
        pill.textContent = 'PUBLICADO';
        pill.style.background = 'var(--ok-bg)';
        pill.style.color = 'var(--ok-ink)';
      }
    }
  });

  // Admin toolbar helper
  window.inserirTagAdmin = (before, after) => {
    if (!textareaContent) return;
    const start = textareaContent.selectionStart;
    const end = textareaContent.selectionEnd;
    const val = textareaContent.value;
    const sel = val.substring(start, end) || 'texto';
    textareaContent.value = val.substring(0, start) + before + sel + after + val.substring(end);
    textareaContent.focus();
  };

  // Rail item clicks
  document.querySelectorAll('.admin-rail-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.admin-rail-item').forEach(i => i.classList.remove('on'));
      item.classList.add('on');
      const tab = item.dataset.adminTab;
      if (tab === 'dashboard' || tab === 'usuarios' || tab === 'pokedex') {
        showFeedback(`Módulo "${item.textContent.trim()}" ativado para visualização.`);
      }
    });
  });
}

function setupHomeInteractions() {
  // Hero Search Input & Button
  const heroSearchInput = document.getElementById('hero-search-input');
  const heroSearchBtn = document.getElementById('hero-search-btn');

  const executeHeroSearch = () => {
    const val = heroSearchInput ? heroSearchInput.value.trim() : '';
    if (!val) return;

    // Redireciona para a Pokédex com o filtro aplicado
    switchView('view-pokedex');
    const pokeSearch = document.getElementById('clean-search-input') || document.getElementById('pokedex-search');
    if (pokeSearch) {
      pokeSearch.value = val;
      huntState.search = val.toLowerCase();
      huntState.currentPage = 1;
      applyPokedexFilters();
    }
  };

  heroSearchBtn?.addEventListener('click', executeHeroSearch);
  heroSearchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') executeHeroSearch();
  });

  // Example Chips
  document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.query;
      if (q === 'Como capturar?' || q === 'Ginásio' || q === 'Outland') {
        switchView('view-wiki');
        const wikiSearch = document.getElementById('wiki-search');
        if (wikiSearch) {
          wikiSearch.value = q;
          wikiSearch.dispatchEvent(new Event('input'));
        }
      } else if (q === 'XP' || q === 'Evolução' || q === 'Dinheiro') {
        switchView('view-calculators');
      } else {
        switchView('view-pokedex');
        const pokeSearch = document.getElementById('clean-search-input') || document.getElementById('pokedex-search');
        if (pokeSearch) {
          pokeSearch.value = q;
          huntState.search = q.toLowerCase();
          huntState.currentPage = 1;
          applyPokedexFilters();
        }
      }
    });
  });

  // Onboarding Step Cards & Feature Cards
  document.querySelectorAll('.step-card, .feature-btn').forEach(el => {
    el.addEventListener('click', () => {
      const target = el.dataset.target;
      if (target) switchView(target);
    });
  });
}
