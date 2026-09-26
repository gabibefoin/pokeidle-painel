#!/usr/bin/env node
/**
 * Restaura um starter (Bulbasaur / Charmander / Squirtle) direto no Postgres.
 *
 * Uso em produção (como usuário do jogo, na pasta do game):
 *   cd /opt/pokeidle/game
 *   node tools/dar-starter.mjs Muniznft charmander
 *   node tools/dar-starter.mjs Muniznft 4          # pokeId 4 = Charmander
 *   node tools/dar-starter.mjs Muniznft charmander --dry-run
 *
 * O jogador precisa dar F5 (ou relogar) se estiver online — a simulação só recarrega
 * pokémon do banco na conexão.
 */
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import {
  especies,
  xpTotalParaNivel,
  calcularStats,
  hpDeCombate,
  multDeNascenca,
  rolarStarter,
} from '../src/server/content.mjs';
import { poderDePokemon } from '../src/shared/nota-pokemon.mjs';

const STARTERS = new Map([
  ['bulbasaur', 1],
  ['charmander', 4],
  ['squirtle', 7],
  ['1', 1],
  ['4', 4],
  ['7', 7],
]);

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dryRun = process.argv.includes('--dry-run');
const ativar = !process.argv.includes('--nao-ativar');

const nick = args[0];
const especieArg = (args[1] ?? 'charmander').toLowerCase();

if (!nick) {
  console.error('Uso: node tools/dar-starter.mjs <nick> [bulbasaur|charmander|squirtle|1|4|7] [--dry-run]');
  process.exit(1);
}

const speciesId = STARTERS.get(especieArg) ?? Number(especieArg);
if (!Number.isFinite(speciesId) || !especies.has(speciesId)) {
  console.error(`Espécie inválida: ${especieArg}. Use bulbasaur, charmander, squirtle ou pokeId 1/4/7.`);
  process.exit(1);
}

const esp = especies.get(speciesId);
const nivel = 5;
const xp = xpTotalParaNivel(nivel);
const potencia = 2;
const { quality, ivs } = rolarStarter();
const stats = calcularStats(esp, ivs, nivel, quality, multDeNascenca(potencia, false));
const maxHp = hpDeCombate(stats.hp);
const power = poderDePokemon({ ivs, quality, potencia, shiny: false, level: nivel });

const cli = await pool.connect();
try {
  await cli.query('BEGIN');

  const { rows: jogadores } = await cli.query(
    `SELECT id, nick, level, active_poke FROM players WHERE lower(nick) = lower($1)`,
    [nick],
  );
  const jogador = jogadores[0];
  if (!jogador) throw new Error(`Jogador não encontrado: ${nick}`);

  const { rows: time } = await cli.query(
    `SELECT id, species_id, level, slot, starter
     FROM player_pokemon
     WHERE player_id = $1 AND anuncio_id IS NULL
     ORDER BY slot NULLS LAST, id`,
    [jogador.id],
  );

  const MAX_EQUIPE = 5;
  const naEquipe = time.filter((p) => p.slot != null).length;
  const slotsUsados = new Set(
    time.filter((p) => p.slot != null && p.slot < MAX_EQUIPE).map((p) => p.slot),
  );
  let slot = null;
  if (naEquipe >= MAX_EQUIPE) {
    throw new Error('Equipe cheia (5/5) — mova um pokémon pro depósito antes.');
  }
  for (let i = 0; i < MAX_EQUIPE; i++) {
    if (!slotsUsados.has(i)) {
      slot = i;
      break;
    }
  }
  if (slot == null) throw new Error('Equipe cheia (5/5) — mova um pokémon pro depósito antes.');

  console.log(`Jogador: ${jogador.nick} (id ${jogador.id}, nv ${jogador.level})`);
  console.log(`Pokémon atuais: ${time.length}`);
  for (const p of time) {
    const nome = especies.get(p.species_id)?.name ?? `#${p.species_id}`;
    console.log(`  · id ${p.id} ${nome} nv ${p.level} slot ${p.slot ?? 'depot'}${p.starter ? ' [starter]' : ''}`);
  }
  console.log('');
  console.log(`Novo starter: ${esp.name} (pokeId ${speciesId}) nv ${nivel}`);
  console.log(`  qualidade ${quality.toFixed(3)} · potência ${potencia} · power ${power} · HP ${maxHp}`);
  console.log(`  slot ${slot}${ativar ? ' · será o pokémon ativo' : ''}`);

  if (dryRun) {
    await cli.query('ROLLBACK');
    console.log('\n[dry-run] Nada foi gravado.');
    process.exit(0);
  }

  const { rows: inseridos } = await cli.query(
    `INSERT INTO player_pokemon
       (player_id, species_id, level, xp, quality, ivs, hp, shiny, slot, power, potencia, starter)
     VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,$10,true)
     RETURNING id`,
    [jogador.id, speciesId, nivel, xp, quality, JSON.stringify(ivs), maxHp, slot, power, potencia],
  );
  const pkId = inseridos[0].id;

  if (ativar) {
    await cli.query(`UPDATE players SET active_poke = $2 WHERE id = $1`, [jogador.id, pkId]);
  }

  await cli.query('COMMIT');
  console.log(`\nPronto — ${esp.name} starter id ${pkId} criado para ${jogador.nick}.`);
  console.log('Peça ao jogador para dar F5 ou relogar se estiver online.');
} catch (err) {
  await cli.query('ROLLBACK');
  console.error(err.message || err);
  process.exit(1);
} finally {
  cli.release();
  await pool.end();
}
