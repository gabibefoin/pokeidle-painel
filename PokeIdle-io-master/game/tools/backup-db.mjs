#!/usr/bin/env node
/**
 * Backup do Postgres → arquivo .sql.gz na sua máquina (sem browser).
 *
 * Uso local (Docker do `npm run infra`):
 *   node tools/backup-db.mjs
 *   npm run backup:db
 *
 * Pasta padrão no Windows:
 *   %USERPROFILE%\Desktop\POKE IDLE BACKUPS
 *
 * Produção (SSH + docker compose no VPS):
 *   node tools/backup-db.mjs --ssh pokeidle@seu-servidor
 *   node tools/backup-db.mjs --ssh root@1.2.3.4 --remoto /opt/pokeidle/game
 *
 * Opções:
 *   --out <pasta>     destino (cria se não existir)
 *   --url <postgres>  DATABASE_URL (senão lê game/.env)
 *   --ssh <user@host> pg_dump via SSH no servidor
 *   --remoto <pasta>  diretório do game no VPS (padrão /opt/pokeidle/game)
 *   --container <n>   nome do container Docker local (auto-detecta se omitido)
 */
import { readFile, mkdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { pokeIdleBackups } from '../../tools/caminhos.mjs';

const raizGame = join(dirname(fileURLToPath(import.meta.url)), '..');
const pastaPadrao = platform() === 'win32'
  ? pokeIdleBackups()
  : join(raizGame, 'backups');

const args = process.argv.slice(2);
const flag = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : null;
};
const tem = (nome) => args.includes(nome);

if (tem('--help') || tem('-h')) {
  readFile(fileURLToPath(import.meta.url), 'utf8')
    .then((t) => { console.log(t.split('\n').slice(0, 18).join('\n')); })
    .catch((err) => { console.error(err.message); process.exit(1); });
} else {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

async function main() {
  const pastaOut = flag('--out') ?? pastaPadrao;
  const databaseUrl = flag('--url') ?? await lerDatabaseUrl();
  const ssh = flag('--ssh');
  const remoto = flag('--remoto') ?? '/opt/pokeidle/game';
  const containerForcado = flag('--container');

  await mkdir(pastaOut, { recursive: true });

  const stamp = new Date();
  const caminho = join(pastaOut, `pokeidle-${fmtData(stamp)}.sql.gz`);

  console.log(`Destino: ${caminho}`);

  const t0 = Date.now();
  if (ssh) {
    await backupViaSsh(ssh, remoto, caminho);
  } else if (await tentarDockerLocal(containerForcado, caminho)) {
    // ok
  } else if (databaseUrl) {
    await backupViaUrl(databaseUrl, caminho);
  } else {
    console.error(
      'Não achei Postgres.\n'
      + '  • Local: `npm run infra` e tente de novo\n'
      + '  • Produção: node tools/backup-db.mjs --ssh usuario@servidor\n'
      + '  • Ou passe --url postgres://...',
    );
    process.exit(1);
  }

  const { size } = await stat(caminho);
  console.log(`Pronto em ${((Date.now() - t0) / 1000).toFixed(1)}s — ${fmtBytes(size)}`);
  console.log(caminho);
}

async function gravar(entrada, destino) {
  await pipeline(entrada, createGzip(), createWriteStream(destino));
}

async function lerDatabaseUrl() {
  try {
    const txt = await readFile(join(raizGame, '.env'), 'utf8');
    for (const lin of txt.split('\n')) {
      const m = lin.match(/^DATABASE_URL=(.+)$/);
      if (m) return m[1].trim();
    }
  } catch {
    /* sem .env */
  }
  return null;
}

function fmtData(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function rodarTexto(cmd, cmdArgs, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, cmdArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let out = '';
    let err = '';
    proc.stdout.on('data', (c) => { out += c; });
    proc.stderr.on('data', (c) => { err += c; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `${cmd} saiu com código ${code}`));
    });
  });
}

async function containerPostgres(forced) {
  if (forced) return forced;
  try {
    const out = await rodarTexto('docker', ['ps', '--format', '{{.Names}}', '--filter', 'name=postgres']);
    const nomes = out.trim().split('\n').filter(Boolean);
    return nomes.find((n) => /postgres/i.test(n)) ?? nomes[0] ?? null;
  } catch {
    return null;
  }
}

async function tentarDockerLocal(forced, destino) {
  const container = await containerPostgres(forced);
  if (!container) return false;
  console.log(`Docker: ${container}`);
  const dump = spawn(
    'docker',
    ['exec', container, 'pg_dump', '-U', 'poke', '-d', 'pokeidle', '--no-owner', '--no-acl'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let err = '';
  dump.stderr.on('data', (c) => { err += c; });
  await gravar(dump.stdout, destino);
  const code = await new Promise((r) => dump.on('close', r));
  if (code !== 0) throw new Error(err.trim() || `pg_dump falhou (${code})`);
  return true;
}

async function backupViaUrl(url, destino) {
  console.log('pg_dump via DATABASE_URL…');
  const dump = spawn('pg_dump', [url, '--no-owner', '--no-acl'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  dump.stderr.on('data', (c) => { err += c; });
  await gravar(dump.stdout, destino);
  const code = await new Promise((r) => dump.on('close', r));
  if (code !== 0) {
    throw new Error(
      err.trim()
      || 'pg_dump não encontrado ou conexão recusada — instale o cliente Postgres ou use Docker (`npm run infra`).',
    );
  }
}

async function backupViaSsh(alvo, dirRemoto, destino) {
  const cmd = `cd ${shellQuote(dirRemoto)} && docker compose exec -T postgres pg_dump -U poke pokeidle --no-owner --no-acl`;
  console.log(`SSH: ${alvo}`);
  console.log(`Remoto: ${dirRemoto}`);
  const dump = spawn('ssh', [alvo, cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  dump.stderr.on('data', (c) => { err += c; });
  await gravar(dump.stdout, destino);
  const code = await new Promise((r) => dump.on('close', r));
  if (code !== 0) throw new Error(err.trim() || `SSH/pg_dump falhou (${code})`);
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
