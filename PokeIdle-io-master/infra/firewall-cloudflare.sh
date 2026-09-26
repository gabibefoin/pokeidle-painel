#!/usr/bin/env bash
#
# 80/443 só para as faixas oficiais do Cloudflare. A 22 (SSH/deploy) não é tocada.
#
#   sudo bash infra/firewall-cloudflare.sh              # aplica (ou atualiza a lista)
#   sudo bash infra/firewall-cloudflare.sh --voltar     # reabre 80/443 para todo mundo
#
# Aplicado na produção em 15/09/2026. Sem isto, quem falava direto com o IP da origem forjava o
# `CF-Connecting-IP` e todos os limites por IP do jogo viravam ilimitados (ver `ip-cliente.mjs`).
#
# A ordem é o que evita derrubar o site: primeiro LIBERA as faixas, confere que entraram todas,
# e só então apaga as regras abertas. Depois testa o site pelo domínio (que passa pelo Cloudflare
# e volta pela origem); se não responder, reabre 80/443 sozinho. Conexões já estabelecidas não
# caem — o ufw aceita tráfego de conexões existentes.
#
# Pré-requisito: o DNS do domínio PROXIADO pelo Cloudflare (nuvem laranja). Com o DNS direto na
# origem, isto tira o site do ar. A renovação do Let's Encrypt continua (http-01 chega pelo
# Cloudflare). Monitor externo que acesse o IP direto deixa de funcionar.
#
# Faixa nova publicada pelo Cloudflare: rodar de novo (só acrescenta) e pôr a mesma faixa em
# `CLOUDFLARE_FAIXAS_EXTRA` no `.env` do jogo até o `ip-cliente.mjs` ser atualizado.
set -uo pipefail

DOMINIO="${DOMINIO:-pokeidle.io}"
[ "$(id -un)" = root ] || { echo "rode como root" >&2; exit 1; }

saude() { curl -fsS --max-time 10 -o /dev/null -w '%{http_code}' "https://$DOMINIO/saude" 2>/dev/null || echo falhou; }
abertas() { ufw status numbered | grep -E '\] +(80|443)/tcp( \(v6\))? +ALLOW IN +Anywhere'; }

if [ "${1:-}" = "--voltar" ]; then
  ufw allow 80/tcp && ufw allow 443/tcp
  echo "80/443 abertas para todos de novo (as regras do Cloudflare ficam, sem efeito). Site: $(saude)"
  exit 0
fi

TS=$(date +%Y%m%d-%H%M%S)
install -d -m 700 /var/backups/pokeidle
cp -p /etc/ufw/user.rules "/var/backups/pokeidle/ufw-user.rules.$TS"
cp -p /etc/ufw/user6.rules "/var/backups/pokeidle/ufw-user6.rules.$TS"
echo "backup: /var/backups/pokeidle/ufw-user{,6}.rules.$TS"

V4=$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4)
V6=$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6)
n4=$(printf '%s\n' "$V4" | grep -cE '^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$')
n6=$(printf '%s\n' "$V6" | grep -cE '^[0-9a-f:]+/[0-9]{1,3}$')
t4=$(printf '%s\n' "$V4" | grep -c .)
t6=$(printf '%s\n' "$V6" | grep -c .)
if ! { [ "$n4" -ge 10 ] && [ "$n4" = "$t4" ] && [ "$n6" -ge 5 ] && [ "$n6" = "$t6" ]; }; then
  echo "lista do Cloudflare estranha ($n4/$t4 IPv4, $n6/$t6 IPv6) — nada foi mudado" >&2
  exit 1
fi
echo "faixas oficiais: $n4 IPv4, $n6 IPv6 · site antes: $(saude)"

for ip in $V4 $V6; do
  ufw allow proto tcp from "$ip" to any port 80,443 comment 'cloudflare' >/dev/null \
    || { echo "falhou ao liberar $ip — nada foi fechado" >&2; exit 1; }
done
nregras=$(ufw status | grep -c '# cloudflare')
[ "$nregras" -ge $((n4 + n6)) ] || { echo "só $nregras regras do Cloudflare — nada foi fechado" >&2; exit 1; }

if abertas >/dev/null; then
  ufw --force delete allow 80/tcp
  ufw --force delete allow 443/tcp
fi
abertas >/dev/null && { ufw --force delete allow 80/tcp; ufw --force delete allow 443/tcp; }

ok=0
for i in 1 2 3 4 5; do
  c=$(saude); echo "site depois ($i): $c"
  [ "$c" = 200 ] && { ok=1; break; }
  timeout 3 tail -f /dev/null || true
done
if [ "$ok" != 1 ]; then
  echo "o site não respondeu — reabrindo 80/443" >&2
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  echo "depois do rollback: $(saude)" >&2
  exit 1
fi
echo "pronto: 80/443 só para o Cloudflare ($nregras regras). Abertas para todos: $(abertas | wc -l)"
