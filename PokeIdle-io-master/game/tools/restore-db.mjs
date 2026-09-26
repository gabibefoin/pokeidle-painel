#!/usr/bin/env node
/**
 * Restaura um backup .sql.gz no Postgres local (Docker).
 *
 *   node tools/restore-db.mjs
 *   node tools/restore-db.mjs "%USERPROFILE%\Desktop\POKE IDLE BACKUPS\pokeidle-....sql.gz"
 *   npm run restore:db
 *
 * Apaga o banco local `pokeidle` e recria do zero. Pare o servidor antes (`npm run stop`)
 * para o flush não sobrescrever nada durante a importação.
 */
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createGunzip } from 'node:zlib';
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

let arquivo = args.find((a) => !a.startsWith('--')) ?? flag('--arquivo');
if (!arquivo) arquivo = await backupMaisRecente(pastaPadrao);
if (!arquivo) {
  console.error(`Nenhum .sql.gz em ${pastaPadrao} — passe o caminho do backup.`);
  process.exit(1);
}

if (/\.enc$/i.test(arquivo)) {
  console.error(
    'Este backup está no formato cifrado antigo (.enc), que não é mais usado.\n'
    + '  Gere um backup novo com `npm run backup:db` ou `tools/backup-db.ps1` — sai .sql.gz aberto.',
  );
  process.exit(1);
}

const container = flag('--container') ?? await containerPostgres();
if (!container) {
  console.error('Postgres Docker não encontrado — rode `npm run infra` primeiro.');
  process.exit(1);
}

console.log(`Backup: ${arquivo}`);
console.log(`Docker: ${container}`);
console.log('Recriando banco local pokeidle…');

await psql(container, 'postgres', `
  SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
   WHERE datname = 'pokeidle' AND pid <> pg_backend_pid();
`);
await psql(container, 'postgres', 'DROP DATABASE IF EXISTS pokeidle;');
await psql(container, 'postgres', 'CREATE DATABASE pokeidle OWNER poke;');

console.log('Importando… (pode levar alguns segundos)');
const t0 = Date.now();
const psqlProc = spawn(
  'docker',
  ['exec', '-i', container, 'psql', '-U', 'poke', '-d', 'pokeidle', '-v', 'ON_ERROR_STOP=1'],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);
let err = '';
psqlProc.stderr.on('data', (c) => { err += c; });
try {
  await pipeline(createReadStream(arquivo), createGunzip(), psqlProc.stdin);
} catch (e) {
  console.error(`\nFalha ao ler o backup: ${e.message}`);
  process.exit(1);
}
const code = await new Promise((r) => psqlProc.on('close', r));
if (code !== 0) {
  console.error(err.trim() || `psql falhou (${code})`);
  process.exit(1);
}

const { rows } = await query(container, `
  SELECT
    (SELECT count(*)::int FROM players) AS jogadores,
    (SELECT count(*)::int FROM player_pokemon) AS pokemons,
    (SELECT count(*)::int FROM accounts) AS contas
`);
console.log(`Pronto em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(rows);
console.log('\nPróximo passo: npm start → entre com a mesma conta da produção.');
console.log('Conta Google? Rode: npm run dev:sessao -- seu@email.com');
console.log('Cole a linha no F12 e dê F5. Limpe a sessão antiga antes (localStorage.removeItem("sessao")).');

async function backupMaisRecente(pasta) {
  try {
    const files = await readdir(pasta);
    const gz = [];
    for (const f of files.filter((x) => x.endsWith('.sql.gz') && !x.endsWith('.sql.gz.enc'))) {
      const st = await stat(join(pasta, f));
      gz.push({ f, m: st.mtimeMs });
    }
    gz.sort((a, b) => b.m - a.m);
    return gz[0] ? join(pasta, gz[0].f) : null;
  } catch {
    return null;
  }
}

function rodarTexto(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (c) => { out += c; });
    proc.stderr.on('data', (c) => { err += c; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `${cmd} saiu ${code}`));
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

function psql(container, db, sql) {
  return rodarTexto('docker', ['exec', container, 'psql', '-U', 'poke', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', sql]);
}

async function query(container, sql) {
  const out = await rodarTexto('docker', [
    'exec', container, 'psql', '-U', 'poke', '-d', 'pokeidle', '-t', '-A', '-F', ',', '-c', sql,
  ]);
  const [jogadores, pokemons, contas] = out.trim().split(',').map(Number);
  return { rows: { jogadores, pokemons, contas } };
}
