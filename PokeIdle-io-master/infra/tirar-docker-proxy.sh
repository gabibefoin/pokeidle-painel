#!/usr/bin/env bash
#
# Tira o `docker-proxy` do caminho: Postgres e Redis passam a rodar na rede do host, presos ao
# loopback (ver `game/docker-compose.host.yml`). Nenhuma variável do jogo muda — as portas
# continuam 5433 e 6380.
#
#   sudo bash infra/tirar-docker-proxy.sh --dry-run    # só mostra o que faria
#   sudo bash infra/tirar-docker-proxy.sh              # aplica (~1–2 min de jogo fora do ar)
#   sudo bash infra/tirar-docker-proxy.sh --voltar     # desfaz: volta às portas publicadas
#
# Medido em 14/09/2026: os dois `docker-proxy` gastavam 43% de um núcleo (34% o do Redis, 9% o do
# Postgres) — mais que o próprio Redis.
#
# Em ordem:
#   1. confere root, a versão do compose e que o override existe;
#   2. dump do banco em /var/backups — dump vazio para tudo antes de mexer em qualquer coisa;
#   3. para gateway(s) e sims (cada sim grava todo mundo no SIGTERM);
#   4. liga `COMPOSE_FILE` no .env e recria os dois containers (os volumes ficam);
#   5. espera os dois saudáveis e confere que NINGUÉM escuta 5433/6380 fora do loopback;
#   6. sobe o jogo e espera o /saude com todos os shards.
# Se o passo 5 falhar, volta sozinho às portas publicadas antes de subir o jogo.
set -euo pipefail

DESTINO="${DESTINO:-/opt/pokeidle}"
DRY=0
VOLTAR=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --voltar) VOLTAR=1; shift ;;
    --destino) DESTINO="$2"; shift 2 ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $1" >&2; exit 1 ;;
  esac
done

JOGO="$DESTINO/game"
ENVFILE="$JOGO/.env"
LINHA='COMPOSE_FILE=docker-compose.yml:docker-compose.host.yml'

azul() { printf '\033[1;34m▸ %s\033[0m\n' "$*"; }
erro() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else eval "$@"; fi; }

[ "$(id -un)" = root ] || erro "rode como root: sudo bash $0"
[ -f "$JOGO/docker-compose.yml" ] || erro "não achei $JOGO/docker-compose.yml"
[ -f "$JOGO/docker-compose.host.yml" ] || erro "não achei $JOGO/docker-compose.host.yml — git pull primeiro"
[ -f "$ENVFILE" ] || erro "não achei $ENVFILE"
DONO="$(stat -c '%U' "$DESTINO")"
cd "$JOGO"

# `ports: !reset []` é do Compose 2.24+.
versao="$(docker compose version --short 2>/dev/null || echo 0.0)"
maior="${versao%%.*}"
resto="${versao#*.}"
menor="${resto%%.*}"
if [ "${maior:-0}" -lt 2 ] || { [ "$maior" -eq 2 ] && [ "${menor:-0}" -lt 24 ]; }; then
  erro "docker compose $versao não entende \`!reset\` — atualize para 2.24 ou mais novo"
fi

unidades_do_jogo() {
  local u i
  for u in pokeidle pokeidle-gateway; do
    if systemctl is-enabled "$u" &>/dev/null; then echo "$u"; fi
  done
  for i in $(seq 0 7); do
    if systemctl is-enabled "pokeidle-gateway@$i" &>/dev/null; then echo "pokeidle-gateway@$i"; fi
  done
  for i in $(seq 0 15); do
    if systemctl is-enabled "pokeidle-sim@$i" &>/dev/null; then echo "pokeidle-sim@$i"; fi
  done
}
UNIDADES="$(unidades_do_jogo | tr '\n' ' ')"
[ -n "${UNIDADES// /}" ] || erro "nenhuma unidade do jogo habilitada nesta máquina"
SIMS_ESPERADOS="$(printf '%s\n' $UNIDADES | grep -c '^pokeidle-sim@' || true)"

proxies() { pgrep -af 'docker-proxy.*-host-port (5433|6380)' || echo "  (nenhum)"; }
id_container() { docker compose ps -q "$1" 2>/dev/null; }
saude_container() { docker inspect -f '{{.State.Health.Status}}' "$(id_container "$1")" 2>/dev/null || echo ausente; }

ligar_env() {
  if grep -q '^COMPOSE_FILE=' "$ENVFILE"; then
    run "sed -i 's|^COMPOSE_FILE=.*|$LINHA|' '$ENVFILE'"
  else
    run "printf '\n%s\n' '$LINHA' >> '$ENVFILE'"
  fi
  run "chown '$DONO:$DONO' '$ENVFILE'"
}

desligar_env() {
  run "sed -i '/^COMPOSE_FILE=/d' '$ENVFILE'"
  run "chown '$DONO:$DONO' '$ENVFILE'"
}

parar_jogo() {
  azul "parando o jogo: $UNIDADES"
  local u
  for u in $UNIDADES; do run "systemctl stop '$u'"; done
}

subir_jogo() {
  azul "subindo o jogo"
  local u
  for u in $UNIDADES; do run "systemctl start '$u'"; done
}

esperar_containers() {
  if [ "$DRY" = 1 ]; then echo "[dry-run] esperar postgres e redis saudáveis"; return 0; fi
  local i
  for i in $(seq 1 90); do
    if [ "$(saude_container postgres)" = healthy ] && [ "$(saude_container redis)" = healthy ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Quem escuta 5433/6380 fora de 127.0.0.1 e ::1 tem de ser NINGUÉM — e os dois têm de estar ouvindo.
so_no_loopback() {
  if [ "$DRY" = 1 ]; then echo "[dry-run] conferir que 5433/6380 só escutam no loopback"; return 0; fi
  local fora
  fora="$(ss -Hltn '( sport = :5433 or sport = :6380 )' | awk '{print $4}' \
    | grep -vE '^(127\.0\.0\.1|\[::1\]):(5433|6380)$' || true)"
  if [ -n "$fora" ]; then
    echo "  escutando fora do loopback: $fora" >&2
    return 1
  fi
  ss -Hltn '( sport = :5433 )' | grep -q . && ss -Hltn '( sport = :6380 )' | grep -q .
}

esperar_jogo() {
  if [ "$DRY" = 1 ]; then echo "[dry-run] esperar /saude com $SIMS_ESPERADOS shard(s)"; return 0; fi
  local i corpo ativos
  for i in $(seq 1 120); do
    corpo="$(curl -fsS --max-time 2 http://127.0.0.1:8080/saude 2>/dev/null || true)"
    ativos="$(printf '%s' "$corpo" | grep -o '"shards":[0-9]*' | cut -d: -f2)"
    if [ -n "$corpo" ] && [ "${ativos:-0}" -ge "${SIMS_ESPERADOS:-0}" ]; then
      echo "  $(printf '%s' "$corpo" | cut -c1-160)…"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

backup() {
  local arq tam
  arq="/var/backups/pokeidle-antes-docker-host-$(date +%Y%m%d-%H%M%S).sql.gz"
  azul "dump do banco → $arq"
  if [ "$DRY" = 1 ]; then echo "[dry-run] pg_dump | gzip > $arq"; return 0; fi
  install -d -m 700 /var/backups
  docker exec "$(id_container postgres)" pg_dump -U poke -d pokeidle --no-owner --no-acl | gzip -6 > "$arq"
  tam="$(stat -c %s "$arq")"
  [ "$tam" -gt 1048576 ] || erro "dump com $tam bytes — nada foi mudado; conferir o banco antes"
  echo "  $(numfmt --to=iec-i --suffix=B "$tam" 2>/dev/null || echo "$tam bytes")"
}

azul "unidades do jogo: $UNIDADES"
azul "docker-proxy de 5433/6380 agora:"
proxies

if [ "$VOLTAR" = 1 ]; then
  parar_jogo
  desligar_env
  azul "recriando postgres e redis com as portas publicadas"
  run "docker compose up -d"
  esperar_containers || erro "containers não ficaram saudáveis — olhar: docker compose logs --tail 80"
  subir_jogo
  esperar_jogo || erro "o jogo não respondeu no /saude — olhar: journalctl -u 'pokeidle*' -n 80"
  azul "de volta às portas publicadas"
  exit 0
fi

grep -qx "$LINHA" "$ENVFILE" && erro "o .env já tem $LINHA — já aplicado (use --voltar para desfazer)"

backup
parar_jogo
ligar_env
azul "recriando postgres e redis na rede do host"
run "docker compose up -d"

if ! esperar_containers || ! so_no_loopback; then
  echo "✗ a rede do host não ficou certa — voltando às portas publicadas" >&2
  desligar_env
  run "docker compose up -d"
  esperar_containers || erro "nem o rollback ficou saudável — olhar: docker compose logs --tail 80"
  subir_jogo
  esperar_jogo || true
  erro "rollback feito: o jogo voltou nas portas publicadas de antes"
fi

subir_jogo
esperar_jogo || erro "o jogo não respondeu no /saude com os containers novos — '--voltar' desfaz"

azul "docker-proxy de 5433/6380 depois (tem de dizer nenhum):"
proxies
azul "pronto. Em 5 min, compare: pidstat -u -C 'node|redis-server|docker-proxy|postgres' 10 1"
