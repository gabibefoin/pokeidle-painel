# Mecânicas de Poke Idle World — fórmulas e constantes

Tudo aqui foi extraído do **bundle público do cliente** (o módulo de matemática compartilhado
e o texto de ajuda embutido no i18n) e conferido contra os dados públicos. Cada seção diz de
onde veio e o que foi verificado. A versão em dados fica em
[public/data/index/formulas.json](public/data/index/formulas.json), gerada por
[tools/build-formulas.mjs](tools/build-formulas.mjs).

O módulo do cliente exporta: `totalXpForLevel`, `levelProgress`, `typeEffectiveness`,
`computeStats`, `computePower`, `rollQuality`, `rollGrowthSet`, `rollShinyGrowthSet`,
`combatHp`, `qualityInfo`.

---

## 1. XP e níveis

```
xpTotal(L) = round( 50/3 × (L³ − 6L² + 17L − 12) )        para L > 1
xpTotal(L) = 0                                            para L ≤ 1
```

Essa é a "curva cúbica" — a função `g` do bundle, e o texto de ajuda do jogo cita a fórmula
literalmente. `levelProgress(xp)` faz busca binária nessa curva para achar o nível.

| Nível | XP total | Custo só desse nível |
|---:|---:|---:|
| 10 | 9.300 | 2.550 |
| 25 | 204.800 | 20.150 |
| 50 | 1.847.300 | 89.400 |
| 80 | 7.915.800 | 240.100 |
| 100 | 15.694.800 | 380.150 |
| 150 | 54.042.300 | 878.900 |
| 200 | 129.389.800 | 1.577.650 |
| 300 | 441.084.800 | 3.575.150 |
| 500 | 2.058.474.800 | 9.970.150 |
| 1000 | 16.566.949.800 | 39.940.150 |

**Não há nível máximo.** O texto de ajuda é explícito: *"There's no cap — the level is
infinite (the curve just gets more expensive)"*. Isso derruba a ideia de "level max em todos".

Fontes de XP, segundo a ajuda do jogo:

- **Kill**: cada espécie dá um XP fixo (campo `experience` em `creatures.json`), e esse mesmo
  valor vai **para o treinador E para o pokémon ativo** — dois níveis independentes.
- **Pokédex**: +25% de XP por espécie, bônus único, depois de 100 kills daquela espécie.
- **Multiplicadores** que somam por cima: VIP, XP Boost (+50%), Streak Points (+0,1% por ponto).
- Tasks, Quests e Game Pass também pagam XP.

XP por kill no catálogo: mínimo **8**, mediana **2.168**, máximo **19.508**
(Sceptile, Blaziken, Swampert, Mightyena, Ludicolo — hunts de nível 470–550).

### O pokémon não pode passar muito do treinador (NOSSO)

Os dois níveis são independentes, mas não soltos: um pokémon só entra em campo até
**5 níveis acima** do treinador (`FOLGA_NIVEL_POKEMON`, em `shared/pokemon-nivel-treinador.mjs`).
Acima disso o servidor recusa `team.active` — *"Charizard é nv 272 — você precisa ser pelo menos
nv 267 para usá-lo"*. O starter é a única exceção: ele passa sempre, senão quem escapasse dessa
faixa ficaria sem nenhum pokémon utilizável.

A folga de 5 níveis cobre o desencontro pequeno — o que ela **não** cobre é quem gasta boost de
XP no bicho em vez de na conta. Aí o melhor pokémon da coleção passa dezenas de níveis à frente
de uma vez e vira enfeite, e a única saída era subir milhões de XP de treinador com um pokémon
nível 1.

### Reduzir o nível: a saída (NOSSO)

A ficha do pokémon tem, abaixo de "Comparar com B", o botão **Reduzir o nível**:

| | |
|---|---|
| passo | **1 nível por clique**, com confirmação a cada um |
| piso | o **"Nível ao capturar"** da espécie — a mesma linha que a ficha dela mostra |
| custo | o XP volta para o **começo do nível novo** (`xpTotal(L)`); a faixa inteira do nível some |
| quem pode | só o dono, e só um pokémon que ainda esteja na coleção (anunciado no Mercado está em escrow e não conta) |

O piso é o nível ao capturar, e **não** o degrau da hunt, porque de Outland para cima os dois
deixam de ser o mesmo número: o teto de captura corta em 20/40/100 o que sai da bola (§4, *Teto
de nível na captura*). Um Tropius de hunt 600 entra na equipe no nível 100 — usar o degrau da
hunt lhe daria um piso de 600, acima de qualquer Tropius que exista, o que é o mesmo que não ter
botão. Em Kanto e Johto os dois coincidem, porque o teto só morde acima de 100:

| espécie | degrau da hunt | teto de captura | piso |
|---|---:|---:|---:|
| Charizard | 80 | 100 | **80** |
| Rhydon | 100 | 40 | **100** |
| Treecko | 20 | 20 | **20** |
| Tropius | 100 | 100 | **100** |
| Salamence | 850 | 100 | **100** |
| Blissey | 1.125 | 100 | **100** |

Quem monta o número é `pisoDeReducaoDaEspecie` (`server/content.mjs`): o MENOR degrau entre as
hunts em que a espécie aparece — o mesmo `nivelRef` da ficha —, passado por `nivelDeCaptura`.

O XP vai para o **piso** do nível novo, e não para um ponto logo abaixo do limiar: parar a um XP
da fronteira devolveria o pokémon ao nível de antes no primeiro abate, e o jogador continuaria
travado — só que agora sem o XP também. E **nunca para cima**: a gravação é
`min(xp de agora, xpTotal(nível novo))`. Em jogo normal o `min` não muda nada (`ganharXp` mantém
`level === nivelPeloXp(xp)`), e ele existe para o par que chega desencontrado por outro caminho —
sem ele, ali, perder um nível *pagaria* XP.

**A mensagem não leva quantidade.** `pokemon.reduzirNivel` carrega só `{ pokemonId }`: o passo é
constante no código dos dois lados, o nível de partida é o que o servidor tem em mão e o piso sai
do catálogo do servidor. Não há campo para um cliente adulterado preencher com `-40` e subir
quarenta níveis de graça — e, ainda assim, `nivelAposReducao` fecha a conta com um `Math.min` no
nível de agora, que é o que protege o caso de quem está **abaixo** do piso (um Charmander nv 5,
cujo nível ao capturar é 20): ali o `Math.max` sozinho devolveria o piso, isto é, uma subida de
quinze níveis. Regras e comentários em `shared/reduzir-nivel.mjs`.

Baixar nível nunca é vantagem em lugar nenhum do jogo: a Guerra de Guilds **capa** o nível em
150 (nunca põe piso), e ginásio, PvP ranqueado, preço de venda e ⚔ do ranking escalam com o
nível para cima. O único efeito é destravar o uso — e é por isso que a operação
não cobra nada além do próprio XP.

---

## 2. Tabela de tipos

Tabela completa 18×18, cópia literal do objeto do bundle. A função é:

```js
typeEffectiveness(atq, def1, def2) =
  (tabela[atq][def1] ?? 1) × (def2 && def2 !== def1 ? tabela[atq][def2] ?? 1 : 1)
```

Ou seja: multiplicativa nos dois tipos do defensor, e um tipo ausente da linha vale ×1.

### A amplificação da hunt (isto é específico deste jogo)

O texto de ajuda de "Combat on the Hunt" diz que a vantagem elemental é **50% mais
pronunciada, nos dois sentidos**:

```
efetivo = 1 + (base − 1) × 1.5     se base > 1
efetivo = base / 1.5               se base < 1
efetivo = base                     se base é 0 ou 1
```

| Base | Na hunt |
|---:|---:|
| ×0 | ×0 (imunidade não muda) |
| ×0,25 | ×0,167 |
| ×0,5 | ×0,33 |
| ×1 | ×1 (neutro não muda) |
| ×1,5 | ×1,75 |
| ×2 | ×2,5 |
| ×4 | ×5,5 |

Fogo contra Água: base ×0,5 → na hunt **×0,33**. Água contra Fogo: base ×2 → na hunt **×2,5**.
Água contra Rocha/Terra (×4) → **×5,5**.

### Outros modificadores de combate

| Modificador | Valor |
|---|---|
| HP do selvagem na hunt | **×5** do normal |
| Dano do selvagem | **×1,8** por golpe |
| HP de combate | `max(24, round(hp × (flag ? 7 : 12)))` — o cliente **só chama com a flag falsa**, ou seja ×12 |
| Bônus de clã | +6% por rank em ATK/SpATK/DEF/SpDEF dos elementos do clã (rank 5 = +30%) |

O ×12 está confirmado contra uma conta de verdade: o Charmander nível 11 de lá tem stat de HP
14 e mostra **168** de HP de combate — 14 × 12. Os dois pontos do bundle que chamam `combatHp`
passam `false`; o modo ×7 existe na função e não aparece em lugar nenhum do cliente.

Todo jogador novo começa com 100 Small Potions e 100 Poké Balls.

---

## 3. Stats, IV e Qualidade

```
stat  = round( (base + 2 × growth) × nível/100 × qualidade^expoente )
power = (hp + atk + def + spAtk + spDef + speed) × qualidade
```

O expoente da qualidade muda por stat: `hp` e `speed` usam **0,95**; `atk`, `def`, `spAtk` e
`spDef` usam **0,8**. É por isso que a ajuda do jogo diz que a Qualidade "aparece duas vezes"
(dentro de cada stat e de novo no Power) e pesa mais que o IV.

**Growth (IV)**: `1 + floor(32 × random())` → **1 a 32** por stat, 6 stats.
Fixos na captura; evoluir **não** rerola.

**Bandas de qualidade no roll de captura** (soma exata: 100%):

| Faixa | Chance | Rótulo |
|---|---:|---|
| 0,8 – 0,9 | 5% | Fraca |
| 0,9 – 1,0 | 5% | Fraca |
| 1,0 – 1,1 | 34,03846% | Comum |
| 1,1 – 1,2 | 20% | Incomum |
| 1,2 – 1,3 | 10% | Incomum |
| 1,3 – 1,4 | 10% | Rara |
| 1,4 – 1,5 | 10% | Rara |
| 1,5 – 1,6 | 5% | Épica |
| 1,7 – 1,8 | 0,67308% | Lendária |
| exatamente 1,800 | 0,28846% | Lendária (perfeita) |

O intervalo **1,6–1,7 é um buraco intencional** — nenhum pokémon nasce nele. Menos de 1%
passa de 1,7. Os tiers Mítica (2,0+), Anciã (3,0+) e Divina (4,0+) **não saem de captura
selvagem** (teto 1,8) — só shiny e reprodução.

**Shiny tem IV garantido alto**: o `rollShinyGrowthSet` rerola o set inteiro até a soma dos 6
IVs passar de **110** (máximo 192), com até 512 tentativas; se falhar, cai num set fixo de 19
em cada stat.

### O starter não usa esse roll (piso nosso, medido no jogo deles)

O Charmander nível 11 da conta de referência tem **168 de HP de combate e power 123** — dois
números que só fecham juntos com **qualidade ≥ 1,30** e soma de IVs perto de **180 de 192**.
Um roll de captura normal quase nunca chega perto disso: 10% dos sorteios caem na banda
"Fraca" (0,8–1,0), e foi exatamente o que aconteceu com o starter que motivou este piso —
qualidade 0,839, ATK 8 e DEF 6, **48 de power contra os 123 do de referência**.

Por isso `rolarStarter` (em [content.mjs](game/src/server/content.mjs)) tem piso:

| | Valor | Por quê |
|---|---|---|
| Qualidade mínima | **1,30** (Rara) | abaixo disso o starter não sobrevive à própria hunt |
| Soma de IVs | **> 140** | o de referência tem ~180 |
| Cada IV, isolado | **≥ 16** | só a soma deixava passar IV de HP 3 com o resto no teto: 84 de HP |

Resultado medido, Charmander nível 11 na hunt do Exeggcute: **168 de HP médio** (referência:
168) e 80% / 60% / 43% de HP restante contra selvagens nível 8 / 10 / 12 (referência: 79% /
62% / 47%). Capturado continua no roll livre — a qualidade pesar muito é design **deles**.

### 3b. Refino: o "+1" comprado com pedra (NOSSO)

A única coisa que mexe na **base** depois do nascimento. A conta do §3 vira:

```
stat = round( (base + refino + 2 × IV) × nível/100 × qualidade^expoente × mult )
```

Repare **onde** o refino entra: na base, antes de tudo. Ele é multiplicado por nível, qualidade
e potência como o resto — o mesmo degrau vale +1 num nível 100 comum e +4 num P5 shiny. É isso
que faz o sistema ser de endgame em vez de um atalho para quem está começando.

| | |
|---|---|
| Stats refináveis | **hp, atk, def, spAtk, spDef** — cinco |
| Passo | **+1** de base por degrau |
| Teto | **não tem.** `REFINO_TETO_TECNICO` (9.999) é guarda de aritmética, não limite de jogo |
| Total para ter `+N` | `500 × N³` pedras |
| Custo do degrau `N` | `500 × (3N² − 3N + 1)` — a diferença entre dois cubos |
| Moeda | a **pedra de evolução do tipo do próprio pokémon** (`pedraDeRefino`) |
| Onde mora | `player_pokemon.bonus_base` (jsonb); a regra em `src/shared/refino-stats.mjs` |

| Grau | Custo do degrau | Total investido | Dias de farm¹ |
|---:|---:|---:|---:|
| +1 | 500 | 500 | 2 |
| +2 | 3.500 | 4.000 | 16 |
| +3 | 9.500 | 13.500 | 54 |
| +5 | 30.500 | 62.500 | 250 |
| +8 | 84.500 | 256.000 | 1.024 |
| +10 | 135.500 | 500.000 | 2.000 |
| +15 | 315.500 | 1.687.500 | 6.750 |

¹ a 250 pedras/dia de UM tipo, que é o ritmo medido do topo do ranking hoje (`players.items`,
servidor com 16 dias). A renda cresce bastante conforme o jogador abre regiões melhores.

**Por que cúbica e não exponencial.** Dobrando (500 · 1.000 · 2.000 · 4.000 …) o número fica
bonito por seis degraus e depois vira piada: o décimo custaria 256.000 e o vigésimo, 262
milhões — existiria um **teto de fato por volta do +8, escondido dentro da fórmula**. A cúbica
sobe rápido o bastante para nunca inflacionar e devagar o bastante para o degrau seguinte
continuar sendo uma meta (o vigésimo custa 630.500, ~800× menos que dobrando). É por isso que
não há teto declarado: quem quiser continuar, continua — quem decide o ritmo é o preço.

**O custo é por stat, não por pokémon.** Quatro degraus em HP levam o quinto a 30.500, mas o
primeiro de ATK continua a 500. Refinar é escolher em que o bicho vai ser bom, não encher uma
barra.

**O SPD fica de fora.** `stats.speed` não entra em combate nenhum — quem decide cadência de
ataque é o **IV** de Speed (`cooldownComSpeed`, em [combate.mjs](game/src/server/game/combate.mjs)).
"+1 SPD" seria vender um número decorativo.

**A pedra é a mesma da evolução, mas a regra é mais larga:** `pedraDeRefino` não exige
`evolvesToId`, senão toda forma final (Dragonite, Blissey, Tyranitar) — justamente quem alguém
investiria — ficaria de fora do sistema. Shiny paga com a pedra **comum**: a Shiny Stone custa
10 fragmentos a 0,0005% de drop, e um degrau de 500 pediria 5.000 fragmentos.

**Nota e ⚔ não mudam.** Os dois medem *como o pokémon nasceu* e são normalizados contra as
bases da própria espécie — somar refino ali faria os dois números **caírem** (o ganho de IV
pesa relativamente menos quando a base cresce). O refino é um eixo à parte, mostrado como `+N`.

**Ordem de grandeza.** As pedras caem de 1% a 3,5% por abate dos pokémon do tipo (Water de 63
espécies, Fire de 42, Heart de 57), o que dá ~15 a 25 por hora de hunt. O primeiro degrau é
~um dia de farm; o quinto, ~duas semanas; o oitavo, inalcançável para quase todo mundo. A
exceção é a **Sun Stone** (tipo NORMAL), que só cai pela tabela do
[drops-nossos.mjs](game/src/shared/drops-nossos.mjs) a 0,3–0,6% — refinar um NORMAL custa umas
quatro vezes mais tempo que os outros dezessete tipos.

Refinar **tranca o pokémon na venda** (`travarPokemon`): um bicho com dezenas de milhares de
pedras dentro não pode sumir num clique de "vender o depot inteiro". Destravar continua a um
clique. Coberto por `tools/teste-refino.mjs` (`npm run test:refino`).

---

### 3c. Oferenda: pokémon do depot viram pedra (NOSSO)

A outra ponta do §3b. O refino **consome** pedra em milhares; a oferenda é por onde o jogador
**escolhe** qual pedra vai farmar, em vez de torcer para cair a do tipo certo.

Fica na bolsa (`Abrir Inventário → Oferenda`). O jogador carrega uma roleta com até **5
pokémon** do depot e gira; sai **uma** pedra de evolução, sorteada entre os tipos que ele pôs.
Os pokémon oferecidos são apagados — não há volta.

Cada casa da roleta é um **"+"** que abre a mesma folha de escolha de pokémon do Mercado e do
anexo da DM: cards com sprite, a fileira **P·IV·Q·N**, busca por nome, filtro de tipo, IV mínimo e
ordenação. Ela **não fecha ao escolher** (são até cinco numa sentada) e marca cada card com o número
da casa. A casa cheia repete sprite, nome e os quatro selos, para a conferência final do que vai
ser queimado não exigir reabrir nada.

| | |
|---|---|
| Casas da roleta | **5** (`OFERENDA_CASAS`) — eram 10 até 16/09/2026 |
| Prêmio | **1 pedra** de evolução do tipo sorteado |
| Shiny oferecido | paga em **Shiny Stone** do tipo dele, nunca na pedra comum |
| Chance de sair pedra | `pokémon oferecidos ÷ 5` — cinco casas cheias é garantia |
| Peso de cada pedra | **20% por pokémon**, dividido entre as pedras que ele pinta |
| Não entram | o que está lutando, a equipe, quem está no posto de XP Share de uma Casa, quem segura Exp. Share, e o último pokémon da conta — nem aparecem na folha de escolha, que diz quantos ficaram de fora |
| A Coleção (o antigo cadeado de venda) | **não barra aqui** — ela é do Mercado NPC; o pokémon da Coleção pode ser oferendado, e aparece com a ★ |
| Auto Selecionar | enche as casas vazias com os de **menor nota (N=)**, só **abaixo da nota do Auto Coleção N** do jogador (padrão 3,5); nunca pega shiny, P5, da Coleção, da vitrine, com item/refino/TM, o starter nem as equipes do PvP e do campeonato |
| Onde mora | `src/shared/oferenda.mjs` (a roleta) e `src/server/game/oferenda.mjs` (posse e sorteio) |

**Um pokémon vale UMA CASA — 20% do círculo —, tenha ele um tipo ou dois.** É a regra inteira:

| na roleta | pinta |
|---|---|
| Charmander (FIRE) | 20% de Fire Stone |
| Charizard (FIRE/FLYING) | 10% de Fire Stone + 10% de Feather Stone |
| Gengar (GHOST/POISON) | 10% de Darkness Stone + 10% de Venom Stone |

O segundo tipo compra **variedade, não vantagem**: ele parte a casa ao meio em vez de acrescentar
uma. A divisão é pelas PEDRAS que o bicho pinta, e não pelos tipos que ele tem — um DARK/GHOST
comum só tem a Darkness Stone (que serve os dois), então ele leva a casa **inteira** nela.

**SHINY paga em SHINY STONE, e só nela.** Um shiny na roleta não pinta a pedra comum do tipo
dele: pinta a **Shiny Stone** daquele tipo. Shiny Dratini (DRAGON) só pode dar Dragon Shiny
Stone; Shiny Bulbasaur (GRASS/POISON) abre Grass **ou** Poison Shiny Stone. É a mesma regra de
tipo — muda a prateleira.

Isso torna a oferenda a **única fonte de Shiny Stone que não passa por fragmento**, e ela se
paga sozinha sem regra extra: o shiny ocupa uma casa das cinco, então a fatia dele vale 1/5 do
círculo. Cinco shinys do mesmo tipo fecham a roleta e garantem a pedra; um shiny no meio de quatro
comuns dá ~20%. Nos dois casos a conta é **cinco shinys por uma Shiny Stone** — perto do caminho
do fragmento, e um pouco acima dele (10 fragmentos a 0,0005% na Outland ≈ 2 milhões de abates;
cinco shinys ≈ 2,4 milhões, pela chance de captura shiny).

Uma diferença que a tabela esconde: as comuns **fundem** DARK e GHOST na Darkness Stone, mas as
dezoito Shiny Stones são itens distintos — um shiny DARK/GHOST pinta **duas** fatias. Por isso as
fatias são indexadas por chave (`n:<nome>` para comum, `s:<TIPO>` para shiny) e não por nome.

**A Coleção não vale aqui, e é de propósito.** Ela (o antigo cadeado de venda, ver §6) existe
contra a venda ao NPC, e principalmente a em LOTE — o botão "vender o depot inteiro" apaga dezenas
de linhas num clique, e a Coleção diz quais ficam de fora. A oferenda não tem nada disso: são cinco
escolhas, uma por casa, cada uma por um card com a ficha do bicho na frente. Barrar a Coleção
obrigaria a devolver um a um ao Depot só para usar a tela, e a Coleção passaria a significar duas
coisas diferentes. Ela continua aparecendo como **★** no card (quem guardou guardou por algum
motivo), o filtro **Local** da folha separa Depot e Coleção, e o que segura a mão de quem vai
queimar um shiny é a escolha explícita mais o diálogo, que conta com todas as letras quantos shinys
estão na roleta.

**Auto Selecionar: a régua da mão, mais dura.** O botão ao lado de "Esvaziar" enche as casas
vazias com os pokémon de **menor nota** (a N= da calculadora, a mesma do selo dos cards) entre os
que podem entrar; o da folha de escolha faz o mesmo só entre os que a lista mostra, e é assim que
se pede "os cinco piores de FIRE". Empate na nota: primeiro o de nível menor, depois a captura mais
recente. Há um **teto**: só entra nota abaixo da do **Auto Coleção N** do jogador (a mesma régua da
Coleção automática do Mercado, padrão 3,5). Sem ele, um depot com três ruins e um ótimo encheria a
quarta casa com o ótimo. A mão pode oferecer o que quiser porque cada card é uma escolha olhada; o botão escolhe
sem olhar, então fica de fora o que é raro de nascer (**shiny**, **P5**), o que carrega
investimento (**item segurado**, **refino**, **TM**), o **starter**, a **Coleção**, a
**vitrine** do perfil e as **equipes do PvP Ranqueado e do campeonato**. As equipes importam
porque a nota é **dentro da espécie**: um Dragonite de nota 1 ainda bate mais que um Rattata de nota
9, e é na equipe que mora esse bicho. Elas estão no banco, então a tela pergunta ao servidor no
clique (`oferenda.protegidos`, só leitura); sem resposta, o botão não escolhe nada. O botão só
enche as casas: o giro continua pedindo a confirmação. A regra mora em `escolherPioresDaOferenda`
(`src/shared/oferenda.mjs`), coberta por `tools/teste-oferenda-auto.mjs`
(`npm run test:oferenda:auto`).

**A fatia vazia é o preço de girar pela metade.** Com dois pokémon, 60% do círculo é "Nada" — e
ela aparece desenhada antes de confirmar. Sem isso, girar com um pokémon daria a mesma pedra que
girar com cinco, e ninguém carregaria a segunda casa.

O exemplo que o teste guarda: 2 Charmander + 1 Bulbasaur + 2 Gengar dão **Fire 40%** (dois de
tipo único, 20% cada), **Venom 30%** (o Bulbasaur e os Gengar somam, 10% cada), **Darkness 20%**
e **Leaf 10%** — e as quatro fecham 100%.

**Por que cinco por uma.** A roleta nasceu com dez casas e caiu para cinco em 16/09/2026: dez
pokémon por pedra pesava demais para quem precisa de uma pedra só. Medido no banco de produção: o
depot cresce 13 a 160 pokémon/dia por conta ativa (mediana ~55) e o jogador **mediano tem 9
pedras** na bolsa (o topo tem 3.321). Cinco por uma dá ~11 pedras/dia no meio da tabela — mais
que dobra o que ele tem — e ~32/dia no teto de captura, contra as ~250/dia de um tipo que o topo
já farma. Muda o jogo de quem precisa de uma pedra e continua pequeno para quem tem mil, que é o que protege o preço da única mercadoria que a
comunidade negocia entre si (o NPC não compra pedra).

**O sorteio é do servidor, e é conferível.** `randomInt` do `node:crypto` (uniforme por rejeição,
sem o viés de um `%` sobre bytes crus); o cliente recebe a roleta inteira mais o índice sorteado e
**anima até ali** — a animação é consequência do resultado, nunca a causa. Cada giro deixa na
auditoria os pesos, o total e a fatia que saiu.

A lista que chega do cliente é um pedido, não um fato: ids repetidos são deduplicados (cinco vezes
o mesmo Gengar é **um** pokémon, não uma roleta de 100% Darkness), e cada id é conferido contra a
coleção em memória do dono. Coberto por `tools/teste-oferenda.mjs` (`npm run test:oferenda`) e,
no navegador com o socket no meio, por `tools/teste-oferenda-ui.mjs` (`npm run test:oferenda:ui`).

**O banco confere o que a memória não garante.** O pokémon sai da memória ANTES do `DELETE` (nada
fora da fila de economia o alcança no meio), e o `DELETE` só apaga linha do próprio jogador, fora
do Mercado, e todas ou nenhuma — uma memória desatualizada (a linha mudou de dono ou sumiu por
outro caminho) derruba o giro inteiro, sem pedra. `tools/teste-oferenda-ataques.mjs`
(`npm run test:oferenda:ataques`) ataca pelo socket: id repetido, rajada, corrida com a venda ao
NPC, com o lote e com o Mercado, mover para a equipe no meio do giro, memória velha e pacote
inflado.

---

## 4. Captura

São **dois mecanismos diferentes**, e a ajuda do jogo é explícita: *"o medidor de investimento
das capturas normais não vale pra shiny"*.

### As pokébolas

De `/api/game/balls`. O `catchRate` é a "eficiência de captura ×N" que a interface mostra; o
cliente trata **≥ 255 como captura garantida**.

| Bola | catchRate | Preço (ouro) | Ouro por ponto | Comprável |
|---|---:|---:|---:|---|
| Poké Ball | ×1 | 5 | 5,0 | sim |
| Great Ball | ×2 | 20 | 10,0 | sim |
| Super Ball | ×3 | 50 | 16,7 | sim |
| Ultra Ball | ×4 | 130 | 32,5 | sim |

A **Idle** (id 6) e a **Master** (id 5) existem no jogo original mas ficaram de fora daqui: a
Idle é recompensa de um sistema que não temos, e a Master captura garantido, o que anularia
a mecânica inteira. Os ids seguem reservados — não reaproveite para outra bola.

A bola de id 3 é a **Super Ball**: ícone em `game/src/client/img/ball-super.png` (Quick Ball do
[pokesprite](https://msikma.github.io/pokesprite/overview/inventory.html)) e animação em
`game/src/client/effects/catch/superball*.png` (copiada do espelho). Regenerar:
`node tools/build-superball-effects.mjs`.

### Nosso balanceamento de captura

Como o limiar do medidor de investimento é server-side e não dá para observar, a nossa
implementação usa chance fixa por arremesso (`chanceCaptura` em `game/src/server/sim.mjs`):

```
raridade = log10(max(100, priceNpc)) − 1                → 1,00 (Pidgey) a 8,81
fator    = 1 + raridade³ / CAPTURA_RARIDADE_DIV
chance   = BASE_CAPTURA × (catchRate / fator) × (1,4 − hpFrac)   →  limitado a [0,3%, 10%]
```

São **dois** botões de balanceamento, e eles fazem coisas diferentes: `BASE_CAPTURA` reescala
tudo de uma vez; `CAPTURA_RARIDADE_DIV` decide a distância entre o comum e o raro — quanto
maior, mais plana a curva.

| | Valor | Razão fácil : mediano |
|---|---|---|
| 1ª versão | base 0,6 · div 3 | ~58% por arremesso num Pidgey — a auto-ball capturava em duas bolas |
| 2ª versão | base 0,15 · div 3 | 4,5× — Bulbasaur dava 17% com Beast Ball, seis derrotas por captura |
| **hoje** | **base 0,0075 · div 17** | **2,5×** |

O alvo de hoje é explícito, medido com a **melhor bola** (Beast, ×5) num corpo caído:

| Raridade | Espécie | Chance | Derrotas por captura |
|---|---|---:|---:|
| 1,00 (a mais fácil) | Pidgey, Caterpie, Rattata | **4,96%** | 21 |
| 2,48 | Bulbasaur, Charmander | 2,77% | 37 |
| 3,04 (mediana) | — | **1,98%** | 51 |
| 3,26 | Charizard | 1,73% | 58 |
| 4,00 | Snorlax | 1,10% | 91 |
| 8,81 (a mais rara) | — | 0,30% (piso) | 333 |

Nenhuma das 443 espécies passa de 5%. Com a Poké Ball (÷5), o teto vira 0,99% e a mediana
0,40%.

**`priceNpc = 0` não é "barato", é "não está à venda"** — e é como o catálogo marca 13
espécies: os onze lendários (Articuno, Zapdos, Moltres, Mewtwo, Mew, Raikou, Entei, Suicune,
Lugia, Ho-oh, Celebi), o Ditto e o Unown. Sem tratar isso, o `max(100, 0)` as jogava na faixa
mais fácil e a Pokédex anunciava o Mewtwo empatado com o Pidgey. Hoje quem não tem preço vale
o **máximo do catálogo** (`PRECO_MAIS_RARO`). Nenhuma das 13 tem spawn, então isto não muda
partida nenhuma — muda o que a ficha promete.

### Derrotados no chão

Quem é derrotado **fica caído por 30 s** (`CORPO_MS`) antes de sumir, e nessa janela dá para
arremessar bola nele pelo painel do canto de baixo à esquerda do palco. A onda seguinte não
apaga os corpos; quem apaga é `limparCorpos`, com teto de 24 simultâneos.

Corpo tem `hp = 0`, então cai na ponta boa de `(1,4 − hpFrac)` — derrubar antes de tentar
capturar é a jogada certa.

**É uma tentativa por pokémon derrotado.** Capturado ou escapado, o corpo sai do mapa na
hora. Deixá-lo ali transformava a captura em "despeje bolas no mesmo alvo até sair", e o
custo por captura deixava de existir. Um selvagem **vivo** continua em campo quando a bola
falha, porque ele ainda está lutando.

> Isso muda a leitura do balanceamento: a chance por arremesso passa a ser a chance por
> ENCONTRO. Um Pidgey a 4,96% sai em ~21 **derrotas**, não em 21 bolas no mesmo corpo. O
> custo em bolas é o mesmo; o que muda é precisar de mais kills — e é por isso que a coluna
> da ficha se chama "derrotas (média)" e não "bolas".

### Teto de nível na captura

O selvagem **luta** no nível da hunt; o capturado **nasce** no teto da espécie. São duas
coisas separadas desde a v1.34.0, e a régua é `shared/teto-captura.mjs`.

| Cadeia | Escada |
|---|---|
| 3 estágios (Treecko → Grovyle → Sceptile) | **20 · 40 · 100** |
| 2 estágios (Makuhita → Hariyama) | **40 · 100** |
| não evolui (Spinda, variantes de Outland) | **100** |

**A cerca é o Nv 100.** Enquanto o mob estiver em 100 ou abaixo, ele entra na bola no nível
em que estava — Kanto e Johto inteiras (nível 1 a 100) não mudam um número sequer, e um
Rhyhorn de hunt 30 continua vindo Nv 30 em vez de cair para o 20 da escada. Acima de 100 o
teto manda.

**Por que.** Da Outland (150) para cima a escada de hunts abre para 500, 2.000, 25.000,
160.300. Como o capturado nascia no nível do mob, quem chegava em Sinnoh trocava a equipe
inteira por bichos de nível 2.000 numa tarde de bolas: não sobrava o que treinar, o Mercado
inflava junto (`precoVendaPokemon` escala com `nível/50` — um Nv 2.000 vale 41× a base contra
3× de um Nv 100) e o Ranking de Pokémon Forte virava a lista de quem tinha aberto a hunt mais
alta. Hoje 521 dos 745 pares (hunt × espécie) capturáveis passam pelo teto.

**Vale só para capturas NOVAS.** Quem já tinha um Volcarona Nv 1.125 continua com ele — não
houve reset. A decisão é deliberada: no banco havia ~40 mil pokémon acima do Nv 100, e a
maior parte do que passa de 100 na Outland e em Kanto é treino de verdade, não captura fácil.
Derrubar tudo para consertar o ranking custaria o trabalho de centenas de jogadores. O efeito
no Ranking de Pokémon Forte e no Mercado, portanto, chega devagar: pelo que **para de
entrar**, não pelo que sai. Se um dia isso mudar, é uma migração de dados nova — e ela precisa
rodar com o sim parado, porque `p.pokemons` vive na memória e o primeiro flush regrava por cima.

**O XP desce junto.** `nivelPeloXp` é quem manda no nível a partir do primeiro ganho de XP:
gravar `level: 100` com o XP de 2.000 devolveria o 2.000 no primeiro mob derrubado, e o teto
duraria um golpe.

**A evolução das espécies nacionais acompanha a mesma escada.** Sem isso o sistema não fecha —
o `evolveLevel` de Hoenn+ era colado no `huntLevel` do estágio seguinte (Zigzagoon pedia 650
para virar Linoone, Nosepass pedia 2.000, Sylveon pedia 12.750), e um capturado no teto de 40
ficaria seiscentos níveis longe de evoluir. Todo elo cujo **destino nacional** mora em hunt de
Nv 100+ — eeveelutions, Slowking, elos de Sinnoh/Unova em hunts altas — passa a cobrar
exatamente o **teto do destino**. O caminho fica: captura no 20, treina até 40, evolui;
treina até 100, evolui de novo. Nenhuma cadeia precisa passar do Nv 100 para se completar.

**Variantes de Outland (`#2001+`) não evoluem.** Ancient Pupitar **não** vira Ancient Tyranitar;
Furious Magikarp **não** vira Furious Gyarados — são espécies **separadas** no catálogo, cada
uma capturável na hunt. O espelho herdou cadeias nacionais por engano (Pupitar→Tyranitar,
Dragonair→Dragonite); no boot o servidor zera `evolvesToId` e `evolveLevel` para todo `#2001+`.
Tentar evoluir devolve *"variantes de Outland não evoluem"*. Isso **não** trava Magikarp→
Gyarados nem Pupitar→Tyranitar **nacionais** — só a variante Outland.

> Vale para a captura em geral, porque a bola é a mesma (`arremessarBola`). Bosses não têm
> corpo capturável, então não entram nesta conta.

`npm run test:teto` prova a escada e a cerca; `npm run auditar:teto` imprime a varredura
região a região, com o efeito no preço.

### Animação

As folhas são as **originais**, espelhadas por `tools/fetch-effects.mjs`:

| Arquivo | O que é |
|---|---|
| `throw/<bola>.png` | grade 3×3 de 32×32 indexada por **direção** — cada célula traz o rastro apontando para onde a bola voa (não são quadros de animação) |
| `<bola>_catch.png` | tira vertical de 64×96, 60 quadros: abre num clarão, chacoalha, solta faíscas verdes e some pálida |
| `<bola>_broke.png` | igual até o quadro 39; aí estoura numa baforada branca e acaba (44 quadros usados de 60 espaços) |

### Auto-ball

A automação arremessa nos **corpos no chão**, um por corpo, respeitando `CD_BOLA_MS`.

Antes ela mirava o selvagem VIVO abaixo de 45% de HP e quase nunca disparava: um golpe forte
atravessa essa janela inteira num tick. E quando disparava mirava o alvo pior — vivo tem
`hpFrac > 0` e a chance cai.

Note que **a Poké Ball é a mais eficiente por ouro**. As bolas caras compram menos arremessos
pelo mesmo dinheiro — o que elas dão é menos tempo gasto, não mais captura por moeda.

### Shiny

```
chance = min(1, shinyBase × catchRate_da_bola)
```

`shinyBase` é uma chance fixa por tier da espécie, mandada pelo servidor a cada encontro. Com
a Master Ball (255), qualquer `shinyBase` acima de 0,4% já satura em 100%.

### Captura normal

É um **medidor de investimento por espécie**: cada arremesso soma, e o painel
`/api/game/used-balls` acompanha, por espécie, `attempts`, `balls` por tipo e `goldSpent`
contra o `price` daquela espécie. O limiar exato é server-side.

Modificadores conhecidos:

- **Capture Boost** dobra a chance por arremesso.
- **Pokédex**: desbloquear a espécie (100 kills) dá um `captureBonus` por espécie.
- Cada hunt tem um `catchChance` próprio em `/api/game/hunt-config?slug=`.
- `captureBase` existe em `creatures.json` para apenas **120 das 443** espécies (valores 3–448),
  concentrado nas variantes Outland e suas formas base — não é a taxa geral de captura.

---

## 5. Shiny

Da ajuda do jogo, seção Shiny:

- Shinies aparecem **aleatoriamente nas hunts** de espécies que têm forma shiny — o **tier da
  espécie (E→S)** define a raridade do encontro.
- Capturar um shiny usa uma **chance fixa por tier × a força da pokébola** — o medidor de
  investimento das capturas normais **não se aplica**.
- Shiny **não evolui**.
- **Shiny Secret Lure** dobra a chance de shiny aparecer.
- Streak Points podem ir para a trilha Shiny (+0,1% por ponto).

O catálogo de espécies com forma shiny é público em `/api/game/all-pokes` — **64 espécies**,
com o tier e a contagem global de quantas existem no mundo:

| Tier | Espécies |
|---|---:|
| A | 7 |
| B | 7 |
| C | 27 |
| D | 19 |
| E | 4 |

**O que não consegui**: a chance numérica por tier. O servidor manda `shinyBase` já resolvido
por encontro; não existe tabela tier→probabilidade no cliente.

**Caminho garantido**: Shiny Cards. A cada **15.000 derrotas da mesma espécie** você ganha 1
card (variantes Outland dropam o card da espécie base, mas exigem **30.000**). No Altar, o
card é sacrificado para invocar a batalha shiny — e é consumido mesmo se o shiny escapar.

### O sprite do shiny é OUTRO looktype (e isso já mordeu)

Cada uma das 64 espécies com forma shiny tem um **looktype próprio** — Charizard é 67, Shiny
Charizard é **9874**, e o desenho é o dragão preto. Os dois números estão em
`formulas.json → shinyCatalogo`, e o servidor manda o par (`looktype`, `lookShiny`) em tudo
que desenha pokémon.

Quem for desenhar, resolva o looktype **a partir da espécie**, nunca do número que veio
gravado junto. O Mercado Global aprendeu isso do jeito difícil: a ficha de um anúncio é um
retrato congelado no dia em que ele foi aberto, e havia anúncio na vitrine com

```json
{"nome":"Charizard","level":87,"shiny":false,"looktype":9874}
```

— `shiny: false` com o looktype do shiny. A tela obedecia e mostrava o Charizard preto num
anúncio comum, sem selo de shiny nenhum. Outro anúncio guardava `8716`, que hoje não é outfit
de coisa nenhuma, e ficava um quadrado em branco. Espécie é identidade; looktype é detalhe de
desenho que muda quando o espelho de assets é regerado.

### O contador de shiny da ficha da espécie

Na ficha de cada espécie, ao lado de "derrotados" e "capturados", vão **✨ vistos** e
**✨ capturados** — os shiny daquela espécie que apareceram para ESTE jogador e os que ele
segurou. O Hunt Analyser já dava o número da sessão; aqui ele é por espécie e não zera.

A contagem mora no arremesso da bola, e não no spawn, porque é ali que o brilho é sorteado
(`rolarShinyCaptura`): o mob nasce comum, e o shiny existe pela primeira vez quando a bola
sai da mão. Se ela falha, o corpo some e não sobraria de onde deduzir depois — por isso
"visto" sobe antes de saber se fechou. Daí a leitura do par: **de X que brilharam, você
pegou Y**, com `vistos >= capturados` sempre. A evolução com Shiny Stone fica fora dessa
conta: ela registra captura na Pokédex sem encontro nenhum, e somaria em "capturados" sem
par em "vistos".

Os dois números viajam nas entradas da Pokédex (`sv` e `sc` ao lado de `k` e `c`) e **só
existem quando passam de zero** — com 443 espécies e um shiny a cada 24.000 capturas, gravar
dois zeros em cada linha inflaria o JSONB e o delta da Pokédex de todo mundo em troca de nada.

### O registro de shinys do servidor (NOSSO)

A Pokédex responde "o que EU já vi". Faltava a pergunta do outro lado — "existe um Dratini
shiny neste servidor? de quem?" —, e até agora a única forma de saber era ver a mensagem de
captura passar no chat e lembrar. O ícone de lista ao lado do fechar da Pokédex abre esse
registro: **todo shiny capturado no servidor**, com dono, nível, potência e ficha completa.

É a única lista do jogo que atravessa jogadores **sem passar pelo Mercado**, e por isso ela
mora em `shinys-db.mjs` e não em `market-db.mjs`: a fonte é `player_pokemon`, e o anúncio é só
um `LEFT JOIN` a mais — a coluna que diz se dá para comprar aquele bicho agora. Quando há
anúncio aberto, o card ganha preço e um botão que cai no mesmo `market.comprar` da vitrine.

Duas notas de implementação que valem a leitura:

- **O índice é parcial** (`WHERE shiny`). Shiny é menos de 1 em mil capturas; um índice sobre a
  coluna inteira seria quase todo lixo. Assim a consulta lê o índice, não a tabela, mesmo com
  milhões de linhas.
- **Busca e tipo viram ids de espécie no sim**, como no `market.listar`: o catálogo (nome e
  tipo) mora na memória do processo, e o banco só entende número. Filtro que não casa com
  espécie nenhuma manda uma lista **vazia** — a diferença entre "sem filtro" e "filtro
  impossível" é o que evita a vitrine inteira aparecer para quem digitou um nome que não existe.

---

## 5aa. Potência (NOSSO, não existe no jogo deles)

O segundo eixo que separa dois pokémon da mesma espécie e do mesmo nível — o primeiro é a
qualidade, que o jogador nunca escolhe e quase não vê. Sorteada **uma vez, na captura**, e
nunca mais muda: subir de nível não melhora a potência, e é isso que dá valor de mercado a um
pokémon de nível baixo com potência alta.

| Potência | Chance | Bônus em TODOS os stats |
|---|---:|---:|
| 1 | 74,495% | +0% |
| 2 | 20% | +5% |
| 3 | 5% | +10% |
| 4 | 0,5% | +25% |
| 5 | 0,005% | +100% |

As chances somam exatamente **100**. O bônus multiplica os seis stats (hp, atk, def, spAtk,
spDef, speed) e entra **junto com a qualidade**, no mesmo ponto de `calcularStats` — é a mesma
natureza de coisa: um número que o pokémon carrega desde que nasceu.

**Shiny virou multiplicador também: ×2.** Antes ele era praticamente só uma cor — rerolava IVs
até somarem mais de 110, o que valia poucos pontos percentuais. Com o dobro em tudo, achar um
muda o time de verdade, e a raridade (1/1.000 a 1/32.000 por tier) justifica. Potência e shiny
se multiplicam: **P5 + shiny = 4×**.

**O starter não gira a roleta** — nasce em potência 2. Ele já tem piso de qualidade e de IV
(§3) justamente para nascer jogável, e sortear uma potência 1 no primeiro pokémon de alguém
seria começar o jogo devendo.

**Pokémon anteriores a esta versão giraram a roleta no boot** (`preencherPotencias`, em
`sim.mjs`), em vez de receberem 1 de consolo — é a mesma chance que qualquer captura nova tem.
Medido na subida real, em 58.323 pokémon: 74,45% / 19,97% / 5,09% / 0,49% / 0,005%.

Fica em `game/src/server/content.mjs` (`POTENCIAS`, `rolarPotencia`, `multDeNascenca`) e é
conferido por `node tools/teste-potencia.mjs`.

---

## 5bb. Bosses

Arenas de desafio: você paga uma entrada, entra num mapa próprio e enfrenta um pokémon
gigante. De lá vem de `GET /api/game/boss` (o que está aberto, as arenas e a penalidade) e
`/game/bossCatalog.json` (a galeria).

### Galeria × ficha

O `bossCatalog.json` tem **87 bosses** em cinco categorias (Especiais 48, Mystery Dungeons 20,
Terror 12, Lendary Beasts 6, Raids 1), níveis de 300 a 625. Mas galeria não é jogo: o
`/api/game/boss` responde `"bosses": ["aerodactyl2", "cruel"]` — **dois de 87** são
desafiáveis. Aqui é igual, e por um motivo a mais: `/game/maps/aero_boss.json` responde 404,
então o Ancient Aero fica sem arena e só o **Giant Cruel** entra.

### A ficha do Giant Cruel — transcrição literal

| Campo | Valor |
|---|---|
| Espécie | **Tentacruel** (pokeId 73), looktype **3348** (o sprite gigante, não o da espécie) |
| Nível | 600 · `hpMult` 10 · qualidade 1,7 · `ivTotal` 100 |
| `neutral` | **true** — o boss não tem tipo: nada é super-efetivo nem resistido contra ele |
| Arena | `cruel_boss`, boss em (−3,0), `heroFrom` 3 / `heroStop` 2 |
| Entrada | 1× **Bronze Boss Token** (itemId 70000) |
| Pontos | 1 (é o que alimenta o ranking de Boss Points deles) |
| Golpes | Tentacle Slap 280/10 s · Giant Poison Burst 800/15 s · Deep Sea Collapse 400/20 s |

Os golpes vêm **sem tipo** na configuração deles (`fxKey` vazio, nenhum `type`), e ficaram
assim: sem tipo não há efetividade nem STAB, só o power cru.

A arena é um anel de coral em volta de uma poça funda. O boss fica **dentro da água**, que
bloqueia — por isso o `heroStop: 2`: o pokémon briga da margem, a duas tiles.

### Os drops, e o que é a "10.000 Carat Emerald"

| Item | Como cai | O NPC paga |
|---|---|---:|
| Water Stone | ×1–3 (pesos 50/30/20) | 5.000 |
| Venom Stone | ×1–3 (pesos 50/30/20) | 5.000 |
| **10.000 Carat Emerald** | **30% de chance** | **150.000** |
| AoE TM Disk Piece | 1% de chance | 0 |

A **Esmeralda de 10.000 quilates** é o prêmio da arena: item id 27304, categoria `loot`,
marcado `rare`, e a descrição no catálogo deles é *"Uma esmeralda colossal de dez mil
quilates, lapidada em uma única peça. Colecionadores disputam pedras desse porte a peso de
ouro"*. Ela não tem uso — é **dinheiro**: 150.000 de ouro por unidade, o item mais caro que
sai de qualquer luta. Repare que ela **não aparece** na lista curta do `bossCatalog.json`
(que só cita "Boss Token, Rare Candy, Heart Scale"); a tabela de verdade está na ficha, e é
por isso que ela parece surgir do nada quando cai.

São dois formatos de drop, e a diferença importa: `qtyWeights` **sempre cai** (o que varia é
quanto) e `chance` é um sorteio seco. Média por queda: **~62.000 de ouro**, dos quais 45.000
são a Esmeralda — ou seja, em 70% das idas o loot vale ~17.000 e é a Esmeralda que fecha a
conta.

### A penalidade de equipe — deduzida, e fecha nos centavos

Esta é a mecânica central, e o `/api/game/boss` entrega dados suficientes para resolvê-la.
Com a conta de referência (1 Charmander nível 11) e `teamLevel: 300`, ele devolve:

```json
{"members": 1, "strength": 0.04, "deficit": 5.96, "mult": 700.22}
```

Daí sai a conta inteira:

```
força   = Σ min(1, nível do pokémon / teamLevel)     11/300 = 0,0367   (mostram 0,04)
déficit = 6 − força                                           5,9633   (mostram 5,96)
mult    = 3 ^ déficit                                        700,22    (mostram 700,22)
```

O `mult` multiplica **o dano que o boss causa** — não o que ele aguenta. É o que dá sentido
ao aviso da tela deles: *"leve 6 Pokémon no nível do boss (Nv. 300) para tomar menos dano"*.
Com seis no nível, `mult` = 3⁰ = **1**; com três, 3³ = **27**; sozinho e fraco, **700**.

Os únicos dois números que a dedução fixa são a **base 3** e o **alvo 6** — e os dois são
confirmados pelo par (deficit, mult) publicado. `tools/teste-bosses.mjs` tranca isso
reproduzindo o 700,22 da conta de referência.

### O que é NOSSO

**O preço do Bronze Boss Token: 50.000 de ouro.** No original ele não está na loja, nem em
tasks, daily ou streak — vem de sistemas que não temos (eventos, Game Pass) e a fonte não é
observável de fora. Sem alguma, a arena fica inalcançável. O valor sai da conta da própria
arena: com loot esperado de ~62.000, a entrada se paga na média, mas só na média. O token
**não pode ser revendido** — o `npcPrice` dele é 250.000, cinco vezes o que se paga, e a
revenda seria ouro infinito.

**O boss não leva o ×1,8 de dano do selvagem.** Aquele multiplicador é da hunt; os golpes do
boss já vêm com power de boss (280 a 800, contra os 56–72 de um golpe normal). Aplicar os
dois é contar a mesma escalada duas vezes — com ele, um Giant Poison Burst tirava 14.000 de
um pokémon nível 300, e nem a equipe ideal sobrevivia à segunda rodada.

**O combate é o nosso**, de campo, e não o de rounds deles (lá o cliente pede
`{action:'round'}` a cada 550 ms e recebe eventos). O boss entra como um mob FIXO — não
vagueia nem persegue —, e o resto é o motor de sempre. Medido com equipe de seis nível 600 e
qualidade 3,2: a luta dura ~40 s e o boss leva 135.840 de HP embora.

### Repetição automática (NOSSO)

Quem junta trinta tokens fazia trinta vezes a mesma sequência: Desafiar → lutar → cair no
Centro → curar → voltar à aba → Desafiar. Nada ali é decisão; é a definição de trabalho que o
jogo devia fazer sozinho. O interruptor **Repetir automaticamente** da aba Bosses (`boss.auto`)
fecha esse laço no servidor.

O ciclo é: fim da luta (**ganhando ou perdendo**) → Centro → a enfermeira cura o time →
`BOSS_AUTO_ESPERA_MS` (4 s, o tempo de a tela mostrar o resultado) → entra de novo no **mesmo**
boss, gastando outro token.

Três detalhes que fazem diferença:

- **A vontade fica em `automation`** (o jsonb que já vai no flush), e não em memória. Quem liga
  isso vai dormir com o jogo aberto — uma queda de conexão não pode desligar em silêncio.
- **`automation.bossAutoKey` guarda QUAL boss.** Quando a luta acaba, `p.boss` já foi zerado;
  sem a chave à parte, a volta não saberia em qual arena entrar. Desafiar à mão também grava a
  chave, então ligar o interruptor no meio de uma luta continua a série que já estava rolando.
- **Falhar DESLIGA, em vez de só reclamar.** Acabaram os tokens, o nível não dá, o time sumiu:
  o interruptor cai e o jogador recebe um aviso. Insistir encheria o log de mil linhas iguais
  para quem voltou depois de seis horas.

As travas do `boss.entrar` valem todas aqui — token, nível mínimo do treinador, time de pé. O
automático é um atalho de cliques, não uma porta dos fundos. E **abandonar a arena desliga**: é
uma decisão explícita, e sem isso o ciclo arrastaria o jogador de volta para dentro dela.

---

## 5bb-2. Eventos globais (NOSSO)

O buff que o administrador liga para **o servidor inteiro** ao mesmo tempo: XP do treinador, XP
do pokémon e farm, cada um em %, por um número de minutos. É a alavanca de temporada — fim de
semana dobrado, compensação por uma queda, comemoração de marco.

```
multXpTreinador = boost da loja × VIP × guild × ranking × (1 + evento/100)
bonusLootPct    = boost da loja + guild + ranking + evento
```

**XP multiplica, farm soma** — e isso não é inconsistência. XP já era uma cadeia de
multiplicadores (é o que faz boost + VIP dar 2,25× e não 2×), e o loot já era uma soma de
pontos percentuais respondendo à mesma pergunta ("quanto a mais nesta kill?"). O evento entra em
cada um pela porta que já existia. A consequência importante: **quem comprou boost continua
rendendo mais que o vizinho durante o evento** — o mínimo que se deve a quem pagou.

**O prazo é um carimbo, não um timer.** `terminaEm` é comparado com o relógio a cada pergunta;
no instante seguinte ao fim, o multiplicador volta a 1 sozinho. Sem `setTimeout` para errar, sem
varredura, e sem diferença entre um processo que estava de pé e um que acabou de subir.

**Onde cada peça mora**, e por quê:

| peça | onde | por quê |
| --- | --- | --- |
| a verdade | `eventos_buff` no Postgres | um restart no meio de um evento de 6 h não pode apagá-lo |
| o aviso | canal `evento` do Redis | todo sim precisa saber no segundo em que o admin clica |
| a cópia viva | variável de módulo em `game/eventos.mjs` | no tick, buff é multiplicação — nunca consulta |
| a faixa | `snapshot(p).evento` | o pacote já ia sair; quem entra recebe junto do primeiro estado |

Só existe **um** evento por vez: ligar outro encerra o anterior na mesma transação. Dois seriam
dois buffs somados sem tela que os mostrasse, e quem liga o segundo quase sempre quer substituir
o primeiro. Tetos: 1000% por buff e 7 dias de duração — não é desconfiança do admin, é a rede
contra o dedo escorregado.

Na tela do jogador é uma faixa piscando devagar no alto da batalha, com a contagem regressiva ao
lado. Ela não some por conta própria: quem entrou no meio precisa entender num olhar por que a XP
está estranha, e um toast só alcançaria quem estava com a aba aberta na hora do clique.

---

## 5bb-3. Guerra de Guilds (NOSSO)

O evento diário das guilds. Ele **não é uma partida** — é um trabalho que roda uma vez por dia,
às **22h UTC**, e cujo produto são três coisas: as colocações, o GP e uma **gravação**.

### Por que deixou de ser ao vivo

A primeira versão era uma arena compartilhada no horário: entrava quem estivesse conectado
naquele minuto. Três problemas, e nenhum deles se resolve com balanceamento:

1. **O evento premiava fuso horário, não guild.** Com centenas de jogadores espalhados pelo dia,
   o resultado real era "ganha quem tinha alguém acordado" — houve dia de vitória automática
   porque só uma guild tinha gente na arena.
2. **Não sobrevivia ao sharding.** Com `SHARD_COUNT > 1`, dois participantes podiam cair em
   processos diferentes e cada um simulava metade da arena sem ver a outra.
3. **Quem perdia não via nada.** O evento durava um minuto e não deixava rastro.

### Como roda agora

| passo | onde |
| --- | --- |
| o despertador (checa o relógio UTC) | tick do sim, `verificarEventoGuild` |
| a corrida entre shards | `INSERT … ON CONFLICT DO NOTHING` em `guild_pvp_eventos` — quem inserir é o dono do dia |
| o retrato | uma consulta: os ESCALADOS das guilds registradas + a equipe de cada um |
| a batalha | `game/guild-pvp-sim.mjs`, sem banco e sem jogador conectado |
| o resultado | GP por colocação + `guild_pvp_batalhas` (resumo e replay) |

**Entra o TIME da guild** — os até `MAX_TIME_GUILD` (10) membros que o dono escalou
(`guild_members.escalado`, filtrado em `membrosParaGuerra`) —, online ou não, com a equipe
gravada **naquele instante** e o time **curado**. A guild em si não tem teto de gente: o corte
pelo escalado é o que mantém a guerra disputável, senão quem convidasse mais gente venceria por
número. Os mesmos escalados são os únicos a receber o bônus diário do ranking (`carregarGuild`)
e o diamante do fechamento mensal (`playerIdsEscalados`). Curar é decisão de desenho, não descuido: com todo mundo offline, usar o HP do
banco transformaria "desloguei desmaiado" numa punição permanente na guerra da guild — que é
exatamente o que este formato existe para acabar.

O combate é o mesmo do resto do jogo (`calcularDano`, `melhorGolpeJogador`, a busca de caminho de
`campo.mjs`), com uma diferença: quando o pokémon em campo cai, **entra o próximo da equipe**; o
membro só sai quando o time inteiro está no chão. A guild cai quando o último membro sai.

Custo: **7 guilds × 5 membros × 3 pokémon resolvem em ~50 ms de CPU**, uma vez por dia. A
simulação devolve o event loop a cada 40 ticks para não parar as hunts de quem está jogando.

Dois desempates existem e estão marcados no resumo:

- `motivo: 'tempo'` — estourou o teto de **10 minutos** simulados (`LIMITE_MS_GUERRA`; eram 5 até
  16/09/2026, e desde 11/09 toda guerra batia nele); ordena pela fração de HP restante. Os duelos
  de ginásio, do PvP Ranqueado e do Campeonato seguem com 5 minutos (`LIMITE_MS_DUELO`).
- `motivo: 'sozinha'` — uma guild registrada só; leva o GP de 1º de um evento de uma guild (1) e
  não gera replay, porque não houve batalha.

### O replay

O que se guarda **não é vídeo**: é a mesma conversa que o campo ao vivo tem com o cliente, com o
relógio começando em zero e escrita compacta.

```
atores   uma vez só  — quem é cada slot (sprite, nick, nível, HP máximo, duração do passo)
inicio   [slot, coluna, linha, …]
quadros  { t, p, h, c, m, x, e }   ← cada chave só aparece quando tem conteúdo
           p  passos: [slot, colunaDestino, linhaDestino, …]
           h  HP novo: [slot, hp, …]
           c  troca de pokémon (o slot continua, quem está nele muda)
           m  caiu (fica de corpo no chão)     x  saiu do mapa      e  feed de abates
```

O truque do tamanho está no `p`: quem entra na lista **começou o passo naquele instante**, então
origem, direção e `passoEm` são consequência de estar ali e não trafegam. Uma guerra de 7 guilds
cheia dá **~45 KB** em JSON — antes da compressão do `jsonb` e do gzip da resposta.

No cliente, `replay.mjs` reidrata isso nos pacotes de campo de sempre e alimenta um **segundo
`Campo`**: nenhum código de desenho novo, nenhum WebSocket. Buscar na linha do tempo remonta a
cena do zero e reaplica os quadros (não há como desfazer um passo) — são centenas de quadros de
números, então a busca é exata e instantânea.

---

## 5bb-4. Ginásios (NOSSO)

Dezoito ginásios, um por tipo elemental, **sem NPC nenhum**: quem é o líder de cada um é um
jogador, e o título muda de mão sozinho quando alguém monta um time melhor.

### As regras

| regra | valor |
| --- | --- |
| ginásios | 18 — um por tipo (`shared/ginasios.mjs`) |
| pokémon por time | até 5 |
| quem entra | pokémon com aquele tipo em `type1` **ou** `type2` |
| repetição | **uma espécie por ginásio** — shiny conta como a mesma espécie |
| o mesmo pokémon em dois ginásios | **pode** (Charizard entra em FIRE e em FLYING) |
| nível do treinador | 150+ para registrar time |
| como se ordena o pódio | soma da **força de batalha** dos cinco, com o **nível travado em 150** |
| prêmio do 1º lugar | **+25% de dano** com todo pokémon daquele tipo |

O +25% vale em **hunt (bosses incluídos), Arena PvP e Guerra de Guilds**. Dentro do
próprio ginásio ele **não vale** — um título que fortalece a defesa do título é um título que
ninguém toma. Tipo duplo **não empilha**: liderar FIRE e FLYING dá 25% ao Charizard, não 56%.

### Por que o cap de 150

Sem teto, o pódio dos dezoito ginásios
seria a lista dos jogadores mais velhos do servidor — na mesma ordem nos dezoito — e não haveria
disputa nenhuma. Com o teto, o que separa dois times passa a ser IV, qualidade, potência, shiny
e **refino**, que é investimento e não tempo de tela.

O cap é só um **teto**: pokémon nível 300 conta como 150; pokémon nível 100 continua contando
como 100. E ele rebaixa o NÍVEL, não o pokémon — o "+N" das pedras continua valendo, senão quem
refinou perderia o investimento exatamente onde ele mais importa.

### A força é de BATALHA, não o ⚔ do ranking

A primeira versão somava `poderDePokemon` (o ⚔ do ranking) dos cinco, e isso estava errado —
o ⚔ mede o quão RARO e bem-investido é um espécime, e o pódio precisa responder outra
pergunta: **quem ganharia a luta**. A conta somava uma parcela por pokémon e ignorava que um
nv 48 não encosta num nv 150.

O erro apareceu no primeiro dia de servidor: um jogador com UM Charizard nv 150 de IVs quase
perfeitos marcava **599**, outro com Tepig nv 150 + Quilava nv 48 + Charizard nv 80 marcava
**783** — e o de 599 vencia todas as vezes ao desafiar. Número que diz uma coisa e batalha que
diz outra é pior que não ter número.

A conta de hoje é a moeda do duelo de desgaste, que é o que `guild-pvp-sim.mjs` roda: A vence
B quando `dpsA × ehpA > dpsB × ehpB`. Então cada pokémon vale **dano por segundo × HP
efetivo** (com o golpe real da espécie no nível do cap, e a defesa entrando no HP efetivo), e
o time é a soma — as parcelas somam de propósito, para o editor nunca mostrar "3 + 4 = 9".

A escolha foi MEDIDA, não estimada. `tools/teste-ginasios-forca.mjs` gera matchups, roda a
batalha de verdade e conta quem acerta o vencedor:

| fórmula | acerto |
| --- | --- |
| **Σ (dps × ehp) com o golpe real** | **95,6%** |
| Σ (dps × ehp) sem o golpe | 94,4% |
| só o melhor do time | 94,4% |
| Σ √(dps × ehp) | 91,1% |
| soma do ⚔ do ranking (a antiga) | 90,0% |

O teste continua no repositório com um piso de 90% e o caso do relato travado — se alguém
mexer na fórmula e ela voltar a errar aquele par, o teste cai.

### Três relógios

O sistema parece um só e tem três ritmos, de propósito:

| o quê | quando | onde |
| --- | --- | --- |
| **o pódio** | na leitura, com 30 s de cache | `rankingDoGinasio` — soma a força das linhas VIVAS de `player_pokemon` |
| **os líderes** | a cada minuto, num shard só, gravados em 18 linhas | `apurarLideres` → `ginasio_lideres` |
| **o desafio** | a cada clique, com 20 s de espera entre dois | `desafiarLider` → `guild-pvp-sim.mjs` |

A força **não é gravada** junto com o time. Foi pedido "a força ATUAL da equipe", e força atual
muda sozinha (o dono sobe o pokémon de nível, refina, evolui): um número gravado no `INSERT`
envelheceria em silêncio e o pódio mostraria o retrato de semanas atrás.

Já o **título** precisa do caminho oposto. `multDoGolpe` é consultada em **todo ataque de toda
hunt do servidor** — uma consulta ao Postgres ali mataria o tick. Então o pódio é apurado uma vez
por minuto, gravado em 18 linhas, e cada shard mantém um `Map` em memória que custa um `get` por
golpe. O atraso máximo de um minuto num título que muda quando alguém sobe um pokémon de nível é
justamente o tipo de atraso que ninguém percebe.

### Times que envelhecem

Ninguém é expulso do ginásio por mexer na coleção. Pokémon que foi ao Mercado, foi vendido ou
evoluiu para uma espécie que já está no time simplesmente **para de contar** — o time segue
valendo com o que sobrou e o dono arruma quando quiser. A alternativa (invalidar o time inteiro,
ou uma faxina em segundo plano) transformaria uma evolução numa punição silenciosa.

### O desafio ao líder

Uma luta **amistosa**: não vale título, não vale prêmio, não mexe no pódio. É o mesmo simulador
da Guerra de Guilds (`guild-pvp-sim.mjs`) com duas "guilds" de um membro cada, e o produto é o
mesmo replay que o player do cliente já sabe tocar. Existe por um motivo de desenho: perder de
5×0 com a fita rodando conta uma história que "⚔ 41.320 contra ⚔ 88.100" não conta — e é isso
que transforma o pódio numa meta em vez de uma tabela.

Os dois lados entram com o nível travado em 150 e **sem** o +25% de ninguém.

---

## 5c. Ranking

O placar do mundo. De lá vem de `GET /api/game/rankings?tab=<aba>`, e clicar num nome chama
`GET /api/game/trainer?name=<nick>` para o cartão de perfil.

### As abas

O original tem dez. Estas quatro são as que existem aqui — as outras (Pokelog, Nightmare, Boss
Points, profissões) dependem de sistemas que não temos, e aba vazia só ocuparia a barra.

| Aba deles | Aqui | O que ordena | Como o valor aparece |
|---|---|---|---|
| `level` · "Treinadores" | `nivel` | nível do treinador, desempate por XP | `{xp} XP` |
| `power` · "Pokémon Forte" | `poder` | **poder** do pokémon, não o nível | `⚔ {power}` |
| `catches` · "Top Catch" | `capturas` | espécies diferentes capturadas | o número puro |

**Top Catch conta ESPÉCIES, não capturas.** O topo de lá marca 282 num catálogo de 443, e um
jogador mediano marca 144 — se fossem capturas totais, um veterano estaria na casa dos
milhares. Aqui isso é o número de espécies com `c > 0` na pokédex.

### O poder — conferido contra o ranking deles

A fórmula já estava na §3 (`power = (hp+atk+def+spAtk+spDef+speed) × qualidade`), e o ranking
serve de prova externa: rodando o nosso `poder()` sobre as oito primeiras linhas de
`?tab=power`, o número bate dentro de **0,02%**.

| Pokémon | Nível | Power deles | Nosso, com q e IV ajustados |
|---|---:|---:|---|
| Alakazam | 906 | 79.823 | 79.826 (q3,56 · IV 28) |
| Electabuzz | 840 | 76.198 | 76.206 (q3,59 · IV 30) |
| Snorlax | 808 | 74.142 | 74.149 (q3,66 · IV 24) |
| Snorlax | 868 | 66.784 | 66.786 (q3,23 · IV 28) |

O resíduo é da busca em grade de qualidade/IV (que lá são exatos e não trafegam), não da
fórmula. Note que todo o topo fica em qualidade **3,2–3,7** — a faixa "Anciã", que a §3 já
dizia sair só de shiny e reprodução, nunca de captura selvagem (teto 1,8).

### Do nosso lado

O ranking sai do **Postgres**, não da memória do sim: é um placar do mundo, e cada shard só
conhece os próprios jogadores. Em troca, o que aparece é o estado do último flush — até 5 s
atrás, o que para um placar é irrelevante. Cada aba fica **10 s em cache** no sim, senão um
modal aberto em vinte clientes viraria vinte varreduras por segundo.

`player_pokemon` ganhou uma coluna **`power`**, gravada junto com o nível. É desnormalização
deliberada: o poder é derivável, mas as bases da espécie moram no JSON do espelho, e sem a
coluna o ranking de Pokémon Forte teria de carregar todos os pokémon do mundo para ordenar.
Os que existiam antes da coluna são preenchidos uma vez, no boot (`preencherPoderes`).

---

## 6. Preços

- **Itens**: `npcPrice` em `items.json`, para todos os 295 itens.
- **Pokémon**: `priceNpc` (custo de captura) e `sellValue` (o que a Heather paga) em
  `creatures.json`.
- **Loot**: o campo `chance` é **percentual × 1000** — a pokepedia deles faz `chance/1e3` e
  exibe **71%** para `chance: 71498`. Conferido contra a página real de Bulbasaur.

### O nosso Market

Três abas, e o servidor é quem manda: o cliente só pede "quantos", nunca "por quanto".

| Aba | O que entra | Preço |
|---|---|---|
| **Compra** | pokébolas compráveis + categorias `heal` e `revive` | preço fixo de catálogo (`priceGold` / `npcPrice`) |
| **Venda** | tudo que os pokémon dropam | `npcPrice` |
| **Venda Pokémons** | qualquer um menos o que está lutando | fórmula abaixo |

```
preço = sellValue × (1 + nível/50) × qualidade × (shiny ? 10 : 1)
```

Consumível comprável **não** pode ser revendido (`precoDeVenda` devolve 0 para as categorias
de `COMPRAVEIS`): comprar e revender pelo mesmo preço seria inócuo, e por preço diferente
viraria ouro infinito.

"Vender todo o Depot" nunca toca em quem está na equipe. A equipe tem **5 lugares**
(`MAX_EQUIPE`); quem for capturado com ela cheia nasce no depot.

### A Coleção (NOSSO — o antigo cadeado de venda)

Pokémon da **Coleção** não é vendido ao NPC: sai da aba Venda Pokémons, fica fora do "vender todo
o Depot", e `shop.sellPokemon` recusa (`colecao.travaVenda`). Em todo o resto (Mercado da
Comunidade, Oferenda, DM, vitrine, equipes) ele continua valendo, com a ★.

| | |
|---|---|
| Onde mora | `automation.pokemonTravado` (lista de ids, gravada com o jogador) — a mesma do cadeado |
| Mover | `colecao.mover { pokemonId, para: 'colecao' \| 'depot' }`, na fila de economia do jogador |
| Espera | **3 s por pokémon** (`COLECAO_COOLDOWN_MS`) + balde `colecao` no gateway (20 de rajada, 2/s) |
| Resposta | sempre `{ k: 'colecao', id, naColecao }` com o estado real — inclusive na recusa |
| Entra sozinho | Auto Coleção Shiny (padrão ligado), N+ e P5; comprado no Mercado; refinado |
| Limpeza | no login, sai da lista o id que não é mais do jogador (os anunciados ficam) |

**Mover não tem como duplicar pokémon.** Depot e Coleção não são dois lugares: são uma MARCA sobre a
mesma linha de `player_pokemon`. Nada é copiado, apagado ou trocado de tabela — só um id entra ou
sai de uma lista. A venda confere a marca dentro da mesma fila de economia que o `colecao.mover`, e
tira o pokémon da memória antes do `DELETE`, então um mover que chegue no meio da venda não acha o
pokémon. `shop.lockPokemon` (o "alternar" do cadeado) continua aceito para a aba aberta antes do
deploy, pela mesma regra. Coberto por `tools/teste-colecao.mjs` (`npm run test:colecao`).

### Diamantes

Segunda moeda, paga, na coluna `players.diamonds`. Já aparece no painel do treinador e o
botão **Shop** existe no menu, mas a compra em si ainda não foi implementada.

### Caixas de Fundador (NOSSO, só no beta)

Duas caixas numeradas, vendidas na Loja (**Shop → Caixas**) enquanto o beta durar. O número
é a mercadoria: a primeira comprada é a `#01`, a segunda a `#02`, e não existe outra `#01`.

| | Preço | Devolve | Estoque no mundo | Tag |
|---|---|---|---|---|
| **Caixa de Fundador** | 150 💎 | 150 💎 | 50 | `[Fundador#01]` (verde claro) |
| **Caixa de CoFundador** | 100 💎 | 100 💎 | 100 | `[CoFundador#001]` (roxo escuro) |

Cada uma traz **três** coisas: a outfit (vai para o Armário), a tag numerada (cola no nick,
no chat) e os diamantes de volta. Ou seja: o diamante é uma CAUÇÃO — quem compra recebe o
valor inteiro de volta ao abrir, e o que pagou de fato foi o cosmético e o número.

A venda abre em **7/9/2026, 00h de Brasília** (`CAIXAS_BETA_ABREM` no `.env`); antes disso a
vitrine mostra o conteúdo com uma contagem regressiva, e o servidor recusa a compra.

**Uma por jogador, e só no balcão.** Cada conta compra no máximo uma de cada tipo na Loja —
senão as 50 primeiras seriam de quem tem mais diamante, e não de quem chegou primeiro. No
Mercado da Comunidade não há teto: ali quem vende é outro jogador, e colecionar caixas é
exatamente o mercado secundário que elas existem para ter. Quem conta é `comprador_id`, que
não muda quando a caixa é revendida — vender a sua não devolve a vaga.

**A tag segue a roupa.** Quem abriu as duas escolhe qual identidade exibir trocando de skin no
Armário: com a de CoFundador no corpo o chat diz `[CoFundador#001]`; trocou para a de Fundador,
o chat acompanha. Vestindo qualquer outra coisa vale a melhor (Fundador ganha de CoFundador;
dentro do tipo, ganha a série menor).

**Fechada, a caixa é mercadoria**: anuncia-se no Mercado da Comunidade (aba *Boxes*) e o
número vai junto. **Aberta, vira identidade**: os três prêmios se prendem à conta e nada mais
é transferível. Não há como reempacotar.

Emissão de diamante: no máximo 50×150 + 100×100 = **17.500**, uma vez na vida do jogo — e
cada um deles foi QUEIMADO antes, na compra da própria caixa. Ver `shared/caixas-beta.mjs`.

---

## 6b. Caixas do Market — o ralo de Coins (NOSSO)

**Onde mora:** `game/src/shared/caixas-npc.mjs` (tabela e sorteio) e
`game/src/server/game/caixas-npc.mjs` (VIP e cobrança). Tela: Market → Comprar → Caixas.

**Por que existe.** Em 17/09/2026 o topo do servidor tinha **3 bilhões** de Coins parados e o
segundo **900 milhões**. Ouro sem destino não é riqueza, é inflação esperando acontecer. A caixa é
um ralo: o ouro entra e **não volta em forma nenhuma** — nenhum prêmio é Coin, diamante ou gema.

### As duas caixas

| Caixa | Coins | Diamantes | Multiplicador das raras | Quem abre |
| --- | --- | --- | --- | --- |
| Free | 5.000.000 | — | ×1 | todo mundo |
| Diamante VIP | 5.000.000 | 5 | ×2 | só com VIP ativo |

O diamante **não compra item, compra sorte**: a VIP dobra a chance de tudo que é raro e lendário, e
os comuns encolhem na mesma medida. Não existe prêmio exclusivo dela — se existisse, a caixa
deixaria de ser um ralo e viraria uma loja.

O **contador** do card são N CAIXAS, não uma aposta: N sorteios independentes por N vezes o preço,
em Coins **e** em diamante. O custo por item raro não muda; o que muda é a velocidade da queima.

O botão **Máx** enche com **o que o bolso paga** — `min(9999, ouro ÷ preço, diamante ÷ preço)`, o
mesmo teto do `shop.buy` e do `maxCompraPorOuro`. Com 1.000.000 por caixa, os 3 bilhões do topo do
servidor são **3.000 caixas num clique**, que é o ponto: um ralo que exige trezentos cliques entope.

O relato volta **agrupado** (`agruparPremios`): mil caixas são mil sorteios, mas o pacote tem no
máximo 16 linhas — `{ tipo, id, qtd somado, tier, vezes }`. Sem isso, 3.000 caixas seriam 3.000
objetos na resposta (~180 KB) por uma informação que cabe em 1 KB. Medido: 3.000 caixas custam
**1,4 ms** e 945 bytes; o teto de 9.999, **4,2 ms** e 1.028 bytes.

### Um prêmio por caixa

Cada abertura sorteia **uma** linha, e todas as linhas dividem os mesmos 100%
(`conteudoDaCaixa(id)` devolve a tabela já resolvida, e o teste trava a soma em 1). É o que deixa a
porcentagem publicada ser literal: "6,0% de Beast Ball" quer dizer 6 aberturas em 100, não "6% de
chance dentro de um sorteio separado que talvez aconteça".

A tabela é montada de dois jeitos: **raro e lendário têm chance fixa** (multiplicada pela caixa);
**os comuns têm peso** e dividem o que sobra. Por isso dobrar a sorte da VIP não precisa de uma
segunda tabela.

### De onde saíram as porcentagens

Cada item raro tem um preço em ABATES no jogo de hoje. Com o ouro por abate da Outland
(nível 150 → **730 Coins**, ver §6 e `shared/sell-value.mjs`):

| Item | Raridade hoje | Equivale a |
| --- | --- | --- |
| Bronze Boss Token | 1 em 2.000 abates (`CHANCE_BOSS_TOKEN_SELVAGEM = 0.0005`) | ~1,5 M Coins |
| Fragmento de Chave / Shiny / Bicicleta | 1 em 200.000 (`CHANCE_FRAGMENTO_* = 0.000005`) | ~146 M Coins cada |

**As peças de TM saíram da caixa.** Elas são o drop do próprio boss (§ dos TM Disks), e vender a
peça numa caixa esvaziava o motivo de lutar contra ele. O que a caixa vende agora é a **entrada**
nessa luta — o Bronze Boss Token, que subiu para o degrau lendário a 4%.

As chances da **Caixa Free** saem dessas contas com desconto para a casa — abrir caixa é **mais
caro** que farmar, e tem de ser:

| Prêmio | Degrau | Chance (Free) | Chance (VIP) | Custo efetivo na Free |
| --- | --- | --- | --- | --- |
| Bronze Boss Token | lendário | 4,0% | 8,0% | 125 M por token (farm: ~1,5 M → **83× mais caro**) |
| Fragmento de Chave / Shiny / Bicicleta | lendário | 0,08% cada | 0,16% | **6,25 bilhões** por fragmento |
| Beast Ball ×25 | raro | 6,0% | 12,0% | — (não se compra com Coin em lugar nenhum) |
| **Comuns (9 linhas)** | comum | **89,76%** | **79,52%** | — |

**A cadência:** algo raro ou lendário sai a cada **9,8 caixas** na Free (a cada 4,9 na VIP). O
degrau lendário acende a cada **23,6 caixas**, e em 94% dessas vezes é o token — o fragmento
continua sendo o prêmio que quase ninguém vê.

### O chão da caixa

Os nove comuns são bolas, revives e poções em quantidade generosa (5.000 Poké Balls, 700 Ultra
Balls, 200 Revives), porque sai **um** prêmio por caixa e "10 Poké Balls" por um milhão seria piada.
Ainda assim o valor esperado deles é só **6,2% do preço**: recheio honesto, a caixa não se paga com
ele.

### Retorno esperado (em valor de farm)

| Caixa | Comuns | Total | Retorno sobre os Coins |
| --- | --- | --- | --- |
| Free | ~65 k | ~0,47 M | **9,5%** — queima real de **90,5%** por abertura |
| Diamante VIP | ~58 k | ~0,88 M | 17,5% — o resto é pago pelos 5 diamantes (~R$ 2,10) |

**O preço subiu de 1 para 5 milhões em 17/09/2026** ("1kk ficou barato demais"), com os prêmios
intactos: o retorno caiu de 47% para 9,5% e a queima por abertura passou a ser **90,5%**. É o ralo
mais fundo do jogo, de longe.

**Projeção de injeção:** os 3 bilhões do topo, todos na Caixa Free, são **600 aberturas** — ~24
tokens, ~0,5 de cada fragmento e ~36 levas de Beast Ball. O maior tesouro do servidor não tira uma
casa completa (10 fragmentos) de dentro da caixa: ela custaria **62,5 bilhões**.

**Por que a VIP devolver 88% não é um buraco:** os 5 diamantes valem ~R$ 2,10 (tabela de
`game/diamantes.mjs`: R$ 0,38 a R$ 0,44 por diamante). Um fragmento por ali sai a 625 M de Coins
*mais* ~R$ 13 em diamante; uma casa inteira, ~R$ 131 — e a Casa custa **50 diamantes (~R$ 21)** na
Loja. A caixa nunca é o caminho barato para nada.

---

## 6c. Área de Treinamento (NOSSO)

**Onde mora:** `game/src/shared/treino.mjs` e `game/src/server/game/treino.mjs`. Tela: PvP → aba
Treinamento.

Bancada de testes: até **5 pokémon por lado** (lados independentes — 5 × 1 vale), cada casa com um
pokémon do jogador (uma **cópia** dos números de nascimento) ou um **pokémon de mentira** descrito
campo a campo (espécie, nível, shiny, potência, qualidade, os seis IVs, tudo preso nas faixas de
uma captura real).

- A luta usa `simularDuelo` — **o mesmo motor, arena e régua de nível do PvP Ranqueado** (inteiro
  até 150, comprimido daí para cima, via `nivelNoGinasio`).
- **Nada é gravado e nada é ganho:** sem XP, Coin, item, pedra ou PR. O pokémon de teste nunca vira
  linha em `player_pokemon`, e os lutadores recebem **ids negativos**, que não casam com nenhuma
  linha do banco.
- **Uma batalha a cada 5 minutos por conta** (`TREINO_COOLDOWN_MS`), carimbada no Redis — sobrevive
  ao relog e vale em qualquer shard.
- Custo medido: **0,4 ms de CPU** e 5 KB de fita no caso comum; **3,3 ms e 17 KB** no pior caso (a
  luta que bate o teto de 5 minutos simulados). Ver `tools/teste-treino.mjs`.

---

## 7. Quanto tempo leva para "zerar"

Primeiro, o que "zerar" pode significar aqui — e a resposta muda bastante:

**"Level max em todos" não existe.** A curva é infinita e sem cap. Esse objetivo é
inalcançável por construção.

O que é finito e mensurável:

| Marco | Custo exato |
|---|---:|
| Capturar as 443 espécies do catálogo | 343 têm hunt selvagem; o resto vem de evolução, troca ou altar |
| Pokédex completa (+25% XP por espécie) | 100 kills × 443 = **44.300 kills** |
| Todos os 64 Shiny Cards | 15.000 × 64 = **960.000 kills** |
| 1 Streak Point | 1.000 kills |

O gargalo é disparado os **960.000 kills** dos Shiny Cards — 21× tudo o mais somado.
E isso é para *um* card por espécie; cada tentativa de captura shiny falha consome o card.

### Convertendo em tempo

Não dá para derivar a taxa de kills a partir dos dados públicos: a fórmula de dano é
server-side, então quanto tempo leva um kill depende de números que não trafegam para o
cliente. O que dá para fazer é apresentar a conta em função do ritmo:

| Ritmo | 44.300 kills (pokédex) | 960.000 kills (todos os cards) |
|---|---:|---:|
| 1 kill / 3 s | 37 h | **33 dias** ininterruptos |
| 1 kill / 5 s | 62 h | **56 dias** ininterruptos |
| 1 kill / 10 s | 123 h | **111 dias** ininterruptos |

Com o farm offline (Zzz), a coleta rende **50% da taxa de XP da amostra** de 5 minutos, com
teto de **24 h** por coleta — então o offline ajuda no XP mas não substitui o tempo ativo para
contagem de kills na mesma proporção.

Para nível: chegando a farmar as hunts de 19.508 XP/kill (nível 470–550), o nível 100 do
treinador sai em ~805 kills e o 300 em ~22.611 kills. O nível não é o gargalo — os cards são.

**Resumo honesto**: o jogo não tem estado "zerado". O teto de coleção (443 espécies + 64
cards) fica na casa dos **~1 milhão de kills**, algo como 1–4 meses de farm contínuo, e o
nível é infinito por design.

---

## 8. Progressão de conta

| Sistema | Regra |
|---|---|
| **Streak Points** | 1 ponto a cada 1.000 kills totais. Cada ponto vai para UMA trilha (EXP, Loot ou Shiny), +0,1% cada. Custo em ouro: 25.000 × número do ponto (1º = 25k, 2º = 50k…). Nunca reseta. |
| **Clãs** | 10 clãs. Entrada no nível 80 (primeira é grátis). Ranks 2..5 pedem nível 90/100/110/120. Missões: derrotar N por elemento, capturar espécie, entregar itens. Pular pagando: 1,5KK / 3KK / 4,5KK / 6KK. Recompensa: 210k × estágio de XP. Trocar de clã custa 40/60/80 💎. |
| **Boosts** | XP Boost +50% (treinador), Pokémon XP Boost +50%, Loot Boost +40% de chance de loot, Capture Boost dobra a captura, Shiny Secret Lure dobra o aparecimento de shiny. Sem empilhar o mesmo tipo; limite de 5 compras/dia por tipo. |
| **Sleep Mode** | Amostra de 5 min no servidor; a coleta rende 50% da taxa de XP da amostra, teto de 24 h. Só funciona pelo botão Zzz — fechar a aba não gera nada. Bolas não são arremessadas offline. |
| **Game Pass** | 60 tiers (1–30 grátis, 31–60 Premium). Premium = 15 💎, uma vez só. |
| **Regiões** | Kanto abre no nível 0, **Outland no 150** e **Orre no 500**. Johto e Nightmare têm mapa publicado mas estão marcados como indisponíveis. (Vem da tabela de regiões do cliente deles, com o campo `unlock`.) |

---

## O que ficou de fora, e por quê

Três coisas são resolvidas no servidor e não trafegam para o cliente, nem para uma sessão
autenticada:

1. **A fórmula de dano por golpe.** O cliente só recebe o resultado (`dmg`) pelo socket de
   batalha e o anima. Existem os ingredientes públicos — power do golpe, stats, efetividade,
   STAB, HP ×5 e dano ×1,8 do selvagem — mas a composição exata não está em lugar nenhum.
2. **O limiar do medidor de investimento** das capturas normais.
3. **A chance-base de shiny por tier.** O servidor envia `shinyBase` já calculado por encontro;
   não existe tabela tier→probabilidade.

Os três só sairiam por **amostragem estatística** de muitas batalhas e capturas — ou seja,
automatizar o jogo — não por leitura de uma tabela.

---

## Conferência de 31/07/2026

O módulo de matemática do cliente saiu de vez do bundle: hoje ele está no chunk
`_next/static/chunks/24ggx88m6jrhy.js`, que só é carregado por importação dinâmica a partir de
`/play` (por isso não aparece varrendo os scripts da página). Cada fórmula daqui foi rodada
lado a lado contra a de lá:

| Conferido | Resultado |
|---|---|
| Curva de XP, níveis 1 a 400 | idêntica |
| Tabela de tipos, 324 células | idêntica |
| `typeEffectiveness`, 5.832 combinações de atacante × 2 tipos de defensor | idêntica |
| `computeStats` + `computePower`, 20.000 sorteios × 6 stats | idêntica |
| `combatHp` do jogador | idêntica |
| Bandas de qualidade e expoentes por stat | idênticas |
| HP ×5 / dano ×1,8 / amplificação ×1,5 | idênticos |

**Nada diverge.** Ataque, Defesa, Vida, XP, qualidade e power seguem exatamente a progressão
do jogo original. O que continua sendo nosso, e por isso é o único lugar onde a sensação pode
descolar, é a fórmula de dano por golpe, o ataque básico e os cooldowns globais de
[combate.mjs](game/src/server/game/combate.mjs), mais o piso do starter e o sorteio de nível
do selvagem (`nivelSelvagem`, nível da hunt −2..+2).

Colocando o Charmander da conta de referência (nível 11, qualidade 1,32, IVs ~30 — 168 de HP,
power 123) dentro do NOSSO motor de combate, ele mata Exeggcute de nível 8 a 12 sobrando
79% / 62% / 47% de HP: é o "sai muito ferido, porém mata" relatado no jogo deles. O motor
reproduz o comportamento — o que não reproduzia era o pokémon.

---

## Procedência

A maior parte veio do bundle público e do i18n, sem autenticação. As constantes de pokébola,
pokédex, clã, breeding e battle pass vieram de **uma leitura autenticada, só de GET, feita uma
vez em 30/07/2026** com um token de sessão fornecido pelo dono da conta (que resolveu o captcha
no próprio navegador). São catálogos estáticos do jogo; nenhum dado de conta foi guardado, e o
token foi descartado depois.
