/**
 * Teste do TETO DE CAPTURA — a escada, a cerca do Nv 100 e o degrau da evolução.
 *
 * Não precisa de servidor nem de Postgres: tudo o que este arquivo prova mora no catálogo
 * carregado no boot (`content.mjs`) e nas funções puras de `shared/teto-captura.mjs`.
 *
 * O que ele garante, na ordem em que as regras foram pedidas:
 *
 *   1. a escada é 20/40/100 na cadeia de 3, 40/100 na de 2 e 100 em quem não evolui;
 *   2. **Kanto não se mexe** — nenhuma hunt de nível até 100 tem captura cortada;
 *   3. acima disso o teto morda: um Torterra de hunt 3.500 entra no Nv 100, um Turtwig no 20;
 *   4. o XP desce JUNTO com o nível (senão o primeiro mob derrubado devolve o nível antigo);
 *   5. todo elo de evolução de Outland+ pede exatamente o teto do destino — inclusive nas
 *      cadeias que abrem em vários (`EVOLUCOES_RAMIFICADAS`);
 *   6. aplicar duas vezes dá o mesmo resultado (o cliente e o servidor rodam cada um o seu);
 *   7. a CERCA do Nv 100 é exata dos dois lados — Nv 100 entra intacto, Nv 101 já cai na
 *      escada, e isso vale para qualquer espécie, não só para as de hunt alta.
 *
 *   node tools/teste-teto-captura.mjs
 */
import {
  especies,
  huntsJogaveis,
  nivelDeCapturaDe,
  tetoDeCapturaDaEspecie,
  xpTotalParaNivel,
  nivelPeloXp,
  ESTAGIOS_EVOLUTIVOS,
} from '../src/server/content.mjs';
import {
  TETO_CAPTURA_MAX,
  ESCADA_TETO_CAPTURA,
  nivelDeCaptura,
  ehOutlandOuAcima,
  aplicarTetoDeCaptura,
} from '../src/shared/teto-captura.mjs';
import { destinosDeEvolucao, EVOLUCOES_RAMIFICADAS } from '../src/shared/evolucoes-ramificadas.mjs';
import { isOutlandPokeId } from '../src/shared/outland.mjs';

let falhas = 0;
let testes = 0;
const ok = (cond, nome, extra = '') => {
  testes++;
  if (cond) return console.log(`  ✓ ${nome}`);
  falhas++;
  console.log(`  ✗ ${nome}${extra ? `  — ${extra}` : ''}`);
};
const secao = (t) => console.log(`\n${t}`);

/** A espécie pelo nome, preferindo a de MAIOR huntLevel — o clone `13xxx` das hunts de Hoenn. */
const porNome = (nome) => [...especies.values()]
  .filter((e) => e.name === nome)
  .sort((a, b) => (b.huntLevel ?? 0) - (a.huntLevel ?? 0))[0];

// ------------------------------------------------------------------ a escada

secao('A escada');
ok(TETO_CAPTURA_MAX === 100, 'a última evolução para no Nv 100');
ok(
  JSON.stringify(ESCADA_TETO_CAPTURA[3]) === JSON.stringify([20, 40, 100]),
  'cadeia de 3 estágios: 20 · 40 · 100',
  JSON.stringify(ESCADA_TETO_CAPTURA[3]),
);
ok(
  JSON.stringify(ESCADA_TETO_CAPTURA[2]) === JSON.stringify([40, 100]),
  'cadeia de 2 estágios: 40 · 100',
  JSON.stringify(ESCADA_TETO_CAPTURA[2]),
);
ok(
  JSON.stringify(ESCADA_TETO_CAPTURA[1]) === JSON.stringify([100]),
  'quem não evolui: 100',
  JSON.stringify(ESCADA_TETO_CAPTURA[1]),
);

secao('O teto de cada estágio, nos iniciais de Hoenn');
for (const [nome, esperado] of [['Treecko', 20], ['Grovyle', 40], ['Sceptile', 100]]) {
  const esp = porNome(nome);
  ok(tetoDeCapturaDaEspecie(esp) === esperado, `${nome} → Nv ${esperado}`, `deu ${esp?.tetoCaptura}`);
}
for (const [nome, esperado] of [['Makuhita', 40], ['Hariyama', 100]]) {
  const esp = porNome(nome);
  ok(tetoDeCapturaDaEspecie(esp) === esperado, `${nome} (cadeia de 2) → Nv ${esperado}`, `deu ${esp?.tetoCaptura}`);
}
const spinda = porNome('Spinda');
ok(tetoDeCapturaDaEspecie(spinda) === 100, 'Spinda (não evolui) → Nv 100', `deu ${spinda?.tetoCaptura}`);

// --------------------------------------------------------------- a cerca

secao('A cerca: até o Nv 100 nada muda');
ok(nivelDeCaptura(30, 20) === 30, 'mob Nv 30 com teto 20 continua Nv 30 (abaixo da cerca)');
ok(nivelDeCaptura(100, 20) === 100, 'mob Nv 100 com teto 20 continua Nv 100 (na cerca)');
ok(nivelDeCaptura(101, 20) === 20, 'mob Nv 101 com teto 20 cai para 20 (um acima da cerca)');
ok(nivelDeCaptura(120, 999) === 120, 'teto maior que o mob nunca PROMOVE ninguém');

const cortesEmKanto = [];
for (const h of huntsJogaveis) {
  if (h.nivel > TETO_CAPTURA_MAX) continue;
  for (const e of h.especies ?? []) {
    const esp = especies.get(e.pokeId);
    if (esp && nivelDeCapturaDe(esp, h.nivel) < h.nivel) cortesEmKanto.push(`${esp.name}@${h.slug}`);
  }
}
ok(
  cortesEmKanto.length === 0,
  `nenhuma das ${huntsJogaveis.filter((h) => h.nivel <= TETO_CAPTURA_MAX).length} hunts de nível até 100 teve captura cortada`,
  cortesEmKanto.slice(0, 5).join(', '),
);

// ------------------------------------------------------- a CERCA, de perto
//
// As hunts pulam de 100 (Kanto/Johto) direto para 150 (Outland), então nenhuma delas cai em
// cima do degrau. Este bloco olha a cerca tile a tile, com níveis escritos à mão: Nv 100 tem
// de entrar no Nv 100, e é o 101 que cai na escada.
//
// O Magikarp é o caso de estudo porque a hunt dele é Nv 1 — a mais baixa do jogo — e o teto
// dele é 40. Se a cerca vazasse para baixo, seria nele que apareceria primeiro.

secao('Cerca: até o Nv 100 entra no nível que rolou');
const magikarp = porNome('Magikarp');
ok(tetoDeCapturaDaEspecie(magikarp) === 40, 'o teto do Magikarp é 40 (cadeia de 2, estágio 0)', `${magikarp?.tetoCaptura}`);
for (const nv of [1, 5, 10, 30, 60, 80, 100]) {
  ok(
    nivelDeCapturaDe(magikarp, nv) === nv,
    `Magikarp capturado no Nv ${nv} entra no Nv ${nv} — o teto NÃO encosta`,
    `deu ${nivelDeCapturaDe(magikarp, nv)}`,
  );
}
ok(
  nivelDeCaptura(1, tetoDeCapturaDaEspecie(magikarp)) === 1,
  'o Magikarp Nv 1 da hunt de Kanto entra intacto',
);

secao('Cerca: acima do Nv 100 a escada entra, por estágio');
for (const [nome, esperado] of [['Magikarp', 40], ['Gyarados', 100], ['Popplio', 20], ['Brionne', 40], ['Primarina', 100]]) {
  const esp = porNome(nome);
  ok(
    esp && nivelDeCapturaDe(esp, 1000) === esperado,
    `${nome} capturado no Nv 1.000 entra no Nv ${esperado}`,
    `deu ${esp ? nivelDeCapturaDe(esp, 1000) : '—'}`,
  );
}
ok(nivelDeCapturaDe(magikarp, 101) === 40, 'e o degrau é EXATAMENTE no 101 — Nv 101 já cai para 40');
ok(nivelDeCapturaDe(porNome('Gyarados'), 101) === 100, 'numa última evolução o degrau é suave: 101 → 100');

secao('Acima da cerca o teto morde');
for (const [nome, esperado] of [['Torterra', 100], ['Grotle', 40], ['Turtwig', 20], ['Tinkaton', 100]]) {
  const esp = porNome(nome);
  const hunt = huntsJogaveis.filter((h) => h.especies?.some((x) => x.pokeId === esp?.pokeId))
    .sort((a, b) => a.nivel - b.nivel)[0];
  ok(
    esp && hunt && nivelDeCapturaDe(esp, hunt.nivel) === esperado,
    `${nome} numa hunt de ${hunt?.nivel?.toLocaleString('pt-BR')} entra no Nv ${esperado}`,
    `deu ${esp && hunt ? nivelDeCapturaDe(esp, hunt.nivel) : '—'}`,
  );
}

// ------------------------------------------------------------------- o XP
//
// A metade que é fácil esquecer: `nivelPeloXp` manda no nível a partir do primeiro ganho de
// XP. Gravar nível 100 com o XP de 2.000 devolveria o 2.000 no primeiro mob derrubado.

secao('O XP desce junto com o nível');
for (const nivelMob of [150, 500, 3000, 160300]) {
  const esp = porNome('Torterra');
  const cap = nivelDeCapturaDe(esp, nivelMob);
  ok(
    nivelPeloXp(xpTotalParaNivel(cap)) === cap,
    `mob Nv ${nivelMob.toLocaleString('pt-BR')} → nasce no Nv ${cap} e o XP dele devolve ${cap}`,
    `${nivelPeloXp(xpTotalParaNivel(cap))}`,
  );
}
const esperadoTorterra = xpTotalParaNivel(100);
ok(
  xpTotalParaNivel(nivelDeCapturaDe(porNome('Torterra'), 3000)) === esperadoTorterra
    && esperadoTorterra < xpTotalParaNivel(3000),
  'o XP gravado é o do teto, não o do mob',
);

// ------------------------------------------------------- degraus de evolução

secao('Os degraus de evolução seguiram a mesma escada');
const foraDaEscada = [];
const acimaDoTeto = [];
for (const c of especies.values()) {
  for (const d of destinosDeEvolucao(c, (id) => especies.get(id))) {
    if (d.nivel > TETO_CAPTURA_MAX) acimaDoTeto.push(`${c.name}→${d.especie.name} (${d.nivel})`);
    if (!ehOutlandOuAcima(d.pokeId)) continue;
    // Ramo marcado `fixo` (as eeveelutions no Nv 80) é exceção escolhida à mão, e abaixo do teto.
    if (EVOLUCOES_RAMIFICADAS[c.pokeId]?.find((r) => r.para === d.pokeId)?.fixo) continue;
    const teto = tetoDeCapturaDaEspecie(d.especie);
    if (d.nivel !== teto) foraDaEscada.push(`${c.name}→${d.especie.name}: pede ${d.nivel}, teto ${teto}`);
  }
}
ok(acimaDoTeto.length === 0, `nenhum destino pede mais que o Nv ${TETO_CAPTURA_MAX}`, acimaDoTeto.slice(0, 4).join(' · '));
ok(foraDaEscada.length === 0, 'todo destino de Outland+ pede exatamente o teto dele', foraDaEscada.slice(0, 4).join(' · '));

secao('As cadeias que abrem em vários destinos vieram junto');
const eevee = porNome('Eevee');
const eeveelutions = destinosDeEvolucao(eevee, (id) => especies.get(id));
ok(eeveelutions.length >= 8, `o Eevee mantém os ${eeveelutions.length} destinos`, `${eeveelutions.length}`);
// Os oito no Nv 80 — o nível em que Vaporeon, Jolteon e Flareon aparecem em Kanto. O teto de
// captura não pode devolver Leafeon, Glaceon e Sylveon (Sinnoh/Kalos) ao 100.
ok(
  eeveelutions.every((d) => d.nivel === 80),
  'toda eeveelution pede o Nv 80, inclusive as de Sinnoh e Kalos',
  eeveelutions.map((d) => `${d.especie.name}=${d.nivel}`).join(', '),
);
ok(eevee?.evolveLevel === 80, 'o nível padrão do Eevee (o que a Pokédex mostra) também é 80', `${eevee?.evolveLevel}`);
ok(tetoDeCapturaDaEspecie(eevee) === 40, 'e o Eevee capturado entra no Nv 40', `${eevee?.tetoCaptura}`);

// ----------------------------------------------------- variantes de Outland

secao('Variantes de Outland');
const variantes = [...especies.values()].filter((e) => isOutlandPokeId(e.pokeId));
ok(variantes.length > 0, `${variantes.length} variantes no catálogo`);
ok(
  variantes.every((e) => e.tetoCaptura === TETO_CAPTURA_MAX),
  'todas entram no Nv 100 — elas não evoluem, então são "última evolução"',
  variantes.filter((e) => e.tetoCaptura !== TETO_CAPTURA_MAX).slice(0, 3).map((e) => `${e.name}=${e.tetoCaptura}`).join(', '),
);
const brave = variantes.find((e) => e.name.startsWith('Brave Blastoise')) ?? variantes[0];
ok(nivelDeCapturaDe(brave, 150) === 100, `${brave.name} na Outland (150) entra no Nv 100`, `${nivelDeCapturaDe(brave, 150)}`);

// ---------------------------------------------------------- idempotência

secao('Aplicar duas vezes não muda nada');
const antes = [...especies.values()].map((e) => `${e.pokeId}:${e.tetoCaptura}:${e.evolveLevel ?? 0}`).join('|');
aplicarTetoDeCaptura([...especies.values()], (id) => especies.get(id));
const depois = [...especies.values()].map((e) => `${e.pokeId}:${e.tetoCaptura}:${e.evolveLevel ?? 0}`).join('|');
ok(antes === depois, 'o catálogo é idêntico depois de uma segunda passagem');

// --------------------------------------------------------- estágios sãos

secao('Os estágios evolutivos fazem sentido');
const cadeiasLongas = [...ESTAGIOS_EVOLUTIVOS.values()].filter((e) => e.elos > 4);
ok(cadeiasLongas.length === 0, 'nenhuma cadeia passa de 4 elos (a escada só vai até lá)', `${cadeiasLongas.length}`);
const estagioForaDaCadeia = [...ESTAGIOS_EVOLUTIVOS.entries()].filter(([, e]) => e.estagio >= e.elos);
ok(estagioForaDaCadeia.length === 0, 'nenhum estágio cai fora da própria cadeia', `${estagioForaDaCadeia.length}`);

console.log(`\n${'='.repeat(46)}`);
console.log(falhas ? `${falhas} de ${testes} FALHARAM` : `${testes} testes passaram`);
process.exit(falhas ? 1 : 0);
