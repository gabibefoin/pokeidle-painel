# Backup do banco → Google Drive

De hora em hora, **72 cópias** (3 dias), a mais antiga saindo quando a nova entra. Fora da
máquina, porque backup no mesmo disco não é backup.

O que está aqui:

| arquivo | o que é |
|---|---|
| `backup-drive.sh` | o script. Dump → verifica → sobe → confere → rotaciona |
| `systemd/pokeidle-backup.service` | a unidade que roda o script |
| `systemd/pokeidle-backup.timer` | o relógio: todo minuto `:17` |

---

## Os números, medidos na VPS

Não são estimativa — saíram de `pg_dump` rodando em produção com 1.700 jogadores online:

| | |
|---|---|
| banco `pokeidle` | 386 MB (179 MB de dados + 194 MB de índices) |
| dump `pg_dump \| gzip -6` | **11,6 MiB** em **~2 s**, 84% de um núcleo |
| `gzip -9` | 11,3 MiB em 4,3 s — 3% menor pelo dobro do tempo, não vale |
| 72 cópias, hoje | **0,82 GiB** |
| disco livre na VPS | 54 GiB (não é onde os backups moram, mas é onde o dump passa) |
| Drive | conta grátis, 15 GB dividido com Gmail e Fotos |

Índice não entra em dump: os 194 MB de índice do banco são reconstruídos no restore, e é por
isso que 386 MB de banco viram 11,6 MiB de arquivo.

### O banco cresce — e a pasta guarda 72 fotos dele

Ritmo medido: ~285 jogadores/dia e o `player_gameplay_log` saltando de ~7 mil para **50–60 mil
linhas/dia**. Isso dá ~0,8 MiB/dia no dump, e ~58 MiB/dia na pasta inteira:

| quando | dump | 72 cópias |
|---|---:|---:|
| hoje | 11,6 MiB | 0,82 GiB |
| em 3 meses | ~72 MiB | ~5,1 GiB |
| em 6 meses | ~144 MiB | ~10,1 GiB |
| em 1 ano | ~292 MiB | ~20,5 GiB |

Numa conta grátis de 15 GB (dividida com Gmail e Fotos), isso dá **cerca de 7 meses** antes de
apertar. O script avisa aos **10 GiB** (`ALERTA_GIB`) — cedo o bastante para a decisão não
chegar junto com o "armazenamento cheio".

**O que domina esse crescimento não são os jogadores, são os logs.** Dump sem
`player_gameplay_log` e `player_audit_log`: 5,66 MiB contra 11,6 MiB — **51% de cada cópia são
os dois logs de auditoria**, com cinco semanas de jogo, e nenhum dos dois tem poda no código.
Com uma retenção de 90 dias neles, o dump passa a crescer ~0,2 MiB/dia em vez de 0,8 — e os
7 meses viram **mais de 2 anos** na mesma conta grátis. É a mudança de maior efeito por menor
esforço aqui, e fica como decisão separada: são dados de auditoria e quem decide o prazo é você,
não este script.

---

## Instalar (uma vez)

O passo 2 precisa de navegador, então ele acontece **na sua máquina**, não na VPS.

### 1. rclone na VPS

```bash
ssh root@SEU_SERVIDOR
curl -fsSL https://rclone.org/install.sh | bash
rclone version
```

### 2. O token do Drive — na SUA máquina

A VPS não tem navegador, e o OAuth do Google exige um. O `rclone authorize` existe exatamente
para isso: ele abre o navegador aqui, você aprova, e ele imprime um token para colar lá.

```powershell
# no seu PC (Windows), com o rclone instalado
rclone authorize "drive" --drive-scope drive.file
```

O `--drive-scope drive.file` tem de entrar **aqui**, no `authorize`, e não só no `rclone.conf`
depois: o escopo é decidido na hora em que o Google emite o token. Pôr `scope = drive.file` no
config em cima de um token que já nasceu com acesso total não estreita nada — o token continua
podendo tudo.

Vai abrir o navegador. Aprove com a conta do Drive de 5 TB. No fim ele imprime um bloco assim:

```
{"access_token":"ya29...","token_type":"Bearer","refresh_token":"1//0e...","expiry":"..."}
```

Copie o JSON **inteiro**, incluindo as chaves.

> **Não use Service Account.** Parece o caminho "certo" para servidor e não funciona com Google
> Drive pessoal: a service account tem cota própria de **0 byte**, e mesmo compartilhando uma
> pasta sua com ela os arquivos ficam com dono = service account, então o upload morre com
> `storageQuotaExceeded`. Service account só funciona em Shared Drive do Workspace. Com Google
> One pessoal, o caminho é OAuth da sua conta — que é o que o `authorize` acima faz.

### 2b. O client_id próprio — obrigatório, não opcional

Sem isto o rclone usa o client_id **compartilhado** dele, e avisa em toda conexão: *"being
retired and will stop working during 2026"*. Um backup que morre em silêncio numa data
desconhecida não é backup.

São ~5 minutos no [console.cloud.google.com](https://console.cloud.google.com), e a ordem
importa mais do que parece:

1. **Novo projeto** (`pokeidle-backup`) — e confira que ele fica selecionado no topo
2. **APIs e serviços → Biblioteca** → ative a **Google Drive API**
3. **Tela de permissão OAuth** (que hoje se chama **Google Auth Platform**) → tipo **Externo**
4. Em **Branding**, preencha e-mail de suporte, página inicial, política de privacidade e
   domínio autorizado. **NÃO envie logotipo** — ver o aviso abaixo
5. **Público-alvo** → **Status de publicação: Testando** → **Publicar app** → Confirmar
6. **Credenciais → Criar credenciais → ID do cliente OAuth → App para computador**
7. Baixe o JSON e refaça o passo 2 com ele:

```powershell
$env:RCLONE_DRIVE_CLIENT_ID     = "...apps.googleusercontent.com"
$env:RCLONE_DRIVE_CLIENT_SECRET = "GOCSPX-..."
rclone authorize "drive" --drive-scope drive.file
```

No `rclone.conf`, `client_id` e `client_secret` entram como linhas próprias, ao lado do token.

> #### ⚠️ Publicar não é detalhe: em "Testando", o refresh token vence em 7 DIAS
>
> Este é o erro que só aparece uma semana depois, quando você já acha que resolveu. Um app em
> **Testando** só autoriza contas na lista de testadores — e o token que ele emite **expira em
> sete dias**. Pular o passo 5 dá um backup que roda lindo até o próximo sábado e então morre
> calado.
>
> Publicar resolve os dois, e **não pede verificação nenhuma no nosso caso**. O próprio diálogo
> do Google lista os três gatilhos de verificação: mais de 10 domínios, **um logotipo**, ou
> escopos restritos/confidenciais. Nós temos um domínio, nenhum logo e `drive.file`, que é
> **não sensível** justamente por só enxergar o que o app criou. É a segunda vez que a escolha
> do `drive.file` paga — a primeira foi limitar o estrago de um token vazado.
>
> **Não suba logotipo.** A tela avisa em letra miúda que isso sozinho joga o app numa fila de
> análise de semanas. A tela de consentimento aqui é vista uma vez, por uma pessoa.
>
> Se ao aprovar aparecer **"Acesso bloqueado: … está em fase de testes"** (`403 access_denied`),
> é o passo 5 que não pegou.

> #### Trocar de client_id ZERA a lista de backups visíveis
>
> Com `drive.file`, cada app OAuth só enxerga os arquivos que **ele** criou. O client novo é
> outro app: as cópias feitas pelo anterior continuam no Drive, continuam válidas e continuam
> baixáveis pela web — mas ficam **invisíveis** para o script, e portanto nunca são rotacionadas.
>
> Não é perda de dado, é órfão. Ou você as apaga na interface do Drive, ou guarda a config
> antiga (`rclone.conf.bak`) para alcançá-las:
>
> ```bash
> sudo -u pokeidle env RCLONE_CONFIG=/etc/pokeidle/rclone.conf.bak rclone lsf drive:PokeIdle-Backups
> ```
>
> Vale esperar a fila nova encher antes de apagar as antigas — enquanto ela não tem 72, as
> órfãs são profundidade de graça.

### 3. Colar o token na VPS

O backup roda como o usuário do jogo (`pokeidle`), que já está no grupo `docker`. O config vai
para `/etc/pokeidle/`, e **não** para o `~/.config/rclone` padrão do rclone: o HOME do usuário
`pokeidle` é `/opt/pokeidle`, que é o diretório do repositório — o padrão poria um arquivo com
refresh token dentro de uma árvore de git, de onde ele apareceria em `git status` e viajaria em
qualquer `tar` do diretório.

```bash
ssh root@SEU_SERVIDOR
install -d -m 0700 -o pokeidle -g pokeidle /etc/pokeidle
tee /etc/pokeidle/rclone.conf >/dev/null <<'EOF'
[drive]
type = drive
scope = drive.file
token = {"access_token":"ya29...","token_type":"Bearer","refresh_token":"1//0e...","expiry":"..."}
EOF
chown pokeidle:pokeidle /etc/pokeidle/rclone.conf
chmod 600 /etc/pokeidle/rclone.conf
```

`scope = drive.file` e não `drive`: com ele o rclone só enxerga o que ELE mesmo criou. Se o
token vazar, o que está em risco é a pasta de backups — não o seu Drive inteiro. Por isso o
`--drive-scope` do passo anterior: os dois têm de combinar.

O arquivo precisa ser **gravável** pelo `pokeidle`, e não só legível: o access token do Google
vale uma hora, então o rclone renova e grava o novo aqui a cada rodada. É a razão do
`ReadWritePaths` na unidade do systemd.

Confira que ele fala com o Drive:

```bash
sudo -u pokeidle env RCLONE_CONFIG=/etc/pokeidle/rclone.conf rclone about drive:
sudo -u pokeidle env RCLONE_CONFIG=/etc/pokeidle/rclone.conf rclone mkdir drive:PokeIdle-Backups
```

### 4. As unidades do systemd

```bash
cd /opt/pokeidle
sed -e "s|__USUARIO__|pokeidle|g" -e "s|__DESTINO__|/opt/pokeidle|g" \
  infra/systemd/pokeidle-backup.service > /etc/systemd/system/pokeidle-backup.service
cp infra/systemd/pokeidle-backup.timer /etc/systemd/system/
systemctl daemon-reload
```

### 5. Um ensaio antes de ligar o relógio

```bash
# gera o dump e verifica o gzip, sem subir nem apagar nada
sudo -u pokeidle /opt/pokeidle/infra/backup-drive.sh --seco

# agora de verdade — uma cópia sobe
sudo -u pokeidle /opt/pokeidle/infra/backup-drive.sh

# o que está lá
sudo -u pokeidle /opt/pokeidle/infra/backup-drive.sh --listar
```

### 6. Ligar

```bash
systemctl enable --now pokeidle-backup.timer
systemctl list-timers pokeidle-backup.timer
```

---

## Configuração

Tudo tem padrão que funciona. Para mudar, `/etc/pokeidle-backup.env` (não é versionado, e não
guarda segredo nenhum — o token é do rclone):

```sh
MANTER_HORARIAS=72          # a fila: as N mais recentes (72 = 3 dias)
MANTER_DIARIAS=0            # + a última de cada dia (0 = desligado)
MANTER_SEMANAIS=0           # + a última de cada semana (0 = desligado)
REMOTO=drive:PokeIdle-Backups
ALERTA_GIB=10               # avisa quando a pasta passar disto
ALERTA_WEBHOOK=             # webhook do Discord para gritar quando falhar
```

### A escada, que está desligada

O padrão é fila simples: 72 horárias, três dias. O código faz mais que isso e vem desligado —
ele sabe guardar também a última cópia de cada **dia** e a de cada **semana**:

```sh
MANTER_HORARIAS=48
MANTER_DIARIAS=30
MANTER_SEMANAIS=12
```

Isso dá ~90 arquivos (1,0 GiB hoje) cobrindo **três meses** em vez de três dias, por pouco mais
que os 0,82 GiB da fila atual. A diferença não é espaço, é a pergunta que dá para responder: a
fila responde "quebrou hoje de manhã"; a escada responde "descobri no fim de semana que a
migração de terça comeu dado". Testado: com 60 dias de histórico horário (1.441 arquivos) a
escada manteve 80 e apagou o resto.

O `ALERTA_WEBHOOK` vale o minuto que leva para configurar. **Um backup que falha calado é pior
que não ter backup**, porque dá a sensação de estar coberto: sem ele, um token revogado só
aparece no dia em que você precisar restaurar.

---

## Restaurar

Testado: 0 erros e contagem de linhas idêntica à origem em `players`, `player_pokemon`,
`accounts`, `diamante_ledger` e `market_anuncios`.

```bash
# 1. escolha a cópia
sudo -u pokeidle rclone lsf drive:PokeIdle-Backups | sort | tail -20

# 2. traga para a VPS
sudo -u pokeidle rclone copy drive:PokeIdle-Backups/pokeidle-2026-09-10-0117.sql.gz /var/tmp/

# 3. restaure num banco DESCARTÁVEL primeiro, sempre
docker exec game-postgres-1 psql -U poke -d postgres -c 'CREATE DATABASE restore_teste;'
gzip -dc /var/tmp/pokeidle-2026-09-10-0117.sql.gz \
  | docker exec -i game-postgres-1 psql -U poke -d restore_teste -v ON_ERROR_STOP=1

# 4. confira que o que você precisa está lá
docker exec game-postgres-1 psql -U poke -d restore_teste -c 'SELECT count(*) FROM players;'
```

Só depois de olhar o banco descartável é que se troca o de verdade. E para trocar, **pare o jogo
antes** — o `sim` grava a memória dele no banco a cada 5 s e vai escrever por cima da restauração:

```bash
systemctl stop pokeidle-gateway 'pokeidle-sim@*'
# … renomear/derrubar o banco e restaurar no lugar …
systemctl start pokeidle-gateway 'pokeidle-sim@*'
```

Perde-se no máximo os últimos 5 s de jogo (o `FLUSH_MS`), e o Redis não precisa de restauração:
ele guarda posse de shard e estado quente, não a verdade.

---

## A ordem dos passos, e por que ela é essa

```
1. pg_dump | gzip  →  arquivo de passagem em /var/tmp
2. gzip -t
3. sobe para o Drive (moveto: sobe e apaga o local)
4. pergunta ao Drive se chegou, e se o tamanho bate
5. SÓ ENTÃO apaga as que passarem de 72
```

O arquivo local vive **segundos** e não é retenção: existe para verificar o gzip antes de gastar
rede, e para um upload que falhou poder ser repetido sem cobrar outro dump do banco.

A rotação é a última coisa de propósito, e o passo 4 é o que a autoriza. Numa noite em que a rede
do Drive esteja fora, a ordem invertida gastaria uma cópia boa e não colocaria nada no lugar dela.
Testado: com o upload falhando, o script sai com código 1, alerta, e **não apaga nada**.

**A rotação conta arquivo, nunca idade.** `--min-age 30d` parece equivalente e não é: se o timer
ficar parado um mês (VPS desligada, token expirado), a primeira rodada depois apagaria todas as
cópias por serem velhas — e as novas ainda não existiriam. Contando arquivo, o pior caso de uma
pausa longa é ficar com backups antigos, que é exatamente o que se quer nessa hora.

## O que o script recusa a fazer

| situação | o que acontece |
|---|---|
| `rclone`, `docker` ou `gzip` faltando | alerta e sai 1, antes de tocar no banco |
| `pg_dump` falha | alerta com o `PIPESTATUS` (diz se foi o dump ou o gzip) |
| dump menor que 1 MiB | **não sobe** — `pg_dump` pode sair 0 e escrever só o cabeçalho |
| `gzip -t` falha | não sobe |
| upload falha | não rotaciona; a passagem é apagada |
| arquivo não aparece no Drive, ou o tamanho não bate | não rotaciona |
| listagem volta vazia depois de um upload confirmado | alerta em vez de "0 cópias" no log |

Todos esses caminhos foram exercitados, não só escritos.
