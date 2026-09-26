# Envia public/data/ (catalogo + sprites) para producao via scp.
#
# Rode na raiz do repo, DEPOIS de preparar os assets localmente:
#   npm run nomeador:build       # PNG -> WEBP no LAB (se houve sprites novos)
#   npm run publicar:sprites     # LAB -> public/data/asset-packs/
#   npm run sync:sprites         # looktypes + shiny catalog em game/src/server/dados/
#   npm run marker-atlas         # marker-atlas.png/json -> public/data/site/assets/maps/
#   Nomeador Moves -> Salvar TM Elemental  # public/data/effects/tm-elemental/
#   git push                     # codigo (deploy.sh na VPS NAO baixa sprites)
#
# Este script envia public/data/: JSONs, items-icons, icones de loot, marker-atlas e asset-packs/.
# Arte da Super Ball (icone + efeitos de captura) fica em game/src/client/ — vai no git push.
#
# Uso:
#   .\infra\deploy-public-data.ps1
#   .\infra\deploy-public-data.ps1 -SomenteJson
#   .\infra\deploy-public-data.ps1 -SemRestart   # sobe assets, deploy.sh reinicia depois
#   .\infra\deploy-public-data.ps1 -ScpRecursivo
#   .\infra\deploy-public-data.ps1 -Servidor root@207.246.72.228
#
# Padrao: compacta tudo num .tar.gz e sobe 1 arquivo (~2-4 min).
# -ScpRecursivo: modo antigo (scp -r arquivo por arquivo, ~20+ min).

param(
  [string]$Servidor = 'root@207.246.72.228',
  [string]$Destino = '/opt/pokeidle/public/data',
  [switch]$SomenteJson,
  [switch]$SemRestart,
  [switch]$ScpRecursivo
)

$ErrorActionPreference = 'Stop'

$Raiz = Resolve-Path (Join-Path $PSScriptRoot '..')
$Data = Join-Path $Raiz 'public\data'

function Assert-Cmd($nome) {
  if (-not (Get-Command $nome -ErrorAction SilentlyContinue)) {
    throw "$nome nao encontrado. Instale o OpenSSH Client (Windows) ou use Git Bash."
  }
}

function Assert-Arquivo($rel) {
  $caminho = Join-Path $Data $rel
  if (-not (Test-Path -LiteralPath $caminho)) {
    throw "Arquivo ausente: $caminho`nPrepare public/data localmente (publicar:sprites, build-indexes, etc.)."
  }
  return $caminho
}

function Scp-Arquivo($local, $remoto) {
  Write-Host "  -> $remoto" -ForegroundColor Cyan
  & scp $local "${Servidor}:${remoto}"
  if ($LASTEXITCODE -ne 0) { throw "scp falhou: $local" }
}

function Invoke-Ssh($cmd) {
  & ssh $Servidor $cmd
  if ($LASTEXITCODE -ne 0) { throw "ssh falhou: $cmd" }
}

function Deploy-AssetPacksTar {
  Assert-Cmd tar
  $null = Assert-Arquivo 'asset-packs'

  $stamp = Get-Date -Format 'yyyyMMddHHmmss'
  $localArchive = Join-Path $env:TEMP "pokeidle-deploy-$stamp.tar.gz"
  $remoteArchive = "/tmp/pokeidle-deploy-$stamp.tar.gz"

  Write-Host ""
  Write-Host "Sprites (asset-packs/ via tar.gz - 1 upload)" -ForegroundColor Yellow

  Write-Host "  compactando..." -ForegroundColor DarkGray
  Push-Location $Data
  try {
    & tar -czf $localArchive asset-packs
    if ($LASTEXITCODE -ne 0) { throw 'tar local falhou' }
  } finally {
    Pop-Location
  }

  $sizeMb = [math]::Round((Get-Item $localArchive).Length / 1MB, 1)
  Write-Host "  arquivo: $sizeMb MB" -ForegroundColor DarkGray

  Scp-Arquivo $localArchive $remoteArchive

  Write-Host "  extraindo no servidor..." -ForegroundColor DarkGray
  Invoke-Ssh "mkdir -p '$Destino' && tar -xzf '$remoteArchive' -C '$Destino' && rm -f '$remoteArchive'"

  Remove-Item -LiteralPath $localArchive -Force
}

function Deploy-AssetPacksScp {
  $pack = Assert-Arquivo 'asset-packs'
  Write-Host ""
  Write-Host "Sprites (asset-packs/ via scp -r - LENTO)" -ForegroundColor Yellow
  Write-Host "  -> $Destino/asset-packs/" -ForegroundColor Cyan
  & scp -r $pack "${Servidor}:${Destino}/"
  if ($LASTEXITCODE -ne 0) { throw 'scp falhou: asset-packs/' }
}

function Deploy-ItemIconsTar {
  Assert-Cmd tar
  $dirItens = Join-Path $Data 'site\assets\items'
  if (-not (Test-Path -LiteralPath $dirItens)) {
    throw "Pasta ausente: $dirItens`nRode fetch/import de itens ou copie os PNGs para public/data/site/assets/items/."
  }

  $stamp = Get-Date -Format 'yyyyMMddHHmmss'
  $localArchive = Join-Path $env:TEMP "pokeidle-item-icons-$stamp.tar.gz"
  $remoteArchive = "/tmp/pokeidle-item-icons-$stamp.tar.gz"

  Write-Host ""
  Write-Host "Icones de itens (site/assets/items/ via tar.gz - 1 upload)" -ForegroundColor Yellow

  Write-Host "  compactando..." -ForegroundColor DarkGray
  Push-Location $Data
  try {
    & tar -czf $localArchive site/assets/items
    if ($LASTEXITCODE -ne 0) { throw 'tar local falhou' }
  } finally {
    Pop-Location
  }

  $count = (Get-ChildItem -LiteralPath $dirItens -File).Count
  $sizeMb = [math]::Round((Get-Item $localArchive).Length / 1MB, 1)
  Write-Host "  $count arquivo(s), $sizeMb MB" -ForegroundColor DarkGray

  Scp-Arquivo $localArchive $remoteArchive

  Write-Host "  extraindo no servidor..." -ForegroundColor DarkGray
  Invoke-Ssh "mkdir -p '$Destino/site/assets' && tar -xzf '$remoteArchive' -C '$Destino' && rm -f '$remoteArchive'"

  Remove-Item -LiteralPath $localArchive -Force
}

function Deploy-ItemIconsScp {
  $dir = Join-Path $Data 'site\assets\items'
  if (-not (Test-Path -LiteralPath $dir)) {
    throw "Pasta ausente: $dir`nRode fetch/import de itens ou copie os PNGs para public/data/site/assets/items/."
  }
  Write-Host ""
  Write-Host "Icones de itens (site/assets/items/ via scp -r - LENTO)" -ForegroundColor Yellow
  Invoke-Ssh "mkdir -p '$Destino/site/assets/items'"
  Write-Host "  -> $Destino/site/assets/items/" -ForegroundColor Cyan
  & scp -r $dir "${Servidor}:${Destino}/site/assets/"
  if ($LASTEXITCODE -ne 0) { throw 'scp falhou: site/assets/items/' }
}

function Deploy-TmElemental {
  $dir = Join-Path $Data 'effects\tm-elemental'
  if (-not (Test-Path -LiteralPath $dir)) {
    throw "Pasta ausente: $dir`nNo Nomeador (Moves > TM Elemental), clique em Salvar TM Elemental."
  }
  $null = Assert-Arquivo 'effects\tm-elemental\index.json'
  Write-Host ""
  Write-Host "Efeitos TM Elemental (effects/tm-elemental/)" -ForegroundColor Yellow
  Invoke-Ssh "mkdir -p '$Destino/effects/tm-elemental'"
  Write-Host "  -> $Destino/effects/tm-elemental/" -ForegroundColor Cyan
  & scp -r $dir "${Servidor}:${Destino}/effects/"
  if ($LASTEXITCODE -ne 0) { throw 'scp falhou: effects/tm-elemental/' }
}

Assert-Cmd scp
if (-not $SemRestart) { Assert-Cmd ssh }

$jsons = @(
  @{ Local = 'creatures.json'; Remoto = "$Destino/creatures.json" },
  @{ Local = 'items.json'; Remoto = "$Destino/items.json" },
  @{ Local = 'items-icons.json'; Remoto = "$Destino/items-icons.json" },
  @{ Local = 'index\spawns-index.json'; Remoto = "$Destino/index/spawns-index.json" },
  @{ Local = 'index\loot-index.json'; Remoto = "$Destino/index/loot-index.json" },
  @{ Local = 'index\moves-index.json'; Remoto = "$Destino/index/moves-index.json" },
  @{ Local = 'index\formulas.json'; Remoto = "$Destino/index/formulas.json" },
  @{ Local = 'world\walkgrids.json'; Remoto = "$Destino/world/walkgrids.json" }
)

Write-Host ""
Write-Host "> Deploy public/data -> ${Servidor}:${Destino}" -ForegroundColor Green

Write-Host ""
Write-Host "JSON (creatures, spawns, loot...)" -ForegroundColor Yellow
foreach ($j in $jsons) {
  $local = Assert-Arquivo $j.Local
  Scp-Arquivo $local $j.Remoto
}

$atlas = @(
  @{ Local = 'site\assets\maps\marker-atlas.png'; Remoto = "$Destino/site/assets/maps/marker-atlas.png" },
  @{ Local = 'site\assets\maps\marker-atlas.json'; Remoto = "$Destino/site/assets/maps/marker-atlas.json" }
)

Write-Host ""
Write-Host "Mapa (marker-atlas.png + .json)" -ForegroundColor Yellow
foreach ($a in $atlas) {
  $local = Assert-Arquivo $a.Local
  Scp-Arquivo $local $a.Remoto
}

if ($ScpRecursivo) {
  Deploy-ItemIconsScp
} else {
  Deploy-ItemIconsTar
}

Deploy-TmElemental

if (-not $SomenteJson) {
  if ($ScpRecursivo) {
    Deploy-AssetPacksScp
  } else {
    Deploy-AssetPacksTar
  }
} else {
  Write-Host ""
  Write-Host "(asset-packs pulado - omita -SomenteJson para enviar sprites)" -ForegroundColor DarkGray
}

if (-not $SemRestart) {
  Write-Host ""
  Write-Host "Reiniciando servicos (Fase 1 ou gateway+sims)..." -ForegroundColor Yellow
  Invoke-Ssh 'bash /opt/pokeidle/infra/reiniciar-servicos.sh'
  Write-Host "  systemd restart ok" -ForegroundColor Green
}

$c = (Get-Content (Join-Path $Data 'creatures.json') -Raw | ConvertFrom-Json).creatures.Count
Write-Host ""
Write-Host "Pronto - creatures.json com $c especies." -ForegroundColor Green
Write-Host "  Jogadores: Shift+F5 no browser para recarregar sprites."
Write-Host ""
