# Poke Idle — MMO

Idle MMO de Pokémon com WebSocket, simulação autoritativa no servidor e escala horizontal.
Usa os assets e as fórmulas reais espelhados pelo sprite-lab em `../public/data` — sprites
animados, os 347 mapas renderizados, efeitos de golpe, itens, e a curva de XP / tabela de
tipos / bandas de qualidade extraídas do jogo original.

```bash
docker compose up -d     # Postgres + Redis
npm install
npm start                # http://localhost:8080
```

Entre com um nick (3–16 caracteres) e abra o **Mapa** para escolher onde caçar.

## O que está pronto

**Centro** — o quadro de batalha. O pokémon ativo à esquerda, o selvagem à direita, ambos
animados sobre o mapa real da hunt. Investida ao atacar, folha de efeito do tipo do golpe,
número de dano colorido por efetividade, pokébola voando na captura, barras de HP e um log
de eventos.

**Esquerda** — nick, nível e XP do treinador, ouro, pokémon em campo (HP e XP próprios),
time (6 slots), depot e inventário com bolas e itens. Clicar num pokémon do depot traz para
o time; clicar num do time coloca em campo.

**Direita** — automações (lançar pokébola, usar revive ao desmaiar, usar +HP) com seleção de
quais itens gastar, e chat com os canais **Mundo**, **Comércio** e **Ajuda**.

**Topo** — Pokédex (com silhuetas do que ainda não apareceu), Mapa (343 hunts com trava por
nível) e Market (compra de bolas). Campeonato, Achievements, Bosses e Community Market estão
como abas marcadas — o protocolo já comporta, o conteúdo não foi escrito.

## O loop

Escolhe a hunt → o servidor sorteia um selvagem pelos pesos de spawn reais → seu pokémon
ataca sozinho ciclando entre os golpes conforme cada cooldown libera → efetividade, STAB e a
amplificação de +50% da hunt entram no dano → o selvagem morre e dropa loot/XP/ouro, ou você
o enfraquece e joga uma bola. Tudo resolvido no servidor; o cliente só anima.

## Comandos

```bash
npm start          # gateway + simulação num processo
npm stop           # mata todos os processos do servidor e libera as travas de shard
npm run smoke      # valida o loop de combate por 25s e imprime as métricas
npm run test:ui    # teste de UI com teclado real (digitar, Enter, modal, chat, batalha)
npm run test:onboarding  # nick → gênero → cores → starter, e a ordem que o servidor cobra
npm run loadtest   # node tools/loadtest.mjs [n] [seg] [rampa/s] [prefixoNick]
```

Duas ferramentas de diagnóstico que ajudam quando a tela fica em branco ou a arte pesa demais:

```bash
node tools/console.mjs [url] [seg]              # o console do navegador na linha de comando
node tools/otimizar-arte.mjs <ent> <sai.jpg>    # reduz e recomprime uma arte grande
```

## Documentação

| Arquivo | Assunto |
|---|---|
| [ARQUITETURA.md](ARQUITETURA.md) | shards, tick, barramento e escala |
| [AUTENTICACAO.md](AUTENTICACAO.md) | contas, Google/Discord, confirmação de e-mail |
| [PERSONAGEM.md](PERSONAGEM.md) | o boneco do treinador, as cores e o onboarding |
| [src/client/DESIGN.md](src/client/DESIGN.md) | o vocabulário visual da interface |
| [HOSPEDAGEM.md](HOSPEDAGEM.md) | subir em produção |

`test:ui` digita com eventos de teclado de verdade via CDP. Vale a pena porque entrar pela
URL (`?nick=`) não exercita o teclado — e foi exatamente aí que passou um bug em que
`onkeydown` retornando `false` cancelava a digitação no campo de nick e no chat.

Atalhos de URL para teste e demo: `?nick=x&hunt=<slug>&auto=1&modal=mapa`.

## Escala

Ver [ARQUITETURA.md](ARQUITETURA.md) para o desenho completo. Resumo do que foi medido nesta
máquina (8 cores, tudo local):

| cenário | conexões | tick p50 | tick p95 | msgs/s |
|---|---|---|---|---|
| 1 processo | 2000 | 13,1 ms | 63,7 ms | 2.695 |
| 2 gateways + 2 sims | 2000 | ~22 ms | ~50 ms | 3.162 |

Orçamento do tick: 250 ms. Sobra ~4× no p95 com 2000 jogadores num shard só.

```bash
# separando os papéis
ROLE=sim     SHARD_ID=0 SHARD_COUNT=2  npm start
ROLE=sim     SHARD_ID=1 SHARD_COUNT=2  npm start
ROLE=gateway SHARD_COUNT=2 PORT=8080   npm start
ROLE=gateway SHARD_COUNT=2 PORT=8081   npm start
```

## Números que são nossos, não do jogo original

Estão isolados e comentados para facilitar o balanceamento:

- **Fórmula de dano** (`src/server/game/combate.mjs`) — o servidor original nunca expõe a
  dele; adaptamos a fórmula clássica da série.
- **Chance de captura** (`src/server/sim.mjs`) — a raridade sai do `priceNpc` real, mas em
  escala log, porque os preços vão de 60 a 6,5 bilhões. Dá ~2 bolas para um Pidgey e ~29 para
  um Dragonite com Poké Ball; a Ultra Ball corta por 4.
- **Chance de shiny** (`src/server/sim.mjs`) — **1/8.000** por encontro para toda espécie com
  forma shiny no catálogo (612 hoje). O Secret Lure dobra.
- **Cooldown global entre golpes** (900 ms) — os cooldowns por golpe são os reais (2s a 60s),
  isto só evita despejar cinco golpes no mesmo tick.

Já os valores **reais** extraídos do jogo: curva de XP `round(50/3·(L³−6L²+17L−12))`, tabela
de tipos 18×18, amplificação de +50% na hunt, HP ×5 e dano ×1,8 do selvagem, bandas de
qualidade (que somam 100%), IV de 1 a 32, `catchRate` das 6 bolas e as chances de loot.

## Limitações conhecidas

- **Sem autenticação**: o nick é a identidade, sem senha. Suficiente para a fatia, não para
  produção.
- **Fundos pesados**: o cliente baixa o PNG inteiro da hunt (alguns têm 11 MB) e recorta no
  canvas. Pré-cortar 640×360 por hunt no build resolveria.
- **Trocar `SHARD_COUNT` remapeia todo mundo** e exige restart coordenado.
- Market só vende bolas; venda de loot e mercado entre jogadores não existem ainda.
