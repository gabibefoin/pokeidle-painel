// A força do ginásio PREVÊ a batalha? Mede contra o simulador de verdade.
//
// Este arquivo existe por causa de um relato do primeiro dia: um jogador com UM Charizard
// nv 150 de IVs quase perfeitos marcava 599 de força, outro com Tepig nv 150 + Quilava nv 48
// + Charizard nv 80 marcava 783 — e o de 599 vencia TODAS as vezes ao clicar em "Desafiar o
// líder". A fórmula de então somava o ⚔ do ranking, que mede o quão RARO é um espécime, não
// quem ganha a luta. Um número que diz uma coisa e uma batalha que diz outra é pior que não
// ter número nenhum.
//
// A troca não foi de gosto: as candidatas foram medidas gerando matchups, rodando a batalha
// e contando quem acertou o vencedor. Em 90 matchups decisivos:
//
//     95,6%  Σ (dps × ehp) com o golpe real   ← a escolhida
//     94,4%  Σ (dps × ehp) sem o golpe
//     94,4%  só o melhor do time
//     91,1%  Σ √(dps × ehp)
//     90,0%  a soma do ⚔ do ranking            ← a antiga
//
// O teste roda uma amostra menor (é batalha de verdade, custa segundos) e exige que a
// fórmula em uso continue acima do piso e que ela NUNCA volte a errar o caso do relato.
//
// ### Depois que o teto de 150 saiu do ginásio
//
// Os dois cenários de relato foram gravados quando o ginásio media todo mundo em 150. Sem o
// teto, o NÍVEL volta a dominar a conta e o segundo deles se inverte: o Bellossom nv 10154
// passa a ganhar dos três de ~150, e por larga margem. Isso não é regressão — é a mudança.
//
// Por isso aquele cenário deixou de afirmar QUEM vence e passou a afirmar o que ele sempre
// quis proteger: que o número da tela e o resultado da batalha apontam para o mesmo lado.
//
//   node tools/teste-ginasios-forca.mjs [matchups]

import { especies, calcularStats, hpDeCombate, multDeNascenca } from '../src/server/content.mjs';
import { simularGuerra } from '../src/server/game/guild-pvp-sim.mjs';
import { poderDePokemon } from '../src/shared/nota-pokemon.mjs';
import { nivelNoGinasio, poderDoTimeGinasio, poderNoGinasio } from '../src/shared/ginasios.mjs';

/**
 * Quantos matchups. Cada um é uma batalha DE VERDADE rodada cinco vezes, então a amostra
 * custa segundos — mas amostra pequena aqui não é economia, é ruído: com 16 matchups, UM
 * resultado infeliz vira 6 pontos percentuais e o teste passa a falhar sozinho. Um teste que
 * falha por acaso ensina a ignorar o teste.
 */
const MATCHUPS = Number(process.argv[2] ?? 40);
/**
 * Piso de acerto. Medido em 70 matchups: a fórmula em uso faz ~94% e a antiga ~86%. O piso
 * fica em 85% para caber a variação de uma amostra de 40 sem afrouxar a ponto de deixar
 * passar uma fórmula ruim — e o caso do relato, logo acima, é o guarda exato.
 */
const PISO_ACERTO = 0.85;

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

const rnd = (a, b) => a + Math.random() * (b - a);
const escolha = (arr) => arr[Math.floor(Math.random() * arr.length)];
const doTipo = [...especies.values()].filter(
  (e) => (e.type1 === 'FIRE' || e.type2 === 'FIRE') && (e.attacks?.length ?? 0) > 0,
);

/** Um pokémon com qualidade DIRIGIDA — `bom` faz o bicho nascer perto do teto em tudo. */
function poke(bom) {
  const esp = escolha(doTipo);
  const alvo = Math.round(rnd(bom ? 22 : 4, bom ? 32 : 18));
  const r = () => Math.max(1, Math.min(32, Math.round(alvo + rnd(-4, 4))));
  return {
    esp, speciesId: esp.pokeId,
    level: bom ? Math.round(rnd(150, 400)) : Math.round(rnd(25, 110)),
    quality: Number(rnd(bom ? 1.35 : 0.8, bom ? 1.8 : 1.2).toFixed(3)),
    potencia: bom ? Math.round(rnd(3, 5)) : Math.round(rnd(1, 2)),
    shiny: bom && Math.random() < 0.25,
    ivs: { hp: r(), atk: r(), def: r(), spAtk: r(), spDef: r(), speed: r() },
    refino: null,
  };
}

const paraCombate = (p) => {
  const nivel = nivelNoGinasio(p.level);
  const st = calcularStats(p.esp, p.ivs, nivel, p.quality, multDeNascenca(p.potencia, p.shiny), p.refino);
  return {
    id: Math.floor(Math.random() * 1e9), speciesId: p.esp.pokeId, nome: p.esp.name,
    looktype: p.esp.looktype, lookShiny: null,
    tipos: [p.esp.type1, p.esp.type2].filter(Boolean),
    level: nivel, shiny: !!p.shiny, stats: st, maxHp: hpDeCombate(st.hp), tmElemental: null,
  };
};
const lado = (id, time) => ({
  id, nome: `L${id}`, brasao: null,
  membros: [{ playerId: id, nick: `L${id}`, looktype: 159, visual: null, equipe: time.map(paraCombate), bonusTipos: null }],
});

/** Quem vence a MAIORIA de N batalhas — tira o ruído do ±15% de variação do dano. */
async function quemVence(a, b, rodadas = 5) {
  let vitA = 0;
  for (let i = 0; i < rodadas; i++) {
    const r = await simularGuerra([lado(1, a), lado(2, b)], { aoRespirar: () => new Promise((res) => setImmediate(res)) });
    if (r.vencedorId === 1) vitA++;
  }
  return { vencedor: vitA > rodadas / 2 ? 1 : 2, margem: Math.abs(2 * vitA - rodadas) / rodadas };
}

/** A força EM USO — a mesma que o pódio e o editor mostram. */
const forcaEmUso = (time) => poderDoTimeGinasio(time, new Map(time.map((p) => [p.speciesId, p.esp])));
/** A fórmula ANTIGA, só para o teste poder mostrar que a troca valeu. */
const forcaAntiga = (time) =>
  time.reduce((s, p) => s + poderDePokemon({ ...p, level: nivelNoGinasio(p.level) }, p.esp), 0);

console.log('Força do ginásio × batalha de verdade\n=====================================');

secao('O caso do relato (1 Charizard bom × 3 medianos)');
{
  const zard = especies.get(6);
  const tepig = especies.get(498);
  const quilava = especies.get(156);
  const fasi = [{ esp: zard, speciesId: 6, level: 5770, quality: 1.587, potencia: 2, shiny: false,
    ivs: { hp: 30, atk: 30, def: 28, spAtk: 31, spDef: 30, speed: 26 }, refino: null }];
  const bieok = [
    { esp: tepig, speciesId: 498, level: 1662, quality: 1.704, potencia: 2, shiny: false,
      ivs: { hp: 31, atk: 26, def: 29, spAtk: 9, spDef: 22, speed: 19 }, refino: null },
    { esp: quilava, speciesId: 156, level: 48, quality: 1.735, potencia: 1, shiny: false,
      ivs: { hp: 26, atk: 8, def: 29, spAtk: 9, spDef: 31, speed: 10 }, refino: null },
    { esp: zard, speciesId: 6, level: 80, quality: 1.171, potencia: 2, shiny: false,
      ivs: { hp: 24, atk: 30, def: 24, spAtk: 19, spDef: 16, speed: 10 }, refino: null },
  ];

  const real = await quemVence(fasi, bieok, 7);
  ok(real.vencedor === 1, 'na batalha, o time de UM pokémon bom vence os três medianos');

  const fA = forcaEmUso(fasi);
  const fB = forcaEmUso(bieok);
  ok(fA > fB, `e a força EM USO diz a mesma coisa (${fA} × ${fB})`, `${fA} × ${fB}`);
}

secao('Bellossom nv 10k × time de Grama (KELLAR × fasi) — sem teto');
{
  const bell = especies.get(182);
  const trop = especies.get(13357);
  const mega = especies.get(2003);
  const venu = especies.get(2004);
  const kellar = [{ esp: bell, speciesId: 182, level: 10154, quality: 1.8, potencia: 3, shiny: false,
    ivs: { hp: 13, atk: 21, def: 19, spAtk: 8, spDef: 31, speed: 13 }, refino: null }];
  const fasi = [
    { esp: trop, speciesId: 13357, level: 1957, quality: 1.79, potencia: 3, shiny: false,
      ivs: { hp: 24, atk: 10, def: 6, spAtk: 24, spDef: 15, speed: 18 }, refino: null },
    { esp: mega, speciesId: 2003, level: 151, quality: 1.263, potencia: 1, shiny: false,
      ivs: { hp: 18, atk: 22, def: 30, spAtk: 9, spDef: 25, speed: 5 }, refino: null },
    { esp: venu, speciesId: 2004, level: 150, quality: 1.166, potencia: 3, shiny: false,
      ivs: { hp: 9, atk: 23, def: 17, spAtk: 11, spDef: 22, speed: 23 }, refino: null },
  ];

  // Sem o teto, o nv 10154 do Bellossom vale por inteiro e ele passa a ganhar — o oposto do
  // que este cenário provava quando o cap existia. O que o teste guarda NÃO é quem vence: é
  // que a força mostrada na tela e a batalha continuam concordando, seja quem for.
  const real = await quemVence(fasi, kellar, 7);
  const fK = forcaEmUso(kellar);
  const fF = forcaEmUso(fasi);
  ok(
    (fF > fK ? 1 : 2) === real.vencedor,
    `a força EM USO aponta o vencedor da batalha (fasi ${fF} × kellar ${fK}, venceu ${real.vencedor === 1 ? 'fasi' : 'kellar'})`,
    `${fF} × ${fK}`,
  );
  ok(real.vencedor === 2, 'e quem vence agora é o Bellossom nv 10k — é o teto que o segurava');
}

secao(`Previsão contra o simulador (${MATCHUPS} matchups)`);
{
  let decisivos = 0;
  let acertos = 0;
  let acertosAntiga = 0;
  for (let i = 0; i < MATCHUPS; i++) {
    // Metade dos matchups é o caso que quebra a fórmula antiga: POUCOS BONS contra MUITOS
    // MEDIANOS. Sortear tudo ao acaso quase nunca produz esse par — e foi por isso que o bug
    // passou: a conta antiga acerta o fácil e erra justo o que o jogador vê na tela.
    const dificil = i % 2 === 0;
    const a = Array.from({ length: dificil ? Math.round(rnd(1, 2)) : Math.round(rnd(1, 5)) }, () => poke(dificil));
    const b = Array.from({ length: dificil ? Math.round(rnd(3, 5)) : Math.round(rnd(1, 5)) }, () => poke(false));

    const { vencedor, margem } = await quemVence(a, b);
    if (margem < 0.5) continue; // 3×2 é moeda ao ar; exigir acerto aí seria medir ruído
    decisivos++;
    if ((forcaEmUso(a) > forcaEmUso(b) ? 1 : 2) === vencedor) acertos++;
    if ((forcaAntiga(a) > forcaAntiga(b) ? 1 : 2) === vencedor) acertosAntiga++;
  }

  const pct = decisivos ? acertos / decisivos : 0;
  const pctAntiga = decisivos ? acertosAntiga / decisivos : 0;
  console.log(`  (${decisivos} matchups decisivos · em uso ${(100 * pct).toFixed(1)}% · antiga ${(100 * pctAntiga).toFixed(1)}%)`);
  ok(decisivos >= MATCHUPS * 0.5, 'a maioria dos matchups foi decisiva', `${decisivos}/${MATCHUPS}`);
  ok(
    pct >= PISO_ACERTO,
    `a força em uso acerta o vencedor em ${(100 * PISO_ACERTO).toFixed(0)}%+ dos casos`,
    `${(100 * pct).toFixed(1)}%`,
  );
  // A FOLGA é larga de propósito, e a razão merece ficar escrita porque ela não é óbvia.
  //
  // Com 40 matchups, a diferença entre as duas fórmulas balança sozinha de run para run: medido
  // cinco vezes seguidas sem mexer em nada, `em uso − antiga` foi +2,5, 0, +2,5, −7,5 e +7,5
  // pontos. Com um matchup de folga (2,5%) o run do −7,5 reprovava, e o teste falhava sozinho
  // em cerca de uma a cada cinco execuções — que é exatamente o que o cabeçalho deste arquivo
  // manda evitar, e era assim ANTES de a compressão de nível existir.
  //
  // Dez pontos é o que cobre esse balanço. O que esta asserção detecta, então, é o que ela
  // sempre pôde detectar de verdade: alguém trocar a fórmula por uma SUBSTANCIALMENTE pior.
  // Regressão fina não se pega aqui — se pega nos dois cenários de relato, que são
  // determinísticos e ficam logo acima.
  const folga = 0.10;
  ok(
    pct >= pctAntiga - folga,
    'e não acerta menos que a fórmula antiga',
    `${(100 * pct).toFixed(1)}% × ${(100 * pctAntiga).toFixed(1)}%`,
  );
}

secao('O número na tela');
{
  const bom = { esp: especies.get(6), speciesId: 6, level: 150, quality: 1.5, potencia: 3, shiny: false,
    ivs: { hp: 28, atk: 28, def: 28, spAtk: 28, spDef: 28, speed: 28 }, refino: null };
  const fraco = { ...bom, level: 40, quality: 0.9, potencia: 1,
    ivs: { hp: 6, atk: 6, def: 6, spAtk: 6, spDef: 6, speed: 6 } };

  const pBom = poderNoGinasio(bom, bom.esp);
  const pFraco = poderNoGinasio(fraco, fraco.esp);
  ok(pBom > pFraco, 'o pokémon bom vale mais que o fraco', `${pBom} × ${pFraco}`);
  ok(pFraco >= 1, 'nenhum pokémon vale zero (o pior possível ainda é 1)', `${pFraco}`);
  ok(Number.isInteger(pBom) && Number.isInteger(pFraco), 'a força é inteira — a tela não mostra decimal');

  // As PARCELAS SOMAM: o número do time é a soma dos números dos pokémon. Sem isto, o editor
  // mostraria "3 + 4 = 9" e o jogador teria razão em desconfiar da tela.
  const time = [bom, fraco];
  const esps = new Map(time.map((p) => [p.speciesId, p.esp]));
  ok(
    poderDoTimeGinasio(time, esps) === pBom + pFraco,
    'a força do time é exatamente a soma das forças dos pokémon',
    `${poderDoTimeGinasio(time, esps)} × ${pBom + pFraco}`,
  );
}

console.log(`\n${falhas ? '✗' : '✓'} ${testes - falhas}/${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
