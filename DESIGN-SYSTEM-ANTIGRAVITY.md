# PokéIdle Hub — Design System para Antigravity

## Objetivo

Construir um companion de dados para PokéIdle com o mesmo **vocabulário visual de um produto de estatísticas competitivo**: escuro, compacto, técnico e dirigido por tabelas. A estrutura de conteúdo é do PokéIdle Hub; o padrão visual é o de interfaces de análise como Blitz.

Não tratar o produto como um fansite, wiki ilustrada ou dashboard SaaS genérico. Não inventar módulos de publicidade, cards premium, barra lateral global, light mode ou banners que não estejam no conteúdo definido.

## Fonte de verdade

- Implementação atual: `dist/index.html`, `dist/app.css`, `dist/overrides.css` e `dist/app.js`.
- Conteúdo e estrutura de cada rota: `CONTEUDO-DO-PROJETO.md`.
- Este arquivo é o contrato visual para evoluções futuras.

## Tokens

```css
:root {
  --bg: #0e1015;
  --surface: #15181e;
  --surface-2: #1a1d23;
  --surface-3: #20242c;
  --line: #30343d;
  --line-soft: #282c34;
  --text: #ebeef0;
  --muted: #a5a9b2;
  --subtle: #737984;
  --yellow: #f4af25;
  --cyan: #30d9d3;
  --pink: #ff376e;
  --green: #22d656;
  --blue: #6672ed;
  --radius-control: 6px;
  --radius-card: 12px;
  --radius-table: 15px;
}
```

Tipografia: `Inter, system-ui, sans-serif`. Usar 400/500 para texto, 600–800 para navegação, cabeçalhos e dados importantes. Títulos têm tracking levemente negativo; labels de tabela usam caixa alta, 10px e tracking positivo.

Espaçamento base: 4px. Ritmos usuais: 7–9px entre controles, 12px entre módulos, 17–20px no conteúdo da página, 14–18px de padding de cards.

## Estrutura global

### Header

- Uma única barra de 48px, fundo `--surface`, borda inferior `#21252d`.
- Da esquerda para a direita: wordmark PokéIdle, navegação do produto, busca global, CTA Discord.
- A navegação não é uma sidebar e não deve virar uma segunda faixa no desktop.
- Item ativo: texto branco e sublinhado amarelo de 3px encostado à base.
- Busca global: 340 × 32px, fundo `#22262e`, ícone à esquerda e atalho discreto à direita.
- CTA Discord: vermelho/rosa, 36px de altura, ícone SVG do Discord e texto branco. É a única ação global chamativa.

### Página

- Canvas: `--bg`.
- Largura máxima: 1400px; padding desktop: 17px vertical e 20px horizontal.
- Em telas estreitas, a navegação pode rolar horizontalmente abaixo do header. Não esconder acesso às rotas.

## Componentes

### Abas locais

Usadas em Pokédex. Altura 47px, fundo transparente, borda inferior contínua. A aba ativa usa texto branco e indicador amarelo de 3px. Não usar pills grandes.

### Filtros e selects

- Controle padrão: altura mínima 36px, fundo `#1d2027`, borda `#3a3f48`, raio 8px, texto 12px.
- Busca da tabela: largura 202px, ícone de lupa grande e texto mais discreto.
- Select: texto à esquerda e chevron à direita, largura mínima 104px.
- Filtros booleanos: quadrado de 13px antes do texto; não transformar em botão primário.
- Botões de Pokébola: controles compactos, `#282c35`; opção ativa azul `#6873e9`.

#### Pokédex — Captura e Shiny

Primeira linha:

`Buscar Pokémon` · `Tipo` · `Tipo` · `Região` · `Apenas Shiny` | grupo `Pokébola` (Poké Ball, Great Ball, Super Ball, Ultra Ball, Beast Ball)

Segunda linha, alinhada sob o grupo de Pokébola:

`BOOSTS ATIVOS` · `Capture Boost` · `Shiny Lure`

`Apenas Shiny` é um dropdown, não checkbox.

#### Pokédex — Hunting

Usar apenas **um** seletor `Tipo`. Os demais filtros pertencem a nível, região, fraquezas, resistências, imunidade e XP Boost.

### Tabelas de dados

O componente mais importante do produto.

- Painel externo: `#191c22`, borda `#2d323a`, raio 15px e sombra suave profunda.
- Tabela mínima de 950px; em telas menores, rolagem horizontal interna. Nunca esconder colunas para “caber”.
- Cabeçalho: 36px de altura, 10px, uppercase, texto `#9fa4ad`.
- Linha: 47px, borda superior `#30343c`, padding lateral 19px, texto 13px.
- Alternância muito sutil: `#1a1d23` e `#181b21`.
- Nome do Pokémon: branco, semibold, com miniatura 31 × 31px à esquerda.
- Métricas positivas: ciano; XP/destaque de farm: amarelo; ganhos: verde; ação auxiliar: botão azul pequeno.
- Tipos são badges compactas de 8px, uppercase e cores semânticas.
- A tabela pode ser longa; não usar paginação visual se a origem de dados ainda não a exigir.

### Botões

- Primário contextual: amarelo, texto escuro em uppercase, peso 800, raio 6px.
- Secundário: fundo `#22262e`, borda `#3a3f49`, texto claro.
- CTA Discord: rosa/vermelho; exclusivo para Discord/download/ação de aquisição.
- Ação em tabela: azul, pequena, raio 5px, texto branco.
- Não usar gradientes em botões exceto se o CTA Discord precisar reproduzir o acabamento rosa atual.

### Cards e painéis

- Card padrão: `--surface`, borda `#2f343d`, raio 12px, sombra sutil.
- Cards devem ser exceção quando a informação for navegacional, editorial ou de upload. Dados comparáveis devem ficar em tabela.
- Home: as imagens funcionam como fundo. Textos e ações têm uma sobreposição escura em gradiente para preservar legibilidade.

### Home

- Hero na relação 16:3 (referência: 1600 × 300).
- Imagem ocupa todo o hero. O bloco “Jogue agora” fica sobreposto, à direita, com fundo quase opaco `rgba(21,24,30,.95)`.
- Quatro cards menores em grade no desktop, com imagem de fundo e conteúdo sobreposto.
- Dois cards horizontais no fim seguem a mesma regra.
- Mobile: hero fica mais alto e o CTA passa para a base, ocupando a largura interna.

### Navegação de conteúdo

- Guia e Wiki podem ter navegação contextual própria dentro da página.
- Isso não autoriza uma sidebar global; manter o header do produto como navegação principal.

## Estados e acessibilidade

- Estados ativos são comunicados por cor **e** posição/indicador (aba sublinhada, botão selecionado, checkbox visível).
- Foco de teclado: anel azul discreto, visível sobre fundos escuros.
- Manter contraste alto entre `--text` e superfícies.
- Ícones decorativos não recebem rótulo; botões só com ícone precisam de `aria-label`.

## Responsividade

- Desktop: header com navegação e busca em uma linha; tabelas densas.
- Até 900px: grids podem reduzir para duas ou uma coluna; tabelas mantêm todas as colunas via scroll horizontal.
- Até 820px: navegação do produto rola horizontalmente abaixo do header; página ganha espaço superior equivalente.
- Até 580px: cards em uma coluna, busca global flexível, header simplificado; não remover a navegação crítica.

## Regras de decisão para o Antigravity

1. Antes de criar um card, perguntar: isto é dado comparável? Se sim, usar tabela ou lista densa.
2. Antes de criar um novo acento de cor, usar um token existente e preservar sua função: amarelo = primário/ativo; azul = seleção/ação de detalhe; ciano = métrica positiva; rosa = Discord; verde = ganho/novo.
3. Antes de adicionar uma seção visual, conferir se ela existe no conteúdo definido. Não adicionar anúncios, “Remove Ads”, premium rail, rankings de League of Legends ou módulos de terceiros.
4. Não substituir superfícies escuras por branco, vidro translúcido, degradês coloridos extensos ou cards SaaS arredondados demais.
5. Manter o uso de imagem como fundo apenas na Home, Guias e áreas editoriais; tabelas e ferramentas devem continuar sóbrias e utilitárias.

## Checklist visual antes de entregar

- [ ] O fundo geral é `#0e1015` e as superfícies são escuras, discretamente separadas por bordas.
- [ ] Header tem 48px e uma única linha no desktop.
- [ ] Aba ativa e navegação ativa têm indicador amarelo fino.
- [ ] Filtros têm 36px e aparência compacta; não há pills gigantes.
- [ ] Tabelas possuem cabeçalho de 36px, linhas de 47px e rolagem horizontal no mobile.
- [ ] Botão primário é amarelo; ação de tabela é azul; Discord é rosa/vermelho.
- [ ] Não há sidebar global, modo claro ou publicidade inventada.
- [ ] A mudança foi conferida no navegador, em desktop e em largura estreita quando alterar layout.
