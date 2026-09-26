@echo off
REM Restaura backup local — delega para restore-db.ps1 (contorna bloqueio de .ps1 baixado do Git).
REM Uso: cd C:\PokeIdle-io\game && tools\restore-db.cmd
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-db.ps1" %*
exit /b %ERRORLEVEL%
