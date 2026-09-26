#!/usr/bin/env bash
#
# Backup do Postgres → Google Drive, de hora em hora, mantendo os N mais recentes.
#
#   ./infra/backup-drive.sh              # um backup agora
#   MANTER=720 ./infra/backup-drive.sh   # muda a retenção só nesta rodada
#   ./infra/backup-drive.sh --listar     # o que está no Drive hoje
#   ./infra/backup-drive.sh --seco       # ensaia tudo, não sobe nem apaga nada
#
# Quem chama de hora em hora é o `pokeidle-backup.timer` (ver `infra/systemd/`). A instalação
# e o passo do navegador estão em `infra/BACKUP.md`.
#
# ### Por que o Drive e não o disco da VPS
#
# Backup no mesmo disco não é backup: se o `/dev/vda` morrer ou a VPS sumir, ele vai junto. E
# o banco aqui lastreia ORB em USDT — é dinheiro de gente, não um placar que se refaz. O Drive
# resolve as duas coisas de uma vez: fica fora da máquina e tem espaço que este banco não
# alcança nesta década.
#
# ### A ORDEM importa, e é esta
#
#   1. `pg_dump | gzip` para um arquivo de PASSAGEM em disco;
#   2. `gzip -t` nesse arquivo;
#   3. sobe para o Drive;
#   4. confere que ele chegou lá (nome e tamanho);
#   5. SÓ ENTÃO apaga os mais antigos que passarem da conta.
#
# O arquivo local existe por dois motivos e é apagado no passo 3: dá para verificar o gzip
# ANTES de gastar rede, e um upload que falhou pode ser repetido sem cobrar outro `pg_dump` do
# banco. Não é retenção local — são ~12 MB que vivem por segundos.
#
# A rotação vem por ÚLTIMO de propósito. Apagar antes de o novo estar no lugar é como trocar de
# corda no meio da escalada: numa noite em que a rede do Drive esteja fora, a ordem invertida
# gastaria uma cópia boa e não colocaria nada no lugar dela.
#
# ### A retenção, e a escada que está desligada
#
# O padrão é fila simples: 72 cópias horárias, três dias. Entra a nova, sai a mais antiga.
#
# O código faz mais que isso e vem desligado. Além das N mais recentes, ele sabe guardar a
# última cópia de cada DIA e a de cada SEMANA — três degraus que, com ~90 arquivos, alcançam
# três meses em vez de três dias. Ligar é dar valor a duas variáveis. O motivo de existir
# desligado: a fila responde a "quebrou hoje de manhã", e não a "descobri no fim de semana que
# a migração de terça comeu dado". No dia em que a segunda pergunta aparecer, a resposta já
# está escrita.
#
# ### O que este script NUNCA faz
#
# Apagar por idade de calendário. `--min-age 30d` parece equivalente e não é: se o timer ficar
# parado um mês (VPS desligada, token expirado), a primeira rodada depois apagaria TODAS as
# cópias por serem velhas, e as novas ainda não existiriam. Aqui se conta o que EXISTE — os 30
# últimos dias PRESENTES na pasta, não os 30 últimos dias do calendário. O pior caso de uma
# pausa longa é ficar com backups antigos, que é exatamente o que se quer nessa hora.
set -euo pipefail

# ---------------------------------------------------------------- configuração
#
# O `/etc/pokeidle-backup.env` é opcional e serve para mudar retenção ou pasta sem editar este
# arquivo (que é versionado e vem no deploy). Segredo nenhum mora nele: o token do Drive é do
# rclone e fica em `~/.config/rclone/rclone.conf`.
[ -f /etc/pokeidle-backup.env ] && . /etc/pokeidle-backup.env

CONTAINER="${CONTAINER:-game-postgres-1}"
PGUSER_="${PGUSER_:-poke}"
PGDB="${PGDB:-pokeidle}"
REMOTO="${REMOTO:-drive:PokeIdle-Backups}"
# 72 cópias horárias = 3 dias. Fila simples: entra a nova, sai a mais antiga.
#
# Os dois zeros são os degraus da ESCADA, desligados. A escada (última de cada dia, última de
# cada semana) existe inteira no código abaixo e liga com um valor: `MANTER_DIARIAS=30
# MANTER_SEMANAIS=12` dá três meses de alcance por ~90 arquivos. Fica pronta para o dia em que
# "descobri o problema na semana passada" acontecer — sem ela, três dias é tudo que há.
MANTER_HORARIAS="${MANTER_HORARIAS:-72}"
MANTER_DIARIAS="${MANTER_DIARIAS:-0}"
MANTER_SEMANAIS="${MANTER_SEMANAIS:-0}"
# A passagem do dump. Fica no `/tmp` de propósito: sob o systemd este serviço roda com
# `PrivateTmp=true`, que lhe dá um `/tmp` só dele, invisível para o resto da máquina e varrido
# no fim da execução. O arquivo vive segundos e some sozinho mesmo se o script for morto.
PASSAGEM="${PASSAGEM:-/tmp/pokeidle-backup}"
RCLONE="${RCLONE:-rclone}"
# ONDE mora o token do Drive.
#
# Explícito, e fora do padrão do rclone (`$HOME/.config/rclone`), por um detalhe desta máquina:
# o HOME do usuário do jogo É `/opt/pokeidle`, o diretório do repositório. O padrão poria um
# segredo com refresh token dentro de uma árvore de git — de onde ele apareceria em `git status`
# e viajaria em qualquer `tar` do diretório. `/etc/pokeidle/` não tem esse problema e não depende
# de quem é o HOME do usuário que roda o script.
RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/pokeidle/rclone.conf}"
export RCLONE_CONFIG
# Acima disto o script avisa. Não apaga nada e não falha — é tripwire, não trava: quem decide o
# que fazer quando a pasta cresce é gente, e o aviso é para essa decisão não chegar de surpresa.
ALERTA_GIB="${ALERTA_GIB:-10}"
# Webhook opcional (formato Discord). Vazio = só o journal.
ALERTA_WEBHOOK="${ALERTA_WEBHOOK:-}"

SECO=0
LISTAR=0
for a in "$@"; do
  case "$a" in
    --seco|--dry-run) SECO=1 ;;
    --listar|--list) LISTAR=1 ;;
    --help|-h) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "opção desconhecida: $a" >&2; exit 2 ;;
  esac
done

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

# ---------------------------------------------------------------- alarme
#
# Um backup que falha calado é pior que não ter backup: dá a sensação de estar coberto. O `trap`
# abaixo pega QUALQUER saída diferente de zero — inclusive as do `set -e`, que são as que
# passariam desapercebidas — e grita no journal e no webhook.
avisar() {
  log "ALERTA: $*"
  [ -z "$ALERTA_WEBHOOK" ] && return 0
  local msg
  msg=$(printf '%s' "$*" | sed 's/"/\\"/g')
  curl -fsS -m 15 -H 'Content-Type: application/json' \
    -d "{\"content\":\"⚠️ **backup do PokeIdle** — $msg\"}" \
    "$ALERTA_WEBHOOK" >/dev/null 2>&1 || log "(o webhook de alerta também falhou)"
}

PASSO='iniciando'
# `SUBIU` existe para o alerta não mentir. Uma falha na ROTAÇÃO acontece depois de a cópia já
# estar salva no Drive, e dizer "sem cópia nova desta hora" ali mandaria alguém correr atrás de
# um backup que existe. São dois problemas de urgência bem diferente.
SUBIU=0
ao_morrer() {
  local codigo=$?
  [ "$codigo" -eq 0 ] && return 0
  if [ "$SUBIU" -eq 1 ]; then
    avisar "a cópia $NOME subiu, mas o script falhou depois em \`$PASSO\` (código $codigo) — o backup desta hora ESTÁ salvo; o que não rodou foi a limpeza"
  else
    avisar "falhou em \`$PASSO\` (código $codigo) — SEM cópia nova desta hora"
  fi
  rm -f "$LOCAL" 2>/dev/null || true
  exit "$codigo"
}
LOCAL=''
trap ao_morrer EXIT

precisa() { command -v "$1" >/dev/null 2>&1 || { PASSO="checando $1"; echo "falta o comando: $1" >&2; return 1; }; }
PASSO='conferindo dependências'
precisa "$RCLONE"
precisa docker
precisa gzip
precisa curl

# ---------------------------------------------------------------- --listar
if [ "$LISTAR" -eq 1 ]; then
  PASSO='listando o Drive'
  log "pasta: $REMOTO"
  "$RCLONE" lsf --files-only --include '*.sql.gz' "$REMOTO" | sort > /tmp/.bkp-lista.$$
  n=$(wc -l < /tmp/.bkp-lista.$$)
  if [ "$MANTER_DIARIAS" -gt 0 ] || [ "$MANTER_SEMANAIS" -gt 0 ]; then
    log "$n cópias (retenção: ${MANTER_HORARIAS}h + ${MANTER_DIARIAS}d + ${MANTER_SEMANAIS}s)"
  else
    log "$n cópias (retenção: as $MANTER_HORARIAS mais recentes)"
  fi
  if [ "$n" -gt 0 ]; then
    log "mais antiga: $(head -1 /tmp/.bkp-lista.$$)"
    log "mais nova:   $(tail -1 /tmp/.bkp-lista.$$)"
  fi
  "$RCLONE" size "$REMOTO" || true
  rm -f /tmp/.bkp-lista.$$
  trap - EXIT
  exit 0
fi

# ---------------------------------------------------------------- 1. o dump
#
# O nome é UTC e em ordem lexicográfica CRESCENTE = ordem cronológica. Não é estética: é o que
# deixa a rotação ser um `sort | head`, sem ler data de metadado nenhum. Trocar por horário
# local quebraria isso duas vezes por ano, no horário de verão.
STAMP="$(date -u '+%Y-%m-%d-%H%M')"
NOME="pokeidle-${STAMP}.sql.gz"
mkdir -p "$PASSAGEM"
LOCAL="$PASSAGEM/$NOME"

PASSO='pg_dump'
log "dump de $PGDB → $NOME"
# `--no-owner --no-acl`: o dump precisa restaurar em qualquer banco, inclusive num descartável
# de teste, e não num que já tenha os mesmos papéis. Mesmas flags do `tools/backup-db.mjs`.
#
# `-6` e não `-9`: medido em produção, o `-9` economiza 3% do tamanho pelo dobro do tempo de
# CPU. Numa máquina que já roda a simulação de mil e setecentos jogadores, 2 s valem mais que
# 300 kB.
#
# O `PIPESTATUS` existe porque `set -o pipefail` sozinho não diz QUEM falhou, e a diferença
# importa: `pg_dump` quebrado é banco com problema, `gzip` quebrado é disco cheio.
set -o pipefail
docker exec "$CONTAINER" pg_dump -U "$PGUSER_" -d "$PGDB" --no-owner --no-acl \
  | gzip -6 -c > "$LOCAL" || {
    avisar "pg_dump/gzip falhou (status: ${PIPESTATUS[*]})"
    exit 1
  }

TAM=$(stat -c '%s' "$LOCAL")
log "gerado: $(numfmt --to=iec --suffix=B "$TAM" 2>/dev/null || echo "$TAM bytes")"

# Um dump vazio ou minúsculo é um dump que não é dump — `pg_dump` pode sair 0 e escrever só o
# cabeçalho se o banco estiver num estado esquisito. 1 MiB é uma ordem de grandeza abaixo do
# tamanho real de hoje (~12 MiB) e nunca vai dar falso positivo enquanto o jogo tiver jogadores.
PASSO='conferindo o tamanho do dump'
if [ "$TAM" -lt 1048576 ]; then
  avisar "dump de só $TAM bytes — suspeito, não vou subir"
  exit 1
fi

# ---------------------------------------------------------------- 2. o gzip presta?
PASSO='gzip -t'
gzip -t "$LOCAL"
log "gzip íntegro"

if [ "$SECO" -eq 1 ]; then
  log "--seco: parando aqui, sem subir nem apagar (o arquivo de passagem foi removido)"
  rm -f "$LOCAL"
  trap - EXIT
  exit 0
fi

# ---------------------------------------------------------------- 3. sobe
#
# `moveto` e não `copyto`: ele sobe e apaga o local no mesmo comando, então o arquivo de
# passagem não sobrevive ao sucesso. O Drive só mostra o arquivo quando o upload FECHA (é
# upload resumível), então uma queda de rede no meio não deixa meio-backup com cara de backup.
PASSO='upload para o Drive'
log "subindo para $REMOTO/"
"$RCLONE" moveto "$LOCAL" "$REMOTO/$NOME" --drive-chunk-size 16M
LOCAL=''

# ---------------------------------------------------------------- 4. chegou mesmo?
#
# Confiar no código de saída do upload não basta para autorizar o passo 5, que APAGA. Aqui se
# pergunta ao Drive se o arquivo existe e se o tamanho bate com o que saiu daqui.
PASSO='conferindo o arquivo no Drive'
REMOTO_TAM=$("$RCLONE" lsjson "$REMOTO/$NOME" 2>/dev/null | grep -o '"Size":[0-9]*' | head -1 | cut -d: -f2 || true)
if [ -z "$REMOTO_TAM" ]; then
  avisar "subiu sem erro mas o arquivo não aparece no Drive: $NOME"
  exit 1
fi
if [ "$REMOTO_TAM" != "$TAM" ]; then
  avisar "tamanho não bate: local $TAM, Drive $REMOTO_TAM ($NOME)"
  exit 1
fi
log "confirmado no Drive: $NOME ($REMOTO_TAM bytes)"
SUBIU=1

# ---------------------------------------------------------------- 5. rotação
#
# Agora, e só agora, com a cópia nova confirmada no lugar.
#
# A conta é feita ao contrário do intuitivo: em vez de listar o que APAGAR, monta-se a lista do
# que FICA e apaga-se o complemento. É o que torna impossível um degrau esquecido virar perda de
# dado — o que não foi explicitamente salvo some, e por isso as três regras abaixo são a
# definição inteira da retenção, sem nada implícito em outro lugar.
PASSO='listando para a rotação'
LISTA="$(mktemp)"
FICA="$(mktemp)"
DIAS="$(mktemp)"
limpar_listas() { rm -f "$LISTA" "$FICA" "$DIAS"; }

"$RCLONE" lsf --files-only --include '*.sql.gz' "$REMOTO" | sort > "$LISTA"
TOTAL=$(wc -l < "$LISTA")

# Uma listagem VAZIA logo depois de um upload confirmado não é "pasta vazia", é listagem que
# falhou. Sem este `if`, o passo seguinte acharia que não há nada para manter.
if [ "$TOTAL" -eq 0 ]; then
  limpar_listas
  avisar "a listagem do Drive voltou vazia logo depois de um upload confirmado — não confio nela"
  exit 1
fi

PASSO='montando a lista do que fica'

# As N mais recentes — sozinha, esta linha já é a fila simples do padrão. `tail` sobre a lista ordenada por nome, que é ordem cronológica.
[ "$MANTER_HORARIAS" -gt 0 ] && tail -n "$MANTER_HORARIAS" "$LISTA" >> "$FICA"

# A última cópia de cada DIA presente. `pokeidle-2026-09-10-0117.sql.gz` partido por `-` dá
# ano/mês/dia nos campos 2, 3 e 4. Como a lista chega ordenada, a última atribuição de cada
# chave é a cópia mais nova daquele dia.
awk -F'-' '{ dia = $2"-"$3"-"$4; ultimo[dia] = $0 }
           END { for (d in ultimo) print d"	"ultimo[d] }' "$LISTA" | sort > "$DIAS"

# Degrau 2 — os últimos D dias que EXISTEM na pasta (não do calendário: ver o cabeçalho).
[ "$MANTER_DIARIAS" -gt 0 ] && tail -n "$MANTER_DIARIAS" "$DIAS" | cut -f2 >> "$FICA"

# Degrau 3 — a última cópia de cada semana ISO. O `date` roda uma vez por DIA distinto (algumas
# dezenas), e não uma vez por arquivo: é a mesma resposta com uma fração das chamadas.
if [ "$MANTER_SEMANAIS" -gt 0 ]; then
  while IFS="$(printf '	')" read -r dia arq; do
    [ -z "$dia" ] && continue
    sem=$(date -u -d "$dia" '+%G-%V' 2>/dev/null) || continue
    printf '%s	%s
' "$sem" "$arq"
  done < "$DIAS"     | sort     | awk -F'	' '{ ultimo[$1] = $2 } END { for (w in ultimo) print w"	"ultimo[w] }'     | sort | tail -n "$MANTER_SEMANAIS" | cut -f2 >> "$FICA"
fi

sort -u "$FICA" -o "$FICA"
QUANTOS_FICAM=$(wc -l < "$FICA")

# Duas invariantes antes de apagar qualquer coisa. Elas não deveriam poder falhar — e é por isso
# que valem: se falharem, alguma premissa acima está errada e apagar seria o pior próximo passo.
PASSO='conferindo a retenção antes de apagar'
if [ "$QUANTOS_FICAM" -eq 0 ]; then
  limpar_listas
  avisar "a retenção não selecionou NENHUMA cópia para manter — não vou apagar nada"
  exit 1
fi
# A cópia desta hora tem de estar na lista do que fica. Se ela não está, a conta está quebrada de
# um jeito que apagaria justamente o backup mais novo.
if ! grep -qxF "$NOME" "$FICA"; then
  limpar_listas
  avisar "a cópia recém-enviada ($NOME) não entrou na retenção — não vou apagar nada"
  exit 1
fi

comm -23 "$LISTA" "$FICA" > "$LISTA.apagar"
SOBRANDO=$(wc -l < "$LISTA.apagar")
if [ "$MANTER_DIARIAS" -gt 0 ] || [ "$MANTER_SEMANAIS" -gt 0 ]; then
  log "$TOTAL cópias · retenção mantém $QUANTOS_FICAM (${MANTER_HORARIAS}h + ${MANTER_DIARIAS}d + ${MANTER_SEMANAIS}s)"
else
  log "$TOTAL cópias · retenção mantém as $QUANTOS_FICAM mais recentes"
fi

if [ "$SOBRANDO" -gt 0 ]; then
  PASSO='apagando o que saiu da retenção'
  log "apagando $SOBRANDO cópia(s)"
  # Em regime normal isto apaga UMA por hora, e um laço com uma chamada por arquivo daria no
  # mesmo. O `--files-from` existe para a outra rodada: a primeira depois de alguém apertar a
  # retenção (ou depois de uma pausa longa), quando a lista tem centenas. Medido: 1.361 arquivos
  # levaram 4 minutos um a um, e cada chamada dessas é uma ida à API do Google.
  head -20 "$LISTA.apagar" | sed 's/^/  − /'
  [ "$SOBRANDO" -gt 20 ] && log "  … e mais $(( SOBRANDO - 20 ))"
  "$RCLONE" delete --files-from "$LISTA.apagar" "$REMOTO"
else
  log "nada a apagar"
fi
rm -f "$LISTA.apagar"
limpar_listas

# ---------------------------------------------------------------- 6. tripwire de tamanho
#
# O banco cresce todo dia, e a pasta guarda 720 fotos dele. Este aviso é para o dia em que a
# conta mudar de ordem de grandeza chegar como aviso, e não como surpresa.
PASSO='medindo a pasta'
# Conta e bytes saem do MESMO `rclone size`, depois da rotação. Usar o `$TOTAL` de antes aqui
# fazia o log dizer "30MB em 10 cópias" na rodada em que cinco tinham acabado de ser apagadas —
# um número certo e um errado na mesma linha, que é o jeito mais rápido de perder a confiança
# no log inteiro.
MEDIDA=$("$RCLONE" size --json "$REMOTO" 2>/dev/null || echo '')
BYTES=$(printf '%s' "$MEDIDA" | grep -o '"bytes":[0-9]*' | head -1 | cut -d: -f2 || echo 0)
AGORA=$(printf '%s' "$MEDIDA" | grep -o '"count":[0-9]*' | head -1 | cut -d: -f2 || echo 0)
if [ -n "$BYTES" ] && [ "$BYTES" -gt 0 ]; then
  log "pasta: $(numfmt --to=iec --suffix=B "$BYTES" 2>/dev/null || echo "$BYTES bytes") em ${AGORA:-?} cópias"
  LIMITE=$(( ALERTA_GIB * 1073741824 ))
  if [ "$BYTES" -gt "$LIMITE" ]; then
    avisar "a pasta de backups passou de ${ALERTA_GIB} GiB (${AGORA:-?} cópias). Hora de olhar a retenção ou a poda dos logs de auditoria."
  fi
fi

log "pronto"
trap - EXIT
