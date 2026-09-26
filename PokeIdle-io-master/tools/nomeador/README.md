# Nomeador

Sprite Lab para dar nome às sprites de `%USERPROFILE%\Documents\Sprites`. Mostra o
sprite animado com um campo de texto embaixo; ao dar Enter, o **PNG de origem é
renomeado no disco**.

Todas as 6750 sprites já estão convertidas para o formato do PokeIdle.io — atlas
`.webp` lossless + manifest `stonegy-asset-packs-v1`, o mesmo que o jogo carrega
de `public/data/asset-packs/`. O que a interface desenha é o atlas convertido, não
o PNG: se aparece certo aqui, aparece certo no jogo.

## Rodar

```sh
npm run nomeador:build   # converte os PNG que ainda faltam (incremental)
npm run nomeador         # http://localhost:5174
npm run publicar:backup  # Desktop/Pokedex Backup → jogo (fluxo padrão)
```

Sprites entram pelo **Desktop/Pokedex Backup** (`Geração N/###_slug.png`), não editando
`Documents/Sprites` na mão. O `publicar:backup` importa, builda, publica e regera o atlas.

Abas do lab: **Nomeador**, **Pokédex**, **Spawns**, **Mapas**, **Casas** (`/casas.html`), **Ginásios** (`/ginasios.html`).

A aba **Casas** marca recortes walkáveis em Cerulean (5 tiers) e grava em
`game/src/server/dados/casas-editor.json`. Precisa do espelho `public/data` com
`world/maps/cerulean.json` (rode `node tools/fetch-world.mjs --maps=cerulean`).

A aba **Ginásios** marca a arena do desafio ao líder (recorte + spawn desafiante/líder) e grava em
`game/src/server/dados/ginasios-editor.json` → hunt `ginasio-duelo` no `npm run walkgrids`.

Na aba **Pokédex** do Sprite Lab, o botão **salvar pokédex** roda o pipeline inteiro
(`build` → `publicar:sprites` → `sync:sprites` → `marker-atlas`) e copia tudo para o
espelho local. Depois é só reiniciar `npm start` do jogo.

### Trava da Pokédex Lab (baseline)

Depois de deixar a Pokédex 100% certa, congele o estado:

```sh
npm run nomeador:snapshot-pokedex   # grava tools/nomeador/pokedex-lab-baseline.json
npm run nomeador:verificar          # falha se cair para · jogo, PNG mudar ou atlas vazio
```

Só rode `snapshot-pokedex` de novo quando **melhorar** a Pokédex de propósito. O baseline
vai no git — qualquer regressão (import errado, manifest trocado, sprite invisível) quebra
o verify antes de publicar.

Deploy produção (depois do espelho local pronto):

```sh
npm run publicar:backup
.\infra\deploy-public-data.ps1 -SemRestart
```

### Emergência (rename errado no lab)

| comando | quando usar |
| --- | --- |
| `npm run nomeador:recuperar -- mothim` | restaura caminhos de uma espécie pelo log |
| `npm run nomeador:reverter -- 8702` | desfaz renomeações do log a partir da linha N |
| `python tools/nomeador/exportar-do-lab.py 40335 4GEN/foo` | copia PNG do atlas do lab para disco |

Relatórios de `npm run auditar:sprites` / `auditar:spawns` vão para JSON local
(`tools/nomeador/auditoria-*.json`) — regeneráveis, não versionados.

O build só precisa rodar de novo quando entrarem PNGs novos na pasta. Renomear pela
interface não exige rebuild — o nome não entra no atlas, só no índice e no arquivo.
**Reinicie o Nomeador** (`npm run nomeador:stop` + `npm run nomeador`) ou dê **F5**
no browser depois de `nomeador:build` / `publicar:backup` com o servidor já aberto —
senão o id da carta e o PNG no disco ficam dessincronizados e o rename grava no
arquivo errado.

## Atalhos

| tecla | o que faz |
| --- | --- |
| `Enter` | salva e pula para a próxima da fila |
| `Shift+Enter` (ou o `×` da carta) | tira da fila: manda o PNG para `NP/` |
| `Tab` | vai para o campo seguinte, sem salvar |
| `Esc` | cancela a edição da carta |
| `Ctrl+Z` | desfaz o último passo, rename ou descarte |
| campo vazio + `Enter` | volta ao nome original (`outfit_N`) |

O `×` é para o que não é pokémon para nomear — fantasia de evento, montaria,
treinador, bicicleta. A carta não some da grade: fica apagada e o `×` vira `↩`,
que traz de volta para a pasta de origem. Some só no próximo filtro. O chip
*não-pokémon* mostra tudo que está em `NP/`, para revisar depois.

O campo tem autocomplete com as 482 espécies de `creatures.json` (mais os `shiny_`)
e tudo que já foi nomeado à mão. Direção, zoom e filtro ficam salvos no navegador.

## Silhuetas parecidas na aba *não-pokémon*

```sh
python tools/nomeador/silhuetas.py            # corte padrão: 80%
python tools/nomeador/silhuetas.py --limiar .7
```

Na aba *não-pokémon* a ordem por número de Pokédex não diz nada — quase nada ali tem
nome. Então a lista sai agrupada por **silhueta**: o Blastoise com chapéu fica colado no
Blastoise sem chapéu, a montaria colada no bicho de origem. Uma faixa colorida na
esquerda da carta marca o bloco e alterna de cor a cada bloco novo; o `⧉n` embaixo diz
quantas sprites ele tem.

A conta é IoU (interseção sobre união) da máscara alpha das vistas **sul e leste**, em
escala nativa. Duas escolhas que custaram uma versão inteira:

- **Não normalizar o tamanho.** A primeira tentativa recortava e reescalava cada vista
  para 32×32; isso apaga tamanho e contorno fino, quase toda silhueta cheia passa de 80%
  e a ligação simples encadeou 710 sprites — Blastoise, um carro e uma bola no mesmo
  "grupo". Colando a máscara sem reescalar, o tamanho volta a ser sinal.
- **Cortar a corrente.** Mesmo assim a ligação simples encadeia: dá para caminhar de um
  Gengar até uma Blissey de par em par. Dentro da corrente as sprites são ordenadas por
  vizinho mais parecido e a corrente é cortada onde a semelhança entre vizinhos cai
  abaixo do corte. Resultado: **todo par vizinho dentro de um bloco passa do limiar**.

Hoje: 4859 sprites em `NP/` → 1291 blocos, 918 com dois ou mais, o maior com 62.

O `silhuetas.json` é opcional: sem ele a aba só perde a ordenação, nada quebra. Rode de
novo depois de mandar muita coisa nova para `NP/`.

## Convenções

- Nome normalizado ao salvar: minúsculo, sem acento, apóstrofo cai (`Farfetch'd` →
  `farfetchd`), o resto vira `_`.
- Nome repetido ganha sufixo: `pikachu`, `pikachu_2`, `pikachu_3`. É de propósito —
  espécie com mais de um sprite é comum.
- Renomear não muda o arquivo de pasta; só o `×` move, e só para `NP/`. O destino
  vem de uma lista fechada (`''`, `NOMEADOS`, `NP`, `SHINYS_NOVOS`, `VAZIOS`) —
  senão o cliente escolheria caminho de disco.
- A **fila** (e a barra de progresso) ignora o que está em `NP/` e em `VAZIOS/`:
  são justamente as sprites que não esperam nome.

## Arquivos

| arquivo | papel |
| --- | --- |
| `converter.py` | um PNG → atlas `.webp` + manifest. É o formato do jogo, conferido quadro a quadro. |
| `construir.py` | varre a pasta toda (raiz + `NOMEADOS/` + `1GEN`…`9GEN/` + `NP/` …), converte o que falta e escreve `LAB/lab-index.json`. |
| `silhuetas.py` | agrupa as sprites de `NP/` por silhueta parecida → `LAB/silhuetas.json`. |
| `servidor.mjs` | serve a página, os atlas e a API. `POST /api/nome` é a única rota que escreve. |
| `public/` | a interface. |

Saída em `<Sprites>/LAB/`: `outfits/`, `categories/`, `lab-index.json`,
`nao-convertidos.csv` e `renomeacoes.jsonl` (log de todo rename, para desfazer
qualquer coisa fora da interface).

## Detalhes que custaram caro

**A identidade de uma sprite é o md5 do PNG, não o caminho.** Por isso renomear não
faz o build seguinte reconverter nada nem trocar o id da carta.

**O zoom é um teto, não um fator.** Os quadros vão de 32×32 a 256×480; cada sprite
cresce até o maior múltiplo inteiro que cabe no palco (inteiro para não borrar o
pixel art), limitado pelo zoom.

**5 PNGs não viram atlas** — não têm grade de 4 colunas de múltiplo de 32
(`anuncio-shinys`, `outfit_561`, `outfit_6282` e dois vazios de 32×32). Ficam no
índice com o filtro *sem atlas* e a interface mostra o PNG cru, então nada some.

**Encoding webp `method=4`, não `6`.** Lossless, então os pixels são idênticos; na
prática o 4 gerou os mesmos bytes que a conversão já validada (conferido contra
`CONVERTIDO/`) e é 27× mais rápido — 27s para as 6750 em vez de mais de uma hora.
