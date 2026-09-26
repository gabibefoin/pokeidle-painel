"""Corrige lab-index.json: id desalinhado, origem, chave MD5, arquivos duplicados.

    python tools/nomeador/reparar-indice.py
"""
import glob
import hashlib
import json
import os
import re
import time
from collections import defaultdict

from caminhos import sprites_raiz

RAIZ = os.environ.get("SPRITES_RAIZ", str(sprites_raiz()))
INDICE = os.path.join(RAIZ, "LAB", "lab-index.json")
LAB = os.path.join(RAIZ, "LAB")
LOG = os.path.join(RAIZ, "LAB", "renomeacoes.jsonl")

def origens_do_log():
    origem = {}
    if not os.path.isfile(LOG):
        return origem
    with open(LOG, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            oid = ev.get("id")
            de = (ev.get("de") or "").replace("\\", "/")
            base = os.path.basename(de)
            if oid is None or not base.lower().startswith("outfit_"):
                continue
            if oid not in origem:
                origem[oid] = base
    return origem


def md5_arquivo(relativo):
    p = os.path.join(RAIZ, relativo.replace("/", os.sep))
    if not os.path.isfile(p):
        return None
    return hashlib.md5(open(p, "rb").read()).hexdigest()[:16]


def chave_base(chave):
    return str(chave or "").split("#")[0]


def id_do_manifest(manifest):
    m = re.search(r"outfits-male-(\d+)-", manifest or "")
    return int(m.group(1)) if m else None


def manifest_de_id(oid):
    hits = glob.glob(os.path.join(LAB, "categories", "outfits-male-%d-*.json" % oid))
    if not hits:
        return None, None
    best_path = None
    best_bytes = -1
    for path in hits:
        try:
            with open(path, encoding="utf-8") as f:
                doc = json.load(f)
            cat = doc["categories"]["outfits/male/%d" % oid]
            n = cat["pages"][0].get("bytes") or 0
            if n > best_bytes:
                best_bytes = n
                best_path = path
        except (KeyError, json.JSONDecodeError, IndexError, OSError):
            continue
    if not best_path:
        best_path = max(hits, key=os.path.getmtime)
    rel = "/assets-packs/categories/" + os.path.basename(best_path)
    return rel, best_path


def geo_do_manifest(path, oid):
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    cat = doc["categories"]["outfits/male/%d" % oid]
    g = cat["geometry"]
    return g["directions"], g["frames"], g["width"], g["height"]


def corrigir_manifests(doc):
    fixes = 0
    for k, e in doc["outfits"].items():
        oid = int(k)
        novo, path = manifest_de_id(oid)
        if not novo:
            if e.get("manifest"):
                e.pop("manifest", None)
                e["category"] = "outfits/male/%d" % oid
                fixes += 1
            continue
        if e.get("manifest") == novo and id_do_manifest(e.get("manifest")) == oid:
            continue
        e["manifest"] = novo
        e["category"] = "outfits/male/%d" % oid
        d, fr, w, h = geo_do_manifest(path, oid)
        e["directions"] = d
        e["frames"] = fr
        e["width"] = w
        e["height"] = h
        fixes += 1
    return fixes


def indexar_pngs_por_chave():
    por = {}
    for dirpath, dirnames, filenames in os.walk(RAIZ):
        dirnames[:] = [d for d in dirnames if d not in ("LAB", "node_modules", ".git")]
        if os.path.basename(dirpath) == "LAB" and "categories" in dirpath.replace("\\", "/"):
            continue
        for fn in filenames:
            if not fn.lower().endswith(".png"):
                continue
            abs_p = os.path.join(dirpath, fn)
            try:
                ch = md5_arquivo(abs_p.replace("/", os.sep))
            except OSError:
                continue
            rel = os.path.relpath(abs_p, RAIZ).replace("\\", "/")
            try:
                ch = md5_arquivo(rel)
            except OSError:
                continue
            por.setdefault(ch, []).append(rel)
    return por


def main():
    with open(INDICE, encoding="utf-8") as f:
        doc = json.load(f)

    origem_log = origens_do_log()
    bad = 0
    orig = 0
    chaves = 0
    removidos = []
    restaurados = 0
    fantasmas = 0

    por_chave_png = indexar_pngs_por_chave()
    for k, e in list(doc["outfits"].items()):
        if e.get("arquivo"):
            continue
        ch = chave_base(e.get("chave"))
        cands = por_chave_png.get(ch, [])
        if not cands:
            doc["outfits"].pop(k, None)
            fantasmas += 1
            continue
        rel = sorted(cands)[0]
        e["arquivo"] = rel
        e["pasta"] = rel.split("/")[0] if "/" in rel else ""
        restaurados += 1

    for k, e in doc["outfits"].items():
        kid = int(k)
        if str(e.get("id")) != str(k):
            e["id"] = kid
            bad += 1
        hit = origem_log.get(kid)
        if hit and e.get("origem") != hit:
            e["origem"] = hit
            orig += 1
        arq = (e.get("arquivo") or "").replace("\\", "/")
        if arq:
            h = md5_arquivo(arq)
            if h and chave_base(e.get("chave")) != h:
                sufixo = ""
                if "#" in str(e.get("chave") or ""):
                    sufixo = str(e["chave"])[str(e["chave"]).index("#") :]
                e["chave"] = h + sufixo
                chaves += 1

    por_arq = defaultdict(list)
    for k, e in doc["outfits"].items():
        arq = (e.get("arquivo") or "").replace("\\", "/")
        if arq:
            por_arq[arq].append((int(k), e))

    for arq, itens in por_arq.items():
        if len(itens) < 2:
            continue
        h = md5_arquivo(arq)
        bons = [t for t in itens if h and chave_base(t[1].get("chave")) == h]
        manter = min(bons or itens, key=lambda t: t[0])
        for kid, _e in itens:
            if kid == manter[0]:
                continue
            doc["outfits"].pop(str(kid), None)
            removidos.append((kid, arq))

    manifests = corrigir_manifests(doc)

    if not bad and not orig and not chaves and not removidos and not manifests and not restaurados and not fantasmas:
        print("indice ok")
        return

    doc["gerado"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    tmp = INDICE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    os.replace(tmp, INDICE)
    print(
        "corrigidos %d ids, %d origens, %d chaves MD5, %d duplicatas, %d manifests, "
        "%d arquivos restaurados, %d fantasmas removidos -> %s"
        % (bad, orig, chaves, len(removidos), manifests, restaurados, fantasmas, INDICE)
    )
    for kid, arq in removidos:
        print("  removido id %s (%s)" % (kid, arq))


if __name__ == "__main__":
    main()
