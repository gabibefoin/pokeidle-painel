# Atualização — PokeIdle.io

## TM Researcher e discos TM

- Novo **TM Researcher** no Centro Pokémon: troca peças de boss por discos TM e aplica golpes permanentes no pokémon.
- Disco **AoE**: todos os golpes passam a acertar área ao redor do alvo (Charizard com AoE deixa de bater só em um selvagem por vez — bug corrigido no servidor).
- Discos **elementais**: golpe especial em área 3×3 no alvo, com restrição por tipo de espécie (ex.: Gengar aceita Ghost/Dark/Poison).
- Botão **[i]** no TM Researcher com modal explicando peças, tokens, tipos compatíveis e regras.
- Capítulo **TM** reescito na Poképedia, alinhado às regras atuais do jogo.

## Depot (Centro Pokémon)

- Novo **Depot** no Centro: guarda pokémon fora da equipe (equipe cheia na captura manda o bicho direto pro Depot).
- Modal com equipe à esquerda e depot à direita, busca, mover com **→** (pro depot) e **←** (pro time).
- Botão **[i]** abre a ficha do pokémon **na frente** do modal do Depot.
- Tecla **Esc** fecha a ficha antes do Depot.

## Hunt Analyser (Mapa)

- Painel no canto do mapa ao passar o mouse numa hunt: XP/hora, ouro, matchup de tipos e **tabela de drops** por espécie.
- **Strange Pheromone** removido das listas de drop (chance 0 em todo o catálogo — não faz sentido mostrar).
- Modal do **Mapa** maior; área do mapa ocupa mais espaço vertical.
- Botões de lupa **+ / −** removidos — zoom continua com a roda do mouse e arrastar para mover.

## Guild PvP

- Sem fogo amigo: membros da mesma guild não se atacam.
- Quem cai vai ao **Centro Pokémon** e **não reentra** no evento do dia.
- A guild só é eliminada quando **todos** os membros caem (um caindo não elimina a guild).
- **Vencedores**: toast *"Parabéns! Vocês venceram o PvP Guild de hoje!"*, retorno ao Centro após **5 segundos**.
- Anúncio **verde no chat** (Mundo, Comércio e Ajuda) com nome da guild, vencedores, participantes e GP ganho.

## Poképedia e interface

- Campo de busca de capítulos estilizado no padrão visual do jogo.
- Removidas referências ao jogo original / "Poke Idle World" em textos visíveis ao jogador.
- Capítulo **Stats, Qualidade e IV**: explicação clara de que **qualidade é sorteio na captura**, independente de IV e potência; tabela de faixas e correção sobre teto 1,8 e shiny.

## Combate e conteúdo (servidor)

- Regras de TM aplicadas na hunt, equipe e combate (portões no servidor).
- Ajustes em bosses, centro, combate e walkgrids.
- Testes automatizados: **Guild PvP** (`teste-guild-pvp.mjs`).

---

**Depois de atualizar:** reinicie o servidor e dê **Shift+F5** no cliente para carregar JS/CSS novos.
