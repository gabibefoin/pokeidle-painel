#!/usr/bin/env node
// Beldum + Metal Stones para teste local de evolução.
//   node tools/dar-beldum-local.mjs fasi123
import '../src/server/config.mjs';
import { pool, inserirPokemon } from '../src/server/db.mjs';
import {
  conectarBus,
  desconectarJogador,
  gatewayDoJogador,
  enviarParaSim,
} from '../src/server/bus.mjs';
import {
  especies,
  calcularStats,
  hpDeCombate,
  xpTotalParaNivel,
  multDeNascenca,
  PEDRA_EVOLUCAO_POR_TIPO,
} from '../src/server/content.mjs';
import { poderDePokemon } from '../src/shared/nota-pokemon.mjs';

const nick = process.argv[2] ?? 'fasi123';
const level = Math.max(1, Math.floor(Number(process.argv[3] ?? 50)));

const metalStoneId = PEDRA_EVOLUCAO_POR_TIPO.STEEL?.itemId;
if (!metalStoneId) {
  console.error('Metal Stone não encontrada no catálogo.');
  process.exit(1);
}

const speciesId = especies.has(13374) ? 13374 : 374;
const esp = especies.get(speciesId);
if (!esp) {
  console.error('Beldum não encontrado no catálogo.');
  process.exit(1);
}

const { rows } = await pool.query(
  'SELECT id, nick FROM players WHERE lower(nick) = lower($1)',
  [nick],
);
if (!rows[0]) {
  console.error(`Jogador "${nick}" não encontrado.`);
  process.exit(1);
}

const playerId = Number(rows[0].id);
const canon = rows[0].nick;
const chave = canon.toLowerCase();

await conectarBus();
const online = await gatewayDoJogador(chave);

const ivs = { hp: 18, atk: 20, def: 15, spAtk: 14, spDef: 16, speed: 22 };
const stats = calcularStats(esp, ivs, level, 1.164, multDeNascenca(1, false));
const pkId = (await inserirPokemon(playerId, {
  speciesId,
  level,
  xp: xpTotalParaNivel(level),
  quality: 1.164,
  ivs: JSON.stringify(ivs),
  hp: hpDeCombate(stats.hp),
  shiny: false,
  slot: null,
  potencia: 1,
  power: poderDePokemon({ ivs, quality: 1.164, potencia: 1, shiny: false, level }),
  starter: false,
})).id;

if (online) {
  console.log(`${canon} online — creditando Metal Stones via sim…`);
  enviarParaSim(chave, {
    t: 'admin.items',
    playerId: chave,
    items: { [metalStoneId]: 2 },
  });
  await new Promise((r) => setTimeout(r, 800));
  console.log(`  ✓ +2 Metal Stone (id ${metalStoneId})`);
  console.log(`${canon}: Beldum Nv ${level} → depot (id ${pkId})`);
  console.log('Abra o Depot (F5 se não aparecer). Beldum→Metang no Nv 40; Metang→Metagross no Nv 100.');
} else {
  await pool.query(
    `UPDATE players
        SET items = jsonb_set(
              COALESCE(items, '{}'::jsonb),
              ARRAY[$2::text],
              to_jsonb(COALESCE((items->>$2)::int, 0) + 2)
            ),
            last_seen = now()
      WHERE id = $1`,
    [playerId, String(metalStoneId)],
  );
  console.log(`${canon}: +2 Metal Stone · Beldum Nv ${level} → depot (id ${pkId})`);
  console.log('Recarregue a página (F5).');
}

await pool.end();
