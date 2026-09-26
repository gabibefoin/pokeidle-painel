// PNG cru: ler e escrever RGBA sem dependência nenhuma.
//
// Existe porque a geração da arte das Caixas de Fundador (ver `tools/gerar-caixas-beta.mjs`)
// precisa recortar um quadro da folha de outfit e compor um baú por cima — e o projeto não
// tem (nem quer) uma biblioteca de imagem no `package.json` do servidor. O que se usa aqui é
// só o `zlib` do Node, que é o mesmo compressor que o PNG especifica.
//
// Suporta o que os nossos arquivos são: 8 bits por canal, sem entrelaçamento, cor 6 (RGBA) ou
// 2 (RGB). Qualquer outra combinação estoura em vez de devolver pixel errado calado.
import { inflateSync, deflateSync } from 'node:zlib';

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Tabela do CRC-32 do PNG, montada uma vez. */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Desfaz os cinco filtros por linha que o PNG aplica antes de comprimir. */
function desfiltrar(dados, larg, alt, canais) {
  const passo = larg * canais;
  const saida = Buffer.alloc(passo * alt);
  let off = 0;
  for (let y = 0; y < alt; y++) {
    const filtro = dados[off++];
    const linha = dados.subarray(off, off + passo);
    off += passo;
    const destino = saida.subarray(y * passo, (y + 1) * passo);
    const anterior = y > 0 ? saida.subarray((y - 1) * passo, y * passo) : null;
    for (let i = 0; i < passo; i++) {
      const a = i >= canais ? destino[i - canais] : 0;
      const b = anterior ? anterior[i] : 0;
      const c = anterior && i >= canais ? anterior[i - canais] : 0;
      let v = linha[i];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filtro !== 0) throw new Error(`filtro PNG desconhecido: ${filtro}`);
      destino[i] = v & 0xff;
    }
  }
  return saida;
}

/** @returns {{larg:number, alt:number, px:Buffer}} `px` é RGBA, 4 bytes por pixel. */
export function lerPng(buf) {
  if (!buf.subarray(0, 8).equals(ASSINATURA)) throw new Error('não é PNG');
  let off = 8;
  let larg = 0;
  let alt = 0;
  let canais = 4;
  const pedacos = [];
  while (off < buf.length) {
    const tam = buf.readUInt32BE(off);
    const tipo = buf.toString('ascii', off + 4, off + 8);
    const corpo = buf.subarray(off + 8, off + 8 + tam);
    if (tipo === 'IHDR') {
      larg = corpo.readUInt32BE(0);
      alt = corpo.readUInt32BE(4);
      const profundidade = corpo[8];
      const tipoCor = corpo[9];
      const entrelace = corpo[12];
      if (profundidade !== 8) throw new Error('só 8 bits por canal');
      if (entrelace !== 0) throw new Error('PNG entrelaçado não suportado');
      if (tipoCor === 6) canais = 4;
      else if (tipoCor === 2) canais = 3;
      else throw new Error(`tipo de cor ${tipoCor} não suportado`);
    } else if (tipo === 'IDAT') pedacos.push(corpo);
    else if (tipo === 'IEND') break;
    off += 12 + tam;
  }
  const cru = desfiltrar(inflateSync(Buffer.concat(pedacos)), larg, alt, canais);
  if (canais === 4) return { larg, alt, px: cru };

  const px = Buffer.alloc(larg * alt * 4);
  for (let i = 0, j = 0; i < larg * alt; i++, j += 3) {
    px[i * 4] = cru[j];
    px[i * 4 + 1] = cru[j + 1];
    px[i * 4 + 2] = cru[j + 2];
    px[i * 4 + 3] = 255;
  }
  return { larg, alt, px };
}

function pedaco(tipo, corpo) {
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(corpo.length, 0);
  cab.write(tipo, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cab.subarray(4), corpo])), 0);
  return Buffer.concat([cab, corpo, crc]);
}

/** Escreve RGBA como PNG. Filtro 0 em toda linha — pixel art comprime bem assim. */
export function escreverPng({ larg, alt, px }) {
  const cru = Buffer.alloc((larg * 4 + 1) * alt);
  for (let y = 0; y < alt; y++) {
    cru[y * (larg * 4 + 1)] = 0;
    px.copy(cru, y * (larg * 4 + 1) + 1, y * larg * 4, (y + 1) * larg * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(larg, 0);
  ihdr.writeUInt32BE(alt, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    ASSINATURA,
    pedaco('IHDR', ihdr),
    pedaco('IDAT', deflateSync(cru, { level: 9 })),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

/** Tela RGBA em branco, com as operações que a composição da caixa precisa. */
export class Tela {
  constructor(larg, alt) {
    this.larg = larg;
    this.alt = alt;
    this.px = Buffer.alloc(larg * alt * 4);
  }

  /** Alpha-blend de um pixel solto (`[r,g,b,a]`, a de 0 a 255). */
  ponto(x, y, [r, g, b, a = 255]) {
    if (x < 0 || y < 0 || x >= this.larg || y >= this.alt || a <= 0) return;
    const i = (y * this.larg + x) * 4;
    if (a >= 255) {
      this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b; this.px[i + 3] = 255;
      return;
    }
    const af = a / 255;
    const ad = this.px[i + 3] / 255;
    const ao = af + ad * (1 - af);
    if (ao <= 0) return;
    this.px[i] = Math.round((r * af + this.px[i] * ad * (1 - af)) / ao);
    this.px[i + 1] = Math.round((g * af + this.px[i + 1] * ad * (1 - af)) / ao);
    this.px[i + 2] = Math.round((b * af + this.px[i + 2] * ad * (1 - af)) / ao);
    this.px[i + 3] = Math.round(ao * 255);
  }

  retangulo(x, y, w, h, cor) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.ponto(x + i, y + j, cor);
  }

  /** Recorta `(sx,sy,sw,sh)` da origem e cola em `(dx,dy)`, ampliado por `escala`. */
  colar(origem, { sx = 0, sy = 0, sw, sh, dx = 0, dy = 0, escala = 1, recorte = null } = {}) {
    const w = sw ?? origem.larg;
    const h = sh ?? origem.alt;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const s = ((sy + j) * origem.larg + (sx + i)) * 4;
        const a = origem.px[s + 3];
        if (!a) continue;
        const cor = [origem.px[s], origem.px[s + 1], origem.px[s + 2], a];
        for (let ej = 0; ej < escala; ej++) {
          for (let ei = 0; ei < escala; ei++) {
            const x = dx + i * escala + ei;
            const y = dy + j * escala + ej;
            if (recorte && !recorte(x, y)) continue;
            this.ponto(x, y, cor);
          }
        }
      }
    }
  }

  /** Retângulo visível (sem alpha) de um recorte — o mesmo `boundsVisivel` do cliente. */
  static limites(img, sx, sy, sw, sh) {
    let minX = sw, minY = sh, maxX = -1, maxY = -1;
    for (let j = 0; j < sh; j++) {
      for (let i = 0; i < sw; i++) {
        if (img.px[((sy + j) * img.larg + (sx + i)) * 4 + 3] > 8) {
          if (i < minX) minX = i;
          if (j < minY) minY = j;
          if (i > maxX) maxX = i;
          if (j > maxY) maxY = j;
        }
      }
    }
    return maxX < minX
      ? { x: sx, y: sy, w: sw, h: sh }
      : { x: sx + minX, y: sy + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  paraPng() {
    return escreverPng(this);
  }
}
