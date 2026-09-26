// Os Ginásios contra o Postgres de verdade — o teste que `teste-ginasios.mjs` não pode fazer.
//
// O outro teste cobre as REGRAS (cap, espécie única, buff) com objetos em memória. Este cobre
// o que só quebra no banco: o `WITH ORDINALITY` que preserva a ordem escolhida, o
// `jsonb_to_recordset` que grava os 18 líderes de uma vez, o `desde` que só reinicia quando o
// dono muda, e o pokémon que sai da conta por ter ido para o Mercado.
//
// Cria os próprios jogadores (nick `_gin_teste_*`) e APAGA tudo no fim, inclusive as linhas de
// `ginasio_lideres` que a apuração tiver escrito. Precisa do Postgres de pé:
//
//   docker compose up -d && node tools/teste-ginasios-db.mjs

import { pool } from '../src/server/db.mjs';
import { especies } from '../src/server/content.mjs';
import * as gindb from '../src/server/ginasios-db.mjs';
import { TIPOS_GINASIO } from '../src/shared/ginasios.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const IVS = { hp: 24, atk: 24, def: 24, spAtk: 24, spDef: 24, speed: 24 };
const PREFIXO = `_gin_teste_${Date.now().toString(36)}`;
const criados = [];

const espPorNome = (nome) =>
  [...especies.values()].find((e) => e.name.toLowerCase() === nome.toLowerCase());

async function criarJogador(sufixo, nivel = 200) {
  const { rows } = await pool.query(
    `INSERT INTO players (nick, level) VALUES ($1, $2) RETURNING id`,
    [`${PREFIXO}_${sufixo}`, nivel],
  );
  const id = Number(rows[0].id);
  criados.push(id);
  return id;
}

async function darPokemon(playerId, nomeEspecie, nivel, extra = {}) {
  const esp = espPorNome(nomeEspecie);
  if (!esp) throw new Error(`espécie desconhecida: ${nomeEspecie}`);
  const { rows } = await pool.query(
    `INSERT INTO player_pokemon (player_id, species_id, level, quality, ivs, hp, shiny, potencia)
     VALUES ($1, $2, $3, $4, $5::jsonb, 100, $6, $7) RETURNING id`,
    [playerId, esp.pokeId, nivel, extra.quality ?? 1.2, JSON.stringify(IVS), !!extra.shiny, extra.potencia ?? 1],
  );
  return Number(rows[0].id);
}

async function limpar() {
  if (criados.length) {
    await pool.query(`DELETE FROM players WHERE id = ANY($1::bigint[])`, [criados]);
  }
  // A apuração escreveu as 18 linhas com os jogadores de teste no topo. Reapura com o banco
  // já limpo para a tabela não ficar apontando para ids apagados.
  await gindb.gravarLideres(await gindb.todosOsTimes());
}

try {
  console.log('Ginásios — contra o Postgres\n===========================');
  await gindb.migrar();

  const ana = await criarJogador('ana');
  const bia = await criarJogador('bia');

  secao('Gravar e ler um time');
  {
    const zard = await darPokemon(ana, 'Charizard', 300);
    const arcanine = await darPokemon(ana, 'Arcanine', 150);
    const ninetales = await darPokemon(ana, 'Ninetales', 90);

    // Ordem de propósito diferente da ordem de id: é ela que tem de voltar do banco.
    const salvo = await gindb.salvarTime(ana, 'FIRE', [ninetales, zard, arcanine]);
    ok(salvo.tipo === 'FIRE' && salvo.pokemonIds.length === 3, 'salvou os três');

    const meus = await gindb.timesDoJogador(ana);
    ok(!!meus.FIRE, 'o time volta na leitura do jogador');
    ok(
      meus.FIRE.pokemonIds.join(',') === [ninetales, zard, arcanine].join(','),
      'a ORDEM escolhida sobrevive ao banco (WITH ORDINALITY)',
      meus.FIRE.pokemonIds.join(','),
    );
    ok(meus.FIRE.poder > 0, `a força do time é calculada na leitura (⚔ ${meus.FIRE.poder})`);

    // O Charizard nv 300 conta como 300: o ginásio não tem teto de nível (o de 150 ficou só
    // na Guerra de Guilds). A leitura do banco tem de refletir isso, e não uma força capada.
    const soZard = await gindb.salvarTime(ana, 'FLYING', [zard]);
    ok(soZard.pokemonIds.length === 1, 'o MESMO Charizard entra também no ginásio de FLYING');
    const comFlying = await gindb.timesDoJogador(ana);
    const poderZard = comFlying.FLYING.poder;
    await gindb.salvarTime(bia, 'FLYING', [await darPokemon(bia, 'Charizard', 150)]);
    const dela = await gindb.timesDoJogador(bia);
    ok(
      poderZard > dela.FLYING.poder,
      'o nv 300 dela vale MAIS que o nv 150 dele (sem teto)',
      `${poderZard} × ${dela.FLYING.poder}`,
    );
  }

  secao('As recusas passam pelo banco');
  {
    const zard2 = await darPokemon(bia, 'Charizard', 150, { shiny: true });
    const meuZard = (await gindb.timesDoJogador(bia)).FLYING.pokemonIds[0];
    let erro = null;
    try {
      await gindb.salvarTime(bia, 'FLYING', [meuZard, zard2]);
    } catch (e) {
      erro = e;
    }
    ok(erro?.codigo === 'especie', 'dois Charizards (um shiny) no mesmo ginásio: recusado', erro?.message);

    erro = null;
    try {
      await gindb.salvarTime(bia, 'WATER', [meuZard]);
    } catch (e) {
      erro = e;
    }
    ok(erro?.codigo === 'tipo', 'Charizard no ginásio de WATER: recusado', erro?.message);

    erro = null;
    try {
      // Pokémon da Ana, mandado pela Bia — o caso que um cliente adulterado tentaria.
      const daAna = (await gindb.timesDoJogador(ana)).FIRE.pokemonIds[0];
      await gindb.salvarTime(bia, 'FIRE', [daAna]);
    } catch (e) {
      erro = e;
    }
    ok(erro?.codigo === 'pokemon', 'pokémon de OUTRO jogador: recusado', erro?.message);
  }

  secao('O pódio');
  {
    // A Bia monta um time de fogo mais forte que o da Ana e toma o ginásio.
    await gindb.salvarTime(bia, 'FIRE', [
      await darPokemon(bia, 'Charizard', 150, { quality: 1.8, potencia: 5 }),
      await darPokemon(bia, 'Arcanine', 150, { quality: 1.8, potencia: 5 }),
      await darPokemon(bia, 'Ninetales', 150, { quality: 1.8, potencia: 5 }),
    ]);
    // O pódio é do SERVIDOR, e um servidor em uso tem times de jogadores de verdade nele.
    // O teste afirma coisas sobre as DUAS contas que ele criou — nunca sobre o tamanho da
    // tabela, que não é dele.
    const podio = await gindb.rankingDoGinasio('FIRE');
    const meus = podio.filter((l) => l.nick.startsWith(PREFIXO));
    ok(meus.length === 2, 'os dois times de teste aparecem no pódio', `${meus.length} de ${podio.length}`);
    ok(meus[0].playerId === bia, 'a Bia, com o time melhor, vem antes da Ana');
    ok(meus[0].poder > meus[1].poder, 'e com força maior', `${meus[0].poder} × ${meus[1].poder}`);
    ok(podio.every((l) => typeof l.nick === 'string' && l.nick.length > 0), 'toda linha do pódio traz o nick do dono');
    ok(
      podio.every((l, i) => i === 0 || podio[i - 1].poder >= l.poder),
      'e o pódio inteiro está ordenado da maior força para a menor',
    );
  }

  secao('Os líderes gravados');
  {
    // Garante cenário limpo neste ginásio — num banco de dev com líder real, o título é sticky.
    await pool.query(
      `UPDATE ginasio_lideres SET player_id = NULL, poder = 0 WHERE tipo = 'FIRE'`,
    );
    await gindb.gravarLideres(await gindb.todosOsTimes());
    const linhas = await gindb.lideres();
    ok(linhas.length === TIPOS_GINASIO.length, 'as 18 linhas existem', `${linhas.length}`);
    const fogo = linhas.find((l) => l.tipo === 'FIRE');
    const topoTeste = (await gindb.rankingDoGinasio('FIRE')).find((l) => l.nick.startsWith(PREFIXO));
    ok(fogo?.playerId === topoTeste?.playerId, 'sem titular anterior, o topo do pódio vira líder');
    ok(fogo?.poder > 0, 'com o poder do time gravado junto');
    const porTipo = await gindb.todosOsTimes();
    const tipoVazio = TIPOS_GINASIO.find((tipo) => !(porTipo.get(tipo)?.length));
    if (tipoVazio) {
      const vazio = linhas.find((l) => l.tipo === tipoVazio);
      ok(vazio && vazio.playerId === null, 'ginásio sem ninguém fica com líder nulo');
    }

    const desdeAntes = fogo.desde;
    await gindb.gravarLideres(await gindb.todosOsTimes());
    const dePois = (await gindb.lideres()).find((l) => l.tipo === 'FIRE');
    ok(
      new Date(dePois.desde).getTime() === new Date(desdeAntes).getTime(),
      'reapurar sem troca de dono NÃO reinicia o "líder desde"',
    );

    // Ter ⚔ maior no pódio NÃO rouba o título — só o desafio ou abandonar o time.
    const carol = await criarJogador('carol');
    await gindb.salvarTime(carol, 'FIRE', [
      await darPokemon(carol, 'Charizard', 150, { quality: 2, potencia: 5 }),
      await darPokemon(carol, 'Arcanine', 150, { quality: 2, potencia: 5 }),
      await darPokemon(carol, 'Ninetales', 150, { quality: 2, potencia: 5 }),
    ]);
    await gindb.gravarLideres(await gindb.todosOsTimes());
    const podioFogo = await gindb.rankingDoGinasio('FIRE');
    const carolNoTopo = podioFogo.find((l) => l.playerId === carol);
    const biaAindaLider = (await gindb.lideres()).find((l) => l.tipo === 'FIRE');
    ok(carolNoTopo && podioFogo[0].playerId === carol, 'Carol passa a Bia no ⚔ do pódio');
    ok(biaAindaLider?.playerId === bia, 'mas a Bia segue titular até alguém vencê-la');

    await gindb.transferirLiderancaPorDesafio('FIRE', carol, carolNoTopo.poder);
    const depoisDesafio = (await gindb.lideres()).find((l) => l.tipo === 'FIRE');
    ok(depoisDesafio?.playerId === carol, 'vitória no desafio transfere o título na hora');
    ok(
      new Date(depoisDesafio.desde).getTime() > new Date(desdeAntes).getTime(),
      'e reinicia o "líder desde"',
    );

    await gindb.registrarCooldownDesafio(carol, 'FIRE');
    const cdFogo = await gindb.msAteProximoDesafio(carol, 'FIRE');
    const cdAgua = await gindb.msAteProximoDesafio(carol, 'WATER');
    ok(cdFogo > 23 * 3_600_000, 'cooldown de 24 h vale para ESTE ginásio', `${Math.round(cdFogo / 3_600_000)} h`);
    ok(cdAgua === 0, 'outro ginásio não herda o cooldown');

    // Largar o time tira do pódio. A asserção é sobre A BIA e a ANA — nunca sobre quem está
    // no topo global, que num servidor em uso é um jogador de verdade. E o teste NUNCA
    // escreve num jogador que não seja dele: `salvarTime` aqui só recebe `bia`.
    const antes = await gindb.rankingDoGinasio('FIRE');
    const posAna = antes.findIndex((l) => l.playerId === ana);
    ok(antes.some((l) => l.playerId === bia), 'a Bia estava no pódio antes de largar');

    await gindb.salvarTime(bia, 'FIRE', []);
    const depois = await gindb.rankingDoGinasio('FIRE');
    ok(!depois.some((l) => l.playerId === bia), 'largar o time tira o jogador do pódio');
    ok(
      depois.findIndex((l) => l.playerId === ana) === posAna - 1,
      'e quem estava atrás dela sobe uma posição',
      `${depois.findIndex((l) => l.playerId === ana)} × ${posAna - 1}`,
    );
  }

  secao('O dono do pokémon, conferido na LEITURA');
  {
    // A leitura passou a buscar os pokémon por CHAVE PRIMÁRIA e a conferir o dono em JS (ver
    // `montarTimes`). Antes quem garantia isso era o `pp.player_id = gt.player_id` do SQL.
    // Este teste é o que impede a troca de ter aberto um buraco: um id de OUTRO jogador
    // gravado à força no time não pode aparecer no pódio nem contar força.
    // Um pokémon da Bia direto da coleção: a esta altura ela já largou o time de FIRE, então
    // ler o id pelo time devolveria `undefined`.
    const { rows: dela } = await pool.query(
      `SELECT id FROM player_pokemon WHERE player_id = $1 LIMIT 1`, [bia],
    );
    const daBia = Number(dela[0].id);
    const antes = (await gindb.timesDoJogador(ana)).FIRE;
    // Escreve direto na tabela, sem passar por `salvarTime` — é o que um bug ou uma mão
    // errada no banco fariam, e a leitura tem de aguentar.
    await pool.query(
      `UPDATE ginasio_times SET pokemon_ids = pokemon_ids || to_jsonb($2::bigint)
        WHERE player_id = $1 AND tipo = 'FIRE'`,
      [ana, daBia],
    );
    const depois = (await gindb.timesDoJogador(ana)).FIRE;
    ok(
      !depois.pokemonIds.includes(daBia),
      'pokémon de outro jogador enfiado no time NÃO aparece na leitura',
      depois.pokemonIds.join(','),
    );
    ok(depois.poder === antes.poder, 'e não soma força nenhuma', `${depois.poder} × ${antes.poder}`);

    const podio = await gindb.rankingDoGinasio('FIRE');
    const linhaAna = podio.find((l) => l.playerId === ana);
    ok(
      !linhaAna.pokemons.some((pk) => pk.id === daBia),
      'nem entra no time dela no pódio',
    );
  }

  secao('Time que envelheceu no banco');
  {
    const meus = await gindb.timesDoJogador(ana);
    const ids = meus.FIRE.pokemonIds;
    // Um dos três vai para o Mercado: some da conta sem invalidar o resto do time.
    await pool.query(`UPDATE player_pokemon SET anuncio_id = 999999999 WHERE id = $1`, [ids[0]]);
    const depois = await gindb.timesDoJogador(ana);
    ok(
      depois.FIRE.pokemonIds.length === ids.length - 1,
      'pokémon anunciado no Mercado sai do time',
      `${depois.FIRE.pokemonIds.length} de ${ids.length}`,
    );
    ok(depois.FIRE.poder < meus.FIRE.poder, 'e a força do time cai junto');
    await pool.query(`UPDATE player_pokemon SET anuncio_id = NULL WHERE id = $1`, [ids[0]]);
    const devolta = await gindb.timesDoJogador(ana);
    ok(devolta.FIRE.pokemonIds.length === ids.length, 'cancelar o anúncio devolve o pokémon ao time');
  }
} finally {
  await limpar();
  await pool.end();
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
