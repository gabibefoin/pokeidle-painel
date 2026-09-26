#!/usr/bin/env python3
"""Exporta folha PNG 4×N a partir do manifest + WEBP do LAB (backup do build).

    python tools/nomeador/exportar-do-lab.py 40335 4GEN/mothim_2
    python tools/nomeador/exportar-do-lab.py 40106 mothim

Precisa existir:
  Sprites/LAB/categories/outfits-male-<id>-*.json
  Sprites/LAB/asset-packs/outfits/male/<id>/*.webp  (ou public/data espelho)
"""
import glob
import json
import os
import sys
import argparse
from PIL import Image

from caminhos import sprites_raiz

SPRITES = os.environ.get("SPRITES_RAIZ", str(sprites_raiz()))
LAB = os.path.join(SPRITES, "LAB")
JOGO = os.environ.get(
    "GAME_DATA",
    os.path.join(os.path.dirname(__file__), "..", "..", "public", "data"),
)


def achar_manifest(looktype):
    hits = glob.glob(os.path.join(LAB, "categories", "outfits-male-%s-*.json" % looktype))
    if hits:
        return hits[0]
    hits = glob.glob(os.path.join(JOGO, "asset-packs", "categories", "outfits-male-%s-*.json" % looktype))
    return hits[0] if hits else None


def achar_atlas(page_rel):
    rel = page_rel.lstrip("/").replace("assets-packs/", "asset-packs/")
    for base in (LAB, JOGO):
        p = os.path.join(base, rel.replace("/", os.sep))
        if os.path.isfile(p):
            return p
    return None


def exportar(looktype, nome_arquivo, pasta=""):
    manifest_path = achar_manifest(looktype)
    if not manifest_path:
        raise SystemExit("manifest do looktype %s não encontrado no LAB nem no jogo" % looktype)

    with open(manifest_path, encoding="utf-8") as f:
        m = json.load(f)

    cat_key = "outfits/male/%s" % looktype
    cat = m["categories"][cat_key]
    nframes = cat["geometry"]["frames"]
    page = cat["pages"][0]
    atlas_path = achar_atlas(page["image"])
    if not atlas_path:
        raise SystemExit(
            "WEBP ausente: %s\nRode npm run nomeador:build ANTES da corrupção, ou restaure backup."
            % page["image"]
        )

    atlas = Image.open(atlas_path).convert("RGBA")
    fw = cat["geometry"].get("width", 1) * 32
    fh = cat["geometry"].get("height", 1) * 32
    if fw <= 32 and fh <= 32:
        sample = next(iter(m["assets"].values()))
        fw = sample.get("width", 32)
        fh = sample.get("height", 32)

    sheet = Image.new("RGBA", (4 * fw, nframes * fh), (0, 0, 0, 0))
    for key, asset in m["assets"].items():
        base = os.path.basename(key).replace(".png", "")
        frame, _layer, _addon, direction = map(int, base.split("_"))
        fr = asset["frames"][0]
        crop = atlas.crop((fr["x"], fr["y"], fr["x"] + fr["w"], fr["y"] + fr["h"]))
        sheet.paste(crop, ((direction - 1) * fw, (frame - 1) * fh))

    dest_dir = os.path.join(SPRITES, pasta) if pasta else SPRITES
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, "%s.png" % nome_arquivo)
    sheet.save(dest)
    print("OK  looktype %s -> %s (%dx%d)" % (looktype, dest, sheet.size[0], sheet.size[1]))
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("looktype", type=int)
    ap.add_argument("nome", help="nome do arquivo sem .png")
    ap.add_argument("--pasta", default="", help="subpasta em Sprites (ex.: 4GEN)")
    args = ap.parse_args()
    exportar(args.looktype, args.nome, args.pasta)


if __name__ == "__main__":
    main()
