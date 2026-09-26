#!/usr/bin/env node
// Dá um pokémon a um jogador local — uso dev/admin.
//   node tools/dar-pokemon.mjs fasi 142 102
//   node tools/dar-pokemon.mjs fasi 571 50 --shiny
import { pool } from '../src/server/db.mjs';
import { inserirPokemon } from '../src/server/db.mjs';
import {
  especies,
  calcularStats,
  hpDeCombate,
  xpTotalParaNivel,
  multDeNascenca,
  rolarIVsShiny,
} from '../src/server/content.mjs';
import { poderDePokemon } from '../src/shared/nota-pokemon.mjs';

const args = process.argv.slice(2);
const shiny = args.includes('--shiny');
const pos = args.filter((a) => a !== '--shiny');
const nick = pos[0] ?? 'fasi';
const speciesId = Number(pos[1] ?? 142);
const level = Number(pos[2] ?? 102);
const quality = Number(pos[3] ?? 1.164);
const potencia = Number(pos[4] ?? 1);

const esp = especies.get(speciesId);
if (!esp) {
  console.error('espécie', speciesId, 'não encontrada');
  process.exit(1);
}

const { rows } = await pool.query(`SELECT id FROM players WHERE lower(nick) = lower($1)`, [nick]);
if (!rows[0]) {
  console.error('jogador', nick, 'não encontrado');
  process.exit(1);
}
const playerId = Number(rows[0].id);

const ivs = shiny ? rolarIVsShiny() : { hp: 18, atk: 20, def: 15, spAtk: 14, spDef: 16, speed: 22 };
const stats = calcularStats(esp, ivs, level, quality, multDeNascenca(potencia, shiny));
const maxHp = hpDeCombate(stats.hp);
const xp = xpTotalParaNivel(level);

const id = (await inserirPokemon(playerId, {
  speciesId,
  level,
  xp,
  quality,
  ivs: JSON.stringify(ivs),
  hp: maxHp,
  shiny,
  slot: null,
  potencia,
  power: poderDePokemon({ ivs, quality, potencia, shiny, level }),
  starter: false,
})).id;

const tag = shiny ? ' ✨ Shiny' : '';
console.log(`OK:${tag} ${esp.name} Nv ${level} q${quality} P${potencia} → ${nick} (player_pokemon.id=${id})`);
console.log('Reconecte no jogo para ver no depot.');
await pool.end();
