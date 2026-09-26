// Renda por kill de cada hunt: o ouro da morte contra o valor esperado do drop.
//
// É a régua da rebalanceamento da economia — mede das MESMAS fontes que o servidor lê no boot,
// então ela e o jogo nunca divergem.
//
//   node tools/auditoria-renda-hunt.mjs            # tabela por marcos de nível
//   node tools/auditoria-renda-hunt.mjs --todas    # uma linha por hunt
import { especies, itensPorNome, huntsJogaveis } from '../src/server/content.mjs';
import { ouroPorDerrotaHunt } from '../src/shared/recompensa-hunt.mjs';
import { itemVendavelAoNpc } from '../src/shared/venda-npc-item.mjs';
import { alvoRendaPorKill } from '../src/shared/economia-drop.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const COMPRAVEIS = new Set(['heal', 'revive']);

/** O que o NPC paga por uma unidade do item. Zero = não compra (espelha `precoDeVenda` no sim). */
export const precoVendaItem = (item) =>
  (itemVendavelAoNpc(item, { categoriasCompraveis: COMPRAVEIS }) ? (item.npcPrice ?? 0) : 0);

/**
 * Valor esperado do loot de uma espécie, em coins por kill.
 *
 * `chance` no catálogo é percentual × 1000 (ver `rolarLoot` em `game/combate.mjs`), e cada
 * entrada rola INDEPENDENTE das outras — então o EV é a soma simples de `p × qtd média × preço`.
 */
export function evLootDaEspecie(esp) {
  let ev = 0;
  for (const l of esp?.loot ?? []) {
    const item = itensPorNome.get((l.name ?? '').toLowerCase());
    const preco = item ? precoVendaItem(item) : 0;
    if (!preco) continue;
    const p = Math.min(100, (l.chance ?? 0) / 1000) / 100;
    const qtd = ((l.minCount ?? 1) + (l.maxCount ?? 1)) / 2;
    ev += p * qtd * preco;
  }
  return ev;
}

/** A renda média de uma hunt, ponderada pelos pontos de spawn de cada espécie. */
export function rendaDaHunt(h) {
  const entradas = (h.especies ?? [])
    .map((e) => ({ esp: especies.get(e.pokeId), peso: e.pontos ?? 1 }))
    .filter((x) => x.esp);
  const total = entradas.reduce((s, x) => s + x.peso, 0) || 1;
  let ouro = 0;
  let ev = 0;
  for (const { esp, peso } of entradas) {
    const w = peso / total;
    ouro += w * ouroPorDerrotaHunt(h, esp.huntLevel ?? 1, esp);
    ev += w * evLootDaEspecie(esp);
  }
  // O ALVO sai do nível das espécies que de fato spawnam, não do marcador da hunt: é o nível do
  // mob que decide o que a kill paga (`nivelSelvagem` → `ouroPorDerrotaHunt`), e há 29 hunts em
  // que o marcador está muito acima disso — ver o aviso no fim da varredura.
  const nivelEspecie = entradas.length
    ? entradas.reduce((s, x) => s + (x.esp.huntLevel ?? 1) * (x.peso / total), 0)
    : 1;
  return {
    slug: h.slug,
    regiao: h.regiao ?? h.area ?? '?',
    nivel: h.nivel ?? entradas[0]?.esp?.huntLevel ?? 1,
    nivelEspecie,
    alvo: alvoRendaPorKill(nivelEspecie),
    ouro,
    ev,
  };
}

export const linhasDeRenda = () =>
  huntsJogaveis.map(rendaDaHunt).filter((l) => l.nivel > 0).sort((a, b) => a.nivel - b.nivel);

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  const linhas = linhasDeRenda();
  const n = (v) => Math.round(v).toLocaleString('pt-BR');
  const linha = (l) => {
    const tot = l.ouro + l.ev;
    const desvio = l.alvo > 0 ? ((tot - l.alvo) / l.alvo) * 100 : 0;
    return [
      String(l.nivel).padStart(7),
      l.slug.padEnd(22),
      String(l.regiao).padEnd(9),
      n(l.ouro).padStart(11),
      n(l.ev).padStart(10),
      n(tot).padStart(11),
      (tot > 0 ? ((l.ev / tot) * 100).toFixed(0) : '0').padStart(5) + '%',
      n(l.alvo).padStart(10),
      (desvio >= 0 ? '+' : '') + desvio.toFixed(0) + '%',
    ].join(' | ');
  };

  console.log([
    '  nível', 'hunt                  ', 'região   ', '  ouro/kill', ' drop/kill', ' total/kill', 'drop%', '      alvo', 'desvio',
  ].join(' | '));

  if (process.argv.includes('--todas')) {
    for (const l of linhas) console.log(linha(l));
  } else {
    const marcos = [1, 5, 10, 20, 30, 50, 80, 100, 150, 200, 300, 500, 700, 1000, 2000, 5000, 10000, 25000, 60000, 160300];
    const vistos = new Set();
    for (const alvo of marcos) {
      const l = linhas.reduce((m, x) => (Math.abs(x.nivel - alvo) < Math.abs(m.nivel - alvo) ? x : m), linhas[0]);
      if (vistos.has(l.slug)) continue;
      vistos.add(l.slug);
      console.log(linha(l));
    }
  }

  // As hunts cujo MARCADOR está muito acima do nível das espécies que ela spawna. É bug de
  // conteúdo, não de economia: `flabebe_kalos` tem marcador 10.000 e um Flabébé de nível 40
  // dentro. A renda segue o mob — pagar pelo marcador daria a melhor fazenda do jogo a quem
  // mata bicho de nível 40 —, então essas hunts pagam pouco até alguém acertar o nível delas.
  const desalinhadas = linhas.filter((l) => l.nivel > l.nivelEspecie * 3);
  if (desalinhadas.length) {
    console.log(`
${desalinhadas.length} hunts com marcador acima de 3× o nível das espécies (bug de conteúdo, a renda segue o mob):`);
    for (const l of desalinhadas.slice(0, 8)) {
      console.log(`   ${l.slug.padEnd(22)} marcador ${String(l.nivel).padStart(6)} · espécie ${l.nivelEspecie.toFixed(0).padStart(5)}`);
    }
  }

  const primeira = linhas[0];
  const ultima = linhas.at(-1);
  const amp = (v) => (v > 0 ? `${Math.round(v).toLocaleString('pt-BR')}×` : '—');
  console.log(`\n${linhas.length} hunts · nível ${primeira.nivel} → ${ultima.nivel}`);
  console.log(`amplitude do ouro/kill: ${amp(ultima.ouro / Math.max(1, primeira.ouro))}`);
  console.log(`amplitude do drop/kill: ${amp(ultima.ev / Math.max(1, primeira.ev))}`);
  console.log(`amplitude da renda total: ${amp((ultima.ouro + ultima.ev) / Math.max(1, primeira.ouro + primeira.ev))}`);
}
