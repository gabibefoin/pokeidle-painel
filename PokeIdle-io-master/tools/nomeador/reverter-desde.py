"""Desfaz renomeações do log de `linha` até o fim (ordem inversa, via temp).

    python tools/nomeador/reverter-desde.py 8702
"""
import json
import os
import sys
import time
import hashlib
import argparse

from caminhos import sprites_raiz

RAIZ = os.environ.get("SPRITES_RAIZ", str(sprites_raiz()))
INDICE = os.path.join(RAIZ, "LAB", "lab-index.json")
LOG = os.path.join(RAIZ, "LAB", "renomeacoes.jsonl")
TMP_DIR = "_revert_tmp"


def ler_log():
    linhas = []
    with open(LOG, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("revert"):
                continue
            ev["_linha"] = i
            linhas.append(ev)
    return linhas


def caminho(rel):
    return os.path.join(RAIZ, rel.replace("/", os.sep))


def base_nome(arquivo):
    return os.path.splitext(os.path.basename(arquivo))[0]


def classificar(pasta, base):
    sem_nome = base.lower().startswith("outfit_") or base.lower().startswith("boss_arena_")
    nome = "" if sem_nome else base
    if pasta == "NP":
        kind = "np"
    elif pasta == "VAZIOS":
        kind = "vazio"
    elif base.lower().startswith("shiny_") or base.lower().endswith("_shiny"):
        kind = "shiny"
    elif pasta == "NOMEADOS":
        kind = "pokemon"
    else:
        kind = "pendente" if sem_nome else "pokemon"
    return nome, kind, not sem_nome


def md5_arquivo(p):
    with open(p, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()[:16]


def aplicar_indice(doc, oid, rel):
    key = str(oid)
    if key not in doc["outfits"]:
        return
    e = doc["outfits"][key]
    pasta = rel.split("/")[0] if "/" in rel else ""
    base = base_nome(rel)
    nome, kind, nomeado = classificar(pasta, base)
    e["id"] = oid
    e["arquivo"] = rel
    e["pasta"] = pasta
    e["name"] = nome
    e["kind"] = kind
    e["nomeado"] = nomeado
    p = caminho(rel)
    if os.path.isfile(p):
        ch = md5_arquivo(p)
        n = 0
        raw = ch
        while any(x.get("chave", "").split("#")[0] == ch and str(x.get("id")) != key
                  for x in doc["outfits"].values()):
            n += 1
            ch = "%s#%d" % (raw, n)
        e["chave"] = ch


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("linha", type=int)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    linhas = ler_log()
    desfazer = [ev for ev in linhas if ev["_linha"] >= args.linha]
    if not desfazer:
        sys.exit("nenhuma linha >= %d" % args.linha)

    with open(INDICE, encoding="utf-8") as f:
        doc = json.load(f)

    undos = list(reversed(desfazer))
    print("Desfazendo %d renomeacoes (L%d..L%d)\n" % (
        len(undos), args.linha, desfazer[-1]["_linha"]))

    paras = []
    for ev in undos:
        p = ev["para"].replace("\\", "/")
        if p not in paras:
            paras.append(p)

    temps = {}
    if not args.dry_run:
        os.makedirs(caminho(TMP_DIR), exist_ok=True)

    for i, rel in enumerate(paras):
        src = caminho(rel)
        if not os.path.isfile(src):
            print("  temp skip (ausente): %s" % rel)
            continue
        tmp_rel = "%s/%03d_%s" % (TMP_DIR, i, os.path.basename(rel))
        tmp_abs = caminho(tmp_rel)
        print("  temp: %s" % rel)
        if not args.dry_run:
            os.rename(src, tmp_abs)
        temps[rel] = tmp_rel

    for ev in undos:
        oid = ev["id"]
        de = ev["de"].replace("\\", "/")
        para = ev["para"].replace("\\", "/")
        src_rel = temps.get(para, para)
        src = caminho(src_rel)
        dst = caminho(de)

        if args.dry_run:
            print("  [L%s] id %s: %s -> %s" % (ev["_linha"], oid, src_rel, de))
            continue

        if not os.path.isfile(src):
            print("  [L%s] PULADO — sem origem %s" % (ev["_linha"], src_rel))
            continue
        if os.path.isfile(dst):
            print("  [L%s] ERRO — destino ocupado: %s" % (ev["_linha"], de))
            sys.exit(1)

        os.makedirs(os.path.dirname(dst) or RAIZ, exist_ok=True)
        os.rename(src, dst)
        aplicar_indice(doc, oid, de)
        print("  [L%s] id %s -> %s" % (ev["_linha"], oid, de))
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "t": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "id": oid, "de": para, "para": de, "revert": ev["_linha"],
            }, ensure_ascii=False) + "\n")

    if args.dry_run:
        print("\ndry-run ok")
        return

    doc["gerado"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    tmp_i = INDICE + ".tmp"
    with open(tmp_i, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    os.replace(tmp_i, INDICE)

    try:
        os.rmdir(caminho(TMP_DIR))
    except OSError:
        pass

    print("\nPronto. Reinicie o Nomeador + Ctrl+Shift+R.")


if __name__ == "__main__":
    main()
