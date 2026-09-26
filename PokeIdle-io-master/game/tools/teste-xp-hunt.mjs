// O XP de um abate é função só do nível do mob: mesmo nível, mesmo XP, qualquer espécie.
//
//   node tools/teste-xp-hunt.mjs
//
// Nasceu da Eevee Nv 40 pagando 248 enquanto o Ivysaur Nv 40 pagava 968.
import { huntsJogaveis, especies } from '../src/server/content.mjs';
import { xpPorDerrota, xpDoNivel } from '../src/shared/recompensa-hunt.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, msg, extra = '') => {
  testes++;
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    falhas++;
    console.log(`  ✗ ${msg}${extra ? ` — ${extra}` : ''}`);
  }
};
const secao = (t) => console.log(`\n${t}`);

const xpDaHunt = (slug) => {
  const h = huntsJogaveis.find((x) => x.slug === slug);
  return xpPorDerrota(h, h.nivel, especies.get(h.especies[0].pokeId));
};

secao('Mesmo nível de hunt, mesmo XP');
{
  const porNivel = new Map();
  for (const h of huntsJogaveis) {
    for (const e of h.especies) {
      const xp = xpPorDerrota(h, h.nivel, especies.get(e.pokeId));
      (porNivel.get(h.nivel) ?? porNivel.set(h.nivel, new Set()).get(h.nivel)).add(xp);
    }
  }
  const quebrados = [...porNivel].filter(([, s]) => s.size > 1).map(([n]) => n);
  ok(quebrados.length === 0, `${porNivel.size} níveis de hunt, cada um paga um XP só`, `níveis: ${quebrados.join(', ')}`);
  ok(xpDaHunt('eevee') === xpDaHunt('ivysaur'), 'Eevee Nv 40 paga o mesmo que Ivysaur Nv 40', `${xpDaHunt('eevee')} × ${xpDaHunt('ivysaur')}`);
  ok(xpDaHunt('eevee') === 968, 'e esse XP é 968', `${xpDaHunt('eevee')}`);
  ok(xpDaHunt('houndoom') === xpDoNivel(80), 'Houndoom (hunt 80) paga o nível 80, não o 100 da espécie', `${xpDaHunt('houndoom')}`);
  ok(xpDaHunt('espeon') === xpDaHunt('umbreon') && xpDaHunt('espeon') === xpDoNivel(80), 'Espeon e Umbreon (hunt 80) pagam o nível 80');
}

secao('O resto de Kanto e da Outland não muda um número');
{
  // Onde o nível da hunt é o `huntLevel` da espécie, o XP novo tem de ser o `experience` do espelho.
  const diferentes = [];
  let conferidas = 0;
  for (const h of huntsJogaveis) {
    if (h.nivel > 150) continue;
    for (const e of h.especies) {
      const esp = especies.get(e.pokeId);
      if (esp.huntLevel !== h.nivel) continue;
      conferidas++;
      const xp = xpPorDerrota(h, h.nivel, esp);
      if (xp !== esp.experience) diferentes.push(`${esp.name} ${esp.experience}→${xp}`);
    }
  }
  ok(conferidas > 250, `${conferidas} espécies conferidas`);
  ok(diferentes.length === 0, 'todas pagam exatamente o `experience` do espelho', diferentes.slice(0, 10).join(', '));
  ok(xpDoNivel(1) === 8, 'nível 1 continua pagando 8', `${xpDoNivel(1)}`);
}

secao('A curva acima de 150 (Hoenn+) não mudou');
{
  ok(xpDoNivel(151) === Math.round(13_500 * (151 / 150) ** 1.25), 'nível 151 segue 13.500·(n/150)^1,25');
  ok(xpDoNivel(600) === Math.round(13_500 * 4 ** 1.25), 'nível 600 idem', `${xpDoNivel(600)}`);
  let sobe = true;
  for (let n = 2; n <= 2_000; n++) if (xpDoNivel(n) <= xpDoNivel(n - 1)) sobe = false;
  ok(sobe, 'a curva sobe a cada nível, sem degrau na emenda do 150');
}

console.log(`\n${testes - falhas}/${testes} ok`);
process.exit(falhas ? 1 : 0);
