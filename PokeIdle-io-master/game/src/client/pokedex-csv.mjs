/**
 * A Pokédex inteira como CSV — o arquivo que se ANEXA numa IA, em vez de colar no chat.
 *
 * ### Por que isto existe ao lado do "Copiar para o GPT"
 *
 * O botão de copiar (`pokedex-gpt.mjs`) monta um texto de ~590 kB, e esse é o problema: ele não
 * cabe numa conversa. Colado, é cortado; e o modelo, sem o resto, completa a resposta com o que
 * ele sabe de Pokémon em geral — que não são os números DESTE servidor. Foi assim que um jogador
 * recebeu uma lista de golpes com "0 de poder" que não existem aqui: o catálogo do jogo não tem
 * um único golpe de poder zero.
 *
 * Anexado como arquivo, o caminho é outro: a IA abre o CSV com a ferramenta de planilha e
 * CONSULTA as 11 mil linhas em vez de tentar lê-las. Pergunta como "todo golpe com cooldown
 * abaixo de 5 s" passa a ter resposta exata em vez de palpite.
 *
 * Os dois botões ficam: o texto continua melhor para conversar ("me explique este jogo"), e o
 * CSV é melhor para contar ("quantos / quais / ordene por").
 *
 * ### Uma linha por (espécie × golpe), com os stats repetidos
 *
 * É desnormalizado de propósito. Duas tabelas separadas seriam 300 kB menores e obrigariam a
 * IA — e o jogador — a juntar as duas por um `dex` antes de qualquer pergunta. Com tudo na
 * mesma linha, "o golpe mais rápido entre os pokémon de ATK alto" é uma pergunta só. Perguntas
 * de espécie custam um `drop_duplicates('dex')`, que é trivial do outro lado.
 *
 * Nenhuma espécie se perde: quem não tem golpe no catálogo sai numa linha com as colunas de
 * golpe vazias, em vez de sumir do arquivo.
 *
 * ### Isto NÃO passa pelo servidor
 *
 * O catálogo já está no navegador — desce uma vez no login (`/assets/creatures.json`, servido
 * comprimido) e vive em `estado.especies`. O CSV é montado em memória e salvo por `blob:`.
 * Quantos jogadores cliquem, e quantas vezes, não muda um byte de banda do servidor: não há
 * requisição nenhuma. Era a dúvida certa a levantar antes de pôr um botão de download num jogo
 * com gente entrando o dia inteiro — e a resposta é que o custo é zero.
 */

/** `dano_por_s` é o que a pergunta "esse golpe está forte demais?" precisa, e ninguém calcula à mão. */
const danoPorSegundo = (poder, segundos) => (segundos > 0 ? (poder / segundos).toFixed(1) : '');

/**
 * Escapa uma célula. Vírgula, aspas e quebra de linha são o que quebra CSV, e nome de espécie
 * traz as três mais do que se imagina (`Farfetch'd`, `Mr. Mime`, `Porygon-Z`).
 */
const cel = (v) => {
  const s = String(v ?? '');
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const COLUNAS_CSV = [
  'dex', 'especie', 'tipo1', 'tipo2',
  'hp', 'atk', 'def', 'spatk', 'spdef', 'spd', 'total',
  'nivel_hunt', 'preco_npc',
  'golpe', 'nivel_aprende', 'poder', 'cooldown_s', 'dano_por_s', 'categoria', 'tipo_golpe',
];

const STATS = ['baseHp', 'baseAtk', 'baseDef', 'baseSpAtk', 'baseSpDef', 'baseSpeed'];

/**
 * O CSV da Pokédex.
 *
 * @param especies  a lista já filtrada pela tela (a mesma de `especiesPokedex`)
 * @param golpesDe  `golpesDaFicha` — a MESMA função que desenha a ficha, para o arquivo não
 *                  poder divergir do que o jogador vê
 * @param dexDe     o número de exibição da espécie
 * @param nivelHuntDe  o nível da hunt mais fácil em que ela aparece, ou `null`
 */
export function pokedexEmCsv({
  especies = [],
  golpesDe = () => [],
  dexDe = (e) => e?.pokeId ?? 0,
  nivelHuntDe = () => null,
} = {}) {
  const linhas = [COLUNAS_CSV.join(',')];

  for (const esp of especies) {
    const total = STATS.reduce((s, k) => s + (Number(esp[k]) || 0), 0);
    const base = [
      dexDe(esp), cel(esp.name), esp.type1 ?? '', esp.type2 ?? '',
      Number(esp.baseHp) || 0, Number(esp.baseAtk) || 0, Number(esp.baseDef) || 0,
      Number(esp.baseSpAtk) || 0, Number(esp.baseSpDef) || 0, Number(esp.baseSpeed) || 0, total,
      nivelHuntDe(esp) ?? '', Number(esp.priceNpc) || 0,
    ];

    const golpes = (golpesDe(esp) ?? [])
      .slice()
      .sort((a, b) => (a.learnLevel ?? 1) - (b.learnLevel ?? 1)
        || String(a.name).localeCompare(String(b.name)));

    if (!golpes.length) {
      linhas.push([...base, '', '', '', '', '', '', ''].join(','));
      continue;
    }
    for (const g of golpes) {
      const seg = (Number(g.cooldownMs) || 0) / 1000;
      const poder = Number(g.power) || 0;
      linhas.push([
        ...base,
        cel(g.name), g.learnLevel ?? 1, poder, seg, danoPorSegundo(poder, seg),
        g.category === 'SPECIAL' ? 'E' : g.category === 'PHYSICAL' ? 'F' : '',
        g.type ?? '',
      ].join(','));
    }
  }

  return `${linhas.join('\n')}\n`;
}

/**
 * Entrega o arquivo ao jogador.
 *
 * O BOM (`﻿`) vai na frente por uma razão prática e chata: sem ele o Excel em português
 * abre o arquivo em ANSI e todo acento vira caractere estranho — e o jogador conclui que a
 * exportação está quebrada. Quem lê o CSV por programa ignora o BOM.
 *
 * `revokeObjectURL` no fim porque um `blob:` segurado é a cópia inteira do arquivo presa na
 * memória da aba até o F5. Um clique é 900 kB; dez cliques numa sessão longa seriam 9 MB
 * pendurados sem ninguém para usá-los.
 */
export function baixarCsv(nomeArquivo, csv) {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
