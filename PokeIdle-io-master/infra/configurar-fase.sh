#!/usr/bin/env bash
#
# Alterna entre Fase 1 (ROLE=all) e Fases 2a–2f (gateway(s) + N sims).
#
#   sudo bash infra/configurar-fase.sh --fase 2a
#   sudo bash infra/configurar-fase.sh --fase 2e --gateways 6   # 10 sims atrás de 6 gateways (~10 mil, 16 vCPU)
#   sudo bash infra/configurar-fase.sh --fase 1      # rollback
#   sudo bash infra/configurar-fase.sh --fase 2e --gateways 6 --dry-run
#
# Sims por fase: 2a=2 · 2b=4 · 2c=6 · 2d=8 · 2e=10 · 2f=12. Mudar de fase muda o SHARD_COUNT e
# redistribui todos os jogadores — é com o jogo parado, e por isso vale escolher com folga.
#
# `--gateways N` (1 a 8, padrão 1). Um processo Node é um núcleo: em 15/09/2026 o gateway único
# gastava 0,32 núcleo a cada 1.000 sockets, então ~2.000 conexões (~65% de um núcleo, com a
# compressão com contexto) é o teto confortável de UM gateway. Com N > 1 sobem
# `pokeidle-gateway@0..N-1` (portas 8080…) e o Caddy reparte.
#
# Rode na raiz do repo ou com DESTINO=/opt/pokeidle.
# Faça backup ANTES: game/tools/backup-db.ps1
set -euo pipefail

DESTINO="${DESTINO:-/opt/pokeidle}"
FASE=""
DRY=0
GATEWAYS=1

while [ $# -gt 0 ]; do
  case "$1" in
    --fase) FASE="$2"; shift 2 ;;
    --gateways) GATEWAYS="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --destino) DESTINO="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,15p' "$0"
      exit 0
      ;;
    *) echo "Opção desconhecida: $1" >&2; exit 1 ;;
  esac
done

case "$FASE" in
  1)   SHARD_COUNT=1; SIMS=() ;;
  2a)  SHARD_COUNT=2; SIMS=(0 1) ;;
  2b)  SHARD_COUNT=4; SIMS=(0 1 2 3) ;;
  2c)  SHARD_COUNT=6; SIMS=(0 1 2 3 4 5) ;;
  2d)  SHARD_COUNT=8; SIMS=(0 1 2 3 4 5 6 7) ;;
  # 16 vCPU / 32 GB: 10 sims com ~1.000 jogadores cada = tick de ~90–100 ms (15/09/2026: 48–59 ms
  # com ~580 por sim). Ver "Fase 2e" em infra/FASES-ESCALA.md.
  2e)  SHARD_COUNT=10; SIMS=(0 1 2 3 4 5 6 7 8 9) ;;
  2f)  SHARD_COUNT=12; SIMS=(0 1 2 3 4 5 6 7 8 9 10 11) ;;
  *) echo "Use --fase 1 | 2a | 2b | 2c | 2d | 2e | 2f" >&2; exit 1 ;;
esac

# A unidade monta a porta como `808%i`: de @0 (8080) a @7 (8087).
case "$GATEWAYS" in
  [1-8]) ;;
  *) echo "Use --gateways 1 a 8" >&2; exit 1 ;;
esac

DONO="$(stat -c '%U' "$DESTINO" 2>/dev/null || echo pokeidle)"
if [ "$(id -un)" != "root" ]; then
  echo "Rode como root: sudo bash $0 --fase $FASE" >&2
  exit 1
fi

SYSTEMD_SRC="$DESTINO/infra/systemd"
subst() {
  local src="$1" dst="$2"
  sed "s|__USUARIO__|$DONO|g; s|__DESTINO__|$DESTINO|g" "$src" > "$dst"
}

run() {
  if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else eval "$@"; fi
}

# ROLE/SHARD no .env sobrescrevem o Environment= do systemd — na Fase 2 isso faz o gateway
# subir como ROLE=all e brigar com os sims pelo mesmo shard.
limpar_env_escala() {
  local envfile="$DESTINO/game/.env"
  [ -f "$envfile" ] || return 0
  run "sed -i '/^ROLE=/d; /^SHARD_ID=/d; /^SHARD_COUNT=/d; /^PORT=/d' '$envfile'"
}

# O Caddy lê a lista de gateways de um arquivo próprio, importado DENTRO do `reverse_proxy` do
# Caddyfile: mudar o número de gateways não mexe no resto do site (TLS, redirect, logs).
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
UPSTREAMS="${UPSTREAMS:-/etc/caddy/pokeidle-upstreams.caddy}"
configurar_caddy() {
  local destinos="" i
  for i in $(seq 0 $((GATEWAYS - 1))); do destinos="$destinos localhost:808${i}"; done
  if [ "$DRY" = 1 ]; then
    echo "[dry-run] $UPSTREAMS ← to${destinos}"
    return 0
  fi
  if [ ! -f "$CADDYFILE" ]; then
    echo "  (sem $CADDYFILE — Caddy não configurado nesta máquina, pulando)"
    return 0
  fi
  # Caddyfile de antes deste arquivo existir: `reverse_proxy localhost:8080 {` vira o import.
  if ! grep -q "import $UPSTREAMS" "$CADDYFILE"; then
    cp "$CADDYFILE" "$CADDYFILE.antes-upstreams-$(date +%Y%m%d%H%M%S)"
    sed -i "s|reverse_proxy localhost:8080 {|reverse_proxy {\n\t\timport $UPSTREAMS|" "$CADDYFILE"
  fi
  {
    echo "# Gerado por infra/configurar-fase.sh --gateways $GATEWAYS — não edite à mão."
    echo "to${destinos}"
    if [ "$GATEWAYS" -gt 1 ]; then
      # Cookie: cada navegador fica no MESMO gateway — o login, os limites por IP e o socket juntos.
      echo "lb_policy cookie pokeidle_gw"
      # Um gateway reiniciando: tenta outro por até 5 s em vez de devolver 502 ao jogador.
      echo "lb_try_duration 5s"
      echo "fail_duration 10s"
    fi
  } > "$UPSTREAMS"
  if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy
    echo "  Caddy: ${GATEWAYS} gateway(s) →${destinos}"
  else
    echo "✗ Caddyfile inválido depois da troca (o Caddy segue com a config anterior)." >&2
    echo "  Conferir: caddy validate --config $CADDYFILE --adapter caddyfile" >&2
    exit 1
  fi
}

echo "=== Pokeidle — configurar fase $FASE (SHARD_COUNT=$SHARD_COUNT, $GATEWAYS gateway(s)) ==="
echo "Destino: $DESTINO · usuário: $DONO"

run "systemctl stop pokeidle-gateway 2>/dev/null || true"
for i in $(seq 0 7); do run "systemctl stop pokeidle-gateway@${i} 2>/dev/null || true"; done
for i in $(seq 0 15); do run "systemctl stop pokeidle-sim@${i} 2>/dev/null || true"; done
run "systemctl stop pokeidle 2>/dev/null || true"
run "cd '$DESTINO/game' && sudo -u '$DONO' npm run stop 2>/dev/null || true"

if [ "$FASE" = "1" ]; then
  run "systemctl disable pokeidle-gateway 2>/dev/null || true"
  for i in $(seq 0 7); do run "systemctl disable pokeidle-gateway@${i} 2>/dev/null || true"; done
  for i in $(seq 0 15); do run "systemctl disable pokeidle-sim@${i} 2>/dev/null || true"; done
  run "systemctl enable pokeidle"
  run "systemctl start pokeidle"
  run "bash '$DESTINO/infra/atualizar-sudoers-deploy.sh' --usuario '$DONO'"
  echo "Fase 1 ativa (ROLE=all). Confira: curl -s http://localhost:8080/saude | jq .shards,.tickMs"
  exit 0
fi

if [ ! -f "$SYSTEMD_SRC/pokeidle-gateway.service" ]; then
  echo "Arquivos em $SYSTEMD_SRC não encontrados — git pull primeiro." >&2
  exit 1
fi

GW_TMP="$(mktemp)"
GWN_TMP="$(mktemp)"
SIM_TMP="$(mktemp)"
subst "$SYSTEMD_SRC/pokeidle-gateway.service" "$GW_TMP"
subst "$SYSTEMD_SRC/pokeidle-gateway@.service" "$GWN_TMP"
subst "$SYSTEMD_SRC/pokeidle-sim@.service" "$SIM_TMP"
# Ajusta SHARD_COUNT nos units gerados — gateway(s) e sims TÊM de concordar: é o roteamento.
sed -i "s/Environment=SHARD_COUNT=.*/Environment=SHARD_COUNT=$SHARD_COUNT/" "$GW_TMP" "$GWN_TMP" "$SIM_TMP"

run "cp '$GW_TMP' /etc/systemd/system/pokeidle-gateway.service"
run "cp '$GWN_TMP' /etc/systemd/system/pokeidle-gateway@.service"
run "cp '$SIM_TMP' /etc/systemd/system/pokeidle-sim@.service"
rm -f "$GW_TMP" "$GWN_TMP" "$SIM_TMP"

if [ "$DRY" = 1 ]; then
  echo "[dry-run] remover ROLE/SHARD/PORT do .env"
else
  limpar_env_escala
fi

run "systemctl disable pokeidle 2>/dev/null || true"
run "systemctl daemon-reload"
# Um gateway: a unidade de sempre (porta 8080). Vários: as instâncias @0..N-1 — e a unidade única
# DESLIGADA, senão duas coisas disputariam a 8080.
if [ "$GATEWAYS" = 1 ]; then
  run "systemctl enable pokeidle-gateway"
  for i in $(seq 0 7); do run "systemctl disable pokeidle-gateway@${i} 2>/dev/null || true"; done
else
  run "systemctl disable pokeidle-gateway 2>/dev/null || true"
  for i in $(seq 0 7); do
    if [ "$i" -lt "$GATEWAYS" ]; then
      run "systemctl enable pokeidle-gateway@${i}"
    else
      run "systemctl disable pokeidle-gateway@${i} 2>/dev/null || true"
    fi
  done
fi
for id in "${SIMS[@]}"; do run "systemctl enable pokeidle-sim@${id}"; done
for i in $(seq 0 15); do
  skip=0
  for id in "${SIMS[@]}"; do [ "$i" = "$id" ] && skip=1; done
  [ "$skip" = 1 ] || run "systemctl disable pokeidle-sim@${i} 2>/dev/null || true"
done

run "cd '$DESTINO/game' && docker compose up -d"
if [ "$GATEWAYS" = 1 ]; then
  run "systemctl start pokeidle-gateway"
else
  for i in $(seq 0 $((GATEWAYS - 1))); do run "systemctl start pokeidle-gateway@${i}"; done
fi
for id in "${SIMS[@]}"; do run "systemctl start pokeidle-sim@${id}"; done

# Depois dos gateways de pé: o Caddy passa a mandar conexões para todos eles.
configurar_caddy

run "bash '$DESTINO/infra/atualizar-sudoers-deploy.sh' --usuario '$DONO'"

echo ""
echo "Fase $FASE ativa. Confira:"
echo "  curl -s http://localhost:8080/saude | jq '{ok,online,shards,tickMs,jogadores}'"
echo "  systemctl status pokeidle-gateway pokeidle-sim@${SIMS[0]} --no-pager"
echo ""
echo "Deploy futuro: bash $DESTINO/infra/reiniciar-servicos.sh — reinicia todo gateway e sim habilitado."
