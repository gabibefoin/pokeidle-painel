# Sprites de Pokémon extraídas

Cada Pokémon do jogo tem um "looktype" (id de outfit no atlas original, formato PokéTibia).
Este pacote cruza `creatures.json` (pokeId -> looktype normal) com o catálogo de shiny
(`index/formulas.json`) e o índice de outfits (`asset-packs/outfits-index.json`) para gerar,
por Pokémon, um PNG normal e um PNG shiny (quando existe).

## Estrutura

- `mapping.json` — lista com um item por Pokémon:
  `{ pokeId, name, type1, normal: {...} | null, shiny: {...} | null }`
  Cada bloco normal/shiny traz o `looktype` original, o `file` (caminho relativo aqui dentro),
  `directions` (1=norte 2=leste 3=sul 4=oeste), `frames` (quadros de andar) e o tamanho do
  quadro em pixels (`tileW`/`tileH`).
- `normal/<pokeId>-<slug>.png` — sprite normal.
- `shiny/<pokeId>-<slug>.png` — sprite shiny (só quando a espécie tem forma shiny — 190/485).

## Como ler um PNG

Cada arquivo é um atlas: uma grade de `directions` colunas × `frames` linhas, cada célula de
`tileW`×`tileH` pixels. O quadro (direção `d` 1-4, frame `f` 0..frames-1) fica no retângulo
`x = (d-1) * tileW, y = f * tileH, w = tileW, h = tileH`.

## Cobertura

- 485/485 espécies com sprite normal.
- 190/485 espécies com sprite shiny (as demais não têm forma shiny publicada).
