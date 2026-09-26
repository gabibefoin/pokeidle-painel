# Design system — pixel art de tabuleiro

Toda a interface do jogo usa **um só vocabulário visual**: tábua de madeira, botão roxo e
vão escuro. Referência: o painel "Information" do Bombcrypto
(`https://game.bombcrypto.io/web/v13d/index.html`).

As cores não foram estimadas por print — saíram da decodificação dos PNGs do site
(tile de fundo 64×64, botão 229×66, board 746×114), amostrados pixel a pixel.

---

## 1. Paleta

Tudo mora em `:root`, no topo de [`estilo.css`](estilo.css). **Nunca escreva cor solta em
CSS ou em template de JS** — se falta um tom, adicione uma variável.

| Grupo | Variável | Valor | Papel |
| --- | --- | --- | --- |
| Fundo | `--xadrez-esc` / `--xadrez-clr` | `#3357e3` / `#587aff` | xadrez da página, quadrados de 32 px |
| Madeira | `--mad-linha` | `#480e1e` | filete escuro, sempre o anel mais externo |
| | `--mad-luz` | `#f1d3b7` | brilho de cima (quadros) |
| | `--mad-luz2` | `#e7a86d` | brilho lateral (botões) |
| | `--mad` | `#bd6951` | corpo da tábua |
| | `--mad-esc` | `#914850` | sombra interna do topo |
| | `--mad-quente` | `#df824c` | reflexo de baixo |
| | `--mad-base` | `#722c3f` | degrau projetado para baixo |
| Roxo | `--rx-luz` | `#ffdef0` | fio de luz no topo do botão |
| | `--rx-esc` | `#8d49b8` | faixa escura superior **e o contorno do texto** |
| | `--rx` | `#ba5ad1` | corpo do botão |
| | `--rx-clr` | `#e77ad2` | brilho inferior |
| | `--rx-rosa` | `#ffa7d7` | fio rosa da base; também números em destaque |
| Vão | `--vao` / `--vao2` | `#33202b` / `#462b39` | áreas recuadas (normal / realçada) |
| Texto | `--sobre-mad` | `#fff6ef` | texto sobre a madeira |
| | `--sobre-mad-dim` | `#f5cdb9` | secundário sobre a madeira |
| | `--vao-dim` | `#c9a9b4` | secundário dentro do vão |
| Ouro | `--ouro-luz` | `#ffe9a3` | fio de brilho do anel |
| | `--ouro` | `#e2a93f` | corpo do anel |
| | `--ouro-esc` | `#7d5313` | filete escuro (o papel do `--mad-linha`) |
| | `--ouro-vao` | `#efe4d2` | miolo claro no lugar do vão escuro |
| Raridade | `--rar-comum` / `--rar-incomum` | `#b9aeb3` / `#6bc96b` | anel das duas de baixo — sem luz própria |
| | `--rar-rara` / `--rar-rara-luz` | `#5fb8f0` / `#aee3ff` | anel e fio claro (halo, número) |
| | `--rar-mitica` / `--rar-mitica-luz` | `#b67dff` / `#ecd6ff` | anel girando, lâmina e faísca |
| | `--rar-lendaria` / `--rar-lendaria-luz` | `#ffd166` / `#fff7d0` | o mesmo, em ouro e mais depressa |
| Tiers do PvP | `--tier-bronze` … `--tier-challenger` | amostradas dos emblemas | a cor do tier: o halo do cartão do PvP e a base do card de inscrito do Campeonato |
| Campeonato | `--camp-*` | ver `:root` | o metal do pódio e das cabeças de chave (ouro, prata, bronze), as linhas da chave e o anel do cabeçalho — só na seção "o Campeonato" |

> **A escada de raridade é uma só.** Casa, Bicicleta e a tela de "você recebeu" contam
> cinza → verde → azul → roxo → ouro, e a DOPAMINA sobe junto: Comum e Incomum são só a cor; a
> Rara ganha halo; a Mítica e a Lendária ganham movimento (anel girando, lâmina de luz, faíscas).
> Se a Comum brilhasse, a Lendária não teria para onde subir. Tudo que se mexe para em
> `prefers-reduced-motion`. O modal da Casa (`.csm-*` em `estilo.css`) é a referência.

> **O ouro é "o que já é seu".** Estreou no marcador do mapa: a espécie que a conta já
> capturou troca o vão escuro por miolo claro e ganha anel dourado. Ele existe porque as
> outras cores do mapa estão OCUPADAS — roxo é "estou caçando aqui", rosa é "o mouse está em
> cima", cinza apagado é "seu nível não chega". Não confundir com os `--ch-ouro-*`: aqueles
> são o metal da moldura do chat, mais apagados porque vivem sobre vidro preto.

---

## 2. As três peças

Molduras são **`box-shadow: inset` empilhadas**. A primeira sombra da lista fica por cima,
então os anéis se desenham **de fora para dentro**. Nada de `border`.

### Quadro — `.painel`, `.modal-caixa`, `.menu-topo`, `.palco-moldura`, `.login-card`

Tábua com filete + brilho + degrau embaixo.

```css
background: linear-gradient(180deg,
  var(--mad-esc) 0 10px, var(--mad) 10px calc(100% - 14px),
  var(--mad-quente) calc(100% - 14px) calc(100% - 7px), var(--mad) calc(100% - 7px) 100%);
border: 0; border-radius: 8px;
box-shadow:
  inset 0 0 0 2px var(--mad-linha),
  inset 0 0 0 4px var(--mad-luz),
  inset 0 0 0 6px var(--mad),
  0 4px 0 var(--mad-base),      /* degrau */
  0 6px 0 var(--mad-linha);
```

> O degrau ocupa 6 px **abaixo** da caixa. Quem empilha quadros precisa de `gap` ≥ 14 px
> (`.col` usa 16) ou eles se encostam.

### Botão

Duas medidas, mesma receita — só muda a espessura da moldura e a altura.

| | moldura | altura | contorno do texto |
| --- | --- | --- | --- |
| **Grande** (`.menu-topo button`) | 2+2+2+2 = 8 px | 70 px | 2 px |
| **Pequeno** (todo o resto) | 2+2+1 = 5 px | 30–38 px | 1 px |

Para entrar na família, basta somar o seletor às três listas do bloco
_"Botão pixel pequeno"_ em `estilo.css` (base, `:hover`/`:active`, e a variante apagada).

```css
color: #fff;
text-shadow:                    /* contorno de 4 pontos — a assinatura do estilo */
  -1px -1px 0 var(--rx-esc), 1px -1px 0 var(--rx-esc),
  -1px  1px 0 var(--rx-esc), 1px  1px 0 var(--rx-esc);
background: linear-gradient(180deg,
  var(--rx-luz) 0 6px, var(--rx-esc) 6px 13px, var(--rx) 13px calc(100% - 13px),
  var(--rx-clr) calc(100% - 13px) calc(100% - 7px), var(--rx-rosa) calc(100% - 7px) 100%);
```

**Roxo = ligado.** Abas, chips e filtros sem `.on` viram madeira (a variante apagada faz
isso sozinha via `:not(.on)`). `:active` afunda 2–3 px e come o degrau.

### O × de fechar — **um** desenho para o jogo inteiro

Todo botão que FECHA alguma coisa é o mesmo botão pequeno: quadrado de **36 px** (42 no
celular), `font-size: 19px`, glifo `×` — e nada de próprio além do tamanho e da posição.
Hoje são o `.modal-topo button` (todos os modais, a Bolsa entre eles), o `.cm-fechar` (as 17
folhas que abrem por cima de um modal: Oferenda, Lixeira, anúncio do Mercado, Caixas,
Treino, equipe do PvP/Campeonato, XP Share, Casas…), o `.cmp-fechar` (o painel de item do
Mercado, 32 px por viver dentro de um vão) e o `.discord-popup-fechar`.

A regra existe porque esses botões **aparecem juntos**: a folha abre POR CIMA do modal, e os
dois × ficam a poucos pixels um do outro. Quando cada um tinha a própria receita — um com
moldura de três anéis, outro um quadradinho roxo chapado com filete de 1 px — a tela contava
ao jogador que foram feitas por duas pessoas que não se falaram. Botão novo de fechar entra
nas três listas do _"Botão pixel pequeno"_ e só declara tamanho.

A altura mínima da família é **32 px**: abaixo disso as paradas fixas do degradê (6 px, 13 px
de cima; 13 px, 7 px de baixo) se atropelam e o botão perde as faixas. Quem precisa de menos
usa a versão comprimida do `.pp-x` (20 px, paradas de 3 px e 7 px), no cartão do Pocket.

### Interruptor — **todo** checkbox do jogo

Checkbox nativo está banido. A regra é global (`input[type="checkbox"]`), então basta
escrever o `<input type="checkbox">` de sempre que ele já nasce interruptor — sem classe,
sem JS, sem mudar o HTML.

O próprio input vira o trilho (`appearance: none`) e o `::before` é a manopla. `:checked`
continua sendo o estado de verdade, e clicar no `<label>` que envolve o input continua
alternando. Apagado = madeira sobre vão escuro; ligado = manopla roxa sobre `--rx-esc`.

Trilho 46×24, manopla 16×16 correndo de `left: 4px` a `left: 26px`.

### Painel recolhível — Equipe, Automações, chat

Três painéis fecham e viram uma fita só de cabeçalho: `#p-equipe`, `#p-auto` e `#p-chat`. A
receita é a mesma nos três — `.painel-cab` com o título à esquerda e um `.btn-painel-toggle`
à direita, corpo num `<div>` próprio que some com `.recolhida` no painel. O estado mora no
`localStorage` (uma chave por painel), porque é escolha sobre a MESA e não sobre o jogo.

O chat é o de sempre a exceção (§5): o botão dele é vidro e dourado, não madeira, e o
"cabeçalho" é a própria barra de canais — que fechada continua mostrando os selos de
não-lidas. Fechar o chat sem poder ver que alguém falou seria fechar às cegas.

**O arranjo da coluna da direita sai sozinho das duas chaves**, e é por isso que não há uma
terceira dizendo "modo estreito":

| Automações | Chat | O que acontece |
| --- | --- | --- |
| aberta | aberto | como sempre: coluna de 306 px |
| **recolhida** | aberto | o chat é o `.cresce` da coluna e herda a altura |
| aberta | **recolhido** | o chat vira a fita das abas; a coluna fica curta |
| **recolhida** | **recolhido** | entra `html.dir-min`: a coluna vira um RAIL de ícones de 54 px que cabe INTEIRO na faixa da barra de menu — e aí o palco herda a coluna toda |

**Por que rail e não uma fita escrita mais estreita.** Com o rótulo por extenso o piso é
~220 px — abaixo disso "AUTOMAÇÕES" corta palavra. Só que 220 px de coluna com 110 px de
conteúdo deixa meia tela de vão vazio ao lado do palco, que é exatamente o que fechar os dois
painéis deveria ter resolvido. Sem a palavra, o piso passa a ser o ALVO DO DEDO: 44 px de
botão dentro de 54 px de coluna.

O nome vira desenho, e os dois desenhos são os **mesmos da barra de abas do celular**
(`SVG.auto` e `SVG.chat`, em [`mobile.mjs`](mobile.mjs)) — quem joga nas duas montagens não
tem de aprender dois símbolos para a mesma coisa. O que o rótulo dizia passa para o `title`.

No rail o botão do chat deixa de ser um controle DENTRO da moldura do chat e vira o painel
inteiro, então volta ao vocabulário da casa (vão sobre madeira) em vez do vidro do §5 — dois
quadrados lado a lado com acabamentos diferentes leriam como componentes sem parentesco.

**Nenhum dos dois pode custar a informação que o painel aberto dava**, então cada quadrado
leva uma plaquinha de canto (`.painel-ico-selo`, o desenho do `.mk-nv` do mapa): `3/5` de
automações ligadas, e a SOMA de não-lidas dos canais do chat — no rail as abas somem, e com
elas os selos por canal.

**O prumo com a barra de menu, e por que ele vale largura.** A fita recolhida das Automações
tem a altura EXATA da barra de menu, e no rail os dois quadrados somados dão essa mesma altura.
Não é capricho de alinhamento: as duas colunas usam o mesmo `gap`, então acertar o primeiro
quadro acerta todos os de baixo — é isto que faz o chat começar na MESMA linha em que o palco
começa. E, no rail, é isto que faz o resto da coluna da direita ficar VAZIO da linha do palco
para baixo — daí o palco poder invadi-la com um `margin-right` negativo e recuperar os 54 px
da coluna mais os 10 px do `gap`.

A altura sai de `--menu-alt`, MEDIDO em JS (`medirAlturaDoMenu`, com `ResizeObserver`) e não
escrito à mão: a barra encolhe em três degraus de `@media` e, abaixo de 1280 px, quebra em
duas ou três fileiras. Por isso o prumo no pixel só vale acima de 1280 px — casar dois
quadrados de ícone com um bloco de 216 px daria a cada um 100 px de vão vazio em volta de um
desenho de 17 px. Abaixo disso as fitas voltam à altura natural, e o palco continua invadindo
(o que a invasão exige é o rail CABER na faixa, não ser do tamanho dela).

A largura é uma VARIÁVEL (`--col-dir`) e não uma segunda regra de `grid-template-columns`:
assim a transição interpola de um número para o outro, e o `@media` do celular — que passa a
coluna única — continua ganhando sem precisar desfazer nada.

No celular não existe recolher: cada painel já mora numa gaveta que fecha inteira (§8). As
regras ficam atrás de `html:not(.mobile)` e os dois botões somem no `mobile.css`.

### Vão — listas, barras, cartões, campos de texto, chat, canvas

Buraco na tábua: filete escuro por dentro, fio claro por fora embaixo.

```css
background: var(--vao); border: 0; border-radius: 6px;
box-shadow: inset 0 0 0 2px var(--mad-linha), 0 1px 0 var(--mad-luz2);
```

Item selecionado ganha um anel roxo como segundo inset:
`inset 0 0 0 4px var(--rx)`.

---

## 3. Tipografia

**Tahoma Bold** em tudo que é interface — é a `GameFont` do original
(`TAHOMABD.TTF`), e já vem no Windows.

```css
font-family: Tahoma, Verdana, "Segoe UI", sans-serif;
font-weight: 700;
```

Título (`h3` de painel, `h2` de modal): branco, caixa alta, contorno de 4 pontos em
`--mad-base`. Texto de botão: branco, contorno em `--rx-esc`. Corrido: `--sobre-mad`.

---

## 4. Gradientes: px, não %

Escreva as faixas em **pixels absolutos** com `calc(100% - Npx)`, nunca em porcentagem.
Em % o desenho estica junto com a altura e a moldura descola do miolo quando o mesmo
botão muda de tamanho no celular.

---

## 5. A única exceção: o chat

O chat **não** usa madeira/roxo/Tahoma. É uma tela de vidro escura com moldura dourada,
encaixada na tábua — vocabulário próprio, tokens próprios (`--ch-*` no `:root`) e as duas
fontes de `fontes/`.

A razão é de leitura. Todo o resto da interface é **rótulo**: palavra curta, escrita por
nós, num lugar fixo que a pessoa já decorou. O chat é a única parte que é **conteúdo** —
rola sozinho, vem de estranhos, mistura três idiomas e se lê em bloco de vinte linhas. O
que faz um botão saltar (Tahoma bold com contorno de 4 pontos sobre bege) vira ruído
ilegível nesse volume, e o amarelo puro sobre preto é o contraste máximo disponível.

Daí as duas quebras, e elas valem **só aqui**:

| Regra | O que o chat faz | Por quê |
| --- | --- | --- |
| moldura por `box-shadow: inset` | `border-image` de verdade | o filete dourado é um gradiente vertical; `box-shadow` só desenha anel chapado |
| Tahoma bold com contorno | Barlow (fala) e Cinzel (abas) | ver acima — é conteúdo, não rótulo |

O que **continua** valendo: cor só por variável de `:root`, e o quadro externo do chat é o
`.painel` de madeira de sempre. O chat é o miolo, não a moldura.

As fontes entram por `node tools/fetch-chat-fonts.mjs` (SIL OFL 1.1, versionadas em
`fontes/` — ao contrário dos sprites, estas são nossas para redistribuir).

**Nada mais no jogo herda essa exceção.** Tela nova é madeira/roxo/Tahoma; se parecer que
precisa do vidro, o critério é o de cima — a tela é conteúdo corrido de terceiros, ou é
rótulo nosso?

---

## 6. Regras de ouro

1. Cor só via variável de `:root`.
2. Moldura só via `box-shadow: inset` empilhada — `border` está banido na UI.
   Checkbox nativo também: todo `input[type="checkbox"]` já vira interruptor sozinho.
3. Texto de interface é sempre Tahoma bold com contorno de 4 pontos (menos o chat — §5).
4. Ícone dentro de botão ganha plaquinha: `box-shadow: 0 0 0 4px <cor>, 0 0 0 6px <escura>`
   (spread não ocupa espaço, então não quebra a conta do recorte do atlas).
5. Ao estilizar um elemento com `background-image` (sprite do atlas), use
   **`background-color`** — o atalho `background` apaga a imagem.
6. Ícone novo entra por `tools/fetch-ui-icons.mjs`, nunca baixado na mão — o espelho é
   gitignorado e o script recorta a margem transparente (sem isso o desenho fica minúsculo
   dentro do quadrado do ícone).
7. Tela nova nasce nas DUAS montagens: confira no desktop **e** no celular (§8).
8. Confira na tela: `node tools/tela.mjs saida.png [modal] [seletor]` e
   `node tools/tela-mobile.mjs saida.png [modal]`.
   Depois rode `node tools/teste-ui.mjs`, `node tools/teste-movel.mjs` e `node tools/teste-market.mjs`.

---

## 7. Onde fica cada coisa em `estilo.css`

| Seção | O quê |
| --- | --- |
| `:root` | paleta (madeira/roxo/vão) + os tokens `--ch-*` do chat |
| `@font-face` | Barlow e Cinzel, logo depois do `:root` |
| `login` | tela de entrada |
| `app` / `.painel` | grid e o quadro base |
| **peças pixel reutilizáveis** | campo de texto, botão pequeno, variante apagada |
| `treinador`, `pokémon`, `gavetas` | coluna da esquerda |
| `centro/jogo` | menu do topo, palco, HUD |
| `direita` | automações + o recolhimento da coluna (`html.dir-min`) |
| `chat` | o bloco inteiro do chat — vidro, abas, fala, emoji, entrada (§5) |
| `modal`, `mapa-múndi`, `starter` | telas sobrepostas |
| `oferenda (aba da bolsa)` | a roda, a legenda, as cinco casas e o topo da carga: "Auto Selecionar" em roxo (`.ofr-auto`, é ação) ao lado do "Esvaziar" em madeira. Na folha de escolha, a faixa `.ofrpk-auto` fica entre os filtros e a grade e diz de onde o botão escolhe |
| `a Coleção` | o antigo cadeado de venda, em OURO (não é interruptor, então não é roxo): a setinha SVG (`.seta-colecao`, espelhada na volta) no card da venda (`.mk-colecao`) e na linha do Depot (`.pl-colecao`, aparece no hover como o `.pl-mover`), a ★ nos seletores (`.pk-colecao-marca`, quina de cima à direita) e nas linhas (`.pl-colecao-marca`), as abas Depot \| Coleção dos guardados (`.depot-lado`, a gramática do PvP) e a aba Coleção da Bolsa (`.colb`). O filtro "Local" é um campo a mais de `criarFiltrosSelect` (`.filtros-select-local`). A folha de equipe do PvP e da guerra (`.eqf`) é a da DM com a fileira das cinco casas em cima (`.eqf-casa`, com ◀ × ▶) e o rodapé do salvar |
| `o painel da Guild` | a faixa de identidade (`.gld-banner`: brasão de 62 px, nome, dono e o chip do bônus), as três placas de número (`.gld-stat`, a terceira é botão e leva a setinha `›`), as abas (`.gld-aba`, na família do botão pequeno) e os blocos de assunto (`.gld-bloco`, com `.gld-perigo` em anel laranja para o que não tem volta). A lista de membros (`.gd-membro`) é a MESMA da ficha pública do ranking, e as ações do dono moram dentro do membro aberto (`.gd-acoes`). O editor do TIME é o `.gesc-*` |
| `o Campeonato` | cabeçalho de torneio, a faixa da equipe do inscrito (`.camp-eq`: cinco casas com sprite, borda laranja sem equipe e roxa com ela), abas, cards de inscrito, a chave (colunas ligadas por linhas) e o pódio. A folha "Selecionar minha Equipe" (`.campeq`) é a do anexo da DM (`.dmpk`) com as marcas da Oferenda e um rodapé de salvar |
| `mobile` | os degraus de menu para notebook estreito (1600 → 1100 px) |

O **celular** não está aqui: é um arquivo à parte, [`mobile.css`](mobile.css). Ver §8.

---

## 8. O celular

O jogo tem **duas montagens da mesma tela**, e só uma delas está viva por vez.

No desktop, três colunas: status à esquerda, batalha no meio, automações e chat à direita.
Num telefone há 390 px de largura — e a resposta *não* é empilhar as colunas numa página que
rola. A batalha é o produto; ela some no primeiro rolinho, e chegar ao chat custa três dedadas.

A montagem de celular é um **aplicativo**, não um documento: a janela inteira, sem rolagem de
página, com a cena ocupando tudo que sobra e o resto numa **gaveta** que sobe do rodapé.

```
┌──────────────────────────┐
│ retrato · nick · moedas  │  cabeçalho: o HUD do treinador comprimido
├──────────────────────────┤
│                          │
│      C E N A             │  toda a altura que sobrar
│                          │
├──────────────────────────┤
│  gaveta (aba escolhida)  │  altura arrastável, fecha por completo
├──────────────────────────┤
│ Equipe Bolsa Auto Chat ≡ │  barra de abas, à mão do polegar
└──────────────────────────┘
```

### As três regras

**1. Mover, nunca copiar.** [`mobile.mjs`](mobile.mjs) não desenha painel nenhum: ele
**realoca os nós que já existem**. O painel da equipe, a bolsa, as automações, o chat e a barra
de menus saem das colunas e entram nas gavetas. É o que faz o `app.js` continuar funcionando
sem saber que existe celular — ele segue escrevendo em `#time`, `#itens`, `#chat-msgs` pelos
mesmos ids, e não importa em que caixa esses ids estejam.

Uma cópia dos painéis daria a mesma tela por um dia e duas telas divergentes por um ano.

Cada movimento anota de onde o nó veio, então a montagem é **reversível**: girar um tablet (ou
desligar o layout nas Configurações) devolve tudo ao lugar sem recarregar a página.

**2. Tudo pende de `html.mobile`.** Todo o `mobile.css` está atrás dessa classe, que só o
`mobile.mjs` acende. Sem ela o arquivo inteiro é regra que não casa com nada: o desktop não paga
sequer um repinte, e não há media query que possa mudá-lo por acidente.

**3. O vocabulário é o mesmo.** Tábua, botão roxo, vão escuro, Tahoma bold com contorno de
quatro pontos, cor só por variável de `:root`. O que muda no celular é a ARRUMAÇÃO, não a
identidade. A barra de abas é a mesma gramática dos filtros (`.on` = roxo = ligado); a gaveta e
os modais são a mesma tábua com o canto de cima arredondado.

### Quem é "celular"

Duas condições, e nenhuma delas é o user-agent (que mente e envelhece a cada aparelho novo):

```
(pointer: coarse) and (max-width: 1024px)   dedo numa tela que não é de mesa
(max-width: 720px)                          janela onde três colunas não cabem
```

O jogador pode desligar no interruptor das Configurações (`cfg-movel`), e `?movel=1` / `?movel=0`
forçam a montagem sem aparelho — é como se confere uma das duas no navegador de mesa.

### O que muda de comportamento (e não só de lugar)

| No desktop | No celular | Por quê |
| --- | --- | --- |
| menu do topo, uma barra | grade de 2 na gaveta "Menu" | dez destinos não cabem numa fita de 390 px |
| trocar de área pelo Mapa | a plaquinha da hunt, na cena, É o botão do Mapa | é a única navegação que nasce de olhar a batalha |
| ficha da área no *hover* do marcador | abre no TOQUE, com um botão "Caçar aqui" | sem hover, tocar trocaria de área antes de ler a análise |
| filtros do Mapa e do Mercado sempre abertos | recolhidos atrás de "Filtros" | os 18 selos de tipo empurravam o resultado para fora da dobra |
| barra do Mercado: seis botões escritos | busca + funil + "+", e quatro atalhos de ícone com rótulo miúdo | escritos, eles comiam ~300 px e a vitrine abria com uma fileira e meia de card |
| Market: categorias numa coluna de 140 px | fita de chips no alto da rolagem, e o card quadrado vira LINHA | a coluna comia 36% da tela com quatro quintos dela vazios |
| Ranking: pódio de três colunas | um HERÓI (1º deitado, linha inteira) e dois em pé embaixo | em 113 px o 3º saía da tela e nenhum dos três cabia o número de XP |
| folhas de escolha de pokémon (anúncio, DM, Oferenda, equipes, Coleção, venda do Market): filtros em linha | busca + funil com bolinha (`dobrarFiltrosNoCelular`), folha de filtros por cima com "Limpar" e "Pronto" | os ~300 px de filtros deixavam a grade com um card à vista — nenhum, na equipe do PvP |
| a folha de escolha é uma caixa de 560 px no meio | ocupa a altura da tela, e o card fica compacto (~120 px, o (i) na quina de cima) | o motivo da folha é a grade: agora cabem oito a dez cards |
| casas da equipe com ◀ × ▶ de 20 px | tocar a casa a marca; as ações vão para uma barra de botões de 40 px logo abaixo | três botões não cabem no dedo numa casa de ~60 px |
| texto de regra por inteiro | duas linhas com degradê, abre no toque (`dobrarNotaNoCelular`) | a regra da guerra comia 110 px antes da primeira casa |
| roda do mouse dá zoom | pinça, no mapa e na batalha | não existe roda |
| painel de derrotados em coluna | fileira que rola de lado, rente à base | 216 px de coluna são metade da tela |
| modal centrado | folha que sobe do rodapé | o conteúdo cresce de onde o polegar está |
| `100vh` | `visualViewport` → `--m-alt` / `--m-off` | `100vh` não encolhe com o teclado nem com a barra de endereço |
| campos de 12 px | **16 px, sem exceção** | abaixo disso o Safari dá zoom sozinho e não desfaz |

### Antes de mexer

`node tools/teste-movel.mjs` (ou `npm run test:movel`) exercita a montagem num Chrome em modo
de aparelho: liga/desliga, ids únicos, nada estourando a janela, alvos de 40 px, campos de
16 px, a janela curta do teclado e o Mapa. `node tools/tela-mobile.mjs saida.png [modal]`
tira o print — `APARELHO=iphone|android|android-pequeno|ipad|deitado`.

`node tools/teste-colecao-movel.mjs` (`APARELHO=…`, `PRINT=pasta`) é o teste de usabilidade das
folhas de escolha: abre cada uma com uma conta cheia (equipe, depot, Coleção, guild, amigo,
campeonato) e confere largura, alvos de dedo, campos de 16 px, quantos cards aparecem sem rolar,
a folha de filtros (abre, acende a bolinha, limpa, fecha) e a barra das casas da equipe.
