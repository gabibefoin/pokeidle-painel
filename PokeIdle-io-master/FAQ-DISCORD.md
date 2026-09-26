# PokeIdle.io — Base de conhecimento para o bot do Discord

> **Instruções para o bot:** este arquivo é a fonte oficial para responder dúvidas de jogadores.
> Cada seção é auto-contida — responda usando a seção que casar com a pergunta e cite os números
> exatamente como estão aqui. **Nunca invente mecânica.** Se a resposta não estiver neste arquivo,
> diga que não sabe e mande abrir a **Poképedia** dentro do jogo (menu principal → Poképedia), que
> é o manual vivo e sempre bate com o servidor. A seção final *"O que NÃO existe no jogo"* lista
> sistemas que jogadores costumam citar e que aqui **não existem** — use-a para não confirmar coisa
> errada.
>
> O jogo é jogável em **português, inglês e espanhol**. Responda no idioma do jogador.

---

## 1. O que é o PokeIdle.io

**Palavras-chave:** o que é, como jogar, idle, jogo, começar, tutorial

PokeIdle.io é um **idle/incremental** de Pokémon no navegador: o seu pokémon luta sozinho. Você
escolhe **onde** caçar, **com quem** e **o que fazer com o que cair** — durante a luta não se
clica em nada. O jogo roda enquanto a aba estiver aberta.

O jogo tem economia real: existe uma moeda com lastro em USDT (**Gema**) que permite RMT entre
jogadores, e uma moeda de doação (**Diamante**). As duas são coisas diferentes — ver seções 31 e 32.

Conteúdo publicado hoje: **1.208 espécies**, **764 hunts jogáveis**, **331 itens**, **612 formas
shiny**, **24 bosses lendários**, 2 arenas de PvP.

Projeto de fã, sem fins oficiais. Pokémon é marca registrada de Nintendo, Game Freak, Creatures e
The Pokémon Company — não somos afiliados a eles.

---

## 2. Conta, login e nick

**Palavras-chave:** login, conta, senha, Google, Discord, entrar, cadastro, nick, nome

- O jogo **só aceita usuário registrado e logado**. Não existe entrada anônima nem convidado.
- Três caminhos de entrada: **conta local** (nick ou e-mail + senha), **Google** ou **Discord**.
- Tudo no jogo roteia pelo **nick** (é único). A conta apenas aponta para o nick.
- Trocar o nick depois custa **6 💎** na Loja ("Troca de Nome").
- O onboarding é: nick → gênero → cores do personagem → starter. Depois disso o gênero só muda
  em **Mudar avatar** (Centro Pokémon / ficha do treinador), sem custo de diamante.

---

## 3. Limite de contas (POSIÇÃO OFICIAL)

**Palavras-chave:** multi conta, multiconta, quantas contas, segunda conta, alt, limite de contas, dual

**Ainda não há limite de contas.**

Mas a intenção do projeto é clara: **o jogo está sendo feito para que o ideal seja ter UMA conta
só.** As mecânicas são desenhadas em cima de uma conta principal, e é assim que a experiência foi
pensada. Quem espalhar progresso em várias contas está remando contra o desenho do jogo.

Não prometa ao jogador que multiconta é "liberado e apoiado" — a resposta correta é: *hoje não há
limite, porém o jogo é construído para uma conta apenas.*

---

## 4. BETA TEST e RESET (POSIÇÃO OFICIAL)

**Palavras-chave:** beta, reset, wipe, vai resetar, perder progresso, apaga tudo, lançamento

**SIM, VAI ROLAR RESET.** O jogo está em beta test e o progresso será zerado no reset.

O que **é mantido / devolvido** no reset:

| Item | O que acontece |
|---|---|
| **Shinys** | **mantidos** |
| **Pokémon P5 (potência 5)** | **mantidos** |
| **Diamantes comprados no beta** | **devolvidos** |
| **Gemas compradas no beta** (que **não** foram sacadas para a wallet) | **devolvidas** |

Ou seja: quem investiu no beta não perde o que comprou, e as duas coisas mais raras do jogo
(shiny e P5) atravessam o reset. O resto do progresso — nível, ouro, itens, pokémon comuns —
recomeça.

---

## 5. O laço de sempre (loop básico)

**Palavras-chave:** como funciona, o que faço, primeiros passos, loop, básico

1. **Abra o Mapa** e escolha uma área. Cada uma tem um nível recomendado (o do pokémon mais forte
   que aparece lá). Área acima do seu nível de treinador fica trancada.
2. **O seu pokémon ativo** anda até o selvagem mais próximo e começa a bater sozinho.
3. **Derrubado, o selvagem vira corpo** e fica **30 segundos** no chão. É nesse intervalo que se
   joga a pokébola — é assim que se captura.
4. **O loot** vai para a Bolsa; o ouro entra direto. Venda o que não usar no **Market**.

---

## 6. Equipe, Depot e pokémon ativo

**Palavras-chave:** equipe, time, depot, quantos pokémon, guardar, slots, ativo

- A equipe tem **5 lugares**.
- Quem for capturado com a equipe cheia cai no **Depot**, que **não tem limite**.
- Só **um** pokémon luta por vez (o **ativo**). Quando ele desmaia, o próximo da equipe de pé entra
  automaticamente.
- O Depot fica no **Centro Pokémon**: modal com equipe à esquerda e depot à direita, busca, e setas
  **→** (mandar pro depot) / **←** (trazer pro time).
- "Vender todo o Depot" **nunca** toca em quem está na equipe.

---

## 7. Níveis e XP

**Palavras-chave:** xp, nível, level, subir de nível, curva, level max, cap

Existem **dois níveis independentes**: o do **treinador** (você) e o do **pokémon ativo**. Cada
derrota paga o mesmo XP para os dois.

- O nível do **treinador** é o que **destranca as regiões** do Mapa.
- O nível do **pokémon** é o que faz os stats crescerem — e ele **cura por completo** a cada nível.

A curva é cúbica e **não tem teto**:

```
xpTotal(L) = arred( 50/3 × (L³ − 6L² + 17L − 12) )
```

| Nível | XP total |
|---:|---:|
| 10 | 9.300 |
| 25 | 204.800 |
| 50 | 1.847.300 |
| 100 | 15.694.800 |
| 300 | 441.084.800 |
| 1.000 | 16.566.949.800 |

**Não existe nível máximo.** Quem pergunta "quando chego no level max" deve saber que o cap não
existe — a curva só fica mais cara.

**O que multiplica o XP** (eles se **multiplicam**, não somam):
- **XP Boost** — +50% no XP do TREINADOR
- **XP Boost Pokémon** — +50% no XP do POKÉMON
- **VIP** — +50% nos dois
- Bônus de **guild** (top do ranking de GP), bônus de **ranking PvP** e **eventos globais**

Exemplo: VIP + XP Boost dá **2,25×**, e não 2×.

---

## 8. Stats, Qualidade e IV

**Palavras-chave:** stats, iv, qualidade, quality, poder, power, como calcula, forte

Três números são sorteados **na captura** e **nunca mais mudam**: **qualidade**, **IV** e
**potência**.

```
stat  = arred( (base + 2 × IV) × nível/100 × qualidade^expoente × multiplicador )
poder = (hp + atk + def + spAtk + spDef + speed) × qualidade
```

- **IV** — seis sorteios independentes de **1 a 32** cada (soma máxima **192**). Evoluir **não**
  rerola nada.
- **Expoente da qualidade**: **0,95** para HP e Velocidade, **0,8** para os outros quatro.
- **HP de combate** = `máx(24, arred(hp × 12))`.

### Como a qualidade nasce (a dúvida mais comum)

A qualidade **NÃO é calculada** a partir dos IVs, da potência, do shiny nem do nível. Na captura o
jogo sorteia **uma faixa** e, dentro dela, um valor aleatório com três casas decimais. São
**sorteios independentes** — IV alto **não** puxa a qualidade para cima.

| Faixa de qualidade | Chance | Rótulo |
|---|---:|---|
| 0,8 – 0,9 | 5% | Fraca |
| 0,9 – 1,0 | 5% | Fraca |
| 1,0 – 1,1 | 34,04% | Comum |
| 1,1 – 1,2 | 20% | Incomum |
| 1,2 – 1,3 | 10% | Incomum |
| 1,3 – 1,4 | 10% | Rara |
| 1,4 – 1,5 | 10% | Rara |
| 1,5 – 1,6 | 5% | Épica |
| 1,7 – 1,8 | 0,673% | Lendária |
| exatamente 1,800 | 0,288% | Lendária (perfeita) |

- A faixa **1,6 – 1,7 é um buraco intencional**: nenhum pokémon nasce nela.
- O **teto da captura selvagem é 1,8**. Qualidade acima disso não sai de captura.
- **Shiny NÃO ganha qualidade extra** — ele é mais forte pelo ×2 nos stats e pelos IVs rerolados.

### O piso do starter

O primeiro pokémon **não** passa pelo sorteio livre: nasce com qualidade **≥ 1,30**, soma de IVs
**> 140**, nenhum IV abaixo de **16** e **potência 2**. Sem isso, um em cada dez treinadores
começaria com um bicho da banda "Fraca" e a primeira hunt seria intransponível.

---

## 9. Potência (P1 a P5)

**Palavras-chave:** potência, potencia, P5, P4, roman, I II III IV V, multiplicador

Número de **1 a 5** sorteado **uma vez, na captura**, que **nunca muda** — subir de nível não
melhora a potência.

| Potência | Chance | Bônus em TODOS os stats |
|---|---:|---:|
| P1 | 74,495% | +0% |
| P2 | 20% | +5% |
| P3 | 5% | +10% |
| P4 | 0,5% | +25% |
| P5 | **0,005%** (1 em 20.000) | **+100%** |

- Por causa dela um pokémon de **nível baixo** pode valer muito no Mercado da Comunidade: nível
  qualquer um sobe, potência não. Um **P4 nível 20 vale mais que um P1 nível 80** da mesma espécie.
- **Potência e shiny se multiplicam**: shiny é ×2, então **P5 + shiny = ×4**.
- O **NPC não paga por potência** — só outro jogador paga.
- O **starter não gira a roleta**: nasce em P2.

---

## 10. Calculadora Pokémon (nota de 0 a 10)

**Palavras-chave:** calculadora, nota, meu pokémon é bom, vale a pena, avaliar

Há uma **Calculadora Pokémon** no jogo que dá uma **nota de 0 a 10** para o sorteio de nascença de
um pokémon. Entram três eixos: **soma dos IVs**, **qualidade** e **potência**. **Nível fica de
fora de propósito** — nível se treina; o resto nunca muda.

A nota é **percentil**: cada barra mostra quantos por cento das capturas o seu pokémon supera
naquele eixo. Referência útil: o **piso de anúncio do Mercado da Comunidade** (IV 120, qualidade
1,30, potência 3) dá nota **7,9** — ou seja, tudo que pode ser anunciado já é, por construção, um
bicho de nota verde.

---

## 11. Shiny

**Palavras-chave:** shiny, brilhante, raro, chance de shiny, tier, lure

**612 espécies** têm forma shiny. O shiny aparece sozinho na hunt, com **arte própria** (não é
recolorização — é um sprite diferente) e um selo ✨ no cartão.

### Raridade por tier

A chance depende do **tier da espécie** e é sorteada **quando o selvagem nasce** — antes de você
poder interferir em qualquer coisa.

| Tier | Espécies | Chance por encontro | Com Shiny Secret Lure |
|---|---:|---:|---:|
| A | 18 | 1 / 2.000 | 1 / 1.000 |
| B | 95 | 1 / 4.000 | 1 / 2.000 |
| C | 441 | 1 / 8.000 | 1 / 4.000 |
| D | 51 | 1 / 16.000 | 1 / 8.000 |
| E | 8 | 1 / 32.000 | 1 / 16.000 |

O **Shiny Secret Lure**, da Loja de Diamantes, **dobra** a chance enquanto ativo.

### O que o brilho dá

- **×2 em todos os stats** — o maior multiplicador do jogo, e multiplica com a potência.
- **IV alto garantido**: o sorteio é refeito até a soma dos seis passar de **110** (máximo 192).
- **Vale 10× a mais** na venda ao NPC.
- **Shiny não evolui.**
- **Shiny e P5 são isentos da faixa mínima** do Mercado da Comunidade — entram em qualquer nível/status.

### O ponto que mais confunde

**Capturar um shiny usa a mesma pokébola e a mesma chance por arremesso que qualquer outro
pokémon.** O que é raro é **ELE APARECER**, não ele se deixar pegar. Por isso, ao encontrar um,
gaste a melhor bola que tiver.

---

## 12. Botão de captura automática só de shiny (POSIÇÃO OFICIAL)

**Palavras-chave:** auto shiny, botão shiny, automação shiny, capturar shiny automático, macro shiny

**NÃO vamos criar um botão que lance pokébola automaticamente apenas quando aparecer um shiny.**

Essa discussão já aconteceu diversas vezes no Discord e a resposta é a mesma. O motivo:
**acabaria com o RMT.** Uma hora todo mundo teria shiny — bastaria deixar multiconta rodando com
essa automação ligada, sem presença nenhuma, e o item mais raro do jogo viraria commodity.

O shiny vale porque exige alguém **de fato jogando** e reagindo ao encontro. Automatizar exatamente
esse instante remove a única barreira que sustenta o valor dele no mercado entre jogadores.

A automação de pokébola que existe (**Lançar pokébola**, benefício VIP) arremessa em **corpos
caídos em geral**, não em shiny especificamente — ver seção 14.

---

## 13. Captura e pokébolas

**Palavras-chave:** captura, capturar, pokébola, ball, chance, taxa, difícil, não consigo pegar

### As pokébolas

| Bola | Eficiência | Preço (ouro) | Onde compra |
|---|---:|---:|---|
| Poké Ball | ×1 | 5 | Market (NPC) |
| Great Ball | ×2 | 20 | Market (NPC) |
| Super Ball | ×3 | 50 | Market (NPC) |
| Ultra Ball | ×4 | 130 | Market (NPC) |
| **Beast Ball** | **×5** | — | **só com 💎**, em pacotes na Loja |

### A chance por arremesso

```
raridade = log10(máx(100, preçoNpc)) − 1
fator    = 1 + raridade³ / 17
chance   = 0,0075 × (eficiência / fator) × (1,4 − hpAtual/hpMáximo)
```

Limitada entre **0,3%** e **10%**. Três coisas decidem tudo:

- **Quanto o pokémon vale** (preço de NPC, em escala logarítmica) — Pidgey sai fácil, Dragonite não.
- **A bola** — a eficiência multiplica direto.
- **O HP do alvo** — corpo caído tem HP zero, que é a ponta boa da fórmula.

### Capturar é difícil de propósito

Com a **melhor bola**, num **corpo caído**, a espécie mais fácil do jogo dá **~5%** e a mediana dá
**~2%**. A ficha de cada espécie na Pokédex mostra a tabela exata, bola por bola, com quantas
derrotas isso significa na média.

### É UMA tentativa por corpo

Se a bola falhar num **corpo caído**, ele some do mapa. **Não dá para despejar bolas no mesmo
alvo até sair** — é isso que faz o custo por captura existir. Um selvagem **vivo** continua em
campo quando a bola falha, porque ele ainda está lutando.

### O que aumenta a captura

- **Capture Boost** (Loja) — **dobra** a chance por arremesso, respeitando o teto de 10%.
- **Bola melhor** — a Poké Ball é a mais barata *por arremesso*; Ultra e Beast gastam menos tempo.

---

## 14. Automações

**Palavras-chave:** automação, auto, autocatch, auto catch, revive automático, poção automática, auto venda

Ficam na coluna da direita e valem enquanto a aba estiver aberta.

| Automação | O que faz | Requisito |
|---|---|---|
| **Lançar pokébola** | arremessa sozinha nos **corpos caídos**, um por corpo, a cada 1,2 s | **exclusivo VIP** |
| **Usar Revive ao desmaiar** | levanta o pokémon ativo com **50%** do HP em vez de trocar | ligado por padrão |
| **Usar +HP** | usa poção (recupera **40%** do HP máximo) abaixo de um limiar | ligado por padrão |
| **Voltar à hunt ao morrer/reset** | cura no Centro e reentra na hunt salva, 3 s depois | ligado por padrão |
| **Venda automática de loot** | vende o loot destrancado direto ao NPC | — |
| **Auto Coleção Shiny** | shiny capturado vai direto para a **Coleção** (fora da venda ao NPC) | ligado por padrão |
| **Auto Coleção N / P5** | pokémon com nota a partir da escolhida, ou P5, vai direto para a Coleção | — |

- Em "Lançar pokébola" você escolhe **quais bolas** podem ser gastas; a automação usa a primeira da
  lista que ainda tiver estoque.
- **Revive, poção e "voltar à hunt" já vêm LIGADOS**, com todas as poções e revives da loja já
  marcados — conta nova nasce assim e as contas antigas foram ligadas na virada. Quem não quiser
  desliga no painel, e aí fica desligado (não volta sozinho no próximo deploy).
- Em revives e poções, a **ordem dos cliques é a ordem de gasto** — e o padrão vai do mais
  barato para o mais caro. Nada escolhido = qualquer um, mas aí do mais **caro** para o mais barato.
- A automação **para** quando acaba tudo o que está marcado: ela não gasta o que você não pediu.
- "Voltar à hunt" só dispara se houver **cura na bolsa** — sem poção nem revive ela não devolve
  você para a hunt que acabou de matar o time.
- Limiares de poção: **20%** (economiza poção), **30%** (padrão), **60%** (hunt acima do seu nível).
- Sem VIP, o interruptor de pokébola abre o convite para a Loja; quando o VIP vence a automação
  para sozinha (a escolha de bolas fica guardada).

### A Coleção (o antigo cadeado de venda)

**Palavras-chave:** coleção, colecao, cadeado, trancar, travar, guardar pokémon, não vender, auto lock

- O **cadeado** de pokémon virou a **Coleção**. Na aba **Venda Pokémons** do Market, a **setinha**
  no canto do card manda o pokémon para a Coleção — e ele some dessa lista e do "vender todo o
  depot". O NPC não compra pokémon da Coleção.
- A Coleção fica em dois lugares: no **Depot** (Centro de Cerulean), com as abas **Depot** e
  **Coleção**, e na **Bolsa**, aba **Coleção** (abre de qualquer lugar). Para voltar a vender, é a
  setinha de volta: **Devolver ao Depot**.
- Pokémon da Coleção **continua valendo** no Mercado da Comunidade, na Oferenda, no anexo da DM, na
  vitrine e nas equipes (PvP, Guerra de Guilds, Campeonato, ginásio), com uma **★** no card. Esses
  seletores têm o filtro **Local**: Todos, Equipe, Depot ou Coleção.
- Mover é só uma marca — o pokémon não muda de lugar no servidor e **não tem como duplicar**. Cada
  pokémon espera **3 segundos** antes de mudar de lado de novo.
- O **Auto Selecionar** da Oferenda nunca pega pokémon da Coleção.
- Pokémon **comprado** no Mercado da Comunidade e pokémon **refinado** chegam direto na Coleção.

---

## 15. Combate

**Palavras-chave:** dano, combate, luta, stab, cooldown, golpe, ataque básico, investida

O pokémon ativo anda até o selvagem **mais próximo** e só troca golpes quando **encosta** nele.

```
base  = ((2 × nível/5 + 2) × power × atk/def) / 50 + 2
final = base × STAB × efetividade × aleatório(0,85–1,00)
```

- **power** é o do golpe. Cada golpe tem **cooldown** próprio (2 a 60 s) e **nível mínimo** para
  ser aprendido.
- **STAB** é **×1,5** quando o golpe é de um dos tipos do próprio pokémon.
- **atk/def** usa Ataque/Defesa em golpe físico e Sp.Atk/Sp.Def em especial.
- **Ataque básico (Investida)**: enquanto todos os golpes carregam, o pokémon dá uma investida de
  power **30**, a cada **2 s**, no tipo dele.

### O selvagem joga com vantagem (e isso é de propósito)

| Regra | Valor |
|---|---:|
| HP do selvagem na hunt | **×5** |
| Dano do selvagem por golpe | **×1,8** |
| Intervalo mínimo entre golpes seus | 0,9 s |
| Intervalo mínimo entre golpes dele | 1,4 s |

É o que faz uma hunt no seu nível ser uma luta, e não uma fila.

### Ondas e corpos

Os selvagens nascem em **ondas** nos pontos de spawn. Quando o campo esvazia, a onda seguinte entra
em poucos segundos. Quem cai fica no chão **30 segundos**.

### Drop especial na Outland

Selvagens derrotados na **Outland** podem soltar **1× Bronze Boss Token** — **0,05% por kill**
(média ~**2.000 derrotas** por token). Kanto e Orre não dropam. O Loot Boost (e guild/ranking/
eventos) aumenta a chance. O NPC **não compra nem vende** o token — o preço dele é o que a
comunidade cobrar no Mercado da Comunidade.

---

## 16. Tabela de tipos e a amplificação da hunt

**Palavras-chave:** tipo, fraqueza, efetividade, super efetivo, tabela de tipos, vantagem

A efetividade é **multiplicativa nos dois tipos** do defensor. Água contra Rocha/Terra é ×2 × ×2 =
**×4**.

**Na hunt, a vantagem elemental é 1,5× mais pronunciada — nos dois sentidos.** É a mecânica mais
específica deste jogo:

| Base | Na hunt |
|---:|---:|
| ×0 | ×0 (imunidade não muda) |
| ×0,25 | ×0,167 |
| ×0,5 | **×0,33** |
| ×1 | ×1 (neutro não muda) |
| ×2 | **×2,5** |
| ×4 | **×5,5** |

Consequência prática mais citada: **Fogo contra Água vira ×0,33**. É literalmente por isso que um
Charmander não encara um Magikarp — com HP ×5 ele simplesmente não morre.

A tabela 18×18 completa está na Poképedia, capítulo **Tipos**, com o valor já amplificado no
tooltip de cada célula.

---

## 17. Desmaiar, Centro Pokémon e fechar a aba

**Palavras-chave:** morrer, desmaiar, morri, centro pokémon, enfermeira, curar, fechei a aba, perdi

### Quando UM pokémon cai
1. Se a automação de **Revive** estiver ligada e você tiver o item, ele levanta com **50% do HP**.
2. Senão, o **próximo da equipe que estiver de pé** entra automaticamente.

### Quando o TIME INTEIRO cai
A hunt é suspensa e você aparece na praça do **Centro Pokémon** — área comum, com outros jogadores
andando por lá (WASD para andar). A **Enfermeira Joy cura de graça**, quantas vezes for preciso.
**Curar não tira você de lá**: sair é escolher outra área no Mapa.

**Não se perde XP ao desmaiar contra selvagens.** O custo é o tempo. Morrer na **Arena PvP** é
outra história — lá custa XP e ELO.

### Fechar a aba no meio da luta conta como derrota
Se você sair do jogo caçando, o servidor derruba a equipe inteira, exatamente como se você tivesse
ficado. Não há como distinguir um cabo arrancado de um Alt+F4 no frame do golpe fatal. Para sair
limpo existe o botão **Ir para o Centro Pokémon** no canto do palco — ele trava por **3 segundos**
a cada dano trocado.

### Itens de recuperação
- **Revive** — levanta um pokémon desmaiado com **50%** do HP.
- **Poção (+HP)** — recupera **40%** do HP máximo.
- **Bless** (Loja) — reduz ou zera a perda de XP de **uma** morte na Arena PvP.

Poções e revives se compram no Market, em quantidade ilimitada e a preço fixo.

---

## 18. Pokédex

**Palavras-chave:** pokedex, pokédex, registro, vistos, capturados, ficha da espécie

A Pokédex registra o que você **viu** e **capturou**. Abas seguem a Pokédex nacional (1ª a 9ª
geração). Cada aba mostra só espécies que **já têm sprite no jogo**.

- **???** — ainda não encontrou na hunt.
- **Nome visível, sem captura** — já derrotou ou viu, mas não pegou.
- **Cartão colorido** — já capturou pelo menos uma vez.

A busca **ignora a aba ativa**: digite nome ou número (`#725` funciona) e a grade mostra qualquer
geração que bater.

Na **ficha da espécie** você acha: stats base, tipos, sprite animado, **tabela de golpes**, loot,
**chance de captura por pokébola** (com quantas derrotas em média), tier shiny e **onde encontrar**.

---

## 19. Mapa e regiões

**Palavras-chave:** mapa, região, regiao, desbloquear, trancado, nível para abrir, kanto, outland, hoenn

Cada aba do Mapa pede um **nível mínimo do TREINADOR** (não do pokémon):

| Aba do Mapa | Nível do treinador |
|---|---:|
| Kanto | 1 |
| Johto | 1 |
| **Outland** | **150** |
| Hoenn | 500 |
| Sinnoh | 1.000 |
| Unova | 5.000 |
| Kalos | 10.000 |
| Alola | 25.000 |

Kanto e Johto compartilham o mesmo mapa. As hunts das gerações 8 e 9 (Galar e Paldea) aparecem
**dentro da aba Alola**. Uma aba já aberta com poucos marcadores **não é bug** — a região continua
sendo montada e as hunts entram aos poucos.

**Filtros disponíveis:** região, tipo de pokémon, busca por nome, intervalo de nível da hunt e
"só liberadas".

Zoom: **roda do mouse**; arrastar move o mapa.

---

## 20. Hunt Analyser

**Palavras-chave:** hunt analyser, melhor hunt, xp por hora, onde caçar, qual hunt

Com o Mapa aberto, passe o mouse (ou toque) num marcador liberado: no canto superior direito
aparece o **Hunt Analyser**, uma estimativa daquela área **para a sua conta agora**, com os boosts
ativos:

- **XP treinador / hora** e **XP pokémon / hora**
- **Ouro / hora**
- **Seu ritmo nesta sessão** — o **XP / hora** e o **Ouro / hora** que você está tirando de
  verdade, medidos desde que a sessão começou. São os mesmos números da janelinha Pocket, e
  estão ali para comparar com a estimativa de cima: o que a área promete contra o que você
  está de fato fazendo.
- **Forte contra** — tipos que você bate com ×2 na hunt (já amplificado)
- **Fraco contra** — tipos com ×0,5 ou imunidade
- **Tabela de drops** por espécie

As três primeiras linhas são **estimativas, não promessas**: spawn aleatório, tempo andando até
o alvo e desmaios mudam o resultado. Servem para comparar duas hunts, não para prever a próxima
hora ao minuto. As duas do "seu ritmo" são medição, não estimativa — mas no primeiro minuto de
sessão ainda balançam bastante, porque há pouca coisa medida.

---

## 21. Campeonato

**Palavras-chave:** campeonato, torneio, inscrição, registrar, seed, bracket, chave, eliminação
dupla, premiação, dinheiro, prêmio, nível 300, equipe escondida, usdt, solana, gringo,
estrangeiro, fora do brasil

O **Campeonato Mundial** é o primeiro torneio de verdade do PokéIdle, e a premiação é em
**dinheiro**. O **1º Campeonato é no dia 30 de setembro de 2026**, e as **inscrições estão
abertas até 29/09**.

| Posição | Prêmio |
|---:|---:|
| 1º lugar | **R$ 1.000** |
| 2º lugar | **R$ 500** |
| 3º lugar | **R$ 250** |

**Como o prêmio é pago:**

- **No Brasil:** em reais, por **PIX**, direto na conta do campeão.
- **Fora do Brasil:** o valor equivalente em **USDT na rede Solana**, na carteira que o
  ganhador informar — a mesma rede que as Gemas do jogo já usam para depósito e saque.

Os valores da tabela são em **real**; para quem recebe em USDT, a conversão é feita na hora do
pagamento.

**Como se inscrever:**

- No menu do topo, abra **Campeonato** e clique em **Registrar**.
- Precisa de **nível 300** de treinador.
- As inscrições vão **até o fim do dia 29/09, no horário de Brasília**. Até lá dá para cancelar
  a inscrição e se inscrever de novo.
- A aba **Participantes** mostra todo mundo que já se inscreveu, com a skin, o elo, o PR e a
  seed de cada um. Clicar no card abre o perfil.
- **Escolha a sua equipe.** Depois de se inscrever, clique em **Selecionar minha Equipe** no
  modal do Campeonato e escolha até **5 pokémon**, na ordem em que entram em campo. Essa equipe é
  só do campeonato: não muda a sua equipe do PvP Ranqueado. Quem não escolher luta com a equipe
  do **PvP Ranqueado**.
- **A equipe congela no fim das inscrições.** A que estiver valendo nesse momento joga o
  campeonato inteiro — trocar depois não muda nada. Pokémon vendido ou anunciado no Mercado antes
  do fechamento fica de fora. Quem fecha as inscrições sem equipe perde as partidas por **W.O.**

**As seeds:**

- A seed é a **posição no PvP Ranqueado** entre os inscritos: quem está mais alto na Tabela é a
  Seed 1. Quem ainda está no posicionamento vem depois, pelos pontos.
- Até o fim das inscrições as seeds são **provisórias** e acompanham a Tabela. No fim do dia
  29/09 elas **congelam** e a chave é gerada — depois disso não mudam mais.
- Na primeira rodada a **Seed 1 enfrenta a última**, a Seed 2 enfrenta a penúltima, e assim por
  diante. A 1 e a 2 ficam em lados opostos da chave: só podem se enfrentar na final.
- Se os inscritos não fecharem uma chave cheia (4, 8, 16, 32…), as melhores seeds **avançam
  direto** para a 2ª rodada (bye).

**O formato:**

- **Eliminação dupla.** Perdeu na chave dos vencedores, você cai na chave dos perdedores e
  continua vivo. Perdeu na chave dos perdedores, está fora.
- **Grande final.** O campeão da chave dos vencedores enfrenta o da chave dos perdedores, em
  partida única: quem vencer é o campeão.
- **3º lugar.** Fica com quem perde a final da chave dos perdedores.
- **A luta é a do PvP Ranqueado.** Mesma batalha automática, mesmas regras. Quem já briga na
  Arena já sabe jogar o Campeonato.
- **As partidas rodam sozinhas.** Assim que as inscrições fecham (00:00 do dia 30/09, horário de
  Brasília), o servidor joga a chave **rodada a rodada, uma a cada 5 minutos**, até a grande
  final. Não é preciso estar online. Com 128 inscritos, o campeonato inteiro leva pouco mais de
  uma hora.
- **Tudo tem replay.** Na aba **Bracket**, cada partida já jogada tem o botão **▶ Assistir** —
  qualquer jogador assiste a qualquer partida. A chave mostra quem venceu, o placar de abates, e
  a situação de cada um (invicto, na chave dos perdedores, eliminado).

**O perfil mostra só a equipe do PvP Ranqueado.** A equipe escolhida para o campeonato não
aparece no perfil de ninguém. Quem não escolhe luta com a do PvP Ranqueado, que é pública no
perfil; para entrar com uma equipe que os outros não viram, use **Selecionar minha Equipe**.

### E a Pesca?

A Pesca **saiu do jogo** e deu lugar ao Campeonato na barra do topo. Ninguém perdeu o tempo
investido nela: quem tinha nível de pesca recebeu **1 diamante por nível**, creditado
automaticamente na conta.

Os pokémon que só a Pesca entregava continuam todos alcançáveis — os de água de Hoenn em
diante já tinham hunt própria nas regiões deles, e o **Magikarp** ganhou uma hunt nova em
Kanto (nível 1, no mar a leste), que é de onde sai o Gyarados.

---

## 22. Evolução

**Palavras-chave:** evoluir, evolução, pedra, stone, não evolui

Para evoluir um pokémon são necessários **três** requisitos:

1. A espécie precisa **ter evolução**.
2. O pokémon precisa estar **no nível de evolução** da espécie.
3. Você precisa de **1× a pedra de evolução** correta daquela linha.

Regras importantes:

- **Shiny NÃO evolui.**
- **Variantes de Outland (`#2001+`) NÃO evoluem** — Ancient Pupitar não vira Ancient Tyranitar;
  são espécies separadas capturáveis na hunt. (Pupitar→Tyranitar **nacional** continua valendo.)
- Evoluir **não rerola** IV, qualidade nem potência — tudo que ele sorteou ao nascer continua.
- A pedra é **consumida** na hora.
- Pedras de evolução são uma das três famílias de item que podem ser anunciadas no **Mercado da
  Comunidade**.

---

## 23. TM Disks (discos de TM)

**Palavras-chave:** tm, disco, tm researcher, aoe, elemental, peça, piece

TMs são melhorias **permanentes** no pokémon. No **Centro Pokémon**, fale com o **TM Researcher**
(botão na praça). Lá existe um botão **[i]** com o guia completo.

### Os dois tipos

- **Elemental** — o pokémon aprende um golpe especial novo: power **280**, cooldown **10 s**, área
  **3×3** no alvo. O tipo do disco **tem que ser um dos tipos do pokémon** (ex.: Gengar aceita
  Ghost ou Poison).
- **AoE** — **todos** os golpes passam a acertar em área ao redor do herói. Vários selvagens
  grudados levam dano **simultaneamente**.

Os dois **coexistem** no mesmo pokémon: um elemental + um AoE.

### A cadeia de farm

```
Bronze Boss Token (drop Outland, 0,05%/kill)  →  entrada de boss
Vitória no boss                               →  peça de TM (0,5% a 6% conforme o boss)
10 peças iguais                               →  1 disco, trocado no TM Researcher
Disco aplicado                                →  permanente no pokémon
```

| Peça | Vira |
|---|---|
| TM Disk Piece | Disco elemental (você escolhe o tipo) |
| AoE TM Disk Piece | Disco AoE |

**Custo: 10 peças** para cada disco, consumidas na hora.

### Status aprimorados e Orre

Selvagens na **Outland** (treinador Nv 150+) e na **Orre** (Nv 500+ — é o nome interno da faixa de
mapas de **Hoenn em diante**) têm stats mais altos que Kanto: mais HP e mais dano por golpe. Na
**Orre**, o pokémon ativo precisa dos **dois** TMs (elemental + AoE) para caçar com eficiência.

Tokens e discos são escassos **de propósito**: a progressão passa por farm na Outland e vitórias
em boss.

---

## 24. Bosses

**Palavras-chave:** boss, lendário, lendario, token, arena de boss, regirock, kyogre

Arenas de desafio: você gasta **1× Bronze Boss Token**, entra num mapa próprio e enfrenta um
**pokémon lendário gigante**. Ele fica parado (não persegue) e bate MUITO forte.

São **24 bosses lendários**, em pares por degrau de nível. Cada par sobe o nível exigido e a chance
de peça de TM:

| Par | Nível de equipe | Nível do boss | Chance de peça | Bosses |
|---:|---:|---:|---:|---|
| 0 | 300 | 600 | 0,5% | Regirock, Regice |
| 1 | 650 | 1.300 | 1,0% | Registeel, Kyogre |
| 2 | 3.100 | 6.200 | 1,5% | Groudon, Rayquaza |
| 3 | 9.750 | 19.500 | 2,0% | Uxie, Mesprit |
| 4 | 22.700 | 45.400 | 2,5% | Azelf, Dialga |
| … | até 466.150 | — | +0,5% por par | Sinnoh → Paldea |

O boss ímpar de cada par dropa **AoE TM Disk Piece**; o par dropa **TM Disk Piece**.

### A penalidade de equipe (a mecânica central)

Ela multiplica **o dano que o boss causa** — não o que ele aguenta:

```
força         = Σ mín(1, nível do pokémon / nível de equipe do boss)
déficit       = 6 − força
multiplicador = 3 ^ déficit
```

| Equipe | Multiplicador de dano recebido |
|---|---:|
| 6 pokémon no nível do boss | **×1** |
| 3 pokémon no nível do boss | **×27** |
| 1 pokémon muito abaixo | **×700 ou mais** |

**Leve seis pokémon no nível do boss.** Não é conselho — é a diferença entre tomar 400 de dano e
tomar 280.000.

### O que muda lá dentro

- O boss usa **golpes próprios** (power 280 e 400, cooldown 10 s e 15 s), não os da espécie.
- Ele **não** leva o ×1,8 de dano do selvagem.
- O boss é **neutro**: não tem tipo, então nada é super-efetivo nem resistido contra ele.
- **Não dá para capturar um boss.** O prêmio é a tabela de drops.

### Vencer, perder e repetir

- **Vencendo**: abre um painel com XP, boss points e loot; você volta ao **Centro Pokémon**.
- **Perdendo**: você sai da arena e vai para o Centro. **A entrada não volta** — nem se você
  abandonar por vontade própria.
- **Repetir automaticamente**: o interruptor da aba Bosses refaz o ciclo sozinho (fim da luta →
  Centro → cura → 4 s → entra de novo no **mesmo** boss, gastando outro token). Falhar (sem token,
  nível insuficiente, time caído) **desliga** o interruptor com aviso. Abandonar a arena também
  desliga.

---

## 25. PvP Ranqueado

**Palavras-chave:** pvp, ranqueado, rank, elo, fila, duelo, bronze, prata, ouro, platina, diamante, mestre, challenger

O botão **PvP** tem duas abas: **Ranqueado** (1 contra 1, contra outro jogador de rank parecido)
e **Guild** (a Guerra de Guilds diária, que não mudou).

### Como funciona, em três passos

1. **Monte sua equipe de PvP** — até **5 pokémon**, na ordem em que entram. Ela é separada da
   sua equipe de hunt: mexer numa não mexe na outra. O primeiro abre a luta; os outros entram
   quando o anterior cai.
2. **Procurar partida.** Você pode fechar a tela e continuar caçando — a busca continua, e um
   aviso pequeno fica no alto do jogo ("Na fila PvP · 0:42") com um × para cancelar.
3. **A partida acontece.** Abre um mapinha (o mesmo do desafio de ginásio), os dois times se
   enfrentam sozinhos, e no fim aparece na lateral quanto você ganhou ou perdeu de PR.

### Requisitos

- Treinador **nível 150** no mínimo (o mesmo piso dos Ginásios).
- Pelo menos **1 pokémon** na equipe de PvP (o ideal são 5 — entrar com menos é desvantagem).
- **20 segundos** de espera entre uma partida e a fila seguinte.
- **Não custa nada.** Sem ficha, sem ouro, sem taxa.

### Fila automática (VIP)

Assinantes podem ligar a **fila automática**: acabou uma partida, a próxima busca começa
sozinha 20 segundos depois. Ela desliga quando você cancela a busca na mão, e também se a
equipe ficar vazia. Existe por causa do ritmo da fila (logo abaixo): esperar meia hora só faz
sentido se for "ligar e esquecer".

### Os sete ranks

| Rank | Como se entra | Divisões |
|---|---|---|
| Bronze | 0 – 299 PR | III · II · I |
| Prata | 300 – 599 PR | III · II · I |
| Ouro | 600 – 899 PR | III · II · I |
| Platina | 900 – 1.199 PR | III · II · I |
| Diamante | 1.200 – 1.499 PR | III · II · I |
| **Mestre** | 1.500 PR **e** estar entre os **50 primeiros** | — |
| **Challenger** | 1.500 PR **e** estar entre os **20 primeiros** | — |

Dentro de cada tier: **I → II → III**, de 100 em 100 PR.

A divisão **sobe junto com você**: **I é a entrada** do rank e **III é o topo** — Ouro III é
melhor que Ouro I. (É o inverso do League of Legends, de propósito: lá a ordem invertida é
herança de um sistema antigo.) Cada divisão são **100 PR**, e a barrinha na tela mostra
exatamente quanto falta para a próxima.

### Mestre e Challenger são VAGAS, não pontos

Os dois tiers do topo têm **número limitado de gente**: 20 Challengers e 30 Mestres (as
posições 21 a 50). Passar dos 1.500 PR te coloca na fila de espera — enquanto não houver vaga,
você aparece como **Diamante III** e a tela diz quantas posições faltam.

Isso é de propósito. Pontos inflam com o tempo; posição não. "Estar entre os 20 melhores do
servidor" vai querer dizer a mesma coisa daqui a um ano.

### Posicionamento

Suas **5 primeiras partidas** são de posicionamento. Durante elas:

- você aparece como **Não classificado** e não entra na tabela;
- você começa em **Bronze I** e o PR não passa de **Bronze III**.

Ou seja: a estreia acontece dentro do Bronze inteiro. Quem vai bem sobe pelas três divisões
e no fim já encontra gente de Bronze III; quem vai mal fica no I.

**Todo mundo começa no pé da escada.** A subida é o jogo — e ela é longa de propósito.

### Quantos pontos cada partida vale

É o Elo do xadrez. O que decide é a **diferença de rank** entre os dois:

- contra alguém do seu nível: **~±16 PR** (mais embaixo na escada, menos em cima);
- **você vence quem está muito acima:** ganha muito, e ele perde muito;
- **você vence quem está muito abaixo:** ganha pouco, e ele perde pouco;
- **você perde para quem está muito abaixo:** dói — é a derrota mais cara que existe.

Ganhar e perder são **soma zero**: o que um leva é exatamente o que o outro deixa. Não existe
como inflar o placar.

### A fila: com quem você joga

Você enfrenta quem está **mais perto de você em pontos** entre quem está na fila naquele
momento. Quanto mais tempo esperando, mais a busca abre:

| Esperando | Aceita quem estiver dentro de |
|---|---|
| na hora | 25 PR (um quarto de divisão) |
| 2 min | 50 PR |
| 5 min | 100 PR (uma divisão) |
| 15 min | 150 PR |
| 30 min | 250 PR |
| 1 h | 400 PR |
| 2 h | 600 PR (dois tiers) |
| 4 h | 1.000 PR |
| 6 h | qualquer rank |

A busca abre **devagar**, e isso é escolha: se em quatro minutos um Bronze III pudesse
encontrar um Challenger, o emblema não separaria ninguém de ninguém. Fila vazia é melhor do
que partida errada — e é para isso que a fila automática existe.

Duas coisas importantes: a janela que vale é a do **menos paciente dos dois** — quem acabou de
entrar não é arrastado para uma partida desequilibrada por causa da espera do outro. E mesmo
com a janela aberta, o jogo sempre casa o par **mais próximo** disponível: dois Challengers na
fila se acham antes de qualquer um deles olhar para baixo.

### Proteção de rebaixamento

Ao subir para um rank **inédito** para você, ganha um **escudo** (🛡): a primeira derrota que te
derrubaria daquele rank para no piso em vez de te rebaixar. Ele é gasto uma vez e só volta
quando você conquistar um rank ainda mais alto.

### Regras contra trapaça

O sistema foi desenhado para que nenhuma delas dependa de boa vontade:

- **Deslogar não salva ninguém.** A partida inteira é calculada no servidor de uma vez, antes
  de aparecer na sua tela. Quando você vê a luta, o resultado já está gravado — fechar a aba,
  puxar o cabo ou desligar o computador não desfaz nada, e o oponente recebe os pontos dele
  igual. Se você cair antes de assistir, o resultado te espera no próximo login.
- **Duas contas na mesma casa se encontram por último, e a partida não vale ponto.** Elas
  não são proibidas de jogar (irmãos, república e lan house existem), mas o resultado é
  sempre **zero PR** para os dois — o que se quer impedir é o lucro, não o encontro.
- **O mesmo oponente não se repete** por 10 minutos.
- **Revanche rende menos.** Reencontrar o mesmo jogador nas 24 h seguintes vale metade dos
  pontos, depois um quarto, e do quinto encontro em diante, nada.
- **Cancelar a fila no último instante não funciona.** Se o par já foi fechado, a partida
  acontece.
- **Perder a conexão tira você da fila** — ninguém é pareado estando fora do ar.

### O que MUDOU em relação à Arena antiga

| Antes | Agora |
|---|---|
| 2 arenas abertas, até 40 pessoas | 1 contra 1, por fila |
| Custava 1 Ficha PvP (1.000.000 de ouro) | Grátis |
| Trocava de pokémon durante a luta | Equipe de 5 fechada antes de entrar |
| Morrer custava 10% do XP do nível | Não custa XP — só pontos de rank |
| ELO solto (começava em 1000) | Sete ranks com divisão e barra de progresso |
| — | Fila automática para VIP |
| Precisava ficar 10 s sem dano para sair | Não existe "sair": a partida é instantânea |

### Bônus de ranking PvP

Estar bem colocado na **tabela do PvP Ranqueado** dá **% extra de XP e farm**. Só entra na
tabela quem já terminou o posicionamento:

| Posição | Bônus |
|---|---:|
| 1º | +5% |
| top 10 | +4% |
| top 50 | +3% |
| top 250 | +2% |
| top 500 | +1% |

---

## 26. Guilds

**Palavras-chave:** guild, clã, cla, guilda, criar guild, gp, brasão

Clãs **sem limite de tamanho**: chame quantos jogadores quiser. O botão fica abaixo do seu
retrato: **+** para criar, ou o brasão da guild se você já estiver numa.

- **Custo de criação: 250.000 de ouro.**
- Você escolhe nome, formato do escudo, emblema e cores.
- O dono convida por nick, expulsa membros ou apaga a guild.
- **Não há teto de membros.** O teto é do **TIME**, abaixo.

### A TAG da guild

Até **três letras** ao lado do seu nick no chat, na cor que o dono escolher — em
**Guild → Guild → TAG da guild**, e também na hora de criar a guild.

- Por padrão são as **três primeiras letras do nome**: "Lua Cheia" nasce com **[LUA]**.
- A cor sai de uma paleta feita para o fundo preto do chat.
- **Uma troca a cada 24 h**, a mesma espera do brasão. A primeira é livre.
- **ADM, MOD, GM e as outras da equipe são bloqueadas** — inclusive escritas com número (M0D).
- A tag fica gravada na mensagem: trocar hoje não muda o que você falou ontem.

### O TIME da guild (a escalação)

A guild cresce sem limite, mas quem vai à **Guerra de Guilds** é o **time**: **10 jogadores**,
escolhidos pelo **dono** em **Guild → Time da Guild**.

- **Guild com 10 membros ou menos está toda escalada** — se vocês são 8, os 8 entram.
- Com 30 membros, **10** lutam e os outros 20 são **reserva**: continuam na guild, no chat e no
  ranking, mas não entram na guerra.
- **Só os escalados recebem**: o bônus diário do ranking de GP (XP e loot) e os **diamantes do
  fechamento mensal** vão para o time, não para a lista de membros.
- Vaga que abre (alguém saiu ou foi expulso) **fecha sozinha** com o membro mais antigo que
  estava de fora.
- **Time da Guild** (quais JOGADORES lutam) não é **Minha equipe de guerra** (quais POKÉMON você
  leva) — são dois botões no mesmo painel.

### Ranking de GP e bônus

Cada guild acumula **GP** (Guild Points). A aba **Guild** do Ranking ordena por GP total, e as
primeiras dão bônus de **XP e loot para os escalados** (não para a guild inteira):

| Posição | Bônus |
|---|---:|
| 1º | +10% |
| 2º | +5% |
| 3º | +3% |
| 4º em diante (com GP > 0) | +1% |

### Guerra de Guilds (diária, automática)

Às **22h UTC** o servidor simula a guerra sozinho e guarda a gravação. **Você não precisa
estar online** — na verdade, ninguém precisa.

- **Só o dono registra** a guild, antes do horário.
- Entra o **TIME** de cada guild registrada: até **10 escalados**, online ou não. Reserva não
  entra.
- Cada um leva **a equipe que estiver montada na hora do evento**, com o time **curado**. Trocar
  a equipe depois não muda a guerra que já aconteceu.
- **Sem fogo amigo**: membros da mesma guild não se atacam.
- Quando o pokémon em campo cai, **entra o próximo da equipe**. O membro só sai da guerra
  quando o time inteiro está no chão.
- A guild só é eliminada quando **todos** os escalados caem.
- Quanto mais guilds inscritas, mais GP o 1º lugar leva (N guilds → 1º ganha N GP, 2º ganha N−1…).
- O resultado é anunciado em **todos os canais do chat**, com a guild campeã, o GP e o destaque
  (quem mais abateu).

### Assistir ao replay

No painel de **PvP → PvP Guild** ficam o placar da última guerra (colocação, abates, mortes e GP
de cada guild) e o botão **"Assistir ao replay da última batalha"**.

O replay abre a arena de verdade, com os bonecos de cada treinador, os pokémon que eles levaram
e os nicks por cima. Dá para **pausar, arrastar a linha do tempo, acelerar até 8×** e **clicar
num lutador** para a câmera seguir só ele — por padrão ela pula sozinha para onde acabou de
acontecer um abate.

> **Por que mudou?** Antes era ao vivo e só entrava quem estivesse acordado às 19h de Brasília.
> Na prática, ganhava a guild que tinha alguém online — e quem perdia não via nada. Agora a
> guerra é da guild, não do fuso horário, e todo mundo pode assistir no dia seguinte.

---

## 27. Ranking

**Palavras-chave:** ranking, rank, top, placar, classificação

O placar do mundo inteiro. Sete abas:

| Aba | O que ordena |
|---|---|
| Treinadores | nível do treinador (desempate por XP) |
| Pokémon Forte | o **poder** de um pokémon, de qualquer treinador |
| Top Catch | **espécies diferentes** já capturadas, não capturas totais |
| Top Coins | ouro acumulado na conta |
| Arena | ELO (só entra quem já lutou) |
| Guild | GP da guild |

Clicar num nome abre a ficha do treinador, com a equipe dele em campo.

O placar sai do banco, então pode estar até **5 segundos** atrasado — para um ranking, irrelevante.

---

## 28. Market (NPC)

**Palavras-chave:** market, npc, comprar, vender, loja de itens, poção, revive

O balcão do jogo. Compra e venda com o **NPC**, em **ouro**, **sem taxa nenhuma** e em quantidade
ilimitada. Três abas.

**Compra** — pokébolas compráveis, poções e revives. (A **Ficha PvP** era a entrada da Arena
antiga; o PvP Ranqueado é grátis, e quem ainda tem fichas guardadas não precisa mais delas.)

**Venda** — tudo que os pokémon dropam, por **100% do preço de catálogo** (não há desconto). Há
botão de **vender tudo**.

> **Consumível que o NPC vende, o NPC não recompra** (poção e revive entram nessa regra). O
> **Bronze Boss Token** também **não** pode ser vendido ao NPC — anuncie no Mercado da Comunidade.

**Venda de Pokémon:**

```
preço = valorBase × (1 + nível/50) × qualidade × (shiny ? 10 : 1)
```

- Nível e qualidade valorizam; **shiny vale 10×**.
- **A potência NÃO entra nesta conta** — o NPC não paga por ela. Um P4 ou P5 vale muito mais no
  Mercado da Comunidade, com outro jogador.
- Não dá para vender quem está lutando, nem o último pokémon.

---

## 29. Mercado da Comunidade (jogador ↔ jogador)

**Palavras-chave:** mercado, community market, vender pra jogador, anúncio, anunciar, comprar de jogador

Aqui quem está do outro lado do balcão é **outro jogador**. Você anuncia pokémon e itens, e cobra
em **Ouro** ou em **Gema**.

### Anunciar

- Anunciar **tira da sua mão**: o item sai da bolsa e o pokémon sai do depot na hora. Cancelar
  devolve.
- Até **20 anúncios abertos** ao mesmo tempo.
- **Só três famílias de item entram**: **pedras de evolução**, **discos de TM** e **fichas de
  boss**. Drop comum de pokémon (Bug Wing, Fur, Fossil…) não vai à vitrine.
- **Pokémon precisa passar na faixa mínima — os quatro juntos:**

| Requisito | Mínimo |
|---|---:|
| Nível | **50+** |
| Potência | **P3+** |
| IV total | **120+** |
| Qualidade | **1,30+** |

  **Shiny e P5 são isentos**: entram em qualquer nível ou status.
- O preço é **por unidade**. Um lote de 100 Water Stone pode ser comprado em fatias.

### A pensão da feira

Pokémon anunciado fica na **feira**, e os tratadores cuidam dele. Por isso **só pokémon** paga
diária: **50.000 Coins por dia**, de **1 a 30 dias**, escolhidos ao publicar e pagos à vista.

- **Item não paga nada** e não tem prazo.
- Vendeu antes do fim? Os dias já pagos **não voltam**.
- Ninguém levou? No fim do prazo o pokémon **volta para a sua equipe** sozinho.

### A comissão

| Anúncio cobrado em | Comissão |
|---|---:|
| **Ouro** | **0%** |
| **Gema** | **15%** |

A comissão sai do **VENDEDOR**: quem anuncia por 100 Gemas recebe **85**. O comprador paga
exatamente o que está na vitrine.

### Você recebe quando entrar

A venda cai numa **caixa postal**. Da próxima vez que você abrir o jogo (ou dentro de um minuto, se
já estiver dentro), o valor entra com um aviso do que foi vendido e por quanto. É assim porque o
vendedor quase sempre está offline na hora da venda.

### A trava de preço

Ao comprar, o jogo manda junto **o preço que estava na sua tela**. Se o vendedor tiver subido o
valor entre o clique e a chegada da mensagem, a compra é **recusada**. Se o preço tiver **caído**,
você paga o mais barato. A moeda entra na mesma trava.

### A ficha do anúncio

Clique na arte de um pokémon anunciado (ou em **Ver ficha**): nível, XP e quanto falta para o
próximo, os seis stats com o IV de cada um, a qualidade, o brilho e o que cada potência valeria
naquele bicho.

---

## 30. Registro de Shinys do servidor

**Palavras-chave:** shinys do servidor, quem tem shiny, lista de shiny, registro

O ícone de lista ao lado do fechar da Pokédex abre o **Shinys do servidor**: **todo shiny capturado
no servidor**, com dono, nível, potência e ficha completa. É a única lista do jogo que atravessa
jogadores sem passar pelo Mercado. Quando há anúncio aberto para aquele shiny, o card ganha preço e
um botão de compra.

---

## 31. Gemas (a moeda com lastro em USDT) — RMT

**Palavras-chave:** gema, gemas, orb, usdt, sacar, saque, withdraw, depósito, crypto, dinheiro, rmt

A **Gema** é a única moeda do jogo que **volta a ser dinheiro**. Você a compra depositando **USDT**
e a saca de volta em **USDT**, para a sua carteira ou direto para uma corretora (Binance, OKX,
Bybit — qualquer uma que aceite USDT na rede indicada).

| Regra | Valor |
|---|---|
| Comprar 1 Gema | **US$ 0,01** |
| Sacar 1 Gema | **US$ 0,009** |
| Spread (a única cobrança) | **10%** |
| Saque mínimo | **1.000 Gemas** (US$ 9,00) |
| Teto por saque | 1.000.000 Gemas |
| Taxa de rede do saque | **por conta do projeto** |
| Comissão de venda em Gema no Mercado | 15% (do vendedor) |

Não há taxa por transação: o **spread de 10%** é a única cobrança, e é dele que saem servidor,
desenvolvimento e a taxa de rede dos saques.

### Como DEPOSITAR
1. Abra **Comunidade → Depósito**. O jogo mostra um **endereço só seu**, na rede indicada.
2. Mande **USDT** desse endereço a partir da sua carteira ou corretora. **Confira a rede.**
3. O jogo confirma automaticamente e credita as Gemas.

> ⚠️ **Mande só USDT, e só na rede indicada.** Qualquer outro token, ou o mesmo token noutra rede,
> cai num lugar de onde **não há como recuperar**.

### Como SACAR
1. Na sua corretora: **Depositar → USDT**, escolha a rede indicada, copie o endereço.
2. No jogo: **Comunidade → Withdraw**, cole o endereço, escolha a mesma rede e a quantidade
   (mínimo 1.000).
3. Confira o endereço **caractere por caractere**. Transferência enviada **não tem como ser
   desfeita**.
4. O pedido entra na fila. Você acompanha o status no extrato e recebe o **hash** da transação.

> ⚠️ Se a sua corretora pedir **MEMO/TAG** junto do endereço, ela **não serve** para este saque —
> o campo de memo não existe aqui. Use uma carteira própria e transfira de lá.

### Transparência do caixa
A carteira do projeto é pública. No painel de depósito você vê, em tempo real, quanto entrou,
quanto saiu, quanto está em caixa e qual é o **passivo** — o que o projeto deveria se todo mundo
sacasse tudo agora.

### A regra que mantém o caixa solvente
**Gema NUNCA é dada de graça.** Não cai de drop, não vem de quest, não sai de boss. Toda Gema que
existe foi comprada por alguém.

---

## 32. Diamantes (doação, PIX e cartão)

**Palavras-chave:** diamante, diamantes, comprar diamante, pix, cartão, doação, loja vip

O **Diamante 💎** é a moeda da **Loja** do JOGO. Compra-se com dinheiro de verdade (**PIX** ou
**cartão**) e **acaba ao ser gasto**.

| Quantidade | Preço por diamante |
|---|---|
| 1 – 99 | R$ 0,44 |
| 100 – 149 | R$ 0,42 |
| 150 – 199 | R$ 0,40 |
| 200 + | R$ 0,38 |

Compra mínima **R$ 1,00** (3 diamantes). O preço de uma quantidade **nunca** é maior que o de
comprar até o próximo corte — quem pede 99 paga o preço de 100 e leva 99.

O pagamento acontece **fora do jogo**, no provedor. O saldo entra sozinho assim que ele confirmar,
normalmente em segundos. Se demorar, há o botão **"Já paguei — verificar"**, que consulta o
pagamento na hora. Se o webhook se perder, o servidor reconcilia pagamentos pendentes de minuto em
minuto — nada trava.

**Diamante é consumo:** é gasto na Loja e **não pode ser sacado nem transferido**.

### 🚨 NÃO É POSSÍVEL COMPRAR DIAMANTES COM CRYPTO (POSIÇÃO OFICIAL)

**Palavras-chave:** comprar diamante com crypto, usdt para diamante, converter gema em diamante

**DIAMANTE é uma DOAÇÃO para manter o projeto vivo. CRYPTO (Gema/USDT) é para RMT da comunidade.
NÃO CONFUNDAM AS COISAS.**

As duas moedas não se convertem uma na outra, e isso é proposital:

| | **Diamante 💎** | **Gema** |
|---|---|---|
| Entra por | PIX ou cartão | depósito de **USDT** |
| Gasta em | **Loja** (VIP, boosts, outfits, Beast Balls) | **Mercado da Comunidade** (entre jogadores) |
| Sai? | **Não sai** — é consumo/doação | **Saca em USDT** |
| Natureza contábil | receita do projeto | **passivo** do projeto |

Cobrar boost de XP em Gema significaria **abater dívida em vez de faturar** — o caixa que garante
os saques dos jogadores é exatamente o lastro das Gemas. Por isso a separação é rígida.

---

## 33. Loja de Diamantes (o que dá para comprar)

**Palavras-chave:** loja, shop, vip, boost, outfit, beast ball, pacote

### VIP

| Efeito | Detalhe |
|---|---|
| +50% de XP | no treinador **E** no pokémon |
| **Auto-Catch** | libera a automação **Lançar pokébola** |
| Outfits exclusivas | Gamer VIP Outfit I e II |
| Emojis VIP | no chat |

Preços: **30 dias = 10 💎**, **60 dias = 17 💎**, **90 dias = 25 💎**.
Renovar **estende** em vez de reiniciar: comprar 30 dias faltando 10 dá 40.

### Boosts

Cinco tipos, sete durações cada (1h, 2h, 3h, 6h, 12h, 24h, 7d):

| Boost | Efeito | Preço 1h → 24h → 7d |
|---|---|---|
| XP Boost | +50% XP do treinador | 3 → 29 → 175 💎 |
| XP Boost Pokémon | +50% XP do pokémon | 3 → 29 → 175 💎 |
| Loot Boost | +40% de chance de loot | 6 → 58 → 350 💎 |
| Capture Boost | **dobra** a chance de captura | 6 → 58 → 350 💎 |
| Shiny Secret Lure | **dobra** a chance de aparecer shiny | 6 → 58 → 350 💎 |

- **Não acumulam**: comprar o mesmo tipo de novo **estende** o que está correndo.
- Limite de **5 compras por dia, por tipo** (qualquer duração).
- Tipos diferentes rodam juntos.

### Pokébolas

| Pacote | Preço |
|---|---:|
| Beast Ball ×100 | 2 💎 |
| Beast Ball ×300 | 5 💎 |
| Beast Ball ×600 | 10 💎 |
| **Pacote de Suprimentos** (1.000 Beast Balls) | **5 💎** — **1× por semana** |

O Pacote de Suprimentos é o melhor negócio em bolas por diamante; o contador aparece no próprio
botão enquanto está em espera.

### Personagem

Troca de Nome **6 💎** · Bless Plus/Ultra/Max **1/2/3 💎**.

### Outfits

**30 💎** cada. Comprar já equipa, e você troca entre as suas quando quiser.

---

## 34. Taxas — tudo que o jogo desconta

**Palavras-chave:** taxa, comissão, desconto, cobra, quanto perco

| Taxa | Quanto | Quem paga |
|---|---|---|
| Mercado da Comunidade — anúncio em **Gema** | **15%** sobre a venda | o VENDEDOR |
| Mercado da Comunidade — anúncio em **Ouro** | **nenhuma** | — |
| Mercado da Comunidade — pensão do pokémon | 50.000 Coins/dia (só pokémon) | o VENDEDOR |
| Market (NPC) — comprar | nenhuma | — |
| Market (NPC) — vender | nenhuma (paga o valor cheio do catálogo) | — |
| Gema — compra com USDT | US$ 0,01 por Gema | o comprador |
| Gema — saque em USDT | US$ 0,009 por Gema (spread de 10%) | quem saca |
| Gema — taxa de rede do saque | **por conta do projeto** | — |
| Loja de Diamantes | nenhuma (o preço é o final) | — |
| Arena PvP — morrer | 10% do XP do nível atual | quem morre |

**O jogo não cobra taxa em ouro.** A única comissão é a de 15% sobre vendas em Gema, e ela existe
porque Gema é dinheiro de verdade circulando entre jogadores.

---

## 35. Indique & Ganhe (afiliados)

**Palavras-chave:** afiliado, indicar, convite, código, referral, indique e ganhe

Cada conta tem um **código de convite** próprio (botão **Indique & Ganhe** no HUD).

| Você ganha | Sobre o quê |
|---|---|
| **10%** | dos **diamantes** comprados pelo indicado |
| **5%** | das **gemas** depositadas pelo indicado |

Regras:
- A comissão só nasce quando há **pagamento real confirmado**.
- **Não dá para usar o próprio código.**
- **Só dá para informar o código do indicador ANTES da 1ª compra de diamantes.**
- Cada conta tem **um único** indicador, para sempre.
- É custo de marketing do projeto: sai do lucro da operação, **não do bolso do comprador**.

---

## 36. Vote & Ganhe (TopIdle)

**Palavras-chave:** votar, voto, topidle, vote e ganhe, diamante grátis

Vote no **TopIdle** (ranking de jogos idle) e ganhe diamantes. O voto ajuda o PokeIdle a subir no
ranking — e é de lá que chega gente nova.

- **1 diamante a cada 2 votos** contados. Os votos **acumulam para sempre** (um hoje, outro amanhã,
  fecha o par).
- O TopIdle libera **um voto por dia** por jogador (a janela cobrada é de ~23h30, com folga para
  não recusar voto honesto).
- O botão abre o TopIdle numa aba nova, **com o seu nick já preenchido**. Você só confere e
  autoriza com a sua conta Google.
- O diamante cai em segundos, **sem precisar fechar o jogo** e sem resgate manual.
- A conta Google é do TopIdle e serve só para provar que o voto é de uma pessoa — **não precisa ser
  a conta com que você joga**.

**Antifraude:** um jogador aceita no máximo **2 contas distintas** do TopIdle votando nele, e uma
conta do TopIdle que já votou no jogador A nunca mais conta para o jogador B. Votos além disso
ficam registrados mas **não somam**.

---

## 37. Eventos globais

**Palavras-chave:** evento, buff global, xp dobrado, evento de xp

O administrador pode ligar um buff para **o servidor inteiro** ao mesmo tempo: **XP do treinador**,
**XP do pokémon** e **farm (loot)**, cada um em %, por um número de minutos.

- **XP multiplica, farm soma.** Quem comprou boost **continua rendendo mais** que o vizinho durante
  o evento.
- Só existe **um** evento por vez; ligar outro encerra o anterior.
- Tetos: 1000% por buff e 7 dias de duração.
- Na tela é uma **faixa piscando no alto da batalha**, com contagem regressiva. Ela não some
  sozinha — quem entrou no meio precisa entender num olhar por que a XP está estranha.

---

## 38. Chat

**Palavras-chave:** chat, canais, mundo, comércio, guild, idioma

Três canais: **Mundo**, **Comércio** e **Guild**. Três idiomas: **pt**, **en**, **es**. Canal e
idioma são duas dimensões: "Comércio em espanhol" é um par, não um canal novo.

**É preciso ser treinador nível 5 para enviar mensagens no chat.**

Dá para **compartilhar um pokémon no chat** (botão na ficha) — os outros clicam e veem a ficha
completa dele.

Membros VIP têm **emojis exclusivos** no chat.

---

## 38b. Área de Treinamento (bancada de testes do PvP)

**Palavras-chave:** treinamento, treino, testar equipe, simular luta, qual é mais forte, bancada,
comparar pokémon, pokémon teste

Aba **Treinamento**, dentro do **PvP** (ao lado de Ranqueado e Guild). Serve para **testar**: você
monta dois lados, manda lutar e assiste. **Não dá nada** — sem XP, Coin, item, pedra ou ponto de
ranking — e **nada é gravado**.

**Como funciona**

- Até **5 pokémon de cada lado**, escolhidos casa a casa. A **casa 1** entra em campo primeiro.
- Em cada casa dá para escolher **um pokémon seu** ou **criar um pokémon teste**: você define
  espécie, nível, shiny, potência, qualidade e os seis IVs.
- **Os lados são independentes:** 5 × 1 é uma luta válida. Não existe checagem de equilíbrio.
- A luta usa **a mesma arena, o mesmo simulador e a mesma régua de nível do PvP Ranqueado** (nível
  inteiro até 150, comprimido daí para cima) e abre no mesmo tocador de replay do desafio de ginásio.
- **Uma batalha a cada 5 minutos por conta.** A espera vale em qualquer aparelho e não zera ao
  relogar.

**As duas perguntas que mais aparecem**

- *"Meu pokémon se machuca? Perde XP?"* Não. Entra uma **cópia** dele na arena, com os mesmos
  números de nascimento. O original não perde HP, não ganha XP e nem sai do lugar.
- *"O pokémon teste fica comigo?"* Não. Ele **não vai para o Depot**, não conta na Pokédex e deixa
  de existir quando a fita acaba. É um bicho de mentira, só para aquela luta.

---

## 38c. Caixas do Market (o ralo de Coins)

**Palavras-chave:** caixa, caixas, box, abrir caixa, caixa free, caixa vip, caixa diamante, gastar
coins, queima de coins, fragmento, boss token, beast ball, sorte, chances da caixa

**Market → aba Comprar → categoria Caixas.** São **duas caixas** que trocam Coins (e, na VIP,
diamantes) por sorte. O que sai são **itens** — a caixa **nunca** devolve Coin, diamante ou gema.

| Caixa | Coins | Diamantes | Chances raras | Quem abre |
| --- | --- | --- | --- | --- |
| Caixa Free | 5.000.000 | — | ×1 | todo mundo |
| Caixa Diamante VIP | 5.000.000 | 5 | ×2 | **só quem tem VIP ativo** |

**A VIP não tem prêmio exclusivo.** Ela dobra a chance de tudo que é raro e lendário, e só isso. Os
comuns encolhem na mesma medida.

**Sai UM prêmio por caixa.** Todas as porcentagens abaixo somam 100%: o número ao lado de cada item
é a chance **dele** sair. Para abrir várias, use o contador do card — são N caixas, cada uma com o
seu sorteio, por N vezes o preço (Coins **e** diamantes).

O botão **Máx** preenche com **quantas caixas o seu saldo paga** (até 9.999, o teto que o jogo usa
para tudo). Quem tem 3 bilhões de Coins abre 3.000 de uma vez. O resultado aparece **agrupado**:
"Poké Ball ×60.000 · saiu 12×" quer dizer que 12 das suas caixas deram Poké Ball.

**O que pode sair:**

| Prêmio | Raridade | Caixa Free | Caixa VIP |
| --- | --- | --- | --- |
| Bronze Boss Token | lendário | 4,0% | 8,0% |
| Fragmento de Chave | lendário | 0,08% | 0,16% |
| Fragmento de Shiny Stone | lendário | 0,08% | 0,16% |
| Fragmento de Bicicleta | lendário | 0,08% | 0,16% |
| Beast Ball ×25 | raro | 6,0% | 12,0% |
| Poké Ball ×5.000 | comum | 23,3% | 20,7% |
| Great Ball ×2.500 | comum | 18,0% | 15,9% |
| Super Ball ×1.200 | comum | 14,4% | 12,7% |
| Ultra Ball ×700 | comum | 10,8% | 9,5% |
| Revive ×200 | comum | 10,8% | 9,5% |
| Max Revive ×30 | comum | 5,4% | 4,8% |
| Hyper Potion ×200 | comum | 4,5% | 4,0% |
| Ultimate Potion ×100 | comum | 1,8% | 1,6% |
| Golden Potion ×40 | comum | 0,90% | 0,80% |

**As peças de TM não saem da caixa.** Elas são o drop do próprio boss, e quem quer uma tem de
lutar. O que a caixa dá é a **entrada** para essa luta: o Bronze Boss Token.

**Essa tabela está no jogo**, no botão **"Ver Conteúdo"** de cada caixa — é a mesma que o servidor
sorteia, e dá para ler antes de gastar.

**É caro de propósito, e muito.** Farmar um Bronze Boss Token custa cerca de 2.000 abates na
Outland (~1,5 milhão de Coins); pela caixa ele sai a **125 milhões**. Um fragmento sai, em média, a
cada **6,25 bilhões de Coins** na Caixa Free. A caixa vende **sorte e tempo**, não atalho barato: em
média ela devolve **9,5%** do que cobra, e os outros 90,5% são o ouro parado do servidor sendo
destruído. Se você abre caixa esperando lucro, **não abra** — o número acima é público justamente
para essa decisão ser sua.

**As duas perguntas que mais aparecem**

- *"Sou VIP e a caixa VIP não abre."* Confira se o VIP está **ativo** (não vencido). O servidor
  confere na hora do clique, não no login.
- *"Abri 10 e veio tudo comum."* Cada caixa é um sorteio independente: em 10 aberturas da Free há
  **66%** de chance de não sair nenhum Bronze Boss Token, **34%** de não sair nada raro nem lendário
  e **97,6%** de não sair nenhum fragmento. As porcentagens são as publicadas — não existe
  "proteção", sorte acumulada nem caixa que fica "carregando".

---

## 39. Probabilidades e balanceamento (POSIÇÃO OFICIAL)

**Palavras-chave:** chance baixa, muito difícil, buff, nerf, aumentar chance, drop rate, injusto, demorado

**AS PROBABILIDADES NÃO SERÃO ALTERADAS.**

Elas já foram **testadas e aprovadas por jogadores e por IA**. A curva de progressão **é demorada
mesmo** — isso é o desenho, não um bug e nem falta de atenção.

**Paciência: um bom jogo de RMT nunca é fácil.** O valor de um shiny, de um P5 ou de um disco de TM
existe justamente porque conseguir um deles custa. Se as chances subissem, tudo que a comunidade
negocia perderia valor no mesmo instante.

Pedidos de "aumenta a chance de X" / "diminui o custo de Y" / "nerfa a dificuldade" **não serão
atendidos**. Responda com educação, explique o motivo acima e não prometa revisão.

Isso vale para: chance de captura, chance de shiny, chance de potência, chance de peça de TM,
drop de Bronze Boss Token, curva de XP e penalidade de equipe do boss.

---

## 40. Respostas rápidas (perguntas mais frequentes)

**"Vai ter reset?"** → Sim. Shinys e P5 são mantidos; diamantes e gemas não sacadas são devolvidas.

**"Posso ter mais de uma conta?"** → Hoje não há limite, mas o jogo é feito para uma conta só.

**"Dá pra comprar diamante com crypto?"** → Não. Diamante é doação (PIX/cartão). Crypto/Gema é RMT
entre jogadores. São coisas separadas.

**"Vocês vão fazer botão de auto-shiny?"** → Não, nunca. Acabaria com o RMT.

**"A chance de captura é muito baixa, dá pra aumentar?"** → Não. Já foi testada e aprovada; a
progressão é lenta por design.

**"Qual o level max?"** → Não existe. A curva é infinita, só fica mais cara.

**"Meu pokémon tem IV 190 mas qualidade 1,0. Por quê?"** → São sorteios independentes. IV alto não
puxa a qualidade.

**"Como pego shiny mais fácil?"** → Não dá para facilitar a captura — o difícil é ele aparecer.
Use Shiny Secret Lure (dobra o aparecimento) e, ao ver um, use a melhor bola que tiver.

**"Errei a bola e o corpo sumiu."** → É uma tentativa por corpo, de propósito. Corpo vivo continua
em campo; corpo caído sai quando a bola falha.

**"Fechei a aba lutando e meu time morreu."** → Fechar a aba em combate conta como derrota. Use o
botão "Ir para o Centro Pokémon" para sair limpo.

**"Farmo offline?"** → Não. O jogo só roda com a aba aberta. Não existe modo offline/sono.

**"Onde vejo o preço justo de um pokémon?"** → Na ficha do anúncio (Mercado da Comunidade) e na
Calculadora Pokémon (nota de 0 a 10).

**"Quanto tempo até sacar?"** → O saque mínimo é 1.000 Gemas (US$ 9,00). O pedido entra numa fila e
você acompanha pelo extrato, recebendo o hash da transação no fim.

**"Meu pagamento não caiu."** → Use "Já paguei — verificar" na tela de compra. O servidor também
reconcilia pagamentos pendentes de minuto em minuto.

**"Shiny evolui?"** → Não.

**"Evoluir melhora IV/qualidade/potência?"** → Não. Nada é rerolado.

**"Por que meu Charmander não mata Magikarp?"** → Fogo contra Água é ×0,33 na hunt, e o selvagem
tem HP ×5. Leve um pokémon que não seja fraco contra água.

---

## 41. O que NÃO existe no jogo (não confirme se perguntarem)

**Palavras-chave:** existe?, tem?, quando vai ter

Jogadores às vezes citam mecânicas de outros jogos idle de Pokémon. **Estas NÃO existem no
PokeIdle.io hoje:**

- ❌ **Farm offline / Sleep Mode / botão Zzz** — o jogo só roda com a aba aberta.
- ❌ **Streak Points**
- ❌ **Game Pass / Battle Pass**
- ❌ **Clãs de elemento com ranks e missões** (existem **guilds** de 5 pessoas, que é outra coisa)
- ❌ **Shiny Cards e Altar de invocação**
- ❌ **Breeding / reprodução**
- ❌ **Ditto e transformação**
- ❌ **Tower**
- ❌ **Master Ball** e **Idle Ball** (a Beast Ball ×5 é a bola mais forte que existe)
- ❌ **Bônus de +25% XP por completar 100 kills de uma espécie na Pokédex** (a Pokédex aqui só
  registra vistos/capturados)
- ❌ **Tasks / Quests diárias**
- ❌ **Captura de bosses** (bosses não podem ser capturados)
- ❌ **Trocar diamante por gema, ou gema por diamante**

Se perguntarem sobre qualquer um deles, diga que **não existe no jogo** e não prometa data de
chegada.

---

## 42. Onde o jogador encontra a informação sozinho

- **Poképedia** (menu principal) — o manual completo, em pt/en/es, com todos os números lidos
  direto do servidor. **É sempre a fonte mais atualizada.** 23 capítulos, com busca.
- **Pokédex** — ficha de cada espécie: stats, golpes, loot, chance de captura por bola, tier shiny,
  onde encontrar.
- **Hunt Analyser** (no Mapa) — XP/hora, ouro/hora e matchup de tipos da área, para a conta dele.
- **Calculadora Pokémon** — nota de 0 a 10 de um pokémon.
- **TM Researcher → botão [i]** (Centro Pokémon) — guia completo de peças, tokens e discos.
- **Painel de depósito** — caixa, passivo e carteira do projeto em tempo real.
