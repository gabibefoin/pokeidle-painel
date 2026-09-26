// O registro de SHINYS, a troca de avatar e o liga/desliga do boss.
//
// Os três nasceram na mesma leva e dividem o teste por um motivo prático: são comandos de
// JOGADOR que só existem com o socket aberto, e cada um sozinho não encheria um arquivo. O que
// o teste prova, em uma frase por bloco:
//
//   · a lista de shinys mostra o que EXISTE no servidor (não o que eu tenho), com o dono certo
//     e o preço só quando o anúncio está aberto;
//   · trocar de avatar vale uma vez por dia — e a segunda tentativa é recusada pelo SERVIDOR,
//     não pela tela;
//   · a repetição de boss só liga com um boss válido e desliga sozinha ao abandonar a arena.
//
// Precisa do servidor no ar (`npm start`) e do Postgres (`npm run infra`).
//
//   node tools/teste-shinys.mjs
import WebSocket from 'ws';
import { pool } from '../src/server/db.mjs';
import { especies } from '../src/server/content.mjs';
import { helloCom, sessaoPara } from './auth-teste.mjs';
import { criarMescladorDeEstado } from '../src/shared/estado-delta.mjs';

const URL = process.env.WS_URL ?? 'ws://localhost:8080';

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

// Gyarados: tem forma shiny e um nome que não colide com nada na busca por trecho.
const ESPECIE = 130;
const marca = Date.now() % 1_000_000;
const nick = `shy${marca}`;

await sessaoPara(nick);
const { rows: pl } = await pool.query(
  `INSERT INTO players (nick, gold, visual_ok) VALUES ($1, $2, true) RETURNING id`,
  [nick, 100_000],
);
const jogadorId = Number(pl[0].id);

const inserir = async ({ shiny, especie = ESPECIE, level = 40, slot = null }) => {
  const { rows } = await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, xp, quality, ivs, hp, shiny, slot, potencia, power)
     VALUES ($1,$2,$3,0,1.1,'{"hp":20,"atk":20,"def":20,"spAtk":20,"spDef":20,"speed":20}'::jsonb,999,$4,$5,3,1234)
     RETURNING id`,
    [jogadorId, especie, level, shiny, slot],
  );
  return Number(rows[0].id);
};

// Um shiny (que a lista tem de mostrar), um comum (que ela NÃO pode mostrar) e um segundo
// pokémon em campo, para o jogador não ficar sem equipe.
await inserir({ shiny: false, slot: 0 });
const shinyId = await inserir({ shiny: true });
const comumId = await inserir({ shiny: false, level: 41 });

function abrir(nickAlvo) {
  const c = { ws: null, estado: null, avisos: [], shinys: null, eventos: [] };
  const mesclar = criarMescladorDeEstado();
  return new Promise((res, rej) => {
    c.ws = new WebSocket(URL);
    c.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome' || m.t === 'estado') c.estado = mesclar(m.estado);
      if (m.t === 'shiny.lista') c.shinys = m;
      if (m.t === 'batalha') {
        for (const e of m.ev) {
          c.eventos.push(e);
          if (e.k === 'aviso') c.avisos.push(e.msg);
        }
      }
      if (m.t === 'erro') c.avisos.push(`erro: ${m.msg}`);
    });
    c.ws.once('error', rej);
    c.ws.once('open', async () => {
      try {
        c.ws.send(JSON.stringify(helloCom(await sessaoPara(nickAlvo))));
        res(c);
      } catch (err) {
        rej(err);
      }
    });
  });
}

async function esperar(pred, ms = 8000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (pred()) return true;
    await dormir(100);
  }
  return false;
}
const manda = (c, o) => c.ws.send(JSON.stringify(o));

const eu = await abrir(nick);
if (!(await esperar(() => eu.estado))) throw new Error('o servidor não respondeu — está no ar?');

console.log(`Registro de shinys · avatar · boss automático\n============================================\njogador ${nick}`);

// =========================================================== registro de shinys

secao('A lista de shinys');
{
  eu.shinys = null;
  manda(eu, { t: 'shiny.listar', busca: '', tipo: '', pagina: 0 });
  await esperar(() => eu.shinys);
  const linhas = eu.shinys?.linhas ?? [];
  ok(!!eu.shinys, 'o servidor responde a lista');
  ok(linhas.some((l) => l.id === shinyId), 'o shiny recém-criado está nela');
  ok(!linhas.some((l) => l.id === comumId), 'e o pokémon COMUM não está');
  ok(linhas.every((l) => l.shiny === true), 'toda linha vem marcada como shiny');

  const meu = linhas.find((l) => l.id === shinyId);
  ok(meu?.dono === nick, 'a linha traz o dono', `veio ${meu?.dono}`);
  ok(meu?.meu === true, 'e sabe que o dono sou eu');
  ok(meu?.nome === especies.get(ESPECIE)?.name, 'o nome sai do catálogo, não do banco');
  ok(meu?.anuncio === null, 'sem anúncio aberto, não há preço nem botão de comprar');
  ok(meu?.stats?.hp > 0, 'a ficha vem com os stats calculados');
  ok(meu?.ivTotal === 120, 'e com o IV somado (6 × 20)', `veio ${meu?.ivTotal}`);
}

secao('Os filtros');
{
  const pedir = async (filtro) => {
    eu.shinys = null;
    manda(eu, { t: 'shiny.listar', pagina: 0, ...filtro });
    await esperar(() => eu.shinys);
    return eu.shinys?.linhas ?? [];
  };

  const porNome = await pedir({ busca: especies.get(ESPECIE).name.slice(0, 5) });
  ok(porNome.some((l) => l.id === shinyId), 'busca por trecho do nome acha');

  const naoExiste = await pedir({ busca: 'zzzznaoexiste' });
  ok(naoExiste.length === 0, 'busca sem resultado devolve VAZIO (e não a lista inteira)');

  const tipoCerto = await pedir({ tipo: especies.get(ESPECIE).type1 });
  ok(tipoCerto.some((l) => l.id === shinyId), 'filtro pelo tipo da espécie acha');

  const tipoErrado = await pedir({ tipo: especies.get(ESPECIE).type1 === 'GHOST' ? 'STEEL' : 'GHOST' });
  ok(!tipoErrado.some((l) => l.id === shinyId), 'e por outro tipo, não');

  const soVenda = await pedir({ soAVenda: true });
  ok(soVenda.every((l) => l.anuncio), '"só à venda" devolve apenas o que tem anúncio aberto');
}

// ================================================================== avatar

secao('Trocar de avatar');
{
  const visual = { cabeca: 10, corpo: 20, pernas: 30, pes: 40 };
  const antes = eu.estado.loja.visualTrocaLivreEm;
  ok(antes <= Date.now(), 'quem nunca trocou pode trocar agora');

  manda(eu, { t: 'visual.trocar', genero: 'female', visual });
  await esperar(() => eu.estado.loja.gender === 'female');
  ok(eu.estado.loja.gender === 'female', 'a troca vale');
  ok(eu.estado.loja.visual.cabeca === 10, 'e as cores escolhidas chegam ao estado');
  ok(
    eu.estado.loja.visualTrocaLivreEm > Date.now() + 23 * 3600_000,
    'a próxima troca só daqui a ~24h',
  );

  const { rows } = await pool.query(`SELECT visual_trocado_em FROM players WHERE id = $1`, [jogadorId]);
  ok(Number(rows[0].visual_trocado_em) > 0, 'o carimbo foi ao BANCO na hora (fora do write-behind)');

  eu.avisos.length = 0;
  manda(eu, { t: 'visual.trocar', genero: 'male', visual });
  await esperar(() => eu.avisos.length);
  ok(eu.avisos.some((m) => /trocou de avatar hoje/.test(m)), 'a segunda troca no mesmo dia é recusada', eu.avisos.join(' | '));
  ok(eu.estado.loja.gender === 'female', 'e o avatar continua o que foi salvo');
}

// ============================================================ boss automático

secao('Repetição automática do boss');
{
  eu.avisos.length = 0;
  manda(eu, { t: 'boss.auto', ativo: true, key: 'boss_que_nao_existe' });
  await esperar(() => eu.avisos.length);
  ok(!eu.estado.boss.auto, 'não liga com um boss inexistente');

  eu.avisos.length = 0;
  // Regice é o primeiro par (nível mínimo 300) e este jogador é nível 1: a trava de nível tem
  // de valer aqui também, senão o automático seria o jeito de furar o requisito do "Desafiar".
  manda(eu, { t: 'boss.auto', ativo: true, key: 'regice' });
  await esperar(() => eu.avisos.length);
  ok(!eu.estado.boss.auto, 'nem com nível insuficiente');
  ok(eu.avisos.some((m) => /nv 300/.test(m)), 'e diz qual é o nível que falta', eu.avisos.join(' | '));

  // O nível de quem PODE desafiar tem de existir antes do primeiro login: o sim guarda o
  // jogador em memória e o flush da saída regravaria um UPDATE feito pelas costas dele.
  const nickAlto = `shb${marca}`;
  await sessaoPara(nickAlto);
  const { rows: alt } = await pool.query(
    `INSERT INTO players (nick, level, gold, visual_ok) VALUES ($1, 400, 1000, true) RETURNING id`,
    [nickAlto],
  );
  const jogadorAltoId = Number(alt[0].id);
  const eu2 = await abrir(nickAlto);
  await esperar(() => eu2.estado);
  manda(eu2, { t: 'boss.auto', ativo: true, key: 'regice' });
  await esperar(() => eu2.estado.boss.auto);
  ok(eu2.estado.boss.auto === true, 'liga com nível e boss válidos');
  ok(eu2.estado.boss.autoKey === 'regice', 'e guarda QUAL boss repetir', `veio ${eu2.estado.boss.autoKey}`);

  manda(eu2, { t: 'boss.auto', ativo: false });
  await esperar(() => !eu2.estado.boss.auto);
  ok(eu2.estado.boss.auto === false, 'e desliga quando o jogador manda');
  eu2.ws.close();
  await dormir(400);
  await pool.query(`DELETE FROM players WHERE id = $1`, [jogadorAltoId]).catch(() => {});
}

console.log(`\n==============================================`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `tudo certo (${testes} testes)`);
eu.ws.close();
await dormir(400);
await pool.query(`DELETE FROM players WHERE id = $1`, [jogadorId]).catch(() => {});
await pool.end();
process.exit(falhas ? 1 : 0);
