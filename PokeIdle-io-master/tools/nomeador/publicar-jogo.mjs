/**
 * Publica sprites no jogo local (usado pelo Nomeador via POST /api/pokedex/publicar).
 *
 *   node tools/nomeador/publicar-jogo.mjs              # backup (padrão)
 *   node tools/nomeador/publicar-jogo.mjs --lab        # fluxo legado (lab-index + baseline)
 *
 * Backup (padrão): publicar-sprites-backup → marker-atlas
 * Lab: verificar-pokedex → build → publicar:sprites → sync:sprites → marker-atlas
 *
 * Equivalente CLI backup: npm run publicar:backup && npm run marker-atlas
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicarSpritesBackup } from '../publicar-sprites-backup.mjs';
import { pokedexBackup, spritesRaiz } from '../caminhos.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const PASSOS_LAB = [
  { id: 'verificar', label: 'Trava Pokédex Lab (baseline)', cmd: NPM, args: ['run', 'nomeador:verificar-pokedex'] },
  { id: 'build', label: 'PNG → WEBP no LAB', cmd: NPM, args: ['run', 'nomeador:build'] },
  { id: 'publicar', label: 'LAB → public/data/asset-packs', cmd: NPM, args: ['run', 'publicar:sprites', '--', '--force'] },
  { id: 'sync', label: 'Looktypes → game/src/server/dados', cmd: NPM, args: ['run', 'sync:sprites'] },
  { id: 'atlas', label: 'marker-atlas.png/json (mapa mundi)', cmd: NPM, args: ['run', 'marker-atlas'] },
];

const PASSOS_BACKUP = [
  {
    id: 'publicar',
    label: 'Desktop/Pokedex Backup → asset-packs',
    fn: () => publicarSpritesBackup(),
  },
  { id: 'atlas', label: 'marker-atlas.png/json (mapa mundi)', cmd: NPM, args: ['run', 'marker-atlas'] },
];

function ambiente() {
  return {
    ...process.env,
    SPRITES_RAIZ: process.env.SPRITES_RAIZ || spritesRaiz(),
    POKEDEX_BACKUP: process.env.POKEDEX_BACKUP || pokedexBackup(),
  };
}

function rodarPasso(passo) {
  if (passo.fn) {
    return passo.fn().then(() => ({
      id: passo.id,
      label: passo.label,
      ok: true,
      out: '',
      err: '',
    }));
  }

  return new Promise((resolve, reject) => {
    const comando = [passo.cmd, ...passo.args].map((a) => `"${a}"`).join(' ');
    const proc = spawn(comando, {
      cwd: RAIZ,
      shell: true,
      env: ambiente(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    proc.stdout?.on('data', (d) => { out += d; });
    proc.stderr?.on('data', (d) => { err += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      const tail = (s) => s.trim().slice(-1500);
      if (code === 0) {
        resolve({ id: passo.id, label: passo.label, ok: true, out: tail(out), err: tail(err) });
        return;
      }
      const e = new Error(`${passo.label} falhou (código ${code})`);
      e.passo = passo.id;
      e.out = tail(out);
      e.err = tail(err);
      e.code = code;
      reject(e);
    });
  });
}

/**
 * @param {(ev: { passo: string, label: string, fase: 'inicio'|'ok'|'erro' }) => void} [aoProgresso]
 * @param {{ fonte?: 'backup'|'lab' }} [opts]
 */
export async function publicarJogoNoDisco(aoProgresso, opts = {}) {
  const fonte = opts.fonte || (process.argv.includes('--lab') ? 'lab' : 'backup');
  const passos = fonte === 'lab' ? PASSOS_LAB : PASSOS_BACKUP;
  const feitos = [];
  for (const passo of passos) {
    aoProgresso?.({ passo: passo.id, label: passo.label, fase: 'inicio' });
    const r = await rodarPasso(passo);
    feitos.push(r);
    aoProgresso?.({ passo: passo.id, label: passo.label, fase: 'ok' });
  }
  return { ok: true, fonte, passos: feitos.map((p) => p.id) };
}

const ehCli = process.argv[1] === fileURLToPath(import.meta.url);

if (ehCli) {
  const fonte = process.argv.includes('--lab') ? 'lab' : 'backup';
  const labels = Object.fromEntries((fonte === 'lab' ? PASSOS_LAB : PASSOS_BACKUP).map((p) => [p.id, p.label]));
  console.log(`Fonte: ${fonte === 'lab' ? 'lab-index' : 'Desktop/Pokedex Backup'}\n`);
  publicarJogoNoDisco(({ passo, fase }) => {
    if (fase === 'inicio') console.log(`→ ${labels[passo] ?? passo}…`);
    if (fase === 'ok') console.log(`✓ ${labels[passo] ?? passo}`);
  }, { fonte })
    .then((r) => {
      console.log('\nPronto. Rode npm start no jogo (reinicie se já estiver aberto).');
      console.log(JSON.stringify(r));
    })
    .catch((e) => {
      console.error('\n' + (e.message || e));
      if (e.err) console.error(e.err);
      process.exit(typeof e.code === 'number' ? e.code : 1);
    });
}
