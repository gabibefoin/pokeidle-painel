// Os 18 Ginásios — regras de time, nível e a luta contra o líder. Sem banco, sem Redis.
//
// O que este teste protege, em ordem de "quanto dói se quebrar":
//
//   1. o ginásio NÃO tem teto de nível — nv 300 mede como 300 (o teto de 150 é só da guerra);
//   2. uma espécie por ginásio, shiny incluído — a regra que impede o time de cinco Charizards;
//   3. o mesmo pokémon PODE estar em dois ginásios diferentes (dupla tipagem);
//   4. o +25% do líder multiplica o dano de quem tem o título e não vaza para os outros;
//   5. o desafio ao líder roda de verdade e devolve um replay que o player do cliente lê.
//
//   node tools/teste-ginasios.mjs

import {
  ARENA_EXPO_GINASIO,
  ARENA_NIVEL_CHEIO,
  GINASIO_BUFF_MULT,
  GINASIO_TIME_MAX,
  TIPOS_GINASIO,
  motivoForaDoGinasio,
  multBuffGinasio,
  nivelDeArena,
  nivelNaGuerra,
  nivelNoGinasio,
  poderNoGinasio,
  statsNoGinasio,
  timeValidoDoGinasio,
  validarTimeGinasio,
} from '../src/shared/ginasios.mjs';
import { poderDePokemon } from '../src/shared/nota-pokemon.mjs';
import { especies, calcularStats, hpDeCombate, multDeNascenca } from '../src/server/content.mjs';
import { simularGuerra, VERSAO_REPLAY } from '../src/server/game/guild-pvp-sim.mjs';

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

/** Um pokémon "de coleção", do jeito que `ginasios-db.mjs` monta a partir da linha. */
function pk(nomeEspecie, nivel, extra = {}) {
  const esp = [...especies.values()].find((e) => e.name.toLowerCase() === nomeEspecie.toLowerCase());
  if (!esp) throw new Error(`espécie desconhecida no espelho: ${nomeEspecie}`);
  return {
    id: Math.floor(Math.random() * 1e9),
    speciesId: esp.pokeId,
    nome: esp.name,
    looktype: esp.looktype,
    tipos: [esp.type1, esp.type2].filter(Boolean),
    level: nivel,
    quality: 1.2,
    potencia: 1,
    shiny: false,
    ivs: IVS,
    refino: null,
    esp,
    ...extra,
  };
}

// --------------------------------------------------- 1. a régua de nível da arena

secao('Nível na arena — inteiro até a âncora, comprimido daí para cima');
{
  ok(nivelNoGinasio(ARENA_NIVEL_CHEIO) === ARENA_NIVEL_CHEIO, `nv ${ARENA_NIVEL_CHEIO} conta inteiro`);
  ok(nivelNoGinasio(100) === 100, 'nv 100 conta inteiro');
  ok(nivelNoGinasio(1) === 1, 'nv 1 fica em 1');
  // O saneamento continua sendo responsabilidade da função: nível inválido não pode virar
  // `NaN` e contaminar os seis stats em silêncio.
  ok(nivelNoGinasio(0) === 1 && nivelNoGinasio(null) === 1, 'nível inválido cai em 1, nunca em NaN');

  // O que a compressão promete: acima da âncora o nível vale MENOS que ele mesmo, e ainda
  // assim vale ALGUMA COISA. As duas metades importam — sem a primeira é o nível inteiro de
  // volta, sem a segunda é o teto duro de volta.
  ok(nivelNoGinasio(3000) < 3000, 'nv 3.000 é medido abaixo de 3.000 (comprime)');
  ok(nivelNoGinasio(3000) > nivelNoGinasio(1000), 'e ainda assim mede mais que nv 1.000 (nível nunca vira zero)');
  ok(
    nivelNoGinasio(100000) > nivelNoGinasio(99000),
    'nem no extremo o nível para de render — não existe teto em lugar nenhum da curva',
  );

  // A MONOTONIA, varrida de verdade: nenhum degrau da curva pode descer, nem na travessia da
  // âncora, onde o arredondamento seria o suspeito natural.
  let desceu = null;
  for (let n = 1; n < 20_000 && desceu === null; n++) {
    if (nivelDeArena(n + 1, ARENA_EXPO_GINASIO) < nivelDeArena(n, ARENA_EXPO_GINASIO)) desceu = n;
  }
  ok(desceu === null, 'subir de nível nunca reduz a medida (varrido de 1 a 20.000)', `caiu em ${desceu}`);

  // A propriedade que sustenta o "não desanima": a XP é cúbica, então DOBRAR o nível custa
  // sempre 8×; se dobrar rendesse cada vez menos, o grind tardio valeria menos que o inicial.
  // Com a raiz o retorno é o MESMO em qualquer ponto da curva — é isto que se está trancando.
  const dobra = (n) => nivelDeArena(n * 2, ARENA_EXPO_GINASIO) / nivelDeArena(n, ARENA_EXPO_GINASIO);
  const alvo = 2 ** ARENA_EXPO_GINASIO;
  const fora = [300, 1000, 3000, 10_000].filter((n) => Math.abs(dobra(n) - alvo) > 0.01);
  ok(fora.length === 0, `dobrar o nível rende sempre o mesmo (×${alvo.toFixed(2)}), em toda a curva`, `falhou em ${fora}`);

  const charizard3000 = pk('Charizard', 3000);
  const charizard150 = pk('Charizard', ARENA_NIVEL_CHEIO);
  const charizard100 = pk('Charizard', 100);
  ok(
    poderNoGinasio(charizard3000, charizard3000.esp) > poderNoGinasio(charizard150, charizard150.esp),
    'nv 3.000 é MAIS FORTE que nv 150 no ginásio — upar sempre paga',
  );
  ok(
    poderNoGinasio(charizard100, charizard100.esp) < poderNoGinasio(charizard150, charizard150.esp),
    'e nv 100 continua mais fraco que nv 150',
  );

  // As duas arenas comprimem, mas por expoentes diferentes, e de propósito: a guerra é guild
  // contra guild com todo mundo dentro e precisa de faixa mais curta. Este par tranca a
  // separação — mexer num expoente não pode mexer no outro.
  ok(
    nivelNaGuerra(3000) < nivelNoGinasio(3000),
    'a GUERRA comprime mais que o ginásio no mesmo nível',
    `${nivelNaGuerra(3000)} × ${nivelNoGinasio(3000)}`,
  );
  ok(
    nivelNaGuerra(3000) > ARENA_NIVEL_CHEIO,
    'e mesmo na guerra o nível acima da âncora rende — o teto duro de 150 acabou',
    `${nivelNaGuerra(3000)}`,
  );
  ok(nivelNaGuerra(100) === 100, 'abaixo da âncora a guerra não toca em nada — ninguém perdeu força');
  // A força do ginásio NÃO é o ⚔ do ranking, e é de propósito: o ⚔ mede o quão raro é o
  // espécime, e o ginásio precisa medir quem ganha a luta. Ver o cabeçalho da seção de força
  // em `shared/ginasios.mjs` — e `teste-ginasios-forca.mjs`, que mede a diferença.
  ok(
    poderNoGinasio(charizard100, charizard100.esp) !== poderDePokemon(charizard100, charizard100.esp),
    'a força do ginásio é OUTRA conta, não o ⚔ do ranking',
  );

  // O guarda-divergência: `statsNoGinasio` é uma cópia de `calcularStats`, que vive no
  // servidor. Se uma andar sem a outra, o editor do cliente passa a mostrar um número e o
  // pódio do servidor outro — este teste é o que impede isso.
  for (const nome of ['Charizard', 'Blastoise', 'Pikachu', 'Machamp']) {
    for (const nivel of [40, 150, 300]) {
      const p = pk(nome, nivel, { potencia: 3, shiny: nome === 'Pikachu' });
      const meu = statsNoGinasio(p, p.esp);
      const dele = calcularStats(
        p.esp, p.ivs, nivelNoGinasio(p.level), p.quality, multDeNascenca(p.potencia, p.shiny), p.refino,
      );
      ok(
        JSON.stringify(meu) === JSON.stringify(dele),
        `statsNoGinasio bate com calcularStats (${nome} nv ${nivel})`,
        `${JSON.stringify(meu)} × ${JSON.stringify(dele)}`,
      );
    }
  }
}

// ---------------------------------------------------------- 2. regras do time

secao('Uma espécie por ginásio');
{
  const zard = pk('Charizard', 150);
  const zardShiny = pk('Charizard', 150, { shiny: true });
  const arcanine = pk('Arcanine', 150);

  ok(motivoForaDoGinasio(zard, 'FIRE', []) === null, 'Charizard entra no ginásio de FIRE');
  ok(
    motivoForaDoGinasio(zardShiny, 'FIRE', [zard]) === 'especie',
    'Charizard SHINY não entra junto de um Charizard comum',
  );
  ok(
    motivoForaDoGinasio(zard, 'FIRE', [zardShiny]) === 'especie',
    'e o contrário também é barrado',
  );
  ok(motivoForaDoGinasio(arcanine, 'FIRE', [zard]) === null, 'outra espécie de fogo entra');
  ok(
    motivoForaDoGinasio(pk('Blastoise', 150), 'FIRE', []) === 'tipo',
    'pokémon de outro tipo é recusado',
  );
  ok(
    motivoForaDoGinasio(arcanine, 'FIRE', [zard, pk('Ninetales', 150), pk('Rapidash', 150), pk('Magmar', 150), pk('Flareon', 150)]) === 'cheio',
    `o sexto pokémon não entra (máximo ${GINASIO_TIME_MAX})`,
  );

  const { ok: valeu, motivo } = validarTimeGinasio([zard, zardShiny], 'FIRE');
  ok(!valeu && motivo === 'especie', 'validarTimeGinasio recusa o time com espécie repetida');
  ok(validarTimeGinasio([zard, arcanine], 'FIRE').ok, 'e aceita o time legítimo');
  ok(validarTimeGinasio([], 'FIRE').ok, 'time vazio é válido (é como se sai do ginásio)');
}

secao('Dupla tipagem entra em dois ginásios');
{
  const zard = pk('Charizard', 200);
  ok(motivoForaDoGinasio(zard, 'FIRE', []) === null, 'o MESMO Charizard entra em FIRE');
  ok(motivoForaDoGinasio(zard, 'FLYING', []) === null, '…e também em FLYING');
  // O MESMO pokémon repetido dá 'repetido' e não 'especie': são recusas diferentes e a tela
  // diz coisas diferentes ("esse já está no time" × "já tem um Charizard aqui").
  ok(
    motivoForaDoGinasio(zard, 'FIRE', [zard]) === 'repetido',
    'mas não duas vezes no MESMO ginásio',
  );
}

secao('Time que envelheceu — evolução vira espécie repetida');
{
  // O jogador registrou Charmander e Charizard em FIRE. O Charmander evoluiu: agora são dois
  // Charizards na mesma lista. O segundo simplesmente para de contar, e o resto do time vale.
  const a = pk('Charizard', 150);
  const b = pk('Charizard', 150);
  const c = pk('Arcanine', 150);
  const valido = timeValidoDoGinasio([a, b, c], 'FIRE');
  ok(valido.length === 2, 'o duplicado sai da conta e o time continua valendo', `sobraram ${valido.length}`);
  ok(valido[0].id === a.id && valido[1].id === c.id, 'quem sai é o SEGUNDO, não o primeiro');

  const comIntruso = timeValidoDoGinasio([a, pk('Blastoise', 150), c], 'FIRE');
  ok(comIntruso.length === 2, 'pokémon fora do tipo também é ignorado em vez de invalidar o time');
}

// ------------------------------------------------------------------ 3. o buff

secao('O +25% do líder');
{
  const fogo = new Set(['FIRE']);
  ok(multBuffGinasio(['FIRE'], fogo) === GINASIO_BUFF_MULT, 'pokémon de fogo do líder de FIRE bate +25%');
  ok(multBuffGinasio(['FIRE', 'FLYING'], fogo) === GINASIO_BUFF_MULT, 'tipo duplo casa pelo primeiro tipo');
  ok(multBuffGinasio(['FLYING', 'FIRE'], fogo) === GINASIO_BUFF_MULT, 'e pelo segundo também');
  ok(multBuffGinasio(['WATER'], fogo) === 1, 'pokémon de outro tipo NÃO leva o bônus');
  ok(multBuffGinasio(['FIRE'], null) === 1, 'quem não lidera nada não leva bônus');
  ok(
    multBuffGinasio(['FIRE', 'FLYING'], new Set(['FIRE', 'FLYING'])) === GINASIO_BUFF_MULT,
    'dois títulos no mesmo pokémon NÃO empilham',
  );
  ok(multBuffGinasio(['FIRE'], ['FIRE']) === GINASIO_BUFF_MULT, 'aceita array além de Set');
}

// ------------------------------------------------------------- 4. os 18 tipos

secao('Os 18 ginásios');
{
  ok(TIPOS_GINASIO.length === 18, 'são dezoito', `são ${TIPOS_GINASIO.length}`);
  ok(new Set(TIPOS_GINASIO).size === 18, 'sem tipo repetido');
  const semDono = TIPOS_GINASIO.filter(
    (tipo) => ![...especies.values()].some((e) => e.type1 === tipo || e.type2 === tipo),
  );
  ok(semDono.length === 0, 'todo ginásio tem pokémon do tipo no espelho', semDono.join(', '));
}

// ---------------------------------------------------------------- 5. o desafio

secao('Desafio ao líder — a simulação de verdade');
{
  const paraCombate = (p) => {
    const nivel = nivelNoGinasio(p.level);
    const stats = calcularStats(p.esp, p.ivs, nivel, p.quality, multDeNascenca(p.potencia, p.shiny), p.refino);
    return {
      id: p.id, speciesId: p.speciesId, nome: p.nome, looktype: p.looktype, lookShiny: null,
      tipos: p.tipos, level: nivel, shiny: p.shiny, stats, maxHp: hpDeCombate(stats.hp),
      tmElemental: null,
    };
  };
  const lado = (id, nick, time, bonusTipos = null) => ({
    id, nome: nick, brasao: null,
    membros: [{ playerId: id, nick, looktype: 159, visual: null, equipe: time.map(paraCombate), bonusTipos }],
  });

  const forte = [pk('Charizard', 150), pk('Arcanine', 150), pk('Ninetales', 150), pk('Rapidash', 150), pk('Magmar', 150)];
  const fraco = [pk('Charmander', 40), pk('Vulpix', 40), pk('Growlithe', 40), pk('Ponyta', 40), pk('Magby', 40)];

  const r = await simularGuerra([lado(1, 'Desafiante', fraco), lado(2, 'Lider', forte)], {
    aoRespirar: () => new Promise((res) => setImmediate(res)),
  });

  ok(r.vencedorId === 2, 'o time nv 150 amassa o time nv 40', `venceu ${r.vencedorId}`);
  ok(r.placar.length === 2, 'o placar tem os dois lados');
  ok(r.placar[0].pos === 1 && r.placar[1].pos === 2, 'as colocações saem 1 e 2');
  ok(r.replay?.v === VERSAO_REPLAY, 'o replay sai na versão que o cliente lê');
  ok(r.replay.atores.length === 4, 'quatro atores: dois pokémon e dois treinadores', `${r.replay.atores.length}`);
  ok(r.replay.quadros.length > 0 && r.replay.dur > 0, 'a fita tem quadros e duração');
  // A ordem é embaralhada de propósito por `simularGuerra` (é ela que decide quem nasce
  // onde), então o teste confere o CONJUNTO e não a sequência.
  ok(
    [...r.replay.guilds.map((g) => g.nome)].sort().join(',') === 'Desafiante,Lider',
    'os dois "lados" viajam com o NICK dos jogadores, não com nome de guild',
  );

  // O ponto do desafio: quem entra na luta entra pela MESMA régua que mediu o pódio. O número
  // da tela e a batalha que o botão roda não podem divergir — se o duelo usasse o nível cru, o
  // desafio contradiria o ranking que o motivou. É isto que a asserção tranca.
  const soberbo = [pk('Charizard', 300), pk('Arcanine', 300), pk('Ninetales', 300), pk('Rapidash', 300), pk('Magmar', 300)];
  const inteiro = lado(3, 'Inteiro', soberbo);
  const medido = nivelNoGinasio(300);
  ok(
    inteiro.membros[0].equipe.every((e) => e.level === medido),
    `todo mundo entra na luta do ginásio pela régua do pódio (nv 300 → ${medido})`,
    inteiro.membros[0].equipe.map((e) => e.level).join(','),
  );

  // E o time de nv 300 tem de ganhar do de nv 150 — com o teto, os dois empatariam.
  const r300 = await simularGuerra([lado(4, 'Trezentos', soberbo), lado(5, 'CentoCinquenta', forte)], {
    aoRespirar: () => new Promise((res) => setImmediate(res)),
  });
  ok(r300.vencedorId === 4, 'e o time nv 300 vence o nv 150 (com teto seria empate técnico)', `venceu ${r300.vencedorId}`);
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
