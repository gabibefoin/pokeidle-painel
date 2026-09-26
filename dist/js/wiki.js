/**
 * POKÉIDLE HUB — WIKI OFICIAL & ENCYCLOPÉDIA ATLAS
 */

export function initWiki() {
  const searchInput = document.getElementById('wiki-search-input');
  const cards = document.querySelectorAll('#wiki-articles-grid .atlas-card');
  const railItems = document.querySelectorAll('#view-wiki .rail-item');

  // Filtragem de busca por texto
  searchInput?.addEventListener('input', (e) => {
    const term = e.target.value.trim().toLowerCase();
    cards.forEach(card => {
      const text = card.innerText.toLowerCase();
      card.style.display = (!term || text.includes(term)) ? 'flex' : 'none';
    });
  });

  // Filtragem por rail de categorias
  railItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      railItems.forEach(i => i.classList.remove('on'));
      item.classList.add('on');

      const cat = item.dataset.category;
      cards.forEach(card => {
        if (!cat || cat === 'all') {
          card.style.display = 'flex';
        } else {
          const cardCat = card.dataset.cat;
          card.style.display = (cardCat === cat) ? 'flex' : 'none';
        }
      });
    });
  });

  // Conteúdo detalhado dos artigos da Wiki
  const artigos = {
    combat: {
      titulo: 'Fórmulas de Combate, Dano e HP',
      badge: 'COMBATE & DANO',
      conteudo: `
        <p>O combate do PokéIdle segue uma versão adaptada da fórmula clássica dos jogos principais, garantindo alta dinâmica no farm idle:</p>
        <div class="code-snippet" style="background:var(--bg-surface-subtle); padding:12px; border-radius:8px; font-family:monospace; margin:10px 0; border:1px solid var(--line);">
          base = ((2 × Nível / 5 + 2) × Power × ATK / DEF) / 50 + 2<br>
          danoFinal = base × STAB × Efetividade × Rand(0.85 – 1.00)
        </div>
        <ul style="line-height:1.7; padding-left:20px;">
          <li><strong>STAB (Same Type Attack Bonus):</strong> Golpes do mesmo tipo do monstro causam <strong>×1.5</strong> de dano.</li>
          <li><strong>Amplificação Elemental na Hunt:</strong> Vantagens e desvantagens são acentuadas em 50%! Super efetivo (×2) vira <strong>×2.5</strong> (e ×4 vira <strong>×5.5</strong>). Resistências (×0.5) viram <strong>×0.33</strong>.</li>
          <li><strong>HP de Combate:</strong> No seu pokémon, a barra de vida é <code>stat HP × 12</code>. No selvagem da hunt, ele recebe <strong>5× mais vida</strong> (<code>stat HP × 60</code>) para a batalha durar mais tempo.</li>
          <li><strong>IV de Velocidade:</strong> O stat Speed não afeta dano ou corrida. Ele reduz o cooldown dos ataques em <strong>-10 ms por ponto de IV</strong> (até -320 ms).</li>
        </ul>
      `
    },
    capture: {
      titulo: 'Captura & Balanço de Bolas',
      badge: 'SISTEMAS & CAPTURA',
      conteudo: `
        <p>A captura depende do <strong>preço de NPC da espécie</strong> em escala logarítmica:</p>
        <div class="code-snippet" style="background:var(--bg-surface-subtle); padding:12px; border-radius:8px; font-family:monospace; margin:10px 0; border:1px solid var(--line);">
          raridade = log10(max(100, precoNpc)) − 1<br>
          fator = 1 + raridade³ / 17<br>
          chance = 0.0075 × (ballRate / fator) × 1.4 × multBoost
        </div>
        <p>A chance é limitada entre <strong>0,30% (piso)</strong> e <strong>10,0% (teto)</strong>.</p>
        <ul style="line-height:1.7; padding-left:20px;">
          <li><strong>Beast Ball:</strong> Eficiência ×8 (ideal para Ultra Beasts e lendários raros).</li>
          <li><strong>Ultra Ball:</strong> Eficiência ×4 (melhor custo-benefício para hunts médias/altas).</li>
          <li><strong>Super Ball:</strong> Eficiência ×3.</li>
          <li><strong>Great Ball:</strong> Eficiência ×2.</li>
          <li><strong>Poké Ball:</strong> Eficiência ×1 (para espécies comuns iniciais).</li>
        </ul>
      `
    },
    shiny: {
      titulo: 'Mecânica Oficial de Shiny',
      badge: 'SHINIES & FORMAS',
      conteudo: `
        <p>Existem 612 espécies com looktype shiny no jogo. O brilho é sorteado <strong>no momento em que a pokébola é lançada</strong>, com chance base de <strong>1 em 24.000</strong> (ou 1 em 12.000 com Secret Lure ativo).</p>
        <h4 style="margin:14px 0 6px; font-family:var(--font-display);">Vantagens do Pokémon Shiny:</h4>
        <ul style="line-height:1.7; padding-left:20px;">
          <li><strong>Multiplicador de 3× em TODOS os atributos:</strong> HP, ATK, DEF, Sp. ATK, Sp. DEF e Speed são triplicados.</li>
          <li><strong>IVs Protegidos:</strong> O sorteio é refeito até a soma dos 6 IVs passar de 110 (máximo 192).</li>
          <li><strong>Economia:</strong> Vale <strong>10× mais ouro</strong> na venda ao NPC.</li>
          <li><strong>Evolução Exclusiva:</strong> Evolui com a <strong>Shiny Stone</strong> do seu tipo primário (fabricada com 10 fragmentos de Outland ou obtida na Oferenda).</li>
        </ul>
      `
    },
    economy: {
      titulo: 'Economia: Ouro, Gemas USDT e Diamantes',
      badge: 'MERCADO & RMT',
      conteudo: `
        <p>O ecossistema econômico do PokéIdle é desenhado para sustentar comércio seguro entre treinadores:</p>
        <ul style="line-height:1.7; padding-left:20px;">
          <li><strong>Coins (Ouro):</strong> Moeda do dia a dia obtida em abates e venda de itens ao NPC. Usada para comprar pokébolas e poções.</li>
          <li><strong>Gemas (RMT com lastro em USDT):</strong> Moeda com valor real que pode ser depositada ou sacada via blockchain. Usada para negociar pokémon e itens no Mercado da Comunidade.</li>
          <li><strong>Diamantes:</strong> Moeda de suporte e doação ao servidor via PIX/Cartão. Usada para adquirir VIP, pacotes de Beast Ball, trocas de nick e cosméticos.</li>
          <li><strong>Taxa do Mercado da Comunidade:</strong> O mercado cobra taxa de 5% sobre vendas entre jogadores e possui hold de 2 minutos para sorteio antes do arremate.</li>
        </ul>
      `
    },
    features: {
      titulo: 'Casas com XP Share, Bicicletas e TMs',
      badge: 'PROGRESSÃO & UTILITY',
      conteudo: `
        <p>Recursos que aceleram o rendimento da sua equipe:</p>
        <ul style="line-height:1.7; padding-left:20px;">
          <li><strong>Casas & XP Share:</strong> Ao adquirir uma residência em qualquer cidade, você pode posicionar um pokémon descansando que receberá parte do XP gerado nas suas hunts ativas passivamente.</li>
          <li><strong>Bicicletas:</strong> Aumentam a velocidade de caminhada no mapa e reduzem o tempo de aproximação até o próximo monstro.</li>
          <li><strong>TM Disks:</strong> Discos de movimentos elementais que ensinam golpes especiais que seu pokémon normalmente não aprenderia ao subir de nível, ampliando a cobertura de fraquezas.</li>
        </ul>
      `
    },
    bosses: {
      titulo: 'Outland & Bosses de Raid',
      badge: 'ENDGAME & RAIDS',
      conteudo: `
        <p>Zonas de alta periculosidade onde monstros lendários aparecem com tempos de recarga e regras de combate especiais:</p>
        <ul style="line-height:1.7; padding-left:20px;">
          <li><strong>Tokens de Boss:</strong> Abates concedem Bronze Boss Tokens e Silver Boss Tokens para troca na loja de relíquias.</li>
          <li><strong>Fragmentos de Shiny Stone:</strong> 10 fragmentos dropados de bosses de Outland podem ser fundidos na Oficina para criar uma Shiny Stone do tipo desejado.</li>
          <li><strong>Escala de Dano Coletivo:</strong> Batalhas de raid sincronizam dano com todos os treinadores presentes no mesmo mapa.</li>
        </ul>
      `
    }
  };

  // Abrir modal com dados do artigo
  window.abrirArtigoWiki = (key) => {
    const art = artigos[key];
    if (!art) return;

    const modal = document.getElementById('species-modal');
    const modalTitle = document.getElementById('modal-species-title');
    const modalContent = document.getElementById('modal-species-content');

    if (modalTitle) modalTitle.textContent = art.titulo;
    if (modalContent) {
      modalContent.innerHTML = `
        <div style="padding: 10px 4px;">
          <span class="guide-pill" style="background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; margin-bottom: 12px; display: inline-block;">
            ${art.badge}
          </span>
          <div style="font-size: 13.5px; color: var(--ink); line-height: 1.6;">
            ${art.conteudo}
          </div>
        </div>
      `;
    }
    if (modal) modal.style.display = 'flex';
  };
}
