# 🧠 PokéIdle Master Context & Knowledge Base

Esta pasta é a **Base de Conhecimento Central** do ecossistema PokéIdle mantido por `@gabilemos`.

Ela contém todo o conhecimento acumulado, especificações do protocolo de rede, fórmulas matemáticas do jogo, gotchas técnicos resolvidos, código-fonte oficial e configurações de infraestrutura. Qualquer novo projeto (bot, painel multi-contas, wiki, blog, app mobile) deve usar este diretório como ponto de partida para não precisar reexplicar o funcionamento do jogo.

---

## 📂 Estrutura da Base de Conhecimento

```
PokeidleContext/
├── README.md                          # Este guia mestre de navegação
├── PROMPT_TEMPLATE.md                 # Prompt pronto para colar ao criar novos projetos
│
├── docs/                              # Documentações técnicas e de mecânicas
│   ├── 01_GAME_OVERVIEW_AND_ARCHITECTURE.md  # Visão geral, Canvas 2D, ticks e loops
│   ├── 02_WEBSOCKET_PROTOCOL.md              # Dicionário completo de pacotes WS (In/Out)
│   ├── 03_COMBAT_AND_FORMULAS.md             # STAB, dano, IVs, Natures, Quality, Shinies
│   ├── 04_ECONOMY_AND_MARKET.md              # Ouro, Gemas, retenção 2m, sorteio 3s, sniper
│   ├── 05_VPS_AND_INFRASTRUCTURE.md          # VPS, portas (8080/8081), Tailscale, systemd
│   ├── MECANICAS.md                          # Documentação oficial completa (61 KB)
│   ├── FAQ_OFICIAL.md                        # FAQ oficial do Discord (58 KB)
│   └── ECONOMIA_OFICIAL.md                   # Relatório de economia e drops oficial
│
├── source-code/                       # Códigos-fonte de referência
│   ├── official-shared/               # 59 módulos JS/MJS com todas as regras do jogo
│   ├── official-server/               # Backend do servidor oficial (gateway, sim, protocolo)
│   └── go-engine/                     # Nossos módulos Go (protocol, state, sniper, proxy)
│
└── agents-and-skills/                 # Skills para IA
    └── .agents/skills/pokeidle/
        └── SKILL.md                   # Cheatsheet com gotchas críticos e armadilhas evitadas
```

---

## 🗺️ Mapa dos Projetos na Pasta `/Users/gabilemos/Documents/Pokeidle/`

1. **`PokeidleBot/` (Porta `8080`):**
   - Conta principal do jogador (`befoin`).
   - Motor Turbo Sniper Master em Go com carpet bombing e painel split-screen integrado ao jogo oficial.
   - Serviço VPS: `pokeidle-sniper.service`.

2. **`PokeidleCenter/` (Porta `8081`):**
   - Hub de gestão multi-contas para N bots paralelos.
   - Cada conta disca através de seu próprio **Proxy SOCKS5** (IP residencial isolado).
   - Dashboard centralizado com visualização de grid e espelho interativo de contas.
   - Serviço VPS: `pokeidle-center.service`.

3. **Futuros Projetos (`PokeidleWiki`, `PokeidleApp`, etc.):**
   - Podem ser criados como pastas irmãs dentro de `/Users/gabilemos/Documents/Pokeidle/`.
   - Bastará apontar para esta pasta `PokeidleContext` para que qualquer assistente de IA compreenda imediatamente todas as nuances do jogo.
