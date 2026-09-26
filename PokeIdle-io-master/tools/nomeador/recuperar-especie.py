#!/usr/bin/env python3
"""Restaura nomes/caminhos de espécies a partir do log (antes da linha N).

    python tools/nomeador/recuperar-especie.py mothim
    python tools/nomeador/recuperar-especie.py --ids 40335,45182 --antes 8700

Não recria pixels apagados — só renomeia arquivos e corrige lab-index.json.
"""
import argparse
import hashlib
import json
import os
import sys
import time

from caminhos import sprites_raiz

RAIZ = os.environ.get("SPRITES_RAIZ", str(sprites_raiz()))
INDICE = os.path.join(RAIZ, "LAB", "lab-index.json")
LOG = os.path.join(RAIZ, "LAB", "renomeacoes.jsonl")
TMP = "_recuperar_tmp"

ALIASES = {
    "mothim": [40106, 40335, 44432, 45182],
    "nincada": [40106, 44432],
}


def ler_log():
    out = []
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
            out.append(ev)
    return out


def alvo_antes(linhas, linha, ids):
    por = {}
    for ev in linhas:
        if ev["_linha"] >= linha:
            break
        if ev["id"] in ids:
            por[ev["id"]] = ev["para"].replace("\\", "/")
    return por


def caminho(rel):
    return os.path.join(RAIZ, rel.replace("/", os.sep))


def md5(p):
    with open(p, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()[:16]


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("especie", nargs="?", help="ex.: mothim")
    ap.add_argument("--ids", help="ids separados por vírgula")
    ap.add_argument("--antes", type=int, default=8700, help="linha do log (padrão: antes da cascata nincada)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.ids:
        ids = [int(x) for x in args.ids.split(",") if x.strip()]
    elif args.especie:
        ids = ALIASES.get(args.especie.lower())
        if not ids:
            raise SystemExit("espécie desconhecida — use --ids")
    else:
        ap.print_help()
        raise SystemExit(1)

    linhas = ler_log()
    alvo = alvo_antes(linhas, args.antes, set(ids))
    if not alvo:
        raise SystemExit("nenhum id encontrado no log antes da linha %d" % args.antes)

    with open(INDICE, encoding="utf-8") as f:
        doc = json.load(f)

    print("Restaurar %d ids (log linha <%d)%s\n" % (len(alvo), args.antes, " [dry-run]" if args.dry_run else ""))

    os.makedirs(caminho(TMP), exist_ok=True)
    mover = []

    for oid, dest in sorted(alvo.items()):
        key = str(oid)
        e = doc["outfits"].get(key)
        if not e:
            print("  skip %s — ausente do índice" % oid)
            continue
        atual = (e.get("arquivo") or "").replace("\\", "/")
        if atual == dest:
            print("  ok %s já em %s (%s)" % (oid, dest, e.get("name") or "?"))
            continue
        src = caminho(atual)
        if not os.path.isfile(src):
            print("  ERRO %s — PNG ausente: %s" % (oid, atual))
            continue
        tmp = "%s/%s_%s" % (TMP, oid, os.path.basename(atual))
        print("  %s: %s -> %s" % (oid, atual, dest))
        if args.dry_run:
            continue
        os.rename(src, caminho(tmp))
        mover.append((oid, tmp, dest))

    if args.dry_run:
        return

    for oid, tmp, dest in mover:
        key = str(oid)
        e = doc["outfits"][key]
        dst = caminho(dest)
        os.makedirs(os.path.dirname(dst) or RAIZ, exist_ok=True)
        if os.path.isfile(dst):
            os.remove(dst)
        os.rename(caminho(tmp), dst)
        pasta = dest.split("/")[0] if "/" in dest else ""
        base = os.path.splitext(os.path.basename(dest))[0]
        nome, kind, nomeado = classificar(pasta, base)
        e["id"] = oid
        e["arquivo"] = dest
        e["pasta"] = pasta
        e["name"] = nome
        e["kind"] = kind
        e["nomeado"] = nomeado
        e["chave"] = md5(dst)
        print("  gravado %s -> %s (%s)" % (oid, dest, nome or base))

    try:
        os.rmdir(caminho(TMP))
    except OSError:
        pass

    doc["gerado"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    t = INDICE + ".tmp"
    with open(t, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    os.replace(t, INDICE)
    print("\nIndice gravado. Reinicie o Nomeador (Ctrl+Shift+R).")
    print("Se o sprite ainda parecer errado, os pixels foram sobrescritos — veja exportar-do-lab.py ou backup.")


if __name__ == "__main__":
    main()
