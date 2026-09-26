#!/usr/bin/env node
/** Encerra o nomeador na porta 5174 (Windows). */
import { execSync } from 'node:child_process';

const PORT = Number(process.env.NOMEADOR_PORT) || 5174;
try {
  const out = execSync(
    `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' } | Select-Object -First 1).OwningProcess"`,
    { encoding: 'utf8' },
  ).trim();
  const pid = Number(out);
  if (!pid) {
    console.log(`porta ${PORT} livre`);
    process.exit(0);
  }
  process.kill(pid, 'SIGTERM');
  console.log(`nomeador parado (PID ${pid})`);
} catch {
  console.log(`porta ${PORT} livre`);
}
