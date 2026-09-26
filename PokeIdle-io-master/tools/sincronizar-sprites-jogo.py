#!/usr/bin/env python3
"""Sincroniza looktypes e shiny catalog com o lab-index (sprites nomeados no Nomeador).

Atualiza:
  · game/src/server/dados/creatures-novos.json (looktype)
  · game/src/server/dados/creatures-sprites-lab.json (looktype de espécies do espelho)
  · game/src/server/dados/shiny-catalogo-novos.json (formas shiny do lab)

  python tools/sincronizar-sprites-jogo.py
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

AQUI = Path(__file__).resolve().parent
GAME = AQUI.parent / "game" / "src" / "server" / "dados"
PUBLIC = AQUI.parent / "public" / "data"
import sys
sys.path.insert(0, str(AQUI / "nomeador"))
from caminhos import lab_index

LAB = lab_index()

CRE_NOVOS = GAME / "creatures-novos.json"
CRE_PATCH = GAME / "creatures-sprites-lab.json"
SHINY_NOVOS = GAME / "shiny-catalogo-novos.json"


def limpar(nome: str) -> str:
    n = unicodedata.normalize("NFD", nome)
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    n = re.sub(r"['\u2019.]", "", n.lower().strip())
    n = re.sub(r"[^a-z0-9]+", "_", n).strip("_")
    if n == "farfetch_d":
        n = "farfetchd"
    return n[:60]


def carregar_lab() -> dict[str, dict]:
    if not LAB.is_file():
        print(f"AVISO: lab-index ausente em {LAB}")
        return {}
    data = json.loads(LAB.read_text(encoding="utf-8"))
    por_slug: dict[str, dict] = {}
    for e in data.get("outfits", {}).values():
        if not e.get("nomeado"):
            continue
        name = e.get("name") or ""
        lt = e.get("looktype") or e.get("lt") or e.get("id")
        if not lt:
            continue
        low = name.lower()
        if low.startswith("shiny_"):
            slug = limpar(name[6:])
            por_slug.setdefault(slug, {})["shiny"] = lt
        elif low.endswith("_shiny"):
            slug = limpar(name[:-6])
            por_slug.setdefault(slug, {})["shiny"] = lt
        elif e.get("kind") == "shiny":
            slug = limpar(name)
            por_slug.setdefault(slug, {})["shiny"] = lt
        else:
            slug = limpar(name)
            if slug and not slug.startswith("shiny"):
                por_slug.setdefault(slug, {})["normal"] = lt
    return por_slug


def slug_de_criatura(c: dict) -> str:
    return limpar(c["name"])


def dex_id(poke_id: int) -> int:
    return poke_id if poke_id < 1000 else poke_id % 1000


def shiny_tier(total: int) -> str:
    if total >= 600:
        return "A"
    if total >= 500:
        return "B"
    return "C"


def main():
    lab = carregar_lab()
    base = json.loads((PUBLIC / "creatures.json").read_text(encoding="utf-8"))["creatures"]
    formulas = json.loads((PUBLIC / "index" / "formulas.json").read_text(encoding="utf-8"))
    shiny_base = {s["dexId"]: s for s in formulas.get("shinyCatalogo", [])}

    novos = json.loads(CRE_NOVOS.read_text(encoding="utf-8")) if CRE_NOVOS.is_file() else {"creatures": []}
    shinies_ant = json.loads(SHINY_NOVOS.read_text(encoding="utf-8")) if SHINY_NOVOS.is_file() else {"entries": []}
    shiny_novo_map = {s["dexId"]: s for s in shinies_ant.get("entries", [])}

    # espécie canônica por dex (pokeId nacional)
    por_dex: dict[int, dict] = {}
    for c in base + novos.get("creatures", []):
        if c["pokeId"] >= 10000:
            continue
        d = dex_id(c["pokeId"])
        ant = por_dex.get(d)
        if not ant or c["pokeId"] < ant["pokeId"]:
            por_dex[d] = c

    patches = []
    lt_novos = 0
    for c in novos.get("creatures", []):
        if c["pokeId"] >= 10000:
            continue
        slug = slug_de_criatura(c)
        hit = lab.get(slug) or {}
        lt = hit.get("normal")
        if lt and lt != c.get("looktype") and lt > 1:
            c["looktype"] = lt
            lt_novos += 1

    lt_patch = 0
    for d, c in sorted(por_dex.items()):
        slug = slug_de_criatura(c)
        hit = lab.get(slug) or {}
        lt = hit.get("normal")
        if not lt or lt <= 1:
            continue
        if c["pokeId"] < 10000 and c.get("looktype") != lt:
            # só patch no espelho — clones 13xxx ficam de fora
            if c in base or any(x["pokeId"] == c["pokeId"] for x in base):
                patches.append({"pokeId": c["pokeId"], "looktype": lt, "name": c["name"]})
                lt_patch += 1

    shiny_ok = 0
    shiny_lab = 0
    for d, c in sorted(por_dex.items()):
        if d in shiny_base:
            continue
        slug = slug_de_criatura(c)
        hit = lab.get(slug) or {}
        lt_s = hit.get("shiny")
        if not lt_s or lt_s <= 1:
            continue
        shiny_lab += 1
        total = sum(c.get(k, 0) for k in ("baseHp", "baseAtk", "baseDef", "baseSpAtk", "baseSpDef", "baseSpeed"))
        shiny_novo_map[d] = {
            "dexId": d,
            "name": c["name"],
            "looktype": lt_s,
            "tier": shiny_tier(total),
            "count": 3,
        }
        shiny_ok += 1

    # mantém entradas antigas, atualizando looktype quando o lab tem melhor
    for d, s in list(shiny_novo_map.items()):
        if d in shiny_base:
            del shiny_novo_map[d]
            continue
        slug = limpar(s.get("name") or por_dex.get(d, {}).get("name", ""))
        lt_s = (lab.get(slug) or {}).get("shiny")
        if lt_s and lt_s > 1:
            s["looktype"] = lt_s

    entries = sorted(shiny_novo_map.values(), key=lambda x: x["dexId"])

    CRE_NOVOS.write_text(json.dumps(novos, ensure_ascii=False, indent=2), encoding="utf-8")
    CRE_PATCH.write_text(
        json.dumps(
            {
                "_leia": "Looktypes do lab-index aplicados sobre creatures.json do espelho.",
                "patches": patches,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    SHINY_NOVOS.write_text(
        json.dumps(
            {
                "_leia": "Shiny catalog complementar — sprites shiny nomeados no Sprite Lab.",
                "entries": entries,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"lab slugs: {len(lab)}")
    print(f"looktypes novos atualizados: {lt_novos}")
    print(f"patches espelho: {lt_patch}")
    print(f"shinies do lab (novos): {shiny_ok} (+{shiny_lab} candidatos)")
    print(f"shiny catalog total complementar: {len(entries)}")
    print(f"  -> {CRE_PATCH}")
    print(f"  -> {SHINY_NOVOS}")


if __name__ == "__main__":
    main()
