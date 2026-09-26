#!/usr/bin/env bash
#
# Snapshot de saude da VPS — rode no SSH quando o jogo estiver lento OU depois que normalizar,
# para comparar. Cole a saida inteira no chat.
#
#   sudo bash /tmp/diagnostico.sh
#   sudo bash /tmp/diagnostico.sh | tee ~/diag-pokeidle.txt
#
set -uo pipefail

DESTINO="${DESTINO:-/opt/pokeidle}"
AGORA="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

secao() { printf '\n========== %s ==========\n' "$*"; }
ok()    { printf '  %s\n' "$*"; }
cmd()   { printf '$ %s\n' "$*"; "$@" 2>&1 || printf '  (falhou: exit %s)\n' "$?"; }

secao "POKEIDLE · DIAGNOSTICO · ${AGORA}"

secao "SISTEMA"
cmd uptime
cmd uname -a
ok "CPU(s): $(nproc 2>/dev/null || echo '?')"
if [ -r /proc/loadavg ]; then ok "loadavg: $(cat /proc/loadavg)"; fi
cmd free -h
cmd df -h / /
if [ -r /proc/meminfo ]; then
  ok "SwapUsed: $(awk '/SwapTotal/ {t=$2} /SwapFree/ {f=$2} END {if(t>0) printf "%.0f MiB / %.0f MiB", (t-f)/1024, t/1024; else print "sem swap"}' /proc/meminfo)"
fi

secao "REDE · BANDA"
IFACE="$(ip -o -4 route show to default 2>/dev/null | awk '{print $5}' | head -1)"
ok "Interface padrao: ${IFACE:-desconhecida}"
if [ -n "${IFACE:-}" ] && [ -r "/sys/class/net/${IFACE}/statistics/rx_bytes" ]; then
  RX1="$(cat "/sys/class/net/${IFACE}/statistics/rx_bytes")"
  TX1="$(cat "/sys/class/net/${IFACE}/statistics/tx_bytes")"
  sleep 2
  RX2="$(cat "/sys/class/net/${IFACE}/statistics/rx_bytes")"
  TX2="$(cat "/sys/class/net/${IFACE}/statistics/tx_bytes")"
  RX_MBPS="$(awk -v d="$((RX2 - RX1))" 'BEGIN {printf "%.2f", d * 8 / 2 / 1000000}')"
  TX_MBPS="$(awk -v d="$((TX2 - TX1))" 'BEGIN {printf "%.2f", d * 8 / 2 / 1000000}')"
  ok "Amostra 2 s · download ~${RX_MBPS} Mbit/s · upload ~${TX_MBPS} Mbit/s"
  ok "Total acumulado RX: $(numfmt --to=iec-i --suffix=B "${RX2}" 2>/dev/null || echo "${RX2} bytes")"
  ok "Total acumulado TX: $(numfmt --to=iec-i --suffix=B "${TX2}" 2>/dev/null || echo "${TX2} bytes")"
fi
cmd ss -s
ok "Conexoes :8080: $(ss -Htan 'sport = :8080' 2>/dev/null | wc -l)"
ok "Conexoes :443:  $(ss -Htan 'sport = :443'  2>/dev/null | wc -l)"
ok "Conexoes ESTAB :8080: $(ss -Htan state established 'sport = :8080' 2>/dev/null | wc -l)"

secao "SERVICOS"
cmd systemctl is-active pokeidle caddy docker 2>/dev/null || true
# Fase 2+: cada gateway e sim habilitado, com há quanto tempo está de pé e quantas vezes caiu.
for u in pokeidle-gateway $(seq -f 'pokeidle-gateway@%g' 0 7) $(seq -f 'pokeidle-sim@%g' 0 15); do
  if systemctl is-enabled "$u" >/dev/null 2>&1; then
    ok "$u: $(systemctl is-active "$u" 2>/dev/null) · desde $(systemctl show "$u" -p ActiveEnterTimestamp --value 2>/dev/null) · quedas $(systemctl show "$u" -p NRestarts --value 2>/dev/null)"
  fi
done
if systemctl is-active pokeidle >/dev/null 2>&1; then
  ok "pokeidle desde: $(systemctl show pokeidle -p ActiveEnterTimestamp --value 2>/dev/null || echo '?')"
fi

secao "SAUDE DO JOGO (/saude local)"
for i in 1 2 3; do
  T0="$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')"
  RESP="$(curl -fsS --max-time 5 http://127.0.0.1:8080/saude 2>&1)" && RC=0 || RC=$?
  T1="$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')"
  MS=$((T1 - T0))
  if [ "$RC" -eq 0 ]; then
    ok "tentativa ${i}: ${MS} ms · ${RESP}"
  else
    ok "tentativa ${i}: FALHOU (${MS} ms) · ${RESP}"
  fi
done

secao "DOCKER"
if command -v docker >/dev/null 2>&1; then
  cmd docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  cmd docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}'
else
  ok "docker nao encontrado"
fi

secao "POSTGRES"
PG_CONTAINER="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'postgres' | head -1 || true)"
if [ -n "${PG_CONTAINER:-}" ]; then
  ok "container: ${PG_CONTAINER}"
  cmd docker exec "${PG_CONTAINER}" pg_isready -U poke -d pokeidle
  cmd docker exec "${PG_CONTAINER}" psql -U poke -d pokeidle -c "SELECT count(*) AS conexoes_ativas FROM pg_stat_activity WHERE datname = 'pokeidle';"
  cmd docker exec "${PG_CONTAINER}" psql -U poke -d pokeidle -c "SELECT state, count(*) AS n FROM pg_stat_activity WHERE datname = 'pokeidle' GROUP BY state ORDER BY n DESC;"
  cmd docker exec "${PG_CONTAINER}" psql -U poke -d pokeidle -c "SELECT pid, state, wait_event_type, wait_event, left(query, 120) AS query FROM pg_stat_activity WHERE datname = 'pokeidle' AND state <> 'idle' ORDER BY query_start LIMIT 8;"
  cmd docker exec "${PG_CONTAINER}" psql -U poke -d pokeidle -c "SELECT num_timed, num_requested, buffers_written FROM pg_stat_checkpointer;"
else
  ok "Postgres container nao encontrado"
fi

secao "REDIS"
REDIS_CONTAINER="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'redis' | head -1 || true)"
if [ -n "${REDIS_CONTAINER:-}" ]; then
  ok "container: ${REDIS_CONTAINER}"
  # Na rede do host (docker-compose.host.yml) o Redis ouve na 6380 também dentro do container.
  REDIS_PORTA="$(docker inspect -f '{{join .Config.Cmd " "}}' "${REDIS_CONTAINER}" 2>/dev/null | grep -oE -- '--port [0-9]+' | awk '{print $2}')"
  REDIS_PORTA="${REDIS_PORTA:-6379}"
  cmd docker exec "${REDIS_CONTAINER}" redis-cli -p "${REDIS_PORTA}" ping
  cmd docker exec "${REDIS_CONTAINER}" redis-cli -p "${REDIS_PORTA}" info stats | grep -E 'instantaneous_ops|total_connections|rejected_connections|blocked_clients'
  cmd docker exec "${REDIS_CONTAINER}" redis-cli -p "${REDIS_PORTA}" info memory | grep -E 'used_memory_human|maxmemory_human|mem_fragmentation'
  cmd docker exec "${REDIS_CONTAINER}" redis-cli -p "${REDIS_PORTA}" dbsize
  # A carga REAL de cada shard, como cada sim publica. O `porShard` do /saude é a vitrine pública e
  # soma no shard 0 o acréscimo de online do painel — para capacidade, vale ESTE número.
  ok "carga real por shard (jogadores nos sims, tick):"
  docker exec "$REDIS_CONTAINER" redis-cli -p "$REDIS_PORTA" hgetall metricas 2>/dev/null \
    | paste - - | awk '{printf "    shard %s  %s\n", $1, $2}'
else
  ok "Redis container nao encontrado"
fi

secao "PROCESSO NODE (pokeidle)"
PID="$(systemctl show pokeidle -p MainPID --value 2>/dev/null || echo 0)"
if [ "${PID:-0}" -gt 0 ] 2>/dev/null; then
  ok "PID: ${PID}"
  cmd ps -p "${PID}" -o pid,user,%cpu,%mem,rss,vsz,etime,cmd
  if [ -r "/proc/${PID}/status" ]; then
    ok "FDs abertos: $(ls "/proc/${PID}/fd" 2>/dev/null | wc -l)"
  fi
else
  ok "Processo pokeidle nao encontrado"
fi

secao "PROCESSOS DO JOGO (Fase 2+) · CPU"
# Um processo Node é um núcleo: gateway ou sim perto de 100% é o teto DELE, mesmo com a máquina folgada.
cmd ps -eo pid,pcpu,pmem,rss,etime,args --sort=-pcpu | grep -E 'server/index.mjs|caddy|redis-server|docker-proxy|postgres: ' | grep -v grep | head -25
if command -v pidstat >/dev/null 2>&1; then
  ok "média de 5 s por processo (pidstat):"
  pidstat -u -C 'node|caddy|redis-server|docker-proxy' 5 1 2>/dev/null | grep -E '^(Average|Média)' || true
fi

secao "LOGS RECENTES (ultimos 20 min · pokeidle)"
cmd journalctl -u pokeidle -u 'pokeidle-gateway*' -u 'pokeidle-sim@*' --since '20 min ago' --no-pager -n 120

secao "ASSETS · tempo de resposta"
for path in \
  '/assets/creatures.json' \
  '/assets/asset-packs/outfits-index.json' \
  '/assets/items.json' \
  '/app.js'; do
  T0="$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')"
  CODE="$(curl -fsS -o /dev/null -w '%{http_code} %{size_download}' --max-time 15 "http://127.0.0.1:8080${path}" 2>&1)" && RC=0 || RC=$?
  T1="$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')"
  MS=$((T1 - T0))
  if [ "$RC" -eq 0 ]; then
    ok "${path}: ${MS} ms · ${CODE}"
  else
    ok "${path}: FALHOU (${MS} ms)"
  fi
done

secao "INTERPRETACAO RAPIDA"
cat <<'EOF'
  · load > n de CPUs por varios minutos          -> CPU no limite
  · download/upload ~0 Mbit/s com gente entrando -> banda saturada OU pico passou
  · /saude > 500 ms ou falhando                  -> gateway/sim sobrecarregado
  · tickMs > 180 (orcamento 250)                 -> sim no limite: mais sims ou mais nucleo
  · um node ~100% no pidstat                     -> aquele processo no teto (mais gateways/sims)
  · docker-proxy com CPU                         -> infra/tirar-docker-proxy.sh
  · Postgres conexoes_ativas ~ 10                -> pool esgotado (max=10 no codigo)
  · Postgres wait_event = Lock / IO              -> gargalo de disco ou trava
  · ESTAB :8080 >> online do /saude              -> sockets presos / reconexao em massa
  · assets locais > 3 s                          -> disco lento ou gzip na primeira leitura
EOF

secao "FIM · cole esta saida inteira no chat"
