// OS 18 GINÁSIOS — as regras, do lado que cliente e servidor precisam enxergar igual.
//
// Um ginásio por TIPO elemental. O jogador registra um time de até cinco pokémon daquele
// tipo e disputa o pódio contra todo mundo: quem tiver o time mais FORTE é o líder, e o
// líder ganha +25% de dano com os pokémon daquele tipo na hunt (inclui boss).
//
// ### Por que as regras moram aqui, e não no servidor
//
// O editor de time do cliente precisa dizer NA HORA por que um pokémon não entra ("já tem um
// Charizard", "não é do tipo", "time cheio") — sem isso o jogador clica, espera meio segundo
// e leva um "não" sem explicação. Mas o cliente é uma sugestão: quem decide de verdade é
// `ginasios-db.mjs`, que roda EXATAMENTE as mesmas funções sobre as linhas do Postgres. Um
// cliente adulterado mandando cinco Charizards shiny esbarra na mesma `validarTimeGinasio`.
//
// ### O nível conta INTEIRO até 150, e daí para cima pela RAIZ
//
// Nenhuma arena tem teto duro. O que existe é uma COMPRESSÃO: até o nível 150 o nível vale
// por inteiro; acima disso cada nível continua valendo, só que cada vez menos.
//
//     nivelDeArena(L) = L                          , se L ≤ 150
//                     = 150 × (L / 150) ^ expoente , se L > 150
//
// Isso existe porque as duas formas anteriores erravam de maneiras opostas:
//
//   · **teto duro** (o que a Guerra de Guilds tinha, e a Arena Ancestral ainda tem): acima do
//     teto o nível vale ZERO. Um nv 10.000 mede igual a um nv 150, e quem passou seis meses
//     upando descobre que jogou o tempo fora naquela arena.
//   · **nível inteiro** (o que o ginásio tinha): stat é linear no nível, então o nível vira o
//     ÚNICO eixo. Nv 150 contra nv 10.000 é 66,7×, e nenhum nascimento cobre isso — IV,
//     qualidade, potência e shiny param de decidir qualquer coisa.
//
// A raiz é a única forma que não cai em nenhuma das duas, e o motivo é a TAXA DE CÂMBIO entre
// grind e força. A XP é cúbica (`xpTotalParaNivel`), então DOBRAR o nível custa sempre 8× de
// XP; com a raiz, dobrar o nível rende sempre o MESMO tanto — +37% no ginásio, +15% na guerra
// — em qualquer ponto da curva. Nenhum trecho do grind vale menos que um trecho anterior e
// nenhum nível é desperdiçado. Um teto zera essa taxa; um sistema de faixas (r% por faixa) a
// degrada, e ainda deixa o espalhamento crescer sem limite.
//
// ### Por que dois expoentes
//
//   ginásio e PvP (0,45)   é jogador CONTRA jogador do mesmo tipo, e o que o pódio quer
//                          premiar é o espécime. Com 0,45 a faixa de nv 150 a 10.000 vale
//                          6,6×, pouco acima dos 5,5× que separam o pior do melhor nascimento
//                          possível: o nascimento manda, e o nível continua sendo vantagem
//                          real e permanente.
//   guerra de guilds (0,20)  é guild contra guild com todo mundo dentro, e o que a mantém
//                          disputável é a faixa ser CURTA: nv 10.000 vale 2,3× um nv 150. Ela
//                          tinha teto duro e o veterano jogava nível no lixo; agora não joga
//                          mais, sem que a guerra vire "ganha quem tem o jogador mais antigo".
//
// Balancear é mexer em `ARENA_EXPO_GINASIO` / `ARENA_EXPO_GUERRA` e em mais nada: stats,
// rating, métricas e o duelo 1×1 passam todos por `nivelNoGinasio`.
//
// A HUNT não passa por aqui. Lá o nível vale inteiro, sempre — estas funções são de medição de
// arena, e o caminho da hunt é outro (`calcularStats` direto, em `sim.mjs`).

import { EXPO_QUALIDADE, multDeNascenca } from './nota-pokemon.mjs';
import { basesComRefino } from './refino-stats.mjs';
import { efetividade } from './tipo-efetividade.mjs';
import { golpeTmElemental } from './tm-elemental.mjs';

/** Os 18 ginásios, na ordem em que a tela os desenha (a mesma do filtro de tipos do Mapa). */
export const TIPOS_GINASIO = [
  'NORMAL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'ICE', 'FIGHTING', 'POISON', 'GROUND',
  'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY',
];

const TIPOS_VALIDOS = new Set(TIPOS_GINASIO);

/** O ícone de cada ginásio é o MESMO SVG de tipo que o painel de golpes do palco usa. */
export const iconeDoGinasio = (tipo) => `/img/tipos/${String(tipo).toLowerCase()}.svg`;

/** Pokémon por time de ginásio. */
export const GINASIO_TIME_MAX = 5;

/**
 * Até este nível o nível conta INTEIRO em qualquer arena; acima dele começa a compressão.
 *
 * É o antigo teto da Guerra de Guilds, e o número continua sendo 150 de propósito: quem estava
 * abaixo do teto não sente diferença nenhuma em lugar nenhum, e a migração da guerra vira só
 * ganho — nenhum jogador perde força em relação ao que tinha.
 *
 * Mora neste arquivo, e não em `game/guild-pvp.mjs`, por um motivo prático: a guerra mede a
 * força com a MESMA máquina do ginásio (`ratingDeCombate` e companhia), e o cliente precisa do
 * número para desenhar "Nv 202 → conta como 168" no editor de time sem uma ida ao servidor.
 * Pôr a constante do lado do servidor obrigaria a duplicá-la aqui.
 */
export const ARENA_NIVEL_CHEIO = 150;

/** Expoente do GINÁSIO e do PvP ranqueado. Ver "Por que dois expoentes" no cabeçalho. */
export const ARENA_EXPO_GINASIO = 0.45;

/** Expoente da GUERRA DE GUILDS — mais curto de propósito, para a guerra seguir disputável. */
export const ARENA_EXPO_GUERRA = 0.20;

/** Nível de TREINADOR para registrar time em qualquer ginásio. */
export const GINASIO_NIVEL_MIN = 150;

/** O prêmio do 1º lugar: +25% de dano com pokémon daquele tipo. */
export const GINASIO_BUFF_PCT = 25;
export const GINASIO_BUFF_MULT = 1 + GINASIO_BUFF_PCT / 100;

/** Espera entre dois desafios ao MESMO ginásio — 24 h por tipo, independente entre si. */
export const GINASIO_DESAFIO_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Slug da arena de duelo — recorte de Cerulean desenhado no nomeador (`/ginasios.html`). */
export const SLUG_ARENA_GINASIO = 'ginasio-duelo';

/** Normaliza o que veio do cliente; `null` se não for um dos 18. */
export function tipoDeGinasio(bruto) {
  const t = String(bruto ?? '').toUpperCase();
  return TIPOS_VALIDOS.has(t) ? t : null;
}

/** O pokémon pertence ao ginásio? Dupla tipagem entra nos DOIS (Charizard: FIRE e FLYING). */
export const pokemonDoTipo = (tipos, tipo) =>
  (tipos ?? []).some((x) => String(x).toUpperCase() === String(tipo).toUpperCase());

/**
 * O nível com que um pokémon é MEDIDO numa arena — a compressão do cabeçalho.
 *
 * Duas coisas em uma, e as duas importam:
 *
 *   · **sanear.** O nível chega de uma linha do banco, de um snapshot congelado num anúncio ou
 *     de um pacote do cliente, e `null`, `"87"` e `0` precisam todos virar um inteiro ≥ 1 antes
 *     de entrar numa conta de stats — `(nivel / 100)` com `NaN` contamina os seis stats em
 *     silêncio.
 *   · **comprimir.** Inteiro até `ARENA_NIVEL_CHEIO`, raiz daí para cima.
 *
 * É MONOTÔNICA: subir de nível nunca devolve um número menor, e o piso de `ARENA_NIVEL_CHEIO`
 * garante que atravessar a âncora não crie um degrau para baixo. O bicho real não é tocado em
 * momento nenhum — é conta de vitrine e de arena, não alteração de dado.
 */
export function nivelDeArena(level, expoente) {
  const n = Math.max(1, Math.floor(Number(level) || 1));
  if (n <= ARENA_NIVEL_CHEIO) return n;
  return Math.max(
    ARENA_NIVEL_CHEIO,
    Math.round(ARENA_NIVEL_CHEIO * (n / ARENA_NIVEL_CHEIO) ** expoente),
  );
}

/** O nível medido no GINÁSIO — e, pelo mesmo expoente, no PvP ranqueado. */
export const nivelNoGinasio = (level) => nivelDeArena(level, ARENA_EXPO_GINASIO);

/** O nível medido na GUERRA DE GUILDS — expoente mais curto, ver o cabeçalho. */
export const nivelNaGuerra = (level) => nivelDeArena(level, ARENA_EXPO_GUERRA);

// ------------------------------------------------------------ força de BATALHA
//
// ### Por que o ⚔ do ranking não servia
//
// A primeira versão somava `poderDePokemon` (o ⚔ do ranking) dos cinco. Ele mede o quão RARO
// e bem-investido é um espécime — IV, qualidade, potência, shiny — vezes o nível. É a métrica
// certa para o ranking e a errada para o ginásio, porque o pódio precisa responder outra
// pergunta: **quem ganharia a luta**.
//
// A conta somava uma parcela por pokémon e ignorava que um nv 48 não encosta num nv 150.
// O resultado apareceu no servidor no primeiro dia: um jogador com UM Charizard nv 150 de
// IVs quase perfeitos marcava 599, outro com Tepig nv 150 + Quilava nv 48 + Charizard nv 80
// marcava 783 — e o de 599 vencia TODAS as vezes ao clicar em "Desafiar o líder". Um número
// que diz uma coisa e uma batalha que diz outra é pior que não ter número.
//
// ### O que a batalha realmente decide
//
// Em duelo de desgaste (que é o que `guild-pvp-sim.mjs` roda: um de cada vez, o próximo entra
// quando o anterior cai), A vence B quando `ehpA / dpsB > ehpB / dpsA` — ou seja, quando
// `dpsA × ehpA > dpsB × ehpB`. Esse produto é a moeda da luta, e é o que se soma pelo time.
//
// A escolha entre as candidatas não foi de gosto: `tools/teste-ginasios-forca.mjs` gera
// matchups, roda a batalha DE VERDADE e mede quem acerta o vencedor. Σ(dps×ehp) com o golpe
// real da espécie acertou 95,6% contra 90% da fórmula antiga — e resolve o caso acima com
// folga (965 × 714 em vez de 599 × 783).

/** HP de combate — cópia de `hpDeCombate` em `server/content.mjs`. O teste falha se divergir. */
export const hpDeCombateGinasio = (hp) => Math.max(24, Math.round(hp * 12));

/**
 * Os stats no nível do cap — cópia de `calcularStats` em `server/content.mjs`.
 *
 * Mora aqui porque o EDITOR do cliente precisa mostrar a mesma força que o pódio do servidor,
 * e `calcularStats` vive no servidor. `tools/teste-ginasios.mjs` compara as duas e falha se
 * uma andar sem a outra — a mesma convenção que `nota-pokemon.mjs` já usa para as tabelas de
 * qualidade e potência.
 */
export function statsNoGinasio(pk, esp) {
  if (!esp || !pk?.ivs) return null;
  const nivel = nivelNoGinasio(pk.level);
  const mult = multDeNascenca(pk.potencia, pk.shiny);
  const b = basesComRefino(esp, pk.refino);
  const um = (base, iv, k) =>
    Math.round((base + 2 * (iv ?? 1)) * (nivel / 100) * (Math.pow(Number(pk.quality ?? pk.qualidade) || 1, EXPO_QUALIDADE[k]) * mult));
  return {
    hp: um(b.hp, pk.ivs.hp, 'hp'),
    atk: um(b.atk, pk.ivs.atk, 'atk'),
    def: um(b.def, pk.ivs.def, 'def'),
    spAtk: um(b.spAtk, pk.ivs.spAtk, 'spAtk'),
    spDef: um(b.spDef, pk.ivs.spDef, 'spDef'),
    speed: um(b.speed, pk.ivs.speed, 'speed'),
  };
}

/** O ataque básico de `game/combate.mjs` — o piso de quem ainda não aprendeu nada bom. */
const GOLPE_BASICO = { power: 30, cooldownMs: 2000, category: 'PHYSICAL' };

/**
 * Pontuação de golpe — espelha `notaGolpe` em `game/combate.mjs`, sem matchup elemental.
 *
 * O defensor de referência usa os MESMOS stats do atacante: a moeda do ginásio mede o bicho,
 * não um tipo específico. O que importa é espelhar a IA de combate, que prefere Petal Bloom
 * (600) a Magical Leaf (120) — e não a Investida (30/2s), que ganhava no critério antigo de
 * power/cooldown e inflava Bellossom enquanto esmagava Tropius.
 */
function notaGolpeGinasio(g, nivel, stats, tipos) {
  const atk = g.category === 'SPECIAL' ? stats.spAtk : stats.atk;
  const def = g.category === 'SPECIAL' ? stats.spDef : stats.def;
  const stab = tipos.includes(g.type) ? 1.5 : 1;
  const base = ((2 * nivel) / 5 + 2) * (g.power ?? 0) * (atk / Math.max(1, def)) / 50 + 2;
  return base * stab;
}

/**
 * O golpe que a IA de combate escolheria — entre os que a espécie já aprendeu naquele nível
 * MAIS o do TM elemental, quando o pokémon tem um.
 *
 * ### Por que a TM entra aqui
 *
 * Ela é do POKÉMON, não da espécie, e por isso ficava de fora: este medidor só lia
 * `esp.attacks`, enquanto a batalha (`melhorGolpeJogador`, em `game/combate.mjs`) já somava o
 * golpe da TM aos candidatos. O ⚔ media um bicho e a arena mandava outro para a luta.
 *
 * Deu no ginásio de ROCK: dois Tyranitar shiny quase iguais, o desafiante com TM ROCK. O
 * pódio dizia 176.069 contra 275.316 a favor do titular — e o desafiante vencia 20 em 20,
 * porque batia com power 2.800 contra 600, no mesmo cooldown de 60 s. Com a TM na conta o ⚔
 * dele passa a 610.985, que é a proporção que a luta sempre mostrou.
 *
 * Com `stats`, usa a mesma preferência de `melhorGolpeJogador` (maior dano esperado por
 * golpe). Sem `stats`, cai no critério legado power/cooldown — só para chamadas internas
 * antigas; o pódio sempre passa stats via `ratingDeCombate`.
 */
export function melhorGolpeDoGinasio(esp, nivel, stats = null, tmElemental = null) {
  const golpes = (esp?.attacks ?? []).filter((a) => (a.learnLevel ?? 1) <= nivel);
  if (tmElemental) golpes.push(golpeTmElemental(tmElemental));
  if (!golpes.length) return GOLPE_BASICO;

  if (stats) {
    const tipos = [esp.type1, esp.type2].filter(Boolean);
    let melhor = GOLPE_BASICO;
    let melhorNota = -1;
    for (const g of golpes) {
      const nota = notaGolpeGinasio(g, nivel, stats, tipos);
      if (nota > melhorNota) {
        melhorNota = nota;
        melhor = g;
      }
    }
    return melhor;
  }

  let melhor = GOLPE_BASICO;
  let nota = GOLPE_BASICO.power / GOLPE_BASICO.cooldownMs;
  for (const a of golpes) {
    const n = (a.power ?? 0) / Math.max(1, a.cooldownMs ?? 10_000);
    if (n > nota) {
      nota = n;
      melhor = a;
    }
  }
  return melhor;
}

/**
 * A força bruta de batalha de um pokémon: dano por segundo × HP efetivo.
 *
 * `dps` sai da mesma conta de `calcularDano` (nível, power do golpe e ataque), contra um
 * defensor de referência; `ehp` é o HP de combate vezes a defesa média. O produto é a moeda
 * do duelo — ver o cabeçalho desta seção.
 */
export function ratingDeCombate(pk, esp) {
  const st = statsNoGinasio(pk, esp);
  if (!st) return 0;
  const nivel = nivelNoGinasio(pk.level);
  const g = melhorGolpeDoGinasio(esp, nivel, st, pk.tmElemental);
  const atk = Math.max(st.atk, st.spAtk);
  const def = (st.def + st.spDef) / 2;
  const dps =
    (((2 * nivel) / 5 + 2) * (g.power ?? GOLPE_BASICO.power) * atk)
    / 50
    / (Math.max(400, g.cooldownMs ?? GOLPE_BASICO.cooldownMs) / 1000);
  return dps * hpDeCombateGinasio(st.hp) * def;
}

/** Variação aleatória de cada golpe — espelha `combate.mjs` (0,85–1,00, não crítico separado). */
export const VARIACAO_DANO_MIN = 0.85;
export const VARIACAO_DANO_MAX = 1.0;

/** Métricas de combate de UM pokémon — dps, ehp e rating bruto (dps × ehp × def). */
export function metricasDeCombate(pk, esp) {
  const st = statsNoGinasio(pk, esp);
  if (!st) return null;
  const nivel = nivelNoGinasio(pk.level);
  const g = melhorGolpeDoGinasio(esp, nivel, st, pk.tmElemental);
  const atk = Math.max(st.atk, st.spAtk);
  const def = (st.def + st.spDef) / 2;
  const dps =
    (((2 * nivel) / 5 + 2) * (g.power ?? GOLPE_BASICO.power) * atk)
    / 50
    / (Math.max(400, g.cooldownMs ?? GOLPE_BASICO.cooldownMs) / 1000);
  const ehp = hpDeCombateGinasio(st.hp);
  const rating = dps * ehp * def;
  return {
    dps, ehp, def, rating, golpe: g, stats: st, nivel,
    nivelReal: Math.max(1, Math.floor(Number(pk.level) || 1)),
    tm: pk.tmElemental ?? null,
    golpeDaTm: !!g.tmElemental,
  };
}

const tiposDeEspecie = (esp) => [esp?.type1, esp?.type2].filter(Boolean);

/** Golpe básico no tipo do pokémon — só se não for imune ao alvo. */
function basicoContra(tipos, tiposDefensor, tabela) {
  for (const tipo of tipos.length ? tipos : ['NORMAL']) {
    if (efetividade(tipo, tiposDefensor[0], tiposDefensor[1], tabela) > 0) {
      return { ...GOLPE_BASICO, type: tipo };
    }
  }
  return null;
}

/** Dano esperado de um golpe contra um defensor concreto — STAB + tabela de tipos. */
function notaGolpeComMatchup(g, nivel, stats, tiposAtacante, tiposDefensor, defStats, tabela) {
  const ef = efetividade(g.type, tiposDefensor[0], tiposDefensor[1], tabela);
  if (ef === 0) return -1;
  const stab = tiposAtacante.includes(g.type) ? 1.5 : 1;
  const atk = g.category === 'SPECIAL' ? stats.spAtk : stats.atk;
  const def = defStats
    ? (g.category === 'SPECIAL' ? defStats.spDef : defStats.def)
    : atk;
  const base = ((2 * nivel) / 5 + 2) * (g.power ?? 0) * (atk / Math.max(1, def)) / 50 + 2;
  return base * stab * ef;
}

/**
 * Melhor golpe CONTRA o oponente — mesma lógica da IA de combate, TM elemental incluída.
 *
 * Aqui a TM passa pela tabela de tipos como qualquer outro golpe: ela é sempre de um tipo do
 * próprio pokémon (`tipoTmPermitido`), então leva STAB, mas contra quem resiste a esse tipo
 * ela pode perder para um golpe fraco de cobertura — que é justamente o que a calculadora
 * precisa mostrar.
 */
function melhorGolpeContra(esp, nivel, stats, tiposDefensor, defStats, tabela, tmElemental = null) {
  const tipos = tiposDeEspecie(esp);
  const golpes = (esp?.attacks ?? []).filter((a) => (a.learnLevel ?? 1) <= nivel);
  if (tmElemental) golpes.push(golpeTmElemental(tmElemental));
  let melhor = null;
  let melhorNota = -1;
  for (const g of golpes) {
    const nota = notaGolpeComMatchup(g, nivel, stats, tipos, tiposDefensor, defStats, tabela);
    if (nota > melhorNota) {
      melhorNota = nota;
      melhor = g;
    }
  }
  if (melhor) return melhor;
  return basicoContra(tipos, tiposDefensor, tabela) ?? GOLPE_BASICO;
}

/**
 * Métricas de combate contra UM oponente — usa tipos, STAB e stats reais de defesa dele.
 * A vitrine do ginásio continua em `metricasDeCombate` (sem matchup); só a calculadora
 * “Comparar pokémon” passa a tabela e chama isto.
 */
function metricasDeCombateContra(pk, esp, pkOpp, espOpp, tabela) {
  const st = statsNoGinasio(pk, esp);
  const stOpp = statsNoGinasio(pkOpp, espOpp);
  if (!st || !stOpp) return null;
  const nivel = nivelNoGinasio(pk.level);
  const tiposDef = tiposDeEspecie(espOpp);
  const tiposAtq = tiposDeEspecie(esp);
  const g = melhorGolpeContra(esp, nivel, st, tiposDef, stOpp, tabela, pk.tmElemental);
  const atk = g.category === 'SPECIAL' ? st.spAtk : st.atk;
  const defOpp = g.category === 'SPECIAL' ? stOpp.spDef : stOpp.def;
  const ef = efetividade(g.type, tiposDef[0], tiposDef[1], tabela);
  const stab = tiposAtq.includes(g.type) ? 1.5 : 1;
  const base =
    ((2 * nivel) / 5 + 2) * (g.power ?? GOLPE_BASICO.power) * atk / Math.max(1, defOpp) / 50 + 2;
  const dano = base * stab * Math.max(0, ef);
  const cd = Math.max(400, g.cooldownMs ?? GOLPE_BASICO.cooldownMs) / 1000;
  const dps = dano / cd;
  const ehp = hpDeCombateGinasio(st.hp);
  const defTank = (st.def + st.spDef) / 2;
  const rating = dps * ehp * defTank;
  return {
    dps, ehp, def: defTank, rating, golpe: g, stats: st, nivel,
    nivelReal: Math.max(1, Math.floor(Number(pk.level) || 1)),
    ef, stab: stab > 1,
    // `tm` é o TIPO do disco que o bicho tem; `golpeDaTm` diz se foi ELE que a conta usou.
    // São coisas diferentes na tela: ter a TM e não usá-la contra aquele oponente é
    // informação, não detalhe.
    tm: pk.tmElemental ?? null,
    golpeDaTm: !!g.tmElemental,
  };
}

/** RNG determinístico — mesmos inputs, mesma faixa de vitória na tela. */
function rngDeterministico(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/**
 * Compara dois pokémon em duelo 1×1 de desgaste.
 *
 * Com `tabelaTipos`, entra STAB + Forças/Fraquezas e o golpe escolhido contra o oponente
 * (calculadora “Comparar”). Sem tabela, cai na moeda do ginásio (dps × ehp sem matchup).
 *
 * A variação de dano (0,85–1,00 por golpe) entra como faixa de vitória, não como um número
 * único: dois bichos equilibrados podem inverter o resultado conforme a sorte do combate.
 */
export function compararDuelo1v1(pkA, espA, pkB, espB, { amostras = 400, tabelaTipos = null } = {}) {
  const usaTipos = tabelaTipos && Object.keys(tabelaTipos).length > 0;
  const mA = usaTipos
    ? metricasDeCombateContra(pkA, espA, pkB, espB, tabelaTipos)
    : metricasDeCombate(pkA, espA);
  const mB = usaTipos
    ? metricasDeCombateContra(pkB, espB, pkA, espA, tabelaTipos)
    : metricasDeCombate(pkB, espB);
  if (!mA || !mB) return null;

  // Com tipos: duelo de desgaste — quem leva mais tempo para cair (dps contra o rival × HP).
  // Sem tipos: moeda do ginásio (dps × ehp × def), onde matchup não importa.
  const scoreA = (mA, v) => usaTipos ? mA.dps * v * mA.ehp : mA.dps * v * mA.ehp * mA.def;
  const scoreB = (mB, v) => usaTipos ? mB.dps * v * mB.ehp : mB.dps * v * mB.ehp * mB.def;

  const rAmin = scoreA(mA, VARIACAO_DANO_MIN);
  const rAmax = scoreA(mA, VARIACAO_DANO_MAX);
  const rBmin = scoreB(mB, VARIACAO_DANO_MIN);
  const rBmax = scoreB(mB, VARIACAO_DANO_MAX);
  const baseA = scoreA(mA, 1);
  const baseB = scoreB(mB, 1);
  const espelho = Math.abs(baseA - baseB) / Math.max(baseA, baseB, 1) < 1e-6;

  let pctA;
  let pctB;
  if (espelho) {
    // Mesma força: Monte Carlo com dois rolls independentes inclina por acaso (ex. 52/48).
    pctA = 0.5;
    pctB = 0.5;
  } else {
    const seed = (
      (pkA.speciesId ?? 0) * 997
      + (pkB.speciesId ?? 0) * 991
      + Math.round(mA.rating)
      + Math.round(mB.rating * 3)
    ) >>> 0;
    const rnd = rngDeterministico(seed);
    let vitA = 0;
    for (let i = 0; i < amostras; i++) {
      const vA = VARIACAO_DANO_MIN + rnd() * (VARIACAO_DANO_MAX - VARIACAO_DANO_MIN);
      const vB = VARIACAO_DANO_MIN + rnd() * (VARIACAO_DANO_MAX - VARIACAO_DANO_MIN);
      const rA = scoreA(mA, vA);
      const rB = scoreB(mB, vB);
      if (rA > rB) vitA++;
      else if (rA === rB) vitA += 0.5;
    }
    pctA = vitA / amostras;
    pctB = 1 - pctA;
  }

  let pctMinA = pctA;
  let pctMaxA = pctA;
  if (rAmin > rBmax) { pctMinA = 1; pctMaxA = 1; }
  else if (rAmax < rBmin) { pctMinA = 0; pctMaxA = 0; }
  else {
    pctMinA = Math.min(pctA, rAmin / (rAmin + rBmax));
    pctMaxA = Math.max(pctA, rAmax / (rAmax + rBmin));
  }

  const favorito = mA.rating >= mB.rating ? 'a' : 'b';
  return {
    a: mA,
    b: mB,
    poderA: Math.max(1, Math.round(mA.rating / GINASIO_ESCALA_FORCA)),
    poderB: Math.max(1, Math.round(mB.rating / GINASIO_ESCALA_FORCA)),
    pctA,
    pctB,
    pctMinA: Math.max(0, Math.min(1, pctMinA)),
    pctMaxA: Math.max(0, Math.min(1, pctMaxA)),
    favorito,
    empate: espelho || Math.abs(mA.rating - mB.rating) / Math.max(mA.rating, mB.rating, 1) < 0.015,
  };
}

/**
 * A escala do número que aparece na tela.
 *
 * O rating bruto vai de ~3×10⁸ (o pior pokémon possível) a ~2,6×10¹² (um shiny P5 de IV
 * máximo), porque ele multiplica três stats e o ×3 do shiny vira ×27. Dividir por 10⁷ traz
 * isso para dezenas até centenas de milhares, que é a faixa em que o resto do jogo já
 * conversa — e mantém as PARCELAS SOMANDO: o número do time é a soma dos números dos
 * pokémon, sem transformação no meio, senão a tela mostraria 3 + 4 = 9.
 */
export const GINASIO_ESCALA_FORCA = 1e7;

/** A força de UM pokémon no ginásio, do jeito que a tela mostra. */
export const poderNoGinasio = (pk, esp = null) =>
  esp ? Math.max(1, Math.round(ratingDeCombate(pk, esp) / GINASIO_ESCALA_FORCA)) : 1;

/** A força do TIME: a soma das forças. É isso que ordena o pódio. */
export const poderDoTimeGinasio = (pokemons, esps = null) =>
  (pokemons ?? []).reduce(
    (s, pk) => s + poderNoGinasio(pk, esps?.get?.(pk?.speciesId) ?? null),
    0,
  );

/**
 * Por que este pokémon não pode entrar NESTE time, ou `null` se pode.
 *
 * `escolhidos` são os que já estão no time (objetos com `id`, `speciesId`, `tipos`).
 * Os códigos são chaves de i18n do cliente e mensagem de erro do servidor.
 */
export function motivoForaDoGinasio(pk, tipo, escolhidos = []) {
  if (!pk) return 'sumiu';
  if (!pokemonDoTipo(pk.tipos, tipo)) return 'tipo';
  // A ESPÉCIE é a chave, não o id: um Charizard e um Charizard shiny são o mesmo Charizard
  // para o ginásio. Foi pedido assim de propósito — sem isso, o pódio de FIRE seria a lista
  // de quem tem cinco cópias do mesmo pokémon bom, e não de quem montou um time.
  if (escolhidos.some((o) => o && o.id !== pk.id && o.speciesId === pk.speciesId)) return 'especie';
  if (escolhidos.some((o) => o && o.id === pk.id)) return 'repetido';
  if (escolhidos.length >= GINASIO_TIME_MAX) return 'cheio';
  return null;
}

/**
 * Filtra uma lista de pokémon para o que de fato VALE neste ginásio, na ordem em que veio.
 *
 * É a mesma passada que o servidor usa para gravar e para pontuar, e é o que segura o caso
 * chato: o Charmander registrado em FIRE evoluiu para Charizard e virou espécie repetida do
 * Charizard que já estava lá. Em vez de invalidar o time inteiro (ou exigir uma faxina em
 * segundo plano), o segundo simplesmente para de contar — o jogador vê o slot vazio e
 * arruma quando quiser.
 */
export function timeValidoDoGinasio(pokemons, tipo) {
  const ok = [];
  for (const pk of pokemons ?? []) {
    if (!motivoForaDoGinasio(pk, tipo, ok)) ok.push(pk);
  }
  return ok;
}

/** O time que o jogador MANDOU serve? Devolve `{ ok, motivo }` — o servidor recusa por aqui. */
export function validarTimeGinasio(pokemons, tipo) {
  if (!tipoDeGinasio(tipo)) return { ok: false, motivo: 'tipo' };
  const lista = pokemons ?? [];
  if (lista.length > GINASIO_TIME_MAX) return { ok: false, motivo: 'cheio' };
  const ok = [];
  for (const pk of lista) {
    const motivo = motivoForaDoGinasio(pk, tipo, ok);
    if (motivo) return { ok: false, motivo };
    ok.push(pk);
  }
  return { ok: true, motivo: null };
}

/**
 * O multiplicador de dano do LÍDER: ×1,25 se o pokémon que está batendo for de um tipo cujo
 * ginásio o dono lidera, ×1 caso contrário.
 *
 * Vale para o pokémon TODO, e não para o golpe: quem lidera FIRE bate 25% mais forte com o
 * Charizard, use ele Flamethrower ou Investida. Foi pedido assim, e é o que faz o prêmio ser
 * sentido — um bônus por tipo de golpe seria um bônus por moveset, e um Charizard bom bate de
 * FIRE menos vezes do que se imagina.
 *
 * Dupla tipagem casa com QUALQUER um dos dois ginásios, mas o bônus não empilha: liderar
 * FIRE e FLYING não dá 56% ao Charizard, dá os mesmos 25%. Dois títulos já valem por si —
 * empilhar transformaria o pokémon de tipo duplo no único que vale a pena ter.
 */
export function multBuffGinasio(tiposPokemon, tiposLiderados) {
  if (!tiposLiderados || !tiposPokemon?.length) return 1;
  const tem = tiposLiderados instanceof Set
    ? (x) => tiposLiderados.has(x)
    : (x) => tiposLiderados.includes(x);
  for (const tipo of tiposPokemon) {
    if (tem(String(tipo).toUpperCase())) return GINASIO_BUFF_MULT;
  }
  return 1;
}
