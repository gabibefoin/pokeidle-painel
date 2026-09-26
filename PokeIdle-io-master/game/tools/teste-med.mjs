// Documentos para MED — as regras do documento, o PDF e o portão das rotas.
//
//   node tools/teste-med.mjs                                  (só regras e PDF, sem banco)
//   node tools/teste-med.mjs --nick Tavictor --saida <pasta>  (+ conta real do banco, só leitura)
//   node tools/teste-med.mjs --http --nick Tavictor           (+ rotas /admin/med/* de verdade)
//
// Três perguntas, em ordem de custo:
//
//   1. O documento diz só o que os registros sustentam? Reconciliação, compra identificada,
//      divergência, encadeamento, dado ausente, escape de HTML e hash — com dados sintéticos.
//   2. O PDF é um PDF? Cabeçalho, xref apontando para cada objeto, paginação "X de Y", texto
//      dentro da página e bytes idênticos para o mesmo conteúdo.
//   3. `--http`: a rota recusa quem não é admin (404), e para o admin busca, emite, gera o PDF,
//      verifica o hash e REGISTRA tudo — sem mover um diamante sequer da conta consultada.
//
// O modo `--http` sobe as rotas do painel neste processo, numa porta livre, em vez de falar
// com o servidor do jogo: testa o mesmo `rotasDeAdmin` sem depender de qual versão está no ar.
import '../src/server/config.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  montarDocumento, normalizarContexto, reconciliar, consumoDaCompra, identificarCompra, nomeDoArquivo,
  NAO_DISPONIVEL,
} from '../src/server/med-documento.mjs';
import { renderizarPdf } from '../src/server/med-pdf.mjs';
import { renderizarHtml } from '../src/server/med-html.mjs';
import { textoImprimivel, decodificarPng } from '../src/server/pdf.mjs';

const args = process.argv.slice(2);
const opcao = (nome) => { const i = args.indexOf(`--${nome}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null; };

const falhas = [];
const ok = (passou, oque, detalhe = '') => {
  console.log(`${passou ? '  ok  ' : ' FALHA'}  ${oque}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!passou) falhas.push(oque);
};

// ------------------------------------------------------------------- dados sintéticos

const t = (s) => new Date(s).toISOString();
function fixture() {
  let saldo = 0;
  let id = 100;
  const l = (delta, motivo, ref, nota, em) => {
    saldo += delta;
    return { id: ++id, delta, saldoApos: saldo, motivo, ref, nota, em: t(em) };
  };
  return {
    jogador: { id: 7, nick: 'Fulano', criadoEm: t('2026-09-03T15:32:11Z'), ultimaAtividade: t('2026-09-09T01:26:42Z'), diamantes: 25, nivel: 37, vipAte: Date.parse('2026-10-07T15:42:26Z'), boosts: { xp: Date.parse('2026-09-08T16:23:50Z') } },
    conta: { id: 9, email: 'fulano@exemplo.com', provedor: 'google', emailConfirmado: true, criadaEm: t('2026-09-03T15:31:11Z'), ultimoLogin: t('2026-09-05T01:27:16Z'), ban: null },
    pagamentos: [
      { referencia: 'aaaa1111bbbb2222cccc3333dddd4444', qtd: 50, centavos: 2200, metodo: 'pix', provedor: 'efi', provedorRef: null, status: 'pago', comprovante: 'E0000000020260903170400ABCDEFGHIJ', aceiteEm: t('2026-09-03T17:02:56Z'), entregue: true, criadoEm: t('2026-09-03T17:02:56Z'), pagoEm: t('2026-09-03T17:04:19Z'), cpf: '52998224725', cpfIlegivel: false, nomePagador: 'FULANO DE TAL', emailInformado: 'fulano@exemplo.com' },
      { referencia: 'ffff1111bbbb2222cccc3333dddd4444', qtd: 10, centavos: 440, metodo: 'pix', provedor: 'efi', provedorRef: null, status: 'pendente', comprovante: null, aceiteEm: t('2026-09-07T15:53:01Z'), entregue: false, criadoEm: t('2026-09-07T15:53:01Z'), pagoEm: null, cpf: '52998224725', cpfIlegivel: false, nomePagador: null, emailInformado: 'fulano@exemplo.com' },
    ],
    ledger: [
      l(50, 'compra', 'aaaa1111bbbb2222cccc3333dddd4444', '22 BRL via efi', '2026-09-03T17:04:19Z'),
      l(-10, 'loja', 'vip30', '30 Dias de VIP', '2026-09-03T17:04:38Z'),
      l(-6, 'loja', 'boost_capture', 'Capture Boost (1h)', '2026-09-03T21:43:32Z'),
      l(-5, 'loja', 'supplypack', 'Pacote de Suprimentos', '2026-09-03T21:50:09Z'),
      l(-24, 'loja', 'boost_shinycharm_6h', 'Shiny Secret Lure (6h)', '2026-09-03T23:48:39Z'),
      l(1, 'voto', 'vote_x', '2 votos TopIdle · Fulano 💎', '2026-09-04T15:45:24Z'),
      l(-6, 'loja', 'boost_shinycharm', 'Shiny Secret Lure (1h)', '2026-09-06T21:16:44Z'),
      l(50, 'ajuste_admin', 'reset_beta', 'reset do fim do beta — saldo = 50 comprados', '2026-09-07T15:23:24Z'),
      l(-10, 'loja', 'vip30', '30 Dias de VIP', '2026-09-07T15:42:26Z'),
      l(1, 'voto', 'vote_y', '2 votos TopIdle · Fulano', '2026-09-07T15:45:17Z'),
      l(-8, 'loja', 'boost_pokexp_3h', 'XP Boost Pokémon (3h)', '2026-09-07T16:21:23Z'),
      l(-8, 'loja', 'boost_xp_3h', 'XP Boost (3h)', '2026-09-07T16:23:50Z'),
    ],
    origens: [],
    atividade: [{ dia: '2026-09-03', categoria: 'npc', acao: 'compra', n: 3, primeiro: t('2026-09-03T16:00:00Z'), ultimo: t('2026-09-03T20:00:00Z') }],
    cobertura: { origensDesde: t('2026-09-11T15:59:05Z'), atividadeDesde: t('2026-08-28T15:01:34Z') },
  };
}
const empresa = { razaoSocial: null, nomeFantasia: null, cnpj: '68.748.721/0001-18', site: 'https://pokeidle.io', email: 'support@pokeidle.io', endereco: null, faltando: [] };
const emissao = { codigo: 'MED-2026-000001', emitidoEm: '2026-09-14T18:00:00.000Z', porEmail: 'admin@exemplo.com' };
const catalogo = (id) => ({ vip30: { nome: '30 Dias de VIP', descricao: '30 dias de VIP.' } })[id];
const montar = (dados, extra = {}) => montarDocumento({ dados, empresa, contexto: {}, emissao, catalogo, ...extra });
const textoDe = (doc) => JSON.stringify(doc.blocos);

// ------------------------------------------------------------------- 1. regras
console.log('\nREGRAS DO DOCUMENTO\n' + '='.repeat(40));
{
  const d = fixture();
  const rec = reconciliar(d.ledger, d.jogador.diamantes, d.pagamentos);
  ok(rec.linhas.comprados.v === 50 && rec.linhas.outras.v === 2 && rec.linhas.admin.v === 50 && rec.linhas.utilizados.v === -77,
    'reconciliação separa compra, outras fontes, admin e Loja', JSON.stringify(Object.fromEntries(Object.entries(rec.linhas).map(([k, v]) => [k, v.v]))));
  ok(rec.calculado === 25 && !rec.divergenciaSaldo && rec.verificacoes.every((v) => v.ok), 'saldo calculado 25 bate e todas as verificações passam');

  const c = consumoDaCompra(d.ledger, d.ledger[0]);
  ok(c.naLoja === 50 && c.restante === 0 && c.esgotadoEm === t('2026-09-06T21:16:44Z'),
    'critério conservador: os 50 comprados esgotam no gasto de 06/09 (o voto é gasto antes)', JSON.stringify(c));

  const doc = montar(d);
  ok(doc.compraIdentificada?.referencia === d.pagamentos[0].referencia, 'única compra confirmada vira a compra de referência');
  ok(!doc.divergencia, 'documento limpo não acusa divergência');
  ok(textoDe(doc).includes('reset do fim do beta') && textoDe(doc).includes('Encerramento do período beta'), 'o ajuste do reset do beta aparece, com a anotação');
  ok(!textoDe(doc).includes('💎'), 'emoji das anotações sai do conteúdo (PDF e prévia iguais)');
  ok(textoDe(doc).includes('Consta também 1 cobrança não paga'), 'cobrança pendente é mencionada sem virar crédito');

  const pix = identificarCompra(d.pagamentos, normalizarContexto({ pixId: 'e0000000020260903170400abcdefghij' }));
  ok(pix.compra === d.pagamentos[0] && /ID da transação/.test(pix.criterio), 'ID PIX informado (sem diferenciar maiúsculas) identifica a compra');
  const valor = identificarCompra(d.pagamentos, normalizarContexto({ valorContestado: 'R$ 22,00' }));
  ok(valor.compra === d.pagamentos[0] && /valor/.test(valor.criterio), 'valor contestado único identifica a compra');
  const semValor = identificarCompra(d.pagamentos, normalizarContexto({ valorContestado: '30' }));
  ok(!semValor.compra && semValor.avisos.length === 1, 'valor sem pagamento correspondente não inventa compra');
  const idErrado = montar(d, { contexto: normalizarContexto({ pixId: 'E999' }) });
  ok(!idErrado.compraIdentificada && textoDe(idErrado).includes('não corresponde a nenhum pagamento'), 'ID PIX desconhecido vira aviso, sem compra apontada');

  const dois = fixture();
  dois.pagamentos.push({ ...dois.pagamentos[0], referencia: 'bbbb', status: 'pago' });
  dois.ledger.push({ id: 999, delta: 50, saldoApos: 75, motivo: 'compra', ref: 'bbbb', nota: null, em: t('2026-09-08T10:00:00Z') });
  dois.jogador.diamantes = 75;
  const ambiguo = identificarCompra(dois.pagamentos, normalizarContexto({ valorContestado: '22,00' }));
  ok(!ambiguo.compra && /inequívoca/.test(ambiguo.avisos[0]), 'dois pagamentos com o mesmo valor: não aponta nenhum');

  const div = fixture();
  div.jogador.diamantes = 30;
  const dDiv = montar(div);
  ok(dDiv.divergencia && textoDe(dDiv).includes('ATENÇÃO: Foi identificada divergência entre o saldo calculado e o saldo registrado.'), 'saldo do cadastro diferente do histórico é exposto');

  const quebra = fixture();
  quebra.ledger[3] = { ...quebra.ledger[3], saldoApos: 99 };
  const rq = reconciliar(quebra.ledger, 25, quebra.pagamentos);
  // Um saldo corrompido quebra a corrente duas vezes: nele (não bate com o anterior) e no seguinte
  // (que parte do valor corrompido). A primeira quebra aponta o lançamento exato.
  ok(rq.quebras.length === 2 && rq.quebras[0].lancamento.id === quebra.ledger[3].id && !rq.verificacoes[2].ok,
    'quebra no encadeamento é detectada a partir do lançamento exato');

  const semCredito = fixture();
  semCredito.ledger = semCredito.ledger.slice(1).map((l) => ({ ...l, saldoApos: l.saldoApos - 50 }));
  semCredito.jogador.diamantes = -25;
  const rs = reconciliar(semCredito.ledger, -25, semCredito.pagamentos);
  ok(rs.semCredito.length === 1 && !rs.verificacoes[3].ok, 'pagamento confirmado sem crédito no livro-razão é apontado');

  const vazio = fixture();
  vazio.pagamentos = vazio.pagamentos.map((p) => ({ ...p, cpf: null, nomePagador: null }));
  vazio.conta = null;
  const dv = montar(vazio);
  const cliente = dv.blocos.find((b) => b.t === 'tabela' && b.colunas[0].titulo === 'Campo');
  ok(cliente.linhas.find((r) => r[0] === 'Nome completo')[1] === NAO_DISPONIVEL && cliente.linhas.find((r) => r[0] === 'CPF')[1] === NAO_DISPONIVEL,
    'sem nome e sem CPF: "Não disponível nos registros do sistema"');
  ok(cliente.linhas.find((r) => r[0] === 'E-mail')[1] === NAO_DISPONIVEL, 'sem conta de acesso: e-mail indisponível, nada inventado');

  const h1 = montar(fixture()).hash;
  const h2 = montar(fixture()).hash;
  const mudado = fixture();
  mudado.ledger[2] = { ...mudado.ledger[2], nota: 'Capture Boost (2h)' };
  ok(h1 === h2 && /^[0-9a-f]{64}$/.test(h1), 'hash é SHA-256 e determinístico');
  ok(montar(mudado).hash !== h1, 'uma anotação diferente muda o hash');
  ok(montarDocumento({ dados: fixture(), empresa, contexto: {}, emissao: { ...emissao, porEmail: 'outro@x.com' }, catalogo }).hash !== h1, 'outro emissor muda o hash');
  ok(textoDe(montar(fixture())).includes(h1), 'o hash impresso é o hash calculado');

  const mal = fixture();
  mal.jogador.nick = '<img src=x onerror=alert(1)>';
  mal.ledger[1] = { ...mal.ledger[1], nota: '"><script>alert(2)</script>' };
  const html = renderizarHtml(montar(mal));
  ok(!html.includes('<img src=x') && !html.includes('<script>'), 'prévia HTML escapa nick e anotação maliciosos');
  ok(nomeDoArquivo(montar(mal)) === 'MED_imgsrcxonerroralert1_MED-2026-000001.pdf', 'nome do arquivo só com nick limpo e código');
  const arquivo = nomeDoArquivo(montar(fixture()));
  ok(!arquivo.includes('529') && !arquivo.includes('@'), 'nome do arquivo sem CPF nem e-mail', arquivo);

  const obs = montar(fixture(), { contexto: normalizarContexto({ protocolo: 'P-1' }) });
  ok(!textoDe(obs).toLowerCase().includes('observação administrativa'), 'observação interna não entra no documento');

  ok(normalizarContexto({ valorContestado: '22,00' }).valorContestadoCentavos === 2200
    && normalizarContexto({ valorContestado: 'R$ 1.234,56' }).valorContestadoCentavos === 123456
    && normalizarContexto({ valorContestado: '22.5' }).valorContestadoCentavos === 2250, 'valor contestado aceita 22,00 · R$ 1.234,56 · 22.5');
  let recusou = 0;
  for (const ruim of [{ valorContestado: 'abc' }, { dataContestacao: '31/12/2026' }, { protocolo: 'x'.repeat(81) }]) {
    try { normalizarContexto(ruim); } catch { recusou++; }
  }
  ok(recusou === 3, 'contexto inválido é recusado com mensagem');
  ok(textoImprimivel('Ação 💎 → fim') === 'Ação -> fim', 'texto imprimível troca seta e tira emoji');
}

// ------------------------------------------------------------------- 2. PDF
console.log('\nPDF\n' + '='.repeat(40));
function conferirPdf(buf, nome) {
  const s = buf.toString('latin1');
  ok(s.startsWith('%PDF-1.4') && s.endsWith('%%EOF\n'), `${nome}: cabeçalho e fim de arquivo`);
  const startxref = Number(s.match(/startxref\n(\d+)\n%%EOF\n$/)?.[1]);
  const xref = s.slice(startxref).split('\n');
  const n = Number(xref[1].split(' ')[1]);
  let offsetsOk = xref[0] === 'xref';
  for (let i = 1; i < n; i++) {
    const off = Number(xref[2 + i].slice(0, 10));
    if (!s.startsWith(`${i} 0 obj`, off)) offsetsOk = false;
  }
  ok(offsetsOk, `${nome}: tabela xref aponta para os ${n - 1} objetos`);
  const paginas = (s.match(/\/Type \/Page /g) ?? []).length;
  const conteudos = [];
  const re = /\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g;
  let m;
  while ((m = re.exec(s))) {
    const ini = m.index + m[0].length;
    try { conteudos.push(inflateSync(buf.subarray(ini, ini + Number(m[1]))).toString('latin1')); } catch { /* imagem */ }
  }
  const textos = conteudos.filter((c) => c.includes(' Tj ET'));
  const hex = (t) => Buffer.from(t, 'latin1').toString('hex');
  ok(paginas > 0 && textos.length === paginas && textos.every((c, i) => c.includes(hex(`Página ${i + 1} de ${paginas}`))), `${nome}: ${paginas} página(s), todas com "Página X de ${paginas}"`);
  let foraDaPagina = 0;
  for (const c of textos) {
    for (const [, x, y] of c.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g)) {
      if (Number(x) < 40 || Number(x) > 555 || Number(y) < 15 || Number(y) > 830) foraDaPagina++;
    }
  }
  ok(foraDaPagina === 0, `${nome}: nenhum texto posicionado fora da área A4`);
  return paginas;
}
{
  const doc = montar(fixture());
  const a = renderizarPdf(doc);
  ok(a.equals(renderizarPdf(doc)), 'o mesmo documento gera os mesmos bytes');
  conferirPdf(a, 'documento curto');

  const longo = fixture();
  let saldo = 25;
  for (let i = 0; i < 180; i++) {
    saldo += i % 2 ? -1 : 1;
    longo.ledger.push({ id: 1000 + i, delta: i % 2 ? -1 : 1, saldoApos: saldo, motivo: i % 2 ? 'loja' : 'voto', ref: i % 2 ? 'boost_xp' : `vote_${'z'.repeat(40)}${i}`, nota: i % 2 ? 'XP Boost (1h)' : 'voto com uma anotação razoavelmente comprida para quebrar a linha dentro da célula', em: t(Date.parse('2026-09-08T00:00:00Z') + i * 60_000) });
  }
  longo.jogador.diamantes = saldo;
  const pgs = conferirPdf(renderizarPdf(montar(longo)), 'histórico longo');
  ok(pgs >= 8, 'histórico longo quebra em várias páginas', `${pgs} páginas`);

  const png = decodificarPng(readFileSync(new URL('../src/client/img/favicon-180.png', import.meta.url)));
  ok(png.largura === 180 && png.altura === 180 && png.cor.length === 180 * 180 * png.canaisCor, 'logo PNG decodificada para o PDF');
}

// ------------------------------------------------------------------- 3. conta real
const nick = opcao('nick');
if (nick && nick !== true) {
  console.log(`\nCONTA REAL (${nick}) — só leitura\n` + '='.repeat(40));
  const { pool } = await import('../src/server/db.mjs');
  const mdb = await import('../src/server/med-db.mjs');
  const { dadosDaEmpresa } = await import('../src/server/empresa.mjs');
  const { produtoPorId } = await import('../src/server/game/loja.mjs');
  const alvo = await mdb.localizarJogador({ nick });
  const dados = await mdb.coletarDados(alvo.playerId);
  const doc = montarDocumento({
    dados, empresa: dadosDaEmpresa(), contexto: {},
    emissao: { codigo: 'MED-2026-000000', emitidoEm: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(), porEmail: 'teste@local' },
    catalogo: (id) => produtoPorId.get(id),
  });
  console.log(`  ${dados.pagamentos.length} pagamento(s) · ${dados.ledger.length} lançamento(s) · ${dados.origens.length} origem(ns) · compra de referência: ${doc.compraIdentificada?.criterio ?? 'nenhuma'}`);
  ok(!doc.divergencia, 'conta real: todas as verificações de integridade conferem');
  const pdf = renderizarPdf(doc);
  conferirPdf(pdf, 'conta real');
  const saida = opcao('saida');
  if (saida && saida !== true) {
    mkdirSync(saida, { recursive: true });
    writeFileSync(join(saida, nomeDoArquivo(doc)), pdf);
    writeFileSync(join(saida, nomeDoArquivo(doc).replace(/\.pdf$/, '.html')), renderizarHtml(doc));
    console.log(`  gravado em ${saida}`);
  }

  // ----------------------------------------------------------------- 4. rotas
  if (opcao('http')) {
    console.log('\nROTAS /admin/med/*\n' + '='.repeat(40));
    const http = await import('node:http');
    const { rotasDeAdmin } = await import('../src/server/admin-rotas.mjs');
    const { sessaoDe } = await import('./sessao-local.mjs');
    await mdb.migrar();

    const servidor = http.createServer((req, res) => {
      rotasDeAdmin(req, res, new URL(req.url, 'http://local')).then((tratou) => {
        if (!tratou) { res.writeHead(404); res.end(); }
      });
    });
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    const post = (rota, corpo) => fetch(`${base}/admin/${rota}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

    const admin = (process.env.ADMIN_EMAILS ?? '').split(',')[0].trim();
    const tokAdmin = (await sessaoDe(admin)).token;
    const tokJogador = (await sessaoDe(nick)).token;
    const antes = (await pool.query(`SELECT diamonds, (SELECT count(*) FROM diamante_ledger WHERE player_id = $1)::int AS n FROM players WHERE id = $1`, [alvo.playerId])).rows[0];

    for (const [quem, token] of [['sem token', undefined], ['token de jogador', tokJogador]]) {
      const r = await post('med/buscar', { token, nick });
      ok(r.status === 404, `${quem} leva 404 em /admin/med/buscar`, String(r.status));
    }
    const rPdfAnon = await post('med/pdf', { codigo: 'MED-2026-000001' });
    ok(rPdfAnon.status === 404, 'PDF sem sessão leva 404');

    const busca = await post('med/buscar', { token: tokAdmin, nick });
    const b = await busca.json();
    ok(busca.status === 200 && b.jogador?.nick?.toLowerCase() === nick.toLowerCase() && busca.headers.get('cache-control') === 'no-store', 'admin busca a conta (resposta no-store)');

    const emi = await post('med/emitir', { token: tokAdmin, playerId: b.jogador.playerId, contexto: { protocolo: 'TESTE-AUTOMATIZADO' }, observacao: 'teste de rota (tools/teste-med.mjs)' });
    const e = await emi.json();
    ok(emi.status === 200 && /^MED-\d{4}-\d{6}$/.test(e.codigo) && e.html?.includes(e.hash), 'emissão devolve código, hash e prévia com o hash', e.codigo);

    const ruim = await post('med/emitir', { token: tokAdmin, playerId: b.jogador.playerId, contexto: { valorContestado: 'abc' } });
    ok(ruim.status === 400, 'contexto inválido na emissão é 400');

    const p1 = await post('med/pdf', { token: tokAdmin, codigo: e.codigo });
    const buf1 = Buffer.from(await p1.arrayBuffer());
    const hash1 = createHash('sha256').update(buf1).digest('hex');
    ok(p1.status === 200 && p1.headers.get('content-type') === 'application/pdf' && p1.headers.get('x-hash-pdf') === hash1, 'PDF sai como application/pdf com o hash do arquivo');
    ok(/filename="MED_[A-Za-z0-9_-]+_MED-\d{4}-\d{6}\.pdf"/.test(p1.headers.get('content-disposition') ?? ''), 'nome do arquivo MED_<nick>_<código>.pdf');
    conferirPdf(buf1, 'PDF da rota');
    const buf2 = Buffer.from(await (await post('med/pdf', { token: tokAdmin, codigo: e.codigo })).arrayBuffer());
    ok(buf1.equals(buf2), 'baixar de novo o mesmo número dá o mesmo arquivo');

    const v1 = await (await post('med/verificar', { token: tokAdmin, codigo: e.codigo, hashArquivo: hash1 })).json();
    const v2 = await (await post('med/verificar', { token: tokAdmin, codigo: e.codigo, hashArquivo: '0'.repeat(64) })).json();
    ok(v1.arquivoConfere === true && v2.arquivoConfere === false && v1.hashConteudo === e.hash, 'verificação confere o arquivo emitido e recusa outro');

    const hist = await (await post('med/historico', { token: tokAdmin })).json();
    ok(hist.emissoes.some((x) => x.codigo === e.codigo) && !('observacao' in hist.emissoes[0]), 'histórico lista a emissão, sem a observação interna');

    const { rows: log } = await pool.query(`SELECT acao FROM med_documentos_log WHERE por_email = $1 AND (codigo = $2 OR (acao = 'consulta' AND player_id = $3)) ORDER BY id`, [admin, e.codigo, alvo.playerId]);
    const acoes = new Set(log.map((r) => r.acao));
    ok(['consulta', 'emissao', 'pdf', 'verificacao'].every((a) => acoes.has(a)), 'log de acesso registra consulta, emissão, PDF e verificação');

    const depois = (await pool.query(`SELECT diamonds, (SELECT count(*) FROM diamante_ledger WHERE player_id = $1)::int AS n FROM players WHERE id = $1`, [alvo.playerId])).rows[0];
    ok(antes.diamonds === depois.diamonds && antes.n === depois.n, 'nada mudou na conta consultada (saldo e livro-razão intactos)');
    servidor.close();
  }
  await pool.end();
}

console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\ntudo certo');
process.exit(falhas.length ? 1 : 0);
