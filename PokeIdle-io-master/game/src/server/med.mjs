// Documentos para MED — o serviço que as rotas do painel chamam.
//
// ### Quem pode
//
// Admin completo (`ADMIN_EMAILS`) e, se `MED_EMAILS` estiver preenchida, só os e-mails de lá.
// A Resolver Auditoria NÃO entra: o documento carrega CPF, e-mail e IP, e quem resolve ticket de
// item não precisa de nada disso (mesma régua da `fichaDeJogador({ completo })`). A checagem é
// feita na rota, no servidor — a tela só esconde a aba.
//
// ### O número do documento é amarrado ao conteúdo
//
// Emitir reserva o código, monta o conteúdo, calcula o hash e grava o registro. Baixar o PDF
// depois NÃO reemite: o conteúdo guardado em memória (por 30 minutos) é o mesmo que o
// administrador conferiu na prévia. Se a memória não tiver mais o documento (reinício, outro
// processo), ele é remontado a partir do banco com o MESMO código, data e contexto — e só sai
// se o hash bater com o registrado. Se a conta mudou nesse meio-tempo, a resposta é "gere outro
// documento": um número já emitido nunca passa a apontar para um conteúdo diferente.
//
// ### Onde o PDF fica guardado
//
// Em lugar nenhum. Ele é gerado a cada pedido, vai no corpo da resposta e só o HASH do arquivo
// é gravado. O cache de 30 minutos guarda o conteúdo (com dados pessoais) só em memória, com
// teto de entradas, e some com o processo.
import { createHash } from 'node:crypto';
import * as mdb from './med-db.mjs';
import { montarDocumento, normalizarContexto, resumoParaPainel, nomeDoArquivo } from './med-documento.mjs';
import { renderizarPdf } from './med-pdf.mjs';
import { renderizarHtml } from './med-html.mjs';
import { dadosDaEmpresa } from './empresa.mjs';

export class ErroMed extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

/** A lista opcional de quem, entre os admins, pode emitir. Lida a cada chamada. */
function listaMed() {
  return new Set(
    String(process.env.MED_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  );
}

/** `ehAdmin` vem de `admin.mjs` — este arquivo não duplica a regra de quem é admin. */
export function podeUsarMed(email, ehAdmin) {
  if (!email || !ehAdmin) return false;
  const lista = listaMed();
  return lista.size === 0 || lista.has(String(email).toLowerCase());
}

let catalogoCache = null;
async function catalogo() {
  if (!catalogoCache) {
    const { produtoPorId } = await import('./game/loja.mjs');
    catalogoCache = (id) => {
      const p = produtoPorId.get(id);
      return p ? { nome: p.nome, descricao: p.descricao } : undefined;
    };
  }
  return catalogoCache;
}

// ------------------------------------------------------------------- cache

const VALIDADE_MS = 30 * 60_000;
const MAX_CACHE = 40;
const cache = new Map();

function guardar(doc) {
  const agora = Date.now();
  for (const [k, v] of cache) if (v.expira < agora) cache.delete(k);
  cache.set(doc.codigo, { doc, expira: agora + VALIDADE_MS });
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
}

function doCache(codigo) {
  const v = cache.get(codigo);
  if (!v) return null;
  if (v.expira < Date.now()) { cache.delete(codigo); return null; }
  return v.doc;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ------------------------------------------------------------------- ações

/** A busca da tela. Já mostra dado pessoal, então já é registrada. */
export async function buscar({ nick, transacao, porEmail }) {
  const alvo = await mdb.localizarJogador({ nick, transacao }).catch((err) => { throw new ErroMed(err.message, 404); });
  const dados = await mdb.coletarDados(alvo.playerId);
  await mdb.registrarAcesso({
    acao: 'consulta', playerId: alvo.playerId, nick: alvo.nick, porEmail,
    detalhe: alvo.por === 'transacao' ? 'busca por identificador de transação' : 'busca por nickname',
  });
  return { jogador: resumoParaPainel(dados), empresaFaltando: dadosDaEmpresa().faltando };
}

/** Emite um documento novo: número, conteúdo, hash e registro. Devolve a prévia. */
export async function emitir({ playerId, contexto, observacao, porEmail }) {
  let ctx;
  try {
    ctx = normalizarContexto(contexto ?? {});
  } catch (err) {
    throw new ErroMed(err.message);
  }
  const obs = String(observacao ?? '').trim();
  if (obs.length > 2000) throw new ErroMed('a observação passa de 2000 caracteres');

  let dados;
  try {
    dados = await mdb.coletarDados(playerId);
  } catch (err) {
    throw new ErroMed(err.message, 404);
  }

  // Segundo cheio: o mesmo instante tem de voltar igual do banco para o hash se repetir.
  const emitidoEm = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  const { id, codigo } = await mdb.reservarCodigo(emitidoEm);
  const empresa = dadosDaEmpresa();
  const doc = montarDocumento({
    dados, empresa, contexto: ctx, emissao: { codigo, emitidoEm, porEmail }, catalogo: await catalogo(),
  });

  await mdb.registrarEmissao({
    id, codigo, playerId: doc.playerId, contaId: doc.contaId, nick: doc.nick, porEmail, emitidoEm,
    hashConteudo: doc.hash, contexto: ctx, observacao: obs, contagens: doc.contagens,
  });
  await mdb.registrarAcesso({
    acao: 'emissao', codigo, playerId: doc.playerId, nick: doc.nick, porEmail,
    detalhe: ctx.protocolo ? `protocolo ${ctx.protocolo}` : null,
  });
  guardar(doc);

  return {
    codigo, hash: doc.hash, emitidoEm, nick: doc.nick, playerId: doc.playerId,
    arquivo: nomeDoArquivo(doc),
    html: renderizarHtml(doc),
    divergencia: doc.divergencia,
    compraIdentificada: doc.compraIdentificada,
    contagens: doc.contagens,
    empresaFaltando: empresa.faltando,
  };
}

/** O PDF de um documento JÁ emitido — nunca de um conteúdo diferente do registrado. */
export async function gerarPdf({ codigo, porEmail }) {
  const reg = await mdb.emissaoPorCodigo(codigo);
  if (!reg) throw new ErroMed('documento não encontrado', 404);

  let doc = doCache(reg.codigo);
  if (!doc) {
    let dados;
    try {
      dados = await mdb.coletarDados(reg.playerId);
    } catch {
      throw new ErroMed(`a conta do documento ${reg.codigo} não existe mais — o PDF não pode ser remontado`, 409);
    }
    doc = montarDocumento({
      dados, empresa: dadosDaEmpresa(), contexto: reg.contexto,
      emissao: { codigo: reg.codigo, emitidoEm: reg.emitidoEm, porEmail: reg.porEmail },
      catalogo: await catalogo(),
    });
  }
  if (doc.hash !== reg.hashConteudo) {
    throw new ErroMed(
      `Os registros da conta mudaram desde a emissão de ${reg.codigo}, e este número está vinculado ao conteúdo original. Emita um novo documento.`,
      409,
    );
  }

  const buffer = renderizarPdf(doc);
  const hashPdf = sha256(buffer);
  const registrado = await mdb.carimbarHashPdf(reg.codigo, hashPdf);
  await mdb.registrarAcesso({
    acao: 'pdf', codigo: reg.codigo, playerId: reg.playerId, nick: reg.nick, porEmail,
    detalhe: `sha256 do arquivo ${hashPdf}${registrado && registrado !== hashPdf ? ' — difere do primeiro PDF deste documento' : ''}`,
  });
  return { buffer, arquivo: nomeDoArquivo(doc), hashPdf };
}

/** Confere um documento pelo código e, se vier, o hash de um arquivo em mãos. */
export async function verificar({ codigo, hashArquivo, porEmail }) {
  const reg = await mdb.emissaoPorCodigo(codigo);
  if (!reg) return { encontrado: false };
  const h = String(hashArquivo ?? '').trim().toLowerCase();
  if (h && !/^[0-9a-f]{64}$/.test(h)) throw new ErroMed('hash de arquivo inválido');
  await mdb.registrarAcesso({ acao: 'verificacao', codigo: reg.codigo, playerId: reg.playerId, nick: reg.nick, porEmail, detalhe: h ? `arquivo ${h}` : null });
  return {
    encontrado: true,
    codigo: reg.codigo,
    nick: reg.nick,
    playerId: reg.playerId,
    emitidoEm: reg.emitidoEm,
    emitidoPor: reg.porEmail,
    hashConteudo: reg.hashConteudo,
    hashPdf: reg.hashPdf,
    contexto: reg.contexto,
    observacao: reg.observacao,
    contagens: reg.contagens,
    arquivoConfere: h ? (reg.hashPdf ? reg.hashPdf === h : null) : null,
  };
}

export async function historico() {
  const [emissoes, acessos] = await Promise.all([mdb.listarEmissoes(30), mdb.listarAcessos(40)]);
  return { emissoes, acessos };
}
