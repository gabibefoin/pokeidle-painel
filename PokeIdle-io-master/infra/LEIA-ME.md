# Subir o Pokéidle

Do zero ao jogo no ar, com deploy automático a cada push. São ~40 minutos, e a maior parte é
esperar download.

Os scripts aqui servem para **qualquer VPS Ubuntu** — Vultr, Hetzner, Linode, o que for. Nada
neles é específico de provedor.

O que está aqui:

| arquivo | o que é |
|---|---|
| `provisionar.sh` | máquina crua → pronta. Roda uma vez, como root |
| `deploy.sh` | atualiza o jogo e confere que voltou vivo. É o que o CI chama |
| `pokeidle.service` | o systemd |
| `Caddyfile` | TLS automático + proxy de WebSocket |
| `../.github/workflows/deploy.yml` | push no master → deploy |

---

## 1. A máquina

### Que tamanho

**2 vCPU / 4 GB é o suficiente para abrir**, e por um bom tempo depois.

Node é single-thread: com `ROLE=all`, a simulação inteira roda em **um processo, ou seja, um
núcleo**. Núcleo a mais só entra no jogo quando você separar em vários `ROLE=sim` — que é a
Fase 2 do [HOSPEDAGEM.md](../game/HOSPEDAGEM.md) e vem com o aviso de que a praça do Centro e a
arena PvP quebram entre shards.

O que aperta primeiro é **RAM**: Node + Postgres + Redis dividem a caixa. O load test segurou
2000 jogadores num processo só, então 4 GB não é aperto — é folga.

### Onde

Pela latência (ver a tabela em [HOSPEDAGEM.md](../game/HOSPEDAGEM.md)):

- **São Paulo** se a base é brasileira — ~20 ms, e é a única tela do jogo com teclado (a praça)
  que sente isso.
- **Miami** se a ideia é público global — é o único ponto que não é ruim em lugar nenhum
  (BR ~110 ms, EUA ~30 ms, Europa ~110 ms).

### Quanto custa

> ⚠️ **Confira o preço no site do provedor antes de contratar.** Os números abaixo são de
> agosto de 2026 e este mercado mexeu MUITO no ano: a Hetzner reajustou os EUA duas vezes em
> 2026 (abril, e de novo em 15 de junho com multiplicador de ~3× no CPX31), o que a tirou de
> "a mais barata" para "a mais cara da lista" fora da Europa.

Para 2 vCPU / 4 GB:

| provedor | preço/mês | tem São Paulo? | tem Miami? |
|---|---|---|---|
| **Vultr** Regular | **~$20** | sim | sim |
| Linode / Akamai | ~$24 | sim | sim |
| Hetzner CPX21 (EUA) | ~$37 | não | não |
| Hetzner CPX21 (Europa) | ~€8 | não | não |

A Hetzner continua imbatível **na Europa** — o reajuste pesado foi só nos EUA. Se a latência do
Brasil não te importar, ela ainda é a mais barata por larga margem.

### Criando

No painel do provedor:

| campo | valor | por quê |
|---|---|---|
| Região | **São Paulo** ou **Miami** | ver acima |
| Imagem | **Ubuntu 24.04** | é o que o `provisionar.sh` assume |
| Tamanho | **2 vCPU / 4 GB** | ver acima |
| IPv4 | **sim** | costuma ser cobrado à parte, e você precisa dele |
| Chave SSH | **a sua** | o `provisionar.sh` fecha o acesso por senha |
| Backup | **ligado** | uns 20% a mais para poder voltar a máquina inteira |

Anote o IP que aparecer.

> **Tráfego:** pelo que foi medido (`game/HOSPEDAGEM.md`), a projeção é ~1,2 TB/mês com 100
> jogadores simultâneos. Praticamente todo plano dessa faixa inclui 2–3 TB, então dá folga — mas
> confira o que o seu plano inclui e a que preço fica o excedente.

## 2. O DNS

No seu registrador, dois registros apontando para o IP:

```
A     pokeidle.io       <ip>
A     www.pokeidle.io   <ip>
```

**Se for usar Cloudflare, comece com a nuvem CINZA (DNS only).** O Caddy precisa de um acesso
direto na porta 80 para tirar o primeiro certificado; com a nuvem laranja ligada antes disso, o
desafio do Let's Encrypt não fecha e você fica meia hora sem entender por quê. Depois que o
`https://` estiver funcionando, aí sim liga a nuvem laranja e põe o SSL em **Full (strict)**.

Espere propagar antes de seguir (`ping pokeidle.io` tem de devolver o IP certo).

## 3. Provisionar

Do seu computador, na raiz do repositório:

```bash
ssh root@<ip> "DOMINIO=pokeidle.io bash -s" < infra/provisionar.sh
```

Instala Node 22, Docker, Caddy e fail2ban; cria o usuário `pokeidle`; clona o repositório em
`/opt/pokeidle`; fecha o firewall deixando só 22, 80 e 443; e registra o serviço.

**A porta 8080 do jogo fica fechada para fora** — quem fala com ela é o Caddy, por localhost.

**E tranca o SSH:** desliga o login por senha e deixa root só por chave. Isso importa mais do que
parece — uma máquina recém-criada com senha de root num IP público começa a receber tentativa de
invasão em minutos, antes mesmo de você terminar de configurá-la. **Rode este passo logo depois
de criar a instância, não no fim da tarde.**

> O script só desliga a senha se já houver chave em `/root/.ssh/authorized_keys` — sem essa
> guarda, uma máquina criada sem chave ficaria inacessível para sempre. Se ele avisar que pulou,
> adicione a chave e rode de novo.

## 4. O `.env`

É o único passo que não dá para automatizar: tem segredo dentro, e segredo não entra em arquivo
versionado.

```bash
ssh root@<ip>
sudo -u pokeidle cp /opt/pokeidle/game/.env.example /opt/pokeidle/game/.env
sudo -u pokeidle nano /opt/pokeidle/game/.env
```

O mínimo para subir:

```bash
AUTH_SEGREDO=<64 hex — gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
URL_PUBLICA=https://pokeidle.io
DATABASE_URL=postgres://poke:poke@localhost:5433/pokeidle
REDIS_URL=redis://localhost:6380
```

E o que faz o resto funcionar (dá para deixar para depois, o jogo sobe sem):

```bash
RESEND_API_KEY=re_...        # sem isto a confirmação de e-mail não trava o cadastro
GOOGLE_CLIENT_ID=...         # o botão só aparece se a chave existir
DISCORD_CLIENT_ID=...
```

> No Google e no Discord, o `redirect_uri` cadastrado tem de bater **caractere a caractere** com
> `https://pokeidle.io/auth/google/retorno`. É o erro nº 1 de OAuth. Ver `game/AUTENTICACAO.md`.

## 5. O primeiro deploy

**Antes** de rodar o deploy na VPS, suba `public/data/` do seu Windows:

```powershell
# na raiz do repo (Windows)
.\infra\deploy-public-data.ps1
```

Isso envia catálogos JSON + `asset-packs/` (sprites .webp). O `deploy.sh` **nunca** baixa
assets da internet — um fetch sobrescreveria sprites do Sprite Lab.

Depois, na VPS:

```bash
sudo -u pokeidle /opt/pokeidle/infra/deploy.sh
```

No fim ele confere o `/saude` sozinho. Abra `https://pokeidle.io` e o jogo tem de estar lá.

## 6. O deploy automático

Na máquina, crie uma chave só para o CI:

```bash
sudo -u pokeidle ssh-keygen -t ed25519 -N '' -C 'github-actions' -f /opt/pokeidle/.ssh/deploy
sudo -u pokeidle sh -c 'cat /opt/pokeidle/.ssh/deploy.pub >> /opt/pokeidle/.ssh/authorized_keys'
sudo -u pokeidle cat /opt/pokeidle/.ssh/deploy          # a PRIVADA, vai para o GitHub
ssh-keyscan -t ed25519 <ip>                              # a impressão digital do servidor
```

No GitHub → **Settings → Secrets and variables → Actions**, e também
**Settings → Environments → New environment → `producao`**:

| secret | valor |
|---|---|
| `SSH_CHAVE` | o conteúdo de `deploy` (a chave **privada**, inteira, com as linhas de BEGIN/END) |
| `SSH_HOST` | o IP da máquina |
| `SSH_USUARIO` | `pokeidle` |
| `SSH_HOST_KEY` | a saída do `ssh-keyscan` |
| `DOMINIO` | `pokeidle.io` |

Daí em diante, **push no `master` implanta sozinho**. O workflow ignora mudanças que só tocam
`.md` e PNG de teste.

Se quiser um freio de mão, marque *Required reviewers* no ambiente `producao`: aí todo deploy
espera você aprovar no GitHub.

### O que acontece quando um deploy dá errado

O `deploy.sh` reinicia e espera 40 s pelo `/saude`. Se não responder, ele **volta sozinho para o
commit anterior**, reinstala e sobe de novo. O Actions fica vermelho e o jogo continua no ar na
versão que funcionava.

**Deploy verde mas versão antiga no ar?** Confira se o commit já estava na VPS (`já está em … —
nada a fazer` no log do deploy). Na **Fase 2** (gateway + sims), se o Actions falhar em
`reiniciar`, rode na VPS: `sudo bash /opt/pokeidle/infra/atualizar-sudoers-deploy.sh`.

Se quiser voltar na mão a um commit específico: **Actions → deploy → Run workflow**, e ponha o
SHA no campo.

### E os jogadores online durante o deploy?

Sentem um piscar. O `systemctl restart` manda SIGTERM: o sim despeja todo mundo no banco e solta a
trava do shard antes de sair (`sairLimpo`, em `sim.mjs`), e o gateway fecha cada socket com **1012**
(`encerrar-gateway.mjs`). O cliente reconhece o reinício e volta num instante sorteado entre 1 e 15 s
(`shared/reconexao.mjs`) — os sims reiniciam primeiro e, com eles de pé, os gateways reiniciam um de
cada vez (`infra/reiniciar-servicos.sh`). Ninguém perde progresso — mas quem estiver no meio de uma luta vai
ver a cena recarregar.

> **Confira isto no primeiro deploy.** O tratamento de SIGTERM **não é testável no Windows**: lá
> o sinal mata o processo sem rodar handler nenhum (é como o Node funciona no Windows), então
> ele só pode ser verificado na máquina de verdade. Depois de subir, com alguém logado:
>
> ```bash
> sudo systemctl restart pokeidle && sudo journalctl -u pokeidle -n 20 --no-pager | grep -A2 SIGTERM
> ```
>
> Tem de aparecer `[sim] SIGTERM: flush final de N jogador(es)…` seguido de `[sim] saída limpa`.
> **Se não aparecer, pare e investigue antes de abrir para o público:** sem isso, todo deploy
> perde até 5 segundos de progresso de todo mundo e deixa a trava do shard presa no Redis até o
> TTL vencer, atrasando a subida do processo novo.

---

## O dia a dia

```bash
# ver o que está acontecendo
sudo journalctl -u pokeidle -f

# estado do cluster (online, shards, tick, eventos/s)
curl -s localhost:8080/saude | jq

# reiniciar na mão
sudo systemctl restart pokeidle

# banco e cache
cd /opt/pokeidle/game && docker compose ps
```

## O que fazer no primeiro dia, não no primeiro incidente

**Backup do Postgres.** O snapshot do provedor cobre a máquina inteira, mas não serve para
"voltar só a tabela de ontem". Um `pg_dump` diário para fora da máquina:

```bash
sudo -u pokeidle crontab -e
# 0 4 * * * cd /opt/pokeidle/game && docker compose exec -T postgres \
#   pg_dump -U poke pokeidle | gzip > /opt/pokeidle/backup-$(date +\%F).sql.gz
```

Mande para um bucket (Backblaze B2 sai ~US$6/TB/mês) e **teste a restauração uma vez**. Backup
não testado não é backup — e aqui tem ORB com lastro em USDT, ou seja, dinheiro de gente.

**Um monitor no `/saude`.** [UptimeRobot](https://uptimerobot.com) grátis já resolve. O
`Restart=always` levanta o processo sozinho, mas não te conta que ele está caindo de dez em dez
minutos.

**Cloudflare cacheando `/assets/*`.** Uma page rule com *Cache Everything* tira os ~38 MB de
primeira carga do seu servidor. Os cabeçalhos certos já saem do gateway (`immutable` de um ano
nos arquivos com hash) — o Cloudflare só precisa respeitá-los.
