#!/usr/bin/env python3
"""Recompoe uma folha de sprites que veio APARADA, usando outra folha como gabarito.

    python tools/nomeador/reparar-folhas.py --pares pares.json

`pares.json` e uma lista de {"ref", "cortada", "destino"}:

    ref       a folha INTEIRA da mesma pose (normalmente a versao comum do mesmo pokemon)
    cortada   a folha aparada, que o converter recusa
    destino   onde escrever a folha recomposta

### Por que isto existe

O converter le a folha como uma grade de 4 colunas (direcoes) por N linhas (frames). Um PNG
salvo com a margem transparente aparada deixa de ser multiplo de 4 na largura e o converter
recusa: "largura 251 nao divide em 4 colunas". Foi o que veio em `mega_pidgeot_shiny.png`
(251x184 contra 256x192) e `mega_tyranitar_shiny.png` (247x191).

Aparar nao perde pixel de desenho, so a moldura vazia — e a moldura vazia e exatamente o que
a caixa de conteudo da folha INTEIRA diz onde ficava. Colando a aparada na posicao da caixa
de conteudo do gabarito, a grade volta ao lugar e os quadros voltam a bater com os da folha
comum, que e o que garante que a shiny anime igual a normal.

Recusa o conserto quando a aparada nao tem exatamente o tamanho da caixa de conteudo do
gabarito: ai nao e margem aparada, e outra folha, e adivinhar o encaixe seria pior do que
falhar.
"""
import argparse
import json
import os
import sys

from PIL import Image


def reparar(ref_png, cortada_png, destino_png):
    ref = Image.open(ref_png).convert("RGBA")
    cortada = Image.open(cortada_png).convert("RGBA")

    caixa = ref.getbbox()
    if not caixa:
        raise ValueError("gabarito %s esta vazio" % ref_png)
    x0, y0, x1, y1 = caixa
    esperado = (x1 - x0, y1 - y0)
    if cortada.size != esperado:
        raise ValueError(
            "%s tem %dx%d, mas a caixa de conteudo de %s e %dx%d"
            % (os.path.basename(cortada_png), cortada.width, cortada.height,
               os.path.basename(ref_png), esperado[0], esperado[1])
        )

    folha = Image.new("RGBA", ref.size, (0, 0, 0, 0))
    folha.paste(cortada, (x0, y0))
    os.makedirs(os.path.dirname(destino_png) or ".", exist_ok=True)
    folha.save(destino_png)
    return {"destino": destino_png, "de": cortada.size, "para": ref.size, "em": (x0, y0)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pares", required=True)
    args = ap.parse_args()

    with open(args.pares, encoding="utf-8") as f:
        pares = json.load(f)

    erros = []
    for p in pares:
        try:
            r = reparar(p["ref"], p["cortada"], p["destino"])
            print("  %s %dx%d -> %dx%d em %s"
                  % (os.path.basename(p["cortada"]), r["de"][0], r["de"][1],
                     r["para"][0], r["para"][1], r["em"]))
        except Exception as e:
            erros.append("%s: %s" % (os.path.basename(p.get("cortada", "?")), e))

    if erros:
        for e in erros:
            print("  FALHOU " + e, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
