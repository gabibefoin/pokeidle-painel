// Varredura de XP, ouro por kill e preço de venda no catálogo.
//   node tools/auditoria-xp-ouro.mjs
import { especies } from '../src/server/content.mjs';
import { ouroPorDerrota } from '../src/server/game/combate.mjs';

const FATOR_VENDA = 1; // sim.mjs — NPC paga 100% do sellValue escalado

const antigoKill = (e) => Math.floor((e.sellValue ?? 0) / 10);
const vendaLvl1 = (e) => {
  const base = e.sellValue ?? e.priceNpc ?? 0;
  return Math.max(1, Math.floor(base * FATOR_VENDA));
};

const rows = [...especies.values()].map((e) => ({
  name: e.name,
  pokeId: e.pokeId,
  huntLevel: e.huntLevel ?? 1,
  experience: e.experience ?? null,
  sellValue: e.sellValue ?? null,
  priceNpc: e.priceNpc ?? null,
  ouroKill: ouroPorDerrota(e),
  ouroKillAntigo: antigoKill(e),
  vendaLvl1: vendaLvl1(e),
  ratioKillAntigoVsXp: antigoKill(e) / Math.max(1, e.experience ?? 10),
  ratioSellVsXp: (e.sellValue ?? 0) / Math.max(1, e.experience ?? 10),
}));

const fmt = (r) =>
  `${r.name.padEnd(16)} id=${String(r.pokeId).padStart(5)} hunt=${String(r.huntLevel).padStart(3)} xp=${String(r.experience ?? '?').padStart(5)} sell=${String(r.sellValue ?? '—').padStart(8)} kill=${String(r.ouroKill).padStart(5)} killOld=${String(r.ouroKillAntigo).padStart(6)} venda1=${String(r.vendaLvl1).padStart(5)}`;

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

console.log(`=== CATÁLOGO: ${rows.length} espécies ===\n`);

const killExploit = rows
  .filter((r) => r.ouroKillAntigo >= 100 && r.ouroKill <= 50)
  .sort((a, b) => b.ouroKillAntigo - a.ouroKillAntigo);
console.log('1) KILL ANTIGO (sell/10) vs XP baixo — bug histórico, já corrigido no código:');
for (const r of killExploit) console.log(`   ${fmt(r)}  old/xp=${r.ratioKillAntigoVsXp.toFixed(0)}×`);
console.log(`   total: ${killExploit.length}\n`);

const sellVsXp = rows
  .filter((r) => r.sellValue != null && r.experience != null && r.ratioSellVsXp >= 50)
  .sort((a, b) => b.ratioSellVsXp - a.ratioSellVsXp);
console.log('2) sellValue / experience ≥ 50× (venda desproporcional ao XP da espécie):');
for (const r of sellVsXp.slice(0, 30)) console.log(`   ${fmt(r)}  sell/xp=${r.ratioSellVsXp.toFixed(0)}×`);
console.log(`   total: ${sellVsXp.length}\n`);

const sellHunt = rows
  .filter((r) => r.sellValue >= 5000 && r.huntLevel <= 5)
  .sort((a, b) => b.sellValue - a.sellValue);
console.log('3) sellValue ≥ 5000 em huntLevel ≤ 5:');
for (const r of sellHunt.slice(0, 30)) console.log(`   ${fmt(r)}`);
console.log(`   total: ${sellHunt.length}\n`);

const semXp = rows.filter((r) => r.experience == null || r.experience <= 0);
console.log(`4) Sem experience válido: ${semXp.length}`);
for (const r of semXp.slice(0, 15)) console.log(`   ${fmt(r)}`);

const semSell = rows.filter((r) => r.sellValue == null);
console.log(`\n5) Sem sellValue: ${semSell.length}`);
for (const r of semSell) console.log(`   ${r.name} (${r.pokeId})`);

const killAlto = [...rows].sort((a, b) => b.ouroKill - a.ouroKill).slice(0, 15);
console.log('\n6) TOP 15 ouro por kill ATUAL (experience):');
for (const r of killAlto) console.log(`   ${fmt(r)}`);

const killBaixoSellAlto = rows
  .filter((r) => r.ouroKill <= 10 && (r.sellValue ?? 0) >= 500)
  .sort((a, b) => b.sellValue - a.sellValue);
console.log('\n7) Kill baixo (≤10) + sellValue alto (≥500):');
for (const r of killBaixoSellAlto.slice(0, 20)) console.log(`   ${fmt(r)}`);
console.log(`   total: ${killBaixoSellAlto.length}`);

const porHunt = new Map();
for (const r of rows) {
  const h = r.huntLevel;
  if (!porHunt.has(h)) porHunt.set(h, { xp: [], sell: [], kill: [] });
  const b = porHunt.get(h);
  if (r.experience != null) b.xp.push(r.experience);
  if (r.sellValue != null) b.sell.push(r.sellValue);
  b.kill.push(r.ouroKill);
}
console.log('\n8) Medianas por huntLevel (xp / sellValue / ouroKill):');
[...porHunt.keys()].sort((a, b) => a - b).forEach((h) => {
  const b = porHunt.get(h);
  console.log(
    `   hunt ${String(h).padStart(3)}: n=${String(b.xp.length).padStart(3)}  xp~${med(b.xp)}  sell~${med(b.sell)}  kill~${med(b.kill)}`,
  );
});

const outliers = [];
for (const r of rows) {
  const b = porHunt.get(r.huntLevel);
  if (!b?.sell.length || r.sellValue == null) continue;
  const medSell = med(b.sell);
  if (medSell > 0 && r.sellValue >= medSell * 10) {
    outliers.push({ ...r, medSellHunt: medSell, mult: r.sellValue / medSell });
  }
}
outliers.sort((a, b) => b.mult - a.mult);
console.log('\n9) sellValue ≥ 10× mediana da mesma hunt (top 25):');
for (const r of outliers.slice(0, 25)) {
  console.log(`   ${fmt(r)}  medHunt=${r.medSellHunt}  ${r.mult.toFixed(1)}×`);
}

console.log('\n10) Referências:');
for (const name of ['Togepi', 'Smeargle', 'Pidgey', 'Dratini', 'Larvitar', 'Golem', 'Magikarp', 'Chansey', 'Blissey', 'Mewtwo']) {
  const r = rows.find((x) => x.name === name);
  if (r) console.log(`   ${fmt(r)}`);
}
