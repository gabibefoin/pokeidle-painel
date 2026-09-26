/**
 * Baixa e faz o parse das tabelas de golpes do pokemondb.net direto (sem resumo de IA).
 *
 *   node tools/pokedb-stats-audit/fetch-cache.mjs                 # tudo que falta em cache-scraped.txt
 *   node tools/pokedb-stats-audit/fetch-cache.mjs --only=3,65,248 # só esses pokeId
 *   node tools/pokedb-stats-audit/fetch-cache.mjs --force         # rebaixa tudo
 *
 * Saída: cache-scraped.txt (blocos "@@@ <pokeId>" com STATS + MOVE + linhas "TM |").
 * Depois: `node merge.mjs` já lê cache.txt; para valer, concatene:
 *   cat cache-scraped.txt >> cache.txt   (blocos novos vencem: o parser usa o último)
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const OUT = join(AQUI, 'cache-scraped.txt');
const worklist = JSON.parse(readFileSync(join(AQUI, 'worklist.json'), 'utf8'));

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const only = argv.find((a) => a.startsWith('--only='))?.slice(7).split(',').map(Number);

// jogos preferidos, do mais completo pro mais novo (nomes como aparecem no <p> do painel)
const PREF_JOGOS = ['Scarlet & Violet', 'Sword & Shield', 'Brilliant Diamond', 'Legends: Z-A', 'Legends: Arceus'];

const UA = 'Mozilla/5.0 (compatible; pokeidle-audit/1.0; balanceamento de fangame)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&eacute;/g, 'é')
  .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

function pegarStats(html) {
  const out = {};
  for (const chave of ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed']) {
    const re = new RegExp(`<th>${chave.replace('.', '\\.')}</th>\\s*<td class="cell-num">(\\d+)</td>`);
    const m = html.match(re);
    out[chave] = m ? Number(m[1]) : null;
  }
  return [out.HP, out.Attack, out.Defense, out['Sp. Atk'], out['Sp. Def'], out.Speed];
}

/** Painéis de golpes por JOGO: { jogo, bloco }. Cada painel é `id="tab-moves-NN"` (NN só dígitos). */
function painesDeGolpe(html) {
  const dm = html.indexOf('id="dex-moves"');
  const escopo = dm >= 0 ? html.slice(dm) : html;
  const marca = [...escopo.matchAll(/id="tab-moves-(\d+)"/g)];
  const paineis = [];
  if (!marca.length) {
    const jogo = (escopo.match(/moves in Pok[eé]mon ([^<.]+?)(?: at the levels| when| via|\.)/) || [])[1];
    return [{ jogo: jogo ? decode(jogo) : '?', bloco: escopo }];
  }
  for (let i = 0; i < marca.length; i++) {
    const ini = marca[i].index;
    const fim = i + 1 < marca.length ? marca[i + 1].index : escopo.length;
    const bloco = escopo.slice(ini, fim);
    const jogo = (bloco.match(/moves in Pok[eé]mon ([^<.]+?)(?: at the levels| when| via|\.)/) || [])[1];
    paineis.push({ jogo: jogo ? decode(jogo) : '?', bloco });
  }
  return paineis;
}

function parseTabela(bloco, titulo) {
  const h = bloco.indexOf(titulo);
  if (h < 0) return [];
  const tbOpen = bloco.indexOf('<tbody>', h);
  const tbClose = bloco.indexOf('</tbody>', tbOpen);
  // se antes do <tbody> aparecer "does not learn"/"cannot be taught", não há tabela
  const meio = bloco.slice(h, tbOpen < 0 ? h + 400 : tbOpen);
  if (/does not learn|cannot be taught|no moves/i.test(meio) || tbOpen < 0) return [];
  const linhas = bloco.slice(tbOpen, tbClose).split('<tr>').slice(1);
  const out = [];
  for (const ln of linhas) {
    const nums = [...ln.matchAll(/<td class="cell-num"[^>]*>([^<]*)<\/td>/g)].map((x) => x[1].trim());
    const nome = (ln.match(/class="ent-name"[^>]*>([^<]+)</) || [])[1];
    const tipo = (ln.match(/class="type-icon type-([a-z]+)"/) || [])[1];
    const cat = (ln.match(/data-sort-value="(physical|special|status)"/) || [])[1];
    if (!nome || !tipo || !cat) continue;
    // colunas: [Lv, Power, Acc] em level-up; [TM#, Power, Acc] em TM. Power é o penúltimo.
    const power = nums.length >= 2 ? nums[nums.length - 2] : '-';
    const lvl = /Lv|level/i.test(titulo === 'x' ? '' : titulo) ? nums[0] : '1';
    out.push({
      lvl: /^\d+$/.test(nums[0]) ? nums[0] : '1',
      name: decode(nome),
      type: tipo[0].toUpperCase() + tipo.slice(1),
      cat: cat[0].toUpperCase() + cat.slice(1),
      power: /^\d+$/.test(power) ? power : '-',
    });
  }
  return out;
}

function blocoDe(pokeId, stats, lvl, tm) {
  const L = [`@@@ ${pokeId}`, `STATS ${stats.join(' ')}`];
  for (const mv of lvl) L.push(`MOVE ${mv.lvl} | ${mv.name} | ${mv.type} | ${mv.cat} | ${mv.power}`);
  L.push('--- TM ---');
  for (const mv of tm) L.push(`TM | ${mv.name} | ${mv.type} | ${mv.cat} | ${mv.power}`);
  return L.join('\n');
}

async function uma(w) {
  const url = `https://pokemondb.net/pokedex/${w.slug}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  const stats = pegarStats(html);
  const paineis = painesDeGolpe(html);
  // Painel PRINCIPAL (pra ordem de nível): o jogo mais recente/completo com level-up.
  let principal = null;
  for (const pref of PREF_JOGOS) {
    const p = paineis.find((x) => x.jogo.includes(pref) && parseTabela(x.bloco, 'Moves learnt by level up').length);
    if (p) { principal = p; break; }
  }
  principal ||= paineis.find((x) => parseTabela(x.bloco, 'Moves learnt by level up').length) || paineis[0];

  // UNIÃO de todos os jogos: level-up guia a ordem; TM só engorda a lista de golpes reais.
  const lvlSeen = new Set();
  const lvl = [];
  for (const mv of principal ? parseTabela(principal.bloco, 'Moves learnt by level up') : []) {
    lvl.push(mv); lvlSeen.add(mv.name.toLowerCase());
  }
  for (const p of paineis) {
    if (p === principal) continue;
    for (const mv of parseTabela(p.bloco, 'Moves learnt by level up')) {
      if (!lvlSeen.has(mv.name.toLowerCase())) { lvlSeen.add(mv.name.toLowerCase()); lvl.push({ ...mv, lvl: '99' }); }
    }
  }
  const tmSeen = new Set();
  const tm = [];
  for (const p of paineis) {
    for (const titulo of ['Moves learnt by TM', 'Moves learnt by TR', 'Move Tutor moves', 'Moves learnt by tutoring']) {
      for (const mv of parseTabela(p.bloco, titulo)) {
        const k = mv.name.toLowerCase();
        if (lvlSeen.has(k) || tmSeen.has(k)) continue;
        tmSeen.add(k);
        tm.push(mv);
      }
    }
  }
  return { bloco: blocoDe(w.pokeId, stats, lvl, tm), jogo: principal?.jogo, nLvl: lvl.length, nTm: tm.length };
}

// ---- fila ----
let feitos = new Set();
if (existsSync(OUT) && !FORCE) {
  feitos = new Set([...readFileSync(OUT, 'utf8').matchAll(/^@@@ (\d+)/gm)].map((m) => Number(m[1])));
}
if (FORCE && existsSync(OUT)) writeFileSync(OUT, '');

let alvo = worklist.filter((w) => w.kind === 'dex');
if (only) alvo = alvo.filter((w) => only.includes(w.pokeId));
alvo = alvo.filter((w) => !feitos.has(w.pokeId));

console.log(`a baixar: ${alvo.length} (já feitos: ${feitos.size})`);
let ok = 0, erros = [];
for (const w of alvo) {
  try {
    const { bloco, jogo, nLvl, nTm } = await uma(w);
    appendFileSync(OUT, bloco + '\n');
    ok++;
    if (ok % 25 === 0 || nLvl === 0) console.log(`  ${w.pokeId} ${w.name} [${jogo}] lvl=${nLvl} tm=${nTm}  (${ok}/${alvo.length})`);
  } catch (e) {
    erros.push(`${w.pokeId} ${w.name}: ${e.message}`);
  }
  await sleep(350);
}
console.log(`\nOK ${ok} · erros ${erros.length}`);
for (const e of erros.slice(0, 40)) console.log('  ' + e);
