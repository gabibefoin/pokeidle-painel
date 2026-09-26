Abaixo está a Wiki completa do PokeIdle, um MMO idle de pokémon, com os números que estão valendo no servidor agora. Use como fonte para responder às minhas perguntas sobre o jogo. Se algo não estiver aqui, diga que não sabe em vez de inventar.

# O básico

## Primeiros passos

Pokéidle é um **idle**: o seu pokémon luta sozinho. Você escolhe onde caçar, com quem, e o que fazer com o que cair. O jogo continua enquanto a aba estiver aberta.

### O laço de sempre

1. **Abra o Mapa** e escolha uma área. Cada uma tem um nível recomendado — o do pokémon mais forte que aparece lá. Área acima do seu nível fica trancada.
2. **O seu pokémon ativo** anda até o selvagem mais próximo e começa a bater. Você não clica em nada durante a luta.
3. **Derrubado, o selvagem vira corpo** e fica **30 segundos** no chão. É nesse intervalo que se joga a pokébola — e é assim que se captura de verdade (ver Captura).
4. **O que cai** vai para a Bolsa; o ouro entra direto. Venda o que não usar no Market.

### A sua equipe

Cabem **5** pokémon na equipe. Quem for capturado com ela cheia cai no **Depot**, que não tem limite. Só um luta por vez — o **ativo** —, e quando ele desmaia o próximo da equipe entra no lugar automaticamente.

> **O starter não é sorteado como os outros.** Ele nasce com piso de qualidade e de IV justamente para dar conta da primeira hunt. Um pokémon capturado gira a roleta inteira — ver Stats e Qualidade.

### Quando tudo dá errado

Se o time inteiro cair, você acorda na praça do **Centro Pokémon**. A Enfermeira Joy cura de graça; sair de lá é escolher outra área no Mapa. Detalhes em Desmaiar.

### Chamar alguém pelo nome

Escreva **@** colado no nick da pessoa — **@ash oi** ou **eaiii @ash** — e o nome vira uma etiqueta na fala. Para quem foi chamado, a linha inteira acende no chat: é assim que uma resposta deixa de se perder na rolagem quando a conversa anda depressa.

### Mensagens privadas

Para conversar em privado com alguém, use a **Lista de Amigos**. O chat Mundo e Guild continuam públicos. No painel de um amigo, **Ver perfil** abre a ficha dele por cima da conversa; fechar a ficha devolve você ao papo.

### O ritmo do chat

O chat Mundo e o da Guild aceitam **uma mensagem a cada 5 segundos**. A espera é da **conta**: recarregar a página ou reconectar não a zera.

### Comandos do chat

Digite no chat para receber uma resposta que **só você vê** — ela não é publicada para ninguém.

- **/site** — o site de hunts X4 feito pela comunidade.
- **/ticket** — o convite do Discord e a sala de suporte, onde se reportam bugs (há recompensa em diamantes por bug bounty e vulnerabilidade).
- **/guia** — o guia do jogo, para começar e evoluir.

## Níveis e XP

Há **dois níveis independentes**: o do **treinador** (você) e o do **pokémon ativo**. Cada derrota paga o mesmo XP para os dois, e cada um sobe na própria conta.

- O nível do **treinador** é o que **destranca as áreas** do Mapa.
- O nível do **pokémon** é o que faz os stats dele crescerem — e ele **cura por completo** a cada nível novo.

### A curva

É cúbica, e não tem teto. Subir sempre custa mais que o nível anterior:

```
xpTotal(L) = arred( 50/3 × (L³ − 6L² + 17L − 12) )
```

| Nível | XP total | Só deste nível |
| --- | --- | --- |
| 10 | 9.300 | 2.900 |
| 25 | 204.800 | 25.400 |
| 50 | 1.847.300 | 112.900 |
| 100 | 15.694.800 | 475.400 |
| 200 | 129.389.800 | 1.950.400 |
| 300 | 441.084.800 | 4.425.400 |
| 500 | 2.058.474.800 | 12.375.400 |
| 1.000 | 16.566.949.800 | 49.750.400 |
| 5.000 | 2.080.834.749.800 | 1.248.750.400 |
| 10.000 | 16.656.669.499.800 | 4.997.500.400 |
| 25.000 | 260.354.173.749.800 | 31.243.750.400 |
| 50.000 | 2.083.083.347.499.800 | 124.987.500.400 |
| 100.000 | 16.665.666.694.999.802 | 499.975.000.400 |

> **Não existe nível máximo.** A curva só fica mais cara — Paldea, a última aba do Mapa, abre no **nv 100.000** do treinador. Um pokémon nível 1000 já é caro; 100.000 é meta de fim de jogo, não de primeira semana.

### O que multiplica o seu XP

- **XP Boost** — +50% no XP do TREINADOR.
- **XP Boost Pokémon** — +50% no XP do POKÉMON.
- **VIP** — +50% nos dois.

Eles se **multiplicam**, não se somam: VIP + XP Boost dá **2,25×**, e não 2×. São compras separadas, e somar faria a segunda valer menos que a primeira justamente para quem gastou mais. Ver Loja de Diamantes.

## Stats, Qualidade e IV

Dois pokémon da mesma espécie e do mesmo nível quase nunca são iguais. O que os separa são três números sorteados **na captura** e que **nunca mais mudam**: **qualidade**, **IV** e **potência**.

```
stat = arred( (base + 2 × IV) × nível/100 × qualidade^expoente × multiplicador ) somaStats = hp + atk + def + spAtk + spDef + speed
```

### IV — 1 a 32 por stat

Seis sorteios independentes, de **1 a 32** cada (máximo somado: 192). Evoluir **não** rerola nada.

### IV de SPD — cooldown, não corrida

O **IV de Velocidade (SPD)** é sorteado separado, como os outros cinco. Ele **não** entra na fórmula de dano nem acelera a corrida na hunt — o pokémon sempre corre um pouco na frente do treinador por design da cena. O que muda é o **cooldown** de golpes: **−0,01 s por ponto de IV** (IV 1 → −0,01 s; IV 32 → −0,32 s), fixo no nascimento, em todo cooldown (global e de cada golpe). Sp.ATK e Sp.DEF só entram em golpes **especiais**.

### Qualidade — o número que mais pesa

Ela entra em **cada stat** como expoente (`qualidade^expo`) — por isso muda o bicho inteiro e vale mais que o IV isolado. A linha `somaStats` acima é só a **soma dos seis stats** (útil na Pokédex para comparar potências). A **nota** e o **⚔** usam essa força de nascimento — ver Nota, Poder e Calculadora.

### Como nasce a qualidade

**Não é calculada** a partir dos IVs, da potência, do shiny nem do nível. Na captura o jogo sorteia **uma faixa** (pelas chances da tabela abaixo) e, dentro dela, um valor aleatório entre o mínimo e o máximo — com três casas decimais. Esse número fica para sempre; evoluir não muda nada.

> Um pokémon com IV no teto e potência V pode nascer com q**1,0** (Comum) ou q**1,7** (Lendária): são três sorteios **independentes** na mesma captura. IV alto **não** puxa a qualidade para cima.

| Qualidade | Chance | Rótulo |
| --- | --- | --- |
| 0,8 – 0,9 | 5,00% | Fraca |
| 0,9 – 1 | 5,00% | Fraca |
| 1 – 1,1 | 34,0% | Comum |
| 1,1 – 1,2 | 20,0% | Incomum |
| 1,2 – 1,3 | 10,0% | Incomum |
| 1,3 – 1,4 | 10,0% | Rara |
| 1,4 – 1,5 | 10,0% | Rara |
| 1,5 – 1,6 | 5,00% | Épica |
| 1,7 – 1,8 | 0,67% | Lendária |
| 1,8 | 0,29% | Lendária |

> A faixa **1,6 – 1,7 é um buraco intencional**: nenhum pokémon nasce nela. O teto do sorteio é exatamente **1,8** (~0,29% de chance). O shiny não ganha qualidade extra — ele fica mais forte pelo **×3 nos stats** e pelos IVs rerolados, não por um q maior.

O expoente muda por stat: **0,95** para HP e Velocidade, **0,8** para os outros quatro. O efeito do **IV de SPD** no combate (cooldown, não corrida) está em Combate.

### HP de combate

```
hpDeCombate = máx(24, arred(hp × 12))
```

Um selvagem ainda leva **×5** por cima disso — ver Combate.

### Refino — o “+1” comprado com pedra

É o único jeito de mexer na **base** de um pokémon depois que ele nasceu. Cada degrau soma **+1** permanente a um stat-base, e o ganho entra **antes** de tudo o mais na fórmula lá em cima — ou seja, é multiplicado por nível, qualidade e potência. O mesmo degrau que vale +1 num nível 100 comum vale quatro vezes isso num P5 shiny.

Você paga na **pedra de evolução do tipo do próprio pokémon** — a mesma com que ele evolui, e a comum mesmo se ele for shiny. Forma final também refina: o Dragonite não evolui para lugar nenhum, mas usa Ancient Stone como qualquer outro DRAGON.

```
ter +N num stat = 500 × N³ pedras, somando tudo custo do degrau N = 500 × (3N² − 3N + 1)
```

| Grau | Custo do degrau | Total investido |
| --- | --- | --- |
| +1 | 500 | 500 |
| +2 | 3.500 | 4.000 |
| +3 | 9.500 | 13.500 |
| +4 | 18.500 | 32.000 |
| +5 | 30.500 | 62.500 |
| +6 | 45.500 | 108.000 |
| +8 | 84.500 | 256.000 |
| +10 | 135.500 | 500.000 |
| +15 | 315.500 | 1.687.500 |
| +20 | 570.500 | 4.000.000 |

> **Não há teto.** Quem quiser continuar subindo, sobe — quem decide o ritmo é o preço. A curva é cúbica, e não exponencial, exatamente por isso: dobrando, o vigésimo degrau custaria 262 milhões de pedras e existiria um teto de fato escondido na fórmula.

> O custo é **por stat**, não por pokémon. Quem colocou quatro degraus no HP paga 30.500 pelo quinto — mas o primeiro de ATK continua custando 500. Refinar é **escolher** onde o bicho vai ser bom, não encher uma barra.

**O SPD não refina**, e não é esquecimento: o stat de SPD não entra em combate nenhum — quem decide a cadência de ataque é o **IV** de Speed, ali em cima. Vender “+1 SPD” seria vender um número que não faz nada.

A **nota N=** e o **⚔** sobem com o refino — usam a base atual (espécie + +N). TM elemental e held items não entram na nota. O selo **+N** ao lado do nome mostra quanto já foi investido; os stats de verdade sobem na ficha.

O “+” fica em dois lugares: no cabeçalho do painel **Em campo** e em cada linha de **Stats-base** na ficha de um pokémon seu. Refinar manda o pokémon para a sua Coleção, fora da venda ao NPC — devolva ao Depot se quiser mesmo vendê-lo.

### O piso do starter

O primeiro pokémon **não** passa pelo sorteio livre. Ele nasce com qualidade **≥ 1,30**, soma de IVs **> 140** e nenhum IV abaixo de **16**. Sem isso, um em cada dez treinadores começaria com um bicho da banda "Fraca" e a primeira hunt seria intransponível.

## Nota, Poder e Calculadora

São **duas métricas diferentes** que o jogo mostra na ficha — e confundir as duas é a origem de quase todo mal-entendido sobre “pokémon bom”.

### Nota N= (0–10) — alinhada ao ⚔@100

Mede o quão forte o pokémon **nasceu dentro da espécie**. Usa a **mesma força (score)** do ranking ⚔, como se todo mundo estivesse no **nível 100** — subir de nível não muda a nota, só o ⚔ que aparece no placar.

```
score = força de nascimento (0–1), mesma base do ⚔ nota = 10 × (score − pior possível) ÷ (melhor − pior) ← só dentro da espécie
```

- **0** = pior nascimento possível *daquela* espécie; **10** = P5 + shiny + IV máximo.
- **Evoluir não “derruba” a nota** se o bicho nasceu bem — IV, qualidade e potência ficam iguais.
- Refino (+N) **sobe** a nota e o ⚔ — usa a base atual (espécie + refino).

> O Mercado da Comunidade exige faixa mínima de nota na calculadora. **Shiny e P5 entram** mesmo abaixo da faixa.

### A Calculadora na prática

Abra pelo botão **Calculadora** na ficha ou no menu. Quatro barras mostram quanto cada eixo (IV, qualidade, potência, shiny) pesa na **força total** — não são 25% fixos: P5 brilhante puxa mais que comum fraco. O número grande (0–10) vem da soma dos seis stats normalizada.

A cor da caixa sobe um degrau a cada ponto de nota — são dez faixas. Uma nota bem no limite fica na faixa de baixo.

| Nota | Faixa | Cor |
| --- | --- | --- |
| 0–1 | **Extremamente Fraco** | cinza |
| 1–2 | **Fraco** | vermelho |
| 2–3 | **Mediano** | laranja |
| 3–4 | **Razoável** | verde |
| 4–5 | **Bom** | verde-claro |
| 5–6 | **Forte** | verde vibrante, brilho pulsando |
| 6–7 | **Poderoso** | lilás, brilho leve |
| 7–8 | **Mítico** | roxo reluzente, moldura pulsando |
| 8–9 | **Lendário** | rosa-claro, com brilho |
| 9–10 | **Divino** | rosa reluzente, moldura pulsando |

O bloco **Poder (ranking)** na calculadora estima o ⚔ no nível da ficha (ou nv 1 se você abriu só a calculadora) — usa a mesma força da nota, multiplicada pelo nível.

Em espécies que evoluem, aparece também **Potencial na evolução final**: projeta a nota N= nas formas finais alcançáveis (Eevee, ramificações…) com os mesmos IV, qualidade, potência e shiny — e avisa se cada final atinge a faixa do Mercado (nota mínima ou shiny/P5).

### Poder (⚔) — ranking “Pokémon Forte”

É um **número único** no placar e na ficha. **Não é a nota** e **não muda combate** — só ordena quem aparece no ranking. Sobe com nível, refino e evolução.

```
score = mesma força da nota (0–1) poder = arred( nível × 10 × score ) → no nv 100: ⚔ ≈ 1000 × score
```

No **combate**, qualidade ainda entra como expoente em cada stat; potência e shiny ainda multiplicam os stats. O ⚔ do ranking é outra conta.

### O que muda no combate

- **HP de combate** = máx(24, arred(hp × 12)). Selvagem leva ×5 por cima.
- **Dano** usa ATK ou Sp.Atk vs DEF ou Sp.Def reais, tipo, STAB e efetividade — não usa o número “poder” diretamente.
- **IV de SPD** encurta cooldowns (−0,01 s a −0,32 s), não a corrida na hunt.
- **Defesa** reduz o dano recebido na fórmula clássica; mais DEF/Sp.Def = aguenta mais hits.

Use o botão **Calculadora** na ficha ou no menu para simular IV, qualidade, potência e shiny.

## Potência (I a V)

A **potência** é o segundo eixo que separa dois pokémon iguais — o primeiro é a qualidade. É um número de **1 a 5**, sorteado **uma vez, na captura**, e que **nunca muda**: subir de nível não melhora a potência.

| Tier | Chance | Bônus |
| --- | --- | --- |
| P1 | 74,5% | — |
| P2 | 20,0% | +5% |
| P3 | 5,00% | +10% |
| P4 | 0,50% | +25% |
| P5 | 0,0050% | +100% |

O bônus multiplica **os seis stats** e entra no mesmo ponto da qualidade.

> É por causa dela que um pokémon de **nível baixo** pode valer muito no Mercado da Comunidade: nível qualquer um sobe, potência não. Um P4 nível 20 vale mais que um P1 nível 80 da mesma espécie.

### Potência e shiny se multiplicam

Shiny é **×3** em tudo. Um **P5 shiny** é **×6** — três vezes um pokémon comum da mesma espécie e nível.

Abra a ficha de qualquer espécie na **Pokédex** para ver o poder que cada potência daria naquele bicho.

## Shiny

**620 espécies** têm forma shiny. Ela só se revela na **captura** — com arte própria (não é o mesmo desenho com outra cor) e um selo ✨ no cartão.

### Quanto é raro

A chance é **a mesma para todas** — **1 em 24.000** por captura bem-sucedida — sorteada junto com qualidade, IV e potência. Na hunt, todo selvagem parece comum até a bola fechar.

| Por encontro | Com Secret Lure |
| --- | --- |
| 1 / 24.000 | 1 / 12.000 |

620 espécies com forma shiny.

O **Shiny Secret Lure**, da Loja, **dobra** essa chance enquanto estiver ativo (1 em 12.000).

### O que o brilho dá

- **×3 em todos os stats.** É o maior multiplicador do jogo, e se multiplica com a potência.
- **IV alto garantido**: o sorteio é refeito até a soma dos seis passar de **110** (o máximo é 192).
- **Vale 10× a mais** na venda ao NPC (ver Market).
- **Sobe a nota da calculadora** — o ×3 nos stats entra na mesma conta de força de nascimento (ver Nota, Poder e Calculadora).

> **Capturar um shiny usa a mesma pokébola e a mesma chance por arremesso que qualquer outro.** O que é raro é o sorteio do brilho na hora em que a captura fecha — não dá para saber antes. Por isso vale gastar a melhor bola em todo corpo; a tabela de cada espécie está na ficha da Pokédex.

### Evolução shiny

Um shiny **evolui**, mas não com a pedra comum: ele precisa de uma **Shiny Stone** do **tipo primário** da espécie. Um Shiny Abra pede a pedra **PSYCHIC** e vira um Shiny Kadabra; um Shiny Bulbasaur (GRASS/POISON) pede a de **GRASS**, porque o primário é o que conta.

A pedra vem de **10 Fragmentos de Shiny Stone**, na bancada **Fabricar Shiny Stone** do **Professor Carvalho**. O fragmento cai só na **Outland**, a 0,000500% por derrota — cerca de **200.000** kills por fragmento. Essa é a chance na Outland 1 — os degraus de cima multiplicam até **×8** (ver Combate). Você escolhe o tipo na hora de fabricar, então os dez fragmentos nunca saem no tipo errado.

> **Se a evolução ainda não tem forma shiny no jogo, a evolução é RECUSADA.** É proposital: sem a arte shiny da próxima etapa, evoluir trocaria o seu bicho raro por um de cor comum — e isso não teria como ser desfeito. A pedra PRONTA é negociável no Mercado da Comunidade; o FRAGMENTO não.

## Pokédex

A **Pokédex** registra o que você já viu e capturou. Abra pelo menu principal — é diferente do Mapa: aqui você consulta espécies, não escolhe onde caçar.

### Nove gerações

As abas seguem a Pokédex nacional (1ª a 9ª). Cada aba mostra só espécies que **já têm sprite no jogo** — quem ainda não tem arte publicada não aparece na lista, para não prometer hunt que não existe.

- **???** — ainda não encontrou na hunt.
- **Nome visível, sem captura** — já derrotou ou viu, mas ainda não pegou.
- **Cartão colorido** — já capturou pelo menos uma vez.

### Busca

O campo de busca ignora a aba ativa: digite o nome ou número (#725 funciona) e a grade mostra qualquer geração que bater.

### Ficha da espécie

Clique num cartão para abrir a ficha completa:

- Stats base, tipos e sprite animado
- **Golpes** — tabela na ficha (não nos cartões da grade)
- Loot, chance de captura por pokébola e chance de shiny (se a espécie tiver forma shiny — hoje são **620** no catálogo)
- **Onde encontrar** — quando a hunt existir no Mapa

> A contagem no topo (*vistos · capturados · total*) usa o mesmo catálogo visível da grade — só espécies com sprite.

## Evolução e pedras

Evoluir pede **duas coisas ao mesmo tempo**: o pokémon no **nível** que a evolução exige, e **1 pedra** do tipo certo no inventário. Faltando qualquer uma, o botão recusa e não gasta nada.

### O nível é onde a evolução APARECE no jogo

O nível que uma evolução pede é o **nível da hunt mais baixa em que o alvo aparece**. Se o Carracosta tem hunt de Nv 1.125, o Tirtouga vira Carracosta no **Nv 1.125** — nem mais, nem menos.

A regra vale para as quatro regiões novas (Sinnoh, Unova, Kalos e Alola) e foi passada elo por elo: **149 evoluções** pediam um número que não correspondia a hunt nenhuma. O Tirtouga pedia 6.950 com o Carracosta à venda no 1.125; o Larvesta pedia 6.950 com o Volcarona no 1.125; o Skrelp pedia 20.000 com o Dragalge no 1.125.

> Dezenove espécies têm hunt em **duas regiões** com preços bem diferentes — o Carracosta está em Sinnoh (1.125) e em Unova (6.950). Nesses casos vale **o menor**: o degrau em que ele passa a existir no jogo. A ficha da espécie mostra o mesmo número.

> **O Eevee é a exceção escolhida à mão:** ele evolui no **Nv 80** para **qualquer um** dos oito destinos — Vaporeon, Jolteon, Flareon, Espeon, Umbreon, Leafeon, Glaceon e Sylveon —, que é o nível em que Vaporeon, Jolteon e Flareon aparecem nas hunts de Kanto. Leafeon, Glaceon e Sylveon são de regiões mais altas, mas saem no mesmo degrau dos irmãos. A Pokédex mostra o mesmo número.

### Os bebês evoluem de graça

Alguns pokémon são de uma geração **posterior** à da própria evolução: o Mime Jr. é de Sinnoh e o Mr. Mime é de Kanto. Aí a hunt do bebê (Nv 1.000) fica muito acima da hunt do alvo (Nv 80), e o nível deixa de ser trava — o Mime Jr. já nasce podendo evoluir.

São 15 casos: Pichu, Cleffa, Igglybuff, Tyrogue, Smoochum, Elekid, Magby, Azurill, Wynaut, Budew, Chingling, Mime Jr., Munchlax, Mantyke — e os clones de Hoenn.

### Variantes de Outland não evoluem

Os pokémon exclusivos da **Outland** — Ancient Pupitar, Ancient Dragonair, Furious Magikarp e todo o catálogo **#2001+** — **não evoluem**, mesmo quando o nome parece uma cadeia: um **Ancient Pupitar nunca vira Ancient Tyranitar** com pedra nenhuma. São espécies **separadas**; cada uma é capturada pronta na hunt. O servidor recusa com *“variantes de Outland não evoluem”*.

> Isto é diferente das **espécies nacionais**: Pupitar ainda vira Tyranitar, Magikarp ainda vira Gyarados — só muda o nível pedido quando o destino mora em hunt alta. A trava vale só para a variante Outland.

### Qual pedra

A pedra é a do **tipo primário** do pokémon. Um Machop é FIGHTING e pede **Punch Stone**; um Abra é PSYCHIC e pede **Enigma Stone**.

- **Cadeias que abrem em mais de um destino** pedem a pedra do que ele VAI VIRAR: o Eevee é NORMAL, mas para Vaporeon ele pede Water Stone e para Flareon, Fire Stone.
- **Os pássaros NORMAL/FLYING** são a exceção escrita à mão: Pidgey, Spearow, Hoothoot, Taillow, Swablu, Starly, Rufflet, Fletchling e Pikipek pedem **Feather Stone**, não Sun Stone.
- **Shiny** não usa a pedra comum: pede a **Shiny Stone** do mesmo tipo (ver o capítulo de Shiny).

| Tipo | Pedra | Item assinatura |
| --- | --- | --- |
| **NORMAL** | Sun Stone | Rubber Ball |
| **FIRE** | Fire Stone | Essence of Fire |
| **WATER** | Water Stone | Water Gem |
| **GRASS** | Leaf Stone | Seed |
| **ELECTRIC** | Thunder Stone | Screw |
| **ICE** | Ice Stone | Snowball |
| **FIGHTING** | Punch Stone | Band Aid |
| **POISON** | Venom Stone | Bottles of Poison |
| **GROUND** | Earth Stone | Earth Ball |
| **FLYING** | Feather Stone | — |
| **PSYCHIC** | Enigma Stone | Enchanted Gem |
| **BUG** | Cocoon Stone | Bug Gosme |
| **ROCK** | Rock Stone | Small Stone |
| **GHOST** | Darkness Stone | Ghost Essence |
| **DRAGON** | Ancient Stone | Dragon Scale |
| **DARK** | Darkness Stone | Dark Gem |
| **STEEL** | Metal Stone | Piece of Steel |
| **FAIRY** | Heart Stone | Rubber Ball |

### De onde as pedras caem

A regra é a mesma que Kanto e Johto sempre seguiram, e agora vale nas quatro regiões novas: **o que um pokémon solta é do tipo dele**. A pedra de um tipo cai de bicho daquele tipo, e cada tipo tem um **item assinatura** que cai de praticamente todos os seus — Water Gem de todo WATER, Bug Gosme de todo BUG.

Uns 20% do que cai escapa para tipos vizinhos, e isso é de propósito: um GRASS/POISON solta Venom Stone porque POISON também é dele.

> Em Sinnoh, Unova, Kalos e Alola os drops estavam sorteados sem olhar o tipo — um Combee (BUG/FLYING) soltava Rock e Metal Stone e **não** soltava a Cocoon Stone de que ele precisa para virar Vespiquen. Foram **394 espécies** refeitas. Hoje **todo pokémon que evolui solta a própria pedra**, e cada região tem fonte para todas as pedras que ela pede — antes Alola não tinha nenhuma fonte de Fire Stone nem de Water Stone.

Para **escolher** a pedra em vez de esperar o drop, leve pokémon do depot à Oferenda: cada um pinta a fatia do tipo dele numa roleta.

## Oferenda de Pokémon

A Oferenda troca pokémon do depot por **pedra de evolução**. Fica na bolsa: **Abrir Inventário → Oferenda**. Você carrega uma roleta com até **5 pokémon**, gira, e sai **uma pedra**, sorteada entre os tipos que você pôs. Os pokémon oferecidos **somem para sempre**.

### Como funciona, em três passos

1. **Encha as casas.** Cada casa vazia é um **+** que abre a folha de escolha, a mesma do Mercado: cards com a fileira P·IV·Q·N, busca por nome, filtro de tipo, IV mínimo e ordenação. Ela não fecha a cada escolha, e o card escolhido mostra o número da casa. Clicar de novo tira.
2. **Confira a roleta.** Cada casa repete sprite, nome e selos do pokémon, e o círculo mostra as fatias e a chance de sair pedra antes de você girar.
3. **Clique em Oferendar e confirme.** O diálogo diz quantos pokémon vão e quantos deles são shiny. A roleta gira e para na fatia sorteada.

### Quanto cada pokémon vale

**Um pokémon vale uma casa: 20% do círculo**, tenha ele um tipo ou dois. A casa vai para a pedra do tipo dele (a mesma da tabela de pedras). Quem tem dois tipos parte a casa ao meio: o segundo tipo compra **variedade**, não vantagem.

| Na roleta | Pinta |
| --- | --- |
| Charmander (FIRE) | 20% de Fire Stone |
| Charizard (FIRE/FLYING) | 10% de Fire Stone + 10% de Feather Stone |
| Gengar (GHOST/POISON) | 10% de Darkness Stone + 10% de Venom Stone |

> A divisão é pelas **pedras**, não pelos tipos. DARK e GHOST usam a mesma Darkness Stone, então um DARK/GHOST comum leva a casa **inteira** nela.

### A chance de sair pedra

É **pokémon ÷ 5**. Com as 5 casas cheias, a pedra é garantida. Com menos, o resto do círculo vira a fatia **Nada**, desenhada antes de você girar: com dois pokémon, 40% de chance de pedra e 60% de Nada.

### Shiny paga em Shiny Stone

Um shiny na roleta não pinta a pedra comum: pinta a **Shiny Stone do tipo dele**. Um Shiny Dratini (DRAGON) só pode dar Dragon Shiny Stone; um Shiny Bulbasaur (GRASS/POISON) abre Grass **ou** Poison Shiny Stone. A fatia shiny tem contorno dourado.

- **5 shinys do mesmo tipo** fecham a roleta e garantem a Shiny Stone.
- É a única fonte de Shiny Stone que não passa pelos fragmentos (ver Shiny).
- As Shiny Stones não se juntam como as comuns: um shiny DARK/GHOST pinta **duas** fatias, Dark e Ghost.

### Quem não entra

A folha só lista o **depot**: quem está na equipe nem aparece. Também ficam de fora:

- quem segura **Exp. Share** ou está no **posto de XP Share** de uma Casa — a folha diz quantos escondeu;
- quem está **anunciado** no Mercado da Comunidade. Se ele já estava numa casa quando foi anunciado, a casa esvazia e o giro segue com os outros;
- o **último pokémon** da conta.

> **A Coleção não barra a Oferenda.** Ela protege contra a venda ao NPC do Market, e aqui cada pokémon é uma escolha sua, olhando o card. O pokémon da Coleção aparece com a **★**, e o filtro **Local** separa Depot e Coleção.

### Auto Selecionar

O botão ao lado de **Esvaziar** enche as casas vazias com os pokémon do depot de **menor nota** (a N= da calculadora).

- Só pega nota **abaixo da do seu Auto Coleção N** (no Market; o padrão é 3,5). Com três ruins e um ótimo no depot, a quarta casa fica vazia.
- **Nunca pega:** shiny, P5, pokémon da Coleção, da vitrine do perfil, com item segurado, refino ou TM, o starter, nem as suas equipes do PvP Ranqueado e do Campeonato.
- Empate na nota: primeiro o de nível menor, depois a captura mais recente.
- Na folha de escolha, o mesmo botão escolhe **só entre os que a lista mostra**: busque "charmander" (ou filtre FIRE) e clique para montar uma roleta só de Fire Stone.
- Ele só enche as casas. O giro continua pedindo a sua confirmação.

> O sorteio é feito no **servidor**. A roleta que gira na tela só mostra o resultado que já saiu.

# Luta e captura

## Combate

O pokémon ativo anda até o selvagem **mais próximo** e só troca golpes quando **encosta** nele. Nada de dano voando de um lado a outro do mapa.

### O dano

```
base = ((2 × nível/5 + 2) × power × atk/def) / 50 + 2 final = base × STAB × efetividade × aleatório(0,85–1,00)
```

- **power** é o do golpe usado. Cada golpe tem o próprio **cooldown** (de 2 a 60 segundos) e um **nível mínimo** para ser aprendido.
- **STAB** é **×1,5** quando o golpe é de um dos tipos do próprio pokémon.
- **atk/def** usa Ataque e Defesa em golpe físico, e Sp.Atk / Sp.Def em especial.
- **efetividade** vem da tabela de tipos, já amplificada.

### O ataque básico

Enquanto todos os golpes estão carregando, o pokémon dá uma **Investida**: power **30**, a cada **2 s**, no tipo dele. Sem ela um Caterpie daria dois golpes e ficaria dez segundos parado. Se o alvo for imune aos dois tipos dele, só um golpe de verdade resolve.

### IV de SPD — cooldown

O stat **SPD** na ficha **não** entra na fórmula de dano. O **IV de SPD** (1–32, sorteado na captura) encurta cooldowns: **10 ms por ponto** (até −320 ms), com piso de 400 ms. Vale no intervalo global entre golpes, no cooldown de cada golpe e na PvP Ranqueado — mesma regra. **Não** acelera a corrida na hunt.

| Regra | Valor |
| --- | --- |
| Intervalo global base (seus golpes) | 0,9 s |
| Com IV SPD 32 (piso) | 0,4 s |
| Cooldown de cada golpe | também encurta (−0,01 s / IV) |

### Movimento na hunt

O pokémon ativo corre um pouco **na frente** do treinador — é ritmo da cena (260 ms vs 290 ms por tile), não stat SPD. Com IV alto você **ataca** mais rápido e passa mais tempo correndo entre alvos, o que pode parecer que “disparou”, mas a velocidade de passo não mudou.

### O selvagem joga com vantagem

| Regra | Valor |
| --- | --- |
| HP do selvagem na hunt | ×5 |
| Dano do selvagem por golpe | ×1.8 |
| Intervalo mínimo entre golpes seus | 0,9 s |
| Intervalo mínimo entre golpes dele | 1,4 s |

Não é injustiça: é o que faz uma hunt no seu nível ser uma luta, e não uma fila.

### Ondas e corpos

Os selvagens nascem em **ondas**, nos pontos de spawn da área. Quando o campo esvazia, a onda seguinte entra em poucos segundos. Quem cai **fica no chão por 30 segundos** — e é nele que se joga a bola.

### Drop na Outland

Além do loot da espécie (tabela na **Pokédex**), selvagens derrotados na **Outland** podem soltar **1× Bronze Boss Token** — entrada de boss. Kanto e Orre não dropam.

| Item | Chance | Quando |
| --- | --- | --- |
| Bronze Boss Token | 0,0500% · 1 / 2.000 | kill na Outland |

> Média de ~2.000 derrotas por token na Outland. Loot Boost (Streak, VIP, eventos) aumenta a chance. O NPC não compra — preço só no Mercado da Comunidade.

### As 8 Outlands

A aba **Outland** do Mapa tem um seletor com as **8 Outlands**. É o **mesmo mapa**, os **mesmos pokémon** e o mesmo nível 150 em todas — o que muda é a chance dos três drops raros da área (Bronze Boss Token, Fragmento de Chave e Fragmento de Shiny Stone):

| Região | Nv treinador | Bônus |
| --- | --- | --- |
| Outland 1 | 150 | ×1 |
| Outland 2 | 500 | ×1,25 |
| Outland 3 | 1.000 | ×1,5 |
| Outland 4 | 2.000 | ×2 |
| Outland 5 | 4.000 | ×3 |
| Outland 6 | 8.000 | ×4 |
| Outland 7 | 16.000 | ×6 |
| Outland 8 | 25.000 | ×8 |

> O degrau vale para os **três raros ao mesmo tempo** e multiplica **depois** do Loot Boost. XP, ouro, captura e o loot normal da espécie não mudam — quem sobe de Outland está comprando raridade, não velocidade.

### Evolução

Variantes de Outland **não evoluem** — um Ancient Pupitar não vira Ancient Tyranitar. Ver Evolução e pedras.

## Tipos: forças e fraquezas

A efetividade é **multiplicativa nos dois tipos** do defensor. Água contra Rocha/Terra é ×2 × ×2 = **×4**.

```
efetividade = tabela[atacante][tipo1] × tabela[atacante][tipo2]
```

### Na hunt a vantagem é 1.5× mais forte

É a mecânica mais específica deste jogo, e vale **nos dois sentidos**: bater no tipo certo compensa muito mais, e bater no errado dói muito mais.

| Normal | Na hunt |
| --- | --- |
| ×0 | ×0 |
| ×0,25 | ×0,167 |
| ×0,5 | ×0,333 |
| ×1 | ×1 |
| ×2 | ×2,5 |
| ×4 | ×5,5 |

> Imunidade (×0) e neutro (×1) **não** mudam. Fogo contra Água vira **×0,33** — é literalmente por isso que um Charmander não encara um Magikarp: com HP ×5 ele simplesmente não morre.

### A tabela completa

Linha = tipo do **golpe**. Coluna = tipo do **defensor**. Célula vazia é neutro (×1). Passe o mouse para ver o valor já amplificado da hunt.

| Golpe ↓ | NOR | FOG | AGU | PLA | ELE | GEL | LUT | VEN | TER | VOO | PSI | INS | ROC | FAN | DRA | SOM | MET | FAD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NOR |  |  |  |  |  |  |  |  |  |  |  |  | 0,5 | 0 |  |  | 0,5 |  |
| FOG |  |  | 0,5 | 2 |  | 2 |  |  |  |  |  | 2 | 0,5 |  | 0,5 |  | 2 |  |
| AGU |  | 2 |  | 0,5 |  |  |  |  | 2 |  |  |  | 2 |  | 0,5 |  |  |  |
| PLA |  | 0,5 | 2 |  |  |  |  | 0,5 | 2 | 0,5 |  | 0,5 | 2 |  | 0,5 |  | 0,5 |  |
| ELE |  |  | 2 | 0,5 |  |  |  |  | 0 | 2 |  |  |  |  | 0,5 |  |  |  |
| GEL |  | 0,5 | 0,5 | 2 |  |  |  |  | 2 | 2 |  |  |  |  | 2 |  | 0,5 |  |
| LUT | 2 |  |  |  |  | 2 |  | 0,5 |  | 0,5 | 0,5 | 0,5 | 2 | 0 |  | 2 | 2 | 0,5 |
| VEN |  |  |  | 2 |  |  |  |  | 0,5 |  |  |  | 0,5 | 0,5 |  |  | 0 | 2 |
| TER |  | 2 |  | 0,5 | 2 |  |  | 2 |  | 0 |  | 0,5 | 2 |  |  |  | 2 |  |
| VOO |  |  |  | 2 | 0,5 |  | 2 |  |  |  |  | 2 | 0,5 |  |  |  | 0,5 |  |
| PSI |  |  |  |  |  |  | 2 | 2 |  |  |  |  |  |  |  | 0 | 0,5 |  |
| INS |  | 0,5 |  | 2 |  |  | 0,5 | 0,5 |  | 0,5 | 2 |  |  | 0,5 |  | 2 | 0,5 | 0,5 |
| ROC |  | 2 |  |  |  | 2 | 0,5 |  | 0,5 | 2 |  | 2 |  |  |  |  | 0,5 |  |
| FAN | 0 |  |  |  |  |  |  |  |  |  | 2 |  |  |  |  | 0,5 |  |  |
| DRA |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | 0,5 | 0 |
| SOM |  |  |  |  |  |  | 0,5 |  |  |  | 2 |  |  | 2 |  |  |  | 0,5 |
| MET |  | 0,5 | 0,5 |  | 0,5 | 2 |  |  |  |  |  |  | 2 |  |  |  |  | 2 |
| FAD |  | 0,5 |  |  |  |  | 2 | 0,5 |  |  |  |  |  |  | 2 | 2 | 0,5 |  |

## Captura

### As pokébolas

| Pokébola | Eficiência | Chance (corpo caído) | Preço |
| --- | --- | --- | --- |
| Poké Ball | ×1 | 0,99% | 5 ouro |
| Great Ball | ×2 | 1,98% | 20 ouro |
| Super Ball | ×3 | 2,97% | 50 ouro |
| Ultra Ball | ×4 | 3,97% | 130 ouro |
| Beast Ball | ×8 | 7,93% | *só com diamante* |

A chance é no corpo caído, para o tier mais fácil (raridade 1). Cada ficha de espécie na Pokédex mostra a tabela exata — a Beast Ball é sempre **2×** a Ultra Ball.

A **Beast Ball** é a mais forte e não se compra com ouro — só em pacotes na Loja de Diamantes.

### A chance por arremesso

```
raridade = log10(máx(100, preçoNpc)) − 1 fator = 1 + raridade³ / 17 chance = 0.0075 × (eficiência / fator) × (1,4 − hpAtual/hpMáximo)
```

Limitada entre **0,30%** e **10,0%**. Três coisas decidem tudo:

- **Quanto o pokémon vale** (o preço de NPC dele, em escala logarítmica). Um Pidgey sai fácil; um Dragonite, não.
- **A bola.** A eficiência entra multiplicando direto.
- **O HP do alvo.** A bola só vai em quem já caiu, e corpo tem HP zero — que é a ponta boa da fórmula.

> **Capturar é difícil de propósito.** Com a MELHOR bola, num corpo caído, a espécie mais fácil do jogo dá **7,93%** e a mediana dá **3,17%** — e daí para cima cai rápido. A ficha de cada espécie na Pokédex mostra a tabela exata, bola por bola, com quantas derrotas isso significa na média.

### É uma tentativa por corpo

Se a bola falhar num **corpo caído**, ele some do mapa. Não dá para despejar bolas no mesmo alvo até sair — o custo por captura existe justamente por isso. Um selvagem **vivo** continua em campo quando a bola falha, porque ele ainda está lutando.

### O nível do capturado

O selvagem **luta** no nível da hunt; o capturado **nasce** no teto da espécie. O teto sai da cadeia evolutiva dela:

```
cadeia de 3 (Treecko → Grovyle → Sceptile) 20 · 40 · 100 cadeia de 2 (Makuhita → Hariyama) 40 · 100 não evolui (Spinda, variantes de Outland) 100
```

**Até o Nv 100 nada muda** — Kanto e Johto inteiras entregam o bicho no nível em que ele estava caído. Acima disso o teto manda: um Torterra derrubado numa hunt de 3.500 entra na equipe no **Nv 100**, e um Turtwig, no **Nv 20**.

A **evolução das espécies nacionais** segue a mesma escada: quando o destino mora em hunt de Nv 100+, o elo pede o **teto do destino** (40 ou 100), não o nível da hunt onde ele aparece. O caminho é capturar no 20, treinar até 40, evoluir; treinar até 100, evoluir de novo. **Variantes de Outland (#2001+) não entram nessa conta — não evoluem** (ver capítulo Evolução).

> Cada ficha da Pokédex tem a linha **Nível ao capturar**, e o painel dos caídos mostra o "→ Nv" antes de você gastar a bola. O bicho continua valendo o que vale — ele só chega para ser treinado, e não pronto.

### O que aumenta

- **Capture Boost** (Loja) — **dobra** a chance por arremesso, respeitando o teto de 10,0%.
- **Bola melhor** — a Poké Ball é a mais barata *por arremesso*, mas a Ultra e a Beast gastam menos tempo.

### Automação

A opção **Lançar pokébola** arremessa sozinha nos corpos caídos, respeitando um intervalo de 1,2 s. Ela é um **benefício de VIP** — ver Automações.

## Desmaiar e curar

### Quando UM pokémon cai

1. Se a automação de **Revive** estiver ligada e você tiver o item, ele levanta com **50% do HP** (e a de +HP completa em seguida, se estiver ligada).
2. Senão, o **próximo da equipe que estiver de pé** entra no lugar, automaticamente.

### Quando o TIME INTEIRO cai

A hunt é suspensa e você aparece na praça do **Centro Pokémon** — uma área comum, com os outros jogadores andando por lá (WASD para andar). A **Enfermeira Joy** cura a equipe inteira de graça, quantas vezes for preciso.

**Curar não tira você de lá.** Sair é escolher outra área no Mapa — a hunt em que você estava fica guardada.

> **Desmaiar contra selvagens custa 10% do XP do nível atual** do treinador (bênção da loja reduz ou zera). O custo extra é o tempo: a volta ao Centro, a cura e o caminho de novo. No PvP Ranqueado é diferente: perder **não** cobra XP — o que se perde ali é **PR**.

### Fechar a aba no meio da luta conta como derrota

Se você sair do jogo caçando, o servidor derruba a equipe inteira, exatamente como se você tivesse ficado. Não há como distinguir um cabo arrancado de um Alt+F4 no frame do golpe fatal — e uma regra que depende de adivinhar intenção não vale nada.

Para sair limpo há o botão **Ir para o Centro Pokémon** no canto do palco. Ele trava por **3 segundos** a cada dano trocado.

### Os itens

- **Revive** — levanta um pokémon desmaiado com **50%** do HP.
- **Poção (+HP)** — recupera **40%** do HP máximo.
- **Bless** (Loja) — reduz ou zera a perda de XP de **uma** morte na Arena PvP.

Poções e revives se compram no Market, em quantidade ilimitada e a preço fixo.

### Escape Rope

Sair de uma hunt pelo botão **Ir para o Centro Pokémon** exige **3 segundos** sem trocar dano — a trava existe para ninguém sumir da luta no instante do golpe fatal. A **Escape Rope** é o atalho pago para essa mesma saída: **1 💎** na Loja, e ela te leva ao Centro **na hora**, sem espera.

- O botão fica **ao lado** do de subir ao Centro, com a quantidade que você tem. Sem nenhuma, ele aparece apagado.
- Vale **só em hunts**. Na PvP Ranqueado ela não funciona — lá a saída continua sendo a de lá, com os 10 s fora de combate.
- É **consumida** ao usar e **não** pode ser vendida no Mercado da Comunidade.

## Automações

Ficam na coluna da direita e valem enquanto a aba estiver aberta.

### VIP Lançar pokébola

Arremessa sozinha nos **corpos caídos**, um por corpo, respeitando 1,2 s entre arremessos. Escolha **quais bolas** podem ser gastas clicando nos ícones — a automação usa a primeira da lista que ainda tiver estoque.

> Este recurso é **exclusivo de VIP**. Sem assinatura o interruptor abre o convite para a Loja, e assim que o VIP vence a automação para sozinha (a sua escolha de bolas fica guardada).

### Usar Revive ao desmaiar

Levanta o pokémon ativo com 50% do HP em vez de trocar por outro da equipe. Clique nos ícones para escolher **quais revives** gastar; a **ordem dos cliques é a ordem de gasto**. Nada escolhido = qualquer um.

### Usar Poções

Mesma ideia, com as poções — e mais uma escolha: **a partir de que altura da vida** a poção entra. Um **slider de 10% a 100%**, de 10 em 10 (10%, 20%, 30%… até 100%).

| Limiar | Para quem |
| --- | --- |
| 10–20% | economiza poção e aceita chegar perto do nocaute |
| 30% | o meio-termo (padrão) |
| 50–100% | hunt acima do seu nível, onde um golpe tira muita vida |

Um item escolhido que **acabou** continua na fila, apagado: a preferência é sua e não some porque o estoque zerou no meio de uma hunt.

### Voltar à hunt ao morrer/reset

Se o time inteiro cair, a Enfermeira cura e a automação **devolve você à mesma hunt** alguns segundos depois — é o que deixa farmar de madrugada sem acordar para clicar.

- **Só dispara com poção ou revive na bolsa.** Sem itens ela **pausa** e avisa no log e em toast, em vez de devolver você à hunt que acabou de matar seu time. Sem essa trava, ficar sem item de madrugada vira um laço de mortes — e cada volta cobra a perda de XP do nocaute, até o seu nível cair **abaixo do mínimo dos seus próprios pokémon**.
- O interruptor **continua ligado** quando ela pausa: você não desligou nada, só ficou sem item. Comprar uma poção e voltar à hunt na mão já rearma tudo.
- **Desistir não conta.** Sair da hunt pelo botão de desistência é uma decisão sua, não uma derrota — a automação não é acionada.

### Automação de fora do jogo

Os **Termos de Uso** permitem automações, no jogo e no Mercado — inclusive a **extensão de automação do PokéIdle**, que está no nosso Discord, no canal **#how-to-play**.

- As regras de conduta valem para todo mundo, jogando na mão ou com automação.
- O servidor segura rajadas de ações por segundo **por conta**, e o sorteio da liberação do Mercado vale igual para os dois: ser mais rápido não dá vantagem.
- Continua proibido usar falha do jogo para conseguir Gemas por fora da compra oficial.

# O mundo

## Mapa e Hunt Analyser

O **Mapa** é onde você escolhe a hunt. Cada marcador mostra o nível recomendado da área; trancadas ficam cinza até o seu treinador alcançar o nível.

### Regiões e nível do treinador

Cada aba do Mapa pede um **nível mínimo do treinador** (não do pokémon). Kanto e Johto compartilham o mesmo mapa; Hoenn e Sinnoh usam mapas próprios; da 5ª geração em diante cada região tem ilustração própria (`5unova`, `7kalos`, `8alola` — gens 7–9 no mesmo mapa). Estoque: `mapa_extra_futuro1/2`.

| Região | Nv treinador |
| --- | --- |
| Kanto | 1 |
| Johto | 1 |
| Outland | 150 |
| Hoenn | 500 |
| Sinnoh | 1.000 |
| Unova | 5.000 |
| Kalos | 10.000 |
| Alola | 25.000 |

> Unova em diante já abrem a aba e o mapa quando você atinge o nível — as hunts dentro delas entram aos poucos, conforme forem posicionadas. Uma aba vazia de marcadores não significa bug: a região ainda está sendo montada.

### Ícones dos marcadores

Cada hunt mostra o retrato da espécie principal num círculo. O atlas de marcadores cobre centenas de looktypes publicados; se faltar algum, o jogo desenha o sprite do outfit na hora.

### Hunt Analyser

Com o Mapa aberto, passe o mouse (ou toque) num marcador liberado: no canto superior direito aparece o **Hunt Analyser** — uma estimativa daquela área para a sua conta **agora**, com os boosts ativos. No computador ela some quando o mouse sai do marcador; no celular, feche pelo **×** do cabeçalho da ficha e toque em outra área.

- **XP treinador / hora** e **XP pokémon / hora**
- **Ouro / hora** (pelo `experience` das espécies que spawnam lá)
- **Forte contra** — tipos que você bate com ×2 na hunt (já amplificado)
- **Fraco contra** — tipos com ×0,5 ou imunidade

> São estimativas, não promessas: spawn aleatório, tempo andando até o alvo e desmaios mudam o resultado real. Serve para comparar duas hunts, não para prever a próxima hora ao minuto.

### Filtros

Dá para filtrar por região (Kanto até Paldea), por tipo de pokémon na área, buscar por nome, intervalo de nível da hunt e marcar **só liberadas** — útil quando você sobe de nível e quer ver o que abriu.

## Guilds

Clãs pequenos de até **6** jogadores. O botão fica abaixo do seu retrato: **+** para criar ou o brasão da guild se você já estiver numa.

### Criar e gerenciar

- Custo de criação: **250.000** de ouro
- Escolha nome, formato do escudo, emblema e cores (mesmo vocabulário visual do outfit)
- O dono convida por nick, expulsa membros ou apaga a guild

### Ranking de GP e bônus

Cada guild acumula **GP** (Guild Points). A aba **Guild** no Ranking ordena por GP total. As três primeiras ganham bônus de **XP e loot** para todos os membros:

| Posição | Bônus |
| --- | --- |
| 1º | +10% |
| 2º | +5% |
| 3º | +3% |
| 4º em diante (com GP > 0) | +1% |

### Guerra de Guilds (diária)

Uma vez por dia, às **22h UTC** (19h de Brasília), todas as guilds registradas se enfrentam numa arena só. Quanto mais guilds inscritas, mais GP o 1º lugar leva (N guilds → 1º ganha N GP, 2º ganha N−1, …). Só o **dono** registra uma vez — a guild entra **automaticamente todo dia** — no painel dentro de PvP Ranqueado.

- **Ninguém precisa estar acordado.** A guerra é **simulada no servidor** com a guild inteira de quem se registrou — você não entra em arena nenhuma no horário.
- Entra a **equipe de guerra** que você salvou no painel; quem nunca salvou entra com a equipe de hunt. Ela é fotografada **na hora do evento**.
- Todo mundo entra **curado**: ter desmaiado antes de dormir não vira peso morto.
- **Onde cada guild nasce é chaveado, como num campeonato.** As **4 guilds mais fortes** são as cabeças de chave: a 1ª nasce numa ponta da arena, a 2ª no ponto mais distante dela **a pé**, e a 3ª e a 4ª nos pontos mais distantes das duas. Cada vaga que sobra pertence à região da cabeça de chave mais próxima, e as outras guilds são repartidas entre as regiões em **serpentina** — numa chave de 16, 1-8-9-16, 2-7-10-15, 3-6-11-14 e 4-5-12-13 —, para toda região ter a mesma força. Dentro da região, a mais fraca nasce mais perto da cabeça de chave e as fortes ficam na divisa: as favoritas só se cruzam no fim. A força é o **GP Global** da temporada, depois o GP do dia anterior e, empatando, a força das equipes. A ponta da 1ª muda a cada guerra, porque o terreno da arena não é simétrico.
- O nível efetivo é **capado em 150**, como no ginásio — quem leva nv 2000 luta como nv 150; qualidade, potência e refino continuam valendo.
- Vale o **TM Elemental** de cada pokémon; o **TM AoE não entra** — na guerra o dano é sempre num alvo só. O **+25% de líder de ginásio** vale só na hunt (ver Ginásios).
- **A guerra dura até 10 minutos simulados.** Ela acaba quando sobra uma guild de pé. Se passar do teto, decide a **fração de HP** que cada guild ainda tem. Os duelos de ginásio, do PvP Ranqueado e do Campeonato têm teto próprio, mais curto.

Depois é só clicar em **assistir ao replay**: a guerra inteira gravada, com os golpes, os efeitos de tipo, os números de dano, as trocas de pokémon, o placar e o feed de abates (**jogador** ⚔ **pokémon** de **donor**). Dá para acelerar até 8×, afastar a câmera e acompanhar um lutador específico.

## Casa e XP Share

A **Casa** é o que faz a sua **equipe** subir junto com o pokémon de batalha. Dentro dela ficam os **bonecos**, e cada boneco é um **posto de XP Share**: você registra ali um pokémon da sua **equipe**, e ele passa a receber uma fatia do XP que o seu pokémon de batalha ganha na hunt.

### As cinco casas

O que muda de uma para a outra é **o tamanho da fatia**, e não o tamanho da casa. Quatro delas têm **um posto só**; a Lendária é a única com dois:

| Casa | XP Share | Pokémon | Chance no sorteio |
| --- | --- | --- | --- |
| **Comum** | 25% | 1 | 74,5% |
| **Incomum** | 40% | 1 | 20,0% |
| **Rara** | 75% | 1 | 5,00% |
| **Mítica** | 100% | 1 | 0,50% |
| **Lendária** | 100% | 2 | 0,0050% |

### Como conseguir uma

Um caminho só: **10 Fragmentos de Chave** na bancada **Fabricar Casa** do **Professor Carvalho**, no Centro Pokémon. A raridade é **sorteada** — não se escolhe qual casa vem.

A Casa **não se compra pronta** — só se fabrica com fragmentos dropados na Outland. Cada casa sai com um **número do servidor** — quem tirou a primeira ficou com a **#000001** — e você pode ter **quantas quiser**. O teto é de **uso**: até **5 casas** ficam em uso ao mesmo tempo, cada uma com os seus postos, e só elas repartem XP. As outras ficam **guardadas** — você escolhe quais usar no botão **Casa**, e guardar uma tira do XP Share os pokémon dos postos dela. Casa nova entra em uso sozinha enquanto houver vaga.

> **Fragmentos de Chave não têm teto por conta.** Caem na Outland (0,000500% por derrota, ~200.000 kills em média). Essa é a chance na Outland 1 — os degraus de cima multiplicam até **×8** (ver Combate). Por isso não podem ser vendidos no Mercado da Comunidade.

A **casa pronta** é negociável — anuncie a sua pelo **número** na aba Casa do Mercado. Ao anunciar, os pokémon dos postos **daquela casa** saem do XP Share, e não voltam se você cancelar o anúncio: a casa volta vazia.

### Como funciona o XP Share

Abra o botão **Casa** (ou entre nela e clique no boneco) e escolha **um pokémon da sua equipe** para cada posto — **um pokémon só ocupa um posto**, em todas as suas casas. A partir daí, a cada selvagem que você derruba, ele recebe a **fatia da sua casa** (a coluna "XP Share" da tabela acima) do XP que o seu pokémon de **batalha** ganhou naquele abate. Os seus multiplicadores de **XP de pokémon** (boost, VIP, guild, evento) já estão dentro desse número.

**O registrado não pode ser o que está lutando.** Se você registrar o Charizard e for caçar com o Charizard, ele não recebe nada — ele já leva o XP inteiro. Registre o Charizard e cace com o Squirtle, e é o Charizard que sobe junto.

A fatia é calculada sobre o **XP da hunt em que você está**, e é isso que muda tudo em relação ao treino antigo: caçando numa hunt de nível 600, 75% de cada abate é muito; caçando numa hunt de nível 10, 75% ainda rende — mas bem menos em número absoluto. Um pokémon nível 600 registrado enquanto você caça no nível 10 sobe — devagar, mas sobe.

> **Ninguém perde XP: a fatia é EXTRA.** Este é o mal-entendido mais comum do jogo, então vale dito com todas as letras: o seu pokémon de **batalha** fica com **100% do XP, sempre**. A fatia do XP Share é **criada por cima** — ela não sai do que ele ganhou e não divide nada com ninguém.

Num abate que dá **1.000** de XP, com uma casa **Rara** (75%), o que acontece é isto:

- pokémon de **batalha**: **1.000** — os 100% de sempre, intactos
- pokémon **registrado** no boneco: **+750**
- total que entrou na sua conta: **1.750**

> **Três limites que valem a pena saber de cor.** (1) Só a **EQUIPE** — pokémon parado no Depot não recebe nada (o **item** Exp. Share, logo abaixo, é diferente nisso). (2) O **treinador** não ganha XP extra, e nenhum outro pokémon além do registrado. (3) Sem hunt não há fatia: a porcentagem é calculada **sobre o XP de um abate**, então sem abate não há sobre o que calcular. Com a aba fechada, não acontece nada.

### O item Exp. Share (o que se segura)

Existe também um **item** chamado **Exp. Share**, comprado na Loja por diamantes. Ele não tem nada a ver com a casa nem com os bonecos: ele é **segurado** por um pokémon, e vale sozinho — quem não tem casa nenhuma pode usá-lo.

Quem estiver segurando um recebe **+5%** do XP que o seu pokémon de batalha ganhou em cada abate. E vale a mesma regra de cima, que é onde quase todo mundo se confunde: **não é 95% para um e 5% para o outro**. O de batalha continua com os **100%**, e os 5% são um acréscimo em cima disso.

Naquele mesmo abate de **1.000** de XP, com um pokémon segurando o item:

- pokémon de **batalha**: **1.000**
- pokémon **segurando** o Exp. Share: **+50**

> **O item funciona no Depot.** É a diferença que mais importa em relação aos bonecos da casa: o boneco só alimenta pokémon **da equipe**, e o Exp. Share alimenta quem estiver segurando ele, esteja na equipe ou guardado no **Depot**.

- **Empilha com a casa.** Um pokémon registrado no boneco E segurando um Exp. Share recebe as duas coisas.
- **Cada item rende os seus 5%.** Dois pokémon segurando dois Exp. Share ganham 5% cada um — eles não repartem entre si.
- **Quem está lutando não ganha o próprio bônus.** Se o pokémon de batalha estiver segurando o item, ele não recebe nada a mais: já leva os 100%.
- **Não é negociável.** O Exp. Share nasce na Loja e morre na conta que comprou — não vai para o Mercado.
- **Trocar de portador tem espera de 1 minuto** entre equipar e desequipar.

> **A escolha fica guardada.** Diferente do treino antigo, sair do jogo não esvazia os postos — quando você voltar, o mesmo pokémon continua registrado. O posto só se esvazia sozinho se aquele pokémon sair da equipe, for vendido ou for para a vitrine.

### Entrar em casa

Pelo botão **Casa**, em qualquer uma das suas — mas só **a partir do Centro Pokémon** (ou de dentro de outra casa): elas ficam em Cerulean. Lá dentro você anda com **W A S D**, vê quem está registrado ao lado de cada boneco e tem os botões **Escolher pokémon** e **Sair de casa**. Entrar é só para **escolher**: o XP Share já estava valendo, e sair não interrompe nada.

## Bicicletas

A **bicicleta** é a progressão de **mobilidade** do jogo. Na hunt, boa parte do tempo o seu pokémon está **andando** de um selvagem até o outro — e é esse caminho que ela encurta. Vale para o **pokémon** e para o **treinador**, na hunt e na praça de Cerulean.

### As cinco bicicletas

A raridade decide o quanto ela acelera. "Tempo de cada passo" é quanto um passo leva comparado a andar a pé (100%): na Lendária, o passo dura a **metade**.

| Bicicleta | Velocidade | Tempo de cada passo | Chance no sorteio |
| --- | --- | --- | --- |
| **Comum** | +15% | 87% | 74,5% |
| **Incomum** | +25% | 80% | 20,0% |
| **Rara** | +50% | 67% | 5,00% |
| **Mítica** | +75% | 57% | 0,50% |
| **Lendária** | +100% | 50% | 0,0050% |

### Como conseguir uma

Todo abate na **Outland** pode soltar um **Fragmento de Bicicleta** (0,000500% por derrota, ~200.000 kills em média). Essa é a chance na Outland 1 — os degraus de cima multiplicam até **×8** (ver Combate). O Loot Boost também aumenta a chance.

Com **10 fragmentos**, a bancada **Fabricar Bicicleta** do **Professor Carvalho**, no Centro Pokémon, monta uma bicicleta. A raridade é **sorteada**, com as chances da tabela acima — as mesmas da Casa.

Cada bicicleta sai com um **número do servidor** — a primeira tirada é a **#000001** —, e é por ele que ela se equipa e se anuncia. O **Registro de Bikes**, no botão **Casa**, mostra todas as bikes já abertas, quem tirou cada uma e quais estão à venda.

Bicicleta e fragmento são **negociáveis**: os dois se compram e vendem no Mercado da Comunidade. Tirou uma **Lendária**? O chat Mundo inteiro fica sabendo.

### Equipar

Clique na bicicleta em **Bolsa → Itens Raros**. Você pode ter **quantas quiser**, de qualquer raridade, mas só **uma fica equipada** — e só a equipada vale.

> **As porcentagens não somam.** Uma Comum, uma Incomum e uma Lendária na bolsa, com a Comum equipada, é andar a **+15%** — não a +140%. Equipe sempre a melhor que você tem.

- **Trocar tem espera de 5 minutos.** Equipar outra ou guardar a equipada trava a troca seguinte por esse tempo, e sair do jogo não zera a espera.
- **Anunciar a equipada no Mercado** tira ela do seu pé na hora: você volta a andar a pé até equipar outra — mesmo tendo outra da mesma raridade na bolsa. Cancelar o anúncio a devolve já equipada.

### Onde ela NÃO vale

A bicicleta só encurta a **caminhada**. Ela não muda dano, cooldown de golpe nem alcance, e não vale no **PvP**, no **Ginásio**, na **Guild** nem na arena do **Boss** — esses modos rodam em simuladores próprios, e lá todo mundo anda na mesma velocidade.

> **Ela rende mais onde o spawn é espaçado.** Numa hunt apertada, com um selvagem colado no outro, o passo quase não aparece; na **Outland**, onde se anda muito entre um e outro, a bike vira mais abates por hora.

## TM Disks

TMs são melhorias **permanentes** no pokémon — desbloqueiam conteúdo avançado e mudam como ele luta. No **Centro Pokémon**, fale com o **Professor Carvalho** (botão na praça). Lá tem um botão **[i]** com o guia completo.

> O balcão do Professor tem **quatro bancadas**: as duas dos TMs (trocar peças e aplicar disco), **Fabricar Casa** (ver Casa e XP Share) e **Fabricar Shiny Stone** (ver Shiny).

### Quando aplicado

- **Elemental** — o pokémon aprende um golpe especial novo (ex.: **TM Ghost**): power **2800**, CD **60 s**, área **3×3** no alvo. O tipo do disco tem que ser um dos tipos do pokémon.
- **AoE** — **todos** os golpes passam a acertar em área **12×12** (centro no herói). Vários selvagens grudados levam dano **simultaneamente**.

Elemental e AoE **coexistem** no mesmo bicho. Ex.: Gengar (Ghost/Poison) aceita disco **Ghost** ou **Poison** — um elemental por pokémon, mais um AoE se quiser.

### Bronze Boss Token → bosses → peças

Para farmar peças você precisa entrar nas arenas de boss (gasta **1× Bronze Boss Token** por tentativa):

- **Token** — drop raro na **Outland** (0,0500% por kill, média ~2.000 derrotas). Kanto e Orre não dropam. NPC não vende.
- **Ancient Aero** — ~5% de chance de soltar **TM Disk Piece**
- **Giant Cruel** — ~5% de chance de soltar **AoE TM Disk Piece**

### Peças → discos

Junte **10** peças iguais e troque no Researcher (consumidas na hora):

| Peça | Vem de | Vira |
| --- | --- | --- |
| TM Disk Piece | Ancient Aero (~5%) | Disco elemental (escolhe o tipo) |
| AoE TM Disk Piece | Giant Cruel (~5%) | Disco AoE |

O disco vai para a bolsa; na aba **Aplicar** você escolhe um pokémon da equipe e consome o disco — é permanente no bicho.

### Status aprimorados e Orre

Selvagens na **Outland** (treinador Nv 150+) e na **Orre** (Nv 500+) têm stats mais altos que Kanto — mais HP e dano por golpe. Na **Orre**, o pokémon ativo precisa dos **dois** TMs (elemental + AoE) para caçar com eficiência.

> Tokens e discos TM são escassos de propósito — a progressão passa por farm na Outland e vitórias em boss.

## Bosses

Arenas de desafio: você gasta um **Bronze Boss Token**, entra num mapa próprio e enfrenta um pokémon gigante. Ele fica parado — não persegue — e bate MUITO forte.

### Como conseguir o token

- **Drop na Outland** — selvagens derrotados na Outland têm **0,0500%** de chance de soltar 1× Bronze Boss Token (média ~2.000 kills).
- **Não** vende no Market do NPC — só drop na Outland e troca entre jogadores.
- O NPC **não compra** o token (nem na venda avulsa nem no “vender tudo”). Quem define o preço é a comunidade no Mercado da Comunidade.

| Boss | Nível | Nível de equipe | Drops |
| --- | --- | --- | --- |
| Regirock | 300 | 300 | TM Disk Piece (0,50%) |
| Regice | 300 | 300 | AoE TM Disk Piece (0,50%) |
| Registeel | 650 | 650 | TM Disk Piece (1,00%) |
| Kyogre | 650 | 650 | AoE TM Disk Piece (1,00%) |
| Groudon | 3.100 | 3.100 | TM Disk Piece (1,50%) |
| Rayquaza | 3.100 | 3.100 | AoE TM Disk Piece (1,50%) |
| Uxie | 9.750 | 9.750 | TM Disk Piece (2,00%) |
| Mesprit | 9.750 | 9.750 | AoE TM Disk Piece (2,00%) |
| Azelf | 22.700 | 22.700 | TM Disk Piece (2,50%) |
| Dialga | 22.700 | 22.700 | AoE TM Disk Piece (2,50%) |
| Palkia | 44.050 | 44.050 | TM Disk Piece (3,00%) |
| Heatran | 44.050 | 44.050 | AoE TM Disk Piece (3,00%) |
| Regigigas | 75.900 | 75.900 | TM Disk Piece (3,50%) |
| Giratina (Altered Forme) | 75.900 | 75.900 | AoE TM Disk Piece (3,50%) |
| Cresselia | 120.350 | 120.350 | TM Disk Piece (4,00%) |
| Cobalion | 120.350 | 120.350 | AoE TM Disk Piece (4,00%) |
| Terrakion | 179.500 | 179.500 | TM Disk Piece (4,50%) |
| Virizion | 179.500 | 179.500 | AoE TM Disk Piece (4,50%) |
| Reshiram | 255.450 | 255.450 | TM Disk Piece (5,00%) |
| Zekrom | 255.450 | 255.450 | AoE TM Disk Piece (5,00%) |
| Kyurem | 350.300 | 350.300 | TM Disk Piece (5,50%) |
| Kartana | 350.300 | 350.300 | AoE TM Disk Piece (5,50%) |
| Guzzlord | 466.150 | 466.150 | TM Disk Piece (6,00%) |
| Poipole | 466.150 | 466.150 | AoE TM Disk Piece (6,00%) |
| Naganadel | 605.100 | 605.100 | TM Disk Piece (6,50%) |

### A penalidade de equipe

É a mecânica central da arena, e ela multiplica **o dano que o boss causa** — não o que ele aguenta.

```
força = Σ mín(1, nível do pokémon / nível de equipe do boss) déficit = 5 − força multiplicador = 3 ^ déficit
```

| Equipe | Multiplicador de dano recebido |
| --- | --- |
| 6 pokémon no nível do boss | ×1 |
| 3 pokémon no nível do boss | ×27 |
| 1 pokémon muito abaixo | ×700 ou mais |

> Leve **seis** pokémon no nível do boss. Não é conselho — é a diferença entre tomar 400 de dano e tomar 280.000.

### O que muda lá dentro

- O boss usa **golpes próprios**, com power e cooldown da ficha dele — não os da espécie.
- Ele **não** leva o ×1.8 de dano do selvagem: os golpes dele já vêm com power de boss.
- O **Giant Cruel é neutro**: não tem tipo, então nada é super-efetivo nem resistido contra ele.
- Não dá para capturar um boss. O prêmio é a tabela de drops.

### Se você vencer

Abre um painel com XP, boss points e loot; você volta ao **Centro Pokémon** (não retorna à hunt anterior). Curar e seguir caçando é escolher outra área no Mapa.

### Se você perder

Você sai da arena e vai para o Centro Pokémon. **A entrada não volta** — nem se você abandonar por vontade própria.

## PvP Ranqueado

**Um contra um, contra alguém do seu rank.** Você monta a equipe, entra na fila e a partida acontece **sozinha** — não há nada para clicar durante a luta. O que está em jogo é um número só: os **pontos de ranking (PR)**. Tier, divisão e a barrinha da tela saem todos dele.

### Como funciona, em três passos

1. **Monte a equipe de PvP** — até **5 pokémon**, na ordem em que entram. Ela é **separada da equipe de hunt**: mexer numa não mexe na outra. O primeiro abre a luta; os outros entram quando o anterior cai.
2. **Procure partida.** Pode fechar a tela e continuar caçando — a busca segue, e um aviso pequeno fica no alto ("Na fila PvP · 0:42") com um × para cancelar.
3. **A partida roda sozinha.** Abre um mapa, os dois times se enfrentam, e no fim a tela diz quanto de PR você ganhou ou perdeu.

### As regras da casa

| Regra | Valor |
| --- | --- |
| Formato | 1 contra 1, **100% automático** |
| Nível de treinador | 150 |
| Pokémon na equipe | 1 a 5 |
| Custo para entrar | **nada** — sem ficha, sem ouro, sem taxa |
| Perder custa XP? | **não** — só PR |
| Entre uma partida e a fila seguinte | 20 s |
| Reencontrar o mesmo oponente | evitado por 10 min — e paga PR cheio |

### Os sete ranks

| Rank | Como se entra | Divisões |
| --- | --- | --- |
| **Bronze** | 0 – 299 PR | I · II · III |
| **Prata** | 300 – 599 PR | I · II · III |
| **Ouro** | 600 – 899 PR | I · II · III |
| **Platina** | 900 – 1.199 PR | I · II · III |
| **Diamante** | 1.200 – 1.499 PR | I · II · III |
| **Mestre** | **1.500 PR** e ficar entre **21º e 50º** | — |
| **Challenger** | **1.500 PR** e estar entre os **20 primeiros** | — |

Dentro de cada tier a divisão vai de **I** a **III**, de 100 em 100 PR. **I é a entrada e III é o topo** — Ouro III é melhor que Ouro I. É o inverso do League of Legends, de propósito: lá a ordem invertida é herança de um sistema antigo.

> **Mestre e Challenger são VAGAS, não pontos.** Passar dos 1.500 PR te põe na fila de espera: as **20 primeiras** posições da tabela são Challenger e da 21ª à **50ª** é Mestre. Enquanto não houver vaga você aparece como Diamante. Pontos inflam com o tempo; posição não — "estar entre os 20 melhores do servidor" quer dizer a mesma coisa daqui a um ano.

### Posicionamento: as 5 primeiras

Nas suas **5 primeiras partidas** você aparece como **Não classificado**, não entra na tabela, e o PR não passa de **299** — o topo do Bronze. Todo mundo começa no pé da escada; a subida **é** o jogo.

### Quanto vale cada partida

É o Elo do xadrez: o que decide é a **diferença de rank** entre os dois.

- Contra alguém do seu nível, o movimento é pequeno e parelho.
- **Ganhar de quem está muito acima** paga muito — e custa muito a ele.
- **Perder para quem está muito abaixo** é a derrota mais cara que existe.

Com uma diferença que vale entender: **a derrota cobra 70% do que a vitória pagaria**. Não é soma zero, e é de propósito — com todo mundo começando do chão, uma escada de soma zero deixaria Diamante para cima **inalcançável**, porque não haveria de onde os pontos virem. Com o atrito, quem ganha cerca de metade sobe devagar e quem ganha menos de ~41% desce.

> **Escudo de tier:** acabou de subir de tier? A primeira derrota no piso dele não te rebaixa. Cair de Ouro para Prata na derrota seguinte à promoção é a sensação ruim que o escudo existe para evitar.

### Inatividade e temporada

- **7 dias sem jogar** fazem Mestre e Challenger perderem a **vaga** — os pontos ficam, a posição vai para quem está jogando.
- **Todo mês a tabela zera:** todo mundo volta a 0 PR e ao posicionamento. É o que faz o número voltar a valer o que vale.
- Na virada, as primeiras posições levam **prêmio** (boosts). O pódio leva o pacote maior; depois vem o resto do Challenger e, por fim, o Mestre.

### Fila automática (VIP)

Assinantes podem deixar a fila ligada: acabou uma partida, a próxima busca começa sozinha 20 segundos depois. Desliga quando você cancela na mão ou quando a equipe fica vazia.

### O ranqueado no perfil

- O card **ELO** da Ficha do Treinador mostra o **emblema**, o tier com a divisão e o **PR** — no seu perfil e no de quem você abrir pelo ranking, pelo chat ou pela lista de amigos. Quem ainda está no posicionamento aparece como **Não classificado**, sem emblema e sem PR.
- A **equipe do PvP Ranqueado é pública**: qualquer um vê no seu perfil.
- Para o Campeonato dá para escolher outra equipe, que **não aparece** no perfil de ninguém.

## Área de Treinamento

**Uma bancada de testes, sem nada em jogo.** Na aba **Treinamento** do PvP você monta dois lados, manda lutar e assiste. Não há XP, Coin, item, pedra nem ponto de ranking — e **nada é gravado**.

### Como se monta

1. **Até 5 pokémon de cada lado**, escolhidos casa a casa. A casa 1 é quem entra em campo primeiro.
2. Em cada casa você escolhe entre **um pokémon seu** e um **pokémon teste**.
3. O **pokémon teste** é de mentira: você diz a espécie, o nível, se é shiny, a potência, a qualidade e os seis IVs. Ele existe só naquela luta.
4. Clique em **Lutar**. A fita abre na arena dos ginásios, com o mesmo tocador do desafio ao líder.

### As regras da luta são as do Ranqueado

Mesma arena, mesmo simulador e a mesma régua de nível do PvP Ranqueado e do Ginásio — inteiro até 150 e comprimido daí para cima. Treinar com outra régua não treinaria nada.

**Os lados são independentes:** 5 × 1 é uma luta válida. A bancada não pede equilíbrio — quem decide o que quer perguntar é você.

### O seu pokémon não entra na arena

Entra uma **cópia** dele, com os mesmos números de nascimento. O original não perde HP, não ganha XP, não sai do lugar e não fica sabendo que a luta aconteceu. O pokémon teste, por sua vez, **não vai para o Depot** e não conta na Pokédex.

> **Uma batalha a cada 5 minutos por conta.** A espera vale em qualquer aparelho e não zera ao sair e entrar de novo.

### Para que serve

- descobrir qual dos seus pokémon é mais forte de verdade, e não na conta de cabeça;
- comparar duas equipes antes de levar uma para o Ranqueado ou para a guerra;
- ver quanto um nível, um IV ou uma potência a mais mudam a luta;
- montar a equipe contra um oponente que você inventa — o time de alguém que te venceu, por exemplo.

## Campeonato

O torneio do PokéIdle, com **prêmio em dinheiro**. O **1º Campeonato** é no dia **30 de setembro**, e as inscrições vão até o fim do dia **29 de setembro** (horário de Brasília). Fica no menu do topo, em **Campeonato**.

### Premiação

| Posição | Prêmio |
| --- | --- |
| 1º lugar | R$ 1.000 |
| 2º lugar | R$ 500 |
| 3º lugar | R$ 250 |

No Brasil, o prêmio é pago por **PIX**. Fora do Brasil, vai o valor equivalente em **USDT na rede Solana**, convertido na hora do pagamento.

### Inscrição

- Clique em **Registrar**. Precisa de **nível 300** de treinador.
- Até o prazo dá para **cancelar** e se inscrever de novo.
- A aba **Participantes** mostra cada inscrito, com a skin, o nível, o elo, o PR e a seed. Tem busca por nick, e clicar no card abre o perfil.

### A sua equipe

Depois de se inscrever, a faixa **Sua equipe do campeonato** mostra com quem você vai lutar.

- **Selecionar minha Equipe** abre a sua coleção inteira (equipe e depot), com busca e filtros. Marque até **5 pokémon**: o número no card é a ordem em que entram em campo. **Salvar equipe** grava.
- Essa equipe é **só do campeonato**: não muda a do PvP Ranqueado e **não aparece no perfil** de ninguém.
- Quem não escolher luta com a equipe do PvP Ranqueado, que é pública no perfil. **Usar a equipe do PvP** apaga a escolha e volta para ela.
- **A equipe congela no fim das inscrições** e joga o campeonato inteiro. Pokémon vendido ou anunciado no Mercado até lá fica de fora.

> **Sem equipe no fechamento, todas as suas partidas são W.O.** A faixa avisa antes do prazo.

### Seeds e chave

- A **seed** é a sua posição na Tabela do PvP Ranqueado entre os inscritos: o mais alto é a Seed 1. Quem ainda está no posicionamento vem depois, pelos pontos.
- Até o prazo as seeds são **provisórias** e acompanham a Tabela. No fechamento elas **congelam** e a chave é gerada.
- Na 1ª rodada a Seed 1 enfrenta a última, a 2 enfrenta a penúltima, e assim por diante. A 1 e a 2 ficam em lados opostos e só se cruzam na final.
- Se os inscritos não fecham uma chave cheia (4, 8, 16, 32…), as melhores seeds **avançam direto** para a 2ª rodada.

### O formato

- **Eliminação dupla.** Perdeu na chave dos vencedores, você cai para a dos perdedores. Perdeu na dos perdedores, está fora.
- **Grande final** em partida única: o campeão dos vencedores contra o campeão dos perdedores. O **3º lugar** é de quem perde a final da chave dos perdedores.
- **A luta é a do PvP Ranqueado**: automática, com as mesmas regras.

### As partidas rodam sozinhas

No fechamento das inscrições (**00:00 do dia 30 de setembro**, horário de Brasília) o servidor joga a chave **uma rodada a cada 5 minutos**, até a grande final. Ninguém precisa estar online.

- Na aba **Bracket**, toda partida jogada tem **▶ Assistir**: qualquer jogador vê o replay de qualquer partida.
- A chave acende o vencedor, mostra o placar de abates e marca W.O., título e 3º lugar. **Ver minha chave** leva direto ao seu caminho.
- Cada inscrito aparece como invicto, na chave dos perdedores ou eliminado. No fim, a **Premiação** mostra os três colocados.

## Ginásios

São **18 ginásios**, um para cada tipo elemental. Cada um tem um **pódio** disputado por todo o servidor: quem estiver em **1º** é o **líder** daquele tipo — e liderar paga **+25% de dano**.

### O time do ginásio

- Até **5 pokémon**, e **todos do tipo do ginásio**. Tipo duplo entra nos dois: um Charizard vale para **FIRE** e para **FLYING**.
- **Sem espécies repetidas.** Cinco cópias do mesmo bicho bom não fazem um time — e o pódio é de quem montou um time, não de quem farmou uma espécie.
- Precisa de **nível 150 de treinador** para registrar em qualquer ginásio.
- O time registrado **continua seu e continua jogável** — ele não sai da sua equipe nem fica preso em lugar nenhum.

> **O nível conta inteiro até 150, e comprimido daí para cima.** Não há teto: cada nível acima disso continua valendo, só que cada vez menos — nv 1.000 conta 352, nv 3.000 conta 578, nv 10.000 conta 993. Dobrar o nível rende sempre os mesmos **+37%**, em qualquer ponto da curva, então nenhum nível é desperdiçado. O nascimento e o refino voltam a decidir o pódio, e o grind continua pesando. (A Guerra de Guilds comprime **mais** que o ginásio — são eventos diferentes.)

### Como a força é medida

Não é o **⚔ do Ranking**. Aquele número mede o quanto um espécime é **raro e bem investido**; o pódio precisa responder outra pergunta: **quem ganharia a luta**. A força de cada pokémon é o produto do **dano por segundo** pelo **HP efetivo** — que é o que decide um duelo de desgaste —, e o time vale a soma dos cinco.

### Desafiar o líder

O desafio é um **duelo simulado**: o seu time contra o dele, um de cada vez, com a mesma engine da Guerra de Guilds. Ganhou, o ginásio é seu. Você assiste tudo no **replay**, com os golpes, os números de dano e as trocas de pokémon.

- **24 horas de espera** entre dois desafios ao **mesmo** ginásio. Os 18 relógios são independentes — perder em FIRE não trava o seu desafio em WATER.
- O bônus de líder **não vale dentro do duelo**: o líder não defende o ginásio batendo 25% mais forte por já ser o líder.

### O prêmio

Enquanto você for o líder, todo pokémon seu **daquele tipo** bate **+25%** na hunt — inclui **boss**. Não vale no duelo do ginásio, na PvP Ranqueado nem na Guerra de Guilds.

- Vale para o **pokémon inteiro**, não para o golpe: o Charizard de quem lidera FIRE bate mais forte com Flamethrower **e** com Investida.
- **Não empilha.** Liderar FIRE e FLYING não dá 56% ao Charizard — dá os mesmos 25%.

## Ranking

O placar do mundo inteiro, não do seu servidor. Oito abas:

| Aba | O que ordena |
| --- | --- |
| Treinadores | nível do treinador (desempate por XP) |
| Pokémon Forte | o **poder** de um pokémon, de qualquer treinador |
| Top Catch | **espécies diferentes** já capturadas, não capturas totais |
| Top Coins | ouro acumulado na conta |
| PvP Ranqueado | o rank e o PR (ver PvP Ranqueado) |
| Bosses | vitórias contra o boss que você escolher na aba |
| Guild Diário | GP da guild, que dá o bônus de XP e loot (ver Guilds) |
| Guild Global | GP somado das guerras do mês, com prêmio em diamantes; zera todo mês |

Clicar num nome abre o perfil público do treinador — stats, Pokédex, o rank do PvP Ranqueado e a equipe dele no PvP, sem dados de conta. O mesmo perfil abre pelo chat e pela lista de amigos.

### Pokémon Forte — como o ⚔ é calculado

Usa a **mesma força de nascimento** da calculadora (soma dos seis stats, normalizada), mas multiplica pelo **nível** do pokémon. Treinar sobe no placar; a nota da calculadora não. Detalhes em Nota, Poder e Calculadora.

```
score = mesma força da nota (0–1) poder = arred( nível × 10 × score )
```

A aba mostra essa fórmula no topo do placar.

> O placar sai do banco, não da memória do jogo: o que você vê pode estar até **5 segundos** atrasado. Para um ranking, é irrelevante.

# Economia e dinheiro

## Market (o NPC)

O balcão do jogo. Compra e venda com o **NPC**, em **ouro**, sem taxa nenhuma e em quantidade ilimitada. Três abas.

### Compra

- **Pokébolas** — as compráveis, aos preços da tabela.
- **Poções** e **Revives** — todas as variantes, ao preço de catálogo.

O **Bronze Boss Token** (entrada de boss) **não** se compra aqui — drop raro na Outland (0,0500% por kill).

### Venda

Tudo que os pokémon dropam, pelo valor de catálogo (**100%** do preço de NPC — não há desconto). Há um botão de **vender tudo** para o inventário inteiro.

> **Consumível que o NPC vende, o NPC não recompra.** Poção e revive entram nessa regra. O Bronze Boss Token também **não** pode ser vendido ao NPC — anuncie no Mercado da Comunidade se quiser passar adiante.

### Venda de Pokémon

```
preço = valorBase × (1 + nível/50) × qualidade × (shiny ? 10 : 1)
```

- O **valorBase** é o da espécie, do catálogo.
- Nível e qualidade valorizam; **shiny vale 10×**.
- Repare que a **potência não entra** nesta conta — o NPC não paga por ela. Um P4 ou P5 vale muito mais no Mercado da Comunidade, com outro jogador.

O **Ordenar por** da lista arruma por nível, qualidade, potência, nota da calculadora, **Maior IV Total** (a soma dos seis IVs), cada IV separado, tipo ou captura mais recente. A mesma lista serve à escolha da Oferenda e ao anexo do chat.

Não dá para vender quem está lutando, nem o último pokémon. "Vender todo o Depot" nunca toca em quem está na equipe.

### A Coleção

Os pokémon que você quer **guardar** vão para a **Coleção**: eles saem desta lista e do "vender todo o Depot", e o NPC não os compra.

- A **setinha** no canto do card manda o pokémon para a Coleção. No Depot (Centro de Cerulean), os guardados têm duas abas, **Depot** e **Coleção**, e a mesma setinha leva de uma para a outra. A Coleção também abre de qualquer lugar, na aba **Coleção** da Bolsa.
- Mover não troca o pokémon de lugar nenhum: é uma marca. Ele continua valendo no Mercado da Comunidade, na Oferenda e nas equipes, com uma **★**. Nesses seletores, o filtro **Local** mostra só a Equipe, o Depot ou a Coleção.
- Cada pokémon espera alguns segundos antes de mudar de lado de novo.
- **Auto Coleção** manda sozinho para a Coleção os shinys, os P5 e quem tem nota a partir da que você escolher (interruptores ao lado do "vender todo"). Pokémon comprado no Mercado da Comunidade e pokémon refinado também chegam na Coleção.

## Caixas do Market

**As caixas existem para queimar Coins.** Ouro parado não vale nada, e a caixa é o lugar onde ele vira sorte: você paga, ela sorteia, e o que sai são **itens** — nunca Coin, diamante ou gema de volta.

Ficam no Market, na aba **Comprar**, categoria **Caixas**.

### As duas caixas

| Caixa | Coins | Diamantes | Chances raras | Quem abre |
| --- | --- | --- | --- | --- |
| **Caixa Free** | 5.000.000 | — | ×1 | todo mundo |
| **Caixa Diamante VIP** | 5.000.000 | 5 | ×2 | só VIP ativo |

A **Caixa Diamante VIP** cobra o mesmo ouro e mais 5 diamantes, e é **só para quem tem VIP ativo**. Em troca, **dobra a chance de tudo que é raro e lendário** — o que cresce em cima encolhe nos comuns, sozinho. É o único benefício dela: não existe item que só saia na VIP.

### Sai UM prêmio por caixa

Cada caixa aberta dá **uma coisa**, e todas as coisas dividem os mesmos 100%. A porcentagem ao lado de cada linha da tabela abaixo é **a chance dela sair**, sem letra miúda. Quem quer abrir várias escolhe a quantidade no contador do card: são **N caixas**, cada uma com o seu sorteio, N vezes o preço.

O botão **Máx** enche com **quantas caixas o seu saldo paga** — o mesmo teto que o resto do Market usa. Quem tem 3 bilhões de Coins abre **3.000 de uma vez**, e o resultado vem **agrupado**: "Poké Ball ×60.000 · saiu 12×" quer dizer que 12 das suas caixas deram Poké Ball.

### Tudo o que pode sair

| Prêmio | Raridade | Caixa Free | Caixa Diamante VIP |
| --- | --- | --- | --- |
| Bronze Boss Token | Lendário | 4,0% | 8,0% |
| Fragmento de Chave | Lendário | 0,08% | 0,16% |
| Fragmento de Shiny Stone | Lendário | 0,08% | 0,16% |
| Fragmento de Bicicleta | Lendário | 0,08% | 0,16% |
| Beast Ball ×25 | Raro | 6,0% | 12,0% |
| Poké Ball ×5.000 | Comum | 23,3% | 20,7% |
| Great Ball ×2.500 | Comum | 18,0% | 15,9% |
| Super Ball ×1.200 | Comum | 14,4% | 12,7% |
| Ultra Ball ×700 | Comum | 10,8% | 9,5% |
| Revive ×200 | Comum | 10,8% | 9,5% |
| Max Revive ×30 | Comum | 5,4% | 4,8% |
| Hyper Potion ×200 | Comum | 4,5% | 4,0% |
| Ultimate Potion ×100 | Comum | 1,8% | 1,6% |
| Golden Potion ×40 | Comum | 0,90% | 0,80% |

Esta é a mesma tabela que o servidor sorteia, e ela está na tela no botão **"Ver Conteúdo"** de cada caixa, antes do clique.

### É caro de propósito

Farmar um **Bronze Boss Token** custa cerca de 2.000 abates na Outland; a caixa cobra várias vezes isso em Coins. Os **fragmentos** (Chave, Shiny Stone, Bicicleta) e o **Bronze Boss Token** são o prêmio grande — um fragmento sai, em média, a cada **6,25 bilhões de Coins** na Caixa Free, e um token a cada **125 milhões**. A caixa vende **sorte e tempo**, não um atalho barato: em média ela devolve menos do que cobra, e é essa diferença que queima o ouro do servidor.

> **Nada volta em dinheiro.** Nenhuma caixa devolve Coin, diamante ou gema — se devolvesse, ela deixaria de ser um ralo e viraria uma torneira.

## Mercado da Comunidade

Aqui quem está do outro lado do balcão é **outro jogador**. Você anuncia pokémon, itens e **diamantes comprados**, e cobra em **Ouro** ou em **Gema** — a moeda com lastro em USDT (ver Gemas).

### Anunciar

- Anunciar **tira da sua mão**: o item sai da bolsa e o pokémon sai do depot na hora. Cancelar devolve.
- Você pode ter até **20 anúncios abertos** ao mesmo tempo.
- **Um anúncio por item**: enquanto o seu Water Stone estiver na vitrine, não dá para abrir um segundo por outro preço — mude o preço do que já está lá. Quando ele sair (vendido ou cancelado), são **30 minutos** até você poder anunciar o mesmo item de novo. É o que impede uma escada de "o mesmo item por um Coin a menos" tomar a lista inteira.
- **Só três famílias de item entram**: **pedras de evolução**, **discos de TM** e **fichas de boss**. Drop de pokémon (Bug Wing, Fur, Fossil…) não vai mais à vitrine — eram centenas de itens de mil moedas enterrando o que a pessoa foi procurar.
- **Pokémon precisa passar na faixa mínima**: **nível 50+** e **nota 3+** na calculadora (força de nascimento — IV, qualidade, potência e shiny). **Shiny e P5** entram em qualquer nível/nota.
- O preço é **por unidade**. Um lote de 100 Water Stone pode ser comprado em fatias.

### Comprar

Todo pokémon comprado aqui **chega na sua Coleção**, fora da venda ao NPC, para ele não ir embora num "vender todo o depot" do Market. Devolva ao Depot se quiser mesmo revendê-lo ao NPC.

- A **★** no card de um pokémon à venda guarda o anúncio na aba **Favoritos**. Se alguém comprar ou o vendedor retirar, o card continua lá por alguns dias, apagado e com o aviso, até você limpar.
- A **Tabela de preços** (a prancheta) mostra as vendas recentes de todo mundo e filtra por tipo, por moeda (Coins ou Gemas) e por item — os Diamantes inclusive.

### Filtros de pokémon

Na aba de pokémon, além do tipo, dos selos e do **Filtrar por**, o grupo **Faixas** tem "mín" e "máx" para **nível, potência, IV total, qualidade e nota**. Dá para pedir "nota de 3,8 a 4,1", "IV acima de 166" ou "potência de P3 para cima", e combinar tudo. Qualidade e nota aceitam vírgula, e uma faixa digitada ao contrário vale como a mesma faixa.

### Retenção e sorteio

O anúncio aparece na hora para todo mundo, mas só pode ser comprado depois de **2 minutos** de retenção. O selo **Retido** conta o tempo ao vivo, pelo relógio do servidor.

- Somar unidades a um anúncio que já está à venda **reinicia** a retenção. Editar o preço só é possível depois que ela acaba, e também a reinicia. Cancelar vale a qualquer momento.
- **Sorteio na liberação:** todo pedido de compra que chega nos primeiros **3 segundos** depois de o anúncio liberar entra num sorteio com a mesma chance. Pedir no primeiro milissegundo não vale mais que pedir no fim da janela. Quem pede depois do sorteio compra na hora, como sempre.
- **Um pedido por jogador em cada anúncio**: clicar várias vezes não dá mais chances. Quem perde o sorteio recebe o aviso e não paga nada.

### Vender diamantes

A terceira aba do mercado vende **diamante** — a moeda que se compra com dinheiro de verdade. É o caminho para quem tem diamante e quer Coins ou Gemas, e para quem tem Coins e quer diamante sem passar pelo cartão.

> **Só o diamante COMPRADO pode ser vendido.** Entram os que você pagou com PIX ou cartão e os que recebeu como **comissão de indicação**. Os que vieram de **voto no TopIdle**, do **pódio de guilds** ou de um **ajuste da administração** ficam de fora — eles existem para gastar na Loja, e deixá-los virar Coin transformaria um prêmio numa torneira de economia. A tela de anunciar mostra quantos você pode vender antes de pedir o preço.

- O preço é **por diamante**; o comprador pode levar uma **fatia** do lote.
- Anunciar **tira do seu saldo** na hora, como o item sai da bolsa. Cancelar devolve o que ainda restava no anúncio.
- **Um anúncio de diamante por vez**, com os mesmos 30 minutos de espera entre um e o próximo. Para vender mais barato, edite o preço do que já está de pé.
- Diamante **comprado de outro jogador** não pode ser revendido: quem o recebeu não pagou por ele em dinheiro nenhum, e revender abriria um ciclo sem lastro.
- A comissão da tabela abaixo vale igual, e sai do vendedor.

### A pensão da feira

Pokémon anunciado não fica numa prateleira: fica na **feira**, e os tratadores de lá cuidam dele até alguém levar. Por isso **só pokémon** paga diária — **15.000 Coins por dia**, de 1 a 30 dias, escolhidos na hora de publicar e pagos à vista.

- **Item não paga nada** e não tem prazo: prateleira não come.
- Vendeu antes do fim? Os dias já pagos **não voltam** — os tratadores cuidaram dos dias que cuidaram.
- Ninguém levou? No fim do prazo o pokémon **volta para o seu Depot** sozinho — na hora, mesmo com o jogo aberto, e com um aviso na tela dizendo o que voltou.

### A comissão

| Regra | Taxa |
| --- | --- |
| Anúncio cobrado em **Ouro** | 10% |
| Anúncio cobrado em **Gema** | 15% |

A comissão sai do **vendedor**: quem anuncia por 100 Coins recebe **90**; por 100 Gemas recebe **85**. O comprador paga exatamente o que está na vitrine.

### Você recebe quando entrar

A venda cai numa **caixa postal**. Da próxima vez que você abrir o jogo (ou dentro de um minuto, se já estiver dentro), o valor entra e um aviso diz o que foi vendido e por quanto. É assim porque o vendedor quase sempre está offline na hora da venda.

### A trava de preço

> Ao comprar, o jogo manda junto **o preço que estava na sua tela**. Se o vendedor tiver subido o valor entre o seu clique e a chegada da mensagem, a compra é **recusada** em vez de cobrar o preço novo. Se o preço tiver **caído**, você paga o mais barato. A moeda entra na mesma trava — um anúncio de 100 de ouro que vira 100 gemas é recusado.

### A ficha do anúncio

Clique na arte de um pokémon anunciado (ou em **Ver ficha**) para abrir tudo sobre ele: nível, XP e quanto falta para o próximo, os seis stats com o IV de cada um (SPD encurta cooldown), a qualidade, a nota da calculadora, o brilho e o que cada potência valeria naquele bicho. É a única forma honesta de julgar um preço.

## Loja de Diamantes

A loja do JOGO. Paga-se em **Diamante**, que se compra com dinheiro de verdade (PIX ou cartão) e **acaba ao ser gasto**. Não confunda com a **Gema**, que é do Mercado da Comunidade e volta em USDT.

### VIP

| Efeito | Regra |
| --- | --- |
| +50% de XP | no treinador E no pokémon |
| Auto-Catch | libera a automação **Lançar pokébola** |
| Outfit exclusiva | o Trainer VIP |
| Emojis VIP | no chat |

Renovar **estende** em vez de reiniciar: comprar 30 dias faltando 10 dá 40. O tempo restante aparece no seu painel, em dias, com a tag azul.

### Boosts

Cinco tipos, sete durações cada. Preço em diamante:

| Efeito | 1h 💎 | 2h 💎 | 3h 💎 | 6h 💎 | 12h 💎 | 24h 💎 | 7d 💎 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| XP Boost*×1,5* | 3 | 6 | 8 | 12 | 20 | 29 | 175 |
| XP Boost Pokémon*×1,5* | 3 | 6 | 8 | 12 | 20 | 29 | 175 |
| Loot Boost*×1,4* | 6 | 12 | 15 | 24 | 40 | 58 | 350 |
| Capture Boost*×2* | 6 | 12 | 15 | 24 | 40 | 58 | 350 |
| Shiny Secret Lure*×2* | 6 | 12 | 15 | 24 | 40 | 58 | 350 |

- **Não acumulam**: comprar o mesmo tipo de novo **estende** o que está correndo.
- Limite de **5 compras por dia, por tipo** (qualquer duração).
- Tipos diferentes rodam juntos — três boosts ativos aparecem como três linhas no seu painel, cada uma com o próprio contador.

### Mercado

| Item | Preço | Efeito |
| --- | --- | --- |
| Beast Ball ×100 | 2 💎 | 100 Beast Balls — 2× a chance da Ultra Ball. |
| Beast Ball ×300 | 5 💎 | 300 Beast Balls — 2× a chance da Ultra Ball. |
| Beast Ball ×600 | 10 💎 | 600 Beast Balls — 2× a chance da Ultra Ball. |
| Pacote de Suprimentos | 5 💎 | 1000 Beast Balls. Comprável 1× por semana. |
| 30 Dias de VIP | 10 💎 | 30 dias de VIP: +50% XP (personagem e Pokémon), Auto-Catch e outfit exclusiva na aba Outfits. |
| 60 Dias de VIP | 17 💎 | 60 dias de VIP: +50% XP (personagem e Pokémon), Auto-Catch e outfit exclusiva na aba Outfits. |
| 90 Dias de VIP | 25 💎 | 90 dias de VIP: +50% XP (personagem e Pokémon), Auto-Catch e outfit exclusiva na aba Outfits. |
| Troca de Nome | 6 💎 | Muda o nome do seu personagem. |
| Escape Rope | 1 💎 | Sai da hunt direto para o Centro Pokémon, na hora, sem a espera de 3 s. Vale só em hunts — na arena PvP a saída continua sendo a de lá. Consome 1 ao usar. |
| Exp. Share | 50 💎 | Item held: repassa 5% do XP que o seu pokémon de batalha ganha em cada abate para UM pokémon da equipe ou do depot. NÃO é negociável — fica na sua conta. Para vender o pokémon, remova o item antes (Bolsa → Itens raros → Exp. Share). |
| Bless Plus | 1 💎 | Ao desmaiar você perde só 8% de XP. Vale por 1 morte. |
| Bless Ultra | 2 💎 | Ao desmaiar você perde só 3% de XP. Vale por 1 morte. |
| Bless Max | 3 💎 | Ao desmaiar você NÃO perde XP. Vale por 1 morte. |

> O **Pacote de Suprimentos** é o melhor negócio em bolas por diamante, mas só pode ser comprado **uma vez por semana**. O contador aparece no próprio botão quando ainda está em espera.

### Outfits

Aparência para o seu treinador, 30 💎 cada. Comprar já equipa, e você troca entre as suas quando quiser.

## Gemas: depósito e saque

A **Gema** é a única moeda do jogo que **volta a ser dinheiro**. Você a compra depositando **USDT** e a saca de volta em **USDT**, para a sua carteira ou direto para uma corretora (Binance, OKX, Bybit — qualquer uma que aceite USDT na rede escolhida).

### Os preços

| Regra | Valor |
| --- | --- |
| Comprar 1 Gema | US$ 0.01 |
| Sacar 1 Gema | US$ 0.009 |
| Spread (a diferença entre as duas pontas) | 10% |
| Saque mínimo | 1.000 Gemas (US$ 9.00) |
| Taxa de rede do saque | por conta do projeto |

Não há taxa por transação: o **spread de 10%** é a única cobrança, e é dele que saem servidor, desenvolvimento e a taxa de rede dos saques.

### Como DEPOSITAR

1. Abra **Comunidade → Depósito**. O jogo mostra um **endereço só seu**, na rede Solana (SPL).
2. Mande **USDT** desse endereço a partir da sua carteira ou corretora. **Confira a rede** — USDT existe em várias, e mandar pela errada perde o dinheiro.
3. O jogo confirma o depósito automaticamente e credita as Gemas. Basta esperar as confirmações da rede.

> **Mande só USDT, e só na rede indicada.** Qualquer outro token, ou o mesmo token noutra rede, cai num lugar de onde não há como recuperar. Isto vale para todo endereço de depósito de qualquer serviço — não é uma limitação nossa.

### Como SACAR (inclusive direto para a Binance)

1. Na sua corretora, vá em **Depositar → USDT** e escolha a rede **Solana (SPL)**. Copie o endereço de depósito que ela gerar.
2. No jogo, abra **Comunidade → Withdraw**, cole esse endereço, escolha a mesma rede e diga quantas Gemas quer sacar (mínimo 1.000).
3. Confira o endereço **caractere por caractere** na tela de confirmação. Uma transferência enviada **não tem como ser desfeita**.
4. O pedido entra na fila. Você acompanha o status no extrato e, quando sair, recebe o **hash** da transação para conferir no explorador da rede.

> Se a sua corretora pedir um **MEMO/TAG** junto do endereço, ela **não** serve para este saque — o campo de memo não existe aqui. Use uma carteira própria e transfira de lá, ou escolha uma corretora que dê endereço sem memo.

### A transparência do caixa

A carteira do projeto é pública. No painel de depósito você vê, em tempo real, quanto entrou, quanto saiu, quanto está em caixa e qual é o **passivo** — o que o projeto deveria se todo mundo sacasse tudo agora. É esse número que precisa ficar abaixo do caixa, e é por isso que ele está publicado.

> **Gema nunca é dada de graça.** Não cai de drop, não vem de quest, não sai de boss. Toda Gema que existe foi comprada por alguém — é isso que mantém o caixa solvente.

## Todas as taxas

Tudo que o jogo desconta, num quadro só. Se não está aqui, não é cobrado.

| Taxa | Quanto | Quem paga |
| --- | --- | --- |
| Mercado da Comunidade — anúncio em Gema | 15% sobre a venda | o VENDEDOR |
| Mercado da Comunidade — anúncio em Ouro | 10% sobre a venda | o VENDEDOR |
| Mercado da Comunidade — pensão do pokémon | 15.000 Coins por dia (só pokémon) | o VENDEDOR |
| Market (NPC) — comprar | nenhuma | — |
| Market (NPC) — vender | nenhuma (paga o valor cheio do catálogo) | — |
| Gema — compra com USDT | US$ 0.01 por Gema | o comprador |
| Gema — saque em USDT | US$ 0.009 por Gema (spread de 10%) | quem saca |
| Gema — taxa de rede do saque | por conta do projeto | — |
| Loja de Diamantes | nenhuma (o preço é o final) | — |
| Arena PvP — morrer | perde XP do nível atual | quem morre |

> **O jogo não cobra taxa em ouro.** Comprar e vender no Market é pelo valor de catálogo, e anunciar em ouro no Mercado da Comunidade é de graça. A única comissão do jogo é a de 15% sobre vendas em Gema, e ela existe porque Gema é dinheiro de verdade circulando entre jogadores.