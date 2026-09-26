// A POKÉDEX EM TEXTO — o "Copiar Pokédex para o ChatGPT", do lado que monta o arquivo.
//
// Irmão do `wikiEmTexto` (`pokepedia.mjs`): mesmo botão, mesmo destino, propósito oposto. A
// Wiki leva as REGRAS ("como funciona a captura"); isto leva os DADOS ("quanto vale cada
// espécie"). Quem quer perguntar "o que compensa farmar no nível 80?" precisa dos dois, e a
// Wiki sozinha não tem uma única linha de stat-base.
//
// ### Por que é Markdown com TABELA, e não JSON
//
// A tentação é mandar JSON — é o formato que um programa quer. Só que o destinatário aqui não
// é um programa: é uma janela de chat com um orçamento de contexto. JSON repete o nome de cada
// campo em cada uma das centenas de linhas (`"baseSpAtk": 80,` vezes 443) e gasta em chaves o
// espaço que deveria ir em espécies. A tabela escreve o cabeçalho UMA vez, e os modelos leem
// tabela de Markdown tão bem quanto objeto — é o mesmo motivo pelo qual a Wiki sai em Markdown.
//
// ### O que entra, e o que ficou de fora
//
// O pedido foi "não tantas informações, mas as mais necessárias": stats-base, golpes e chance
// de captura. Ficaram de fora os DROPS (uma tabela por espécie, com min/max e preço de NPC —
// sozinha ela dobraria o arquivo) e a tabela de potência (é a MESMA cinco linhas para todas as
// espécies, então cabe no cabeçalho como regra em vez de sair 443 vezes).
//
// ### As três seções, e por que são três e não uma
//
//   1. **espécies** — uma linha por número de dex: tipos, os seis stats, o total, onde ela
//      aparece e por quanto sai da bola. É a tabela que responde "qual é melhor".
//   2. **golpes** — uma linha por espécie, os golpes em sequência. Não cabe como COLUNA da
//      primeira: dez golpes numa célula estouram qualquer largura e quebram a tabela.
//   3. **onde encontrar** — as hunts de cada espécie, com o nível de cada uma. Também não cabe
//      como coluna, e é o que transforma "esta espécie é boa" em "vá para cá".
//
// Nada aqui é escrito à mão: tudo sai do `welcome`, que é a mesma fonte que a ficha da Pokédex
// desenha. A ÚNICA conta duplicada é a de chance de captura, e ela chega pronta de fora
// (`chanceDeCaptura`, no app.js, que já é o espelho declarado de `sim.mjs`) justamente para não
// virar uma terceira cópia da fórmula.

/** Uma célula de tabela não pode conter `|` cru — ele fecha a coluna no meio da palavra. */
const cel = (v) => String(v ?? '—').replace(/\|/g, '/').replace(/\s*\n+\s*/g, ' ').trim() || '—';

/** Número com separador de milhar, do jeito que um modelo lê sem confundir com decimal. */
const n = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString('en-US') : '—');

/**
 * Porcentagem com as casas que o número merece — mesma escada do `pct` da ficha.
 *
 * O separador é PONTO, e não vírgula, mesmo na exportação em português: o arquivo vai para um
 * modelo que lê em inglês por baixo, e "0,5" ali vira quinhentos.
 */
const pctGpt = (v) => {
  if (!Number.isFinite(v) || v <= 0) return '0%';
  const casas = v >= 0.1 ? 1 : v >= 0.001 ? 2 : v >= 0.00001 ? 4 : 6;
  return `${(v * 100).toFixed(casas)}%`;
};

/** "1 in 24,000" — a leitura que se entende de uma chance minúscula. */
const umEmGpt = (c) => (c > 0 ? `1 in ${n(Math.round(1 / c))}` : '—');

/**
 * Um golpe em colunas separadas por `|`, e não numa frase.
 *
 * A seção de golpes é ~76% do arquivo, e a frase por extenso —
 * `Power Whip (lv 1, power 120, 15.0s, PHYSICAL, GRASS)` — repete `lv`, `power` e `s` uma vez
 * por golpe, em milhares de golpes. São ~50 caracteres para carregar 6 valores.
 *
 * O formato em colunas leva os mesmos 6 valores em ~27, e o que paga a conta é a LEGENDA: ela
 * é escrita UMA vez, no cabeçalho, e a partir dali o modelo lê `Power Whip|1|120|15|F|GRASS`
 * sem ambiguidade. É a mesma economia que fez a tabela de espécies ser tabela e não JSON.
 *
 * A categoria vira uma letra (`F`/`E`) pelo mesmo motivo — `PHYSICAL` e `SPECIAL` são 8 e 7
 * caracteres repetidos milhares de vezes para distinguir duas coisas.
 *
 * O cooldown sai em segundos INTEIROS quando é redondo (a esmagadora maioria: 5, 20, 30) e com
 * uma casa quando não é. `15` diz o mesmo que `15.0` e economiza dois caracteres por golpe.
 */
function golpeCompacto(g) {
  const seg = (Number(g.cooldownMs) || 0) / 1000;
  const cd = Number.isInteger(seg) ? String(seg) : seg.toFixed(1);
  const cat = g.category === 'SPECIAL' ? 'E' : g.category === 'PHYSICAL' ? 'F' : '?';
  return `${g.name}|${g.learnLevel ?? 1}|${g.power ?? 0}|${cd}|${cat}|${g.type ?? '?'}`;
}

const ROTULOS = {
  pt: {
    titulo: 'Pokédex do PokeIdle — dados por espécie',
    intro:
      'Este arquivo é a Pokédex completa deste servidor, exportada de dentro do jogo. Os números '
      + 'são os DESTE servidor, não os do Pokémon original: stats-base, golpes, níveis de hunt e '
      + 'chances de captura foram reequilibrados. Use só o que está aqui.',
    comoUsar: 'Responda em português. Ao comparar espécies, diga qual conta você usou.',
    secEspecies: 'Espécies',
    secGolpes: 'Golpes por espécie',
    secOnde: 'Onde encontrar',
    secRegras: 'As regras que os números seguem',
    colunas: ['#', 'Nome', 'Tipos', 'HP', 'ATK', 'DEF', 'SpATK', 'SpDEF', 'SPD', 'Total',
      'Nv hunt', 'Nv ao capturar', 'Preço NPC', 'Shiny?', 'Você (abates/capturas)'],
    semGolpes: 'sem golpes no catálogo',
    semHunt: 'não aparece em hunt nenhuma (boss, evolução ou só por troca)',
    boss: 'BOSS',
    bossEvento: 'BOSS de evento — ainda não disponível',
    ondeBoss: 'arena de boss (nível de equipe {nv}) — não se captura, não aparece em hunt',
    ondeBossEvento: 'boss de evento ainda sem arena — não aparece em hunt, não se captura e não solta loot',
    mega: 'MEGA',
    ondeMega: 'forma Mega — não se captura nem aparece em hunt; sai de um pokémon da espécie base '
      + 'gastando a Mega Stone dela (10 Fragmentos de Mega Stone, que caem em boss, no Professor Carvalho)',
    legendaTxt: [
      '`#` é o número da Pokédex; `Total` é a soma dos seis stats-base (BST).',
      '`Nv hunt` é o MENOR nível de hunt em que a espécie aparece — o degrau em que dá para começar a caçá-la.',
      '`Nv ao capturar` é o nível com que ela sai da pokébola: o teto de captura corta em 20/40/100 conforme o estágio evolutivo, então ele já vem aplicado (não refaça a conta).',
      '`Preço NPC` é o que o NPC paga por ela. `0` quer dizer "não está à venda" — e é justamente isso que a torna mais difícil de capturar, porque a raridade da fórmula sai do preço.',
      '`Você (abates/capturas)` é o progresso da conta que exportou este arquivo.',
      'Linha marcada com `BOSS` é um boss de arena: não se captura. `Nv hunt`, `Nv ao capturar`, `Preço NPC`, `Shiny?` e as colunas de bola vêm como `—` porque nenhuma delas existe para ele — o nível da arena está em "Onde encontrar". `BOSS de evento` é boss cuja arena ainda não foi feita.',
      'A linha marcada com `MEGA` é uma Mega Evolução (`#3000+`): ela também não se captura — é FABRICADA a partir de um pokémon da espécie base com a Mega Stone daquela espécie. As bases e os tipos dela já são os da mega.',
      'Os golpes vêm em colunas separadas por `|`, nesta ordem: `nome|nível em que aprende|power|cooldown em segundos|categoria|tipo`. `F` é físico e `E` é especial; `power 0` é golpe de status.',
    ],
    capTitulo: 'Chance de captura',
    capIntro:
      'A chance é por ARREMESSO, sobre o corpo já derrubado — é assim que se captura no jogo: '
      + 'derruba primeiro, arremessa depois. A coluna `1/…` da tabela de espécies é 1/chance: '
      + 'quantos daquela espécie se derruba, em média, até um ficar na bola.',
    capEscala:
      'A chance da tabela de espécies é a da melhor bola. Para outra bola, multiplique pela razão '
      + 'entre as eficiências (o resultado ainda é limitado pelo piso e pelo teto da fórmula).',
    colBola: 'Bola',
    colEficiencia: 'Eficiência',
    shinySim: 'sim',
    shinyNao: 'não',
    shinyRegra: 'Shiny: {pct} ({um}) por captura, e só nas espécies marcadas com "sim".',
    total: 'Total de espécies neste arquivo: {n}.',
  },
  en: {
    titulo: 'PokeIdle Pokédex — per-species data',
    intro:
      'This file is the full Pokédex of this server, exported from inside the game. The numbers '
      + "are THIS server's, not the original Pokémon ones: base stats, moves, hunt levels and "
      + 'catch rates were rebalanced. Use only what is here.',
    comoUsar: 'Answer in English. When comparing species, state which computation you used.',
    secEspecies: 'Species',
    secGolpes: 'Moves per species',
    secOnde: 'Where to find',
    secRegras: 'The rules the numbers follow',
    colunas: ['#', 'Name', 'Types', 'HP', 'ATK', 'DEF', 'SpATK', 'SpDEF', 'SPD', 'Total',
      'Hunt lv', 'Lv on catch', 'NPC price', 'Shiny?', 'You (knockouts/catches)'],
    semGolpes: 'no moves in the catalogue',
    semHunt: 'appears in no hunt (boss, evolution or trade only)',
    boss: 'BOSS',
    bossEvento: 'event BOSS — not available yet',
    ondeBoss: 'boss arena (team level {nv}) — cannot be caught, appears in no hunt',
    ondeBossEvento: 'event boss with no arena yet — appears in no hunt, cannot be caught and drops no loot',
    mega: 'MEGA',
    ondeMega: 'Mega form — cannot be caught and appears in no hunt; it comes from a base-species pokémon '
      + 'spending its Mega Stone (10 Mega Stone Fragments, which drop from bosses, at Professor Oak)',
    legendaTxt: [
      '`#` is the Pokédex number; `Total` is the sum of the six base stats (BST).',
      '`Hunt lv` is the LOWEST hunt level where the species appears — the step where you can start hunting it.',
      '`Lv on catch` is the level it comes out of the ball at: the catch cap trims to 20/40/100 by evolution stage, so it is already applied (do not redo the maths).',
      '`NPC price` is what the NPC pays for it. `0` means "not for sale" — and that is exactly what makes it harder to catch, because the rarity term comes from the price.',
      '`You (knockouts/catches)` is the progress of the account that exported this file.',
      'A row marked `BOSS` is an arena boss: it cannot be caught. `Hunt lv`, `Lv on catch`, `NPC price`, `Shiny?` and the ball columns come as `—` because none of them exist for it — the arena level is under "Where to find". `event BOSS` is a boss whose arena has not been built yet.',
      'A row marked `MEGA` is a Mega Evolution (`#3000+`): it is not caught either — it is CRAFTED from a pokémon of the base species with that species\' Mega Stone. Its base stats and types are the mega ones, already swapped in.',
      'Moves come as `|`-separated columns, in this order: `name|level learned|power|cooldown in seconds|category|type`. `F` is physical and `E` is special; `power 0` is a status move.',
    ],
    capTitulo: 'Catch chance',
    capIntro:
      'The chance is per THROW, at an already knocked-out target — that is how catching works in '
      + 'this game: knock out first, then throw. The `1/…` column of the species table is '
      + '1/chance: how many of that species you knock out, on average, before one stays in the ball.',
    capEscala:
      'The chance in the species table is the best ball. For another ball, multiply by the ratio '
      + 'of efficiencies (the result is still clamped by the formula floor and ceiling).',
    colBola: 'Ball',
    colEficiencia: 'Efficiency',
    shinySim: 'yes',
    shinyNao: 'no',
    shinyRegra: 'Shiny: {pct} ({um}) per catch, and only on species marked "yes".',
    total: 'Total species in this file: {n}.',
  },
  es: {
    titulo: 'Pokédex de PokeIdle — datos por especie',
    intro:
      'Este archivo es la Pokédex completa de este servidor, exportada desde dentro del juego. '
      + 'Los números son los DE ESTE servidor, no los del Pokémon original: stats base, '
      + 'movimientos, niveles de hunt y probabilidades de captura fueron reequilibrados. Usa solo '
      + 'lo que está aquí.',
    comoUsar: 'Responde en español. Al comparar especies, di qué cuenta usaste.',
    secEspecies: 'Especies',
    secGolpes: 'Movimientos por especie',
    secOnde: 'Dónde encontrar',
    secRegras: 'Las reglas que siguen los números',
    colunas: ['#', 'Nombre', 'Tipos', 'HP', 'ATK', 'DEF', 'SpATK', 'SpDEF', 'SPD', 'Total',
      'Nv hunt', 'Nv al capturar', 'Precio NPC', '¿Shiny?', 'Tú (derrotas/capturas)'],
    semGolpes: 'sin movimientos en el catálogo',
    semHunt: 'no aparece en ninguna hunt (boss, evolución o solo por intercambio)',
    boss: 'BOSS',
    bossEvento: 'BOSS de evento — todavía no disponible',
    ondeBoss: 'arena de boss (nivel de equipo {nv}) — no se captura, no aparece en ninguna hunt',
    ondeBossEvento: 'boss de evento aún sin arena — no aparece en hunt, no se captura y no suelta loot',
    mega: 'MEGA',
    ondeMega: 'forma Mega — no se captura ni aparece en hunt; sale de un pokémon de la especie base '
      + 'gastando su Mega Stone (10 Fragmentos de Mega Stone, que caen en boss, con el Profesor Oak)',
    legendaTxt: [
      '`#` es el número de la Pokédex; `Total` es la suma de los seis stats base (BST).',
      '`Nv hunt` es el MENOR nivel de hunt donde aparece la especie — el escalón en que puedes empezar a cazarla.',
      '`Nv al capturar` es el nivel con el que sale de la pokébola: el tope de captura corta en 20/40/100 según la etapa evolutiva, así que ya viene aplicado (no rehagas la cuenta).',
      '`Precio NPC` es lo que el NPC paga por ella. `0` significa "no está a la venta" — y es justo eso lo que la hace más difícil de capturar, porque la rareza de la fórmula sale del precio.',
      '`Tú (derrotas/capturas)` es el progreso de la cuenta que exportó este archivo.',
      'Una fila marcada con `BOSS` es un boss de arena: no se captura. `Nv hunt`, `Nv al capturar`, `Precio NPC`, `¿Shiny?` y las columnas de bola vienen como `—` porque ninguna existe para él — el nivel de la arena está en "Dónde encontrar". `BOSS de evento` es un boss cuya arena todavía no se hizo.',
      'La fila marcada con `MEGA` es una Mega Evolución (`#3000+`): tampoco se captura — se FABRICA a partir de un pokémon de la especie base con la Mega Stone de esa especie. Sus bases y tipos ya son los de la mega.',
      'Los movimientos vienen en columnas separadas por `|`, en este orden: `nombre|nivel en que se aprende|power|cooldown en segundos|categoría|tipo`. `F` es físico y `E` es especial; `power 0` es movimiento de estado.',
    ],
    capTitulo: 'Probabilidad de captura',
    capIntro:
      'La probabilidad es por LANZAMIENTO, sobre el cuerpo ya derribado — así se captura en este '
      + 'juego: primero derribas, después lanzas. La columna `1/…` de la tabla de especies es '
      + '1/probabilidad: cuántos de esa especie derribas, en promedio, hasta que uno se queda en la bola.',
    capEscala:
      'La probabilidad de la tabla de especies es la de la mejor bola. Para otra bola, multiplica '
      + 'por la razón entre las eficiencias (el resultado sigue limitado por el piso y el techo de la fórmula).',
    colBola: 'Bola',
    colEficiencia: 'Eficiencia',
    shinySim: 'sí',
    shinyNao: 'no',
    shinyRegra: 'Shiny: {pct} ({um}) por captura, y solo en las especies marcadas con "sí".',
    total: 'Total de especies en este archivo: {n}.',
  },
};

/** Uma linha de tabela Markdown a partir das células. */
const linha = (cels) => `| ${cels.map(cel).join(' | ')} |`;

/** Cabeçalho + separador + corpo de uma tabela Markdown. */
const tabela = (colunas, linhas) =>
  [linha(colunas), `|${colunas.map(() => '---').join('|')}|`, ...linhas].join('\n');

/**
 * A Pokédex inteira, na língua pedida, com os números deste servidor.
 *
 * Recebe TUDO por parâmetro (nada de `estado` global) porque este módulo é o gêmeo de
 * `wikiEmTexto` e, como ele, precisa rodar num teste em Node sem DOM nem sessão. Quem monta o
 * pacote é o app.js, que já tem os helpers da Pokédex à mão.
 *
 * @param {object} p
 * @param {string}   p.lang           idioma da exportação ('pt' | 'en' | 'es')
 * @param {object[]} p.especies       uma por número de dex, já ordenadas (`especiesPokedex()`)
 * @param {Function} p.dexDe          `(esp) => número da dex mostrado`
 * @param {Function} p.golpesDe       `(esp) => [{ name, learnLevel, power, cooldownMs, category, type }]`
 * @param {Function} p.huntsDe        `(esp) => [{ nome, nivel }]` — as hunts em que ela aparece
 * @param {Function} p.nivelCapturaDe `(esp, nivelHunt) => nível ao sair da bola`
 * @param {Function} p.chanceDe       `(esp, catchRate) => 0..1` — o espelho de `chanceCaptura`
 * @param {Function} p.temShiny       `(esp) => bool`
 * @param {Function} p.bossDe         `(esp) => catálogo do boss, ou null`
 * @param {Function} p.bossEventoDe   `(esp) => bool` — boss anunciado, mas ainda sem arena
 * @param {Function} p.progressoDe    `(esp) => { k, c }` — abates e capturas da conta
 * @param {object[]} p.bolas          `estado.catalogoBolas`
 * @param {number}   p.chanceShiny    a chance de shiny do servidor
 * @param {string}   p.cabecalho      a linha de instrução que vai na frente (traduzida no app)
 */
export function pokedexEmTexto({
  lang = 'pt',
  especies = [],
  dexDe = (e) => e?.pokeId ?? 0,
  golpesDe = () => [],
  huntsDe = () => [],
  nivelCapturaDe = (e, nv) => nv,
  chanceDe = () => 0,
  temShiny = () => false,
  bossDe = () => null,
  bossEventoDe = () => false,
  megaDe = () => false,
  progressoDe = () => ({ k: 0, c: 0 }),
  bolas = [],
  chanceShiny = 0,
  cabecalho = '',
} = {}) {
  const L = ROTULOS[lang] ?? ROTULOS.pt;
  const partes = [];

  if (cabecalho) partes.push(cabecalho, '');
  partes.push(`# ${L.titulo}`, '', L.intro, '', L.comoUsar, '');

  // ------------------------------------------------------------- as regras
  //
  // O bloco de regras vem ANTES das tabelas de propósito: sem ele o modelo não sabe que
  // "Nv ao capturar" já traz o teto aplicado, e refaria a conta em cima de um número que já
  // é o resultado dela.
  partes.push(`## ${L.secRegras}`, '');
  partes.push(...L.legendaTxt.map((x) => `- ${x}`));
  if (chanceShiny > 0) {
    partes.push(`- ${L.shinyRegra
      .replace('{pct}', pctGpt(chanceShiny))
      .replace('{um}', umEmGpt(chanceShiny))}`);
  }
  partes.push(`- ${L.total.replace('{n}', n(especies.length))}`, '');

  // -------------------------------------------------------- captura por bola
  //
  // A chance de captura depende da ESPÉCIE (a raridade entra na conta) e da BOLA. As duas
  // dimensões juntas dariam cinco colunas a mais por espécie — a tabela principal estouraria
  // para pagar por um número que é proporcional. A saída é a mesma da ficha do jogo: a
  // eficiência de cada bola aqui em cima, e na tabela de baixo a chance com a MELHOR delas.
  const melhorBola = bolas.reduce(
    (m, b) => ((Number(b?.catchRate) || 0) > (Number(m?.catchRate) || 0) ? b : m),
    null,
  );
  if (bolas.length) {
    partes.push(`## ${L.capTitulo}`, '', L.capIntro, '', L.capEscala, '');
    partes.push(
      tabela([L.colBola, L.colEficiencia], bolas.map((b) => linha([b.nome, `x${b.catchRate}`]))),
      '',
    );
  }

  // -------------------------------------------------------------- as tabelas
  //
  // As três saem do MESMO laço: percorrer as espécies uma vez e distribuir em três listas é o
  // que garante que a linha 200 da tabela de golpes é a mesma espécie da linha 200 da de cima.
  const colunas = [...L.colunas];
  if (melhorBola) colunas.push(`${melhorBola.nome} %`, '1/…');

  const linhasEsp = [];
  const linhasGolpes = [];
  const linhasOnde = [];

  for (const esp of especies) {
    const dexN = dexDe(esp);
    const rot = `#${String(dexN).padStart(3, '0')} ${esp.name}`;
    const hunts = huntsDe(esp) ?? [];
    // O `huntLevel` do catálogo é o fallback de quem não aparece em hunt nenhuma (boss e as
    // espécies que só chegam por evolução) — a ficha do jogo usa exatamente este mesmo desvio.
    const nivelHunt = hunts.length
      ? Math.min(...hunts.map((h) => Number(h.nivel) || 1))
      : Math.max(1, Number(esp.huntLevel) || 5);
    const prog = progressoDe(esp) ?? { k: 0, c: 0 };
    const tipos = [esp.type1, esp.type2].filter(Boolean).join('/');
    const total = ['baseHp', 'baseAtk', 'baseDef', 'baseSpAtk', 'baseSpDef', 'baseSpeed']
      .reduce((s, k) => s + (Number(esp[k]) || 0), 0);
    const boss = bossDe(esp);
    // Boss não se captura — nem o que já tem arena, nem o de evento. Todas as células que só
    // fazem sentido para quem entra numa pokébola saem como `—`: o modelo que recebe este
    // arquivo é exatamente quem, vendo "Beast Ball 2,55%" na linha do Kyogre, montaria um
    // plano de farm para uma jogada que o jogo não tem.
    const bossEvento = !boss && !!bossEventoDe(esp);
    const ehBoss = !!boss || bossEvento;
    // A MEGA não se captura também — ela se FABRICA. Sem esta marca, o arquivo entregava ao
    // modelo um Mega Gengar com "Nv de hunt 100" e uma chance de Beast Ball, e a resposta que
    // sairia dali seria um plano de farm para uma caçada que o jogo não tem. Mesmo tratamento
    // do boss, e pela mesma razão. Ver `shared/megas.mjs`.
    const ehMega = !ehBoss && !!megaDe(esp);
    const semCaptura = ehBoss || ehMega;
    const rotuloBoss = bossEvento ? L.bossEvento : ehMega ? L.mega : L.boss;

    const cels = [
      dexN,
      semCaptura ? `${esp.name} (${rotuloBoss})` : esp.name,
      tipos || 'NORMAL',
      n(esp.baseHp), n(esp.baseAtk), n(esp.baseDef),
      n(esp.baseSpAtk), n(esp.baseSpDef), n(esp.baseSpeed),
      n(total),
      semCaptura ? '—' : n(nivelHunt),
      semCaptura ? '—' : n(nivelCapturaDe(esp, nivelHunt)),
      // O preço de NPC da mega vale (ela se vende como qualquer pokémon), e a forma SHINY dela
      // existe — é a Shiny Mega Stone que a entrega. Só as duas colunas de CAPTURA saem vazias.
      ehBoss ? '—' : n(esp.priceNpc ?? 0),
      ehBoss ? '—' : temShiny(esp) ? L.shinySim : L.shinyNao,
      `${n(prog.k)}/${n(prog.c)}`,
    ];
    if (melhorBola) {
      const ch = semCaptura ? 0 : Number(chanceDe(esp, melhorBola.catchRate)) || 0;
      cels.push(semCaptura ? '—' : pctGpt(ch), ch > 0 ? n(Math.ceil(1 / ch)) : '—');
    }
    linhasEsp.push(linha(cels));

    // Ordenados pelo nível em que se aprende: é a ordem em que o pokémon de fato os ganha, e
    // a que responde "o que ele sabe fazer no nível 30".
    const golpes = (golpesDe(esp) ?? [])
      .slice()
      .sort((a, b) => (a.learnLevel ?? 1) - (b.learnLevel ?? 1) || String(a.name).localeCompare(String(b.name)))
      .map(golpeCompacto);
    linhasGolpes.push(`- **${rot}** — ${golpes.length ? golpes.join('; ') : L.semGolpes}`);

    const onde = hunts
      .slice()
      .sort((a, b) => (Number(a.nivel) || 0) - (Number(b.nivel) || 0))
      .map((h) => `${h.nome} (lv ${n(h.nivel)})`)
      .join(', ');
    const ondeBoss = boss
      ? L.ondeBoss.replace('{nv}', n(boss.level ?? 0))
      : bossEvento
        ? L.ondeBossEvento
        : ehMega
          ? L.ondeMega
          : null;
    linhasOnde.push(`- **${rot}** — ${ondeBoss || onde || L.semHunt}`);
  }

  partes.push(`## ${L.secEspecies}`, '', tabela(colunas, linhasEsp), '');
  partes.push(`## ${L.secGolpes}`, '', ...linhasGolpes, '');
  partes.push(`## ${L.secOnde}`, '', ...linhasOnde, '');

  return partes.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
