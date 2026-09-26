// A PRÉVIA do documento de MED, em HTML — os mesmos blocos que `med-pdf.mjs` desenha.
//
// Vai para o painel dentro de um `<iframe sandbox srcdoc>`: sem script nenhum aqui, e o sandbox
// sem `allow-scripts` garante que nem um nick ou nome de produto malicioso que escapasse do
// escape abaixo conseguiria executar. Todo texto passa por `esc` antes de virar HTML.
//
// O conteúdo é o do PDF, palavra por palavra. O que só existe no PDF é a paginação ("Página X
// de Y" e o cabeçalho repetido), que é propriedade do papel e não do documento.
import { readFileSync } from 'node:fs';
import { RODAPE, TITULO } from './med-documento.mjs';

const esc = (t) => String(t ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);

let logoUri;
function logo() {
  if (logoUri === undefined) {
    try {
      logoUri = `data:image/png;base64,${readFileSync(new URL('../client/img/favicon-180.png', import.meta.url)).toString('base64')}`;
    } catch {
      logoUri = null;
    }
  }
  return logoUri;
}

const ESTILO = `
  *{box-sizing:border-box}
  body{margin:0;background:#dfe3e9;font:12.5px/1.45 Helvetica,Arial,sans-serif;color:#1b2230}
  .folha{max-width:840px;margin:14px auto;background:#fff;padding:34px 40px 26px;box-shadow:0 2px 10px #0002}
  .emp{display:flex;gap:14px;align-items:flex-start;border-bottom:2px solid #23395d;padding-bottom:10px}
  .emp img{width:58px;height:58px;image-rendering:pixelated}
  .emp .marca{font-weight:700;font-size:17px;color:#23395d}
  .emp .marca small{font-weight:400;font-size:11px;color:#5b6472;margin-left:6px}
  .emp dl{display:grid;grid-template-columns:1fr 1fr;gap:1px 18px;margin:4px 0 0;font-size:10.5px}
  .emp dl div{display:flex;gap:4px}.emp dt{font-weight:700;color:#5b6472}.emp dd{margin:0}
  h1{font-size:21px;color:#23395d;margin:16px 0 2px}
  .sub{color:#5b6472;font-size:11.5px;margin:0 0 10px}
  .ident{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #d5dbe3;background:#f6f8fb;margin-bottom:12px}
  .ident div{padding:6px 10px;border-left:1px solid #d5dbe3}.ident div:first-child{border-left:0}
  .ident span{display:block;font-size:9px;font-weight:700;text-transform:uppercase;color:#5b6472}
  .ident b{font-size:12px}
  h2{display:flex;align-items:center;gap:8px;font-size:14px;color:#23395d;margin:22px 0 8px;padding-bottom:5px;border-bottom:1px solid #9fabbb}
  h2 i{font-style:normal;background:#23395d;color:#fff;font-size:11.5px;min-width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center}
  h3{font-size:12px;color:#23395d;margin:12px 0 5px}
  p{margin:0 0 7px;text-align:justify;white-space:pre-line}
  .nota{font-style:italic;color:#5b6472;font-size:10.5px;text-align:left}
  table{width:100%;border-collapse:collapse;margin:2px 0 10px;table-layout:fixed;font-size:10.5px}
  th{background:#23395d;color:#fff;text-align:left;padding:4px 5px;font-size:9.5px}
  td{padding:4px 5px;border-bottom:1px solid #d5dbe3;vertical-align:top;white-space:pre-line;overflow-wrap:anywhere}
  tr.z td{background:#f6f8fb}tr.foco td{background:#e3ecfa}tr.atencao td{background:#fde2df;color:#6b3a00}
  tr.fraco td{color:#8a919c}tr.total td{background:#e8ecf2;font-weight:700;border-bottom:1px solid #9fabbb}
  td.vazio{font-style:italic;color:#5b6472}
  .dir{text-align:right}.centro{text-align:center}
  .mono{font-family:"Courier New",Courier,monospace;font-size:10px}
  .campos{display:grid;border-top:1px solid #d5dbe3;margin-bottom:10px}
  .campos.c2{grid-template-columns:1fr 1fr;column-gap:16px}
  .campos div{display:grid;grid-template-columns:43% 1fr;gap:6px;padding:4px 0;border-bottom:1px solid #d5dbe3}
  .campos.c1 div{grid-template-columns:27% 1fr}
  .campos dt{font-weight:700;color:#5b6472;font-size:10.5px}.campos dd{margin:0;overflow-wrap:anywhere}
  .aviso{padding:8px 12px;border-left:4px solid;margin:4px 0 10px}
  .aviso b{display:block;margin-bottom:2px}
  .aviso.atencao{background:#fff3e3;border-color:#d9822b;color:#6b3a00}
  .aviso.ok{background:#eaf6ec;border-color:#2e7d32;color:#1b4d20}
  .aviso.info{background:#edf2f9;border-color:#23395d}
  .hash{border:1px solid #d5dbe3;background:#f6f8fb;padding:6px 10px;margin:4px 0 8px}
  .hash span{display:block;font-size:9px;font-weight:700;text-transform:uppercase;color:#5b6472}
  .hash code{font-family:"Courier New",Courier,monospace;font-size:12px;overflow-wrap:anywhere}
  footer{margin-top:18px;padding-top:6px;border-top:1px solid #9fabbb;color:#5b6472;font-size:10px}
  footer code{font-family:"Courier New",Courier,monospace;overflow-wrap:anywhere}
`;

const alinhamento = (c) => (c.alinhar === 'dir' ? 'dir' : c.alinhar === 'centro' ? 'centro' : '');

function tabela(b) {
  const soma = b.colunas.reduce((s, c) => s + c.largura, 0);
  const cols = b.colunas.map((c) => `<col style="width:${((c.largura / soma) * 100).toFixed(2)}%">`).join('');
  const cab = b.colunas.map((c) => `<th class="${alinhamento(c)}">${esc(c.titulo)}</th>`).join('');
  const celula = (c, v) => `<td class="${[alinhamento(c), c.mono ? 'mono' : ''].join(' ').trim()}">${esc(v)}</td>`;
  let corpo = b.linhas.map((l, r) => {
    const classe = b.destaques?.[r] ?? (r % 2 ? 'z' : '');
    return `<tr class="${classe}">${l.map((v, i) => celula(b.colunas[i], v)).join('')}</tr>`;
  }).join('');
  if (!b.linhas.length) corpo = `<tr><td class="vazio" colspan="${b.colunas.length}">${esc(b.vazio ?? 'Sem registros.')}</td></tr>`;
  if (b.total) corpo += `<tr class="total">${b.total.map((v, i) => celula(b.colunas[i], v)).join('')}</tr>`;
  return `<table><colgroup>${cols}</colgroup><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table>`;
}

const BLOCO = {
  secao: (b) => `<h2><i>${esc(b.numero)}</i>${esc(b.titulo)}</h2>`,
  subtitulo: (b) => `<h3>${esc(b.texto)}</h3>`,
  paragrafo: (b) => `<p>${esc(b.texto)}</p>`,
  nota: (b) => `<p class="nota">${esc(b.texto)}</p>`,
  campos: (b) => `<dl class="campos ${b.colunas === 2 ? 'c2' : 'c1'}">${b.itens.map((it) =>
    `<div><dt>${esc(it.rotulo)}</dt><dd class="${it.mono ? 'mono' : ''}">${esc(it.valor)}</dd></div>`).join('')}</dl>`,
  tabela,
  aviso: (b) => `<div class="aviso ${esc(b.nivel)}">${b.titulo ? `<b>${esc(b.titulo)}</b>` : ''}${esc(b.texto)}</div>`,
  hash: (b) => `<div class="hash"><span>${esc(b.rotulo)}</span><code>${esc(b.valor)}</code></div>`,
};

/** O HTML completo, para `srcdoc`. */
export function renderizarHtml(doc) {
  const e = doc.empresa;
  const campoEmp = (r, v) => `<div><dt>${esc(r)}:</dt><dd>${esc(v)}</dd></div>`;
  const img = logo();
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(TITULO)} — ${esc(doc.codigo)}</title><style>${ESTILO}</style></head><body><div class="folha">
<header class="emp">${img ? `<img src="${img}" alt="">` : ''}<div>
  <div class="marca">PokeIdle<small>${esc(e.site)}</small></div>
  <dl>${campoEmp('Razão social', e.razaoSocial)}${campoEmp('CNPJ', e.cnpj)}${campoEmp('Nome fantasia', e.nomeFantasia)}${campoEmp('Site', e.site)}${campoEmp('E-mail', e.email)}${campoEmp('Endereço', e.endereco)}</dl>
</div></header>
<h1>${esc(TITULO)}</h1>
<p class="sub">Compilação dos registros eletrônicos de cadastro, transações e créditos digitais da conta</p>
<div class="ident">${doc.identificacao.map((i) => `<div><span>${esc(i.rotulo)}</span><b>${esc(i.valor)}</b></div>`).join('')}</div>
${doc.blocos.map((b) => BLOCO[b.t]?.(b) ?? '').join('\n')}
<footer>${esc(RODAPE)}<br><code>${esc(doc.codigo)} · SHA-256 ${esc(doc.hash)}</code></footer>
</div></body></html>`;
}
