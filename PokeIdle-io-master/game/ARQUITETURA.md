# Arquitetura

Idle MMO de Pokémon: uma vista de cima do mapa da hunt, painéis nas laterais e chat. O
jogador não controla o movimento — o pokémon dele caça sozinho, andando pelo mapa até os
selvagens. O objetivo de engenharia é aguentar 100–200 simultâneos com folga e chegar a 2000
**sem reescrever nada** — só subindo mais processos.

## O formato

```
                     ┌──────────────┐
   browser ──── WS ──▶│  gateway 1   │──┐
   browser ──── WS ──▶│  gateway 2   │──┤
   browser ──── WS ──▶│  gateway N   │──┤   Redis
                     └──────────────┘  │  (pub/sub + presença + trava)
                                       │
                     ┌──────────────┐  │
                     │  sim shard 0 │◀─┤
                     │  sim shard 1 │◀─┤
                     │  sim shard N │◀─┘
                     └──────┬───────┘
                            │  write-behind (5s, em lote)
                     ┌──────▼───────┐
                     │   Postgres   │
                     └──────────────┘
```

**Gateway** — só I/O. Guarda o socket, valida, aplica rate limit e traduz mensagem ↔ Redis.
Não tem nenhuma regra de jogo, então é stateless em relação ao jogo e escala com o número
de conexões. Serve também o cliente estático e os assets.

**Sim** — dono autoritativo de um subconjunto dos jogadores. Roda o tick de combate,
resolve dano/loot/captura e é a única coisa que pode alterar estado. Escala com o número
de jogadores.

**Redis** — o encanamento: pub/sub para comandos e respostas, chat com fan-out entre
gateways, presença (quem está online no cluster) e a trava de posse de shard.

**Postgres** — fonte de verdade, mas nunca no caminho crítico.

**Bot de convites** — um quarto processo, na mesma VPS, que não aparece no desenho acima porque
ele não fala com o Redis nem com o gateway: liga no Gateway do Discord, vê quem entra no nosso
servidor, credita o ponto a quem convidou e escreve em duas tabelas do Postgres. Ver
`src/bot/index.mjs`.

```
   Discord Gateway ──WS──▶ bot de convites ──▶ Postgres (convite_membros, convite_codigos)
                                                    │
                          o jogador digita          │  o sim LÊ e carimba,
                          /resgatar <codigo>  ──────┘  dentro da transação que credita
```

Ele fica **fora** do sim de propósito, e por dois motivos:

- o sim é shardado (dez processos) e a conexão com o Discord é UMA. Dentro do sim seriam dez
  bots no mesmo servidor, cada um contando a mesma entrada;
- o bot não pode tocar no estado de jogador nenhum. Ele escreve um CÓDIGO numa tabela própria, e
  quem entrega o prêmio é o sim dono daquele jogador, quando ele digita o código. Um bot que
  somasse diamante direto na conta seria um segundo dono do dado, e o write-behind passaria por
  cima dele no ciclo seguinte — o mesmo conflito que tirou `diamonds` do `flushJogadores`.

## Por que dá para shardar assim

Este jogo é *idle*: **cada jogador batalha os próprios selvagens**. Não existe interação
mecânica entre jogadores no combate — nada de sala compartilhada, nada de física em comum.
Isso muda tudo: a unidade de sharding é o **jogador**, não a "sala" ou o "mapa".

```js
shardDoJogador(nick) = fnv1a(nick) % SHARD_COUNT
```

Determinístico e sem coordenação: todo processo chega no mesmo número, então o gateway sabe
para onde mandar sem consultar ninguém. Dois jogadores na mesma hunt podem estar em shards
diferentes — e tudo bem, porque não se veem.

O que **é** compartilhado (chat, presença, ranking) passa por Redis, que é justamente onde
fan-out é barato.

## Rotas no Redis

| canal | quem publica | quem consome |
|---|---|---|
| `sim:<shard>` | gateways | o sim dono daquele shard |
| `gw:<gatewayId>` | sims | o gateway que tem aquele socket |
| `chat` | gateways | todos os gateways |
| `evento` | gateway (painel admin) | TODOS os sims — o buff global é do mundo, não de um shard |
| `presenca` (hash) | gateways | `/saude` |
| `metricas` (hash) | sims | `/saude` |
| `posse:sim:<shard>` | sims | trava de exclusividade |

A resposta volta para `gw:<id>` — o gateway exato que tem o socket — em vez de um broadcast.
Com 20 gateways, um broadcast faria 19 deles descartarem cada mensagem.

## Mercado Global: por que existe uma caixa postal

Anúncio entre jogadores esbarra numa regra do sistema: `flushJogadores` grava `gold` e
`items` **a partir da memória do sim**. Creditar o vendedor direto no banco não funciona —
se ele estiver online, o próximo flush dele passa por cima com o valor velho; e ele quase
sempre está offline ou noutro shard, que é justamente quando não há memória para mexer.

Por isso a compra **não credita ninguém**. Ela só deixa o pagamento anotado em
`market_pagamentos`, e o sim do vendedor recolhe quando ele entra (e a cada minuto, se já
estiver dentro, numa consulta só para o shard inteiro). Aí o flush vira aliado: grava
exatamente o número que o sim acabou de somar.

O escrow segue a mesma lógica de "quem é dono do dado, manda nele": o item sai do `items`
em memória (é do sim), e o pokémon ganha `anuncio_id` na linha, que faz `carregarPokemons`
deixar de enxergá-lo (é do banco). Sem isso o jogador anunciaria e venderia o mesmo pokémon
ao NPC.

ORB é o caso fácil e não está no flush — o ledger é a verdade. Ainda assim o pagamento em
ORB passa pela mesma caixa postal, por motivo de produto: o vendedor tem de ver as duas
moedas no mesmo "você vendeu X". A comissão de 30% sai do **vendedor**, e o resumo a mostra
antes de publicar. Detalhes e as invariantes testadas: `src/server/market-db.mjs` e
`tools/teste-market-global.mjs`.

**O chat sai do gateway, não do sim** — é o que permite o fan-out único em `chat` sem uma
ida e volta ao worker dono do jogador. Só que a linha do chat mostra dois dados de JOGO: o
selo de VIP e o nível ao lado do nick. A saída é ler de carona (`lerCargo`, em
`gateway.mjs`): todo pacote de estado que já ia para aquele socket passa por lá antes de
sair, e o VIP/nível ficam no próprio `ws`. Quando a mensagem chega, o dado já está ali —
zero requisição a mais, e o carimbo vem do **servidor**, não do cliente (nick dourado que
se ganha mandando `{vip:true}` não vale nada).

**Em `ROLE=all` as mensagens ainda passam pelo Redis.** É de propósito: o caminho de código
exercitado em dev é o mesmo de produção. Um atalho em memória esconderia bugs de
serialização e de roteamento até o dia do deploy.

## A raiz é a landing page; o jogo mora em `/app`

Quem chega em `pokeidle.io` pela primeira vez vem de um anúncio ou de uma busca, e traz duas
perguntas: *o que é isso* e *por que eu jogaria*. A tela de login não responde a nenhuma das
duas — ela pede nick e senha de um jogo que a pessoa ainda não sabe o que é. Por isso a raiz
serve `landing.html`, e `/index.html` (o cliente do jogo) passou a responder também em
`/app`. O mapa está no `PAGINAS` de `gateway.mjs`.

Três consequências que precisam andar juntas, e quebrar qualquer uma quebra o login:

1. **Quem já joga não vê a landing.** O `landing.js` olha o `localStorage`: havendo `sessao`,
   ele faz `location.replace('/app' + search + hash)`. É `replace` e não `href` porque com
   `href` a landing fica no histórico e o botão "voltar" devolve a pessoa para ela, que a manda
   de volta para o jogo — o laço clássico de redirecionamento em home.
2. **Os retornos de `/auth/*` apontam para `/app`.** O OAuth volta em `/app?sessao=…`, e a
   confirmação de e-mail em `/app?emailOk=1`. Se algum voltar a apontar para `/`, o token cai
   numa página que não sabe lê-lo. (O reenvio do item 1 leva a query string junto justamente
   para isso ser um cinto de segurança, e não a mecânica.)
3. **As ferramentas abrem `/app`.** `tela.mjs`, `tela-mobile.mjs`, `medir-banda.mjs`,
   `console.mjs`, `gravar-gameplay.mjs` e os `teste-*` navegam para lá. Cuidado com a distinção
   que já mordeu uma vez: a **origem** (`http://localhost:8080`) é o que as rotas `/auth/*`
   penduram; a **página** é `${origem}/app`. Misturar os dois gera `/app/auth/criar`.

O vídeo e os sprites da landing ficam em `src/client/midia/`, e é o único caminho com cache
longo no `politicaDeCache` — 4 MB revalidando a cada visita custam a primeira dobra.

`node tools/teste-landing.mjs` (ou `npm run test:landing`) cobre os quatro caminhos: a raiz
serve a landing, o CTA está acima da dobra, o clique cai na tela de carregamento do jogo, e
quem tem sessão pula direto.

## Moderação do chat: o menu e os comandos são caminhos diferentes de propósito

Mutar tem duas portas, e elas NÃO compartilham permissão:

| | quem | duração | mensagem |
|---|---|---|---|
| menu da mensagem | admin, moderador, helper | 5 / 30 / 60 / 1440 min | `chat.mute` |
| `/mute <nick> <min>` | admin, moderador | 1 min a 7 dias, digitada | `chat.comando` |

Os comandos existem porque a denúncia chega em **privado** ("fulano está enchendo o Mundo de
propaganda") — pela DM da Lista de Amigos, desde que a v1.55.1 tirou o sussurro do chat —, e
o menu só abre em cima de uma MENSAGEM daquele nick no chat. Se o infrator já parou de falar,
não havia por onde. Digitar o nick resolve.

Daí a interceptação viver nas TRÊS caixas de texto que o moderador pode ter na frente: o
chat, o painel da guild e a DM da lista de amigos. Deixar uma de fora é justamente o caso em
que o comando vira mensagem literal na cara de quem denunciou.

São duas mensagens de protocolo, e não um campo `viaComando` no `chat.mute`, porque a
permissão é o que separa as duas: um campo no pacote seria um pedido educado ao cliente, e
um cliente adulterado responde o que quiser. Com tipos separados, `podeComandarChat`
(`CARGOS_CMD_CHAT`) tranca o caminho inteiro no servidor. O helper fica no menu: lá as
durações são quatro e a maior é 24 h; o comando aceita uma semana e não pede confirmação.

O cliente também intercepta a linha ANTES de mandar (`interpretarComandoChat`), e intercepta
mesmo para quem não pode: melhor a recusa em toast do que `/mute Fulano 30` publicado no
Mundo para todo mundo ler. A permissão de verdade continua sendo a do gateway.

`/unmute` reaproveita o `revogarMuteChat` do painel admin e avisa o mutado com
`chat.mute { ate: 0 }` — o mesmo pacote que o botão "Revogar" já mandava.

## Chave de roteamento vs id do banco

O jogador é roteado pelo **nick em minúsculas**, não pelo id numérico do Postgres. O id só
existe na persistência (`p.dbId`). Misturar os dois quebra o roteamento de volta ao socket
de um jeito silencioso — o servidor processa tudo certo e o cliente simplesmente não recebe
nada. (Aconteceu na primeira versão.)

## O campo

Cada jogador tem um **campo**: a área andável da hunt e quem está andando nela. É o modelo do
jogo original — lá o cliente recebe `field-init` com a grade (`rows`/`cols`/`grid`) e depois
`field` a cada tick com herói e mobs em linha/coluna; o browser só interpola.

**A grade.** Vem pronta de `world/walkgrids.json`, gerado no sprite-lab por
`tools/build-walkgrids.mjs` com a mesma regra do `walkable(tx,ty)` deles: dentro da caixa
`_meta.walk`, com tile no andar do chão, e sem nenhum item de `collision.json` em cima.
Abrir os 238 MB de mapas dentro do tick não é opção; a grade inteira dos 347 mapas cabe em
1 MB e vira `Uint8Array` no boot.

**Quem anda.** O **treinador** anda atrás do pokémon o jogo inteiro (passo de 290 ms contra
260 ms do pokémon, então fica sempre um passo atrás) e não entra na conta de ocupação: dois
personagens do mesmo jogador dividindo tile é melhor do que o treinador travando o caminho
dos selvagens. Uma onda enche o campo com um selvagem por ponto de spawn da hunt (até 16,
que é o máximo que existe) — cada um da espécie que o próprio ponto declara. Os selvagens
vagueiam em volta do ponto de spawn com coleira de 5 tiles; quem chega a 12 tiles do herói
irrita e vem em cima dele, e só desiste passando de 18 (a histerese é o que faz o bando vir
junto em vez de um por vez — o herói anda o dobro da velocidade deles). O herói vai até o
selvagem mais próximo por busca em largura (4 direções, teto de 4 mil células), **reavaliando
o alvo a cada tick enquanto está a caminho** — sem isso ele atravessa meia dúzia de pokémon
do lado para bater num que está longe — e **só troca golpes encostado**. Morreu todo mundo, a
onda seguinte entra 2,6 s depois.

Constantes de balanceamento (passo do herói 260 ms, do selvagem 520 ms, coleiras, raios de
aggro, tamanho da onda) estão todas no topo de `src/server/game/campo.mjs`.

**Nocaute.** Quando o pokémon em campo cai, o sim tenta revive, depois tenta trocar por
outro do time de pé. Se não houver nenhum, o jogador vai para o **Centro Pokémon** — a praça
compartilhada da seção abaixo. `centro.curar` restaura o time inteiro e o jogador FICA lá:
sair do Centro é escolher uma área no Mapa, que é uma decisão à parte.

**Sair da luta tem preço, e é o mesmo em toda porta.** Três regras que só fazem sentido juntas:

1. **Todo login começa na praça do Centro**, nunca na hunt em que o jogador parou. A hunt fica
   guardada (`p.huntSlug`) e um clique no Mapa volta para lá; o que se perde é o caminho.
2. **Subir ao Centro a pé exige 3 s sem trocar dano** (`CENTRO_SAIDA_MS`). O botão do palco
   mostra a contagem, mas quem recusa é o servidor: botão desabilitado é aviso, não regra.
3. **Sumir do ar fora do Centro custa o mesmo que morrer ali** (`punirAbandonoDaLuta`): o time
   inteiro vai ao chão e o XP é cobrado, igual a uma morte de verdade. Vale também para queda
   de conexão — não há como distinguir um cabo arrancado de um Alt+F4 no frame do golpe fatal,
   e regra que depende de adivinhar intenção não vale nada. (No PvP ranqueado a pergunta nem
   se coloca: a partida acontece inteira no servidor antes de qualquer pacote sair.)

Sozinha, cada uma tem um furo. Sem a 3, fechar a aba era a jogada certa em toda luta perdida:
saía de graça, e o oponente que estava ganhando ficava sem nada. Sem a 1, a 3 não cobrava
nada de verdade — o jogador voltaria exatamente onde estava. Sem a 2, bastava clicar no botão
no frame do golpe fatal. Juntas, a única saída barata é a que o jogo quer ensinar: subir ao
Centro quando a luta ainda está ganha.

O navegador avisa antes de fechar (`beforeunload`), mas o texto do diálogo **não é nosso** —
desde 2016 os navegadores mostram uma frase genérica no lugar da que a página manda. Por isso
a explicação de verdade fica na tela, embaixo do botão de subir ao Centro; o diálogo só segura
a porta.

**O Centro Pokémon é uma praça.** O segundo lugar do jogo em que jogadores se veem — e o
único em que isso não custa nada, porque lá não acontece combate nenhum. Quem desmaia cai
ali, quem quiser vai a pé pelo botão do palco, e todo mundo que estiver na praça aparece na
tela dos outros com o **pokémon de batalha andando atrás**. Digitou no chat, sai um balão em
cima da cabeça. Nada de combate lá dentro — nem selvagem, nem PvP — e não há como sair do
mapa. (O PvP também não acontece aqui: a fila do ranqueado se abre de qualquer lugar do jogo,
inclusive de dentro de uma hunt, e a partida roda no servidor.)

Seis decisões sustentam isso:

**A área.** Já foi um recorte de 19×19 em volta da enfermeira, com a cena parada — e a
enfermeira fica DENTRO do prédio, numa sala de três tiles fechada por parede. Não dá para
andar em três tiles, então a praça é o Centro Pokémon e as ruas em volta: uma "área especial"
do `build-walkgrids` (slug `centro`, recortada do mapa de `cerulean`), 70×46 tiles, 1.815
andáveis conectados. A Joy e a Chansey saíram para a calçada, como pontos de spawn da grade.
Cerulean inteira daria 5.593 tiles, mas também 82 mil sprites e um canvas de 66 MB no
navegador — o dobro do maior mapa do jogo, com risco real de não alocar no celular.

**Quem é o herói.** Em toda cena de batalha o `heroi` do protocolo é o **pokémon**: é ele que
caça, e é nele que a câmera fica. Na praça é o **treinador**, porque é ele que o jogador
dirige — e o pokémon vai junto dos outros, em `mobs`. É a mesma inversão que o cliente precisa
saber para não escrever o sprite do Charmander por cima do boneco.

**O tick é outro.** 250 ms é o certo para um idle, em que o pokémon anda sozinho; para quem
está com a mão no WASD é o tempo que a tecla leva para responder. A praça anda em **100 ms**,
com passo de **200 ms** — dois ticks exatos, e é essa conta que emenda um passo no outro. Com
o passo de 260 ms da hunt num tick de 250, o passo termina 10 ms depois do tick e o seguinte
só sai no próximo: o boneco anda uma tile e fica 240 ms parado. Serve para o pokémon que caça
sozinho; não serve para quem está dirigindo. O custo disso **não** é 2,5× a banda: o pacote é
delta e só entra nele quem COMEÇOU um passo — um jogador andando começa cinco passos por
segundo com tick de 100 ms ou de 250 ms. O que cresce é o número de pacotes, não o conteúdo.

**O cliente continua sem simular nada.** Ele manda só a direção que está segurando
(`centro.andar`), e só quando ela muda. Quem decide se a tile é andável, se tem alguém em cima
e se já deu tempo é o servidor. Mandar o comando dez vezes por segundo não anda mais rápido.

**Ninguém trava ninguém.** Os bonecos se atravessam — nem treinador, nem pokémon, nem a
enfermeira ocupam tile. Colisão parece mais "física", mas numa área social ela vira ferramenta:
três pessoas paradas lado a lado fecham a porta do Centro Pokémon e não há nada que quem está
de fora possa fazer. Sem combate, sem objetivo disputado e com a enfermeira do outro lado do
balcão, o bloqueio só serviria para atrapalhar de propósito. A ocupação continua calculada
para uma coisa só: espalhar quem chega, para ninguém nascer empilhado em cima de outro.

**Salas.** Todo mundo que desmaia cai aqui, então a praça é o lugar com mais chance de juntar
gente demais — e o custo de uma área compartilhada é o quadrado da população. Por isso ela é
dividida em salas de 40, e quem entra vai para a **primeira sala com vaga**, não uma aleatória:
é o que mantém as pessoas juntas em vez de espalhá-las por salas pela metade.

O balão de fala **não tem mensagem de servidor**. O chat já chega a todo mundo num fan-out só
e a praça já diz o nick de cada boneco; ligar as duas coisas é uma busca por nome dentro do
cliente. Mandar um segundo pacote com o mesmo texto seria pagar duas vezes pela mesma frase.

**Curar é falar com a enfermeira**, não apertar um botão de menu. O botão flutua em cima da
Joy, dentro da cena: um elemento de DOM (o mesmo botão roxo do resto do jogo, com hover, toque
e foco de teclado de graça) posicionado a cada quadro pelo ponto de tela que o campo devolve.
Ele não é pintado no canvas justamente por isso — um retângulo desenhado à mão não tem nada
disso. A caixa antiga, presa no rodapé, fazia sentido numa cena parada; numa área em que se
anda, ela tapava o caminho.

E a Joy **responde**: o servidor manda só qual fala (`k: 'joy'`), e a frase sai do dicionário
do cliente — senão o balão apareceria em português para quem joga em inglês. Clicar com o time
inteiro de pé cai numa de três respostas sorteadas, em vez de não fazer nada: é o clique mais
comum que existe ali, e um botão mudo parece um botão quebrado.

A praça vive na memória de um processo: com `SHARD_COUNT > 1` cada shard tem as suas salas e
dois jogadores em shards diferentes não se veem. A arena PvP ao vivo resolvia isso migrando todo mundo
para um shard só; aqui não daria o mesmo — o Centro é para onde o jogo MANDA quem perdeu o
time a cada login, e migrar todo login para um processo só concentraria nele o jogo inteiro.
Ver menos gente na praça é um aborrecimento; não poder curar o time é um jogo travado, então
a escolha aqui é a praça ficar por shard mesmo. (O PvP de hoje não migra ninguém — ver o
capítulo do PvP ranqueado.)

O espelho não traz sprite de NPC, então a Joy é o outfit `Trainer` feminino e a companheira
dela é a Chansey de verdade — substitutos assumidos.

**Bosses.** O mesmo campo outra vez, com mais dois parafusos. A arena é um mapa próprio
(`cruel_boss`) recortado como área especial, e o boss entra como um mob **fixo**: não vagueia,
não persegue, só encara. Ele fica dentro da poça d'água, que bloqueia, então o campo nasce com
`distCombate: 2` — o pokémon briga da margem, a duas tiles, que é o `heroStop` da arena deles.
O boss não usa a lista de golpes da espécie e sim a da ficha (power e cooldown próprios), e o
dano que ele causa é multiplicado pela **penalidade de equipe**, calculada na entrada. Derrubá-lo
paga a tabela de drops, dá um ponto de boss e devolve o jogador à hunt; perder tira da arena
antes de mandar para o Centro, senão a enfermeira devolveria o jogador para dentro dela de graça.

**PvP ranqueado — a partida que não tem "durante".** O PvP entre dois jogadores já foi uma
arena ao vivo: um campo compartilhado, todo mundo dentro, trocando dano em tempo real. Ela foi
aposentada (`game/pvp.mjs` continua no repositório, inalcançável e com um cabeçalho explicando
o que falta para apagá-lo) e o que existe hoje é outra coisa — uma fila de ELO, 1×1, com a
equipe fechada antes de entrar.

A diferença que importa não é de produto, é de arquitetura: **a partida é atômica**. No
instante em que o pareamento casa dois jogadores, a luta inteira é simulada de uma vez pela
MESMA `simularGuerra` do duelo de ginásio, os pontos são gravados em transação, e só então o
resultado viaja para os dois. O que o jogador vê depois — o mapinha, os cinco pokémon se
batendo, o "+18" no fim — é a reprodução de um fato consumado.

Isso apaga uma classe inteira de problema. A arena ao vivo precisava de duas travas de tempo
(10 s sem dano para sair, 5 min para reentrar), de uma punição de abandono que calculava ELO
contra a média da sala, e do balé de migração entre shards descrito mais abaixo — tudo para
chegar perto de "fechar a aba não te salva". Aqui não é preciso nada disso, porque não existe
um instante em que fechar a aba mude alguma coisa: quando o pacote sai, o Postgres já sabe o
resultado.

    fila         Redis (`pvp:fila`, um hash). O shard do jogador escreve e renova o carimbo de
                 vida a cada 6 s; entrada sem batida vira lixo em 25 s. Perder a conexão tira
                 da fila — ninguém é pareado estando fora do ar.
    pareamento   UM processo (`config.arenaShardId`, o mesmo que apura os ginásios). Dois
                 pareadores casariam o mesmo jogador duas vezes. O par é RECLAMADO por um
                 script Lua que só apaga os dois campos se os dois ainda existirem — é isso
                 que faz o cancelamento ser honesto em vez de uma corrida.
    pontos       Postgres, em `pvp_rank`, **fora do write-behind**. É a mesma regra das duas
                 moedas pagas e do Mercado Global: quem escreve não é o dono do jogador, então
                 gravar em `players` seria escrever um número que o próximo flush apaga.
    entrega      direto ao gateway do jogador (`gatewayDoJogador`), sem passar pelo sim dono —
                 não há estado de ranqueado na memória de sim nenhum para sincronizar. A
                 exceção é o `pvp.rank.mudou`, que só diz "releia" para o snapshot da ficha do
                 treinador não ficar congelado na foto do login.

**A escada** (`shared/pvp-rank.mjs`) é um número só: pontos de ranking. Tier, divisão, barra de
progresso, janela de busca e ganho por partida saem todos dele, e as MESMAS funções rodam no
cliente e no servidor — a tela desenha "faltam 60 PR para Ouro I" sem uma ida ao servidor, e o
servidor decide a partida sem confiar em nada que o cliente diga.

Três decisões dela foram medidas, e não escolhidas, porque `tools/teste-pvp-rank.mjs` reprovou
as versões anteriores:

1. **Sete tiers em 1.800 PR, e não em 3.500.** A largura é lida pela fórmula do Elo, onde 400
   pontos valem 10 para 1. Uma escada de 3.500 diria que o topo vence a base 562 milhões de
   vezes em cada derrota — um número que não descreve jogador nenhum, e que na prática
   espremia a população inteira em dois tiers.
2. **A derrota custa 70% do que a vitória paga** (`PVP_ATRITO_DERROTA`). Elo puro é soma zero,
   e soma zero mantém a média da população onde ela nasceu — com todo mundo nascendo no chão,
   a simulação de 200 jogadores × 300 partidas terminava com o melhor deles em 578 PR. Sem o
   atrito, Diamante para cima não é difícil: é inalcançável.
3. **Mestre e Challenger são POSIÇÕES, não pontos** (as 50 e as 20 primeiras). O atrito faz o
   número inflar com o tempo, e nenhum limiar de pontos sobrevive a isso. Posição sobrevive:
   inflem os pontos quanto inflarem, o topo continua sendo cinquenta e vinte pessoas. Quem tem
   os pontos e não tem a vaga aparece como Diamante III, com o número de posições que faltam
   escrito na tela.

O preço da decisão 2 é declarado: os tiers de baixo inflam, e o remédio para eles é o de sempre
nos jogos que fazem isto — temporada, zerando a tabela de tempos em tempos.

**As travas anti-abuso** vivem no pareamento, e nenhuma delas depende do cliente: o mesmo par
não se reencontra por 10 minutos; reencontrar o mesmo oponente nas 24 h seguintes rende metade,
depois um quarto, depois nada; e duas contas do mesmo IP só se encontram quando não sobrou mais
ninguém na fila — e a partida delas vale **zero**.

A regra do mesmo IP já foi um bloqueio duro, e a troca por "último recurso com peso zero" tem
duas razões. A prática: o dono do jogo não conseguia testar o próprio PvP com duas contas, e
irmãos, república e lan house nunca se encontrariam — sem aviso nenhum, só uma fila que não
anda. E a teoria: o que se quer impedir não é o ENCONTRO, é o LUCRO. Zerar o ganho impede o
lucro, e impede melhor — um bloqueio se contorna com um celular na rede móvel, um peso zero
não. (O endereço vira um resumo antes de entrar na fila, e loopback não conta: em dev é todo
mundo, em produção é sinal de proxy quebrado, e o pareador avisa uma vez no log.)

Quando a fila tem gente e ninguém casa, o pareador **explica por quê** no log, uma vez por
minuto — quem está esperando, com quantos pontos, há quanto tempo e qual a janela de cada um.
É a diferença entre "minhas duas contas não se acham e não sei por quê" e uma linha que diz
que a janela ainda está em 25 PR e a diferença entre elas é 340.

**Por que o replay não é gravado.** A fita de uma partida é a mesma da Guerra de Guilds, e uma
partida 1×1 dá ~7 KB. Guardá-la seria dezenas de MB por dia de um conteúdo que se assiste uma
vez, nos dez segundos seguintes — e quem estava online (a única forma de estar na fila) já viu.
O histórico guarda o RESUMO, que é o que se consulta depois. Quem caiu no último segundo acha
o resultado numa caixa postal (`a_visto`/`b_visto`), marcada na leitura.

Testes: `npm run test:pvp:rank` (a escada, o Elo e o pareamento, sem infra) e
`npm run test:pvp:e2e` (três clientes WebSocket de verdade contra o servidor no ar, terminando
numa conferência no Postgres — inclusive a de que o resultado já está gravado no instante em
que a fita chega à tela).

**Multi-shard: nada a fazer.** Este é o parágrafo mais curto do capítulo, e é o ponto. A arena
ao vivo exigia migrar o jogador inteiro para o shard dono das arenas antes de entrar, e de
volta ao sair — gravar no Postgres, tirar da memória, pedir para o outro processo recarregar,
esperar o flush terminar antes de publicar. Aqui a fila é uma chave de Redis e os pontos são
uma linha de Postgres: o jogador não sai do lugar, e o pareador nunca precisa dele em memória.

**GEMAS — a moeda com lastro.** (Chamada de ORB no código: o nome de tela mudou, os
identificadores não.) A parte do sistema que move dinheiro de verdade, e uma das duas que
**não** usam o write-behind. O resto do jogo aceita perder 5 segundos num crash; aqui 5
segundos são dólares aparecendo ou sumindo, então cada movimento é uma transação síncrona.

Não há NFT, token nosso nem contrato. Existem duas pontes com a blockchain, nas bordas —
depósito de USDT e saque de USDT — e entre elas ORB é uma linha de Postgres. Trocar pokémon,
vender no market, converter em ouro: tudo `UPDATE`, sem taxa de rede e sem esperar bloco.

A conta fecha por uma regra só: **ORB nasce apenas de compra.** Nunca de drop, quest ou boss.
Todo ORB sacado a US$ 0,007 foi comprado a US$ 0,01 por alguém, e a diferença (30%) é o que
paga servidor e desenvolvimento. Se o jogo emitisse ORB, cada unidade viraria passivo em USDT
sem lastro. `MOTIVOS_QUE_EMITEM` tem um item, e `teste-orbs.mjs` falha se alguém acrescentar
outro.

`players.orbs` é **cache**; a verdade é `orb_ledger`, append-only, uma linha por movimento,
atualizada na mesma transação que o saldo. Daí saem auditoria (somar a tabela tem de bater com
a carteira), reconstrução e detecção — `conferirSaldo()` procura divergências entre os dois.

**DIAMANTES — a outra moeda paga, e por que são duas.** Diamante entra por PIX (Efí) ou
cartão (Stripe) e é gasto na Loja; gema entra por USDT e volta em USDT. As duas não têm a
mesma natureza contábil: gema em circulação é **passivo** (o jogador saca quando quiser),
diamante é **receita** (acaba ao ser gasto). Enquanto a Loja cobrava em gema, vender um boost
de XP abatia dívida em vez de faturar. Hoje a divisão é por quem está do outro lado da compra:
diamante compra do JOGO, gema compra de OUTRO JOGADOR.

Diamante tem ledger próprio (`diamante_ledger`) pelas mesmas três razões da gema, mais uma que
é só dele: **o crédito não chega pelo dono do jogador.** O webhook do provedor bate num
*gateway*, que não tem a memória do sim nem sabe qual sim é o dono. Somar em memória é
impossível dali, e somar no banco seria desfeito pelo `flushJogadores` no ciclo seguinte. Por
isso `diamonds` SAIU do flush e o crédito usa a mesma caixa postal do Mercado: o gateway grava
no ledger, o sim recolhe (no login e a cada 15 s) e só atualiza o cache da tela. A
idempotência é a transição `pendente → pago` com `WHERE status = 'pendente'` — webhook
reenviado, webhook e reconciliação juntos, dois gateways ao mesmo tempo: só o primeiro
`UPDATE` encontra a linha. `teste-diamantes.mjs` cobre os três casos.

O saque tem uma máquina de estados e **um** perigo real: não é o envio falhar, é ele ter dado
certo sem a gente ver (timeout de RPC, nó dessincronizado, processo morto entre o broadcast e
a resposta). Reenviar em cima disso paga duas vezes, e transferência em blockchain não volta.
Três defesas, todas necessárias:

1. o hash é gravado **antes** do broadcast — sem ele não há o que reconferir depois;
2. reenvio só depois de **1 hora** (`REENVIO_DELAY_MS`), tempo de qualquer pendente resolver;
3. e, mesmo depois da hora, `processarSaque` **pergunta à rede** o que aconteceu com o hash
   antigo: confirmada → marca como paga e não envia nada; pendente → espera mais.

`teste-orbs.mjs` exercita exatamente o pior caso (broadcast responde erro numa transação que
caiu) e prova que o segundo envio não acontece. A blockchain de verdade fica atrás do
adaptador em `chain.mjs`, que por padrão é simulado — ligar rede real exige preencher aquele
arquivo, e uma revisão de segurança antes do primeiro dólar.

**Loja VIP.** Catálogo transcrito do `/api/game/diamonds` do jogo original (61 produtos), em
`game/loja.mjs`: 35 boosts (5 tipos × 7 durações), VIP 30/60/90, Bless, troca de nome e
gênero, outfits e a **Beast Ball** — a "Idle Ball" deles, mesma mecânica (`catchRate: 5`) com
nome e sprite trocados. Boost e VIP são carimbos de expiração no jogador; os multiplicadores
entram em `ganharXp`, `rolarLoot`, `chanceCaptura` e `montarSelvagem` (o shiny é sorteado no
nascimento do mob, então o Secret Lure tem de valer ali). Ficaram de fora Ditto, Game Pass e
Tower — dependem de sistemas que este jogo não tem, e um botão que cobra e não faz nada é pior
que ausência.

**i18n.** Três idiomas (PT-BR, EN, ES) em `client/i18n.mjs`: dicionário como módulo ES (sem
bundler e sem `fetch` extra, então o idioma já está resolvido no primeiro frame), `t('chave')`
com interpolação, e marcação declarativa no HTML por `data-i18n`. O chat tem idioma **próprio**
— quem joga em inglês e conversa em português é o caso comum, não a exceção — e o filtro é de
leitura: o fan-out do Redis continua sendo um só, com a língua carimbada na mensagem.
`teste-i18n.mjs` garante que os três dicionários tenham as mesmas chaves e os mesmos
`{placeholders}`; sem ele, uma frase nova em português vira tela bilíngue em silêncio.

**Andares.** Um mapa de hunt não é plano: caverna, telhado e a pirâmide do Abra são andares
ACIMA do chão (`z < groundZ`), desenhados por último. Sem tratamento, eles cobrem o mapa
inteiro e o jogador não vê pokémon nenhum — em 12 das hunts a área andável é 51% a 100%
coberta. O cliente esconde os andares que estão em cima do herói, com o
`computeFirstVisibleFloor` deles: subindo andar a andar, o primeiro que tiver chão em
`(tx+n, ty+n)` some, junto com todos acima. A transição é um fade de 180 ms.

**Cadência de ataque.** Os cooldowns dos golpes são os reais: 43 ataques de 10 s, 46 de 30 s,
80 de 40 s, até um de 280 s. Um Caterpie nível 5 conhece dois golpes, os dois de 10 s. Só com
eles o pokémon dava duas pancadas e ficava dez segundos colado no selvagem sem fazer nada. Por
isso existe um **ataque básico** (nosso, no molde de OTPokemon/Tibia): power 30 a cada 2 s, no
tipo do próprio pokémon, usado sempre que nenhum golpe de verdade está pronto. Triplicou a
cadência — de 8 para 24 golpes em 40 s de briga.

## O tick

`TICK_MS=250` (4 Hz). Para cada jogador com hunt ativa: move o campo, escolhe alvo, resolve
ataques cujo cooldown venceu, aplica dano, checa morte, rola loot, tenta auto-ball, tenta
auto-revive/poção.

- **Eventos de batalha** vão a cada tick, em lote (`{t:'batalha', ev:[...]}`), só se houver algo.
- **Delta do campo** (`{t:'campo', …}`) vai a cada tick, mas só com quem mudou: uma entidade
  só entra no pacote no tick em que ela **começa um passo novo** ou muda de HP. Com passos de
  260–520 ms e tick de 250 ms, isso são ~5 entidades por pacote em vez de 17.
- **Estado do jogador** vai no máximo 2×/s, só se algo mudou, e **só o que mudou**
  (`estadoParaEnviar`). O pacote antes carregava o quadro inteiro, inclusive a coleção de
  pokémon — que num jogador de um mês passa de 200 bichos e dava 99,4% do payload. Um golpe
  de 40 de dano custava 168 kB de rede. Hoje o delta médio é ~700 B, e um jogador com 3.000
  pokémon custa a mesma banda que um com 30. A coleção e a Pokédex têm delta por ENTRADA
  (`pkMud`/`pkFora`, `dexMud`/`dexFora`); o resto é delta por chave.
- **A remontagem é do cliente** (`shared/estado-delta.mjs`), e é o que permite que as ~44
  telas que leem `estado.eu.pokemons` não saibam de nada disso: para elas o objeto continua
  completo. A ordem da coleção é preservada porque os dois lados são `Map` e aplicam as
  mesmas adições e remoções.
- **O socket é comprimido** (`permessage-deflate`, ligado em `gateway.mjs`). O `ws` desliga
  por padrão — ver lá o porquê de cada parâmetro, em especial o `noContextTakeover`, que é o
  que impede a troca de uma conta de banda por uma de RAM.
- **A praça do Centro Pokémon** não anda neste tick: ela tem o dela, de 100 ms, porque lá o
  movimento vem do teclado do jogador (ver a seção do Centro, acima).

O cliente **não simula nada**: ele anima o que chega. Cada entidade vem como "saiu de (c,r),
está indo para (c,r), começou em `em`, leva `ms`" e o browser interpola entre as duas tiles,
trocando o quadro do sprite conforme a fração do passo. Os carimbos de tempo são do relógio
do **servidor** — o cliente estima a diferença com média móvel, senão um relógio adiantado
desenha todo mundo já no destino e a caminhada some.

## Persistência sem travar o tick

O tick nunca faz I/O de banco. Marca o jogador como sujo; a cada `FLUSH_MS=5000` um writer
despeja o lote inteiro numa transação. No disconnect, flush imediato daquele jogador.

O estado do jogador é quase todo `jsonb` (inventário, bolas, automações, pokédex): um jogador
inteiro sai e entra numa linha só, sem join no caminho quente. Só os pokémon têm tabela
própria, porque são muitos e mudam pouco.

Perda máxima num crash: 5 segundos de progresso. Para um idle, é aceitável.

## Trava de posse do shard

Dois processos com o mesmo `SHARD_ID` assinariam o mesmo canal e processariam os **mesmos**
jogadores em paralelo — cada comando executando duas vezes, o jogador recebendo tudo
duplicado. É um erro de deploy fácil de cometer e difícil de perceber.

`posse:sim:<shard>` é um `SET NX PX 15000` renovado a cada 5s. O segundo processo recusa-se
a subir com uma mensagem explícita. Se o dono morre, a trava expira e outro assume.

## Como escalar

```bash
docker compose up -d                                    # Postgres + Redis

npm start                                               # tudo num processo (dev)

# ou separado:
ROLE=sim     SHARD_ID=0 SHARD_COUNT=2  npm start
ROLE=sim     SHARD_ID=1 SHARD_COUNT=2  npm start
ROLE=gateway SHARD_COUNT=2 PORT=8080   npm start
ROLE=gateway SHARD_COUNT=2 PORT=8081   npm start
```

Mais conexões → mais gateways (atrás de um LB qualquer; **não precisa de sticky session**,
porque a identidade do socket vive no Redis, não no processo).
Mais jogadores → mais shards de simulação (aumentando `SHARD_COUNT` em todos).

Mudar `SHARD_COUNT` remapeia os jogadores, então exige um restart coordenado. Para trocar a
quente seria preciso hash consistente com migração de sessão — não vale a complexidade nesta
faixa de escala.

## Números medidos

Máquina: 8 cores, 31 GB, tudo local (cliente, servidor, Redis e Postgres competindo pela
mesma CPU — em servidores separados sobra bem mais).

| cenário | conexões | tick p50 | tick p95 | msgs/s | banda | por jogador |
|---|---|---|---|---|---|---|
| 1 processo (`all`) | 200 | 7,0 ms | 9,6 ms | 1.240 | 610 KB/s | 3.120 B/s |
| 1 processo (`all`) | 1000 | 31,3 ms | 34,8 ms | 5.953 | 3,0 MB/s | 3.133 B/s |
| 1 processo (`all`) | **2000** | 52,5 ms | 87,5 ms | 12.300 | 5,8 MB/s | 2.982 B/s |

Os bots do `loadtest` caçam só nas 12 áreas de nível 1 — é onde um treinador novo consegue
entrar, agora que o servidor recusa área acima do nível. Mapas menores que a média das 40
primeiras áreas, então estes números estão um pouco melhores que a medição anterior.

Latência `hello→welcome` com 2000 conexões: p50 144 ms · p95 310 ms · p99 365 ms.

**O orçamento do tick é 250 ms.** Com 2000 jogadores num único shard o p95 fica em 88 ms —
sobra ~2,8× no pior caso. O gargalo real chega antes na banda de saída e no número de sockets
por processo, que é exatamente o que o split gateway/sim resolve.

**De onde veio o custo.** Antes do campo (um selvagem por vez, sem posição) eram 1,1 KB/s e
64 ms de p95 com 2000 jogadores. Simular 17 entidades andando por jogador e mandar as posições
levou isso a ~2,4 KB/s e 90 ms; o ataque básico, que triplicou a cadência de golpes, levou a
~3 KB/s. É o preço de ter movimento e combate de verdade em vez de um boneco parado. Juntar as
mensagens do tick num publish só (batalha + campo + estado) devolveu ~15 ms. Se apertar mais,
o caminho é o protocolo binário abaixo — não cortar mobs.

(A medição do split `2 gateways + 2 sims` é anterior ao campo e foi tirada da tabela para
não misturar cenários.)

Nota de teste: passar de ~1500 conexões de um **único processo cliente** esbarra em exaustão
de portas efêmeras do Windows (sockets em `TIME_WAIT`), não no servidor. Com rampa de 150/s e
as portas drenadas, 2000/2000 conectam sem erro.

## O que ficaria para produção

- **Protocolo binário.** JSON custa ~2,4 KB/s por jogador, e a maior parte disso é o pacote
  de campo — que é só número pequeno (linha, coluna, direção, HP). Num encoding próprio cabe
  em um quinto. `codificar`/`decodificar` em `protocol.mjs` estão isolados justamente para
  essa troca ser local.
- **Autenticação de verdade.** Hoje o nick é a identidade, sem senha — suficiente para a
  fatia, inaceitável em produção.
- **Mapa em chunks.** O cliente assa a área da hunt inteira num canvas só (dezenas de MB nos
  mapas grandes) e baixa o JSON de tiles completo. O cliente deles corta em chunks de 8×8
  tiles e carrega/descarrega conforme a câmera; para mapas de 92 mil tiles isso faz falta.
- **Backpressure no socket.** Se um cliente lento acumular buffer, hoje só cresce; falta
  checar `bufferedAmount` e derrubar.
- **Anti-cheat de comando.** O servidor já é autoritativo em tudo que importa, mas falta
  limitar a frequência de comandos caros (troca de hunt em loop, por exemplo).
