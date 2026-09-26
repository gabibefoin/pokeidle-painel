/**
 * O registro automático da guild nos eventos de PvP — e o que acontece quando ela morre.
 *
 *   npm run test:guild:registro     (precisa do Postgres: `npm run infra`)
 *
 * ### Por que este arquivo existe
 *
 * O registro deixou de ser diário: o dono clica UMA vez e a guild passa a entrar em toda
 * guerra seguinte. Isso troca uma ação que alguém repetia (e portanto conferia) por um estado
 * gravado que ninguém mais olha — e estado que ninguém olha é onde uma guild fantasma
 * apareceria numa guerra semanas depois de ter sido apagada.
 *
 * A garantia de que isso não acontece é o `ON DELETE CASCADE` de `guild_pvp_registros`, mais o
 * fato de `registrarGuildsAutomaticas` ler de `guilds` (uma guild apagada não está mais lá).
 * São duas linhas de schema e uma de SQL, fáceis de perder num refactor e impossíveis de
 * perceber sem esperar a próxima guerra. Daí o teste.
 *
 * `teste-guild-pvp.mjs` não serve para isto: ele é o simulador da batalha, deliberadamente sem
 * banco nenhum.
 */
import { pool } from '../src/server/db.mjs';
import * as gdb from '../src/server/guild-db.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

console.log('Guild — registro automático nos eventos\n=======================================');

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.log(`\nPostgres indisponível (${err.message}) — suba com: npm run infra`);
  process.exit(1);
}

await (await import('../src/server/db.mjs')).migrar();
await gdb.migrar();

/** Um dono novo em folha por execução: o teste não pode depender do que já está no banco. */
const sufixo = Math.floor(Math.random() * 1e6);
// Criar guild custa 250.000 coins; o dono de teste nasce podendo pagar.
const { rows: pRows } = await pool.query(
  `INSERT INTO players (nick, gold) VALUES ($1, 500000) RETURNING id`,
  [`greg${sufixo}`],
);
const ownerId = Number(pRows[0].id);

// `criarGuild` devolve { guild, gold } — o id está dentro de `guild`.
const { guild } = await gdb.criarGuild(ownerId, `Reg${sufixo}`, {});
const guildId = Number(guild.id);

const HOJE = gdb.dataEventoGuild();
const dia = (n) => {
  const d = new Date(`${HOJE}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const registrosDe = async (id, data) => {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM guild_pvp_registros WHERE guild_id = $1 AND evento_data = $2`,
    [id, data],
  );
  return rows[0].n;
};
const autoDe = async (id) => {
  const { rows } = await pool.query(`SELECT pvp_auto_registro FROM guilds WHERE id = $1`, [id]);
  return rows[0]?.pvp_auto_registro ?? null;
};

// ------------------------------------------------------------------ registro

secao('Um clique liga o registro permanente');
{
  ok((await autoDe(guildId)) === false, 'guild nova nasce SEM registro automático');
  ok((await registrosDe(guildId, HOJE)) === 0, 'e sem inscrição para hoje');

  await gdb.registrarGuildPvp(guildId, ownerId, HOJE);

  ok((await autoDe(guildId)) === true, 'depois do clique, o automático fica LIGADO');
  ok((await registrosDe(guildId, HOJE)) === 1, 'e ela já entra no evento de hoje');
}

secao('E vale para os dias seguintes, sem ninguém clicar de novo');
{
  await gdb.registrarGuildsAutomaticas(dia(1));
  await gdb.registrarGuildsAutomaticas(dia(2));
  ok((await registrosDe(guildId, dia(1))) === 1, 'amanhã: inscrita sozinha');
  ok((await registrosDe(guildId, dia(2))) === 1, 'depois de amanhã também');

  // Idempotência importa: a abertura do dia pode rodar duas vezes (restart, deploy) e não
  // pode duplicar inscrição — a chave primária composta é quem garante isso.
  await gdb.registrarGuildsAutomaticas(dia(1));
  ok((await registrosDe(guildId, dia(1))) === 1, 'rodar a abertura do dia de novo não duplica');
}

secao('Só quem é dono registra');
{
  const { rows } = await pool.query(
    `INSERT INTO players (nick) VALUES ($1) RETURNING id`,
    [`intru${sufixo}`],
  );
  let recusou = false;
  try {
    await gdb.registrarGuildPvp(guildId, Number(rows[0].id), HOJE);
  } catch {
    recusou = true;
  }
  ok(recusou, 'quem não é dono leva erro');
  await pool.query(`DELETE FROM players WHERE id = $1`, [rows[0].id]);
}

// -------------------------------------------------------- a guild que morreu

secao('Guild apagada SAI dos eventos — é o ponto deste arquivo');
{
  const antes = await gdb.registrosPvpDoDia(dia(1));
  ok(antes.some((g) => Number(g.id) === guildId), 'antes de apagar, ela aparece no dia');

  await gdb.apagarGuild(ownerId);

  ok((await registrosDe(guildId, HOJE)) === 0, 'a inscrição de hoje some junto com a guild');
  ok((await registrosDe(guildId, dia(1))) === 0, 'a de amanhã também');
  ok((await registrosDe(guildId, dia(2))) === 0, 'e a de depois de amanhã');

  const depois = await gdb.registrosPvpDoDia(dia(1));
  ok(!depois.some((g) => Number(g.id) === guildId), 'e ela não aparece mais na lista do dia');

  // O teste que pega o erro mais provável de um refactor: a abertura de um dia FUTURO não pode
  // ressuscitar a guild. `registrarGuildsAutomaticas` lê de `guilds`, e ela não está mais lá.
  await gdb.registrarGuildsAutomaticas(dia(3));
  ok((await registrosDe(guildId, dia(3))) === 0, 'a abertura de um dia futuro NÃO a ressuscita');
}

secao('Apagar uma guild que já VENCEU uma guerra continua possível');
{
  // `guild_pvp_eventos.vencedor_id` aponta para `guilds`. Sem `ON DELETE SET NULL` ali, apagar
  // a guild campeã falharia com erro de chave estrangeira — e o dono ficaria preso a ela.
  const { rows: p2 } = await pool.query(
    `INSERT INTO players (nick, gold) VALUES ($1, 500000) RETURNING id`,
    [`camp${sufixo}`],
  );
  const dono2 = Number(p2[0].id);
  const { guild: g2 } = await gdb.criarGuild(dono2, `Camp${sufixo}`, {});
  const diaVitoria = dia(4);

  await pool.query(
    `INSERT INTO guild_pvp_eventos (evento_data, vencedor_id, encerrado_em)
     VALUES ($1, $2, now())
     ON CONFLICT (evento_data) DO UPDATE SET vencedor_id = EXCLUDED.vencedor_id`,
    [diaVitoria, g2.id],
  );

  let apagou = true;
  try {
    await gdb.apagarGuild(dono2);
  } catch (err) {
    apagou = false;
    console.log(`      ${err.message}`);
  }
  ok(apagou, 'a guild campeã pode ser apagada');

  const { rows: ev } = await pool.query(
    `SELECT vencedor_id FROM guild_pvp_eventos WHERE evento_data = $1`,
    [diaVitoria],
  );
  ok(ev[0]?.vencedor_id === null, 'e o evento fica com vencedor NULO em vez de sumir');

  await pool.query(`DELETE FROM guild_pvp_eventos WHERE evento_data = $1`, [diaVitoria]);
  await pool.query(`DELETE FROM players WHERE id = $1`, [dono2]);
}

await pool.query(`DELETE FROM players WHERE id = $1`, [ownerId]);

console.log('\n==============================================');
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
await pool.end();
process.exit(falhas ? 1 : 0);
