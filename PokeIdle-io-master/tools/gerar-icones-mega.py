#!/usr/bin/env python3
"""Gera os ícones das MEGA STONES a partir dos PNG do pokesprite.

    python tools/gerar-icones-mega.py

Entrada  game/src/client/img/itens/mega/<slug>.png   (baixados do pokesprite, cor original)
Saída    game/src/client/img/itens/mega-shiny/<slug>.png   a mesma pedra com a ÁUREA dourada
         game/src/client/img/itens/fragmento-mega.png        a pedra em preto e branco
         game/src/client/img/itens/fragmento-mega-shiny.png  a pedra em ciano, com a áurea

### Por que a áurea, e por que ela é exagerada

As pedras só se distinguem pela COR do miolo, e a Mega Shiny Stone é a MESMA
pedra da normal — uma "Shiny Gengarite" ao lado de uma "Gengarite" na bolsa seriam dois
quadradinhos roxos idênticos. O jogador que vai gastar dez fragmentos raros não pode precisar
LER para saber qual é qual. A áurea dourada resolve isso a três metros de distância: anel,
brilho radial e quatro faíscas, tudo em amarelo, que é a cor que o jogo já usa para "isto aqui
vale muito" (o ✨ do shiny, a moldura de raro).

Os dois fragmentos seguem a mesma lógica pela mesma razão: cinza = comum, ciano + áurea =
shiny. Nenhum dos dois é a pedra pronta, e nenhum dos dois se confunde com o outro.
"""
import colorsys
import math
import os
import sys

from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ITENS = os.path.join(RAIZ, "game", "src", "client", "img", "itens")
MEGA = os.path.join(ITENS, "mega")
MEGA_SHINY = os.path.join(ITENS, "mega-shiny")

# A pedra que serve de molde para os dois fragmentos. Qualquer uma serviria (as 32 dividem a
# mesma silhueta — ver o cabeçalho), mas fixar UMA mantém o resultado reproduzível.
MOLDE = "gengarite.png"

OURO = (255, 206, 56)
OURO_CLARO = (255, 246, 179)
CIANO = (126, 231, 255)


# ---------------------------------------------------------------- pedras derivadas
#
# Duas megas de Legends: Z-A entraram depois das 32 de X/Y e ORAS, e o pokesprite so tem as
# 47 daquela era -- nao ha Dragonitite nem Meganiumite para baixar. As duas sao DERIVADAS aqui.
#
# Isso e honesto porque as 47 pedras sao a MESMA silhueta com uma paleta trocada: contorno
# preto fixo, branco do brilho fixo e ~7 cores no miolo. Girar o matiz de uma delas produz uma
# pedra que pertence ao mesmo conjunto -- o que muda e a cor, que e exatamente o que muda entre
# uma Gengarite e uma Venusaurite. Os STATS e os TIPOS das duas continuam sendo os oficiais da
# pokemondb; so o desenho de 32 px e nosso.
#
# A escolha de cor segue o bicho e evita o vizinho:
#   Dragonitite  tan/creme + menta  (corpo e asas do Dragonite; longe da Charizardite e da
#                                    Ampharosite, que sao laranja/vermelho/amarelo)
#   Meganiumite  oliva + rosa       (corpo e petalas do Meganium; longe da Venusaurite, que e
#                                    azul-esverdeada, e da Sceptilite, que e verde/salmao)
FIXOS_DA_PEDRA = {(32, 32, 32), (255, 255, 255)}

DERIVADAS = {
    # destino: (fonte, graus de matiz, saturacao, luminancia)
    'dragonitite': ('venusaurite', 205, 1.05, 1.10),
    'meganiumite': ('sceptilite', -35, 1.10, 1.10),
}

# ---------------------------------------------------------------- pedras repaletadas
#
# A GRENINJITE nao sai de um giro de matiz, e a razao e concreta: girar mexe nas tres bandas
# JUNTAS, e o Greninja tem tres cores que nao sao rotacao uma da outra -- o azul do corpo, o
# rosa da lingua e o creme da barriga. Toda rotacao testada ou perdia o rosa ou virava a pedra
# inteira de cor (a folha de prova esta no scratchpad da sessao).
#
# Entao aqui a troca e banda a banda. Isso NAO e um mecanismo novo a mais: as 47 pedras do
# pokesprite ja sao a mesma silhueta com ~7 cores trocadas no miolo, e e exatamente essas ~7
# que o mapa abaixo substitui. Contorno (32,32,32) e o branco do brilho continuam fixos, como
# em todas as outras.
#
# As tres cores vieram da ARTE do proprio Greninja (`658_greninja.png`), nao de estimativa:
#   azul  (103,167,227)  corpo
#   rosa  (222,83,116)   lingua
#   navy  (38,66,117)    a sombra do azul, para a pedra ter profundidade
#
# A gengarite e o molde porque e a unica com tres bandas bem separadas (lilas / vermelho /
# azul-violeta), que e a estrutura de que o Greninja precisa. Conferido contra as 68: nenhuma
# outra e azul-com-rosa -- a absolite e azul palida sem rosa, a metagrossite e azul com laranja.
REPALETADAS = {
    'greninjite': ('gengarite', {
        (189, 148, 230): (103, 167, 227),   # banda 1 (29 px) -> azul do corpo
        (214, 58, 82): (222, 83, 116),      # banda 2 (23 px) -> rosa da lingua
        (74, 33, 214): (38, 66, 117),       # banda 3 (20 px) -> navy, a sombra
        (156, 58, 148): (150, 80, 120),     # acento entre a 2 e a 3
        (197, 197, 255): (206, 230, 250),   # realce claro
        (197, 189, 255): (198, 224, 248),   # realce claro
        (99, 58, 206): (52, 92, 150),       # meio-tom da banda 3
    }),
}


def girar_matiz(im, graus, sat=1.0, luz=1.0):
    """Gira o matiz preservando o contorno e o branco -- a estrutura do desenho."""
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if not a or (r, g, b) in FIXOS_DA_PEDRA:
                continue
            h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            h = (h + graus / 360.0) % 1.0
            nr, ng, nb = colorsys.hls_to_rgb(h, min(1.0, l * luz), min(1.0, s * sat))
            px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return out


def trocar_paleta(im, mapa):
    """Troca cor por cor. O que nao esta no mapa (contorno, branco) fica como esta."""
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            alvo = mapa.get((r, g, b))
            if alvo:
                px[x, y] = (alvo[0], alvo[1], alvo[2], a)
    return out


def gerar_derivadas():
    """Escreve as pedras que o pokesprite nao tem. Roda ANTES da passagem da aurea, que varre
    a pasta inteira -- assim as shiny delas saem sozinhas."""
    n = 0
    for destino, (fonte, gr, sa, lz) in DERIVADAS.items():
        caminho = os.path.join(MEGA, fonte + '.png')
        if not os.path.isfile(caminho):
            print('  FONTE AUSENTE para %s: %s' % (destino, caminho))
            continue
        im = Image.open(caminho).convert('RGBA')
        girar_matiz(im, gr, sa, lz).save(os.path.join(MEGA, destino + '.png'))
        n += 1
    for destino, (fonte, mapa) in REPALETADAS.items():
        caminho = os.path.join(MEGA, fonte + '.png')
        if not os.path.isfile(caminho):
            print('  FONTE AUSENTE para %s: %s' % (destino, caminho))
            continue
        im = Image.open(caminho).convert('RGBA')
        trocar_paleta(im, mapa).save(os.path.join(MEGA, destino + '.png'))
        n += 1
    return n


def aura(im):
    """Devolve uma cópia da pedra com a áurea dourada por baixo e as faíscas por cima."""
    w, h = im.size
    cx, cy = (w - 1) / 2.0, (h - 1) / 2.0
    brilho = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = brilho.load()

    # O halo: um gradiente radial que começa colado na pedra (r≈4,5) e morre na borda (r≈15).
    # O expoente 1,3 é o que deixa a queda suave em vez de um disco chapado.
    for y in range(h):
        for x in range(w):
            r = math.hypot(x - cx, y - cy)
            if r < 4.5 or r > 15.5:
                continue
            t = 1.0 - (r - 4.5) / 11.0
            a = int(235 * (t ** 1.3))
            # o anel nítido em r≈11: o contorno que segura o halo e dá o "impossível de ignorar"
            if 10.4 <= r <= 12.0:
                a = max(a, 240)
            if a > 0:
                px[x, y] = (*OURO, min(255, a))

    # Quatro faíscas nas diagonais — o brilho de "item raro" que o olho pega antes de ler.
    for dx, dy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        fx = int(round(cx + dx * 10.0))
        fy = int(round(cy + dy * 10.0))
        for ox, oy, a in ((0, 0, 255), (1, 0, 170), (-1, 0, 170), (0, 1, 170), (0, -1, 170)):
            x, y = fx + ox, fy + oy
            if 0 <= x < w and 0 <= y < h:
                px[x, y] = (*OURO_CLARO, a)

    saida = Image.alpha_composite(brilho, im)
    return saida


def cinza(im):
    """Preto e branco: a luminância de cada pixel, com o alfa intacto."""
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            v = int(round(0.299 * r + 0.587 * g + 0.114 * b))
            px[x, y] = (v, v, v, a)
    return out


def tingir(im, cor):
    """Tinge a pedra numa cor só, preservando o claro/escuro do desenho original."""
    out = im.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            v = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
            # 0,45 + 0,75·v: o miolo claro vira ciano puro e a sombra continua sombra.
            k = 0.45 + 0.75 * v
            px[x, y] = (
                min(255, int(cor[0] * k)),
                min(255, int(cor[1] * k)),
                min(255, int(cor[2] * k)),
                a,
            )
    return out


def main():
    if not os.path.isdir(MEGA):
        sys.exit("faltam os PNG do pokesprite em %s" % MEGA)
    os.makedirs(MEGA_SHINY, exist_ok=True)

    derivadas = gerar_derivadas()
    if derivadas:
        print('%d pedra(s) derivada(s) (o pokesprite nao as tem): %s'
              % (derivadas, ', '.join(list(DERIVADAS) + list(REPALETADAS))))

    n = 0
    for nome in sorted(os.listdir(MEGA)):
        if not nome.endswith(".png"):
            continue
        im = Image.open(os.path.join(MEGA, nome)).convert("RGBA")
        aura(im).save(os.path.join(MEGA_SHINY, nome))
        n += 1

    molde = Image.open(os.path.join(MEGA, MOLDE)).convert("RGBA")
    cinza(molde).save(os.path.join(ITENS, "fragmento-mega.png"))
    aura(tingir(molde, CIANO)).save(os.path.join(ITENS, "fragmento-mega-shiny.png"))

    print("%d pedras com áurea em %s" % (n, MEGA_SHINY))
    print("fragmento-mega.png e fragmento-mega-shiny.png em %s" % ITENS)


if __name__ == "__main__":
    main()
