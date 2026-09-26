"""Sugere nome para a primeira sprite de cada bloco de silhueta de `NP/`.

    python tools/nomeador/sugerir.py            # escreve sugestoes-np.json no LAB

A ideia: a pasta já tem ~1400 sprites nomeadas. Em vez de identificar no olho, mede a
mesma silhueta (IoU das vistas sul e leste em escala nativa, igual ao silhuetas.py)
entre cada representante de bloco e TODAS as nomeadas. Blastoise de chapéu casa com o
`blastoise` já nomeado; treinador nenhum casa com coisa alguma.

Sai um JSON com o melhor palpite e a nota de cada bloco, para a parte visual ficar só
com o que a medida não resolveu.
"""
import json, os, sys
import numpy as np
from PIL import Image

from caminhos import sprites_raiz

RAIZ = os.environ.get("SPRITES_RAIZ", str(sprites_raiz()))
LAB = os.path.join(RAIZ, "LAB")
QUADRO, REDUZ = 128, 2
LADO = QUADRO // REDUZ
DIRS = 4
COLUNAS = (2, 1)

indice = json.load(open(os.path.join(LAB, "lab-index.json"), encoding="utf-8"))["outfits"]
sil = json.load(open(os.path.join(LAB, "silhuetas.json"), encoding="utf-8"))
por_id = sil["porId"]


def assinatura(e):
    im = Image.open(os.path.join(RAIZ, e["arquivo"])).convert("RGBA")
    frames = max(e.get("frames") or 1, 1)
    fw, fh = im.width // DIRS, im.height // frames
    if fw <= 0 or fh <= 0:
        return None
    alpha = im.split()[3]
    partes = []
    for d in COLUNAS:
        m = alpha.crop((d * fw, 0, (d + 1) * fw, fh)).point(lambda a: 255 if a > 8 else 0)
        bb = m.getbbox()
        if bb:
            m = m.crop(bb)
        if m.width > QUADRO or m.height > QUADRO:
            z = min(QUADRO / m.width, QUADRO / m.height)
            m = m.resize((max(1, round(m.width * z)), max(1, round(m.height * z))), Image.BILINEAR)
        q = Image.new("L", (QUADRO, QUADRO), 0)
        q.paste(m, ((QUADRO - m.width) // 2, (QUADRO - m.height) // 2))
        if REDUZ > 1:
            q = q.resize((LADO, LADO), Image.BILINEAR)
        partes.append(np.asarray(q, dtype=np.uint8) > 96)
    return np.concatenate([p.ravel() for p in partes])


# Treinador entra como rótulo válido, não como exclusão: a maior parte de `NP/` é
# roupa de treinador, e a silhueta humana é constante o bastante para as poucas
# sprites já nomeadas `trainer` puxarem as outras.
TRAINER = {"trainer", "trainer_vip"}
NAO_ESPECIE = {"chansey_enfermeira", "anuncio-shinys", "anuncio-pvp", "tyranitar_mascara"}


def especie(nome):
    n = nome[6:] if nome.startswith("shiny_") else nome
    if n.endswith("_shiny"):
        n = n[:-6]
    for suf in ("_revisar", "_montaria"):
        n = n.replace(suf, "")
    while n and n[-1].isdigit():
        n = n[:-1]
    n = n.rstrip("_")
    if n == "farfetch":
        n = "farfetchd"
    if n in TRAINER:
        return "trainer"
    return None if (not n or n in NAO_ESPECIE) else n


# --- referência: tudo que já tem nome, inclusive as poucas já nomeadas dentro de NP/
refs = []
for e in indice.values():
    if not e.get("nomeado") or e.get("kind") == "vazio":
        continue
    esp = especie(e.get("name") or "")
    if not esp:
        continue
    v = None
    try:
        v = assinatura(e)
    except Exception:
        pass
    if v is not None:
        refs.append((esp, e["arquivo"], v))
print(f"referências nomeadas: {len(refs)}")

# --- alvos: a primeira sprite de cada bloco
primeiras = {}
for sid, (bloco, pos, tam) in por_id.items():
    if pos == 0:
        primeiras[bloco] = (int(sid), tam)
print(f"blocos: {len(primeiras)}")

alvos, valvos = [], []
for bloco, (sid, tam) in sorted(primeiras.items()):
    e = indice[str(sid)]
    if e.get("nomeado"):        # representante que já tem nome: nada a sugerir
        continue
    try:
        v = assinatura(e)
    except Exception:
        v = None
    if v is None:
        continue
    alvos.append({"bloco": bloco, "id": sid, "arquivo": e["arquivo"], "tam": tam})
    valvos.append(v)

A = np.array(valvos, dtype=np.float32)
R = np.array([r[2] for r in refs], dtype=np.float32)
aA, aR = A.sum(1), R.sum(1)
print(f"alvos {A.shape} · refs {R.shape}")

melhor_i = np.zeros(len(A), dtype=np.int32)
melhor_v = np.zeros(len(A), dtype=np.float32)
BL = 256
for i0 in range(0, len(A), BL):
    bloco = A[i0:i0 + BL]
    inter = bloco @ R.T
    uniao = aA[i0:i0 + BL, None] + aR[None, :] - inter
    iou = np.divide(inter, uniao, out=np.zeros_like(inter), where=uniao > 0)
    melhor_i[i0:i0 + BL] = iou.argmax(1)
    melhor_v[i0:i0 + BL] = iou.max(1)
    print(f"  {min(i0 + BL, len(A))}/{len(A)}", end="\r", file=sys.stderr)

saida = []
for k, alvo in enumerate(alvos):
    esp, arq_ref, _ = refs[melhor_i[k]]
    saida.append({**alvo, "sugestao": esp, "iou": round(float(melhor_v[k]), 4), "ref": arq_ref})

saida.sort(key=lambda s: -s["iou"])
destino = os.path.join(LAB, "sugestoes-np.json")
json.dump(saida, open(destino, "w"), ensure_ascii=False, indent=1)

for corte in (0.9, 0.85, 0.8, 0.75, 0.7, 0.6):
    print(f"\niou >= {corte}: {sum(1 for s in saida if s['iou'] >= corte)} blocos", end="")
print(f"\n\nescrito {destino}")
