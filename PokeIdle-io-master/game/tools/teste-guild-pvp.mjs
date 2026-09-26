// Guerra de Guilds — sem banco e sem Redis.
//
// A guerra deixou de ser uma arena ao vivo: hoje ela roda inteira no servidor, uma vez por
// dia, a partir do retrato do banco (ver `src/server/game/guild-pvp-sim.mjs`). Como o
// simulador não conhece Postgres nem jogador conectado, o teste monta as guilds na mão e roda
// a batalha de verdade — inclusive o replay, que é conferido quadro a quadro.
//
//   node tools/teste-guild-pvp.mjs

import {
  simularGuerra,
  ordenarPorSemente,
  VERSAO_REPLAY,
  SLUG_ARENA,
  _testeAncorasDeGuild,
  _testeTilesAndaveisDaArena,
  _testeRecortarArena,
  _testeNascimentoPorChave,
  _testeSerpentinaDasChaves,
  _testeDistanciasAPe,
  LIMITE_MS_DUELO,
  LIMITE_MS_GUERRA,
} from '../src/server/game/guild-pvp-sim.mjs';
import { readFileSync } from 'node:fs';
import { _testePokemonDaLinha } from '../src/server/game/guild-pvp.mjs';
import { gpPorColocacao } from '../src/server/game/guild.mjs';
import { nivelNaGuerra } from '../src/shared/ginasios.mjs';
import { especies, calcularStats, hpDeCombate, multDeNascenca } from '../src/server/content.mjs';
import { gradeDaHunt, andavel } from '../src/server/game/campo.mjs';

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

function pokemonFalso(speciesId, nivel, qualidade = 1.2) {
  const esp = especies.get(speciesId);
  const stats = calcularStats(esp, IVS, nivel, qualidade, multDeNascenca(1, false));
  return {
    id: Math.floor(Math.random() * 1e9),
    speciesId,
    nome: esp.name,
    looktype: esp.looktype,
    lookShiny: null,
    tipos: [esp.type1, esp.type2].filter(Boolean),
    level: nivel,
    shiny: false,
    stats,
    maxHp: hpDeCombate(stats.hp),
    tmElemental: null,
  };
}

/** Uma guild com `n` membros, cada um com a mesma equipe. */
function guildFalsa(id, n, nivel, especiesDaEquipe) {
  return {
    id,
    nome: `Guild${id}`,
    brasao: { escudo: 'heater', emblema: 'star', bg: '#4a2c6e', pri: '#ffd166', sec: '#ffffff' },
    membros: Array.from({ length: n }, (_, i) => ({
      playerId: id * 1000 + i,
      nick: `G${id}m${i}`,
      looktype: 159,
      visual: [78, 69, 114, 114],
      equipe: especiesDaEquipe.map((s) => pokemonFalso(s, nivel)),
    })),
  };
}

const respirar = () => new Promise((r) => setImmediate(r));

console.log('GUERRA DE GUILDS (offline + replay)\n===================================');

secao('Uma guerra de sete guilds termina com um vencedor');
let guerra7;
{
  const guilds = Array.from({ length: 7 }, (_, i) => guildFalsa(i + 1, 5, 80 + i * 2, [6, 9, 3]));
  guerra7 = await simularGuerra(guilds, { aoRespirar: respirar });

  ok(guerra7.vencedorId != null, 'há um vencedor');
  ok(guerra7.colocacoes.size === 7, 'toda guild recebeu colocação', `${guerra7.colocacoes.size}`);

  const posicoes = [...guerra7.colocacoes.values()].sort((a, b) => a - b);
  ok(posicoes.join(',') === '1,2,3,4,5,6,7', 'as colocações são 1..N sem furo nem empate', posicoes.join(','));
  ok(guerra7.colocacoes.get(guerra7.vencedorId) === 1, 'o vencedor é o 1º colocado');
  ok(guerra7.duracaoMs > 0 && guerra7.duracaoMs <= LIMITE_MS_DUELO, 'a guerra cabe no teto de tempo');

  const gp = [...guerra7.colocacoes.values()].map((p) => gpPorColocacao(7, p)).sort((a, b) => b - a);
  ok(gp.join(',') === '7,6,5,4,3,2,1', 'o GP por colocação sai completo', gp.join(','));
}

secao('O replay descreve a mesma guerra');
{
  const rep = guerra7.replay;
  ok(rep.v === VERSAO_REPLAY, 'carrega a versão do formato');
  ok(rep.slug === SLUG_ARENA && rep.box?.length === 4, 'traz a arena e a caixa de tiles');
  ok(rep.atores.length === 70, 'um ator por pokémon e por treinador (7×5×2)', `${rep.atores.length}`);
  ok(rep.inicio.length === rep.atores.length * 3, 'todo ator nasce com posição', `${rep.inicio.length}`);
  ok(!rep.cheio, 'a gravação coube no limite de quadros');
  ok(rep.dur === guerra7.duracaoMs, 'a duração da fita é a da guerra');

  const slots = new Set(rep.atores.map((a) => a.s));
  ok(slots.size === rep.atores.length, 'nenhum slot repetido');

  const foraDoSlot = [];
  for (const q of rep.quadros) {
    for (let i = 0; q.p && i + 2 < q.p.length; i += 3) if (!slots.has(q.p[i])) foraDoSlot.push(q.p[i]);
    for (let i = 0; q.h && i + 1 < q.h.length; i += 2) if (!slots.has(q.h[i])) foraDoSlot.push(q.h[i]);
    for (const s of q.x ?? []) if (!slots.has(s)) foraDoSlot.push(s);
  }
  ok(!foraDoSlot.length, 'todo quadro fala de slots conhecidos', foraDoSlot.slice(0, 3).join(','));

  const tempos = rep.quadros.map((q) => q.t);
  ok(tempos.every((t, i) => i === 0 || t > tempos[i - 1]), 'os quadros estão em ordem de tempo');
  ok(tempos.at(-1) <= rep.dur, 'nenhum quadro passa do fim da fita');

  // Todo corpo que cai sai do mapa depois — senão o replay acumularia bonecos mortos.
  const caidos = rep.quadros.flatMap((q) => q.m ?? []);
  const removidos = new Set(rep.quadros.flatMap((q) => q.x ?? []));
  ok(caidos.length > 0, 'houve abates gravados', `${caidos.length}`);
  ok(caidos.every((s) => removidos.has(s)), 'todo caído acaba removido do mapa');

  const abates = rep.quadros.flatMap((q) => q.e ?? []).filter((e) => e.k === 'abate');
  ok(abates.length === guerra7.placar.reduce((s, g) => s + g.abates, 0), 'o feed bate com o placar');
  ok(abates.every((e) => e.p), 'cada abate traz o pokémon derrotado no feed');

  // O contrato que sustenta o formato compacto: um passo é sempre UMA tile a partir de onde a
  // entidade estava. É por isso que a gravação manda só o destino — o player deduz a origem e
  // a direção do próprio espelho. Se um passo pulasse tiles, a caminhada sairia deslizando.
  const onde = new Map();
  for (let i = 0; i + 2 < rep.inicio.length; i += 3) {
    onde.set(rep.inicio[i], [rep.inicio[i + 1], rep.inicio[i + 2]]);
  }
  const g = gradeDaHunt(rep.slug);
  let saltos = 0;
  let foraDoChao = 0;
  for (const q of rep.quadros) {
    for (let i = 0; q.p && i + 2 < q.p.length; i += 3) {
      const [slot, cx, cy] = [q.p[i], q.p[i + 1], q.p[i + 2]];
      const de = onde.get(slot);
      if (!de || Math.max(Math.abs(cx - de[0]), Math.abs(cy - de[1])) !== 1) saltos++;
      if (!andavel(g, cx, cy)) foraDoChao++;
      onde.set(slot, [cx, cy]);
    }
  }
  ok(!saltos, 'todo passo anda exatamente uma tile', `${saltos} saltos`);
  ok(!foraDoChao, 'ninguém pisa fora da área andável', `${foraDoChao} tiles`);

  const nascimentosForaDoChao = [];
  for (let i = 0; i + 2 < rep.inicio.length; i += 3) {
    if (!andavel(g, rep.inicio[i + 1], rep.inicio[i + 2])) nascimentosForaDoChao.push(rep.inicio[i]);
  }
  ok(!nascimentosForaDoChao.length, 'todo mundo nasce em chão andável', `${nascimentosForaDoChao.length}`);

  const kb = JSON.stringify(rep).length / 1024;
  ok(kb < 512, `a gravação é pequena (${kb.toFixed(1)} KB)`);
}

secao('Sem fogo amigo: uma guild sozinha nunca se machuca');
{
  const r = await simularGuerra([guildFalsa(1, 5, 90, [6, 9])], { aoRespirar: respirar });
  ok(r.placar[0].abates === 0, 'ninguém abate ninguém');
  ok(r.placar[0].mortes === 0, 'ninguém morre');
  ok(r.placar[0].membros.every((m) => m.sobreviveu), 'todos sobrevivem');
  ok(r.vencedorId === 1, 'a única guild leva o 1º lugar');
}

secao('Time inteiro: o reserva entra quando o titular cai');
{
  // Um lado com três pokémon fortes contra um lado de um pokémon fraco: o fraco cai, e o
  // vencedor termina a guerra sem nunca ter trocado.
  const forte = guildFalsa(1, 1, 95, [6, 9, 3]);
  const fraco = guildFalsa(2, 1, 12, [10]);
  const r = await simularGuerra([forte, fraco], { aoRespirar: respirar });
  const trocas = r.replay.quadros.flatMap((q) => q.c ?? []);
  ok(r.vencedorId === 1, 'o time forte vence');
  ok(r.placar.find((g) => g.id === 2).mortes === 1, 'o time de um pokémon perde uma vez só');
  ok(trocas.length === 0, 'sem reserva para entrar, não há troca gravada');

  const revanche = await simularGuerra([guildFalsa(1, 1, 95, [6, 9, 3]), guildFalsa(2, 1, 40, [10, 13, 16])], {
    aoRespirar: respirar,
  });
  const trocas2 = revanche.replay.quadros.flatMap((q) => q.c ?? []);
  ok(trocas2.length >= 1, 'com reservas, a troca de pokémon é gravada', `${trocas2.length}`);
  ok(trocas2.every((c) => c.n && c.lt && c.mhp > 0), 'a troca traz sprite, nome e HP do que entrou');
}

secao('Guild sem ninguém em campo não trava a guerra');
{
  const vazia = { id: 9, nome: 'Vazia', brasao: null, membros: [{ playerId: 1, nick: 'Solo', looktype: 159, visual: null, equipe: [] }] };
  const r = await simularGuerra([guildFalsa(1, 2, 60, [6]), guildFalsa(2, 2, 60, [9]), vazia], {
    aoRespirar: respirar,
  });
  ok(r.placar.length === 2, 'a guild sem equipe fica fora do placar', `${r.placar.length}`);
  ok(!r.colocacoes.has(9), 'e sem colocação — não ganha GP por não ter lutado');
}

secao('Montagem do pokémon a partir da linha do banco');
{
  const linha = {
    pk_id: 42,
    species_id: 6,
    level: 100,
    quality: 1.35,
    ivs: JSON.stringify(IVS),
    shiny: true,
    potencia: 3,
    tm_elemental: 'FIRE',
  };
  const pk = _testePokemonDaLinha(linha);
  const esperado = calcularStats(especies.get(6), IVS, 100, 1.35, multDeNascenca(3, true));
  ok(pk?.id === 42 && pk.speciesId === 6, 'lê id e espécie');
  ok(JSON.stringify(pk.stats) === JSON.stringify(esperado), 'os stats levam potência E shiny');
  ok(pk.maxHp === hpDeCombate(esperado.hp), 'o HP de combate é o do jogo');
  ok(pk.lookShiny != null, 'o shiny entra com a arte da forma brilhante');
  ok(pk.tmElemental === 'FIRE', 'o TM elemental acompanha o pokémon');

  // `potencia = 0` é linha que nunca passou pela roleta — vale 1, não multiplicador zerado.
  const semPotencia = _testePokemonDaLinha({ ...linha, potencia: 0, shiny: false });
  const comUm = _testePokemonDaLinha({ ...linha, potencia: 1, shiny: false });
  ok(
    JSON.stringify(semPotencia.stats) === JSON.stringify(comUm.stats),
    'potência 0 (backfill pendente) é tratada como 1',
  );

  ok(_testePokemonDaLinha({ ...linha, species_id: 999999 }) === null, 'espécie desconhecida não vira lutador');
  ok(_testePokemonDaLinha({ ...linha, ivs: null }) === null, 'linha sem IV não vira lutador');

  // A régua da guerra: acima da âncora o nível COMPRIME, mas nunca zera — o teto duro de 150
  // saiu, e o veterano parou de jogar nível no lixo. As três asserções guardam as três metades
  // disso: comprime, ainda rende, e os stats são recalculados na medida (não no nível cru).
  const alto = _testePokemonDaLinha({ ...linha, level: 2000, shiny: false, potencia: 1 });
  const medido = nivelNaGuerra(2000);
  const naMedida = calcularStats(especies.get(6), IVS, medido, 1.35, multDeNascenca(1, false));
  ok(alto?.level === medido, `nível alto luta pela régua da guerra (nv 2.000 → ${medido})`, String(alto?.level));
  ok(medido > 150 && medido < 2000, 'a régua comprime de verdade, e mesmo assim rende acima da âncora', String(medido));
  ok(JSON.stringify(alto.stats) === JSON.stringify(naMedida), 'stats recalculados na medida da guerra');
}

// A trava de `LIMITE_LUTADORES_GOLPES` (1.200) é cinto de segurança, e cinto que ninguém
// testa é cinto que não afivela. São 241 guilds — 1.205 lutadores, cinco a mais que o teto —
// contra as 240 de baixo, que passam raspando por dentro dele.
secao('Guerra grande demais grava sem as animações de golpe');
{
  const golpesNaFita = (rep) => (rep.quadros ?? []).reduce((n, q) => n + (q.a?.length ?? 0) / 6, 0);

  const dentro = await simularGuerra(
    Array.from({ length: 240 }, (_, i) => guildFalsa(i + 1, 5, 80, [6, 9])),
    { aoRespirar: respirar, ordemFixa: true },
  );
  ok(dentro.replay.atores.length / 2 === 1200, 'a de baixo tem exatamente 1.200 lutadores', `${dentro.replay.atores.length / 2}`);
  ok(golpesNaFita(dentro.replay) > 0, 'e ainda grava os golpes', `${golpesNaFita(dentro.replay)}`);
  ok(dentro.replay.golpesCortados == null, 'sem marca de corte no cabeçalho');

  const fora = await simularGuerra(
    Array.from({ length: 241 }, (_, i) => guildFalsa(i + 1, 5, 80, [6, 9])),
    { aoRespirar: respirar, ordemFixa: true },
  );
  ok(fora.replay.atores.length / 2 === 1205, 'a de cima passa do teto', `${fora.replay.atores.length / 2}`);
  ok(golpesNaFita(fora.replay) === 0, 'e a fita sai sem golpe nenhum', `${golpesNaFita(fora.replay)}`);
  ok(fora.replay.golpesCortados === 1205, 'com o corte marcado no cabeçalho', `${fora.replay.golpesCortados}`);
  // O que NÃO pode mudar: a guerra é a mesma, só a gravação é mais magra.
  ok(fora.vencedorId != null && fora.colocacoes.size === 241, 'a guerra continua sendo decidida normalmente');
  ok((fora.replay.quadros ?? []).some((q) => q.h?.length), 'e a fita continua trazendo HP e passos');
}

secao('Espalhamento das âncoras — nascer numa ilha isolada não pode voltar');
{
  // Bug de verdade, relatado e reproduzido: `recortarArena` corta um QUADRADO em volta do
  // ponto de entrada sem saber se aquilo deixa o chão andável CONECTADO. Em `brave_charizard`
  // não deixa — o recorte isola um bolsão de tiles do resto, sem caminho entre os dois dentro
  // da caixa. Cair uma guild nessa ilha significava uma guerra inteira sem ninguém se
  // encontrar: os dois finalistas ficavam presos em lados opostos da fronteira, `passoRumoA`
  // nunca achava caminho, e os 5 minutos do teto de tempo passavam sem um golpe trocado.
  //
  // A correção: `ancorasDeGuild` só sorteia entre tiles ALCANÇÁVEIS a pé a partir do ponto de
  // entrada. Este teste prova a garantia direto — 200 sorteios, guildas de 2 a 25, e confere
  // que TODO PAR de âncoras tem um caminho de verdade (BFS 4-direções) entre si.
  const bruta = gradeDaHunt(SLUG_ARENA);
  const g = _testeRecortarArena(bruta);
  const candidatos = _testeTilesAndaveisDaArena(g);

  const idxDe = (c) => c.cy * g.cols + c.cx;
  function existeCaminho(a, b) {
    if (a.cx === b.cx && a.cy === b.cy) return true;
    const visitados = new Set([idxDe(a)]);
    const fila = [a];
    for (let i = 0; i < fila.length; i++) {
      const cur = fila[i];
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = cur.cx + dx;
        const ny = cur.cy + dy;
        if (nx === b.cx && ny === b.cy) return true;
        if (!andavel(g, nx, ny)) continue;
        const idx = ny * g.cols + nx;
        if (visitados.has(idx)) continue;
        visitados.add(idx);
        fila.push({ cx: nx, cy: ny });
      }
    }
    return false;
  }

  const RODADAS = 200;
  let paresSemCaminho = 0;
  let piorMinimo = Infinity;
  for (let rodada = 0; rodada < RODADAS; rodada++) {
    const n = 2 + (rodada % 24); // varre 2..25 guildas, repetindo o ciclo
    const ancoras = _testeAncorasDeGuild(g, n);
    for (let i = 0; i < ancoras.length; i++) {
      for (let j = i + 1; j < ancoras.length; j++) {
        const a = ancoras[i];
        const b = ancoras[j];
        if (!existeCaminho(a, b)) {
          paresSemCaminho++;
          console.log(`    ✗ rodada ${rodada} (n=${n}): âncoras ${i} e ${j} sem caminho — (${a.cx},${a.cy}) × (${b.cx},${b.cy})`);
        }
      }
    }
  }
  ok(candidatos.length > 0, 'existe pelo menos um tile alcançável a partir do ponto de entrada');
  ok(
    paresSemCaminho === 0,
    `todo par de âncoras tem caminho entre si (${RODADAS} sorteios, n=2..25)`,
    paresSemCaminho ? `${paresSemCaminho} pares sem caminho` : '',
  );
}

secao('Chaveamento do nascimento — as favoritas longe umas das outras');
{
  // A serpentina sozinha: 16 guilds em quatro regiões de 3 vagas saem como uma chave de campeonato.
  const regiao = _testeSerpentinaDasChaves([3, 3, 3, 3], 12);
  const quartos = [[1], [2], [3], [4]];
  regiao.forEach((r, k) => quartos[r].push(5 + k));
  const ordenados = quartos.map((q) => [...q].sort((a, b) => a - b));
  const esperado = [[1, 8, 9, 16], [2, 7, 10, 15], [3, 6, 11, 14], [4, 5, 12, 13]];
  ok(JSON.stringify(ordenados) === JSON.stringify(esperado),
    'a serpentina reparte 16 guilds como uma chave de campeonato (1-8-9-16 / 2-7-10-15 / …)', JSON.stringify(ordenados));
  ok(quartos.every((q) => q.reduce((s, v) => s + v, 0) === 34), 'toda região soma a mesma força (34)');
  const vagas = [1, 0, 5, 2];
  const apertada = _testeSerpentinaDasChaves(vagas, 8);
  ok(apertada.length === 8 && vagas.every((v, r) => apertada.filter((x) => x === r).length === v),
    'região sem vaga é pulada, e ninguém fica sem lugar', apertada.join(','));
}
{
  // A ordem de força: temporada, depois o dia anterior, depois a equipe.
  const semEquipe = (id, gpGlobal, gp) => ({ id, nome: `S${id}`, gpGlobal, gp, membros: [] });
  const forte = { ...guildFalsa(4, 3, 90, [6, 9]), gpGlobal: 10, gp: 5 };
  const fraca = { ...guildFalsa(5, 1, 20, [10]), gpGlobal: 10, gp: 5 };
  const ordem = ordenarPorSemente([semEquipe(1, 10, 0), fraca, semEquipe(3, 10, 5), forte, semEquipe(2, 30, 0)])
    .map((x) => x.id).join(',');
  ok(ordem === '2,4,5,3,1', 'cabeça de chave: GP Global, depois o GP de ontem, depois a força da equipe', ordem);
}
{
  // No mapa de verdade, de 2 a 25 guilds e começando por cada uma das quatro pontas.
  const g = _testeRecortarArena(gradeDaHunt(SLUG_ARENA));
  const idx = (c) => c.cy * g.cols + c.cx;
  let arenas = 0;
  let falhaSegunda = 0;
  let falhaTerceira = 0;
  let falhaRegiao = 0;
  for (let rodada = 0; rodada < 48; rodada++) {
    const n = 2 + (rodada % 24);
    const ancoras = _testeNascimentoPorChave(g, n, () => (rodada % 4) / 4);
    arenas++;
    const dist = ancoras.map((a) => _testeDistanciasAPe(g, a));
    const d = (i, j) => dist[i][idx(ancoras[j])];
    // A 2ª é a guild mais distante da 1ª, a pé, de todas as que nasceram.
    if (ancoras.some((_, k) => k > 1 && d(0, k) > d(0, 1))) falhaSegunda++;
    // A 3ª é a que fica mais longe das duas primeiras.
    if (ancoras.some((_, k) => k > 2 && Math.min(d(0, k), d(1, k)) > Math.min(d(0, 2), d(1, 2)))) falhaTerceira++;
    // Dentro da região de cada cabeça de chave, quanto mais perto dela, mais fraca a guild.
    const cabecas = Math.min(4, n);
    const porRegiao = Array.from({ length: cabecas }, () => []);
    for (let k = cabecas; k < n; k++) {
      let h = 0;
      for (let j = 1; j < cabecas; j++) if (d(j, k) < d(h, k)) h = j;
      porRegiao[h].push({ semente: k, dist: d(h, k) });
    }
    for (const r of porRegiao) {
      for (const a of r) for (const b of r) if (a.dist < b.dist && a.semente < b.semente) falhaRegiao++;
    }
  }
  ok(!falhaSegunda, `a 2ª mais forte nasce no ponto mais distante a pé da 1ª (${arenas} arenas, n=2..25, as 4 pontas)`, `${falhaSegunda}`);
  ok(!falhaTerceira, 'a 3ª nasce no ponto mais distante das duas primeiras', `${falhaTerceira}`);
  ok(!falhaRegiao, 'dentro de cada região, a guild mais fraca nasce mais perto da cabeça de chave', `${falhaRegiao}`);
}

console.log(`\n${'='.repeat(46)}`);
secao('O teto de tempo: dez minutos na guerra, cinco nos duelos');
{
  ok(LIMITE_MS_GUERRA === 10 * 60_000, 'a Guerra de Guilds tem 10 minutos');
  ok(LIMITE_MS_DUELO === 5 * 60_000, 'os duelos (ginásio, ranqueado, campeonato) seguem com 5');
  // O orquestrador da guerra é quem escolhe o teto; os duelos não passam nada e caem no padrão.
  const orquestra = readFileSync(new URL('../src/server/game/guild-pvp.mjs', import.meta.url), 'utf8');
  ok(/limiteMs:\s*LIMITE_MS_GUERRA/.test(orquestra), 'a guerra do dia chama a simulação com LIMITE_MS_GUERRA');
  for (const duelo of ['ginasios.mjs', 'pvp-ranqueado.mjs']) {
    const src = readFileSync(new URL(`../src/server/game/${duelo}`, import.meta.url), 'utf8');
    ok(!/limiteMs/.test(src), `${duelo} não mexe no teto (fica o do duelo)`);
  }
  // O teto pedido é respeitado: uma guerra de dezesseis guilds não acaba em um minuto.
  const grande = Array.from({ length: 16 }, (_, i) => guildFalsa(900 + i, 5, 90, [6, 9, 3]));
  const curta = await simularGuerra(grande, { aoRespirar: respirar, limiteMs: 60_000 });
  ok(curta.motivo === 'tempo' && curta.duracaoMs === 60_000, 'com teto de 60 s, a guerra para em 60 s e decide no desempate',
    `${curta.motivo} ${curta.duracaoMs}`);
  ok(curta.replay.quadros.length <= 60_000 / 250, 'e o gravador para no teto de quadros dele', String(curta.replay.quadros.length));
  const outra = Array.from({ length: 16 }, (_, i) => guildFalsa(950 + i, 5, 90, [6, 9, 3]));
  const minima = await simularGuerra(outra, { aoRespirar: respirar, limiteMs: 1 });
  ok(minima.duracaoMs === 30_000, 'um teto absurdo é preso em 30 s', String(minima.duracaoMs));
}

console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
