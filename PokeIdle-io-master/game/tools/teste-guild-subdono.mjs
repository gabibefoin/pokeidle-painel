/**
 * O SUB-DONO da guild — o que ele pode, e as três coisas que continuam sendo só do dono.
 *
 *   npm run test:guild:subdono     (precisa do Postgres: `npm run infra`)
 *
 * ### Por que este arquivo existe
 *
 * A regra que o dono pediu é fácil de dizer ("o sub-dono faz tudo, menos tirar o dono do
 * lugar") e fácil de implementar errado, porque "tirar o dono do lugar" tem TRÊS portas e só
 * uma delas se chama expulsar:
 *
 *   · **apagar a guild** — some com tudo, o dono junto;
 *   · **transferir a liderança** — um sub-dono que pudesse transferir se coroaria sozinho;
 *   · **nomear sub-dono** — quem controla a permissão controla a guild.
 *
 * Uma permissão esquecida em qualquer uma das três não quebra nada na hora: a guild continua
 * funcionando, a tela continua abrindo, e o dia em que alguém descobre é o dia em que a guild
 * de outra pessoa mudou de mãos. Por isso cada porta tem um teste que tenta ABRIR.
 *
 * O teste fala direto com `guild-db.mjs`: o caminho da tela passa pelo mesmo `mandoNaGuild`.
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

/** Roda `fn` e devolve o erro que ela lançou (ou `null` se passou). */
const recusa = async (fn) => {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
};

console.log('Guild — o SUB-DONO\n==================');

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

async function novoJogador(nome) {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, gold) VALUES ($1, 500000) RETURNING id`,
    [`${nome}${sufixo}`],
  );
  const id = Number(rows[0].id);
  criados.push(id);
  return id;
}

async function entrar(donoId, playerId, nick) {
  await gdb.convidarMembro(donoId, `${nick}${sufixo}`);
  const [convite] = await gdb.convitesPendentes(playerId);
  await gdb.aceitarConvite(playerId, convite.id);
}

try {
  const dono = await novoJogador('sdDono');
  const { guild } = await gdb.criarGuild(dono, `Sub${sufixo}`, {}, { cobrarOuro: false });
  const guildId = Number(guild.id);

  const sub = await novoJogador('sdSub');
  const sub2 = await novoJogador('sdSub2');
  const comum = await novoJogador('sdComum');
  const outro = await novoJogador('sdOutro');
  await entrar(dono, sub, 'sdSub');
  await entrar(dono, sub2, 'sdSub2');
  await entrar(dono, comum, 'sdComum');
  await entrar(dono, outro, 'sdOutro');

  // ------------------------------------------------------- nomear
  secao('Nomear sub-dono é só do dono');

  await gdb.definirSubdono(dono, sub, true);
  const doSub = await gdb.guildDoJogador(sub);
  ok(doSub.isSubdono === true, 'o dono promove', `isSubdono=${doSub.isSubdono}`);
  ok(doSub.isOwner === false, 'e promover não faz dele dono');

  let e = await recusa(() => gdb.definirSubdono(sub, sub2, true));
  ok(e?.codigo === 'dono', 'sub-dono NÃO nomeia outro sub-dono', e?.message ?? 'passou');

  e = await recusa(() => gdb.definirSubdono(comum, sub2, true));
  ok(e?.codigo === 'dono', 'membro comum também não', e?.message ?? 'passou');

  e = await recusa(() => gdb.definirSubdono(dono, dono, true));
  ok(e?.codigo === 'membro', 'o dono não se promove a si mesmo', e?.message ?? 'passou');

  // ------------------------------------------------------- o que ele PODE
  secao('O que o sub-dono pode');

  const forasteiro = await novoJogador('sdForasteiro');
  await gdb.convidarMembro(sub, `sdForasteiro${sufixo}`);
  const [conv] = await gdb.convitesPendentes(forasteiro);
  ok(!!conv, 'convida pelo nick');
  await gdb.aceitarConvite(forasteiro, conv.id);

  await gdb.atualizarBrasao(sub, { escudo: 'kite', emblema: 'moon', bg: '#4a2c6e' });
  const comBrasao = await gdb.guildDoJogador(dono);
  ok(comBrasao.brasao?.escudo === 'kite', 'troca o brasão', JSON.stringify(comBrasao.brasao));

  const rTag = await gdb.atualizarTagGuild(sub, 'SUB', '#4dd0e1');
  ok(rTag.tag === 'SUB' && rTag.tagCor === '#4dd0e1', 'troca a TAG', JSON.stringify(rTag));

  await gdb.definirEscalacao(sub, [dono, sub]);
  const escalados = await gdb.playerIdsEscalados(guildId);
  ok(escalados.includes(dono) && escalados.includes(sub), 'escala o time');

  await gdb.registrarGuildPvp(guildId, sub, gdb.dataEventoGuild());
  const registradas = await gdb.registrosPvpDoDia(gdb.dataEventoGuild());
  ok(registradas.some((g) => g.id === guildId), 'registra a guild na guerra');

  await gdb.expulsarMembro(sub, forasteiro);
  const depois = await gdb.membrosParaEscalacao(guildId);
  ok(!depois.some((m) => m.playerId === forasteiro), 'expulsa membro comum');

  // ------------------------------------------------------- o que ele NÃO pode
  secao('As três portas que continuam fechadas');

  e = await recusa(() => gdb.expulsarMembro(sub, dono));
  ok(e != null, 'NÃO expulsa o dono', e?.message ?? 'passou');

  await gdb.definirSubdono(dono, sub2, true);
  e = await recusa(() => gdb.expulsarMembro(sub, sub2));
  ok(e?.codigo === 'dono', 'NÃO expulsa outro sub-dono', e?.message ?? 'passou');

  e = await recusa(() => gdb.transferirLideranca(sub, comum));
  ok(e?.codigo === 'dono', 'NÃO transfere a liderança', e?.message ?? 'passou');

  e = await recusa(() => gdb.apagarGuild(sub));
  ok(e?.codigo === 'dono', 'NÃO apaga a guild', e?.message ?? 'passou');
  const viva = await gdb.guildDoJogador(dono);
  ok(viva?.id === guildId, 'e a guild continua de pé depois da tentativa');

  // ------------------------------------------------------- membro comum
  secao('Membro comum não gere nada');

  for (const [nome, fn] of [
    ['convidar', () => gdb.convidarMembro(comum, `sdOutro${sufixo}`)],
    ['expulsar', () => gdb.expulsarMembro(comum, outro)],
    ['brasão', () => gdb.atualizarBrasao(comum, { escudo: 'round' })],
    ['TAG', () => gdb.atualizarTagGuild(comum, 'ZZZ', '#ffd166')],
    ['escalação', () => gdb.definirEscalacao(comum, [comum])],
    ['registro na guerra', () => gdb.registrarGuildPvp(guildId, comum, gdb.dataEventoGuild())],
  ]) {
    e = await recusa(fn);
    ok(e != null, `membro comum não faz: ${nome}`, e?.message ?? 'PASSOU');
  }

  // ------------------------------------------------------- a transferência
  secao('Transferir a liderança troca os dois de lugar');

  await gdb.transferirLideranca(dono, sub);
  const novoDono = await gdb.guildDoJogador(sub);
  const exDono = await gdb.guildDoJogador(dono);
  ok(novoDono.isOwner === true, 'quem recebeu virou dono');
  ok(novoDono.isSubdono === false, 'e deixou de ser sub-dono (seria a mesma permissão duas vezes)');
  ok(exDono.isOwner === false && exDono.isSubdono === true,
    'quem passou o leme virou sub-dono, não membro comum',
    `dono=${exDono.isOwner} sub=${exDono.isSubdono}`);

  // ------------------------------------------------------- limpeza
  secao('Limpeza');
  await gdb.apagarGuild(sub).catch(() => {});
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
  await pool.query(`DELETE FROM guilds WHERE owner_id = ANY($1::bigint[])`, [criados]).catch(() => {});
  await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [criados]).catch(() => {});
}

console.log(`\n==============================================`);
console.log(falhas ? `${falhas} de ${testes} falharam` : `${testes} testes passaram`);
console.log(`==============================================`);
await pool.end();
process.exit(falhas ? 1 : 0);
