// O flush EM LOTE contra o flush de uma query por linha — no Postgres local.
//
//     node tools/teste-flush-lote.mjs
//
// O mesmo payload (o formato que o `flush()` do sim monta) é gravado por `flushJogadoresUmPorUm`
// num par de jogadores de teste e por `flushJogadores` (o lote) em outro par. Depois as linhas são
// comparadas coluna por coluna — tudo o que o flush escreve tem de sair igual, inclusive os nulos,
// os jsonb grandes, o `bonus_base` nulo que preserva o refino e o jogador repetido no lote.
//
// Por último, o ganho: um lote de 700 jogadores com 3 pokémon sujos cada, pelos dois caminhos.
import { pool, flushJogadores, flushJogadoresUmPorUm, congelarPokemon } from '../src/server/db.mjs';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.log(`Postgres indisponível (${err.message}) — suba com \`npm run infra\`.`);
  process.exit(1);
}

const PREFIXO = '__flushlote';

async function limpar() {
  await pool.query(`DELETE FROM players WHERE nick LIKE $1`, [`${PREFIXO}%`]);
}

async function criarJogador(nick, pokemons = 2) {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, xp, gold, hunt_slug) VALUES ($1, 1, 0, 0, 'route-1') RETURNING id`,
    [nick],
  );
  const id = Number(rows[0].id);
  const pks = [];
  for (let i = 0; i < pokemons; i++) {
    const r = await pool.query(
      `INSERT INTO player_pokemon (player_id, species_id, level, xp, quality, ivs, hp, shiny, slot, power, bonus_base)
       VALUES ($1, 25, 5, 10, 1, '{"hp":10,"atk":10,"def":10,"spAtk":10,"spDef":10,"speed":10}', 20, false, $2, 100,
               '{"atk":2}'::jsonb)
       RETURNING id`,
      [id, i < 5 ? i : null],
    );
    pks.push(Number(r.rows[0].id));
  }
  return { id, pks };
}

/** O payload do jeito que o `flush()` do sim monta — jsonb como texto, pokémon congelados. */
function payload(id, pks, variante) {
  const grande = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [String(70000 + i), i * 3]));
  const pokemonsSujos = pks.map((pkId, i) => congelarPokemon({
    id: pkId,
    level: 30 + i,
    xp: 123456789 + i,
    hp: variante === 'a' ? 0 : 77,
    slot: i === 0 ? 0 : null,
    poder: 4321 + i,
    speciesId: 150 + i,
    tmElemental: i === 0 ? 'fire' : null,
    tmAoe: i === 0,
    heldItemId: i === 1 ? 70090 : null,
    // O segundo pokémon sem refino: `bonus_base` nulo tem de PRESERVAR o '{"atk":2}' da linha.
    refino: i === 0 ? { hp: 1, atk: 3 } : null,
  }));
  return {
    id,
    level: variante === 'a' ? 88 : 12,
    xp: 9007199254740, // perto do teto que um bigint de jogador chega
    gold: 1500000000,
    huntSlug: variante === 'a' ? 'outland-toxic-toxicroak' : null,
    activeId: variante === 'a' ? pks[0] : null,
    items: JSON.stringify(grande),
    balls: JSON.stringify({ 1: 5, 4: 2 }),
    automation: JSON.stringify({ casasEmUso: [1, 2], texto: 'aspas " barra \\ e acentuação — ✨', nulo: null }),
    pokedex: JSON.stringify({ 25: { k: 3, c: 1 } }),
    bossPoints: 7,
    elo: 1234,
    pvpAbates: 3,
    pvpMortes: 1,
    pvpCooldownAte: 1789416543210,
    vipAte: 0,
    boosts: JSON.stringify({ xp: 1789416543210 }),
    boostsHoje: JSON.stringify({}),
    bless: variante === 'a' ? 'blessing' : null,
    comprasCooldown: JSON.stringify({ loja: 1 }),
    gender: 'female',
    looktype: 211,
    ownedOutfits: JSON.stringify([159, 211]),
    visual: JSON.stringify({ cabelo: 3 }),
    visualOk: true,
    tutorialVisto: false,
    fragChaveTotal: variante === 'a' ? 12 : undefined, // undefined → o `?? 0` dos dois caminhos
    discordPopCampanha: 2,
    xpShare: variante === 'a' ? JSON.stringify({ 1: [pks[1], null] }) : undefined,
    outlandTier: 3,
    xpShareTotal: 4,
    vitrine: JSON.stringify([pks[0]]),
    avisoVisto: 3,
    // O Passe de Batalha: undefined na variante b cai no `?? '{}'` dos dois caminhos.
    passe: variante === 'a' ? JSON.stringify({ ultimo: 20712, degrau: 7, ultimoVip: 20712, vipAte: 1790000000000, ciclos: 1, total: 37 }) : undefined,
    pokemonsSujos,
  };
}

const COLS_JOGADOR = `level, xp, gold, hunt_slug, active_poke, items, balls, automation, pokedex, boss_points, elo,
  pvp_abates, pvp_mortes, pvp_cooldown_ate, vip_ate, boosts, boosts_hoje, bless, compras_cooldown, gender, looktype,
  owned_outfits, visual, visual_ok, tutorial_visto, frag_chave_total, discord_pop_campanha, xp_share, outland_tier,
  xp_share_total, vitrine, aviso_visto, passe, last_seen`;
const COLS_POKEMON = 'level, xp, hp, slot, power, species_id, tm_elemental, tm_aoe, held_item_id, bonus_base';

const linhaJogador = async (id) => (await pool.query(`SELECT ${COLS_JOGADOR} FROM players WHERE id = $1`, [id])).rows[0];
const linhasPokemon = async (ids) => (await pool.query(
  `SELECT ${COLS_POKEMON} FROM player_pokemon WHERE id = ANY($1::bigint[]) ORDER BY id`, [ids],
)).rows;

/** Troca os ids do par "antigo" pelos do par "lote" para comparar referências internas. */
function normalizar(obj, de, para) {
  let texto = JSON.stringify(obj);
  de.forEach((v, i) => {
    texto = texto.replaceAll(`"active_poke":"${v}"`, `"active_poke":"${para[i]}"`)
      .replaceAll(`${v}`, `§${i}§`);
  });
  para.forEach((v, i) => {
    texto = texto.replaceAll(`${v}`, `§${i}§`);
  });
  return texto;
}

console.log('FLUSH EM LOTE — Postgres local\n==============================');
await limpar();

// ---------------------------------------------------------------- paridade
{
  console.log('\nParidade coluna por coluna');
  const velho = [await criarJogador(`${PREFIXO}_va`), await criarJogador(`${PREFIXO}_vb`)];
  const novo = [await criarJogador(`${PREFIXO}_na`), await criarJogador(`${PREFIXO}_nb`)];

  const antes = Date.now();
  await flushJogadoresUmPorUm([payload(velho[0].id, velho[0].pks, 'a'), payload(velho[1].id, velho[1].pks, 'b')]);
  const gravados = await flushJogadores([payload(novo[0].id, novo[0].pks, 'a'), payload(novo[1].id, novo[1].pks, 'b')]);
  ok(gravados === 2, 'o lote devolve quantos gravou, como antes');

  for (const [i, variante] of [[0, 'a'], [1, 'b']]) {
    const lv = await linhaJogador(velho[i].id);
    const ln = await linhaJogador(novo[i].id);
    ok(ln.last_seen.getTime() >= antes - 5000, `variante ${variante}: last_seen atualizado`);
    delete lv.last_seen;
    delete ln.last_seen;
    const idsV = [velho[i].id, ...velho[i].pks];
    const idsN = [novo[i].id, ...novo[i].pks];
    const tv = normalizar(lv, idsV, idsN);
    const tn = normalizar(ln, idsN, idsN);
    const difs = Object.keys(lv).filter((k) => normalizar(lv[k], idsV, idsN) !== normalizar(ln[k], idsN, idsN));
    ok(tv === tn, `variante ${variante}: as 32 colunas do jogador saem iguais`, difs.join(', '));
    const pv = await linhasPokemon(velho[i].pks);
    const pn = await linhasPokemon(novo[i].pks);
    ok(JSON.stringify(pv) === JSON.stringify(pn), `variante ${variante}: as colunas dos pokémon saem iguais`,
      `${JSON.stringify(pv)} ≠ ${JSON.stringify(pn)}`);
    ok(pn[1].bonus_base?.atk === 2, `variante ${variante}: refino nulo preserva o bonus_base que a linha tinha`);
  }
}

// ------------------------------------------------------------ casos de borda
{
  console.log('\nCasos de borda');
  ok(await flushJogadores([]) === 0, 'lote vazio não abre transação e devolve 0');

  const j = await criarJogador(`${PREFIXO}_dup`, 3);
  const primeiro = payload(j.id, [j.pks[0]], 'a');
  const repetido = { ...payload(j.id, [j.pks[1], j.pks[2]], 'a'), level: 91 };
  await flushJogadores([primeiro, repetido]);
  const lj = await linhaJogador(j.id);
  const pk = await linhasPokemon(j.pks);
  ok(lj.level === 91, 'jogador repetido no lote: fica o último retrato');
  ok(pk.every((r) => r.level >= 30), 'e os pokémon das duas entradas são gravados');

  const falha = await criarJogador(`${PREFIXO}_falha`, 1);
  const ruim = { ...payload(falha.id, falha.pks, 'a'), gender: null }; // NOT NULL
  const bom = { ...payload(j.id, [], 'a'), level: 55 };
  let erro = null;
  try {
    await flushJogadores([bom, ruim]);
  } catch (err) {
    erro = err.message;
  }
  ok(!!erro, `valor inválido derruba o lote inteiro (${erro?.slice(0, 60)})`);
  ok((await linhaJogador(j.id)).level === 91, 'e NADA do lote foi gravado: a transação continua tudo-ou-nada');

  process.env.FLUSH_LOTE = '0';
  await flushJogadores([{ ...payload(j.id, [], 'a'), level: 60 }]);
  delete process.env.FLUSH_LOTE;
  ok((await linhaJogador(j.id)).level === 60, 'FLUSH_LOTE=0 volta ao caminho de uma query por linha');
}

// -------------------------------------------------------------------- tempo
{
  console.log('\nTempo');
  const N = 700;
  const lote = [];
  for (let i = 0; i < N; i++) {
    const j = await criarJogador(`${PREFIXO}_t${i}`, 3);
    lote.push(j);
  }
  const montar = () => lote.map((j) => payload(j.id, j.pks, 'a'));
  let t = performance.now();
  await flushJogadoresUmPorUm(montar());
  const msVelho = performance.now() - t;
  t = performance.now();
  await flushJogadores(montar());
  const msNovo = performance.now() - t;
  console.log(`  ${N} jogadores × 3 pokémon: uma query por linha ${msVelho.toFixed(0)} ms · em lote ${msNovo.toFixed(0)} ms · ${(msVelho / msNovo).toFixed(1)}×`);
  ok(msNovo < msVelho, 'o lote é mais rápido que uma query por linha');
}

await limpar();
await pool.end();
console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
