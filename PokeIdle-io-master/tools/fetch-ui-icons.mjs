// Ícones da interface — pokébolas e botões do menu do topo.
//
// Diferente dos outros `fetch-*`, estes NÃO vêm do espelho do idleworld: a maioria sai do
// pokesprite (github.com/msikma/pokesprite, sprites de item em 32×32, licença livre). Dois
// ícones que não existem lá vêm do site original e um de um host avulso.
//
// Tudo cai em `public/data/site/assets/ui/`, que o gateway serve em `/assets/site/...`.
// O nome do arquivo aqui é o NOSSO (o cliente referencia por ele em index.html); o caminho
// de origem fica ao lado para dar para conferir depois.
//
//   node tools/fetch-ui-icons.mjs [--force]
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { grab, pool, resumo, stats, OUT } from './lib.mjs';
import { recortarTransparente } from './png.mjs';

const POKESPRITE = 'https://raw.githubusercontent.com/msikma/pokesprite/master/items';
const FORCE = process.argv.includes('--force');
const DEST = 'site/assets/ui';

const ICONES = [
  // pokébolas do inventário, do market e dos chips de automação (id do catálogo no nome)
  { arquivo: 'ball-poke.png', url: `${POKESPRITE}/ball/poke.png` },
  { arquivo: 'ball-great.png', url: `${POKESPRITE}/ball/great.png` },
  // id 3 (Super Ball): ícone e animação NOSSOS em `src/client/img/` e `src/client/effects/`
  { arquivo: 'ball-ultra.png', url: `${POKESPRITE}/ball/ultra.png` },

  // As três moedas. Os dois sprites de gema (`items/gem/`) são DIFERENTES de propósito: o
  // diamante e a gema já dividiram o mesmo `hold-item/blue-orb.png`, e os dois contadores
  // lado a lado no HUD eram indistinguíveis — o jogador não sabia qual estava gastando.
  { arquivo: 'moeda-ouro.png', url: 'https://engagement-type-majority-medical.trycloudflare.com/img/ui-nugget.png' },
  // DIAMANTE (gelo, ciano) — comprado com PIX/cartão, gasto na Loja. `item_0552` no pokesprite.
  { arquivo: 'moeda-diamante.png', url: `${POKESPRITE}/gem/ice.png` },
  // GEMA (psíquica, rosa) — a antiga ORB, com lastro em USDT, gasta no Mercado da Comunidade.
  // `item_0557`. O nome de arquivo `moeda-orb.png` sumiu junto com o nome antigo.
  { arquivo: 'moeda-gema.png', url: `${POKESPRITE}/gem/psychic.png` },

  // botões do menu do topo e abas das gavetas
  { arquivo: 'menu-pokedex.png', url: `${POKESPRITE}/key-item/poke-radar.png` },
  // O manual do jogo. `item_1271` no pokesprite — um LIVRO, que é o que a Pokepédia é; o
  // Poké Radar ao lado dela já é a Pokédex, e dois ícones iguais no menu não distinguiriam
  // "a lista das espécies" de "como o jogo funciona".
  { arquivo: 'menu-pokepedia.png', url: `${POKESPRITE}/key-item/sonias-book.png` },
  { arquivo: 'menu-mapa.png', url: `${POKESPRITE}/key-item/town-map.png` },
  { arquivo: 'menu-bolsa.png', url: `${POKESPRITE}/key-item/berry-pouch.png` },
  // O TROFÉU. O nome do arquivo é histórico — quem o usa hoje é o botão do CAMPEONATO, não
  // o dos Ranks (que ficou com a coroa, `src/client/img/menu-ranks.png`). O nome não foi
  // trocado porque `public/data` é gitignorado: renomear aqui quebraria o ícone em produção
  // até alguém rodar o deploy do public-data.
  { arquivo: 'menu-ranking.png', url: 'https://poke.idleworld.online/assets/ranking/icon-trophy.png' },
  { arquivo: 'menu-bosses.png', url: `${POKESPRITE}/key-item/coin-case.png` },
  // A Arena PvP: a espada enferrujada (`item_1103`). Era arte nossa em `src/client/img`;
  // vindo do pokesprite ela passa a ter o mesmo tratamento (e o mesmo corte de margem) dos
  // outros botões do menu, que é o que os deixa do mesmo tamanho na barra.
  { arquivo: 'menu-pvp.png', url: `${POKESPRITE}/hold-item/rusted-sword.png` },
  // Ficha PvP (`item_1584`, armor-pass) — item de entrada das arenas, vendido no Market.
  { arquivo: '../items/pvp_ficha.png', url: `${POKESPRITE}/key-item/armor-pass.png` },
  // Dark Gem (`item_0562`) — o espelho usa placeholder; o jogo usa o sprite correto.
  { arquivo: '../items/dark_gem.png', url: `${POKESPRITE}/gem/dark.png` },
  // Goggles (`item_0650` Safety Goggles) — espelho usa `_loot_placeholder.png`.
  { arquivo: '../items/goggles.png', url: `${POKESPRITE}/hold-item/safety-goggles.png` },
  // Farfetch'd Stick — URL morta no espelho; stick do pokesprite é o mais próximo.
  { arquivo: '../items/farfetchd_stick.png', url: `${POKESPRITE}/hold-item/stick.png` },
  // Band Aid — idleworld traz 1 curativo minúsculo num canvas 32×32; produção tem o cluster.
  { arquivo: '../items/band_aid.png', url: 'https://pokeidle.io/assets/site/assets/items/band_aid.png' },
  { arquivo: 'menu-depot.png', url: 'https://poke.idleworld.online/assets/topmenu/breeding.png' },
  // menu-afiliados.png → versionado em `game/src/client/img/` (servido em `/img/`), não no espelho
  { arquivo: 'menu-comunidade.png', url: 'https://poke.idleworld.online/assets/topmenu/icon_viplist.png' },
  {
    arquivo: 'menu-market.png',
    url: 'https://engagement-type-majority-medical.trycloudflare.com/img/ui-town-map.png',
  },

  // Pódio do Ranking: troféu e coroa de louros por colocação. São os desenhos do próprio
  // jogo original (`/assets/ranking/*`), que é de onde vem o pódio de três lugares.
  { arquivo: 'trofeu-1.png', url: 'https://poke.idleworld.online/assets/ranking/icon-trophy.png' },
  { arquivo: 'trofeu-2.png', url: 'https://poke.idleworld.online/assets/ranking/icon-trophy-silver.png' },
  { arquivo: 'trofeu-3.png', url: 'https://poke.idleworld.online/assets/ranking/icon-trophy-rest.png' },
  { arquivo: 'coroa-1.png', url: 'https://poke.idleworld.online/assets/ranking/coroa-gold.png' },
  { arquivo: 'coroa-2.png', url: 'https://poke.idleworld.online/assets/ranking/coroa-silver.png' },
  { arquivo: 'coroa-3.png', url: 'https://poke.idleworld.online/assets/ranking/coroa-bronze.png' },
];

/**
 * Ícones que NÃO podem ter a margem transparente cortada.
 *
 * A coroa de louros do pódio é desenhada por trás do avatar e alinhada pelo centro: recortar
 * a margem muda o centro do desenho e a coroa sai torta em volta do boneco.
 */
const SEM_CORTE = new Set(['coroa-1.png', 'coroa-2.png', 'coroa-3.png', 'band_aid.png']);

const t0 = Date.now();
console.log(`Espelhando ${ICONES.length} ícones de interface\n`);

await pool(ICONES, (i) => grab(i.url, `${DEST}/${i.arquivo}`, FORCE), 'ícones');

// Vários sprites vêm centrados num canvas maior que o desenho — a moeda de ouro é 14×14
// dentro de 30×30. Como a interface desenha o ícone num quadrado com `object-fit: contain`,
// essa margem vira tamanho perdido e o ícone aparece minúsculo. Cortar aqui resolve para
// todo mundo de uma vez, e é idempotente: rodar de novo não corta nada.
let cortados = 0;
for (const { arquivo } of ICONES) {
  if (SEM_CORTE.has(arquivo)) continue;
  const caminho = join(OUT, DEST, arquivo);
  try {
    const r = recortarTransparente(await readFile(caminho));
    if (!r) continue;
    await writeFile(caminho, r.buf);
    console.log(`  recortado ${arquivo}: ${r.antes} → ${r.largura}×${r.altura}`);
    cortados++;
  } catch (err) {
    console.log(`  (sem recorte em ${arquivo}: ${err.message})`);
  }
}
if (cortados) console.log(`\n${cortados} ícone(s) sem a margem transparente.`);

resumo(t0);
process.exit(stats.falhas.length ? 1 : 0);
