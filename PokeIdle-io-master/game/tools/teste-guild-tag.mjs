/**
 * A TAG da guild — o padrão do nome, as reservadas e a espera de 24 h.
 *
 *   npm run test:guild:tag     (precisa do Postgres: `npm run infra`)
 *
 * ### Por que este arquivo existe
 *
 * A tag fica colada no nick de cada membro no chat do Mundo, a dois caracteres dos selos que o
 * jogo usa para marcar a própria equipe — e desde que eles encolheram para `[ADM]`, `[MOD]` e
 * `[HLP]`, os selos têm exatamente o FORMATO de uma tag de guild. A peneira que separa uma coisa
 * da outra é uma lista de oito palavras e uma tabela de sósias, e nenhuma das duas quebra de um
 * jeito visível: ela falha deixando PASSAR, e o primeiro a notar é o jogador que acreditou num
 * `[ADM]` de mentira.
 *
 * A espera de 24 h está aqui pela mesma razão: ela é uma coluna (`tag_editada_em`) que só o
 * caminho de escrita toca. Um refactor que esqueça de carimbá-la não derruba nada — só devolve
 * à guild a troca livre e infinita que a espera existe para impedir.
 *
 * O teste fala direto com `guild-db.mjs`, sem socket: o que se quer provar é a REGRA, e o
 * caminho da tela já é o mesmo `atualizarTagGuild` daqui.
 */
import { pool } from '../src/server/db.mjs';
import * as gdb from '../src/server/guild-db.mjs';
import {
  COR_TAG_PADRAO,
  corTagValida,
  MAX_TAG_GUILD,
  motivoTagInvalida,
  tagGuildValida,
  tagPadraoDoNome,
} from '../src/shared/guild-tag.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

console.log('Guild — a TAG\n=============');

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

async function novoDono(nome) {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, gold) VALUES ($1, 500000) RETURNING id`,
    [`${nome}${sufixo}`],
  );
  const id = Number(rows[0].id);
  criados.push(id);
  return id;
}

try {
  // ------------------------------------------------------- a régua, sem banco
  secao('A régua (pura, sem banco)');

  ok(tagPadraoDoNome('Lua Cheia') === 'LUA', 'o padrão são as 3 primeiras letras do nome');
  ok(tagPadraoDoNome('a-b') === 'AB', 'nome com menos de 3 alfanuméricos devolve o que há');
  ok(tagGuildValida('fas') === 'FAS', 'a tag sobe para caixa alta');
  ok(tagGuildValida('abcd') === 'ABC', `corta em ${MAX_TAG_GUILD} letras`);
  ok(tagGuildValida('x!!') === 'X', 'pontuação sai fora');

  for (const reservada of ['ADM', 'adm', 'MOD', 'mod', 'HLP', 'hlp', 'GM', 'SYS', 'BOT', 'DEV', 'STF']) {
    ok(motivoTagInvalida(reservada) === 'reservada', `"${reservada}" é recusada`);
  }
  // O desvio óbvio: o zero no lugar do O, o cinco no lugar do S.
  ok(motivoTagInvalida('M0D') === 'reservada', '"M0D" com zero também é recusada');
  ok(motivoTagInvalida('5YS') === 'reservada', '"5YS" com cinco também é recusada');
  ok(motivoTagInvalida('g m') === 'reservada', '"g m" vira GM depois de tirar o espaço');
  ok(tagPadraoDoNome('Adm Team') === null, 'nome que daria uma reservada nasce SEM tag');

  ok(corTagValida('#4dd0e1') === '#4dd0e1', 'cor da paleta passa');
  ok(corTagValida('#000000') === COR_TAG_PADRAO, 'cor fora da paleta volta ao padrão');
  ok(corTagValida('javascript:alert(1)') === COR_TAG_PADRAO, 'lixo no lugar da cor volta ao padrão');

  // ------------------------------------------------------- a guild nova
  secao('A guild nasce com tag');

  const dono = await novoDono('tagDono');
  const { guild } = await gdb.criarGuild(dono, `Lua${sufixo}`, {}, { cobrarOuro: false });
  ok(guild.tag === 'LUA', 'sem escolher nada, a tag vem do nome', `veio ${guild.tag}`);
  ok(guild.tagCor === COR_TAG_PADRAO, 'e a cor é a padrão');
  ok(guild.tagEditadaEm == null, 'a primeira troca ainda é livre');

  const dono2 = await novoDono('tagDono2');
  const { guild: g2 } = await gdb.criarGuild(dono2, `Sol${sufixo}`, {}, {
    cobrarOuro: false, tag: 'sn', tagCor: '#4dd0e1',
  });
  ok(g2.tag === 'SN' && g2.tagCor === '#4dd0e1', 'a tag escolhida na criação vale', `${g2.tag}/${g2.tagCor}`);

  const dono3 = await novoDono('tagDono3');
  let erro = null;
  try {
    await gdb.criarGuild(dono3, `Mod${sufixo}`, {}, { cobrarOuro: false, tag: 'MOD' });
  } catch (err) {
    erro = err;
  }
  ok(erro?.codigo === 'tag', 'criar com tag reservada é recusado', erro?.message ?? 'passou');

  // ------------------------------------------------------- a espera de 24 h
  secao('Uma troca a cada 24 horas');

  const r1 = await gdb.atualizarTagGuild(dono, 'ABC', '#06d6a0');
  ok(r1.tag === 'ABC' && r1.tagCor === '#06d6a0', 'a primeira troca passa');

  erro = null;
  try {
    await gdb.atualizarTagGuild(dono, 'XYZ', '#ffd166');
  } catch (err) {
    erro = err;
  }
  ok(erro?.codigo === 'cooldown', 'a segunda, dentro das 24 h, é recusada', erro?.message ?? 'passou');
  ok(erro?.horas > 0 && erro?.horas <= 24, 'e diz quantas horas faltam', `horas=${erro?.horas}`);

  // Salvar o que já está lá não pode custar um dia de espera.
  const r2 = await gdb.atualizarTagGuild(dono, 'ABC', '#06d6a0');
  ok(r2.semMudanca === true, 'salvar o MESMO valor não gasta a vez nem recusa');

  // A reservada continua barrada mesmo com o cooldown correndo — e a recusa é a da TAG, não a
  // da espera: quem tentou `[ADM]` precisa ouvir por que, não "volte em 24 h".
  erro = null;
  try {
    await gdb.atualizarTagGuild(dono, 'adm', '#ffd166');
  } catch (err) {
    erro = err;
  }
  ok(erro?.codigo === 'tag', 'reservada é recusada antes da espera', erro?.message ?? 'passou');

  // Passadas as 24 h, troca de novo.
  await pool.query(
    `UPDATE guilds SET tag_editada_em = now() - interval '25 hours' WHERE owner_id = $1`,
    [dono],
  );
  const r3 = await gdb.atualizarTagGuild(dono, 'XYZ', '#ffd166');
  ok(r3.tag === 'XYZ', 'passadas as 24 h, a troca volta a valer');

  // Apagar a tag é escolha legítima — e gasta a vez, senão seria a volta livre pelos fundos.
  await pool.query(
    `UPDATE guilds SET tag_editada_em = now() - interval '25 hours' WHERE owner_id = $1`,
    [dono],
  );
  const r4 = await gdb.atualizarTagGuild(dono, '', '#ffd166');
  ok(r4.tag === null, 'tag vazia APAGA a tag');
  const doDono = await gdb.guildDoJogador(dono);
  ok(doDono.tag === null, 'e ela some do estado do jogador');
  ok(doDono.tagEditadaEm != null, 'apagar também carimba a espera');

  // ------------------------------------------------------- quem pode trocar
  secao('Quem pode trocar a TAG');

  // Sem guild nenhuma: a recusa é `membro`, e não `dono` — ele não está NEM na guild.
  const semGuild = await novoDono('tagSemGuild');
  erro = null;
  try {
    await gdb.atualizarTagGuild(semGuild, 'ZZZ', '#ffd166');
  } catch (err) {
    erro = err;
  }
  ok(erro?.codigo === 'membro', 'quem não está em guild nenhuma é recusado', erro?.message ?? 'passou');

  // Na guild, mas membro comum: aí sim a recusa é de MANDO.
  const membro = await novoDono('tagMembro');
  await gdb.convidarMembro(dono2, `tagMembro${sufixo}`);
  const [conviteTag] = await gdb.convitesPendentes(membro);
  await gdb.aceitarConvite(membro, conviteTag.id);
  erro = null;
  try {
    await gdb.atualizarTagGuild(membro, 'ZZZ', '#ffd166');
  } catch (err) {
    erro = err;
  }
  ok(erro?.codigo === 'dono', 'membro comum da guild é recusado', erro?.message ?? 'passou');

  // E o SUB-DONO pode — é uma das coisas que ele ganha (ver `teste-guild-subdono.mjs`).
  await gdb.definirSubdono(dono2, membro, true);
  const rSub = await gdb.atualizarTagGuild(membro, 'SUB', '#06d6a0');
  ok(rSub.tag === 'SUB', 'sub-dono troca a TAG', JSON.stringify(rSub));

  // ------------------------------------------------------- o backfill
  secao('Guild antiga ganha tag no boot');

  const donoVelho = await novoDono('tagVelho');
  const { rows: gv } = await pool.query(
    `INSERT INTO guilds (nome, brasao, owner_id) VALUES ($1, '{}'::jsonb, $2) RETURNING id`,
    [`Velha${sufixo}`, donoVelho],
  );
  const idVelha = Number(gv[0].id);
  await pool.query(`UPDATE guilds SET tag = NULL WHERE id = $1`, [idVelha]);

  const donoAdm = await novoDono('tagAdmDono');
  const { rows: ga } = await pool.query(
    `INSERT INTO guilds (nome, brasao, owner_id, tag) VALUES ($1, '{}'::jsonb, $2, NULL) RETURNING id`,
    [`Adm${sufixo}`, donoAdm],
  );
  const idAdm = Number(ga[0].id);

  await gdb.migrar();

  const { rows: depois } = await pool.query(
    `SELECT id, nome, tag FROM guilds WHERE id = ANY($1::bigint[])`,
    [[idVelha, idAdm]],
  );
  const velha = depois.find((r) => Number(r.id) === idVelha);
  const adm = depois.find((r) => Number(r.id) === idAdm);
  ok(velha?.tag === 'VEL', 'a guild sem tag ganha as 3 primeiras letras do nome', `veio ${velha?.tag}`);
  ok(adm?.tag === null, 'e a que daria uma reservada continua sem tag', `veio ${adm?.tag}`);

  // ------------------------------------------------------- limpeza
  secao('Limpeza');
  for (const id of [dono, dono2, donoVelho, donoAdm]) {
    await gdb.apagarGuild(id).catch(() => {});
  }
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
