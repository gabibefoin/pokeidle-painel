// O +25% do líder de ginásio: ONDE ele entra, e onde ele NÃO pode entrar.
//
// A pergunta que este arquivo responde é: "o dano está mesmo indo só para hunt e boss —
// e só para o tipo do ginásio que o cara lidera?"
//
// São três provas, porque nenhuma sozinha responde:
//
//   1. ESTRUTURAL — só o ataque do jogador na HUNT passa pelo multiplicador antes de o dano
//      tocar o HP; arena, guerra e selvagem não passam.
//   2. DE MAPA — com um líder de verdade gravado no banco, `multDoGolpe` devolve 1,25 para o
//      tipo liderado e 1 para todos os outros.
//   3. DE BATALHA — arena e guerra não carregam o bônus no código.
//
// Hunt, PESCA e BOSS são o MESMO ponto de código (o ataque do jogador em `processar`).
//
//   docker compose up -d && node tools/teste-ginasios-dano.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from '../src/server/db.mjs';
import { especies, xpTotalParaNivel } from '../src/server/content.mjs';
import * as gindb from '../src/server/ginasios-db.mjs';
import { multDoGolpe, recarregarLideres, tiposLiderados } from '../src/server/game/ginasios.mjs';
import { GINASIO_BUFF_MULT, multBuffGinasio } from '../src/shared/ginasios.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

// ------------------------------------------------- 1. todos os pontos de dano

secao('Onde o dano é calculado (estrutural)');
{
  /** Cada `calcularDano(` de um arquivo, com as linhas que vêm logo depois. */
  function pontosDeDano(rel) {
    const linhas = readFileSync(join(raiz, rel), 'utf8').split('\n');
    const achados = [];
    for (let i = 0; i < linhas.length; i++) {
      if (!/\bcalcularDano\(/.test(linhas[i])) continue;
      if (/^\s*(\*|\/\/)/.test(linhas[i])) continue; // comentário citando a função
      if (/export function calcularDano/.test(linhas[i])) continue; // a definição
      achados.push({ rel, linha: i + 1, depois: linhas.slice(i, i + 22).join('\n') });
    }
    return achados;
  }

  const pontos = [
    ...pontosDeDano('src/server/sim.mjs'),
    ...pontosDeDano('src/server/game/pvp.mjs'),
    ...pontosDeDano('src/server/game/guild-pvp-sim.mjs'),
  ];
  ok(pontos.length === 4, 'existem exatamente 4 pontos de dano no jogo', `achei ${pontos.length}`);

  const temBuff = (p) => /r\.dano\s*=\s*Math\.round\(\s*r\.dano\s*\*\s*(multDoGolpe|multBuffGinasio)\(/.test(p.depois);
  const ehDoSelvagem = (p) => /p\.boss\.penalidade\.mult/.test(p.depois);

  const doJogador = pontos.filter((p) => !ehDoSelvagem(p));
  const doSelvagem = pontos.filter(ehDoSelvagem);
  ok(doJogador.length === 3, 'três são do lado do JOGADOR (hunt/boss, arena, guerra)', `${doJogador.length}`);
  ok(doSelvagem.length === 1, 'um é do lado do SELVAGEM/boss batendo de volta', `${doSelvagem.length}`);

  const comBuff = doJogador.filter(temBuff);
  const semBuff = doJogador.filter((p) => !temBuff(p));
  ok(comBuff.length === 1 && comBuff[0].rel === 'src/server/sim.mjs', 'só a HUNT multiplica pelo bônus de ginásio');
  ok(
    semBuff.length === 2,
    'arena e guerra NÃO multiplicam pelo bônus',
    semBuff.map((p) => `${p.rel}:${p.linha}`).join(', '),
  );
  ok(
    doSelvagem.every((p) => !temBuff(p)),
    'e o dano que o selvagem/boss aplica NÃO leva bônus nenhum',
  );

  const doSim = pontos.find((p) => p.rel === 'src/server/sim.mjs' && !ehDoSelvagem(p));
  ok(
    /p\.boss\s*\?\s*\[s\]\s*:\s*alvosDoGolpe\(/.test(doSim?.depois ?? '')
      || /const alvos = p\.boss/.test(readFileSync(join(raiz, 'src/server/sim.mjs'), 'utf8')),
    'hunt e BOSS saem do mesmo ponto (o mesmo golpe, alvo diferente)',
  );
}

// ------------------------------------------------------- 2. o mapa de líderes

secao('O mapa de títulos (contra o banco)');
const criados = [];
const IVS = { hp: 24, atk: 24, def: 24, spAtk: 24, spDef: 24, speed: 24 };
const espDe = (nome) => [...especies.values()].find((e) => e.name.toLowerCase() === nome.toLowerCase());

async function jogadorComTime(sufixo, tipo, nomes) {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level, xp) VALUES ($1, 150, $2) RETURNING id`,
    [`_gin_dano_${sufixo}_${Date.now().toString(36).slice(-4)}`, xpTotalParaNivel(150)],
  );
  const id = Number(rows[0].id);
  criados.push(id);
  const ids = [];
  for (const nome of nomes) {
    const esp = espDe(nome);
    const { rows: pk } = await pool.query(
      `INSERT INTO player_pokemon (player_id, species_id, level, quality, ivs, hp, shiny, potencia)
       VALUES ($1,$2,150,1.4,$3::jsonb,9999,false,3) RETURNING id`,
      [id, esp.pokeId, JSON.stringify(IVS)]);
    ids.push(Number(pk[0].id));
  }
  await gindb.salvarTime(id, tipo, ids);
  return id;
}

try {
  await gindb.migrar();
  const lider = await jogadorComTime('lider', 'FIRE', ['Charizard', 'Arcanine', 'Ninetales']);
  const outro = await jogadorComTime('outro', 'FIRE', ['Rapidash', 'Magmar']);
  await gindb.gravarLideres(await gindb.todosOsTimes());
  await recarregarLideres();

  ok([...(tiposLiderados(lider) ?? [])].includes('FIRE'), 'quem tem o time mais forte lidera FIRE');
  ok(multDoGolpe(lider, ['FIRE']) === GINASIO_BUFF_MULT, 'o líder bate +25% com pokémon de FIRE');
  ok(multDoGolpe(lider, ['FIRE', 'FLYING']) === GINASIO_BUFF_MULT, 'e com tipo duplo que inclui FIRE');
  ok(multDoGolpe(lider, ['WATER']) === 1, 'mas NÃO com pokémon de outro tipo');
  ok(multDoGolpe(lider, ['GRASS', 'POISON']) === 1, 'nem com tipo duplo que não inclui FIRE');
  ok(multDoGolpe(outro, ['FIRE']) === 1, 'o SEGUNDO colocado não leva bônus nenhum');
  ok(multDoGolpe(999999999, ['FIRE']) === 1, 'e quem não está no pódio também não');

  const meus = [...(tiposLiderados(lider) ?? [])];
  ok(meus.length === 1 && meus[0] === 'FIRE', 'time de Charizard em FIRE não dá o título de FLYING', meus.join(','));
  ok(multDoGolpe(lider, ['FLYING']) === 1, 'e o Charizard dele não bate +25% como FLYING');
  const donos = (await gindb.lideres()).filter((l) => l.playerId != null);
  ok(
    donos.filter((l) => l.playerId === lider).every((l) => l.tipo === 'FIRE'),
    'e ele não aparece como líder de nenhum outro ginásio',
  );

  // ---------------------------------------------------- 3. arena e guerra ficam limpas

  secao('Arena e Guerra não carregam o bônus');
  {
    const pvp = readFileSync(join(raiz, 'src/server/game/pvp.mjs'), 'utf8');
    const guerra = readFileSync(join(raiz, 'src/server/game/guild-pvp-sim.mjs'), 'utf8');
    const guildPvp = readFileSync(join(raiz, 'src/server/game/guild-pvp.mjs'), 'utf8');
    ok(!/multDoGolpe\(/.test(pvp), 'a Arena PvP não chama multDoGolpe');
    ok(!/multBuffGinasio\(/.test(guerra), 'a simulação da Guerra não chama multBuffGinasio');
    ok(!/bonusTipos/.test(guildPvp), 'a montagem da guerra não passa títulos de ginásio');
    ok(
      multBuffGinasio(['FIRE'], new Set(['WATER'])) === 1,
      'multBuffGinasio continua neutro quando o título não bate com o tipo',
    );
  }
} finally {
  if (criados.length) {
    await pool.query(`DELETE FROM ginasio_times WHERE player_id = ANY($1::bigint[])`, [criados]).catch(() => {});
    await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [criados]).catch(() => {});
  }
  await gindb.gravarLideres(await gindb.todosOsTimes()).catch(() => {});
  await pool.end().catch(() => {});
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
