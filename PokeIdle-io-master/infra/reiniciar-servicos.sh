#!/usr/bin/env bash
#
# Reinicia o stack em produção — Fase 1 (pokeidle) ou Fase 2+ (gateway + sims).
# Usado por deploy.sh e deploy-public-data.ps1.
#
#   bash infra/reiniciar-servicos.sh
#   DRY_RUN=1 bash infra/reiniciar-servicos.sh    # só mostra o que faria — não reinicia nada
#
# ### Sims primeiro; depois os gateways, um de cada vez
#
# Os SIMS reiniciam juntos, e o script espera cada um publicar métrica nova (o `ts` de `metricas`,
# lido pelo /saude local) antes de tocar no primeiro gateway. Eles podem subir juntos porque as
# migrações de boot passam uma de cada vez pela trava de migração do Postgres
# (`travarMigracoes`, em `db.mjs`) — sem ela, a DDL concorrente derrubou dois sims no deploy de
# 16/09/2026.
#
# Na ordem antiga (gateways primeiro), quem reconectava durante a troca dos gateways carregava
# num sim VELHO, que caía logo em seguida — e o jogador ficava congelado até o vigia do cliente
# (30 s sem mensagem de jogo) derrubar o socket. Agora, quando os gateways fecham os sockets com
# 1012, os sims novos já estão de pé: a troca dos gateways serve também de "acorda" para quem
# congelou durante a troca dos sims.
#
# Com vários gateways, cada um só reinicia depois de o anterior voltar a responder e de uma pausa
# (`PAUSA_ENTRE_GATEWAYS`, 15 s): os jogadores dele reconectam espalhados por até 15 s (o gateway
# fecha os sockets com 1012 e o cliente sorteia a volta — `shared/reconexao.mjs`), enquanto os
# outros gateways seguem no ar. Reiniciar todos juntos jogava a base inteira no login no mesmo
# segundo: em 15/09/2026, 2.497 "hello lento" numa hora de deploy com ~1.100 jogadores.
#
# ### Nada de `npm run stop` aqui
#
# Ele fazia `pkill -f server/index.mjs` — matava os processos DAS UNIDADES, os seis gateways e os
# dez sims no mesmo segundo, antes do reinício escalonado — e em seguida apagava todas as travas
# do Redis (as de shard e a do worker de saque) com os processos velhos ainda gravando. Aqui só
# morre processo SOLTO: um `npm start` à mão, fora do systemd, que é o único que as unidades não
# controlam.
set -euo pipefail

DESTINO="${DESTINO:-/opt/pokeidle}"
PAUSA_ENTRE_GATEWAYS="${PAUSA_ENTRE_GATEWAYS:-15}"
ESPERA_SIMS="${ESPERA_SIMS:-90}"
DRY_RUN="${DRY_RUN:-0}"

# Executa — ou, com DRY_RUN=1, só mostra.
fazer() {
  if [ "$DRY_RUN" = 1 ]; then
    echo "  [dry-run] $*"
    return 0
  fi
  "$@"
}

pausar() {
  if [ "$DRY_RUN" = 1 ]; then
    echo "  [dry-run] sleep $1"
    return 0
  fi
  sleep "$1"
}

sims_habilitados() {
  local id unidade
  for id in $(seq 0 15); do
    unidade="pokeidle-sim@${id}"
    if systemctl is-enabled "$unidade" &>/dev/null; then
      echo "$unidade"
    fi
  done
}

# A unidade única (um gateway) ou as instâncias @0..7 (vários, atrás do Caddy).
gateways_habilitados() {
  local i
  if systemctl is-enabled pokeidle-gateway &>/dev/null; then echo pokeidle-gateway; fi
  for i in $(seq 0 7); do
    if systemctl is-enabled "pokeidle-gateway@${i}" &>/dev/null; then echo "pokeidle-gateway@${i}"; fi
  done
}

# A porta de cada gateway: a unidade única e a @0 ouvem na 8080; a @N na 808N.
porta_do_gateway() {
  case "$1" in
    pokeidle-gateway) echo 8080 ;;
    pokeidle-gateway@*) echo "808${1#pokeidle-gateway@}" ;;
  esac
}

# Espera o gateway responder o /saude local, até 30 s. Não trava o deploy: se não responder, segue —
# quem decide se o jogo voltou é o health check do `deploy.sh`.
esperar_gateway() {
  local porta="$1" _
  if [ "$DRY_RUN" = 1 ]; then
    echo "  [dry-run] esperar o /saude da ${porta}"
    return 0
  fi
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${porta}/saude" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "  (gateway na ${porta} não respondeu em 30 s — seguindo)" >&2
}

# Quantos shards publicaram métrica com `ts` a partir de `desde_ms`, pelo /saude local.
sims_com_metrica_desde() {
  local desde_ms="$1" porta="$2" saude
  if ! saude="$(curl -fsS --max-time 2 "http://127.0.0.1:${porta}/saude" 2>/dev/null)"; then
    echo 0
    return 0
  fi
  printf '%s' "$saude" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const j = JSON.parse(s);
        const desde = Number(process.argv[1]);
        console.log(Object.values(j.porShard || {}).filter((m) => (m.ts || 0) >= desde).length);
      } catch {
        console.log(0);
      }
    });' "$desde_ms" 2>/dev/null || echo 0
}

# Espera todos os sims publicarem métrica NOVA — a prova de que o tick deles já está rodando.
# Não trava o deploy: passado o prazo, segue para os gateways (e o health check decide).
esperar_sims() {
  local desde_ms="$1" esperados="$2" porta="$3" prontos=0 _
  if [ "$DRY_RUN" = 1 ]; then
    echo "  [dry-run] esperar ${esperados} sims com métrica nova (agora: $(sims_com_metrica_desde "$desde_ms" "$porta") com ts >= ${desde_ms})"
    return 0
  fi
  for _ in $(seq 1 $(( ESPERA_SIMS * 2 ))); do
    prontos="$(sims_com_metrica_desde "$desde_ms" "$porta")"
    if [ "${prontos:-0}" -ge "$esperados" ]; then
      echo "  ${prontos}/${esperados} sims de volta"
      return 0
    fi
    sleep 0.5
  done
  echo "  (só ${prontos:-0}/${esperados} sims publicaram métrica nova em ${ESPERA_SIMS} s — seguindo)" >&2
}

# Encerra o processo do servidor que roda FORA do systemd (um `npm start` à mão). Os das unidades
# ficam: o cgroup deles é o da unidade (`…/pokeidle-sim@3.service`).
encerrar_soltos() {
  local pid cg
  for pid in $(pgrep -f 'server/index.mjs' 2>/dev/null || true); do
    cg="$(cat "/proc/${pid}/cgroup" 2>/dev/null || true)"
    case "$cg" in
      *pokeidle*.service*) continue ;;
    esac
    echo "  processo do servidor fora do systemd (pid ${pid}) — encerrando"
    fazer kill "$pid" 2>/dev/null || echo "  (não deu para encerrar o pid ${pid})" >&2
  done
}

# O BOT de convites, quando instalado. Reinicia por ultimo e sem esperar nada: ele nao atende
# jogador nenhum (o `/resgatar` e do sim), entao uma queda de segundos so atrasa a contagem de
# quem entrar no Discord nesse intervalo — e o proprio bot reconecta e RETOMA a sessao, entao
# nem os eventos perdidos se perdem. Fora do `if` dos gateways de proposito: ele existe nas
# duas fases, ou em nenhuma.
reiniciar_bot() {
  systemctl is-enabled pokeidle-bot &>/dev/null || return 0
  fazer sudo systemctl restart pokeidle-bot \
    || echo "  (nao deu para reiniciar o pokeidle-bot — segue)" >&2
}

erro_sudo() {
  printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2
  echo "  Na VPS, como root: sudo bash $DESTINO/infra/atualizar-sudoers-deploy.sh" >&2
  exit 1
}

if [ -n "$(gateways_habilitados)" ]; then
  fazer sudo systemctl stop pokeidle 2>/dev/null || true
  encerrar_soltos

  mapfile -t GATEWAYS < <(gateways_habilitados)
  mapfile -t SIMS < <(sims_habilitados)
  PORTA_SAUDE="$(porta_do_gateway "${GATEWAYS[0]}")"

  # 1. Os sims. O `ts` de referência é tirado DEPOIS dos restarts: `systemctl restart` só volta
  #    quando o processo velho saiu, então nenhuma métrica com `ts` daqui para frente é dele.
  if [ "${#SIMS[@]}" -gt 0 ]; then
    for sim in "${SIMS[@]}"; do
      fazer sudo systemctl restart "$sim" \
        || erro_sudo "sem permissão para reiniciar $sim"
    done
    desde_ms="$(date +%s%3N)"
    esperar_sims "$desde_ms" "${#SIMS[@]}" "$PORTA_SAUDE"
  fi

  # 2. Os gateways, um de cada vez.
  for i in "${!GATEWAYS[@]}"; do
    gw="${GATEWAYS[$i]}"
    fazer sudo systemctl restart "$gw" \
      || erro_sudo "sem permissão para reiniciar $gw"
    if [ "${#GATEWAYS[@]}" -gt 1 ]; then
      esperar_gateway "$(porta_do_gateway "$gw")"
      if [ "$i" -lt $(( ${#GATEWAYS[@]} - 1 )) ]; then
        echo "  $gw de volta — próximo em ${PAUSA_ENTRE_GATEWAYS} s"
        pausar "$PAUSA_ENTRE_GATEWAYS"
      fi
    fi
  done
else
  fazer sudo systemctl restart pokeidle \
    || erro_sudo "sem permissão para reiniciar pokeidle"
fi

reiniciar_bot
