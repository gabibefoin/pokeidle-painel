/**
 * Estudo: como os drops se comportam em Kanto/Johto (dex 1–251), a referência do jogo.
 * Sai a pool por tipo e as regras que dela se leem.
 */
import { especies, TIPO_DO_ITEM, itensPorNome } from '../src/server/content.mjs';
import { dexDe } from '../src/shared/escala-hunt-level.mjs';

const tipoDoNome = (nome) => {
  const it = itensPorNome.get(String(nome).toLowerCase());
  return it ? (TIPO_DO_ITEM.get(it.id) ?? null) : null;
};
const catDoNome = (nome) => itensPorNome.get(String(nome).toLowerCase())?.category ?? '?';

const ref = [];
for (const c of especies.values()) {
  const dex = dexDe(c.pokeId);
  if (dex < 1 || dex > 251 || c.pokeId > 1000) continue;
  ref.push(c);
}
console.log(`espécies de referência (Kanto/Johto): ${ref.length}`);

// 1) tamanho da lista de loot
const tamanhos = ref.map((c) => (c.loot ?? []).filter((l) => l.chance > 0).length);
const hist = {};
for (const t of tamanhos) hist[t] = (hist[t] ?? 0) + 1;
console.log('\n1) itens com chance>0 por espécie:', JSON.stringify(hist));

// 2) aderência ao tipo: cada item dropado é do tipo do bicho?
let alinhados = 0, total = 0, semTipo = 0;
const foraPorTipo = {};
for (const c of ref) {
  for (const l of c.loot ?? []) {
    if (!l.chance) continue;
    const ti = tipoDoNome(l.name);
    if (!ti) { semTipo++; continue; }
    total++;
    if (ti === c.type1 || ti === c.type2) alinhados++;
    else {
      const k = `${c.type1}→${ti}`;
      foraPorTipo[k] = (foraPorTipo[k] ?? 0) + 1;
    }
  }
}
console.log(`\n2) itens COM tipo: ${total} · do tipo do bicho: ${alinhados} (${(100*alinhados/total).toFixed(1)}%) · itens sem tipo: ${semTipo}`);
console.log('   maiores desvios:', Object.entries(foraPorTipo).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,n])=>`${k}=${n}`).join(' '));

// 3) as PEDRAS de evolução: quem dropa cada uma
const PEDRAS = ['Sun Stone','Fire Stone','Water Stone','Leaf Stone','Thunder Stone','Ice Stone',
  'Punch Stone','Venom Stone','Earth Stone','Feather Stone','Enigma Stone','Cocoon Stone',
  'Rock Stone','Darkness Stone','Ancient Stone','Metal Stone','Heart Stone'];
console.log('\n3) pedras de evolução em Kanto/Johto — tipo dominante de quem dropa:');
for (const p of PEDRAS) {
  const quem = ref.filter((c) => (c.loot ?? []).some((l) => l.name === p && l.chance > 0));
  if (!quem.length) { console.log(`   ${p.padEnd(16)} — ninguém dropa`); continue; }
  const cont = {};
  for (const c of quem) { cont[c.type1] = (cont[c.type1] ?? 0) + 1; if (c.type2) cont[c.type2] = (cont[c.type2] ?? 0) + 0.5; }
  const ranque = Object.entries(cont).sort((a,b)=>b[1]-a[1]);
  const tipoItem = tipoDoNome(p);
  const doTipo = quem.filter((c) => c.type1 === tipoItem || c.type2 === tipoItem).length;
  const chances = quem.flatMap((c)=>(c.loot??[]).filter(l=>l.name===p&&l.chance>0).map(l=>l.chance)).sort((a,b)=>a-b);
  const mediana = chances[Math.floor(chances.length/2)];
  console.log(`   ${p.padEnd(16)} tipo=${String(tipoItem).padEnd(9)} n=${String(quem.length).padStart(3)} · do tipo: ${doTipo} (${(100*doTipo/quem.length).toFixed(0)}%) · chance mediana ${mediana} · top ${ranque.slice(0,3).map(([t,n])=>`${t}:${n}`).join(' ')}`);
}

// 4) quantas espécies dropam A PEDRA DO PRÓPRIO TIPO PRIMÁRIO?
const PEDRA_POR_TIPO = {
  NORMAL:'Sun Stone', FIRE:'Fire Stone', WATER:'Water Stone', GRASS:'Leaf Stone',
  ELECTRIC:'Thunder Stone', ICE:'Ice Stone', FIGHTING:'Punch Stone', POISON:'Venom Stone',
  GROUND:'Earth Stone', FLYING:'Feather Stone', PSYCHIC:'Enigma Stone', BUG:'Cocoon Stone',
  ROCK:'Rock Stone', GHOST:'Darkness Stone', DRAGON:'Ancient Stone', DARK:'Darkness Stone',
  STEEL:'Metal Stone', FAIRY:'Heart Stone',
};
let comPropria = 0, semPropria = 0;
const faltaPorTipo = {};
for (const c of ref) {
  const p = PEDRA_POR_TIPO[c.type1];
  if (!p) continue;
  const tem = (c.loot ?? []).some((l) => l.name === p && l.chance > 0);
  if (tem) comPropria++;
  else { semPropria++; faltaPorTipo[c.type1] = (faltaPorTipo[c.type1] ?? 0) + 1; }
}
console.log(`\n4) dropam a pedra do PRÓPRIO type1: ${comPropria} · não dropam: ${semPropria}`);
console.log('   quem não dropa, por tipo:', Object.entries(faltaPorTipo).sort((a,b)=>b[1]-a[1]).map(([t,n])=>`${t}:${n}`).join(' '));

// 5) pool por tipo (itens ordenados por frequência)
console.log('\n5) POOL por type1 — itens que espécies daquele tipo dropam (freq · tipo do item):');
const pool = {};
for (const c of ref) {
  if (!c.type1) continue;
  pool[c.type1] ??= new Map();
  for (const l of c.loot ?? []) {
    if (!l.chance) continue;
    const cur = pool[c.type1].get(l.name) ?? { n: 0, chances: [] };
    cur.n++; cur.chances.push(l.chance);
    pool[c.type1].set(l.name, cur);
  }
}
for (const [t, m] of Object.entries(pool).sort()) {
  const nEsp = ref.filter((c) => c.type1 === t).length;
  const itens = [...m.entries()].sort((a,b)=>b[1].n-a[1].n)
    .map(([nome, v]) => `${nome}[${catDoNome(nome)}/${tipoDoNome(nome)??'—'}] ${v.n}/${nEsp}`);
  console.log(`\n  ${t} (${nEsp} espécies):`);
  for (const i of itens) console.log(`     ${i}`);
}
