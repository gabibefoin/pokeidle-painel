// A EQUIPE DO CAMPEONATO — "Selecionar minha Equipe".
//
// O inscrito escolhe até cinco pokémon só para o campeonato; sem escolha, luta a equipe do PvP
// Ranqueado. O que este teste protege:
//
//   · **o congelamento usa a equipe certa**: a escolhida passa na frente da do PvP, a do PvP vale
//     para quem não escolheu, e um pokémon escolhido que mudou de dono fica de fora;
//   · **as regras da escolha**: só inscrito, só até o prazo, só pokémon dele e fora do Mercado,
//     no máximo cinco, sem repetição — e `[]` volta a valer a do PvP;
//   · **o socket**: `campeonato.equipe` grava, responde com a equipe nova e recusa o que deve.
//
// Contas temporárias, criadas direto no banco e apagadas no fim. Precisa do servidor de pé:
//
//   npm start
//   node tools/teste-campeonato-equipe.mjs
import { WebSocket } from 'ws';
import { sessaoDe } from './sessao-local.mjs';
import { helloCom } from './auth-teste.mjs';
import { pool } from '../src/server/db.mjs';
import { especies, xpTotalParaNivel } from '../src/server/content.mjs';
import * as cdb from '../src/server/campeonato-db.mjs';
import * as pvpdb from '../src/server/pvp-ranqueado-db.mjs';
import { escolherEquipe, infoCampeonato } from '../src/server/game/campeonato.mjs';
import { campeonatoDe } from '../src/shared/campeonato.mjs';

/** O Mundial #1 — é o campeonato de verdade que a segunda metade do teste exercita. */
const CAMPEONATO = campeonatoDe('mundial', 2026, 9);

const URL = process.env.WS_URL ?? 'ws://localhost:8080';
const MARCA = Date.now().toString(36).slice(-5);
const ID2 = `teste-equipe-${Date.now()}`;
const IVS = JSON.stringify({ hp: 24, atk: 24, def: 24, spAtk: 24, spDef: 24, speed: 24 });

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const esp = (nome) => [...especies.values()].find((e) => e.name === nome);
const criadas = [];

async function criarConta(sufixo, { nivel = 320, pokemons = 7 } = {}) {
  const nick = `ceq${MARCA}${sufixo}`;
  criadas.push(nick);
  await pool.query(`INSERT INTO accounts (nick, email, provedor, email_ok) VALUES ($1, $2, 'local', true)`, [nick, `${nick}@test.local`]);
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, xp, visual_ok, tutorial_visto, discord_pop_campanha, aviso_visto)
     VALUES ($1, $2, $3, true, true, 99, 99) RETURNING id`,
    [nick, nivel, xpTotalParaNivel(nivel)],
  );
  const id = Number(rows[0].id);
  const ins = async (e, slot) => Number((await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, quality, ivs, hp, shiny, potencia, slot)
     VALUES ($1, $2, 100, 1.2, $3::jsonb, 9999, false, 1, $4) RETURNING id`,
    [id, e.pokeId, IVS, slot],
  )).rows[0].id);
  const ativo = await ins(esp('Pikachu'), 1);
  await pool.query(`UPDATE players SET active_poke = $2 WHERE id = $1`, [id, ativo]);
  const pks = [];
  for (let i = 0; i < pokemons; i++) pks.push(await ins(esp(i % 2 ? 'Gengar' : 'Charmander'), null));
  return { nick, id, ativo, pks };
}

async function limpar() {
  await pool.query(`DELETE FROM campeonato_inscricoes WHERE campeonato = $1`, [ID2]).catch(() => {});
  await pool.query(`DELETE FROM campeonato_chaves WHERE campeonato = $1`, [ID2]).catch(() => {});
  for (const nick of criadas) {
    const { rows } = await pool.query(`SELECT id FROM players WHERE lower(nick) = lower($1)`, [nick]);
    const id = rows[0]?.id;
    if (id) {
      await pool.query(`DELETE FROM campeonato_inscricoes WHERE player_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM pvp_time WHERE player_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM player_pokemon WHERE player_id = $1`, [id]).catch(() => {});
    }
    await pool.query(`DELETE FROM accounts WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
    await pool.query(`DELETE FROM players WHERE lower(nick) = lower($1)`, [nick]).catch(() => {});
  }
}

const retratoIds = async (campeonato, playerId) => {
  const { rows } = await pool.query(
    `SELECT equipe FROM campeonato_inscricoes WHERE campeonato = $1 AND player_id = $2`, [campeonato, playerId],
  );
  const e = typeof rows[0]?.equipe === 'string' ? JSON.parse(rows[0].equipe) : rows[0]?.equipe;
  return (e ?? []).map((pk) => Number(pk.id));
};
const recusa = async (fn) => {
  try {
    await fn();
    return null;
  } catch (err) {
    return err.message;
  }
};

console.log('EQUIPE DO CAMPEONATO\n====================');
try {
  await cdb.migrar();

  // --------------------------------------------------------------------------------------------
  secao('O congelamento usa a equipe certa');
  {
    const escolheu = await criarConta('a');
    const soPvp = await criarConta('b');
    const vendeu = await criarConta('c');
    const outro = await criarConta('d', { pokemons: 1 });
    for (const c of [escolheu, soPvp, vendeu]) {
      await cdb.inscrever(ID2, c.id);
      await pvpdb.salvarTime(c.id, c.pks.slice(0, 3));
    }
    ok(await cdb.escolherEquipe(ID2, escolheu.id, [escolheu.pks[6], escolheu.pks[5]]) === 'ok', 'a escolha grava');
    ok(await cdb.escolherEquipe(ID2, vendeu.id, vendeu.pks.slice(3, 6)) === 'ok', 'a do terceiro também');
    ok(await cdb.escolherEquipe(ID2, outro.id, outro.pks) === 'fora', 'quem não é inscrito não grava');
    ok(JSON.stringify(await cdb.equipeEscolhida(ID2, escolheu.id)) === JSON.stringify([escolheu.pks[6], escolheu.pks[5]]),
      'a escolha volta na ordem pedida');
    ok(await cdb.equipeEscolhida(ID2, soPvp.id) === null, 'sem escolha, a leitura devolve nada');
    // O terceiro "vende" um dos escolhidos depois de escolher.
    await pool.query(`UPDATE player_pokemon SET player_id = $1 WHERE id = $2`, [outro.id, vendeu.pks[4]]);

    const cong = await cdb.congelarChave(ID2, 0);
    ok(cong.gerou && cong.participantes === 3, 'a chave congela', JSON.stringify(cong));
    ok((await retratoIds(ID2, escolheu.id)).length === 0, 'a chave sozinha NÃO tira o retrato das equipes');
    // O segundo congelamento, no fim do dia de análise: é ele que fotografa as equipes.
    const congEq = await cdb.congelarEquipes(ID2, CAMPEONATO);
    ok(congEq.gerou && congEq.equipes === 3, 'as equipes congelam depois', JSON.stringify(congEq));
    ok(JSON.stringify(await retratoIds(ID2, escolheu.id)) === JSON.stringify([escolheu.pks[6], escolheu.pks[5]]),
      'quem escolheu congela com a escolhida, na ordem — e não com a do PvP');
    ok(JSON.stringify(await retratoIds(ID2, soPvp.id)) === JSON.stringify(soPvp.pks.slice(0, 3)),
      'quem não escolheu congela com a equipe do PvP');
    ok(JSON.stringify(await retratoIds(ID2, vendeu.id)) === JSON.stringify([vendeu.pks[3], vendeu.pks[5]]),
      'o escolhido que mudou de dono fica de fora', JSON.stringify(await retratoIds(ID2, vendeu.id)));
    ok(await cdb.escolherEquipe(ID2, escolheu.id, [escolheu.pks[0]]) === 'congelada', 'depois do congelamento, a escolha é recusada');
    ok(JSON.stringify(await retratoIds(ID2, escolheu.id)) === JSON.stringify([escolheu.pks[6], escolheu.pks[5]]),
      'e o retrato não muda');
  }

  // --------------------------------------------------------------------------------------------
  secao('As regras da escolha (campeonato de verdade, prazo aberto)');
  // Antes do FECHAMENTO DAS INSCRIÇÕES, não do prazo da equipe: esta seção chama
  // `infoCampeonato`, que congela a chave sozinho quando o prazo já passou — e congelaria a
  // do campeonato de verdade no banco local.
  const aberto = CAMPEONATO.inscricoesAte - 60_000;
  const conta = await criarConta('e');
  const vizinho = await criarConta('f', { pokemons: 2 });
  {
    ok(await recusa(() => escolherEquipe({ dbId: conta.id }, conta.pks.slice(0, 2), CAMPEONATO.id, aberto)) === 'camp.recusa.naoInscrito',
      'sem inscrição, recusa');
    await cdb.inscrever(CAMPEONATO.id, conta.id);
    ok(await recusa(() => escolherEquipe({ dbId: conta.id }, [conta.pks[0], vizinho.pks[0]], CAMPEONATO.id, aberto)) === 'camp.recusa.equipeSumiu',
      'pokémon de outra conta é recusado');
    ok(await recusa(() => escolherEquipe({ dbId: conta.id }, conta.pks.slice(0, 6), CAMPEONATO.id, aberto)) === 'camp.recusa.equipeCheia',
      'seis pokémon são recusados');
    ok(await recusa(() => escolherEquipe({ dbId: conta.id }, conta.pks.slice(0, 2), CAMPEONATO.id, CAMPEONATO.equipeAte + 1)) === 'camp.recusa.equipeCongelada',
      'depois do prazo, recusa');
    // O DIA DE ANÁLISE: inscrições fechadas, equipe ainda aberta. É a janela inteira num teste.
    ok(await escolherEquipe({ dbId: conta.id }, conta.pks.slice(0, 2), CAMPEONATO.id, CAMPEONATO.inscricoesAte + 1),
      'com as inscrições já fechadas, a equipe ainda troca (dia de análise)');
    const { ids } = await escolherEquipe({ dbId: conta.id }, [conta.pks[2], conta.pks[2], String(conta.pks[1]), 0, -1, 'x', [conta.pks[3]]], CAMPEONATO.id, aberto);
    ok(JSON.stringify(ids) === JSON.stringify([conta.pks[2], conta.pks[1]]), 'repetição e lixo saem; a ordem fica', JSON.stringify(ids));
    const info = await infoCampeonato({ dbId: conta.id, nivel: 320 }, CAMPEONATO.id, aberto);
    ok(info.eu.equipe?.fonte === 'campeonato' && JSON.stringify(info.eu.equipe.ids) === JSON.stringify(ids),
      'a tela recebe a equipe escolhida', JSON.stringify(info.eu.equipe));
    await pvpdb.salvarTime(conta.id, [conta.pks[5]]);
    ok(JSON.stringify((await escolherEquipe({ dbId: conta.id }, [], CAMPEONATO.id, aberto)).ids) === '[]', 'lista vazia é aceita');
    const info2 = await infoCampeonato({ dbId: conta.id, nivel: 320 }, CAMPEONATO.id, aberto);
    ok(info2.eu.equipe?.fonte === 'pvp' && JSON.stringify(info2.eu.equipe.ids) === JSON.stringify([conta.pks[5]]),
      'e volta a valer a equipe do PvP', JSON.stringify(info2.eu.equipe));
    await pvpdb.salvarTime(conta.id, []);
    const info3 = await infoCampeonato({ dbId: conta.id, nivel: 320 }, CAMPEONATO.id, aberto);
    ok(info3.eu.equipe?.fonte === null && info3.eu.equipe.ids.length === 0, 'sem nenhuma das duas, a tela sabe que não há equipe');
    await cdb.cancelar(CAMPEONATO.id, conta.id);
  }

  // --------------------------------------------------------------------------------------------
  secao('O socket');
  {
    const c = { ws: new WebSocket(URL), eventos: [], camp: [] };
    await new Promise((resolve, reject) => {
      c.ws.on('open', async () => c.ws.send(JSON.stringify(helloCom(await sessaoDe(conta.nick)))));
      c.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.t === 'welcome') resolve();
        if (m.t === 'campeonato') c.camp.push(m);
      });
      c.ws.on('error', reject);
    });
    const enviar = (o) => c.ws.send(JSON.stringify(o));
    const esperar = async (cond, ms = 6000) => {
      const fim = Date.now() + ms;
      while (Date.now() < fim) {
        const achado = c.camp.find(cond);
        if (achado) return achado;
        await dormir(100);
      }
      return null;
    };

    enviar({ t: 'campeonato.equipe', pokemonIds: conta.pks.slice(0, 2) });
    const r0 = await esperar((m) => m.recusa);
    ok(r0?.recusa === 'camp.recusa.naoInscrito', 'sem inscrição, o socket recusa', JSON.stringify(r0));

    c.camp.length = 0;
    enviar({ t: 'campeonato.inscrever' });
    ok(!!(await esperar((m) => m.acao === 'inscreveu')), 'a conta se inscreve pelo socket');

    c.camp.length = 0;
    const escolha = [conta.pks[4], conta.pks[0], conta.pks[6]];
    enviar({ t: 'campeonato.equipe', pokemonIds: escolha });
    const r1 = await esperar((m) => m.acao === 'equipe' || m.recusa);
    ok(r1?.acao === 'equipe', 'a equipe é salva', JSON.stringify(r1?.recusa ?? ''));
    ok(r1?.eu?.equipe?.fonte === 'campeonato' && JSON.stringify(r1.eu.equipe.ids) === JSON.stringify(escolha),
      'e a resposta já traz a equipe nova', JSON.stringify(r1?.eu?.equipe));
    ok(JSON.stringify(await cdb.equipeEscolhida(CAMPEONATO.id, conta.id)) === JSON.stringify(escolha), 'e ela está no banco');

    c.camp.length = 0;
    enviar({ t: 'campeonato.equipe', pokemonIds: [conta.pks[0], vizinho.pks[1]] });
    const r2 = await esperar((m) => m.recusa);
    ok(r2?.recusa === 'camp.recusa.equipeSumiu', 'pokémon de outra conta: recusado', JSON.stringify(r2));
    ok(JSON.stringify(await cdb.equipeEscolhida(CAMPEONATO.id, conta.id)) === JSON.stringify(escolha),
      'e a escolha anterior fica como estava');

    c.camp.length = 0;
    enviar({ t: 'campeonato.equipe', pokemonIds: 'tudo' });
    const r3 = await esperar((m) => m.acao === 'equipePvp' || m.recusa);
    ok(r3?.acao === 'equipePvp', 'lixo no lugar da lista vale como "usar a do PvP"', JSON.stringify(r3?.recusa ?? r3?.acao));
    ok(await cdb.equipeEscolhida(CAMPEONATO.id, conta.id) === null, 'e a escolha foi apagada');

    const { rows: audit } = await pool.query(
      `SELECT acao, detalhe FROM player_gameplay_log WHERE player_id = $1 AND categoria = 'campeonato' ORDER BY id`,
      [conta.id],
    );
    ok(audit.filter((a) => a.acao === 'equipe').length === 2, 'a auditoria registra as duas trocas',
      JSON.stringify(audit.map((a) => a.acao)));
    ok(audit.some((a) => a.acao === 'equipe' && /Charmander|Gengar/.test(a.detalhe)), 'com os nomes dos pokémon',
      audit.map((a) => a.detalhe).join(' | '));

    c.camp.length = 0;
    enviar({ t: 'campeonato.cancelar' });
    await esperar((m) => m.acao === 'cancelou');
    ok(await cdb.equipeEscolhida(CAMPEONATO.id, conta.id) === null, 'sair do campeonato leva a escolha junto');
    c.ws.close();
  }
} catch (err) {
  falhas++;
  console.log(`  ✗ o roteiro quebrou: ${err.stack ?? err.message}`);
} finally {
  await dormir(300);
  await limpar();
  await pool.end().catch(() => {});
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
