"""Reconstrói marker-atlas.png/json a partir dos outfits publicados em asset-packs.

Usa o quadro de frente (direção 3 = sul) de cada looktype referenciado no catálogo
de espécies (espelho + creatures-novos + patches do lab).

    python tools/build-marker-atlas.py
"""
import hashlib
import json
import os
import sys
from PIL import Image

RAIZ = os.path.join(os.path.dirname(__file__), "..")
PACK = os.path.join(RAIZ, "public", "data", "asset-packs")
DADOS = os.path.join(RAIZ, "game", "src", "server", "dados")
SAIDA = os.path.join(RAIZ, "public", "data", "site", "assets", "maps")
CELL = 64
COLS = 16


def carregar_especies():
    base = json.load(open(os.path.join(RAIZ, "public", "data", "creatures.json"), encoding="utf-8"))[
        "creatures"
    ]
    novos_path = os.path.join(DADOS, "creatures-novos.json")
    novos = json.load(open(novos_path, encoding="utf-8"))["creatures"] if os.path.isfile(novos_path) else []
    patches_path = os.path.join(DADOS, "creatures-sprites-lab.json")
    patches = (
        json.load(open(patches_path, encoding="utf-8")).get("patches", [])
        if os.path.isfile(patches_path)
        else []
    )
    lista = list(base) + list(novos)
    for p in patches:
        for c in lista:
            if c.get("pokeId") == p.get("pokeId") and p.get("looktype"):
                c["looktype"] = p["looktype"]
    return lista


def pack_rel(p):
    return p.replace("/assets-packs/", "")


def quadro_sul(manifest, paginas):
    """Retorna recorte RGBA do quadro olhando para o jogador (dir 3, frame 1)."""
    alvo = None
    for chave, asset in manifest.get("assets", {}).items():
        stem = chave.split("/")[-1].replace(".png", "")
        if stem.endswith("_template"):
            continue
        partes = stem.split("_")
        if len(partes) < 4:
            continue
        frame, _layer, _addon, direcao = partes[0], partes[1], partes[2], partes[3]
        if frame == "1" and direcao == "3":
            alvo = asset
            break
    if not alvo:
        for chave, asset in manifest.get("assets", {}).items():
            stem = chave.split("/")[-1].replace(".png", "")
            if "_3" in stem and not stem.endswith("_template"):
                alvo = asset
                break
    if not alvo or not alvo.get("frames"):
        return None
    f = alvo["frames"][0]
    pag = paginas[f.get("page", 0)]
    return pag.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))


def retrato_looktype(lt, indice):
    entry = indice.get(str(lt)) or indice.get(lt)
    if not entry or not entry.get("manifest"):
        return None
    man_rel = pack_rel(entry["manifest"])
    man_path = os.path.join(PACK, man_rel.replace("/", os.sep))
    if not os.path.isfile(man_path):
        return None
    manifest = json.load(open(man_path, encoding="utf-8"))
    cat = next(iter(manifest.get("categories", {}).values()), None)
    if not cat:
        return None
    paginas = []
    for pg in cat.get("pages", []):
        img_rel = pack_rel(pg["image"])
        img_path = os.path.join(PACK, img_rel.replace("/", os.sep))
        if not os.path.isfile(img_path):
            return None
        paginas.append(Image.open(img_path).convert("RGBA"))
    quadro = quadro_sul(manifest, paginas)
    if quadro is None:
        return None
    w, h = quadro.size
    escala = min(CELL / w, CELL / h, 1.0)
    nw, nh = max(1, int(w * escala)), max(1, int(h * escala))
    red = quadro.resize((nw, nh), Image.NEAREST)
    cel = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cel.paste(red, ((CELL - nw) // 2, CELL - nh - 2), red)
    return cel


def main():
    indice = json.load(open(os.path.join(PACK, "outfits-index.json"), encoding="utf-8"))["outfits"]
    looktypes = sorted({c["looktype"] for c in carregar_especies() if c.get("looktype", 1) > 1})
    print("looktypes no catalogo:", len(looktypes))

    slots = {}
    retratos = {}
    falhas = []
    for lt in looktypes:
        try:
            img = retrato_looktype(lt, indice)
            if img:
                retratos[lt] = img
            else:
                falhas.append(lt)
        except Exception as e:
            falhas.append(lt)
            print("  erro lt", lt, e, file=sys.stderr)

    ids = sorted(retratos.keys())
    rows = (len(ids) + COLS - 1) // COLS
    atlas = Image.new("RGBA", (COLS * CELL, max(1, rows) * CELL), (0, 0, 0, 0))
    for i, lt in enumerate(ids):
        col, row = i % COLS, i // COLS
        slots[str(lt)] = [col, row]
        atlas.paste(retratos[lt], (col * CELL, row * CELL))

    os.makedirs(SAIDA, exist_ok=True)
    png = os.path.join(SAIDA, "marker-atlas.png")
    atlas.save(png, optimize=True)
    # Versão derivada dos slots: o PNG no CSS cacheava fácil enquanto o JSON vinha fresco —
    # índice novo + imagem velha = retrato de outro pokémon.
    version = hashlib.sha256(json.dumps(slots, sort_keys=True).encode()).hexdigest()[:12]
    meta = {
        "cell": CELL,
        "cols": COLS,
        "rows": rows,
        "count": len(slots),
        "version": version,
        "image": f"/assets/site/assets/maps/marker-atlas.png?v={version}",
        "slots": slots,
    }
    json_path = os.path.join(SAIDA, "marker-atlas.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
        f.write("\n")

    print("marker-atlas:", len(slots), "celulas,", png)
    if falhas:
        print("sem retrato:", len(falhas), "(usam fallback runtime no cliente)")


if __name__ == "__main__":
    main()
