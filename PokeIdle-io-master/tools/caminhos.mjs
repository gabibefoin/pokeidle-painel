/**
 * Caminhos padrão da máquina de dev (Windows/Linux).
 * Sobrescreva com env: SPRITES_RAIZ, POKEDEX_BACKUP, POKE_IDLE_BACKUPS.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const desktop = () => join(homedir(), 'Desktop');

export const spritesRaiz = () =>
  process.env.SPRITES_RAIZ || join(homedir(), 'Desktop', 'Sprites');

export const pokedexBackup = () =>
  process.env.POKEDEX_BACKUP || join(desktop(), 'Pokedex Backup');

export const pokeIdleBackups = () =>
  process.env.POKE_IDLE_BACKUPS || join(desktop(), 'POKE IDLE BACKUPS');

export const labIndex = () => join(spritesRaiz(), 'LAB', 'lab-index.json');

/** Pasta com efeitos extras (`effect_NNN_.png`) para TM Elemental. */
export const tramparEfeitos = () =>
  process.env.TRAMPAR_EFEITOS || join(desktop(), 'Trampar', 'Efeitos');
