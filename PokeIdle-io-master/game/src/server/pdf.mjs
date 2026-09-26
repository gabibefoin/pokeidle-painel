// Um escritor de PDF pequeno, sem dependência — o suficiente para relatório A4 com tabela.
//
// ### Por que não uma biblioteca
//
// `pdfkit`/`pdf-lib` resolveriam, e trariam o que este repositório evita de propósito (ver o
// cabeçalho de `pagamentos.mjs`): árvore de dependências para três primitivas. Pior, aqui há um
// motivo operacional — o `package-lock.json` gerado nesta máquina é recusado pelo servidor, então
// dependência nova é deploy quebrado. E Chrome headless (`printToPDF`) não existe na máquina de
// produção.
//
// O que um relatório precisa cabe em pouco: texto em fonte padrão, retângulo, linha, imagem PNG
// e a tabela de referências cruzadas no fim. É isto.
//
// ### As fontes
//
// As quatro "Standard 14" que todo leitor de PDF traz (Helvetica, Helvetica-Bold,
// Helvetica-Oblique e Courier), com `WinAnsiEncoding`. Sem embutir fonte nenhuma: o arquivo fica
// pequeno e a acentuação do português cabe inteira no WinAnsi (á, ç, ã, õ, º…). O que não cabe
// (emoji, seta) é trocado ou descartado por `textoImprimivel` — e quem monta o conteúdo passa
// tudo por ela ANTES, para a prévia em HTML mostrar exatamente os mesmos caracteres do PDF.
//
// As larguras são as métricas AFM oficiais das fontes, por código WinAnsi (32–255). É delas que
// sai a quebra de linha; errar aqui é texto vazando da célula.
//
// ### Coordenadas
//
// PDF tem origem no canto INFERIOR esquerdo. Toda a API daqui recebe `y` medido do TOPO da
// página, que é como se pensa um layout — a conversão acontece num lugar só (`yPdf`).
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

export const A4 = { largura: 595.28, altura: 841.89 };

// ------------------------------------------------------------------- texto

/** Unicode → código WinAnsi, para os 27 caracteres de 0x80–0x9F que não são Latin-1. */
const WINANSI_ESPECIAIS = new Map([
  ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84], ['…', 0x85], ['†', 0x86], ['‡', 0x87],
  ['ˆ', 0x88], ['‰', 0x89], ['Š', 0x8a], ['‹', 0x8b], ['Œ', 0x8c], ['Ž', 0x8e], ['‘', 0x91],
  ['’', 0x92], ['“', 0x93], ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97], ['˜', 0x98],
  ['™', 0x99], ['š', 0x9a], ['›', 0x9b], ['œ', 0x9c], ['ž', 0x9e], ['Ÿ', 0x9f],
]);
const WINANSI_REVERSO = new Map([...WINANSI_ESPECIAIS].map(([c, b]) => [b, c]));

/** Caracteres fora do WinAnsi que têm tradução honesta. O resto some (emoji) ou vira "?". */
const TROCAS = new Map([
  ['−', '-'], ['‐', '-'], ['‑', '-'], ['→', '->'], ['←', '<-'],
  ['≥', '>='], ['≤', '<='], ['✓', 'OK'], ['✔', 'OK'], ['✕', 'x'],
  [' ', ' '], [' ', ' '], [' ', ' '], ['\t', ' '], ['\r', ''],
]);

const ehInvisivel = (cp) =>
  (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0xfeff;
const ehEmoji = (cp) =>
  cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff);

/** Os bytes WinAnsi de um texto. Quebra de linha é preservada como `\n` (10). */
function bytesWinAnsi(texto) {
  const saida = [];
  for (const ch of String(texto ?? '').normalize('NFC')) {
    const cp = ch.codePointAt(0);
    if (ch === '\n') { saida.push(10); continue; }
    if ((cp >= 32 && cp <= 126) || (cp >= 160 && cp <= 255)) { saida.push(cp); continue; }
    if (WINANSI_ESPECIAIS.has(ch)) { saida.push(WINANSI_ESPECIAIS.get(ch)); continue; }
    if (TROCAS.has(ch)) { for (const t of TROCAS.get(ch)) saida.push(t.charCodeAt(0)); continue; }
    if (ehInvisivel(cp) || ehEmoji(cp)) continue;
    saida.push(63); // "?"
  }
  return saida;
}

/**
 * O texto como ele vai sair impresso: só caracteres que as fontes padrão desenham.
 *
 * Quem monta conteúdo para o PDF E para uma prévia HTML passa cada string por aqui primeiro —
 * senão a prévia mostraria um emoji que o PDF descarta, e as duas deixariam de ser o mesmo
 * documento.
 */
export function textoImprimivel(texto) {
  return bytesWinAnsi(texto)
    .map((b) => (b === 10 ? '\n' : WINANSI_REVERSO.get(b) ?? String.fromCharCode(b)))
    .join('')
    .replace(/ {2,}/g, ' ');
}

// Larguras AFM (unidades de 1/1000 do corpo), códigos 32–255.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 350,
  556, 350, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350,
  350, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 350, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 350,
  556, 350, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350,
  350, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 350, 500, 667,
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
  611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

/** As quatro fontes: recurso no PDF, nome PostScript e larguras. */
const FONTES = {
  normal: { recurso: 'F1', base: 'Helvetica', larguras: HELVETICA },
  negrito: { recurso: 'F2', base: 'Helvetica-Bold', larguras: HELVETICA_BOLD },
  italico: { recurso: 'F3', base: 'Helvetica-Oblique', larguras: HELVETICA },
  mono: { recurso: 'F4', base: 'Courier', larguras: null },
};

const fonteDe = (nome) => FONTES[nome] ?? FONTES.normal;

/** Largura de um texto em pontos. */
export function larguraTexto(texto, fonte = 'normal', tamanho = 10) {
  const f = fonteDe(fonte);
  let soma = 0;
  for (const b of bytesWinAnsi(texto)) {
    if (b === 10) continue;
    soma += f.larguras ? (f.larguras[b - 32] ?? 556) : 600;
  }
  return (soma * tamanho) / 1000;
}

/**
 * Quebra um texto em linhas que cabem em `largura`.
 *
 * Por palavra, e por CARACTERE quando uma palavra sozinha não cabe — é o caso do identificador
 * de transação (32 caracteres sem espaço) numa coluna estreita. Sem esse segundo passo, ele
 * vazaria para a célula vizinha.
 */
export function quebrarTexto(texto, fonte, tamanho, largura) {
  const linhas = [];
  const cabe = (t) => larguraTexto(t, fonte, tamanho) <= largura;
  for (const paragrafo of String(texto ?? '').split('\n')) {
    let atual = '';
    for (const palavra of paragrafo.split(' ')) {
      if (!palavra) continue;
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (cabe(tentativa)) { atual = tentativa; continue; }
      if (atual) linhas.push(atual);
      atual = '';
      if (cabe(palavra)) { atual = palavra; continue; }
      let pedaco = '';
      for (const ch of palavra) {
        if (pedaco && !cabe(pedaco + ch)) { linhas.push(pedaco); pedaco = ch; } else pedaco += ch;
      }
      atual = pedaco;
    }
    linhas.push(atual);
  }
  return linhas;
}

// ------------------------------------------------------------------- imagem

/**
 * Decodifica um PNG (8 bits por canal, sem entrelaçamento) em pixels crus.
 *
 * O PDF aceita o fluxo zlib do PNG quase como vem, mas não o canal ALFA misturado — ele precisa
 * sair como uma segunda imagem (`/SMask`). Separar os canais exige desfazer os filtros de linha,
 * e é isso que esta função faz. `inflateSync` é o zlib do próprio Node.
 */
export function decodificarPng(buf) {
  const ASSINATURA = '89504e470d0a1a0a';
  if (buf.subarray(0, 8).toString('hex') !== ASSINATURA) throw new Error('não é PNG');

  let pos = 8;
  let ihdr = null;
  let paleta = null;
  let transp = null;
  const idat = [];
  while (pos < buf.length) {
    const tam = buf.readUInt32BE(pos);
    const tipo = buf.toString('latin1', pos + 4, pos + 8);
    const dados = buf.subarray(pos + 8, pos + 8 + tam);
    if (tipo === 'IHDR') {
      ihdr = {
        largura: dados.readUInt32BE(0), altura: dados.readUInt32BE(4),
        bits: dados[8], tipoCor: dados[9], entrelacado: dados[12],
      };
    } else if (tipo === 'PLTE') paleta = dados;
    else if (tipo === 'tRNS') transp = dados;
    else if (tipo === 'IDAT') idat.push(dados);
    else if (tipo === 'IEND') break;
    pos += 12 + tam;
  }
  if (!ihdr) throw new Error('PNG sem IHDR');
  if (ihdr.bits !== 8 || ihdr.entrelacado) throw new Error('PNG não suportado (só 8 bits, sem entrelaçamento)');

  const canais = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.tipoCor];
  if (!canais) throw new Error('tipo de cor PNG desconhecido');

  const { largura: w, altura: h } = ihdr;
  const cru = inflateSync(Buffer.concat(idat));
  const passo = w * canais;
  const px = Buffer.alloc(h * passo);
  for (let y = 0; y < h; y++) {
    const filtro = cru[y * (passo + 1)];
    const ini = y * (passo + 1) + 1;
    const lin = y * passo;
    for (let x = 0; x < passo; x++) {
      const v = cru[ini + x];
      const a = x >= canais ? px[lin + x - canais] : 0;
      const b = y > 0 ? px[lin - passo + x] : 0;
      const c = x >= canais && y > 0 ? px[lin - passo + x - canais] : 0;
      let r;
      switch (filtro) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
          r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`filtro PNG inválido: ${filtro}`);
      }
      px[lin + x] = r & 0xff;
    }
  }

  const n = w * h;
  let cor;
  let canaisCor;
  let alfa = null;
  if (ihdr.tipoCor === 2 || ihdr.tipoCor === 6) {
    canaisCor = 3;
    cor = Buffer.alloc(n * 3);
    if (ihdr.tipoCor === 6) alfa = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      px.copy(cor, i * 3, i * canais, i * canais + 3);
      if (alfa) alfa[i] = px[i * 4 + 3];
    }
  } else if (ihdr.tipoCor === 0 || ihdr.tipoCor === 4) {
    canaisCor = 1;
    cor = Buffer.alloc(n);
    if (ihdr.tipoCor === 4) alfa = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      cor[i] = px[i * canais];
      if (alfa) alfa[i] = px[i * 2 + 1];
    }
  } else {
    if (!paleta) throw new Error('PNG indexado sem paleta');
    canaisCor = 3;
    cor = Buffer.alloc(n * 3);
    if (transp) alfa = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      const idx = px[i];
      paleta.copy(cor, i * 3, idx * 3, idx * 3 + 3);
      if (alfa) alfa[i] = idx < transp.length ? transp[idx] : 255;
    }
  }
  // Alfa todo opaco é peso morto no arquivo.
  if (alfa && alfa.every((v) => v === 255)) alfa = null;
  return { largura: w, altura: h, cor, canaisCor, alfa };
}

// ------------------------------------------------------------------- documento

const num = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** `#1b2230` → `0.106 0.133 0.188`. */
function rgb(hex) {
  const h = String(hex ?? '#000000').replace('#', '');
  const p = (i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3);
  return `${p(0)} ${p(2)} ${p(4)}`;
}

/** Texto de metadado (`/Title`…) em UTF-16BE, que é o que o leitor mostra com acento. */
function textoInfo(t) {
  const partes = ['FEFF'];
  for (const ch of String(t ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) continue;
    partes.push(cp.toString(16).padStart(4, '0'));
  }
  return `<${partes.join('')}>`;
}

/** `D:20260914153000-03'00'` no horário de Brasília (sem horário de verão desde 2019). */
function dataPdf(data) {
  const d = new Date(new Date(data).getTime() - 3 * 3600_000);
  const p = (n) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-03'00'`;
}

export class DocumentoPdf {
  /**
   * @param {{titulo?:string, autor?:string, assunto?:string, criador?:string, criadoEm?:Date}} info
   *   `criadoEm` entra no arquivo. Fixá-lo (em vez de `new Date()`) é o que torna o PDF
   *   DETERMINÍSTICO: o mesmo conteúdo gera os mesmos bytes, e o hash do arquivo se repete.
   */
  constructor(info = {}) {
    this.largura = A4.largura;
    this.altura = A4.altura;
    this.info = info;
    this.paginas = [];
    this.imagens = [];
    this.atual = -1;
  }

  get totalPaginas() { return this.paginas.length; }

  novaPagina() {
    this.paginas.push({ ops: [], imagens: new Set() });
    this.atual = this.paginas.length - 1;
    return this.atual;
  }

  /** Passa a desenhar na página `i` (zero-based) — o rodapé "Página X de Y" volta nas antigas. */
  irParaPagina(i) {
    if (i < 0 || i >= this.paginas.length) throw new Error(`página ${i} não existe`);
    this.atual = i;
  }

  #op(s) {
    if (this.atual < 0) this.novaPagina();
    this.paginas[this.atual].ops.push(s);
  }

  #y(yTopo) { return this.altura - yTopo; }

  /**
   * Escreve uma linha de texto. `y` é a LINHA DE BASE, medida do topo.
   *
   * `alinhar: 'dir'|'centro'` usa `largura` como caixa. `justificar` distribui a sobra pelos
   * espaços (operador `Tw`, que no WinAnsi age sobre o byte 32 — exatamente o espaço).
   */
  texto(x, y, texto, { fonte = 'normal', tamanho = 9, cor = '#000000', alinhar = 'esq', largura = 0, justificar = false } = {}) {
    const bytes = bytesWinAnsi(texto).filter((b) => b !== 10);
    if (!bytes.length) return;
    const f = fonteDe(fonte);
    const w = larguraTexto(texto, fonte, tamanho);
    let px = x;
    if (alinhar === 'dir' && largura) px = x + largura - w;
    else if (alinhar === 'centro' && largura) px = x + (largura - w) / 2;
    let tw = 0;
    if (justificar && largura) {
      const espacos = bytes.filter((b) => b === 32).length;
      if (espacos > 0 && largura > w) tw = (largura - w) / espacos;
    }
    const hex = Buffer.from(bytes).toString('hex');
    this.#op(`BT /${f.recurso} ${num(tamanho)} Tf ${rgb(cor)} rg ${num(tw)} Tw 1 0 0 1 ${num(px)} ${num(this.#y(y))} Tm <${hex}> Tj ET`);
  }

  retangulo(x, yTopo, w, h, { preenchimento = null, contorno = null, espessura = 0.5 } = {}) {
    if (!preenchimento && !contorno) return;
    const partes = ['q'];
    if (preenchimento) partes.push(`${rgb(preenchimento)} rg`);
    if (contorno) partes.push(`${rgb(contorno)} RG ${num(espessura)} w`);
    partes.push(`${num(x)} ${num(this.#y(yTopo + h))} ${num(w)} ${num(h)} re`);
    partes.push(preenchimento && contorno ? 'B' : preenchimento ? 'f' : 'S', 'Q');
    this.#op(partes.join(' '));
  }

  linha(x1, y1, x2, y2, { cor = '#000000', espessura = 0.5 } = {}) {
    this.#op(`q ${rgb(cor)} RG ${num(espessura)} w ${num(x1)} ${num(this.#y(y1))} m ${num(x2)} ${num(this.#y(y2))} l S Q`);
  }

  /** Registra um PNG e devolve o nome do recurso, ou `null` se não der para decodificar. */
  registrarPng(buffer) {
    let img;
    try {
      img = decodificarPng(buffer);
    } catch {
      return null;
    }
    const nome = `Im${this.imagens.length + 1}`;
    this.imagens.push({ nome, ...img });
    return nome;
  }

  imagem(nome, x, yTopo, w, h) {
    if (!nome) return;
    if (this.atual < 0) this.novaPagina();
    this.paginas[this.atual].imagens.add(nome);
    this.#op(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.#y(yTopo + h))} cm /${nome} Do Q`);
  }

  /** O arquivo inteiro. */
  gerar() {
    if (!this.paginas.length) this.novaPagina();
    const objetos = []; // índice + 1 = número do objeto
    const reservar = () => { objetos.push(null); return objetos.length; };
    const definir = (n, conteudo) => { objetos[n - 1] = conteudo; };
    const stream = (dict, dados) => Buffer.concat([
      Buffer.from(`${dict.replace(/\s*>>$/, '')} /Length ${dados.length} >>\nstream\n`, 'latin1'),
      dados,
      Buffer.from('\nendstream', 'latin1'),
    ]);

    const nCatalogo = reservar();
    const nPaginas = reservar();
    const nFontes = {};
    for (const [chave, f] of Object.entries(FONTES)) {
      nFontes[chave] = reservar();
      // WinAnsi também na Courier: sem ele o leitor usa a StandardEncoding, e "ã" sai "ª".
      definir(nFontes[chave], `<< /Type /Font /Subtype /Type1 /BaseFont /${f.base} /Encoding /WinAnsiEncoding >>`);
    }

    const nImagem = new Map();
    for (const img of this.imagens) {
      let smask = '';
      if (img.alfa) {
        const nAlfa = reservar();
        definir(nAlfa, stream(
          `<< /Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>`,
          deflateSync(img.alfa),
        ));
        smask = ` /SMask ${nAlfa} 0 R`;
      }
      const n = reservar();
      const espaco = img.canaisCor === 3 ? '/DeviceRGB' : '/DeviceGray';
      definir(n, stream(
        `<< /Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} /ColorSpace ${espaco} /BitsPerComponent 8 /Filter /FlateDecode${smask} >>`,
        deflateSync(img.cor),
      ));
      nImagem.set(img.nome, n);
    }

    const recursoFontes = Object.entries(FONTES)
      .map(([chave, f]) => `/${f.recurso} ${nFontes[chave]} 0 R`).join(' ');
    const kids = [];
    for (const pagina of this.paginas) {
      const nConteudo = reservar();
      definir(nConteudo, stream('<< /Filter /FlateDecode >>', deflateSync(Buffer.from(pagina.ops.join('\n'), 'latin1'))));
      const xobj = [...pagina.imagens].map((nome) => `/${nome} ${nImagem.get(nome)} 0 R`).join(' ');
      const nPagina = reservar();
      definir(nPagina,
        `<< /Type /Page /Parent ${nPaginas} 0 R /MediaBox [0 0 ${num(this.largura)} ${num(this.altura)}] ` +
        `/Resources << /Font << ${recursoFontes} >>${xobj ? ` /XObject << ${xobj} >>` : ''} >> /Contents ${nConteudo} 0 R >>`);
      kids.push(`${nPagina} 0 R`);
    }
    definir(nPaginas, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);
    definir(nCatalogo, `<< /Type /Catalog /Pages ${nPaginas} 0 R >>`);

    const i = this.info;
    const nInfo = reservar();
    const campos = [
      i.titulo && `/Title ${textoInfo(i.titulo)}`,
      i.autor && `/Author ${textoInfo(i.autor)}`,
      i.assunto && `/Subject ${textoInfo(i.assunto)}`,
      `/Creator ${textoInfo(i.criador ?? 'PokeIdle')}`,
      `/Producer ${textoInfo('PokeIdle — gerador interno de PDF')}`,
      i.criadoEm && `/CreationDate (${dataPdf(i.criadoEm)})`,
      i.criadoEm && `/ModDate (${dataPdf(i.criadoEm)})`,
    ].filter(Boolean);
    definir(nInfo, `<< ${campos.join(' ')} >>`);

    // Montagem com offsets. O cabeçalho binário na segunda linha avisa aos programas de
    // transferência que o arquivo não é texto.
    const partes = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let tamanho = partes[0].length;
    const offsets = [];
    objetos.forEach((conteudo, idx) => {
      offsets.push(tamanho);
      const corpo = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'latin1');
      const bloco = Buffer.concat([Buffer.from(`${idx + 1} 0 obj\n`, 'latin1'), corpo, Buffer.from('\nendobj\n', 'latin1')]);
      partes.push(bloco);
      tamanho += bloco.length;
    });
    const id = createHash('md5').update(Buffer.concat(partes)).digest('hex');
    const xref = [
      'xref', `0 ${objetos.length + 1}`, '0000000000 65535 f ',
      ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
      'trailer', `<< /Size ${objetos.length + 1} /Root ${nCatalogo} 0 R /Info ${nInfo} 0 R /ID [<${id}> <${id}>] >>`,
      'startxref', String(tamanho), '%%EOF', '',
    ].join('\n');
    partes.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(partes);
  }
}
