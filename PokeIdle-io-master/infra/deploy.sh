#!/usr/bin/env bash
#
# Atualiza o jogo para o que está no `master` e confere que ele voltou vivo.
#
#   ./infra/deploy.sh            # atualiza para a origem
#   ./infra/deploy.sh <sha>      # ou para um commit específico (é como se volta atrás na mão)
#
# É o que o GitHub Actions chama a cada push. Roda como o usuário do jogo, nunca como root.
#
# ### O que ele garante
#
# **Ou o jogo volta no ar, ou ele volta para o commit anterior.** O health check depois do
# restart não é enfeite: um `npm ci` que quebrou, uma variável que faltou no `.env`, um erro de
# sintaxe que só aparece na importação — tudo isso passa pelo `git pull` sem reclamar e só
# aparece quando o processo tenta subir. Sem o rollback, um push ruim às 2 da manhã deixa o
# jogo fora do ar até alguém perceber.
set -euo pipefail

DESTINO="${DESTINO:-/opt/pokeidle}"
SAUDE="${SAUDE:-http://localhost:8080/saude}"
ALVO="${1:-}"

azul() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
erro() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; }

# Rodar como root é a pegadinha fácil deste script, e ela é silenciosa: o root não tem a deploy
# key (o `git fetch` morre com "Host key verification failed") e, pior, o que ele conseguisse
# escrever viraria arquivo de root dentro do repositório — quebrando todos os deploys seguintes,
# que rodam como o usuário do jogo. Melhor parar aqui com a instrução na tela.
DONO="$(stat -c '%U' "$DESTINO" 2>/dev/null || echo pokeidle)"
if [ "$(id -un)" != "$DONO" ]; then
  erro "rode como $DONO, não como $(id -un):"
  echo "    sudo -u $DONO bash $0 $*"
  exit 1
fi

cd "$DESTINO"

# O commit em que estamos AGORA, guardado antes de qualquer coisa: é para cá que se volta.
ANTERIOR="$(git rev-parse HEAD)"
azul "estado atual: ${ANTERIOR:0:8}"

# ------------------------------------------------------------------ código
azul "buscando"
git fetch --quiet origin
DESEJADO="${ALVO:-origin/master}"

# `reset --hard` e não `pull`: a máquina de produção não edita código, então não há nada a
# preservar — e um merge com conflito no meio de um deploy automático é a pior hora possível
# para precisar de um humano.
git reset --hard --quiet "$DESEJADO"
NOVO="$(git rev-parse HEAD)"

if [ "$NOVO" = "$ANTERIOR" ] && [ -z "$ALVO" ]; then
  azul "já está em ${NOVO:0:8} — nada a fazer"
  exit 0
fi
azul "indo para ${NOVO:0:8}  ·  $(git log -1 --pretty=%s)"

# ------------------------------------------------------------------ assets
#
# public/data/ é gitignorado e NÃO baixamos nada da internet neste script — um `npm run fetch`
# sobrescreveria sprites do Sprite Lab (outfits-index, atlases .webp) com o espelho oficial.
# Quem sobe os arquivos é infra/deploy-public-data.ps1, rodado na máquina de dev ANTES ou
# DEPOIS do git push (sprites + JSON de catálogo). Se faltar algo essencial, paramos aqui.
FALTA=0
for req in \
  "$DESTINO/public/data/creatures.json" \
  "$DESTINO/public/data/asset-packs/outfits-index.json" \
  "$DESTINO/public/data/world/maps"; do
  if [ ! -e "$req" ]; then
    FALTA=1
    erro "ausente: $req"
  fi
done
if [ "$FALTA" = 1 ]; then
  erro "public/data incompleto na VPS."
  echo "  Suba com: .\\infra\\deploy-public-data.ps1  (Windows, na raiz do repo)"
  echo "  Sprites novos: npm run publicar:sprites antes do upload."
  exit 1
fi
echo "  public/data ok"
# walkgrids é derivado dos mapas LOCAIS — não baixa nada; regera quando o código de spawns muda.
azul "grades de caminhada"
npm run walkgrids

# --------------------------------------------------------------- dependências
azul "dependências"
cd "$DESTINO/game"
# `npm ci` e não `install`: instala exatamente o que está no lock, e falha se o lock divergir
# do package.json em vez de "consertar" sozinho e subir algo diferente do que foi testado.
npm ci --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------- infra local
azul "postgres e redis"
docker compose up -d

# ------------------------------------------------------------------ reinício
#
# Fase 1: pokeidle.service (ROLE=all).
# Fase 2+: pokeidle-gateway + pokeidle-sim@N — o deploy antigo só reiniciava pokeidle e
# deixava o gateway velho no ar, ou fazia os dois brigarem pelo mesmo shard.
azul "reiniciando"
bash "$DESTINO/infra/reiniciar-servicos.sh"

sims_habilitados() {
  local id unidade
  for id in $(seq 0 15); do
    unidade="pokeidle-sim@${id}"
    if systemctl is-enabled "$unidade" &>/dev/null; then
      echo "$unidade"
    fi
  done
}

# ------------------------------------------------------------ health check
#
# 80 tentativas de meio segundo = 40 s. Na Fase 2 os sims passam por migração no boot;
# 20 s não bastam quando o Postgres está ocupado.
azul "esperando responder"
VIVO=0
SHARDS_ESPERADOS=1
if systemctl is-enabled pokeidle-gateway &>/dev/null || systemctl is-enabled pokeidle-gateway@0 &>/dev/null; then
  SHARDS_ESPERADOS="$(sims_habilitados | wc -l | tr -d ' ')"
  [ "$SHARDS_ESPERADOS" -ge 1 ] || SHARDS_ESPERADOS=2
fi

for _ in $(seq 1 80); do
  if ! curl -fsS --max-time 2 "$SAUDE" >/dev/null 2>&1; then
    sleep 0.5
    continue
  fi
  if [ "$SHARDS_ESPERADOS" -gt 1 ]; then
    SHARDS_ATIVOS="$(curl -fsS --max-time 2 "$SAUDE" | grep -o '"shards":[0-9]*' | cut -d: -f2)"
    if [ "${SHARDS_ATIVOS:-0}" -lt "$SHARDS_ESPERADOS" ]; then
      sleep 0.5
      continue
    fi
  fi
  VIVO=1
  break
done

if [ "$VIVO" = 1 ]; then
  VERSAO="$(curl -fsS --max-time 2 "$SAUDE" | grep -o '"versao":"[^"]*"' | cut -d'"' -f4)"
  azul "no ar · v${VERSAO} · ${NOVO:0:8}"
  exit 0
fi

# ------------------------------------------------------------------ rollback
erro "não respondeu a tempo — voltando para ${ANTERIOR:0:8}"
journalctl -u pokeidle -u pokeidle-gateway -u 'pokeidle-gateway@*' -u 'pokeidle-sim@*' -n 40 --no-pager 2>/dev/null || journalctl -u pokeidle -n 40 --no-pager || true

cd "$DESTINO"
git reset --hard --quiet "$ANTERIOR"
cd "$DESTINO/game"
npm ci --omit=dev --no-audit --no-fund
bash "$DESTINO/infra/reiniciar-servicos.sh"

for _ in $(seq 1 80); do
  if curl -fsS --max-time 2 "$SAUDE" >/dev/null 2>&1; then
    erro "rollback feito: o jogo está no ar em ${ANTERIOR:0:8}, e o deploy FALHOU"
    exit 1
  fi
  sleep 0.5
done

erro "o rollback também não subiu — a máquina precisa de olho humano"
exit 2
