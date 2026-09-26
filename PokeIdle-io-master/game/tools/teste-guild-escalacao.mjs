/**
 * O TIME da guild — a guild sem teto de membros e as dez vagas da Guerra de Guilds.
 *
 *   npm run test:guild:escalacao     (precisa do Postgres: `npm run infra`)
 *
 * ### Por que este arquivo existe
 *
 * A guild deixou de ter teto de tamanho e ganhou um teto de TIME: `MAX_TIME_GUILD` escalados,
 * escolhidos pelo dono, que são os únicos a lutar a guerra, a levar o bônus diário do ranking e
 * a receber o diamante do fechamento mensal. A regra é simples de dizer e fácil de quebrar em
 * silêncio, porque ela mora em cinco lugares diferentes:
 *
 *   · o INSERT de quem entra (`aceitarConvite`) decide se há vaga;
 *   · o DELETE de quem sai (`sairDaGuild`, `expulsarMembro`) devolve a vaga a quem estava fora;
 *   · o UPDATE do dono (`definirEscalacao`) troca o time inteiro de uma vez;
 *   · a guerra (`membrosParaGuerra`) corta por `gm.escalado`;
 *   · o prêmio do mês (`playerIdsEscalados`) corta pelo mesmo campo.
 *
 * Um `WHERE` esquecido em qualquer um dos cinco não quebra nada na hora: a guild continua
 * funcionando, o painel continua abrindo — e a conta só sai errada na guerra seguinte, ou no
 * primeiro dia do mês, quando não há mais como desfazer o diamante pago a mais.
 *
 * `teste-guild-pvp.mjs` não serve para isto: ele simula a batalha deliberadamente sem banco.
 */
import { pool } from '../src/server/db.mjs';
import * as gdb from '../src/server/guild-db.mjs';
import { MAX_TIME_GUILD } from '../src/server/game/guild.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

console.log('Guild — o TIME (escalação)\n==========================');

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.log(`\nPostgres indisponível (${err.message}) — suba com: npm run infra`);
  process.exit(1);
}

await (await import('../src/server/db.mjs')).migrar();
await gdb.migrar();

const sufixo = Math.floor(Math.random() * 1e6);
const criados = [];

/** Um treinador novo em folha. O dono nasce podendo pagar os 250k da guild. */
async function novoJogador(nome, gold = 0) {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, gold) VALUES ($1, $2) RETURNING id`,
    [`${nome}${sufixo}`, gold],
  );
  const id = Number(rows[0].id);
  criados.push(id);
  return id;
}

/** Entra na guild pelo caminho de verdade: convite do dono + aceite. */
async function entrarNaGuild(ownerId, playerId, nick) {
  await gdb.convidarMembro(ownerId, `${nick}${sufixo}`);
  const [convite] = await gdb.convitesPendentes(playerId);
  await gdb.aceitarConvite(playerId, convite.id);
}

const escaladosDe = async (guildId) =>
  (await gdb.membrosParaEscalacao(guildId)).filter((m) => m.escalado).map((m) => m.nick);

try {
  // ----------------------------------------------------------------- a guild cresce
  secao('A guild não tem teto de membros');

  const ownerId = await novoJogador('escDono', 500_000);
  const { guild } = await gdb.criarGuild(ownerId, `Esc${sufixo}`, {});
  const guildId = Number(guild.id);

  ok(guild.escalado === true, 'o dono nasce escalado');
  ok(guild.membros === 1 && guild.escalados === 1, 'guild de um: um membro, um escalado');

  // Mais catorze — quatro a mais do que o time comporta.
  const membros = [];
  for (let i = 1; i <= 14; i++) {
    const nick = `escM${i}_`;
    const id = await novoJogador(nick);
    await entrarNaGuild(ownerId, id, nick);
    membros.push({ id, nick: `${nick}${sufixo}` });
  }

  const doDono = await gdb.guildDoJogador(ownerId);
  ok(doDono.membros === 15, `a guild tem 15 membros (o antigo teto era 6)`, `veio ${doDono.membros}`);
  ok(
    doDono.escalados === MAX_TIME_GUILD,
    `mas só ${MAX_TIME_GUILD} escalados`,
    `veio ${doDono.escalados}`,
  );

  // ----------------------------------------------------------------- quem entrou primeiro
  secao('Quem entra primeiro pega a vaga; o resto é reserva');

  const ordem = await gdb.membrosParaEscalacao(guildId);
  const reservas = ordem.filter((m) => !m.escalado);
  ok(reservas.length === 5, 'cinco reservas', `veio ${reservas.length}`);
  ok(
    reservas.every((r) => membros.slice(9).some((m) => m.nick === r.nick)),
    'as reservas são justamente os cinco últimos a entrar',
    reservas.map((r) => r.nick).join(', '),
  );

  const ultimo = await gdb.guildDoJogador(membros[13].id);
  ok(ultimo.escalado === false, 'o último a entrar sabe que é reserva');

  // ----------------------------------------------------------------- a guerra
  secao('A guerra e o prêmio do mês leem o TIME, não a lista de membros');

  const linhas = await gdb.membrosParaGuerra([guildId]);
  const idsNaGuerra = new Set(linhas.map((l) => Number(l.player_id)));
  ok(
    idsNaGuerra.size === MAX_TIME_GUILD,
    `${MAX_TIME_GUILD} lutadores por guild, e não os 15 membros`,
    `veio ${idsNaGuerra.size}`,
  );
  ok(!idsNaGuerra.has(membros[13].id), 'o reserva não entra na guerra');

  const premiados = await gdb.playerIdsEscalados(guildId);
  ok(premiados.length === MAX_TIME_GUILD, 'o diamante do mês vai para os escalados', `veio ${premiados.length}`);
  ok(!premiados.includes(membros[13].id), 'e não para o reserva');

  // ----------------------------------------------------------------- o dono escala
  secao('O dono escolhe o time');

  const alvo = [ownerId, ...membros.slice(9).map((m) => m.id)]; // dono + os cinco reservas
  await gdb.definirEscalacao(ownerId, alvo);
  const agora = await escaladosDe(guildId);
  ok(agora.length === MAX_TIME_GUILD, 'o time continua cheio depois da troca', `veio ${agora.length}`);
  const escaladosIds = new Set(await gdb.playerIdsEscalados(guildId));
  ok(alvo.every((id) => escaladosIds.has(id)), 'os seis escolhidos estão no time de verdade');
  ok(
    escaladosIds.size === MAX_TIME_GUILD,
    'e as quatro vagas que sobraram foram preenchidas sozinhas',
    `veio ${escaladosIds.size}`,
  );

  // ----------------------------------------------------------------- as recusas
  secao('As recusas');

  const demais = [ownerId, ...membros.map((m) => m.id)].slice(0, MAX_TIME_GUILD + 1);
  let erro = null;
  try {
    await gdb.definirEscalacao(ownerId, demais);
  } catch (err) {
    erro = err;
  }
  ok(erro?.codigo === 'limite', `escalar ${MAX_TIME_GUILD + 1} é recusado`, erro?.message ?? 'passou');

  const forasteiroId = await novoJogador('escFora');
  erro = null;
  try {
    await gdb.definirEscalacao(ownerId, [forasteiroId]);
  } catch (err) {
    erro = err;
  }
  ok(erro?.codigo === 'membro', 'escalar quem não é da guild é recusado', erro?.message ?? 'passou');

  erro = null;
  try {
    await gdb.definirEscalacao(membros[0].id, [membros[0].id]);
  } catch (err) {
    erro = err;
  }
  ok(erro?.codigo === 'dono', 'quem não lidera não escala', erro?.message ?? 'passou');

  // ----------------------------------------------------------------- a vaga que abre
  secao('Vaga aberta fecha sozinha');

  const antes = new Set(await gdb.playerIdsEscalados(guildId));
  const sacrificado = [...antes].find((id) => id !== ownerId);
  await gdb.expulsarMembro(ownerId, sacrificado);
  const depois = await gdb.playerIdsEscalados(guildId);
  ok(
    depois.length === MAX_TIME_GUILD,
    'expulsar um escalado não deixa o time com nove',
    `veio ${depois.length}`,
  );
  ok(!depois.includes(sacrificado), 'e o expulso saiu do time');

  // ----------------------------------------------------------------- a guild pequena
  secao('Guild que cabe inteira no time está toda escalada');

  const donoP = await novoJogador('escPeqDono', 500_000);
  const { guild: pequena } = await gdb.criarGuild(donoP, `EscP${sufixo}`, {});
  const idP = Number(pequena.id);
  for (let i = 1; i <= 3; i++) {
    const nick = `escP${i}_`;
    const id = await novoJogador(nick);
    await entrarNaGuild(donoP, id, nick);
  }
  const p = await gdb.guildDoJogador(donoP);
  ok(p.membros === 4 && p.escalados === 4, 'guild de quatro: os quatro escalados', `${p.membros}/${p.escalados}`);

  // O dono manda escalar só a si mesmo: como não há ninguém de fora para virar reserva, o
  // time volta a ser a guild inteira. É a mesma promessa vista do outro lado.
  await gdb.definirEscalacao(donoP, [donoP]);
  const depoisP = await gdb.playerIdsEscalados(idP);
  ok(
    depoisP.length === 4,
    'escalar só o dono não esvazia o time de uma guild de quatro',
    `veio ${depoisP.length}`,
  );

  // ----------------------------------------------------------------- limpeza
  secao('Limpeza');
  await gdb.apagarGuild(ownerId);
  await gdb.apagarGuild(donoP);
  await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [criados]);
  const { rows: sobrou } = await pool.query(
    `SELECT count(*)::int AS n FROM players WHERE id = ANY($1::bigint[])`,
    [criados],
  );
  ok(sobrou[0].n === 0, 'o teste não deixa jogador nem guild para trás');
} catch (err) {
  falhas++;
  console.log(`\n✗ o teste estourou: ${err.stack}`);
  await pool.query(`DELETE FROM guild_members WHERE player_id = ANY($1::bigint[])`, [criados]).catch(() => {});
  await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [criados]).catch(() => {});
}

console.log(`\n==============================================`);
console.log(falhas ? `${falhas} de ${testes} falharam` : `${testes} testes passaram`);
console.log(`==============================================`);
await pool.end();
process.exit(falhas ? 1 : 0);
