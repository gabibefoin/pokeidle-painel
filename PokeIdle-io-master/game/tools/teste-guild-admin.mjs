/**
 * Apagar uma guild pelo painel admin — a moderação de NOME.
 *
 *   npm run test:guild:admin     (precisa do Postgres: `npm run infra`)
 *
 * ### Por que este arquivo existe
 *
 * Guild com nome racista não é caso de conversar com o dono: é caso de apagar. E apagar tem
 * uma pegadinha que só aparece dias depois — o nome da guild foi COPIADO para dentro do
 * histórico das guerras (`resumo`, `replay`) e do pódio mensal (`podio`), que são JSONB e
 * portanto fora do alcance de qualquer chave estrangeira. Apagar só a linha de `guilds`
 * deixaria o slur no placar que todo jogador abre.
 *
 * A limpeza é cirúrgica de propósito: troca o nome NAS ENTRADAS DAQUELA guild, guiada pelo id
 * dentro do documento, e não por um replace de texto — nick de jogador e nome de arena moram
 * nos mesmos JSONB. É exatamente isso que os testes de "a outra guild ficou intacta" seguram.
 *
 * O resto (membros, convites, registro no evento) é `ON DELETE CASCADE` no schema: barato de
 * quebrar num refactor, impossível de perceber sem esperar a próxima guerra.
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

console.log('Guild — apagar pelo painel admin\n================================');

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.log(`\nPostgres indisponível (${err.message}) — suba com: npm run infra`);
  process.exit(1);
}
await gdb.migrar();

// Sufixo próprio por execução: o teste não pode depender do que já está no banco, nem tropeçar
// no que ele mesmo deixou numa rodada anterior que morreu no meio.
const sufixo = Math.floor(Math.random() * 1e6);
const criados = { players: [], guilds: [], dias: [], meses: [] };

const novoPlayer = async (nick) => {
  const { rows } = await pool.query(`INSERT INTO players (nick) VALUES ($1) RETURNING id`, [nick]);
  criados.players.push(Number(rows[0].id));
  return Number(rows[0].id);
};
const novaGuild = async (nome, ownerId) => {
  const { rows } = await pool.query(
    `INSERT INTO guilds (nome, owner_id, gp) VALUES ($1, $2, 10) RETURNING id`,
    [nome, ownerId],
  );
  const id = Number(rows[0].id);
  criados.guilds.push(id);
  await pool.query(`INSERT INTO guild_members (guild_id, player_id) VALUES ($1, $2)`, [id, ownerId]);
  return id;
};

try {
  const NOME_A = `admOfensiva${sufixo}`;
  const NOME_B = `admInocente${sufixo}`;
  const donoA = await novoPlayer(`admDonoA${sufixo}`);
  const membroA = await novoPlayer(`admMembroA${sufixo}`);
  const donoB = await novoPlayer(`admDonoB${sufixo}`);
  const idA = await novaGuild(NOME_A, donoA);
  const idB = await novaGuild(NOME_B, donoB);
  await pool.query(`INSERT INTO guild_members (guild_id, player_id) VALUES ($1, $2)`, [idA, membroA]);
  await pool.query(
    `INSERT INTO guild_invites (guild_id, player_id, convidado_por) VALUES ($1,$2,$3)`,
    [idA, donoB, donoA],
  );

  // Uma guerra em que as duas brigaram, no formato que `guild-pvp.mjs` grava de verdade.
  const dia = `1999-01-${String((sufixo % 28) + 1).padStart(2, '0')}`;
  criados.dias.push(dia);
  const resumo = {
    dia, motivo: 'wipe', versao: 3, totalGuilds: 2, arena: 'x',
    vencedor: { id: idA, nome: NOME_A, gp: 3, mvp: { nick: `admDonoA${sufixo}`, abates: 2 } },
    placar: [
      { id: idA, nome: NOME_A, pos: 1, gp: 3, abates: 2, mortes: 0, membros: [{ nick: `admDonoA${sufixo}`, abates: 2 }] },
      { id: idB, nome: NOME_B, pos: 2, gp: 1, abates: 0, mortes: 2, membros: [{ nick: `admDonoB${sufixo}`, abates: 0 }] },
    ],
  };
  const replay = {
    versao: 3,
    guilds: [{ id: idA, nome: NOME_A, brasao: {} }, { id: idB, nome: NOME_B, brasao: {} }],
    atores: [{ nick: `admDonoA${sufixo}` }],
    quadros: [],
  };
  await pool.query(
    `INSERT INTO guild_pvp_batalhas (evento_data, vencedor_id, resumo, replay) VALUES ($1,$2,$3,$4)`,
    [dia, idA, JSON.stringify(resumo), JSON.stringify(replay)],
  );
  await pool.query(`INSERT INTO guild_pvp_eventos (evento_data, vencedor_id) VALUES ($1,$2)`, [dia, idA]);
  await pool.query(`INSERT INTO guild_pvp_registros (guild_id, evento_data) VALUES ($1,$2)`, [idA, dia]);

  const mes = dia.slice(0, 7);
  criados.meses.push(mes);
  await pool.query(
    `INSERT INTO guild_global_temporadas (mes, podio) VALUES ($1,$2)
     ON CONFLICT (mes) DO UPDATE SET podio = EXCLUDED.podio`,
    [mes, JSON.stringify([
      { guildId: idA, nome: NOME_A, pos: 1, gp: 10, membros: 2, diamantesCada: 5 },
      { guildId: idB, nome: NOME_B, pos: 2, gp: 5, membros: 1, diamantesCada: 3 },
    ])],
  );

  secao('A lista do painel');
  {
    const lista = await gdb.listarGuildsAdmin({ busca: NOME_A });
    ok(lista.length === 1, 'a busca por trecho do nome acha a guild', `veio ${lista.length}`);
    const l = lista[0];
    ok(l?.ownerNick === `admDonoA${sufixo}`, 'a linha traz o dono', l?.ownerNick);
    ok(l?.membros === 2, 'e a contagem de membros', `veio ${l?.membros}`);
    const todas = await gdb.listarGuildsAdmin({ busca: '', limite: 5 });
    ok(todas.length <= 5, 'o limite é respeitado', `veio ${todas.length}`);
  }

  secao('Apagar');
  const apagada = await gdb.apagarGuildPorAdmin(idA, { por: 'admin@teste' });
  {
    ok(apagada.nome === NOME_A, 'devolve o nome apagado (para o log e o aviso)');
    ok(apagada.membros.length === 2, 'e quem eram os membros', `veio ${apagada.membros.length}`);
    const sumiu = async (sql, params) => (await pool.query(sql, params)).rows.length === 0;
    ok(await sumiu(`SELECT id FROM guilds WHERE id = $1`, [idA]), 'a guild sumiu');
    ok(await sumiu(`SELECT player_id FROM guild_members WHERE guild_id = $1`, [idA]),
      'os membros foram soltos (cascade)');
    ok(await sumiu(`SELECT id FROM guild_invites WHERE guild_id = $1`, [idA]),
      'os convites pendentes sumiram');
    ok(await sumiu(`SELECT guild_id FROM guild_pvp_registros WHERE guild_id = $1`, [idA]),
      'o registro no evento sumiu — nada de guild fantasma na próxima guerra');
    ok(!(await sumiu(`SELECT id FROM guilds WHERE id = $1`, [idB])),
      'a guild vizinha continua de pé');
    ok(!(await sumiu(`SELECT id FROM players WHERE id = $1`, [donoA])),
      'apagar a guild NÃO apaga a conta do dono');
  }

  secao('O nome sai do histórico');
  {
    const { rows } = await pool.query(
      `SELECT vencedor_id, resumo, replay FROM guild_pvp_batalhas WHERE evento_data = $1`, [dia],
    );
    const r = rows[0].resumo;
    const rep = rows[0].replay;
    ok(rows[0].vencedor_id === null, 'o vencedor_id da batalha virou nulo (SET NULL)');
    ok(r.vencedor.nome === gdb.GUILD_NOME_REMOVIDO, 'o nome sai do vencedor do placar', r.vencedor.nome);
    ok(r.placar.find((x) => x.id === idA)?.nome === gdb.GUILD_NOME_REMOVIDO,
      'e da linha dela no placar', JSON.stringify(r.placar.map((x) => x.nome)));
    ok(r.placar.find((x) => x.id === idB)?.nome === NOME_B,
      'a guild vizinha do placar fica INTACTA');
    ok(r.placar[0].pos === 1 && r.placar[0].gp === 3 && r.placar[0].abates === 2
      && r.placar[0].membros[0].nick === `admDonoA${sufixo}`,
      'o resto da linha sobrevive: posição, GP, abates e membros', JSON.stringify(r.placar[0]));
    ok(r.placar[0].id === idA && r.placar[1].id === idB, 'a ordem do placar não muda');
    ok(r.vencedor.mvp?.nick === `admDonoA${sufixo}` && r.motivo === 'wipe' && r.totalGuilds === 2,
      'e o resumo continua inteiro (MVP, motivo, total)');
    ok(rep.guilds.find((x) => x.id === idA)?.nome === gdb.GUILD_NOME_REMOVIDO,
      'o nome sai do replay', JSON.stringify(rep.guilds.map((x) => x.nome)));
    ok(rep.guilds.find((x) => x.id === idB)?.nome === NOME_B && rep.atores.length === 1,
      'e o replay mantém a vizinha e os atores');

    const { rows: t } = await pool.query(
      `SELECT podio FROM guild_global_temporadas WHERE mes = $1`, [mes],
    );
    ok(t[0].podio.find((x) => x.guildId === idA)?.nome === gdb.GUILD_NOME_REMOVIDO,
      'o nome sai do pódio mensal', JSON.stringify(t[0].podio.map((x) => x.nome)));
    ok(t[0].podio[0].diamantesCada === 5 && t[0].podio[0].pos === 1 && t[0].podio[1].nome === NOME_B,
      'e o pódio mantém prêmio, posição e a vizinha');
  }

  secao('As recusas');
  {
    let erro = null;
    await gdb.apagarGuildPorAdmin(idA).catch((e) => (erro = e.message));
    ok(erro === 'guild não encontrada', 'apagar duas vezes dá erro claro', erro ?? 'passou');
    erro = null;
    await gdb.apagarGuildPorAdmin(0).catch((e) => (erro = e.message));
    ok(!!erro, 'id inválido é recusado', erro ?? 'passou');
  }
} finally {
  for (const d of criados.dias) {
    await pool.query(`DELETE FROM guild_pvp_batalhas WHERE evento_data = $1`, [d]);
    await pool.query(`DELETE FROM guild_pvp_eventos WHERE evento_data = $1`, [d]);
  }
  for (const m of criados.meses) await pool.query(`DELETE FROM guild_global_temporadas WHERE mes = $1`, [m]);
  for (const id of criados.guilds) await pool.query(`DELETE FROM guilds WHERE id = $1`, [id]);
  for (const id of criados.players) await pool.query(`DELETE FROM players WHERE id = $1`, [id]);
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM guilds WHERE nome LIKE 'adm%' || $1) AS g,
            (SELECT count(*)::int FROM players WHERE nick LIKE 'adm%' || $1) AS p`,
    [String(sufixo)],
  );
  ok(rows[0].g === 0 && rows[0].p === 0, 'o teste não deixa guild nem jogador para trás',
    `sobraram ${rows[0].g} guild(s) e ${rows[0].p} jogador(es)`);

  console.log(`\n==============================================`);
  console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `tudo certo (${testes} testes)`);
  await pool.end();
  process.exit(falhas ? 1 : 0);
}
