#!/usr/bin/env python3
"""Exporta um looktype do jogo (public/data/asset-packs) para folha PNG 4×N do Nomeador.

    python tools/nomeador/importar-do-jogo.py 105 meowth
    python tools/nomeador/importar-do-jogo.py 8282 shiny_meowth

Depois rode `npm run nomeador:build` (ou construir.py) para entrar no lab-index.json.
"""
import json
import os
import sys
import argparse
from PIL import Image

from caminhos import sprites_raiz

GAME = os.environ.get("GAME_DATA", os.path.join(os.path.dirname(__file__), "..", "..", "public", "data"))
SPRITES = os.environ.get("SPRITES_RAIZ", str(sprites_raiz()))
PASTA_PADRAO = "NOMEADOS"


def achar_manifest(looktype):
    cat_dir = os.path.join(GAME, "asset-packs", "categories")
    prefix = f"outfits-male-{looktype}-"
    for nome in os.listdir(cat_dir):
        if nome.startswith(prefix):
            return os.path.join(cat_dir, nome)
    return None


def exportar(looktype, nome_arquivo, pasta=PASTA_PADRAO):
    manifest_path = achar_manifest(looktype)
    if not manifest_path:
        raise SystemExit(f"looktype {looktype} não encontrado em {GAME}")

    with open(manifest_path, encoding="utf-8") as f:
        m = json.load(f)

    cat_key = f"outfits/male/{looktype}"
    cat = m["categories"][cat_key]
    geo = cat["geometry"]
    nframes = geo["frames"]
    tile = 32
    fw = geo.get("width", 1) * tile
    fh = geo.get("height", 1) * tile
    page_rel = cat["pages"][0]["image"].lstrip("/").replace("assets-packs/", "asset-packs/")
    atlas_path = os.path.join(GAME, page_rel.replace("/", os.sep))
    if not os.path.isfile(atlas_path):
        raise SystemExit(f"atlas não encontrado: {atlas_path}")

    atlas = Image.open(atlas_path).convert("RGBA")
    sheet = Image.new("RGBA", (4 * fw, nframes * fh), (0, 0, 0, 0))

    for key, asset in m["assets"].items():
        base = os.path.basename(key).replace(".png", "")
        if "_template" in base:
            continue
        parts = base.split("_")
        if len(parts) != 4:
            continue
        frame, _layer, _addon, direction = map(int, parts)
        fr = asset["frames"][0]
        crop = atlas.crop((fr["x"], fr["y"], fr["x"] + fr["w"], fr["y"] + fr["h"]))
        if crop.size != (fw, fh):
            crop = crop.resize((fw, fh), Image.NEAREST)
        sheet.paste(crop, ((direction - 1) * fw, (frame - 1) * fh))

    dest_dir = os.path.join(SPRITES, pasta) if pasta else SPRITES
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, f"{nome_arquivo}.png")
    sheet.save(dest)
    print(f"OK  looktype {looktype} -> {dest} ({sheet.size[0]}x{sheet.size[1]})")
    return dest


def main():
    ap = argparse.ArgumentParser(description="Importa sprite do jogo para o Nomeador")
    ap.add_argument("looktype", type=int, help="looktype do creatures.json (ex.: 105 = Meowth)")
    ap.add_argument("nome", help="nome do arquivo sem .png (ex.: meowth, shiny_meowth)")
    ap.add_argument("--pasta", default=PASTA_PADRAO, help=f"pasta em Sprites (padrão: {PASTA_PADRAO})")
    args = ap.parse_args()
    exportar(args.looktype, args.nome, args.pasta)


if __name__ == "__main__":
    main()
