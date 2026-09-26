#!/usr/bin/env python3
"""Gera pokedex-catalog.json a partir do export pokemondb (uploads/shiny-0.md)."""
import json
import re
import unicodedata
from pathlib import Path

AQUI = Path(__file__).resolve().parent
SHINY_MD = AQUI.parents[1] / ".cursor" / "projects" / "c-PokeIdle-io" / "uploads" / "shiny-0.md"
if not SHINY_MD.is_file():
    SHINY_MD = Path.home() / ".cursor" / "projects" / "c-PokeIdle-io" / "uploads" / "shiny-0.md"
SAIDA = AQUI / "pokedex-catalog.json"

OMITIR = {
    "meloetta_aria",
    "meowstic_male",
}

SPECIAL = {
    "Meloetta (Pirouette Forme)": "meloetta_pirouette",
    "Nidoran♀": "nidoran_female",
    "Nidoran♂": "nidoran_male",
}

FAIXAS = [
    {"id": "1", "rotulo": "1ª Geração", "regiao": "Kanto", "min": 1, "max": 151},
    {"id": "2", "rotulo": "2ª Geração", "regiao": "Johto", "min": 152, "max": 251},
    {"id": "3", "rotulo": "3ª Geração", "regiao": "Hoenn", "min": 252, "max": 386},
    {"id": "4", "rotulo": "4ª Geração", "regiao": "Sinnoh", "min": 387, "max": 493},
    {"id": "5", "rotulo": "5ª Geração", "regiao": "Unova", "min": 494, "max": 649},
    {"id": "6", "rotulo": "6ª Geração", "regiao": "Kalos", "min": 650, "max": 721},
    {"id": "7", "rotulo": "7ª Geração", "regiao": "Alola", "min": 722, "max": 809},
    {"id": "8", "rotulo": "8ª Geração", "regiao": "Galar", "min": 810, "max": 905},
    {"id": "9", "rotulo": "9ª Geração", "regiao": "Paldea", "min": 906, "max": 1025},
]


def limpar(nome: str) -> str:
    n = unicodedata.normalize("NFD", nome)
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    n = re.sub(r"['\u2019.]", "", n.lower().strip())
    n = re.sub(r"[^a-z0-9]+", "_", n).strip("_")
    if n == "farfetch_d":
        n = "farfetchd"
    return n[:60]


def slug_de(nome: str) -> str:
    if nome in SPECIAL:
        return SPECIAL[nome]

    if nome.startswith("Nidoran"):
        if "♀" in nome:
            return "nidoran_female"
        if "♂" in nome:
            return "nidoran_male"

    m = re.match(r"^(.+?) \((Male|Female)\)$", nome, re.I)
    if m:
        return f"{limpar(m.group(1))}_{m.group(2).lower()}"

    m = re.match(r"^(.+?) (Male|Female)$", nome, re.I)
    if m:
        return f"{limpar(m.group(1))}_{m.group(2).lower()}"

    return limpar(nome)


def eh_mega(nome: str, slug: str) -> bool:
    return nome.startswith("Mega ") or slug.startswith("mega_")


def eh_primal(nome: str, slug: str) -> bool:
    return nome.startswith("Primal ") or slug.startswith("primal_")


def eh_alolan(nome: str, slug: str) -> bool:
    return "Alolan" in nome or "alolan" in slug


def eh_galarian(nome: str, slug: str) -> bool:
    return "Galarian" in nome or "galarian" in slug


def eh_hisuian(nome: str, slug: str) -> bool:
    return "Hisuian" in nome or "hisuian" in slug


def eh_tauros_raca(nome: str, slug: str) -> bool:
    return slug in ("tauros_aqua_breed", "tauros_blaze_breed", "tauros_combat_breed") or (
        nome.startswith("Tauros (") and "Breed" in nome
    )


def eh_paldean(nome: str, slug: str) -> bool:
    return "Paldean" in nome or "paldean" in slug


def omitir_forma_extra(nome: str, slug: str) -> bool:
    return (
        eh_alolan(nome, slug)
        or eh_galarian(nome, slug)
        or eh_hisuian(nome, slug)
        or eh_paldean(nome, slug)
        or eh_tauros_raca(nome, slug)
    )


def main():
    text = SHINY_MD.read_text(encoding="utf-8")
    pat = re.compile(r"^(.+?) normal sprite .+? #(\d{4})\s*$", re.M)
    raw = []
    for m in pat.finditer(text):
        nome = m.group(1).strip()
        dex = int(m.group(2))
        slug = slug_de(nome)
        if eh_mega(nome, slug) or eh_primal(nome, slug):
            continue
        raw.append({"dex": dex, "nome": nome, "slug": slug})

    seen = set()
    entradas = []
    for e in raw:
        if e["slug"] in seen or e["slug"] in OMITIR:
            continue
        seen.add(e["slug"])
        entradas.append(e)

    geracoes = []
    for f in FAIXAS:
        g = [e for e in entradas if f["min"] <= e["dex"] <= f["max"]]
        g = [e for e in g if not omitir_forma_extra(e["nome"], e["slug"])]
        g.sort(key=lambda x: (x["dex"], x["slug"]))
        geracoes.append({**f, "entradas": g, "total": len(g)})

    out = {"fonte": "pokemondb.net/pokedex/shiny", "geracoes": geracoes}
    SAIDA.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK {SAIDA} · {len(entradas)} entradas")
    for g in geracoes:
        print(f"  gen {g['id']}: {g['total']} (#{g['min']:03d}–#{g['max']:03d})")


if __name__ == "__main__":
    main()
