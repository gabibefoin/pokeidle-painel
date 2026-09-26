/**
 * Varredura do TETO DE CAPTURA — o que a escada fez com o jogo, região a região.
 *
 * O teto (`shared/teto-captura.mjs`) não mexe em `huntLevel`: o selvagem continua lutando,
 * pagando XP e dando ouro no degrau da hunt. O que ele muda é o nível com que o capturado
 * ENTRA na equipe, e o degrau que a evolução cobra. Este script mostra os dois lados:
 *
 *   1. quanto o teto corta em cada região, e quem sobra intocado (Kanto tem de sobrar INTEIRA);
 *   2. os níveis de evolução que desceram para a escada, com os piores casos antes/depois;
 *   3. o efeito no MERCADO — `precoVendaPokemon` escala com `nível/50`, e é por isso que um
 *      nível 2.000 valia 41x a base;
 *   4. as armadilhas que sobrariam: espécie cujo teto fica ABAIXO do degrau que a própria
 *      evolução dela cobra (o bicho nasce e já precisa treinar para evoluir — o que é o
 *      desenho), e o caso ruim de verdade, uma evolução que ainda pede mais de 100.
 *
 *   node game/tools/auditoria-teto-captura.mjs
 *   node game/tools/auditoria-teto-captura.mjs --todos    # lista completa, não só a amostra
 */
import { especies, huntsJogaveis, nivelDeCapturaDe, ESTAGIOS_EVOLUTIVOS } from '../src/server/content.mjs';
import { TETO_CAPTURA_MAX, ESCADA_TETO_CAPTURA, ehOutlandOuAcima } from '../src/shared/teto-captura.mjs';
import { sellValueBaseDe } from '../src/shared/sell-value.mjs';
import { isOutlandPokeId } from '../src/shared/outland.mjs';
import { dexDe } from '../src/shared/escala-hunt-level.mjs';

const TODOS = process.argv.includes('--todos');
const n = (v) => Number(v).toLocaleString('pt-BR');
const secao = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);

/**
 * As regiões, pela mesma régua de `ehOutlandOuAcima`: dex. As variantes de Outland (10501+)
 * não têm dex nacional próprio e entram numa faixa só.
 */
const REGIOES = [
  ['Kanto/Johto', 1, 251],
  ['Hoenn', 252, 386],
  ['Sinnoh', 387, 493],
  ['Unova', 494, 649],
  ['Kalos', 650, 721],
  ['Alola', 722, 809],
  ['Galar', 810, 905],
  ['Paldea', 906, 1025],
];
const regiaoDe = (pokeId) => {
  if (isOutlandPokeId(pokeId)) return 'Outland';
  const d = dexDe(pokeId);
  return REGIOES.find(([, a, b]) => d >= a && d <= b)?.[0] ?? '—';
};

// ------------------------------------------------- 1. o corte, hunt a hunt
//
// A régua é a HUNT, não a espécie: é lá que a bola é arremessada, e a mesma espécie pode
// morar em duas hunts de eras diferentes. Para cada par (hunt, espécie) que dá para capturar,
// o antes é o nível do mob e o depois é o que sai da bola.

const linhas = [];
for (const h of huntsJogaveis) {
  for (const e of h.especies ?? []) {
    const esp = especies.get(e.pokeId);
    if (!esp) continue;
    const antes = h.nivel;
    const depois = nivelDeCapturaDe(esp, antes);
    linhas.push({
      hunt: h.slug,
      huntNivel: h.nivel,
      pokeId: e.pokeId,
      nome: esp.name,
      regiao: regiaoDe(e.pokeId),
      teto: esp.tetoCaptura,
      estagio: ESTAGIOS_EVOLUTIVOS.get(e.pokeId),
      antes,
      depois,
    });
  }
}

secao('A escada');
for (const [elos, escada] of Object.entries(ESCADA_TETO_CAPTURA)) {
  const marca = elos === '4' ? '   (reserva — nenhuma cadeia do catálogo chega a 4)' : '';
  console.log(`  cadeia de ${elos}: ${escada.join(' · ')}${marca}`);
}
console.log(`  a cerca: até o Nv ${TETO_CAPTURA_MAX} o mob passa inteiro, sem teto nenhum`);

secao('Quanto o teto corta, por região');
console.log('  região         capturáveis   cortados   nível médio antes → depois   pior corte');
const porRegiao = new Map();
for (const l of linhas) {
  const b = porRegiao.get(l.regiao) ?? { total: 0, cortados: 0, somaAntes: 0, somaDepois: 0, pior: null };
  b.total++;
  b.somaAntes += l.antes;
  b.somaDepois += l.depois;
  if (l.depois < l.antes) {
    b.cortados++;
    if (!b.pior || l.antes - l.depois > b.pior.antes - b.pior.depois) b.pior = l;
  }
  porRegiao.set(l.regiao, b);
}
const ordem = ['Kanto/Johto', 'Outland', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar', 'Paldea', '—'];
for (const nome of ordem) {
  const b = porRegiao.get(nome);
  if (!b) continue;
  const mediaAntes = Math.round(b.somaAntes / b.total);
  const mediaDepois = Math.round(b.somaDepois / b.total);
  const pior = b.pior ? `${b.pior.nome} ${n(b.pior.antes)} → ${b.pior.depois}` : '—';
  console.log(
    `  ${nome.padEnd(13)} ${String(b.total).padStart(9)} ${String(b.cortados).padStart(10)}`
    + `   ${String(n(mediaAntes)).padStart(9)} → ${String(n(mediaDepois)).padEnd(7)}   ${pior}`,
  );
}

/**
 * A garantia que importa é pela HUNT, não pelo dex.
 *
 * A linha "Kanto/Johto" acima acusa cortes, e eles estão certos: são os catorze bichos de dex
 * antigo que MORAM em hunt de Sinnoh (eevee_sinnoh no Nv 1.000, porygon2_sinnoh no 1.125).
 * Um Jolteon capturado a 1.000 inflava o Mercado exatamente como um Torterra — o dex dele não
 * muda isso. O que não pode acontecer é o teto encostar numa hunt de Kanto de verdade, e é
 * isso que a conta abaixo verifica: nenhum corte em hunt de nível até 100.
 */
const cortesAbaixoDaCerca = linhas.filter((l) => l.huntNivel <= TETO_CAPTURA_MAX && l.depois < l.antes);
console.log(
  cortesAbaixoDaCerca.length
    ? `\n  ✗ ${cortesAbaixoDaCerca.length} corte(s) em hunt de nível até ${TETO_CAPTURA_MAX} — a cerca falhou: `
      + cortesAbaixoDaCerca.slice(0, 6).map((l) => `${l.nome}@${l.hunt}`).join(', ')
    : `\n  ✓ nenhuma hunt de nível até ${TETO_CAPTURA_MAX} teve captura cortada — Kanto intocada`,
);
const dexAntigoEmHuntAlta = linhas.filter(
  (l) => l.regiao === 'Kanto/Johto' && l.depois < l.antes,
);
if (dexAntigoEmHuntAlta.length) {
  console.log(
    `  · ${dexAntigoEmHuntAlta.length} espécie(s) de dex antigo moram em hunt alta e foram cortadas junto (esperado): `
    + dexAntigoEmHuntAlta.slice(0, 6).map((l) => `${l.nome} ${n(l.antes)}→${l.depois}`).join(', '),
  );
}

// ------------------------------------------------- 2. os degraus de evolução

secao('Níveis de evolução alinhados à escada');
const elos = [];
for (const c of especies.values()) {
  if (!c.evolvesToId || c.evolvesToId <= 0) continue;
  const alvo = especies.get(c.evolvesToId);
  if (!alvo) continue;
  elos.push({
    nome: c.name,
    pokeId: c.pokeId,
    regiao: regiaoDe(c.pokeId),
    alvo: alvo.name,
    nivel: c.evolveLevel ?? 0,
    tetoAlvo: alvo.tetoCaptura,
    outlandMais: ehOutlandOuAcima(c.evolvesToId),
  });
}
const acimaDoTeto = elos.filter((e) => e.nivel > TETO_CAPTURA_MAX);
console.log(`  ${elos.length} elos no catálogo · ${elos.filter((e) => e.outlandMais).length} com destino em Outland+`);
console.log(
  acimaDoTeto.length
    ? `  ✗ ${acimaDoTeto.length} elo(s) ainda pedem mais de ${TETO_CAPTURA_MAX}: `
      + acimaDoTeto.slice(0, 8).map((e) => `${e.nome}→${e.alvo} (${n(e.nivel)})`).join(', ')
    : `  ✓ nenhum elo pede mais que o Nv ${TETO_CAPTURA_MAX}`,
);
const desalinhados = elos.filter((e) => e.outlandMais && e.nivel !== e.tetoAlvo);
console.log(
  desalinhados.length
    ? `  ✗ ${desalinhados.length} elo(s) de Outland+ fora da escada: `
      + desalinhados.slice(0, 8).map((e) => `${e.nome}→${e.alvo} pede ${n(e.nivel)}, teto do alvo ${e.tetoAlvo}`).join(' · ')
    : '  ✓ todo elo de Outland+ pede exatamente o teto do destino',
);

// ------------------------------------------------- 3. o Mercado

secao('Efeito no preço (precoVendaPokemon escala com nível/50)');
console.log('  hunt                nível    espécie              antes → depois     preço antes → depois');
const paraMercado = linhas
  .filter((l) => l.depois < l.antes)
  .sort((a, b) => b.antes - a.antes);
const amostraMercado = TODOS ? paraMercado : paraMercado.slice(0, 12);
for (const l of amostraMercado) {
  const base = sellValueBaseDe(especies.get(l.pokeId));
  const pAntes = Math.floor(base * (1 + l.antes / 50));
  const pDepois = Math.floor(base * (1 + l.depois / 50));
  console.log(
    `  ${l.hunt.padEnd(20).slice(0, 20)}${String(n(l.huntNivel)).padStart(7)}   ${l.nome.padEnd(18).slice(0, 18)}`
    + ` ${String(n(l.antes)).padStart(7)} → ${String(l.depois).padEnd(4)}`
    + ` ${String(n(pAntes)).padStart(12)} → ${n(pDepois)}`,
  );
}
if (!TODOS && paraMercado.length > amostraMercado.length) {
  console.log(`  … e mais ${n(paraMercado.length - amostraMercado.length)} (rode com --todos)`);
}

// ------------------------------------------------- 4. o grind que sobra

secao('O que o jogador tem de treinar depois de capturar');
console.log('  Um capturado no teto do estágio dele precisa subir até o degrau da evolução.');
console.log('  Estes são os saltos, e eles são o DESENHO — não um defeito:\n');
const saltos = new Map();
for (const c of especies.values()) {
  if (!c.evolvesToId || c.evolvesToId <= 0) continue;
  if (!ehOutlandOuAcima(c.pokeId) && !ehOutlandOuAcima(c.evolvesToId)) continue;
  const de = c.tetoCaptura ?? TETO_CAPTURA_MAX;
  const ate = c.evolveLevel ?? 0;
  if (ate <= de) continue;
  const chave = `${de} → ${ate}`;
  saltos.set(chave, (saltos.get(chave) ?? 0) + 1);
}
for (const [chave, qtd] of [...saltos.entries()].sort()) {
  const fora = chave !== '20 → 40' && chave !== '40 → 100';
  console.log(`  capturado no Nv ${chave.padEnd(10)} ${String(qtd).padStart(4)} espécies${fora ? '   ← fora da escada' : ''}`);
}
/**
 * O único salto fora da escada é um BEBÊ, e o desenho dele é anterior a isto.
 *
 * Mime Jr. é de Sinnoh e vira um Mr. Mime de KANTO — destino de dex antigo, numa hunt de 80,
 * que a regra não toca por definição (ver `precisaDescer`). Ele nasce no teto 40 e evolui em
 * 80: continua dentro da faixa de Kanto e nunca passa do teto. Se um dia aparecer um salto
 * aqui que não seja um bebê, é sinal de que um elo escapou do alinhamento.
 */

const semSaida = [...especies.values()].filter(
  (c) => c.evolvesToId > 0 && (c.evolveLevel ?? 0) > TETO_CAPTURA_MAX,
);
console.log(
  semSaida.length
    ? `\n  ✗ ${semSaida.length} espécie(s) ficariam travadas acima do teto — ver a lista acima`
    : `\n  ✓ nenhuma espécie precisa passar do Nv ${TETO_CAPTURA_MAX} para completar a cadeia`,
);

secao('Resumo');
const cortados = linhas.filter((l) => l.depois < l.antes);
console.log(`  ${n(linhas.length)} pares (hunt × espécie) capturáveis`);
console.log(`  ${n(cortados.length)} com teto (${((cortados.length / linhas.length) * 100).toFixed(1)}%)`);
console.log(`  maior corte: ${cortados.length ? `${cortados.reduce((a, b) => (a.antes - a.depois > b.antes - b.depois ? a : b)).nome} — ${n(Math.max(...cortados.map((l) => l.antes - l.depois)))} níveis` : '—'}`);
console.log('');
