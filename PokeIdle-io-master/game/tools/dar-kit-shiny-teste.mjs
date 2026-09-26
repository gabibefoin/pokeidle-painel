#!/usr/bin/env node
/**
 * Kit de teste — fragmentos shiny + shinys P5 IV/qualidade máximos + pedras de evolução.
 *
 *   node tools/dar-kit-shiny-teste.mjs fasi
 *   node tools/dar-kit-shiny-teste.mjs fasi --dry-run
 *
 * O jogador precisa reconectar (F5) se estiver online — inventário e depot vêm do banco na entrada.
 */
import '../src/server/config.mjs';
import { pool, inserirPokemon } from '../src/server/db.mjs';
import {
  especies,
  calcularStats,
  hpDeCombate,
  xpTotalParaNivel,
  multDeNascenca,
} from '../src/server/content.mjs';
import { QUALIDADE_MAX, POTENCIA_MAX, poderDePokemon } from '../src/shared/nota-pokemon.mjs';
import {
  FRAGMENTO_SHINY_ID,
  SHINY_STONE_POR_TIPO,
} from '../src/server/game/itens-nossos.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const nick = args.find((a) => !a.startsWith('--')) ?? 'fasi';

const FRAGMENTOS = 300;
const LEVEL = 100;
const QUALITY = QUALIDADE_MAX;
const POTENCIA = POTENCIA_MAX;
const IVS_MAX = { hp: 32, atk: 32, def: 32, spAtk: 32, spDef: 32, speed: 32 };

/** Linhas evolutivas úteis para testar shiny stone + stats após evoluir. */
const SHINYS = [
  { speciesId: 4, rotulo: 'Charmander → Charizard (FIRE)' },
  { speciesId: 247, rotulo: 'Pupitar → Tyranitar (ROCK)' },
  { speciesId: 1, rotulo: 'Bulbasaur → Venusaur (GRASS)' },
  { speciesId: 7, rotulo: 'Squirtle → Blastoise (WATER)' },
  { speciesId: 63, rotulo: 'Abra → Alakazam (PSYCHIC)' },
  { speciesId: 25, rotulo: 'Pikachu → Raichu (ELECTRIC)' },
  { speciesId: 58, rotulo: 'Growlithe → Arcanine (FIRE)' },
  { speciesId: 93, rotulo: 'Haunter → Gengar (GHOST)' },
];

const PEDRAS_QTD = 5;
const TIPOS_PEDRA = ['FIRE', 'GRASS', 'WATER', 'ROCK', 'PSYCHIC', 'ELECTRIC', 'GHOST'];

const { rows } = await pool.query(
  `SELECT id, nick, items FROM players WHERE lower(nick) = lower($1)`,
  [nick],
);
if (!rows[0]) {
  console.error(`Jogador "${nick}" não encontrado.`);
  process.exit(1);
}

const playerId = Number(rows[0].id);
const items = { ...(rows[0].items ?? {}) };

items[FRAGMENTO_SHINY_ID] = (Number(items[FRAGMENTO_SHINY_ID] ?? 0)) + FRAGMENTOS;
for (const tipo of TIPOS_PEDRA) {
  const id = SHINY_STONE_POR_TIPO[tipo];
  if (id) items[id] = (Number(items[id] ?? 0)) + PEDRAS_QTD;
}

console.log(`\n=== Kit shiny teste → ${rows[0].nick} (id ${playerId}) ===\n`);
console.log(`Fragmentos Shiny Stone (+${FRAGMENTOS}): total ${items[FRAGMENTO_SHINY_ID]}`);
for (const tipo of TIPOS_PEDRA) {
  const id = SHINY_STONE_POR_TIPO[tipo];
  console.log(`  ${tipo} Shiny Stone (id ${id}): +${PEDRAS_QTD} → ${items[id]}`);
}

const xp = xpTotalParaNivel(LEVEL);
const criados = [];

for (const { speciesId, rotulo } of SHINYS) {
  const esp = especies.get(speciesId);
  if (!esp) {
    console.warn(`  ! espécie ${speciesId} ausente — pulando`);
    continue;
  }
  const stats = calcularStats(esp, IVS_MAX, LEVEL, QUALITY, multDeNascenca(POTENCIA, true));
  const pk = {
    speciesId,
    level: LEVEL,
    xp,
    quality: QUALITY,
    ivs: JSON.stringify(IVS_MAX),
    hp: hpDeCombate(stats.hp),
    shiny: true,
    slot: null,
    potencia: POTENCIA,
    power: poderDePokemon({ ivs: IVS_MAX, quality: QUALITY, potencia: POTENCIA, shiny: true, level: LEVEL }),
    starter: false,
  };
  if (dryRun) {
    console.log(`  [dry-run] ✨ ${esp.name} Nv${LEVEL} P${POTENCIA} q${QUALITY} IV192 — ${rotulo}`);
    continue;
  }
  const row = await inserirPokemon(playerId, pk);
  criados.push({ id: row.id, nome: esp.name, rotulo });
  console.log(`  ✨ ${esp.name} Nv${LEVEL} P${POTENCIA} q${QUALITY} IV192 (pk #${row.id}) — ${rotulo}`);
}

if (!dryRun) {
  await pool.query(`UPDATE players SET items = $1::jsonb WHERE id = $2`, [JSON.stringify(items), playerId]);
  console.log('\nItens gravados no banco.');
}

console.log('\nReconecte no jogo (F5) para ver depot e bolsa.');
if (!dryRun) console.log(`Pokémon criados: ${criados.length}`);
await pool.end();
