@echo off
REM Backup Postgres — delega para backup-db.ps1 (contorna bloqueio de .ps1 baixado do Git).
REM Uso: cd C:\PokeIdle-io\game && tools\backup-db.cmd
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-db.ps1" %*
exit /b %ERRORLEVEL%
