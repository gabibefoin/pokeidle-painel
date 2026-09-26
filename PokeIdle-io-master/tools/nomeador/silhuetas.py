"""Agrupa as sprites de `NP/` por silhueta parecida.

    python tools/nomeador/silhuetas.py            # roda e escreve LAB/silhuetas.json
    python tools/nomeador/silhuetas.py --limiar .7

A silhueta é a máscara alpha, não a cor: sprite igual com chapéu, sela ou acessório
novo cai no mesmo grupo que a versão limpa.

**Escala nativa, de propósito.** A primeira versão recortava e reescalava cada direção
para 32×32; deu errado — normalizar assim apaga o tamanho e o contorno fino, quase toda
silhueta cheia passa de 80% e a ligação simples encadeou 710 sprites (Blastoise, um
carro e uma bola no mesmo "grupo"). Aqui a máscara é colada no centro de um quadro fixo
sem reescalar, então tamanho volta a ser sinal e só encolhe o que não cabe.

Compara sul e leste: uma vista de frente e uma de perfil separam bicho redondo de bicho
comprido, que a vista de frente sozinha confunde.

A semelhança é IoU (interseção sobre união). Acessório pequeno custa pouco — um chapéu
tira uns 5 pontos. Bicho diferente fica bem abaixo do corte.

O agrupamento é ligação simples (union-find) e depois **cortado**: dentro de cada
corrente as sprites são postas em caminho guloso do vizinho mais parecido, e a corrente
é partida onde a semelhança entre vizinhos cai abaixo do limiar. Sem esse corte a
ligação simples encadeia de par em par (dá para ir de um Gengar até uma Blissey). Com
ele, todo par vizinho dentro de um bloco passa do corte — que é a promessa da tela.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image

from caminhos import sprites_raiz

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.environ.get("SPRITES_RAIZ", str(sprites_raiz()))
LAB = os.path.join(RAIZ, "LAB")
QUADRO = 128       # lado do quadro fixo, em pixels nativos
REDUZ = 2          # 128 → 64 por direção, só para caber na memória
LADO = QUADRO // REDUZ
DIRS = 4
COLUNAS = (2, 1)   # sul e leste (coluna = direção − 1)

ap = argparse.ArgumentParser()
ap.add_argument("--limiar", type=float, default=0.80, help="IoU mínimo para agrupar (0–1)")
ap.add_argument("--kind", default="all",
                help="kind das sprites a agrupar, ou 'all' para o acervo inteiro")
args = ap.parse_args()

indice = json.load(open(os.path.join(LAB, "lab-index.json"), encoding="utf-8"))
todas = list(indice["outfits"].values())
alvos = todas if args.kind == "all" else [e for e in todas if e.get("kind") == args.kind]
print(f"{len(alvos)} sprites" + ("" if args.kind == "all" else f" com kind={args.kind}"))


def assinatura(e):
    """Uma máscara por direção de COLUNAS, em escala nativa, centrada num quadro fixo."""
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
        if m.width > QUADRO or m.height > QUADRO:      # só o que não cabe encolhe
            z = min(QUADRO / m.width, QUADRO / m.height)
            m = m.resize((max(1, round(m.width * z)), max(1, round(m.height * z))), Image.BILINEAR)
        quadro = Image.new("L", (QUADRO, QUADRO), 0)
        quadro.paste(m, ((QUADRO - m.width) // 2, (QUADRO - m.height) // 2))
        if REDUZ > 1:
            quadro = quadro.resize((LADO, LADO), Image.BILINEAR)
        partes.append(np.asarray(quadro, dtype=np.uint8) > 96)
    return np.concatenate([p.ravel() for p in partes])


ids, vetores, pulados = [], [], []
for e in alvos:
    try:
        v = assinatura(e)
    except Exception as ex:
        v, ex_msg = None, str(ex)
        pulados.append((e["arquivo"], ex_msg))
    if v is None:
        if not pulados or pulados[-1][0] != e["arquivo"]:
            pulados.append((e["arquivo"], "sem grade utilizável"))
        continue
    ids.append(e["id"])
    vetores.append(v)

print(f"assinaturas: {len(vetores)} · puladas: {len(pulados)}")
M = np.array(vetores, dtype=np.float32)          # (n, DIRS*LADO*LADO)
n, dim = M.shape
area = M.sum(axis=1)
print(f"matriz {n}×{dim} ({M.nbytes / 1e6:.0f} MB) · área média {area.mean():.0f} px")

# União-por-tamanho com caminho comprimido; blocos para não alocar n² de uma vez.
pai = np.arange(n)


def achar(x):
    while pai[x] != x:
        pai[x] = pai[pai[x]]
        x = pai[x]
    return x


def unir(a, b):
    ra, rb = achar(a), achar(b)
    if ra != rb:
        pai[max(ra, rb)] = min(ra, rb)


BLOCO = 512
pares = 0
for i0 in range(0, n, BLOCO):
    bloco = M[i0:i0 + BLOCO]
    inter = bloco @ M.T                                   # (b, n)
    uniao = area[i0:i0 + BLOCO, None] + area[None, :] - inter
    iou = np.divide(inter, uniao, out=np.zeros_like(inter), where=uniao > 0)
    li, lj = np.nonzero(iou >= args.limiar)
    for a, b in zip(li + i0, lj):
        if a < b:
            unir(int(a), int(b))
            pares += 1
    print(f"  {min(i0 + BLOCO, n)}/{n}", end="\r", file=sys.stderr)

correntes = {}
for k in range(n):
    correntes.setdefault(achar(k), []).append(k)


def iou_bloco(linhas):
    sub = M[linhas]
    inter = sub @ sub.T
    uniao = area[linhas][:, None] + area[linhas][None, :] - inter
    return np.divide(inter, uniao, out=np.zeros_like(inter), where=uniao > 0)


def seriar(linhas):
    """Caminho guloso do vizinho mais parecido, já cortado em blocos.

    A ligação simples encadeia: com corte em 0.8 dá para caminhar de um Gengar até uma
    Blissey passando por parecidos de dois em dois. O caminho guloso deixa o vizinho na
    tela sendo sempre o mais parecido; cortar onde a semelhança entre vizinhos cai abaixo
    do limiar transforma a corrente em blocos onde **todo par vizinho passa do corte**.
    """
    if len(linhas) < 2:
        return [list(linhas)]
    S = iou_bloco(linhas)
    np.fill_diagonal(S, -1)
    restam = set(range(len(linhas)))
    atual = int(np.argmax(area[linhas]))          # começa pela silhueta mais cheia
    ordem, restam = [atual], restam - {atual}
    while restam:
        cand = list(restam)
        prox = cand[int(np.argmax(S[atual, cand]))]
        ordem.append(prox)
        restam.discard(prox)
        atual = prox

    blocos, atual_bloco = [], [ordem[0]]
    for a, b in zip(ordem, ordem[1:]):
        if S[a, b] >= args.limiar:
            atual_bloco.append(b)
        else:
            blocos.append(atual_bloco)
            atual_bloco = [b]
    blocos.append(atual_bloco)
    return [[linhas[i] for i in bl] for bl in blocos]

blocos = []
for corrente in correntes.values():
    blocos.extend(seriar(corrente))

tamanhos = sorted((len(b) for b in blocos), reverse=True)
sozinhas = sum(1 for t in tamanhos if t == 1)
print(f"\npares acima do corte: {pares} · correntes: {len(correntes)}")
print(f"blocos: {len(blocos)} · com 2+ membros: {len(blocos) - sozinhas} · sozinhas: {sozinhas}")
print(f"maiores: {tamanhos[:12]}")

# Bloco maior primeiro, para as famílias grandes aparecerem no topo da aba.
blocos.sort(key=lambda b: (-len(b), b[0]))
por_id = {}
for gi, linhas in enumerate(blocos):
    for pos, li in enumerate(linhas):
        por_id[str(ids[li])] = [gi, pos, len(linhas)]

saida = {
    "format": "nomeador-silhuetas-v1",
    "gerado": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
    "kind": args.kind,
    "limiar": args.limiar,
    "lado": LADO,
    "grupos": len(blocos),
    "porId": por_id,          # id -> [grupo, posição no grupo, tamanho do grupo]
    "pulados": pulados,
}
destino = os.path.join(LAB, "silhuetas.json")
json.dump(saida, open(destino, "w"), separators=(",", ":"))
print(f"escrito {destino}")
