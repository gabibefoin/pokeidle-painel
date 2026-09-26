"""Converte TODA a pasta de sprites para o formato de atlas do jogo e monta o
indice que o Nomeador consome.

    python tools/nomeador/construir.py            # incremental (so o que falta)
    python tools/nomeador/construir.py --tudo     # refaz do zero

Entrada : %USERPROFILE%\\Documents\\Sprites  (raiz + NOMEADOS/ NP/ SHINYS_NOVOS/ VAZIOS/ + 1GEN..9GEN/)
Saida   : <raiz>/LAB/{outfits,categories}/... + LAB/lab-index.json

A identidade de cada sprite e o md5 do PNG, nao o caminho - assim renomear no
Nomeador nao faz o build seguinte reconverter nem trocar o id da carta.
"""
import os, sys, json, time, hashlib, argparse
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from converter import converter
from caminhos import sprites_raiz

RAIZ = os.environ.get("SPRITES_RAIZ", str(sprites_raiz()))
SAIDA = os.path.join(RAIZ, "LAB")
INDICE = os.path.join(SAIDA, "lab-index.json")
ID_BASE = 40000

# ordem de varredura = ordem das cartas no Nomeador (mesmas pastas do servidor.mjs)
PASTAS_GEN = ["%dGEN" % g for g in range(1, 10)]
PASTAS = ["", "NOMEADOS", "SHINYS_NOVOS", "NP", "VAZIOS"] + PASTAS_GEN
IGNORAR = {"LAB", "CONVERTIDO"}


def natural(n):
    """outfit_2 antes de outfit_10."""
    base = n[:-4] if n.lower().endswith(".png") else n
    p = base.split("_")
    return tuple((int(x) if x.isdigit() else 0, "" if x.isdigit() else x.lower()) for x in p)


def classificar(pasta, base):
    """(nome, kind, nomeado) a partir da pasta e do nome do arquivo."""
    sem_nome = base.lower().startswith("outfit_") or base.lower().startswith("boss_arena_")
    nome = "" if sem_nome else base
    if pasta == "VAZIOS":
        kind = "vazio"
    elif pasta == "NP":
        kind = "np"
    elif base.lower().startswith("shiny_") or base.lower().endswith("_shiny"):
        kind = "shiny"
    elif pasta == "NOMEADOS":
        kind = "pokemon"
    else:
        kind = "pendente" if sem_nome else "pokemon"
    return nome, kind, not sem_nome


def listar():
    """Todos os PNGs, em ordem estavel, com md5 do conteudo."""
    itens = []
    for pasta in PASTAS:
        d = os.path.join(RAIZ, pasta) if pasta else RAIZ
        if not os.path.isdir(d):
            continue
        for n in sorted(os.listdir(d), key=natural):
            if not n.lower().endswith(".png"):
                continue
            p = os.path.join(d, n)
            if not os.path.isfile(p):
                continue
            base = n[:-4]
            nome, kind, nomeado = classificar(pasta, base)
            with open(p, "rb") as f:
                chave = hashlib.md5(f.read()).hexdigest()[:16]
            itens.append({
                "pasta": pasta, "arquivo": (pasta + "/" + n) if pasta else n,
                "png": p, "nome": nome, "kind": kind, "nomeado": nomeado, "chave": chave,
            })
    return itens


def _manifest_de_id(oid):
    """Atlas ja convertido no LAB — manifest mais recente (mtime)."""
    import glob
    hits = glob.glob(os.path.join(SAIDA, "categories", "outfits-male-%d-*.json" % oid))
    if not hits:
        return None
    hits.sort(key=os.path.getmtime, reverse=True)
    return "/assets-packs/categories/" + os.path.basename(hits[0])


def _paths_atlas(manifest_rel):
    """Resolve manifest + webp no LAB a partir do caminho do indice."""
    if not manifest_rel:
        return None, None
    man_path = os.path.join(
        SAIDA, manifest_rel.replace("/assets-packs/", "").replace("/", os.sep))
    if not os.path.isfile(man_path):
        return man_path, None
    try:
        with open(man_path, encoding="utf-8") as f:
            man = json.load(f)
        page = next(iter(man.get("categories", {}).values()))["pages"][0]
        webp = os.path.join(
            SAIDA, page["image"].replace("/assets-packs/", "").replace("/", os.sep))
        return man_path, webp
    except (StopIteration, KeyError, IndexError, json.JSONDecodeError):
        return man_path, None


def _atlas_desatualizado(png_path, manifest_rel):
    """PNG trocado no backup/lab mas atlas antigo ainda no disco."""
    if not manifest_rel or not os.path.isfile(png_path):
        return False
    png_mtime = os.path.getmtime(png_path)
    man_path, webp_path = _paths_atlas(manifest_rel)
    if man_path and os.path.isfile(man_path) and png_mtime > os.path.getmtime(man_path):
        return True
    if webp_path and os.path.isfile(webp_path) and png_mtime > os.path.getmtime(webp_path):
        return True
    return False


def _atlas_quebrado(manifest_rel, min_bytes=128):
    """Atlas truncado/vazio — aparece como sprite errado ou invisivel no jogo."""
    _, webp_path = _paths_atlas(manifest_rel)
    if not webp_path or not os.path.isfile(webp_path):
        return True
    return os.path.getsize(webp_path) < min_bytes


def recuperar_antigo_perdido(antigo):
    """Reconecta PNGs cujo atlas ainda existe mas sairam do lab-index (ex.: pastas *GEN)."""
    log = os.path.join(SAIDA, "renomeacoes.jsonl")
    if not os.path.isfile(log):
        return 0

    ultimo = {}
    origem = {}
    with open(log, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            oid = ev.get("id")
            para = (ev.get("para") or "").replace("\\", "/")
            de = (ev.get("de") or "").replace("\\", "/")
            if oid is None or not para:
                continue
            ultimo[oid] = para
            base = os.path.basename(de)
            if base.lower().startswith("outfit_") and oid not in origem:
                origem[oid] = base

    recuperados = 0
    for oid, rel in ultimo.items():
        p = os.path.join(RAIZ, rel.replace("/", os.sep))
        if not os.path.isfile(p):
            continue
        with open(p, "rb") as f:
            chave = hashlib.md5(f.read()).hexdigest()[:16]
        if chave in antigo:
            continue
        man = _manifest_de_id(oid)
        if not man or not os.path.isfile(os.path.join(SAIDA, man.replace("/assets-packs/", "").replace("/", os.sep))):
            continue
        pasta = rel.split("/")[0] if "/" in rel else ""
        base = os.path.splitext(os.path.basename(rel))[0]
        nome, kind, nomeado = classificar(pasta, base)
        antigo[chave] = {
            "id": oid,
            "gender": "male",
            "category": "outfits/male/%d" % oid,
            "manifest": man,
            "colorizable": False,
            "directions": 4,
            "frames": 2,
            "width": 2,
            "height": 2,
            "name": nome,
            "kind": kind,
            "arquivo": rel,
            "pasta": pasta,
            "chave": chave,
            "nomeado": nomeado,
            "origem": origem.get(oid, os.path.basename(rel)),
        }
        recuperados += 1
    return recuperados


def _job(a):
    """Roda no worker: converte um PNG. Nunca levanta - devolve o erro."""
    it, oid = a
    try:
        r = converter(it["png"], oid, it["nome"], kind=it["kind"], raiz=SAIDA, metodo=4)
        return oid, r, None
    except Exception as e:
        return oid, None, "%s: %s" % (type(e).__name__, e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tudo", action="store_true", help="reconverte tudo, ignorando o indice atual")
    args = ap.parse_args()

    t0 = time.time()
    itens = listar()
    print("PNGs encontrados: %d" % len(itens))

    antigo = {}
    if os.path.isfile(INDICE) and not args.tudo:
        with open(INDICE, encoding="utf-8") as f:
            for k, e in json.load(f)["outfits"].items():
                e = dict(e)
                # chave do JSON e a identidade estavel; id interno desalinhado quebrava rename
                if str(e.get("id")) != str(k):
                    e["id"] = int(k)
                antigo[e["chave"]] = e
    n_rec = recuperar_antigo_perdido(antigo)
    if n_rec:
        print("ids recuperados do log/atlas: %d" % n_rec)

    # ids estaveis por conteudo; conteudo repetido ganha ocorrencia propria
    vistos, usados, refazer, saida = {}, set(), [], {}
    prox = ID_BASE
    for it in itens:
        n = vistos.get(it["chave"], 0)
        vistos[it["chave"]] = n + 1
        if n:
            it["chave"] = "%s#%d" % (it["chave"], n)

        velho = antigo.get(it["chave"])
        oid = velho["id"] if velho and velho["id"] not in usados else None
        if oid is None:
            while prox in usados:
                prox += 1
            oid, prox = prox, prox + 1
        usados.add(oid)
        it["id"] = oid

        pronto = velho and velho.get("manifest") and os.path.isfile(
            os.path.join(SAIDA, velho["manifest"].replace("/assets-packs/", "").replace("/", os.sep)))
        if pronto and _atlas_desatualizado(it["png"], velho.get("manifest")):
            pronto = False
        if pronto and _atlas_quebrado(velho.get("manifest")):
            pronto = False
        if pronto:
            e = dict(velho)
            rel = it["arquivo"].replace("\\", "/")
            e.update({"id": oid, "name": it["nome"], "kind": it["kind"], "nomeado": it["nomeado"],
                      "arquivo": rel, "pasta": it["pasta"], "origem": e.get("origem", rel)})
            man = _manifest_de_id(oid)
            if man:
                e["manifest"] = man
                e["category"] = "outfits/male/%d" % oid
            saida[oid] = e
        else:
            refazer.append((it, oid))

    print("ja convertidos: %d · a converter: %d" % (len(itens) - len(refazer), len(refazer)))

    falhas, feitos, bytes_tot = [], 0, 0
    if refazer:
        por_id = {o: x for x, o in refazer}
        with ProcessPoolExecutor() as pool:
            for oid, r, erro in pool.map(_job, refazer, chunksize=8):
                it = por_id[oid]
                if erro:
                    falhas.append((it["arquivo"], erro))
                    saida[oid] = {"id": oid, "gender": "male", "manifest": None,
                                  "directions": 0, "frames": 0, "width": 0, "height": 0,
                                  "name": it["nome"], "kind": it["kind"], "erro": erro}
                else:
                    bytes_tot += r.pop("bytes")
                    saida[oid] = r
                rel = it["arquivo"].replace("\\", "/")
                saida[oid].update({"id": oid, "arquivo": rel, "pasta": it["pasta"],
                                   "chave": it["chave"], "nomeado": it["nomeado"],
                                   "origem": (antigo.get(it["chave"]) or {}).get("origem", rel)})
                feitos += 1
                if feitos % 250 == 0:
                    print("  %d/%d  (%.0fs)" % (feitos, len(refazer), time.time() - t0), flush=True)

    os.makedirs(SAIDA, exist_ok=True)
    with open(INDICE, "w", encoding="utf-8") as f:
        json.dump({
            "format": "sprite-lab-nomeador-v1",
            "gerado": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "raiz": RAIZ,
            "outfits": {str(k): saida[k] for k in sorted(saida)},
        }, f, ensure_ascii=False)

    if falhas:
        with open(os.path.join(SAIDA, "nao-convertidos.csv"), "w", encoding="utf-8") as f:
            f.write("arquivo,erro\n")
            for a, e in falhas:
                f.write('"%s","%s"\n' % (a, e.replace('"', "'")))

    nomeados = sum(1 for e in saida.values() if e.get("nomeado"))
    print("\nindice: %s" % INDICE)
    print("%d sprites · %d nomeados · %d sem nome · %d falharam · +%.1f MB · %.0fs"
          % (len(saida), nomeados, len(saida) - nomeados, len(falhas),
             bytes_tot / 1048576, time.time() - t0))
    if falhas:
        print("falhas listadas em LAB/nao-convertidos.csv (o Nomeador mostra o PNG cru nesses)")


if __name__ == "__main__":
    main()
