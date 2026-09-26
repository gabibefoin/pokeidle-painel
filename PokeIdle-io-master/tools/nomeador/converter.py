"""Converte folha PNG -> atlas do jogo (stonegy-asset-packs-v1).

Entrada : PNG com grade de 4 colunas (direcoes 1=N 2=L 3=S 4=O) x N linhas (frames)
Saida   : atlas .webp lossless + manifest JSON, no mesmo layout que
          public/data/asset-packs/ usa em producao.

Convencoes copiadas do gerador oficial (conferidas quadro a quadro):
  padding = 2, quadros lado a lado a partir de (2, 2), x = 2 + i*(frameW+2),
  quebrando em linhas quando nao cabe na pagina, pagina de 4094 de largura,
  ordem dos quadros = por direcao e depois por frame,
  chave do asset = "{frame}_{layer}_{addon}_{direcao}.png".
"""
import os, json, hashlib, io
import numpy as np
from PIL import Image

PADDING = 2
MAX_TEX = 4096
TILE = 32


def bands(m):
    out, s = [], None
    for i, v in enumerate(m):
        if v and s is None:
            s = i
        elif not v and s is not None:
            out.append((s, i)); s = None
    if s is not None:
        out.append((s, len(m)))
    return out


def detectar_grade(im):
    """Devolve (frameW, frameH, n_frames). 4 colunas fixas; linhas = frames."""
    W, H = im.size
    fw = W // 4
    if fw == 0 or W % 4:
        raise ValueError("largura %d nao divide em 4 colunas" % W)

    alpha = np.array(im)[:, :, 3] > 0
    cand = [r for r in range(1, 21) if H % r == 0 and (H // r) % TILE == 0]
    if not cand:
        raise ValueError("altura %d nao gera frames multiplos de %d" % (H, TILE))

    # pista forte: quantas faixas de conteudo existem na vertical. So vale a
    # partir de 2 faixas - `nb == 1` significa apenas que o conteudo encosta de
    # uma linha na outra, o que e o normal em sprite que ocupa os 32px inteiros,
    # e nao prova de folha de um quadro so. Confiar nisso empilhava as poses
    # dentro de um quadro unico (Tyrogue: 128x96 virava 1 quadro de 32x96).
    nb = len(bands(alpha.any(axis=1)))
    if nb > 1 and nb in cand:
        r = nb
    else:
        # senao, o que deixa o quadro mais proximo de quadrado. No EMPATE, prefere a
        # contagem de frames mais perto de 3 (a norma esmagadora). Sem isso, uma folha
        # 256x96 vira 1 quadro de 64x96 com as tres poses empilhadas dentro.
        r = min(cand, key=lambda r: (abs(H // r - fw), abs(r - 3)))
    return fw, H // r, r


def converter(png, oid, nome, kind="pokemon", gender="male", raiz=".",
              colorizable=False, metodo=6, grade=None):
    """`grade` e um [largura, altura, frames] que SUBSTITUI a deteccao automatica.

    `detectar_grade` acerta em 1.354 das 1.356 folhas do backup, e nas duas que erra o erro e
    o mesmo: folha de 4 colunas em que as poses se TOCAM na vertical, entao a contagem de
    faixas de conteudo devolve 1 e a regra de desempate ("o quadro mais proximo de quadrado,
    preferindo 3 frames") escolhe o numero errado. No Totodile (256x288, quadro 64x32, 9
    frames) os dois candidatos 32 e 96 estao a 32 px de distancia de 64 — empate perfeito —, e
    o desempate por "3 frames" empilhou tres poses dentro de um quadro so.

    Corrigir a heuristica mexeria nas outras 1.354; declarar a excecao nao mexe em nenhuma.
    A tabela mora em `publicar-sprites-backup.mjs`, junto da lista de jobs.
    """
    im = Image.open(png).convert("RGBA")
    if grade:
        fw, fh, nframes = int(grade[0]), int(grade[1]), int(grade[2])
    else:
        fw, fh, nframes = detectar_grade(im)
    if fw % TILE or fh % TILE:
        raise ValueError("quadro %dx%d nao e multiplo de %d" % (fw, fh, TILE))

    # recorta na ordem oficial: direcao externa, frame interno
    quadros = []
    for d in range(1, 5):
        for f in range(1, nframes + 1):
            quadros.append((f, d, im.crop(((d - 1) * fw, (f - 1) * fh, d * fw, f * fh))))

    # uma faixa horizontal; quebra em linhas quando nao cabe (igual ao gerador
    # oficial, que faz isso nos outfits grandes - ver outfits-male-1885)
    larg = MAX_TEX - PADDING
    por_linha = max(1, (larg - PADDING) // (fw + PADDING))
    n_linhas = (len(quadros) + por_linha - 1) // por_linha

    pagina = Image.new("RGBA", (larg, n_linhas * (fh + PADDING)), (0, 0, 0, 0))
    assets = {}
    for i, (f, d, q) in enumerate(quadros):
        x = PADDING + (i % por_linha) * (fw + PADDING)
        y = PADDING + (i // por_linha) * (fh + PADDING)
        pagina.paste(q, (x, y))
        chave = "/assets/outfits/%s/%d/%d_1_1_%d.png" % (gender, oid, f, d)
        assets[chave] = {
            "category": "outfits/%s/%d" % (gender, oid),
            "source": chave,
            "sourceType": "png",
            "width": fw,
            "height": fh,
            "frameCount": 1,
            "frameDurationMs": 150,
            "frames": [{"page": 0, "x": x, "y": y, "w": fw, "h": fh, "durationMs": 150}],
        }

    buf = io.BytesIO()
    pagina.save(buf, format="WEBP", lossless=True, quality=100, method=metodo)
    dados = buf.getvalue()
    hpag = hashlib.md5(dados).hexdigest()[:12]

    rel_img = "/assets-packs/outfits/%s/%d/outfits-%s-%d-00-%s.webp" % (gender, oid, gender, oid, hpag)
    cat = {
        "id": "outfits/%s/%d" % (gender, oid),
        "assetCount": len(quadros),
        "frameCount": len(quadros),
        "colorizable": colorizable,
        "geometry": {"width": fw // TILE, "height": fh // TILE,
                     "directions": 4, "frames": nframes, "layers": 1},
        "pageFormat": "webp",
        "pageEncoding": "webp-lossless",
        "pages": [{"index": 0, "image": rel_img,
                   "width": pagina.width, "height": pagina.height,
                   "bytes": len(dados), "hash": hpag,
                   "format": "webp", "encoding": "webp-lossless"}],
    }
    manifest = {
        "format": "stonegy-asset-packs-v1",
        "generatorVersion": 2,
        "maxTextureSize": MAX_TEX,
        "padding": PADDING,
        "pageFormat": "webp",
        "pageEncoding": "webp-lossless",
        "categories": {"outfits/%s/%d" % (gender, oid): cat},
        "assets": assets,
    }
    hman = hashlib.md5(json.dumps(manifest, sort_keys=True).encode()).hexdigest()[:12]
    cat["version"] = hman
    manifest["version"] = hman

    dimg = os.path.join(raiz, "outfits", gender, str(oid))
    dman = os.path.join(raiz, "categories")
    os.makedirs(dimg, exist_ok=True)
    os.makedirs(dman, exist_ok=True)
    with open(os.path.join(dimg, os.path.basename(rel_img)), "wb") as f:
        f.write(dados)
    pman = os.path.join(dman, "outfits-%s-%d-%s.json" % (gender, oid, hman))
    with open(pman, "w", encoding="utf-8") as f:
        json.dump(manifest, f)

    return {
        "id": oid, "gender": gender,
        "category": "outfits/%s/%d" % (gender, oid),
        "manifest": "/assets-packs/categories/outfits-%s-%d-%s.json" % (gender, oid, hman),
        "colorizable": colorizable, "directions": 4, "frames": nframes,
        "width": fw // TILE, "height": fh // TILE,
        "name": nome, "kind": kind,
        "bytes": len(dados),
    }
