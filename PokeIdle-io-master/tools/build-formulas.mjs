// Consolida as fórmulas e constantes do jogo em public/data/index/formulas.json.
//
// TUDO aqui foi extraído do bundle público do cliente (o módulo de matemática compartilhado,
// que exporta totalXpForLevel / levelProgress / typeEffectiveness / computeStats / computePower /
// rollQuality / rollGrowthSet / rollShinyGrowthSet / combatHp) e do texto de ajuda embutido no
// i18n, que documenta as mesmas fórmulas em português/inglês. Cada bloco abaixo diz de onde veio.
//
// As constantes de pokébola, pokédex, clã, breeding e battle pass vieram de uma leitura
// autenticada (só GET) feita uma vez em 30/07/2026 nos endpoints /api/game/*. São catálogos
// estáticos do jogo, não dados de conta.
//
// O que NÃO está aqui, porque é resolvido no servidor e não trafega para o cliente:
//   · a fórmula de dano por golpe;
//   · o limiar exato do medidor de investimento das capturas normais;
//   · a chance-base de shiny por tier (o servidor manda `shinyBase` já pronto por encontro).
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT } from './lib.mjs';

// ---------------------------------------------------------------------------
// 1. Tabela de tipos — cópia literal do objeto `m` do bundle.
//    typeEffectiveness(atq, def1, def2) = (m[atq][def1] ?? 1) * (def2 && def2!==def1 ? m[atq][def2] ?? 1 : 1)
// ---------------------------------------------------------------------------
const TIPOS = {
  NORMAL: { ROCK: 0.5, GHOST: 0, STEEL: 0.5 },
  FIRE: { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 2, BUG: 2, ROCK: 0.5, DRAGON: 0.5, STEEL: 2 },
  WATER: { FIRE: 2, WATER: 0.5, GRASS: 0.5, GROUND: 2, ROCK: 2, DRAGON: 0.5 },
  ELECTRIC: { WATER: 2, ELECTRIC: 0.5, GRASS: 0.5, GROUND: 0, FLYING: 2, DRAGON: 0.5 },
  GRASS: { FIRE: 0.5, WATER: 2, GRASS: 0.5, POISON: 0.5, GROUND: 2, FLYING: 0.5, BUG: 0.5, ROCK: 2, DRAGON: 0.5, STEEL: 0.5 },
  ICE: { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 0.5, GROUND: 2, FLYING: 2, DRAGON: 2, STEEL: 0.5 },
  FIGHTING: { NORMAL: 2, ICE: 2, POISON: 0.5, FLYING: 0.5, PSYCHIC: 0.5, BUG: 0.5, ROCK: 2, GHOST: 0, DARK: 2, STEEL: 2, FAIRY: 0.5 },
  POISON: { GRASS: 2, POISON: 0.5, GROUND: 0.5, ROCK: 0.5, GHOST: 0.5, STEEL: 0, FAIRY: 2 },
  GROUND: { FIRE: 2, ELECTRIC: 2, GRASS: 0.5, POISON: 2, FLYING: 0, BUG: 0.5, ROCK: 2, STEEL: 2 },
  FLYING: { ELECTRIC: 0.5, GRASS: 2, FIGHTING: 2, BUG: 2, ROCK: 0.5, STEEL: 0.5 },
  PSYCHIC: { FIGHTING: 2, POISON: 2, PSYCHIC: 0.5, DARK: 0, STEEL: 0.5 },
  BUG: { FIRE: 0.5, GRASS: 2, FIGHTING: 0.5, POISON: 0.5, FLYING: 0.5, PSYCHIC: 2, GHOST: 0.5, DARK: 2, STEEL: 0.5, FAIRY: 0.5 },
  ROCK: { FIRE: 2, ICE: 2, FIGHTING: 0.5, GROUND: 0.5, FLYING: 2, BUG: 2, STEEL: 0.5 },
  GHOST: { NORMAL: 0, PSYCHIC: 2, GHOST: 2, DARK: 0.5 },
  DRAGON: { DRAGON: 2, STEEL: 0.5, FAIRY: 0 },
  DARK: { FIGHTING: 0.5, PSYCHIC: 2, GHOST: 2, DARK: 0.5, FAIRY: 0.5 },
  STEEL: { FIRE: 0.5, WATER: 0.5, ELECTRIC: 0.5, ICE: 2, ROCK: 2, STEEL: 0.5, FAIRY: 2 },
  FAIRY: { FIRE: 0.5, FIGHTING: 2, POISON: 0.5, DRAGON: 2, DARK: 2, STEEL: 0.5 },
};

// Mesmo tipo atacando/defendendo = neutro (×1). O chart copiado do bundle original
// marcava diagonal como resistência (×0,5) ou super (Ghost/Dragon ×2); aqui não.
for (const t of Object.keys(TIPOS)) delete TIPOS[t][t];

const NOMES = Object.keys(TIPOS);

const efetividade = (atq, d1, d2) => {
  const a = atq;
  const linha = TIPOS[a] ?? {};
  const vs = (def) => (def === a ? 1 : linha[def] ?? 1);
  let v = vs(d1);
  if (d2 && d2 !== d1) v *= vs(d2);
  return v;
};

// Na hunt a vantagem elemental é "+50% mais pronunciada, nos dois sentidos":
// ×1.5→1.75, ×2→2.5, ×4→5.5 e resistências dividem por 1.5 (×0.5→0.33). ×0 e ×1 não mudam.
const amplificar = (v) => (v === 0 || v === 1 ? v : v > 1 ? 1 + (v - 1) * 1.5 : v / 1.5);

// ---------------------------------------------------------------------------
// 2. Curva de XP — função `g` do bundle, confirmada pelo texto de ajuda:
//    "Total XP for level L = round( 50/3 × (L³ − 6L² + 17L − 12) )"
// ---------------------------------------------------------------------------
const xpTotal = (L) => (L <= 1 ? 0 : Math.round((50 / 3) * (L ** 3 - 6 * L ** 2 + 17 * L - 12)));

// ---------------------------------------------------------------------------
// 3. Qualidade e crescimento (IV) — array `a` e funções n/o/l/u/h/c/d/p do bundle.
// ---------------------------------------------------------------------------
const BANDAS_QUALIDADE = [
  { min: 0.8, max: 0.9, chance: 5 },
  { min: 0.9, max: 1.0, chance: 5 },
  { min: 1.0, max: 1.1, chance: 34.03846 },
  { min: 1.1, max: 1.2, chance: 20 },
  { min: 1.2, max: 1.3, chance: 10 },
  { min: 1.3, max: 1.4, chance: 10 },
  { min: 1.4, max: 1.5, chance: 10 },
  { min: 1.5, max: 1.6, chance: 5 },
  { min: 1.7, max: 1.8, chance: 0.67308 },
  { min: 1.8, max: 1.8, chance: 0.28846 },
];

const ROTULOS_QUALIDADE = [
  { min: 4, label: 'Divina' },
  { min: 3, label: 'Anciã' },
  { min: 2, label: 'Mítica' },
  { min: 1.7, label: 'Lendária' },
  { min: 1.5, label: 'Épica' },
  { min: 1.3, label: 'Rara' },
  { min: 1.1, label: 'Incomum' },
  { min: 1, label: 'Comum' },
  { min: 0, label: 'Fraca' },
];

// expoente da qualidade por stat, do objeto `s` do bundle
const EXPOENTE_QUALIDADE = { hp: 0.95, atk: 0.8, def: 0.8, spAtk: 0.8, spDef: 0.8, speed: 0.95 };

// ---------------------------------------------------------------------------
// 4. Modificadores de combate e progressão — do texto de ajuda do jogo.
// ---------------------------------------------------------------------------
const COMBATE = {
  wildHp: { valor: 5, nota: 'HP do selvagem na hunt = ×5 do normal' },
  wildDano: { valor: 1.8, nota: 'dano do selvagem = ×1.8 por golpe' },
  vantagemElemental: { valor: 1.5, nota: '+50% mais pronunciada nos dois sentidos' },
  combatHp: 'combatHp(hp, ehJogador) = max(24, round(hp × (ehJogador ? 7 : 12)))',
  inicial: '100 Small Potions e 100 Poké Balls para todo jogador novo',
};

const BOOSTS = [
  { nome: 'XP Boost', efeito: '+50% de XP do treinador' },
  { nome: 'Pokémon XP Boost', efeito: '+50% de XP do pokémon' },
  { nome: 'Loot Boost', efeito: '+40% de chance de loot' },
  { nome: 'Capture Boost', efeito: 'dobra a chance de captura (multiplica a chance por arremesso)' },
  { nome: 'Shiny Secret Lure', efeito: 'dobra a chance de shiny aparecer na hunt' },
];

// Catálogo de pokébolas — de /api/game/balls. `catchRate` é a "eficiência de captura ×N"
// que o cliente exibe; o próprio cliente trata catchRate >= 255 como captura garantida.
const BOLAS = [
  { id: 1, nome: 'Poké Ball', catchRate: 1, priceGold: 5, compravel: true },
  { id: 2, nome: 'Great Ball', catchRate: 2, priceGold: 20, compravel: true },
  { id: 3, nome: 'Super Ball', catchRate: 3, priceGold: 50, compravel: true },
  { id: 4, nome: 'Ultra Ball', catchRate: 4, priceGold: 130, compravel: true },
];
// A Idle (6) e a Master (5) existem no jogo original mas ficaram DE FORA daqui: a Idle é
// recompensa de um sistema que não temos, e a Master captura garantido, o que anula a
// mecânica inteira. Os ids seguem reservados — não reaproveite para outra bola.

const CAPTURA = {
  shiny: 'chance = min(1, shinyBase × catchRate_da_bola) — shinyBase vem do servidor por encontro, fixo por tier',
  normal:
    'medidor de investimento por espécie: cada arremesso soma, e o painel /api/game/used-balls ' +
    'acompanha attempts, balls por tipo e goldSpent contra o `price` da espécie. O limiar exato é server-side.',
  garantida: 'catchRate ≥ 255 (Master Ball) captura garantido',
  boost: 'Capture Boost dobra a chance por arremesso',
  pokedex: 'desbloquear a espécie na pokédex (100 kills) também dá um captureBonus por espécie',
  porHunt: 'cada hunt tem um catchChance próprio em /api/game/hunt-config?slug=',
};

const PROGRESSAO = {
  xpPorKill: 'cada espécie dá um XP fixo (campo `experience`), para o TREINADOR e para o pokémon ativo — dois níveis independentes',
  semCap: 'não há nível máximo: a curva é infinita, só fica mais cara',
  pokedex: '+25% de XP por espécie, bônus único depois de 100 kills daquela espécie',
  streak: { kills: 1000, porPonto: '+0.1% em UMA trilha (EXP, Loot ou Shiny)', custo: '25.000 × número do ponto' },
  clans: { entrada: 80, maxRank: 5, bonusPorRank: [6, 12, 18, 24, 30], niveisRank: [90, 100, 110, 120] },
  breeding: { desbloqueio: 60, maxSlots: 6, custoProximoSlot: 30 },
  battlePass: { maxTier: 30, premiumPreco: 15, missoes: 155 },
  pokedexTotal: 323,
  shinyCards: { killsPorCard: 15000, killsVariante: 30000, nota: 'variantes Outland dropam o card da espécie base, mas exigem o dobro' },
  shiny: {
    encontro: '1 em 8.000 por encontro (1 em 4.000 com Shiny Secret Lure); sorteado no nascimento do selvagem',
    captura: 'chance fixa por tier × força da pokébola — o medidor de investimento das capturas normais NÃO se aplica',
    exibicao: 'a barra de captura mostra min(1, shinyBase × catchRate_da_bola), com shinyBase vindo do servidor por encontro',
    naoEvolui: 'shiny não evolui — o brilho pertence à forma capturada',
  },
  qualidadeUltra: 'Mítica/Anciã/Divina (2.0+) não saem de captura selvagem (teto 1.8) — só shiny e reprodução',
};

// ---------------------------------------------------------------------------

const ler = async (rel) => JSON.parse(await readFile(join(OUT, rel), 'utf8'));
const { creatures } = await ler('creatures.json');
const spawns = await ler('index/spawns-index.json');

let shinyCatalogo = [];
try {
  shinyCatalogo = (await ler('world/all-pokes.json')).entries ?? [];
} catch {
  console.log('  (world/all-pokes.json ausente — rode node tools/fetch-world.mjs)');
}

// matriz completa 18×18, normal e amplificada
const matriz = {};
for (const atq of NOMES) {
  matriz[atq] = {};
  for (const def of NOMES) {
    const v = efetividade(atq, def, null);
    matriz[atq][def] = { normal: v, hunt: +amplificar(v).toFixed(4) };
  }
}

// marcos finitos de "zerar o jogo", medidos em kills (a única unidade exata que temos)
const especies = creatures.length;
const comHunt = Object.keys(spawns.porPokemon).length;
const comCard = shinyCatalogo.length;

const marcos = {
  capturarTodos: { alvo: especies, comHuntSelvagem: comHunt, semHunt: especies - comHunt },
  pokedexCompleta: { killsPorEspecie: 100, total: especies * 100 },
  todosShinyCards: { especies: comCard, killsPorEspecie: 15000, total: comCard * 15000 },
  nivelMaximo: null, // não existe
};

const amostraCurva = [1, 10, 25, 50, 80, 100, 120, 150, 200, 300, 500, 1000].map((L) => ({
  nivel: L,
  xpTotal: xpTotal(L),
  custoDoNivel: xpTotal(L) - xpTotal(L - 1),
}));

const xps = creatures.map((c) => c.experience).filter(Boolean).sort((a, b) => a - b);

await mkdir(join(OUT, 'index'), { recursive: true });
const dados = {
  gerado: new Date().toISOString(),
  fonte: 'bundle público do cliente + texto de ajuda do i18n de poke.idleworld.online',
  xp: {
    formula: 'xpTotal(L) = round( 50/3 × (L³ − 6L² + 17L − 12) ), 0 para L ≤ 1',
    semCap: true,
    amostra: amostraCurva,
    porKill: { min: xps[0], mediana: xps[Math.floor(xps.length / 2)], max: xps.at(-1) },
  },
  tipos: { lista: NOMES, tabela: TIPOS, matriz, amplificacaoHunt: 1.5 },
  qualidade: { bandas: BANDAS_QUALIDADE, rotulos: ROTULOS_QUALIDADE, expoentePorStat: EXPOENTE_QUALIDADE },
  crescimento: { min: 1, max: 32, porStat: 6, shiny: 'rerola até a soma dos 6 IVs passar de 110 (até 512 tentativas)' },
  stats: {
    stat: 'stat = round( (base + 2×growth) × nivel/100 × qualidade^expoente )',
    power: 'score = 25% IV + 25% qualidade + 25% potência + 25% shiny; power = round(nivel × 10 × score)',
  },
  combate: COMBATE,
  boosts: BOOSTS,
  bolas: BOLAS,
  captura: CAPTURA,
  progressao: PROGRESSAO,
  marcos,
  shinyCatalogo,
  naoDisponivel: [
    'fórmula de dano por golpe (resolvida no servidor)',
    'limiar do medidor de investimento das capturas normais (server-side)',
    'chance-base de shiny por tier (o servidor manda shinyBase pronto por encontro)',
  ],
};

await writeFile(join(OUT, 'index/formulas.json'), JSON.stringify(dados));
console.log(`  index/formulas.json          ${(JSON.stringify(dados).length / 1024).toFixed(0)} KB`);
console.log(`
  tabela de tipos      ${NOMES.length}×${NOMES.length}
  bandas de qualidade  ${BANDAS_QUALIDADE.length} (soma ${BANDAS_QUALIDADE.reduce((s, b) => s + b.chance, 0).toFixed(5)}%)
  espécies             ${especies} (${comHunt} com hunt selvagem)
  espécies com card    ${comCard}
  kills p/ todos cards ${(comCard * 15000).toLocaleString('pt-BR')}`);
