// A comparação sem serializar do delta de estado diz "igual" SÓ quando o texto JSON seria igual.
//
//     node tools/teste-tela-igual.mjs
//
// Gera centenas de milhares de pares (o que foi enviado, o que está agora) no formato de um pokémon
// na tela e de uma entrada da Pokédex, com mutações de todo tipo: um número, um texto, um stat, um
// IV, a lista de tipos, o refino que aparece/some, datas, chaves novas e sumidas, `undefined`,
// objetos fundos que a lembrança não sabe guardar, a mesma coisa com as chaves em outra ordem.
// Para cada par:
//
//   · se `igualATela` disse "igual", `JSON.stringify` dos dois tem de ser o MESMO texto — a garantia
//     de que o cliente recebe exatamente o que receberia com a comparação por texto de antes;
//   · se o texto é igual, conta quantas vezes a comparação disse "diferente" — reenvio que o texto
//     não faria. Tem de ser ~zero.
//
// Depois, a memória da lembrança contra o texto (45 mil pokémon) e o tempo de comparar uma coleção.
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

function pokemon() {
  return {
    id: 1000 + int(9000),
    speciesId: 1 + int(1200),
    nome: ['Pikachu', 'Ancient Dragonite', 'Magma Magcargo', 'Nidoran♀'][int(4)],
    looktype: int(3000),
    lookShiny: rnd() < 0.2 ? int(3000) : null,
    tipos: rnd() < 0.5 ? ['fire'] : ['water', 'ice'],
    level: 1 + int(300),
    xp: int(1e9),
    xpNivel: int(1e9),
    xpProximo: int(1e9),
    quality: Math.round(rnd() * 100) / 100,
    potencia: 1 + int(5),
    shiny: rnd() < 0.1,
    slot: rnd() < 0.3 ? int(5) : null,
    hp: int(500),
    maxHp: int(500),
    poder: int(99999),
    nota: rnd() < 0.5 ? 'A' : null,
    stats: { hp: int(900), atk: int(900), def: int(900), spAtk: int(900), spDef: int(900), speed: int(900) },
    ivs: { hp: int(32), atk: int(32), def: int(32), spAtk: int(32), spDef: int(32), speed: int(32) },
    refino: rnd() < 0.3 ? { atk: int(10), def: int(10) } : null,
    refinoTotal: int(20),
    tmElemental: rnd() < 0.2 ? 'fire' : null,
    tmAoe: rnd() < 0.2,
    heldItemId: rnd() < 0.2 ? 70090 : null,
    starter: rnd() < 0.05,
    caughtAt: rnd() < 0.5 ? new Date(1.7e12 + int(1e10)) : 1.7e12 + int(1e10),
    pisoNivel: int(100),
  };
}
const entradaDex = () => {
  const e = { k: int(500), c: int(50) };
  if (rnd() < 0.3) e.sv = int(5);
  if (rnd() < 0.2) e.sc = int(3);
  return e;
};

/** Uma cópia com UMA mutação sorteada — ou nenhuma (o caso comum na vida real). */
function mutar(v) {
  const o = structuredClone(v);
  const chaves = Object.keys(o);
  switch (int(17)) {
    case 0: return o; // sem mudança
    case 1: return o;
    case 2: { const k = chaves[int(chaves.length)]; if (typeof o[k] === 'number') o[k] += 1; return o; }
    case 3: if (o.stats) o.stats.atk += 1; else o.k = (o.k ?? 0) + 1; return o;
    case 4: if (o.ivs) o.ivs.speed = 31 - (o.ivs.speed % 31); return o;
    case 5: if (o.tipos) o.tipos = o.tipos.length === 1 ? ['fire', 'flying'] : ['water']; return o;
    case 6: if ('refino' in o) o.refino = o.refino ? null : { hp: 1 }; else o.sv = 9; return o;
    case 7: if (o.caughtAt instanceof Date) o.caughtAt = new Date(o.caughtAt.getTime() + 1); else o.caughtAt = new Date(5); return o;
    case 8: o.chaveNova = 'x'; return o;
    case 9: { delete o[chaves[int(chaves.length)]]; return o; }
    case 10: o[chaves[int(chaves.length)]] = undefined; return o; // some do JSON
    case 11: o.fundo = { a: { b: 1 } }; return o; // mais fundo que a lembrança
    case 12: if (o.stats) o.stats.extra = undefined; return o; // undefined aninhado: o JSON omite
    case 13: return Object.fromEntries(Object.entries(o).reverse()); // outra ordem: outro texto
    case 14: if (o.nome) o.nome += '\u0000'; else o.c = -0; return o;
    case 15: if (o.tipos) o.tipos = [...o.tipos]; return o; // array novo, mesmo conteúdo
    case 16: if (typeof o.caughtAt === 'number') o.caughtAt = new Date(o.caughtAt); return o; // número vira Date
    default: return o;
  }
}

console.log('COMPARAÇÃO SEM SERIALIZAR\n=========================');

for (const [nome, gerar, pares] of [['pokémon', pokemon, 150000], ['entrada da Pokédex', entradaDex, 100000]]) {
  console.log(`\n${nome}`);
  let perdidas = 0;
  let reenviosAToa = 0;
  let textosIguais = 0;
  let exemplo = '';
  for (let i = 0; i < pares; i++) {
    const enviado = gerar();
    const agora = mutar(enviado);
    const disse = igualATela(lembrarDaTela(enviado), agora);
    const mesmoTexto = JSON.stringify(enviado) === JSON.stringify(agora);
    if (mesmoTexto) textosIguais++;
    if (disse && !mesmoTexto) {
      perdidas++;
      if (!exemplo) exemplo = `${JSON.stringify(enviado)} → ${JSON.stringify(agora)}`;
    }
    if (!disse && mesmoTexto) reenviosAToa++;
  }
  ok(perdidas === 0, `${pares} pares: "igual" só quando o texto JSON é o mesmo`, exemplo);
  ok(reenviosAToa === 0, `nenhum reenvio que a comparação por texto não faria (${reenviosAToa} de ${textosIguais} textos iguais)`);
}

{
  console.log('\nCasos exatos');
  const p = pokemon();
  ok(igualATela(lembrarDaTela(p), structuredClone(p)), 'o mesmo pokémon, clonado, é igual');
  ok(!igualATela(lembrarDaTela(p), { ...p, hp: p.hp + 1 }), 'um HP a mais é diferente');
  ok(!igualATela(lembrarDaTela(p), { ...p, stats: { ...p.stats, def: p.stats.def + 1 } }), 'um stat aninhado a mais é diferente');
  ok(!igualATela(lembrarDaTela(p), { ...p, tipos: [...p.tipos, 'ghost'] }), 'um tipo a mais é diferente');
  ok(typeof lembrarDaTela({ a: { b: { c: 1 } } }) === 'string', 'objeto mais fundo que um nível é lembrado como texto');
  ok(!igualATela(lembrarDaTela({ a: { b: { c: 1 } } }), { a: { b: { c: 2 } } }), 'e o texto continua pegando a mudança funda');
  ok(!igualATela(undefined, p), 'sem lembrança, é diferente (o primeiro envio sempre sai)');
  ok(!igualATela(lembrarDaTela({ n: 1 }), { n: NaN }) && !igualATela(lembrarDaTela({ n: NaN }), { n: NaN }), 'NaN nunca passa como igual');
  ok(igualATela(lembrarDaTela({ d: new Date(5) }), { d: new Date(5) }) && !igualATela(lembrarDaTela({ d: new Date(5) }), { d: new Date(6) }),
    'Date compara pelo instante');
  ok(!igualATela(lembrarDaTela({ d: new Date(5) }), { d: 5 }) && !igualATela(lembrarDaTela({ d: 5 }), { d: new Date(5) }),
    'Date e número com o mesmo valor não se confundem');
  ok(!igualATela(lembrarDaTela({ a: 1, b: 2 }), { b: 2, a: 1 }), 'as mesmas chaves em outra ordem são outro texto: diferente');
}

{
  console.log('\nMemória (45 mil pokémon)');
  if (typeof globalThis.gc !== 'function') {
    console.log('  (rode com node --expose-gc para medir)');
  } else {
    const objs = Array.from({ length: 45000 }, pokemon).map((o) => ({ ...o, caughtAt: 1.7e12 }));
    const medir = (fn) => {
      globalThis.gc();
      const a = process.memoryUsage().heapUsed;
      const guardado = objs.map(fn);
      globalThis.gc();
      const b = process.memoryUsage().heapUsed;
      const bytes = (b - a) / objs.length;
      guardado.length = 0;
      return bytes;
    };
    const bTexto = medir((o) => JSON.stringify(o));
    const bLembranca = medir((o) => lembrarDaTela(o));
    console.log(`  texto ${bTexto.toFixed(0)} B por pokémon · lembrança ${bLembranca.toFixed(0)} B por pokémon`);
    ok(bLembranca <= bTexto * 1.15, 'a lembrança não gasta mais memória que o texto (margem de 15%)');
  }
}

{
  console.log('\nTempo (coleção de 200 pokémon, 2.000 envios, 1 mudança por envio)');
  // As duas medições partem do MESMO estado e recebem as MESMAS mudanças (HP que nunca repete).
  const base = Array.from({ length: 200 }, pokemon);
  const colecaoTexto = structuredClone(base);
  const colecaoCopia = structuredClone(base);
  const textos = colecaoTexto.map((k) => JSON.stringify(k));
  const lembrados = colecaoCopia.map(lembrarDaTela);
  let t = performance.now();
  let mud1 = 0;
  for (let envio = 0; envio < 2000; envio++) {
    colecaoTexto[envio % 200].hp = 1e6 + envio;
    for (let i = 0; i < 200; i++) {
      const tx = JSON.stringify(colecaoTexto[i]);
      if (tx !== textos[i]) { textos[i] = tx; mud1++; }
    }
  }
  const msTexto = performance.now() - t;
  t = performance.now();
  let mud2 = 0;
  for (let envio = 0; envio < 2000; envio++) {
    colecaoCopia[envio % 200].hp = 1e6 + envio;
    for (let i = 0; i < 200; i++) {
      if (!igualATela(lembrados[i], colecaoCopia[i])) { lembrados[i] = lembrarDaTela(colecaoCopia[i]); mud2++; }
    }
  }
  const msCopia = performance.now() - t;
  console.log(`  por texto ${msTexto.toFixed(0)} ms · por lembrança ${msCopia.toFixed(0)} ms · ${(msTexto / msCopia).toFixed(1)}×`);
  ok(mud1 === mud2, `as duas acham as mesmas ${mud2} mudanças`);
  ok(msCopia < msTexto, 'a lembrança é mais rápida que o texto');
}

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
