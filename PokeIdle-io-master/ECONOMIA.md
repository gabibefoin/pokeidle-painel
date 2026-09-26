# ECONOMIA DE COINS

Como a renda de coin é formada, por que ela foi refeita, e onde mexer.

Este documento **descreve o que está no código**. A régua viva é
`node game/tools/auditoria-renda-hunt.mjs`, que remonta o grafo inteiro — 742 hunts, 1.209
espécies, 296 itens vendáveis — das mesmas fontes que o servidor lê no boot e compara a renda
real de cada hunt contra o alvo. Quando os dois divergirem, a ferramenta está certa e este texto
está velho.

---

## 1. O diagnóstico

Duas curvas emendadas, erradas na mesma direção.

| faixa | fórmula | o que dava |
|---|---|---|
| Kanto/Johto (n ≤ 150) | `experience` = 0,6·n² | 8 coins/kill no nv 1 · 13.508 no nv 150 |
| Hoenn+ (n > 150) | `12.000·(n/150)^0,6` | **787.928** no nv 160.300 |

**Amplitude do ouro por abate: 98.491×.** Com preço de loja parado, isso é poder de compra
multiplicado por 98 mil do começo ao fim.

**E o loot não acompanhava — ele sumia.** A fatia do drop na renda caía de 67% no nível 1 para
**0,0%** no topo. Das 233 espécies acima do nível 25.000, só 45 largavam algo que o NPC compra,
com valor esperado médio de **6 coins por abate**. Quem passava do nível 100 parava de olhar
para o chão.

**Havia ainda uma segunda torneira.** `sellValueBaseDe` seguia a mesma curva de ouro, então
vender pokémon capturado ao NPC pagava 787.928 de base no topo — com `autoBallSemParar` ligado,
consertar só a kill teria mudado a torneira de lugar, não fechado.

---

## 2. O desenho

Três peças, e elas só funcionam juntas.

### 2.1. Uma curva só de ouro, travada no nível 25.000

Antes eram duas emendadas: `especie.experience` (= `0,6·n²`) em Kanto/Johto e
`12.000·(n/150)^0,6` em Hoenn+. A mesma faixa de nível valia coisas diferentes conforme a
região, e o degrau da emenda era onde a inflação nascia.

Agora é uma lei de potência só (`ouroPorKillDoNivel`, em `shared/sell-value.mjs`), ancorada em
**dois pontos de produto**:

```
nível 1     →     36 coins        (antes 8 — o começo era escravidão literal)
nível 5.000 →  6.000 coins
```

O expoente não é escolhido: ele cai desses dois números — `ln(6000/36)/ln(5000)` = **0,6007** — e
está derivado em código de propósito. Mexer na curva é mexer nas duas âncoras, que são as coisas
sobre as quais alguém consegue ter opinião. Por coincidência boa, 0,6007 é praticamente o 0,6
que a curva de Hoenn+ já usava: a forma estava certa, a altura e a emenda é que não.

A curva **para de crescer no nível 25.000**, em **15.776**. Do 25.000 para cima todo abate paga
o mesmo, em qualquer região.

**O XP não leva teto.** De propósito: o motivo de subir de área continua sendo a velocidade de
nível. Cortar os dois juntos tiraria a razão de existir do late game.

### 2.2. O drop é a outra camada

```
renda alvo = 1,15 · ouro(n)                      n ≤ 25.000     → o drop é 13% da renda
renda alvo = 1,15 · 15.776 · (n/25.000)^0,30     n > 25.000     → o ouro congelou, o drop cresce
```

Abaixo do teto o drop é camada **fina e constante**: 13%. Não é enfeite — é o que mantém o loot
valendo alguma coisa em Hoenn, Sinnoh, Unova e Kalos, onde ele era 0,1% da renda e o jogador
tinha razão em ignorá-lo. Mas ali quem manda é o ouro, que é o que a curva promete.

Acima do teto o drop assume o crescimento. O expoente 0,30 foi escolhido para uma coisa só: na
hunt mais alta do jogo o drop responde por **metade** da renda. Do teto ao topo a renda cresce
1,75×, contra 6,4× de escada de nível — com preço de loja parado, 6,4× de nível não pode virar
6,4× de poder de compra.

`shared/economia-drop.mjs` resolve, espécie a espécie, a tabela de loot que fecha esse alvo.
Medido, em hunts cujo marcador bate com o nível das espécies:

| nível | hunt | ouro/kill | drop/kill | total | drop% |
|---|---|---|---|---|---|
| 1 | caterpie | 36 | 12 | 48 | 25% |
| 30 | butterfree | 278 | 42 | 320 | 13% |
| 100 | houndoom | 572 | 84 | 656 | 13% |
| 500 | zigzagoon_hoenn | 1.505 | 202 | 1.707 | 12% |
| 1.000 | ditto_sinnoh | 2.282 | 409 | 2.691 | 15% |
| 5.000 | snivy_unova | 6.000 | 846 | 6.846 | 12% |
| 25.000 | litten_alola | 15.776 | 2.317 | 18.093 | 13% |
| 160.300 | tinkaton_alola | 15.776 | 16.000 | **31.776** | **50%** |

**96,3% das 1.209 espécies ficam dentro de ±10% do alvo**, 85% dentro de ±5%.

O solver mexe **só na quantidade**, nunca na chance: a chance é o sabor da espécie (o Dragonite
larga Dragon Scale quase sempre e Crystal Stone quase nunca) e isso é curadoria que não se joga
fora por uma conta. A quantidade não carrega sabor — "3 Dragon Scale" e "40 Dragon Scale" contam
a mesma história —, e o EV é linear nela, então o alvo fecha sem tocar em uma probabilidade
sequer. Ela anda nos **dois sentidos**: o espelho traz quantidades que são acidente de
importação (o Mightyena largava `Dark Gem ×103-4467`, um item de 1 coin, valendo dez vezes a
renda da faixa em ruído ilegível), e cortá-las é tão necessário quanto subir as outras.

A quantidade tem teto (20), e o que sobra vai para um slot raro a 5%: a **Rare Pokémon
Picture**, 5.000 coins. É o item mais caro que o NPC de fato compra, **não caía de espécie
nenhuma** — então promovê-la não inflou nada que já existia — e o nome já diz o papel. Espécie
sem nada vendável ganha antes o item do tipo elemental dela, com a chance resolvida contra o
alvo daquele nível.

> **A ECONOMIA.md antiga propunha pedra de evolução como jackpot do alto nível. Está errado:**
> o `npcPrice` das pedras é zerado por `normalizarNpcPriceItem` — quem paga por pedra é a
> comunidade, não o NPC. O teto real do que o NPC compra era 1.000 coins até a Picture entrar.

### 2.3. A venda de pokémon ao NPC ganha teto

`TETO_SELL_POKEMON` = 6 × o teto da kill = **94.656** de base. Depois dos multiplicadores de
`precoVendaPokemon` (nível ÷ 50 e qualidade), um capturado no teto de captura sai por volta de
**10 abates**. Um pokémon vale um punhado de kills, não uma hora delas. A relação é com o teto,
então ela se reajusta sozinha se as âncoras da curva mudarem.

O teto entra em `sellValueBaseDe` e **não** em `valorEconomicoDe`: aquele também é a régua de
raridade na captura, e achatá-lo faria as espécies do topo virarem todas igualmente comuns.

---

## 3. O teto da poção — resolvido

Era o furo que nenhum ajuste de drop fechava. `maxHp` cresce linear com o nível e a cura das
poções era um número FIXO (60 … 3.000), então a fração de vida que a melhor poção cobria
desabava: 243% no nível 100, **0,2%** no 160.300. Entre o nível 150 e o ~4.850 a poção chegava a
custar 463% da renda.

**A Golden Potion fechou.** Ela cura **20% do HP máximo** por 2.500 coins, e cura percentual não
envelhece: o custo de se manter vivo vira

```
12% de HP perdido por kill ÷ 20% curado × 2.500 = 1.500 coins por abate, em qualquer nível
```

É um número **fixo**, e é isso que deixa a renda ser quase plana sem quebrar a sustentabilidade.

| nv | renda | HP/kill | poção usada | custo poção | % da renda | saldo |
|---|---|---|---|---|---|---|
| 1 | 41 | 1 | Small | 6 | 15% | 32% |
| 30 | 320 | 45 | Small | 37 | 12% | 82% |
| 100 | 658 | 148 | Hyper | 119 | 18% | 74% |
| 1.000 | 2.624 | 1.483 | Ultimate | 742 | 28% | 67% |
| 5.000 | 6.900 | 7.416 | **Golden** | 1.500 | 22% | 77% |
| 25.000 | 18.142 | 37.080 | **Golden** | 1.500 | 8% | 90% |
| 160.300 | 31.681 | 237.757 | **Golden** | 1.500 | 5% | 94% |

O jogador se sustenta desde o primeiro minuto — 32% de saldo no nível 1, contra os **−3.600%**
de antes, quando ele precisava de 600 abates para pagar um revive.

Perfil: 12% do maxHp perdido por kill, 2 bolas e 0,02 revive por abate. As duas premissas de
consumo continuam **derivadas das fórmulas, não medidas em jogo** — calibrar com telemetria
antes de mexer em qualquer número.

---

## 4. Os sumidouros

Foram re-ancorados porque a renda mudou de patamar. Antes, a Ficha PvP custava **3.700 abates**
para quem estava no nível 100 e **4** para quem estava no 25.000 — 900× de diferença de esforço
pelo mesmo preço. Com a curva nova essa distância cai para 46×, e os preços abaixo ficam entre
"alguns minutos" e "meia hora" de caçada em toda a faixa em que cada coisa é usada.

| sumidouro | era | é | em abates |
|---|---|---|---|
| Ficha PvP (`game/pvp.mjs`) | 1.000.000 | **250.000** | 370 no nv 100 · 8 no topo |
| Estadia diária do pokémon no Mercado (`market-db.mjs`) | 50.000 → 15.000 | **100.000** | 152 no nv 100 · 5,5 no topo |

> **A estadia levou um segundo ajuste, e por outro motivo.** O re-ancoramento acima a deixou em
> 15.000 — dois a três abates, que na prática não freava nada: trinta dias de vitrine saíam por
> 450.000, troco para quem anuncia, e a feira voltou a encher de bicho caro e parado. A 100.000 o
> mês inteiro custa 3.000.000, e segurar preço alto passa a ter conta. Só POKÉMON paga; item não
> paga diária nenhuma.

**Bola, poção e revive não mudaram de preço** — é a escada que o jogador já conhece, e mexer
nela seria cobrar da comunidade o conserto de um problema que não é dela. A única exceção é o
Max Revive (2.500 → 5.000), que subiu junto com a entrada da Golden Potion e por outro motivo:
a 2.500 ele era só o dobro do Revive comum e não havia razão para comprar o comum.

---

## 5. Onde isso mora no código

| arquivo | papel |
|---|---|
| `shared/sell-value.mjs` | a curva de ouro (`ouroPorKillDoNivel`), as duas âncoras, o teto e `TETO_SELL_POKEMON` |
| `shared/recompensa-hunt.mjs` | aplica a curva no ouro da kill — uma régua para todas as regiões |
| `shared/economia-drop.mjs` | a curva alvo e o solver de loot |
| `server/content.mjs` | roda o solver no boot, depois de `TIPO_DO_ITEM` |
| `client/app.js` | roda o MESMO solver na etapa `carga.itens` |
| `server/game/pvp.mjs`, `server/market-db.mjs` | os dois sumidouros |
| `tools/auditoria-renda-hunt.mjs` | a régua: renda medida × alvo, hunt a hunt |
| `tools/auditoria-catalogo-duas-pontas.mjs` | garante que cliente e servidor contam a mesma história |

O solver roda **nas duas pontas** porque o cliente monta o catálogo dele do zero dos mesmos
JSONs e a Pokédex desenha o loot direto de `especie.loot` — loot que só o servidor conhecesse
apareceria na hunt e não na ficha. É a mesma razão pela qual evolução, teto de captura e
`drops-nossos` moram em `shared/`.

---

## 6. O que ficou de fora

Duas dívidas de **conteúdo**, não de economia. Nenhuma foi criada aqui; as duas ficaram visíveis
porque agora a renda depende do nível da espécie.

**29 hunts têm marcador acima de 3× o nível das espécies que elas spawnam.** `flabebe_kalos` tem
marcador 10.000 e um Flabébé de nível 40 dentro; `lucario_sinnoh` tem marcador 2.000 e um Lucario
de nível 80. A renda segue o MOB, não o marcador — pagar pelo marcador daria a melhor fazenda do
jogo a quem mata bicho de nível 40 —, então essas hunts pagam pouco até alguém acertar o nível
delas. A auditoria de renda lista as 29.

**25 espécies têm `huntLevel` diferente entre cliente e servidor.** `AJUSTE_HUNT_LEVEL` (dentro
do `content.mjs`) e o degrau que `dados/hunts-sinnoh.json` aplica são dados que só o servidor lê
— Ditto 1 → 1.000, Eevee 20 → 1.000, Blissey 100 → 1.125. A Pokédex já mostrava XP e valor de
venda errados nessas espécies antes disto; agora mostra o loot antigo também. O conserto é levar
as duas fontes de nível para `shared/`, como já aconteceu com todo o resto. A auditoria das duas
pontas conta essa dívida em linha separada, para o zero dela continuar significando "bug novo".
