#!/usr/bin/env node
// Kit de teste TM Elemental — 18 pokémon (1 por tipo) com TM aplicado + discos na bolsa.
//   node tools/dar-kit-tm-elemental-local.mjs fasi123
//
// Apaga os pokémon do depot (exceto anunciados no mercado). Reconecte (F5) se estiver online.
import '../src/server/config.mjs';
import { pool } from '../src/server/db.mjs';
import {
  especies,
  calcularStats,
  hpDeCombate,
  xpTotalParaNivel,
  multDeNascenca,
  TIPOS_POKEMON,
} from '../src/server/content.mjs';
import { DISCO_POR_TIPO, PIECE_ELEMENTAL } from '../src/server/game/tm.mjs';
import { poderDePokemon } from '../src/shared/nota-pokemon.mjs';
import {
  conectarBus,
  gatewayDoJogador,
  enviarParaSim,
} from '../src/server/bus.mjs';

/** Espécies fortes — tm_elemental = tipo testado (precisa estar em type1/type2). */
const KIT = [
  { tipo: 'NORMAL', speciesId: 143, nome: 'Snorlax' },
  { tipo: 'FIRE', speciesId: 6, nome: 'Charizard' },
  { tipo: 'WATER', speciesId: 658, nome: 'Greninja' },
  { tipo: 'GRASS', speciesId: 3, nome: 'Venusaur' },
  { tipo: 'ELECTRIC', speciesId: 26, nome: 'Raichu' },
  { tipo: 'ICE', speciesId: 473, nome: 'Mamoswine' },
  { tipo: 'FIGHTING', speciesId: 448, nome: 'Lucario' },
  { tipo: 'POISON', speciesId: 748, nome: 'Toxapex' },
  { tipo: 'GROUND', speciesId: 445, nome: 'Garchomp' },
  { tipo: 'FLYING', speciesId: 373, nome: 'Salamence' },
  { tipo: 'PSYCHIC', speciesId: 65, nome: 'Alakazam' },
  { tipo: 'BUG', speciesId: 637, nome: 'Volcarona' },
  { tipo: 'ROCK', speciesId: 248, nome: 'Tyranitar' },
  { tipo: 'GHOST', speciesId: 94, nome: 'Gengar' },
  { tipo: 'DRAGON', speciesId: 149, nome: 'Dragonite' },
  { tipo: 'DARK', speciesId: 461, nome: 'Weavile' },
  { tipo: 'STEEL', speciesId: 376, nome: 'Metagross' },
  { tipo: 'FAIRY', speciesId: 282, nome: 'Gardevoir' },
];

const nick = process.argv[2] ?? 'fasi123';
const level = Math.max(50, Math.floor(Number(process.argv[3] ?? 100)));

for (const row of KIT) {
  const esp = especies.get(row.speciesId);
  if (!esp) {
    console.error(`Espécie ${row.nome} (${row.speciesId}) não encontrada.`);
    process.exit(1);
  }
  const tipos = [esp.type1, esp.type2].filter(Boolean);
  if (!tipos.includes(row.tipo)) {
    console.error(`${row.nome} não tem tipo ${row.tipo} (tem ${tipos.join('/')}).`);
    process.exit(1);
  }
}

const faltando = TIPOS_POKEMON.filter((t) => !KIT.some((k) => k.tipo === t));
if (faltando.length) {
  console.error('Kit incompleto, faltam tipos:', faltando.join(', '));
  process.exit(1);
}

const cli = await pool.connect();
try {
  await cli.query('BEGIN');

  const { rows: jogadores } = await cli.query(
    'SELECT id, nick FROM players WHERE lower(nick) = lower($1)',
    [nick],
  );
  const jogador = jogadores[0];
  if (!jogador) throw new Error(`Jogador "${nick}" não encontrado.`);

  const playerId = Number(jogador.id);
  const canon = jogador.nick;

  const { rows: mercado } = await cli.query(
    'SELECT id, species_id FROM player_pokemon WHERE player_id = $1 AND anuncio_id IS NOT NULL',
    [playerId],
  );
  if (mercado.length) {
    console.warn(`⚠ ${mercado.length} pokémon no mercado — não foram apagados.`);
  }

  const { rowCount: apagados } = await cli.query(
    'DELETE FROM player_pokemon WHERE player_id = $1 AND anuncio_id IS NULL',
    [playerId],
  );

  await cli.query('UPDATE players SET active_poke = NULL WHERE id = $1', [playerId]);

  const ivs = { hp: 31, atk: 31, def: 31, spAtk: 31, spDef: 31, speed: 31 };
  const quality = 1.25;
  const potencia = 5;
  const xp = xpTotalParaNivel(level);
  const inseridos = [];

  for (let i = 0; i < KIT.length; i++) {
    const row = KIT[i];
    const esp = especies.get(row.speciesId);
    const stats = calcularStats(esp, ivs, level, quality, multDeNascenca(potencia, false));
    const maxHp = hpDeCombate(stats.hp);
    const slot = i < 6 ? i + 1 : null;
    const power = poderDePokemon({ ivs, quality, potencia, shiny: false, level });

    const { rows: ins } = await cli.query(
      `INSERT INTO player_pokemon
         (player_id, species_id, level, xp, quality, ivs, hp, shiny, slot, power, potencia, starter, tm_elemental)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,$10,false,$11)
       RETURNING id`,
      [playerId, row.speciesId, level, xp, quality, JSON.stringify(ivs), maxHp, slot, power, potencia, row.tipo],
    );
    inseridos.push({ ...row, id: ins[0].id, slot, real: esp.name });
  }

  const primeiro = inseridos[0]?.id;
  if (primeiro) {
    await cli.query('UPDATE players SET active_poke = $2 WHERE id = $1', [playerId, primeiro]);
  }

  const items = { [PIECE_ELEMENTAL]: 50 };
  for (const t of TIPOS_POKEMON) {
    const diskId = DISCO_POR_TIPO[t];
    if (diskId) items[diskId] = 1;
  }

  for (const [itemId, qtd] of Object.entries(items)) {
    await cli.query(
      `UPDATE players
          SET items = jsonb_set(
                COALESCE(items, '{}'::jsonb),
                ARRAY[$2::text],
                to_jsonb(COALESCE((items->>$2)::int, 0) + $3::int)
              )
        WHERE id = $1`,
      [playerId, String(itemId), qtd],
    );
  }

  await cli.query('COMMIT');

  console.log(`\n${canon} — kit TM Elemental (${level})`);
  console.log(`  ${apagados ?? 0} pokémon antigos removidos do depot`);
  console.log(`  18 espécies com TM elemental aplicado:\n`);
  for (const p of inseridos) {
    console.log(`  ${String(p.slot ?? '—').padStart(2)}  TM ${p.tipo.padEnd(9)}  ${p.real} (#${p.id})`);
  }
  console.log(`\n  Bolsa: 50× TM Disk Piece + 1× disco de cada tipo (18)`);
  console.log('  Reconecte (F5) se estiver online.\n');
} catch (err) {
  await cli.query('ROLLBACK');
  console.error(err.message || err);
  process.exit(1);
} finally {
  cli.release();
}

try {
  await conectarBus();
  const chave = nick.toLowerCase();
  const online = await gatewayDoJogador(chave);
  if (online) {
    console.log(`${nick} está online — aviso: F5 obrigatório para recarregar pokémon do banco.`);
  }
} catch { /* bus opcional */ }

await pool.end();
