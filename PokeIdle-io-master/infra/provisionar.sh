#!/usr/bin/env bash
#
# Do Ubuntu recém-criado até o jogo no ar. Roda UMA vez, como root, na máquina nova.
#
#   ssh root@<ip> 'bash -s' < infra/provisionar.sh
#
# É idempotente: rodar de novo não estraga nada, só reaplica. Isso importa porque a primeira
# execução quase sempre para no meio (falta uma variável, o DNS ainda não propagou) e você vai
# querer corrigir e repetir sem recriar a máquina.
#
# O que ele NÃO faz, de propósito:
#   · não cria o `.env`   — tem segredo dentro, e segredo não passa por script versionado
#   · não aponta o DNS    — é no painel do seu registrador
#   · não abre o jogo     — o `deploy.sh` faz isso, e é ele que o CI chama
set -euo pipefail

USUARIO="${USUARIO:-pokeidle}"
DESTINO="${DESTINO:-/opt/pokeidle}"
# Endereço SSH, e não HTTPS: o repositório é PRIVADO, e o servidor entra nele com uma deploy
# key própria (ver a seção "código"). Com HTTPS a única saída seria um token no disco, dentro
# da URL do remote — que vaza em qualquer `git remote -v` e não dá para revogar sozinho.
REPO="${REPO:-git@github.com:pedrofasi/PokeIdle-io.git}"
DOMINIO="${DOMINIO:-}"

log() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "rode como root"; exit 1; }

# ------------------------------------------------------------------ pacotes
log "pacotes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ufw fail2ban ca-certificates gnupg

# -------------------------------------------------------------------- ssh
#
# Root com senha num IP público é varrido por bot em minutos — numa máquina recém-criada as
# primeiras tentativas chegam antes de você terminar de configurá-la.
#
# `prohibit-password` e não `no`: root por CHAVE continua funcionando (é como você e o
# `provisionar.sh` entram), só a senha morre. Pôr `no` trancaria você para fora, porque o
# usuário do jogo é de sistema e não tem chave própria.
#
# A GUARDA é o que impede este bloco de ser um tiro no pé: sem nenhuma chave autorizada para o
# root, desligar a senha deixaria a máquina inacessível para sempre. Nesse caso ele avisa e não
# mexe em nada.
log "trancando o SSH"
if [ -s /root/.ssh/authorized_keys ]; then
  # Drop-in com prefixo BAIXO de propósito: em `sshd_config` vale a PRIMEIRA ocorrência de cada
  # palavra-chave, e o Ubuntu já traz um `50-cloud-init.conf` ligando a senha. Um `99-` seria
  # lido depois e simplesmente ignorado.
  cat > /etc/ssh/sshd_config.d/10-pokeidle.conf <<'SSHD'
# Escrito por infra/provisionar.sh
PasswordAuthentication no
PermitRootLogin prohibit-password
KbdInteractiveAuthentication no
SSHD
  chmod 0644 /etc/ssh/sshd_config.d/10-pokeidle.conf

  # Confere ANTES de recarregar: um sshd_config inválido derruba o serviço e aí não há como
  # entrar para consertar.
  if sshd -t; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd
    EFETIVO="$(sshd -T | grep -c '^passwordauthentication no' || true)"
    if [ "$EFETIVO" = "1" ]; then
      echo "  senha desligada · root só por chave"
    else
      echo "  ATENÇÃO: a senha continua ligada — outro arquivo em sshd_config.d está ganhando"
      sshd -T | grep -E '^passwordauthentication|^permitrootlogin' | sed 's/^/    /'
    fi
  else
    echo "  ATENÇÃO: sshd_config ficou inválido; nada foi aplicado"
    rm -f /etc/ssh/sshd_config.d/10-pokeidle.conf
  fi
else
  echo "  PULADO: /root/.ssh/authorized_keys está vazio."
  echo "  Desligar a senha agora trancaria você para fora. Adicione sua chave e rode de novo."
fi

# -------------------------------------------------------------------- fogo
# 22 para você entrar, 80/443 para o Caddy. A porta 8080 do jogo fica FECHADA para fora: só o
# Caddy fala com ela, por localhost. Postgres e Redis idem — eles nem publicam porta para fora
# do docker, mas o firewall é a segunda tranca.
log "firewall"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp   >/dev/null
# 80/443 abertas para todos só no provisionamento: o Let's Encrypt precisa chegar antes de o DNS
# estar proxiado. Com o domínio atrás do Cloudflare, rodar `infra/firewall-cloudflare.sh`, que
# deixa 80/443 só para as faixas dele (é assim na produção desde 15/09/2026).
ufw allow 80/tcp   >/dev/null
ufw allow 443/tcp  >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban

# Node 22 pelo repositório da NodeSource. A distro traz uma versão velha demais — o jogo pede
# Node >= 20 (`engines` do package.json) e usa `node --watch`, `structuredClone` e afins.
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  log "Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

# ------------------------------------------------------------------- docker
# Postgres e Redis sobem por `docker compose` (o arquivo já existe em `game/`). Docker é a
# única dependência pesada da máquina, e vem do repositório oficial porque o da distro
# costuma estar duas versões atrás do plugin `compose`.
if ! command -v docker >/dev/null; then
  log "Docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
systemctl enable --now docker

# -------------------------------------------------------------------- caddy
# Caddy no lugar de nginx por um motivo só: ele tira o certificado TLS sozinho e renova
# sozinho, e faz proxy de WebSocket sem configuração nenhuma. Num nginx isso seriam certbot,
# um cron de renovação e quatro linhas de `Upgrade`/`Connection` que todo mundo erra uma vez.
if ! command -v caddy >/dev/null; then
  log "Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi

# ------------------------------------------------------------------ usuário
# O jogo NÃO roda como root. Se um dia alguém escapar do processo Node, que caia num usuário
# que só enxerga a própria pasta.
if ! id "$USUARIO" >/dev/null 2>&1; then
  log "usuário $USUARIO"
  adduser --system --group --home "$DESTINO" --shell /bin/bash "$USUARIO"
fi
usermod -aG docker "$USUARIO"

# ------------------------------------------------------------------- código
#
# O repositório é privado, então a máquina precisa de uma identidade própria no GitHub: uma
# **deploy key**, que é uma chave SSH autorizada em UM repositório só e pode ser somente-leitura.
#
# Por que não um token de acesso pessoal: ele iria parar na URL do remote, aparece em qualquer
# `git remote -v`, vale para a sua conta INTEIRA e revogá-lo derruba tudo que o usa. A deploy
# key vale para este repositório, nesta máquina, e some com um clique.
#
# A mesma chave serve ao deploy contínuo: o `deploy.sh` faz `git fetch` a cada atualização.
log "chave de acesso ao repositório"
CHAVE="$DESTINO/.ssh/id_ed25519"
install -d -m 700 -o "$USUARIO" -g "$USUARIO" "$DESTINO/.ssh"
if [ ! -f "$CHAVE" ]; then
  sudo -u "$USUARIO" ssh-keygen -t ed25519 -N '' -C "pokeidle@$(hostname)" -f "$CHAVE" >/dev/null
fi
# `accept-new` só para github.com: aceita a impressão digital na primeira vez e passa a exigi-la
# depois. Sem isto o `git` de dentro do script trava esperando um "yes" que ninguém vai digitar.
sudo -u "$USUARIO" tee "$DESTINO/.ssh/config" >/dev/null <<SSHCFG
Host github.com
  IdentityFile $CHAVE
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
SSHCFG
chmod 600 "$DESTINO/.ssh/config"

log "código em $DESTINO"
if [ ! -d "$DESTINO/.git" ]; then
  if ! sudo -u "$USUARIO" git clone --depth 50 "$REPO" "$DESTINO/.codigo" 2>/dev/null; then
    cat <<CHAVEFALTA

┌──────────────────────────────────────────────────────────────────┐
│  FALTA AUTORIZAR ESTA MÁQUINA NO GITHUB                          │
└──────────────────────────────────────────────────────────────────┘

  O repositório é privado e esta chave ainda não tem acesso:

$(cat "$CHAVE.pub")

  1. GitHub → o repositório → Settings → Deploy keys → Add deploy key
  2. Cole a linha acima. Título: "$(hostname)". NÃO marque "Allow write access"
     (o servidor só precisa LER; sem escrita, uma invasão aqui não suja o repositório).
  3. Rode este script de novo — ele continua de onde parou.

CHAVEFALTA
    exit 1
  fi
  # Clona para uma pasta ao lado e move o conteúdo: `git clone` recusa um destino que já tem
  # arquivos, e $DESTINO já é a home do usuário (tem .ssh dentro).
  shopt -s dotglob
  mv "$DESTINO/.codigo"/* "$DESTINO/"
  shopt -u dotglob
  rmdir "$DESTINO/.codigo"
fi
chown -R "$USUARIO:$USUARIO" "$DESTINO"
git config --global --add safe.directory "$DESTINO"

# ------------------------------------------------------------------- sudo
# O `deploy.sh` roda como o usuário do jogo e precisa reiniciar o serviço. Em vez de dar sudo
# geral, libera-se EXATAMENTE os comandos de systemctl que o deploy usa — Fase 1 e Fase 2.
log "sudo mínimo para o deploy"
bash "$DESTINO/infra/atualizar-sudoers-deploy.sh" --usuario "$USUARIO"

# ------------------------------------------------------------------ systemd
log "serviço"
install -m 0644 "$DESTINO/infra/pokeidle.service" /etc/systemd/system/pokeidle.service
sed -i "s|__USUARIO__|$USUARIO|g; s|__DESTINO__|$DESTINO|g" /etc/systemd/system/pokeidle.service
systemctl daemon-reload
systemctl enable pokeidle

# -------------------------------------------------------------------- caddy
if [ -n "$DOMINIO" ]; then
  log "Caddy para $DOMINIO"
  # O Caddyfile EXIGE o certificado de cliente do Cloudflare (Authenticated Origin Pulls). O CA
  # vem antes, e a chave "Global" do painel do Cloudflare tem de estar ligada — ver o topo do
  # `infra/Caddyfile`.
  install -m 644 -o root -g root "$DESTINO/infra/cloudflare-origin-pull-ca.pem" /etc/caddy/cloudflare-origin-pull-ca.pem
  sed "s|__DOMINIO__|$DOMINIO|g" "$DESTINO/infra/Caddyfile" > /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
else
  echo "  (DOMINIO vazio — configure o Caddy depois, veja infra/LEIA-ME.md)"
fi

# --------------------------------------------------------------------- fim
cat <<FIM

┌──────────────────────────────────────────────────────────────────┐
│  máquina pronta. faltam DOIS passos que só você pode dar:        │
└──────────────────────────────────────────────────────────────────┘

  1. o .env  (tem segredo; não vai no git)

       sudo -u $USUARIO cp $DESTINO/game/.env.example $DESTINO/game/.env
       sudo -u $USUARIO nano $DESTINO/game/.env

     o mínimo para subir:
       AUTH_SEGREDO=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
       URL_PUBLICA=https://${DOMINIO:-seu-dominio}
       DATABASE_URL=postgres://poke:poke@localhost:5433/pokeidle
       REDIS_URL=redis://localhost:6380

  2. o primeiro deploy (baixa os ~294 MB de assets; leva alguns minutos)

       sudo -u $USUARIO $DESTINO/infra/deploy.sh

FIM
