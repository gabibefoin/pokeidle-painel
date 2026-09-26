# Sprite Lab — PokéTibia (poke.idleworld.online)

Espelho local + visualizador de tudo que o **poke.idleworld.online** serve publicamente:
sprites de looktype (`.spr`/`.dat` de PokéTibia), os mapas de tiles, os spawns por hunt,
o loot e os preços. Material de pesquisa.

```
npm run fetch       # sprites + mundo + efeitos + índices   (~88 MB, ~25 s)
npm run fetch:maps  # + os 347 mapas de tiles               (~238 MB, ~20 s)
npm run walkgrids   # (depois dos mapas) extrai a área andável de cada hunt (~1 MB, ~2 s)
npm start           # http://localhost:5173
npm run maps:png    # (com o servidor no ar) renderiza os 347 mapas para PNG (~1,6 GB, ~13 min)
```

Para as imagens dos mapas em metade da resolução (~400 MB):
`node tools/export-map-pngs.mjs --escala=0.5 --force`

## O que tem aqui

| | |
|---|---|
| **487 outfits** | 334 pokémon · 69 shiny · 60 clan · 14 premium · 9 trainer · 1 hunt |
| **295 itens** | loot, cards, stones, TMs, clan, heal, revive — com preço de NPC |
| **443 fichas** | stats, tipos, evolução, loot, nível de caça |
| **347 hunts** | 228 kanto · 72 orre · 47 outland, com coordenada no mapa-múndi |
| **347 mapas** | tiles completos, até 92 mil tiles e 12 andares (Cerulean) |
| **10.338 tiles** | atlas `map-items` em 30 páginas .webp |
| **461 ataques** | tipo, power, categoria, cooldown, quem aprende e em que nível |
| **80 efeitos** | folhas de animação de golpe, 1.211 quadros |
| **11 folhas** | animações de captura e quebra das 6 pokébolas |
| **fórmulas** | curva de XP, tabela de tipos, qualidade/IV, combate — veja [MECANICAS.md](MECANICAS.md) |

## As cinco abas

- **Outfits** — os 487 looktypes, 4 direções, animados, com export PNG/.zip.
- **Itens** — o catálogo com ícones.
- **Mapa** — o mapa-múndi de cada região com os marcadores plotados. Clique num marcador:
  spawns, NPCs, coordenadas, e um botão que **renderiza o mapa de tiles daquela hunt**
  com os pontos de spawn marcados em vermelho.
- **Spawns** — cada pokémon e em que hunts ele aparece (com nº de pontos de spawn).
- **Loot** — cada item, preço no NPC, quantos pokémon dropam e com que chance.
- **Efeitos** — três modos: os 461 **ataques** (cada um tocando a animação do seu tipo, com
  power, cooldown e quem aprende), as 80 **folhas fx** cruas, e as **pokébolas** (captura e
  quebra). No drawer de uma folha dá para baixar os quadros fatiados em `.zip`.
- **Fórmulas** — a curva cúbica de XP com calculadora, a tabela de tipos 18×18 (com o toggle
  da amplificação de +50% da hunt), as bandas de qualidade/IV e a conta de quanto tempo levaria
  para "zerar". Procedência de cada número em [MECANICAS.md](MECANICAS.md).

Links diretos: `#outfits` `#items` `#mapa` `#spawns` `#loot` `#efeitos` `#formulas`,
`#o=25` (looktype), `#h=pikachu` (hunt), `#i=Bone` (item), `#fx=folhas`, `#f=tipos`.

## De onde vem cada coisa

Nada disto exige login — tudo responde 200 para um GET simples.

| origem | o quê |
|---|---|
| `/game/asset-packs/outfits-index.json` | catálogo de looktypes → manifest + atlas |
| `/game/asset-packs/version.json` | atlas de tiles `map-items` (30 páginas) |
| `/game/maps/<slug>.json` | tiles de um mapa: `[x, y, z, chãoId, [[itemId],…]]` |
| `/game/{collision,draworder,offsets}.json` | colisão, ordem de desenho, deslocamentos |
| `/game/{creatures,items}.json` | fichas e catálogo de itens |
| `/api/game/map-markers` | os 347 marcadores: slug, nome, pixel, área, range |
| `/api/game/hunt-config?slug=` | coordenadas exatas de cada spawn, com `pokeId` |
| `/api/game/city-npcs?slug=` | NPCs das cidades |
| `/assets/effects/moves/index.json` | 80 folhas de efeito → `file`, `frameW/H`, `frames`, `frameMs` |
| `/assets/effects/catch/` | folhas de captura/quebra; o arremesso fica em `catch/throw/` |

O resto de `/api/game/*` (shop, market, pokedex, profile…) exige autenticação — 401.

### Sprites de outfit

Quadros nomeados `{frame}_{layer}_{addon}_{direction}.png`, direção 1=N, 2=L, 3=S, 4=O.
Desenhar = recortar o retângulo do manifest com `imageSmoothingEnabled = false`. Os 13
outfits colorizáveis (trainers) trazem uma máscara `_template` — vermelho+verde = cabeça,
vermelho = corpo, verde = pernas, azul = pés — multiplicada sobre a base. O visualizador
mostra a base com as cores padrão.

### Mapas de tiles

Portado do cliente deles (PixiJS → canvas 2D), em [public/mapview.mjs](public/mapview.mjs):

```
x = 32*tx - (largura - 32) - disp[0]
y = 32*ty - (altura  - 32) - disp[1] - elevaçãoAcumulada
```

`disp`/`elev` vêm de `offsets.json`. Andares vão de maxZ a minZ deslocados em `(z-groundZ)*32`,
tiles ordenadas por z desc, y asc, x asc — pintor clássico. Sprites com `patternX`/`patternY`
escolhem o quadro pela coordenada no mundo (é o que faz a grama variar lado a lado).

Duas diferenças conhecidas em relação ao cliente: não reproduzo as sub-ordens de
`draworder.json` dentro de uma mesma tile, e não animo os tiles. (O renderizador do **jogo**,
em `game/src/client/mapa.mjs`, já reproduz as sub-ordens — precisa delas para os pokémon
passarem atrás das árvores.)

### Área andável das hunts

`tools/build-walkgrids.mjs` extrai, de cada mapa, onde dá para pisar — a mesma regra do
`walkable(tx, ty)` do cliente deles:

```
andável = dentro de _meta.walk
          E existe tile no andar do chão (z === groundZ)
          E nem o chão nem nenhum item daquela tile está em collision.json
```

Ainda joga fora o que não está conectado ao ponto de entrada da hunt (telhados, ilhas atrás
de parede) e encaixa cada ponto de spawn na tile livre mais próxima. Sai um
`world/walkgrids.json` de ~1 MB com os 347 mapas (412 mil tiles andáveis) — é o que o
servidor do jogo carrega para mover herói e selvagens sem abrir os 238 MB de mapas.

### Efeitos de golpe

Cada folha é uma tira **vertical**: o quadro `i` fica em `(0, i*frameH, frameW, frameH)` —
igual ao `Rectangle(0, s*frameH, frameW, frameH)` do cliente. Reproduzido em
[public/fx.mjs](public/fx.mjs), que só anima o que está visível.

**Ressalva importante:** o efeito exato de cada golpe é escolhido pelo *servidor* — o evento
de batalha carrega os campos `fx`/`fx2` e o cliente só faz o lookup. Isso vem pelo socket
autenticado, então não está no espelho. O que dá para amarrar offline é o **tipo** do ataque
(que está em `creatures.json`) com a folha daquele tipo, que é exatamente o fallback do
cliente. As outras 62 folhas são efeitos nomeados de boss (`METEOR_FISTS`, `OMEGA_CLAP`,
`CROSSING_FISSURE`…) e ids crus `FX_####`, disparados por cinemáticas específicas.

## Estrutura

```
tools/
  fetch-poke-assets.mjs   outfits + itens + ícones
  fetch-world.mjs         marcadores, spawns, NPCs, tabelas, atlas de tiles, mapas
  fetch-effects.mjs       folhas de efeito de golpe e de captura
  export-map-pngs.mjs     renderiza os 347 mapas para PNG via Chrome headless
  build-indexes.mjs       cruza tudo e gera os índices de spawn, loot e ataques
  build-formulas.mjs      consolida as fórmulas extraídas do bundle
  build-walkgrids.mjs     extrai a área andável de cada hunt (grade + pontos de spawn)
  lib.mjs                 pool de download, retry, resume
server.mjs                servidor estático sem dependências
public/
  index.html · viewer.css · viewer.js    visualizador
  mapview.mjs             renderizador dos mapas de tiles
  fx.mjs                  player das folhas de efeito
  zip.mjs                 escritor de ZIP "store"
  _selftest.html          smoke test dos sprites
  _maptest.html           smoke test dos mapas
  data/                   ← gerado pelos fetch (não versionar)
```

## Lacunas conhecidas dos dados de origem

Nenhuma destas é erro do espelho — são buracos no que a origem publica:

- **100 dos 443 pokémon não têm hunt** (Magikarp, Ditto, Eevee, as evoluções de pedra…).
  Vêm de evolução ou troca; o filtro "sem hunt" na aba Spawns isola esses.
- **77 dos 347 mapas usam 1.116 ids de tile que não existem no atlas `map-items`.**
  O cliente deles pula esses ids em silêncio (`placeSprite` retorna se `!assets[id]`),
  então esses mapas têm buracos no jogo também. O drawer mostra o contador
  "N ids sem asset" por mapa; os piores são `seviper`, `lucario`/`riolu` (~20%) e
  `altaria`/`swablu`/`swellow`/`taillow` (~40%).
- **4 ícones de item apontam para URLs mortas** no `pokexguides.com` (Crystal Cube,
  Dodo Cube, Goggles, Magnetic Cube).
- **3 dos 461 ataques não têm folha de efeito** — são do tipo `NEUTRAL`, que não existe em
  `effects/moves/index.json` (Crush Claw, Curse, Growl).

## Verificação

Com o servidor no ar, abra:

- `/_selftest.html` — carrega um outfit de cada kind, recorta todos os quadros e conta
  pixels opacos. Título vira `SELFTEST-OK` ou `SELFTEST-FALHOU`.
- `/_maptest.html` — renderiza 3 mapas inteiros e confere que o canvas saiu preenchido.
  Título vira `MAPTEST-OK` ou `MAPTEST-FALHOU`.

## Flags dos downloaders

```
node tools/fetch-poke-assets.mjs --force | --only=shiny,clan | --no-items
node tools/fetch-world.mjs --maps | --maps=cerulean,pikachu | --force
```

Ambos são resumíveis: rodar de novo só baixa o que falta. Falhas ficam em
`public/data/summary.json` e `public/data/world/summary.json`.

## Procedência e uso

Os sprites são arte de Pokémon (© Nintendo / Creatures Inc. / GAME FREAK) redesenhada no
estilo Tibia por comunidades de OTServ, distribuída em `.spr`/`.dat` de PokéTibia (otpokemon).
Este repositório só espelha o que já é servido publicamente, para estudo — não redistribua o
conteúdo de `public/data/`. Para a fonte primária em vez do espelho, procure os packs
`.spr`/`.dat` do otpokemon no xTibia/TibiaKing e extraia com ObjectBuilder ou Tibia Sprite Editor.
