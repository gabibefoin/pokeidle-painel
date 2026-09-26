# Backup do Postgres → Desktop\POKE IDLE BACKUPS
# Duplo-clique ou, no PowerShell:
#   cd C:\PokeIdle-io\game
#   .\tools\backup-db.ps1
#   .\tools\backup-db.cmd -Ssh "root@207.246.72.228"   ← contorna bloqueio de script baixado do Git
#
# Produção (baixa do VPS para a mesma pasta):
#   .\tools\backup-db.ps1 -Ssh "pokeidle@seu-servidor"

param(
  [string]$Ssh = "",
  [string]$Out = (Join-Path $env:USERPROFILE "Desktop\POKE IDLE BACKUPS"),
  [string]$Remoto = "/opt/pokeidle/game"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$argsNode = @("tools/backup-db.mjs", "--out", $Out)
if ($Ssh) {
  $argsNode += @("--ssh", $Ssh, "--remoto", $Remoto)
}

node @argsNode
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ""
Write-Host "Backup salvo em: $Out" -ForegroundColor Green
