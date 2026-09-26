# Restaura backup .sql.gz no Postgres local (Docker)
# Duplo-clique ou, no PowerShell:
#   cd C:\PokeIdle-io\game
#   .\tools\restore-db.ps1
#
# Backup específico:
#   .\tools\restore-db.ps1 -Arquivo "$env:USERPROFILE\Desktop\POKE IDLE BACKUPS\pokeidle-....sql.gz"
#
# Restaura e já sobe o servidor:
#   .\tools\restore-db.ps1 -Iniciar

param(
  [string]$Arquivo = "",
  [string]$Pasta = (Join-Path $env:USERPROFILE "Desktop\POKE IDLE BACKUPS"),
  [switch]$SemParar,
  [switch]$SemInfra,
  [switch]$Iniciar
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not $SemParar) {
  Write-Host "Parando servidor local..." -ForegroundColor Cyan
  npm run stop
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not $SemInfra) {
  Write-Host "Subindo Postgres (Docker)..." -ForegroundColor Cyan
  npm run infra
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$argsNode = @("tools/restore-db.mjs")
if ($Arquivo) {
  $argsNode += $Arquivo
} else {
  $maisRecente = Get-ChildItem -Path $Pasta -Filter "pokeidle-*.sql.gz" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $maisRecente) {
    Write-Host "Nenhum backup em: $Pasta" -ForegroundColor Red
    Write-Host 'Baixe antes: .\tools\backup-db.ps1 -Ssh "root@207.246.72.228"'
    exit 1
  }
  $Arquivo = $maisRecente.FullName
  Write-Host "Usando backup mais recente: $Arquivo" -ForegroundColor Yellow
  $argsNode += $Arquivo
}

node @argsNode
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Banco local restaurado." -ForegroundColor Green

if ($Iniciar) {
  Write-Host "Subindo servidor..." -ForegroundColor Cyan
  npm start
} else {
  Write-Host "Próximo passo: npm start" -ForegroundColor Green
  Write-Host "Conta Google? npm run dev:sessao -- seu@email.com" -ForegroundColor DarkGray
}
