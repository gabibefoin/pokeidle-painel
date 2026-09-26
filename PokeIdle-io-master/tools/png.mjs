// PNG mínimo: ler, recortar a margem transparente e gravar de volta.
//
// Existe porque vários sprites do pokésprite vêm num canvas maior que o desenho (a moeda
// de ouro é 14×14 dentro de 30×30). Renderizados num quadrado de 16 px com `object-fit`,
// sobrava metade do tamanho para o desenho e o ícone sumia na tela.
//
// Suporta o que os nossos assets usam: sem entrelaçamento, 8 bits em RGB/RGBA/cinza e
// paleta de 1/2/4/8 bits. Qualquer outra combinação estoura — melhor do que gravar lixo.
import zlib from 'node:zlib';

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CANAIS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Desfaz os filtros por linha e devolve os bytes crus da imagem. */
function desfiltrar(raw, altura, bytesPorLinha, bpp) {
  const px = Buffer.alloc(altura * bytesPorLinha);
  let off = 0;
  for (let y = 0; y < altura; y++) {
    const filtro = raw[off++];
    const linha = raw.subarray(off, off + bytesPorLinha);
    off += bytesPorLinha;
    const atual = px.subarray(y * bytesPorLinha, (y + 1) * bytesPorLinha);
    const acima = y > 0 ? px.subarray((y - 1) * bytesPorLinha, y * bytesPorLinha) : Buffer.alloc(bytesPorLinha);
    for (let i = 0; i < bytesPorLinha; i++) {
      const a = i >= bpp ? atual[i - bpp] : 0;
      const b = acima[i];
      const c = i >= bpp ? acima[i - bpp] : 0;
      const x = linha[i];
      let v;
      if (filtro === 0) v = x;
      else if (filtro === 1) v = x + a;
      else if (filtro === 2) v = x + b;
      else if (filtro === 3) v = x + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      atual[i] = v & 255;
    }
  }
  return px;
}

/** Lê um PNG e devolve `{ largura, altura, rgba }` — sempre 4 bytes por pixel. */
export function decodificar(buf) {
  if (!buf.subarray(0, 8).equals(ASSINATURA)) throw new Error('não é PNG');
  let p = 8;
  const idat = [];
  let ihdr = null;
  let plte = null;
  let trns = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const tipo = buf.toString('ascii', p + 4, p + 8);
    const dados = buf.subarray(p + 8, p + 8 + len);
    if (tipo === 'IHDR') {
      ihdr = {
        largura: dados.readUInt32BE(0),
        altura: dados.readUInt32BE(4),
        bits: dados[8],
        cor: dados[9],
        entrelacado: dados[12],
      };
    } else if (tipo === 'PLTE') plte = dados;
    else if (tipo === 'tRNS') trns = dados;
    else if (tipo === 'IDAT') idat.push(dados);
    else if (tipo === 'IEND') break;
    p += 12 + len;
  }
  if (!ihdr) throw new Error('PNG sem IHDR');
  if (ihdr.entrelacado) throw new Error('PNG entrelaçado não suportado');

  const canais = CANAIS[ihdr.cor];
  if (!canais) throw new Error(`colorType ${ihdr.cor} não suportado`);
  if (ihdr.cor !== 3 && ihdr.bits !== 8) throw new Error(`bitDepth ${ihdr.bits} não suportado fora da paleta`);

  const { largura: w, altura: h, bits } = ihdr;
  const bytesPorLinha = Math.ceil((w * canais * bits) / 8);
  const bpp = Math.max(1, Math.ceil((canais * bits) / 8));
  const px = desfiltrar(zlib.inflateSync(Buffer.concat(idat)), h, bytesPorLinha, bpp);

  const rgba = Buffer.alloc(w * h * 4);
  const porLinha = (y, x) => {
    if (ihdr.cor === 3) {
      // paleta: o índice pode ocupar menos de um byte
      const porByte = 8 / bits;
      const byte = px[y * bytesPorLinha + Math.floor(x / porByte)];
      const desloc = (porByte - 1 - (x % porByte)) * bits;
      const i = (byte >> desloc) & ((1 << bits) - 1);
      return [plte[i * 3], plte[i * 3 + 1], plte[i * 3 + 2], trns && i < trns.length ? trns[i] : 255];
    }
    const o = y * bytesPorLinha + x * canais;
    if (canais >= 3) return [px[o], px[o + 1], px[o + 2], canais === 4 ? px[o + 3] : 255];
    return [px[o], px[o], px[o], canais === 2 ? px[o + 1] : 255];
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = porLinha(y, x);
      const o = (y * w + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = a;
    }
  }
  return { largura: w, altura: h, rgba };
}

function bloco(tipo, dados) {
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(dados.length, 0);
  cab.write(tipo, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cab.subarray(4), dados])) >>> 0, 0);
  return Buffer.concat([cab, dados, crc]);
}

const TABELA_CRC = (() => {
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
  for (const b of buf) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** Grava RGBA de 8 bits, uma linha por vez com filtro 0. */
export function codificar(largura, altura, rgba) {
  const cru = Buffer.alloc(altura * (largura * 4 + 1));
  for (let y = 0; y < altura; y++) {
    cru[y * (largura * 4 + 1)] = 0;
    rgba.copy(cru, y * (largura * 4 + 1) + 1, y * largura * 4, (y + 1) * largura * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    ASSINATURA,
    bloco('IHDR', ihdr),
    bloco('IDAT', zlib.deflateSync(cru, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Tira a moldura totalmente transparente em volta do desenho.
 *
 * Devolve `null` quando não há o que cortar — assim quem chama sabe que o arquivo não
 * precisa ser reescrito.
 */
export function recortarTransparente(buf, limiteAlpha = 8) {
  const { largura: w, altura: h, rgba } = decodificar(buf);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] <= limiteAlpha) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null; // imagem inteiramente transparente: não mexe
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return null;

  const nw = x1 - x0 + 1;
  const nh = y1 - y0 + 1;
  const saida = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    rgba.copy(saida, y * nw * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4);
  }
  return { buf: codificar(nw, nh, saida), largura: nw, altura: nh, antes: `${w}×${h}` };
}
