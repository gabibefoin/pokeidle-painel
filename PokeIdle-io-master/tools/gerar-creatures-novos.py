#!/usr/bin/env python3
"""Gera creatures + shiny catalog para espécies que o PokeIdle ainda não tem (gen 3–9).

Fontes:
  · tipos: uploads/shiny-0.md (pokemondb shiny dex)
  · stats/evolução: PokeAPI (cache local em pokeapi-cache.json)
  · golpes: templates por type1 extraídos do creatures.json do jogo
  · looktypes: lab-index.json (sprites já nomeados no Sprite Lab)

Saída:
  · game/src/server/dados/creatures-novos.json
  · game/src/server/dados/shiny-catalogo-novos.json

  python tools/gerar-creatures-novos.py
  python tools/gerar-creatures-novos.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import re
import time
import unicodedata
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
SHINY_MD = RAIZ.parent / ".cursor" / "projects" / "c-PokeIdle-io" / "uploads" / "shiny-0.md"
if not SHINY_MD.is_file():
    SHINY_MD = Path.home() / ".cursor" / "projects" / "c-PokeIdle-io" / "uploads" / "shiny-0.md"

GAME = RAIZ / "public" / "data"
import sys
sys.path.insert(0, str(AQUI / "nomeador"))
from caminhos import sprites_raiz

LAB = Path(__import__("os").environ.get("SPRITES_RAIZ") or str(sprites_raiz())) / "LAB"
CACHE = AQUI / "pokeapi-cache.json"
SAIDA_CRE = RAIZ / "game" / "src" / "server" / "dados" / "creatures-novos.json"
SAIDA_SHI = RAIZ / "game" / "src" / "server" / "dados" / "shiny-catalogo-novos.json"

FAIXAS = [
    (252, 386, "hoenn", 500),
    (387, 493, "sinnoh", 1000),
    (494, 649, "unova", 5000),
    (650, 721, "kalos", 10000),
    (722, 809, "alola", 7500),
    (810, 905, "galar", 8500),
    (906, 1025, "paldea", 10000),
]

TIPO_MAP = {
    "normal": "NORMAL", "fire": "FIRE", "water": "WATER", "grass": "GRASS",
    "electric": "ELECTRIC", "ice": "ICE", "fighting": "FIGHTING", "poison": "POISON",
    "ground": "GROUND", "flying": "FLYING", "psychic": "PSYCHIC", "bug": "BUG",
    "rock": "ROCK", "ghost": "GHOST", "dragon": "DRAGON", "dark": "DARK",
    "steel": "STEEL", "fairy": "FAIRY",
}


def limpar(nome: str) -> str:
    n = unicodedata.normalize("NFD", nome)
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    n = re.sub(r"['\u2019.]", "", n.lower().strip())
    n = re.sub(r"[^a-z0-9]+", "_", n).strip("_")
    if n == "farfetch_d":
        n = "farfetchd"
    return n[:60]


def skip_forma(nome: str) -> bool:
    if nome.startswith("Mega ") or nome.startswith("Primal "):
        return True
    if any(x in nome for x in ("Alolan", "Galarian", "Hisuian", "Paldean")):
        return True
    if "Tauros (" in nome and "Breed" in nome:
        return True
    return False


def tipos_da_linha(linha: str) -> list[str]:
    """Os tipos da linha — ou [] se ela tiver qualquer palavra que não é um dos 18 tipos."""
    partes = [p.lower() for p in linha.replace("·", " ").split() if p.strip()]
    return [TIPO_MAP[p] for p in partes] if partes and all(p in TIPO_MAP for p in partes) else []


def parse_shiny_md(text: str) -> list[dict]:
    pat = re.compile(r"^(.+?) normal sprite .+? #(\d{4})\s*\n(.+?)\s*\n(.+?)\s*$", re.M)
    out = []
    for m in pat.finditer(text):
        nome = m.group(1).strip()
        if skip_forma(nome):
            continue
        dex = int(m.group(2))
        # Nas formas ("Giratina (Altered Forme)") a 4ª linha é o nome da forma e os tipos vêm na
        # seguinte. Ler a linha da forma como tipagem deu 38 espécies com tipo "ALTERED", "MALE"…
        tipos = tipos_da_linha(m.group(4)) or tipos_da_linha(text[m.end():].lstrip("\n").split("\n", 1)[0])
        if not tipos:
            print(f"  [!] sem tipos reconhecíveis: #{dex} {nome}")
            continue
        # O jogo mostra só a espécie; o slug fica com a forma, que é como o Sprite Lab nomeia a arte.
        base = re.sub(r"\s*\(.*\)\s*$", "", nome)
        out.append({"dex": dex, "nome": base, "slug": limpar(nome), "type1": tipos[0], "type2": tipos[1] if len(tipos) > 1 else None})
    return out


def parse_tipos_linha(linha: str) -> tuple[str, str | None]:
    partes = [TIPO_MAP.get(p.lower().strip(), p.upper()) for p in linha.replace("·", " ").split() if p.strip()]
    return partes[0], partes[1] if len(partes) > 1 else None


def carregar_lab() -> dict[str, dict]:
    idx = LAB / "lab-index.json"
    if not idx.is_file():
        return {}
    data = json.loads(idx.read_text(encoding="utf-8"))
    por_slug: dict[str, dict] = {}
    for e in data.get("outfits", {}).values():
        if not e.get("nomeado"):
            continue
        slug = limpar(e.get("name") or "")
        if not slug:
            continue
        kind = e.get("kind") or "pokemon"
        hit = por_slug.setdefault(slug, {"normal": None, "shiny": None})
        lt = e.get("looktype") or e.get("lt")
        if kind == "shiny":
            hit["shiny"] = lt
        elif kind in ("pokemon", "nomeado"):
            hit["normal"] = lt
    return por_slug


def ataques_por_tipo(creatures: list[dict]) -> dict[str, list]:
    """Legado — só 2 golpes; rode `node tools/aplicar-ataques-novos.mjs` após gerar."""
    por = defaultdict(list)
    for c in creatures:
        t = c.get("type1")
        atk = c.get("attacks") or []
        if t and len(atk) >= 2 and t not in por:
            por[t] = atk[:2]
    # fallback universal
    padrao = [
        {"name": "Tackle", "power": 56, "type": "NORMAL", "category": "PHYSICAL", "cooldownMs": 10000, "learnLevel": 1},
        {"name": "Quick Attack", "power": 56, "type": "NORMAL", "category": "PHYSICAL", "cooldownMs": 10000, "learnLevel": 5},
    ]
    for t in TIPO_MAP.values():
        por.setdefault(t, por.get(t) or padrao)
    return dict(por)


def faixa_dex(dex: int) -> tuple[str, int] | None:
    for a, b, reg, gate in FAIXAS:
        if a <= dex <= b:
            return reg, gate
    return None


def rarity_de_stats(total: int, legendary: bool) -> str:
    if legendary:
        return "LEGENDARY"
    if total >= 600:
        return "EPIC"
    if total >= 500:
        return "RARE"
    if total >= 400:
        return "UNCOMMON"
    return "COMMON"


def shiny_tier(total: int, legendary: bool) -> str:
    if legendary:
        return "S"
    if total >= 600:
        return "A"
    if total >= 500:
        return "B"
    return "C"


def api_get(url: str, cache: dict) -> dict | None:
    if url in cache:
        return cache[url]
    req = urllib.request.Request(url, headers={"User-Agent": "PokeIdle-lab/1.0"})
    for tentativa in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode())
            cache[url] = data
            time.sleep(0.08)
            return data
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            time.sleep(0.5 * (tentativa + 1))
    return None


def stats_pokemon(dex: int, cache: dict) -> dict | None:
    p = api_get(f"https://pokeapi.co/api/v2/pokemon/{dex}/", cache)
    if not p:
        return None
    stats = {s["stat"]["name"]: s["base_stat"] for s in p["stats"]}
    return {
        "baseHp": stats.get("hp", 50),
        "baseAtk": stats.get("attack", 50),
        "baseDef": stats.get("defense", 50),
        "baseSpAtk": stats.get("special-attack", 50),
        "baseSpDef": stats.get("special-defense", 50),
        "baseSpeed": stats.get("speed", 50),
        "legendary": any(t["type"]["name"] == "legendary" for t in p.get("types", [])),
    }


def evolucao(dex: int, cache: dict) -> tuple[int | None, int | None]:
    sp = api_get(f"https://pokeapi.co/api/v2/pokemon-species/{dex}/", cache)
    if not sp:
        return None, None
    chain_url = sp.get("evolution_chain", {}).get("url")
    if not chain_url:
        return None, None
    chain = api_get(chain_url, cache)
    if not chain:
        return None, None

    alvo = None

    def walk(node, origem):
        nonlocal alvo
        num = int(node["species"]["url"].rstrip("/").split("/")[-1])
        if num == dex:
            for ev in node.get("evolves_to", []):
                alvo = int(ev["species"]["url"].rstrip("/").split("/")[-1])
                return
        for ev in node.get("evolves_to", []):
            walk(ev, origem)

    walk(chain.get("chain", {}), dex)
    if alvo:
        return alvo, 40
    return None, None


def montar_entrada(meta, stats, ataques, looktype, hunt_level, poke_id, cache, extra=None):
    total = stats["baseHp"] + stats["baseAtk"] + stats["baseDef"] + stats["baseSpAtk"] + stats["baseSpDef"] + stats["baseSpeed"]
    ev_to, ev_lv = evolucao(meta["dex"], cache)
    ent = {
        "pokeId": poke_id,
        "name": meta["nome"],
        "looktype": looktype or 1,
        "description": f"a {meta['nome'].lower()}",
        "type1": meta["type1"],
        "rarity": rarity_de_stats(total, stats.get("legendary", False)),
        "baseHp": stats["baseHp"],
        "baseAtk": stats["baseAtk"],
        "baseDef": stats["baseDef"],
        "baseSpAtk": stats["baseSpAtk"],
        "baseSpDef": stats["baseSpDef"],
        "baseSpeed": stats["baseSpeed"],
        "huntLevel": hunt_level,
        "priceNpc": 3000,
        "sellValue": 3000,
        "experience": 248,
        "attacks": [dict(a) for a in ataques],
    }
    if meta.get("type2"):
        ent["type2"] = meta["type2"]
    if ev_to:
        ent["evolvesToId"] = ev_to
        ent["evolveLevel"] = ev_lv
    if extra:
        ent.update(extra)
    return ent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    text = SHINY_MD.read_text(encoding="utf-8")
    pokedex = parse_shiny_md(text)
    existentes = json.loads((GAME / "creatures.json").read_text(encoding="utf-8"))["creatures"]
    nomes = {c["name"].lower() for c in existentes}
    ids = {c["pokeId"] for c in existentes}
    ataques_tpl = ataques_por_tipo(existentes)
    lab = carregar_lab()

    cache: dict = {}
    if CACHE.is_file():
        cache = json.loads(CACHE.read_text(encoding="utf-8"))

    novos = []
    shinies = []
    faltando = [m for m in pokedex if m["dex"] >= 252 and m["nome"].lower() not in nomes]

    print(f"{len(faltando)} espécies novas (gen 3–9)")

    for i, meta in enumerate(faltando, 1):
        stats = stats_pokemon(meta["dex"], cache)
        if not stats:
            print(f"  [!] sem stats: #{meta['dex']} {meta['nome']}")
            continue
        lt = (lab.get(meta["slug"]) or {}).get("normal")
        shiny_lt = (lab.get(meta["slug"]) or {}).get("shiny")
        atk = ataques_tpl.get(meta["type1"], ataques_tpl["NORMAL"])
        faixa = faixa_dex(meta["dex"])
        gate = faixa[1] if faixa else 500

        if meta["dex"] not in ids:
            novos.append(montar_entrada(meta, stats, atk, lt, gate, meta["dex"], cache))
            ids.add(meta["dex"])

        # Hoenn: clone Orre (13xxx) para hunts de level alto
        if 252 <= meta["dex"] <= 386:
            orre_id = 13000 + meta["dex"]
            if orre_id not in ids:
                novos.append(montar_entrada(
                    meta, stats, atk, lt, 550, orre_id, cache,
                    {"area": "orre", "captureBase": meta["dex"], "orreTier": 0.2, "orreXpMul": 52.67},
                ))
                ids.add(orre_id)

        total = stats["baseHp"] + stats["baseAtk"] + stats["baseDef"] + stats["baseSpAtk"] + stats["baseSpDef"] + stats["baseSpeed"]
        shinies.append({
            "dexId": meta["dex"],
            "name": meta["nome"],
            "looktype": shiny_lt or (lt + 5000 if lt else 1),
            "tier": shiny_tier(total, stats.get("legendary", False)),
            "count": 3,
        })

        if i % 25 == 0:
            print(f"  … {i}/{len(faltando)}")
            if not args.dry_run:
                CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    out_cre = {
        "_leia": "Gerado por tools/gerar-creatures-novos.py — espécies gen 3–9 ausentes do espelho. Mesclado em content.mjs no boot.",
        "creatures": novos,
    }
    out_shi = {
        "_leia": "Shiny catalog complementar — looktypes do lab-index quando existem.",
        "entries": shinies,
    }

    print(f"OK · {len(novos)} creatures · {len(shinies)} shinies")

    if args.dry_run:
        print("(dry-run — nada gravado)")
        return

    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    SAIDA_CRE.parent.mkdir(parents=True, exist_ok=True)
    SAIDA_CRE.write_text(json.dumps(out_cre, ensure_ascii=False, indent=2), encoding="utf-8")
    SAIDA_SHI.write_text(json.dumps(out_shi, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  -> {SAIDA_CRE}")
    print(f"  -> {SAIDA_SHI}")


if __name__ == "__main__":
    main()
