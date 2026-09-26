// Teste da ARENA PvP, sem banco e sem Redis.
//
// `pvp.mjs` só depende de `content.mjs` (que lê o espelho de assets em disco) e de
// `combate.mjs` — nada de Postgres nem de socket. Dá para montar jogadores de mentira e
// rodar o tick da arena direto, que é o que este arquivo faz.
//
//   node tools/teste-pvp.mjs
import { podeUsarPokemon as podeUsarPokemonPorNivel } from '../src/shared/pokemon-nivel-treinador.mjs';
import {
  ARENAS,
  ligarGanchos,
  entrarNaArena,
  sairDaArena,
  trocarPokemonNaArena,
  podeSairDaArena,
  msParaSair,
  tickArenas,
  ocupacaoDasArenas,
  membroDe,
  novoElo,
  ELO_INICIAL,
  PVP_SAIDA_MS,
  PVP_COOLDOWN_MS,
  PVP_XP_PERDIDO,
  PVP_NIVEL_MIN,
} from '../src/server/game/pvp.mjs';
import { especies, calcularStats, hpDeCombate, xpTotalParaNivel } from '../src/server/content.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

// ------------------------------------------------------------------ dublês

const eventos = new Map(); // key -> [eventos]
const idosAoCentro = new Set();

function jogadorFalso(nick, speciesId = 25, nivel = 80, nPokemons = 1) {
  const key = nick.toLowerCase();
  const p = {
    key,
    nick,
    dbId: Math.floor(Math.random() * 1e6),
    gatewayId: 'gw-teste',
    level: nivel,
    xp: xpTotalParaNivel(nivel) + 10_000,
    elo: ELO_INICIAL,
    pvpAbates: 0,
    pvpMortes: 0,
    pvpCooldownAte: 0,
    pvp: null,
    pokemons: new Map(),
    activeId: null,
    noCentro: false,
    boss: null,
    campo: null,
    selvagem: null,
    cdGolpes: {},
  };
  for (let i = 0; i < nPokemons; i++) {
    const esp = especies.get(speciesId);
    const ivs = { hp: 20, atk: 20, def: 20, spAtk: 20, spDef: 20, speed: 20 };
    const stats = calcularStats(esp, ivs, nivel, 1);
    const maxHp = hpDeCombate(stats.hp);
    const id = p.dbId * 100 + i;
    p.pokemons.set(id, {
      id,
      speciesId,
      nome: esp.name,
      looktype: esp.looktype,
      tipos: [esp.type1, esp.type2].filter(Boolean),
      level: nivel,
      quality: 1,
      potencia: 2,
      ivs,
      stats,
      hp: maxHp,
      maxHp,
      slot: i,
      shiny: false,
    });
    if (i === 0) p.activeId = id;
  }
  eventos.set(key, []);
  return p;
}

const evsDe = (p) => eventos.get(p.key) ?? [];
const temEv = (p, k) => evsDe(p).some((e) => e.k === k);

ligarGanchos({
  evento: (p, ev) => eventos.get(p.key)?.push(ev),
  enviar: () => {},
  marcarSujo: () => {},
  ativo: (p) => p.pokemons.get(p.activeId) ?? null,
  podeUsarPokemon: (p, pk) => podeUsarPokemonPorNivel(p.level, pk),
  irParaOCentro: (p) => {
    idosAoCentro.add(p.key);
    p.noCentro = true;
  },
});

console.log('ARENA PvP\n=========');

// ------------------------------------------------------------------ o ELO

secao('ELO');
{
  const a = novoElo(1000, 1000, 1);
  const b = novoElo(1000, 1000, 0);
  ok(a === 1012, 'vitória entre iguais dá +12', `deu ${a}`);
  ok(b === 988, 'derrota entre iguais dá −12', `deu ${b}`);
  ok(a - 1000 === 1000 - b, 'soma zero: o que um ganha o outro perde');

  const zebra = novoElo(1000, 1600, 1) - 1000;
  const favorito = novoElo(1600, 1000, 1) - 1600;
  ok(zebra > favorito, 'bater um mais forte rende mais que bater um mais fraco', `${zebra} vs ${favorito}`);
  ok(favorito <= 2, 'bater um MUITO mais fraco quase não move o ELO', `deu +${favorito}`);
}

// -------------------------------------------------------------- entrar/sair

secao('Entrada');
{
  const t = Date.now();
  const p = jogadorFalso('Ash');
  const r = entrarNaArena(p, ARENAS[0].id, t);
  ok(r.ok, 'entra na arena');
  ok(p.pvp?.arenaId === ARENAS[0].id, 'o jogador fica marcado como dentro da arena');
  ok(ocupacaoDasArenas().find((a) => a.id === ARENAS[0].id).dentro === 1, 'a arena conta 1 dentro');

  const r2 = entrarNaArena(p, ARENAS[0].id, t);
  ok(!r2.ok, 'não entra duas vezes');

  // sem pokémon de pé
  const morto = jogadorFalso('Gary');
  morto.pokemons.get(morto.activeId).hp = 0;
  ok(!entrarNaArena(morto, ARENAS[0].id, t).ok, 'não entra com o time no chão');

  // Multi-shard: esta função não sabe mais nada sobre shard — quem decide "local ou migra" é
  // `sim.mjs` (ver `efetivarEntradaNaArena`/`migrarParaArenaRemota`), de propósito, porque
  // migração depende de Redis e Postgres e não dá para testar aqui sem os dois de pé.

  sairDaArena(p, 'saiu', t);
  ok(p.pvp === null, 'sair limpa o estado de arena');
  ok(p.pvpCooldownAte === t + PVP_COOLDOWN_MS, 'sair carimba o cooldown de 5 min');
  ok(ocupacaoDasArenas().find((a) => a.id === ARENAS[0].id).dentro === 0, 'a arena esvazia');
}

secao(`Nível mínimo ${PVP_NIVEL_MIN}`);
{
  const t = Date.now();
  const jovem = jogadorFalso('Young', 25, PVP_NIVEL_MIN - 1);
  ok(!entrarNaArena(jovem, ARENAS[0].id, t).ok, `nv ${PVP_NIVEL_MIN - 1} não entra`);
}

secao('Cap Ancestral nv 120');
{
  const t = Date.now();
  const p = jogadorFalso('CapTest', 25, 200);
  const pkReal = p.pokemons.get(p.activeId);
  const r = entrarNaArena(p, 'ancestral', t);
  ok(r.ok, 'treinador nv 200 entra na Ancestral');
  ok(r.membro.pk.level === 120, 'pokémon luta como nv 120', `level=${r.membro.pk.level}`);
  ok(pkReal.level === 200, 'nível real do pokémon não muda');
  r.membro.pk.hp = Math.floor(r.membro.pk.maxHp / 2);
  sairDaArena(p, 'saiu', t);
  ok(pkReal.level === 200, 'nível real intacto depois de sair');
  ok(pkReal.hp > 0 && pkReal.hp < pkReal.maxHp, 'HP real proporcional ao sair', `${pkReal.hp}/${pkReal.maxHp}`);
}

secao('Cap Ancestral nv 139');
{
  const t = Date.now();
  const p = jogadorFalso('Cap139', 6, 139); // Charizard
  const pkReal = p.pokemons.get(p.activeId);
  const r = entrarNaArena(p, 'ancestral', t);
  ok(r.ok, 'nv 139 entra na Ancestral');
  ok(r.membro.pk.level === 120, 'luta como nv 120 na arena', `level=${r.membro.pk.level}`);
  ok(pkReal.level === 139, 'nível real permanece 139');
  sairDaArena(p, 'saiu', t);
  ok(pkReal.level === 139, 'nível real intacto ao sair');
}

secao('Troca manual de pokémon');
{
  const t = Date.now();
  const p = jogadorFalso('Switch', 25, 80, 2);
  const [pk1, pk2] = [...p.pokemons.values()].sort((a, b) => a.slot - b.slot);
  entrarNaArena(p, ARENAS[0].id, t);
  const membro = membroDe(p);
  ok(membro?.pk?.speciesId === pk1.speciesId, 'começa com o primeiro em campo');
  const r = trocarPokemonNaArena(p, pk2, t);
  ok(r.ok, 'troca manual aceita');
  p.activeId = pk2.id;
  ok(membro.pk.speciesId === pk2.speciesId, 'entidade da arena virou o segundo', `${pk1.speciesId}→${membro.pk.speciesId}`);
  ok(pk1.level === pk2.level, 'nível real dos dois intacto');
  sairDaArena(p, 'saiu', t);
}

secao('Cooldown de 5 minutos');
{
  const t = Date.now();
  const p = jogadorFalso('Misty');
  entrarNaArena(p, ARENAS[0].id, t);
  sairDaArena(p, 'saiu', t);

  const cedo = entrarNaArena(p, ARENAS[0].id, t + 60_000);
  ok(!cedo.ok, 'recusa a reentrada 1 minuto depois');
  ok(/4m/.test(cedo.msg), 'a mensagem diz quanto falta', cedo.msg);

  const depois = entrarNaArena(p, ARENAS[0].id, t + PVP_COOLDOWN_MS + 1);
  ok(depois.ok, 'aceita a reentrada depois dos 5 minutos');
  sairDaArena(p, 'saiu', t + PVP_COOLDOWN_MS + 1);
}

// ------------------------------------------------------------------ combate

secao('Combate e a regra dos 10 s');
{
  const t0 = Date.now();
  const jogadores = new Map();
  const a = jogadorFalso('Red', 25, 80); // Pikachu
  const b = jogadorFalso('Blue', 1, 80); // Bulbasaur
  jogadores.set(a.key, a);
  jogadores.set(b.key, b);

  entrarNaArena(a, ARENAS[0].id, t0);
  entrarNaArena(b, ARENAS[0].id, t0);
  ok(a.pvp && b.pvp, 'os dois entram na mesma arena');

  // Antes de qualquer dano, os dois estão livres para sair — `emCombateAte` nasce em 0.
  ok(podeSairDaArena(a, t0), 'quem acabou de entrar pode sair');
  ok(msParaSair(a, t0) === 0, 'e a contagem está zerada');

  // Rodam ticks até alguém tomar dano. Eles nascem em pontos de spawn sorteados, então o
  // caminho até o encontro leva alguns segundos de tempo simulado.
  let t = t0;
  let houveDano = false;
  for (let i = 0; i < 4000 && !houveDano; i++) {
    t += 250;
    tickArenas(t, jogadores);
    houveDano = evsDe(a).some((e) => e.k === 'ataque') || evsDe(b).some((e) => e.k === 'ataque');
  }
  ok(houveDano, 'os dois se encontram e trocam dano');

  if (houveDano) {
    // O dano é o que marca combate — nos DOIS lados, não só em quem levou.
    ok(!podeSairDaArena(a, t), 'quem trocou dano NÃO pode sair na hora');
    ok(!podeSairDaArena(b, t), 'e o outro lado também não');
    ok(msParaSair(a, t) > 0 && msParaSair(a, t) <= PVP_SAIDA_MS, 'a contagem de saída está correndo');

    ok(podeSairDaArena(a, t + PVP_SAIDA_MS + 1), 'passados 10 s sem dano, a saída libera');

    const ev = evsDe(a).find((e) => e.k === 'ataque') ?? evsDe(b).find((e) => e.k === 'ataque');
    ok(ev.dano > 0, 'o golpe causa dano', `dano=${ev.dano}`);
    ok(ev.de && ev.para, 'o evento diz quem bateu em quem', JSON.stringify({ de: ev.de, para: ev.para }));
  }

  // ---------------------------------------------------------- até a morte
  const xpAntes = { [a.key]: a.xp, [b.key]: b.xp };
  let acabou = false;
  for (let i = 0; i < 20000 && !acabou; i++) {
    t += 250;
    tickArenas(t, jogadores);
    acabou = temEv(a, 'pvpMorte') || temEv(b, 'pvpMorte');
  }
  ok(acabou, 'a briga chega ao fim');

  if (acabou) {
    const perdedor = temEv(a, 'pvpMorte') ? a : b;
    const vencedor = perdedor === a ? b : a;

    const evMorte = evsDe(perdedor).find((e) => e.k === 'pvpMorte');
    const evAbate = evsDe(vencedor).find((e) => e.k === 'pvpAbate');

    ok(!!evAbate, 'o vencedor recebe o evento de abate');
    ok(vencedor.elo > ELO_INICIAL, 'o ELO do vencedor sobe', `${vencedor.elo}`);
    ok(perdedor.elo < ELO_INICIAL, 'o ELO do perdedor desce', `${perdedor.elo}`);
    ok(
      vencedor.elo - ELO_INICIAL === ELO_INICIAL - perdedor.elo,
      'a arena não infla ELO: o ganho de um é a perda do outro',
    );
    ok(vencedor.pvpAbates === 1 && perdedor.pvpMortes === 1, 'o placar de abates/mortes anda');

    // ------------------------------------------------------------- o XP
    const perdeu = xpAntes[perdedor.key] - perdedor.xp;
    const dentroDoNivel = xpAntes[perdedor.key] - xpTotalParaNivel(perdedor.level);
    ok(perdeu > 0, 'morrer custa XP do treinador', `perdeu ${perdeu}`);
    ok(
      perdeu === Math.floor(dentroDoNivel * PVP_XP_PERDIDO),
      `a perda é ${Math.round(PVP_XP_PERDIDO * 100)}% do XP do nível atual`,
      `esperado ${Math.floor(dentroDoNivel * PVP_XP_PERDIDO)}, deu ${perdeu}`,
    );
    ok(perdedor.xp >= xpTotalParaNivel(perdedor.level), 'a perda de XP nunca faz descer de nível');
    ok(evMorte.xpPerdido === perdeu, 'o evento informa o XP perdido');

    // -------------------------------------------------- expulso da arena
    ok(perdedor.pvp === null, 'quem morre sem suplente sai da arena');
    ok(idosAoCentro.has(perdedor.key), 'e vai para o Centro Pokémon');
    ok(perdedor.pvpCooldownAte > t, 'a morte também dispara o cooldown de 5 min');
    ok(vencedor.pvp !== null, 'o vencedor continua dentro');

    sairDaArena(vencedor, 'saiu', t);
  }
}

secao('Suplente: só sai da arena quem fica sem time');
{
  const t0 = Date.now();
  const jogadores = new Map();
  const a = jogadorFalso('Lance', 149, 80, 1); // Dragonite, um só
  const b = jogadorFalso('Joey', 16, 80, 3); // três Pidgey
  jogadores.set(a.key, a);
  jogadores.set(b.key, b);
  entrarNaArena(a, ARENAS[1].id, t0);
  entrarNaArena(b, ARENAS[1].id, t0);

  let t = t0;
  let mortes = 0;
  for (let i = 0; i < 40000 && !b.noCentro; i++) {
    t += 250;
    tickArenas(t, jogadores);
    mortes = evsDe(b).filter((e) => e.k === 'pvpMorte').length;
  }
  ok(mortes >= 2, 'o time de três cai um pokémon por vez', `${mortes} mortes`);
  ok(temEv(b, 'troca'), 'entra suplente entre uma queda e outra');
  ok(b.pvp === null && b.noCentro, 'só depois do último é que sai da arena');
  ok(a.pvpAbates === mortes, 'o vencedor pontua cada abate', `${a.pvpAbates}`);
  if (a.pvp) sairDaArena(a, 'saiu', t);
}

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
