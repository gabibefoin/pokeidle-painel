# Sobe SO O BOT DE CONVITES para producao, sem tocar no jogo.
#
#   .\infra\subir-bot.ps1 -Conferir     # so mostra o que faria
#   .\infra\subir-bot.ps1               # envia, instala a unidade e liga o bot
#   .\infra\subir-bot.ps1 -Parar        # para e desabilita o bot (desfaz o start)
#
# ### Por que nao e um `git push`
#
# Push no master dispara o GitHub Actions, que chama o `deploy.sh` e implanta o jogo INTEIRO.
# Isso e o oposto do que este script existe para fazer: pos o bot no ar e deixar o jogo na
# versao que ja esta rodando, para o bot ser testado em producao sem arrastar o resto junto.
#
# Pelo mesmo motivo nao da para fazer `git fetch` + `git checkout <paths>` na VPS: os commits
# precisariam estar na origem, e por na origem e disparar o deploy.
#
# ### O que vai, e por que so isso
#
# A cadeia de imports do bot, inteira. Cinco arquivos NOVOS e UM modificado:
#
#   src/bot/discord.mjs         novo   Gateway + REST do Discord (so `ws` e `fetch`)
#   src/bot/convites.mjs        novo   a atribuicao (quem entrou por qual link)
#   src/bot/radar.mjs           novo   os radares (shiny, saque, deposito) e o texto deles
#   src/bot/index.mjs           novo   o processo
#   src/server/convites-db.mjs  novo   as duas tabelas e o resgate atomico
#   src/server/radar-db.mjs     novo   o cursor dos radares e as quatro consultas
#   src/shared/convites.mjs     novo   a escada de marcos e o formato do codigo
#   src/server/game/diamantes.mjs  MODIFICADO  ganha MOTIVO.CONVITE
#
# ### Os RADARES, e por que eles nao pedem deploy do jogo
#
# O radar SO LE o banco: `player_pokemon` (shiny novo), `orb_saques` e `orb_depositos`. Nada no
# jogo muda, nenhuma coluna e' acrescentada, nenhum indice e' criado numa tabela que ja existe.
# A unica escrita e' a `radar_cursor`, tabela nova e so do bot.
#
# No primeiro boot os cursores nascem apontando para a ultima linha que JA existe -- o canal
# comeca do zero, sem despejar o historico do servidor em rajada.
#
# O bot passa a carregar `src/server/content.mjs` (o catalogo) para dizer a especie do shiny e
# calcular a NOTA com a mesma funcao do cliente. Sao ~100 ms e ~30 MB no boot. Esse arquivo e a
# cadeia de `src/shared/` dele NAO vao nesta copia: ja estao na VPS e nao mudaram -- e e' bom
# que seja assim, porque assim a nota do canal e' a da versao do jogo que esta no ar.
#
# `config.mjs`, `db.mjs`, `diamantes-db.mjs` e `cofre.mjs` ja estao na VPS e nao mudaram —
# conferido contra `origin/master`, inclusive o `movimentarNaTransacao` que o resgate usa.
#
# O UNICO modificado e aditivo: uma constante nova e ela dentro de um Set. Se um processo do
# jogo reiniciar sozinho (as unidades tem `Restart=always`) e carregar esse arquivo, nada muda,
# porque nada no jogo v1.132.1 referencia CONVITE.
#
# ### O que o bot faz no banco DE PRODUCAO no primeiro boot
#
# `migrar()` cria `convite_membros` e `convite_codigos`. `CREATE TABLE IF NOT EXISTS` mais dois
# indices em tabela nova e vazia: instantaneo, e nao trava nada que ja existe.
#
# ### A trava enquanto o jogo nao tem o /resgatar
#
# Ponha `DISCORD_BOT_SO_CONTAR=1` no `.env` da VPS ANTES de ligar. O bot conta, atribui e
# anuncia no canal, mas nao gera nem manda codigo — senao quem cruzasse um marco receberia um
# codigo que o cliente v1.132.1 nao sabe resgatar, e o `/resgatar` viraria mensagem publica no
# chat. Tire a variavel e reinicie o bot depois que o jogo subir.

param(
  [string]$Servidor = 'root@207.246.72.228',
  [string]$Destino = '/opt/pokeidle',
  [string]$Dono = 'pokeidle',
  [switch]$Conferir,
  [switch]$Parar
)

$ErrorActionPreference = 'Stop'
$Raiz = Resolve-Path (Join-Path $PSScriptRoot '..')

# Cada par: caminho local (relativo a raiz) e caminho remoto (relativo a $Destino).
$Arquivos = @(
  @{ Local = 'game\src\bot\discord.mjs';           Remoto = 'game/src/bot/discord.mjs' },
  @{ Local = 'game\src\bot\convites.mjs';          Remoto = 'game/src/bot/convites.mjs' },
  @{ Local = 'game\src\bot\radar.mjs';             Remoto = 'game/src/bot/radar.mjs' },
  @{ Local = 'game\src\bot\index.mjs';             Remoto = 'game/src/bot/index.mjs' },
  @{ Local = 'game\src\server\convites-db.mjs';    Remoto = 'game/src/server/convites-db.mjs' },
  @{ Local = 'game\src\server\radar-db.mjs';       Remoto = 'game/src/server/radar-db.mjs' },
  @{ Local = 'game\src\shared\convites.mjs';       Remoto = 'game/src/shared/convites.mjs' },
  @{ Local = 'game\src\server\game\diamantes.mjs'; Remoto = 'game/src/server/game/diamantes.mjs' },
  @{ Local = 'infra\systemd\pokeidle-bot.service'; Remoto = 'infra/systemd/pokeidle-bot.service' },
  @{ Local = 'infra\atualizar-sudoers-deploy.sh';  Remoto = 'infra/atualizar-sudoers-deploy.sh' },
  @{ Local = 'infra\reiniciar-servicos.sh';        Remoto = 'infra/reiniciar-servicos.sh' }
)

function Assert-Cmd($nome) {
  if (-not (Get-Command $nome -ErrorAction SilentlyContinue)) {
    throw "$nome nao encontrado. Instale o OpenSSH Client (Windows) ou use Git Bash."
  }
}
Assert-Cmd scp
Assert-Cmd ssh

function Remoto($comando) {
  if ($Conferir) {
    Write-Host "  [conferir] ssh: $comando" -ForegroundColor DarkGray
    return
  }
  & ssh $Servidor $comando
  if ($LASTEXITCODE -ne 0) { throw "comando remoto falhou: $comando" }
}

function Passo($texto) { Write-Host "`n> $texto" -ForegroundColor Cyan }

# ---------------------------------------------------------------- desligar
if ($Parar) {
  Passo 'parando e desabilitando o bot'
  Remoto 'systemctl disable --now pokeidle-bot 2>/dev/null || true'
  Write-Host "`nBot parado. Os arquivos continuam na VPS (inertes: nada os importa)." -ForegroundColor Yellow
  exit 0
}

# ------------------------------------------------------------- conferencias
Passo 'conferindo os arquivos locais'
foreach ($a in $Arquivos) {
  $caminho = Join-Path $Raiz $a.Local
  if (-not (Test-Path -LiteralPath $caminho)) { throw "Arquivo ausente: $caminho" }
  Write-Host ("  ok  " + $a.Local)
}

# O `.env` da VPS precisa das tres variaveis. Conferir ANTES de copiar arquivo evita deixar o
# sistema meio montado; e a mensagem diz exatamente o que falta.
Passo 'conferindo o .env da VPS'
if (-not $Conferir) {
  # O comando remoto vai numa string de ASPAS SIMPLES, com o caminho concatenado: o `$v` do laco
  # e' do shell da VPS, e numa string de aspas duplas o PowerShell o expandiria aqui (para vazio),
  # deixando o grep procurar por "^=." em toda linha. Foi o que fez a primeira versao deste
  # script jurar que as tres variaveis faltavam, com elas preenchidas.
  $env_ = "$Destino/game/.env"
  $cmd = 'for v in DISCORD_BOT_TOKEN DISCORD_GUILD_ID DISCORD_CANAL_CONVITES; do grep -qE "^$v=." ' + $env_ + ' || echo $v; done'
  $faltando = & ssh $Servidor $cmd
  if ($LASTEXITCODE -ne 0) { throw 'nao deu para ler o .env da VPS' }
  if ($faltando) {
    throw "faltam no .env da VPS: $($faltando -join ', ')"
  }
  Write-Host '  ok  as tres variaveis estao preenchidas'
  $soContar = & ssh $Servidor ('grep -qE "^DISCORD_BOT_SO_CONTAR=1" ' + $env_ + ' && echo sim || echo nao')
  if ($soContar -eq 'sim') {
    Write-Host '  ok  DISCORD_BOT_SO_CONTAR=1 — o bot vai CONTAR sem mandar codigo' -ForegroundColor Green
  } else {
    Write-Host '  ATENCAO: DISCORD_BOT_SO_CONTAR nao esta ligado.' -ForegroundColor Yellow
    Write-Host '  O bot vai mandar codigo no privado, e o jogo em producao ainda nao tem /resgatar.' -ForegroundColor Yellow
  }
}

# --------------------------------------------------------------- os arquivos
Passo 'enviando os arquivos'
Remoto "mkdir -p $Destino/game/src/bot $Destino/infra/systemd"
foreach ($a in $Arquivos) {
  $local = Join-Path $Raiz $a.Local
  $remoto = "$Destino/" + $a.Remoto
  Write-Host "  -> $remoto"
  if (-not $Conferir) {
    & scp $local "${Servidor}:${remoto}"
    if ($LASTEXITCODE -ne 0) { throw "scp falhou: $local" }
  }
}
# Tudo em /opt/pokeidle pertence ao usuario do jogo. Arquivo de root ali quebra o proximo
# `deploy.sh`, que roda como `pokeidle` e nao consegue sobrescrever.
Remoto "chown -R ${Dono}:${Dono} $Destino/game/src/bot $Destino/game/src/server/convites-db.mjs $Destino/game/src/server/radar-db.mjs $Destino/game/src/shared/convites.mjs $Destino/game/src/server/game/diamantes.mjs $Destino/infra"
Remoto "chmod +x $Destino/infra/atualizar-sudoers-deploy.sh $Destino/infra/reiniciar-servicos.sh"

# ------------------------------------------------------------- a unidade
Passo 'instalando a unidade do systemd'
Remoto "sed 's|__USUARIO__|$Dono|g; s|__DESTINO__|$Destino|g' $Destino/infra/systemd/pokeidle-bot.service > /etc/systemd/system/pokeidle-bot.service"
Remoto "bash $Destino/infra/atualizar-sudoers-deploy.sh --usuario $Dono"
Remoto 'systemctl daemon-reload'

# ---------------------------------------------------------------- ligar
Passo 'ligando o bot'
# `enable` e `restart`, e nao `enable --now`: o `--now` so LIGA o que estava parado, e com o
# servico ja no ar ele nao faz nada — o script terminava mostrando o log do boot anterior e
# dando a impressao de que o codigo novo tinha subido. `restart` vale para os dois casos.
Remoto 'systemctl enable pokeidle-bot'
Remoto 'systemctl restart pokeidle-bot'

Passo 'o que o bot disse no boot'
Remoto 'sleep 6; journalctl -u pokeidle-bot -n 40 --no-pager'

Write-Host "`nPronto. O jogo NAO foi reiniciado e continua na versao que estava." -ForegroundColor Green
Write-Host 'Acompanhar:  ssh ' -NoNewline; Write-Host "$Servidor 'journalctl -u pokeidle-bot -f'"
Write-Host 'Desfazer:    .\infra\subir-bot.ps1 -Parar'
