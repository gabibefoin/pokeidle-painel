#!/usr/bin/env python3
"""Converte PNGs do Pokedex Backup → asset-packs do jogo. Não usa LAB/Nomeador."""
import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from converter import converter

LT_NORMAL = 60000
LT_SHINY = 70000
MIN_WEBP = 128


def looktype_id(dex, shiny):
    return (LT_SHINY if shiny else LT_NORMAL) + int(dex)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", required=True, help="JSON com lista de {png,dex,shiny,nome,slug}")
    ap.add_argument("--saida", required=True, help="pasta asset-packs (public/data/asset-packs)")
    ap.add_argument("--resultado", required=True, help="JSON de saida com indice + falhas")
    args = ap.parse_args()

    with open(args.jobs, encoding="utf-8") as f:
        jobs = json.load(f)

    indice = {}
    falhas = []
    ok = 0
    bytes_tot = 0

    for i, job in enumerate(jobs):
        png = job["png"]
        dex = job["dex"]
        shiny = bool(job.get("shiny"))
        # `oid` explicito no job manda: e por ele que as MEGAS entram (80000+dex /
        # 85000+dex) sem esta funcao precisar conhecer a faixa delas.
        oid = int(job["oid"]) if job.get("oid") else looktype_id(dex, shiny)
        nome = job.get("nome") or job.get("slug") or str(dex)
        kind = "shiny" if shiny else "pokemon"

        if not os.path.isfile(png):
            falhas.append({"dex": dex, "shiny": shiny, "png": png, "erro": "PNG ausente"})
            continue

        try:
            r = converter(png, oid, nome, kind=kind, raiz=args.saida, metodo=6,
                          grade=job.get("grade"))
            n = r.get("bytes") or 0
            if n < MIN_WEBP:
                raise ValueError("atlas truncado (%d bytes)" % n)
            bytes_tot += n
            indice[str(oid)] = {
                "id": oid,
                "gender": "male",
                "category": r["category"],
                "manifest": r["manifest"],
                "colorizable": False,
                "directions": r.get("directions", 4),
                "frames": r.get("frames", 1),
                "width": r.get("width", 1),
                "height": r.get("height", 1),
                "name": nome,
                "kind": kind,
                "dex": dex,
                "slug": job.get("slug"),
                "shiny": shiny,
                "png": png,
                "pngMd5": hashlib.md5(open(png, "rb").read()).hexdigest()[:16],
                "atlasBytes": n,
            }
            ok += 1
        except Exception as e:
            falhas.append({
                "dex": dex,
                "shiny": shiny,
                "slug": job.get("slug"),
                "png": png,
                "erro": "%s: %s" % (type(e).__name__, e),
            })

        if (i + 1) % 100 == 0:
            print("  %d/%d" % (i + 1, len(jobs)), flush=True)

    out = {
        "fonte": "pokedex-backup",
        "total": len(jobs),
        "ok": ok,
        "falhas": len(falhas),
        "bytesAtlas": bytes_tot,
        "looktypeNormalBase": LT_NORMAL,
        "looktypeShinyBase": LT_SHINY,
        "outfits": indice,
        "erros": falhas,
    }
    os.makedirs(os.path.dirname(args.resultado) or ".", exist_ok=True)
    with open(args.resultado, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print("%d convertidos · %d falhas · +%.1f MB" % (ok, len(falhas), bytes_tot / 1048576))
    if falhas:
        print("primeiras falhas:")
        for x in falhas[:8]:
            print("  #%s %s %s: %s" % (x.get("dex"), x.get("slug"), "shiny" if x.get("shiny") else "normal", x.get("erro")))
        sys.exit(1)


if __name__ == "__main__":
    main()
