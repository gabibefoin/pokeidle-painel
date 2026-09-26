// O laço da coleção e da Pokédex do delta de estado (`estadoParaEnviar`, em sim.mjs) sai IGUAL ao de
// antes, envio a envio.
//
//     node tools/teste-estado-laco.mjs
//
// O que mudou: a varredura que procura pokémon (e espécie) que SAIU só roda quando sobra lembrança —
// antes ela rodava a todo envio, com um `Set` montado só para isso. As duas versões estão copiadas
// aqui e rodam sobre o mesmo jogador (151 pokémon, 200 espécies) e a mesma sequência sorteada de
// mudanças: XP da equipe a cada envio, HP, stat, pokémon entrando e saindo, espécie nova e apagada,
// data de captura. A cada envio, `mudados`, `fora`, `dexMud` e `dexFora` têm de sair com o mesmo JSON.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lembrarDaTela, igualATela } from '../src/server/tela-igual.mjs';

let testes = 0;
let falhas = 0;
const ok = (cond, nome, detalhe = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};

function prng(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = prng(20260914);
const int = (n) => Math.floor(rnd() * n);

let proxId = 1;
function novoPk() {
  return {
    id: proxId++, speciesId: 1 + int(500), nome: ['Pikachu', 'Nidoran♀', 'Pokémon'][int(3)], looktype: int(3000),
    lookShiny: rnd() < 0.2 ? int(3000) : null, tipos: rnd() < 0.5 ? ['fire'] : ['water', 'ice'], level: 1 + int(300),
    xp: int(1e8), quality: Math.round(rnd() * 100) / 100, potencia: 1 + int(5), shiny: rnd() < 0.1,
    slot: null, hp: int(500), maxHp: 500, poder: int(99999), nota: rnd() < 0.5 ? 'A' : null,
    stats: { hp: int(900), atk: int(900), def: int(900), spAtk: int(900), spDef: int(900), speed: int(900) },
    ivs: { hp: int(32), atk: int(32), def: int(32), spAtk: int(32), spDef: int(32), speed: int(32) },
    refino: rnd() < 0.3 ? { atk: int(10) } : undefined, refinoTotal: int(20), tmAoe: rnd() < 0.1,
    caughtAt: new Date(1.7e12 + int(1e10)),
  };
}
/** O formato de `pokemonParaCliente` (as mesmas chaves, na mesma ordem). */
const paraCliente = (k) => ({
  id: k.id, speciesId: k.speciesId, nome: k.nome, looktype: k.looktype, lookShiny: k.lookShiny, tipos: k.tipos,
  level: k.level, xp: k.xp, xpNivel: k.level * 1000, xpProximo: (k.level + 1) * 1000, quality: k.quality,
  potencia: k.potencia, shiny: k.shiny, slot: k.slot, hp: k.hp, maxHp: k.maxHp, poder: k.poder, nota: k.nota,
  stats: k.stats, ivs: k.ivs, refino: k.refino ?? null, refinoTotal: k.refinoTotal ?? 0, tmElemental: k.tmElemental ?? null,
  tmAoe: !!k.tmAoe, heldItemId: k.heldItemId ?? null, starter: !!k.starter, caughtAt: k.caughtAt ?? null,
  pisoNivel: 5 + (k.speciesId % 40),
});

// ------------------------------------------------------------ as duas versões

function antes(p, tela) {
  const mudados = [];
  const vistos = new Set();
  for (const k of p.pokemons.values()) {
    vistos.add(k.id);
    const o = paraCliente(k);
    if (igualATela(tela.pk.get(k.id), o)) continue;
    tela.pk.set(k.id, lembrarDaTela(o));
    mudados.push(o);
  }
  const fora = [];
  for (const id of tela.pk.keys()) if (!vistos.has(id)) fora.push(id);
  for (const id of fora) tela.pk.delete(id);
  const dexMud = {};
  let temDex = false;
  const dexAtual = p.pokedex ?? {};
  for (const chave of Object.keys(dexAtual)) {
    if (igualATela(tela.dex.get(chave), dexAtual[chave])) continue;
    tela.dex.set(chave, lembrarDaTela(dexAtual[chave]));
    dexMud[chave] = dexAtual[chave];
    temDex = true;
  }
  const dexFora = [];
  for (const chave of tela.dex.keys()) if (!(chave in dexAtual)) dexFora.push(chave);
  for (const chave of dexFora) tela.dex.delete(chave);
  return { mudados, fora, dexMud: temDex ? dexMud : null, dexFora };
}

function agora(p, tela) {
  const mudados = [];
  for (const k of p.pokemons.values()) {
    const o = paraCliente(k);
    if (igualATela(tela.pk.get(k.id), o)) continue;
    tela.pk.set(k.id, lembrarDaTela(o));
    mudados.push(o);
  }
  const fora = [];
  if (tela.pk.size > p.pokemons.size) {
    const vistos = new Set();
    for (const k of p.pokemons.values()) vistos.add(k.id);
    for (const id of tela.pk.keys()) if (!vistos.has(id)) fora.push(id);
    for (const id of fora) tela.pk.delete(id);
  }
  const dexMud = {};
  let temDex = false;
  const dexAtual = p.pokedex ?? {};
  const chavesDex = Object.keys(dexAtual);
  for (const chave of chavesDex) {
    if (igualATela(tela.dex.get(chave), dexAtual[chave])) continue;
    tela.dex.set(chave, lembrarDaTela(dexAtual[chave]));
    dexMud[chave] = dexAtual[chave];
    temDex = true;
  }
  const dexFora = [];
  if (tela.dex.size > chavesDex.length) {
    for (const chave of tela.dex.keys()) if (!(chave in dexAtual)) dexFora.push(chave);
    for (const chave of dexFora) tela.dex.delete(chave);
  }
  return { mudados, fora, dexMud: temDex ? dexMud : null, dexFora };
}

// ------------------------------------------------------ jogador e mudanças

const base = { pokemons: new Map(), pokedex: {} };
for (let i = 0; i < 151; i++) {
  const k = novoPk();
  base.pokemons.set(k.id, k);
}
for (let s = 1; s <= 200; s++) {
  base.pokedex[String(s)] = { k: int(500), c: int(50) };
  if (rnd() < 0.3) base.pokedex[String(s)].sv = int(5);
}
const ENVIOS = 4000;
const ops = [];
for (let e = 0; e < ENVIOS; e++) {
  const lista = [];
  for (let j = 0; j < 6; j++) lista.push(['xp', int(151), 1 + int(999)]);
  if (rnd() < 0.1) lista.push(['hp', int(151), int(500)]);
  if (rnd() < 0.02) lista.push(['stat', int(151)]);
  if (rnd() < 0.03) lista.push(['entra', novoPk()]); // sorteado aqui, uma vez: os dois lados recebem o MESMO pokémon
  if (rnd() < 0.03) lista.push(['sai', int(151)]);
  if (rnd() < 0.005) lista.push(['saemTodos']);
  lista.push(['dex', 1 + int(230)]);
  if (rnd() < 0.01) lista.push(['dexSai', 1 + int(230)]);
  if (rnd() < 0.01) lista.push(['captura', int(151)]);
  ops.push(lista);
}
function aplicar(p, lista, ids) {
  for (const op of lista) {
    const vals = [...p.pokemons.values()];
    const k = vals.length ? vals[op[1] % vals.length] : null;
    switch (op[0]) {
      case 'xp': if (k) k.xp += op[2]; break;
      case 'hp': if (k) k.hp = op[2]; break;
      case 'stat': if (k) k.stats.atk += 1; break;
      case 'entra': { const n = { ...structuredClone(op[1]), id: ids.prox++ }; p.pokemons.set(n.id, n); break; }
      case 'sai': if (k) p.pokemons.delete(k.id); break;
      case 'saemTodos': for (const x of vals.slice(0, 20)) p.pokemons.delete(x.id); break;
      case 'dex': { const c = String(op[1]); if (p.pokedex[c]) p.pokedex[c].k++; else p.pokedex[c] = { k: 1, c: 0 }; break; }
      case 'dexSai': delete p.pokedex[String(op[1])]; break;
      case 'captura': if (k) k.caughtAt = new Date(k.caughtAt.getTime() + 1); break;
    }
  }
}

console.log('LAÇO DA COLEÇÃO E DA POKÉDEX NO DELTA DE ESTADO\n===============================================');

{
  console.log('\nEquivalência');
  const pA = structuredClone(base);
  const pB = structuredClone(base);
  const tA = { pk: new Map(), dex: new Map() };
  const tB = { pk: new Map(), dex: new Map() };
  const idsA = { prox: 1e6 };
  const idsB = { prox: 1e6 };
  let diferencas = 0;
  let exemplo = '';
  let comFora = 0;
  let comDexFora = 0;
  let reenviados = 0;
  for (let e = 0; e < ENVIOS; e++) {
    aplicar(pA, ops[e], idsA);
    aplicar(pB, ops[e], idsB);
    const a = antes(pA, tA);
    const b = agora(pB, tB);
    const ja = JSON.stringify(a);
    if (ja !== JSON.stringify(b)) {
      diferencas++;
      if (!exemplo) exemplo = `envio ${e}`;
    }
    if (a.fora.length) comFora++;
    if (a.dexFora.length) comDexFora++;
    reenviados += a.mudados.length;
  }
  ok(diferencas === 0, `${ENVIOS} envios: mudados, fora, dexMud e dexFora com o mesmo JSON`, exemplo);
  ok(comFora > 50 && comDexFora > 10, `a amostra exercita as saídas (${comFora} envios com pokémon saindo, ${comDexFora} com espécie saindo)`);
  ok(reenviados > ENVIOS, `e as mudanças de verdade (${reenviados} pokémon reenviados)`);
}

{
  console.log('\nNo código');
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
  const sim = readFileSync(join(raiz, 'src/server/sim.mjs'), 'utf8');
  ok(/if \(p\.telaPokemons\.size > p\.pokemons\.size\) \{/.test(sim), 'o sim só varre a coleção quando sobra lembrança');
  ok(/const chavesDex = Object\.keys\(dexAtual\);/.test(sim) && /if \(p\.telaDex\.size > chavesDex\.length\) \{/.test(sim),
    'e a Pokédex, pela mesma conta');
  ok(!/vistos\.add\(k\.id\);\s*\n\s*const o = pokemonParaCliente\(k\);/.test(sim), 'o `Set` de vistos não é mais montado a cada envio');
}

{
  console.log('\nTempo');
  function medir(fn) {
    const p = structuredClone(base);
    const t = { pk: new Map(), dex: new Map() };
    const ids = { prox: 1e6 };
    fn(p, t);
    let ms = 0;
    for (let e = 0; e < ENVIOS; e++) {
      aplicar(p, ops[e], ids);
      const t0 = performance.now();
      fn(p, t);
      ms += performance.now() - t0;
    }
    return ms;
  }
  medir(antes);
  medir(agora);
  const va = [];
  const vb = [];
  for (let r = 0; r < 5; r++) {
    va.push(medir(antes));
    vb.push(medir(agora));
  }
  const med = (v) => v.sort((x, y) => x - y)[2];
  console.log(`  ${ENVIOS} envios: antes ${med(va).toFixed(0)} ms · agora ${med(vb).toFixed(0)} ms · ${(((med(va) - med(vb)) / med(va)) * 100).toFixed(0)}% a menos`);
  ok(med(vb) < med(va) * 1.1, 'o laço novo não é mais lento');
}

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
