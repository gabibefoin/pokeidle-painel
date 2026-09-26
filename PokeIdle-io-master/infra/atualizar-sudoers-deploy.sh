#!/usr/bin/env bash
#
# Permissões mínimas para o usuário do jogo reiniciar os serviços no deploy.
# Rode como root na VPS (ou via provisionar.sh / configurar-fase.sh):
#
#   sudo bash infra/atualizar-sudoers-deploy.sh
#   sudo bash infra/atualizar-sudoers-deploy.sh --usuario pokeidle
#
set -euo pipefail

USUARIO="pokeidle"
while [ $# -gt 0 ]; do
  case "$1" in
    --usuario) USUARIO="${2:-pokeidle}"; shift 2 ;;
    -h|--help)
      sed -n '1,8p' "$0"
      exit 0
      ;;
    *) echo "Opção desconhecida: $1" >&2; exit 1 ;;
  esac
done

if [ "$(id -un)" != 'root' ]; then
  echo "Rode como root: sudo bash $0" >&2
  exit 1
fi

cat > /etc/sudoers.d/pokeidle <<SUDO
$USUARIO ALL=(root) NOPASSWD: /usr/bin/systemctl restart pokeidle, /usr/bin/systemctl stop pokeidle, /usr/bin/systemctl start pokeidle
$USUARIO ALL=(root) NOPASSWD: /usr/bin/systemctl restart pokeidle-gateway, /usr/bin/systemctl stop pokeidle-gateway, /usr/bin/systemctl start pokeidle-gateway
$USUARIO ALL=(root) NOPASSWD: /usr/bin/systemctl restart pokeidle-gateway@*, /usr/bin/systemctl stop pokeidle-gateway@*, /usr/bin/systemctl start pokeidle-gateway@*
$USUARIO ALL=(root) NOPASSWD: /usr/bin/systemctl restart pokeidle-sim@*, /usr/bin/systemctl stop pokeidle-sim@*, /usr/bin/systemctl start pokeidle-sim@*
$USUARIO ALL=(root) NOPASSWD: /usr/bin/systemctl restart pokeidle-bot, /usr/bin/systemctl stop pokeidle-bot, /usr/bin/systemctl start pokeidle-bot
SUDO
chmod 0440 /etc/sudoers.d/pokeidle
visudo -cf /etc/sudoers.d/pokeidle >/dev/null

echo "sudoers ok para $USUARIO (pokeidle + gateway + gateway@* + sim@* + bot)"
