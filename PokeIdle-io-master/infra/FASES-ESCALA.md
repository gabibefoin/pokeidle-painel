# Fases de escala — tim tim por tim tim

Guia operacional do PokeIdle: **quando** escalar, **o que** muda, **quanto** aguenta e **o que** fazer
no dia. Números medidos em produção em **15/09/2026** (somente leitura) e em cluster isolado no mesmo
dia. Quando o texto e a máquina discordarem, vale a máquina — e a seção "Como medir" diz onde olhar.

---

## Onde estamos (15/09/2026)

| | |
|---|---|
| Máquina | Vultr, Miami — 4 vCPU (AMD EPYC Milan, dedicadas: 0% de steal) / 8 GB / 75 GB, swap de 4,8 GB |
| Fase | **2a** — 1 gateway + 2 sims, Postgres e Redis na rede do host (sem docker-proxy) |
| Na frente | Cloudflare com Authenticated Origin Pulls; porta 80/443 só para faixas do Cloudflare |
| Versão | v1.90.4 |
| Jogadores **reais** | ~1.160–1.180 às 17h de Brasília (o `/saude` público mostrava ~1.650) |
| Tick | 48–59 ms com ~580 jogadores por sim (orçamento: 250 ms) |
| Carga | load 2,6 de 4 · 3,6 GB de RAM disponível de 7,9 |

**Próximo passo decidido:** **upgrade da mesma VPS** (Change Plan na Vultr, como foi de 2 para 4 vCPU)
para **16 vCPU / 32 GB / 300 GB / 8 TB**, rodando a **Fase 2e** — para chegar a ~10 mil jogadores.
Os limites de 20 e 50 mil ficam no fim deste documento.

---

## Glossário

| Termo | O que é, em português claro |
|-------|-----------------------------|
| **Processo Node** | Um `node src/server/index.mjs` rodando. A parte pesada de cada um usa **um núcleo**. |
| **Sim** | Processo que **simula o jogo** (caça, combate, loot, flush no Postgres). É onde mora a CPU. |
| **Shard** | **Pedaço dos jogadores.** Cada um cai num shard pelo nick: `fnv1a(nick) % SHARD_COUNT`. 1 sim ↔ 1 shard. |
| **Gateway** | Processo que **só fala com o navegador**: WebSocket, login, arquivos, `/saude`. Escala com **conexões abertas**. |
| **Caddy** | O servidor na porta 443: TLS com o Cloudflare e repartição entre gateways. Multi-thread. |
| **Redis** | "Correio" entre processos: comando do gateway → sim certo, resposta → gateway certo, chat para todos. Guarda presença, filas e travas — **perder não perde progresso**. |
| **Postgres** | Banco verdade (contas, pokémon, gemas, mercado). O sim grava cada jogador a cada 5 s (write-behind). |
| **Compressão com contexto** | O `permessage-deflate` do WebSocket lembrando das mensagens anteriores. `WS_DEFLATE_CONTEXTO=1`. Ver "A banda". |
| **Rajada de reconexão** | Todo mundo de um gateway voltando ao mesmo tempo depois de um reinício. Ver a Fase 2e. |

### Por que "só aumentar o plano" não basta

Node simula numa thread só. **Máquina maior só vira jogador com mais processos**: mais sims
(`--fase`) e mais gateways (`--gateways`). O upgrade de plano e a troca de fase andam juntos.

---

## Como medir (e o que NÃO usar)

- **Jogadores e tick de verdade:** `redis-cli -p 6380 HGETALL metricas` — cada sim publica os seus.
  O `/saude` público **infla** `online` e `porShard` com o acréscimo do painel (`inflarJogadoresPorShard`).
- **CPU por processo:** `pidstat -u -r -C 'node|caddy|redis-server|postgres' 30 1`. Um `node` perto de
  100% é o teto DELE, mesmo com a máquina folgada.
- **Banda:** `/sys/class/net/<iface>/statistics/tx_bytes` em duas leituras com 60 s de intervalo,
  dividido pelos jogadores reais. O mês fechado está no painel da Vultr.
- **Conexões do Postgres por processo:** `SELECT application_name, count(*) FROM pg_stat_activity GROUP BY 1`
  (os processos se identificam desde 15/09/2026: `pokeidle-sim-3`, `pokeidle-gateway-8081`…).
- **Tudo junto:** `sudo bash infra/diagnostico.sh`.

| Sinal | Bom | Amarelo | Agir |
|---|---|---|---|
| tick de um sim (Redis) | < 100 ms | 100–150 ms | **> 150 ms** no pico |
| `node` no pidstat | < 65% | 65–80% | **> 80%** sustentado |
| CPU da máquina | < 65% | 65–75% | **> 75%** no pico |
| RAM disponível | > 6 GB | 4–6 GB | **< 4 GB** |
| banda do mês (projeção) | < 6 TB | 6–8 TB | **> 8 TB** |

---

## O que muda com mais shards

| Sistema | Com vários sims |
|---------|-----------------|
| Caça, loot, XP, mercado, gemas, diamantes, rankings, chat global | ✅ Normal |
| PvP de Guild (guerra automática) | ✅ Normal — um processo só roda a guerra do dia (`reivindicarEvento`) |
| PvP ranqueado | ✅ Normal — fila no Redis, pareamento no `ARENA_SHARD_ID` |
| **Praça do Centro Pokémon** | ⚠️ Cada um só vê quem está no **mesmo shard** — mais shards, praça mais vazia |

Mudar o `SHARD_COUNT` redistribui **todos** os jogadores: é com o jogo parado. Por isso vale escolher
o número da fase com folga.

---

## Medição de 15/09/2026 — o custo de cada peça

Produção, ~1.170 jogadores reais, média de 30 s. Por **1.000 jogadores reais**:

| Peça | Núcleos / 1.000 | RAM medida | Teto confortável de UM processo |
|------|----------------:|------------|--------------------------------|
| sim | **0,53** | ~700 MB com ~580 jogadores | ~1.000–1.200 jogadores (tick ~90–110 ms); ~0,09 ms de tick por jogador |
| gateway | **0,32** | 683 MB com 1.145 sockets | ~2.000 sockets (~65% de um núcleo, já com a compressão com contexto) |
| Caddy (TLS) | **0,21** | 555 MB (~0,47 MB por jogador) | multi-thread |
| Postgres | **0,11** | 1 GB de cache + ~30 conexões | 231 escritas/s em `players`, WAL 0,65 MB/s, banco inteiro 1,1 GB |
| Redis | **0,02** | 12 MB | single-thread, muito longe do teto (159 op/s) |
| **Total** | **~1,18** | | |

Em 14/09/2026 a mesma conta dava **~2,2 núcleos por 1.000**: o docker-proxy sozinho gastava 0,32 e o
código ainda não tinha as otimizações da v1.90.1. O "teto de ~6 mil do Redis" daquela medição vinha
desse custo inflado e não vale mais.

Outros números do dia: conexões do Postgres no pico de 30 s = 30 (4 do gateway, 10–11 por sim) contra
`max_connections` de 100 · arquivos abertos do gateway 524.288 · conntrack 3.967 de 262.144 · 69
commits/s.

---

## A banda — o limite que chega primeiro

Com 8 TB por mês, **a banda acaba antes da CPU e da RAM**. Os números:

| Produção, 15/09/2026, 60 s | |
|---|---|
| Saída da máquina | **3,78 MB/s** (30 Mbit/s) para ~1.175 jogadores = **11,1 MB/h por jogador** |
| Pacotes | 4.438/s — **3,8 por jogador**, praticamente um por tick de 250 ms |
| WebSocket (conexões longas, gateway → Caddy) | 3,12 MB/s — **83%** |
| Conexões novas (welcome, HTTP) | 0,14 MB/s — 4% |
| TLS e cabeçalhos TCP/IP | ~0,52 MB/s — 14% |

Uma caçada medida no cluster (clone de um jogador real, 218 pokémon, `delta: 1`) dá **5,2 MB/h** no
socket; produção dá quase o dobro porque soma boss, PvP, painéis, chat e reconexões. Nessa caçada,
**93% dos bytes eram mensagens menores que 1 kB, que o gateway mandava sem compressão**.

### A compressão com contexto (`WS_DEFLATE_CONTEXTO=1`)

Cada mensagem passa a aproveitar o que as anteriores ensinaram ao compressor, e o `ws` comprime todas.
Medido no fio, em cluster isolado, com o mesmo clone de jogador caçando 180 s com e sem a variável
(e conferido com o próprio compressor do `ws` sobre as mesmas mensagens, que deu 0,84):

| | Sem contexto (hoje) | Com contexto |
|---|---:|---:|
| Banda do socket, jogador caçando (medido no fio) | 5,21 MB/h | **0,86 MB/h (−84%)** |
| CPU a cada 1.000 sockets | — | +~0,05 núcleo |
| RAM a cada 1.000 sockets | — | +~120 MB |
| Fila do zlib (p99), 1.000 / 3.000 sockets num processo | 1,1 / 2,3 ms | 5,7 / 19,7 ms |

**O jogo não muda:** as mensagens são as mesmas, quem descomprime é o navegador, e o `app.js` antigo
em cache funciona igual. Com a variável ligada, os testes do socket, do anti-bot e do mercado passaram
inteiros. `UV_THREADPOOL_SIZE=8` foi testado e não melhorou a fila — fica o padrão.

### Quanto os 8 TB aguentam

| | MB/h por jogador | 8 TB cobrem, **em média online no mês** |
|---|---:|---:|
| Hoje | 11,1 | **~990** |
| Com contexto (estimado: −80% só na parte do WebSocket) | ~3,2 | **~3.400** |

A estimativa com contexto precisa ser **confirmada em produção** (ver o upgrade, passo 3). A média do
mês é bem menor que o pico — o painel da Vultr mostra quanto o mês atual já gastou, e é essa razão
pico/média que decide a conta. Com 10 mil de pico e média de 5–6 mil, são **~12–14 TB/mês**: ou se
paga o excedente, ou se ataca a próxima alavanca.

### A próxima alavanca (não implementada)

**Aba em segundo plano.** Jogo idle fica horas com a aba escondida, e quem não está olhando não
precisa das animações do campo (40% da banda da caçada) nem dos eventos de batalha. O cliente avisaria
a visibilidade, o sim pararia de mandar esses pacotes e reenviaria a cena ao voltar. Não dá para
estimar o ganho sem antes contar quantas abas estão escondidas — o primeiro passo é essa contagem.

### O que foi medido e descartado

| Ideia | Por que não |
|---|---|
| Chaves curtas no JSON ("r: s") | −18% sozinhas, só +4 pontos em cima do contexto; exigiria tradução no sim e no cliente, com risco de quebrar cliente em cache |
| Protocolo binário | Mesma história das chaves curtas: o contexto já leva quase todo o ganho |
| Juntar as mensagens de um tick | Já sai ~1 pacote por tick |
| `UV_THREADPOOL_SIZE=8` | Não melhorou a fila do zlib |

---

## FASE 2e — até ~10 mil jogadores na 16 vCPU / 32 GB

### O desenho

```
Cloudflare (AOP) ──► Caddy :443 ──► 6 gateways  :8080–8085  (~1.670 sockets cada, com contexto)
                                         │
                                       Redis :6380  (barramento, presença, filas)
                                         │
                                    10 sims  (~1.000 jogadores cada, tick ~90–100 ms)
                                         │
                                    Postgres :5433  (docker-compose.escala.yml)
```

```bash
sudo bash infra/configurar-fase.sh --fase 2e --gateways 6
```

**Por que 10 sims e não 12:** o tick de ~90–100 ms é fluido (40% do orçamento), a praça do Centro fica
com mais gente por shard, e são menos processos disputando RAM e conexões. A `--fase 2f` (12 sims)
existe se o tick passar de 150 ms no pico.

### O orçamento com 10 mil (projeção linear da medição de 15/09/2026)

A medição foi **nesta mesma máquina** (AMD EPYC Milan, vCPU dedicada, 0% de steal), e o upgrade mantém
o tipo de CPU: a projeção vale direto. Cada vCPU é uma thread (duas por núcleo físico) — perto de 80%
de uso as threads irmãs começam a disputar o mesmo núcleo, e é por isso que 10 mil é o teto.

| | CPU (núcleos) | RAM |
|---|---:|---:|
| 10 sims | 5,3 | ~10,5 GB |
| 6 gateways (com contexto) | 3,7 | ~6,8 GB |
| Caddy | ~2,1 (deve cair: o contexto reduz os bytes a cifrar) | ~4,7 GB |
| Postgres | 1,1 | ~3,5 GB |
| Redis + sistema | 0,2 | ~2 GB |
| **Total** | **~12,4 de 16 (~78%)** | **~27,5 de 32 GB (~86%)** |

| Conexões do Postgres | |
|---|---|
| 10 sims × 20 (`PG_POOL_MAX` no unit) | 200 |
| 6 gateways × 10 | 60 |
| `max_connections` (`docker-compose.escala.yml`) | 300 — sobram 40 para backup, psql e ferramentas |

**Leitura honesta:** ~8–9 mil com folga; **10 mil é o teto desta máquina**, e a RAM aperta antes da
CPU (o swap de 4,8 GB que já existe é a rede de segurança contra um OOM-kill). Passando de ~8,5 mil
sustentados, comece a Fase 3.

### O que acompanha no código (15/09/2026)

| Mudança | Onde | Efeito na máquina de hoje |
|---|---|---|
| Compressão com contexto por variável | `gateway.mjs`, `WS_DEFLATE_CONTEXTO=1` | nenhum até ligar |
| Pool do Postgres por processo + nome da conexão | `db.mjs`, `config.mjs`, `PG_POOL_MAX` | nenhum (padrão 25, como antes) |
| Pools de 20 (sim) e 10 (gateway) | `infra/systemd/pokeidle-sim@` e `pokeidle-gateway@` | só quando o `configurar-fase.sh` reinstala os units |
| Postgres para 32 GB | `game/docker-compose.escala.yml` (arquivo à parte) | nenhum — só vale com o `COMPOSE_FILE` que o inclui |
| Gateway fecha os sockets com **1012** no SIGTERM | `encerrar-gateway.mjs` | todo deploy |
| Cliente sorteia a volta: 0,8–2,5 s (rede) · 1–15 s (reinício) · dobra a cada falha até 30 s | `shared/reconexao.mjs` | todo deploy |
| Gateways reiniciam **um de cada vez** (`PAUSA_ENTRE_GATEWAYS`, 15 s) | `infra/reiniciar-servicos.sh` | nenhum com gateway único |
| Sims reiniciam **antes** dos gateways, e o script espera a métrica nova de cada um (16/09/2026) | `infra/reiniciar-servicos.sh` | todo deploy |
| Migrações de boot em fila no cluster (`travarMigracoes`, trava de sessão do Postgres) | `db.mjs`, `sim.mjs`, `gateway.mjs` | todo deploy — ~2,5 s para os dez sims |
| Fases 2e (10 sims) e 2f (12 sims) | `infra/configurar-fase.sh` | — |

**Por que o `docker-compose.escala.yml` é um arquivo à parte:** o `deploy.sh` roda `docker compose up -d`
em todo deploy, e qualquer mudança no `command` do Postgres recria o container — o banco reinicia no
meio de um deploy comum. Assim o banco só muda quando o `.env` passa a incluir o arquivo, na janela do
upgrade, com o jogo parado.

**Deploy e rajada de reconexão.** Em 15/09/2026, os dois deploys da madrugada deram **1.430 e 2.497
"hello lento"** (login de 3 a 6 s) com ~1.100 jogadores: o gateway morria sem aviso e todo mundo voltava
no mesmo segundo. Agora o gateway fecha com 1012, o cliente espalha a volta por até 15 s (com 10 mil,
~770 logins/s no pico em vez de 10 mil de uma vez) e os gateways reiniciam em sequência. Um deploy
com 6 gateways leva ~2 minutos a mais — é o preço de ninguém ficar numa fila de login.

---

## Upgrade para a Fase 2e, passo a passo (a mesma VPS)

É um **Change Plan** na Vultr, como foi de 2 para 4 vCPU: **mesmo IP, mesmo disco, mesmo banco, mesmo
`.env`**. Nada muda no Cloudflare, no GitHub, nos webhooks, no OAuth nem no backup. O que muda é o que
roda dentro: de 1 gateway + 2 sims para 6 gateways + 10 sims.

A máquina de hoje (EPYC Milan, 4 vCPU dedicadas, 75 GB) é da família da 16 vCPU / 32 GB / 300 GB —
confira se ela aparece em **Settings → Change Plan**. **É só ida:** a Vultr não volta para um plano de
disco menor.

### Antes (dias antes, sem pressa)

1. **Deploy do código novo**, com o jogo como está. Nada liga sozinho; para os jogadores muda só a
   reconexão sorteada e o fechamento com 1012.
2. **Conferir o SIGTERM do gateway** (não é testável no Windows):
   ```bash
   sudo systemctl restart pokeidle-gateway && sudo journalctl -u pokeidle-gateway -n 30 --no-pager | grep 1012
   ```
   Tem de aparecer `[gateway] SIGTERM: N socket(s) fechados com 1012 — saindo`.
3. **Compressão com contexto por 24 h nesta máquina** — há folga (3,6 GB livres; o custo é ~+140 MB e
   ~+0,06 núcleo com 1.150 jogadores): `WS_DEFLATE_CONTEXTO=1` no `.env` e
   `sudo systemctl restart pokeidle-gateway`. Anote a banda por jogador antes e depois (ver "Como medir")
   — é esse número que substitui a estimativa de ~3,2 MB/h. Para desligar: tirar a linha e reiniciar o
   gateway, sem deploy.
4. **No painel da Vultr:** a franquia de banda e o preço do excedente do plano novo, e quanto o mês
   atual já gastou.

### Na janela (~15–20 min — avisar no Discord antes)

5. **Snapshot** da VPS no painel da Vultr. O backup de hora em hora no Drive continua, mas o snapshot
   devolve a máquina inteira.
6. **Parar o jogo** — os sims gravam todo mundo antes de sair (até 90 s):
   ```bash
   sudo systemctl stop pokeidle-gateway pokeidle-sim@0 pokeidle-sim@1
   ```
7. **Change Plan** para 16 vCPU / 32 GB. A Vultr reinicia a VPS.
8. Na volta, o systemd sobe a Fase 2a de hoje sozinho. **Pare de novo** antes de mexer no banco (o
   passo 10 recria o container do Postgres):
   ```bash
   sudo systemctl stop pokeidle-gateway pokeidle-sim@0 pokeidle-sim@1
   ```
9. **Conferir o hardware:** `nproc` = 16 · `free -g` ≈ 31 · `df -h /` ≈ 300 G. Se o disco continuar em
   75 G: `sudo growpart /dev/vda 2 && sudo resize2fs /dev/vda2`.
10. **Postgres para 32 GB:** no `/opt/pokeidle/game/.env`, trocar a linha do compose por
    ```
    COMPOSE_FILE=docker-compose.yml:docker-compose.host.yml:docker-compose.escala.yml
    ```
    e rodar `cd /opt/pokeidle/game && docker compose up -d` (recria só o container; os dados ficam no
    volume). Conferir no `psql`: `SHOW max_connections` = 300 e `SHOW shared_buffers` = 2GB.
11. **Fase 2e:**
    ```bash
    sudo bash /opt/pokeidle/infra/configurar-fase.sh --fase 2e --gateways 6
    ```
    Instala os units, sobe 6 gateways e 10 sims e reconfigura o Caddy (o Caddyfile anterior fica salvo
    ao lado, com data no nome).
12. **Conferir:** `redis-cli -p 6380 HGETALL metricas` com 10 sims · `curl -s localhost:8080/saude` com
    `"shards":10` · de fora: login (senha, Google, Discord), caça, mercado, compra de diamante, chat.

### Rollback

- **Compressão:** tirar `WS_DEFLATE_CONTEXTO` do `.env` e reiniciar os gateways. Sem deploy.
- **Fase:** `sudo bash infra/configurar-fase.sh --fase 2a` volta a 1 gateway + 2 sims na máquina grande
  (com o jogo parado — redistribui os jogadores de novo).
- **Postgres:** tirar o `docker-compose.escala.yml` do `COMPOSE_FILE` e `docker compose up -d`.
- **Plano:** não volta (disco maior). O snapshot do passo 5 devolve a VPS como estava — mas perde o que
  foi jogado depois dele.

### Nos primeiros dias

- `pidstat` no pico: nenhum `node` acima de 80%; tick dos sims abaixo de 150 ms no Redis.
- `SELECT application_name, count(*) FROM pg_stat_activity GROUP BY 1` abaixo de 240 no total.
- `free -g`: disponível acima de 4 GB. Se o Caddy crescer demais, `GOMEMLIMIT` no unit dele segura o GC.
- Painel da Vultr: projeção do mês contra os 8 TB.
- Num deploy com gente online: o `journalctl` sem rajada de "hello lento".

---

## FASE 3 — 10 a 20 mil jogadores

Uma máquina não basta. Três, na rede privada da Vultr (VPC):

| Máquina | O que roda | CPU com 20 mil |
|---|---|---:|
| **Borda** (16 vCPU) | Caddy + 10–12 gateways | ~11 núcleos |
| **Jogo** (16 vCPU) | 20 sims | ~10,5 núcleos |
| **Dados** (8 vCPU, 32 GB) | Postgres + PgBouncer + Redis | ~2,5 núcleos |

A VPS de hoje, já com 16 vCPU, pode virar uma delas. O que precisa antes:
- scripts de fase para várias máquinas (o `configurar-fase.sh` de hoje assume uma só, e até 8 gateways);
- Redis com senha, ouvindo só na VPC; Postgres idem;
- `SHARD_COUNT` de 20–24 já na entrada (uma redistribuição só);
- `idx_players_seen` fora (61 MB, 24 leituras em produção, e atualizado em todo flush) e as escritas de
  `players` revistas — hoje 0,02% delas são HOT update;
- a alavanca da aba em segundo plano, se a banda estiver cara.

Banda: com contexto e média de ~12 mil online, ~28 TB/mês.

---

## FASE 4 — até 50 mil jogadores

| Peça | Com 50 mil |
|---|---|
| Borda | 3 máquinas (Caddy + gateways), repartidas pelo Cloudflare Load Balancing |
| Jogo | 3 máquinas, ~50–60 sims |
| Barramento | **NATS** no lugar do pub/sub do Redis — com 50 mil o Redis passaria de 1 núcleo numa thread só, sem folga para pico |
| Redis | só presença, travas e filas |
| Postgres | primário dedicado + réplica para rankings e painel + PgBouncer |
| Praça do Centro | com ~50 shards fica vazia — decidir se vira uma praça global (`ROLE=centro`) |
| Banda | ~70 TB/mês com média de 30 mil, com contexto |

Ordem de grandeza: 8–9 máquinas, mais a banda. Custo a recalcular com os preços do dia.

---

## Resumo

| Fase | Jogadores reais | Máquina(s) | Processos | Observação |
|------|----------------|------------|-----------|-----------|
| **2a** (hoje) | até ~1.800 | 4 vCPU / 8 GB | 1 gw + 2 sims | banda: ~990 de média mensal nos 8 TB sem contexto |
| **2e** | até ~10 mil (folga até 8–9 mil) | a mesma VPS, 16 vCPU / 32 GB | 6 gw + 10 sims | RAM é o primeiro teto; banda com contexto: ~3.400 de média nos 8 TB |
| **2f** | igual à 2e, tick menor | 16 vCPU / 32 GB | 6 gw + 12 sims | só se o tick passar de 150 ms |
| **3** | 10–20 mil | 3 máquinas na VPC | 12 gw + 20 sims | scripts multi-máquina, Postgres/Redis dedicados |
| **4** | até 50 mil | 8–9 máquinas | ~25 gw + ~55 sims | NATS, réplica, PgBouncer, praça global |

---

## Script

```bash
# Ver o que faria (não muda nada):
sudo bash /opt/pokeidle/infra/configurar-fase.sh --fase 2e --gateways 6 --dry-run

# Aplicar (para os serviços, instala os units, sobe gateways + sims, reconfigura o Caddy):
sudo bash /opt/pokeidle/infra/configurar-fase.sh --fase 2e --gateways 6

# Voltar à Fase 1:
sudo bash /opt/pokeidle/infra/configurar-fase.sh --fase 1
```

Requer: backup feito, `.env` intacto, `docker compose up -d` ok. Deploys seguintes:
`infra/reiniciar-servicos.sh` (o `deploy.sh` já chama) reinicia os sims, espera cada um publicar métrica
nova e só então reinicia os gateways, um de cada vez. `DRY_RUN=1` mostra o que ele faria sem reiniciar
nada — rode assim na VPS, como o usuário do jogo, antes de mexer no script.

**O deploy de 16/09/2026 (v1.107.2) ensinou duas coisas.** (1) O script chamava `npm run stop`, que
fazia `pkill` em TODOS os processos das unidades — os seis gateways e os dez sims no mesmo segundo — e
apagava as travas de shard e a do worker de saque com os processos velhos ainda gravando; agora só
morre processo fora do systemd. (2) Com os dez sims subindo juntos, a DDL de boot corre em paralelo e
estoura (`already exists`): o `guild-db.mjs` derrubou dois sims, que ficaram ~17 s fora esperando a
própria trava de shard. Agora as migrações passam em fila pela trava do Postgres, a migração da guild
só mexe na chave quando precisa, e um sim que falha no boot solta a trava do shard antes de morrer.
`npm run test:migracoes` reproduz a corrida (sem a trava) e prova a fila (com ela).

---

## FAQ

**Só dobrar o plano resolve?** Não — são mais processos, não um processo maior. O upgrade vem junto
com a troca de fase.

**Shard é o jogador ir para outro servidor?** É um número fixo pelo nick. O gateway manda para o sim
certo pelo Redis; o jogador não escolhe e não percebe.

**Perde progresso no upgrade?** Não — o disco e o banco são os mesmos, e os sims gravam todo mundo antes
de parar. São ~15–20 min fora do ar e todo mundo reconecta.

**E o PvP?** Guerra de Guild e PvP ranqueado funcionam com qualquer número de shards.

**A compressão com contexto muda alguma coisa para o jogador?** Não. Mesmas mensagens, 5 a 20 ms a mais
de fila no servidor, num tick de 250 ms.

---

Ver também: [HOSPEDAGEM.md](../game/HOSPEDAGEM.md), [LEIA-ME.md](LEIA-ME.md), [BACKUP.md](BACKUP.md).
