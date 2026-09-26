# O personagem do jogador

Como o treinador é colorido, de onde saem as cores e por que a ordem do onboarding é a que é.

Arquivos: [src/client/cores-outfit.mjs](src/client/cores-outfit.mjs) (a colorização),
[src/server/game/visual.mjs](src/server/game/visual.mjs) (a validação) e o bloco *onboarding* do
[app.js](src/client/app.js).

---

## A máscara que já estava lá

Todo outfit humano do pack traz, ao lado de cada quadro no atlas, uma máscara `_template`. O
visualizador do Sprite Lab (`public/viewer.js`) já a lê e já anuncia **"colorizável: sim (tem
máscara `_template`)"** na ficha de cada outfit — só que nunca a usou para nada, e o
`sprites.mjs` do jogo a jogava fora:

```js
if (stem.endsWith('_template')) continue; // máscara de cor, não usamos
```

Era essa a peça que faltava. Nada de arte nova: a customização estava no dado desde o começo.

## As quatro regiões

A máscara tem exatamente as quatro cores mágicas do Tibia, e cada uma marca uma região do
desenho (conferido pixel a pixel nos looktypes 159 e 160):

| cor na máscara | região | o que a tela chama |
|---|---|---|
| amarelo `255,255,0` | cabeça e cabelo | Cabeça |
| vermelho `255,0,0` | tronco | Camisa |
| verde `0,255,0` | pernas | Calça |
| azul `0,0,255` | pés | Sapato |

Pixel fora dessas quatro cores fica **intacto** — o contorno, a pele do rosto, a pokébola na
mão. É por isso que dá para trocar a camisa sem repintar a pessoa.

## Colorir é multiplicar

```
saída = base × cor / 255
```

Multiplicar, e não substituir. O sprite base pinta as áreas colorizáveis em tons claros e
dessaturados; multiplicando, os vincos da roupa continuam escuros e o brilho continua claro, e
só a matiz muda. Trocar o pixel pela cor chapada apagaria o volume e deixaria a roupa parecendo
um adesivo.

## A paleta de 133

Não é uma lista escolhida a dedo: é a fórmula do cliente original — 19 matizes × 7 faixas de
saturação e brilho, mais a coluna 0 de cada faixa, que é a escala de cinza (é dela que saem o
branco, o preto e os cinzas; sem ela não haveria roupa branca).

Usar a mesma fórmula importa por dois motivos: as cores caem sempre em tons que funcionam sobre
o sombreado do sprite, e um outfit montado aqui pode ser descrito pelos mesmos quatro números
que o jogo de origem usaria.

O editor mostra a paleta em **grade**, 19 por linha, na forma em que ela foi gerada — é o que
deixa achar "o mesmo azul, só mais escuro" descendo uma linha. Num varal de 133 amostras, não dá.

O servidor só conhece o **tamanho** da paleta (`CORES = 133`), nunca os valores: ele valida
índice, não pinta pixel.

## A ordem do onboarding, e por que ela é regra de servidor

```
nick (só provedor)  →  gênero  →  cores  →  starter
└─ antes do socket ─┘  └────── dentro do jogo ──────┘
```

O nick fica de fora do quadro dos três passos porque **é a chave da conexão**: conectar antes de
escolhê-lo criaria o `players` com o nome que o Google inventou. Ver `AUTENTICACAO.md`.

O gênero escolhe qual sprite é desenhado — 159 (masculino) ou 160 (feminino), os dois outfits
`kind: trainer` do pack. Não há sprite novo em lugar nenhum.

Antes desta versão, a primeira (e única) pergunta do jogo era qual pokémon inicial: o jogador
escolhia o companheiro do jogo inteiro antes de existir um personagem para acompanhá-lo. A ordem
nova é cobrada pelo **servidor**, não só pela tela:

- `visual.set` recusa quem já tem `visual_ok` — vale uma vez, e depois disso trocar de aparência
  custa uma skin na loja. É isso que dá valor à skin. A trava não pode ser só no cliente: o
  editor some da tela, mas a mensagem continuaria valendo para quem a mandar na mão.
- `starter.pick` recusa quem **não** tem `visual_ok`. Sem essa linha, um cliente adulterado
  entraria no jogo sem nunca ter escolhido nada.

Quem já jogava antes desta versão entra com `visual_ok` falso, dá uma passada pelo editor e segue
direto para o jogo — sem passo de starter, porque já tem pokémon.

`?starter=` (o atalho das ferramentas, mesmo espírito do `?nick=`) fecha o visual no padrão e
pula direto para o último passo. Quem entra por ele quer testar o jogo, não o onboarding.

## Mudar de avatar depois: uma vez por dia

O `visual.set` continua valendo uma vez só — quem quiser **outro boneco** (outfit) compra skin
na loja, e isso não mudou. O que existe agora é o meio-termo que faltava: **`visual.trocar`**,
o botão "Mudar avatar" da ficha do treinador, que refaz gênero e as quatro cores no mesmo
editor do onboarding, **a cada 24 horas**.

Três decisões dentro disso:

- **A espera é do servidor.** `players.visual_trocado_em` é gravado **na hora do clique**, fora
  do write-behind (`db.registrarTrocaDeVisual`). Se ela só chegasse ao banco no flush seguinte,
  trocar e fechar o jogo em menos de 5 segundos devolveria uma troca de graça.
- **Um dia, e não uma hora.** O boneco é como os outros te reconhecem na praça do Centro e no
  chat. Se o vizinho pudesse virar outra pessoa a cada dois minutos, o personagem deixaria de
  identificar alguém — que é justamente para o que ele serve.
- **O looktype só volta ao padrão do gênero se você estava vestindo um padrão.** Quem comprou
  outfit continua com ela: a skin foi paga, e mudar a cor do cabelo não é motivo para tirá-la.

A tela avisa da espera **antes** de confirmar, e o botão da ficha vira o próprio contador
("trocar de novo em 7h") enquanto ela corre. Mas quem recusa é o comando — a tela é aviso.

## Como o visual viaja

No pacote de campo, junto do `lt`, vai o campo `vs`:

```js
vs: [cabeca, corpo, pernas, pes]   // índices da paleta de 133
```

Array e não objeto nomeado porque ele viaja em **todo** pacote em que alguém muda de aparência, e
no Centro Pokémon isso é uma vez por jogador que entra na praça.

O **gênero não vai junto**: ele já está no `looktype` ao lado (159 ou 160), e mandar a mesma
informação duas vezes é convite para as duas divergirem.

## Os dois caches

O sprite **cru** é baixado e cacheado uma vez por looktype. A colorização é uma camada por cima,
com cache próprio por `(looktype, quatro cores)`. Assim dois jogadores com o mesmo outfit e
roupas diferentes dividem o download do atlas e só não dividem o atlas pintado.

O atlas pintado é montado uma vez e depois é só `drawImage` de um retângulo — sem custo por
quadro. Sem esse cache, cada tick do campo repintaria 12 quadros pixel a pixel por treinador na
tela.

No cliente, `garantirSprite` usa `looktype + visual` como chave. Só o looktype não bastava: dois
treinadores com o mesmo outfit e cores diferentes são sprites diferentes, e o segundo herdava as
cores do primeiro.

O ranking também carrega `vs` em cada linha de treinador (`aparencia()`, em `db.mjs`). Sem isso o
placar desenhava o mesmo boneco cinquenta vezes — justamente na tela em que o jogador é comparado
com os outros.

## Conferindo

```bash
npm run test:onboarding   # percorre nick → gênero → cores → starter e confere a ordem
```

Ele pinta cada região com uma cor diferente (vermelho, verde, azul, amarelo) e deixa
`teste-ob-*.png` para olhar: se a colorização estivesse pegando a região errada, o boneco sairia
monocromático e daria para ver no print.
