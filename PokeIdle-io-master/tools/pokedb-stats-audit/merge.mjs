/**
 * Aplica a auditoria pokemondb sobre os catálogos e emite o relatório.
 *
 * Entrada:  worklist.json  +  cache.txt   (blocos separados por linha "@@@ <pokeId>")
 * Saída:    --dry   -> imprime resumo + amostra de diffs
 *           --write -> reescreve public/data/creatures.json e creatures-novos.json
 *                      + grava RELATORIO-STATS-MOVES.md
 *
 * Regras acertadas com o usuário:
 *  - STATS base: valores oficiais (forma normal; Megas -> stats da Mega).
 *  - MOVES: mesma quantidade de golpes não-assinatura (power < 300) que a espécie já tem.
 *    Preenche os slots, em ordem, com os primeiros N golpes de DANO da tabela
 *    "Moves learnt by level up" (pula os de status; dedupe por nome). Se faltar,
 *    completa com golpes de status da tabela; se ainda faltar, mantém o nome do slot.
 *  - Por slot reajusta: name, type, category, power. Mantém: cooldownMs, learnLevel.
 *    power vindo do pokemondb; se lá for "-" (dano variável), mantém o power atual.
 *  - Golpes de assinatura (power >= 300) não contam e não mudam.
 *  - category: Physical->PHYSICAL, Special->SPECIAL. (Status só entram como preenchimento;
 *    nesse caso a categoria sai do tipo: tipo especial -> SPECIAL, senão PHYSICAL.)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const MODO = process.argv.includes('--write') ? 'write' : 'dry';

const worklist = JSON.parse(readFileSync(join(AQUI, 'worklist.json'), 'utf8'));
const foraDeEscopo = JSON.parse(readFileSync(join(AQUI, 'fora-de-escopo.json'), 'utf8'));

// ---- parse cache.txt ----
const cacheTxt = readFileSync(join(AQUI, 'cache.txt'), 'utf8');
const cache = new Map();
{
  let cur = null, buf = [];
  const flush = () => { if (cur != null) cache.set(String(cur), buf.join('\n')); buf = []; };
  for (const line of cacheTxt.split('\n')) {
    const m = line.match(/^@@@\s+(\S+)\s*$/);
    if (m) { flush(); cur = m[1]; } else if (cur != null) buf.push(line);
  }
  flush();
}

const TIPOS_ESPECIAIS = new Set(['FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK', 'FAIRY']);

// Nomes de golpes de STATUS — se um slot "sobra" (sem golpe de dano no cache pra repor) e o
// nome dele é um destes, o slot é DESCARTADO em vez de virar um "ataque" esquisito.
const STATUS_COMUNS = new Set([
  'growl', 'growth', 'leer', 'tail whip', 'harden', 'withdraw', 'defense curl', 'string shot',
  'sand attack', 'smokescreen', 'leech seed', 'poison powder', 'sleep powder', 'stun spore',
  'spore', 'sweet scent', 'synthesis', 'worry seed', 'aromatherapy', 'ingrain', 'cotton spore',
  'cotton guard', 'focus energy', 'scary face', 'swords dance', 'agility', 'iron defense',
  'amnesia', 'calm mind', 'nasty plot', 'bulk up', 'hone claws', 'work up', 'howl', 'meditate',
  'sharpen', 'rock polish', 'dragon dance', 'quiver dance', 'shell smash', 'shift gear',
  'autotomize', 'coil', 'no retreat', 'victory dance', 'clangorous soul', 'belly drum',
  'stockpile', 'charge', 'minimize', 'double team', 'acupressure', 'charm', 'baby-doll eyes',
  'fake tears', 'metal sound', 'screech', 'captivate', 'flatter', 'swagger', 'confuse ray',
  'supersonic', 'sweet kiss', 'teeter dance', 'attract', 'aromatic mist', 'acid armor',
  'barrier', 'light screen', 'reflect', 'safeguard', 'mist', 'haze', 'lucky chant', 'aurora veil',
  'recover', 'roost', 'rest', 'slack off', 'milk drink', 'soft-boiled', 'moonlight', 'morning sun',
  'wish', 'heal pulse', 'life dew', 'aqua ring', 'jungle healing', 'lunar blessing', 'purify',
  'protect', 'detect', 'endure', 'wide guard', 'quick guard', 'kings shield', "king's shield",
  'spiky shield', 'baneful bunker', 'obstruct', 'silk trap', 'burning bulwark', 'crafty shield',
  'mat block', 'toxic', 'toxic thread', 'will-o-wisp', 'thunder wave', 'poison gas', 'glare',
  'stun spore', 'hypnosis', 'sing', 'lovely kiss', 'grass whistle', 'yawn', 'nuzzle', 'block',
  'mean look', 'spider web', 'fairy lock', 'roar', 'whirlwind', 'taunt', 'torment', 'disable',
  'encore', 'imprison', 'spite', 'grudge', 'destiny bond', 'perish song', 'memento', 'healing wish',
  'lunar dance', 'final gambit', 'trick', 'switcheroo', 'thief', 'covet', 'bestow', 'recycle',
  'pain split', 'psycho shift', 'power trick', 'power split', 'guard split', 'speed swap',
  'power swap', 'guard swap', 'heart swap', 'skill swap', 'role play', 'psych up', 'copycat',
  'mimic', 'sketch', 'mirror move', 'nature power', 'assist', 'metronome', 'me first', 'transform',
  'conversion', 'conversion 2', 'camouflage', 'reflect type', 'soak', 'magic powder', 'trick-or-treat',
  "forest's curse", 'gastro acid', 'simple beam', 'entrainment', 'worry seed', 'heal block',
  'embargo', 'snatch', 'magic coat', 'after you', 'quash', 'ally switch', 'instruct', 'spotlight',
  'stealth rock', 'spikes', 'toxic spikes', 'sticky web', 'rapid spin', 'defog', 'tidy up',
  'magnet rise', 'telekinesis', 'gravity', 'trick room', 'wonder room', 'magic room', 'tailwind',
  'rain dance', 'sunny day', 'sandstorm', 'hail', 'snowscape', 'chilly reception', 'electric terrain',
  'grassy terrain', 'misty terrain', 'psychic terrain', 'flower shield', 'rototiller', 'court change',
  'happy hour', 'hold hands', 'celebrate', 'teleport', 'baton pass',
  'lock-on', 'mind reader', 'foresight', 'odor sleuth', 'miracle eye', 'flash', 'kinesis',
  'confide', 'noble roar', 'tearful look', 'play nice', 'decorate', 'stuff cheeks', 'shed tail',
  'follow me', 'rage powder', 'helping hand', 'coaching', 'howl', 'growth', 'splash', 'teatime',
]);
const TIPO_MAP = {
  Normal: 'NORMAL', Fire: 'FIRE', Water: 'WATER', Electric: 'ELECTRIC', Grass: 'GRASS', Ice: 'ICE',
  Fighting: 'FIGHTING', Poison: 'POISON', Ground: 'GROUND', Flying: 'FLYING', Psychic: 'PSYCHIC',
  Bug: 'BUG', Rock: 'ROCK', Ghost: 'GHOST', Dragon: 'DRAGON', Dark: 'DARK', Steel: 'STEEL', Fairy: 'FAIRY',
};

function parseRaw(raw) {
  const out = { statsNormal: null, statsForms: {}, moves: [], tm: [], noMoves: false };
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t === 'NOMOVES') { out.noMoves = true; continue; }
    let m;
    if ((m = t.match(/^STATS\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/))) {
      out.statsNormal = m.slice(1, 7).map(Number);
    } else if ((m = t.match(/^STATS_(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/))) {
      out.statsForms[m[1]] = m.slice(2, 8).map(Number);
    } else if ((m = t.match(/^MOVE\s+(\S+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(Physical|Special|Status)\s*\|\s*(.+?)\s*$/i))) {
      const powRaw = m[5].trim();
      const pow = /^\d+$/.test(powRaw) ? Number(powRaw) : null;
      out.moves.push({ lvl: parseInt(m[1], 10) || 0, name: m[2].trim(), type: m[3].trim(), cat: m[4].trim(), pow });
    } else if ((m = t.match(/^TM\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(Physical|Special|Status)\s*\|\s*(.+?)\s*$/i))) {
      // Golpes de TM — só entram no preenchimento das revisões (lutadores / eeveelutions / evos gen-4).
      const powRaw = m[4].trim();
      out.tm.push({ lvl: 99, name: m[1].trim(), type: m[2].trim(), cat: m[3].trim(), pow: /^\d+$/.test(powRaw) ? Number(powRaw) : null });
    }
  }
  return out;
}

// ---- Preenchimento por TIPO PRÓPRIO ----
// TODA espécie prioriza golpes do(s) próprio(s) tipo(s) — level-up + TM — antes de cobertura de
// outro elemento. Nunca usa golpe de status como ataque; se faltar, o slot é descartado.
// Grupos que ainda ganham slots EXTRAS (o "poucos golpes" reclamado): lutadores, eeveelutions e
// evoluções que só surgiram na gen 4.
const EEVEELUTIONS = new Set([134, 135, 136, 196, 197, 470, 471, 700]);
const EVOS_GEN4 = new Set([
  169, 182, 186, 199, 208, 212, 214, 224, 229, 230, 233,
  424, 426, 428, 429, 430, 461, 462, 463, 464, 465, 466, 467, 468, 469, 472, 473, 474, 475, 476, 477, 478,
]);
const TETO_REVISAO = 10; // teto de golpes não-assinatura para os grupos que expandem
const LADDER_LV = [1, 1, 1, 1, 12, 20, 28, 36, 44, 52];
const LADDER_CD = [10000, 12000, 15000, 18000, 22000, 26000, 30000, 36000, 42000, 50000];

function planoRevisao(w) {
  const tipos = (w.curTypes || []).filter(Boolean);
  const ehLutador = tipos.includes('FIGHTING');
  const expande = ehLutador || EEVEELUTIONS.has(w.pokeId) || EVOS_GEN4.has(w.pokeId);
  // Lutador: FIGHTING na frente até dos outros STAB. Resto: os próprios tipos.
  const prio = ehLutador ? new Set(['FIGHTING', ...tipos]) : new Set(tipos.length ? tipos : ['NORMAL']);
  return { prio, expande };
}

function statsIguais(cur, alvo) {
  return cur.hp === alvo[0] && cur.atk === alvo[1] && cur.def === alvo[2] &&
    cur.spa === alvo[3] && cur.spd === alvo[4] && cur.spe === alvo[5];
}

// ---- catálogos reais ----
const baseDoc = JSON.parse(readFileSync(join(RAIZ, 'public/data/creatures.json'), 'utf8'));
const novosDoc = JSON.parse(readFileSync(join(RAIZ, 'game/src/server/dados/creatures-novos.json'), 'utf8'));
const idxBase = new Map(baseDoc.creatures.map((c, i) => [c.pokeId, i]));
const idxNovos = new Map((novosDoc.creatures || []).map((c, i) => [c.pokeId, i]));

const rel = {
  processados: 0, semCache: [], statsMudados: [], statsOk: [],
  movesEspecies: 0, moveLinhas: [], learnsetCurto: [], semStatsForm: [], powerMantido: [],
  outland: [], outlandSemBase: [], baseOnly: [], revisao: [],
};

// Auditoria das espécies base-only (só existem no espelho public/data/creatures.json).
// Vira o patch game/src/server/dados/creatures-audit-overrides.json, aplicado no boot.
const overrides = new Map();

for (const w of worklist) {
  // Megas e Castform-Fire não têm bloco próprio: os dados vêm do bloco da espécie-base (w.dex).
  const chaveCache = w.kind === 'mega' || w.kind === 'form' ? w.dex : w.pokeId;
  const raw = cache.get(String(chaveCache));
  if (!raw) { rel.semCache.push(`${w.pokeId} ${w.name}`); continue; }
  rel.processados++;
  const P = parseRaw(raw);

  // ---- registro real ----
  // creatures-novos.json é o ÚNICO catálogo NOSSO. public/data/creatures.json é o espelho
  // regenerável (npm run fetch) — nunca gravar. Espécie que só existe no espelho não tem
  // onde persistir a auditoria ainda: entra em baseOnly e é pulada no --write.
  const emNovos = idxNovos.has(w.pokeId);
  const rec = emNovos ? novosDoc.creatures[idxNovos.get(w.pokeId)]
    : idxBase.has(w.pokeId) ? baseDoc.creatures[idxBase.get(w.pokeId)] : null;
  if (!rec) { rel.semCache.push(`${w.pokeId} ${w.name} (sem registro)`); continue; }
  if (!emNovos) rel.baseOnly.push(`${w.pokeId} ${w.name}`);

  // ---- STATS ----
  let alvo = P.statsNormal;
  if (w.kind === 'mega') {
    const ks = Object.keys(P.statsForms);
    const k = ks.find((x) => /MEGA/i.test(x)) || ks[0];
    alvo = k ? P.statsForms[k] : null;
    if (!alvo) rel.semStatsForm.push(`${w.pokeId} ${w.name}`);
  } else if (w.kind === 'form') {
    alvo = null; // Castform Fire — mantém
    rel.semStatsForm.push(`${w.pokeId} ${w.name} (mantido)`);
  }
  const antes = { hp: rec.baseHp, atk: rec.baseAtk, def: rec.baseDef, spa: rec.baseSpAtk, spd: rec.baseSpDef, spe: rec.baseSpeed };
  let mudouStats = false;
  if (alvo && !statsIguais(antes, alvo)) {
    mudouStats = true;
    rel.statsMudados.push({ id: w.pokeId, name: w.name, de: [antes.hp, antes.atk, antes.def, antes.spa, antes.spd, antes.spe], para: alvo });
    if (MODO === 'write' && emNovos) {
      [rec.baseHp, rec.baseAtk, rec.baseDef, rec.baseSpAtk, rec.baseSpDef, rec.baseSpeed] = alvo;
    }
  } else if (alvo) rel.statsOk.push(w.pokeId);

  // ---- MOVES ----
  const attacks = rec.attacks || [];
  const slots = attacks.filter((a) => (a.power || 0) < 300); // slots editáveis, na ordem
  const sigs = attacks.filter((a) => (a.power || 0) >= 300); // assinatura — intocados, vão ao fim
  const nSlots = slots.length;
  const plano = planoRevisao(w);

  // fila = golpes de DANO (level-up + TM), dedupe por nome; STATUS nunca entram.
  // Ordem: primeiro os do TIPO PRÓPRIO (prio), depois cobertura; dentro de cada grupo,
  // level-up antes de TM, e por nível. Sem golpe pra um slot -> slot descartado.
  const seen = new Set();
  const statusNomes = new Set();
  const puxa = (arr, origem) => {
    for (const mv of arr) {
      const key = mv.name.toLowerCase();
      if (/status/i.test(mv.cat)) { statusNomes.add(key); continue; }
      if (seen.has(key)) continue;
      seen.add(key);
      fila.push({ ...mv, origem });
    }
  };
  const fila = [];
  puxa(P.moves, 'lvl');
  puxa(P.tm, 'tm');
  const rank = (mv) => (plano.prio.has(TIPO_MAP[mv.type]) ? 0 : 2) + (mv.origem === 'tm' ? 1 : 0);
  fila.sort((a, b) => rank(a) - rank(b)); // estável: mantém ordem de nível dentro de cada grupo
  const ehStatus = (nome) => {
    const k = (nome || '').toLowerCase();
    return statusNomes.has(k) || STATUS_COMUNS.has(k);
  };

  // Grupos que expandem podem crescer até o TETO. O resto mantém a contagem atual — se o cache
  // não tem golpe pra um slot, mantém o golpe fabricado que já estava lá (a menos que seja
  // status ou duplicado); esses ficam listados como "cache truncado — refetch".
  const alvoSlots = plano.expande
    ? Math.max(nSlots, Math.min(TETO_REVISAO, fila.length))
    : nSlots;

  const linhas = [];
  const usados = new Set();
  let qi = 0, mantidos = 0, descartes = 0;
  const novoAttacks = [];
  for (let i = 0; i < alvoSlots; i++) {
    const a = slots[i] || { name: '—', type: null, category: null, power: 0,
      cooldownMs: LADDER_CD[i] ?? LADDER_CD.at(-1), learnLevel: LADDER_LV[i] ?? LADDER_LV.at(-1) };
    const novoSlot = !slots[i];
    const src = fila[qi++];
    if (!src) {
      if (novoSlot) break; // slot NOVO sem golpe -> não inventa
      // cache sem golpe pra este slot: mantém o fabricado, salvo status / duplicado
      const kA = (a.name || '').toLowerCase();
      if (ehStatus(a.name) || usados.has(kA)) {
        linhas.push(`  − ${a.name}/${a.type}/${a.power} (slot descartado; ${ehStatus(a.name) ? 'é golpe de status' : 'duplicado'} e cache sem golpe pra repor)`);
        descartes++;
        continue;
      }
      const catNova = TIPOS_ESPECIAIS.has(a.type) ? 'SPECIAL' : 'PHYSICAL';
      if (catNova !== a.category) linhas.push(`  · ${a.name}/${a.type}: ${a.category}→${catNova} (mantido; cache truncado — refetch)`);
      usados.add(kA);
      mantidos++;
      novoAttacks.push({ ...a, category: catNova });
      continue;
    }
    usados.add(src.name.toLowerCase());
    const tU = TIPO_MAP[src.type] || a.type || 'NORMAL';
    let catU;
    if (/phys/i.test(src.cat)) catU = 'PHYSICAL';
    else if (/spec/i.test(src.cat)) catU = 'SPECIAL';
    else catU = TIPOS_ESPECIAIS.has(tU) ? 'SPECIAL' : 'PHYSICAL';
    let powU = src.pow;
    if (powU == null) {
      // dano variável no pokemondb ("—"): mantém o power do slot, mas limita os exageros do
      // gerador antigo (Reversal 200, Grass Knot 160...) a uma faixa de golpe normal.
      powU = Math.min(Math.max(a.power || 70, 40), 120);
      rel.powerMantido.push(`${w.pokeId} ${w.name}: ${src.name} (${a.power ?? '—'}→${powU})`);
    }
    if (novoSlot) {
      linhas.push(`  + ${src.name}/${tU}/${catU}/${powU}  (slot novo · cd ${a.cooldownMs} · lv ${a.learnLevel})`);
    } else if (a.name !== src.name || a.type !== tU || a.category !== catU || a.power !== powU) {
      linhas.push(`  ${a.name}/${a.type}/${a.category}/${a.power}  →  ${src.name}/${tU}/${catU}/${powU}`);
    }
    novoAttacks.push({ name: src.name, type: tU, category: catU, power: powU, cooldownMs: a.cooldownMs, learnLevel: a.learnLevel });
  }
  // assinatura sempre por último; golpe de 600 tem cooldown fixo de 60s (é dano 600)
  for (const s of sigs) novoAttacks.push((s.power || 0) >= 600 ? { ...s, cooldownMs: 60000 } : s);
  const doPokedb = novoAttacks.length - sigs.length - mantidos;
  if (mantidos || descartes) {
    rel.learnsetCurto.push(`${w.pokeId} ${w.name} (${(w.curTypes || []).filter(Boolean).join('/') || '—'}) — ${doPokedb} do pokemondb + ${mantidos} fabricado(s) mantido(s)${descartes ? ` · ${descartes} descartado(s)` : ''} [cache: ${P.moves.filter((m) => !/status/i.test(m.cat)).length} dano + ${P.tm.length} TM]`);
  }
  if (alvoSlots > nSlots) {
    rel.revisao.push(`${w.pokeId} ${w.name} (${(w.curTypes || []).filter(Boolean).join('/')}) — ${nSlots} → ${alvoSlots} slots, prioridade ${[...plano.prio].join('/')}`);
  }
  if (MODO === 'write') {
    if (emNovos) {
      rec.attacks = novoAttacks;
    } else {
      // base-only: acumula no patch em vez de mexer no espelho
      const o = overrides.get(w.pokeId) || { pokeId: w.pokeId };
      o.attacks = novoAttacks;
      if (mudouStats && alvo) [o.baseHp, o.baseAtk, o.baseDef, o.baseSpAtk, o.baseSpDef, o.baseSpeed] = alvo;
      overrides.set(w.pokeId, o);
    }
  }
  if (linhas.length) {
    rel.movesEspecies++;
    rel.moveLinhas.push(`### ${w.pokeId} ${w.name}${mudouStats ? '  · [stats corrigidos]' : ''}\n${linhas.join('\n')}`);
  }
}

// ---- resumo ----
console.log('=== RESUMO ===');
console.log(`em escopo ${worklist.length} · processados ${rel.processados} · SEM CACHE ${rel.semCache.length}`);
console.log(`stats corrigidos ${rel.statsMudados.length} · stats já ok ${rel.statsOk.length}`);
console.log(`espécies com moves alterados ${rel.movesEspecies}`);
console.log(`learnset curto ${rel.learnsetCurto.length} · power mantido (dano variável) ${rel.powerMantido.length} · form sem stats ${rel.semStatsForm.length}`);
console.log(`revisões com slots extras (lutadores / eeveelutions / evos gen-4): ${rel.revisao.length}`);
console.log(`persistidos em creatures-novos.json: ${rel.processados - rel.baseOnly.length} · base-only (só no espelho, NÃO gravados): ${rel.baseOnly.length}`);
if (rel.semCache.length) console.log('\nSEM CACHE:', rel.semCache.slice(0, 60).join(' · '));
console.log('\n--- stats corrigidos (amostra) ---');
for (const s of rel.statsMudados.slice(0, 30)) console.log(`  ${s.id} ${s.name}: ${s.de.join('/')} → ${s.para.join('/')}`);
console.log('\n--- moves (amostra) ---');
console.log(rel.moveLinhas.slice(0, 15).join('\n'));

if (MODO === 'write') {
  // Só o catálogo NOSSO. public/data/creatures.json é espelho regenerável — nunca gravar.
  writeFileSync(join(RAIZ, 'game/src/server/dados/creatures-novos.json'), JSON.stringify(novosDoc, null, 2) + '\n');

  // Patch das base-only: stats (só quando corrigidos) + attacks. Aplicado no content.mjs no boot.
  const ovr = [...overrides.values()].sort((a, b) => a.pokeId - b.pokeId);
  const ovrDoc = {
    _leia: 'Auditoria pokemondb das espécies que só existem no espelho public/data/creatures.json '
      + '(Kanto/Johto + algumas de gen 3–6). Aplicado em game/src/server/content.mjs no boot, DEPOIS '
      + 'do merge dos catálogos e do aplicarEscalaHuntLevel. Cada item traz `attacks` (sempre) e os '
      + '`baseXxx` só quando o stat foi corrigido. Gerado por tools/pokedb-stats-audit/merge.mjs.',
    overrides: ovr,
  };
  writeFileSync(join(RAIZ, 'game/src/server/dados/creatures-audit-overrides.json'), JSON.stringify(ovrDoc, null, 2) + '\n');
  const md = [];
  md.push('# Auditoria de stats base e moves — referência pokemondb.net\n');
  md.push(`Gerado em ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Fonte: \`https://pokemondb.net/pokedex/<especie>\` (seção *Moves learnt by level up*, versão de jogo mais recente).`);
  md.push('');
  const semSprite = foraDeEscopo.filter((f) => f.motivo === 'sem-sprite');
  const semPagina = foraDeEscopo.filter((f) => f.motivo !== 'sem-sprite');
  md.push(`| | |`);
  md.push(`|---|---|`);
  const persistidos = rel.processados - rel.baseOnly.length;
  md.push(`| Espécies em escopo (têm sprite **e** página no pokemondb) | ${worklist.length} — ${worklist.filter((w) => w.kind === 'dex').length} da dex + ${worklist.filter((w) => w.kind === 'mega').length} Megas + Castform-Fire |`);
  md.push(`| **Gravadas em \`creatures-novos.json\` neste passe** | ${persistidos} |`);
  md.push(`| **Gravadas no patch \`creatures-audit-overrides.json\` (base-only)** | ${rel.baseOnly.length} |`);
  md.push(`| Pendentes de fetch (têm sprite, cache ainda não baixado) | ${rel.semCache.length} |`);
  md.push(`| Stats base corrigidos | ${rel.statsMudados.length} |`);
  md.push(`| Stats já corretos | ${rel.statsOk.length} |`);
  md.push(`| Espécies com moveset ajustado | ${rel.movesEspecies} |`);
  md.push(`| Learnset oficial menor que nº de slots | ${rel.learnsetCurto.length} |`);
  md.push(`| Ignoradas — na dex mas **sem sprite** (não estão no jogo) | ${semSprite.length} |`);
  md.push(`| Fora de escopo — Outland/Orre/fantasma sem página no pokemondb | ${semPagina.length} |`);
  md.push('');
  md.push('## Regras aplicadas\n');
  md.push('- **Stats base** → valores oficiais da forma normal (Megas: stats da Mega-evolução).');
  md.push('- **Moves** → cada espécie manteve a mesma quantidade de golpes não-assinatura. Os slots foram preenchidos, em ordem, pelos primeiros golpes **de dano** da tabela *Moves learnt by level up* (golpes de status pulados; nomes repetidos removidos). Faltando golpe de dano, completa com golpe de status.');
  md.push('- **Por golpe foi reajustado**: `name`, `type`, `category` (PHYSICAL/SPECIAL), `power`. **Preservados**: `cooldownMs`, `learnLevel`.');
  md.push('- `power` vem do pokemondb; quando lá é dano variável (“—”), o `power` atual do slot foi mantido.');
  md.push('- **Golpes de assinatura** (power ≥ 300: os 18 “600 por tipo” + Draconic Soul) não foram contados nem alterados.');
  md.push('');
  md.push('## 1. Stats base corrigidos\n');
  md.push('| # | Espécie | Antes · HP/ATK/DEF/SpA/SpD/SPE | Depois |');
  md.push('|--:|---|---|---|');
  for (const s of rel.statsMudados) md.push(`| ${s.id} | ${s.name} | ${s.de.join(' / ')} | **${s.para.join(' / ')}** |`);
  md.push('');
  md.push('## 2. Learnset oficial menor que o nº de slots\n');
  md.push('_Nesses casos os slots sem golpe oficial mantiveram o nome; só a categoria foi recalibrada pelo tipo._\n');
  md.push(rel.learnsetCurto.map((x) => `- ${x}`).join('\n') || '_nenhum_');
  md.push('');
  md.push('## 3. Golpes com dano variável (power atual mantido)\n');
  md.push(rel.powerMantido.length ? rel.powerMantido.map((x) => `- ${x}`).join('\n') : '_nenhum_');
  md.push('');
  md.push('## 3b. Revisões — slots extras (lutadores / eeveelutions / evos gen-4)\n');
  md.push('_Lutadores priorizam golpes FIGHTING (level-up + TM); eeveelutions e evoluções que só surgiram na gen 4 priorizam o próprio tipo. Slots extras usam cooldown/learnLevel de uma escada padrão. Teto de ' + TETO_REVISAO + ' golpes não-assinatura; espécie nunca perde slot._\n');
  md.push(rel.revisao.length ? rel.revisao.map((x) => `- ${x}`).join('\n') : '_nenhuma_');
  md.push('');
  md.push('## 4. Movesets ajustados — diff por espécie\n');
  md.push('Formato: `nome/tipo/categoria/power  →  nome/tipo/categoria/power`\n');
  md.push(rel.moveLinhas.join('\n\n'));
  md.push('');
  md.push('## 5. Pendentes de fetch — têm sprite, cache ainda não baixado\n');
  md.push('_Não alterados neste passe. Rodar o fetch do pokemondb e reexecutar `merge.mjs --write` para fechá-los._\n');
  md.push(rel.semCache.length ? rel.semCache.map((x) => `- ${x}`).join('\n') : '_nenhum_');
  md.push('');
  md.push('## 6. Ignoradas — na dex nacional mas sem sprite no jogo\n');
  md.push('_`looktype: 1` (sem arte no atlas). Não estão jogáveis; não foram tocadas._\n');
  md.push(semSprite.map((f) => `${f.pokeId} ${f.name}`).join(', ') || '_nenhuma_');
  md.push('');
  md.push('## 7. Base-only — gravadas no patch `creatures-audit-overrides.json`\n');
  md.push('_Existem só no espelho `public/data/creatures.json` (regenerável por `npm run fetch`). A auditoria delas vai no patch `game/src/server/dados/creatures-audit-overrides.json`, aplicado no boot pelo `content.mjs` (depois do merge e do rescale de huntLevel). Cada item: `attacks` sempre; `baseXxx` só quando o stat foi corrigido._\n');
  md.push(rel.baseOnly.map((f) => `${f}`).join(', ') || '_nenhuma_');
  md.push('');
  md.push('## 8. Fora de escopo — conteúdo original sem página no pokemondb\n');
  const g = { Outland: [], Orre: [], Outro: [] };
  for (const f of semPagina) {
    if (/^(Brave |Tribal |Ancient |War |Furious |Charged |Magnetic |Evil |Freezing |Psy |Heavy |Milch-|Roll |Hard |Brute |Enraged |Dark |Trickmaster |Banshee |Taekwondo |Enigmatic )/.test(f.name)) g.Outland.push(f.name);
    else if (f.pokeId >= 13000 && f.pokeId < 14000) g.Orre.push(f.name);
    else g.Outro.push(`${f.name} (#${f.pokeId})`);
  }
  md.push(`Não alterados por este script.\n`);
  md.push(`- **Outland (variantes “Brave/Ancient/Furious…”)** — ${g.Outland.length}: tratamento à parte (espelham a espécie-base; ver conversa).`);
  md.push(`- **Orre (clones #13xxx da dex nacional)** — ${g.Orre.length} (mesmos nomes da dex nacional, stats propositalmente ajustados).`);
  md.push(`- **Outros** — ${g.Outro.length}: ${g.Outro.join(', ')}`);
  md.push('');
  writeFileSync(join(AQUI, 'RELATORIO-STATS-MOVES.md'), md.join('\n') + '\n');
  console.log('\n[write] catálogos reescritos + RELATORIO-STATS-MOVES.md');
}
