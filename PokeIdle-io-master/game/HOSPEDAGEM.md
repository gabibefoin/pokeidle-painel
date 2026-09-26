# Hospedagem — do primeiro jogador ao mundo inteiro

O que este documento responde: **onde rodar**, **quanto custa**, e **o que apertar quando
apertar**. A arquitetura já foi feita para escalar horizontalmente (veja
[ARQUITETURA.md](ARQUITETURA.md)); aqui é só onde encaixar cada peça.

---

## A forma do problema

Este jogo não é um site. Três coisas mudam a conta:

1. **WebSocket permanente.** Cada jogador segura uma conexão aberta enquanto joga. Serverless
   (Vercel, Lambda, Cloud Functions) **não serve** — eles cobram e escalam por requisição curta.
2. **Estado em memória, com dono.** Cada jogador é simulado a 4 ticks/s dentro de UM processo
   (`sim`), com trava de posse no Redis. Não dá para pôr dois processos no mesmo shard.
3. **Postgres é a verdade.** ORB tem lastro em USDT; um backup ruim aqui é dinheiro de gente.

4. **A praça do Centro Pokémon tem teclado.** Isto entrou depois e desmentiu o que estava
   escrito aqui ("é um idle game, 150 ms não se sentem"). Vale para a caça, que é automática;
   **não** vale para o WASD da praça, que roda com tick de 100 ms exatamente para a tecla
   responder (ver o cabeçalho de `game/centro.mjs`). O caminho de um passo é RTT + tick, então:

   | servidor | RTT do Brasil | resposta do WASD |
   |---|---|---|
   | São Paulo | ~20 ms | ~120 ms |
   | Miami | ~110 ms | ~210 ms |
   | Ashburn | ~130 ms | ~230 ms |
   | Falkenstein | ~200 ms | ~300 ms |

   São estimativas de rota, não medição — **meça com jogadores de verdade antes de fechar**. Se
   ficar ruim, a resposta não é trocar de região: é predição no cliente para o boneco da praça.

O resto do jogo continua indiferente à distância, e é por isso que "o mundo inteiro" cabe numa
máquina só por muito tempo.

---

## Onde rodar

> **Preço aqui envelhece rápido.** Em 2026 a Hetzner reajustou os EUA **duas vezes** (abril, e
> de novo em 15 de junho com multiplicador de ~3× no CPX31), o que a tirou de "a mais barata"
> para "a mais cara da lista" fora da Europa. Confira no site do provedor antes de contratar —
> o que envelhece bem aqui é o *raciocínio de dimensionamento*, não o número.

**Dimensionar primeiro, escolher provedor depois.** Node é single-thread: com `ROLE=all`, a
simulação inteira roda em um processo, ou seja, **um núcleo**. Núcleo a mais só entra no jogo na
Fase 2, quando houver vários `ROLE=sim`. O que aperta antes é RAM — Node, Postgres e Redis
dividem a caixa. Para abrir, **2 vCPU / 4 GB** é folga.

| provedor | 2 vCPU / 4 GB | São Paulo | Miami | observação |
|---|---|---|---|---|
| **Vultr** | ~$20/mês | sim | sim | melhor combinação de preço e latência para o Brasil |
| Linode / Akamai | ~$24/mês | sim | sim | banda mais barata no excedente |
| Hetzner (Europa) | ~€8/mês | não | não | imbatível **se** a latência do Brasil não importar |
| Hetzner (EUA) | ~$37/mês | não | não | deixou de fazer sentido depois dos reajustes de 2026 |

O passo a passo de instalação está em [`infra/LEIA-ME.md`](../infra/LEIA-ME.md), e os scripts de
lá servem para qualquer VPS Ubuntu.

### Com Cloudflare na frente

| Peça | Onde | Por quê |
|---|---|---|
| App (gateway + sim) | uma VPS de 2 vCPU / 4 GB | ver a tabela acima |
| Postgres | container ao lado da app (gerenciado quando doer) | um `docker compose` no início; o que importa é o backup testado |
| Redis | container ao lado da app | é cache/barramento — perder não perde progresso |
| CDN + TLS + DDoS | **Cloudflare** (grátis) | os assets são dezenas de MB de sprite; servir do Brasil todo dia é desperdício |
| Região | **São Paulo** (base BR) ou **Miami** (global) | ver a tabela de latência acima |

**Por que não AWS/GCP/Azure:** para 50–100 jogadores, a mesma capacidade sai 3–5× mais cara, e o
grosso do valor deles (autoscaling, managed everything, multi-AZ) é para um problema que você
ainda não tem. Trocar depois é um `docker compose` noutra máquina.

**Por que não Railway/Render/Fly:** ótimos para começar e caros para continuar — a partir de
~2 vCPU sustentados, o preço passa o de uma VPS dedicada. Fly.io é a exceção defensável se você
quiser multi-região no futuro.

---

## Fase 1 — hoje, 50–100 jogadores

**Uma máquina. Um processo. `ROLE=all`.**

```
VPS 2 vCPU / 4 GB                     ~$20/mês
Cloudflare Free                         $0
Domínio                               ~$12/ano
──────────────────────────────────────────────
                                      ~$21/mês
```

Isso é bem mais do que 100 jogadores precisam — o `ROLE=all` aguenta na casa dos **500**. A folga
é de propósito: você quer margem para um pico de divulgação, não para o dia comum.

A instalação inteira está scriptada em [`infra/`](../infra/): um comando provisiona a máquina,
outro implanta, e um push no `master` passa a implantar sozinho. Ver
[`infra/LEIA-ME.md`](../infra/LEIA-ME.md).

O systemd já vem no pacote (`infra/pokeidle.service`), com `Restart=always` e o SIGTERM ligado ao
flush final. O Caddy resolve TLS e o proxy de WebSocket sem configuração. No Cloudflare, **suba
com a nuvem cinza primeiro** — o Let's Encrypt precisa da porta 80 direta para o primeiro
certificado — e só depois ligue a laranja em *Full (strict)*, conferindo que "WebSockets" está
ativo no painel.

**O que fazer no primeiro dia, e não depois:**

- **Backup do Postgres.** `pg_dump` diário para um bucket (Backblaze B2 ~US$6/TB/mês) + o snapshot
  automático do provedor. Teste a restauração uma vez — backup não testado não é backup.
- **`/saude`** já existe e devolve online, shards, tick e eventos/s. Aponte um
  [UptimeRobot](https://uptimerobot.com) (grátis) para ele.
- **Cloudflare cacheando `/assets/*`.** Uma page rule com "Cache Everything" tira dezenas de MB de
  sprite do seu servidor. Os cabeçalhos certos já saem do gateway (ver abaixo).

---

## Banda: os números medidos

Duas ferramentas, porque são dois problemas diferentes: `node tools/medir-banda.mjs` mede a
primeira carga (assets, cache, HTTP) com um Chrome de verdade, e `node tools/medir-estado.mjs`
mede o socket em regime permanente — o que multiplica por jogador e por hora.

| | quanto | o que é |
|---|---|---|
| 1ª sessão de um jogador novo | **~38 MB** | atlas de itens de mapa (`.webp`, ~1,3 MB cada), catálogos, mapas |
| 2ª sessão do MESMO jogador | **~0 MB** | tudo 304 ou direto do cache |
| socket, caçando | **~5 MB/hora** | campo, batalha e o delta de estado |

> **Este número já esteve errado por um fator de 22, e a forma do erro vale mais do que o
> número.** A tabela dizia "~15 MB/hora" e ninguém mentiu: foi medido de verdade — com um
> treinador novo, de 1 pokémon. Só que o pacote de estado carregava a COLEÇÃO INTEIRA a cada
> envio, então o custo por jogador crescia junto com o Depot dele. Quando os primeiros
> jogadores chegaram a 200 e 3.000 pokémon, o mesmo socket passou a custar **335 MB/hora**, e a
> conta da Vultr foi de zero a 2,7 TB/dia em três semanas sem que nada no código tivesse mudado.
>
> A lição para a próxima medição: **meça com o jogador que você vai ter em três meses, não com
> o que acabou de criar a conta.** `medir-estado.mjs` recebe o tamanho do Depot como parâmetro
> exatamente por isso.

A segunda linha é a que decide a conta de assets. Com ela em zero, você paga por **pessoa**, não
por sessão — e é isso que separa uma conta que cresce com a base de uma que cresce com o
engajamento. A terceira linha é a que decide a conta de **egress**, e não tem CDN que resolva.

**De onde vem cada peça:**

- **gzip** no servidor estático, com o comprimido guardado em memória (`gateway.mjs`). Só em
  texto: `cerulean.json` cai de 2.473 kB para 389 kB, `creatures.json` de 981 kB para 72 kB.
  Imagem não entra — `.webp` e `.png` já são comprimidos.
- **`immutable` de 1 ano** nos arquivos com hash no nome (`map-items-00-6d34a1e696f1.webp`), que
  são justamente os pesados. **`max-age=3600` + ETag** nos de nome fixo (`creatures.json`, os
  mapas): passado o prazo o navegador pergunta e leva um 304 de ~200 bytes em vez do arquivo.
  Marcar um ano nesses deixaria o jogador com dado velho depois de um `npm run fetch`, sem como
  forçar a atualização.
- **`permessage-deflate` no WebSocket** (`gateway.mjs`). O `ws` vem com isto desligado por
  padrão, e o texto do jogo comprime de 6× a 11×. Nível 1, janela de 8 kB e, por padrão, cada
  mensagem comprimida sozinha. `WS_DEFLATE_CONTEXTO=1` liga o contexto entre mensagens, que em
  15/09/2026 cortou mais ~80% da banda do socket por ~120 MB de RAM a cada 1.000 jogadores —
  medição e custo no comentário do código e em `infra/FASES-ESCALA.md`.
- **Estado em DELTA** (`estadoParaEnviar` em `sim.mjs`). O pacote de estado leva só o que mudou
  desde o último envio, inclusive na coleção de pokémon. É o que desatou o custo por jogador do
  tamanho do Depot: hoje um jogador com 3.000 pokémon custa a mesma banda que um com 30.

**O antes e o depois, medidos na mesma máquina** (jogador com 200 pokémon, caçando):

| | no fio | por jogador/hora |
|---|---:|---:|
| sem compressão, estado completo | 32,3 kB/s | **113,5 MB** |
| só `permessage-deflate` | 5,5 kB/s | 19,2 MB |
| `permessage-deflate` + delta | **1,5 kB/s** | **5,3 MB** |

Os dois interruptores existem para refazer essa medição a qualquer momento — e para desligar
em produção sem redeploy, se algum dia precisar: `WS_DEFLATE=0` e `ESTADO_DELTA=0`.

**Quanto isso dá por mês.** Com 100 jogadores simultâneos e 5.000 contas novas:

```
socket    100 × 5 MB/h × 720 h    ≈  360 GB
1ª carga  5.000 × 38 MB           ≈  190 GB
                                    ────────
                                    ~550 GB/mês
```

**O deploy NÃO leva `public/data`.** A pasta é gitignorada; quem sobe é
`infra/deploy-public-data.ps1` na máquina de dev. O `deploy.sh` **não** roda `npm run fetch`
— baixar do origin sobrescreveria sprites do Sprite Lab. Os 1,7 GB de `world/maps-png` só
existem se alguém rodar `npm run maps:png`, que é ferramenta de conferência e não entra no
upload de produção.

**O deploy também não leva os vídeos da landing.** `src/client/midia/*.webm` é gitignorado pela
mesma razão do `public/data`: binário grande não sai do histórico do git, e o custo se repete a
cada regravação. São dois arquivos, e eles vão no mesmo `scp` do `public/data`:

```bash
scp game/src/client/midia/gameplay-loop.webm root@207.246.72.228:/opt/pokeidle/game/src/client/midia/
scp game/src/client/midia/gameplay-tour.webm root@207.246.72.228:/opt/pokeidle/game/src/client/midia/
```

**É uma vez só, não a cada deploy.** O `deploy.sh` usa `git reset --hard`, que não encosta em
arquivo gitignorado — os vídeos ficam onde estão, como o `public/data`. Só repita o envio quando
regravar.

Esqueceu o passo? **A landing não quebra.** Ela pergunta por cada arquivo antes de usar: sem o
loop, o topo fica com o pôster (que é versionado e é um print de verdade do jogo) e o botão de
tocar não aparece; sem o tour, a seção do vídeo some sozinha. O que se perde é o movimento, não
a página. Para regravar os dois:

```bash
cd game
HUNT=<slug> node tools/gravar-gameplay.mjs src/client/midia/gameplay-tour.webm <nick> 1280 800
HUNT=<slug> ROTEIRO=loop BITRATE=2000000 node tools/gravar-gameplay.mjs src/client/midia/gameplay-loop.webm <nick> 1280 720
```

---

## Fase 2 — ~500 jogadores: separar os papéis

Ainda **uma máquina** (ou duas), mas processos separados. É o que o `ROLE` existe para fazer:

```bash
ROLE=gateway PORT=8080                 node src/server/index.mjs
ROLE=sim SHARD_ID=0 SHARD_COUNT=2      node src/server/index.mjs
ROLE=sim SHARD_ID=1 SHARD_COUNT=2      node src/server/index.mjs
```

Node é single-thread: **um processo usa um núcleo**. Dividir em shards é o que faz a CPU da
máquina inteira entrar no jogo. `shardDoJogador(nick) = fnv1a(nick) % SHARD_COUNT` é
determinístico, então todo processo sabe para onde mandar sem consultar ninguém.

`SHARD_COUNT` precisa ser **igual em todos os processos**, e mudá-lo remapeia quem vive onde —
faça com o jogo parado.

**Custo:** uma VPS de 4 vCPU / 8 GB — na faixa de $40/mês.

> ⚠️ **A praça do Centro Pokémon não segue o jogador entre shards** — cada processo tem as
> próprias salas, e dois jogadores em shards diferentes não se veem lá (só um aborrecimento
> visual; curar o time continua funcionando normal em qualquer shard). **A Arena PvP ao vivo
> já resolve isso sozinha**, migrando quem entra para o shard dono das arenas
> (`ARENA_SHARD_ID`) — não precisa de passo nenhum antes de passar de 1 shard. Ver
> `ARQUITETURA.md` para o desenho da migração.

---

## Fase 3 — milhares: várias máquinas

O gateway é stateless em relação ao jogo, então **N réplicas atrás de um load balancer**, sem
coordenação. Os sims escalam por `SHARD_COUNT`.

```
Cloudflare
    │
Hetzner Load Balancer (~€6/mês, sticky por IP)
    ├── vm-gw-1   ROLE=gateway     ┐
    └── vm-gw-2   ROLE=gateway     │  Redis (pub/sub + presença)
                                   │
    ├── vm-sim-1  SHARD 0,1,2,3    ┘
    └── vm-sim-2  SHARD 4,5,6,7

Managed Postgres (com réplica de leitura para os rankings)
```

**Custo estimado, ~5.000 simultâneos:** 2 gateways + 2 sims (CPX41) + LB + Postgres gerenciado
≈ **€120–160/mês**. Continua abaixo do que uma configuração equivalente custaria na AWS.

Os rankings já leem o Postgres direto com cache de 10 s — mande-os para a réplica de leitura e o
primário fica só com escrita.

---

## Por que NÃO multi-região (e quando mudar de ideia)

É um jogo idle: o tick é de 250 ms e o combate é resolvido no servidor. 200 ms de latência do
Brasil para a Alemanha não são perceptíveis no que este jogo faz.

O que **é** perceptível é o download inicial de assets — e disso cuida o Cloudflare, que serve os
sprites do ponto mais próximo do jogador de graça.

Mude de ideia quando o **PvP em tempo real** virar competitivo de verdade. Aí a conta muda: o
estado da arena teria de morar perto dos jogadores, e é aí que Fly.io (ou uma segunda região na
Hetzner + roteamento por latência) passa a valer o trabalho.

---

## Resumo em uma linha por fase

| Fase | Jogadores | Forma | Custo/mês |
|---|---:|---|---:|
| 1 | até ~500 | 1 VPS, `ROLE=all` | **~€9** |
| 2 | ~500–2.000 | 1 VPS, gateway + N sims | ~€15 |
| 3 | 2.000–10.000 | LB + 2 gw + 2 sim + Postgres gerenciado | ~€150 |

O caminho entre elas é **variável de ambiente**, não reescrita. Foi para isso que o `ROLE` e o
`SHARD_COUNT` existem desde o começo.

---

## A lista curta antes de abrir para o público

- [ ] `AUTH_SEGREDO` de verdade no `.env` (senão as sessões caem a cada deploy)
- [ ] **Fechar o `hello` do WebSocket** — hoje ele aceita nick puro, então conta com senha ainda
      não protege o personagem. Veja [AUTENTICACAO.md](AUTENTICACAO.md), última seção. **Este é o
      item que eu não deixaria passar.**
- [ ] Backup do Postgres testado (restaure num banco vazio uma vez)
- [ ] Cloudflare com proxy ligado, WebSockets on, `/assets/*` cacheado
- [ ] `CARTEIRA_CHAVE_PRIVADA` **fora** do `.env` do servidor de jogo — idealmente num processo
      separado só com `ORBS_WORKER=1` (veja o cabeçalho de `chain.mjs`)
- [ ] UptimeRobot no `/saude`
- [ ] Um segundo par de olhos no fluxo de saque de ORB antes de ligar a mainnet
