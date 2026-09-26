// Teste dos BOSSES — só aritmética, não precisa de servidor no ar.
//
//   node tools/teste-bosses.mjs
import {
  BOSSES,
  BOSS_EQUIPE_IDEAL,
  BOSS_PENALIDADE_BASE,
  bossesCatalogo,
  penalidadeDeEquipe,
  montarBoss,
  rolarDropsDeBoss,
  rolarBossTokenSelvagem,
  CHANCE_BOSS_TOKEN_SELVAGEM,
} from '../src/server/game/bosses.mjs';
import { nivelMinimoDoPar, chanceTmDoPar, BOSS_DEX_MAX } from '../src/shared/bosses-lendarios.mjs';
import { especies, itens } from '../src/server/content.mjs';
import { PIECE_AOE, PIECE_ELEMENTAL } from '../src/server/game/tm.mjs';
import { FRAGMENTO_MEGA_ID, FRAGMENTO_MEGA_SHINY_ID } from '../src/server/game/mega.mjs';

let falhas = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALHA'} ${msg}`);
  if (!cond) falhas++;
};

// ------------------------------------------- penalidade de equipe

const referencia = { members: 1, strength: 0.04, deficit: 4.96, mult: 233.41 };
const p = penalidadeDeEquipe([{ level: 11 }], 300);

ok(p.membros === referencia.members, `membros = ${referencia.members} (${p.membros})`);
ok(p.forca.toFixed(2) === referencia.strength.toFixed(2), `força arredondada = ${referencia.strength} (${p.forca})`);
ok(p.deficit.toFixed(2) === referencia.deficit.toFixed(2), `déficit arredondado = ${referencia.deficit} (${p.deficit})`);
ok(p.mult === referencia.mult, `mult = ${referencia.mult} (${p.mult})`);
ok(BOSS_EQUIPE_IDEAL === 5, 'o alvo é 5 pokémon');
ok(BOSS_PENALIDADE_BASE === 3, 'a base do expoente é 3');

const cinco = Array.from({ length: 5 }, () => ({ level: 300 }));
ok(penalidadeDeEquipe(cinco, 300).mult === 1, 'cinco no nível do boss → mult 1');

// ------------------------------------------- escala de nível e drops

ok(nivelMinimoDoPar(0) === 300, 'par 0 → nv 300');
ok(nivelMinimoDoPar(1) === 650, 'par 1 → nv 650');
ok(nivelMinimoDoPar(2) === 3100, 'par 2 → nv 3100 (300+350×8)');
ok(chanceTmDoPar(0) === 0.005, 'par 0 → 0,5% TM');
ok(chanceTmDoPar(1) === 0.01, 'par 1 → 1% TM');
ok(chanceTmDoPar(2) === 0.015, 'par 2 → 1,5% TM');

const lista = Object.values(BOSSES);
ok(lista.length === 25, `25 bosses lendários até dex ${BOSS_DEX_MAX} (${lista.length})`);
ok(bossesCatalogo.length === lista.length, 'galeria bate com as fichas jogáveis');
ok(
  lista.every((b) => bossesCatalogo.some((c) => c.key === b.key)),
  'todo boss jogável está na galeria',
);

const primeiro = lista[0];
const segundo = lista[1];
ok(primeiro.teamLevel === 300 && segundo.teamLevel === 300, 'primeiro par no nv 300');
ok(primeiro.level === 300 && segundo.level === 300, 'nível de combate = nível de entrada (não o dobro)');
ok(
  lista.every((b) => b.level === b.teamLevel),
  'nível do boss = teamLevel em todos',
);
ok(primeiro.drops[0].itemId === PIECE_ELEMENTAL, '1º boss dropa TM Disk Piece');
ok(segundo.drops[0].itemId === PIECE_AOE, '2º boss dropa AoE TM Disk Piece');
ok(primeiro.drops[0].chance === 0.005, '1º par → 0,5% de drop');
ok(segundo.drops[0].chance === 0.005, '1º par (2º boss) → 0,5% de drop');

const terceiro = lista[2];
ok(terceiro.teamLevel === 650, '2º par começa no nv 650');
ok(terceiro.drops[0].chance === 0.01, '2º par → 1% de drop');

ok(lista.every((b) => b.arena === `boss_${b.key}`), 'cada boss tem arena própria (mapa por tipo)');
ok(lista.every((b) => b.mapaFonte), 'cada boss tem hunt-fonte de mapa');
ok(lista.every((b) => b.neutro === true), 'todos neutros');
// Três drops por boss desde a v1.146: a peça de TM (elemental ou AoE, alternando por par) e
// os DOIS fragmentos de Mega Stone (comum e shiny), que não alternam — ver `game/mega.mjs`.
ok(lista.every((b) => b.drops.length === 3), 'peça de TM + os dois fragmentos de Mega');
ok(
  lista.every((b) => b.drops[1].itemId === FRAGMENTO_MEGA_ID && b.drops[2].itemId === FRAGMENTO_MEGA_SHINY_ID),
  'todo boss dropa os dois fragmentos de Mega',
);
ok(primeiro.drops[1].chance === 0.005, '1º par → 0,5% de Fragmento de Mega Stone');
ok(primeiro.drops[2].chance === 0.0025, '1º par → 0,25% de Fragmento de Mega Shiny Stone');
ok(terceiro.drops[1].chance === 0.01, '2º par → 1% de Fragmento de Mega Stone');
ok(terceiro.drops[2].chance === 0.005, '2º par → 0,5% de Fragmento de Mega Shiny Stone');
ok(
  lista.every((b) => b.drops[2].chance === b.drops[1].chance / 2),
  'o fragmento shiny é sempre metade do comum',
);
ok(
  lista.every((b) => itens.has(b.drops[0].itemId)),
  'toda peça de TM existe no catálogo',
);

const mob = montarBoss(primeiro);
ok(mob.tipos.length === 0, 'montado sem tipo');
ok(mob.maxHp > 50_000, `HP de lendário (${mob.maxHp.toLocaleString('pt-BR')})`);
ok(mob.fixo === true, 'boss fixo na arena');
ok(mob.looktype === primeiro.looktype, 'usa looktype da espécie');

ok(rolarBossTokenSelvagem(0, 'kanto') === null, 'token só na Outland');
let tokenHits = 0;
for (let i = 0; i < 80_000; i++) if (rolarBossTokenSelvagem(0, 'outland')) tokenHits++;
const pctToken = (tokenHits / 80_000) * 100;
ok(Math.abs(pctToken - CHANCE_BOSS_TOKEN_SELVAGEM * 100) < 0.08, `drop Outland ~0,05% (${pctToken.toFixed(3)}%)`);

// Amostragem de drop TM no primeiro boss
const N = 40_000;
let pecas = 0;
for (let i = 0; i < N; i++) {
  for (const d of rolarDropsDeBoss(primeiro)) {
    if (d.itemId === PIECE_ELEMENTAL) pecas++;
  }
}
const pct = (pecas / N) * 100;
ok(Math.abs(pct - 0.5) < 0.15, `${N.toLocaleString('pt-BR')} vitórias: TM ~${pct.toFixed(2)}% (ficha: 0,5%)`);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
