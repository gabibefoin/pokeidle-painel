#!/usr/bin/env python3
"""Realinha lab-index.json ao locker pokedex-lab-baseline.json (id + chave MD5 + nome).

    python tools/nomeador/restaurar-do-baseline.py
    python tools/nomeador/restaurar-do-baseline.py --dry-run

Procura cada PNG pelo hash gravado no baseline e regrava a entrada do id correspondente.
Depois rode: npm run nomeador:reparar && npm run nomeador:verificar-pokedex
"""
import argparse
import hashlib
import json
import os
import sys
import time

from caminhos import sprites_raiz

RAIZ = os.environ.get("SPRITES_RAIZ", str(sprites_raiz()))
AQUI = os.path.dirname(os.path.abspath(__file__))
BASELINE = os.path.join(AQUI, "pokedex-lab-baseline.json")
INDICE = os.path.join(RAIZ, "LAB", "lab-index.json")
TMP = "_baseline_restore_tmp"

SKIP_DIRS = {"LAB", "node_modules", ".git"}


def md5_arquivo(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()[:16]


def chave_base(chave):
    return str(chave or "").split("#")[0]


def classificar(pasta, base):
    sem = base.lower().startswith("outfit_") or base.lower().startswith("boss_arena_")
    nome = "" if sem else base
    if pasta == "NP":
        kind = "np"
    elif pasta == "VAZIOS":
        kind = "vazio"
    elif base.lower().startswith("shiny_") or base.lower().endswith("_shiny"):
        kind = "shiny"
    elif pasta == "NOMEADOS":
        kind = "pokemon"
    else:
        kind = "pendente" if sem else "pokemon"
    return nome, kind, not sem


def indexar_pngs():
    """chave -> [(rel, abs)]"""
    por_chave = {}
    for dirpath, dirnames, filenames in os.walk(RAIZ):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        if os.path.basename(dirpath) == "LAB" and "categories" in dirpath.replace("\\", "/"):
            continue
        for fn in filenames:
            if not fn.lower().endswith(".png"):
                continue
            abs_p = os.path.join(dirpath, fn)
            try:
                ch = md5_arquivo(abs_p)
            except OSError:
                continue
            rel = os.path.relpath(abs_p, RAIZ).replace("\\", "/")
            por_chave.setdefault(ch, []).append((rel, abs_p))
    return por_chave


def escolher_png(candidatos, name_hint):
    if not candidatos:
        return None
    hint = (name_hint or "").lower()
    for rel, _ in candidatos:
        base = os.path.splitext(os.path.basename(rel))[0].lower()
        if base == hint or hint in base or base in hint:
            return rel
    return candidatos[0][0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not os.path.isfile(BASELINE):
        sys.exit("baseline ausente: %s" % BASELINE)
    if not os.path.isfile(INDICE):
        sys.exit("lab-index ausente: %s" % INDICE)

    with open(BASELINE, encoding="utf-8") as f:
        base = json.load(f)
    with open(INDICE, encoding="utf-8") as f:
        doc = json.load(f)

    print("Indexando PNGs em %s…" % RAIZ)
    por_chave = indexar_pngs()
    print("  %d chaves MD5 distintas\n" % len(por_chave))

    alvos = []
    for slug, esp in base.get("entradas", {}).items():
        for slot in ("normal", "shiny"):
            s = esp.get(slot)
            if not s or s.get("fonte") not in ("lab", "lab-alias"):
                continue
            if not s.get("id") or not s.get("chave"):
                continue
            alvos.append((slug, slot, s))

    print("Restaurando %d slots lab do baseline…%s\n" % (
        len(alvos), " [dry-run]" if args.dry_run else ""))

    ok = 0
    pulados = 0
    erros = []

    if not args.dry_run:
        os.makedirs(os.path.join(RAIZ, TMP), exist_ok=True)

    for slug, slot, s in alvos:
        oid = int(s["id"])
        key = str(oid)
        chave = chave_base(s["chave"])
        name = s.get("name") or slug
        shiny = slot == "shiny"

        cands = por_chave.get(chave, [])
        rel = escolher_png(cands, name)
        if not rel:
            erros.append("%s %s id %s — PNG não encontrado (chave %s)" % (slug, slot, oid, chave))
            continue

        e = doc["outfits"].setdefault(key, {})
        atual = (e.get("arquivo") or "").replace("\\", "/")
        atual_ch = chave_base(e.get("chave"))

        if atual == rel and atual_ch == chave and (e.get("name") or "") == name:
            pulados += 1
            continue

        src = os.path.join(RAIZ, rel.replace("/", os.sep))
        if args.dry_run:
            print("  %s %s id %s: %s -> %s (%s)" % (slug, slot, oid, atual or "?", rel, name))
            ok += 1
            continue

        # Outro id com o mesmo PNG vira fantasma — remove (o baseline manda no id certo).
        for ok_id in list(doc["outfits"].keys()):
            if ok_id == key:
                continue
            oe = doc["outfits"][ok_id]
            if (oe.get("arquivo") or "").replace("\\", "/") == rel:
                doc["outfits"].pop(ok_id, None)

        pasta = rel.split("/")[0] if "/" in rel else ""
        base_n = os.path.splitext(os.path.basename(rel))[0]
        nome, kind, nomeado = classificar(pasta, base_n)
        if shiny:
            kind = "shiny"
        if name and not name.startswith("outfit_"):
            e["name"] = name
        else:
            e["name"] = nome or name

        e["id"] = oid
        e["arquivo"] = rel
        e["pasta"] = pasta
        e["kind"] = kind
        e["nomeado"] = nomeado or bool(name)
        ch = md5_arquivo(src)
        n = 0
        raw = ch
        while any(
            x.get("chave", "").split("#")[0] == ch and str(x.get("id")) != key
            for x in doc["outfits"].values()
        ):
            n += 1
            ch = "%s#%d" % (raw, n)
        e["chave"] = ch
        # manifest/atlas: reparar-indice escolhe o atlas com mais bytes (evita .json vazio recente)

        print("  %s %s id %s -> %s" % (slug, slot, oid, rel))
        ok += 1

    if args.dry_run:
        print("\ndry-run: %d mudariam, %d já ok, %d erros" % (ok, pulados, len(erros)))
        for e in erros[:30]:
            print("  ERRO", e)
        return

    doc["gerado"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    tmp = INDICE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    os.replace(tmp, INDICE)

    try:
        os.rmdir(os.path.join(RAIZ, TMP))
    except OSError:
        pass

    print("\nPronto: %d entradas corrigidas, %d já ok" % (ok, pulados))
    if erros:
        print("%d PNGs não encontrados:" % len(erros))
        for e in erros[:40]:
            print("  ", e)
        if len(erros) > 40:
            print("  … +%d" % (len(erros) - 40))
    print("\nRode: npm run nomeador:reparar && npm run nomeador:verificar-pokedex")


if __name__ == "__main__":
    main()
