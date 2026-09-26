// Mata todos os processos do servidor (gateways e sims).
//
// Existe porque `pkill` não alcança processos nativos do Windows e os workers de simulação
// não escutam porta nenhuma — matar "quem está na porta 8080" deixa os sims órfãos, ainda
// inscritos no Redis, processando os mesmos jogadores em duplicidade.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { conectarBus, liberarTodasAsPosses, pub } from '../src/server/bus.mjs';

const exec = promisify(execFile);
const ehWindows = process.platform === 'win32';

if (ehWindows) {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*server/index.mjs*' -or $_.CommandLine -like '*server\\index.mjs*' } |
    ForEach-Object { Write-Output $_.ProcessId; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  const { stdout } = await exec('powershell', ['-NoProfile', '-Command', ps]);
  const pids = stdout.trim().split(/\s+/).filter(Boolean);
  console.log(pids.length ? `parados: ${pids.join(', ')}` : 'nada rodando');
} else {
  await exec('pkill', ['-f', 'server/index.mjs']).catch(() => {});
  console.log('parados (pkill)');
}

// Matar à força não roda o handler de saída, então a trava de posse ficaria de pé até o TTL
// e o próximo `npm start` se recusaria a subir. Limpamos aqui.
try {
  await conectarBus();
  const n = await liberarTodasAsPosses();
  if (n) console.log(`travas de shard liberadas: ${n}`);
  pub.disconnect();
  process.exit(0);
} catch {
  process.exit(0);
}
