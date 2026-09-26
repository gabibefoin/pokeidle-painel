// O documento de MED desenhado em PDF A4 — a diagramação dos blocos de `med-documento.mjs`.
//
// ### O que este arquivo garante
//
//   · cabeçalho em toda página (completo na primeira, compacto nas demais) e rodapé com o texto
//     de origem, o código, o hash e "Página X de Y" — o Y só existe depois de diagramar tudo,
//     então o rodapé é escrito numa segunda passada sobre as páginas prontas;
//   · tabela nunca sai da margem: a largura das colunas é proporcional à área útil e o texto
//     quebra por palavra (e por caractere, nos identificadores);
//   · linha de tabela não é cortada ao meio na virada de página — ela vai inteira para a
//     seguinte, que repete o cabeçalho da tabela. Só uma linha maior que a página inteira é
//     dividida, e nesse caso o cabeçalho também se repete;
//   · título de seção não fica órfão no pé da página.
//
// O conteúdo NÃO é decidido aqui. Tudo o que aparece veio pronto dos blocos; este arquivo só
// escolhe onde desenhar.
import { readFileSync } from 'node:fs';
import { DocumentoPdf, quebrarTexto, larguraTexto } from './pdf.mjs';
import { RODAPE, TITULO } from './med-documento.mjs';

const COR = {
  texto: '#1b2230', suave: '#5b6472', acento: '#23395d', linha: '#d5dbe3', linhaForte: '#9fabbb',
  zebra: '#f6f8fb', foco: '#e3ecfa', fraco: '#8a919c', total: '#e8ecf2',
  atencao: { fundo: '#fff3e3', borda: '#d9822b', texto: '#6b3a00', linha: '#fde2df' },
  ok: { fundo: '#eaf6ec', borda: '#2e7d32', texto: '#1b4d20' },
  info: { fundo: '#edf2f9', borda: '#23395d', texto: '#1b2230' },
};

const MARGEM = { esq: 42, dir: 42 };
const TOPO_PAGINA = 72;        // onde o conteúdo começa depois do cabeçalho compacto
const LIMITE_INFERIOR = 52;    // distância do fim da página reservada ao rodapé

let logoCache;
function logo() {
  if (logoCache === undefined) {
    try {
      logoCache = readFileSync(new URL('../client/img/favicon-180.png', import.meta.url));
    } catch {
      logoCache = null;
    }
  }
  return logoCache;
}

/** @returns {Buffer} */
export function renderizarPdf(doc) {
  const pdf = new DocumentoPdf({
    titulo: `${TITULO} — ${doc.codigo}`,
    autor: doc.empresa.razaoSocial.startsWith('Não disponível') ? 'PokeIdle' : doc.empresa.razaoSocial,
    assunto: `Registros eletrônicos da conta ${doc.nick}`,
    criador: 'PokeIdle — painel administrativo (Documentos para MED)',
    criadoEm: doc.emitidoEm,
  });
  const nomeLogo = logo() ? pdf.registrarPng(logo()) : null;
  const W = pdf.largura - MARGEM.esq - MARGEM.dir;
  const X = MARGEM.esq;
  const limite = pdf.altura - LIMITE_INFERIOR;
  let y = 0;

  // ------------------------------------------------------------ cabeçalhos
  function cabecalhoCompleto() {
    const e = doc.empresa;
    if (nomeLogo) pdf.imagem(nomeLogo, X, 34, 54, 54);
    const tx = X + (nomeLogo ? 66 : 0);
    pdf.texto(tx, 46, 'PokeIdle', { fonte: 'negrito', tamanho: 13, cor: COR.acento });
    pdf.texto(tx + larguraTexto('PokeIdle', 'negrito', 13) + 6, 46, e.site, { tamanho: 8, cor: COR.suave });
    const colunas = [
      [['Razão social', e.razaoSocial], ['Nome fantasia', e.nomeFantasia], ['E-mail', e.email]],
      [['CNPJ', e.cnpj], ['Site', e.site], ['Endereço', e.endereco]],
    ];
    const larguraCol = (X + W - tx) / 2;
    let fundo = 88;
    colunas.forEach((campos, c) => {
      let by = 59;
      const cx = tx + c * larguraCol;
      for (const [rotulo, valor] of campos) {
        const r = `${rotulo}: `;
        const lr = larguraTexto(r, 'negrito', 6.9);
        pdf.texto(cx, by, r, { fonte: 'negrito', tamanho: 6.9, cor: COR.suave });
        const linhas = quebrarTexto(valor, 'normal', 6.9, larguraCol - lr - 8).slice(0, 2);
        linhas.forEach((l, i) => pdf.texto(cx + lr, by + i * 8.6, l, { tamanho: 6.9, cor: COR.texto }));
        by += 8.6 * linhas.length + 1.6;
      }
      fundo = Math.max(fundo, by);
    });
    const ry = fundo + 6;
    pdf.linha(X, ry, X + W, ry, { cor: COR.acento, espessura: 1.2 });

    pdf.texto(X, ry + 24, TITULO, { fonte: 'negrito', tamanho: 16, cor: COR.acento });
    pdf.texto(X, ry + 37, 'Compilação dos registros eletrônicos de cadastro, transações e créditos digitais da conta', { tamanho: 8.2, cor: COR.suave });

    const iy = ry + 46;
    const ih = 32;
    pdf.retangulo(X, iy, W, ih, { preenchimento: COR.zebra, contorno: COR.linha, espessura: 0.6 });
    const cw = W / doc.identificacao.length;
    doc.identificacao.forEach((item, i) => {
      const cx = X + i * cw;
      if (i) pdf.linha(cx, iy + 5, cx, iy + ih - 5, { cor: COR.linha, espessura: 0.6 });
      pdf.texto(cx + 8, iy + 11.5, item.rotulo.toUpperCase(), { fonte: 'negrito', tamanho: 6.2, cor: COR.suave });
      const v = quebrarTexto(item.valor, 'negrito', 8.6, cw - 14)[0] ?? '';
      pdf.texto(cx + 8, iy + 24, v, { fonte: 'negrito', tamanho: 8.6, cor: COR.texto });
    });
    y = iy + ih + 16;
  }

  function cabecalhoCompacto() {
    if (nomeLogo) pdf.imagem(nomeLogo, X, 26, 24, 24);
    const tx = X + (nomeLogo ? 32 : 0);
    pdf.texto(tx, 37, TITULO, { fonte: 'negrito', tamanho: 8.4, cor: COR.acento });
    const quem = [doc.empresa.razaoSocial.startsWith('Não disponível') ? 'PokeIdle' : doc.empresa.razaoSocial, `CNPJ ${doc.empresa.cnpj}`, doc.empresa.site].join(' · ');
    pdf.texto(tx, 47, quebrarTexto(quem, 'normal', 6.8, W * 0.6)[0] ?? '', { tamanho: 6.8, cor: COR.suave });
    pdf.texto(X, 37, doc.codigo, { fonte: 'negrito', tamanho: 8.4, cor: COR.acento, alinhar: 'dir', largura: W });
    pdf.texto(X, 47, `Emitido em ${doc.identificacao[1].valor}`, { tamanho: 6.8, cor: COR.suave, alinhar: 'dir', largura: W });
    pdf.linha(X, 56, X + W, 56, { cor: COR.acento, espessura: 0.8 });
    y = TOPO_PAGINA;
  }

  function novaPagina() {
    pdf.novaPagina();
    cabecalhoCompacto();
  }

  const cabe = (h) => y + h <= limite;
  const garantir = (h) => { if (!cabe(h)) novaPagina(); };

  // ------------------------------------------------------------ blocos
  function secao(b) {
    if (y > TOPO_PAGINA + 1) y += 8;
    garantir(26 + 46);
    pdf.retangulo(X, y, 17, 17, { preenchimento: COR.acento });
    pdf.texto(X, y + 12, String(b.numero), { fonte: 'negrito', tamanho: 8.6, cor: '#ffffff', alinhar: 'centro', largura: 17 });
    pdf.texto(X + 25, y + 12.4, b.titulo, { fonte: 'negrito', tamanho: 10.6, cor: COR.acento });
    pdf.linha(X, y + 21.5, X + W, y + 21.5, { cor: COR.linhaForte, espessura: 0.6 });
    y += 31;
  }

  function subtitulo(b) {
    y += 5;
    garantir(16 + 34);
    pdf.texto(X, y + 8, b.texto, { fonte: 'negrito', tamanho: 8.6, cor: COR.acento });
    y += 14;
  }

  function linhasCorridas(texto, { fonte, tamanho, entrelinha, cor, justificar }) {
    for (const pedaco of String(texto).split('\n')) {
      const linhas = quebrarTexto(pedaco, fonte, tamanho, W);
      linhas.forEach((l, i) => {
        garantir(entrelinha);
        pdf.texto(X, y + tamanho, l, { fonte, tamanho, cor, largura: W, justificar: justificar && i < linhas.length - 1 });
        y += entrelinha;
      });
    }
  }

  function paragrafo(b) {
    linhasCorridas(b.texto, { fonte: 'normal', tamanho: 8.6, entrelinha: 12, cor: COR.texto, justificar: true });
    y += 5;
  }

  function nota(b) {
    y += 1;
    linhasCorridas(b.texto, { fonte: 'italico', tamanho: 7.1, entrelinha: 9.4, cor: COR.suave, justificar: false });
    y += 5;
  }

  function campos(b) {
    const colunas = b.colunas === 2 ? 2 : 1;
    const vao = 14;
    const cw = (W - vao * (colunas - 1)) / colunas;
    const lw = colunas === 2 ? cw * 0.43 : W * 0.27;
    const vw = cw - lw - 6;
    const ent = 10;
    pdf.linha(X, y, X + W, y, { cor: COR.linha, espessura: 0.5 });
    for (let i = 0; i < b.itens.length; i += colunas) {
      const grupo = b.itens.slice(i, i + colunas).map((it) => ({
        rot: quebrarTexto(it.rotulo, 'negrito', 7.1, lw - 4),
        val: quebrarTexto(it.valor, it.mono ? 'mono' : 'normal', it.mono ? 6.8 : 8.2, vw),
        mono: it.mono,
      }));
      const h = Math.max(...grupo.map((g) => Math.max(g.rot.length, g.val.length))) * ent + 7;
      if (!cabe(h)) { novaPagina(); pdf.linha(X, y, X + W, y, { cor: COR.linha, espessura: 0.5 }); }
      grupo.forEach((g, c) => {
        const cx = X + c * (cw + vao);
        g.rot.forEach((l, k) => pdf.texto(cx, y + 10 + k * ent, l, { fonte: 'negrito', tamanho: 7.1, cor: COR.suave }));
        g.val.forEach((l, k) => pdf.texto(cx + lw, y + 10 + k * ent, l, { fonte: g.mono ? 'mono' : 'normal', tamanho: g.mono ? 6.8 : 8.2, cor: COR.texto }));
      });
      y += h;
      pdf.linha(X, y, X + W, y, { cor: COR.linha, espessura: 0.5 });
    }
    y += 7;
  }

  function tabela(b) {
    const soma = b.colunas.reduce((s, c) => s + c.largura, 0);
    const larguras = b.colunas.map((c) => (c.largura / soma) * W);
    const PAD_X = 3.4;
    const PAD_Y = 3.2;
    const ENT = 8.9;
    const TAM = 7.1;
    const TAM_MONO = 6.2;
    const fonteCol = (c, negrito) => (c.mono ? 'mono' : negrito ? 'negrito' : 'normal');
    const tamCol = (c) => (c.mono ? TAM_MONO : TAM);

    const cab = b.colunas.map((c, i) => quebrarTexto(c.titulo, 'negrito', 6.6, larguras[i] - 2 * PAD_X));
    const hCab = Math.max(...cab.map((l) => l.length)) * 8 + 2 * PAD_Y + 1;

    const desenharCabecalho = () => {
      pdf.retangulo(X, y, W, hCab, { preenchimento: COR.acento });
      let cx = X;
      cab.forEach((linhas, i) => {
        const c = b.colunas[i];
        linhas.forEach((l, k) => pdf.texto(cx + PAD_X, y + PAD_Y + 7 + k * 8, l, {
          fonte: 'negrito', tamanho: 6.6, cor: '#ffffff', alinhar: c.alinhar ?? 'esq', largura: larguras[i] - 2 * PAD_X,
        }));
        cx += larguras[i];
      });
      y += hCab;
    };

    const linhas = b.linhas.map((linha, r) => {
      const negrito = false;
      const celulas = linha.map((valor, i) => quebrarTexto(String(valor ?? ''), fonteCol(b.colunas[i], negrito), tamCol(b.colunas[i]), larguras[i] - 2 * PAD_X));
      return { celulas, destaque: b.destaques?.[r] ?? null, zebra: r % 2 === 1 };
    });
    if (b.total) {
      linhas.push({
        celulas: b.total.map((valor, i) => quebrarTexto(String(valor ?? ''), b.colunas[i].mono ? 'mono' : 'negrito', tamCol(b.colunas[i]), larguras[i] - 2 * PAD_X)),
        destaque: 'total', zebra: false, total: true,
      });
    }

    const altura = (l) => Math.max(1, ...l.celulas.map((c) => c.length)) * ENT + 2 * PAD_Y;
    const primeira = linhas.length ? Math.min(altura(linhas[0]), 60) : 20;
    garantir(hCab + primeira);
    desenharCabecalho();

    if (!linhas.length) {
      const l = quebrarTexto(b.vazio ?? 'Sem registros.', 'italico', TAM, W - 2 * PAD_X);
      const h = l.length * ENT + 2 * PAD_Y;
      l.forEach((t, k) => pdf.texto(X + PAD_X, y + PAD_Y + 6.6 + k * ENT, t, { fonte: 'italico', tamanho: TAM, cor: COR.suave }));
      y += h;
      pdf.linha(X, y, X + W, y, { cor: COR.linha, espessura: 0.5 });
      y += 9;
      return;
    }

    const util = limite - TOPO_PAGINA - hCab;
    for (const l of linhas) {
      let h = altura(l);
      if (!cabe(h) && h <= util) { novaPagina(); desenharCabecalho(); }
      // Linha maior que a área útil de uma página inteira: sai em pedaços, cada um com o
      // cabeçalho da tabela. Não acontece com os dados de hoje, mas não pode vazar se acontecer.
      let inicio = 0;
      const total = Math.max(...l.celulas.map((c) => c.length));
      while (inicio < total) {
        let cabem = Math.floor((limite - y - 2 * PAD_Y) / ENT);
        if (cabem < 1) { novaPagina(); desenharCabecalho(); cabem = Math.floor((limite - y - 2 * PAD_Y) / ENT); }
        const fatia = Math.min(cabem, total - inicio);
        h = fatia * ENT + 2 * PAD_Y;
        const d = l.destaque;
        const fundo = d === 'foco' ? COR.foco : d === 'atencao' ? COR.atencao.linha : d === 'total' ? COR.total : l.zebra ? COR.zebra : null;
        if (fundo) pdf.retangulo(X, y, W, h, { preenchimento: fundo });
        let cx = X;
        l.celulas.forEach((cel, i) => {
          const c = b.colunas[i];
          cel.slice(inicio, inicio + fatia).forEach((t, k) => pdf.texto(cx + PAD_X, y + PAD_Y + 6.6 + k * ENT, t, {
            fonte: c.mono ? 'mono' : l.total ? 'negrito' : 'normal',
            tamanho: tamCol(c),
            cor: d === 'fraco' ? COR.fraco : d === 'atencao' ? COR.atencao.texto : COR.texto,
            alinhar: c.alinhar ?? 'esq',
            largura: larguras[i] - 2 * PAD_X,
          }));
          cx += larguras[i];
        });
        y += h;
        pdf.linha(X, y, X + W, y, { cor: l.total ? COR.linhaForte : COR.linha, espessura: l.total ? 0.8 : 0.5 });
        inicio += fatia;
      }
    }
    y += 9;
  }

  function aviso(b) {
    const cor = COR[b.nivel] ?? COR.info;
    const largura = W - 20;
    const titulo = b.titulo ? quebrarTexto(b.titulo, 'negrito', 8.2, largura) : [];
    const corpo = quebrarTexto(b.texto, 'normal', 8, largura);
    const h = 9 + titulo.length * 11 + corpo.length * 10.6 + 6;
    garantir(h);
    pdf.retangulo(X, y, W, h, { preenchimento: cor.fundo });
    pdf.retangulo(X, y, 3.2, h, { preenchimento: cor.borda });
    let ty = y + 8;
    for (const l of titulo) { pdf.texto(X + 12, ty + 8, l, { fonte: 'negrito', tamanho: 8.2, cor: cor.texto }); ty += 11; }
    for (const l of corpo) { pdf.texto(X + 12, ty + 7.8, l, { tamanho: 8, cor: cor.texto }); ty += 10.6; }
    y += h + 8;
  }

  function hash(b) {
    const h = 30;
    garantir(h);
    pdf.retangulo(X, y, W, h, { preenchimento: COR.zebra, contorno: COR.linha, espessura: 0.6 });
    pdf.texto(X + 8, y + 11, b.rotulo.toUpperCase(), { fonte: 'negrito', tamanho: 6.4, cor: COR.suave });
    pdf.texto(X + 8, y + 23, b.valor, { fonte: 'mono', tamanho: 8.4, cor: COR.texto });
    y += h + 6;
  }

  const DESENHO = { secao, subtitulo, paragrafo, nota, campos, tabela, aviso, hash };

  pdf.novaPagina();
  cabecalhoCompleto();
  for (const b of doc.blocos) DESENHO[b.t]?.(b);

  // ------------------------------------------------------------ rodapés
  const total = pdf.totalPaginas;
  for (let i = 0; i < total; i++) {
    pdf.irParaPagina(i);
    const ry = pdf.altura - 42;
    pdf.linha(X, ry, X + W, ry, { cor: COR.linhaForte, espessura: 0.6 });
    pdf.texto(X, ry + 11, RODAPE, { tamanho: 6.9, cor: COR.suave });
    pdf.texto(X, ry + 11, `Página ${i + 1} de ${total}`, { fonte: 'negrito', tamanho: 7.2, cor: COR.acento, alinhar: 'dir', largura: W });
    pdf.texto(X, ry + 21, `${doc.codigo} · SHA-256 ${doc.hash}`, { fonte: 'mono', tamanho: 6, cor: COR.suave });
  }
  return pdf.gerar();
}
